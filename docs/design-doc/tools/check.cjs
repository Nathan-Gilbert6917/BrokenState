// Sanity check for the assembled index.html: scripts parse, every image index resolves, tags balance.
const h = require("fs").readFileSync(require("path").resolve(__dirname, "..", "index.html"), "utf8");
for (const [, s] of h.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
  try { new Function(s); } catch (e) { console.log("SCRIPT ERROR", e.message); }
}
const I = JSON.parse(h.match(/const I=(\[[\s\S]*?\]);/)[1]);
const idx = [...h.matchAll(/data-i="(\d+)"/g)].map((m) => +m[1]);
console.log("images", I.length, "img tags", idx.length, "max index", Math.max(...idx));
const count = (re) => (h.match(re) || []).length;
for (const t of ["section", "article", "table", "div", "aside", "ul", "dl"]) {
  const o = count(new RegExp(`<${t}\\b`, "g")), c = count(new RegExp(`</${t}>`, "g"));
  console.log(t, o, c, o === c ? "" : "MISMATCH");
}
