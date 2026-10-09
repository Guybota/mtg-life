/* ===========================================================
   charts.js — gráficos simples (HTML/SVG, sem bibliotecas, funcionam
   offline) para o ecrã de perfis. Cores vêm de tokens CSS
   (--chart-accent / --chart-muted / --chart-grid), por isso seguem o
   modo claro/escuro. Cada marca com data-tip mostra um tooltip ao
   passar/tocar/focar; os valores também estão sempre escritos (rótulos
   diretos ou listas), por isso o tooltip nunca é a única via.
   =========================================================== */
(function (global) {
  function esc(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // ---------- tooltip partilhado ----------
  let tipEl = null;
  let hideTimer = null;
  function tip() {
    if (!tipEl) {
      tipEl = document.createElement("div");
      tipEl.className = "chart-tip";
      tipEl.setAttribute("role", "status");
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }
  /** Mostra o tooltip perto de (x, y) — viewport. `lines` = [valor, legenda]. */
  function showTip(x, y, value, label) {
    const t = tip();
    t.innerHTML = "";
    const v = document.createElement("strong");
    v.textContent = value;
    t.appendChild(v);
    if (label) {
      const l = document.createElement("span");
      l.textContent = label;
      t.appendChild(l);
    }
    t.classList.remove("multi");
    t.classList.add("show");
    const r = t.getBoundingClientRect();
    const left = Math.min(window.innerWidth - r.width - 8, Math.max(8, x - r.width / 2));
    const top = y - r.height - 12 < 8 ? y + 16 : y - r.height - 12;
    t.style.left = left + "px";
    t.style.top = top + "px";
    clearTimeout(hideTimer);
  }
  function hideTip(delay) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (tipEl) tipEl.classList.remove("show"); }, delay || 0);
  }

  /** Liga o tooltip a todas as marcas [data-tip] dentro de `root`
   *  (data-tip = valor; data-tip-label = legenda). */
  function bindTips(root) {
    root.querySelectorAll("[data-tip]").forEach((m) => {
      if (!m.hasAttribute("tabindex")) m.setAttribute("tabindex", "0");
      const show = () => {
        const r = m.getBoundingClientRect();
        showTip(r.left + r.width / 2, r.top, m.dataset.tip, m.dataset.tipLabel || "");
        m.classList.add("hover");
      };
      const hide = (d) => { hideTip(d); m.classList.remove("hover"); };
      m.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") show(); });
      m.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hide(); });
      m.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse") { show(); hide(1800); } });
      m.addEventListener("focus", show);
      m.addEventListener("blur", () => hide());
    });
  }

  // ---------- barras horizontais (uma série) ----------
  /** rows: [{ label, value (0..1 da escala), valueLabel, tip, tipLabel, emphasis? }] */
  function hbars(rows) {
    return `<div class="chart-hbars">${rows.map((r) => `
      <div class="hbar-row">
        <div class="hbar-head"><span class="hbar-label">${r.labelHtml || esc(r.label)}</span><span class="hbar-value">${esc(r.valueLabel)}</span></div>
        <div class="hbar-track"><div class="hbar-fill${r.muted ? " muted" : ""}" style="width:${Math.max(r.value > 0 ? 2 : 0, Math.round(r.value * 100))}%" data-tip="${esc(r.tip || r.valueLabel)}" data-tip-label="${esc(r.tipLabel || r.label)}"></div></div>
      </div>`).join("")}</div>`;
  }

  // ---------- barras empilhadas horizontais (2 séries: destaque + cinzento) ----------
  /** rows: [{ label, a, b }] — a = série destaque, b = série secundária.
   *  legend: [nomeA, nomeB]; total à direita. */
  function stackedBars(rows, legend) {
    const max = Math.max(1, ...rows.map((r) => r.a + r.b));
    return `
      <div class="chart-legend">
        <span class="key"><i class="sw accent"></i>${esc(legend[0])}</span>
        <span class="key"><i class="sw muted"></i>${esc(legend[1])}</span>
      </div>
      <div class="chart-hbars">${rows.map((r) => `
        <div class="hbar-row">
          <div class="hbar-head"><span class="hbar-label">${r.labelHtml || esc(r.label)}</span><span class="hbar-value">${esc(r.valueLabel || `${r.a} / ${r.a + r.b}`)}</span></div>
          <div class="hbar-track stack" style="width:${Math.round(((r.a + r.b) / max) * 100)}%">
            ${r.a ? `<div class="hbar-fill" style="flex:${r.a}" data-tip="${r.a}" data-tip-label="${esc(r.label)} · ${esc(legend[0])}"></div>` : ""}
            ${r.b ? `<div class="hbar-fill muted" style="flex:${r.b}" data-tip="${r.b}" data-tip-label="${esc(r.label)} · ${esc(legend[1])}"></div>` : ""}
          </div>
        </div>`).join("")}</div>`;
  }

  // ---------- linha (uma série, eixo y em %) com crosshair ----------
  const W = 340, H = 170, PAD = { l: 34, r: 40, t: 12, b: 24 };
  /** points: [{ y (0..1), tip, tipLabel }]; xLabel(i) para o eixo x. */
  function lineChart(points, opts) {
    const n = points.length;
    const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
    const x = (i) => PAD.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
    const y = (v) => PAD.t + (1 - v) * ih;
    const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ");
    const area = `${path} L${x(n - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
    const grid = [0, 0.5, 1].map((v) => `
      <line class="grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="tick" x="${PAD.l - 6}" y="${y(v) + 3.5}" text-anchor="end">${Math.round(v * 100)}%</text>`).join("");
    const last = points[n - 1];
    const xticks = [0, n - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) =>
      `<text class="tick" x="${x(i)}" y="${H - 6}" text-anchor="${n === 1 ? "middle" : i === 0 ? "start" : "end"}">${esc(opts.xLabel(i))}</text>`).join("");
    return `
      <div class="chart-line" data-n="${n}">
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria || "")}">
          ${grid}${xticks}
          <path class="area" d="${area}"/>
          <path class="line" pathLength="1" d="${path}"/>
          <circle class="dot end" cx="${x(n - 1)}" cy="${y(last.y)}" r="4.5"/>
          <text class="end-label" x="${x(n - 1) + 8}" y="${y(last.y) + 4}">${Math.round(last.y * 100)}%</text>
          <line class="crosshair" x1="0" x2="0" y1="${PAD.t}" y2="${PAD.t + ih}" style="display:none"/>
          <circle class="dot hover-dot" r="4.5" style="display:none"/>
          <rect class="hit" x="${PAD.l - 10}" y="0" width="${iw + 20}" height="${H}"/>
        </svg>
      </div>`;
  }
  /** Liga o crosshair do lineChart (procura o ponto mais próximo em x). */
  function bindLine(root, points) {
    root.querySelectorAll(".chart-line").forEach((wrap) => {
      const svg = wrap.querySelector("svg");
      const hit = svg.querySelector(".hit");
      const cross = svg.querySelector(".crosshair");
      const dot = svg.querySelector(".hover-dot");
      const n = points.length;
      const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
      const x = (i) => PAD.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
      const y = (v) => PAD.t + (1 - v) * ih;
      function at(clientX) {
        const r = svg.getBoundingClientRect();
        const sx = ((clientX - r.left) / r.width) * W;
        let best = 0;
        for (let i = 1; i < n; i++) if (Math.abs(x(i) - sx) < Math.abs(x(best) - sx)) best = i;
        cross.setAttribute("x1", x(best)); cross.setAttribute("x2", x(best));
        dot.setAttribute("cx", x(best)); dot.setAttribute("cy", y(points[best].y));
        cross.style.display = ""; dot.style.display = "";
        const px = r.left + (x(best) / W) * r.width;
        const py = r.top + (y(points[best].y) / H) * r.height;
        showTip(px, py, points[best].tip, points[best].tipLabel);
      }
      function out() { cross.style.display = "none"; dot.style.display = "none"; hideTip(); }
      hit.addEventListener("pointermove", (e) => at(e.clientX));
      hit.addEventListener("pointerdown", (e) => at(e.clientX));
      hit.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") out(); else hideTip(1800); });
    });
  }

  // ---------- várias linhas (vida de cada jogador ao longo dos turnos) ----------
  // Cor = posição do jogador (--series-1..8, ordem fixa, validada para
  // daltonismo). A identidade nunca é só cor: há sempre legenda (com o
  // valor final), rótulos no fim das linhas até 4 jogadores, tooltip com
  // todos os valores e uma tabela.
  const ML = { W: 340, H: 200, l: 30, r: 46, t: 12, b: 24 };
  function niceStep(span) {
    const raw = span / 4;
    const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw))));
    return [1, 2, 5, 10].map((m) => m * p).find((x) => x >= raw) || raw;
  }
  /** Escala comum ao desenho e ao crosshair. O eixo começa perto do valor
   *  mais baixo (para se verem as diferenças), mas inclui o 0 quando
   *  alguém se aproxima dele — é a linha que importa num jogo. */
  function mlScale(series) {
    const n = series[0].values.length;
    const all = series.flatMap((s) => s.values);
    const min = Math.min(...all), max = Math.max(...all);
    const step = niceStep(Math.max(4, max - min));
    let lo = Math.floor(min / step) * step;
    if (lo > 0 && lo <= step) lo = 0;
    const hi = Math.max(lo + step, Math.ceil(max / step) * step);
    const iw = ML.W - ML.l - ML.r, ih = ML.H - ML.t - ML.b;
    const x = (i) => ML.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
    const y = (v) => ML.t + (1 - (v - lo) / (hi - lo)) * ih;
    return { n, lo, hi, step, iw, ih, x, y };
  }
  /** series: [{ name, values:[...] }] (mesmo comprimento); opts.xLabel(i), opts.aria. */
  function multiLine(series, opts) {
    const { n, lo, hi, step, iw, ih, x, y } = mlScale(series);
    let grid = "";
    for (let v = lo; v <= hi + 1e-9; v += step) {
      grid += `<line class="grid${v === 0 ? " zero" : ""}" x1="${ML.l}" x2="${ML.W - ML.r}" y1="${y(v)}" y2="${y(v)}"/>
        <text class="tick" x="${ML.l - 6}" y="${y(v) + 3.5}" text-anchor="end">${v}</text>`;
    }
    const xt = [0, n - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) =>
      `<text class="tick" x="${x(i)}" y="${ML.H - 6}" text-anchor="${n === 1 ? "middle" : i === 0 ? "start" : "end"}">${esc(opts.xLabel(i))}</text>`).join("");
    const lines = series.map((s, k) => {
      const d = s.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
      return `<g class="ml-series" data-k="${k}" style="--c: var(--series-${(k % 8) + 1})">
          <path class="ml-line" pathLength="1" d="${d}"/>
          <circle class="ml-end" cx="${x(n - 1)}" cy="${y(s.values[n - 1])}" r="4"/>
        </g>`;
    }).join("");
    // rótulos no fim das linhas (só até 4 séries), afastados para não se sobreporem
    let ends = "";
    if (series.length <= 4) {
      const lab = series.map((s, k) => ({ k, y: y(s.values[n - 1]) + 4, v: s.values[n - 1] })).sort((a, b) => a.y - b.y);
      // se dois rótulos ficariam em cima um do outro, não se põe nenhum:
      // a legenda já mostra o valor final de cada um
      const clash = lab.some((l, i) => i && l.y - lab[i - 1].y < 12);
      if (!clash) ends = lab.map((l) => `<text class="ml-end-label" data-k="${l.k}" x="${x(n - 1) + 8}" y="${l.y}">${l.v}</text>`).join("");
    }
    const legend = series.map((s, k) => `
      <button type="button" class="ml-key" data-k="${k}" aria-pressed="false" style="--c: var(--series-${(k % 8) + 1})">
        <span class="ml-swatch"></span><span class="ml-name">${esc(s.name)}</span><b>${s.values[n - 1]}</b>
      </button>`).join("");
    return `
      <div class="chart-multiline" data-n="${n}">
        <div class="ml-legend">${legend}</div>
        <svg viewBox="0 0 ${ML.W} ${ML.H}" role="img" aria-label="${esc(opts.aria || "")}">
          ${grid}${xt}${lines}${ends}
          <line class="crosshair" x1="0" x2="0" y1="${ML.t}" y2="${ML.t + ih}" style="display:none"/>
          <g class="ml-hover"></g>
          <rect class="hit" x="${ML.l - 10}" y="0" width="${iw + 20}" height="${ML.H}"/>
        </svg>
      </div>`;
  }
  /** Liga o crosshair (mostra a vida de todos nesse turno) e a legenda
   *  (tocar num jogador destaca a linha dele). opts.tipTitle(i). */
  function bindMultiLine(root, series, opts) {
    root.querySelectorAll(".chart-multiline").forEach((wrap) => {
      const svg = wrap.querySelector("svg");
      const { n, iw, x, y } = mlScale(series);
      const cross = svg.querySelector(".crosshair");
      const hov = svg.querySelector(".ml-hover");
      let focus = null;
      function at(clientX) {
        const r = svg.getBoundingClientRect();
        const sx = ((clientX - r.left) / r.width) * ML.W;
        const i = Math.max(0, Math.min(n - 1, Math.round(((sx - ML.l) / iw) * (n - 1))));
        cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.style.display = "";
        hov.innerHTML = series.map((s, k) => (focus == null || focus === k)
          ? `<circle class="ml-dot" cx="${x(i)}" cy="${y(s.values[i])}" r="4.5" style="--c: var(--series-${(k % 8) + 1})"/>` : "").join("");
        const t = tip();
        t.innerHTML = "";
        const head = document.createElement("span");
        head.className = "ml-tip-title";
        head.textContent = opts.tipTitle(i);
        t.appendChild(head);
        series.map((s, k) => ({ s, k })).sort((a, b) => b.s.values[i] - a.s.values[i]).forEach(({ s, k }) => {
          if (focus != null && focus !== k) return;
          const row = document.createElement("span");
          row.className = "ml-tip-row";
          row.innerHTML = `<i style="background: var(--series-${(k % 8) + 1})"></i>${esc(s.name)}<b>${s.values[i]}</b>`;
          t.appendChild(row);
        });
        t.classList.add("show", "multi");
        const tr = t.getBoundingClientRect();
        const px = r.left + (x(i) / ML.W) * r.width;
        t.style.left = Math.min(window.innerWidth - tr.width - 8, Math.max(8, px - tr.width / 2)) + "px";
        // por cima do gráfico; se não couber no ecrã, por baixo
        const above = r.top - tr.height - 8;
        t.style.top = (above >= 8 ? above : r.bottom + 8) + "px";
        clearTimeout(hideTimer);
      }
      function out() { cross.style.display = "none"; hov.innerHTML = ""; hideTip(); }
      const hit = svg.querySelector(".hit");
      hit.addEventListener("pointermove", (e) => at(e.clientX));
      hit.addEventListener("pointerdown", (e) => at(e.clientX));
      hit.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") out(); else hideTip(2200); });
      wrap.querySelectorAll(".ml-key").forEach((b) => b.addEventListener("click", () => {
        const k = +b.dataset.k;
        focus = focus === k ? null : k;
        wrap.classList.toggle("has-focus", focus != null);
        wrap.querySelectorAll("[data-k]").forEach((el) => el.classList.toggle("on", focus != null && +el.dataset.k === focus));
        wrap.querySelectorAll(".ml-key").forEach((el) => el.setAttribute("aria-pressed", String(+el.dataset.k === focus)));
        out();
      }));
    });
  }

  // ---------- colunas (uma série) ----------
  /** cols: [{ value, tip, tipLabel }]; tickFmt(v) para o eixo y; xLabel(i). */
  function columns(cols, opts) {
    const n = cols.length;
    const iw = W - PAD.l - 12, ih = H - PAD.t - PAD.b;
    const max = niceMax(Math.max(1, ...cols.map((c) => c.value)));
    const band = iw / n;
    const bw = Math.min(24, band * 0.6);
    const y = (v) => PAD.t + (1 - v / max) * ih;
    const grid = [0, max / 2, max].map((v) => `
      <line class="grid" x1="${PAD.l}" x2="${W - 12}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="tick" x="${PAD.l - 6}" y="${y(v) + 3.5}" text-anchor="end">${esc(opts.tickFmt(v))}</text>`).join("");
    const bars = cols.map((c, i) => {
      const cx = PAD.l + band * i + band / 2;
      const top = y(c.value), h = Math.max(0, y(0) - top);
      const r = Math.min(4, h, bw / 2);
      // canto arredondado só no topo (lado dos dados), quadrado na base
      const d = h <= 0 ? "" : `M${cx - bw / 2},${y(0)} V${top + r} Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top} H${cx + bw / 2 - r} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r} V${y(0)} Z`;
      return `<g class="col" data-tip="${esc(c.tip)}" data-tip-label="${esc(c.tipLabel)}">
        <rect class="col-hit" x="${cx - band / 2}" y="${PAD.t}" width="${band}" height="${ih}"/>
        ${d ? `<path class="col-bar" d="${d}"/>` : ""}
      </g>`;
    }).join("");
    const xticks = [0, n - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) =>
      `<text class="tick" x="${PAD.l + band * i + band / 2}" y="${H - 6}" text-anchor="middle">${esc(opts.xLabel(i))}</text>`).join("");
    return `<div class="chart-cols"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria || "")}">${grid}${bars}${xticks}</svg></div>`;
  }
  function niceMax(v) {
    const steps = [1, 2, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240];
    for (const s of steps) if (v <= s) return s;
    return Math.ceil(v / 60) * 60;
  }

  global.MTG = global.MTG || {};
  global.MTG.Charts = { hbars, stackedBars, lineChart, bindLine, multiLine, bindMultiLine, columns, bindTips, hideTip };
})(window);
