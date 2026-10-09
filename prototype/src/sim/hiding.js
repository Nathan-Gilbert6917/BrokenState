// Hidden bases: how hard a base is to find, keeping one quiet (Run silent), camouflage, a known base slipping out of a
// group's knowledge, and the groups' own hidden outposts (AI parity). Coarse: a number a base has today, read by the
// groups' scouting (groupworld.js) and by your people finding theirs; one daily pass. Dice: skills.js hash01 only.
//
// Concealment (concealOf: 0 = in plain sight … HIDE.MAX) of one of your bases, the sum of:
//   - what it is: an outpost HIDE.TYPE.outpost, the hub nothing (everyone knows where the hub is);
//   - the ground: forest, hills or mountains help (HIDE.TERRAIN), a road next to it hurts (HIDE.ROAD);
//   - Run silent (base.silent, set in the base's Defence tab): HIDE.SILENT;
//   - camouflage netting (buildings.js "camo"): HIDE.CAMO;
//   - its noise and fires: Heat (hordes.js baseHeat) above HIDE.HEAT_FREE costs HIDE.HEAT a point (at most HIDE.HEAT_MAX);
//   - floodlights on the walls burning at night (not while running silent): HIDE.LIGHTS;
//   - comings and goings: base.moves (each day + every team or convoy of yours on the road from or to it, and every
//     group's caravan coming to it; × HIDE.MOVES_KEEP a day) × HIDE.MOVES (at most HIDE.MOVES_MAX).
// What it does (groupworld.js): a group's party passing within sight (partySaw) misses it concealment × HIDE.PASS of the
// time; a scout that comes looking (the frontier's new ring, a second look, the patrols near home) misses it
// concealment × HIDE.SCOUT (they search harder). And a base they know but have not seen for HIDE.FORGET_AFTER days
// may slip out of their knowledge: once every HIDE.FORGET_EVERY days, concealment × HIDE.FORGET of the time, when its
// concealment is at least HIDE.FORGET_MIN (forgetDaily). Questioning your people, their bloc and radio gossip, and
// your own radio traffic (intel.js) still tell them; a hidden base says nothing on the air.
// Run silent (base.silent) costs: no radio traffic of this base or its teams (intel.js), the station's calls cannot be
// traced to it, no lights at night, fires kept small and the workshops quiet (Heat: workshops, the fire, the radio and
// a generator count × SILENT.HEAT, hordes.js baseHeat), and production is slower: each station sits idle
// SILENT.WORK_SKIP of its days (buildings.js runStations).
// The groups (AI parity): a group hides some of its outposts (never its main base): weightOf(f, "hide") × HIDE.AI_SHARE
// of them, by the tile's dice (groupcare.js GROUP_PRIORITIES hide). A hidden outpost has concealment HIDE.AI_CONCEAL to
// other groups' scouts, and to you it is not on the map (render, minimap, the tile panel, knowledge snapshots) until
// found: a team of yours within HIDE.FIND_NEAR tiles finds it; in the live view of a base or team, HIDE.FIND_DAILY ×
// (1 − its concealment) a day; a prisoner of theirs questioned tells all their bases. state.intel.unseen holds the
// hidden outposts you have not found ({ tile: groupId }, rebuilt each day), state.intel.found the ones you have.
// The groups' Run silent is their radio: intel.js (weightOf(f, "silent")).
import { count } from "./buildings.js";
import { baseHeat } from "./hordes.js";
import { hash01 } from "./skills.js";
import { weightOf } from "./groupcare.js";
import { day, log, snapshot, localId } from "./world.js";

export const HIDE = {
  TYPE: { hub: 0, outpost: 0.2 },
  TERRAIN: { forest: 0.12, hills: 0.06, mountain: 0.1 },
  ROAD: -0.05,
  SILENT: 0.3, CAMO: 0.25,
  HEAT_FREE: 5, HEAT: 0.015, HEAT_MAX: 0.3,
  LIGHTS: 0.08,
  MOVES: 0.03, MOVES_MAX: 0.25, MOVES_KEEP: 0.85,
  MAX: 0.85,
  PASS: 1, SCOUT: 0.7,
  FORGET_MIN: 0.35, FORGET_AFTER: 30, FORGET_EVERY: 7, FORGET: 0.5,
  AI_SHARE: 0.6, AI_CONCEAL: 0.6, FIND_NEAR: 1, FIND_DAILY: 0.35,
};
export const SILENT = { HEAT: 0.5, WORK_SKIP: 0.25 };
// Words for a concealment level (the Defence tab).
export const HIDE_WORDS = [[0.6, "very well hidden"], [0.4, "well hidden"], [0.2, "partly hidden"], [0.05, "easy to find"], [-1, "in plain sight"]];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = (v) => Math.round(v * 100) / 100;
const intel = (state) => {
  const I = state.intel || (state.intel = {});
  I.found = I.found || {};
  I.unseen = I.unseen || {};
  I.stats = I.stats || {};
  return I;
};
const nearRoad = (state, tile) => !!state.tiles[tile].road || state.grid.neighbors(tile).some((n) => state.tiles[n] && state.tiles[n].road);

// ---------- your bases ----------
// { value, parts: [[label, delta]] } for one of your bases today.
export function concealOf(state, b) {
  const parts = [];
  const add = (label, v) => { if (v) parts.push([label, r2(v)]); };
  add(b.type === "hub" ? "The hub: everyone knows roughly where it is" : "An outpost: off the beaten track", HIDE.TYPE[b.type] || 0);
  const t = state.tiles[b.tile];
  add(`The ground (${t.terrain})`, HIDE.TERRAIN[t.terrain] || 0);
  if (nearRoad(state, b.tile)) add("A road runs past it", HIDE.ROAD);
  if (b.silent) add("Running silent", HIDE.SILENT);
  if (count(b, "camo")) add("Camouflage netting", HIDE.CAMO);
  const heat = baseHeat(state, b);
  if (heat > HIDE.HEAT_FREE) add(`Noise and fires (Heat ${Math.round(heat)})`, -Math.min(HIDE.HEAT_MAX, (heat - HIDE.HEAT_FREE) * HIDE.HEAT));
  if (count(b, "floodlights") && !b.silent) add("Floodlights on the walls at night", -HIDE.LIGHTS);
  if ((b.moves || 0) >= 0.5) add("Comings and goings", -Math.min(HIDE.MOVES_MAX, (b.moves || 0) * HIDE.MOVES));
  const value = r2(clamp(parts.reduce((a, [, v]) => a + v, 0), 0, HIDE.MAX));
  return { value, parts };
}
export const concealWord = (v) => HIDE_WORDS.find(([at]) => v >= at)[1];

// Run silent on or off (the Defence tab). Returns a line for the player.
export function setSilent(state, b, on) {
  if (!b) return "";
  b.silent = !!on;
  return b.silent
    ? `${b.name} runs silent: nothing of it goes on the radio, no lights at night, small fires and quiet workshops (Heat lower), and its stations work ${Math.round((1 - SILENT.WORK_SKIP) * 100)}% of their days.`
    : `${b.name} is back to normal: radio, lights and full work.`;
}

// ---------- the groups' hidden outposts ----------
// Does group f keep the outpost on this tile hidden? (Never its main base.)
export const groupHides = (state, f, tile) => !!f && f.bases.length > 1 && f.bases[0] !== tile && f.bases.includes(tile) && hash01(state.seed, "hide", f.name, tile) < weightOf(f, "hide", 0) * HIDE.AI_SHARE;
// How hard the base on this tile is to find for a group's scouts (0: in plain sight).
export function concealAt(state, tile) {
  const b = state.bases.find((x) => x.tile === tile);
  if (b) return concealOf(state, b).value;
  const o = state.factions.find((f) => f.alive && f.bases.includes(tile));
  return o && groupHides(state, o, tile) ? HIDE.AI_CONCEAL : 0;
}
// Does a group's party or scout miss the base on this tile? mult: HIDE.PASS or HIDE.SCOUT; salt: which look.
export function missesBase(state, f, tile, mult, salt, d = day(state)) {
  const c = concealAt(state, tile);
  return c > 0 && hash01(state.seed, "hide-miss", f.name, tile, d, salt) < c * mult;
}
// A hidden outpost of a group that you have not found yet (render.js, minimap.js, ui.js, world.js snapshot).
export const unseenOutpost = (state, tile) => !!(state.intel && state.intel.unseen && state.intel.unseen[tile] != null);
// Found: on the map from now on.
export function foundOutpost(state, tile, how = "") {
  const I = intel(state);
  if (I.unseen[tile] == null) return false;
  const f = state.factions.find((x) => x.id === I.unseen[tile]);
  delete I.unseen[tile];
  I.found[tile] = day(state);
  I.stats.outpostsFound = (I.stats.outpostsFound || 0) + 1;
  state.knowledge[tile] = snapshot(state, tile);
  if (f && how) log(state, `${how} found a hidden outpost of ${f.known ? f.name : "a group you have not met"}: tucked away out of sight, no smoke, no lights. It is on the map now.`, "good");
  return true;
}
// Every base of a group found at once (a prisoner of theirs talked: prisoners.js gatherIntel).
export function foundAllOf(state, f) {
  if (!f) return;
  for (const t of f.bases) foundOutpost(state, t);
}

// ---------- daily ----------
// Your bases' comings and goings; the groups' hidden outposts you have not found, and the ones you find today.
export function hidingDaily(state) {
  const I = intel(state);
  const d = day(state);
  const g = state.grid;
  for (const b of state.bases) {
    let n = 0;
    for (const p of state.parties) {
      if (!p.path || !p.path.length || p.phase === "siege") continue;
      const ends = p.path[0] === b.tile || p.path[p.path.length - 1] === b.tile;
      if (!ends) continue;
      if (p.owner === "player" && (p.phase === "out" || p.phase === "back")) n++;
      else if (p.owner !== "player" && p.kind === "caravan" && p.baseId === b.id) n++;
    }
    b.moves = Math.round(((b.moves || 0) * HIDE.MOVES_KEEP + n) * 100) / 100;
  }
  // The hidden outposts you have not found (rebuilt: a group may have gained or lost one).
  const unseen = {};
  for (const f of state.factions) {
    if (!f.alive || f.outsider) continue;
    for (const t of f.bases) if (I.found[t] == null && groupHides(state, f, t)) unseen[t] = f.id;
  }
  for (const t of Object.keys(I.found)) if (!state.factions.some((f) => f.alive && f.bases.includes(Number(t)))) delete I.found[t];
  I.unseen = unseen;
  for (const [ts, fid] of Object.entries(unseen)) {
    const t = Number(ts);
    const team = state.parties.find((p) => p.owner === "player" && p.path && p.path.length && g.distance(partyPos(p), t) <= HIDE.FIND_NEAR);
    if (team) { foundOutpost(state, t, "One of your teams"); continue; }
    if (state.live && state.live.has(t) && hash01(state.seed, "hide-find", t, localId(state, fid), d) < HIDE.FIND_DAILY * (1 - HIDE.AI_CONCEAL)) foundOutpost(state, t, "Your lookouts");
  }
}
const partyPos = (p) => p.path[Math.min(p.idx || 0, p.path.length - 1)];

// A group's knowledge of your bases fades when nothing confirms it (groupworld.js groupWorldDaily). Returns how many
// slipped out today.
export function forgetDaily(state, f, d = day(state)) {
  if (!f.knows || (d + Math.floor(hash01(state.seed, "forgetph", f.name) * HIDE.FORGET_EVERY)) % HIDE.FORGET_EVERY !== 0) return 0;
  let n = 0;
  for (const [ts, k] of Object.entries(f.knows.bases)) {
    if (k.kind !== "player" || d - k.day < HIDE.FORGET_AFTER) continue;
    const b = state.bases.find((x) => x.tile === Number(ts));
    if (!b) continue; // a decoy (intel.js) or a base of yours gone: left as it is
    const c = concealOf(state, b).value;
    if (c < HIDE.FORGET_MIN || hash01(state.seed, "forget", f.name, ts, d) >= c * HIDE.FORGET) continue;
    delete f.knows.bases[ts];
    n++;
  }
  if (n) { const I = intel(state); I.stats.forgot = (I.stats.forgot || 0) + n; }
  return n;
}
