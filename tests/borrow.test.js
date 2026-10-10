/* Dono do deck, decks emprestados e commanders alternativos. */
const { seedProfiles, openWith, stored, goProfiles, pickProfile, startGame, endGame } = require("./helpers");

module.exports = [
  {
    name: "jogo com deck emprestado e commander alternativo",
    async run(t) {
      const page = await t.page();
      const P = seedProfiles();
      const atx = P.find((p) => p.name === "Atraxa");
      atx.commander = { name: "Atraxa, Praetors' Voice" };
      atx.altCommanders = [{ name: "Tymna the Weaver" }];
      await openWith(t, page, P);
      await page.click(".mode-card.commander");
      if (await page.$("#qs-setup")) await page.click("#qs-setup");
      const card = async (i) => (await page.$$(".player-setup-card"))[i];

      await (await (await card(0)).$(".name-input")).fill("Rui");
      await pickProfile(page, 0, "Atraxa");
      t.eq(await (await (await card(0)).$(".name-input")).inputValue(), "Rui", "nome escrito mantém-se");
      t.ok((await (await card(0)).$eval(".seat-extras", (e) => e.textContent)).includes("Deck emprestado por Ana"), "aviso de empréstimo");
      await (await (await card(0)).$('.alt-chip:has-text("Tymna")')).click();
      t.eq(await (await card(0)).$eval(".commander-name", (e) => e.textContent), "Tymna the Weaver", "commander alternativo escolhido");

      await pickProfile(page, 1, "Edgar Markov");
      t.eq(await (await (await card(1)).$(".name-input")).inputValue(), "Tiago", "lugar vazio fica com o dono");
      await pickProfile(page, 2, "Yuriko");
      await (await (await card(3)).$(".name-input")).fill("Joana");
      await startGame(page);
      await endGame(page, "Rui");

      const list = await stored(page);
      const last = (name) => list.find((p) => p.name === name).history.slice().sort((a, b) => b.date - a.date)[0];
      t.eq([last("Atraxa").playedBy, last("Atraxa").commander, last("Atraxa").won], ["Rui", "Tymna the Weaver", true], "registo do deck emprestado");
      t.eq(last("Edgar Markov").playedBy, undefined, "dono a jogar não fica como emprestado");
      t.ok(last("Edgar Markov").opponents.some((o) => o.pilot === "Rui"), "adversário guarda quem jogou");

      await page.goto(t.url);
      await goProfiles(page, "players");
      await page.click('.player-card:has-text("Rui")');
      t.ok((await page.$$eval(".section-title", (x) => x.map((e) => e.textContent))).includes("Decks de outros com que jogou"), "Rui vê o deck emprestado");
      await page.click("#back-btn");
      await page.click('.seg-btn[data-tab="decks"]');
      await page.click('#decks-view .profile-card:has-text("Atraxa")');
      const titles = await page.$$eval(".chart-title", (x) => x.map((e) => e.textContent));
      t.ok(titles.includes("Por commander") && titles.includes("Emprestado a outros"), "cartões do deck: " + titles.join(", "));
      const first = await page.$eval("#history-list .cd-list-item", (e) => e.textContent.replace(/\s+/g, " "));
      t.ok(first.includes("Rui") && first.includes("emprestado") && first.includes("Com Tymna"), "histórico mostra quem jogou: " + first);
    },
  },
  {
    name: "trocar o dono não muda quem jogou",
    async run(t) {
      const page = await t.page();
      const P = seedProfiles();
      const atx = P.find((p) => p.name === "Atraxa");
      atx.history[0].playedBy = "Rui";
      await openWith(t, page, P);
      const elo = () => page.evaluate(() => MTG.Elo.compute(JSON.parse(localStorage.getItem("mtg_lc_profiles_v1"))).players.map((r) => r.name + ":" + r.games).sort().join(" "));
      const before = await elo();
      const setOwner = async (name) => {
        await page.goto(t.url);
        await goProfiles(page);
        await page.click('#decks-view .profile-card:has-text("Atraxa")');
        await page.click("#edit-profile-btn");
        await page.fill("#epf-player", name);
        await page.click("#epf-save");
        await page.waitForSelector(".modal-backdrop", { state: "detached" });
      };
      await setOwner("Tiago");
      let a = (await stored(page)).find((p) => p.name === "Atraxa");
      t.eq(a.playerName, "Tiago", "novo dono");
      t.eq(a.history.filter((g) => g.playedBy === "Ana").length, 11, "jogos da Ana passam a emprestados");
      t.eq(a.history.filter((g) => g.playedBy === "Rui").length, 1, "jogo do Rui fica do Rui");
      t.eq(await elo(), before, "jogos por jogador não mudam");
      await setOwner("Rui");
      a = (await stored(page)).find((p) => p.name === "Atraxa");
      t.eq(a.history.filter((g) => !g.playedBy).length, 1, "jogo do Rui deixa de ser emprestado");
      t.eq(await elo(), before, "jogos por jogador continuam iguais");
    },
  },
];
