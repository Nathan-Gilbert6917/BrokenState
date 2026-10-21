// The power grid (2026-10-21; src/sim/data-power.js, electric.js, power.js): found generators carried in both arms and
// set at a base (a house generator up to the Army's tactical set: power, fuel by the hour, Heat, the refuelling chore,
// picked up again whole), mounted spotlights on a wall stand or the ground lighting a night fight on the base map (only
// with power, only at night, further from a stand), the breaker panel's circuits (lights, and climate on a hot or a cold
// day) with their mood lines (lit, dark, cooled, sweltering) and switches, the ammo press (idle without power; powered:
// more rounds a scrap, the reloading orders faster), the fridge (cold room while powered), the electric well pump, the
// fence charger (needs wire; more of a horde held; the wire shocks), the finds and the recipe, the governor setting what
// lies in the stores, and save / load.
// Usage: node tools/powergridtest.js [seed]
import { createWorld, hub, atBase, makeSurvivor } from "../src/sim/world.js";
import { createBattle, registerCombatHandler } from "../src/sim/combat.js";
import { addBuilding, canBuild, queueBuild, demolish, BUILDINGS, stationStatus, runStations } from "../src/sim/buildings.js";
import { newItem, isCarryable, isTwoHands, fitReason } from "../src/sim/inventory.js";
import { GEAR } from "../src/sim/data.js";
import { ITEM_TAGS, SITE_TAGS, AREA_TAGS } from "../src/sim/loot.js";
import { LOCATIONS } from "../src/sim/data.js";
import { AREAS } from "../src/sim/combat.js";
import { CRAFTS } from "../src/sim/crafting.js";
import { FIXTURES, fxDef } from "../src/sim/breakdowns.js";
import { refreshPower, powerStatus, isGen, genDef, generatorHeat, POWER_USERS, NEEDS_POWER } from "../src/sim/power.js";
import { GENSETS, GENSET_KINDS, SPOT, FRIDGE, PRESS, PUMP, FENCE, POWER_FINDS, AREA_POWER, CIRCUITS, POWER_MOOD } from "../src/sim/data-power.js";
import { setPlaced, placedInStores, gridWired, circuitNeed, circuitState, powerMood, climateNeed, pumpWater, fenceCharged, fridgesOn, governPower, rollPowerFind } from "../src/sim/electric.js";
import { storeSpaces } from "../src/sim/storage.js";
import { waterProduction } from "../src/sim/economy.js";
import { defenceMult } from "../src/sim/defences.js";
import { moodFactors } from "../src/sim/relations.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { hasItemArt } from "../src/ui/itemart.js";
import * as BM from "../src/sim/basemap.js";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(`\n${t}`);
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
registerCombatHandler("pg", () => {});
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 6 }); st.started = true; return st; };
const at8 = (st) => { st.hour = Math.ceil(st.hour / 24) * 24 + 8; };
function quietHub(st) {
  const h = hub(st);
  for (const s of atBase(st, h.id)) { s.traits = []; s.conditions = []; s.role = "rest"; s.station = null; s.health = 100; s.mood = 60; s.skills.mechanics = 5; }
  Object.assign(h.stock, { water: 200, scrap: 300, parts: 40, electronics: 10, gunparts: 10, fuel: 200 });
  BM.clearAllLand(st, h);
  at8(st);
  return h;
}
const stock = (h, key, n = 1) => { for (let i = 0; i < n; i++) h.armory.push(newItem(key)); };

section("The pieces");
{
  const ks = GENSET_KINDS;
  check(ks.length === 5 && ks[0] === "genset_inverter" && ks[ks.length - 1] === "genset_military", `five found generators, an inverter set up to the Army's (${ks.map((k) => GENSETS[k].name).join(", ")})`);
  check(ks.every((k, i) => !i || GENSETS[k].out > GENSETS[ks[i - 1]].out), "each gives more power than the one before");
  check(ks.slice(1).every((k, i) => GEAR[k].weight >= GEAR[ks[i]].weight) && GEAR.genset_military.weight > 100, `heavier the bigger (${ks.map((k) => GEAR[k].weight).join(", ")} kg)`);
  check(ks.every((k) => GENSETS[k].full < 1 && GENSETS[k].idle <= GENSETS[k].full && GENSETS[k].idle > 0), `fuel by the hour, 0.x an hour (${ks.map((k) => `${GENSETS[k].idle}–${GENSETS[k].full}`).join(", ")})`);
  check(GENSETS.genset_military.heat < GENSETS.genset_contractor.heat && GENSETS.genset_inverter.heat < GENSETS.genset_house.heat, "the Army's set is muffled, the inverter whispers, a contractor's set roars");
  for (const k of [...ks, "spotlamp", "fridge"]) {
    const it = newItem(k);
    check(isCarryable(it) && isTwoHands(it) && fitReason(it, "carry") === "" && !!fitReason(it, "pack") && hasItemArt(k) && ITEM_TAGS[k] && GEAR[k].desc && GEAR[k].value > 0, `${GEAR[k].name}: both arms (In arms), never a pack, an icon, theme tags, a worth`);
  }
  check(CRAFTS.spotlamp && CRAFTS.spotlamp.needs === "workshop" && CRAFTS.spotlamp.in.electronics >= 1, "the mounted spotlight is made at a workshop from a work light's parts");
  const fits = (k, tags) => (ITEM_TAGS[k] || []).some((t) => tags.includes(t));
  check(Object.entries(POWER_FINDS).every(([t, f]) => LOCATIONS[t] && Object.keys(f.items).every((k) => fits(k, SITE_TAGS[t]))), "the search finds name real places and fit their themes");
  check(Object.entries(AREA_POWER).every(([a, f]) => AREAS[a] && Object.keys(f.items).every((k) => fits(k, AREA_TAGS[a]))), "the raid containers' finds name real areas and fit their themes");
  check(POWER_FINDS.military.items.genset_military && POWER_FINDS.hardware.items.spotlamp && POWER_FINDS.house.items.fridge && !POWER_FINDS.house.items.genset_military, "the tactical set with the Army, spotlights at the hardware store, fridges in houses");
  const st = world();
  let found = 0;
  for (let i = 0; i < 400; i++) { st.hour = i; if (rollPowerFind(st, 1, "hardware", 1, 1, `x${i}`)) found++; }
  check(found > 4 && found < 40, `a hardware store's search turns one up now and then (${found} in 400 search hours)`);
  check(Object.keys(BUILDINGS).filter((k) => BUILDINGS[k].grid).every((k) => BM.FOOT[k] && FIXTURES[k]), "every new building has a footprint and wear (Repairs)");
  check(NEEDS_POWER.has("ammo_press") && POWER_USERS.spotlamp && POWER_USERS.fridge && POWER_USERS.elec_pump && POWER_USERS.fence_charger, "the new machines draw power");
}

section("A found generator, set at a base");
{
  const st = world();
  const h = quietHub(st);
  let chk = canBuild(st, h, "genset_house");
  check(!chk.ok && chk.short && /No house generator in the stores/.test(chk.reason), `none in the stores: refused (${chk.reason})`);
  stock(h, "genset_house");
  check(canBuild(st, h, "genset_house").ok && placedInStores(h, "genset_house") === 1, "one carried home: it can be set");
  const msg = queueBuild(st, h, "genset_house");
  const g = h.buildings.find((b) => b.type === "genset_house");
  check(!!g && g.item && g.item.key === "genset_house" && !placedInStores(h, "genset_house") && !h.construction.length, `set from the stores, no build job (${msg})`);
  check(isGen(g) && genDef(g).out === GENSETS.genset_house.out && near(genDef(g).full, GENSETS.genset_house.full * 24), "a generator to the power code: its power and its burn (fuel an hour × 24)");
  const lay = BM.layoutOf(st, h).find((e) => e.it.key === `b:${g.id}`);
  check(!!lay && !!lay.at, "the game found it a spot on the base map");
  addBuilding(h, "freezer");
  refreshPower(st, h);
  check(h.freezerOn && g.tank > 0 && h.refuel && h.refuel.day >= 0, `the morning's refuelling filled it, the freezer on (tank ${g.tank.toFixed(2)})`);
  const t0 = g.tank;
  st.hour++; refreshPower(st, h);
  check(near(t0 - g.tank, GENSETS.genset_house.full), `an hour's running burns ${GENSETS.genset_house.full} fuel (${(t0 - g.tank).toFixed(3)})`);
  check(generatorHeat(h) === GENSETS.genset_house.heat, `+${generatorHeat(h)} Heat while it runs`);
  g.broken = { day: 1, cause: "test" };
  st.hour++; refreshPower(st, h);
  check(!h.freezerOn, "broken: no power");
  g.broken = null;
  check(FIXTURES.genset_house && fxDef(g) === FIXTURES.genset_house, "it wears as a machine of its own (Repairs)");
  // A second and a bigger one: the cheapest that covers the load runs.
  stock(h, "genset_military");
  queueBuild(st, h, "genset_military");
  st.hour++; refreshPower(st, h); at8(st); refreshPower(st, h);
  const ps = powerStatus(st, h);
  check(ps.supply >= 2 && ps.running === 1, `two generators, one freezer: one runs (${ps.running} running, ${ps.supply} supply)`);
  const fuel0 = h.stock.fuel, tank = g.tank;
  const r = demolish(st, h, g.id);
  check(!h.buildings.includes(g) && placedInStores(h, "genset_house") === 1 && near(h.stock.fuel, fuel0 + tank) && /picked up/.test(r), `picked up: back in the stores whole, its tank drained into the fuel (${r})`);
  for (let i = 0; i < 5; i++) stock(h, "genset_inverter");
  for (let i = 0; i < 5; i++) queueBuild(st, h, "genset_inverter");
  check(h.buildings.filter((b) => GENSETS[b.type]).length === 4 && /At most 4/.test(canBuild(st, h, "genset_inverter").reason || ""), "at most 4 found generators at one base");
}

section("Spotlights on a wall stand and on the ground");
{
  const st = world();
  const h = quietHub(st);
  for (const t of ["walls", "bunkhouse"]) addBuilding(h, t);
  const C = BM.yardHalf(h);
  const stand = addBuilding(h, "stand1");
  check(!BM.placeItem(st, h, `b:${stand.id}`, 2, C - 2, 0), "a wall stand placed by hand");
  stock(h, "spotlamp", 3);
  let r = setPlaced(st, h, "spotlamp", [2, C - 2, 0]);
  check(!r.err && r.rec, `a spotlight set on the wall stand's cell (${r.err || r.msg})`);
  const r2 = setPlaced(st, h, "spotlamp", [2, C - 2, 0]);
  check(!!r2.err && /spotlight there already/.test(r2.err), `never two on one cell (${r2.err})`);
  const r3 = setPlaced(st, h, "spotlamp", [-6, 3, 0]);
  check(!r3.err, "one on the open ground");
  const gen = addBuilding(h, "generator");
  const battle = (night) => {
    globalThis.window = {};
    try { st.combat = createBattle(st, { tile: h.tile, baseId: h.id, enemy: { kind: "zombies", count: 6, power: 2, name: "the dead" }, ambush: null, canRetreat: true, handler: "pg", layout: "baseDefence", deploy: true, downedLive: 0.4, context: { night, ready: { manned: true } } }); } finally { delete globalThis.window; }
    return st.combat;
  };
  st.hour = Math.floor(st.hour / 24) * 24 + 22; // night: the spotlights draw
  gen.tank = 3;
  refreshPower(st, h);
  check(powerStatus(st, h).users.filter((u) => u.b.type === "spotlamp").every((u) => u.wants && u.served), "at night they draw and are served");
  let b = battle(true);
  const F = b.deployPlan.fort;
  const cellAt = (gx, gy) => b.cells[(gy + F.oy) * b.w + gx + F.ox];
  const litAt = (gx, gy) => !!(b.lit && b.lit[(gy + F.oy) * b.w + gx + F.ox]);
  check(cellAt(2, C - 2).k === "stand" && cellAt(2, C - 2).spot === 1 && cellAt(-6, 3).k === "spot", "on the battle map: the stand keeps its ladder with the light up on it; the ground one is a lamp cell");
  check(b.floodAim === SPOT.aim && b.deploy.fixedLit && litAt(2 + SPOT.STAND_R - 1, C - 2) && litAt(-6 + SPOT.R, 3) && !litAt(-6 + SPOT.R + 2, 3), `lit round each: ${SPOT.STAND_R} from the stand, ${SPOT.R} on the ground, +${SPOT.aim} to hit`);
  st.combat = null;
  b = battle(false);
  check(!b.lit && !b.floodAim, "by day: no light, no aim");
  st.combat = null;
  gen.tank = 0; h.stock.fuel = 0;
  st.hour++; refreshPower(st, h);
  b = battle(true);
  check(!b.lit, "no power (the tank dry, no fuel): dark");
  st.combat = null;
  const m0 = defenceMult(st, h);
  gen.tank = 3; st.hour++; refreshPower(st, h);
  check(defenceMult(st, h) > m0, `lit at night, the base holds back a little more by the numbers (${m0.toFixed(3)} → ${defenceMult(st, h).toFixed(3)})`);
}

section("The breaker panel and the circuits");
{
  const st = world();
  const h = quietHub(st);
  addBuilding(h, "bunkhouse"); addBuilding(h, "common_room");
  const gen = addBuilding(h, "generator");
  refreshPower(st, h);
  const s = atBase(st, h.id)[0];
  check(!gridWired(h) && !powerStatus(st, h).users.some((u) => u.circuit) && !powerMood(st, s, h).length, "no breaker panel: nothing wired, no draw, no mood line");
  addBuilding(h, "breaker");
  refreshPower(st, h);
  const cs = circuitState(st, h);
  const need = climateNeed(st, h);
  check(gridWired(h) && cs && cs.n === 2 && cs.light === CIRCUITS.bunkhouse[0] + CIRCUITS.common_room[0], `wired: the bunkhouse and the common room on circuits (${cs && cs.n}, climate today: ${need || "mild"})`);
  check(cs.litUnits === cs.light, "the generator covers them: lit");
  let lines = powerMood(st, s, h);
  check(lines.some((l) => /Electric light/.test(l.label) && l.v === POWER_MOOD.lit), `mood: ${lines.map((l) => `${l.label} ${l.v}`).join("; ")}`);
  check(moodFactors(st, s).list.some((f) => /Electric light/.test(f.label) && f.own), "listed among the day's mood factors (applied there)");
  const bunk = h.buildings.find((b) => b.type === "bunkhouse");
  h.powerOff = { [bunk.id]: true };
  st.hour++; refreshPower(st, h);
  lines = powerMood(st, s, h);
  check(lines.some((l) => /Dark buildings: 1 of 2/.test(l.label) && l.v < 0), `the bunkhouse switched off: dark, mood down (${lines.map((l) => `${l.label} ${l.v.toFixed(2)}`).join("; ")})`);
  delete h.powerOff[bunk.id];
  // A hot or a cold day (the first within the year): climate drawn; served with power, sweltering or shivering without.
  const day = Math.floor(st.hour / 24);
  let found = null;
  for (let d = 0; d < 112 && !found; d++) { st.hour = (day + d) * 24 + 12; if (climateNeed(st, h)) found = climateNeed(st, h); }
  check(!!found, `a hot or a cold day within the year (${found})`);
  refreshPower(st, h);
  const c2 = circuitState(st, h);
  check(c2.climate > 0 && circuitNeed(st, h, bunk) === CIRCUITS.bunkhouse[0] + CIRCUITS.bunkhouse[1], `on a ${found} day the buildings draw for their climate too (${c2.climate} more)`);
  gen.tank = 5; h.stock.fuel = 50;
  refreshPower(st, h);
  lines = powerMood(st, s, h);
  const servedAll = circuitState(st, h).climateServed === circuitState(st, h).climate;
  check(servedAll ? lines.some((l) => l.v === POWER_MOOD.comfy) : lines.some((l) => /Sweltering|Shivering/.test(l.label)), `the climate line (${lines.map((l) => `${l.label} ${l.v.toFixed(2)}`).join("; ")})`);
  h.powerOff = Object.fromEntries(h.buildings.filter((b) => CIRCUITS[b.type]).map((b) => [b.id, true]));
  st.hour++; refreshPower(st, h);
  lines = powerMood(st, s, h);
  check(lines.some((l) => /Sweltering|Shivering/.test(l.label) && near(l.v, -POWER_MOOD.harsh)) && lines.some((l) => near(l.v, -POWER_MOOD.dark)), `everything switched off on a ${found} day: dark and ${found === "hot" ? "sweltering" : "shivering"} (${lines.map((l) => `${l.label} ${l.v.toFixed(2)}`).join("; ")})`);
}

section("The ammo press");
{
  const st = world();
  const h = quietHub(st);
  addBuilding(h, "workbench");
  let chk = canBuild(st, h, "ammo_press");
  check(chk.ok, `buildable with a workbench and a Mechanics 4 hand (${chk.reason || "ok"})`);
  const press = addBuilding(h, "ammo_press");
  const op = atBase(st, h.id)[0];
  op.role = "operate"; op.station = press.id;
  refreshPower(st, h);
  let ss = stationStatus(st, h, press);
  check(!ss.running && /No power/.test(ss.reason), `no generator: it stands idle (${ss.reason})`);
  const bench = addBuilding(h, "ammo_bench");
  const op2 = atBase(st, h.id)[1];
  op2.role = "operate"; op2.station = bench.id;
  addBuilding(h, "generator");
  refreshPower(st, h);
  ss = stationStatus(st, h, press);
  const sb = stationStatus(st, h, bench);
  check(ss.running && ss.powered && ss.in.scrap === sb.in.scrap * PRESS.in, `powered: ${ss.in.scrap} scrap a day (the bench ${sb.in.scrap})`);
  const perScrap = (x) => x.out.ammo / x.in.scrap;
  check(perScrap(ss) > perScrap(sb) && ss.out.ammo > sb.out.ammo * 2, `more rounds a day and a scrap (${ss.out.ammo} from ${ss.in.scrap} against the bench's ${sb.out.ammo} from ${sb.in.scrap})`);
  h.powerOff = { [press.id]: true };
  refreshPower(st, h);
  ss = stationStatus(st, h, press);
  check(!ss.running && /Switched off/.test(ss.reason), `switched off on the Power card: idle (${ss.reason})`);
  delete h.powerOff[press.id];
  const ammo0 = Object.keys(h.stock).filter((k) => k.startsWith("a_")).reduce((a, k) => a + (h.stock[k] || 0), 0) + (h.stock.ammo || 0);
  runStations(st, h);
  const ammo1 = Object.keys(h.stock).filter((k) => k.startsWith("a_")).reduce((a, k) => a + (h.stock[k] || 0), 0) + (h.stock.ammo || 0);
  check(ammo1 > ammo0, `a day's work: ${Math.round(ammo1 - ammo0)} rounds from the bench and the press`);
}

section("The fridge, the pump, the fence charger");
{
  const st = world();
  const h = quietHub(st);
  stock(h, "fridge");
  let chk = canBuild(st, h, "fridge");
  check(!chk.ok && /building to stand in/.test(chk.reason), `no general building: nowhere to set it (${chk.reason})`);
  addBuilding(h, "gen_cabin");
  chk = canBuild(st, h, "fridge");
  check(chk.ok, "a cabin: room on its floor");
  queueBuild(st, h, "fridge");
  refreshPower(st, h);
  check(storeSpaces(h).some((x) => x.key === "fridgeoff") && !fridgesOn(h), "no power: a cupboard");
  addBuilding(h, "generator");
  refreshPower(st, h);
  check(fridgesOn(h) === 1 && storeSpaces(h).some((x) => x.key === "fridge" && x.cap === FRIDGE.room), `powered: ${FRIDGE.room} days of cold room`);
  chk = canBuild(st, h, "elec_pump");
  check(!chk.ok && /well/.test(chk.reason), `a pump needs a well (${chk.reason})`);
  addBuilding(h, "well");
  check(canBuild(st, h, "elec_pump").ok, "a well: ok");
  const w0 = waterProduction(st, h).total;
  addBuilding(h, "elec_pump");
  refreshPower(st, h);
  check(pumpWater(h) === PUMP.water && waterProduction(st, h).total > w0, `the pump: +${pumpWater(h)} water a day (${w0.toFixed(1)} → ${waterProduction(st, h).total.toFixed(1)})`);
  check(!canBuild(st, h, "elec_pump").ok, "one pump a well");
  h.type = h.type || "hub";
  chk = canBuild(st, h, "fence_charger");
  check(!chk.ok && /wire/.test(chk.reason), `the charger needs wire (${chk.reason})`);
  addBuilding(h, "barbed_wire");
  const m0 = defenceMult(st, h);
  const ch = addBuilding(h, "fence_charger");
  refreshPower(st, h);
  check(fenceCharged(h) && near(defenceMult(st, h) - m0, FENCE.hold, 1e-3), `charged: +${FENCE.hold} of a horde held (${m0.toFixed(3)} → ${defenceMult(st, h).toFixed(3)})`);
  h.powerOff = { [ch.id]: true };
  refreshPower(st, h);
  check(!fenceCharged(h), "switched off: the wire goes dead");
}

section("The governor, save and load");
{
  const st = world();
  const h = quietHub(st);
  addBuilding(h, "freezer"); addBuilding(h, "gen_cabin");
  stock(h, "genset_contractor"); stock(h, "spotlamp"); stock(h, "fridge");
  const lines = governPower(st, h);
  check(h.buildings.some((b) => b.type === "genset_contractor") && h.buildings.some((b) => b.type === "spotlamp") && h.buildings.some((b) => b.type === "fridge"), `the governor sets the generator (power short), the spotlight and the fridge (${lines.length} lines)`);
  check(!governPower(st, h).length, "nothing more the next day");
  addBuilding(h, "breaker");
  refreshPower(st, h);
  const st2 = loadFromString(saveToString(st));
  const h2 = hub(st2);
  const g2 = h2.buildings.find((b) => b.type === "genset_contractor");
  check(!!g2 && g2.item && g2.item.key === "genset_contractor" && gridWired(h2) && isGen(g2), "save and load: the set generator keeps its item, the panel its wiring");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
