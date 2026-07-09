// ════════════════════════════════════════════════════════════════
// Life Dashboard Service Worker
//   • App files (HTML, config.js, icons) → cached for offline
//   • Cross-origin (Supabase, fonts, CDNs) → always live network, never cached
//   Bump CACHE_VERSION on every release: v4 -> v5 -> ...
// ════════════════════════════════════════════════════════════════
const CACHE_VERSION = 'lifedash-v4';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './config.js',
  './icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_VERSION).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Only ever handle this app's own files. Supabase, fonts, and CDN
  // requests are left completely alone → they always hit the live network.
  if (url.origin !== self.location.origin) return;

  const isHTML =
    req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');
  const isConfig = url.pathname.endsWith('/config.js');

  // Network-first for HTML + config.js (fresh app on every load)
  if (isHTML || isConfig) {
    event.respondWith(
      fetch(req)
        .then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then(cache => cache.put(req, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(req)) || caches.match('./index.html'))
    );
    return;
  }

  // Cache-first for this app's own static assets (icons, etc.)
  event.respondWith(
    caches.match(req).then(async cached => {
      if (cached) return cached;
      try {
        const response = await fetch(req);
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(req, copy));
        }
        return response;
      } catch {
        return cached;
      }
    })
  );
});
