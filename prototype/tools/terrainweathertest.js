// The weather on the lie of the land (src/sim/ponds.js; the user's word 2026-10-23: "Update weather effects for the new
// terrain with hollows turning into ponds (after x days of no more rain the water goes away and it turns to mud filled
// hollow and if the water still exists and winter sets in it turns into a frozen pond and hills are harder to climb in
// rain and very hard in winter"):
//   1. the hollows a day at a time (pondStep, cellWet) over a weather sequence made up here: rain fills them (deep in
//      the middle), DRAIN days with no rain and it is mud, MUD more and dry; ice holds the water; a heat wave dries
//      faster; a thaw fills them;
//   2. a tile's hollows from its own weather: your base's, ticked at midnight, the same as one worked out from the
//      weather; the same asked again and after the weather's caches are dropped; the game's dice untouched;
//   3. on a battle map: ponds on a hills tile after rain, deep water no way through, nothing cut off by it (a map a pond
//      would cut in two: waded instead);
//   4. moves and shots: wading, deep wading, mud and ice cost more a step (reachable, distField), a shot from the water
//      is worse; the climb × 1.5 in the rain, × 2.5 in winter (ladders as before); the hover words;
//   5. the base map: nothing built on a pond or on mud, nor a wet hollow filled in, until it is dry (placeProblemAt,
//      siteWaits);
//   6. the same seed, the same ponds.
// Usage: node tools/terrainweathertest.js [seed]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { createBattle, registerCombatHandler, reachable, distField, shotOdds, CELL } from "../src/sim/combat.js";
import * as P from "../src/sim/ponds.js";
import * as W from "../src/sim/weather.js";
import * as BM from "../src/sim/basemap.js";

const SEED = Number(process.argv[2] || 7);
let passes = 0, fails = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); return !!ok; };
const section = (t) => console.log(`\n${t}`);
const t0 = Date.now();
registerCombatHandler("tw", () => {});
const world = (s = SEED) => { const st = createWorld({ seed: s, factionCount: 6 }); st.started = true; st.hour = 24 * 3 + 12; return st; };
const day = (key, o = {}) => ({ key, rain: key === "rain" ? 0.4 : key === "storm" ? 0.8 : 0, snow: key === "snow" ? 0.4 : 0, melt: 0, ice: 0, ...o });
const run = (st, ...ws) => ws.reduce((s, w) => P.pondStep(s, w), st);
const wet = (st, d = 1, inner = 1) => { const w = P.cellWet(st, d, inner); return w ? w.s : "dry"; };

// ---------- 1. a day at a time ----------
section("The hollows a day at a time: rain, drained, mud, dry; ice; heat; a thaw");
{
  const DRY0 = { d: 0, dry: 99, ice: false };
  const N = P.PONDS.DRAIN, M = P.PONDS.MUD, IN = P.PONDS.DEEP_IN;
  let st = run({ ...DRY0, dry: N + M }, day("clear"));
  check(wet(st) === "dry" && wet(st, 1, IN) === "dry", "dry hollows stay dry with no rain");
  st = run(st, day("rain"));
  check(st.dry === 0 && wet(st) === "wade" && wet(st, 1, IN - 1) === "wade" && wet(st, 1, IN) === "deep" && wet(st, 2) === "deep", `a day's rain fills them: a pond waded at its edge, deep ${IN} cells in from its rim (and wherever the ground is dug deeper)`);
  check(P.cellWet(st, 1).wl === P.PONDS.WATER - 1 && P.cellWet(st, 1, IN).wl === P.PONDS.WATER - 1 && P.cellWet(st, 2).wl === P.PONDS.WATER - 1, `the water stands level across the pond (${P.PONDS.WATER - 1} levels)`);
  const seq = [];
  for (let i = 1; i <= N + M + 1; i++) { st = run(st, day(i % 2 ? "clear" : "overcast")); seq.push(`${wet(st)}/${wet(st, 1, IN)}`); }
  const at = (n) => seq[n - 1];
  check(at(N - 1) === "wade/deep" && at(N) === "mud/mud", `after ${N} days with no rain the water is gone, edge and middle alike: mud`);
  check(at(N + M - 1) === "mud/mud" && at(N + M) === "dry/dry", `the mud dries ${M} days later (dry after ${N + M}): ${seq.join(" ")}`);
  // Rain again any time: full again.
  check(wet(run({ d: 0, dry: N + 1, ice: false }, day("storm"))) === "wade", "a storm fills mud hollows again");
  // A drizzle or snow falling: nothing dries.
  check(run({ d: 0, dry: 2, ice: false }, day("rain", { rain: 0.1 })).dry === 2 && run({ d: 0, dry: 2, ice: false }, day("snow")).dry === 2, "a light shower does not fill them, nor does it or falling snow dry them");
  // A heat wave or a dry spell dries HOT days a day.
  check(run({ d: 0, dry: 0, ice: false }, day("heat")).dry === P.PONDS.HOT && run({ d: 0, dry: 0, ice: false }, day("drought")).dry === P.PONDS.HOT, `a heat wave or a dry spell dries ${P.PONDS.HOT} days' worth`);
  // Freezing: a pond is ice and keeps its water; a thaw: water again, then it drains as before.
  let f = run({ d: 0, dry: 0, ice: false }, day("frost", { ice: P.PONDS.FREEZE }));
  check(f.ice && wet(f) === "ice" && wet(f, 1, IN) === "ice", `a freezing index of ${P.PONDS.FREEZE} turns the ponds to ice, middle and all (walked on)`);
  for (let i = 0; i < 20; i++) f = run(f, day("clear", { ice: 10 }));
  check(f.ice && f.dry === 0 && wet(f) === "ice", "20 frozen days on: still ice (nothing drains under it)");
  f = run(f, day("clear", { ice: 1 }));
  check(!f.ice && wet(f) === "wade", "the thaw: a pond again");
  const fm = run({ d: 0, dry: N, ice: false }, day("frost", { ice: 5 }));
  check(wet(fm) === "dry" && fm.dry === N, "frozen mud is hard ground (and it does not dry while frozen)");
  check(run({ d: 0, dry: 50, ice: false }, day("clear", { melt: 0.2 })).dry === 0, "snow melting off fills them as rain does");
  check(P.cellWet({ dry: N, ice: false }, 3).s === "mud" && P.cellWet({ dry: N, ice: false }, 3).wl === -3, "ground dug deeper holds mud at its own depth");
}

// ---------- 2. a tile's hollows from its weather ----------
section("A tile's hollows from its own weather: your base's ticked at midnight, the same as worked out");
const st = world();
const h = hub(st);
{
  delete h.ponds;
  const bare = { ...st, bases: [] }; // the same weather, no base of yours: worked out from it
  let same = 0, n = 0, kinds = new Set(), froze = 0, rng = st.rng.state;
  for (let d = 3; d <= 150; d++) {
    st.hour = d * 24;
    P.pondsDaily(st);
    const a = h.ponds, b = P.pondsOn(bare, h.tile, d);
    n++;
    if (a.d === d && a.dry === b.dry && a.ice === b.ice) same++;
    kinds.add(P.cellWet(a, 1, P.PONDS.DEEP_IN) ? P.cellWet(a, 1, P.PONDS.DEEP_IN).s : "dry");
    if (a.ice) froze++;
  }
  check(same === n, `your base's hollows ticked day by day are the ones its weather gives (${same}/${n} days)`);
  check(kinds.has("deep") && kinds.has("mud") && kinds.has("dry") && kinds.has("ice") && froze > 5, `over 150 days a pond's middle was ${[...kinds].join(", ")} (${froze} days of ice: winter)`);
  check(st.rng.state === rng, "the game's dice untouched");
  const D = 140, a = JSON.stringify(P.pondsOn(bare, 33, D));
  W.dropWeatherCaches();
  check(JSON.stringify(P.pondsOn(bare, 33, D)) === a && JSON.stringify(P.pondsOn(bare, 33, D)) === a, "the same asked again and after the weather's caches are dropped");
  // The base's record steps on from where it is: a day after its last tick it is the weather's.
  const rec = { ...h.ponds };
  check(JSON.stringify(P.pondsOn(st, h.tile, rec.d + 3)) === JSON.stringify(P.pondsOn(bare, h.tile, rec.d + 3)), "asked a few days past its last tick: stepped on from it, the same");
}

// ---------- 3. on a battle map ----------
section("On a battle map: ponds after rain, deep water no way through, nothing cut off");
const people = atBase(st, h.id).slice(0, 2).map((s) => s.id);
const fight = (s, tile) => createBattle(s, { tile, baseId: hub(s).id, fighterIds: people, enemy: { kind: "zombies", count: 2, power: 3, name: "T" }, ambush: null, canRetreat: false, handler: "tw", context: {} });
// 4-way components of walkable ground: does any part of a's walked ground fall apart in b?
const comps = (cells, w, h2) => { const lab = new Int32Array(w * h2).fill(-1); let n = 0; for (let s = 0; s < w * h2; s++) { if (lab[s] >= 0 || !CELL[cells[s].k].walk) continue; const q = [s]; lab[s] = n; while (q.length) { const i = q.pop(), x = i % w; for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < w * h2 && lab[j] < 0 && CELL[cells[j].k].walk) { lab[j] = n; q.push(j); } } n++; } return lab; };
const cutOff = (before, after, w, h2) => { const a = comps(before, w, h2), b = comps(after, w, h2), to = new Map(); for (let i = 0; i < w * h2; i++) { if (a[i] < 0 || b[i] < 0) continue; const m = to.get(a[i]); if (m == null) to.set(a[i], b[i]); else if (m !== b[i]) return true; } return false; };
let wetTile = null, wetDay = null, deepSeen = 0, maps = 0, cut = 0;
{
  const hilly = st.tiles.filter((t) => t.terrain === "hills" || t.terrain === "mountain").slice(0, 40);
  // A rainy day for the first hilly tile with hollows.
  for (let d = 40; d < 75 && !wetTile; d++) {
    st.hour = d * 24 + 12;
    for (const t of hilly) {
      const w = W.weatherOnDay(st, d + 1, t.id);
      if (w.key !== "rain" && w.key !== "storm") continue;
      // an hour of that day it rains on the tile (the rain comes in belts that pass: weather.js WAVE)
      const hr = Array.from({ length: 24 }, (_, k) => d * 24 + k).find((x) => /rain|storm/.test(W.skyAt(st, t.id, x)));
      if (hr == null) continue;
      st.hour = hr;
      const b = fight(st, t.id);
      if (!b.cells.some((c) => c.wet === "deep")) continue;
      wetTile = t.id; wetDay = d;
      maps++;
      const kinds = {};
      for (const c of b.cells) if (c.wet) kinds[c.wet + (c.k === "water" ? " (no way through)" : "")] = (kinds[c.wet + (c.k === "water" ? " (no way through)" : "")] || 0) + 1;
      check(b.cells.every((c) => !c.wet || (c.ter && c.h < 0)) && b.cells.filter((c) => c.ter && c.h < 0).every((c) => c.wet === "wade" || c.wet === "deep"), `a rainy day on tile ${t.id} (day ${d + 1}): every hollow cell a pond, nothing else wet: ${JSON.stringify(kinds)}`);
      deepSeen = b.cells.filter((c) => c.k === "water" && c.wet === "deep").length;
      const dry = b.cells.map((c) => (c.k === "water" && c.wet ? { ...c, k: "open" } : c));
      if (cutOff(dry, b.cells, b.w, b.h)) cut++;
      check(b.cells.every((c, i) => !(c.k === "water" && c.wet) || !b.reach[i]) && b.climbX === P.CLIMB.rain && /rain|storm/.test(b.climbWhy), `deep water is no way through (${deepSeen} cells, out of the reach), the slopes × ${b.climbX} (${b.climbWhy})`);
      break;
    }
  }
  check(!!wetTile, "found a hills or mountain tile with hollows on a rainy day");
  // More maps (open fights and raids, rainy days on): no pond ever cuts any of the walked ground off.
  let deepMaps = 0;
  const holl = [];
  for (const t of hilly) { if (holl.length >= 6) break; if (fight(st, t.id).cells.some((c) => c.ter && c.h < 0)) holl.push(t); }
  for (let d = wetDay; d < wetDay + 60 && maps < 16; d++) {
    st.hour = d * 24 + 12;
    for (const t of holl) {
      if (!P.cellWet(P.pondsOn(st, t.id, d), 1) || maps >= 16 || (d + t.id) % 3) continue; // a wet day, now and then
      const b = maps % 2 ? createBattle(st, { mode: "raid", tile: t.id, baseId: h.id, fighterIds: people, canRetreat: true, ambush: null, handler: "tw", enemy: { kind: "zombies", count: 2, power: 3 }, raid: { heat0: 0 }, context: {} }) : fight(st, t.id);
      if (!b.cells.some((c) => c.wet)) continue;
      maps++;
      if (b.cells.some((c) => c.k === "water" && c.wet)) deepMaps++;
      const dry = b.cells.map((c) => (c.k === "water" && c.wet ? { ...c, k: "open" } : c));
      if (cutOff(dry, b.cells, b.w, b.h)) cut++;
    }
  }
  check(!cut && maps >= 8, `nothing cut off by deep water on ${maps} maps with ponds (${deepMaps} with deep water no way through)`);
  // A map a pond would cut in two: a corridor across the map with ground dug two down across it (deep): waded instead.
  const b = fight(st, h.tile);
  for (const c of b.cells) { c.k = "wall"; delete c.ter; delete c.h; delete c.wet; }
  const cell = (x, y) => b.cells[y * b.w + x];
  for (let x = 0; x < b.w; x++) for (const y of [5, 6]) { cell(x, y).k = "open"; }
  for (let x = 10; x < 14; x++) for (const y of [5, 6]) Object.assign(cell(x, y), { ter: 1, h: x === 10 || x === 13 ? -1 : -2 });
  for (let x = 16; x < 24; x++) for (let y = 8; y < 16; y++) Object.assign(cell(x, y), { k: "open", ter: 1, h: -1 }); // a pond off to the side, 8 across: its middle deep
  cell(17, 7).k = "open"; // joined to the corridor
  b.reach = new Uint8Array(b.w * b.h).fill(1);
  st.hour = wetDay * 24 + 12;
  P.pondsBattle(st, b, wetTile);
  check(cell(11, 5).wet === "deep" && cell(11, 5).k === "open" && CELL[cell(11, 5).k].walk, "a pond across the only way: its deep middle waded, not cut");
  check(cell(19, 11).wet === "deep" && cell(19, 11).k === "water" && cell(16, 11).wet === "wade" && cell(18, 9).wet === "wade", "a pond off the way: its deep middle no way through, its shallows waded");
}

// ---------- 4. moves and shots ----------
section("Moves and shots: wading, mud, ice; the climb in the rain and in winter");
{
  const b = fight(st, h.tile);
  for (const c of b.cells) { c.k = "open"; delete c.h; delete c.t; delete c.hp; delete c.mhp; delete c.ter; delete c.wet; delete c.wl; }
  b.reach.fill(1); b.losCache.fill(0); b.fires = []; b.smoke = []; b.flares = []; b.soft = undefined; delete b.climbX;
  const u = b.units.find((x) => x.side === "player"), z = b.units.find((x) => x.side === "enemy");
  const others = b.units.filter((x) => x !== u && x !== z);
  others.forEach((o, i) => { o.x = 0; o.y = b.h - 1 - i; });
  u.x = 5; u.y = 10; z.x = 15; z.y = 3;
  const cell = (x, y) => b.cells[y * b.w + x];
  const cost = (who, x, y) => reachable(b, who, 20).dist[y * b.w + x];
  const field = (x, y) => { b._fields = null; return distField(b, [[u.x, u.y]], u)[y * b.w + x]; }; // a new field each time (its cache keys on the cells kinds and heights; the water does not change in a fight)
  check(cost(u, 6, 10) === 1, "a step on dry ground: 1");
  for (const [k, n] of [["wade", 2], ["deep", 3], ["mud", 1.5], ["ice", 1.25]]) {
    cell(6, 10).wet = k;
    check(Math.abs(cost(u, 6, 10) - n) < 1e-6 && Math.abs(field(6, 10) - n) < 1e-6, `a step into ${k === "wade" ? "a pond" : k === "deep" ? "deep water waded" : k}: ${n} (the AI's distances too)`);
  }
  cell(6, 10).wet = "wade";
  u.aware = true; z.aware = true;
  const dry = shotOdds(b, u, z, 5, 10, { parts: true }), wetS = (() => { u.x = 6; const o = shotOdds(b, u, z, 6, 10, { parts: true }); u.x = 5; return o; })();
  const part = (o) => (o.parts || []).find(([l]) => /water/.test(l));
  check(!part(dry) && part(wetS) && part(wetS)[1] === -P.PONDS.SHOOT_WADE, `a shot from the water: ${part(wetS) ? part(wetS)[1] : "none"} aim`);
  delete cell(6, 10).wet;
  // The climb: up a level of the ground, as before, × the weather; a ladder's as before.
  Object.assign(cell(6, 10), { ter: 1, h: 1 });
  const base1 = cost(u, 6, 10), zb = cost(z, 16, 3);
  check(base1 === 2, "a level up a hill on a clear day: 1 + 1");
  b.climbX = P.CLIMB.rain;
  check(cost(u, 6, 10) === 1 + P.CLIMB.rain, `in the rain: 1 + ${P.CLIMB.rain}`);
  b.climbX = P.CLIMB.winter;
  check(cost(u, 6, 10) === 1 + P.CLIMB.winter, `in winter: 1 + ${P.CLIMB.winter}`);
  Object.assign(cell(16, 3), { ter: 1, h: -1 });
  check(cost(z, 16, 3) === 1 + 2 * P.CLIMB.winter && zb === 1, `the dead climb down into a hollow in winter: 1 + 2 × ${P.CLIMB.winter}`);
  Object.assign(cell(5, 11), { k: "ladder" }); Object.assign(cell(5, 12), { k: "walkway" });
  check(cost(u, 5, 12) === 3, "a ladder up to a walkway: as before (the weather is the ground's)");
  check(/× 2.5|×2.5/.test(P.climbWord(b)) && /winter/.test(P.climbWord(b)) && !P.climbWord({}), `the hover: "${P.climbWord(b)}"`);
  check(["wade", "deep", "mud", "ice"].every((k) => P.wetWord({ k: "open", wet: k }).length > 20) && /No way through/.test(P.wetWord({ k: "water", wet: "deep" })), "the hover words for a pond, deep water, mud, ice");
  // The weather's own multiplier, from the tile's weather.
  let found = { rain: null, winter: null, clear: null };
  for (let d = 3; d < 150 && (!found.rain || !found.winter || !found.clear); d++) {
    const hr = d * 24 + 12, w = W.weatherAt(st, h.tile, hr), s = W.season(st, hr).key, c = P.climbWx(st, h.tile, hr);
    if (s === "winter" && !found.winter) found.winter = c.x;
    else if (s !== "winter" && (w.key === "rain" || w.key === "storm") && !(w.snowCover >= 0.25) && !found.rain) found.rain = c.x;
    else if (s !== "winter" && (w.key === "clear") && !(w.snowCover >= 0.25) && !found.clear) found.clear = c.x;
  }
  check(found.rain === 1.5 && found.winter === 2.5 && found.clear === 1, `climbWx from the tile's weather: rain ×${found.rain}, winter ×${found.winter}, a clear day ×${found.clear}`);
}

// ---------- 5. the base map ----------
section("The base map: nothing built on a pond or on mud, nor a wet hollow filled in, until it dries");
{
  const s2 = world(SEED + 1), b = hub(s2);
  const land = BM.landFor(s2, b);
  const dip = land ? [...new Set(land.pieces.values())].filter((p) => p.k === "dip" && p.h === -1 && p.cells.every(([x, y]) => Math.max(Math.abs(x), Math.abs(y)) > BM.ringHalf(b) + 3)).sort((p, q) => Math.hypot(...p.cells[0]) - Math.hypot(...q.cells[0]))[0] : null; // the hollow nearest the base outside its wall's ring (well off the map's no-build edge)
  if (check(!!dip, `the hub's land has a hollow (${land ? [...land.heights.values()].filter((v) => v < 0).length : 0} cells down)`)) {
    const [x, y] = dip.cells[0], D = W.dayIndex(s2);
    const probe = { kind: "prop", w: 1, h: 1 };
    b.ponds = { d: D, dry: 0, ice: false };
    const pond = BM.placeProblemAt(b, probe, x, y, 0, BM.occupancy(s2, b));
    b.ponds = { d: D, dry: P.PONDS.DRAIN, ice: false };
    const mud = BM.placeProblemAt(b, probe, x, y, 0, BM.occupancy(s2, b));
    b.ponds = { d: D, dry: 0, ice: true };
    const ice = BM.placeProblemAt(b, probe, x, y, 0, BM.occupancy(s2, b));
    b.ponds = { d: D, dry: 50, ice: false };
    const dryW = BM.placeProblemAt(b, probe, x, y, 0, BM.occupancy(s2, b));
    check(/pond in the hollow/.test(pond) && /dries out/.test(pond) && !pond.startsWith(BM.LAND_WHY), `a pond: "${pond}"`);
    check(/Mud in the hollow/.test(mud) && /\d day/.test(mud), `mud: "${mud}"`);
    check(/frozen pond/.test(ice), `ice: "${ice}"`);
    check(dryW === "", `dry: the hollow's floor is ground to build on as it is (the user's request 2026-10-23: "${dryW}")`);
    // Filling it in waits while it is wet.
    const job = BM.queueClear(s2, b, [dip]);
    b.ponds = { d: D, dry: 0, ice: false };
    const waits = BM.siteWaits(s2, b, job);
    b.ponds = { d: D, dry: 50, ice: false };
    check(job && waits && !BM.siteWaits(s2, b, job), "filling the hollow in waits while it is a pond, goes on once it is dry");
    // The view: the base's own hollows wet on its map.
    b.ponds = { d: D, dry: 0, ice: false };
    const err = BM.openBaseMap(s2, b.id);
    const v = s2.combat;
    check(!err && v && v.cells.some((c) => c.wet), `the base map's view shows its ponds (${v ? v.cells.filter((c) => c.wet).length : 0} cells)`);
    s2.combat = null;
  }
}

// ---------- 6. determinism ----------
section("The same seed, the same ponds");
{
  const a = world(), b = world();
  a.hour = b.hour = wetDay * 24 + 12;
  const ra = a.rng.state;
  const ma = fight(a, wetTile), mb = fight(b, wetTile);
  const sig = (m) => m.cells.map((c) => `${c.k}${c.wet || ""}${c.wl ?? ""}`).join("|");
  check(sig(ma) === sig(mb) && ma.cells.some((c) => c.wet), "two worlds of one seed: the same map, the same ponds");
  // The ponds draw no dice: the map with and without them is made from the same dice.
  a.rng.state = ra;
  const keep = P.PONDS.FILL;
  P.PONDS.FILL = 99; // no rain fills anything
  const dryMap = fight(a, wetTile);
  P.PONDS.FILL = keep;
  const after = a.rng.state;
  a.rng.state = ra;
  fight(a, wetTile);
  check(after === a.rng.state && dryMap.cells.every((c, i) => c.ter === ma.cells[i].ter && c.h === ma.cells[i].h), "the ponds draw none of the game's dice: the same map under them");
}

console.log(`\n${passes} passed, ${fails} failed (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(fails ? 1 : 0);
