// Survivors of a team sent off on jobs of their own (the user's request 2026-10-24: "When in a team of more than 1 you
// can select different survivors to do different jobs basically acting like a mobile base when it comes to jobs when
// sitting on a tile. When one or more survivors is out doing a job you cannot move the team as a whole to another
// tile. Any order a team can do can be assigned to one or more survivors"). The map's right-click menu picks who does
// an order (ui/teamctx.js); when that is some of the team, not all of it, they split off as a detachment:
//   - a team of their own on the tile (teammeet.js moveMembers: their share of the packed food and water), with their
//     share of the other packed supplies (ammo, arrows, scrap … by head) and the spare tools in the cargo the job uses
//     (an axe for Cut wood, a pickaxe for Gather stone, a rod or a net for Fish), marked p.detachOf = the team's id;
//   - it does the order with every rule a team has (orders.js, parties.js), and its people are not free for another;
//   - done (its queue empty, parties.js awaitOrders: no orders card, p.detachDone), it rejoins the team: merged into it
//     on the team's tile (teammeet.js mergeTeams: what it gathered goes into the team's cargo), or it walks back first
//     when the job took it elsewhere; a detachment only sent to move somewhere stays there as a team of its own;
//   - meanwhile the team cannot move (detachProblem: parties.js orderMove and startReturn refuse, a queued move or
//     sweep waits for them, orders.js startOrder; the menu greys its moves out); Call back (callBack) stops the job.
// Player teams only: the other groups' parties are strengths by the numbers and never split like this.
//   detachments(state, p) → the team's detachments out   detachProblem(state, p) → why it cannot move ("" = it can)
//   subTeam(state, p, ids) → a copy of the team as those people would go (the menu's reasons, the land order box)
//   detach(state, p, ids, run) → { text, error, party }   detachHour(state): rejoining, each hour   callBack(state, q)
// tools/detachtest.js.
import { FOODS } from "./foods.js";
import { log } from "./world.js";
import { partyMembers, partyTile, teamName, orderMove } from "./parties.js";
import { moveMembers, mergeTeams, standProblem } from "./teammeet.js";
import { orderLabel, stopTask, resumeQueue, cancelMove } from "./orders.js";
import { isChopTool } from "./woodcutting.js";
import { isQuarryTool } from "./stone.js";
import { isFishTool } from "./hunting.js";

// Orders that move the whole team off its tile (or around it): not while a detachment is out.
export const MOVES = new Set(["move", "home", "sweep", "nearby", "searcharea", "cross"]);
// Orders only the whole team gives (they settle it, or are about it): never split. Treating someone is the team's too.
const TEAM_ONLY = new Set(["enter", "establish", "outpost", "strikecamp", "drivehome", "camp", "scoutcamp", "scoutestablish", "scoutoutpost"]);
export const splittable = (orders) => (orders || []).every((o) => o.type !== "treat" && o.type !== "camp" && !(o.type === "mission" && TEAM_ONLY.has(o.mission))); // camp: the team rests together
// The spare tools from the cargo a land job's detachment takes along.
const toolTest = (type) => ({ wood: isChopTool, stone: isQuarryTool, fish: isFishTool })[type] || null; // call-time: the import cycle

const first = (s) => s.name.split(" ")[0];
const list = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const names = (state, q) => list(partyMembers(state, q).map(first));

export const detachments = (state, p) => (p ? state.parties.filter((q) => q.detachOf === p.id && q !== p) : []);
// Why the team as a whole cannot move now ("" when it can): some of its people are out on a job.
export function detachProblem(state, p) {
  const out = detachments(state, p);
  if (!out.length) return "";
  const who = list(out.map((q) => `${names(state, q)} (${orderLabel(state, q).toLowerCase()})`));
  return `${who} ${out.length === 1 && partyMembers(state, out[0]).length === 1 ? "is" : "are"} out: the team cannot move until they are back (or call them back).`;
}
// The team's line for one of its detachments (the team panel, the menu's picker).
export const detachText = (state, q) => `${names(state, q)}: ${orderLabel(state, q)}`;

// A share of a record of supplies by head (floor, by key): what n of N people take along.
const shareOf = (rec, n, N) => {
  const out = {};
  for (const [k, q] of Object.entries(rec || {})) { const v = Math.floor(((Number(q) || 0) * n) / N); if (v > 0) out[k] = v; }
  return out;
};
// The tools a job's detachment of n takes from the cargo (at most one a person).
const toolsFor = (gear, type, n) => (toolTest(type) ? (gear || []).filter(toolTest(type)).slice(0, n) : []);

// A copy of the team as `ids` (some of its people) would set out: their share of the packed supplies, the job's
// tools, nothing queued. For the reasons and estimates only: never put into state.parties.
export function subTeam(state, p, ids, type = null) {
  const set = new Set(ids.map(Number));
  const n = partyMembers(state, p).filter((s) => set.has(s.id)).length, N = partyMembers(state, p).length;
  return {
    ...p, members: (p.members || []).filter((id) => set.has(id)), orders: [], phase: "waiting", task: null, mission: "move",
    vehicle: false, vehicleId: null, vehicleIds: [], supplies: shareOf(p.supplies, n, N), hold: null, // carry.js settleHold writes its own (never the team's)
    cargo: { supplies: {}, gear: type ? toolsFor(p.cargo && p.cargo.gear, type, n) : [...new Set(["wood", "stone", "fish"].flatMap((k) => toolsFor(p.cargo && p.cargo.gear, k, n)))] }, detachOf: p.id,
  };
}
// Is `ids` some of the team's people, but not all of them (a detachment, not the team itself)?
export function isSome(state, p, ids) {
  if (!ids || !ids.length) return false;
  const mine = new Set(partyMembers(state, p).map((s) => s.id));
  const pick = [...new Set(ids.map(Number))];
  return pick.every((id) => mine.has(id)) && pick.length < mine.size;
}

// Splits `ids` off as a detachment and gives it its orders: run(q) gives them and returns the message (q is waiting on
// the team's tile). type: the job, for its tools; job: does it work somewhere (it comes back), or only move (it stays).
// When nothing starts (the order failed) the people go straight back into the team. Returns { text, error, party }.
export function detach(state, p, ids, run, { type = null, job = true } = {}) {
  const fail = (error) => ({ text: error, error, party: null });
  const why = standProblem(state, p);
  if (why) return fail(why);
  if (!isSome(state, p, ids)) return fail("Pick some of the team's people, not all of them.");
  const N = partyMembers(state, p).length;
  const r = moveMembers(state, p, null, ids, [], { quiet: true });
  if (r.error) return fail(r.error);
  const q = r.party;
  const n = partyMembers(state, q).length;
  q.detachOf = p.id;
  q.teamMission = p.teamMission || q.teamMission;
  q.detachJob = !!job;
  // Their share of the other packed supplies (splitTeam took the food and water), and the job's spare tools.
  for (const [k, v] of Object.entries(p.supplies || {})) {
    if (k === "water" || FOODS[k]) continue;
    const give = Math.floor(((Number(v) || 0) * n) / N);
    if (give > 0) { p.supplies[k] -= give; q.supplies[k] = (q.supplies[k] || 0) + give; }
  }
  for (const it of toolsFor(p.cargo && p.cargo.gear, type, n)) { p.cargo.gear.splice(p.cargo.gear.indexOf(it), 1); q.cargo.gear.push(it); }
  const who = names(state, q);
  const msg = run(q);
  if (!state.parties.includes(q)) return { text: msg, error: "", party: null };
  if (q.phase === "waiting" && !(q.orders || []).length) { // nothing started: back into the team
    q.detachDone = false;
    mergeTeams(state, p, q);
    return fail(msg || "That could not start.");
  }
  return { text: `${who} ${n === 1 ? "goes" : "go"} off from the team: ${msg}`, error: "", party: q }; // the caller logs it
}

// Back with the team: merged on its tile, or walking back to it (a detachment sent only to move somewhere stays a team
// of its own there). Returns the message ("" when it waits: the team is busy in a fight or a search).
export function rejoin(state, q) {
  const p = state.parties.find((x) => x.id === q.detachOf && x.owner === "player");
  if (!p || !partyMembers(state, p).length) { delete q.detachOf; return ""; } // the team is gone (home, merged, lost)
  if (partyTile(q) === partyTile(p)) {
    const who = names(state, q), n = partyMembers(state, q).length;
    const r = mergeTeams(state, p, q);
    if (r.error) return "";
    const text = `${who} ${n === 1 ? "is" : "are"} back with the team.`;
    if (p.waitDetached && !detachments(state, p).length) { p.waitDetached = false; if ((p.orders || []).length && p.phase === "waiting") resumeQueue(state, p); }
    return text;
  }
  if (!q.detachJob) { delete q.detachOf; const t = `${teamName(state, q)} stays at its tile as a team of its own.`; log(state, t, "info"); return t; }
  q.detachDone = false;
  return orderMove(state, q, partyTile(p));
}
// Each hour (world.js, after the teams move): the detachments done with their orders rejoin their team.
export function detachHour(state) {
  for (const q of state.parties.filter((x) => x.detachOf != null)) {
    if (!state.parties.includes(q)) continue;
    const p = state.parties.find((x) => x.id === q.detachOf);
    if (!p) { delete q.detachOf; continue; }
    if (q.detachDone && q.phase === "waiting") rejoin(state, q);
  }
}
// Call back: the job stops and they come back (merged at once on the team's tile).
export function callBack(state, q) {
  if (q.detachOf == null) return "That team is not out from another.";
  q.orders = [];
  if (q.phase === "task") stopTask(state, q);
  else if (q.phase === "out") cancelMove(state, q); // stops where it is
  q.detachJob = true;
  q.detachDone = false;
  return rejoin(state, q) || `${names(state, q)} will come back when they can.`;
}
