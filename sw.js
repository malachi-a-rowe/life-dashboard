// ════════════════════════════════════════════════════════════════
// Life Dashboard Service Worker
//
// Version:
//   Bump CACHE_VERSION whenever you deploy a new release.
//   Example: 'lifedash-v3' -> 'lifedash-v4'
//
// Strategy:
//   • HTML + config.js  → Network first
//   • Everything else   → Cache first
//   • Offline supported
//   • Old caches cleaned automatically
// ════════════════════════════════════════════════════════════════

const CACHE_VERSION = 'lifedash-v3';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './config.js',
  './icon.svg'
];

// ----------------------------------------------------
// Install
// ----------------------------------------------------

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// ----------------------------------------------------
// Activate
// ----------------------------------------------------

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key !== CACHE_VERSION)
            .map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ----------------------------------------------------
// Fetch
// ----------------------------------------------------

self.addEventListener('fetch', event => {

  const req = event.request;

  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  const isHTML =
    req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  const isConfig =
    url.origin === self.location.origin &&
    url.pathname.endsWith('/config.js');

  // --------------------------------------------------
  // Network-first:
  //   HTML
  //   config.js
  // --------------------------------------------------

  if (isHTML || isConfig) {

    event.respondWith(

      fetch(req)

        .then(response => {

          if (response && response.ok) {
            const copy = response.clone();

            caches.open(CACHE_VERSION)
              .then(cache => cache.put(req, copy));
          }

          return response;
        })

        .catch(async () => {

          const cached = await caches.match(req);

          if (cached) return cached;

          return caches.match('./index.html');
        })

    );

    return;
  }

  // --------------------------------------------------
  // Cache-first:
  //   icons
  //   fonts
  //   CDN JS
  //   images
  //   other assets
  // --------------------------------------------------

  event.respondWith(

    caches.match(req)

      .then(async cached => {

        if (cached) return cached;

        try {

          const response = await fetch(req);

          if (response && response.ok) {

            const copy = response.clone();

            caches.open(CACHE_VERSION)
              .then(cache => cache.put(req, copy));

          }

          return response;

        } catch {

          return cached;
        }

      })

  );

});
