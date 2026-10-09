// @ts-check
// A team's people against its vehicles in the field (vehicles.js fleets): one person to each vehicle, a seat for each
// person.
//
//   - Surplus vehicles (shedSurplusVehicles): a team that loses people (killed, taken, gone, sent off on their own) and
//     ends up with more vehicles than people to drive and ride them leaves the extra ones on its tile, the least useful
//     first: spare bikes, then the car in the worst shape (then the one with least fuel). Each is marked on the map and
//     can be recovered (parties.js recoverVehicle). Checked every hour before the team moves (parties.js
//     playerPartyHour), so no vehicle goes on with nobody in it; the log and a card say what was left.
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
import { log, addCard, newId } from "./world.js";
import { partyMembers, partyTile, leaveVehicle, teamName, weighTeam, takeSupply, orderMove, onTheMove } from "./parties.js";
import { partyVehicles, fleetOf, seatsOf, driversFor, isBike, isCar, createVehicle, vehicleLabel, markLeft } from "./vehicles.js";
import { SUPPLIES } from "./data.js";

const list = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const fieldTeam = (p) => !!p && p.owner === "player" && p.kind !== "convoy";

// ---------- one person to each vehicle ----------
// Leaves the vehicles nobody is left to drive or ride. Returns their labels ([] when none).
/** @param {State} state @param {Party} p */
export function shedSurplusVehicles(state, p) {
  if (!fieldTeam(p) || !state.parties.includes(p)) return [];
  const n = partyMembers(state, p).length;
  if (!n) return []; // nobody at all: the team is wiped (parties.js wipeParty) with its vehicles
  let over = driversFor(partyVehicles(state, p)) - n;
  if (over <= 0) return [];
  const tile = partyTile(p);
  const left = [];
  const bike = partyVehicles(state, p).find(isBike);
  if (bike) {
    const have = bike.count || 1, drop = Math.min(have, over);
    if (drop >= have) leaveVehicle(state, p, tile, "nobody to ride them", bike);
    else {
      bike.count = have - drop;
      const spare = createVehicle(state, "bike", { kind: "abandoned", tile, since: state.hour }, { count: drop, condition: bike.condition });
      markLeft(state, p, spare, tile, "nobody to ride them");
      weighTeam(state, p);
    }
    left.push(`${drop} bike${drop === 1 ? "" : "s"}`);
    over -= drop;
  }
  const cars = partyVehicles(state, p).filter(isCar).sort((a, b) => a.condition - b.condition || a.fuel - b.fuel);
  for (const c of cars) {
    if (over <= 0) break;
    leaveVehicle(state, p, tile, "nobody to drive it", c);
    left.push(`the ${c.name}`);
    over -= 1;
  }
  if (left.length) {
    const text = `${teamName(state, p)} has fewer people than vehicles now: ${list(left)} ${left.length === 1 && !/bikes/.test(left[0]) ? "was" : "were"} left at the spot, marked on the map, for whoever comes back for ${left.length === 1 ? "it" : "them"}.`;
    log(state, text, "danger");
    addCard(state, { title: "Vehicles left behind", text, partyId: p.id, choices: [{ label: "Understood", hint: "Send a team with a driver for each to recover them (Recover vehicle).", ai: () => 1, resolve: () => "" }] });
  }
  return left;
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
  for (const key of ["food", "preserved", "water"]) sup[key] = takeSupply(p, key, Math.floor(((p.supplies[key] || 0) * k) / members.length));
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
