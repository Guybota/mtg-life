/* Sincronização entre aparelhos (MTG.Profiles.syncMerge), sem rede:
 * cada "aparelho" é um conteúdo diferente do localStorage. */
const { seedProfiles, openWith } = require("./helpers");

const KEYS = ["mtg_lc_profiles_v1", "mtg_lc_deleted_v1", "mtg_lc_player_aliases_v1"];

module.exports = [
  {
    name: "dois aparelhos convergem sem duplicar jogos",
    async run(t) {
      const page = await t.page();
      await openWith(t, page, seedProfiles());
      const r = await page.evaluate((KEYS) => {
        const P = MTG.Profiles;
        const save = () => Object.fromEntries(KEYS.map((k) => [k, localStorage.getItem(k)]));
        const load = (s) => KEYS.forEach((k) => (s[k] == null ? localStorage.removeItem(k) : localStorage.setItem(k, s[k])));
        const games = () => P.all().reduce((a, p) => a + p.history.length, 0);

        const A = save();
        const payloadA = P.syncPayload();
        // aparelho B, vazio, recebe o grupo
        load({});
        P.syncMerge(payloadA);
        const gB = games();
        const again = P.syncMerge(payloadA); // repetir não muda nada
        // em B: apaga um jogo e corrige quem jogou noutro
        const atx = P.all().find((p) => p.name === "Atraxa");
        const [g1, g2] = P.historyOf(atx.id);
        P.removeGame(atx.id, g1.id);
        P.update(atx.id, { history: P.get(atx.id).history.map((g) => (g.id === g2.id ? Object.assign({}, g, { playedBy: "Rui", editedAt: Date.now() }) : g)) });
        const payloadB = P.syncPayload();
        // A recebe o que B mudou
        load(A);
        P.syncMerge(payloadB);
        const a = P.all().find((p) => p.name === "Atraxa");
        return {
          gB, again,
          hasG1: a.history.some((g) => g.id === g1.id),
          g2by: a.history.find((g) => g.id === g2.id).playedBy,
          statsGames: a.stats.games, histLen: a.history.length,
        };
      }, KEYS);
      t.eq(r.gB, 71, "B fica com os 71 registos de A");
      t.eq([r.again.profiles, r.again.games, r.again.removed], [0, 0, 0], "segunda sincronização não muda nada");
      t.eq(r.hasG1, false, "jogo apagado em B desaparece em A");
      t.eq(r.g2by, "Rui", "correção de quem jogou chega a A");
      t.eq(r.statsGames, r.histLen, "estatísticas acertadas com o histórico");
    },
  },
];
