// Teamwork on job trips (the user's request 2026-10-20: "People that do the same job in the same tile help each other
// and if an event occurs it involves both of them including battles. If loot is gathered it goes to one of them
// randomly.").
//
// A crew: two or more people of one base out on the same job trip to the same tile at the same time (jobtrips.js s.trip:
// the same base, job and tile, and crewKey's route end when a trip has one: t.dest; their trips overlapping in time).
// Same-job workers of a base already go to the same tile (jobtrips.js tripTarget: one tile a base and job) and set out at
// the window's start, so crews form by themselves; nothing has to send them together. Generic by the trip's job: a
// hauler's trips (a later branch) pair up the same way as long as they keep s.trip with base, job and tile.
//   - Output: each member's load × teamMult (TEAM: +15% for a pair, +5% for each one more, at most +25%); a noisy job
//     pays some of it back (TEAM.noise: hunting −10% a member past the first, at most −15%: two hunters scare game);
//     Fetch water's buckets are what they are (TEAM.noBonus). Read when the load is rolled (jobtrips.js rollLoad) from
//     the mates whose work overlapped theirs (t.mates, kept on both sides so a mate home first still counts).
//   - Trouble (tripevents.js): one roll for the crew (the first of them to set out rolls and covers the mates whose trip
//     lies within its own: t.evLead / t.evBy), never one each. When it fires it involves everyone of the crew out at
//     that moment (crewOf): the lead's t.ev.crew, the mates' t.follow = { sid, at, what } (they hold while the lead's
//     card or battle is open). Their worth together against the trouble, the best skill of the crew where one is
//     checked, hits shared out, an accident on one of them, a find carried by one of them (shareLoot).
//   - The dead: TEAM.deadMore more for each extra member (2 of the dead met by a pair: 3), the battle map with the whole
//     crew (loneattack.js tripAttackSetup fighterIds). An animal leaves a crew alone more often (TEAM.beastLeave).
//   - Loot as items (a find): to one member by the dice (seeded: the seed, the event's own seed, the people's keys: never
//     the process-wide ids), into their carry if it has room, else the next member, else carried in hand as before (the
//     armory when they are home). Bulk supplies go into the base's stores as before.
//   - AI parity (grouptrips.js, groupworks.js): their outdoor workers go out in crews of groupCrew (their people out by
//     day at a base, shared over the wood and the food jobs); a crew of two or more fells a build's wood that much
//     faster (teamMult on the crew-days) and loses fewer on the land (TEAM.aiRisk, TEAM.aiWound).
import { atBase, survivorById } from "./world.js";
import { personKey } from "./members.js"; // the dice the same in every world on the seed (call-time only)
import { hash01 } from "./skills.js";
import { stow } from "./inventory.js";

export const TEAM = {
  pair: 0.15, more: 0.05, cap: 0.25, // output: +15% each for a pair, +5% for each one more, at most +25%
  noise: { hunt: 0.1 }, noiseCap: 0.15, // a noisy job: − this a member past the first (game hears a crew)
  noBonus: { water: true },           // two buckets are two buckets
  deadMore: 0.4,                      // the dead that come at a crew: × (1 + deadMore × (n − 1)), rounded
  beastLeave: 0.5,                    // an animal sizing up a crew goes: × (1 + beastLeave × (n − 1))
  cover: 0.5,                         // hours: a lead's trip covers a mate's that starts and ends within this of it
  aiRisk: 0.6, aiWound: 0.75,         // an AI group's crew of two or more on the land: deaths and wounds ×
};
// Hooks for other trip systems (hauling): TEAM_HOOKS.key(t) → a crew key of their own, or null for the default.
export const TEAM_HOOKS = { key: null };
// The crew key of a trip: the base, the job, the tile (and a route's end).
export function crewKey(t) {
  if (!t) return "";
  const k = TEAM_HOOKS.key ? TEAM_HOOKS.key(t) : null;
  return k != null ? k : `${t.base}:${t.job}:${t.tile}${t.dest != null ? `>${t.dest}` : ""}`;
}
// × on each member's load for a crew of n on `job` (1 alone).
export function teamMult(job, n) {
  if (!(n >= 2)) return 1;
  const bonus = TEAM.noBonus[job] ? 0 : Math.min(TEAM.cap, TEAM.pair + TEAM.more * (n - 2));
  const noise = Math.min(TEAM.noiseCap, (TEAM.noise[job] || 0) * (n - 1));
  return Math.round((1 + bonus - noise) * 1000) / 1000;
}
// The dead that come at a crew of n, from the n0 a lone worker would meet.
export const crewDead = (n0, n) => (n >= 2 ? n0 + Math.round(n0 * TEAM.deadMore * (n - 1)) : n0);

const overlaps = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;
// The people of s's base out on the same trip (crewKey) whose trip (work: whose work) overlaps [from, to): s first, the
// rest in the base's order. opts.free: leave out anyone held by trouble of their own (a card, a battle).
export function crewAt(state, s, from, to = from + 1e-6, opts = {}) {
  const t = s && s.trip;
  if (!t) return s ? [s] : [];
  const key = crewKey(t);
  const out = [s];
  for (const x of atBase(state, t.base)) {
    const u = x.trip;
    if (x === s || !u || crewKey(u) !== key) continue;
    if (opts.work ? !overlaps(u.arrive, u.workEnd, from, to) : !overlaps(u.leave, u.home, from, to)) continue;
    if (opts.free && ((u.ev && (u.ev.pending || u.ev.battle)) || u.follow)) continue;
    out.push(x);
  }
  return out;
}
// The mates whose work overlapped s's trip (now and as recorded: t.mates), each told of s too. Returns the crew size.
export function noteMates(state, s, t = s.trip) {
  if (!t) return 1;
  const ids = new Set(t.mates || []);
  for (const x of crewAt(state, s, t.arrive, Math.max(t.workEnd, t.arrive + 1e-6), { work: true })) {
    if (x === s) continue;
    ids.add(x.id);
    const u = x.trip;
    if (!u.mates) u.mates = [];
    if (!u.mates.includes(s.id)) u.mates.push(s.id);
  }
  if (ids.size) t.mates = [...ids];
  let n = 1;
  for (const id of ids) { const x = survivorById(state, id); if (x && x.alive) n++; }
  return n;
}
// Whose crew roll covers this trip: a mate already armed as the lead whose trip lies around this one (or null).
export function coveredBy(state, s, t) {
  for (const x of crewAt(state, s, t.leave, t.home)) {
    if (x === s) continue;
    const u = x.trip;
    if (u.evLead && u.leave <= t.leave + TEAM.cover && u.home >= t.home - TEAM.cover) return x;
  }
  return null;
}
// "Mara", "Mara and Ben", "Mara, Ben and Jo" (first names).
export const firstName = (s) => String(s && s.name ? s.name : s || "").split(" ")[0];
export function namesText(list, full = false) {
  const n = list.map((s) => (full ? s.name : firstName(s)));
  return n.length <= 1 ? n[0] || "" : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}
// The mates out with s at time t, by first name ("" alone): the activity line's "with Mara".
export function matesText(state, s, at = state.hour) {
  if (!s || !s.trip) return "";
  const list = crewAt(state, s, at).slice(1);
  return list.length ? namesText(list) : "";
}

// ---------- loot ----------
// Who of the crew gets an item: one by the dice (the seed, `salt`, the people's keys, the item's place in the list),
// then the next while the first has no room. Stowed on them (inventory.js stow: a slot, a pocket, the pack), marked
// item.tripFind (into the armory when they are home: tripevents.js bankFinds). Returns the person, or null when none
// of them has room. dry: who would get it, nothing moved (the tests).
export function shareLoot(state, crew, item, salt = "", i = 0, dry = false) {
  const people = crew.filter((x) => x && x.alive);
  if (!people.length) return null;
  const keys = people.map((x) => personKey(state, x.id));
  const start = Math.floor(hash01("teamloot", state.seed, salt, i, item.key, keys.join(",")) * people.length) % people.length;
  for (let j = 0; j < people.length; j++) {
    const x = people[(start + j) % people.length];
    if (dry) return x;
    item.tripFind = true;
    if (stow(x, item)) return x;
    delete item.tripFind;
  }
  return null;
}

// ---------- the AI groups ----------
// Their outdoor workers at a base go out in crews of this many: their people out by day at a base (outShare of a
// base's people) shared over the wood and the food jobs, rounded (at least 1).
export const groupCrew = (f, outShare) => Math.max(1, Math.round((f.pop / Math.max(1, f.bases.length)) * outShare / 2));
