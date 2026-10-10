/* Dados e passos repetidos pelos testes. */

/** Grupo de exemplo: 5 jogadores, 6 decks e 18 jogos já jogados.
 *  Devolve a lista de perfis (objetos), pronta a alterar antes de gravar. */
function seedProfiles() {
  const decks = [["a1", "Atraxa", "Ana"], ["a2", "Meren", "Ana"], ["r1", "Krenko", "Rui"], ["t1", "Edgar Markov", "Tiago"], ["p1", "Yuriko", "Pedro"], ["j1", "Muldrotha", "Joana"]];
  const P = decks.map(([id, name, pl]) => ({ id, name, playerName: pl, commander: null, stats: { games: 0, wins: 0, totalGameTimeMs: 0, totalTurnTimeMs: 0, turnsTaken: 0 }, history: [], createdAt: 1 }));
  const by = Object.fromEntries(P.map((p) => [p.id, p]));
  const games = [["a1 r1 t1 p1", "a1"], ["a1 r1 t1 j1", "t1"], ["a2 r1 p1 j1", "a2"], ["a1 t1 p1 j1", "a1"], ["a1 r1 t1", "a1"], ["a2 t1 p1 j1", "j1"], ["a1 r1 p1 j1", "r1"], ["a1 r1 t1 p1", "a1"], ["a2 r1 t1 j1", "t1"], ["a1 t1 p1 j1", "t1"], ["a1 r1 t1 p1 j1", "a1"], ["a2 r1 t1 p1", "p1"], ["a1 r1 t1 j1", "a1"], ["a1 r1 p1", "r1"], ["a2 t1 p1 j1", "t1"], ["a1 r1 t1 p1", "a1"], ["a2 r1 t1 j1", "a2"], ["a1 t1 p1 j1", "j1"]];
  let t = Date.now() - games.length * 86400000;
  games.forEach(([seats, w], gi) => {
    t += 86400000;
    const ids = seats.split(" ");
    ids.forEach((id, i) => {
      const p = by[id];
      const won = id === w;
      p.history.push({ id: "g" + gi + id, date: t + i * 30, won, mode: "standard", gameTimeMs: 3e6, turnTimeMs: 6e5, turnsTaken: 10, timed: true, opponents: ids.filter((x) => x !== id).map((x) => ({ profileId: x, name: by[x].playerName, won: x === w })) });
      p.stats.games++;
      if (won) p.stats.wins++;
      p.stats.totalGameTimeMs += 3e6;
      p.stats.totalTurnTimeMs += 6e5;
      p.stats.turnsTaken += 10;
    });
  });
  return P;
}

/** Abre a app com estes perfis gravados (e, opcionalmente, outras chaves). */
async function openWith(t, page, profiles, extra) {
  await page.goto(t.url);
  await page.evaluate(([d, x]) => {
    localStorage.clear();
    if (d) localStorage.setItem("mtg_lc_profiles_v1", d);
    Object.entries(x || {}).forEach(([k, v]) => localStorage.setItem(k, v));
  }, [profiles ? JSON.stringify(profiles) : null, extra || {}]);
  await page.reload();
  await page.waitForSelector(".menu-screen");
}

/** Perfis gravados neste momento na página. */
function stored(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("mtg_lc_profiles_v1") || "[]"));
}

async function goProfiles(page, tab) {
  await page.click("#profiles-btn");
  await page.waitForSelector(".profiles-screen");
  if (tab) await page.click(`.seg-btn[data-tab="${tab}"]`);
}

/** Escolhe um perfil para o lugar i do setup, pelo seletor de perfis. */
async function pickProfile(page, i, name) {
  const card = (await page.$$(".player-setup-card"))[i];
  await (await card.$(".profile-btn")).click();
  await page.click(`#pp-list .search-result-item:has(.name:text-is("${name}"))`);
  await page.waitForSelector("#pp-list", { state: "detached" });
}

/** Do setup do Commander: começa o jogo e escolhe quem começa (se pedir). */
async function startGame(page) {
  await page.click("#start-btn");
  const who = await page.waitForSelector(".modal-sheet .cd-list-item", { timeout: 1500 }).catch(() => null);
  if (who) await who.click();
  await page.waitForSelector(".player-panel");
}

/** Ação da barra de botões: em ecrã inteiro (o padrão) vai pelo menu ≡. */
async function boardAction(page, id) {
  if (await page.isVisible("#" + id)) { await page.click("#" + id); return; }
  await page.click("#fs-more-btn");
  await page.click(`.bm-item[data-target="${id}"]`);
}
/** Sai do ecrã inteiro (mostra as barras), se estiver nele. */
async function exitFullscreen(page) {
  if (await page.isVisible("#fullscreen-exit-btn")) await page.click("#fullscreen-exit-btn");
  await page.waitForSelector(".board-toolbar", { state: "visible" });
}

/** Termina o jogo em curso com este vencedor (nome do lugar). */
async function endGame(page, winnerName) {
  await boardAction(page, "end-game-btn");
  await page.click(`#winner-list label.row:has-text("${winnerName}")`);
  await page.click("#eg-confirm");
  await page.waitForTimeout(500);
}

module.exports = { seedProfiles, openWith, stored, goProfiles, pickProfile, startGame, endGame, boardAction, exitFullscreen };
