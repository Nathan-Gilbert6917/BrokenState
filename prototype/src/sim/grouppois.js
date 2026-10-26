// @ts-check
// What the other groups know of the points of interest (pois.js) and how they survey and raid them: the map's
// groups (state.factions), the raider and explorer bands from outside (visitors.js), the hardcore bands on the road
// (hardcore-groups.js) and, later, the nomads. The player's side is pois.js / survey.js / poiraid.js.
//
// Knowledge (state.groupPois, made on first use, plain data saved with the world):
//   { [holder id]: { f: { [tileId]: [POI indices found by a survey] }, s: { [tileId]: day surveyed } } }
//   A holder is anything with an id (a group, a band, a nomad camp); the key is its id as a string. Hardcore bands
//   keep their id when they found a hub (hardcore-groups.js foundHub), so what a band found the group still knows.
//   - Seen without a survey: every POI that is not hidden (the known zone's, pois.js poi.hidden) on a tile the holder
//     can see from where it lives (groupSees): within GPOI.RANGE (10, aiscav.js AISCAV.range) of one of a group's
//     bases; within a band's GPOI.NEAR (3) of where it stands (or camps), and on the tiles of a band's trail
//     (visitors.js v.trail). The tile's site (tile.loc) counts as seen there whatever its discovery class: the groups
//     worked the sites before the POIs came (aiscav.js), and they lived here before the fall.
//   - Hidden ones only by a survey of their own (groupSurveyTile): one roll at the end of GPOI.HOURS (8) at the
//     tile, with the player's Survey odds (survey.js lookOdds: the 12% an hour × Scouting × team × terrain × light ×
//     weather, compounded over the hours) for a holder with no optics, on foot, its Scouting by type (GPOI.SCOUT; a
//     holder's own `scouting` wins) and its people (n). Success finds every hidden POI there, failure each on its
//     own at survey.js LOOK.fail of the odds. Hash dice (the seed, the tile, the hour, the holder's world-local id).
//     The tile is stamped with the day (s) and not surveyed again for GPOI.AGAIN days.
//   - Dead groups and bands that left the map are dropped from it once a day (pruneGroupPois).
// Targets (groupTargets, the one picker for every kind of holder): around some centres, within a range, every POI
// the holder knows with something left (pool at least GPOI.MIN) scored by need (the kind's loot table × the
// holder's needs, aiscav.js bestSite's rule: share of the good × (baseWant + need)) × what is left / (1 + distance /
// 5), and every tile it might find more on by a survey (never surveyed by it in GPOI.AGAIN days; what it expects
// there by the tile's terrain and zone, never what really hides there: groupHiddenGuess) × GPOI.SURVEY_W. A tile with
// no POIs but a site (a city or town centre: they keep the crawl) is scored by tile.loot as before (poi null).
// The raid (raidPoiAsGroup): the one way any holder takes from a POI: poicont.js lootPoiAbstract (the pool falls,
// the container ledger follows, what the player left in opened containers can go, the tile heats up) and the haul
// as goods by the POI's kind (aiscav.js haulFor). The log says when a POI is stripped, and when strangers emptied
// what your people left there (seen from your land, or on the radio near one of your bases).
/** @import { State, Tile } from "./types" */
import { LOCATIONS } from "./data.js";
import { log, localId, day } from "./world.js";
import { tileLabel } from "./parties.js";
import { hash01 } from "./skills.js";
import { aiRaidKills } from "./deadpop.js"; // the dead on the land: the groups' raids kill from the same pools
import {
  poisOf, poiAt, isSitePoi, poiPool, poiName, permanentSite, poiEligible, inKnownZone, POI_KINDS, COUNTS, POI, poiBand, TILE_HEAT,
} from "./pois.js";
import { lootPoiAbstract, poiHouses } from "./poicont.js"; // poiHouses: a street of houses (a neighbourhood) is gone through a house at a time
import { lookOdds, LOOK } from "./survey.js";
import { haulFor, AISCAV } from "./aiscav.js";
import { rollGroupTent } from "./tents.js"; // a tent bag among the finds (its own dice; call-time only)
import { campGroupRaid } from "./campsite.js"; // a campsite raided: its tents carried off (call-time only)

export const GPOI = {
  RANGE: 10,        // a group sees the known zone's POIs this far from its bases (aiscav.js AISCAV.range)
  NEAR: 3,          // a band (an outsider band, a hardcore band, a nomad camp) this far from where it stands
  HOURS: 8,         // a survey stop (survey.js LOOK.hours)
  AGAIN: 120,       // days before a holder surveys the same tile again
  MIN: 0.05,        // a POI with less left than this is not worth a trip (pool units)
  SURVEY_W: 0.6,    // a survey's worth against a known place's (it costs the hours and may find nothing)
  // Scouting by type (survey.js: 0.5 + 0.05 a point): the military and the outside scouts look best.
  SCOUT: { military: 7, expansionist: 5, traders: 5, raider: 4, fortress: 4, zealot: 3, commune: 3, raiders: 4, explorers: 6, merchants: 3 },
  SCOUT_DEF: 3,
};

/** @param {State} state @param {Tile | number} tile @returns {Tile} */
const tileOf = (state, tile) => (typeof tile === "number" ? state.tiles[tile] : tile);
/** @param {any} who */
const keyOf = (who) => String(who != null && typeof who === "object" ? who.id : who);

// ---------- knowledge ----------
/** Every holder's POI knowledge (made on first use). @param {State} state @returns {Record<string, { f: Record<string, number[]>, s: Record<string, number> }>} */
export function groupPois(state) {
  const s = /** @type {any} */ (state);
  if (!s.groupPois || typeof s.groupPois !== "object") s.groupPois = {};
  return s.groupPois;
}
/** A holder's record ({ f, s }), or null (make: create it). @param {State} state @param {any} who @param {boolean} [make] */
export function groupPoiRecord(state, who, make = false) {
  const all = groupPois(state), k = keyOf(who);
  if (!all[k] && make) all[k] = { f: {}, s: {} };
  return all[k] || null;
}
/** The holder's Scouting (its own `scouting`, else by its type). @param {any} who */
export function groupScouting(who) {
  if (who && typeof who === "object") {
    if (Number.isFinite(who.scouting)) return who.scouting;
    const k = who.outsider && who.kind ? who.kind : who.type;
    if (GPOI.SCOUT[k] != null) return GPOI.SCOUT[k];
  }
  return GPOI.SCOUT_DEF;
}
/**
 * Can the holder see this tile from where it lives (the known zone's POIs there need no survey)? A group: within
 * GPOI.RANGE of a base. A band (or a party, aiscav.js partyEyes): within its `seeRange` (GPOI.NEAR) of where it
 * stands or camps (who.camp ?? who.tile), or a tile of its trail (who.trail).
 * @param {State} state @param {any} who @param {Tile | number} tile
 */
export function groupSees(state, who, tile) {
  const id = typeof tile === "number" ? tile : tile.id;
  if (!who || typeof who !== "object") return false;
  const g = state.grid;
  if (Array.isArray(who.bases) && who.bases.some((b) => g.distance(b, id) <= GPOI.RANGE)) return true;
  const at = who.camp != null ? who.camp : who.tile;
  if (at != null && g.distance(at, id) <= (who.seeRange ?? GPOI.NEAR)) return true;
  return Array.isArray(who.trail) && who.trail.includes(id);
}
/** Does the holder know POI i of the tile (seen from where it lives, or found by its survey)? @param {State} state @param {any} who @param {Tile | number} tile @param {number} i */
export function groupKnowsPoi(state, who, tile, i) {
  const t = tileOf(state, tile), p = poiAt(t, i);
  if (!p) return false;
  const rec = groupPoiRecord(state, who);
  const f = rec && rec.f[t.id];
  if (f && f.includes(i)) return true;
  return (isSitePoi(t, i) || !p.hidden) && groupSees(state, who, t);
}
/** The POIs of a tile the holder knows. @param {State} state @param {any} who @param {Tile | number} tile @returns {number[]} */
export function groupKnownPois(state, who, tile) {
  const t = tileOf(state, tile);
  return poisOf(t).map((_, i) => i).filter((i) => groupKnowsPoi(state, who, t, i));
}
/** The day the holder last surveyed the tile (null: never). @param {State} state @param {any} who @param {Tile | number} tile */
export function groupSurveyedDay(state, who, tile) {
  const rec = groupPoiRecord(state, who), id = typeof tile === "number" ? tile : tile.id;
  return rec && rec.s[id] != null ? rec.s[id] : null;
}
/** Would the holder survey this tile (POIs can stand there, not surveyed by it in GPOI.AGAIN days)? @param {State} state @param {any} who @param {Tile | number} tile */
export function groupWouldSurvey(state, who, tile) {
  const t = tileOf(state, tile);
  if (!poiEligible(state, t) || (t.loc && !permanentSite(t))) return false;
  const d = groupSurveyedDay(state, who, t);
  return d == null || day(state) - d >= GPOI.AGAIN;
}

// What a survey is expected to turn up on a tile (pool units), by its terrain, whether a site stands there and the
// zone: the expected number of hidden POIs (pois.js generatePois's rules) × the mean richness of the terrain's kinds
// × the pools' mean (POI.POOL). Never what really hides there.
const guessMemo = new Map();
/** @param {State} state @param {Tile | number} tile */
export function groupHiddenGuess(state, tile) {
  const t = tileOf(state, tile);
  if (!poiEligible(state, t)) return 0;
  const site = permanentSite(t), known = inKnownZone(state, t);
  const key = `${t.terrain}|${site ? t.loc.type : ""}|${known ? 1 : 0}`;
  if (guessMemo.has(key)) return guessMemo.get(key);
  const c = COUNTS[t.terrain];
  let kinds = POI_KINDS[t.terrain] || [];
  if (site) { const under = kinds.filter((k) => LOCATIONS[k].richness <= LOCATIONS[t.loc.type].richness); if (under.length) kinds = under; }
  const rich = kinds.length ? kinds.reduce((a, k) => a + LOCATIONS[k].richness, 0) / kinds.length : 0;
  const [lo, hi] = site ? [c[2], Math.min(c[3], POI.MAX - 1)] : [c[0], c[1]];
  let hidden = 0;
  for (let n = lo; n <= hi; n++) {
    const rest = site ? n : Math.max(0, n - 1); // the non-top ones (a site tile's extras are all non-top)
    // known zone: 0–2 of the non-top hidden, uniform; unknown zone: every extra, and a bare tile's top as well
    const h = known ? [0, 1, 2].reduce((a, x) => a + Math.min(rest, x), 0) / 3 : n;
    hidden += h / (hi - lo + 1);
  }
  const v = hidden * rich * (POI.POOL[0] + POI.POOL[1]) / 2;
  guessMemo.set(key, v);
  return v;
}

/** The holder's survey odds for a tile (survey.js lookOdds with its Scouting and people, no optics, on foot). @param {State} state @param {any} who @param {Tile | number} tile @param {{ n?: number, start?: number, hours?: number }} [opts] */
export function groupSurveyOdds(state, who, tile, { n = 3, start = state.hour - GPOI.HOURS, hours = GPOI.HOURS } = {}) {
  const id = typeof tile === "number" ? tile : tile.id;
  const ctx = { scout: groupScouting(who), keen: 0, spotter: false, n: Math.max(1, Math.round(n)), mode: "foot", stance: "normal", lamp: 0, lampKey: null, nvg: false, members: [], cargo: null };
  return lookOdds(state, ctx, id, id, start, hours);
}
/**
 * The holder surveys a tile: the roll at the end of its GPOI.HOURS there (the caller spends the hours: a party
 * standing on the tile, a band camping). Success finds every hidden POI, failure each on its own at LOOK.fail of the
 * odds. Stamps the day. Returns { chance, sure, found: indices found now, known: every index it knows there now }.
 * opts: n (people looking, default 3), start (the first hour of the look, default GPOI.HOURS ago).
 * @param {State} state @param {any} who @param {Tile | number} tile @param {{ n?: number, start?: number }} [opts]
 */
export function groupSurveyTile(state, who, tile, opts = {}) {
  const t = tileOf(state, tile);
  const rec = /** @type {{ f: Record<string, number[]>, s: Record<string, number> }} */ (groupPoiRecord(state, who, true));
  const chance = groupSurveyOdds(state, who, t, opts);
  const lid = localId(state, typeof who === "object" && who ? who.id : who);
  const sure = hash01(state.seed, "gsurvey", t.id, state.hour, lid) < chance;
  const found = [];
  const list = poisOf(t);
  for (let i = 0; i < list.length; i++) {
    if (groupKnowsPoi(state, who, t, i)) continue;
    if (!sure && hash01(state.seed, "gsurveyp", t.id, i, state.hour, lid) >= chance * LOOK.fail) continue;
    (rec.f[t.id] || (rec.f[t.id] = [])).push(i);
    found.push(i);
  }
  rec.s[t.id] = day(state);
  const st = /** @type {any} */ (state);
  const S = st.groupPoiStats || (st.groupPoiStats = { surveys: 0, found: 0, raids: 0, took: 0, stripped: 0, leftTaken: 0 });
  S.surveys++; S.found += found.length;
  return { chance, sure, found, known: groupKnownPois(state, who, t) };
}

// ---------- targets ----------
/** What a kind's loot is worth to a holder with these needs (aiscav.js bestSite's rule; no needs: the loot as it is). @param {string} kind @param {Record<string, number> | null} need */
export function kindValue(kind, need) {
  if (!need) return 1;
  const { entries, total } = lootTable(kind);
  let value = 0;
  for (const [k, w] of entries) value += (w / total) * (AISCAV.baseWant + (need[k] || 0));
  return value;
}
// A kind's loot table as [key, weight] pairs and their total, kept per kind (the tables are fixed; kindValue is read
// for every place a group weighs, every day).
const TABLES = new Map();
function lootTable(kind) {
  let T = TABLES.get(kind);
  if (!T) {
    const def = LOCATIONS[kind];
    const table = def ? def.loot : {};
    TABLES.set(kind, (T = { entries: Object.entries(table), total: Object.values(table).reduce((a, v) => a + v, 0) || 1 }));
  }
  return T;
}
/** The best POI of a tile the holder knows with something left (-1: none), by need × what is left. @param {State} state @param {any} who @param {Tile | number} tile @param {Record<string, number> | null} [need] @param {number[]} [exclude] */
export function bestGroupPoi(state, who, tile, need = null, exclude = []) {
  const t = tileOf(state, tile);
  let best = -1, bs = 0;
  for (const i of groupKnownPois(state, who, t)) {
    const pool = poiPool(t, i);
    if (exclude.includes(i) || pool < GPOI.MIN) continue;
    const s = kindValue(poiAt(t, i).kind, need) * pool;
    if (best < 0 || s > bs) { best = i; bs = s; }
  }
  return best;
}
/**
 * The holder's targets around some centres (its bases, its camp, where it stands), best first:
 * [{ tile, from (the nearest centre), d, poi (index; -1 for a survey stop; null for a site without POIs), survey,
 * score }]. opts: range, need (its needs, or null), ok(t) (a tile it may go to at all), poiW (× a POI's score
 * against a site's tile.loot; 1), surveys (false: no survey stops).
 * @param {State} state @param {any} who @param {number[]} centres
 * @param {{ range?: number, need?: Record<string, number> | null, ok?: (t: Tile) => boolean, poiW?: number, surveys?: boolean, minSite?: number }} [opts]
 */
export function groupTargets(state, who, centres, { range = GPOI.RANGE, need = null, ok = () => true, poiW = 1, surveys = true, minSite = AISCAV.minLoot } = {}) {
  const g = state.grid, seen = new Set(), out = [];
  for (const c of centres) for (const id of g.within(c, range)) {
    if (seen.has(id)) continue;
    seen.add(id);
    const t = state.tiles[id];
    if (!ok(t)) continue;
    // The nearest centre (the first of those nearest), each one's distance worked out once.
    let from = centres[0], d = g.distance(from, id);
    for (let k = 1; k < centres.length; k++) { const dk = g.distance(centres[k], id); if (dk < d) { from = centres[k]; d = dk; } }
    const far = 1 + d / 5;
    const list = poisOf(t);
    if (!list.length || (t.loc && !permanentSite(t))) {
      // A site with no POIs (a city or town centre) as before: its loot.
      if (t.loc && (t.loot || 0) >= minSite) out.push({ tile: id, from, d, poi: null, survey: false, score: (kindValue(t.loc.type, need) * (t.loot || 0)) / far });
      continue;
    }
    for (const i of groupKnownPois(state, who, t)) {
      const pool = poiPool(t, i);
      if (pool < (isSitePoi(t, i) ? minSite : GPOI.MIN)) continue;
      out.push({ tile: id, from, d, poi: i, survey: false, score: (kindValue(list[i].kind, need) * pool * (isSitePoi(t, i) ? 1 : poiW)) / far });
    }
    if (surveys && groupWouldSurvey(state, who, t)) {
      const guess = groupHiddenGuess(state, t);
      const kinds = POI_KINDS[t.terrain] || [];
      const val = kinds.length ? kinds.reduce((a, k) => a + kindValue(k, need), 0) / kinds.length : 0;
      if (guess > 0) out.push({ tile: id, from, d, poi: -1, survey: true, score: (GPOI.SURVEY_W * val * guess * poiW) / far });
    }
  }
  out.sort((a, b) => b.score - a.score || a.tile - b.tile || (a.poi ?? -2) - (b.poi ?? -2));
  return out;
}

// ---------- the raid ----------
/** @param {State} state */
const stats = (state) => { const st = /** @type {any} */ (state); return st.groupPoiStats || (st.groupPoiStats = { surveys: 0, found: 0, raids: 0, took: 0, stripped: 0, leftTaken: 0 }); };
/**
 * A holder raids POI i of a tile without a map: `need` of its pool (pool units; a street of houses, a neighbourhood,
 * need / poicont.js poiHouses: they go through it a house at a time, as your crews do; less when less is left, never
 * below opts.floor, AISCAV.floor by default) through poicont.js lootPoiAbstract (the pool, the ledger, what the player left
 * in opened containers, the tile's heat: opts.heat, TILE_HEAT.AI by default, × max(1, opts.hours / 4)), the fight with
 * the dead there (deadpop.js aiRaidKills: up to DEADPOP.AI_KILLS off the POI and the tile, loud), and the haul
 * as goods by the POI's kind (aiscav.js haulFor at opts.eff, AISCAV.eff by default; the site POI as its site, the
 * shop's food and all). Logs a POI stripped now and things of yours taken (seen, or on the radio near your bases;
 * opts.news false: quiet; "left": only things of yours taken, the caller tells of the rest). Returns null without
 * the POI, else { took, goods (supplies, the player's left supplies among them; opts.haul false: those alone, the
 * caller turns `took` into goods its own way), left (the player's left supplies), gear (items the player left there,
 * and a tent bag found by the same loot as your search's: tents.js rollGroupTent; not with haul false or count false),
 * boxes (your containers gone through), stripped, strippedNow, pool }. opts.room: the kg the holder can carry off from
 * your containers (nomads.js bandRoom); what does not fit stays in them (poicont.js lootPoiAbstract). opts.vehicle: they
 * came by vehicle (the result's `pieces`: a piece of furniture may be in the haul, furnicarry.js).
 * @param {State} state @param {any} who @param {Tile | number} tile @param {number} i @param {number} need
 * @param {{ eff?: number, hours?: number, heat?: number, floor?: number, news?: boolean | "left", name?: string, haul?: boolean, count?: boolean, room?: number, vehicle?: boolean }} [opts]
 */
export function raidPoiAsGroup(state, who, tile, i, need, opts = {}) {
  const t = tileOf(state, tile), p = poiAt(t, i);
  if (!p) return null;
  const before = poiPool(t, i), was = !!p.stripped, band0 = poiBand(t, i);
  const r = lootPoiAbstract(state, who, t, i, need / poiHouses(state, t, i), { floor: opts.floor != null ? opts.floor : AISCAV.floor, heat: opts.heat != null ? opts.heat : TILE_HEAT.AI, hours: opts.hours, room: opts.room });
  if (!r) return null;
  aiRaidKills(state, t, i, { hours: opts.hours }); // deadpop.js (issue #65, AI parity): their fight kills from the POI's dead and the tile's, loudly; raiders seen raiding here
  const goods = r.took > 0 && opts.haul !== false ? haulFor(t, r.took, before, opts.eff != null ? opts.eff : AISCAV.eff, state, isSitePoi(t, i) ? null : p.kind) : {};
  for (const [k, q] of Object.entries(r.left.sup)) goods[k] = (goods[k] || 0) + q;
  const gear = [...r.left.gear];
  if (r.took > 0 && opts.haul !== false && opts.count !== false) { // tents.js: a tent bag, by the POI's kind and the search hours it took
    const tent = rollGroupTent(state, who, t.id, i, isSitePoi(t, i) ? (t.loc ? t.loc.type : null) : p.kind, r.took, before);
    if (tent) gear.push(tent);
  }
  if (opts.count !== false && p.kind === "campsite") gear.push(...campGroupRaid(state, who, t, i)); // campsite.js: its standing tents carried off, the camp cleared
  const S = stats(state);
  if (opts.count !== false) { S.raids++; S.took += r.took; } // count false: a group's own land, worn down by the day (aiscav.js)
  const strippedNow = r.stripped && !was;
  if (strippedNow) S.stripped++;
  if (r.boxes) S.leftTaken += r.boxes;
  if (opts.news !== false) {
    if (r.boxes) poiNews(state, who, t, i, "left", opts.name);
    else if (opts.news !== "left" && (strippedNow || poiBand(t, i) > band0 + 1)) poiNews(state, who, t, i, "stripped", opts.name);
  }
  // furnicarry.js (issue #12, AI parity): a group that came by vehicle may take a one-person piece of furniture or an
  // appliance as well: a flag on the haul only (what the pieces do at their base is the base-use tickets').
  return { took: r.took, goods, left: r.left.sup, gear, boxes: r.boxes, stripped: r.stripped, strippedNow, pool: r.pool, ...(opts.vehicle && r.took > 0 ? { pieces: true } : {}) };
}

// Who they are in the log: a group you know by name, else nobody named ("Strangers", "someone").
/** @param {any} who @param {string} [name] */
const whoName = (who, name) => name || (who && typeof who === "object" && who.known && who.name ? who.name : "");
/** A POI in a log line: "the house at Pine Ridge", a site by its own name. @param {State} state @param {Tile} t @param {number} i */
export const poiPlace = (state, t, i) => (isSitePoi(t, i) ? tileLabel(state, t.id) : `the ${poiName(t, i).toLowerCase()} at ${tileLabel(state, t.id)}`);
/**
 * A line in the log when a POI is stripped or things you left there are taken: seen from your land (state.live), or
 * on the radio when a base of yours has one and the tile is within AISCAV.newsRange of one of your bases; one line a
 * POI a day.
 * @param {State} state @param {any} who @param {Tile} t @param {number} i @param {"stripped" | "left"} what @param {string} [name]
 */
export function poiNews(state, who, t, i, what, name) {
  const live = !!(state.live && state.live.has(t.id));
  const near = (state.bases || []).some((b) => state.grid.distance(b.tile, t.id) <= AISCAV.newsRange);
  const radio = near && (state.bases || []).some((b) => b.radio);
  if (!live && !radio) return false;
  const st = /** @type {any} */ (state);
  const seen = st.groupPoiNews || (st.groupPoiNews = {});
  const k = `${t.id}:${i}:${what}`, today = day(state);
  if (seen[k] === today) return false;
  seen[k] = today;
  for (const key of Object.keys(seen)) if (today - seen[key] > 30) delete seen[key];
  const place = poiPlace(state, t, i);
  const nm = whoName(who, name);
  const subj = nm || (what === "left" ? "Strangers" : "Scavengers");
  if (what === "left") {
    if (live) log(state, `${subj} went through ${place} and emptied what your people had left there.`, "danger");
    else log(state, `On the radio: ${nm ? `${nm} people were` : "someone was"} seen coming out of ${place} loaded down; what your people left there is likely gone.`, "info");
  } else {
    if (live) log(state, `${subj} stripped ${place}: nothing worth taking is left.`, "info");
    else log(state, `On the radio: ${place} has been picked clean${nm ? ` by ${nm}` : ""}.`, "info");
  }
  return true;
}

// ---------- housekeeping ----------
/** Drops the records of holders that are gone (a dead group, a band that left the map or founded nothing). Daily. @param {State} state */
export function pruneGroupPois(state) {
  const st = /** @type {any} */ (state);
  if (!st.groupPois) return;
  const live = new Set();
  for (const f of state.factions || []) if (f.alive) live.add(String(f.id));
  for (const v of st.visitors || []) live.add(String(v.id));
  for (const b of (st.hardcore && st.hardcore.groups && st.hardcore.groups.bands) || []) live.add(String(b.id));
  const nomads = Array.isArray(st.nomads) ? st.nomads : st.nomads && Array.isArray(st.nomads.bands) ? st.nomads.bands : [];
  for (const n of nomads) live.add(String(n.id));
  for (const k of Object.keys(st.groupPois)) if (!live.has(k)) delete st.groupPois[k];
}
/** The day's work for every holder's record (world.js via aiscav.js aiScavDaily). @param {State} state */
export function groupPoisDaily(state) {
  pruneGroupPois(state);
}
