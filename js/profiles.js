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

  function create({ name, commander, playerName }) {
    const list = load();
    const profile = {
      id: uid(),
      name: name && name.trim() ? name.trim() : commander ? commander.name : "Novo perfil",
      playerName: playerName && playerName.trim() ? playerName.trim() : "",
      commander: commander || null,
      stats: { games: 0, wins: 0, totalGameTimeMs: 0, totalTurnTimeMs: 0, turnsTaken: 0 },
      history: [],
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

  /** Regista o resultado de um jogo terminado nas stats agregadas do perfil
   *  e acrescenta uma entrada ao histórico de jogos desse perfil. */
  function recordGameResult(id, { won, gameTimeMs, turnTimeMs, turnsTaken, mode }) {
    const list = load();
    const p = list.find((x) => x.id === id);
    if (!p) return null;
    if (!p.history) p.history = [];
    p.stats.games += 1;
    if (won) p.stats.wins += 1;
    p.stats.totalGameTimeMs += gameTimeMs || 0;
    p.stats.totalTurnTimeMs += turnTimeMs || 0;
    p.stats.turnsTaken += turnsTaken || 0;
    p.history.unshift({
      id: uid(),
      date: Date.now(),
      won: !!won,
      mode: mode || "standard",
      gameTimeMs: gameTimeMs || 0,
      turnTimeMs: turnTimeMs || 0,
      turnsTaken: turnsTaken || 0,
    });
    persist(list);
    return p;
  }

  /** Devolve o histórico de jogos de um perfil (mais recente primeiro). */
  function historyOf(id) {
    const p = get(id);
    if (!p || !p.history) return [];
    return p.history.slice().sort((a, b) => b.date - a.date);
  }

  /** Remove um jogo específico do histórico e desconta o seu contributo
   *  das stats agregadas do perfil. */
  function removeGame(id, gameId) {
    const list = load();
    const p = list.find((x) => x.id === id);
    if (!p || !p.history) return null;
    const idx = p.history.findIndex((g) => g.id === gameId);
    if (idx === -1) return null;
    const g = p.history[idx];
    p.history.splice(idx, 1);
    p.stats.games = Math.max(0, p.stats.games - 1);
    if (g.won) p.stats.wins = Math.max(0, p.stats.wins - 1);
    p.stats.totalGameTimeMs = Math.max(0, p.stats.totalGameTimeMs - (g.gameTimeMs || 0));
    p.stats.totalTurnTimeMs = Math.max(0, p.stats.totalTurnTimeMs - (g.turnTimeMs || 0));
    p.stats.turnsTaken = Math.max(0, p.stats.turnsTaken - (g.turnsTaken || 0));
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

  /** Devolve um JSON com TODOS os perfis (e o respetivo histórico/stats),
   *  pronto a guardar num ficheiro local. */
  function exportAll() {
    return JSON.stringify({ app: "mtg-life-counter", type: "profiles-export", version: 1, exportedAt: Date.now(), profiles: load() }, null, 2);
  }

  /** Importa uma lista de perfis (tipicamente vinda de exportAll noutro
   *  aparelho/browser). Cada perfil importado recebe sempre um id NOVO —
   *  nunca substitui nem faz merge com um perfil já existente, para nunca
   *  se perder dados por engano. Devolve quantos perfis foram importados. */
  function importList(profiles) {
    if (!Array.isArray(profiles)) return 0;
    const list = load();
    let count = 0;
    profiles.forEach((p) => {
      if (!p || typeof p !== "object") return;
      let clone;
      try {
        clone = JSON.parse(JSON.stringify(p));
      } catch (e) {
        return;
      }
      clone.id = uid();
      if (!clone.stats) clone.stats = { games: 0, wins: 0, totalGameTimeMs: 0, totalTurnTimeMs: 0, turnsTaken: 0 };
      if (!Array.isArray(clone.history)) clone.history = [];
      if (!clone.createdAt) clone.createdAt = Date.now();
      list.push(clone);
      count++;
    });
    if (count) persist(list);
    return count;
  }

  global.MTG = global.MTG || {};
  global.MTG.Profiles = { all, get, create, update, remove, recordGameResult, derived, historyOf, removeGame, exportAll, importList };
})(window);
