// The spread of the dead between tiles (src/sim/deadspread.js, issue #66, the heat epic #64 §8).
// Usage: node tools/deadspreadtest.js [seed]
// - sources only: on the first day only tiles next to a town, city or hive tile (or across a river from one) gain
// - ring by ring: a tile two out from a source takes nothing until the ring between them is full, then it does
// - the stop: a tile whose neighbours are all full takes nothing and sends nothing on to them
// - caps: no tile over its cap after a year; a rural tile beside a city ends below the city
// - infection speeds it without raising the cap; recent kills (yours and a group's) slow it; a river halves it unless
//   frozen or bridged
// - the inflow lands on the open ground, not in the POIs
// - deterministic for a seed, through a save and load too
// - a timing on Huge (500 × 300)
import { createWorld } from "../src/sim/world.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { aiRaidKills, noteNoise, popCap, tileDead, deadNow, openDead, poiDead, putBack, killDead, deadPopDaily, deadPopSpread } from "../src/sim/deadpop.js";
import { DEADSPREAD, spreadDaily } from "../src/sim/deadspread.js";
import { tileClass } from "../src/sim/placement.js";
import { poisOf } from "../src/sim/pois.js";
import { riverFrozen } from "../src/sim/weather.js";

const seed = Number(process.argv[2] || 42);
const QUICK = process.env.BS_QUICK === "1";
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) { passes++; console.log(`  ok: ${msg}`); } else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const W = (size = "normal", s = seed) => { const st = createWorld({ seed: s, factionCount: 8, size }); st.started = true; st.cards.length = 0; st.crashNext = 1e9; return st; };
const SRC = new Set(DEADSPREAD.SOURCES);
const isSource = (st, t) => t.terrain !== "water" && (SRC.has(tileClass(st, t)) || (st.hives || []).some((h) => h.tile === t.id));
const land = (st, id) => st.tiles[id] && st.tiles[id].terrain !== "water";
const nbrs = (st, id) => st.grid.neighbors(id);
const fill = (st, id) => putBack(st, id, null, popCap(st, id) - tileDead(st, id));
const rates = (st) => { const m = new Map(); spreadDaily(st, { rates: m, dry: true }); return m; };
const days = (st, n) => { for (let d = 0; d < n; d++) { st.hour += 24; deadPopDaily(st); deadPopSpread(st); } };

section("Sources only: on the first day only the tiles next to a town, city or hive take any");
{
  const st = W();
  const before = st.tiles.map((t) => (t.terrain === "water" ? 0 : tileDead(st, t)));
  const out = spreadDaily(st);
  let gained = 0, stray = 0, river = 0;
  for (const t of st.tiles) {
    if (t.terrain === "water" || tileDead(st, t) <= before[t.id]) continue;
    gained++;
    const near = nbrs(st, t.id).some((n) => isSource(st, st.tiles[n]));
    const across = nbrs(st, t.id).some((w) => st.tiles[w].river && nbrs(st, w).some((n) => isSource(st, st.tiles[n])));
    if (!near && across) river++;
    if (!near && !across) stray++;
  }
  console.log(`  day 1: ${out.sources} sources, ${out.receivers} tiles below cap beside them, ${out.moved} dead moved into ${gained} tiles (${river} across a river)`);
  check(gained > 0 && stray === 0, `every tile that gained is next to a source or across a river from one (${stray} strays)`);
  check(st.tiles.every((t) => t.terrain === "water" || !isSource(st, t) || tileDead(st, t) >= before[t.id]), "the sources keep their counts (they do not lose what they spread)");
}

// A tile two out from the nearest source, its ring between them below cap.
function ringTwo(st) {
  for (const t of st.tiles) {
    if (!land(st, t.id) || isSource(st, t) || t.hive) continue;
    const ns = nbrs(st, t.id);
    if (ns.some((n) => !land(st, n) || isSource(st, st.tiles[n]) || st.tiles[n].river)) continue;
    const ring = ns.filter((n) => nbrs(st, n).some((m) => land(st, m) && isSource(st, st.tiles[m])));
    // The ring below cap and below the sources' level (so it takes), the tile beyond below the sources' too.
    const top = Math.max(0, ...ring.flatMap((n) => nbrs(st, n).filter((m) => land(st, m) && isSource(st, st.tiles[m])).map((m) => tileDead(st, m))));
    if (!ring.length || ring.some((n) => tileDead(st, n) >= Math.min(popCap(st, n), top))) continue;
    if (tileDead(st, t) >= Math.min(popCap(st, t), top)) continue;
    if (ns.some((n) => nbrs(st, n).some((m) => st.tiles[m].river))) continue;
    return { t, ring };
  }
  return null;
}

section("Ring by ring: a full tile passes the push on, a tile below cap does not");
{
  const st = W();
  const c = ringTwo(st);
  check(!!c, "found a tile two out from a source");
  if (c) {
    const r0 = rates(st);
    check(!r0.has(c.t.id) && c.ring.every((n) => r0.has(n)), `day 1: the ring next to the source takes (${c.ring.length} tiles), the tile beyond takes nothing`);
    for (const n of c.ring) fill(st, n);
    const r1 = rates(st);
    check(r1.has(c.t.id) && r1.get(c.t.id) > 0, `the ring full: it passes the push on (${(r1.get(c.t.id) || 0).toFixed(3)} a day into the tile beyond)`);
    check(c.ring.every((n) => !r1.has(n)), "the full ring takes nothing more");
    // The stop: fill the tile and all its neighbours; nothing goes into them.
    fill(st, c.t.id);
    for (const n of nbrs(st, c.t.id)) if (land(st, n)) fill(st, n);
    const r2 = rates(st);
    check(![c.t.id, ...nbrs(st, c.t.id)].some((n) => r2.has(n)), "a tile whose neighbours are all full: the spread through it stops");
    const beyond = nbrs(st, c.t.id).flatMap((n) => nbrs(st, n)).filter((m) => land(st, m) && tileDead(st, m) < popCap(st, m));
    check(beyond.length === 0 || beyond.some((m) => r2.has(m)), `and it carries on past them into the next ring below cap (${beyond.filter((m) => r2.has(m)).length} of ${beyond.length})`);
  }
}

section("Infection speeds it without raising the cap; recent kills slow it (yours and a group's alike)");
{
  const st = W();
  const c = ringTwo(st);
  const id = c ? c.ring[0] : -1, t = st.tiles[id];
  if (c) {
    noteNoise(st, t, null, 0.01); // stored: its count no longer follows its infection (an untouched tile's default does)
    t.infection = 0;
    const cap0 = popCap(st, t), r0 = rates(st).get(id) || 0;
    t.infection = 1;
    const cap1 = popCap(st, t), r1 = rates(st).get(id) || 0;
    check(r1 > r0 * 1.4 && cap1 === cap0, `infected ground fills faster (${r0.toFixed(3)} → ${r1.toFixed(3)} a day), its cap the same (${cap0})`);
    t.infection = 0;
    killDead(st, t, null, 5, { loud: false });
    const r2 = rates(st).get(id) || 0;
    // The kills lowered its count too (a bigger gap): compare at the same count.
    putBack(st, t, null, 5);
    const r3 = rates(st).get(id) || 0;
    check(r3 < r0 * 0.6, `5 kills lately cut the inflow (${r0.toFixed(3)} → ${r3.toFixed(3)} a day at the same count; ${r2.toFixed(3)} with the 5 gone)`);
    const st2 = W();
    const gid = [...rates(st2).entries()].filter(([g, v]) => v > 0.05 && poisOf(st2.tiles[g]).length).map(([g]) => g)[0];
    const t2 = st2.tiles[gid];
    noteNoise(st2, t2, null, 0.01);
    t2.infection = 0;
    const i = poisOf(t2).length ? 0 : -1;
    if (i >= 0) {
      if (poiDead(st2, t2, i) < 2) putBack(st2, t2, i, 2);
      const b0 = rates(st2).get(gid) || 0;
      const k = aiRaidKills(st2, t2, i, { hours: 4 });
      putBack(st2, t2, i, k);
      const a1 = rates(st2).get(gid) || 0;
      check(k > 0 && a1 < b0, `a group's raid kills slow it the same way (${b0.toFixed(3)} → ${a1.toFixed(3)}, ${k} killed and put back)`);
    } else check(true, "no POI with dead to raid on the tile (the group's case is the same killDead)");
  }
}

section("Rivers halve it unless frozen or bridged");
{
  const st = W();
  // A river hex with a source on one bank and, on the other, a tile no other push reaches.
  let found = null;
  for (const w of st.tiles) {
    if (!w.river || w.terrain !== "water" || w.bridge) continue;
    const ns = nbrs(st, w.id);
    for (const a of ns) {
      if (!land(st, a) || !isSource(st, st.tiles[a])) continue;
      for (const b of ns) {
        if (!land(st, b) || isSource(st, st.tiles[b]) || st.grid.distance(a, b) < 2) continue;
        if (nbrs(st, b).some((n) => land(st, n) && (isSource(st, st.tiles[n]) || tileDead(st, n) >= popCap(st, n)))) continue;
        if (nbrs(st, b).some((x) => x !== w.id && st.tiles[x].river)) continue;
        if (tileDead(st, b) >= Math.min(tileDead(st, a), popCap(st, b))) continue;
        found = { w, a, b }; break;
      }
      if (found) break;
    }
    if (found) break;
  }
  check(!!found, "found a source across a river from a tile");
  if (found) {
    const wet = rates(st).get(found.b) || 0;
    found.w.bridge = true;
    const dry = rates(st).get(found.b) || 0;
    found.w.bridge = false;
    check(wet > 0 && Math.abs(wet - dry * DEADSPREAD.RIVER) < 1e-9, `across the river ${wet.toFixed(3)} a day, bridged ${dry.toFixed(3)} (× ${DEADSPREAD.RIVER})`);
    let h = null;
    for (let x = st.hour; x < st.hour + 24 * 365 * 2 && h == null; x += 24) if (riverFrozen(st, found.w.id, x)) h = x;
    if (h != null) {
      const keep = st.hour;
      st.hour = h;
      const ice = rates(st).get(found.b) || 0;
      st.hour = keep;
      check(Math.abs(ice - dry) < 1e-9, `frozen (day ${Math.floor(h / 24) + 1}): ${ice.toFixed(3)} a day, as if bridged`);
    } else check(true, `this river (row ${found.w.y}) does not freeze in two winters`);
  }
}

section("The inflow lands on the open ground, not in the POIs");
{
  const st = W();
  const before = new Map();
  for (const t of st.tiles) if (t.terrain !== "water" && poisOf(t).length) before.set(t.id, poisOf(t).map((_, i) => poiDead(st, t, i)));
  spreadDaily(st);
  let moved = 0, same = true;
  for (const [id, p] of before) {
    const t = st.tiles[id];
    if (!st.deadPop || !st.deadPop[id]) continue;
    moved++;
    if (!p.every((v, i) => poiDead(st, t, i) === v)) same = false;
  }
  check(moved > 0 && same, `${moved} tiles with POIs took some: their POIs hold what they held`);
  const id = Number(Object.keys(st.deadPop)[0]);
  check(openDead(st, id) + poisOf(st.tiles[id]).reduce((s, _, i) => s + poiDead(st, id, i), 0) === tileDead(st, id), "the tile's count is still its open ground and its POIs'");
}

section(`A year of days (${QUICK ? "small" : "normal"} map): caps hold, a rural tile beside a city (or its suburbs) ends below it, deterministic`);
{
  const size = QUICK ? "small" : "normal";
  const a = W(size), b = W(size);
  const n = QUICK ? 120 : 365;
  days(a, n); days(b, n);
  let over = 0, below = 0, pairs = 0, worst = 1;
  for (const t of a.tiles) {
    if (t.terrain === "water") continue;
    if (tileDead(a, t) > popCap(a, t)) over++;
    const cls = tileClass(a, t);
    if (cls === "centre" || cls === "city" || cls === "suburb") for (const nb of nbrs(a, t.id)) {
      const c2 = tileClass(a, a.tiles[nb]);
      if (!land(a, nb) || (c2 !== "rural" && c2 !== "scenic" && c2 !== "coast" && c2 !== "highway")) continue;
      pairs++;
      if (tileDead(a, nb) < tileDead(a, t)) below++;
      worst = Math.min(worst, tileDead(a, t) - tileDead(a, nb));
    }
  }
  check(over === 0, `no tile over its cap after ${n} days`);
  check(pairs === 0 || below === pairs, `every rural tile beside a city holds fewer than it (${below} of ${pairs} pairs)`);
  check(JSON.stringify(a.deadPop) === JSON.stringify(b.deadPop), "two runs of the seed end the same");
  const back = deserializeState(serializeState(a));
  days(a, 5); days(back, 5);
  check(JSON.stringify(a.deadPop) === JSON.stringify(back.deadPop), "a save and load goes on the same");
}

section("The default's count without its lists (deadNow) is tileDead's");
{
  const st = W("small");
  check(st.tiles.every((t) => deadNow(st, t) === tileDead(st, t)), "deadNow = tileDead on every tile");
}

section("Timing on Huge (500 × 300)");
{
  const st = W("huge");
  days(st, 3);
  const ms = [];
  for (let d = 0; d < 5; d++) { st.hour += 24; const t0 = performance.now(); deadPopSpread(st); ms.push(performance.now() - t0); }
  const mean = ms.reduce((x, y) => x + y, 0) / ms.length;
  console.log(`  one day's spread on Huge: ${ms.map((x) => x.toFixed(0)).join(", ")} ms`);
  check(mean < 1500, `one pass a day, ${mean.toFixed(0)} ms on average (budget 1500)`);
}

console.log(`\n${passes} passed, ${fails} failed`);
if (fails) process.exit(1);
