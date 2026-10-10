/* ===========================================================
   ui/game-br.js — Setup e jogo Battle Royale.

   A interface está dividida em vários ficheiros (js/ui/*.js), carregados
   por ordem no index.html. Partilham o mesmo âmbito global: o que um
   declara no topo (funções, const/let) os outros usam diretamente.
   =========================================================== */
// ===========================================================
// SETUP — Battle Royale
// ===========================================================
function renderSetupBR() {
  const s = el(`
    <div class="screen">
      <div class="topbar">
        <button class="btn btn-icon" id="back-btn">${I("arrow-left")}</button>
        <h1>Battle Royale</h1>
        <div style="width:40px"></div>
      </div>
      <div class="scroll">
        <div class="footer-note" style="margin-bottom:12px">${tr("6 jogadores · 30 vidas cada · zona inicial sorteada aleatoriamente · sem commander damage. Consulta as regras completas no ecrã de jogo (ícone de informação).")}</div>
        ${seatsHeadHtml(tr("Lugares"), tr("Sortear lugares"))}
        <div class="player-setup-list" id="players-list"></div>
      </div>
      <div class="board-toolbar">
        <button class="btn btn-accent btn-block" id="start-btn">${tr("Começar Battle Royale")}</button>
      </div>
    </div>
  `);
  appEl.appendChild(s);
  const list = s.querySelector("#players-list");
  if (!draft.profileIds) draft.profileIds = draft.names.map(() => null);
  draft.names.forEach((name, i) => {
    const profile = draft.profileIds[i] ? Profiles.get(draft.profileIds[i]) : null;
    const card = el(`
      <div class="player-setup-card">
        <div class="commander-thumb" data-i="${i}" style="${commanderThumbStyle(draft.commanders[i])}">${draft.commanders[i] ? "" : I("card")}</div>
        <div class="player-setup-fields">
          <input type="text" class="name-input" placeholder="${tr("Jogador {n}", { n: i + 1 })}" value="${esc(name)}">
          <div class="commander-name">${draft.commanders[i] ? esc(draft.commanders[i].name) : tr("Sem commander escolhido")}</div>
          <button class="btn btn-ghost btn-sm profile-btn">${profileBtnHtml(profile)}</button>
          <div class="seat-extras"></div>
        </div>
      </div>
    `);
    const paintCmd = () => {
      const c = draft.commanders[i];
      card.querySelector(".commander-thumb").style.cssText = commanderThumbStyle(c);
      card.querySelector(".commander-thumb").innerHTML = c ? "" : I("card");
      card.querySelector(".commander-name").textContent = c ? c.name : tr("Sem commander escolhido");
    };
    const paintExtras = () => {
      const prof = draft.profileIds[i] ? Profiles.get(draft.profileIds[i]) : null;
      card.querySelector(".seat-extras").innerHTML = seatDeckExtrasHtml(draft.names[i], draft.commanders[i], prof);
    };
    paintExtras();
    card.querySelector(".seat-extras").addEventListener("click", (e) => {
      const ab = e.target.closest("[data-alt]");
      if (!ab) return;
      const prof = draft.profileIds[i] ? Profiles.get(draft.profileIds[i]) : null;
      const c = deckCommanders(prof)[parseInt(ab.dataset.alt, 10)];
      if (c) { draft.commanders[i] = c.commander; paintCmd(); paintExtras(); }
    });
    card.querySelector(".commander-thumb").addEventListener("click", () => {
      openCommanderPicker((c) => {
        draft.commanders[i] = c;
        paintCmd();
        paintExtras();
      });
    });
    card.querySelector(".name-input").addEventListener("input", (e) => { draft.names[i] = e.target.value; paintExtras(); });
    card.querySelector(".profile-btn").addEventListener("click", () => {
      openProfilePicker({
        commander: draft.commanders[i],
        currentProfileId: draft.profileIds[i],
        playerName: draft.names[i],
        onSelect: (id) => {
          const p = id ? Profiles.get(id) : null;
          draft.names[i] = seatNameAfterProfile(draft.names[i], draft.profileIds[i], p);
          card.querySelector(".name-input").value = draft.names[i] || "";
          draft.profileIds[i] = id;
          card.querySelector(".profile-btn").innerHTML = profileBtnHtml(p);
          if (p && p.commander) { draft.commanders[i] = p.commander; paintCmd(); }
          paintExtras();
        },
      });
    });
    list.appendChild(card);
  });
  s.querySelector("#back-btn").addEventListener("click", () => nav("menu"));
  s.querySelector("#shuffle-btn").addEventListener("click", () => {
    const order = shuffleInPlace(draft.names.map((_, i) => i));
    const pick = (arr) => order.map((k) => (arr ? arr[k] : null));
    draft.names = pick(draft.names);
    draft.commanders = pick(draft.commanders);
    draft.profileIds = pick(draft.profileIds);
    render();
    toast(tr("Lugares sorteados"));
  });
  s.querySelector("#start-btn").addEventListener("click", () => startBRFromDraft(draft));
}

function startBRFromDraft(d) {
  rememberSetup("br", d);
  const st = State.createBRGame(d.names);
  st.br.players.forEach((p, i) => {
    p.commander = d.commanders[i];
    p.profileId = (d.profileIds && d.profileIds[i]) || null;
    p.pilot = d.names[i] && d.names[i].trim() ? d.names[i].trim() : null;
  });
  State.ensureFallbackColors(st.br.players);
  State.save(st);
  game = st;
  openWhoStartsModal(
    st.br.players.map((p) => ({ id: p.id, name: p.name })),
    (winnerId) => {
      State.brSetStartingPlayer(game, winnerId);
      nav("game-br");
    }
  );
}

// ===========================================================
// JOGO — Battle Royale
// ===========================================================
function renderGameBR() {
  const br = game.br;
  const alive = State.brAlivePlayers(game);

  if (br.phase === "ended") { renderChampionScreen(); return; }

  const current = State.brCurrentPlayer(game);
  const paused = !!br.paused;
  const s = el(`
    <div class="screen">
      <div class="topbar br-topbar">
        <button class="btn btn-icon" id="menu-btn">${I("menu")}</button>
        <h1>Battle Royale</h1>
        <div class="row" style="gap:6px; flex-shrink:0;">
          <button class="btn btn-icon" id="history-btn" title="${tr("Histórico de vida")}">${I("history")}</button>
          <button class="btn btn-icon" id="reorder-btn" title="${tr("Trocar posições")}">${I("reorder")}</button>
          <button class="btn btn-icon" id="info-btn" title="${tr("Regras")}">${I("info")}</button>
        </div>
      </div>
      <div class="br-status-row">
        <div class="br-chip turn">${I("repeat")} ${tr("Ronda {n}", { n: br.roundNumber })}</div>
        <div class="br-chip">${I("user")} ${tr("Vez: {name}", { name: current ? esc(current.name) : "-" })}</div>
        <div class="br-chip">${I("clock")}<span id="chip-turn-time">${tr("Turno {time}", { time: "00:00" })}</span></div>
        <div class="br-chip">${I("hourglass")}<span id="chip-total-time">${tr("Total {time}", { time: "00:00" })}</span></div>
        <div class="br-chip ${br.phase !== "normal" ? "phase-final" : ""}">${phaseLabel(br.phase)}</div>
        <div class="br-chip">${tr("Zonas fechadas: {n}/5", { n: br.closedZones.length })}</div>
        ${paused ? `<div class="br-chip paused">${I("pause")} ${tr("Pausado")}</div>` : ""}
      </div>
      <div class="zone-map" id="zone-map"></div>
      ${br.phase === "final_circle" ? `<div class="banner">${tr("FINAL CIRCLE — não podes ganhar vidas · todos atacam todos · criaturas com haste · +2 Treasure no início de cada turno")}</div>` : ""}
      ${br.phase === "final_duel_pending" ? `<div class="banner gold">${tr("Restam 2 jogadores!")} <button class="btn btn-gold btn-sm" id="start-duel-btn" style="margin-left:8px">${tr("Iniciar Duelo Final")}</button></div>` : ""}
      ${br.phase === "final_duel" ? `<div class="banner gold">${tr("FINAL DUEL em curso — até à morte!")}</div>` : ""}
      <div class="row" style="padding:0 12px 8px;gap:8px;flex-shrink:0">
        <button class="btn btn-accent grow" id="roll-event-btn" ${br.roundEventRolled ? "disabled" : ""}>${I("dice")} ${tr("Rolar evento")}</button>
        <button class="btn btn-primary grow" id="next-turn-btn" ${paused ? "disabled" : ""}>${tr("Próximo turno")} ${I("arrow-right")}</button>
        <button class="btn btn-icon" id="pause-btn" title="${paused ? tr("Retomar") : tr("Pausar")}">${I(paused ? "play" : "pause")}</button>
      </div>
      <div class="event-log" id="event-log"></div>
      <div class="br-players" id="br-players"></div>
    </div>
  `);
  appEl.appendChild(s);

  // mapa de zonas
  const zoneMap = s.querySelector("#zone-map");
  State.ZONES.forEach((z) => {
    const closed = br.closedZones.includes(z);
    const occupants = br.players.filter((p) => !p.eliminated && p.zone === z);
    const cell = el(`
      <div class="zone-cell ${closed ? "closed" : ""}">
        <div class="zn">${z}</div>
        <div class="zone-avatars">${occupants.map((o) => `<div class="zone-avatar" style="${playerBgStyle(o)}" title="${esc(o.name)}"></div>`).join("")}</div>
      </div>
    `);
    zoneMap.appendChild(cell);
  });

  // log
  const logEl = s.querySelector("#event-log");
  br.log.slice(0, 12).forEach((entry) => {
    logEl.appendChild(el(`<div>${esc(entry.text)}</div>`));
  });

  // jogadores
  const playersList = s.querySelector("#br-players");
  br.players.forEach((p) => playersList.appendChild(buildBRRow(p, current)));

  startLiveClock(s, game.br);

  s.querySelector("#menu-btn").addEventListener("click", () => {
    if (confirm(tr("Voltar ao menu? O jogo fica guardado."))) nav("menu");
  });
  s.querySelector("#info-btn").addEventListener("click", showBRRules);
  s.querySelector("#history-btn").addEventListener("click", () => openLifeHistoryModal());
  s.querySelector("#reorder-btn").addEventListener("click", () => openReorderPositionsModal("br"));
  s.querySelector("#roll-event-btn").addEventListener("click", () => {
    const { event, roll } = State.brRollEvent(game);
    State.save(game);
    showEventResult(roll, event);
    render();
  });
  s.querySelector("#next-turn-btn").addEventListener("click", () => {
    State.brNextTurn(game);
    playTurnSound();
    render();
  });
  s.querySelector("#pause-btn").addEventListener("click", () => {
    State.brTogglePause(game);
    render();
  });
  const duelBtn = s.querySelector("#start-duel-btn");
  if (duelBtn) duelBtn.addEventListener("click", () => { State.brStartFinalDuel(game); render(); });
}

function phaseLabel(phase) {
  return { normal: tr("Fase normal"), final_circle: "Final Circle", final_duel_pending: tr("Preparar duelo"), final_duel: "Final Duel", ended: tr("Terminado") }[phase] || phase;
}

function buildBRRow(p, current) {
  const isActive = current && current.id === p.id;
  const row = el(`
    <div class="br-player-row ${isActive ? "active" : ""} ${p.eliminated ? "eliminated" : ""}">
      <div class="br-avatar" style="${playerBgStyle(p)}"></div>
      <div class="br-info">
        <div class="nm">${esc(p.name)} ${isActive ? `<span class="turn-badge-sm">${tr("A jogar")}</span>` : ""}</div>
        <div class="meta">${p.eliminated ? tr("Eliminado") : `${I("gift")} ${p.lootUsed.length}/6`}</div>
      </div>
      ${!p.eliminated ? `
      <select class="br-zone-select" data-act="zone" title="${tr("Zona atual")}">
        ${State.ZONES.map((z) => `<option value="${z}" ${z === p.zone ? "selected" : ""}>${z}</option>`).join("")}
      </select>
      <div class="br-life-stepper">
        <button class="btn btn-icon" data-act="minus">${I("minus")}</button>
        <div class="br-life">${p.life}</div>
        <button class="btn btn-icon" data-act="plus">${I("plus")}</button>
      </div>
      ` : ""}
      <div class="br-actions-mini">
        <button class="btn btn-icon" data-act="edit">${I("pencil")}</button>
        ${!p.eliminated ? `<button class="btn btn-icon" data-act="kill" title="${tr("Eliminar")}">${I("skull")}</button>` : ""}
      </div>
    </div>
  `);
  const minus = row.querySelector('[data-act="minus"]');
  const plus = row.querySelector('[data-act="plus"]');
  const zoneSel = row.querySelector('[data-act="zone"]');
  if (minus) minus.addEventListener("click", () => { State.brAdjustLife(game, p.id, -1); afterBRLifeChange(p.id); });
  if (plus) plus.addEventListener("click", () => { State.brAdjustLife(game, p.id, 1); afterBRLifeChange(p.id); });
  if (zoneSel) zoneSel.addEventListener("change", (e) => { State.brSetZone(game, p.id, e.target.value); render(); });
  row.querySelector('[data-act="edit"]').addEventListener("click", () => openEditPlayerModal({ mode: "br", playerId: p.id }));
  const killBtn = row.querySelector('[data-act="kill"]');
  if (killBtn) killBtn.addEventListener("click", () => {
    if (!confirm(tr("Eliminar {name} do jogo?", { name: p.name }))) return;
    State.brEliminate(game, p.id, []);
    State.save(game);
    openKillCreditFlow(p.id, () => render());
  });
  return row;
}

function afterBRLifeChange(pid) {
  const p = game.br.players.find((x) => x.id === pid);
  State.save(game);
  if (p.eliminated) {
    openKillCreditFlow(pid, () => render());
  } else {
    render();
  }
}

function showEventResult(roll, event) {
  closeAnyModal();
  const backdrop = el(`
    <div class="modal-backdrop center">
      <div class="modal-sheet">
        <div class="dice-face">${I("dice")}<span>${roll}</span></div>
        <div class="event-card">
          <div class="ev-title">${esc(event.title)}</div>
          <div class="ev-desc">${esc(event.desc)}</div>
        </div>
        <button class="btn btn-primary btn-block" id="ev-ok" style="margin-top:14px">${tr("Continuar")}</button>
      </div>
    </div>
  `);
  document.body.appendChild(backdrop);
  backdrop.querySelector("#ev-ok").addEventListener("click", () => backdrop.remove());
}

function openKillCreditFlow(eliminatedId, onDone) {
  const eliminated = game.br.players.find((x) => x.id === eliminatedId);
  const alive = State.brAlivePlayers(game);
  closeAnyModal();
  if (!alive.length) { onDone(); return; }
  const backdrop = el(`
    <div class="modal-backdrop center">
      <div class="modal-sheet">
        <h2>${tr("{name} foi eliminado!", { name: esc(eliminated.name) })}</h2>
        <div class="footer-note" style="margin-bottom:10px">${tr("Quem participou no abate? (se dois jogadores atacaram o mesmo alvo, escolhe ambos — os dois recebem recompensa)")}</div>
        <div class="col" id="killer-list">
          ${alive.map((a) => `
            <label class="row" style="align-items:center;background:var(--surface-2);border-radius:10px;padding:8px 10px;">
              <input type="checkbox" value="${a.id}" style="width:auto">
              <span class="grow">${esc(a.name)}</span>
            </label>
          `).join("")}
        </div>
        <div class="row" style="margin-top:14px">
          <button class="btn btn-ghost grow" id="kc-skip">${tr("Ninguém escolhe recompensa")}</button>
          <button class="btn btn-primary grow" id="kc-confirm">${tr("Confirmar")}</button>
        </div>
      </div>
    </div>
  `);
  document.body.appendChild(backdrop);
  backdrop.querySelector("#kc-skip").addEventListener("click", () => { backdrop.remove(); onDone(); });
  backdrop.querySelector("#kc-confirm").addEventListener("click", () => {
    const ids = Array.from(backdrop.querySelectorAll('input[type=checkbox]:checked')).map((i) => i.value);
    backdrop.remove();
    runLootQueue(ids, onDone);
  });
}

function runLootQueue(playerIds, onDone) {
  if (!playerIds.length) { onDone(); return; }
  const [pid, ...rest] = playerIds;
  openLootPicker(pid, () => runLootQueue(rest, onDone));
}

function openLootPicker(playerId, onDone) {
  const p = game.br.players.find((x) => x.id === playerId);
  closeAnyModal();
  const inFinal = game.br.phase === "final_circle" || game.br.phase === "final_duel_pending";
  const backdrop = el(`
    <div class="modal-backdrop center">
      <div class="modal-sheet">
        <h2>${tr("Recompensa para {name}", { name: esc(p.name) })}</h2>
        <div class="loot-grid" id="loot-grid"></div>
        <button class="btn btn-ghost btn-block" id="loot-skip" style="margin-top:12px">${tr("Não escolher recompensa")}</button>
      </div>
    </div>
  `);
  document.body.appendChild(backdrop);
  const grid = backdrop.querySelector("#loot-grid");
  Object.entries(State.LOOT).forEach(([key, reward]) => {
    const used = p.lootUsed.includes(key);
    const blockedByFinal = inFinal && reward.type === "life";
    const card = el(`
      <button class="loot-card ${used || blockedByFinal ? "used" : ""}" ${used || blockedByFinal ? "disabled" : ""}>
        <div class="ic">${I(reward.icon)}</div>
        <div class="tt">${esc(reward.title)}</div>
      </button>
    `);
    card.addEventListener("click", () => {
      State.brApplyLoot(game, playerId, key);
      State.save(game);
      toast(`${p.name}: ${reward.title}`);
      backdrop.remove();
      onDone();
    });
    grid.appendChild(card);
  });
  backdrop.querySelector("#loot-skip").addEventListener("click", () => { backdrop.remove(); onDone(); });
}

function showBRRules() {
  closeAnyModal();
  const backdrop = el(`
    <div class="modal-backdrop">
      <div class="modal-sheet" style="max-height:88vh">
        <h2>${tr("Regras — Battle Royale")}</h2>
        <div class="scroll" style="padding:0">
          <div class="footer-note col gap-sm" style="font-size:.78rem;line-height:1.5">
            ${tr("__br_rules__")}
          </div>
        </div>
        <button class="btn btn-primary btn-block" id="rules-close" style="margin-top:12px">${tr("Entendido")}</button>
      </div>
    </div>
  `);
  document.body.appendChild(backdrop);
  backdrop.querySelector("#rules-close").addEventListener("click", () => backdrop.remove());
}

function renderChampionScreen() {
  const champ = game.br.players.find((p) => p.id === game.br.championId);
  const stats = State.brComputeStats(game);
  const s = el(`
    <div class="screen champion-screen">
      <div class="champion-head">
        <div class="champion-avatar" style="${champ ? playerBgStyle(champ) : ""}"></div>
        <div class="trophy">${I("trophy")}</div>
        <div class="cname">${champ ? esc(champ.name) : "?"}</div>
        <div class="footer-note">${tr("Campeão do Battle Royale")}</div>
      </div>
      <div class="scroll" style="width:100%">${buildStatsBlock(stats)}</div>
      <div class="board-toolbar" style="width:100%">
        <button class="btn btn-accent grow" id="new-br-btn">${tr("Novo Battle Royale")}</button>
        <button class="btn btn-ghost" id="menu-btn2">Menu</button>
      </div>
    </div>
  `);
  appEl.appendChild(s);
  if (champ && celebratedGameAt !== game.createdAt) {
    celebratedGameAt = game.createdAt;
    celebrateVictory({ name: champ.name, commander: champ.commander, bgStyle: playerBgStyle(champ), subtitle: tr("Campeão do Battle Royale") });
  }
  s.querySelector("#new-br-btn").addEventListener("click", () => {
    State.clear();
    draft = { names: ["", "", "", "", "", ""], commanders: [null, null, null, null, null, null], profileIds: [null, null, null, null, null, null] };
    nav("setup-br");
  });
  s.querySelector("#menu-btn2").addEventListener("click", () => { State.clear(); nav("menu"); });
}
