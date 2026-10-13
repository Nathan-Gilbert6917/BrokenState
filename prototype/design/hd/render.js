// Render an HD design set to docs/sprite-designs/<set>.png:  node design/hd/render.js <set> [up=4] [cols]
// The set module (design/hd/<set>.js) exports SHEET: [{ label, paint }] and optionally SHEET_TITLE and SHEET_COLS.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sheet, writePNG } from "./hdpng.js";
const here = dirname(fileURLToPath(import.meta.url));
const [set, upArg, colsArg] = process.argv.slice(2);
if (!set) { console.error("usage: node design/hd/render.js <set> [up] [cols]"); process.exit(1); }
const m = await import(`./${set}.js`);
const up = Number(upArg) || 4, cols = Number(colsArg) || m.SHEET_COLS || 8;
const out = join(here, "../../../docs/sprite-designs", `${set}.png`);
writePNG(out, sheet(m.SHEET, { cols, up, title: m.SHEET_TITLE || set }), 1);
console.log(out, `${m.SHEET.length} cells`);
