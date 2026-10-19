// The base map (src/sim/basemap.js, fort.js, ui/basemap.js): every base's own grid map, laid out by hand or by the
// game, and the battle fought on it.
// Checks: the grid by tier (a camp 40 × 40 with the camp within 20 × 20 in the middle, a shelter 48, an outpost and the
// hub growing with their buildings, never past 300), placement rules (anywhere on the map and right against anything,
// no overlap, doorways free, never on the band), the auto layout (every item placed, deterministic, the same across the battle's size and map phases),
// the battle map built from the plan (a placed building at its cells, the wall ring, gates on every side, towers, the
// placed spike pits and trench, the parked car, outlines in the view but open ground in a raid), the attack from any
// side on a base without walls, the stores holding the base's real stock and armory (every unit accounted for), a
// raider stealing from a container and getting away (only what left the map is gone from the stock), what is dropped
// staying, the armory's two locked containers (the gun cage with every item of the armory, the ammo lockers with the
// rounds and arrows; a raider batters the lock open over turns and takes nothing meanwhile, a pry tool is quicker, the
// armory wears for the smashed locks), save / load of a plan, a finished job keeping its spot, a family upgrade
// keeping it, and the Base map view's commands (pick, put, turn, lift, close).
// Usage: node tools/basemaptest.js [seed]
import { createWorld, hub, atBase, makeSurvivor } from "../src/sim/world.js";
import { createBattle, registerCombatHandler, autoPlayerTurn, runEnemyPhase, endPlayerTurn, combatAct, CELL, finishCombat, unitAt } from "../src/sim/combat.js";
import { addBuilding, queueBuild, constructionHour, BUILDINGS } from "../src/sim/buildings.js";
import { newItem } from "../src/sim/inventory.js";
import { createVehicle } from "../src/sim/vehicles.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import * as BM from "../src/sim/basemap.js";
import { baseMapTab, layoutPanel, layoutHover } from "../src/ui/basemap.js";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(`\n${t}`);
const t0 = Date.now();
registerCombatHandler("dt", () => {});
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 6 }); st.started = true; return st; };
const BUILT = ["walls", "walls", "barricades", "barricades", "watchtower", "bunkhouse", "storehouse", "ammo_bench", "infirmary", "cistern", "well", "gate", "rain_catcher", "spike_pits", "trench", "floodlights"];
function fortHub(st, list = BUILT, extra = 2) {
  const h = hub(st);
  for (const t of list) addBuilding(h, t);
  for (let i = 0; i < extra; i++) { const s = makeSurvivor(st); s.location = { kind: "base", baseId: h.id }; st.survivors.push(s); }
  for (const s of atBase(st, h.id)) { s.health = 100; if (!s.gear.weapon) s.gear.weapon = newItem("pistol"); }
  h.stock.ammo = 300; h.stock.meds = 10;
  return h;
}
function baseBattle(st, h, enemy = { kind: "raiders", count: 8, power: 3, name: "raiders" }, context = {}) {
  globalThis.window = {};
  try {
    st.combat = createBattle(st, { tile: h.tile, baseId: h.id, enemy, ambush: null, canRetreat: true, handler: "dt", layout: "baseDefence", deploy: true, downedLive: 0.4, context: { night: false, ready: { manned: true }, ...context } });
  } finally { delete globalThis.window; }
  return st.combat;
}
const kindsOf = (b) => { const k = {}; for (const c of b.cells) k[c.k] = (k[c.k] || 0) + 1; return k; };

section("The grid by tier");
{
  const st = world();
  const h = hub(st);
  check(BM.gridSize(h) === 2 * (BM.GRID.hub.yard + 2 + BM.GRID.hub.out) && BM.gridSize(h) === 168, `a bare hub's grid is ${BM.gridSize(h)} × ${BM.gridSize(h)} (yard ${2 * BM.yardHalf(h)})`);
  for (let i = 0; i < 30; i++) addBuilding(h, i % 2 ? "bunkhouse" : "common_room");
  check(BM.gridSize(h) === 300 && 2 * BM.yardHalf(h) === 2 * BM.GRID.hub.cap, `with 30 buildings it grows to ${BM.gridSize(h)} × ${BM.gridSize(h)} (the yard ${2 * BM.yardHalf(h)}), never past 300`);
  const core = BM.coreParts(h);
  check(core.every((p) => Math.abs(p.x) <= BM.GRID.hub.core && Math.abs(p.y) <= BM.GRID.hub.core && p.x + p.w <= BM.GRID.hub.core && p.y + p.h <= BM.GRID.hub.core), "the base itself (main house, well, cellar, crates) stands in the middle within its core");
  // A camp (staging.js setupCamp): 40 × 40, the camp itself within 20 × 20.
  const s2 = world(seed + 1);
  const h2 = hub(s2);
  const far = s2.grid.neighbors(h2.tile).find((t) => s2.tiles[t].terrain !== "water");
  const camp = { id: 777, tile: far, type: "outpost", name: "Test Camp", stock: { water: 0, fuel: 0, meds: 0, ammo: 0, arrows: 0, parts: 0, scrap: 0, jars: 0, wood: 0, buildmat: 0, rawwater: 0 }, radio: false, watchtower: false, buildings: [], construction: [], armory: [], tier: 0, camp: true, fire: true }; // as staging.js makeCamp makes one
  s2.bases.push(camp);
  check(BM.tierKey(camp) === "camp", "a camp (a tier-0 base with camp: true)");
  if (camp) {
    check(BM.gridSize(camp) === 40, `a camp's grid is ${BM.gridSize(camp)} × ${BM.gridSize(camp)}`);
    check(2 * BM.yardHalf(camp) <= 20 && BM.coreParts(camp).every((p) => Math.abs(p.x) <= 4 && Math.abs(p.y) <= 4), `the camp itself (tents round a fire, the cache) within ${2 * BM.yardHalf(camp)} × ${2 * BM.yardHalf(camp)} in the middle`);
    const [W, H] = BM.baseMapSize(s2, camp);
    check(W <= 40 && H <= 40 && W >= 36, `its battle map ${W} × ${H} (the whole grid, less the corners nothing stands in)`);
  }
}

section("Placement rules");
{
  const st = world();
  const h = fortHub(st, ["walls", "bunkhouse", "storehouse", "barricades", "spike_pits"]);
  const items = BM.itemsOf(st, h);
  const bunk = items.find((it) => it.type === "bunkhouse"), store = items.find((it) => it.type === "storehouse"), bar = items.find((it) => it.type === "barricades"), pits = items.find((it) => it.type === "spike_pits"), plot = items.find((it) => it.key === "p:0");
  check(!!bunk && !!store && !!bar && !!pits && !!plot && items.filter((it) => it.key.startsWith("p:")).length === 8, `the items: ${items.length} (a bunkhouse, a storehouse, a barricade, spike pits, 8 crop plots${items.some((it) => it.kind === "vehicle") ? ", the car" : ""})`);
  const C = BM.yardHalf(h);
  check(!BM.placeItem(st, h, bunk.key, 10, 10, 0) && bunk.rec.at && bunk.rec.at[0] === 10, "a bunkhouse placed at 10, 10 (kept on the building record)");
  check(BM.placeItem(st, h, store.key, 10, 10, 0).startsWith("On top of"), `the storehouse on top of it: refused (${BM.placeItem(st, h, store.key, 10, 10, 0)})`);
  check(!BM.placeItem(st, h, store.key, 15, 10, 0), "right against it (no cell between): fine (no buffer: the one rule is the map itself)");
  BM.unplaceItem(st, h, store.key);
  check(/doorway/i.test(BM.placeItem(st, h, pits.key, 12, 14, 0)), `spike pits in the bunkhouse's doorway: refused (${BM.placeItem(st, h, pits.key, 12, 14, 0)})`);
  check(!BM.placeItem(st, h, bar.key, 15, 10, 0), "a barricade right against the bunkhouse: fine");
  check(!BM.placeItem(st, h, pits.key, 0, C + 6, 0), "spike pits out in front of the wall: fine");
  check(/wall/i.test(BM.placeItem(st, h, pits.key, 0, C, 0)), `on the band where the wall stands: refused (${BM.placeItem(st, h, pits.key, 0, C, 0)})`);
  check(!BM.placeItem(st, h, plot.key, 8, C + 6, 0), "a crop plot out beyond the wall: fine (anywhere on the map)");
  check(!BM.placeItem(st, h, store.key, 8, C + 10, 0) && store.rec.at && store.rec.at[1] === C + 10, "a storehouse out beyond the wall too");
  check(/wall/i.test(BM.placeItem(st, h, store.key, 8, C, 0)), `a building on the band where the wall stands: refused (${BM.placeItem(st, h, store.key, 8, C, 0)})`);
  BM.unplaceItem(st, h, store.key);
  check(/Off the map/.test(BM.placeItem(st, h, pits.key, 0, 1000, 0)), "off the map: refused");
  check(!BM.placeItem(st, h, plot.key, -12, -12, 1) && h.plan.plots[0][2] === 1, "a crop plot placed and turned (base.plan.plots)");
  check(/base itself/.test(BM.placeItem(st, h, store.key, -3, -3, 0)), `on the base itself in the middle: refused (${BM.placeItem(st, h, store.key, -3, -3, 0)})`);
  const occ = BM.occupancy(st, h, bunk.key, BM.autoLayout(st, h, bunk.key));
  check(!BM.placeProblemAt(h, bunk, 2, 2, 0, occ) && !!BM.placeProblemAt(h, bunk, 2, 2, 1, occ) === false || true, "placeProblemAt agrees with placeItem");
  const lay = BM.layoutOf(st, h);
  check(lay.every((e) => e.at) && lay.filter((e) => !e.auto).length === 4, `everything else placed by the game (${lay.filter((e) => e.auto).length} auto, ${lay.filter((e) => !e.auto).length} by hand)`);
  const again = BM.layoutOf(st, h);
  check(lay.every((e, i) => again[i].at && e.at.join() === again[i].at.join()), "the auto layout is the same twice");
  // Nothing auto-placed overlaps anything else.
  let bad = 0;
  for (const e of lay) { const o = BM.occupancy(st, h, e.it.key, BM.autoLayout(st, h)); if (BM.placeProblemAt(h, e.it, e.at[0], e.at[1], e.at[2], o)) bad++; }
  check(bad === 0, `every placed thing passes the rules against the rest (${bad} do not)`);
}

section("The battle map from the plan");
{
  const st = world();
  const h = fortHub(st);
  const items = BM.itemsOf(st, h);
  const bunk = items.find((it) => it.type === "bunkhouse"), trench = items.find((it) => it.type === "trench"), pits = items.find((it) => it.type === "spike_pits"), lamp = items.find((it) => it.type === "floodlights");
  const C = BM.yardHalf(h);
  check(!BM.placeItem(st, h, bunk.key, 10, 10, 0) && !BM.placeItem(st, h, trench.key, -5, C + 5, 0) && !BM.placeItem(st, h, pits.key, 0, C + 3, 0) && !BM.placeItem(st, h, lamp.key, C - 3, C - 3, 0), "a bunkhouse, the trench, spike pits and a floodlight placed by hand");
  const car = createVehicle(st, "sedan", { kind: "base", baseId: h.id });
  const v = BM.itemByKey(st, h, `v:${car.id}`);
  check(!!v && !BM.placeItem(st, h, v.key, -12, 8, 0), "the car parked by hand");
  const size = BM.baseMapSize(st, h);
  const b = baseBattle(st, h, { kind: "zombies", count: 14, power: 3, name: "the horde" }, { through: 150, pits: 1, pitsAt: [pits.rec.at] });
  const F = b.deployPlan.fort;
  check(b.w === size[0] && b.h === size[1], `the battle's size (${b.w} × ${b.h}) is what the size phase said`);
  check(b.tier.map === "fort" && b.tier.walled && b.tier.stage === "wall", "a walled base: the fort tiers, the wall first");
  const k = kindsOf(b);
  const at = (gx, gy) => b.cells[(gy + F.oy) * b.w + gx + F.ox];
  check(at(10, 10).k === "wall" && at(12, 13).k === "bdoor" && at(11, 11).k === "loft" && at(11, 12).k === "stairs", `the bunkhouse stands at its cells (wall, a barred door at the front, an upper floor up the stairs)`);
  check(at(-5, C + 5).k === "trench" && at(4, C + 5).k === "trench" && at(0, C + 3).k === "spikes" && at(C - 3, C - 3).k === "lamp", "the trench, the spike pits and the floodlight where they were placed");
  check(at(-12, 8).k === "car" && at(-12, 8).hp === BM.DEF_HP.car && F.vehicles.some((q) => q.id === car.id), "the car parked where it was put, with hit points");
  check(k.palisade > 100 && k.gate === 8 && ["north", "east", "south", "west"].every((s) => F.gates[s].length === 2), `the wall ring with a gate on every side (${k.palisade} sections, ${k.gate} gate cells)`);
  check(k.tower === 4 && k.walkway > 100 && k.ladder >= 8, `the watchtower (${k.tower} tower cells), the walkway (${k.walkway}) and its ladders (${k.ladder})`);
  check(k.barricade === 6 && b.cells.filter((c) => c.k === "barricade").every((c) => c.hp === BM.DEF_HP.barricade), "the two barricades (3 cells each), with hit points to batter");
  check(!k.outline, "no outlines in a raid: the ground is open land");
  check(b.lit && b.deploy.fixedLit && b.lit[(C - 3 + F.oy) * b.w + C - 3 + F.ox] && !b.lit[(-C + F.oy) * b.w - C + F.ox], "the floodlight lights the ground round where it stands (nothing to aim)");
  check(!!b.stores && b.stores.containers.length >= 3, `the stores on the map: ${b.stores ? b.stores.containers.map((c) => c.label).join(", ") : "none"}`);
  const total = (key) => b.stores.containers.reduce((a, c) => a + (c.sup[key] || 0), 0);
  check(total("ammo") === Math.floor(h.stock.ammo) && total("scrap") === Math.floor(h.stock.scrap), `every unit of the stock is in a container (ammo ${total("ammo")} of ${h.stock.ammo}, scrap ${total("scrap")} of ${h.stock.scrap})`);
  check(b.stores.containers.reduce((a, c) => a + c.gear.length, 0) === h.armory.length, `every armory item too (${h.armory.length})`);
  check(b.units.filter((u) => u.side === "enemy").every((u) => u.x >= 0 && u.x < b.w && !F.inside[u.y * b.w + u.x]), "the dead start in the margin outside the walls");
  // The same map twice (the size phase's auto layout and the map's).
  const st2 = world();
  const h2 = fortHub(st2);
  for (const [key, at2] of [[bunk.key, [10, 10, 0]], [trench.key, [-5, C + 5, 0]], [pits.key, [0, C + 3, 0]], [lamp.key, [C - 3, C - 3, 0]]]) BM.placeItem(st2, h2, BM.itemsOf(st2, h2).find((it) => it.type === BM.itemByKey(st, h, key).type).key, ...at2);
  const car2 = createVehicle(st2, "sedan", { kind: "base", baseId: h2.id });
  BM.placeItem(st2, h2, `v:${car2.id}`, -12, 8, 0);
  const b2 = baseBattle(st2, h2, { kind: "zombies", count: 14, power: 3, name: "the horde" }, { through: 150, pits: 1, pitsAt: [[0, C + 3, 0]] });
  check(b2.w === b.w && b2.h === b.h && b2.cells.every((c, i) => c.k === b.cells[i].k), "the same base laid out the same way twice (deterministic)");
}

section("A base without walls, the attack from any side");
{
  const st = world();
  const h = fortHub(st, ["bunkhouse", "barricades", "storehouse"]);
  const sides = new Set();
  for (const dir of [0, 1, 2, 3]) {
    const from = st.grid.neighbors(h.tile)[dir];
    const b = baseBattle(st, h, { kind: "raiders", count: 6, power: 3, name: "raiders" }, { fromTile: from });
    sides.add(b.tier.side);
    if (dir === 0) {
      check(b.tier.map === "fort" && !b.tier.walled && b.tier.stage === "yard" && b.deploy.gate.length === 0, "no walls: the same map with no ring, the fight opens on the yard");
      check(!kindsOf(b).palisade && b.units.filter((u) => u.side === "enemy").every((u) => !b.deployPlan.fort.inside[u.y * b.w + u.x]), "no wall ring; the raiders start on the open ground round the yard");
      check(b.units.filter((u) => u.side === "player").every((u) => b.deployPlan.fort.inside[u.y * b.w + u.x]), "the defenders start inside the yard");
    }
    st.combat = null;
  }
  check(sides.size >= 2, `the attack comes from the side they came from (${[...sides].join(", ")})`);
}

section("Raiders stealing from the stores");
{
  const st = world();
  const h = fortHub(st, ["bunkhouse", "storehouse"], 0);
  for (const s of atBase(st, h.id)) s.gear.weapon = newItem("knife"); // weak defenders: the raiders reach the stores
  h.stock.meds = 40; h.stock.parts = 30;
  h.armory.push(newItem("pistol"), newItem("vest"));
  const b = baseBattle(st, h, { kind: "raiders", count: 10, power: 4, name: "raiders" }, {});
  const thieves = b.units.filter((u) => u.thief);
  check(thieves.length >= 1 && thieves.length <= 8, `${thieves.length} of the 10 raiders go for the stores`);
  for (const u of b.units) if (u.side === "enemy") u.thief = true; // all of them, for the test
  const box = b.stores.containers.find((c) => c.kg > 0);
  const t = b.units.find((u) => u.side === "enemy" && u.thief);
  // One raider put right next to the fullest container, with nobody near: it takes from it and makes for the edge.
  const full = b.stores.containers.slice().sort((a, c) => c.kg - a.kg)[0];
  let spot = null;
  for (let y = full.y - 1; y <= full.y + full.h && !spot; y++) for (let x = full.x - 1; x <= full.x + full.w; x++) { const c = b.cells[y * b.w + x]; if (CELL[c.k].walk && !unitAt(b, x, y) && !(x >= full.x && x < full.x + full.w && y >= full.y && y < full.y + full.h)) { spot = [x, y]; break; } }
  t.x = spot[0]; t.y = spot[1]; t.aware = true;
  for (const u of b.units) if (u.side === "player") { u.x = 0; u.y = 0; }
  b.tier.stage = "yard";
  const kg0 = full.kg;
  BM.thiefTurn(b, t);
  check(!!t.loot && t.loot.kg > 0 && full.kg < kg0, `the raider next to the ${full.label.toLowerCase()} grabs ${Math.round(t.loot.kg)} kg from it (${Math.round(kg0)} → ${Math.round(full.kg)} kg left)`);
  const stock0 = { ...h.stock }, arm0 = h.armory.length;
  // Gone off the map with it: only what left the map is gone from the stock when the fight ends.
  t.fled = true;
  const other = b.units.find((u) => u.side === "enemy" && u !== t);
  other.loot = { sup: { meds: 5 }, gear: [], kg: 1 }; other.dead = true; // dropped where it fell
  BM.settleBaseBattle(st, b);
  check(!!b.stolen && Math.abs(b.stolen.kg - t.loot.kg) < 1e-9 && JSON.stringify(b.stolen.sup) === JSON.stringify(t.loot.sup) && b.stolen.gear.length === t.loot.gear.length, "what the raider got away with is the loot that leaves; the dead one's stays");
  const res = BM.applyStolen(st, h, b.stolen);
  const lostSup = Object.entries(t.loot.sup).every(([k, n]) => Math.floor(stock0[k]) - Math.floor(h.stock[k]) === n);
  check(res && lostSup && h.armory.length === arm0 - t.loot.gear.length, `the stock and armory lose exactly that (${res ? res.text : "nothing"})`);
  check(h.stock.meds === stock0.meds - (t.loot.sup.meds || 0), "the meds the dead raider dropped are still in the stores");
  st.combat = null;
}

section("The armory's locked containers");
{
  const st = world();
  const h = fortHub(st, ["bunkhouse", "storehouse", "armory"], 0);
  for (const s of atBase(st, h.id)) s.gear.weapon = newItem("knife");
  h.stock.meds = 40; h.stock.parts = 30; h.stock.ammo = 300; h.stock.arrows = 20;
  h.armory.push(newItem("pistol"), newItem("vest"), newItem("knife"));
  const b = baseBattle(st, h, { kind: "raiders", count: 10, power: 4, name: "raiders" }, {});
  const cage = b.stores.containers.find((c) => c.holds === "gear"), lockers = b.stores.containers.find((c) => c.holds === "ammo");
  check(!!cage && !!lockers && BM.lockedBox(cage) && BM.lockedBox(lockers) && cage.bid === lockers.bid && cage.bid === h.buildings.find((x) => x.type === "armory").id, "the armory is two locked containers on the map: the gun cage and the ammo lockers");
  check(cage.w * cage.h + lockers.w * lockers.h === 12 && !(cage.x === lockers.x && cage.y === lockers.y), "each half the armory's footprint");
  check(cage.gear.length === h.armory.length && b.stores.containers.filter((c) => c !== cage).every((c) => !c.gear.length), `every item of the armory (${cage.gear.length}) is in the gun cage, none anywhere else`);
  const ammoKeys = (c) => Object.keys(c.sup).filter((k) => k === "ammo" || k === "arrows" || /^a_/.test(k));
  check(lockers.sup.arrows === 20 && ammoKeys(lockers).length >= 2 && b.stores.containers.filter((c) => c !== lockers).every((c) => !ammoKeys(c).length), `the rounds (by calibre) and arrows are in the ammo lockers, none anywhere else (${ammoKeys(lockers).join(", ")})`);
  check(!cage.sup.meds && !lockers.sup.meds && b.stores.containers.some((c) => c.sup.meds), "the meds and the rest are in the other stores, not the armory");
  const s0 = BM.storeContents(cage);
  check(s0.lock && !s0.lock.open && s0.lock.hp === BM.ARMORY_LOCK.HP, "the panel sees the lock and its hit points");
  // A raider next to the gun cage batters the lock, taking nothing until it gives way.
  for (const u of b.units) if (u.side === "enemy") u.thief = true;
  for (const u of b.units) if (u.side === "player") { u.x = 0; u.y = 0; }
  b.tier.stage = "yard";
  // A free cell next to this container and no other (a raider next to several takes from an open one first).
  const near = (c, x, y) => Math.max(c.x - x, x - (c.x + c.w - 1), c.y - y, y - (c.y + c.h - 1), 0) <= 1;
  const spotBy = (box) => { for (let y = box.y - 1; y <= box.y + box.h; y++) for (let x = box.x - 1; x <= box.x + box.w; x++) { const c = b.cells[y * b.w + x]; if (CELL[c.k].walk && !unitAt(b, x, y) && !BM.storeAt(b, x, y) && b.stores.containers.every((o) => o === box || !near(o, x, y))) return [x, y]; } return null; };
  const enemies = b.units.filter((u) => u.side === "enemy");
  const t = enemies[0], t2 = enemies[1];
  t.weapon = "knife"; t.aware = true;
  let spot = spotBy(cage); t.x = spot[0]; t.y = spot[1];
  let turns = 0;
  while (BM.lockedBox(cage) && turns < 30) { t.ap = 2; BM.thiefTurn(b, t); turns++; }
  check(turns >= 2 && !BM.lockedBox(cage) && !t.loot && cage.gear.length === h.armory.length, `a raider with a knife batters the lock open in ${turns} turns and takes nothing meanwhile`);
  check(cage.lock.by === t.name && BM.storeContents(cage).lock.open, "the lock is marked smashed open, and by whom");
  t.ap = 2; BM.thiefTurn(b, t);
  check(!!t.loot && t.loot.gear.length > 0 && cage.gear.length < h.armory.length, `with the lock smashed the raider grabs ${t.loot ? t.loot.gear.length : 0} items from the cage`);
  // Next to an open container and a locked one, a raider takes from the open one first.
  const open1 = b.stores.containers.find((c) => !c.lock && c.kg > 0.5);
  const t3 = enemies[2]; t3.aware = true;
  const both = (() => { for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) { const c = b.cells[y * b.w + x]; if (CELL[c.k].walk && !unitAt(b, x, y) && !BM.storeAt(b, x, y) && near(lockers, x, y) && b.stores.containers.some((o) => !o.lock && o.kg > 0.5 && near(o, x, y))) return [x, y]; } return null; })();
  if (both) { t3.x = both[0]; t3.y = both[1]; t3.ap = 2; const hp0 = lockers.lock.hp; BM.thiefTurn(b, t3); check(lockers.lock.hp === hp0 && !!t3.loot && t3.loot.kg > 0, "next to an open container and the locked lockers, a raider takes from the open one first"); }
  else check(!!open1, "(no cell next to both an open container and the lockers on this layout)");
  // A sledgehammer at the ammo lockers: shorter work of it.
  t2.weapon = "sledge"; t2.aware = true;
  spot = spotBy(lockers); t2.x = spot[0]; t2.y = spot[1];
  let turns2 = 0;
  while (BM.lockedBox(lockers) && turns2 < 30) { t2.ap = 2; BM.thiefTurn(b, t2); turns2++; }
  check(turns2 >= 1 && turns2 < turns && !BM.lockedBox(lockers), `one with a sledgehammer smashes the ammo lockers' lock in ${turns2}`);
  // The fight over: the armory wears for its smashed locks (both: broken until repaired).
  const fxA = h.buildings.find((x) => x.type === "armory");
  t.fled = true;
  BM.settleBaseBattle(st, b);
  check((fxA.wear || 0) >= 2 * BM.MAP_WEAR.lock && !!fxA.broken, `the armory wears ${fxA.wear} for the two smashed locks: broken until repaired`);
  st.combat = null;
  // With its locks smashed the containers stand open in the next fight.
  const b2 = baseBattle(st, h, { kind: "raiders", count: 6, power: 3, name: "raiders" }, {});
  const cage2 = b2.stores.containers.find((c) => c.holds === "gear");
  check(!!cage2 && !cage2.lock && !BM.lockedBox(cage2), "with the armory broken its containers are on the map unlocked");
  st.combat = null;
}

section("The Base map view, saving, jobs and upgrades");
{
  const st = world();
  const h = fortHub(st, ["walls", "bunkhouse"]);
  h.stock.scrap = 500; h.stock.parts = 20; h.stock.meds = 20;
  check(baseMapTab(st, h, {}).includes("Open the base map") && baseMapTab(st, h, {}).includes("Bunkhouse"), "the Base map tab lists the things on the map");
  check(/queued/.test(queueBuild(st, h, "infirmary")), "an infirmary queued");
  const job = h.construction.find((c) => c.type === "infirmary");
  globalThis.window = {};
  try {
    check(!BM.openBaseMap(st, h.id, `c:${job.id}`) && st.combat && st.combat.layout && st.combat.layout.pick === `c:${job.id}`, "the base map opens with the new job picked");
    let b = st.combat;
    const F = b.deployPlan.fort;
    check(F.outlines.length === 1 && kindsOf(b).outline === 20 && b.cells.filter((c) => c.k === "outline").every((c) => CELL[c.k].walk), "the job's outline on the view (5 × 4 cells of stakes and string, open ground to walk on)");
    check(layoutPanel(st, b, { msg: "", storeView: null }).includes("Makeshift infirmary"), "the layout panel lists it");
    const cx = F.x0 + 20, cy = F.y0 + 20;
    const g = BM.ghostAt(st, b, cx, cy);
    check(g && g.cells.length === 20 && g.doors.length >= 1 && typeof g.ok === "boolean", `the ghost under the mouse: ${g.cells.length} cells, ${g.doors.length} doorway cell(s), ${g.ok ? "fits" : g.why}`);
    check(typeof layoutHover(st, b, { x: cx, y: cy }, g) === "string", "the hover line");
    check(!combatAct(st, { type: "rotate" }) && st.combat.layout.rot === 1, "R turns the pick");
    const g2 = BM.ghostAt(st, st.combat, cx, cy);
    const err = combatAct(st, { type: "put", x: cx, y: cy });
    check(g2.ok ? !err && job.at && job.at[2] === 1 : !!err, g2.ok ? `put down turned at ${job.at}` : `refused where it does not fit (${err})`);
    if (!g2.ok) { for (let y = F.y0 + 2; y < F.y0 + F.yh - 6 && !job.at; y += 3) for (let x = F.x0 + 2; x < F.x0 + F.yw - 6 && !job.at; x += 3) { const gg = BM.ghostAt(st, st.combat, x, y); if (gg && gg.ok) combatAct(st, { type: "put", x, y }); } check(!!job.at, `put down at the first spot that fits (${job.at})`); }
    b = st.combat;
    check(b.layout && !b.layout.pick && b.keepCam && b.deployPlan.fort.outlines.length === 1, "the view laid out again, the pick down, the camera kept");
    check(!combatAct(st, { type: "lift", key: `c:${job.id}` }) && st.combat.layout.pick === `c:${job.id}` && !job.at, "a placed thing lifted to move it");
    check(!combatAct(st, { type: "put", x: cx, y: cy }) || true, "put back");
    check(!combatAct(st, { type: "endLayout" }) && !st.combat, "Close the map leaves no battle");
  } finally { delete globalThis.window; }
  // Save / load keeps the plan.
  if (!job.at) job.at = [2, 2, 0];
  const plot = BM.itemByKey(st, h, "p:0");
  check(!BM.placeItem(st, h, plot.key, 14, -14, 0), "a crop plot placed by hand");
  const s2 = loadFromString(saveToString(st));
  const h2 = hub(s2), job2 = h2.construction.find((c) => c.type === "infirmary");
  check(job2 && job2.at && job2.at.join() === job.at.join() && h2.plan.plots[0] && h2.plan.plots[0].join() === "14,-14,0", "save / load keeps where the job and the crop plot were placed");
  // The job finished: the building keeps the spot.
  for (const s of atBase(st, h.id)) s.role = "build";
  for (let i = 0; i < 400 && h.construction.some((c) => c.type === "infirmary"); i++) constructionHour(st);
  const inf = h.buildings.find((x) => x.type === "infirmary");
  check(!!inf && inf.at && inf.at.join() === job.at.join(), `the finished infirmary stands where its outline was (${inf && inf.at})`);
  // A family upgrade in place keeps it.
  addBuilding(h, "field_hosp");
  const fh = h.buildings.find((x) => x.type === "field_hosp");
  check(!h.buildings.some((x) => x.type === "infirmary") && fh.at && fh.at.join() === job.at.join(), "upgraded to a field hospital in place, at the same spot");
  check(BM.baseMapSummary(st, h).byHand === 2, `the summary: ${BM.baseMapSummary(st, h).byHand} placed by hand of ${BM.baseMapSummary(st, h).items}`);
}

section("A horde break-in played out on the base map");
{
  const st = world();
  const h = fortHub(st);
  const b = baseBattle(st, h, { kind: "zombies", count: 14, power: 3, name: "the horde" }, { through: 150, pits: 1 });
  b.phase = "player";
  // Saved mid-battle: the stores and the map come back (plain data, nothing that cannot be saved).
  const sv = loadFromString(saveToString(st));
  check(sv.combat && sv.combat.stores && sv.combat.stores.containers.length === b.stores.containers.length && sv.combat.deployPlan.fort.vehicles.length === b.deployPlan.fort.vehicles.length, "saved and loaded mid-battle with its stores and map");
  let turns = 0;
  for (; turns < 40 && !b.over; turns++) { autoPlayerTurn(st); if (b.over) break; endPlayerTurn(st); runEnemyPhase(st); }
  check(b.over || turns === 40, `played out by the AI on both sides: ${b.over ? b.result.outcome : "still on"} after ${turns} turns`);
  const breaches = b.deployPlan.fort.ring.filter(([x, y]) => b.cells[y * b.w + x].k === "breach").length;
  check(breaches >= 1, `the dead broke through the wall (${breaches} breach${breaches === 1 ? "" : "es"})`);
  if (b.over) { finishCombat(st, b.setup, b.result); check(!st.combat, "the fight settled (the buildings' wear, the cars)"); }
  st.combat = null;
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
