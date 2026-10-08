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
import { TERRAIN } from "./data.js";
import { newId, log, day, atBase, skill } from "./world.js";
import { count } from "./buildings.js";
import { hasPerk, gainXp, USE } from "./skills.js";

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
export const typeSpeed = (v) => (v && VEHICLE_TYPES[v.type] ? VEHICLE_TYPES[v.type].speed ?? 1 : 1);
export const typeFuel = (v) => (v && VEHICLE_TYPES[v.type] ? VEHICLE_TYPES[v.type].fuel ?? 1 : 1);
export const typeOffroad = (v) => (v && VEHICLE_TYPES[v.type] ? VEHICLE_TYPES[v.type].offroad ?? 1 : 1);
export const isLoud = (v) => !!(v && VEHICLE_TYPES[v.type] && VEHICLE_TYPES[v.type].loud);

export const isBike = (v) => !!v && v.type === "bike";
export const isCar = (v) => !!v && !!VEHICLE_TYPES[v.type]?.motor;
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
export const partyVehicle = (state, p) => (p.vehicleId ? vehicleById(state, p.vehicleId) : null);
export const tank = (v) => VEHICLE_TYPES[v.type].tank;
// Cargo a vehicle adds to a team: a car's payload, a stack of bikes' racks.
export const vehicleCapacity = (v) => (!v ? 0 : isBike(v) ? (v.count || 1) * VEHICLE_TYPES.bike.rack : VEHICLE_TYPES[v.type].payload);
export const vehicleLabel = (v) => (isBike(v) ? `${v.count || 1} bicycle${(v.count || 1) === 1 ? "" : "s"}` : v.name);

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
export function partyFuel(state, p) {
  const v = partyVehicle(state, p);
  return (v ? v.fuel : 0) + (p.supplies.fuel || 0);
}

export function useFuel(state, p, amount) {
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
  return (0.01 + ((100 - v.condition) / 100) * 0.08) * (fill > 1 ? OVERLOAD_WEAR : 1);
}

export function wear(v, onRoad, fill = 0) {
  const w = isBike(v) ? (onRoad ? 0.1 : 0.4) : (onRoad ? 0.25 : 0.9) * (fill > 1 ? OVERLOAD_WEAR : 1);
  v.condition = Math.max(0, v.condition - w);
}

// The team leaves the vehicle where it stopped; it becomes a marker they know about.
export function abandonVehicle(state, p, tile, reason) {
  const v = partyVehicle(state, p);
  if (!v) return;
  v.loc = { kind: "abandoned", tile, since: state.hour };
  p.vehicle = false;
  p.vehicleId = null;
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

export function repair(state, base, v) {
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
  if ((base.stock.parts || 0) < 1) return "Needs 1 part.";
  if (v.condition >= 100) return "Already in top shape.";
  base.stock.parts -= 1;
  v.condition = Math.min(100, v.condition + r.per);
  const mech = atBase(state, base.id).sort((a, b) => skill(b, "mechanics") - skill(a, "mechanics"))[0];
  if (mech) gainXp(state, mech, "mechanics", USE.repair); // skills.js
  return `Repaired the ${v.name} to ${Math.round(v.condition)}%.`;
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
