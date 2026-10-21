// @ts-check
// Forming a team at a base, and changing a team that stands on one of your bases.
//
// Form a team (the base screen, the Teams tab, a right-click on your base's tile: ui/teamform.js): pick people who are
// at the base, one vehicle (a car, or the base's bikes, one each) or none, what each person wears and carries (moved
// straight from the armory while they are still at the base: sim/inventory.js moveItem, the same as the base's own
// inventory screen), the team's supplies from the stores and items for its cargo. formTeam sends them out through
// launchExpedition (the same checks, packing and weighing as any trip: people at the base, the vehicle there and in
// repair, supplies in stock, weight within what they can carry; spare magazines and, if asked, a light each from the
// armory) with the base's own tile as the destination, then takes the rounds the members' guns and spare magazines show
// in their badges out of the stock as the team's own (gunrounds.js loadoutRounds, 2026-10-18: the window showed them
// full and a raid started them at 0/x), and the team stands on that tile waiting for orders with no
// mission ("Field team"): on the map, in the Teams tab, and with its panel open. From there it is a team like any
// other: Move, every order on the orders card, the team inventory (sim/teaminv.js: drop off and load while it stands
// on a base), Enter base (sim/moveout.js: back in, disbanded).
//
// Edit a team (the same window, for a team of yours that waits on one of your bases' tiles): add people who are at
// that base, send people back into it, swap the vehicle for another parked there (or go on foot), and load or drop off
// gear and supplies (sim/teaminv.js loadFromBase / dropOff, the same weight rules). Every change applies at once and
// is refused when it would leave the team over what it can carry.
//
// Vehicles: up to MAX_VEHICLES (4) to a team (sim/vehicles.js fleets): cars, and the base's bikes as one entry (a bike
// each, or with cars a bike for each person not driving one). Each needs a driver, and with two or more everyone needs
// a seat (fleetProblem); seats, payload and fuel add up, the slowest sets the pace. fleetPlan checks a set of vehicles
// for some number of people; applyFleet hands them over (what the team gives up parks at the base).
//
// AI parity: the other groups do not form standing teams. Their raids, escorts, scavenging parties and caravans are
// raised from their own people and arsenal when they set out (sim/arsenal.js, escorts.js, aiscav.js, caravans.js) and
// move by the numbers (parties.js spawnAiParty); nothing here is on their path, and nothing of theirs is changed.
/** @import { State, Party, Base, Item, Stock } from "./types" */
import { foodIn } from "./foods.js"; // days of food on a team
import { SUPPLIES } from "./data.js";
import { log, baseById, survivorById } from "./world.js";
import { launchExpedition, partyMembers, carryCapacity, supplyLoad, poolLoad, weighTeam, onTheMove } from "./parties.js";
import { vehicleById, partyVehicles, partyFleet, isBike, isCar, parkBikes, createVehicle, vehicleLabel, fleetOf, fleetProblem, setPartyVehicles, MAX_VEHICLES } from "./vehicles.js";
import { itemLoad, parseLoc } from "./inventory.js";
import { teamBase, transferProblem, loadFromBase, dropOff, isPlayerTeam } from "./teaminv.js";
import { reseat } from "./walkers.js";
import { settleHold } from "./carry.js"; // who holds the team's supplies where (kept by the gear snapshot)
import { stockHas } from "./water.js"; // water: purified and un-purified; "ammo": any calibre
import { supRoom, SUP_PLACES, itemKeyOf } from "./supitems.js"; // supplies onto a named member while forming (2026-10-17 rounds, 2026-10-18 any supply)
import { loadoutRounds } from "./gunrounds.js"; // the rounds their guns and magazines leave loaded with, out of the stock (2026-10-18)
import { isRoundKey } from "./rounds.js";

const EPS = 1e-6;
const num = (v) => (Number.isFinite(v) ? v : 0);
const firstName = (s) => s.name.split(" ")[0];
const list = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

// The mission name a formed team goes by until it is given another (parties.js MISSIONS.formed, teamName: "Field team
// (Ann, Bob)").
export const FORMED = "formed";

// ---------- forming ----------
// Armory items picked for the cargo: location strings ("armory:<base>:list:<i>") or the items themselves.
/** @param {Base} base @param {(string | Item)[]} picks @returns {Item[]} */
export function armoryItems(base, picks) {
  const out = [];
  for (const x of picks || []) {
    let it = null;
    if (typeof x === "string") { const L = parseLoc(x); if (L.o === "armory" && L.id === base.id && L.i != null) it = base.armory[L.i] || null; }
    else if (x && base.armory.includes(x)) it = x;
    if (it && !out.includes(it)) out.push(it);
  }
  return out;
}

// The vehicles a team (or a team to be) would have: ids (cars, and the base's bikes as one id) for n people at base;
// p: a team that already has some (its own count as there). { list, cars, bike, bikeN, planned (the bikes as the
// number it takes), fleet (fleetOf planned), problem }.
/** @param {State} state @param {Base} base @param {Party | null} p @param {number[]} ids @param {number} n */
export function fleetPlan(state, base, p, ids, n) {
  const own = p ? partyVehicles(state, p) : [];
  const uniq = [...new Set((ids || []).filter((x) => x != null).map(Number))];
  const list = uniq.map((id) => vehicleById(state, id)).filter(Boolean);
  /** @type {{ list: any[], cars: any[], bike: any, bikeN: number, planned: any[], fleet: any, problem: string }} */
  const out = { list, cars: list.filter((x) => !isBike(x)), bike: list.find(isBike) || null, bikeN: 0, planned: [], fleet: null, problem: "" };
  if (list.length !== uniq.length) { out.problem = "No such vehicle."; return out; }
  if (list.length > MAX_VEHICLES) { out.problem = `At most ${MAX_VEHICLES} vehicles to a team.`; return out; }
  for (const x of list) {
    if (!own.includes(x) && (x.loc.kind !== "base" || x.loc.baseId !== base.id)) { out.problem = `The ${vehicleLabel(x)} is not at ${base.name}.`; return out; }
    if (x.condition <= 0) { out.problem = `The ${vehicleLabel(x)} needs repairs first.`; return out; }
  }
  if (list.filter(isBike).length > 1) { out.problem = "One lot of bikes to a team."; return out; }
  out.bikeN = !out.bike ? 0 : out.cars.length ? Math.max(1, n - out.cars.length) : n;
  if (out.bike) {
    const free = bikesHere(state, base) + own.filter(isBike).reduce((a, x) => a + (x.count || 1), 0);
    if (free < out.bikeN) { out.problem = `Not enough bikes: ${out.bikeN} needed (one each${out.cars.length ? " for those not driving" : ""}), ${free} at ${base.name}.`; return out; }
  }
  out.planned = [...out.cars, ...(out.bike ? [{ ...out.bike, count: out.bikeN }] : [])];
  out.fleet = fleetOf(out.planned);
  out.problem = fleetProblem(out.planned, n);
  return out;
}
// A car with an empty tank and no cans to pour in ("" when every car has fuel). cans: fuel cans packed or carried.
const fuelProblem = (cars, cans) => { const dry = cars.find((x) => isCar(x) && num(x.fuel) < 1); return dry && num(cans) < 1 ? `The ${dry.name} has no fuel: refuel it at the base or pack fuel cans.` : ""; };
// Hands the vehicles over (fleetPlan first): what the team gives up parks at the base, its bikes are parked and the
// number it needs taken again, and the team's list is set (the lead first).
function applyFleet(state, p, base, plan) {
  for (const x of partyVehicles(state, p)) if (isBike(x) || !plan.cars.includes(x)) x.loc = { kind: "base", baseId: base.id };
  parkBikes(state, base);
  let bikes = null;
  if (plan.bike) {
    const stack = parkBikes(state, base);
    if (stack && stack.count >= plan.bikeN) {
      if (stack.count === plan.bikeN) bikes = stack;
      else { stack.count -= plan.bikeN; bikes = createVehicle(state, "bike", { kind: "base", baseId: base.id }, { count: plan.bikeN, condition: stack.condition }); }
    }
  }
  setPartyVehicles(state, p, [...plan.cars, ...(bikes ? [bikes] : [])]);
  p.planVehicle = p.vehicle;
  weighTeam(state, p);
  reseat(state, p); // walkers.js: a seat for those who walked in
}

// What the window shows and formTeam checks before anything moves: { members, v, cap, load, cargoKg, loadout, problem }.
// opts: { baseId, memberIds, vehicleIds (or vehicleId), supplies, cargo, onto }. onto (the first day's name `rounds`
// still works): picks of supplies onto a named member as items (supitems.js suppliesOnto: rounds boxed or loose, water,
// meds, a food, anything with an item form): [{ key, n, sid, where: "pocket" | "pack" | "rig", loose? }], out of the
// stores on top of the supplies; their weight is worn, not carried in the pool (the person's max load counts here, the
// team's carry limit when they go on after the launch: teaminv.js loadFromBase).
// loadout: the rounds the members' guns and spare magazines leave loaded with (gunrounds.js loadoutRounds: what the
// rounds badge shows them holding at the base, out of the stock after the supplies and the round picks), taken as the
// team's own rounds when it forms; they weigh in `load` like any supply.
/** @param {State} state */
export function formPreview(state, opts) {
  const base = baseById(state, opts.baseId);
  const members = [...new Set(opts.memberIds || [])].map((id) => survivorById(state, id)).filter(Boolean);
  const ids = opts.vehicleIds && opts.vehicleIds.length ? opts.vehicleIds : opts.vehicleId ? [opts.vehicleId] : [];
  const plan = base ? fleetPlan(state, base, null, ids, Math.max(1, members.length)) : null;
  const v = plan ? plan.fleet : null;
  const cap = carryCapacity(state, members, v || null);
  /** @type {Stock} */
  const supplies = {};
  for (const [k, q] of Object.entries(opts.supplies || {})) if ((SUPPLIES[k] || k === "food") && num(q) > 0) supplies[k] = q; // food: days of it (packed as items by parties.js launchExpedition)
  const rounds = (opts.onto || opts.rounds || []).filter((r) => r && SUPPLIES[r.key] && itemKeyOf(r.key) && num(r.n) >= 1 && SUP_PLACES.includes(r.where) && members.some((s) => s.id === Number(r.sid))).map((r) => ({ key: r.key, n: Math.floor(r.n), sid: Number(r.sid), where: r.where, loose: !!r.loose }));
  const cargo = base ? armoryItems(base, opts.cargo || []) : [];
  const cargoKg = cargo.reduce((a, it) => a + itemLoad(it), 0);
  const loadout = base ? teamLoadout(members, [base.stock], supplies, rounds) : {};
  const load = supplyLoad(supplies) + cargoKg + supplyLoad(loadout);
  return { base, members, v, plan, cap, load, cargoKg, cargo, supplies, rounds, onto: rounds, loadout, problem: formProblem(state, base, members, plan, supplies, load, cap, rounds) };
}
// The rounds these people's guns and magazines leave loaded with, out of these pools after what is already asked for
// (the supplies by key and the round picks onto members): gunrounds.js loadoutRounds.
/** @param {any[]} members @param {Record<string, number>[]} pools @param {Record<string, number>} [supplies] @param {{ key: string, n: number }[]} [rounds] */
export function teamLoadout(members, pools, supplies = {}, rounds = []) {
  /** @type {Record<string, number>} */
  const less = {};
  for (const [k, q] of Object.entries(supplies || {})) if (isRoundKey(k) && num(q) > 0) less[k] = num(less[k]) + num(q);
  for (const r of rounds || []) if (r && isRoundKey(r.key)) less[r.key] = num(less[r.key]) + num(r.n);
  return loadoutRounds(members, pools, less);
}
// How many rounds a loadout is, all keys together.
/** @param {Record<string, number>} loadout */
export const loadoutCount = (loadout) => Object.values(loadout || {}).reduce((a, q) => a + Math.max(0, Math.floor(num(q))), 0);
function formProblem(state, base, members, plan, supplies, load, cap, rounds = []) {
  const v = plan ? plan.fleet : null;
  if (!base) return "That base is no longer yours.";
  if (state.combat) return "Not during a battle.";
  if (!members.length) return "Pick at least one person.";
  for (const s of members) {
    if (!s.alive) return `${s.name} is ${s.left ? "gone" : "dead"}.`;
    if (!s.location || s.location.kind !== "base" || s.location.baseId !== base.id) return `${s.name} is not at ${base.name}.`;
  }
  if (plan && plan.problem) return plan.problem;
  if (plan && fuelProblem(plan.cars, supplies.fuel)) return fuelProblem(plan.cars, supplies.fuel);
  if (load > cap + EPS) return `Too much to carry: the supplies and cargo weigh ${Math.ceil(load)} kg, ${members.length === 1 ? "they" : "the team"}${v ? ` and the ${vehicleLabel(v)}` : ""} can carry ${Math.floor(cap)} kg on top of what they wear. Take less${v ? "" : ", more people, bikes or a vehicle"}.`;
  /** @type {Record<string, number>} */
  const want = { ...supplies };
  for (const r of rounds) want[r.key] = num(want[r.key]) + r.n; // supplies onto a member come out of the same stores
  for (const [k, q] of Object.entries(want)) {
    const have = num(stockHas(base.stock, k));
    if (have + EPS < q) return `Not enough ${k === "food" ? "food" : SUPPLIES[k].name.toLowerCase()} at ${base.name} (${Math.floor(have)}${k === "food" ? " days" : ""}).`;
  }
  for (const r of rounds) {
    const s = members.find((x) => x.id === r.sid);
    const room = s ? supRoom(s, r.key, r.where, r.loose) : { n: 0, why: "That person is not on the team." };
    if (!room.n) return room.why;
  }
  return "";
}
const bikesHere = (state, base) => state.vehicles.filter((x) => isBike(x) && x.loc.kind === "base" && x.loc.baseId === base.id).reduce((a, x) => a + (x.count || 1), 0);

// Forms the team. opts: { baseId, memberIds, vehicleId, supplies: { key: qty }, cargo: [armory items or locations],
// stance, lights (a light each from the armory, default false: the window sets gear itself), tabs }.
// Returns { party, notes: [text] } or { error }.
/** @param {State} state */
export function formTeam(state, opts) {
  const pre = formPreview(state, opts);
  if (pre.problem) return { error: pre.problem };
  const base = /** @type {Base} */ (pre.base);
  const res = launchExpedition(state, {
    memberIds: pre.members.map((s) => s.id), dest: base.tile, mission: "move", stance: opts.stance || "normal",
    vehicleId: pre.plan && pre.plan.list.length === 1 ? pre.plan.list[0].id : null, vehicleIds: pre.plan && pre.plan.list.length > 1 ? pre.plan.list.map((x) => x.id) : [],
    supplies: { ...pre.supplies }, fromBaseId: base.id, lights: !!opts.lights, tabs: !!opts.tabs, quiet: true, loadout: false, // (the loadout below: the rounds the window showed)
  });
  if (res.error) return { error: res.error };
  const p = res.party;
  // On the base's own tile, waiting: nothing planned (as a team moved out with nowhere picked, moveout.js).
  p.teamMission = FORMED;
  p.phase = "waiting";
  p.path = [base.tile];
  p.idx = 0;
  p.progress = 0;
  p.dest = base.tile;
  p.planPath = [base.tile];
  p.etaOut = 0;
  p.etaBack = null;
  const notes = [];
  if (pre.cargo.length) {
    const r = loadFromBase(state, p, { items: pre.cargo }, "cargo");
    notes.push(...r.refused);
  }
  for (const r of pre.rounds) { // supplies onto a named member (teaminv.js loadFromBase with a person target): what has no room stays in the stores
    const got = loadFromBase(state, p, { supplies: { [r.key]: r.n } }, { sid: r.sid, where: r.where, loose: r.loose });
    notes.push(...got.refused);
  }
  if (loadoutCount(pre.loadout) > 0) { // their guns and magazines leave loaded (gunrounds.js): the rounds the window showed in them, as the team's own
    const got = loadFromBase(state, p, { supplies: pre.loadout });
    notes.push(...got.refused);
  }
  weighTeam(state, p);
  const v = partyFleet(state, p);
  log(state, `${list(partyMembers(state, p).map(firstName))} formed a team at ${base.name}${isBike(v) ? " on bikes" : v ? ` with the ${vehicleLabel(v)}` : ""}. It waits outside for orders.`, "info");
  return { party: p, notes };
}

// ---------- editing a team at a base ----------
// The base of yours a team can be changed at: it stands on that base's tile, stopped (waiting for orders), an
// expedition of yours (not a convoy, a caravan or a crew). Null otherwise.
/** @param {State} state @param {Party} p @returns {Base | null} */
export function editBase(state, p) {
  if (!isPlayerTeam(p) || p.kind !== "expedition" || p.caravan || p.crewRole != null || p.envoy != null) return null; // envoys.js: an envoy is not changed
  if (p.phase !== "waiting" || onTheMove(p)) return null;
  return teamBase(state, p);
}
// Why the team cannot be changed now ("" when it can).
/** @param {State} state @param {Party} p */
export function editProblem(state, p) {
  if (!p || !state.parties.includes(p)) return "That team is gone.";
  if (p.envoy != null) return "An envoy is on its errand: it cannot be changed."; // envoys.js
  if (!isPlayerTeam(p) || p.kind !== "expedition" || p.caravan || p.crewRole != null) return "Only your own teams can be changed at a base.";
  if (!teamBase(state, p)) return "The team is not on one of your bases' tiles.";
  if (p.phase !== "waiting" || onTheMove(p)) return "The team is busy: stop it (or let it finish) first.";
  return transferProblem(state, p);
}
// Your teams that can be changed at this base now.
/** @param {State} state @param {Base} base */
export const editableTeams = (state, base) => state.parties.filter((p) => editBase(state, p) === base && !editProblem(state, p));

// One more person from the base. Bikes: one more bike from the base's stack.
/** @param {State} state @param {Party} p @param {number} sid */
export function addMember(state, p, sid) {
  const why = editProblem(state, p);
  if (why) return why;
  const base = /** @type {Base} */ (teamBase(state, p));
  const s = survivorById(state, Number(sid));
  if (!s || !s.alive) return "Nobody by that name.";
  if (!s.location || s.location.kind !== "base" || s.location.baseId !== base.id) return `${s.name} is not at ${base.name}.`;
  // Its vehicles for one more: a bike more when it rides bikes, a seat when it has two or more vehicles.
  const plan = fleetPlan(state, base, p, partyVehicles(state, p).map((x) => x.id), partyMembers(state, p).length + 1);
  if (plan.problem) return plan.bike && /bikes/.test(plan.problem) ? `No bike for ${firstName(s)}: ${plan.problem}` : `No room for ${firstName(s)}: ${plan.problem}`;
  const loadout = teamLoadout([s], [base.stock]); // their guns and magazines leave loaded (gunrounds.js loadoutRounds), as when the team formed
  p.members.push(s.id);
  s.location = { kind: "party", partyId: p.id };
  applyFleet(state, p, base, plan);
  const got = loadoutCount(loadout) > 0 ? loadFromBase(state, p, { supplies: loadout }) : null;
  return `${firstName(s)} joins the team.${got && got.refused.length ? ` ${got.refused.join(" ")}` : ""}`;
}

// One person goes back into the base (what they wear goes with them). Not the last one: Enter base disbands the team.
// Refused when those left could not carry the team's load.
/** @param {State} state @param {Party} p @param {number} sid */
export function removeMember(state, p, sid) {
  const why = editProblem(state, p);
  if (why) return why;
  const base = /** @type {Base} */ (teamBase(state, p));
  const s = survivorById(state, Number(sid));
  if (!s || !(p.members || []).includes(s.id)) return "That person is not on the team.";
  const left = partyMembers(state, p).filter((m) => m !== s);
  if (!left.length) return `${firstName(s)} is the last one on the team: use Enter ${base.name} to bring the whole team in.`;
  // Every car still needs a driver (vehicles.js fleetProblem); a bike fewer when it rides bikes.
  const plan = fleetPlan(state, base, p, partyVehicles(state, p).map((x) => x.id), left.length);
  if (plan.problem) return `Without ${firstName(s)}: ${plan.problem} Leave a vehicle at the base first.`;
  const cap = carryCapacity(state, left, plan.fleet || null);
  if (poolLoad(p) > cap + EPS) return `Without ${firstName(s)} the team could not carry its load (${Math.round(poolLoad(p))} kg on ${Math.floor(cap)} kg). Drop off some supplies or cargo first.`;
  const loadout = teamLoadout([s], [p.supplies || {}, (p.cargo && p.cargo.supplies) || {}]); // what their guns and magazines hold of the team's rounds goes back in with them
  p.members = p.members.filter((id) => id !== s.id);
  s.location = { kind: "base", baseId: base.id };
  applyFleet(state, p, base, plan);
  if (loadoutCount(loadout) > 0) dropOff(state, p, { supplies: loadout });
  return `${firstName(s)} goes back into ${base.name}.`;
}

// The team's vehicles from now on: ids of vehicles it has or that are parked at the base (cars, and the base's bikes as
// one), up to MAX_VEHICLES; [] goes on foot. What it gives up parks at the base. Refused when it would be left over what
// it can carry, a car has no fuel (and none is carried), a car has no driver or someone no seat.
/** @param {State} state @param {Party} p @param {number[]} ids */
export function setVehicles(state, p, ids) {
  const why = editProblem(state, p);
  if (why) return why;
  const base = /** @type {Base} */ (teamBase(state, p));
  const members = partyMembers(state, p);
  const old = partyVehicles(state, p);
  const plan = fleetPlan(state, base, p, ids, members.length);
  if (plan.problem) return plan.problem;
  const fresh = plan.cars.filter((x) => !old.includes(x));
  const fp = fuelProblem(fresh, teamHas(p, "fuel"));
  if (fp) return fp.replace("pack fuel cans", "load fuel cans first");
  const cap = carryCapacity(state, members, plan.fleet || null);
  if (poolLoad(p) > cap + EPS) return `${plan.fleet ? `With the ${vehicleLabel(plan.fleet)}` : "On foot"} the team could not carry its load (${Math.round(poolLoad(p))} kg on ${Math.floor(cap)} kg). Drop off some supplies or cargo first.`;
  const before = old.length ? vehicleLabel(fleetOf(old)) : "";
  applyFleet(state, p, base, plan);
  const now = partyFleet(state, p);
  return now ? `The team now has the ${vehicleLabel(now)}${before && before !== vehicleLabel(now) ? ` (was: ${before})` : ""}.` : `The team goes on foot; the ${before || "vehicle"} stay${old.length > 1 ? "" : "s"} at ${base.name}.`;
}
// One vehicle, or none: the same as setVehicles([id]).
/** @param {State} state @param {Party} p @param {number | null} vehicleId */
export const setVehicle = (state, p, vehicleId) => setVehicles(state, p, vehicleId ? [vehicleId] : []);
// A vehicle on or off the team (the window's buttons): one more, or one fewer. Bikes: the team's own lot and the
// base's lot are the same choice.
/** @param {State} state @param {Party} p @param {number} vehicleId */
export function toggleVehicle(state, p, vehicleId) {
  const own = partyVehicles(state, p);
  const v = vehicleById(state, Number(vehicleId));
  if (!v) return "No such vehicle.";
  const mine = own.includes(v) || (isBike(v) && own.some(isBike));
  const next = mine ? own.filter((x) => x !== v && !(isBike(v) && isBike(x))).map((x) => x.id) : [...own.map((x) => x.id), v.id];
  return setVehicles(state, p, next);
}

// What the team carries of a supply (packed and found).
/** @param {Party} p @param {string} k */
export const teamHas = (p, k) => (k === "food" ? foodIn(p.supplies || {}) + foodIn((p.cargo && p.cargo.supplies) || {}) : num(p.supplies && p.supplies[k]) + num(p.cargo && p.cargo.supplies && p.cargo.supplies[k])); // food: days of it (foods.js)
// Sets how much of a supply the team carries: more is loaded from the base's stores (as much as it can carry),
// less is dropped off into them. Returns the line to show.
/** @param {State} state @param {Party} p @param {string} k @param {number} qty */
export function setSupply(state, p, k, qty) {
  const why = editProblem(state, p);
  if (why) return why;
  if (!SUPPLIES[k] && k !== "food") return "Unknown supply."; // food: days of it (teaminv.js loads and drops the items)
  const want = Math.max(0, num(Number(qty)));
  const have = teamHas(p, k);
  if (Math.abs(want - have) < EPS) return "";
  const r = want > have ? loadFromBase(state, p, { supplies: { [k]: want - have } }, "cargo") : dropOff(state, p, { supplies: { [k]: have - want } });
  return r.text;
}


// ---------- keep or undo the gear changes made in the window ----------
// A snapshot of everything the window can move (ui/teamform.js takes it when it opens): the base's armory, stores and
// repair queue, every person at the base and on the team (worn, held, pockets), the team's packed and found supplies
// and its cargo, and every item in any of them (its own fields: a pack's or rig's contents, a carrier's plates, a gun's
// attachments, a magazine's load, wear). restoreGear puts it all back exactly as it was (the same item objects in the
// same places); gearChanged says whether anything differs. People joining or leaving the team and its vehicles are not
// part of it (they are not gear). What is in someone's arms as a whole bag (s.gear.carry, sim/carry.js) is in their
// gear; where each unit of the team's supplies is held (p.hold: pockets, packs, arms, the vehicle) is kept as it was too.
const props = (o) => { const out = {}; for (const k of Object.keys(o)) { const v = o[k]; out[k] = Array.isArray(v) ? v.slice() : v && typeof v === "object" && !v.key ? { ...v } : v; } return out; };
function holders(state, base, p) {
  const people = [...new Set([...state.survivors.filter((s) => s.alive && s.location && s.location.kind === "base" && s.location.baseId === base.id), ...(p ? partyMembers(state, p) : [])])];
  /** @type {any[]} */
  const lists = [base.armory, base.gearRepairs || (base.gearRepairs = [])];
  /** @type {any[]} */
  const objs = [base.stock];
  for (const s of people) { lists.push(s.pockets); objs.push(s.gear); }
  if (p) { p.cargo = p.cargo || { supplies: {}, gear: [] }; lists.push(p.cargo.gear); objs.push(p.supplies, p.cargo.supplies); }
  return { people, lists, objs };
}
function itemsIn(h) {
  const seen = new Set();
  const walk = (it) => {
    if (!it || typeof it !== "object" || !it.key || seen.has(it)) return;
    seen.add(it);
    for (const c of it.contents || []) walk(c);
    for (const c of Object.values(it.inserts || {})) walk(c);
    for (const c of Object.values(it.mods || {})) walk(c);
  };
  for (const l of h.lists) for (const x of l) walk(x && x.item && !x.key ? x.item : x); // a repair job holds its item
  for (const o of h.objs) for (const x of Object.values(o)) walk(x);
  return [...seen];
}
/** @param {State} state @param {Base} base @param {Party | null} [p] */
export function gearSnapshot(state, base, p = null) {
  const h = holders(state, base, p);
  if (p) settleHold(state, p); // settled first, so a reader settling it later is not taken for a change
  return { baseId: base.id, partyId: p ? p.id : null, hold: p ? holdCopy(p.hold) : null, lists: h.lists.map((l) => [l, l.slice()]), objs: h.objs.map((o) => [o, { ...o }]), items: itemsIn(h).map((it) => [it, props(it)]) };
}
// p.hold (sim/carry.js) is plain numbers in nested records: a deep copy, and a key-order-free form to compare.
const holdCopy = (h) => (h && typeof h === "object" ? JSON.parse(JSON.stringify(h)) : null);
const holdKey = (h) => {
  const canon = (o) => (o && typeof o === "object" ? Object.keys(o).sort().map((k) => { const v = canon(o[k]); return v === "" || v === "{}" ? "" : `${k}:${v}`; }).filter(Boolean).join(",").replace(/^(.*)$/, "{$1}") : typeof o === "number" ? (Math.abs(o) < 1e-9 ? "" : String(Math.round(o * 1e6) / 1e6)) : String(o ?? ""));
  return canon(h || {});
};
const sameVal = (a, b) => (typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 1e-9 : a === b);
const sameArr = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameVal(x, b[i]));
const sameObj = (a, b) => { const ks = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]); for (const k of ks) { const x = a ? a[k] : undefined, y = b ? b[k] : undefined; if (!(sameVal(x, y) || ((x == null || x === 0) && (y == null || y === 0)))) return false; } return true; };
// True when anything in the snapshot is not as it was.
export function gearChanged(state, snap) {
  if (!snap) return false;
  const tp = snap.partyId != null ? state.parties.find((x) => x.id === snap.partyId) : null;
  if (tp && holdKey(tp.hold) !== holdKey(snap.hold)) return true; // a load moved between pockets, packs, arms and the vehicle
  for (const [l, was] of snap.lists) if (!sameArr(l, was)) return true;
  for (const [o, was] of snap.objs) if (!sameObj(o, was)) return true;
  for (const [it, was] of snap.items) {
    const now = props(it);
    const ks = new Set([...Object.keys(now), ...Object.keys(was)]);
    for (const k of ks) {
      const a = now[k], b = was[k];
      if (Array.isArray(a) || Array.isArray(b)) { if (!sameArr(a, b)) return true; }
      else if (a && typeof a === "object" && !a.key) { if (!sameObj(a, b)) return true; }
      else if (!sameVal(a, b)) return true;
    }
  }
  return false;
}
// Everything back as it was. Returns a line for the window (with a warning when the team is now over what it can carry:
// its people or vehicles changed since).
export function restoreGear(state, snap) {
  if (!snap) return "";
  for (const [l, was] of snap.lists) l.splice(0, l.length, ...was);
  for (const [o, was] of snap.objs) { for (const k of Object.keys(o)) if (!(k in was)) delete o[k]; Object.assign(o, was); }
  for (const [it, was] of snap.items) {
    for (const k of Object.keys(it)) if (!(k in was)) delete it[k];
    for (const [k, v] of Object.entries(was)) {
      if (Array.isArray(v) && Array.isArray(it[k])) it[k].splice(0, it[k].length, ...v);
      else if (v && typeof v === "object" && !v.key && it[k] && typeof it[k] === "object") { for (const kk of Object.keys(it[k])) if (!(kk in v)) delete it[k][kk]; Object.assign(it[k], v); }
      else it[k] = Array.isArray(v) ? v.slice() : v && typeof v === "object" && !v.key ? { ...v } : v;
    }
  }
  const p = snap.partyId != null ? state.parties.find((x) => x.id === snap.partyId) : null;
  if (p) { if (snap.hold) p.hold = holdCopy(snap.hold); else delete p.hold; } // who held what, as it was (sim/carry.js)
  if (p) weighTeam(state, p);
  const over = p ? poolLoad(p) - carryCapacity(state, partyMembers(state, p), partyFleet(state, p)) : 0;
  return `Gear and supplies are back as they were.${over > EPS ? ` The team is now ${Math.ceil(over)} kg over what it can carry (its people or vehicles changed since): drop something off or take a vehicle.` : ""}`;
}

// ---------- the planners' vehicles (ui/fleetpick.js: the Form window, the trip planner, the move-out planner) ----------
// The vehicles a planner means for n people from a base: null, one vehicle (bikes as one each), or a fleet (fleetPlan).
/** @param {State} state @param {Base | null} base @param {number[]} ids @param {number} n */
export function plannedFleet(state, base, ids, n) {
  const list = [...new Set((ids || []).filter((x) => x != null).map(Number))];
  if (!list.length) return null;
  if (list.length === 1) { const v = vehicleById(state, list[0]); return v && isBike(v) ? { ...v, count: Math.max(1, n) } : v || null; }
  return base ? fleetPlan(state, base, null, list, Math.max(1, n)).fleet : null;
}
// Why these vehicles cannot go with n people from the base ("" when they can): the cap, a person to each, a seat each,
// enough bikes, every car with fuel in its tank or cans packed. cans: fuel cans packed.
/** @param {State} state @param {Base | null} base @param {number[]} ids @param {number} n @param {number} [cans] */
export function pickProblem(state, base, ids, n, cans = 0) {
  if (!base || !(ids || []).length) return "";
  const plan = fleetPlan(state, base, null, ids, Math.max(1, n));
  return plan.problem || fuelProblem(plan.cars, cans);
}
