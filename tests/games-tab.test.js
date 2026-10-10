/* Separador "Jogos": lista de todos os jogos, editar, apagar e ligar um
 * lugar sem deck a um deck. */
const { seedProfiles, openWith, stored, goProfiles } = require("./helpers");

module.exports = [
  {
    name: "lista, ligar convidado a um deck e apagar",
    async run(t) {
      const page = await t.page();
      await openWith(t, page, seedProfiles());
      // jogo à mão com um convidado sem deck (o Zé) que ganhou
      await page.evaluate(() => {
        const L = MTG.Profiles.all(), id = (n) => L.find((p) => p.name === n).id;
        MTG.Profiles.recordManualGame({ date: Date.now(), mode: "commander", timed: false, winner: 2,
          seats: [{ profileId: id("Atraxa"), name: "Ana" }, { profileId: id("Krenko"), name: "Rui" }, { profileId: null, name: "Zé" }] });
      });
      await goProfiles(page, "games");
      t.eq(await page.textContent("#games-view .section-title"), "19 jogo(s)", "jogos agrupados (18 + 1)");
      const first = await page.$eval(".gl-game", (e) => e.textContent.replace(/\s+/g, " "));
      t.ok(first.includes("Atraxa") && first.includes("Krenko") && first.includes("Zé") && first.includes("sem deck"), "primeiro jogo: " + first);
      // ligar o Zé ao deck Meren (que não estava no jogo)
      await page.click(".gl-attach");
      await page.click('#pp-list .search-result-item:has(.name:text-is("Meren"))');
      await page.waitForTimeout(300);
      const L = await stored(page);
      const mer = L.find((p) => p.name === "Meren");
      const e = mer.history.find((g) => g.manual);
      t.eq([!!e, e && e.won, e && e.playedBy, mer.stats.games], [true, true, "Zé", 7], "jogo acrescentado à Meren (emprestada ao Zé)");
      const atx = L.find((p) => p.name === "Atraxa").history.find((g) => g.manual);
      t.ok(atx.opponents.some((o) => o.profileId === mer.id && o.won), "Atraxa vê a Meren como adversária vencedora");
      t.ok(!(await page.$eval(".gl-game", (x) => x.textContent)).includes("sem deck"), "o convidado passou a deck");
      // apagar o jogo inteiro (todos os decks)
      await page.click(".gl-game [data-del-g]");
      await page.waitForTimeout(200);
      const L2 = await stored(page);
      t.ok(!L2.some((p) => p.history.some((g) => g.manual)), "jogo apagado em todos os decks");
      t.eq(await page.textContent("#games-view .section-title"), "18 jogo(s)", "lista atualizada");
    },
  },
  {
    name: "editar a partir do separador abre o jogo inteiro",
    async run(t) {
      const page = await t.page();
      await openWith(t, page, seedProfiles());
      await goProfiles(page, "games");
      await page.click(".gl-game [data-edit-g]");
      await page.waitForSelector(".game-sheet");
      t.eq(await page.$$eval(".mg-seat", (x) => x.length), 4, "4 decks do último jogo");
    },
  },
];
