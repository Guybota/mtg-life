/* ===========================================================
   ui/game-teams.js — Setup e jogo de Equipas.

   A interface está dividida em vários ficheiros (js/ui/*.js), carregados
   por ordem no index.html. Partilham o mesmo âmbito global: o que um
   declara no topo (funções, const/let) os outros usam diretamente.
   =========================================================== */
// ===========================================================
// SETUP — Equipas (Teams)
// ===========================================================
function makeTeamsDraft(numTeams, playersPerTeam, startLife) {
  const teams = [];
  for (let t = 0; t < numTeams; t++) {
    const players = [];
    for (let i = 0; i < playersPerTeam; i++) players.push({ name: "", commander: null, partnerCommander: null, profileId: null });
    teams.push({ name: tr("Equipa {n}", { n: t + 1 }), players });
  }
  return { numTeams, playersPerTeam, startLife, teams };
}

function renderSetupTeams() {
  const s = el(`
    <div class="screen">
      <div class="topbar">
        <button class="btn btn-icon" id="back-btn">${I("arrow-left")}</button>
        <h1>${tr("Equipas")}</h1>
        <div style="width:40px"></div>
      </div>
      <div class="scroll">
        <div class="setup-controls">
          <div class="field">
            <label>${tr("Equipas")}</label>
            ${chipRowHtml("teams-chips", [2, 3, 4], draft.numTeams)}
          </div>
          <div class="field">
            <label>${tr("Jogadores/equipa")}</label>
            ${chipRowHtml("ppt-chips", [1, 2, 3, 4], draft.playersPerTeam)}
          </div>
          <div class="field">
            <label>${tr("Vida inicial (por equipa)")}</label>
            ${lifeFieldHtml(draft.startLife)}
          </div>
        </div>
        ${moreOptionsHtml(tr("Tempo e turnos"), trackTurnsFieldHtml(draft.trackTurns !== false))}
        <div class="footer-note" style="margin-bottom:12px">${tr("Vida partilhada por equipa (estilo Two-Headed Giant): a equipa toda soma/perde vida em conjunto. Os turnos alternam entre equipas.")}</div>
        ${seatsHeadHtml(tr("Equipas"), tr("Sortear equipas"))}
        <div id="teams-list"></div>
      </div>
      <div class="board-toolbar">
        <button class="btn btn-primary btn-block" id="start-btn">${tr("Começar jogo")}</button>
      </div>
    </div>
  `);
  appEl.appendChild(s);

  // Mesma lógica de reconciliação por índice do setup Standard (ver ali
  // o porquê): evita destruir/recriar cards (e perder o foco de quem
  // estava a escrever um nome) sempre que outra parte do ecrã re-renderiza.
  function buildTeamPlayerCard(t, i) {
    const p = draft.teams[t].players[i];
    const profile = p.profileId ? Profiles.get(p.profileId) : null;
    const card = el(`
      <div class="player-setup-card">
        <div class="commander-thumbs">
          <div class="commander-thumb" data-role="main" style="${commanderThumbStyle(p.commander)}">${p.commander ? "" : I("card")}</div>
          <div class="commander-thumb thumb-sm" data-role="partner" title="${tr("Commander parceiro")}" style="${commanderThumbStyle(p.partnerCommander)}">${p.partnerCommander ? "" : "+"}</div>
        </div>
        <div class="player-setup-fields">
          <input type="text" class="name-input" placeholder="${tr("Jogador {n}", { n: i + 1 })}" value="${esc(p.name)}">
          <div class="commander-name">${p.commander ? esc(p.commander.name) : tr("Sem commander escolhido")}${p.partnerCommander ? " + " + esc(p.partnerCommander.name) : ""}</div>
          <button class="btn btn-ghost btn-sm profile-btn">${profileBtnHtml(profile)}</button>
          <div class="seat-extras"></div>
        </div>
      </div>
    `);
    bindSeatExtras(card, () => draft.teams[t].players[i], renderTeamsList);
    card.querySelector('.commander-thumb[data-role="main"]').addEventListener("click", () => {
      openCommanderPicker((c) => { draft.teams[t].players[i].commander = c; renderTeamsList(); });
    });
    card.querySelector('.commander-thumb[data-role="partner"]').addEventListener("click", () => {
      openCommanderPicker((c) => { draft.teams[t].players[i].partnerCommander = c; renderTeamsList(); }, tr("Escolher commander parceiro"));
    });
    card.querySelector(".name-input").addEventListener("input", (e) => {
      draft.teams[t].players[i].name = e.target.value;
      const allSeats = draft.teams.reduce((acc, tm) => acc.concat(tm.players), []);
      const flatIdx = draft.teams.slice(0, t).reduce((a, tm) => a + tm.players.length, 0) + i;
      card.querySelector(".seat-extras").innerHTML = seatExtrasHtml(draft.teams[t].players[i], flatIdx, allSeats);
    });
    card.querySelector(".profile-btn").addEventListener("click", () => {
      openProfilePicker({
        commander: draft.teams[t].players[i].commander,
        partner: draft.teams[t].players[i].partnerCommander,
        currentProfileId: draft.teams[t].players[i].profileId,
        playerName: draft.teams[t].players[i].name,
        onSelect: (id) => {
          const prof = id ? Profiles.get(id) : null;
          const tp = draft.teams[t].players[i];
          tp.name = seatNameAfterProfile(tp.name, tp.profileId, prof);
          tp.profileId = id;
          if (prof && prof.commander) { tp.commander = prof.commander; tp.partnerCommander = prof.partnerCommander || null; }
          renderTeamsList();
        },
      });
    });
    return card;
  }
  function updateTeamPlayerCard(card, t, i) {
    const p = draft.teams[t].players[i];
    const profile = p.profileId ? Profiles.get(p.profileId) : null;
    const mainThumb = card.querySelector('.commander-thumb[data-role="main"]');
    mainThumb.style.cssText = seatThumbStyle(p);
    mainThumb.innerHTML = p.commander ? "" : I("card");
    const partnerThumb = card.querySelector('.commander-thumb[data-role="partner"]');
    partnerThumb.style.cssText = commanderThumbStyle(p.partnerCommander);
    partnerThumb.textContent = p.partnerCommander ? "" : "+";
    card.querySelector(".commander-name").textContent = (p.commander ? p.commander.name : tr("Sem commander escolhido")) + (p.partnerCommander ? " + " + p.partnerCommander.name : "");
    card.querySelector(".profile-btn").innerHTML = profileBtnHtml(profile);
    const allSeats = draft.teams.reduce((acc, tm) => acc.concat(tm.players), []);
    const flatIdx = draft.teams.slice(0, t).reduce((a, tm) => a + tm.players.length, 0) + i;
    card.querySelector(".seat-extras").innerHTML = seatExtrasHtml(p, flatIdx, allSeats);
    const nameInput = card.querySelector(".name-input");
    if (document.activeElement !== nameInput) nameInput.value = p.name;
  }
  function buildTeamCard(t) {
    const team = draft.teams[t];
    const card = el(`
      <div class="team-setup-card" data-team="${t}">
        <input type="text" class="team-name-input" value="${esc(team.name)}">
        <div class="player-setup-list team-players"></div>
      </div>
    `);
    card.querySelector(".team-name-input").addEventListener("input", (e) => { draft.teams[t].name = e.target.value; });
    return card;
  }
  function renderTeamsList() {
    const list = s.querySelector("#teams-list");
    const existingTeamCards = Array.from(list.children);
    draft.teams.forEach((team, t) => {
      let teamCard = existingTeamCards[t];
      if (!teamCard) {
        teamCard = buildTeamCard(t);
        list.appendChild(teamCard);
      } else {
        const nameInput = teamCard.querySelector(".team-name-input");
        if (document.activeElement !== nameInput) nameInput.value = team.name;
      }
      const playersContainer = teamCard.querySelector(".team-players");
      team.players.forEach((p, i) => { if (!playersContainer.children[i]) playersContainer.appendChild(buildTeamPlayerCard(t, i)); });
      while (playersContainer.children.length > team.players.length) playersContainer.removeChild(playersContainer.lastChild);
    });
    while (list.children.length > draft.teams.length) list.removeChild(list.lastChild);
    // atualiza TODOS (os avisos de perfil repetido dependem dos outros lugares)
    draft.teams.forEach((team, t) => team.players.forEach((p, i) => updateTeamPlayerCard(list.children[t].querySelector(".team-players").children[i], t, i)));
  }
  renderTeamsList();

  function setNumTeams(n) {
    n = Math.max(2, Math.min(4, n || 2));
    const cur = draft.teams.length;
    if (n > cur) {
      for (let t = cur; t < n; t++) {
        const players = [];
        for (let i = 0; i < draft.playersPerTeam; i++) players.push({ name: "", commander: null, partnerCommander: null, profileId: null });
        draft.teams.push({ name: tr("Equipa {n}", { n: t + 1 }), players });
      }
    } else {
      draft.teams.length = n;
    }
    draft.numTeams = n;
    renderTeamsList();
  }
  function setPlayersPerTeam(n) {
    n = Math.max(1, Math.min(4, n || 1));
    draft.teams.forEach((team) => {
      const cur = team.players.length;
      if (n > cur) for (let i = cur; i < n; i++) team.players.push({ name: "", commander: null, partnerCommander: null, profileId: null });
      else team.players.length = n;
    });
    draft.playersPerTeam = n;
    renderTeamsList();
  }
  bindChipRow(s, "teams-chips", setNumTeams);
  bindChipRow(s, "ppt-chips", setPlayersPerTeam);
  bindLifeField(s, (v) => { draft.startLife = Math.max(1, v || 40); });
  s.querySelector("#cfg-track").addEventListener("change", (e) => { draft.trackTurns = e.target.checked; });
  s.querySelector("#back-btn").addEventListener("click", () => nav("menu"));
  s.querySelector("#shuffle-btn").addEventListener("click", () => {
    // baralha todos os jogadores e volta a distribuí-los pelas equipas,
    // mantendo o nº de jogadores por equipa (os nomes das equipas ficam)
    const all = shuffleInPlace(draft.teams.reduce((acc, t) => acc.concat(t.players), []));
    draft.teams.forEach((t) => { t.players = all.splice(0, t.players.length); });
    renderTeamsList();
    toast(tr("Equipas sorteadas"));
  });
  s.querySelector("#start-btn").addEventListener("click", () => startTeamsFromDraft(draft));
}

function startTeamsFromDraft(d) {
  rememberSetup("teams", d);
  const st = State.createTeamsGame({ numTeams: d.numTeams, playersPerTeam: d.playersPerTeam, startLife: d.startLife, trackTurns: d.trackTurns !== false });
  st.teams.teams.forEach((team, t) => {
    if (d.teams[t].name && d.teams[t].name.trim()) team.name = d.teams[t].name.trim();
    team.players.forEach((p, i) => {
      const dp = d.teams[t].players[i];
      if (dp.name && dp.name.trim()) p.name = dp.name.trim();
      p.pilot = dp.name && dp.name.trim() ? dp.name.trim() : null;
      p.commander = dp.commander;
      p.partnerCommander = dp.partnerCommander || null;
      p.profileId = dp.profileId || null;
      if (typeof dp.colorIdx === "number") p.fallbackColorIdx = dp.colorIdx;
    });
  });
  State.ensureFallbackColors(st.teams.teams.reduce((acc, t) => acc.concat(t.players), []));
  State.save(st);
  game = st;
  if (!st.teams.trackTurns) { nav("game-teams"); return; }
  const teamChoices = st.teams.teams.map((team) => ({ id: team.id, name: team.name }));
  openWhoStartsModal(teamChoices, (winnerTeamId) => {
    State.teamsSetStartingTeam(game, winnerTeamId);
    nav("game-teams");
  });
}

// ===========================================================
// JOGO — Equipas (Teams)
// ===========================================================
function teamRosterRowHtml(p, isActive) {
  return `
    <div class="team-roster-row ${isActive ? "up" : ""}" data-player-id="${p.id}">
      <div class="team-roster-thumb" style="${commanderThumbStyle(p.commander)}">${p.commander ? "" : I("card")}</div>
      <div class="team-roster-name">${esc(p.name)}</div>
      <div class="tax-badge-sm" data-action="tax" data-player-id="${p.id}" title="Commander tax">${taxBadgeText(p)}</div>
      <button class="mini-btn" data-action="edit" data-player-id="${p.id}">${I("pencil")}</button>
    </div>
  `;
}

function syncTeamEliminationBadge(panel, team) {
  const content = panel.querySelector(".content");
  let badge = panel.querySelector(".eliminated-badge");
  if (team.eliminated && !badge) {
    badge = el(`<div class="eliminated-badge" title="${tr("Toca para reverter")}">${tr("ELIMINADA")}</div>`);
    badge.addEventListener("click", (ev) => {
      ev.stopPropagation();
      State.teamsToggleEliminated(game, team.id);
      render();
    });
    content.appendChild(badge);
  } else if (!team.eliminated && badge) {
    badge.remove();
  }
}

function buildTeamPanel(team, rotated, currentTeam) {
  const isActive = currentTeam && currentTeam.id === team.id;
  const panel = el(`
    <div class="player-panel team-panel ${rotated ? "rot180" : ""} ${hasArt(team.players) ? "has-art" : ""} ${team.eliminated ? "eliminated" : ""} ${isActive ? "active-turn" : ""}" data-team-id="${team.id}">
      ${teamBgHtml(team)}
      <div class="content">
        <div class="player-header">
          <div class="player-name">${esc(team.name)}</div>
        </div>
        <div class="life-zone">
          <div class="life-tap minus"><span class="tap-circle">${I("minus")}</span></div>
          <div class="life-tap plus"><span class="tap-circle">${I("plus")}</span></div>
          <div class="life-delta-fixed"></div>
          <div class="life-total">${team.life}</div>
        </div>
        ${isActive ? `<button class="panel-pass-turn-btn" data-action="pass-turn" aria-label="${tr("Passar turno")}" title="${tr("Passar turno")}" ${game.teams.paused ? "disabled" : ""}>${I("skip")} <span class="pass-label">${tr("Passar turno")}</span><span class="pass-time" data-turn-time>00:00</span></button>` : ""}
        <div class="team-roster">${team.players.map((p) => teamRosterRowHtml(p, isActive)).join("")}</div>
      </div>
    </div>
  `);
  syncTeamEliminationBadge(panel, team);

  const minus = panel.querySelector(".life-tap.minus");
  const plus = panel.querySelector(".life-tap.plus");
  const deltaEl = panel.querySelector(".life-delta-fixed");
  let deltaAcc = 0;
  let deltaTimer = null;
  function bumpDelta(amount) {
    deltaAcc += amount;
    clearTimeout(deltaTimer);
    deltaEl.textContent = (deltaAcc > 0 ? "+" : "") + deltaAcc;
    deltaEl.classList.toggle("plus", deltaAcc >= 0);
    deltaEl.classList.toggle("minus", deltaAcc < 0);
    deltaEl.classList.add("show");
    retrigger(deltaEl, "pop");
    deltaTimer = setTimeout(() => {
      deltaEl.classList.remove("show");
      deltaAcc = 0;
    }, 2000);
  }
  bindPressRepeat(minus, () => {
    State.teamsAdjustLife(game, team.id, -1);
    updateTeamPanel(team.id);
    bumpDelta(-1);
  });
  bindPressRepeat(plus, () => {
    State.teamsAdjustLife(game, team.id, 1);
    updateTeamPanel(team.id);
    bumpDelta(1);
  });
  panel.querySelectorAll('[data-action="edit"]').forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      openEditPlayerModal({ mode: "teams", playerId: btn.dataset.playerId });
    });
  });
  panel.querySelectorAll('[data-action="tax"]').forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      openCommanderTaxModal("teams", btn.dataset.playerId);
    });
  });
  const passBtn = panel.querySelector('[data-action="pass-turn"]');
  if (passBtn) passBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    State.teamsPassTurn(game);
    playTurnSound();
    render();
  });
  return panel;
}

function updateTeamPanel(teamId) {
  const team = game.teams.teams.find((t) => t.id === teamId);
  const panel = appEl.querySelector(`.team-panel[data-team-id="${teamId}"]`);
  if (!team || !panel) return;
  panel.classList.toggle("eliminated", team.eliminated);
  setLifeAnimated(panel.querySelector(".life-total"), team.life);
  syncTeamEliminationBadge(panel, team);
}

function openEndGameTeamsModal() {
  closeAnyModal();
  const teams = game.teams.teams;
  const backdrop = el(`
    <div class="modal-backdrop center">
      <div class="modal-sheet">
        <h2>${tr("Terminar jogo")}</h2>
        <div class="footer-note" style="margin-bottom:10px">${tr("Que equipa venceu esta partida? (fica registado nos perfis ligados de todos os jogadores dessa equipa)")}</div>
        <div class="col" id="winner-list">
          ${teams.map((t) => `
            <label class="row" style="align-items:center;background:var(--surface-2);border-radius:10px;padding:10px;">
              <input type="radio" name="winner" value="${t.id}" style="width:auto">
              <span class="grow">${esc(t.name)}${t.eliminated ? tr(" (eliminada)") : ""}</span>
            </label>
          `).join("")}
          <label class="row" style="align-items:center;background:var(--surface-2);border-radius:10px;padding:10px;">
            <input type="radio" name="winner" value="" style="width:auto" checked>
            <span class="grow">${tr("Sem vencedor / não contar")}</span>
          </label>
        </div>
        <div class="row" style="margin-top:14px">
          <button class="btn btn-ghost grow" id="eg-cancel">${tr("Cancelar")}</button>
          <button class="btn btn-primary grow" id="eg-confirm">${tr("Confirmar")}</button>
        </div>
      </div>
    </div>
  `);
  document.body.appendChild(backdrop);
  backdrop.querySelector("#eg-cancel").addEventListener("click", () => backdrop.remove());
  backdrop.querySelector("#eg-confirm").addEventListener("click", () => {
    const sel = backdrop.querySelector('input[name="winner"]:checked');
    const winnerTeamId = sel && sel.value ? sel.value : null;
    const stats = State.teamsEndGame(game, winnerTeamId);
    backdrop.remove();
    nav("stats-standard", { stats, celebrate: true });
  });
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
}

function renderGameTeams() {
  const teams = game.teams.teams;
  const timed = game.teams.trackTurns !== false;
  const currentTeam = timed ? State.teamsCurrentTeam(game) : null;
  const paused = !!game.teams.paused;
  const { top, bottom } = layoutRows(teams.length);
  const topTeams = teams.slice(0, top);
  const bottomTeams = teams.slice(top);

  const s = el(`
    <div class="screen ${boardFullscreen ? "board-fullscreen" : ""}">
      ${timed ? `<div class="br-status-row">${turnChipsHtml(currentTeam ? currentTeam.name : "-", game.teams.roundNumber, paused)}</div>` : ""}
      <div class="board">
        <div class="board-row" id="row-top"></div>
        ${boardFullscreen ? fsHubHtml(game.teams, timed, paused) : ""}
        <div class="board-row" id="row-bottom"></div>
      </div>
      <div class="board-toolbar">
        <button class="btn btn-icon" id="menu-btn" title="${tr("Menu")}" aria-label="${tr("Menu")}">${I("menu")}</button>
        ${timed ? `<button class="btn btn-icon" id="pause-btn" title="${paused ? tr("Retomar") : tr("Pausar")}">${I(paused ? "play" : "pause")}</button>` : ""}
        <button class="btn btn-icon" id="history-btn" title="${tr("Histórico de vida")}">${I("history")}</button>
        <button class="btn btn-icon" id="tools-btn" title="${tr("Ferramentas da mesa")}" aria-label="${tr("Ferramentas da mesa")}">${I("dice")}</button>
        <button class="btn btn-icon" id="reorder-btn" title="${tr("Trocar posições")}">${I("reorder")}</button>
        <button class="btn btn-icon" id="reset-btn" title="${tr("Reiniciar")}">${I("rotate")}</button>
        <button class="btn btn-icon" id="fullscreen-btn" title="${boardFullscreen ? tr("Sair de ecrã inteiro") : tr("Ecrã inteiro")}">${I(boardFullscreen ? "minimize" : "maximize")}</button>
        <button class="btn btn-ghost grow" id="end-game-btn" title="${tr("Terminar")}" aria-label="${tr("Terminar")}">${I("flag")} <span class="end-label">${tr("Terminar")}</span></button>
      </div>
    </div>
  `);
  appEl.appendChild(s);
  squareToolbarIcons(s);

  const rowTop = s.querySelector("#row-top");
  const rowBottom = s.querySelector("#row-bottom");
  topTeams.forEach((t) => rowTop.appendChild(buildTeamPanel(t, true, currentTeam)));
  bottomTeams.slice().reverse().forEach((t) => rowBottom.appendChild(buildTeamPanel(t, false, currentTeam)));

  if (timed) startLiveClock(s, game.teams);

  s.querySelector("#menu-btn").addEventListener("click", () => {
    if (confirm(tr("Voltar ao menu? O jogo atual fica guardado e podes continuar mais tarde."))) nav("menu");
  });
  s.querySelector("#reset-btn").addEventListener("click", () => {
    if (!confirm(timed ? tr("Reiniciar vidas de todas as equipas e os relógios de turno/jogo?") : tr("Reiniciar vidas de todas as equipas?"))) return;
    const now = Date.now();
    game.teams.teams.forEach((team) => {
      team.life = game.teams.startLife;
      team.eliminated = false;
      team.players.forEach((p) => { p.cmdTax = 0; p.partnerCmdTax = 0; });
    });
    game.teams.roundNumber = 1;
    game.teams.roundStartIndex = game.teams.currentTurnIndex;
    game.teams.turnSeq = 1;
    game.teams.lifeLog = [];
    game.teams.gameStartedAt = now;
    game.teams.turnStartedAt = now;
    game.teams.paused = false;
    game.teams.pausedAt = null;
    State.save(game);
    render();
  });
  s.querySelectorAll("#tools-btn, #fs-tools-btn").forEach((b) => b.addEventListener("click", () => openTableTools("teams")));
  s.querySelectorAll("#pause-btn, #fs-pause-btn").forEach((b) => b.addEventListener("click", () => {
    State.teamsTogglePause(game);
    render();
  }));
  s.querySelector("#history-btn").addEventListener("click", () => openLifeHistoryModal());
  s.querySelector("#reorder-btn").addEventListener("click", () => openReorderPositionsModal("teams"));
  s.querySelector("#fullscreen-btn").addEventListener("click", () => {
    boardFullscreen = !boardFullscreen;
    render();
  });
  const fsExitBtn = s.querySelector("#fullscreen-exit-btn");
  if (fsExitBtn) fsExitBtn.addEventListener("click", () => { boardFullscreen = !boardFullscreen; render(); });
  s.querySelector("#end-game-btn").addEventListener("click", () => openEndGameTeamsModal());
}
