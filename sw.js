const CACHE_NAME = "nova-cache-v5";
const APP_SHELL = [
  "/nova/",
  "/nova/index.html",
  "/nova/login.html",
  "/nova/panel.html",
  "/nova/style.css",
  "/nova/script.js",
  "/nova/panel.js",
  "/nova/enhancements.js",
  "/nova/interactions.js",
  "/nova/mobile-menu.js",
  "/nova/manifest.webmanifest",
  "/nova/app-icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = event.request.url;
  // Не перехватываем динамические и бинарные ресурсы
  if (url.includes(".log") || url.includes("/api/") || url.includes("?_=")) return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match("/nova/index.html"));
    })
  );
});
