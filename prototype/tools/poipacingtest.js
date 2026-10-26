// POI pacing (src/sim/grouppois.js, aiscav.js, visitors.js, hardcore-groups.js): how fast the points of interest
// (pois.js) are picked over when the other groups survey and raid them, over [years] years on Normal and Large worlds
// (each world in a process of its own, the default group count of its size; your hub stands but nobody plays it unless
// --autopilot, much slower: the Balanced autopilot; the world goes on after the holdout falls).
// Prints, at the end of every year, the share of POIs in each picked-over band (Rich / Some / Little / Picked clean,
// pois.js poiBand) split by the known zone / the unknown zone (pois.js inKnownZone) and near a base (within NEAR = 5 tiles
// of a living group's base or one of yours: half a group's scavenging range, aiscav.js AISCAV.range) / far, with the pool left against the start, and
// what the groups did (surveys, POIs found, raids, POIs stripped, things of yours taken).
// Checks the targets of docs/prompts/poi-and-nomads.md (Session 4b):
//   - on-road, near-base POIs are mostly picked over by years 2–4: known zone near a base, Little or Picked clean
//     for at least half of them by the end of year 4 (and more of them picked over each year);
//   - unknown-zone and off-road POIs stay richer into the mid-game: at the end of year 4 the unknown zone far from
//     the bases holds more of its pool than the known zone near them, and at least half of it is Rich or Some;
//   - no world has every pool at zero by year 2: at the end of year 2 at least a quarter of the map's POI pool is left
//     and under half of its POIs are picked clean.
// Usage: node tools/poipacingtest.js [years, 4] [seed, 42] [sizes, normal,large] [--years N] [--autopilot]
//   4 years by default (issue #45; it was 6): the checks read years 2 and 4, and since the map sizes of 2026-10-24
//   (Normal 250 × 150, Large 300 × 200) a Large year takes 2 to 3 minutes, so 6 years ran past 15 minutes. Years 5 and
//   up only print: ask for them with --years 6 (or the first argument) for the long report.
//   BS_QUICK=1 in the environment (runtests.js --quick): the same 4 years on a Small world alone, unless the arguments
//   say otherwise: every check on the one world.
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const CHILD = process.argv[2] === "--child";
const AUTO = process.argv.includes("--autopilot");
const argv = process.argv.slice(CHILD ? 3 : 2);
const yi = argv.indexOf("--years"), yearsFlag = yi >= 0 ? argv.splice(yi, 2)[1] : null; // --years N: the same as the first argument
const args = argv.filter((a) => a !== "--autopilot");
if (yearsFlag != null) args.unshift(yearsFlag);
const QUICK = !!process.env.BS_QUICK;
const NEAR = 5; // "near a base": within this many tiles
const years = Number(args[0] || 4);
const seed = Number(args[1] || 42);
const sizes = (args[2] || (QUICK ? "small" : "normal,large")).split(",");

if (CHILD) {
  const { createWorld, tickHour, day } = await import("../src/sim/world.js");
  const { setAutopilot } = await import("../src/sim/autopilot.js");
  const { WORLD_SIZES } = await import("../src/sim/worldsize.js");
  const { poisOf, poiPool, poiBand, inKnownZone, poiFull } = await import("../src/sim/pois.js");
  const size = args[2];
  const st = createWorld({ seed, factionCount: WORLD_SIZES[size].defGroups, size });
  st.started = true;
  if (AUTO) setAutopilot(st, true, "balanced");
  const g = st.grid;
  // The POIs and their start pools (the site of a site tile among them: its tile.loot).
  const list = [];
  for (const t of st.tiles) poisOf(t).forEach((_, i) => list.push({ t, i, known: inKnownZone(st, t), pool0: poiPool(t, i) }));
  const sample = () => {
    const bases = [...st.factions.filter((f) => f.alive).flatMap((f) => f.bases), ...st.bases.map((b) => b.tile)];
    const near = new Uint8Array(st.tiles.length);
    for (const b of bases) for (const id of g.within(b, NEAR)) near[id] = 1;
    const cells = {};
    let pool = 0, pool0 = 0, clean = 0, n = 0;
    for (const x of list) {
      if (!poisOf(x.t)[x.i]) continue; // gone with a hive
      const key = `${x.known ? "known" : "unknown"}-${near[x.t.id] ? "near" : "far"}`;
      const c = cells[key] || (cells[key] = { n: 0, bands: [0, 0, 0, 0], pool: 0, pool0: 0, full: 0 });
      const b = poiBand(x.t, x.i), p = poiPool(x.t, x.i);
      c.n++; c.bands[b]++; c.pool += p; c.pool0 += x.pool0; c.full += poiFull(x.t, x.i);
      pool += p; pool0 += x.pool0; n++; if (b === 3) clean++;
    }
    return { day: day(st), cells, pool, pool0, clean, n, groups: st.factions.filter((f) => f.alive).length, stats: { ...(st.groupPoiStats || {}) }, trips: st.aiScav ? st.aiScav.stats.trips : 0 };
  };
  const out = { size, seed, groups0: st.factions.length, pois: list.length, years: [] };
  let was = day(st);
  const t0 = Date.now();
  while (day(st) <= years * 365) {
    if (st.gameOver) { if (out.fell == null) out.fell = day(st); st.gameOver = false; }
    tickHour(st);
    if (day(st) !== was) {
      for (let y = 1; y <= years; y++) if (y * 365 >= was && y * 365 < day(st)) out.years.push(sample());
      was = day(st);
    }
  }
  out.ms = Date.now() - t0;
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const pct = (v) => `${Math.round(v * 100)}%`;
const me = fileURLToPath(import.meta.url);
const run = (size) => new Promise((res, rej) => execFile(process.execPath, [me, "--child", String(years), String(seed), size, ...(AUTO ? ["--autopilot"] : [])], { maxBuffer: 1 << 26 }, (e, o) => (e ? rej(e) : res(JSON.parse(o)))));
const results = await Promise.all(sizes.map(run));
const KEYS = ["known-near", "known-far", "unknown-near", "unknown-far"];
for (const r of results) {
  console.log(`\n${r.size} world, seed ${r.seed}: ${r.pois} POIs, ${r.groups0} groups at the start${r.fell ? `, the holdout fell on day ${r.fell} (the world went on)` : ""} (${Math.round(r.ms / 1000)} s)`);
  console.log(`  bands: Rich / Some / Little / Picked clean (share of the POIs in each cell); pool: what is left of the cell's start`);
  for (const [y, s] of r.years.entries()) {
    const st = s.stats;
    console.log(`  year ${y + 1} (day ${s.day}, ${s.groups} groups, ${s.trips} trips; ${st.surveys || 0} surveys found ${st.found || 0}, ${st.raids || 0} raids, ${st.stripped || 0} stripped, ${st.leftTaken || 0} of your containers emptied): pool ${pct(s.pool / s.pool0)}, picked clean ${pct(s.clean / s.n)}`);
    for (const k of KEYS) {
      const c = s.cells[k];
      if (!c) continue;
      console.log(`    ${k.padEnd(13)} ${String(c.n).padStart(5)} POIs  ${c.bands.map((b) => pct(b / c.n).padStart(4)).join(" / ")}  pool ${pct(c.pool / Math.max(1e-9, c.pool0))}`);
    }
  }
  const Y = (y) => r.years[y - 1];
  const share = (s, k, bands) => { const c = s && s.cells[k]; return c ? bands.reduce((a, b) => a + c.bands[b], 0) / c.n : 0; };
  const poolOf = (s, k) => { const c = s && s.cells[k]; return c ? c.pool / Math.max(1e-9, c.pool0) : 0; };
  if (r.years.length >= 2) {
    const s2 = Y(2);
    check(s2.pool / s2.pool0 >= 0.25 && s2.clean / s2.n < 0.5, `${r.size}: not every pool at zero by year 2 (${pct(s2.pool / s2.pool0)} of the pool left, ${pct(s2.clean / s2.n)} picked clean)`);
  }
  if (r.years.length >= 4) {
    const s4 = Y(4);
    const kn = share(s4, "known-near", [2, 3]);
    check(kn >= 0.5, `${r.size}: on-road POIs near the bases mostly picked over by year 4 (known zone, near: ${pct(kn)} Little or Picked clean; years 1–4: ${r.years.slice(0, 4).map((s) => pct(share(s, "known-near", [2, 3]))).join(" → ")})`);
    // The near zone is the POIs within reach of the bases of the day, so its set shifts as groups move and fall: a dip of
    // a few points between years is the zone changing, not the POIs filling back up.
    check(r.years.slice(1, 4).every((s, j) => share(s, "known-near", [2, 3]) >= share(r.years[j], "known-near", [2, 3]) - 0.05), `${r.size}: more of them picked over every year (within 5 points: years 1–4 ${r.years.slice(0, 4).map((s) => pct(share(s, "known-near", [2, 3]))).join(" → ")})`);
    const uf = share(s4, "unknown-far", [0, 1]);
    check(poolOf(s4, "unknown-far") > poolOf(s4, "known-near") && uf >= 0.5, `${r.size}: the unknown zone far from the bases stays richer into the mid-game (year 4: ${pct(poolOf(s4, "unknown-far"))} of its pool left against ${pct(poolOf(s4, "known-near"))} near the bases on the roads; ${pct(uf)} Rich or Some)`);
  }
  check(r.years.length && r.years[r.years.length - 1].stats.surveys > 0 && r.years[r.years.length - 1].stats.found > 0, `${r.size}: the groups surveyed and found hidden POIs (${r.years.length ? r.years[r.years.length - 1].stats.surveys : 0} surveys)`);
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
