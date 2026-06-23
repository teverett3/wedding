const fs = require('fs');
const path = require('path');

const ALBUM_TOKEN = 'B1jJqstnBJ83b3x';
const BASE_62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

const HEADERS = {
  Origin: 'https://www.icloud.com',
  'Content-Type': 'text/plain',
  Accept: '*/*',
  Referer: 'https://www.icloud.com/sharedalbum/',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/56.0.2924.87 Safari/537.36',
};

function base62ToInt(str) {
  let result = 0;
  for (let i = 0; i < str.length; i++) {
    result = result * 62 + BASE_62.indexOf(str[i]);
  }
  return result;
}

function getBaseUrl(token) {
  const partition =
    token.charAt(0) === 'A'
      ? base62ToInt(token.charAt(1))
      : base62ToInt(token.substring(1, 3));
  const part = partition < 10 ? `0${partition}` : String(partition);
  return `https://p${part}-sharedstreams.icloud.com/${token}/sharedstreams/`;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });

  return response;
}

async function fetchWithRedirect(baseUrl) {
  let response = await postJson(`${baseUrl}webstream`, { streamCtag: null });

  if (response.status === 330) {
    const body = await response.json();
    const tokenMatch = baseUrl.match(/\/([^/]+)\/sharedstreams\//);
    const token = tokenMatch ? tokenMatch[1] : ALBUM_TOKEN;
    baseUrl = `https://${body['X-Apple-MMe-Host']}/${token}/sharedstreams/`;
    response = await postJson(`${baseUrl}webstream`, { streamCtag: null });
  }

  if (!response.ok) {
    throw new Error(`iCloud album request failed with status ${response.status}`);
  }

  return {
    baseUrl,
    data: await response.json(),
  };
}

async function fetchAssetUrls(baseUrl, photoGuids) {
  const response = await postJson(`${baseUrl}webasseturls`, { photoGuids });

  if (!response.ok) {
    throw new Error(`iCloud asset request failed with status ${response.status}`);
  }

  const data = await response.json();
  const urls = {};

  for (const id of Object.keys(data.items || {})) {
    const item = data.items[id];
    urls[id] = `https://${item.url_location}${item.url_path}`;
  }

  return urls;
}

function getDerivativeList(derivatives) {
  return Object.keys(derivatives || {})
    .map((key) => ({
      key,
      checksum: derivatives[key].checksum,
      fileSize: Number(derivatives[key].fileSize) || 0,
    }))
    .sort((a, b) => a.fileSize - b.fileSize);
}

async function fetchAlbumPhotos(token) {
  const stream = await fetchWithRedirect(getBaseUrl(token));
  const { baseUrl, data } = stream;
  const photos = data.photos || [];
  const photoGuids = photos.map((photo) => photo.photoGuid);
  const allUrls = {};

  for (let i = 0; i < photoGuids.length; i += 25) {
    const chunk = photoGuids.slice(i, i + 25);
    const chunkUrls = await fetchAssetUrls(baseUrl, chunk);
    Object.assign(allUrls, chunkUrls);
  }

  const result = photos
    .map((photo) => {
      if (photo.mediaAssetType === 'video') {
        return null;
      }

      const derivList = getDerivativeList(photo.derivatives);
      if (!derivList.length) {
        return null;
      }

      const thumbDeriv = derivList[0];
      const fullDeriv = derivList[derivList.length - 1];

      return {
        id: photo.photoGuid,
        thumb: allUrls[thumbDeriv.checksum] || null,
        full: allUrls[fullDeriv.checksum] || null,
        caption: photo.caption || '',
        contributor: photo.contributorFullName || '',
        dateCreated: photo.dateCreated || '',
      };
    })
    .filter((photo) => photo && photo.thumb)
    .reverse();

  return {
    albumName: data.streamName || 'Wedding Photos',
    photoCount: result.length,
    updatedAt: new Date().toISOString(),
    photos: result,
  };
}

async function main() {
  const outputPath = path.join(__dirname, '..', 'photos.json');
  const data = await fetchAlbumPhotos(ALBUM_TOKEN);
  fs.writeFileSync(outputPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${data.photoCount} photos to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
