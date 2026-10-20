// The base map view's playtest fixes (2026-10-20; src/sim/basemap.js, basescatter.js, ui/isoview.js):
// 1. Move does not make the map again: Move (layoutAct "lift") on a parked car or a building only picks it up (its ghost
//    follows the mouse), the view, the thing and everything else stay as they are, the game's dice are not touched; put
//    down, the map is laid out again with the same scatter everywhere but round the old and the new spot, the other
//    things where they were, the camera kept.
// 2. The scatter is the land's: tree clumps, trees, bushes, old fence runs, rocks, stumps, logs, wrecked cars by the
//    tile's terrain, stumps, logs, crates and barrels in the cleared yard (no tree, bush or fence there), fixed by the
//    tile in grid coordinates (deterministic, stable as the grid grows), the same on a raid's battle map as in the view,
//    never closing open ground off, cover enough for a fight; an AI group's walled base wears it too.
// 3. A camp's tents: one a two beds of the camp's own (three), 2 × 1, placed round the fire by the game, moved by hand
//    (kept through save and load), struck when the camp steps up to a shelter; an AI group's camp pitches as many.
// Usage: node tools/baseviewtest.js [seed]
import { createWorld, hub, atBase, makeSurvivor } from "../src/sim/world.js";
import { createBattle, registerCombatHandler, combatAct, CELL } from "../src/sim/combat.js";
import { addBuilding, upgradeShelter, CAMP } from "../src/sim/buildings.js";
import { createVehicle } from "../src/sim/vehicles.js";
import { newItem } from "../src/sim/inventory.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { coverShare, COVER } from "../src/sim/battlesize.js";
import { buildFort } from "../src/sim/fort.js";
import { Rng } from "../src/sim/rng.js";
import * as BM from "../src/sim/basemap.js";
import * as SC from "../src/sim/basescatter.js";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(`\n${t}`);
const t0 = Date.now();
registerCombatHandler("bvt", () => {});
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 6 }); st.started = true; return st; };
const SCAT = new Set([...SC.SCATTER_KINDS]);
// The scatter on a map in grid coordinates: "gx,gy" → kind (a wreck's cells: c.car without a vehicle id of yours).
function scatterOf(b) {
  const F = b.deployPlan.fort, out = new Map();
  const mine = new Set((F.vehicles || []).flatMap((v) => { const o = []; for (let y = v.y0; y < v.y0 + v.h; y++) for (let x = v.x0; x < v.x0 + v.w; x++) o.push(y * b.w + x); return o; }));
  const core = new Set();
  const st = new Set((F.stores || []).flatMap((s) => { const o = []; for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) o.push(y * b.w + x); return o; }));
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const i = y * b.w + x, c = b.cells[i];
    if (mine.has(i) || st.has(i) || core.has(i)) continue;
    if (SCAT.has(c.k) || ((c.k === "car" || c.k === "truck") && c.car)) out.set(`${x - F.ox},${y - F.oy}`, c.k);
  }
  return out;
}
// A grid cell by the edge of a map's crop (the scatter keeps off the outermost ring: basescatter.js, and a crop that
// grows can open or close a pocket by its old edge: unpocket), or off the map.
const rim = (key, b) => { const F = b.deployPlan.fort, [x, y] = key.split(",").map(Number), mx = x + F.ox, my = y + F.oy; return mx <= 2 || my <= 2 || mx >= b.w - 3 || my >= b.h - 3; };
const near = (key, rects, d = 2) => { const [x, y] = key.split(",").map(Number); return rects.some((r) => x >= r.x0 - d && x < r.x0 + r.w + d && y >= r.y0 - d && y < r.y0 + r.h + d); };
const kinds = (m) => { const k = {}; for (const v of m.values()) k[v] = (k[v] || 0) + 1; return k; };
const fmt = (k) => Object.entries(k).sort((a, b) => b[1] - a[1]).map(([a, n]) => `${a} ${n}`).join(", ");
function raid(st, h) {
  globalThis.window = {};
  try { st.combat = createBattle(st, { tile: h.tile, baseId: h.id, enemy: { kind: "raiders", count: 6, power: 3, name: "raiders" }, ambush: null, canRetreat: true, handler: "bvt", layout: "baseDefence", deploy: true, context: { night: false, ready: { manned: true } } }); }
  finally { delete globalThis.window; }
  const b = st.combat; st.combat = null; return b;
}
const act = (st, a) => combatAct(st, a);
function makeCamp(st, terrain = null) {
  const h0 = hub(st);
  const tiles = Object.keys(st.tiles).map(Number).filter((t) => st.tiles[t].terrain !== "water" && !st.tiles[t].bridge && !st.bases.some((b) => b.tile === t) && (!terrain || st.tiles[t].terrain === terrain));
  const tile = tiles.sort((a, b) => a - b)[0] ?? st.grid.neighbors(h0.tile)[0];
  const camp = { id: 9000 + st.bases.length, tile, type: "outpost", name: "Test Camp", stock: { water: 0, fuel: 0, meds: 0, ammo: 0, arrows: 0, parts: 0, scrap: 0, jars: 0, wood: 0, buildmat: 0, rawwater: 0 }, radio: false, watchtower: false, buildings: [], construction: [], armory: [], tier: 0, camp: true, fire: true };
  st.bases.push(camp);
  return camp;
}

// ---------- 1. Move does not make the map again ----------
section("Move does not make the map again");
{
  const st = world();
  const h = hub(st);
  for (const t of ["bunkhouse", "storehouse", "gen_cabin", "barricades", "rain_catcher"]) addBuilding(h, t);
  const car = createVehicle(st, "truck", { kind: "base", baseId: h.id });
  const cabin = h.buildings.find((x) => x.type === "gen_cabin");
  const dice0 = st.rng.state;
  check(!BM.openBaseMap(st, h.id), "the map opens");
  const b0 = st.combat, F0 = b0.deployPlan.fort;
  const sc0 = scatterOf(b0);
  check(sc0.size > 20, `the view has scatter (${fmt(kinds(sc0))})`);
  const pos0 = new Map(BM.layoutOf(st, h).map((e) => [e.it.key, String(e.at)]));
  const cells0 = b0.cells.map((c) => c.k).join("");
  // Move the car (its card's Move, or the Vehicles tab's): only the pick.
  const key = `v:${car.id}`, eCar = BM.layoutOf(st, h).find((e) => e.it.key === key);
  check(!act(st, { type: "select", key }) && !act(st, { type: "lift", key }), "Move on the parked car");
  check(st.combat === b0 && b0.layout.pick === key && b0.cells.map((c) => c.k).join("") === cells0, "the same view: nothing laid out again, not a cell changed");
  check(BM.layoutOf(st, h).every((e) => String(e.at) === pos0.get(e.it.key)), "the car and everything else stand where they stood until it is put down");
  check(st.rng.state === dice0, "the game's dice untouched by opening the map and Move");
  // Its ghost follows the mouse: green on free ground beyond the yard, red over the bunkhouse.
  const C = BM.yardHalf(h), spot = [C + 5, -2];
  const g = BM.ghostAt(st, b0, spot[0] + 1 + F0.ox, spot[1] + 1 + F0.oy);
  check(g && g.ok, `its ghost fits out beyond the yard (${g && (g.ok ? g.at : g.why)})`);
  check(!act(st, { type: "put", x: spot[0] + 1 + F0.ox, y: spot[1] + 1 + F0.oy }) && car.at, `put down at ${car.at}`);
  const b1 = st.combat, F1 = b1.deployPlan.fort, sc1 = scatterOf(b1);
  check(b1 !== b0 && b1.keepCam && b1.layout === b0.layout, "laid out again once, the camera kept (keepCam, the same layout record)");
  const oldR = BM.rectOf(eCar.it, eCar.at), newR = BM.rectOf(eCar.it, car.at);
  const lost = [...sc0.keys()].filter((k) => sc1.get(k) !== sc0.get(k) && !near(k, [oldR, newR]) && !rim(k, b0) && !rim(k, b1));
  const added = [...sc1.keys()].filter((k) => sc0.get(k) !== sc1.get(k) && !near(k, [oldR, newR]) && !rim(k, b0) && !rim(k, b1));
  check(!lost.length && !added.length, `the scatter is the same everywhere but round the old and the new spot (${lost.length} gone, ${added.length} new elsewhere${lost.length ? `: ${lost.slice(0, 4).join(" ")}` : ""})`);
  check(BM.layoutOf(st, h).every((e) => e.it.key === key || String(e.at) === pos0.get(e.it.key)), "everything else where it stood");
  const v1 = F1.vehicles.find((v) => v.id === car.id);
  check(v1 && v1.x0 - F1.ox === car.at[0] && v1.y0 - F1.oy === car.at[1], "the car on the view where it was put");
  // A general building moved the same way (what stands inside goes along).
  const cKey = `b:${cabin.id}`, eCab = BM.layoutOf(st, h).find((e) => e.it.key === cKey);
  const b2 = st.combat;
  check(!act(st, { type: "lift", key: cKey }) && st.combat === b2 && String(BM.layoutOf(st, h).find((e) => e.it.key === cKey).at) === String(eCab.at), "Move on a building: picked up, nothing laid out again");
  check(!act(st, { type: "pick", key: null }) && st.combat === b2 && !b2.layout.pick, "Esc: it stays where it was, the view untouched");
  // A building the game placed, moved by hand: the others the game placed stay where they were (holdAuto), the
  // scatter only changes round its old and new spots.
  const bunk = h.buildings.find((x) => x.type === "bunkhouse"), bKey = `b:${bunk.id}`;
  const before = new Map(BM.layoutOf(st, h).map((e) => [e.it.key, String(e.at)])), eB = BM.layoutOf(st, h).find((e) => e.it.key === bKey);
  const sb = scatterOf(b2), Fb = b2.deployPlan.fort;
  act(st, { type: "lift", key: bKey });
  let spotB = null;
  for (let d = 0; d < 30 && !spotB; d++) for (const [x, y] of [[-C - 4 - d, 6], [-C - 4 - d, -10], [6, C + 4 + d]]) { const gg = BM.ghostAt(st, b2, x + Fb.ox, y + Fb.oy); if (!spotB && gg && gg.ok) spotB = [x + Fb.ox, y + Fb.oy, gg.at]; }
  check(!!spotB && !act(st, { type: "put", x: spotB[0], y: spotB[1] }) && String(bunk.at) === String(spotB[2]), `the bunkhouse (placed by the game) moved by hand to ${bunk.at}`);
  check(BM.layoutOf(st, h).every((e) => e.it.key === bKey || String(e.at) === before.get(e.it.key)), "everything else the game placed stays where it stood");
  const b3 = st.combat, sb3 = scatterOf(b3), rB = [BM.rectOf(eB.it, eB.at), BM.rectOf(eB.it, bunk.at)];
  const moved = [...new Set([...sb.keys(), ...sb3.keys()])].filter((k) => sb.get(k) !== sb3.get(k) && !near(k, rB) && !rim(k, b2) && !rim(k, b3));
  check(!moved.length, `the scatter the same but round its old and new spots (${moved.length} cells differ elsewhere)`);
  // Opening the map again: the same map.
  act(st, { type: "endLayout" });
  BM.openBaseMap(st, h.id); const c1 = st.combat.cells.map((c) => c.k).join(""); act(st, { type: "endLayout" });
  BM.openBaseMap(st, h.id); const c2 = st.combat.cells.map((c) => c.k).join(""); act(st, { type: "endLayout" });
  check(c1 === c2, "the view made twice is the same view");
  check(st.rng.state === dice0, "and the game's dice are where they were after all of it");
}

// ---------- 2. The scatter ----------
section("The scatter: the land's, fixed by the tile");
{
  const want = { forest: ["tree", "bush", "log"], plains: ["fence", "tree", "bush"], farm: ["fence", "hay"], hills: ["rock", "boulder"], mountain: ["boulder", "rock"], suburb: ["fence", "tree", "bush", "wreck"], city: ["wreck", "crate", "barrel"] };
  for (const [terrain, ks] of Object.entries(want)) {
    const L = SC.scatterLayer(SC.scatterSeed(1234), terrain, 40), k = {};
    for (const p of L) k[p.k] = (k[p.k] || 0) + 1;
    check(ks.every((x) => k[x] > 0), `${terrain}: ${fmt(k)}`);
  }
  const a = JSON.stringify(SC.scatterLayer(SC.scatterSeed(77), "forest", 30));
  const b = JSON.stringify(SC.scatterLayer(SC.scatterSeed(77), "forest", 31).filter((p) => p.x >= -30 && p.y >= -30 && p.x < 30 && p.y < 30));
  check(a === b, "deterministic by the tile, and a bigger grid keeps every piece of the smaller one");
  check(JSON.stringify(SC.scatterLayer(SC.scatterSeed(78), "forest", 30)) !== a, "another tile, other scatter");
  // A base on the map: the view and a raid's battle map.
  const st = world(seed + 3);
  const h = hub(st);
  for (const t of ["bunkhouse", "storehouse", "barricades", "well"]) addBuilding(h, t);
  for (const s of atBase(st, h.id)) { s.health = 100; if (!s.gear.weapon) s.gear.weapon = newItem("pistol"); }
  BM.openBaseMap(st, h.id);
  const v = st.combat, Fv = v.deployPlan.fort, sv = scatterOf(v); st.combat = null;
  const r = raid(st, h), Fr = r.deployPlan.fort, sr = scatterOf(r);
  const both = (k) => { const [x, y] = k.split(",").map(Number); return x + Fv.ox >= 0 && x + Fv.ox < v.w && y + Fv.oy >= 0 && y + Fv.oy < v.h && x + Fr.ox >= 0 && x + Fr.ox < r.w && y + Fr.oy >= 0 && y + Fr.oy < r.h; };
  const diff = [...new Set([...sv.keys(), ...sr.keys()])].filter((k) => both(k) && !rim(k, v) && !rim(k, r) && sv.get(k) !== sr.get(k));
  check(sr.size > 20 && diff.length <= Math.max(2, sr.size * 0.03), `a raid's battle map has the view's scatter (${sr.size} pieces; ${diff.length} differ: ${fmt(kinds(sr))})`);
  const C = BM.yardHalf(h);
  const inYardK = new Set([...sr].filter(([k]) => { const [x, y] = k.split(",").map(Number); return x >= -C && x < C && y >= -C && y < C; }).map(([, kk]) => kk));
  check(![...inYardK].some((k) => k === "tree" || k === "bush" || k === "fence") && inYardK.size > 0, `the yard is cleared ground: ${[...inYardK].join(", ")}`);
  const cs = coverShare(r.cells, r.w, r.h, COVER.R, r.reach);
  check(cs.share >= 0.6, `cover within ${COVER.R} tiles of ${Math.round(cs.share * 100)}% of the open ground on the raid map`);
  // Nothing walled off by the scatter: every open cell the map's edge reaches with the scatter cleared, it reaches as it is.
  const flood = (thru) => { const seen = new Uint8Array(r.w * r.h), q = []; const can = (i) => CELL[r.cells[i].k].walk || (thru && SCAT.has(r.cells[i].k)); for (let x = 0; x < r.w; x++) for (const y of [0, r.h - 1]) { const i = y * r.w + x; if (can(i) && !seen[i]) { seen[i] = 1; q.push(i); } } for (let y = 0; y < r.h; y++) for (const x of [0, r.w - 1]) { const i = y * r.w + x; if (can(i) && !seen[i]) { seen[i] = 1; q.push(i); } } for (let k = 0; k < q.length; k++) { const i = q[k], x = i % r.w, y = (i - x) / r.w; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, j = ny * r.w + nx; if (nx >= 0 && ny >= 0 && nx < r.w && ny < r.h && !seen[j] && can(j)) { seen[j] = 1; q.push(j); } } } return seen; };
  const fa = flood(false), fb = flood(true);
  let shut = 0; for (let i = 0; i < r.w * r.h; i++) if (fb[i] && !fa[i] && CELL[r.cells[i].k].walk) shut++;
  check(!shut, `the scatter shuts no open ground off from the map's edge (${shut} cells)`);
  // Nothing on top of what stands or in its buffer: no scatter next to a door.
  const doorNear = Fr.doors.filter(([x, y]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => SCAT.has((r.cells[(y + dy) * r.w + x + dx] || {}).k)));
  check(!doorNear.length, "no scatter against a door");
  // An AI group's walled base (fort.js without a grid): the same land in its margin.
  const fb2 = { id: -1, tile: h.tile, type: "outpost", name: "theirs", buildings: [{ type: "walls", str: 4 }, { type: "bunkhouse" }, { type: "storehouse" }], construction: [], armory: [], stock: { fuel: 0 } };
  const Fa = buildFort(fb2, {}, new Rng(5), { state: st });
  const ka = {}; for (const c of Fa.cells) if (SCAT.has(c.k)) ka[c.k] = (ka[c.k] || 0) + 1;
  check((ka.fence || 0) + (ka.bush || 0) + (ka.stump || 0) + (ka.log || 0) > 0, `an AI group's walled base wears the same land in its margin (${fmt(ka)})`);
  const Fb = buildFort(fb2, {}, new Rng(99), { state: st });
  const same = Fa.cells.filter((c, i) => ["fence", "bush", "log", "stump"].includes(c.k) && Fb.cells[i].k === c.k).length, all = Fa.cells.filter((c) => ["fence", "bush", "log", "stump"].includes(c.k)).length;
  check(all > 0 && same === all, `fixed by their tile: the same fences, bushes, logs and stumps on another fight's dice (${same}/${all})`);
}

// ---------- 3. A camp's tents ----------
section("A camp's tents");
{
  const st = world(seed + 5);
  const camp = makeCamp(st, "forest");
  const n = BM.tentCount(camp);
  check(n === Math.ceil(CAMP.beds / BM.TENT.BEDS) && n === 3, `a camp of ${CAMP.beds} beds has ${n} tents`);
  const tents = BM.layoutOf(st, camp).filter((e) => e.it.type === "tent");
  check(tents.length === n && tents.every((e) => e.at && e.auto && e.it.w === 2 && e.it.h === 1 && e.it.k === "tent"), `each a 2 × 1 tent the game placed (${tents.map((e) => String(e.at)).join(" ; ")})`);
  BM.openBaseMap(st, camp.id);
  let b = st.combat, F = b.deployPlan.fort;
  const tentCells = () => st.combat.cells.filter((c) => c.k === "tent").length;
  check(tentCells() === 2 * n, `the view shows them (${tentCells()} tent cells)`);
  const sc = scatterOf(b);
  check(Object.keys(kinds(sc)).some((k) => k === "tree"), `a forest camp among trees (${fmt(kinds(sc))})`);
  // Move one: picked, nothing laid out again; put down elsewhere, it is there.
  const k0 = tents[0].it.key;
  check(!act(st, { type: "lift", key: k0 }) && st.combat === b && tentCells() === 2 * n, "Move on a tent: picked up, nothing laid out again");
  const C = BM.yardHalf(camp);
  let put = null;
  for (let y = -C + 1; y < C - 1 && !put; y++) for (let x = -C + 1; x < C - 2 && !put; x++) { if (Math.abs(x) < 6 && Math.abs(y) < 6) continue; const g = BM.ghostAt(st, b, x + 1 + F.ox, y + F.oy); if (g && g.ok) put = [x + 1 + F.ox, y + F.oy, g.at]; }
  if (!put) { const why = {}; for (let y = -C; y < C; y++) for (let x = -C; x < C; x++) { const g = BM.ghostAt(st, b, x + 1 + F.ox, y + F.oy); const k = g ? (g.ok ? "ok" : g.why) : "none"; why[k] = (why[k] || 0) + 1; } console.log(why, b.layout); }
  check(!!put && !act(st, { type: "put", x: put[0], y: put[1] }), `put down at ${put && put[2]}`);
  b = st.combat; F = b.deployPlan.fort;
  const at = camp.plan.tents[0];
  check(at && String(at) === String(put[2]) && b.cells[(at[1] + F.oy) * b.w + at[0] + F.ox].k === "tent" && b.cells[(at[1] + F.oy) * b.w + at[0] + 1 + F.ox].k === "tent", "kept on the camp's plan (plan.tents) and drawn there");
  check(BM.layoutOf(st, camp).filter((e) => e.it.type === "tent").every((e) => e.it.key === k0 || String(e.at) === String(tents.find((q) => q.it.key === e.it.key).at)), "the other tents where they stood");
  act(st, { type: "endLayout" });
  // Save and load.
  const st2 = loadFromString(saveToString(st));
  const camp2 = st2.bases.find((x) => x.id === camp.id);
  check(camp2 && camp2.plan && String(camp2.plan.tents[0]) === String(at), "save and load keep where it was put");
  // A raid on the camp fights round the tents too.
  for (let i = 0; i < 3; i++) { const s = makeSurvivor(st); s.location = { kind: "base", baseId: camp.id }; s.health = 100; s.gear.weapon = newItem("pistol"); st.survivors.push(s); }
  const rr = raid(st, camp);
  check(rr.cells.filter((c) => c.k === "tent").length === 2 * n, "a raid on the camp has its tents where they stand");
  // The step up to a shelter strikes them.
  camp.type = "outpost"; upgradeShelter(st, camp);
  check(BM.tentCount(camp) === 0 && !(camp.plan && camp.plan.tents) && !BM.itemsOf(st, camp).some((it) => it.type === "tent"), "the camp steps up: its tents are struck (the plan forgets them)");
  // An AI group's camp (groupbases.js h.camp) counts as many.
  check(BM.tentCount({ camp: true, fid: 3, tile: 0, buildings: [] }) === n && BM.tentCount({ camp: false, fid: 3 }) === 0, "an AI group's camp pitches as many tents; their outpost none");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
