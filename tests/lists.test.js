/* Listas e grelhas: nenhuma linha fica esmagada quando há mais conteúdo
 * do que cabe (a lista faz scroll em vez de encolher as linhas). */
const { seedProfiles, openWith } = require("./helpers");

// elementos dentro de uma coluna flex com o conteúdo maior do que a altura
const squashed = (page) => page.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => {
  const p = e.parentElement;
  if (!p) return false;
  const ps = getComputedStyle(p);
  if (!ps.display.includes("flex") || !ps.flexDirection.startsWith("column")) return false;
  const s = getComputedStyle(e);
  if (s.display === "none" || s.position === "absolute" || s.position === "fixed" || ["auto", "scroll"].includes(s.overflowY) || s.webkitLineClamp !== "none") return false;
  return e.getBoundingClientRect().height > 0 && e.scrollHeight > e.clientHeight + 3;
}).map((e) => e.className + " " + e.clientHeight + "<" + e.scrollHeight));

const PHONES = { iphone: { width: 390, height: 844 }, android: { width: 412, height: 915 } };

module.exports = [
  {
    name: "pesquisa de commander com muitos resultados",
    async run(t) {
      for (const [dev, vp] of Object.entries(PHONES)) {
        const page = await t.page({ viewport: vp, hasTouch: true, isMobile: true });
        await page.route(/api\.scryfall\.com/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: Array.from({ length: 20 }, (_, i) => ({ id: "c" + i, name: "Commander " + i, type_line: "Legendary Creature — Phyrexian Angel Horror", image_uris: { art_crop: "./icons/icon-192.png" }, color_identity: ["W"], prints_search_uri: "https://api.scryfall.com/x" })) }) }));
        await openWith(t, page, seedProfiles());
        await page.click(".mode-card.commander");
        if (await page.$("#qs-setup")) await page.click("#qs-setup");
        await page.click(".player-setup-card >> nth=0 >> .seat-deck-btn");
        await page.click("#ds-cmd");
        await page.fill("#cp-input", "comm");
        await page.waitForSelector("#cp-results .search-result-item");
        t.eq(await squashed(page), [], dev);
      }
    },
  },
  {
    name: "Battle Royale e menu no telemóvel",
    async run(t) {
      for (const [dev, vp] of Object.entries(PHONES)) {
        const page = await t.page({ viewport: vp, hasTouch: true, isMobile: true });
        await openWith(t, page, seedProfiles());
        await page.click(".mode-card.br");
        await page.click("#start-btn");
        const who = await page.waitForSelector(".modal-sheet .cd-list-item", { timeout: 1500 }).catch(() => null);
        if (who) await who.click();
        await page.waitForSelector(".br-players");
        t.eq(await squashed(page), [], dev + " Battle Royale");
        const land = await t.page({ viewport: { width: vp.height, height: vp.width }, hasTouch: true, isMobile: true });
        await openWith(t, land, seedProfiles());
        await land.waitForTimeout(700); // animação de entrada dos cartões
        t.eq(await squashed(land), [], dev + " menu deitado");
      }
    },
  },
];
