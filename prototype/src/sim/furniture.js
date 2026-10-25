// @ts-check
// Furniture at the base (#20, 2026-10-25; the user's request: "I want all reasonable appliances, furniture and some
// decor to be lootable and taken to your base for use, like [...] shelves, crates etc for storage"). The machinery
// beds.js had for its cots and beds (2026-10-20), made general: any item whose GEAR row names a piece of furniture
// (GEAR[key].furniture) is set from the stores onto a general building's floor and picked up again the same way. The
// beds keep their own rules in beds.js (who sleeps where, rough sleeping, the governor's beds, the groups' halls),
// which re-exports what is here so nothing that imported it changed. The numbers are data-beds.js (the beds) and
// data-basefurniture.js (the storage, comfort and work pieces: FURNITURE_KINDS, until #8's catalogue holds them).
//
// THE PIECE. An item while it is in the stores (the base's armory) or on the move; a placed thing once it is SET
// inside a general building (a hut, cabin, lodge, hall or barn): a record in base.buildings of its own type (the item's
// key: "bed", "f_shelf"; BUILDINGS fit + furniture) keeping the item it was (rec.item: its condition comes back with
// it). Set from the base map (the Build list's Furniture group: basemap.js layoutAct build -> setFurnitureAt, turned
// by R) or with no spot (the Construction road, the governor: buildings.js queueBuild -> setFurniture; the auto layout
// puts it on the first free floor with room). Demolish picks it up (pickUpFurniture: back in the stores, whole); a
// building pulled down has its furniture carried out first (buildings.js demolish).
//
// WHAT IT DOES (useOf: the catalogue row's `use`, or a bed's sleepers):
//   storage:<kg>   BUILDINGS storeKg: basestorage.js storageOf counts it as a building container (the Overview's
//                  Storage row, the camp's Stores card), the Storage tab lists it as one to assign to (containers.js:
//                  its own preferences, data-basefurniture.js FURN_STORE: a wardrobe takes clothing first, a gun rack
//                  guns and nothing else), and on a base's battle map it is a store raiders search (basemap.js STORES).
//   comfort:<mood> a day's mood for the people sleeping in the building it stands in (comfortLine, relations.js
//                  moodFactors): one line "Comforts: sofa, rug (+0.6)" (COMFORT: a piece serves SEATS sleepers, decor
//                  at most DECOR_MAX a building, a person's line at most MAX).
//   work:craftbench a crafting bench (crafting.js hasBench: a found workbench is the crafting bench's station).
//   work:desk      decor (no planner, radio or intel job is done at a desk yet).
//   none           nothing at the base (a school desk; a server rack's worth is its salvage: 3 electronics).
//
// THE GOVERNOR (governFurniture, autopilot.js governBase, the morning's plan before the day's builds): the storage
// pieces in the stores set first, the biggest first (so the governor's storage wish, autopilot.js storageWish, counts
// them before it queues crates or a shed); a found workbench where the base has no bench; then the comfort pieces
// that would count (governComfort: one seat piece a SEATS people, decor while a building's decor is under DECOR_MAX).
// Pieces that do nothing (a TV stand, a pew, a school desk, a server rack) stay in the stores for the player.
//
// AI GROUPS (docs/adr/0001-ai-parity.md; groupFurnitureDaily, groupworks.js groupWorksDaily): the pieces they bring
// home lie in their main base's armory, as yours in yours; each day they set what has floor in their hall (the Lodge
// beds.js has them build), storage first, the biggest first: the piece becomes a count of their works
// (f.works[tile][f_<kind>]) and so a building of their base (groupbases.js WORKS_BUILDING), and their storage
// (groupworks.js groupStorage, storageWork's ladder) counts its room as yours does.
import { BED_SPEC } from "./data-beds.js";
import { FURNITURE_KINDS, FURN_STORE, COMFORT, DECOR, DECOR_MOOD } from "./data-basefurniture.js";
import { GEAR } from "./data.js";
import { BUILDINGS, addBuilding, baseBeds } from "./buildings.js"; // (call-time only: the modules load in a circle)
import { FOOT, fittingRoom, placeItem, refreshBaseMap, fittingsIn } from "./basemap.js"; // (call-time only)
import { makeItem } from "./crafting.js"; // (call-time only)
import { bedAssignments } from "./beds.js"; // (call-time only) who sleeps where: the comfort's sleepers
import { residents } from "./world.js";
import { isPaper } from "./itemcond.js"; // (call-time only) a bookshelf with books
import { groupsBuild } from "./groupworks.js"; // (call-time only)
import { homesOf, syncBuildings } from "./groupbases.js"; // (call-time only)
import { BEDS_AI } from "./data-beds.js";

const HOSTS = "a hut, cabin, lodge, hall or barn";
const nameOf = (type) => (BED_SPEC[type] ? BED_SPEC[type].name : BUILDINGS[type] ? BUILDINGS[type].name : GEAR[type] ? GEAR[type].name : type);
const lower = (type) => nameOf(type).toLowerCase();
const bedsWord = (n) => `${n} bed${n === 1 ? "" : "s"}`;
const r2 = (v) => Math.round(v * 100) / 100;
/** The catalogue kind a placed type or item key stands for ("f_shelf" -> "shelf"; a bed: its own type). @param {string} type */
export const kindOf = (type) => (GEAR[type] && GEAR[type].furniture) || null;
/** A piece of furniture: a bed or a catalogue piece. @param {string} type */
export const isFurniture = (type) => !!BED_SPEC[type] || !!(BUILDINGS[type] && BUILDINGS[type].furniture && FURNITURE_KINDS[kindOf(type) || ""]);
/**
 * What a piece does at the base: { storage: kg, comfort: mood, work: station, sleepers } (0 / "" when not).
 * @param {string} type
 */
export function useOf(type) {
  const out = { storage: 0, comfort: 0, work: "", sleepers: BED_SPEC[type] ? BED_SPEC[type].sleepers : 0 };
  const row = FURNITURE_KINDS[kindOf(type) || ""];
  const use = row ? row.use : "";
  if (use.startsWith("storage:")) out.storage = Number(use.slice(8)) || 0;
  else if (use.startsWith("comfort:")) out.comfort = Number(use.slice(8)) || 0;
  else if (use.startsWith("work:")) out.work = use.slice(5);
  return out;
}
/** Its footprint on the floor: [w, h]. @param {string} type */
export const pieceSize = (type) => (FOOT[type] ? [FOOT[type].w, FOOT[type].h] : [1, 1]);
/** Decor (data-basefurniture.js DECOR): adds to a building's decor, at most COMFORT.DECOR_MAX. @param {string} type */
export const isDecor = (type) => DECOR.has(kindOf(type) || "");
// What it does, in words ("+150 kg of storage", "+0.5 mood for the building's sleepers").
export function effectText(type) {
  const u = useOf(type);
  if (u.sleepers) return `+${bedsWord(u.sleepers)}`;
  if (u.storage) { const S = FURN_STORE[kindOf(type) || ""] || {}; return `+${u.storage} kg of storage${S.only ? ` (${S.only} only${S.max ? `, ${S.max} at most` : ""})` : S.first ? ` (${S.first} first)` : ""}`; }
  if (u.work === "craftbench") return "a crafting bench for the crafters";
  if (isDecor(type)) return `decor: +${DECOR_MOOD} mood for the building's sleepers (decor at most +${COMFORT.DECOR_MAX} a building)`;
  if (u.comfort) return `+${u.comfort} mood for the building's sleepers (one for every ${COMFORT.SEATS})`;
  return "nothing at the base but its looks";
}

// ---------- the furniture a base has ----------
/** Pieces of this kind in a base's stores (its armory). @param {any} base @param {string} type */
export const furnitureInStores = (base, type) => ((base && base.armory) || []).filter((it) => it && it.key === type).length;
/** The furniture set at a base, by kind: { cot: 2, f_shelf: 1 }. @param {any} base */
export function furnitureSet(base) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const b of (base && base.buildings) || []) if (isFurniture(b.type)) out[b.type] = (out[b.type] || 0) + 1;
  return out;
}

// ---------- setting a piece and picking it up ----------
// Why it cannot be set at this base now ("" when it can): a general building standing with free floor for it.
/** @param {any} base @param {string} type */
export function furnitureProblem(base, type) {
  if (!isFurniture(type)) return "Not a piece of furniture";
  if (fittingRoom(null, base, type)) return "";
  const [w, h] = pieceSize(type);
  return `Needs a building to stand in with ${w} × ${h} of free floor (${w > 1 && h > 1 ? "a lodge, hall or barn: a hut's or a cabin's floor has no room for it" : HOSTS})`;
}
// buildings.js canBuild for a piece of furniture: one in the stores, and a building with room for it.
/** @returns {{ ok: boolean, reason?: string, short?: boolean }} */
export function canSetFurniture(state, base, type) {
  if (!isFurniture(type)) return { ok: false, reason: "Not a piece of furniture" };
  if (!furnitureInStores(base, type)) return { ok: false, short: true, reason: BED_SPEC[type] ? `No ${lower(type)} in the stores: craft one at the bench (Crafting) or bring one home` : `No ${lower(type)} in the stores: find one and bring it home` };
  const where = furnitureProblem(base, type);
  if (where) return { ok: false, reason: where };
  return { ok: true };
}
// Take one from the stores and set it: at = [x, y, r] on the map (placed by hand), else the game places it. The best
// kept one first. Returns { rec, key, msg } or { err }.
export function setFurniture(state, base, type, at = null) {
  const chk = canSetFurniture(state, base, type);
  if (!chk.ok) return { err: chk.reason || "It cannot be set here now." };
  const list = base.armory.map((it, i) => [it, i]).filter(([it]) => it && it.key === type).sort(([a], [b]) => (b.quality || 0) - (a.quality || 0));
  const [item, idx] = list[0];
  base.armory.splice(idx, 1);
  delete item.store; // containers.js: an assignment to a container goes with it out of the stores
  const rec = addBuilding(base, type);
  rec.item = item;
  const key = `b:${rec.id}`;
  if (at) {
    const err = placeItem(state, base, key, at[0], at[1], at[2] || 0);
    if (err) { base.buildings.splice(base.buildings.indexOf(rec), 1); base.armory.splice(idx, 0, item); return { err }; }
  }
  const where = at ? "there" : "inside a building with room (placed by the game)";
  const u = useOf(type);
  return { rec, key, msg: u.sleepers ? `${nameOf(type)} set ${where}: +${bedsWord(u.sleepers)} at ${base.name} (${baseBeds(base)} in all).` : `${nameOf(type)} set ${where} at ${base.name}: ${effectText(type)}.` };
}
// The base map's Build on a piece of furniture (basemap.js layoutAct build): set where the ghost is. Returns an error or "".
export function setFurnitureAt(state, b, base, type, g) {
  const L = b.layout;
  const r = setFurniture(state, base, type, g.at);
  if (r.err) return r.err;
  L.msg = r.msg;
  L.sel = r.key;
  if (!furnitureInStores(base, type)) L.pickType = null; // none left to set
  refreshBaseMap(state);
  return "";
}
// Demolish on a set piece (buildings.js demolish), or its building pulled down: back into the stores, whole. What was
// assigned to a storage piece (containers.js) is in no container from then on (normalizeBins drops the stale key).
export function pickUpFurniture(state, base, rec) {
  const i = base.buildings.indexOf(rec);
  if (i >= 0) base.buildings.splice(i, 1);
  const item = rec.item && typeof rec.item === "object" ? rec.item : makeItem(rec.type, 0.8);
  base.armory.push(item);
  const u = useOf(rec.type);
  return u.sleepers || BED_SPEC[rec.type] ? `${nameOf(rec.type)} picked up and put back in the stores (−${bedsWord(u.sleepers)}: ${baseBeds(base)} at ${base.name}).` : `${nameOf(rec.type)} picked up and put back in the stores at ${base.name}.`;
}

// ---------- comfort ----------
// The general building each set piece stands in (basemap.js fittingsIn: placed by hand or by the auto layout):
// Map(piece record id -> its building's id). Kept for the hour while the base's buildings are the same (the morning's
// mood reads it once a person).
/** @type {WeakMap<any, { key: string, map: Map<number, number> }>} */
const HOSTS_MEMO = new WeakMap();
function hostsOf(state, base) {
  const bs = base.buildings || [];
  const key = `${state.hour}|${bs.length}|${bs.map((b) => b.id).join(",")}`;
  const m = HOSTS_MEMO.get(base);
  if (m && m.key === key) return m.map;
  const map = new Map();
  for (const b of bs) {
    if (!FOOT[b.type] || !FOOT[b.type].general || b.broken) continue;
    for (const o of fittingsIn(state, base, b.id)) if (o.rec && isFurniture(o.rec.type)) map.set(o.rec.id, b.id);
  }
  HOSTS_MEMO.set(base, { key, map });
  return map;
}
// A bookshelf counts as comfort (COMFORT.books) with a book or a manual kept in it (containers.js item.store).
const hasBooks = (base, rec) => (base.armory || []).some((it) => it && it.store === `b:${rec.id}` && isPaper(it.key));
/**
 * The comfort of one building's pieces for its sleepers: { v, names } (v before COMFORT.MAX). pieces: the set records
 * standing in it; sleepers: how many sleep there.
 * @param {any} base @param {any[]} pieces @param {number} sleepers
 */
export function comfortOf(base, pieces, sleepers) {
  if (!(sleepers > 0)) return { v: 0, names: [] };
  const seats = Math.ceil(sleepers / COMFORT.SEATS);
  /** @type {Map<string, { n: number, mood: number, name: string }>} */
  const by = new Map();
  let decor = 0;
  const names = [];
  for (const rec of pieces) {
    if (rec.broken) continue;
    const k = kindOf(rec.type);
    const mood = isDecor(rec.type) ? DECOR_MOOD : k === "bookshelf" && hasBooks(base, rec) ? COMFORT.books : useOf(rec.type).comfort;
    if (!(mood > 0)) continue;
    const nm = lower(rec.type);
    if (!names.includes(nm)) names.push(nm);
    if (isDecor(rec.type)) { decor += mood; continue; }
    const e = by.get(rec.type) || { n: 0, mood, name: nm };
    e.n++;
    by.set(rec.type, e);
  }
  let v = Math.min(COMFORT.DECOR_MAX, decor);
  for (const e of by.values()) v += (e.mood * Math.min(e.n, seats)) / seats; // a piece serves SEATS sleepers: their share
  return { v: r2(v), names };
}
// The mood line for the comfort where someone sleeps tonight (relations.js moodFactors, applied there each morning), or
// null: the comfort pieces standing in the building their bed stands in (a piece the map has no building for counts
// with the beds that have none either), shared among the building's sleepers (comfortOf), at most COMFORT.MAX.
export function comfortLine(state, s, base) {
  if (!base || !s || !(base.buildings || []).some((b) => !BED_SPEC[b.type] && isFurniture(b.type) && useOf(b.type).comfort + (isDecor(b.type) ? 1 : 0) + (kindOf(b.type) === "bookshelf" ? 1 : 0) > 0)) return null;
  const a = bedAssignments(state, base);
  const slot = a.get(s.id);
  if (!slot || slot.bid == null) return null; // a plain bed, a bunkhouse's bunk, a tent, sleeping rough: in no building with furniture
  const hosts = hostsOf(state, base);
  const host = hosts.has(slot.bid) ? hosts.get(slot.bid) : null;
  let sleepers = 0;
  for (const sl of a.values()) if (sl && sl.bid != null && (hosts.has(sl.bid) ? hosts.get(sl.bid) : null) === host) sleepers++;
  const pieces = (base.buildings || []).filter((b) => !BED_SPEC[b.type] && isFurniture(b.type) && (hosts.has(b.id) ? hosts.get(b.id) : null) === host);
  const c = comfortOf(base, pieces, sleepers);
  if (!(c.v > 0)) return null;
  const v = Math.min(COMFORT.MAX, c.v);
  return { label: `Comforts: ${c.names.join(", ")}`, v, tip: `The furniture in the building they sleep in: a sofa, an armchair, a piano or a dining table serves ${COMFORT.SEATS} sleepers (fewer pieces: a share each), decor adds up to +${COMFORT.DECOR_MAX} a building, +${COMFORT.MAX} at most` };
}

// ---------- the governor ----------
// The morning's plan at a base the governor runs (autopilot.js governBase, after governBeds): the storage pieces in
// the stores set, the biggest first; a found workbench while the base has no bench; the comfort pieces that count
// (governComfort). Returns the lines to say.
export function governFurniture(state, base) {
  const out = [];
  const stored = [...new Set((base.armory || []).filter((it) => it && isFurniture(it.key) && !BED_SPEC[it.key]).map((it) => it.key))];
  const storage = stored.filter((t) => useOf(t).storage > 0).sort((a, b) => useOf(b).storage - useOf(a).storage || (a < b ? -1 : 1));
  for (const type of storage) out.push(...setAll(state, base, type, Infinity));
  for (const type of stored.filter((t) => useOf(t).work === "craftbench")) if (!(base.buildings || []).some((b) => useOf(b.type).work === "craftbench")) out.push(...setAll(state, base, type, 1));
  out.push(...governComfort(state, base, stored));
  return out;
}
// The biggest storage piece in the stores that can be set now (autopilot.js storageWish: before any storage is built),
// or null.
export function storedStorage(state, base) {
  const keys = [...new Set((base.armory || []).filter((it) => it && isFurniture(it.key) && useOf(it.key).storage > 0).map((it) => it.key))].sort((a, b) => useOf(b).storage - useOf(a).storage || (a < b ? -1 : 1));
  return keys.find((t) => canSetFurniture(state, base, t).ok) || null;
}
function setAll(state, base, type, most) {
  const out = [];
  for (let n = 0; n < most && furnitureInStores(base, type) && canSetFurniture(state, base, type).ok; n++) {
    const r = setFurniture(state, base, type);
    if (r.err) break;
    out.push(r.msg);
  }
  return out;
}
// The comfort pieces worth setting: a seat piece (a sofa, an armchair, a piano, a dining table) while the base has
// fewer of that kind set than one for every COMFORT.SEATS people living there; decor while the base's decor is under
// COMFORT.DECOR_MAX for each general building standing. The best first.
export function governComfort(state, base, stored = null) {
  const out = [];
  const keys = stored || [...new Set((base.armory || []).filter((it) => it && isFurniture(it.key) && !BED_SPEC[it.key]).map((it) => it.key))];
  const people = residents(state, base.id).length;
  if (!people) return out;
  const set = furnitureSet(base);
  const seats = keys.filter((t) => !isDecor(t) && useOf(t).comfort > 0).sort((a, b) => useOf(b).comfort - useOf(a).comfort || (a < b ? -1 : 1));
  for (const type of seats) out.push(...setAll(state, base, type, Math.ceil(people / COMFORT.SEATS) - (set[type] || 0)));
  const halls = (base.buildings || []).filter((b) => FOOT[b.type] && FOOT[b.type].general && !b.broken).length;
  const decorSet = () => Object.entries(furnitureSet(base)).reduce((a, [t, n]) => a + (isDecor(t) ? n : 0), 0);
  for (const type of keys.filter(isDecor)) out.push(...setAll(state, base, type, Math.floor((halls * COMFORT.DECOR_MAX) / DECOR_MOOD + 1e-9) - decorSet()));
  return out;
}

// ---------- AI groups (see the header) ----------
const nW = (w, k) => (w && w[k]) || 0;
/** The floor cells a base's furniture takes (its works: the beds and the pieces). @param {any} w */
export const furnCells = (w) => Object.keys(w || {}).reduce((a, k) => a + (isFurniture(k) ? nW(w, k) * pieceSize(k)[0] * pieceSize(k)[1] : 0), 0);
// A day's pieces for one group: at their main base (their armory's), what lies in its armory set while their hall has
// floor for it (BEDS_AI.room cells a hall, beds.js; your rule: basemap.js fittingRoom on their base as a base object),
// storage first and the biggest first, then the rest your governor would set. Returns the types set.
export function groupFurnitureDaily(state, f) {
  if (!groupsBuild(state, f) || !f.bases || !f.bases.length) return [];
  const tile = f.bases[0];
  const w = f.works && f.works[tile];
  if (!nW(w, "hall")) return [];
  syncBuildings(state, f);
  const h = homesOf(state, f)[tile];
  if (!h || h.real || !Array.isArray(h.armory)) return [];
  const rank = (t) => (useOf(t).storage > 0 ? 3e6 + useOf(t).storage : useOf(t).work === "craftbench" ? 2e6 : useOf(t).comfort > 0 ? 1e6 + useOf(t).comfort * 1000 : 0);
  const keys = [...new Set(h.armory.filter((it) => it && isFurniture(it.key) && !BED_SPEC[it.key]).map((it) => it.key))].filter((t) => rank(t) > 0).sort((a, b) => rank(b) - rank(a) || (a < b ? -1 : 1));
  const out = [];
  for (const type of keys) {
    for (;;) {
      const [pw, ph] = pieceSize(type);
      if (nW(w, "hall") * BEDS_AI.room - furnCells(w) < pw * ph || !fittingRoom(state, h, type)) break;
      const i = h.armory.findIndex((it) => it && it.key === type);
      if (i < 0) break;
      h.armory.splice(i, 1);
      w[type] = nW(w, type) + 1;
      syncBuildings(state, f);
      out.push(type);
    }
  }
  return out;
}
