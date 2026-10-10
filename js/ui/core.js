/* ===========================================================
   ui/core.js — Estado da app, utilitários, navegação e render().

   A interface está dividida em vários ficheiros (js/ui/*.js), carregados
   por ordem no index.html. Partilham o mesmo âmbito global: o que um
   declara no topo (funções, const/let) os outros usam diretamente.
   =========================================================== */
const { Scryfall, State, Profiles, Icons, Charts } = window.MTG;
const I = (name, cls) => Icons.svg(name, cls);
const tr = window.MTG.i18n.t;
const appEl = document.getElementById("app");
const toastEl = document.getElementById("toast");
const turnAudioEl = document.getElementById("turn-sound");

let currentScreen = "menu";
let screenParams = {};
let game = null; // estado do jogo atual (espelha o State guardado)
let draft = null; // rascunho usado nos ecrãs de setup
let liveTimer = null; // interval do relógio ao vivo (turno/total) no tabuleiro
let wakeLock = null; // Screen Wake Lock ativo enquanto se está no contador de vida
let boardFullscreen = true; // ecrã inteiro (por defeito): esconde as barras do contador de vida; cada jogo novo começa assim

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
  if (document.visibilityState === "visible" && (currentScreen === "game-standard" || currentScreen === "game-br") && !wakeLock) {
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
  currentScreen = newScreen;
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

/** Menu do ecrã inteiro (botão ≡ do hub): as ações da barra de botões, que
 *  está escondida — carrega no botão escondido correspondente. */
function openBoardMenu(scope) {
  closeAnyModal();
  const items = [
    ["history-btn", "history", tr("Histórico de vida")],
    ["reorder-btn", "reorder", tr("Trocar posições")],
    ["reset-btn", "rotate", tr("Reiniciar jogo")],
    ["end-game-btn", "flag", tr("Terminar jogo")],
    ["fullscreen-exit-btn", "maximize", tr("Mostrar barras")],
    ["menu-btn", "menu", tr("Menu principal")],
  ].filter(([id]) => scope.querySelector("#" + id));
  const backdrop = el(`
    <div class="modal-backdrop center">
      <div class="modal-sheet board-menu">
        ${items.map(([id, icon, label]) => `<button type="button" class="bm-item ${id === "end-game-btn" ? "primary" : ""}" data-target="${id}">${I(icon)}<span>${esc(label)}</span></button>`).join("")}
        <button type="button" class="btn btn-ghost" id="bm-close">${tr("Fechar")}</button>
      </div>
    </div>`);
  document.body.appendChild(backdrop);
  backdrop.querySelectorAll("[data-target]").forEach((b) => b.addEventListener("click", () => {
    backdrop.remove();
    const btn = scope.querySelector("#" + b.dataset.target);
    if (btn) btn.click();
  }));
  backdrop.querySelector("#bm-close").addEventListener("click", () => backdrop.remove());
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
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
        <button class="fs-exit" id="fs-more-btn" title="${tr("Mais opções")}" aria-label="${tr("Mais opções")}">${I("menu")}</button>
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
/** Jogo de 2 (1v1): fica bem ao alto — um painel em cima (virado para o
 *  adversário) e outro em baixo — por isso não se força o modo deitado. */
function isPortraitFriendlyGame() {
  return currentScreen === "game-standard" && game && game.standard && game.standard.players.length === 2;
}

function applyGameOrientation() {
  const inGame = GAME_SCREENS.includes(currentScreen) && !isPortraitFriendlyGame();
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
  // 1v1 ao alto num telemóvel: tabuleiro em coluna (classe própria para o CSS)
  root.classList.toggle("duel-portrait", isPortraitFriendlyGame() && portrait && window.innerWidth < 700);
}
window.addEventListener("resize", applyGameOrientation);
window.addEventListener("orientationchange", () => setTimeout(applyGameOrientation, 150));

function render() {
  stopAllRepeats();
  if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
  if (Charts) Charts.hideTip();
  appEl.innerHTML = "";
  const sameScreen = currentScreen === lastRenderedScreen;
  lastRenderedScreen = currentScreen;
  if (currentScreen === "menu") renderMenu();
  else if (currentScreen === "setup-standard") renderSetupStandard();
  else if (currentScreen === "game-standard") renderGameStandard();
  else if (currentScreen === "setup-br") renderSetupBR();
  else if (currentScreen === "game-br") renderGameBR();
  else if (currentScreen === "setup-teams") renderSetupTeams();
  else if (currentScreen === "game-teams") renderGameTeams();
  else if (currentScreen === "stats-standard") renderStatsStandard();
  else if (currentScreen === "profiles") renderProfilesScreen();
  else if (currentScreen === "profile-detail") renderProfileDetail();
  else if (currentScreen === "player-detail") renderPlayerDetail();
  applyGameOrientation();
  // Re-renders do mesmo ecrã (ex: passar turno) não repetem a animação
  // de entrada — senão o tabuleiro inteiro "pisca" a cada turno.
  if (sameScreen && appEl.firstElementChild) appEl.firstElementChild.classList.add("no-enter");

  if (currentScreen === "game-standard" || currentScreen === "game-br" || currentScreen === "game-teams") requestWakeLock();
  else releaseWakeLock();
}
