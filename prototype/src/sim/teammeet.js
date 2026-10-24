// @ts-check
// Your teams meeting on one tile: any number of your teams standing on the same tile can
//   - hand goods over (giveGoods): items off a member or out of the cargo, onto a member or into the other team's
//     cargo; supplies by key (food with its lots, every calibre on its own key), the found cargo staying found cargo
//     and the packed supplies staying packed;
//   - move people and vehicles (moveMembers): picked members (and vehicles) go over to another team there, or split off
//     as a new team on the tile with their share of the packed food and water (as walkers.js splitWalkers does); a
//     vehicle goes with its driver, or alone to a team with someone free to drive it; moving everyone is a merge;
//   - merge (mergeTeams): one team takes in another whole (its people, supplies, cargo, vehicles, prisoners, bodies,
//     what it has seen), and the emptied team is gone.
// Every operation checks first and changes nothing when it refuses: both teams yours, on the same tile, standing (not
// on the move, not in a search, a crawl, a fight or a boat), not a crew's or a caravan's; nobody may end up wearing more
// than their own max load, no team more over its carry limit than before, every vehicle with its own driver, and with
// two or more vehicles a seat for everyone (vehicles.js fleetProblem). Goods move as the objects they are (inventory.js:
// condition, a pack's contents, a gun's rounds), so nothing is made or lost; teamCheck lists anything out of order (a
// survivor on two teams, a location pointing elsewhere, a vehicle on a team that does not list it) for the tests.
//
// AI parity: the other groups' parties are strengths by the numbers (factions.js); they never sort their people or
// goods between parties, so nothing of theirs goes through here.
/** @import { State, Party, Item, Survivor } from "./types" */
import { planOpen } from "./raidplan.js"; // a battle at its plan: the team about to go in can still hand goods across
import { SUPPLIES, supWeight } from "./data.js";
import { survivorById, log, newId } from "./world.js";
import {
  partyMembers, partyTile, partyCapacity, poolLoad, weighTeam, onTheMove, teamName, removeParty, pruneCards, takeSupply,
} from "./parties.js";
import { partyVehicles, setPartyVehicles, fleetProblem, MAX_VEHICLES } from "./vehicles.js";
import { stow, removeAt, itemLoad } from "./inventory.js";
import { wornLoad, maxLoad } from "./load.js";
import { FOODS, moveFood, takeFood, foodIn } from "./foods.js";
import { settleHold } from "./carry.js";
import { resolveTeamItems, findOnTeam } from "./teaminv.js";
import { parseTarget, suppliesOnto, PLACE_WORDS, itemKeyOf } from "./supitems.js"; // supplies onto a named member of the other team (2026-10-17, any supply 2026-10-18)
import { isRoundKey } from "./rounds.js";
import { prisonersWith, teamPace } from "./prisoners.js";
import { reseat } from "./walkers.js";

const EPS = 1e-6;
const num = (v) => (Number.isFinite(v) ? v : 0);
const r1 = (x) => Math.round(x * 10) / 10;
const qtyText = (q) => (Math.abs(q - Math.round(q)) < 1e-6 ? String(Math.round(q)) : String(r1(q)));
const supName = (k) => (FOODS[k] ? FOODS[k].word : SUPPLIES[k] ? SUPPLIES[k].name.toLowerCase() : k);
const firstName = (s) => s.name.split(" ")[0];
const list = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

// ---------- who can meet ----------
/** A team of yours that can meet another (a field team, not a convoy). @param {any} p */
const fieldTeam = (p) => !!p && p.owner === "player" && p.kind !== "convoy";
// Why this team cannot hand anything over or take anyone in right now ("" when it can).
/** @param {State} state @param {Party} p */
export function standProblem(state, p) {
  if (!p || !state.parties.includes(p)) return "That team is gone.";
  if (!fieldTeam(p)) return "Only your own teams can do that.";
  const n = teamName(state, p);
  if (!partyMembers(state, p).length) return "Nobody is left on that team.";
  if (p.crewRole != null) return `${n} is a crew's team: its crew runs it.`;
  if (p.caravan) return `${n} is on a trade caravan.`;
  if (onTheMove(p)) return `${n} is on the move: stop it on this tile first.`;
  if (p.phase === "engaged" && !planHeld(state, p)) return `${n} is busy on the site.`;
  if (p.task && p.task.afloat) return `${n} is out on the water.`;
  if ((p.hiveCrawl && !p.hiveCrawl.done) || (p.crawl && !p.crawl.done)) return `${n} is inside.`;
  const e = state.engagement;
  if (e && !e.done && e.partyId === p.id) return `${n} is in the middle of a search.`;
  if (state.combat && !planHeld(state)) return "Not during a battle.";
  return "";
}
// A battle still at its plan (raidplan.js: nobody has gone in; the window offers Teams together): the team about to
// go in, and the teams on its tile, can still hand goods across. p: that team must be the battle's own.
function planHeld(state, p = null) {
  const b = state.combat;
  if (!b || b.over || !planOpen(b)) return false;
  return !p || b.setup.partyId === p.id;
}
// Why these two teams cannot meet ("" when they can).
/** @param {State} state @param {Party} a @param {Party} b */
export function meetProblem(state, a, b) {
  const why = standProblem(state, a) || standProblem(state, b);
  if (why) return why;
  if (a === b) return "That is the same team.";
  if (partyTile(a) !== partyTile(b)) return "The teams are not on the same tile.";
  return "";
}
// Your other teams on this team's tile it can meet now (any number of them).
/** @param {State} state @param {Party} p */
export function teamsTogether(state, p) {
  if (!fieldTeam(p) || !Array.isArray(p.path)) return [];
  const tile = partyTile(p);
  return state.parties.filter((q) => q !== p && fieldTeam(q) && Array.isArray(q.path) && partyTile(q) === tile && partyMembers(state, q).length);
}
// Every team of yours on a tile, when two or more stand there (the tile panel's "Teams together").
/** @param {State} state @param {number} tile */
export function teamsOnTile(state, tile) {
  const here = state.parties.filter((q) => fieldTeam(q) && Array.isArray(q.path) && partyTile(q) === tile && partyMembers(state, q).length);
  return here.length >= 2 ? here : [];
}

// ---------- weights ----------
const overBy = (state, p) => Math.max(0, poolLoad(p) - partyCapacity(state, p));
/** @param {State} state @param {Party[]} ps */
function settle(state, ps) {
  for (const p of ps) {
    if (!state.parties.includes(p)) continue;
    weighTeam(state, p);
    settleHold(state, p); // carry.js: who holds the pooled supplies, placed again
    reseat(state, p); // walkers.js: seats against people
    teamPace(state, p); // prisoners.js: walking prisoners slow a team on foot
  }
  pruneCards(state); // cards about someone no longer on that team
}
function result(moved, refused, where) {
  const text = [moved.length ? `Moved ${moved.join(", ")} ${where}.` : refused.length ? "" : "Nothing picked.", ...refused].filter(Boolean).join(" ");
  return { moved, refused, text };
}

// ---------- goods: one team to another ----------
// Moves up to `want` of a supply key from one team to another: the found cargo first (into the other team's cargo),
// then the packed supplies (into its packed supplies). Food moves with its lots (foods.js). Returns the amount moved.
/** @param {Party} from @param {Party} to @param {string} k @param {number} want */
function supplyAcross(from, to, k, want) {
  let left = Math.max(0, want), moved = 0;
  to.cargo = to.cargo || { supplies: {}, gear: [] };
  to.supplies = to.supplies || {};
  for (const [src, dst] of /** @type {[any, any][]} */ ([[from.cargo, to.cargo], [from, to]])) {
    if (!(left > EPS)) break;
    const pool = src === from ? from.supplies : from.cargo.supplies;
    const have = Math.max(0, num(pool[k]));
    const q = Math.min(left, have);
    if (!(q > EPS)) continue;
    if (FOODS[k]) {
      const got = moveFood(src, dst, { [k]: q })[k] || 0;
      moved += got; left -= got;
      continue;
    }
    pool[k] = have - q;
    if (Math.abs(pool[k]) < 1e-9) pool[k] = 0;
    const dpool = dst === to ? to.supplies : to.cargo.supplies;
    dpool[k] = num(dpool[k]) + q;
    moved += q; left -= q;
  }
  return moved;
}
// picks: { items: [location strings ("s:<id>:…", "cargo:<pid>:list:<i>") or Item objects], supplies: { key: amount } }.
// target: "cargo" (the other team's cargo) or one of its members' survivor id (their own slot if free, a rig pouch, a
// pocket, the pack). Supplies go as they were (found cargo, packed supplies), as many as the other team can carry;
// with a person target { sid, where: "pocket" | "pack" | "rig", loose? } (supitems.js parseTarget) a supply picked that
// has an item form (rounds, water, meds, a food...) goes onto that member as items in that place instead (supitems.js
// suppliesOnto; rounds boxed or loose), the found cargo's first.
// Returns { moved: [text], refused: [text], text }.
/** @param {State} state @param {Party} from @param {Party} to @param {{ items?: (string | Item)[], supplies?: Record<string, number> }} picks @param {"cargo" | number | string | { sid: number, where?: string | null, loose?: boolean }} [target] */
export function giveGoods(state, from, to, picks = {}, target = "cargo") {
  const why = meetProblem(state, from, to);
  if (why) return { moved: [], refused: [why], text: why };
  from.cargo = from.cargo || { supplies: {}, gear: [] };
  to.cargo = to.cargo || { supplies: {}, gear: [] };
  from.supplies = from.supplies || {};
  to.supplies = to.supplies || {};
  const T = parseTarget(target);
  const toCargo = !T;
  const s = toCargo ? null : survivorById(state, T.sid);
  if (!toCargo && (!s || !s.alive || !(to.members || []).includes(s.id))) return result([], ["That person is not on the other team."], "");
  const moved = [], refused = [];
  for (const it of resolveTeamItems(state, from, picks.items || [])) {
    const at = findOnTeam(state, from, it);
    if (!at) continue; // went with something picked before it (a pack with its contents)
    const fromBefore = overBy(state, from);
    at.take();
    if (overBy(state, from) > fromBefore + EPS) {
      at.put(it);
      refused.push(`The ${it.name} stays: without it ${teamName(state, from)} cannot carry its load. Move some of its cargo first.`);
      continue;
    }
    if (toCargo) {
      const room = partyCapacity(state, to) - poolLoad(to);
      if (itemLoad(it) > room + EPS) { at.put(it); refused.push(`No room for the ${it.name} (${r1(itemLoad(it))} kg; ${r1(Math.max(0, room))} kg free).`); continue; }
      to.cargo.gear.push(it);
      moved.push(it.name);
      continue;
    }
    const sv = /** @type {Survivor} */ (s);
    const toBefore = overBy(state, to);
    const loc = stow(sv, it);
    if (!loc) { at.put(it); refused.push(`${firstName(sv)} has no free place for the ${it.name}: give it into the cargo, or make room.`); continue; }
    const tooHeavy = wornLoad(sv) > maxLoad(sv) + EPS;
    if (tooHeavy || overBy(state, to) > toBefore + EPS) {
      removeAt(state, loc);
      at.put(it);
      refused.push(tooHeavy ? `The ${it.name} is too heavy for ${firstName(sv)} (${firstName(sv)} would wear ${r1(wornLoad(sv) + itemLoad(it))} of ${maxLoad(sv)} kg).` : `No room for the ${it.name}: the team could not carry its load as well.`);
      continue;
    }
    moved.push(`${it.name} (${firstName(sv)})`);
  }
  for (const [k, q] of Object.entries(picks.supplies || {})) {
    if (!SUPPLIES[k]) continue;
    const have = Math.max(0, num(from.supplies[k])) + Math.max(0, num(from.cargo.supplies[k]));
    const want = Math.min(have, q === Infinity ? have : Math.max(0, num(Number(q))));
    if (!(want > EPS)) continue;
    const room = Math.max(0, partyCapacity(state, to) - poolLoad(to));
    const w = supWeight(k);
    const fit = w > 0 ? Math.min(want, Math.floor((room + EPS) / w)) : want;
    if (fit < want - EPS) refused.push(fit > 0 ? `Only ${qtyText(fit)} of the ${qtyText(want)} ${supName(k)} fit (${r1(room)} kg free).` : `No room for ${supName(k)} (${r1(room)} kg free).`);
    if (!(fit > EPS)) continue;
    if (s && T && T.where && itemKeyOf(k)) { // onto the member of the other team, in that place (supitems.js suppliesOnto): the found cargo's first
      const r = suppliesOnto(state, [from.cargo, from], k, Math.floor(fit), s, { where: T.where, loose: T.loose });
      if (r.moved > 0) moved.push(`${r.moved} ${supName(k)} (${firstName(s)}'s ${PLACE_WORDS[T.where]}${T.loose && isRoundKey(k) ? ", loose" : ""})`);
      if (r.why) refused.push(r.why);
      continue;
    }
    const got = supplyAcross(from, to, k, fit);
    if (got > 0) moved.push(`${qtyText(got)} ${supName(k)}`);
  }
  if (moved.length) settle(state, [from, to]);
  return result(moved, refused, `to ${teamName(state, to)}`);
}

// ---------- people and vehicles: one team to another, or split off ----------
// Moves the members `sids` and the vehicles `vehicleIds` from one team to another on the tile (to), or to a new team of
// their own there (to null: a split, with their share of the packed food and water). A vehicle can go with its driver,
// or on its own to a team that has someone to drive it; a driver can go alone when someone left can drive what stays.
// The rule both ways: every vehicle has a person on its team to drive it (a rider for each bike), and with two or more
// vehicles a seat for everyone (vehicles.js fleetProblem). Moving everyone into another team merges the two.
// Returns { text, error, party } (party: the team they are on now).
/** @param {State} state @param {Party} from @param {Party | null} to @param {number[]} sids @param {number[]} [vehicleIds] */
export function moveMembers(state, from, to, sids, vehicleIds = [], { quiet = false } = {}) {
  const fail = (error) => ({ text: error, error, party: null });
  const why = to ? meetProblem(state, from, to) : standProblem(state, from);
  if (why) return fail(why);
  const members = partyMembers(state, from);
  const ids = [...new Set((sids || []).map(Number))];
  const go = members.filter((s) => ids.includes(s.id));
  if (go.length !== ids.length) return fail("Pick people on that team.");
  const fromVs = partyVehicles(state, from);
  const vids = [...new Set((vehicleIds || []).map(Number))];
  const moving = fromVs.filter((v) => vids.includes(v.id));
  if (moving.length !== vids.length) return fail("Pick vehicles of that team.");
  if (!go.length && !moving.length) return fail("Pick people or vehicles to move.");
  if (!go.length && !to) return fail("A new team needs people: pick who goes with the vehicle.");
  if (go.length === members.length) {
    if (!to) return fail("Everyone would leave: pick fewer people to split off as a new team.");
    const r = mergeTeams(state, to, from); // nobody left to drive them: its vehicles go along
    return { text: r.text, error: r.error, party: r.error ? null : to };
  }
  const stay = members.filter((s) => !ids.includes(s.id));
  const keep = fromVs.filter((v) => !moving.includes(v));
  // Every vehicle left keeps someone on its team to drive it.
  const left = fleetProblem(keep, stay.length);
  if (left) return fail(`${teamName(state, from)} cannot keep its vehicles: ${left} Send the vehicle along with its driver, or keep a driver back.`);
  const toVs = to ? partyVehicles(state, to) : [];
  const gets = fleetProblem([...toVs, ...moving], (to ? partyMembers(state, to).length : 0) + go.length);
  if (gets) return fail(`${to ? teamName(state, to) : "The new team"}: ${gets}`);
  // Loads: the team that gives people or vehicles can still carry what it holds; the team that takes them in (a lone
  // car counts its riders against its payload) is no worse off.
  const ids0 = (vs) => ({ vehicleIds: vs.map((v) => v.id), vehicleId: vs.length ? vs[0].id : null });
  const fromAfter = { ...from, members: stay.map((s) => s.id), ...ids0(keep) };
  if (overBy(state, fromAfter) > overBy(state, from) + EPS) return fail(`Without ${list([...go.map(firstName), ...moving.map((v) => `the ${v.name}`)])} ${teamName(state, from)} could not carry its load: move some of its cargo first.`);
  if (to) {
    const toAfter = { ...to, members: [...to.members, ...go.map((s) => s.id)], ...ids0([...toVs, ...moving]) };
    if (overBy(state, toAfter) > overBy(state, to) + EPS) return fail(`${teamName(state, to)} could not carry its load with them aboard: move some of its cargo first.`);
  }
  const toName = to ? teamName(state, to) : "";
  let q = to;
  if (!q) q = splitTeam(state, from, go);
  else {
    from.members = stay.map((s) => s.id);
    for (const s of go) { s.location = { kind: "party", partyId: q.id }; q.members.push(s.id); }
  }
  if (moving.length) { setPartyVehicles(state, from, keep); setPartyVehicles(state, q, [...toVs, ...moving]); }
  settle(state, [from, q]);
  const what = list([...go.map(firstName), ...moving.map((v) => `the ${v.name}`)]);
  const text = to ? (go.length ? `${what} join${go.length === 1 && !moving.length ? "s" : ""} ${toName}.` : `${what} ${moving.length === 1 ? "goes" : "go"} to ${toName}.`) : `${what} split off as a team of their own.`;
  if (!quiet) log(state, text, "info"); // quiet: detach.js says it its own way
  return { text, error: "", party: q };
}
// A new team on the same tile for `go` (members of `from`), waiting for orders, with their share of the packed food and
// water (walkers.js splitWalkers' rule); what it sees from here on is its own (it starts with what `from` has seen).
/** @param {State} state @param {Party} from @param {Survivor[]} go */
function splitTeam(state, from, go) {
  const tile = partyTile(from);
  const n = partyMembers(state, from).length;
  const sup = {};
  sup.water = takeSupply(from, "water", Math.floor((num(from.supplies.water) * go.length) / n));
  Object.assign(sup, takeFood([from], (foodIn(from.supplies) * go.length) / n, { eggs: false, state }).items); // foods.js: their share of the packed food, as the items
  /** @type {any} */
  const q = {
    id: newId(), owner: "player", kind: "expedition", mission: "move", teamMission: from.teamMission || "move", dest: tile, homeBaseId: from.homeBaseId,
    members: go.map((s) => s.id), stance: from.stance || "normal", vehicle: false, vehicleId: null, vehicleIds: [], supplies: sup, cargo: { supplies: {}, gear: [] },
    path: [tile], idx: 0, progress: 0, phase: "waiting", seen: new Map(from.seen || []), spotted: new Map(from.spotted || []), sightNow: [], radioLive: !!from.radioLive,
    departed: state.hour, plannedHours: 0, eventsSeen: 0, orders: [], orderStart: state.hour,
    planPath: [tile], planStart: state.hour, planVehicle: false, planFuel: 0, etaOut: 0, etaBack: null,
  };
  if (from.retreatPolicy) q.retreatPolicy = from.retreatPolicy; // breakoff.js: its retreat policy
  from.members = from.members.filter((id) => !q.members.includes(id));
  for (const s of go) s.location = { kind: "party", partyId: q.id };
  state.parties.push(q);
  return q;
}

// ---------- merge ----------
// `into` takes in `from` whole: its people, packed supplies and found cargo (food with its lots), its vehicles (up to
// MAX_VEHICLES, each with a driver, a seat for everyone when two or more), its prisoners, the bodies it carries, what
// it has seen and its volunteers' loans; `from` is gone. `into` keeps its orders. Returns { text, error }.
/** @param {State} state @param {Party} into @param {Party} from */
export function mergeTeams(state, into, from) {
  const why = meetProblem(state, into, from);
  if (why) return { text: why, error: why };
  const people = [...partyMembers(state, into), ...partyMembers(state, from)];
  const vs = [...partyVehicles(state, into), ...partyVehicles(state, from)];
  if (vs.length > MAX_VEHICLES) return { text: `At most ${MAX_VEHICLES} vehicles to a team (together they have ${vs.length}).`, error: "vehicles" };
  const fp = fleetProblem(vs, people.length);
  if (fp) return { text: fp, error: fp };
  const nameFrom = teamName(state, from), nameInto = teamName(state, into);
  into.cargo = into.cargo || { supplies: {}, gear: [] };
  into.supplies = into.supplies || {};
  from.cargo = from.cargo || { supplies: {}, gear: [] };
  // People.
  for (const s of partyMembers(state, from)) { s.location = { kind: "party", partyId: into.id }; if (!into.members.includes(s.id)) into.members.push(s.id); }
  from.members = [];
  // Supplies: food with its lots, the rest by key; packed stays packed, found stays found.
  moveFood(from, into, null, { state });
  moveFood(from.cargo, into.cargo, null, { state });
  for (const [src, dst] of [[from.supplies, into.supplies], [from.cargo.supplies, into.cargo.supplies]]) {
    for (const [k, q] of Object.entries(src || {})) {
      if (FOODS[k] || !(num(q) > 0)) continue;
      dst[k] = num(dst[k]) + num(q);
      src[k] = 0;
    }
  }
  into.cargo.gear.push(...from.cargo.gear);
  from.cargo.gear = [];
  if ((from.cargo.bodies || []).length) { (into.cargo.bodies || (into.cargo.bodies = [])).push(...from.cargo.bodies); from.cargo.bodies = []; }
  // Vehicles: one fleet now.
  setPartyVehicles(state, into, vs);
  setPartyVehicles(state, from, []);
  // Prisoners walked with it, volunteers on their way to it and its volunteers' loans.
  for (const pr of prisonersWith(state, from.id)) pr.at = { kind: "party", partyId: into.id };
  const V = /** @type {any} */ (state).vols;
  if (V) {
    for (const s of V.people || []) if (s.location && s.location.partyId === from.id) s.location = { ...s.location, partyId: into.id };
    for (const r of V.reqs || []) if (r.partyId === from.id) r.partyId = into.id;
  }
  // What it has seen and spotted (the newer report wins), and its Heat (the hotter one).
  into.seen = into.seen || new Map();
  for (const [k, v] of from.seen || []) { const had = into.seen.get(k); if (!had || num(had.hour) <= num(v.hour)) into.seen.set(k, v); }
  into.spotted = into.spotted || new Map();
  for (const [k, v] of from.spotted || []) if (!into.spotted.has(k)) into.spotted.set(k, v);
  if (num(from.heat) > num(into.heat)) into.heat = from.heat;
  into.radioLive = !!(into.radioLive || from.radioLive);
  removeParty(state, from); // its cards go with it
  settle(state, [into]);
  const text = `${nameFrom} joined ${nameInto}: one team of ${partyMembers(state, into).length} now.`;
  log(state, text, "info");
  return { text, error: "" };
}

// ---------- checks (tests) ----------
// Everything that must hold between your teams after any of the above: each survivor on one team at most, located
// there, alive; each vehicle on one team at most, located there; no negative or NaN supplies. Returns the faults.
/** @param {State} state */
export function teamCheck(state) {
  const out = [];
  const seenS = new Map(), seenV = new Map();
  for (const p of state.parties) {
    if (p.owner !== "player") continue;
    for (const id of p.members || []) {
      if (seenS.has(id)) out.push(`survivor ${id} on teams ${seenS.get(id)} and ${p.id}`);
      seenS.set(id, p.id);
      const s = survivorById(state, id);
      if (s && s.alive && !(s.location && s.location.kind === "party" && s.location.partyId === p.id)) out.push(`survivor ${id} on team ${p.id} but located ${JSON.stringify(s.location)}`);
    }
    if (new Set(p.members || []).size !== (p.members || []).length) out.push(`team ${p.id} lists someone twice`);
    for (const v of partyVehicles(state, p)) {
      if (seenV.has(v.id)) out.push(`vehicle ${v.id} on teams ${seenV.get(v.id)} and ${p.id}`);
      seenV.set(v.id, p.id);
      if (!(v.loc && v.loc.kind === "party" && v.loc.partyId === p.id)) out.push(`vehicle ${v.id} on team ${p.id} but at ${JSON.stringify(v.loc)}`);
    }
    for (const pool of [p.supplies || {}, (p.cargo && p.cargo.supplies) || {}]) for (const [k, q] of Object.entries(pool)) if (typeof q === "number" && (!Number.isFinite(q) || q < -1e-6)) out.push(`team ${p.id} has ${q} ${k}`);
  }
  for (const s of state.survivors || []) {
    if (!s.alive || !s.location || s.location.kind !== "party") continue;
    const p = state.parties.find((x) => x.id === s.location.partyId);
    if (!p) out.push(`survivor ${s.id} located on team ${s.location.partyId}, which is gone`);
    else if (!(p.members || []).includes(s.id)) out.push(`survivor ${s.id} located on team ${p.id}, which does not list them`);
  }
  for (const v of state.vehicles || []) {
    if (!v.loc || v.loc.kind !== "party") continue;
    const p = state.parties.find((x) => x.id === v.loc.partyId);
    if (!p || !partyVehicles(state, p).includes(v)) out.push(`vehicle ${v.id} located on team ${v.loc.partyId}, which does not have it`);
  }
  return out;
}
