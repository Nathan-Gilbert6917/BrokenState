// Weight and load test (src/sim/load.js, vehicles.js, parties.js): item and supply weights, load bands and what
// they do (pace, rations), Scouting easing them, the team at its slowest member's pace, the pool shared out, cars
// taking the whole load off (and burning more fuel the fuller they are, overloaded past 100%), bikes taking part of
// it (racks, one bike each, faster on roads), and that every estimate (ETA, food, water, fuel) matches the trip.
// Then bikes as things: found as cargo, parked at a base, split and merged, left and recovered without fuel, rafted
// across water, saved and loaded; determinism; and the autopilot's packing (no team leaves Overloaded on foot).
// Usage: node tools/loadtest.js [seed] [autopilot days]
import { FOODS } from "../src/sim/foods.js";
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { createWorld, tickHour, hub, atBase, skill, day } from "../src/sim/world.js";
import { GEAR, SUPPLIES } from "../src/sim/data.js";
import {
  launchExpedition, estimateTrip, planPath, hoursLeft, orderMove, partyTile, partyMembers, partyCapacity, carryCapacity,
  poolLoad, partySpeed, STANCES, fuelForPath, startReturn, weighTeam, onTheMove, rationsFor, leaveVehicle, giveOrder,
  waterForHours, waterPerHour, partyPace,
} from "../src/sim/parties.js";
import {
  LOAD_BANDS, MAX_LOAD, BADBACK_MAX, teamLoad, personLoad, wornLoad, maxLoad, bandIndex, shareLoad, poolAtBand, BIKE_EASE,
} from "../src/sim/load.js";
import {
  VEHICLE_TYPES, createVehicle, vehiclesAtBase, bikesAtBase, parkBikes, fuelMultFor, breakdownChance, isBike, RIDER_KG,
} from "../src/sim/vehicles.js";
import { newItem, stripAll, itemLoad } from "../src/sim/inventory.js";
import { estimatePlan } from "../src/sim/plans.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { crossingsFrom, boatPlan } from "../src/sim/crossing.js";
import { seasonOfDay, thirstFactor, thirstAt, THIRST } from "../src/sim/weather.js";

import { NEEDS } from "../src/sim/needs.js";

// Water and food a team used, the gauges counted (needs.js): what it took from its supplies plus the thirst (hunger)
// points its people lost, in rations. People drink when their gauge is low, so the supplies go in gulps.
const gaugeSum = (st, p, key) => partyMembers(st, p).reduce((a, s) => a + (s[key] ?? 100), 0);
const snapNeeds = (st, p) => ({ water: p.supplies.water, food: food(p), thirst: gaugeSum(st, p, "thirst"), hunger: gaugeSum(st, p, "hunger") });
const usedWater = (st, p, s0) => (s0.water - p.supplies.water) + (s0.thirst - gaugeSum(st, p, "thirst")) / NEEDS.water;
const usedFood = (st, p, s0) => (s0.food - food(p)) + (s0.hunger - gaugeSum(st, p, "hunger")) / NEEDS.food;

const SEED = Number(process.argv[2] || 42);
const AP_DAYS = Number(process.argv[3] || 60);
let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else { fail++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(t);
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const r1 = (x) => Math.round(x * 10) / 10;

function world(seed = SEED) {
  const st = createWorld({ seed, factionCount: 6 });
  st.started = true;
  Object.assign(hub(st).stock, { water: 600, fuel: 300, meds: 30, ammo: 400, parts: 20, scrap: 80 }); setFood(hub(st), 600);
  return st;
}
const plain = (s, scouting = 0) => { stripAll(s); s.traits = []; s.perks = []; s.skills.scouting = scouting; return s; };
// Event cards: first enabled choice; orders cards dropped. Flags a card that changed the team's load or delayed it.
function tickOnce(st, p, flags) {
  st.hordes.length = 0;
  if (p) p.lastConflict = st.hour;
  tickHour(st);
  if (p && flags && p.roadblock && p.roadblock.hour === st.hour) flags.event = true; // a road blockage's delay (sim/roadblocks.js)
  for (const c of [...st.cards]) {
    st.cards.splice(st.cards.indexOf(c), 1);
    if (c.isOrders) continue;
    const before = p ? [p.progress, poolLoad(p), p.members.length] : null;
    const ch = c.choices.find((x) => !x.uiAction && !(typeof x.disabled === "function" ? x.disabled(st) : x.disabled));
    if (ch) ch.resolve(st);
    if (p && flags && (p.progress < before[0] - 1e-9 || Math.abs(poolLoad(p) - before[1]) > 1e-9 || p.members.length !== before[2])) flags.event = true;
  }
  if (st.combat) { st.combat = null; if (flags) flags.event = true; }
}
// Runs until the team waits again; returns hours (Infinity if it never does).
function run(st, p, flags = {}, max = 24 * 30) {
  const start = st.hour;
  for (let i = 0; i < max; i++) {
    tickOnce(st, p, flags);
    if (!st.parties.includes(p)) return { hours: Infinity, gone: true };
    if (p.phase === "waiting") return { hours: st.hour - start };
  }
  return { hours: Infinity };
}
const destFrom = (st, from, d0, d1, mode = false, filter = () => true) => st.tiles.find((t) => t.terrain !== "water" && !st.bases.some((b) => b.tile === t.id) && st.grid.distance(from, t.id) >= d0 && st.grid.distance(from, t.id) <= d1 && filter(t) && planPath(st, from, t.id, mode))?.id;

// ---------------------------------------------------------------------------------------------------------
section("Weights");
{
  const missing = Object.entries(GEAR).filter(([, d]) => !(d.weight > 0));
  check(!missing.length, `every item has a weight (missing: ${missing.map(([k]) => k).join(", ")})`);
  check(GEAR.pistol.weight === 1 && GEAR.ar.weight === 4 && GEAR.plate.weight === 1.5 && Math.abs(itemLoad(newItem("plate")) - 6.5) < 1e-9 && GEAR.vest.weight === 4, "pistol 1, assault rifle 4, plate carrier 1.5 (6.5 with its two ceramic plates), vest 4 kg");
  check(SUPPLIES.water.weight === 1 && SUPPLIES.fuel.weight === 1 && SUPPLIES.meds.weight === 0.1 && SUPPLIES.ammo.weight === 0.02, "water 1, fuel 1, meds 0.1, ammo 0.02 kg a unit");
  // Food by type (sim/foods.js): each item its own weight; a day of ration bars weighs a fifth of a day of cans.
  const kgDay = (k) => SUPPLIES[k].weight * 2000 / FOODS[k].kcal;
  check(SUPPLIES.f_rationbar.weight === 0.5 && SUPPLIES.f_beans.weight === 0.45 && kgDay("f_rationbar") < kgDay("f_jerky") && kgDay("f_jerky") < kgDay("f_beans"), `a day of food: ration bars ${kgDay("f_rationbar").toFixed(2)} kg, jerky ${kgDay("f_jerky").toFixed(2)}, canned beans ${kgDay("f_beans").toFixed(2)}`);
  const pack = newItem("assaultpack");
  pack.contents[0] = newItem("ar");
  pack.contents[1] = newItem("pistol");
  check(near(itemLoad(pack), 2 + 4 + 1), `a pack weighs what is in it (${itemLoad(pack)} kg)`);
  check(GEAR.assaultpack.ease > 0 && !GEAR.backpack.ease && GEAR.assaultpack.carry > GEAR.backpack.carry, "the assault pack carries better than the improvised one (more max load, an ease)");
}

section("Bands, one person");
{
  const st = world();
  const s = plain(atBase(st, hub(st).id)[0]);
  check(maxLoad(s) === MAX_LOAD && wornLoad(s) === 0, `max load ${maxLoad(s)} kg, nothing worn`);
  check(bandIndex(18) === 0 && bandIndex(18.01) === 1 && bandIndex(28) === 1 && bandIndex(28.5) === 2 && bandIndex(38) === 2 && bandIndex(39) === 3, "band edges: Light ≤ 18 < Medium ≤ 28 < Heavy ≤ 38 < Overloaded");
  const at = (kg) => personLoad(s, kg);
  check(at(10).speed === 1 && at(10).eat === 1, "Light: full pace, normal rations");
  check(near(at(25).speed, 0.9) && near(at(25).eat, 1.15), "Medium: -10% pace, +15% rations");
  check(near(at(35).speed, 0.75) && near(at(35).eat, 1.35), "Heavy: -25% pace, +35% rations");
  check(near(at(40).speed, 0.55) && near(at(40).eat, 1.6), "Overloaded: -45% pace, +60% rations");
  s.skills.scouting = 10;
  check(near(at(35).speed, 1 - 0.25 * 0.75) && near(at(35).eat, 1 + 0.35 * 0.75), `Scouting 10 takes a quarter off (Heavy pace ${at(35).speed}, rations ${at(35).eat})`);
  s.skills.scouting = 20;
  check(near(at(40).speed, 1 - 0.45 * 0.5) && near(at(40).eat, 1.3), `Scouting 20 takes half off (Overloaded pace ${at(40).speed})`);
  s.skills.scouting = 0;
  s.traits = ["badback"];
  check(maxLoad(s) === BADBACK_MAX && at(16).band === 1 && at(16).felt > 16, `Bad Back: max ${maxLoad(s)} kg and 16 kg feels like ${r1(at(16).felt)} (Medium)`);
  s.traits = [];
  s.gear.backpack = newItem("assaultpack");
  check(maxLoad(s) === MAX_LOAD + 10 && at(20).band === 0 && near(at(20).felt, 20 * 0.88), `an assault pack: +10 kg max and 20 kg feels like ${r1(at(20).felt)} (Light)`);
  s.gear.backpack = null;
  s.perks = ["packrat"];
  check(maxLoad(s) === MAX_LOAD + 8, "Packrat: +8 kg max load");
}

section("A team: shared load, slowest member, capacity");
{
  const st = world();
  const [a, b, c] = atBase(st, hub(st).id).slice(0, 3).map((x) => plain(x));
  b.traits = ["badback"];
  c.gear.backpack = newItem("assaultpack");
  c.gear.armor = newItem("plate");
  const t = teamLoad([a, b, c], 45, null);
  const by = (s) => t.people.find((x) => x.sid === s.id);
  check(near(t.pool, 45) && near(t.people.reduce((x, y) => x + y.load, 0), 45 + wornLoad(c)), "everything shared out (pool + what they wear)");
  check(by(b).load < by(a).load, `the bad back carries less (${r1(by(b).load)} vs ${r1(by(a).load)} kg)`);
  check(near(by(a).felt, by(b).felt, 0.01) && near(by(a).felt, by(c).felt, 0.01), `everyone ends equally burdened (felt ${r1(by(a).felt)} / ${r1(by(b).felt)} / ${r1(by(c).felt)} kg)`);
  check(t.foot.speed === Math.min(...t.people.map((x) => x.speed)), "the team's pace is its slowest member's");
  check(near(carryCapacity(st, [a, b, c], null), maxLoad(a) + maxLoad(b) + maxLoad(c) - wornLoad(c)), `capacity = max loads less what they wear (${carryCapacity(st, [a, b, c], null)} kg)`);
  const top = poolAtBand([a, b, c], 1);
  const tm = teamLoad([a, b, c], top, null);
  check(Math.max(...tm.people.map((x) => x.band)) <= 1 && Math.max(...teamLoad([a, b, c], top + 2, null).people.map((x) => x.band)) === 2, `poolAtBand: ${r1(top)} kg keeps everyone Medium, 2 kg more does not`);
  const sh = shareLoad([{ worn: 0, max: 40, f: 1 }, { worn: 30, max: 40, f: 1 }], 20);
  check(near(sh[0], 20) && near(sh[1], 0), "someone already wearing a lot takes nothing until the others catch up");
}

section("On foot: estimate = trip (hours and rations), Heavy is slower and hungrier");
{
  const st = world(SEED + 1);
  const h = hub(st);
  const crew = atBase(st, h.id).slice(0, 2).map((x) => plain(x));
  const dest = destFrom(st, h.tile, 5, 7);
  const light = { food: 6, water: 6 };
  const heavy = { food: 20, water: 40, scrap: 6 };
  const eL = estimateTrip(st, { memberIds: crew.map((s) => s.id), dest, vehicle: false, stance: "normal", supplies: light });
  const eH = estimateTrip(st, { memberIds: crew.map((s) => s.id), dest, vehicle: false, stance: "normal", supplies: heavy });
  const bandH = Math.max(...eH.load.people.map((x) => x.band));
  check(Math.max(...eL.load.people.map((x) => x.band)) === 0 && bandH >= 2, `test setup: light pack is Light, heavy pack is ${LOAD_BANDS[bandH].name}`);
  check(eH.hoursOut > eL.hoursOut, `a heavy team takes longer (${eL.hoursOut}h → ${eH.hoursOut}h)`);
  check(eH.food > Math.ceil(((eL.hoursOut + eL.hoursBack) * 2 + 12) / 24) || eH.food > eL.food, `and needs more food and water (${eL.food} → ${eH.food})`);
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest, mission: "move", stance: "normal", supplies: heavy });
  check(!res.error, `launch: ${res.error}`);
  const p = res.party;
  check(near(partySpeed(p), eH.pace.speed), `the team's pace is the planner's (${r1(partySpeed(p))})`);
  const w0 = snapNeeds(st, p);
  const flags = {};
  const r = run(st, p, flags);
  if (!flags.event) {
    check(r.hours === eH.hoursOut, `the trip took the estimate (${eH.hoursOut}h → ${r.hours}h)`);
    const want = (eH.pace.eatMove * eH.hoursOut) / 24;
    check(near(usedWater(st, p, w0), want, 1e-6), `water drunk on the way (supplies and thirst) = the estimate's rate (${r1(usedWater(st, p, w0))} vs ${r1(want)})`);
  } else console.log("  (an event changed the trip: exact checks skipped)");
  const w1 = snapNeeds(st, p);
  for (let i = 0; i < 6; i++) tickOnce(st, p, {});
  check(near(usedWater(st, p, w1), (2 * 6) / 24), "resting: normal rations, whatever the load");
  // Eating does not speed it up until it stops; it is weighed again when it waits.
  check(p.burden && p.phase === "waiting", "weighed again while it waits");
  // A newcomer mid-move does not make it faster until it stops.
  const before = partySpeed(p);
  orderMove(st, p, destFrom(st, partyTile(p), 3, 5));
  const sp = partySpeed(p);
  p.supplies.water = Math.max(0, p.supplies.water - 15); // lighter on the move (as if drunk): no change until it stops
  tickOnce(st, p, {});
  check(!onTheMove(p) || partySpeed(p) === sp, `lighter on the move: the pace holds (${r1(sp)} → ${r1(partySpeed(p))}; was ${r1(before)})`);
  p.cargo.supplies.scrap = (p.cargo.supplies.scrap || 0) + 10; // picked up 20 kg on the move: slower at once
  tickOnce(st, p, {});
  check(!onTheMove(p) || partySpeed(p) <= sp, `heavier on the move: slower at once (${r1(sp)} → ${r1(partySpeed(p))})`);
}

section("Cars: no load felt, fuel by how full, overloaded past 100%");
{
  check(fuelMultFor(0.3) === 1 && fuelMultFor(0.6) === 1 && fuelMultFor(1) === 1.3 && fuelMultFor(1.25) === 1.6 && fuelMultFor(2) === 1.6 && fuelMultFor(0.8) === 1.15, "fuel ×1 to 60% full, ×1.3 at 100%, ×1.6 at 125% and no more");
  const st = world(SEED + 2);
  const h = hub(st);
  const truck = vehiclesAtBase(st, h.id).find((v) => v.type === "truck");
  truck.fuel = 30; truck.condition = 100;
  const crew = atBase(st, h.id).slice(0, 3).map((x) => plain(x));
  const ids = crew.map((s) => s.id);
  const t0 = teamLoad(crew, 20, truck);
  check(t0.ride.speed === 1 && Object.values(t0.ride.eat).every((x) => x === 1), "in a car: full pace and normal rations, whatever the load");
  check(near(t0.fill, (20 + 3 * RIDER_KG) / VEHICLE_TYPES.truck.payload), `fill = (pool + riders ${RIDER_KG} kg + what they wear) / payload (${Math.round(t0.fill * 100)}%)`);
  const cap = carryCapacity(st, crew, truck);
  check(near(cap, 1.25 * VEHICLE_TYPES.truck.payload - 3 * RIDER_KG), `the truck takes up to 125% (${cap} kg of pool)`);
  const t1 = teamLoad(crew, cap, truck);
  check(t1.fuelMult === 1.6 && t1.ride.speed === 0.85, `loaded to the top: fuel ×${t1.fuelMult}, 15% slower`);
  check(breakdownChance(truck, 1.1) > breakdownChance(truck, 0.5), "overloaded: breaks down more");
  // The same drive light, full and overloaded: ETA and fuel as estimated (a few worlds, until one has no event).
  for (const [label, kgPool] of [["light", 20], ["full", VEHICLE_TYPES.truck.payload * 0.95 - 3 * RIDER_KG], ["overloaded", VEHICLE_TYPES.truck.payload * 1.15 - 3 * RIDER_KG]]) {
    const sup = { food: 10, water: 15, scrap: Math.max(0, Math.floor((kgPool - 20) / 2)) };
    let done = false;
    for (let attempt = 0; attempt < 10 && !done; attempt++) {
      const s2 = world(SEED + 2 + attempt * 17);
      const h2 = hub(s2);
      const tr = vehiclesAtBase(s2, h2.id).find((v) => v.type === "truck");
      tr.fuel = 30; tr.condition = 100;
      Object.assign(h2.stock, { scrap: 500 });
      const cr = atBase(s2, h2.id).slice(0, 3).map((x) => plain(x));
      const dest = destFrom(s2, h2.tile, 6, 9, true);
      const e = estimateTrip(s2, { memberIds: cr.map((s) => s.id), dest, vehicle: true, v: tr, stance: "normal", supplies: sup, fuel: tr.fuel });
      const res = launchExpedition(s2, { memberIds: cr.map((s) => s.id), dest, mission: "move", stance: "normal", vehicleId: tr.id, supplies: sup });
      if (!check(!res.error, `${label} truck launch: ${res.error}`)) break;
      const p = res.party;
      const f0 = tr.fuel + (p.supplies.fuel || 0);
      const flags = {};
      const r = run(s2, p, flags);
      if (flags.event || !p.vehicle) continue;
      done = true;
      check(r.hours === e.hoursOut, `${label} truck (${Math.round(e.load.fill * 100)}% full, fuel ×${e.fuelMult}): ETA ${e.hoursOut}h, took ${r.hours}h`);
      check(near(f0 - (tr.fuel + (p.supplies.fuel || 0)), e.fuelOut, 1e-6), `${label} truck: fuel used ${r1(f0 - tr.fuel)} = estimate ${r1(e.fuelOut)} (×${e.fuelMult} of ${r1(fuelForPath(s2, e.path))})`);
      check(Object.keys(p.burden.eatRide).every((k) => p.burden.eatRide[k] === 1), `${label} truck: riders eat normal rations`);
      if (label === "overloaded") check(e.fuelMult > 1.3 && p.burden.ride === 0.85, `overloaded: fuel ×${e.fuelMult} and 15% slower`);
      console.log(`  ${label}: ${Math.round(e.load.fill * 100)}% full, fuel ×${e.fuelMult}, ${e.hoursOut}h, ${r1(e.fuelOut)} fuel out`);
    }
    check(done, `${label} truck: a drive with no event to compare (10 worlds tried)`);
  }
}

section("Bikes: one each, racks, part of the load taken away, faster on roads");
{
  const st = world(SEED + 3);
  const h = hub(st);
  const crew = atBase(st, h.id).slice(0, 3).map((x) => plain(x));
  const ids = crew.map((s) => s.id);
  createVehicle(st, "bike", { kind: "base", baseId: h.id }, { count: 2, condition: 90 });
  createVehicle(st, "bike", { kind: "base", baseId: h.id }, { count: 3, condition: 70 });
  const stack = parkBikes(st, h);
  check(stack.count === 5 && vehiclesAtBase(st, h.id).filter(isBike).length === 1 && near(stack.condition, 78), `bikes at a base are one stack (5 bikes, condition ${stack.condition}%)`);
  const sup = { food: 18, water: 36, scrap: 8 };
  const foot = teamLoad(crew, 70, null), bike = teamLoad(crew, 70, { type: "bike", count: 3 });
  check(bike.onRack === 45 && bike.ride.speed > foot.foot.speed, `racks take 45 kg; on bikes the pace is ${r1(bike.ride.speed)} against ${r1(foot.foot.speed)} on foot`);
  const pf = foot.people[0], pb = personLoad(crew[0], pf.load, BIKE_EASE);
  check(pf.band >= 1 && near(1 - pb.speed, (1 - pf.speed) * (1 - BIKE_EASE)), "riding takes 55% of a load's slow-down away");
  check(carryCapacity(st, crew, { type: "bike", count: 3 }) === carryCapacity(st, crew, null) + 45, "bikes add their racks to what the team can carry");
  check(planPath(st, h.tile, destFrom(st, h.tile, 3, 4) ?? h.tile, "bike") != null, "bikes go where walkers go");
  const road = st.tiles.find((t) => t.roadLinks.length && st.grid.distance(t.id, h.tile) >= 5);
  if (road) {
    const pw = planPath(st, h.tile, road.id, false), pbk = planPath(st, h.tile, road.id, "bike");
    check(pbk.cost < pw.cost, `faster than walking on roads (path cost ${r1(pw.cost)} → ${r1(pbk.cost)})`);
  }
  // Not enough bikes for everyone.
  const four = atBase(st, h.id).slice(0, 6);
  const dest = destFrom(st, h.tile, 6, 9, "bike");
  const tooMany = launchExpedition(st, { memberIds: four.map((s) => s.id), dest, mission: "move", stance: "normal", vehicleId: stack.id, supplies: {} });
  check(four.length <= 5 || /Not enough bikes/.test(tooMany.error || ""), `a bike each: ${tooMany.error || "launched"}`);
  // A bike trip: the estimate is the trip, no fuel, the rest of the bikes stay. No road blockages or people met on
  // the road (a delay, or someone joining, would skip the exact checks).
  st.noRoadblocks = true;
  st.noWanderers = true;
  const e = estimateTrip(st, { memberIds: ids, dest, vehicle: "bike", v: { ...stack, count: 3 }, stance: "normal", supplies: sup });
  const res = launchExpedition(st, { memberIds: ids, dest, mission: "move", stance: "normal", vehicleId: stack.id, supplies: sup });
  check(!res.error, `bike launch: ${res.error}`);
  const p = res.party;
  check(p.vehicle === "bike" && bikesAtBase(st, h.id) === 2 && st.vehicles.find((v) => v.id === p.vehicleId).count === 3, "the team takes 3 bikes, 2 stay at the hub");
  const flags = {};
  const r = run(st, p, flags);
  if (!flags.event && p.vehicle === "bike") {
    check(r.hours === e.hoursOut, `bike trip: ETA ${e.hoursOut}h, took ${r.hours}h`);
    check(st.vehicles.find((v) => v.id === p.vehicleId).fuel === 0 && (p.supplies.fuel || 0) === 0, "bikes burn no fuel (and need none)");
  } else console.log("  (an event changed the bike trip: exact checks skipped)");
  // Left behind and picked up again (no fuel needed), then home: the stack merges with the hub's.
  if (p.vehicle === "bike") {
    const v = st.vehicles.find((x) => x.id === p.vehicleId);
    leaveVehicle(st, p, partyTile(p), "test");
    check(!p.vehicle && v.loc.kind === "abandoned", "bikes can be left behind");
    giveOrder(st, p, "getvehicle");
    check(p.vehicle === "bike" && p.vehicleId === v.id, "and picked up again with no fuel");
    // Across water: a boat takes the bikes along cheaply.
    const shore = st.tiles.find((t) => crossingsFrom(st, t.id).length);
    if (shore) {
      const was = p.path; p.path = [shore.id]; p.idx = 0;
      const bp = boatPlan(st, p, shore.id, crossingsFrom(st, shore.id)[0].tile, "raft");
      check(bp.raft && bp.mats.parts === 0 && !/too rough/.test(bp.reason), `bikes ride in the boat (${bp.mats.scrap} scrap, no parts)`);
      p.path = was; p.idx = 0;
    }
    startReturn(st, p);
    run(st, p, {});
    for (let i = 0; i < 24 * 20 && st.parties.includes(p); i++) tickOnce(st, p, {});
    check(!st.parties.includes(p) && bikesAtBase(st, h.id) === 5 && vehiclesAtBase(st, h.id).filter(isBike).length === 1, `home: 5 bikes in one stack again (${bikesAtBase(st, h.id)})`);
  }
  // A bicycle found as cargo joins the bikes at the base.
  h.armory.push(newItem("bicycle"));
  parkBikes(st, h);
  check(bikesAtBase(st, h.id) === 6 && !h.armory.some((it) => it.key === "bicycle"), "a bicycle item in the armory joins the bikes");
  check(breakdownChance(stack) < breakdownChance({ type: "truck", condition: stack.condition }), "bikes break down less than cars");
  // Save and load with bikes out and parked.
  const ids2 = atBase(st, h.id).slice(0, 2).map((s) => s.id);
  const res2 = launchExpedition(st, { memberIds: ids2, dest, mission: "move", stance: "normal", vehicleId: vehiclesAtBase(st, h.id).find(isBike).id, supplies: { food: 4, water: 4 } });
  check(!res2.error, `second bike launch: ${res2.error}`);
  const st2 = loadFromString(saveToString(st));
  const p2 = st2.parties.find((x) => x.id === res2.party.id);
  check(p2 && p2.vehicle === "bike" && p2.burden && st2.vehicles.filter(isBike).reduce((a, v) => a + v.count, 0) === 6, "saved and loaded: the bike team, its weighing and every bike");
  for (let i = 0; i < 30; i++) { tickOnce(st, res2.party, {}); tickOnce(st2, p2, {}); }
  check(partyTile(res2.party) === partyTile(p2) && JSON.stringify(res2.party.burden) === JSON.stringify(p2.burden), "and it plays on the same");
}

section("Plans: the estimate's rations count the load");
{
  const st = world(SEED + 4);
  const h = hub(st);
  const crew = atBase(st, h.id).slice(0, 2).map((x) => plain(x));
  const dest = destFrom(st, h.tile, 4, 6);
  const sup = { food: 20, water: 40 };
  const pe = estimatePlan(st, { memberIds: crew.map((s) => s.id), dest, vehicle: false, stance: "normal", mission: "move", steps: [{ kind: "camp", hours: 24 }, { kind: "home" }], supplies: sup });
  const legs = pe.legs.filter((l) => l.path);
  const move = legs.reduce((a, l) => a + l.hours, 0);
  const want = Math.ceil((pe.pace.eatMove * move + 2 * 24) / 24 - 1e-9);
  check(pe.food === want && pe.food > Math.ceil((2 * pe.total) / 24) - 1, `plan rations: on the move at the load's rate, resting at one a day (${pe.food} food for ${pe.total}h)`);
}

section("Summer and heat: water at the day's thirst, the estimate = the trip");
{
  // A summer stretch of a week with no hot day (and a hot day), on a few seeds until a trip has no road event.
  const summerDays = (st) => {
    let sd = null, hotD = null;
    for (let d = 0; d < 112 * 3 && (sd == null || hotD == null); d++) {
      if (seasonOfDay(d).key !== "summer") continue;
      if (sd == null && seasonOfDay(d + 7).key === "summer" && [0, 1, 2, 3, 4, 5, 6, 7].every((k) => thirstFactor(st, d + k) === THIRST.summer)) sd = d;
      if (hotD == null && thirstFactor(st, d) >= THIRST.heat) hotD = d;
    }
    return { sd, hotD };
  };
  const sup = { food: 10, water: 14 };
  let exact = false, hotD = null;
  for (const sd0 of [SEED + 3, SEED + 4, SEED + 5, SEED + 6, SEED + 7]) {
    const st = world(sd0);
    const h = hub(st);
    const days = summerDays(st);
    hotD = hotD ?? days.hotD;
    if (days.sd == null) continue;
    st.hour = days.sd * 24 + 6;
    const ids = atBase(st, h.id).slice(0, 2).map((x) => plain(x).id);
    const dest = destFrom(st, h.tile, 5, 7);
    const e = estimateTrip(st, { memberIds: ids, dest, vehicle: false, stance: "normal", supplies: sup });
    const eat = rationsFor(e.pace, e.hoursOut + e.hoursBack, 0, 6, 2);
    // The exact figures: on a short trip food and water can round up to the same whole ration.
    check(e.waterExact > eat + 1e-9 && e.water >= e.food && near(e.waterExact, eat * THIRST.summer, 1e-6), `summer: the trip needs ${THIRST.summer}× the rations in water (${e.food} food, ${e.water} water; ${r1(eat * THIRST.summer)})`);
    const res = launchExpedition(st, { memberIds: ids, dest, mission: "move", stance: "normal", supplies: sup });
    check(!res.error, `launch: ${res.error}`);
    const p = res.party;
    const s0 = snapNeeds(st, p);
    const flags = {};
    const r = run(st, p, flags);
    if (flags.event) { console.log("  (an event changed the trip: next seed)"); continue; }
    check(r.hours === e.hoursOut, `the summer trip took the estimate (${e.hoursOut}h → ${r.hours}h)`);
    const dw = usedWater(st, p, s0), df = usedFood(st, p, s0);
    check(near(dw, ((e.pace.eatMove * e.hoursOut) / 24) * THIRST.summer, 1e-6) && near(dw, df * THIRST.summer, 1e-6), `water drunk on the way = the rations × ${THIRST.summer} (${r1(dw)} water for ${r1(df)} food, the gauges counted)`);
    exact = true;
    break;
  }
  check(exact, "a summer trip without road events to compare");
  // On a hot day the team drinks at least 1.6 a head; the estimate counts each hour at its own day's thirst.
  const st2 = world(SEED + 3);
  const h2 = hub(st2);
  hotD = summerDays(st2).hotD;
  st2.hour = (hotD - 1) * 24 + 12; // the trip runs from the day before into the hot day
  const ids2 = atBase(st2, h2.id).slice(0, 2).map((x) => plain(x).id);
  const dest2 = destFrom(st2, h2.tile, 5, 7);
  const e2 = estimateTrip(st2, { memberIds: ids2, dest: dest2, vehicle: false, stance: "normal", supplies: sup });
  const want2 = waterForHours(st2, st2.hour, [[e2.hoursOut, e2.pace.eatFoot], [6, 2], [e2.hoursBack, e2.pace.eatFoot]]);
  check(near(e2.waterExact, want2, 1e-9) && e2.waterExact > rationsFor(e2.pace, e2.hoursOut + e2.hoursBack, 0, 6, 2) * thirstFactor(st2, hotD - 1), `into a heat wave: each hour at its day's thirst (${r1(e2.waterExact)} water, ${e2.food} food)`);
  const res2 = launchExpedition(st2, { memberIds: ids2, dest: dest2, mission: "move", stance: "normal", supplies: { food: 10, water: 20 } });
  const p2 = res2.party;
  let drunk = 0, expect = 0, same = true;
  for (let i = 0; i < 48 && p2.phase !== "waiting"; i++) {
    const before = snapNeeds(st2, p2), want = waterPerHour(st2, p2, partyMembers(st2, p2), st2.hour + 1);
    tickOnce(st2, p2, {});
    const used = usedWater(st2, p2, before); // the gauges counted (needs.js)
    expect += want; drunk += used;
    if (!near(used, want, 1e-9)) same = false;
    if (thirstAt(st2) >= THIRST.heat && onTheMove(p2)) check(near(waterPerHour(st2, p2), (rationsFor(partyPace(st2, p2), 1, 0, 0, 2) * thirstAt(st2)), 1e-9), "a hot hour on the road: the load's rate × the heat's thirst");
  }
  check(same && near(drunk, expect, 1e-6), `every hour drunk at that hour's thirst (${r1(drunk)})`);
}

section("Determinism");
{
  const play = () => {
    const st = world(SEED + 5);
    const h = hub(st);
    createVehicle(st, "bike", { kind: "base", baseId: h.id }, { count: 3, condition: 80 });
    const crew = atBase(st, h.id).slice(0, 3);
    const stack = parkBikes(st, h);
    const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: destFrom(st, h.tile, 6, 9, "bike"), mission: "scavenge", stance: "normal", vehicleId: stack.id, supplies: { food: 12, water: 20, ammo: 30 } });
    for (let i = 0; i < 24 * 5; i++) tickOnce(st, res.party, {});
    const noIds = (b) => (b ? { ...b, ids: undefined, vid: undefined, eatFoot: Object.values(b.eatFoot), eatRide: b.eatRide && Object.values(b.eatRide) } : b);
    return JSON.stringify({ parties: st.parties.filter((p) => p.owner === "player").map((p) => [p.idx, partyTile(p), noIds(p.burden), p.supplies, p.cargo.supplies]), v: st.vehicles.map((v) => [v.type, v.loc.kind, v.count, v.condition, v.fuel]), log: st.log.slice(0, 30).map((l) => l.text) });
  };
  const a = play(), b = play();
  if (!check(a === b, "the same bike trip plays out the same twice")) { let i = 0; while (a[i] === b[i]) i++; console.log("   ", a.slice(Math.max(0, i - 120), i + 80), "\n    vs", b.slice(Math.max(0, i - 120), i + 80)); }
}

section(`Autopilot packing (${AP_DAYS} days, three styles)`);
{
  let launched = 0, overFoot = 0, heavyFoot = 0, bikes = 0, cars = 0, stashed = 0;
  for (const style of ["cautious", "balanced", "aggressive"]) {
    const st = createWorld({ seed: SEED, factionCount: 6 });
    st.started = true;
    setAutopilot(st, true, style);
    const seen = new Set();
    for (let hr = 0; hr < AP_DAYS * 24; hr++) {
      tickHour(st);
      for (const p of st.parties) {
        if (p.owner !== "player" || p.kind === "convoy" || seen.has(p.id)) continue;
        seen.add(p.id);
        launched++;
        if (!p.burden) continue;
        if (p.vehicle === "bike") bikes++;
        else if (p.vehicle === true) cars++;
        else if (p.burden.band >= 3) overFoot++;
        else if (p.burden.band >= 2) heavyFoot++;
      }
      if (st.over || !st.bases.length) break;
    }
    stashed += st.log.filter((l) => /Heavy armor left home/.test(l.text)).length;
  }
  console.log(`  ${launched} teams sent: ${cars} by car, ${bikes} on bikes, ${launched - cars - bikes} on foot (${heavyFoot} Heavy, ${overFoot} Overloaded); heavy armor left home ${stashed} times`);
  check(launched > 3, "the autopilot sends teams");
  check(overFoot <= Math.max(1, Math.floor(launched * 0.05)), `teams on foot leave Overloaded only when they must (${overFoot} of ${launched})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
