#!/usr/bin/env node
/* ===========================================================
   Testes automáticos da app (Playwright + Chromium).

   Uso:  npm test                  (todos)
         node tests/run.js elo     (só os ficheiros com "elo" no nome)

   Cada ficheiro tests/*.test.js exporta uma lista de testes
   [{ name, run(t) }]. O `t` dá um browser, páginas com os erros de JS
   apanhados (um erro na página faz o teste falhar), a URL da app servida
   localmente e pequenas asserções. Os pedidos para fora (Scryfall,
   Supabase) são bloqueados por defeito; cada teste pode simulá-los.
   =========================================================== */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function loadPlaywright() {
  try {
    return require("playwright");
  } catch (e) {
    // sem node_modules: usa o Playwright instalado globalmente
    const globalRoot = require("child_process").execSync("npm root -g").toString().trim();
    return require(path.join(globalRoot, "playwright"));
  }
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".mp3": "audio/mpeg",
};

/** Servidor estático da pasta da app numa porta livre. Usa 127.0.0.1 (não
 *  "localhost") para o service worker não se registar e não haver cache
 *  entre testes. */
function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.endsWith("/")) p += "index.html";
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end("not found"); return; }
        res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

class AssertionError extends Error {}

async function main() {
  const filter = process.argv[2] || "";
  const files = fs.readdirSync(__dirname).filter((f) => f.endsWith(".test.js") && f.includes(filter)).sort();
  const { chromium } = loadPlaywright();
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/`;
  const launchOpts = fs.existsSync("/opt/pw-browsers/chromium") && !process.env.PLAYWRIGHT_BROWSERS_PATH ? { executablePath: "/opt/pw-browsers/chromium" } : {};
  const browser = await chromium.launch(launchOpts);
  let passed = 0;
  const failures = [];

  for (const file of files) {
    const tests = require(path.join(__dirname, file));
    for (const test of tests) {
      const label = `${file.replace(".test.js", "")} › ${test.name}`;
      const contexts = [];
      const pageErrors = [];
      const t = {
        url,
        browser,
        root: ROOT,
        /** Nova página isolada (contexto próprio). opts = opções do contexto. */
        async page(opts) {
          const ctx = await browser.newContext(Object.assign({ viewport: { width: 390, height: 844 }, locale: "pt-PT" }, opts || {}));
          contexts.push(ctx);
          // nada sai para a internet, a não ser que o teste o simule
          await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
          const page = await ctx.newPage();
          page.on("pageerror", (e) => pageErrors.push(e.message));
          page.on("dialog", (d) => d.accept());
          return page;
        },
        ok(cond, msg) { if (!cond) throw new AssertionError(msg || "esperava verdadeiro"); },
        eq(actual, expected, msg) {
          const a = JSON.stringify(actual), e = JSON.stringify(expected);
          if (a !== e) throw new AssertionError(`${msg || "valores diferentes"}\n      esperado: ${e}\n      obtido:   ${a}`);
        },
      };
      const started = Date.now();
      try {
        await test.run(t);
        if (pageErrors.length) throw new AssertionError("erros de JavaScript na página:\n      " + pageErrors.join("\n      "));
        passed++;
        console.log(`  ✓ ${label} (${Date.now() - started} ms)`);
      } catch (err) {
        failures.push(label);
        console.log(`  ✗ ${label}\n      ${err instanceof AssertionError ? err.message : (err && err.stack) || err}`);
      } finally {
        for (const ctx of contexts) await ctx.close().catch(() => {});
      }
    }
  }

  await browser.close();
  server.close();
  console.log(`\n${passed} passaram, ${failures.length} falharam`);
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
