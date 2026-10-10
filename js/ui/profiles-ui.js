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
        ${profiles.length ? `<button class="btn btn-ghost btn-block pf-manual" id="manual-game-btn">${I("plus")} ${tr("Registar jogo à mão")}</button>` : ""}
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
  const manualBtn = s.querySelector("#manual-game-btn");
  if (manualBtn) manualBtn.addEventListener("click", () => openManualGame());
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
  // com parceiro, a identidade de cor é a dos dois juntos
  const p = profile.partnerCommander;
  const ids = c.colorIdentity.concat(p && Array.isArray(p.colorIdentity) ? p.colorIdentity : []);
  return ids.length ? MANA.filter((m) => ids.includes(m)) : ["C"];
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
  let pendingPartner = profile.partnerCommander || null;
  let pendingAlts = (profile.altCommanders || []).map((c) => Object.assign({}, c));
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
              <button class="btn btn-ghost btn-sm" id="epf-partner"></button>
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
          <div class="footer-note">${tr("Outros commanders que este deck pode usar (cada um pode ter um parceiro). No setup escolhes com qual vais jogar e as estatísticas ficam todas neste deck.")}</div>
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
    backdrop.querySelector("#epf-cmd-name").textContent = pendingCommander ? cmdLabel(pendingCommander, pendingPartner) : tr("Sem commander");
    const pBtn = backdrop.querySelector("#epf-partner");
    pBtn.classList.toggle("hidden", !pendingCommander);
    pBtn.innerHTML = pendingPartner ? `${I("x")} ${tr("Tirar parceiro")}` : `${I("plus")} ${tr("Parceiro")}`;
    backdrop.querySelector("#epf-art").classList.toggle("hidden", !(pendingCommander && pendingCommander.printsUri));
    backdrop.querySelector("#epf-colors-wrap").classList.toggle("hidden", !!(pendingCommander && pendingCommander.art));
    backdrop.querySelectorAll("#epf-colors .color-dot").forEach((b) => b.setAttribute("aria-pressed", String(parseInt(b.dataset.color, 10) === pendingColor)));
    backdrop.querySelector("#epf-alts").innerHTML = pendingAlts.map((c, k) => `
      <div class="alt-row">
        <span class="commander-thumb sm" style="${commanderThumbStyle(c)}">${c.art ? "" : I("card")}</span>
        <span class="alt-name">${esc(cmdLabel(c))}</span>
        <button type="button" class="btn btn-ghost btn-sm" data-alt-partner="${k}" title="${c.partner ? tr("Tirar parceiro") : tr("Adicionar parceiro")}">${c.partner ? I("x") : I("plus")} ${tr("Parceiro")}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-alt-main="${k}">${tr("Tornar principal")}</button>
        <button type="button" class="btn btn-icon" data-alt-del="${k}" title="${tr("Remover")}" aria-label="${tr("Remover")}">${I("x")}</button>
      </div>`).join("");
  }
  paint();
  bindOwnerChips(backdrop, "epf-owners", backdrop.querySelector("#epf-player"));
  backdrop.querySelector("#epf-alt-add").addEventListener("click", () => {
    openCommanderPicker((c) => {
      if (!c) return;
      const names = [cmdLabel(pendingCommander, pendingPartner)].concat(pendingAlts.map((x) => cmdLabel(x))).filter(Boolean).map(normName);
      if (names.includes(normName(c.name))) { toast(tr("Esse commander já está neste deck")); return; }
      if (!pendingCommander) pendingCommander = c; else pendingAlts.push(c);
      paint();
    }, tr("Commander alternativo"));
  });
  backdrop.querySelector("#epf-alts").addEventListener("click", (e) => {
    const del = e.target.closest("[data-alt-del]");
    if (del) { pendingAlts.splice(parseInt(del.dataset.altDel, 10), 1); paint(); return; }
    const pa = e.target.closest("[data-alt-partner]");
    if (pa) {
      const alt = pendingAlts[parseInt(pa.dataset.altPartner, 10)];
      if (alt.partner) { delete alt.partner; paint(); return; }
      openCommanderPicker((c) => { if (c) { alt.partner = bareCard(c); paint(); } }, tr("Escolher commander parceiro"));
      return;
    }
    const mk = e.target.closest("[data-alt-main]");
    if (mk) {
      // troca o par principal (commander + parceiro) com o alternativo
      const k = parseInt(mk.dataset.altMain, 10);
      const next = pendingAlts[k];
      const oldMain = pendingCommander ? Object.assign(bareCard(pendingCommander), pendingPartner ? { partner: pendingPartner } : {}) : null;
      pendingAlts.splice(k, 1, oldMain);
      pendingAlts = pendingAlts.filter(Boolean);
      pendingCommander = bareCard(next);
      pendingPartner = next.partner || null;
      paint();
    }
  });
  backdrop.querySelector("#epf-partner").addEventListener("click", () => {
    if (pendingPartner) { pendingPartner = null; paint(); return; }
    openCommanderPicker((c) => { if (c) { pendingPartner = bareCard(c); paint(); } }, tr("Escolher commander parceiro"));
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
      partnerCommander: pendingCommander ? pendingPartner || undefined : undefined,
      altCommanders: pendingAlts,
      colorIdx: pendingColor,
    };
    // Quem jogou e com que commander passa a ficar escrito em cada jogo,
    // para não mudar quando se troca o dono ou o commander principal.
    // editedAt faz a correção chegar aos outros aparelhos do grupo.
    const now = Date.now();
    const oldMain = profile.commander ? cmdLabel(profile.commander, profile.partnerCommander || null) : "";
    const mainChanged = oldMain && (!pendingCommander || normName(cmdLabel(pendingCommander, pendingPartner)) !== normName(oldMain));
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
// BLOCOS PARTILHADOS PELOS DETALHES DE DECK E DE JOGADOR
// ===========================================================
// Os dois ecrãs têm a mesma estrutura: cabeçalho, números-resumo,
// cartões (classificação, sequência e forma, evolução, decks/commanders,
// modos, empréstimos, confrontos, duração) e o histórico de jogos.

/** Médias de tempo a partir de uma lista de jogos (só os com tempo). */
function timeStatsOf(games) {
  const timed = games.filter((g) => g.timed !== false && g.gameTimeMs > 0);
  const totalGame = timed.reduce((a, g) => a + g.gameTimeMs, 0);
  const totalTurn = timed.reduce((a, g) => a + (g.turnTimeMs || 0), 0);
  const turns = timed.reduce((a, g) => a + (g.turnsTaken || 0), 0);
  return { timedGames: timed.length, avgGameTimeMs: timed.length ? totalGame / timed.length : 0, avgTurnTimeMs: turns ? totalTurn / turns : 0, turnsTaken: turns };
}

/** Jogos, vitórias (com barra) e médias de tempo. */
function detailKpisHtml(games, wins, times) {
  const pct = games ? Math.round((wins / games) * 100) : 0;
  return `
    <div class="kpi-row pd-kpis">
      ${kpiHtml(tr("Jogos"), games)}
      <div class="kpi">
        <div class="kpi-label">${tr("Vitórias")}</div>
        <div class="kpi-value">${wins} <small>${pct}%</small></div>
        <div class="meter" data-tip="${pct}%" data-tip-label="${esc(tr("{w} de {g} vitórias", { w: wins, g: games }))}"><div class="meter-fill" style="width:${pct}%"></div></div>
      </div>
      ${kpiHtml(tr("Média por jogo"), times.timedGames ? formatDuration(times.avgGameTimeMs) : "—", times.timedGames ? tr("{n} jogo(s) com tempo", { n: times.timedGames }) : tr("sem jogos com tempo"))}
      ${kpiHtml(tr("Média por turno"), times.turnsTaken ? formatDuration(times.avgTurnTimeMs) : "—", times.turnsTaken ? tr("{n} turno(s)", { n: times.turnsTaken }) : "")}
    </div>`;
}

/** Sequência atual e melhor sequência de vitórias (chrono: antigo → recente). */
function streakCardHtml(chrono) {
  if (!chrono.length) return "";
  const latest = chrono.slice().reverse();
  const curWon = latest[0].won;
  let curLen = 0;
  for (const g of latest) { if (g.won === curWon) curLen++; else break; }
  let best = 0, run = 0;
  chrono.forEach((g) => { run = g.won ? run + 1 : 0; best = Math.max(best, run); });
  return `
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
}

/** Últimos 10 resultados. tipLabel(g) = texto da dica de cada um. */
function formCardHtml(chrono, tipLabel) {
  const recent = chrono.slice(-10);
  if (!recent.length) return "";
  return `
    <div class="chart-card">
      <div class="chart-title">${tr("Forma recente")}</div>
      <div class="chart-sub">${tr("Últimos {n} jogos, do mais antigo para o mais recente", { n: recent.length })}</div>
      <div class="form-strip">${recent.map((g) => `
        <span class="form-chip ${g.won ? "win" : "loss"}" data-tip="${g.won ? esc(tr("Vitória")) : esc(tr("Derrota"))}" data-tip-label="${esc(tipLabel(g))}">${g.won ? tr("V") : tr("D")}</span>`).join("")}
      </div>
    </div>`;
}

/** Evolução da taxa de vitórias acumulada. Devolve { html, points }. */
function evoCard(chrono) {
  if (chrono.length < 2) return { html: "", points: null };
  let w = 0;
  const points = chrono.map((g, i) => {
    if (g.won) w++;
    const rate = w / (i + 1);
    return { y: rate, tip: `${Math.round(rate * 100)}%`, tipLabel: `${tr("Jogo {n}", { n: i + 1 })} · ${g.won ? tr("Vitória") : tr("Derrota")} · ${formatDateTime(g.date)}` };
  });
  return {
    points,
    html: `
      <div class="chart-card">
        <div class="chart-title">${tr("Evolução da taxa de vitórias")}</div>
        <div class="chart-sub">${tr("Percentagem de vitórias acumulada, jogo a jogo")}</div>
        ${Charts.lineChart(points, { xLabel: (i) => tr("Jogo {n}", { n: i + 1 }), aria: tr("Evolução da taxa de vitórias") })}
      </div>`,
  };
}

/** Vitórias / derrotas por modo de jogo. */
function modesCardHtml(chrono) {
  if (!chrono.length) return "";
  const byMode = new Map();
  chrono.forEach((g) => {
    const k = g.mode || "standard";
    if (!byMode.has(k)) byMode.set(k, { label: modeLabel(k), a: 0, b: 0 });
    const m = byMode.get(k);
    if (g.won) m.a++; else m.b++;
  });
  return `
    <div class="chart-card">
      <div class="chart-title">${tr("Resultados por modo")}</div>
      ${Charts.stackedBars(Array.from(byMode.values()).sort((x, y) => (y.a + y.b) - (x.a + x.b)), [tr("Vitórias"), tr("Derrotas")])}
    </div>`;
}

/** Duração dos últimos 12 jogos com tempo. */
function durationsCardHtml(chrono) {
  const timedGames = chrono.filter((g) => g.timed !== false && g.gameTimeMs > 0).slice(-12);
  if (timedGames.length < 2) return "";
  const first = chrono.indexOf(timedGames[0]) + 1, lastN = chrono.indexOf(timedGames[timedGames.length - 1]) + 1;
  return `
    <div class="chart-card">
      <div class="chart-title">${tr("Duração dos jogos")}</div>
      <div class="chart-sub">${tr("Últimos {n} jogos com tempo contado, em minutos", { n: timedGames.length })}</div>
      ${Charts.columns(timedGames.map((g) => ({
        value: g.gameTimeMs / 60000,
        tip: formatDuration(g.gameTimeMs),
        tipLabel: `${g.won ? tr("Vitória") : tr("Derrota")} · ${g.deck ? g.deck + " · " : ""}${formatDateTime(g.date)}`,
      })), {
        tickFmt: (v) => `${Math.round(v)}m`,
        xLabel: (i) => i === 0 ? tr("Jogo {n}", { n: first }) : tr("Jogo {n}", { n: lastN }),
        aria: tr("Duração dos jogos"),
      })}
    </div>`;
}

/** Lista curta "nome — n jogos · v vitórias". rows = [{ name, games, wins }] */
function lendCardHtml(title, sub, rows) {
  if (!rows.length) return "";
  return `
    <div class="chart-card">
      <div class="chart-title">${title}</div>
      <div class="chart-sub">${sub}</div>
      <div class="lend-list">${rows.sort((a, b) => b.games - a.games).map((r) => `
        <div class="lend-row"><span class="lend-name">${r.name}</span><span class="lend-val">${tr("{g} jogos · {w} vitórias", { g: r.games, w: r.wins })}</span></div>`).join("")}</div>
    </div>`;
}

/** Histórico de jogos (mais recente primeiro), compacto, com editar e
 *  apagar. Mostra 10 e um botão para ver todos.
 *  rows = [{ g, profileId, deck (nome, só no jogador), pilot, borrowed, altCmd }] */
function historySectionHtml(rows, opts) {
  return `
    <div class="section-head"><span class="section-title">${tr("Histórico de jogos")}</span>${opts && opts.addBtn ? `<button type="button" class="btn btn-ghost btn-sm" id="pd-manual-btn">${I("plus")} ${tr("Registar jogo")}</button>` : ""}</div>
    <div class="pd-history" id="history-list">${rows.map((r, i) => {
      const g = r.g;
      const meta = [
        r.deck ? `<b>${esc(r.deck)}</b>` : "",
        r.pilot ? `${I("user")}${esc(r.pilot)}${r.borrowed ? ` <small class="borrow-tag">${tr("emprestado")}</small>` : ""}` : "",
        r.altCmd ? esc(tr("Com {name}", { name: g.commander })) : "",
      ].filter(Boolean).join(" · ");
      const time = g.timed === false ? tr("sem tempo")
        : g.manual || !g.turnsTaken ? formatDuration(g.gameTimeMs)
        : tr("{game} · {n} turno(s) de {turn}", { game: formatDuration(g.gameTimeMs), n: g.turnsTaken, turn: formatDuration(g.turnsTaken ? g.turnTimeMs / g.turnsTaken : 0) });
      return `
      <div class="hist-row ${i >= 10 ? "hidden more" : ""}" data-i="${i}">
        <span class="form-chip sm ${g.won ? "win" : "loss"}">${g.won ? tr("V") : tr("D")}</span>
        <div class="hist-main">
          <div class="hist-top"><span class="hist-title">${g.won ? tr("Vitória") : tr("Derrota")} · ${esc(modeLabel(g.mode))}</span><span class="hist-date">${formatDateTime(g.date)}</span></div>
          ${meta ? `<div class="hist-meta">${meta}</div>` : ""}
          <div class="hist-meta dim">${I("hourglass")}${time}${g.manual ? ` · ${tr("registado à mão")}` : ""}</div>
        </div>
        <div class="hist-actions">
          <button class="btn btn-icon" data-edit="${i}" title="${tr("Editar este jogo")}" aria-label="${tr("Editar este jogo")}">${I("pencil")}</button>
          <button class="btn btn-icon" data-del="${i}" title="${tr("Apagar este jogo")}" aria-label="${tr("Apagar este jogo")}">${I("trash")}</button>
        </div>
      </div>`;
    }).join("")}</div>
    ${rows.length > 10 ? `<button type="button" class="btn btn-ghost btn-block" id="history-more">${tr("Ver todos os jogos ({n})", { n: rows.length })}</button>` : ""}`;
}
function bindHistorySection(root, rows) {
  const list = root.querySelector("#history-list");
  if (!list) return;
  list.addEventListener("click", (e) => {
    const ed = e.target.closest("[data-edit]");
    if (ed) { const r = rows[+ed.dataset.edit]; openGameEditor(r.profileId, r.g.id); return; }
    const del = e.target.closest("[data-del]");
    if (del) {
      const r = rows[+del.dataset.del];
      const snapshot = JSON.parse(JSON.stringify(r.g));
      Profiles.removeGame(r.profileId, r.g.id);
      render();
      undoToast(tr("Jogo apagado do histórico"), () => { Profiles.restoreGame(r.profileId, snapshot); render(); });
    }
  });
  const more = root.querySelector("#history-more");
  if (more) more.addEventListener("click", () => { list.querySelectorAll(".hist-row.more").forEach((x) => x.classList.remove("hidden")); more.remove(); });
}

// ===========================================================
// DETALHE DE UM DECK — estatísticas, gráficos e histórico
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
      <div class="scroll pd-body" id="pd-scroll"></div>
    </div>
  `);
  appEl.appendChild(s);
  const body = s.querySelector("#pd-scroll");
  const goBack = () => (screenParams.fromPlayer ? nav("player-detail", { key: screenParams.fromPlayer }) : nav("profiles"));
  s.querySelector("#back-btn").addEventListener("click", goBack);
  s.querySelector("#edit-profile-btn").addEventListener("click", () => openEditProfileModal(profile.id));

  const mainName = profile.commander ? cmdLabel(profile.commander, profile.partnerCommander || null) : "";
  const alts = profile.altCommanders || [];
  const head = `
    <div class="pd-hero">
      <div class="commander-thumb pd-hero-thumb" style="${seatThumbStyle(profile)}">${profile.commander && profile.commander.art ? "" : I("card")}</div>
      <div class="pd-hero-info">
        <div class="pd-hero-title">${profile.commander ? esc(mainName) : tr("Sem commander")} ${pipsHtml(colorIdentityOf(profile))}</div>
        ${alts.length ? `<div class="pd-hero-sub">${tr("Alternativos: {list}", { list: alts.map((c) => esc(cmdLabel(c))).join(", ") })}</div>` : ""}
        <div class="pd-hero-chips">
          ${profile.playerName ? `<button type="button" class="pd-chip" id="pd-owner">${I("user")} ${tr("Dono: {name}", { name: esc(profile.playerName) })}</button>` : `<span class="pd-chip dim">${tr("Sem dono")}</span>`}
        </div>
      </div>
    </div>`;

  if (!d.games) {
    body.innerHTML = head + `<div class="chart-card"><div class="footer-note">${tr("Ainda não há jogos registados para este perfil.")}</div>
      <button type="button" class="btn btn-ghost btn-sm" id="pd-manual-btn" style="margin-top:10px">${I("plus")} ${tr("Registar jogo")}</button></div>`;
    body.querySelector("#pd-manual-btn").addEventListener("click", () => openManualGame({ profileId: profile.id }));
    bindOwnerChip(body, profile);
    return;
  }

  // resultados por commander (principal e alternativos)
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

  // quem jogou com este deck (dono e empréstimos)
  const byPilot = new Map();
  chrono.forEach((g) => {
    const who = pilotOf(profile, g);
    if (!who) return;
    const k = normName(who);
    if (!byPilot.has(k)) byPilot.set(k, { name: esc(who) + (g.playedBy && profile.playerName ? ` <small class="borrow-tag">${tr("emprestado")}</small>` : ""), games: 0, wins: 0 });
    const r = byPilot.get(k); r.games++; if (g.won) r.wins++;
  });
  const pilotsHtml = byPilot.size > 1 || chrono.some((g) => g.playedBy)
    ? lendCardHtml(tr("Quem jogou com este deck"), tr("Os jogos emprestados contam para o deck e para quem jogou"), Array.from(byPilot.values())) : "";

  const evo = evoCard(chrono);
  const eloAll = MTG.Elo.compute(Profiles.all());
  const eloRec = eloAll.decks.find((r) => r.key === profile.id || (profile.aliases || []).includes(r.key));
  const rows = history.map((g) => ({
    g, profileId: profile.id,
    pilot: pilotOf(profile, g), borrowed: !!(g.playedBy && profile.playerName),
    altCmd: !!(g.commander && normName(g.commander) !== normName(mainName)),
  }));

  body.innerHTML = head
    + detailKpisHtml(d.games, d.wins, { timedGames: d.timedGames, avgGameTimeMs: d.avgGameTimeMs, avgTurnTimeMs: d.avgTurnTimeMs, turnsTaken: d.turnsTaken })
    + `<div class="pd-cards">`
    + eloCardHtml(eloRec, eloAll.decks.length)
    + `<div class="pd-stack">` + streakCardHtml(chrono) + formCardHtml(chrono, (g) => `${pilotOf(profile, g) ? pilotOf(profile, g) + " · " : ""}${modeLabel(g.mode)} · ${formatDateTime(g.date)}`) + `</div>`
    + evo.html + cmdHtml + modesCardHtml(chrono) + pilotsHtml
    + headToHeadHtml(chrono, tr("Jogos em que estiveram os dois à mesa: vitórias deste perfil – vitórias do adversário"), tr("Este perfil ganhou"))
    + durationsCardHtml(chrono)
    + `</div>`
    + historySectionHtml(rows, { addBtn: true })
    + `<button class="btn btn-ghost btn-block merge-entry" id="merge-deck-btn">${I("merge")} ${tr("Fundir com outro deck")}</button>`;
  body.querySelector("#merge-deck-btn").addEventListener("click", () => openMergeDeckSheet(profile.id));
  body.querySelector("#pd-manual-btn").addEventListener("click", () => openManualGame({ profileId: profile.id }));
  bindHistorySection(body, rows);
  bindOwnerChip(body, profile);
  Charts.bindTips(body);
  if (evo.points) Charts.bindLine(body, evo.points);
  bindEloCard(body, eloRec);
}

/** O chip "Dono" abre o perfil desse jogador. */
function bindOwnerChip(root, profile) {
  const chip = root.querySelector("#pd-owner");
  if (chip) chip.addEventListener("click", () => nav("player-detail", { key: playerDetailKey(profile.playerName) }));
}

// ===========================================================
// DETALHE DE UM JOGADOR — todos os jogos que fez, com qualquer deck
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
      <div class="scroll pd-body" id="pl-scroll"></div>
    </div>
  `);
  appEl.appendChild(s);
  const body = s.querySelector("#pl-scroll");
  s.querySelector("#back-btn").addEventListener("click", () => nav("profiles"));
  const chrono = pl.history; // já vem do mais antigo para o mais recente

  // resultados de ESTE jogador com cada deck (os seus e os emprestados);
  // jogos dos seus decks jogados por outras pessoas não entram aqui
  const deckStats = new Map();
  pl.profiles.forEach((p) => {
    const hist = p.history || [];
    deckStats.set(p.id, { p, borrowed: false, games: Math.max(0, p.stats.games - hist.length), wins: Math.max(0, p.stats.wins - hist.filter((g) => g.won).length) });
  });
  chrono.forEach((g) => {
    if (!deckStats.has(g.deckId)) {
      const p = Profiles.get(g.deckId);
      if (!p) return;
      deckStats.set(g.deckId, { p, borrowed: true, games: 0, wins: 0 });
    }
    const r = deckStats.get(g.deckId); r.games++; if (g.won) r.wins++;
  });
  const decks = Array.from(deckStats.values()).map((r) => Object.assign(r, { d: { games: r.games, wins: r.wins, winRate: r.games ? r.wins / r.games : 0 } }))
    .sort((a, b) => (a.borrowed - b.borrowed) || (b.d.games - a.d.games) || (b.d.winRate - a.d.winRate));
  const ownDecks = decks.filter((x) => !x.borrowed);
  const borrowedDecks = decks.filter((x) => x.borrowed);
  const top = topDeckByPlayer([pl]).get(pl.key);

  // os decks deste jogador que outras pessoas usaram
  const lentOut = {};
  pl.profiles.forEach((p) => (p.history || []).forEach((g) => {
    if (!g.playedBy) return;
    const k = p.id + "|" + normName(g.playedBy);
    const r = lentOut[k] = lentOut[k] || { name: `${esc(p.name)} → ${esc(g.playedBy)}`, games: 0, wins: 0 };
    r.games++; if (g.won) r.wins++;
  }));

  const eloAll = MTG.Elo.compute(Profiles.all());
  const elo = eloAll.players.find((r) => r.key === normName(pl.name));
  const evo = evoCard(chrono);
  const rows = chrono.slice().reverse().map((g) => {
    const p = Profiles.get(g.deckId);
    const main = p && p.commander ? cmdLabel(p.commander, p.partnerCommander || null) : "";
    return { g, profileId: g.deckId, deck: g.deck, borrowed: !!g.borrowedFrom, altCmd: !!(g.commander && normName(g.commander) !== normName(main)) };
  });
  const deckCard = (x) => `
    <div class="profile-card" data-id="${x.p.id}" role="button" tabindex="0">
      <div class="commander-thumb" style="${seatThumbStyle(x.p)}">${x.p.commander && x.p.commander.art ? "" : I("card")}</div>
      <div class="profile-info">
        <div class="profile-name">${esc(x.p.name)} ${pipsHtml(colorIdentityOf(x.p))}</div>
        ${x.borrowed ? `<div class="profile-sub">${x.p.playerName ? tr("Deck de {name}", { name: esc(x.p.playerName) }) : tr("Sem dono")}</div>` : ""}
        <div class="profile-summary">${x.d.games ? tr("{g} jogos · {w} vitórias", { g: x.d.games, w: x.d.wins }) + ` (${Math.round(x.d.winRate * 100)}%)` : tr("Ainda sem jogos")}</div>
      </div>
      <span class="profile-chevron">${I("chevron-right")}</span>
    </div>`;

  body.innerHTML = `
    <div class="pd-hero">
      ${initialsAvatar(pl.name, 0, top).replace("player-avatar", "player-avatar lg pd-hero-thumb")}
      <div class="pd-hero-info">
        <div class="pd-hero-title">${esc(pl.name)}</div>
        <div class="pd-hero-sub">${tr("{n} deck(s)", { n: pl.profiles.length })}${borrowedDecks.length ? " · " + tr("{n} emprestado(s)", { n: borrowedDecks.length }) : ""}</div>
        ${top ? `<div class="pd-hero-chips"><button type="button" class="pd-chip" data-id="${top.id}">${I("star")} ${tr("Joga mais com {name}", { name: esc(top.name) })}</button></div>` : ""}
      </div>
    </div>
    ${detailKpisHtml(pl.games, pl.wins, timeStatsOf(chrono))}
    <div class="pd-cards">
      ${eloCardHtml(elo, eloAll.players.length)}
      <div class="pd-stack">${streakCardHtml(chrono)}${formCardHtml(chrono, (g) => `${g.deck} · ${modeLabel(g.mode)} · ${formatDateTime(g.date)}`)}</div>
      ${evo.html}
      ${decks.length ? `
      <div class="chart-card">
        <div class="chart-title">${tr("Decks de {name}", { name: esc(pl.name) })}</div>
        <div class="chart-sub">${tr("Taxa de vitórias com cada deck")}</div>
        ${Charts.hbars(decks.map(({ p, d, borrowed }) => ({
          label: p.name, labelHtml: `${esc(p.name)} ${pipsHtml(colorIdentityOf(p))}${borrowed ? ` <small class="borrow-tag">${tr("emprestado")}</small>` : ""}`,
          value: d.winRate, valueLabel: `${Math.round(d.winRate * 100)}% · ${tr("{n} jogo(s)", { n: d.games })}`,
          tip: `${Math.round(d.winRate * 100)}%`, tipLabel: `${p.name} · ${tr("{w} de {g} vitórias", { w: d.wins, g: d.games })}`,
          muted: !d.games,
        })))}
      </div>` : ""}
      ${modesCardHtml(chrono)}
      ${lendCardHtml(tr("Decks emprestados a outros"), tr("Jogos com os decks de {name} jogados por outras pessoas (contam para quem jogou)", { name: esc(pl.name) }), Object.values(lentOut))}
      ${headToHeadHtml(chrono, tr("Jogos em que estiveram os dois à mesa, com qualquer deck: vitórias de {name} – vitórias do adversário", { name: esc(pl.name) }), tr("{name} ganhou", { name: esc(pl.name) }), [pl.name])}
      ${durationsCardHtml(chrono)}
    </div>
    ${ownDecks.length ? `<div class="section-title">${tr("Decks")}</div><div class="pf-grid">${ownDecks.map(deckCard).join("")}</div>` : ""}
    ${borrowedDecks.length ? `<div class="section-title">${tr("Decks de outros com que jogou")}</div><div class="pf-grid">${borrowedDecks.map(deckCard).join("")}</div>` : ""}
    ${rows.length ? historySectionHtml(rows) : ""}
    <button class="btn btn-ghost btn-block merge-entry" id="merge-player-btn">${I("merge")} ${tr("Fundir com outro jogador")}</button>`;
  body.querySelector("#merge-player-btn").addEventListener("click", () => openMergePlayerSheet(pl.key));
  body.querySelectorAll(".profile-card[data-id], .pd-chip[data-id]").forEach((c) => c.addEventListener("click", () => nav("profile-detail", { id: c.dataset.id, fromPlayer: pl.key })));
  bindHistorySection(body, rows);
  Charts.bindTips(body);
  if (evo.points) Charts.bindLine(body, evo.points);
  bindEloCard(body, elo);
}
