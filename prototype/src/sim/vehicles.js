// Vehicles: fuel tanks, condition, breakdowns, abandonment and recovery.
import { TERRAIN } from "./data.js";
import { newId, log, day, atBase, skill } from "./world.js";
import { count } from "./buildings.js";
import { hasPerk, gainXp, USE } from "./skills.js";

export const VEHICLE_TYPES = {
  truck: { name: "Pickup truck", tank: 30, capacity: 120 },
  sedan: { name: "Old sedan",    tank: 18, capacity: 60 },
};

export function createVehicle(state, type, loc, opts = {}) {
  const v = {
    id: newId(), type, name: opts.name || VEHICLE_TYPES[type].name,
    fuel: opts.fuel ?? 20, condition: opts.condition ?? 80, loc,
  };
  state.vehicles.push(v);
  return v;
}

export const vehicleById = (state, id) => state.vehicles.find((v) => v.id === id);
export const vehiclesAtBase = (state, baseId) => state.vehicles.filter((v) => v.loc.kind === "base" && v.loc.baseId === baseId);
export const partyVehicle = (state, p) => (p.vehicleId ? vehicleById(state, p.vehicleId) : null);
export const tank = (v) => VEHICLE_TYPES[v.type].tank;
export const vehicleCapacity = (v) => (v ? VEHICLE_TYPES[v.type].capacity : 0);

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

export function breakdownChance(v) {
  return 0.01 + ((100 - v.condition) / 100) * 0.08;
}

export function wear(v, onRoad) {
  v.condition = Math.max(0, v.condition - (onRoad ? 0.25 : 0.9));
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
