/* ===========================================================
   ui/data.js — Último setup, cópias de segurança, fundir perfis e nuvem.

   A interface está dividida em vários ficheiros (js/ui/*.js), carregados
   por ordem no index.html. Partilham o mesmo âmbito global: o que um
   declara no topo (funções, const/let) os outros usam diretamente.
   =========================================================== */
// ===========================================================
// ÚLTIMO SETUP ("Repetir último jogo")
// ===========================================================
const LAST_SETUP_KEY = "mtg_lc_last_setup_v1";
function rememberSetup(kind, d) {
  try { localStorage.setItem(LAST_SETUP_KEY, JSON.stringify({ kind, draft: d, at: Date.now() })); } catch (e) {}
}
function loadLastSetup() {
  try {
    const raw = localStorage.getItem(LAST_SETUP_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && v.kind && v.draft ? v : null;
  } catch (e) { return null; }
}
/** Jogadores (nome + commander) de um rascunho, em qualquer modo. */
function setupPlayers(last) {
  const d = last.draft;
  if (last.kind === "br") return d.names.map((n, i) => ({ name: n || tr("Jogador {n}", { n: i + 1 }), commander: d.commanders[i] }));
  if (last.kind === "teams") {
    let seat = 0;
    return d.teams.reduce((acc, t) => acc.concat(t.players.map((p) => ({ name: p.name || tr("Jogador {n}", { n: ++seat }), commander: p.commander }))), []);
  }
  return d.players.map((p, i) => ({ name: p.name || tr("Jogador {n}", { n: i + 1 }), commander: p.commander, colorIdx: p.colorIdx }));
}
function relativeDay(ts) {
  const day = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const diff = Math.round((day(Date.now()) - day(ts)) / 86400000);
  if (diff <= 0) return tr("hoje");
  if (diff === 1) return tr("ontem");
  if (diff < 7) return tr("há {n} dias", { n: diff });
  return formatDateTime(ts).split(" ")[0];
}
function lastSetupCardHtml(last) {
  const players = setupPlayers(last);
  const d = last.draft;
  const mode = last.kind === "br" ? "Battle Royale" : last.kind === "teams" ? tr("Equipas") : (PRESETS[d.preset] ? PRESETS[d.preset].label : tr("Jogo"));
  const life = last.kind === "br" ? 30 : d.startLife;
  return `
    <div class="last-card">
      <span class="last-head">
        <span class="last-kicker">${tr("Último jogo")} · ${relativeDay(last.at)}</span>
        <span class="last-title">${esc(mode)}</span>
        <span class="last-names" title="${esc(players.map((p) => p.name).join(", "))}">${tr("{n} jogadores", { n: players.length })} · ${tr("{n} vidas", { n: life })}${last.kind !== "br" && d.trackTurns === false ? " · " + tr("sem tempo") : ""}</span>
      </span>
      <span class="last-actions">
        <button class="btn btn-icon" id="adjust-btn" title="${tr("Ajustar antes")}" aria-label="${tr("Ajustar antes")}">${I("sliders")}</button>
        <button class="btn btn-primary" id="repeat-btn">${I("rotate")} ${tr("Repetir")}</button>
      </span>
    </div>`;
}

// ===========================================================
// CÓPIA DE SEGURANÇA — os dados vivem só neste aparelho/browser,
// por isso convém guardar um ficheiro noutro sítio (Ficheiros/iCloud).
// ===========================================================
const BACKUP_KEY = "mtg_lc_backup_v1";
const BACKUP_EVERY = 5; // lembrar ao fim de N jogos novos sem cópia

function backupInfo() {
  try { return JSON.parse(localStorage.getItem(BACKUP_KEY)) || {}; } catch (e) { return {}; }
}
function setBackupInfo(patch) {
  try { localStorage.setItem(BACKUP_KEY, JSON.stringify(Object.assign(backupInfo(), patch))); } catch (e) {}
}

/** Guarda a cópia: no telemóvel abre o menu de partilha (→ "Guardar em
 *  Ficheiros", iCloud, enviar...); onde isso não existe, descarrega. */
async function saveBackup() {
  const data = JSON.parse(Profiles.exportAll());
  data.type = "backup";
  data.lastSetup = loadLastSetup();
  const json = JSON.stringify(data, null, 2);
  const name = `mtg-life-counter-${new Date().toISOString().slice(0, 10)}.json`;
  let shared = false;
  try {
    const file = new File([json], name, { type: "application/json" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: tr("Cópia de segurança MTG Life") });
      shared = true;
    }
  } catch (e) {
    if (e && e.name === "AbortError") return false; // fechou o menu sem guardar
  }
  if (!shared) {
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  setBackupInfo({ at: Date.now(), games: Profiles.gameCount() });
  toast(tr("Cópia de segurança guardada"));
  return true;
}

/** Lê um ficheiro de cópia/exportação (deste ou de outro aparelho) e
 *  abre a revisão da fusão. */
function restoreBackupFile(file, done) {
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try { parsed = JSON.parse(String(reader.result)); } catch (e) { parsed = null; }
    const list = parsed && (Array.isArray(parsed) ? parsed : parsed.profiles);
    if (!Array.isArray(list)) {
      alert(tr("Não foi possível ler este ficheiro. Confirma que é um ficheiro exportado por esta app."));
      return;
    }
    openMergeReview(list, { lastSetup: parsed.lastSetup, exportedAt: parsed.exportedAt, playerAliases: parsed.playerAliases }, done);
  };
  reader.readAsText(file);
}

// ===========================================================
// FUNDIR PERFIS — juntar os perfis e jogos de outro aparelho
// ===========================================================
const deckLabel = (p) => (p.playerName ? p.playerName + " · " : "") + p.name;

/** Revisão antes de fundir: mostra o que já está ligado, sugere pares
 *  (mesmo jogador e commander) e deixa escolher o destino de cada perfil
 *  recebido. Nada é duplicado: jogos que já existam são ignorados. */
function openMergeReview(list, extra, done) {
  const rows = Profiles.mergePreview(list);
  if (!rows.length) { alert(tr("Não foram encontrados perfis válidos neste ficheiro.")); return; }
  const locals = Profiles.all();
  const auto = rows.filter((r) => r.auto);
  const pick = rows.filter((r) => !r.auto);
  if (!pick.length && auto.every((r) => !r.newGames)) {
    if (extra && extra.onApplied) { extra.onApplied(); return; } // ex: entrar num grupo
    alert(tr("Já está tudo fundido: não há jogos nem perfis novos."));
    return;
  }
  const newGamesFor = (r, localId) => {
    const hist = Array.isArray(r.incoming.history) ? r.incoming.history : [];
    if (!localId) return hist.length;
    const lp = locals.find((p) => p.id === localId);
    const have = new Set(((lp && lp.history) || []).map((g) => g.id));
    return hist.filter((g) => g && !have.has(g.id)).length;
  };
  const options = (sel) => `<option value="">${tr("Perfil novo")}</option>` +
    locals.map((p) => `<option value="${esc(p.id)}"${p.id === sel ? " selected" : ""}>${esc(deckLabel(p))}</option>`).join("");
  closeAnyModal();
  const backdrop = el(`
    <div class="modal-backdrop">
      <div class="modal-sheet merge-sheet">
        <h2>${extra && extra.title ? esc(extra.title) : tr("Fundir perfis")}</h2>
        <p class="merge-summary" id="mg-summary"></p>
        ${pick.length ? `
          <div class="section-title">${tr("Confirmar")}</div>
          <p class="merge-hint">${tr("Escolhe com que perfil deste telemóvel junta cada um. Os sugeridos parecem o mesmo deck (mesmo jogador e commander).")}</p>
          <div class="col merge-list">${pick.map((r, i) => `
            <div class="merge-row" data-i="${i}">
              <div class="merge-from">
                <span class="merge-name">${esc(deckLabel(r.incoming))}</span>
                <span class="merge-games" data-games></span>
              </div>
              <div class="merge-to">
                ${I("arrow-right")}
                <select class="merge-select" aria-label="${esc(tr("Juntar com"))}">${options(r.match && r.match.id)}</select>
              </div>
              ${r.match ? `<span class="merge-suggested">${tr("Sugerido")}</span>` : ""}
            </div>`).join("")}</div>` : ""}
        ${auto.length ? `
          <div class="section-title">${tr("Já ligados")}</div>
          <div class="col merge-list">${auto.map((r) => `
            <div class="merge-row linked">
              <div class="merge-from">
                <span class="merge-name">${esc(deckLabel(r.match))}</span>
                <span class="merge-games">${r.newGames ? tr("+{n} jogo(s) novo(s)", { n: r.newGames }) : tr("sem jogos novos")}</span>
              </div>
            </div>`).join("")}</div>` : ""}
        <div class="row" style="margin-top:16px">
          <button class="btn btn-ghost grow" id="mg-cancel">${tr("Cancelar")}</button>
          <button class="btn btn-primary grow" id="mg-go">${I("merge")} ${extra && extra.confirmLabel ? esc(extra.confirmLabel) : tr("Fundir")}</button>
        </div>
      </div>
    </div>`);
  document.body.appendChild(backdrop);
  const selects = Array.from(backdrop.querySelectorAll(".merge-row[data-i]"));
  function paint() {
    let games = auto.reduce((a, r) => a + r.newGames, 0);
    let newProfiles = 0;
    const used = new Map();
    selects.forEach((row) => {
      const r = pick[+row.dataset.i];
      const to = row.querySelector("select").value;
      const n = newGamesFor(r, to);
      games += n;
      if (!to) newProfiles++;
      else used.set(to, (used.get(to) || 0) + 1);
      row.querySelector("[data-games]").textContent = n ? tr("+{n} jogo(s) novo(s)", { n }) : tr("sem jogos novos");
    });
    const dup = rows.reduce((a, r) => a + (Array.isArray(r.incoming.history) ? r.incoming.history.length : 0), 0) - games;
    backdrop.querySelector("#mg-summary").textContent =
      tr("Vão entrar {g} jogo(s) e {p} perfil(is) novo(s).", { g: games, p: newProfiles }) +
      (dup > 0 ? " " + tr("{n} jogo(s) já existiam e não vão ser repetidos.", { n: dup }) : "");
  }
  selects.forEach((row) => row.querySelector("select").addEventListener("change", paint));
  paint();
  const close = () => backdrop.remove();
  backdrop.querySelector("#mg-cancel").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector("#mg-go").addEventListener("click", () => {
    const targets = {};
    auto.forEach((r) => { targets[r.incoming.id] = r.match.id; });
    selects.forEach((row) => { targets[pick[+row.dataset.i].incoming.id] = row.querySelector("select").value || null; });
    const before = Profiles.snapshot();
    if (extra && extra.playerAliases) Profiles.addPlayerAliases(extra.playerAliases);
    const res = Profiles.applyMerge(list, targets);
    if (extra && extra.lastSetup && !loadLastSetup()) {
      try { localStorage.setItem(LAST_SETUP_KEY, JSON.stringify(extra.lastSetup)); } catch (e) {}
    }
    close();
    if (extra && extra.onApplied) { extra.onApplied(res); return; }
    done && done();
    undoToast(tr("Fundido: {g} jogo(s) e {p} perfil(is) novo(s)", { g: res.games, p: res.profiles }), () => {
      Profiles.replaceAll(before);
      done && done();
      toast(tr("Fusão desfeita"));
    }, 8000);
  });
}

/** Mostra os meus perfis como QR animado (várias partes em ciclo). */
async function openQrShow() {
  closeAnyModal();
  const backdrop = el(`
    <div class="modal-backdrop">
      <div class="modal-sheet qr-sheet">
        <h2>${tr("Mostrar QR")}</h2>
        <p class="merge-hint">${tr("No outro telemóvel: Perfis → Juntar com outro telemóvel → Ler QR. Mantém este ecrã aberto até ele dizer que terminou.")}</p>
        <div class="qr-box"><canvas id="qr-canvas"></canvas></div>
        <div class="qr-status" id="qr-status">${tr("A preparar…")}</div>
        <button class="btn btn-ghost btn-block" id="qr-close" style="margin-top:12px">${tr("Fechar")}</button>
      </div>
    </div>`);
  document.body.appendChild(backdrop);
  let timer = null;
  const close = () => { clearInterval(timer); backdrop.remove(); };
  backdrop.querySelector("#qr-close").addEventListener("click", close);
  const status = backdrop.querySelector("#qr-status");
  let frames;
  try {
    frames = await MTG.QrSync.encode({ app: "mtg-life-counter", type: "qr-merge", version: 1, profiles: Profiles.all(), playerAliases: Profiles.playerAliases() });
  } catch (e) {
    status.textContent = e && e.message === "too-big" ? tr("Há dados demais para QR. Usa o ficheiro.") : tr("Não foi possível criar o QR. Usa o ficheiro.");
    return;
  }
  const canvas = backdrop.querySelector("#qr-canvas");
  const size = Math.min(320, window.innerWidth - 72);
  let i = 0;
  const show = () => {
    if (!backdrop.isConnected) { clearInterval(timer); return; }
    MTG.QrSync.draw(canvas, frames[i], size).catch(() => {});
    status.textContent = frames.length > 1 ? tr("Parte {i} de {n}", { i: i + 1, n: frames.length }) : tr("Pronto a ler");
    i = (i + 1) % frames.length;
  };
  show();
  if (frames.length > 1) timer = setInterval(show, 350);
}

/** Lê com a câmara o QR (animado) do outro telemóvel e abre a revisão. */
async function openQrScan(done) {
  closeAnyModal();
  const backdrop = el(`
    <div class="modal-backdrop">
      <div class="modal-sheet qr-sheet">
        <h2>${tr("Ler QR")}</h2>
        <p class="merge-hint">${tr("Aponta para o QR do outro telemóvel. Se mudar de parte em parte, mantém-no apontado até a barra encher.")}</p>
        <div class="qr-video"><video id="qr-video" playsinline muted></video><span class="qr-frame" aria-hidden="true"></span></div>
        <div class="qr-progress"><span id="qr-bar"></span></div>
        <div class="qr-status" id="qr-status">${tr("A abrir a câmara…")}</div>
        <button class="btn btn-ghost btn-block" id="qr-close" style="margin-top:12px">${tr("Cancelar")}</button>
      </div>
    </div>`);
  document.body.appendChild(backdrop);
  const status = backdrop.querySelector("#qr-status");
  const bar = backdrop.querySelector("#qr-bar");
  let stop = () => {};
  let finished = false;
  const close = () => { stop(); backdrop.remove(); };
  backdrop.querySelector("#qr-close").addEventListener("click", close);
  const col = MTG.QrSync.collector();
  try {
    stop = await MTG.QrSync.scan(backdrop.querySelector("#qr-video"), (bytes) => {
      if (finished || !col.add(bytes)) return;
      bar.style.width = Math.round((col.got / col.total) * 100) + "%";
      status.textContent = tr("{got} de {n} partes lidas", { got: col.got, n: col.total });
      if (navigator.vibrate) navigator.vibrate(15);
      if (!col.done) return;
      finished = true;
      stop();
      col.result().then((data) => {
        backdrop.remove();
        // QR de um grupo na nuvem: entra nesse grupo
        if (data && data.type === "mtg-group" && data.code) { joinGroupFlow(data.code, done); return; }
        const list = data && Array.isArray(data.profiles) ? data.profiles : null;
        if (!list) { alert(tr("Este QR não é de perfis desta app.")); return; }
        openMergeReview(list, { playerAliases: data.playerAliases }, done);
      }).catch((e) => {
        status.textContent = e && e.message === "no-decompress" ? tr("Este telemóvel não consegue ler estes dados. Usa o ficheiro.") : tr("Não foi possível ler os dados. Tenta outra vez.");
      });
    });
    if (!backdrop.isConnected) stop(); // fechou enquanto a câmara abria
    else if (!finished) status.textContent = tr("À procura do QR…");
  } catch (e) {
    status.textContent = tr("Sem acesso à câmara. Dá permissão nas definições ou usa o ficheiro.");
  }
}

// ---------------------------------------------------------
// Fundir dois decks / dois jogadores deste aparelho (nomes ou
// alcunhas diferentes para o mesmo deck ou a mesma pessoa)
// ---------------------------------------------------------
const normName = (x) => String(x || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const sameDeck = (a, b) => {
  const ca = a.commander && normName(a.commander.name);
  const cb = b.commander && normName(b.commander.name);
  return (ca && ca === cb) || normName(a.name) === normName(b.name);
};

/** Escolha "fica este / fica o outro" (segmented). */
function keepSegHtml(id, a, b, sel) {
  return `
    <div class="section-title">${tr("Fica com o nome")}</div>
    <div class="seg" id="${id}" role="tablist">
      <button type="button" class="seg-btn" data-k="a" aria-selected="${sel === "a"}">${esc(a)}</button>
      <button type="button" class="seg-btn" data-k="b" aria-selected="${sel === "b"}">${esc(b)}</button>
    </div>`;
}
function bindSeg(root, id, onPick) {
  root.querySelectorAll(`#${id} .seg-btn`).forEach((btn) => btn.addEventListener("click", () => {
    root.querySelectorAll(`#${id} .seg-btn`).forEach((x) => x.setAttribute("aria-selected", String(x === btn)));
    onPick(btn.dataset.k);
  }));
}

function openMergeDeckSheet(profileId) {
  const me = Profiles.get(profileId);
  if (!me) return;
  const others = Profiles.all().filter((p) => p.id !== me.id).map((p) => ({
    p, suggested: sameDeck(me, p), samePlayer: normName(p.playerName) === normName(me.playerName),
  })).sort((x, y) => (y.suggested - x.suggested) || (y.samePlayer - x.samePlayer) || x.p.name.localeCompare(y.p.name));
  if (!others.length) { toast(tr("Não há outro deck para fundir")); return; }
  closeAnyModal();
  const backdrop = el(`
    <div class="modal-backdrop">
      <div class="modal-sheet merge-sheet">
        <h2>${tr("Fundir deck")}</h2>
        <p class="merge-hint">${tr("Junta «{name}» com outro deck que seja o mesmo (por exemplo, criado com outro nome). Os jogos e as estatísticas somam-se e fica só um.", { name: esc(me.name) })}</p>
        <div class="col merge-list" id="md-list">${others.map(({ p, suggested }) => `
          <label class="merge-row pick">
            <input type="radio" name="md-target" value="${esc(p.id)}">
            <span class="merge-from">
              <span class="merge-name">${esc(deckLabel(p))}</span>
              <span class="merge-games">${tr("{n} jogo(s)", { n: p.stats.games })}</span>
            </span>
            ${suggested ? `<span class="merge-suggested">${tr("Parecido")}</span>` : ""}
          </label>`).join("")}</div>
        <div id="md-keep"></div>
        <p class="merge-summary" id="md-summary"></p>
        <div class="row" style="margin-top:12px">
          <button class="btn btn-ghost grow" id="md-cancel">${tr("Cancelar")}</button>
          <button class="btn btn-primary grow" id="md-go" disabled>${I("merge")} ${tr("Fundir")}</button>
        </div>
      </div>
    </div>`);
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector("#md-cancel").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  let other = null;
  let keep = "a"; // a = este deck, b = o escolhido
  function paint() {
    if (!other) return;
    const kept = keep === "a" ? me : other;
    const gone = keep === "a" ? other : me;
    const g = me.stats.games + other.stats.games;
    const w = me.stats.wins + other.stats.wins;
    backdrop.querySelector("#md-summary").textContent = tr("«{kept}» fica com {g} jogo(s) e {w} vitória(s); «{gone}» deixa de existir.", { kept: kept.name, gone: gone.name, g, w });
  }
  backdrop.querySelectorAll('input[name="md-target"]').forEach((r) => r.addEventListener("change", () => {
    other = Profiles.get(r.value);
    keep = other.stats.games > me.stats.games ? "b" : "a";
    const wrap = backdrop.querySelector("#md-keep");
    wrap.innerHTML = keepSegHtml("md-seg", me.name, other.name, keep);
    bindSeg(wrap, "md-seg", (k) => { keep = k; paint(); });
    backdrop.querySelector("#md-go").disabled = false;
    paint();
  }));
  backdrop.querySelector("#md-go").addEventListener("click", () => {
    if (!other) return;
    const kept = keep === "a" ? me : other;
    const gone = keep === "a" ? other : me;
    const before = Profiles.snapshot();
    Profiles.mergeProfiles(gone.id, kept.id);
    close();
    nav("profile-detail", { id: kept.id, fromPlayer: screenParams.fromPlayer });
    undoToast(tr("Decks fundidos"), () => { Profiles.replaceAll(before); nav("profile-detail", { id: me.id, fromPlayer: screenParams.fromPlayer }); }, 8000);
  });
}

function openMergePlayerSheet(playerKey) {
  const players = playersFromProfiles(Profiles.all());
  const me = players.find((x) => x.key === playerKey);
  if (!me) return;
  const others = players.filter((x) => x !== me).sort((a, b) => a.name.localeCompare(b.name));
  if (!others.length) { toast(tr("Não há outro jogador para fundir")); return; }
  closeAnyModal();
  const backdrop = el(`
    <div class="modal-backdrop">
      <div class="modal-sheet merge-sheet">
        <h2>${tr("Fundir jogador")}</h2>
        <p class="merge-hint">${tr("Junta «{name}» com outro jogador que seja a mesma pessoa (outro nome ou alcunha). A app passa a reconhecer os dois nomes, também ao juntar com outro telemóvel.", { name: esc(me.name) })}</p>
        <div class="col merge-list">${others.map((o, i) => `
          <label class="merge-row pick">
            <input type="radio" name="mp-target" value="${i}">
            <span class="merge-from">
              <span class="merge-name">${esc(o.name)}</span>
              <span class="merge-games">${tr("{n} deck(s)", { n: o.profiles.length })} · ${tr("{n} jogo(s)", { n: o.games })}</span>
            </span>
          </label>`).join("")}</div>
        <div id="mp-keep"></div>
        <div id="mp-decks"></div>
        <div class="row" style="margin-top:12px">
          <button class="btn btn-ghost grow" id="mp-cancel">${tr("Cancelar")}</button>
          <button class="btn btn-primary grow" id="mp-go" disabled>${I("merge")} ${tr("Fundir")}</button>
        </div>
      </div>
    </div>`);
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector("#mp-cancel").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  let other = null;
  let keep = "a";
  let pairs = [];
  backdrop.querySelectorAll('input[name="mp-target"]').forEach((r) => r.addEventListener("change", () => {
    other = others[+r.value];
    keep = other.games > me.games ? "b" : "a";
    const wrap = backdrop.querySelector("#mp-keep");
    wrap.innerHTML = keepSegHtml("mp-seg", me.name, other.name, keep);
    bindSeg(wrap, "mp-seg", (k) => { keep = k; });
    // decks dos dois que parecem o mesmo: sugere fundi-los também
    pairs = [];
    const used = new Set();
    me.profiles.forEach((a) => {
      const b = other.profiles.find((x) => !used.has(x.id) && sameDeck(a, x));
      if (b) { used.add(b.id); pairs.push([a, b]); }
    });
    backdrop.querySelector("#mp-decks").innerHTML = pairs.length ? `
      <div class="section-title">${tr("Decks repetidos")}</div>
      <p class="merge-hint">${tr("Estes decks parecem o mesmo nos dois nomes. Marcados = fundir também.")}</p>
      <div class="col merge-list">${pairs.map(([a, b], i) => `
        <label class="merge-row pick">
          <input type="checkbox" data-pair="${i}" checked>
          <span class="merge-from"><span class="merge-name">${esc(a.name)} + ${esc(b.name)}</span>
          <span class="merge-games">${tr("{n} jogo(s)", { n: a.stats.games + b.stats.games })}</span></span>
        </label>`).join("")}</div>` : "";
    backdrop.querySelector("#mp-go").disabled = false;
  }));
  backdrop.querySelector("#mp-go").addEventListener("click", () => {
    if (!other) return;
    const kept = keep === "a" ? me : other;
    const gone = keep === "a" ? other : me;
    const before = Profiles.snapshot();
    Profiles.mergePlayers(gone.name, kept.name);
    backdrop.querySelectorAll("input[data-pair]").forEach((cb) => {
      if (!cb.checked) return;
      const [a, b] = pairs[+cb.dataset.pair];
      const [to, from] = a.stats.games >= b.stats.games ? [a, b] : [b, a];
      Profiles.mergeProfiles(from.id, to.id);
    });
    close();
    const key = kept.name.trim().toLowerCase();
    nav("player-detail", { key });
    undoToast(tr("Jogadores fundidos"), () => { Profiles.replaceAll(before); nav("player-detail", { key: me.key }); }, 8000);
  });
}

// ---------------------------------------------------------
// Sincronização na nuvem (grupo com código)
// ---------------------------------------------------------
const Cloud = window.MTG.Cloud;
function agoText(ts) {
  if (!ts) return tr("nunca");
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return tr("agora mesmo");
  if (s < 3600) return tr("há {n} min", { n: Math.max(1, Math.round(s / 60)) });
  return relativeDay(ts);
}
/** Cartão no ecrã de perfis: estado da sincronização ou convite. */
function syncCardHtml() {
  const st = Cloud.status();
  if (!st.code) {
    return `
      <div class="sync-card off" id="sync-card">
        <span class="sync-ic">${I("cloud")}</span>
        <span class="sync-text">
          <span class="sync-title">${tr("Guardar na nuvem")}</span>
          <span class="sync-sub">${tr("Perfis guardados online e iguais em todos os telemóveis do grupo.")}</span>
        </span>
        <button class="btn btn-primary btn-sm" id="sync-open-btn">${tr("Ativar")}</button>
      </div>`;
  }
  const title = st.syncing ? tr("A sincronizar…")
    : st.lastError ? tr("Sem ligação — tenta mais tarde")
    : tr("Sincronizado {when}", { when: agoText(st.lastSync) });
  return `
    <div class="sync-card ${st.lastError && !st.syncing ? "err" : ""}" id="sync-card">
      <span class="sync-ic">${I(st.lastError && !st.syncing ? "cloud-off" : "cloud")}</span>
      <span class="sync-text">
        <span class="sync-title">${title}</span>
        <span class="sync-sub sync-code">${tr("Grupo {code}", { code: esc(st.code) })}</span>
      </span>
      <button class="btn btn-icon ${st.syncing ? "spin" : ""}" id="sync-now-btn" title="${tr("Sincronizar agora")}" aria-label="${tr("Sincronizar agora")}">${I("rotate")}</button>
      <button class="btn btn-ghost btn-sm" id="sync-open-btn">${tr("Grupo")}</button>
    </div>`;
}
function bindSyncCard(scope) {
  const card = scope.querySelector("#sync-card");
  if (!card) return;
  const openBtn = card.querySelector("#sync-open-btn");
  if (openBtn) openBtn.addEventListener("click", () => openCloudSheet());
  const now = card.querySelector("#sync-now-btn");
  if (now) now.addEventListener("click", () => {
    Cloud.sync().then((r) => { if (r && (r.profiles || r.games || r.removed)) render(); }).catch(() => toast(tr("Sem ligação — tenta mais tarde")));
  });
}
function repaintSyncCard() {
  const card = document.querySelector("#sync-card");
  if (!card) return;
  const fresh = el(syncCardHtml());
  card.replaceWith(fresh);
  bindSyncCard(fresh.parentNode || document);
}

/** Entrar num grupo: lê-o, mostra a revisão (pares parecidos a confirmar)
 *  e só depois entra e sincroniza. */
async function joinGroupFlow(rawCode, done) {
  const code = Cloud.normalizeCode(rawCode);
  if (!code) { alert(tr("Código inválido. Tem 12 letras/números, ex: K7QD-9XWM-2HPA.")); return; }
  toast(tr("A procurar o grupo…"));
  let remote;
  try { remote = await Cloud.peekGroup(code); } catch (e) { alert(tr("Sem ligação — tenta mais tarde")); return; }
  if (!remote || !remote.data) { alert(tr("Não existe nenhum grupo com esse código.")); return; }
  const dead = (remote.data.deleted && remote.data.deleted.profiles) || {};
  const list = (remote.data.profiles || []).filter((p) => p && !dead[p.id]);
  const enter = () => {
    Cloud.joinGroup(code)
      .then(() => { toast(tr("Entraste no grupo")); render(); done && done(); })
      .catch(() => { toast(tr("Sem ligação — tenta mais tarde")); render(); });
  };
  if (!list.length) { enter(); return; }
  openMergeReview(list, { playerAliases: remote.data.playerAliases, title: tr("Entrar no grupo"), confirmLabel: tr("Juntar e entrar"), onApplied: enter }, done);
}

/** Janela do grupo: criar/entrar (sem grupo) ou código, QR e sair. */
function openCloudSheet(prefillCode) {
  closeAnyModal();
  const st = Cloud.status();
  const backdrop = el(st.code ? `
    <div class="modal-backdrop">
      <div class="modal-sheet qr-sheet cloud-sheet">
        <h2>${tr("Grupo na nuvem")}</h2>
        <p class="merge-hint">${tr("Quem tiver este código vê e junta os mesmos perfis e jogos. Partilha-o só com quem joga contigo.")}</p>
        <div class="cloud-code">${esc(st.code)}</div>
        <div class="qr-box"><canvas id="cloud-qr"></canvas></div>
        <div class="merge-actions" style="margin-top:14px">
          <button class="btn btn-ghost" id="cloud-share">${I("share")} ${tr("Partilhar código")}</button>
          <button class="btn btn-ghost" id="cloud-sync">${I("rotate")} ${tr("Sincronizar agora")}</button>
        </div>
        <button class="btn btn-ghost btn-block danger-text" id="cloud-leave">${tr("Sair do grupo")}</button>
        <button class="btn btn-ghost btn-block" id="cloud-close" style="margin-top:8px">${tr("Fechar")}</button>
      </div>
    </div>` : `
    <div class="modal-backdrop">
      <div class="modal-sheet cloud-sheet">
        <h2>${tr("Guardar na nuvem")}</h2>
        <p class="merge-hint">${tr("Os perfis e jogos ficam guardados online, num grupo com um código. Se apagares a app ou trocares de telemóvel, entras com o código e fica tudo de volta. Quem tiver o código vê e junta os mesmos perfis.")}</p>
        <button class="btn btn-primary btn-block" id="cloud-create">${I("cloud")} ${tr("Criar grupo")}</button>
        <div class="section-title">${tr("Já tenho um código")}</div>
        <div class="cloud-join">
          <input type="text" id="cloud-code-input" placeholder="K7QD-9XWM-2HPA" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="16">
          <button class="btn btn-primary" id="cloud-join">${tr("Entrar")}</button>
        </div>
        <button class="btn btn-ghost btn-block" id="cloud-scan" style="margin-top:8px">${I("scan")} ${tr("Ler QR do grupo")}</button>
        <button class="btn btn-ghost btn-block" id="cloud-close" style="margin-top:8px">${tr("Fechar")}</button>
      </div>
    </div>`);
  document.body.appendChild(backdrop);
  // código já escrito (ex: voltar ao grupo depois de apagar tudo)
  const codeInput = backdrop.querySelector("#cloud-code-input");
  if (codeInput && typeof prefillCode === "string") codeInput.value = prefillCode;
  const close = () => backdrop.remove();
  backdrop.querySelector("#cloud-close").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  if (st.code) {
    MTG.QrSync.encode({ type: "mtg-group", code: st.code })
      .then((frames) => MTG.QrSync.draw(backdrop.querySelector("#cloud-qr"), frames[0], Math.min(220, window.innerWidth - 120)))
      .catch(() => {});
    backdrop.querySelector("#cloud-share").addEventListener("click", async () => {
      const text = tr("Código do nosso grupo no MTG Life Counter: {code}", { code: st.code });
      try {
        if (navigator.share) { await navigator.share({ text }); return; }
      } catch (e) { if (e && e.name === "AbortError") return; }
      try { await navigator.clipboard.writeText(st.code); toast(tr("Código copiado")); } catch (e) { toast(st.code); }
    });
    backdrop.querySelector("#cloud-sync").addEventListener("click", () => {
      close();
      Cloud.sync().then(() => { toast(tr("Sincronizado")); render(); }).catch(() => toast(tr("Sem ligação — tenta mais tarde")));
    });
    backdrop.querySelector("#cloud-leave").addEventListener("click", () => {
      if (!confirm(tr("Sair do grupo? Os perfis continuam neste telemóvel, mas deixam de sincronizar."))) return;
      Cloud.leaveGroup();
      close();
      render();
    });
    return;
  }
  backdrop.querySelector("#cloud-create").addEventListener("click", () => {
    close();
    toast(tr("A criar o grupo…"));
    Cloud.createGroup()
      .then(() => { render(); openCloudSheet(); })
      .catch(() => { Cloud.leaveGroup(); alert(tr("Sem ligação — tenta mais tarde")); render(); });
  });
  const input = backdrop.querySelector("#cloud-code-input");
  const join = () => { const v = input.value; close(); joinGroupFlow(v, render); };
  backdrop.querySelector("#cloud-join").addEventListener("click", join);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
  backdrop.querySelector("#cloud-scan").addEventListener("click", () => openQrScan(render));
}

/** Menu "Juntar com outro telemóvel": enviar os meus / receber os do outro. */
function openMergeMenu(done) {
  closeAnyModal();
  const backdrop = el(`
    <div class="modal-backdrop">
      <div class="modal-sheet">
        <h2>${tr("Juntar com outro telemóvel")}</h2>
        <p class="merge-hint">${tr("Para os dois ficarem com os mesmos perfis e jogos, cada um envia os seus e recebe os do outro. Os jogos que já existam não se repetem.")}</p>
        <div class="section-title">${tr("Enviar os meus")}</div>
        <div class="merge-actions">
          <button class="btn btn-ghost" id="mm-send-qr">${I("qr")} ${tr("Mostrar QR")}</button>
          <button class="btn btn-ghost" id="mm-send-file">${I("upload")} ${tr("Enviar ficheiro")}</button>
        </div>
        <div class="section-title">${tr("Receber do outro")}</div>
        <div class="merge-actions">
          <button class="btn btn-ghost" id="mm-recv-qr">${I("scan")} ${tr("Ler QR")}</button>
          <button class="btn btn-ghost" id="mm-recv-file">${I("download")} ${tr("Abrir ficheiro")}</button>
        </div>
        <input type="file" id="mm-file" accept="application/json,.json" style="display:none">
        <button class="btn btn-ghost btn-block" id="mm-close" style="margin-top:16px">${tr("Fechar")}</button>
      </div>
    </div>`);
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector("#mm-close").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector("#mm-send-file").addEventListener("click", () => saveBackup());
  backdrop.querySelector("#mm-send-qr").addEventListener("click", () => openQrShow());
  backdrop.querySelector("#mm-recv-qr").addEventListener("click", () => openQrScan(done));
  const input = backdrop.querySelector("#mm-file");
  backdrop.querySelector("#mm-recv-file").addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    const f = input.files && input.files[0];
    input.value = "";
    if (f) restoreBackupFile(f, done);
  });
}

function backupReminderHtml() {
  const games = Profiles.gameCount();
  const info = backupInfo();
  const since = games - (info.games || 0);
  if (since < BACKUP_EVERY || games - (info.snooze || 0) < BACKUP_EVERY) return "";
  // num grupo na nuvem sincronizado na última semana os dados já estão guardados
  const cs = Cloud.status();
  if (cs.code && cs.lastSync && Date.now() - cs.lastSync < 7 * 86400000) return "";
  const msg = info.at
    ? tr("{n} jogos novos desde a última cópia ({when}).", { n: since, when: relativeDay(info.at) })
    : tr("Tens {n} jogos guardados só neste aparelho. Guarda uma cópia nos Ficheiros ou no iCloud para não os perderes.", { n: games });
  return `
    <div class="backup-card">
      <span class="backup-text">
        <span class="last-kicker">${tr("Cópia de segurança")}</span>
        <span class="backup-msg" title="${esc(msg)}">${tr("{n} jogos sem cópia", { n: info.at ? since : games })}</span>
      </span>
      <button class="btn btn-primary" id="backup-btn">${tr("Guardar")}</button>
      <button class="btn btn-icon" id="backup-later-btn" title="${tr("Agora não")}" aria-label="${tr("Agora não")}">${I("x")}</button>
    </div>`;
}

// ===========================================================
// APAGAR TODOS OS DADOS — começar de novo (e importar de novo)
// ===========================================================
/** Confirmação para apagar todos os perfis e jogos deste aparelho. Se o
 *  aparelho estiver num grupo da nuvem, sai do grupo (os dados na nuvem
 *  ficam lá: voltar a entrar traz tudo de volta). Depois sugere importar. */
function openResetAllSheet() {
  closeAnyModal();
  const cloud = Cloud.status();
  const profiles = Profiles.all();
  const games = Profiles.gamesList().length;
  const backdrop = el(`
    <div class="modal-backdrop">
      <div class="modal-sheet reset-sheet">
        <h2>${tr("Apagar todos os dados")}</h2>
        <p class="merge-hint">${tr("Apaga deste aparelho {p} deck(s), {g} jogo(s), os jogadores e as estatísticas, para começares de novo ou voltares a importar de um ficheiro ou da nuvem.", { p: profiles.length, g: games })}</p>
        ${cloud.code ? `<p class="merge-hint">${tr("Este aparelho sai do grupo {code}. Os dados na nuvem não são apagados: para os trazer de volta, volta a entrar no grupo com o mesmo código.", { code: `<b>${esc(cloud.code)}</b>` })}</p>` : ""}
        <button type="button" class="btn btn-ghost btn-block" id="ra-export">${I("download")} ${tr("Exportar uma cópia primeiro")}</button>
        <button type="button" class="btn btn-block danger-btn" id="ra-go">${I("trash")} ${tr("Apagar tudo")}</button>
        <button type="button" class="btn btn-ghost btn-block" id="ra-cancel">${tr("Cancelar")}</button>
      </div>
    </div>`);
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector("#ra-cancel").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector("#ra-export").addEventListener("click", () => saveBackup());
  const go = backdrop.querySelector("#ra-go");
  let armed = false, timer = null;
  go.addEventListener("click", () => {
    // dois toques: o primeiro só pede confirmação
    if (!armed) {
      armed = true;
      go.innerHTML = `${I("trash")} ${tr("Toca outra vez para apagar tudo")}`;
      timer = setTimeout(() => { armed = false; go.innerHTML = `${I("trash")} ${tr("Apagar tudo")}`; }, 4000);
      return;
    }
    clearTimeout(timer);
    const cloudState = localStorage.getItem("mtg_lc_cloud_v1");
    if (cloud.code) Cloud.leaveGroup(); // antes de apagar: assim não sincroniza o vazio
    const backup = Profiles.resetAll();
    close();
    render();
    toast(tr("Dados apagados"));
    openRestartSheet(cloud.code, () => {
      Profiles.restoreAll(backup);
      if (cloudState) localStorage.setItem("mtg_lc_cloud_v1", cloudState);
      render();
      toast(tr("Dados repostos"));
    });
  });
}

/** Depois de apagar: importar de um ficheiro, entrar no grupo da nuvem ou
 *  desfazer (repõe tudo como estava). */
function openRestartSheet(oldCode, undo) {
  const backdrop = el(`
    <div class="modal-backdrop">
      <div class="modal-sheet">
        <h2>${tr("Começar de novo")}</h2>
        <p class="merge-hint">${tr("Queres trazer dados agora?")}</p>
        <button type="button" class="btn btn-ghost btn-block" id="rs-file">${I("upload")} ${tr("Importar de um ficheiro")}</button>
        <button type="button" class="btn btn-ghost btn-block" id="rs-cloud">${I("cloud")} ${oldCode ? tr("Voltar a entrar no grupo {code}", { code: esc(oldCode) }) : tr("Entrar num grupo da nuvem")}</button>
        <button type="button" class="btn btn-ghost btn-block" id="rs-none">${tr("Agora não")}</button>
        <button type="button" class="btn btn-ghost btn-block danger-text" id="rs-undo">${I("undo")} ${tr("Desfazer — repor os dados apagados")}</button>
      </div>
    </div>`);
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector("#rs-none").addEventListener("click", close);
  backdrop.querySelector("#rs-undo").addEventListener("click", () => { close(); if (undo) undo(); });
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector("#rs-file").addEventListener("click", () => {
    close();
    const input = document.querySelector("#import-profiles-input");
    if (input) input.click();
  });
  backdrop.querySelector("#rs-cloud").addEventListener("click", () => { close(); openCloudSheet(oldCode); });
}
