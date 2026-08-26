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
        gameStartedAt: now,
        turnStartedAt: now,
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

  /** Passa o turno: acumula o tempo do jogador atual e toca a vez ao próximo vivo. */
  function stdPassTurn(state) {
    const std = state.standard;
    if (!std || std.ended) return state;
    const now = Date.now();
    const cur = stdCurrentPlayer(state);
    if (cur) {
      cur.turnTimeMs += now - std.turnStartedAt;
      cur.turnsTaken += 1;
    }
    std.currentTurnIndex = stdNextAliveIndex(state, std.currentTurnIndex);
    std.turnStartedAt = now;
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
    if (cur) {
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
    save(state);
    return state;
  }

  function stdSetStartLife(state, life) {
    const now = Date.now();
    state.standard.startLife = life;
    state.standard.players.forEach((p) => {
      p.life = life;
      p.cmdDamage = {};
      p.eliminated = false;
      p.protected = false;
      p.turnTimeMs = 0;
      p.turnsTaken = 0;
    });
    state.standard.currentTurnIndex = 0;
    state.standard.gameStartedAt = now;
    state.standard.turnStartedAt = now;
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
        endedAt: null,
        profilesApplied: false,
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
    if (p.life <= 0 && !p.eliminated) {
      brEliminate(state, playerId, []);
      return state;
    }
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
    if (state.br.phase === "ended") return state;
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

  global.MTG = global.MTG || {};
  global.MTG.State = {
    save,
    load,
    clear,
    createStandardGame,
    stdAdjustLife,
    stdAdjustCmdDamage,
    stdToggleEliminated,
    stdSetCommander,
    stdSetPartnerCommander,
    stdSetProtected,
    stdSetName,
    stdSetPlayerCount,
    stdSetStartLife,
    stdSetProfile,
    stdCurrentPlayer,
    stdPassTurn,
    stdEndGame,
    stdComputeStats,
    createBRGame,
    brAdjustLife,
    brSetZone,
    brSetName,
    brSetCommander,
    brSetProfile,
    brZoneAdjacent,
    brEliminate,
    brApplyLoot,
    brCurrentPlayer,
    brNextTurn,
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
  };
})(window);
