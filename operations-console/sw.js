const CACHE_NAME = 'medialab-ops-v2';
const ASSETS_TO_CACHE = [
  './poc.html',
  '../css/global.css',
  '../css/components.css',
  './manifest.json',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never cache Netlify functions, Firebase APIs, or any sensitive API endpoints
  if (
    url.pathname.startsWith('/.netlify/functions/') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('firebase') ||
    url.hostname.includes('aryeo.com') ||
    url.hostname.includes('openrouteservice.org') ||
    event.request.method !== 'GET'
  ) {
    return; // Let the browser handle these normally
  }

  // Network First, fallback to cache for UI assets
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
