// Dot Trading Post's service worker. It does one thing: when a page can't load because the phone is
// offline, it shows a small "you're offline" page instead of the browser's error. Every other
// request goes straight to the network as if it weren't here, so the board is never stale. (Having
// one is also what lets Android offer to install the board as an app.)
const CACHE = "dtp-offline-1";
const OFFLINE = "/offline";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, "/favicon.svg"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE)));
});
