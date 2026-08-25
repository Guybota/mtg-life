/* ===========================================================
   profiles.js — perfis de commander persistidos (stats agregadas
   entre jogos: nº de jogos, vitórias, tempo médio, tempo total...)
   =========================================================== */
(function (global) {
  const KEY = "mtg_lc_profiles_v1";

  function uid() {
    return "prof_" + Math.random().toString(36).slice(2, 10);
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function persist(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
    } catch (e) {
      console.warn("Não foi possível guardar os perfis:", e);
    }
  }

  function all() {
    return load().sort((a, b) => b.createdAt - a.createdAt);
  }

  function get(id) {
    return load().find((p) => p.id === id) || null;
  }

  function create({ name, commander }) {
    const list = load();
    const profile = {
      id: uid(),
      name: name && name.trim() ? name.trim() : commander ? commander.name : "Novo perfil",
      commander: commander || null,
      stats: { games: 0, wins: 0, totalGameTimeMs: 0, totalTurnTimeMs: 0, turnsTaken: 0 },
      createdAt: Date.now(),
    };
    list.push(profile);
    persist(list);
    return profile;
  }

  function update(id, patch) {
    const list = load();
    const p = list.find((x) => x.id === id);
    if (!p) return null;
    Object.assign(p, patch);
    persist(list);
    return p;
  }

  function remove(id) {
    persist(load().filter((p) => p.id !== id));
  }

  /** Regista o resultado de um jogo terminado nas stats agregadas do perfil. */
  function recordGameResult(id, { won, gameTimeMs, turnTimeMs, turnsTaken }) {
    const list = load();
    const p = list.find((x) => x.id === id);
    if (!p) return null;
    p.stats.games += 1;
    if (won) p.stats.wins += 1;
    p.stats.totalGameTimeMs += gameTimeMs || 0;
    p.stats.totalTurnTimeMs += turnTimeMs || 0;
    p.stats.turnsTaken += turnsTaken || 0;
    persist(list);
    return p;
  }

  /** Métricas derivadas prontas a mostrar na UI. */
  function derived(profile) {
    const s = profile.stats;
    return {
      games: s.games,
      wins: s.wins,
      losses: Math.max(0, s.games - s.wins),
      winRate: s.games ? s.wins / s.games : 0,
      avgGameTimeMs: s.games ? s.totalGameTimeMs / s.games : 0,
      avgTurnTimeMs: s.turnsTaken ? s.totalTurnTimeMs / s.turnsTaken : 0,
      totalGameTimeMs: s.totalGameTimeMs,
      totalTurnTimeMs: s.totalTurnTimeMs,
      turnsTaken: s.turnsTaken,
    };
  }

  global.MTG = global.MTG || {};
  global.MTG.Profiles = { all, get, create, update, remove, recordGameResult, derived };
})(window);
