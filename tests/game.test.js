/* Contador: jogo rápido, vida, ecrã inteiro, fim de jogo e outros modos. */
const { seedProfiles, openWith, stored, pickProfile, startGame, endGame } = require("./helpers");

const lifeOf = (page, i) => page.evaluate((i) => JSON.parse(localStorage.getItem("mtg_lc_game_v2")).standard.players[i].life, i);

module.exports = [
  {
    name: "Commander: vida, ecrã inteiro e resultado nos perfis",
    async run(t) {
      const page = await t.page({ viewport: { width: 1180, height: 820 }, hasTouch: true });
      await openWith(t, page, seedProfiles());
      await page.click(".mode-card.commander");
      if (await page.$("#qs-setup")) await page.click("#qs-setup");
      await pickProfile(page, 0, "Krenko");
      await pickProfile(page, 1, "Yuriko");
      await startGame(page);
      const before = await lifeOf(page, 0);
      await (await (await page.$$(".player-panel"))[0].$(".life-tap.minus")).click();
      t.eq(await lifeOf(page, 0), before - 1, "toque no − tira 1 vida");
      await page.click("#fullscreen-btn");
      await page.waitForSelector(".fs-hub");
      const chips = await page.$$eval(".fs-hub > *", (x) => x.filter((e) => getComputedStyle(e).display !== "none" && !e.textContent.trim() && !e.querySelector("svg")).length);
      t.eq(chips, 0, "nenhum chip vazio na barra do ecrã inteiro");
      await page.click("#fullscreen-exit-btn");
      const games = (await stored(page)).find((p) => p.name === "Krenko").stats.games;
      await endGame(page, "Rui");
      const k = (await stored(page)).find((p) => p.name === "Krenko");
      t.eq([k.stats.games, k.stats.wins > 0, k.history.slice().sort((a, b) => b.date - a.date)[0].won], [games + 1, true, true], "vitória registada no deck");
    },
  },
  {
    name: "Battle Royale e Equipas começam sem erros",
    async run(t) {
      const page = await t.page({ viewport: { width: 1180, height: 820 }, hasTouch: true });
      await openWith(t, page, null);
      await page.click(".mode-card.br");
      await page.click("#start-btn");
      const who = await page.waitForSelector(".modal-sheet .cd-list-item", { timeout: 1500 }).catch(() => null);
      if (who) await who.click();
      await page.waitForSelector(".br-status-row, .player-panel, .br-row", { timeout: 3000 });
      await page.goto(t.url);
      await page.click(".mode-card.teams");
      await page.click("#start-btn");
      const who2 = await page.waitForSelector(".modal-sheet .cd-list-item", { timeout: 1500 }).catch(() => null);
      if (who2) await who2.click();
      await page.waitForSelector(".player-panel, .team-panel", { timeout: 3000 });
    },
  },
];
