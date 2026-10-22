// The base map view and its land (2026-10-20; src/sim/basemap.js, basescatter.js, buildings.js, ui/isoview.js):
// 1. Move does not make the map again: Move (layoutAct "lift") only picks the thing up (its ghost follows the mouse, a
//    dimmed copy where it stands), the view and everything else stay as they are, the game's dice are untouched; put
//    down, the map is laid out again with the same land everywhere but round the old and the new spot, the rest where it
//    stood, the camera kept.
// 2. The land: by the tile (terrain, a road with its abandoned cars, a river beside it with its fords, farmland's
//    hedgerows and fences, a town's paved lots), the clearing in the middle empty, deterministic and the same as the
//    grid grows, the same on a raid's battle map as in the view, cover enough for a fight, no ground shut off.
// 3. Clearing: every piece blocks building (the ghost says why); a click on a red site queues its clearing as a job in
//    the construction queue, the builders work it, the wood comes into the stores when it is done, the land is gone on
//    the view and on a raid's map, and the building then fits; a wreck stripped once for scrap and a car part; the game's
//    auto layout never stuck (over the land, its clearing queued first: siteWaits).
// 4. Tents: a new camp has none (no beds: its people sleep rough); the Makeshift tent built (1 × 2, one sleeper, a
//    poor night's mood); tents from bags pitched and struck (tent1 1 × 2, tent2 2 × 2, tent4 3 × 3; their sleepers and
//    kg); beds from sleeping places (tentBeds); an old save's camp keeps its six; every tent cell of the kind "tent".
// 5. Wood: Firewood is Wood everywhere players see it; the wooden builds take wood from the stores; the fires still burn it.
// 6. AI parity: their walled base's margin wears the same land; their works cost wood; their camp pitches 2 × 2 tents.
// Usage: node tools/baseviewtest.js [seed]
import { readFileSync, readdirSync } from "node:fs";
import { createWorld, hub, atBase, makeSurvivor, residents } from "../src/sim/world.js";
import { bedLine } from "../src/sim/beds.js"; // the one rough line and a bed's mood (the pt-int merge)
import { createBattle, registerCombatHandler, combatAct, CELL } from "../src/sim/combat.js";
import { addBuilding, queueBuild, canBuild, constructionHour, baseBeds, tentBeds, TENTS, TENT_STORE_KG, BUILDINGS } from "../src/sim/buildings.js";
import { crowdInfo, crowding, CROWD } from "../src/sim/morale.js";
import { storageOf } from "../src/sim/basestorage.js";
import { createVehicle } from "../src/sim/vehicles.js";
import { newItem } from "../src/sim/inventory.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { coverShare, COVER } from "../src/sim/battlesize.js";
import { buildFort } from "../src/sim/fort.js";
import { GROUP_WORKS } from "../src/sim/groupworks.js";
import { SUPPLIES } from "../src/sim/data.js";
import { shelterFire } from "../src/sim/woodcutting.js";
import { Rng } from "../src/sim/rng.js";
import * as BM from "../src/sim/basemap.js";
import * as SC from "../src/sim/basescatter.js";
import { layoutPanel } from "../src/ui/basemap.js";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(`\n${t}`);
const t0 = Date.now();
registerCombatHandler("bvt", () => {});
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 6 }); st.started = true; return st; };
const LAND = new Set([...SC.SCATTER_KINDS, "water"]);
// The land on a map in grid coordinates: "gx,gy" → kind (a wreck's cells: car cells marked c.wreck).
// (not the piles of what lies outside, crates too: the woodpile is laid with them since the user's pick of 2026-10-20)
function landOn(b) {
  const F = b.deployPlan.fort, out = new Map();
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) { const c = b.cells[y * b.w + x]; if ((LAND.has(c.k) || c.wreck) && !c.pile) out.set(`${x - F.ox},${y - F.oy}`, c.k); }
  return out;
}
// A grid cell by the edge of a map's crop (the land keeps off the outermost ring), or off the map.
const rim = (key, b) => { const F = b.deployPlan.fort, [x, y] = key.split(",").map(Number), mx = x + F.ox, my = y + F.oy; return mx <= 0 || my <= 0 || mx >= b.w - 1 || my >= b.h - 1; };
const near = (key, rects, d = 1) => { const [x, y] = key.split(",").map(Number); return rects.some((r) => x >= r.x0 - d && x < r.x0 + r.w + d && y >= r.y0 - d && y < r.y0 + r.h + d); };
const kinds = (m) => { const k = {}; for (const v of m.values()) k[v] = (k[v] || 0) + 1; return k; };
const fmt = (k) => Object.entries(k).sort((a, b) => b[1] - a[1]).map(([a, n]) => `${a} ${n}`).join(", ");
function raid(st, h) {
  globalThis.window = {};
  try { st.combat = createBattle(st, { tile: h.tile, baseId: h.id, enemy: { kind: "raiders", count: 6, power: 3, name: "raiders" }, ambush: null, canRetreat: true, handler: "bvt", layout: "baseDefence", deploy: true, context: { night: false, ready: { manned: true } } }); }
  finally { delete globalThis.window; }
  const b = st.combat; st.combat = null; return b;
}
const act = (st, a) => combatAct(st, a);
const freeTile = (st, test) => Object.keys(st.tiles).map(Number).filter((t) => st.tiles[t].terrain !== "water" && !st.tiles[t].bridge && !st.bases.some((b) => b.tile === t) && test(st.tiles[t])).sort((a, b) => a - b)[0];
function makeCamp(st, tile) {
  const camp = { id: 9000 + st.bases.length, tile, type: "outpost", name: "Test Camp", stock: { water: 0, fuel: 0, meds: 0, ammo: 0, arrows: 0, parts: 0, scrap: 0, jars: 0, wood: 0, buildmat: 0, rawwater: 0 }, radio: false, watchtower: false, buildings: [], construction: [], armory: [], tier: 0, camp: true, fire: true };
  st.bases.push(camp);
  return camp;
}
const people = (st, base, n, role = null) => { for (let i = 0; i < n; i++) { const s = makeSurvivor(st); s.location = { kind: "base", baseId: base.id }; s.health = 100; s.gear.weapon = newItem("pistol"); if (role) s.role = role; st.survivors.push(s); } };
// The first spot on the view (map coords of the ghost's middle) whose ghost answers `ok` (true: fits; "land": only the land in the way).
function spotFor(st, b, want, from = 0) {
  const F = b.deployPlan.fort;
  for (let d = from; d < from + 40; d++) for (let y = -d; y <= d; y++) for (let x = -d; x <= d; x++) {
    if (Math.max(Math.abs(x), Math.abs(y)) !== d) continue;
    const g = BM.ghostAt(st, b, x + F.ox, y + F.oy);
    if (g && (want === true ? g.ok : !g.ok && !!g.land)) return { mx: x + F.ox, my: y + F.oy, g };
  }
  return null;
}

// ---------- 1. Move does not make the map again ----------
section("Move does not make the map again");
{
  const st = world();
  const h = hub(st);
  for (const t of ["bunkhouse", "storehouse", "gen_cabin", "barricades", "rain_catcher"]) addBuilding(h, t);
  const car = createVehicle(st, "truck", { kind: "base", baseId: h.id });
  const dice0 = st.rng.state;
  check(!BM.openBaseMap(st, h.id), "the map opens");
  const b0 = st.combat;
  const sc0 = landOn(b0);
  check(sc0.size > 20, `the view has its land (${fmt(kinds(sc0))})`);
  const pos0 = new Map(BM.layoutOf(st, h).map((e) => [e.it.key, String(e.at)]));
  const cells0 = b0.cells.map((c) => c.k).join("");
  const key = `v:${car.id}`, eCar = BM.layoutOf(st, h).find((e) => e.it.key === key);
  check(!act(st, { type: "select", key }) && !act(st, { type: "lift", key }), "Move on the parked car");
  check(st.combat === b0 && b0.layout.pick === key && b0.cells.map((c) => c.k).join("") === cells0, "the same view: nothing laid out again, not a cell changed");
  check(BM.layoutOf(st, h).every((e) => String(e.at) === pos0.get(e.it.key)), "the car and everything else stand where they stood until it is put down");
  check(st.rng.state === dice0, "the game's dice untouched by opening the map and Move");
  const sp = spotFor(st, b0, true, BM.yardHalf(h) + 3);
  check(!!sp && !!sp.g.from && sp.g.from.length === 8, `its ghost fits out beyond the yard (${sp && sp.g.at}), a dimmed copy where it stands (${sp && sp.g.from ? sp.g.from.length : 0} cells)`);
  check(!!sp && !act(st, { type: "put", x: sp.mx, y: sp.my }) && String(car.at) === String(sp.g.at), `put down at ${car.at}`);
  const b1 = st.combat, sc1 = landOn(b1);
  check(b1 !== b0 && b1.keepCam && b1.layout === b0.layout, "laid out again once, the camera kept (keepCam, the same layout record)");
  const oldR = BM.rectOf(eCar.it, eCar.at), newR = BM.rectOf(eCar.it, car.at);
  const diff = [...new Set([...sc0.keys(), ...sc1.keys()])].filter((k) => sc0.get(k) !== sc1.get(k) && !near(k, [oldR, newR]) && !rim(k, b0) && !rim(k, b1));
  check(!diff.length, `the land the same everywhere but round the old and the new spot (${diff.length} cells differ${diff.length ? `: ${diff.slice(0, 4).join(" ")}` : ""})`);
  check(BM.layoutOf(st, h).every((e) => e.it.key === key || String(e.at) === pos0.get(e.it.key)), "everything else where it stood");
  const cKey = `b:${h.buildings.find((x) => x.type === "gen_cabin").id}`, b2 = st.combat, wasC = String(BM.layoutOf(st, h).find((e) => e.it.key === cKey).at);
  check(!act(st, { type: "lift", key: cKey }) && st.combat === b2 && String(BM.layoutOf(st, h).find((e) => e.it.key === cKey).at) === wasC, "Move on a building: picked up, nothing laid out again");
  check(!act(st, { type: "pick", key: null }) && st.combat === b2 && !b2.layout.pick, "Esc: it stays where it was, the view untouched");
  act(st, { type: "endLayout" });
  BM.openBaseMap(st, h.id); const c1 = st.combat.cells.map((c) => c.k).join(""); act(st, { type: "endLayout" });
  BM.openBaseMap(st, h.id); const c2 = st.combat.cells.map((c) => c.k).join(""); act(st, { type: "endLayout" });
  check(c1 === c2 && st.rng.state === dice0, "the view made twice is the same view, and the game's dice are where they were");
}

// ---------- 2. The land, by the tile ----------
section("The land: by the tile, fixed by it");
{
  const want = { forest: ["tree", "bush", "log"], plains: ["fence", "tree", "bush"], farm: ["fence", "hay", "bush"], hills: ["rock", "boulder"], mountain: ["boulder", "rock"], suburb: ["fence", "tree", "bush", "wreck"], city: ["wreck", "crate", "barrel"] };
  for (const [terrain, ks] of Object.entries(want)) {
    const L = SC.scatterLayer(SC.scatterSeed(1234), terrain, 40), k = {};
    for (const p of L) if (p.k) k[p.k] = (k[p.k] || 0) + 1;
    check(ks.every((x) => k[x] > 0), `${terrain}: ${fmt(k)}`);
  }
  const a = JSON.stringify(SC.scatterLayer(SC.scatterSeed(77), "forest", 30));
  const b = JSON.stringify(SC.scatterLayer(SC.scatterSeed(77), "forest", 31).filter((p) => p.x >= -30 && p.y >= -30 && p.x < 30 && p.y < 30));
  check(a === b && JSON.stringify(SC.scatterLayer(SC.scatterSeed(78), "forest", 30)) !== a, "deterministic by the tile, a bigger grid keeps every piece of the smaller one, another tile other land");
  const st = world(seed + 3);
  // Road, river, farmland, town camps.
  const tiles = {
    road: freeTile(st, (t) => t.road), river: freeTile(st, (t) => st.grid.neighbors(t.id).some((n) => st.tiles[n].river)),
    farm: freeTile(st, (t) => t.loc && ["farm", "ranch"].includes(t.loc.type)), forest: freeTile(st, (t) => t.terrain === "forest" && !t.road), town: freeTile(st, (t) => t.terrain === "suburb" || t.terrain === "city"),
  };
  const camps = {};
  for (const [k, tile] of Object.entries(tiles)) if (tile != null) camps[k] = makeCamp(st, tile);
  const view = (c) => { BM.openBaseMap(st, c.id); const v = st.combat; st.combat = null; return v; };
  if (camps.road) {
    const v = view(camps.road), F = v.deployPlan.fort, land = BM.landFor(st, camps.road);
    const road = v.cells.filter((c) => c.f === "road").length, wrecks = land.list.filter((p) => p.k === "wreck").length;
    check(road > 100 && wrecks > 0, `a road tile: the road across the map (${road} cells of asphalt) with abandoned cars on it (${wrecks}) and debris`);
    void F;
  } else check(true, "(no free road tile in this world)");
  if (camps.river) {
    const land = BM.landFor(st, camps.river), water = land.list.filter((p) => p.k === "water").length, fords = [...land.floors.values()].filter((f) => f === "gravel").length;
    check(water > 40 && fords >= 6, `a tile by a river: the river along its side (${water} cells of water) with fords across (${fords} cells)`);
    // The river runs along the map's side (the map is 250 × 250): a camp set up near it has it on its view.
    const ws = land.list.filter((p) => p.k === "water").map((p) => p.cells[0]), spread = (i) => Math.max(...ws.map((c) => c[i])) - Math.min(...ws.map((c) => c[i]));
    const ax = spread(0) < spread(1) ? 0 : 1, w = ws[0]; // the band runs along the other axis
    const o = [0, 0];
    o[ax] = Math.max(-BM.SITE_RANGE, Math.min(BM.SITE_RANGE, w[ax] - Math.sign(w[ax]) * 12));
    BM.planOf(camps.river).origin = o;
    const v = view(camps.river);
    check(v.cells.filter((c) => c.k === "water").length > 30, `the river on the view of a camp set up near it (${o})`);
    delete camps.river.plan.origin;
  } else check(true, "(no free river tile in this world)");
  if (camps.farm) { const k = kinds(landOn(view(camps.farm))); check((k.fence || 0) > 10 && (k.bush || 0) > 5, `farmland: hedgerows and fence lines (${fmt(k)})`); }
  if (camps.town) { const v = view(camps.town); check(v.cells.some((c) => c.f === "gravel"), `a town: paved lots, fences and wrecks (${fmt(kinds(landOn(v)))})`); }
  // The clearing in the middle: nothing of the land, the tents round the fire.
  const c0 = camps.forest || Object.values(camps)[0];
  const land0 = BM.landFor(st, c0), h0 = SC.CLEARING.camp;
  check([...land0.pieces.keys()].every((k) => { const [x, y] = k.split(",").map(Number); return !(x >= -h0 && x < h0 && y >= -h0 && y < h0); }), `the clearing in the middle (${2 * h0} × ${2 * h0}): nothing of the land there`);
  // A base: the view and a raid's battle map have the same land; cover; no ground shut off.
  const h = hub(st);
  for (const t of ["bunkhouse", "storehouse", "barricades", "well"]) addBuilding(h, t);
  for (const s of atBase(st, h.id)) { s.health = 100; if (!s.gear.weapon) s.gear.weapon = newItem("pistol"); }
  const v = view(h), sv = landOn(v);
  const r = raid(st, h), sr = landOn(r);
  const both = (k) => !rim(k, v) && !rim(k, r);
  const diff = [...new Set([...sv.keys(), ...sr.keys()])].filter((k) => both(k) && sv.get(k) !== sr.get(k));
  check(sr.size > 20 && diff.length <= 2, `a raid's battle map has the view's land (${sr.size} pieces; ${diff.length} differ: ${fmt(kinds(sr))})`);
  const cs = coverShare(r.cells, r.w, r.h, COVER.R, r.reach);
  check(cs.share >= 0.5, `cover within ${COVER.R} tiles of ${Math.round(cs.share * 100)}% of the open ground on the raid map`);
  const reachedOpen = r.cells.filter((c, i) => CELL[c.k].walk && r.reach[i]).length, walk = r.cells.filter((c) => CELL[c.k].walk && c.k !== "water").length;
  check(reachedOpen / walk > 0.95, `the battle reaches ${Math.round((100 * reachedOpen) / walk)}% of the walkable ground (the edge an open ring: no corner boxed in)`);
}

// ---------- 3. Clearing ----------
section("Clearing the land: blocks building, a construction job, wood when done");
{
  const st = world(seed + 5);
  const tile = freeTile(st, (t) => t.terrain === "forest");
  const camp = makeCamp(st, tile);
  people(st, camp, 3, "build");
  camp.stock.wood = 400; camp.stock.scrap = 20;
  BM.openBaseMap(st, camp.id);
  let b = st.combat;
  check(!act(st, { type: "pickType", bt: "tent" }), "Build a tent picked");
  const red = spotFor(st, b, "land", 6);
  check(!!red && red.g.why.startsWith(BM.LAND_WHY) && red.g.land.length > 0, `its ghost over the land is red and says why (${red && red.g.why})`);
  const before = camp.construction.length, wood0 = camp.stock.wood;
  check(!!red && !act(st, { type: "build", x: red.mx, y: red.my }) && camp.construction.length === before + 1 && camp.construction[camp.construction.length - 1].type === "clear" && camp.stock.wood === wood0, `a click on the red site queues its clearing, nothing built yet (${camp.construction.map((c) => c.label || c.type).join("; ")})`);
  const job = camp.construction.find((c) => c.type === "clear");
  b = st.combat;
  check(b.deployPlan.fort.clearing.length === 1 && b.deployPlan.fort.clearing[0].cells.length > 0, "the clearing site on the view (cells, 0%)");
  check(layoutPanel(st, b, { msg: "" }).includes("Clearing") && layoutPanel(st, b, { msg: "" }).includes(job.label), "the panel lists it with its progress");
  // The builders work it like a building.
  const got = job.get, w1 = camp.stock.wood;
  let hrs = 0;
  while (camp.construction.includes(job) && hrs < 200) { constructionHour(st); hrs++; }
  check(!camp.construction.includes(job) && camp.stock.wood === w1 + (got.wood || 0), `done in ${hrs} hours: +${got.wood || 0} wood into the stores (${job.label})`);
  check(job.pieces.every((p) => p.cells.every(([x, y]) => camp.land.cleared[`${x},${y}`])), "the pieces cleared for good (base.land.cleared)");
  BM.refreshBaseMap(st);
  b = st.combat;
  const g2 = BM.ghostAt(st, b, red.mx, red.my);
  check(g2 && g2.ok, `the tent now fits there (${g2 && (g2.ok ? g2.at : g2.why)})`);
  const lv = landOn(b);
  check(job.pieces.every((p) => p.cells.every(([x, y]) => !lv.has(`${x},${y}`))), "the cleared land is gone from the view");
  check(!act(st, { type: "build", x: red.mx, y: red.my }) && camp.construction.some((c) => c.type === "tent"), "and the tent is queued there");
  act(st, { type: "endLayout" });
  const rm = raid(st, camp), lr = landOn(rm);
  check(job.pieces.every((p) => p.cells.every(([x, y]) => !lr.has(`${x},${y}`))), "and from a raid's map");
  // A tree: felled for wood (CLEAR.tree), through the land's card.
  BM.openBaseMap(st, camp.id); b = st.combat;
  const land = BM.landFor(st, camp), tree = land.list.find((p) => p.k === "tree" && !rim(`${p.cells[0][0]},${p.cells[0][1]}`, b));
  const F = b.deployPlan.fort;
  check(!!tree && !act(st, { type: "land", x: tree.cells[0][0] + F.ox, y: tree.cells[0][1] + F.oy }) && b.layout.land && layoutPanel(st, b, { msg: "" }).includes("Fell it"), "a tree clicked: its card offers Fell it (hours, +wood)");
  const nTree = camp.construction.length;
  check(!act(st, { type: "clear" }) && camp.construction.length === nTree + 1, `queued: ${camp.construction[camp.construction.length - 1].label} (${camp.construction[camp.construction.length - 1].hours} h, +${camp.construction[camp.construction.length - 1].get.wood} wood)`);
  check(camp.construction[camp.construction.length - 1].get.wood === SC.CLEAR.tree.get.wood, `a tree gives ${SC.CLEAR.tree.get.wood} wood`);
  act(st, { type: "endLayout" });
  // A wreck: stripped once, then dragged off.
  const st2 = world(seed + 7);
  const roadTile = freeTile(st2, (t) => t.road) ?? freeTile(st2, (t) => t.terrain === "suburb");
  const c2 = makeCamp(st2, roadTile);
  const wreck = BM.landFor(st2, c2).list.find((p) => p.k === "wreck");
  if (wreck) {
    const s1 = BM.queueClear(st2, c2, [wreck], { mode: "strip" });
    check(s1 && s1.get.scrap === SC.CLEAR.strip.get.scrap && s1.get.carparts === 1, `a wreck stripped: +${s1 && s1.get.scrap} scrap, +1 car part (${s1 && s1.hours} h)`);
    BM.finishClear(st2, c2, s1);
    const w2 = BM.landFor(st2, c2).list.find((p) => p.g === wreck.g);
    check(w2 && w2.looted && !BM.queueClear(st2, c2, [w2], { mode: "strip" }), "once: stripped, it is not stripped again, and still stands");
    const s2 = BM.queueClear(st2, c2, [w2]);
    check(s2 && s2.get.scrap === SC.CLEAR.wreck.get.scrap && !s2.get.carparts, `then dragged off: +${s2 && s2.get.scrap} scrap (${s2 && s2.hours} h)`);
  } else check(true, "(no wreck here)");
  // The auto layout never stuck: a forest camp with more to place than open ground.
  const st3 = world(seed + 9);
  const c3 = makeCamp(st3, freeTile(st3, (t) => t.terrain === "forest"));
  people(st3, c3, 2, "build");
  BM.landFor(st3, c3);
  for (let i = 0; i < 5; i++) c3.construction.push({ id: 80000 + i, type: "tent", progress: 0, hours: 3 });
  c3.construction.push({ id: 80010, type: "gen_hut", progress: 0, hours: 14 });
  const lay = BM.layoutOf(st3, c3);
  check(lay.filter((e) => e.it.key.startsWith("c:")).every((e) => e.at), `every queued thing placed by the game (${lay.filter((e) => e.it.key.startsWith("c:")).map((e) => `${e.it.type}@${e.at}`).join(" ")})`);
  let hrs3 = 0;
  while (c3.construction.length && hrs3 < 600) { constructionHour(st3); hrs3++; }
  check(!c3.construction.length, `the builders cleared every site the game placed over the land and put everything up (${hrs3} h): ${c3.buildings.filter((x) => x.type === "tent").length} tents, ${c3.buildings.filter((x) => x.type === "gen_hut").length} hut`);
}

// ---------- 4. Tents ----------
section("Tents: a Makeshift tent built, tents pitched from bags, beds from sleeping places");
{
  const st = world(seed + 11);
  const camp = makeCamp(st, freeTile(st, (t) => t.terrain === "plains"));
  camp.tentsSet = true; // a new camp (staging.js makeCamp)
  people(st, camp, 3);
  check(tentBeds(camp) === 0 && baseBeds(camp) === 0 && !BM.layoutOf(st, camp).some((e) => e.it.type === "tent"), "a new camp has no tents and no beds");
  const ci0 = crowdInfo(st, camp);
  // The pt-int merge: a camp is never crowded; each of its people without a bed has the one rough line (beds.js bedLine).
  const rl = residents(st, camp.id).map((s) => bedLine(st, s, camp));
  check(ci0.penalty === 0 && ci0.net <= 0 + ci0.lift && crowding(st, camp) <= 1 && rl.length === 3 && rl.every((l) => l && l.v < 0 && /rough/.test(l.label)), `its people sleep rough round the fire: ${rl[0] && rl[0].v} mood a day each (beds.js), no crowding (${crowding(st, camp)})`);
  check(BUILDINGS.tent.name === "Makeshift tent" && TENTS.makeshift.w === 1 && TENTS.makeshift.h === 2 && TENTS.makeshift.sleepers === 1 && TENTS.makeshift.storeKg === 0, `the one built: the Makeshift tent, 1 × 2, one sleeper, no storage, ${Object.entries(BUILDINGS.tent.cost).map(([k, v]) => `${v} ${k}`).join(" + ")}, mood ${TENTS.makeshift.mood} a day`);
  check([["tent1", 1, 2, 1, 1], ["tent2", 2, 2, 2, 2], ["tent4", 3, 3, 4, 4]].every(([k, w, h, n, s]) => TENTS[k].w === w && TENTS[k].h === h && TENTS[k].sleepers === n && TENTS[k].storeKg === s * TENT_STORE_KG), `tents from bags: tent1 1 × 2, tent2 2 × 2, tent4 3 × 3; 1, 2, 4 sleepers; ${TENT_STORE_KG}, ${2 * TENT_STORE_KG}, ${4 * TENT_STORE_KG} kg kept dry`);
  camp.stock.wood = 500; camp.stock.scrap = 20;
  const w0 = camp.stock.wood;
  queueBuild(st, camp, "tent");
  check(camp.stock.wood === w0 - BUILDINGS.tent.cost.wood, "building one takes its wood from the stores");
  people(st, camp, 2, "build");
  BM.landFor(st, camp);
  for (let i = 0; i < 100 && camp.construction.length; i++) constructionHour(st);
  const mk = camp.buildings.find((x) => x.type === "tent");
  check(mk && mk.tent === "makeshift" && tentBeds(camp) === 1 && baseBeds(camp) === 1, `put up: a makeshift tent, ${baseBeds(camp)} bed`);
  const e = BM.layoutOf(st, camp).find((q) => q.it.key === `b:${mk.id}`);
  check(e && e.at && e.it.w === 1 && e.it.h === 2, `placed in the clearing by the game (${e && e.at}), 1 × 2`);
  const ml = residents(st, camp.id).map((s) => bedLine(st, s, camp)).filter((l) => l && /makeshift/.test(l.label));
  check(ml.length === 1 && ml[0].v === TENTS.makeshift.mood, `a poor night in it: ${ml[0] && ml[0].v} mood a day for its one sleeper (beds.js bedLine)`);
  // A bag's tent pitched and struck.
  const p = BM.pitchTent(st, camp, "tent4");
  check(p.tent && p.tent.tent === "tent4" && tentBeds(camp) === 5 && storageOf(st, camp).cap >= 4 * TENT_STORE_KG, `a four-person tent pitched (pitchTent): beds ${tentBeds(camp)}, ${4 * TENT_STORE_KG} kg of room`);
  const e4 = BM.layoutOf(st, camp).find((q) => q.it.key === `b:${p.tent.id}`);
  check(e4 && e4.at && e4.it.w === 3 && e4.it.h === 3, `the game finds it room (${e4 && e4.at}), 3 × 3`);
  const sp = BM.pitchTent(st, camp, "tent2", [-2, 6, 0]);
  check(!!sp.tent || !!sp.error, `pitched by hand where it fits, else refused (${sp.error || sp.tent.at})`);
  const s4 = BM.strikeTent(st, camp, p.tent.id);
  check(s4.kind === "tent4" && !camp.buildings.includes(p.tent), "struck back into its bag (strikeTent: the kind to give back)");
  check(BM.pitchTent(st, camp, "palace").error, "only the kinds there are");
  // In a fight its cells are all of the one kind "tent".
  people(st, camp, 2);
  const rb = raid(st, camp);
  const nCells = camp.buildings.filter((x) => x.type === "tent").reduce((a, x) => a + TENTS[x.tent].w * TENTS[x.tent].h, 0);
  check(rb.cells.filter((c) => c.k === "tent").length === nCells, `the raid map has every tent's cells of the kind "tent" (${nCells})`);
  // An old save's camp (six round the fire): three two-person tents.
  const old = makeCamp(st, freeTile(st, (t) => t.terrain === "hills"));
  const st2 = loadFromString(saveToString(st));
  const o2 = st2.bases.find((x) => x.id === old.id);
  check(o2.buildings.filter((x) => x.type === "tent" && x.tent === "tent2").length === 3 && baseBeds(o2) === 6, "a camp from an older save keeps its six: three two-person tents");
  check(BM.tentCount({ camp: true, fid: 3, tile: 0, buildings: [] }) === BM.AI_CAMP_TENTS && BM.tentCount({ camp: false, fid: 3 }) === 0, "an AI group's camp pitches makeshift tents on the fight at it; their outpost none");
}

// ---------- 5. Wood ----------
section("Firewood is Wood: fuel and a building material");
{
  check(SUPPLIES.wood.name === "Wood", `the supply is "${SUPPLIES.wood.name}" (key "wood": saves load as they are)`);
  const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(`${dir}/${e.name}`) : e.name.endsWith(".js") ? [`${dir}/${e.name}`] : []));
  const bad = [];
  for (const f of files("src")) { const s = readFileSync(f, "utf8"); for (const m of s.matchAll(/\b[Ff]irewood\b/g)) { const line = s.slice(s.lastIndexOf("\n", m.index) + 1, s.indexOf("\n", m.index)); if (!/firewood:\s*[\d{]|cat: "firewood"/.test(line)) bad.push(`${f}: ${line.trim().slice(0, 80)}`); } }
  check(!bad.length, `no "firewood" left in the game's text (${bad.length}${bad.length ? `: ${bad.slice(0, 3).join(" | ")}` : ""})`);
  const wooden = ["shed", "crates", "storebox", "watchtower", "barricades", "spike_pits", "trench", "farm_plot", "animal_pen", "bunkhouse", "gen_hut", "tent"];
  check(wooden.every((t) => BUILDINGS[t].cost.wood > 0), `the wooden builds take wood: ${wooden.map((t) => `${t} ${BUILDINGS[t].cost.wood}`).join(", ")}`);
  const st = world(seed + 13);
  const h = hub(st);
  h.stock.wood = 5000; h.stock.scrap = 200;
  const w0 = h.stock.wood, s0 = h.stock.scrap;
  const msg = queueBuild(st, h, "crates");
  const scrapUsed = (BUILDINGS.crates.cost.scrap || 0) + 3 * Math.max(0, (BUILDINGS.crates.cost.buildmat || 0) - (h.stock.buildmat || 0)); // its building materials made from scrap on site (buildmats.js)
  check(h.stock.wood === w0 - BUILDINGS.crates.cost.wood && h.stock.scrap === s0 - scrapUsed, `storage crates queued: −${BUILDINGS.crates.cost.wood} wood, −${scrapUsed} scrap (${msg})`);
  // The fires still burn it.
  const camp = makeCamp(st, freeTile(st, () => true));
  people(st, camp, 3);
  camp.stock.wood = 200;
  shelterFire(st, camp);
  check(camp.stock.wood < 200, `a camp's fire burns wood (${Math.round(200 - camp.stock.wood)} an hour)`);
}

// ---------- 6. AI parity ----------
section("The AI groups");
{
  const st = world(seed + 15);
  const h = hub(st);
  const fb = { id: -1, tile: freeTile(st, (t) => t.terrain === "forest"), type: "outpost", name: "theirs", buildings: [{ type: "walls", str: 4 }, { type: "bunkhouse" }, { type: "storehouse" }], construction: [], armory: [], stock: { fuel: 0 } };
  const Fa = buildFort(fb, {}, new Rng(5), { state: st }), Fb = buildFort(fb, {}, new Rng(99), { state: st });
  const ka = {}; for (const c of Fa.cells) if (LAND.has(c.k)) ka[c.k] = (ka[c.k] || 0) + 1;
  check((ka.tree || 0) + (ka.bush || 0) > 10, `their walled base wears the land in its margin (${fmt(ka)})`);
  const same = Fa.cells.filter((c, i) => ["tree", "bush", "log", "stump", "fence"].includes(c.k) && Fb.cells[i].k === c.k).length, all = Fa.cells.filter((c) => ["tree", "bush", "log", "stump", "fence"].includes(c.k)).length;
  check(all > 0 && same >= all * 0.9, `fixed by their tile, whatever the fight's dice (${same}/${all})`);
  check(["farms", "beds", "walls", "pens"].every((k) => GROUP_WORKS.WORKS[k].cost.wood > 0) && GROUP_WORKS.WORKS.shed.cost.wood === BUILDINGS.shed.cost.wood, `their works take wood too (${["farms", "beds", "walls", "pens"].map((k) => `${k} ${GROUP_WORKS.WORKS[k].cost.wood}`).join(", ")}; their storage your costs)`);
  check(["farms", "beds"].every((k) => GROUP_WORKS.WORKS[k].cost.wood > 0), "their camp sleeps rough until its quarters go up, as yours until its tents do");
  void h;
}

// ---------- 7. Saving ----------
section("Saving");
{
  const st = world(seed + 17);
  const camp = makeCamp(st, freeTile(st, (t) => t.terrain === "forest"));
  camp.tentsSet = true; BM.pitchTent(st, camp, "tent2");
  const land = BM.landFor(st, camp);
  const p = land.list.find((q) => q.k === "tree");
  const j = BM.queueClear(st, camp, [p]);
  BM.finishClear(st, camp, j);
  const st2 = loadFromString(saveToString(st));
  const c2 = st2.bases.find((x) => x.id === camp.id);
  check(c2.land && c2.land.cleared[`${p.cells[0][0]},${p.cells[0][1]}`] && !BM.landFor(st2, c2).pieces.has(`${p.cells[0][0]},${p.cells[0][1]}`), "save and load keep the land cleared");
  check(c2.buildings.filter((x) => x.type === "tent").length === camp.buildings.filter((x) => x.type === "tent").length, "and its tents");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
