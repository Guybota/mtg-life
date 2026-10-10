/* Service worker — cache do "app shell" para funcionar offline depois
   da primeira visita. As chamadas à Scryfall API (pesquisa de cartas)
   seguem sempre para a rede; as imagens das cartas (cards.scryfall.io)
   ficam guardadas numa cache própria para as artes dos perfis
   aparecerem também sem rede. */
const CACHE = "mtg-life-counter-v58";
const ART_CACHE = "mtg-life-art-v1";   // não muda com as versões da app
const ART_MAX = 200;                   // n.º máximo de imagens guardadas
const NET_TIMEOUT_MS = 3000;           // rede fraca: usa a cache ao fim disto

const SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/i18n.js",
  "./js/icons.js",
  "./js/mana.js",
  "./js/charts.js",
  "./js/scryfall.js",
  "./js/profiles.js",
  "./js/elo.js",
  "./js/badges.js",
  "./js/state.js",
  "./js/qrsync.js",
  "./js/cloudsync.js",
  "./js/vendor/qrcode.min.js",
  "./js/vendor/jsQR.min.js",
  "./js/ui/core.js",
  "./js/ui/data.js",
  "./js/ui/pickers.js",
  "./js/ui/game-standard.js",
  "./js/ui/game-br.js",
  "./js/ui/game-teams.js",
  "./js/ui/endgame.js",
  "./js/ui/profiles-ui.js",
  "./js/ui/games-edit.js",
  "./js/ui/main.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  "./icons/favicon.svg",
  "./icons/icon.svg",
  "./assets/te_toca.mp3",
  "./assets/fonts/inter-latin.woff2",
  "./assets/fonts/inter-latin-ext.woff2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // "reload" evita guardar cópias antigas vindas da cache HTTP do browser
      .then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE && k !== ART_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Rede primeiro (para receber atualizações), mas sem ficar à espera de uma
// rede lenta: ao fim de NET_TIMEOUT_MS responde com a cópia guardada, se
// existir, e a resposta da rede continua a atualizar a cache em fundo.
function networkFirst(request) {
  const network = fetch(request).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
    }
    return res;
  });
  const cached = () => caches.match(request, { ignoreSearch: true });
  const timeout = new Promise((resolve) => setTimeout(resolve, NET_TIMEOUT_MS)).then(cached);
  return Promise.race([network, timeout.then((r) => r || network)])
    .then((r) => r || network)
    .catch(() => cached().then((r) => r || caches.match("./index.html")));
}

async function trimArt(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - ART_MAX; i++) await cache.delete(keys[i]);
}

// Imagens das cartas: não mudam, por isso cache primeiro.
async function artCacheFirst(request) {
  const cache = await caches.open(ART_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  // pedidos de <img>/background-image chegam "opaque" (status 0); também servem
  if (res.ok || res.type === "opaque") {
    cache.put(request, res.clone()).then(() => trimArt(cache)).catch(() => {});
  }
  return res;
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.hostname === "cards.scryfall.io") {
    event.respondWith(artCacheFirst(event.request));
    return;
  }
  // nunca intercetar outros domínios (ex: api.scryfall.com)
  if (url.origin !== self.location.origin) return;
  event.respondWith(networkFirst(event.request));
});
