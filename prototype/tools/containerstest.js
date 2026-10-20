// Containers (src/sim/containers.js over src/sim/basestorage.js; basemap.js makeStores, takeLoot, applyStolen;
// docs/base-building/plan.md Part B and "Merged with dev's base storage limits"): where a base keeps its goods. The room
// is basestorage.js storageOf's (the core by tier, a camp none; STORE_KG for the storage buildings, shelves 150 and
// lockers 100 among them; a parked car's payload); containers.js says which container something is kept in. Checks:
// the containers of a bare hub (the core, the car it starts with, then "loose" and "outside") and of one with a
// storehouse, crates, a cellar and a parked car, their room and labels, a camp with no core; putting an item or n of a
// supply into a container with room and without, taking it out again, the bins clamped when the stock drops
// (takeStock), stale keys dropped when a building is pulled down or a car leaves; storageOf honouring the assignments
// (an assigned good fills its container first, the rest the room left, the same inside/outside total as without);
// autoStore deterministic and a fixed point, the densest first, food in the food containers, dear things in the core,
// nothing put in a car by the game; the stores on the map honouring the assignments (an item put in the car is in the
// car's map container, the storehouse bin's supplies in the storehouse's, what lies outside on the piles, every unit
// of stock and every armory item in exactly one container); a raid where a thief loots the car and gets away (the
// stock, the armory and the bins lose exactly that; what a killed thief dropped stays); the AI groups' bases tidied
// the same way; a save / load round trip keeping bins and item.store.
// Usage: node tools/containerstest.js [seed]
import { createWorld, hub, atBase, makeSurvivor } from "../src/sim/world.js";
import { createBattle, registerCombatHandler, CELL, unitAt } from "../src/sim/combat.js";
import { addBuilding, demolish, BUILDINGS } from "../src/sim/buildings.js";
import { newItem, itemKg } from "../src/sim/inventory.js";
import { createVehicle, VEHICLE_TYPES } from "../src/sim/vehicles.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { FOODS } from "../src/sim/foods.js";
import { peopleUp } from "../src/sim/factions.js";
import { homesOf } from "../src/sim/groupbases.js";
import * as BM from "../src/sim/basemap.js";
import * as CT from "../src/sim/containers.js";
import { storageOf, CORE_KG, STORE_KG, itemRoomKg } from "../src/sim/basestorage.js";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(`\n${t}`);
const t0 = Date.now();
registerCombatHandler("dt", () => {});
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 6 }); st.started = true; return st; };
const EPS = 1e-6;
const r1 = (v) => Math.round(v * 10) / 10;
const byType = (h, type, n = 0) => h.buildings.filter((b) => b.type === type)[n];
const keyOf = (b) => `b:${b.id}`;
function fortHub(st, list, extra = 2) {
  const h = hub(st);
  for (const t of list) addBuilding(h, t);
  for (let i = 0; i < extra; i++) { const s = makeSurvivor(st); s.location = { kind: "base", baseId: h.id }; st.survivors.push(s); }
  for (const s of atBase(st, h.id)) { s.health = 100; if (!s.gear.weapon) s.gear.weapon = newItem("pistol"); }
  return h;
}
function baseBattle(st, h, enemy = { kind: "raiders", count: 8, power: 3, name: "raiders" }, context = {}) {
  globalThis.window = {};
  try {
    st.combat = createBattle(st, { tile: h.tile, baseId: h.id, enemy, ambush: null, canRetreat: true, handler: "dt", layout: "baseDefence", deploy: true, downedLive: 0.4, context: { night: false, ready: { manned: true }, ...context } });
  } finally { delete globalThis.window; }
  return st.combat;
}
// The assignments by container label (building and car ids are a process-wide counter: two worlds' keys differ).
const snapshot = (st, h) => { const L = CT.containersOf(st, h); const lab = (k) => (L.find((c) => c.key === k) || {}).label || k; return JSON.stringify([Object.entries(h.bins || {}).map(([k, bin]) => [lab(k), bin]).sort(), h.armory.map((it) => (it.store ? lab(it.store) : null))]); };
const stockTotal = (h) => Object.entries(h.stock).filter(([, q]) => typeof q === "number").reduce((a, [, q]) => a + q, 0);

section("The containers of a base");
{
  const st = world();
  const h = hub(st);
  const L0 = CT.containersOf(st, h).filter((c) => c.kind !== "vehicle"); // (the hub starts with a truck parked at it)
  check(L0.length === 3 && L0[0].key === "core" && L0[1].key === CT.LOOSE && L0[2].key === CT.OUTSIDE, `a bare hub: ${L0.map((c) => c.key).join(", ")} (and the car it starts with)`);
  check(L0[0].cap === CORE_KG.hub && L0[0].kind === "core" && L0[0].label === "Main house and cellar" && L0[0].foodOk && L0[0].assignable, `the core holds ${L0[0].cap} kg (a hub, basestorage.js CORE_KG)`);
  const S0 = storageOf(st, h);
  check(L0[0].kg === 0 && L0[1].kg > 0 && Math.abs(L0[1].kg - S0.loose.kg) < 0.11 && L0[2].kg === 0 && L0[1].cap === Infinity && !L0[1].assignable, `nothing put away yet: everything put away nowhere, inside the room (${r1(L0[1].kg)} kg), nothing outside`);
  check(L0[0].free === L0[0].cap, "the core's room is all free (nothing assigned to it)");
  for (const t of ["storehouse", "crates", "crates", "cellar"]) addBuilding(h, t);
  const car = createVehicle(st, "sedan", { kind: "base", baseId: h.id });
  const L = CT.containersOf(st, h).filter((c) => c.kind !== "vehicle" || c.vid === car.id);
  const store = byType(h, "storehouse"), crates1 = byType(h, "crates", 0), crates2 = byType(h, "crates", 1), cellar = byType(h, "cellar");
  check(L.map((c) => c.key).join() === ["core", keyOf(store), keyOf(crates1), keyOf(crates2), keyOf(cellar), `v:${car.id}`, CT.LOOSE, CT.OUTSIDE].join(), `with a storehouse, two crates, a cellar and a parked car: ${L.map((c) => c.key).join(", ")}`);
  const by = {}; for (const c of L) by[c.key] = c;
  check(by[keyOf(store)].cap === 2000 && by[keyOf(crates1)].cap === 150 && by[keyOf(cellar)].cap === 400 && by[`v:${car.id}`].cap === VEHICLE_TYPES.sedan.payload, `room (basestorage.js): storehouse ${by[keyOf(store)].cap}, crates ${by[keyOf(crates1)].cap}, cellar ${by[keyOf(cellar)].cap}, the car ${by[`v:${car.id}`].cap} (its payload)`);
  check(by[keyOf(store)].label === "Storehouse" && by[keyOf(crates1)].label === "Storage crates 1" && by[keyOf(crates2)].label === "Storage crates 2" && by[`v:${car.id}`].label === car.name, `labels: ${L.map((c) => c.label).join(", ")}`);
  check(by[keyOf(store)].kind === "building" && by[keyOf(store)].bid === store.id && by[`v:${car.id}`].kind === "vehicle" && by[`v:${car.id}`].vid === car.id, "a building container names its building, a car's its car");
  check(by[keyOf(cellar)].foodOk && by[keyOf(store)].foodOk && by[keyOf(crates1)].foodOk && by[`v:${car.id}`].foodOk, "food may go in the cellar, the storehouse, the crates and the car");
  check(CT.isContainerType("storehouse") && CT.isContainerType("lockers") && CT.isContainerType("storebox") && !CT.isContainerType("bunkhouse") && STORE_KG.shelves === 150 && STORE_KG.lockers === 100 && BUILDINGS.shelves.storeKg === 150 && BUILDINGS.lockers.storeKg === 100, "isContainerType and the room of the fittings (STORE_KG: shelves 150, lockers 100)");
  // basestorage.js counts a broken building's room (a broken roof still keeps the goods in): it stays a container.
  crates2.broken = true;
  check(CT.containersOf(st, h).some((c) => c.key === keyOf(crates2)), "a broken storage building is still a container (basestorage.js: its room still counts)");
  delete crates2.broken;
  // A camp: no core room at all.
  const st2 = world(), c2 = hub(st2);
  c2.tier = 0; c2.camp = true; c2.buildings = []; c2.construction = [];
  const LC = CT.containersOf(st2, c2);
  check(!LC.some((c) => c.key === "core") && LC.some((c) => c.kind === "vehicle"), `a camp: no core container, its truck the only room (${LC.map((c) => c.key).join(", ")})`);
}

section("Putting things away by hand");
{
  const st = world();
  const h = hub(st);
  for (const t of ["storehouse", "crates", "cellar"]) addBuilding(h, t);
  const car = createVehicle(st, "sedan", { kind: "base", baseId: h.id });
  const store = keyOf(byType(h, "storehouse")), crates = keyOf(byType(h, "crates")), cellar = keyOf(byType(h, "cellar")), vk = `v:${car.id}`;
  const pistol = newItem("pistol"), vest = newItem("vest");
  h.armory.push(pistol, vest);
  h.stock.meds = 40; h.stock.scrap = 200;
  check(CT.putItem(st, h, pistol, crates) === "" && pistol.store === crates, "a pistol into the crates (item.store)");
  check(/not a container/i.test(CT.putItem(st, h, vest, "b:999999")) && vest.store == null, `a key that is no container: refused (${CT.putItem(st, h, vest, "b:999999")})`);
  check(/not in the armory/i.test(CT.putItem(st, h, newItem("knife"), "core")), "an item not in the armory: refused");
  check(CT.putSupply(st, h, "scrap", 50, crates) === "" && h.bins[crates].scrap === 50, "50 scrap (100 kg) into the crates (base.bins)");
  const full = CT.putSupply(st, h, "scrap", 30, crates);
  check(/No room in the storage crates/.test(full), `30 more (60 kg into the crates' 50 kg of room left): refused (${full})`);
  check(/Not that many/.test(CT.putSupply(st, h, "meds", 100, store)), "more meds than the base has: refused");
  check(CT.putSupply(st, h, "meds", 10, store) === "" && h.bins[store].meds === 10, "10 meds into the storehouse");
  check(CT.putSupply(st, h, "meds", 4, cellar, store) === "" && h.bins[store].meds === 6 && h.bins[cellar].meds === 4, "4 of them on to the cellar (from the storehouse's bin)");
  check(CT.putSupply(st, h, "meds", 4, null, cellar) === "" && !h.bins[cellar], "and out of the cellar again (unassigned; the empty bin gone)");
  check(CT.putItem(st, h, pistol, null) === "" && pistol.store == null, "the pistol out of the crates");
  check(CT.putItem(st, h, vest, vk) === "" && vest.store === vk && CT.putSupply(st, h, "meds", 20, vk) === "" && h.bins[vk].meds === 20, "the vest and 20 meds into the car");
  const L = CT.containersOf(st, h);
  const loose = L.find((c) => c.key === CT.LOOSE), outside = L.find((c) => c.key === CT.OUTSIDE);
  check(loose.sup.meds === 14 && loose.sup.scrap === 150 && loose.gear.some((g) => g.item === pistol) && outside.kg === 0 && Math.abs(L.find((c) => c.key === vk).kg - (20 * 0.1 + itemRoomKg(vest))) < EPS, `what is unassigned is put away nowhere, inside the room left (${loose.sup.meds} meds, ${loose.sup.scrap} scrap, the pistol); the car ${r1(L.find((c) => c.key === vk).kg)} kg`);
  // The stock drops (eaten, spent, stolen): the bins shrink to fit.
  BM.takeStock(h, "meds", 25);
  CT.normalizeBins(st, h);
  const held = (h.bins[store] ? h.bins[store].meds || 0 : 0) + (h.bins[vk] ? h.bins[vk].meds || 0 : 0);
  check(h.stock.meds === 15 && held === 15 && h.bins[store].meds === 4 && h.bins[vk].meds === 11, `the stock down to 15 meds: the bins clamped to it (storehouse ${h.bins[store].meds}, car ${h.bins[vk].meds})`);
  h.bins[store].meds = NaN; h.bins["b:424242"] = { scrap: 5 };
  CT.normalizeBins(st, h);
  check(!h.bins[store] && !h.bins["b:424242"], "NaN and a bin of a container that never was: dropped");
  // A building pulled down, a car gone: their keys go.
  const cr = byType(h, "crates");
  const res = demolish(st, h, cr.id);
  CT.containersOf(st, h);
  check(/pulled down/.test(res) && !h.bins[crates] && !h.buildings.includes(cr), "the crates pulled down: their bin gone with them");
  car.loc = { kind: "party", partyId: 1 };
  CT.containersOf(st, h);
  check(!h.bins[vk] && vest.store == null, "the car drove off: its bin and the vest's assignment gone");
  car.loc = { kind: "base", baseId: h.id };
  check(!CT.containersOf(st, h).find((c) => c.key === vk).kg, "back again, empty");
}

section("The game tidying up (autoStore)");
{
  const make = () => {
    const st = world();
    const h = hub(st);
    for (const t of ["storehouse", "cellar", "crates"]) addBuilding(h, t);
    if (BUILDINGS.lockers) addBuilding(h, "lockers");
    const car = createVehicle(st, "sedan", { kind: "base", baseId: h.id });
    h.stock.meds = 30; h.stock.scrap = 100; h.stock.parts = 12;
    h.armory.push(newItem("pistol"), newItem("knife"), newItem("vest"), newItem("machete"));
    CT.putSupply(st, h, "scrap", 10, `v:${car.id}`); // the player loaded the car
    return { st, h, car };
  };
  const { st, h, car } = make();
  const total0 = stockTotal(h), arm0 = h.armory.length;
  const r = CT.autoStore(st, h);
  const snap1 = snapshot(st, h);
  const r2 = CT.autoStore(st, h);
  check(r.gear === arm0 && r.kg > 0 && r2.gear === 0 && Object.keys(r2.sup).length === 0 && snapshot(st, h) === snap1, `autoStore put ${r.gear} items and ${r1(r.kg)} kg away; a second call changes nothing (a fixed point)`);
  const o = make();
  CT.autoStore(o.st, o.h);
  check(snapshot(o.st, o.h) === snap1, "the same base tidied the same way twice (deterministic, no dice)");
  check(stockTotal(h) === total0 && h.armory.length === arm0, "nothing in or out of the books (the stock and the armory unchanged)");
  const store = keyOf(byType(h, "storehouse")), cellar = keyOf(byType(h, "cellar")), vk = `v:${car.id}`;
  const foodKeys = Object.keys(h.stock).filter((k) => FOODS[k] && h.stock[k] >= 1);
  const inFood = foodKeys.every((k) => Object.entries(h.bins).filter(([, bin]) => bin[k] > 0).every(([key]) => CT.containersOf(st, h).find((c) => c.key === key).foodOk));
  check(foodKeys.length > 0 && inFood && foodKeys.every((k) => h.bins[cellar] && h.bins[cellar][k] === Math.floor(h.stock[k])), `the food (${foodKeys.length} kinds) in the cellar (food containers only)`);
  check(h.bins.core && h.bins.core.meds === 30 && h.bins.core.parts === 12, "dear things (meds, parts) in the core");
  check(h.bins[store] && h.bins[store].scrap === 90 && !h.bins[store].wood && !Object.values(h.bins).some((bin) => bin.wood), "the scrap in the storehouse; the woodpile in no container (it takes no room: basestorage.js woodpileOf)");
  check(JSON.stringify(h.bins[vk]) === JSON.stringify({ scrap: 10 }) && !h.armory.some((it) => it.store === vk), "nothing in the car but what the player put there");
  const dear = h.armory.filter((it) => CT.isDearItem(it)), plain = h.armory.filter((it) => !CT.isDearItem(it));
  check(dear.length === 2 && dear.every((it) => it.store === "core" || it.store === store) && plain.every((it) => it.store && it.store !== vk), `the pistol and the vest in the core or the storehouse, the knife and the machete in ${[...new Set(plain.map((it) => CT.containersOf(st, h).find((c) => c.key === it.store).label))].join(" / ")}`);
  const S = CT.storageKg(st, h), SO = storageOf(st, h);
  const L = CT.containersOf(st, h);
  const capAll = L.filter((c) => c.assignable || c.kind === "box").reduce((a, c) => a + c.cap, 0);
  check(S.cap === capAll && S.cap === SO.cap && S.outside === 0 && Object.keys(S.byKey).length === L.filter((c) => c.key !== CT.LOOSE && c.key !== CT.OUTSIDE).length && S.byKey[store].cap === 2000 && L.filter((c) => c.assignable).every((c) => Math.abs(S.byKey[c.key].kg - c.kg) < EPS), `storageKg: ${S.cap} kg of room (storageOf's), ${r1(S.held)} inside, ${r1(S.outside)} outside`);
  const looseKg = L.find((c) => c.key === CT.LOOSE).kg;
  check(looseKg < 1, `everything put away (${r1(looseKg)} kg left put away nowhere)`);
  // Tidy up (all): what was put somewhere odd by hand is laid out afresh; the car's load is left alone.
  const pistol = h.armory.find((it) => it.key === "pistol");
  check(CT.putItem(st, h, pistol, cellar) === "" && pistol.store === cellar, "the pistol put in the cellar by hand");
  CT.autoStore(st, h, { all: true });
  check(pistol.store !== cellar && snapshot(st, h) === snap1, "Tidy up (all) lays everything out again the same way, the car's load kept");
  // No room anywhere: the cheapest for its weight lies outside (basestorage.js's order), the containers full.
  const out0 = storageOf(st, h);
  h.stock.scrap = 3000;
  CT.autoStore(st, h);
  const S2 = storageOf(st, h), K2 = CT.storageKg(st, h);
  check(S2.outsideKg > 0 && S2.inside <= S2.cap + EPS && L.filter((c) => c.assignable).every((c) => K2.byKey[c.key].kg <= c.cap + EPS), `6000 kg of scrap: the containers full (${r1(S2.inside)} of ${S2.cap} kg), ${r1(S2.outsideKg)} kg outside`);
  check(S2.outside.sup.scrap > 0 && !S2.outside.sup.meds && !S2.outside.sup.parts && !S2.outside.gear.length, `what lies outside is the scrap, never the meds, parts or the gear (${Object.keys(S2.outside.sup).join(", ")})`);
  check(out0.outsideKg === 0 && Math.abs(S2.used - out0.used - (3000 - 100) * 2) < 0.2, "storageOf counts every kg, assigned or not, inside or out");
  // The assignments change where things are, never how much fits: the same goods unassigned lie outside alike.
  const bins = JSON.stringify(h.bins), stores = h.armory.map((it) => it.store);
  h.bins = {}; for (const it of h.armory) delete it.store;
  const S3 = storageOf(st, h);
  check(Math.abs(S3.outsideKg - S2.outsideKg) <= 2 && Math.abs(S3.cap - S2.cap) < EPS, `unassigned, the fill leaves the same outside within a unit (${r1(S3.outsideKg)} kg against ${r1(S2.outsideKg)})`);
  h.bins = JSON.parse(bins); h.armory.forEach((it, i) => { if (stores[i] != null) it.store = stores[i]; });
}

section("The stores on the map honour the assignments");
{
  const st = world();
  const h = fortHub(st, ["bunkhouse", "storehouse", "crates"]);
  h.stock.meds = 60; h.stock.scrap = 3000; // 6000 kg of scrap: more than every container holds
  const car = createVehicle(st, "sedan", { kind: "base", baseId: h.id });
  check(!BM.placeItem(st, h, `v:${car.id}`, -12, 8, 0), "the car parked by hand");
  const vest = newItem("vest"), pistol = newItem("pistol");
  h.armory.push(vest, pistol);
  const store = keyOf(byType(h, "storehouse")), crates = keyOf(byType(h, "crates")), vk = `v:${car.id}`;
  check(CT.putItem(st, h, vest, vk) === "" && CT.putSupply(st, h, "meds", 20, vk) === "" && CT.putSupply(st, h, "meds", 30, store) === "" && CT.putItem(st, h, pistol, crates) === "", "the vest and 20 meds in the car, 30 meds in the storehouse, the pistol in the crates");
  const b = baseBattle(st, h);
  const boxes = b.stores.containers;
  const carBox = boxes.find((c) => c.key === vk), storeBox = boxes.find((c) => c.key === store), cratesBox = boxes.find((c) => c.key === crates);
  check(!!carBox && carBox.vid === car.id && carBox.w > 0 && carBox.asg.meds === 20 && carBox.sup.meds >= 20 && carBox.gear.some((g) => g.ai === h.armory.indexOf(vest)), `the car is a container at its rect with the vest and its 20 meds (${carBox ? carBox.label : "none"})`);
  check(!!storeBox && storeBox.asg.meds === 30 && storeBox.sup.meds >= 30, `the storehouse's container has its 30 meds (${storeBox && storeBox.sup.meds} in all with what was spread)`);
  check(!!cratesBox && cratesBox.gear.some((g) => g.ai === h.armory.indexOf(pistol)), "the pistol is in the crates' container");
  const total = (key) => boxes.reduce((a, c) => a + (c.sup[key] || 0), 0);
  const allKeys = Object.keys(h.stock).filter((k) => typeof h.stock[k] === "number" && Math.floor(h.stock[k]) > 0);
  check(allKeys.every((k) => total(k) === Math.floor(h.stock[k])), `every unit of the stock is in exactly one container (${allKeys.length} keys)`);
  const ais = boxes.flatMap((c) => c.gear.map((g) => g.ai));
  check(ais.length === h.armory.length && new Set(ais).size === ais.length, `every armory item too, once (${ais.length})`);
  const kgByKey = {};
  for (const c of boxes) kgByKey[c.key] = (kgByKey[c.key] || 0) + c.kg;
  // The unassigned inside are shared by the room each container has left (dev's spread: a share by room, ± the dice),
  // so a container may hold a little more or less than its room on the map; the total inside is storageOf's.
  const inMap = boxes.filter((c) => !c.pile).reduce((a, c) => a + c.kg, 0), SO = storageOf(st, h);
  check(Math.abs(inMap - SO.inside) <= 0.02 * SO.inside + 5 && kgByKey[store] <= 2000 * 1.3 && kgByKey[crates] <= 150 * 1.3 + 2 && kgByKey.core <= CORE_KG.hub * 1.3, `inside on the map ${Math.round(inMap)} kg, storageOf's inside ${Math.round(SO.inside)} kg, each a share by its room (storehouse ${Math.round(kgByKey[store])} of 2000 kg, crates ${Math.round(kgByKey[crates])} of 150, the car ${Math.round(kgByKey[vk])} of ${VEHICLE_TYPES.sedan.payload}, the core ${Math.round(kgByKey.core)} of ${CORE_KG.hub})`);
  const piles = boxes.filter((c) => c.pile), want = BM.outsideOf(st, h);
  const pileSup = {}; for (const p of piles) for (const [k, n] of Object.entries(p.sup)) pileSup[k] = (pileSup[k] || 0) + n;
  check(piles.length > 0 && piles.every((p) => p.key === CT.OUTSIDE) && Object.keys({ ...pileSup, ...want.sup }).every((k) => (pileSup[k] || 0) === (want.sup[k] || 0)) && pileSup.scrap > 0 && !pileSup.meds, `the overflow lies outside on ${piles.length} pile(s): exactly what storageOf says lies outside (${Math.round(piles.reduce((a, p) => a + p.kg, 0))} kg, the scrap; none of the meds)`);
  check(boxes.every((c) => c.key && c.id && typeof c.x === "number" && c.sup && c.gear), "every map container carries key, id, label and its rect");
  st.combat = null;
}

section("A thief loots the car and gets away");
{
  const st = world();
  const h = fortHub(st, ["bunkhouse", "storehouse"], 0);
  for (const s of atBase(st, h.id)) s.gear.weapon = newItem("knife");
  h.stock.meds = 40; h.stock.parts = 30;
  const car = createVehicle(st, "sedan", { kind: "base", baseId: h.id });
  check(!BM.placeItem(st, h, `v:${car.id}`, -12, 8, 0), "the car parked by hand in the yard");
  const vest = newItem("vest");
  h.armory.push(vest, newItem("pistol"));
  const vk = `v:${car.id}`, store = keyOf(byType(h, "storehouse"));
  for (const it of h.armory) if (it !== vest) CT.putItem(st, h, it, "core"); // the rest of the armory behind the core's door (none of it spread into the car)
  check(CT.putItem(st, h, vest, vk) === "" && CT.putSupply(st, h, "meds", 10, vk) === "" && CT.putSupply(st, h, "meds", 20, "core") === "" && CT.putSupply(st, h, "meds", 10, store) === "" && CT.putSupply(st, h, "parts", 30, "core") === "", "the vest and 10 meds in the car, 20 meds and the parts in the core, 10 meds in the storehouse");
  const b = baseBattle(st, h, { kind: "raiders", count: 10, power: 4, name: "raiders" });
  for (const u of b.units) if (u.side === "enemy") u.thief = true;
  const boxes = b.stores.containers;
  const carBox = boxes.find((c) => c.key === vk);
  check(!!carBox && carBox.kg > 0.5, `the loaded car is a container on the map (${carBox ? r1(carBox.kg) : 0} kg)`);
  const near = (c, x, y) => Math.max(c.x - x, x - (c.x + c.w - 1), c.y - y, y - (c.y + c.h - 1), 0) <= 1;
  const inRect = (c, x, y) => x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h;
  let spot = null;
  for (let y = carBox.y - 1; y <= carBox.y + carBox.h && !spot; y++) for (let x = carBox.x - 1; x <= carBox.x + carBox.w; x++) {
    const c = b.cells[y * b.w + x];
    if (!c || !CELL[c.k].walk || unitAt(b, x, y) || inRect(carBox, x, y) || boxes.some((o) => o !== carBox && o.kg > 0.5 && near(o, x, y))) continue;
    spot = [x, y]; break;
  }
  const t = b.units.find((u) => u.side === "enemy" && u.thief);
  t.x = spot[0]; t.y = spot[1]; t.aware = true;
  for (const u of b.units) if (u.side === "player") { u.x = 0; u.y = 0; }
  b.tier.stage = "yard";
  for (let i = 0; i < 3 && !(t.loot && t.loot.sup.meds === 10 && t.loot.gear.length); i++) { t.ap = 2; BM.thiefTurn(b, t); } // STEAL.TURN a turn: the vest may take one
  check(!!t.loot && t.loot.gear.some((g) => g.ai === h.armory.indexOf(vest)) && t.loot.sup.meds === 10 && t.loot.from && t.loot.from[vk] && t.loot.from[vk].meds === 10, `the raider by the car takes the vest and the 10 meds from it (${t.loot ? r1(t.loot.kg) : 0} kg), charged to the car's bin`);
  check(!carBox.sup.meds && !carBox.gear.some((g) => g.ai === h.armory.indexOf(vest)), "the car's meds and the vest are gone from it");
  const stock0 = { ...h.stock }, arm0 = h.armory.length;
  t.fled = true;
  const other = b.units.find((u) => u.side === "enemy" && u !== t);
  other.loot = { sup: { meds: 5 }, gear: [], kg: 0.5, from: { core: { meds: 5 } } }; other.dead = true; // killed with it: dropped where it fell
  BM.settleBaseBattle(st, b);
  check(!!b.stolen && b.stolen.sup.meds === 10 && b.stolen.gear.length === 1 && b.stolen.from[vk].meds === 10 && !b.stolen.from.core, "what left the map is the loot that leaves, by the container it came from; the dead one's stays");
  const res = BM.applyStolen(st, h, b.stolen);
  check(!!res && res.sup.meds === 10 && res.gear.length === 1 && res.gear[0] === vest, `the raiders' group gets it (${res ? res.text : "nothing"})`);
  check(h.stock.meds === stock0.meds - 10 && h.stock.parts === stock0.parts && h.armory.length === arm0 - 1 && !h.armory.includes(vest), "the stock and the armory lose exactly that");
  check(!(h.bins[vk] && h.bins[vk].meds) && h.bins.core && h.bins.core.meds === 20, `the car's bin lost its 10 meds, the core's keeps its 20 (${JSON.stringify(h.bins)})`);
  const L = CT.containersOf(st, h);
  check(L.find((c) => c.key === vk).kg === 0 && L.find((c) => c.key === "core").sup.meds === 20 && L.find((c) => c.key === store).sup.meds === 10, "the containers afterwards: nothing kept in the car any more, the core's 20 and the storehouse's 10 meds (the 5 the dead one dropped were never gone)");
  st.combat = null;
}

section("The AI groups' bases tidied the same way");
{
  const st = world();
  const f = st.factions.find((x) => x.alive && x.bases.length);
  const before = Object.values(homesOf(st, f)).map((b) => stockTotal(b.stock ? b : { stock: {} }));
  peopleUp(st, f);
  const homes = Object.values(homesOf(st, f));
  const main = homes.find((b) => b.type === "hub");
  check(!!main && main.bins && Object.keys(main.bins).length > 0 && main.bins.core, `${f.name}'s main base has its goods put away (${Object.keys(main.bins).join(", ")})`);
  check(homes.every((b, i) => stockTotal(b) === before[i]), "nothing from nowhere: every base's stock unchanged by the tidying");
  const snap = homes.map((b) => snapshot(st, b)).join("|");
  peopleUp(st, f);
  check(homes.map((b) => snapshot(st, b)).join("|") === snap, "a second day's tidying changes nothing");
}

section("Save / load keeps the assignments");
{
  const st = world();
  const h = hub(st);
  addBuilding(h, "storehouse");
  const car = createVehicle(st, "sedan", { kind: "base", baseId: h.id });
  const vest = newItem("vest");
  h.armory.push(vest);
  h.stock.meds = 20;
  CT.putItem(st, h, vest, `v:${car.id}`);
  CT.putSupply(st, h, "meds", 8, keyOf(byType(h, "storehouse")));
  CT.autoStore(st, h);
  const s2 = loadFromString(saveToString(st));
  const h2 = hub(s2);
  check(JSON.stringify(h2.bins) === JSON.stringify(h.bins) && h2.armory.find((it) => it.key === "vest").store === `v:${car.id}`, "bins and item.store come back from a save");
  check(snapshot(s2, h2) === snapshot(st, h) && JSON.stringify(CT.containersOf(s2, h2).map((c) => [c.key, r1(c.kg)])) === JSON.stringify(CT.containersOf(st, h).map((c) => [c.key, r1(c.kg)])), "the containers read the same after loading");
  delete h2.bins;
  for (const it of h2.armory) delete it.store;
  const L = CT.containersOf(s2, h2);
  check(L.length === CT.containersOf(st, h).length && L.filter((c) => c.assignable).every((c) => c.kg === 0) && L.find((c) => c.key === CT.LOOSE).kg > 0 && h2.bins && Object.keys(h2.bins).length === 0, "an old save without bins: everything unassigned, nothing breaks");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
