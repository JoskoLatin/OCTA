/* ═══════════════════════════════════════════════════════════════════════
   OCTA — service worker

   Minimal offline support so the app installs to an Android home screen
   and runs with no network. Strategy: cache-first for our own files.

   Bump CACHE_VERSION whenever you change any precached file, otherwise
   phones will keep serving the old copy from cache.
   ═══════════════════════════════════════════════════════════════════════ */

const CACHE_VERSION = 'octa-v5';

const PRECACHE = [
  './',
  './index.html',
  './style.css',
  './audio.js',
  './sequencer.js',
  './ui.js',
  './manifest.json',
  './icon.svg',
  './favicon.svg',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // addAll is atomic — one 404 fails the whole install, so add each
      // file individually and tolerate misses (e.g. icons not generated yet).
      .then(cache => Promise.all(
        PRECACHE.map(url => cache.add(url).catch(err => console.warn('Skipped', url, err)))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  // Leave cross-origin requests alone.
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        // Cache successful same-origin responses for next time.
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(req, copy));
        }
        return res;
      }).catch(() => {
        // Offline and uncached: fall back to the shell for navigations.
        if (req.mode === 'navigate') return caches.match('./index.html');
        throw new Error('offline');
      });
    })
  );
});
