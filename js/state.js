/* ===========================================================
   state.js — motor de estado do jogo (persistido em localStorage)
   =========================================================== */
(function (global) {
  const STORAGE_KEY = "mtg_lc_game_v2";
  const tr = global.MTG.i18n.t;

  function uid() {
    return "p_" + Math.random().toString(36).slice(2, 10);
  }

  // Cores de fundo (pastel) sorteadas para jogadores sem commander escolhido
  // (sem arte de fundo). Cada entrada é [corClara, corEscura] para um gradiente.
  const FALLBACK_PALETTE = [
    ["#f8d3c6", "#f2bba9"], // coral
    ["#cfe0f5", "#b6cfee"], // azul
    ["#cdebd8", "#b3dfc4"], // menta
    ["#d7dcf5", "#c0c8ef"], // índigo
    ["#f8e8b5", "#f1db95"], // manteiga
    ["#fbe0c2", "#f6cc9f"], // damasco
    ["#c9ece8", "#ade0da"], // água
    ["#e1eec4", "#cfe3a6"], // lima
  ];

  /** Garante que todos os jogadores sem arte de commander têm uma cor de
   *  fundo sorteada e que não há duas repetidas entre eles. Mantém a cor já
   *  atribuída a quem já tinha (só reatribui quando falta ou há colisão). */
  function ensureFallbackColors(players) {
    if (!players) return;
    const needColor = players.filter((p) => !(p.commander && p.commander.art));
    const used = new Set();
    needColor.forEach((p) => {
      if (typeof p.fallbackColorIdx === "number" && !used.has(p.fallbackColorIdx)) {
        used.add(p.fallbackColorIdx);
      } else {
        p.fallbackColorIdx = undefined;
      }
    });
    const pool = FALLBACK_PALETTE.map((_, i) => i).filter((i) => !used.has(i));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    needColor.forEach((p) => {
      if (typeof p.fallbackColorIdx !== "number") {
        p.fallbackColorIdx = pool.length ? pool.shift() : Math.floor(Math.random() * FALLBACK_PALETTE.length);
      }
    });
    players.forEach((p) => {
      if (p.commander && p.commander.art) p.fallbackColorIdx = undefined;
    });
  }

  /** Regista uma alteração de vida no histórico ao vivo do jogo (mostrado no
   *  botão "Histórico" do tabuleiro) — guarda CADA alteração individual
   *  (não só a diferença total acumulada), já com o contexto de que
   *  turno/ronda era e de quem era a vez nesse momento. turnEntity/
   *  targetEntity podem ser um jogador OU uma equipa (só precisam de
   *  id/name). */
  /** Regista de quem é cada turno (para o gráfico de vida no fim). */
  function logTurn(modeState, entity) {
    if (!modeState.turnLog) modeState.turnLog = [];
    modeState.turnLog.push({ seq: modeState.turnSeq || 1, round: modeState.roundNumber || 1, id: entity ? entity.id : null, name: entity ? entity.name : "" });
    if (modeState.turnLog.length > 1000) modeState.turnLog.splice(0, modeState.turnLog.length - 1000);
  }

  /** Vida de cada jogador/equipa no fim de cada turno, para o gráfico do
   *  ecrã de resultado. values[0] = início do jogo, values[i] = fim do
   *  turno i. Parte da vida final e anda para trás pelo histórico de
   *  alterações, por isso acaba sempre na vida real de cada um. */
  function lifeTimeline(modeState, entities) {
    const n = Math.max(1, modeState.turnSeq || 1);
    const log = modeState.lifeLog || [];
    const info = {};
    (modeState.turnLog || []).forEach((t) => { info[t.seq] = t; });
    log.forEach((e) => { if (!info[e.turnSeq]) info[e.turnSeq] = { seq: e.turnSeq, round: e.roundNumber, name: e.turnName }; });
    const turns = [];
    for (let i = 1; i <= n; i++) turns.push(info[i] ? { round: info[i].round || null, name: info[i].name || "" } : { round: null, name: "" });
    const series = entities.map((en) => {
      const byTurn = {};
      log.forEach((e) => { if (e.targetId === en.id) byTurn[e.turnSeq] = (byTurn[e.turnSeq] || 0) + e.delta; });
      const values = new Array(n + 1);
      let life = en.life;
      values[n] = life;
      for (let i = n; i >= 1; i--) { life -= byTurn[i] || 0; values[i - 1] = life; }
      return { id: en.id, name: en.name, values };
    });
    return { turns, series };
  }

  function logLifeChange(modeState, turnEntity, targetEntity, delta) {
    if (!delta) return;
    if (!modeState.lifeLog) modeState.lifeLog = [];
    modeState.lifeLog.push({
      id: uid(),
      ts: Date.now(),
      turnSeq: modeState.turnSeq != null ? modeState.turnSeq : (modeState.globalTurnCount || 0),
      roundNumber: modeState.roundNumber || 1,
      turnName: turnEntity ? turnEntity.name : "-",
      targetId: targetEntity.id,
      targetName: targetEntity.name,
      delta,
    });
    // limite generoso para não fazer crescer o localStorage indefinidamente
    // em jogos muito longos — mantém sempre as 500 alterações mais recentes.
    if (modeState.lifeLog.length > 500) modeState.lifeLog.splice(0, modeState.lifeLog.length - 500);
  }

  function save(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("Não foi possível guardar o estado do jogo:", e);
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function clear() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
  }

  // ---------------------------------------------------------
  // MODO "STANDARD" (Commander padrão / Duelo 1v1 / Livre)
  // ---------------------------------------------------------
  function createStandardGame({ playerCount, startLife, commanderDamageEnabled, presetName, trackTurns, poisonEnabled }) {
    const players = [];
    for (let i = 0; i < playerCount; i++) {
      players.push({
        id: uid(),
        name: tr("Jogador {n}", { n: i + 1 }),
        commander: null,
        partnerCommander: null, // commander parceiro opcional (regra Partner)
        life: startLife,
        cmdDamage: {}, // { [opponentPlayerId]: number, [opponentPlayerId + "::partner"]: number }
        cmdTax: 0, // nº de vezes que o commander principal já foi conjurado da zona de comando
        partnerCmdTax: 0, // idem, para o commander parceiro
        eliminated: false,
        protected: false, // mantido em jogo apesar de "eliminado" por uma carta (Platinum Angel, etc.)
        poison: 0,
        profileId: null,
        turnTimeMs: 0,
        turnsTaken: 0,
      });
    }
    const now = Date.now();
    const state = {
      mode: "standard",
      presetName: presetName || "commander",
      createdAt: now,
      standard: {
        startLife,
        commanderDamageEnabled: !!commanderDamageEnabled,
        poisonEnabled: !!poisonEnabled, // contadores de veneno (10 elimina)
        // false = jogo "livre de relógio": sem turnos, rondas nem cronómetros
        trackTurns: trackTurns !== false,
        players,
        turnOrder: players.map((p) => p.id),
        currentTurnIndex: 0,
        roundStartIndex: 0, // índice (em turnOrder) de quem começou a ronda/jogo atual
        roundNumber: 1,
        turnSeq: 1,
        lifeLog: [],
        gameStartedAt: now,
        turnStartedAt: now,
        paused: false,
        pausedAt: null,
        ended: false,
        endedAt: null,
        winnerId: null,
        profilesApplied: false,
      },
    };
    save(state);
    return state;
  }

  /** Recalcula a eliminação automática de um jogador: 0 ou menos vidas,
   *  21+ de dano de um commander, ou 10+ contadores de veneno. Enquanto
   *  "protegido" (Platinum Angel/Worship em jogo) fica suspensa — só muda
   *  por ação explícita. */
  function stdRecomputeEliminated(p) {
    if (p.protected) return;
    const anyLethalCmd = Object.values(p.cmdDamage || {}).some((v) => v >= 21);
    p.eliminated = p.life <= 0 || anyLethalCmd || (p.poison || 0) >= 10;
  }

  function stdAdjustLife(state, playerId, delta) {
    const p = state.standard.players.find((x) => x.id === playerId);
    if (!p) return state;
    p.life += delta;
    stdRecomputeEliminated(p);
    logLifeChange(state.standard, stdCurrentPlayer(state), p, delta);
    save(state);
    return state;
  }

  /** source: "main" (default) ou "partner" — para trackear o dano de cada
   *  commander de um par de Partners separadamente (cada um mata aos 21). */
  function stdAdjustCmdDamage(state, playerId, fromId, delta, source) {
    const p = state.standard.players.find((x) => x.id === playerId);
    if (!p) return state;
    const key = source === "partner" ? fromId + "::partner" : fromId;
    const cur = p.cmdDamage[key] || 0;
    const next = Math.max(0, cur + delta);
    const applied = next - cur; // 0 quando já estava a 0 e se tenta tirar
    if (!applied) return state;
    p.cmdDamage[key] = next;
    // dano de commander também reduz a vida normal, como nas regras
    // oficiais, e fica no histórico de vida como qualquer outra alteração
    p.life -= applied;
    stdRecomputeEliminated(p);
    logLifeChange(state.standard, stdCurrentPlayer(state), p, -applied);
    save(state);
    return state;
  }

  /** Contadores de veneno (10 = eliminado). */
  function stdAdjustPoison(state, playerId, delta) {
    const p = state.standard.players.find((x) => x.id === playerId);
    if (!p) return state;
    p.poison = Math.max(0, (p.poison || 0) + delta);
    stdRecomputeEliminated(p);
    save(state);
    return state;
  }

  // ---------------------------------------------------------
  // Contadores extra e estado da mesa (só aparecem quando usados)
  // ---------------------------------------------------------
  /** Contadores simples por jogador (não eliminam): energia, experiência,
   *  tesouros, rad. */
  const PLAYER_COUNTERS = ["energy", "experience", "treasure", "rad"];
  function stdAdjustCounter(state, playerId, key, delta) {
    const p = state.standard.players.find((x) => x.id === playerId);
    if (!p || !PLAYER_COUNTERS.includes(key)) return state;
    if (!p.counters) p.counters = {};
    p.counters[key] = Math.max(0, (p.counters[key] || 0) + delta);
    if (!p.counters[key]) delete p.counters[key];
    save(state);
    return state;
  }
  function stdToggleBlessing(state, playerId) {
    const p = state.standard.players.find((x) => x.id === playerId);
    if (!p) return state;
    p.blessing = !p.blessing;
    save(state);
    return state;
  }
  /** Monarca / iniciativa: só um jogador de cada vez (null = ninguém). */
  function stdSetMonarch(state, playerId) {
    state.standard.monarchId = playerId || null;
    save(state);
    return state;
  }
  function stdSetInitiative(state, playerId) {
    state.standard.initiativeId = playerId || null;
    save(state);
    return state;
  }
  /** Dia/noite: null (ainda não começou), "day" ou "night". */
  function stdSetDayNight(state, value) {
    state.standard.dayNight = value === "day" || value === "night" ? value : null;
    save(state);
    return state;
  }

  /** Mudar a vida de vários jogadores de uma vez (fica no histórico como
   *  alterações normais). Eliminados ficam de fora.
   *  - "opponents": cada adversário perde n;
   *  - "all": toda a mesa perde n (incluindo quem usa);
   *  - "drain": cada adversário perde n e quem usa ganha o total perdido.
   *  Devolve quantos jogadores foram afetados. */
  function stdGroupLife(state, sourceId, mode, n) {
    const std = state.standard;
    const amount = Math.max(0, Math.round(n || 0));
    if (!amount) return 0;
    const alive = std.players.filter((p) => !p.eliminated);
    const targets = mode === "all" ? alive : alive.filter((p) => p.id !== sourceId);
    targets.forEach((p) => stdAdjustLife(state, p.id, -amount));
    if (mode === "drain" && targets.length) stdAdjustLife(state, sourceId, amount * targets.length);
    return targets.length;
  }

  /** Commander tax: cada vez que o jogador conjura o commander (principal ou
   *  parceiro) da zona de comando, o custo sobe {2}. source: "main"|"partner". */
  function stdAdjustCmdTax(state, playerId, delta, source) {
    const p = state.standard.players.find((x) => x.id === playerId);
    if (!p) return state;
    const field = source === "partner" ? "partnerCmdTax" : "cmdTax";
    p[field] = Math.max(0, (p[field] || 0) + delta);
    save(state);
    return state;
  }

  function stdToggleEliminated(state, playerId) {
    const p = state.standard.players.find((x) => x.id === playerId);
    if (!p) return state;
    p.eliminated = !p.eliminated;
    p.protected = false; // um toggle manual substitui qualquer estado de proteção pendente
    save(state);
    return state;
  }

  /** Guarda de eliminação: para cartas como Platinum Angel / Worship que
   *  evitam a eliminação mesmo a 0 (ou menos) vidas / 21+ commander damage.
   *  protectedVal=true → mantém o jogador em jogo (eliminated=false).
   *  protectedVal=false → a carta saiu do campo, volta a eliminá-lo agora. */
  function stdSetProtected(state, playerId, protectedVal) {
    const p = state.standard.players.find((x) => x.id === playerId);
    if (!p) return state;
    p.protected = !!protectedVal;
    p.eliminated = !protectedVal;
    save(state);
    return state;
  }

  function stdSetCommander(state, playerId, commander) {
    const p = state.standard.players.find((x) => x.id === playerId);
    if (!p) return state;
    p.commander = commander;
    ensureFallbackColors(state.standard.players);
    save(state);
    return state;
  }

  /** Nota: o dano de commander do parceiro de "playerId" fica registado no
   *  cmdDamage de CADA OPONENTE, na chave `${playerId}::partner`. Se o
   *  parceiro for removido, essas entradas ficam simplesmente sem badge
   *  visível (deixam de ser mostradas), mas não são apagadas — a vida já
   *  perdida por causa desse dano mantém-se, como nas regras reais.
   */
  function stdSetPartnerCommander(state, playerId, commander) {
    const p = state.standard.players.find((x) => x.id === playerId);
    if (!p) return state;
    p.partnerCommander = commander;
    save(state);
    return state;
  }

  function stdSetName(state, playerId, name) {
    const p = state.standard.players.find((x) => x.id === playerId);
    if (!p) return state;
    p.name = name;
    save(state);
    return state;
  }

  function stdSetProfile(state, playerId, profileId) {
    const p = state.standard.players.find((x) => x.id === playerId);
    if (!p) return state;
    p.profileId = profileId;
    save(state);
    return state;
  }

  function stdCurrentPlayer(state) {
    const std = state.standard;
    if (!std.turnOrder) return null;
    const id = std.turnOrder[std.currentTurnIndex];
    return std.players.find((p) => p.id === id) || null;
  }

  function stdNextAliveIndex(state, fromIndex) {
    const order = state.standard.turnOrder;
    for (let step = 1; step <= order.length; step++) {
      const idx = (fromIndex + step) % order.length;
      const p = state.standard.players.find((x) => x.id === order[idx]);
      if (p && !p.eliminated) return idx;
    }
    return fromIndex;
  }

  /** Passa o turno: acumula o tempo do jogador atual e toca a vez ao próximo vivo.
   *  A ronda só sobe quando a vez volta a dar a quem começou a ronda/jogo
   *  (roundStartIndex) — não a cada turno individual. */
  function stdPassTurn(state) {
    const std = state.standard;
    if (!std || std.ended || std.paused) return state;
    const now = Date.now();
    const cur = stdCurrentPlayer(state);
    if (cur) {
      cur.turnTimeMs += now - std.turnStartedAt;
      cur.turnsTaken += 1;
    }
    std.currentTurnIndex = stdNextAliveIndex(state, std.currentTurnIndex);
    std.turnStartedAt = now;
    std.turnSeq = (std.turnSeq || 1) + 1;
    if (std.currentTurnIndex === (std.roundStartIndex || 0)) {
      std.roundNumber = (std.roundNumber || 1) + 1;
    }
    logTurn(std, stdCurrentPlayer(state));
    save(state);
    return state;
  }

  /** Define quem começa o jogo (escolha manual ou resultado do dado),
   *  reiniciando o relógio do jogo/turno a partir de agora. */
  function stdSetStartingPlayer(state, playerId) {
    const std = state.standard;
    const idx = std.turnOrder.indexOf(playerId);
    if (idx === -1) return state;
    const now = Date.now();
    std.currentTurnIndex = idx;
    std.roundStartIndex = idx;
    std.roundNumber = 1;
    std.turnSeq = 1;
    std.lifeLog = [];
    std.turnLog = [];
    std.turnStartedAt = now;
    std.gameStartedAt = now;
    std.paused = false;
    std.pausedAt = null;
    logTurn(std, stdCurrentPlayer(state));
    save(state);
    return state;
  }

  /** Pausa/retoma os relógios de turno e de jogo. Ao retomar, desloca as
   *  referências de tempo pelo tempo em pausa, para o tempo pausado não
   *  contar para a duração do turno/jogo. */
  function stdTogglePause(state) {
    const std = state.standard;
    if (!std || std.ended) return state;
    const now = Date.now();
    if (std.paused) {
      const pausedMs = now - (std.pausedAt || now);
      std.turnStartedAt += pausedMs;
      std.gameStartedAt += pausedMs;
      std.paused = false;
      std.pausedAt = null;
    } else {
      std.paused = true;
      std.pausedAt = now;
    }
    save(state);
    return state;
  }

  function stdComputeStats(state) {
    const std = state.standard;
    const gameTimeMs = (std.endedAt || Date.now()) - std.gameStartedAt;
    return {
      gameTimeMs,
      timed: std.trackTurns !== false,
      winnerId: std.winnerId,
      lifeTimeline: std.trackTurns !== false ? lifeTimeline(std, std.players) : null,
      players: std.players.map((p) => ({
        id: p.id,
        name: p.name,
        commander: p.commander,
        turnTimeMs: p.turnTimeMs,
        turnsTaken: p.turnsTaken,
        avgTurnMs: p.turnsTaken ? p.turnTimeMs / p.turnsTaken : 0,
        eliminated: p.eliminated,
      })),
    };
  }

  /** Termina o jogo: fecha o relógio do turno atual, guarda stats nos perfis ligados. */
  function stdEndGame(state, winnerId) {
    const std = state.standard;
    if (std.ended) return stdComputeStats(state);
    const now = Date.now();
    const timed = std.trackTurns !== false;
    const cur = stdCurrentPlayer(state);
    if (timed && cur && !std.paused) {
      cur.turnTimeMs += now - std.turnStartedAt;
      cur.turnsTaken += 1;
    }
    std.turnStartedAt = now;
    std.ended = true;
    std.endedAt = now;
    std.winnerId = winnerId || null;
    const stats = stdComputeStats(state);
    if (!std.profilesApplied) {
      std.players.forEach((p) => {
        if (p.profileId && global.MTG.Profiles) {
          global.MTG.Profiles.recordGameResult(p.profileId, {
            won: p.id === winnerId,
            gameTimeMs: stats.gameTimeMs,
            turnTimeMs: p.turnTimeMs,
            turnsTaken: p.turnsTaken,
            mode: state.presetName || "standard",
            timed,
            opponents: std.players.filter((o) => o.id !== p.id).map((o) => ({ profileId: o.profileId || null, name: o.name, pilot: o.pilot || undefined, won: o.id === winnerId })),
            pilot: p.pilot, commanderName: p.commander && p.commander.name,
          });
        }
      });
      std.profilesApplied = true;
    }
    save(state);
    return stats;
  }

  function stdSetPlayerCount(state, count) {
    const players = state.standard.players;
    if (count > players.length) {
      for (let i = players.length; i < count; i++) {
        players.push({
          id: uid(),
          name: tr("Jogador {n}", { n: i + 1 }),
          commander: null,
          partnerCommander: null,
          life: state.standard.startLife,
          cmdDamage: {},
          cmdTax: 0,
          partnerCmdTax: 0,
          eliminated: false,
          protected: false,
          poison: 0,
          profileId: null,
          turnTimeMs: 0,
          turnsTaken: 0,
        });
      }
    } else if (count < players.length) {
      players.length = count;
    }
    state.standard.turnOrder = players.map((p) => p.id);
    state.standard.currentTurnIndex = 0;
    state.standard.roundStartIndex = 0;
    save(state);
    return state;
  }

  /** A ordem dos turnos segue sempre os lugares à mesa (sentido horário).
   *  Ao trocar lugares, a ordem dos turnos passa a ser a nova ordem dos
   *  lugares; quem está a jogar continua a jogar e a ronda continua a contar
   *  a partir de quem a começou. */
  function syncTurnOrderToSeats(modeState, ids) {
    if (!modeState.turnOrder) return;
    const curId = modeState.turnOrder[modeState.currentTurnIndex];
    const startId = modeState.turnOrder[modeState.roundStartIndex || 0];
    modeState.turnOrder = ids.slice();
    const ci = modeState.turnOrder.indexOf(curId);
    if (ci >= 0) modeState.currentTurnIndex = ci;
    if (modeState.roundStartIndex != null) {
      const si = modeState.turnOrder.indexOf(startId);
      if (si >= 0) modeState.roundStartIndex = si;
    }
  }

  /** Reordena os lugares dos jogadores no tabuleiro; a ordem dos turnos
   *  passa a seguir os novos lugares. orderedIds deve ter todos os ids. */
  function stdReorderPlayers(state, orderedIds) {
    const std = state.standard;
    const byId = new Map(std.players.map((p) => [p.id, p]));
    const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
    std.players.forEach((p) => { if (!orderedIds.includes(p.id)) reordered.push(p); });
    std.players = reordered;
    syncTurnOrderToSeats(std, reordered.map((p) => p.id));
    save(state);
    return state;
  }

  function stdSetStartLife(state, life) {
    const now = Date.now();
    state.standard.startLife = life;
    state.standard.players.forEach((p) => {
      p.life = life;
      p.cmdDamage = {};
      p.cmdTax = 0;
      p.partnerCmdTax = 0;
      p.eliminated = false;
      p.protected = false;
      p.turnTimeMs = 0;
      p.turnsTaken = 0;
      p.counters = {};
      p.blessing = false;
    });
    state.standard.monarchId = null;
    state.standard.initiativeId = null;
    state.standard.dayNight = null;
    state.standard.currentTurnIndex = 0;
    state.standard.roundStartIndex = 0;
    state.standard.roundNumber = 1;
    state.standard.turnSeq = 1;
    state.standard.lifeLog = [];
    state.standard.turnLog = [];
    state.standard.gameStartedAt = now;
    state.standard.turnStartedAt = now;
    state.standard.paused = false;
    state.standard.pausedAt = null;
    state.standard.ended = false;
    state.standard.endedAt = null;
    state.standard.winnerId = null;
    state.standard.profilesApplied = false;
    save(state);
    return state;
  }

  // ---------------------------------------------------------
  // MODO BATTLE ROYALE
  // ---------------------------------------------------------
  const BR_ZONES = ["A", "B", "C", "D", "E", "F"];
  // ordem de fecho: de fora para dentro (A e F são os extremos do mapa)
  const BR_CLOSE_ORDER = ["A", "F", "B", "E", "C", "D"];

  const BR_EVENTS = {
    1: { title: "Blood Moon", desc: tr("Cada jogador perde 3 vidas."), effect: "loseAll", amount: 3 },
    2: { title: "Supply Drop", desc: tr("Cada jogador cria 1 Treasure."), effect: "log" },
    3: { title: "Frenzy", desc: tr("Todas as criaturas ganham +2/+0 até ao teu próximo turno."), effect: "log" },
    4: { title: "Blackout", desc: tr("Ninguém pode comprar mais de 1 carta neste turno."), effect: "log" },
    5: { title: "Healing Zone", desc: tr("Cada jogador ganha 5 vidas."), effect: "gainAll", amount: 5 },
    6: { title: "Air Drop", desc: tr("O jogador com menos vidas compra 5 cartas."), effect: "lowestLifeDraw" },
  };

  const BR_LOOT = {
    treasure3: { icon: "coins", title: tr("Cria 3 Treasure"), type: "log" },
    draw3: { icon: "layers", title: tr("Compra 3 cartas"), type: "log" },
    life10: { icon: "heart", title: tr("Ganha 10 vidas"), type: "life", amount: 10 },
    token66: { icon: "box", title: tr("Ficha 6/6"), type: "log" },
    regrowth: { icon: "undo", title: tr("Recupera carta do cemitério"), type: "log" },
    freeSpell: { icon: "star", title: tr("Carta grátis este turno"), type: "log" },
  };

  /** Baralha as zonas (Fisher-Yates) para que a zona inicial de cada jogador seja aleatória. */
  function shuffledZones() {
    const arr = BR_ZONES.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function createBRGame(names) {
    const zones = shuffledZones();
    const players = names.map((name, i) => ({
      id: uid(),
      name: name && name.trim() ? name.trim() : tr("Jogador {n}", { n: i + 1 }),
      commander: null,
      life: 30,
      zone: zones[i % zones.length],
      eliminated: false,
      lootUsed: [],
      profileId: null,
      turnTimeMs: 0,
      turnsTaken: 0,
    }));
    const now = Date.now();
    const state = {
      mode: "br",
      createdAt: now,
      br: {
        players,
        turnOrder: players.map((p) => p.id),
        currentTurnIndex: 0,
        globalTurnCount: 0,
        roundNumber: 1,
        roundEventRolled: false,
        closedZones: [],
        closeOrder: BR_CLOSE_ORDER.slice(),
        phase: "normal", // normal -> final_circle -> final_duel_pending -> final_duel -> ended
        championId: null,
        lastRoll: null,
        gameStartedAt: now,
        turnStartedAt: now,
        paused: false,
        pausedAt: null,
        endedAt: null,
        profilesApplied: false,
        lifeLog: [],
        log: [{ t: Date.now(), text: tr("Battle Royale iniciado. Boa sorte, tributos.") }],
      },
    };
    save(state);
    return state;
  }

  function brLog(state, text) {
    state.br.log.unshift({ t: Date.now(), text });
    if (state.br.log.length > 60) state.br.log.length = 60;
  }

  function brAlivePlayers(state) {
    return state.br.players.filter((p) => !p.eliminated);
  }

  function brAdjustLife(state, playerId, delta) {
    const p = state.br.players.find((x) => x.id === playerId);
    if (!p) return state;
    if (delta > 0 && (state.br.phase === "final_circle" || state.br.phase === "final_duel_pending")) {
      // Regra Final Circle: não se pode ganhar vidas
      return state;
    }
    p.life += delta;
    logLifeChange(state.br, brCurrentPlayer(state), p, delta);
    if (p.life <= 0 && !p.eliminated) {
      brEliminate(state, playerId, []);
      return state;
    }
    save(state);
    return state;
  }

  /** Reordena os jogadores na lista; a ordem dos turnos passa a seguir a
   *  nova ordem. orderedIds deve conter todos os ids atuais. */
  function brReorderPlayers(state, orderedIds) {
    const br = state.br;
    const byId = new Map(br.players.map((p) => [p.id, p]));
    const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
    br.players.forEach((p) => { if (!orderedIds.includes(p.id)) reordered.push(p); });
    br.players = reordered;
    syncTurnOrderToSeats(br, reordered.map((p) => p.id));
    save(state);
    return state;
  }

  function brSetZone(state, playerId, zone) {
    const p = state.br.players.find((x) => x.id === playerId);
    if (!p) return state;
    p.zone = zone;
    save(state);
    return state;
  }

  function brSetName(state, playerId, name) {
    const p = state.br.players.find((x) => x.id === playerId);
    if (!p) return state;
    p.name = name;
    save(state);
    return state;
  }

  function brSetCommander(state, playerId, commander) {
    const p = state.br.players.find((x) => x.id === playerId);
    if (!p) return state;
    p.commander = commander;
    ensureFallbackColors(state.br.players);
    save(state);
    return state;
  }

  /** Define quem começa o Battle Royale (escolha manual ou resultado do
   *  dado), reiniciando o relógio do jogo/turno a partir de agora. */
  function brSetStartingPlayer(state, playerId) {
    const br = state.br;
    const idx = br.turnOrder.indexOf(playerId);
    if (idx === -1) return state;
    const now = Date.now();
    br.currentTurnIndex = idx;
    br.globalTurnCount = 0;
    br.lifeLog = [];
    br.turnLog = [];
    br.turnStartedAt = now;
    br.gameStartedAt = now;
    br.paused = false;
    br.pausedAt = null;
    save(state);
    return state;
  }

  /** Pausa/retoma os relógios de turno e de jogo. Ao retomar, desloca as
   *  referências de tempo pelo tempo em pausa, para o tempo pausado não
   *  contar para a duração do turno/jogo. */
  function brTogglePause(state) {
    const br = state.br;
    if (!br || br.phase === "ended") return state;
    const now = Date.now();
    if (br.paused) {
      const pausedMs = now - (br.pausedAt || now);
      br.turnStartedAt += pausedMs;
      br.gameStartedAt += pausedMs;
      br.paused = false;
      br.pausedAt = null;
    } else {
      br.paused = true;
      br.pausedAt = now;
    }
    save(state);
    return state;
  }

  function brSetProfile(state, playerId, profileId) {
    const p = state.br.players.find((x) => x.id === playerId);
    if (!p) return state;
    p.profileId = profileId;
    save(state);
    return state;
  }

  function brComputeStats(state) {
    const gameTimeMs = (state.br.endedAt || Date.now()) - state.br.gameStartedAt;
    return {
      gameTimeMs,
      winnerId: state.br.championId,
      players: state.br.players.map((p) => ({
        id: p.id,
        name: p.name,
        commander: p.commander,
        turnTimeMs: p.turnTimeMs,
        turnsTaken: p.turnsTaken,
        avgTurnMs: p.turnsTaken ? p.turnTimeMs / p.turnsTaken : 0,
        eliminated: p.eliminated,
      })),
    };
  }

  function brApplyProfileResults(state) {
    if (state.br.profilesApplied) return;
    const gameTimeMs = (state.br.endedAt || Date.now()) - state.br.gameStartedAt;
    state.br.players.forEach((p) => {
      if (p.profileId && global.MTG.Profiles) {
        global.MTG.Profiles.recordGameResult(p.profileId, {
          won: p.id === state.br.championId,
          gameTimeMs,
          turnTimeMs: p.turnTimeMs,
          turnsTaken: p.turnsTaken,
          mode: "br",
          opponents: state.br.players.filter((o) => o.id !== p.id).map((o) => ({ profileId: o.profileId || null, name: o.name, pilot: o.pilot || undefined, won: o.id === state.br.championId })),
          pilot: p.pilot, commanderName: p.commander && p.commander.name,
        });
      }
    });
    state.br.profilesApplied = true;
  }

  function brZoneAdjacent(zoneA, zoneB) {
    const ia = BR_ZONES.indexOf(zoneA);
    const ib = BR_ZONES.indexOf(zoneB);
    return Math.abs(ia - ib) === 1;
  }

  function brCheckPhaseTransition(state) {
    const alive = brAlivePlayers(state);
    if (state.br.phase === "normal" && alive.length === 3) {
      state.br.phase = "final_circle";
      brLog(state, tr("FINAL CIRCLE — restam 3 jogadores! Não se pode ganhar vidas. Todos podem atacar todos. Criaturas com haste."));
    } else if (
      (state.br.phase === "final_circle" || state.br.phase === "normal") &&
      alive.length === 2
    ) {
      state.br.phase = "final_duel_pending";
      brLog(state, tr("Restam 2 jogadores — prepara o FINAL DUEL!"));
    } else if (alive.length <= 1 && state.br.phase !== "ended") {
      const now = Date.now();
      const cur = brCurrentPlayer(state);
      if (cur) cur.turnTimeMs += now - state.br.turnStartedAt;
      state.br.turnStartedAt = now;
      state.br.phase = "ended";
      state.br.endedAt = now;
      state.br.championId = alive[0] ? alive[0].id : null;
      brLog(state, alive[0] ? tr("{name} é o CAMPEÃO DO BATTLE ROYALE!", { name: alive[0].name }) : tr("Jogo terminado."));
      brApplyProfileResults(state);
    }
  }

  /** Elimina um jogador e distribui loot a quem participou no abate (killerIds). */
  function brEliminate(state, playerId, killerIds) {
    const p = state.br.players.find((x) => x.id === playerId);
    if (!p || p.eliminated) return state;
    p.eliminated = true;
    p.life = 0;
    brLog(state, tr("{name} foi eliminado! (tudo o que controlava sai do jogo)", { name: p.name }));
    state.pendingLoot = (killerIds || []).filter(Boolean);
    brCheckPhaseTransition(state);
    save(state);
    return state;
  }

  function brApplyLoot(state, playerId, rewardKey) {
    const p = state.br.players.find((x) => x.id === playerId);
    const reward = BR_LOOT[rewardKey];
    if (!p || !reward) return state;
    if (p.lootUsed.includes(rewardKey)) return state; // já usou esta recompensa
    p.lootUsed.push(rewardKey);
    if (reward.type === "life" && !(state.br.phase === "final_circle" || state.br.phase === "final_duel_pending")) {
      p.life += reward.amount;
    }
    brLog(state, tr("{name} escolheu recompensa: {reward}", { name: p.name, reward: reward.title }));
    save(state);
    return state;
  }

  function brCurrentPlayer(state) {
    const id = state.br.turnOrder[state.br.currentTurnIndex];
    return state.br.players.find((p) => p.id === id);
  }

  function brNextAliveIndex(state, fromIndex) {
    const order = state.br.turnOrder;
    for (let step = 1; step <= order.length; step++) {
      const idx = (fromIndex + step) % order.length;
      const p = state.br.players.find((x) => x.id === order[idx]);
      if (p && !p.eliminated) return idx;
    }
    return fromIndex;
  }

  function brNextTurn(state) {
    if (state.br.phase === "ended" || state.br.paused) return state;
    const now = Date.now();
    const prevIndex = state.br.currentTurnIndex;
    const currentBefore = brCurrentPlayer(state);
    if (currentBefore) {
      currentBefore.turnTimeMs += now - state.br.turnStartedAt;
      currentBefore.turnsTaken += 1;
    }
    const nextIndex = brNextAliveIndex(state, prevIndex);
    state.br.currentTurnIndex = nextIndex;
    state.br.turnStartedAt = now;
    state.br.globalTurnCount += 1;

    if (nextIndex <= prevIndex) {
      // deu a volta à mesa -> nova ronda
      state.br.roundNumber += 1;
      state.br.roundEventRolled = false;
      // o círculo fecha a cada 3ª ronda da mesa (não por turno individual)
      if (state.br.roundNumber % 3 === 0) {
        brCloseNextZone(state);
      }
    }

    // dano da zona fechada no início do turno de quem lá está
    const current = brCurrentPlayer(state);
    if (current && state.br.closedZones.includes(current.zone)) {
      brLog(state, tr("{name} está numa zona fechada e perde 5 vidas!", { name: current.name }));
      brAdjustLife(state, current.id, -5);
    }

    save(state);
    return state;
  }

  function brCloseNextZone(state) {
    const next = state.br.closeOrder.find((z) => !state.br.closedZones.includes(z));
    if (!next) return state;
    state.br.closedZones.push(next);
    brLog(state, tr("THE ZONE IS CLOSING — a zona {zone} está agora FECHADA!", { zone: next }));
    return state;
  }

  function brRollEvent(state) {
    const roll = 1 + Math.floor(Math.random() * 6);
    state.br.lastRoll = roll;
    state.br.roundEventRolled = true;
    const ev = BR_EVENTS[roll];
    brLog(state, tr("Rolou {roll} — {title}: {desc}", { roll, title: ev.title, desc: ev.desc }));
    if (ev.effect === "loseAll") {
      brAlivePlayers(state).forEach((p) => brAdjustLife(state, p.id, -ev.amount));
    } else if (ev.effect === "gainAll") {
      brAlivePlayers(state).forEach((p) => brAdjustLife(state, p.id, ev.amount));
    }
    save(state);
    return { roll, event: ev };
  }

  function brStartFinalDuel(state) {
    if (state.br.phase !== "final_duel_pending") return state;
    state.br.phase = "final_duel";
    brAlivePlayers(state).forEach((p) => {
      p.life += 10;
    });
    brLog(state, tr("FINAL DUEL! Ambos ganham 10 vidas, desviram permanentes, compram 3 cartas e criam 3 Treasure."));
    save(state);
    return state;
  }

  // ---------------------------------------------------------
  // MODO EQUIPAS (Teams) — vida partilhada por equipa (estilo Two-Headed
  // Giant), com N equipas de M jogadores cada. Cada jogador continua a ter
  // o seu próprio commander (+ parceiro opcional) e commander tax, mas a
  // vida é um total único por equipa. O TURNO é da EQUIPA, não de um
  // jogador individual — todos os jogadores da mesma equipa jogam ao
  // mesmo tempo no turno dela; "passar turno" avança para a equipa
  // seguinte (T1 → T2 → T3 → T1 → ...).
  // ---------------------------------------------------------

  /** Junta os jogadores de todas as equipas numa única lista, para poderem
   *  partilhar o sorteio de cores de fallback (cada jogador sem commander
   *  tem a sua própria cor, nunca repetida entre os jogadores da equipa —
   *  o fundo do painel da equipa fica dividido, uma fatia por jogador). */
  function teamsAllPlayers(teams) {
    return (teams || []).reduce((acc, t) => acc.concat(t.players), []);
  }

  function createTeamsGame({ numTeams, playersPerTeam, startLife, trackTurns }) {
    const teams = [];
    let seat = 0;
    for (let t = 0; t < numTeams; t++) {
      const teamPlayers = [];
      for (let i = 0; i < playersPerTeam; i++) {
        seat++;
        teamPlayers.push({
          id: uid(),
          name: tr("Jogador {n}", { n: seat }),
          commander: null,
          partnerCommander: null,
          cmdTax: 0,
          partnerCmdTax: 0,
          profileId: null,
        });
      }
      teams.push({
        id: uid(),
        name: tr("Equipa {n}", { n: t + 1 }),
        life: startLife,
        eliminated: false,
        turnTimeMs: 0,
        turnsTaken: 0,
        players: teamPlayers,
      });
    }
    ensureFallbackColors(teamsAllPlayers(teams));
    // ordem de turnos: uma entrada por EQUIPA (não por jogador) — dentro do
    // turno de uma equipa, todos os seus jogadores jogam ao mesmo tempo.
    const turnOrder = teams.map((tm) => tm.id);
    const now = Date.now();
    const state = {
      mode: "teams",
      presetName: "teams",
      createdAt: now,
      teams: {
        numTeams,
        playersPerTeam,
        startLife,
        trackTurns: trackTurns !== false,
        teams,
        turnOrder,
        currentTurnIndex: 0,
        roundStartIndex: 0,
        roundNumber: 1,
        turnSeq: 1,
        lifeLog: [],
        gameStartedAt: now,
        turnStartedAt: now,
        paused: false,
        pausedAt: null,
        ended: false,
        endedAt: null,
        winnerTeamId: null,
        profilesApplied: false,
      },
    };
    save(state);
    return state;
  }

  /** Localiza um jogador (e a sua equipa) em qualquer equipa pelo id. */
  function teamsFindPlayer(state, playerId) {
    const teams = state.teams.teams;
    for (const team of teams) {
      const player = team.players.find((p) => p.id === playerId);
      if (player) return { team, player };
    }
    return { team: null, player: null };
  }

  function teamsAdjustLife(state, teamId, delta) {
    const team = state.teams.teams.find((t) => t.id === teamId);
    if (!team) return state;
    team.life += delta;
    if (team.life <= 0) team.eliminated = true;
    else if (team.eliminated && team.life > 0) team.eliminated = false;
    logLifeChange(state.teams, teamsCurrentTeam(state), team, delta);
    save(state);
    return state;
  }

  /** Commander tax de um jogador dentro de uma equipa (main/partner). */
  function teamsAdjustCmdTax(state, playerId, delta, source) {
    const { player } = teamsFindPlayer(state, playerId);
    if (!player) return state;
    const field = source === "partner" ? "partnerCmdTax" : "cmdTax";
    player[field] = Math.max(0, (player[field] || 0) + delta);
    save(state);
    return state;
  }

  function teamsSetCommander(state, playerId, commander) {
    const { player } = teamsFindPlayer(state, playerId);
    if (!player) return state;
    player.commander = commander;
    ensureFallbackColors(teamsAllPlayers(state.teams.teams));
    save(state);
    return state;
  }

  function teamsSetPartnerCommander(state, playerId, commander) {
    const { player } = teamsFindPlayer(state, playerId);
    if (!player) return state;
    player.partnerCommander = commander;
    save(state);
    return state;
  }

  function teamsSetName(state, playerId, name) {
    const { player } = teamsFindPlayer(state, playerId);
    if (!player) return state;
    player.name = name;
    save(state);
    return state;
  }

  function teamsSetProfile(state, playerId, profileId) {
    const { player } = teamsFindPlayer(state, playerId);
    if (!player) return state;
    player.profileId = profileId;
    save(state);
    return state;
  }

  /** Toggle manual de "equipa eliminada" (ex: concederem a partida sem
   *  chegar a 0 de vida). */
  function teamsToggleEliminated(state, teamId) {
    const team = state.teams.teams.find((t) => t.id === teamId);
    if (!team) return state;
    team.eliminated = !team.eliminated;
    save(state);
    return state;
  }

  /** Reordena os lugares das equipas no tabuleiro; a ordem dos turnos
   *  passa a seguir os novos lugares. orderedIds deve ter todos os ids. */
  function teamsReorderTeams(state, orderedIds) {
    const t = state.teams;
    const byId = new Map(t.teams.map((tm) => [tm.id, tm]));
    const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
    t.teams.forEach((tm) => { if (!orderedIds.includes(tm.id)) reordered.push(tm); });
    t.teams = reordered;
    syncTurnOrderToSeats(t, reordered.map((tm) => tm.id));
    save(state);
    return state;
  }

  /** A equipa da vez (o "turno" é da equipa toda, não de um jogador). */
  function teamsCurrentTeam(state) {
    const t = state.teams;
    if (!t.turnOrder) return null;
    const id = t.turnOrder[t.currentTurnIndex];
    return t.teams.find((tm) => tm.id === id) || null;
  }

  function teamsNextAliveIndex(state, fromIndex) {
    const order = state.teams.turnOrder;
    for (let step = 1; step <= order.length; step++) {
      const idx = (fromIndex + step) % order.length;
      const team = state.teams.teams.find((tm) => tm.id === order[idx]);
      if (team && !team.eliminated) return idx;
    }
    return fromIndex;
  }

  /** Passa o turno para a equipa seguinte ainda viva. A ronda só sobe
   *  quando a vez volta a dar a quem começou a ronda/jogo. */
  function teamsPassTurn(state) {
    const t = state.teams;
    if (!t || t.ended || t.paused) return state;
    const now = Date.now();
    const cur = teamsCurrentTeam(state);
    if (cur) {
      cur.turnTimeMs += now - t.turnStartedAt;
      cur.turnsTaken += 1;
    }
    t.currentTurnIndex = teamsNextAliveIndex(state, t.currentTurnIndex);
    t.turnStartedAt = now;
    t.turnSeq = (t.turnSeq || 1) + 1;
    if (t.currentTurnIndex === (t.roundStartIndex || 0)) {
      t.roundNumber = (t.roundNumber || 1) + 1;
    }
    logTurn(t, teamsCurrentTeam(state));
    save(state);
    return state;
  }

  /** Define que equipa começa o jogo (escolha manual ou resultado do dado). */
  function teamsSetStartingTeam(state, teamId) {
    const t = state.teams;
    const idx = t.turnOrder.indexOf(teamId);
    if (idx === -1) return state;
    const now = Date.now();
    t.currentTurnIndex = idx;
    t.roundStartIndex = idx;
    t.roundNumber = 1;
    t.turnSeq = 1;
    t.lifeLog = [];
    t.turnLog = [];
    t.turnStartedAt = now;
    t.gameStartedAt = now;
    t.paused = false;
    t.pausedAt = null;
    logTurn(t, teamsCurrentTeam(state));
    save(state);
    return state;
  }

  /** Pausa/retoma os relógios de turno e de jogo. Ao retomar, desloca as
   *  referências de tempo pelo tempo em pausa, para o tempo pausado não
   *  contar para a duração do turno/jogo. */
  function teamsTogglePause(state) {
    const t = state.teams;
    if (!t || t.ended) return state;
    const now = Date.now();
    if (t.paused) {
      const pausedMs = now - (t.pausedAt || now);
      t.turnStartedAt += pausedMs;
      t.gameStartedAt += pausedMs;
      t.paused = false;
      t.pausedAt = null;
    } else {
      t.paused = true;
      t.pausedAt = now;
    }
    save(state);
    return state;
  }

  function teamsComputeStats(state) {
    const t = state.teams;
    const gameTimeMs = (t.endedAt || Date.now()) - t.gameStartedAt;
    const rows = t.teams.map((team) => ({
      id: team.id,
      name: team.name + (team.players.length ? " — " + team.players.map((p) => p.name).join(", ") : ""),
      commander: team.players[0] ? team.players[0].commander : null,
      turnTimeMs: team.turnTimeMs,
      turnsTaken: team.turnsTaken,
      avgTurnMs: team.turnsTaken ? team.turnTimeMs / team.turnsTaken : 0,
      eliminated: team.eliminated,
    }));
    return { gameTimeMs, timed: t.trackTurns !== false, winnerId: t.winnerTeamId, players: rows, lifeTimeline: t.trackTurns !== false ? lifeTimeline(t, t.teams) : null };
  }

  /** Termina o jogo: fecha o relógio do turno atual, guarda stats nos perfis
   *  de todos os jogadores (won = jogar numa equipa igual à vencedora). */
  function teamsEndGame(state, winnerTeamId) {
    const t = state.teams;
    if (t.ended) return teamsComputeStats(state);
    const now = Date.now();
    const timed = t.trackTurns !== false;
    const cur = teamsCurrentTeam(state);
    if (timed && cur && !t.paused) {
      cur.turnTimeMs += now - t.turnStartedAt;
      cur.turnsTaken += 1;
    }
    t.turnStartedAt = now;
    t.ended = true;
    t.endedAt = now;
    t.winnerTeamId = winnerTeamId || null;
    const stats = teamsComputeStats(state);
    if (!t.profilesApplied) {
      t.teams.forEach((team) => {
        team.players.forEach((p) => {
          if (p.profileId && global.MTG.Profiles) {
            global.MTG.Profiles.recordGameResult(p.profileId, {
              won: team.id === winnerTeamId,
              gameTimeMs: stats.gameTimeMs,
              turnTimeMs: team.turnTimeMs,
              turnsTaken: team.turnsTaken,
              mode: "teams",
              timed,
              // só os jogadores das OUTRAS equipas contam como adversários
              opponents: t.teams.filter((o) => o.id !== team.id).reduce((acc, o) => acc.concat(o.players.map((x) => ({ profileId: x.profileId || null, name: x.name, pilot: x.pilot || undefined, won: o.id === winnerTeamId }))), []),
              pilot: p.pilot, commanderName: p.commander && p.commander.name,
            });
          }
        });
      });
      t.profilesApplied = true;
    }
    save(state);
    return stats;
  }

  global.MTG = global.MTG || {};
  global.MTG.State = {
    save,
    load,
    clear,
    createStandardGame,
    stdAdjustLife,
    stdAdjustCmdDamage,
    stdAdjustCmdTax,
    stdAdjustPoison,
    PLAYER_COUNTERS,
    stdAdjustCounter,
    stdToggleBlessing,
    stdSetMonarch,
    stdSetInitiative,
    stdSetDayNight,
    stdGroupLife,
    stdToggleEliminated,
    stdSetCommander,
    stdSetPartnerCommander,
    stdSetProtected,
    stdSetName,
    stdSetPlayerCount,
    stdReorderPlayers,
    stdSetStartLife,
    stdSetProfile,
    stdSetStartingPlayer,
    stdCurrentPlayer,
    stdPassTurn,
    stdTogglePause,
    stdEndGame,
    stdComputeStats,
    createBRGame,
    brAdjustLife,
    brReorderPlayers,
    brSetZone,
    brSetName,
    brSetCommander,
    brSetProfile,
    brSetStartingPlayer,
    brZoneAdjacent,
    brEliminate,
    brApplyLoot,
    brCurrentPlayer,
    brNextTurn,
    brTogglePause,
    brRollEvent,
    brStartFinalDuel,
    brAlivePlayers,
    brComputeStats,
    brLog,
    ZONES: BR_ZONES,
    CLOSE_ORDER: BR_CLOSE_ORDER,
    EVENTS: BR_EVENTS,
    LOOT: BR_LOOT,
    FALLBACK_PALETTE,
    ensureFallbackColors,
    createTeamsGame,
    teamsFindPlayer,
    teamsAdjustLife,
    teamsAdjustCmdTax,
    teamsSetCommander,
    teamsSetPartnerCommander,
    teamsSetName,
    teamsSetProfile,
    teamsToggleEliminated,
    teamsReorderTeams,
    teamsCurrentTeam,
    teamsPassTurn,
    teamsSetStartingTeam,
    teamsTogglePause,
    teamsComputeStats,
    teamsEndGame,
  };
})(window);
