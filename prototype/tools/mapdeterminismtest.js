// The generated maps are the same every time (the user's words 2026-10-23: "Add tests to cover reachability and
// determinism"): the land is the tile's alone, from its own dice.
//   1. the same tile gives the same land, relief, town and scatter layers (hashed) on a call again after the caches
//      have turned over, and in a fresh process;
//   2. a base's land does not hang on the game's dice, on what is built or moved (only the ground cleared under it and
//      round it changes), and reading it (landFor, siteLand, defaultSite, the base's map) draws none of the game's dice;
//   3. a save and a load give the same land, the same cleared cells and the same heights;
//   4. a fight's map on a hills or mountain tile (an open fight with its crag, a raid, the camp's spot) is the same for
//      the same battle dice, and applyRelief the same on the same cells.
// Usage: node tools/mapdeterminismtest.js [seed]   (about half a minute)
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createWorld } from "../src/sim/world.js";
import { roadTeam } from "../src/sim/hardcore-start.js";
import { createBattle, registerCombatHandler } from "../src/sim/combat.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { HexGrid } from "../src/sim/hex.js";
import { Rng } from "../src/sim/rng.js";
import * as BM from "../src/sim/basemap.js";
import { reliefLayer, townLayer, scatterLayer, scatterSeed, landSpec, landOf } from "../src/sim/basescatter.js";
import { applyRelief } from "../src/sim/relief.js";
import "../src/sim/siteclear.js"; // the "siteClear" layout

const SEED = Number(process.argv[2] || 42);
const CHILD = process.argv[2] === "--child";
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); return !!ok; };
const section = (t) => console.log(`\n${t} [${((Date.now() - t0) / 1000).toFixed(1)} s]`);
const t0 = Date.now();
registerCombatHandler("mdt", () => {});

// A hash of anything (FNV-1a over its JSON, Maps as their sorted entries).
const fnv = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, "0"); };
const json = (v) => JSON.stringify(v, (k, x) => (x instanceof Map ? [...x].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)) : x));
const hash = (v) => fnv(json(v));
// A land (landOf) as plain data: its pieces (kind, group, cells, height, the rock's level), floors, heights.
const landData = (L) => ({ list: L.list.map((p) => [p.k, p.g, p.cells, p.h ?? null, p.looted ? 1 : 0]).sort((a, b) => (a[1] < b[1] ? -1 : 1)), floors: L.floors, heights: L.heights });
// A battle map's ground as plain data.
const cellsData = (cells) => cells.map((c) => [c.k, c.f || "", c.h ?? null, c.ter ? 1 : 0, c.ch ?? null]);

// The tiles of part 1: each kind of land on a world of its own (a road through, a river beside).
const hexes = new HexGrid(40, 40);
function tileWorld(id, terrain, { road = false, river = false } = {}) {
  const tiles = {};
  for (let i = 0; i < hexes.size; i++) tiles[i] = { id: i, terrain: "plains" };
  tiles[id].terrain = terrain;
  const nb = hexes.neighbors(id);
  if (road) Object.assign(tiles[id], { road: true, roadLinks: [nb[0], nb[3]] });
  if (river) tiles[nb[1]].river = true;
  return { tiles, grid: hexes, bases: [], survivors: [], parties: [] };
}
const TILES = [[311, "mountain", {}], [523, "mountain", { road: true, river: true }], [87, "hills", { river: true }], [402, "forest", {}], [655, "suburb", {}], [918, "city", {}], [244, "plains", { road: true }]];
function layerHashes() {
  const out = {};
  for (const [id, terrain, o] of TILES) {
    const seed = scatterSeed(id), st = tileWorld(id, terrain, o);
    out[`${terrain}${id}`] = {
      relief: hash(reliefLayer(seed, terrain, BM.GRID_MAX)),
      scatter: hash(scatterLayer(seed, terrain, BM.GRID_MAX)),
      town: terrain === "suburb" || terrain === "city" ? hash(townLayer(seed, terrain === "city" ? "city" : "town", BM.GRID_MAX)) : "",
      land: hash(landData(BM.siteLand(st, id))),
      camp: hash(landData(landOf(landSpec(st, { tile: id }, { G: BM.GRID_MAX, C: 10, tier: "camp", terrain, origin: [12, -7] }), null))),
      site: String(BM.defaultSite(st, id)),
    };
  }
  return out;
}
if (CHILD) { console.log(JSON.stringify(layerHashes())); process.exit(0); }

// ---------- 1. the same tile, the same land ----------
section("1. The same tile gives the same land: again, after the caches turn over, in a fresh process");
{
  const a = layerHashes();
  // Turn the caches over (the land's, the relief's, the towns' and the scatter's: each keeps a few dozen).
  for (let id = 1100; id < 1170; id++) { reliefLayer(scatterSeed(id), id % 2 ? "hills" : "forest", BM.GRID_MAX); scatterLayer(scatterSeed(id), "forest", BM.GRID_MAX); if (id % 5 === 0) townLayer(scatterSeed(id), "town", BM.GRID_MAX); }
  for (let id = 1100; id < 1150; id++) BM.siteLand(tileWorld(id, "plains"), id);
  const b = layerHashes();
  const diff = Object.keys(a).filter((k) => json(a[k]) !== json(b[k]));
  check(!diff.length, `${TILES.length} tiles (mountains, a road and a river, hills, forest, the suburbs, a city, farmland): the same relief, scatter, town and land layers and the same spot made again (${diff.length ? `differ: ${diff.join(", ")}` : Object.entries(a).slice(0, 2).map(([k, v]) => `${k} ${v.land}`).join(", ")})`);
  const kid = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--child"], { encoding: "utf8", timeout: 120000 });
  let c = null;
  try { c = JSON.parse(kid.stdout.trim().split("\n").pop()); } catch { c = null; }
  const diff2 = c ? Object.keys(a).filter((k) => json(a[k]) !== json(c[k])) : ["(no answer)"];
  check(!diff2.length, `and the same in a fresh process${diff2.length ? ` (differ: ${diff2.join(", ")}${kid.stderr ? `; ${kid.stderr.slice(0, 200)}` : ""})` : ""}`);
  check(hash(reliefLayer(scatterSeed(311), "mountain", BM.GRID_MAX)) !== hash(reliefLayer(scatterSeed(312), "mountain", BM.GRID_MAX)), "another tile, another lie of the land");
}

// ---------- 2. the game's dice, what is built, what is moved ----------
section("2. A base's land hangs on its tile alone: not the game's dice, not what is built or moved");
const st = createWorld({ seed: SEED, factionCount: 7, mode: "hardcore" });
st.noWanderers = true;
const free = Object.values(st.tiles).filter((t) => t.terrain !== "water" && !t.hive && !st.bases.some((b) => b.tile === t.id) && t.owner == null);
const mtn = free.filter((t) => t.terrain === "mountain");
let camp;
{
  const t = mtn[3], at = BM.defaultSite(st, t.id);
  camp = { id: 9100, tile: t.id, type: "outpost", name: "Same Camp", stock: { water: 0, fuel: 0, meds: 0, ammo: 0, arrows: 0, parts: 0, scrap: 0, jars: 0, wood: 0, buildmat: 0, metalsheet: 0, rawwater: 0 }, radio: false, watchtower: false, buildings: [], construction: [], armory: [], tier: 0, camp: true, fire: true, tentsSet: true, plan: { plots: [], origin: at, fresh: true }, land: { v: 2, n: 1, cleared: {}, looted: {} } };
  st.bases.push(camp);
  const r0 = st.rng.state;
  BM.clearCampSite(st, camp);
  const h0 = hash(landData(BM.landFor(st, camp)));
  BM.siteLand(st, t.id); BM.defaultSite(st, t.id); BM.autoLayout(st, camp); BM.buildBaseMap(st, camp, new Rng(3));
  check(st.rng.state === r0, `reading the land, the spot, the layout and the base's map draws none of the game's dice (${r0} → ${st.rng.state})`);
  for (let i = 0; i < 997; i++) st.rng.next();
  camp.land.n++; // read afresh
  check(hash(landData(BM.landFor(st, camp))) === h0, `the game's dice a thousand draws on: the same land (${h0})`);
  // Something built by hand (its ground cleared first, as the player would), the fire moved: the land away from what
  // was cleared is the same (the ground right round a cleared cell is eased down to it).
  const L0 = BM.landFor(st, camp), before = new Map();
  for (const p of L0.list) before.set(p.g, json([p.k, p.cells, p.h ?? null]));
  const hBefore = new Map(L0.heights);
  camp.construction.push({ id: 91001, type: "storehouse", hours: 10, progress: 0 });
  const it = BM.itemByKey(st, camp, "c:91001"), spot = [26, 4, 0]; // out beyond the wall's ring
  for (const [x, y] of BM.landUnder(L0, it, spot).flatMap((p) => p.cells)) camp.land.cleared[`${x},${y}`] = 1;
  for (let y = spot[1] - 2; y < spot[1] + 12; y++) for (let x = spot[0] - 2; x < spot[0] + 12; x++) camp.land.cleared[`${x},${y}`] = 1;
  camp.land.n++;
  const put = BM.placeItem(st, camp, "c:91001", spot[0], spot[1], 0);
  BM.placeItem(st, camp, BM.FIRE.KEY, 1, -1, 0);
  const L1 = BM.landFor(st, camp), cl = Object.keys(camp.land.cleared).map((k) => k.split(",").map(Number));
  const far = (x, y) => cl.every(([cx, cy]) => Math.max(Math.abs(cx - x), Math.abs(cy - y)) > 4);
  let moved = 0, same = 0, hMoved = 0;
  for (const p of L1.list) { if (!p.cells.every(([x, y]) => far(x, y))) continue; if (before.get(p.g) === json([p.k, p.cells, p.h ?? null])) same++; else moved++; }
  for (const [k, v] of L1.heights) { const [x, y] = k.split(",").map(Number); if (far(x, y) && hBefore.get(k) !== v) hMoved++; }
  for (const [k, v] of hBefore) { const [x, y] = k.split(",").map(Number); if (far(x, y) && L1.heights.get(k) !== v) hMoved++; }
  check(!put && moved === 0 && hMoved === 0 && same > 500, `a storehouse put down by hand on cleared ground and the fire moved: the rest of the land as it was (${same} pieces the same, ${moved} changed, ${hMoved} heights changed${put ? `; placing: ${put}` : ""})`);
}

// ---------- 3. a save and a load ----------
section("3. A save and a load: the same land, cleared cells and heights");
{
  const L0 = BM.landFor(st, camp), cleared0 = json(camp.land.cleared), h0 = hash(landData(L0)), heights0 = hash(L0.heights);
  st.cards.length = 0; // a card waiting for an answer is never saved
  const s2 = loadFromString(saveToString(st));
  const c2 = s2.bases.find((b) => b.id === camp.id), L2 = BM.landFor(s2, c2);
  check(json(c2.land.cleared) === cleared0 && Object.keys(c2.land.cleared).length > 25, `the cleared cells come back (${Object.keys(c2.land.cleared).length})`);
  check(hash(landData(L2)) === h0 && hash(L2.heights) === heights0 && String(BM.originOf(c2)) === String(BM.originOf(camp)), `the land and its heights come back the same (${h0}, ${L2.heights.size} cells of hills and hollows, ${L2.list.filter((p) => p.k === "crag").length} of rock)`);
  const F1 = BM.buildBaseMap(st, camp, new Rng(5)), F2 = BM.buildBaseMap(s2, c2, new Rng(5));
  check(hash(cellsData(F1.cells)) === hash(cellsData(F2.cells)), `and its battle map (${F1.W} × ${F1.H})`);
}

// ---------- 4. fights ----------
section("4. A fight's map on a hills or mountain tile: the same for the same battle dice");
{
  const p = roadTeam(st);
  const inBrowser = (f) => { globalThis.window = {}; try { return f(); } finally { delete globalThis.window; } };
  const make = (t, kind, r) => {
    st.rng.state = r;
    const base = { tile: t.id, partyId: p.id, ambush: null, canRetreat: true, handler: "mdt", context: {} };
    const setup = kind === "raid" ? { ...base, mode: "raid", enemy: { kind: "zombies", count: 3, power: 3 }, raid: { heat0: 0 } } : kind === "site" ? { ...base, enemy: { kind: "zombies", count: 6, power: 2 }, layout: "siteClear", context: { partyId: p.id, tile: t.id, at: BM.defaultSite(st, t.id) } } : { ...base, enemy: { kind: "zombies", count: 5, power: 2 } };
    const b = inBrowser(() => createBattle(st, setup));
    return { cells: hash(cellsData(b.cells)), units: hash(b.units.map((u) => [u.side, u.x, u.y])), relief: b.cells.filter((c) => c.ter || c.k === "crag").length };
  };
  const tiles = [...mtn.slice(0, 4), ...free.filter((t) => t.terrain === "hills").slice(0, 2)];
  const bad = [];
  let relief = 0, n = 0;
  for (const t of tiles) for (const kind of ["open", "raid", "site"]) {
    const a = make(t, kind, 5000 + t.id), b = make(t, kind, 5000 + t.id);
    n++; relief += a.relief;
    if (a.cells !== b.cells || a.units !== b.units) bad.push(`${kind} ${t.terrain} ${t.id}`);
  }
  st.combat = null;
  check(!bad.length && relief > 500, `${n} fights made twice from the same dice (open fights, raids, the camp's spot; ${relief} cells of hills, hollows and rock): the same map and the same people on it${bad.length ? ` (differ: ${bad.join(", ")})` : ""}`);
  const cellsOf = () => Array.from({ length: 40 * 30 }, (_, i) => ({ k: i % 7 === 0 ? "tree" : i % 11 === 0 ? "bush" : "open" }));
  const c1 = cellsOf(), c2 = cellsOf(), tile = { id: mtn[0].id, terrain: "mountain" };
  applyRelief(c1, 40, 30, tile, { crags: true }); applyRelief(c2, 40, 30, tile, { crags: true });
  check(hash(cellsData(c1)) === hash(cellsData(c2)), "applyRelief lays the same on the same cells");
}

console.log(`\n${passes} passed, ${fails} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fails ? 1 : 0);
