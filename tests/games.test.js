/* Registar um jogo à mão e editar um jogo do histórico. */
const { seedProfiles, openWith, stored, goProfiles } = require("./helpers");

const lastOf = (list, name) => list.find((p) => p.name === name).history.slice().sort((a, b) => b.date - a.date)[0];
const avg = (page, name) => page.evaluate((n) => MTG.Profiles.derived(MTG.Profiles.all().find((p) => p.name === n)).avgGameTimeMs, name);

/** No formulário aberto: escolhe o deck do lugar i. */
async function pickSeatDeck(page, i, name) {
  await page.click(`.mg-seat[data-i="${i}"] [data-pick]`);
  await page.click(`#pp-list .search-result-item:has(.name:text-is("${name}"))`);
  await page.waitForSelector("#pp-list", { state: "detached" });
}

module.exports = [
  {
    name: "registar um jogo à mão sem tempo",
    async run(t) {
      const page = await t.page();
      await openWith(t, page, seedProfiles());
      const avgBefore = await avg(page, "Atraxa");
      await goProfiles(page);
      await page.click("#manual-game-btn");
      await page.waitForSelector(".game-sheet");
      await pickSeatDeck(page, 0, "Atraxa");
      t.eq(await page.inputValue('.mg-seat[data-i="0"] .mg-who'), "Ana", "quem jogou começa no dono");
      await pickSeatDeck(page, 1, "Krenko");
      await page.fill('.mg-seat[data-i="2"] .mg-who', "Zé");
      await page.click('.mg-seat[data-i="3"] [data-del]');
      // sem vencedor não grava
      await page.click("#mg-save");
      t.ok(await page.isVisible(".game-sheet"), "pede o vencedor");
      await page.click('.mg-seat[data-i="1"] [data-win]');
      t.ok(!(await page.isChecked("#mg-timed")), "tempo desligado por defeito");
      await page.click("#mg-save");
      await page.waitForSelector(".game-sheet", { state: "detached" });
      const list = await stored(page);
      const manualOf = (n) => list.find((p) => p.name === n).history.find((g) => g.manual);
      const a = manualOf("Atraxa"), k = manualOf("Krenko");
      t.eq([a.manual, a.timed, a.gameTimeMs, a.won, k.won], [true, false, 0, false, true], "registos dos dois decks");
      t.ok(a.opponents.some((o) => !o.profileId && o.name === "Zé"), "convidado fica como adversário");
      t.ok(Math.abs(a.date - k.date) < 1000, "mesmo jogo nos dois decks");
      t.eq(await avg(page, "Atraxa"), avgBefore, "jogo sem tempo não muda a média de tempo");
      const games = await page.evaluate(() => MTG.Elo.compute(MTG.Profiles.all()).games);
      t.eq(games, 19, "conta para a classificação");
    },
  },
  {
    name: "registar com duração e a partir do deck",
    async run(t) {
      const page = await t.page();
      await openWith(t, page, seedProfiles());
      await goProfiles(page);
      await page.click('#decks-view .profile-card:has-text("Meren")');
      await page.click("#pd-manual-btn");
      t.eq(await page.$eval('.mg-seat[data-i="0"] .mg-deck-name', (e) => e.textContent), "Meren", "deck já escolhido");
      await pickSeatDeck(page, 1, "Yuriko");
      await page.click('.mg-seat[data-i="0"] [data-win]');
      await page.check("#mg-timed");
      await page.click("#mg-save");
      t.ok(await page.isVisible(".game-sheet"), "pede a duração");
      await page.fill("#mg-minutes", "40");
      await page.click("#mg-save");
      await page.waitForSelector(".game-sheet", { state: "detached" });
      const m = (await stored(page)).find((p) => p.name === "Meren").history.find((g) => g.manual);
      t.eq([m.timed, m.gameTimeMs, m.won], [true, 2400000, true], "jogo com tempo");
      t.ok((await page.$eval("#history-list .cd-list-item", (e) => e.textContent)).includes("Registado à mão"), "histórico mostra que foi à mão");
    },
  },
  {
    name: "editar vencedor e quem jogou em todos os decks do jogo",
    async run(t) {
      const page = await t.page();
      await openWith(t, page, seedProfiles());
      const before = await stored(page);
      const winsOf = (list, n) => list.find((p) => p.name === n).stats.wins;
      // último jogo da Atraxa: a1 t1 p1 j1, ganhou a Joana (Muldrotha)
      await goProfiles(page);
      await page.click('#decks-view .profile-card:has-text("Atraxa")');
      await page.click("#history-list [data-edit] >> nth=0");
      await page.waitForSelector(".game-sheet");
      t.eq(await page.$$eval(".mg-seat", (x) => x.length), 4, "os 4 decks do jogo");
      t.eq(await page.$eval(".mg-seat.won .mg-deck-name", (e) => e.textContent), "Muldrotha", "vencedor atual");
      await page.click('.mg-seat[data-i="0"] [data-win]');
      await page.fill('.mg-seat[data-i="0"] .mg-who', "Tiago");
      await page.click("#mg-save");
      await page.waitForSelector(".game-sheet", { state: "detached" });
      const after = await stored(page);
      const a = lastOf(after, "Atraxa"), j = lastOf(after, "Muldrotha");
      t.eq([a.won, a.playedBy, j.won], [true, "Tiago", false], "jogo corrigido");
      t.eq([winsOf(after, "Atraxa") - winsOf(before, "Atraxa"), winsOf(after, "Muldrotha") - winsOf(before, "Muldrotha")], [1, -1], "vitórias acertadas");
      t.ok(j.opponents.find((o) => o.profileId === "a1").won && j.opponents.find((o) => o.profileId === "a1").pilot === "Tiago", "adversários atualizados");
      t.ok(a.editedAt > 0, "marca a correção para sincronizar");
      // outro aparelho com os dados antigos recebe a correção e acerta as vitórias
      const synced = await page.evaluate((old) => {
        const payload = MTG.Profiles.syncPayload();
        localStorage.setItem("mtg_lc_profiles_v1", old);
        MTG.Profiles.syncMerge(payload);
        const L = MTG.Profiles.all();
        return [L.find((p) => p.name === "Atraxa").stats.wins, L.find((p) => p.name === "Muldrotha").stats.wins];
      }, JSON.stringify(before));
      t.eq(synced, [winsOf(after, "Atraxa"), winsOf(after, "Muldrotha")], "vitórias iguais no outro aparelho");
    },
  },
];
