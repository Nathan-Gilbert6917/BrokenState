// @ts-check
// Forming a team at a base, and changing a team that stands on one of your bases.
//
// Form a team (the base screen, the Teams tab, a right-click on your base's tile: ui/teamform.js): pick people who are
// at the base, one vehicle (a car, or the base's bikes, one each) or none, what each person wears and carries (moved
// straight from the armory while they are still at the base: sim/inventory.js moveItem, the same as the base's own
// inventory screen), the team's supplies from the stores and items for its cargo. formTeam sends them out through
// launchExpedition (the same checks, packing and weighing as any trip: people at the base, the vehicle there and in
// repair, supplies in stock, weight within what they can carry; spare magazines and, if asked, a light each from the
// armory) with the base's own tile as the destination, and the team stands on that tile waiting for orders with no
// mission ("Field team"): on the map, in the Teams tab, and with its panel open. From there it is a team like any
// other: Move, every order on the orders card, the team inventory (sim/teaminv.js: drop off and load while it stands
// on a base), Enter base (sim/moveout.js: back in, disbanded).
//
// Edit a team (the same window, for a team of yours that waits on one of your bases' tiles): add people who are at
// that base, send people back into it, swap the vehicle for another parked there (or go on foot), and load or drop off
// gear and supplies (sim/teaminv.js loadFromBase / dropOff, the same weight rules). Every change applies at once and
// is refused when it would leave the team over what it can carry.
//
// One vehicle per team: a party has one vehicleId, and its fuel, wear, breakdowns, a battle's vehicle, abandoning it
// and recovering it all go through that one (sim/vehicles.js partyVehicle). Bikes are one stack with a count, one
// each. Several cars together are several teams.
//
// AI parity: the other groups do not form standing teams. Their raids, escorts, scavenging parties and caravans are
// raised from their own people and arsenal when they set out (sim/arsenal.js, escorts.js, aiscav.js, caravans.js) and
// move by the numbers (parties.js spawnAiParty); nothing here is on their path, and nothing of theirs is changed.
/** @import { State, Party, Base, Item, Stock } from "./types" */
import { SUPPLIES } from "./data.js";
import { log, baseById, survivorById } from "./world.js";
import { launchExpedition, partyMembers, carryCapacity, supplyLoad, poolLoad, weighTeam, onTheMove } from "./parties.js";
import { vehicleById, partyVehicle, isBike, isCar, travelMode, parkBikes, createVehicle, vehicleLabel } from "./vehicles.js";
import { itemLoad, parseLoc } from "./inventory.js";
import { teamBase, transferProblem, loadFromBase, dropOff, isPlayerTeam } from "./teaminv.js";
import { stockHas } from "./water.js"; // water: purified and un-purified; "ammo": any calibre

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

// What the window shows and formTeam checks before anything moves: { members, v, cap, load, cargoKg, problem }.
// opts: { baseId, memberIds, vehicleId, supplies, cargo }.
/** @param {State} state */
export function formPreview(state, opts) {
  const base = baseById(state, opts.baseId);
  const members = [...new Set(opts.memberIds || [])].map((id) => survivorById(state, id)).filter(Boolean);
  const raw = opts.vehicleId ? vehicleById(state, opts.vehicleId) : null;
  const v = isBike(raw) ? { ...raw, count: Math.max(1, members.length) } : raw;
  const cap = carryCapacity(state, members, v || null);
  /** @type {Stock} */
  const supplies = {};
  for (const [k, q] of Object.entries(opts.supplies || {})) if (SUPPLIES[k] && num(q) > 0) supplies[k] = q;
  const cargo = base ? armoryItems(base, opts.cargo || []) : [];
  const cargoKg = cargo.reduce((a, it) => a + itemLoad(it), 0);
  const load = supplyLoad(supplies) + cargoKg;
  return { base, members, v, cap, load, cargoKg, cargo, supplies, problem: formProblem(state, base, members, raw, supplies, load, cap) };
}
function formProblem(state, base, members, v, supplies, load, cap) {
  if (!base) return "That base is no longer yours.";
  if (state.combat) return "Not during a battle.";
  if (!members.length) return "Pick at least one person.";
  for (const s of members) {
    if (!s.alive) return `${s.name} is ${s.left ? "gone" : "dead"}.`;
    if (!s.location || s.location.kind !== "base" || s.location.baseId !== base.id) return `${s.name} is not at ${base.name}.`;
  }
  if (v) {
    if (v.loc.kind !== "base" || v.loc.baseId !== base.id) return `The ${vehicleLabel(v)} is not at ${base.name}.`;
    if (v.condition <= 0) return `The ${vehicleLabel(v)} needs repairs first.`;
    if (isBike(v)) {
      const have = bikesHere(state, base);
      if (have < members.length) return `Not enough bikes: ${members.length} people, ${have} at ${base.name} (one each).`;
    } else if (isCar(v) && num(v.fuel) + num(supplies.fuel) < 1) return `The ${v.name} has no fuel: refuel it at the base or pack fuel cans.`;
  }
  if (load > cap + EPS) return `Too much to carry: the supplies and cargo weigh ${Math.ceil(load)} kg, ${members.length === 1 ? "they" : "the team"}${v ? ` and the ${vehicleLabel(isBike(v) ? { ...v, count: members.length } : v)}` : ""} can carry ${Math.floor(cap)} kg on top of what they wear. Take less${v ? "" : ", more people, bikes or a vehicle"}.`;
  for (const [k, q] of Object.entries(supplies)) {
    const have = num(stockHas(base.stock, k));
    if (have + EPS < q) return `Not enough ${SUPPLIES[k].name.toLowerCase()} at ${base.name} (${Math.floor(have)}).`;
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
    memberIds: pre.members.map((s) => s.id), dest: base.tile, mission: "move", stance: opts.stance || "normal", vehicleId: opts.vehicleId || null,
    supplies: { ...pre.supplies }, fromBaseId: base.id, lights: !!opts.lights, tabs: !!opts.tabs, quiet: true,
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
  weighTeam(state, p);
  const v = partyVehicle(state, p);
  log(state, `${list(partyMembers(state, p).map(firstName))} formed a team at ${base.name}${isBike(v) ? " on bikes" : v ? ` with the ${v.name}` : ""}. It waits outside for orders.`, "info");
  return { party: p, notes };
}

// ---------- editing a team at a base ----------
// The base of yours a team can be changed at: it stands on that base's tile, stopped (waiting for orders), an
// expedition of yours (not a convoy, a caravan or a crew). Null otherwise.
/** @param {State} state @param {Party} p @returns {Base | null} */
export function editBase(state, p) {
  if (!isPlayerTeam(p) || p.kind !== "expedition" || p.caravan || p.crewRole != null) return null;
  if (p.phase !== "waiting" || onTheMove(p)) return null;
  return teamBase(state, p);
}
// Why the team cannot be changed now ("" when it can).
/** @param {State} state @param {Party} p */
export function editProblem(state, p) {
  if (!p || !state.parties.includes(p)) return "That team is gone.";
  if (!isPlayerTeam(p) || p.kind !== "expedition" || p.caravan || p.crewRole != null) return "Only your own teams can be changed at a base.";
  if (!teamBase(state, p)) return "The team is not on one of your bases' tiles.";
  if (p.phase !== "waiting" || onTheMove(p)) return "The team is busy: stop it (or let it finish) first.";
  return transferProblem(state, p);
}
// Your teams that can be changed at this base now.
/** @param {State} state @param {Base} base */
export const editableTeams = (state, base) => state.parties.filter((p) => editBase(state, p) === base && !editProblem(state, p));

const over = (state, p) => poolLoad(p) - carryCapacity(state, partyMembers(state, p), partyVehicle(state, p));

// One more person from the base. Bikes: one more bike from the base's stack.
/** @param {State} state @param {Party} p @param {number} sid */
export function addMember(state, p, sid) {
  const why = editProblem(state, p);
  if (why) return why;
  const base = /** @type {Base} */ (teamBase(state, p));
  const s = survivorById(state, Number(sid));
  if (!s || !s.alive) return "Nobody by that name.";
  if (!s.location || s.location.kind !== "base" || s.location.baseId !== base.id) return `${s.name} is not at ${base.name}.`;
  const v = partyVehicle(state, p);
  if (isBike(v)) {
    const stack = parkBikes(state, base);
    if (!stack || (stack.count || 1) < 1) return `No bike for ${firstName(s)}: the team rides bikes, one each, and ${base.name} has none left.`;
    stack.count = (stack.count || 1) - 1;
    if (stack.count <= 0) state.vehicles.splice(state.vehicles.indexOf(stack), 1);
    v.count = (v.count || 1) + 1;
  }
  p.members.push(s.id);
  s.location = { kind: "party", partyId: p.id };
  weighTeam(state, p);
  return `${firstName(s)} joins the team.`;
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
  const v = partyVehicle(state, p);
  const after = isBike(v) ? { ...v, count: Math.max(1, (v.count || 1) - 1) } : v;
  const cap = carryCapacity(state, left, after || null);
  if (poolLoad(p) > cap + EPS) return `Without ${firstName(s)} the team could not carry its load (${Math.round(poolLoad(p))} kg on ${Math.floor(cap)} kg). Drop off some supplies or cargo first.`;
  p.members = p.members.filter((id) => id !== s.id);
  s.location = { kind: "base", baseId: base.id };
  if (isBike(v) && (v.count || 1) > 1) {
    v.count = (v.count || 1) - 1;
    createVehicle(state, "bike", { kind: "base", baseId: base.id }, { count: 1, condition: v.condition });
    parkBikes(state, base);
  }
  weighTeam(state, p);
  return `${firstName(s)} goes back into ${base.name}.`;
}

// The team's vehicle: another one parked at the base (a car, or the base's bikes, one each), or null (on foot). The old
// one parks at the base. Refused when the team could not carry its load after, or the car has no fuel (and none is
// carried).
/** @param {State} state @param {Party} p @param {number | null} vehicleId */
export function setVehicle(state, p, vehicleId) {
  const why = editProblem(state, p);
  if (why) return why;
  const base = /** @type {Base} */ (teamBase(state, p));
  const members = partyMembers(state, p);
  const old = partyVehicle(state, p);
  const nv = vehicleId ? vehicleById(state, Number(vehicleId)) : null;
  if (vehicleId && !nv) return "No such vehicle.";
  if (nv && nv === old) return "";
  if (nv && (nv.loc.kind !== "base" || nv.loc.baseId !== base.id)) return `The ${vehicleLabel(nv)} is not at ${base.name}.`;
  if (nv && nv.condition <= 0) return `The ${vehicleLabel(nv)} needs repairs first.`;
  if (isBike(nv) && bikesHere(state, base) < members.length) return `Not enough bikes at ${base.name}: ${members.length} people, ${bikesHere(state, base)} bikes.`;
  if (isCar(nv) && num(nv.fuel) + num(p.supplies && p.supplies.fuel) < 1) return `The ${nv.name} has no fuel: refuel it at the base, or load fuel cans first.`;
  const planned = isBike(nv) ? { ...nv, count: members.length } : nv;
  const cap = carryCapacity(state, members, planned || null);
  if (poolLoad(p) > cap + EPS) return `${nv ? `With the ${vehicleLabel(planned)}` : "On foot"} the team could not carry its load (${Math.round(poolLoad(p))} kg on ${Math.floor(cap)} kg). Drop off some supplies or cargo first.`;
  // The old one parks.
  if (old) {
    old.loc = { kind: "base", baseId: base.id };
    if (isBike(old)) parkBikes(state, base);
  }
  let v = nv;
  if (isBike(nv)) {
    const stack = parkBikes(state, base); // with the team's own bikes just parked: at least `members.length`
    if (!stack || stack.count < members.length) return `Not enough bikes at ${base.name}.`; // never expected (checked above)
    if (stack.count === members.length) v = stack;
    else { stack.count -= members.length; v = createVehicle(state, "bike", { kind: "base", baseId: base.id }, { count: members.length, condition: stack.condition }); }
  }
  if (v) v.loc = { kind: "party", partyId: p.id };
  p.vehicleId = v ? v.id : null;
  p.vehicle = travelMode(v);
  p.planVehicle = p.vehicle;
  weighTeam(state, p);
  return v ? `The team takes the ${vehicleLabel(v)}${old ? `; the ${vehicleLabel(old)} stays at ${base.name}` : ""}.` : `The team goes on foot; the ${old ? vehicleLabel(old) : "vehicle"} stays at ${base.name}.`;
}

// What the team carries of a supply (packed and found).
/** @param {Party} p @param {string} k */
export const teamHas = (p, k) => num(p.supplies && p.supplies[k]) + num(p.cargo && p.cargo.supplies && p.cargo.supplies[k]);
// Sets how much of a supply the team carries: more is loaded from the base's stores (as much as it can carry),
// less is dropped off into them. Returns the line to show.
/** @param {State} state @param {Party} p @param {string} k @param {number} qty */
export function setSupply(state, p, k, qty) {
  const why = editProblem(state, p);
  if (why) return why;
  if (!SUPPLIES[k]) return "Unknown supply.";
  const want = Math.max(0, num(Number(qty)));
  const have = teamHas(p, k);
  if (Math.abs(want - have) < EPS) return "";
  const r = want > have ? loadFromBase(state, p, { supplies: { [k]: want - have } }, "cargo") : dropOff(state, p, { supplies: { [k]: have - want } });
  return r.text;
}

