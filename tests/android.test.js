/* Android: scroll com a página rodada por CSS, botão "voltar" do sistema
 * e teclado que encolhe a janela. Toques reais pelo protocolo do Chromium. */
const { seedProfiles, openWith } = require("./helpers");

const PHONE = { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true };
async function touchSwipe(page, client, el, dx, dy) {
  const r = await el.boundingBox();
  const x = r.x + r.width / 2, y = r.y + r.height / 2;
  const send = (type, p) => client.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ ...p, id: 1 }] : [] });
  await send("touchStart", { x, y });
  for (let i = 1; i <= 8; i++) { await send("touchMove", { x: x + (dx * i) / 8, y: y + (dy * i) / 8 }); await page.waitForTimeout(16); }
  await send("touchEnd");
  await page.waitForTimeout(300);
}
async function quickGame(t, players) {
  const page = await t.page(PHONE);
  await openWith(t, page, seedProfiles());
  await page.click(".mode-card.commander");
  if (players) await page.evaluate((n) => { draft.players = Array.from({ length: n }, () => ({ name: "", commander: null, partnerCommander: null, profileId: null })); }, players);
  await page.click("#qs-go");
  await page.waitForSelector(".player-panel");
  return page;
}

module.exports = [
  {
    name: "janelas do jogo rodado fazem scroll com o dedo",
    async run(t) {
      const page = await quickGame(t, 8);
      t.ok(await page.evaluate(() => document.documentElement.classList.contains("force-landscape")), "página rodada");
      const client = await page.context().newCDPSession(page);
      for (const [label, open, sel] of [
        ["painel do jogador", () => page.click('.player-panel >> nth=0 >> [data-action="player-sheet"] >> nth=0'), ".ps-sheet"],
        ["terminar jogo", async () => { await page.click("#fs-more-btn"); await page.click('.bm-item[data-target="end-game-btn"]'); }, ".modal-sheet"],
      ]) {
        await open();
        await page.waitForTimeout(400);
        const sheet = await page.$(sel);
        t.ok(await sheet.evaluate((e) => e.scrollHeight > e.clientHeight + 20), label + ": tem scroll");
        // rodada 90°: o dedo para a direita no ecrã desce a lista
        await touchSwipe(page, client, sheet, 120, 0);
        t.ok(await sheet.evaluate((e) => e.scrollTop > 40), label + ": fez scroll");
        await page.evaluate(() => document.querySelectorAll(".modal-backdrop").forEach((b) => b.remove()));
      }
    },
  },
  {
    name: "trocar lugares a arrastar na mesa com o jogo rodado",
    async run(t) {
      const page = await quickGame(t, 4);
      const client = await page.context().newCDPSession(page);
      await page.click("#fs-more-btn");
      await page.click('.bm-item[data-target="reorder-btn"]');
      await page.waitForSelector("#ro-mesa .mesa-seat");
      const names = () => page.evaluate(() => game.standard.players.map((p) => p.name).join(","));
      const before = await names();
      const [a, b] = await Promise.all([0, 1].map((i) => page.$eval(`#ro-mesa .mesa-seat[data-seat="${i}"]`, (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })));
      const send = (type, p) => client.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ ...p, id: 1 }] : [] });
      await send("touchStart", a);
      for (let i = 1; i <= 10; i++) { await send("touchMove", { x: a.x + ((b.x - a.x) * i) / 10, y: a.y + ((b.y - a.y) * i) / 10 }); await page.waitForTimeout(16); }
      await send("touchEnd");
      await page.waitForTimeout(300);
      const done = await page.$("#reorder-done-btn");
      if (done) await done.click();
      await page.waitForTimeout(300);
      t.ok((await names()) !== before, "lugares trocados: " + before + " → " + (await names()));
    },
  },
  {
    name: "botão voltar: fecha a janela, volta ao ecrã anterior, no jogo pergunta",
    async run(t) {
      const page = await t.page(PHONE);
      await openWith(t, page, seedProfiles());
      await page.click(".mode-card.commander");
      await page.click("#qs-setup");
      await page.click(".player-setup-card >> nth=0 >> .seat-deck-btn");
      await page.goBack();
      await page.waitForSelector(".deck-sheet", { state: "detached" });
      t.ok(await page.isVisible(".player-setup-card"), "fechou só a janela");
      await page.goBack();
      await page.waitForSelector(".menu-screen");
      await page.click(".mode-card.commander");
      await page.click("#qs-go");
      await page.waitForSelector(".player-panel");
      let asked = "";
      page.once("dialog", (d) => { asked = d.message(); }); // o run.js aceita
      await page.goBack();
      await page.waitForSelector(".menu-screen");
      t.ok(asked.includes("menu"), "perguntou antes de sair do jogo: " + asked);
    },
  },
  {
    name: "teclado a encolher a janela não desfaz a rotação do jogo",
    async run(t) {
      const page = await quickGame(t);
      await page.click('.player-panel >> nth=0 >> [data-action="edit"]');
      await page.focus("#ep-name");
      await page.setViewportSize({ width: 412, height: 380 }); // teclado grande: mais largo do que alto
      await page.waitForTimeout(200);
      t.ok(await page.evaluate(() => document.documentElement.classList.contains("force-landscape")), "continua rodada");
      await page.evaluate(() => document.activeElement.blur());
      await page.setViewportSize({ width: 915, height: 412 });
      await page.waitForTimeout(200);
      t.ok(!(await page.evaluate(() => document.documentElement.classList.contains("force-landscape"))), "aparelho deitado de verdade deixa de rodar");
    },
  },
];
