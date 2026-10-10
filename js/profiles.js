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

  // Quem quiser saber quando os perfis mudam (ex: a sincronização na nuvem).
  // Durante a própria sincronização os avisos ficam desligados.
  const listeners = [];
  let quiet = 0;
  function onChange(fn) { listeners.push(fn); }
  function changed() {
    if (quiet) return;
    listeners.forEach((fn) => { try { fn(); } catch (e) { /* ok */ } });
  }

  function persist(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
    } catch (e) {
      console.warn("Não foi possível guardar os perfis:", e);
    }
    changed();
  }

  // Registo do que foi apagado (perfis e jogos), para a sincronização não
  // os voltar a trazer de outro aparelho. { profiles: {id: ts}, games: {id: ts} }
  const DELETED_KEY = "mtg_lc_deleted_v1";
  function deleted() {
    try {
      const d = JSON.parse(localStorage.getItem(DELETED_KEY)) || {};
      return { profiles: d.profiles || {}, games: d.games || {} };
    } catch (e) {
      return { profiles: {}, games: {} };
    }
  }
  function saveDeleted(d) {
    try { localStorage.setItem(DELETED_KEY, JSON.stringify(d)); } catch (e) { /* ok */ }
  }
  function markDeleted(kind, ids, on) {
    const d = deleted();
    ids.forEach((id) => { if (!id) return; if (on) d[kind][id] = Date.now(); else delete d[kind][id]; });
    saveDeleted(d);
  }

  function all() {
    return load().sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Encontra um perfil pelo id ou por um id antigo (alcunha) — depois de
   *  fundir ou sincronizar, um deck pode ter mudado de id e ainda haver
   *  referências ao antigo (jogo em curso, "Repetir último jogo"...). */
  function byAnyId(list, id) {
    if (!id) return null;
    return list.find((p) => p.id === id) || list.find((p) => Array.isArray(p.aliases) && p.aliases.includes(id)) || null;
  }

  function get(id) {
    return byAnyId(load(), id);
  }

  function create({ name, commander, playerName, partnerCommander }) {
    const list = load();
    const profile = {
      id: uid(),
      name: name && name.trim() ? name.trim() : commander ? commander.name : (global.MTG && global.MTG.i18n ? global.MTG.i18n.t("Novo perfil") : "Novo perfil"),
      playerName: playerName && playerName.trim() ? canonicalPlayer(playerName.trim()) : "",
      commander: commander || null,
      partnerCommander: partnerCommander || undefined,
      stats: { games: 0, wins: 0, totalGameTimeMs: 0, totalTurnTimeMs: 0, turnsTaken: 0 },
      history: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    list.push(profile);
    persist(list);
    return profile;
  }

  function update(id, patch) {
    const list = load();
    const p = byAnyId(list, id);
    if (!p) return null;
    Object.assign(p, patch);
    p.updatedAt = Date.now(); // a edição mais recente ganha ao sincronizar
    persist(list);
    return p;
  }

  function remove(id) {
    const list = load();
    const p = byAnyId(list, id);
    if (!p) return;
    markDeleted("profiles", [p.id].concat(p.aliases || []), true);
    persist(list.filter((x) => x !== p));
  }

  /** Regista o resultado de um jogo terminado nas stats agregadas do perfil
   *  e acrescenta uma entrada ao histórico de jogos desse perfil. */
  function recordGameResult(id, { won, gameTimeMs, turnTimeMs, turnsTaken, mode, timed, opponents, pilot, commanderName, date, manual }) {
    const list = load();
    const p = byAnyId(list, id);
    if (!p) return null;
    // deck emprestado: quem jogou (nome escrito no lugar) não é o dono
    const who = pilot && String(pilot).trim() ? canonicalPlayer(String(pilot).trim()) : "";
    const playedBy = who && norm(who) !== norm(p.playerName) ? who : undefined;
    // commander usado neste jogo, quando não é o principal do deck
    const mainCmd = p.commander && p.commander.name ? p.commander.name + (p.partnerCommander && p.partnerCommander.name ? " + " + p.partnerCommander.name : "") : null;
    // guarda-se sempre (assim continua certo se o principal mudar depois)
    const cmdUsed = commanderName || mainCmd || undefined;
    if (!p.history) p.history = [];
    // jogo sem contagem de tempo: não entra nas médias de tempo
    if (timed === false) { gameTimeMs = 0; turnTimeMs = 0; }
    p.stats.games += 1;
    if (won) p.stats.wins += 1;
    p.stats.totalGameTimeMs += gameTimeMs || 0;
    p.stats.totalTurnTimeMs += turnTimeMs || 0;
    p.stats.turnsTaken += turnsTaken || 0;
    p.history.unshift({
      id: uid(),
      date: date || Date.now(),
      manual: manual ? true : undefined, // registado à mão (sem usar o contador)
      won: !!won,
      mode: mode || "standard",
      gameTimeMs: gameTimeMs || 0,
      turnTimeMs: turnTimeMs || 0,
      turnsTaken: turnsTaken || 0,
      timed: timed !== false, // false = jogo sem contagem de tempo/turnos
      // adversários à mesa: [{ profileId, name, won }] (won = esse adversário
      // venceu / estava na equipa vencedora) — usado nos confrontos diretos
      opponents: Array.isArray(opponents) ? opponents : undefined,
      playedBy,     // só quando o deck foi emprestado a outra pessoa
      commander: cmdUsed, // nome do commander com que se jogou (principal ou alternativo)
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
    const p = byAnyId(list, id);
    if (!p || !p.history) return null;
    const idx = p.history.findIndex((g) => g.id === gameId);
    if (idx === -1) return null;
    const g = p.history[idx];
    p.history.splice(idx, 1);
    markDeleted("games", [gameId], true);
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
    markDeleted("profiles", [profile.id].concat(profile.aliases || []), false);
    const list = load().filter((p) => p.id !== profile.id);
    list.push(profile);
    persist(list);
  }

  /** Repõe um jogo apagado do histórico (para o "Desfazer") e volta a
   *  somar o seu contributo às stats agregadas. */
  function restoreGame(id, g) {
    const list = load();
    const p = byAnyId(list, id);
    if (!p || !g) return null;
    if (!p.history) p.history = [];
    markDeleted("games", [g.id], false);
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
    // a média por jogo só conta os jogos com tempo contado
    const untimed = (profile.history || []).filter((g) => g.timed === false).length;
    const timedGames = Math.max(0, s.games - untimed);
    return {
      games: s.games,
      wins: s.wins,
      losses: Math.max(0, s.games - s.wins),
      winRate: s.games ? s.wins / s.games : 0,
      timedGames,
      avgGameTimeMs: timedGames ? s.totalGameTimeMs / timedGames : 0,
      avgTurnTimeMs: s.turnsTaken ? s.totalTurnTimeMs / s.turnsTaken : 0,
      totalGameTimeMs: s.totalGameTimeMs,
      totalTurnTimeMs: s.totalTurnTimeMs,
      turnsTaken: s.turnsTaken,
    };
  }

  /** Devolve um JSON com TODOS os perfis (e o respetivo histórico/stats),
   *  pronto a guardar num ficheiro local. */
  function exportAll() {
    return JSON.stringify({ app: "mtg-life-counter", type: "profiles-export", version: 1, exportedAt: Date.now(), profiles: load(), playerAliases: playerAliases() }, null, 2);
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

  // ---------------------------------------------------------
  // Fundir com os perfis de outro aparelho
  // ---------------------------------------------------------
  // Cada perfil guarda em `aliases` os ids que teve noutros aparelhos e
  // que já foram fundidos com ele. Assim, da próxima vez que se fundir
  // com o mesmo aparelho, o par é reconhecido sozinho. Cada jogo do
  // histórico tem um id próprio: um jogo que o perfil já tenha nunca é
  // somado outra vez, por isso fundir várias vezes não duplica nada.

  const norm = (x) => String(x || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const idsOf = (p) => [p.id].concat(Array.isArray(p.aliases) ? p.aliases : []);
  const cmdName = (p) => norm(p.commander && p.commander.name);

  /** Analisa os perfis recebidos sem gravar nada. Para cada um devolve
   *  { incoming, match, auto, newGames, dupGames }:
   *  - auto: já é o mesmo perfil (mesmo id ou fundido antes) → junta sempre;
   *  - match: perfil local sugerido (mesmo jogador e mesmo commander),
   *    ou null para entrar como perfil novo. */
  function mergePreview(incomingList) {
    const local = load();
    const byId = new Map();
    local.forEach((p) => idsOf(p).forEach((id) => byId.set(id, p)));
    const taken = new Set();
    const rows = [];
    (Array.isArray(incomingList) ? incomingList : []).forEach((inc) => {
      if (!inc || typeof inc !== "object" || !inc.id) return;
      let match = null;
      let auto = false;
      for (const id of idsOf(inc)) if (byId.has(id)) { match = byId.get(id); auto = true; break; }
      if (!match) {
        const pk = (p) => norm(canonicalPlayer(p.playerName)) + "|" + (cmdName(p) || norm(p.name));
        const key = pk(inc);
        match = local.find((p) => !taken.has(p.id) && pk(p) === key) || null;
      }
      if (match) taken.add(match.id);
      const have = new Set(match ? (match.history || []).map((g) => g.id) : []);
      const hist = Array.isArray(inc.history) ? inc.history : [];
      const newGames = hist.filter((g) => g && !have.has(g.id)).length;
      rows.push({ incoming: inc, match, auto, newGames, dupGames: hist.length - newGames });
    });
    return rows;
  }

  /** Aplica a fusão. `targets` é { idRecebido: idLocal | null } (null =
   *  entra como perfil novo). Devolve { profiles, games } acrescentados. */
  function applyMerge(incomingList, targets) {
    const list = load();
    const res = { profiles: 0, games: 0 };
    const incoming = (Array.isArray(incomingList) ? incomingList : []).filter((x) => x && x.id);
    // para onde vai cada id recebido (inclui aliases) — usado para
    // corrigir os adversários guardados nos jogos
    const remap = new Map();
    const plan = incoming.map((inc) => {
      const want = targets && Object.prototype.hasOwnProperty.call(targets, inc.id) ? targets[inc.id] : null;
      let dest = want ? list.find((p) => p.id === want) : null;
      if (!dest) dest = list.find((p) => p.id === inc.id) || null; // nunca dois perfis com o mesmo id
      const destId = dest ? dest.id : inc.id;
      idsOf(inc).forEach((id) => remap.set(id, destId));
      return { inc, dest };
    });
    const fixOpponents = (g) => {
      if (!Array.isArray(g.opponents)) return g;
      return Object.assign({}, g, { opponents: g.opponents.map((o) => (o && o.profileId && remap.has(o.profileId) ? Object.assign({}, o, { profileId: remap.get(o.profileId) }) : o)) });
    };
    plan.forEach(({ inc, dest }) => {
      let clone;
      try { clone = JSON.parse(JSON.stringify(inc)); } catch (e) { return; }
      const hist = (Array.isArray(clone.history) ? clone.history : []).filter((g) => g && g.id).map(fixOpponents);
      if (!dest) {
        clone.history = hist;
        if (clone.playerName) clone.playerName = canonicalPlayer(clone.playerName);
        if (!clone.stats) clone.stats = { games: 0, wins: 0, totalGameTimeMs: 0, totalTurnTimeMs: 0, turnsTaken: 0 };
        if (!clone.createdAt) clone.createdAt = Date.now();
        list.push(clone);
        res.profiles++;
        res.games += hist.length;
        return;
      }
      if (!dest.history) dest.history = [];
      const have = new Map(dest.history.map((g) => [g.id, g]));
      hist.forEach((g) => {
        if (have.has(g.id)) { takeNewerGameEdit(have.get(g.id), g, dest); return; }
        have.set(g.id, g);
        dest.history.push(g);
        dest.stats.games += 1;
        if (g.won) dest.stats.wins += 1;
        dest.stats.totalGameTimeMs += g.gameTimeMs || 0;
        dest.stats.totalTurnTimeMs += g.turnTimeMs || 0;
        dest.stats.turnsTaken += g.turnsTaken || 0;
        res.games++;
      });
      const al = new Set(dest.aliases || []);
      idsOf(inc).forEach((id) => { if (id !== dest.id) al.add(id); });
      if (al.size) dest.aliases = Array.from(al);
      if (!dest.commander && clone.commander) { dest.commander = clone.commander; dest.partnerCommander = clone.partnerCommander; }
      if (!dest.playerName && clone.playerName) dest.playerName = clone.playerName;
      joinAltCommanders(dest, clone);
    });
    // jogos que já cá estavam também podem citar ids do outro aparelho
    list.forEach((p) => { if (p.history) p.history = p.history.map(fixOpponents); });
    persist(list);
    return res;
  }

  // Campos de um jogo que se podem corrigir depois (ao trocar o dono ou o
  // commander principal). A correção mais recente (editedAt) ganha.
  const GAME_EDITABLE = ["playedBy", "commander", "won", "timed", "gameTimeMs", "turnTimeMs", "opponents"];
  /** Acerta as stats agregadas de um perfil quando um jogo muda de `before`
   *  para `after` (vitória e tempos). */
  function adjustStats(p, before, after) {
    if (!p || !p.stats) return;
    p.stats.wins = Math.max(0, p.stats.wins + (after.won ? 1 : 0) - (before.won ? 1 : 0));
    p.stats.totalGameTimeMs = Math.max(0, p.stats.totalGameTimeMs + (after.gameTimeMs || 0) - (before.gameTimeMs || 0));
    p.stats.totalTurnTimeMs = Math.max(0, p.stats.totalTurnTimeMs + (after.turnTimeMs || 0) - (before.turnTimeMs || 0));
  }
  /** Aplica a `local` (jogo do perfil `p`) a correção de `remote` se esta
   *  for mais recente. Devolve true se mudou alguma coisa. */
  function takeNewerGameEdit(local, remote, p) {
    if (!local || !remote || (remote.editedAt || 0) <= (local.editedAt || 0)) return false;
    const before = Object.assign({}, local);
    GAME_EDITABLE.forEach((k) => { if (remote[k] !== undefined) local[k] = JSON.parse(JSON.stringify(remote[k])); else delete local[k]; });
    local.editedAt = remote.editedAt;
    adjustStats(p, before, local);
    return true;
  }

  /** Todas as entradas de um jogo (uma por deck que esteve à mesa), a
   *  partir de uma delas: os decks adversários guardados nesse jogo e,
   *  no histórico de cada um, o registo do mesmo modo a segundos deste.
   *  Devolve [{ profile, game }] (o próprio primeiro) ou []. */
  function gameGroup(profileId, gameId, listArg) {
    const list = listArg || load();
    const self = byAnyId(list, profileId);
    const g = self && (self.history || []).find((x) => x.id === gameId);
    if (!g) return [];
    const out = [{ profile: self, game: g }];
    const seen = new Set([self.id]);
    (g.opponents || []).forEach((o) => {
      const op = o && o.profileId ? byAnyId(list, o.profileId) : null;
      if (!op || seen.has(op.id)) return;
      const match = (op.history || []).filter((x) => (x.mode || "standard") === (g.mode || "standard") && Math.abs((x.date || 0) - (g.date || 0)) <= 15000)
        .sort((a, b) => Math.abs(a.date - g.date) - Math.abs(b.date - g.date))[0];
      if (match) { out.push({ profile: op, game: match }); seen.add(op.id); }
    });
    return out;
  }

  /** Corrige um jogo em todos os decks onde ficou registado.
   *  edit = { timed, gameTimeMs, winner: chave do lugar vencedor (id do perfil
   *  ou "guest:<nome>") ou null, seats: [{ profileId, gameId, pilot, commander }],
   *  guests: [nomes] }. Acerta as stats e marca a correção (editedAt) para
   *  chegar aos outros aparelhos. */
  function editGame(edit) {
    const list = load();
    const now = Date.now();
    const seats = (edit.seats || []).map((s) => {
      const p = byAnyId(list, s.profileId);
      const g = p && (p.history || []).find((x) => x.id === s.gameId);
      return p && g ? { p, g, s } : null;
    }).filter(Boolean);
    const keyOf = (x) => x.p.id;
    const pilotOf = (x) => {
      const who = (x.s.pilot || "").trim();
      return who ? canonicalPlayer(who) : (x.p.playerName || "").trim();
    };
    seats.forEach((x) => {
      const before = Object.assign({}, x.g);
      const who = (x.s.pilot || "").trim() ? canonicalPlayer(x.s.pilot.trim()) : "";
      x.g.won = edit.winner === keyOf(x);
      if (who && norm(who) !== norm(x.p.playerName)) x.g.playedBy = who; else delete x.g.playedBy;
      if (x.s.commander) x.g.commander = x.s.commander;
      x.g.timed = edit.timed !== false;
      x.g.gameTimeMs = x.g.timed ? Math.max(0, Math.round(edit.gameTimeMs || 0)) : 0;
      if (!x.g.timed) x.g.turnTimeMs = 0;
      x.g.opponents = seats.filter((o) => o !== x).map((o) => ({ profileId: o.p.id, name: pilotOf(o) || o.p.name, pilot: pilotOf(o) || undefined, won: edit.winner === keyOf(o) }))
        .concat((edit.guests || []).map((n) => ({ profileId: null, name: n, pilot: n, won: edit.winner === "guest:" + n })));
      x.g.editedAt = now;
      adjustStats(x.p, before, x.g);
    });
    persist(list);
    return seats.length;
  }

  const cmdLabelOf = (p) => (p && p.commander && p.commander.name ? p.commander.name + (p.partnerCommander && p.partnerCommander.name ? " + " + p.partnerCommander.name : "") : undefined);

  /** Todos os jogos, juntando os registos de cada deck que esteve à mesa
   *  (mesmo modo, a segundos uns dos outros). Mais recente primeiro.
   *  Cada jogo: { date, mode, seats: [{ profile, game }], guests: [{ name, won }] }
   *  — guests são os lugares sem deck registado (só um nome). */
  function gamesList() {
    const list = load();
    const entries = [];
    list.forEach((p) => (p.history || []).forEach((g) => { if (g && g.id) entries.push({ profile: p, game: g }); }));
    entries.sort((a, b) => (a.game.date || 0) - (b.game.date || 0));
    const games = [];
    let cur = null;
    entries.forEach((e) => {
      const mode = e.game.mode || "standard";
      const fits = cur && cur.mode === mode && (e.game.date || 0) - cur.start <= 15000 && !cur.seats.some((x) => x.profile.id === e.profile.id);
      if (!fits) { cur = { date: e.game.date, start: e.game.date, mode, seats: [] }; games.push(cur); }
      cur.seats.push(e);
    });
    games.forEach((G) => {
      const ids = new Set(G.seats.map((x) => x.profile.id));
      const first = G.seats[0].game;
      G.guests = (first.opponents || []).filter((o) => o && !(o.profileId && ids.has(o.profileId))).map((o) => {
        const op = o.profileId ? byAnyId(list, o.profileId) : null;
        return { name: (o.pilot || o.name || (op && (op.playerName || op.name)) || "").trim(), won: !!o.won };
      }).filter((x) => x.name);
    });
    return games.reverse();
  }

  /** Liga o lugar de um convidado (sem deck) de um jogo a um deck — novo ou
   *  já existente: o jogo passa a constar também do histórico desse deck e
   *  os outros decks do jogo passam a apontar para ele como adversário.
   *  Devolve { ok } ou { error: "same" | "missing" }. */
  function attachGuest(refProfileId, refGameId, guestName, targetId) {
    const list = load();
    const group = gameGroup(refProfileId, refGameId, list);
    const target = byAnyId(list, targetId);
    if (!group.length || !target) return { error: "missing" };
    if (group.some((x) => x.profile.id === target.id)) return { error: "same" };
    const base = group[0].game;
    const isGuest = (o) => o && !(o.profileId && group.some((x) => x.profile.id === o.profileId)) && norm(o.pilot || o.name) === norm(guestName);
    const guest = (base.opponents || []).find(isGuest);
    if (!guest) return { error: "missing" };
    const pilot = (x) => (x.game.playedBy || x.profile.playerName || x.profile.name || "").trim();
    const timed = base.timed !== false;
    const who = canonicalPlayer(guestName.trim());
    const entry = {
      id: uid(),
      date: (base.date || Date.now()) + 1,
      won: !!guest.won,
      mode: base.mode || "standard",
      gameTimeMs: timed ? base.gameTimeMs || 0 : 0,
      turnTimeMs: 0,
      turnsTaken: 0,
      timed,
      manual: base.manual ? true : undefined,
      playedBy: norm(who) !== norm(target.playerName) ? who : undefined,
      commander: cmdLabelOf(target),
      opponents: group.map((x) => ({ profileId: x.profile.id, name: pilot(x), pilot: pilot(x), won: !!x.game.won }))
        .concat((base.opponents || []).filter((o) => o !== guest && !(o.profileId && group.some((x) => x.profile.id === o.profileId)))),
    };
    if (!target.history) target.history = [];
    target.history.push(entry);
    target.stats.games += 1;
    if (entry.won) target.stats.wins += 1;
    target.stats.totalGameTimeMs += entry.gameTimeMs;
    // nos outros decks do jogo, o adversário passa a ser este deck
    const now = Date.now();
    group.forEach((x) => {
      (x.game.opponents || []).forEach((o) => { if (isGuest(o)) { o.profileId = target.id; o.pilot = o.pilot || who; } });
      x.game.editedAt = now;
    });
    persist(list);
    return { ok: true };
  }

  /** Regista à mão um jogo que não foi jogado no contador.
   *  game = { date, mode, timed, gameTimeMs, winner (índice do lugar ou -1),
   *  seats: [{ profileId | null, name, commander }] }. Lugares sem deck
   *  entram só como adversários. Devolve o n.º de decks atualizados. */
  function recordManualGame(game) {
    const winSeat = (game.seats || [])[game.winner] || null;
    const seats = (game.seats || []).filter((s) => s && (s.profileId || (s.name || "").trim()));
    const timed = game.timed === true;
    const date = game.date || Date.now();
    const used = new Set();
    let n = 0;
    seats.forEach((s) => {
      if (!s.profileId || used.has(s.profileId)) return;
      used.add(s.profileId);
      const res = recordGameResult(s.profileId, {
        won: s === winSeat,
        gameTimeMs: timed ? game.gameTimeMs : 0,
        turnTimeMs: 0,
        turnsTaken: 0,
        mode: game.mode || "commander",
        timed,
        date: date + n, // mesmo jogo: os registos ficam a milissegundos uns dos outros
        manual: true,
        pilot: s.name,
        commanderName: s.commander && s.commander.name,
        opponents: seats.filter((o) => o !== s).map((o) => ({ profileId: o.profileId || null, name: (o.name || "").trim() || null, pilot: (o.name || "").trim() || undefined, won: o === winSeat })),
      });
      if (res) n++;
    });
    return n;
  }

  /** Junta os commanders alternativos de `src` aos de `dst` (sem repetir
   *  nem incluir o principal de `dst`). */
  function joinAltCommanders(dst, src) {
    // cada opção é um commander com o seu parceiro (opcional); compara-se o par
    const label = (c, p) => norm(c && c.name) + "+" + norm(p && p.name);
    const names = new Set([label(dst.commander, dst.partnerCommander)].concat((dst.altCommanders || []).map((c) => label(c, c && c.partner))));
    const srcMain = src.commander ? Object.assign({}, src.commander, src.partnerCommander ? { partner: src.partnerCommander } : {}) : null;
    const extra = [srcMain].concat(src.altCommanders || []).filter((c) => c && c.name && !names.has(label(c, c.partner)) && names.add(label(c, c.partner)));
    // o principal de src só entra como alternativo se dst já tiver um principal diferente
    if (extra.length) dst.altCommanders = (dst.altCommanders || []).concat(extra);
  }

  // ---------------------------------------------------------
  // Alcunhas de jogadores e fusão de decks/jogadores neste aparelho
  // ---------------------------------------------------------
  // `mtg_lc_player_aliases_v1` guarda { nomeNormalizado: nomeQueFica }.
  // Depois de fundir "Zé" em "José", um perfil novo criado com "Zé" fica
  // logo como "José", e as fusões com outros aparelhos também os ligam.
  const ALIAS_KEY = "mtg_lc_player_aliases_v1";

  function playerAliases() {
    try { return JSON.parse(localStorage.getItem(ALIAS_KEY)) || {}; } catch (e) { return {}; }
  }
  function savePlayerAliases(map) {
    try { localStorage.setItem(ALIAS_KEY, JSON.stringify(map)); } catch (e) {}
  }
  /** Nome "oficial" de um jogador (resolve alcunhas). */
  function canonicalPlayer(name) {
    const n = norm(name);
    if (!n) return name || "";
    return playerAliases()[n] || name;
  }
  /** Junta alcunhas vindas de outro aparelho, sem estragar as locais. */
  function addPlayerAliases(map) {
    if (!map || typeof map !== "object") return;
    const cur = playerAliases();
    Object.keys(map).forEach((k) => { if (!cur[k] && typeof map[k] === "string" && norm(map[k]) !== k) cur[k] = map[k]; });
    savePlayerAliases(cur);
  }

  /** Funde o deck `sourceId` no deck `targetId`: os jogos e stats passam
   *  para o destino, os adversários guardados noutros jogos passam a
   *  apontar para ele e o deck de origem deixa de existir. Jogos com o
   *  mesmo id não são somados duas vezes. Devolve { games } ou null. */
  function mergeProfiles(sourceId, targetId) {
    const list = load();
    const src = list.find((p) => p.id === sourceId);
    const dst = list.find((p) => p.id === targetId);
    if (!src || !dst || src === dst) return null;
    if (!dst.history) dst.history = [];
    const have = new Set(dst.history.map((g) => g.id));
    // soma as stats todas (podem incluir jogos antigos sem histórico) e
    // desconta só os jogos que o destino já tinha
    ["games", "wins", "totalGameTimeMs", "totalTurnTimeMs", "turnsTaken"].forEach((k) => { dst.stats[k] = (dst.stats[k] || 0) + ((src.stats && src.stats[k]) || 0); });
    let added = 0;
    (src.history || []).forEach((g) => {
      if (have.has(g.id)) {
        dst.stats.games -= 1;
        if (g.won) dst.stats.wins -= 1;
        dst.stats.totalGameTimeMs -= g.gameTimeMs || 0;
        dst.stats.totalTurnTimeMs -= g.turnTimeMs || 0;
        dst.stats.turnsTaken -= g.turnsTaken || 0;
        return;
      }
      have.add(g.id);
      dst.history.push(g);
      added++;
    });
    const al = new Set(dst.aliases || []);
    idsOf(src).forEach((id) => { if (id !== dst.id) al.add(id); });
    dst.aliases = Array.from(al);
    if (!dst.commander && src.commander) { dst.commander = src.commander; dst.partnerCommander = src.partnerCommander; }
    if (!dst.playerName && src.playerName) dst.playerName = src.playerName;
    joinAltCommanders(dst, src);
    const out = list.filter((p) => p !== src);
    out.forEach((p) => (p.history || []).forEach((g) => (g.opponents || []).forEach((o) => { if (o && o.profileId === src.id) o.profileId = dst.id; })));
    persist(out);
    return { games: added };
  }

  /** Funde o jogador `fromName` em `toName`: todos os decks de um passam
   *  a ser do outro, os nomes guardados nos jogos são corrigidos e fica
   *  registada a alcunha. Devolve o n.º de decks alterados. */
  function mergePlayers(fromName, toName) {
    const from = norm(fromName);
    const to = String(toName || "").trim();
    if (!from || !to || from === norm(to)) return 0;
    const list = load();
    let n = 0;
    list.forEach((p) => {
      if (norm(p.playerName) === from) { p.playerName = to; p.updatedAt = Date.now(); n++; }
      (p.history || []).forEach((g) => {
        (g.opponents || []).forEach((o) => {
          if (o && norm(o.name) === from) o.name = to;
          if (o && norm(o.pilot) === from) o.pilot = to;
        });
        if (g.playedBy && norm(g.playedBy) === from) g.playedBy = to;
        // depois da fusão pode ter passado a ser o próprio dono
        if (g.playedBy && norm(g.playedBy) === norm(p.playerName)) delete g.playedBy;
      });
    });
    persist(list);
    const al = playerAliases();
    al[from] = to;
    Object.keys(al).forEach((k) => { if (norm(al[k]) === from) al[k] = to; });
    delete al[norm(to)]; // o nome que fica nunca é alcunha de outro
    savePlayerAliases(al);
    return n;
  }

  // ---------------------------------------------------------
  // Sincronização na nuvem (grupo partilhado)
  // ---------------------------------------------------------
  /** O que se envia para o grupo: perfis, apagados e alcunhas. */
  function syncPayload() {
    return { app: "mtg-life-counter", v: 1, profiles: load(), deleted: deleted(), playerAliases: playerAliases() };
  }

  const SYNC_META = ["name", "playerName", "commander", "partnerCommander", "altCommanders", "colorIdx"];

  /** Junta os dados do grupo com os deste aparelho, sem duplicar nada:
   *  - apagados de um lado ficam apagados dos dois (perfis e jogos);
   *  - perfis já ligados (mesmo id ou alcunha de id) juntam-se sozinhos e
   *    recebem os jogos que faltam; o nome/commander mais recente ganha;
   *  - perfis que este aparelho não conhece entram como novos.
   *  Não sugere pares parecidos (isso só na primeira entrada no grupo).
   *  Devolve { profiles, games, removed } com o que mudou cá. */
  function syncMerge(remote) {
    const res = { profiles: 0, games: 0, removed: 0 };
    if (!remote || typeof remote !== "object") return res;
    quiet++;
    try {
      // 1) apagados: união dos dois lados
      const d = deleted();
      const rd = remote.deleted || {};
      ["profiles", "games"].forEach((k) => Object.keys(rd[k] || {}).forEach((id) => { if (!d[k][id]) d[k][id] = rd[k][id]; }));
      saveDeleted(d);
      addPlayerAliases(remote.playerAliases);

      const list = load();
      const isDeadProfile = (p) => idsOf(p).some((id) => d.profiles[id]);
      const byId = new Map();
      list.forEach((p) => idsOf(p).forEach((id) => byId.set(id, p)));
      const remap = new Map();

      // 2) perfis do grupo
      (Array.isArray(remote.profiles) ? remote.profiles : []).forEach((rp) => {
        if (!rp || !rp.id || isDeadProfile(rp)) return;
        let lp = null;
        for (const id of idsOf(rp)) if (byId.has(id)) { lp = byId.get(id); break; }
        const hist = (Array.isArray(rp.history) ? rp.history : []).filter((g) => g && g.id && !d.games[g.id]);
        if (!lp) {
          let clone;
          try { clone = JSON.parse(JSON.stringify(rp)); } catch (e) { return; }
          // fica com o histórico todo: os jogos apagados saem no passo 3,
          // que também os desconta nas stats
          clone.history = (Array.isArray(clone.history) ? clone.history : []).filter((g) => g && g.id);
          if (!clone.stats) clone.stats = { games: 0, wins: 0, totalGameTimeMs: 0, totalTurnTimeMs: 0, turnsTaken: 0 };
          list.push(clone);
          idsOf(clone).forEach((id) => byId.set(id, clone));
          res.profiles++;
          res.games += hist.length;
          return;
        }
        if (!lp.history) lp.history = [];
        const have = new Map(lp.history.map((g) => [g.id, g]));
        hist.forEach((g) => {
          if (have.has(g.id)) { if (takeNewerGameEdit(have.get(g.id), g, lp)) res.games++; return; }
          const copy = JSON.parse(JSON.stringify(g));
          have.set(g.id, copy);
          lp.history.push(copy);
          lp.stats.games += 1;
          if (g.won) lp.stats.wins += 1;
          lp.stats.totalGameTimeMs += g.gameTimeMs || 0;
          lp.stats.totalTurnTimeMs += g.turnTimeMs || 0;
          lp.stats.turnsTaken += g.turnsTaken || 0;
          res.games++;
        });
        // nome/jogador/commander: ganha a edição mais recente; em empate (ex:
        // perfis antigos sem data) ganha sempre o mesmo lado em todos os
        // aparelhos, para todos ficarem iguais
        const ru = rp.updatedAt || 0, lu = lp.updatedAt || 0;
        const metaKey = (p) => JSON.stringify(SYNC_META.map((k) => (p[k] === undefined ? null : p[k])));
        if (ru > lu || (ru === lu && metaKey(rp) > metaKey(lp))) {
          SYNC_META.forEach((k) => { if (k in rp) lp[k] = rp[k]; else delete lp[k]; });
          if (rp.updatedAt) lp.updatedAt = rp.updatedAt;
        }
        // o mesmo deck fica com o mesmo id em todos os aparelhos (o menor de
        // todos os que já teve); os outros ficam como alcunhas. Sem isto cada
        // aparelho guardava-o com o seu id e regravavam o grupo à vez.
        // data de criação: fica a mais antiga (igual em todos os aparelhos)
        if (rp.createdAt && (!lp.createdAt || rp.createdAt < lp.createdAt)) lp.createdAt = rp.createdAt;
        const allIds = Array.from(new Set(idsOf(lp).concat(idsOf(rp)))).sort();
        lp.id = allIds[0];
        const rest = allIds.slice(1);
        if (rest.length) lp.aliases = rest; else delete lp.aliases;
        allIds.forEach((id) => byId.set(id, lp));
      });
      list.forEach((p) => idsOf(p).forEach((id) => remap.set(id, p.id)));

      // 3) aplicar os apagados cá (perfis e jogos), descontando nas stats
      let out = list.filter((p) => {
        if (isDeadProfile(p)) { res.removed++; return false; }
        return true;
      });
      out.forEach((p) => {
        if (!p.history) return;
        p.history = p.history.filter((g) => {
          if (!d.games[g.id]) return true;
          p.stats.games = Math.max(0, p.stats.games - 1);
          if (g.won) p.stats.wins = Math.max(0, p.stats.wins - 1);
          p.stats.totalGameTimeMs = Math.max(0, p.stats.totalGameTimeMs - (g.gameTimeMs || 0));
          p.stats.totalTurnTimeMs = Math.max(0, p.stats.totalTurnTimeMs - (g.turnTimeMs || 0));
          p.stats.turnsTaken = Math.max(0, p.stats.turnsTaken - (g.turnsTaken || 0));
          res.removed++;
          return false;
        });
        // adversários guardados nos jogos passam a apontar para os ids locais
        p.history.forEach((g) => (g.opponents || []).forEach((o) => { if (o && o.profileId && remap.has(o.profileId)) o.profileId = remap.get(o.profileId); }));
      });
      persist(out);
    } finally {
      quiet--;
    }
    return res;
  }

  /** Apaga TODOS os perfis, jogos, apagados e alcunhas deste aparelho,
   *  para começar de novo (ex: importar de um ficheiro ou da nuvem).
   *  Devolve uma cópia para "Desfazer" (restoreAll). */
  function resetAll() {
    const backup = {};
    [KEY, DELETED_KEY, ALIAS_KEY].forEach((k) => { backup[k] = localStorage.getItem(k); });
    quiet++;
    try { [KEY, DELETED_KEY, ALIAS_KEY].forEach((k) => localStorage.removeItem(k)); } finally { quiet--; }
    return backup;
  }
  function restoreAll(backup) {
    if (!backup) return;
    Object.keys(backup).forEach((k) => { if (backup[k] == null) localStorage.removeItem(k); else localStorage.setItem(k, backup[k]); });
    changed();
  }

  /** Cópia de tudo o que uma fusão pode mudar (para "Desfazer"). */
  function snapshot() { return { profiles: load(), aliases: playerAliases() }; }
  function replaceAll(snap) {
    if (Array.isArray(snap)) { persist(snap); return; }
    if (snap && Array.isArray(snap.profiles)) persist(snap.profiles);
    if (snap && snap.aliases) savePlayerAliases(snap.aliases);
  }

  /** N.º de jogos diferentes registados (o mesmo jogo aparece no histórico
   *  de cada perfil que lá esteve; agrupa-se pela hora de registo). */
  function gameCount() {
    const seen = new Set();
    load().forEach((p) => (p.history || []).forEach((g) => seen.add(Math.round((g.date || 0) / 5000))));
    return seen.size;
  }

  global.MTG = global.MTG || {};
  global.MTG.Profiles = { resetAll, restoreAll, gamesList, attachGuest, gameGroup, editGame, recordManualGame, all, get, create, update, remove, restore, recordGameResult, derived, historyOf, removeGame, restoreGame, exportAll, importList, gameCount, mergePreview, applyMerge, snapshot, replaceAll, mergeProfiles, mergePlayers, playerAliases, canonicalPlayer, addPlayerAliases, onChange, deleted, syncPayload, syncMerge };
})(window);
