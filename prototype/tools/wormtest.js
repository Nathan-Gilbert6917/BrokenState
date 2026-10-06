// The worm (src/sim/worm.js): catching it from un-purified water on infected ground (water.js) but not from purified
// (boiled, filtered) or rain water; raw meat with eggs eaten last and cooked by a cook fire, the racks or a camp fire; infested animals (a quarter of
// the food, always with eggs, herds thinned by hunting, spreading eggs where they wander, born on badly infected land);
// camping on infested land only above the threshold; the stages, spotting (a medic sooner, a team later), the cures
// (dewormer, purge, surgery, the night's care), turning at a base and on the road, the cards; the autopilot's boiler;
// save/load of the new state. The dice are pinned where the rule is under test (WORM numbers set to 0 or 1 for a check).
// Usage: node tools/wormtest.js [seed]
import { createWorld, hub, atBase, residents, day, makeSurvivor } from "../src/sim/world.js";
import { addBuilding, count } from "../src/sim/buildings.js";
import { newItem } from "../src/sim/inventory.js";
import { eatFromStore } from "../src/sim/storage.js";
import { takeMeat, addMeat, expectHunt, huntTeam } from "../src/sim/hunting.js";
import { launchExpedition, partyMembers } from "../src/sim/parties.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { readFileSync } from "node:fs";
import { setAutopilot } from "../src/sim/autopilot.js";
import { tickHour } from "../src/sim/world.js";
import { workFactor } from "../src/sim/health.js";
import { activeHospital } from "../src/sim/medical.js";
import {
  WORM, HERD, catchWorm, hasWorm, clearWorm, wormOf, wormSeen, eggsAt, sourceEggs, baseWater, baseCooks, wormMeatAt, wormMeatIn, cookAtBase,
  smokeWormMeat, wormKill, eatRaw, addWormWater, packWater, drinkHour, eatRawCargo, wormTeamHour, wormTreatInfo,
  applyWormTreat, wormDaily, herdAt, infestedShare, huntYieldMult, herdsDaily, herdCap, teamWormText,
  boilerUse, searchChance, wormSearch, wormHome, searchRiskText, cropLandBad, wormVegAt, wormForageIn, addWormCrop, addWormForage,
  eatRawForageCargo, unloadWormForage, groupWormRisk, groupsDaily, purifyDaily,
  purifyCap, campFireFed, teamTabCount, teamWaterHow, waterRisk, dayHp, stageFor, wormLabel, wormCureText, putDownOdds, migrateWorm,
} from "../src/sim/worm.js";
import { GEAR } from "../src/sim/data.js";
import { fireLandOk, WOOD } from "../src/sim/woodcutting.js";
import { wormBattleRound, riseInBattle } from "../src/sim/carriers.js";
import { startCrawl, encounterOptions, resolveEncounter } from "../src/sim/citycrawl.js";
import { createBattle } from "../src/sim/combat.js";
import { takePrisonersAt } from "../src/sim/prisoners.js";
import { healRatePerHour } from "../src/sim/medical.js";
import { campHealPerHour } from "../src/sim/orders.js";
import { conditionsOf, CONDITIONS, addCondition, healthDaily, treatCondition, autoWantsCondition } from "../src/sim/health.js";
import { drawWater } from "../src/sim/water.js";
import { waterNeed } from "../src/sim/economy.js";
import { mouthsAt, HEAT } from "../src/sim/upkeep.js";
import { woodNeed } from "../src/sim/woodcutting.js"; // (fireLandOk: above)
import { harvestPlot, farmOf, CROPS } from "../src/sim/farming.js";
import { foragingDaily } from "../src/sim/foraging.js";
import { takeFood } from "../src/sim/needs.js";
import { ensureDiplo } from "../src/sim/diplomacy.js";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const t0 = Date.now();

// Sets numbers for the length of fn, then puts them back.
function withNums(obj, patch, fn) {
  const keep = {};
  for (const k of Object.keys(patch)) { keep[k] = obj[k]; obj[k] = patch[k]; }
  try { return fn(); } finally { Object.assign(obj, keep); }
}
// A hub on ground (and water) at infection `inf`, no water filter, plenty of stores, everyone resting, no worm yet.
function wormWorld(inf = 0.8, s = seed) {
  const st = createWorld({ seed: s, factionCount: 5 });
  st.started = true; st.visitorsOff = true;
  const h = hub(st);
  for (const id of [h.tile, ...st.grid.neighbors(h.tile)]) { st.tiles[id].infection = inf; st.tiles[id].infBase = inf; }
  h.armory = h.armory.filter((it) => !(it && it.key === "waterfilter"));
  for (const p of atBase(st, h.id)) { p.role = "rest"; p.station = null; p.traits = []; if (p.gear.tool && p.gear.tool.key === "waterfilter") p.gear.tool = null; p.worm = null; p.health = 100; }
  Object.assign(h.stock, { food: 300, water: 0, rawwater: 300, meds: 40, scrap: 100, preserved: 0 }); // its water all un-purified (water.js)
  st.herds = [];
  return { st, h };
}
// A team of `n` from the hub, standing on `tile` (a hand-made party: the rules under test read only these fields).
function team(st, h, tile, n = 2) {
  const members = atBase(st, h.id).slice(0, n);
  const p = { id: 90000 + st.parties.length, owner: "player", kind: "expedition", members: members.map((s) => s.id), supplies: { food: 20, water: 20, meds: 0 }, cargo: { supplies: {}, gear: [] }, path: [tile], idx: 0, phase: "waiting", stance: "normal" };
  for (const s of members) s.location = { kind: "party", partyId: p.id };
  st.parties.push(p);
  return { p, members };
}
const clearAll = (people) => { for (const s of people) s.worm = null; };
const caught = (people) => people.filter((s) => s.worm).length;

// One base day's water (economy.js baseDaily's order): purify (the boiler burns if it has to), then everyone drinks,
// purified water first; base.drank is what worm.js rolls.
function drinkDay(st, b) {
  purifyDaily(st, b);
  const d = drawWater(b.stock, waterNeed(st, b).people);
  b.drank = { day: day(st), pure: d.pure, raw: d.raw };
}

// ---------- 1. water at a base ----------
{
  console.log("Water at a base");
  const { st, h } = wormWorld(0.8);
  const people = residents(st, h.id);
  const w = baseWater(st, h);
  check(!w.safe && w.eggs > 0.7 && near(w.raw, eggsAt(st, h.tile)), `un-purified ground water on infected land carries eggs (${w.eggs.toFixed(2)}: ${w.why})`);
  let n = withNums(WORM, { WATER: 1 }, () => { drinkDay(st, h); wormDaily(st); return caught(people); });
  check(n > people.length * 0.5, `drinking it, ${n} of ${people.length} catch the worm in a day (WATER pinned to 100% at egg level 1)`);
  clearAll(people);
  addBuilding(h, "boiler");
  // The boiler burns like heating: BOILER_WOOD_HEAD firewood a head a day, firewood first, then fuel for the rest.
  const heads = mouthsAt(st, h).heads;
  const need = heads * WORM.BOILER_WOOD_HEAD;
  h.stock.wood = 50; h.stock.fuel = 20;
  const raw0 = h.stock.rawwater;
  n = withNums(WORM, { WATER: 1 }, () => { drinkDay(st, h); wormDaily(st); return caught(people); });
  const bu = boilerUse(st, h);
  check(n === 0 && baseWater(st, h).safe && near(50 - h.stock.wood, need, 0.01) && near(h.stock.fuel, 20), `a water boiler makes it safe (nobody caught it): it burned ${heads} × ${WORM.BOILER_WOOD_HEAD} = ${(50 - h.stock.wood).toFixed(1)} firewood from the stores, no fuel`);
  check(h.purified && near(h.purified.boiler, h.purified.drink, 0.01) && near(raw0 - h.stock.rawwater, h.purified.drink, 0.01) && h.drank.raw === 0, `it purified the day's drinking (${h.purified.q} un-purified → purified) and everyone drank purified water`);
  check(bu.active && bu.lit && near(bu.wood, need, 0.01) && near(bu.fuel, need * HEAT.wood, 0.01) && /firewood a day \(or [\d.]+ fuel\)/.test(bu.text) && new RegExp(`boiled in the water boiler \\(${heads} people`).test(baseWater(st, h).why), `the water row says what it burns: "${bu.text}"`);
  h.stock.wood = need / 2; h.stock.fuel = 20;
  drinkDay(st, h);
  check(baseWater(st, h).safe && near(h.stock.wood, 0, 0.01) && near(20 - h.stock.fuel, (need / 2) * HEAT.wood, 0.01), `short of firewood it burns what there is and fuel for the rest (${(20 - h.stock.fuel).toFixed(2)} fuel: 1 firewood = ${HEAT.wood} fuel)`);
  h.stock.wood = 0; h.stock.fuel = need * HEAT.wood - 0.05;
  const f1 = h.stock.fuel;
  drinkDay(st, h);
  check(!baseWater(st, h).safe && h.boiling === false && near(h.stock.fuel, f1) && h.drank.raw > 0 && /boiler is cold/.test(baseWater(st, h).why), "a base that cannot pay the whole day leaves it unlit, burns nothing, and drinks un-purified water (the row says the boiler is cold)");
  h.stock.wood = 20;
  drinkDay(st, h);
  check(baseWater(st, h).safe && h.boiling === true, "with firewood again it burns again");
  // Purified water in store covers the day: the boiler stands ready that day (nothing burned).
  h.stock.water = 100; h.stock.wood = 20;
  drinkDay(st, h);
  check(near(h.stock.wood, 20) && h.drank.raw === 0, "with purified water in store for the day it burns nothing");
  h.stock.water = 0;
  const wn = woodNeed(st, h);
  check(wn.boiler > 0 && near(wn.boiler, need, 0.05) && wn.need >= Math.ceil(need * WORM.BOILER_DAYS) && wn.soon, `the firewood plan counts it (${wn.boiler} a day, ${WORM.BOILER_DAYS} days of it wanted: ${wn.need} in all) in every season`);
  h.armory.push(newItem("waterfilter"));
  const w1 = h.stock.wood;
  drinkDay(st, h);
  check(heads * 1 <= WORM.PURIFY_FILTER ? near(h.stock.wood, w1) && !boilerUse(st, h).active && baseWater(st, h).safe : true, `with a water filter here (${WORM.PURIFY_FILTER} a day for ${heads} people) it stands ready and burns nothing`);
  h.armory = h.armory.filter((it) => !(it && it.key === "waterfilter"));
  // An outpost short of it is covered from the hub over its supply line.
  {
    const o = { id: 777, type: "outpost", name: "Boiler Camp", tile: st.grid.neighbors(h.tile)[0], tier: 1, stock: { food: 50, water: 0, rawwater: 50, wood: 0, fuel: 0 }, armory: [], buildings: [], construction: [], boiling: true, supplyLine: { strength: 1 } };
    st.bases.push(o);
    addBuilding(o, "boiler");
    const mover = people[0];
    mover.location = { kind: "base", baseId: o.id };
    h.stock.wood = 40;
    purifyDaily(st, o);
    check(baseWater(st, o).safe && h.stock.wood < 40 && o.boiling === true && o.stock.water > 0, `an outpost with no firewood gets the boiler's from the hub (the hub's pile ${40} → ${h.stock.wood.toFixed(1)})`);
    mover.location = { kind: "base", baseId: h.id };
    st.bases.splice(st.bases.indexOf(o), 1);
  }
  h.buildings = h.buildings.filter((b) => b.type !== "boiler");
  h.armory.push(newItem("waterfilter"));
  clearAll(people);
  h.stock.water = 0;
  n = withNums(WORM, { WATER: 1 }, () => { drinkDay(st, h); wormDaily(st); return caught(people); });
  check(heads <= WORM.PURIFY_FILTER ? n === 0 && baseWater(st, h).safe : true, `a water filter at the base purifies ${WORM.PURIFY_FILTER} a day: enough for ${heads} (nobody caught it)`);
  // Clean ground: no eggs, but un-purified water still carries RAW_BASE.
  const c = wormWorld(WORM.CLEAN - 0.02);
  const cp = residents(c.st, c.h.id);
  n = withNums(WORM, { WATER: 1, RAW_BASE: 0 }, () => { drinkDay(c.st, c.h); wormDaily(c.st); return caught(cp); });
  check(n === 0 && baseWater(c.st, c.h).eggs === 0, `below ${WORM.CLEAN * 100}% infection the water has no eggs (WATER pinned high, RAW_BASE 0: nobody caught it)`);
  n = withNums(WORM, { WATER: 0, RAW_BASE: 1 }, () => { drinkDay(c.st, c.h); wormDaily(c.st); return caught(cp); });
  check(n === cp.length && !baseWater(c.st, c.h).safe, "but any un-purified water carries RAW_BASE (pinned: everyone caught it)");
  // Rain only: a shelter away from water with no well of its own drinks only rain: no eggs, still un-purified.
  const r = wormWorld(0.8);
  r.h.tier = 0; r.h.fire = false;
  for (const id of r.st.grid.neighbors(r.h.tile)) if (r.st.tiles[id].terrain === "water") r.st.tiles[id].terrain = "plains";
  const rw = baseWater(r.st, r.h);
  check(!rw.safe && rw.ground === 0 && rw.eggs === 0 && near(rw.risk, WORM.RAW_BASE * rw.rawShare), `a base drawing no ground water (rain only) has no eggs but its un-purified water still carries RAW_BASE (${rw.why})`);
  r.h.fire = true;
  for (const id of r.st.grid.neighbors(r.h.tile)) r.st.tiles[id].terrain = "water";
  check(baseWater(r.st, r.h).safe && /fire/.test(baseWater(r.st, r.h).why), "a shelter with its fire lit boils its river water");
}

// ---------- 2. water on the road ----------
{
  console.log("Water on the road");
  const { st, h } = wormWorld(0.8);
  const dest = st.grid.within(h.tile, 4).find((id) => st.grid.distance(id, h.tile) === 3 && st.tiles[id].terrain !== "water");
  const crew = atBase(st, h.id).slice(0, 2).map((s) => s.id);
  const res = launchExpedition(st, { memberIds: crew, dest, mission: "scavenge", stance: "normal", supplies: { food: 6, water: 8 } });
  check(res.party && near(res.party.supplies.rawwater, 8) && !(res.party.supplies.water > 0) && res.party.wormEggs > 0.7, `water packed at a base with only un-purified water is un-purified and carries its eggs (${res.party && res.party.supplies.rawwater} units at ${res.party && res.party.wormEggs})`);
  const { p, members } = team(st, h, h.tile, 2);
  p.supplies.water = 0; p.supplies.rawwater = 20; p.wormEggs = 1;
  withNums(WORM, { WATER: 24 }, () => drinkHour(st, p, members, 1, 1));
  check(caught(members) === members.length, "drinking un-purified water with eggs catches it (pinned)");
  clearAll(members);
  withNums(WORM, { WATER: 24 }, () => drinkHour(st, p, members, 1, 0));
  check(caught(members) === 0, "purified water drunk is safe (pinned)");
  members[0].pockets[0] = newItem("waterfilter");
  withNums(WORM, { WATER: 24 }, () => drinkHour(st, p, members, 1, 1));
  check(caught(members) === 0, "a water filter carried cleans what is drunk (nobody caught it)");
  members[0].pockets[0] = null;
  p.supplies.rawwater = 10; p.wormEggs = 1;
  p.supplies.rawwater += 10; addWormWater(st, p, 10, 0);
  check(near(p.wormEggs, 0.5), `clean un-purified water (rain, clean land) thins the eggs of what is carried (${p.wormEggs})`);
  p.supplies.rawwater = 0; p.wormEggs = 0;
  p.supplies.rawwater += 10; addWormWater(st, p, 10, 0.5);
  check(near(p.wormEggs, 0.5), "river water from infected land carries its eggs");
  // A camp fire boils it into purified water.
  p.phase = "task"; p.task = { type: "camp" }; p.campFire = true;
  st.tiles[h.tile].infection = 0.2; // under the camping threshold: only the boiling is under test
  const pure0 = p.supplies.water;
  wormTeamHour(st, p, members);
  check(near(p.supplies.rawwater, 10 - WORM.BOIL) && near(p.supplies.water - pure0, WORM.BOIL), `a camp fire boils ${WORM.BOIL} un-purified water an hour into purified water (${p.supplies.rawwater} un-purified left)`);
  members[0].pockets[0] = newItem("stove");
  wormTeamHour(st, p, members);
  check(near(p.supplies.rawwater, Math.max(0, 10 - WORM.BOIL - WORM.BOIL * WORM.STOVE)), "a smokeless stove boils it faster");
  check(!teamWormText(st, p) || !/water/.test(teamWormText(st, p)), "boiled: the team panel's worm line has no water left in it");
}

// ---------- 2b. the order of purifying: filter, a fed fire, tablets, as it is ----------
{
  console.log("Tablets: on the road and at a base");
  const { st, h } = wormWorld(0.8);
  const bare = st.grid.within(h.tile, 6).find((id) => st.tiles[id].terrain !== "water" && !fireLandOk(st, id) && !st.bases.some((b) => b.tile === id));
  const { p, members } = team(st, h, bare ?? h.tile, 2);
  const tube = () => { const t = newItem("puritabs"); p.cargo.gear = [t]; p.tabWater = 0; return t; };
  p.supplies.water = 0; p.supplies.rawwater = 20; p.wormEggs = 1;
  // On the move: tablets.
  tube();
  withNums(WORM, { WATER: 24, RAW_BASE: 0 }, () => drinkHour(st, p, members, 2, 2));
  check(teamTabCount(st, p) === GEAR.puritabs.dur - 1 && caught(members) === 0 && teamWaterHow(st, p) === "tabs", "on the move: a tablet is dropped in (nobody caught it)");
  // At a camp with the fire lit and firewood carried: boiled, no tablet.
  p.phase = "task"; p.task = { type: "camp" }; p.campFire = true; p.supplies.wood = 5;
  tube();
  check(campFireFed(st, p) && teamWaterHow(st, p) === "fire", "at a camp with the fire lit and firewood: the fire boils it");
  withNums(WORM, { WATER: 24, RAW_BASE: 0 }, () => drinkHour(st, p, members, 2, 2));
  check(teamTabCount(st, p) === GEAR.puritabs.dur && caught(members) === 0, "no tablet used at a lit, fed camp fire (nobody caught it)");
  // At a camp whose fire has nothing to burn (bare ground, no firewood): tablets.
  withNums(WOOD.fire, { land: 1e9 }, () => { // bare ground: no deadfall to feed it
    p.supplies.wood = 0;
    tube();
    check(!campFireFed(st, p) && teamWaterHow(st, p) === "tabs", "a camp on bare ground with no firewood left: the fire cannot be kept going");
    withNums(WORM, { WATER: 24, RAW_BASE: 0 }, () => drinkHour(st, p, members, 2, 2));
    check(teamTabCount(st, p) === GEAR.puritabs.dur - 1 && caught(members) === 0, "so the tablets are used there");
  });
  // A filter carried comes first of all.
  members[0].pockets[0] = newItem("waterfilter");
  tube();
  withNums(WORM, { WATER: 24, RAW_BASE: 0 }, () => drinkHour(st, p, members, 2, 2));
  check(teamTabCount(st, p) === GEAR.puritabs.dur && teamWaterHow(st, p) === "filter", "a water filter carried comes first (no tablet)");
  members[0].pockets[0] = null;
  // Nothing at all: drunk as it is, and clean ground is no longer harmless.
  p.cargo.gear = []; p.tabWater = 0; p.phase = "waiting"; p.task = null; p.wormEggs = 0;
  check(teamWaterHow(st, p) === "unsafe", "with nothing to purify it, it is drunk as it is");
  withNums(WORM, { RAW_BASE: 24, WATER: 0 }, () => drinkHour(st, p, members, 1, 1));
  check(caught(members) === members.length, "even from clean ground (no eggs) un-purified water carries RAW_BASE (pinned): no more 'drunk harmlessly'");
  clearAll(members);

  // At a base: the boiler, the filters, a shelter's fire; tablets only when the boiler is cold for want of firewood and there is no filter.
  const b = wormWorld(0.8, seed + 7);
  b.h.armory = b.h.armory.filter((it) => !(it && (it.key === "waterfilter" || it.key === "puritabs")));
  b.h.armory.push(newItem("puritabs"));
  const tabsHere = () => b.h.armory.filter((it) => it && it.key === "puritabs").reduce((a, it) => a + (it.dur ?? GEAR.puritabs.dur), 0);
  drinkDay(b.st, b.h);
  check(tabsHere() === GEAR.puritabs.dur && b.h.drank.raw > 0, "a base with no boiler does not use its tablets (they are for the road)");
  addBuilding(b.h, "boiler");
  b.h.stock.wood = 50; b.h.stock.water = 0; b.h.stock.rawwater = 300;
  drinkDay(b.st, b.h);
  check(tabsHere() === GEAR.puritabs.dur && b.h.boiling === true && b.h.drank.raw === 0, "with the boiler lit, no tablets");
  b.h.stock.wood = 0; b.h.stock.fuel = 0; b.h.stock.water = 0;
  const log0 = b.st.log.length;
  drinkDay(b.st, b.h);
  const need = waterNeed(b.st, b.h).people;
  check(b.h.boiling === false && tabsHere() === GEAR.puritabs.dur - Math.ceil(need / WORM.TABS_WATER - 1e-9) && b.h.drank.raw === 0 && b.st.log.slice(0, b.st.log.length - log0).some((l) => /Out of firewood at .*: purification tablets used for the water \(\d+ left\)/.test(l.text)), `out of firewood and fuel with no filter: the armory's tablets treat the day's drinking (${Math.ceil(need / WORM.TABS_WATER - 1e-9)} for ${need} water) and a log line says so`);
  b.h.armory.push(newItem("waterfilter"));
  const t1 = tabsHere();
  b.h.stock.water = 0;
  drinkDay(b.st, b.h);
  check(tabsHere() === t1, "with a water filter here they are not used (the emergency is no firewood and no filters)");
  check(boilerUse(b.st, b.h).active === (WORM.PURIFY_FILTER < purifyCap(b.st, b.h).drink) && wormWorld(WORM.CLEAN - 0.05).h && (() => { const c = wormWorld(WORM.CLEAN - 0.05, seed + 8); addBuilding(c.h, "boiler"); return boilerUse(c.st, c.h).active && woodNeed(c.st, c.h).boiler > 0; })(), "the boiler works (and the wood plan counts it) on clean ground too: any un-purified water can carry the worm");
}

// ---------- 3. raw and cooked meat ----------
{
  console.log("Meat: raw and cooked");
  const { st, h } = wormWorld(0.8);
  Object.assign(h.stock, { food: 30, preserved: 0 });
  h.meat = 20; h.wormMeat = 20;
  check(!baseCooks(h) && cookAtBase(st, h) === 0 && near(wormMeatAt(h), 20), "with no cook fire the meat with eggs stays uncooked");
  const miss = eatFromStore(h, 8);
  check(miss === 0 && near(wormMeatAt(h), 20) && !(h.rawEaten > 0), "it is eaten last: the clean food goes first");
  eatFromStore(h, 7);
  check(near(h.rawEaten, 5) && near(wormMeatAt(h), 15) && near(h.stock.food, 15), `once the rest runs out it is eaten raw (${h.rawEaten} rations)`);
  const people = residents(st, h.id);
  const n = withNums(WORM, { RAW: 1, WATER: 0 }, () => { wormDaily(st); return caught(people); });
  check(n === people.length && h.rawEaten === 0, "eating it raw catches the worm (RAW pinned to 1)");
  clearAll(people);
  addBuilding(h, "cookhouse");
  check(baseCooks(h) && near(cookAtBase(st, h), 15) && wormMeatAt(h) === 0, "a cook fire cooks it all through (the eggs die)");
  const k = wormWorld(0.8);
  addBuilding(k.h, "kitchen");
  check(baseCooks(k.h), "a preserving kitchen cooks too");
  k.h.meat = 10; k.h.wormMeat = 10; k.h.stock.food = 50;
  smokeWormMeat(k.h, 4);
  check(near(wormMeatAt(k.h), 6), "drying racks and the smoke house take the meat with eggs first");
  // A team: clean meat eaten first, raw only as the last resort; the camp fire cooks it.
  const { p, members } = team(st, h, h.tile, 2);
  p.cargo = { supplies: {}, gear: [] };
  addMeat(st, p, 10, 0);
  addMeat(st, p, 10, 10);
  check(near(wormMeatIn(p.cargo), 10) && near(p.cargo.meat, 20), "a team's cargo keeps the meat with eggs apart (10 of 20)");
  const ate = takeMeat(p.cargo, 15, { clean: true });
  check(near(ate, 10) && near(wormMeatIn(p.cargo), 10), "the team eats the clean game first (10 of 15 wanted)");
  const raw = withNums(WORM, { RAW: 1 }, () => eatRawCargo(st, p, members, 4));
  check(near(raw, 4) && caught(members) === members.length && near(wormMeatIn(p.cargo), 6), "then raw as the last resort, and catches it (pinned)");
  clearAll(members);
  p.phase = "task"; p.task = { type: "camp" }; p.campFire = true;
  st.tiles[h.tile].infection = 0.2;
  wormTeamHour(st, p, members);
  check(wormMeatIn(p.cargo) === 0, "a camp fire cooks it");
}

// ---------- 4. infested animals ----------
{
  console.log("Infested animals");
  const { st, h } = wormWorld(0.8);
  const tile = st.grid.within(h.tile, 4).find((id) => st.grid.distance(id, h.tile) === 3 && st.tiles[id].terrain !== "water");
  st.tiles[tile].infection = 1;
  st.herds = [{ tile, size: 2000, kind: "deer", born: 1, until: 9999 }];
  const share = infestedShare(st, tile);
  let inf = 0, bad = 0, rations = 0;
  for (let i = 0; i < 1000; i++) {
    const k = wormKill(st, tile, 30);
    if (k.infested) { inf++; if (!near(k.rations, 30 * HERD.YIELD) || !near(k.worm, k.rations)) bad++; }
    else if (!near(k.worm, 30)) bad++;
    rations += k.rations;
  }
  check(bad === 0, `an infested deer yields ${30 * HERD.YIELD} of its 30 food, all of it with eggs; a clean one on infected land carries eggs too`);
  check(Math.abs(inf / 1000 - share) < 0.04, `infested at the tile's share (${(inf / 10).toFixed(1)}% against ${(share * 100).toFixed(0)}%)`);
  check(herdAt(st, tile).size === 2000 - inf, `each infested kill on its tile takes one from the herd (${herdAt(st, tile).size} left)`);
  st.herds[0].size = 1;
  let gone = false;
  for (let i = 0; i < 200 && !gone; i++) { wormKill(st, tile, 2); gone = !herdAt(st, tile); }
  check(gone, "a herd hunted out is gone");
  const clean = st.grid.within(h.tile, 8).find((id) => st.tiles[id].terrain !== "water" && (st.tiles[id].infection || 0) < HERD.SHARE_AT && (st.tiles[id].infection || 0) < WORM.MEAT_AT && !herdAt(st, id));
  let cleanBad = 0;
  for (let i = 0; i < 200; i++) { const k = wormKill(st, clean, 30); if (k.infested || k.worm) cleanBad++; }
  check(cleanBad === 0, "on clean land no animal is infested and the meat is clean");
  const fish = wormKill(st, tile, 5, { fish: true });
  check(!fish.infested && near(fish.rations, 5) && near(fish.worm, 5), "fish from infected water carry eggs but are never 'infested' (full yield)");
  // The hunt estimate counts them.
  const hunters = atBase(st, h.id).slice(0, 2);
  for (const s of hunters) s.gear.weapon = newItem("huntrifle");
  const ht = huntTeam(st, hunters, 99);
  st.herds = [{ tile, size: 6, kind: "deer", born: 1, until: 9999 }];
  const withHerd = expectHunt(st, ht.team, tile, 8, st.hour, 0).rations;
  st.herds = [];
  const without = expectHunt(st, ht.team, tile, 8, st.hour, 0).rations;
  check(withHerd < without && near(huntYieldMult(st, tile), 1 - infestedShare(st, tile) * (1 - HERD.YIELD)), `the hunt estimate drops with a herd there (${withHerd} against ${without} food in 8h)`);
  // Spreading: a herd seeds the land it stands on.
  const spot = st.grid.within(h.tile, 6).find((id) => st.tiles[id].terrain === "forest" || st.tiles[id].terrain === "plains");
  st.tiles[spot].infBase = 0.1; st.tiles[spot].infection = 0.1;
  st.herds = [{ tile: spot, size: 6, kind: "deer", born: day(st), until: day(st) + 100 }];
  withNums(HERD, { MOVE: 0, SPAWN: 0 }, () => { for (let i = 0; i < 10; i++) herdsDaily(st); });
  check(near(st.tiles[spot].infBase, 0.1 + 10 * HERD.SEED, 1e-6), `a herd of 6 seeds its tile: base infection 0.10 → ${st.tiles[spot].infBase.toFixed(3)} in 10 days`);
  st.tiles[spot].infBase = HERD.SEED_CAP - 0.001;
  withNums(HERD, { MOVE: 0, SPAWN: 0 }, () => { for (let i = 0; i < 10; i++) herdsDaily(st); });
  check(near(st.tiles[spot].infBase, HERD.SEED_CAP), `never above ${HERD.SEED_CAP}`);
  const from = st.herds[0].tile;
  withNums(HERD, { MOVE: 1, SPAWN: 0 }, () => herdsDaily(st));
  const to = st.herds[0].tile;
  check(to !== from && st.grid.distance(from, to) === 1 && st.tiles[to].terrain !== "water", "it wanders a tile a day to land next to it");
  st.herds[0].until = day(st);
  withNums(HERD, { SPAWN: 0 }, () => herdsDaily(st));
  check(!st.herds.length, "and dies off when its days are up");
  withNums(HERD, { SPAWN: 1 }, () => herdsDaily(st));
  const born = st.herds[0];
  check(born && st.tiles[born.tile].infection >= HERD.BORN_AT && born.size >= HERD.SIZE[0] && born.size <= HERD.SIZE[1], `a new herd is born on land at ${HERD.BORN_AT * 100}%+ infection (size ${born && born.size})`);
  for (let i = 0; i < 50; i++) withNums(HERD, { SPAWN: 1 }, () => herdsDaily(st));
  check(st.herds.length <= herdCap(st), `never more than ${herdCap(st)} herds on this map (${HERD.PER_1000} per 1,000 tiles)`);
}

// ---------- 5. camping on infested land ----------
{
  console.log("Camping");
  const { st, h } = wormWorld(0.1);
  const tile = st.grid.within(h.tile, 4).find((id) => st.grid.distance(id, h.tile) === 3 && st.tiles[id].terrain !== "water");
  const { p, members } = team(st, h, tile, 3);
  p.phase = "task"; p.task = { type: "camp" }; p.campFire = false;
  st.tiles[tile].infection = WORM.CAMP_AT - 0.05;
  withNums(WORM, { CAMP: 10000 }, () => { for (let i = 0; i < 24; i++) wormTeamHour(st, p, members); });
  check(caught(members) === 0, `camping a day on land just under ${WORM.CAMP_AT * 100}% infection: nobody catches it`);
  st.tiles[tile].infection = WORM.CAMP_AT + 0.05;
  withNums(WORM, { CAMP: 10000 }, () => wormTeamHour(st, p, members));
  check(caught(members) === members.length, "above it, camping does (pinned)");
  clearAll(members);
  p.phase = "waiting"; p.task = null;
  withNums(WORM, { CAMP: 10000 }, () => wormTeamHour(st, p, members));
  check(caught(members) === 0, "passing through (not camping) does not");
}

// ---------- 6. the course, spotting, cures ----------
// A course on day d (v 2: the week-long course), caught days ago.
const course = (d, o = {}) => ({ v: 2, stage: d >= WORM.BRAIN_FROM ? "brain" : "gut", day: d, len: WORM.COURSE, since: -9, why: "test", how: "water", seen: null, treatedDay: -99, carded: "", paid: 0, ...o });
const noSpot = { SPOT: 0, SPOT_MED: 0, BRAIN_SPOT: 0, TEAM_SPOT: 0, TEAM_SPOT_MED: 0 };
{
  console.log("The course");
  const { st, h } = wormWorld(0.05);
  h.autoTreat = false;
  const here = atBase(st, h.id);
  const s = here[0];
  catchWorm(st, s, "for the test", "water");
  check(s.worm.stage === "gut" && s.worm.day === 0 && s.worm.v === 2 && !wormSeen(s), "caught: the gut stage, day 0, unseen (no silent week of eggs any more)");
  {
    const o = here[2];
    check(catchWorm(st, o, "swarm") && hasWorm(o) && o.worm.from === "swarm" && /worm swarm/.test(o.worm.why) && o.worm.stage === "gut", "catchWorm(state, s, \"swarm\") (a Carrier's worm swarm) starts the same course; hasWorm says so");
    o.alive = false;
    check(hasWorm(o), "hasWorm stays true for someone who just died with it (they rise: carriers.js)");
    o.alive = true;
    clearWorm(o);
    check(!hasWorm(o), "clearWorm clears it");
  }
  const hp0 = s.health;
  withNums(WORM, noSpot, () => wormDaily(st));
  check(s.worm.day === 0 && s.health === hp0, "caught today: nothing until tomorrow (at most a day of quiet)");
  s.worm.since = day(st) - 1;
  s.health = 100; s.mood = 90;
  const hp = [], mood = [], food = [];
  let diedOn = 0;
  for (let d = 1; d <= 10; d++) {
    const h0 = s.health, m0 = s.mood, f0 = h.stock.food;
    withNums(WORM, noSpot, () => wormDaily(st));
    if (!s.alive) { diedOn = d; break; }
    hp.push(Math.round((h0 - s.health) * 100) / 100); mood.push(Math.round((m0 - s.mood) * 100) / 100); food.push(Math.round((f0 - h.stock.food) * 100) / 100);
    if (d === 1) check(near(workFactor({ ...s, conditions: [] }), Math.round(WORM.GUT_WORK * workFactor({ ...s, worm: null, conditions: [] }) * 100) / 100, 0.011), `day 1: working at ${WORM.GUT_WORK * 100}%`);
    if (d === WORM.BRAIN_FROM) check(s.worm.stage === "brain" && near(workFactor({ ...s, conditions: [] }), Math.round(WORM.BRAIN_WORK * workFactor({ ...s, worm: null, conditions: [] }) * 100) / 100, 0.011), `day ${WORM.BRAIN_FROM}: the brain, working at ${WORM.BRAIN_WORK * 100}%`);
  }
  check(JSON.stringify(hp) === JSON.stringify(WORM.DAY_HP.slice(0, hp.length)), `untreated, the damage grows each day: ${hp.join(", ")} (DAY_HP)`);
  check(JSON.stringify(mood) === JSON.stringify(WORM.DAY_MOOD.slice(0, mood.length)), `and the mood falls each day, more each day: ${mood.join(", ")}`);
  check(food.slice(0, WORM.BRAIN_FROM - 1).every((f) => near(f, WORM.GUT_EAT)) && near(food[WORM.BRAIN_FROM - 1] || 0, 0), `eats ${WORM.GUT_EAT} more a day in the gut stage (days 1–${WORM.BRAIN_FROM - 1}), not in the brain`);
  check(diedOn >= 6 && diedOn <= 7 && !s.alive, `someone at full health dies of it on day ${diedOn} (6–7)`);
  check(st.log.some((l) => /died of the worm\./.test(l.text)) && st.log.some((l) => new RegExp(`${s.name} died with the worm in them at ${h.name} and got up again`).test(l.text)), "and gets up again at the base (a log line)");
  // Someone hurt dies sooner.
  const t = here[1];
  t.worm = course(0); t.health = 40;
  let d2 = 0;
  for (let d = 1; d <= 10 && t.alive; d++) { withNums(WORM, noSpot, () => wormDaily(st)); if (!t.alive) d2 = d; }
  check(d2 > 0 && d2 < diedOn, `someone at 40 health dies sooner (day ${d2})`);
  // Nobody heals while it is in them.
  const u = here[3];
  u.health = 50; u.worm = course(2);
  check(healRatePerHour(st, h, u) === 0 && campHealPerHour(st, { supplies: { food: 9 }, members: [] }, u) === 0, "nobody heals while it is in them (base and camp)");
  u.worm = null;
  check(healRatePerHour(st, h, u) > 0, "and heals again once it is gone");
  check(dayHp(9) === WORM.LATE_HP && stageFor(WORM.BRAIN_FROM - 1) === "gut" && stageFor(WORM.BRAIN_FROM) === "brain", `past day ${WORM.DAY_HP.length} it keeps on (${WORM.LATE_HP} a day)`);
  // The label and the cure text.
  u.worm = course(3, { seen: 1 });
  check(wormLabel(u) === `Infected (day 3 of about ${WORM.COURSE}): −${WORM.DAY_HP[2]} health today, −${WORM.DAY_MOOD[2]} mood`, `the label: "${wormLabel(u)}"`);
  check(/dewormer/.test(wormCureText(u)) && /surgery/.test(wormCureText({ ...u, worm: course(5) })), "the cure open at the stage: a dewormer or a purge, then surgery");
  u.worm = null;

  console.log("Spotting");
  const seenBy = (medic) => {
    const w = wormWorld(0.05, seed + (medic ? 1 : 2));
    for (let i = 0; i < 30; i++) { const n = makeSurvivor(w.st); n.traits = []; n.role = "rest"; n.location = { kind: "base", baseId: w.h.id }; w.st.survivors.push(n); }
    const people = atBase(w.st, w.h.id);
    for (const x of people) { x.skills.medicine = 0; x.role = "rest"; x.health = 100; }
    if (medic) { people[0].skills.medicine = 10; people[0].role = "medic"; }
    for (const x of people) if (!(medic && x === people[0])) x.worm = course(0);
    w.h.autoTreat = false;
    let days = 0, n = 0;
    for (let d = 1; d <= 4; d++) { wormDaily(w.st); for (const x of people) if (x.worm && x.worm.seen != null && !x.counted) { x.counted = true; days += d; n++; } }
    return { n, of: people.length - (medic ? 1 : 0), avg: n ? days / n : 99 };
  };
  const a = seenBy(true), b = seenBy(false);
  check(a.n === a.of && a.avg <= 1.05 && a.avg <= b.avg && b.avg < 2.5, `the damage shows from day 1: with a medic (Medicine 10) ${a.n} of ${a.of} spotted on day ${a.avg.toFixed(1)} on average; with no medic day ${b.avg.toFixed(1)}`);
  {
    const w = wormWorld(0.05);
    const { p, members } = team(w.st, w.h, w.h.tile, 2);
    w.st.cards.length = 0;
    const m = members[0];
    m.worm = course(0);
    let on = 0;
    for (let d = 1; d <= 4 && !on; d++) { wormDaily(w.st); if (wormSeen(m)) on = d; }
    const card = w.st.cards.find((c) => c.title === "The worm" && c.partyId === p.id);
    check(on >= 1 && on <= 3 && card && card.choices.some((c) => /^Purge/.test(c.label)) && card.choices.some((c) => /^End it/.test(c.label)) && card.choices.some((c) => /^Hope/.test(c.label)), `a team notices on day ${on} (a day or two), and the card The worm comes (purge, end it, hope)`);
    check(!card.choices.some((c) => /dewormer/.test(c.label)), "no dewormer choice when the team carries none");
    m.health = 100;
    members[1].pockets[1] = newItem("dewormer");
    m.worm = course(1);
    w.st.cards.length = 0;
    withNums(WORM, { TEAM_SPOT: 1 }, () => wormDaily(w.st));
    const c2 = w.st.cards.find((c) => c.title === "The worm");
    const dw = c2 && c2.choices.find((c) => /dewormer/.test(c.label));
    const txt = dw ? dw.resolve(w.st) : "";
    check(dw && !m.worm && /passes the worm/.test(txt) && !members[1].pockets[1], "with one carried, the dewormer cures it and is used up");
    m.health = 100;
    m.worm = course(WORM.BRAIN_FROM - 1, { seen: 2, carded: "gut" });
    w.st.cards.length = 0;
    wormDaily(w.st);
    const c3 = w.st.cards.find((c) => c.title === "The worm");
    const purge = c3 && c3.choices.find((c) => /^Purge/.test(c.label));
    check(c3 && purge && purge.disabled && /reached the brain/.test(c3.text), `on day ${WORM.BRAIN_FROM} (the brain) the team's card comes again, the purge disabled`);
  }

  console.log("Cures at a base");
  {
    const w = wormWorld(0.05);
    const people = atBase(w.st, w.h.id);
    const x = people[1];
    people[0].role = "medic"; people[0].skills.medicine = 5;
    w.h.armory.push(newItem("dewormer"));
    let ok = true;
    for (let d = 1; d < WORM.BRAIN_FROM; d++) { x.worm = course(d, { seen: 1 }); ok = ok && wormTreatInfo(w.st, w.h, x, "dewormer").ok && !wormTreatInfo(w.st, w.h, x, "surgery").ok; }
    x.worm = course(WORM.BRAIN_FROM, { seen: 1 });
    check(ok && !wormTreatInfo(w.st, w.h, x, "dewormer").ok && /brain/.test(wormTreatInfo(w.st, w.h, x, "dewormer").reason), `a dewormer cures on days 1–${WORM.BRAIN_FROM - 1} (surgery not offered then); from day ${WORM.BRAIN_FROM} it is too late`);
    x.worm = course(2, { seen: 1 });
    applyWormTreat(w.st, w.h, x, wormTreatInfo(w.st, w.h, x, "dewormer"));
    check(!x.worm && !w.h.armory.some((it) => it && it.key === "dewormer"), "the dewormer cures it surely and is used up");
    x.worm = course(3, { seen: 1 });
    let info = wormTreatInfo(w.st, w.h, x, "dewormer");
    check(!info.ok && /No dewormer/.test(info.reason), "no dewormer here: that button says so");
    info = wormTreatInfo(w.st, w.h, x, "purge");
    const tier = activeHospital(w.st, w.h).tier || 0;
    check(info.ok && near(info.chance, Math.min(WORM.PURGE_MAX, WORM.PURGE + WORM.PURGE_MED * 5 + WORM.PURGE_TIER * tier)), `a purge: ${WORM.PURGE_MEDS} meds and a medic, ${Math.round(info.chance * 100)}% with Medicine 5 and a hospital of tier ${tier}`);
    const meds0 = w.h.stock.meds, hp0 = x.health;
    applyWormTreat(w.st, w.h, x, { ...info, chance: 0 });
    check(x.worm && near(meds0 - w.h.stock.meds, WORM.PURGE_MEDS) && near(hp0 - x.health, WORM.PURGE_FAIL_HP), "a failed purge costs the meds and some health; the worm holds on");
    check(!wormTreatInfo(w.st, w.h, x, "purge").ok, "and it can only be tried once a day");
    x.worm.treatedDay = -99;
    applyWormTreat(w.st, w.h, x, { ...wormTreatInfo(w.st, w.h, x, "purge"), chance: 1 });
    check(!x.worm, "a purge that works clears it");
    x.health = 100;
    x.worm = course(WORM.BRAIN_FROM, { seen: 1, carded: "brain" });
    check(!wormTreatInfo(w.st, w.h, x, "purge").ok && /surgery/i.test(wormTreatInfo(w.st, w.h, x, "purge").reason), "in the brain a purge is too late");
    check(!wormTreatInfo(w.st, w.h, x, "surgery").ok && /Clinic/.test(wormTreatInfo(w.st, w.h, x, "surgery").reason), "and surgery needs a staffed Clinic");
    x.worm = course(WORM.BRAIN_FROM - 1, { seen: 1 });
    addBuilding(w.h, "clinic");
    people[2].role = "medic"; people[2].skills.medicine = 6;
    check(!wormTreatInfo(w.st, w.h, x, "surgery").ok && /brain stage/.test(wormTreatInfo(w.st, w.h, x, "surgery").reason), `surgery only from day ${WORM.BRAIN_FROM}, even with a Clinic`);
    x.worm = course(WORM.BRAIN_FROM, { seen: 1, carded: "brain" });
    const si = wormTreatInfo(w.st, w.h, x, "surgery");
    check(si.ok && si.load === WORM.SURGERY_LOAD, `from day ${WORM.BRAIN_FROM} with one, surgery (${WORM.SURGERY_MEDS} meds, ${Math.round(si.chance * 100)}%)`);
    applyWormTreat(w.st, w.h, x, { ...si, chance: 1 });
    check(!x.worm && x.alive, "surgery that works saves them");
    // The night's care: a dewormer from the armory first.
    const y = people[3];
    y.health = 100;
    y.worm = course(2, { seen: 1 });
    w.h.armory.push(newItem("dewormer"));
    const m0 = w.h.stock.meds;
    wormDaily(w.st);
    check(!y.worm && !w.h.armory.some((it) => it && it.key === "dewormer") && w.h.stock.meds === m0, "the night's automatic care uses a dewormer from the armory (no meds)");
    y.health = 100;
    y.worm = course(2, { seen: 1 });
    withNums(WORM, { PURGE: 1, PURGE_MAX: 1 }, () => wormDaily(w.st));
    check(!y.worm && w.h.stock.meds === m0 - WORM.PURGE_MEDS, "with none, a purge with the base's meds");
    y.health = 100;
    y.worm = course(2);
    withNums(WORM, noSpot, () => wormDaily(w.st));
    check(!!y.worm, "nobody treats what nobody has spotted");
  }
}

// ---------- 6a. death and rising, by place ----------
// Kills someone with the worm tonight: day 6 of the course at 1 health.
const dying = (s) => { s.worm = course(WORM.BRAIN_FROM + 1, { seen: 1, carded: "brain" }); s.health = 1; };
{
  console.log("Death and rising: at your base");
  const w = wormWorld(0.05);
  w.h.autoTreat = false;
  const people = atBase(w.st, w.h.id);
  for (const o of people) { o.role = "rest"; o.health = 100; o.mood = 60; }
  const x = people[0];
  dying(x);
  x.gear.weapon = newItem("machete");
  const armory0 = w.h.armory.length;
  withNums(WORM, { TURN_KILL: 0, TURN_SECOND: 1 }, () => wormDaily(w.st));
  const hurtN = people.slice(1).filter((o) => o.health < 100).length;
  check(!x.alive && !x.worm && w.st.log.some((l) => /died with the worm in them at .* and got up again/.test(l.text)), "the worm kills them at the base and they get up again (a log line)");
  check(hurtN === 2 && people[1].mood < 60, `they go for the nearest people (${hurtN} hurt) before they are put down; everyone's mood drops`);
  check(w.h.armory.length > armory0 && w.h.armory.some((it) => it && it.key === "machete") && !w.st.deathSites.some((d) => d.tile === w.h.tile), "the body is put down: no body to recover, its things go to the armory");
  const w2 = wormWorld(0.05);
  w2.h.autoTreat = false;
  const p2 = atBase(w2.st, w2.h.id);
  for (const o of p2) o.health = 100;
  dying(p2[0]);
  p2[0].worm.locked = true;
  wormDaily(w2.st);
  check(!p2[0].alive && p2.slice(1).every((o) => o.health === 100) && w2.st.log.some((l) => /behind a locked door/.test(l.text)), "locked away, they rise alone (nobody hurt)");
  // A guard on duty halves the killing.
  const w3 = wormWorld(0.05);
  w3.h.autoTreat = false;
  const p3 = atBase(w3.st, w3.h.id);
  for (const o of p3) o.health = 100;
  p3[1].role = "guard";
  dying(p3[0]);
  withNums(WORM, { TURN_KILL: 1, TURN_SECOND: 1 }, () => wormDaily(w3.st));
  // The base card when the brain stage shows.
  const w4 = wormWorld(0.05);
  const h4 = atBase(w4.st, w4.h.id);
  w4.st.cards.length = 0;
  h4[0].worm = course(WORM.BRAIN_FROM - 1, { seen: 5, carded: "" });
  w4.h.autoTreat = false;
  wormDaily(w4.st);
  const c = w4.st.cards.find((k) => /^The worm: /.test(k.title));
  check(c && c.choices.some((k) => /^Try surgery/.test(k.label) && k.disabled) && c.choices.some((k) => /^Lock them away/.test(k.label)), `on day ${WORM.BRAIN_FROM} at a base the brain stage brings a card: surgery (disabled with no Clinic), lock them away, end it`);
}
{
  console.log("Death and rising: on the road");
  const make = (patch = {}) => {
    const w = wormWorld(0.05);
    const tile = w.st.grid.within(w.h.tile, 4).find((id) => w.st.grid.distance(id, w.h.tile) === 3 && w.st.tiles[id].terrain !== "water" && !w.st.factions.some((f) => f.bases.includes(id)));
    const { p, members } = team(w.st, w.h, tile, 3);
    for (const o of members) { o.health = 100; o.mood = 60; }
    dying(members[0]);
    members[0].gear.weapon = newItem("machete");
    w.st.cards.length = 0;
    withNums(WORM.RISE, patch, () => wormDaily(w.st));
    const card = w.st.cards.find((k) => k.title === `${members[0].name} rose`);
    return { ...w, p, members, tile, card };
  };
  let r = make({ NOTICE: 0, NOTICE_SKILL: 0 });
  check(!r.members[0].alive && r.card && r.card.choices.some((k) => k.label === "Put them down") && r.card.choices.some((k) => k.label === "Leave them") && !r.card.choices.some((k) => /Crush/.test(k.label)), `the card "${r.members[0].name} rose": put them down or leave them (nobody saw the last breath: no skull to crush)`);
  check(r.members.slice(1).every((o) => o.mood < 60), "the team's mood drops");
  const site = r.st.deathSites.find((d) => d.tile === r.tile);
  check(site && site.items.some((it) => it.item && it.item.key === "machete"), "their things lie where they fell (a death site)");
  let leave = r.card.choices.find((k) => k.label === "Leave them").resolve(r.st);
  check(/backs away/.test(leave) && r.st.deathSites.find((d) => d.tile === r.tile).items.some((it) => it.item && it.item.key === "machete") && r.members.slice(1).every((o) => o.health === 100), "leave them: nobody hurt, the body and their gear stay at the death site");
  r = make({ NOTICE: 0, NOTICE_SKILL: 0, HURT_MIN: 1, HURT_MAX: 1 });
  const put = r.card.choices.find((k) => k.label === "Put them down");
  const txt = put.resolve(r.st);
  check(r.members.slice(1).some((o) => o.health < 100) && r.p.cargo.gear.some((it) => it.key === "machete") && /puts .* down/.test(txt), `put them down by the numbers (hurt pinned): someone is hurt, their things are kept ("${txt}")`);
  r = make({ NOTICE: 1 });
  const crush = r.card.choices.find((k) => /Crush the skull/.test(k.label));
  check(crush && crush.ai(r.st) > Math.max(...r.card.choices.filter((k) => k !== crush).map((k) => k.ai(r.st))), "someone saw the last breath: crush the skull before they rise (the autopilot's pick)");
  crush.resolve(r.st);
  check(r.members.slice(1).every((o) => o.health === 100) && r.p.cargo.gear.some((it) => it.key === "machete"), "nobody is hurt, their things are kept");
  const odds = putDownOdds(r.st, r.p, r.tile);
  check(odds >= WORM.RISE.HURT_MIN && odds <= WORM.RISE.HURT_MAX, `the chance someone is hurt putting them down: ${Math.round(odds * 100)}% for this team`);
  // Alone: they walk off with their things (carriers.js walking loot).
  const w = wormWorld(0.05);
  const tile = w.st.grid.within(w.h.tile, 4).find((id) => w.st.grid.distance(id, w.h.tile) === 3 && w.st.tiles[id].terrain !== "water");
  const solo = team(w.st, w.h, tile, 1);
  dying(solo.members[0]);
  wormDaily(w.st);
  check(!solo.members[0].alive && (w.st.walkingLoot || []).some((e) => e.sid === solo.members[0].id), "alone on the road they walk off with their things (the walking dead)");
  // On a personal errand: alone, a death site where they fell.
  const e = wormWorld(0.05);
  const x = atBase(e.st, e.h.id)[0];
  x.location = { kind: "errand", baseId: e.h.id, until: day(e.st) + 5, pack: { food: 5, water: 5 } };
  x.gear.weapon = newItem("machete");
  dying(x);
  wormDaily(e.st);
  const es = e.st.deathSites.find((d) => d.names.includes(x.name));
  check(!x.alive && es && es.tile !== e.h.tile && es.items.some((it) => it.item && it.item.key === "machete") && e.st.log.some((l) => /personal errand/.test(l.text)), "on a personal errand: they die alone, a death site with their things");
  // A convoy crew holding at a base: like the base.
  const cv = wormWorld(0.05);
  cv.h.autoTreat = false;
  const crew = atBase(cv.st, cv.h.id).slice(0, 1);
  const convoy = { id: 91000, owner: "player", kind: "convoy", routeKind: "supply", phase: "holding", destBaseId: cv.h.id, members: crew.map((s) => s.id), supplies: { food: 5, water: 5 }, cargo: { supplies: {}, gear: [] }, path: [cv.h.tile], idx: 0 };
  cv.st.parties.push(convoy);
  crew[0].location = { kind: "party", partyId: convoy.id };
  for (const o of atBase(cv.st, cv.h.id)) o.health = 100;
  dying(crew[0]);
  withNums(WORM, { TURN_KILL: 0, TURN_SECOND: 1 }, () => wormDaily(cv.st));
  check(!crew[0].alive && atBase(cv.st, cv.h.id).some((o) => o.health < 100) && cv.st.log.some((l) => new RegExp(`${crew[0].name} died with the worm in them at ${cv.h.name}`).test(l.text)), "a convoy crew holding at a base rises there like a resident");
}
{
  console.log("Death and rising: a city crawl");
  const w = wormWorld(0.3);
  const tile = w.st.grid.within(w.h.tile, 4).find((id) => w.st.grid.distance(id, w.h.tile) === 3 && w.st.tiles[id].terrain !== "water");
  const { p, members } = team(w.st, w.h, tile, 3);
  for (const o of members) o.health = 100;
  p.dest = tile;
  startCrawl(w.st, p);
  const alert0 = p.crawl.alert;
  dying(members[0]);
  wormDaily(w.st);
  const e = p.crawl && p.crawl.enc;
  check(!members[0].alive && e && e.kind === "turned" && e.enemy.count === 1 && e.enemy.kind === "zombies" && p.crawl.alert > alert0, `on a block card: the encounter "One of you turned" (one of the dead), the Alert ${alert0} → ${p.crawl && p.crawl.alert}`);
  check(encounterOptions(w.st, p).some((o) => o.id === "numbers") && encounterOptions(w.st, p).some((o) => o.id === "fight"), "fought like the street's encounters (on the map or by the numbers)");
  const res = resolveEncounter(w.st, p, "numbers");
  check(!p.crawl || !p.crawl.enc, `and resolved like them (${res})`);
  if (p.crawl) {
    p.crawl.enc = { kind: "horde", block: 1, enemy: { kind: "zombies", count: 4, power: 3, name: "a horde" }, text: "A horde." };
    dying(members[1]);
    wormDaily(w.st);
    check(!members[1].alive && p.crawl.enc.enemy.count === 5 && /got up again/.test(p.crawl.enc.text), "with an encounter already in front of them, the risen joins it");
  }
  // Inside a building (a battle): the unit dies and one of the dead takes its place on the same cell and floor.
  const bw = wormWorld(0.3, seed + 11);
  const bt = bw.st.grid.within(bw.h.tile, 4).find((id) => bw.st.grid.distance(id, bw.h.tile) === 3 && bw.st.tiles[id].terrain !== "water");
  const bteam = team(bw.st, bw.h, bt, 3);
  for (const o of bteam.members) o.health = 100;
  const b = createBattle(bw.st, { tile: bt, partyId: bteam.p.id, enemy: { kind: "zombies", count: 2, power: 3 }, ambush: null, canRetreat: true });
  const u = b.units.find((x) => x.side === "player" && x.sid === bteam.members[2].id);
  bteam.members[2].worm = course(WORM.BRAIN_FROM + 1, { seen: 1 });
  u.hp = 0.5;
  b.turn = 6;
  const n0 = b.units.length;
  wormBattleRound(bw.st, b);
  const z = b.units.find((x) => x.turned && x.turned.from === u.id);
  check(u.dead && u.wormDeath && z && z.side === "enemy" && z.kind === "zombie" && z.x === u.x && z.y === u.y && (z.f || 0) === (u.f || 0) && z.aware && b.units.length === n0 + 1, `in a battle the worm kills the unit (a battle hour of its day) and one of the dead stands on its cell and floor (${z && z.name})`);
  check(b.log.some((l) => /the worm has eaten the last of them/.test(l.text)) && bteam.members[2].worm.paid > 0, "a battle log line; the hour's damage is taken off the day's");
  const other = b.units.find((x) => x.side === "player" && !x.dead && x.sid !== bteam.members[2].id);
  const sOther = bteam.members.find((m) => m.id === other.sid);
  sOther.worm = course(2, { seen: 1 });
  const hpU = other.hp;
  b.turn = 12;
  wormBattleRound(bw.st, b);
  check(!other.dead && near(hpU - other.hp, dayHp(3) / 24) && near(sOther.worm.paid, dayHp(3) / 24), `a battle hour costs an infected unit a 24th of the coming day's damage (${(dayHp(3) / 24).toFixed(2)})`);
  const before = sOther.health;
  sOther.health = 100;
  sOther.location = { kind: "base", baseId: bw.h.id };
  bw.h.autoTreat = false;
  wormDaily(bw.st);
  check(near(100 - sOther.health, dayHp(3) - dayHp(3) / 24, 0.01), "and at midnight that day's damage is less what the battle took");
  // On another storey.
  const u2 = b.units.find((x) => x.side === "player" && !x.dead);
  if (u2) {
    u2.f = 2;
    const z2 = riseInBattle(bw.st, b, u2);
    check(z2 && z2.f === 2 && z2.x === u2.x && z2.y === u2.y, "on an upper floor it rises on that floor");
  }
}
{
  console.log("Death and rising: another group's base");
  const w = wormWorld(0.05);
  const f = w.st.factions.find((x) => x.alive && x.bases.length);
  f.pop = 20; f.goodwill = 10;
  const x = atBase(w.st, w.h.id)[0];
  x.location = { kind: "captive", factionId: f.id, tile: f.bases[0], since: w.st.hour };
  dying(x);
  withNums(WORM.RISE, { HOST_LOSS: 1 }, () => wormDaily(w.st));
  check(!x.alive && f.pop === 19 && f.goodwill === 10, "held prisoner by a group: the group puts the body down, may lose one of its own (pinned), and no goodwill is lost");
  const w2 = wormWorld(0.05);
  const f2 = w2.st.factions.find((g) => g.alive && g.bases.length);
  f2.pop = 20; f2.goodwill = 10; f2.known = true;
  const { members } = team(w2.st, w2.h, f2.bases[0], 2);
  dying(members[0]);
  members[0].gear.weapon = newItem("machete");
  withNums(WORM.RISE, { HOST_LOSS: 0 }, () => wormDaily(w2.st));
  check(!members[0].alive && f2.pop === 20 && f2.goodwill === 10 + WORM.RISE.ENVOY_GOODWILL && w2.st.log.some((l) => /brought|blame you/.test(l.text)), `a team visiting a group's base: they put the body down and blame you (goodwill ${WORM.RISE.ENVOY_GOODWILL}, a log line)`);
}
{
  console.log("Catching it: everyone who drinks un-purified water");
  const w = wormWorld(WORM.CLEAN - 0.05); // clean ground: only RAW_BASE
  w.h.autoTreat = false;
  const f = w.st.factions.find((x) => x.alive && x.bases.length);
  const pris = takePrisonersAt(w.st, f, w.h, 2);
  const crew = atBase(w.st, w.h.id).slice(0, 1);
  const convoy = { id: 91001, owner: "player", kind: "convoy", routeKind: "supply", phase: "holding", destBaseId: w.h.id, members: crew.map((s) => s.id), supplies: { food: 5, water: 5 }, cargo: { supplies: {}, gear: [] }, path: [w.h.tile], idx: 0 };
  w.st.parties.push(convoy);
  crew[0].location = { kind: "party", partyId: convoy.id };
  const guests = { id: 91002, kind: "explorers", name: "the test travellers", phase: "sheltered", shelterBase: w.h.id, size: 3, stock: {}, wares: [] };
  (w.st.visitors = w.st.visitors || []).push(guests);
  const cap = atBase(w.st, w.h.id)[1];
  cap.location = { kind: "captive", factionId: f.id, tile: f.bases[0], since: w.st.hour };
  const residentsNow = residents(w.st, w.h.id);
  check(baseWater(w.st, w.h).eggs === 0 && near(baseWater(w.st, w.h).risk, WORM.RAW_BASE) && !baseWater(w.st, w.h).safe, `clean ground: un-purified water still carries ${(WORM.RAW_BASE * 100).toFixed(2)}% a day (RAW_BASE), not safe`);
  withNums(WORM, { RAW_BASE: 1, WATER: 0 }, () => withNums(WORM.RISE, { CAPTIVE: 1 }, () => { drinkDay(w.st, w.h); wormDaily(w.st); }));
  check(residentsNow.every((s) => s.worm), "residents drinking it catch it (RAW_BASE pinned)");
  check(pris.every((p) => p.s.worm), "prisoners at the base catch it");
  check(crew[0].worm && (guests.worm || []).length === 3, "a convoy crew holding there and guests sheltering there catch it");
  check(!!cap.worm, "your people held by a group catch it from the group's water");
  // The base rate: about one case per 10 people per 30 days.
  const r = wormWorld(WORM.CLEAN - 0.05, seed + 5);
  for (let i = 0; i < 24; i++) { const n = makeSurvivor(r.st); n.traits = []; n.role = "rest"; n.location = { kind: "base", baseId: r.h.id }; r.st.survivors.push(n); }
  const ppl = residents(r.st, r.h.id);
  let cases = 0;
  for (let d = 0; d < 300; d++) { drinkDay(r.st, r.h); r.h.stock.rawwater = 300; withNums(WORM, { SICK_X: 0 }, () => wormDaily(r.st)); for (const s of ppl) if (s.worm) { cases++; s.worm = null; } for (const s of ppl) { s.health = 100; s.alive = true; } }
  const per = cases / (ppl.length * 300) * 300;
  check(per > 0.4 && per < 2, `on clean ground, drinking nothing but un-purified water: ${cases} cases in ${ppl.length} people × 300 days = ${per.toFixed(2)} per 10 people per 30 days`);
  // The guests' and prisoners' course: they rise at your base.
  const g = wormWorld(0.05);
  g.h.autoTreat = false;
  const fg = g.st.factions.find((x) => x.alive && x.bases.length);
  const [pr] = takePrisonersAt(g.st, fg, g.h, 1);
  pr.s.health = 100;
  pr.s.worm = course(0);
  addBuilding(g.h, "cells");
  const gv = { id: 91003, kind: "explorers", name: "the sick travellers", phase: "sheltered", shelterBase: g.h.id, size: 2, stock: {}, wares: [], worm: [{ day: 0, since: -9 }] };
  (g.st.visitors = g.st.visitors || []).push(gv);
  for (const o of atBase(g.st, g.h.id)) o.health = 100;
  for (let d = 0; d < WORM.COURSE + 1; d++) withNums(WORM, { TURN_KILL: 0 }, () => wormDaily(g.st));
  check(!(g.st.prisoners || []).includes(pr) && g.st.log.some((l) => /a prisoner died of the worm in the cells/.test(l.text)), "a prisoner idle in a cell dies of it and rises locked away (dropped from the cells, nobody hurt)");
  check(gv.size === 1 && !gv.worm.length && g.st.log.some((l) => /One of the guests .* died of the worm at/.test(l.text)), "a sick guest dies of it on day 7 and rises among your people; the group is one fewer");
}
{
  console.log("An upset stomach (not the worm)");
  const w = wormWorld(WORM.CLEAN - 0.05);
  w.h.autoTreat = false;
  const ppl = residents(w.st, w.h.id);
  for (const s of ppl) { s.conditions = []; s.health = 100; s.mood = 60; }
  check(near(WORM.SICK_X * waterRisk(0, 1), WORM.SICK_X * WORM.RAW_BASE) && WORM.SICK_X > 1, `un-purified water turns the stomach ${WORM.SICK_X}× as often as it gives the worm (${(WORM.SICK_X * WORM.RAW_BASE * 100).toFixed(1)}% a day on clean ground, more on infected)`);
  withNums(WORM, { RAW_BASE: 1 / WORM.SICK_X, WATER: 0, SICK_MAX: 1 }, () => { drinkDay(w.st, w.h); wormDaily(w.st); });
  const sick = ppl.filter((s) => conditionsOf(s).some((c) => c.key === "stomach"));
  check(sick.length === ppl.length, "drinking un-purified water: an upset stomach (pinned)");
  const s = sick[0];
  s.worm = null;
  const c = conditionsOf(s).find((k) => k.key === "stomach");
  check(CONDITIONS.stomach.name === "Upset stomach" && CONDITIONS.stomach.icon !== CONDITIONS.dysentery.icon && !wormSeen(s) && wormLabel(s) === "" && !hasWorm(s), `its own name and icon (${CONDITIONS.stomach.icon} ${CONDITIONS.stomach.name}); it never shows as the worm`);
  for (const o of ppl) if (o !== s) { o.conditions = []; o.worm = null; }
  for (const o of ppl) o.worm = null;
  const hp0 = s.health, m0 = s.mood;
  let days = 0;
  for (let d = 1; d <= 10 && conditionsOf(s).some((k) => k.key === "stomach"); d++) { healthDaily(w.st); days = d; }
  check(s.health === hp0 && s.mood < m0 && !conditionsOf(s).some((k) => k.key === "stomach") && days <= 6, `no health lost, only mood (${(m0 - s.mood).toFixed(1)} in ${days} days), and it passes by itself`);
  // Meds shorten it.
  const lasts = (treat) => {
    const v = wormWorld(WORM.CLEAN - 0.05, seed + 9);
    v.h.autoTreat = false;
    const t = residents(v.st, v.h.id)[0];
    for (const o of residents(v.st, v.h.id)) { o.conditions = []; o.role = "rest"; }
    residents(v.st, v.h.id)[1].role = "medic";
    addCondition(v.st, t, "stomach", "test", { sev: 40 });
    if (treat) treatCondition(v.st, v.h, t.id, "stomach");
    let n = 0;
    while (conditionsOf(t).some((k) => k.key === "stomach") && n < 15) { healthDaily(v.st); n++; }
    return n;
  };
  const untreated = lasts(false), treated = lasts(true);
  check(treated < untreated, `meds shorten it (${untreated} days untreated, ${treated} with a dose)`);
  check(!autoWantsCondition({ key: "stomach", sev: 40, course: null, dosed: 0, mending: false }), "automatic care leaves it alone (it passes; meds by hand)");
  // Uncooked food too.
  const fw = wormWorld(0.8);
  const fp = residents(fw.st, fw.h.id);
  for (const o of fp) o.conditions = [];
  withNums(WORM, { RAW: 1e-7, SICK_X: 1e8, SICK_MAX: 1 }, () => eatRaw(fw.st, fp, fp.length * 2, "eating game that was not cooked through"));
  check(fp.every((o) => conditionsOf(o).some((k) => k.key === "stomach")) && fp.every((o) => !o.worm), "uncooked food turns the stomach too (pinned), without the worm");
}

// ---------- 6b. hands that handled the dead ----------
{
  console.log("Searching infected sites");
  const { st, h } = wormWorld(WORM.CLEAN); // the hub's ground: clean enough (eggs 0), so its water is safe
  const site = st.grid.within(h.tile, 4).find((id) => st.grid.distance(id, h.tile) === 3 && st.tiles[id].terrain !== "water");
  const low = st.grid.within(h.tile, 6).find((id) => st.grid.distance(id, h.tile) === 5 && st.tiles[id].terrain !== "water");
  st.tiles[site].infection = 1;
  st.tiles[low].infection = WORM.CLEAN - 0.01;
  const { p, members } = team(st, h, site, 3);
  check(near(searchChance(st, site), WORM.SEARCH) && near(eggsAt(st, site), 1), `an hour's search on fully infected ground: ${WORM.SEARCH * 100}% a searcher (× the eggs)`);
  st.tiles[site].infection = 0.55;
  check(near(searchChance(st, site), WORM.SEARCH * eggsAt(st, site)) && eggsAt(st, site) < 1, `scaled by the tile's eggs (${(searchChance(st, site) * 100).toFixed(2)}% at 55% infection)`);
  st.tiles[site].infection = 1;
  wormSearch(st, p, low, 24);
  check(!p.wormHands && searchChance(st, low) === 0 && searchRiskText(st, low) === "", `below ${WORM.CLEAN * 100}% infection nothing: no exposure, no warning`);
  wormSearch(st, p, site, 6);
  check(p.wormHands && near(p.wormHands.chance, 1 - Math.pow(1 - WORM.SEARCH, 6)) && p.wormHands.day === day(st), `6 hours of searching go on the team's hands for the day (${(p.wormHands.chance * 100).toFixed(2)}% each)`);
  check(/the worm, [\d.]+% a day a person searching/.test(searchRiskText(st, site)), `the planner's warning for a badly infected site: "${searchRiskText(st, site)}"`);
  // The roll when the day turns: unwashed, everyone with the pinned chance catches it.
  p.wormHands = null;
  withNums(WORM, { SEARCH: 1 }, () => wormSearch(st, p, site, 1));
  p.wormHands.day -= 1;
  p.phase = "waiting"; p.task = null;
  wormTeamHour(st, p, members);
  check(caught(members) === members.length && !p.wormHands, "rolled when the day turns: not washed, everyone caught it (pinned)");
  clearAll(members);
  // Camped with the fire lit that night: washed, SEARCH_WASH of the time.
  withNums(WORM, { SEARCH: 1 }, () => wormSearch(st, p, site, 1));
  p.wormHands.day -= 1;
  p.phase = "task"; p.task = { type: "camp" }; p.campFire = true;
  st.tiles[site].infection = 0.3; // under the camping threshold: only the hands are under test
  withNums(WORM, { SEARCH_WASH: 1 }, () => wormTeamHour(st, p, members));
  check(caught(members) === 0 && !p.wormHands, "camped with the fire lit that night: washed, nobody caught it (SEARCH_WASH pinned to 1)");
  h.stock.water = 300; h.stock.rawwater = 0; // the hub drinks purified water: safe
  st.tiles[site].infection = 1;
  withNums(WORM, { SEARCH: 1 }, () => wormSearch(st, p, site, 1));
  p.wormHands.day -= 1;
  st.tiles[site].infection = 0.3;
  withNums(WORM, { SEARCH_WASH: 0 }, () => wormTeamHour(st, p, members));
  check(caught(members) === members.length, "with no wash (SEARCH_WASH 0) the fire does not help");
  clearAll(members);
  st.tiles[site].infection = 1;
  // Home the same day: washed when the base's water is safe.
  withNums(WORM, { SEARCH: 1 }, () => wormSearch(st, p, site, 1));
  check(baseWater(st, h).safe, "the hub's water is safe (purified water in store)");
  withNums(WORM, { SEARCH_WASH: 1 }, () => wormHome(st, p, members, h));
  check(caught(members) === 0 && !p.wormHands, "home to a base with safe water the same day: washed");
  for (const id of [h.tile, ...st.grid.neighbors(h.tile)]) st.tiles[id].infection = 0.8;
  h.stock.water = 0; h.stock.rawwater = 300;
  withNums(WORM, { SEARCH: 1 }, () => wormSearch(st, p, site, 1));
  withNums(WORM, { SEARCH_WASH: 1 }, () => wormHome(st, p, members, h));
  check(caught(members) === members.length && members.every((s) => s.worm.how === "search"), "home to a base whose water is unsafe: not washed, the roll stands (the record says searching)");
  check(/hands that handled the dead/.test(withNums(WORM, { SEARCH: 1 }, () => { wormSearch(st, p, site, 1); return teamWormText(st, p); })), "the team panel shows the day's exposure");
}

// ---------- 6c. crops and forage ----------
{
  console.log("Crops and forage");
  const { st, h } = wormWorld(0.8);
  const clean = st.grid.within(h.tile, 8).find((id) => st.tiles[id].terrain !== "water" && (st.tiles[id].infection || 0) < WORM.CROP_MIN);
  check(cropLandBad(st, h.tile) && !cropLandBad(st, clean), `land at ${WORM.CROP_MIN * 100}%+ infection grows food with eggs; cleaner land does not`);
  Object.assign(h.stock, { food: 0, preserved: 0 });
  h.meat = 0; h.wormMeat = 0; h.wormCrop = 0; h.wormForage = 0;
  h.buildings = h.buildings.filter((b) => b.type !== "cookhouse" && b.type !== "kitchen");
  const people = residents(st, h.id);
  people[0].role = "farm";
  const f = farmOf(st, h);
  const plot = f.plots[0];
  Object.assign(plot, { stage: "ripe", crop: "potato", yieldLeft: 10, ripeDays: 1 });
  harvestPlot(st, h, plot.id);
  check(near(h.stock.food, 10) && near(wormVegAt(h).crop, 10), "a harvest of fresh crops on infected ground carries the eggs (10 of 10)");
  Object.assign(plot, { stage: "ripe", crop: "wheat", yieldLeft: 8, ripeDays: 1 });
  harvestPlot(st, h, plot.id);
  check(near(h.stock.preserved, 8) && near(wormVegAt(h).crop, 10), "dry grain into the preserved stock is threshed and cooked: safe");
  addWormCrop(st, h, clean, 5, "crop");
  check(near(wormVegAt(h).crop, 10), "nothing from clean land");
  // Foraging around the base on infected land.
  const food0 = h.stock.food;
  for (const id of st.grid.within(h.tile, 2)) st.tiles[id].infection = 0.8; // the foragers' land too
  people[1].role = "forage";
  st.hour = 24 * 50 + 12; // summer: there is something to gather
  const got = foragingDaily(st, h);
  check(got && got.rations > 0 && near(wormVegAt(h).forage, got.rations, 0.01) && near(h.stock.food - food0, got.rations, 0.01), `forage gathered on infected ground carries eggs too (${got && got.rations.toFixed(1)} rations)`);
  // Eaten last, after the clean food and the preserved, the crops then the forage, the raw meat last of all.
  const fr = wormVegAt(h).forage;
  h.stock.food += 20; // 20 clean on top
  h.stock.preserved = 0;
  h.meat = 4; h.wormMeat = 4; h.stock.food += 4;
  eatFromStore(h, 18);
  check(near(wormVegAt(h).crop, 10) && near(wormVegAt(h).forage, fr, 0.01) && !(h.rawCropEaten > 0), "the clean food goes first");
  eatFromStore(h, 2 + 6);
  check(near(h.rawCropEaten, 6) && near(wormVegAt(h).crop, 4) && near(wormVegAt(h).forage, fr, 0.01) && !(h.rawEaten > 0), `then the crops with eggs, raw (${h.rawCropEaten} rations), before the forage and the meat`);
  eatFromStore(h, 4 + fr + 1);
  check(near(h.rawCropEaten, 10) && near(h.rawForageEaten, fr, 0.01) && near(h.rawEaten, 1) && near(wormMeatAt(h), 3), "then the forage, and the raw meat last of all");
  let n = withNums(WORM, { CROP: 1, FORAGE: 1, RAW: 0, WATER: 0 }, () => { wormDaily(st); return caught(people); });
  check(n === people.length && people.every((s) => s.worm.how === "crop" || s.worm.how === "forage") && h.rawCropEaten === 0, "eating them raw catches the worm (CROP and FORAGE pinned to 1)");
  clearAll(people);
  // A cook fire (or a kitchen) boils them.
  h.wormCrop = 6; h.wormForage = 3; h.stock.food = 20; h.wormMeat = 0; h.meat = 0;
  addBuilding(h, "cookhouse");
  check(near(cookAtBase(st, h), 9) && wormVegAt(h).all === 0, "a cook fire boils the crops and the forage (the eggs die)");
  h.buildings = h.buildings.filter((b) => b.type !== "cookhouse");
  h.wormCrop = 6; h.wormForage = 3; h.wormMeat = 2; h.meat = 2;
  smokeWormMeat(h, 5);
  check(wormMeatAt(h) === 0 && near(wormVegAt(h).crop, 3) && near(wormVegAt(h).forage, 3), "the drying racks take the meat with eggs first, then the crops");
  // A team: forage gathered on infected ground rides in the cargo, is left for last, and a camp fire boils it.
  const { p, members } = team(st, h, h.tile, 2);
  p.cargo = { supplies: { food: 10 }, gear: [] };
  p.supplies = { food: 0, water: 20, meds: 0, preserved: 0 };
  addWormForage(st, p, h.tile, 4);
  p.cargo.supplies.food += 4;
  check(near(wormForageIn(p.cargo), 4), "forage from infected ground in the team's cargo (4 of 14)");
  const ate = takeFood(p, 12);
  check(near(ate, 10) && near(wormForageIn(p.cargo), 4), "the team eats the clean food first (10 of 12 wanted)");
  const raw = withNums(WORM, { FORAGE: 1 }, () => eatRawForageCargo(st, p, members, 2));
  check(near(raw, 2) && caught(members) === members.length && near(wormForageIn(p.cargo), 2), "then the forage raw, and catches it (pinned)");
  clearAll(members);
  p.phase = "task"; p.task = { type: "camp" }; p.campFire = true;
  st.tiles[h.tile].infection = 0.2;
  wormTeamHour(st, p, members);
  check(wormForageIn(p.cargo) === 0, "a camp fire boils it");
  st.tiles[h.tile].infection = 0.8;
  addWormForage(st, p, h.tile, 3);
  p.cargo.supplies.food = 5;
  check(/forage/.test(teamWormText(st, p)), "the team panel says so");
  h.stock.food = 50; h.wormCrop = 0; h.wormForage = 2; h.wormMeat = 0;
  unloadWormForage(h, p.cargo);
  check(near(wormVegAt(h).forage, 5) && !(p.cargo.wormForage > 0), "unloaded at a base it is the base's forage with eggs (2 + 3)");
}

// ---------- 6d. the other groups ----------
{
  console.log("The other groups");
  const { st, h } = wormWorld(0.05);
  const G = WORM.GROUPS;
  const f = st.factions.find((x) => x.alive);
  const tile = f.bases[0];
  for (const id of [tile, ...st.grid.neighbors(st.bases[0].tile)]) if (st.tiles[id]) st.tiles[id].infection = st.tiles[id].infection || 0;
  st.tiles[tile].infection = 1;
  for (const id of st.grid.neighbors(tile)) st.tiles[id].infection = 1;
  f.pop = 20; f.bases = [tile]; f.wormBoilers = null; f.wormLost = 0; f.type = "raider";
  const base = 20 * 1 * (WORM.WATER + WORM.CROP) * G.UNCURED;
  let r = groupWormRisk(st, f, tile);
  check(near(r.expect, base) && !r.boils, `a raider hub of 20 on fully infected ground: ${(r.expect * 100).toFixed(1)}% a day of losing one (20 × eggs × (water ${WORM.WATER} + crops ${WORM.CROP}) × ${G.UNCURED} uncured)`);
  f.type = "military"; r = groupWormRisk(st, f, tile);
  check(near(r.expect, base * G.TYPE.military), `the military boils its water: ×${G.TYPE.military}`);
  f.type = "fortress"; check(near(groupWormRisk(st, f, tile).expect, base * G.TYPE.fortress), `a fortress hub too: ×${G.TYPE.fortress}`);
  f.type = "traders"; check(near(groupWormRisk(st, f, tile).expect, base * G.TYPE.traders), `traders mostly: ×${G.TYPE.traders}`);
  f.type = "commune"; check(near(groupWormRisk(st, f, tile).expect, base * G.TYPE.commune), `a commune farms the infected land: ×${G.TYPE.commune}`);
  f.type = "zealot"; check(near(groupWormRisk(st, f, tile).expect, base * G.TYPE.zealot), `zealots take it as it comes: ×${G.TYPE.zealot}`);
  f.type = "commune"; f.wormBoilers = { [tile]: true };
  check(near(groupWormRisk(st, f, tile).expect, base * G.BOILER) && groupWormRisk(st, f, tile).boils, `a base that boils its water: ×${G.BOILER} (a commune's 1.2 goes down to it)`);
  f.wormBoilers = null;
  st.tiles[tile].infection = WORM.CROP_MIN - 0.05;
  for (const id of st.grid.neighbors(tile)) st.tiles[id].infection = WORM.CROP_MIN - 0.05;
  check(near(groupWormRisk(st, f, tile).expect, 20 * eggsAt(st, tile) * WORM.WATER * G.UNCURED * G.TYPE.commune), `under ${WORM.CROP_MIN * 100}% infection only the water counts`);
  st.tiles[tile].infection = 1;
  for (const id of st.grid.neighbors(tile)) st.tiles[id].infection = 1;
  // The loss, the boiler flag, the news and the chronicle.
  const d = ensureDiplo(st);
  const news0 = d.news.length;
  st.chronicle = { notes: [], events: [], said: new Map() };
  f.type = "raider";
  withNums(G, { UNCURED: 100 }, () => groupsDaily(st));
  check(f.pop < 20 && f.wormLost === 20 - f.pop && f.wormBoilers && f.wormBoilers[tile], `the base loses people (${20 - f.pop} today, UNCURED pinned high) and boils its water from then on`);
  const mine = () => d.news.filter((x) => x.text.startsWith(f.name));
  check(d.news.length > news0 && mine().length && /lost .* to the worm .*boil their water now/.test(mine()[0].text), `radio news: "${mine()[0] && mine()[0].text}"`);
  check(st.chronicle.notes.some((x) => /to the worm/.test(x.text)), "and a chronicle note");
  f.pop = 20;
  const pop1 = f.pop;
  withNums(G, { UNCURED: 100 }, () => groupsDaily(st));
  check(f.pop < pop1 && !/boil their water now/.test(mine()[0].text), "later losses say nothing more about the boiler");
  f.pop = G.MIN + 2;
  withNums(G, { UNCURED: 1000 }, () => { for (let i = 0; i < 10; i++) groupsDaily(st); });
  check(f.pop === G.MIN && f.alive, `never below ${G.MIN} people: the worm thins a group, it does not end one`);
  // Clean ground: nothing.
  const g2 = st.factions.filter((x) => x.alive && x !== f)[0];
  for (const id of [g2.bases[0], ...st.grid.neighbors(g2.bases[0])]) st.tiles[id].infection = 0.05;
  const pop2 = g2.pop;
  withNums(G, { UNCURED: 1000 }, () => groupsDaily(st));
  check(g2.pop === pop2 && groupWormRisk(st, g2, g2.bases[0]).expect === 0, "a group on clean ground loses nobody");
  // Their parties on the move: a herd's land costs one now and then.
  f.pop = 15;
  const road = st.grid.within(h.tile, 6).find((id) => st.grid.distance(id, h.tile) === 5 && st.tiles[id].terrain !== "water");
  st.herds = [{ tile: road, size: 5, kind: "deer", born: 1, until: 9999 }];
  const party = { id: 88888, owner: f.id, kind: "convoy", path: [road], idx: 0, progress: 0, phase: "out", strength: 5 };
  st.parties.push(party);
  st.tiles[tile].infection = 0.05;
  for (const id of st.grid.neighbors(tile)) st.tiles[id].infection = 0.05;
  withNums(G, { ROAD: 1, HERD_EGGS: 1 }, () => groupsDaily(st));
  check(f.pop === 14 && party.strength === 4 && st.wormStats.road >= 1, "a party of theirs on a herd's land loses one (ROAD and the herd's eggs pinned to 1): the group is one fewer, the party weaker");
  st.parties.splice(st.parties.indexOf(party), 1);
  st.herds = [];
}

// ---------- 7. the old dice and the autopilot ----------
{
  console.log("Cards and the autopilot");
  check(!/id: "worm"/.test(readFileSync(new URL("../src/sim/events.js", import.meta.url), "utf8")), "the travel card is no longer a roll of the dice on infected ground (events.js)");
  const { st, h } = wormWorld(0.7);
  for (const s of atBase(st, h.id)) if (s.gear.tool && s.gear.tool.key === "waterfilter") s.gear.tool = null;
  h.stock.scrap = 200; h.stock.wood = 300; // a woodpile to feed it
  setAutopilot(st, true, "balanced");
  for (let i = 0; i < 24 * 6 && !count(h, "boiler"); i++) tickHour(st);
  check(count(h, "boiler") > 0 || h.construction.some((c) => c.type === "boiler"), "the autopilot builds a water boiler at a base whose water carries the eggs (with firewood to feed it)");
  // Wood-poor land and an empty pile: filters instead (the boiler would burn the winter's heating for nothing).
  const w2 = wormWorld(0.7, seed + 3);
  for (const s of atBase(w2.st, w2.h.id)) if (s.gear.tool && s.gear.tool.key === "waterfilter") s.gear.tool = null;
  w2.h.stock.scrap = 200; w2.h.stock.wood = 0;
  w2.st.wood = {};
  for (const id of w2.st.grid.within(w2.h.tile, 2)) w2.st.wood[id] = [0, w2.st.hour]; // the land around is cut bare
  setAutopilot(w2.st, true, "balanced");
  const filtersAt = () => [...w2.h.armory, ...atBase(w2.st, w2.h.id).map((x) => x.gear.tool)].filter((it) => it && it.key === "waterfilter").length + (w2.h.crafting || []).filter((j) => j.recipe === "waterfilter").length;
  for (let i = 0; i < 24 * 6 && !filtersAt(); i++) tickHour(w2.st);
  check(filtersAt() > 0 && !count(w2.h, "boiler") && !w2.h.construction.some((c) => c.type === "boiler"), "on land that gives too little firewood for one, it makes water filters instead and leaves the boiler");
}

// ---------- 8. save and load ----------
{
  console.log("Save and load");
  const { st, h } = wormWorld(0.8);
  const s = atBase(st, h.id)[0];
  s.worm = { stage: "gut", day: 4, len: 20, since: 2, why: "drinking unboiled water at the test", how: "water", seen: 3, treatedDay: -99, carded: "gut" };
  h.meat = 10; h.wormMeat = 6; h.stock.food = 40;
  st.herds = [{ tile: h.tile + 3, size: 5, kind: "hog", born: 1, until: 80 }];
  const { p } = team(st, h, h.tile, 2);
  p.supplies.rawwater = 7; p.wormEggs = 0.4; p.cargo.meat = 3; p.cargo.wormMeat = 2; p.cargo.supplies.food = 3;
  st.wormStats = { caught: 3, water: 2, meat: 1, camp: 0, search: 1, crop: 0, forage: 0, spotted: 1, cured: 0, turned: 0, killed: 0, herds: 1, herdKills: 0, groups: 2, road: 0 };
  h.wormCrop = 5; h.wormForage = 2.5; h.boiling = false; h.boilerBurn = { wood: 1.2, fuel: 0 };
  p.cargo.wormForage = 1.5; p.cargo.supplies.food += 2; p.wormHands = { day: day(st), chance: 0.02, where: "the test site" };
  const f = st.factions.find((x) => x.alive);
  f.wormBoilers = { [f.bases[0]]: true }; f.wormLost = 3;
  const w = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  const s2 = w.survivors.find((x) => x.id === s.id), h2 = w.bases.find((b) => b.id === h.id), p2 = w.parties.find((x) => x.id === p.id), f2 = w.factions.find((x) => x.id === f.id);
  check(JSON.stringify(s2.worm) === JSON.stringify(s.worm), "a carrier's worm (stage, days, seen) comes back");
  // Mid-course on the new count: it comes back and goes on from there.
  const m = atBase(st, h.id)[1];
  m.worm = { v: 2, stage: "gut", day: 3, len: WORM.COURSE, since: 2, why: "test", how: "water", seen: 3, treatedDay: -99, carded: "", paid: 1.5 };
  // Old saves (v 1: eggs, weeks in the gut, days in the brain) move onto the new count in proportion.
  const o1 = atBase(st, h.id)[2], o2 = atBase(st, h.id)[3], o3 = atBase(st, h.id)[4] || atBase(st, h.id)[3];
  o1.worm = { stage: "gut", day: 10, len: 20, since: 1, why: "old", how: "water", seen: 2, treatedDay: -99, carded: "" };
  o2.worm = { stage: "brain", day: 1, len: 4, since: 1, why: "old", how: "water", seen: 2, treatedDay: -99, carded: "brain" };
  if (o3 !== o2) o3.worm = { stage: "eggs", day: 3, len: 8, since: 1, why: "old", how: "water", seen: null, treatedDay: -99, carded: "" };
  const w2 = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  const m2 = w2.survivors.find((x) => x.id === m.id);
  check(JSON.stringify(m2.worm) === JSON.stringify(m.worm), "saved mid-infection (day 3, the battle's damage paid) it comes back as it was");
  const g = (o) => wormOf(w2.survivors.find((x) => x.id === o.id));
  check(g(o1).v === 2 && g(o1).stage === "gut" && g(o1).day === 1 + Math.floor(0.5 * (WORM.BRAIN_FROM - 1)), `an old save's gut stage halfway through → the gut, day ${g(o1).day}`);
  check(g(o2).stage === "brain" && g(o2).day === WORM.BRAIN_FROM, `an old save's brain stage → the brain, day ${g(o2).day}`);
  if (o3 !== o2) check(g(o3).stage === "gut" && g(o3).day === 0, "an old save's eggs → day 0 (it shows tomorrow)");
  check(h2.wormMeat === 6 && JSON.stringify(w.herds) === JSON.stringify(st.herds) && JSON.stringify(w.wormStats) === JSON.stringify(st.wormStats), "the base's meat with eggs, the herds and the stats come back");
  check(p2.supplies.rawwater === 7 && p2.wormEggs === 0.4 && wormMeatIn(p2.cargo) === 2, "a team's un-purified water (its eggs) and meat with eggs come back");
  check(h2.wormCrop === 5 && h2.wormForage === 2.5 && h2.boiling === false && h2.boilerBurn && h2.boilerBurn.wood === 1.2, "the base's crops and forage with eggs and the cold boiler come back");
  check(near(wormForageIn(p2.cargo), 1.5) && p2.wormHands && p2.wormHands.chance === 0.02, "a team's forage with eggs and the day's hands come back");
  check(f2.wormLost === 3 && f2.wormBoilers && f2.wormBoilers[f.bases[0]] === true, "a group's losses and its boilers come back");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
if (fail) process.exitCode = 1;
