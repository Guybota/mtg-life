/* ===========================================================
   elo.js — classificação ELO de jogadores e decks, calculada a partir
   do histórico dos perfis (não guarda nada: é sempre recalculada, por
   isso fica igual em todos os aparelhos do mesmo grupo).

   Jogos com vários jogadores (Commander) contam como confrontos de dois:
   quem ganha "vence" cada adversário que perdeu. Cada confronto vale
   K·(1 − esperado)/(n − 1), com o esperado pela fórmula ELO normal —
   ganhar a quem tem mais pontos dá mais, perder com quem tem menos tira
   mais. Todos começam em 1500. Jogos sem vencedor não contam.

   O mesmo jogo aparece no histórico de cada deck que lá esteve; as
   entradas são juntadas pelo modo e pela hora a que o jogo terminou.
   =========================================================== */
(function (global) {
  const START = 1500;
  const K = 32;
  const SAME_GAME_MS = 15000; // entradas do mesmo jogo ficam a segundos umas das outras
  const PROVISIONAL = 5;      // até aqui: "em calibração"

  const TIERS = [
    { key: "bronze", min: -Infinity },
    { key: "silver", min: 1440 },
    { key: "gold", min: 1490 },
    { key: "platinum", min: 1540 },
    { key: "diamond", min: 1600 },
  ];
  function tierOf(rating, games) {
    if (games < PROVISIONAL) return "provisional";
    let t = TIERS[0].key;
    TIERS.forEach((x) => { if (rating >= x.min) t = x.key; });
    return t;
  }

  const norm = (x) => String(x || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  /** Reconstrói os jogos a partir dos históricos dos perfis.
   *  Devolve [{ date, mode, seats: [{ profileId, deck, playerKey, playerName, won }] }]. */
  function gamesFrom(profiles) {
    const entries = [];
    profiles.forEach((p) => (p.history || []).forEach((g) => {
      if (!g || !g.date) return;
      entries.push({
        date: g.date, mode: g.mode || "standard", won: !!g.won,
        profileId: p.id, deck: p.name,
        playerName: (p.playerName || "").trim(), playerKey: norm(p.playerName),
      });
    }));
    entries.sort((a, b) => a.date - b.date);
    const games = [];
    let cur = null;
    entries.forEach((e) => {
      const fits = cur && cur.mode === e.mode && e.date - cur.start <= SAME_GAME_MS && !cur.seats.some((s) => s.profileId === e.profileId);
      if (!fits) { cur = { date: e.date, start: e.date, mode: e.mode, seats: [] }; games.push(cur); }
      cur.seats.push(e);
      cur.date = e.date;
    });
    return games;
  }

  /** Aplica um jogo a um conjunto de classificações (Map chave → registo). */
  function applyGame(table, game, keyOf, labelOf) {
    // um lugar por chave (ex: a mesma pessoa não conta duas vezes)
    const seen = new Map();
    game.seats.forEach((s) => { const k = keyOf(s); if (k && !seen.has(k)) seen.set(k, s); });
    const seats = Array.from(seen.entries());
    if (seats.length < 2) return false;
    const winners = seats.filter(([, s]) => s.won);
    const losers = seats.filter(([, s]) => !s.won);
    if (!winners.length || !losers.length) return false; // sem vencedor (ou todos "ganharam")
    seats.forEach(([k, s]) => {
      if (!table.has(k)) table.set(k, { key: k, name: labelOf(s), rating: START, games: 0, wins: 0, delta: 0, series: [{ date: game.date, rating: START }] });
    });
    const before = new Map(seats.map(([k]) => [k, table.get(k).rating]));
    const change = new Map(seats.map(([k]) => [k, 0]));
    const n = seats.length;
    winners.forEach(([wk]) => losers.forEach(([lk]) => {
      const expected = 1 / (1 + Math.pow(10, (before.get(lk) - before.get(wk)) / 400));
      const d = (K * (1 - expected)) / (n - 1);
      change.set(wk, change.get(wk) + d);
      change.set(lk, change.get(lk) - d);
    }));
    seats.forEach(([k, s]) => {
      const r = table.get(k);
      r.rating += change.get(k);
      r.delta = change.get(k);
      r.games += 1;
      if (s.won) r.wins += 1;
      r.name = labelOf(s) || r.name;
      r.lastDate = game.date;
      r.series.push({ date: game.date, rating: r.rating });
    });
    return true;
  }

  /** Calcula tudo. Devolve { players: [...], decks: [...], games } com
   *  cada registo { key, name, rating, games, wins, delta, tier, rank, series }. */
  function compute(profiles) {
    const games = gamesFrom(profiles || []);
    const players = new Map();
    const decks = new Map();
    let rated = 0;
    games.forEach((g) => {
      applyGame(players, g, (s) => s.playerKey || null, (s) => s.playerName);
      if (applyGame(decks, g, (s) => s.profileId, (s) => s.deck)) rated++;
    });
    const finish = (map) => Array.from(map.values())
      .map((r) => Object.assign(r, { rating: Math.round(r.rating), delta: Math.round(r.delta), tier: tierOf(r.rating, r.games) }))
      .sort((a, b) => (b.games >= PROVISIONAL) - (a.games >= PROVISIONAL) || b.rating - a.rating || b.games - a.games)
      .map((r, i) => Object.assign(r, { rank: i + 1 }));
    return { players: finish(players), decks: finish(decks), games: rated };
  }

  global.MTG = global.MTG || {};
  global.MTG.Elo = { compute, gamesFrom, tierOf, START, K, PROVISIONAL, TIERS };
})(typeof window !== "undefined" ? window : globalThis);
