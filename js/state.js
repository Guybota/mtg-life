/* ===========================================================
   state.js — motor de estado do jogo (persistido em localStorage)
   =========================================================== */
(function (global) {
  const STORAGE_KEY = "mtg_lc_game_v2";

  function uid() {
    return "p_" + Math.random().toString(36).slice(2, 10);
  }

  // Cores de fundo sorteadas para jogadores sem commander escolhido (sem
  // arte de fundo). Cada entrada é [corClara, corEscura] para um gradiente.
  const FALLBACK_PALETTE = [
    ["#c0392b", "#6b1810"], // vermelho
    ["#1f6fb2", "#0d2f4f"], // azul
    ["#2e9e5b", "#123f24"], // verde
    ["#8e2ee0", "#3a1263"], // roxo
    ["#d4af37", "#5c4813"], // dourado
    ["#e0632e", "#5c2510"], // laranja
    ["#2ec4b6", "#0f4c47"], // turquesa
    ["#e0389a", "#5c1743"], // rosa
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
   *  botão "📜 Histórico" do tabuleiro) — guarda CADA alteração individual
   *  (não só a diferença total acumulada), já com o contexto de que
   *  turno/ronda era e de quem era a vez nesse momento. turnEntity/
   *  targetEntity podem ser um jogador OU uma equipa (só precisam de
   *  id/name). */
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
  function createStandardGame({ playerCount, startLife, commanderDamageEnabled, presetName }) {
    const players = [];
    for (let i = 0; i < playerCount; i++) {
      players.push({
        id: uid(),
        name: `Jogador ${i + 1}`,
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

  function stdAdjustLife(state, playerId, delta) {
    const p = state.standard.players.find((x) => x.id === playerId);
    if (!p) return state;
    p.life += delta;
    // enquanto "protegido" (carta tipo Platinum Angel/Worship em jogo), a
    // eliminação automática fica suspensa — só muda por ação explícita.
    if (!p.protected) {
      if (p.life <= 0) p.eliminated = true;
      else if (p.eliminated && p.life > 0) p.eliminated = false;
    }
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
    p.cmdDamage[key] = next;
    // dano de commander também reduz a vida normal, como nas regras oficiais
    p.life -= delta;
    if (!p.protected) {
      const anyLethal = Object.values(p.cmdDamage).some((v) => v >= 21);
      if (anyLethal || p.life <= 0) p.eliminated = true;
      else if (p.life > 0 && !anyLethal) p.eliminated = false;
    }
    save(state);
    return state;
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
    std.turnStartedAt = now;
    std.gameStartedAt = now;
    std.paused = false;
    std.pausedAt = null;
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
      winnerId: std.winnerId,
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
    const cur = stdCurrentPlayer(state);
    if (cur && !std.paused) {
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
          name: `Jogador ${i + 1}`,
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

  /** Reordena a posição dos jogadores no tabuleiro (só a disposição visual —
   *  `turnOrder` guarda ids, não índices, por isso a ordem dos turnos não é
   *  afetada por isto). orderedIds deve conter todos os ids atuais. */
  function stdReorderPlayers(state, orderedIds) {
    const std = state.standard;
    const byId = new Map(std.players.map((p) => [p.id, p]));
    const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
    std.players.forEach((p) => { if (!orderedIds.includes(p.id)) reordered.push(p); });
    std.players = reordered;
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
    });
    state.standard.currentTurnIndex = 0;
    state.standard.roundStartIndex = 0;
    state.standard.roundNumber = 1;
    state.standard.turnSeq = 1;
    state.standard.lifeLog = [];
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
    1: { title: "🩸 Blood Moon", desc: "Cada jogador perde 3 vidas.", effect: "loseAll", amount: 3 },
    2: { title: "📦 Supply Drop", desc: "Cada jogador cria 1 Treasure.", effect: "log" },
    3: { title: "⚡ Frenzy", desc: "Todas as criaturas ganham +2/+0 até ao teu próximo turno.", effect: "log" },
    4: { title: "🌑 Blackout", desc: "Ninguém pode comprar mais de 1 carta neste turno.", effect: "log" },
    5: { title: "💚 Healing Zone", desc: "Cada jogador ganha 5 vidas.", effect: "gainAll", amount: 5 },
    6: { title: "✈️ AIR DROP", desc: "O jogador com menos vidas compra 5 cartas.", effect: "lowestLifeDraw" },
  };

  const BR_LOOT = {
    treasure3: { icon: "💰", title: "Cria 3 Treasure", type: "log" },
    draw3: { icon: "🎴", title: "Compra 3 cartas", type: "log" },
    life10: { icon: "❤️", title: "Ganha 10 vidas", type: "life", amount: 10 },
    token66: { icon: "🐗", title: "Ficha 6/6", type: "log" },
    regrowth: { icon: "⚰️", title: "Recupera carta do cemitério", type: "log" },
    freeSpell: { icon: "✨", title: "Carta grátis este turno", type: "log" },
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
      name: name && name.trim() ? name.trim() : `Jogador ${i + 1}`,
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
        log: [{ t: Date.now(), text: "🎮 Battle Royale iniciado. Boa sorte, tributos." }],
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

  /** Reordena a posição dos jogadores na lista (só a disposição visual —
   *  `turnOrder` guarda ids, não índices, por isso a ordem dos turnos não é
   *  afetada por isto). orderedIds deve conter todos os ids atuais. */
  function brReorderPlayers(state, orderedIds) {
    const br = state.br;
    const byId = new Map(br.players.map((p) => [p.id, p]));
    const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
    br.players.forEach((p) => { if (!orderedIds.includes(p.id)) reordered.push(p); });
    br.players = reordered;
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
      brLog(state, "☠️ FINAL CIRCLE — restam 3 jogadores! Não se pode ganhar vidas. Todos podem atacar todos. Criaturas com haste.");
    } else if (
      (state.br.phase === "final_circle" || state.br.phase === "normal") &&
      alive.length === 2
    ) {
      state.br.phase = "final_duel_pending";
      brLog(state, "⚔️ Restam 2 jogadores — prepara o FINAL DUEL!");
    } else if (alive.length <= 1 && state.br.phase !== "ended") {
      const now = Date.now();
      const cur = brCurrentPlayer(state);
      if (cur) cur.turnTimeMs += now - state.br.turnStartedAt;
      state.br.turnStartedAt = now;
      state.br.phase = "ended";
      state.br.endedAt = now;
      state.br.championId = alive[0] ? alive[0].id : null;
      brLog(state, alive[0] ? `👑 ${alive[0].name} é o CAMPEÃO DO BATTLE ROYALE!` : "Jogo terminado.");
      brApplyProfileResults(state);
    }
  }

  /** Elimina um jogador e distribui loot a quem participou no abate (killerIds). */
  function brEliminate(state, playerId, killerIds) {
    const p = state.br.players.find((x) => x.id === playerId);
    if (!p || p.eliminated) return state;
    p.eliminated = true;
    p.life = 0;
    brLog(state, `💀 ${p.name} foi eliminado! (tudo o que controlava sai do jogo)`);
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
    brLog(state, `🎁 ${p.name} escolheu recompensa: ${reward.title}`);
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
      brLog(state, `☢️ ${current.name} está numa zona fechada e perde 5 vidas!`);
      brAdjustLife(state, current.id, -5);
    }

    save(state);
    return state;
  }

  function brCloseNextZone(state) {
    const next = state.br.closeOrder.find((z) => !state.br.closedZones.includes(z));
    if (!next) return state;
    state.br.closedZones.push(next);
    brLog(state, `☢️ THE ZONE IS CLOSING — a zona ${next} está agora FECHADA!`);
    return state;
  }

  function brRollEvent(state) {
    const roll = 1 + Math.floor(Math.random() * 6);
    state.br.lastRoll = roll;
    state.br.roundEventRolled = true;
    const ev = BR_EVENTS[roll];
    brLog(state, `🎲 Rolou ${roll} — ${ev.title}: ${ev.desc}`);
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
    brLog(state, "⚔️ FINAL DUEL! Ambos ganham 10 vidas, desviram permanentes, compram 3 cartas e criam 3 Treasure.");
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

  function createTeamsGame({ numTeams, playersPerTeam, startLife }) {
    const teams = [];
    let seat = 0;
    for (let t = 0; t < numTeams; t++) {
      const teamPlayers = [];
      for (let i = 0; i < playersPerTeam; i++) {
        seat++;
        teamPlayers.push({
          id: uid(),
          name: `Jogador ${seat}`,
          commander: null,
          partnerCommander: null,
          cmdTax: 0,
          partnerCmdTax: 0,
          profileId: null,
        });
      }
      teams.push({
        id: uid(),
        name: `Equipa ${t + 1}`,
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

  /** Reordena a posição das equipas no tabuleiro (só a disposição visual —
   *  `turnOrder` guarda ids, não índices, por isso a ordem dos turnos não é
   *  afetada por isto). orderedIds deve conter todos os ids atuais. */
  function teamsReorderTeams(state, orderedIds) {
    const t = state.teams;
    const byId = new Map(t.teams.map((tm) => [tm.id, tm]));
    const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
    t.teams.forEach((tm) => { if (!orderedIds.includes(tm.id)) reordered.push(tm); });
    t.teams = reordered;
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
    t.turnStartedAt = now;
    t.gameStartedAt = now;
    t.paused = false;
    t.pausedAt = null;
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
    return { gameTimeMs, winnerId: t.winnerTeamId, players: rows };
  }

  /** Termina o jogo: fecha o relógio do turno atual, guarda stats nos perfis
   *  de todos os jogadores (won = jogar numa equipa igual à vencedora). */
  function teamsEndGame(state, winnerTeamId) {
    const t = state.teams;
    if (t.ended) return teamsComputeStats(state);
    const now = Date.now();
    const cur = teamsCurrentTeam(state);
    if (cur && !t.paused) {
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
