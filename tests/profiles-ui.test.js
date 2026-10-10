/* Ecrãs de perfis em vários tamanhos (telemóvel e iPad). */
const { seedProfiles, openWith, goProfiles } = require("./helpers");

const SIZES = [[1180, 820, "dark"], [820, 1180, "light"], [390, 844, "light"], [320, 640, "dark"]];

module.exports = [
  {
    name: "todos os separadores e detalhes abrem sem erros",
    async run(t) {
      for (const [w, h, scheme] of SIZES) {
        const page = await t.page({ viewport: { width: w, height: h }, colorScheme: scheme });
        await openWith(t, page, seedProfiles());
        await goProfiles(page);
        t.eq(await page.$$eval("#profiles-list .profile-card", (x) => x.length), 6, `${w}px: decks`);
        await page.click('.seg-btn[data-tab="players"]');
        t.eq(await page.$$eval(".player-card", (x) => x.length), 5, `${w}px: jogadores`);
        await page.click('.seg-btn[data-tab="ranking"]');
        t.eq(await page.$$eval(".rank-row .league-badge", (x) => x.length), 5, `${w}px: emblemas`);
        t.eq(await page.$$eval(".league-legend .league-badge", (x) => x.length), 15, `${w}px: legenda das ligas`);
        await page.click(".rank-row >> nth=0");
        await page.waitForSelector(".elo-card");
        await page.click("#back-btn");
        await page.click('.seg-btn[data-tab="decks"]');
        await page.click("#decks-view .profile-card >> nth=0");
        await page.waitForSelector("#history-list .hist-row");
        // nada sai da largura do ecrã
        t.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${w}px: sem scroll lateral`);
      }
    },
  },
  {
    name: "cartão da nuvem sem texto por baixo dos botões",
    async run(t) {
      for (const [w, h] of SIZES) {
        const page = await t.page({ viewport: { width: w, height: h } });
        await page.route(/supabase\.co/, () => {}); // fica a sincronizar, sem erro
        await openWith(t, page, seedProfiles(), { mtg_lc_cloud_v1: JSON.stringify({ code: "VAS2-H4Z6-3AXS", lastSync: Date.now() - 40000 }) });
        await goProfiles(page);
        const r = await page.evaluate(() => {
          const rect = (s) => document.querySelector(s).getBoundingClientRect();
          const text = rect("#sync-card .sync-text"), btn = rect("#sync-now-btn");
          return { sameRow: Math.abs(text.top - btn.top) < 20, overlap: text.right > btn.left + 1 };
        });
        t.ok(!(r.sameRow && r.overlap), `${w}px: texto sobreposto ao botão`);
      }
    },
  },
  {
    name: "avatar do jogador é o deck com mais jogos",
    async run(t) {
      const page = await t.page();
      const P = seedProfiles();
      const art = { Atraxa: "./icons/icon-512.png", Meren: "./icons/icon-192.png" };
      P.forEach((d) => { d.commander = art[d.name] ? { name: d.name, art: art[d.name], colorIdentity: ["B", "G"] } : null; });
      const meren = P.find((d) => d.name === "Meren");
      for (let k = 0; k < 14; k++) meren.history.push({ id: "bj" + k, date: Date.now() - k * 1000, won: false, mode: "standard", playedBy: "Joana" });
      meren.stats.games += 14;
      await openWith(t, page, P);
      await goProfiles(page, "players");
      const av = await page.$$eval(".player-card", (x) => Object.fromEntries(x.map((e) => [e.querySelector(".profile-name").textContent, e.querySelector(".player-avatar").getAttribute("title") || ""])));
      t.eq([av.Ana, av.Joana, av.Rui], ["Atraxa", "Meren", ""], "avatares");
      await page.click('.seg-btn[data-tab="decks"]');
      t.ok(await page.$$eval("#profiles-list .pip svg.mana-sym", (x) => x.length) >= 4, "símbolos de mana desenhados");
    },
  },
];

module.exports.push({
  name: "perfil do jogador com os mesmos números do deck",
  async run(t) {
    const page = await t.page();
    await openWith(t, page, seedProfiles());
    await goProfiles(page, "players");
    await page.click('.player-card:has-text("Ana")');
    await page.waitForSelector(".pd-kpis");
    const kpis = await page.$$eval(".pd-kpis .kpi", (x) => x.map((e) => e.querySelector(".kpi-label").textContent + "=" + e.querySelector(".kpi-value").textContent.trim()));
    t.eq(kpis, ["Jogos=18", "Vitórias=9 50%", "Média por jogo=50:00", "Média por turno=01:00"], "números-resumo");
    const titles = await page.$$eval(".chart-title", (x) => x.map((e) => e.textContent));
    for (const want of ["Classificação ELO", "Forma recente", "Evolução da taxa de vitórias", "Decks de Ana", "Resultados por modo", "Confrontos diretos", "Duração dos jogos"]) t.ok(titles.includes(want), "falta o cartão " + want);
    t.ok(await page.isVisible(".streak-card"), "sequência");
    t.eq(await page.$$eval("#history-list .hist-row:not(.hidden)", (x) => x.length), 10, "mostra 10 jogos");
    await page.click("#history-more");
    t.eq(await page.$$eval("#history-list .hist-row:not(.hidden)", (x) => x.length), 18, "ver todos");
    t.ok((await page.$eval("#history-list .hist-row", (e) => e.textContent)).match(/Atraxa|Meren/), "cada jogo diz o deck");
    // a forma recente cabe numa linha no telemóvel
    const rowsUsed = await page.$$eval(".form-strip .form-chip", (x) => new Set(x.map((e) => Math.round(e.getBoundingClientRect().top))).size);
    t.eq(rowsUsed, 1, "forma recente numa linha");
  },
});
