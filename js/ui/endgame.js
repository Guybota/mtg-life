/* ===========================================================
   ui/endgame.js — Fim de jogo: vitória, estatísticas, trocar lugares e histórico de vida.

   A interface está dividida em vários ficheiros (js/ui/*.js), carregados
   por ordem no index.html. Partilham o mesmo âmbito global: o que um
   declara no topo (funções, const/let) os outros usam diretamente.
   =========================================================== */
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
