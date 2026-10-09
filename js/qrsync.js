/* ===========================================================
   qrsync.js — passar os perfis de um telemóvel para outro por
   código QR. Os dados são comprimidos e partidos em várias partes;
   o ecrã que envia mostra-as em ciclo (QR animado) e o que recebe
   vai lendo com a câmara até ter todas, por qualquer ordem.

   Formato de cada parte (bytes):
     0-1  "ML"   assinatura
     2    1      versão do formato
     3-4  id da transmissão (para não misturar duas)
     5    índice da parte (0..n-1)
     6    n.º total de partes
     7    1 = comprimido (deflate-raw), 0 = texto simples
     8..  pedaço dos dados
   As bibliotecas (js/vendor) só são carregadas quando são precisas.
   =========================================================== */
(function (global) {
  const CHUNK = 450;          // bytes por QR: pequeno o suficiente para ler bem num ecrã de telemóvel
  const HEADER = 8;

  const loaded = {};
  function loadScript(src) {
    if (!loaded[src]) {
      loaded[src] = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        s.onload = resolve;
        s.onerror = () => { delete loaded[src]; reject(new Error("load " + src)); };
        document.head.appendChild(s);
      });
    }
    return loaded[src];
  }

  async function pipe(u8, stream) {
    const buf = await new Response(new Blob([u8]).stream().pipeThrough(stream)).arrayBuffer();
    return new Uint8Array(buf);
  }
  const canCompress = () => typeof CompressionStream === "function";

  /** Objeto → lista de partes (Uint8Array), cada uma para um QR. */
  async function encode(obj) {
    let data = new TextEncoder().encode(JSON.stringify(obj));
    let flag = 0;
    if (canCompress()) {
      try { data = await pipe(data, new CompressionStream("deflate-raw")); flag = 1; } catch (e) { /* segue sem comprimir */ }
    }
    const total = Math.max(1, Math.ceil(data.length / CHUNK));
    if (total > 255) throw new Error("too-big");
    const sid = Math.floor(Math.random() * 65536);
    const frames = [];
    for (let i = 0; i < total; i++) {
      const part = data.subarray(i * CHUNK, (i + 1) * CHUNK);
      const f = new Uint8Array(HEADER + part.length);
      f.set([77, 76, 1, sid >> 8, sid & 255, i, total, flag]);
      f.set(part, HEADER);
      frames.push(f);
    }
    return frames;
  }

  /** Junta as partes lidas. add() devolve true quando a parte é nova. */
  function collector() {
    let sid = null;
    let total = 0;
    let flag = 0;
    const parts = new Map();
    return {
      add(bytes) {
        if (!bytes || bytes.length < HEADER || bytes[0] !== 77 || bytes[1] !== 76 || bytes[2] !== 1) return false;
        const id = (bytes[3] << 8) | bytes[4];
        if (sid !== id) { sid = id; parts.clear(); } // outra transmissão: recomeça
        total = bytes[6];
        flag = bytes[7];
        if (parts.has(bytes[5])) return false;
        parts.set(bytes[5], Uint8Array.from(bytes.slice(HEADER)));
        return true;
      },
      get got() { return parts.size; },
      get total() { return total; },
      get done() { return total > 0 && parts.size === total; },
      async result() {
        const len = Array.from(parts.values()).reduce((a, p) => a + p.length, 0);
        let data = new Uint8Array(len);
        let off = 0;
        for (let i = 0; i < total; i++) { data.set(parts.get(i), off); off += parts.get(i).length; }
        if (flag === 1) {
          if (typeof DecompressionStream !== "function") throw new Error("no-decompress");
          data = await pipe(data, new DecompressionStream("deflate-raw"));
        }
        return JSON.parse(new TextDecoder().decode(data));
      },
    };
  }

  /** Desenha uma parte num canvas (sempre preto sobre branco, com margem). */
  async function draw(canvas, frame, cssSize) {
    await loadScript("./js/vendor/qrcode.min.js");
    const qr = global.qrcode(0, "M");
    let bin = "";
    for (let i = 0; i < frame.length; i++) bin += String.fromCharCode(frame[i]);
    qr.addData(bin, "Byte");
    qr.make();
    const n = qr.getModuleCount();
    const quiet = 4;
    const dpr = Math.min(3, global.devicePixelRatio || 1);
    const cell = Math.max(1, Math.floor((cssSize * dpr) / (n + quiet * 2)));
    const px = cell * (n + quiet * 2);
    canvas.width = px;
    canvas.height = px;
    canvas.style.width = canvas.style.height = Math.round(px / dpr) + "px";
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = "#000";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
    }
  }

  /** Lê QR a partir da câmara (traseira). onBytes recebe os bytes de cada
   *  QR encontrado. Devolve uma função para parar. */
  async function scan(video, onBytes) {
    await loadScript("./js/vendor/jsQR.min.js");
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    video.srcObject = stream;
    video.setAttribute("playsinline", "");
    video.muted = true;
    await video.play().catch(() => {});
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let stopped = false;
    let last = 0;
    function tick(t) {
      if (stopped) return;
      requestAnimationFrame(tick);
      if (t - last < 90 || video.readyState < 2) return; // ~10 leituras por segundo
      last = t;
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return;
      // só o quadrado central, reduzido: mais rápido e é onde o QR está
      const side = Math.min(w, h);
      const out = Math.min(side, 720);
      canvas.width = canvas.height = out;
      ctx.drawImage(video, (w - side) / 2, (h - side) / 2, side, side, 0, 0, out, out);
      const img = ctx.getImageData(0, 0, out, out);
      const res = global.jsQR(img.data, out, out, { inversionAttempts: "dontInvert" });
      if (res && res.binaryData && res.binaryData.length) onBytes(res.binaryData);
    }
    requestAnimationFrame(tick);
    return () => {
      stopped = true;
      stream.getTracks().forEach((tr) => tr.stop());
      video.srcObject = null;
    };
  }

  global.MTG = global.MTG || {};
  global.MTG.QrSync = { encode, collector, draw, scan, CHUNK };
})(window);
