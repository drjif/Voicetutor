const CACHE_NAME = 'same3le-v16';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './features.css',
  './homepage-marketing.css',
  './marketing.css',
  './app.js',
  './homepage-marketing.js',
  './file-import-ui.js',
  './file-import.js',
  './xlsx-import.js',
  './anki-import.js',
  './zip-reader.js',
  './sqlite-read.js',
  './beta.js',
  './dom.js',
  './deck.js',
  './paste-data.js',
  './power.js',
  './lockscreen.js',
  './sheet-v2.js',
  './sheet-data.js',
  './session-next.js',
  './voice.js',
  './grading.js',
  './lib.js',
  './supabase-config.js',
  './auth-state.js',
  './auth.js',
  './saved-sources.js',
  './account-ui.js',
  './manifest.webmanifest',
  './icon.svg',
  './data/sample-questions.csv'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === 'navigate') return caches.match('./index.html');
        throw new Error('Resource unavailable offline');
      })
  );
});
