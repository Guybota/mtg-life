/* Histórico de vida do jogo em curso: tabela por turnos e lista. */
const { openWith } = require("./helpers");

const game = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("mtg_lc_game_v2")).standard);

async function tap(page, i, sel, n) {
  for (let k = 0; k < n; k++) await (await (await page.$$(".player-panel"))[i].$(sel)).click();
}

module.exports = [
  {
    name: "tabela, lista com origem, filtro e desfazer",
    async run(t) {
      const page = await t.page({ viewport: { width: 1180, height: 820 }, hasTouch: true });
      await openWith(t, page, null);
      await page.click(".mode-card.commander");
      await page.click("#qs-go");
      await page.waitForSelector(".player-panel");
      const ids = (await game(page)).players.map((p) => p.id);
      // turno 1: jogador 2 leva 3; turno 2: jogador 3 leva 7 de commander damage do jogador 1
      await tap(page, 1, ".life-tap.minus", 3);
      await page.click(".panel-pass-turn-btn");
      // commander damage como o ecrã de dano o aplica (estado do jogo em memória)
      await page.evaluate(([a, b]) => { MTG.State.stdAdjustCmdDamage(game, b, a, 7); render(); }, [ids[0], ids[2]]);
      await page.click("#history-btn");
      await page.waitForSelector(".lh-table");
      const heads = await page.$$eval(".lh-table thead .lh-col-life", (x) => x.map((e) => +e.textContent));
      t.eq(heads, [40, 37, 33, 40], "vida atual no topo de cada coluna");
      const cells = await page.$$eval(".lh-table tbody tr", (rows) => rows.map((r) => [...r.querySelectorAll("td")].map((td) => [...td.querySelectorAll("span")].map((x) => x.textContent).join(" "))));
      t.eq(cells[0], ["40", "37", "−7 33", "40"], "linha do turno atual");
      t.eq(cells[1], ["40", "−3 37", "40", "40"], "linha do turno anterior");
      t.eq(cells[cells.length - 1], ["40", "40", "40", "40"], "linha de início");
      // tocar numa coluna abre a lista filtrada por esse jogador
      await page.click('.lh-table thead th[data-col] >> nth=2');
      await page.waitForSelector(".lh-row");
      const rows = await page.$$eval(".lh-row", (x) => x.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
      t.eq(rows.length, 1, "só o jogador 3");
      t.ok(rows[0].includes("40 → 33") && rows[0].includes("Commander damage de Jogador 1") && rows[0].includes("−7"), "linha da lista: " + rows[0]);
      // desfazer devolve a vida e o commander damage
      await page.click(".lh-undo");
      await page.waitForTimeout(200);
      const st = await game(page);
      t.eq([st.players[2].life, st.players[2].cmdDamage[ids[0]] || 0], [40, 0], "desfeito no jogo");
      t.ok(await page.isVisible(".lh-sheet"), "janela continua aberta");
      await page.click('[data-filter=""]');
      t.eq(await page.$$eval(".lh-row", (x) => x.length), 1, "fica a alteração do jogador 2");
    },
  },
];
