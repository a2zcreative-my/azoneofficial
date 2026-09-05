/* A2Z CREATIVE MARKETING service worker (v1.6.0)
   - Installable PWA + offline app shell (network-first; cache is the fallback).
   - Live data (/api/*) is NEVER cached.
   - Web push: shows the notification and focuses/open the portal on click. */

/* v1.27.0 — v16 -> v17 is a DELIBERATE bump: every installed shell still
   holds pages that say AZ ONE OFFICIAL, and `activate` deletes any key that
   is not the current one. Bumping evicts those stale shells on the first
   visit after this deploy. The `azone-` prefix is load-bearing (it is not a
   brand string — it is what the eviction filter and our debugging tooling
   look for), so it stays. */
/* v1.105.0 (roadmap phase 03) - v32: a push now deep-links to its tab
   (/portal?tab=Leave), and an open portal window is NAVIGATED there rather
   than matched by substring and missed. Bumped so every installed shell picks
   up the new click handler on its next visit. */
const SHELL = "azone-shell-v32";
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
  let data = { title: "A2Z CREATIVE MARKETING", body: "You have a new notification", url: "/portal", ref: undefined };
  try { if (event.data) data = Object.assign(data, event.data.json()); } catch (_) { /* plain text */ }
  event.waitUntil(
    self.registration.showNotification(data.title || "A2Z CREATIVE MARKETING", {
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
      /* An open portal window is reused: focus it and send it to the tab the
         notification is about. Matching by pathname, not substring - the
         target now carries ?tab= and the open window usually does not. */
      let want;
      try { want = new URL(target, self.location.origin); } catch (_) { want = null; }
      for (const c of cs) {
        let have;
        try { have = new URL(c.url); } catch (_) { continue; }
        if (want && have.origin === want.origin && have.pathname === want.pathname && "focus" in c) {
          return c.focus().then((w) => (w && "navigate" in w && want.search ? w.navigate(want.href).catch(() => w) : w));
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
