/* Classificação ELO e ligas. */
const { seedProfiles, openWith } = require("./helpers");

module.exports = [
  {
    name: "pontos conservados e ordem coerente",
    async run(t) {
      const page = await t.page();
      await openWith(t, page, seedProfiles());
      const r = await page.evaluate(() => {
        const e = MTG.Elo.compute(JSON.parse(localStorage.getItem("mtg_lc_profiles_v1")));
        return { games: e.games, decks: e.decks.map((d) => d.rating), players: e.players.map((p) => [p.name, p.games]) };
      });
      t.eq(r.games, 18, "jogos contados");
      const sum = r.decks.reduce((a, b) => a + b, 0);
      t.ok(Math.abs(sum - 1500 * r.decks.length) <= r.decks.length, `soma dos pontos dos decks ${sum}`);
      t.ok(r.decks.every((x, i) => i === 0 || r.decks[i - 1] >= x), "decks ordenados por pontos");
      t.eq(Object.fromEntries(r.players), { Ana: 18, Tiago: 15, Joana: 12, Rui: 13, Pedro: 13 }, "jogos por jogador");
    },
  },
  {
    name: "divisões das ligas",
    async run(t) {
      const page = await t.page();
      await openWith(t, page, null);
      const out = await page.evaluate(() => [1380, 1400, 1420, 1440, 1474, 1490, 1540, 1600, 1700].map((r) => { const d = MTG.Elo.divisionOf(r, 10); return `${r}:${d.league}${d.division}:${d.next}`; }).concat([MTG.Elo.divisionOf(1600, 2).league]));
      t.eq(out, ["1380:bronze3:20", "1400:bronze2:20", "1420:bronze1:20", "1440:silver3:17", "1474:silver1:16", "1490:gold3:17", "1540:platinum3:20", "1600:diamond3:40", "1700:diamond1:null", "provisional"]);
    },
  },
  {
    name: "deck emprestado conta para quem jogou",
    async run(t) {
      const page = await t.page();
      const P = seedProfiles();
      P.find((p) => p.name === "Atraxa").history.forEach((g) => { g.playedBy = "Rui"; });
      await openWith(t, page, P);
      const players = await page.evaluate(() => Object.fromEntries(MTG.Elo.compute(JSON.parse(localStorage.getItem("mtg_lc_profiles_v1"))).players.map((p) => [p.name, p.games])));
      t.eq(players.Ana, 6, "Ana fica só com os jogos da Meren");
      t.ok(players.Rui > 13, "Rui ganha os jogos com a Atraxa");
    },
  },
];
