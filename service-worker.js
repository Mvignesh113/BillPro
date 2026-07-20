/**
 * service-worker.js — BillPro Offline-first caching
 */
const CACHE_NAME = 'billpro-v3';
const STATIC_ASSETS = [
  './index.html',
  './style.css',
  './app.js',
  './db.js',
  './manifest.json',
  './assets/icon-192.png',
  './assets/icon-512.png',
];

const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
];

/* ── Install: cache all static + CDN assets ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      // Cache static assets (must succeed)
      await cache.addAll(STATIC_ASSETS);
      // Cache CDN assets (best effort, don't fail install if offline)
      for (const url of CDN_ASSETS) {
        try {
          await cache.add(url);
        } catch (_) {
          // Offline during install — will cache on first fetch
        }
      }
    }).then(() => self.skipWaiting())
  );
});

/* ── Activate: remove old caches ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── Fetch: cache-first for assets, network-first for navigation ── */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET
  if (request.method !== 'GET') return;

  // Skip chrome-extension and non-http
  if (!url.protocol.startsWith('http')) return;

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request).then(response => {
        // Only cache valid responses
        if (!response || response.status !== 200 || response.type === 'error') {
          return response;
        }

        // Cache a clone
        const toCache = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          // Cache same-origin and known CDN assets
          if (
            url.origin === self.location.origin ||
            url.hostname === 'cdnjs.cloudflare.com' ||
            url.hostname === 'fonts.googleapis.com' ||
            url.hostname === 'fonts.gstatic.com'
          ) {
            cache.put(request, toCache);
          }
        });

        return response;
      }).catch(() => {
        // Offline fallback for navigation requests
        if (request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
