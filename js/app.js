/* ===========================================================
   app.js — controlador principal / UI
   =========================================================== */
(function () {
  const { Scryfall, State, Profiles } = window.MTG;
  const appEl = document.getElementById("app");
  const toastEl = document.getElementById("toast");
  const turnAudioEl = document.getElementById("turn-sound");

  let screen = "menu";
  let screenParams = {};
  let game = null; // estado do jogo atual (espelha o State guardado)
  let draft = null; // rascunho usado nos ecrãs de setup
  let liveTimer = null; // interval do relógio ao vivo (turno/total) no tabuleiro
  let wakeLock = null; // Screen Wake Lock ativo enquanto se está no contador de vida
  let boardFullscreen = false; // esconde as barras de cima/baixo no contador de vida (persiste entre re-renders do mesmo jogo)

  // Impede o ecrã de bloquear enquanto se está a jogar (Commander/Duelo/Livre/BR).
  // A Wake Lock API só funciona em contexto seguro (https ou localhost) e nem
  // todos os browsers a suportam — falha em silêncio nesses casos.
  async function requestWakeLock() {
    if (!("wakeLock" in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } catch (e) {
      wakeLock = null;
    }
  }
  function releaseWakeLock() {
    if (wakeLock) {
      try { wakeLock.release(); } catch (e) {}
      wakeLock = null;
    }
  }
  // Em muitos browsers a wake lock é libertada automaticamente quando a página
  // fica em background (ex: trocar de app) — volta a pedir quando se regressa,
  // mas só se ainda estivermos num ecrã de jogo.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && (screen === "game-standard" || screen === "game-br") && !wakeLock) {
      requestWakeLock();
    }
  });

  function playTurnSound() {
    if (!turnAudioEl) return;
    try {
      turnAudioEl.currentTime = 0;
      const p = turnAudioEl.play();
      if (p && p.catch) p.catch(() => {});
    } catch (e) {}
  }

  function formatDuration(ms) {
    ms = Math.max(0, Math.round(ms || 0));
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const sec = totalSec % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  function formatDateTime(ts) {
    if (!ts) return "-";
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function formatTimeOnly(ts) {
    if (!ts) return "-";
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  const MODE_LABELS = { commander: "Commander", duel: "Duelo 1v1", free: "Livre", standard: "Padrão", br: "Battle Royale" };
  function modeLabel(mode) { return MODE_LABELS[mode] || mode || "Jogo"; }

  const PRESETS = {
    commander: {
      key: "commander",
      label: "Commander Padrão",
      minPlayers: 2,
      maxPlayers: 8,
      defaultPlayers: 4,
      defaultLife: 40,
      cmdDmgToggle: false,
      cmdDmgDefault: true,
    },
    duel: {
      key: "duel",
      label: "Duelo 1v1",
      minPlayers: 2,
      maxPlayers: 2,
      defaultPlayers: 2,
      defaultLife: 40,
      cmdDmgToggle: false,
      cmdDmgDefault: true,
    },
    free: {
      key: "free",
      label: "Livre",
      minPlayers: 2,
      maxPlayers: 8,
      defaultPlayers: 4,
      defaultLife: 20,
      cmdDmgToggle: true,
      cmdDmgDefault: false,
    },
  };

  // ---------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------
  function esc(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.remove("show"), ms || 2200);
  }

  function debounce(fn, wait) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function nav(newScreen, params) {
    closeAnyModal();
    screen = newScreen;
    screenParams = params || {};
    render();
  }

  function closeAnyModal() {
    document.querySelectorAll(".modal-backdrop").forEach((m) => m.remove());
  }

  /** Tap simples + press-and-hold repetido (para os contadores de vida). */
  function bindPressRepeat(elm, callback) {
    let timer = null, interval = null, fired = false;
    function start(e) {
      e.preventDefault();
      fired = false;
      timer = setTimeout(() => {
        fired = true;
        callback(e);
        interval = setInterval(() => callback(e), 120);
      }, 420);
    }
    function stop() {
      clearTimeout(timer); clearInterval(interval); timer = null; interval = null;
    }
    function up(e) {
      if (!fired) callback(e);
      stop();
    }
    elm.addEventListener("pointerdown", start);
    elm.addEventListener("pointerup", up);
    elm.addEventListener("pointerleave", stop);
    elm.addEventListener("pointercancel", stop);
    elm.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  function commanderThumbStyle(commander) {
    if (commander && commander.art) return `background-image:url('${commander.art}')`;
    return "";
  }

  /** Fundo do "cartão" de um jogador durante o jogo: a arte do commander,
   *  ou — se ainda não escolheu nenhum — uma cor sorteada só para ele (sem
   *  repetir entre os jogadores que também não têm imagem). */
  function playerBgStyle(p) {
    if (p && p.commander && p.commander.art) return `background-image:url('${esc(p.commander.art)}')`;
    const idx = p && p.fallbackColorIdx;
    const palette = State.FALLBACK_PALETTE;
    if (typeof idx === "number" && palette && palette[idx]) {
      const [c1, c2] = palette[idx];
      return `background:linear-gradient(160deg, ${c1}, ${c2})`;
    }
    return "background:linear-gradient(160deg,#2a2f38,#12141a)";
  }

  /** HTML do fundo do painel de um jogador: uma imagem única, ou — quando
   *  tem um commander parceiro — dividido ao meio, uma metade para cada
   *  commander (o principal usa a mesma lógica de fallback que já existia;
   *  o parceiro usa a arte dele, ou repete a mesma cor de fundo se não
   *  tiver nenhuma escolhida). */
  function panelBgHtml(p) {
    if (p && p.partnerCommander) {
      const mainStyle = playerBgStyle(p);
      const partnerStyle = commanderThumbStyle(p.partnerCommander) || mainStyle;
      return `<div class="bg bg-split"><div class="bg-half" style="${mainStyle}"></div><div class="bg-half" style="${partnerStyle}"></div></div>`;
    }
    return `<div class="bg" style="${playerBgStyle(p)}"></div>`;
  }

  /** HTML do fundo do painel de uma EQUIPA: dividido em fatias iguais, uma
   *  por jogador da equipa (cada uma com a arte do commander desse jogador,
   *  ou a cor sorteada só dele se ainda não tiver escolhido nenhum) — em vez
   *  de mostrar só a arte de um único jogador da equipa. */
  function teamBgHtml(team) {
    const players = team.players || [];
    if (players.length <= 1) {
      return `<div class="bg" style="${playerBgStyle(players[0])}"></div>`;
    }
    const halves = players.map((p) => `<div class="bg-half" style="${playerBgStyle(p)}"></div>`).join("");
    return `<div class="bg bg-split">${halves}</div>`;
  }

  // ---------------------------------------------------------
  // ROUTER
  // ---------------------------------------------------------
  function render() {
    if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
    appEl.innerHTML = "";
    if (screen === "menu") renderMenu();
    else if (screen === "setup-standard") renderSetupStandard();
    else if (screen === "game-standard") renderGameStandard();
    else if (screen === "setup-br") renderSetupBR();
    else if (screen === "game-br") renderGameBR();
    else if (screen === "setup-teams") renderSetupTeams();
    else if (screen === "game-teams") renderGameTeams();
    else if (screen === "stats-standard") renderStatsStandard();
    else if (screen === "profiles") renderProfilesScreen();

    if (screen === "game-standard" || screen === "game-br" || screen === "game-teams") requestWakeLock();
    else releaseWakeLock();
  }

  // ===========================================================
  // MENU PRINCIPAL
  // ===========================================================
  function renderMenu() {
    const saved = State.load();
    const s = el(`
      <div class="screen menu-screen">
        <div class="logo">MTG <span>LIFE</span> COUNTER
          <small>Commander • Battle Royale • Livre</small>
        </div>
        ${saved ? `<button class="btn btn-gold btn-block" id="resume-btn" style="max-width:520px">▶️ Continuar jogo em curso</button>` : ""}
        <div class="mode-grid">
          <div class="mode-card commander" data-mode="commander">
            <div class="icon">👑</div>
            <div class="title">Commander Padrão</div>
            <div class="desc">2–8 jogadores · 40 vidas · Commander damage</div>
          </div>
          <div class="mode-card duel" data-mode="duel">
            <div class="icon">⚔️</div>
            <div class="title">Duelo 1v1</div>
            <div class="desc">2 jogadores · 40 vidas · Commander damage</div>
          </div>
          <div class="mode-card free" data-mode="free">
            <div class="icon">🎛️</div>
            <div class="title">Livre</div>
            <div class="desc">Escolhe nº de jogadores e vida inicial</div>
          </div>
          <div class="mode-card br" data-mode="br">
            <div class="icon">🩸</div>
            <div class="title">Battle Royale</div>
            <div class="desc">6 jogadores · zonas · loot · último vivo</div>
          </div>
          <div class="mode-card teams" data-mode="teams">
            <div class="icon">🛡️</div>
            <div class="title">Equipas</div>
            <div class="desc">Escolhe nº de equipas e jogadores por equipa · vida partilhada</div>
          </div>
        </div>
        <div class="footer-note">As imagens dos commanders são obtidas automaticamente da Scryfall API (é necessária ligação à internet só para a pesquisa).</div>
        <button class="btn btn-ghost" id="profiles-btn">👤 Perfis guardados</button>
      </div>
    `);
    appEl.appendChild(s);

    if (saved) {
      s.querySelector("#resume-btn").addEventListener("click", () => {
        game = saved;
        if (saved.mode === "br") nav("game-br");
        else if (saved.mode === "teams" && saved.teams.ended) nav("stats-standard", { stats: State.teamsComputeStats(saved) });
        else if (saved.mode === "teams") nav("game-teams");
        else if (saved.mode === "standard" && saved.standard.ended) nav("stats-standard", { stats: State.stdComputeStats(saved) });
        else nav("game-standard");
      });
    }
    s.querySelector("#profiles-btn").addEventListener("click", () => nav("profiles"));
    s.querySelectorAll(".mode-card").forEach((card) => {
      card.addEventListener("click", () => {
        const mode = card.dataset.mode;
        if (saved && !confirm("Já existe um jogo em curso. Começar um novo jogo vai substituí-lo. Continuar?")) return;
        if (mode === "br") {
          draft = { names: ["", "", "", "", "", ""], commanders: [null, null, null, null, null, null], profileIds: [null, null, null, null, null, null] };
          nav("setup-br");
        } else if (mode === "teams") {
          draft = makeTeamsDraft(2, 2, 40);
          nav("setup-teams");
        } else {
          const preset = PRESETS[mode];
          draft = {
            preset: preset.key,
            playerCount: preset.defaultPlayers,
            startLife: preset.defaultLife,
            cmdDmgEnabled: preset.cmdDmgDefault,
            players: Array.from({ length: preset.defaultPlayers }, (_, i) => ({ name: "", commander: null, partnerCommander: null, profileId: null })),
          };
          nav("setup-standard");
        }
      });
    });
  }

  // ===========================================================
  // COMMANDER PICKER (modal reutilizável)
  // ===========================================================
  function openCommanderPicker(onSelect, title) {
    // (sem closeAnyModal aqui de propósito: este picker pode abrir por cima
    // de outro modal já aberto, ex. dentro do ecrã de editar jogador)
    const backdrop = el(`
      <div class="modal-backdrop">
        <div class="modal-sheet">
          <h2>${esc(title || "🔍 Escolher Commander")}</h2>
          <input type="text" id="cp-input" placeholder="Nome do commander (ex: Atraxa, Krenko...)" autocomplete="off" autocorrect="off" spellcheck="false">
          <div class="search-status hidden" id="cp-status"></div>
          <div class="search-results" id="cp-results"></div>
          <div class="row" style="margin-top:10px">
            <button class="btn btn-ghost grow" id="cp-manual">✏️ Imagem manual</button>
            <button class="btn btn-ghost grow" id="cp-none">🚫 Sem imagem</button>
          </div>
          <div id="cp-manual-form" class="col hidden" style="margin-top:10px">
            <input type="text" id="cp-manual-name" placeholder="Nome do commander">
            <input type="text" id="cp-manual-url" placeholder="URL da imagem (https://...)">
            <button class="btn btn-primary" id="cp-manual-confirm">Usar esta imagem</button>
          </div>
          <button class="btn btn-ghost" id="cp-cancel" style="margin-top:10px">Cancelar</button>
        </div>
      </div>
    `);
    document.body.appendChild(backdrop);
    const input = backdrop.querySelector("#cp-input");
    const results = backdrop.querySelector("#cp-results");
    const status = backdrop.querySelector("#cp-status");
    input.focus();

    function setStatus(text) {
      if (!text) { status.classList.add("hidden"); return; }
      status.textContent = text;
      status.classList.remove("hidden");
    }

    const doSearch = debounce(async (q) => {
      if (q.trim().length < 2) { results.innerHTML = ""; setStatus(""); return; }
      setStatus("A pesquisar na Scryfall…");
      try {
        const cards = await Scryfall.searchCommanders(q);
        setStatus(cards.length ? "" : "Sem resultados para esse nome.");
        results.innerHTML = "";
        cards.forEach((card) => {
          const item = el(`
            <div class="search-result-item">
              <img src="${card.art ? esc(card.art) : ""}" onerror="this.style.visibility='hidden'">
              <div class="info">
                <div class="name">${esc(card.name)}</div>
                <div class="type">${esc(card.typeLine)}</div>
              </div>
              ${card.printsUri ? `<button class="btn btn-icon versions-btn" title="Escolher arte/versão alternativa">🎨</button>` : ""}
            </div>
          `);
          item.addEventListener("click", () => {
            onSelect(card);
            backdrop.remove();
          });
          const versionsBtn = item.querySelector(".versions-btn");
          if (versionsBtn) {
            versionsBtn.addEventListener("click", (ev) => {
              ev.stopPropagation();
              openVersionPicker(card, (chosen) => onSelect(chosen), backdrop);
            });
          }
          results.appendChild(item);
        });
      } catch (err) {
        setStatus("⚠️ Sem ligação à Scryfall. Tenta a imagem manual abaixo.");
      }
    }, 350);

    input.addEventListener("input", () => doSearch(input.value));
    backdrop.querySelector("#cp-cancel").addEventListener("click", () => backdrop.remove());
    backdrop.querySelector("#cp-none").addEventListener("click", () => { onSelect(null); backdrop.remove(); });
    backdrop.querySelector("#cp-manual").addEventListener("click", () => {
      backdrop.querySelector("#cp-manual-form").classList.toggle("hidden");
    });
    backdrop.querySelector("#cp-manual-confirm").addEventListener("click", () => {
      const name = backdrop.querySelector("#cp-manual-name").value.trim() || "Commander";
      const url = backdrop.querySelector("#cp-manual-url").value.trim();
      if (!url) { toast("Indica uma URL de imagem válida."); return; }
      onSelect({ id: "manual_" + Date.now(), name, art: url, artNormal: url });
      backdrop.remove();
    });
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
  }

  // ===========================================================
  // VERSION PICKER (modal reutilizável) — escolher arte/edição alternativa
  // de uma carta já encontrada na pesquisa (abre por cima do commander picker)
  // ===========================================================
  function openVersionPicker(baseCard, onSelect, parentBackdrop) {
    // (sem closeAnyModal aqui de propósito: abre por cima do commander picker)
    const backdrop = el(`
      <div class="modal-backdrop">
        <div class="modal-sheet">
          <h2>🎨 Escolher arte — ${esc(baseCard.name)}</h2>
          <div class="search-status" id="vp-status">A carregar edições…</div>
          <div class="search-results" id="vp-results"></div>
          <button class="btn btn-ghost" id="vp-cancel" style="margin-top:10px">Cancelar</button>
        </div>
      </div>
    `);
    document.body.appendChild(backdrop);
    const results = backdrop.querySelector("#vp-results");
    const status = backdrop.querySelector("#vp-status");

    function selectVersion(card) {
      onSelect(card);
      backdrop.remove();
      if (parentBackdrop) parentBackdrop.remove();
    }

    (async () => {
      try {
        const prints = await Scryfall.getPrints(baseCard.printsUri);
        if (!prints.length) {
          status.textContent = "Não há outras edições/artes disponíveis para esta carta.";
          return;
        }
        status.classList.add("hidden");
        prints.forEach((card) => {
          const item = el(`
            <div class="search-result-item">
              <img src="${card.art ? esc(card.art) : ""}" onerror="this.style.visibility='hidden'">
              <div class="info">
                <div class="name">${esc(card.setName || card.set)}</div>
                <div class="type">${esc(card.artist ? "Arte de " + card.artist : "")}${card.collectorNumber ? " · #" + esc(card.collectorNumber) : ""}</div>
              </div>
            </div>
          `);
          item.addEventListener("click", () => selectVersion(card));
          results.appendChild(item);
        });
      } catch (err) {
        status.textContent = "⚠️ Não foi possível carregar as edições/artes. Tenta novamente.";
      }
    })();

    backdrop.querySelector("#vp-cancel").addEventListener("click", () => backdrop.remove());
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
  }

  // ===========================================================
  // PROFILE PICKER (modal reutilizável) — ligar/criar perfil de commander
  // ===========================================================
  function openProfilePicker({ commander, currentProfileId, playerName, onSelect }) {
    // (sem closeAnyModal aqui de propósito: pode abrir por cima do modal de editar jogador)
    const profiles = Profiles.all();
    const backdrop = el(`
      <div class="modal-backdrop">
        <div class="modal-sheet">
          <h2>👤 Perfil do jogador</h2>
          <div class="footer-note" style="margin-bottom:10px">Os perfis guardam as estatísticas deste commander entre jogos (vitórias, tempo médio por turno/jogo, etc).</div>
          <div class="col" id="pp-list" style="max-height:38vh;overflow-y:auto"></div>
          <div class="row" style="margin-top:10px">
            <button class="btn btn-ghost grow" id="pp-new">➕ Criar novo perfil</button>
            ${currentProfileId ? `<button class="btn btn-ghost grow" id="pp-clear">🚫 Remover perfil</button>` : ""}
          </div>
          <div id="pp-new-form" class="col hidden" style="margin-top:10px">
            <input type="text" id="pp-new-name" placeholder="Nome do perfil" value="${commander ? esc(commander.name) : ""}">
            <button class="btn btn-primary" id="pp-new-confirm">Criar e ligar</button>
          </div>
          <button class="btn btn-ghost" id="pp-cancel" style="margin-top:10px">Cancelar</button>
        </div>
      </div>
    `);
    document.body.appendChild(backdrop);
    const list = backdrop.querySelector("#pp-list");
    if (!profiles.length) {
      list.appendChild(el(`<div class="search-status">Ainda não tens perfis guardados.</div>`));
    }
    profiles.forEach((p) => {
      const d = Profiles.derived(p);
      const item = el(`
        <div class="search-result-item ${p.id === currentProfileId ? "lethal" : ""}" style="${p.id === currentProfileId ? "border:1px solid var(--gold)" : ""}">
          ${p.commander && p.commander.art ? `<img src="${esc(p.commander.art)}">` : `<div style="width:44px;height:44px;display:flex;align-items:center;justify-content:center">🃏</div>`}
          <div>
            <div class="name">${esc(p.name)}</div>
            <div class="type">🎮 ${d.games} jogos · 🏆 ${d.wins} vitórias${d.games ? " (" + Math.round(d.winRate * 100) + "%)" : ""}</div>
          </div>
        </div>
      `);
      item.addEventListener("click", () => { onSelect(p.id); backdrop.remove(); });
      list.appendChild(item);
    });
    backdrop.querySelector("#pp-cancel").addEventListener("click", () => backdrop.remove());
    const clearBtn = backdrop.querySelector("#pp-clear");
    if (clearBtn) clearBtn.addEventListener("click", () => { onSelect(null); backdrop.remove(); });
    backdrop.querySelector("#pp-new").addEventListener("click", () => {
      if (!commander) { toast("Escolhe primeiro um commander para este jogador."); return; }
      backdrop.querySelector("#pp-new-form").classList.toggle("hidden");
    });
    backdrop.querySelector("#pp-new-confirm").addEventListener("click", () => {
      const name = backdrop.querySelector("#pp-new-name").value.trim();
      const profile = Profiles.create({ name, commander, playerName });
      onSelect(profile.id);
      backdrop.remove();
    });
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
  }

  // ===========================================================
  // SETUP — Commander padrão / Duelo / Livre
  // ===========================================================
  function renderSetupStandard() {
    const preset = PRESETS[draft.preset];
    const s = el(`
      <div class="screen">
        <div class="topbar">
          <button class="btn btn-icon" id="back-btn">←</button>
          <h1>${esc(preset.label)}</h1>
          <div style="width:40px"></div>
        </div>
        <div class="scroll">
          <div class="setup-controls">
            ${preset.minPlayers !== preset.maxPlayers ? `
            <div class="field">
              <label>Jogadores</label>
              <div class="stepper-field">
                <button class="btn btn-icon" type="button" id="players-minus">−</button>
                <input type="number" id="cfg-players" min="${preset.minPlayers}" max="${preset.maxPlayers}" value="${draft.playerCount}">
                <button class="btn btn-icon" type="button" id="players-plus">+</button>
              </div>
            </div>` : ""}
            <div class="field">
              <label>Vida inicial</label>
              <input type="number" id="cfg-life" min="1" value="${draft.startLife}">
            </div>
            ${preset.cmdDmgToggle ? `
            <div class="field" style="display:flex;align-items:flex-end;gap:8px;">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                <input type="checkbox" id="cfg-cmddmg" ${draft.cmdDmgEnabled ? "checked" : ""} style="width:auto">
                Commander Damage
              </label>
            </div>` : ""}
          </div>
          <div class="player-setup-list" id="players-list"></div>
        </div>
        <div class="board-toolbar">
          <button class="btn btn-primary btn-block" id="start-btn">🚀 Começar Jogo</button>
        </div>
      </div>
    `);
    appEl.appendChild(s);

    // Reconciliação por índice: reaproveita os cards já existentes em vez de
    // destruir e recriar tudo a cada alteração (nº de jogadores, escolher
    // commander/perfil de OUTRO jogador, etc.) — isto evita perder o foco
    // (e o que já se tinha escrito) no campo de nome de um jogador quando
    // outra parte do ecrã dispara um re-render ao mesmo tempo.
    function buildPlayerCard(i) {
      const p = draft.players[i];
      const profile = p.profileId ? Profiles.get(p.profileId) : null;
      const card = el(`
        <div class="player-setup-card">
          <div class="commander-thumbs">
            <div class="commander-thumb" data-role="main" style="${commanderThumbStyle(p.commander)}">
              ${p.commander ? "" : "🃏"}
            </div>
            <div class="commander-thumb thumb-sm" data-role="partner" title="Commander parceiro" style="${commanderThumbStyle(p.partnerCommander)}">
              ${p.partnerCommander ? "" : "+"}
            </div>
          </div>
          <div class="player-setup-fields">
            <input type="text" data-i="${i}" class="name-input" placeholder="Jogador ${i + 1}" value="${esc(p.name)}">
            <div class="commander-name">${p.commander ? esc(p.commander.name) : "Sem commander escolhido"}${p.partnerCommander ? " + " + esc(p.partnerCommander.name) : ""}</div>
            <button class="btn btn-ghost btn-sm profile-btn" data-i="${i}">${profile ? "👤 " + esc(profile.name) : "👤 Sem perfil"}</button>
          </div>
        </div>
      `);
      card.querySelector('.commander-thumb[data-role="main"]').addEventListener("click", () => {
        openCommanderPicker((card2) => { draft.players[i].commander = card2; renderPlayersList(); });
      });
      card.querySelector('.commander-thumb[data-role="partner"]').addEventListener("click", () => {
        openCommanderPicker((card2) => { draft.players[i].partnerCommander = card2; renderPlayersList(); }, "🔍 Escolher Commander Parceiro");
      });
      card.querySelector(".name-input").addEventListener("input", (e) => {
        draft.players[i].name = e.target.value;
      });
      card.querySelector(".profile-btn").addEventListener("click", () => {
        openProfilePicker({
          commander: draft.players[i].commander,
          currentProfileId: draft.players[i].profileId,
          playerName: draft.players[i].name,
          onSelect: (id) => {
            draft.players[i].profileId = id;
            const prof = id ? Profiles.get(id) : null;
            if (prof && prof.commander) draft.players[i].commander = prof.commander;
            if (prof && prof.playerName) draft.players[i].name = prof.playerName;
            renderPlayersList();
          },
        });
      });
      return card;
    }
    function updatePlayerCard(card, i) {
      const p = draft.players[i];
      const profile = p.profileId ? Profiles.get(p.profileId) : null;
      const mainThumb = card.querySelector('.commander-thumb[data-role="main"]');
      mainThumb.style.cssText = commanderThumbStyle(p.commander);
      mainThumb.textContent = p.commander ? "" : "🃏";
      const partnerThumb = card.querySelector('.commander-thumb[data-role="partner"]');
      partnerThumb.style.cssText = commanderThumbStyle(p.partnerCommander);
      partnerThumb.textContent = p.partnerCommander ? "" : "+";
      card.querySelector(".commander-name").textContent = (p.commander ? p.commander.name : "Sem commander escolhido") + (p.partnerCommander ? " + " + p.partnerCommander.name : "");
      card.querySelector(".profile-btn").textContent = profile ? "👤 " + profile.name : "👤 Sem perfil";
      const nameInput = card.querySelector(".name-input");
      if (document.activeElement !== nameInput) nameInput.value = p.name;
    }
    function renderPlayersList() {
      const list = s.querySelector("#players-list");
      const existing = Array.from(list.children);
      draft.players.forEach((p, i) => {
        if (existing[i]) updatePlayerCard(existing[i], i);
        else list.appendChild(buildPlayerCard(i));
      });
      while (list.children.length > draft.players.length) list.removeChild(list.lastChild);
    }
    renderPlayersList();

    if (preset.minPlayers !== preset.maxPlayers) {
      function setPlayerCount(n) {
        n = Math.max(preset.minPlayers, Math.min(preset.maxPlayers, n || preset.defaultPlayers));
        s.querySelector("#cfg-players").value = n;
        const cur = draft.players.length;
        if (n > cur) for (let i = cur; i < n; i++) draft.players.push({ name: "", commander: null, partnerCommander: null, profileId: null });
        else draft.players.length = n;
        draft.playerCount = n;
        renderPlayersList();
      }
      s.querySelector("#cfg-players").addEventListener("change", (e) => {
        setPlayerCount(parseInt(e.target.value, 10));
      });
      s.querySelector("#players-minus").addEventListener("click", () => setPlayerCount(draft.playerCount - 1));
      s.querySelector("#players-plus").addEventListener("click", () => setPlayerCount(draft.playerCount + 1));
    }
    s.querySelector("#cfg-life").addEventListener("change", (e) => {
      draft.startLife = Math.max(1, parseInt(e.target.value, 10) || preset.defaultLife);
    });
    if (preset.cmdDmgToggle) {
      s.querySelector("#cfg-cmddmg").addEventListener("change", (e) => { draft.cmdDmgEnabled = e.target.checked; });
    }
    s.querySelector("#back-btn").addEventListener("click", () => nav("menu"));
    s.querySelector("#start-btn").addEventListener("click", () => {
      const st = State.createStandardGame({
        playerCount: draft.players.length,
        startLife: draft.startLife,
        commanderDamageEnabled: preset.cmdDmgToggle ? draft.cmdDmgEnabled : preset.cmdDmgDefault,
        presetName: preset.key,
      });
      st.standard.players.forEach((p, i) => {
        if (draft.players[i].name.trim()) p.name = draft.players[i].name.trim();
        p.commander = draft.players[i].commander;
        p.partnerCommander = draft.players[i].partnerCommander || null;
        p.profileId = draft.players[i].profileId || null;
      });
      State.ensureFallbackColors(st.standard.players);
      State.save(st);
      game = st;
      openWhoStartsModal(
        st.standard.players.map((p) => ({ id: p.id, name: p.name })),
        (winnerId) => {
          State.stdSetStartingPlayer(game, winnerId);
          nav("game-standard");
        }
      );
    });
  }

  // ===========================================================
  // JOGO — Commander padrão / Duelo / Livre
  // ===========================================================
  function layoutRows(n) {
    const top = Math.floor(n / 2);
    return { top, bottom: n - top };
  }

  function renderGameStandard() {
    const players = game.standard.players;
    const { top, bottom } = layoutRows(players.length);
    const topPlayers = players.slice(0, top);
    const bottomPlayers = players.slice(top);
    const currentPlayer = State.stdCurrentPlayer(game);
    const paused = !!game.standard.paused;

    const s = el(`
      <div class="screen ${boardFullscreen ? "board-fullscreen" : ""}">
        ${boardFullscreen ? `<button class="fullscreen-toggle-btn" id="fullscreen-exit-btn" title="Sair de ecrã inteiro">🗗</button>` : ""}
        <div class="topbar">
          <button class="btn btn-icon" id="menu-btn">☰</button>
          <h1>${esc(PRESETS[game.presetName] ? PRESETS[game.presetName].label : "Jogo")}</h1>
          <div class="row" style="gap:6px; flex-shrink:0;">
            <button class="btn btn-icon" id="reset-btn" title="Reiniciar">↺</button>
            <button class="btn btn-icon" id="fullscreen-btn" title="${boardFullscreen ? "Sair de ecrã inteiro" : "Ecrã inteiro"}">${boardFullscreen ? "🗗" : "⛶"}</button>
          </div>
        </div>
        <div class="br-status-row">
          <div class="br-chip turn">👤 Vez: ${currentPlayer ? esc(currentPlayer.name) : "-"}</div>
          <div class="br-chip">🔁 Ronda: ${game.standard.roundNumber || 1}</div>
          <div class="br-chip" id="chip-turn-time">⏱ Turno: 00:00</div>
          <div class="br-chip" id="chip-total-time">⏳ Total: 00:00</div>
          ${paused ? `<div class="br-chip paused">⏸️ PAUSADO</div>` : ""}
        </div>
        <div class="board">
          <div class="board-row" id="row-top"></div>
          <div class="board-row" id="row-bottom"></div>
        </div>
        <div class="board-toolbar">
          <button class="btn btn-icon" id="pause-btn" title="${paused ? "Retomar" : "Pausar"}">${paused ? "▶️" : "⏸️"}</button>
          <button class="btn btn-icon" id="history-btn" title="Histórico de vida">📜</button>
          <button class="btn btn-icon" id="reorder-btn" title="Trocar posições">🔀</button>
          <button class="btn btn-ghost grow" id="end-game-btn">🏁 Terminar</button>
        </div>
      </div>
    `);
    appEl.appendChild(s);

    const rowTop = s.querySelector("#row-top");
    const rowBottom = s.querySelector("#row-bottom");
    // Disposição em "serpentina": a fila de baixo é colocada por ordem INVERSA
    // para que a ordem dos turnos ande sempre em sentido horário à volta da
    // mesa (top esquerda→direita, depois desce e volta direita→esquerda),
    // em vez de saltar na diagonal de um canto para o outro.
    topPlayers.forEach((p) => rowTop.appendChild(buildStandardPanel(p, true, currentPlayer)));
    bottomPlayers.slice().reverse().forEach((p) => rowBottom.appendChild(buildStandardPanel(p, false, currentPlayer)));

    function tickClock() {
      const chipTurn = s.querySelector("#chip-turn-time");
      const chipTotal = s.querySelector("#chip-total-time");
      if (!chipTurn || !chipTotal) { clearInterval(liveTimer); return; }
      const now = game.standard.paused ? game.standard.pausedAt : Date.now();
      chipTurn.textContent = "⏱ Turno: " + formatDuration(now - game.standard.turnStartedAt);
      chipTotal.textContent = "⏳ Total: " + formatDuration(now - game.standard.gameStartedAt);
    }
    tickClock();
    liveTimer = setInterval(tickClock, 1000);

    s.querySelector("#menu-btn").addEventListener("click", () => {
      if (confirm("Voltar ao menu? O jogo atual fica guardado e podes continuar mais tarde.")) nav("menu");
    });
    s.querySelector("#reset-btn").addEventListener("click", () => {
      if (!confirm("Reiniciar vidas, commander damage e os relógios de turno/jogo de todos os jogadores?")) return;
      const now = Date.now();
      game.standard.players.forEach((p) => { p.life = game.standard.startLife; p.cmdDamage = {}; p.eliminated = false; p.protected = false; p.cmdTax = 0; p.partnerCmdTax = 0; });
      game.standard.roundNumber = 1;
      game.standard.roundStartIndex = game.standard.currentTurnIndex;
      game.standard.turnSeq = 1;
      game.standard.lifeLog = [];
      game.standard.gameStartedAt = now;
      game.standard.turnStartedAt = now;
      game.standard.paused = false;
      game.standard.pausedAt = null;
      State.save(game);
      render();
    });
    s.querySelector("#pause-btn").addEventListener("click", () => {
      State.stdTogglePause(game);
      render();
    });
    s.querySelector("#history-btn").addEventListener("click", () => openLifeHistoryModal());
    s.querySelector("#reorder-btn").addEventListener("click", () => openReorderPositionsModal("standard"));
    s.querySelector("#fullscreen-btn").addEventListener("click", () => {
      boardFullscreen = !boardFullscreen;
      render();
    });
    const fsExitBtn = s.querySelector("#fullscreen-exit-btn");
    if (fsExitBtn) fsExitBtn.addEventListener("click", () => { boardFullscreen = !boardFullscreen; render(); });
    s.querySelector("#end-game-btn").addEventListener("click", () => openEndGameModal());
  }

  function openEndGameModal() {
    closeAnyModal();
    const players = game.standard.players;
    const backdrop = el(`
      <div class="modal-backdrop center">
        <div class="modal-sheet">
          <h2>🏁 Terminar jogo</h2>
          <div class="footer-note" style="margin-bottom:10px">Quem venceu esta partida? (fica registado nos perfis ligados)</div>
          <div class="col" id="winner-list">
            ${players.map((p) => `
              <label class="row" style="align-items:center;background:var(--bg-elev-2);border-radius:10px;padding:10px;">
                <input type="radio" name="winner" value="${p.id}" style="width:auto">
                <span class="grow">${esc(p.name)}${p.eliminated ? " (eliminado)" : ""}</span>
              </label>
            `).join("")}
            <label class="row" style="align-items:center;background:var(--bg-elev-2);border-radius:10px;padding:10px;">
              <input type="radio" name="winner" value="" style="width:auto" checked>
              <span class="grow">Sem vencedor / não contar</span>
            </label>
          </div>
          <div class="row" style="margin-top:14px">
            <button class="btn btn-ghost grow" id="eg-cancel">Cancelar</button>
            <button class="btn btn-primary grow" id="eg-confirm">📊 Ver Estatísticas</button>
          </div>
        </div>
      </div>
    `);
    document.body.appendChild(backdrop);
    backdrop.querySelector("#eg-cancel").addEventListener("click", () => backdrop.remove());
    backdrop.querySelector("#eg-confirm").addEventListener("click", () => {
      const sel = backdrop.querySelector('input[name="winner"]:checked');
      const winnerId = sel && sel.value ? sel.value : null;
      const stats = State.stdEndGame(game, winnerId);
      backdrop.remove();
      nav("stats-standard", { stats });
    });
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
  }

  function buildStandardPanel(p, rotated, currentPlayer) {
    const cmdEnabled = game.standard.commanderDamageEnabled;
    const opponents = game.standard.players.filter((x) => x.id !== p.id);
    const isActive = currentPlayer && currentPlayer.id === p.id;
    // Badges de commander damage: faixa centrada por baixo do contador de vida.
    const cmdBadgeList = [];
    if (cmdEnabled) {
      opponents.forEach((o) => {
        cmdBadgeList.push(cmdBadgeHtml(p, o, "main"));
        if (o.partnerCommander) cmdBadgeList.push(cmdBadgeHtml(p, o, "partner"));
      });
    }
    const panel = el(`
      <div class="player-panel ${rotated ? "rot180" : ""} ${p.eliminated ? "eliminated" : ""} ${isActive ? "active-turn" : ""}" data-player-id="${p.id}">
        ${panelBgHtml(p)}
        <div class="mini-actions"><button class="mini-btn" data-action="edit">✏️</button></div>
        <div class="content">
          ${isActive ? `<div class="turn-badge">▶ VEZ</div>` : ""}
        <div class="player-header">
            <div class="player-name">${esc(p.name)}</div>
            <div class="tax-badge" data-action="tax" title="Commander tax">${taxBadgeText(p)}</div>
          </div>
          <div class="life-zone">
            <div class="life-tap minus"><span class="tap-circle">−</span></div>
            <div class="life-tap plus"><span class="tap-circle">+</span></div>
            <div class="life-delta-fixed"></div>
            <div class="life-total">${p.life}</div>
          </div>
          ${cmdEnabled ? `<div class="commander-badges">${cmdBadgeList.join("")}</div>` : ""}
          ${isActive ? `<button class="panel-pass-turn-btn" data-action="pass-turn" ${game.standard.paused ? "disabled" : ""}>⏭️ Passar turno</button>` : ""}
        </div>
      </div>
    `);
    syncEliminationBadges(panel, p);

    const minus = panel.querySelector(".life-tap.minus");
    const plus = panel.querySelector(".life-tap.plus");
    const deltaEl = panel.querySelector(".life-delta-fixed");

    // Acumula os toques consecutivos num só número (em vez de mostrar
    // "+1"/"-1" a cada toque) e só reinicia 2s depois do último toque.
    let deltaAcc = 0;
    let deltaTimer = null;
    function bumpDelta(amount) {
      deltaAcc += amount;
      clearTimeout(deltaTimer);
      deltaEl.textContent = (deltaAcc > 0 ? "+" : "") + deltaAcc;
      deltaEl.classList.toggle("plus", deltaAcc >= 0);
      deltaEl.classList.toggle("minus", deltaAcc < 0);
      deltaEl.classList.add("show");
      deltaTimer = setTimeout(() => {
        deltaEl.classList.remove("show");
        deltaAcc = 0;
      }, 2000);
    }

    bindPressRepeat(minus, () => {
      State.stdAdjustLife(game, p.id, -1);
      updateStandardPanel(p.id);
      bumpDelta(-1);
    });
    bindPressRepeat(plus, () => {
      State.stdAdjustLife(game, p.id, 1);
      updateStandardPanel(p.id);
      bumpDelta(1);
    });
    panel.querySelector('[data-action="edit"]').addEventListener("click", (ev) => {
      ev.stopPropagation();
      openEditPlayerModal({ mode: "standard", playerId: p.id });
    });
    panel.querySelector('[data-action="tax"]').addEventListener("click", (ev) => {
      ev.stopPropagation();
      openCommanderTaxModal("standard", p.id);
    });
    const passBtn = panel.querySelector('[data-action="pass-turn"]');
    if (passBtn) passBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      State.stdPassTurn(game);
      playTurnSound();
      render();
    });
    if (cmdEnabled) {
      panel.querySelectorAll(".cmd-badge").forEach((b) => {
        b.addEventListener("click", (ev) => { ev.stopPropagation(); openCmdDamageModal(p.id); });
      });
    }
    return panel;
  }

  /** Texto compacto do badge de commander tax: "+{main*2}" ou, com
   *  parceiro, "+{main*2}/+{partner*2}". */
  function taxBadgeText(p) {
    const main = "+" + (p.cmdTax || 0) * 2;
    if (!p.partnerCommander) return main;
    return main + "/+" + (p.partnerCmdTax || 0) * 2;
  }

  function openCommanderTaxModal(mode, playerId) {
    const p = mode === "teams" ? State.teamsFindPlayer(game, playerId).player : game.standard.players.find((x) => x.id === playerId);
    if (!p) return;
    closeAnyModal();
    const backdrop = el(`
      <div class="modal-backdrop center">
        <div class="modal-sheet">
          <h2>💠 Commander Tax — ${esc(p.name)}</h2>
          <div class="footer-note" style="margin-bottom:10px">Cada vez que conjuras o commander da zona de comando, o custo sobe {2}. Toca em "+" de cada vez que o conjurares.</div>
          <div class="cd-list" id="tax-list"></div>
          <button class="btn btn-ghost btn-block" id="tax-close" style="margin-top:14px">Fechar</button>
        </div>
      </div>
    `);
    document.body.appendChild(backdrop);
    const list = backdrop.querySelector("#tax-list");
    function buildRow(label, field, source) {
      const n = p[field] || 0;
      const row = el(`
        <div class="cd-list-item">
          <div class="nm">${esc(label)}</div>
          <button class="btn btn-icon" data-d="-1">−</button>
          <div class="val">+${n * 2}</div>
          <button class="btn btn-icon" data-d="1">+</button>
        </div>
      `);
      row.querySelectorAll("button").forEach((btn) => {
        btn.addEventListener("click", () => {
          const delta = parseInt(btn.dataset.d, 10);
          if (mode === "teams") State.teamsAdjustCmdTax(game, playerId, delta, source);
          else State.stdAdjustCmdTax(game, playerId, delta, source);
          paint();
        });
      });
      return row;
    }
    function paint() {
      list.innerHTML = "";
      list.appendChild(buildRow(p.commander ? p.commander.name : "Commander", "cmdTax", "main"));
      if (p.partnerCommander) {
        list.appendChild(buildRow(p.partnerCommander.name, "partnerCmdTax", "partner"));
      }
      const badge = appEl.querySelector(`[data-player-id="${playerId}"] .tax-badge, [data-player-id="${playerId}"] .tax-badge-sm`);
      if (badge) badge.textContent = taxBadgeText(p);
    }
    paint();
    backdrop.querySelector("#tax-close").addEventListener("click", () => backdrop.remove());
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
  }

  /** Modal reutilizável (setup standard e BR) para escolher quem começa o jogo:
   *  manualmente (toca no nome) ou por dados (1d6 cada, empates voltam a rolar
   *  só entre os empatados até haver um vencedor único). Chama onConfirm(playerId)
   *  assim que há uma escolha/vencedor confirmado. `players` é [{id, name}]. */
  function openWhoStartsModal(players, onConfirm) {
    closeAnyModal();
    const backdrop = el(`
      <div class="modal-backdrop center">
        <div class="modal-sheet">
          <h2>🎲 Quem começa?</h2>
          <div class="footer-note" style="margin-bottom:10px">Escolhe manualmente ou roda os dados — ganha quem tirar o valor mais alto (empates voltam a rolar).</div>
          <div class="cd-list" id="who-manual-list"></div>
          <button class="btn btn-accent btn-block" id="who-roll-btn" style="margin-top:14px">🎲 Rolar dados por todos</button>
          <div id="who-roll-results" style="margin-top:12px"></div>
          <button class="btn btn-ghost btn-block" id="who-cancel" style="margin-top:14px">Cancelar</button>
        </div>
      </div>
    `);
    document.body.appendChild(backdrop);

    const manualList = backdrop.querySelector("#who-manual-list");
    players.forEach((p) => {
      const row = el(`
        <div class="cd-list-item" style="cursor:pointer" data-pid="${p.id}">
          <div class="nm">${esc(p.name)}</div>
          <div class="val">▶</div>
        </div>
      `);
      row.addEventListener("click", () => {
        backdrop.remove();
        onConfirm(p.id);
      });
      manualList.appendChild(row);
    });

    const resultsEl = backdrop.querySelector("#who-roll-results");
    backdrop.querySelector("#who-roll-btn").addEventListener("click", () => {
      let pool = players.slice();
      let rollsByPlayer = {};
      players.forEach((p) => { rollsByPlayer[p.id] = null; });

      function rollRound() {
        pool.forEach((p) => { rollsByPlayer[p.id] = 1 + Math.floor(Math.random() * 6); });
        const maxRoll = Math.max(...pool.map((p) => rollsByPlayer[p.id]));
        const winners = pool.filter((p) => rollsByPlayer[p.id] === maxRoll);
        paintResults(winners.length > 1);
        if (winners.length > 1) {
          pool = winners;
          setTimeout(rollRound, 1200);
        } else {
          const winnerId = winners[0].id;
          setTimeout(() => {
            backdrop.remove();
            onConfirm(winnerId);
          }, 1400);
        }
      }
      function paintResults(tied) {
        resultsEl.innerHTML = "";
        const list = el(`<div class="cd-list"></div>`);
        players.forEach((p) => {
          const r = rollsByPlayer[p.id];
          const inPool = pool.includes(p);
          const row = el(`
            <div class="cd-list-item" style="${inPool ? "" : "opacity:.4"}">
              <div class="nm">${esc(p.name)}</div>
              <div class="val">${r === null ? "…" : "🎲 " + r}</div>
            </div>
          `);
          list.appendChild(row);
        });
        resultsEl.appendChild(list);
        if (tied) {
          resultsEl.appendChild(el(`<div class="footer-note" style="margin-top:6px">Empate — a rodar de novo só entre quem empatou...</div>`));
        }
      }
      backdrop.querySelector("#who-roll-btn").disabled = true;
      manualList.style.display = "none";
      rollRound();
    });

    backdrop.querySelector("#who-cancel").addEventListener("click", () => backdrop.remove());
  }

  /** HTML de um único badge de commander damage (main ou partner) de um oponente. */
  function cmdBadgeHtml(p, o, source) {
    const key = source === "partner" ? o.id + "::partner" : o.id;
    const dmg = p.cmdDamage[key] || 0;
    const cmd = source === "partner" ? o.partnerCommander : o.commander;
    // no badge "main" (identidade do oponente), sem arte usa a mesma cor
    // sorteada do painel dele; o badge "partner" fica neutro sem arte.
    const bgStyle = source === "partner" ? (cmd && cmd.art ? `background-image:url('${esc(cmd.art)}')` : "") : playerBgStyle(o);
    return `<div class="cmd-badge ${source === "partner" ? "partner" : ""} ${dmg >= 21 ? "lethal" : ""}" data-opp-id="${o.id}" data-source="${source}" style="${bgStyle}">
      ${cmd ? "" : "🃏"}<div class="dmg">${dmg}</div>
    </div>`;
  }

  /** Mostra/esconde e liga os cliques dos badges "ELIMINADO" / "🛡️ PROTEGIDO"
   *  no painel de um jogador (mesma lógica usada na criação e na atualização
   *  parcial do painel). */
  function syncEliminationBadges(panel, p) {
    const content = panel.querySelector(".content");
    let elimBadge = panel.querySelector(".eliminated-badge");
    if (p.eliminated && !elimBadge) {
      elimBadge = el(`<div class="eliminated-badge" title="Toca se uma carta evita a eliminação">ELIMINADO</div>`);
      elimBadge.addEventListener("click", (ev) => { ev.stopPropagation(); openEliminationGuardModal(p.id, true); });
      content.appendChild(elimBadge);
    } else if (!p.eliminated && elimBadge) {
      elimBadge.remove();
    }
    let protBadge = panel.querySelector(".protected-badge");
    if (p.protected && !p.eliminated && !protBadge) {
      protBadge = el(`<div class="protected-badge" title="Toca se a carta de proteção saiu do campo">🛡️ PROTEGIDO</div>`);
      protBadge.addEventListener("click", (ev) => { ev.stopPropagation(); openEliminationGuardModal(p.id, false); });
      content.appendChild(protBadge);
    } else if ((!p.protected || p.eliminated) && protBadge) {
      protBadge.remove();
    }
  }

  function updateStandardPanel(pid) {
    const p = game.standard.players.find((x) => x.id === pid);
    const panel = appEl.querySelector(`.player-panel[data-player-id="${pid}"]`);
    if (!p || !panel) return;
    panel.classList.toggle("eliminated", p.eliminated);
    const lifeEl = panel.querySelector(".life-total");
    if (lifeEl) lifeEl.textContent = p.life;
    syncEliminationBadges(panel, p);
    panel.querySelectorAll(".cmd-badge").forEach((b) => {
      const oppId = b.dataset.oppId;
      const source = b.dataset.source || "main";
      const key = source === "partner" ? oppId + "::partner" : oppId;
      const dmg = p.cmdDamage[key] || 0;
      b.querySelector(".dmg").textContent = dmg;
      b.classList.toggle("lethal", dmg >= 21);
    });
  }

  function openEliminationGuardModal(playerId, isEliminated) {
    const p = game.standard.players.find((x) => x.id === playerId);
    if (!p) return;
    closeAnyModal();
    const backdrop = el(`
      <div class="modal-backdrop center">
        <div class="modal-sheet">
          <h2>${isEliminated ? "☠️ Jogador eliminado" : "🛡️ Jogador protegido"}</h2>
          <div class="footer-note" style="margin-bottom:14px">
            ${isEliminated
              ? `${esc(p.name)} está eliminado (0 ou menos vidas, ou 21+ de commander damage). Se tens em jogo uma carta que evita a eliminação (ex: Platinum Angel, Worship...), podes mantê-lo no jogo.`
              : `${esc(p.name)} está a ser mantido no jogo apesar de já ter sofrido a eliminação, graças a uma carta de proteção. Assim que essa carta sair do campo, volta a eliminá-lo aqui.`}
          </div>
          <div class="col">
            ${isEliminated
              ? `<button class="btn btn-gold btn-block" id="eg-keep">🛡️ Manter no jogo</button>`
              : `<button class="btn btn-primary btn-block" id="eg-reeliminate">☠️ A carta saiu — eliminar agora</button>`}
            <button class="btn btn-ghost btn-block" id="eg-cancel">Cancelar</button>
          </div>
        </div>
      </div>
    `);
    document.body.appendChild(backdrop);
    const keepBtn = backdrop.querySelector("#eg-keep");
    if (keepBtn) keepBtn.addEventListener("click", () => {
      State.stdSetProtected(game, playerId, true);
      backdrop.remove();
      render();
    });
    const reBtn = backdrop.querySelector("#eg-reeliminate");
    if (reBtn) reBtn.addEventListener("click", () => {
      State.stdSetProtected(game, playerId, false);
      backdrop.remove();
      render();
    });
    backdrop.querySelector("#eg-cancel").addEventListener("click", () => backdrop.remove());
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
  }

  function openCmdDamageModal(playerId) {
    const p = game.standard.players.find((x) => x.id === playerId);
    const opponents = game.standard.players.filter((x) => x.id !== playerId);
    closeAnyModal();
    const backdrop = el(`
      <div class="modal-backdrop center">
        <div class="modal-sheet">
          <h2>Commander Damage — ${esc(p.name)}</h2>
          <div class="cd-list" id="cd-list"></div>
          <button class="btn btn-ghost btn-block" id="cd-close" style="margin-top:14px">Fechar</button>
        </div>
      </div>
    `);
    document.body.appendChild(backdrop);
    const list = backdrop.querySelector("#cd-list");
    function buildRow(o, source, label, art) {
      const key = source === "partner" ? o.id + "::partner" : o.id;
      const dmg = p.cmdDamage[key] || 0;
      const row = el(`
        <div class="cd-list-item">
          ${art ? `<img src="${esc(art)}">` : `<div style="width:34px;height:34px;display:flex;align-items:center;justify-content:center;">🃏</div>`}
          <div class="nm">${esc(label)}${source === "partner" ? ` <span class="turn-badge-sm partner-tag">PARCEIRO</span>` : ""}</div>
          <button class="btn btn-icon" data-d="-1">−</button>
          <div class="val">${dmg}</div>
          <button class="btn btn-icon" data-d="1">+</button>
        </div>
      `);
      row.querySelectorAll("button").forEach((btn) => {
        btn.addEventListener("click", () => {
          State.stdAdjustCmdDamage(game, playerId, o.id, parseInt(btn.dataset.d, 10), source);
          updateStandardPanel(playerId);
          paint();
        });
      });
      return row;
    }
    function paint() {
      list.innerHTML = "";
      opponents.forEach((o) => {
        const group = el(`<div class="cd-group"><div class="cd-group-title">${esc(o.name)}</div></div>`);
        group.appendChild(buildRow(o, "main", o.commander ? o.commander.name : "Sem commander", o.commander && o.commander.art));
        if (o.partnerCommander) {
          group.appendChild(buildRow(o, "partner", o.partnerCommander.name, o.partnerCommander.art));
        }
        list.appendChild(group);
      });
    }
    paint();
    backdrop.querySelector("#cd-close").addEventListener("click", () => backdrop.remove());
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
  }

  function openEditPlayerModal({ mode, playerId }) {
    const p = mode === "standard" ? game.standard.players.find((x) => x.id === playerId)
      : mode === "teams" ? State.teamsFindPlayer(game, playerId).player
      : game.br.players.find((x) => x.id === playerId);
    let pendingCommander = p.commander;
    let pendingPartnerCommander = p.partnerCommander || null;
    let pendingProfileId = p.profileId || null;
    closeAnyModal();
    const backdrop = el(`
      <div class="modal-backdrop center">
        <div class="modal-sheet">
          <h2>Editar jogador</h2>
          <div class="col">
            <label>Nome</label>
            <input type="text" id="ep-name" value="${esc(p.name)}">
            <div class="row" style="align-items:center;margin-top:6px">
              <div class="commander-thumb" id="ep-thumb" style="${commanderThumbStyle(p.commander)}">${p.commander ? "" : "🃏"}</div>
              <button class="btn btn-ghost grow" id="ep-commander">Alterar Commander</button>
            </div>
            ${(mode === "standard" || mode === "teams") ? `
            <div class="row" style="align-items:center;margin-top:6px">
              <div class="commander-thumb" id="ep-thumb-partner" style="${commanderThumbStyle(p.partnerCommander)}">${p.partnerCommander ? "" : "🃏"}</div>
              <button class="btn btn-ghost grow" id="ep-partner">${p.partnerCommander ? "Alterar Parceiro" : "➕ Adicionar Commander Parceiro"}</button>
            </div>` : ""}
            <button class="btn btn-ghost btn-sm" id="ep-profile" style="margin-top:6px">${pendingProfileId ? "👤 " + esc((Profiles.get(pendingProfileId) || {}).name || "Perfil") : "👤 Sem perfil"}</button>
            ${mode === "standard" ? `<button class="btn ${p.eliminated ? "btn-primary" : "btn-ghost"}" id="ep-elim" style="margin-top:6px">${p.eliminated ? "Reviver jogador" : "Marcar como eliminado"}</button>` : ""}
          </div>
          <div class="row" style="margin-top:14px">
            <button class="btn btn-ghost grow" id="ep-cancel">Cancelar</button>
            <button class="btn btn-primary grow" id="ep-save">Guardar</button>
          </div>
        </div>
      </div>
    `);
    document.body.appendChild(backdrop);
    backdrop.querySelector("#ep-commander").addEventListener("click", () => {
      openCommanderPicker((c) => {
        pendingCommander = c;
        const thumb = backdrop.querySelector("#ep-thumb");
        thumb.style.cssText = commanderThumbStyle(c);
        thumb.textContent = c ? "" : "🃏";
      });
    });
    const partnerBtn = backdrop.querySelector("#ep-partner");
    if (partnerBtn) {
      partnerBtn.addEventListener("click", () => {
        openCommanderPicker((c) => {
          pendingPartnerCommander = c;
          const thumb = backdrop.querySelector("#ep-thumb-partner");
          thumb.style.cssText = commanderThumbStyle(c);
          thumb.textContent = c ? "" : "🃏";
          partnerBtn.textContent = c ? "Alterar Parceiro" : "➕ Adicionar Commander Parceiro";
        }, "🔍 Escolher Commander Parceiro");
      });
    }
    backdrop.querySelector("#ep-profile").addEventListener("click", () => {
      openProfilePicker({
        commander: pendingCommander,
        currentProfileId: pendingProfileId,
        playerName: backdrop.querySelector("#ep-name").value,
        onSelect: (id) => {
          pendingProfileId = id;
          const prof = id ? Profiles.get(id) : null;
          backdrop.querySelector("#ep-profile").textContent = prof ? "👤 " + prof.name : "👤 Sem perfil";
          if (prof && prof.commander) {
            pendingCommander = prof.commander;
            const thumb = backdrop.querySelector("#ep-thumb");
            thumb.style.cssText = commanderThumbStyle(prof.commander);
            thumb.textContent = "";
          }
          if (prof && prof.playerName) {
            backdrop.querySelector("#ep-name").value = prof.playerName;
          }
        },
      });
    });
    let toggledElim = p.eliminated;
    const elimBtn = backdrop.querySelector("#ep-elim");
    if (elimBtn) {
      elimBtn.addEventListener("click", () => {
        toggledElim = !toggledElim;
        elimBtn.textContent = toggledElim ? "Reviver jogador" : "Marcar como eliminado";
        elimBtn.className = "btn " + (toggledElim ? "btn-primary" : "btn-ghost");
      });
    }
    backdrop.querySelector("#ep-cancel").addEventListener("click", () => backdrop.remove());
    backdrop.querySelector("#ep-save").addEventListener("click", () => {
      const name = backdrop.querySelector("#ep-name").value.trim() || p.name;
      if (mode === "standard") {
        State.stdSetName(game, playerId, name);
        State.stdSetCommander(game, playerId, pendingCommander);
        State.stdSetPartnerCommander(game, playerId, pendingPartnerCommander);
        State.stdSetProfile(game, playerId, pendingProfileId);
        if (toggledElim !== p.eliminated) State.stdToggleEliminated(game, playerId);
      } else if (mode === "teams") {
        State.teamsSetName(game, playerId, name);
        State.teamsSetCommander(game, playerId, pendingCommander);
        State.teamsSetPartnerCommander(game, playerId, pendingPartnerCommander);
        State.teamsSetProfile(game, playerId, pendingProfileId);
      } else {
        State.brSetName(game, playerId, name);
        State.brSetCommander(game, playerId, pendingCommander);
        State.brSetProfile(game, playerId, pendingProfileId);
      }
      backdrop.remove();
      render();
    });
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
  }

  // ===========================================================
  // SETUP — Battle Royale
  // ===========================================================
  function renderSetupBR() {
    const s = el(`
      <div class="screen">
        <div class="topbar">
          <button class="btn btn-icon" id="back-btn">←</button>
          <h1>🩸 Battle Royale — Setup</h1>
          <div style="width:40px"></div>
        </div>
        <div class="scroll">
          <div class="footer-note" style="margin-bottom:12px">6 jogadores · 30 vidas cada · zona inicial sorteada aleatoriamente · sem commander damage. Consulta as regras completas no ecrã de jogo (ícone ℹ️).</div>
          <div class="player-setup-list" id="players-list"></div>
        </div>
        <div class="board-toolbar">
          <button class="btn btn-accent btn-block" id="start-btn">🩸 Começar Battle Royale</button>
        </div>
      </div>
    `);
    appEl.appendChild(s);
    const list = s.querySelector("#players-list");
    if (!draft.profileIds) draft.profileIds = draft.names.map(() => null);
    draft.names.forEach((name, i) => {
      const profile = draft.profileIds[i] ? Profiles.get(draft.profileIds[i]) : null;
      const card = el(`
        <div class="player-setup-card">
          <div class="commander-thumb" data-i="${i}" style="${commanderThumbStyle(draft.commanders[i])}">${draft.commanders[i] ? "" : "🃏"}</div>
          <div class="player-setup-fields">
            <input type="text" class="name-input" placeholder="Jogador ${i + 1}" value="${esc(name)}">
            <div class="commander-name">${draft.commanders[i] ? esc(draft.commanders[i].name) : "Sem commander escolhido"}</div>
            <button class="btn btn-ghost btn-sm profile-btn">${profile ? "👤 " + esc(profile.name) : "👤 Sem perfil"}</button>
          </div>
        </div>
      `);
      card.querySelector(".commander-thumb").addEventListener("click", () => {
        openCommanderPicker((c) => {
          draft.commanders[i] = c;
          card.querySelector(".commander-thumb").style.cssText = commanderThumbStyle(c);
          card.querySelector(".commander-thumb").textContent = c ? "" : "🃏";
          card.querySelector(".commander-name").textContent = c ? c.name : "Sem commander escolhido";
        });
      });
      card.querySelector(".name-input").addEventListener("input", (e) => { draft.names[i] = e.target.value; });
      card.querySelector(".profile-btn").addEventListener("click", () => {
        openProfilePicker({
          commander: draft.commanders[i],
          currentProfileId: draft.profileIds[i],
          playerName: draft.names[i],
          onSelect: (id) => {
            draft.profileIds[i] = id;
            const p = id ? Profiles.get(id) : null;
            card.querySelector(".profile-btn").textContent = p ? "👤 " + p.name : "👤 Sem perfil";
            if (p && p.commander) {
              draft.commanders[i] = p.commander;
              card.querySelector(".commander-thumb").style.cssText = commanderThumbStyle(p.commander);
              card.querySelector(".commander-thumb").textContent = "";
              card.querySelector(".commander-name").textContent = p.commander.name;
            }
            if (p && p.playerName) {
              draft.names[i] = p.playerName;
              card.querySelector(".name-input").value = p.playerName;
            }
          },
        });
      });
      list.appendChild(card);
    });
    s.querySelector("#back-btn").addEventListener("click", () => nav("menu"));
    s.querySelector("#start-btn").addEventListener("click", () => {
      const st = State.createBRGame(draft.names);
      st.br.players.forEach((p, i) => {
        p.commander = draft.commanders[i];
        p.profileId = draft.profileIds[i] || null;
      });
      State.ensureFallbackColors(st.br.players);
      State.save(st);
      game = st;
      openWhoStartsModal(
        st.br.players.map((p) => ({ id: p.id, name: p.name })),
        (winnerId) => {
          State.brSetStartingPlayer(game, winnerId);
          nav("game-br");
        }
      );
    });
  }

  // ===========================================================
  // JOGO — Battle Royale
  // ===========================================================
  function renderGameBR() {
    const br = game.br;
    const alive = State.brAlivePlayers(game);

    if (br.phase === "ended") { renderChampionScreen(); return; }

    const current = State.brCurrentPlayer(game);
    const paused = !!br.paused;
    const s = el(`
      <div class="screen">
        <div class="topbar br-topbar">
          <button class="btn btn-icon" id="menu-btn">☰</button>
          <h1>🩸 Battle Royale</h1>
          <div class="row" style="gap:6px; flex-shrink:0;">
            <button class="btn btn-icon" id="history-btn" title="Histórico de vida">📜</button>
            <button class="btn btn-icon" id="reorder-btn" title="Trocar posições">🔀</button>
            <button class="btn btn-icon" id="info-btn">ℹ️</button>
          </div>
        </div>
        <div class="br-status-row">
          <div class="br-chip turn">🔁 Ronda ${br.roundNumber}</div>
          <div class="br-chip">👤 Vez de: ${current ? esc(current.name) : "-"}</div>
          <div class="br-chip" id="chip-turn-time">⏱ Turno: 00:00</div>
          <div class="br-chip" id="chip-total-time">⏳ Total: 00:00</div>
          <div class="br-chip ${br.phase !== "normal" ? "phase-final" : ""}">${phaseLabel(br.phase)}</div>
          <div class="br-chip">☢️ Zonas fechadas: ${br.closedZones.length}/5</div>
          ${paused ? `<div class="br-chip paused">⏸️ PAUSADO</div>` : ""}
        </div>
        <div class="zone-map" id="zone-map"></div>
        ${br.phase === "final_circle" ? `<div class="banner">☠️ FINAL CIRCLE — não podes ganhar vidas · todos atacam todos · criaturas com haste · +2 Treasure no início de cada turno</div>` : ""}
        ${br.phase === "final_duel_pending" ? `<div class="banner gold">⚔️ Restam 2 jogadores! <button class="btn btn-gold btn-sm" id="start-duel-btn" style="margin-left:8px">Iniciar Duelo Final</button></div>` : ""}
        ${br.phase === "final_duel" ? `<div class="banner gold">⚔️ FINAL DUEL em curso — até à morte!</div>` : ""}
        <div class="row" style="padding:0 12px 8px;gap:8px;flex-shrink:0">
          <button class="btn btn-accent grow" id="roll-event-btn" ${br.roundEventRolled ? "disabled" : ""}>🎲 Rolar evento da ronda</button>
          <button class="btn btn-primary grow" id="next-turn-btn" ${paused ? "disabled" : ""}>➡️ Próximo turno</button>
          <button class="btn btn-icon" id="pause-btn" title="${paused ? "Retomar" : "Pausar"}">${paused ? "▶️" : "⏸️"}</button>
        </div>
        <div class="event-log" id="event-log"></div>
        <div class="br-players" id="br-players"></div>
      </div>
    `);
    appEl.appendChild(s);

    // mapa de zonas
    const zoneMap = s.querySelector("#zone-map");
    State.ZONES.forEach((z) => {
      const closed = br.closedZones.includes(z);
      const occupants = br.players.filter((p) => !p.eliminated && p.zone === z);
      const cell = el(`
        <div class="zone-cell ${closed ? "closed" : ""}">
          <div class="zn">${z}</div>
          <div class="zone-avatars">${occupants.map((o) => `<div class="zone-avatar" style="${playerBgStyle(o)}" title="${esc(o.name)}"></div>`).join("")}</div>
        </div>
      `);
      zoneMap.appendChild(cell);
    });

    // log
    const logEl = s.querySelector("#event-log");
    br.log.slice(0, 12).forEach((entry) => {
      logEl.appendChild(el(`<div>${esc(entry.text)}</div>`));
    });

    // jogadores
    const playersList = s.querySelector("#br-players");
    br.players.forEach((p) => playersList.appendChild(buildBRRow(p, current)));

    function tickClock() {
      const chipTurn = s.querySelector("#chip-turn-time");
      const chipTotal = s.querySelector("#chip-total-time");
      if (!chipTurn || !chipTotal) { clearInterval(liveTimer); return; }
      const now = game.br.paused ? game.br.pausedAt : Date.now();
      chipTurn.textContent = "⏱ Turno: " + formatDuration(now - game.br.turnStartedAt);
      chipTotal.textContent = "⏳ Total: " + formatDuration(now - game.br.gameStartedAt);
    }
    tickClock();
    liveTimer = setInterval(tickClock, 1000);

    s.querySelector("#menu-btn").addEventListener("click", () => {
      if (confirm("Voltar ao menu? O jogo fica guardado.")) nav("menu");
    });
    s.querySelector("#info-btn").addEventListener("click", showBRRules);
    s.querySelector("#history-btn").addEventListener("click", () => openLifeHistoryModal());
    s.querySelector("#reorder-btn").addEventListener("click", () => openReorderPositionsModal("br"));
    s.querySelector("#roll-event-btn").addEventListener("click", () => {
      const { event, roll } = State.brRollEvent(game);
      State.save(game);
      showEventResult(roll, event);
      render();
    });
    s.querySelector("#next-turn-btn").addEventListener("click", () => {
      State.brNextTurn(game);
      playTurnSound();
      render();
    });
    s.querySelector("#pause-btn").addEventListener("click", () => {
      State.brTogglePause(game);
      render();
    });
    const duelBtn = s.querySelector("#start-duel-btn");
    if (duelBtn) duelBtn.addEventListener("click", () => { State.brStartFinalDuel(game); render(); });
  }

  function phaseLabel(phase) {
    return { normal: "🟢 Normal", final_circle: "☠️ Final Circle", final_duel_pending: "⚔️ Preparar Duelo", final_duel: "⚔️ Final Duel", ended: "👑 Terminado" }[phase] || phase;
  }

  function buildBRRow(p, current) {
    const isActive = current && current.id === p.id;
    const row = el(`
      <div class="br-player-row ${isActive ? "active" : ""} ${p.eliminated ? "eliminated" : ""}">
        <div class="br-avatar" style="${playerBgStyle(p)}"></div>
        <div class="br-info">
          <div class="nm">${esc(p.name)} ${isActive ? `<span class="turn-badge-sm">▶ VEZ</span>` : ""}</div>
          <div class="meta">${p.eliminated ? `💀 Eliminado` : `🎁 ${p.lootUsed.length}/6`}</div>
        </div>
        ${!p.eliminated ? `
        <select class="br-zone-select" data-act="zone" title="Zona atual">
          ${State.ZONES.map((z) => `<option value="${z}" ${z === p.zone ? "selected" : ""}>${z}</option>`).join("")}
        </select>
        <div class="br-life-stepper">
          <button class="btn btn-icon" data-act="minus">−</button>
          <div class="br-life">${p.life}</div>
          <button class="btn btn-icon" data-act="plus">+</button>
        </div>
        ` : ""}
        <div class="br-actions-mini">
          <button class="btn btn-icon" data-act="edit">✏️</button>
          ${!p.eliminated ? `<button class="btn btn-icon" data-act="kill">💀</button>` : ""}
        </div>
      </div>
    `);
    const minus = row.querySelector('[data-act="minus"]');
    const plus = row.querySelector('[data-act="plus"]');
    const zoneSel = row.querySelector('[data-act="zone"]');
    if (minus) minus.addEventListener("click", () => { State.brAdjustLife(game, p.id, -1); afterBRLifeChange(p.id); });
    if (plus) plus.addEventListener("click", () => { State.brAdjustLife(game, p.id, 1); afterBRLifeChange(p.id); });
    if (zoneSel) zoneSel.addEventListener("change", (e) => { State.brSetZone(game, p.id, e.target.value); render(); });
    row.querySelector('[data-act="edit"]').addEventListener("click", () => openEditPlayerModal({ mode: "br", playerId: p.id }));
    const killBtn = row.querySelector('[data-act="kill"]');
    if (killBtn) killBtn.addEventListener("click", () => {
      if (!confirm(`Eliminar ${p.name} do jogo?`)) return;
      State.brEliminate(game, p.id, []);
      State.save(game);
      openKillCreditFlow(p.id, () => render());
    });
    return row;
  }

  function afterBRLifeChange(pid) {
    const p = game.br.players.find((x) => x.id === pid);
    State.save(game);
    if (p.eliminated) {
      openKillCreditFlow(pid, () => render());
    } else {
      render();
    }
  }

  function showEventResult(roll, event) {
    closeAnyModal();
    const backdrop = el(`
      <div class="modal-backdrop center">
        <div class="modal-sheet">
          <div class="dice-face">🎲 ${roll}</div>
          <div class="event-card">
            <div class="ev-title">${esc(event.title)}</div>
            <div class="ev-desc">${esc(event.desc)}</div>
          </div>
          <button class="btn btn-primary btn-block" id="ev-ok" style="margin-top:14px">Continuar</button>
        </div>
      </div>
    `);
    document.body.appendChild(backdrop);
    backdrop.querySelector("#ev-ok").addEventListener("click", () => backdrop.remove());
  }

  function openKillCreditFlow(eliminatedId, onDone) {
    const eliminated = game.br.players.find((x) => x.id === eliminatedId);
    const alive = State.brAlivePlayers(game);
    closeAnyModal();
    if (!alive.length) { onDone(); return; }
    const backdrop = el(`
      <div class="modal-backdrop center">
        <div class="modal-sheet">
          <h2>💀 ${esc(eliminated.name)} foi eliminado!</h2>
          <div class="footer-note" style="margin-bottom:10px">Quem participou no abate? (se dois jogadores atacaram o mesmo alvo, escolhe ambos — os dois recebem recompensa)</div>
          <div class="col" id="killer-list">
            ${alive.map((a) => `
              <label class="row" style="align-items:center;background:var(--bg-elev-2);border-radius:10px;padding:8px 10px;">
                <input type="checkbox" value="${a.id}" style="width:auto">
                <span class="grow">${esc(a.name)}</span>
              </label>
            `).join("")}
          </div>
          <div class="row" style="margin-top:14px">
            <button class="btn btn-ghost grow" id="kc-skip">Ninguém escolhe recompensa</button>
            <button class="btn btn-primary grow" id="kc-confirm">Confirmar</button>
          </div>
        </div>
      </div>
    `);
    document.body.appendChild(backdrop);
    backdrop.querySelector("#kc-skip").addEventListener("click", () => { backdrop.remove(); onDone(); });
    backdrop.querySelector("#kc-confirm").addEventListener("click", () => {
      const ids = Array.from(backdrop.querySelectorAll('input[type=checkbox]:checked')).map((i) => i.value);
      backdrop.remove();
      runLootQueue(ids, onDone);
    });
  }

  function runLootQueue(playerIds, onDone) {
    if (!playerIds.length) { onDone(); return; }
    const [pid, ...rest] = playerIds;
    openLootPicker(pid, () => runLootQueue(rest, onDone));
  }

  function openLootPicker(playerId, onDone) {
    const p = game.br.players.find((x) => x.id === playerId);
    closeAnyModal();
    const inFinal = game.br.phase === "final_circle" || game.br.phase === "final_duel_pending";
    const backdrop = el(`
      <div class="modal-backdrop center">
        <div class="modal-sheet">
          <h2>🎁 Recompensa para ${esc(p.name)}</h2>
          <div class="loot-grid" id="loot-grid"></div>
          <button class="btn btn-ghost btn-block" id="loot-skip" style="margin-top:12px">Não escolher recompensa</button>
        </div>
      </div>
    `);
    document.body.appendChild(backdrop);
    const grid = backdrop.querySelector("#loot-grid");
    Object.entries(State.LOOT).forEach(([key, reward]) => {
      const used = p.lootUsed.includes(key);
      const blockedByFinal = inFinal && reward.type === "life";
      const card = el(`
        <button class="loot-card ${used || blockedByFinal ? "used" : ""}" ${used || blockedByFinal ? "disabled" : ""}>
          <div class="ic">${reward.icon}</div>
          <div class="tt">${esc(reward.title)}</div>
        </button>
      `);
      card.addEventListener("click", () => {
        State.brApplyLoot(game, playerId, key);
        State.save(game);
        toast(`${p.name}: ${reward.title}`);
        backdrop.remove();
        onDone();
      });
      grid.appendChild(card);
    });
    backdrop.querySelector("#loot-skip").addEventListener("click", () => { backdrop.remove(); onDone(); });
  }

  function showBRRules() {
    closeAnyModal();
    const backdrop = el(`
      <div class="modal-backdrop">
        <div class="modal-sheet" style="max-height:88vh">
          <h2>🩸 Regras — Battle Royale</h2>
          <div class="scroll" style="padding:0">
            <div class="footer-note col gap-sm" style="font-size:.78rem;line-height:1.5">
              <div><strong>❤️ Vida:</strong> todos começam com 30. Sem commander damage. A 0 estás eliminado — tudo o que controlas sai do jogo.</div>
              <div><strong>⚔️ Combate:</strong> podes atacar qualquer jogador na tua zona ou zona adjacente. Se 2 jogadores atacarem o mesmo alvo e ele morrer, ambos escolhem recompensa.</div>
              <div><strong>💰 Loot:</strong> ao eliminar alguém, escolhe 1 recompensa (só uma vez por recompensa por jogo): 3 Treasure, compra 3 cartas, ganha 10 vidas, ficha 6/6, recupera carta do cemitério, ou 1 carta grátis este turno.</div>
              <div><strong>🗺️ Mapa:</strong> zonas A–F em linha. Move-te para uma zona adjacente no início do teu turno, ou fica.</div>
              <div><strong>☄️ Círculo:</strong> a cada 3ª ronda da mesa (todos jogam 3 vezes), fecha a zona mais distante do centro (ordem: A, F, B, E, C, D). Quem estiver lá perde 5 vidas no início do seu turno. A zona inicial de cada jogador é sorteada aleatoriamente.</div>
              <div><strong>🎲 Evento aleatório:</strong> 1 dado por ronda — Blood Moon (-3 todos), Supply Drop (+1 treasure todos), Frenzy (+2/+0), Blackout (máx 1 compra), Healing Zone (+5 todos), Air Drop (jogador com menos vida compra 5).</div>
              <div><strong>👑 Final Circle</strong> (restam 3): sem ganhar vidas, todos atacam todos, +2 Treasure no início do turno, criaturas com haste.</div>
              <div><strong>⚔️ Final Duel</strong> (restam 2): +10 vidas, desviram tudo, compram 3, criam 3 Treasure — até à morte. O campeão escolhe o próximo evento aleatório.</div>
            </div>
          </div>
          <button class="btn btn-primary btn-block" id="rules-close" style="margin-top:12px">Entendido</button>
        </div>
      </div>
    `);
    document.body.appendChild(backdrop);
    backdrop.querySelector("#rules-close").addEventListener("click", () => backdrop.remove());
  }

  function renderChampionScreen() {
    const champ = game.br.players.find((p) => p.id === game.br.championId);
    const stats = State.brComputeStats(game);
    const s = el(`
      <div class="screen" style="align-items:center;text-align:center;">
        ${champ ? `<div class="bg" style="position:absolute;inset:0;${playerBgStyle(champ)};background-size:cover;filter:brightness(.3)"></div>` : ""}
        <div style="position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;gap:8px;padding:20px 20px 6px;flex-shrink:0">
          <div class="trophy">👑</div>
          <div class="cname">${champ ? esc(champ.name) : "?"}</div>
          <div class="footer-note">é o CAMPEÃO DO BATTLE ROYALE!</div>
        </div>
        <div class="scroll" style="position:relative;z-index:2;width:100%">${buildStatsBlock(stats)}</div>
        <div class="board-toolbar" style="position:relative;z-index:2;width:100%">
          <button class="btn btn-accent grow" id="new-br-btn">🩸 Novo Battle Royale</button>
          <button class="btn btn-ghost" id="menu-btn2">Menu</button>
        </div>
      </div>
    `);
    appEl.appendChild(s);
    s.querySelector("#new-br-btn").addEventListener("click", () => {
      State.clear();
      draft = { names: ["", "", "", "", "", ""], commanders: [null, null, null, null, null, null], profileIds: [null, null, null, null, null, null] };
      nav("setup-br");
    });
    s.querySelector("#menu-btn2").addEventListener("click", () => { State.clear(); nav("menu"); });
  }

  // ===========================================================
  // SETUP — Equipas (Teams)
  // ===========================================================
  function makeTeamsDraft(numTeams, playersPerTeam, startLife) {
    const teams = [];
    for (let t = 0; t < numTeams; t++) {
      const players = [];
      for (let i = 0; i < playersPerTeam; i++) players.push({ name: "", commander: null, partnerCommander: null, profileId: null });
      teams.push({ name: `Equipa ${t + 1}`, players });
    }
    return { numTeams, playersPerTeam, startLife, teams };
  }

  function renderSetupTeams() {
    const s = el(`
      <div class="screen">
        <div class="topbar">
          <button class="btn btn-icon" id="back-btn">←</button>
          <h1>🛡️ Equipas — Setup</h1>
          <div style="width:40px"></div>
        </div>
        <div class="scroll">
          <div class="setup-controls">
            <div class="field">
              <label>Equipas</label>
              <div class="stepper-field">
                <button class="btn btn-icon" type="button" id="teams-minus">−</button>
                <input type="number" id="cfg-teams" min="2" max="4" value="${draft.numTeams}">
                <button class="btn btn-icon" type="button" id="teams-plus">+</button>
              </div>
            </div>
            <div class="field">
              <label>Jogadores/equipa</label>
              <div class="stepper-field">
                <button class="btn btn-icon" type="button" id="ppt-minus">−</button>
                <input type="number" id="cfg-ppt" min="1" max="4" value="${draft.playersPerTeam}">
                <button class="btn btn-icon" type="button" id="ppt-plus">+</button>
              </div>
            </div>
            <div class="field">
              <label>Vida inicial (por equipa)</label>
              <input type="number" id="cfg-life" min="1" value="${draft.startLife}">
            </div>
          </div>
          <div class="footer-note" style="margin-bottom:12px">Vida partilhada por equipa (estilo Two-Headed Giant): a equipa toda soma/perde vida em conjunto. Os turnos alternam entre equipas.</div>
          <div id="teams-list"></div>
        </div>
        <div class="board-toolbar">
          <button class="btn btn-primary btn-block" id="start-btn">🚀 Começar Jogo</button>
        </div>
      </div>
    `);
    appEl.appendChild(s);

    // Mesma lógica de reconciliação por índice do setup Standard (ver ali
    // o porquê): evita destruir/recriar cards (e perder o foco de quem
    // estava a escrever um nome) sempre que outra parte do ecrã re-renderiza.
    function buildTeamPlayerCard(t, i) {
      const p = draft.teams[t].players[i];
      const profile = p.profileId ? Profiles.get(p.profileId) : null;
      const card = el(`
        <div class="player-setup-card">
          <div class="commander-thumbs">
            <div class="commander-thumb" data-role="main" style="${commanderThumbStyle(p.commander)}">${p.commander ? "" : "🃏"}</div>
            <div class="commander-thumb thumb-sm" data-role="partner" title="Commander parceiro" style="${commanderThumbStyle(p.partnerCommander)}">${p.partnerCommander ? "" : "+"}</div>
          </div>
          <div class="player-setup-fields">
            <input type="text" class="name-input" placeholder="Jogador ${i + 1}" value="${esc(p.name)}">
            <div class="commander-name">${p.commander ? esc(p.commander.name) : "Sem commander escolhido"}${p.partnerCommander ? " + " + esc(p.partnerCommander.name) : ""}</div>
            <button class="btn btn-ghost btn-sm profile-btn">${profile ? "👤 " + esc(profile.name) : "👤 Sem perfil"}</button>
          </div>
        </div>
      `);
      card.querySelector('.commander-thumb[data-role="main"]').addEventListener("click", () => {
        openCommanderPicker((c) => { draft.teams[t].players[i].commander = c; renderTeamsList(); });
      });
      card.querySelector('.commander-thumb[data-role="partner"]').addEventListener("click", () => {
        openCommanderPicker((c) => { draft.teams[t].players[i].partnerCommander = c; renderTeamsList(); }, "🔍 Escolher Commander Parceiro");
      });
      card.querySelector(".name-input").addEventListener("input", (e) => { draft.teams[t].players[i].name = e.target.value; });
      card.querySelector(".profile-btn").addEventListener("click", () => {
        openProfilePicker({
          commander: draft.teams[t].players[i].commander,
          currentProfileId: draft.teams[t].players[i].profileId,
          playerName: draft.teams[t].players[i].name,
          onSelect: (id) => {
            draft.teams[t].players[i].profileId = id;
            const prof = id ? Profiles.get(id) : null;
            if (prof && prof.commander) draft.teams[t].players[i].commander = prof.commander;
            if (prof && prof.playerName) draft.teams[t].players[i].name = prof.playerName;
            renderTeamsList();
          },
        });
      });
      return card;
    }
    function updateTeamPlayerCard(card, t, i) {
      const p = draft.teams[t].players[i];
      const profile = p.profileId ? Profiles.get(p.profileId) : null;
      const mainThumb = card.querySelector('.commander-thumb[data-role="main"]');
      mainThumb.style.cssText = commanderThumbStyle(p.commander);
      mainThumb.textContent = p.commander ? "" : "🃏";
      const partnerThumb = card.querySelector('.commander-thumb[data-role="partner"]');
      partnerThumb.style.cssText = commanderThumbStyle(p.partnerCommander);
      partnerThumb.textContent = p.partnerCommander ? "" : "+";
      card.querySelector(".commander-name").textContent = (p.commander ? p.commander.name : "Sem commander escolhido") + (p.partnerCommander ? " + " + p.partnerCommander.name : "");
      card.querySelector(".profile-btn").textContent = profile ? "👤 " + profile.name : "👤 Sem perfil";
      const nameInput = card.querySelector(".name-input");
      if (document.activeElement !== nameInput) nameInput.value = p.name;
    }
    function buildTeamCard(t) {
      const team = draft.teams[t];
      const card = el(`
        <div class="team-setup-card" data-team="${t}">
          <input type="text" class="team-name-input" value="${esc(team.name)}">
          <div class="player-setup-list team-players"></div>
        </div>
      `);
      card.querySelector(".team-name-input").addEventListener("input", (e) => { draft.teams[t].name = e.target.value; });
      return card;
    }
    function renderTeamsList() {
      const list = s.querySelector("#teams-list");
      const existingTeamCards = Array.from(list.children);
      draft.teams.forEach((team, t) => {
        let teamCard = existingTeamCards[t];
        if (!teamCard) {
          teamCard = buildTeamCard(t);
          list.appendChild(teamCard);
        } else {
          const nameInput = teamCard.querySelector(".team-name-input");
          if (document.activeElement !== nameInput) nameInput.value = team.name;
        }
        const playersContainer = teamCard.querySelector(".team-players");
        const existingPlayerCards = Array.from(playersContainer.children);
        team.players.forEach((p, i) => {
          if (existingPlayerCards[i]) updateTeamPlayerCard(existingPlayerCards[i], t, i);
          else playersContainer.appendChild(buildTeamPlayerCard(t, i));
        });
        while (playersContainer.children.length > team.players.length) playersContainer.removeChild(playersContainer.lastChild);
      });
      while (list.children.length > draft.teams.length) list.removeChild(list.lastChild);
    }
    renderTeamsList();

    function setNumTeams(n) {
      n = Math.max(2, Math.min(4, n || 2));
      s.querySelector("#cfg-teams").value = n;
      const cur = draft.teams.length;
      if (n > cur) {
        for (let t = cur; t < n; t++) {
          const players = [];
          for (let i = 0; i < draft.playersPerTeam; i++) players.push({ name: "", commander: null, partnerCommander: null, profileId: null });
          draft.teams.push({ name: `Equipa ${t + 1}`, players });
        }
      } else {
        draft.teams.length = n;
      }
      draft.numTeams = n;
      renderTeamsList();
    }
    function setPlayersPerTeam(n) {
      n = Math.max(1, Math.min(4, n || 1));
      s.querySelector("#cfg-ppt").value = n;
      draft.teams.forEach((team) => {
        const cur = team.players.length;
        if (n > cur) for (let i = cur; i < n; i++) team.players.push({ name: "", commander: null, partnerCommander: null, profileId: null });
        else team.players.length = n;
      });
      draft.playersPerTeam = n;
      renderTeamsList();
    }
    s.querySelector("#cfg-teams").addEventListener("change", (e) => setNumTeams(parseInt(e.target.value, 10)));
    s.querySelector("#teams-minus").addEventListener("click", () => setNumTeams(draft.numTeams - 1));
    s.querySelector("#teams-plus").addEventListener("click", () => setNumTeams(draft.numTeams + 1));
    s.querySelector("#cfg-ppt").addEventListener("change", (e) => setPlayersPerTeam(parseInt(e.target.value, 10)));
    s.querySelector("#ppt-minus").addEventListener("click", () => setPlayersPerTeam(draft.playersPerTeam - 1));
    s.querySelector("#ppt-plus").addEventListener("click", () => setPlayersPerTeam(draft.playersPerTeam + 1));
    s.querySelector("#cfg-life").addEventListener("change", (e) => {
      draft.startLife = Math.max(1, parseInt(e.target.value, 10) || 40);
    });
    s.querySelector("#back-btn").addEventListener("click", () => nav("menu"));
    s.querySelector("#start-btn").addEventListener("click", () => {
      const st = State.createTeamsGame({ numTeams: draft.numTeams, playersPerTeam: draft.playersPerTeam, startLife: draft.startLife });
      st.teams.teams.forEach((team, t) => {
        if (draft.teams[t].name.trim()) team.name = draft.teams[t].name.trim();
        team.players.forEach((p, i) => {
          const dp = draft.teams[t].players[i];
          if (dp.name.trim()) p.name = dp.name.trim();
          p.commander = dp.commander;
          p.partnerCommander = dp.partnerCommander || null;
          p.profileId = dp.profileId || null;
        });
      });
      State.ensureFallbackColors(st.teams.teams.reduce((acc, t) => acc.concat(t.players), []));
      State.save(st);
      game = st;
      const teamChoices = st.teams.teams.map((team) => ({ id: team.id, name: team.name }));
      openWhoStartsModal(teamChoices, (winnerTeamId) => {
        State.teamsSetStartingTeam(game, winnerTeamId);
        nav("game-teams");
      });
    });
  }

  // ===========================================================
  // JOGO — Equipas (Teams)
  // ===========================================================
  function teamRosterRowHtml(p, isActive) {
    return `
      <div class="team-roster-row ${isActive ? "up" : ""}" data-player-id="${p.id}">
        <div class="team-roster-thumb" style="${commanderThumbStyle(p.commander)}">${p.commander ? "" : "🃏"}</div>
        <div class="team-roster-name">${esc(p.name)}</div>
        <div class="tax-badge-sm" data-action="tax" data-player-id="${p.id}" title="Commander tax">${taxBadgeText(p)}</div>
        <button class="mini-btn" data-action="edit" data-player-id="${p.id}">✏️</button>
      </div>
    `;
  }

  function syncTeamEliminationBadge(panel, team) {
    const content = panel.querySelector(".content");
    let badge = panel.querySelector(".eliminated-badge");
    if (team.eliminated && !badge) {
      badge = el(`<div class="eliminated-badge" title="Toca para reverter">ELIMINADA</div>`);
      badge.addEventListener("click", (ev) => {
        ev.stopPropagation();
        State.teamsToggleEliminated(game, team.id);
        render();
      });
      content.appendChild(badge);
    } else if (!team.eliminated && badge) {
      badge.remove();
    }
  }

  function buildTeamPanel(team, rotated, currentTeam) {
    const isActive = currentTeam && currentTeam.id === team.id;
    const panel = el(`
      <div class="player-panel team-panel ${rotated ? "rot180" : ""} ${team.eliminated ? "eliminated" : ""} ${isActive ? "active-turn" : ""}" data-team-id="${team.id}">
        ${teamBgHtml(team)}
        <div class="content">
          ${isActive ? `<div class="turn-badge">▶ VEZ</div>` : ""}
          <div class="player-header">
            <div class="player-name">${esc(team.name)}</div>
          </div>
          <div class="life-zone">
            <div class="life-tap minus"><span class="tap-circle">−</span></div>
            <div class="life-tap plus"><span class="tap-circle">+</span></div>
            <div class="life-delta-fixed"></div>
            <div class="life-total">${team.life}</div>
          </div>
          ${isActive ? `<button class="panel-pass-turn-btn" data-action="pass-turn" ${game.teams.paused ? "disabled" : ""}>⏭️ Passar turno</button>` : ""}
          <div class="team-roster">${team.players.map((p) => teamRosterRowHtml(p, isActive)).join("")}</div>
        </div>
      </div>
    `);
    syncTeamEliminationBadge(panel, team);

    const minus = panel.querySelector(".life-tap.minus");
    const plus = panel.querySelector(".life-tap.plus");
    const deltaEl = panel.querySelector(".life-delta-fixed");
    let deltaAcc = 0;
    let deltaTimer = null;
    function bumpDelta(amount) {
      deltaAcc += amount;
      clearTimeout(deltaTimer);
      deltaEl.textContent = (deltaAcc > 0 ? "+" : "") + deltaAcc;
      deltaEl.classList.toggle("plus", deltaAcc >= 0);
      deltaEl.classList.toggle("minus", deltaAcc < 0);
      deltaEl.classList.add("show");
      deltaTimer = setTimeout(() => {
        deltaEl.classList.remove("show");
        deltaAcc = 0;
      }, 2000);
    }
    bindPressRepeat(minus, () => {
      State.teamsAdjustLife(game, team.id, -1);
      updateTeamPanel(team.id);
      bumpDelta(-1);
    });
    bindPressRepeat(plus, () => {
      State.teamsAdjustLife(game, team.id, 1);
      updateTeamPanel(team.id);
      bumpDelta(1);
    });
    panel.querySelectorAll('[data-action="edit"]').forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        openEditPlayerModal({ mode: "teams", playerId: btn.dataset.playerId });
      });
    });
    panel.querySelectorAll('[data-action="tax"]').forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        openCommanderTaxModal("teams", btn.dataset.playerId);
      });
    });
    const passBtn = panel.querySelector('[data-action="pass-turn"]');
    if (passBtn) passBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      State.teamsPassTurn(game);
      playTurnSound();
      render();
    });
    return panel;
  }

  function updateTeamPanel(teamId) {
    const team = game.teams.teams.find((t) => t.id === teamId);
    const panel = appEl.querySelector(`.team-panel[data-team-id="${teamId}"]`);
    if (!team || !panel) return;
    panel.classList.toggle("eliminated", team.eliminated);
    const lifeEl = panel.querySelector(".life-total");
    if (lifeEl) lifeEl.textContent = team.life;
    syncTeamEliminationBadge(panel, team);
  }

  function openEndGameTeamsModal() {
    closeAnyModal();
    const teams = game.teams.teams;
    const backdrop = el(`
      <div class="modal-backdrop center">
        <div class="modal-sheet">
          <h2>🏁 Terminar jogo</h2>
          <div class="footer-note" style="margin-bottom:10px">Que equipa venceu esta partida? (fica registado nos perfis ligados de todos os jogadores dessa equipa)</div>
          <div class="col" id="winner-list">
            ${teams.map((t) => `
              <label class="row" style="align-items:center;background:var(--bg-elev-2);border-radius:10px;padding:10px;">
                <input type="radio" name="winner" value="${t.id}" style="width:auto">
                <span class="grow">${esc(t.name)}${t.eliminated ? " (eliminada)" : ""}</span>
              </label>
            `).join("")}
            <label class="row" style="align-items:center;background:var(--bg-elev-2);border-radius:10px;padding:10px;">
              <input type="radio" name="winner" value="" style="width:auto" checked>
              <span class="grow">Sem vencedor / não contar</span>
            </label>
          </div>
          <div class="row" style="margin-top:14px">
            <button class="btn btn-ghost grow" id="eg-cancel">Cancelar</button>
            <button class="btn btn-primary grow" id="eg-confirm">📊 Ver Estatísticas</button>
          </div>
        </div>
      </div>
    `);
    document.body.appendChild(backdrop);
    backdrop.querySelector("#eg-cancel").addEventListener("click", () => backdrop.remove());
    backdrop.querySelector("#eg-confirm").addEventListener("click", () => {
      const sel = backdrop.querySelector('input[name="winner"]:checked');
      const winnerTeamId = sel && sel.value ? sel.value : null;
      const stats = State.teamsEndGame(game, winnerTeamId);
      backdrop.remove();
      nav("stats-standard", { stats });
    });
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
  }

  function renderGameTeams() {
    const teams = game.teams.teams;
    const currentTeam = State.teamsCurrentTeam(game);
    const paused = !!game.teams.paused;
    const { top, bottom } = layoutRows(teams.length);
    const topTeams = teams.slice(0, top);
    const bottomTeams = teams.slice(top);

    const s = el(`
      <div class="screen ${boardFullscreen ? "board-fullscreen" : ""}">
        ${boardFullscreen ? `<button class="fullscreen-toggle-btn" id="fullscreen-exit-btn" title="Sair de ecrã inteiro">🗗</button>` : ""}
        <div class="topbar">
          <button class="btn btn-icon" id="menu-btn">☰</button>
          <h1>🛡️ Equipas</h1>
          <div class="row" style="gap:6px; flex-shrink:0;">
            <button class="btn btn-icon" id="reset-btn" title="Reiniciar">↺</button>
            <button class="btn btn-icon" id="fullscreen-btn" title="${boardFullscreen ? "Sair de ecrã inteiro" : "Ecrã inteiro"}">${boardFullscreen ? "🗗" : "⛶"}</button>
          </div>
        </div>
        <div class="br-status-row">
          <div class="br-chip turn">👤 Vez: ${currentTeam ? esc(currentTeam.name) : "-"}</div>
          <div class="br-chip">🔁 Ronda: ${game.teams.roundNumber || 1}</div>
          <div class="br-chip" id="chip-turn-time">⏱ Turno: 00:00</div>
          <div class="br-chip" id="chip-total-time">⏳ Total: 00:00</div>
          ${paused ? `<div class="br-chip paused">⏸️ PAUSADO</div>` : ""}
        </div>
        <div class="board">
          <div class="board-row" id="row-top"></div>
          <div class="board-row" id="row-bottom"></div>
        </div>
        <div class="board-toolbar">
          <button class="btn btn-icon" id="pause-btn" title="${paused ? "Retomar" : "Pausar"}">${paused ? "▶️" : "⏸️"}</button>
          <button class="btn btn-icon" id="history-btn" title="Histórico de vida">📜</button>
          <button class="btn btn-icon" id="reorder-btn" title="Trocar posições">🔀</button>
          <button class="btn btn-ghost grow" id="end-game-btn">🏁 Terminar</button>
        </div>
      </div>
    `);
    appEl.appendChild(s);

    const rowTop = s.querySelector("#row-top");
    const rowBottom = s.querySelector("#row-bottom");
    topTeams.forEach((t) => rowTop.appendChild(buildTeamPanel(t, true, currentTeam)));
    bottomTeams.slice().reverse().forEach((t) => rowBottom.appendChild(buildTeamPanel(t, false, currentTeam)));

    function tickClock() {
      const chipTurn = s.querySelector("#chip-turn-time");
      const chipTotal = s.querySelector("#chip-total-time");
      if (!chipTurn || !chipTotal) { clearInterval(liveTimer); return; }
      const now = game.teams.paused ? game.teams.pausedAt : Date.now();
      chipTurn.textContent = "⏱ Turno: " + formatDuration(now - game.teams.turnStartedAt);
      chipTotal.textContent = "⏳ Total: " + formatDuration(now - game.teams.gameStartedAt);
    }
    tickClock();
    liveTimer = setInterval(tickClock, 1000);

    s.querySelector("#menu-btn").addEventListener("click", () => {
      if (confirm("Voltar ao menu? O jogo atual fica guardado e podes continuar mais tarde.")) nav("menu");
    });
    s.querySelector("#reset-btn").addEventListener("click", () => {
      if (!confirm("Reiniciar vidas de todas as equipas e os relógios de turno/jogo?")) return;
      const now = Date.now();
      game.teams.teams.forEach((team) => {
        team.life = game.teams.startLife;
        team.eliminated = false;
        team.players.forEach((p) => { p.cmdTax = 0; p.partnerCmdTax = 0; });
      });
      game.teams.roundNumber = 1;
      game.teams.roundStartIndex = game.teams.currentTurnIndex;
      game.teams.turnSeq = 1;
      game.teams.lifeLog = [];
      game.teams.gameStartedAt = now;
      game.teams.turnStartedAt = now;
      game.teams.paused = false;
      game.teams.pausedAt = null;
      State.save(game);
      render();
    });
    s.querySelector("#pause-btn").addEventListener("click", () => {
      State.teamsTogglePause(game);
      render();
    });
    s.querySelector("#history-btn").addEventListener("click", () => openLifeHistoryModal());
    s.querySelector("#reorder-btn").addEventListener("click", () => openReorderPositionsModal("teams"));
    s.querySelector("#fullscreen-btn").addEventListener("click", () => {
      boardFullscreen = !boardFullscreen;
      render();
    });
    const fsExitBtn = s.querySelector("#fullscreen-exit-btn");
    if (fsExitBtn) fsExitBtn.addEventListener("click", () => { boardFullscreen = !boardFullscreen; render(); });
    s.querySelector("#end-game-btn").addEventListener("click", () => openEndGameTeamsModal());
  }

  // ===========================================================
  // ESTATÍSTICAS DE FIM DE JOGO (partilhado por Standard e Battle Royale)
  // ===========================================================
  function buildStatsBlock(stats) {
    const maxTime = Math.max(1, ...stats.players.map((p) => p.turnTimeMs));
    const rows = stats.players
      .slice()
      .sort((a, b) => b.turnTimeMs - a.turnTimeMs)
      .map((p) => {
        const pct = stats.gameTimeMs ? Math.round((p.turnTimeMs / stats.gameTimeMs) * 100) : 0;
        const barPct = Math.round((p.turnTimeMs / maxTime) * 100);
        const isWinner = Array.isArray(stats.winnerId) ? stats.winnerId.includes(p.id) : stats.winnerId === p.id;
        return `
          <div class="stat-row ${isWinner ? "winner" : ""}">
            <div class="stat-avatar" style="${p.commander && p.commander.art ? `background-image:url('${esc(p.commander.art)}')` : ""}">${p.commander ? "" : "🃏"}</div>
            <div class="stat-info">
              <div class="stat-name">${isWinner ? "👑 " : ""}${esc(p.name)}${p.eliminated ? " 💀" : ""}</div>
              <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${barPct}%"></div></div>
              <div class="stat-meta">${formatDuration(p.turnTimeMs)} em turno · ${p.turnsTaken} turno(s) · média ${formatDuration(p.avgTurnMs)}/turno · ${pct}% do jogo</div>
            </div>
          </div>`;
      })
      .join("");
    return `
      <div class="stats-total">⏱️ Duração total do jogo: <strong>${formatDuration(stats.gameTimeMs)}</strong></div>
      <div class="stats-list">${rows}</div>
    `;
  }

  function renderStatsStandard() {
    const stats = screenParams.stats;
    const s = el(`
      <div class="screen">
        <div class="topbar">
          <div style="width:40px"></div>
          <h1>📊 Estatísticas do Jogo</h1>
          <div style="width:40px"></div>
        </div>
        <div class="scroll">${buildStatsBlock(stats)}</div>
        <div class="board-toolbar">
          <button class="btn btn-primary btn-block" id="stats-menu-btn">Menu</button>
        </div>
      </div>
    `);
    appEl.appendChild(s);
    s.querySelector("#stats-menu-btn").addEventListener("click", () => { State.clear(); nav("menu"); });
  }

  // ===========================================================
  // TROCAR POSIÇÕES / HISTÓRICO DE VIDA (jogo atual, qualquer modo)
  // ===========================================================
  /** Deixa reordenar a posição dos jogadores/equipas no tabuleiro (só a
   *  disposição visual — não mexe na ordem dos turnos). mode: "standard" |
   *  "br" | "teams". */
  function openReorderPositionsModal(mode) {
    closeAnyModal();
    let items;
    if (mode === "standard") items = game.standard.players.map((p) => ({ id: p.id, name: p.name }));
    else if (mode === "teams") items = game.teams.teams.map((t) => ({ id: t.id, name: t.name }));
    else items = game.br.players.map((p) => ({ id: p.id, name: p.name }));
    const noun = mode === "teams" ? "equipa" : "jogador";

    const backdrop = el(`
      <div class="modal-backdrop center">
        <div class="modal-sheet">
          <h2>🔀 Trocar posições</h2>
          <div class="footer-note" style="margin-bottom:10px">Usa as setas para mudar a posição de cada ${noun} no tabuleiro — não afeta a ordem dos turnos.</div>
          <div class="col" id="reorder-list"></div>
          <div class="row" style="margin-top:14px">
            <button class="btn btn-primary grow" id="reorder-done-btn">Concluído</button>
          </div>
        </div>
      </div>
    `);
    document.body.appendChild(backdrop);

    function applyOrder() {
      const ids = items.map((it) => it.id);
      if (mode === "standard") State.stdReorderPlayers(game, ids);
      else if (mode === "teams") State.teamsReorderTeams(game, ids);
      else State.brReorderPlayers(game, ids);
    }

    function paintList() {
      const list = backdrop.querySelector("#reorder-list");
      list.innerHTML = "";
      items.forEach((it, idx) => {
        const row = el(`
          <div class="row" style="align-items:center;background:var(--bg-elev-2);border-radius:10px;padding:8px 10px;margin-bottom:6px;gap:8px;">
            <span class="grow" style="font-weight:600;font-size:.85rem;">${esc(it.name)}</span>
            <button class="btn btn-icon" style="width:34px;height:34px;font-size:.85rem;" data-act="up" data-idx="${idx}" ${idx === 0 ? "disabled" : ""}>▲</button>
            <button class="btn btn-icon" style="width:34px;height:34px;font-size:.85rem;" data-act="down" data-idx="${idx}" ${idx === items.length - 1 ? "disabled" : ""}>▼</button>
          </div>
        `);
        list.appendChild(row);
      });
      list.querySelectorAll('[data-act="up"]').forEach((btn) => btn.addEventListener("click", () => {
        const i = parseInt(btn.dataset.idx, 10);
        if (i <= 0) return;
        [items[i - 1], items[i]] = [items[i], items[i - 1]];
        applyOrder();
        paintList();
      }));
      list.querySelectorAll('[data-act="down"]').forEach((btn) => btn.addEventListener("click", () => {
        const i = parseInt(btn.dataset.idx, 10);
        if (i >= items.length - 1) return;
        [items[i + 1], items[i]] = [items[i], items[i + 1]];
        applyOrder();
        paintList();
      }));
    }
    paintList();
    backdrop.querySelector("#reorder-done-btn").addEventListener("click", () => { backdrop.remove(); render(); });
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) { backdrop.remove(); render(); } });
  }

  /** Histórico ao vivo das alterações de vida do jogo atual (qualquer modo),
   *  agrupado por turno — mostra CADA alteração individual (ex: -3, +5, -1),
   *  não só a diferença total acumulada, e quem estava a jogar em cada turno. */
  function openLifeHistoryModal() {
    closeAnyModal();
    const modeState = game.mode === "standard" ? game.standard : game.mode === "br" ? game.br : game.teams;
    const log = (modeState && modeState.lifeLog) || [];
    const groups = [];
    const byTurn = new Map();
    log.forEach((entry) => {
      if (!byTurn.has(entry.turnSeq)) {
        const g = { turnSeq: entry.turnSeq, roundNumber: entry.roundNumber, turnName: entry.turnName, entries: [] };
        byTurn.set(entry.turnSeq, g);
        groups.push(g);
      }
      byTurn.get(entry.turnSeq).entries.push(entry);
    });
    groups.sort((a, b) => b.turnSeq - a.turnSeq);

    const backdrop = el(`
      <div class="modal-backdrop center">
        <div class="modal-sheet">
          <h2>📜 Histórico de vida</h2>
          <div class="scroll" style="padding:0; flex:1; min-height:0;">
            ${groups.length ? `<div id="life-history-list"></div>` : `<div class="footer-note">Ainda não há alterações de vida registadas neste jogo.</div>`}
          </div>
          <div class="row" style="margin-top:12px;">
            <button class="btn btn-ghost grow" id="close-lh-btn">Fechar</button>
          </div>
        </div>
      </div>
    `);
    document.body.appendChild(backdrop);
    // Junta toques consecutivos do MESMO alvo feitos a menos de 2s uns dos
    // outros numa só linha (o mesmo intervalo usado no indicador ao vivo do
    // tabuleiro) — ex: -1,-1,-1 seguidos viram uma linha "-3" — mas mantém
    // ações separadas no tempo como linhas distintas (-3; +5; -1), nunca
    // reduzindo tudo à diferença total do turno.
    function mergeBursts(entries) {
      const merged = [];
      entries.forEach((entry) => {
        const last = merged[merged.length - 1];
        if (last && last.targetId === entry.targetId && entry.ts - last.lastTs <= 2000) {
          last.delta += entry.delta;
          last.lastTs = entry.ts;
        } else {
          merged.push({ targetId: entry.targetId, targetName: entry.targetName, delta: entry.delta, ts: entry.ts, lastTs: entry.ts });
        }
      });
      return merged;
    }

    const list = backdrop.querySelector("#life-history-list");
    if (list) {
      list.classList.add("lh-timeline");
      groups.forEach((g) => {
        const bursts = mergeBursts(g.entries.slice().sort((a, b) => a.ts - b.ts)).filter((b) => b.delta !== 0);
        if (!bursts.length) return;
        list.appendChild(el(`<div class="lh-turn"><span class="lh-turn-round">Ronda ${g.roundNumber}</span> · Turno de ${esc(g.turnName)}</div>`));
        bursts.forEach((entry) => {
          const sign = entry.delta > 0 ? "plus" : "minus";
          const row = el(`
            <div class="lh-event ${sign}">
              <div class="lh-event-body">
                <div class="lh-event-name">${esc(entry.targetName)}</div>
                <div class="lh-event-time">${formatTimeOnly(entry.ts)}</div>
              </div>
              <div class="lh-event-delta ${sign}">${entry.delta > 0 ? "+" : ""}${entry.delta}</div>
            </div>
          `);
          list.appendChild(row);
        });
      });
      if (!list.children.length) list.appendChild(el(`<div class="footer-note">Ainda não há alterações de vida registadas neste jogo.</div>`));
    }
    backdrop.querySelector("#close-lh-btn").addEventListener("click", () => backdrop.remove());
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
  }

  function renderProfilesScreen() {
    const profiles = Profiles.all();
    const s = el(`
      <div class="screen">
        <div class="topbar">
          <button class="btn btn-icon" id="back-btn">←</button>
          <h1>👤 Perfis</h1>
          <div style="width:40px"></div>
        </div>
        <div class="scroll">
          <div class="row" style="gap:8px; margin-bottom:12px;">
            <button class="btn btn-ghost grow" id="export-profiles-btn">⬇️ Exportar</button>
            <button class="btn btn-ghost grow" id="import-profiles-btn">⬆️ Importar</button>
            <input type="file" id="import-profiles-input" accept="application/json,.json" style="display:none">
          </div>
          ${profiles.length ? "" : `<div class="footer-note">Ainda não tens perfis guardados. Cria um ao escolher o commander de um jogador, no ecrã de setup de um jogo.</div>`}
          <div class="col" id="profiles-list"></div>
        </div>
      </div>
    `);
    appEl.appendChild(s);
    s.querySelector("#export-profiles-btn").addEventListener("click", () => {
      const json = Profiles.exportAll();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `mtg-life-counter-perfis-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    });
    const importInput = s.querySelector("#import-profiles-input");
    s.querySelector("#import-profiles-btn").addEventListener("click", () => importInput.click());
    importInput.addEventListener("change", () => {
      const file = importInput.files && importInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        let count = 0;
        try {
          const parsed = JSON.parse(String(reader.result));
          const list = Array.isArray(parsed) ? parsed : parsed.profiles;
          count = Profiles.importList(list);
        } catch (e) {
          count = -1;
        }
        importInput.value = "";
        if (count < 0) alert("Não foi possível ler este ficheiro. Confirma que é um ficheiro exportado por esta app.");
        else if (count === 0) alert("Não foram encontrados perfis válidos neste ficheiro.");
        else alert(`${count} perfil${count === 1 ? "" : "s"} importado${count === 1 ? "" : "s"} com sucesso.`);
        render();
      };
      reader.readAsText(file);
    });
    const list = s.querySelector("#profiles-list");
    profiles.forEach((p) => {
      const d = Profiles.derived(p);
      const card = el(`
        <div class="profile-card">
          <div class="commander-thumb" style="${commanderThumbStyle(p.commander)}">${p.commander ? "" : "🃏"}</div>
          <div class="profile-info">
            <div class="profile-name">${esc(p.name)}</div>
            <div class="profile-sub">${p.commander ? esc(p.commander.name) : "Sem commander"}</div>
            <div class="profile-stats-grid">
              <div>🎮 ${d.games} jogo(s)</div>
              <div>🏆 ${d.wins} vitória(s)${d.games ? " (" + Math.round(d.winRate * 100) + "%)" : ""}</div>
              <div>⏱️ Média/turno: ${formatDuration(d.avgTurnTimeMs)}</div>
              <div>⏱️ Média/jogo: ${formatDuration(d.avgGameTimeMs)}</div>
              <div>⏳ Total jogado: ${formatDuration(d.totalGameTimeMs)}</div>
              <div>🔁 Turnos totais: ${d.turnsTaken}</div>
            </div>
          </div>
          <div class="col gap-sm">
            <button class="btn btn-icon" data-act="history" data-id="${p.id}" title="Ver histórico">📜</button>
            <button class="btn btn-icon" data-act="delete" data-id="${p.id}" title="Apagar perfil">🗑️</button>
          </div>
        </div>
      `);
      card.querySelector('button[data-act="delete"]').addEventListener("click", () => {
        if (confirm(`Apagar o perfil "${p.name}"? Esta ação não pode ser desfeita.`)) {
          Profiles.remove(p.id);
          render();
        }
      });
      card.querySelector('button[data-act="history"]').addEventListener("click", () => {
        openProfileHistoryModal(p.id);
      });
      list.appendChild(card);
    });
    s.querySelector("#back-btn").addEventListener("click", () => nav("menu"));
  }

  function openProfileHistoryModal(profileId) {
    closeAnyModal();
    const backdrop = el(`<div class="modal-backdrop center"><div class="modal-sheet"></div></div>`);
    const sheet = backdrop.querySelector(".modal-sheet");
    appEl.appendChild(backdrop);

    function paint() {
      const profile = Profiles.get(profileId);
      if (!profile) { backdrop.remove(); return; }
      const history = Profiles.historyOf(profileId);
      sheet.innerHTML = `
        <h2>📜 Histórico — ${esc(profile.name)}</h2>
        <div class="scroll" style="padding:0; flex:1; min-height:0;">
          ${history.length ? `<div class="col" id="history-list"></div>` : `<div class="footer-note">Ainda não há jogos registados para este perfil.</div>`}
        </div>
        <div class="row" style="margin-top:12px;">
          <button class="btn btn-ghost grow" id="close-history-btn">Fechar</button>
        </div>
      `;
      const list = sheet.querySelector("#history-list");
      if (list) {
        history.forEach((g) => {
          const row = el(`
            <div class="cd-list-item" style="align-items:flex-start;">
              <div style="flex:1; min-width:0;">
                <div class="nm">${g.won ? "🏆 Vitória" : "❌ Derrota"} — ${esc(modeLabel(g.mode))}</div>
                <div class="commander-name" style="margin-top:3px;">${formatDateTime(g.date)}</div>
                <div class="history-meta">⏳ Jogo: ${formatDuration(g.gameTimeMs)} · ⏱️ Nos teus turnos: ${formatDuration(g.turnTimeMs)} (${g.turnsTaken} turno${g.turnsTaken === 1 ? "" : "s"})</div>
              </div>
              <button class="btn btn-icon" style="flex-shrink:0;" data-gid="${g.id}" title="Apagar este jogo">🗑️</button>
            </div>
          `);
          row.querySelector("button[data-gid]").addEventListener("click", () => {
            if (confirm("Apagar este jogo do histórico? As stats do perfil serão atualizadas.")) {
              Profiles.removeGame(profileId, g.id);
              paint();
            }
          });
          list.appendChild(row);
        });
      }
      sheet.querySelector("#close-history-btn").addEventListener("click", () => render());
    }
    paint();
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) render(); });
  }

  // ---------------------------------------------------------
  // Arranque
  // ---------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    render();
    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  });
})();
