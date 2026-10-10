/* ===========================================================
   ui/profiles-ui.js — Ecrãs de perfis: lista, classificação ELO, detalhe de deck e de jogador.

   A interface está dividida em vários ficheiros (js/ui/*.js), carregados
   por ordem no index.html. Partilham o mesmo âmbito global: o que um
   declara no topo (funções, const/let) os outros usam diretamente.
   =========================================================== */
let profileTab = "decks";     // separador do ecrã de perfis: "decks" | "players"
let profileSort = "recent";   // ordenação escolhida no ecrã de perfis
let profileSearch = "";        // texto da pesquisa (mantém-se ao voltar)
function renderProfilesScreen() {
  const profiles = Profiles.all();
  const s = el(`
    <div class="screen profiles-screen">
      <div class="topbar">
        <button class="btn btn-icon" id="back-btn">${I("arrow-left")}</button>
        <h1>${tr("Perfis")}</h1>
        <div style="width:40px"></div>
      </div>
      <div class="scroll">
        <div class="pf-layout">
        <aside class="pf-side">
        ${syncCardHtml()}
        <div class="pf-actions">
          <button class="btn btn-ghost" id="export-profiles-btn">${I("download")}<span>${tr("Exportar")}</span></button>
          <button class="btn btn-ghost" id="import-profiles-btn">${I("upload")}<span>${tr("Importar")}</span></button>
          <button class="btn btn-ghost" id="merge-btn" title="${tr("Juntar com outro telemóvel")}" aria-label="${tr("Juntar com outro telemóvel")}">${I("merge")}<span>${tr("Juntar")}</span></button>
          <input type="file" id="import-profiles-input" accept="application/json,.json" style="display:none">
        </div>
        <div class="backup-note ${Cloud.status().code ? "hidden" : ""}">${backupInfo().at ? tr("Última cópia de segurança: {when}", { when: relativeDay(backupInfo().at) }) : tr("Os perfis ficam só neste aparelho. Exporta uma cópia de vez em quando.")}</div>
        </aside>
        <div class="pf-main">
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
        <div class="pf-grid" id="profiles-list"></div>
        </div>
        </div>
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
  const topDecks = topDeckByPlayer(players);
  playersView.innerHTML = (players.length ? `
    <div class="chart-card">
      <div class="chart-title">${tr("Taxa de vitórias por jogador")}</div>
      ${Charts.hbars(players.filter((pl) => pl.games).map((pl) => ({
        label: pl.name, value: pl.winRate,
        valueLabel: `${Math.round(pl.winRate * 100)}% · ${tr("{n} jogo(s)", { n: pl.games })}`,
        tip: `${Math.round(pl.winRate * 100)}%`, tipLabel: `${pl.name} · ${tr("{w} de {g} vitórias", { w: pl.wins, g: pl.games })}`,
      })).sort((a, b) => b.value - a.value))}
    </div>
    <div class="pf-grid">${players.map((pl, i) => `
      <div class="profile-card player-card" data-player="${esc(pl.key)}" role="button" tabindex="0">
        ${initialsAvatar(pl.name, i, topDecks.get(pl.key))}
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
const ROMAN = ["", "I", "II", "III"];
/** "Ouro II" (ou "Em calibração") */
function leagueName(league, division) {
  const base = TIER_LABEL[league] ? TIER_LABEL[league]() : league;
  return division ? base + " " + ROMAN[division] : base;
}
/** divisão seguinte à de um registo: "Ouro I", "Platina III", … (null no topo) */
function nextLeagueName(rec) {
  if (rec.league === "provisional" || rec.next == null) return null;
  if (rec.division > 1) return leagueName(rec.league, rec.division - 1);
  const order = MTG.Elo.LEAGUE_ORDER;
  const nxt = order[order.indexOf(rec.league) + 1];
  return nxt ? leagueName(nxt, 3) : null;
}
const leagueBadge = (rec, size) => MTG.Badges.svg(rec.league, rec.division, size, leagueName(rec.league, rec.division));
/** tabela de todas as ligas e divisões, com os pontos mínimos */
function leagueLegendHtml() {
  const D = MTG.Elo.DIVISIONS;
  return `<div class="league-legend">${MTG.Elo.LEAGUE_ORDER.slice().reverse().map((l) => `
    <div class="ll-row">
      <span class="ll-name">${leagueName(l)}</span>
      ${[3, 2, 1].map((d) => `<span class="ll-div">${MTG.Badges.svg(l, d, 28, leagueName(l, d))}<small>${ROMAN[d]}<br>${isFinite(D[l][3 - d]) ? D[l][3 - d] + "+" : "&lt;" + D[l][1]}</small></span>`).join("")}
    </div>`).join("")}</div>`;
}
const deltaHtml = (d) => (d ? `<small class="elo-delta ${d > 0 ? "up" : "down"}">${d > 0 ? "+" : "−"}${Math.abs(d)}</small>` : "");
/** chave do ecrã de detalhe do jogador (igual à usada em playersFromProfiles) */
function playerDetailKey(name) { return String(name || "").trim().toLowerCase(); }

/** ecrã largo (iPad deitado / computador): perfis em duas colunas */
const wideLayout = () => window.matchMedia("(min-width: 1000px)").matches;
function renderRankingView(view) {
  if (!view) return;
  const data = MTG.Elo.compute(Profiles.all());
  const list = rankKind === "players" ? data.players : data.decks;
  const profilesById = new Map(Profiles.all().map((p) => [p.id, p]));
  const topDecks = rankKind === "players" ? topDeckByPlayer() : new Map();
  const rows = list.map((r) => {
    const prof = rankKind === "decks" ? profilesById.get(r.key) : null;
    const avatar = rankKind === "players"
      ? initialsAvatar(r.name, r.rank - 1, topDecks.get(playerDetailKey(r.name))).replace("player-avatar", "player-avatar sm")
      : `<div class="commander-thumb sm" style="${prof ? seatThumbStyle(prof) : ""}">${prof && prof.commander && prof.commander.art ? "" : I("card")}</div>`;
    const sub = rankKind === "decks" && prof && prof.playerName ? esc(prof.playerName) + " · " : "";
    return `
      <div class="rank-row ${r.rank <= 3 && r.tier !== "provisional" ? "top top-" + r.rank : ""}" role="button" tabindex="0" data-key="${esc(r.key)}" data-name="${esc(r.name)}">
        <span class="rank-pos">${r.tier === "provisional" ? "–" : r.rank}</span>
        ${avatar}
        <span class="rank-info">
          <span class="rank-name">${esc(r.name)}</span>
          <span class="rank-sub"><b class="rank-league league-${r.league}">${leagueName(r.league, r.division)}</b> · ${sub}${tr("{w} V · {g} jogos", { w: r.wins, g: r.games })}</span>
        </span>
        <span class="rank-badge">${leagueBadge(r, 34)}</span>
        <span class="rank-score"><b>${r.rating}</b>${deltaHtml(r.delta)}</span>
      </div>`;
  }).join("");
  view.innerHTML = `
    <div class="rank-kind" role="tablist">
      <button type="button" class="sort-chip" data-kind="players" aria-pressed="${rankKind === "players"}">${tr("Jogadores")}</button>
      <button type="button" class="sort-chip" data-kind="decks" aria-pressed="${rankKind === "decks"}">${tr("Decks")}</button>
    </div>
    <div class="rank-layout">
    ${list.length ? `<div class="rank-list">${rows}</div>` : `<div class="chart-card"><div class="footer-note">${tr("Ainda não há jogos para a classificação. Contam os jogos com vencedor entre dois ou mais perfis.")}</div></div>`}
    <details class="rank-help"${wideLayout() ? " open" : ""}>
      <summary>${tr("Como funciona")}</summary>
      <p>${tr("Todos começam com 1500 pontos. Em cada jogo, quem ganha \"vence\" cada adversário: ganhar a quem tem mais pontos dá mais, perder com quem tem menos tira mais. Jogos sem vencedor não contam.")}</p>
      <p>${tr("Há 5 ligas, cada uma com 3 divisões: começa-se na III e sobe-se até à I antes de passar à liga seguinte. Com menos de {n} jogos fica em calibração.", { n: MTG.Elo.PROVISIONAL })}</p>
      ${leagueLegendHtml()}
      <p>${tr("{n} jogo(s) contados.", { n: data.games })}</p>
    </details>
    </div>`;
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
        <span class="elo-badge">${leagueBadge(rec, 60)}</span>
        <span class="elo-league">
          <span class="elo-league-name league-${rec.league}">${leagueName(rec.league, rec.division)}</span>
          <span class="elo-main"><b>${rec.rating}</b> ${deltaHtml(rec.delta)}</span>
        </span>
        <span class="elo-rank">${rec.league === "provisional" ? "–" : "#" + rec.rank}<small>/${total}</small></span>
      </div>
      <div class="elo-progress league-${rec.league}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(rec.progress * 100)}"><span style="width:${Math.round(rec.progress * 100)}%"></span></div>
      <div class="elo-next">${rec.league === "provisional"
        ? tr("Faltam {n} jogo(s) para entrar numa liga", { n: Math.max(0, MTG.Elo.PROVISIONAL - rec.games) })
        : nextLeagueName(rec) ? tr("Faltam {n} pontos para {l}", { n: rec.next, l: "<b>" + nextLeagueName(rec) + "</b>" }) : tr("Divisão mais alta!")}</div>
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
    <div class="pf-overview">
    <div class="kpi-row">
      ${kpiHtml(tr("Perfis"), profiles.length)}
      ${kpiHtml(tr("Jogos registados"), totalGames)}
      ${kpiHtml(tr("Melhor taxa de vitórias"), `${Math.round(best.d.winRate * 100)}%`, best.p.name)}
    </div>
    <div class="chart-card">
      <div class="chart-title">${tr("Taxa de vitórias por perfil")}</div>
      ${Charts.hbars(rows)}
    </div>
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
  return `<span class="pips" aria-label="${esc(ids.map((m) => tr(MANA_NAMES[m])).join(", "))}">${ids.map((m) => `<span class="pip pip-${m}" title="${tr(MANA_NAMES[m])}">${MTG.Mana.svg(m, 16, tr(MANA_NAMES[m]))}</span>`).join("")}</span>`;
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
      // quem estava sentado (deck emprestado) > dono do deck > nome do lugar
      const label = o.pilot || (op && (op.playerName || op.name)) || o.name;
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

/** Quem jogou um jogo de um deck: quem o pediu emprestado, ou o dono. */
const pilotOf = (p, g) => (g.playedBy || p.playerName || "").trim();

/** Jogadores: os decks de que são donos (campo "Dono" do perfil) e os
 *  jogos que jogaram — com os seus decks ou com decks emprestados. Um
 *  jogo com um deck emprestado conta para quem jogou, não para o dono. */
function playersFromProfiles(profiles) {
  const map = new Map();
  const get = (name) => {
    const key = name.toLowerCase();
    if (!map.has(key)) map.set(key, { key, name, profiles: [], history: [], extraGames: 0, extraWins: 0 });
    return map.get(key);
  };
  profiles.forEach((p) => {
    const owner = (p.playerName || "").trim();
    if (!owner) return;
    const pl = get(owner);
    pl.profiles.push(p);
    // jogos antigos só nas stats (sem histórico) contam para o dono
    const hist = p.history || [];
    pl.extraGames += Math.max(0, p.stats.games - hist.length);
    pl.extraWins += Math.max(0, p.stats.wins - hist.filter((g) => g.won).length);
  });
  profiles.forEach((p) => (p.history || []).forEach((g) => {
    const who = pilotOf(p, g);
    if (!who) return;
    const owner = (p.playerName || "").trim();
    const borrowedFrom = g.playedBy && owner && normName(owner) !== normName(who) ? owner : null;
    get(who).history.push(Object.assign({ deck: p.name, deckId: p.id, borrowedFrom }, g));
  }));
  return Array.from(map.values()).map((pl) => {
    pl.history.sort((a, b) => a.date - b.date);
    const games = pl.history.length + pl.extraGames;
    const wins = pl.history.filter((g) => g.won).length + pl.extraWins;
    return Object.assign(pl, { games, wins, winRate: games ? wins / games : 0 });
  }).filter((pl) => pl.profiles.length || pl.history.length);
}

/** Deck com que cada jogador jogou mais vezes (os seus ou emprestados;
 *  em empate, o usado mais recentemente). Chave = nome em minúsculas. */
function topDeckByPlayer(players) {
  const map = new Map();
  (players || playersFromProfiles(Profiles.all())).forEach((pl) => {
    const count = new Map();
    pl.history.forEach((g) => {
      const c = count.get(g.deckId) || { n: 0, last: 0 };
      c.n++; c.last = Math.max(c.last, g.date || 0);
      count.set(g.deckId, c);
    });
    let best = null, bc = null;
    count.forEach((c, id) => { if (!bc || c.n > bc.n || (c.n === bc.n && c.last > bc.last)) { best = id; bc = c; } });
    let prof = best ? Profiles.get(best) : null;
    // sem jogos no histórico: o deck próprio com mais jogos registados
    if (!prof && pl.profiles.length) prof = pl.profiles.slice().sort((a, b) => b.stats.games - a.stats.games)[0];
    if (prof) map.set(pl.key, prof);
  });
  return map;
}

/** Avatar de um jogador: a arte do commander do deck com que mais joga,
 *  ou a cor desse deck, ou as iniciais numa cor pastel. */
function initialsAvatar(name, i, deck) {
  const pal = State.FALLBACK_PALETTE;
  const initials = esc(name.trim().slice(0, 2).toUpperCase());
  if (deck && deck.commander && deck.commander.art) {
    return `<span class="player-avatar has-art" style="${commanderThumbStyle(deck.commander)}" title="${esc(deck.name)}" aria-label="${esc(name)}"></span>`;
  }
  const style = deck ? seatThumbStyle(deck) : "";
  return `<span class="player-avatar" style="${style || "background:" + pal[i % pal.length][0]}">${initials}</span>`;
}

function kpiHtml(label, value, sub) {
  return `<div class="kpi"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${esc(value)}</div>${sub ? `<div class="kpi-sub">${esc(sub)}</div>` : ""}</div>`;
}

/** Nomes de jogadores já conhecidos (donos e quem jogou), por ordem. */
function knownPlayers() {
  return playersFromProfiles(Profiles.all()).map((pl) => pl.name).sort((a, b) => a.localeCompare(b));
}
/** Fila de botões com os jogadores conhecidos, para escolher o dono. */
function ownerChipsHtml(id) {
  const names = knownPlayers();
  if (!names.length) return "";
  return `<div class="owner-chips" id="${id}" role="group" aria-label="${tr("Jogadores conhecidos")}">${names.map((n) => `<button type="button" class="sort-chip" data-owner="${esc(n)}">${esc(n)}</button>`).join("")}</div>`;
}
function bindOwnerChips(root, id, input) {
  const row = root.querySelector("#" + id);
  if (!row || !input) return;
  const paint = () => row.querySelectorAll("[data-owner]").forEach((b) => b.setAttribute("aria-pressed", String(normName(b.dataset.owner) === normName(input.value))));
  row.addEventListener("click", (e) => {
    const b = e.target.closest("[data-owner]");
    if (!b) return;
    input.value = normName(input.value) === normName(b.dataset.owner) ? "" : b.dataset.owner;
    paint();
  });
  input.addEventListener("input", paint);
  paint();
}

/** Editar um perfil: nome, jogador, commander (e arte) e cor quando não
 *  há arte. As estatísticas e o histórico ficam iguais. */
function openEditProfileModal(profileId) {
  const profile = Profiles.get(profileId);
  if (!profile) return;
  let pendingCommander = profile.commander || null;
  let pendingAlts = (profile.altCommanders || []).slice();
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
          <label for="epf-player">${tr("Dono do deck")}</label>
          <input type="text" id="epf-player" value="${esc(profile.playerName || "")}" placeholder="${tr("Nome de quem é este deck")}">
          ${ownerChipsHtml("epf-owners")}
          <label>${tr("Commanders alternativos")}</label>
          <div class="footer-note">${tr("Outros commanders que este deck pode usar. No setup escolhes com qual vais jogar e as estatísticas ficam todas neste deck.")}</div>
          <div class="alt-list" id="epf-alts"></div>
          <button type="button" class="btn btn-ghost btn-sm" id="epf-alt-add">${I("plus")} ${tr("Adicionar commander alternativo")}</button>
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
    backdrop.querySelector("#epf-alts").innerHTML = pendingAlts.map((c, k) => `
      <div class="alt-row">
        <span class="commander-thumb sm" style="${commanderThumbStyle(c)}">${c.art ? "" : I("card")}</span>
        <span class="alt-name">${esc(c.name)}</span>
        <button type="button" class="btn btn-ghost btn-sm" data-alt-main="${k}">${tr("Tornar principal")}</button>
        <button type="button" class="btn btn-icon" data-alt-del="${k}" title="${tr("Remover")}" aria-label="${tr("Remover")}">${I("x")}</button>
      </div>`).join("");
  }
  paint();
  bindOwnerChips(backdrop, "epf-owners", backdrop.querySelector("#epf-player"));
  backdrop.querySelector("#epf-alt-add").addEventListener("click", () => {
    openCommanderPicker((c) => {
      if (!c) return;
      const names = [pendingCommander].concat(pendingAlts).filter(Boolean).map((x) => normName(x.name));
      if (names.includes(normName(c.name))) { toast(tr("Esse commander já está neste deck")); return; }
      if (!pendingCommander) pendingCommander = c; else pendingAlts.push(c);
      paint();
    }, tr("Commander alternativo"));
  });
  backdrop.querySelector("#epf-alts").addEventListener("click", (e) => {
    const del = e.target.closest("[data-alt-del]");
    if (del) { pendingAlts.splice(parseInt(del.dataset.altDel, 10), 1); paint(); return; }
    const mk = e.target.closest("[data-alt-main]");
    if (mk) {
      const k = parseInt(mk.dataset.altMain, 10);
      const next = pendingAlts[k];
      pendingAlts.splice(k, 1, pendingCommander);
      pendingAlts = pendingAlts.filter(Boolean);
      pendingCommander = next;
      paint();
    }
  });
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
    const patch = {
      name: backdrop.querySelector("#epf-name").value.trim() || profile.name,
      playerName: Profiles.canonicalPlayer(backdrop.querySelector("#epf-player").value.trim()),
      commander: pendingCommander,
      altCommanders: pendingAlts,
      colorIdx: pendingColor,
    };
    // Quem jogou e com que commander passa a ficar escrito em cada jogo,
    // para não mudar quando se troca o dono ou o commander principal.
    // editedAt faz a correção chegar aos outros aparelhos do grupo.
    const now = Date.now();
    const oldMain = profile.commander && profile.commander.name;
    const mainChanged = oldMain && (!pendingCommander || normName(pendingCommander.name) !== normName(oldMain));
    const oldOwner = (profile.playerName || "").trim();
    const newOwner = patch.playerName.trim();
    const ownerChanged = normName(oldOwner) !== normName(newOwner);
    if ((mainChanged || ownerChanged) && (profile.history || []).length) {
      let touched = false;
      const hist = profile.history.map((g) => {
        const c = Object.assign({}, g);
        // jogos antigos sem o commander guardado eram com o principal de então
        if (mainChanged && !c.commander) c.commander = oldMain;
        if (ownerChanged) {
          // jogados pelo dono anterior: ficam dele (agora como emprestados)
          if (!c.playedBy && oldOwner) c.playedBy = oldOwner;
          // jogados pelo novo dono: deixam de ser emprestados
          if (c.playedBy && normName(c.playedBy) === normName(newOwner)) delete c.playedBy;
        }
        if (c.commander !== g.commander || c.playedBy !== g.playedBy) { c.editedAt = now; touched = true; return c; }
        return g;
      });
      if (touched) patch.history = hist;
    }
    Profiles.update(profileId, patch);
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
        ${(profile.altCommanders || []).length ? `<div class="profile-sub">${tr("Alternativos: {list}", { list: profile.altCommanders.map((c) => esc(c.name)).join(", ") })}</div>` : ""}
        ${profile.playerName ? `<div class="profile-sub">${I("user")} ${tr("Dono: {name}", { name: esc(profile.playerName) })}</div>` : ""}
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

  // resultados por commander (principal e alternativos)
  const mainName = profile.commander ? profile.commander.name : "";
  const byCmd = new Map();
  chrono.forEach((g) => {
    const name = g.commander || mainName;
    if (!name) return;
    const k = normName(name);
    if (!byCmd.has(k)) byCmd.set(k, { name, games: 0, wins: 0 });
    const r = byCmd.get(k); r.games++; if (g.won) r.wins++;
  });
  const cmdHtml = byCmd.size > 1 ? `
    <div class="chart-card">
      <div class="chart-title">${tr("Por commander")}</div>
      <div class="chart-sub">${tr("Taxa de vitórias com cada commander deste deck")}</div>
      ${Charts.hbars(Array.from(byCmd.values()).sort((a, b) => b.games - a.games).map((r) => ({
        label: r.name, value: r.wins / r.games,
        valueLabel: `${Math.round((r.wins / r.games) * 100)}% · ${tr("{n} jogo(s)", { n: r.games })}`,
        tip: `${Math.round((r.wins / r.games) * 100)}%`, tipLabel: `${r.name} · ${tr("{w} de {g} vitórias", { w: r.wins, g: r.games })}`,
      })))}
    </div>` : "";

  // empréstimos: quem jogou com este deck sem ser o dono
  const lent = new Map();
  chrono.forEach((g) => {
    if (!g.playedBy) return;
    const k = normName(g.playedBy);
    if (!lent.has(k)) lent.set(k, { name: g.playedBy, games: 0, wins: 0 });
    const r = lent.get(k); r.games++; if (g.won) r.wins++;
  });
  const lentHtml = lent.size ? `
    <div class="chart-card">
      <div class="chart-title">${profile.playerName ? tr("Emprestado a outros") : tr("Quem jogou com este deck")}</div>
      <div class="chart-sub">${tr("Estes jogos contam para o deck e para quem jogou")}</div>
      <div class="lend-list">${Array.from(lent.values()).sort((a, b) => b.games - a.games).map((r) => `
        <div class="lend-row"><span class="lend-name">${esc(r.name)}</span><span class="lend-val">${tr("{g} jogos · {w} vitórias", { g: r.games, w: r.wins })}</span></div>`).join("")}</div>
    </div>` : "";

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
  body.classList.add("pd-body");
  body.innerHTML = head + kpis + `<div class="pd-cards">` + eloCardHtml(eloRec, eloAll.decks.length) + `<div class="pd-stack">` + streak + form + `</div>` + evo + cmdHtml + modes + lentHtml + h2hHtml + durations + `</div>
    <div class="section-title">${tr("Histórico de jogos")}</div>
    <div class="col pd-history" id="history-list"></div>
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
          ${pilotOf(profile, g) ? `<div class="history-who">${I("user")}<span>${esc(pilotOf(profile, g))}</span>${g.playedBy && profile.playerName ? `<small class="borrow-tag">${tr("emprestado")}</small>` : ""}</div>` : ""}
          ${g.commander && normName(g.commander) !== normName(mainName) ? `<div class="history-meta">${tr("Com {name}", { name: esc(g.commander) })}</div>` : ""}
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
  // resultados de ESTE jogador com cada deck (os seus e os emprestados);
  // jogos dos seus decks jogados por outras pessoas não entram aqui
  const deckStats = new Map();
  pl.profiles.forEach((p) => {
    const hist = p.history || [];
    deckStats.set(p.id, { p, borrowed: false, games: Math.max(0, p.stats.games - hist.length), wins: Math.max(0, p.stats.wins - hist.filter((g) => g.won).length) });
  });
  pl.history.forEach((g) => {
    if (!deckStats.has(g.deckId)) {
      const p = Profiles.get(g.deckId);
      if (!p) return;
      deckStats.set(g.deckId, { p, borrowed: true, games: 0, wins: 0 });
    }
    const r = deckStats.get(g.deckId); r.games++; if (g.won) r.wins++;
  });
  const decks = Array.from(deckStats.values()).map((r) => Object.assign(r, { d: { games: r.games, wins: r.wins, winRate: r.games ? r.wins / r.games : 0 } }))
    .sort((a, b) => (a.borrowed - b.borrowed) || (b.d.winRate - a.d.winRate) || (b.d.games - a.d.games));
  const ownDecks = decks.filter((x) => !x.borrowed);
  const borrowedDecks = decks.filter((x) => x.borrowed);
  // os decks deste jogador que outras pessoas usaram
  const lentOut = [];
  pl.profiles.forEach((p) => (p.history || []).forEach((g) => { if (g.playedBy) lentOut.push({ deck: p.name, who: g.playedBy, won: g.won }); }));
  const plEloAll = MTG.Elo.compute(Profiles.all());
  const normKey = (x) => String(x || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const plElo = plEloAll.players.find((r) => r.key === normKey(pl.name));
  body.classList.add("pd-body");
  body.innerHTML = `
    <div class="pd-head">
      ${initialsAvatar(pl.name, 0, topDeckByPlayer([pl]).get(pl.key)).replace("player-avatar", "player-avatar lg")}
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
    <div class="pd-cards">
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
      ${Charts.hbars(decks.map(({ p, d, borrowed }) => ({
        label: p.name, labelHtml: `${esc(p.name)} ${pipsHtml(colorIdentityOf(p))}${borrowed ? ` <small class="borrow-tag">${tr("emprestado")}</small>` : ""}`,
        value: d.winRate, valueLabel: `${Math.round(d.winRate * 100)}% · ${tr("{n} jogo(s)", { n: d.games })}`,
        tip: `${Math.round(d.winRate * 100)}%`, tipLabel: `${p.name} · ${tr("{w} de {g} vitórias", { w: d.wins, g: d.games })}`,
        muted: !d.games,
      })))}
    </div>
    ${headToHeadHtml(pl.history, tr("Jogos em que estiveram os dois à mesa, com qualquer deck: vitórias de {name} – vitórias do adversário", { name: esc(pl.name) }), tr("{name} ganhou", { name: esc(pl.name) }), [pl.name])}
    ${lentOut.length ? `
    <div class="chart-card">
      <div class="chart-title">${tr("Decks emprestados a outros")}</div>
      <div class="chart-sub">${tr("Jogos com os decks de {name} jogados por outras pessoas (contam para quem jogou)", { name: esc(pl.name) })}</div>
      <div class="lend-list">${Object.values(lentOut.reduce((acc, x) => { const k = x.deck + "|" + normName(x.who); (acc[k] = acc[k] || { deck: x.deck, who: x.who, g: 0, w: 0 }).g++; if (x.won) acc[k].w++; return acc; }, {})).sort((a, b) => b.g - a.g).map((r) => `
        <div class="lend-row"><span class="lend-name">${esc(r.deck)} → ${esc(r.who)}</span><span class="lend-val">${tr("{g} jogos · {w} vitórias", { g: r.g, w: r.w })}</span></div>`).join("")}</div>
    </div>` : ""}
    </div>
    <div class="section-title">${tr("Decks")}</div>
    <div class="pf-grid">${ownDecks.map(({ p, d }) => `
      <div class="profile-card" data-id="${p.id}" role="button" tabindex="0">
        <div class="commander-thumb" style="${seatThumbStyle(p)}">${p.commander && p.commander.art ? "" : I("card")}</div>
        <div class="profile-info">
          <div class="profile-name">${esc(p.name)} ${pipsHtml(colorIdentityOf(p))}</div>
          <div class="profile-summary">${d.games ? tr("{g} jogos · {w} vitórias", { g: d.games, w: d.wins }) + ` (${Math.round(d.winRate * 100)}%)` : tr("Ainda sem jogos")}</div>
        </div>
        <span class="profile-chevron">${I("chevron-right")}</span>
      </div>`).join("")}</div>
    ${borrowedDecks.length ? `
    <div class="section-title">${tr("Decks de outros com que jogou")}</div>
    <div class="pf-grid">${borrowedDecks.map(({ p, d }) => `
      <div class="profile-card" data-id="${p.id}" role="button" tabindex="0">
        <div class="commander-thumb" style="${seatThumbStyle(p)}">${p.commander && p.commander.art ? "" : I("card")}</div>
        <div class="profile-info">
          <div class="profile-name">${esc(p.name)} ${pipsHtml(colorIdentityOf(p))}</div>
          <div class="profile-sub">${p.playerName ? tr("Deck de {name}", { name: esc(p.playerName) }) : tr("Sem dono")}</div>
          <div class="profile-summary">${tr("{g} jogos · {w} vitórias", { g: d.games, w: d.wins })} (${Math.round(d.winRate * 100)}%)</div>
        </div>
        <span class="profile-chevron">${I("chevron-right")}</span>
      </div>`).join("")}</div>` : ""}`;
  body.insertAdjacentHTML("beforeend", `<button class="btn btn-ghost btn-block merge-entry" id="merge-player-btn">${I("merge")} ${tr("Fundir com outro jogador")}</button>`);
  body.querySelector("#merge-player-btn").addEventListener("click", () => openMergePlayerSheet(pl.key));
  body.querySelectorAll(".profile-card[data-id]").forEach((c) => c.addEventListener("click", () => nav("profile-detail", { id: c.dataset.id, fromPlayer: pl.key })));
  bindEloCard(body, plElo);
  Charts.bindTips(body);
  s.querySelector("#back-btn").addEventListener("click", () => nav("profiles"));
}
