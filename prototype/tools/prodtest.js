// Production orders, power and stewards (src/sim/production.js, power.js, steward.js; suggestions-2 #5–#7):
// every station order type stops and starts as it should (Forever, Until N with its 10% margin, Keep at least N of
// an input, Off, the drying racks), the fallback (another role, another station, pinned people idle, back when
// needed), idle stations make no Heat; repeating craft orders (keep N in the armory, the minimum-quality rule both
// for queuing and for counting, supplies); power (generator standby, supply and demand, two generators, the
// machine shop's 2 parts, the kitchen, the cold store in summer, floodlights without fuel, +2 radio range, fuel
// paid once a day, the generator's Heat, no operator no power); the ethanol still (food and spoiled food → fuel,
// a keep order); stewards (run one base and leave another alone, pinned people and areas switched off left
// alone, one log line a day, taking over keeps everything, nothing while the autopilot runs); the governor using
// the orders; and 200 days with all of it on two seeds with no NaN or negative stock.
// Usage: node tools/prodtest.js [days for the long runs] [seeds...]
import { createWorld, tickHour, hub, atBase, makeSurvivor, newId, day, hourOfDay } from "../src/sim/world.js";
import { addBuilding, stations, stationStatus, runStations, mannedStations, RECIPES, BUILDINGS } from "../src/sim/buildings.js";
import {
  setStationOrder, clearStationOrder, stationOrder, orderHold, productionHour, rackLimit, RACK, addCraftOrder, setCraftOrder,
  craftOrders, craftOrderStatus, craftOrderHave,
} from "../src/sim/production.js";
import { POWER, powerStatus, refreshPower, isPowered, poweredType, generatorHeat } from "../src/sim/power.js";
import { stewardOf, setSteward, setStewardArea, setPinned, stewardHour, STEWARD_LOG_HOUR } from "../src/sim/steward.js";
import { setAutopilot, autopilotHour, stewardRun } from "../src/sim/autopilot.js";
import { craftQueue, craftingHour, craftJobStatus, makeItem, craftQuality, CRAFTS } from "../src/sim/crafting.js";
import { storeSpaces, storeRate, rackPlan } from "../src/sim/storage.js";
import { defenceMult, hordeAttackBase } from "../src/sim/defences.js";
import { makeHorde, baseHeat } from "../src/sim/hordes.js";
import { radioNodes } from "../src/sim/radio.js";
import { recomputeOwnership } from "../src/sim/factions.js";
import { planPath } from "../src/sim/parties.js";
import { SUPPLY_KEYS } from "../src/sim/data.js";

const longDays = Number(process.argv[2] || 200);
const seeds = process.argv.length > 3 ? process.argv.slice(3).map(Number) : [42, 7];
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const W = (seed = 42) => { const st = createWorld({ seed, factionCount: 6 }); st.started = true; return st; };
const plain = (s) => { s.traits = []; s.conditions = []; return s; };
// A quiet hub: everyone resting, plenty of everything, no illness to make people unfit to work.
function quietHub(st) {
  const h = hub(st);
  for (const s of atBase(st, h.id)) { plain(s); s.role = "rest"; s.station = null; s.health = 100; s.mood = 80; }
  Object.assign(h.stock, { food: 500, water: 200, scrap: 300, parts: 30, fuel: 40, meds: 20, ammo: 50, jars: 40, preserved: 0 });
  return h;
}
const people = (st, h) => atBase(st, h.id);
const op = (s, station) => { s.role = "operate"; s.station = station.id; };
const nextHour = (st) => { st.hour += 1; productionHour(st); };

// ---------- 1. station orders ----------
{
  console.log("Station orders");
  const st = W();
  const h = quietHub(st);
  const bench = addBuilding(h, "ammo_bench");
  const [a] = people(st, h);
  op(a, bench);
  a.skills.mechanics = 0;
  // Forever (no order): it runs.
  h.stock.ammo = 0;
  runStations(st, h);
  check(h.stock.ammo === RECIPES.ammo.out.ammo, `Forever: the bench runs (${h.stock.ammo} ammo)`);
  check(!orderHold(st, h, bench) && stationOrder(h, bench).mode === "forever", "no order means Forever");
  // Until N: runs below N, stops at N, starts again only below N - 10%.
  setStationOrder(st, h, bench.id, { mode: "until", n: 50 });
  h.stock.ammo = 45;
  runStations(st, h);
  check(h.stock.ammo === 53, `Until 50: runs from 45 (${h.stock.ammo})`);
  productionHour(st);
  runStations(st, h);
  check(h.stock.ammo === 53, `Until 50: stops at 53 (${h.stock.ammo})`);
  check(/Order met/.test(stationStatus(st, h, bench).reason) && stationStatus(st, h, bench).idle, `the status says why (${stationStatus(st, h, bench).reason})`);
  h.stock.ammo = 46;
  productionHour(st);
  runStations(st, h);
  check(h.stock.ammo === 46, `Until 50: still stopped at 46 (the margin: starts again below 45) (${h.stock.ammo})`);
  h.stock.ammo = 44;
  productionHour(st);
  runStations(st, h);
  check(h.stock.ammo === 52, `Until 50: starts again below 45 (${h.stock.ammo})`);
  // Keep at least N of an input.
  setStationOrder(st, h, bench.id, { mode: "keep", key: "scrap", n: 10 });
  h.stock.scrap = 12; h.stock.ammo = 0;
  runStations(st, h);
  check(h.stock.scrap === 12 && h.stock.ammo === 0, `Keep 10 scrap: no run from 12 (it would leave 9) (${h.stock.scrap} scrap, ${h.stock.ammo} ammo)`);
  h.stock.scrap = 13;
  runStations(st, h);
  check(h.stock.scrap === 10 && h.stock.ammo === 8, `Keep 10 scrap: runs from 13 down to 10 (${h.stock.scrap} scrap)`);
  // Off.
  setStationOrder(st, h, bench.id, { mode: "off" });
  h.stock.scrap = 100; h.stock.ammo = 0;
  runStations(st, h);
  check(h.stock.ammo === 0 && h.stock.scrap === 100, "Off: never runs");
  // An idle station makes no workshop noise.
  check(mannedStations(st, h) === 0, `a station its order holds makes no Heat (${mannedStations(st, h)} manned)`);
  setStationOrder(st, h, bench.id, { mode: "forever" });
  check(mannedStations(st, h) === 1, "a running station does");
  check(/cleared/.test(clearStationOrder(st, h, bench.id)) && !h.orders[bench.id], "an order can be cleared");
  // A generator makes nothing to count: Until falls back to Forever.
  const gen = addBuilding(h, "generator");
  setStationOrder(st, h, gen.id, { mode: "until", n: 5 });
  check(stationOrder(h, gen).mode === "forever", "no Until order on a generator");

  // Fallback to a role, and back.
  const st2 = W();
  const h2 = quietHub(st2);
  const b2 = addBuilding(h2, "ammo_bench");
  const [x, y] = people(st2, h2);
  op(x, b2);
  setStationOrder(st2, h2, b2.id, { mode: "until", n: 100, fallback: "farm" });
  h2.stock.ammo = 120;
  productionHour(st2);
  check(x.role === "farm" && x.parked && x.parked.from === b2.id, `order met: the operator goes farming (${x.role})`);
  h2.stock.ammo = 95;
  productionHour(st2);
  check(x.role === "farm", "still farming inside the margin (95 of 100)");
  h2.stock.ammo = 80;
  productionHour(st2);
  check(x.role === "operate" && x.station === b2.id && !x.parked, `needed again: back on the bench (${x.role})`);
  // The player moves them while parked: the fallback lets go.
  h2.stock.ammo = 120;
  productionHour(st2);
  x.role = "guard";
  h2.stock.ammo = 0;
  productionHour(st2);
  check(x.role === "guard" && !x.parked, "someone the player moved while parked stays where the player put them");
  // Fallback to another station.
  const med = addBuilding(h2, "med_station");
  op(y, b2);
  x.role = "rest";
  setStationOrder(st2, h2, b2.id, { mode: "off", fallback: `st:${med.id}` });
  productionHour(st2);
  check(y.role === "operate" && y.station === med.id, `order off: the operator moves to the free med station (${y.station === med.id})`);
  setStationOrder(st2, h2, b2.id, { mode: "forever" });
  productionHour(st2);
  check(y.station === b2.id, "and back to the bench when it runs again");
  // A pinned operator idles instead.
  setPinned(st2, y, true);
  setStationOrder(st2, h2, b2.id, { mode: "off", fallback: "scavenge" });
  productionHour(st2);
  check(y.role === "operate" && y.station === b2.id, "a pinned operator idles at the station");
  setPinned(st2, y, false);
  // The fallback is a hand rule: not while a steward runs the roles here.
  setSteward(st2, h2, true);
  productionHour(st2);
  check(y.role === "operate", "no fallback switching while a steward sets the roles");
  setSteward(st2, h2, false);

  // The drying racks' order.
  const st3 = W();
  const h3 = quietHub(st3);
  addBuilding(h3, "smoker");
  h3.stock.food = 900;
  check(rackPlan(st3, h3).take > 0, "the racks dry surplus food with no order");
  setStationOrder(st3, h3, "rack", { mode: "off" });
  check(rackPlan(st3, h3).take === 0 && rackLimit(st3, h3) === 0, "racks Off: nothing dried");
  setStationOrder(st3, h3, "rack", { mode: "keep", key: "food", n: 898 });
  check(Math.abs(rackPlan(st3, h3).take - 2) < 1e-9, `racks Keep 898 food: take 2 (${rackPlan(st3, h3).take})`);
  setStationOrder(st3, h3, "rack", { mode: "until", n: 10 });
  h3.stock.preserved = 12;
  check(rackPlan(st3, h3).take === 0, "racks Until 10 preserved: stop at 12");
}

// ---------- 2. craft orders and quality ----------
{
  console.log("Craft orders and quality");
  const st = W();
  const h = quietHub(st);
  const [c, d] = people(st, h);
  for (const s of people(st, h)) s.skills.mechanics = 0;
  c.role = "craft";
  h.armory.length = 0;
  addCraftOrder(st, h, "spikedbat", 2, 0.8);
  const o = craftOrders(h)[0];
  // Expected quality 75% at Mechanics 0: below 80%, nothing is queued.
  productionHour(st);
  check(!craftQueue(h).length && /80%/.test(craftOrderStatus(st, h, o).reason), `min 80%: nothing queued while the best makes ${Math.round(craftQuality(0, CRAFTS.spikedbat) * 100)}% (${craftOrderStatus(st, h, o).reason})`);
  // A worn 70% bat in the armory does not count toward the order.
  h.armory.push(makeItem("spikedbat", 0.7));
  check(craftOrderHave(h, o) === 0, "an item below the minimum does not count");
  c.skills.mechanics = 8; // 85%
  productionHour(st);
  check(craftQueue(h).length === 1 && craftQueue(h)[0].orderId === o.id && craftQueue(h)[0].minQ === 0.8, "a crafter good enough: one job queued");
  productionHour(st);
  check(craftQueue(h).length === 1, "one job at a time per order");
  const scrap0 = h.stock.scrap;
  for (let i = 0; i < 40; i++) { st.hour++; craftingHour(st); productionHour(st); }
  const good = h.armory.filter((it) => it.key === "spikedbat" && it.quality >= 0.8).length;
  check(good === 2 && !craftQueue(h).length, `keeps 2 at 80%+ in the armory and stops (${good}, queue ${craftQueue(h).length})`);
  check(scrap0 - h.stock.scrap === CRAFTS.spikedbat.in.scrap, `materials paid per job (${scrap0 - h.stock.scrap} scrap for the one after the first)`);
  // A team takes one: the order makes another.
  h.armory.splice(h.armory.findIndex((it) => it.key === "spikedbat" && it.quality >= 0.8), 1);
  productionHour(st);
  check(craftQueue(h).length === 1, "one taken out: another is queued");
  // The quality rule at work: the good crafter leaves the Craft role, the job waits.
  c.role = "rest"; d.role = "craft";
  check(/good enough/.test(craftJobStatus(st, h, craftQueue(h)[0])), `the job waits for a crafter who reaches 80% (${craftJobStatus(st, h, craftQueue(h)[0])})`);
  // Pausing and supplies.
  setCraftOrder(st, h, o.id, { on: false });
  check(craftOrderStatus(st, h, o).reason === "Paused", "an order can be paused");
  const st2 = W();
  const h2 = quietHub(st2);
  people(st2, h2)[0].skills.medicine = 6;
  people(st2, h2)[0].role = "craft";
  h2.stock.meds = 3;
  addCraftOrder(st2, h2, "dressings", 5, 0);
  productionHour(st2);
  check(craftQueue(h2).length === 1, "a supplies order (dressings) counts the meds stock: 3 of 5, one job");
  h2.stock.meds = 9;
  check(craftOrderStatus(st2, h2, craftOrders(h2)[0]).need === 0, "with 9 meds nothing more is needed");
}

// ---------- 3. power ----------
{
  console.log("Power");
  const st = W();
  const h = quietHub(st);
  const ppl = people(st, h);
  const gen = addBuilding(h, "generator");
  op(ppl[0], gen);
  const fuel0 = h.stock.fuel;
  refreshPower(st, h);
  check(h.stock.fuel === fuel0 && !h.power.running && /Standby/.test(stationStatus(st, h, gen).reason), "a generator with nothing to power stands by and burns nothing");
  const shop = addBuilding(h, "machine_shop");
  op(ppl[1], shop);
  ppl[1].skills.mechanics = 6;
  let ps = powerStatus(st, h);
  check(ps.demand === 2 && ps.supply === POWER.genOut && ps.running === 1, `a staffed machine shop draws 2: supply ${ps.supply}, demand ${ps.demand}`);
  const parts0 = h.stock.parts, scrap0 = h.stock.scrap;
  runStations(st, h);
  check(h.stock.fuel === fuel0 - POWER.genFuel, `the generator burns ${POWER.genFuel} fuel for the day (${fuel0 - h.stock.fuel})`);
  check(h.stock.parts - parts0 === 2 && scrap0 - h.stock.scrap === 9, `powered machine shop: 2 parts from 9 scrap (${h.stock.parts - parts0} from ${scrap0 - h.stock.scrap})`);
  refreshPower(st, h);
  productionHour(st);
  check(h.stock.fuel === fuel0 - POWER.genFuel, "fuel is paid once a day, not every hour");
  st.hour += 24;
  refreshPower(st, h);
  check(h.stock.fuel === fuel0 - 2 * POWER.genFuel, "and again the next day");
  // Heat: a running generator is loud.
  const heatOn = baseHeat(st, h);
  check(generatorHeat(h) === POWER.genHeat, `a running generator adds ${POWER.genHeat} Heat`);
  // Without an operator: no power, no Heat from it.
  ppl[0].role = "rest"; ppl[0].station = null;
  st.hour += 24;
  refreshPower(st, h);
  check(!isPowered(h, shop) && h.power.supply === 0, "no operator on the generator: no power");
  check(baseHeat(st, h) <= heatOn - POWER.genHeat - 3, `quieter without it (${heatOn} → ${baseHeat(st, h)})`);
  const parts1 = h.stock.parts;
  runStations(st, h);
  check(h.stock.parts - parts1 === 1, "the unpowered machine shop makes 1 part");
  op(ppl[0], gen);
  // Every user: cold store, radio, floodlights, kitchen (one more), and a second generator.
  for (const t of ["coldstore", "radio", "floodlights", "kitchen", "kitchen"]) addBuilding(h, t);
  const kitchens = stations(h).filter((x) => x.type === "kitchen");
  op(ppl[2], kitchens[0]); op(ppl[3], kitchens[1]);
  ps = powerStatus(st, h);
  check(ps.demand === 1 + 1 + 1 + 2 + 1 + 1 && ps.supply === POWER.genOut, `demand 7 against one generator's 6 (${ps.demand}/${ps.supply})`);
  check(ps.users.filter((u) => u.served).length === 5 && !ps.users.find((u) => u.b.id === kitchens[1].id).served, "served in order while it lasts: the last kitchen goes without");
  const gen2 = addBuilding(h, "generator");
  op(ppl[4], gen2);
  ps = powerStatus(st, h);
  check(ps.running === 2 && ps.supply === 12 && ps.users.every((u) => u.served), "a second staffed generator covers it");
  st.hour += 24;
  refreshPower(st, h);
  // Effects.
  check(poweredType(h, "coldstore") && storeSpaces(h).find((x) => x.key === "coldstore").kind === "freezer", "the powered cold store is a freezer");
  check(storeRate("freezer", 26) === 0.002 && storeRate("cold", 26) === 0.012, `summer: 0.2% a day powered, 1.2% without`);
  const node = radioNodes(st).find((n) => n.base === h);
  check(node && node.range === 10, `radio coverage +2 on power (${node && node.range})`);
  h.stock.fuel = 0;
  check(defenceMult(st, h) > 1.09, "powered floodlights count with no fuel");
  const horde = makeHorde(st, { tile: h.tile, size: 6, role: "roam" });
  h.stock.fuel = 10;
  hordeAttackBase(st, horde, h);
  check(h.stock.fuel === 10, `no fuel burned by powered floodlights in an attack (${h.stock.fuel})`);
  const kst = stationStatus(st, h, kitchens[0]);
  check(kst.powered && kst.in.food === 14 && kst.out.preserved >= 12, `the powered kitchen: ${kst.in.food} food → ${kst.out.preserved} preserved`);
  // Switching a building off.
  h.powerOff = { [kitchens[0].id]: true };
  check(powerStatus(st, h).demand === 6, "a building switched off draws nothing");
  // No generator fuel: no power.
  st.hour += 24;
  h.stock.fuel = 1;
  refreshPower(st, h);
  check(h.power.supply === 0 && /fuel/.test(stationStatus(st, h, gen).reason), "no fuel, no power");
}

// ---------- 4. the ethanol still ----------
{
  console.log("Ethanol still");
  const st = W();
  const h = quietHub(st);
  const still = addBuilding(h, "still");
  const [s] = people(st, h);
  op(s, still);
  h.stock.food = 100; h.stock.fuel = 0; h.mash = 0;
  runStations(st, h);
  check(h.stock.fuel === 3 && h.stock.food === 92, `8 food + 2 water → 3 fuel (${h.stock.food} food, ${h.stock.fuel} fuel)`);
  h.mash = 10;
  runStations(st, h);
  check(h.stock.fuel === 6 && h.stock.food === 88 && h.mash === 6, `spoiled food first: 4 mash + 4 food (${h.stock.food} food, mash ${h.mash})`);
  setStationOrder(st, h, still.id, { mode: "keep", key: "food", n: 85 });
  runStations(st, h);
  check(h.stock.fuel === 6, "Keep 85 food: stops (88 - 4 would be 84)");
  // storage.js leaves the day's spoiled food as mash.
  const st2 = W();
  const h2 = quietHub(st2);
  h2.stock.food = 2000;
  st2.hour = 24 * 40;
  for (let i = 0; i < 24; i++) tickHour(st2);
  check(h2.mash > 0, `food spoiling outside leaves mash for tomorrow (${h2.mash})`);
}

// ---------- 5. stewards ----------
function makeOutpost(state, staff) {
  const h = hub(state);
  const g = state.grid;
  const t = state.tiles.find((x) => {
    const d = g.distance(x.id, h.tile);
    return d >= 4 && d <= 7 && x.terrain !== "water" && typeof x.owner !== "number" && !state.factions.some((f) => f.bases.some((b) => g.distance(b, x.id) <= 3)) && planPath(state, h.tile, x.id, true);
  });
  const base = { id: newId(), tile: t.id, type: "outpost", name: "Test Outpost", stock: { food: 200, water: 80, fuel: 10, meds: 6, ammo: 60, parts: 4, scrap: 80 }, radio: false, watchtower: false, buildings: [], construction: [], armory: [] };
  state.bases.push(base);
  for (const s of staff) { s.location = { kind: "base", baseId: base.id }; s.role = "rest"; s.station = null; }
  recomputeOwnership(state);
  return base;
}
{
  console.log("Stewards");
  const st = W();
  const h = quietHub(st);
  const all = people(st, h);
  const o = makeOutpost(st, all.slice(3));
  const opeople = atBase(st, o.id);
  for (const s of all.slice(0, 3)) s.role = "rest";
  const pinnedOne = opeople[0];
  pinnedOne.role = "guard";
  setPinned(st, pinnedOne, true);
  const hubRoles = () => people(st, h).map((s) => `${s.id}:${s.role}`).join(",");
  const before = hubRoles();
  setSteward(st, o, true);
  check(stewardOf(o).on && Object.values(stewardOf(o).areas).every(Boolean), "a steward starts with every area on");
  const logs0 = st.log.length;
  st.hour = 24 * 5 + 6;
  let lines = 0;
  for (let i = 0; i < 72; i++) {
    tickHour(st);
    if (st.log[0] && /🧭 Steward of Test Outpost today/.test(st.log[0].text) && st.log[0].hour === st.hour) lines++;
  }
  const allLines = st.log.filter((l) => /🧭 Steward of/.test(l.text));
  check(lines === 3 && allLines.every((l) => /Test Outpost/.test(l.text) && l.hour % 24 === STEWARD_LOG_HOUR), `one log line a day for the base it runs (${lines} in 3 days)`);
  check(hubRoles() === before, "the hub (no steward) is left alone");
  check(pinnedOne.role === "guard", "the pinned guard keeps her role");
  const others = atBase(st, o.id).filter((s) => !s.pinned);
  check(others.some((s) => s.role !== "rest"), `the steward set roles at its base (${others.map((s) => s.role).join(", ")})`);
  // An area switched off: its roles are left alone.
  setStewardArea(st, o, "defence", false);
  const g = others[0];
  g.role = "guard";
  for (let i = 0; i < 5; i++) tickHour(st);
  check(g.role === "guard", "Defence handed back: a guard set by hand stays a guard");
  setStewardArea(st, o, "food", false);
  setStewardArea(st, o, "roles", false);
  others[1].role = "build";
  for (let i = 0; i < 3; i++) tickHour(st);
  check(others[1].role === "build", "Roles handed back: no role changes at all");
  setStewardArea(st, o, "roles", true);
  setStewardArea(st, o, "food", true);
  setStewardArea(st, o, "defence", true);
  // Take over: everything stays as it is.
  for (let i = 0; i < 3; i++) tickHour(st);
  const snap = atBase(st, o.id).map((s) => `${s.id}:${s.role}:${s.station}`).join(",");
  const queue = o.construction.map((j) => j.id).join(",");
  setSteward(st, o, false);
  check(/take over/.test(st.log[0].text), "taking over is logged");
  for (let i = 0; i < 30; i++) tickHour(st);
  check(atBase(st, o.id).map((s) => `${s.id}:${s.role}:${s.station}`).join(",") === snap, "after taking over nobody's role changes");
  check(o.construction.map((j) => j.id).join(",").startsWith(queue.split(",").slice(1).join(",")) || o.construction.length <= queue.split(",").length, "and nothing new is queued");
  // Nothing while the autopilot runs.
  setSteward(st, o, true);
  setAutopilot(st, true, "balanced");
  const n0 = st.log.filter((l) => /🧭 Steward of/.test(l.text)).length;
  for (let i = 0; i < 30; i++) tickHour(st);
  check(st.log.filter((l) => /🧭 Steward of/.test(l.text)).length === n0, "stewards are quiet while the dev autopilot runs");
  check(stewardRun(st, o, stewardOf(o).areas, "balanced") === 0, "stewardRun refuses while the autopilot is on");
  setAutopilot(st, false);
  // The governor uses station orders.
  const st2 = W();
  const h2 = quietHub(st2);
  addBuilding(h2, "ammo_bench");
  const bench = stations(h2)[0];
  setSteward(st2, h2, true);
  st2.hour += 1;
  stewardHour(st2);
  check(stationOrder(h2, bench).mode === "until" && stationOrder(h2, bench).by === "ai", `the steward gives the bench an Until order (${stationOrder(h2, bench).mode} ${stationOrder(h2, bench).n})`);
  setStationOrder(st2, h2, bench.id, { mode: "off" });
  stewardHour(st2);
  check(stationOrder(h2, bench).mode === "off" && !atBase(st2, h2.id).some((s) => s.station === bench.id && s.role === "operate"), "the player's own order stands and the steward staffs nothing it holds");
}

// ---------- 6. long runs ----------
{
  console.log(`Long runs (${longDays} days, seeds ${seeds.join(", ")}): a steward with two pinned operators, and the dev autopilot`);
  for (const seed of seeds) for (const mode of ["steward", "autopilot"]) {
    const st = W(seed);
    const h = hub(st);
    h.stock.parts = (h.stock.parts || 0) + 12;
    h.stock.scrap = (h.stock.scrap || 0) + 60;
    h.stock.fuel = (h.stock.fuel || 0) + 20;
    for (const t of ["generator", "still", "machine_shop", "coldstore", "smoker"]) addBuilding(h, t);
    addCraftOrder(st, h, "spikedbat", 2, 0.8);
    addCraftOrder(st, h, "dressings", 6, 0);
    setStationOrder(st, h, "rack", { mode: "keep", key: "food", n: 120 });
    if (mode === "steward") {
      // Two pinned operators keep the generator and the machine shop going under the steward.
      const [g0, m0] = atBase(st, h.id).sort((x, y) => y.skills.mechanics - x.skills.mechanics);
      const sts = stations(h);
      op(m0, sts.find((x) => x.type === "machine_shop"));
      op(g0, sts.find((x) => x.type === "generator"));
      setPinned(st, g0, true);
      setPinned(st, m0, true);
      setSteward(st, h, true);
    } else setAutopilot(st, true, "balanced");
    let bad = "";
    let maxSupply = 0, powered = 0, fuelMade = 0, lastFuel = h.stock.fuel, stewardLines = 0;
    for (let i = 0; i < longDays * 24 && !st.gameOver; i++) {
      tickHour(st);
      for (const b of st.bases) {
        for (const k of SUPPLY_KEYS) { const v = b.stock[k]; if (v != null && (!Number.isFinite(v) || v < 0)) bad = bad || `${b.name} ${k}=${v} day ${day(st)}`; }
        if (b.power && !(Number.isFinite(b.power.supply) && Number.isFinite(b.power.demand))) bad = bad || `power NaN day ${day(st)}`;
        if (b.mash != null && !Number.isFinite(b.mash)) bad = bad || `mash NaN day ${day(st)}`;
      }
      for (const s of st.survivors) if (s.alive && !(Number.isFinite(s.health) && Number.isFinite(s.mood))) bad = bad || `${s.name} health or mood NaN`;
      if (h.power) { maxSupply = Math.max(maxSupply, h.power.supply); if (h.power.supply > 0) powered++; }
      if (h.stock.fuel > lastFuel) fuelMade += h.stock.fuel - lastFuel;
      lastFuel = h.stock.fuel;
      if (st.log.slice(0, 3).some((l) => l.hour === st.hour && /🧭 Steward of/.test(l.text))) stewardLines++;
    }
    check(!bad, `seed ${seed} (${mode}): no NaN or negative stock (${bad || "ok"})`);
    if (mode === "steward") check(Math.abs(stewardLines - (day(st) - 1)) <= 1, `seed ${seed}: one steward line a day (${stewardLines} in ${day(st) - 1} days)`);
    else check(stewardLines === 0, "no steward lines while the autopilot runs");
    console.log(`  seed ${seed} ${mode}: day ${day(st)}${st.gameOver ? " (game over)" : ""}, ${st.survivors.filter((s) => s.alive).length} alive, powered ${Math.round(powered / 24)} days (up to ${maxSupply}), fuel in ${Math.round(fuelMade)}, ammo ${Math.floor(h.stock.ammo)}, parts ${Math.floor(h.stock.parts)}, fuel ${Math.floor(h.stock.fuel)}, armory ${h.armory.length}`);
  }
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
