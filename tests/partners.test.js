/* Partners: no deck principal e nos commanders alternativos. */
const { seedProfiles, openWith, stored, goProfiles, pickProfile, startGame, endGame } = require("./helpers");

const CARDS = {
  thra: { name: "Thrasios, Triton Hero", ci: ["G", "U"] },
  kra: { name: "Kraum, Ludevic's Opus", ci: ["U", "R"] },
  ikr: { name: "Ikra Shidiqi, the Usurper", ci: ["B", "G"] },
};
async function mockScryfall(page) {
  await page.route(/api\.scryfall\.com/, (route) => {
    const q = decodeURIComponent(new URL(route.request().url()).searchParams.get("q") || "").toLowerCase();
    const key = Object.keys(CARDS).find((k) => q.includes(k));
    const c = key ? CARDS[key] : null;
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: c ? [{ id: key, name: c.name, type_line: "Legendary Creature", image_uris: { art_crop: "./icons/icon-192.png" }, color_identity: c.ci }] : [] }) });
  });
}
async function pickCard(page, query) {
  await page.waitForSelector("#cp-input");
  await page.fill("#cp-input", query);
  await page.click("#cp-results .search-result-item");
  await page.waitForSelector("#cp-input", { state: "detached" });
}

module.exports = [
  {
    name: "parceiro no principal e nos alternativos, escolhido no setup",
    async run(t) {
      const page = await t.page();
      await mockScryfall(page);
      const P = seedProfiles();
      const atx = P.find((p) => p.name === "Atraxa");
      atx.commander = { name: "Tymna the Weaver", colorIdentity: ["W", "B"] };
      await openWith(t, page, P);
      await goProfiles(page);
      await page.click('#decks-view .profile-card:has-text("Atraxa")');
      await page.click("#edit-profile-btn");
      await page.click("#epf-partner");
      await pickCard(page, "thra");
      t.eq(await page.textContent("#epf-cmd-name"), "Tymna the Weaver + Thrasios, Triton Hero", "par principal");
      await page.click("#epf-alt-add");
      await pickCard(page, "kra");
      await page.click('[data-alt-partner="0"]');
      await pickCard(page, "ikr");
      t.eq(await page.textContent(".alt-row .alt-name"), "Kraum, Ludevic's Opus + Ikra Shidiqi, the Usurper", "par alternativo");
      await page.click("#epf-save");
      await page.waitForSelector(".modal-backdrop", { state: "detached" });
      const a = (await stored(page)).find((p) => p.name === "Atraxa");
      t.eq([a.partnerCommander.name, a.altCommanders[0].name, a.altCommanders[0].partner.name], ["Thrasios, Triton Hero", "Kraum, Ludevic's Opus", "Ikra Shidiqi, the Usurper"], "gravado no deck");
      t.eq(await page.$$eval(".pd-hero .pip", (x) => x.length), 4, "identidade de cor junta o parceiro (W U B G)");

      // setup: o par principal vem com o deck; o alternativo troca os dois
      await page.goto(t.url);
      await page.click(".mode-card.commander");
      if (await page.$("#qs-setup")) await page.click("#qs-setup");
      await pickProfile(page, 0, "Atraxa");
      const card0 = async () => (await page.$$(".player-setup-card"))[0];
      t.eq(await (await card0()).$eval(".commander-name", (e) => e.textContent), "Tymna the Weaver + Thrasios, Triton Hero", "par principal no lugar");
      await (await (await card0()).$('.alt-chip:has-text("Kraum")')).click();
      t.eq(await (await card0()).$eval(".commander-name", (e) => e.textContent), "Kraum, Ludevic's Opus + Ikra Shidiqi, the Usurper", "par alternativo no lugar");
      await pickProfile(page, 1, "Krenko");
      await startGame(page);
      await endGame(page, "Ana");
      const last = (await stored(page)).find((p) => p.name === "Atraxa").history.slice().sort((x, y) => y.date - x.date)[0];
      t.eq([last.commander, last.won], ["Kraum, Ludevic's Opus + Ikra Shidiqi, the Usurper", true], "jogo guarda o par");
    },
  },
  {
    name: "criar deck com parceiro no seletor",
    async run(t) {
      const page = await t.page();
      await mockScryfall(page);
      await openWith(t, page, seedProfiles());
      await goProfiles(page);
      await page.click("#manual-game-btn");
      await page.click('.mg-seat[data-i="0"] [data-pick]');
      await page.click("#pp-new");
      await pickCard(page, "kra");
      await page.click("#pp-new-partner");
      await pickCard(page, "ikr");
      t.eq(await page.inputValue("#pp-new-name"), "Kraum, Ludevic's Opus + Ikra Shidiqi, the Usurper", "nome sugerido com o par");
      await page.click("#pp-new-confirm");
      await page.waitForSelector("#pp-list", { state: "detached" });
      const p = (await stored(page)).find((x) => x.commander && x.commander.name.startsWith("Kraum"));
      t.eq(p.partnerCommander && p.partnerCommander.name, "Ikra Shidiqi, the Usurper", "perfil novo com parceiro");
    },
  },
];
