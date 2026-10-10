/* Apagar todos os dados para começar de novo. */
const { seedProfiles, openWith, stored, goProfiles } = require("./helpers");

module.exports = [
  {
    name: "apagar tudo (com desfazer) e sair do grupo da nuvem",
    async run(t) {
      const page = await t.page();
      await page.route(/supabase\.co/, () => {}); // a nuvem nunca responde
      await openWith(t, page, seedProfiles(), { mtg_lc_cloud_v1: JSON.stringify({ code: "VAS2-H4Z6-3AXS", lastSync: Date.now() }), mtg_lc_player_aliases_v1: JSON.stringify({ ze: "José" }) });
      await goProfiles(page);
      await page.click("#reset-all-btn");
      const text = await page.textContent(".reset-sheet");
      t.ok(text.includes("6 deck(s)") && text.includes("18 jogo(s)") && text.includes("VAS2-H4Z6-3AXS"), "explica o que apaga: " + text.replace(/\s+/g, " ").slice(0, 160));
      await page.click("#ra-go");
      t.ok(await page.isVisible(".reset-sheet"), "primeiro toque só pede confirmação");
      await page.click("#ra-go");
      await page.waitForSelector("#rs-file");
      const after = await page.evaluate(() => ({ p: localStorage.getItem("mtg_lc_profiles_v1"), a: localStorage.getItem("mtg_lc_player_aliases_v1"), c: localStorage.getItem("mtg_lc_cloud_v1") }));
      t.eq(after, { p: null, a: null, c: null }, "tudo apagado e fora do grupo");
      t.ok((await page.textContent("#rs-cloud")).includes("VAS2-H4Z6-3AXS"), "oferece voltar ao grupo");
      // desfazer devolve tudo
      await page.click("#rs-undo");
      await page.waitForTimeout(200);
      t.eq((await stored(page)).length, 6, "desfazer repõe os perfis");
      t.ok(await page.evaluate(() => !!localStorage.getItem("mtg_lc_cloud_v1")), "e o grupo");
    },
  },
  {
    name: "depois de apagar, voltar ao grupo já traz o código escrito",
    async run(t) {
      const page = await t.page();
      await page.route(/supabase\.co/, () => {});
      await openWith(t, page, seedProfiles(), { mtg_lc_cloud_v1: JSON.stringify({ code: "VAS2-H4Z6-3AXS", lastSync: Date.now() }) });
      await goProfiles(page);
      await page.click("#reset-all-btn");
      await page.click("#ra-go");
      await page.click("#ra-go");
      await page.click("#rs-cloud");
      t.eq(await page.inputValue("#cloud-code-input"), "VAS2-H4Z6-3AXS", "código preenchido");
    },
  },
];
