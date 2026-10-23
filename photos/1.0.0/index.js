// API foto galeri. Dipanggil dari server.js supaya fungsi tidak menumpuk di sana.
const API = 'https://jsonplaceholder.typicode.com/photos?_limit=8';

let photos = null;
let lastFetch = 0;
let lastError = null;

function loadPhotos() {
  console.log('mengambil data dari', API);

  return fetch(API)
    .then((res) => {
      console.log('  status:', res.status, res.statusText);
      return res.json();
    })
    .then((data) => {
      photos = data;
      lastFetch = Date.now();
      lastError = null;
      console.log('  diterima', data.length, 'foto');
      return data;
    })
    .catch((err) => {
      lastError = err && err.message ? err.message : String(err);
      console.log('  gagal:', lastError);
      return [];
    });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function handle(req, res, clean) {
  if (clean === '/api/photos') {
    if (photos) {
      sendJson(res, 200, photos);
      return true;
    }
    firstLoad.then((data) => sendJson(res, data.length ? 200 : 502, data));
    return true;
  }

  if (clean === '/api/status') {
    sendJson(res, 200, {
      source: API,
      count: photos ? photos.length : 0,
      fetchedAt: lastFetch ? new Date(lastFetch).toISOString() : null,
      error: lastError,
    });
    return true;
  }

  if (clean === '/api/refresh') {
    loadPhotos().then((data) => sendJson(res, 200, { count: data.length }));
    return true;
  }

  return false;
}

// Unduh foto saat modul dimuat, bersamaan dengan halaman yang dibuka NX8V.
const firstLoad = loadPhotos();

module.exports = { handle, loadPhotos };
