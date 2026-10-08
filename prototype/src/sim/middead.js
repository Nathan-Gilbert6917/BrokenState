// The mid game's special dead (game year 5 on, tier-2 growths: hiveconst.js GROWTHS ossuary, scaffold, wormpit,
// cistern, hollow; their stats in ZTYPES, every number of theirs in MIDDEAD). Each asks for a different answer:
// - Boneback: plates of bone over its front. A shot or blow from the half it faces does MIDDEAD.BONEBACK.FRONT of its
//   damage (a critical one CRIT_FRONT), from the side or behind all of it; fire gets round the plates, a blast does
//   BLAST. Hit, it turns to face whoever hit it, so a second shooter from another side does the work (bonebackMult,
//   afterHit). Combat.js damage asks.
// - Climber: goes over the cells in CLIMBER.CLIMB (a wall section, a fence, a barricade, a closed gate, cars, crates)
//   at CLIMBER.COST extra moves a cell, never stopping on one, and up or down a level without a ladder (combat.js
//   reachable and distField ask climbOver). At a base's walls on the State Map some get over even when the horde is
//   held (climberSlip: defences.js, fought inside with the crawlers that slipped past).
// - Flinger: winds up for a turn at someone it sees within FLINGER.RANGE (you see it coming), then throws: a worm swarm
//   (carriers.js releaseSwarm, the Carrier's swarm) lands next to them. COOLDOWN turns between throws, THROWS a battle.
//   A hit of DROP or more while it winds up, or any blow from next to it, makes it drop the mass at its own feet;
//   killed while winding up, the same (afterHit, onDeath).
// - Sower: on the State Map every tile a horde with Sowers crosses gets Infection (sowTile, hordes.js onHordeEnter;
//   its own function and numbers, apart from anything else that spreads the worm). In battle each enemy turn one
//   stands, the battle's infection rises (sowerRound): more of the dead drawn by noise, faster Heat in a raid.
// - Nightmare: hangs back; once it has seen your people it screams every NIGHTMARE.EVERY turns (nightmareTurn): Heat
//   in a raid, noise in any battle (the dead it draws), the dead within WAKE tiles wake, and each of your people within
//   RANGE tiles holds their nerve at HOLD (+ brave, − cowardly, + NEAR with a friend beside them) or panics: their
//   next turn is spent running, to the way out if the map has one (a raid's zones, the evac strip), else as far from
//   the dead as they can get (terrorRuns, combat.js startPlayerTurn).
// Battles without these kinds play exactly as before: no dice are drawn here unless one of them is on the map.
import { MIDDEAD, ZTYPES } from "./hiveconst.js";
import { say, fx, active, adjacent, reachable, pathTo, moveAlong, los, distField, inEvac, zoneAt, alertNear, CELL } from "./combat.js";
import { hangBack } from "./zombietypes.js";
import { releaseSwarm } from "./carriers.js";
import { log } from "./world.js";
import { earHold, deafen, HEAR } from "./hearing.js"; // ear protection against the scream

const BB = MIDDEAD.BONEBACK, CL = MIDDEAD.CLIMBER, FL = MIDDEAD.FLINGER, SW = MIDDEAD.SOWER, NM = MIDDEAD.NIGHTMARE;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const people = (b) => b.units.filter((o) => o.side === "player" && active(o));
const sees = (b, u, t) => dist(u, t) <= (u.sight || 9) && los(b, u.x, u.y, t.x, t.y);

// ---------- Boneback ----------
// Does it face the attacker (the attacker in the half in front of it)? Never moved: it faces the fight.
export function facesToward(t, a) {
  const f = t.face || [0, 0];
  if (!f[0] && !f[1]) return true;
  return (a.x - t.x) * f[0] + (a.y - t.y) * f[1] > 0;
}
// × the damage a hit does to a Boneback (combat.js damage, bestShot): its plates by where the hit comes from.
export function bonebackMult(t, a, hit) {
  if (!hit || hit.how === "fire" || hit.how === "acid" || !a) return 1;
  if (hit.how === "blast") return BB.BLAST;
  return facesToward(t, a) ? (hit.crit ? BB.CRIT_FRONT : BB.FRONT) : 1;
}

// ---------- after a hit (combat.js damage) ----------
// t was hit for eff by a and lives: a Boneback turns on its attacker, a Flinger winding up may drop its mass.
export function afterHit(b, t, a, hit, eff) {
  if (t.ztype === "boneback" && a && (a.x !== t.x || a.y !== t.y)) t.face = [Math.sign(a.x - t.x), Math.sign(a.y - t.y)];
  if (t.ztype === "flinger" && t.windup != null && (eff >= FL.DROP || (hit && (hit.how === "melee" || hit.how === "bash")))) dropMass(b, t, `${t.name} reels and drops the mass of worms at its own feet.`);
}
// t has just died: a Flinger winding up drops what it held.
export function onDeath(b, t) {
  if (t.ztype === "flinger" && t.windup != null) dropMass(b, t, `${t.name} falls, and the mass of worms it held spills out beside it.`);
}
function dropMass(b, u, text) {
  u.windup = null;
  u.cd = FL.COOLDOWN;
  u.throws = (u.throws || 0) + 1;
  if (releaseSwarm(b, u.x, u.y, u.power)) say(b, text, "good");
}

// ---------- Climber ----------
const CLIMB = new Set(CL.CLIMB);
export const climbs = (u) => !!u && u.ztype === "climber";
// Can this unit go over a cell of this kind (not stopping on it)? A closed gate too.
export const climbOver = (u, k) => climbs(u) && (CLIMB.has(k) || k === "gate");

// ---------- Flinger ----------
export function flingerTurn(b, u) {
  const foes = people(b);
  if (!foes.length) return false;
  if (foes.some((f) => adjacent(u, f))) { if (u.windup != null) dropMass(b, u, `${u.name} is set upon and drops its mass of worms.`); return false; } // claws like the rest
  if (u.windup != null) {
    let t = b.units.find((o) => o.id === u.windup);
    if (!t || !active(t) || dist(u, t) > FL.RANGE + 1 || !los(b, u.x, u.y, t.x, t.y)) t = nearestMark(b, u, foes); // its mark got away: the nearest one it can reach
    if (!t) { dropMass(b, u, `${u.name} has nobody to throw at and lets its mass of worms slop to the ground.`); u.ap = 0; return true; }
    throwAt(b, u, t);
    u.ap = 0;
    return true;
  }
  if (!(u.cd > 0) && (u.throws || 0) < FL.THROWS) {
    const t = nearestMark(b, u, foes);
    if (t) {
      u.windup = t.id;
      u.face = [Math.sign(t.x - u.x), Math.sign(t.y - u.y)];
      say(b, `${u.name} scoops up a writhing mass of worms and winds up to throw it at ${t.name}. Hit it hard now and it drops it.`, "danger");
      fx(b, { type: "loot", to: [u.x, u.y], text: "WINDS UP" });
      u.ap = 0;
      return true;
    }
  }
  return hangBack(b, u, foes, ZTYPES.flinger.keep);
}
function nearestMark(b, u, foes) {
  let best = null;
  for (const f of foes) if (dist(u, f) <= FL.RANGE && sees(b, u, f) && (!best || dist(u, f) < dist(u, best))) best = f;
  return best;
}
function throwAt(b, u, t) {
  u.windup = null;
  u.cd = FL.COOLDOWN;
  u.throws = (u.throws || 0) + 1;
  u.face = [Math.sign(t.x - u.x), Math.sign(t.y - u.y)];
  fx(b, { type: "shot", from: [u.x, u.y], to: [t.x, t.y], hit: true, side: "enemy", worm: true });
  const w = releaseSwarm(b, t.x, t.y, u.power);
  say(b, w ? `${u.name} hurls its mass of worms: it slaps down next to ${t.name} and comes apart into a worm swarm.` : `${u.name} hurls its mass of worms at ${t.name}, but it splatters on nothing.`, "danger");
}

// ---------- Sower ----------
// The start of each enemy turn (combat.js endPlayerTurn): each Sower on its feet thickens the ground with eggs.
export function sowerRound(b) {
  const n = b.units.filter((u) => u.ztype === "sower" && active(u)).length;
  if (!n) return;
  if (b.sowBase == null) b.sowBase = b.infection || 0;
  const was = b.infection || 0;
  b.infection = Math.min(b.sowBase + SW.BATTLE_MAX, was + SW.BATTLE * n, 1);
  if (!b.raid) b.reinfMax = Math.max(b.reinfMax || 0, Math.round(b.infection * 5));
  if (b.infection > was && !b.sowSaid) {
    b.sowSaid = true;
    say(b, "The ground around the Sower crawls with the worm's eggs: the noise will draw more of the dead while it stands.", "danger");
  }
}
// A horde enters a tile on the State Map (hordes.js onHordeEnter): with Sowers in it, the land gets Infection
// (SOWER.PER a Sower, at most PASS a pass, never over CAP). Only tile.infection: it fades back to the land's own level
// as Infection always does (hives.js radiate). Your bases within NOTE_RANGE hear of it once a day. Returns the rise.
export function sowTile(state, h) {
  const share = (h.mix && h.mix.sower) || 0;
  if (!share) return 0;
  const t = state.tiles[h.tile];
  if (!t) return 0;
  const add = Math.min(SW.PASS, SW.PER * h.size * share, Math.max(0, SW.CAP - (t.infection || 0)));
  if (add <= 0) return 0;
  t.infection = Math.round(((t.infection || 0) + add) * 1000) / 1000;
  const day = Math.floor(state.hour / 24);
  for (const base of state.bases) {
    if (state.grid.distance(base.tile, h.tile) > SW.NOTE_RANGE || (base.sownDay === day)) continue;
    base.sownDay = day;
    const bt = state.tiles[base.tile];
    log(state, `A horde carrying Sowers crossed the land by ${base.name}: the ground is thick with the worm's eggs (Infection there ${Math.round((bt.infection || 0) * 100)}%, and fading).`, "danger");
  }
  return add;
}

// ---------- Nightmare ----------
export function nightmareTurn(b, u) {
  const foes = people(b);
  if (!foes.length || foes.some((f) => adjacent(u, f))) return false; // cornered: it claws like the rest
  if (!(u.screamCd > 0) && foes.some((f) => sees(b, u, f))) {
    scream(b, u, foes);
    u.screamCd = NM.EVERY;
    u.ap = 0;
    return true;
  }
  if (!u.seenYou && !foes.some((f) => sees(b, u, f))) return false; // it walks in until it sees you
  u.seenYou = true;
  return hangBack(b, u, foes, ZTYPES.nightmare.keep);
}
function scream(b, u, foes) {
  u.seenYou = true;
  fx(b, { type: "scream", from: [u.x, u.y], to: [u.x, u.y], hit: true, text: "SCREAM", side: "enemy" });
  if (b.raid) b.raid.heat = Math.min(100, (b.raid.heat || 0) + NM.HEAT);
  b.noise = (b.noise || 0) + NM.NOISE;
  alertNear(b, u.x, u.y, NM.WAKE, "The scream wakes the dead all around.");
  const panicked = [];
  for (const f of foes) {
    if (dist(u, f) > NM.RANGE || f.terror) continue;
    const friend = b.units.some((o) => o !== f && o.side === "player" && active(o) && adjacent(o, f));
    const hold = Math.max(0.05, Math.min(0.95, NM.HOLD + (f.nerve || 0) + (friend ? NM.NEAR : 0) + earHold(f))); // hearing.js: ear protection, deafened
    if (b.rng.chance(hold)) continue;
    f.terror = true;
    f.ow = false;
    panicked.push(f.name.split(" ")[0]);
    fx(b, { type: "loot", to: [f.x, f.y], text: "PANIC" });
  }
  deafen(b, u.x, u.y, HEAR.SCREAM); // hearing.js: right next to it, the scream rings in the ears too
  say(b, `${u.name} screams, a sound no throat should make${b.raid ? ` (Heat +${NM.HEAT})` : ""}.${panicked.length ? ` ${panicked.join(", ")} ${panicked.length === 1 ? "panics and will run" : "panic and will run"} next turn.` : " Your people hold their nerve."}`, panicked.length ? "danger" : "info");
}
// The start of your turn (combat.js startPlayerTurn): whoever panicked spends the turn running.
export function terrorRuns(b) {
  for (const u of b.units) {
    if (u.side !== "player" || !u.terror) continue;
    u.terror = false;
    if (!active(u)) continue;
    run(b, u);
    u.ap = 0;
  }
}
// The cells that are a way out: a raid's extraction zones, the evac strip.
function exits(b) {
  const out = [];
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    if (!CELL[b.cells[y * b.w + x].k].walk) continue;
    if ((b.raid && zoneAt(b, x, y) >= 0) || (!b.raid && inEvac(b, x, y))) out.push([x, y]);
  }
  return out;
}
function run(b, u) {
  const r = reachable(b, u, u.mob * 2);
  const way = exits(b);
  const dead = b.units.filter((o) => o.side === "enemy" && active(o));
  let best = null;
  if (way.length) {
    const field = distField(b, way, u);
    for (let i = 0; i < b.w * b.h; i++) if (isFinite(r.dist[i]) && (!best || field[i] + r.dist[i] * 0.01 < best.s)) best = { i, s: field[i] + r.dist[i] * 0.01 };
  } else {
    for (let i = 0; i < b.w * b.h; i++) {
      if (!isFinite(r.dist[i])) continue;
      const x = i % b.w, y = (i / b.w) | 0;
      const s = -(dead.length ? Math.min(...dead.map((o) => Math.hypot(o.x - x, o.y - y))) : 0);
      if (!best || s < best.s) best = { i, s };
    }
  }
  const name = u.name.split(" ")[0];
  if (!best || r.dist[best.i] === 0) { say(b, `${name} panics and cowers where they stand.`, "danger"); return; }
  moveAlong(b, u, pathTo(r, best.i % b.w, (best.i / b.w) | 0));
  say(b, `${name} panics and runs${way.length ? " for the way out" : " from the dead"}.`, "danger");
}

// ---------- at a base's walls (defences.js) ----------
// Climbers that get over the walls even when the horde is held: CLIMBER.SLIP of them, less TOWER with a watchtower
// and MANNED with the defences manned.
export function climberSlip(h, tower, manned) {
  const share = (h.mix && h.mix.climber) || 0;
  if (!share) return 0;
  const seen = Math.min(1, (tower ? CL.TOWER : 0) + (manned ? CL.MANNED : 0));
  return Math.round(h.size * share * CL.SLIP * (1 - seen));
}
