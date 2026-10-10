/* ===========================================================
   badges.js — emblemas das ligas da classificação ELO (SVG).

   Cada liga tem um escudo metálico com a sua cor e símbolo; à medida
   que se sobe, o escudo ganha asas (Ouro e acima) e uma gema no topo
   (Diamante). A divisão (III, II, I) aparece como 1 a 3 divisas por
   baixo do símbolo. "Em calibração" é um escudo tracejado com "?".
   =========================================================== */
(function (global) {
  const STYLE = {
    bronze:   { a: "#f1b98c", b: "#b0683c", edge: "#6b3818", ink: "#5a2d12" },
    silver:   { a: "#f3f6f9", b: "#a7b2bf", edge: "#5a6675", ink: "#3f4a57" },
    gold:     { a: "#ffe7a0", b: "#e2a72a", edge: "#865506", ink: "#6e4504" },
    platinum: { a: "#c8f3ec", b: "#45a99b", edge: "#175f56", ink: "#0f4a42" },
    diamond:  { a: "#dbe4ff", b: "#6f84ec", edge: "#2a3b98", ink: "#1f2c78" },
    provisional: { a: "#eeeae4", b: "#cfc7bb", edge: "#8d857a", ink: "#6c655c" },
  };
  const SHIELD = "M32 4 L56 12.5 V33 C56 50 45.5 61 32 67 C18.5 61 8 50 8 33 V12.5 Z";
  const INNER = "M32 9.5 L51 16.3 V33.2 C51 47 42.6 56 32 61.2 C21.4 56 13 47 13 33.2 V16.3 Z";

  const EMBLEM = {
    bronze: '<circle cx="32" cy="30" r="8.5"/><circle cx="32" cy="30" r="4" fill="none"/>',
    silver: '<path d="M32 19.5 L35 26.6 L42.7 27.3 L36.9 32.4 L38.6 40 L32 36 L25.4 40 L27.1 32.4 L21.3 27.3 L29 26.6 Z"/>',
    gold: '<path d="M21.5 37 L19.5 23.5 L26.2 28.8 L32 20 L37.8 28.8 L44.5 23.5 L42.5 37 Z"/><path d="M22 40.5 H42" fill="none"/>',
    platinum: '<path d="M32 19.5 L41 24.7 V35.3 L32 40.5 L23 35.3 V24.7 Z"/><path d="M32 19.5 V40.5 M23 24.7 L41 35.3 M41 24.7 L23 35.3" fill="none" opacity=".55"/>',
    diamond: '<path d="M24 25 L28.5 20 H35.5 L40 25 L32 40.5 Z"/><path d="M24 25 H40 M28.5 20 L32 25 L35.5 20 M32 25 V40.5" fill="none" opacity=".6"/>',
  };
  // divisas (chevrons) por baixo do símbolo: 1 para III, 2 para II, 3 para I
  function chevrons(count, ink) {
    let out = "";
    for (let i = 0; i < count; i++) {
      const y = 45 + i * 4.6;
      out += `<path d="M25.5 ${y} L32 ${y + 3.4} L38.5 ${y}" fill="none" stroke="${ink}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    return out;
  }
  // asas de penas por trás do escudo (desenhadas à esquerda e espelhadas)
  function wings(st, big) {
    const feathers = big
      ? ["M12 14 C4 13 0.5 18 0.8 24 C4 22.5 7.5 22.5 11 23 Z",
         "M11 21 C4.5 21 1.5 26 2.4 31.5 C5.5 29.8 8.5 29.6 11 30.2 Z",
         "M11 28.5 C6 29 4 33.5 5.2 38.5 C7.6 36.6 9.6 36.2 11.5 36.4 Z"]
      : ["M12 16 C6 15.5 3 19.5 3.2 24.5 C6 23 8.6 23 11 23.4 Z",
         "M11 22.5 C6.2 22.8 4.2 27 5 31.5 C7.4 30 9.2 29.8 11 30.2 Z"];
    const side = feathers.map((d) => `<path d="${d}" fill="url(#WG)" stroke="EDGE" stroke-width="1.4" stroke-linejoin="round"/>`).join("");
    return { left: side, right: `<g transform="translate(64 0) scale(-1 1)">${side}</g>`, edge: st.edge };
  }

  let uid = 0;
  /** league: bronze|silver|gold|platinum|diamond|provisional; division: 3|2|1 */
  function svg(league, division, size, title) {
    const st = STYLE[league] || STYLE.provisional;
    const id = "bdg" + (++uid);
    const px = size || 36;
    const prov = league === "provisional";
    const rank = ["bronze", "silver", "gold", "platinum", "diamond"].indexOf(league);
    const count = division ? 4 - division : 0;
    return `<svg class="league-badge" viewBox="0 0 64 72" width="${px}" height="${Math.round(px * 72 / 64)}" role="img" aria-label="${title || league}">
      <defs>
        <linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${st.a}"/><stop offset="1" stop-color="${st.b}"/>
        </linearGradient>
        <linearGradient id="${id}s" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${rank >= 2 ? (() => { const w = wings(st, rank >= 3); return (w.left + w.right).replace(/url\(#WG\)/g, `url(#${id}g)`).replace(/EDGE/g, w.edge); })() : ""}
      ${rank === 4 ? `<path d="M32 0.5 L36 5 L32 9.5 L28 5 Z" fill="${st.a}" stroke="${st.edge}" stroke-width="1.4"/>` : ""}
      <path d="${SHIELD}" fill="url(#${id}g)" stroke="${st.edge}" stroke-width="2.4" stroke-linejoin="round" ${prov ? 'stroke-dasharray="4 3"' : ""}/>
      <path d="${INNER}" fill="url(#${id}s)" stroke="#fff" stroke-opacity=".45" stroke-width="1.2"/>
      ${prov
        ? `<text x="32" y="40" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-weight="800" font-size="22" fill="${st.ink}">?</text>`
        : `<g fill="#fff" fill-opacity=".92" stroke="${st.ink}" stroke-width="1.6" stroke-linejoin="round">${EMBLEM[league]}</g>${chevrons(count, st.ink)}`}
    </svg>`;
  }

  global.MTG = global.MTG || {};
  global.MTG.Badges = { svg, STYLE };
})(typeof window !== "undefined" ? window : globalThis);
