/* ===========================================================
   app.js — controlador principal / UI
   =========================================================== */
(function () {
  const { Scryfall, State, Profiles, Icons, Charts } = window.MTG;
  const I = (name, cls) => Icons.svg(name, cls);
  const tr = window.MTG.i18n.t;
  const appEl = document.getElementById("app");
  const toastEl = document.getElementById("toast");
  const turnAudioEl = document.getElementById("turn-sound");

  let screen = "menu";
  let screenParams = {};
  let game = null; // estado do jogo atual (espelha o State guardado)
  let draft = null; // rascunho usado nos ecrãs de setup
  let liveTimer = null; // interval do relógio ao vivo (turno/total) no tabuleiro
  let wakeLock = null; // Screen Wake Lock ativo enquanto se está no contador de vida
  let boardFullscreen = false; // esconde as barras de cima/baixo no contador de vida (persiste entre re-renders do mesmo jogo)

  // Impede o ecrã de bloquear enquanto se está a jogar (Commander/Duelo/Livre/BR).
  // A Wake Lock API só funciona em contexto seguro (https ou localhost) e nem
  // todos os browsers a suportam — falha em silêncio nesses casos.
  async function requestWakeLock() {
    if (!("wakeLock" in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } catch (e) {
      wakeLock = null;
    }
  }
  function releaseWakeLock() {
    if (wakeLock) {
      try { wakeLock.release(); } catch (e) {}
      wakeLock = null;
    }
  }
  // Em muitos browsers a wake lock é libertada automaticamente quando a página
  // fica em background (ex: trocar de app) — volta a pedir quando se regressa,
  // mas só se ainda estivermos num ecrã de jogo.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && (screen === "game-standard" || screen === "game-br") && !wakeLock) {
      requestWakeLock();
    }
  });

  function playTurnSound() {
    if (!turnAudioEl) return;
    try {
      turnAudioEl.currentTime = 0;
      const p = turnAudioEl.play();
      if (p && p.catch) p.catch(() => {});
    } catch (e) {}
  }

  function formatDuration(ms) {
    ms = Math.max(0, Math.round(ms || 0));
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const sec = totalSec % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  function formatDateTime(ts) {
    if (!ts) return "-";
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function formatTimeOnly(ts) {
    if (!ts) return "-";
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  const MODE_LABELS = { commander: "Commander", duel: tr("Duelo 1v1"), free: tr("Livre"), standard: tr("Padrão"), br: "Battle Royale", teams: tr("Equipas") };
  function modeLabel(mode) { return MODE_LABELS[mode] || mode || tr("Jogo"); }

  const PRESETS = {
    commander: {
      key: "commander",
      label: tr("Commander Padrão"),
      minPlayers: 2,
      maxPlayers: 8,
      defaultPlayers: 4,
      defaultLife: 40,
      cmdDmgToggle: false,
      cmdDmgDefault: true,
    },
    duel: {
      key: "duel",
      label: tr("Duelo 1v1"),
      minPlayers: 2,
      maxPlayers: 2,
      defaultPlayers: 2,
      defaultLife: 40,
      cmdDmgToggle: false,
      cmdDmgDefault: true,
    },
    free: {
      key: "free",
      label: tr("Livre"),
      minPlayers: 2,
      maxPlayers: 8,
      defaultPlayers: 4,
      defaultLife: 20,
      cmdDmgToggle: true,
      cmdDmgDefault: false,
    },
  };

  // ---------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------
  function esc(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.remove("show"), ms || 2200);
  }

  /** Mensagem com botão "Desfazer" (substitui as confirmações ao apagar).
   *  Fecha sozinha ao fim de `ms`; tocar em "Desfazer" chama onUndo. */
  function undoToast(msg, onUndo, ms) {
    document.querySelectorAll(".undo-toast").forEach((x) => x.remove());
    const t = el(`
      <div class="undo-toast" role="status">
        <span class="undo-msg"></span>
        <span class="undo-timer" aria-hidden="true"></span>
        <button type="button" class="undo-btn">${tr("Desfazer")}</button>
      </div>`);
    t.querySelector(".undo-msg").textContent = msg;
    const dur = ms || 5000;
    t.style.setProperty("--undo-ms", dur + "ms");
    document.body.appendChild(t);
    let done = false;
    const close = () => { if (done) return; done = true; t.classList.add("closing"); setTimeout(() => t.remove(), 250); };
    t.querySelector(".undo-btn").addEventListener("click", () => { if (done) return; close(); onUndo(); });
    setTimeout(close, dur);
  }

  /** Reinicia uma animação CSS (remove a classe, força reflow, volta a pôr). */
  function retrigger(elm, cls) {
    if (!elm) return;
    elm.classList.remove(cls);
    void elm.offsetWidth;
    elm.classList.add(cls);
  }

  /** Atualiza o número de vida com um pequeno "salto" verde/vermelho. */
  function setLifeAnimated(lifeEl, value) {
    if (!lifeEl) return;
    const prev = parseInt(lifeEl.textContent, 10);
    lifeEl.textContent = value;
    if (isNaN(prev) || prev === value) return;
    lifeEl.classList.remove("bump-up", "bump-down");
    void lifeEl.offsetWidth;
    lifeEl.classList.add(value > prev ? "bump-up" : "bump-down");
  }

  function debounce(fn, wait) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  // Torna os botões de ícone da board-toolbar (pausa/histórico/trocar
  // posições) perfeitamente quadrados, com o mesmo tamanho (altura real)
  // do botão "Terminar" ao lado, em vez de um valor fixo adivinhado.
  function squareToolbarIcons(scope) {
    const endBtn = scope.querySelector(".board-toolbar .btn-ghost.grow, .board-toolbar #end-game-btn");
    const icons = scope.querySelectorAll(".board-toolbar .btn-icon");
    if (!endBtn || !icons.length) return;
    requestAnimationFrame(() => {
      // offsetHeight = altura no layout (getBoundingClientRect daria a
      // largura quando o ecrã está rodado para ficar deitado)
      const h = endBtn.offsetHeight;
      if (!h) return;
      icons.forEach((btn) => { btn.style.width = h + "px"; btn.style.height = h + "px"; });
    });
  }

  function nav(newScreen, params) {
    closeAnyModal();
    screen = newScreen;
    screenParams = params || {};
    render();
  }

  function closeAnyModal() {
    document.querySelectorAll(".modal-backdrop").forEach((m) => m.remove());
  }

  // Repetições ativas (manter premido) — para as poder parar todas de uma
  // vez. No iPad, minimizar a app a meio de um toque pode não entregar o
  // "levantar o dedo" ao botão; sem isto a repetição ficava a correr para
  // sempre (e, depois de o painel ser redesenhado, já nenhum toque a parava).
  const activeRepeats = new Set();
  function stopAllRepeats() { Array.from(activeRepeats).forEach((stop) => stop()); }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState !== "visible") stopAllRepeats(); });
  window.addEventListener("blur", stopAllRepeats);
  window.addEventListener("pagehide", stopAllRepeats);
  // qualquer dedo levantado/cancelado em qualquer sítio também para
  document.addEventListener("pointerup", stopAllRepeats, true);
  document.addEventListener("pointercancel", stopAllRepeats, true);

  const REPEAT_MAX_MS = 20000; // segurança: nenhuma repetição dura mais do que isto

  // Nunca começar uma seleção de texto fora dos campos (o Safari do iPad
  // ignora às vezes o CSS ao manter o dedo em cima de um botão).
  document.addEventListener("selectstart", (e) => {
    const t = e.target && e.target.nodeType === 1 ? e.target : e.target && e.target.parentElement;
    if (!t || !t.closest("input, textarea, select, [contenteditable='true']")) e.preventDefault();
  });

  /** Tap simples + press-and-hold repetido (para os contadores de vida). */
  function bindPressRepeat(elm, callback) {
    let timer = null, interval = null, fired = false, startedAt = 0;
    function fire(e) {
      retrigger(elm, "tap-flash");
      callback(e);
    }
    function stop() {
      clearTimeout(timer); clearInterval(interval); timer = null; interval = null;
      elm.classList.remove("pressed");
      activeRepeats.delete(stop);
    }
    function start(e) {
      e.preventDefault();
      stop(); // nunca duas repetições do mesmo botão
      fired = false;
      startedAt = Date.now();
      elm.classList.add("pressed");
      try { elm.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
      activeRepeats.add(stop);
      timer = setTimeout(() => {
        fired = true;
        fire(e);
        interval = setInterval(() => {
          if (!elm.isConnected || document.hidden || Date.now() - startedAt > REPEAT_MAX_MS) { stop(); return; }
          fire(e);
        }, 120);
      }, 420);
    }
    function up(e) {
      // toque curto = um passo (o listener global de pointerup já pode ter
      // parado o temporizador antes de chegar aqui, por isso usa-se o tempo)
      if (!fired && startedAt && Date.now() - startedAt < 600) fire(e);
      startedAt = 0;
      stop();
    }
    elm.addEventListener("pointerdown", start);
    elm.addEventListener("pointerup", up);
    elm.addEventListener("pointerleave", stop);
    elm.addEventListener("pointercancel", stop);
    elm.addEventListener("lostpointercapture", stop);
    elm.addEventListener("contextmenu", (e) => e.preventDefault());
    // no iOS só cancelar o touchstart impede a lupa/seleção ao manter o dedo
    // (os eventos de pointer continuam a chegar normalmente)
    elm.addEventListener("touchstart", (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
  }

  // Feedback ao tocar: uma "onda" que nasce no ponto tocado nos botões e
  // cartões retangulares, e um pequeno "pop" (encolhe e volta com mola)
  // nos botões redondos/pequenos, onde uma onda quase não se veria. Um só
  // listener global, por isso apanha também elementos criados mais tarde.
  const RIPPLE_SEL = ".btn:not(.btn-icon), .mode-card, .loot-card, .search-result-item, .profile-card, .panel-pass-turn-btn, .switch-field, .cd-list-item[data-pid], .modal-sheet label.row";
  const POP_SEL = ".btn-icon, .update-btn, .mini-btn, .cmd-badge, .poison-badge, .tax-badge, .tax-badge-sm, .commander-thumb, .fs-exit, .eliminated-badge, .protected-badge";
  document.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    const pop = e.target.closest(POP_SEL);
    if (pop) { if (!pop.disabled) retrigger(pop, "tap-pop"); return; }
    const host = e.target.closest(RIPPLE_SEL);
    if (!host || host.disabled) return;
    const r = host.getBoundingClientRect();
    const size = Math.max(host.offsetWidth, host.offsetHeight) * 1.6;
    // ponto tocado em coordenadas do próprio elemento (com o ecrã rodado
    // 90° para ficar deitado, os eixos do ecrã e do elemento trocam)
    const rotated = document.documentElement.classList.contains("force-landscape");
    const lx = rotated ? e.clientY - r.top : e.clientX - r.left;
    const ly = rotated ? r.right - e.clientX : e.clientY - r.top;
    const wave = document.createElement("span");
    wave.className = "ripple";
    wave.style.width = wave.style.height = size + "px";
    wave.style.left = (lx - size / 2) + "px";
    wave.style.top = (ly - size / 2) + "px";
    host.appendChild(wave);
    wave.addEventListener("animationend", () => wave.remove());
    setTimeout(() => wave.remove(), 900); // por segurança, se a animação não correr
  }, { passive: true });

  /** Chips de estado do tabuleiro (vez/ronda/relógios) — só existem em
   *  jogos com contagem de tempo e turnos. */
  function turnChipsHtml(turnName, roundNumber, paused) {
    return `
      <div class="br-chip turn">${I("user")} ${tr("Vez: {name}", { name: esc(turnName) })}</div>
      <div class="br-chip">${I("repeat")} ${tr("Ronda {n}", { n: roundNumber || 1 })}</div>
      <div class="br-chip">${I("clock")}<span id="chip-turn-time">${tr("Turno {time}", { time: "00:00" })}</span></div>
      <div class="br-chip">${I("hourglass")}<span id="chip-total-time">${tr("Total {time}", { time: "00:00" })}</span></div>
      ${paused ? `<div class="br-chip paused">${I("pause")} ${tr("Pausado")}</div>` : ""}`;
  }

  /** Ecrã inteiro: faixa fina entre as duas filas de cartões, com a ronda,
   *  o tempo de jogo e o botão de sair — no centro, mas sem tapar cartões. */
  function fsHubHtml(modeState, timed, paused) {
    return `
      <div class="fs-hub-row">
        <div class="fs-hub">
          ${timed ? `
            <span class="fs-chip">${I("repeat")}${tr("Ronda {n}", { n: modeState.roundNumber || 1 })}</span>
            <span class="fs-chip">${I("hourglass")}<span data-fs-total>00:00</span></span>
            ${paused ? `<span class="fs-chip paused">${I("pause")}${tr("Pausado")}</span>` : ""}` : ""}
          ${modeState === game.standard ? dayNightChipHtml("fs-chip") : ""}
          <button class="fs-exit" id="fs-tools-btn" title="${tr("Ferramentas da mesa")}" aria-label="${tr("Ferramentas da mesa")}">${I("dice")}</button>
          ${timed ? `<button class="fs-exit fs-pause" id="fs-pause-btn" title="${paused ? tr("Retomar") : tr("Pausar")}" aria-label="${paused ? tr("Retomar") : tr("Pausar")}">${I(paused ? "play" : "pause")}</button>` : ""}
          <button class="fs-exit" id="fullscreen-exit-btn" title="${tr("Sair de ecrã inteiro")}" aria-label="${tr("Sair de ecrã inteiro")}">${I("minimize")}</button>
        </div>
      </div>`;
  }

  /** Relógio ao vivo: chips de turno/total, a faixa do ecrã inteiro e o
   *  tempo no cartão de quem está a jogar. modeState: game.standard /
   *  game.br / game.teams. */
  function startLiveClock(scope, modeState) {
    function tick() {
      if (!scope.isConnected) { clearInterval(liveTimer); return; }
      const now = modeState.paused ? modeState.pausedAt : Date.now();
      const turn = formatDuration(now - modeState.turnStartedAt);
      const total = formatDuration(now - modeState.gameStartedAt);
      const chipTurn = scope.querySelector("#chip-turn-time");
      const chipTotal = scope.querySelector("#chip-total-time");
      if (chipTurn) chipTurn.textContent = tr("Turno {time}", { time: turn });
      if (chipTotal) chipTotal.textContent = tr("Total {time}", { time: total });
      scope.querySelectorAll("[data-fs-total]").forEach((x) => { x.textContent = total; });
      scope.querySelectorAll("[data-turn-time]").forEach((x) => { x.textContent = turn; });
    }
    tick();
    liveTimer = setInterval(tick, 1000);
  }

  /** Interruptor genérico (título + explicação + switch) dos ecrãs de setup. */
  function switchFieldHtml(id, title, sub, checked) {
    return `
      <label class="switch-field">
        <span class="switch-text">
          <span class="switch-title">${title}</span>
          ${sub ? `<span class="switch-sub">${sub}</span>` : ""}
        </span>
        <input type="checkbox" id="${id}" class="switch" ${checked ? "checked" : ""}>
      </label>`;
  }

  /** Interruptor "Contar tempo e turnos" dos ecrãs de setup. */
  function trackTurnsFieldHtml(checked) {
    return switchFieldHtml("cfg-track", tr("Contar tempo e turnos"), tr("Desliga para jogar só com a vida — sem relógios, rondas nem passar turno."), checked);
  }

  /** Fila de botões rápidos (ex: nº de jogadores 2–8). */
  function chipRowHtml(id, values, selected) {
    return `<div class="chip-row" id="${id}" role="group" style="grid-template-columns: repeat(${values.length}, minmax(0, 1fr))">${values.map((v) =>
      `<button type="button" class="chip-btn" data-v="${v}" aria-pressed="${v === selected}">${v}</button>`).join("")}</div>`;
  }
  function bindChipRow(scope, id, onPick) {
    const row = scope.querySelector("#" + id);
    if (!row) return;
    row.querySelectorAll(".chip-btn[data-v]").forEach((b) => b.addEventListener("click", () => {
      row.querySelectorAll(".chip-btn").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      onPick(parseInt(b.dataset.v, 10));
    }));
  }

  /** Vida inicial: 20 / 30 / 40 + "Outra" (abre um campo numérico). */
  const LIFE_PRESETS = [20, 30, 40];
  function lifeFieldHtml(life) {
    const custom = !LIFE_PRESETS.includes(life);
    return `
      <div class="chip-row" id="life-chips" role="group" style="grid-template-columns: repeat(4, minmax(0, 1fr))">
        ${LIFE_PRESETS.map((v) => `<button type="button" class="chip-btn" data-v="${v}" aria-pressed="${v === life}">${v}</button>`).join("")}
        <button type="button" class="chip-btn chip-other" data-other="1" aria-pressed="${custom}">${tr("Outra")}</button>
      </div>
      <input type="number" id="cfg-life" min="1" value="${life}" class="${custom ? "" : "hidden"}" style="margin-top:8px" aria-label="${tr("Vida inicial")}">`;
  }
  function bindLifeField(scope, onChange) {
    const row = scope.querySelector("#life-chips");
    const input = scope.querySelector("#cfg-life");
    row.querySelectorAll(".chip-btn").forEach((b) => b.addEventListener("click", () => {
      row.querySelectorAll(".chip-btn").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      if (b.dataset.other) {
        input.classList.remove("hidden");
        input.focus();
        input.select();
      } else {
        input.classList.add("hidden");
        input.value = b.dataset.v;
        onChange(parseInt(b.dataset.v, 10));
      }
    }));
    input.addEventListener("change", () => onChange(parseInt(input.value, 10)));
  }

  /** Secção recolhida "Mais opções" (fechada por defeito). */
  function moreOptionsHtml(summary, inner) {
    return `
      <details class="more-options">
        <summary>
          <span class="more-text"><span class="more-title">${tr("Mais opções")}</span><span class="more-sub">${summary}</span></span>
          ${I("chevron-down", "more-chevron")}
        </summary>
        <div class="more-body">${inner}</div>
      </details>`;
  }

  /** Conteúdo do botão de perfil de um jogador (ícone + nome do perfil). */
  function profileBtnHtml(profile) {
    return I("user") + " " + (profile ? esc(profile.name) : tr("Sem perfil"));
  }

  function commanderThumbStyle(commander) {
    if (commander && commander.art) return `background-image:url('${commander.art}')`;
    return "";
  }

  /** Fundo do "cartão" de um jogador durante o jogo: a arte do commander,
   *  ou — se ainda não escolheu nenhum — uma cor sorteada só para ele (sem
   *  repetir entre os jogadores que também não têm imagem). */
  function playerBgStyle(p) {
    if (p && p.commander && p.commander.art) return `background-image:url('${esc(p.commander.art)}')`;
    const idx = p && p.fallbackColorIdx;
    const palette = State.FALLBACK_PALETTE;
    if (typeof idx === "number" && palette && palette[idx]) {
      const [c1, c2] = palette[idx];
      return `background:linear-gradient(160deg, ${c1}, ${c2})`;
    }
    return "background:linear-gradient(160deg,#2a2f38,#12141a)";
  }

  /** true se o fundo do painel usa arte de commander (texto claro por cima);
   *  sem arte o painel fica com cor pastel e texto escuro. */
  function hasArt(players) {
    return players.some((p) => p && ((p.commander && p.commander.art) || (p.partnerCommander && p.partnerCommander.art)));
  }

  /** HTML do fundo do painel de um jogador: uma imagem única, ou — quando
   *  tem um commander parceiro — dividido ao meio, uma metade para cada
   *  commander (o principal usa a mesma lógica de fallback que já existia;
   *  o parceiro usa a arte dele, ou repete a mesma cor de fundo se não
   *  tiver nenhuma escolhida). */
  function panelBgHtml(p) {
    if (p && p.partnerCommander) {
      const mainStyle = playerBgStyle(p);
      const partnerStyle = commanderThumbStyle(p.partnerCommander) || mainStyle;
      return `<div class="bg bg-split"><div class="bg-half" style="${mainStyle}"></div><div class="bg-half" style="${partnerStyle}"></div></div>`;
    }
    return `<div class="bg" style="${playerBgStyle(p)}"></div>`;
  }

  /** HTML do fundo do painel de uma EQUIPA: dividido em fatias iguais, uma
   *  por jogador da equipa (cada uma com a arte do commander desse jogador,
   *  ou a cor sorteada só dele se ainda não tiver escolhido nenhum) — em vez
   *  de mostrar só a arte de um único jogador da equipa. */
  function teamBgHtml(team) {
    const players = team.players || [];
    if (players.length <= 1) {
      return `<div class="bg" style="${playerBgStyle(players[0])}"></div>`;
    }
    const halves = players.map((p) => `<div class="bg-half" style="${playerBgStyle(p)}"></div>`).join("");
    return `<div class="bg bg-split">${halves}</div>`;
  }

  // ---------------------------------------------------------
  // ROUTER
  // ---------------------------------------------------------
  let lastRenderedScreen = null;
  // ---------------------------------------------------------
  // Contador sempre em "landscape": num ecrã de jogo com o aparelho na
  // vertical, roda-se a página 90° (o jogo fica igual ao modo deitado e
  // basta virar o aparelho). Onde o browser deixa, tranca-se também a
  // orientação (ex: Android com a app instalada).
  // ---------------------------------------------------------
  const GAME_SCREENS = ["game-standard", "game-teams", "game-br"];
  const isTouchDevice = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  let orientationLocked = false;
  function applyGameOrientation() {
    const inGame = GAME_SCREENS.includes(screen);
    const so = window.screen && window.screen.orientation;
    if (inGame && so && so.lock && !orientationLocked) {
      so.lock("landscape").then(() => { orientationLocked = true; applyGameOrientation(); }).catch(() => {});
    } else if (!inGame && orientationLocked && so && so.unlock) {
      try { so.unlock(); } catch (e) { /* ok */ }
      orientationLocked = false;
    }
    const root = document.documentElement;
    root.style.setProperty("--app-w", window.innerWidth + "px");
    root.style.setProperty("--app-h", window.innerHeight + "px");
    const portrait = window.innerHeight > window.innerWidth;
    const rotated = inGame && portrait && isTouchDevice;
    root.classList.toggle("force-landscape", rotated);
    // altura disponível para o tabuleiro (com o ecrã rodado é a largura do
    // aparelho): abaixo disto usa-se o tabuleiro compacto
    const layoutH = rotated ? window.innerWidth : window.innerHeight;
    root.classList.toggle("compact-board", inGame && layoutH < 520);
  }
  window.addEventListener("resize", applyGameOrientation);
  window.addEventListener("orientationchange", () => setTimeout(applyGameOrientation, 150));

  function render() {
    stopAllRepeats();
    if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
    if (Charts) Charts.hideTip();
    appEl.innerHTML = "";
    const sameScreen = screen === lastRenderedScreen;
    lastRenderedScreen = screen;
    if (screen === "menu") renderMenu();
    else if (screen === "setup-standard") renderSetupStandard();
    else if (screen === "game-standard") renderGameStandard();
    else if (screen === "setup-br") renderSetupBR();
    else if (screen === "game-br") renderGameBR();
    else if (screen === "setup-teams") renderSetupTeams();
    else if (screen === "game-teams") renderGameTeams();
    else if (screen === "stats-standard") renderStatsStandard();
    else if (screen === "profiles") renderProfilesScreen();
    else if (screen === "profile-detail") renderProfileDetail();
    else if (screen === "player-detail") renderPlayerDetail();
    applyGameOrientation();
    // Re-renders do mesmo ecrã (ex: passar turno) não repetem a animação
    // de entrada — senão o tabuleiro inteiro "pisca" a cada turno.
    if (sameScreen && appEl.firstElementChild) appEl.firstElementChild.classList.add("no-enter");

    if (screen === "game-standard" || screen === "game-br" || screen === "game-teams") requestWakeLock();
    else releaseWakeLock();
  }

  // ===========================================================
  // ÚLTIMO SETUP ("Repetir último jogo")
  // ===========================================================
  const LAST_SETUP_KEY = "mtg_lc_last_setup_v1";
  function rememberSetup(kind, d) {
    try { localStorage.setItem(LAST_SETUP_KEY, JSON.stringify({ kind, draft: d, at: Date.now() })); } catch (e) {}
  }
  function loadLastSetup() {
    try {
      const raw = localStorage.getItem(LAST_SETUP_KEY);
      const v = raw ? JSON.parse(raw) : null;
      return v && v.kind && v.draft ? v : null;
    } catch (e) { return null; }
  }
  /** Jogadores (nome + commander) de um rascunho, em qualquer modo. */
  function setupPlayers(last) {
    const d = last.draft;
    if (last.kind === "br") return d.names.map((n, i) => ({ name: n || tr("Jogador {n}", { n: i + 1 }), commander: d.commanders[i] }));
    if (last.kind === "teams") {
      let seat = 0;
      return d.teams.reduce((acc, t) => acc.concat(t.players.map((p) => ({ name: p.name || tr("Jogador {n}", { n: ++seat }), commander: p.commander }))), []);
    }
    return d.players.map((p, i) => ({ name: p.name || tr("Jogador {n}", { n: i + 1 }), commander: p.commander, colorIdx: p.colorIdx }));
  }
  function relativeDay(ts) {
    const day = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const diff = Math.round((day(Date.now()) - day(ts)) / 86400000);
    if (diff <= 0) return tr("hoje");
    if (diff === 1) return tr("ontem");
    if (diff < 7) return tr("há {n} dias", { n: diff });
    return formatDateTime(ts).split(" ")[0];
  }
  function lastSetupCardHtml(last) {
    const players = setupPlayers(last);
    const d = last.draft;
    const mode = last.kind === "br" ? "Battle Royale" : last.kind === "teams" ? tr("Equipas") : (PRESETS[d.preset] ? PRESETS[d.preset].label : tr("Jogo"));
    const life = last.kind === "br" ? 30 : d.startLife;
    return `
      <div class="last-card">
        <span class="last-head">
          <span class="last-kicker">${tr("Último jogo")} · ${relativeDay(last.at)}</span>
          <span class="last-title">${esc(mode)}</span>
          <span class="last-names" title="${esc(players.map((p) => p.name).join(", "))}">${tr("{n} jogadores", { n: players.length })} · ${tr("{n} vidas", { n: life })}${last.kind !== "br" && d.trackTurns === false ? " · " + tr("sem tempo") : ""}</span>
        </span>
        <span class="last-actions">
          <button class="btn btn-icon" id="adjust-btn" title="${tr("Ajustar antes")}" aria-label="${tr("Ajustar antes")}">${I("sliders")}</button>
          <button class="btn btn-primary" id="repeat-btn">${I("rotate")} ${tr("Repetir")}</button>
        </span>
      </div>`;
  }

  // ===========================================================
  // CÓPIA DE SEGURANÇA — os dados vivem só neste aparelho/browser,
  // por isso convém guardar um ficheiro noutro sítio (Ficheiros/iCloud).
  // ===========================================================
  const BACKUP_KEY = "mtg_lc_backup_v1";
  const BACKUP_EVERY = 5; // lembrar ao fim de N jogos novos sem cópia

  function backupInfo() {
    try { return JSON.parse(localStorage.getItem(BACKUP_KEY)) || {}; } catch (e) { return {}; }
  }
  function setBackupInfo(patch) {
    try { localStorage.setItem(BACKUP_KEY, JSON.stringify(Object.assign(backupInfo(), patch))); } catch (e) {}
  }

  /** Guarda a cópia: no telemóvel abre o menu de partilha (→ "Guardar em
   *  Ficheiros", iCloud, enviar...); onde isso não existe, descarrega. */
  async function saveBackup() {
    const data = JSON.parse(Profiles.exportAll());
    data.type = "backup";
    data.lastSetup = loadLastSetup();
    const json = JSON.stringify(data, null, 2);
    const name = `mtg-life-counter-${new Date().toISOString().slice(0, 10)}.json`;
    let shared = false;
    try {
      const file = new File([json], name, { type: "application/json" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: tr("Cópia de segurança MTG Life") });
        shared = true;
      }
    } catch (e) {
      if (e && e.name === "AbortError") return false; // fechou o menu sem guardar
    }
    if (!shared) {
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
    setBackupInfo({ at: Date.now(), games: Profiles.gameCount() });
    toast(tr("Cópia de segurança guardada"));
    return true;
  }

  /** Lê um ficheiro de cópia/exportação (deste ou de outro aparelho) e
   *  abre a revisão da fusão. */
  function restoreBackupFile(file, done) {
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try { parsed = JSON.parse(String(reader.result)); } catch (e) { parsed = null; }
      const list = parsed && (Array.isArray(parsed) ? parsed : parsed.profiles);
      if (!Array.isArray(list)) {
        alert(tr("Não foi possível ler este ficheiro. Confirma que é um ficheiro exportado por esta app."));
        return;
      }
      openMergeReview(list, { lastSetup: parsed.lastSetup, exportedAt: parsed.exportedAt, playerAliases: parsed.playerAliases }, done);
    };
    reader.readAsText(file);
  }

  // ===========================================================
  // FUNDIR PERFIS — juntar os perfis e jogos de outro aparelho
  // ===========================================================
  const deckLabel = (p) => (p.playerName ? p.playerName + " · " : "") + p.name;

  /** Revisão antes de fundir: mostra o que já está ligado, sugere pares
   *  (mesmo jogador e commander) e deixa escolher o destino de cada perfil
   *  recebido. Nada é duplicado: jogos que já existam são ignorados. */
  function openMergeReview(list, extra, done) {
    const rows = Profiles.mergePreview(list);
    if (!rows.length) { alert(tr("Não foram encontrados perfis válidos neste ficheiro.")); return; }
    const locals = Profiles.all();
    const auto = rows.filter((r) => r.auto);
    const pick = rows.filter((r) => !r.auto);
    if (!pick.length && auto.every((r) => !r.newGames)) {
      if (extra && extra.onApplied) { extra.onApplied(); return; } // ex: entrar num grupo
      alert(tr("Já está tudo fundido: não há jogos nem perfis novos."));
      return;
    }
    const newGamesFor = (r, localId) => {
      const hist = Array.isArray(r.incoming.history) ? r.incoming.history : [];
      if (!localId) return hist.length;
      const lp = locals.find((p) => p.id === localId);
      const have = new Set(((lp && lp.history) || []).map((g) => g.id));
      return hist.filter((g) => g && !have.has(g.id)).length;
    };
    const options = (sel) => `<option value="">${tr("Perfil novo")}</option>` +
      locals.map((p) => `<option value="${esc(p.id)}"${p.id === sel ? " selected" : ""}>${esc(deckLabel(p))}</option>`).join("");
    closeAnyModal();
    const backdrop = el(`
      <div class="modal-backdrop">
        <div class="modal-sheet merge-sheet">
          <h2>${extra && extra.title ? esc(extra.title) : tr("Fundir perfis")}</h2>
          <p class="merge-summary" id="mg-summary"></p>
          ${pick.length ? `
            <div class="section-title">${tr("Confirmar")}</div>
            <p class="merge-hint">${tr("Escolhe com que perfil deste telemóvel junta cada um. Os sugeridos parecem o mesmo deck (mesmo jogador e commander).")}</p>
            <div class="col merge-list">${pick.map((r, i) => `
              <div class="merge-row" data-i="${i}">
                <div class="merge-from">
                  <span class="merge-name">${esc(deckLabel(r.incoming))}</span>
                  <span class="merge-games" data-games></span>
                </div>
                <div class="merge-to">
                  ${I("arrow-right")}
                  <select class="merge-select" aria-label="${esc(tr("Juntar com"))}">${options(r.match && r.match.id)}</select>
                </div>
                ${r.match ? `<span class="merge-suggested">${tr("Sugerido")}</span>` : ""}
              </div>`).join("")}</div>` : ""}
          ${auto.length ? `
            <div class="section-title">${tr("Já ligados")}</div>
            <div class="col merge-list">${auto.map((r) => `
              <div class="merge-row linked">
                <div class="merge-from">
                  <span class="merge-name">${esc(deckLabel(r.match))}</span>
                  <span class="merge-games">${r.newGames ? tr("+{n} jogo(s) novo(s)", { n: r.newGames }) : tr("sem jogos novos")}</span>
                </div>
              </div>`).join("")}</div>` : ""}
          <div class="row" style="margin-top:16px">
            <button class="btn btn-ghost grow" id="mg-cancel">${tr("Cancelar")}</button>
            <button class="btn btn-primary grow" id="mg-go">${I("merge")} ${extra && extra.confirmLabel ? esc(extra.confirmLabel) : tr("Fundir")}</button>
          </div>
        </div>
      </div>`);
    document.body.appendChild(backdrop);
    const selects = Array.from(backdrop.querySelectorAll(".merge-row[data-i]"));
    function paint() {
      let games = auto.reduce((a, r) => a + r.newGames, 0);
      let newProfiles = 0;
      const used = new Map();
      selects.forEach((row) => {
        const r = pick[+row.dataset.i];
        const to = row.querySelector("select").value;
        const n = newGamesFor(r, to);
        games += n;
        if (!to) newProfiles++;
        else used.set(to, (used.get(to) || 0) + 1);
        row.querySelector("[data-games]").textContent = n ? tr("+{n} jogo(s) novo(s)", { n }) : tr("sem jogos novos");
      });
      const dup = rows.reduce((a, r) => a + (Array.isArray(r.incoming.history) ? r.incoming.history.length : 0), 0) - games;
      backdrop.querySelector("#mg-summary").textContent =
        tr("Vão entrar {g} jogo(s) e {p} perfil(is) novo(s).", { g: games, p: newProfiles }) +
        (dup > 0 ? " " + tr("{n} jogo(s) já existiam e não vão ser repetidos.", { n: dup }) : "");
    }
    selects.forEach((row) => row.querySelector("select").addEventListener("change", paint));
    paint();
    const close = () => backdrop.remove();
    backdrop.querySelector("#mg-cancel").addEventListener("click", close);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector("#mg-go").addEventListener("click", () => {
      const targets = {};
      auto.forEach((r) => { targets[r.incoming.id] = r.match.id; });
      selects.forEach((row) => { targets[pick[+row.dataset.i].incoming.id] = row.querySelector("select").value || null; });
      const before = Profiles.snapshot();
      if (extra && extra.playerAliases) Profiles.addPlayerAliases(extra.playerAliases);
      const res = Profiles.applyMerge(list, targets);
      if (extra && extra.lastSetup && !loadLastSetup()) {
        try { localStorage.setItem(LAST_SETUP_KEY, JSON.stringify(extra.lastSetup)); } catch (e) {}
      }
      close();
      if (extra && extra.onApplied) { extra.onApplied(res); return; }
      done && done();
      undoToast(tr("Fundido: {g} jogo(s) e {p} perfil(is) novo(s)", { g: res.games, p: res.profiles }), () => {
        Profiles.replaceAll(before);
        done && done();
        toast(tr("Fusão desfeita"));
      }, 8000);
    });
  }

  /** Mostra os meus perfis como QR animado (várias partes em ciclo). */
  async function openQrShow() {
    closeAnyModal();
    const backdrop = el(`
      <div class="modal-backdrop">
        <div class="modal-sheet qr-sheet">
          <h2>${tr("Mostrar QR")}</h2>
          <p class="merge-hint">${tr("No outro telemóvel: Perfis → Juntar com outro telemóvel → Ler QR. Mantém este ecrã aberto até ele dizer que terminou.")}</p>
          <div class="qr-box"><canvas id="qr-canvas"></canvas></div>
          <div class="qr-status" id="qr-status">${tr("A preparar…")}</div>
          <button class="btn btn-ghost btn-block" id="qr-close" style="margin-top:12px">${tr("Fechar")}</button>
        </div>
      </div>`);
    document.body.appendChild(backdrop);
    let timer = null;
    const close = () => { clearInterval(timer); backdrop.remove(); };
    backdrop.querySelector("#qr-close").addEventListener("click", close);
    const status = backdrop.querySelector("#qr-status");
    let frames;
    try {
      frames = await MTG.QrSync.encode({ app: "mtg-life-counter", type: "qr-merge", version: 1, profiles: Profiles.all(), playerAliases: Profiles.playerAliases() });
    } catch (e) {
      status.textContent = e && e.message === "too-big" ? tr("Há dados demais para QR. Usa o ficheiro.") : tr("Não foi possível criar o QR. Usa o ficheiro.");
      return;
    }
    const canvas = backdrop.querySelector("#qr-canvas");
    const size = Math.min(320, window.innerWidth - 72);
    let i = 0;
    const show = () => {
      if (!backdrop.isConnected) { clearInterval(timer); return; }
      MTG.QrSync.draw(canvas, frames[i], size).catch(() => {});
      status.textContent = frames.length > 1 ? tr("Parte {i} de {n}", { i: i + 1, n: frames.length }) : tr("Pronto a ler");
      i = (i + 1) % frames.length;
    };
    show();
    if (frames.length > 1) timer = setInterval(show, 350);
  }

  /** Lê com a câmara o QR (animado) do outro telemóvel e abre a revisão. */
  async function openQrScan(done) {
    closeAnyModal();
    const backdrop = el(`
      <div class="modal-backdrop">
        <div class="modal-sheet qr-sheet">
          <h2>${tr("Ler QR")}</h2>
          <p class="merge-hint">${tr("Aponta para o QR do outro telemóvel. Se mudar de parte em parte, mantém-no apontado até a barra encher.")}</p>
          <div class="qr-video"><video id="qr-video" playsinline muted></video><span class="qr-frame" aria-hidden="true"></span></div>
          <div class="qr-progress"><span id="qr-bar"></span></div>
          <div class="qr-status" id="qr-status">${tr("A abrir a câmara…")}</div>
          <button class="btn btn-ghost btn-block" id="qr-close" style="margin-top:12px">${tr("Cancelar")}</button>
        </div>
      </div>`);
    document.body.appendChild(backdrop);
    const status = backdrop.querySelector("#qr-status");
    const bar = backdrop.querySelector("#qr-bar");
    let stop = () => {};
    let finished = false;
    const close = () => { stop(); backdrop.remove(); };
    backdrop.querySelector("#qr-close").addEventListener("click", close);
    const col = MTG.QrSync.collector();
    try {
      stop = await MTG.QrSync.scan(backdrop.querySelector("#qr-video"), (bytes) => {
        if (finished || !col.add(bytes)) return;
        bar.style.width = Math.round((col.got / col.total) * 100) + "%";
        status.textContent = tr("{got} de {n} partes lidas", { got: col.got, n: col.total });
        if (navigator.vibrate) navigator.vibrate(15);
        if (!col.done) return;
        finished = true;
        stop();
        col.result().then((data) => {
          backdrop.remove();
          // QR de um grupo na nuvem: entra nesse grupo
          if (data && data.type === "mtg-group" && data.code) { joinGroupFlow(data.code, done); return; }
          const list = data && Array.isArray(data.profiles) ? data.profiles : null;
          if (!list) { alert(tr("Este QR não é de perfis desta app.")); return; }
          openMergeReview(list, { playerAliases: data.playerAliases }, done);
        }).catch((e) => {
          status.textContent = e && e.message === "no-decompress" ? tr("Este telemóvel não consegue ler estes dados. Usa o ficheiro.") : tr("Não foi possível ler os dados. Tenta outra vez.");
        });
      });
      if (!backdrop.isConnected) stop(); // fechou enquanto a câmara abria
      else if (!finished) status.textContent = tr("À procura do QR…");
    } catch (e) {
      status.textContent = tr("Sem acesso à câmara. Dá permissão nas definições ou usa o ficheiro.");
    }
  }

  // ---------------------------------------------------------
  // Fundir dois decks / dois jogadores deste aparelho (nomes ou
  // alcunhas diferentes para o mesmo deck ou a mesma pessoa)
  // ---------------------------------------------------------
  const normName = (x) => String(x || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const sameDeck = (a, b) => {
    const ca = a.commander && normName(a.commander.name);
    const cb = b.commander && normName(b.commander.name);
    return (ca && ca === cb) || normName(a.name) === normName(b.name);
  };

  /** Escolha "fica este / fica o outro" (segmented). */
  function keepSegHtml(id, a, b, sel) {
    return `
      <div class="section-title">${tr("Fica com o nome")}</div>
      <div class="seg" id="${id}" role="tablist">
        <button type="button" class="seg-btn" data-k="a" aria-selected="${sel === "a"}">${esc(a)}</button>
        <button type="button" class="seg-btn" data-k="b" aria-selected="${sel === "b"}">${esc(b)}</button>
      </div>`;
  }
  function bindSeg(root, id, onPick) {
    root.querySelectorAll(`#${id} .seg-btn`).forEach((btn) => btn.addEventListener("click", () => {
      root.querySelectorAll(`#${id} .seg-btn`).forEach((x) => x.setAttribute("aria-selected", String(x === btn)));
      onPick(btn.dataset.k);
    }));
  }

  function openMergeDeckSheet(profileId) {
    const me = Profiles.get(profileId);
    if (!me) return;
    const others = Profiles.all().filter((p) => p.id !== me.id).map((p) => ({
      p, suggested: sameDeck(me, p), samePlayer: normName(p.playerName) === normName(me.playerName),
    })).sort((x, y) => (y.suggested - x.suggested) || (y.samePlayer - x.samePlayer) || x.p.name.localeCompare(y.p.name));
    if (!others.length) { toast(tr("Não há outro deck para fundir")); return; }
    closeAnyModal();
    const backdrop = el(`
      <div class="modal-backdrop">
        <div class="modal-sheet merge-sheet">
          <h2>${tr("Fundir deck")}</h2>
          <p class="merge-hint">${tr("Junta «{name}» com outro deck que seja o mesmo (por exemplo, criado com outro nome). Os jogos e as estatísticas somam-se e fica só um.", { name: esc(me.name) })}</p>
          <div class="col merge-list" id="md-list">${others.map(({ p, suggested }) => `
            <label class="merge-row pick">
              <input type="radio" name="md-target" value="${esc(p.id)}">
              <span class="merge-from">
                <span class="merge-name">${esc(deckLabel(p))}</span>
                <span class="merge-games">${tr("{n} jogo(s)", { n: p.stats.games })}</span>
              </span>
              ${suggested ? `<span class="merge-suggested">${tr("Parecido")}</span>` : ""}
            </label>`).join("")}</div>
          <div id="md-keep"></div>
          <p class="merge-summary" id="md-summary"></p>
          <div class="row" style="margin-top:12px">
            <button class="btn btn-ghost grow" id="md-cancel">${tr("Cancelar")}</button>
            <button class="btn btn-primary grow" id="md-go" disabled>${I("merge")} ${tr("Fundir")}</button>
          </div>
        </div>
      </div>`);
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.querySelector("#md-cancel").addEventListener("click", close);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    let other = null;
    let keep = "a"; // a = este deck, b = o escolhido
    function paint() {
      if (!other) return;
      const kept = keep === "a" ? me : other;
      const gone = keep === "a" ? other : me;
      const g = me.stats.games + other.stats.games;
      const w = me.stats.wins + other.stats.wins;
      backdrop.querySelector("#md-summary").textContent = tr("«{kept}» fica com {g} jogo(s) e {w} vitória(s); «{gone}» deixa de existir.", { kept: kept.name, gone: gone.name, g, w });
    }
    backdrop.querySelectorAll('input[name="md-target"]').forEach((r) => r.addEventListener("change", () => {
      other = Profiles.get(r.value);
      keep = other.stats.games > me.stats.games ? "b" : "a";
      const wrap = backdrop.querySelector("#md-keep");
      wrap.innerHTML = keepSegHtml("md-seg", me.name, other.name, keep);
      bindSeg(wrap, "md-seg", (k) => { keep = k; paint(); });
      backdrop.querySelector("#md-go").disabled = false;
      paint();
    }));
    backdrop.querySelector("#md-go").addEventListener("click", () => {
      if (!other) return;
      const kept = keep === "a" ? me : other;
      const gone = keep === "a" ? other : me;
      const before = Profiles.snapshot();
      Profiles.mergeProfiles(gone.id, kept.id);
      close();
      nav("profile-detail", { id: kept.id, fromPlayer: screenParams.fromPlayer });
      undoToast(tr("Decks fundidos"), () => { Profiles.replaceAll(before); nav("profile-detail", { id: me.id, fromPlayer: screenParams.fromPlayer }); }, 8000);
    });
  }

  function openMergePlayerSheet(playerKey) {
    const players = playersFromProfiles(Profiles.all());
    const me = players.find((x) => x.key === playerKey);
    if (!me) return;
    const others = players.filter((x) => x !== me).sort((a, b) => a.name.localeCompare(b.name));
    if (!others.length) { toast(tr("Não há outro jogador para fundir")); return; }
    closeAnyModal();
    const backdrop = el(`
      <div class="modal-backdrop">
        <div class="modal-sheet merge-sheet">
          <h2>${tr("Fundir jogador")}</h2>
          <p class="merge-hint">${tr("Junta «{name}» com outro jogador que seja a mesma pessoa (outro nome ou alcunha). A app passa a reconhecer os dois nomes, também ao juntar com outro telemóvel.", { name: esc(me.name) })}</p>
          <div class="col merge-list">${others.map((o, i) => `
            <label class="merge-row pick">
              <input type="radio" name="mp-target" value="${i}">
              <span class="merge-from">
                <span class="merge-name">${esc(o.name)}</span>
                <span class="merge-games">${tr("{n} deck(s)", { n: o.profiles.length })} · ${tr("{n} jogo(s)", { n: o.games })}</span>
              </span>
            </label>`).join("")}</div>
          <div id="mp-keep"></div>
          <div id="mp-decks"></div>
          <div class="row" style="margin-top:12px">
            <button class="btn btn-ghost grow" id="mp-cancel">${tr("Cancelar")}</button>
            <button class="btn btn-primary grow" id="mp-go" disabled>${I("merge")} ${tr("Fundir")}</button>
          </div>
        </div>
      </div>`);
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.querySelector("#mp-cancel").addEventListener("click", close);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    let other = null;
    let keep = "a";
    let pairs = [];
    backdrop.querySelectorAll('input[name="mp-target"]').forEach((r) => r.addEventListener("change", () => {
      other = others[+r.value];
      keep = other.games > me.games ? "b" : "a";
      const wrap = backdrop.querySelector("#mp-keep");
      wrap.innerHTML = keepSegHtml("mp-seg", me.name, other.name, keep);
      bindSeg(wrap, "mp-seg", (k) => { keep = k; });
      // decks dos dois que parecem o mesmo: sugere fundi-los também
      pairs = [];
      const used = new Set();
      me.profiles.forEach((a) => {
        const b = other.profiles.find((x) => !used.has(x.id) && sameDeck(a, x));
        if (b) { used.add(b.id); pairs.push([a, b]); }
      });
      backdrop.querySelector("#mp-decks").innerHTML = pairs.length ? `
        <div class="section-title">${tr("Decks repetidos")}</div>
        <p class="merge-hint">${tr("Estes decks parecem o mesmo nos dois nomes. Marcados = fundir também.")}</p>
        <div class="col merge-list">${pairs.map(([a, b], i) => `
          <label class="merge-row pick">
            <input type="checkbox" data-pair="${i}" checked>
            <span class="merge-from"><span class="merge-name">${esc(a.name)} + ${esc(b.name)}</span>
            <span class="merge-games">${tr("{n} jogo(s)", { n: a.stats.games + b.stats.games })}</span></span>
          </label>`).join("")}</div>` : "";
      backdrop.querySelector("#mp-go").disabled = false;
    }));
    backdrop.querySelector("#mp-go").addEventListener("click", () => {
      if (!other) return;
      const kept = keep === "a" ? me : other;
      const gone = keep === "a" ? other : me;
      const before = Profiles.snapshot();
      Profiles.mergePlayers(gone.name, kept.name);
      backdrop.querySelectorAll("input[data-pair]").forEach((cb) => {
        if (!cb.checked) return;
        const [a, b] = pairs[+cb.dataset.pair];
        const [to, from] = a.stats.games >= b.stats.games ? [a, b] : [b, a];
        Profiles.mergeProfiles(from.id, to.id);
      });
      close();
      const key = kept.name.trim().toLowerCase();
      nav("player-detail", { key });
      undoToast(tr("Jogadores fundidos"), () => { Profiles.replaceAll(before); nav("player-detail", { key: me.key }); }, 8000);
    });
  }

  // ---------------------------------------------------------
  // Sincronização na nuvem (grupo com código)
  // ---------------------------------------------------------
  const Cloud = window.MTG.Cloud;
  function agoText(ts) {
    if (!ts) return tr("nunca");
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 45) return tr("agora mesmo");
    if (s < 3600) return tr("há {n} min", { n: Math.max(1, Math.round(s / 60)) });
    return relativeDay(ts);
  }
  /** Cartão no ecrã de perfis: estado da sincronização ou convite. */
  function syncCardHtml() {
    const st = Cloud.status();
    if (!st.code) {
      return `
        <div class="sync-card off" id="sync-card">
          <span class="sync-ic">${I("cloud")}</span>
          <span class="sync-text">
            <span class="sync-title">${tr("Guardar na nuvem")}</span>
            <span class="sync-sub">${tr("Perfis guardados online e iguais em todos os telemóveis do grupo.")}</span>
          </span>
          <button class="btn btn-primary btn-sm" id="sync-open-btn">${tr("Ativar")}</button>
        </div>`;
    }
    const title = st.syncing ? tr("A sincronizar…")
      : st.lastError ? tr("Sem ligação — tenta mais tarde")
      : tr("Sincronizado {when}", { when: agoText(st.lastSync) });
    return `
      <div class="sync-card ${st.lastError && !st.syncing ? "err" : ""}" id="sync-card">
        <span class="sync-ic">${I(st.lastError && !st.syncing ? "cloud-off" : "cloud")}</span>
        <span class="sync-text">
          <span class="sync-title">${title}</span>
          <span class="sync-sub sync-code">${tr("Grupo {code}", { code: esc(st.code) })}</span>
        </span>
        <button class="btn btn-icon ${st.syncing ? "spin" : ""}" id="sync-now-btn" title="${tr("Sincronizar agora")}" aria-label="${tr("Sincronizar agora")}">${I("rotate")}</button>
        <button class="btn btn-ghost btn-sm" id="sync-open-btn">${tr("Grupo")}</button>
      </div>`;
  }
  function bindSyncCard(scope) {
    const card = scope.querySelector("#sync-card");
    if (!card) return;
    const openBtn = card.querySelector("#sync-open-btn");
    if (openBtn) openBtn.addEventListener("click", () => openCloudSheet());
    const now = card.querySelector("#sync-now-btn");
    if (now) now.addEventListener("click", () => {
      Cloud.sync().then((r) => { if (r && (r.profiles || r.games || r.removed)) render(); }).catch(() => toast(tr("Sem ligação — tenta mais tarde")));
    });
  }
  function repaintSyncCard() {
    const card = document.querySelector("#sync-card");
    if (!card) return;
    const fresh = el(syncCardHtml());
    card.replaceWith(fresh);
    bindSyncCard(fresh.parentNode || document);
  }

  /** Entrar num grupo: lê-o, mostra a revisão (pares parecidos a confirmar)
   *  e só depois entra e sincroniza. */
  async function joinGroupFlow(rawCode, done) {
    const code = Cloud.normalizeCode(rawCode);
    if (!code) { alert(tr("Código inválido. Tem 12 letras/números, ex: K7QD-9XWM-2HPA.")); return; }
    toast(tr("A procurar o grupo…"));
    let remote;
    try { remote = await Cloud.peekGroup(code); } catch (e) { alert(tr("Sem ligação — tenta mais tarde")); return; }
    if (!remote || !remote.data) { alert(tr("Não existe nenhum grupo com esse código.")); return; }
    const dead = (remote.data.deleted && remote.data.deleted.profiles) || {};
    const list = (remote.data.profiles || []).filter((p) => p && !dead[p.id]);
    const enter = () => {
      Cloud.joinGroup(code)
        .then(() => { toast(tr("Entraste no grupo")); render(); done && done(); })
        .catch(() => { toast(tr("Sem ligação — tenta mais tarde")); render(); });
    };
    if (!list.length) { enter(); return; }
    openMergeReview(list, { playerAliases: remote.data.playerAliases, title: tr("Entrar no grupo"), confirmLabel: tr("Juntar e entrar"), onApplied: enter }, done);
  }

  /** Janela do grupo: criar/entrar (sem grupo) ou código, QR e sair. */
  function openCloudSheet() {
    closeAnyModal();
    const st = Cloud.status();
    const backdrop = el(st.code ? `
      <div class="modal-backdrop">
        <div class="modal-sheet qr-sheet cloud-sheet">
          <h2>${tr("Grupo na nuvem")}</h2>
          <p class="merge-hint">${tr("Quem tiver este código vê e junta os mesmos perfis e jogos. Partilha-o só com quem joga contigo.")}</p>
          <div class="cloud-code">${esc(st.code)}</div>
          <div class="qr-box"><canvas id="cloud-qr"></canvas></div>
          <div class="merge-actions" style="margin-top:14px">
            <button class="btn btn-ghost" id="cloud-share">${I("share")} ${tr("Partilhar código")}</button>
            <button class="btn btn-ghost" id="cloud-sync">${I("rotate")} ${tr("Sincronizar agora")}</button>
          </div>
          <button class="btn btn-ghost btn-block danger-text" id="cloud-leave">${tr("Sair do grupo")}</button>
          <button class="btn btn-ghost btn-block" id="cloud-close" style="margin-top:8px">${tr("Fechar")}</button>
        </div>
      </div>` : `
      <div class="modal-backdrop">
        <div class="modal-sheet cloud-sheet">
          <h2>${tr("Guardar na nuvem")}</h2>
          <p class="merge-hint">${tr("Os perfis e jogos ficam guardados online, num grupo com um código. Se apagares a app ou trocares de telemóvel, entras com o código e fica tudo de volta. Quem tiver o código vê e junta os mesmos perfis.")}</p>
          <button class="btn btn-primary btn-block" id="cloud-create">${I("cloud")} ${tr("Criar grupo")}</button>
          <div class="section-title">${tr("Já tenho um código")}</div>
          <div class="cloud-join">
            <input type="text" id="cloud-code-input" placeholder="K7QD-9XWM-2HPA" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="16">
            <button class="btn btn-primary" id="cloud-join">${tr("Entrar")}</button>
          </div>
          <button class="btn btn-ghost btn-block" id="cloud-scan" style="margin-top:8px">${I("scan")} ${tr("Ler QR do grupo")}</button>
          <button class="btn btn-ghost btn-block" id="cloud-close" style="margin-top:8px">${tr("Fechar")}</button>
        </div>
      </div>`);
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.querySelector("#cloud-close").addEventListener("click", close);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    if (st.code) {
      MTG.QrSync.encode({ type: "mtg-group", code: st.code })
        .then((frames) => MTG.QrSync.draw(backdrop.querySelector("#cloud-qr"), frames[0], Math.min(220, window.innerWidth - 120)))
        .catch(() => {});
      backdrop.querySelector("#cloud-share").addEventListener("click", async () => {
        const text = tr("Código do nosso grupo no MTG Life Counter: {code}", { code: st.code });
        try {
          if (navigator.share) { await navigator.share({ text }); return; }
        } catch (e) { if (e && e.name === "AbortError") return; }
        try { await navigator.clipboard.writeText(st.code); toast(tr("Código copiado")); } catch (e) { toast(st.code); }
      });
      backdrop.querySelector("#cloud-sync").addEventListener("click", () => {
        close();
        Cloud.sync().then(() => { toast(tr("Sincronizado")); render(); }).catch(() => toast(tr("Sem ligação — tenta mais tarde")));
      });
      backdrop.querySelector("#cloud-leave").addEventListener("click", () => {
        if (!confirm(tr("Sair do grupo? Os perfis continuam neste telemóvel, mas deixam de sincronizar."))) return;
        Cloud.leaveGroup();
        close();
        render();
      });
      return;
    }
    backdrop.querySelector("#cloud-create").addEventListener("click", () => {
      close();
      toast(tr("A criar o grupo…"));
      Cloud.createGroup()
        .then(() => { render(); openCloudSheet(); })
        .catch(() => { Cloud.leaveGroup(); alert(tr("Sem ligação — tenta mais tarde")); render(); });
    });
    const input = backdrop.querySelector("#cloud-code-input");
    const join = () => { const v = input.value; close(); joinGroupFlow(v, render); };
    backdrop.querySelector("#cloud-join").addEventListener("click", join);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
    backdrop.querySelector("#cloud-scan").addEventListener("click", () => openQrScan(render));
  }

  /** Menu "Juntar com outro telemóvel": enviar os meus / receber os do outro. */
  function openMergeMenu(done) {
    closeAnyModal();
    const backdrop = el(`
      <div class="modal-backdrop">
        <div class="modal-sheet">
          <h2>${tr("Juntar com outro telemóvel")}</h2>
          <p class="merge-hint">${tr("Para os dois ficarem com os mesmos perfis e jogos, cada um envia os seus e recebe os do outro. Os jogos que já existam não se repetem.")}</p>
          <div class="section-title">${tr("Enviar os meus")}</div>
          <div class="merge-actions">
            <button class="btn btn-ghost" id="mm-send-qr">${I("qr")} ${tr("Mostrar QR")}</button>
            <button class="btn btn-ghost" id="mm-send-file">${I("upload")} ${tr("Enviar ficheiro")}</button>
          </div>
          <div class="section-title">${tr("Receber do outro")}</div>
          <div class="merge-actions">
            <button class="btn btn-ghost" id="mm-recv-qr">${I("scan")} ${tr("Ler QR")}</button>
            <button class="btn btn-ghost" id="mm-recv-file">${I("download")} ${tr("Abrir ficheiro")}</button>
          </div>
          <input type="file" id="mm-file" accept="application/json,.json" style="display:none">
          <button class="btn btn-ghost btn-block" id="mm-close" style="margin-top:16px">${tr("Fechar")}</button>
        </div>
      </div>`);
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.querySelector("#mm-close").addEventListener("click", close);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector("#mm-send-file").addEventListener("click", () => saveBackup());
    backdrop.querySelector("#mm-send-qr").addEventListener("click", () => openQrShow());
    backdrop.querySelector("#mm-recv-qr").addEventListener("click", () => openQrScan(done));
    const input = backdrop.querySelector("#mm-file");
    backdrop.querySelector("#mm-recv-file").addEventListener("click", () => input.click());
    input.addEventListener("change", () => {
      const f = input.files && input.files[0];
      input.value = "";
      if (f) restoreBackupFile(f, done);
    });
  }

  function backupReminderHtml() {
    const games = Profiles.gameCount();
    const info = backupInfo();
    const since = games - (info.games || 0);
    if (since < BACKUP_EVERY || games - (info.snooze || 0) < BACKUP_EVERY) return "";
    // num grupo na nuvem sincronizado na última semana os dados já estão guardados
    const cs = Cloud.status();
    if (cs.code && cs.lastSync && Date.now() - cs.lastSync < 7 * 86400000) return "";
    const msg = info.at
      ? tr("{n} jogos novos desde a última cópia ({when}).", { n: since, when: relativeDay(info.at) })
      : tr("Tens {n} jogos guardados só neste aparelho. Guarda uma cópia nos Ficheiros ou no iCloud para não os perderes.", { n: games });
    return `
      <div class="backup-card">
        <span class="backup-text">
          <span class="last-kicker">${tr("Cópia de segurança")}</span>
          <span class="backup-msg" title="${esc(msg)}">${tr("{n} jogos sem cópia", { n: info.at ? since : games })}</span>
        </span>
        <button class="btn btn-primary" id="backup-btn">${tr("Guardar")}</button>
        <button class="btn btn-icon" id="backup-later-btn" title="${tr("Agora não")}" aria-label="${tr("Agora não")}">${I("x")}</button>
      </div>`;
  }

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
        <div class="modal-sheet">
          <h2>${esc(title || tr("Escolher commander"))}</h2>
          <input type="text" id="cp-input" placeholder="${tr("Nome do commander (ex: Atraxa, Krenko...)")}" autocomplete="off" autocorrect="off" spellcheck="false">
          <div class="search-status hidden" id="cp-status"></div>
          <div class="search-results" id="cp-results"></div>
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
    `);
    document.body.appendChild(backdrop);
    const input = backdrop.querySelector("#cp-input");
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
    // (sem closeAnyModal aqui de propósito: pode abrir por cima do modal de editar jogador)
    const profiles = Profiles.all();
    const backdrop = el(`
      <div class="modal-backdrop">
        <div class="modal-sheet">
          <h2>${tr("Perfil do jogador")}</h2>
          <div class="footer-note" style="margin-bottom:10px">${tr("Os perfis guardam as estatísticas deste commander entre jogos (vitórias, tempo médio por turno/jogo, etc).")}</div>
          <div class="col" id="pp-list" style="max-height:38vh;overflow-y:auto"></div>
          <div class="row" style="margin-top:10px">
            <button class="btn btn-ghost grow" id="pp-new">${I("plus")} ${tr("Criar novo perfil")}</button>
            ${currentProfileId ? `<button class="btn btn-ghost grow" id="pp-clear">${I("x")} ${tr("Remover perfil")}</button>` : ""}
          </div>
          <div id="pp-new-form" class="col hidden" style="margin-top:10px">
            <input type="text" id="pp-new-name" placeholder="${tr("Nome do perfil")}" value="${commander ? esc(commander.name) : ""}">
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
            <div class="type">${tr("{g} jogos · {w} vitórias", { g: d.games, w: d.wins })}${d.games ? " (" + Math.round(d.winRate * 100) + "%)" : ""}</div>
          </div>
        </div>
      `);
      item.addEventListener("click", () => { onSelect(p.id); backdrop.remove(); });
      list.appendChild(item);
    });
    backdrop.querySelector("#pp-cancel").addEventListener("click", () => backdrop.remove());
    const clearBtn = backdrop.querySelector("#pp-clear");
    if (clearBtn) clearBtn.addEventListener("click", () => { onSelect(null); backdrop.remove(); });
    backdrop.querySelector("#pp-new").addEventListener("click", () => {
      if (!commander) { toast(tr("Escolhe primeiro um commander para este jogador.")); return; }
      backdrop.querySelector("#pp-new-form").classList.toggle("hidden");
    });
    backdrop.querySelector("#pp-new-confirm").addEventListener("click", () => {
      const name = backdrop.querySelector("#pp-new-name").value.trim();
      const profile = Profiles.create({ name, commander, playerName });
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
  /** HTML dos extras de um lugar. `seats` = todos os lugares (para saber
   *  que perfis já estão ocupados e se este perfil está repetido). */
  function seatExtrasHtml(p, idx, seats) {
    const others = seats.filter((_, j) => j !== idx).map((x) => x.profileId);
    const dupAt = p.profileId ? seats.findIndex((x, j) => j !== idx && x.profileId === p.profileId) : -1;
    const recents = p.profileId ? [] : recentProfiles(others, 3);
    const palette = State.FALLBACK_PALETTE;
    return `
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
        seat.profileId = pr.id;
        if (pr.commander) seat.commander = pr.commander;
        if (pr.playerName) seat.name = pr.playerName;
        if (typeof pr.colorIdx === "number") seat.colorIdx = pr.colorIdx;
        rerender();
        return;
      }
      const cb = e.target.closest("[data-color]");
      if (cb) {
        getSeat().colorIdx = parseInt(cb.dataset.color, 10);
        rerender();
      }
    });
  }

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
            [preset.cmdDmgToggle ? "Commander damage" : "", tr("Tempo e turnos"), tr("Veneno")].filter(Boolean).join(" · "),
            (preset.cmdDmgToggle ? switchFieldHtml("cfg-cmddmg", "Commander damage", tr("Contador de dano de commander por oponente (21 elimina)."), draft.cmdDmgEnabled) : "") +
            trackTurnsFieldHtml(draft.trackTurns !== false) +
            switchFieldHtml("cfg-poison", tr("Contadores de veneno"), tr("Mostra um contador de veneno em cada jogador (10 elimina)."), !!draft.poisonEnabled)
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
      });
      card.querySelector(".profile-btn").addEventListener("click", () => {
        openProfilePicker({
          commander: draft.players[i].commander,
          currentProfileId: draft.players[i].profileId,
          playerName: draft.players[i].name,
          onSelect: (id) => {
            draft.players[i].profileId = id;
            const prof = id ? Profiles.get(id) : null;
            if (prof && prof.commander) draft.players[i].commander = prof.commander;
            if (prof && prof.playerName) draft.players[i].name = prof.playerName;
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
    s.querySelector("#cfg-poison").addEventListener("change", (e) => { draft.poisonEnabled = e.target.checked; });
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
              ${game.standard.poisonEnabled ? `<div class="poison-badge ${(p.poison || 0) >= 10 ? "lethal" : ""}" data-action="poison" title="${tr("Veneno")}">${I("flask")}<span>${p.poison || 0}</span></div>` : ""}
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
    const poisonBadge = panel.querySelector('[data-action="poison"]');
    if (poisonBadge) poisonBadge.addEventListener("click", (ev) => { ev.stopPropagation(); openPoisonModal(p.id); });
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

  /** Contador de veneno de um jogador (modo standard). */
  function openPoisonModal(playerId) {
    const p = game.standard.players.find((x) => x.id === playerId);
    if (!p) return;
    closeAnyModal();
    const backdrop = el(`
      <div class="modal-backdrop center">
        <div class="modal-sheet">
          <h2>${tr("Veneno — {name}", { name: esc(p.name) })}</h2>
          <div class="footer-note">${tr("Com 10 ou mais contadores de veneno o jogador é eliminado.")}</div>
          <div class="cd-stepper">
            <button class="btn btn-icon cd-round-btn" data-d="-1" aria-label="${tr("Menos um")}">${I("minus")}</button>
            <div class="cd-value" id="poison-val">${p.poison || 0}</div>
            <button class="btn btn-icon cd-round-btn" data-d="1" aria-label="${tr("Mais um")}">${I("plus")}</button>
          </div>
          <button class="btn btn-ghost btn-block" id="poison-close">${tr("Fechar")}</button>
        </div>
      </div>
    `);
    document.body.appendChild(backdrop);
    backdrop.querySelectorAll("[data-d]").forEach((b) => b.addEventListener("click", () => {
      State.stdAdjustPoison(game, playerId, parseInt(b.dataset.d, 10));
      backdrop.querySelector("#poison-val").textContent = p.poison || 0;
      backdrop.querySelector("#poison-val").classList.toggle("lethal", (p.poison || 0) >= 10);
      updateStandardPanel(playerId);
    }));
    backdrop.querySelector("#poison-close").addEventListener("click", () => backdrop.remove());
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
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
    const pb = panel.querySelector(".poison-badge");
    if (pb) { pb.querySelector("span").textContent = p.poison || 0; pb.classList.toggle("lethal", (p.poison || 0) >= 10); }
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
      const v = p.counters && p.counters[k];
      if (v) out += `<span class="st-chip" title="${esc(COUNTER_META[k].label())}">${I(COUNTER_META[k].icon)}<b>${v}</b></span>`;
    });
    return out;
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
              <button class="ps-n-btn" data-n="-1" aria-label="${tr("Menos")}">${I("minus")}</button>
              <b data-n-val>1</b>
              <button class="ps-n-btn" data-n="1" aria-label="${tr("Mais")}">${I("plus")}</button>
            </div>
            <div class="ps-group-btns">
              <button class="btn btn-ghost btn-sm" data-group="opponents">${tr("Cada adversário −{n}", { n: "<span data-n-txt>1</span>" })}</button>
              <button class="btn btn-ghost btn-sm" data-group="drain">${tr("Drenar {n}", { n: "<span data-n-txt>1</span>" })}</button>
              <button class="btn btn-ghost btn-sm" data-group="all">${tr("Toda a mesa −{n}", { n: "<span data-n-txt>1</span>" })}</button>
            </div>
          </div>

          <div class="section-title">${tr("Contadores")}</div>
          <div class="ps-counters">${Object.keys(COUNTER_META).map((k) => `
            <div class="ps-counter" data-key="${k}">
              <span class="ps-c-label">${I(COUNTER_META[k].icon)} ${esc(COUNTER_META[k].label())}</span>
              <button class="ps-c-btn" data-c="-1" aria-label="${tr("Menos")}">${I("minus")}</button>
              <b data-c-val>${(p.counters && p.counters[k]) || 0}</b>
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
      backdrop.querySelectorAll(".ps-counter").forEach((row) => { row.querySelector("[data-c-val]").textContent = (p.counters && p.counters[row.dataset.key]) || 0; });
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
      State.stdAdjustCounter(game, p.id, row.dataset.key, parseInt(b.dataset.c, 10));
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
          }
          if (prof && prof.playerName) {
            backdrop.querySelector("#ep-name").value = prof.playerName;
          }
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
          </div>
        </div>
      `);
      card.querySelector(".commander-thumb").addEventListener("click", () => {
        openCommanderPicker((c) => {
          draft.commanders[i] = c;
          card.querySelector(".commander-thumb").style.cssText = commanderThumbStyle(c);
          card.querySelector(".commander-thumb").innerHTML = c ? "" : I("card");
          card.querySelector(".commander-name").textContent = c ? c.name : tr("Sem commander escolhido");
        });
      });
      card.querySelector(".name-input").addEventListener("input", (e) => { draft.names[i] = e.target.value; });
      card.querySelector(".profile-btn").addEventListener("click", () => {
        openProfilePicker({
          commander: draft.commanders[i],
          currentProfileId: draft.profileIds[i],
          playerName: draft.names[i],
          onSelect: (id) => {
            draft.profileIds[i] = id;
            const p = id ? Profiles.get(id) : null;
            card.querySelector(".profile-btn").innerHTML = profileBtnHtml(p);
            if (p && p.commander) {
              draft.commanders[i] = p.commander;
              card.querySelector(".commander-thumb").style.cssText = commanderThumbStyle(p.commander);
              card.querySelector(".commander-thumb").textContent = "";
              card.querySelector(".commander-name").textContent = p.commander.name;
            }
            if (p && p.playerName) {
              draft.names[i] = p.playerName;
              card.querySelector(".name-input").value = p.playerName;
            }
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
      card.querySelector(".name-input").addEventListener("input", (e) => { draft.teams[t].players[i].name = e.target.value; });
      card.querySelector(".profile-btn").addEventListener("click", () => {
        openProfilePicker({
          commander: draft.teams[t].players[i].commander,
          currentProfileId: draft.teams[t].players[i].profileId,
          playerName: draft.teams[t].players[i].name,
          onSelect: (id) => {
            draft.teams[t].players[i].profileId = id;
            const prof = id ? Profiles.get(id) : null;
            if (prof && prof.commander) draft.teams[t].players[i].commander = prof.commander;
            if (prof && prof.playerName) draft.teams[t].players[i].name = prof.playerName;
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

  // ===========================================================
  // ANIMAÇÃO DE VITÓRIA — confetes pastel + cartão do vencedor
  // ===========================================================
  let celebratedGameAt = null; // evita repetir a festa do BR em cada re-render

  /** Dados do vencedor a partir das stats de fim de jogo (Standard/Equipas). */
  function winnerOfStats(stats) {
    if (!stats || !stats.winnerId || !game) return null;
    if (game.mode === "teams") {
      const team = game.teams.teams.find((t) => t.id === stats.winnerId);
      if (!team) return null;
      return { name: team.name, commander: team.players[0] && team.players[0].commander, bgStyle: playerBgStyle(team.players[0]), subtitle: team.players.map((p) => p.name).join(" · ") };
    }
    const p = game.standard && game.standard.players.find((x) => x.id === stats.winnerId);
    if (!p) return null;
    return { name: p.name, commander: p.commander, bgStyle: playerBgStyle(p), subtitle: p.commander ? p.commander.name : "" };
  }

  const CONFETTI_COLORS = ["#f4b3a0", "#b9d5f2", "#bfe4cc", "#c4cdf2", "#f5e0a0", "#f8cfa0", "#b8e3de", "#d6e8b4"];

  /** Mostra o vencedor por cima do ecrã de resultado, com confetes a cair.
   *  Toca em qualquer sítio para fechar (fecha sozinho ao fim de uns segundos). */
  function celebrateVictory({ name, bgStyle, subtitle }) {
    const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const overlay = el(`
      <div class="victory-overlay">
        <canvas class="victory-confetti"></canvas>
        <div class="victory-card">
          <div class="victory-avatar" style="${bgStyle || ""}"><span class="victory-crown">${I("crown")}</span></div>
          <div class="victory-label">${tr("Vitória")}</div>
          <div class="victory-name">${esc(name)}</div>
          ${subtitle ? `<div class="victory-sub">${esc(subtitle)}</div>` : ""}
          <div class="victory-hint">${tr("Toca para continuar")}</div>
        </div>
      </div>
    `);
    document.body.appendChild(overlay);
    let raf = null;
    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      overlay.classList.add("closing");
      setTimeout(() => { cancelAnimationFrame(raf); overlay.remove(); }, 350);
    }
    overlay.addEventListener("click", close);
    setTimeout(close, 6000);
    if (reduceMotion) return;

    const canvas = overlay.querySelector("canvas");
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth, H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    const pieces = Array.from({ length: 140 }, (_, i) => ({
      x: W / 2 + (Math.random() - 0.5) * 60,
      y: H * 0.42,
      vx: (Math.random() - 0.5) * 13,
      vy: -Math.random() * 13 - 4,
      size: 6 + Math.random() * 7,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      round: Math.random() < 0.35,
      delay: Math.random() * 18,
    }));
    let frame = 0;
    (function draw() {
      frame++;
      ctx.clearRect(0, 0, W, H);
      let alive = 0;
      pieces.forEach((c) => {
        if (frame < c.delay) { alive++; return; }
        c.vy += 0.28; c.vx *= 0.985; c.vy *= 0.985;
        c.x += c.vx; c.y += c.vy; c.rot += c.vr;
        if (c.y > H + 20) return;
        alive++;
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(c.rot);
        ctx.fillStyle = c.color;
        if (c.round) { ctx.beginPath(); ctx.arc(0, 0, c.size / 2.4, 0, Math.PI * 2); ctx.fill(); }
        else ctx.fillRect(-c.size / 2, -c.size / 4, c.size, c.size / 2);
        ctx.restore();
      });
      if (alive && !closed) raf = requestAnimationFrame(draw);
    })();
  }

  // ===========================================================
  // ESTATÍSTICAS DE FIM DE JOGO (partilhado por Standard e Battle Royale)
  // ===========================================================
  function buildStatsBlock(stats) {
    const isWinnerId = (id) => Array.isArray(stats.winnerId) ? stats.winnerId.includes(id) : stats.winnerId === id;
    const avatar = (p) => `<div class="stat-avatar" style="${p.commander && p.commander.art ? `background-image:url('${esc(p.commander.art)}')` : ""}">${p.commander ? "" : I("card")}</div>`;
    if (stats.timed === false) {
      // jogo sem contagem de tempo/turnos: só a classificação (vencedor primeiro)
      const rows = stats.players
        .slice()
        .sort((a, b) => (isWinnerId(b.id) - isWinnerId(a.id)) || (a.eliminated - b.eliminated))
        .map((p) => `
          <div class="stat-row ${isWinnerId(p.id) ? "winner" : ""}">
            ${avatar(p)}
            <div class="stat-info">
              <div class="stat-name">${isWinnerId(p.id) ? I("crown", "ic-win") + " " : ""}${esc(p.name)}</div>
              <div class="stat-meta">${isWinnerId(p.id) ? tr("Vencedor") : p.eliminated ? tr("Eliminado") : tr("Em jogo no fim")}</div>
            </div>
          </div>`)
        .join("");
      return `<div class="stats-list">${rows}</div>`;
    }
    const maxTime = Math.max(1, ...stats.players.map((p) => p.turnTimeMs));
    const rows = stats.players
      .slice()
      .sort((a, b) => b.turnTimeMs - a.turnTimeMs)
      .map((p) => {
        const pct = stats.gameTimeMs ? Math.round((p.turnTimeMs / stats.gameTimeMs) * 100) : 0;
        const barPct = Math.round((p.turnTimeMs / maxTime) * 100);
        const isWinner = isWinnerId(p.id);
        return `
          <div class="stat-row ${isWinner ? "winner" : ""}">
            ${avatar(p)}
            <div class="stat-info">
              <div class="stat-name">${isWinner ? I("crown", "ic-win") + " " : ""}${esc(p.name)}${p.eliminated ? ` <span class="stat-tag">${tr("eliminado")}</span>` : ""}</div>
              <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${barPct}%"></div></div>
              <div class="stat-meta">${tr("{turn} em turno · {n} turno(s) · média {avg}/turno · {pct}% do jogo", { turn: formatDuration(p.turnTimeMs), n: p.turnsTaken, avg: formatDuration(p.avgTurnMs), pct })}</div>
            </div>
          </div>`;
      })
      .join("");
    return `
      <div class="stats-total">${tr("Duração total do jogo")} <strong>${formatDuration(stats.gameTimeMs)}</strong></div>
      <div class="stats-list">${rows}</div>
      ${lifeChartHtml(stats)}
    `;
  }

  // Gráfico "Vida ao longo do jogo" (só em jogos com turnos): uma linha por
  // jogador/equipa com a vida no fim de cada turno.
  const turnTitle = (tl, i) => {
    if (i === 0) return tr("Início do jogo");
    const t = tl.turns[i - 1] || {};
    return tr("Turno {n}", { n: i }) + (t.round ? " · " + tr("Ronda {n}", { n: t.round }) : "") + (t.name ? " · " + tr("vez de {name}", { name: t.name }) : "");
  };
  function lifeChartHtml(stats) {
    const tl = stats.lifeTimeline;
    if (!tl || !tl.series || !tl.series.length || tl.turns.length < 1) return "";
    const n = tl.turns.length;
    const table = `
      <details class="ml-table-wrap">
        <summary>${tr("Ver em tabela")}</summary>
        <div class="ml-table-scroll">
          <table class="ml-table">
            <thead><tr><th>${tr("Turno")}</th>${tl.series.map((s) => `<th>${esc(s.name)}</th>`).join("")}</tr></thead>
            <tbody>${tl.series[0].values.map((_, i) => `
              <tr><td>${i === 0 ? tr("Início") : i + (tl.turns[i - 1] && tl.turns[i - 1].name ? " · " + esc(tl.turns[i - 1].name) : "")}</td>${tl.series.map((s) => `<td>${s.values[i]}</td>`).join("")}</tr>`).join("")}
            </tbody>
          </table>
        </div>
      </details>`;
    return `
      <div class="chart-card stats-life-chart">
        <div class="chart-title">${tr("Vida ao longo do jogo")}</div>
        <div class="chart-sub">${tr("Vida de cada um no fim de cada turno. Toca num nome para o destacar.")}</div>
        ${Charts.multiLine(tl.series, { xLabel: (i) => (i === 0 ? tr("Início") : tr("Turno {n}", { n: i })), aria: tr("Vida ao longo do jogo, {n} turno(s)", { n }) })}
        ${table}
      </div>`;
  }

  function renderStatsStandard() {
    const stats = screenParams.stats;
    const s = el(`
      <div class="screen">
        <div class="topbar">
          <div style="width:40px"></div>
          <h1>${tr("Resultado")}</h1>
          <div style="width:40px"></div>
        </div>
        <div class="scroll">${buildStatsBlock(stats)}</div>
        <div class="board-toolbar">
          <button class="btn btn-primary btn-block" id="stats-menu-btn">Menu</button>
        </div>
      </div>
    `);
    appEl.appendChild(s);
    if (stats.lifeTimeline && stats.timed !== false && s.querySelector(".chart-multiline")) {
      Charts.bindMultiLine(s, stats.lifeTimeline.series, { tipTitle: (i) => turnTitle(stats.lifeTimeline, i) });
    }
    if (screenParams.celebrate) {
      screenParams.celebrate = false; // só na primeira vez que se abre este ecrã
      const w = winnerOfStats(stats);
      if (w) celebrateVictory(w);
    }
    s.querySelector("#stats-menu-btn").addEventListener("click", () => { State.clear(); nav("menu"); });
  }

  // ===========================================================
  // TROCAR POSIÇÕES / HISTÓRICO DE VIDA (jogo atual, qualquer modo)
  // ===========================================================
  /** Deixa reordenar a posição dos jogadores/equipas no tabuleiro (só a
   *  disposição visual — não mexe na ordem dos turnos). mode: "standard" |
   *  "br" | "teams". */
  function openReorderPositionsModal(mode) {
    closeAnyModal();
    const ms = mode === "standard" ? game.standard : mode === "teams" ? game.teams : game.br;
    const curId = ms.turnOrder ? ms.turnOrder[ms.currentTurnIndex] : null;
    let items;
    if (mode === "standard") items = game.standard.players.map((p) => ({ id: p.id, name: p.name, commander: p.commander, seatStyle: playerBgStyle(p) }));
    else if (mode === "teams") items = game.teams.teams.map((t) => ({ id: t.id, name: t.name, commander: t.players[0] && t.players[0].commander, seatStyle: t.players[0] ? playerBgStyle(t.players[0]) : "" }));
    else items = game.br.players.map((p) => ({ id: p.id, name: p.name, commander: p.commander, seatStyle: playerBgStyle(p) }));
    const asTable = mode !== "br"; // o Battle Royale é uma lista, não uma mesa

    const backdrop = el(`
      <div class="modal-backdrop center">
        <div class="modal-sheet reorder-sheet">
          <h2>${tr("Trocar posições")}</h2>
          ${asTable ? `<div class="mesa reorder-mesa" id="ro-mesa"></div>` : `<div class="col reorder-list" id="reorder-list"></div>`}
          <button class="btn btn-primary btn-block" id="reorder-done-btn" style="margin-top:14px">${tr("Concluído")}</button>
        </div>
      </div>
    `);
    document.body.appendChild(backdrop);

    // cada troca fica logo guardada; a ordem dos turnos segue os lugares
    function applyOrder() {
      const ids = items.map((it) => it.id);
      if (mode === "standard") State.stdReorderPlayers(game, ids);
      else if (mode === "teams") State.teamsReorderTeams(game, ids);
      else State.brReorderPlayers(game, ids);
    }
    function swap(i, j) {
      if (i === j || i < 0 || j < 0) return;
      [items[i], items[j]] = [items[j], items[i]];
      applyOrder();
      paint();
      [i, j].forEach((k) => { const el2 = backdrop.querySelector(`[data-seat="${k}"]`); if (el2) retrigger(el2, "seat-swap"); });
    }

    let picked = null; // tocar num lugar e depois noutro troca-os
    function paint() {
      if (asTable) {
        const mesa = backdrop.querySelector("#ro-mesa");
        mesa.innerHTML = mesaInnerHtml(items);
        items.forEach((it, i) => {
          const seatEl = mesa.querySelector(`[data-seat="${i}"]`);
          if (!seatEl) return;
          seatEl.classList.toggle("current", it.id === curId);
          seatEl.classList.toggle("picked", picked === i);
        });
        return;
      }
      const list = backdrop.querySelector("#reorder-list");
      list.innerHTML = items.map((it, i) => `
        <div class="reorder-row ${it.id === curId ? "current" : ""}" data-seat="${i}">
          <span class="mesa-num">${i + 1}</span>
          <span class="reorder-name">${esc(it.name)}</span>
          <button class="btn btn-icon" data-act="up" data-i="${i}" aria-label="${tr("Subir")}" ${i === 0 ? "disabled" : ""}>${I("chevron-up")}</button>
          <button class="btn btn-icon" data-act="down" data-i="${i}" aria-label="${tr("Descer")}" ${i === items.length - 1 ? "disabled" : ""}>${I("chevron-down")}</button>
        </div>`).join("");
      list.querySelectorAll("[data-act]").forEach((btn) => btn.addEventListener("click", () => {
        const i = parseInt(btn.dataset.i, 10);
        swap(i, btn.dataset.act === "up" ? i - 1 : i + 1);
      }));
    }
    paint();
    if (asTable) {
      bindMesa(backdrop.querySelector("#ro-mesa"), (a, b) => { picked = null; swap(a, b); }, (i) => {
        if (picked === null) picked = i;
        else if (picked === i) picked = null;
        else { const a = picked; picked = null; swap(a, i); return; }
        paint();
      });
    }
    const close = () => { backdrop.remove(); render(); };
    backdrop.querySelector("#reorder-done-btn").addEventListener("click", close);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  }

  /** Histórico ao vivo das alterações de vida do jogo atual (qualquer modo),
   *  agrupado por turno — mostra CADA alteração individual (ex: -3, +5, -1),
   *  não só a diferença total acumulada, e quem estava a jogar em cada turno. */
  function openLifeHistoryModal() {
    closeAnyModal();
    const modeState = game.mode === "standard" ? game.standard : game.mode === "br" ? game.br : game.teams;
    const log = (modeState && modeState.lifeLog) || [];
    const timedLog = !modeState || modeState.trackTurns !== false;
    const groups = [];
    const byTurn = new Map();
    log.forEach((entry) => {
      if (!byTurn.has(entry.turnSeq)) {
        const g = { turnSeq: entry.turnSeq, roundNumber: entry.roundNumber, turnName: entry.turnName, entries: [] };
        byTurn.set(entry.turnSeq, g);
        groups.push(g);
      }
      byTurn.get(entry.turnSeq).entries.push(entry);
    });
    groups.sort((a, b) => b.turnSeq - a.turnSeq);

    const backdrop = el(`
      <div class="modal-backdrop center">
        <div class="modal-sheet">
          <h2>${tr("Histórico de vida")}</h2>
          <div class="scroll" style="padding:0; flex:1; min-height:0;">
            ${groups.length ? `<div id="life-history-list"></div>` : `<div class="footer-note">${tr("Ainda não há alterações de vida registadas neste jogo.")}</div>`}
          </div>
          <div class="row" style="margin-top:12px;">
            <button class="btn btn-ghost grow" id="close-lh-btn">${tr("Fechar")}</button>
          </div>
        </div>
      </div>
    `);
    document.body.appendChild(backdrop);
    // Junta toques consecutivos do MESMO alvo feitos a menos de 2s uns dos
    // outros numa só linha (o mesmo intervalo usado no indicador ao vivo do
    // tabuleiro) — ex: -1,-1,-1 seguidos viram uma linha "-3" — mas mantém
    // ações separadas no tempo como linhas distintas (-3; +5; -1), nunca
    // reduzindo tudo à diferença total do turno.
    function mergeBursts(entries) {
      const merged = [];
      entries.forEach((entry) => {
        const last = merged[merged.length - 1];
        if (last && last.targetId === entry.targetId && entry.ts - last.lastTs <= 2000) {
          last.delta += entry.delta;
          last.lastTs = entry.ts;
        } else {
          merged.push({ targetId: entry.targetId, targetName: entry.targetName, delta: entry.delta, ts: entry.ts, lastTs: entry.ts });
        }
      });
      return merged;
    }

    const list = backdrop.querySelector("#life-history-list");
    if (list) {
      list.classList.add("lh-timeline");
      groups.forEach((g) => {
        const bursts = mergeBursts(g.entries.slice().sort((a, b) => a.ts - b.ts)).filter((b) => b.delta !== 0);
        if (!timedLog) bursts.reverse(); // sem turnos: lista simples, mais recente primeiro
        if (!bursts.length) return;
        if (timedLog) list.appendChild(el(`<div class="lh-turn"><span class="lh-turn-round">${tr("Ronda {n}", { n: g.roundNumber })}</span> · ${tr("Turno de {name}", { name: esc(g.turnName) })}</div>`));
        bursts.forEach((entry) => {
          const sign = entry.delta > 0 ? "plus" : "minus";
          const row = el(`
            <div class="lh-event ${sign}">
              <div class="lh-event-body">
                <div class="lh-event-name">${esc(entry.targetName)}</div>
                <div class="lh-event-time">${formatTimeOnly(entry.ts)}</div>
              </div>
              <div class="lh-event-delta ${sign}">${entry.delta > 0 ? "+" : ""}${entry.delta}</div>
            </div>
          `);
          list.appendChild(row);
        });
      });
      if (!list.children.length) list.appendChild(el(`<div class="footer-note">${tr("Ainda não há alterações de vida registadas neste jogo.")}</div>`));
    }
    backdrop.querySelector("#close-lh-btn").addEventListener("click", () => backdrop.remove());
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
  }

  let profileTab = "decks";     // separador do ecrã de perfis: "decks" | "players"
  let profileSort = "recent";   // ordenação escolhida no ecrã de perfis
  let profileSearch = "";        // texto da pesquisa (mantém-se ao voltar)
  function renderProfilesScreen() {
    const profiles = Profiles.all();
    const s = el(`
      <div class="screen">
        <div class="topbar">
          <button class="btn btn-icon" id="back-btn">${I("arrow-left")}</button>
          <h1>${tr("Perfis")}</h1>
          <div style="width:40px"></div>
        </div>
        <div class="scroll">
          ${syncCardHtml()}
          <div class="row" style="gap:8px; margin-bottom:6px;">
            <button class="btn btn-ghost grow" id="export-profiles-btn">${I("download")} ${tr("Exportar")}</button>
            <button class="btn btn-ghost grow" id="import-profiles-btn">${I("upload")} ${tr("Importar")}</button>
            <input type="file" id="import-profiles-input" accept="application/json,.json" style="display:none">
          </div>
          <button class="btn btn-ghost btn-block" id="merge-btn" style="margin-bottom:6px">${I("merge")} ${tr("Juntar com outro telemóvel")}</button>
          <div class="backup-note ${Cloud.status().code ? "hidden" : ""}">${backupInfo().at ? tr("Última cópia de segurança: {when}", { when: relativeDay(backupInfo().at) }) : tr("Os perfis ficam só neste aparelho. Exporta uma cópia de vez em quando.")}</div>
          ${profiles.length ? "" : `<div class="footer-note">${tr("Ainda não tens perfis guardados. Cria um ao escolher o commander de um jogador, no ecrã de setup de um jogo.")}</div>`}
          ${profiles.length ? `
          <div class="seg seg-3" role="tablist">
            <button type="button" class="seg-btn" role="tab" data-tab="decks" aria-selected="${profileTab === "decks"}">${tr("Decks")}</button>
            <button type="button" class="seg-btn" role="tab" data-tab="players" aria-selected="${profileTab === "players"}">${tr("Jogadores")}</button>
            <button type="button" class="seg-btn" role="tab" data-tab="ranking" aria-selected="${profileTab === "ranking"}">${tr("Classificação")}</button>
          </div>` : ""}
          <div id="players-view" class="${profileTab === "players" ? "" : "hidden"}"></div>
          <div id="ranking-view" class="${profileTab === "ranking" ? "" : "hidden"}"></div>
          <div id="decks-view" class="${profileTab === "decks" ? "" : "hidden"}">
          ${profilesOverviewHtml(profiles)}
          ${profiles.length ? `
          <div class="section-title">${tr("Perfis")}</div>
          <div class="profiles-tools">
            <label class="search-field">${I("search")}<input type="search" id="profile-search" placeholder="${tr("Procurar perfil, commander ou jogador")}" aria-label="${tr("Procurar perfis")}" value="${esc(profileSearch)}"></label>
            <div class="sort-row" role="group" aria-label="${tr("Ordenar")}">
              ${[["recent", tr("Mais recentes")], ["winrate", tr("% vitórias")], ["games", tr("Mais jogos")], ["name", tr("Nome")]].map(([k, l]) =>
                `<button type="button" class="sort-chip" data-sort="${k}" aria-pressed="${profileSort === k}">${l}</button>`).join("")}
            </div>
          </div>
          <div class="footer-note hidden" id="profiles-empty">${tr("Nenhum perfil corresponde à pesquisa.")}</div>` : ""}
          <div class="col" id="profiles-list"></div>
          </div>
        </div>
      </div>
    `);
    appEl.appendChild(s);
    s.querySelector("#export-profiles-btn").addEventListener("click", () => saveBackup().then((ok) => ok && render()));
    s.querySelector("#merge-btn").addEventListener("click", () => openMergeMenu(render));
    bindSyncCard(s);
    const importInput = s.querySelector("#import-profiles-input");
    s.querySelector("#import-profiles-btn").addEventListener("click", () => importInput.click());
    importInput.addEventListener("change", () => {
      const file = importInput.files && importInput.files[0];
      importInput.value = "";
      if (file) restoreBackupFile(file, render);
    });
    const list = s.querySelector("#profiles-list");
    profiles.forEach((p) => {
      const d = Profiles.derived(p);
      const card = el(`
        <div class="profile-card" data-id="${p.id}" role="button" tabindex="0">
          <div class="commander-thumb" style="${commanderThumbStyle(p.commander)}">${p.commander ? "" : I("card")}</div>
          <div class="profile-info">
            <div class="profile-name">${esc(p.name)} ${pipsHtml(colorIdentityOf(p))}</div>
            <div class="profile-sub">${p.commander ? esc(p.commander.name) : tr("Sem commander")}</div>
            <div class="profile-summary">${d.games ? tr("{g} jogos · {w} vitórias", { g: d.games, w: d.wins }) + ` (${Math.round(d.winRate * 100)}%)` : tr("Ainda sem jogos")}</div>
            ${d.games ? `<div class="meter" data-tip="${Math.round(d.winRate * 100)}%" data-tip-label="${esc(tr("{w} de {g} vitórias", { w: d.wins, g: d.games }))}"><div class="meter-fill" style="width:${Math.round(d.winRate * 100)}%"></div></div>` : ""}
          </div>
          <div class="col gap-sm">
            <button class="btn btn-icon" data-act="delete" data-id="${p.id}" title="${tr("Apagar perfil")}">${I("trash")}</button>
            <span class="profile-chevron">${I("chevron-right")}</span>
          </div>
        </div>
      `);
      card.querySelector('button[data-act="delete"]').addEventListener("click", (ev) => {
        ev.stopPropagation();
        const snapshot = JSON.parse(JSON.stringify(Profiles.get(p.id)));
        Profiles.remove(p.id);
        render();
        undoToast(tr("Perfil \"{name}\" apagado", { name: p.name }), () => { Profiles.restore(snapshot); render(); });
      });
      const open = () => nav("profile-detail", { id: p.id });
      card.addEventListener("click", open);
      card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
      card._profile = p;
      card._derived = d;
      list.appendChild(card);
    });

    // ordenar + pesquisar (reordena os cartões já criados, sem os recriar)
    const norm = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const lastUse = (p) => (p.history && p.history.length ? Math.max(...p.history.map((h) => h.date || 0)) : p.createdAt || 0);
    function paintList() {
      const q = norm(profileSearch.trim());
      const cards = Array.from(list.children);
      const cmp = {
        recent: (a, b) => lastUse(b._profile) - lastUse(a._profile),
        winrate: (a, b) => (b._derived.winRate - a._derived.winRate) || (b._derived.games - a._derived.games),
        games: (a, b) => b._derived.games - a._derived.games,
        name: (a, b) => a._profile.name.localeCompare(b._profile.name),
      }[profileSort];
      cards.sort(cmp).forEach((c) => list.appendChild(c));
      let shown = 0;
      cards.forEach((c) => {
        const p = c._profile;
        const hit = !q || [p.name, p.playerName, p.commander && p.commander.name].some((t) => norm(t).includes(q));
        c.classList.toggle("hidden", !hit);
        if (hit) shown++;
      });
      const empty = s.querySelector("#profiles-empty");
      if (empty) empty.classList.toggle("hidden", shown > 0);
    }
    const searchEl = s.querySelector("#profile-search");
    if (searchEl) searchEl.addEventListener("input", () => { profileSearch = searchEl.value; paintList(); });
    s.querySelectorAll(".sort-chip").forEach((b) => b.addEventListener("click", () => {
      profileSort = b.dataset.sort;
      s.querySelectorAll(".sort-chip").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      paintList();
    }));
    paintList();

    // separador "Jogadores": os decks agrupados por jogador
    const playersView = s.querySelector("#players-view");
    const players = playersFromProfiles(profiles).sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
    const noPlayer = profiles.filter((p) => !(p.playerName || "").trim()).length;
    playersView.innerHTML = (players.length ? `
      <div class="chart-card">
        <div class="chart-title">${tr("Taxa de vitórias por jogador")}</div>
        ${Charts.hbars(players.filter((pl) => pl.games).map((pl) => ({
          label: pl.name, value: pl.winRate,
          valueLabel: `${Math.round(pl.winRate * 100)}% · ${tr("{n} jogo(s)", { n: pl.games })}`,
          tip: `${Math.round(pl.winRate * 100)}%`, tipLabel: `${pl.name} · ${tr("{w} de {g} vitórias", { w: pl.wins, g: pl.games })}`,
        })).sort((a, b) => b.value - a.value))}
      </div>
      <div class="col">${players.map((pl, i) => `
        <div class="profile-card player-card" data-player="${esc(pl.key)}" role="button" tabindex="0">
          ${initialsAvatar(pl.name, i)}
          <div class="profile-info">
            <div class="profile-name">${esc(pl.name)}</div>
            <div class="profile-sub">${tr("{n} deck(s)", { n: pl.profiles.length })} · ${pl.games ? tr("{g} jogos · {w} vitórias", { g: pl.games, w: pl.wins }) + ` (${Math.round(pl.winRate * 100)}%)` : tr("Ainda sem jogos")}</div>
            ${pl.games ? `<div class="meter"><div class="meter-fill" style="width:${Math.round(pl.winRate * 100)}%"></div></div>` : ""}
          </div>
          <span class="profile-chevron">${I("chevron-right")}</span>
        </div>`).join("")}</div>` : `<div class="chart-card"><div class="footer-note">${tr("Ainda não há jogadores. Indica o jogador de cada perfil (em Editar perfil) para veres aqui as estatísticas de cada pessoa com todos os seus decks.")}</div></div>`) +
      (players.length && noPlayer ? `<div class="footer-note" style="margin-top:10px">${tr("{n} perfil(is) sem jogador indicado não aparecem aqui.", { n: noPlayer })}</div>` : "");
    playersView.querySelectorAll(".player-card").forEach((c) => {
      const open = () => nav("player-detail", { key: c.dataset.player });
      c.addEventListener("click", open);
      c.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    });
    s.querySelectorAll(".seg-btn").forEach((b) => b.addEventListener("click", () => {
      profileTab = b.dataset.tab;
      s.querySelectorAll(".seg-btn").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
      s.querySelector("#players-view").classList.toggle("hidden", profileTab !== "players");
      s.querySelector("#decks-view").classList.toggle("hidden", profileTab !== "decks");
      s.querySelector("#ranking-view").classList.toggle("hidden", profileTab !== "ranking");
    }));
    renderRankingView(s.querySelector("#ranking-view"));
    Charts.bindTips(s);
    s.querySelector("#back-btn").addEventListener("click", () => nav("menu"));
  }

  // ===========================================================
  // CLASSIFICAÇÃO ELO (jogadores e decks)
  // ===========================================================
  let rankKind = "players"; // "players" | "decks"
  const TIER_LABEL = {
    provisional: () => tr("Em calibração"), bronze: () => tr("Bronze"), silver: () => tr("Prata"),
    gold: () => tr("Ouro"), platinum: () => tr("Platina"), diamond: () => tr("Diamante"),
  };
  const tierChip = (t) => `<span class="tier-chip tier-${t}">${TIER_LABEL[t] ? TIER_LABEL[t]() : t}</span>`;
  const deltaHtml = (d) => (d ? `<small class="elo-delta ${d > 0 ? "up" : "down"}">${d > 0 ? "+" : "−"}${Math.abs(d)}</small>` : "");
  /** chave do ecrã de detalhe do jogador (igual à usada em playersFromProfiles) */
  function playerDetailKey(name) { return String(name || "").trim().toLowerCase(); }

  function renderRankingView(view) {
    if (!view) return;
    const data = MTG.Elo.compute(Profiles.all());
    const list = rankKind === "players" ? data.players : data.decks;
    const profilesById = new Map(Profiles.all().map((p) => [p.id, p]));
    const rows = list.map((r) => {
      const prof = rankKind === "decks" ? profilesById.get(r.key) : null;
      const avatar = rankKind === "players"
        ? initialsAvatar(r.name, r.rank - 1).replace("player-avatar", "player-avatar sm")
        : `<div class="commander-thumb sm" style="${prof ? seatThumbStyle(prof) : ""}">${prof && prof.commander && prof.commander.art ? "" : I("card")}</div>`;
      const sub = rankKind === "decks" && prof && prof.playerName ? esc(prof.playerName) + " · " : "";
      return `
        <div class="rank-row ${r.rank <= 3 && r.tier !== "provisional" ? "top top-" + r.rank : ""}" role="button" tabindex="0" data-key="${esc(r.key)}" data-name="${esc(r.name)}">
          <span class="rank-pos">${r.tier === "provisional" ? "–" : r.rank}</span>
          ${avatar}
          <span class="rank-info">
            <span class="rank-name">${esc(r.name)}</span>
            <span class="rank-sub">${sub}${tr("{w} V · {g} jogos", { w: r.wins, g: r.games })}</span>
          </span>
          ${tierChip(r.tier)}
          <span class="rank-score"><b>${r.rating}</b>${deltaHtml(r.delta)}</span>
        </div>`;
    }).join("");
    view.innerHTML = `
      <div class="rank-kind" role="tablist">
        <button type="button" class="sort-chip" data-kind="players" aria-pressed="${rankKind === "players"}">${tr("Jogadores")}</button>
        <button type="button" class="sort-chip" data-kind="decks" aria-pressed="${rankKind === "decks"}">${tr("Decks")}</button>
      </div>
      ${list.length ? `<div class="rank-list">${rows}</div>` : `<div class="chart-card"><div class="footer-note">${tr("Ainda não há jogos para a classificação. Contam os jogos com vencedor entre dois ou mais perfis.")}</div></div>`}
      <details class="rank-help">
        <summary>${tr("Como funciona")}</summary>
        <p>${tr("Todos começam com 1500 pontos. Em cada jogo, quem ganha \"vence\" cada adversário: ganhar a quem tem mais pontos dá mais, perder com quem tem menos tira mais. Jogos sem vencedor não contam.")}</p>
        <p>${tr("Ligas: Bronze até 1440, Prata 1440, Ouro 1490, Platina 1540, Diamante 1600. Com menos de {n} jogos fica em calibração.", { n: MTG.Elo.PROVISIONAL })}</p>
        <p>${tr("{n} jogo(s) contados.", { n: data.games })}</p>
      </details>`;
    view.querySelectorAll("[data-kind]").forEach((b) => b.addEventListener("click", () => { rankKind = b.dataset.kind; renderRankingView(view); }));
    view.querySelectorAll(".rank-row").forEach((row) => {
      const open = () => rankKind === "players"
        ? nav("player-detail", { key: playerDetailKey(row.dataset.name) })
        : nav("profile-detail", { id: row.dataset.key });
      row.addEventListener("click", open);
      row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    });
  }

  /** Cartão "Classificação" nos ecrãs de detalhe: posição, pontos, liga e
   *  a evolução dos pontos jogo a jogo. */
  function eloCardHtml(rec, total) {
    if (!rec) return "";
    const values = rec.series.map((x) => Math.round(x.rating));
    return `
      <div class="chart-card elo-card">
        <div class="elo-head">
          <span class="elo-rank">${rec.tier === "provisional" ? "–" : "#" + rec.rank}<small>/${total}</small></span>
          <span class="elo-main"><b>${rec.rating}</b> ${deltaHtml(rec.delta)}</span>
          ${tierChip(rec.tier)}
        </div>
        <div class="chart-title">${tr("Classificação ELO")}</div>
        <div class="chart-sub">${tr("Pontos depois de cada jogo")}</div>
        ${values.length >= 3 ? Charts.multiLine([{ name: tr("Pontos"), values }], { xLabel: (i) => (i === 0 ? tr("Início") : tr("Jogo {n}", { n: i })), aria: tr("Evolução da classificação") }) : `<div class="footer-note">${tr("Joga mais uns jogos para ver a evolução.")}</div>`}
      </div>`;
  }
  function bindEloCard(root, rec) {
    if (!rec || rec.series.length < 3) return;
    const values = rec.series.map((x) => Math.round(x.rating));
    Charts.bindMultiLine(root.querySelector(".elo-card") || root, [{ name: tr("Pontos"), values }], {
      tipTitle: (i) => (i === 0 ? tr("Início") : tr("Jogo {n}", { n: i }) + " · " + formatDateTime(rec.series[i].date)),
    });
  }

  /** Visão geral no topo do ecrã de perfis: números-resumo + comparação da
   *  taxa de vitórias entre perfis (só perfis com pelo menos 1 jogo). */
  function profilesOverviewHtml(profiles) {
    const withGames = profiles.map((p) => ({ p, d: Profiles.derived(p) })).filter((x) => x.d.games > 0);
    if (!withGames.length) return "";
    const totalGames = withGames.reduce((a, x) => a + x.d.games, 0);
    const best = withGames.slice().sort((a, b) => (b.d.winRate - a.d.winRate) || (b.d.games - a.d.games))[0];
    const rows = withGames
      .sort((a, b) => (b.d.winRate - a.d.winRate) || (b.d.games - a.d.games))
      .map(({ p, d }) => ({
        label: p.name,
        value: d.winRate,
        valueLabel: `${Math.round(d.winRate * 100)}% · ${tr("{n} jogo(s)", { n: d.games })}`,
        tip: `${Math.round(d.winRate * 100)}%`,
        tipLabel: `${p.name} · ${tr("{w} de {g} vitórias", { w: d.wins, g: d.games })}`,
      }));
    return `
      <div class="kpi-row">
        ${kpiHtml(tr("Perfis"), profiles.length)}
        ${kpiHtml(tr("Jogos registados"), totalGames)}
        ${kpiHtml(tr("Melhor taxa de vitórias"), `${Math.round(best.d.winRate * 100)}%`, best.p.name)}
      </div>
      <div class="chart-card">
        <div class="chart-title">${tr("Taxa de vitórias por perfil")}</div>
        ${Charts.hbars(rows)}
      </div>
      ${winRateByColorHtml(profiles)}`;
  }

  /** Identidade de cor do commander em "pips" (letra + cor, nunca só cor). */
  const MANA = ["W", "U", "B", "R", "G"];
  const MANA_NAMES = { W: "Branco", U: "Azul", B: "Preto", R: "Vermelho", G: "Verde", C: "Incolor" };
  function colorIdentityOf(profile) {
    const c = profile && profile.commander;
    if (!c || !Array.isArray(c.colorIdentity)) return null;
    return c.colorIdentity.length ? MANA.filter((m) => c.colorIdentity.includes(m)) : ["C"];
  }
  function pipsHtml(ids) {
    if (!ids || !ids.length) return "";
    return `<span class="pips" aria-label="${esc(ids.map((m) => tr(MANA_NAMES[m])).join(", "))}">${ids.map((m) => `<span class="pip pip-${m}" title="${tr(MANA_NAMES[m])}">${m}</span>`).join("")}</span>`;
  }
  /** Taxa de vitórias por cor: soma os jogos dos perfis cujo commander
   *  tem essa cor na identidade (um deck de 2 cores conta para as duas). */
  function winRateByColorHtml(profiles) {
    const agg = {};
    profiles.forEach((p) => {
      const ids = colorIdentityOf(p);
      const d = Profiles.derived(p);
      if (!ids || !d.games) return;
      ids.forEach((m) => {
        if (!agg[m]) agg[m] = { games: 0, wins: 0, decks: 0 };
        agg[m].games += d.games; agg[m].wins += d.wins; agg[m].decks++;
      });
    });
    const rows = MANA.concat("C").filter((m) => agg[m]).map((m) => {
      const a = agg[m], rate = a.wins / a.games;
      return {
        label: tr(MANA_NAMES[m]),
        labelHtml: `${pipsHtml([m])} ${esc(tr(MANA_NAMES[m]))}`,
        value: rate,
        valueLabel: `${Math.round(rate * 100)}% · ${tr("{n} jogo(s)", { n: a.games })}`,
        tip: `${Math.round(rate * 100)}%`,
        tipLabel: `${tr(MANA_NAMES[m])} · ${tr("{w} de {g} vitórias", { w: a.wins, g: a.games })} · ${tr("{n} deck(s)", { n: a.decks })}`,
      };
    }).sort((x, y) => y.value - x.value);
    if (!rows.length) return "";
    return `
      <div class="chart-card">
        <div class="chart-title">${tr("Taxa de vitórias por cor")}</div>
        <div class="chart-sub">${tr("Pela identidade de cor do commander; um deck com várias cores conta para cada uma")}</div>
        ${Charts.hbars(rows)}
      </div>`;
  }

  /** Cartão "Confrontos diretos" a partir de uma lista de jogos (de um ou
   *  vários perfis). Cada adversário é identificado pelo jogador do perfil
   *  dele (se tiver) ou pelo nome do lugar. `exclude` = nomes a ignorar
   *  (ex: o próprio jogador, quando junta vários decks seus). */
  function headToHeadHtml(games, sub, selfLabel, exclude) {
    const skip = new Set((exclude || []).map((x) => x.trim().toLowerCase()));
    const h2h = new Map();
    games.forEach((g) => {
      (g.opponents || []).forEach((o) => {
        const op = o.profileId ? Profiles.get(o.profileId) : null;
        const label = (op && (op.playerName || op.name)) || o.name;
        if (!label) return;
        const key = label.trim().toLowerCase();
        if (skip.has(key)) return;
        if (!h2h.has(key)) h2h.set(key, { label, games: 0, a: 0, b: 0 });
        const r = h2h.get(key);
        r.games++;
        if (g.won) r.a++;
        else if (o.won) r.b++;
      });
    });
    const rows = Array.from(h2h.values()).sort((x, y) => y.games - x.games).slice(0, 8);
    if (!rows.length) return "";
    return `
      <div class="chart-card">
        <div class="chart-title">${tr("Confrontos diretos")}</div>
        <div class="chart-sub">${sub}</div>
        ${Charts.stackedBars(rows.map((r) => ({ label: tr("vs {name}", { name: r.label }), a: r.a, b: r.b, valueLabel: `${r.a} – ${r.b}` })), [selfLabel, tr("Adversário ganhou")])}
      </div>`;
  }

  /** Agrupa os perfis (decks) pelo jogador (campo "Jogador" do perfil). */
  function playersFromProfiles(profiles) {
    const map = new Map();
    profiles.forEach((p) => {
      const name = (p.playerName || "").trim();
      if (!name) return;
      const key = name.toLowerCase();
      if (!map.has(key)) map.set(key, { key, name, profiles: [] });
      map.get(key).profiles.push(p);
    });
    return Array.from(map.values()).map((pl) => {
      const games = pl.profiles.reduce((a, p) => a + p.stats.games, 0);
      const wins = pl.profiles.reduce((a, p) => a + p.stats.wins, 0);
      const history = pl.profiles.reduce((acc, p) => acc.concat((p.history || []).map((g) => Object.assign({ deck: p.name, deckId: p.id }, g))), []).sort((a, b) => a.date - b.date);
      return Object.assign(pl, { games, wins, winRate: games ? wins / games : 0, history });
    });
  }

  function initialsAvatar(name, i) {
    const pal = State.FALLBACK_PALETTE;
    return `<span class="player-avatar" style="background:${pal[i % pal.length][0]}">${esc(name.trim().slice(0, 2).toUpperCase())}</span>`;
  }

  function kpiHtml(label, value, sub) {
    return `<div class="kpi"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${esc(value)}</div>${sub ? `<div class="kpi-sub">${esc(sub)}</div>` : ""}</div>`;
  }

  /** Editar um perfil: nome, jogador, commander (e arte) e cor quando não
   *  há arte. As estatísticas e o histórico ficam iguais. */
  function openEditProfileModal(profileId) {
    const profile = Profiles.get(profileId);
    if (!profile) return;
    let pendingCommander = profile.commander || null;
    let pendingColor = typeof profile.colorIdx === "number" ? profile.colorIdx : null;
    closeAnyModal();
    const backdrop = el(`
      <div class="modal-backdrop">
        <div class="modal-sheet">
          <h2>${tr("Editar perfil")}</h2>
          <div class="ep-commander">
            <div class="commander-thumb" id="epf-thumb"></div>
            <div class="col gap-sm" style="flex:1;min-width:0">
              <div class="profile-name" id="epf-cmd-name"></div>
              <div class="row" style="gap:6px;flex-wrap:wrap">
                <button class="btn btn-ghost btn-sm" id="epf-change">${tr("Trocar commander")}</button>
                <button class="btn btn-ghost btn-sm" id="epf-art">${tr("Outra arte")}</button>
              </div>
            </div>
          </div>
          <div class="col" style="margin-top:12px">
            <label for="epf-name">${tr("Nome do perfil")}</label>
            <input type="text" id="epf-name" value="${esc(profile.name)}">
            <label for="epf-player">${tr("Jogador")}</label>
            <input type="text" id="epf-player" value="${esc(profile.playerName || "")}" placeholder="${tr("Nome de quem joga com este deck")}">
            <div id="epf-colors-wrap">
              <label>${tr("Cor quando não há arte")}</label>
              <div class="seat-colors" id="epf-colors" style="margin-top:8px">${State.FALLBACK_PALETTE.map((c, k) => `
                <button type="button" class="color-dot" data-color="${k}" aria-label="${tr("Cor {n}", { n: k + 1 })}" style="background:${c[0]}"></button>`).join("")}</div>
            </div>
          </div>
          <div class="row" style="margin-top:16px">
            <button class="btn btn-ghost grow" id="epf-cancel">${tr("Cancelar")}</button>
            <button class="btn btn-primary grow" id="epf-save">${tr("Guardar")}</button>
          </div>
        </div>
      </div>
    `);
    document.body.appendChild(backdrop);
    function paint() {
      const fake = { commander: pendingCommander, colorIdx: pendingColor };
      const thumb = backdrop.querySelector("#epf-thumb");
      thumb.style.cssText = seatThumbStyle(fake);
      thumb.innerHTML = pendingCommander && pendingCommander.art ? "" : I("card");
      backdrop.querySelector("#epf-cmd-name").textContent = pendingCommander ? pendingCommander.name : tr("Sem commander");
      backdrop.querySelector("#epf-art").classList.toggle("hidden", !(pendingCommander && pendingCommander.printsUri));
      backdrop.querySelector("#epf-colors-wrap").classList.toggle("hidden", !!(pendingCommander && pendingCommander.art));
      backdrop.querySelectorAll("#epf-colors .color-dot").forEach((b) => b.setAttribute("aria-pressed", String(parseInt(b.dataset.color, 10) === pendingColor)));
    }
    paint();
    backdrop.querySelector("#epf-change").addEventListener("click", () => {
      openCommanderPicker((c) => { pendingCommander = c; paint(); });
    });
    backdrop.querySelector("#epf-art").addEventListener("click", () => {
      openVersionPicker(pendingCommander, (c) => { pendingCommander = c; paint(); });
    });
    backdrop.querySelector("#epf-colors").addEventListener("click", (e) => {
      const b = e.target.closest("[data-color]");
      if (!b) return;
      pendingColor = parseInt(b.dataset.color, 10);
      paint();
    });
    backdrop.querySelector("#epf-cancel").addEventListener("click", () => backdrop.remove());
    backdrop.querySelector("#epf-save").addEventListener("click", () => {
      Profiles.update(profileId, {
        name: backdrop.querySelector("#epf-name").value.trim() || profile.name,
        playerName: backdrop.querySelector("#epf-player").value.trim(),
        commander: pendingCommander,
        colorIdx: pendingColor,
      });
      backdrop.remove();
      render();
      toast(tr("Perfil guardado"));
    });
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
  }

  // ===========================================================
  // DETALHE DE UM PERFIL — estatísticas, gráficos e histórico
  // ===========================================================
  function renderProfileDetail() {
    const profile = Profiles.get(screenParams.id);
    if (!profile) { nav("profiles"); return; }
    const d = Profiles.derived(profile);
    const history = Profiles.historyOf(profile.id); // mais recente primeiro
    const chrono = history.slice().reverse();      // mais antigo primeiro
    const s = el(`
      <div class="screen">
        <div class="topbar">
          <button class="btn btn-icon" id="back-btn">${I("arrow-left")}</button>
          <h1>${esc(profile.name)}</h1>
          <button class="btn btn-icon" id="edit-profile-btn" title="${tr("Editar perfil")}" aria-label="${tr("Editar perfil")}">${I("pencil")}</button>
        </div>
        <div class="scroll" id="pd-scroll"></div>
      </div>
    `);
    appEl.appendChild(s);
    const body = s.querySelector("#pd-scroll");

    const head = `
      <div class="pd-head">
        <div class="commander-thumb" style="${seatThumbStyle(profile)}">${profile.commander && profile.commander.art ? "" : I("card")}</div>
        <div class="pd-head-info">
          <div class="profile-sub">${profile.commander ? esc(profile.commander.name) : tr("Sem commander")} ${pipsHtml(colorIdentityOf(profile))}</div>
          ${profile.playerName ? `<div class="profile-sub">${I("user")} ${esc(profile.playerName)}</div>` : ""}
        </div>
      </div>`;

    s.querySelector("#edit-profile-btn").addEventListener("click", () => openEditProfileModal(profile.id));
    if (!d.games) {
      body.innerHTML = head + `<div class="chart-card"><div class="footer-note">${tr("Ainda não há jogos registados para este perfil.")}</div></div>`;
      s.querySelector("#back-btn").addEventListener("click", () => (screenParams.fromPlayer ? nav("player-detail", { key: screenParams.fromPlayer }) : nav("profiles")));
      return;
    }

    const pct = Math.round(d.winRate * 100);
    const kpis = `
      <div class="kpi-row kpi-row-2">
        ${kpiHtml(tr("Jogos"), d.games)}
        <div class="kpi">
          <div class="kpi-label">${tr("Vitórias")}</div>
          <div class="kpi-value">${d.wins} <small>${pct}%</small></div>
          <div class="meter" data-tip="${pct}%" data-tip-label="${esc(tr("{w} de {g} vitórias", { w: d.wins, g: d.games }))}"><div class="meter-fill" style="width:${pct}%"></div></div>
        </div>
        ${kpiHtml(tr("Média por jogo"), formatDuration(d.avgGameTimeMs))}
        ${kpiHtml(tr("Média por turno"), d.turnsTaken ? formatDuration(d.avgTurnTimeMs) : "—")}
      </div>`;

    // sequências: a atual (vitórias ou derrotas seguidas, a contar do jogo
    // mais recente) e a melhor sequência de vitórias de sempre
    let curLen = 0;
    const curWon = history.length ? history[0].won : false;
    for (const g of history) { if (g.won === curWon) curLen++; else break; }
    let best = 0, run = 0;
    chrono.forEach((g) => { run = g.won ? run + 1 : 0; best = Math.max(best, run); });
    const streak = `
      <div class="streak-card">
        <span class="streak-icon ${curWon ? "win" : "loss"}">${I(curWon ? "trophy" : "repeat")}</span>
        <span class="streak-text">
          <span class="kpi-label">${tr("Sequência atual")}</span>
          <span class="streak-value">${curWon
            ? (curLen === 1 ? tr("1 vitória") : tr("{n} vitórias seguidas", { n: curLen }))
            : (curLen === 1 ? tr("1 derrota") : tr("{n} derrotas seguidas", { n: curLen }))}</span>
        </span>
        <span class="streak-best"><span class="kpi-label">${tr("Melhor")}</span><strong>${best}</strong></span>
      </div>`;

    // forma recente: últimos 10 resultados (mais antigo → mais recente)
    const recent = chrono.slice(-10);
    const form = `
      <div class="chart-card">
        <div class="chart-title">${tr("Forma recente")}</div>
        <div class="chart-sub">${tr("Últimos {n} jogos, do mais antigo para o mais recente", { n: recent.length })}</div>
        <div class="form-strip">${recent.map((g) => `
          <span class="form-chip ${g.won ? "win" : "loss"}" data-tip="${g.won ? esc(tr("Vitória")) : esc(tr("Derrota"))}" data-tip-label="${esc(modeLabel(g.mode))} · ${esc(formatDateTime(g.date))}">${g.won ? tr("V") : tr("D")}</span>`).join("")}
        </div>
      </div>`;

    // evolução da taxa de vitórias acumulada (precisa de 2+ jogos)
    let evo = "";
    let evoPoints = null;
    if (chrono.length >= 2) {
      let w = 0;
      evoPoints = chrono.map((g, i) => {
        if (g.won) w++;
        const rate = w / (i + 1);
        return { y: rate, tip: `${Math.round(rate * 100)}%`, tipLabel: `${tr("Jogo {n}", { n: i + 1 })} · ${g.won ? tr("Vitória") : tr("Derrota")} · ${formatDateTime(g.date)}` };
      });
      evo = `
        <div class="chart-card">
          <div class="chart-title">${tr("Evolução da taxa de vitórias")}</div>
          <div class="chart-sub">${tr("Percentagem de vitórias acumulada, jogo a jogo")}</div>
          ${Charts.lineChart(evoPoints, { xLabel: (i) => tr("Jogo {n}", { n: i + 1 }), aria: tr("Evolução da taxa de vitórias") })}
        </div>`;
    }

    // vitórias / derrotas por modo
    const byMode = new Map();
    chrono.forEach((g) => {
      const k = g.mode || "standard";
      if (!byMode.has(k)) byMode.set(k, { label: modeLabel(k), a: 0, b: 0 });
      const m = byMode.get(k);
      if (g.won) m.a++; else m.b++;
    });
    const modes = `
      <div class="chart-card">
        <div class="chart-title">${tr("Resultados por modo")}</div>
        ${Charts.stackedBars(Array.from(byMode.values()).sort((x, y) => (y.a + y.b) - (x.a + x.b)), [tr("Vitórias"), tr("Derrotas")])}
      </div>`;

    // confrontos diretos: só jogos registados com a lista de adversários.
    // Cada adversário identifica-se pelo jogador do perfil dele (se tiver),
    // senão pelo nome do lugar; "a – b" = vitórias deste perfil vs vitórias dele.
    const h2hHtml = headToHeadHtml(chrono, tr("Jogos em que estiveram os dois à mesa: vitórias deste perfil – vitórias do adversário"), tr("Este perfil ganhou"));

    // duração dos últimos jogos com tempo contado
    const timedGames = chrono.filter((g) => g.timed !== false && g.gameTimeMs > 0).slice(-12);
    let durations = "";
    if (timedGames.length >= 2) {
      const first = chrono.indexOf(timedGames[0]) + 1, lastN = chrono.indexOf(timedGames[timedGames.length - 1]) + 1;
      durations = `
        <div class="chart-card">
          <div class="chart-title">${tr("Duração dos jogos")}</div>
          <div class="chart-sub">${tr("Últimos {n} jogos com tempo contado, em minutos", { n: timedGames.length })}</div>
          ${Charts.columns(timedGames.map((g) => ({
            value: g.gameTimeMs / 60000,
            tip: formatDuration(g.gameTimeMs),
            tipLabel: `${g.won ? tr("Vitória") : tr("Derrota")} · ${formatDateTime(g.date)}`,
          })), {
            tickFmt: (v) => `${Math.round(v)}m`,
            xLabel: (i) => i === 0 ? tr("Jogo {n}", { n: first }) : tr("Jogo {n}", { n: lastN }),
            aria: tr("Duração dos jogos"),
          })}
        </div>`;
    }

    const eloAll = MTG.Elo.compute(Profiles.all());
    const eloRec = eloAll.decks.find((r) => r.key === profile.id || (profile.aliases || []).includes(r.key));
    body.innerHTML = head + kpis + eloCardHtml(eloRec, eloAll.decks.length) + streak + form + evo + modes + h2hHtml + durations + `
      <div class="section-title">${tr("Histórico de jogos")}</div>
      <div class="col" id="history-list"></div>
      <button class="btn btn-ghost btn-block merge-entry" id="merge-deck-btn">${I("merge")} ${tr("Fundir com outro deck")}</button>`;
    body.querySelector("#merge-deck-btn").addEventListener("click", () => openMergeDeckSheet(profile.id));

    // histórico (também serve de "vista de tabela" dos gráficos)
    const list = body.querySelector("#history-list");
    history.forEach((g) => {
      const row = el(`
        <div class="cd-list-item" style="align-items:flex-start;">
          <span class="form-chip sm ${g.won ? "win" : "loss"}">${g.won ? tr("V") : tr("D")}</span>
          <div style="flex:1; min-width:0;">
            <div class="nm">${g.won ? tr("Vitória") : tr("Derrota")} — ${esc(modeLabel(g.mode))}</div>
            <div class="commander-name" style="margin-top:3px;">${formatDateTime(g.date)}</div>
            ${g.timed === false ? `<div class="history-meta">${tr("Jogo sem contagem de tempo/turnos")}</div>` : `<div class="history-meta">${tr("Jogo: {game} · Nos teus turnos: {turns} ({n} turno(s))", { game: formatDuration(g.gameTimeMs), turns: formatDuration(g.turnTimeMs), n: g.turnsTaken })}</div>`}
          </div>
          <button class="btn btn-icon" style="flex-shrink:0;" data-gid="${g.id}" title="${tr("Apagar este jogo")}">${I("trash")}</button>
        </div>
      `);
      row.querySelector("button[data-gid]").addEventListener("click", () => {
        const snapshot = JSON.parse(JSON.stringify(g));
        Profiles.removeGame(profile.id, g.id);
        render();
        undoToast(tr("Jogo apagado do histórico"), () => { Profiles.restoreGame(profile.id, snapshot); render(); });
      });
      list.appendChild(row);
    });

    Charts.bindTips(body);
    if (evoPoints) Charts.bindLine(body, evoPoints);
    bindEloCard(body, eloRec);
    s.querySelector("#back-btn").addEventListener("click", () => (screenParams.fromPlayer ? nav("player-detail", { key: screenParams.fromPlayer }) : nav("profiles")));
  }

  // ===========================================================
  // DETALHE DE UM JOGADOR — todos os seus decks juntos
  // ===========================================================
  function renderPlayerDetail() {
    const pl = playersFromProfiles(Profiles.all()).find((x) => x.key === screenParams.key);
    if (!pl) { nav("profiles"); return; }
    const s = el(`
      <div class="screen">
        <div class="topbar">
          <button class="btn btn-icon" id="back-btn">${I("arrow-left")}</button>
          <h1>${esc(pl.name)}</h1>
          <div style="width:40px"></div>
        </div>
        <div class="scroll" id="pl-scroll"></div>
      </div>
    `);
    appEl.appendChild(s);
    const body = s.querySelector("#pl-scroll");
    const pct = Math.round(pl.winRate * 100);
    const recent = pl.history.slice(-10);
    const decks = pl.profiles.map((p) => ({ p, d: Profiles.derived(p) })).sort((a, b) => (b.d.winRate - a.d.winRate) || (b.d.games - a.d.games));
    const plEloAll = MTG.Elo.compute(Profiles.all());
    const normKey = (x) => String(x || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const plElo = plEloAll.players.find((r) => r.key === normKey(pl.name));
    body.innerHTML = `
      <div class="pd-head">
        ${initialsAvatar(pl.name, 0).replace("player-avatar", "player-avatar lg")}
        <div class="pd-head-info"><div class="profile-sub">${tr("{n} deck(s)", { n: pl.profiles.length })}</div></div>
      </div>
      <div class="kpi-row kpi-row-2">
        ${kpiHtml(tr("Jogos"), pl.games)}
        <div class="kpi">
          <div class="kpi-label">${tr("Vitórias")}</div>
          <div class="kpi-value">${pl.wins} <small>${pct}%</small></div>
          <div class="meter"><div class="meter-fill" style="width:${pct}%"></div></div>
        </div>
      </div>
      ${eloCardHtml(plElo, plEloAll.players.length)}
      ${recent.length ? `
      <div class="chart-card">
        <div class="chart-title">${tr("Forma recente")}</div>
        <div class="chart-sub">${tr("Últimos {n} jogos, do mais antigo para o mais recente", { n: recent.length })}</div>
        <div class="form-strip">${recent.map((g) => `
          <span class="form-chip ${g.won ? "win" : "loss"}" data-tip="${g.won ? esc(tr("Vitória")) : esc(tr("Derrota"))}" data-tip-label="${esc(g.deck)} · ${esc(modeLabel(g.mode))} · ${esc(formatDateTime(g.date))}">${g.won ? tr("V") : tr("D")}</span>`).join("")}
        </div>
      </div>` : ""}
      <div class="chart-card">
        <div class="chart-title">${tr("Decks de {name}", { name: esc(pl.name) })}</div>
        <div class="chart-sub">${tr("Taxa de vitórias de cada deck")}</div>
        ${Charts.hbars(decks.map(({ p, d }) => ({
          label: p.name, labelHtml: `${esc(p.name)} ${pipsHtml(colorIdentityOf(p))}`,
          value: d.winRate, valueLabel: `${Math.round(d.winRate * 100)}% · ${tr("{n} jogo(s)", { n: d.games })}`,
          tip: `${Math.round(d.winRate * 100)}%`, tipLabel: `${p.name} · ${tr("{w} de {g} vitórias", { w: d.wins, g: d.games })}`,
          muted: !d.games,
        })))}
      </div>
      ${headToHeadHtml(pl.history, tr("Jogos em que estiveram os dois à mesa, com qualquer deck: vitórias de {name} – vitórias do adversário", { name: esc(pl.name) }), tr("{name} ganhou", { name: esc(pl.name) }), [pl.name])}
      <div class="section-title">${tr("Decks")}</div>
      <div class="col">${decks.map(({ p, d }) => `
        <div class="profile-card" data-id="${p.id}" role="button" tabindex="0">
          <div class="commander-thumb" style="${seatThumbStyle(p)}">${p.commander && p.commander.art ? "" : I("card")}</div>
          <div class="profile-info">
            <div class="profile-name">${esc(p.name)} ${pipsHtml(colorIdentityOf(p))}</div>
            <div class="profile-summary">${d.games ? tr("{g} jogos · {w} vitórias", { g: d.games, w: d.wins }) + ` (${Math.round(d.winRate * 100)}%)` : tr("Ainda sem jogos")}</div>
          </div>
          <span class="profile-chevron">${I("chevron-right")}</span>
        </div>`).join("")}</div>`;
    body.insertAdjacentHTML("beforeend", `<button class="btn btn-ghost btn-block merge-entry" id="merge-player-btn">${I("merge")} ${tr("Fundir com outro jogador")}</button>`);
    body.querySelector("#merge-player-btn").addEventListener("click", () => openMergePlayerSheet(pl.key));
    body.querySelectorAll(".profile-card[data-id]").forEach((c) => c.addEventListener("click", () => nav("profile-detail", { id: c.dataset.id, fromPlayer: pl.key })));
    bindEloCard(body, plElo);
    Charts.bindTips(body);
    s.querySelector("#back-btn").addEventListener("click", () => nav("profiles"));
  }

  // ---------------------------------------------------------
  // Arranque
  // ---------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    render();
    setupServiceWorker();
    // Sincronização na nuvem: atualiza o cartão de estado e, quando chegam
    // mudanças de outro aparelho, redesenha os ecrãs de perfis (nunca o jogo)
    let lastHandled = null;
    Cloud.onStatus((st) => {
      repaintSyncCard();
      const r = st.lastResult;
      if (!st.syncing && r && r !== lastHandled) {
        lastHandled = r;
        const changedHere = r.profiles || r.games || r.removed;
        if (changedHere && ["profiles", "profile-detail", "player-detail", "menu"].includes(screen) && !document.querySelector(".modal-backdrop")) render();
      }
    });
    Cloud.init();
    // Pede ao browser para não apagar os dados desta app quando o
    // aparelho fica com pouco espaço (no iPhone ajuda sobretudo com a
    // app instalada no ecrã principal).
    try {
      if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persisted().then((ok) => ok || navigator.storage.persist()).catch(() => {});
      }
    } catch (e) {}
  });

  // Atualizações: o service worker novo instala-se sozinho; aqui só se
  // procura uma versão nova sempre que a app volta ao ecrã e se avisa com
  // um botão "Atualizar". Assim nunca é preciso apagar o ícone do ecrã
  // principal para atualizar — o que, no iPhone, apaga também os dados.
  function setupServiceWorker() {
    if (!("serviceWorker" in navigator) || !(location.protocol === "https:" || location.hostname === "localhost")) return;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register("./sw.js").then((reg) => {
      const check = () => reg.update().catch(() => {});
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
      setInterval(check, 60 * 60 * 1000);
    }).catch(() => {});
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController) showUpdateBanner(); // na 1.ª instalação não há nada a atualizar
    });
  }

  function showUpdateBanner() {
    if (document.querySelector(".update-banner")) return;
    const b = el(`
      <div class="update-banner" role="status">
        <span class="update-msg">${tr("Nova versão disponível")}</span>
        <button type="button" class="update-btn">${tr("Atualizar")}</button>
      </div>`);
    // os dados ficam todos no aparelho, por isso recarregar não perde nada
    // (nem o jogo em curso, que é guardado a cada alteração)
    b.querySelector(".update-btn").addEventListener("click", () => location.reload());
    document.body.appendChild(b);
  }
})();
