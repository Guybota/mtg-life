/* ===========================================================
   cloudsync.js — sincronização dos perfis num grupo partilhado
   (Supabase). Os dados continuam no aparelho e a app funciona sem
   rede; quando há rede, lê o grupo, junta com o que está cá (sem
   duplicar jogos — Profiles.syncMerge) e grava o resultado.

   A base de dados só se usa por duas funções, sempre com o código do
   grupo: mtg_life_get(code) e mtg_life_put(code, data, version). A
   gravação só é aceite se ninguém gravou entretanto (version igual);
   se outro aparelho gravou primeiro, volta-se a ler, juntar e gravar.
   A chave usada aqui é a pública ("anon") — não dá acesso à tabela.
   =========================================================== */
(function (global) {
  const CFG = {
    url: "https://mhyscerwzmnzqouvrdeu.supabase.co",
    key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oeXNjZXJ3em1uenFvdXZyZGV1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1ODcxNDUsImV4cCI6MjEwNzE2MzE0NX0.LhwgqXdK_oWIonWl6RmVqqwDhZ3sxFpfjdkZg8o2WlE",
  };
  const STATE_KEY = "mtg_lc_cloud_v1";
  const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sem 0/O, 1/I/L
  const Profiles = () => global.MTG.Profiles;

  function state() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveState(patch) {
    const s = Object.assign(state(), patch);
    try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (e) { /* ok */ }
    return s;
  }

  const statusListeners = [];
  function onStatus(fn) { statusListeners.push(fn); }
  function emit() { const s = status(); statusListeners.forEach((fn) => { try { fn(s); } catch (e) { /* ok */ } }); }
  let running = null;
  let lastResult = null; // o que a última sincronização mudou cá
  function status() {
    const s = state();
    return { code: s.code || null, lastSync: s.lastSync || 0, lastError: s.lastError || null, syncing: !!running, lastResult };
  }

  // ---------- códigos de grupo ----------
  function newCode() {
    const bytes = new Uint8Array(12);
    (global.crypto || {}).getRandomValues ? global.crypto.getRandomValues(bytes) : bytes.forEach((_, i) => { bytes[i] = Math.floor(Math.random() * 256); });
    let c = "";
    bytes.forEach((b) => { c += ALPHABET[b % ALPHABET.length]; });
    return c.slice(0, 4) + "-" + c.slice(4, 8) + "-" + c.slice(8, 12);
  }
  /** Aceita o código como a pessoa o escrever (minúsculas, espaços, sem traços). */
  function normalizeCode(raw) {
    const s = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (s.length !== 12 || !s.split("").every((ch) => ALPHABET.includes(ch))) return null;
    return s.slice(0, 4) + "-" + s.slice(4, 8) + "-" + s.slice(8, 12);
  }

  // ---------- transporte (Supabase REST) ----------
  async function rpc(name, body) {
    const res = await fetch(`${CFG.url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: CFG.key, Authorization: `Bearer ${CFG.key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("http " + res.status);
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  }
  let transport = {
    async get(code) {
      const r = await rpc("mtg_life_get", { p_code: code });
      const row = Array.isArray(r) ? r[0] : r;
      return row ? { data: row.data, version: Number(row.version) } : null;
    },
    async put(code, data, version) {
      const v = await rpc("mtg_life_put", { p_code: code, p_data: data, p_version: version });
      return v == null ? null : Number(v);
    },
  };

  // Forma canónica dos dados (chaves e listas sempre pela mesma ordem), para
  // comparar o que está cá com o que está no grupo: o Postgres (jsonb)
  // devolve as chaves noutra ordem e cada aparelho tem os perfis por outra
  // ordem — sem isto, os aparelhos ficavam a regravar o mesmo à vez.
  function canon(v) {
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    if (v && typeof v === "object") return "{" + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
    return JSON.stringify(v === undefined ? null : v);
  }
  function normalizedData(d) {
    if (!d || typeof d !== "object") return "";
    const byId = (a, b) => String(a.id).localeCompare(String(b.id));
    const profiles = (Array.isArray(d.profiles) ? d.profiles : []).map((p) => Object.assign({}, p, {
      history: (Array.isArray(p.history) ? p.history.slice() : []).sort(byId),
      aliases: p.aliases ? p.aliases.slice().sort() : undefined,
    })).sort(byId);
    return canon({ profiles, deleted: d.deleted || {}, playerAliases: d.playerAliases || {} });
  }
  function fingerprint(d) {
    const s = normalizedData(d);
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return s.length + ":" + h;
  }

  /** Lê o grupo, junta e grava (com novas tentativas se houver conflito).
   *  Devolve o que mudou cá: { profiles, games, removed }. */
  function sync() {
    const s = state();
    if (!s.code) return Promise.resolve(null);
    if (running) return running;
    running = (async () => {
      emit();
      const total = { profiles: 0, games: 0, removed: 0 };
      for (let attempt = 0; attempt < 4; attempt++) {
        const remote = await transport.get(s.code);
        const remoteVersion = remote ? remote.version : 0;
        if (remote && remote.data) {
          const r = Profiles().syncMerge(remote.data);
          total.profiles += r.profiles; total.games += r.games; total.removed += r.removed;
        }
        const payload = Profiles().syncPayload();
        const fp = fingerprint(payload);
        // o grupo já tem exatamente o mesmo que está cá: não é preciso gravar
        if (remote && fingerprint(remote.data) === fp) {
          saveState({ version: remoteVersion, fp, lastSync: Date.now(), lastError: null });
          return total;
        }
        const v = await transport.put(s.code, payload, remoteVersion);
        if (v != null) {
          saveState({ version: v, fp, lastSync: Date.now(), lastError: null });
          return total;
        }
        // outro aparelho gravou entretanto: volta a ler e juntar
      }
      throw new Error("conflict");
    })();
    const p = running;
    p.then((r) => { lastResult = r; }, (e) => { saveState({ lastError: String((e && e.message) || e) }); })
      .finally(() => { running = null; emit(); });
    return p;
  }

  // sincronização automática, com uma pequena espera depois de alterações
  let timer = null;
  function schedule(ms) {
    if (!state().code) return;
    clearTimeout(timer);
    timer = setTimeout(() => { sync().catch(() => {}); }, ms == null ? 4000 : ms);
  }

  /** Cria um grupo novo com os perfis deste aparelho. */
  async function createGroup() {
    const code = newCode();
    saveState({ code, version: 0, fp: null, lastError: null });
    emit();
    await sync();
    return code;
  }
  /** Lê um grupo existente (sem entrar ainda): null se não existir. */
  async function peekGroup(code) {
    return transport.get(code);
  }
  /** Entra num grupo (depois de a revisão da fusão ter sido aceite). */
  async function joinGroup(code) {
    saveState({ code, version: 0, fp: null, lastError: null });
    emit();
    return sync();
  }
  function leaveGroup() {
    clearTimeout(timer);
    try { localStorage.removeItem(STATE_KEY); } catch (e) { /* ok */ }
    emit();
  }

  function init() {
    Profiles().onChange(() => schedule());
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") schedule(500); });
    }
    if (typeof window !== "undefined") window.addEventListener("online", () => schedule(500));
    schedule(800);
  }

  global.MTG = global.MTG || {};
  global.MTG.Cloud = {
    status, onStatus, sync, schedule, createGroup, peekGroup, joinGroup, leaveGroup, normalizeCode, newCode, init,
    _setTransport(t) { transport = t; }, // para testes
  };
})(typeof window !== "undefined" ? window : globalThis);
