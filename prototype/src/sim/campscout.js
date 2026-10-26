// @ts-check
// Scouting a tile before a camp goes up on it, and the dead out on a camp's grounds (the user's request 2026-10-23:
// "The team must scout out the tile prior to having the set up camp with all the information. Or you can still set up
// camp but it will be a random spot on the base build map you will not have the whole map information and other
// information about the surroundings and will need to survey after to get that information. When you set up camp
// this way you will not have to clear out all the zombies in the base build tiles so it will generate events for the
// campsite/base being attacked taking you into a base raid until your base map is cleared of zombies. You can raid
// your base via the POI map to clear out the zombies yourself instead of fighting the unknown amount of waves of
// zombies from events.").
//
// SCOUTED (tileScouted): the tile carries the Survey's stamp (survey.js fullSurveyDone: "Survey this tile", 8 hours
// on it; pois.js revealPois stamps "surveyed" in the hub's record, or in the team's own finds until it reports). No
// new flag: the Survey is the scouting. Hardcore's camps before the first home is founded count as scouted (the
// team that fled there has no home to wait from: hardcore-start.js firstHubPending).
// THE ORDERS (scoutOptions, parties.js orderOptions): on an unscouted tile Set up camp, Establish base and Build
// outpost say so ("Set up camp (unscouted: blind spot)") and each has its Scout first beside it (missions scoutcamp,
// scoutestablish, scoutoutpost: parties.js arrive turns them into the camp's own mission with p.scoutFirst).
// ON ARRIVAL (scoutOrBlind, staging.js pitchArrive): scouted, today's flow (the spot asked for on the tile's map, the
// dead at the spot cleared first: siteclear.js). Scout first: the Survey's task first, the camp's order queued after
// it (on the same tile), so it comes back here scouted. Neither: BLIND, the camp's spot one of the game's dice on
// the 500 × 500 map (blindSite: a valid spot, off the buildings and the high ground where one is found, the same for
// the same world and tile; staging.js campSiteFor reads it too, so the planner's hours are the setup's), nobody asked
// and nothing fought first.
// A BLIND CAMP (blindCamp, after staging.js makeCamp): base.grounds = { dead (the map's dead: GROUNDS.MAP × the dead at
// one spot, siteThreat's rules: the place, the infection, the year, the Dead at sites dial; at most GROUNDS.MAX),
// known: false until a survey, blind, next (the hour the next of them come out), waves, killed }.
// - The base map (basemap.js viewBattle → knownMask): only the ground within GROUNDS.KNOWN_R of the camp fire is seen;
//   the rest lies under the fog (combat.js playerVision) and its hover says it is unknown (ui/basemap.js).
// - The dead come out (groundsHour, from staging.js campsHour): every GROUNDS.EVERY hours (hash dice) while any are
//   left and someone is home, a card "The dead come out of the woods at Calder Woods Camp" (groundsCard): Defend the
//   camp (the base defence battle on the base map: defences.js fightNow, layout "baseDefence", handler
//   "groundsDead"), or keep out of their way (a share of the food and meds spoiled). How many are left: unknown
//   ("?") until the tile is surveyed.
// - Clear them yourself (groundsRaid): a team of yours on the tile, from the POI map (poiraid.js poiPickCard) or its
//   orders (mission "grounds"): a fight on the tile's own map out on the grounds (layout "siteClear", handler
//   "groundsClear") against GROUNDS.RAID_SHARE of what is left.
// - Every kill comes off the pool (takeDead) and off the tile's open ground (deadpop.js killDead; the grounds' dead are
//   never more than the open ground holds: mapDead); at 0 the attacks stop and the log says the grounds are clear.
// - A survey of the tile (groundsSurveyed, survey.js fullSurveyDone) shows it all: the fog lifts and the count shows.
// THE GOVERNOR (autopilot.js): an outpost's team scouts first unless the hub is crowded or the land push is on; a
// first home's team (the exiles) scouts first with 3 days of food in hand; the attacks' cards take Defend the camp.
// AI PARITY (docs/adr/0001): the groups' camps are their own coarse things (groupworks.js, hardcore-groups.js): they
// neither scout nor go blind (staging.js says the same of their camps).
// Everything here uses hash dice (the seed, the tile, the base, the hour): never the world's random numbers.
import { registerCombatHandler, startCombat } from "./combat.js";
import { fightNow } from "./defences.js";
import { siteLand, siteProblem, terrainOf, SITE_RANGE, defaultSite } from "./basemap.js";
import { siteBox } from "./basescatter.js";
import { siteThreat } from "./siteclear.js";
import { openDead, killDead } from "./deadpop.js"; // the dead on the land (issue #65): the grounds' dead are the tile's
import { poiKnowledge } from "./pois.js";
import { LOOK } from "./survey.js";
import { hash01 } from "./skills.js";
import { log, isNight } from "./world.js";
import { partyMembers, partyTile, tileLabel, teamName, awaitOrders, wipeIfEmpty } from "./parties.js";
import { startTask } from "./orders.js";
import { firstHubPending } from "./hardcore-start.js";
import { campAttackHour } from "./campattack.js"; // issue #69: the attacks on a camp by the dead and raiders nearby
import { scaleFood } from "./foods.js";

export const GROUNDS = {
  MAP: 3,               // the whole map's dead: this × the dead at one spot (siteclear.js siteThreat)
  MAX: 60,
  KNOWN_R: 14,          // a blind camp's map is known this many cells round its fire until the tile is surveyed
  FIRST: [6, 18],       // hours after the camp stands before the first of them come out
  EVERY: [18, 42],      // the old flat hours between attacks (issue #69: campattack.js CAMP_ATTACK's hourly chance now; kept for older readers)
  WAVE: [3, 8],         // the dead in an attack (at most what is left); WAVE_BIG more on a map with more than BIG left
  WAVE_BIG: 4, BIG: 30,
  WAVE_MAX: 20,         // a battle's most (combat.js MAX_ENEMIES)
  AVG: 6,               // the waves left, once surveyed: about the dead left ÷ this
  RAID_SHARE: 0.5,      // a raid on the grounds: this share of what is left, at least RAID_MIN (all of it if fewer)
  RAID_MIN: 4,
  RAID_SPOT: [24, 60],  // the raid's fight: this many cells out from the camp on the tile's map
  SPOIL: 0.9,           // kept out of their way: the food and meds kept
  TRIES: 300,           // the blind spot: dice thrown for a spot off the buildings and the high ground
};
export const SCOUT_LABEL = "Scout first";
export const BLIND_NOTE = " (unscouted: blind spot)";
export const GROUNDS_LABEL = "Clear the dead from the base grounds";
// The camp's orders and their Scout first (parties.js MISSIONS: scoutcamp, scoutestablish, scoutoutpost).
const SCOUTED_MISSIONS = { camp: "scoutcamp", establish: "scoutestablish", outpost: "scoutoutpost" };
export const SCOUT_MISSIONS = Object.values(SCOUTED_MISSIONS);
const BIG = new Set(["house", "store", "block", "rise", "slope", "dip", "crag"]);
const roll = (state, lohi, ...salt) => lohi[0] + Math.floor(hash01(state.seed, "grounds", ...salt) * (lohi[1] - lohi[0] + 1));

// ---------- scouted ----------
/** Has the tile been scouted (a Survey's stamp, the hub's or the team's own)? @param {any} state @param {number} tile @param {any} [p] */
export function tileScouted(state, tile, p = null) {
  if (firstHubPending(state)) return true; // hardcore's first home: no home to scout from
  const k = poiKnowledge(state, tile);
  if (k && k.surveyed != null) return true;
  const f = p && p.poiFinds && p.poiFinds.get ? p.poiFinds.get(tile) : null;
  return !!(f && f.surveyed != null);
}
// The orders on a tile (parties.js orderOptions, before it returns): on an unscouted tile Set up camp, Establish base
// and Build outpost marked blind, with Scout first after each. Changes `out` in place.
/** @param {any} state @param {any} p @param {number} tile @param {any[]} out */
export function scoutOptions(state, p, tile, out) {
  if (!p || p.owner !== "player" || tileScouted(state, tile, p)) return out;
  for (let i = out.length - 1; i >= 0; i--) {
    const o = out[i], m = SCOUTED_MISSIONS[o.mission];
    if (!m) continue;
    const what = o.mission === "outpost" ? "build the outpost camp" : o.mission === "establish" ? "set up camp for your home" : "set up camp";
    out.splice(i + 1, 0, {
      mission: m, label: `${SCOUT_LABEL}: survey the tile (${LOOK.hours}h), then ${what}`, disabled: o.disabled,
      desc: `The team surveys this tile first (${LOOK.hours} hours: the places it hides, and the whole of its ground), then ${what} with all the information: its spot picked on the tile's map, the dead there counted and cleared off it first.`,
    });
    o.label = `${o.label}${BLIND_NOTE}`;
    const was = Object.getOwnPropertyDescriptor(o, "desc");
    if (was && was.get) Object.defineProperty(o, "desc", { get: () => `${blindText()} ${was.get.call(o)}`, set: was.set, enumerable: true, configurable: true }); // staging.js campOption: worked out when read
    else o.desc = `${blindText()} ${o.desc}`;
  }
  return out;
}
export const blindText = () => `Unscouted: the camp goes on a spot of the game's dice on the tile's map (no picking it, no fight for it first). Past the camp the map is unknown and so is how many of the dead are out on it: they come at the camp now and then until they are all killed (or clear them yourself: ${GROUNDS_LABEL}, from the POI map). A survey of the tile later shows it all.`;

// ---------- on arrival (staging.js pitchArrive) ----------
/**
 * The camp's order on arrival: "scouted" (today's flow), "scouting" (the Survey first: text in p.scoutText), or "blind"
 * (p.campAt the game's dice, p.campBlind the tile). @param {any} state @param {any} p @param {number} tile @param {string} mission
 */
export function scoutOrBlind(state, p, tile, mission) {
  if (p.owner !== "player" || tileScouted(state, tile, p)) { delete p.campBlind; delete p.scoutFirst; return "scouted"; }
  if (p.scoutFirst) {
    delete p.scoutFirst;
    p.orders = p.orders || [];
    p.orders.unshift({ type: "mission", mission, at: tile }); // orders.js: back to the camp once the survey is done here
    p.mission = "fullsurvey";
    startTask(state, p, { type: "fullsurvey", hours: LOOK.hours });
    p.scoutText = `Scouting ${tileLabel(state, tile)} first (${LOOK.hours}h), then setting up camp.`;
    return "scouting";
  }
  if (p.campBlind !== tile || !Array.isArray(p.campAt) || siteProblem(state, tile, p.campAt)) {
    p.campBlind = tile;
    p.campAt = blindSite(state, tile);
    log(state, `${teamName(state, p)} sets up camp blind ${tileLabel(state, tile)}: the tile was never scouted, so the camp goes where the team happens to stop, and what else is out on its ground is anyone's guess.`, "info");
  }
  return "blind";
}
/** The blind camp's spot: a valid spot on the tile's map by hash dice (off the buildings and the high ground when one is found). @param {any} state @param {number} tile @returns {number[]} */
export function blindSite(state, tile) {
  const land = siteLand(state, tile), R = SITE_RANGE;
  let first = null;
  for (let i = 0; i < GROUNDS.TRIES; i++) {
    const at = [Math.floor(hash01(state.seed, "blindsite", tile, i, "x") * (2 * R + 1)) - R, Math.floor(hash01(state.seed, "blindsite", tile, i, "y") * (2 * R + 1)) - R];
    if (siteProblem(state, tile, at)) continue;
    if (!first) first = at;
    const B = siteBox(at);
    let big = false;
    for (let y = B.y0; y < B.y1 && !big; y++) for (let x = B.x0; x < B.x1 && !big; x++) { const q = land.pieces.get(`${x},${y}`); if (q && BIG.has(q.k)) big = true; }
    if (!big) return at;
  }
  return first || defaultSite(state, tile);
}
// The camp stood up blind (staging.js pitchArrive after makeCamp): the dead on its grounds, unknown.
/** @param {any} state @param {any} base */
export function blindCamp(state, base) {
  const dead = mapDead(state, base.tile);
  base.grounds = { dead, dead0: dead, known: false, blind: true, next: state.hour + roll(state, GROUNDS.FIRST, base.tile, "first"), waves: 0, killed: 0, raids: 0 };
  log(state, `${base.name} went up blind: past the camp its ground is unknown, and so is how many of the dead are out there. A survey of the tile (Survey this tile) would show it all.`, "info");
  return base.grounds;
}
// The whole map's dead (siteThreat's rules for one spot, × GROUNDS.MAP): none on quiet land.
/** @param {any} state @param {number} tile */
export const mapDead = (state, tile) => Math.min(GROUNDS.MAX, openDead(state, tile), Math.round(siteThreat(state, tile).count * GROUNDS.MAP)); // deadpop.js: no more than the tile's open ground holds

// ---------- the base's grounds ----------
/** Your base on the tile whose grounds still hold the dead, or null. @param {any} state @param {number} tile */
export const groundsBase = (state, tile) => (state.bases || []).find((b) => b.tile === tile && b.grounds && b.grounds.dead > 0) || null;
export const groundsOpen = (state, tile) => !!groundsBase(state, tile);
// The fog on the base map: only round the fire until surveyed.
/** @param {any} base */
export const groundsFogged = (base) => !!(base && base.grounds && base.grounds.blind && !base.grounds.known);
// "?" until surveyed; then the dead left and about how many attacks that is.
/** @param {any} base */
export function deadText(base) {
  const g = base && base.grounds;
  if (!g) return "";
  if (!g.dead && (g.known || g.clearDay)) return "none left";
  if (!g.known) return "unknown (?): survey the tile to know";
  return `about ${g.dead} left (${wavesText(g.dead)})`;
}
const wavesText = (n) => { const w = Math.max(1, Math.round(n / GROUNDS.AVG)); return `${w} attack${w === 1 ? "" : "s"} or so`; };
/** The view's known cells (basemap.js viewBattle): 1 within KNOWN_R of the camp fire, else 0; null with nothing hidden. @param {any} b the view @param {any} base */
export function knownMask(b, base) {
  const F = b && b.deployPlan && b.deployPlan.fort;
  if (!groundsFogged(base) || !F) return null;
  const W = b.w, H = b.h, m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.hypot(x - F.ox, y - F.oy) <= GROUNDS.KNOWN_R) m[y * W + x] = 1;
  return m;
}
// The words for where they come from: "the woods", "the town".
const PLACE_WORD = { city: "the city's streets", suburb: "the town", farm: "the fields", plains: "the fields", forest: "the woods", hills: "the hills", mountain: "the mountainside" };
/** @param {any} state @param {number} tile */
export const groundsWord = (state, tile) => PLACE_WORD[terrainOf(state, { tile })] || "the land round it";

// Every hour (staging.js campsHour): the attacks on every camp and base by the dead and raiders nearby (campattack.js,
// issue #69: an hourly chance by the grounds' dead left, the tile's open ground, the noise, the night and the camp's
// stance; the waves drawn out of the pools). The old flat GROUNDS.EVERY is gone; GROUNDS.FIRST still holds a blind
// camp's first hours (g.next).
/** @param {any} state */
export function groundsHour(state) {
  campAttackHour(state);
}
// The old attack's card (an older save's battle in flight, the "groundsDead" handler below); new attacks use
// campattack.js attackCard.
// The attack's card: Defend the camp (the base defence battle) or keep out of their way.
/** @param {any} state @param {any} base @param {number} wave */
export function groundsCard(state, base, wave) {
  const g = base.grounds, where = groundsWord(state, base.tile);
  const left = g.known ? `About ${g.dead} of them are out there all told (${wavesText(g.dead)}).` : `How many more are out there is unknown (?): a survey of the tile would tell, or clear the grounds yourself (${GROUNDS_LABEL}: a team on the tile, its POI map).`;
  return {
    title: `The dead come out of ${where} at ${base.name}`, grounds: base.id, raidReport: { baseId: base.id },
    text: `About ${wave} of the dead are coming out of ${where} at ${base.name}: the camp went up blind, among them. ${left}`,
    choices: [
      { label: "Defend the camp", default: true, hint: `A fight on ${base.name}'s map: whoever is home against about ${wave} of the dead. Every one killed is one fewer out there.`, resolve: (st) => groundsAttack(st, base.id, wave) },
      { label: "Keep out of their way", hint: "Everyone stays out of sight while they pick through the camp: some of the food and meds are spoiled, and the dead are still out there.", resolve: (st) => keepClear(st, base.id) },
    ],
  };
}
// Defend the camp: the base defence battle on the base map (in the browser the tactical battle; headless played out).
/** @param {any} state @param {number} baseId @param {number} wave */
export function groundsAttack(state, baseId, wave) {
  const base = state.bases.find((b) => b.id === baseId);
  if (!base || !base.grounds || !(base.grounds.dead > 0)) return "";
  const n = Math.max(1, Math.min(wave, base.grounds.dead, GROUNDS.WAVE_MAX));
  const th = siteThreat(state, base.tile);
  base.grounds.waves++;
  fightNow(state, {
    tile: base.tile, baseId: base.id,
    enemy: { kind: "zombies", count: n, power: th.power || 2, mix: th.mix || null, name: `the dead from ${groundsWord(state, base.tile)}` },
    ambush: null, canRetreat: true, handler: "groundsDead", layout: "baseDefence", downedLive: 0.4, deploy: true,
    context: { baseId: base.id, wave: n, grounds: true, night: isNight(state) },
  });
  return "";
}
function keepClear(state, baseId) {
  const base = state.bases.find((b) => b.id === baseId);
  if (!base) return "";
  base.stock.meds = Math.floor((base.stock.meds || 0) * GROUNDS.SPOIL);
  scaleFood(base, GROUNDS.SPOIL);
  const text = `${base.name}'s people kept out of sight while the dead picked through the camp: some of the food and meds were spoiled. The dead are still out there.`;
  log(state, text, "danger");
  return text;
}
// The kills off the pool; at 0 the attacks stop.
/** @param {any} state @param {any} base @param {number} n */
export function takeDead(state, base, n) {
  const g = base && base.grounds;
  if (!g || !(g.dead > 0) || !(n > 0)) return 0;
  const k = Math.min(g.dead, Math.round(n));
  g.dead -= k;
  g.killed = (g.killed || 0) + k;
  killDead(state, base.tile, base.poi != null ? base.poi : null, k); // deadpop.js: the grounds' dead are the tile's open ground; a POI camp's (poicamp.js, #70) its POI's (issue #69)
  if (!g.dead) {
    g.clearDay = Math.floor(state.hour / 24) + 1;
    log(state, `The grounds of ${base.name} are clear of the dead: no more of them will come out of ${groundsWord(state, base.tile)} at the camp.`, "good");
  }
  return k;
}
registerCombatHandler("groundsDead", (state, result, setup) => {
  const c = setup.context;
  const base = state.bases.find((b) => b.id === c.baseId);
  if (!base) return;
  const k = takeDead(state, base, result.outcome === "victory" ? c.wave : Math.min(c.wave, result.enemiesKilled || 0));
  if (result.outcome === "victory") { log(state, `${base.name} held: the ${c.wave} dead that came out of ${groundsWord(state, base.tile)} were cut down.`, "good"); return; }
  base.stock.meds = Math.floor((base.stock.meds || 0) * 0.85);
  scaleFood(base, 0.85);
  log(state, `The dead from ${groundsWord(state, base.tile)} got into ${base.name}${k ? ` (${k} of them killed)` : ""}: they tore through the stores before they wandered off again (food and meds spoiled).`, "danger");
});

// ---------- clearing the grounds yourself (the POI map, the team's orders) ----------
// The raid's spot on the tile's map: out on the grounds, away from the camp (hash dice by the raids so far).
/** @param {any} state @param {any} base */
export function groundsSpot(state, base) {
  const o = (base.plan && base.plan.origin) || [0, 0], g = base.grounds || {};
  for (let i = 0; i < 40; i++) {
    const a = hash01(state.seed, "groundsraid", base.id, g.raids || 0, i, "a") * Math.PI * 2;
    const r = GROUNDS.RAID_SPOT[0] + hash01(state.seed, "groundsraid", base.id, g.raids || 0, i, "r") * (GROUNDS.RAID_SPOT[1] - GROUNDS.RAID_SPOT[0]);
    const at = [Math.round(o[0] + Math.cos(a) * r), Math.round(o[1] + Math.sin(a) * r)];
    if (!siteProblem(state, base.tile, at)) return at;
  }
  return o.slice(0, 2);
}
// How many a raid on the grounds meets.
/** @param {any} base */
export const raidCount = (base) => { const d = (base && base.grounds && base.grounds.dead) || 0; return Math.min(d, GROUNDS.WAVE_MAX, Math.max(GROUNDS.RAID_MIN, Math.ceil(d * GROUNDS.RAID_SHARE))); };
// Why a team cannot clear the grounds here ("" when it can).
/** @param {any} state @param {any} p @param {number} [tile] */
export function groundsProblem(state, p, tile = partyTile(p)) {
  if (!groundsBase(state, tile)) return "No base of yours here with the dead out on its grounds.";
  if (state.combat) return "Not in a fight.";
  if (!p || !partyMembers(state, p).length) return "Nobody to go.";
  return "";
}
// The team goes out onto the grounds: a fight on the tile's map against a share of what is left (handler "groundsClear").
/** @param {any} state @param {any} p */
export function groundsRaid(state, p) {
  const tile = partyTile(p), base = groundsBase(state, tile);
  const why = groundsProblem(state, p, tile);
  if (why) { if (p && state.parties.includes(p)) awaitOrders(state, p, `${GROUNDS_LABEL}: ${why}`, { failed: true }); return ""; }
  const n = raidCount(base), th = siteThreat(state, tile), at = groundsSpot(state, base);
  base.grounds.raids = (base.grounds.raids || 0) + 1;
  p.phase = "engaged";
  log(state, `${teamName(state, p)} goes out onto the grounds of ${base.name} to clear the dead from ${groundsWord(state, tile)}.`, "info");
  startCombat(state, { tile, partyId: p.id, enemy: { kind: "zombies", count: n, power: th.power || 2, mix: th.mix || null, name: "the dead on the base grounds" }, ambush: null, canRetreat: true, handler: "groundsClear", layout: "siteClear", context: { partyId: p.id, tile, at, baseId: base.id, wave: n, grounds: true } });
  return `${teamName(state, p)} goes out to clear the dead from the grounds.`;
}
registerCombatHandler("groundsClear", (state, result, setup) => {
  const c = setup.context;
  const p = state.parties.find((x) => x.id === c.partyId);
  const base = state.bases.find((b) => b.id === c.baseId);
  const k = base ? takeDead(state, base, result.outcome === "victory" ? c.wave : Math.min(c.wave, result.enemiesKilled || 0)) : 0;
  if (!p || !partyMembers(state, p).length) {
    if (p) wipeIfEmpty(state, p);
    log(state, `The team clearing the grounds of ${base ? base.name : "the base"} died out there.`, "death");
    return;
  }
  const left = base && base.grounds ? (base.grounds.dead ? (base.grounds.known ? ` About ${base.grounds.dead} left out there.` : " How many are left is unknown.") : "") : "";
  const text = result.outcome === "victory" ? `Cleared the dead from part of the grounds: ${k} killed.${left}` : `Pulled back from the grounds after killing ${k} of the dead.${left}`;
  log(state, `${teamName(state, p)}: ${text}`, result.outcome === "victory" ? "good" : "danger");
  if (state.parties.includes(p)) awaitOrders(state, p, text, result.outcome === "victory" ? {} : { failed: true });
});

// ---------- the survey (survey.js fullSurveyDone) ----------
// A Survey of a tile whose base went up blind shows it all: the fog lifts, the dead are counted. Returns a sentence or "".
/** @param {any} state @param {any} p @param {number} tile */
export function groundsSurveyed(state, p, tile) {
  const base = (state.bases || []).find((b) => b.tile === tile && b.grounds && !b.grounds.known);
  if (!base) return "";
  base.grounds.known = true;
  const text = `The whole of ${base.name}'s grounds is known now: ${base.grounds.dead ? `about ${base.grounds.dead} of the dead out there (${wavesText(base.grounds.dead)}, unless you clear them yourself)` : "none of the dead left out there"}.`;
  log(state, text, "info");
  return text;
}
