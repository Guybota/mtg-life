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
      name: name && name.trim() ? name.trim() : commander ? commander.name : (global.MTG && global.MTG.i18n ? global.MTG.i18n.t("Novo perfil") : "Novo perfil"),
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
  function recordGameResult(id, { won, gameTimeMs, turnTimeMs, turnsTaken, mode, timed, opponents }) {
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
      timed: timed !== false, // false = jogo sem contagem de tempo/turnos
      // adversários à mesa: [{ profileId, name, won }] (won = esse adversário
      // venceu / estava na equipa vencedora) — usado nos confrontos diretos
      opponents: Array.isArray(opponents) ? opponents : undefined,
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

  /** Repõe um perfil apagado (para o "Desfazer"), com o mesmo id. */
  function restore(profile) {
    if (!profile || !profile.id) return;
    const list = load().filter((p) => p.id !== profile.id);
    list.push(profile);
    persist(list);
  }

  /** Repõe um jogo apagado do histórico (para o "Desfazer") e volta a
   *  somar o seu contributo às stats agregadas. */
  function restoreGame(id, g) {
    const list = load();
    const p = list.find((x) => x.id === id);
    if (!p || !g) return null;
    if (!p.history) p.history = [];
    if (p.history.some((x) => x.id === g.id)) return p;
    p.history.push(g);
    p.stats.games += 1;
    if (g.won) p.stats.wins += 1;
    p.stats.totalGameTimeMs += g.gameTimeMs || 0;
    p.stats.totalTurnTimeMs += g.turnTimeMs || 0;
    p.stats.turnsTaken += g.turnsTaken || 0;
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

  /** Importa uma lista de perfis (de exportAll ou de uma cópia de
   *  segurança). Nunca substitui nem apaga um perfil existente: um perfil
   *  que já cá esteja (mesmo id) é ignorado, por isso restaurar a mesma
   *  cópia duas vezes não cria duplicados. Os outros mantêm o id original,
   *  para os confrontos diretos continuarem a apontar para eles.
   *  Devolve { added, skipped }. */
  function importList(profiles) {
    const res = { added: 0, skipped: 0 };
    if (!Array.isArray(profiles)) return res;
    const list = load();
    const ids = new Set(list.map((p) => p.id));
    profiles.forEach((p) => {
      if (!p || typeof p !== "object") return;
      if (p.id && ids.has(p.id)) { res.skipped++; return; }
      let clone;
      try {
        clone = JSON.parse(JSON.stringify(p));
      } catch (e) {
        return;
      }
      if (!clone.id) clone.id = uid();
      ids.add(clone.id);
      if (!clone.stats) clone.stats = { games: 0, wins: 0, totalGameTimeMs: 0, totalTurnTimeMs: 0, turnsTaken: 0 };
      if (!Array.isArray(clone.history)) clone.history = [];
      if (!clone.createdAt) clone.createdAt = Date.now();
      list.push(clone);
      res.added++;
    });
    if (res.added) persist(list);
    return res;
  }

  /** N.º de jogos diferentes registados (o mesmo jogo aparece no histórico
   *  de cada perfil que lá esteve; agrupa-se pela hora de registo). */
  function gameCount() {
    const seen = new Set();
    load().forEach((p) => (p.history || []).forEach((g) => seen.add(Math.round((g.date || 0) / 5000))));
    return seen.size;
  }

  global.MTG = global.MTG || {};
  global.MTG.Profiles = { all, get, create, update, remove, restore, recordGameResult, derived, historyOf, removeGame, restoreGame, exportAll, importList, gameCount };
})(window);
