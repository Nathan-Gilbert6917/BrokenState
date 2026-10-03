// Boat crossings. Water blocks travel (pathfinding never routes over it), but a team standing on a shore
// can build a one-use boat and cross a single water tile to the land straight across (same direction,
// two tiles away). The boat costs scrap and hours that grow with the load: people, packed supplies and
// cargo, and much more for a vehicle (it needs a raft and parts); or the vehicle is left on this shore.
// Mechanics shortens the build. Runs as a timed order (orders.js, task type "cross"): build hours on
// this shore, then the crossing itself; materials are used when the boat goes into the water.
// "Gather materials" is a short timed task that turns up scrap on the shore when the team is short.
import { TERRAIN, SUPPLIES } from "./data.js";
import { log, hurt, snapshot } from "./world.js";
import {
  partyMembers, bestSkill, supplyLoad, cargoLoad, carryCapacity, partyCapacity, unitsThatFit, tileLabel, leaveVehicle, sightRadius,
  carried, takeSupply, wipeIfEmpty,
} from "./parties.js";
import { partyVehicle } from "./vehicles.js";

// Cost model. Scrap = frame + per person + 1 per `loadPerScrap` carry units (+ raft); hours likewise.
export const BOAT = {
  scrap: 4, perPerson: 2, loadPerScrap: 20,             // materials
  hours: 2, hoursPerPerson: 0.5, loadPerHour: 40,        // build time before Mechanics
  mechCut: 0.05, maxCut: 0.5,                            // -5% build time per Mechanics point, at most -50%
  crossHours: 1, raftCrossHours: 1,                      // on the water (+1h poling a raft)
  raft: {                                                // floating a vehicle across
    truck: { scrap: 14, parts: 2, hours: 4 },
    sedan: { scrap: 9, parts: 1, hours: 3 },
  },
};
export const GATHER_HOURS = 3; // Gather materials on the shore
// A shore holds a limited amount of usable material; it comes back slowly (driftwood, a fence someone missed).
export const SHORE_SCRAP = 10;         // most a shore tile holds
export const SHORE_REGROW_HOURS = 72;  // hours for 1 scrap to come back

const take = takeSupply; // found cargo first, then packed supplies (parties.js)

// Crossings from a land tile: one entry per direction where a single (unbridged) water tile has land beyond it.
export function crossingsFrom(state, from) {
  const t = state.tiles[from];
  if (!t || t.terrain === "water") return [];
  const out = [];
  for (const w of state.grid.neighbors(from)) {
    const wt = state.tiles[w];
    if (wt.terrain !== "water" || wt.bridge) continue;
    const far = state.grid.beyond(from, w);
    if (far < 0 || state.tiles[far].terrain === "water") continue;
    out.push({ water: w, tile: far });
  }
  return out;
}
export const crossingTo = (state, from, to) => crossingsFrom(state, from).find((c) => c.tile === to) || null;

// Everything about a boat for this team from `from` to `to`: materials, hours, breakdown lines, what is missing.
// mode: "raft" floats the vehicle across too, "leave" leaves it on this shore (ignored without a vehicle).
export function boatPlan(state, p, from, to, mode = "raft") {
  const crossing = crossingTo(state, from, to);
  const members = partyMembers(state, p);
  const n = members.length;
  const v = partyVehicle(state, p);
  const raft = v && mode !== "leave" ? BOAT.raft[v.type] || BOAT.raft.truck : null;
  // Leaving the vehicle: found cargo beyond what people can carry stays behind with it.
  const cargo = cargoLoad(p.cargo);
  const load = Math.round(supplyLoad(p.supplies) + (v && !raft ? Math.min(cargo, carryCapacity(state, members, null)) : cargo));
  const loadScrap = Math.ceil(load / BOAT.loadPerScrap);
  const mats = { scrap: BOAT.scrap + n * BOAT.perPerson + loadScrap + (raft ? raft.scrap : 0), parts: raft ? raft.parts : 0 };
  const mech = bestSkill(state, p, "mechanics");
  const cut = Math.min(BOAT.maxCut, mech * BOAT.mechCut);
  const raw = BOAT.hours + n * BOAT.hoursPerPerson + load / BOAT.loadPerHour + (raft ? raft.hours : 0);
  const build = Math.max(1, Math.ceil(raw * (1 - cut)));
  const cross = BOAT.crossHours + (raft ? BOAT.raftCrossHours : 0);
  const have = { scrap: Math.floor(carried(p, "scrap")), parts: Math.floor(carried(p, "parts")) };
  const missing = {};
  for (const k of Object.keys(mats)) if (mats[k] > have[k]) missing[k] = mats[k] - have[k];
  const risk = Math.max(0.02, Math.min(0.3, 0.05 + (raft ? 0.06 : 0) + n * 0.01 + load / 400 - mech * 0.005));
  // Breakdown for the tooltip / panel: [what, scrap, parts, hours before Mechanics].
  const lines = [
    ["Boat frame", BOAT.scrap, 0, BOAT.hours],
    [`${n} ${n === 1 ? "person" : "people"}`, n * BOAT.perPerson, 0, n * BOAT.hoursPerPerson],
    [`Load ${load} (supplies and cargo)`, loadScrap, 0, load / BOAT.loadPerHour],
  ];
  if (raft) lines.push([`Raft for the ${v.name}`, raft.scrap, raft.parts, raft.hours]);
  let reason = "";
  const farT = state.tiles[to];
  if (!crossing) reason = "No crossing there: it must be the land tile straight across one water tile.";
  else if (!n) reason = "Nobody in the team.";
  else if (raft && TERRAIN[farT.terrain].vehicle === Infinity && !farT.road) reason = `The far shore is too rough for the ${v.name}. Leave it behind.`;
  else if (Object.keys(missing).length) reason = `Needs ${matsText(mats)}; short ${matsText(missing)}. Gather materials on the shore or bring scrap.`;
  return { ok: !reason, reason, crossing, n, load, vehicle: v, raft, mode: v ? (raft ? "raft" : "leave") : "none", mats, have, missing, mech, cut, build, cross, hours: build + cross, risk, lines };
}

export const matsText = (m) => Object.entries(m).filter(([, q]) => q > 0).map(([k, q]) => `${q} ${SUPPLIES[k].name.toLowerCase()}`).join(" + ") || "nothing";

// Plain-text breakdown for tooltips.
export function boatTip(state, plan, to) {
  const f = (h) => (Math.round(h * 10) / 10).toString();
  const rows = plan.lines.map(([what, s, pa, h]) => `${what}: ${s} scrap${pa ? ` + ${pa} parts` : ""}, ${f(h)}h`).join(" · ");
  const leave = plan.mode === "leave" ? ` The ${plan.vehicle.name} stays on this shore (marked on the map, recover it later).` : "";
  return `Build a boat and cross to ${tileLabel(state, to)}. ${rows}. Mechanics ${plan.mech}: -${Math.round(plan.cut * 100)}% build time. ` +
    `Total: ${matsText(plan.mats)} (have ${plan.have.scrap} scrap${plan.mats.parts ? `, ${plan.have.parts} parts` : ""}); ${plan.build}h building + ${plan.cross}h crossing. ` +
    `${Math.round(plan.risk * 100)}% risk of a mishap on the water.${leave}${plan.ok ? "" : ` ${plan.reason}`}`;
}

// The order the panels queue: hours and materials are fixed when it is given (so queue estimates hold).
export function boatOrder(state, p, from, to, mode) {
  const plan = boatPlan(state, p, from, to, mode);
  if (!plan.crossing) return { error: plan.reason };
  return { type: "cross", tile: to, mode: plan.mode, build: plan.build, cross: plan.cross, mats: plan.mats };
}

// Called when the build is done: use the materials, leave or raft the vehicle, launch. Returns an error text or "".
export function launchBoat(state, p) {
  const t = p.task;
  for (const [k, q] of Object.entries(t.mats)) if (carried(p, k) < q - 1e-9) return `Not enough ${SUPPLIES[k].name.toLowerCase()} left to finish the boat (needs ${matsText(t.mats)}).`;
  for (const [k, q] of Object.entries(t.mats)) if (q > 0) take(p, k, q);
  if (t.mode === "leave" && partyVehicle(state, p)) {
    const v = partyVehicle(state, p);
    log(state, `The team left the ${v.name} on the shore at ${tileLabel(state, t.from)}.`, "info");
    leaveVehicle(state, p, t.from, "left on the shore"); // cargo the people cannot carry stays in it (logged)
  }
  t.afloat = true;
  return "";
}

// Arrival on the far shore: small risk of a mishap on the water (no delay, so time estimates hold).
export function landBoat(state, p) {
  const t = p.task;
  p.path = [t.tile];
  p.idx = 0;
  for (const id of state.grid.within(t.tile, sightRadius(state, p))) p.seen.set(id, snapshot(state, id));
  const rng = state.rng;
  let mishap = "";
  if (rng.chance(t.risk ?? 0.05)) {
    const v = partyVehicle(state, p);
    const roll = rng.int(0, v && t.mode === "raft" ? 2 : 1);
    if (roll === 0) {
      const keys = Object.keys(SUPPLIES).filter((k) => carried(p, k) >= 2);
      if (keys.length) {
        const k = rng.pick(keys);
        const lost = Math.max(1, Math.floor(carried(p, k) * (0.25 + rng.next() * 0.25)));
        take(p, k, lost);
        mishap = ` A crate went over the side: lost ${lost} ${SUPPLIES[k].name.toLowerCase()}.`;
      }
    } else if (roll === 1) {
      const m = rng.pick(partyMembers(state, p));
      hurt(state, m, rng.int(4, 12), t.tile, "drowned crossing the river");
      mishap = m.alive ? ` ${m.name.split(" ")[0]} slipped into the current and was hauled out bruised.` :
        ` ${m.name.split(" ")[0]} slipped into the current and did not come up again.`;
    } else {
      const before = v.condition;
      v.condition = Math.max(1, v.condition - rng.int(8, 15));
      mishap = ` The raft listed and the ${v.name} took on water (condition ${Math.round(before)}% → ${Math.round(v.condition)}%).`;
    }
  }
  const text = `Crossed the river to ${tileLabel(state, t.tile)}${t.mode === "raft" ? " with the vehicle on a raft" : ""}; the boat was broken up for the landing.${mishap}`;
  log(state, text, mishap ? "danger" : "info");
  wipeIfEmpty(state, p); // the mishap killed the last of them: what they carried lies on the far shore
  return text;
}

// ---------- gathering materials on the shore ----------
// Usable material left on a shore tile right now: starts at SHORE_SCRAP, goes down as teams gather, and comes
// back by 1 every SHORE_REGROW_HOURS.
export function shoreScrap(state, tile) {
  const g = state.tiles[tile].gathered;
  if (!g) return SHORE_SCRAP;
  return Math.min(SHORE_SCRAP, g.left + (state.hour - g.hour) / SHORE_REGROW_HOURS);
}

// Why a team cannot gather on a tile ("" = it can): only on a shore with a crossing, while something is left.
export function gatherProblem(state, tile) {
  if (!crossingsFrom(state, tile).length) return "only on a shore with land straight across the water.";
  if (shoreScrap(state, tile) < 1) return "this shore is picked clean. It takes days for anything useful to wash up again.";
  return "";
}

// min–max: what one search can turn up here now (never more than is left on the shore); left: what the shore holds.
export function gatherInfo(state, p, tile) {
  const t = state.tiles[tile];
  const scav = bestSkill(state, p, "scavenging");
  const bonus = { forest: 2, suburb: 2, city: 3 }[t.terrain] || 0;
  const room = Math.max(0, partyCapacity(state, p) - cargoLoad(p.cargo));
  const left = crossingsFrom(state, tile).length ? Math.floor(shoreScrap(state, tile)) : 0;
  return { min: Math.min(left, 2 + bonus + Math.floor(scav / 3)), max: Math.min(left, 5 + bonus + Math.floor(scav / 3)), room: unitsThatFit(room, "scrap"), hours: GATHER_HOURS, left };
}

export function gatherMaterials(state, p, tile) {
  const g = gatherInfo(state, p, tile);
  if (g.left < 1) return "Nothing useful left on this shore. It takes days for more to wash up.";
  const found = Math.min(g.left, state.rng.int(g.min, g.max));
  const kept = Math.min(found, g.room);
  p.cargo.supplies.scrap = (p.cargo.supplies.scrap || 0) + kept;
  // What the team takes is gone from this shore (what it could not carry stays).
  state.tiles[tile].gathered = { left: shoreScrap(state, tile) - kept, hour: state.hour };
  const after = Math.floor(shoreScrap(state, tile));
  return `Gathered ${kept} scrap (driftwood, fencing, barrels) for a boat${kept < found ? `; no room for ${found - kept} more` : ""}. Carried scrap: ${Math.floor(carried(p, "scrap"))}. ${after < 1 ? "This shore is picked clean now." : `About ${after} more could be found here.`}`;
}
