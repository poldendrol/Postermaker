// Network first so updates show up right away; falls back to the cached copy when offline.
const CACHE = "marquee-v14";
const SHELL = ["./", "index.html", "friends.js", "lite.js", "club.js", "firebase-config.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request).then(m => m || caches.match("index.html"))));
});

// Push messages from the optional Friends server function.
self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Marquee", body: e.data && e.data.text() }; }
  const n = d.data || d.notification || d;
  e.waitUntil(self.registration.showNotification(n.title || "Marquee", { body: n.body || "", icon: "icon-192.png", badge: "icon-192.png", data: { url: n.url || "./?view=friends" } }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./?view=friends", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => {
    const c = cs.find(x => x.url.startsWith(self.registration.scope));
    if (c) { c.focus(); return c.navigate ? c.navigate(url) : null; }
    return self.clients.openWindow(url);
  }));
});
