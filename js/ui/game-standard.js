/* ===========================================================
   ui/game-standard.js — Setup e jogo Commander / Duelo / Livre, contadores e ferramentas da mesa.

   A interface está dividida em vários ficheiros (js/ui/*.js), carregados
   por ordem no index.html. Partilham o mesmo âmbito global: o que um
   declara no topo (funções, const/let) os outros usam diretamente.
   =========================================================== */
// ===========================================================
// SETUP — Commander padrão / Duelo / Livre
// ===========================================================
function renderSetupStandard() {
  const preset = PRESETS[draft.preset];
  const s = el(`
    <div class="screen">
      <div class="topbar">
        <button class="btn btn-icon" id="back-btn">${I("arrow-left")}</button>
        <h1>${esc(preset.label)}</h1>
        <div style="width:40px"></div>
      </div>
      <div class="scroll">
        <div class="setup-controls">
          ${preset.minPlayers !== preset.maxPlayers ? `
          <div class="field">
            <label>${tr("Jogadores")}</label>
            ${chipRowHtml("players-chips", Array.from({ length: preset.maxPlayers - preset.minPlayers + 1 }, (_, i) => preset.minPlayers + i), draft.playerCount)}
          </div>` : ""}
          <div class="field">
            <label>${tr("Vida inicial")}</label>
            ${lifeFieldHtml(draft.startLife)}
          </div>
        </div>
        ${moreOptionsHtml(
          [preset.cmdDmgToggle ? "Commander damage" : "", tr("Tempo e turnos")].filter(Boolean).join(" · "),
          (preset.cmdDmgToggle ? switchFieldHtml("cfg-cmddmg", "Commander damage", tr("Contador de dano de commander por oponente (21 elimina)."), draft.cmdDmgEnabled) : "") +
          trackTurnsFieldHtml(draft.trackTurns !== false)
        )}
        ${seatsHeadHtml(tr("Lugares"), tr("Sortear lugares"))}
        <div class="mesa-card">
          <div class="mesa" id="mesa"></div>
          <div class="mesa-hint">${I("reorder")} ${tr("Arrasta um lugar para trocar · os números são a ordem dos turnos")}</div>
        </div>
        <div class="player-setup-list" id="players-list"></div>
      </div>
      <div class="board-toolbar">
        <button class="btn btn-primary btn-block" id="start-btn">${tr("Começar jogo")}</button>
      </div>
    </div>
  `);
  appEl.appendChild(s);

  // Reconciliação por índice: reaproveita os cards já existentes em vez de
  // destruir e recriar tudo a cada alteração (nº de jogadores, escolher
  // commander/perfil de OUTRO jogador, etc.) — isto evita perder o foco
  // (e o que já se tinha escrito) no campo de nome de um jogador quando
  // outra parte do ecrã dispara um re-render ao mesmo tempo.
  function buildPlayerCard(i) {
    const p = draft.players[i];
    const profile = p.profileId ? Profiles.get(p.profileId) : null;
    const card = el(`
      <div class="player-setup-card">
        <div class="commander-thumbs">
          <div class="commander-thumb" data-role="main" style="${commanderThumbStyle(p.commander)}">
            ${p.commander ? "" : I("card")}
          </div>
          <div class="commander-thumb thumb-sm" data-role="partner" title="${tr("Commander parceiro")}" style="${commanderThumbStyle(p.partnerCommander)}">
            ${p.partnerCommander ? "" : "+"}
          </div>
        </div>
        <div class="player-setup-fields">
          <input type="text" data-i="${i}" class="name-input" placeholder="${tr("Jogador {n}", { n: i + 1 })}" value="${esc(p.name)}">
          <div class="commander-name">${p.commander ? esc(p.commander.name) : tr("Sem commander escolhido")}${p.partnerCommander ? " + " + esc(p.partnerCommander.name) : ""}</div>
          <button class="btn btn-ghost btn-sm profile-btn" data-i="${i}">${profileBtnHtml(profile)}</button>
          <div class="seat-extras"></div>
        </div>
      </div>
    `);
    bindSeatExtras(card, () => draft.players[i], renderPlayersList);
    card.querySelector('.commander-thumb[data-role="main"]').addEventListener("click", () => {
      openCommanderPicker((card2) => { draft.players[i].commander = card2; renderPlayersList(); });
    });
    card.querySelector('.commander-thumb[data-role="partner"]').addEventListener("click", () => {
      openCommanderPicker((card2) => { draft.players[i].partnerCommander = card2; renderPlayersList(); }, tr("Escolher commander parceiro"));
    });
    card.querySelector(".name-input").addEventListener("input", (e) => {
      draft.players[i].name = e.target.value;
      s.querySelector("#mesa").innerHTML = mesaInnerHtml(draft.players);
      card.querySelector(".seat-extras").innerHTML = seatExtrasHtml(draft.players[i], i, draft.players);
    });
    card.querySelector(".profile-btn").addEventListener("click", () => {
      openProfilePicker({
        commander: draft.players[i].commander,
        partner: draft.players[i].partnerCommander,
        currentProfileId: draft.players[i].profileId,
        playerName: draft.players[i].name,
        onSelect: (id) => {
          const prof = id ? Profiles.get(id) : null;
          draft.players[i].name = seatNameAfterProfile(draft.players[i].name, draft.players[i].profileId, prof);
          draft.players[i].profileId = id;
          if (prof && prof.commander) { draft.players[i].commander = prof.commander; draft.players[i].partnerCommander = prof.partnerCommander || null; }
          renderPlayersList();
        },
      });
    });
    return card;
  }
  function updatePlayerCard(card, i) {
    const p = draft.players[i];
    const profile = p.profileId ? Profiles.get(p.profileId) : null;
    const mainThumb = card.querySelector('.commander-thumb[data-role="main"]');
    mainThumb.style.cssText = seatThumbStyle(p);
    mainThumb.innerHTML = p.commander ? "" : I("card");
    const partnerThumb = card.querySelector('.commander-thumb[data-role="partner"]');
    partnerThumb.style.cssText = commanderThumbStyle(p.partnerCommander);
    partnerThumb.textContent = p.partnerCommander ? "" : "+";
    card.querySelector(".commander-name").textContent = (p.commander ? p.commander.name : tr("Sem commander escolhido")) + (p.partnerCommander ? " + " + p.partnerCommander.name : "");
    card.querySelector(".profile-btn").innerHTML = profileBtnHtml(profile);
    card.querySelector(".seat-extras").innerHTML = seatExtrasHtml(p, i, draft.players);
    const nameInput = card.querySelector(".name-input");
    if (document.activeElement !== nameInput) nameInput.value = p.name;
  }
  function renderPlayersList() {
    const list = s.querySelector("#players-list");
    draft.players.forEach((p, i) => { if (!list.children[i]) list.appendChild(buildPlayerCard(i)); });
    while (list.children.length > draft.players.length) list.removeChild(list.lastChild);
    // atualiza TODOS (os avisos de perfil repetido dependem dos outros lugares)
    draft.players.forEach((p, i) => updatePlayerCard(list.children[i], i));
    s.querySelector("#mesa").innerHTML = mesaInnerHtml(draft.players);
  }
  bindMesa(s.querySelector("#mesa"), (a, b) => {
    [draft.players[a], draft.players[b]] = [draft.players[b], draft.players[a]];
    renderPlayersList();
  }, (i) => {
    const card = s.querySelector("#players-list").children[i];
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    retrigger(card, "seat-flash");
  });
  renderPlayersList();

  if (preset.minPlayers !== preset.maxPlayers) {
    function setPlayerCount(n) {
      n = Math.max(preset.minPlayers, Math.min(preset.maxPlayers, n || preset.defaultPlayers));
      const cur = draft.players.length;
      if (n > cur) for (let i = cur; i < n; i++) draft.players.push({ name: "", commander: null, partnerCommander: null, profileId: null });
      else draft.players.length = n;
      draft.playerCount = n;
      renderPlayersList();
    }
    bindChipRow(s, "players-chips", setPlayerCount);
  }
  bindLifeField(s, (v) => { draft.startLife = Math.max(1, v || preset.defaultLife); });
  if (preset.cmdDmgToggle) {
    s.querySelector("#cfg-cmddmg").addEventListener("change", (e) => { draft.cmdDmgEnabled = e.target.checked; });
  }
  s.querySelector("#cfg-track").addEventListener("change", (e) => { draft.trackTurns = e.target.checked; });
  s.querySelector("#back-btn").addEventListener("click", () => nav("menu"));
  s.querySelector("#shuffle-btn").addEventListener("click", () => {
    shuffleInPlace(draft.players);
    renderPlayersList();
    toast(tr("Lugares sorteados"));
  });
  s.querySelector("#start-btn").addEventListener("click", () => startStandardFromDraft(draft));
}

/** Cria e arranca um jogo Commander/Duelo/Livre a partir de um rascunho de
 *  setup (usado pelo botão "Começar jogo" e pelo "Repetir último jogo"). */
function startStandardFromDraft(d, opts) {
  const preset = PRESETS[d.preset];
  rememberSetup("standard", d);
  const st = State.createStandardGame({
    playerCount: d.players.length,
    startLife: d.startLife,
    commanderDamageEnabled: preset.cmdDmgToggle ? d.cmdDmgEnabled : preset.cmdDmgDefault,
    presetName: preset.key,
    trackTurns: d.trackTurns !== false,
    poisonEnabled: !!d.poisonEnabled,
  });
  st.standard.players.forEach((p, i) => {
    const dp = d.players[i];
    if (dp.name && dp.name.trim()) p.name = dp.name.trim();
    p.pilot = dp.name && dp.name.trim() ? dp.name.trim() : null;
    p.commander = dp.commander;
    p.partnerCommander = dp.partnerCommander || null;
    p.profileId = dp.profileId || null;
    if (typeof dp.colorIdx === "number") p.fallbackColorIdx = dp.colorIdx;
  });
  State.ensureFallbackColors(st.standard.players);
  State.save(st);
  game = st;
  // sem contagem de turnos não interessa quem começa; no "Começar já"
  // começa o 1.º lugar (pode-se passar o turno logo a seguir)
  if (!st.standard.trackTurns || (opts && opts.quick)) { nav("game-standard"); return; }
  openWhoStartsModal(
    st.standard.players.map((p) => ({ id: p.id, name: p.name })),
    (winnerId) => {
      State.stdSetStartingPlayer(game, winnerId);
      nav("game-standard");
    }
  );
}

// ===========================================================
// JOGO — Commander padrão / Duelo / Livre
// ===========================================================
function layoutRows(n) {
  const top = Math.floor(n / 2);
  return { top, bottom: n - top };
}

function renderGameStandard() {
  const players = game.standard.players;
  const { top, bottom } = layoutRows(players.length);
  const topPlayers = players.slice(0, top);
  const bottomPlayers = players.slice(top);
  const timed = game.standard.trackTurns !== false;
  const currentPlayer = timed ? State.stdCurrentPlayer(game) : null;
  const paused = !!game.standard.paused;

  const s = el(`
    <div class="screen ${boardFullscreen ? "board-fullscreen" : ""}">
      ${timed ? `<div class="br-status-row">${turnChipsHtml(currentPlayer ? currentPlayer.name : "-", game.standard.roundNumber, paused)}${dayNightChipHtml()}</div>` : (game.standard.dayNight ? `<div class="br-status-row">${dayNightChipHtml()}</div>` : "")}
      <div class="board">
        <div class="board-row" id="row-top"></div>
        ${boardFullscreen ? fsHubHtml(game.standard, timed, paused) : ""}
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
  // Disposição em "serpentina": a fila de baixo é colocada por ordem INVERSA
  // para que a ordem dos turnos ande sempre em sentido horário à volta da
  // mesa (top esquerda→direita, depois desce e volta direita→esquerda),
  // em vez de saltar na diagonal de um canto para o outro.
  topPlayers.forEach((p) => rowTop.appendChild(buildStandardPanel(p, true, currentPlayer)));
  bottomPlayers.slice().reverse().forEach((p) => rowBottom.appendChild(buildStandardPanel(p, false, currentPlayer)));

  if (timed) startLiveClock(s, game.standard);

  s.querySelector("#menu-btn").addEventListener("click", () => {
    if (confirm(tr("Voltar ao menu? O jogo atual fica guardado e podes continuar mais tarde."))) nav("menu");
  });
  s.querySelector("#reset-btn").addEventListener("click", () => {
    if (!confirm(timed ? tr("Reiniciar vidas, commander damage e os relógios de turno/jogo de todos os jogadores?") : tr("Reiniciar vidas e commander damage de todos os jogadores?"))) return;
    const now = Date.now();
    game.standard.players.forEach((p) => { p.life = game.standard.startLife; p.cmdDamage = {}; p.poison = 0; p.eliminated = false; p.protected = false; p.cmdTax = 0; p.partnerCmdTax = 0; p.counters = {}; p.blessing = false; });
    game.standard.monarchId = null;
    game.standard.initiativeId = null;
    game.standard.dayNight = null;
    game.standard.roundNumber = 1;
    game.standard.roundStartIndex = game.standard.currentTurnIndex;
    game.standard.turnSeq = 1;
    game.standard.lifeLog = [];
    game.standard.gameStartedAt = now;
    game.standard.turnStartedAt = now;
    game.standard.paused = false;
    game.standard.pausedAt = null;
    State.save(game);
    render();
  });
  s.querySelectorAll("#tools-btn, #fs-tools-btn").forEach((b) => b.addEventListener("click", () => openTableTools("standard")));
  s.querySelectorAll("#pause-btn, #fs-pause-btn").forEach((b) => b.addEventListener("click", () => {
    State.stdTogglePause(game);
    render();
  }));
  s.querySelector("#history-btn").addEventListener("click", () => openLifeHistoryModal());
  s.querySelector("#reorder-btn").addEventListener("click", () => openReorderPositionsModal("standard"));
  s.querySelector("#fullscreen-btn").addEventListener("click", () => {
    boardFullscreen = !boardFullscreen;
    render();
  });
  const fsExitBtn = s.querySelector("#fullscreen-exit-btn");
  if (fsExitBtn) fsExitBtn.addEventListener("click", () => { boardFullscreen = !boardFullscreen; render(); });
  s.querySelector("#end-game-btn").addEventListener("click", () => openEndGameModal());
}

function openEndGameModal() {
  closeAnyModal();
  const players = game.standard.players;
  const backdrop = el(`
    <div class="modal-backdrop center">
      <div class="modal-sheet">
        <h2>${tr("Terminar jogo")}</h2>
        <div class="footer-note" style="margin-bottom:10px">${tr("Quem venceu esta partida? (fica registado nos perfis ligados)")}</div>
        <div class="col" id="winner-list">
          ${players.map((p) => `
            <label class="row" style="align-items:center;background:var(--surface-2);border-radius:10px;padding:10px;">
              <input type="radio" name="winner" value="${p.id}" style="width:auto">
              <span class="grow">${esc(p.name)}${p.eliminated ? tr(" (eliminado)") : ""}</span>
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
    const winnerId = sel && sel.value ? sel.value : null;
    const stats = State.stdEndGame(game, winnerId);
    backdrop.remove();
    nav("stats-standard", { stats, celebrate: true });
  });
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
}

function buildStandardPanel(p, rotated, currentPlayer) {
  const cmdEnabled = game.standard.commanderDamageEnabled;
  const opponents = game.standard.players.filter((x) => x.id !== p.id);
  const isActive = currentPlayer && currentPlayer.id === p.id;
  // Badges de commander damage: faixa centrada por baixo do contador de vida.
  const cmdBadgeList = [];
  if (cmdEnabled) {
    opponents.forEach((o) => {
      cmdBadgeList.push(cmdBadgeHtml(p, o, "main"));
      if (o.partnerCommander) cmdBadgeList.push(cmdBadgeHtml(p, o, "partner"));
    });
  }
  const panel = el(`
    <div class="player-panel ${rotated ? "rot180" : ""} ${hasArt([p]) ? "has-art" : ""} ${p.eliminated ? "eliminated" : ""} ${isActive ? "active-turn" : ""}" data-player-id="${p.id}">
      ${panelBgHtml(p)}
      <div class="mini-actions">
        <button class="mini-btn" data-action="player-sheet" title="${tr("Contadores e ações")}" aria-label="${tr("Contadores e ações")}">${I("layers")}</button>
        <button class="mini-btn" data-action="edit" title="${tr("Editar jogador")}" aria-label="${tr("Editar jogador")}">${I("pencil")}</button>
      </div>
      <div class="content">
      <div class="player-header">
          <div class="player-name">${esc(p.name)}</div>
          <div class="header-badges">
            <div class="tax-badge" data-action="tax" title="Commander tax">${taxBadgeText(p)}</div>
          </div>
        </div>
        <div class="status-chips" data-action="player-sheet">${statusChipsHtml(p)}</div>
        <div class="life-zone">
          <div class="life-tap minus"><span class="tap-circle">${I("minus")}</span></div>
          <div class="life-tap plus"><span class="tap-circle">${I("plus")}</span></div>
          <div class="life-delta-fixed"></div>
          <div class="life-total">${p.life}</div>
        </div>
        ${cmdEnabled ? `<div class="commander-badges">${cmdBadgeList.join("")}</div>` : ""}
        ${isActive ? `<button class="panel-pass-turn-btn" data-action="pass-turn" aria-label="${tr("Passar turno")}" title="${tr("Passar turno")}" ${game.standard.paused ? "disabled" : ""}>${I("skip")} <span class="pass-label">${tr("Passar turno")}</span><span class="pass-time" data-turn-time>00:00</span></button>` : ""}
      </div>
    </div>
  `);
  syncEliminationBadges(panel, p);

  const minus = panel.querySelector(".life-tap.minus");
  const plus = panel.querySelector(".life-tap.plus");
  const deltaEl = panel.querySelector(".life-delta-fixed");

  // Acumula os toques consecutivos num só número (em vez de mostrar
  // "+1"/"-1" a cada toque) e só reinicia 2s depois do último toque.
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
    State.stdAdjustLife(game, p.id, -1);
    updateStandardPanel(p.id);
    bumpDelta(-1);
  });
  bindPressRepeat(plus, () => {
    State.stdAdjustLife(game, p.id, 1);
    updateStandardPanel(p.id);
    bumpDelta(1);
  });
  panel.querySelector('[data-action="edit"]').addEventListener("click", (ev) => {
    ev.stopPropagation();
    openEditPlayerModal({ mode: "standard", playerId: p.id });
  });
  panel.querySelectorAll('[data-action="player-sheet"]').forEach((b) => b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    openPlayerSheet(p.id);
  }));
  panel.querySelector('[data-action="tax"]').addEventListener("click", (ev) => {
    ev.stopPropagation();
    openCommanderTaxModal("standard", p.id);
  });
  const passBtn = panel.querySelector('[data-action="pass-turn"]');
  if (passBtn) passBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    State.stdPassTurn(game);
    playTurnSound();
    render();
  });
  if (cmdEnabled) {
    panel.querySelectorAll(".cmd-badge").forEach((b) => {
      b.addEventListener("click", (ev) => { ev.stopPropagation(); openCmdDamageModal(p.id, b.dataset.oppId); });
    });
  }
  return panel;
}

/** Texto compacto do badge de commander tax: "+{main*2}" ou, com
 *  parceiro, "+{main*2}/+{partner*2}". */
function taxBadgeText(p) {
  const main = "+" + (p.cmdTax || 0) * 2;
  if (!p.partnerCommander) return main;
  return main + "/+" + (p.partnerCmdTax || 0) * 2;
}


function openCommanderTaxModal(mode, playerId) {
  const p = mode === "teams" ? State.teamsFindPlayer(game, playerId).player : game.standard.players.find((x) => x.id === playerId);
  if (!p) return;
  closeAnyModal();
  const backdrop = el(`
    <div class="modal-backdrop center">
      <div class="modal-sheet">
        <h2>Commander tax — ${esc(p.name)}</h2>
        <div class="footer-note" style="margin-bottom:10px">${tr("Cada vez que conjuras o commander da zona de comando, o custo sobe {2}. Toca em \"+\" de cada vez que o conjurares.")}</div>
        <div class="cd-list" id="tax-list"></div>
        <button class="btn btn-ghost btn-block" id="tax-close" style="margin-top:14px">${tr("Fechar")}</button>
      </div>
    </div>
  `);
  document.body.appendChild(backdrop);
  const list = backdrop.querySelector("#tax-list");
  function buildRow(label, field, source) {
    const n = p[field] || 0;
    const row = el(`
      <div class="cd-list-item">
        <div class="nm">${esc(label)}</div>
        <button class="btn btn-icon" data-d="-1">${I("minus")}</button>
        <div class="val">+${n * 2}</div>
        <button class="btn btn-icon" data-d="1">${I("plus")}</button>
      </div>
    `);
    row.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const delta = parseInt(btn.dataset.d, 10);
        if (mode === "teams") State.teamsAdjustCmdTax(game, playerId, delta, source);
        else State.stdAdjustCmdTax(game, playerId, delta, source);
        paint();
      });
    });
    return row;
  }
  function paint() {
    list.innerHTML = "";
    list.appendChild(buildRow(p.commander ? p.commander.name : "Commander", "cmdTax", "main"));
    if (p.partnerCommander) {
      list.appendChild(buildRow(p.partnerCommander.name, "partnerCmdTax", "partner"));
    }
    const badge = appEl.querySelector(`[data-player-id="${playerId}"] .tax-badge, [data-player-id="${playerId}"] .tax-badge-sm`);
    if (badge) badge.textContent = taxBadgeText(p);
  }
  paint();
  backdrop.querySelector("#tax-close").addEventListener("click", () => backdrop.remove());
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
}

/** Modal reutilizável (setup standard e BR) para escolher quem começa o jogo:
 *  manualmente (toca no nome) ou por dados (1d6 cada, empates voltam a rolar
 *  só entre os empatados até haver um vencedor único). Chama onConfirm(playerId)
 *  assim que há uma escolha/vencedor confirmado. `players` é [{id, name}]. */
function openWhoStartsModal(players, onConfirm) {
  closeAnyModal();
  const backdrop = el(`
    <div class="modal-backdrop center">
      <div class="modal-sheet">
        <h2>${tr("Quem começa?")}</h2>
        <div class="footer-note" style="margin-bottom:10px">${tr("Escolhe manualmente ou roda os dados — ganha quem tirar o valor mais alto (empates voltam a rolar).")}</div>
        <div class="cd-list" id="who-manual-list"></div>
        <button class="btn btn-accent btn-block" id="who-roll-btn" style="margin-top:14px">${I("dice")} ${tr("Rolar dados por todos")}</button>
        <div id="who-roll-results" style="margin-top:12px"></div>
        <button class="btn btn-ghost btn-block" id="who-cancel" style="margin-top:14px">${tr("Cancelar")}</button>
      </div>
    </div>
  `);
  document.body.appendChild(backdrop);

  const manualList = backdrop.querySelector("#who-manual-list");
  players.forEach((p) => {
    const row = el(`
      <div class="cd-list-item" style="cursor:pointer" data-pid="${p.id}">
        <div class="nm">${esc(p.name)}</div>
        <div class="val">${I("chevron-right")}</div>
      </div>
    `);
    row.addEventListener("click", () => {
      backdrop.remove();
      onConfirm(p.id);
    });
    manualList.appendChild(row);
  });

  const resultsEl = backdrop.querySelector("#who-roll-results");
  backdrop.querySelector("#who-roll-btn").addEventListener("click", () => {
    let pool = players.slice();
    let rollsByPlayer = {};
    players.forEach((p) => { rollsByPlayer[p.id] = null; });

    function rollRound() {
      pool.forEach((p) => { rollsByPlayer[p.id] = 1 + Math.floor(Math.random() * 6); });
      const maxRoll = Math.max(...pool.map((p) => rollsByPlayer[p.id]));
      const winners = pool.filter((p) => rollsByPlayer[p.id] === maxRoll);
      paintResults(winners.length > 1);
      if (winners.length > 1) {
        pool = winners;
        setTimeout(rollRound, 1200);
      } else {
        const winnerId = winners[0].id;
        setTimeout(() => {
          backdrop.remove();
          onConfirm(winnerId);
        }, 1400);
      }
    }
    function paintResults(tied) {
      resultsEl.innerHTML = "";
      const list = el(`<div class="cd-list"></div>`);
      players.forEach((p) => {
        const r = rollsByPlayer[p.id];
        const inPool = pool.includes(p);
        const row = el(`
          <div class="cd-list-item" style="${inPool ? "" : "opacity:.4"}">
            <div class="nm">${esc(p.name)}</div>
            <div class="val ${r === null ? "" : "dice-roll"}">${r === null ? "…" : r}</div>
          </div>
        `);
        list.appendChild(row);
      });
      resultsEl.appendChild(list);
      if (tied) {
        resultsEl.appendChild(el(`<div class="footer-note" style="margin-top:6px">${tr("Empate — a rodar de novo só entre quem empatou...")}</div>`));
      }
    }
    backdrop.querySelector("#who-roll-btn").disabled = true;
    manualList.style.display = "none";
    rollRound();
  });

  backdrop.querySelector("#who-cancel").addEventListener("click", () => backdrop.remove());
}

/** HTML de um único badge de commander damage (main ou partner) de um oponente. */
function cmdBadgeHtml(p, o, source) {
  const key = source === "partner" ? o.id + "::partner" : o.id;
  const dmg = p.cmdDamage[key] || 0;
  const cmd = source === "partner" ? o.partnerCommander : o.commander;
  // no badge "main" (identidade do oponente), sem arte usa a mesma cor
  // sorteada do painel dele; o badge "partner" fica neutro sem arte.
  const bgStyle = source === "partner" ? (cmd && cmd.art ? `background-image:url('${esc(cmd.art)}')` : "") : playerBgStyle(o);
  return `<div class="cmd-badge ${source === "partner" ? "partner" : ""} ${dmg >= 21 ? "lethal" : ""}" data-opp-id="${o.id}" data-source="${source}" style="${bgStyle}">
    ${cmd ? "" : I("card")}<div class="dmg">${dmg}</div>
  </div>`;
}

/** Mostra/esconde e liga os cliques dos badges "ELIMINADO" / "PROTEGIDO"
 *  no painel de um jogador (mesma lógica usada na criação e na atualização
 *  parcial do painel). */
function syncEliminationBadges(panel, p) {
  const content = panel.querySelector(".content");
  let elimBadge = panel.querySelector(".eliminated-badge");
  if (p.eliminated && !elimBadge) {
    elimBadge = el(`<div class="eliminated-badge" title="${tr("Toca se uma carta evita a eliminação")}">${tr("ELIMINADO")}</div>`);
    elimBadge.addEventListener("click", (ev) => { ev.stopPropagation(); openEliminationGuardModal(p.id, true); });
    content.appendChild(elimBadge);
  } else if (!p.eliminated && elimBadge) {
    elimBadge.remove();
  }
  let protBadge = panel.querySelector(".protected-badge");
  if (p.protected && !p.eliminated && !protBadge) {
    protBadge = el(`<div class="protected-badge" title="${tr("Toca se a carta de proteção saiu do campo")}">${tr("PROTEGIDO")}</div>`);
    protBadge.addEventListener("click", (ev) => { ev.stopPropagation(); openEliminationGuardModal(p.id, false); });
    content.appendChild(protBadge);
  } else if ((!p.protected || p.eliminated) && protBadge) {
    protBadge.remove();
  }
}

function updateStandardPanel(pid) {
  const p = game.standard.players.find((x) => x.id === pid);
  const panel = appEl.querySelector(`.player-panel[data-player-id="${pid}"]`);
  if (!p || !panel) return;
  panel.classList.toggle("eliminated", p.eliminated);
  setLifeAnimated(panel.querySelector(".life-total"), p.life);
  syncEliminationBadges(panel, p);
  panel.querySelectorAll(".cmd-badge").forEach((b) => {
    const oppId = b.dataset.oppId;
    const source = b.dataset.source || "main";
    const key = source === "partner" ? oppId + "::partner" : oppId;
    const dmg = p.cmdDamage[key] || 0;
    b.querySelector(".dmg").textContent = dmg;
    b.classList.toggle("lethal", dmg >= 21);
  });
  const chips = panel.querySelector(".status-chips");
  if (chips) chips.innerHTML = statusChipsHtml(p);
}

// ===========================================================
// CONTADORES EXTRA, MONARCA/INICIATIVA, DIA/NOITE E DADOS
// Só aparecem no cartão quando estão em uso (inspirado na Lifetap:
// insígnias pequenas junto ao nome; e na Lotus: painel do próprio
// jogador, virado para ele).
// ===========================================================
const COUNTER_META = {
  poison: { icon: "flask", label: () => tr("Veneno"), lethal: 10 }, // guardado em p.poison (10 elimina)
  energy: { icon: "zap", label: () => tr("Energia") },
  experience: { icon: "star", label: () => tr("Experiência") },
  treasure: { icon: "coins", label: () => tr("Tesouros") },
  rad: { icon: "atom", label: () => tr("Rad") },
};
function statusChipsHtml(p) {
  const std = game && game.standard;
  if (!std) return "";
  let out = "";
  if (std.monarchId === p.id) out += `<span class="st-chip monarch" title="${tr("Monarca")}">${I("crown")}</span>`;
  if (std.initiativeId === p.id) out += `<span class="st-chip initiative" title="${tr("Iniciativa")}">${I("door")}</span>`;
  if (p.blessing) out += `<span class="st-chip blessing" title="${tr("City's Blessing")}">${I("shield")}</span>`;
  Object.keys(COUNTER_META).forEach((k) => {
    const v = counterValue(p, k);
    const lethal = COUNTER_META[k].lethal && v >= COUNTER_META[k].lethal;
    if (v) out += `<span class="st-chip ${k}${lethal ? " lethal" : ""}" title="${esc(COUNTER_META[k].label())}">${I(COUNTER_META[k].icon)}<b>${v}</b></span>`;
  });
  return out;
}
/** Valor de um contador do jogador (o veneno está à parte, em p.poison). */
function counterValue(p, k) {
  return k === "poison" ? p.poison || 0 : (p.counters && p.counters[k]) || 0;
}
function refreshAllStandardPanels() {
  game.standard.players.forEach((p) => updateStandardPanel(p.id));
  document.querySelectorAll("[data-daynight]").forEach((dn) => {
    dn.outerHTML = dayNightChipHtml(dn.classList.contains("fs-chip") ? "fs-chip" : "br-chip");
  });
}
function dayNightChipHtml(cls) {
  const v = game.standard && game.standard.dayNight;
  if (!v) return `<span class="${cls || "br-chip"}" data-daynight hidden></span>`;
  return `<span class="${cls || "br-chip"} daynight ${v}" data-daynight>${I(v === "day" ? "sun" : "moon")} ${v === "day" ? tr("Dia") : tr("Noite")}</span>`;
}

/** Abre uma janela virada para o jogador do cartão de onde veio (os de
 *  cima estão rodados 180°). */
function flipForPlayer(backdrop, playerId) {
  const panel = appEl.querySelector(`.player-panel[data-player-id="${playerId}"]`);
  if (panel && panel.classList.contains("rot180")) backdrop.classList.add("flip");
}

/** Painel do jogador: vida rápida (±5/±10), ações para os outros
 *  (cada adversário perde N, drenar, toda a mesa), contadores e estado. */
function openPlayerSheet(playerId) {
  const std = game.standard;
  const p = std.players.find((x) => x.id === playerId);
  if (!p) return;
  closeAnyModal();
  let n = 1;
  const backdrop = el(`
    <div class="modal-backdrop center">
      <div class="modal-sheet ps-sheet">
        <div class="ps-head">
          <h2>${esc(p.name)}</h2>
          <span class="ps-life">${I("heart")}<b data-life>${p.life}</b></span>
        </div>
        <div class="ps-quick">
          ${[-10, -5, 5, 10].map((d) => `<button class="ps-q ${d < 0 ? "minus" : "plus"}" data-life-d="${d}">${d > 0 ? "+" : "−"}${Math.abs(d)}</button>`).join("")}
        </div>

        <div class="section-title">${tr("Para os outros")}</div>
        <div class="ps-group">
          <div class="ps-n">
            <button class="ps-n-btn" data-n="1" aria-label="${tr("Mais")}">${I("plus")}</button>
            <b data-n-val>1</b>
            <button class="ps-n-btn" data-n="-1" aria-label="${tr("Menos")}">${I("minus")}</button>
          </div>
          <div class="ps-group-btns">
            <button class="btn btn-ghost btn-sm" data-group="opponents">${tr("Cada adversário −{n}", { n: "<span data-n-txt>1</span>" })}</button>
            <button class="btn btn-ghost btn-sm" data-group="drain">${tr("Drenar {n}", { n: "<span data-n-txt>1</span>" })}</button>
            <button class="btn btn-ghost btn-sm" data-group="all">${tr("Toda a mesa −{n}", { n: "<span data-n-txt>1</span>" })}</button>
          </div>
        </div>

        <div class="section-title">${tr("Contadores")}</div>
        <div class="ps-counters">${Object.keys(COUNTER_META).map((k) => `
          <div class="ps-counter ${k}" data-key="${k}">
            <span class="ps-c-label">${I(COUNTER_META[k].icon)} ${esc(COUNTER_META[k].label())}</span>
            <button class="ps-c-btn" data-c="-1" aria-label="${tr("Menos")}">${I("minus")}</button>
            <b data-c-val>${counterValue(p, k)}</b>
            <button class="ps-c-btn" data-c="1" aria-label="${tr("Mais")}">${I("plus")}</button>
          </div>`).join("")}
        </div>

        <div class="section-title">${tr("Estado")}</div>
        <div class="ps-toggles">
          <button class="ps-toggle" data-toggle="monarch">${I("crown")} ${tr("Monarca")}</button>
          <button class="ps-toggle" data-toggle="initiative">${I("door")} ${tr("Iniciativa")}</button>
          <button class="ps-toggle" data-toggle="blessing">${I("shield")} ${tr("City's Blessing")}</button>
        </div>
        <button class="btn btn-primary btn-block" id="ps-close" style="margin-top:14px">${tr("Fechar")}</button>
      </div>
    </div>`);
  flipForPlayer(backdrop, playerId);
  document.body.appendChild(backdrop);
  const paint = () => {
    backdrop.querySelector("[data-life]").textContent = p.life;
    backdrop.querySelectorAll("[data-n-txt]").forEach((x) => { x.textContent = n; });
    backdrop.querySelector("[data-n-val]").textContent = n;
    backdrop.querySelectorAll(".ps-counter").forEach((row) => {
      const k = row.dataset.key, v = counterValue(p, k);
      row.querySelector("[data-c-val]").textContent = v;
      row.classList.toggle("lethal", !!(COUNTER_META[k].lethal && v >= COUNTER_META[k].lethal));
    });
    backdrop.querySelector('[data-toggle="monarch"]').setAttribute("aria-pressed", String(std.monarchId === p.id));
    backdrop.querySelector('[data-toggle="initiative"]').setAttribute("aria-pressed", String(std.initiativeId === p.id));
    backdrop.querySelector('[data-toggle="blessing"]').setAttribute("aria-pressed", String(!!p.blessing));
  };
  paint();
  const done = () => { refreshAllStandardPanels(); paint(); };
  backdrop.querySelectorAll("[data-life-d]").forEach((b) => b.addEventListener("click", () => {
    State.stdAdjustLife(game, p.id, parseInt(b.dataset.lifeD, 10));
    retrigger(backdrop.querySelector("[data-life]"), "cdx-bump");
    done();
  }));
  backdrop.querySelectorAll("[data-n]").forEach((b) => bindPressRepeat(b, () => {
    n = Math.max(1, Math.min(99, n + parseInt(b.dataset.n, 10)));
    paint();
  }));
  backdrop.querySelectorAll("[data-group]").forEach((b) => b.addEventListener("click", () => {
    const mode = b.dataset.group;
    const hit = State.stdGroupLife(game, p.id, mode, n);
    done();
    const msg = mode === "drain" ? tr("{name} drenou {n} de {k} adversário(s)", { name: p.name, n, k: hit })
      : mode === "all" ? tr("Toda a mesa perdeu {n}", { n })
      : tr("Cada adversário perdeu {n}", { n });
    toast(msg);
  }));
  backdrop.querySelectorAll(".ps-counter").forEach((row) => row.querySelectorAll("[data-c]").forEach((b) => bindPressRepeat(b, () => {
    const k = row.dataset.key, d = parseInt(b.dataset.c, 10);
    if (k === "poison") State.stdAdjustPoison(game, p.id, d); // 10 venenos eliminam
    else State.stdAdjustCounter(game, p.id, k, d);
    done();
  })));
  backdrop.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", () => {
    const t = b.dataset.toggle;
    if (t === "monarch") State.stdSetMonarch(game, std.monarchId === p.id ? null : p.id);
    else if (t === "initiative") State.stdSetInitiative(game, std.initiativeId === p.id ? null : p.id);
    else State.stdToggleBlessing(game, p.id);
    done();
  }));
  const close = () => backdrop.remove();
  backdrop.querySelector("#ps-close").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
}

/** Ferramentas da mesa: dados, moeda, jogador ao acaso e (no modo normal)
 *  dia/noite, monarca e iniciativa. Os dados "rolam" antes de parar. */
function openTableTools(mode) {
  closeAnyModal();
  const isStd = mode === "standard";
  const std = game.standard;
  const people = isStd ? std.players.filter((p) => !p.eliminated) : game.teams.teams.filter((t) => !t.eliminated);
  const pickHtml = (key, current) => `
    <div class="tt-picks" data-pick="${key}">
      <button class="tt-pick" data-id="" aria-pressed="${!current}">${tr("Ninguém")}</button>
      ${std.players.filter((p) => !p.eliminated).map((p) => `<button class="tt-pick" data-id="${p.id}" aria-pressed="${current === p.id}">${esc(p.name)}</button>`).join("")}
    </div>`;
  const backdrop = el(`
    <div class="modal-backdrop center">
      <div class="modal-sheet tt-sheet">
        <h2>${tr("Ferramentas da mesa")}</h2>
        <div class="tt-result" aria-live="polite"><span class="tt-value" data-val>—</span><span class="tt-label" data-label>${tr("Escolhe um dado")}</span></div>
        <div class="tt-dice">
          ${[4, 6, 8, 10, 12, 20].map((d) => `<button class="tt-die" data-die="${d}">d${d}</button>`).join("")}
          <button class="tt-die wide" data-coin>${tr("Moeda")}</button>
          <button class="tt-die wide" data-random>${isStd ? tr("Jogador ao acaso") : tr("Equipa ao acaso")}</button>
        </div>
        <div class="tt-history" data-history></div>
        ${isStd ? `
          <div class="section-title">${tr("Dia / Noite")}</div>
          <div class="seg" id="tt-dn">
            <button type="button" class="seg-btn" data-dn="" aria-selected="${!std.dayNight}">—</button>
            <button type="button" class="seg-btn" data-dn="day" aria-selected="${std.dayNight === "day"}">${I("sun")} ${tr("Dia")}</button>
            <button type="button" class="seg-btn" data-dn="night" aria-selected="${std.dayNight === "night"}">${I("moon")} ${tr("Noite")}</button>
          </div>
          <div class="section-title">${I("crown")} ${tr("Monarca")}</div>
          ${pickHtml("monarch", std.monarchId)}
          <div class="section-title">${I("door")} ${tr("Iniciativa")}</div>
          ${pickHtml("initiative", std.initiativeId)}` : ""}
        <button class="btn btn-primary btn-block" id="tt-close" style="margin-top:14px">${tr("Fechar")}</button>
      </div>
    </div>`);
  document.body.appendChild(backdrop);
  const valEl = backdrop.querySelector("[data-val]");
  const labelEl = backdrop.querySelector("[data-label]");
  const hist = [];
  let rolling = null;
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // anima ~0,6 s a mostrar valores ao acaso e para no resultado
  function roll(label, faces, finalText) {
    clearInterval(rolling);
    labelEl.textContent = label;
    const finish = () => {
      clearInterval(rolling);
      rolling = null;
      valEl.textContent = finalText;
      valEl.classList.remove("rolling");
      retrigger(valEl, "cdx-bump");
      hist.unshift(`${label}: ${finalText}`);
      backdrop.querySelector("[data-history]").textContent = hist.slice(0, 6).join("  ·  ");
    };
    if (reduce) { finish(); return; }
    valEl.classList.add("rolling");
    let t = 0;
    rolling = setInterval(() => {
      valEl.textContent = faces[Math.floor(Math.random() * faces.length)];
      if ((t += 60) >= 600) finish();
    }, 60);
  }
  const rnd = (n) => {
    const a = new Uint32Array(1);
    (window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(a) : (a[0] = Math.floor(Math.random() * 4294967296));
    return a[0] % n;
  };
  backdrop.querySelectorAll("[data-die]").forEach((b) => b.addEventListener("click", () => {
    const d = parseInt(b.dataset.die, 10);
    const faces = Array.from({ length: d }, (_, i) => String(i + 1));
    roll("d" + d, faces, String(rnd(d) + 1));
  }));
  backdrop.querySelector("[data-coin]").addEventListener("click", () => {
    const sides = [tr("Cara"), tr("Coroa")];
    roll(tr("Moeda"), sides, sides[rnd(2)]);
  });
  backdrop.querySelector("[data-random]").addEventListener("click", () => {
    if (!people.length) return;
    const who = people[rnd(people.length)];
    roll(isStd ? tr("Jogador") : tr("Equipa"), people.map((x) => x.name), who.name);
    setTimeout(() => {
      const sel = isStd ? `.player-panel[data-player-id="${who.id}"]` : `.player-panel[data-team-id="${who.id}"]`;
      const panel = appEl.querySelector(sel);
      if (panel) retrigger(panel, "picked-flash");
    }, reduce ? 0 : 620);
  });
  if (isStd) {
    backdrop.querySelectorAll("#tt-dn .seg-btn").forEach((b) => b.addEventListener("click", () => {
      State.stdSetDayNight(game, b.dataset.dn || null);
      backdrop.querySelectorAll("#tt-dn .seg-btn").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
      refreshAllStandardPanels();
    }));
    backdrop.querySelectorAll("[data-pick]").forEach((group) => group.querySelectorAll(".tt-pick").forEach((b) => b.addEventListener("click", () => {
      const id = b.dataset.id || null;
      if (group.dataset.pick === "monarch") State.stdSetMonarch(game, id);
      else State.stdSetInitiative(game, id);
      group.querySelectorAll(".tt-pick").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      refreshAllStandardPanels();
    })));
  }
  const close = () => { clearInterval(rolling); backdrop.remove(); };
  backdrop.querySelector("#tt-close").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
}

function openEliminationGuardModal(playerId, isEliminated) {
  const p = game.standard.players.find((x) => x.id === playerId);
  if (!p) return;
  closeAnyModal();
  const backdrop = el(`
    <div class="modal-backdrop center">
      <div class="modal-sheet">
        <h2>${isEliminated ? tr("Jogador eliminado") : tr("Jogador protegido")}</h2>
        <div class="footer-note" style="margin-bottom:14px">
          ${isEliminated
            ? tr("{name} está eliminado (0 ou menos vidas, ou 21+ de commander damage). Se tens em jogo uma carta que evita a eliminação (ex: Platinum Angel, Worship...), podes mantê-lo no jogo.", { name: esc(p.name) })
            : tr("{name} está a ser mantido no jogo apesar de já ter sofrido a eliminação, graças a uma carta de proteção. Assim que essa carta sair do campo, volta a eliminá-lo aqui.", { name: esc(p.name) })}
        </div>
        <div class="col">
          ${isEliminated
            ? `<button class="btn btn-gold btn-block" id="eg-keep">${I("shield")} ${tr("Manter no jogo")}</button>`
            : `<button class="btn btn-primary btn-block" id="eg-reeliminate">${tr("A carta saiu — eliminar agora")}</button>`}
          <button class="btn btn-ghost btn-block" id="eg-cancel">${tr("Cancelar")}</button>
        </div>
      </div>
    </div>
  `);
  document.body.appendChild(backdrop);
  const keepBtn = backdrop.querySelector("#eg-keep");
  if (keepBtn) keepBtn.addEventListener("click", () => {
    State.stdSetProtected(game, playerId, true);
    backdrop.remove();
    render();
  });
  const reBtn = backdrop.querySelector("#eg-reeliminate");
  if (reBtn) reBtn.addEventListener("click", () => {
    State.stdSetProtected(game, playerId, false);
    backdrop.remove();
    render();
  });
  backdrop.querySelector("#eg-cancel").addEventListener("click", () => backdrop.remove());
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
}

/** Dano de commander recebido por um jogador. Cada linha é um commander
 *  adversário: valor grande com "/21", barra até ao letal e um indicador
 *  que vai somando o que se dá/tira (ex: "+3") e some 2 s depois do
 *  último toque — como o da vida. No topo, a vida do jogador com a
 *  variação desde que a janela abriu. Manter premido repete. */
function openCmdDamageModal(playerId, focusOppId) {
  const p = game.standard.players.find((x) => x.id === playerId);
  const opponents = game.standard.players.filter((x) => x.id !== playerId);
  if (focusOppId) opponents.sort((x, y) => (y.id === focusOppId) - (x.id === focusOppId));
  const LETHAL = 21;
  const lifeAtOpen = p.life;
  closeAnyModal();
  const backdrop = el(`
    <div class="modal-backdrop center">
      <div class="modal-sheet cdx-sheet">
        <h2>${tr("Dano de commander")}</h2>
        <div class="cdx-head">
          <span class="cdx-target">${tr("em {name}", { name: esc(p.name) })}</span>
          <span class="cdx-life">${I("heart")} <span id="cdx-life-from" class="hidden"></span><b id="cdx-life">${p.life}</b><span class="cdx-chip" id="cdx-life-delta"></span></span>
        </div>
        <div class="cdx-list" id="cdx-list"></div>
        <p class="cdx-note">${tr("O dano também é tirado à vida. Aos 21 do mesmo commander o jogador é eliminado.")}</p>
        <button class="btn btn-ghost btn-block" id="cd-close" style="margin-top:12px">${tr("Fechar")}</button>
      </div>
    </div>
  `);
  document.body.appendChild(backdrop);
  const list = backdrop.querySelector("#cdx-list");

  function paintLife() {
    const d = p.life - lifeAtOpen;
    backdrop.querySelector("#cdx-life").textContent = p.life;
    const from = backdrop.querySelector("#cdx-life-from");
    from.textContent = `${lifeAtOpen} → `;
    from.classList.toggle("hidden", !d);
    const chip = backdrop.querySelector("#cdx-life-delta");
    chip.textContent = d ? (d > 0 ? "+" : "−") + Math.abs(d) : "";
    chip.className = "cdx-chip" + (d ? " show " + (d < 0 ? "hurt" : "heal") : "");
  }

  function buildRow(o, source) {
    const key = source === "partner" ? o.id + "::partner" : o.id;
    const cmd = source === "partner" ? o.partnerCommander : o.commander;
    const thumb = source === "partner" ? (cmd && cmd.art ? `background-image:url('${esc(cmd.art)}')` : "") : playerBgStyle(o);
    const row = el(`
      <div class="cdx-row${o.id === focusOppId && source === "main" ? " focus" : ""}">
        <div class="cdx-top">
          <span class="cdx-thumb" style="${thumb}">${cmd && cmd.art ? "" : I("card")}</span>
          <span class="cdx-who">
            <span class="cdx-opp">${esc(o.name)}${source === "partner" ? ` <span class="turn-badge-sm partner-tag">${tr("PARCEIRO")}</span>` : ""}</span>
            <span class="cdx-cmd">${cmd ? esc(cmd.name) : tr("Sem commander")}</span>
          </span>
          <span class="cdx-chip" data-delta></span>
        </div>
        <div class="cdx-ctrl">
          <button class="cdx-btn minus" aria-label="${esc(tr("Tirar 1 de dano"))}">${I("minus")}</button>
          <span class="cdx-val"><b data-val></b><small>/${LETHAL}</small></span>
          <button class="cdx-btn plus" aria-label="${esc(tr("Dar 1 de dano"))}">${I("plus")}</button>
        </div>
        <div class="cdx-bar"><span data-bar></span></div>
        <div class="cdx-left" data-left></div>
      </div>`);
    const valEl = row.querySelector("[data-val]");
    const chip = row.querySelector("[data-delta]");
    let acc = 0;
    let accTimer = null;
    function paint() {
      const dmg = p.cmdDamage[key] || 0;
      valEl.textContent = dmg;
      const pct = Math.min(100, (dmg / LETHAL) * 100);
      row.querySelector("[data-bar]").style.width = pct + "%";
      row.classList.toggle("warn", dmg >= 15 && dmg < LETHAL);
      row.classList.toggle("lethal", dmg >= LETHAL);
      row.querySelector("[data-left]").textContent = dmg >= LETHAL ? tr("Letal") : tr("Faltam {n} para letal", { n: LETHAL - dmg });
      row.querySelector(".cdx-btn.minus").disabled = dmg === 0;
    }
    function change(d) {
      const before = p.cmdDamage[key] || 0;
      State.stdAdjustCmdDamage(game, playerId, o.id, d, source);
      const applied = (p.cmdDamage[key] || 0) - before;
      if (!applied) return;
      acc += applied;
      chip.textContent = (acc > 0 ? "+" : "−") + Math.abs(acc);
      chip.className = "cdx-chip show " + (acc > 0 ? "hurt" : "heal");
      if (!acc) chip.className = "cdx-chip";
      clearTimeout(accTimer);
      accTimer = setTimeout(() => { acc = 0; chip.className = "cdx-chip"; }, 2000);
      retrigger(valEl, "cdx-bump");
      updateStandardPanel(playerId);
      paint();
      paintLife();
    }
    bindPressRepeat(row.querySelector(".cdx-btn.minus"), () => change(-1));
    bindPressRepeat(row.querySelector(".cdx-btn.plus"), () => change(1));
    paint();
    return row;
  }

  opponents.forEach((o) => {
    list.appendChild(buildRow(o, "main"));
    if (o.partnerCommander) list.appendChild(buildRow(o, "partner"));
  });
  paintLife();
  backdrop.querySelector("#cd-close").addEventListener("click", () => backdrop.remove());
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
}

function openEditPlayerModal({ mode, playerId }) {
  const p = mode === "standard" ? game.standard.players.find((x) => x.id === playerId)
    : mode === "teams" ? State.teamsFindPlayer(game, playerId).player
    : game.br.players.find((x) => x.id === playerId);
  let pendingCommander = p.commander;
  let pendingPartnerCommander = p.partnerCommander || null;
  let pendingProfileId = p.profileId || null;
  closeAnyModal();
  const backdrop = el(`
    <div class="modal-backdrop center">
      <div class="modal-sheet">
        <h2>${tr("Editar jogador")}</h2>
        <div class="col">
          <label>${tr("Nome")}</label>
          <input type="text" id="ep-name" value="${esc(p.name)}">
          <div class="row" style="align-items:center;margin-top:6px">
            <div class="commander-thumb" id="ep-thumb" style="${commanderThumbStyle(p.commander)}">${p.commander ? "" : I("card")}</div>
            <button class="btn btn-ghost grow" id="ep-commander">${tr("Alterar Commander")}</button>
          </div>
          ${(mode === "standard" || mode === "teams") ? `
          <div class="row" style="align-items:center;margin-top:6px">
            <div class="commander-thumb" id="ep-thumb-partner" style="${commanderThumbStyle(p.partnerCommander)}">${p.partnerCommander ? "" : I("card")}</div>
            <button class="btn btn-ghost grow" id="ep-partner">${p.partnerCommander ? tr("Alterar Parceiro") : tr("Adicionar commander parceiro")}</button>
          </div>` : ""}
          <button class="btn btn-ghost btn-sm" id="ep-profile" style="margin-top:6px">${profileBtnHtml(pendingProfileId ? (Profiles.get(pendingProfileId) || { name: tr("Perfil") }) : null)}</button>
          ${mode === "standard" ? `<button class="btn ${p.eliminated ? "btn-primary" : "btn-ghost"}" id="ep-elim" style="margin-top:6px">${p.eliminated ? tr("Reviver jogador") : tr("Marcar como eliminado")}</button>` : ""}
        </div>
        <div class="row" style="margin-top:14px">
          <button class="btn btn-ghost grow" id="ep-cancel">${tr("Cancelar")}</button>
          <button class="btn btn-primary grow" id="ep-save">${tr("Guardar")}</button>
        </div>
      </div>
    </div>
  `);
  document.body.appendChild(backdrop);
  backdrop.querySelector("#ep-commander").addEventListener("click", () => {
    openCommanderPicker((c) => {
      pendingCommander = c;
      const thumb = backdrop.querySelector("#ep-thumb");
      thumb.style.cssText = commanderThumbStyle(c);
      thumb.innerHTML = c ? "" : I("card");
    });
  });
  const partnerBtn = backdrop.querySelector("#ep-partner");
  if (partnerBtn) {
    partnerBtn.addEventListener("click", () => {
      openCommanderPicker((c) => {
        pendingPartnerCommander = c;
        const thumb = backdrop.querySelector("#ep-thumb-partner");
        thumb.style.cssText = commanderThumbStyle(c);
        thumb.innerHTML = c ? "" : I("card");
        partnerBtn.textContent = c ? tr("Alterar Parceiro") : tr("Adicionar commander parceiro");
      }, tr("Escolher commander parceiro"));
    });
  }
  backdrop.querySelector("#ep-profile").addEventListener("click", () => {
    openProfilePicker({
      commander: pendingCommander,
      partner: pendingPartnerCommander,
      currentProfileId: pendingProfileId,
      playerName: backdrop.querySelector("#ep-name").value,
      onSelect: (id) => {
        pendingProfileId = id;
        const prof = id ? Profiles.get(id) : null;
        backdrop.querySelector("#ep-profile").innerHTML = profileBtnHtml(prof);
        if (prof && prof.commander) {
          pendingCommander = prof.commander;
          const thumb = backdrop.querySelector("#ep-thumb");
          thumb.style.cssText = commanderThumbStyle(prof.commander);
          thumb.textContent = "";
          // o parceiro do deck vem junto (só nos modos com parceiros)
          const pThumb = backdrop.querySelector("#ep-thumb-partner");
          if (pThumb) {
            pendingPartnerCommander = prof.partnerCommander || null;
            pThumb.style.cssText = commanderThumbStyle(pendingPartnerCommander);
            pThumb.innerHTML = pendingPartnerCommander ? "" : I("card");
          }
        }
        const nameEl = backdrop.querySelector("#ep-name");
        // o nome por defeito ("Jogador 2") não conta como alguém escrito
        const typed = nameEl.value.trim() && (p.pilot || nameEl.value.trim() !== p.name) ? nameEl.value : "";
        nameEl.value = seatNameAfterProfile(typed, p.profileId, prof) || nameEl.value;
      },
    });
  });
  let toggledElim = p.eliminated;
  const elimBtn = backdrop.querySelector("#ep-elim");
  if (elimBtn) {
    elimBtn.addEventListener("click", () => {
      toggledElim = !toggledElim;
      elimBtn.textContent = toggledElim ? tr("Reviver jogador") : tr("Marcar como eliminado");
      elimBtn.className = "btn " + (toggledElim ? "btn-primary" : "btn-ghost");
    });
  }
  backdrop.querySelector("#ep-cancel").addEventListener("click", () => backdrop.remove());
  backdrop.querySelector("#ep-save").addEventListener("click", () => {
    const name = backdrop.querySelector("#ep-name").value.trim() || p.name;
    // quem está a jogar (para decks emprestados): só um nome escrito/mudado
    if (name !== p.name) p.pilot = name;
    if (mode === "standard") {
      State.stdSetName(game, playerId, name);
      State.stdSetCommander(game, playerId, pendingCommander);
      State.stdSetPartnerCommander(game, playerId, pendingPartnerCommander);
      State.stdSetProfile(game, playerId, pendingProfileId);
      if (toggledElim !== p.eliminated) State.stdToggleEliminated(game, playerId);
    } else if (mode === "teams") {
      State.teamsSetName(game, playerId, name);
      State.teamsSetCommander(game, playerId, pendingCommander);
      State.teamsSetPartnerCommander(game, playerId, pendingPartnerCommander);
      State.teamsSetProfile(game, playerId, pendingProfileId);
    } else {
      State.brSetName(game, playerId, name);
      State.brSetCommander(game, playerId, pendingCommander);
      State.brSetProfile(game, playerId, pendingProfileId);
    }
    backdrop.remove();
    render();
  });
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
}
