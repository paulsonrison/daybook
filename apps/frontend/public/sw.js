import { clear } from '/pwa/database.js';
// Only public, explicitly listed app-shell files enter Cache Storage.
const VERSION = 'daybook-shell-db1b064d4321e42a';
const FILES = [
  '/field.html',
  '/pwa/field.js',
  '/pwa/database.js',
  '/pwa/field.css',
  '/pwa/shared.css',
  '/pwa/inter.woff2',
  '/pwa/brand.svg',
  '/pwa/icon-192.png',
  '/pwa/icon-512.png',
];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FILES)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith('daybook-shell-') && key !== VERSION)
          await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});
async function broadcast(type) {
  for (const client of await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  }))
    client.postMessage({ type });
}
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (
    event.request.method === 'POST' &&
    ['/api/auth/login', '/api/auth/register', '/api/auth/logout'].includes(
      url.pathname,
    )
  ) {
    event.respondWith(
      (async () => {
        const response = await fetch(event.request);
        if (response.ok) {
          // Lock every visible tab before any fallible device cleanup.
          await broadcast('DAYBOOK_ACCOUNT_CHANGED');
          if (url.pathname.endsWith('/logout')) {
            try {
              await clear();
            } catch {
              await broadcast('DAYBOOK_DEVICE_CLEANUP_FAILED');
            }
          }
        }
        return response;
      })(),
    );
    return;
  }
  if (event.request.method !== 'GET') return;
  if (FILES.includes(url.pathname) && !url.search) {
    event.respondWith(
      caches
        .open(VERSION)
        .then(
          async (cache) =>
            (await cache.match(url.pathname)) ?? fetch(event.request),
        ),
    );
    return;
  }
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.open(VERSION).then((cache) => cache.match('/field.html')),
      ),
    );
  }
});
