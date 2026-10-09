// @ts-check
// Vehicles: fuel tanks, condition, breakdowns, abandonment and recovery; bicycles.
//
// Cars (truck, sedan): the people riding feel none of their load (load.js), everything goes in the vehicle.
// payload = kg the car takes, riders included (RIDER_KG each plus what they wear). Fuel per tile (road 0.6,
// off-road 1.5) rises with how full it is: ×1 up to 60%, ×1.3 at 100%, and it can be loaded past its payload up to
// 125% ("overloaded": up to ×1.6 fuel, 15% slower, wears faster and breaks down more). The team's load is weighed
// when it sets off (load.js weighTeam), so the fuel and the speed a trip planner shows are the ones the trip uses.
//
// Bicycles (type "bike"): one record is a stack of bikes (v.count), parked at a base or riding with a team (a team
// needs one bike per person). No fuel. Faster than walking on roads, walking pace off-road (parties.js moveCost),
// mountains pushed at walking pace. Each bike's rack takes up to 15 kg of the team's load and riding takes 55% of
// the load's slow-down and extra rations away (load.js). Found as cargo (data.js GEAR.bicycle) or built in a
// workshop (crafting.js); a bicycle item in a base's armory joins the base's bikes (parkBikes).
import { TERRAIN, SUPPLIES, GEAR } from "./data.js";
import { newId, log, day, atBase, skill, localId } from "./world.js";
import { count, benchTier } from "./buildings.js";
import { hasPerk, gainXp, USE, hash01 } from "./skills.js";
import { newItem } from "./inventory.js";

// The hardcore start's cars (hardcore-start.js ARCHETYPES) added the SUV, the Hummer and the work van; anything that
// draws or prices a car by type takes them as a truck unless it says otherwise (mapsprites.js, crossing.js, fieldheat.js).
export const VEHICLE_TYPES = {
  truck:  { name: "Pickup truck", tank: 30, payload: 650, motor: true },
  sedan:  { name: "Old sedan",    tank: 18, payload: 400, motor: true },
  suv:    { name: "SUV",          tank: 24, payload: 520, motor: true },
  hummer: { name: "Hummer",       tank: 40, payload: 700, motor: true },
  van:    { name: "Work van",     tank: 26, payload: 800, motor: true },
  // An Army cargo truck or an MRAP got running again (miltrucks.js, foundcars.js): carries a great deal and seats a
  // squad, but it is slow (speed: × the pace, load.js; about 1.5× a car's time a tile, and off-road worse: OFFROAD),
  // drinks fuel (fuel: × every tile's fuel) and is loud (loud: draws hordes as it passes, parties.js onEnterTile; more
  // camp Heat, fieldheat.js; more Heat driven on a battle map, combat.js DRIVE).
  miltruck: { name: "Army cargo truck", tank: 150, payload: 2500, motor: true, speed: 0.67, fuel: 2, offroad: 0.75, loud: true, seats: 12 },
  bike:   { name: "Bicycles",     tank: 0,  rack: 15, motor: false },
};
export const RIDER_KG = 80;        // a person in a car, before what they wear
export const OVERLOAD_MAX = 1.25;  // a car can be loaded to 125% of its payload
export const FUEL_FULL = { from: 0.6, atFull: 1.3, atMax: 1.6 }; // fuel multiplier by how full a car is
export const OVERLOAD_SPEED = 0.85;   // an overloaded car (past 100%) is this much slower
export const OVERLOAD_WEAR = 1.5;     // and wears / breaks down this much more
export const ROAD_FUEL = 0.6, OFFROAD_FUEL = 1.5; // fuel per tile entered, by road or off-road
// By type (VEHICLE_TYPES speed / fuel / offroad, 1 when not given): × the pace, × the fuel a tile, × the pace off-road.
// Both × what the vehicle's armour does to it (upgradeSpeed / upgradeFuel: plating is heavy).
// A fleet (several vehicles, fleetOf): the slowest car's pace and off-road pace, every car's fuel summed.
export const typeSpeed = (v) => (v && v.fleet ? Math.min(1, ...v.fleet.filter(isCarOne).map(typeSpeed)) : (v && VEHICLE_TYPES[v.type] ? VEHICLE_TYPES[v.type].speed ?? 1 : 1) * upgradeSpeed(v));
export const typeFuel = (v) => (v && v.fleet ? v.fleet.filter(isCarOne).reduce((a, x) => a + typeFuel(x), 0) : (v && VEHICLE_TYPES[v.type] ? VEHICLE_TYPES[v.type].fuel ?? 1 : 1) * upgradeFuel(v));
export const typeOffroad = (v) => (v && v.fleet ? Math.min(1, ...v.fleet.filter(isCarOne).map(typeOffroad)) : v && VEHICLE_TYPES[v.type] ? VEHICLE_TYPES[v.type].offroad ?? 1 : 1);
export const isLoud = (v) => (v && v.fleet ? v.fleet.some(isLoud) : !!(v && VEHICLE_TYPES[v.type] && VEHICLE_TYPES[v.type].loud));

const isBikeOne = (v) => !!v && v.type === "bike";
const isCarOne = (v) => !!v && !!VEHICLE_TYPES[v.type]?.motor;
// A fleet: bikes when every one is a bike, a car when any is (it travels as cars do).
export const isBike = (v) => (v && v.fleet ? v.fleet.every(isBikeOne) : isBikeOne(v));
export const isCar = (v) => (v && v.fleet ? v.fleet.some(isCarOne) : isCarOne(v));
// How a team with this vehicle moves: false (on foot), true (a car) or "bike" (parties.js moveCost, planPath).
export const travelMode = (v) => (!v ? false : isBike(v) ? "bike" : true);

export function createVehicle(state, type, loc, opts = {}) {
  const v = {
    id: newId(), type, name: opts.name || VEHICLE_TYPES[type].name,
    fuel: type === "bike" ? 0 : opts.fuel ?? 20, condition: opts.condition ?? 80, loc,
  };
  if (type === "bike") v.count = Math.max(1, opts.count || 1);
  state.vehicles.push(v);
  return v;
}

export const vehicleById = (state, id) => state.vehicles.find((v) => v.id === id);
export const vehiclesAtBase = (state, baseId) => state.vehicles.filter((v) => v.loc.kind === "base" && v.loc.baseId === baseId);
// Cars only (supply runs, trade routes and caravans need an engine).
export const carsAtBase = (state, baseId) => vehiclesAtBase(state, baseId).filter(isCar);
export const bikesAtBase = (state, baseId) => vehiclesAtBase(state, baseId).filter(isBike).reduce((n, v) => n + (v.count || 1), 0);
// ---------- several vehicles to a team (teamform.js) ----------
// p.vehicleIds lists a team's vehicles (a stack of bikes is one entry; an old save's single vehicleId becomes a list of
// one, save.js), cars first. p.vehicleId stays the lead one (the first car, else the bikes): what "the team's vehicle"
// means where only one can be (the one driven on a battle map, the map sprite, the vehicle on a card). A fleet object
// (fleetOf: { fleet: [...] }) stands for them together where they add up: seats, payload, racks and tanks summed
// (seatsOf, payloadOf, vehicleCapacity, tank), the slowest car's pace (typeSpeed, typeOffroad), every car's fuel
// (typeFuel summed: useFuel takes it from each car's own tank, an empty tank topped up from the cans, then from the other
// cars), and with bikes among the cars the convoy keeps to the bikes on roads (roadPace) and to the cars off them.
// One vehicle is itself (fleetOf returns it), so a team with one vehicle is exactly what it always was.
// Each vehicle needs someone driving or riding it, and with two or more everyone needs a seat (fleetProblem); a lone
// car takes anyone who squeezes in, as it always has (its payload counts 80 kg a rider).
export const MAX_VEHICLES = 4;
// Seats: who can ride in a vehicle (a battle map's board / disembark; a fleet's room on the road), by its model.
export const SEATS = { sedan: 4, suv: 5, hummer: 4, van: 7, truck: 5, bike: 1, miltruck: 12 }; // a bike or a motorcycle: its rider
/** @param {any} p @returns {number[]} */
// p.vehicleId (the lead) is the word: none, no vehicles; a lead the list does not hold (older code that set the one
// vehicle directly) is the only one.
export const partyVehicleIds = (p) => (!p || !p.vehicleId ? [] : Array.isArray(p.vehicleIds) && p.vehicleIds.includes(p.vehicleId) ? p.vehicleIds : [p.vehicleId]);
/** @returns {any[]} */
export const partyVehicles = (state, p) => partyVehicleIds(p).map((id) => vehicleById(state, id)).filter(Boolean);
// The lead vehicle (old callers: "the team's vehicle"); partyFleet for all of them together.
export const partyVehicle = (state, p) => (p.vehicleId ? vehicleById(state, p.vehicleId) || null : partyVehicles(state, p)[0] || null);
export const partyFleet = (state, p) => fleetOf(partyVehicles(state, p));
const leadOrder = (vs) => [...vs.filter((v) => !isBikeOne(v)), ...vs.filter(isBikeOne)];
// null, the one vehicle itself, or { fleet, id (the lead's), type (the lead's), upgrades (the lead's), count (bikes),
// fuel (every car's), condition (the worst), name ("Pickup truck + Old sedan") }.
export function fleetOf(vs) {
  const list = leadOrder((vs || []).filter(Boolean));
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  const lead = list[0];
  const cars = list.filter(isCarOne), bikes = list.filter(isBikeOne);
  const f = { fleet: list, id: lead.id, type: lead.type, upgrades: lead.upgrades, loc: lead.loc };
  if (bikes.length) f.count = bikes.reduce((a, v) => a + (v.count || 1), 0);
  Object.defineProperty(f, "fuel", { get: () => cars.reduce((a, v) => a + (v.fuel || 0), 0), enumerable: true });
  Object.defineProperty(f, "condition", { get: () => Math.min(...list.map((v) => v.condition)), enumerable: true });
  Object.defineProperty(f, "name", { get: () => fleetName(list), enumerable: true });
  return f;
}
const oneLabel = (v) => (isBikeOne(v) ? `${v.count || 1} bicycle${(v.count || 1) === 1 ? "" : "s"}` : v.destroyed ? `${v.name} (wrecked)` : v.name);
const fleetName = (list) => list.map(oneLabel).join(" + ");
const fleetParts = (v) => (v && v.fleet ? v.fleet : v ? [v] : []);
// Seats in it or them: cars by model, a bike its rider.
export const seatsOf = (v) => fleetParts(v).reduce((a, x) => a + (isBikeOne(x) ? x.count || 1 : SEATS[x.type] ?? 4), 0);
export const fleetSize = (v) => fleetParts(v).length;
// People it takes to move them: one at each car's wheel, one on each bike.
export const driversFor = (vs) => (Array.isArray(vs) ? vs : fleetParts(vs)).reduce((a, x) => a + (isBikeOne(x) ? x.count || 1 : 1), 0);
// Why these people cannot take these vehicles ("" when they can). n: how many people.
export function fleetProblem(vs, n) {
  const list = (vs || []).filter(Boolean);
  if (list.length > MAX_VEHICLES) return `At most ${MAX_VEHICLES} vehicles to a team.`;
  if (!list.length) return "";
  // One person to each vehicle: a car its driver, a bike its rider (pick-list: "at least one person per vehicle").
  const need = driversFor(list);
  if (need > n) return `Each vehicle needs its own person (a driver for a car, a rider for a bike): ${need} for ${n} ${n === 1 ? "person" : "people"}.`;
  if (list.length < 2) return "";
  const seats = seatsOf(fleetOf(list));
  if (seats < n) return `Not enough seats: ${seats} for ${n} people.`;
  return "";
}
// Why a car cannot join a team's vehicles now ("" when it can: a free driver, a seat each, under the cap). A team
// with no vehicle can always take one.
export function fleetJoinProblem(state, p, v) {
  const have = partyVehicles(state, p);
  if (!have.length) return p.vehicle ? "The team already has a vehicle." : ""; // (a vehicle record gone from under it: as before fleets)
  if (have.includes(v)) return "It is already the team's.";
  if (have.length >= MAX_VEHICLES) return `The team has ${MAX_VEHICLES} vehicles already.`;
  if (isBikeOne(v)) return "The team already has vehicles: bikes go to a team without one.";
  return fleetProblem([...have, v], (p.members || []).length);
}
// One more vehicle for the team (fleetJoinProblem first): cars first, the lead stays the lead.
export function addPartyVehicle(state, p, v) {
  return setPartyVehicles(state, p, [...partyVehicles(state, p), v]);
}
// One of the team's vehicles gone (sold, given away): the rest stay.
export function dropPartyVehicle(state, p, v) {
  return setPartyVehicles(state, p, partyVehicles(state, p).filter((x) => x !== v));
}
// On roads with bikes among the cars, the convoy keeps to the bikes (half a car's road pace).
export const roadPace = (v) => (v && v.fleet && v.fleet.some(isBikeOne) && v.fleet.some(isCarOne) ? 0.5 : 1);
// The team's vehicles from now on (cars first: the lead is p.vehicleId), each riding with it; p.vehicle its way of travel.
export function setPartyVehicles(state, p, vs) {
  const list = leadOrder((vs || []).filter(Boolean));
  p.vehicleIds = list.map((v) => v.id);
  p.vehicleId = list.length ? list[0].id : null;
  for (const v of list) v.loc = { kind: "party", partyId: p.id };
  p.vehicle = travelMode(fleetOf(list));
  return list;
}
export const tank = (v) => (v && v.fleet ? v.fleet.filter(isCarOne).reduce((a, x) => a + VEHICLE_TYPES[x.type].tank, 0) : VEHICLE_TYPES[v.type].tank);
// Cargo a vehicle adds to a team: a car's payload, a stack of bikes' racks (a fleet: all of them).
export const vehicleCapacity = (v) => (!v ? 0 : v.fleet ? v.fleet.reduce((a, x) => a + vehicleCapacity(x), 0) : isBike(v) ? (v.count || 1) * VEHICLE_TYPES.bike.rack : payloadOf(v));
export const vehicleLabel = (v) => (v && v.fleet ? fleetName(v.fleet) : oneLabel(v));
// Blown up in a fight (launchers.js): condition 0 for good, a wreck nothing repairs; stripped for parts at a base or
// where it lies (parties.js recoverVehicle).
export const isWreck = (v) => !!(v && v.destroyed);
export const WRECK_TEXT = "Blown up: a burnt-out wreck nothing can repair. Strip it for parts and scrap.";

// Fuel multiplier for a car this full (load / payload): 1 up to 60%, 1.3 at 100%, 1.6 at 125% (the most).
export function fuelMultFor(fill) {
  const f = Math.max(0, fill || 0);
  let m = 1;
  if (f > 1) m = FUEL_FULL.atFull + ((FUEL_FULL.atMax - FUEL_FULL.atFull) * Math.min(f - 1, OVERLOAD_MAX - 1)) / (OVERLOAD_MAX - 1);
  else if (f > FUEL_FULL.from) m = 1 + ((FUEL_FULL.atFull - 1) * (f - FUEL_FULL.from)) / (1 - FUEL_FULL.from);
  return Math.round(m * 100) / 100;
}
// Fuel to enter one tile: by road or off-road, times the load multiplier; bikes use none.
export const tileFuel = (mode, onRoad, mult = 1) => (mode === true ? (onRoad ? ROAD_FUEL : OFFROAD_FUEL) * mult : 0);

// ---------- bicycles ----------
// All the bikes parked at a base in one stack (and bicycle items in its armory join them). Returns the stack or null.
export function parkBikes(state, base) {
  if (!base) return null;
  const items = (base.armory || []).filter((it) => it && it.key === "bicycle");
  if (items.length) base.armory = base.armory.filter((it) => !(it && it.key === "bicycle"));
  const stacks = state.vehicles.filter((v) => isBike(v) && v.loc.kind === "base" && v.loc.baseId === base.id);
  const n = stacks.reduce((s, v) => s + (v.count || 1), 0) + items.length;
  if (!n) return null;
  // Condition: the average over every bike (a found bicycle counts at its own condition).
  const cond = stacks.reduce((s, v) => s + v.condition * (v.count || 1), 0) + items.reduce((s, it) => s + 100 * Math.max(0.2, it.quality ?? 1), 0);
  const keep = stacks[0] || createVehicle(state, "bike", { kind: "base", baseId: base.id }, { count: 1, condition: 80 });
  for (const v of stacks.slice(1)) state.vehicles.splice(state.vehicles.indexOf(v), 1);
  keep.count = n;
  keep.condition = Math.round((cond / n) * 10) / 10;
  keep.fuel = 0;
  return keep;
}
// Takes n bikes from a base's stack for a team: the stack itself when it has exactly n, else a new stack of n.
export function takeBikes(state, base, n) {
  const stack = parkBikes(state, base);
  if (!stack || stack.count < n) return null;
  if (stack.count === n) return stack;
  stack.count -= n;
  return createVehicle(state, "bike", { kind: "base", baseId: base.id }, { count: n, condition: stack.condition });
}

// Fuel a party can use: the vehicle's tank plus jerry cans carried as supplies.
// Several cars: every car's tank.
export function partyFuel(state, p) {
  const vs = partyVehicles(state, p);
  if (vs.length > 1) return vs.filter(isCarOne).reduce((a, v) => a + (v.fuel || 0), 0) + (p.supplies.fuel || 0);
  const v = partyVehicle(state, p);
  return (v ? v.fuel : 0) + (p.supplies.fuel || 0);
}

// amount: what the team's cars burn together (tileFuel × the fleet's multiplier, typeFuel summed). Several cars: each
// takes its share (by its own typeFuel) from its own tank, an empty tank is topped up from the cans, then from the
// other cars' tanks (the convoy shares its fuel). False when it ran out.
export function useFuel(state, p, amount) {
  const vs = partyVehicles(state, p);
  const cars = vs.filter(isCarOne);
  if (cars.length > 1) {
    const total = cars.reduce((a, v) => a + typeFuel(v), 0) || 1;
    let short = 0;
    for (const v of cars) {
      const want = (amount * typeFuel(v)) / total;
      const fromTank = Math.min(v.fuel, want);
      v.fuel -= fromTank;
      short += want - fromTank;
    }
    const fromCans = Math.min(p.supplies.fuel || 0, short);
    p.supplies.fuel = (p.supplies.fuel || 0) - fromCans;
    short -= fromCans;
    for (const v of cars) { if (short <= 1e-9) break; const q = Math.min(v.fuel, short); v.fuel -= q; short -= q; }
    return short <= 1e-9;
  }
  const v = partyVehicle(state, p);
  let need = amount;
  if (v) {
    const fromTank = Math.min(v.fuel, need);
    v.fuel -= fromTank;
    need -= fromTank;
    // Top the tank up from jerry cans when it runs dry.
  }
  const fromCans = Math.min(p.supplies.fuel || 0, need);
  p.supplies.fuel = (p.supplies.fuel || 0) - fromCans;
  need -= fromCans;
  return need <= 1e-9;
}

// Chance a tile of driving brings a breakdown (bikes: a flat or a snapped chain, much rarer); an overloaded car
// (past 100% of its payload) breaks down 1.5× as often.
export function breakdownChance(v, fill = 0) {
  if (isBike(v)) return 0.003 + ((100 - v.condition) / 100) * 0.02;
  return (0.01 + ((100 - v.condition) / 100) * 0.08) * (fill > 1 ? OVERLOAD_WEAR : 1) * UPGRADE_FX.breakdown ** armourOf(v); // plating shields the engine and the tyres
}

// Which of the team's vehicles breaks down on this tile (events.js rollTravelEvent), or null. One vehicle: one roll, as
// always. Several: one roll for any of them (1 − every one holding up), then which one, each by its own chance.
export function breakdownRoll(state, p, fill = 0) {
  const vs = partyVehicles(state, p);
  if (vs.length <= 1) { const v = partyVehicle(state, p); return v && state.rng.chance(breakdownChance(v, fill)) ? v : null; }
  const cs = vs.map((v) => breakdownChance(v, fill));
  const any = 1 - cs.reduce((a, c) => a * (1 - c), 1);
  if (!state.rng.chance(any)) return null;
  let r = state.rng.next() * cs.reduce((a, c) => a + c, 0);
  for (let i = 0; i < vs.length; i++) { r -= cs[i]; if (r <= 0) return vs[i]; }
  return vs[vs.length - 1];
}

export function wear(v, onRoad, fill = 0) {
  const w = isBike(v) ? (onRoad ? 0.1 : 0.4) : (onRoad ? 0.25 : 0.9) * (fill > 1 ? OVERLOAD_WEAR : 1);
  v.condition = Math.max(0, v.condition - w);
}

// The team leaves the vehicle where it stopped; it becomes a marker they know about.
// which: one of several vehicles (the rest stay with the team); left out, every vehicle the team has.
export function abandonVehicle(state, p, tile, reason, which = null) {
  const all = partyVehicles(state, p);
  if (which && all.length > 1 && all.includes(which)) {
    setPartyVehicles(state, p, all.filter((x) => x !== which));
    markLeft(state, p, which, tile, reason);
    return;
  }
  if (!which && all.length > 1) {
    for (const x of all) markLeft(state, p, x, tile, reason);
    p.vehicleIds = [];
    p.vehicle = false;
    p.vehicleId = null;
    return;
  }
  const v = partyVehicle(state, p);
  if (!v) return;
  p.vehicleIds = [];
  markLeft(state, p, v, tile, reason);
  p.vehicle = false;
  p.vehicleId = null;
}
export function markLeft(state, p, v, tile, reason) {
  v.loc = { kind: "abandoned", tile, since: state.hour };
  if (p.spotted) p.spotted.set(`vehicle:${v.id}`, { key: `vehicle:${v.id}`, type: "vehicle", tile, hour: state.hour, label: `${v.name} (${reason})`, info: { vehicleId: v.id, fuel: Math.round(v.fuel), condition: Math.round(v.condition) } });
}

export function refuel(state, base, v) {
  if (isBike(v)) return "Bikes run on legs.";
  const want = Math.max(0, tank(v) - v.fuel);
  const give = Math.max(0, Math.min(want, Math.floor(base.stock.fuel || 0)));
  base.stock.fuel = Math.max(0, (base.stock.fuel || 0) - give);
  v.fuel = Math.min(tank(v), v.fuel + give);
  return give > 0.05 ? `Added ${Math.round(give * 10) / 10} fuel to the ${v.name}.` : want > 0.05 ? "No fuel to add." : "The tank is full.";
}

export function canRepair(state, base) {
  const grease = atBase(state, base.id).some((s) => hasPerk(s, "greasemonkey")); // Grease Monkey (skills.js)
  if (count(base, "garage")) return { ok: true, per: grease ? 35 : 25 };
  if (atBase(state, base.id).some((s) => skill(s, "mechanics") >= 4)) return { ok: true, per: grease ? 25 : 12 };
  return { ok: false, per: 0 };
}

// Car parts (data.js SUPPLIES carparts; docs/weapons-overhaul-plan.md section 10): a vehicle is mended with car parts,
// and CARPART_SUB machine parts stand in for each one short. What paying n car parts takes from what is there:
// { car, parts, ok } (have(k) reads a stock; nothing is taken).
export const CARPART_SUB = 2;
/** @param {(k: string) => number} have @param {number} n */
export function carPartsCost(have, n) {
  const car = Math.min(n, Math.max(0, Math.floor(have("carparts") + 1e-9)));
  const parts = (n - car) * CARPART_SUB;
  return { car, parts, ok: parts <= Math.max(0, have("parts")) + 1e-9 };
}
// "1 car part" / "2 car parts (or 2 machine parts each)".
/** @param {number} n */
export const carPartsText = (n) => `${n} car part${n === 1 ? "" : "s"} (or ${CARPART_SUB} machine parts for each)`;
// A wrecked car found on the map (a hidden "car", parties.js investigate): restoring it takes WRECK.parts car parts (or
// machine parts for them) and WRECK.fuel fuel. What a stock or a team's load would pay: { ok, car, parts, fuel }.
export const WRECK = { parts: 2, fuel: 6 };
/** @param {(k: string) => number} have */
export function wreckCost(have) {
  const pay = carPartsCost(have, WRECK.parts);
  return { ...pay, fuel: WRECK.fuel, ok: pay.ok && have("fuel") >= WRECK.fuel - 1e-9 };
}
// What a team packs for a wreck it may restore: the car parts (machine parts for any short) and the fuel, or nothing
// when the stock cannot pay (the team goes to strip it).
/** @param {Record<string, number>} stock */
export function wreckSupplies(stock) {
  const c = wreckCost((k) => Math.max(0, stock[k] || 0));
  return c.ok ? { ...(c.car ? { carparts: c.car } : {}), ...(c.parts ? { parts: c.parts } : {}), fuel: c.fuel } : null;
}

export function repair(state, base, v) {
  if (isWreck(v)) return WRECK_TEXT;
  if (isBike(v)) {
    // Bikes: patches, a chain link, spokes. Anyone can do it with a bit of scrap per bike.
    const need = Math.max(1, Math.ceil((v.count || 1) / 2));
    if (v.condition >= 100) return "Already in top shape.";
    if ((base.stock.scrap || 0) < need) return `Needs ${need} scrap.`;
    base.stock.scrap -= need;
    v.condition = Math.min(100, v.condition + 30);
    return `Patched up the bikes to ${Math.round(v.condition)}% (${need} scrap).`;
  }
  const r = canRepair(state, base);
  if (!r.ok) return "Needs a garage or a Mechanics 4+ survivor at this base.";
  const pay = carPartsCost((k) => base.stock[k] || 0, 1);
  if (!pay.ok) return `Needs ${carPartsText(1)}.`;
  if (v.condition >= 100) return "Already in top shape.";
  if (pay.car) base.stock.carparts -= pay.car;
  if (pay.parts) base.stock.parts -= pay.parts;
  v.condition = Math.min(100, v.condition + r.per);
  const mech = atBase(state, base.id).sort((a, b) => skill(b, "mechanics") - skill(a, "mechanics"))[0];
  if (mech) gainXp(state, mech, "mechanics", USE.repair); // skills.js
  return `Repaired the ${v.name} to ${Math.round(v.condition)}%.`;
}

// =====================================================================================================================
// Vehicle upgrades (weapons overhaul plan section 11): v.upgrades = { glass: 0|1, mesh: 0|1, plating: 0|1|2,
// scrapPlate: 0|1, turret: null | { gun: "lmg" | "m2hb", item? } }. A missing v.upgrades (old saves) is {}.
//   glass       Bulletproof glass (a garage or a workbench): riders hit through the windows take ×0.35 from pen ≤ 30, ×0.8 from pen ≤ 45
//               (riderMult); the enemy's first strike in an ambush on the road ×0.85 (ambushMult).
//   mesh        Mesh grilles (cheap, made at any base): no use against bullets, but the dead cannot reach in: an
//               ambush by the dead ×0.85, ramming the dead wears the front half as much, blast fragments ×0.8.
//   plating     Armour plate, 1 or 2 levels (a garage or a workbench): the vehicle's cells are full cover and stop rounds that go
//               through light cover (combat.js platedCell); ramming, blast (and later rocket) wear ×0.6 a level
//               (wearMult); breakdowns ×0.8 a level; +180 kg a level, fuel ×1.15, speed ×0.95 a level.
//   scrapPlate  Scrap plating (welded mesh and scrap-steel plates, cheap, any bench, Mechanics 3): one level that
//               counts half (armourOf 0.5) and weighs more (+230 kg, fuel ×1.18, speed ×0.94). Full cover too, but it
//               does not stop what goes through light cover.
//   turret      A mounted machine gun (data only until a later wave makes it fire; military Humvees come with an M2).
// Every upgrade's weight comes off the payload (payloadOf: vehicleCapacity, load.js weighTeam): the full kit on a pickup
// (glass 90 + plate 2 × 180) is 450 kg of its 650.
// Built as garage jobs at a base (base.garage, garageHour): materials paid when queued, the work done by people on the
// Craft role with the Mechanics level; stripping one refunds half its car parts, and glass comes out whole (a spare set
// kept at the base, base.spareGlass, fitted again with no materials).
// =====================================================================================================================
// Part kinds (plan section 10): car parts are their own supply once it exists, plain parts until then.
export const costOf = (kind) => (SUPPLIES[kind] ? kind : "parts");
export const VEH_UPGRADES = {
  glass:      { name: "Bulletproof glass", slot: "windows", max: 1, cost: { carparts: 4, scrap: 12 }, hours: 16, mech: 5, kg: 90, shop: "garage" },
  mesh:       { name: "Mesh grilles", slot: "windows", max: 1, cost: { scrap: 8 }, hours: 6, mech: 2, kg: 30 },
  plating:    { name: "Armour plate", slot: "plating", max: 2, cost: { carparts: 6, parts: 2, scrap: 40 }, hours: 24, mech: 6, kg: 180, fuel: 1.15, speed: 0.95, armour: 1, shop: "garage" },
  scrapPlate: { name: "Scrap plating", slot: "plating", max: 1, cost: { carparts: 2, scrap: 30 }, hours: 12, mech: 3, kg: 230, fuel: 1.18, speed: 0.94, armour: 0.5, shop: "bench" },
};
export const TURRET_KG = { lmg: 60, m2hb: 90 };
// Turrets (the user's rules, wave 2). The LMG turret is a garage job, the player's and the AI groups' alike: it takes an
// unused hand-held light machine gun (the roster's lmg item, out of the base's armory or the group's arsenal) plus
// scrap and parts, and holds that very item (upgrades.turret.item: its wear and parts); stripping the turret gives it
// back. The M2 is never built or fitted: it comes mounted on military vehicles (found, claimed or captured Humvees,
// Army trucks, a National Guard motor pool, a military group's or an escort's), is bolted to the hull (never stripped,
// never salvaged: there is no M2 item) and is lost with its vehicle.
export const TURRET_FIT = { gun: "lmg", item: "lmg", cost: { scrap: 15, parts: 4 }, hours: 16, mech: 6, shop: "garage" };
export const turretRemovable = (t) => !!t && t.gun !== "m2hb";
export const M2_BOLTED = "The M2 is bolted to the hull: it stays with the vehicle.";
export const TURRET_NAME = { lmg: "LMG turret", m2hb: "M2 turret" };
export const UPGRADE_FX = {
  wear: 0.6, breakdown: 0.8,                      // × a plating level (armourOf)
  glass: [[30, 0.35], [45, 0.8]],                 // riders behind bulletproof glass: × damage up to this pen
  ambush: 0.85,                                   // the enemy's first-strike bonus with glass (mesh: against the dead)
  meshBlast: 0.8, meshRam: 0.5,                   // mesh grilles: blast fragments on riders, ramming the dead
  riderBlast: 0.6, blastPen: 20,                  // a blast next to the vehicle: the body shields the riders; fragments' pen
};
export const TURRET_ODDS = { lmg: 4, m2hb: 6 };   // by the numbers: + power on the side whose turret fights (byNumbersOdds)
export const MAX_GARAGE = 4;                      // jobs queued at a base
// Where the work can be done (buildings.js): "garage" a garage or a workbench / master workbench (bench tier 2+),
// "bench" a garage or any crafting bench; none: anywhere at a base.
export const shopOk = (base, need) => !need || count(base, "garage") > 0 || benchTier(base) >= (need === "garage" ? 2 : 1);
export const SHOP_TEXT = { garage: "a garage or a workbench", bench: "a garage or a crafting bench" };
const VEH_VALUE = { sedan: 120, truck: 200, suv: 180, hummer: 260, van: 200, miltruck: 450 };

export const upgradesOf = (v) => ({ glass: 0, mesh: 0, plating: 0, scrapPlate: 0, turret: null, ...((v && v.upgrades) || {}) });
export const hasUpgrades = (v) => { const u = upgradesOf(v); return !!(u.glass || u.mesh || u.plating || u.scrapPlate || u.turret); };
// The armour level: real plate 1 a level, scrap plating half a level.
export const armourOf = (v) => { const u = upgradesOf(v); return u.plating + 0.5 * u.scrapPlate; };
export function upgradeKg(v) {
  const u = upgradesOf(v);
  return u.glass * VEH_UPGRADES.glass.kg + u.mesh * VEH_UPGRADES.mesh.kg + u.plating * VEH_UPGRADES.plating.kg + u.scrapPlate * VEH_UPGRADES.scrapPlate.kg + (u.turret ? TURRET_KG[u.turret.gun] || 60 : 0);
}
// What a car takes after the weight of its upgrades.
export const payloadOf = (v) => v && v.fleet ? v.fleet.filter(isCarOne).reduce((a, x) => a + payloadOf(x), 0) : Math.max(50, (VEHICLE_TYPES[v.type] || VEHICLE_TYPES.truck).payload - upgradeKg(v));
export const upgradeFuel = (v) => { const u = upgradesOf(v); return VEH_UPGRADES.plating.fuel ** u.plating * VEH_UPGRADES.scrapPlate.fuel ** u.scrapPlate; };
export const upgradeSpeed = (v) => { const u = upgradesOf(v); return VEH_UPGRADES.plating.speed ** u.plating * VEH_UPGRADES.scrapPlate.speed ** u.scrapPlate; };
// × what ramming, a blast or (later) a rocket costs its condition.
export const wearMult = (v) => UPGRADE_FX.wear ** armourOf(v);
// × the damage a rider takes from a hit of this pen ("blast": fragments, through the windows).
export function riderMult(v, pen, how = "shot") {
  const u = upgradesOf(v);
  if (how === "blast" && u.mesh && !u.glass) return UPGRADE_FX.meshBlast;
  if (!u.glass) return 1;
  for (const [upTo, m] of UPGRADE_FX.glass) if (pen <= upTo) return m;
  return 1;
}
// × the enemy's first-strike bonus in an ambush on a team riding this vehicle (glass; mesh grilles only against the dead).
export function ambushMult(v, enemyKind) {
  if (!v || isBike(v)) return 1;
  const u = upgradesOf(v);
  return u.glass || (u.mesh && enemyKind === "zombies") ? UPGRADE_FX.ambush : 1;
}
// One line: "Bulletproof glass, armour plate ×2, M2 turret".
export function upgradeText(v) {
  const u = upgradesOf(v), bits = [];
  if (u.glass) bits.push("bulletproof glass");
  if (u.mesh) bits.push("mesh grilles");
  if (u.plating) bits.push(`armour plate${u.plating > 1 ? ` ×${u.plating}` : ""}`);
  if (u.scrapPlate) bits.push("scrap plating");
  if (u.turret) bits.push(TURRET_NAME[u.turret.gun] || "MG turret");
  const s = bits.join(", ");
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}
// The effects for a tooltip.
export function upgradeEffects(v) {
  const u = upgradesOf(v), out = [];
  const kg = upgradeKg(v);
  if (kg) out.push(`+${kg} kg (payload ${payloadOf(v)} kg)`);
  if (u.plating || u.scrapPlate) out.push(`fuel ×${upgradeFuel(v).toFixed(2)}, speed ×${upgradeSpeed(v).toFixed(2)}, breakdowns ×${(UPGRADE_FX.breakdown ** armourOf(v)).toFixed(2)}, ramming and blast wear ×${wearMult(v).toFixed(2)}, full cover on the battle map`);
  if (u.glass) out.push("riders take ×0.35 from pistol rounds and 5.56, ×0.8 up to .308 AP; an ambush on the road hits ×0.85 as hard");
  if (u.mesh) out.push("the dead cannot reach in: their ambushes hit ×0.85 as hard, ramming them wears the front half as much");
  return out.join("; ");
}
// Worth: the car by type and condition, plus what its upgrades are made of.
export function vehicleValue(v) {
  if (!v || isBike(v)) return v ? 30 * (v.count || 1) : 0;
  const base = (VEH_VALUE[v.type] || 180) * (0.4 + 0.6 * Math.max(0, Math.min(100, v.condition)) / 100);
  const u = upgradesOf(v);
  let up = 0;
  for (const k of Object.keys(VEH_UPGRADES)) up += (u[k] || 0) * costValue(upgradeCost(k));
  if (u.turret) up += u.turret.item && GEAR[u.turret.item.key] ? (GEAR[u.turret.item.key].value || 200) : u.turret.gun === "m2hb" ? 400 : 250;
  return Math.round(base + up);
}
const costValue = (c) => Object.entries(c).reduce((a, [k, q]) => a + q * ((SUPPLIES[k] && SUPPLIES[k].value) || 1), 0);
// An upgrade's cost in today's supply keys (car parts fall back to parts; the two part kinds merge then).
export function upgradeCost(key) {
  const out = {};
  for (const [k, q] of Object.entries(key === "turret" ? TURRET_FIT.cost : VEH_UPGRADES[key].cost)) { const s = costOf(k); out[s] = (out[s] || 0) + q; }
  return out;
}
// The unused LMG a turret takes from a base's armory (the best kept first), or null.
export const turretItemIn = (list) => (list || []).filter((it) => it && it.key === TURRET_FIT.item).sort((a, b) => (b.dur ?? 0) - (a.dur ?? 0))[0] || null;
export const costText = (c) => Object.entries(c).map(([k, q]) => `${q} ${(SUPPLIES[k] ? SUPPLIES[k].name : k).toLowerCase()}`).join(", ");

// ---------- pre-fitted ----------
// Military vehicles (miltrucks.js: the cargo truck, the Humvee, the MRAP) claimed or found running: armour plate and
// bulletproof glass; turret: the gun on the roof when it has one.
export function fitMilitary(v, turret = null) {
  if (!v || isBike(v)) return v;
  v.upgrades = { ...upgradesOf(v), glass: 1, mesh: 0, plating: Math.max(1, upgradesOf(v).plating), scrapPlate: 0, ...(turret ? { turret: { gun: turret } } : {}) };
  return v;
}
// A raider technical (a pickup left by a raider group): scrap plating half the time, on its own dice.
export const TECHNICAL = { scrapPlate: 0.5 };
// Is the pickup an AI party drove (aiscav.js vehicleType) a plated technical? Raiders' pickups, half of them, by the party.
export function isTechnical(state, factionId, type, salt) {
  const f = factionId != null ? (state.factions || []).find((x) => x.id === factionId) : null;
  return !!f && f.type === "raider" && type === "truck" && hash01(state.seed, "technical", salt) < TECHNICAL.scrapPlate;
}
// The enemy's vehicle on a battle map (combat.js setup.enemy.vehicle).
export const technicalPlated = (state, enemy) => !!enemy && !!enemy.vehicle && isTechnical(state, enemy.factionId, enemy.vehicle, enemy.vehiclePartyId ?? "");
// Their technical left on the field (conflicts.js takeTheirVehicle) keeps its plating.
export function fitTechnical(state, v, factionId, salt) {
  if (!v || !isTechnical(state, factionId, v.type, salt ?? "")) return false;
  v.upgrades = { ...upgradesOf(v), scrapPlate: 1 };
  return true;
}

// ---------- a military group's motor pool (factions.js) ----------
// A "Military remnant" group starts with an Army cargo truck and a Humvee with an M2 on the roof at its home base, both
// plated and glassed: f.vehicles (their own records, never in state.vehicles, so nothing takes them for yours). Old
// saves get theirs the first time it is read. The Humvee's turret adds TURRET_ODDS.m2hb to the defence of their home
// base (factions.js resolveRaidOnFaction, conquest.js defenders) and to a raid that brings it (assignRaidHumvee below);
// a raid that fails loses it, and taking their home base takes the lot (seizeGroupVehicles).
export function factionVehicles(f) {
  if (!f) return [];
  if (!f.vehicles) f.vehicles = f.type === "military" ? militaryPool(f) : [];
  return f.vehicles;
}
function militaryPool(f) {
  const mk = (type, name, turret) => fitMilitary({ id: `f${f.id}-${type}`, type, name, fuel: Math.round(VEHICLE_TYPES[type].tank * 0.6), condition: 80, owner: f.id }, turret);
  return [mk("miltruck", "Army cargo truck", null), mk("hummer", "Humvee", "m2hb")];
}
// The gun of the group's working turreted vehicle ("m2hb" | "lmg"), or null.
export function groupTurret(f) {
  if (!f || !f.alive) return null;
  const v = factionVehicles(f).find((x) => x.condition > 0 && upgradesOf(x).turret);
  return v ? upgradesOf(v).turret.gun : null;
}
export const groupTurretPower = (f) => { const g = groupTurret(f); return g ? TURRET_ODDS[g] || 0 : 0; };

// ---------- the Humvee on their raids: lost when the raid fails ----------
// A raid party (parties.js spawnAiParty) takes the group's working turreted vehicle along when it is not out with
// another raid (p.humvee: its id); its turret adds TURRET_ODDS to the raid by the numbers (raidTurretPower) and it stands
// on the defence map when you fight the raid in person (combat.js placeRaidHumvee). A raid that fails loses it
// (loseRaidHumvee): beaten off by you, it is left at your base, damaged, turret, plate and glass as they were, and it
// joins the base's vehicles; beaten off by another group, that group takes it into its own f.vehicles. A military group
// gets a new one HUMVEE.REPLACE days after its last loss (60–90, its own dice) while it is still HUMVEE.MIN_POP strong
// (factionVehiclesDaily); until then its raids and its home have no turret.
export const HUMVEE = { REPLACE: [60, 90], MIN_POP: 12, LEFT_COND: [25, 45], LEFT_FUEL: [3, 10] };
// Several (AI parity with your teams' fleets, coarse): a big raid brings more of the group's free turreted vehicles, one
// for each RAID_FLEET.PER of its strength over the first, up to MAX_VEHICLES (p.humvees; p.humvee the first, the one on
// the defence map). Their turrets add up by the numbers (raidTurretPower); a failed raid loses them all.
export const RAID_FLEET = { PER: 25 };
export function assignRaidHumvee(state, f, p) {
  if (!f || !p || !f.vehicles) return null;
  const busy = new Set((state.parties || []).filter((q) => q !== p).flatMap((q) => (q.humvees && q.humvees.length ? q.humvees : q.humvee != null ? [q.humvee] : [])));
  const free = f.vehicles.filter((x) => x.condition > 0 && upgradesOf(x).turret && !busy.has(x.id));
  const n = Math.min(MAX_VEHICLES, free.length, 1 + Math.floor(Math.max(0, p.strength || 0) / RAID_FLEET.PER));
  const take = free.slice(0, n);
  if (take.length) { p.humvee = take[0].id; if (take.length > 1) p.humvees = take.map((x) => x.id); }
  return take[0] || null;
}
// The vehicles a raid party brought (still the group's).
export function raidHumvees(state, p) {
  if (!p || p.humvee == null || typeof p.owner !== "number") return [];
  const f = (state.factions || []).find((x) => x.id === p.owner);
  const ids = p.humvees && p.humvees.length ? p.humvees : [p.humvee];
  return f && f.vehicles ? f.vehicles.filter((x) => ids.includes(x.id) && x.condition > 0) : [];
}
// The first of them (the one on the defence map), or null.
export function raidHumvee(state, p) {
  if (!p || p.humvee == null || typeof p.owner !== "number") return null;
  const f = (state.factions || []).find((x) => x.id === p.owner);
  return (f && f.vehicles && f.vehicles.find((x) => x.id === p.humvee && x.condition > 0)) || raidHumvees(state, p)[0] || null;
}
export const raidTurret = (state, p) => { const v = raidHumvee(state, p); return v && upgradesOf(v).turret ? upgradesOf(v).turret.gun : null; };
export const raidTurretPower = (state, p) => raidHumvees(state, p).reduce((a, v) => a + (upgradesOf(v).turret ? TURRET_ODDS[upgradesOf(v).turret.gun] || 0 : 0), 0);
// The raid failed: the group loses the vehicles it brought. to: { base } (yours: they join the base's vehicles) or
// { faction } (theirs). Returns the record the first became, or null.
// A vehicle's id for the dice, world-local (world.js localId): a group's vehicle has a string id with ids in it
// ("f<group id>-hummer-2", "f<group id>-v<vehicle id>": arsenal.js, groupworld.js, vehicletrade.js), and ids are
// process-wide. A save without state.idBase keeps its raw ids (localId), so its rolls are as they were.
export const vehKey = (state, v) => (typeof v.id === "number" ? localId(state, v.id)
  : String(v.id).replace(/^f(\d+)/, (_, n) => `f${localId(state, Number(n))}`).replace(/-v(\d+)/, (_, n) => `-v${localId(state, Number(n))}`));
export function loseRaidHumvee(state, p, to) {
  const all = raidHumvees(state, p);
  if (all.length > 1) {
    const first = all.find((x) => x.id === p.humvee) || all[0];
    for (const x of all.filter((y) => y !== first)) { p.humvee = x.id; p.humvees = null; loseRaidHumvee(state, p, to); }
    p.humvee = first.id;
    p.humvees = null;
  }
  const v = raidHumvee(state, p);
  if (!v) return null;
  const f = state.factions.find((x) => x.id === p.owner);
  f.vehicles = f.vehicles.filter((x) => x !== v);
  f.vehLost = state.hour;
  p.humvee = null;
  p.humvees = null;
  const roll = (k) => hash01(state.seed, "humvee", localId(state, f.id), vehKey(state, v) /* world-local: ids are process-wide */, state.hour, k);
  const ups = JSON.parse(JSON.stringify(upgradesOf(v)));
  if (to && to.base) {
    const [c0, c1] = HUMVEE.LEFT_COND, [f0, f1] = HUMVEE.LEFT_FUEL;
    const nv = createVehicle(state, v.type, { kind: "base", baseId: to.base.id }, { name: v.name, condition: Math.round(c0 + roll("c") * (c1 - c0)), fuel: Math.round(f0 + roll("f") * (f1 - f0)) });
    nv.upgrades = ups;
    nv.taken = { from: f.id, hour: state.hour };
    return nv;
  }
  if (to && to.faction) {
    const g = to.faction;
    g.vehicles = factionVehicles(g);
    const nv = { ...v, id: `f${g.id}-${v.type}-${state.hour}`, owner: g.id, condition: Math.max(20, Math.round(v.condition * 0.7)), upgrades: ups };
    g.vehicles.push(nv);
    return nv;
  }
  return null;
}
// The line for the raid report: "Their Humvee was left behind…".
export const humveeLeftText = (f, v, base) => `${f && f.known ? f.name : "The raiders"} left their ${v.name} behind at ${base.name}: ${upgradeText(v).replace(/^./, (c) => c.toLowerCase())}, condition ${Math.round(v.condition)}%. It is in the base's motor pool now.`;
// Daily: a military group that lost its Humvee gets another one, slowly, while it is strong enough.
export function factionVehiclesDaily(state) {
  for (const f of state.factions || []) {
    if (!f.alive || f.type !== "military" || f.vehLost == null || !f.vehicles) continue;
    if (f.vehicles.some((x) => x.condition > 0 && upgradesOf(x).turret)) continue;
    const n = f.vehLostN || 0;
    const wait = HUMVEE.REPLACE[0] + Math.floor(hash01(state.seed, "humveeback", localId(state, f.id), n) /* localId: ids are process-wide */ * (HUMVEE.REPLACE[1] - HUMVEE.REPLACE[0] + 1));
    if (state.hour - f.vehLost < wait * 24 || f.pop < HUMVEE.MIN_POP) continue;
    f.vehicles.push(fitMilitary({ id: `f${f.id}-hummer-${n + 1}`, type: "hummer", name: "Humvee", fuel: Math.round(VEHICLE_TYPES.hummer.tank * 0.6), condition: 80, owner: f.id }, "m2hb"));
    f.vehLostN = n + 1;
    f.vehLost = null;
    if (f.known && state.live && f.bases.some((b) => state.live.has(b))) log(state, `${f.name} have another Humvee with a heavy machine gun on the roof.`, "danger");
  }
}
// Their vehicles when you take their base (conquest.js): the ones still running join that base's.
export function seizeGroupVehicles(state, f, base) {
  const out = [];
  for (const v of factionVehicles(f)) {
    if (v.condition <= 0) continue;
    const nv = createVehicle(state, v.type, { kind: "base", baseId: base.id }, { name: v.name, condition: Math.round(v.condition), fuel: Math.round(v.fuel || 0) });
    nv.upgrades = JSON.parse(JSON.stringify(upgradesOf(v)));
    nv.taken = { from: f.id, hour: state.hour };
    out.push(nv);
  }
  f.vehicles = [];
  if (out.length) f.vehLost = state.hour;
  return out;
}

// ---------- by the numbers (combat.js byNumbersOdds) ----------
// { theirsAmbush: × the enemy's 1.4 when they strike first, theirsAdd: their turret, mineAdd: the turret on the team's
// own vehicle (someone mans it: the team rides it) } for a fight's setup.
export function vehicleOdds(state, setup) {
  const p = setup && setup.partyId != null ? (state.parties || []).find((x) => x.id === setup.partyId) : null;
  const v = p && p.vehicle === true ? partyVehicle(state, p) : null;
  const enemy = (setup && setup.enemy) || {};
  const tur = (x) => (upgradesOf(x).turret ? TURRET_ODDS[upgradesOf(x).turret.gun] || 0 : 0);
  // Several cars: every turret on them (each car's crew mans its own).
  const mine = !v ? 0 : partyVehicles(state, p).length > 1 ? partyVehicles(state, p).filter(isCarOne).reduce((a, x) => a + tur(x), 0) : tur(v);
  return { theirsAmbush: setup && setup.ambush === "enemy" ? ambushMult(v, enemy.kind) : 1, theirsAdd: enemy.turret ? TURRET_ODDS[enemy.turret] || 0 : 0, mineAdd: mine };
}

// ---------- garage jobs ----------
export const garageQueue = (base) => base.garage || (base.garage = []);
const fitters = (state, base, mech) => atBase(state, base.id).filter((s) => s.role === "craft" && !s.inBed && skill(s, "mechanics") >= mech);
const stripHours = (U) => Math.max(2, Math.ceil(U.hours / 2));
const stripMech = (U) => Math.max(1, U.mech - 2);
// Why this upgrade cannot be fitted (or stripped: op "strip") on v at this base now ("" when it can).
export function upgradeProblem(state, base, v, key, op = "fit") {
  if (!v || !isCar(v)) return "Only cars and trucks take upgrades.";
  if (isWreck(v)) return WRECK_TEXT;
  if (!(v.loc.kind === "base" && v.loc.baseId === base.id)) return "Park it at this base first.";
  const u = upgradesOf(v);
  if (garageQueue(base).some((j) => j.vehicleId === v.id)) return "Already in the garage for another job.";
  if (garageQueue(base).length >= MAX_GARAGE) return `The garage queue is full (${MAX_GARAGE}).`;
  if (key === "turret") {
    if (op === "strip") {
      if (!u.turret) return "No turret to take off.";
      if (!turretRemovable(u.turret)) return M2_BOLTED;
      if (!atBase(state, base.id).some((s) => skill(s, "mechanics") >= 4)) return "Needs a Mechanics 4+ survivor here.";
      return "";
    }
    if (u.turret) return `It has ${u.turret.gun === "m2hb" ? "an M2 bolted on" : "a turret"} already.`;
    if (!turretItemIn(base.armory)) return "Needs an unused light machine gun (LMG) in this base's armory: the turret is built round it.";
    if (!atBase(state, base.id).some((s) => skill(s, "mechanics") >= TURRET_FIT.mech)) return `Needs a Mechanics ${TURRET_FIT.mech}+ survivor here.`;
    if (!shopOk(base, TURRET_FIT.shop)) return `Needs ${SHOP_TEXT[TURRET_FIT.shop]} at this base.`;
    for (const [k, q] of Object.entries(upgradeCost("turret"))) if ((base.stock[k] || 0) < q) return `Needs ${costText(upgradeCost("turret"))} (short of ${(SUPPLIES[k] ? SUPPLIES[k].name : k).toLowerCase()}).`;
    return "";
  }
  const U = VEH_UPGRADES[key];
  if (!U) return "Unknown upgrade.";
  if (op === "strip") {
    if (!u[key]) return `No ${U.name.toLowerCase()} to take off.`;
    if (!atBase(state, base.id).some((s) => skill(s, "mechanics") >= stripMech(U))) return `Needs a Mechanics ${stripMech(U)}+ survivor here.`;
    return "";
  }
  if ((u[key] || 0) >= U.max) return U.max > 1 ? `Already at the most (${U.max} levels).` : "Already fitted.";
  const other = Object.keys(VEH_UPGRADES).find((k) => k !== key && VEH_UPGRADES[k].slot === U.slot && u[k]);
  if (other) return `Take the ${VEH_UPGRADES[other].name.toLowerCase()} off first.`;
  if (!atBase(state, base.id).some((s) => skill(s, "mechanics") >= U.mech)) return `Needs a Mechanics ${U.mech}+ survivor here.`;
  if (!shopOk(base, U.shop)) return `Needs ${SHOP_TEXT[U.shop]} at this base.`;
  if (key === "glass" && (base.spareGlass || 0) > 0) return "";
  for (const [k, q] of Object.entries(upgradeCost(key))) if ((base.stock[k] || 0) < q) return `Needs ${costText(upgradeCost(key))} (short of ${(SUPPLIES[k] ? SUPPLIES[k].name : k).toLowerCase()}).`;
  return "";
}
// The garage menu for one vehicle: [{ key, op, name, ok, why, cost, hours, mech, kg }].
export function upgradeOptions(state, base, v) {
  const out = [];
  if (!v || !isCar(v)) return out;
  const u = upgradesOf(v);
  for (const [key, U] of Object.entries(VEH_UPGRADES)) {
    const spare = key === "glass" && (base.spareGlass || 0) > 0;
    if ((u[key] || 0) < U.max) {
      const why = upgradeProblem(state, base, v, key, "fit");
      out.push({ key, op: "fit", name: U.max > 1 && u[key] ? `${U.name} (level ${u[key] + 1})` : U.name, ok: !why, why, cost: spare ? {} : upgradeCost(key), spare, hours: U.hours, mech: U.mech, kg: U.kg, shop: U.shop || null });
    }
    if (u[key]) {
      const why = upgradeProblem(state, base, v, key, "strip");
      out.push({ key, op: "strip", name: `Strip ${U.name.toLowerCase()}`, ok: !why, why, cost: {}, refund: stripRefund(key), hours: stripHours(U), mech: stripMech(U), kg: -U.kg });
    }
  }
  // The turret: an LMG one fitted round an unused LMG from the armory (items: the item it takes), stripped for that LMG
  // back; an M2 is bolted on (its strip shows, refused, so the reason is there to read).
  if (u.turret) { const why = upgradeProblem(state, base, v, "turret", "strip"); out.push({ key: "turret", op: "strip", name: `Strip the ${(TURRET_NAME[u.turret.gun] || "turret").toLowerCase()}`, ok: !why, why, cost: {}, refund: turretRemovable(u.turret) ? { lmg: 1 } : {}, hours: 8, mech: 4, kg: -(TURRET_KG[u.turret.gun] || 60) }); }
  else { const why = upgradeProblem(state, base, v, "turret", "fit"); out.push({ key: "turret", op: "fit", name: TURRET_NAME.lmg, ok: !why, why, cost: upgradeCost("turret"), items: [TURRET_FIT.item], hours: TURRET_FIT.hours, mech: TURRET_FIT.mech, kg: TURRET_KG.lmg, shop: TURRET_FIT.shop }); }
  return out;
}
// What stripping one level gives back: half its car parts (rounded down), and glass whole (a spare set).
export function stripRefund(key) {
  const c = VEH_UPGRADES[key].cost.carparts || 0;
  const out = {};
  if (c >= 2) out[costOf("carparts")] = Math.floor(c / 2);
  if (key === "glass") out.spareGlass = 1;
  return out;
}
// Queue it: materials paid now (a spare glass set first). Returns a message.
export function queueUpgrade(state, base, v, key, op = "fit") {
  const why = upgradeProblem(state, base, v, key, op);
  if (why) return why;
  const U = key === "turret" ? { name: TURRET_NAME[upgradesOf(v).turret ? upgradesOf(v).turret.gun : TURRET_FIT.gun] || "turret", hours: TURRET_FIT.hours, mech: TURRET_FIT.mech } : VEH_UPGRADES[key];
  const job = { id: newId(), vehicleId: v.id, key, op, progress: 0, hours: op === "strip" ? (key === "turret" ? 8 : stripHours(U)) : U.hours, mech: op === "strip" ? (key === "turret" ? 4 : stripMech(U)) : U.mech };
  if (op === "fit") {
    if (key === "turret") { // the LMG goes with the job (back to the armory if it is cancelled)
      const it = turretItemIn(base.armory);
      base.armory.splice(base.armory.indexOf(it), 1);
      job.item = it;
      job.paid = upgradeCost(key); for (const [k, q] of Object.entries(job.paid)) base.stock[k] = (base.stock[k] || 0) - q;
    } else if (key === "glass" && (base.spareGlass || 0) > 0) { base.spareGlass -= 1; job.paid = { spareGlass: 1 }; }
    else { job.paid = upgradeCost(key); for (const [k, q] of Object.entries(job.paid)) base.stock[k] = (base.stock[k] || 0) - q; }
  }
  garageQueue(base).push(job);
  const note = fitters(state, base, job.mech).length ? "" : ` Nobody on the Craft role here has Mechanics ${job.mech}+ yet.`;
  return `${op === "strip" ? `Stripping the ${U.name.toLowerCase()} from` : `${U.name} for`} the ${v.name} queued at ${base.name} (${job.hours}h).${note}`;
}
// Cancel: untouched, everything back; started, half (rounded up).
export function cancelGarageJob(state, base, id) {
  const q = garageQueue(base), job = q.find((j) => j.id === id);
  if (!job) return "That job is gone.";
  const full = job.progress <= 0;
  for (const [k, n] of Object.entries(job.paid || {})) {
    const back = full ? n : Math.ceil(n / 2);
    if (k === "spareGlass") base.spareGlass = (base.spareGlass || 0) + n;
    else base.stock[k] = (base.stock[k] || 0) + back;
  }
  if (job.item) base.armory.push(job.item); // the LMG a turret job took comes back whole
  q.splice(q.indexOf(job), 1);
  return `Cancelled. ${full ? "All" : "Half"} the materials were returned.`;
}
// Why a job is not moving ("" when it is).
export function garageJobStatus(state, base, job) {
  const v = vehicleById(state, job.vehicleId);
  if (!v) return "The vehicle is gone.";
  if (!(v.loc.kind === "base" && v.loc.baseId === base.id)) return "Waits: the vehicle is away from the base.";
  const U = VEH_UPGRADES[job.key];
  if (job.op === "fit" && U && !shopOk(base, U.shop)) return `Needs ${SHOP_TEXT[U.shop]} at this base.`;
  if (!fitters(state, base, job.mech).length) return `Needs someone on the Craft role with Mechanics ${job.mech}+.`;
  return "";
}
// Hourly: the first job that can move gets the qualified crafters' work (1 + 3% a Mechanics point each).
export function garageHour(state) {
  for (const base of state.bases) {
    const q = base.garage;
    if (!q || !q.length) continue;
    for (let i = q.length - 1; i >= 0; i--) if (!vehicleById(state, q[i].vehicleId)) q.splice(i, 1); // the vehicle was lost: the materials with it
    const job = q.find((j) => !garageJobStatus(state, base, j));
    if (!job) continue;
    const who = fitters(state, base, job.mech);
    job.progress += who.reduce((a, s) => a + 1 + skill(s, "mechanics") * 0.03, 0);
    if (job.progress < job.hours) continue;
    q.splice(q.indexOf(job), 1);
    const v = vehicleById(state, job.vehicleId);
    log(state, finishUpgrade(state, base, v, job.key, job.op, job), "good");
    const best = who.slice().sort((a, b) => skill(b, "mechanics") - skill(a, "mechanics"))[0];
    if (best) gainXp(state, best, "mechanics", (USE.repair || 3) * 2);
  }
}
// The work done: the upgrade on (or off, with the refund). Returns the log line.
export function finishUpgrade(state, base, v, key, op = "fit", job = null) {
  const u = upgradesOf(v);
  if (key === "turret" && op !== "strip") {
    const item = (job && job.item) || null;
    u.turret = { gun: TURRET_FIT.gun, ...(item ? { item } : {}) };
    v.upgrades = u;
    return `An LMG turret fitted to the ${v.name} at ${base.name}${item ? ` round the ${item.name}` : ""}: Shoot fires it from the roof (Man the turret).`;
  }
  if (key === "turret") {
    const t = u.turret;
    if (!turretRemovable(t)) return M2_BOLTED; // never: an M2 stays with the vehicle
    u.turret = null;
    v.upgrades = u;
    const item = t && t.item ? t.item : t && GEAR[t.gun] ? newItem(t.gun, 0.8) : null;
    if (item) base.armory.push(item);
    return `The ${TURRET_NAME[t.gun] || "turret"} came off the ${v.name} at ${base.name}${item ? `: the ${item.name} is in the armory` : ""}.`;
  }
  const U = VEH_UPGRADES[key];
  if (op === "strip") {
    u[key] = Math.max(0, (u[key] || 0) - 1);
    v.upgrades = u;
    const back = stripRefund(key), bits = [];
    for (const [k, n] of Object.entries(back)) {
      if (k === "spareGlass") { base.spareGlass = (base.spareGlass || 0) + n; bits.push("the glass, whole (a spare set to fit again)"); }
      else { base.stock[k] = (base.stock[k] || 0) + n; bits.push(`${n} ${(SUPPLIES[k] ? SUPPLIES[k].name : k).toLowerCase()}`); }
    }
    return `The ${U.name.toLowerCase()} came off the ${v.name} at ${base.name}${bits.length ? `: back ${bits.join(" and ")}` : ""}.`;
  }
  u[key] = Math.min(U.max, (u[key] || 0) + 1);
  v.upgrades = u;
  return `${U.name}${U.max > 1 ? ` (level ${u[key]})` : ""} fitted to the ${v.name} at ${base.name}: ${upgradeEffects(v)}.`;
}
// Strips a car parked at a base for parts (section 10): 3–8 car parts by its condition, 20 scrap and the fuel in its
// tank into the base's stores; the vehicle is gone. Not bikes. Returns the message.
export const STRIP = { min: 3, max: 8, scrap: 20 };
/** @param {any} v */
export const stripYield = (v) => ({ carparts: STRIP.min + Math.round((STRIP.max - STRIP.min) * Math.max(0, Math.min(100, v.condition || 0)) / 100), scrap: STRIP.scrap, fuel: Math.floor(Math.max(0, v.fuel || 0)) });
export function stripVehicle(state, base, v) {
  if (!v || !base || v.loc.kind !== "base" || v.loc.baseId !== base.id) return "That vehicle is not parked here.";
  if (isBike(v)) return "Bikes are not stripped for car parts.";
  const got = stripYield(v);
  for (const [k, q] of Object.entries(got)) if (q > 0) base.stock[k] = (base.stock[k] || 0) + q;
  const t = upgradesOf(v).turret; // an LMG turret's gun comes off with the rest; an M2 is scrapped with the hull
  if (t && turretRemovable(t) && t.item) base.armory.push(t.item);
  state.vehicles.splice(state.vehicles.indexOf(v), 1);
  const msg = `Stripped the ${v.name} for parts: ${got.carparts} car parts, ${got.scrap} scrap${got.fuel ? `, ${got.fuel} fuel from its tank` : ""}. It is gone.`;
  log(state, msg, "info");
  return msg;
}

// Abandoned vehicles get siphoned and stripped by passers-by, like death sites.
export function vehiclesDaily(state) {
  const rng = state.rng;
  // Bicycles carried home as cargo join the bikes parked at the base (no random numbers).
  for (const b of state.bases) if (b.armory.some((it) => it && it.key === "bicycle") || state.vehicles.filter((v) => isBike(v) && v.loc.kind === "base" && v.loc.baseId === b.id).length > 1) parkBikes(state, b);
  for (const v of [...state.vehicles]) {
    if (v.loc.kind !== "abandoned") continue;
    const t = state.tiles[v.loc.tile];
    let traffic = (TERRAIN[t.terrain].traffic || 0.02) + (t.road ? 0.15 : 0) + (typeof t.owner === "number" ? 0.15 : 0);
    const age = (state.hour - v.loc.since) / 24;
    if (!rng.chance(Math.min(0.7, traffic * (1 + age / 10)))) continue;
    if (v.fuel > 0) v.fuel = 0;
    else v.condition -= rng.int(10, 25);
    if (v.condition <= 0) {
      state.vehicles.splice(state.vehicles.indexOf(v), 1);
      if (state.live.has(v.loc.tile)) log(state, `Scavengers stripped the abandoned ${v.name} down to the frame.`, "danger");
    }
  }
}

export { day };
