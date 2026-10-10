/* Teclado do iPhone/iPad: a área visível encolhe (visualViewport) e os
 * resultados da pesquisa de commander têm de ficar acima do teclado. */
const { openWith } = require("./helpers");

const CARDS = ["Atraxa, Praetors' Voice", "Atraxa, Grand Unifier", "Atarka, World Render", "Arahbo, Roar of the World", "Anafenza, Kin-Tree Spirit", "Atla Palani, Nest Tender"];

module.exports = [
  {
    name: "resultados da pesquisa visíveis acima do teclado",
    async run(t) {
      for (const [w, h, kb] of [[390, 844, 336], [820, 1180, 400]]) {
        const page = await t.page({ viewport: { width: w, height: h }, hasTouch: true });
        await page.route(/api\.scryfall\.com/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: CARDS.map((n, i) => ({ id: "c" + i, name: n, type_line: "Legendary Creature", image_uris: { art_crop: "./icons/icon-192.png" }, color_identity: ["W"] })) }) }));
        await page.addInitScript(([H, KB]) => {
          const fake = new EventTarget();
          fake.height = H; fake.offsetTop = 0; fake.width = innerWidth;
          Object.defineProperty(window, "visualViewport", { get: () => fake });
          window.__kb = (open) => { fake.height = open ? H - KB : H; fake.dispatchEvent(new Event("resize")); };
        }, [h, kb]);
        await openWith(t, page, null);
        await page.click(".mode-card.commander");
        if (await page.$("#qs-setup")) await page.click("#qs-setup");
        await page.click('.player-setup-card .commander-thumb[data-role="main"] >> nth=0');
        await page.evaluate(() => window.__kb(true));
        await page.fill("#cp-input", "atra");
        await page.waitForSelector("#cp-results .search-result-item");
        const visible = await page.evaluate((KB) => [...document.querySelectorAll("#cp-results .search-result-item")]
          .filter((e) => { const b = e.getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight - KB + 1; }).length, kb);
        t.ok(visible >= 3, `${w}px: só ${visible} resultados visíveis acima do teclado`);
        t.ok(!(await page.isVisible("#cp-cancel")), `${w}px: botões de baixo escondidos enquanto se escreve`);
        await page.evaluate(() => window.__kb(false));
        t.ok(await page.isVisible("#cp-cancel"), `${w}px: botões voltam ao fechar o teclado`);
      }
    },
  },
];
