// A service worker that takes the real one out of use. If the worker ever
// has to go, deploy this file in place of the built /sw.js (for example,
// copy it over dist/sw.js before the image is built). nginx serves /sw.js
// with no-cache, so every browser that had the old worker picks this one up
// at its next visit. It removes the caches of the app, unregisters itself and
// reloads the open tabs, which then run without a worker, straight from the
// network.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('notes-shell-')) await caches.delete(name);
      }
      await self.registration.unregister();
      for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
    })(),
  );
});
