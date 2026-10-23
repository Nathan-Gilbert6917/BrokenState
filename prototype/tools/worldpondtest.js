// Ponds on the State Map and on a pond tile's maps (the user's words 2026-10-23: "add pond decor to the world map when a
// tile has a pond in the world map generate a pond in the battle map"; sim/mapgen.js tile.pond, basescatter.js SPRING,
// relief.js SPRING_FIGHT, ponds.js springSt):
//   1. pond tiles are laid by the world's seed (hash dice: the map's own dice untouched), the same every time, only on
//      open land (farmland, countryside, forest, hills; never water, a river, a mountain, a city, the suburbs, a town's
//      site), about one open tile in twenty;
//   2. a save from before ponds loads, and gets the same ponds from its seed (none under a base of yours); a newer save
//      keeps its own;
//   3. a pond tile's base map and its fights always have a hollow at least HIGH.DIP_MIN across fed by a spring: water on
//      a dry day (wading at its edge, deep in its middle), ice in winter; nothing built on it, never filled in nor dug;
//      the wading and the aim as any pond's; the State Map's tooltip says so;
//   4. a tile with no pond is as it was: its land, its relief and a fight's heights hash as before ponds (GOLDEN: worked
//      out on dev 7f62448, before them);
//   5. every way in stays open: the spring's deep water cuts nothing off (tools/mapreachtest.js's rule), and every unit
//      on a pond tile's fight is on ground walked to.
// Usage: node tools/worldpondtest.js [seed]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { generateMap, pondLand, pondDice, WORLD_PONDS } from "../src/sim/mapgen.js";
import { sizeDef } from "../src/sim/worldsize.js";
import { Rng } from "../src/sim/rng.js";
import { createBattle, registerCombatHandler, CELL } from "../src/sim/combat.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import * as BM from "../src/sim/basemap.js";
import * as BS from "../src/sim/basescatter.js";
import * as RL from "../src/sim/relief.js";
import * as P from "../src/sim/ponds.js";
import * as WX from "../src/sim/weather.js";
import { dirtProblem } from "../src/sim/terraform.js";

const SEED = Number(process.argv[2] || 7);
let passes = 0, fails = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); return !!ok; };
const section = (t) => console.log(`\n${t} [${((Date.now() - t0) / 1000).toFixed(1)} s]`);
const t0 = Date.now();
registerCombatHandler("wpt", () => {});
const world = (s = SEED) => { const st = createWorld({ seed: s, factionCount: 6 }); st.started = true; st.hour = 24 * 3 + 12; return st; };
const pondIds = (st) => st.tiles.filter((t) => t.pond).map((t) => t.id);
// A summer day the ponds are open and a winter day they are ice (the freezing index past FREEZE).
function days(st) {
  let summer = null, winter = null;
  for (let d = 1; d < 400 && (summer == null || winter == null); d++) {
    const s = WX.season(st, d * 24 + 12).key;
    if (summer == null && s === "summer" && !P.pondIce(st, d)) summer = d;
    if (winter == null && s === "winter" && P.pondIce(st, d)) winter = d;
  }
  return { summer, winter };
}
// A hollow's extent (cells joined four ways) through the cells with c(x, y) true: { w, h, n } of the biggest.
function biggest(W, H, at) {
  const seen = new Uint8Array(W * H);
  let best = { w: 0, h: 0, n: 0 };
  for (let s = 0; s < W * H; s++) {
    if (seen[s] || !at(s % W, (s / W) | 0)) continue;
    const q = [s];
    seen[s] = 1;
    let x0 = W, x1 = 0, y0 = H, y1 = 0;
    for (let k = 0; k < q.length; k++) {
      const i = q[k], x = i % W, y = (i / W) | 0;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, j = ny * W + nx; if (nx >= 0 && ny >= 0 && nx < W && ny < H && !seen[j] && at(nx, ny)) { seen[j] = 1; q.push(j); } }
    }
    if (q.length > best.n) best = { w: x1 - x0 + 1, h: y1 - y0 + 1, n: q.length };
  }
  return best;
}
const springOf = (b) => biggest(b.w, b.h, (x, y) => { const c = b.cells[y * b.w + x]; return !!c.spring && c.ter && c.h < 0; });
// The walkable cells (4-way) reached from a walkable cell on the map's edge, with water as it is and with the spring's
// deep water as wading ground: the pond cuts nothing off when the second reaches no more than the first plus the pond.
function cutOff(b) {
  const walk = (c, wade) => (c.k === "water" && wade && c.spring) || (CELL[c.k] && CELL[c.k].walk);
  const reach = (wade) => {
    const W = b.w, H = b.h, seen = new Uint8Array(W * H), q = [];
    for (let i = 0; i < W * H; i++) { const x = i % W, y = (i / W) | 0; if ((x === 0 || y === 0 || x === W - 1 || y === H - 1) && walk(b.cells[i], wade)) { seen[i] = 1; q.push(i); } }
    for (let k = 0; k < q.length; k++) { const i = q[k], x = i % W; for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (j >= 0 && j < W * H && !seen[j] && walk(b.cells[j], wade)) { seen[j] = 1; q.push(j); } }
    return seen;
  };
  const a = reach(false), w = reach(true);
  let lost = 0;
  for (let i = 0; i < a.length; i++) if (w[i] && !a[i] && b.cells[i].k !== "water") lost++;
  return lost;
}
const fight = (st, tile, h) => createBattle(st, { tile, baseId: h.id, fighterIds: atBase(st, h.id).filter((s) => s.alive).slice(0, 3).map((s) => s.id), enemy: { kind: "zombies", count: 3, power: 3, name: "T" }, ambush: null, canRetreat: true, handler: "wpt", context: {} });
const raid = (st, tile, h) => createBattle(st, { mode: "raid", tile, baseId: h.id, fighterIds: atBase(st, h.id).filter((s) => s.alive).slice(0, 3).map((s) => s.id), canRetreat: true, ambush: null, handler: "wpt", enemy: { kind: "zombies", count: 2, power: 3 }, raid: { heat0: 0 }, context: {} });

// ---------- 1. pond tiles ----------
section("Pond tiles: by the world's seed, the same every time, on open land only");
const st = world();
{
  const ids = pondIds(st), again = pondIds(world());
  check(ids.length && JSON.stringify(ids) === JSON.stringify(again), `the same seed, the same ${ids.length} pond tiles`);
  check(JSON.stringify(ids) !== JSON.stringify(pondIds(world(SEED + 1))), "another seed, other ponds");
  const bad = st.tiles.filter((t) => t.pond && (!pondLand(t) || t.river || ["water", "mountain", "city", "suburb"].includes(t.terrain) || (t.loc && t.loc.zone !== "rural")));
  check(!bad.length, `only on farmland, countryside, forest and hills, off rivers and towns (${bad.length} elsewhere)`);
  const by = {};
  for (const t of st.tiles.filter((x) => x.pond)) by[t.terrain] = (by[t.terrain] || 0) + 1;
  check(Object.keys(by).every((k) => WORLD_PONDS.P[k] > 0), `terrains: ${JSON.stringify(by)}`);
  check(st.tiles.every((t) => !!t.pond === pondDice(st.seed, t)), "every tile as the dice say (pondDice: the seed and the tile)");
  const open = st.tiles.filter(pondLand).length, share = ids.length / open;
  check(share > 0.03 && share < 0.08, `about one open tile in twenty: ${ids.length} of ${open} (${(100 * share).toFixed(1)}%)`);
  // The map made twice from the same dice: the same ponds, the dice left where they were (the ponds draw none).
  const def = sizeDef("normal"), r1 = new Rng(SEED), r2 = new Rng(SEED);
  const m1 = generateMap(r1, def, { seed: SEED }), m2 = generateMap(r2, def, { seed: SEED });
  check(r1.state === r2.state && JSON.stringify(m1.tiles) === JSON.stringify(m2.tiles) && JSON.stringify(m1.tiles.filter((t) => t.pond).map((t) => t.id)) === JSON.stringify(ids), "generateMap: the same map and ponds from the same dice");
  check(!!st.worldPonds, "a new world is marked as having its ponds (state.worldPonds)");
}

// ---------- 2. old saves ----------
section("A save from before ponds loads, its ponds from its seed");
{
  const s0 = world(), base = hub(s0), want = pondIds(s0);
  const old = JSON.parse(saveToString(s0));
  // Before ponds: no tile.pond, no state.worldPonds (the encoded graph's own records).
  const strip = (o) => { if (!o || typeof o !== "object") return; if (Array.isArray(o)) { for (const v of o) strip(v); return; } delete o.pond; delete o.worldPonds; for (const v of Object.values(o)) strip(v); };
  strip(old.state);
  const txt = JSON.stringify(old);
  check(!/"pond"|worldPonds/.test(txt), "the old save carries no ponds");
  let s1 = null, err = "";
  try { s1 = loadFromString(txt); } catch (e) { err = String(e && e.message || e); }
  if (check(!!s1, `it loads${err ? `: ${err}` : ""}`)) {
    const got = pondIds(s1), mine = new Set(s1.bases.map((b) => b.tile));
    check(JSON.stringify(got) === JSON.stringify(want.filter((id) => !mine.has(id))), `its ponds from its seed: ${got.length} (the same as a new world on that seed, less those under a base of yours)`);
    check(s1.worldPonds === 1, "marked, so it is done once");
    // A base of yours on a pond tile in an old save: no pond opens under it.
    s0.tiles[base.tile].pond = true;
    const o2 = JSON.parse(saveToString(s0));
    strip(o2.state);
    const s2 = loadFromString(JSON.stringify(o2));
    check(!s2.tiles[base.tile].pond, "no pond opens under a base already standing in an old save");
    delete s0.tiles[base.tile].pond;
  }
  const s3 = loadFromString(saveToString(s0));
  check(JSON.stringify(pondIds(s3)) === JSON.stringify(want), "a save made with ponds keeps them as they were");
}

// ---------- 3. a pond tile's maps ----------
section("A pond tile's base map: a spring-fed hollow, water whatever the rain, ice in winter");
{
  const D = days(st);
  check(D.summer != null && D.winter != null, `a summer day (${D.summer}) and a frozen winter one (${D.winter})`);
  for (const s of [SEED, SEED + 1, SEED + 2]) {
    const w = world(s), h = hub(w);
    w.tiles[h.tile].pond = true; // the hub's tile a pond tile (its yard, its clearing)
    const land = BM.landFor(w, h);
    const sp = [...land.springs].map((k) => k.split(",").map(Number));
    const ext = (a) => Math.max(...a) - Math.min(...a) + 1;
    check(sp.length && ext(sp.map((c) => c[0])) >= BS.HIGH.DIP_MIN && ext(sp.map((c) => c[1])) >= BS.HIGH.DIP_MIN && sp.every(([x, y]) => land.heights.get(`${x},${y}`) === -1), `seed ${s}: the spring's hollow ${sp.length} cells, ${ext(sp.map((c) => c[0]))} × ${ext(sp.map((c) => c[1]))} across, a level down`);
    check(sp.every(([x, y]) => Math.max(Math.abs(x), Math.abs(y)) >= BS.CLEARING.hub + 1), "clear of the base's core and clearing");
    // A dry spell: the rain's hollows dry, the spring's pond full.
    const D2 = days(w);
    for (const [d, want] of [[D2.summer, ["wade", "deep"]], [D2.winter, ["ice"]]]) {
      w.hour = d * 24 + 12;
      h.ponds = { d: WX.dayIndex(w), dry: 50, ice: P.pondIce(w) };
      const err = BM.openBaseMap(w, h.id), b = w.combat;
      const cells = b.cells.filter((c) => c.spring), kinds = new Set(cells.map((c) => c.wet || "dry"));
      const ext2 = springOf(b);
      check(!err && cells.length && [...kinds].every((k) => want.includes(k)) && ext2.w >= BS.HIGH.DIP_MIN && ext2.h >= BS.HIGH.DIP_MIN, `  day ${d} (${d === D2.winter ? "winter" : "summer, a dry spell"}): its map's spring ${cells.length} cells, ${ext2.w} × ${ext2.h}: ${[...kinds].join(", ")}`);
      check(b.cells.every((c) => c.spring || !(c.ter && c.h < 0) || !c.wet), "  the rain's hollows dry, the spring's alone wet");
      check(cutOff(b) === 0, "  its deep water cuts no ground off");
      w.combat = null;
    }
    // Nothing built on it, never filled in, never dug.
    const [x, y] = sp[Math.floor(sp.length / 2)];
    h.ponds = { d: WX.dayIndex(w), dry: 50, ice: false };
    const why = BM.placeProblemAt(h, { kind: "prop", w: 1, h: 1 }, x, y, 0, BM.occupancy(w, h));
    const piece = land.pieces.get(`${x},${y}`);
    check(/spring-fed pond/.test(why), `nothing built on it: "${why}"`);
    check(piece && piece.spring && !BS.clearOf(piece) && !BM.queueClear(w, h, [piece]), "never filled in (no clearing for it)");
    const occ = BM.occupancy(w, h);
    occ.land = null;
    check(/pond/i.test(dirtProblem(h, land, occ, x, y)), `never dug nor raised: "${dirtProblem(h, land, occ, x, y)}"`);
    check(land.waterOnly.pieces.has(`${x},${y}`), "the game's own layout keeps off it (the never-cleared land)");
  }
  // A real pond tile's own land: its spring, and the camp's spot keeps off it.
  const t = st.tiles.find((q) => q.pond);
  const land = BM.siteLand(st, t.id), sp = [...land.springs].map((k) => k.split(",").map(Number));
  check(sp.length > 0, `pond tile ${t.id} (${t.terrain}): its land has the spring (${sp.length} cells)`);
  const mid = sp[Math.floor(sp.length / 2)];
  check(/pond/i.test(BM.siteProblem(st, t.id, mid)), `the camp's spot is never on it: "${BM.siteProblem(st, t.id, mid)}"`);
  check(BS.landSpec(st, { tile: t.id }, { G: 125, C: 0, tier: "camp", terrain: "plains" }).pond === true, "landSpec carries the pond");
}

section("A pond tile's fights and raids: the spring's pond on every one, waded, ice in winter");
{
  const h = hub(st), D = days(st);
  const tiles = st.tiles.filter((t) => t.pond);
  const kinds = {};
  let n = 0, ok = 0, okWinter = 0, cut = 0, unitsOff = 0, raids = 0, raidOk = 0, big = 0;
  for (const t of tiles.slice(0, 24)) {
    kinds[t.terrain] = (kinds[t.terrain] || 0) + 1;
    st.hour = D.summer * 24 + 12;
    const b = fight(st, t.id, h);
    const e = springOf(b), wet = b.cells.filter((c) => c.spring && c.ter && c.h < 0);
    n++;
    if (e.w >= BS.HIGH.DIP_MIN && e.h >= BS.HIGH.DIP_MIN) big++;
    if (wet.length && wet.every((c) => c.wet === "wade" || c.wet === "deep")) ok++;
    cut += cutOff(b);
    unitsOff += b.units.filter((u) => u.alive !== false && !b.reach[u.y * b.w + u.x]).length;
    st.combat = null;
    st.hour = D.winter * 24 + 12;
    const bw = fight(st, t.id, h);
    if (bw.cells.some((c) => c.spring) && bw.cells.filter((c) => c.spring).every((c) => c.wet === "ice")) okWinter++;
    st.combat = null;
    if (raids < 8) {
      st.hour = D.summer * 24 + 12;
      const br = raid(st, t.id, h);
      raids++;
      if (br.cells.some((c) => c.spring && c.wet)) raidOk++;
      cut += cutOff(br);
      st.combat = null;
    }
  }
  check(ok === n, `an open fight on ${n} pond tiles (${JSON.stringify(kinds)}): the spring's pond on every one, water on a summer day (${ok})`);
  check(big === n, `at least ${BS.HIGH.DIP_MIN} cells across each way on every one (${big})`);
  check(okWinter === n, `ice on every one in winter (${okWinter})`);
  check(raidOk >= raids - 1, `a raid's map: the pond where its buildings leave room (${raidOk} of ${raids})`);
  check(cut === 0, "the deep water cuts no ground off (fights and raids)");
  check(unitsOff === 0, "every unit on ground walked to");
  // Wading and the aim, as any pond's; the hover words.
  st.hour = D.summer * 24 + 12;
  const b = fight(st, tiles[0].id, h);
  const wade = b.cells.find((c) => c.spring && c.wet === "wade");
  check(wade && P.wetCost(wade) === P.PONDS.COST.wade && P.wadeAim(wade) === P.PONDS.SHOOT_WADE, `wading its edge: +${P.PONDS.COST.wade} a step, −${P.PONDS.SHOOT_WADE} aim`);
  check(/never dries/.test(P.wetWord(wade)) && /spring/.test(P.wetWord({ k: "water", wet: "deep", spring: 1 })), `the hover: "${P.wetWord(wade).replace(/<[^>]+>/g, "")}"`);
  st.combat = null;
  // The State Map's tooltip.
  check(/pond/i.test(P.pondTileWord(st, tiles[0].id)) && !P.pondTileWord(st, st.tiles.find((q) => !q.pond).id), `the tooltip: "${P.pondTileWord(st, tiles[0].id)}"`);
  st.hour = D.winter * 24 + 12;
  check(/frozen/.test(P.pondTileWord(st, tiles[0].id)), `in winter: "${P.pondTileWord(st, tiles[0].id)}"`);
  // The same tile, the same pond.
  st.hour = D.summer * 24 + 12;
  const sig = (m) => m.cells.map((c) => `${c.k}${c.h || 0}${c.spring ? "s" : ""}${c.wet || ""}`).join("|");
  const rs = st.rng.state; // the fight's map is made from the game's dice: the same dice again
  const s1 = sig(fight(st, tiles[1].id, h)); st.combat = null;
  st.rng.state = rs;
  const s2 = sig(fight(st, tiles[1].id, h)); st.combat = null;
  check(s1 === s2, "the same tile and day, the same pond");
}

// ---------- 4. no pond: as before ----------
section("A tile with no pond: its land, relief and fight's heights as before ponds");
{
  // Worked out on dev 7f62448 (before ponds) for world seed 7: the land (basemap.js siteLand), the relief
  // (reliefLayer at 125) and an open 40 × 30 fight's heights (applyRelief with the crag) of the first three tiles of
  // each terrain with no pond and no river. The plains tiles' land re-pinned 2026-10-23 for farmland's fenced fields
  // (basescatter.js fieldLayer: their fences, not ponds; their relief and fight heights as before).
  const GOLDEN = { 0: ["93d63a17", "1215e174", "44c0763d"], 1: ["af5e7b59", "4e151ff3", "44c0763d"], 2: ["9533a67c", "968eecf", "44c0763d"], 5: ["bffcedc5", "10ae9e96", "44c0763d"], 6: ["8cbb032a", "1ef5da8a", "44c0763d"], 7: ["e9c4d60a", "ffb81f04", "44c0763d"], 11: ["87075613", "b056081a", "6694eee1"], 12: ["6d5b6098", "c9b8dc53", "65043908"], 13: ["549bbb73", "d33fd16f", "efc3c4b9"], 14: ["96b4e43d", "2025f2e4", "fc556a50"], 15: ["30952ba6", "e6771397", "7f02fa9"], 30: ["1feddda2", "8a85d8d3", "e82d0a4a"], 70: ["7f68ced7", "b1455a87", "44c0763d"], 71: ["7e3c29a5", "b1455a87", "44c0763d"], 72: ["f60c623c", "b1455a87", "44c0763d"], 667: ["dcba1220", "b1455a87", "44c0763d"], 668: ["6381b219", "b1455a87", "44c0763d"], 730: ["88e7da3a", "b1455a87", "44c0763d"] };
  const hash = (v) => { const s = JSON.stringify(v, (k, x) => (x instanceof Map ? [...x] : x instanceof Set ? [...x] : x)); let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h.toString(16); };
  const w = createWorld({ seed: 7, factionCount: 6 });
  const bad = [];
  for (const [id, [L, R, F]] of Object.entries(GOLDEN)) {
    const t = w.tiles[id];
    if (t.pond) { bad.push(`${id} is a pond tile`); continue; }
    const land = BM.siteLand(w, Number(id));
    const relief = BS.reliefLayer(BS.scatterSeed(Number(id)), t.terrain, 125);
    const cells = Array.from({ length: 40 * 30 }, () => ({ k: "open", f: "grass" }));
    RL.applyRelief(cells, 40, 30, t, { crags: true });
    const got = [hash({ list: land.list.map((p) => [p.k, p.g, p.cells, p.h]), floors: land.floors, heights: land.heights }), hash(relief), hash(cells.map((c) => [c.k, c.h || 0]))];
    if (got.join() !== [L, R, F].join()) bad.push(`${id} (${t.terrain}): ${got.join("/")}`);
  }
  check(!bad.length, `${Object.keys(GOLDEN).length} tiles of every terrain (plains, forest, hills, mountains, suburbs, a city) hash as before${bad.length ? `: ${bad.join("; ")}` : ""}`);
  // reliefLayer without a pond is the very layer it was; with one only its spring's hollow is added.
  const id = 11, terr = "hills";
  const a = BS.reliefLayer(BS.scatterSeed(id), terr, 125), b = BS.reliefLayer(BS.scatterSeed(id), terr, 125, true);
  const am = new Map(a.heights.map(([x, y, v]) => [`${x},${y}`, v])), bm = new Map(b.heights.map(([x, y, v]) => [`${x},${y}`, v]));
  const near = (k) => { const [x, y] = k.split(",").map(Number); return Math.max(Math.abs(x), Math.abs(y)) <= BS.SPRING.FAR + 12 && Math.min(Math.abs(x), Math.abs(y)) >= 0; };
  const diff = [...new Set([...am.keys(), ...bm.keys()])].filter((k) => am.get(k) !== bm.get(k));
  check(!a.springs && b.springs && b.springs.length && diff.every(near), `a hills tile's relief with a pond: ${b.springs.length} spring cells, ${diff.length} cells changed, all round the spring`);
}

console.log(`\n${passes} passed, ${fails} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fails ? 1 : 0);
