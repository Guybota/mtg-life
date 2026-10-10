/* Traduções: todas as frases usadas existem em inglês e não há repetidas. */
const fs = require("fs");
const path = require("path");

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === "vendor" ? [] : jsFiles(p);
    return d.name.endsWith(".js") && d.name !== "i18n.js" ? [p] : [];
  });
}

module.exports = [
  {
    name: "dicionário inglês completo e sem chaves repetidas",
    async run(t) {
      const src = fs.readFileSync(path.join(t.root, "js/i18n.js"), "utf8");
      const start = src.indexOf("const EN = {");
      const block = src.slice(start, src.indexOf("\n  };", start));
      const keys = [...block.matchAll(/^\s*"((?:[^"\\]|\\.)*)":/gm)].map((m) => m[1]);
      const dups = keys.filter((k, i) => keys.indexOf(k) !== i);
      t.eq(dups, [], "chaves repetidas no dicionário");
      const have = new Set(keys);
      const used = new Set();
      jsFiles(path.join(t.root, "js")).forEach((f) => {
        for (const m of fs.readFileSync(f, "utf8").matchAll(/\btr\("((?:[^"\\]|\\.)*)"/g)) used.add(m[1]);
      });
      t.ok(used.size > 300, "encontrou poucas frases — o padrão tr(\"...\") mudou?");
      t.eq([...used].filter((k) => !have.has(k)), [], "frases sem tradução");
    },
  },
];
