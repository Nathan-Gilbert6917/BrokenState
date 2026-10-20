// Base storage limits on the base map (2026-10-19, the user's request: "You can also leave things out not in
// containers but if they are outside the durability decays and easier for raiders to steal. Camps start with no
// storage but using a vehicle you can use the storage of the truck as a storage unit until better storage is made ...
// You can move your vehicle to any unoccupied tiles of the base view which it can fit."). The raid map's side
// (sim/basemap.js, ui/basemap.js):
//   - the footprints of the storage box, the storage shed and the warehouse; the auto layout places them, the battle
//     map lays them as stores with their room, and the isometric view draws them;
//   - a camp with goods past its room: a pile in the yard near the middle (crates on open ground, never on a
//     footprint, a doorway or the band, walkable all round) holding exactly what storageOf says lies outside, the
//     parked pickup a container holding the rest, every unit and item accounted for;
//   - a raider goes for the pile first and grabs twice as much a turn from it as from the car;
//   - what got away leaves the right places in the base's stock and armory (a pile's item by its armory index);
//   - a parked car placed by hand on free cells beyond the wall, refused on the band and on another footprint, moved
//     in the Base map view (picked, put, lifted, put again), an Army truck 5 cells long; the Move button's markup.
// Usage: node tools/basestoragemaptest.js [seed]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { createBattle, registerCombatHandler, combatAct, CELL, unitAt, nearRect } from "../src/sim/combat.js";
import { addBuilding, STORE_KG } from "../src/sim/buildings.js";
import { newItem } from "../src/sim/inventory.js";
import { createVehicle, carsAtBase } from "../src/sim/vehicles.js";
import { storageOf } from "../src/sim/basestorage.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import * as BM from "../src/sim/basemap.js";

const SEED = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return !!ok; };
const section = (t) => console.log(`\n${t}`);
const t0 = Date.now();
registerCombatHandler("bsm", () => {});

// The isometric view on stub canvases (as tools/battleviewtest.js): drawing a battle must not throw.
const ctx = () => new Proxy({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), measureText: (t) => ({ width: String(t).length * 6 }), getLineDash: () => [] }, { get: (o, k) => (k in o ? o[k] : () => {}), set: () => true });
const cvs = (w, h) => ({ width: w, height: h, getContext: () => ctx(), toDataURL: () => "data:," });
globalThis.document = { createElement: () => cvs(0, 0), getElementById: () => null };
globalThis.window = { addEventListener() {}, devicePixelRatio: 1 };
const ISO = await import("../src/ui/isoview.js");
const UIC = await import("../src/ui/combat.js");
const UBM = await import("../src/ui/basemap.js");
ISO.setIsoCanvas(cvs);
UIC.initCombatUI({ clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => ctx() });
let clock = 1e6;
const draw = (st) => { try { clock += 50; UIC.drawCombat(st, clock); return ""; } catch (e) { return e.stack.split("\n").slice(0, 3).join(" "); } };

const world = () => { const st = createWorld({ seed: SEED, factionCount: 6 }); st.started = true; st.visitorsOff = true; st.landOff = true; return st; }; // landOff: the land (basescatter.js) is tools/baseviewtest.js's
const asCamp = (b) => { b.tier = 0; b.camp = true; b.buildings = []; b.construction = []; };
function raid(st, h, count = 8) {
  for (const s of atBase(st, h.id)) { s.health = 100; s.gear.weapon = newItem("knife"); }
  st.combat = createBattle(st, { tile: h.tile, baseId: h.id, enemy: { kind: "raiders", count, power: 3, name: "raiders" }, ambush: null, canRetreat: true, handler: "bsm", layout: "baseDefence", deploy: true, downedLive: 0.4, context: { night: false, ready: { manned: true } } });
  return st.combat;
}
const sumSup = (list) => { const o = {}; for (const c of list) for (const [k, n] of Object.entries(c.sup)) o[k] = (o[k] || 0) + n; return o; };
const sameSup = (a, b) => { const ks = new Set([...Object.keys(a), ...Object.keys(b)]); return [...ks].every((k) => (a[k] || 0) === (b[k] || 0)); };
// A walkable, empty cell next to a container (not on it).
function besideOf(b, c) {
  for (let y = c.y - 1; y <= c.y + c.h; y++) for (let x = c.x - 1; x <= c.x + c.w; x++) {
    if (x < 0 || y < 0 || x >= b.w || y >= b.h || (x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h)) continue;
    if (CELL[b.cells[y * b.w + x].k].walk && !unitAt(b, x, y)) return [x, y];
  }
  return null;
}
const freshThief = (b, at) => { const t = b.units.find((u) => u.side === "enemy" && !u.loot && !u.dead); t.thief = true; t.loot = null; t.x = at[0]; t.y = at[1]; t.aware = true; t.ap = 2; return t; };

// ======================================================================
section("The storage buildings on the map");
{
  const st = world(), h = hub(st);
  check(BM.FOOT.storebox && BM.FOOT.storebox.kind === "prop" && BM.FOOT.storebox.k === "crate" && BM.FOOT.storebox.w === 1 && BM.FOOT.storebox.h === 1, "a storage box: a crate, 1 × 1");
  check(BM.FOOT.shed && BM.FOOT.shed.kind === "roof" && BM.FOOT.shed.w === 3 && BM.FOOT.shed.h === 2, "a storage shed: a flat-roofed block, 3 × 2");
  check(BM.FOOT.warehouse && BM.FOOT.warehouse.kind === "roof" && BM.FOOT.warehouse.w === 6 && BM.FOOT.warehouse.h === 4, "a warehouse: a flat-roofed block, 6 × 4");
  for (const t of ["storebox", "storebox", "shed", "warehouse", "bunkhouse"]) addBuilding(h, t);
  const lay = BM.layoutOf(st, h);
  const mine = lay.filter((e) => ["storebox", "shed", "warehouse"].includes(e.it.type));
  check(mine.length === 4 && mine.every((e) => e.at), `the auto layout places all four (${mine.map((e) => `${e.it.label} at ${e.at}`).join("; ")})`);
  const b = raid(st, h);
  const F = b.deployPlan.fort;
  const byType = (t) => F.buildings.filter((x) => x.type === t);
  check(byType("shed").length === 1 && byType("shed")[0].roof && byType("warehouse").length === 1 && byType("warehouse")[0].w * byType("warehouse")[0].h === 24, "the shed and the warehouse stand on the raid map as roofed blocks");
  const stores = b.stores.containers;
  const roomOf = (t) => stores.filter((c) => c.bid != null && (h.buildings.find((x) => x.id === c.bid) || {}).type === t).map((c) => c.room);
  check(roomOf("storebox").length === 2 && roomOf("storebox").every((r) => r === STORE_KG.storebox) && roomOf("shed")[0] === STORE_KG.shed && roomOf("warehouse")[0] === STORE_KG.warehouse, `they are stores with their room (box ${roomOf("storebox").join(", ")}, shed ${roomOf("shed")}, warehouse ${roomOf("warehouse")} kg)`);
  const boxStore = stores.find((c) => c.bid != null && (h.buildings.find((x) => x.id === c.bid) || {}).type === "storebox");
  check(boxStore && b.cells[boxStore.y * b.w + boxStore.x].k === "crate", "a storage box is a crate on the map");
  const wh = stores.find((c) => c.bid != null && (h.buildings.find((x) => x.id === c.bid) || {}).type === "warehouse");
  check(wh && stores.every((c) => c === wh || c.pile || c.kg <= wh.kg + 1e-9 || c.room >= wh.room), `the goods go by room: the warehouse holds the most (${Math.round(wh ? wh.kg : 0)} kg)`);
  const err = draw(st);
  check(!err, `the isometric view draws the raid map${err ? `: ${err}` : ""}`);
  st.combat = null;
  check(!BM.openBaseMap(st, h.id) && st.combat && st.combat.layout, "the Base map view opens");
  const err2 = draw(st);
  check(!err2, `and draws${err2 ? `: ${err2}` : ""}`);
  st.combat = null;
}

// ======================================================================
section("A camp with goods past its room: the pile and the pickup");
let campSt = null, campH = null, campB = null, campSt0 = null;
{
  const st = world(), h = hub(st);
  asCamp(h);
  h.stock.scrap = 300; h.stock.buildmat = 40;
  h.armory.push(newItem("sandbags"), newItem("pistol"), newItem("boards"), newItem("boards"), newItem("knife"));
  const truck = carsAtBase(st, h.id)[0];
  const S = storageOf(st, h);
  check(S.cap === 650 && S.containers.length === 1 && S.containers[0].key === `v:${truck.id}` && S.outsideKg > 0 && S.outside.gear.length >= 1, `the camp's only room is the pickup (650 kg); ${S.outsideKg} kg lies outside (${Object.keys(S.outside.sup).join(", ")} and ${S.outside.gear.length} item(s))`);
  const want = BM.outsideOf(st, h);
  const b = raid(st, h);
  const F = b.deployPlan.fort, C = BM.yardHalf(h);
  const piles = b.stores.containers.filter((c) => c.pile);
  const car = b.stores.containers.find((c) => c.vid === truck.id);
  check(piles.length >= 1 && piles.every((p) => p.label.startsWith(BM.PILE.LABEL)), `${piles.length} pile(s) on the map: ${piles.map((p) => `${p.label} ${Math.round(p.kg)} kg`).join(", ")}`);
  check(sameSup(sumSup(piles), want.sup), `the piles hold exactly the supplies lying outside (${JSON.stringify(sumSup(piles))})`);
  const pileGear = piles.flatMap((p) => p.gear.map((g) => g.ai)).sort((a, c) => a - c);
  check(JSON.stringify(pileGear) === JSON.stringify(S.outside.gear) && piles.flatMap((p) => p.gear).every((g) => h.armory[g.ai] && h.armory[g.ai].key === g.key), `and exactly the items lying outside (armory ${pileGear.join(", ")}: ${pileGear.map((i) => h.armory[i].name).join(", ")})`);
  check(!!car && car.room === 650 && car.kg > 0 && F.vehicles.some((v) => v.id === truck.id && v.x0 === car.x && v.y0 === car.y && v.w === car.w && v.h === car.h), `the pickup is a container on its own cells, holding ${Math.round(car ? car.kg : 0)} kg`);
  const all = sumSup(b.stores.containers);
  check(Object.entries(h.stock).every(([k, q]) => (all[k] || 0) === Math.floor(q || 0)), "every unit of the stock is in a container or on a pile");
  check(b.stores.containers.reduce((a, c) => a + c.gear.length, 0) === h.armory.length && !piles.some((p) => p.gear.some((g) => car.gear.some((x) => x.ai === g.ai))), `every armory item once (${h.armory.length})`);
  const inside = (x, y) => x >= 0 && y >= 0 && x < b.w && y < b.h;
  const occ = BM.occupancy(st, h, null, BM.autoLayout(st, h));
  let onFoot = false, onBand = false, blocked = false, kinds = true;
  for (const p of piles) {
    for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) {
      const gx = x - F.ox, gy = y - F.oy, k = (gy + 2048) * 4096 + (gx + 2048);
      if (occ.foot.has(k) || occ.door.has(k)) onFoot = true;
      if (!(gx >= -C && gx < C && gy >= -C && gy < C)) onBand = true;
      if (b.cells[y * b.w + x].k !== "crate") kinds = false;
    }
    for (let y = p.y - 1; y <= p.y + p.h; y++) for (let x = p.x - 1; x <= p.x + p.w; x++) if (inside(x, y) && !(x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h) && !CELL[b.cells[y * b.w + x].k].walk) blocked = true;
  }
  check(kinds && !onFoot && !onBand, "the piles are crates in the yard, on no footprint, doorway or band");
  check(!blocked, "open ground all round every pile (no door, nothing to batter)");
  const near = piles.every((p) => Math.max(Math.abs(p.x - F.ox), Math.abs(p.y - F.oy)) <= C);
  check(near, `near the middle (${piles.map((p) => `${p.x - F.ox}, ${p.y - F.oy}`).join("; ")})`);
  // Deterministic and plain data.
  const st2 = world(), h2 = hub(st2);
  asCamp(h2); h2.stock.scrap = 300; h2.stock.buildmat = 40;
  h2.armory.push(newItem("sandbags"), newItem("pistol"), newItem("boards"), newItem("boards"), newItem("knife"));
  const b2 = raid(st2, h2);
  check(JSON.stringify(b2.stores.containers.map((c) => [c.label, c.x, c.y, c.sup, c.gear.map((g) => g.ai)])) === JSON.stringify(b.stores.containers.map((c) => [c.label, c.x, c.y, c.sup, c.gear.map((g) => g.ai)])), "the same camp twice: the same piles holding the same goods");
  st2.combat = null;
  const sv = loadFromString(saveToString(st));
  check(sv.combat && sv.combat.stores && sv.combat.stores.containers.filter((c) => c.pile).length === piles.length, "saved and loaded mid-battle with its piles");
  // The UI: the pile's card and the hint.
  const pileHtml = UBM.storesHtml(b, { storeView: piles[0].id });
  check(pileHtml.includes("Left outside (weathering, easy to steal)"), "the store card shows a pile as Left outside (weathering, easy to steal)");
  check(UBM.storeHover(piles[0]).includes("Left outside"), "and its hover line");
  check(/piles of crates/.test(UBM.baseMapTab(st, h, {})) && /parked car/.test(UBM.baseMapTab(st, h, {})), "the Base map tab's hint tells of the piles outside and the cars' storage");
  campSt = st; campH = h; campB = b; campSt0 = { stock: { ...h.stock }, armory: h.armory.slice() };
}

// ======================================================================
section("Raiders go for the pile first and grab twice as much from it");
{
  const st = campSt, h = campH, b = campB;
  for (const u of b.units) if (u.side === "player") { u.x = 0; u.y = 0; }
  b.tier.stage = "yard";
  const piles = b.stores.containers.filter((c) => c.pile);
  const car = b.stores.containers.find((c) => c.vid != null);
  // A raider nearer the car than any pile, next to no container: it walks past the car to the pile.
  const dist = (c, x, y) => Math.max(c.x - x, x - (c.x + c.w - 1), c.y - y, y - (c.y + c.h - 1), 0);
  let start = null;
  for (let y = 1; y < b.h - 1 && !start; y++) for (let x = 1; x < b.w - 1 && !start; x++) {
    if (!CELL[b.cells[y * b.w + x].k].walk || unitAt(b, x, y) || b.stores.containers.some((c) => nearRect(c, x, y))) continue;
    const dc = dist(car, x, y), dp = Math.min(...piles.map((p) => dist(p, x, y)));
    if (dc >= 2 && dc <= 4 && dp > dc + 2) start = [x, y];
  }
  check(!!start, `a raider put down nearer the pickup than the pile (${start})`);
  const t = freshThief(b, start);
  const kg0 = b.stores.containers.map((c) => c.kg);
  let first = null;
  for (let i = 0; i < 40 && !first && !t.dead; i++) {
    t.ap = 2;
    BM.thiefTurn(b, t);
    const j = b.stores.containers.findIndex((c, k) => c.kg < kg0[k] - 1e-9);
    if (j >= 0) first = b.stores.containers[j];
  }
  check(!!first && first.pile, `it took from ${first ? `the ${first.label.toLowerCase()}` : "nothing"} first`);
  check(t.loot && t.loot.kg > BM.STEAL.TURN && t.loot.kg <= BM.STEAL.KG, `a full ${Math.round(t.loot ? t.loot.kg : 0)} kg from the pile in one turn (more than the ${BM.STEAL.TURN} kg a turn from a container)`);
  // Side by side: one turn at the pile against one turn at the car.
  const p2 = piles.find((p) => p.kg > BM.STEAL.KG) || piles[0];
  const a = freshThief(b, besideOf(b, p2));
  BM.takeLoot(b, a, p2);
  const c2 = freshThief(b, besideOf(b, car));
  BM.takeLoot(b, c2, car);
  check(a.loot.kg > 0 && c2.loot.kg > 0 && c2.loot.kg <= BM.STEAL.TURN + 1e-9 && a.loot.kg >= 1.5 * c2.loot.kg, `twice as much a turn from a pile: ${Math.round(a.loot.kg * 10) / 10} kg against ${Math.round(c2.loot.kg * 10) / 10} kg from the pickup`);

  // What got away leaves the right places.
  const pileItem = piles.flatMap((p) => p.gear)[0];
  if (pileItem && !t.loot.gear.some((g) => g.ai === pileItem.ai) && !a.loot.gear.some((g) => g.ai === pileItem.ai)) { // make sure a pile's item is in the loot
    for (const p of piles) { const i = p.gear.indexOf(pileItem); if (i >= 0) p.gear.splice(i, 1); }
    a.loot.gear.push(pileItem); a.loot.kg += pileItem.kg;
  }
  const stolenItems = [...t.loot.gear, ...a.loot.gear, ...c2.loot.gear].map((g) => campSt0.armory[g.ai]);
  t.fled = true; a.fled = true; c2.fled = true;
  BM.settleBaseBattle(st, b);
  const lootSup = sumSup([t.loot, a.loot, c2.loot]);
  check(!!b.stolen && sameSup(b.stolen.sup, lootSup), `the raiders got away with ${Math.round(b.stolen ? b.stolen.kg : 0)} kg`);
  const res = BM.applyStolen(st, h, b.stolen);
  check(!!res && Object.entries(lootSup).every(([k, n]) => Math.floor(campSt0.stock[k]) - Math.floor(h.stock[k]) === n), `the stock loses exactly what they carried (${res ? res.text : "nothing"})`);
  check(stolenItems.length >= 1 && stolenItems.every((it) => it && !h.armory.includes(it)) && h.armory.length === campSt0.armory.length - stolenItems.length && campSt0.armory.filter((it) => !stolenItems.includes(it)).every((it) => h.armory.includes(it)), `the armory loses exactly the items taken (${stolenItems.map((it) => it.name).join(", ")}), the pile's by its armory index`);
  st.combat = null;
  // An item moved in the armory during the fight is still found by its key.
  const arm = [newItem("pistol"), newItem("sandbags")];
  const base2 = { stock: {}, armory: [arm[1], arm[0]] };
  const r2 = BM.applyStolen(st, base2, { sup: {}, gear: [{ ai: 1, key: "sandbags", name: arm[1].name, kg: 1 }], kg: 1 });
  check(r2 && base2.armory.length === 1 && base2.armory[0] === arm[0], "an item that moved in the armory is taken by its key, not whatever is at its old index");
}

// ======================================================================
section("Moving a parked car anywhere it fits");
{
  const st = world(), h = hub(st);
  addBuilding(h, "bunkhouse");
  const truck = carsAtBase(st, h.id)[0];
  const key = `v:${truck.id}`;
  const C = BM.yardHalf(h), G = BM.gridHalf(h);
  const it = BM.itemByKey(st, h, key);
  check(it && it.kind === "vehicle" && it.w === 4 && it.h === 2, `the pickup on the map: ${it.w} × ${it.h}`);
  check(BM.placeItem(st, h, key, C, 0, 0) === "That is where the wall stands", "refused on the band");
  const bunk = BM.itemsOf(st, h).find((x) => x.type === "bunkhouse");
  check(!BM.placeItem(st, h, bunk.key, 10, 10, 0), "a bunkhouse placed by hand at 10, 10");
  check(BM.placeItem(st, h, key, 11, 11, 0).startsWith("On top of"), `refused on the bunkhouse (${BM.placeItem(st, h, key, 11, 11, 0)})`);
  check(BM.placeItem(st, h, key, 12, 14, 0).startsWith("In the doorway"), `refused in its doorway (${BM.placeItem(st, h, key, 12, 14, 0)})`);
  const out = [C + 6, -3];
  check(!BM.placeItem(st, h, key, out[0], out[1], 1) && truck.at && truck.at.join() === `${out[0]},${out[1]},1`, `placed on free ground beyond the wall at ${truck.at}, turned`);
  const b = raid(st, h);
  const F = b.deployPlan.fort;
  const v = F.vehicles.find((x) => x.id === truck.id);
  check(v && v.x0 === out[0] + F.ox && v.y0 === out[1] + F.oy && v.w === 2 && v.h === 4, `the raid map has it there (${v ? `${v.x0 - F.ox}, ${v.y0 - F.oy}, ${v.w} × ${v.h}` : "nowhere"})`);
  const cont = b.stores.containers.find((c) => c.vid === truck.id);
  check(cont && cont.x === v.x0 && cont.y === v.y0, "and it is a store where it stands");
  check(BM.layoutOf(st, h).every((e) => e.it.key === key || !e.at || (() => { const r = BM.rectOf(e.it, e.at); return r.x0 + r.w <= out[0] || r.x0 >= out[0] + 2 || r.y0 + r.h <= out[1] || r.y0 >= out[1] + 4; })()), "the game places nothing on top of it");
  st.combat = null;
  // The Base map view: the Move button's markup, the map opened with the car picked, put down, lifted, put again.
  const btn = UBM.moveCarButton(st, h, truck);
  check(btn === `<button class="mini" data-action="bm-open" data-base="${h.id}" data-key="${key}" data-tab="vehicles" data-tip="Move it on the base map: click any free cells it fits, in the yard or beyond the wall (R turns it)">Move</button>`, "the Move button's markup");
  const ui = {};
  UBM.BASEMAP_ACTIONS["bm-open"](st, ui, { base: String(h.id), key, tab: "vehicles" });
  check(st.combat && st.combat.layout && st.combat.layout.pick === key && ui.mapFrom && ui.mapFrom.tab === "vehicles", "bm-open opens the map with the car picked (and comes back to the Vehicles tab)");
  let bv = st.combat, Fv = bv.deployPlan.fort;
  const spot = [-C - 8, 5]; // west of the wall, upright: a 2 × 4 footprint
  combatAct(st, { type: "rotate" });
  const r = st.combat.layout.rot;
  const [w, hh] = BM.dimsOf(it, r);
  const cx = spot[0] + Math.floor(w / 2) + Fv.ox, cy = spot[1] + Math.floor(hh / 2) + Fv.oy;
  const g = BM.ghostAt(st, bv, cx, cy);
  check(g && g.ok && g.at[0] === spot[0] && g.at[1] === spot[1], `its outline fits beyond the west wall (${g ? (g.ok ? g.at : g.why) : "none"})`);
  check(!combatAct(st, { type: "put", x: cx, y: cy }) && truck.at && truck.at[0] === spot[0] && truck.at[1] === spot[1], `put down there (${truck.at})`);
  bv = st.combat; Fv = bv.deployPlan.fort;
  const vv = Fv.vehicles.find((x) => x.id === truck.id);
  check(vv && vv.x0 - Fv.ox === spot[0] && vv.y0 - Fv.oy === spot[1], "the view has it there");
  const lv = st.combat;
  check(!combatAct(st, { type: "lift", key }) && st.combat.layout.pick === key && truck.at && truck.at[0] === spot[0] && truck.at[1] === spot[1] && st.combat === lv, "Move picks it up again: it stays where it stands until put down, the map is not made again");
  bv = st.combat; Fv = bv.deployPlan.fort;
  const onBunk = [10 + 1 + Fv.ox, 10 + 1 + Fv.oy];
  const gb = BM.ghostAt(st, bv, ...onBunk);
  check(gb && !gb.ok && /On top of|doorway/.test(gb.why), `its outline is red over the bunkhouse (${gb && gb.why})`);
  check(!!combatAct(st, { type: "put", x: onBunk[0], y: onBunk[1] }) && truck.at && truck.at[0] === spot[0], "and the put is refused there (it stays where it stood)");
  combatAct(st, { type: "endLayout" });
  check(!st.combat, "the map closed");
  // An Army truck: 5 cells long on the map, drawn as the Army's.
  const mil = createVehicle(st, "miltruck", { kind: "base", baseId: h.id });
  const mi = BM.itemByKey(st, h, `v:${mil.id}`);
  check(mi && mi.w === 5 && mi.h === 2, `an Army truck on the map: ${mi && mi.w} × ${mi && mi.h}`);
  check(!BM.placeItem(st, h, mi.key, C + 6, 8, 0), "placed beyond the wall");
  const b3 = raid(st, h);
  const mv = b3.deployPlan.fort.vehicles.find((x) => x.id === mil.id);
  const mc = mv && b3.cells[mv.y0 * b3.w + mv.x0];
  check(mv && mv.w === 5 && mv.h === 2 && mc && mc.car && mc.car.body === "m35", `the raid map lays it 5 × 2, drawn as an Army truck (${mc && mc.car ? mc.car.body : "?"})`);
  const cm = b3.stores.containers.find((c) => c.vid === mil.id);
  check(cm && cm.room === 2500, "its 2500 kg load space a store");
  const err = draw(st);
  check(!err, `the isometric view draws it${err ? `: ${err}` : ""}`);
  st.combat = null;
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
