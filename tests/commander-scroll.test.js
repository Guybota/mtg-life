/* Gestos reais de toque no Chromium, incluindo o tabuleiro rodado por CSS. */
const { openWith } = require("./helpers");

async function touch(client, type, point) {
  await client.send("Input.dispatchTouchEvent", {
    type, touchPoints: point ? [{ ...point, id: 1 }] : [],
  });
}

async function swipe(page, client, point, rotated) {
  await touch(client, "touchStart", point);
  for (let i = 1; i <= 8; i++) {
    await touch(client, "touchMove", {
      x: point.x + (rotated ? i * 15 : 0),
      y: point.y - (rotated ? 0 : i * 15),
    });
    await page.waitForTimeout(20);
  }
  await touch(client, "touchEnd");
  await page.waitForTimeout(250);
}

module.exports = [
  { width: 390, height: 844, rotated: true },
  { width: 844, height: 390, rotated: false },
].map(({ width, height, rotated }) => ({
  name: `Android: scroll sobre +/− ${rotated ? "com rotação CSS" : "em landscape"} sem dar dano`,
  async run(t) {
    const page = await t.page({ viewport: { width, height }, isMobile: true, hasTouch: true });
    await openWith(t, page, null);
    await page.click(".mode-card.commander");
    await page.click("#qs-go");
    await page.waitForSelector(".player-panel");
    // Parceiros tornam a lista longa, como num jogo de Commander real.
    await page.evaluate(() => {
      game.standard.players.slice(1).forEach((p) => { p.partnerCommander = { name: "Parceiro" }; });
      render();
    });
    await page.locator(".player-panel .cmd-badge").first().click();
    await page.waitForSelector(".cdx-sheet");
    await page.waitForTimeout(350); // fim da animação de abertura
    t.eq(await page.evaluate(() => document.documentElement.classList.contains("force-landscape")), rotated, "orientação esperada");
    const client = await page.context().newCDPSession(page);
    const pointOf = (selector) => page.$eval(selector, (e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    const damageState = () => page.evaluate(() => game.standard.players.map((p) => ({ life: p.life, damage: { ...p.cmdDamage } })));
    const plus = ".cdx-row:first-child .plus";
    const minus = ".cdx-row:first-child .minus";
    // Tap curto e manter premido continuam a funcionar.
    await touch(client, "touchStart", await pointOf(plus));
    await touch(client, "touchEnd");
    t.eq(await page.textContent(".cdx-row:first-child [data-val]"), "1", "tap dá exatamente 1 de dano");
    await touch(client, "touchStart", await pointOf(plus));
    await page.waitForTimeout(700);
    await touch(client, "touchEnd");
    const afterHold = Number(await page.textContent(".cdx-row:first-child [data-val]"));
    t.ok(afterHold >= 3, "manter premido repete");
    await page.waitForTimeout(200);
    t.eq(Number(await page.textContent(".cdx-row:first-child [data-val]")), afterHold, "repetição para ao levantar o dedo");

    for (const selector of [plus, minus, ".cdx-row:first-child .cdx-who"]) {
      await page.$eval(".cdx-sheet", (e) => { e.scrollTop = 0; });
      await page.waitForTimeout(100);
      const before = await damageState();
      await swipe(page, client, await pointOf(selector), rotated);
      t.ok(await page.$eval(".cdx-sheet", (e) => e.scrollTop > 30), `scroll funciona a partir de ${selector}`);
      t.eq(await damageState(), before, "arrastar não altera dano nem vida");
    }
    // Todas as linhas e o botão de fechar são alcançáveis.
    for (let i = 0; i < 12; i++) {
      if (await page.$eval(".cdx-sheet", (e) => e.scrollTop + e.clientHeight >= e.scrollHeight - 2)) break;
      const point = await page.$eval(".cdx-sheet", (e) => {
        const r = e.getBoundingClientRect();
        const rotated = document.documentElement.classList.contains("force-landscape");
        return rotated ? { x: r.left + 130, y: r.top + r.height / 2 }
          : { x: r.left + r.width / 2, y: r.bottom - 25 };
      });
      await swipe(page, client, point, rotated);
    }
    t.ok(await page.$eval(".cdx-sheet", (e) => e.scrollTop + e.clientHeight >= e.scrollHeight - 2), "gestos chegam ao fim da lista");
    await page.waitForTimeout(1000); // termina a inércia do scroll nativo
    t.ok(await page.$eval("#cd-close", (e) => {
      const r = e.getBoundingClientRect(), sheet = e.closest(".cdx-sheet").getBoundingClientRect();
      return r.left >= sheet.left && r.right <= sheet.right && r.top >= sheet.top && r.bottom <= sheet.bottom;
    }), "botão de fechar está dentro da área visível");
    await page.click("#cd-close");
    await page.waitForSelector(".cdx-sheet", { state: "detached" });
  },
}));
