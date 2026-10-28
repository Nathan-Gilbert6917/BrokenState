// @ts-check
// Attacks on a camp or base by the dead and the raiders nearby (the heat epic #64 §5, issue #69; the user's request
// 2026-10-26: "Higher zombie and Raider activity on the map and tile means more attacks against your camp. So you are
// incentivized to reduce the activity of the zombies and raiders in the area starting with the POI ones and later the
// attraction of zombies and raiders from the tile as a whole. … if there is a high level of zombies in a tile and you
// reduced a POI to no zombies by killing them loudly you will get a lot more zombies trickling in to the map as turns
// go by.").
//
// Every hour (campAttackHour, from campscout.js groundsHour, staging.js campsHour) each tile with a base on it (yours,
// and the AI groups' homes: groupbases.js homesOf) rolls hash dice (the seed, the tile or base, the hour; never the
// world's random numbers) for three kinds of attack:
//   - THE GROUNDS (per base): the dead left on the base's own grounds (groundsLeft: base.grounds.dead, a blind camp's
//     campscout.js pool, or a POI camp's: #70 fills base.grounds) come at it. Chance an hour GROUNDS_P (about every
//     30 hours, the old GROUNDS.EVERY 18–42) at GROUNDS_FULL or more left, × left / GROUNDS_FULL below it (at least
//     GROUNDS_LO).
//   - THE TILE'S TRICKLE (per tile, shared): the open ground's dead not on any base's grounds (trickleFree: openDead −
//     Σ the grounds that live in the open ground) wander in. Chance an hour TRICKLE_P × fill³ (fill = trickleFree / the
//     tile's cap, deadpop.js popCap; at the base's × 1): a high tile (fill 0.75) about every 28 hours, a medium one (0.45)
//     every 5–6 days, the top of low (0.28) every 3 weeks, 0.15 every 5 months; at 0 never. One roll for the whole tile, at the loudest base's multiplier, and the
//     wave goes to that base: several bases on one tile (one per POI and one normal base, #70) share it, never
//     multiplied by the number of bases.
//   - RAIDERS (per tile, shared; camps and outposts only, never a main hub: banded): a band from the tile's raiders (deadpop.js poiRaiders of a POI camp's POI first, then
//     the open ground's). Chance an hour RAID_P × fill³ of the raiders against their cap (raiderCap): at the cap about
//     every 3 days, 0.7 every 10 days, a medium level (0.45) every 5 weeks, a low one hardly ever. The hostile groups' raids
//     (factions.js launchRaid) and the hives' hordes (hordes.js) are not these and are unchanged.
// THE MULTIPLIERS (mult): night NIGHT (the dead move in the dark; DAY by day: raiders the same both); for the dead only, the tile's noise
// memory (deadpop.js noiseOf: shots, loud kills, other groups' raids, the last few days) × (1 + noise × NOISE_K), at most
// NOISE_HI; the base's own loudness (its base Heat, hordes.js baseHeat: its people, the fire, the vehicles, the
// workshops, the generator, shots lately; an AI home: half its people) × (LOUD_BASE + heat × LOUD_K) between LOUD_LO and
// LOUD_HI; raiders only: × RAID_SOFT ÷ the base's defence (factions.js baseDefense), between SOFT_LO and 1 (bandits pick
// soft targets: a small camp is theirs, a strong hub hardly ever); its stance and kit: running silent (hiding.js base.silent) × SILENT, camouflage netting standing × CAMO.
// No attack comes within COOLDOWN hours of the last at that base (no raider band within RAID_COOLDOWN of the last band), to an empty base (nobody home), during a fight or
// while the last card is unanswered.
// THE WAVE (waveSource: where a wave comes from; at a POI camp the grounds' part comes out of its Not cleared rooms,
// #71 poirooms.js roomWave, w.rooms):
// the grounds' part first (GROUNDS_WAVE, + GROUNDS_BIG over GROUNDS_BIG_AT left, at most what is left), then the
// trickle's part (TRICKLE_MIN + trickleFree × TRICKLE_SHARE, × up to TRICKLE_LOUD on a loud tile, at most TRICKLE_MAX,
// ± a die), drawn OUT of the open ground (deadpop.js drawFromTile) as the wave forms: while it is at the camp, no other
// base, raid or hunt can meet the same dead. A raider band: RAID_BAND by the raider level, drawn out (drawRaiders, a
// POI's first). Every attacker comes out of a pool; WAVE_MAX at most (a battle's most).
// THE FIGHT (yours): a camp or shelter (buildings.js isShelter) gets the card "The dead come out of the woods at …"
// (Defend the camp: the base defence battle on the base map, defences.js fightNow, handler "campAttack"; or keep out of
// their way: food and meds spoiled). A base past the camp stage whose defences hold the wave (defences.js holdCheck)
// cuts it down at the walls by the numbers, a line in the log and no card; one that would not hold gets the card.
// Raiders the same ("Raiders found …": Defend, or hide and lose some of the stores), except that a base past the camp
// stage whose defence (factions.js baseDefense) is RAID_HOLD × the band's strength sees them size it up and move on (the
// band back on the open ground).
// THE KILLS (settleWave, the handler and by the numbers): the grounds' share first (campscout.js takeDead: off the
// grounds and the tile), then the drawn: all put back (putBack, putBackRaiders) and the killed taken off through
// deadpop.js killDead / killRaiders (the recent-kill memory and the noise: loud with guns), so the ones that walked away
// alive are on the open ground again. A wave left hanging (its card dropped by a save, its fight gone) is put back the
// next hour (settleStale).
// THE AI (docs/adr/0001): the groups' homes (main bases and outposts, their camps among them; h.grounds when #70 gives a
// POI camp grounds) roll by the same rules and draw from the same pools; a wave is fought by the numbers at once:
// their defence (AI_PERSON a person at home + AI_WALL a wall works) against the wave (a raider counts RAIDER_WEIGHT):
// all killed when it holds, else as many as it holds, the rest put back and the stores spoiled (AI_SPOIL).
// SAVES: base.campAttack = { after, rafter, n, wave: { g, d, r, rp, poi } } (the next hour an attack may come, a raider
// band may come, the attacks so far, the wave out at the camp now)
// are plain data; a base without it (an older save) starts with none pending and no cooldown; nothing else is stored.
import { hardMult } from "./hardrules.js";
import { hash01 } from "./skills.js";
import { popCap, raiderCap, openDead, openRaiders, poiRaiders, noiseOf, deadBand, raiderBand, drawFromTile, drawRaiders, putBack, putBackRaiders, killDead, killRaiders } from "./deadpop.js";
import { log, addCard, homeAt, isNight, localId } from "./world.js";
import { registerCombatHandler } from "./combat.js";
import { fightNow, holdCheck } from "./defences.js";
import { isShelter, count } from "./buildings.js";
import { baseHeat } from "./hordes.js";
import { homesOf } from "./groupbases.js";
import { membersAt } from "./members.js";
import { siteThreat } from "./siteclear.js";
import { baseDefense } from "./factions.js";
import { tileThreatEstimate } from "./threatknow.js"; // #67: the levels as your people see them
import { scaleFood } from "./foods.js";
import { GROUNDS, groundsWord, takeDead } from "./campscout.js"; // call-time only (campscout.js groundsHour calls this module)
import { roomWave, roomsKilled, refreshWay } from "./poirooms.js"; // #71: a POI camp's waves out of its Not cleared rooms (call-time only)

export const CAMP_ATTACK = {
  GROUNDS_P: 1 / 30, GROUNDS_FULL: 10, GROUNDS_LO: 0.4,     // the grounds' dead: an hour's chance, full from this many left
  TRICKLE_P: 1 / 12,                                         // the tile's trickle: an hour's chance × fill³
  RAID_P: 1 / 80,                                            // raiders: an hour's chance × their fill³
  NIGHT: 1.5, DAY: 0.8,                                      // the dead by night and by day
  NOISE_K: 1 / 25, NOISE_HI: 3,                              // × (1 + the tile's noise × NOISE_K), at most NOISE_HI
  LOUD_BASE: 0.75, LOUD_K: 0.025, LOUD_LO: 0.6, LOUD_HI: 2,  // the base's own Heat
  SILENT: 0.7, CAMO: 0.8,                                    // running silent, camouflage netting
  COOLDOWN: 6,                                               // hours after an attack before the next at that base
  RAID_COOLDOWN: 72,
  RAID_SOFT: 14, SOFT_LO: 0.1,                               // raiders pick soft targets: × (RAID_SOFT ÷ the base's defence), between SOFT_LO and 1                                         // hours after a raider band before the next band at that base
  GROUNDS_WAVE: [3, 8], GROUNDS_BIG: 4, GROUNDS_BIG_AT: 30,  // the grounds' part of a wave
  TRICKLE_MIN: 2, TRICKLE_SHARE: 0.03, TRICKLE_MAX: 10, TRICKLE_LOUD: 1.5, // the trickle's part (× 1 + noise / 100, at most TRICKLE_LOUD)
  RAID_BAND: [2, 5],                                         // a raider band: 2 + 3 × the raider fill, ± 1
  RAID_HOLD: 1.5,                                            // a base past the camp stage with this × a band's strength in defence: they move on
  RAIDER_POWER: 3.5,                                         // a raider's power on the card's fight (campsite.js CAMPSITE.POWER)
  WAVE_MAX: 20,                                              // a battle's most (combat.js MAX_ENEMIES)
  SPOIL: 0.9, RAID_TAKE: 0.85,                               // kept out of their way: the food and meds kept; hid from raiders: the stores kept
  AI_PERSON: 2, AI_WALL: 3, RAIDER_WEIGHT: 2, AI_SPOIL: 0.95, // the AI's fight by the numbers
};
const C = CAMP_ATTACK;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const die = (state, ...salt) => hash01(state.seed, "campatk", ...salt);
const rollIn = (state, lohi, ...salt) => lohi[0] + Math.floor(die(state, ...salt) * (lohi[1] - lohi[0] + 1));

// ---------- who is on a tile ----------
// A base on the map: yours (state.bases) or an AI group's home. { base, key (for the dice), f (the group or null) }.
/** @param {any} state @returns {Map<number, any[]>} */
function basesByTile(state) {
  const by = new Map();
  const add = (tile, x) => { if (tile == null) return; const l = by.get(tile); if (l) l.push(x); else by.set(tile, [x]); };
  for (const b of state.bases || []) if (!b.group) add(b.tile, { base: b, key: diceKey(state, b), f: null });
  for (const f of state.factions || []) {
    if (!f || !f.alive || !Array.isArray(f.bases) || !f.bases.length) continue;
    const H = homesOf(state, f);
    for (const tile of f.bases) if (H[tile]) add(tile, { base: H[tile], key: diceKey(state, H[tile], f), f });
  }
  return by;
}
// A base's dice: by its tile and POI (one base per POI and one normal base a tile, #70), never by its id (ids count up
// across every world made in one process: two worlds of one seed must roll the same). A group's by its world-local id
// (world.js localId; issue #78: the raw f.id gave two worlds of one seed different attacks on the groups' homes).
/** @param {any} state @param {any} base @param {any} [f] */
const diceKey = (state, base, f = null) => `${f ? `f${localId(state, f.id)}` : "b"}:${base.tile}:${base.poi != null ? base.poi : "-"}`;
/** Your bases and the groups' homes on a tile. @param {any} state @param {number} tile */
export const basesOn = (state, tile) => basesByTile(state).get(tile) || [];

// ---------- the pools ----------
/** The dead left on a base's own grounds (#70 fills a POI camp's base.grounds). @param {any} state @param {any} base */
export const groundsLeft = (state, base) => Math.max(0, (base && base.grounds && base.grounds.dead) || 0);
// The grounds that live in the tile's open ground (a blind camp's: campscout.js mapDead), not in a POI.
const openGrounds = (state, list) => list.reduce((a, x) => a + (x.base.poi == null ? groundsLeft(state, x.base) : 0), 0);
/** The tile's open ground dead free to trickle in: not on any base's grounds. @param {any} state @param {number} tile @param {any[]} [list] */
export function trickleFree(state, tile, list = basesOn(state, tile)) {
  return Math.max(0, openDead(state, tile) - openGrounds(state, list));
}
const trickleFill = (state, tile, list) => { const cap = popCap(state, tile); return cap > 0 ? Math.min(1, trickleFree(state, tile, list) / cap) : 0; };
const raiderFill = (state, tile) => { const cap = raiderCap(state, tile); return cap > 0 ? Math.min(1, (openRaiders(state, tile) + poisRaiders(state, tile)) / cap) : 0; };
const poisRaiders = (state, tile) => { const t = state.tiles[tile]; let s = 0; const n = (t && t.pois && t.pois.length) || 0; for (let i = 0; i < n; i++) s += poiRaiders(state, tile, i); return s; };

// ---------- the odds ----------
/** The base's own loudness: its base Heat (yours), half its people (a group's). @param {any} state @param {any} x */
function loudness(state, x) {
  if (x.f) return membersAt(x.f, x.base.tile).length / 2;
  try { return baseHeat(state, x.base); } catch { return 0; }
}
/**
 * The base's multiplier on every attack's chance now: { mult, night, noise, loud, parts } (night, the tile's noise, the
 * base's loudness, its stance and kit). @param {any} state @param {any} x a basesOn entry @param {boolean} [dead] the dead's (night counts) or raiders'
 */
export function attackMult(state, x, dead = true) {
  const night = isNight(state);
  const noise = noiseOf(state, x.base.tile);
  const loud = loudness(state, x);
  const parts = [];
  let m = 1;
  if (dead) { m *= night ? C.NIGHT : C.DAY; parts.push(night ? "night" : "day"); }
  const nm = dead ? Math.min(C.NOISE_HI, 1 + noise * C.NOISE_K) : 1; // noise draws the dead, not raiders
  if (nm > 1.05) parts.push(`the tile's noise ×${Math.round(nm * 10) / 10}`);
  const lm = clamp(C.LOUD_BASE + loud * C.LOUD_K, C.LOUD_LO, C.LOUD_HI);
  parts.push(`the base's own Heat ×${Math.round(lm * 100) / 100}`);
  m *= nm * lm;
  if (!dead) { const sm = softTarget(state, x); if (sm < 0.99) { m *= sm; parts.push(`its defence ×${Math.round(sm * 100) / 100} (raiders pick soft targets)`); } }
  if (x.base.silent) { m *= C.SILENT; parts.push("running silent"); }
  if (!x.f && x.base.buildings && count(x.base, "camo") > 0) { m *= C.CAMO; parts.push("camouflage netting"); }
  const hm = hardMult(state, "CAMP_ATTACK"); // hardrules.js: Hardcore's camps are attacked more
  if (hm !== 1) { m *= hm; parts.push(`Hardcore ×${hm}`); }
  return { mult: m, night, noise, loud, parts };
}
// Raiders pick soft targets: a band's strength (RAID_SOFT: a usual band × RAIDER_POWER) over the base's defence
// (factions.js baseDefense; a group's home: AI_PERSON a person at home + AI_WALL a wall works, × 3), between SOFT_LO and 1.
function softTarget(state, x) {
  let def = 0;
  if (x.f) def = (membersAt(x.f, x.base.tile).length * C.AI_PERSON + ((x.f.works && x.f.works[x.base.tile] && x.f.works[x.base.tile].walls) || 0) * C.AI_WALL) * 3;
  else { try { def = baseDefense(state, x.base); } catch { def = 0; } }
  return clamp(C.RAID_SOFT / Math.max(1, def), C.SOFT_LO, 1);
}
/** The grounds' chance an hour before the multipliers. @param {any} state @param {any} base */
export const groundsRate = (state, base) => { const g = groundsLeft(state, base); return g > 0 ? C.GROUNDS_P * Math.max(C.GROUNDS_LO, Math.min(1, g / C.GROUNDS_FULL)) : 0; };
/** The tile's trickle chance an hour before the multipliers. @param {any} state @param {number} tile @param {any[]} [list] */
export const trickleRate = (state, tile, list = basesOn(state, tile)) => C.TRICKLE_P * trickleFill(state, tile, list) ** 3;
/** The tile's raider chance an hour before the multipliers. @param {any} state @param {number} tile */
export const raidRate = (state, tile) => C.RAID_P * raiderFill(state, tile) ** 3;
// The base on a tile that the trickle and the raiders go to: the loudest (the first of yours on a tie).
const loudest = (state, list, dead) => {
  let best = null, bm = -1;
  for (const x of list) { const a = attackMult(state, x, dead); if (a.mult > bm + 1e-9) { best = { x, a }; bm = a.mult; } }
  return best;
};
/**
 * A base's odds an hour now: { grounds, trickle, raiders, any, every (hours between attacks of any kind, Infinity for
 * none), mult, parts, target (whether the tile's trickle and raiders come to this base) }. For the Camp tab, the
 * forecast and the tests. @param {any} state @param {any} base
 */
export function attackOdds(state, base) {
  const list = basesOn(state, base.tile);
  const x = list.find((e) => e.base === base) || { base, key: "", f: null };
  const a = attackMult(state, x, true), ar = attackMult(state, x, false);
  const lt = loudest(state, list.length ? list : [x], true);
  const target = !lt || lt.x.base === base;
  const g = Math.min(1, groundsRate(state, base) * a.mult);
  const t = target ? Math.min(1, trickleRate(state, base.tile, list) * a.mult) : 0;
  const rl = list.filter((e) => banded(e.base)), lr2 = rl.length ? loudest(state, rl, false) : null;
  const r = banded(base) && (!lr2 || lr2.x.base === base) ? Math.min(1, raidRate(state, base.tile) * ar.mult) : 0;
  const any = 1 - (1 - g) * (1 - t) * (1 - r);
  return { grounds: g, trickle: t, raiders: r, any, every: any > 0 ? 1 / any : Infinity, mult: a.mult, parts: a.parts, target };
}
/** The same odds over a whole day (10 hours of night, 14 of day): the hours between attacks. @param {any} state @param {any} base */
export function attackEvery(state, base) {
  const o = attackOdds(state, base);
  const m = o.mult > 0 ? (10 * C.NIGHT + 14 * C.DAY) / 24 / (isNight(state) ? C.NIGHT : C.DAY) : 1;
  const dead = 1 - (1 - Math.min(1, o.grounds * m)) * (1 - Math.min(1, o.trickle * m));
  const any = 1 - (1 - dead) * (1 - o.raiders);
  return { ...o, dayAny: any, deadEvery: dead > 0 ? 1 / dead : Infinity, raidEvery: o.raiders > 0 ? 1 / o.raiders : Infinity, every: any > 0 ? 1 / any : Infinity };
}

/** Hours as words: "~30 h", "every ~4 days", "hardly ever". @param {number} h */
export const everyText = (h) => (!isFinite(h) || h > 24 * 60 ? "hardly ever" : h < 48 ? `every ~${Math.max(1, Math.round(h / 5) * 5)} h` : `every ~${Math.round(h / 24)} days`);
/**
 * The Camp tab's line (ui/ui.js nearbyRow) and the forecast's: { text ("the dead medium, raiders low · an attack every
 * ~30 h"), why, every, warn }. The levels are the player's estimate of the tile (threatknow.js, #67: live while the
 * base is on it), else its bands.
 * @param {any} state @param {any} base
 */
export function nearbyView(state, base) {
  const o = attackEvery(state, base);
  // The player's estimate (threatknow.js, #67: live while the base is on the tile), else the bands themselves (a group's).
  let e = null;
  try { e = base.group ? null : tileThreatEstimate(state, base.tile); } catch { e = null; }
  const d = (e && e.dead) || deadBand(state, base.tile), r = (e && e.raiders) || raiderBand(state, base.tile);
  const g = groundsLeft(state, base);
  const parts = [`the dead ${d.word}`, `raiders ${r.word}`];
  if (g > 0) parts.push(`${base.grounds && base.grounds.known === false ? "?" : g} on the grounds`);
  const text = `${parts.join(", ")} · an attack ${everyText(o.every)}`;
  const why = `The dead: ${everyText(o.deadEvery)}${o.target ? "" : " (the tile's trickle goes to a louder base here)"}; raiders: ${everyText(o.raidEvery)}. Now: ${o.parts.join(", ")}.`;
  return { text, why, every: o.every, deadEvery: o.deadEvery, raidEvery: o.raidEvery, warn: o.every < 48 };
}

// ---------- the wave ----------
/**
 * Where a wave comes from (#71 replaces this with the POI camp's Not cleared rooms): the grounds' part (counted, not
 * yet killed: campscout.js takeDead takes the killed off), then the trickle's part drawn out of the open ground, and a
 * raider band drawn out (the base's POI first). Returns { g, d, r, rp, poi } (grounds, drawn dead, raiders drawn from
 * the POI and the open ground, which POI) or null for nothing.
 * @param {any} state @param {any} base @param {{ grounds?: boolean, trickle?: boolean, raiders?: boolean }} hit @param {any[]} [list]
 */
export function waveSource(state, base, hit, list = basesOn(state, base.tile)) {
  const tile = base.tile, salt = [diceKey(state, base, base.fid != null ? { id: base.fid } : null), state.hour];
  let g = 0, d = 0, r = 0, rp = 0, rooms = null;
  if (hit.grounds) {
    const left = groundsLeft(state, base);
    const hi = C.GROUNDS_WAVE[1] + (left > C.GROUNDS_BIG_AT ? C.GROUNDS_BIG : 0);
    g = Math.min(left, C.WAVE_MAX, rollIn(state, [C.GROUNDS_WAVE[0], hi], ...salt, "gw"));
    if (g && base.poiCamp && base.poi != null) { const rw = roomWave(state, base, g); g = rw.total; rooms = rw.rooms; } // poirooms.js (#71): out of the Not cleared rooms, open routes first, slowed by shut doors
  }
  if (hit.trickle) {
    const free = trickleFree(state, tile, list);
    const loud = Math.min(C.TRICKLE_LOUD, 1 + noiseOf(state, tile) / 100);
    const want = clamp(Math.round((C.TRICKLE_MIN + free * C.TRICKLE_SHARE) * loud) + rollIn(state, [-1, 1], ...salt, "tw"), 1, C.TRICKLE_MAX);
    d = drawFromTile(state, tile, Math.min(free, want, C.WAVE_MAX - g));
  }
  if (hit.raiders) {
    const fill = raiderFill(state, tile);
    const want = clamp(Math.round(C.RAID_BAND[0] + fill * 3) + rollIn(state, [-1, 1], ...salt, "rw"), C.RAID_BAND[0], C.RAID_BAND[1]);
    const poi = base.poi != null ? base.poi : null;
    if (poi != null) { rp = Math.min(want, poiRaiders(state, tile, poi)); if (rp) takePoiRaiders(state, tile, poi, rp); }
    r = drawRaiders(state, tile, want - rp);
  }
  if (!(g + d + r + rp)) return null;
  return { g, d, r, rp, poi: base.poi != null ? base.poi : null, ...(rooms ? { rooms } : {}) };
}
// The POI's raiders drawn out: killRaiders takes them off the POI (quietly: no noise, no kill memory for raiders), and
// settleWave puts back the ones that got away into the POI.
const takePoiRaiders = (state, tile, poi, n) => killRaiders(state, tile, poi, n);
/**
 * A wave's end: kills off the pools (the grounds' first, then the drawn), the rest put back. Returns the kills
 * { dead, raiders }. o.brokeIn (#71, a fight lost at a POI camp): the trickle's survivors go into the place, not back
 * out. @param {any} state @param {any} base @param {any} w the wave (waveSource) @param {number} killedDead
 * @param {number} killedRaiders @param {{ loud?: boolean, brokeIn?: boolean }} [o]
 */
export function settleWave(state, base, w, killedDead, killedRaiders, o = {}) {
  const tile = base.tile;
  let kg = Math.min(w.g, Math.max(0, Math.round(killedDead)));
  if (kg && w.rooms) roomsKilled(base, w.rooms, kg); // poirooms.js (#71): off the rooms they came out of
  if (kg) kg = base.grounds ? takeDead(state, base, kg) : killDead(state, tile, base.poi != null ? base.poi : null, kg, o);
  const kd = Math.min(w.d, Math.max(0, Math.round(killedDead) - kg));
  if (w.d) { putBack(state, tile, null, w.d); if (kd) killDead(state, tile, null, kd, o); }
  if (o.brokeIn && w.d > kd && base.poiCamp && base.poi != null) { const n = drawFromTile(state, tile, w.d - kd), got = n ? putBack(state, tile, base.poi, n) : 0; if (n > got) putBack(state, tile, null, n - got); } // #71: the trickle's survivors got into the place (its Not cleared rooms nearest the edge)
  const kr = Math.min(w.r + w.rp, Math.max(0, Math.round(killedRaiders)));
  if (w.rp) putBackRaiders(state, tile, w.poi, w.rp);
  if (w.r) putBackRaiders(state, tile, null, w.r);
  if (kr) killRaiders(state, tile, w.rp ? w.poi : null, kr, o);
  if (base.campAttack) { delete base.campAttack.wave; }
  if (base.poiCamp && base.poi != null) refreshWay(state, base, "after the attack"); // poirooms.js (#71): the way out after every grounds attack
  return { dead: kg + kd, raiders: kr };
}

// ---------- the hour ----------
const pendingCard = (state, base) => (state.cards || []).some((c) => c.campAttack === base.id || c.grounds === base.id);
const ca = (base) => base.campAttack || (base.campAttack = { after: 0 });
// A wave whose card or fight is gone (a save dropped the card): back to the pools.
function settleStale(state, base) {
  const s = base.campAttack;
  if (!s || !s.wave || state.combat || pendingCard(state, base)) return;
  settleWave(state, base, s.wave, 0, 0);
}
/** Every hour: the attacks on every base (yours and the groups'). @param {any} state */
export function campAttackHour(state) {
  const by = basesByTile(state);
  for (const [tile, list] of by) {
    for (const x of list) if (!x.f && x.base.campAttack) settleStale(state, x.base);
    const can = list.filter((x) => ready(state, x));
    if (!can.length) continue;
    const hits = new Map();
    const hit = (x, k) => { const h = hits.get(x) || {}; h[k] = true; hits.set(x, h); };
    for (const x of can) if (groundsRate(state, x.base) > 0 && die(state, x.key, state.hour, "g") < groundsRate(state, x.base) * attackMult(state, x, true).mult) hit(x, "grounds");
    const lt = loudest(state, can, true);
    if (lt && die(state, "t", tile, state.hour) < trickleRate(state, tile, list) * lt.a.mult) hit(lt.x, "trickle");
    const free = can.filter((x) => !hits.has(x)); // a raider band never comes in the same hour as the dead
    const rfree = free.filter((x) => banded(x.base) && !(x.base.campAttack && state.hour < (x.base.campAttack.rafter || 0)));
    const lr = rfree.length ? loudest(state, rfree, false) : null;
    if (lr && die(state, "r", tile, state.hour) < raidRate(state, tile) * lr.a.mult) hit(lr.x, "raiders");
    for (const [x, h] of hits) {
      const w = waveSource(state, x.base, h, list);
      if (!w) continue;
      const s = ca(x.base);
      s.after = state.hour + C.COOLDOWN;
      s.n = (s.n || 0) + 1;
      if (h.raiders) s.rafter = state.hour + C.RAID_COOLDOWN;
      if (x.base.grounds && h.grounds) x.base.grounds.next = state.hour + C.COOLDOWN;
      if (x.f) aiWave(state, x, w);
      else playerWave(state, x.base, w);
    }
  }
}
/**
 * An attack now, whatever the dice (the tests, a scripted event): the wave from the pools by `hit`, then your base's
 * card (or the walls' line) or the group's fight. Returns the wave, or null when the pools had nothing.
 * @param {any} state @param {any} base @param {{ grounds?: boolean, trickle?: boolean, raiders?: boolean }} [hit]
 */
export function attackNow(state, base, hit = { grounds: true }) {
  const list = basesOn(state, base.tile);
  const x = list.find((e) => e.base === base) || { base, key: "", f: null };
  const w = waveSource(state, base, hit, list);
  if (!w) return null;
  const s = ca(base);
  s.after = state.hour + C.COOLDOWN;
  s.n = (s.n || 0) + 1;
  if (x.f) aiWave(state, x, w); else playerWave(state, base, w);
  return w;
}
// Raider bands go for camps and outposts, never a main hub (yours or a group's: the hostile groups' raids are what come at
// those, factions.js launchRaid).
/** @param {any} base */
export const banded = (base) => !!base && base.type !== "hub";
// Can an attack come to this base now?
function ready(state, x) {
  const b = x.base, s = b.campAttack;
  if (s && state.hour < (s.after || 0)) return false;
  if (b.grounds && b.grounds.next && state.hour < b.grounds.next && !(s && s.after)) return false; // a blind camp's first hours (campscout.js GROUNDS.FIRST)
  if (x.f) return membersAt(x.f, b.tile).length > 0;
  if (s && s.wave) return false;
  return !state.combat && !pendingCard(state, b) && homeAt(state, b.id).length > 0;
}

// ---------- yours ----------
/** The wave at your base: a card, or cut down at the walls by the numbers. @param {any} state @param {any} base @param {any} w */
export function playerWave(state, base, w) {
  ca(base).wave = w;
  const dead = w.g + w.d, raiders = w.r + w.rp;
  if (dead && !raiders && !isShelter(base)) {
    const hc = holdCheck(state, base, dead);
    if (hc.holds) {
      const k = settleWave(state, base, w, dead, 0);
      log(state, `${dead} of the dead came out of ${groundsWord(state, base.tile)} at ${base.name}: cut down at the walls (${k.dead} killed).`, "info");
      return null;
    }
  }
  if (raiders && !dead && !isShelter(base)) {
    let def = 0;
    try { def = baseDefense(state, base); } catch { def = 0; }
    if (def >= raiders * C.RAIDER_POWER * C.RAID_HOLD) {
      settleWave(state, base, w, 0, 0);
      log(state, `A band of ${raiders} raiders from round ${groundsWord(state, base.tile)} sized up ${base.name}'s defences and moved on.`, "info");
      return null;
    }
  }
  const card = attackCard(state, base, w);
  addCard(state, card);
  return card;
}
/** The card: Defend (the base defence battle) or keep out of their way / hide. @param {any} state @param {any} base @param {any} w */
export function attackCard(state, base, w) {
  const where = groundsWord(state, base.tile), dead = w.g + w.d, raiders = w.r + w.rp;
  const g = base.grounds;
  const from = w.g && w.d ? `off the camp's grounds and from ${where} round it` : w.g ? "off the camp's grounds" : `from ${where}: the tile's dead, drawn to the camp`;
  const left = g && g.dead > 0 ? (g.known ? ` About ${g.dead} more are out on the grounds (Clear the dead from the base grounds, or let them come).` : " How many more are out on the grounds is unknown (?).") : "";
  const nearby = ` Nearby: the dead ${deadBand(state, base.tile).word}, raiders ${raiderBand(state, base.tile).word}.`;
  const title = raiders && !dead ? `Raiders found ${base.name}` : `The dead come out of ${where} at ${base.name}`;
  const text = raiders && !dead ? `A band of ${raiders} raiders from round ${where} found ${base.name} and are coming for its stores.${nearby}`
    : `About ${dead} of the dead are coming at ${base.name}, ${from}.${left}${nearby}`;
  return {
    title, campAttack: base.id, grounds: w.g ? base.id : undefined, raidReport: { baseId: base.id },
    text,
    choices: [
      { label: "Defend the camp", default: true, hint: `A fight on ${base.name}'s map: whoever is home against about ${dead + raiders}. Every one killed is one fewer out there.`, resolve: (st) => defendWave(st, base.id) },
      { label: raiders && !dead ? "Hide and let them take what they find" : "Keep out of their way", hint: raiders && !dead ? "Everyone hides: the raiders carry off some of the stores and go." : "Everyone stays out of sight while they pick through the camp: some of the food and meds are spoiled, and the dead are still out there.", resolve: (st) => keepClear(st, base.id) },
    ],
  };
}
/**
 * A wave made elsewhere and sent at your base whatever the dice and the walls (sim/firstweekattack.js: the first week's
 * attack): always its card (Defend or hide), the cooldown and the count as any attack. `extra` is laid over the card
 * (its title; a lead line before its text, or a text of its own). Returns the card. @param {any} state @param {any} base @param {any} w @param {any} [extra]
 */
export function scriptedWave(state, base, w, extra = {}) {
  const s = ca(base);
  s.wave = w;
  s.after = state.hour + C.COOLDOWN;
  s.n = (s.n || 0) + 1;
  const card = attackCard(state, base, w);
  if (extra.text) card.text = extra.text;
  else if (extra.lead) card.text = `${extra.lead} ${card.text}`;
  if (extra.title) card.title = extra.title;
  addCard(state, card);
  return card;
}
/** Defend: the base defence battle (headless played out). @param {any} state @param {number} baseId */
export function defendWave(state, baseId) {
  const base = (state.bases || []).find((b) => b.id === baseId);
  const w = base && base.campAttack && base.campAttack.wave;
  if (!w) return "";
  const dead = Math.min(C.WAVE_MAX, w.g + w.d), raiders = dead ? 0 : Math.min(C.WAVE_MAX, w.r + w.rp); // campAttackHour: never both in one wave
  const th = siteThreat(state, base.tile);
  if (base.grounds) base.grounds.waves = (base.grounds.waves || 0) + 1;
  const enemy = raiders && !dead ? { kind: "raiders", count: raiders, power: C.RAIDER_POWER, name: `raiders from round ${groundsWord(state, base.tile)}` }
    : { kind: "zombies", count: dead, power: th.power || 2, mix: th.mix || null, name: `the dead from ${groundsWord(state, base.tile)}` };
  fightNow(state, {
    tile: base.tile, baseId: base.id, enemy, ambush: null, canRetreat: true, handler: "campAttack", layout: "baseDefence", downedLive: 0.4, deploy: true,
    context: { baseId: base.id, dead, raiders, wave: dead + raiders, grounds: !!base.grounds, night: isNight(state), ...(w.rooms ? { rooms: w.rooms } : {}) }, // rooms: fort.js places those dead in their rooms (poirooms.js, #71)
  });
  return "";
}
function keepClear(state, baseId) {
  const base = (state.bases || []).find((b) => b.id === baseId);
  if (!base) return "";
  const w = base.campAttack && base.campAttack.wave;
  const raiders = w ? w.r + w.rp : 0, dead = w ? w.g + w.d : 0;
  if (w) settleWave(state, base, w, 0, 0);
  const keep = raiders && !dead ? C.RAID_TAKE : C.SPOIL;
  base.stock.meds = Math.floor((base.stock.meds || 0) * keep);
  scaleFood(base, keep);
  if (raiders && !dead) base.stock.scrap = Math.floor((base.stock.scrap || 0) * keep);
  const text = raiders && !dead ? `${base.name}'s people hid while the raiders went through the camp: they carried off some of the food, meds and scrap.` : `${base.name}'s people kept out of sight while the dead picked through the camp: some of the food and meds were spoiled. The dead are still out there.`;
  log(state, text, "danger");
  return text;
}
registerCombatHandler("campAttack", (state, result, setup) => {
  const c = setup.context;
  const base = (state.bases || []).find((b) => b.id === c.baseId);
  const w = base && base.campAttack && base.campAttack.wave;
  if (!base || !w) return;
  const won = result.outcome === "victory";
  const killed = won ? c.wave : Math.min(c.wave, result.enemiesKilled || 0);
  const kd = Math.min(c.dead, killed), kr = Math.min(c.raiders, killed - kd);
  const k = settleWave(state, base, w, kd, kr, { loud: (result.ammoUsed || 0) > 0, brokeIn: !won });
  if (won) { log(state, `${base.name} held: ${k.dead + k.raiders} attackers cut down.`, "good"); return; }
  base.stock.meds = Math.floor((base.stock.meds || 0) * 0.85);
  scaleFood(base, 0.85);
  log(state, `The attackers got into ${base.name}${k.dead + k.raiders ? ` (${k.dead + k.raiders} of them killed)` : ""}: they tore through the stores before they went off again (food and meds spoiled).`, "danger");
});

// ---------- the groups' ----------
/** A wave at an AI group's home: fought by the numbers at once (the same pools, the same rules). @param {any} state @param {any} x @param {any} w */
function aiWave(state, x, w) {
  const h = x.base, f = x.f;
  const walls = (f.works && f.works[h.tile] && f.works[h.tile].walls) || 0;
  let hold = membersAt(f, h.tile).length * C.AI_PERSON + walls * C.AI_WALL;
  const dead = w.g + w.d, raiders = w.r + w.rp;
  const kr = Math.min(raiders, Math.floor(hold / C.RAIDER_WEIGHT));
  hold -= kr * C.RAIDER_WEIGHT;
  const kd = Math.min(dead, Math.floor(hold));
  const k = settleWave(state, h, w, kd, kr, { loud: true });
  if (kd < dead || kr < raiders) { if (h.stock) scaleFood(h, C.AI_SPOIL); }
  h.attacks = (h.attacks || 0) + 1;
  return k;
}
