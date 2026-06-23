/**
 * iCloud Shared Album proxy for akrett.com
 *
 * SETUP:
 * 1. Go to https://script.google.com → New project
 * 2. Paste this entire file
 * 3. Deploy → New deployment → Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Copy the deployment URL into PHOTOS_SCRIPT_URL in index.html
 */

const ALBUM_TOKEN = 'B1jJqstnBJ83b3x';
const BASE_62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function doGet(e) {
  try {
    const data = fetchAlbumPhotos(ALBUM_TOKEN);
    const callback = e && e.parameter && e.parameter.callback;

    if (callback) {
      return ContentService
        .createTextOutput(callback + '(' + JSON.stringify(data) + ')')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }

    return ContentService
      .createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    const payload = JSON.stringify({ error: String(err.message || err) });
    const callback = e && e.parameter && e.parameter.callback;

    if (callback) {
      return ContentService
        .createTextOutput(callback + '(' + payload + ')')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }

    return ContentService
      .createTextOutput(payload)
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function base62ToInt(str) {
  var result = 0;
  for (var i = 0; i < str.length; i++) {
    result = result * 62 + BASE_62.indexOf(str[i]);
  }
  return result;
}

function getBaseUrl(token) {
  var partition = token.charAt(0) === 'A'
    ? base62ToInt(token.charAt(1))
    : base62ToInt(token.substring(1, 3));
  var part = partition < 10 ? '0' + partition : String(partition);
  return 'https://p' + part + '-sharedstreams.icloud.com/' + token + '/sharedstreams/';
}

function getHeaders() {
  return {
    'Origin': 'https://www.icloud.com',
    'Content-Type': 'text/plain',
    'Accept': '*/*',
    'Referer': 'https://www.icloud.com/sharedalbum/',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_4) AppleWebKit/537.36'
  };
}

function fetchWithRedirect(baseUrl) {
  var options = {
    method: 'post',
    headers: getHeaders(),
    payload: JSON.stringify({ streamCtag: null }),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(baseUrl + 'webstream', options);

  if (response.getResponseCode() === 330) {
    var body = JSON.parse(response.getContentText());
    var tokenMatch = baseUrl.match(/\/([^/]+)\/sharedstreams\//);
    var token = tokenMatch ? tokenMatch[1] : ALBUM_TOKEN;
    baseUrl = 'https://' + body['X-Apple-MMe-Host'] + '/' + token + '/sharedstreams/';
    response = UrlFetchApp.fetch(baseUrl + 'webstream', options);
  }

  if (response.getResponseCode() !== 200) {
    throw new Error('iCloud album request failed with status ' + response.getResponseCode());
  }

  return {
    baseUrl: baseUrl,
    data: JSON.parse(response.getContentText())
  };
}

function fetchAssetUrls(baseUrl, photoGuids) {
  var options = {
    method: 'post',
    headers: getHeaders(),
    payload: JSON.stringify({ photoGuids: photoGuids }),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(baseUrl + 'webasseturls', options);

  if (response.getResponseCode() !== 200) {
    throw new Error('iCloud asset request failed with status ' + response.getResponseCode());
  }

  var data = JSON.parse(response.getContentText());
  var urls = {};

  for (var id in data.items) {
    var item = data.items[id];
    urls[id] = 'https://' + item.url_location + item.url_path;
  }

  return urls;
}

function getDerivativeList(derivatives) {
  var list = [];

  for (var key in derivatives) {
    if (!derivatives.hasOwnProperty(key)) continue;
    var value = derivatives[key];
    list.push({
      key: key,
      checksum: value.checksum,
      fileSize: Number(value.fileSize) || 0,
      width: Number(value.width) || 0,
      height: Number(value.height) || 0
    });
  }

  list.sort(function(a, b) {
    return a.fileSize - b.fileSize;
  });

  return list;
}

function fetchAlbumPhotos(token) {
  var stream = fetchWithRedirect(getBaseUrl(token));
  var baseUrl = stream.baseUrl;
  var data = stream.data;
  var photos = data.photos || [];
  var photoGuids = photos.map(function(photo) {
    return photo.photoGuid;
  });
  var allUrls = {};

  for (var i = 0; i < photoGuids.length; i += 25) {
    var chunk = photoGuids.slice(i, i + 25);
    var chunkUrls = fetchAssetUrls(baseUrl, chunk);
    Object.assign(allUrls, chunkUrls);
  }

  var result = photos.map(function(photo) {
    if (photo.mediaAssetType === 'video') {
      return null;
    }

    var derivList = getDerivativeList(photo.derivatives || {});
    if (!derivList.length) return null;

    var thumbDeriv = derivList[0];
    var fullDeriv = derivList[derivList.length - 1];

    return {
      id: photo.photoGuid,
      thumb: allUrls[thumbDeriv.checksum] || null,
      full: allUrls[fullDeriv.checksum] || null,
      caption: photo.caption || '',
      contributor: photo.contributorFullName || '',
      dateCreated: photo.dateCreated || ''
    };
  }).filter(function(photo) {
    return photo && photo.thumb;
  });

  result.reverse();

  return {
    albumName: data.streamName || 'Wedding Photos',
    photoCount: result.length,
    photos: result
  };
}
