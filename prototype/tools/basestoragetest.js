// Base storage limits (2026-10-19, the user's request: "Add base storage limits, needing to craft simple storage boxes
// up to buildings of different sizes with the dedication to increasing the base storage. You can also leave things out
// not in containers but if they are outside the durability decays and easier for raiders to steal. Camps start with no
// storage but using a vehicle you can use the storage of the truck as a storage unit until better storage is made. You
// can steal storage boxes like small safes (Carried only slot two hands) weapon cases etc."). The simulation's side
// (sim/basestorage.js, buildings.js STORE_KG, the boxes' twoHands):
//   - the room by tier (a camp 0, a shelter 150, an outpost 500, the main hub 1200), the same for the groups' bases;
//   - a parked truck adds its payload, and a team driving off in it takes the room away;
//   - a storage box adds 60 once built (nothing while it is in the queue); where the storage buildings may stand;
//   - the fill: valuables inside, scrap and firewood outside first;
//   - an opened fire safe in the armory is room, a sealed one an item;
//   - the fire safe and the rifle case: carried in both arms only (no pocket, pack slot or pouch), two hands;
//   - the daily wear outside (doubled on a wet day), none inside, and the throttled log line.
// Usage: node tools/basestoragetest.js [seed]
import { createWorld, hub, atBase, newId } from "../src/sim/world.js";
import { BUILDINGS, CAMP, SHELTER, addBuilding, canBuild, placeProblem, queueBuild, constructionHour } from "../src/sim/buildings.js";
import { storageOf, storageSummary, storageLine, outsideShare, STORE_KG, BOX_STORE_KG, coreStoreKg, vehicleStoreKg, isStoreBuilding, storageDaily, weatherOutside, OUTSIDE_WEAR, WET_WEAR } from "../src/sim/basestorage.js";
import { carsAtBase } from "../src/sim/vehicles.js";
import { formTeam } from "../src/sim/teamform.js";
import { newItem, fitReason, stow, isTwoHands, isCarryable, pouchReason } from "../src/sim/inventory.js";
import { handsCount, handsTakeRefusal, bagRefusal, carryBag } from "../src/sim/carry.js";
import { makeBox, openBox } from "../src/sim/boxes.js";
import { homesOf } from "../src/sim/groupbases.js";
import { hash01 } from "../src/sim/skills.js";

const SEED = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else { fail++; console.log(`  FAIL: ${what}`); } return !!ok; };
const section = (t) => console.log(t);
const W = () => { const st = createWorld({ seed: SEED, factionCount: 6 }); st.visitorsOff = true; return st; };
const asCamp = (b) => { b.tier = 0; b.camp = true; b.buildings = []; b.construction = []; };
const asShelter = (b) => { b.tier = 0; delete b.camp; b.buildings = []; b.construction = []; };
const mkOutpost = (st, tile) => { const o = { id: newId(), tile, type: "outpost", name: "Test Outpost", stock: {}, radio: false, watchtower: false, buildings: [], construction: [], armory: [] }; st.bases.push(o); return o; };
const parkAway = (st, b) => { for (const v of carsAtBase(st, b.id)) v.loc = { kind: "base", baseId: -1 }; };
const empty = (b) => { b.stock = {}; b.armory = []; };
const roll = (...k) => () => hash01(SEED, "bst", ...k);
const rollFn = (...k) => (...x) => hash01(SEED, "bst", ...k, ...x);
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// ======================================================================
section("The room by tier");
{
  const st = W(), h = hub(st);
  const truck = carsAtBase(st, h.id)[0];
  check(!!truck && vehicleStoreKg(truck) === 650, `the starting pickup holds 650 kg (${truck && vehicleStoreKg(truck)})`);
  check(coreStoreKg(h) === 1200 && storageOf(st, h).cap === 1850, `the main hub: 1200 of its own + the parked pickup's 650 (${storageOf(st, h).cap})`);
  parkAway(st, h);
  check(storageOf(st, h).cap === 1200, "the main hub alone: 1200");
  const o = mkOutpost(st, h.tile + 1);
  check(storageOf(st, o).cap === 500 && coreStoreKg(o) === 500, "an outpost: 500");
  asShelter(h);
  check(storageOf(st, h).cap === 150, "a shelter: 150");
  asCamp(h);
  const s = storageOf(st, h);
  check(s.cap === 0 && s.containers.length === 0, "a camp: no storage at all");
  check(storageSummary(st, h).some((r) => /No storage yet: park a vehicle here or build a storage box/.test(r)), "the summary says so");
  asCamp(o); o.tier = 0;
  check(storageOf(st, o).cap === 0, "an outpost camp: nothing either");
  // A group's base: the same storageOf.
  const f = st.factions.find((x) => x.bases && x.bases.length);
  const home = f && Object.values(homesOf(st, f))[0];
  check(!!home && storageOf(st, home).cap === coreStoreKg(home) + (home.buildings || []).reduce((a, b) => a + (STORE_KG[b.type] || 0), 0), `a group's base: its core and its storage buildings (${home && storageOf(st, home).cap} kg)`);
  check(storageOf(st, null).cap === 0 && outsideShare(st, h) >= 0, "no base: nothing, no crash");
}

// ======================================================================
section("A parked truck is storage while it is parked");
{
  const st = W(), h = hub(st);
  asCamp(h);
  empty(h);
  h.stock.scrap = 200; // 400 kg
  const truck = carsAtBase(st, h.id)[0];
  let s = storageOf(st, h);
  check(s.cap === 650 && s.outsideKg === 0 && s.containers.some((c) => c.kind === "vehicle" && c.key === `v:${truck.id}`), "a camp with the pickup: 650 kg, the scrap all in it");
  check(/the pickup truck 650 while it is parked/.test(storageLine(st, h)), `the line names it (${storageLine(st, h)})`);
  const ids = atBase(st, h.id).slice(0, 2).map((x) => x.id);
  const res = formTeam(st, { baseId: h.id, memberIds: ids, vehicleId: truck.id, supplies: {} });
  check(!res.error && truck.loc.kind === "party", `a team drives off in it (${res.error || "formed"})`);
  s = storageOf(st, h);
  check(s.cap === 0 && s.outsideKg === 400 && s.outside.sup.scrap === 200, `its room went with it: the scrap is outside (${s.outsideKg} kg)`);
  check(near(outsideShare(st, h), 1), "everything is outside: outsideShare 1");
  truck.loc = { kind: "base", baseId: h.id };
  check(storageOf(st, h).cap === 650, "back and parked: the room again");
  truck.destroyed = true;
  check(storageOf(st, h).cap === 0 && vehicleStoreKg(truck) === 0, "a wreck holds nothing");
  check(vehicleStoreKg({ type: "bike", count: 3 }) === 0 && vehicleStoreKg({ type: "miltruck" }) === 2500, "bikes nothing, an Army truck 2500");
}

// ======================================================================
section("Storage buildings");
{
  check(BUILDINGS.storebox && BUILDINGS.shed && BUILDINGS.warehouse, "the storage box, the shed and the warehouse exist");
  const want = { storebox: 60, crates: 150, shed: 600, storehouse: 2000, warehouse: 6000, cellar: 400, coldstore: 300, freezer: 300 };
  check(Object.entries(want).every(([k, v]) => STORE_KG[k] === v && BUILDINGS[k].storeKg === v && isStoreBuilding(k)), "storeKg on every storage building, the ladder of sizes");
  check(!isStoreBuilding("bunkhouse") && !isStoreBuilding("nope"), "a bunkhouse holds no goods");
  check(BUILDINGS.storebox.cost.scrap === 1 && BUILDINGS.storebox.cost.wood === 50 && BUILDINGS.storebox.hours === 2 && BUILDINGS.storebox.max === 6, "a storage box: 1 scrap and 50 wood, 2 hours, up to 6");
  check(BUILDINGS.shed.plot === "building" && BUILDINGS.shed.cost.scrap === 4 && BUILDINGS.shed.cost.wood === 400 && BUILDINGS.shed.cost.buildmat === 1 && BUILDINGS.shed.hours === 12 && BUILDINGS.shed.max === 4, "a shed: a building plot, 4 scrap, 400 wood (woodwork) and a building material, 12 hours, up to 4");
  check(BUILDINGS.warehouse.plot === "building" && BUILDINGS.warehouse.cost.scrap === 40 && BUILDINGS.warehouse.cost.buildmat === 4 && BUILDINGS.warehouse.cost.parts === 1 && BUILDINGS.warehouse.hours === 48 && BUILDINGS.warehouse.max === 2 && BUILDINGS.warehouse.req.mechanics === 2, "a warehouse: 40 scrap, 4 building materials, a part, 48 hours, up to 2, Mechanics 2");
  check(CAMP.build.storebox === 4 && CAMP.build.crates >= 1 && SHELTER.build.storebox >= 1 && SHELTER.build.crates >= 1, "camps and shelters build storage boxes and crates");

  const st = W(), h = hub(st);
  for (const s of atBase(st, h.id)) Object.assign(s.skills, { mechanics: 10 });
  Object.assign(h.stock, { scrap: 999, buildmat: 20, parts: 20, wood: 99999 });
  check(placeProblem(h, "warehouse") === "" && canBuild(st, h, "warehouse").ok, `the main hub builds a warehouse (${canBuild(st, h, "warehouse").reason || "ok"})`);
  const o = mkOutpost(st, h.tile + 1);
  check(placeProblem(o, "warehouse") === "", "an outpost may too");
  asCamp(h);
  Object.assign(h.stock, { scrap: 999, buildmat: 20, parts: 20, wood: 99999 });
  check(/Opens at an outpost or the main base/.test(placeProblem(h, "warehouse")) && !canBuild(st, h, "warehouse").ok, `not at a camp (${placeProblem(h, "warehouse")})`);
  check(!canBuild(st, h, "shed").ok, "a camp has no building plot for a shed");
  parkAway(st, h);
  check(canBuild(st, h, "storebox").ok, `a camp builds a storage box (${canBuild(st, h, "storebox").reason || "ok"})`);
  const before = storageOf(st, h).cap;
  queueBuild(st, h, "storebox");
  check(storageOf(st, h).cap === before, "queued: it holds nothing yet");
  const job = h.construction.find((c) => c.type === "storebox");
  job.progress = job.hours;
  for (const s of atBase(st, h.id)) s.role = "build";
  constructionHour(st);
  check(!h.construction.includes(job) && h.buildings.some((b) => b.type === "storebox"), "built");
  check(storageOf(st, h).cap === before + 60, `built: +60 kg (${before} → ${storageOf(st, h).cap})`);
  for (let i = 0; i < 3; i++) addBuilding(h, "storebox");
  check(!canBuild(st, h, "storebox").ok, `a camp has room for 4 (${canBuild(st, h, "storebox").reason})`);
  asShelter(h);
  check(placeProblem(h, "storebox") === "" && /Opens at/.test(placeProblem(h, "warehouse")), "a shelter: storage boxes yes, a warehouse no");
}

// ======================================================================
section("The fill: valuables in, scrap and firewood out");
{
  const st = W(), h = hub(st);
  asCamp(h); parkAway(st, h); empty(h);
  addBuilding(h, "storebox"); // 60 kg
  h.stock.scrap = 30;  // 60 kg, worth 0.5 a kg
  h.stock.wood = 100;  // 10 kg, worth 0.2 a kg
  h.stock.meds = 10;   // 1 kg, worth 80 a kg
  const ring = newItem("goldring"), axe = newItem("fireaxe");
  h.armory.push(axe, ring);
  const s = storageOf(st, h);
  check(s.cap === 60 && near(s.used, 60 + 10 + 1 + 0.05 + 2.7, 0.11), `cap 60, used ${s.used} kg (everything, inside and out)`);
  check(!s.outside.gear.length, "the gold ring and the axe are inside");
  check(!s.outside.sup.meds, "the meds are inside");
  check(s.outside.sup.wood >= 90, `the firewood is outside first (${s.outside.sup.wood} of 100: a few sticks fill the last corner)`);
  check(s.outside.sup.scrap > 0 && s.outside.sup.scrap < 30, `then the scrap that does not fit (${s.outside.sup.scrap} of 30)`);
  check(near(s.outsideKg + s.inside, s.used, 0.11) && s.inside <= s.cap + 1e-9, `inside ${s.inside} + outside ${s.outsideKg} = used`);
  const sum = storageSummary(st, h);
  check(/^Storage \d+ \/ 60 kg$/.test(sum[0]) && /storage box 60/.test(sum[1]) && /kg outside: .*wood/i.test(sum[2] || ""), `the summary rows (${sum.join(" | ")})`);
  // A heavy, cheap item goes out before a light, dear one.
  h.stock = { scrap: 29 };
  const sledge = newItem("fireaxe"); sledge.quality = 0.2; // a worn axe: little worth for its weight
  h.armory = [ring, sledge];
  const s2 = storageOf(st, h);
  check(s2.outside.gear.length === 0 || s2.outside.gear.every((i) => h.armory[i] !== ring), "the ring never lies outside while something cheaper does");
  // Deterministic.
  check(JSON.stringify(storageOf(st, h)) === JSON.stringify(storageOf(st, h)), "the same base, the same answer");
}

// ======================================================================
section("Lock boxes: an opened one is room");
{
  const st = W(), h = hub(st);
  asCamp(h); parkAway(st, h); empty(h);
  check(BOX_STORE_KG.firebox === 15 && BOX_STORE_KG.cashbox === 3 && BOX_STORE_KG.riflecase === 8, "BOX_STORE_KG: fire safe 15, cash box 3, rifle case 8");
  const safe = makeBox("firebox", rollFn("safe"), "town");
  safe.locked = true; delete safe.opened;
  h.armory.push(safe);
  let s = storageOf(st, h);
  check(s.cap === 0 && s.outside.gear.includes(0) && s.used >= 6, `sealed, it is an item (cap ${s.cap}, ${s.used} kg outside)`);
  openBox(safe, { kind: "pry", item: newItem("crowbar") });
  safe.contents = []; safe.sup = {};
  s = storageOf(st, h);
  check(s.cap === 15 && s.containers.some((c) => c.kind === "box" && c.type === "firebox") && s.used === 0, `opened and empty: 15 kg of room, its own 6 kg not counted (cap ${s.cap}, used ${s.used})`);
  h.stock.scrap = 10; // 20 kg
  s = storageOf(st, h);
  check(s.outside.sup.scrap === 3, `7 scrap in it, 3 outside (${s.outside.sup.scrap})`);
  const ring = newItem("goldring");
  safe.contents = [ring];
  s = storageOf(st, h);
  check(!s.outside.gear.length && near(s.used, 20.05, 0.06), "what is still in the box stays in the box and counts");
  check(/an opened fireproof lock box 15/.test(storageSummary(st, h)[1]), `named in the room (${storageSummary(st, h)[1]})`);
}

// ======================================================================
section("The fire safe and the rifle case: carried in both arms only");
{
  const st = W(), h = hub(st);
  const s = atBase(st, h.id)[0];
  for (const key of ["firebox", "riflecase"]) {
    const it = key === "firebox" ? makeBox(key, rollFn("carry", key), "town") : newItem(key);
    check(isTwoHands(it) && isCarryable(it), `${it.name}: twoHands, carried in the arms`);
    check(!!fitReason(it, "pocket") && !!fitReason(it, "pack") && !!fitReason(it, "bag"), `${it.name}: no pocket, no pack slot, no carried bag`);
    check(["pocket", "admin", "rifle", "pistol"].every((k) => !!pouchReason(it, k)), `${it.name}: no rig pouch`);
    check(fitReason(it, "carry") === "", `${it.name}: In arms`);
    s.gear.backpack = s.gear.backpack || newItem("backpack");
    check(stow(s, it) === "", `${it.name}: stow puts it nowhere on them (it is carried, or stays in storage)`);
    const u = { side: "player", sid: s.id, name: s.name, haul: { gear: [it], sup: {} } };
    check(handsCount(u) === 2, `${it.name} carried loose: both hands (${handsCount(u)})`);
    check(!!handsTakeRefusal(u, "a knife", newItem("knife")), `${it.name} in the arms: nothing more is taken`);
    const u2 = { side: "player", sid: s.id, name: s.name, haul: { gear: [newItem("knife")], sup: {} } };
    check(handsCount(u2) === 1 && !!handsTakeRefusal(u2, `the ${it.name}`, it), `one hand full: the ${it.name} wants both`);
    const u3 = { side: "player", sid: s.id, name: s.name, haul: { gear: [], sup: {} } };
    check(handsTakeRefusal(u3, `the ${it.name}`, it) === "", `empty hands take the ${it.name}`);
    const u4 = { side: "player", sid: s.id, name: s.name, bag: it };
    check(handsCount(u4) === 2, `${it.name} as the carried bag: both hands`);
    s.gear.carry = null;
    check(bagRefusal(st, null, s, it) === "" && carryBag(st, null, s, it) === "" && s.gear.carry === it, `${it.name}: into the arms on the road (In arms)`);
    s.gear.carry = null;
  }
  const knife = newItem("knife");
  check(handsCount({ haul: { gear: [knife, newItem("knife")], sup: {} } }) === 1, "two knives are still one armful (the old rule)");
}

// ======================================================================
section("Outside, things weather");
{
  const st = W(), h = hub(st);
  asCamp(h); parkAway(st, h); empty(h);
  const axe = newItem("fireaxe");
  axe.dur = 40;
  h.armory.push(axe);
  let r = weatherOutside(st, h, false);
  check(r.n === 1 && near(axe.dur, 40 - 50 * OUTSIDE_WEAR), `a dry day outside: 2% of its full uses (${axe.dur})`);
  axe.dur = 40;
  weatherOutside(st, h, true);
  check(near(axe.dur, 40 - 50 * OUTSIDE_WEAR * WET_WEAR), `a wet day: twice that (${axe.dur})`);
  axe.dur = 1.01;
  weatherOutside(st, h, true);
  check(axe.dur === 1, "never below 1");
  const ring = newItem("goldring");
  h.armory.push(ring);
  r = weatherOutside(st, h, true);
  check(ring.dur == null && ring.quality === 1, "a gold ring does not wear");
  // Inside: no wear.
  const st2 = W(), h2 = hub(st2);
  empty(h2);
  const axe2 = newItem("fireaxe");
  axe2.dur = 40;
  h2.armory.push(axe2);
  weatherOutside(st2, h2, true);
  check(axe2.dur === 40 && !storageOf(st2, h2).outside.gear.length, "inside the main house: no wear");
  // The daily tick: the wear and one log line, at most every 3 days.
  axe.dur = 40;
  h.storageWarnDay = undefined;
  const logged = () => st.log.filter((l) => /the things left outside are weathering/.test(l.text || l.msg || String(l))).length;
  const n0 = logged();
  st.hour = 24 * 5;
  storageDaily(st);
  check(axe.dur < 40, `storageDaily wears it (${axe.dur})`);
  check(logged() === n0 + 1, "one log line for the base");
  st.hour += 24; storageDaily(st);
  st.hour += 24; storageDaily(st);
  check(logged() === n0 + 1, "not again the next two days");
  st.hour += 24; storageDaily(st);
  check(logged() === n0 + 2, "again on the third");
}

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
