/* Service worker — cache do "app shell" para funcionar offline depois
   da primeira visita. As chamadas à Scryfall API (rede) não são
   interceptadas: seguem sempre para a rede normalmente. */
const CACHE = "mtg-life-counter-v2";
const SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/scryfall.js",
  "./js/profiles.js",
  "./js/state.js",
  "./js/app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./assets/te_toca.mp3",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // nunca intercetar pedidos a outros domínios (ex: api.scryfall.com, cards.scryfall.io)
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(event.request).then((r) => r || caches.match("./index.html")))
  );
});
