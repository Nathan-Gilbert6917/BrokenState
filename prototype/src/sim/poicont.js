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
//                maps: { mapId: [container ids in the seeded order] }, took, opened: { mapId: n }, last: { by, day } | null,
//                scenes: { mapId: [{ f, x, y, cell }] } (interiorscenes.js: a scene's pieces as your side left them),
//                pieces: { mapId: [{ f, x, y, cell }] } (furnihome.js: the cells pieces of furniture were lifted off or set
//                on, a piece dropped at the door from exhaustion among them) }
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
// A neighbourhood's street of houses (buildingmaps.js streetMap) is one map: every house's containers have ids of
// their own on it (c.house says whose), so the ledger keeps each house apart (a house nobody opened stays fresh) and
// the one pool falls by each container's share across the whole street (poiHouses: how many houses).
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
// the pool the raid went through, all of them when it wanted more than was left), and the tile's heat rises (pois.js
// addTileHeat).
//
// The raid (combat.js createRaid → poiRaidStart; scavenge.js afterRaid → poiRaidEnd, on every way a raid ends:
// extracted, retreated, walked out, wiped): at the start the ledger is put on the map; at the end every container
// your side opened is saved as it is, unopened ones are left alone; things on the floor and on bodies are lost.
/** @import { State, Tile } from "./types" */
import { poiAt, poiLedger, poiPool, poiTake, poiFull, poiBand, isSitePoi, addTileHeat, TILE_HEAT } from "./pois.js";
import { siteBuildings, SITES, BUILDINGS, streetHouses } from "./buildingmaps.js";
import { mallUnits } from "./mall.js"; // a mall's buildings (issue #30)
import { campusBuildings } from "./campus.js"; // a college campus's buildings (issue #28)
import { farmBuildingCount } from "./farmstead.js"; // a farm's or a ranch's buildings, each apart in the ledger (issue #62)
import { legacyFarms } from "./worldcfg.js"; // an older save's farms keep their buildings (issue #62)
import { hash01 } from "./skills.js";
import { Rng } from "./rng.js";
import { localId } from "./world.js"; // dice keyed by a group's world-local id (two worlds in one process roll the same)
import { supWeight } from "./data.js";
import { itemLoad } from "./inventory.js"; // what a raider can carry off (opts.room): a pack counts what is in it
import { sceneLedger, applySceneLedger } from "./interiorscenes.js"; // a scene's pieces as they were left (a smashed one stays smashed)
import { pieceLedger, applyPieceLedger, mergePieceLedger } from "./furnihome.js"; // furniture lifted and set down (issue #18: a piece left at the door is there next time)

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

/**
 * How many buildings POI i's one map holds: a neighbourhood's street of houses (buildingmaps.js streetMap, its place
 * id as poiraid.js poiPlace makes it: "poi<i>:<key>"), a university's or a college's campus (campus.js), else 1. The headless search goes through one at a time
 * (scavenge.js: its pool falls this many times slower).
 * @param {State} state @param {Tile | number} tile @param {number} i
 */
export function poiHouses(state, tile, i) {
  const t = tileOf(state, tile), poi = poiAt(t, i);
  if (!poi) return 1;
  // A shopping mall (mall.js) or a campus (campus.js): the site's one map of many buildings, each apart in the ledger;
  // a strip mall's or an outlet's POI likewise (below): the search goes through them a building at a time.
  if (isSitePoi(t, i)) { const sb = siteBuildings(t, farmsOld(state)); const o = sb && sb.single ? sb.options[0] : null; return o && BUILDINGS[o.key] && BUILDINGS[o.key].compound ? mallHouses(state, t.id, o) : o && BUILDINGS[o.key] && BUILDINGS[o.key].campus ? campusBuildings(state, t, o) : o && BUILDINGS[o.key] && BUILDINGS[o.key].farmstead ? farmBuildingCount(state, t, o) : 1; } // farmstead.js: a farm's or a ranch's buildings (issue #62)
  const entry = SITES[poi.kind], first = entry ? (Array.isArray(entry) ? entry : entry.list)[0] : null;
  const key = Array.isArray(first) ? first[0] : first;
  if (key && BUILDINGS[key] && BUILDINGS[key].compound) return mallHouses(state, t.id, { id: `poi${i}:${key}`, key, name: BUILDINGS[key].name });
  return key && BUILDINGS[key] && BUILDINGS[key].street ? streetHouses(state, t.id, { id: `poi${i}:${key}`, key, ...(poi.lay ? { layout: poi.lay } : {}) }) : 1;
}
// An older save's farm or ranch (worldcfg.js legacyFarms, issue #62) is still its pick of buildings: siteBuildings is
// told so (nothing else of the state, so every other site reads as it always did here).
const farmsOld = (state) => (legacyFarms(state) ? { farmLegacy: true } : null);
// A mall's buildings, counted once per map (the map is made from the mall's own dice; cached by the seed and the place).
const mallCount = new Map();
function mallHouses(state, tileId, option) {
  const k = `${state.seed}:${tileId}:${option.id}`;
  if (!mallCount.has(k)) { if (mallCount.size > 1024) mallCount.clear(); mallCount.set(k, mallUnits(state, tileId, option)); }
  return mallCount.get(k);
}

/** How many maps POI i opens: a site with several buildings has each and its street; any other one. @param {Tile} t @param {number} i */
export function poiMapCount(t, i, state = null) {
  if (!isSitePoi(t, i)) return 1;
  const sb = siteBuildings(t, farmsOld(state));
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
  if (c.scenes && c.scenes[mapId]) applySceneLedger(b, c.scenes[mapId]); // interiorscenes.js: the scenes' pieces as your side left them
  if (c.pieces && c.pieces[mapId]) { applyPieceLedger(b, c.pieces[mapId]); R.pieceCells = c.pieces[mapId].map((o) => `${o.f},${o.x},${o.y}`); } // furnihome.js: the furniture lifted and set down as your side left it (kept again at the end)
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
      if (m.at) { box.x = m.at.x; box.y = m.at.y; box.f = m.at.f; delete box.w; delete box.h; if (m.at.w) { box.w = m.at.w; box.h = m.at.h; } box.shifted = true; } // furnicarry.js: set down elsewhere with its piece
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
  const sc = sceneLedger(b); // interiorscenes.js: the scenes' pieces smashed, shoved or torn down
  if (sc && sc.length) { if (!c.scenes) c.scenes = {}; c.scenes[mapId] = sc; }
  const pc = pieceLedger(b); // furnihome.js: the cells pieces of furniture left or were set on
  if (pc.length) { if (!c.pieces) c.pieces = {}; c.pieces[mapId] = mergePieceLedger(c.pieces[mapId], pc); }
  for (const box of R.containers.filter(ledgerBox)) {
    if (!box.contents) continue; // never opened: untouched
    if (box.ransacked && !box.mine && !itemsIn(box)) continue; // spawned ransacked and still empty: nothing of yours there
    if (fresh.has(box.id)) opened++;
    c.mine[contKey(mapId, box.id)] = {
      contents: clone(box.contents), hidden: clone(box.hidden) || null, quick: !!box.quick, lock: box.lock ? clone(box.lock) : null, searched: !!box.searched, partial: !!box.partial,
      ...(box.shifted ? { at: { x: box.x, y: box.y, f: box.f || 0, ...(box.w ? { w: box.w, h: box.h } : {}) } } : {}), // furnicarry.js: moved with its piece
    };
  }
  if (opened) {
    const ids = (c.maps && c.maps[mapId]) || [];
    const per = poiFull(t, i) / Math.max(1, ids.length) / poiMapCount(t, i, state);
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
 * side opened that still holds things is emptied at the share of the pool they went through (need / pool, all of it
 * when they wanted more than is left; hash dice: the seed, the tile, the POI, the container, the hour, who), and the
 * tile's heat rises (opts.heat, TILE_HEAT.AI for others, none for the
 * player's own crews: their search adds its own). Items your side left count like any other loot: at risk.
 * who: a group's id (number or string), "player" (your own crews' searches), or an object with an id.
 * opts: { floor = 0, heat, left = true (false: leave opened containers alone), hours (for heat: × max(1, hours / 4)),
 * room (kg they can carry off from those containers; what does not fit stays in them: unlimited by default) }.
 * Returns { took (pool taken), left: { sup, gear } (things taken from your opened containers), boxes (how many of
 * those were gone through), marked (containers marked looted now), pool (after), stripped } or null without the POI.
 * @param {State} state @param {any} who @param {Tile | number} tile @param {number} i @param {number} need
 * @param {{ floor?: number, heat?: number, left?: boolean, hours?: number, room?: number }} [opts]
 */
export function lootPoiAbstract(state, who, tile, i, need, opts = {}) {
  const t = tileOf(state, tile), poi = poiAt(t, i);
  if (!poi) return null;
  const by = who != null && typeof who === "object" ? who.id : who == null ? "gone" : who;
  const before = poiPool(t, i);
  const took = poiTake(t, i, Math.max(0, Math.min(need || 0, before - (opts.floor || 0))));
  const share = need > 0 ? Math.min(1, need / Math.max(need, before)) : 0; // what they go through: a stripped place's leftovers all of it
  // The ledger: made for another group's raid (who took it last); your own crews' searches only use one already there.
  const c = poi.cont || (by !== "player" && took > 0 ? poiLedger(t, i) : { n: 0, looted: {}, mine: {} });
  const left = { sup: /** @type {Record<string, number>} */ ({}), gear: /** @type {any[]} */ ([]) };
  let boxes = 0, room = opts.room != null ? Math.max(0, opts.room) : Infinity;
  if (opts.left !== false && share > 0) {
    for (const k of Object.keys(c.mine)) {
      const m = c.mine[k];
      if (!itemsIn(m) || hash01(state.seed, "poileft", t.id, i, k, state.hour, localId(state, by)) >= share) continue;
      // opts.room: the kg they can still carry (nomads.js bandRoom, your teams' rule). What does not fit stays in
      // the container, as a team of yours leaves behind what it cannot carry (parties.js addGearToCargo).
      const stays = { sup: /** @type {Record<string, number>} */ ({}), gear: /** @type {any[]} */ ([]) };
      for (const part of [m.contents, m.hidden]) {
        if (!part) continue;
        for (const [s, q] of Object.entries(part.sup || {})) {
          if (!(q > 0)) continue;
          const w = supWeight(s), n = w > 0 && room < Infinity ? Math.min(q, Math.max(0, Math.floor((room + 1e-9) / w))) : q;
          if (n > 0) { left.sup[s] = (left.sup[s] || 0) + n; room -= n * w; }
          if (q - n > 0) stays.sup[s] = (stays.sup[s] || 0) + q - n;
        }
        for (const it of part.gear || []) {
          const kg = itemLoad(it);
          if (kg <= room + 1e-9) { left.gear.push(it); room -= kg; } else stays.gear.push(it);
        }
      }
      m.contents = stays;
      m.hidden = null; m.quick = false; m.searched = true; m.partial = false;
      if (by !== "player") c.looted[k] = by;
      boxes++;
    }
  }
  if (by !== "player" && (took > 0 || boxes)) c.last = { by, day: day(state) };
  let marked = 0;
  for (const mapId of Object.keys(c.maps || {})) marked += syncLedger(state, t, i, mapId, by);
  const heat = opts.heat != null ? opts.heat : by === "player" ? 0 : TILE_HEAT.AI;
  if (heat > 0 && (took > 0 || boxes)) addTileHeat(state, t, heat * Math.max(1, (opts.hours || 0) / 4));
  return { took, left, boxes, marked, pool: poiPool(t, i), stripped: !!poi.stripped };
}
