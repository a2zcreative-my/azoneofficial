/* Minimal service worker (v1.4.49): enables the install prompt and keeps the
   app shell reachable. Network-first — live data is never served stale. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request).then((r) => r || Response.error()))
  );
});
