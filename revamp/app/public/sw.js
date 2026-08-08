// Offline-first PWA: cache the shell; network-first for the catalog so
// search (the #1 use case) still works with no internet.
const SHELL = "shell-v4";
const SHELL_FILES = ["/", "/app.js", "/style.css", "/manifest.json", "/icon.svg"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== SHELL).map(k => caches.delete(k)))));
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.pathname.startsWith("/api/")) {
    if (url.pathname === "/api/books")
      e.respondWith(
        fetch(e.request)
          .then(res => {
            const copy = res.clone();
            caches.open("data").then(c => c.put(e.request, copy));
            return res;
          })
          .catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(
    caches.match(url.pathname === "/" || !url.pathname.includes(".") ? "/" : e.request)
      .then(hit => hit || fetch(e.request)));
});
