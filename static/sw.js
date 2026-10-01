/* Service worker: guarda apenas arquivos estáticos e a página offline.
   Páginas autenticadas e fotos NUNCA são armazenadas em cache. */
const CACHE = "checklist-static-v1";
const ARQUIVOS = [
  "/offline",
  "/static/css/app.css",
  "/static/js/app.js",
  "/static/icons/icon.svg",
  "/static/icons/icon-192.png",
  "/static/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ARQUIVOS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((chaves) => Promise.all(chaves.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/static/")) {
    // stale-while-revalidate
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(req).then((emCache) => {
          const rede = fetch(req)
            .then((resp) => {
              if (resp.ok) cache.put(req, resp.clone());
              return resp;
            })
            .catch(() => emCache);
          return emCache || rede;
        })
      )
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/offline")));
  }
});
