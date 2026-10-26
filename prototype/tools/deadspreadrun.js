// A headless run of the spread of the dead (src/sim/deadspread.js, issue #66): a Normal world on the autopilot for N
// years (tickHour, so the day's recalculation, the spread, the player's and the groups' kills all run), printing at
// each year the share of land at each band of the dead by land class, the mean count against the cap, and whether the
// cities stay highest and the rural land under its cap. Not a test (it is slow): run it by hand, in the background.
// Issue #76: also the deep countryside (rural, coast and scenic land at least DEEP_DIST hex steps from the nearest
// town, city, suburb, city centre or hive and off a hive's land (hives.js zombieToughness 0), worked out here by its own search so the same tool reads an older build):
// its share at each band, its mean fill (% of cap), and how many sit over 15% of their cap; at each year's end a
// machine-readable line `DEEP {...}` for the tables.
// Usage: node tools/deadspreadrun.js [years=2] [seed=42] [size=normal] [--noauto]
import { createWorld, tickHour, day } from "../src/sim/world.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { WORLD_SIZES } from "../src/sim/worldsize.js";
import { popCap, tileDead, bandOfCount } from "../src/sim/deadpop.js";
import { tileClass } from "../src/sim/placement.js";
import { zombieToughness } from "../src/sim/hives.js";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const years = Number(args[0] || 2), seed = Number(args[1] || 42), size = args[2] || "normal";
const st = createWorld({ seed, factionCount: WORLD_SIZES[size].defGroups, size });
st.started = true;
if (!process.argv.includes("--noauto")) setAutopilot(st, true, "balanced");
const DEEP_DIST = 3, DEEP_CLASSES = ["rural", "coast", "scenic"], SOURCES = ["centre", "city", "suburb", "town"];
const EVEN = [1, 0, 0, -1, -1, -1, -1, 0, -1, 1, 0, 1], ODD = [1, 0, 1, -1, 0, -1, -1, 0, 0, 1, 1, 1];
/** Hex steps from each tile to the nearest source (water counts as a step). */
function sourceDist() {
  const W = st.grid.width, H = st.grid.height, T = st.tiles, dist = new Int32Array(T.length).fill(-1), q = [];
  const hives = new Set((st.hives || []).map((h) => h.tile));
  for (const t of T) if (t.terrain !== "water" && (hives.has(t.id) || SOURCES.includes(tileClass(st, t)))) { dist[t.id] = 0; q.push(t.id); }
  for (let i = 0; i < q.length; i++) {
    const id = q[i], x = id % W, y = (id - x) / W, d = y & 1 ? ODD : EVEN;
    for (let k = 0; k < 12; k += 2) {
      const nx = x + d[k], ny = y + d[k + 1];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (dist[n] < 0) { dist[n] = dist[id] + 1; q.push(n); }
    }
  }
  return dist;
}
const ORDER = ["centre", "city", "suburb", "town", "highway", "rural", "coast", "scenic"];
const WORDS = ["none", "low", "medium", "high", "overrun"];
function sample() {
  const by = {};
  let over = 0, ruralOver = 0;
  const dist = sourceDist(), deep = { n: 0, bands: [0, 0, 0, 0, 0], fill: 0, over15: 0, max: 0 };
  for (const t of st.tiles) {
    if (t.terrain === "water") continue;
    const cap = popCap(st, t), n = tileDead(st, t), c = tileClass(st, t);
    const e = by[c] || (by[c] = { n: 0, bands: [0, 0, 0, 0, 0], dead: 0, fill: 0 });
    e.n++; e.bands[bandOfCount(n, cap).band]++; e.dead += n; e.fill += cap ? n / cap : 0;
    if (DEEP_CLASSES.includes(c) && cap > 0 && (dist[t.id] < 0 || dist[t.id] >= DEEP_DIST) && !zombieToughness(st, t.id)) {
      const f = n / cap;
      deep.n++; deep.bands[bandOfCount(n, cap).band]++; deep.fill += f; deep.max = Math.max(deep.max, f);
      if (f > 0.15) deep.over15++;
    }
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
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  console.log(`  deep countryside (${DEEP_CLASSES.join("/")} ≥ ${DEEP_DIST} steps from a source): ${deep.n} tiles, mean fill ${pct(deep.fill / (deep.n || 1))}, ${deep.over15} over 15% of cap (most ${pct(deep.max)}), bands ${deep.bands.map((b, i) => `${WORDS[i]} ${pct(b / (deep.n || 1))}`).join(" / ")}`);
  if ((day(st) - 1) % 365 === 0) {
    const m = {};
    for (const c of ORDER) if (by[c]) m[c] = +mean(c).toFixed(2);
    console.log(`DEEP ${JSON.stringify({ seed, year: (day(st) - 1) / 365, n: deep.n, fill: +(deep.fill / (deep.n || 1)).toFixed(4), bands: deep.bands.map((b) => +(b / (deep.n || 1)).toFixed(4)), over15: deep.over15, max: +deep.max.toFixed(3), means: m })}`);
  }
  console.log(`  cities highest: ${mean("centre") > mean("city") || !by.city ? "yes" : "no"} (centre ${mean("centre").toFixed(0)}, city ${mean("city").toFixed(0)}) > suburb ${mean("suburb").toFixed(0)} > town ${mean("town").toFixed(0)} > rural ${mean("rural").toFixed(0)}: ${mean("suburb") > mean("town") && mean("town") > mean("rural") && mean("rural") > mean("scenic") ? "yes" : "no"}`);
}
sample();
const t0 = Date.now();
let was = day(st);
while (day(st) <= years * 365) {
  if (st.gameOver) st.gameOver = false;
  tickHour(st);
  if (day(st) !== was) {
    was = day(st);
    if ((was - 1) % 365 === 0 || (was - 1) % 91 === 0) sample();
  }
}
console.log(`\n${years} years in ${((Date.now() - t0) / 60000).toFixed(1)} minutes`);
