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
// - the reach (#76): the limit falls off with the steps from the towns, cities and hives (never rising, steep by about
//   5, then the floor in 10-15%); the deep countryside past it; the limits hold on every tile at every year; the
//   timing (the deep countryside's mean fill climbs to the floor around year 5 and holds: the stand-in below); a year
//   of days under the spread and the daily rules keeps every tile under its limit, one over it sheds, a quiet kill
//   lowers it, a loud night does not lift it past it and loud play still draws from it; the land classes' order
//   (centre > city > suburb > town > rural) at the end of every year 1-6; an older save gains nothing
// - a timing on Huge (500 × 300)
import { createWorld } from "../src/sim/world.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { aiRaidKills, noteNoise, popCap, tileDead, deadNow, openDead, poiDead, putBack, killDead, drawFromTile, deadPopDaily, deadPopSpread } from "../src/sim/deadpop.js";
import { DEADSPREAD, spreadDaily, isDeep, reachLimit, reachShare, floorShare, reachDist } from "../src/sim/deadspread.js";
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

// ---------- the reach and the deep countryside (#76) ----------
const YEAR = 365 * 24;
const R = DEADSPREAD.REACH, F = DEADSPREAD.FLOOR;
const deepOf = (st) => st.tiles.filter((t) => isDeep(st, t));
const offSource = (st) => st.tiles.filter((t) => t.terrain !== "water" && reachShare(st, t) != null);
const meanFill = (st, list) => list.reduce((a, t) => a + tileDead(st, t) / popCap(st, t), 0) / (list.length || 1);
const classMean = (st, c) => { let n = 0, s = 0; for (const t of st.tiles) if (t.terrain !== "water" && tileClass(st, t) === c) { n++; s += tileDead(st, t); } return n ? s / n : 0; };
const ORDER = ["centre", "city", "suburb", "town", "rural"];
const ordered = (st) => { const m = ORDER.map((c) => classMean(st, c)); return { ok: m.every((v, i) => i === 0 || v < m[i - 1]), text: ORDER.map((c, i) => `${c} ${m[i].toFixed(1)}`).join(" > ") }; };
const nearest = (dist, id) => Math.min(...["city", "town", "hive"].map((k) => (dist[k][id] < 0 ? 1e9 : dist[k][id])));

section("The reach falls off with the steps from the towns, cities and hives: high close in, steep by about 5 steps, then the floor");
{
  for (const k of Object.keys(R)) {
    const tab = R[k];
    check(tab.every((v, i) => i === 0 || v <= tab[i - 1]) && tab[0] >= 0.9 && tab[tab.length - 1] <= 0.2 && tab.length <= 5, `${k}: ${tab.map((v) => `${v * 100}%`).join(", ")} by steps 1-${tab.length}, never rising, then nothing (the floor)`);
  }
  const st = W();
  st.hour = 5 * YEAR;
  const dist = reachDist(st), by = [];
  for (const t of offSource(st)) {
    const d = Math.min(nearest(dist, t.id), 9);
    (by[d] || (by[d] = [])).push(reachShare(st, t));
  }
  const mean = (l) => (l && l.length ? l.reduce((x, y) => x + y, 0) / l.length : 0);
  const m = by.map(mean);
  console.log(`  year 5, the mean limit by steps from the nearest source: ${m.map((v, d) => (by[d] ? `${d}: ${(v * 100).toFixed(0)}%` : null)).filter(Boolean).join(", ")}`);
  check(m.every((v, d) => d < 2 || !by[d] || v <= m[d - 1] + 1e-9), "the mean limit never rises with the steps out");
  check(m[1] >= 0.85 && m[2] >= 0.6 && m[5] <= 0.3 && m[6] <= 0.2, `high next to a source (${(m[1] * 100).toFixed(0)}% at 1, ${(m[2] * 100).toFixed(0)}% at 2), dropping steeply by 5-6 (${(m[5] * 100).toFixed(0)}%, ${(m[6] * 100).toFixed(0)}%)`);
  const far = by.slice(7).flat();
  check(far.length > 500 && far.every((v) => Math.abs(v - F.CEIL) < 1e-9) && F.CEIL >= 0.1 && F.CEIL <= 0.15, `7+ steps out every tile is at the floor, ${F.CEIL * 100}% (${far.length} tiles)`);
  const cityFar = R.city.length > R.town.length && R.city.every((v, i) => i >= R.town.length || v >= R.town[i]);
  check(cityFar, "a city's land reaches further and higher than a town");
}

section("The deep countryside: rural, coast and scenic land past every source's reach");
{
  const st = W();
  const dist = reachDist(st), deep = deepOf(st);
  const wrong = deep.filter((t) => !DEADSPREAD.DEEP.includes(tileClass(st, t)) || ["city", "town", "hive"].some((k) => dist[k][t.id] >= 0 && dist[k][t.id] <= R[k].length));
  const onHive = deep.filter((t) => (st.hives || []).some((h) => st.grid.distance(h.tile, t.id) <= 4));
  console.log(`  ${deep.length} deep tiles of ${st.tiles.filter((t) => t.terrain !== "water").length} land`);
  check(deep.length > 1000 && wrong.length === 0, `every deep tile is ${DEADSPREAD.DEEP.join(", ")} and past every reach (${wrong.length} not)`);
  check(onHive.length === 0, `no deep tile on a hive's land (${onHive.length})`);
}

section(`The limits hold: no tile off the sources holds more than its reachLimit at any year; the deep countryside never over 15%`);
{
  const st = W();
  const off = offSource(st), deep = new Set(deepOf(st));
  for (const y of [0, 1, 2, 3, 4, 5, 6, 8]) {
    st.hour = y * YEAR;
    let over = 0, over15 = 0, most = 0;
    for (const t of off) {
      const cap = popCap(st, t), n = tileDead(st, t), lim = reachLimit(st, t, cap);
      if (lim == null || n > lim) over++;
      if (!deep.has(t)) continue;
      if (n > cap * 0.15 || lim > Math.ceil(cap * F.CEIL)) over15++;
      most = Math.max(most, n / cap);
    }
    check(over === 0 && over15 === 0, `year ${y}: ${off.length} tiles at or under their limits (${over} over); the deep countryside ${over15} over 15%, the most ${(most * 100).toFixed(1)}% of its cap`);
  }
  st.hour = 3 * YEAR;
  check(st.tiles.every((t) => deadNow(st, t) === tileDead(st, t)), "deadNow = tileDead on every tile (the POIs held under the limit too)");
}

// The stand-in for the 6-year autopilot run (too slow for a test: hours a seed): the deep countryside nobody has
// touched, read at the end of each year. Calibrated against tools/deadspreadrun.js 6 <seed> normal --maps on seeds
// 42-44 and tools/spreadmaps.js (docs/features/travel.md, the reach's table): there the deep countryside's mean fill,
// stored tiles and all (killed, drawn from, pushed by the spread), sat within about a point of this every year.
section("The timing (stand-in): the deep countryside's mean fill climbs each year to its floor around year 5, then holds");
{
  const st = W();
  const deep = deepOf(st), C = F.CEIL;
  const m = [];
  for (let y = 0; y <= 6; y++) { st.hour = y * YEAR; m.push(meanFill(st, deep)); }
  console.log(`  mean fill at the end of years 0-6: ${m.map((v) => `${(v * 100).toFixed(1)}%`).join(", ")} (the floor ${C * 100}%)`);
  check(m.every((v, i) => i === 0 || v >= m[i - 1] - 1e-9) && m[1] < m[3] && m[3] < m[5], "it climbs steadily, year on year");
  check(m[1] < 0.6 * C && m[3] < 0.9 * C, `well under it in years 1 and 3 (${(m[1] * 100).toFixed(1)}%, ${(m[3] * 100).toFixed(1)}%)`);
  check(m[4] < 0.95 * C && m[5] >= 0.95 * C, `it reaches it between years 4 and 5 (${(m[4] * 100).toFixed(1)}% → ${(m[5] * 100).toFixed(1)}%), not sooner`);
  check(m[5] >= 0.1 && m[5] <= 0.15 && Math.abs(m[6] - m[5]) < 0.005, `and holds in 10-15% (${(m[5] * 100).toFixed(1)}% at year 5, ${(m[6] * 100).toFixed(1)}% at year 6)`);
  st.hour = 5 * YEAR;
  check(Math.abs(floorShare(st) - C) < 1e-12 && Math.abs(floorShare(W()) - C * F.START) < 1e-12, `the ramp: ${F.START * C * 100}% on day 1 to ${C * 100}% at year ${F.YEARS}`);
}

section(`A ${QUICK ? "half " : ""}year of days from year 2 (small map): under the spread and the daily rules no tile goes past its limit`);
{
  const st = W("small");
  st.hour = 2 * YEAR;
  const off = offSource(st), deep = deepOf(st), dist = reachDist(st);
  const lim = (t) => reachLimit(st, t, popCap(st, t));
  // Watched: a deep tile put over its floor (an older save's), a tile 3-4 steps out put over its limit, one killed to
  // nothing quietly, one loud every night.
  const pick = deep.filter((t) => openDead(st, t) > 0 && nbrs(st, t.id).every((n) => land(st, n)));
  const mid = off.find((t) => { const d = nearest(dist, t.id); return d >= 3 && d <= 4 && lim(t) < popCap(st, t) - 10; });
  const [hi, lo, loud] = [pick[0], pick[Math.floor(pick.length / 2)], pick[pick.length - 1]];
  putBack(st, hi, null, 20);
  if (mid) putBack(st, mid, null, popCap(st, mid) - tileDead(st, mid));
  const hi0 = tileDead(st, hi), mid0 = mid ? tileDead(st, mid) : 0;
  killDead(st, lo, null, tileDead(st, lo), { loud: false });
  let rose = false, overLim = 0, loudOver = 0, worst = 0;
  const n = QUICK ? 180 : 365;
  let prev = hi0;
  for (let d = 0; d < n; d++) {
    noteNoise(st, loud, null, 30);
    days(st, 1);
    const h = tileDead(st, hi);
    if (h > prev) rose = true;
    prev = h;
    if (tileDead(st, loud) > lim(loud)) loudOver++;
    if (d % 30 === 29) for (const t of off) if (t !== hi && t !== mid && tileDead(st, t) > lim(t)) { overLim++; worst = Math.max(worst, tileDead(st, t) / popCap(st, t)); }
  }
  check(overLim === 0, `no tile off the sources past its limit at any month's end over ${n} days (${overLim}; the most ${(worst * 100).toFixed(1)}%)`);
  check(!rose && tileDead(st, hi) <= lim(hi), `a deep tile put over its floor (${hi0} of ${popCap(st, hi)}) sheds to it and never rises (${tileDead(st, hi)}, its limit ${lim(hi)})`);
  check(!!mid && tileDead(st, mid) <= lim(mid), `a tile ${mid ? nearest(dist, mid.id) : "?"} steps out filled to its cap (${mid0}) is trimmed to its reach (${mid ? tileDead(st, mid) : "?"}, its limit ${mid ? lim(mid) : "?"})`);
  check(loudOver === 0, `loud nights every day do not lift one past it (${tileDead(st, loud)} of ${lim(loud)})`);
  check(tileDead(st, lo) <= lim(lo), `one killed quietly to nothing regrows no further than it (${tileDead(st, lo)} of ${lim(lo)})`);
  // Loud play's draws (reinforcements, surges) and a quiet kill, on a deep tile with dead on its open ground.
  const open = deep.find((t) => openDead(st, t) > 0);
  check(!!open, "a deep tile with dead on its open ground");
  if (open) {
    noteNoise(st, open, null, 30);
    const before = tileDead(st, open), drawn = drawFromTile(st, open, 1);
    check(drawn === 1 && tileDead(st, open) === before - 1, `loud play still draws from it (${drawn} drawn of ${before})`);
    putBack(st, open, null, drawn);
    killDead(st, open, null, 1, { loud: false });
    check(tileDead(st, open) === before - 1, `a quiet kill there lowers it (${before} → ${tileDead(st, open)})`);
  }
}

section(`The land classes' order (centre > city > suburb > town > rural) at the end of every year 1-6`);
{
  const st = W();
  for (let y = 1; y <= 6; y++) {
    st.hour = y * YEAR;
    const o = ordered(st);
    check(o.ok, `year ${y}, the land nobody touched: ${o.text}`);
  }
  const a = W(QUICK ? "small" : "normal");
  a.hour = 4 * YEAR;
  days(a, QUICK ? 60 : 180);
  const o = ordered(a);
  check(o.ok, `after ${QUICK ? 60 : 180} days of the spread from year 4: ${o.text}`);
}

section("An older save gains nothing, and goes on deterministically");
{
  // Before #76: no reach (every share 1, the floor too). A save made then, its land stored by a few months.
  const off = () => {
    const r = DEADSPREAD.REACH, f = DEADSPREAD.FLOOR.CEIL;
    DEADSPREAD.REACH = { city: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1].concat(Array(500).fill(1)), town: [], hive: [] };
    DEADSPREAD.FLOOR.CEIL = 1 / (DEADSPREAD.FLOOR.START || 1) + 1;
    return () => { DEADSPREAD.REACH = r; DEADSPREAD.FLOOR.CEIL = f; };
  };
  const st = W("small");
  st.hour = 2 * YEAR;
  const on0 = st.tiles.map((t) => (t.terrain === "water" ? 0 : tileDead(st, t)));
  let back = off();
  const off0 = st.tiles.map((t) => (t.terrain === "water" ? 0 : tileDead(st, t)));
  check(st.tiles.every((t) => reachLimit(st, t, popCap(st, t)) == null), "(the stand-in for the old rules has no limits)");
  back();
  const lims = new Set(offSource(st).map((t) => t.id));
  check(st.tiles.every((t) => on0[t.id] <= off0[t.id] && (lims.has(t.id) || on0[t.id] === off0[t.id])), "every tile's default is at or under the old one, and the same on the sources");
  back = off();
  days(st, 90);
  back();
  const saved = serializeState(st);
  const a = deserializeState(saved), b = deserializeState(saved);
  check(JSON.stringify(a.deadPop) === JSON.stringify(st.deadPop), "loading changes no stored count");
  const was = new Map(Object.keys(a.deadPop).map((k) => [+k, tileDead(a, +k)]));
  const unstored = [...lims].filter((id) => !a.deadPop[id]).slice(0, 3000);
  days(a, 1); days(b, 1);
  let gained = 0, stored = 0;
  // A stored tile may still rise by the day's rules, but never past its new limit unless it was there already.
  for (const [id, v] of was) if (lims.has(id)) { stored++; if (tileDead(a, id) > Math.max(v, reachLimit(a, a.tiles[id], popCap(a, id)))) gained++; }
  const still = unstored.filter((id) => !a.deadPop[id]), nowU = still.map((id) => tileDead(a, id));
  back = off();
  const oldU = still.map((id) => tileDead(a, id)); // the old rules' default the same day
  back();
  const gainedU = still.filter((id, i) => nowU[i] > oldU[i]).length;
  check(gained === 0 && gainedU === 0, `its first day: no stored tile gains past its count or its limit (${gained} of ${stored}), no untouched one past the old rules' default (${gainedU} of ${still.length})`);
  days(a, 30); days(b, 30);
  check(JSON.stringify(a.deadPop) === JSON.stringify(b.deadPop), "two loads of it go on the same");
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
