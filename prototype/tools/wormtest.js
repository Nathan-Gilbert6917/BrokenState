// The worm (src/sim/worm.js): catching it from unboiled water on infected ground but not from boiled, filtered or rain
// water; raw meat with eggs eaten last and cooked by a cook fire, the racks or a camp fire; infested animals (a quarter of
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
  eatRawForageCargo, unloadWormForage, groupWormRisk, groupsDaily,
} from "../src/sim/worm.js";
import { mouthsAt, HEAT } from "../src/sim/upkeep.js";
import { woodNeed } from "../src/sim/woodcutting.js";
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
  Object.assign(h.stock, { food: 300, water: 300, meds: 40, scrap: 100, preserved: 0 });
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

// ---------- 1. water at a base ----------
{
  console.log("Water at a base");
  const { st, h } = wormWorld(0.8);
  const people = residents(st, h.id);
  const w = baseWater(st, h);
  check(!w.safe && w.eggs > 0.7 && near(w.raw, eggsAt(st, h.tile)), `unboiled ground water on infected land carries eggs (${w.eggs.toFixed(2)}: ${w.why})`);
  let n = withNums(WORM, { WATER: 1 }, () => { wormDaily(st); return caught(people); });
  check(n > people.length * 0.5, `drinking it, ${n} of ${people.length} catch the worm in a day (WATER pinned to 100% at egg level 1)`);
  clearAll(people);
  addBuilding(h, "boiler");
  // The boiler burns like heating: BOILER_WOOD_HEAD firewood a head a day, firewood first, then fuel for the rest.
  const heads = mouthsAt(st, h).heads;
  const need = heads * WORM.BOILER_WOOD_HEAD;
  h.stock.wood = 50; h.stock.fuel = 20;
  n = withNums(WORM, { WATER: 1 }, () => { wormDaily(st); return caught(people); });
  const bu = boilerUse(st, h);
  check(n === 0 && baseWater(st, h).safe && near(50 - h.stock.wood, need, 0.01) && near(h.stock.fuel, 20), `a water boiler makes it safe (nobody caught it): it burned ${heads} × ${WORM.BOILER_WOOD_HEAD} = ${(50 - h.stock.wood).toFixed(1)} firewood from the stores, no fuel`);
  check(bu.active && bu.lit && near(bu.wood, need, 0.01) && near(bu.fuel, need * HEAT.wood, 0.01) && /firewood a day \(or [\d.]+ fuel\)/.test(bu.text) && new RegExp(`boiled in the water boiler \\(${heads} people`).test(baseWater(st, h).why), `the water row says what it burns: "${bu.text}"`);
  h.stock.wood = need / 2; h.stock.fuel = 20;
  wormDaily(st);
  check(baseWater(st, h).safe && near(h.stock.wood, 0, 0.01) && near(20 - h.stock.fuel, (need / 2) * HEAT.wood, 0.01), `short of firewood it burns what there is and fuel for the rest (${(20 - h.stock.fuel).toFixed(2)} fuel: 1 firewood = ${HEAT.wood} fuel)`);
  h.stock.wood = 0; h.stock.fuel = need * HEAT.wood - 0.05;
  const f1 = h.stock.fuel;
  wormDaily(st);
  check(!baseWater(st, h).safe && h.boiling === false && near(h.stock.fuel, f1) && /boiler is cold/.test(baseWater(st, h).why), "a base that cannot pay the whole day leaves it unlit, burns nothing, and the water is unsafe (the row says the boiler is cold)");
  h.stock.wood = 20;
  wormDaily(st);
  check(baseWater(st, h).safe && h.boiling === true, "with firewood again it burns again");
  const wn = woodNeed(st, h);
  check(wn.boiler > 0 && near(wn.boiler, need, 0.05) && wn.need >= Math.ceil(need * WORM.BOILER_DAYS) && wn.soon, `the firewood plan counts it (${wn.boiler} a day, ${WORM.BOILER_DAYS} days of it wanted: ${wn.need} in all) in every season`);
  h.armory.push(newItem("waterfilter"));
  const w1 = h.stock.wood;
  wormDaily(st);
  check(near(h.stock.wood, w1) && !boilerUse(st, h).active && baseWater(st, h).safe, "with a water filter here it stands ready and burns nothing");
  h.armory = h.armory.filter((it) => !(it && it.key === "waterfilter"));
  // An outpost short of it is covered from the hub over its supply line.
  {
    const o = { id: 777, type: "outpost", name: "Boiler Camp", tile: st.grid.neighbors(h.tile)[0], tier: 1, stock: { food: 50, water: 50, wood: 0, fuel: 0 }, armory: [], buildings: [], construction: [], boiling: true, supplyLine: { strength: 1 } };
    st.bases.push(o);
    addBuilding(o, "boiler");
    const mover = people[0];
    mover.location = { kind: "base", baseId: o.id };
    h.stock.wood = 40;
    wormDaily(st);
    check(baseWater(st, o).safe && h.stock.wood < 40 && o.boiling === true, `an outpost with no firewood gets the boiler's from the hub (the hub's pile ${40} → ${h.stock.wood.toFixed(1)})`);
    mover.location = { kind: "base", baseId: h.id };
    st.bases.splice(st.bases.indexOf(o), 1);
  }
  h.buildings = h.buildings.filter((b) => b.type !== "boiler");
  h.armory.push(newItem("waterfilter"));
  clearAll(people);
  n = withNums(WORM, { WATER: 1 }, () => { wormDaily(st); return caught(people); });
  check(n === 0 && baseWater(st, h).safe, "a water filter at the base makes it safe too");
  // Clean ground: nothing.
  const c = wormWorld(WORM.CLEAN - 0.02);
  const cp = residents(c.st, c.h.id);
  n = withNums(WORM, { WATER: 1 }, () => { wormDaily(c.st); return caught(cp); });
  check(n === 0 && baseWater(c.st, c.h).eggs === 0, `below ${WORM.CLEAN * 100}% infection the water is clean (nobody caught it)`);
  // Rain only: a shelter away from water with no well of its own drinks only rain.
  const r = wormWorld(0.8);
  r.h.tier = 0; r.h.fire = false;
  for (const id of r.st.grid.neighbors(r.h.tile)) if (r.st.tiles[id].terrain === "water") r.st.tiles[id].terrain = "plains";
  const rw = baseWater(r.st, r.h);
  check(rw.safe && rw.ground === 0, `a base drawing no ground water (rain only) drinks safe water (${rw.why})`);
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
  check(res.party && near(res.party.wormWater, 8) && res.party.wormEggs > 0.7, `water packed at a base with unsafe water carries its eggs (${res.party && res.party.wormWater} units at ${res.party && res.party.wormEggs})`);
  const { p, members } = team(st, h, h.tile, 2);
  p.wormWater = 20; p.wormEggs = 1;
  withNums(WORM, { WATER: 24 }, () => drinkHour(st, p, members, 1));
  check(caught(members) === members.length, "drinking unboiled water with eggs catches it (pinned)");
  check(p.wormWater < 20 && p.wormWater >= 18.9, `what was drunk leaves the unboiled water (${p.wormWater} left)`);
  clearAll(members);
  members[0].pockets[0] = newItem("waterfilter");
  withNums(WORM, { WATER: 24 }, () => drinkHour(st, p, members, 1));
  check(caught(members) === 0 && p.wormWater === 0, "a water filter carried cleans what is drunk (nobody caught it)");
  addWormWater(st, p, 10, 1);
  check((p.wormWater || 0) === 0, "and what is fetched with a filter carried stays clean");
  members[0].pockets[0] = null;
  addWormWater(st, p, 10, 0);
  check((p.wormWater || 0) === 0, "clean water (eggs 0: bottled, rain, clean land) adds nothing unsafe");
  addWormWater(st, p, 10, 0.5);
  check(near(p.wormWater, 10) && near(p.wormEggs, 0.5), "river water from infected land does");
  // A camp fire boils it.
  p.phase = "task"; p.task = { type: "camp" }; p.campFire = true;
  st.tiles[h.tile].infection = 0.2; // under the camping threshold: only the boiling is under test
  wormTeamHour(st, p, members);
  check(near(p.wormWater, 10 - WORM.BOIL), `a camp fire boils ${WORM.BOIL} water an hour (${p.wormWater} unboiled left)`);
  members[0].pockets[0] = newItem("stove");
  wormTeamHour(st, p, members);
  check(near(p.wormWater, Math.max(0, 10 - WORM.BOIL - WORM.BOIL * WORM.STOVE)), "a smokeless stove boils it faster");
  check(!teamWormText(st, p) || !/water/.test(teamWormText(st, p)), "boiled: the team panel's worm line has no water left in it");
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

// ---------- 6. stages, spotting, cures, turning ----------
{
  console.log("Stages");
  const { st, h } = wormWorld(0.05);
  const s = atBase(st, h.id)[0];
  catchWorm(st, s, "for the test", "water");
  const len = s.worm.len;
  check(s.worm.stage === "eggs" && !wormSeen(s) && len >= WORM.EGGS[0] && len <= WORM.EGGS[1], `hidden first (${len} days of eggs)`);
  {
    const o = atBase(st, h.id)[2];
    check(catchWorm(st, o, "swarm") && hasWorm(o) && o.worm.from === "swarm" && /worm swarm/.test(o.worm.why) && o.worm.stage === "eggs", "catchWorm(state, s, \"swarm\") (a Carrier's worm swarm) starts the same incubation; hasWorm says so");
    o.alive = false;
    check(hasWorm(o), "hasWorm stays true for someone who just died with it (they rise: carriers.js)");
    o.alive = true;
    clearWorm(o);
    check(!hasWorm(o), "clearWorm clears it");
  }
  for (let i = 0; i < len; i++) wormDaily(st);
  check(s.worm.stage === "gut", "then the gut stage");
  check(near(workFactor({ ...s, conditions: [] }), Math.round(WORM.GUT_WORK * workFactor({ ...s, worm: null, conditions: [] }) * 100) / 100, 0.011), `working at ${WORM.GUT_WORK * 100}%`);
  const food0 = h.stock.food, hp0 = s.health;
  withNums(WORM, { SPOT: 0, SPOT_MED: 0 }, () => wormDaily(st));
  check(near(food0 - h.stock.food, WORM.GUT_EAT) && near(hp0 - s.health, WORM.GUT_HP), `eats ${WORM.GUT_EAT} more a day and loses ${WORM.GUT_HP} health (unseen)`);
  s.worm.day = s.worm.len - 1;
  withNums(WORM, { SPOT: 0, SPOT_MED: 0, BRAIN_SPOT: 0 }, () => wormDaily(st));
  check(s.worm.stage === "brain" && !wormSeen(s), "then the brain");

  console.log("Spotting");
  const seenBy = (medic) => {
    const w = wormWorld(0.05, seed + (medic ? 1 : 2));
    for (let i = 0; i < 30; i++) { const n = makeSurvivor(w.st); n.traits = []; n.role = "rest"; n.location = { kind: "base", baseId: w.h.id }; w.st.survivors.push(n); }
    const here = atBase(w.st, w.h.id);
    for (const x of here) { x.skills.medicine = 0; x.role = "rest"; }
    if (medic) { here[0].skills.medicine = 10; here[0].role = "medic"; }
    for (const x of here) if (!(medic && x === here[0])) x.worm = { stage: "gut", day: 0, len: 1000, since: 1, why: "test", how: "water", seen: null, treatedDay: -99, carded: "" };
    w.h.autoTreat = false;
    let days = 0, n = 0;
    for (let d = 1; d <= 20; d++) { wormDaily(w.st); for (const x of here) if (x.worm && x.worm.seen != null && !x.counted) { x.counted = true; days += d; n++; } }
    return { n, of: here.length - (medic ? 1 : 0), avg: n ? days / n : 99 };
  };
  const a = seenBy(true), b = seenBy(false);
  check(a.n >= a.of * 0.95 && a.avg < b.avg - 2, `a medic (Medicine 10) spots it sooner: ${a.n} of ${a.of} within 20 days, on day ${a.avg.toFixed(1)} on average, against ${b.n}/${b.of} (day ${b.avg.toFixed(1)}) with no medic`);
  {
    const w = wormWorld(0.05);
    const { p, members } = team(w.st, w.h, w.h.tile, 2);
    w.st.cards.length = 0;
    const m = members[0];
    m.worm = { stage: "gut", day: 0, len: 1000, since: 1, why: "test", how: "water", seen: null, treatedDay: -99, carded: "" };
    withNums(WORM, { TEAM_SPOT: 1 }, () => { for (let i = 0; i < WORM.TEAM_FROM - 1; i++) wormDaily(w.st); });
    check(!wormSeen(m), `a team does not notice before day ${WORM.TEAM_FROM} of the gut stage`);
    withNums(WORM, { TEAM_SPOT: 1 }, () => wormDaily(w.st));
    const card = w.st.cards.find((c) => c.title === "The worm" && c.partyId === p.id);
    check(wormSeen(m) && card && card.choices.some((c) => /^Purge/.test(c.label)) && card.choices.some((c) => /^End it/.test(c.label)) && card.choices.some((c) => /^Hope/.test(c.label)), "then it does, and the card The worm comes (purge, end it, hope)");
    check(!card.choices.some((c) => /dewormer/.test(c.label)), "no dewormer choice when the team carries none");
    members[1].pockets[1] = newItem("dewormer");
    m.worm.carded = "";
    m.worm.seen = null;
    w.st.cards.length = 0;
    withNums(WORM, { TEAM_SPOT: 1 }, () => wormDaily(w.st));
    const c2 = w.st.cards.find((c) => c.title === "The worm");
    const dw = c2 && c2.choices.find((c) => /dewormer/.test(c.label));
    const txt = dw ? dw.resolve(w.st) : "";
    check(dw && !m.worm && /passes the worm/.test(txt) && !members[1].pockets[1], "with one carried, the dewormer cures it and is used up");
    // The brain stage on the road: a purge is too late.
    m.worm = { stage: "brain", day: 0, len: 1000, since: 1, why: "test", how: "water", seen: 2, treatedDay: -99, carded: "gut" };
    w.st.cards.length = 0;
    wormDaily(w.st);
    const c3 = w.st.cards.find((c) => c.title === "The worm");
    const purge = c3 && c3.choices.find((c) => /^Purge/.test(c.label));
    check(c3 && purge && purge.disabled && /reached the brain/.test(c3.text), "in the brain stage the team's card comes again, the purge disabled");
  }

  console.log("Cures at a base");
  {
    const w = wormWorld(0.05);
    const here = atBase(w.st, w.h.id);
    const x = here[1];
    here[0].role = "medic"; here[0].skills.medicine = 5;
    x.worm = { stage: "gut", day: 3, len: 1000, since: 1, why: "test", how: "water", seen: 1, treatedDay: -99, carded: "" };
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
    x.worm = { stage: "brain", day: 0, len: 1000, since: 1, why: "test", how: "water", seen: 1, treatedDay: -99, carded: "brain" };
    check(!wormTreatInfo(w.st, w.h, x, "purge").ok && /surgery/i.test(wormTreatInfo(w.st, w.h, x, "purge").reason), "in the brain a purge is too late");
    check(!wormTreatInfo(w.st, w.h, x, "surgery").ok && /Clinic/.test(wormTreatInfo(w.st, w.h, x, "surgery").reason), "and surgery needs a staffed Clinic");
    addBuilding(w.h, "clinic");
    here[2].role = "medic"; here[2].skills.medicine = 6;
    const si = wormTreatInfo(w.st, w.h, x, "surgery");
    check(si.ok && si.load === WORM.SURGERY_LOAD, `with one, surgery (${WORM.SURGERY_MEDS} meds, ${Math.round(si.chance * 100)}%)`);
    applyWormTreat(w.st, w.h, x, { ...si, chance: 1 });
    check(!x.worm && x.alive, "surgery that works saves them");
    // The night's care: a dewormer from the armory first.
    const y = here[3];
    y.worm = { stage: "gut", day: 3, len: 1000, since: 1, why: "test", how: "water", seen: 1, treatedDay: -99, carded: "" };
    w.h.armory.push(newItem("dewormer"));
    const m0 = w.h.stock.meds;
    wormDaily(w.st);
    check(!y.worm && !w.h.armory.some((it) => it && it.key === "dewormer") && w.h.stock.meds === m0, "the night's automatic care uses a dewormer from the armory (no meds)");
    y.worm = { stage: "gut", day: 3, len: 1000, since: 1, why: "test", how: "water", seen: 1, treatedDay: -99, carded: "" };
    withNums(WORM, { PURGE: 1, PURGE_MAX: 1 }, () => wormDaily(w.st));
    check(!y.worm && w.h.stock.meds === m0 - WORM.PURGE_MEDS, "with none, a purge with the base's meds");
    y.worm = { stage: "gut", day: 3, len: 1000, since: 1, why: "test", how: "water", seen: null, treatedDay: -99, carded: "" };
    withNums(WORM, { SPOT: 0, SPOT_MED: 0 }, () => wormDaily(w.st));
    check(!!y.worm, "nobody treats what nobody has spotted");
  }

  console.log("Turning");
  {
    const w = wormWorld(0.05);
    const here = atBase(w.st, w.h.id);
    const x = here[0];
    for (const o of here) { o.role = "rest"; o.health = 100; }
    x.worm = { stage: "brain", day: 0, len: 1, since: 1, why: "test", how: "water", seen: null, treatedDay: -99, carded: "brain" };
    const mood0 = here[1].mood;
    withNums(WORM, { TURN_KILL: 0, TURN_SECOND: 1 }, () => wormDaily(w.st));
    const hurtN = here.slice(1).filter((o) => o.health < 100).length;
    check(!x.alive && w.st.log.some((l) => /died of the worm \(turned\)/.test(l.text)), "unseen, they turn at the end of the brain stage");
    check(hurtN === 2 && here[1].mood < mood0, `and go for the nearest people (${hurtN} hurt); everyone's mood drops`);
    const w2 = wormWorld(0.05);
    const h2 = atBase(w2.st, w2.h.id);
    for (const o of h2) o.health = 100;
    h2[0].worm = { stage: "brain", day: 0, len: 1, since: 1, why: "test", how: "water", seen: 1, treatedDay: -99, carded: "brain", locked: true };
    wormDaily(w2.st);
    check(!h2[0].alive && h2.slice(1).every((o) => o.health === 100), "locked away, they turn alone (nobody hurt)");
    // The base card when the brain stage shows.
    const w3 = wormWorld(0.05);
    const h3 = atBase(w3.st, w3.h.id);
    w3.st.cards.length = 0;
    h3[0].worm = { stage: "gut", day: 99, len: 100, since: 1, why: "test", how: "water", seen: 5, treatedDay: -99, carded: "" };
    w3.h.autoTreat = false;
    wormDaily(w3.st); // into the brain
    wormDaily(w3.st); // the first brain day: seen already, so the card comes
    const c = w3.st.cards.find((k) => /^The worm: /.test(k.title));
    check(c && c.choices.some((k) => /^Try surgery/.test(k.label) && k.disabled) && c.choices.some((k) => /^Lock them away/.test(k.label)), "at a base the brain stage brings a card: surgery (disabled with no Clinic), lock them away, end it");
    // On the road.
    const w4 = wormWorld(0.05);
    const { p, members } = team(w4.st, w4.h, w4.st.grid.within(w4.h.tile, 4).find((id) => w4.st.grid.distance(id, w4.h.tile) === 3 && w4.st.tiles[id].terrain !== "water"), 2);
    for (const o of members) o.health = 100;
    members[0].worm = { stage: "brain", day: 0, len: 1, since: 1, why: "test", how: "water", seen: 1, treatedDay: -99, carded: "brain" };
    wormDaily(w4.st);
    check(!members[0].alive && members[1].health < 100 && partyMembers(w4.st, p).length === 1, "on the road they turn in the night and hurt a teammate");
  }
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
  check(baseWater(st, h).safe, "the hub's water is safe (clean ground)");
  withNums(WORM, { SEARCH_WASH: 1 }, () => wormHome(st, p, members, h));
  check(caught(members) === 0 && !p.wormHands, "home to a base with safe water the same day: washed");
  for (const id of [h.tile, ...st.grid.neighbors(h.tile)]) st.tiles[id].infection = 0.8;
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
  p.wormWater = 7; p.wormEggs = 0.4; p.cargo.meat = 3; p.cargo.wormMeat = 2; p.cargo.supplies.food = 3;
  st.wormStats = { caught: 3, water: 2, meat: 1, camp: 0, search: 1, crop: 0, forage: 0, spotted: 1, cured: 0, turned: 0, killed: 0, herds: 1, herdKills: 0, groups: 2, road: 0 };
  h.wormCrop = 5; h.wormForage = 2.5; h.boiling = false; h.boilerBurn = { wood: 1.2, fuel: 0 };
  p.cargo.wormForage = 1.5; p.cargo.supplies.food += 2; p.wormHands = { day: day(st), chance: 0.02, where: "the test site" };
  const f = st.factions.find((x) => x.alive);
  f.wormBoilers = { [f.bases[0]]: true }; f.wormLost = 3;
  const w = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  const s2 = w.survivors.find((x) => x.id === s.id), h2 = w.bases.find((b) => b.id === h.id), p2 = w.parties.find((x) => x.id === p.id), f2 = w.factions.find((x) => x.id === f.id);
  check(JSON.stringify(s2.worm) === JSON.stringify(s.worm), "a carrier's worm (stage, days, seen) comes back");
  check(h2.wormMeat === 6 && JSON.stringify(w.herds) === JSON.stringify(st.herds) && JSON.stringify(w.wormStats) === JSON.stringify(st.wormStats), "the base's meat with eggs, the herds and the stats come back");
  check(p2.wormWater === 7 && p2.wormEggs === 0.4 && wormMeatIn(p2.cargo) === 2, "a team's unboiled water and meat with eggs come back");
  check(h2.wormCrop === 5 && h2.wormForage === 2.5 && h2.boiling === false && h2.boilerBurn && h2.boilerBurn.wood === 1.2, "the base's crops and forage with eggs and the cold boiler come back");
  check(near(wormForageIn(p2.cargo), 1.5) && p2.wormHands && p2.wormHands.chance === 0.02, "a team's forage with eggs and the day's hands come back");
  check(f2.wormLost === 3 && f2.wormBoilers && f2.wormBoilers[f.bases[0]] === true, "a group's losses and its boilers come back");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
if (fail) process.exitCode = 1;
