// Appliances at the base (#19, 2026-10-25; src/sim/data-appliances.js, appliances.js): found fridges, chest freezers,
// cold cases, kitchen ranges, ovens and microwaves carried home in the stores, set on a general building's floor, on
// the grid and in the kitchen. The chest freezer's and the cold case's room on and off the grid, the range cooking with
// no wood on the grid or on propane and idle with neither, the oven's baking and ×1.25 beside a range, the microwave's
// ×1.1, every piece picked up whole, the governor setting a stored range before it wishes for a Kitchen, an AI group
// setting a fridge from its armory (and its food keeping in it), propane finds, and save / load.
// Usage: node tools/appliancestest.js [seed]
import { createWorld, hub, atBase, makeSurvivor } from "../src/sim/world.js";
import { addBuilding, canBuild, demolish, BUILDINGS, stationStatus } from "../src/sim/buildings.js";
import { newItem, isCarryable, isTwoHands, fitReason } from "../src/sim/inventory.js";
import { GEAR, SUPPLIES } from "../src/sim/data.js";
import { FIXTURES } from "../src/sim/breakdowns.js";
import { refreshPower, isPowered, POWER_USERS } from "../src/sim/power.js";
import { FRIDGE, POWER_FINDS, POWER_BUILDINGS } from "../src/sim/data-power.js";
import { APPLIANCE_TYPES, APPLIANCE_GEAR, COLD, RANGE, OVEN, MICROWAVE, PROPANE_FINDS } from "../src/sim/data-appliances.js";
import { setPlaced, placedInStores, placedItemKey, pickUpPlaced, governPower } from "../src/sim/electric.js";
import { appliancesOn, coldRooms, rangeFuel, rangeStatus, ovenBoost, cookBoost, govAppliances, rangeWaits, groupAppliancesDaily, groupColdRooms, rollPropane, isAppliance } from "../src/sim/appliances.js";
import { storeSpaces, storeFactor, FACTOR, STORE } from "../src/sim/storage.js";
import { cookBills, stationsAt, stationState, newBill, ensureStations, batchWhy, COOK_RECIPES, hasStation } from "../src/sim/cooking.js";
import { addFood, ageCoarse } from "../src/sim/foods.js";
import { safetyAI } from "../src/sim/autopilot.js";
import { syncBuildings, homesOf } from "../src/sim/groupbases.js";
import { groupMachinesDaily } from "../src/sim/groupworks.js";
import { buildMenu } from "../src/sim/basemap.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { hasItemArt } from "../src/ui/itemart.js";
import * as BM from "../src/sim/basemap.js";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(`\n${t}`);
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const plain = (s) => { s.traits = []; s.conditions = []; s.health = 100; s.mood = 60; s.inBed = false; return s; };
// The hub with n plain people, a hall to set things in, and the stores full; nothing on the grid yet.
function base(n = 6, s = seed) {
  const st = createWorld({ seed: s, factionCount: 6 });
  st.started = true; st.visitorsOff = true;
  const h = hub(st);
  for (const p of atBase(st, h.id)) { p.location = { kind: "away" }; p.alive = false; }
  for (let i = 0; i < n; i++) { const p = plain(makeSurvivor(st, 1)); p.location = { kind: "base", baseId: h.id }; p.role = "rest"; p.pinned = true; p.skills.cooking = 4; st.survivors.push(p); }
  Object.assign(h.stock, { water: 300, scrap: 200, parts: 20, fuel: 200, wood: 500 });
  BM.clearAllLand(st, h);
  addBuilding(h, "gen_hall");
  st.hour = Math.ceil(st.hour / 24) * 24 + 8;
  return { st, h };
}
const stock = (h, key, n = 1) => { for (let i = 0; i < n; i++) h.armory.push(newItem(key)); };
const set = (st, h, type) => { stock(h, placedItemKey(type)); const r = setPlaced(st, h, type); if (r.err) console.log(`    (${type}: ${r.err})`); return r.rec; };
const raw = (h, n = 20) => { addFood(h, "f_potatoes", n * 8); addFood(h, "f_venison", n * 2); };

section("The pieces");
{
  check(APPLIANCE_TYPES.join(",") === "chest_freezer,cold_case,range,oven,microwave", `five new kinds beside the fridge (${APPLIANCE_TYPES.join(", ")})`);
  for (const t of APPLIANCE_TYPES) {
    const key = placedItemKey(t), g = GEAR[key], b = BUILDINGS[t];
    const it = newItem(key);
    check(key === `f_${g.furniture}` && g.placed === t && g.bulky && g.twoHands && g.weight > 0, `${g.name}: item ${key} (furniture ${g.furniture}, ${g.weight} kg, bulky, both arms), set as ${t}`);
    check(isCarryable(it) && isTwoHands(it) && fitReason(it, "carry") === "" && !!fitReason(it, "pack") && hasItemArt(key), `${g.name}: In arms, never a pack, an icon`);
    check(b && b.set && b.furniture && b.fit && BM.FOOT[t] && BM.FOOT[t].fit && BM.FOOT[t].indoor && FIXTURES[t], `${b.name}: a set piece, a fitting's footprint (${BM.FOOT[t].w} × ${BM.FOOT[t].h}), a wear row`);
    check(!b.grid || !!POWER_USERS[t], `${b.name}: ${b.grid ? `draws ${POWER_USERS[t].need} power` : "draws no power"}`);
  }
  check(GEAR.f_chestfreezer.weight === 45 && GEAR.f_coldcase.weight === 120 && GEAR.f_stove.weight === 55 && GEAR.f_oven.weight === 50 && GEAR.f_microwave.weight === 12, "the issue's weights (45, 120, 55, 50, 12 kg)");
  check(POWER_USERS.chest_freezer.need === 2 && POWER_USERS.cold_case.need === 2 && POWER_USERS.range.need === 1 && POWER_USERS.microwave.need === 1, "the needs: freezer 2, cold case 2, range 1, microwave 1");
  check(placedItemKey("fridge") === "fridge" && GEAR.fridge && !APPLIANCE_GEAR.fridge && isAppliance("fridge"), "the Refrigerator stays the canonical fridge (its own key)");
  check(SUPPLIES.propane && SUPPLIES.propane.weight === 1 && GEAR.s_propane && hasItemArt("propane", "supply"), "propane: a supply (a kilo of bottled gas), its item form and its icon");
  const st = createWorld({ seed, factionCount: 6 });
  const menu = buildMenu(st, hub(st));
  const grp = (t) => (menu.find((x) => x.type === t) || {}).group;
  check(grp("chest_freezer") === "Power" && grp("cold_case") === "Power" && grp("microwave") === "Power" && grp("range") === "Fittings" && grp("oven") === "Fittings", `the Build list: the powered ones in Power, the range and the oven in Fittings (${APPLIANCE_TYPES.map((t) => `${t} ${grp(t)}`).join(", ")})`);
  const it = menu.find((x) => x.type === "range");
  check(it && it.furniture && it.have === 0 && !it.ok && /No kitchen range in the stores/.test(it.why), `none in the stores: it says so (${it && it.why})`);
  check(POWER_FINDS.house.items.f_stove * 3 === POWER_FINDS.house.items.fridge, "State Map finds: the range at a third of the fridge's weight");
}

section("The chest freezer and the cold case");
{
  const { st, h } = base();
  const fz = set(st, h, "chest_freezer");
  check(!!fz && placedInStores(h, "chest_freezer") === 0, "set from the stores onto the hall's floor");
  refreshPower(st, h);
  let sp = storeSpaces(h);
  check(sp.some((x) => x.key === "chest_freezeroff" && x.kind === "dry" && x.cap === COLD.chest_freezer.room) && !sp.some((x) => x.key === "chest_freezer"), `no generator: ${COLD.chest_freezer.room} days of pantry room (a cupboard)`);
  const gen = addBuilding(h, "generator");
  refreshPower(st, h);
  sp = storeSpaces(h);
  check(isPowered(h, fz) && appliancesOn(h, "freezer") === 1 && sp.some((x) => x.key === "chest_freezer" && x.kind === "freezer" && x.cap === 60), "powered: 60 days of freezer room");
  check(storeFactor("freezer", 20) === FACTOR.freezer && FACTOR.freezer === COLD.chest_freezer.factor, `at the walk-in's rate (×${FACTOR.freezer})`);
  h.powerOff = { [gen.id]: true };
  refreshPower(st, h);
  check(storeSpaces(h).some((x) => x.key === "chest_freezeroff" && x.cap === 60) && appliancesOn(h, "freezer") === 0, "the generator switched off: back to pantry room (it thaws)");
  delete h.powerOff[gen.id];
  const cc = set(st, h, "cold_case");
  refreshPower(st, h);
  sp = storeSpaces(h);
  check(!!cc && sp.some((x) => x.key === "cold_case" && x.kind === "coldcase" && x.cap === 100) && near(storeFactor("coldcase", 20), 0.3), "a cold case: 100 days at 0.3×");
  check(coldRooms(h).length === 2 && sp.some((x) => x.name === "Chest freezers") && sp.some((x) => x.name === "Cold cases"), "the Food tab's rooms: Chest freezers, Cold cases");
  fz.broken = true;
  check(!storeSpaces(h).some((x) => x.key.startsWith("chest_freezer")), "broken: it holds nothing");
}

section("The kitchen range");
{
  const { st, h } = base(8);
  check(!hasStation(h, "range"), "no range: no such station");
  const rg = set(st, h, "range");
  check(!!rg && hasStation(h, "range") && stationsAt(h, st).includes("range"), "set: a cooking station of its own");
  ensureStations(st, h);
  const S = stationState(h, "range");
  check(S.bills.length === 1 && S.bills[0].recipe === "simple", "a new range starts with Simple meal until 2 days of eating");
  // With neither power nor propane: idle.
  h.stock.propane = 0;
  refreshPower(st, h);
  let ss = stationStatus(st, h, rg);
  check(!ss.running && ss.idle && /No power and no propane/.test(ss.reason) && rangeFuel(st, h) === "", `no power, no propane: idle (${ss.reason})`);
  raw(h);
  const wood0 = h.stock.wood;
  cookBills(st, h);
  check(h.cookDay.st.range.batches === 0 && /no power and no propane/.test(h.cookDay.st.range.why), `nothing cooked (${h.cookDay.st.range.why})`);
  // On the grid: no wood.
  addBuilding(h, "generator");
  refreshPower(st, h);
  check(isPowered(h, rg) && rangeFuel(st, h) === "power", "a generator: the range is served (its bill wants cooking)");
  ss = stationStatus(st, h, rg);
  check(ss.running && /grid/.test(ss.reason), `running (${ss.reason})`);
  cookBills(st, h);
  const r1 = h.cookDay.st.range;
  check(r1.batches > 0 && h.stock.wood === wood0 && (h.cookDay.propane || 0) === 0, `powered: ${r1.batches} batches of meals, 0 wood, 0 propane (${r1.cooks.length} cook)`);
  check(rg.ran === h.cookDay.day, "the range's wear day (FIXTURES ranDay)");
  // Off the grid with propane: RANGE.propane a batch.
  h.powerOff = { [rg.id]: true };
  refreshPower(st, h);
  h.stock.propane = 5;
  for (const b of S.bills) { b.mode = "count"; b.n = 3; b.done = 0; }
  check(rangeFuel(st, h) === "propane" && /propane/.test(stationStatus(st, h, rg).reason), "switched off the grid: it cooks on propane");
  cookBills(st, h);
  const r2 = h.cookDay.st.range;
  check(r2.batches === 3 && near(h.stock.propane, 5 - 3 * RANGE.propane) && near(h.cookDay.propane, 3 * RANGE.propane) && h.stock.wood === wood0, `propane: ${r2.batches} batches for ${h.cookDay.propane} propane (${RANGE.propane} a batch), no wood`);
  h.stock.propane = 0.15;
  for (const b of S.bills) { b.done = 0; }
  cookBills(st, h);
  check(h.cookDay.st.range.batches === 1 && h.stock.propane < RANGE.propane, "the propane runs out: one batch and the range stops");
  // One cook a range, one range a RANGE.per people.
  const rg2 = set(st, h, "range");
  check(!!rg2, "a second range");
  h.stock.propane = 5;
  for (const b of S.bills) { b.done = 0; b.n = 20; }
  cookBills(st, h);
  check(h.cookDay.st.range.cooks.length === 1, `8 people: one range in use (one for every ${RANGE.per}): ${h.cookDay.st.range.cooks.length} cook`);
}

section("The oven and the microwave");
{
  const { st, h } = base(6);
  const rg = set(st, h, "range");
  addBuilding(h, "generator");
  ensureStations(st, h);
  addFood(h, "f_flour", 40);
  const S = stationState(h, "range");
  const bread = newBill(h, "bread", { mode: "count", n: 2 });
  S.bills = [bread];
  refreshPower(st, h);
  check(COOK_RECIPES.bread.oven && COOK_RECIPES.bread.at.includes("range"), "bread is a baking recipe (oven: true), made at a range");
  check(/needs an oven/.test(batchWhy(st, h, "range", bread)), `no oven: the range does not bake (${batchWhy(st, h, "range", bread)})`);
  check(ovenBoost(st, h) === 1, "no oven: ×1");
  const ov = set(st, h, "oven");
  check(!!ov && batchWhy(st, h, "range", bread) === "", "an oven: the range bakes");
  const hall = h.buildings.find((b) => b.type === "gen_hall");
  const inHall = BM.fittingsIn(st, h, hall.id).map((o) => o.rec && o.rec.type);
  check(inHall.includes("range") && inHall.includes("oven"), "both on the hall's floor");
  check(ovenBoost(st, h) === OVEN.boost && near(cookBoost(st, h, "range", COOK_RECIPES.bread), OVEN.boost), `an oven and a range in the same building: ×${OVEN.boost} at the range`);
  check(cookBoost(st, h, "canteen", COOK_RECIPES.simple) === 1, "... not at another station");
  const b0 = h.stock.f_bread || 0;
  cookBills(st, h);
  check((h.stock.f_bread || 0) > b0 && h.cookDay.st.range.batches === 2, `bread baked at the range (${h.cookDay.st.range.batches} batches)`);
  check(ov.ran === h.cookDay.day, "the oven's wear day");
  // The microwave: ×1.1 on a meal's time while powered.
  const mw = set(st, h, "microwave");
  S.bills.push(newBill(h, "simple", { mode: "forever" }));
  refreshPower(st, h);
  check(isPowered(h, mw), "the microwave is served while the cooks have work");
  check(near(cookBoost(st, h, "canteen", COOK_RECIPES.simple), MICROWAVE.boost) && near(cookBoost(st, h, "range", COOK_RECIPES.simple), OVEN.boost * MICROWAVE.boost), `×${MICROWAVE.boost} on a meal anywhere (×${OVEN.boost * MICROWAVE.boost} at the range beside the oven)`);
  check(near(cookBoost(st, h, "canteen", COOK_RECIPES.flour), 1), "...not on flour (not a meal)");
  h.powerOff = { [mw.id]: true };
  refreshPower(st, h);
  check(cookBoost(st, h, "canteen", COOK_RECIPES.simple) === 1, "switched off: ×1");
}

section("Picked up whole");
{
  const { st, h } = base();
  addBuilding(h, "generator");
  for (const t of ["fridge", ...APPLIANCE_TYPES]) {
    stock(h, placedItemKey(t));
    h.armory[h.armory.length - 1].quality = 0.63;
    const r = setPlaced(st, h, t);
    if (!check(!r.err && r.rec, `${BUILDINGS[t].name} set (${r.err || r.msg})`)) continue;
    const n0 = h.armory.length;
    const msg = demolish(st, h, r.rec.id);
    const back = h.armory[h.armory.length - 1];
    check(h.armory.length === n0 + 1 && back.key === placedItemKey(t) && back.quality === 0.63 && !h.buildings.includes(r.rec), `Demolish: back into the stores whole (${back.key}, its condition kept) · ${msg}`);
  }
  const rec = set(st, h, "cold_case");
  rec.item = null;
  pickUpPlaced(st, h, rec);
  check(h.armory[h.armory.length - 1].key === "f_coldcase", "a record without its item comes back as a fresh one of its kind");
}

section("The governor");
{
  const { st, h } = base(10);
  st.autopilot = true;
  Object.assign(h.stock, { scrap: 300, parts: 20, stone: 100, wood: 3000 });
  const wish = () => safetyAI.buildWishes(st, h).some((w) => w.type === "canteen");
  check(wish(), "10 people and no Kitchen: the governor wishes for one");
  stock(h, "f_stove");
  check(rangeWaits(st, h) && !wish(), "a range in the stores: no Kitchen wish while it can be set");
  stock(h, "f_chestfreezer"); stock(h, "fridge");
  const lines = governPower(st, h);
  check(h.buildings.some((b) => b.type === "range") && placedInStores(h, "range") === 0 && lines.some((l) => /Kitchen range set/.test(l)), "governPower sets the range (no power needed: it cooks on propane)");
  check(placedInStores(h, "fridge") === 1 && placedInStores(h, "chest_freezer") === 1, "the fridge and the freezer wait: nothing here makes power");
  check(!rangeWaits(st, h), "the range set: nothing waits any more");
  addBuilding(h, "generator");
  const l2 = govAppliances(st, h);
  check(l2.length === 2 && /Refrigerator/.test(l2[0]) && /Chest freezer/.test(l2[1]), `a generator: the fridge before the freezer (${l2.map((l) => l.split(" set")[0]).join(", ")})`);
}

section("AI groups");
{
  const st = createWorld({ seed, factionCount: 6 });
  st.started = true;
  const f = st.factions.find((x) => x.alive !== false && x.bases && x.bases.length && !x.outsider);
  const tile = f.bases[0];
  f.works = f.works || {};
  f.works[tile] = { ...(f.works[tile] || {}), hall: 1 };
  syncBuildings(st, f);
  const h = homesOf(st, f)[tile];
  check(h.buildings.some((b) => b.type === "gen_lodge"), "their hall stands (a Lodge)");
  h.armory.push(newItem("fridge"));
  const n = groupAppliancesDaily(st, f);
  const fr = h.buildings.find((b) => b.type === "fridge");
  check(n === 1 && !!fr && fr.item && !h.armory.some((it) => it.key === "fridge"), "a fridge in their armory: set by your rule (setPlaced)");
  syncBuildings(st, f);
  check(h.buildings.includes(fr), "kept by their works' sync (a set piece is not one of their works)");
  // Their power: a generator and fuel; the fridge is a user of their day budget.
  f.works[tile].power = 1; f.works[tile].powerTier = 1;
  f.stock.fuel = 50; f.stock.parts = 10; f.stock.scrap = 30;
  st.hour = Math.ceil(st.hour / 24) * 24;
  groupMachinesDaily(st, f);
  check(fr.groupOn === true && groupColdRooms(st, f).some((c) => c.room === FRIDGE.room && c.factor === FRIDGE.factor), "their generator served it: on today, a cold room at your fridge's factor");
  const a = { f_venison: 20 }, b = { f_venison: 20 };
  const lostWarm = ageCoarse(a, 1, 0.8), lostCold = ageCoarse(b, 1, 0.8, { cold: groupColdRooms(st, f) });
  check(lostCold < lostWarm * 0.5, `their food keeps in it (${lostCold.toFixed(3)} lost a day, ${lostWarm.toFixed(3)} without)`);
  f.stock.fuel = 0;
  groupMachinesDaily(st, f);
  check(fr.groupOn === false && !groupColdRooms(st, f).length, "no fuel: off, no cold room");
}

section("Propane finds");
{
  const st = createWorld({ seed, factionCount: 6 });
  const tile = st.tiles.findIndex((t) => t && t.loc && t.loc.type === "hardware");
  let got = 0, hrs = 0;
  if (tile >= 0) for (let i = 0; i < 400; i++) { st.hour = 100 + i; const q = rollPropane(st, tile, null, 1, "t"); if (q > 0) { got += q; hrs++; } }
  check(tile < 0 || (hrs > 400 * PROPANE_FINDS.hardware[0] * 0.5 && hrs < 400 * PROPANE_FINDS.hardware[0] * 1.6), `a hardware store: propane in ${hrs} of 400 search hours (${got} kg)`);
}

section("Save and load");
{
  const { st, h } = base();
  set(st, h, "range"); set(st, h, "chest_freezer");
  h.stock.propane = 2;
  const st2 = loadFromString(saveToString(st));
  const h2 = hub(st2);
  check(h2.buildings.some((b) => b.type === "range" && b.item && b.item.key === "f_stove") && h2.buildings.some((b) => b.type === "chest_freezer") && h2.stock.propane === 2, "the set pieces, their items and the propane survive a save");
  check(rangeStatus(st2, h2).running, "and the range cooks on the propane after loading");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
