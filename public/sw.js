/* AZ ONE OFFICIAL service worker (v1.6.0)
   - Installable PWA + offline app shell (network-first; cache is the fallback).
   - Live data (/api/*) is NEVER cached.
   - Web push: shows the notification and focuses/open the portal on click. */

const SHELL = "azone-shell-v16";
const SHELL_URLS = ["/portal", "/account", "/login", "/logo.png", "/icon-192.png", "/manifest.json"];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_URLS).catch(() => {})));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))),
  ]));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) return; // never serve API data stale
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && (req.mode === "navigate" || SHELL_URLS.includes(url.pathname))) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match("/portal")))
  );
});

self.addEventListener("push", (event) => {
  let data = { title: "AZ ONE OFFICIAL", body: "You have a new notification", url: "/portal", ref: undefined };
  try { if (event.data) data = Object.assign(data, event.data.json()); } catch (_) { /* plain text */ }
  event.waitUntil(
    self.registration.showNotification(data.title || "AZ ONE OFFICIAL", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: data.url || "/portal" },
      tag: data.ref || undefined,
      renotify: !!data.ref,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/portal";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
      for (const c of cs) {
        if (c.url.includes(target) && "focus" in c) return c.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});
