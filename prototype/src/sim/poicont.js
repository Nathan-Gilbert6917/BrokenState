// @ts-check
// Containers that persist per point of interest (pois.js): the container ledger, poi.cont.
//
// A POI's raid map is built the same way every visit (buildingmaps.js buildingMap: the world seed, the tile and the
// building's option id; a POI's street map from its own dice, combat.js createRaid), so its containers keep their
// ids. What is inside a container is rolled when it is first opened (combat.js searchBox) from dice of its own: a
// hash of the seed, the tile, the POI, the map and the container id (boxRng), never the shared state.rng; the same
// container holds the same things on any visit (the opener's Scavenging still decides how much of it they spot, as
// before, and a shop's food still runs down with the months: foods.js shopFood).
//
// The ledger, made on first use (pois.js poiLedger), plain data saved with the POI (pois.js packPois):
//   poi.cont = { n, looted: { key: by }, mine: { key: { contents, hidden, quick, lock, searched, partial } },
//                maps: { mapId: [container ids in the seeded order] }, took, opened: { mapId: n }, last: { by, day } | null }
//   key      `${mapId}#${containerId}`: mapId "street" or the building's option id (a farm's "farmhouse", a POI's
//            "poi2:house"), so a site with several buildings keeps one ledger.
//   looted   emptied by someone (by: a group's id, "player" for your own headless crews, "gone" for what was missing
//            before anyone you know of came): it spawns empty, open, and marked ransacked.
//   mine     opened by your side in a raid: what was in it when the raid ended (left after taking, put in, swapped),
//            what a quick rummage left hidden, the lock as it was left (picked, forced, unlocked). A revisit shows it.
//   maps     the containers of each map of the POI seen in a raid, in the order they are looted (a hash of the seed,
//            the tile, the POI, the map and the id): the first ones go first, so the set looted only grows.
//   n        how many containers those maps hold; took / opened: the pool your raids took by opening fresh containers,
//            and how many per map (below); last: the latest raid by someone else (the dialogue's "looted by others
//            since your visit").
// Anything not in the ledger is fresh: unopened, with its original things.
//
// The pool and the ledger (pois.js poiPool / poiFull): the pool is the share of the POI's original things still
// untouched. Opening a fresh container in a raid takes its share of the pool (full / its map's containers / the
// POI's maps) and counts in `took` (and `opened` per map). Of a map's containers your raids have not opened fresh,
// round(that many × pool / (full − took)) are kept fresh (syncLedger: the surplus marked looted in the seeded order;
// none once the POI is stripped), so others' raids thin every map alike, your own opening marks nothing elsewhere,
// and the band the dialogue shows (Rich / Some / Little / Picked clean) follows the fresh share. Items you leave in a
// container never raise the pool or the band.
// The pool falls by every writer of it (scavenge.js, aiscav.js, visitors.js, hardcore-*); the containers follow the
// next time a map is built, or at once in lootPoiAbstract when the maps are known.
//
// Abstract looting (lootPoiAbstract): the one way a raid without a map (the player's headless crews and searches,
// and, from Session 4b, AI groups, visitor raiders, hardcore bands and nomads) takes from a POI: the pool falls, the
// containers follow, items you left in opened containers can go too (each opened container is hit at the share of
// the pool the raid took), and the tile's heat rises (pois.js addTileHeat).
//
// The raid (combat.js createRaid → poiRaidStart; scavenge.js afterRaid → poiRaidEnd, on every way a raid ends:
// extracted, retreated, walked out, wiped): at the start the ledger is put on the map; at the end every container
// your side opened is saved as it is, unopened ones are left alone; things on the floor and on bodies are lost.
/** @import { State, Tile } from "./types" */
import { poiAt, poiLedger, poiPool, poiTake, poiFull, poiBand, isSitePoi, addTileHeat, TILE_HEAT } from "./pois.js";
import { siteBuildings } from "./buildingmaps.js";
import { hash01 } from "./skills.js";
import { Rng } from "./rng.js";

export const CONT = {
  FLOOR: 0.03, // the floor a raid leaves under a pool (scavenge.js takePoi's)
};

/** The ledger key of container `id` on map `mapId`. @param {string} mapId @param {number | string} id */
export const contKey = (mapId, id) => `${mapId}#${id}`;
/** The map a raid is on: the building's option id, or "street". @param {any} b */
export const raidMapId = (b) => (b && b.raid && b.raid.interior ? String(b.raid.interior.id) : "street");
/** Does the ledger keep this container (not a body, a pile on the ground, an Army truck: those have rules of their own)? @param {any} c */
export const ledgerBox = (c) => !!c && c.kind !== "body" && c.kind !== "ground" && !c.drop && !c.truck;
/** @param {State} state @param {Tile | number} tile @returns {Tile} */
const tileOf = (state, tile) => (typeof tile === "number" ? state.tiles[tile] : tile);
const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
const day = (state) => Math.floor(state.hour / 24) + 1;

/** The dice a POI container's contents are rolled from (combat.js searchBox): the same for the same container on any visit. @param {State} state @param {number} tileId @param {string} dice the raid's R.poiDice @param {number} id */
export const boxRng = (state, tileId, dice, id) => new Rng(Math.floor(hash01(state.seed, "poibox", tileId, dice, id) * 4294967296));
/** The dice a POI's street map is built from (combat.js createRaid): the same map every visit. @param {State} state @param {number} tileId @param {number} i */
export const poiMapRng = (state, tileId, i) => new Rng(Math.floor(hash01(state.seed, "poimap", tileId, i) * 4294967296));

/** How many maps POI i opens: a site with several buildings has each and its street; any other one. @param {Tile} t @param {number} i */
export function poiMapCount(t, i) {
  if (!isSitePoi(t, i)) return 1;
  const sb = siteBuildings(t);
  return !sb || sb.single ? 1 : sb.options.length + 1;
}

/**
 * Keeps a map's fresh containers in step with the pool: of the containers your raids have not opened fresh there,
 * round(that many × pool / (full − took)) stay fresh (none once the POI is stripped); the surplus is marked looted
 * by `by`, the first in the seeded order first. Returns how many were marked.
 * @param {State} state @param {Tile | number} tile @param {number} i @param {string} mapId @param {string | number} [by]
 */
export function syncLedger(state, tile, i, mapId, by = "gone") {
  const t = tileOf(state, tile), poi = poiAt(t, i);
  const c = poi ? poi.cont : null;
  const ids = c && c.maps ? c.maps[mapId] : null;
  if (!c || !ids) return 0;
  const r = Math.max(0, Math.min(1, poiPool(t, i) / Math.max(0.01, poiFull(t, i) - (c.took || 0))));
  const keep = poi.stripped ? 0 : Math.round((ids.length - ((c.opened && c.opened[mapId]) || 0)) * r);
  const fresh = ids.filter((id) => { const k = contKey(mapId, id); return !(k in c.looted) && !(k in c.mine); });
  let n = 0;
  for (let j = 0; j < fresh.length - keep; j++) { c.looted[contKey(mapId, fresh[j])] = by; n++; }
  return n;
}

/** Things in a saved container (shown and hidden). @param {any} m */
const itemsIn = (m) => {
  if (!m) return 0;
  const n = (c) => (c ? (c.gear || []).length + Object.values(c.sup || {}).filter((v) => v >= 1).length : 0);
  return n(m.contents) + n(m.hidden);
};

/**
 * What the ledger says of POI i (the dialogue's note, tests): { n (containers seen), opened (by you), left (things in
 * them), looted (ransacked containers), others (looted by others since your last visit), othersEver }.
 * @param {State} state @param {Tile | number} tile @param {number} i
 */
export function ledgerSummary(state, tile, i) {
  const t = tileOf(state, tile), poi = poiAt(t, i);
  const c = poi && poi.cont;
  if (!c) return { n: 0, opened: 0, left: 0, looted: 0, others: false, othersEver: false };
  const mine = Object.keys(c.mine || {});
  const left = mine.reduce((a, k) => a + itemsIn(c.mine[k]), 0);
  const looted = Object.keys(c.looted || {}).length;
  const othersEver = !!c.last || Object.values(c.looted || {}).some((by) => by !== "player" && by !== "gone");
  const others = !!(c.last && poi.lastDay != null && c.last.day >= poi.lastDay) || mine.some((k) => c.looted[k] != null && c.looted[k] !== "player");
  return { n: c.n || 0, opened: mine.length, left, looted, others, othersEver };
}

// ---------- the raid on a map ----------
/**
 * A raid on POI setup.raid.poi starts (combat.js createRaid, after its locks): the map's containers are learned (their
 * looting order, once), the fresh ones brought in step with the pool, and the ledger put on the map: looted ones
 * empty, open and ransacked; the ones your side opened as they were left; the rest fresh (b.raid.poiFresh).
 * @param {State} state @param {any} b
 */
export function poiRaidStart(state, b) {
  const R = b && b.raid;
  const i = b && b.setup && b.setup.raid ? b.setup.raid.poi : null;
  if (!R || i == null) return;
  const t = state.tiles[b.tileId];
  if (!poiAt(t, i)) return;
  const c = poiLedger(t, i);
  const mapId = raidMapId(b);
  const boxes = R.containers.filter(ledgerBox);
  if (!c.maps) c.maps = {};
  const order = (ids) => ids.slice().sort((x, y) => hash01(state.seed, "poiorder", t.id, i, mapId, x) - hash01(state.seed, "poiorder", t.id, i, mapId, y) || x - y);
  const known = c.maps[mapId];
  if (!known) c.maps[mapId] = order(boxes.map((x) => x.id));
  else { const extra = boxes.map((x) => x.id).filter((id) => !known.includes(id)); if (extra.length) c.maps[mapId] = [...known, ...order(extra)]; } // a map that grew (never expected): the new ones last
  c.n = Object.values(c.maps).reduce((a, ids) => a + ids.length, 0);
  syncLedger(state, t, i, mapId, c.last ? c.last.by : "gone");
  R.poiFresh = [];
  R.poiMap = mapId;
  for (const box of boxes) {
    const k = contKey(mapId, box.id);
    const m = c.mine[k], by = c.looted[k];
    if (m) {
      box.contents = clone(m.contents) || { sup: {}, gear: [] };
      box.hidden = clone(m.hidden) || null;
      box.quick = !!m.quick;
      if (m.lock) box.lock = clone(m.lock);
      box.searched = !!m.searched; box.partial = !!m.partial;
      box.mine = true;
    }
    if (by != null) {
      if (!m) { box.contents = { sup: {}, gear: [] }; box.hidden = null; box.quick = false; box.searched = true; box.partial = false; }
      if (box.lock) box.lock = { ...box.lock, open: true };
      box.ransacked = by;
      if (!/\(ransacked\)$/.test(box.label || "")) box.label = `${box.label} (ransacked)`;
    } else if (!m) R.poiFresh.push(box.id);
  }
}

/**
 * The raid on POI setup.raid.poi is over, however it ended (scavenge.js afterRaid, from combat.js finishCombat with the
 * map it was played on): every container your side opened is saved as it is now (what is left, what was put in, the
 * hidden rest of a rummage, the lock); a fresh one opened now takes its share of the pool. Unopened ones are left
 * alone; the floor and the bodies are not kept. Returns how many fresh containers were opened.
 * @param {State} state @param {any} b
 */
export function poiRaidEnd(state, b) {
  const R = b && b.raid;
  const i = b && b.setup && b.setup.raid ? b.setup.raid.poi : null;
  if (!R || i == null || !R.poiMap || R.poiSaved) return 0;
  const t = state.tiles[b.tileId];
  if (!poiAt(t, i)) return 0;
  R.poiSaved = true;
  const c = poiLedger(t, i);
  const mapId = R.poiMap;
  const fresh = new Set(R.poiFresh || []);
  let opened = 0;
  for (const box of R.containers.filter(ledgerBox)) {
    if (!box.contents) continue; // never opened: untouched
    if (fresh.has(box.id)) opened++;
    c.mine[contKey(mapId, box.id)] = {
      contents: clone(box.contents), hidden: clone(box.hidden) || null, quick: !!box.quick, lock: box.lock ? clone(box.lock) : null, searched: !!box.searched, partial: !!box.partial,
    };
  }
  if (opened) {
    const ids = (c.maps && c.maps[mapId]) || [];
    const per = poiFull(t, i) / Math.max(1, ids.length) / poiMapCount(t, i);
    const took = poiTake(t, i, Math.max(0, Math.min(per * opened, poiPool(t, i) - CONT.FLOOR)));
    c.took = (c.took || 0) + took;
    if (!c.opened) c.opened = {};
    c.opened[mapId] = (c.opened[mapId] || 0) + opened;
  }
  return opened;
}

// ---------- abstract looting ----------
/**
 * A raid without a map takes from POI i: `need` of its pool (pool units, 0–1; less when less is left, never below
 * opts.floor), the containers follow (syncLedger on every map known, marked looted by `who`), each container your
 * side opened that still holds things is emptied at the share of the pool taken (hash dice: the seed, the tile, the
 * POI, the container, the hour, who), and the tile's heat rises (opts.heat, TILE_HEAT.AI for others, none for the
 * player's own crews: their search adds its own). Items your side left count like any other loot: at risk.
 * who: a group's id (number or string), "player" (your own crews' searches), or an object with an id.
 * opts: { floor = 0, heat, left = true (false: leave opened containers alone), hours (for heat: × max(1, hours / 4)) }.
 * Returns { took (pool taken), left: { sup, gear } (things taken from your opened containers), boxes (how many of
 * those were emptied), marked (containers marked looted now), pool (after), stripped } or null without the POI.
 * @param {State} state @param {any} who @param {Tile | number} tile @param {number} i @param {number} need
 * @param {{ floor?: number, heat?: number, left?: boolean, hours?: number }} [opts]
 */
export function lootPoiAbstract(state, who, tile, i, need, opts = {}) {
  const t = tileOf(state, tile), poi = poiAt(t, i);
  if (!poi) return null;
  const by = who != null && typeof who === "object" ? who.id : who == null ? "gone" : who;
  const before = poiPool(t, i);
  const took = poiTake(t, i, Math.max(0, Math.min(need || 0, before - (opts.floor || 0))));
  const share = before > 0 ? Math.min(1, took / before) : 0;
  // The ledger: made for another group's raid (who took it last); your own crews' searches only use one already there.
  const c = poi.cont || (by !== "player" && took > 0 ? poiLedger(t, i) : { n: 0, looted: {}, mine: {} });
  const left = { sup: /** @type {Record<string, number>} */ ({}), gear: /** @type {any[]} */ ([]) };
  let boxes = 0;
  if (opts.left !== false && share > 0) {
    for (const k of Object.keys(c.mine)) {
      const m = c.mine[k];
      if (!itemsIn(m) || hash01(state.seed, "poileft", t.id, i, k, state.hour, by) >= share) continue;
      for (const part of [m.contents, m.hidden]) {
        if (!part) continue;
        for (const [s, q] of Object.entries(part.sup || {})) if (q > 0) left.sup[s] = (left.sup[s] || 0) + q;
        left.gear.push(...(part.gear || []));
      }
      m.contents = { sup: {}, gear: [] };
      m.hidden = null; m.quick = false; m.searched = true; m.partial = false;
      if (by !== "player") c.looted[k] = by;
      boxes++;
    }
  }
  if (by !== "player" && took > 0) c.last = { by, day: day(state) };
  let marked = 0;
  for (const mapId of Object.keys(c.maps || {})) marked += syncLedger(state, t, i, mapId, by);
  const heat = opts.heat != null ? opts.heat : by === "player" ? 0 : TILE_HEAT.AI;
  if (heat > 0 && (took > 0 || boxes)) addTileHeat(state, t, heat * Math.max(1, (opts.hours || 0) / 4));
  return { took, left, boxes, marked, pool: poiPool(t, i), stripped: !!poi.stripped };
}
