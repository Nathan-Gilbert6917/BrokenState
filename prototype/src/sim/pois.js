// @ts-check
// Points of interest (POIs): the places a map tile holds (a house, a shed, a gas station, a hiker camp…).
//
// A tile used to be a site (tile.loc, one building drawn as a sprite) or bare ground. Now every land tile can hold
// 0–4 POIs (tile.pois), each with a loot pool of its own and, later, a container ledger and a threat estimate:
// - Where: land tiles only; never water, a city or town centre (those keep the block-by-block crawl, citycrawl.js)
//   or a hive tile (the hive replaces them; destroyed, the tile stays empty). A base tile keeps its POIs.
// - How many (fixed when the world is made; only "stripped" changes in play), by terrain (COUNTS): mountains 0–1,
//   hills and forest 0–2, farmland 0–3, suburbs and bare city blocks 1–4; a tile with a site keeps the site as its
//   top POI and gets 0 / 0–1 / 0–2 / 0–3 extras, at most POI.MAX in all. Kinds come from the terrain's pool
//   (POI_KINDS: data.js LOCATIONS types, the small ones new with this module: house, shed, hunting blind…).
// - The top POI is index 0: the site on a site tile (tile.loc stays as it is), else the richest kind (LOCATIONS
//   richness; ties by a hash of the tile and the kind). Extras on a site tile never out-rank the site. On a bare
//   tile tile.loc is never written (many modules read it as "a site stands here").
// - Known and hidden: the known zone is a road tile, a tile next to one, a city footprint (radius 4 / 3) or a
//   town footprint (radius 2: the suburb ring mapgen.js lays round every town). There a tile's POIs start known
//   except 0–2 of the non-top ones (poi.hidden); so the top POI always shows. In the unknown zone every POI of a bare
//   tile is hidden. The site of a site tile keeps its discovery class (discovery.js: public, road, secret), its extras
//   follow the zone. (Extras on their own dice after the list, marked poi.extra: a campsite, campsite.js; a gun store
//   or a pawn shop, a bar, a bank, any shop or service of shops.js.) A POI of a kind with franchises (data-shops.js)
//   is one of them (poi.v, shops.js franchiseFor by its own dice and the tile's setting): its name (poiName), its
//   sprite and its building's layout. No two POIs on a tile are the same franchise (2026-10-24, the user: "all city and
//   POI names are unique"; a kind a tile may hold twice, REPEATABLE's corner store: the second takes the next franchise
//   of its kind, so poiName never repeats on a tile; the sites' proper names are unique map-wide: mapgen.js). A hidden POI is found by a survey (survey.js, revealPois): the team keeps its finds (p.poiFinds)
//   until its report reaches the hub (world.js mergeKnowledge → mergePoiFinds → state.poiKnow, the hub's record per
//   tile: the indices found and when the tile was surveyed or looked at). The UI never says how many are hidden.
// - Pools: a POI's loot pool (0–1, the share of its original loot still there) is set from its kind's richness and
//   never grows. The site POI of a site tile keeps using tile.loot (poiPool / poiTake route to it), so every writer
//   of tile.loot (scavenge.js, aiscav.js, visitors.js, citycrawl.js, hardcore-*) works as it did; extras and bare
//   tiles' POIs keep poi.pool. poi.stripped marks a pool run down to POI.STRIPPED.
// - Per POI (saved with the tile): { kind, hidden, pool, visits, lastDay, cont, threatStamp, stripped, site?, extra?, v? }:
//   cont is the container ledger (poiLedger makes it; poicont.js keeps it: which containers were looted and by whom,
//   what the player opened and left in them), threatStamp the perceived threat recorded by a survey or a visit,
//   visits / lastDay the player's visit history; site marks the site POI.
// - Tile heat (state.tileHeat, TILE_HEAT): per tile, raised by going into and out of its places and by others'
//   raids, falling 10% a day; it raises every POI's true threat and the raid roster. Seen as a stamp (noteTileHeat).
// - Threat: the true threat of a POI (poiThreat) is its kind's danger + the tile's infection + the tile's heat + a
//   hive-land bonus (THREAT.HIVE × hives.js zombieToughness); the raid roster reads the true value (scavenge.js
//   raidEnemies). What the player sees is an estimate (poiThreatEstimate, the intelest.js pattern): a stamp made by
//   a full survey (notePoiThreat "survey", error 20%, less with optics) or a visit (10%) whose error grows by
//   THREAT.STALE a day; a word with skulls (quiet / some risk / dangerous / very dangerous) placed by the seed's dice
//   inside the error, "stale" past THREAT.STALE_DAYS, and "threat unknown" with no stamp at all.
// - Picked over: poiBand (0 rich … 3 picked clean, aiscav.js lootBand's cuts) against what the POI held untouched
//   (poiFull). bestKnownPoi picks the POI a headless search goes for: value × what is left / the perceived threat.
// Everything here rolls hash dice from the world seed and the tile (skills.js hash01), never state.rng, so a
// world made before POIs existed gets the same lists on load (save.js deserializeState → ensurePois), with its
// tile.loot as the site POI's pool. A save keeps only what changed: the lists are left off the tiles and the POIs
// that differ from their generated defaults (and the tiles cleared by a hive) go in state.poiMods (packPois,
// save.js serializeState), put back over the regenerated lists on load (ensurePois). A POI's fields must stay
// plain data (objects, lists, numbers, strings; Maps and Sets are compared too) for the difference to be seen.
/** @import { State, Tile, Party } from "./types" */
import { LOCATIONS } from "./data.js";
import { ZONE_RICHNESS } from "./mapgen.js"; // what a site held untouched (poiFull)
import { hash01 } from "./skills.js";
import { isPublicSite, siteKnown, nearRoad } from "./discovery.js";
import { localId } from "./world.js";
import { zombieToughness } from "./hives.js"; // hive land: the dead are more and tougher there (the threat's hive bonus)
import { campsiteExtra, campDanger, noteCampSeen } from "./campsite.js"; // call-time only: the extra campsite a tile may hold, its state in the threat, a look at it
import { shopExtras, franchiseFor, franchisesOf, franchiseName, settingOf, noFirm } from "./shops.js"; // call-time only: the shops a suburb or city block may hold, a place's franchise
import { hotelExtra } from "./hotels.js"; // call-time only: a hotel a tile may hold (issue #29)

export const POI = {
  MAX: 4,                 // POIs a tile can hold, the site among them
  HIDDEN_MAX: 2,          // hidden POIs among a known-zone tile's non-top ones
  STRIPPED: 0.03,         // a pool at or below this is stripped (picked clean)
  POOL: [0.7, 1.2],       // a pool starts at richness × this (mapgen.js placeLoc's spread for sites)
  CITY_R: [4, 3],         // a city footprint: Calder City (the first city), the other cities
  TOWN_R: 2,              // a town footprint (the suburb ring round it, mapgen.js)
  URBAN_RICH: 1.15,       // city blocks are richer (mapgen.js ZONE_RICHNESS.urban)
};

// The kinds per terrain (LOCATIONS types). A bare city block holds the shops and offices of a city block.
export const POI_KINDS = {
  mountain: ["cabin", "mineshack", "hikercamp"],
  hills: ["cabin", "shed", "farm", "blind"],
  forest: ["cabin", "blind", "campsite", "shed"],
  plains: ["farm", "barn", "farmstand", "shed"],
  suburb: ["house", "neighbourhood", "school", "gas", "pizza", "corner", "garage"],
  city: ["office", "apartments", "corner", "garage", "pharmacy"],
};
// Kinds a tile may hold more than once (two houses on a block, two sheds on a farm).
const REPEATABLE = new Set(["house", "shed", "cabin", "garage", "corner", "campsite"]);
// How many, by terrain: [bare min, bare max, extras min, extras max (a tile with a site)].
export const COUNTS = {
  mountain: [0, 1, 0, 0], hills: [0, 2, 0, 1], forest: [0, 2, 0, 1], plains: [0, 3, 0, 2], suburb: [1, 4, 0, 3], city: [1, 4, 0, 3],
};
/** The kinds a terrain's POIs are drawn from. @param {string} terrain @returns {string[]} */
export const poiKinds = (terrain) => POI_KINDS[terrain] || [];
/** Every POI kind (for the sprite and painter tables). @returns {string[]} */
export const allPoiKinds = () => [...new Set(Object.values(POI_KINDS).flat())];

/** @param {State} state @param {Tile | number} t @returns {Tile} */
const tileOf = (state, t) => (typeof t === "number" ? state.tiles[t] : t);
// A site that stands for good (a wreck, a supply drop or a convoy is an event: it is not a POI and the tile keeps
// its own list under it).
/** @param {Tile} t */
export const permanentSite = (t) => !!(t && t.loc && t.loc.crash == null && t.loc.convoy == null && !(LOCATIONS[t.loc.type] && LOCATIONS[t.loc.type].temp));

// ---------- eligibility and the known zone ----------
/** May this tile hold POIs? @param {State} state @param {Tile | number} tile */
export function poiEligible(state, tile) {
  const t = tileOf(state, tile);
  if (!t || t.terrain === "water" || t.hive) return false;
  if (t.loc && (t.loc.type === "city" || t.loc.type === "town")) return false;
  return !!COUNTS[t.terrain];
}
const zoneMemo = new WeakMap(); // tiles array -> Uint8Array (1 known zone, 2 not)
/** The known zone: on or by a road, in a city footprint or a town footprint. @param {State} state @param {Tile | number} tile */
export function inKnownZone(state, tile) {
  const t = tileOf(state, tile);
  if (!t) return false;
  let m = zoneMemo.get(state.tiles);
  if (!m) zoneMemo.set(state.tiles, (m = new Uint8Array(state.tiles.length)));
  if (!m[t.id]) {
    let known = nearRoad(state, t.id) || t.terrain === "city" || t.terrain === "suburb";
    if (!known) {
      const g = state.grid;
      const cities = state.cityIds || [];
      for (let i = 0; i < cities.length && !known; i++) known = g.distance(cities[i], t.id) <= POI.CITY_R[i ? 1 : 0];
      if (!known) for (const id of g.within(t.id, POI.TOWN_R)) { const o = state.tiles[id]; if (o && o.loc && o.loc.type === "town") { known = true; break; } }
    }
    m[t.id] = known ? 1 : 2;
  }
  return m[t.id] === 1;
}

// ---------- generation ----------
/** @param {State} state @param {Tile} t @param {string} kind @param {boolean} site @param {number} slot @param {any[]} [before] the tile's POIs so far (no two the same franchise) */
function makePoi(state, t, kind, site, slot, before = []) {
  const def = LOCATIONS[kind];
  const pool = site ? null : def.richness * (t.terrain === "city" ? POI.URBAN_RICH : 1) * (POI.POOL[0] + (POI.POOL[1] - POI.POOL[0]) * hash01(state.seed, "poipool", t.id, slot));
  let v = noFirm(state, kind) ? null : franchiseFor(kind, settingOf(state, t), hash01(state.seed, "poifr", t.id, slot)); // shops.js: the franchise (a kind with none: null; an office tower in a save from before its firms: none)
  if (v) { // the same chain twice on a tile (a second corner store): the next franchise of the kind not on it yet, in the list's order
    const onTile = new Set(before.filter((p) => p.kind === kind && p.v).map((p) => p.v));
    if (onTile.has(v)) { const ids = franchisesOf(kind).map((f) => f.id), at = ids.indexOf(v); v = ids.map((_, i) => ids[(at + 1 + i) % ids.length]).find((id) => !onTile.has(id)) || v; }
  }
  return { kind, hidden: false, pool: pool == null ? null : Math.min(1, pool), visits: 0, lastDay: null, cont: null, threatStamp: null, stripped: false, ...(site ? { site: true } : {}), ...(v ? { v } : {}) };
}
// The tile's list from the world seed and the tile (no state.rng: the same for a world made before POIs existed).
/** @param {State} state @param {Tile} t */
export function generatePois(state, t) {
  if (!poiEligible(state, t)) return [];
  const site = permanentSite(t);
  const [bMin, bMax, eMin, eMax] = COUNTS[t.terrain];
  const [lo, hi] = site ? [eMin, Math.min(eMax, POI.MAX - 1)] : [bMin, bMax];
  const n = lo + Math.floor(hash01(state.seed, "poin", t.id) * (hi - lo + 1));
  const out = [];
  let pool = poiKinds(t.terrain);
  if (site) {
    out.push(makePoi(state, t, t.loc.type, true, 0));
    // Extras never out-rank the site (the site is the top POI); the whole pool when nothing is poorer.
    const under = pool.filter((k) => LOCATIONS[k].richness <= LOCATIONS[t.loc.type].richness);
    if (under.length) pool = under;
  }
  const extras = [];
  for (let i = 0; i < n; i++) {
    const cands = pool.filter((k) => REPEATABLE.has(k) || !extras.some((p) => p.kind === k));
    if (!cands.length) break;
    const kind = cands[Math.floor(hash01(state.seed, "poikind", t.id, i) * cands.length)];
    extras.push(makePoi(state, t, kind, false, i + 1, [...out, ...extras]));
  }
  // Richest first: the top POI of a bare tile is index 0 (ties by a hash of the tile and the kind).
  extras.sort((a, b) => LOCATIONS[b.kind].richness - LOCATIONS[a.kind].richness || hash01("poitie", t.id, b.kind) - hash01("poitie", t.id, a.kind));
  out.push(...extras);
  // Hidden: in the known zone 0–2 of the non-top ones; in the unknown zone every one of a bare tile's. The site
  // keeps its discovery class (what poiKnown reads; the flag is its class on a pre-war map).
  if (site) out[0].hidden = !isPublicSite(state, t.id);
  const rest = out.slice(1);
  if (inKnownZone(state, t)) {
    const h = Math.min(rest.length, Math.floor(hash01(state.seed, "poihid", t.id) * (POI.HIDDEN_MAX + 1)));
    const order = rest.map((p, i) => i).sort((a, b) => hash01(state.seed, "poihidpick", t.id, a) - hash01(state.seed, "poihidpick", t.id, b));
    for (const i of order.slice(0, h)) rest[i].hidden = true;
  } else {
    for (const p of rest) p.hidden = true;
    if (!site && out[0]) out[0].hidden = true;
  }
  // campsite.js: now and then a campsite besides (the woods, the countryside, a roadside, a lake or a riverside), on its
  // own dice after the list above, so the list before it (and a save's changes to it) stays as it was.
  const camp = campsiteExtra(state, t, out, inKnownZone(state, t));
  if (camp) out.push(camp);
  // shops.js: up to two shops or services on a suburb or a city block, on their own dice after everything above.
  out.push(...shopExtras(state, t, out, inKnownZone(state, t), POI.MAX));
  // Bunkers (issue #26): now and then one, on their own dice after everything above (bunkerExtra).
  const bunker = bunkerExtra(state, t, out, inKnownZone(state, t));
  if (bunker) out.push(bunker);
  // hotels.js: now and then a hotel (a town's inn, a city's tower, a resort in scenic land), on its own dice after all.
  const hotel = hotelExtra(state, t, out, inKnownZone(state, t));
  if (hotel) out.push(hotel);
  return out;
}

// ---------- bunkers (issue #26, bunkerlayout.js) ----------
// The chance a tile holds one, by kind and terrain (tried in this order, the first that rolls is the tile's one bunker):
// the military command bunker in the hills and mountains, NEAR × as often within NEAR_HEX hexes of a military site
// (state.militaryIds); the government bunker under a mountain or a city block; a public fallout shelter in a suburb (a
// town's ring) or a city block; a prepper's bunker in the countryside. Hash dice of the seed and the tile (never the
// world's dice: every map is as it was; an older save's lists gain the bunker at their end, as the shops did). A
// shelter is found like a roadside place (known in the known zone SHELTER_KNOWN of the time); the rest are secret
// (hidden until a survey finds them). At most POI.MAX on a tile, as always.
export const BUNKER_POI = {
  bunker: { hills: 0.0005, mountain: 0.0008 }, NEAR: 20, NEAR_HEX: 8,
  govbunker: { mountain: 0.0006, city: 0.002 },
  shelter: { suburb: 0.05, city: 0.04 },
  prepper: { plains: 0.006, forest: 0.01, hills: 0.012, mountain: 0.008 },
  SHELTER_KNOWN: 0.5, POOL: [0.8, 1.1],
};
/** @param {State} state @param {Tile} t @param {any[]} list @param {boolean} knownZone */
export function bunkerExtra(state, t, list, knownZone) {
  if (!t || list.length >= POI.MAX || t.terrain === "water") return null;
  const near = () => { const g = /** @type {any} */ (state).grid, ids = /** @type {any} */ (state).militaryIds || []; return !!(g && g.distance && ids.some((m) => g.distance(t.id, m) <= BUNKER_POI.NEAR_HEX)); };
  for (const kind of ["bunker", "govbunker", "shelter", "prepper"]) {
    let p = /** @type {Record<string, number>} */ (BUNKER_POI[kind])[t.terrain] || 0;
    if (!p || list.some((q) => q.kind === kind) || (t.loc && LOCATIONS[t.loc.type] && LOCATIONS[kind].richness > LOCATIONS[t.loc.type].richness)) continue; // an extra never out-ranks the site
    if (kind === "bunker" && near()) p *= BUNKER_POI.NEAR;
    if (hash01(state.seed, "bunkerpoi", t.id, kind) >= p) continue;
    const spread = BUNKER_POI.POOL[0] + (BUNKER_POI.POOL[1] - BUNKER_POI.POOL[0]) * hash01(state.seed, "bunkerpool", t.id);
    const hidden = !(kind === "shelter" && knownZone && hash01(state.seed, "bunkerknown", t.id) < BUNKER_POI.SHELTER_KNOWN);
    return { kind, hidden, pool: Math.min(1, LOCATIONS[kind].richness * spread), visits: 0, lastDay: null, cont: null, threatStamp: null, stripped: false, extra: "bunker" };
  }
  return null;
}

// Every tile has its list (a world made before POIs existed gets them on load, save.js), and the hub's record. A
// save's changes (state.poiMods, packPois) go back over the regenerated lists.
/** @param {State} state */
export function ensurePois(state) {
  if (!state.poiKnow || typeof state.poiKnow !== "object") state.poiKnow = {};
  const mods = state.poiMods && typeof state.poiMods === "object" ? state.poiMods : null;
  for (const t of state.tiles) {
    if (Array.isArray(t.pois)) continue;
    const m = mods ? mods[t.id] : null;
    if (m && Array.isArray(m.list)) { t.pois = m.list; continue; }
    t.pois = generatePois(state, t);
    if (m && m.m) for (const [i, poi] of Object.entries(m.m)) if (+i < t.pois.length) t.pois[+i] = poi;
  }
  delete state.poiMods;
  return state;
}
// Plain-data equality (objects, lists, Maps, Sets, typed arrays, numbers by value).
function same(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (a instanceof Map || b instanceof Map) return a instanceof Map && b instanceof Map && a.size === b.size && [...a].every(([k, v]) => b.has(k) && same(v, b.get(k)));
  if (a instanceof Set || b instanceof Set) return a instanceof Set && b instanceof Set && a.size === b.size && [...a].every((x) => b.has(x));
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    const ta = /** @type {any} */ (a), tb = /** @type {any} */ (b);
    return ArrayBuffer.isView(a) && ArrayBuffer.isView(b) && ta.constructor === tb.constructor && ta.length === tb.length && Array.from(ta).every((x, i) => x === tb[i]);
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => k in b && same(a[k], b[k]));
}
/**
 * The tiles' lists as the changes from their generated defaults, for a save: { [tileId]: { m: { i: poi } } } for the
 * POIs that differ, { list } for a tile whose list is not the generated one's length (cleared by a hive); nothing
 * for a tile as it was made. Deterministic (hash dice), so a loaded world packs the same.
 * @param {State} state @returns {{ [id: string]: { m?: { [i: string]: any }, list?: any[] } }}
 */
export function packPois(state) {
  /** @type {{ [id: string]: { m?: { [i: string]: any }, list?: any[] } }} */
  const out = {};
  for (const t of state.tiles) {
    if (!Array.isArray(t.pois)) continue;
    const def = generatePois(state, t);
    if (t.pois.length !== def.length) { out[t.id] = { list: t.pois }; continue; }
    let m = null;
    for (let i = 0; i < def.length; i++) if (!same(t.pois[i], def[i])) (m = m || {})[i] = t.pois[i];
    if (m) out[t.id] = { m };
  }
  return out;
}
/** A hive rose or a hive was destroyed here: its POIs are gone for good. @param {Tile} t */
export function clearPois(t) {
  if (t) t.pois = [];
}

// ---------- the list ----------
/** @param {Tile} t @returns {any[]} */
export const poisOf = (t) => (t && Array.isArray(t.pois) && !t.hive ? t.pois : []);
/** The top POI (index 0): the site, or the richest. @param {Tile} t */
export const topPoi = (t) => poisOf(t)[0] || null;
/** @param {Tile} t @param {number} i */
export const poiAt = (t, i) => poisOf(t)[i] || null;
/** Is POI i the tile's site (its pool is tile.loot)? @param {Tile} t @param {number} i */
export const isSitePoi = (t, i) => i === 0 && !!(poisOf(t)[0] && poisOf(t)[0].site) && permanentSite(t);
/** @param {any} poi */
export const poiDef = (poi) => (poi ? LOCATIONS[poi.kind] : null);
/** The kind's name ("House"); a site POI its own name. @param {Tile} t @param {number} i */
export function poiName(t, i) {
  const p = poiAt(t, i);
  if (!p) return "";
  return isSitePoi(t, i) ? t.loc.name : p.v ? franchiseName(p.kind, p.v) : LOCATIONS[p.kind].name; // shops.js: a franchise's name
}

// ---------- pools ----------
/** What is left of POI i's loot, 0–1 (the site's: tile.loot). @param {Tile} t @param {number} i */
export function poiPool(t, i) {
  const p = poiAt(t, i);
  if (!p) return 0;
  if (isSitePoi(t, i)) return t.loot || 0;
  return p.pool || 0;
}
/** Takes `amount` from POI i's pool (never below 0); returns what was taken. @param {Tile} t @param {number} i @param {number} amount */
export function poiTake(t, i, amount) {
  const p = poiAt(t, i);
  if (!p || !(amount > 0)) return 0;
  const was = poiPool(t, i), now = Math.max(0, was - amount);
  if (isSitePoi(t, i)) t.loot = now;
  else p.pool = now;
  if (now <= POI.STRIPPED) p.stripped = true;
  return was - now;
}
/**
 * How picked over POI i is (the bands of aiscav.js lootBand, LOOT_BANDS: 0 rich, 1 some, 2 little, 3 picked clean),
 * from its pool now, or from a pool as it was last seen (a snapshot's). The site POI is measured as its site is.
 * @param {Tile} t @param {number} i @param {number} [pool]
 */
export function poiLootBand(t, i, pool = poiPool(t, i)) {
  if (!poiAt(t, i) || pool == null) return 0;
  const r = pool / Math.max(0.05, poiFull(t, i));
  return pool <= POI.STRIPPED + 0.02 || r < 0.1 ? 3 : r < 0.3 ? 2 : r < 0.6 ? 1 : 0;
}
/** The container ledger of POI i, made on first use: { n, looted: { containerId: byGroupId }, mine: { containerId: { contents, hidden, quick, lock } } }. @param {Tile} t @param {number} i */
export function poiLedger(t, i) {
  const p = poiAt(t, i);
  if (!p) return null;
  if (!p.cont) p.cont = { n: 0, looted: {}, mine: {} };
  return p.cont;
}

// ---------- pools as bands ----------
/** The band names (aiscav.js LOOT_BANDS: rich, some, little, picked clean). */
export const POI_BANDS = ["Rich", "Some", "Little", "Picked clean"];
/** What POI i held untouched (its kind's richness × its zone), the pool's ceiling. @param {Tile} t @param {number} i */
export function poiFull(t, i) {
  const p = poiAt(t, i);
  if (!p) return 0;
  const def = LOCATIONS[p.kind];
  if (!def) return 1;
  if (isSitePoi(t, i)) return def.richness * (t.loc.type === "town" ? 1 : ZONE_RICHNESS[t.loc.zone] || 1);
  return def.richness * (t.terrain === "city" ? POI.URBAN_RICH : 1);
}
/** The picked-over band of POI i: 0 rich (60%+ left), 1 some (30%+), 2 little (10%+), 3 picked clean. @param {Tile} t @param {number} i */
export function poiBand(t, i) {
  const p = poiAt(t, i);
  return !p || p.stripped ? 3 : poiLootBand(t, i);
}
/** @param {Tile} t @param {number} i */
export const poiBandName = (t, i) => POI_BANDS[poiBand(t, i)];

// ---------- threat and heat ----------
export const THREAT = {
  HIVE: 0.5,                               // + this × zombieToughness (1 on hive land, 3 on the red-skull ring)
  ERR: { survey: 0.2, visit: 0.1 },        // a stamp's error by its source (intelnotes.js LOOK_ERR survey / visit)
  STALE: 0.03, MAX_ERR: 1.0,               // the error grows this much a day (intelest.js INTEL.STALE), up to this
  STALE_DAYS: 14,                          // older than this the estimate says "stale"
  BANDS: [[0.6, "quiet"], [1.5, "some risk"], [2.6, "dangerous"], [Infinity, "very dangerous"]], // threat < cut → word; skulls = the band's index
};
// Tile heat (persistent, per tile: state.tileHeat { [tileId]: 0–TILE_HEAT.MAX }): what raiding a tile's places
// stirs up there. Not Field Heat (fieldheat.js, a team's own) and not Scavenge Heat (scavenge.js, one search's or
// one raid's). Going into a POI adds ENTER; coming out adds the approach's heat (scavenge.js APPROACHES: sneak 7,
// normal 13, loud 22; an interactive raid by how hot it ran) and SHOT a shot fired (the fieldheat.js noteGunfire
// record, up to SHOT_CAP); another group's abstract raid adds AI (poicont.js lootPoiAbstract). It falls by DECAY a
// day (tileHeatDaily) and is dropped below FLOOR. The true threat of every POI on the tile rises by THREAT at MAX
// heat (poiThreat); the raid roster grows (scavenge.js raidEnemies: one more of the dead every ROSTER heat, and from
// SURGE up a chance of a horde or a wandering band drawn by the noise, at most SURGE_P). The player sees it as a
// stamp made when a team is there (noteTileHeat: a visit, a raid's end, a full survey) that goes stale as the
// threat's does (tileHeatEstimate).
export const TILE_HEAT = {
  ENTER: 3, SHOT: 0.5, SHOT_CAP: 15, AI: 4,
  DECAY: 0.9, FLOOR: 0.5, MAX: 100,
  THREAT: 1.5, ROSTER: 20, SURGE: 50, SURGE_P: 0.2,
  ERR: 0.25,                                                               // a stamp's error (the estimate's, as THREAT.ERR)
  BANDS: [[10, "cold"], [30, "warm"], [60, "hot"], [Infinity, "very hot"]], // heat < cut → word
};
/** The tile's heat now (0 when nothing has stirred it). @param {State} state @param {Tile | number} tile @returns {number} */
export function tileHeat(state, tile) {
  const id = typeof tile === "number" ? tile : tile ? tile.id : null;
  const h = id != null && state.tileHeat ? state.tileHeat[id] : 0;
  return h > 0 ? h : 0;
}
/** Adds to a tile's heat (capped at TILE_HEAT.MAX); returns the heat after. @param {State} state @param {Tile | number} tile @param {number} amount */
export function addTileHeat(state, tile, amount) {
  const id = typeof tile === "number" ? tile : tile ? tile.id : null;
  if (id == null || !(amount > 0)) return tileHeat(state, id);
  if (!state.tileHeat || typeof state.tileHeat !== "object") state.tileHeat = {};
  return (state.tileHeat[id] = Math.min(TILE_HEAT.MAX, tileHeat(state, id) + amount));
}
/** The heat a team coming out of a POI adds: the approach's heat (scavenge.js APPROACHES) and the shots fired. @param {number} approachHeat @param {number} [shots] */
export const exitHeat = (approachHeat, shots = 0) => Math.max(0, approachHeat || 0) + Math.min(TILE_HEAT.SHOT_CAP, Math.max(0, shots || 0) * TILE_HEAT.SHOT);
/** The shots fieldheat.js noteGunfire recorded on a tile this hour (a raid's own: finishCombat notes them first). @param {State} state @param {number} id */
export const shotsHere = (state, id) => (state.gunfire || []).reduce((a, s) => a + (s.tile === id && s.hour === state.hour ? s.n : 0), 0);
/** The day's fall (world.js tickHour at midnight): every tile's heat × TILE_HEAT.DECAY, gone below FLOOR. @param {State} state */
export function tileHeatDaily(state) {
  const h = state.tileHeat;
  if (!h || typeof h !== "object") return;
  for (const k of Object.keys(h)) {
    const v = h[k] * TILE_HEAT.DECAY;
    if (!(v >= TILE_HEAT.FLOOR)) delete h[k];
    else h[k] = v;
  }
}
/** The band of a heat value: { band: 0–3, word }. @param {number} v */
export function heatBand(v) {
  const band = Math.max(0, TILE_HEAT.BANDS.findIndex(([cut]) => v < Number(cut)));
  return { band, word: String(TILE_HEAT.BANDS[band][1]) };
}
/** A team is on the tile and sees how stirred up it is: the hub's stamp { hour, v } (state.poiKnow[tile].heat). @param {State} state @param {Tile | number} tile */
export function noteTileHeat(state, tile) {
  const id = typeof tile === "number" ? tile : tile.id;
  const k = poiKnowledge(state, id, true);
  k.heat = { hour: state.hour, v: Math.round(tileHeat(state, id) * 10) / 10 };
  return k.heat;
}
/**
 * The heat the player believes the tile has, or null without a stamp: { v, word, band, age (days), stale, text }. The
 * stamp's value faded by the known daily fall, placed by the seed's dice inside an error that grows with its age (the
 * threat's rule: THREAT.STALE a day, "stale" past THREAT.STALE_DAYS): new heat since the look is not known.
 * @param {State} state @param {Tile | number} tile
 */
export function tileHeatEstimate(state, tile) {
  const id = typeof tile === "number" ? tile : tile.id;
  const k = poiKnowledge(state, id);
  const st = k && k.heat;
  if (!st) return null;
  const age = Math.max(0, state.hour - st.hour) / 24;
  const err = Math.min(THREAT.MAX_ERR, TILE_HEAT.ERR + THREAT.STALE * age);
  const faded = st.v * Math.pow(TILE_HEAT.DECAY, Math.floor(age));
  const v = Math.max(0, faded * (1 + (hash01(state.seed, "tileheat", id, st.hour) - 0.5) * err));
  const b = heatBand(v);
  const stale = age >= THREAT.STALE_DAYS;
  return { v, word: b.word, band: b.band, age, stale, text: `${b.word} (seen ${age < 1 ? "today" : `${Math.floor(age)}d ago`}${stale ? ", stale" : ""})` };
}
/** "unknown", or the estimate's text. @param {State} state @param {Tile | number} tile */
export function tileHeatText(state, tile) {
  const e = tileHeatEstimate(state, tile);
  return e ? e.text : "unknown";
}
/** The true threat at POI i: its kind's danger (0–3) + the tile's infection + its heat (up to TILE_HEAT.THREAT) + the hive-land bonus. @param {State} state @param {Tile | number} tile @param {number} i */
export function poiThreat(state, tile, i) {
  const t = tileOf(state, tile), p = poiAt(t, i);
  if (!p) return 0;
  return (LOCATIONS[p.kind].danger || 0) + (t.infection || 0) + (tileHeat(state, t) / TILE_HEAT.MAX) * TILE_HEAT.THREAT + THREAT.HIVE * zombieToughness(state, t.id) + campDanger(state, t, i); // campsite.js: an active or overrun camp
}
/** The band of a threat value: { band: 0–3, word, skulls }. @param {number} v */
export function threatBand(v) {
  const band = Math.max(0, THREAT.BANDS.findIndex(([cut]) => v < Number(cut)));
  return { band, word: String(THREAT.BANDS[band][1]), skulls: "☠".repeat(band) };
}
/**
 * Records what the player makes of POI i's threat now (a full survey or a visit): the true value with the source's
 * error (err given: the survey's, less with optics). Returns the stamp.
 * @param {State} state @param {Tile | number} tile @param {number} i @param {"survey" | "visit"} [src] @param {number | null} [err]
 */
export function notePoiThreat(state, tile, i, src = "visit", err = null) {
  const t = tileOf(state, tile), p = poiAt(t, i);
  if (!p) return null;
  const e = err != null ? err : THREAT.ERR[src] || THREAT.ERR.visit;
  // A fresh look replaces an older stamp; a rougher look never replaces a sharper one made the same hour.
  if (p.threatStamp && p.threatStamp.hour === state.hour && p.threatStamp.err <= e) return p.threatStamp;
  p.threatStamp = { hour: state.hour, v: poiThreat(state, t, i), err: e, src };
  noteTileHeat(state, t); // a look at a place is a look at how stirred up the tile is
  noteCampSeen(state, t, i); // campsite.js: who is at the camp (abandoned, overrun, raiders), as seen now
  return p.threatStamp;
}
/**
 * The perceived threat of POI i, or null without a stamp: { v, lo, hi, err, band, word, skulls, day, age (days),
 * stale, src, text }. The word is placed by the seed's dice inside the error (never the true value itself), and the
 * error grows with the stamp's age, so an old look says less and less.
 * @param {State} state @param {Tile | number} tile @param {number} i
 */
export function poiThreatEstimate(state, tile, i) {
  const t = tileOf(state, tile), p = poiAt(t, i);
  const st = p && p.threatStamp;
  if (!st) return null;
  const age = Math.max(0, state.hour - st.hour) / 24;
  const err = Math.min(THREAT.MAX_ERR, st.err + THREAT.STALE * age);
  const j = (hash01(state.seed, "poithreat", t.id, i, st.hour) - 0.5) * err;
  const v = Math.max(0, st.v * (1 + j));
  const lo = Math.max(0, st.v * (1 - err)), hi = st.v * (1 + err);
  const b = threatBand(v);
  const stale = age >= THREAT.STALE_DAYS;
  const d = Math.floor(st.hour / 24) + 1;
  const when = `${st.src === "survey" ? "surveyed" : "seen"} ${age < 1 ? "today" : `${Math.floor(age)}d ago`}`;
  return { v, lo, hi, err, band: b.band, word: b.word, skulls: b.skulls, day: d, age, stale, src: st.src, text: `${b.word}${b.skulls ? ` ${b.skulls}` : ""} (${when}${stale ? ", stale" : ""})` };
}
/** "threat unknown", or the estimate's text. @param {State} state @param {Tile | number} tile @param {number} i */
export function poiThreatText(state, tile, i) {
  const e = poiThreatEstimate(state, tile, i);
  return e ? e.text : "threat unknown";
}

// ---------- visits and the headless pick ----------
/** The player's team goes into POI i: its visit history and a fresh look at its threat. @param {State} state @param {Tile | number} tile @param {number} i */
export function visitPoi(state, tile, i) {
  const t = tileOf(state, tile), p = poiAt(t, i);
  if (!p) return null;
  p.visits = (p.visits || 0) + 1;
  p.lastDay = Math.floor(state.hour / 24) + 1;
  notePoiThreat(state, t, i, "visit");
  return p;
}
/** "never visited" / "been here 3d ago, 2 visits". @param {State} state @param {Tile | number} tile @param {number} i */
export function poiVisitText(state, tile, i) {
  const t = tileOf(state, tile), p = poiAt(t, i);
  if (!p || !p.visits) return "never visited";
  const ago = Math.floor(state.hour / 24) + 1 - (p.lastDay || 0);
  return `been here ${ago <= 0 ? "today" : `${ago}d ago`}, ${p.visits} visit${p.visits === 1 ? "" : "s"}`;
}
/** Is another group's party raiding POI i right now (a party on the tile at it: q.poi, set by the AI raids to come)? @param {State} state @param {Tile | number} tile @param {number} i */
export function raidingNow(state, tile, i) {
  const t = tileOf(state, tile);
  return (state.parties || []).some((q) => q.owner !== "player" && q.poi === i && q.path && q.path[q.idx] === t.id);
}
/** What a headless search sees in POI i: its value × what is left / (1 + the perceived threat; the true one unseen). @param {State} state @param {Tile | number} tile @param {number} i */
export function poiScore(state, tile, i) {
  const t = tileOf(state, tile), p = poiAt(t, i);
  if (!p) return 0;
  const est = poiThreatEstimate(state, t, i);
  return ((LOCATIONS[p.kind].richness || 0.1) * poiPool(t, i)) / (1 + (est ? est.v : 0.5));
}
/** The POI a headless search goes for: the best known one with loot left (-1 with none). @param {State} state @param {Tile | number} tile @param {Party | null} [p] @param {number[]} [exclude] */
export function bestKnownPoi(state, tile, p = null, exclude = []) {
  const t = tileOf(state, tile);
  let best = -1, bs = 0;
  for (const i of knownPois(state, t, p)) {
    if (exclude.includes(i) || poiPool(t, i) <= POI.STRIPPED + 0.02) continue;
    const sc = poiScore(state, t, i);
    if (best < 0 || sc > bs) { best = i; bs = sc; }
  }
  return best;
}

// ---------- what the player knows ----------
let revealAll = false; // the dev tools' Reveal map (ui/devtools.js): every POI shows
/** @param {boolean} on */
export const setPoiReveal = (on) => { revealAll = !!on; };
export const poiRevealed = () => revealAll;
/** The hub's record for a tile: { idx: found hidden POIs, surveyed?: day, looked?: day } or null. @param {State} state @param {number} id */
export function poiKnowledge(state, id, make = false) {
  if (!state.poiKnow) state.poiKnow = {};
  let k = state.poiKnow[id];
  if (!k && make) k = state.poiKnow[id] = { idx: [] };
  return k || null;
}
// What is really known (the dev reveal and the timelapse aside): a survey's finds go by this.
/** @param {State} state @param {Tile} t @param {number} i @param {Party | null} p */
function knownReal(state, t, i, p) {
  const x = poiAt(t, i);
  if (!x) return false;
  if (isSitePoi(t, i)) return siteKnown(state, t.id);
  if (!x.hidden) return true;
  const k = state.poiKnow && state.poiKnow[t.id];
  if (k && k.idx.includes(i)) return true;
  const f = p && p.poiFinds ? p.poiFinds.get(t.id) : null;
  return !!(f && f.idx.includes(i));
}
/** Does the player (the hub's map) know POI i of the tile? @param {State} state @param {Tile | number} tile @param {number} i */
export function poiKnown(state, tile, i) {
  const t = tileOf(state, tile);
  if (!poiAt(t, i)) return false;
  if (revealAll || state.timelapse) return true;
  return knownReal(state, t, i, null);
}
/** Known to the hub or to team p (a team out of radio range knows what it found). @param {State} state @param {Tile | number} tile @param {number} i @param {Party | null} [p] */
export function poiKnownTo(state, tile, i, p = null) {
  const t = tileOf(state, tile);
  if (!poiAt(t, i)) return false;
  if (revealAll || state.timelapse) return true;
  return knownReal(state, t, i, p);
}
/** The indices of the POIs known on a tile. @param {State} state @param {Tile | number} tile @param {Party | null} [p] @returns {number[]} */
export function knownPois(state, tile, p = null) {
  const t = tileOf(state, tile);
  return poisOf(t).map((_, i) => i).filter((i) => poiKnownTo(state, t, i, p));
}
/** Might the tile hold POIs the player has not found ("possibly more unknown")? @param {State} state @param {Tile | number} tile @param {Party | null} [p] */
export function morePoisHidden(state, tile, p = null) {
  const t = tileOf(state, tile);
  return poisOf(t).some((_, i) => !poiKnownTo(state, t, i, p));
}
// A find: into the team's report (merged with the rest of what it saw, mergePoiFinds) or straight into the hub's.
/** @param {State} state @param {Party | null} p @param {number} id */
function findRecord(state, p, id) {
  if (p && p.owner === "player") {
    if (!p.poiFinds) p.poiFinds = new Map();
    let f = p.poiFinds.get(id);
    if (!f) p.poiFinds.set(id, (f = { idx: [] }));
    return f;
  }
  return poiKnowledge(state, id, true);
}
/**
 * A survey's look at the tile: each hidden POI not yet known rolls `chance` (all: every one is found); stamp
 * ("surveyed" or "looked") records the day. Hash dice (the seed, the tile, the hour, the team). Returns the indices
 * found now.
 * @param {State} state @param {Party | null} team @param {Tile | number} tile
 * @param {{ chance?: number, all?: boolean, stamp?: string | null }} [opts] @returns {number[]}
 */
export function revealPois(state, team, tile, { chance = 1, all = false, stamp = null } = {}) {
  const t = tileOf(state, tile);
  if (!t) return [];
  const list = poisOf(t);
  const found = [];
  let rec = null;
  for (let i = 0; i < list.length; i++) {
    if (!list[i].hidden || isSitePoi(t, i) || knownReal(state, t, i, team)) continue;
    if (!all && hash01(state.seed, "poifind", t.id, i, state.hour, team ? localId(state, team.id) : "hub") >= chance) continue;
    rec = rec || findRecord(state, team, t.id);
    rec.idx.push(i);
    found.push(i);
  }
  if (stamp) {
    rec = rec || findRecord(state, team, t.id);
    rec[stamp] = Math.floor(state.hour / 24) + 1;
  }
  return found;
}
/** The hub learns what a report says of a tile (a team's own finds, or a snapshot's known POIs). @param {State} state @param {number} id @param {{ idx?: number[], surveyed?: number, looked?: number, pois?: { i: number }[] }} rec */
export function learnPois(state, id, rec) {
  if (!rec) return;
  const t = state.tiles[id];
  const idx = rec.idx || (rec.pois ? rec.pois.map((x) => x.i) : []);
  let k = poiKnowledge(state, id);
  for (const i of idx) {
    const p = poiAt(t, i);
    if (!p || !p.hidden || isSitePoi(t, i)) continue;
    k = k || poiKnowledge(state, id, true);
    if (!k.idx.includes(i)) k.idx.push(i);
  }
  for (const s of ["surveyed", "looked"]) if (rec[s] != null && (!k || !(k[s] >= rec[s]))) { k = k || poiKnowledge(state, id, true); k[s] = rec[s]; }
}
/** The team's finds reach the hub's map (world.js mergeKnowledge). @param {State} state @param {Party} p */
export function mergePoiFinds(state, p) {
  if (!p || !p.poiFinds || !p.poiFinds.size) return;
  for (const [id, f] of p.poiFinds) learnPois(state, id, f);
  p.poiFinds.clear();
}
/** What a snapshot of the tile carries (world.js snapshot): the POIs the player knows there (with their pools as seen then: the map's and the panel's loot bands) and the stamps. @param {State} state @param {number} id */
export function poiSnapshot(state, id) {
  const t = state.tiles[id];
  const list = poisOf(t);
  if (!list.length) return null;
  const k = poiKnowledge(state, id);
  const pois = [];
  for (let i = 0; i < list.length; i++) if (poiKnown(state, t, i)) pois.push({ i, kind: list[i].kind, pool: poiPool(t, i) });
  return { pois, surveyed: k && k.surveyed != null ? k.surveyed : undefined, looked: k && k.looked != null ? k.looked : undefined };
}
