// Containers (the user's request 2026-10-19, docs/base-building/plan.md Part B): where a base keeps its goods, with a
// capacity in kg, so the player (and the AI, the same way: docs/adr/0001-ai-parity.md) sets up a base whose stores are
// under a roof and behind a door instead of heaped in the yard where any raider walks off with them.
//
// The model. The base's books stay the truth: base.stock holds every supply (rounds by calibre under their own keys,
// ammo.js; food by type, foods.js) and base.armory every loose item. A container only says where some of it is kept:
//   - an armory item keeps the key of its container in item.store (missing or stale: unassigned);
//   - a supply's split is base.bins = { [containerKey]: { [supplyKey]: whole units } } (what is in no bin is unassigned).
// Nothing is moved in or out of the books here; putItem / putSupply / autoStore only change these two records, and
// normalizeBins (run by everything that reads them) clamps them to the books: a bin never holds more of a key than the
// base has (the bins shrink proportionally when the stock drops: eaten, spent, stolen), a bin or an item.store naming
// a container that is gone (a demolished or broken building, a car that drove off) is dropped, NaN is dropped.
// The containers (containersOf):
//   "core"    the base itself (the camp cache, the shack, the main house with its cellar), CORE_KG by tier;
//   b:<id>    a standing, unbroken building of a storage type (STORAGE_KG: storehouse, cellar, cold store, freezer,
//             crates, shelves, lockers), on the map or not (a thing that fits nowhere still holds goods by the numbers);
//   v:<id>    a car parked at the base (vehicles.js carsAtBase), its type's payload; only the player (or the AI by its
//             own decision) loads a car: autoStore never does, so a car is never quietly a store;
//   "yard"    everything unassigned: unlimited, in the open, the first thing a raider finds.
// foodOk: food (FOODS) goes only where it keeps: the cellar, cold store, freezer, storehouse, crates and shelves, the
// core (a camp's cache, the house's own cellar) and a car; never lockers.
// autoStore (daily on an AI base and on the autopilot, Tidy up in the Storage tab with all: true) puts the unassigned
// goods into containers with room: deterministic (no dice: by preference, then by key), and a fixed point (a second
// call changes nothing, because it never moves what is assigned unless all: true, and then lays it out the same way).
// On the battle map (basemap.js makeStores) the assignments decide which map container holds what; unassigned goods
// are spread into whatever room is left and the overflow lies in the yard pile. What a raider carries off the map comes
// out of the books and out of the bin it was taken from (basemap.js applyStolen).
// Saves: base.bins and item.store are plain data on records that save already; an old save has neither (read as empty).
import { BUILDINGS, tierName } from "./buildings.js";
import { carsAtBase, VEHICLE_TYPES } from "./vehicles.js";
import { itemKg } from "./inventory.js";
import { SUPPLIES, GEAR } from "./data.js";
import { FOODS } from "./foods.js";
import { tierKey } from "./basemap.js"; // call-time only (basemap.js imports this module: the modules load in a circle)

// Capacities in kg: the storage buildings (buildings.js), the base itself by tier (basemap.js tierKey).
export const STORAGE_KG = { storehouse: 2000, cellar: 800, coldstore: 600, freezer: 500, crates: 120, shelves: 200, lockers: 120 };
export const CORE_KG = { camp: 150, shelter: 400, outpost: 600, hub: 1200 };
const FOOD_OK = new Set(["cellar", "coldstore", "freezer", "storehouse", "crates", "shelves", "core", "vehicle"]);
const DEFAULT_KG = 1; // a stock key with no weight of its own (basemap.js STEAL.DEFAULT_KG)
export const isContainerType = (type) => !!STORAGE_KG[type];
// A unit of a stock key, in kg: a supply's weight (rounds by calibre and the reloading supplies are in SUPPLIES too), a
// food's kg a unit.
export const kgOf = (k) => (SUPPLIES[k] ? SUPPLIES[k].weight : FOODS[k] ? FOODS[k].kg : DEFAULT_KG);
// Dear goods (what a thief goes for first, what belongs behind the best door): the core and the storehouse first.
const DEAR_SUP = new Set(["meds", "parts", "gunparts", "electronics", "carparts", "ammo"]);
export const isDearSupply = (k) => DEAR_SUP.has(k) || !!(SUPPLIES[k] && SUPPLIES[k].cat === "ammo");
const GUN_CATS = new Set(["pistol", "shotgun", "rifle", "automatic"]);
const ARMOR_SLOTS = new Set(["head", "armor", "arms", "legs", "insert"]);
export const isDearItem = (it) => { const d = it && GEAR[it.key]; return !!(d && (GUN_CATS.has(d.cat) || ARMOR_SLOTS.has(d.slot) || (d.slot === "weapon" && d.power >= 3))); };
// Where each class of goods goes first (autoStore): a rank by the container's type, lower first; a type not listed
// never takes that class. "vehicle" is never listed: a car is loaded by hand only.
const PREFER = {
  food: { cellar: 0, coldstore: 1, freezer: 2, storehouse: 3, crates: 4, shelves: 5, core: 6 },
  dear: { core: 0, storehouse: 1, lockers: 2, shelves: 3, crates: 4, cellar: 5, coldstore: 6, freezer: 7 },
  gear: { lockers: 0, storehouse: 1, core: 2, shelves: 3, crates: 4, cellar: 5, coldstore: 6, freezer: 7 },
  plain: { storehouse: 0, shelves: 1, crates: 2, core: 3, lockers: 4, cellar: 5, coldstore: 6, freezer: 7 },
};

// ---------- the records ----------
export const binsOf = (base) => (base.bins && typeof base.bins === "object" ? base.bins : (base.bins = {}));
const goodsOf = (base) => Object.entries(base.stock || {}).filter(([, q]) => typeof q === "number" && Math.floor(q) > 0).map(([k, q]) => [k, Math.floor(q)]);
// The containers that exist at the base now, without their contents: [{ key, label, kind, cap, bid, vid, type, foodOk }].
function shells(state, base) {
  const out = [{ key: "core", label: tierName(base), kind: "core", type: "core", cap: CORE_KG[tierKey(base)] || CORE_KG.outpost, bid: null, vid: null, foodOk: true }];
  const n = {}, of = {};
  for (const b of base.buildings || []) if (isContainerType(b.type) && !b.broken) { n[b.type] = (n[b.type] || 0) + 1; of[b.id] = n[b.type]; }
  const blds = (base.buildings || []).filter((b) => isContainerType(b.type) && !b.broken).sort((a, b) => a.id - b.id);
  for (const b of blds) out.push({ key: `b:${b.id}`, label: `${BUILDINGS[b.type].name}${n[b.type] > 1 ? ` ${of[b.id]}` : ""}`, kind: "store", type: b.type, cap: STORAGE_KG[b.type], bid: b.id, vid: null, foodOk: FOOD_OK.has(b.type) });
  const cars = state ? carsAtBase(state, base.id).slice().sort((a, b) => a.id - b.id) : [];
  for (const v of cars) out.push({ key: `v:${v.id}`, label: v.name, kind: "vehicle", type: "vehicle", cap: (VEHICLE_TYPES[v.type] && VEHICLE_TYPES[v.type].payload) || 0, bid: null, vid: v.id, foodOk: true });
  out.push({ key: "yard", label: "The yard", kind: "yard", type: "yard", cap: Infinity, bid: null, vid: null, foodOk: true });
  return out;
}
// The bins and the items' assignments made to agree with the books and the containers that exist: a bin holds whole
// units, never more of a key than the stock has (over it, every bin of that key shrinks by the same share, the first
// bins losing the rounding), nothing NaN, nothing of a container that is gone. Returns the live container keys.
export function normalizeBins(state, base) {
  const live = new Set(shells(state, base).map((c) => c.key));
  live.delete("yard"); // the yard is "no bin"
  const bins = binsOf(base);
  for (const key of Object.keys(bins)) {
    const bin = bins[key];
    if (!live.has(key) || !bin || typeof bin !== "object") { delete bins[key]; continue; }
    for (const k of Object.keys(bin)) { const q = Math.floor(Number(bin[k])); if (!Number.isFinite(q) || q <= 0) delete bin[k]; else bin[k] = q; }
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
// Every container at the base with what is in it: [{ key, label, kind, cap, bid, vid, type, foodOk, gear: [{ item, ai }],
// sup: { k: q }, kg, free }], the core first, then the buildings and the cars by id, the yard (the unassigned) last.
export function containersOf(state, base) {
  normalizeBins(state, base);
  const list = shells(state, base);
  const byKey = {};
  for (const c of list) { c.gear = []; c.sup = {}; c.kg = 0; byKey[c.key] = c; }
  const yard = byKey.yard;
  const bins = binsOf(base);
  const left = {};
  for (const [k, q] of goodsOf(base)) left[k] = q;
  for (const [key, bin] of Object.entries(bins)) { const c = byKey[key]; if (!c) continue; for (const [k, q] of Object.entries(bin)) { c.sup[k] = (c.sup[k] || 0) + q; left[k] = (left[k] || 0) - q; } }
  for (const [k, q] of Object.entries(left)) if (q > 0) yard.sup[k] = q;
  (base.armory || []).forEach((it, ai) => { if (!it) return; const c = (it.store != null && byKey[it.store]) || yard; c.gear.push({ item: it, ai }); });
  for (const c of list) {
    c.kg = Object.entries(c.sup).reduce((a, [k, n]) => a + n * kgOf(k), 0) + c.gear.reduce((a, g) => a + itemKg(g.item), 0);
    c.free = c.kind === "yard" ? Infinity : Math.max(0, c.cap - c.kg);
  }
  return list;
}
export const containerByKey = (state, base, key) => containersOf(state, base).find((c) => c.key === key) || null;
const EPS = 1e-6;

// ---------- moving things by hand ----------
// An armory item into a container (key null or "yard": out of its container). "" or why not.
export function putItem(state, base, item, key) {
  if (!item || !base || !(base.armory || []).includes(item)) return "That is not in the armory here";
  if (key == null || key === "yard") { delete item.store; return ""; }
  const L = containersOf(state, base);
  const c = L.find((x) => x.key === key);
  if (!c || c.kind === "yard") return "That is not a container here";
  if (item.store === key) return "";
  const kg = itemKg(item);
  if (kg > c.free + EPS) return `No room in the ${c.label.toLowerCase()} for that`;
  item.store = key;
  return "";
}
// qty of a supply into a container (toKey; null or "yard": out of its bin), from fromKey (null: the unassigned first,
// then the other bins; "yard": the unassigned only). "" or why not.
export function putSupply(state, base, k, qty, toKey, fromKey = null) {
  const n = Math.floor(Number(qty));
  if (!(n > 0)) return "Not that many";
  if (toKey === "yard") toKey = null;
  if (fromKey === "yard") fromKey = "";
  if (toKey != null && toKey === fromKey) return "";
  const L = containersOf(state, base);
  const by = {};
  for (const c of L) by[c.key] = c;
  const to = toKey != null ? by[toKey] : null;
  if (toKey != null && !to) return "That is not a container here";
  if (fromKey && !by[fromKey]) return "That is not a container here";
  // The sources, in order: the named bin, or the yard then every other bin.
  const sources = fromKey === "" ? ["yard"] : fromKey ? [fromKey] : ["yard", ...L.filter((c) => c.kind !== "yard" && c.key !== toKey).map((c) => c.key)];
  const avail = sources.reduce((a, key) => a + ((by[key] && by[key].sup[k]) || 0), 0);
  if (avail < n) return "Not that many";
  if (to && n * kgOf(k) > to.free + EPS) return `No room in the ${to.label.toLowerCase()} for that`;
  const bins = binsOf(base);
  let left = n;
  for (const key of sources) {
    if (left <= 0) break;
    const q = Math.min(left, (by[key] && by[key].sup[k]) || 0);
    if (q <= 0) continue;
    if (key !== "yard") { bins[key][k] -= q; if (bins[key][k] <= 0) delete bins[key][k]; if (!Object.keys(bins[key]).length) delete bins[key]; }
    left -= q;
  }
  if (to) { const bin = bins[to.key] || (bins[to.key] = {}); bin[k] = (bin[k] || 0) + n; }
  return "";
}

// ---------- the game tidying up ----------
// The unassigned goods into containers with room (all: true: everything but what is in a car, laid out afresh): food
// to where it keeps (PREFER.food), dear things to the core and the storehouse, gear to the lockers, then the storehouse,
// then the core, the rest to the storehouse first; never into a car. Deterministic and a fixed point. Returns what it
// put away: { sup: { k: units }, gear: items, kg }.
export function autoStore(state, base, { all = false } = {}) {
  const out = { sup: {}, gear: 0, kg: 0 };
  if (!base) return out;
  if (all) {
    const bins = binsOf(base);
    for (const key of Object.keys(bins)) if (!key.startsWith("v:")) delete bins[key];
    for (const it of base.armory || []) if (it && it.store != null && !String(it.store).startsWith("v:")) delete it.store;
  }
  const L = containersOf(state, base);
  const yard = L.find((c) => c.kind === "yard");
  const bins = binsOf(base);
  const ranked = (cls) => L.filter((c) => c.kind !== "yard" && PREFER[cls][c.type] != null && (cls !== "food" || c.foodOk)).sort((a, b) => PREFER[cls][a.type] - PREFER[cls][b.type] || (a.bid || 0) - (b.bid || 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const putSup = (k, q, cls) => {
    const kg = Math.max(0.001, kgOf(k));
    for (const c of ranked(cls)) {
      if (q <= 0) break;
      const n = Math.min(q, Math.floor((c.free + EPS) / kg));
      if (n <= 0) continue;
      const bin = bins[c.key] || (bins[c.key] = {});
      bin[k] = (bin[k] || 0) + n;
      c.free -= n * kg; c.kg += n * kg; q -= n;
      out.sup[k] = (out.sup[k] || 0) + n; out.kg += n * kg;
    }
  };
  const putGear = (g, cls) => {
    const kg = itemKg(g.item);
    for (const c of ranked(cls)) {
      if (kg > c.free + EPS) continue;
      g.item.store = c.key; c.free -= kg; c.kg += kg;
      out.gear++; out.kg += kg;
      return;
    }
  };
  const keys = Object.keys(yard.sup).sort();
  for (const k of keys) if (isDearSupply(k)) putSup(k, yard.sup[k], "dear");
  for (const g of yard.gear) if (isDearItem(g.item)) putGear(g, "dear");
  for (const k of keys) if (FOODS[k]) putSup(k, yard.sup[k], "food");
  for (const g of yard.gear) if (!isDearItem(g.item)) putGear(g, "gear");
  for (const k of keys) if (!isDearSupply(k) && !FOODS[k]) putSup(k, yard.sup[k], "plain");
  return out;
}
// The base's storage in kg: { cap, used, yard, byKey: { key: { cap, kg } } } (cap and used without the yard).
export function storageSummary(state, base) {
  const out = { cap: 0, used: 0, yard: 0, byKey: {} };
  for (const c of containersOf(state, base)) {
    out.byKey[c.key] = { cap: c.cap, kg: c.kg };
    if (c.kind === "yard") out.yard = c.kg; else { out.cap += c.cap; out.used += c.kg; }
  }
  return out;
}
