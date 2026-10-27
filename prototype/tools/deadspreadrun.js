// A headless run of the spread of the dead (src/sim/deadspread.js, issue #66): a Normal world on the autopilot for N
// years (tickHour, so the day's recalculation, the spread, the player's and the groups' kills all run), printing at
// each year the share of land at each band of the dead by land class, the mean count against the cap, and whether the
// cities stay highest and the rural land under its cap. Not a test (it is slow): run it by hand, in the background.
// Issue #76: with --maps <file>, at day 1 and each year's end a line of JSON with every tile's count of the dead, its
// cap and its land class and the hives' tiles (tools/spreadmaps.js reads it: the deep countryside's tables and the
// yearly heat maps), so the same tool on an older build gives the same data.
// Usage: node tools/deadspreadrun.js [years=2] [seed=42] [size=normal] [--noauto] [--maps <file>]
import { createWorld, tickHour, day } from "../src/sim/world.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { WORLD_SIZES } from "../src/sim/worldsize.js";
import { popCap, tileDead, bandOfCount } from "../src/sim/deadpop.js";
import { tileClass } from "../src/sim/placement.js";
import { writeFileSync, appendFileSync } from "node:fs";

const argv = process.argv.slice(2), mi = argv.indexOf("--maps"), mapFile = mi >= 0 ? argv[mi + 1] : null;
const args = argv.filter((a, i) => !a.startsWith("--") && !(mi >= 0 && i === mi + 1));
const years = Number(args[0] || 2), seed = Number(args[1] || 42), size = args[2] || "normal";
const st = createWorld({ seed, factionCount: WORLD_SIZES[size].defGroups, size });
st.started = true;
if (!process.argv.includes("--noauto")) setAutopilot(st, true, "balanced");
const ORDER = ["centre", "city", "suburb", "town", "highway", "rural", "coast", "scenic"];
const WORDS = ["none", "low", "medium", "high", "overrun"];
const CLASSES = ORDER.concat(["other"]);
const b64 = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString("base64");
/** The maps' line: every tile's count, cap and class, the hives. */
function dumpMap() {
  if (!mapFile) return;
  const T = st.tiles, n = new Uint16Array(T.length), cap = new Uint16Array(T.length), cls = new Uint8Array(T.length);
  for (const t of T) {
    if (t.terrain === "water") { cls[t.id] = 255; continue; }
    cap[t.id] = Math.min(65535, popCap(st, t)); n[t.id] = Math.min(65535, tileDead(st, t));
    const k = CLASSES.indexOf(tileClass(st, t));
    cls[t.id] = k < 0 ? CLASSES.length - 1 : k;
  }
  const line = { seed, day: day(st), year: (day(st) - 1) / 365, w: st.grid.width, h: st.grid.height, classes: CLASSES, hives: (st.hives || []).map((h) => h.tile), n: b64(n), cap: b64(cap), cls: b64(cls) };
  if (day(st) === 1) writeFileSync(mapFile, ""); 
  appendFileSync(mapFile, JSON.stringify(line) + "\n");
}
function sample() {
  const by = {};
  let over = 0, ruralOver = 0;
  for (const t of st.tiles) {
    if (t.terrain === "water") continue;
    const cap = popCap(st, t), n = tileDead(st, t), c = tileClass(st, t);
    const e = by[c] || (by[c] = { n: 0, bands: [0, 0, 0, 0, 0], dead: 0, fill: 0 });
    e.n++; e.bands[bandOfCount(n, cap).band]++; e.dead += n; e.fill += cap ? n / cap : 0;
    if (n > cap) { over++; if (c === "rural" || c === "scenic" || c === "coast") ruralOver++; }
  }
  // The cities stay highest: the mean count per class falls from the centre down.
  const mean = (c) => (by[c] ? by[c].dead / by[c].n : 0);
  console.log(`\nDay ${day(st)} (year ${((day(st) - 1) / 365).toFixed(1)}): stored ${Object.keys(st.deadPop || {}).length} tiles, ${over} over their cap (${ruralOver} rural)`);
  console.log(`  class     tiles  mean dead  mean fill  ${WORDS.map((w) => w.padStart(8)).join("")}`);
  for (const c of ORDER) {
    const e = by[c];
    if (!e) continue;
    console.log(`  ${c.padEnd(8)} ${String(e.n).padStart(6)} ${mean(c).toFixed(1).padStart(10)} ${(e.fill / e.n).toFixed(2).padStart(10)}  ${e.bands.map((b) => `${Math.round((b / e.n) * 100)}%`.padStart(8)).join("")}`);
  }
  console.log(`  cities highest: ${mean("centre") > mean("city") || !by.city ? "yes" : "no"} (centre ${mean("centre").toFixed(0)}, city ${mean("city").toFixed(0)}) > suburb ${mean("suburb").toFixed(0)} > town ${mean("town").toFixed(0)} > rural ${mean("rural").toFixed(0)}: ${mean("suburb") > mean("town") && mean("town") > mean("rural") && mean("rural") > mean("scenic") ? "yes" : "no"}`);
}
sample();
dumpMap();
const t0 = Date.now();
let was = day(st);
while (day(st) <= years * 365) {
  if (st.gameOver) st.gameOver = false;
  tickHour(st);
  if (day(st) !== was) {
    was = day(st);
    if ((was - 1) % 365 === 0 || (was - 1) % 91 === 0) sample();
    if ((was - 1) % 365 === 0) dumpMap();
  }
}
console.log(`\n${years} years in ${((Date.now() - t0) / 60000).toFixed(1)} minutes`);
