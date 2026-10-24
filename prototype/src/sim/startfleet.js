// @ts-check
// Starting vehicles and what is in their backs (2026-10-24, user request: "add a new customize to the starting
// vehicle(s): you can set how many, which kind of vehicle and what items are loaded in the vehicle. The items can be any
// item and material in the game. You can set a point limit for each vehicle and hit random to fill the vehicle with
// items up to that point limit. Make this how to set vehicles in normal and hardcore mode").
// - The new-run screen's Starting vehicles (ui/startgear.js fleetSection), shown while Start with a vehicle is on, in
//   every mode: a list of { type, limit, load } kept per mode on the screen (main.js ui.fleet, ui.modeSets[mode].fleet)
//   and handed to createWorld as its `fleet` option, kept as state.fleet while the new-run screen is up (each entry
//   with vid: the vehicle made for it, null with Start with a vehicle off). Start (startgear.js clearStartGear) takes it off.
//     Normal: one vehicle, the hub's pickup truck. Hardcore: one, the car the team flees in (its kind as the dice
//     roll it: type null here, the rolled kind on state.fleet). Custom (custommode.js): COUNT vehicles, each a kind of
//     its own (fleetKinds: every motor vehicle; no bicycles), all parked at the hub.
//   limit: the vehicle's own point limit (LIMIT by default, MIN–MAX); its load is priced as any back
//     (custompoints.js vehiclePoints) against it, not on any colonist's points.
//   load: null, as rolled (a normal or Custom start's vehicles come empty; Hardcore's car back is what the dice put in
//     it: hardcore-start.js rollCar), or the back set by hand or by its Random ({ items, supplies }: startgear.js
//     sanitizeStartVehicle; a Custom back takes any thing and any material, START_TRUNK's caps lifted).
// - Its weight is held to the vehicle's room (fleetRoom: its payload; Hardcore, less the riders and what they wear).
// - Start is refused while a load is over its limit or its room (fleetText, main.js begin).
// - The world: a normal or Custom start's vehicles at the hub, each back unloaded into the hub's armory and stores on day
//   1 (startgear.js normalStartVehicle); Hardcore's load in place of the dice's back (startgear.js trunkFromPicks).
// - Ironman: the loads stay as rolled (main.js hands createWorld none).
import { VEHICLE_TYPES, RIDER_KG } from "./vehicles.js";
import { wornLoad } from "./load.js";
import { sanitizeStartVehicle, trunkKg } from "./startgear.js";
import { vehiclePoints } from "./custompoints.js";
import { isCustomRun } from "./custommode.js";

export const START_FLEET = {
  LIMIT: 60, MIN: 0, MAX: 1000, STEP: 5, // a vehicle's point limit: 60 by default (a back of supplies and a few good things)
  COUNT: { MIN: 1, MAX: 12, DEF: 1 }, // Custom: how many vehicles at the hub
  KIND: "truck", // a normal start's (and a new Custom vehicle's) kind: the pickup truck
  FUEL: 20, CONDITION: 75, // the hub's vehicles' tank (at most a full one) and condition, as the normal start's pickup
};
// The kinds a Custom vehicle may be: every motor vehicle (vehicles.js VEHICLE_TYPES), no bicycles.
export const fleetKinds = () => Object.keys(VEHICLE_TYPES).filter((k) => k !== "bike" && VEHICLE_TYPES[k].motor);

/** A point limit made safe (its default when not a number). @param {any} v */
export function clampLimit(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? Math.max(START_FLEET.MIN, Math.min(START_FLEET.MAX, n)) : START_FLEET.LIMIT;
}
/** Custom's count made safe. @param {any} v */
export function clampFleetCount(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(START_FLEET.COUNT.MIN, Math.min(START_FLEET.COUNT.MAX, n)) : START_FLEET.COUNT.DEF;
}

/** The new-run screen's mode for a world's fleet: "custom", "hardcore" or "normal". @param {any} state */
export const fleetMode = (state) => (isCustomRun(state) ? "custom" : state && state.mode === "hardcore" ? "hardcore" : "normal");

/**
 * A fleet made safe for a mode: Normal and Hardcore exactly one vehicle (the pickup; Hardcore's kind as rolled: null),
 * Custom 1–12 of the kinds fleetKinds lists. Each its limit and its load (null: as rolled).
 * @param {any} raw @param {string} mode "normal" | "hardcore" | "custom"
 * @returns {{ type: string | null, limit: number, load: { items: any[], supplies: Record<string, number> } | null }[]}
 */
export function cleanFleet(raw, mode) {
  const list = Array.isArray(raw) ? raw : [];
  const custom = mode === "custom";
  const n = custom ? clampFleetCount(list.length || START_FLEET.COUNT.DEF) : 1;
  const kinds = fleetKinds();
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = list[i] && typeof list[i] === "object" ? list[i] : {};
    const type = mode === "hardcore" ? null : custom && kinds.includes(r.type) ? r.type : START_FLEET.KIND;
    out.push({ type, limit: clampLimit(r.limit), load: r.load ? sanitizeStartVehicle(r.load, custom) : null });
  }
  return out;
}
/** @param {string} mode */
export const defaultFleet = (mode) => cleanFleet(null, mode);
// Custom's Vehicles box: the first n kept, new ones a pickup with the default limit, as rolled.
/** @param {any[]} fleet @param {number} n */
export function resizeFleet(fleet, n) {
  const list = (fleet || []).slice(0, clampFleetCount(n));
  while (list.length < clampFleetCount(n)) list.push({ type: START_FLEET.KIND, limit: START_FLEET.LIMIT, load: null });
  return cleanFleet(list, "custom");
}

// ---------- on the world (state.fleet) ----------
/** @param {any} state @param {number} i */
export const fleetEntry = (state, i) => (state && Array.isArray(state.fleet) ? state.fleet[i] || null : null);
/** The vehicle made for entry i (null: none, Start with a vehicle off). @param {any} state @param {number} i */
export function fleetVehicle(state, i) {
  const f = fleetEntry(state, i);
  return f && f.vid != null ? (state.vehicles || []).find((v) => v.id === f.vid) || null : null;
}
/** Its back is open to any thing and material (Custom). @param {any} state */
export const openLoads = (state) => isCustomRun(state);
/**
 * Room in its back (kg): its payload; Hardcore, less the riders and what they wear (they ride in it too).
 * @param {any} state @param {number} i
 */
export function fleetRoom(state, i) {
  const v = fleetVehicle(state, i);
  const T = v && VEHICLE_TYPES[v.type];
  if (!T) return 0;
  const riders = state.mode === "hardcore" ? (state.survivors || []).reduce((a, s) => a + RIDER_KG + wornLoad(s), 0) : 0;
  return Math.max(0, Math.round((T.payload || 0) - riders));
}
/**
 * Its name on the screen: "The hub's pickup truck", "Ana's old sedan", "Vehicle 2 (SUV)".
 * @param {any} state @param {number} i
 */
export function fleetName(state, i) {
  const v = fleetVehicle(state, i), f = fleetEntry(state, i);
  const type = (v && v.type) || (f && f.type) || START_FLEET.KIND;
  const T = VEHICLE_TYPES[type] || VEHICLE_TYPES.truck;
  const mode = fleetMode(state);
  if (mode === "hardcore") {
    const id = state.hardcore && state.hardcore.start ? state.hardcore.start.carOwner : null;
    const o = (state.survivors || []).find((s) => s.id === id);
    return o ? `${String(o.name).split(" ")[0]}'s ${T.name.toLowerCase()}` : `The ${T.name.toLowerCase()}`;
  }
  if (mode === "custom") return `Vehicle ${i + 1} (${T.name})`;
  return `The hub's ${T.name.toLowerCase()}`;
}
/**
 * What is wrong with the loads, for Start: [{ i, name, text }] (a load over its point limit or its room).
 * @param {any} state
 */
export function fleetProblems(state) {
  const out = [];
  (state && state.fleet ? state.fleet : []).forEach((/** @type {any} */ f, /** @type {number} */ i) => {
    if (!f || f.vid == null || !f.load) return;
    const name = fleetName(state, i), pts = vehiclePoints(f.load), kg = trunkKg(f.load), room = fleetRoom(state, i);
    if (pts > f.limit) out.push({ i, name, text: `${name}'s back costs ${pts} points, over its limit of ${f.limit}` });
    if (kg > room + 1e-9) out.push({ i, name, text: `${name}'s back weighs ${kg} kg, more than its room (${room} kg)` });
  });
  return out;
}
/** Start's refusal, or "". @param {any} state */
export function fleetText(state) {
  const list = fleetProblems(state);
  if (!list.length) return "";
  return `${list.map((x) => x.text).join("; ")}. Take something out of it (Starting vehicles: Edit… or Empty) or raise its Point limit to start.`;
}
