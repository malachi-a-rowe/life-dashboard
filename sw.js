// Life Dashboard service worker
// App files are cached for offline; cross-origin requests (Supabase, fonts, CDNs)
// are never touched, so cloud reads/writes always hit the live network.
// Bump CACHE on every release: v5 -> v6 -> ...
const CACHE = 'lifedash-v5';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './config.js',
  './icon.svg'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  // Only ever handle this app's own files. Supabase, Google Fonts and CDN
  // requests fall through to the network untouched (never cached).
  if (url.origin !== self.location.origin) return;

  var isHTML = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').indexOf('text/html') !== -1;
  var isConfig = url.pathname.endsWith('/config.js');

  // Network-first for HTML + config.js so deploys land immediately.
  if (isHTML || isConfig) {
    event.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
        return res;
      }).catch(function () {
        return caches.match(req).then(function (r) { return r || caches.match('./index.html'); });
      })
    );
    return;
  }

  // Cache-first for this app's own static assets (icons, etc.).
  event.respondWith(
    caches.match(req).then(function (cached) {
      return cached || fetch(req).then(function (res) {
        if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
        return res;
      }).catch(function () { return cached; });
    })
  );
});
