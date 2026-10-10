/* Contador: jogo rápido, vida, ecrã inteiro, fim de jogo e outros modos. */
const { seedProfiles, openWith, stored, pickProfile, startGame, endGame, exitFullscreen } = require("./helpers");

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
      // ecrã inteiro é o padrão
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

module.exports.push({
  name: "folha do jogador: + em cima e − em baixo no valor para os outros",
  async run(t) {
    const page = await t.page({ viewport: { width: 1180, height: 820 }, hasTouch: true });
    await openWith(t, page, null);
    await page.click(".mode-card.commander");
    await page.click("#qs-go");
    await page.waitForSelector(".player-panel");
    await page.click('.player-panel >> nth=0 >> [data-action="player-sheet"] >> nth=0');
    await page.waitForSelector(".ps-n");
    const order = await page.$$eval(".ps-n > *", (x) => x.map((e) => e.getAttribute("data-n") || "val"));
    t.eq(order, ["1", "val", "-1"], "ordem dos botões");
    await page.click('.ps-n [data-n="1"]');
    await page.click('.ps-n [data-n="1"]');
    t.eq(await page.textContent("[data-n-val]"), "3", "+ soma");
    await page.click('.ps-n [data-n="-1"]');
    t.eq(await page.textContent("[data-n-val]"), "2", "− tira");
  },
});

module.exports.push({
  name: "1v1 fica ao alto no telemóvel com os +/− dos lados",
  async run(t) {
    const page = await t.page({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await openWith(t, page, null);
    await page.click(".mode-card.duel");
    await page.click("#qs-go");
    await page.waitForSelector(".player-panel");
    const cls = await page.evaluate(() => document.documentElement.className);
    t.ok(!cls.includes("force-landscape") && cls.includes("duel-portrait"), "classes: " + cls);
    const pos = await page.$$eval(".player-panel", (ps) => ps.map((p) => {
      const plus = p.querySelector(".life-tap.plus").getBoundingClientRect(), minus = p.querySelector(".life-tap.minus").getBoundingClientRect();
      return { sides: Math.abs(plus.top - minus.top) < 2 && Math.abs(plus.left - minus.left) > 100 };
    }));
    t.ok(pos.every((x) => x.sides), "+ e − dos lados em cada painel");
    await exitFullscreen(page);
    t.ok(await page.evaluate(() => document.querySelector(".board-toolbar").scrollWidth <= document.querySelector(".board-toolbar").clientWidth + 1), "barra de botões cabe na largura");
    // com 4 jogadores continua deitado
    await page.goto(t.url);
    await page.click(".mode-card.commander");
    await page.click("#qs-go");
    await page.waitForSelector(".player-panel");
    t.ok((await page.evaluate(() => document.documentElement.className)).includes("force-landscape"), "Commander de 4 continua deitado");
  },
});

module.exports.push({
  name: "veneno está nos contadores do jogador (10 elimina)",
  async run(t) {
    const page = await t.page({ viewport: { width: 1180, height: 820 }, hasTouch: true });
    await openWith(t, page, null);
    await page.click(".mode-card.commander");
    if (await page.$("#qs-setup")) {
      await page.click("#qs-setup");
      t.eq(await page.$("#cfg-poison"), null, "sem opção de veneno no setup");
      await page.click("#start-btn");
      const who = await page.waitForSelector(".modal-sheet .cd-list-item", { timeout: 1500 }).catch(() => null);
      if (who) await who.click();
    } else await page.click("#qs-go");
    await page.waitForSelector(".player-panel");
    t.eq(await page.$(".poison-badge"), null, "sem distintivo de veneno no cartão");
    await page.click('.player-panel >> nth=0 >> [data-action="player-sheet"] >> nth=0');
    const keys = await page.$$eval(".ps-counter", (x) => x.map((e) => e.dataset.key));
    t.eq(keys[0], "poison", "veneno é o primeiro contador");
    for (let i = 0; i < 10; i++) await page.click('.ps-counter[data-key="poison"] [data-c="1"]');
    const st = await page.evaluate(() => JSON.parse(localStorage.getItem("mtg_lc_game_v2")).standard.players[0]);
    t.eq([st.poison, st.eliminated], [10, true], "10 venenos eliminam");
    await page.click("#ps-close");
    const chip = await page.$eval(".player-panel .st-chip.poison", (e) => [e.textContent.trim(), e.classList.contains("lethal")]);
    t.eq(chip, ["10", true], "insígnia de veneno no cartão");
  },
});

module.exports.push({
  name: "iPhone deitado: barras dos lados e insígnias visíveis",
  async run(t) {
    const page = await t.page({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await openWith(t, page, null);
    await page.click(".mode-card.commander");
    await page.click("#qs-go");
    await page.waitForSelector(".player-panel");
    await page.evaluate(() => { MTG.State.stdAdjustCounter(game, game.standard.players[3].id, "rad", 2); MTG.State.stdAdjustPoison(game, game.standard.players[3].id, 3); render(); });
    await exitFullscreen(page);
    const box = (sel) => page.$eval(sel, (e) => ({ x: e.offsetLeft, w: e.offsetWidth, h: e.offsetHeight }));
    const [st, board, bar] = [await box(".br-status-row"), await box(".board"), await box(".board-toolbar")];
    t.ok(st.x === 0 && board.x >= st.w && bar.x >= board.x + board.w - 1, "estado | tabuleiro | botões lado a lado");
    t.ok(bar.w >= 44 && bar.h > 300, "coluna de botões com tamanho: " + JSON.stringify(bar));
    const chips = await page.$$eval(".player-panel .st-chip", (x) => x.map((e) => e.offsetHeight >= 20 && e.offsetWidth >= 30));
    t.ok(chips.length === 2 && chips.every(Boolean), "insígnias com tamanho visível");
  },
});

module.exports.push({
  name: "ecrã inteiro por defeito, com menu para as outras ações",
  async run(t) {
    const page = await t.page({ viewport: { width: 1180, height: 820 }, hasTouch: true });
    await openWith(t, page, null);
    await page.click(".mode-card.commander");
    await page.click("#qs-go");
    await page.waitForSelector(".player-panel");
    t.ok(await page.isVisible(".fs-hub") && !(await page.isVisible(".board-toolbar")), "começa em ecrã inteiro");
    await page.click("#fs-more-btn");
    const items = await page.$$eval(".bm-item", (x) => x.map((e) => e.dataset.target));
    t.eq(items, ["history-btn", "reorder-btn", "reset-btn", "end-game-btn", "fullscreen-exit-btn", "menu-btn"], "ações do menu");
    await page.click('.bm-item[data-target="history-btn"]');
    await page.waitForSelector(".lh-sheet");
    await page.click("#lh-x, #close-lh-btn >> visible=true");
    await page.click("#fs-more-btn");
    await page.click('.bm-item[data-target="fullscreen-exit-btn"]');
    t.ok(await page.isVisible(".board-toolbar"), "mostrar barras sai do ecrã inteiro");
  },
});

module.exports.push({
  name: "hub do ecrã inteiro: lateral no telemóvel deitado, central no iPad e no 1v1",
  async run(t) {
    const hubSide = async (size, mode, mobile) => {
      const page = await t.page({ viewport: size, hasTouch: true, isMobile: mobile });
      await openWith(t, page, null);
      await page.click(`.mode-card.${mode}`);
      await page.click("#qs-go");
      await page.waitForSelector(".fs-hub");
      return page.$eval(".fs-hub", (h) => getComputedStyle(h).flexDirection === "column");
    };
    t.eq(await hubSide({ width: 390, height: 844 }, "commander", true), true, "iPhone deitado, 4 jogadores: lateral");
    t.eq(await hubSide({ width: 1180, height: 820 }, "commander", false), false, "iPad: central");
    t.eq(await hubSide({ width: 390, height: 844 }, "duel", true), false, "1v1 ao alto: central");
    t.eq(await hubSide({ width: 844, height: 390 }, "duel", true), false, "1v1 com o telemóvel deitado: central");
  },
});

module.exports.push({
  name: "janelas com scroll: o botão de fechar fica preso no fundo",
  async run(t) {
    const page = await t.page({ viewport: { width: 1180, height: 820 }, hasTouch: true });
    await openWith(t, page, null);
    await page.click(".mode-card.commander");
    await page.click("#qs-go");
    await page.waitForSelector(".player-panel");
    // jogador do lado de baixo: a janela não vem rodada
    await page.click('.player-panel:not(.rot180) >> nth=0 >> [data-action="player-sheet"] >> nth=0');
    await page.waitForSelector("#ps-close");
    await page.waitForTimeout(400);
    // janela baixa o suficiente para ter scroll
    await page.evaluate(() => { document.querySelector(".ps-sheet").style.maxHeight = "320px"; });
    const m = await page.evaluate(() => {
      const sheet = document.querySelector(".ps-sheet");
      sheet.scrollTop = 0;
      const s = sheet.getBoundingClientRect();
      const b = document.querySelector("#ps-close").getBoundingClientRect();
      return { scrolls: sheet.scrollHeight > sheet.clientHeight + 20, sheetBottom: s.bottom, btnTop: b.top, btnBottom: b.bottom, hit: document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) === document.querySelector("#ps-close") };
    });
    t.ok(m.scrolls, "a janela tem scroll");
    t.ok(m.btnTop > m.sheetBottom - 100 && m.btnBottom <= m.sheetBottom, "Fechar está visível no fundo da janela sem fazer scroll");
    t.ok(m.hit, "Fechar está por cima do conteúdo e responde ao toque");
    // no fim do scroll fica no mesmo sítio (sem saltar nem deixar espaço vazio por baixo)
    const end = await page.evaluate(() => {
      const sheet = document.querySelector(".ps-sheet");
      sheet.scrollTop = sheet.scrollHeight;
      return document.querySelector("#ps-close").getBoundingClientRect().bottom;
    });
    t.ok(Math.abs(end - m.btnBottom) < 2, "no fim do scroll o botão não mexe");
    await page.click("#ps-close");
    t.ok(!(await page.$(".ps-sheet")), "Fechar fecha a janela");
  },
});
