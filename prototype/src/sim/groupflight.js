// AI groups fleeing the dead (user, 2026-10-08: "AI groups fleeing from hordes"). A group that sees a horde coming it
// cannot hold off, or whose base the dead have just overrun, leaves: it falls back to another of its bases, settles a
// new site away from the horde, or as a last resort goes over to an ally; the base it left stands abandoned (its works,
// some of the stores) for whoever comes (groupworld.js leaveGroupBase / occupyAbandoned). Coarse and cheap: one check a
// day for the world and one at the moment a horde walks in (hordes.js onHordeEnter), counts rather than people.
//
// You have no such button: your answer to a horde you cannot hold is your own (pull a team out of a battle, move people
// between bases: moveout.js, give up an outpost). The groups' version is that choice made for them, by the numbers.
//
// Cannot hold: the dead's weight on the walls (hordes.js hordeWallPower: the horde's size × 0.12, × 1.6 with a
// Wallbreaker at its head, × its special dead) at least RATIO × the base's defence (the same sum factions.js
// resolveOrdinaryRaid uses: the walls, 0.8 × the group's strength, a military group's Humvee at its main base).
//   - Ahead (flightDaily): the hordes within NEAR tiles whose target or goal is the base, summed. ODDS a day × the
//     type's GROUP_PRIORITIES flee (zealots stand their ground, traders and communes run) they go before it arrives:
//     STRAGGLE of their people are lost on the way, and LEAVE of the base's share of the stores stays behind.
//   - Overrun (hordeOverrun, after the fight): the dead won and were RATIO × the defence: they go (a chance of the
//     type's flee, at most 1), OVERRUN_STRAGGLE lost on the way and OVERRUN_LEAVE of the base's stores left.
// Where to: another of its bases with no horde coming (the nearest; it becomes the main one if the lost one was); else
// a free site SITE tiles off (CLEAR from any group's base, CLEAR_YOU from yours, HIVE from a hive, HORDE from any horde,
// AWAY tiles farther from the dead than the old base, never one they ran from in the last REVISIT days; the farthest
// from any horde, a base left standing counting KEPT_PULL tiles more); else an
// ally within ALLY_RANGE (a member of its bloc, a pact, or relation ALLY_REL or better) takes them in: the group joins
// it (people, stores, kit, vehicles) and is gone. With none of these they stay and fight. Not again for GAP days.
// What they left behind is half spoiled (groupworld.js ABANDON.STOCK), the rest in the abandoned base. Your captives
// held there go with them. You hear of it (a log line) when their radio is heard (radio.js canHearGroup), the base is in
// sight, or it is a group you know within HEAR tiles of a base of yours. Rolls are hashes: the world's dice are not
// touched. How often (tools/flighttest.js rate; 2026-10-08, six Normal worlds, a year each on the Balanced autopilot):
// 21 flights, about 3.5 a world-year (0 to 8 a world, most where hordes roam thick), nearly all falling back to another
// base or settling a new site; none taken in by an ally (there is nearly always a site).
import { day, log } from "./world.js";
import { hash01 } from "./skills.js";
import { weightOf, tickOf } from "./groupcare.js";
import { strength, recomputeOwnership, collapseFaction, GROUP_BREAK } from "./factions.js";
import { groupBaseDefence } from "./groupworks.js";
import { groupTurretPower, factionVehicles } from "./vehicles.js";
import { leaveGroupBase, abandonedAt, occupyAbandoned, ABANDON } from "./groupworld.js";
import { hordeWallPower } from "./hordes.js";
import { relation, pactBetween } from "./diplomacy.js";
import { sameBloc } from "./blocs.js";
import { canHearGroup } from "./radio.js";
import { removeFromArsenal, addToArsenal } from "./arsenal.js";
import { tileLabel } from "./parties.js";

export const FLIGHT = {
  NEAR: 3, RATIO: 1.6, ODDS: 0.5,
  STRAGGLE: [0.02, 0.06], OVERRUN_STRAGGLE: [0.04, 0.1], LEAVE: 0.35, OVERRUN_LEAVE: 0.6,
  SITE: [3, 10], AWAY: 2, CLEAR: 3, CLEAR_YOU: 4, HIVE: 5, HORDE: 6, REVISIT: 90, KEPT_PULL: 2,
  ALLY_RANGE: 15, ALLY_REL: 35, GAP: 10, HEAR: 12,
};
const h = (state, ...k) => hash01(state.seed, "flight", ...k);
const live = (state) => state.factions.filter((f) => f.alive && !f.outsider && f.bases.length && !f.hcNoGrow);

// The base's defence against the dead (factions.js resolveOrdinaryRaid's sum, without a bloc's help).
export const baseHold = (state, f, tile) => groupBaseDefence(state, f, tile) + strength(f) * 0.8 + (tile === f.bases[0] ? groupTurretPower(f) : 0);
// The hordes coming for a base: within NEAR tiles, its tile their target or their goal.
export function hordesComing(state, tile) {
  const g = state.grid;
  return (state.hordes || []).filter((x) => x.tile !== tile && g.distance(x.tile, tile) <= FLIGHT.NEAR && (x.target === tile || (x.goal && x.goal.tile === tile)));
}
// Can they hold this base against these hordes?
export const cannotHold = (state, f, tile, hordes) => hordes.length > 0 && hordes.reduce((s, x) => s + hordeWallPower(x), 0) >= FLIGHT.RATIO * baseHold(state, f, tile);

// ---------- where to ----------
function fallbackBase(state, f, tile) {
  const g = state.grid;
  return f.bases.filter((b) => b !== tile && !hordesComing(state, b).length).sort((a, b) => g.distance(a, tile) - g.distance(b, tile) || a - b)[0] ?? null;
}
export function fleeSite(state, f, tile, from) {
  const F = FLIGHT, g = state.grid;
  const awayFrom = (id) => Math.min(...from.map((x) => g.distance(x, id)));
  const need = awayFrom(tile) + F.AWAY;
  const dead = (id) => Math.min(99, ...(state.hordes || []).map((x) => g.distance(x.tile, id))); // the nearest horde of any
  const fled = (rec) => rec.from === f.id && day(state) - rec.day < F.REVISIT; // a place they ran from lately: not back there
  const ok = (t) => {
    if (!t || t.hive || !((t.loc && t.loc.type !== "city") || abandonedAt(state, t.id))) return false;
    const rec = abandonedAt(state, t.id);
    if (rec && fled(rec)) return false;
    if (t.owner != null && t.owner !== f.id) return false;
    if (awayFrom(t.id) < need) return false;
    if (state.bases.some((b) => g.distance(b.tile, t.id) < F.CLEAR_YOU)) return false;
    if ((state.hives || []).some((hv) => g.distance(hv.tile, t.id) < F.HIVE)) return false;
    if ((state.hordes || []).some((x) => g.distance(x.tile, t.id) < F.HORDE)) return false;
    return state.factions.every((o) => !o.alive || o.bases.every((b) => b === tile || g.distance(b, t.id) >= F.CLEAR));
  };
  const cands = g.within(tile, F.SITE[1]).filter((id) => g.distance(id, tile) >= F.SITE[0]).map((id) => state.tiles[id]).filter(ok);
  if (!cands.length) return null;
  const score = (t) => dead(t.id) + (abandonedAt(state, t.id) ? F.KEPT_PULL : 0); // away from all the dead; a standing base is worth a little
  cands.sort((a, b) => score(b) - score(a) || a.id - b.id);
  return cands[0].id;
}
function allyFor(state, f, tile) {
  const F = FLIGHT, g = state.grid;
  const near = (o) => Math.min(...o.bases.map((b) => g.distance(b, tile)));
  const friend = (o) => sameBloc(state, f, o) || !!pactBetween(state, f, o) || relation(state, f, o) >= F.ALLY_REL;
  return state.factions.filter((o) => o.alive && o !== f && !o.outsider && o.bases.length && !o.hcNoGrow && near(o) <= F.ALLY_RANGE && friend(o) && !o.bases.some((b) => hordesComing(state, b).length))
    .sort((a, b) => relation(state, f, b) - relation(state, f, a) || near(a) - near(b) || a.id - b.id)[0] || null;
}

// ---------- leaving ----------
// They leave `tile` (the hordes at or coming from `from`): how = "ahead" | "overrun". Returns { to: "base" | "site" |
// "ally", tile, ally, lost } or null (nowhere to go: they stay).
export function fleeBase(state, f, tile, from, how = "ahead", d = day(state)) {
  const F = FLIGHT;
  if (!f.alive || !f.bases.includes(tile)) return null;
  let dest = fallbackBase(state, f, tile), to = "base", ally = null;
  if (dest == null) { dest = fleeSite(state, f, tile, from); to = "site"; }
  if (dest == null) { ally = allyFor(state, f, tile); to = "ally"; }
  if (dest == null && !ally) return null;
  const [lo, hi] = how === "overrun" ? F.OVERRUN_STRAGGLE : F.STRAGGLE;
  const lost = Math.min(Math.max(0, f.pop - GROUP_BREAK - 1), Math.round(f.pop * (lo + (hi - lo) * h(state, f.name, tickOf(f), tile, "straggle"))));
  f.pop -= lost;
  if ((f.wounded || 0) > f.pop) f.wounded = f.pop;
  // What they cannot carry stays (half of it spoiled, the rest in the abandoned base).
  const share = (how === "overrun" ? F.OVERRUN_LEAVE : F.LEAVE) / f.bases.length;
  const left = {};
  for (const [k, q] of Object.entries(f.stock)) { const n = Math.floor((q > 0 ? q : 0) * share); if (n > 0) { left[k] = n; f.stock[k] -= n; } }
  const wasMain = f.bases[0] === tile;
  f.bases = f.bases.filter((b) => b !== tile);
  const rec = leaveGroupBase(state, f, tile, 0); // groupworld.js: its works stand, for whoever comes
  if (rec) for (const [k, n] of Object.entries(left)) rec.stock[k] = Math.floor(n * ABANDON.STOCK);
  if (f.works) delete f.works[tile];
  if (f.jails) delete f.jails[tile];
  f.fledDay = d;
  f.flights = (f.flights || 0) + 1;
  state.stats.groupFlights = (state.stats.groupFlights || 0) + 1;
  if (ally) {
    joinAlly(state, f, ally, tile);
  } else {
    if (to === "site") {
      f.bases.unshift(dest);
      occupyAbandoned(state, f, dest); // groupworld.js: the works and stores left there are theirs
    } else if (wasMain) f.bases = [dest, ...f.bases.filter((b) => b !== dest)];
    moveCaptives(state, f, tile, f.bases[0]);
    recomputeOwnership(state);
  }
  announce(state, f, tile, to, dest, ally, how);
  return { to, tile: dest, ally, lost };
}
// Your people held at the base they left go with them (or, when they join an ally, walk home: collapseFaction).
function moveCaptives(state, f, from, to) {
  for (const s of state.survivors) if (s.location && s.location.factionId === f.id && s.location.tile === from) s.location.tile = to;
}
// Taken in by an ally: everything they have goes over, and the group is no more.
function joinAlly(state, f, ally, tile) {
  ally.pop += f.pop;
  for (const [k, q] of Object.entries(f.stock)) if (q > 0) ally.stock[k] = (ally.stock[k] || 0) + q;
  if (f.arsenal) for (const it of [...f.arsenal.items]) { removeFromArsenal(f, it, "joined"); addToArsenal(state, ally, it, "joined"); }
  if (ally.arsenal) ally.arsenal.pop0 = ally.pop;
  for (const v of factionVehicles(f).splice(0)) { v.owner = ally.id; factionVehicles(ally).push(v); }
  ally.wounded = (ally.wounded || 0) + (f.wounded || 0);
  f.pop = 0;
  f.joinedAlly = ally.id;
  collapseFaction(state, f, null, { into: ally });
}
function announce(state, f, tile, to, dest, ally, how) {
  const g = state.grid;
  const near = f.known && state.bases.some((b) => g.distance(b.tile, tile) <= FLIGHT.HEAR);
  if (!(canHearGroup(state, f) || state.live.has(tile) || near || (ally && canHearGroup(state, ally)))) return;
  const who = f.known ? f.name : "A group nearby";
  const why = how === "overrun" ? "after the dead broke in" : "ahead of a horde they could not hold off";
  const where = to === "ally" ? `and went over to ${ally.known ? ally.name : "a friendly group"}` : to === "site" ? `for ${tileLabel(state, dest)}` : `and fell back to their base at ${tileLabel(state, dest)}`;
  log(state, `${who} abandoned ${tileLabel(state, tile)} ${why}, ${where}. The place stands empty.`, "danger");
}

// ---------- the day and the moment ----------
// Once a day for the world (factions.js factionsDaily, after the groups): hordes coming at a base they cannot hold.
export function flightDaily(state, d = day(state)) {
  const F = FLIGHT;
  for (const f of live(state)) {
    if (f.fledDay != null && d - f.fledDay < F.GAP) continue;
    for (const tile of [...f.bases]) {
      const coming = hordesComing(state, tile);
      if (!cannotHold(state, f, tile, coming)) continue;
      if (h(state, f.name, tickOf(f), tile, "flee") >= F.ODDS * weightOf(f, "flee", 1)) continue;
      if (fleeBase(state, f, tile, coming.map((x) => x.tile), "ahead", d)) break;
    }
  }
}
// A horde has just fought its way into a base of theirs (hordes.js onHordeEnter): att, def before the fight.
export function hordeOverrun(state, f, tile, att, def, held) {
  if (held || !f || !f.alive || f.outsider || f.hcNoGrow || !f.bases.includes(tile) || att < FLIGHT.RATIO * def) return null;
  if (h(state, f.name, tickOf(f), tile, "overrun") >= Math.min(1, weightOf(f, "flee", 1))) return null;
  return fleeBase(state, f, tile, [tile], "overrun");
}
