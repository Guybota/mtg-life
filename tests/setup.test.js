/* Setup: sugestões de perfis em cada lugar. */
const { seedProfiles, openWith } = require("./helpers");

function manyProfiles() {
  const P = seedProfiles();
  ["Kinnan", "Korvold", "Prossh", "Najeela"].forEach((n, k) => P.push(Object.assign(JSON.parse(JSON.stringify(P[2])), { id: "x" + k, name: n, playerName: "Rui", history: [], createdAt: Date.now() - k * 1000 })));
  return P;
}
async function openSetup(t, size) {
  const page = await t.page({ viewport: size });
  await openWith(t, page, manyProfiles());
  await page.click(".mode-card.commander");
  if (await page.$("#qs-setup")) await page.click("#qs-setup");
  await page.waitForSelector(".player-setup-card");
  return page;
}
const visibleChips = (page, i) => page.$$eval(".player-setup-card", (cards, i) => [...cards[i].querySelectorAll(".recent-chip")].filter((c) => getComputedStyle(c).display !== "none").map((c) => c.querySelector(".recent-name").firstChild.textContent), i);

module.exports = [
  {
    name: "mais sugestões em ecrãs maiores",
    async run(t) {
      for (const [w, h, n] of [[390, 844, 3], [820, 1180, 6], [1180, 820, 8]]) {
        const page = await openSetup(t, { width: w, height: h });
        t.eq((await visibleChips(page, 0)).length, n, `${w}px`);
      }
      const page = await openSetup(t, { width: 1180, height: 820 });
      t.eq(await page.$eval(".player-setup-list", (e) => getComputedStyle(e).gridTemplateColumns.split(" ").length), 2, "lugares em duas colunas no iPad deitado");
    },
  },
  {
    name: "decks do jogador escrito no lugar aparecem primeiro",
    async run(t) {
      const page = await openSetup(t, { width: 390, height: 844 });
      await (await (await page.$$(".player-setup-card"))[0].$(".name-input")).fill("Rui");
      const chips = await visibleChips(page, 0);
      t.eq(chips.length, 3, "3 sugestões");
      const owners = await page.evaluate((names) => names.map((n) => MTG.Profiles.all().find((p) => p.name === n).playerName), chips);
      t.eq(owners, ["Rui", "Rui", "Rui"], "só decks do Rui: " + chips.join(", "));
    },
  },
];
