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
} from "../src/sim/worm.js";

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
  const scrap0 = h.stock.scrap;
  n = withNums(WORM, { WATER: 1 }, () => { wormDaily(st); return caught(people); });
  check(n === 0 && baseWater(st, h).safe && near(scrap0 - h.stock.scrap, WORM.BOILER_SCRAP), `a water boiler makes it safe (nobody caught it; it burned ${scrap0 - h.stock.scrap} scrap from the stores)`);
  // With an upkeep set (WORM.BOILER_SCRAP / BOILER_FUEL, 0 by default): it burns that, and goes cold without it.
  withNums(WORM, { BOILER_SCRAP: 1, BOILER_FUEL: 1 }, () => {
    const s0 = h.stock.scrap;
    wormDaily(st);
    check(baseWater(st, h).safe && near(s0 - h.stock.scrap, 1), "with an upkeep set it burns it from the stores");
    h.stock.scrap = 0; h.stock.fuel = 0;
    wormDaily(st);
    check(!baseWater(st, h).safe && h.boiling === false, "and with nothing to burn it goes cold and the water is unsafe again");
  });
  wormDaily(st);
  check(baseWater(st, h).safe, "with no upkeep it burns again (gathered junk wood)");
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

// ---------- 7. the old dice and the autopilot ----------
{
  console.log("Cards and the autopilot");
  check(!/id: "worm"/.test(readFileSync(new URL("../src/sim/events.js", import.meta.url), "utf8")), "the travel card is no longer a roll of the dice on infected ground (events.js)");
  const { st, h } = wormWorld(0.7);
  for (const s of atBase(st, h.id)) if (s.gear.tool && s.gear.tool.key === "waterfilter") s.gear.tool = null;
  h.stock.scrap = 200;
  setAutopilot(st, true, "balanced");
  for (let i = 0; i < 24 * 6 && !count(h, "boiler"); i++) tickHour(st);
  check(count(h, "boiler") > 0 || h.construction.some((c) => c.type === "boiler"), "the autopilot builds a water boiler at a base whose water carries the eggs");
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
  st.wormStats = { caught: 3, water: 2, meat: 1, camp: 0, spotted: 1, cured: 0, turned: 0, killed: 0, herds: 1, herdKills: 0 };
  const w = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  const s2 = w.survivors.find((x) => x.id === s.id), h2 = w.bases.find((b) => b.id === h.id), p2 = w.parties.find((x) => x.id === p.id);
  check(JSON.stringify(s2.worm) === JSON.stringify(s.worm), "a carrier's worm (stage, days, seen) comes back");
  check(h2.wormMeat === 6 && JSON.stringify(w.herds) === JSON.stringify(st.herds) && JSON.stringify(w.wormStats) === JSON.stringify(st.wormStats), "the base's meat with eggs, the herds and the stats come back");
  check(p2.wormWater === 7 && p2.wormEggs === 0.4 && wormMeatIn(p2.cargo) === 2, "a team's unboiled water and meat with eggs come back");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
if (fail) process.exitCode = 1;
