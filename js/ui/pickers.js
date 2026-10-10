/* ===========================================================
   ui/pickers.js — Menu principal e janelas de escolha (commander, arte, perfil, lugares).

   A interface está dividida em vários ficheiros (js/ui/*.js), carregados
   por ordem no index.html. Partilham o mesmo âmbito global: o que um
   declara no topo (funções, const/let) os outros usam diretamente.
   =========================================================== */
// ===========================================================
// MENU PRINCIPAL
// ===========================================================
function renderMenu() {
  const saved = State.load();
  const last = loadLastSetup();
  const s = el(`
    <div class="screen menu-screen">
      <header class="menu-head">
        <div class="logo">MTG <span>LIFE</span> COUNTER</div>
        <button class="btn btn-ghost menu-profiles" id="profiles-btn">${I("user")} ${tr("Perfis")}</button>
      </header>
      ${saved ? `<button class="btn btn-gold btn-block menu-resume" id="resume-btn">${I("play")} ${tr("Continuar jogo em curso")}</button>` : ""}
      ${backupReminderHtml()}
      ${last ? lastSetupCardHtml(last) : ""}
      <div class="mode-grid">
        <div class="mode-card commander wide" data-mode="commander">
          <div class="icon">${I("crown")}</div>
          <div class="mode-text">
            <div class="title">${tr("Commander Padrão")}</div>
            <div class="desc">${tr("2–8 jogadores · 40 vidas · Commander damage")}</div>
          </div>
        </div>
        <div class="mode-card duel" data-mode="duel">
          <div class="icon">${I("swords")}</div>
          <div class="mode-text">
            <div class="title">${tr("Duelo 1v1")}</div>
            <div class="desc">${tr("2 jogadores · 40 vidas")}</div>
          </div>
        </div>
        <div class="mode-card free" data-mode="free">
          <div class="icon">${I("sliders")}</div>
          <div class="mode-text">
            <div class="title">${tr("Livre")}</div>
            <div class="desc">${tr("Jogadores e vida à escolha")}</div>
          </div>
        </div>
        <div class="mode-card br" data-mode="br">
          <div class="icon">${I("droplet")}</div>
          <div class="mode-text">
            <div class="title">Battle Royale</div>
            <div class="desc">${tr("6 jogadores · zonas · loot")}</div>
          </div>
        </div>
        <div class="mode-card teams" data-mode="teams">
          <div class="icon">${I("users")}</div>
          <div class="mode-text">
            <div class="title">${tr("Equipas")}</div>
            <div class="desc">${tr("Vida partilhada por equipa")}</div>
          </div>
        </div>
      </div>
    </div>
  `);
  appEl.appendChild(s);

  if (saved) {
    s.querySelector("#resume-btn").addEventListener("click", () => {
      game = saved;
      if (saved.mode === "br") nav("game-br");
      else if (saved.mode === "teams" && saved.teams.ended) nav("stats-standard", { stats: State.teamsComputeStats(saved) });
      else if (saved.mode === "teams") nav("game-teams");
      else if (saved.mode === "standard" && saved.standard.ended) nav("stats-standard", { stats: State.stdComputeStats(saved) });
      else nav("game-standard");
    });
  }
  s.querySelector("#profiles-btn").addEventListener("click", () => nav("profiles"));
  const backupBtn = s.querySelector("#backup-btn");
  if (backupBtn) {
    const hide = () => { const c = s.querySelector(".backup-card"); if (c) c.remove(); };
    backupBtn.addEventListener("click", () => saveBackup().then((ok) => ok && hide()));
    s.querySelector("#backup-later-btn").addEventListener("click", () => { setBackupInfo({ snooze: Profiles.gameCount() }); hide(); });
  }
  if (last) {
    const cloneDraft = () => JSON.parse(JSON.stringify(last.draft));
    s.querySelector("#repeat-btn").addEventListener("click", () => {
      if (saved && !confirm(tr("Já existe um jogo em curso. Começar um novo jogo vai substituí-lo. Continuar?"))) return;
      draft = cloneDraft();
      if (last.kind === "br") startBRFromDraft(draft);
      else if (last.kind === "teams") startTeamsFromDraft(draft);
      else startStandardFromDraft(draft);
    });
    s.querySelector("#adjust-btn").addEventListener("click", () => {
      if (saved && !confirm(tr("Já existe um jogo em curso. Começar um novo jogo vai substituí-lo. Continuar?"))) return;
      draft = cloneDraft();
      nav(last.kind === "br" ? "setup-br" : last.kind === "teams" ? "setup-teams" : "setup-standard");
    });
  }
  s.querySelectorAll(".mode-card").forEach((card) => {
    card.addEventListener("click", () => {
      const mode = card.dataset.mode;
      if (saved && !confirm(tr("Já existe um jogo em curso. Começar um novo jogo vai substituí-lo. Continuar?"))) return;
      if (mode === "br") {
        draft = { names: ["", "", "", "", "", ""], commanders: [null, null, null, null, null, null], profileIds: [null, null, null, null, null, null] };
        nav("setup-br");
      } else if (mode === "teams") {
        draft = makeTeamsDraft(2, 2, 40);
        nav("setup-teams");
      } else {
        draft = makeStandardDraft(mode);
        openQuickStartSheet(mode);
      }
    });
  });
}

function makeStandardDraft(mode) {
  const preset = PRESETS[mode];
  return {
    preset: preset.key,
    playerCount: preset.defaultPlayers,
    startLife: preset.defaultLife,
    cmdDmgEnabled: preset.cmdDmgDefault,
    players: Array.from({ length: preset.defaultPlayers }, () => ({ name: "", commander: null, partnerCommander: null, profileId: null })),
  };
}

/** "Começar já": folha rápida ao escolher Commander/Duelo/Livre — só nº de
 *  jogadores e vida; nomes/commanders ajustam-se depois no lápis de cada
 *  painel. "Configurar jogadores primeiro" abre o setup completo. */
function openQuickStartSheet(mode) {
  const preset = PRESETS[mode];
  const fixed = preset.minPlayers === preset.maxPlayers;
  const icon = { commander: "crown", duel: "swords", free: "sliders" }[mode];
  const backdrop = el(`
    <div class="modal-backdrop">
      <div class="modal-sheet quick-sheet">
        <div class="quick-head">
          <span class="quick-icon ${mode}">${I(icon)}</span>
          <div><h2>${esc(preset.label)}</h2><div class="footer-note">${tr("Começa já — o resto ajusta-se no tabuleiro")}</div></div>
        </div>
        ${fixed ? "" : `
        <div class="field">
          <label>${tr("Jogadores")}</label>
          <div class="quick-stepper">
            <button type="button" class="btn btn-icon" id="qs-minus" aria-label="${tr("Menos um jogador")}">${I("minus")}</button>
            <span class="quick-count" id="qs-count">${draft.playerCount}</span>
            <button type="button" class="btn btn-icon" id="qs-plus" aria-label="${tr("Mais um jogador")}">${I("plus")}</button>
          </div>
        </div>`}
        <div class="field">
          <label>${tr("Vida inicial")}</label>
          ${lifeFieldHtml(draft.startLife)}
        </div>
        <div class="quick-note">${I("pencil")}<span>${tr("Nomes, commanders e perfis: toca no lápis de cada jogador durante o jogo.")}</span></div>
        <button class="btn btn-primary btn-block quick-go" id="qs-go">${I("play")} ${tr("Começar já")}</button>
        <button class="btn btn-ghost btn-block" id="qs-setup">${tr("Configurar jogadores primeiro")}</button>
      </div>
    </div>
  `);
  document.body.appendChild(backdrop);
  const setCount = (n) => {
    n = Math.max(preset.minPlayers, Math.min(preset.maxPlayers, n));
    draft.playerCount = n;
    draft.players = Array.from({ length: n }, (_, i) => draft.players[i] || { name: "", commander: null, partnerCommander: null, profileId: null });
    backdrop.querySelector("#qs-count").textContent = n;
  };
  if (!fixed) {
    backdrop.querySelector("#qs-minus").addEventListener("click", () => setCount(draft.playerCount - 1));
    backdrop.querySelector("#qs-plus").addEventListener("click", () => setCount(draft.playerCount + 1));
  }
  bindLifeField(backdrop, (v) => { draft.startLife = Math.max(1, v || preset.defaultLife); });
  backdrop.querySelector("#qs-go").addEventListener("click", () => {
    backdrop.remove();
    startStandardFromDraft(draft, { quick: true });
  });
  backdrop.querySelector("#qs-setup").addEventListener("click", () => { backdrop.remove(); nav("setup-standard"); });
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
}

// ===========================================================
// COMMANDER PICKER (modal reutilizável)
// ===========================================================
function openCommanderPicker(onSelect, title) {
  // (sem closeAnyModal aqui de propósito: este picker pode abrir por cima
  // de outro modal já aberto, ex. dentro do ecrã de editar jogador)
  const backdrop = el(`
    <div class="modal-backdrop">
      <div class="modal-sheet search-sheet">
        <h2>${esc(title || tr("Escolher commander"))}</h2>
        <input type="text" id="cp-input" enterkeyhint="search" placeholder="${tr("Nome do commander (ex: Atraxa, Krenko...)")}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
        <div class="search-status hidden" id="cp-status"></div>
        <div class="search-results" id="cp-results"></div>
        <div class="sheet-foot">
        <div class="row" style="margin-top:10px">
          <button class="btn btn-ghost grow" id="cp-manual">${I("image")} ${tr("Imagem manual")}</button>
          <button class="btn btn-ghost grow" id="cp-none">${I("ban")} ${tr("Sem imagem")}</button>
        </div>
        <div id="cp-manual-form" class="col hidden" style="margin-top:10px">
          <input type="text" id="cp-manual-name" placeholder="${tr("Nome do commander")}">
          <input type="text" id="cp-manual-url" placeholder="${tr("URL da imagem (https://...)")}">
          <button class="btn btn-primary" id="cp-manual-confirm">${tr("Usar esta imagem")}</button>
        </div>
        <button class="btn btn-ghost" id="cp-cancel" style="margin-top:10px">${tr("Cancelar")}</button>
        </div>
      </div>
    </div>
  `);
  document.body.appendChild(backdrop);
  const input = backdrop.querySelector("#cp-input");
  // "Pesquisar" no teclado fecha-o para se verem todos os resultados
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
  const results = backdrop.querySelector("#cp-results");
  const status = backdrop.querySelector("#cp-status");
  input.focus();

  function setStatus(text) {
    if (!text) { status.classList.add("hidden"); return; }
    status.textContent = text;
    status.classList.remove("hidden");
  }

  const doSearch = debounce(async (q) => {
    if (q.trim().length < 2) { results.innerHTML = ""; setStatus(""); return; }
    setStatus(tr("A pesquisar na Scryfall…"));
    try {
      const cards = await Scryfall.searchCommanders(q);
      setStatus(cards.length ? "" : tr("Sem resultados para esse nome."));
      results.innerHTML = "";
      results.scrollTop = 0;
      cards.forEach((card) => {
        const item = el(`
          <div class="search-result-item">
            <img src="${card.art ? esc(card.art) : ""}" onerror="this.style.visibility='hidden'">
            <div class="info">
              <div class="name">${esc(card.name)}</div>
              <div class="type">${esc(card.typeLine)}</div>
            </div>
            ${card.printsUri ? `<button class="btn btn-icon versions-btn" title="${tr("Escolher arte/versão alternativa")}">${I("palette")}</button>` : ""}
          </div>
        `);
        item.addEventListener("click", () => {
          onSelect(card);
          backdrop.remove();
        });
        const versionsBtn = item.querySelector(".versions-btn");
        if (versionsBtn) {
          versionsBtn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            openVersionPicker(card, (chosen) => onSelect(chosen), backdrop);
          });
        }
        results.appendChild(item);
      });
    } catch (err) {
      setStatus(tr("Sem ligação à Scryfall. Tenta a imagem manual abaixo."));
    }
  }, 350);

  input.addEventListener("input", () => doSearch(input.value));
  backdrop.querySelector("#cp-cancel").addEventListener("click", () => backdrop.remove());
  backdrop.querySelector("#cp-none").addEventListener("click", () => { onSelect(null); backdrop.remove(); });
  backdrop.querySelector("#cp-manual").addEventListener("click", () => {
    backdrop.querySelector("#cp-manual-form").classList.toggle("hidden");
  });
  backdrop.querySelector("#cp-manual-confirm").addEventListener("click", () => {
    const name = backdrop.querySelector("#cp-manual-name").value.trim() || "Commander";
    const url = backdrop.querySelector("#cp-manual-url").value.trim();
    if (!url) { toast(tr("Indica uma URL de imagem válida.")); return; }
    onSelect({ id: "manual_" + Date.now(), name, art: url, artNormal: url });
    backdrop.remove();
  });
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
}

// ===========================================================
// VERSION PICKER (modal reutilizável) — escolher arte/edição alternativa
// de uma carta já encontrada na pesquisa (abre por cima do commander picker)
// ===========================================================
function openVersionPicker(baseCard, onSelect, parentBackdrop) {
  // (sem closeAnyModal aqui de propósito: abre por cima do commander picker)
  const backdrop = el(`
    <div class="modal-backdrop">
      <div class="modal-sheet">
        <h2>${tr("Escolher arte — {name}", { name: esc(baseCard.name) })}</h2>
        <div class="search-status" id="vp-status">${tr("A carregar edições…")}</div>
        <div class="search-results" id="vp-results"></div>
        <button class="btn btn-ghost" id="vp-cancel" style="margin-top:10px">${tr("Cancelar")}</button>
      </div>
    </div>
  `);
  document.body.appendChild(backdrop);
  const results = backdrop.querySelector("#vp-results");
  const status = backdrop.querySelector("#vp-status");

  function selectVersion(card) {
    onSelect(card);
    backdrop.remove();
    if (parentBackdrop) parentBackdrop.remove();
  }

  (async () => {
    try {
      const prints = await Scryfall.getPrints(baseCard.printsUri);
      if (!prints.length) {
        status.textContent = tr("Não há outras edições/artes disponíveis para esta carta.");
        return;
      }
      status.classList.add("hidden");
      prints.forEach((card) => {
        const item = el(`
          <div class="search-result-item">
            <img src="${card.art ? esc(card.art) : ""}" onerror="this.style.visibility='hidden'">
            <div class="info">
              <div class="name">${esc(card.setName || card.set)}</div>
              <div class="type">${esc(card.artist ? tr("Arte de {artist}", { artist: card.artist }) : "")}${card.collectorNumber ? " · #" + esc(card.collectorNumber) : ""}</div>
            </div>
          </div>
        `);
        item.addEventListener("click", () => selectVersion(card));
        results.appendChild(item);
      });
    } catch (err) {
      status.textContent = tr("Não foi possível carregar as edições/artes. Tenta novamente.");
    }
  })();

  backdrop.querySelector("#vp-cancel").addEventListener("click", () => backdrop.remove());
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
}

// ===========================================================
// PROFILE PICKER (modal reutilizável) — ligar/criar perfil de commander
// ===========================================================
function openProfilePicker({ commander, currentProfileId, playerName, onSelect }) {
  let newCommander = commander || null; // commander do perfil novo (pode pesquisar-se aqui)
  // (sem closeAnyModal aqui de propósito: pode abrir por cima do modal de editar jogador)
  const profiles = Profiles.all();
  const backdrop = el(`
    <div class="modal-backdrop">
      <div class="modal-sheet">
        <h2>${tr("Perfil do jogador")}</h2>
        <div class="footer-note" style="margin-bottom:10px">${tr("Os perfis guardam as estatísticas deste commander entre jogos (vitórias, tempo médio por turno/jogo, etc).")}</div>
        ${profiles.length > 6 ? `<label class="search-field pp-search">${I("search")}<input type="search" id="pp-filter" placeholder="${tr("Procurar perfil, commander ou jogador")}" aria-label="${tr("Procurar perfis")}" autocomplete="off"></label>` : ""}
        <div class="col" id="pp-list" style="max-height:38vh;overflow-y:auto"></div>
        <div class="row" style="margin-top:10px">
          <button class="btn btn-ghost grow" id="pp-new">${I("plus")} ${tr("Criar novo perfil")}</button>
          ${currentProfileId ? `<button class="btn btn-ghost grow" id="pp-clear">${I("x")} ${tr("Remover perfil")}</button>` : ""}
        </div>
        <div id="pp-new-form" class="col hidden" style="margin-top:10px">
          <div class="pp-new-cmd">
            <span class="commander-thumb sm" id="pp-new-thumb"></span>
            <span class="pp-new-cmd-name" id="pp-new-cmd-name"></span>
            <button type="button" class="btn btn-ghost btn-sm" id="pp-new-cmd-btn">${I("search")} ${tr("Procurar commander")}</button>
          </div>
          <input type="text" id="pp-new-name" placeholder="${tr("Nome do perfil")}" value="${commander ? esc(commander.name) : ""}">
          <label for="pp-new-owner">${tr("Dono do deck")}</label>
          <input type="text" id="pp-new-owner" placeholder="${tr("Nome de quem é este deck")}" value="${esc(playerName && !/^\s*$/.test(playerName) ? playerName : "")}">
          ${ownerChipsHtml("pp-owners")}
          <button class="btn btn-primary" id="pp-new-confirm">${tr("Criar e ligar")}</button>
        </div>
        <button class="btn btn-ghost" id="pp-cancel" style="margin-top:10px">${tr("Cancelar")}</button>
      </div>
    </div>
  `);
  document.body.appendChild(backdrop);
  const list = backdrop.querySelector("#pp-list");
  if (!profiles.length) {
    list.appendChild(el(`<div class="search-status">${tr("Ainda não tens perfis guardados.")}</div>`));
  }
  profiles.forEach((p) => {
    const d = Profiles.derived(p);
    const item = el(`
      <div class="search-result-item ${p.id === currentProfileId ? "lethal" : ""}" style="${p.id === currentProfileId ? "border:1px solid var(--text)" : ""}">
        ${p.commander && p.commander.art ? `<img src="${esc(p.commander.art)}">` : `<div style="width:44px;height:44px;display:flex;align-items:center;justify-content:center">${I("card")}</div>`}
        <div>
          <div class="name">${esc(p.name)}</div>
          <div class="type">${p.playerName ? esc(p.playerName) + " · " : ""}${tr("{g} jogos · {w} vitórias", { g: d.games, w: d.wins })}${d.games ? " (" + Math.round(d.winRate * 100) + "%)" : ""}</div>
        </div>
      </div>
    `);
    item.addEventListener("click", () => { onSelect(p.id); backdrop.remove(); });
    item._search = normName([p.name, p.playerName, p.commander && p.commander.name].join(" "));
    list.appendChild(item);
  });
  const filter = backdrop.querySelector("#pp-filter");
  if (filter) filter.addEventListener("input", () => {
    const q = normName(filter.value);
    Array.from(list.children).forEach((it) => it.classList.toggle("hidden", !!q && !(it._search || "").includes(q)));
  });
  const nameEl = backdrop.querySelector("#pp-new-name");
  function paintNewCommander() {
    const thumb = backdrop.querySelector("#pp-new-thumb");
    thumb.style.cssText = commanderThumbStyle(newCommander);
    thumb.innerHTML = newCommander && newCommander.art ? "" : I("card");
    backdrop.querySelector("#pp-new-cmd-name").textContent = newCommander ? newCommander.name : tr("Sem commander");
    backdrop.querySelector("#pp-new-cmd-btn").lastChild.textContent = " " + (newCommander ? tr("Trocar") : tr("Procurar commander"));
  }
  function searchCommander() {
    openCommanderPicker((c) => {
      // o nome do perfil acompanha o commander, a não ser que já se tenha escrito outro
      if (!nameEl.value.trim() || (newCommander && nameEl.value.trim() === newCommander.name)) nameEl.value = c ? c.name : nameEl.value;
      newCommander = c;
      paintNewCommander();
      if (!nameEl.value.trim()) nameEl.focus();
    });
  }
  paintNewCommander();
  backdrop.querySelector("#pp-new-cmd-btn").addEventListener("click", searchCommander);
  bindOwnerChips(backdrop, "pp-owners", backdrop.querySelector("#pp-new-owner"));
  backdrop.querySelector("#pp-cancel").addEventListener("click", () => backdrop.remove());
  const clearBtn = backdrop.querySelector("#pp-clear");
  if (clearBtn) clearBtn.addEventListener("click", () => { onSelect(null); backdrop.remove(); });
  backdrop.querySelector("#pp-new").addEventListener("click", () => {
    const form = backdrop.querySelector("#pp-new-form");
    form.classList.toggle("hidden");
    // a criar: a lista de perfis existentes esconde-se para dar espaço
    const creating = !form.classList.contains("hidden");
    list.classList.toggle("hidden", creating);
    if (filter) filter.closest(".pp-search").classList.toggle("hidden", creating);
    if (!creating) return;
    form.scrollIntoView({ block: "nearest" });
    // sem commander escolhido: abre logo a pesquisa
    if (!newCommander) searchCommander();
  });
  backdrop.querySelector("#pp-new-confirm").addEventListener("click", () => {
    const name = nameEl.value.trim();
    if (!name && !newCommander) { toast(tr("Dá um nome ao perfil ou escolhe um commander.")); return; }
    const profile = Profiles.create({ name, commander: newCommander, playerName: backdrop.querySelector("#pp-new-owner").value.trim() });
    onSelect(profile.id);
    backdrop.remove();
  });
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
}

// ===========================================================
// EXTRAS DE CADA LUGAR NO SETUP: perfis recentes, cor, perfil repetido
// ===========================================================
/** Baralha uma lista no sítio (Fisher–Yates) e devolve-a. */
function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function seatsHeadHtml(title, btnLabel) {
  return `<div class="section-head"><span class="section-title">${title}</span><button type="button" class="btn btn-ghost btn-sm" id="shuffle-btn">${I("shuffle")} ${btnLabel}</button></div>`;
}

/** Vista "Mesa": miniatura do tabuleiro com cada lugar na posição real
 *  (fila de cima rodada, fila de baixo por ordem inversa — a mesma
 *  disposição de renderGameStandard) e o nº de ordem dos turnos. */
function mesaInnerHtml(players) {
  const n = players.length;
  const top = Math.floor(n / 2);
  const seat = (p, i, rotated) => {
    const art = p.commander && p.commander.art;
    const style = p.seatStyle != null ? p.seatStyle : seatThumbStyle(p);
    return `<button type="button" class="mesa-seat ${rotated ? "rot" : ""} ${art ? "has-art" : ""} ${style ? "" : "plain"}" data-seat="${i}" style="${style}" aria-label="${esc(tr("Lugar {n}", { n: i + 1 }))}">
      <span class="mesa-num">${i + 1}</span>
      <span class="mesa-inner">
        <span class="mesa-name">${esc((p.name || "").trim() || tr("Jogador {n}", { n: i + 1 }))}</span>
        ${p.commander ? `<span class="mesa-cmd">${esc(p.commander.name)}</span>` : ""}
      </span>
    </button>`;
  };
  const topRow = players.slice(0, top).map((p, k) => seat(p, k, true)).join("");
  const bottomRow = players.slice(top).map((p, k) => seat(p, top + k, false)).reverse().join("");
  return `
    <div class="mesa-row" style="grid-template-columns: repeat(${Math.max(1, top)}, minmax(0, 1fr))">${topRow}</div>
    <div class="mesa-row" style="grid-template-columns: repeat(${n - top}, minmax(0, 1fr))">${bottomRow}</div>`;
}
/** Arrastar um lugar para cima de outro troca-os; um toque leva ao cartão
 *  desse lugar. `onSwap(a, b)` troca e volta a pintar. */
function bindMesa(mesa, onSwap, onTap) {
  let drag = null;
  mesa.addEventListener("pointerdown", (e) => {
    const seatEl = e.target.closest(".mesa-seat");
    if (!seatEl) return;
    drag = { el: seatEl, from: parseInt(seatEl.dataset.seat, 10), x: e.clientX, y: e.clientY, moved: false, over: null };
    seatEl.setPointerCapture(e.pointerId);
  });
  mesa.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 8) return;
    drag.moved = true;
    drag.el.classList.add("dragging");
    // com o ecrã rodado 90° (contador deitado) os eixos do ecrã e da página trocam
    const rotated = document.documentElement.classList.contains("force-landscape");
    drag.el.style.translate = rotated ? `${dy}px ${-dx}px` : `${dx}px ${dy}px`;
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const target = under && under.closest(".mesa-seat");
    if (drag.over && drag.over !== target) drag.over.classList.remove("drop-target");
    drag.over = target && target !== drag.el ? target : null;
    if (drag.over) drag.over.classList.add("drop-target");
  });
  const end = (e, cancelled) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    d.el.classList.remove("dragging");
    d.el.style.translate = "";
    if (d.over) d.over.classList.remove("drop-target");
    if (cancelled) return;
    if (!d.moved) { onTap(d.from); return; }
    if (d.over) onSwap(d.from, parseInt(d.over.dataset.seat, 10));
  };
  mesa.addEventListener("pointerup", (e) => end(e, false));
  mesa.addEventListener("pointercancel", (e) => end(e, true));
}

/** Perfis usados mais recentemente (último jogo, ou data de criação),
 *  sem os que já estão sentados noutros lugares. */
function recentProfiles(excludeIds, n) {
  const used = new Set(excludeIds.filter(Boolean));
  const lastUse = (pr) => (pr.history && pr.history.length ? Math.max(...pr.history.map((h) => h.date || 0)) : pr.createdAt || 0);
  return Profiles.all().filter((pr) => !used.has(pr.id)).sort((a, b) => lastUse(b) - lastUse(a)).slice(0, n);
}
/** Miniatura do lugar: a arte do commander, ou a cor escolhida para ele. */
function seatThumbStyle(p) {
  if (p.commander && p.commander.art) return commanderThumbStyle(p.commander);
  if (typeof p.colorIdx === "number" && State.FALLBACK_PALETTE[p.colorIdx]) {
    const [c1, c2] = State.FALLBACK_PALETTE[p.colorIdx];
    return `background:linear-gradient(160deg, ${c1}, ${c2})`;
  }
  return "";
}
/** Nome do lugar depois de escolher um deck: passa a ser o dono, a não
 *  ser que já lá esteja escrito o nome de outra pessoa (deck emprestado).
 *  Se o nome era o dono do deck anterior, troca para o novo dono. */
function seatNameAfterProfile(curName, prevProfileId, prof) {
  const cur = (curName || "").trim();
  if (!prof || !(prof.playerName || "").trim()) return curName;
  const prev = prevProfileId ? Profiles.get(prevProfileId) : null;
  if (!cur || (prev && normName(prev.playerName) === normName(cur))) return prof.playerName;
  return curName;
}
/** Commanders que um deck pode usar: o principal e os alternativos. */
function deckCommanders(prof) {
  return prof ? [prof.commander].concat(prof.altCommanders || []).filter((c) => c && c.name) : [];
}
/** O dono do deck é outra pessoa que não quem está sentado? */
function isBorrowed(name, prof) {
  const owner = prof && (prof.playerName || "").trim();
  const who = (name || "").trim();
  return !!(owner && who && normName(Profiles.canonicalPlayer(who)) !== normName(owner));
}
/** Aviso de deck emprestado + escolha do commander (principal ou
 *  alternativo) para este jogo. Os botões têm data-alt="índice". */
function seatDeckExtrasHtml(name, commander, prof) {
  if (!prof) return "";
  const cmds = deckCommanders(prof);
  const cur = commander ? normName(commander.name) : "";
  return `
    ${isBorrowed(name, prof) ? `<div class="seat-borrow">${I("user")}<span>${tr("Deck emprestado por {name}", { name: esc(prof.playerName.trim()) })}</span></div>` : ""}
    ${cmds.length > 1 ? `<div class="seat-alt" role="group" aria-label="${tr("Commander deste jogo")}">${cmds.map((c, k) => `
      <button type="button" class="recent-chip alt-chip" data-alt="${k}" aria-pressed="${normName(c.name) === cur}">
        <span class="recent-avatar" style="${c.art ? commanderThumbStyle(c) : ""}">${c.art ? "" : esc(c.name.slice(0, 2).toUpperCase())}</span>
        <span class="recent-name">${esc(c.name)}</span>
      </button>`).join("")}</div>` : ""}`;
}
/** HTML dos extras de um lugar. `seats` = todos os lugares (para saber
 *  que perfis já estão ocupados e se este perfil está repetido). */
function seatExtrasHtml(p, idx, seats) {
  const others = seats.filter((_, j) => j !== idx).map((x) => x.profileId);
  const dupAt = p.profileId ? seats.findIndex((x, j) => j !== idx && x.profileId === p.profileId) : -1;
  const recents = p.profileId ? [] : recentProfiles(others, 3);
  const palette = State.FALLBACK_PALETTE;
  const prof = p.profileId ? Profiles.get(p.profileId) : null;
  return `
    ${seatDeckExtrasHtml(p.name, p.commander, prof)}
    ${recents.length ? `<div class="seat-recents" role="group" aria-label="${tr("Perfis recentes")}">${recents.map((pr) => `
      <button type="button" class="recent-chip" data-recent="${pr.id}" title="${tr("Usar o perfil {name}", { name: esc(pr.name) })}">
        <span class="recent-avatar" style="${pr.commander && pr.commander.art ? commanderThumbStyle(pr.commander) : ""}">${pr.commander && pr.commander.art ? "" : esc(pr.name.slice(0, 2).toUpperCase())}</span>
        <span class="recent-name">${esc(pr.name)}</span>
      </button>`).join("")}</div>` : ""}
    ${!p.commander ? `<div class="seat-colors" role="group" aria-label="${tr("Cor sem commander")}">${palette.map((c, k) => `
      <button type="button" class="color-dot" data-color="${k}" aria-pressed="${p.colorIdx === k}" aria-label="${tr("Cor {n}", { n: k + 1 })}" style="background:${c[0]}"></button>`).join("")}</div>` : ""}
    ${dupAt >= 0 ? `<div class="seat-warn">${I("info")}<span>${tr("Este perfil já está no lugar {n} — as estatísticas contariam duas vezes.", { n: dupAt + 1 })}</span></div>` : ""}`;
}
/** Liga (uma vez) os cliques dos extras de um cartão de lugar. */
function bindSeatExtras(card, getSeat, rerender) {
  card.addEventListener("click", (e) => {
    const rb = e.target.closest("[data-recent]");
    if (rb) {
      const pr = Profiles.get(rb.dataset.recent);
      const seat = getSeat();
      if (!pr || !seat) return;
      seat.name = seatNameAfterProfile(seat.name, seat.profileId, pr);
      seat.profileId = pr.id;
      if (pr.commander) seat.commander = pr.commander;
      if (typeof pr.colorIdx === "number") seat.colorIdx = pr.colorIdx;
      rerender();
      return;
    }
    const ab = e.target.closest("[data-alt]");
    if (ab) {
      const seat = getSeat();
      const pr = seat && seat.profileId ? Profiles.get(seat.profileId) : null;
      const c = deckCommanders(pr)[parseInt(ab.dataset.alt, 10)];
      if (c) { seat.commander = c; rerender(); }
      return;
    }
    const cb = e.target.closest("[data-color]");
    if (cb) {
      getSeat().colorIdx = parseInt(cb.dataset.color, 10);
      rerender();
    }
  });
}
