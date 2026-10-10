/* ===========================================================
   ui/games-edit.js — Editar um jogo do histórico e registar um jogo à
   mão (jogado sem o contador).

   As duas usam a mesma janela: um lugar por deck (ou convidado sem
   deck), quem jogou, o commander usado, o vencedor e, se se quiser, a
   duração. Sem tempo, o jogo não conta para as médias de tempo.
   =========================================================== */

const MANUAL_MODES = ["commander", "duel", "free", "br"];

/** Minutos (texto) → ms, ou 0. */
function minutesToMs(v) {
  const n = parseFloat(String(v || "").replace(",", "."));
  return n > 0 ? Math.round(n * 60000) : 0;
}

/** Valor para <input type="datetime-local"> a partir de um timestamp. */
function toLocalInput(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Janela do jogo. cfg = { title, edit (bool), mode, date, timed, minutes,
 *  seats: [{ profileId, gameId?, who, commander, guest? }], winner (índice
 *  ou -1), onSave(form) → true se gravou }. */
function openGameSheet(cfg) {
  closeAnyModal();
  const st = {
    mode: cfg.mode || "commander",
    timed: !!cfg.timed,
    seats: cfg.seats.map((s) => Object.assign({}, s)),
    winner: typeof cfg.winner === "number" ? cfg.winner : -1,
  };
  const players = knownPlayers();
  const backdrop = el(`
    <div class="modal-backdrop">
      <div class="modal-sheet game-sheet">
        <h2>${esc(cfg.title)}</h2>
        ${cfg.edit ? `<div class="mg-meta">${esc(modeLabel(st.mode))} · ${formatDateTime(cfg.date)}</div>` : `
        <div class="mg-field">
          <label>${tr("Modo")}</label>
          <div class="mg-modes" role="group">${MANUAL_MODES.map((m) => `<button type="button" class="sort-chip" data-mode="${m}" aria-pressed="${m === st.mode}">${esc(modeLabel(m))}</button>`).join("")}</div>
        </div>
        <div class="mg-field">
          <label for="mg-date">${tr("Data")}</label>
          <input type="datetime-local" id="mg-date" value="${toLocalInput(cfg.date || Date.now())}">
        </div>`}
        <div class="mg-field">
          <label>${tr("Lugares")}</label>
          <div class="mg-hint">${tr("Toca no troféu de quem ganhou.")}</div>
          <div class="mg-seats" id="mg-seats"></div>
          ${cfg.edit ? "" : `<button type="button" class="btn btn-ghost btn-sm" id="mg-add">${I("plus")} ${tr("Adicionar lugar")}</button>`}
        </div>
        <div class="mg-field">
          <label class="mg-switch">
            <span>
              <span class="mg-switch-title">${tr("Contar tempo")}</span>
              <span class="mg-hint">${tr("Desligado, o jogo não entra nas médias de tempo.")}</span>
            </span>
            <input type="checkbox" class="switch" id="mg-timed" ${st.timed ? "checked" : ""}>
          </label>
          <div class="mg-duration ${st.timed ? "" : "hidden"}" id="mg-duration">
            <input type="number" id="mg-minutes" inputmode="decimal" min="1" step="1" value="${cfg.minutes || ""}" placeholder="${tr("Duração")}">
            <span>${tr("minutos")}</span>
          </div>
        </div>
        <datalist id="mg-players">${players.map((n) => `<option value="${esc(n)}"></option>`).join("")}</datalist>
        <div class="row" style="margin-top:14px">
          <button class="btn btn-ghost grow" id="mg-cancel">${tr("Cancelar")}</button>
          <button class="btn btn-primary grow" id="mg-save">${cfg.edit ? tr("Guardar") : tr("Registar jogo")}</button>
        </div>
      </div>
    </div>`);
  document.body.appendChild(backdrop);
  const seatsEl = backdrop.querySelector("#mg-seats");

  function borrowNote(s) {
    const prof = s.profileId ? Profiles.get(s.profileId) : null;
    return prof && isBorrowed(s.who, prof) ? `<div class="seat-borrow">${I("user")}<span>${tr("Deck emprestado por {name}", { name: esc(prof.playerName.trim()) })}</span></div>` : "";
  }
  function seatHtml(s, i) {
    const prof = s.profileId ? Profiles.get(s.profileId) : null;
    const cmds = deckCommanders(prof);
    const cur = s.commander ? normName(s.commander.name) : (cmds[0] ? normName(cmds[0].name) : "");
    return `
      <div class="mg-seat ${st.winner === i ? "won" : ""}" data-i="${i}">
        <div class="mg-seat-top">
          ${cfg.edit || s.guest === "fixed"
            ? `<span class="mg-deck static">${prof ? `<span class="commander-thumb sm" style="${seatThumbStyle(prof)}">${prof.commander && prof.commander.art ? "" : I("card")}</span><span class="mg-deck-name">${esc(prof.name)}</span>` : `<span class="mg-deck-name dim">${tr("Sem deck")}</span>`}</span>`
            : `<button type="button" class="mg-deck" data-pick="${i}">${prof ? `<span class="commander-thumb sm" style="${seatThumbStyle(prof)}">${prof.commander && prof.commander.art ? "" : I("card")}</span><span class="mg-deck-name">${esc(prof.name)}</span>` : `<span class="commander-thumb sm">${I("card")}</span><span class="mg-deck-name dim">${tr("Escolher deck")}</span>`}</button>`}
          <button type="button" class="mg-win" data-win="${i}" aria-pressed="${st.winner === i}" title="${tr("Ganhou")}" aria-label="${tr("Ganhou")}">${I("trophy")}</button>
          ${cfg.edit ? "" : `<button type="button" class="btn btn-icon mg-del" data-del="${i}" title="${tr("Remover")}" aria-label="${tr("Remover")}">${I("x")}</button>`}
        </div>
        <input type="text" class="mg-who" data-who="${i}" list="mg-players" value="${esc(s.who || "")}" placeholder="${prof && prof.playerName ? esc(tr("Quem jogou (dono: {name})", { name: prof.playerName })) : tr("Quem jogou")}" ${s.guest === "fixed" ? "readonly" : ""}>
        <div class="mg-borrow">${borrowNote(s)}</div>
        ${cmds.length > 1 ? `<div class="seat-alt">${cmds.map((c, k) => `
          <button type="button" class="recent-chip alt-chip" data-alt="${i}:${k}" aria-pressed="${normName(c.name) === cur}">
            <span class="recent-avatar" style="${c.art ? commanderThumbStyle(c) : ""}">${c.art ? "" : esc(c.name.slice(0, 2).toUpperCase())}</span>
            <span class="recent-name">${esc(c.name)}</span>
          </button>`).join("")}</div>` : ""}
      </div>`;
  }
  function paint() {
    seatsEl.innerHTML = st.seats.map(seatHtml).join("");
  }
  paint();

  seatsEl.addEventListener("click", (e) => {
    const win = e.target.closest("[data-win]");
    if (win) { const i = +win.dataset.win; st.winner = st.winner === i ? -1 : i; paint(); return; }
    const del = e.target.closest("[data-del]");
    if (del) {
      const i = +del.dataset.del;
      st.seats.splice(i, 1);
      if (st.winner === i) st.winner = -1; else if (st.winner > i) st.winner--;
      paint();
      return;
    }
    const alt = e.target.closest("[data-alt]");
    if (alt) {
      const [i, k] = alt.dataset.alt.split(":").map(Number);
      const c = deckCommanders(Profiles.get(st.seats[i].profileId))[k];
      if (c) { st.seats[i].commander = c; paint(); }
      return;
    }
    const pick = e.target.closest("[data-pick]");
    if (pick) {
      const i = +pick.dataset.pick;
      openProfilePicker({
        commander: null, currentProfileId: st.seats[i].profileId, playerName: st.seats[i].who,
        onSelect: (id) => {
          const prof = id ? Profiles.get(id) : null;
          st.seats[i].who = seatNameAfterProfile(st.seats[i].who, st.seats[i].profileId, prof);
          st.seats[i].profileId = id;
          st.seats[i].commander = prof ? deckCommanders(prof)[0] || null : null;
          paint();
        },
      });
    }
  });
  // enquanto se escreve, só o aviso de empréstimo desse lugar muda (redesenhar
  // ao sair do campo mexia nos botões a meio de um toque e perdia o clique)
  seatsEl.addEventListener("input", (e) => {
    const who = e.target.closest("[data-who]");
    if (!who) return;
    const s = st.seats[+who.dataset.who];
    s.who = who.value;
    who.parentElement.querySelector(".mg-borrow").innerHTML = borrowNote(s);
  });

  const addBtn = backdrop.querySelector("#mg-add");
  if (addBtn) addBtn.addEventListener("click", () => {
    if (st.seats.length >= 8) return;
    st.seats.push({ profileId: null, who: "", commander: null });
    paint();
  });
  backdrop.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => {
    st.mode = b.dataset.mode;
    backdrop.querySelectorAll("[data-mode]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  }));
  const timedEl = backdrop.querySelector("#mg-timed");
  timedEl.addEventListener("change", () => {
    st.timed = timedEl.checked;
    backdrop.querySelector("#mg-duration").classList.toggle("hidden", !st.timed);
    if (st.timed) backdrop.querySelector("#mg-minutes").focus();
  });
  backdrop.querySelector("#mg-cancel").addEventListener("click", () => backdrop.remove());
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelector("#mg-save").addEventListener("click", () => {
    const dateEl = backdrop.querySelector("#mg-date");
    const form = {
      mode: st.mode,
      date: dateEl && dateEl.value ? new Date(dateEl.value).getTime() : cfg.date,
      timed: st.timed,
      gameTimeMs: st.timed ? minutesToMs(backdrop.querySelector("#mg-minutes").value) : 0,
      seats: st.seats,
      winner: st.winner,
    };
    if (form.timed && !form.gameTimeMs) { toast(tr("Indica a duração ou desliga \"Contar tempo\".")); return; }
    if (cfg.onSave(form)) backdrop.remove();
  });
}

/** Registar à mão um jogo jogado sem o contador. */
function openManualGame(opts) {
  opts = opts || {};
  const first = opts.profileId ? Profiles.get(opts.profileId) : null;
  const seats = Array.from({ length: 4 }, () => ({ profileId: null, who: "", commander: null }));
  if (first) seats[0] = { profileId: first.id, who: first.playerName || "", commander: deckCommanders(first)[0] || null };
  openGameSheet({
    title: tr("Registar jogo"),
    edit: false,
    mode: "commander",
    date: Date.now(),
    timed: false,
    seats,
    winner: -1,
    onSave(form) {
      const filled = form.seats.filter((s) => s.profileId || (s.who || "").trim());
      if (filled.length < 2) { toast(tr("Um jogo precisa de pelo menos 2 lugares.")); return false; }
      if (!filled.some((s) => s.profileId)) { toast(tr("Escolhe o deck de pelo menos um lugar.")); return false; }
      const ids = filled.filter((s) => s.profileId).map((s) => s.profileId);
      if (new Set(ids).size !== ids.length) { toast(tr("O mesmo deck está em dois lugares.")); return false; }
      if (form.winner < 0 || !(form.seats[form.winner].profileId || (form.seats[form.winner].who || "").trim())) { toast(tr("Escolhe quem ganhou.")); return false; }
      const before = Profiles.snapshot();
      Profiles.recordManualGame({
        date: form.date, mode: form.mode, timed: form.timed, gameTimeMs: form.gameTimeMs, winner: form.winner,
        seats: form.seats.map((s) => ({ profileId: s.profileId, name: s.who, commander: s.commander })),
      });
      render();
      undoToast(tr("Jogo registado"), () => { Profiles.replaceAll(before); render(); });
      return true;
    },
  });
}

/** Editar um jogo do histórico, em todos os decks onde ficou registado. */
function openGameEditor(profileId, gameId) {
  const group = Profiles.gameGroup(profileId, gameId);
  if (!group.length) return;
  const g0 = group[0].game;
  const seats = group.map(({ profile, game }) => ({
    profileId: profile.id, gameId: game.id,
    who: game.playedBy || profile.playerName || "",
    commander: game.commander ? (deckCommanders(profile).find((c) => normName(c.name) === normName(game.commander)) || { name: game.commander }) : deckCommanders(profile)[0] || null,
    won: !!game.won,
  }));
  // adversários sem deck registado neste aparelho entram como convidados
  const inGroup = new Set(group.map((x) => x.profile.id));
  (g0.opponents || []).forEach((o) => {
    if (!o || (o.profileId && inGroup.has(o.profileId))) return;
    const op = o.profileId ? Profiles.get(o.profileId) : null;
    const name = (o.pilot || o.name || (op && (op.playerName || op.name)) || "").trim();
    if (name) seats.push({ profileId: null, who: name, guest: "fixed", won: !!o.won });
  });
  const winner = seats.findIndex((s) => s.won);
  openGameSheet({
    title: tr("Editar jogo"),
    edit: true,
    mode: g0.mode || "standard",
    date: g0.date,
    timed: g0.timed !== false,
    minutes: g0.timed !== false && g0.gameTimeMs ? Math.round(g0.gameTimeMs / 60000) : "",
    seats,
    winner,
    onSave(form) {
      const before = Profiles.snapshot();
      const w = form.winner >= 0 ? form.seats[form.winner] : null;
      Profiles.editGame({
        timed: form.timed,
        gameTimeMs: form.gameTimeMs,
        winner: w ? (w.profileId || "guest:" + w.who) : null,
        seats: form.seats.filter((s) => s.profileId).map((s) => ({ profileId: s.profileId, gameId: s.gameId, pilot: s.who, commander: s.commander && s.commander.name })),
        guests: form.seats.filter((s) => !s.profileId).map((s) => s.who),
      });
      render();
      undoToast(tr("Jogo corrigido"), () => { Profiles.replaceAll(before); render(); });
      return true;
    },
  });
}

// ===========================================================
// SEPARADOR "JOGOS" — todos os jogos registados
// ===========================================================
let gamesShown = 30; // quantos jogos se veem (com "Ver mais")

/** Lista de todos os jogos (cada um com todos os decks que lá estiveram):
 *  editar, apagar e ligar um lugar sem deck a um deck novo ou existente. */
function renderGamesView(view) {
  if (!view) return;
  const games = Profiles.gamesList();
  const monthKey = (ts) => { const d = new Date(ts); return d.getFullYear() * 12 + d.getMonth(); };
  const monthLabel = (ts) => { const t = new Date(ts).toLocaleDateString(MTG.i18n.lang === "en" ? "en-GB" : "pt-PT", { month: "long", year: "numeric" }); return t.charAt(0).toUpperCase() + t.slice(1); };
  let lastMonth = null;
  const cards = games.slice(0, gamesShown).map((G, gi) => {
    const head = monthKey(G.date) !== lastMonth ? `<div class="section-title gl-month">${esc(monthLabel(G.date))}</div>` : "";
    lastMonth = monthKey(G.date);
    const g0 = G.seats[0].game;
    const time = g0.timed === false ? tr("sem tempo") : g0.gameTimeMs ? formatDuration(g0.gameTimeMs) : "";
    const seat = ({ profile, game }) => {
      const who = (game.playedBy || profile.playerName || "").trim();
      return `
        <button type="button" class="gl-seat ${game.won ? "won" : ""}" data-deck="${profile.id}">
          <span class="commander-thumb sm" style="${seatThumbStyle(profile)}">${profile.commander && profile.commander.art ? "" : I("card")}</span>
          <span class="gl-seat-text"><b>${esc(profile.name)}</b>${who ? `<small>${esc(who)}${game.playedBy && profile.playerName ? " · " + tr("emprestado") : ""}</small>` : ""}</span>
          ${game.won ? `<span class="gl-win">${I("trophy")}</span>` : ""}
        </button>`;
    };
    const guest = (x) => `
      <div class="gl-seat guest ${x.won ? "won" : ""}">
        <span class="commander-thumb sm">${I("user")}</span>
        <span class="gl-seat-text"><b>${esc(x.name)}</b><small>${tr("sem deck")}</small></span>
        ${x.won ? `<span class="gl-win">${I("trophy")}</span>` : ""}
        <button type="button" class="btn btn-ghost btn-sm gl-attach" data-attach="${gi}" data-guest="${esc(x.name)}">${I("plus")} ${tr("Deck")}</button>
      </div>`;
    return `${head}
      <div class="gl-game" data-g="${gi}">
        <div class="gl-top">
          <span class="gl-mode">${esc(modeLabel(G.mode))}</span>
          <span class="gl-date">${formatDateTime(G.date)}${time ? " · " + time : ""}${g0.manual ? " · " + tr("registado à mão") : ""}</span>
          <span class="gl-actions">
            <button class="btn btn-icon" data-edit-g="${gi}" title="${tr("Editar este jogo")}" aria-label="${tr("Editar este jogo")}">${I("pencil")}</button>
            <button class="btn btn-icon" data-del-g="${gi}" title="${tr("Apagar este jogo")}" aria-label="${tr("Apagar este jogo")}">${I("trash")}</button>
          </span>
        </div>
        <div class="gl-seats">${G.seats.slice().sort((a, b) => b.game.won - a.game.won).map(seat).join("")}${G.guests.map(guest).join("")}</div>
      </div>`;
  }).join("");
  const guestsTotal = games.reduce((a, G) => a + G.guests.length, 0);
  view.innerHTML = `
    <div class="section-head gl-head">
      <span class="section-title">${tr("{n} jogo(s)", { n: games.length })}</span>
      <button type="button" class="btn btn-ghost btn-sm" id="gl-manual">${I("plus")} ${tr("Registar jogo")}</button>
    </div>
    ${guestsTotal ? `<div class="mg-hint gl-hint">${tr("Lugares sem deck: toca em \"+ Deck\" para criar um perfil para esse jogador (ou escolher um deck que já exista). O jogo passa a contar para esse deck.")}</div>` : ""}
    ${games.length ? `<div class="gl-list">${cards}</div>` : `<div class="chart-card"><div class="footer-note">${tr("Ainda não há jogos registados.")}</div></div>`}
    ${games.length > gamesShown ? `<button type="button" class="btn btn-ghost btn-block" id="gl-more">${tr("Ver mais ({n})", { n: games.length - gamesShown })}</button>` : ""}`;

  view.querySelector("#gl-manual").addEventListener("click", () => openManualGame());
  const more = view.querySelector("#gl-more");
  if (more) more.addEventListener("click", () => { gamesShown += 30; renderGamesView(view); });
  view.querySelectorAll("[data-deck]").forEach((b) => b.addEventListener("click", () => nav("profile-detail", { id: b.dataset.deck })));
  view.querySelectorAll("[data-edit-g]").forEach((b) => b.addEventListener("click", () => {
    const s0 = games[+b.dataset.editG].seats[0];
    openGameEditor(s0.profile.id, s0.game.id);
  }));
  view.querySelectorAll("[data-del-g]").forEach((b) => b.addEventListener("click", () => {
    const G = games[+b.dataset.delG];
    const before = Profiles.snapshot();
    G.seats.forEach(({ profile, game }) => Profiles.removeGame(profile.id, game.id));
    render();
    undoToast(tr("Jogo apagado"), () => { Profiles.replaceAll(before); render(); });
  }));
  view.querySelectorAll("[data-attach]").forEach((b) => b.addEventListener("click", () => {
    const G = games[+b.dataset.attach];
    const s0 = G.seats[0];
    const name = b.dataset.guest;
    openProfilePicker({
      commander: null, playerName: name,
      onSelect: (id) => {
        if (!id) return;
        const before = Profiles.snapshot();
        const res = Profiles.attachGuest(s0.profile.id, s0.game.id, name, id);
        if (res.error === "same") { toast(tr("Esse deck já está neste jogo.")); return; }
        if (res.error) { toast(tr("Não foi possível ligar o deck a este jogo.")); return; }
        render();
        undoToast(tr("Jogo de {name} ligado ao deck", { name }), () => { Profiles.replaceAll(before); render(); });
      },
    });
  }));
}
