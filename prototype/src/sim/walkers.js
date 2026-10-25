// @ts-check
// A team's people against its vehicles in the field (vehicles.js fleets): one person to each vehicle, a seat for each
// person.
//
//   - Surplus vehicles (shedSurplusVehicles): a team that loses people (killed, taken, gone, sent off on their own) and
//     ends up with more vehicles than people to drive and ride them leaves the extra ones on its tile, the least useful
//     first: spare bikes, then the car in the worst shape (then the one with least fuel). Each is marked on the map and
//     can be recovered (parties.js recoverVehicle). Checked every hour before the team moves (parties.js
//     playerPartyHour), so no vehicle goes on with nobody in it; the log and a card say what was left.
//   - After a raid, the player's pick (raidVehiclePick; the user's request 2026-10-25: "If not enough people are left
//     after a raid to drive a vehicle all vehicles not driven are left at the POI you decide which was taken and which
//     was left"): a raid that leaves fewer people than the team's vehicles need (driversFor: a car its driver, a bike its
//     rider) and a real choice (two ways or more to fill the seats at the wheel: keepOptions) asks on a card
//     (vehiclePickCard) which go on; the others stay at the raid's tile (leaveVehicle: marked, recoverable, what the
//     people cannot carry stays in them), the lead one of those kept (vehicles.js setPartyVehicles). While the card waits
//     (p.vehiclePick) the hourly sweep leaves the vehicles alone; a team that sets off first takes the card's default.
//     The autopilot, a crew and a headless run never see it: the rule above picks for them, at once (ADR 0001).
//   - Walkers (afterVehicleLoss): a vehicle lost on the way (blown up, run dry, abandoned after a breakdown, left on a
//     shore) can leave fewer seats than people. Nobody squeezes in: those without a seat walk (p.walkers), and the whole
//     team goes at walking pace (parties.js partySpeed, stepMode: the vehicles keep to their road, every step takes a
//     walker's time), each walker carrying only their own kit; the cargo stays in the vehicles. A card offers to leave
//     the walkers to follow on foot as a team of their own (splitWalkers: the vehicles go on at their pace) or to stay
//     together. A vehicle picked up later seats them again (reseat). A single car that has never lost one still takes
//     everyone (vehicles.js fleetProblem), as it always has.
//
// AI parity: the other groups' raids and escorts carry their vehicles by the numbers (vehicles.js raidHumvees,
// escorts.js); they have no seats to count, and nothing here touches them.
/** @import { State, Party } from "./types" */
import { foodIn, takeFood } from "./foods.js"; // a share of the food
import { log, addCard, newId } from "./world.js";
import { partyMembers, partyTile, leaveVehicle, teamName, weighTeam, takeSupply, orderMove, onTheMove, tileLabel, carryCapacity, poolLoad } from "./parties.js";
import { partyVehicles, fleetOf, seatsOf, driversFor, isBike, isCar, createVehicle, vehicleLabel, markLeft, tank, vehicleCapacity, VEHICLE_TYPES } from "./vehicles.js";
import { SUPPLIES } from "./data.js";

const list = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const fieldTeam = (p) => !!p && p.owner === "player" && p.kind !== "convoy";

// ---------- one person to each vehicle ----------
// Leaves the vehicles nobody is left to drive or ride. Returns their labels ([] when none). A pick still waiting on
// its card (p.vehiclePick, after a raid) is the player's: nothing is left while the team waits on that tile; set off
// before answering it, the team takes the card's default (this rule's pick) and the card goes.
/** @param {State} state @param {Party} p @param {number} [tile] */
export function shedSurplusVehicles(state, p, tile = partyTile(p)) {
  if (!fieldTeam(p) || !state.parties.includes(p)) return [];
  if (p.vehiclePick) {
    const at = (state.cards || []).findIndex((c) => c.vehiclePickFor === p.id);
    if (at >= 0 && partyTile(p) === p.vehiclePick.tile && !onTheMove(p)) return [];
    if (at >= 0) state.cards.splice(at, 1);
    delete p.vehiclePick;
  }
  const n = partyMembers(state, p).length;
  if (!n) return []; // nobody at all: the team is wiped (parties.js wipeParty) with its vehicles
  const left = leavePlan(state, p, surplusPlan(state, p, n), tile);
  if (left.length) {
    const text = `${teamName(state, p)} has fewer people than vehicles now: ${list(left)} ${left.length === 1 && !/bikes/.test(left[0]) ? "was" : "were"} left at the spot, marked on the map, for whoever comes back for ${left.length === 1 ? "it" : "them"}.`;
    log(state, text, "danger");
    addCard(state, { title: "Vehicles left behind", text, partyId: p.id, choices: [{ label: "Understood", hint: "Send a team with a driver for each to recover them (Recover vehicle).", ai: () => 1, resolve: () => "" }] });
  }
  return left;
}

// The rule's pick for a team of n: { bikes: how many of the bikes stay, cars: the cars that stay }, the spare bikes
// first, then the car in the worst shape (then the one with least fuel). Nothing when there is a driver for each.
/** @param {State} state @param {Party} p @param {number} [n] */
export function surplusPlan(state, p, n = partyMembers(state, p).length) {
  const vs = partyVehicles(state, p), plan = { bikes: 0, cars: [] };
  let over = driversFor(vs) - n;
  if (!n || over <= 0) return plan;
  const bike = vs.find(isBike);
  if (bike) { plan.bikes = Math.min(bike.count || 1, over); over -= plan.bikes; }
  for (const c of vs.filter(isCar).sort((a, b) => a.condition - b.condition || a.fuel - b.fuel)) {
    if (over <= 0) break;
    plan.cars.push(c);
    over -= 1;
  }
  return plan;
}
// Leaves a plan's vehicles on the tile (a share of a stack of bikes as a stack of its own); their labels.
function leavePlan(state, p, plan, tile) {
  const left = [];
  const bike = partyVehicles(state, p).find(isBike);
  if (bike && plan.bikes > 0) {
    const have = bike.count || 1, drop = Math.min(have, plan.bikes);
    if (drop >= have) leaveVehicle(state, p, tile, "nobody to ride them", bike);
    else {
      bike.count = have - drop;
      const spare = createVehicle(state, "bike", { kind: "abandoned", tile, since: state.hour }, { count: drop, condition: bike.condition });
      markLeft(state, p, spare, tile, "nobody to ride them");
      weighTeam(state, p);
    }
    left.push(`${drop} bike${drop === 1 ? "" : "s"}`);
  }
  for (const c of plan.cars) {
    if (!partyVehicles(state, p).includes(c)) continue;
    leaveVehicle(state, p, tile, "nobody to drive it", c); // cargo the people cannot carry stays in it (logged)
    left.push(`the ${c.name}`);
  }
  return left;
}

// ---------- which go on after a raid: the player's pick ----------
// The ways n people can take the team's vehicles on, each using all of them: { cars: the cars kept, bikes: how many
// of the bikes kept }, the most cars first, the team's order (the lead first). [] when there is a driver for each.
/** @param {State} state @param {Party} p @param {number} [n] */
export function keepOptions(state, p, n = partyMembers(state, p).length) {
  const vs = partyVehicles(state, p), cars = vs.filter(isCar), bike = vs.find(isBike), bikes = bike ? bike.count || 1 : 0;
  if (!n || driversFor(vs) <= n) return [];
  const out = [];
  const pick = (from, k, acc) => {
    if (acc.length === k) { out.push({ cars: acc, bikes: Math.min(bikes, n - k) }); return; }
    for (let i = from; i < cars.length; i++) pick(i + 1, k, [...acc, cars[i]]);
  };
  for (let k = Math.min(cars.length, n); k >= Math.max(0, n - bikes); k--) pick(0, k, []);
  return out;
}
// The rule's pick (surplusPlan) as one of keepOptions: what the autopilot and the card's default take.
const isRulePick = (state, p, o) => {
  const plan = surplusPlan(state, p), vs = partyVehicles(state, p), bike = vs.find(isBike);
  return o.bikes === (bike ? (bike.count || 1) - plan.bikes : 0) && vs.filter(isCar).every((c) => o.cars.includes(c) === !plan.cars.includes(c));
};
// Who picks on a card: your own team in the browser, not the autopilot's nor a crew's (crews.js); everyone else gets
// the rule's pick. state.vehiclePickAlways: the tools test the card.
/** @param {State} state @param {Party} p */
export const vehiclePickWanted = (state, p) => fieldTeam(p) && p.crewRole == null && !state.autopilot && (!!state.vehiclePickAlways || typeof window !== "undefined");

// After a raid (scavenge.js afterRaid, rescueraid.js onRescueRaid), on the raid's tile: fewer people than the vehicles
// need. A real choice for the player: the card, and the vehicles wait for it (true); else the rule leaves the
// extra ones there at once (false; nothing to leave: false too).
/** @param {State} state @param {Party} p @param {number} tile */
export function raidVehiclePick(state, p, tile) {
  if (!fieldTeam(p) || !state.parties.includes(p) || !partyMembers(state, p).length) return false;
  const opts = keepOptions(state, p);
  if (!opts.length) return false;
  if (opts.length < 2 || !vehiclePickWanted(state, p)) { shedSurplusVehicles(state, p, tile); return false; }
  for (let i = state.cards.length - 1; i >= 0; i--) if (state.cards[i].vehiclePickFor === p.id) state.cards.splice(i, 1);
  p.vehiclePick = { tile, hour: state.hour };
  addCard(state, vehiclePickCard(state, p, tile, opts));
  return true;
}

// "Name (kind): condition, fuel, what it carries" for the card.
const carWords = (v) => {
  const kind = VEHICLE_TYPES[v.type] ? VEHICLE_TYPES[v.type].name : v.type;
  return `${v.name}${kind && !v.name.includes(kind) ? ` (${kind})` : ""}: condition ${Math.round(v.condition)}%, fuel ${Math.round(v.fuel)}/${tank(v)}, carries ${Math.round(vehicleCapacity(v))} kg`;
};
const bikeWords = (v) => `${v.count || 1} bicycle${(v.count || 1) === 1 ? "" : "s"}: condition ${Math.round(v.condition)}%, racks for ${Math.round(vehicleCapacity(v))} kg`;
const bikesWord = (k) => `${k} bicycle${k === 1 ? "" : "s"}`;
const fewerOf = (k) => (k === 1 ? "one" : String(k));

// The card: one answer for each way to take the vehicles on (keepOptions), the rule's pick its default. Each says
// what stays and how much of the team's load stays in what is left.
/** @param {State} state @param {Party} p @param {number} tile @param {any[]} [opts] */
export function vehiclePickCard(state, p, tile, opts = keepOptions(state, p)) {
  const members = partyMembers(state, p), n = members.length, vs = partyVehicles(state, p), bike = vs.find(isBike), bikes = bike ? bike.count || 1 : 0;
  const place = tileLabel(state, tile), load = poolLoad(p);
  const kept = (o) => [...o.cars.map((c) => `the ${c.name}`), ...(o.bikes ? [bikesWord(o.bikes)] : [])];
  const left = (o) => [...vs.filter((v) => isCar(v) && !o.cars.includes(v)).map((c) => `the ${c.name}`), ...(bikes - o.bikes > 0 ? [bikesWord(bikes - o.bikes)] : [])];
  const stays = (o) => {
    const fleet = fleetOf([...o.cars, ...(o.bikes ? [{ ...bike, count: o.bikes }] : [])]);
    const over = load - carryCapacity(state, members, fleet);
    return over > 0.5 ? ` About ${Math.round(over)} kg of the team's ${Math.round(load)} kg load will not fit: it stays in what is left.` : " All of the team's load fits.";
  };
  const list2 = vs.map((v) => (isBike(v) ? bikeWords(v) : carWords(v))).join("; ");
  return {
    title: "Not enough drivers",
    text: `${teamName(state, p)} is down to ${fewerOf(n)}, and its vehicles need ${driversFor(vs)} at the wheel (a car its driver, a bike its rider): ${list2}. Pick what goes on with ${n === 1 ? "them" : "the team"}; the rest stay at ${place}, marked on the map, for whoever comes back for them.`,
    partyId: p.id,
    vehiclePickFor: p.id,
    choices: opts.map((o) => {
      const rule = isRulePick(state, p, o);
      return {
        label: `Take ${list(kept(o))}`,
        hint: `Left at ${place}: ${list(left(o))}.${stays(o)}${rule ? " The default: the vehicle in the worst shape (then the one with least fuel) stays." : ""}`,
        default: rule, ai: () => (rule ? 1 : 0),
        resolve: (st) => takeVehicles(st, p, o, tile),
      };
    }),
  };
}

// The pick made: what was not picked stays on the tile; returns the card's line.
/** @param {State} state @param {Party} p @param {{ cars: any[], bikes: number }} o @param {number} tile */
export function takeVehicles(state, p, o, tile) {
  delete p.vehiclePick;
  if (!state.parties.includes(p) || !partyMembers(state, p).length) return "";
  const vs = partyVehicles(state, p), bike = vs.find(isBike);
  if (driversFor(vs) <= partyMembers(state, p).length) return "There is someone for every vehicle now: nothing was left.";
  const plan = { cars: vs.filter((v) => isCar(v) && !o.cars.includes(v)), bikes: bike ? Math.max(0, (bike.count || 1) - o.bikes) : 0 };
  const left = leavePlan(state, p, plan, tile);
  left.push(...shedSurplusVehicles(state, p, tile)); // fewer people again since the card came up: the rule leaves the rest
  if (!left.length) return "";
  const going = list(partyVehicles(state, p).map((v) => (isBike(v) ? bikesWord(v.count || 1) : `the ${v.name}`)));
  const said = list(left);
  const text = `${teamName(state, p)} goes on with ${going}. ${said.charAt(0).toUpperCase()}${said.slice(1)} ${left.length === 1 && !/bikes/.test(left[0]) ? "was" : "were"} left at ${tileLabel(state, tile)}, marked on the map, for whoever comes back for ${left.length === 1 ? "it" : "them"}.`;
  log(state, text, "danger");
  return text;
}

// ---------- a seat for each person ----------
// People without a seat in the team's vehicles (0 with no vehicles: then everyone walks anyway).
/** @param {State} state @param {Party} p */
export const seatShort = (state, p) => { const vs = partyVehicles(state, p); return vs.length ? Math.max(0, partyMembers(state, p).length - seatsOf(fleetOf(vs))) : 0; };

// After a vehicle was lost on the way: those without a seat walk, and the card asks whether to leave them to follow.
/** @param {State} state @param {Party} p */
export function afterVehicleLoss(state, p) {
  if (!fieldTeam(p) || !state.parties.includes(p)) return;
  const short = seatShort(state, p);
  const was = p.walkers || 0;
  p.walkers = short;
  if (!short || short <= was) return;
  log(state, `${teamName(state, p)} is ${short} seat${short === 1 ? "" : "s"} short: ${short === 1 ? "one walks" : `${short} walk`}, and the team goes at walking pace.`, "danger");
  for (let i = state.cards.length - 1; i >= 0; i--) if (state.cards[i].walkersFor === p.id) state.cards.splice(i, 1);
  addCard(state, walkersCard(state, p));
}
// Seats back (a vehicle picked up, fewer people): the walkers ride again.
/** @param {State} state @param {Party} p */
export function reseat(state, p) {
  if (!p || !p.walkers) return;
  const was = p.walkers;
  p.walkers = seatShort(state, p);
  if (!p.walkers) { delete p.walkers; if (state.parties.includes(p) && partyMembers(state, p).length) log(state, `${teamName(state, p)} has a seat for everyone again.`, "info"); }
  if (p.walkers !== was) weighTeam(state, p);
}

export function walkersCard(state, p) {
  const short = p.walkers || 0;
  const vs = partyVehicles(state, p);
  return {
    title: "Not enough seats",
    text: `${teamName(state, p)} has ${seatsOf(fleetOf(vs))} seat${seatsOf(fleetOf(vs)) === 1 ? "" : "s"} in the ${vehicleLabel(fleetOf(vs))} for ${partyMembers(state, p).length} people. ${short === 1 ? "One walks" : `${short} walk`}, so the whole team goes at walking pace (the cargo stays in the vehicles). Leave the walkers to follow on foot as a team of their own, and the vehicles go on at their pace?`,
    partyId: p.id,
    walkersFor: p.id,
    choices: [
      { label: "Leave the walkers to follow on foot", hint: `${short === 1 ? "The one without a seat becomes" : `The ${short} without a seat become`} a team of their own on foot with a share of the food and water, heading for the same place; the vehicles go on at their own pace.`, ai: () => 0, resolve: (st) => splitWalkers(st, p) },
      { label: "Stay together", hint: "Everyone stays together at walking pace until a seat turns up (another vehicle picked up).", ai: () => 1, resolve: () => "" },
    ],
  };
}

// The walkers go their own way on foot: a team of their own on the same tile, with their share of the packed food and
// water, sent on to where the team was heading (or waiting there). Returns a line for the card's result.
/** @param {State} state @param {Party} p */
export function splitWalkers(state, p) {
  if (!state.parties.includes(p)) return "";
  const k = seatShort(state, p);
  const members = partyMembers(state, p);
  if (!k || k >= members.length) { reseat(state, p); return "Everyone has a seat now."; }
  const walk = members.slice(members.length - k);
  const tile = partyTile(p);
  const sup = {};
  for (const key of Object.keys(SUPPLIES)) sup[key] = 0;
  for (const key of ["water"]) sup[key] = takeSupply(p, key, Math.floor(((p.supplies[key] || 0) * k) / members.length));
  Object.assign(sup, takeFood([p], (foodIn(p.supplies) * k) / members.length, { eggs: false, state }).items); // foods.js: their share of the packed food, as the items
  /** @type {any} */
  const q = {
    id: newId(), owner: "player", kind: "expedition", mission: "move", teamMission: p.teamMission || "move", dest: tile, homeBaseId: p.homeBaseId,
    members: walk.map((s) => s.id), stance: p.stance || "normal", vehicle: false, vehicleId: null, vehicleIds: [], supplies: sup, cargo: { supplies: {}, gear: [] },
    path: [tile], idx: 0, progress: 0, phase: "waiting", seen: new Map(), spotted: new Map(), sightNow: [], radioLive: !!p.radioLive,
    departed: state.hour, plannedHours: 0, eventsSeen: 0, orders: [], orderStart: state.hour,
    planPath: [tile], planStart: state.hour, planVehicle: false, planFuel: 0, etaOut: 0, etaBack: null,
  };
  p.members = p.members.filter((id) => !q.members.includes(id));
  for (const s of walk) s.location = { kind: "party", partyId: q.id };
  state.parties.push(q);
  delete p.walkers;
  weighTeam(state, q);
  weighTeam(state, p);
  const dest = p.dest;
  if (onTheMove(p) && dest != null && dest !== tile) orderMove(state, q, dest);
  const text = `${list(walk.map((s) => s.name.split(" ")[0]))} follow${walk.length === 1 ? "s" : ""} on foot${dest != null && dest !== tile && onTheMove(q) ? " to the same place" : ""}; the vehicles go on at their pace.`;
  log(state, text, "info");
  return text;
}
