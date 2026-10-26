// @ts-check
// Knowing the threat level: what the player believes of the dead and the raiders on a tile and in its POIs (the heat
// epic #64 §11–12, issue #67; the user's request 2026-10-26: "When you do a full survey you see the approximate threat
// level of the tile and when you survey a POI you get a general estimate too. You can then see the threat level for the
// tile be updated when you are on the tile").
//
// The truth is deadpop.js's (tileDead, openDead, poiDead and the raiders' counts against popCap, raiderCap, poiCap).
// What the player sees is an estimate, the intelest.js / pois.js poiThreatEstimate pattern:
// - THE TILE STAMP (noteTileThreat → state.poiKnow[tile].threat = { h, k, d, o, cap, r, rcap, err, src }): the counts
//   when a team looked (d the dead, o the open ground's, r the raiders) with the look's error. A full Survey stamps it at
//   the survey's error (survey.js fullSurveyDone: intelnotes.js surveyErr, ERR.survey, less with optics, more at night);
//   a look at a place (a visit, a raid's end, a Quick look) at ERR.visit / ERR.look. A look never makes you know less
//   than you knew: its error is the smaller of its own and the stamp's error aged to now.
// - A POI's estimate rides on its threat stamp (pois.js notePoiThreat: p.threatStamp's d, dc, r, de, written by
//   poiStampFields): a full Survey gives each POI it knows the survey's error, a POI's own look (a Quick look, a visit)
//   a general estimate at ERR.look / ERR.visit, wider than the survey's.
// - THE ESTIMATE (tileThreatEstimate, poiDeadEstimate): the stamp's count placed by the seed's dice inside its error
//   (± err / 2: never the true value itself), the error growing STALE a day since the look (pois.js THREAT.STALE, up to
//   MAX_ERR), "stale" past THREAT.STALE_DAYS; the band of the count so placed against the cap the look saw (deadpop.js
//   bandOfCount: none / low / medium / high / overrun) with a skull a band.
// - LIVE ON THE TILE (threatLive): while any of your teams stands on the tile, or a base of yours is there, the estimate
//   is read from the counts as they are now, at the smaller of ERR.live and the stamp's aged error, and it never goes
//   stale ("live"). threatKnowHour (world.js tickHour, every hour) writes those live looks into the stamps (the tile's
//   and its known POIs'), so when everyone leaves the last one stays and goes stale as any stamp does. The dice key (k)
//   stays the same while live, so the word does not flicker from hour to hour.
// - No stamp and never on the tile: null ("threat unknown").
// - THE OVERLAY (threatOverlay): the State Map's "The dead on the land" layer, the estimated band of every tile with a
//   stamp or live: known tiles only.
// - EARSHOT (earshotEstimate): the raid strip's "Earshot: ~12 more on this tile", deadpop.js earshot's rule read off the
//   estimated open ground (a rough number), less those already drawn into this raid.
// - AI PARITY (docs/adr/0001): the groups keep the same kind of stamp of the tiles they survey or raid (noteGroupThreat
//   → grouppois.js state.groupPois[holder].t[tileId] = [hour, d, cap, r, rcap], read by groupThreatEstimate at the
//   same errors and staleness).
// Hash dice from the world seed (skills.js hash01), never state.rng.
/** @import { State, Tile } from "./types" */
import { hash01 } from "./skills.js";
import { tileDead, openDead, popCap, tileRaiders, raiderCap, poiDead, poiCap, poiRaiders, bandOfCount, DEADPOP } from "./deadpop.js";
import { poiKnowledge, poiAt, knownPois, notePoiThreat, THREAT } from "./pois.js"; // call-time only (pois.js reads this module's poiStampFields)
import { partyTile } from "./parties.js"; // call-time only
import { groupPoiRecord } from "./grouppois.js"; // call-time only

export const THREATKNOW = {
  // A look's error on the counts, by its source (± half of it): a full Survey's own is intelnotes.js surveyErr (0.2,
  // less with optics, more at night), these are the fallbacks; a POI's own look (a visit, a Quick look) is wider.
  ERR: { survey: 0.2, visit: 0.4, look: 0.5, live: 0.3, group: 0.25 },
  SKULL: "☠",
  // The raid strip's earshot: rounded to this past ROUND_FROM (a rough number).
  ROUND: 5, ROUND_FROM: 10,
  // The State Map's overlay: a band's wash (none … overrun).
  COLORS: ["rgba(120,190,120,0.18)", "rgba(220,200,120,0.22)", "rgba(230,150,70,0.3)", "rgba(220,80,60,0.36)", "rgba(170,30,40,0.48)"],
};

/** @param {State} state @param {Tile | number} t */
const idOf = (state, t) => (typeof t === "number" ? t : t.id);
/** A stamp's error aged to the hour. @param {{ h: number, err: number }} st @param {number} hour */
const agedErr = (st, hour) => Math.min(THREAT.MAX_ERR, st.err + THREAT.STALE * Math.max(0, hour - st.h) / 24);
/** The band of a count against a cap, with a skull a band ("medium ☠☠"). @param {number} n @param {number} cap */
export function threatBandOf(n, cap) {
  const b = bandOfCount(n, cap);
  return { band: b.band, word: b.word, skulls: THREATKNOW.SKULL.repeat(b.band) };
}

// ---------- live ----------
/** The tiles your people stand on now: your teams' (any with people) and your bases'. @param {State} state @returns {Set<number>} */
export function liveTiles(state) {
  const out = new Set();
  for (const b of state.bases || []) if (b && b.tile != null) out.add(b.tile);
  for (const p of state.parties || []) if (p && p.owner === "player" && Array.isArray(p.path) && p.path.length && (p.members || []).length) out.add(partyTile(p));
  return out;
}
/** Is the tile's estimate live (a team or a base of yours on it)? @param {State} state @param {Tile | number} tile */
export function threatLive(state, tile) {
  const id = idOf(state, tile);
  if ((state.bases || []).some((b) => b && b.tile === id)) return true;
  return (state.parties || []).some((p) => p && p.owner === "player" && Array.isArray(p.path) && p.path.length && (p.members || []).length && partyTile(p) === id);
}

// ---------- the tile stamp ----------
/** The counts a look at the tile sees now. @param {State} state @param {number} id */
const tileCounts = (state, id) => ({ d: tileDead(state, id), o: openDead(state, id), cap: popCap(state, id), r: tileRaiders(state, id), rcap: raiderCap(state, id) });
/**
 * A look at the tile (a full Survey, a visit, a Quick look, a team on it): the hub's stamp of the dead and the raiders
 * there now (state.poiKnow[tile].threat). src: "survey" | "visit" | "look" | "live"; err: the look's own (default
 * ERR[src]). The stamp keeps the smaller of the look's error and its own aged to now. Returns the stamp.
 * @param {State} state @param {Tile | number} tile @param {string} [src] @param {number | null} [err]
 */
export function noteTileThreat(state, tile, src = "visit", err = null) {
  const id = idOf(state, tile);
  if (!state.tiles[id] || state.tiles[id].terrain === "water") return null;
  const k = poiKnowledge(state, id, true);
  const old = k.threat || null;
  const e0 = err != null ? err : THREATKNOW.ERR[src] ?? THREATKNOW.ERR.visit;
  const e = old ? Math.min(e0, agedErr(old, state.hour)) : e0;
  k.threat = { h: state.hour, k: src === "live" && old ? old.k : state.hour, ...tileCounts(state, id), err: Math.round(e * 1000) / 1000, src: src === "live" && old ? old.src : src };
  return k.threat;
}
/** The hub's tile stamp, or null. @param {State} state @param {Tile | number} tile */
export const tileThreatStamp = (state, tile) => { const k = poiKnowledge(state, idOf(state, tile)); return (k && k.threat) || null; };

// A count placed by the dice inside its error: { n (rounded), lo, hi }.
const place = (n, err, die) => {
  if (n == null) return null;
  const v = Math.max(0, n * (1 + (die - 0.5) * err));
  return { n: Math.round(v), lo: Math.max(0, Math.round(v * (1 - err / 2))), hi: Math.round(v * (1 + err / 2)) };
};
/** "live", "today", "2 days ago", "20 days ago, stale". @param {{ live: boolean, age: number, stale: boolean }} e */
export const whenText = (e) => (e.live ? "live" : `${e.age < 1 ? "today" : `${Math.floor(e.age)} day${Math.floor(e.age) === 1 ? "" : "s"} ago`}${e.stale ? ", stale" : ""}`);
/** "medium ☠☠". @param {{ word: string, skulls: string }} b */
export const bandText = (b) => `${b.word}${b.skulls ? ` ${b.skulls}` : ""}`;

/**
 * What the player believes of the tile, or null (no stamp and not on it: "threat unknown"):
 * { dead: { n, lo, hi, band (0–4), word, skulls } , raiders: the same or null (an older stamp did not count them),
 *   open: the open ground's dead { n, lo, hi } or null, cap, err, age (days), stale, live, src, when, text }.
 * @param {State} state @param {Tile | number} tile
 */
export function tileThreatEstimate(state, tile) {
  const id = idOf(state, tile);
  const t = state.tiles[id];
  if (!t || t.terrain === "water") return null;
  const old = tileThreatStamp(state, id);
  const live = threatLive(state, id);
  if (!old && !live) return null;
  const st = live
    ? { h: state.hour, k: old ? old.k : Math.floor(state.hour / 24) * 24, ...tileCounts(state, id), err: old ? Math.min(THREATKNOW.ERR.live, agedErr(old, state.hour)) : THREATKNOW.ERR.live, src: old ? old.src : "live" }
    : old;
  const err = live ? st.err : agedErr(st, state.hour);
  const age = live ? 0 : Math.max(0, state.hour - st.h) / 24;
  const stale = !live && age >= THREAT.STALE_DAYS;
  const die = (salt) => hash01(state.seed, "tilethreat", id, st.k, salt);
  const dn = place(st.d, err, die("d"));
  const dead = { ...dn, ...threatBandOf(dn.n, st.cap || 0) };
  const rn = place(st.r, err, die("r"));
  const raiders = rn ? { ...rn, ...threatBandOf(rn.n, st.rcap || 0) } : null;
  const open = place(st.o, err, die("d")); // the same die as the dead: the open ground moves with the tile's count
  const e = { dead, raiders, open, cap: st.cap, err, age, stale, live, src: st.src, when: "", text: "" };
  e.when = whenText(e);
  e.text = `${bandText(dead)} (${e.when})`;
  return e;
}
/** "threat unknown", or the dead's estimate as text. @param {State} state @param {Tile | number} tile */
export function tileThreatText(state, tile) {
  const e = tileThreatEstimate(state, tile);
  return e ? e.text : "threat unknown";
}

// ---------- a POI's estimate (on its threat stamp) ----------
/**
 * The fields a look at POI i adds to its threat stamp (pois.js notePoiThreat): { d, dc, r, de } (its dead, its cap, its
 * raiders, the error on them). src "survey" takes the survey's error (err given: less with optics); a POI's own look
 * (visit, look) the wider ERR[src]; "live" the smaller of ERR.live and the old stamp's aged error.
 * @param {State} state @param {Tile} t @param {number} i @param {string} src @param {number | null} err @param {any} [old]
 */
export function poiStampFields(state, t, i, src, err, old = null) {
  const own = src === "survey" && err != null ? err : THREATKNOW.ERR[src] ?? THREATKNOW.ERR.visit;
  const prev = old && old.d != null && old.de != null ? Math.min(THREAT.MAX_ERR, old.de + THREAT.STALE * Math.max(0, state.hour - old.hour) / 24) : Infinity;
  return { d: poiDead(state, t, i), dc: poiCap(state, t, i), r: poiRaiders(state, t, i), de: Math.round(Math.min(own, prev) * 1000) / 1000 };
}
/**
 * The dead and raiders the player believes POI i holds, or null (never looked at, or a stamp from before the counts):
 * { dead: { n, lo, hi, band, word, skulls }, raiders, err, age, stale, live, src, when, text }.
 * @param {State} state @param {Tile | number} tile @param {number} i
 */
export function poiDeadEstimate(state, tile, i) {
  const id = idOf(state, tile), t = state.tiles[id], p = poiAt(t, i);
  if (!p) return null;
  const old = p.threatStamp && p.threatStamp.d != null ? p.threatStamp : null;
  const live = threatLive(state, id) && knownPois(state, t).includes(i);
  if (!old && !live) return null;
  const st = live ? { hour: state.hour, k: old ? old.k ?? old.hour : Math.floor(state.hour / 24) * 24, ...poiStampFields(state, t, i, "live", null, old), src: old ? old.src : "live" } : old;
  const err = live ? st.de : Math.min(THREAT.MAX_ERR, st.de + THREAT.STALE * Math.max(0, state.hour - st.hour) / 24);
  const age = live ? 0 : Math.max(0, state.hour - st.hour) / 24;
  const stale = !live && age >= THREAT.STALE_DAYS;
  const die = (salt) => hash01(state.seed, "poidead", id, i, st.k ?? st.hour, salt);
  const dn = place(st.d, err, die("d"));
  const rn = place(st.r, err, die("r"));
  const e = { dead: { ...dn, ...threatBandOf(dn.n, st.dc || 0) }, raiders: { ...rn, ...threatBandOf(rn.n, DEADPOP.POI_RAIDERS.max) }, err, age, stale, live, src: st.src, when: "", text: "" };
  e.when = whenText(e);
  e.text = `${bandText(e.dead)} (${e.when})`;
  return e;
}

// ---------- the hour ----------
/**
 * Every hour (world.js tickHour): each tile your people stand on is looked at live, its stamp and its known POIs'
 * written with the counts now (so the last look stays when everyone leaves). Returns how many tiles.
 * @param {State} state
 */
export function threatKnowHour(state) {
  let n = 0;
  for (const id of liveTiles(state)) {
    const t = state.tiles[id];
    if (!t || t.terrain === "water") continue;
    noteTileThreat(state, id, "live");
    for (const i of knownPois(state, t)) notePoiThreat(state, t, i, "live");
    n++;
  }
  return n;
}

// ---------- the State Map's overlay ----------
/**
 * The "The dead on the land" layer: [{ tile, level (0–4), word, live }] for every land tile with a stamp or live now.
 * Known tiles only: a tile nobody looked at and nobody stands on is never on it.
 * @param {State} state
 */
export function threatOverlay(state) {
  const ids = new Set(liveTiles(state));
  for (const [k, v] of Object.entries(state.poiKnow || {})) if (v && v.threat) ids.add(Number(k));
  const out = [];
  for (const id of [...ids].sort((a, b) => a - b)) {
    const e = tileThreatEstimate(state, id);
    if (e) out.push({ tile: id, level: e.dead.band, word: e.dead.word, live: e.live, stale: e.stale });
  }
  return out;
}

// ---------- the raid strip ----------
/**
 * The dead of the tile's open ground within earshot of a fight there as the player believes it (deadpop.js earshot's
 * rule on the estimated open ground), less `drawn` already come: { n, text ("~12") } or null without an estimate.
 * @param {State} state @param {Tile | number} tile @param {number} [drawn]
 */
export function earshotEstimate(state, tile, drawn = 0) {
  const e = tileThreatEstimate(state, tile);
  if (!e || !e.open) return null;
  const o = e.open.n;
  const all = o > 0 ? Math.min(DEADPOP.EARSHOT_MAX, Math.max(1, Math.round(o * DEADPOP.EARSHOT))) : 0;
  const left = Math.max(0, all - Math.max(0, drawn || 0));
  const n = left >= THREATKNOW.ROUND_FROM ? Math.round(left / THREATKNOW.ROUND) * THREATKNOW.ROUND : left;
  return { n, text: n > 0 ? `~${n}` : "none", live: e.live };
}

// ---------- the groups (AI parity) ----------
/**
 * A group's look at a tile (its survey, its raid there): its own stamp [hour, d, cap, r, rcap] in its knowledge
 * (grouppois.js groupPoiRecord .t). Returns the stamp.
 * @param {State} state @param {any} who @param {Tile | number} tile
 */
export function noteGroupThreat(state, who, tile) {
  const id = idOf(state, tile);
  const rec = /** @type {any} */ (groupPoiRecord(state, who, true));
  if (!rec) return null;
  const c = tileCounts(state, id);
  (rec.t || (rec.t = {}))[id] = [state.hour, c.d, c.cap, c.r, c.rcap];
  return rec.t[id];
}
/**
 * What a group believes of a tile's dead and raiders (its own stamp; the player's rules: ERR.group, stale with the
 * days), or null: { dead: { n, band, word }, raiders, age, stale }.
 * @param {State} state @param {any} who @param {Tile | number} tile
 */
export function groupThreatEstimate(state, who, tile) {
  const id = idOf(state, tile);
  const rec = /** @type {any} */ (groupPoiRecord(state, who));
  const st = rec && rec.t ? rec.t[id] : null;
  if (!st) return null;
  const [h, d, cap, r, rcap] = st;
  const age = Math.max(0, state.hour - h) / 24;
  const err = Math.min(THREAT.MAX_ERR, THREATKNOW.ERR.group + THREAT.STALE * age);
  const key = typeof who === "object" && who ? who.id : who;
  const dn = place(d, err, hash01(state.seed, "gthreat", id, h, String(key), "d"));
  const rn = place(r, err, hash01(state.seed, "gthreat", id, h, String(key), "r"));
  return { dead: { ...dn, ...threatBandOf(dn.n, cap) }, raiders: { ...rn, ...threatBandOf(rn.n, rcap) }, age, stale: age >= THREAT.STALE_DAYS };
}

// ---------- saves ----------
/**
 * An older save (save.js deserializeState, after ensureDeadPop): its tile-heat stamps (state.poiKnow[tile].heat, issue
 * #65's) become threat stamps (those that counted the dead; a stamp of the heat alone, from before the pools, says
 * nothing of the dead and is dropped). Deterministic; a save with none needs nothing.
 * @param {State} state
 */
export function ensureThreatKnow(state) {
  for (const k of Object.values(state.poiKnow || {})) {
    if (!k || !k.heat) continue;
    const h = k.heat;
    if (h.d != null && !k.threat) k.threat = { h: h.hour, k: h.hour, d: h.d, o: null, cap: h.cap || 0, r: null, rcap: null, err: THREATKNOW.ERR.visit, src: "visit" };
    delete k.heat;
  }
}
/** Every tile with the hub's stamp (tests, the codex). @param {State} state @returns {number[]} */
export const stampedTiles = (state) => Object.entries(state.poiKnow || {}).filter(([, v]) => v && v.threat).map(([k]) => Number(k));
