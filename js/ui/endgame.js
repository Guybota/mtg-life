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

let lhView = "table";   // vista escolhida no histórico de vida: "table" | "list"
let lhFilter = null;     // filtro da lista: id do jogador/equipa ou null

/** Histórico ao vivo das alterações de vida do jogo atual (qualquer modo).
 *  Duas vistas:
 *  - Tabela: uma coluna por jogador e uma linha por turno, com a variação
 *    e a vida no fim do turno (como a folha de papel à mesa);
 *  - Lista: cada alteração com a vida antes → depois e a origem (commander
 *    damage, dano a todos, drenar…), filtro por jogador e "Desfazer". */
function openLifeHistoryModal() {
  closeAnyModal();
  const mode = game.mode === "standard" ? "standard" : game.mode === "br" ? "br" : "teams";
  const ms = mode === "standard" ? game.standard : mode === "br" ? game.br : game.teams;
  const timed = !ms || ms.trackTurns !== false;
  const entities = (mode === "teams" ? ms.teams : ms.players) || [];
  const view = timed ? lhView : "list";
  const backdrop = el(`
    <div class="modal-backdrop center">
      <div class="modal-sheet lh-sheet">
        <div class="lh-head">
          <h2>${tr("Histórico de vida")}</h2>
          ${timed ? `<div class="seg lh-seg" role="tablist">
            <button type="button" class="seg-btn" data-view="table" aria-selected="${view === "table"}">${tr("Tabela")}</button>
            <button type="button" class="seg-btn" data-view="list" aria-selected="${view === "list"}">${tr("Lista")}</button>
          </div>` : ""}
          <button type="button" class="btn btn-icon lh-x" id="lh-x" title="${tr("Fechar")}" aria-label="${tr("Fechar")}">${I("x")}</button>
        </div>
        <div class="lh-body" id="lh-body"></div>
        <button class="btn btn-ghost lh-close" id="close-lh-btn">${tr("Fechar")}</button>
      </div>
    </div>`);
  document.body.appendChild(backdrop);
  const body = backdrop.querySelector("#lh-body");
  const close = () => backdrop.remove();
  backdrop.querySelector("#close-lh-btn").addEventListener("click", close);
  backdrop.querySelector("#lh-x").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => {
    lhView = b.dataset.view;
    backdrop.querySelectorAll("[data-view]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    paint();
  }));

  const byId = new Map(entities.map((e) => [e.id, e]));
  const dotStyle = (en) => playerBgStyle(mode === "teams" ? (en.players || [])[0] : en);
  const dot = (id, name) => `<span class="lh-dot" style="${dotStyle(byId.get(id))}" title="${esc(name || "")}"></span>`;

  function paint() {
    const v = timed ? lhView : "list";
    const log = ms.lifeLog || [];
    if (!log.length) { body.innerHTML = `<div class="footer-note">${tr("Ainda não há alterações de vida registadas neste jogo.")}</div>`; return; }
    body.innerHTML = v === "table" ? tableHtml(log) : listHtml(log);
    bind(v);
  }

  // ---------- Tabela: jogador × turno ----------
  function tableHtml(log) {
    const tl = State.lifeTimeline(ms, entities);
    const n = tl.turns.length;
    const rows = [];
    for (let i = n; i >= 1; i--) {
      const deltas = tl.series.map((s) => s.values[i] - s.values[i - 1]);
      if (i < n && deltas.every((d) => !d)) continue; // turnos sem mudanças não ocupam espaço (o atual fica sempre)
      const t = tl.turns[i - 1];
      rows.push(`
        <tr${i === n ? ' class="lh-now"' : ""}>
          <th scope="row"><span class="lh-turn-cell">${t.round ? `<b>R${t.round}</b>` : ""}<span>${esc(t.name || "")}</span>${i === n ? `<small>${tr("agora")}</small>` : ""}</span></th>
          ${tl.series.map((s, k) => {
            const d = deltas[k];
            return `<td data-col="${esc(s.id)}" class="${d > 0 ? "plus" : d < 0 ? "minus" : "zero"}">${d ? `<span class="lh-d">${d > 0 ? "+" : "−"}${Math.abs(d)}</span><span class="lh-l">${s.values[i]}</span>` : `<span class="lh-l dim">${s.values[i]}</span>`}</td>`;
          }).join("")}
        </tr>`);
    }
    return `
      <div class="lh-table-wrap">
        <table class="lh-table">
          <thead><tr><th scope="col"><span class="lh-corner">${tr("Turno")}</span></th>${entities.map((en) => `
            <th scope="col" data-col="${esc(en.id)}"><span class="lh-col-head">${dot(en.id, en.name)}<span class="lh-col-name">${esc(en.name)}</span><span class="lh-col-life ${en.eliminated ? "out" : ""}">${en.life}</span></span></th>`).join("")}</tr></thead>
          <tbody>${rows.join("")}
            <tr class="lh-start"><th scope="row"><span class="lh-turn-cell"><span>${tr("Início")}</span></span></th>${tl.series.map((s) => `<td><span class="lh-l dim">${s.values[0]}</span></td>`).join("")}</tr>
          </tbody>
        </table>
      </div>
      <div class="mg-hint lh-hint">${tr("Toca num jogador para ver as alterações dele.")}</div>`;
  }

  // ---------- Lista: cada alteração ----------
  // toques seguidos no mesmo alvo e com a mesma origem (menos de 2 s) juntam-se
  function bursts(log) {
    const out = [];
    log.forEach((e) => {
      const last = out[out.length - 1];
      const key = e.source ? e.source.kind + ":" + (e.source.fromId || "") : "";
      if (last && last.targetId === e.targetId && last.key === key && last.turnSeq === e.turnSeq && e.ts - last.lastTs <= 2000) {
        last.delta += e.delta; last.lastTs = e.ts; last.ids.push(e.id); last.lifeAfter = e.lifeAfter;
      } else {
        out.push({ targetId: e.targetId, targetName: e.targetName, delta: e.delta, ts: e.ts, lastTs: e.ts, ids: [e.id], key, source: e.source, turnSeq: e.turnSeq, roundNumber: e.roundNumber, turnName: e.turnName, lifeAfter: e.lifeAfter });
      }
    });
    // vida depois de cada alteração: a guardada, ou contada para trás a partir da atual
    const running = new Map(entities.map((en) => [en.id, en.life]));
    for (let i = out.length - 1; i >= 0; i--) {
      const b = out[i];
      const cur = running.has(b.targetId) ? running.get(b.targetId) : null;
      if (typeof b.lifeAfter !== "number") b.lifeAfter = cur;
      if (typeof b.lifeAfter === "number") running.set(b.targetId, b.lifeAfter - b.delta);
    }
    return out.filter((b) => b.delta !== 0);
  }
  function sourceText(src) {
    if (!src) return "";
    if (src.kind === "cmd") return `${I("swords")}${esc(tr("Commander damage de {name}", { name: src.fromName || "?" }))}${src.partner ? " (" + esc(tr("parceiro")) + ")" : ""}`;
    if (src.kind === "group") return `${I("zap")}${esc(tr("Dano a todos ({name})", { name: src.fromName || "?" }))}`;
    if (src.kind === "drain") return `${I("droplet")}${esc(tr("Drenar ({name})", { name: src.fromName || "?" }))}`;
    if (src.kind === "zone") return `${I("target")}${esc(tr("Zona fechada"))}`;
    if (src.kind === "event") return `${I("dice")}${esc(src.fromName || tr("Evento"))}`;
    return "";
  }
  let listBursts = [];
  function listHtml(log) {
    listBursts = bursts(log);
    const undoable = new Set(listBursts.slice(-5).map((b) => b)); // as 5 mais recentes
    const shown = listBursts.map((b, i) => ({ b, i })).filter(({ b }) => !lhFilter || b.targetId === lhFilter).reverse();
    let lastTurn = null;
    const rows = shown.map(({ b, i }) => {
      const head = timed && b.turnSeq !== lastTurn ? `<div class="lh-turn">${tr("Ronda {n}", { n: b.roundNumber })} · ${tr("Turno de {name}", { name: esc(b.turnName) })}</div>` : "";
      lastTurn = b.turnSeq;
      const en = byId.get(b.targetId);
      const canUndo = undoable.has(b) && !(mode === "br" && en && en.eliminated);
      const before = typeof b.lifeAfter === "number" ? b.lifeAfter - b.delta : null;
      return `${head}
        <div class="lh-row ${b.delta > 0 ? "plus" : "minus"}">
          ${dot(b.targetId, b.targetName)}
          <div class="lh-row-main">
            <div class="lh-row-top"><span class="lh-row-name">${esc(b.targetName)}</span>${before != null ? `<span class="lh-row-life">${before} → <b>${b.lifeAfter}</b></span>` : ""}</div>
            ${b.source ? `<div class="lh-row-src">${sourceText(b.source)}</div>` : ""}
          </div>
          <span class="lh-row-delta">${b.delta > 0 ? "+" : "−"}${Math.abs(b.delta)}</span>
          ${canUndo ? `<button type="button" class="btn btn-icon lh-undo" data-undo="${i}" title="${tr("Desfazer")}" aria-label="${tr("Desfazer")}">${I("undo")}</button>` : `<span class="lh-undo-space"></span>`}
        </div>`;
    }).join("");
    return `
      <div class="lh-filters" role="group" aria-label="${tr("Filtrar por jogador")}">
        <button type="button" class="sort-chip" data-filter="" aria-pressed="${!lhFilter}">${tr("Todos")}</button>
        ${entities.map((en) => `<button type="button" class="sort-chip lh-chip" data-filter="${esc(en.id)}" aria-pressed="${lhFilter === en.id}">${dot(en.id, en.name)}${esc(en.name)}</button>`).join("")}
      </div>
      <div class="lh-list">${rows || `<div class="footer-note">${tr("Sem alterações para este jogador.")}</div>`}</div>`;
  }

  function bind(v) {
    if (v === "table") {
      body.querySelectorAll("[data-col]").forEach((c) => c.addEventListener("click", () => {
        lhFilter = c.dataset.col; lhView = "list";
        backdrop.querySelectorAll("[data-view]").forEach((x) => x.setAttribute("aria-selected", String(x.dataset.view === "list")));
        paint();
      }));
      return;
    }
    body.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => { lhFilter = b.dataset.filter || null; paint(); }));
    body.querySelectorAll("[data-undo]").forEach((b) => b.addEventListener("click", () => {
      const burst = listBursts[+b.dataset.undo];
      if (!burst) return;
      State.undoLifeChanges(game, mode, burst.ids);
      render();               // o tabuleiro atualiza por baixo
      document.body.appendChild(backdrop); // render() pode ter fechado janelas abertas
      paint();
      toast(tr("Alteração desfeita"));
    }));
  }

  if (lhFilter && !byId.has(lhFilter)) lhFilter = null;
  paint();
}
