/* Setup: quem joga (fichas), o deck de cada lugar (folha) e as janelas
 * de escolher commander, arte e deck novo. */
const { seedProfiles, openWith, pickProfile, tapPlayer } = require("./helpers");

async function openSetup(t, mode, size) {
  const page = await t.page({ viewport: size || { width: 390, height: 844 } });
  await openWith(t, page, seedProfiles());
  await page.click(".mode-card." + (mode || "commander"));
  if (await page.$("#qs-setup")) await page.click("#qs-setup");
  await page.waitForSelector(".player-setup-card");
  return page;
}
const seats = (page) => page.$$eval(".player-setup-card", (cards) => cards.map((c) => [c.querySelector(".seat-who.empty") ? "" : c.querySelector(".seat-who").textContent, c.querySelector(".seat-deck-btn.empty") ? "" : c.querySelector(".seat-deck-btn").textContent.trim()]));

function mockScryfall(page, url) {
  const card = (n, i) => ({ id: "c" + i, name: n, type_line: "Legendary Creature", image_uris: { art_crop: url + "icons/icon-192.png" }, color_identity: ["W"], prints_search_uri: "https://api.scryfall.com/cards/search?prints=" + i, set_name: "Set " + i, set: "s" + i, artist: "Artista " + i, collector_number: String(i) });
  const names = ["Atraxa, Praetors' Voice", "Atraxa, Grand Unifier", "Atarka, World Render", "Arahbo, Roar of the World", "Anafenza, Kin-Tree Spirit"];
  // edições: a mesma carta em vários sets
  return page.route(/api\.scryfall\.com/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: r.request().url().includes("prints=") ? names.map((_, i) => card(names[0], i)) : names.map(card) }) }));
}

module.exports = [
  {
    name: "tocar num jogador senta-o com o último deck; tocar outra vez levanta-o",
    async run(t) {
      const page = await openSetup(t);
      await tapPlayer(page, "Rui");
      await tapPlayer(page, "Ana");
      const last = await page.evaluate(() => {
        const g = MTG.Profiles.all().flatMap((p) => p.history.map((h) => [h.date, p])).filter(([, p]) => p.playerName === "Ana").sort((a, b) => b[0] - a[0])[0];
        return g[1].name;
      });
      t.eq((await seats(page)).slice(0, 3), [["Rui", "Krenko"], ["Ana", last], ["", ""]], "sentados por ordem, com o último deck");
      t.eq(await page.$eval('#roster [data-player="Ana"]', (b) => [b.getAttribute("aria-pressed"), b.textContent.trim()]), ["true", "2Ana"], "ficha mostra o lugar");
      await tapPlayer(page, "Rui");
      t.eq((await seats(page))[0], ["", ""], "lugar fica livre na mesma posição");
      t.eq((await seats(page)).length, 4, "nº de lugares mantém-se");
      await tapPlayer(page, "Tiago");
      t.eq((await seats(page))[0][0], "Tiago", "próximo jogador ocupa o lugar livre");
    },
  },
  {
    name: "folha de decks: os do jogador primeiro, os outros emprestados",
    async run(t) {
      const page = await openSetup(t);
      await tapPlayer(page, "Ana");
      await tapPlayer(page, "Rui");
      await (await (await page.$$(".player-setup-card"))[1].$(".seat-deck-btn")).click();
      const rows = await page.$$eval("#ds-list > *", (x) => x.map((e) => (e.classList.contains("deck-sec") ? "#" + e.textContent : e.querySelector(".name").textContent + (e.querySelector(".deck-pill") ? "[" + [...e.querySelectorAll(".deck-pill")].map((p) => p.textContent).join(",") + "]" : ""))));
      t.eq(rows[0], "#Decks de Rui", "secção do jogador primeiro: " + rows.join(" | "));
      t.ok(rows.includes("Krenko[último]"), "deck atual marcado como último: " + rows.join(" | "));
      t.ok(rows.some((r) => /^(Atraxa|Meren)\[lugar 1\]$/.test(r)), "deck sentado noutro lugar: " + rows.join(" | "));
      t.ok(rows.includes("Yuriko[emprestado]"), "deck de outro é emprestado: " + rows.join(" | "));
      await page.click('#ds-list [data-deck]:has(.name:text-is("Yuriko"))');
      t.eq((await seats(page))[1], ["Rui", "Yuriko"], "Rui joga com o deck do Pedro");
      t.ok((await page.$$eval(".player-setup-card", (c) => c[1].textContent)).includes("Deck emprestado por Pedro"), "aviso de empréstimo");
      await pickProfile(page, 2, "Muldrotha");
      t.eq((await seats(page))[2], ["Joana", "Muldrotha"], "lugar livre fica com o dono do deck");
    },
  },
  {
    name: "lugares: tirar, acrescentar, jogador novo e duelo fixo",
    async run(t) {
      const page = await openSetup(t);
      await page.click(".player-setup-card >> nth=3 >> .seat-remove");
      t.eq((await seats(page)).length, 3, "tirou um lugar");
      await page.click("#roster-add");
      await page.fill("#roster-new-name", "Convidado Zé");
      await page.press("#roster-new-name", "Enter");
      t.eq((await seats(page))[0], ["Convidado Zé", ""], "jogador novo sentado sem deck");
      t.ok(await page.isVisible('#roster [data-player="Convidado Zé"]'), "aparece nas fichas");
      await page.click("#seat-add");
      t.eq((await seats(page)).length, 4, "lugar acrescentado");
      const duel = await openSetup(t, "duel");
      t.eq([(await seats(duel)).length, await duel.$$eval(".seat-remove", (x) => x.length), await duel.isVisible("#seat-add")], [2, 0, false], "duelo: 2 lugares fixos");
    },
  },
  {
    name: "escolher arte em grelha, com as artes num tamanho que se veja",
    async run(t) {
      const page = await openSetup(t);
      await mockScryfall(page, t.url);
      await page.click(".player-setup-card >> nth=0 >> .seat-deck-btn");
      await page.click("#ds-cmd");
      await page.fill("#cp-input", "atra");
      await page.waitForSelector("#cp-results .search-result-item");
      t.ok(await page.isVisible("#cp-results .versions-btn:has-text('Artes')"), "botão de artes com texto");
      const cancel = await page.$eval("#cp-cancel", (b) => [b.getBoundingClientRect().width, b.closest(".modal-sheet").querySelector("#cp-input").getBoundingClientRect().width]);
      t.ok(Math.abs(cancel[0] - cancel[1]) < 2, "Cancelar com a largura toda: " + cancel);
      await page.click("#cp-results .versions-btn >> nth=0");
      await page.waitForSelector("#vp-results .art-tile");
      const w = await page.$eval("#vp-results .art-tile img", (i) => i.getBoundingClientRect().width);
      t.ok(w >= 140, "arte com " + w + "px");
      await page.click("#vp-results .art-tile >> nth=2");
      await page.waitForSelector(".modal-backdrop", { state: "detached" });
      t.eq(await page.evaluate(() => [...document.querySelectorAll(".player-setup-card")][0].textContent.includes("Atraxa, Praetors' Voice")), true, "commander escolhido");
    },
  },
  {
    name: "deck novo: só o formulário, com arte e dono",
    async run(t) {
      const page = await openSetup(t);
      await mockScryfall(page, t.url);
      await tapPlayer(page, "Rui");
      await page.click(".player-setup-card >> nth=0 >> .seat-deck-btn");
      await page.click("#ds-new");
      await page.fill("#cp-input", "atra");
      await page.click("#cp-results .search-result-item >> nth=1");
      t.eq([await page.textContent("#pp-title"), await page.isVisible("#pp-list"), await page.isVisible("#pp-new")], ["Novo deck", false, false], "só o formulário");
      t.ok(await page.isVisible("#pp-new-art"), "pode escolher a arte");
      t.eq([await page.inputValue("#pp-new-name"), await page.inputValue("#pp-new-owner")], ["Atraxa, Grand Unifier", "Rui"], "nome e dono preenchidos");
      await page.click("#pp-new-confirm");
      await page.waitForSelector(".modal-backdrop", { state: "detached" });
      t.eq((await seats(page))[0], ["Rui", "Atraxa, Grand Unifier"], "deck novo no lugar");
    },
  },
];
