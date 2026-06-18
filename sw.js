const CACHE = "minhas-despesas-v2";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function networkFirst(request) {
  return fetch(request)
    .then((res) => {
      if (res && res.status === 200 && res.type === "basic") {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
      }
      return res;
    })
    .catch(() => caches.match(request));
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  if (e.request.method !== "GET") return;

  const path = url.pathname;
  const isCode =
    path.endsWith(".js") ||
    path.endsWith(".css") ||
    path.endsWith(".html") ||
    path.endsWith("/") ||
    path.endsWith("/expenses") ||
    path.endsWith("/expenses/");

  if (isCode) {
    e.respondWith(networkFirst(e.request));
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cached) => cached || networkFirst(e.request))
  );
});
