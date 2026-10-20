// Containers (the user's request 2026-10-19, docs/base-building/plan.md Part B): where a base keeps its goods, so the
// player (and the AI, the same way: docs/adr/0001-ai-parity.md) sets up a base whose stores are under a roof and behind
// a door instead of lying outside where any raider walks off with them.
//
// The room is basestorage.js's (base storage limits, merged 2026-10-19): storageOf lists the containers and their room
// (the core by tier, a camp none; every storage building by STORE_KG, the storage shelves and lockers among them; a car
// parked here, its payload; an opened lock box in the armory) and decides what is inside and what lies OUTSIDE. This
// module is the layer on top that says WHICH container something is kept in.
//
// The model. The base's books stay the truth: base.stock holds every supply (rounds by calibre under their own keys,
// ammo.js; food by type, foods.js) and base.armory every loose item. An assignment only says where some of it is kept:
//   - an armory item keeps the key of its container in item.store (missing or stale: unassigned);
//   - a supply's split is base.bins = { [containerKey]: { [supplyKey]: whole units } } (what is in no bin is unassigned).
// Nothing is moved in or out of the books here; putItem / putSupply / autoStore only change these two records, and
// normalizeBins (run by everything here that writes them) clamps them to the books: a bin never holds more of a key
// than the base has (the bins shrink proportionally when the stock drops: eaten, spent, stolen), a bin or an
// item.store naming a container that is gone (a demolished building, a car that drove off) is dropped, NaN is dropped.
// basestorage.js storageOf reads the assignments as they are (clamped as it reads, changing nothing): assigned goods
// fill their own container first, up to its room; the unassigned goods fill the room left over by its ranking (worth a
// kg); the rest lies outside, on the piles of the base map, wearing every day. So the Storage tab, the storage lines,
// the base map's stores and piles and the daily wear outside give one answer.
// The keys (storageOf's): "core" (the base itself), b:<id> (a storage building or fitting), v:<id> (a parked car);
// an opened box (a:<armory index>) is room but no container to assign to: it is an item, and its index moves as the
// armory changes. Two pseudo-containers close the list containersOf gives: "loose" (unassigned, lying inside wherever
// there is room) and "outside" (unassigned or overflowing, in the open: dev's outside, the base map's piles).
// foodOk: food goes only where it keeps: never the lockers or the armory.
// autoStore (daily on an AI base and on the autopilot, Tidy up in the Storage tab with all: true) assigns the unassigned
// goods in basestorage.js's order (the densest by worth a kg first, byWorth) to the containers with room by preference
// (food where it keeps, rounds and guns in the armory, dear things behind the best door, gear to the lockers);
// deterministic (no dice) and a fixed point (a second call changes nothing); never into a car or a box.
// On the battle map (basemap.js makeStores) the assigned goods sit in their container's map entry, the unassigned
// inside are spread over the room left, what lies outside on the piles. What a raider carries off the map comes out of
// the books and out of the bin it was taken from (basemap.js applyStolen).
// Saves: base.bins and item.store are plain data on records that save already; an old save has neither (read as empty).
import { SUPPLIES, GEAR, supWeight } from "./data.js";
import { FOODS } from "./foods.js";
import { storageOf, byWorth, supGood, itemGood, itemRoomKg, storedKey, isStoreBuilding } from "./basestorage.js";

export const OUTSIDE = "outside"; // the pseudo-container of what lies outside (storageOf outside)
export const LOOSE = "loose";     // the pseudo-container of what is inside but in no container (storageOf loose)
const UNASSIGNED = new Set([OUTSIDE, LOOSE]);
const ASSIGNABLE = new Set(["core", "building", "vehicle"]);
const NO_FOOD = new Set(["lockers", "armory"]);
const DEFAULT_KG = 1; // a stock key with no weight of its own (basemap.js STEAL.DEFAULT_KG)
const EPS = 1e-6;
/** Whether a building type is storage (buildings.js storeKg; basestorage.js isStoreBuilding). */
export const isContainerType = (type) => isStoreBuilding(type);
// A unit of a stock key, in kg (basestorage.js's weights: data.js supWeight).
export const kgOf = (k) => supWeight(k) || (FOODS[k] ? FOODS[k].kg : DEFAULT_KG);
// Dear goods (what a thief goes for first, what belongs behind the best door).
const DEAR_SUP = new Set(["meds", "parts", "gunparts", "electronics", "carparts", "ammo"]);
const isAmmoSupply = (k) => k === "ammo" || k === "arrows" || !!(SUPPLIES[k] && SUPPLIES[k].cat === "ammo");
export const isDearSupply = (k) => DEAR_SUP.has(k) || isAmmoSupply(k);
const isFood = (k) => !!FOODS[k] || !!(SUPPLIES[k] && SUPPLIES[k].cat === "food");
const GUN_CATS = new Set(["pistol", "shotgun", "rifle", "automatic"]);
const ARMOR_SLOTS = new Set(["head", "armor", "arms", "legs", "insert"]);
export const isDearItem = (it) => { const d = it && GEAR[it.key]; return !!(d && (GUN_CATS.has(d.cat) || ARMOR_SLOTS.has(d.slot) || (d.slot === "weapon" && d.power >= 3))); };
// Where each class of goods goes first (autoStore): a rank by the container's type (the core: "core"), lower first; a
// type not listed never takes that class. A car and an opened box are never listed: loaded by hand only.
const PREFER = {
  food: { cellar: 0, coldstore: 1, freezer: 2, storehouse: 3, warehouse: 4, shed: 5, crates: 6, shelves: 7, storebox: 8, core: 9 },
  ammo: { armory: 0, core: 1, storehouse: 2, warehouse: 3, lockers: 4, shed: 5, shelves: 6, crates: 7, storebox: 8, cellar: 9, coldstore: 10, freezer: 11 },
  dear: { core: 0, storehouse: 1, warehouse: 2, lockers: 3, armory: 4, shed: 5, shelves: 6, crates: 7, storebox: 8, cellar: 9, coldstore: 10, freezer: 11 },
  arms: { armory: 0, core: 1, storehouse: 2, warehouse: 3, lockers: 4, shed: 5, shelves: 6, crates: 7, storebox: 8, cellar: 9, coldstore: 10, freezer: 11 },
  gear: { armory: 0, lockers: 1, storehouse: 2, warehouse: 3, core: 4, shed: 5, shelves: 6, crates: 7, storebox: 8, cellar: 9, coldstore: 10, freezer: 11 },
  plain: { warehouse: 0, storehouse: 1, shed: 2, shelves: 3, crates: 4, storebox: 5, core: 6, lockers: 7, cellar: 8, coldstore: 9, freezer: 10 },
};
const typeOf = (c) => (c.kind === "core" ? "core" : c.type);

// ---------- the records ----------
export const binsOf = (base) => (base.bins && typeof base.bins === "object" ? base.bins : (base.bins = {}));
const goodsOf = (base) => Object.entries(base.stock || {}).filter(([k, q]) => typeof q === "number" && Math.floor(q) > 0 && storedKey(k)).map(([k, q]) => [k, Math.floor(q)]);
// The keys goods can be assigned to now: storageOf's core, buildings and parked cars.
const liveKeys = (st) => new Set(st.containers.filter((c) => ASSIGNABLE.has(c.kind)).map((c) => c.key));
// The bins and the items' assignments made to agree with the books and the containers that exist: a bin holds whole
// units of a stored key, never more of a key than the stock has (over it, every bin of that key shrinks by the same
// share, the first bins losing the rounding), nothing NaN, nothing of a container that is gone. Returns the live keys.
export function normalizeBins(state, base) {
  const live = liveKeys(storageOf(state, base));
  const bins = binsOf(base);
  for (const key of Object.keys(bins)) {
    const bin = bins[key];
    if (!live.has(key) || !bin || typeof bin !== "object") { delete bins[key]; continue; }
    for (const k of Object.keys(bin)) { const q = Math.floor(Number(bin[k])); if (!Number.isFinite(q) || q <= 0 || !storedKey(k)) delete bin[k]; else bin[k] = q; }
  }
  const have = {};
  for (const [k, q] of goodsOf(base)) have[k] = q;
  const keys = Object.keys(bins).sort();
  const held = {};
  for (const key of keys) for (const [k, q] of Object.entries(bins[key])) held[k] = (held[k] || 0) + q;
  for (const [k, tot] of Object.entries(held)) {
    const cap = have[k] || 0;
    if (tot <= cap) continue;
    let left = cap;
    const share = cap / tot;
    const had = keys.filter((key) => bins[key][k] > 0);
    for (const key of had) { const n = Math.min(left, Math.floor(bins[key][k] * share)); left -= n; bins[key][k] = n; }
    for (const key of had) { if (left <= 0) break; bins[key][k] += 1; left -= 1; } // the rounding's units back, one a bin
    for (const key of had) if (!(bins[key][k] > 0)) delete bins[key][k];
  }
  for (const key of keys) if (!Object.keys(bins[key]).length) delete bins[key];
  for (const it of base.armory || []) if (it && it.store != null && !live.has(it.store)) delete it.store;
  return live;
}
// The kg a storageOf container holds by assignment (exact, from its supplies and items).
const heldKg = (base, c) => Object.entries(c.sup).reduce((a, [k, n]) => a + n * supWeight(k), 0) + c.gear.reduce((a, i) => a + itemRoomKg((base.armory || [])[i]), 0);
// Every container at the base with what is kept in it: [{ key, label, kind: "core" | "building" | "vehicle" | "box" |
// "loose" | "outside", type, cap, bid, vid, foodOk, assignable, gear: [{ item, ai }], sup: { k: q }, kg, free }], in
// storageOf's order (the core, the buildings, the cars, the opened boxes), then the goods in no container that lie
// inside ("loose") and what lies outside ("outside"). A real container's goods are those assigned to it that fit
// (storageOf); an opened box holds what is still in it.
export function containersOf(state, base) {
  normalizeBins(state, base);
  const st = storageOf(state, base);
  const armory = base.armory || [];
  const n = {}, of = new Map();
  for (const c of st.containers) { n[c.name] = (n[c.name] || 0) + 1; of.set(c, n[c.name]); }
  const list = st.containers.map((c) => {
    const kind = c.kind, assignable = ASSIGNABLE.has(kind);
    const box = kind === "box" ? armory[Number(c.key.slice(2))] : null;
    const kg = box ? itemRoomKg(box) : heldKg(base, c);
    return {
      key: c.key, label: `${c.name}${n[c.name] > 1 ? ` ${of.get(c)}` : ""}`, kind, type: typeOf(c), cap: c.cap,
      bid: kind === "building" ? Number(c.key.slice(2)) : null, vid: kind === "vehicle" ? Number(c.key.slice(2)) : null,
      foodOk: assignable && !NO_FOOD.has(c.type), assignable,
      gear: c.gear.map((ai) => ({ item: armory[ai], ai })), sup: { ...c.sup }, kg, free: Math.max(0, c.cap - kg),
    };
  });
  const pseudo = (key, label, part, free) => ({
    key, label, kind: key, type: key, cap: Infinity, bid: null, vid: null, foodOk: true, assignable: false,
    gear: part.gear.map((ai) => ({ item: armory[ai], ai })), sup: { ...part.sup },
    kg: Object.entries(part.sup).reduce((a, [k, q]) => a + q * supWeight(k), 0) + part.gear.reduce((a, ai) => a + itemRoomKg(armory[ai]), 0), free,
  });
  list.push(pseudo(LOOSE, "Inside, not put away", st.loose, Math.max(0, st.free)));
  list.push(pseudo(OUTSIDE, "Outside", st.outside, Infinity));
  return list;
}
export const containerByKey = (state, base, key) => containersOf(state, base).find((c) => c.key === key) || null;

// ---------- moving things by hand ----------
// An armory item into a container (key null, "outside" or "loose": out of its container). "" or why not.
export function putItem(state, base, item, key) {
  if (!item || !base || !(base.armory || []).includes(item)) return "That is not in the armory here";
  if (key == null || UNASSIGNED.has(key)) { delete item.store; return ""; }
  const L = containersOf(state, base);
  const c = L.find((x) => x.key === key);
  if (!c || !c.assignable) return "That is not a container here";
  if (item.store === key) return "";
  if (itemGood(item, 0).dens === Infinity) return "An opened box is storage of its own: it holds goods, it is not put away";
  const kg = itemRoomKg(item);
  if (kg > c.free + EPS) return `No room in the ${c.label.toLowerCase()} for that`;
  item.store = key;
  return "";
}
// qty of a supply into a container (toKey; null, "outside" or "loose": out of its bin), from fromKey (null: the
// unassigned first, then the other bins; "outside" or "loose": the unassigned only). "" or why not.
export function putSupply(state, base, k, qty, toKey, fromKey = null) {
  const n = Math.floor(Number(qty));
  if (!(n > 0)) return "Not that many";
  if (UNASSIGNED.has(toKey)) toKey = null;
  if (UNASSIGNED.has(fromKey)) fromKey = "";
  if (toKey != null && toKey === fromKey) return "";
  const L = containersOf(state, base);
  const by = {};
  for (const c of L) by[c.key] = c;
  const to = toKey != null ? by[toKey] : null;
  if (toKey != null && (!to || !to.assignable)) return "That is not a container here";
  if (fromKey && (!by[fromKey] || !by[fromKey].assignable)) return "That is not a container here";
  const bins = binsOf(base);
  const have = Math.floor((base.stock && base.stock[k]) || 0);
  const inBins = Object.values(bins).reduce((a, bin) => a + ((bin && bin[k]) || 0), 0);
  const free = Math.max(0, have - inBins); // the unassigned units
  // The sources, in order: the named bin, or the unassigned then every other bin.
  const sources = fromKey === "" ? [null] : fromKey ? [fromKey] : [null, ...L.filter((c) => c.assignable && c.key !== toKey).map((c) => c.key)];
  const avail = (key) => (key == null ? free : (bins[key] && bins[key][k]) || 0);
  if (sources.reduce((a, key) => a + avail(key), 0) < n) return "Not that many";
  if (to && n * kgOf(k) > to.free + EPS) return `No room in the ${to.label.toLowerCase()} for that`;
  let left = n;
  for (const key of sources) {
    if (left <= 0) break;
    const q = Math.min(left, avail(key));
    if (q <= 0) continue;
    if (key != null) { bins[key][k] -= q; if (bins[key][k] <= 0) delete bins[key][k]; if (!Object.keys(bins[key]).length) delete bins[key]; }
    left -= q;
  }
  if (to) { const bin = bins[to.key] || (bins[to.key] = {}); bin[k] = (bin[k] || 0) + n; }
  return "";
}

// ---------- the game tidying up ----------
// The class of a good for PREFER.
const supClass = (k) => (isAmmoSupply(k) ? "ammo" : isDearSupply(k) ? "dear" : isFood(k) ? "food" : "plain");
const itemClass = (it) => (isDearItem(it) ? "arms" : "gear");
// The unassigned goods into containers with room (all: true: everything but what is in a car, laid out afresh), the
// densest by worth a kg first (basestorage.js byWorth, the order the room is filled in), each to the first container
// of its class's preference (PREFER) with room for it; never into a car or a box. Deterministic and a fixed point.
// Returns what it put away: { sup: { k: units }, gear: items, kg }.
export function autoStore(state, base, { all = false } = {}) {
  const out = { sup: {}, gear: 0, kg: 0 };
  if (!base) return out;
  if (all) {
    const bins = binsOf(base);
    for (const key of Object.keys(bins)) if (!key.startsWith("v:")) delete bins[key];
    for (const it of base.armory || []) if (it && it.store != null && !String(it.store).startsWith("v:")) delete it.store;
  }
  normalizeBins(state, base);
  const st = storageOf(state, base);
  const armory = base.armory || [];
  const bins = binsOf(base);
  const shells = st.containers.filter((c) => ASSIGNABLE.has(c.kind) && c.kind !== "vehicle").map((c) => ({ key: c.key, type: typeOf(c), foodOk: !NO_FOOD.has(c.type), free: c.cap - heldKg(base, c) }));
  const ranked = (cls) => shells.filter((c) => PREFER[cls][c.type] != null && (cls !== "food" || c.foodOk)).sort((a, b) => PREFER[cls][a.type] - PREFER[cls][b.type] || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  // The unassigned goods: units in no bin, items with no container (an opened box is room, not a good to put away).
  const inBins = {};
  for (const bin of Object.values(bins)) for (const [k, q] of Object.entries(bin)) inBins[k] = (inBins[k] || 0) + q;
  const goods = [];
  for (const [k, q] of goodsOf(base)) { const left = q - (inBins[k] || 0); if (left > 0) goods.push(supGood(k, left)); }
  armory.forEach((it, i) => { if (it && GEAR[it.key] && it.store == null) { const g = itemGood(it, i); if (g.kg > EPS && g.dens !== Infinity) goods.push(g); } });
  goods.sort(byWorth);
  for (const g of goods) {
    if (g.sup) {
      let q = g.q;
      for (const c of ranked(supClass(g.sup))) {
        if (q <= 0) break;
        const n = Math.min(q, Math.floor((c.free + EPS) / g.unit));
        if (n <= 0) continue;
        const bin = bins[c.key] || (bins[c.key] = {});
        bin[g.sup] = (bin[g.sup] || 0) + n;
        c.free -= n * g.unit; q -= n;
        out.sup[g.sup] = (out.sup[g.sup] || 0) + n; out.kg += n * g.unit;
      }
    } else {
      const it = armory[/** @type {number} */ (g.i)];
      const c = ranked(itemClass(it)).find((x) => g.kg <= x.free + EPS);
      if (!c) continue;
      it.store = c.key; c.free -= g.kg;
      out.gear++; out.kg += g.kg;
    }
  }
  out.kg = Math.round(out.kg * 10) / 10;
  return out;
}
// The base's containers in kg for the autopilot and the Storage tab: { cap (every container's room), held (what is
// inside), outside (kg lying outside), byKey: { key: { cap, kg } } (kept in each by assignment) }.
export function storageKg(state, base) {
  const st = storageOf(state, base);
  const byKey = {};
  for (const c of st.containers) byKey[c.key] = { cap: c.cap, kg: c.kind === "box" ? itemRoomKg((base.armory || [])[Number(c.key.slice(2))]) : heldKg(base, c) };
  return { cap: st.cap, held: st.inside, outside: st.outsideKg, byKey };
}
