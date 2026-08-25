/* ===========================================================
   Scryfall.js — pesquisa de commanders e extração de arte
   API pública, gratuita, sem chave: https://scryfall.com/docs/api
   =========================================================== */
(function (global) {
  const API_BASE = "https://api.scryfall.com";
  const CACHE_KEY = "mtg_lc_scryfall_cache_v1";
  const MIN_INTERVAL_MS = 120; // boa prática Scryfall: espaçar pedidos

  let lastRequestAt = 0;
  let cache = null;

  function loadCache() {
    if (cache) return cache;
    try {
      cache = JSON.parse(localStorage.getItem(CACHE_KEY)) || {};
    } catch (e) {
      cache = {};
    }
    return cache;
  }

  function saveCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
      /* localStorage cheio ou indisponível — ignora silenciosamente */
    }
  }

  async function throttledFetch(url) {
    const now = Date.now();
    const wait = Math.max(0, lastRequestAt + MIN_INTERVAL_MS - now);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    return res;
  }

  /**
   * Extrai a melhor imagem disponível de um card Scryfall,
   * incluindo cartas de dupla face (ex.: commanders "transform"/"modal_dfc").
   */
  function getArt(card, size) {
    size = size || "art_crop"; // art_crop = ótimo para background (sem margens)
    if (!card) return null;
    if (card.image_uris) {
      return card.image_uris[size] || card.image_uris.normal || card.image_uris.large || null;
    }
    if (Array.isArray(card.card_faces) && card.card_faces[0] && card.card_faces[0].image_uris) {
      const f = card.card_faces[0].image_uris;
      return f[size] || f.normal || f.large || null;
    }
    return null;
  }

  function normalizeCard(card) {
    return {
      id: card.id,
      name: card.name,
      typeLine: card.type_line || (card.card_faces && card.card_faces[0].type_line) || "",
      art: getArt(card, "art_crop"),
      artNormal: getArt(card, "normal"),
      set: card.set,
      colorIdentity: card.color_identity || [],
    };
  }

  /**
   * Pesquisa cartas elegíveis a Commander (is:commander) que
   * correspondam ao texto introduzido. Devolve até 12 resultados
   * já normalizados com a arte extraída.
   */
  async function searchCommanders(query, opts) {
    opts = opts || {};
    const q = (query || "").trim();
    if (q.length < 2) return [];

    const c = loadCache();
    const cacheKey = "search:" + q.toLowerCase();
    if (c[cacheKey] && Date.now() - c[cacheKey].t < 1000 * 60 * 60 * 24) {
      return c[cacheKey].data;
    }

    // is:commander cobre lendárias + cartas com "can be your commander"
    const scryQuery = `is:commander (${q}*  or  ${q})`;
    const url = `${API_BASE}/cards/search?order=edhrec&unique=cards&q=${encodeURIComponent(
      `is:commander ${q}`
    )}`;

    try {
      const res = await throttledFetch(url);
      if (res.status === 404) {
        // Scryfall devolve 404 quando não há resultados
        c[cacheKey] = { t: Date.now(), data: [] };
        saveCache();
        return [];
      }
      if (!res.ok) throw new Error("Scryfall respondeu " + res.status);
      const json = await res.json();
      const data = (json.data || []).slice(0, 12).map(normalizeCard);
      c[cacheKey] = { t: Date.now(), data };
      saveCache();
      return data;
    } catch (err) {
      console.warn("[Scryfall] falha na pesquisa:", err);
      throw err;
    }
  }

  /**
   * Pesquisa livre (não filtrada a is:commander) — usada no modo
   * Livre caso o utilizador queira pôr qualquer carta como fundo.
   */
  async function searchAnyCard(query) {
    const q = (query || "").trim();
    if (q.length < 2) return [];
    const c = loadCache();
    const cacheKey = "any:" + q.toLowerCase();
    if (c[cacheKey] && Date.now() - c[cacheKey].t < 1000 * 60 * 60 * 24) {
      return c[cacheKey].data;
    }
    const url = `${API_BASE}/cards/search?order=edhrec&unique=cards&q=${encodeURIComponent(q)}`;
    try {
      const res = await throttledFetch(url);
      if (res.status === 404) {
        c[cacheKey] = { t: Date.now(), data: [] };
        saveCache();
        return [];
      }
      if (!res.ok) throw new Error("Scryfall respondeu " + res.status);
      const json = await res.json();
      const data = (json.data || []).slice(0, 12).map(normalizeCard);
      c[cacheKey] = { t: Date.now(), data };
      saveCache();
      return data;
    } catch (err) {
      console.warn("[Scryfall] falha na pesquisa livre:", err);
      throw err;
    }
  }

  global.MTG = global.MTG || {};
  global.MTG.Scryfall = { searchCommanders, searchAnyCard, getArt, normalizeCard };
})(window);
