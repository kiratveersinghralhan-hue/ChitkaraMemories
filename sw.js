// Offline shell for "install as app". Only caches this site's own files (never photos or Firebase data),
// always tries the network first so updates show up straight away.
const CACHE = "cm-shell-v3";
const SHELL = [
  "./", "index.html", "css/style.css",
  "js/config.js", "js/app.js", "js/store.js", "js/scene.js", "js/logo3d.js",
  "js/admin.js", "js/batch.js", "js/film.js", "js/share.js",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match("index.html"))),
  );
});
