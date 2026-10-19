// @ts-check
// Base storage limits (2026-10-19, the user's request: "Add base storage limits, needing to craft simple storage boxes
// up to buildings of different sizes with the dedication to increasing the base storage. You can also leave things out
// not in containers but if they are outside the durability decays and easier for raiders to steal. Camps start with no
// storage but using a vehicle you can use the storage of the truck as a storage unit until better storage is made. You
// can steal storage boxes like small safes (Carried only slot two hands) weapon cases etc.").
//
// THE ONE RULE. A base's storage is a weight in kg: the sum of its containers' room (storageOf). Everything the base
// holds fills it: the supplies in base.stock (data.js SUPPLIES weight a unit, food by type included) and the items in
// base.armory (inventory.js itemLoad). What does not fit lies OUTSIDE, in the open. Nothing is ever refused or blocked:
// goods past the room are simply left out, with penalties. Water is not counted (its tanks, cisterns and barrels are
// its own room: economy.js waterCapacity).
//
// THE CONTAINERS (storageOf containers, in this order):
//   1. the base's own core by tier (CORE_KG, as basemap.js tierKey reads the tier): a camp nothing ("camps start with
//      no storage"), a shelter's or an outpost camp's bunk shack 150, an outpost 500, the main hub's house and cellar 1200.
//      The AI groups' bases (groupbases.js) are measured the same way.
//   2. storage buildings (buildings.js STORE_KG / BUILDINGS storeKg, re-exported here): storage box 60, storage crates
//      150, root cellar 400, cold store 300, walk-in freezer 300, storage shed 600, storehouse 2000, warehouse 6000.
//      Standing ones only (broken ones too: a broken roof still keeps the goods in); a job in the queue holds nothing.
//   3. the cars parked here (vehicles.js carsAtBase: a car, not a bike, not a wreck): their payload (VEHICLE_TYPES), a
//      pickup 650, an Army truck 2500: "using a vehicle you can use the storage of the truck". Only while it is parked
//      here: a team that drives off in it takes the room with it, and what it held is outside from then on.
//   4. lock boxes and cases in the armory (boxes.js isBox) once opened (item.opened, or forced): BOX_STORE_KG
//      (data-boxes.js) each, cash box 3, fire safe 15, toolbox 10, equipment case 12, rifle case 8, pistol case 3. Its
//      own weight is not counted (it is the room); what is still inside it is, and fills it first. A sealed box is an
//      item like any other until it is opened.
//
// THE FILL (deterministic, pure): every good is ranked by its worth a kg (supplies: data.js supValue / supWeight;
// items: valuation.js itemValue / itemLoad), the densest first (supplies before items on a tie, then by key or armory
// order), and goes in while there is room; a supply stack goes in as many whole units as fit and the rest lies outside.
// So the valuables are kept in and the cheap, heavy things (scrap, firewood, building materials) are what lies outside.
// (The design said "supplies first, then the items"; one ranking for both keeps a gold ring inside before a pile of
// scrap, which is what the user asked for.)
//
// OUTSIDE (storageDaily, world.js's daily list right after economy.js basesDaily; storageWarnDay):
//   - an item outside wears: its uses left drop by OUTSIDE_WEAR of its full uses a day (twice that on a day of rain or
//     snow: weather.js), never below 1; things that do not wear (itemcond.js rollsWear: counts, books, consumables,
//     valuables) are untouched, and so is what lies in a box. One log line a base at most every WARN_DAYS days, not one
//     an item. The groups' bases weather the same (ADR 0001), without the log line.
//   - food: storage.js keeps its own rooms (days of food in cellars, crates, a freezer) and its own outside factor
//     (FACTOR.outside); this module does not spoil food a second time. Other supplies outside do not vanish by
//     themselves.
//   - raiders: outsideShare is the share of the goods lying outside, for the base map's piles (basemap.js: easier to
//     steal).
// The base window shows it all (storageSummary / storageLine).
import { BUILDINGS, isCamp, isShelter } from "./buildings.js"; // call-time only (the import cycle)
import { GEAR, SUPPLIES, supValue, supWeight } from "./data.js";
import { BOX_STORE_KG } from "./data-boxes.js";
import { itemLoad, itemKg } from "./inventory.js"; // call-time only
import { isBox } from "./boxes.js"; // call-time only
import { itemValue } from "./valuation.js"; // call-time only
import { carsAtBase, VEHICLE_TYPES } from "./vehicles.js"; // call-time only
import { log, day } from "./world.js"; // call-time only
import { weatherOnDay } from "./weather.js"; // call-time only
import { rollsWear, isPaper } from "./itemcond.js"; // call-time only
import { itemDur, itemDurMax } from "./crafting.js"; // call-time only
import { keyWord } from "./water.js"; // call-time only
export { STORE_KG } from "./buildings.js";
export { BOX_STORE_KG } from "./data-boxes.js";

// The core's room by tier (basemap.js CORE: the camp's cache, the bunk shack, the main house and its cellar).
export const CORE_KG = { camp: 0, shelter: 150, outpost: 500, hub: 1200 };
const CORE_NAME = { camp: "Camp cache", shelter: "Bunk shack", outpost: "Bunk shack", hub: "Main house and cellar" };
export const OUTSIDE_WEAR = 0.02; // a share of an item's full uses lost a day outside (× WET_WEAR on a wet day)
export const WET_WEAR = 2;
export const WARN_DAYS = 3;       // the log line: at most once in this many days a base
const NOT_STORED = new Set(["water", "rawwater"]); // their own tanks and barrels
const WET = new Set(["rain", "storm", "snow", "blizzard"]);
const r1 = (v) => Math.round(v * 10) / 10;
const EPS = 1e-9;

// The tier as the base map reads it (basemap.js tierKey; a group's base has no tier: an outpost or the hub).
const tierOf = (base) => (isCamp(base) ? "camp" : isShelter(base) ? "shelter" : base.type === "hub" ? "hub" : "outpost");
/** The room in kg of a base's own core (camp 0, shelter 150, outpost 500, hub 1200). @param {any} base */
export const coreStoreKg = (base) => (base ? CORE_KG[tierOf(base)] || 0 : 0);
/** Whether a building type holds goods (STORE_KG). @param {string} type */
export const isStoreBuilding = (type) => !!(BUILDINGS[type] && BUILDINGS[type].storeKg > 0);
const buildingKg = (type) => (BUILDINGS[type] && BUILDINGS[type].storeKg) || 0;
/** A parked car's room in kg (its payload; a fleet its cars'; a bike or a wreck nothing). @param {any} v @returns {number} */
export function vehicleStoreKg(v) {
  if (!v) return 0;
  if (Array.isArray(v.fleet)) return v.fleet.reduce((a, x) => a + vehicleStoreKg(x), 0);
  const T = VEHICLE_TYPES[v.type];
  return T && T.motor && !v.destroyed ? T.payload || 0 : 0;
}
// An opened box (the lock picked or forced, or never locked and looked into) is room; a sealed one an item.
const isOpenBox = (it) => isBox(it) && !!(it.opened || it.forced);
const boxKg = (it) => BOX_STORE_KG[it.key] || 0;
// Worth a kg of a supply key, of an item.
const supDensity = (k) => { const w = supWeight(k); return w > 0 ? supValue(k) / w : 0; };

/**
 * The base's storage: its containers' room (cap, kg), all its goods' weight (used, kg: inside and outside), what lies
 * outside (outsideKg, and outside.sup units by key, outside.gear armory indices), the containers.
 * @param {any} state @param {any} base
 * @returns {{ cap: number, used: number, inside: number, outsideKg: number, free: number,
 *   containers: { key: string, name: string, cap: number, kind: "core" | "building" | "vehicle" | "box", type: string }[],
 *   outside: { sup: Record<string, number>, gear: number[] } }}
 */
export function storageOf(state, base) {
  /** @type {{ key: string, name: string, cap: number, kind: "core" | "building" | "vehicle" | "box", type: string }[]} */
  const containers = [];
  const out = { cap: 0, used: 0, inside: 0, outsideKg: 0, free: 0, containers, outside: { sup: /** @type {Record<string, number>} */ ({}), gear: /** @type {number[]} */ ([]) } };
  if (!base) return out;
  const tier = tierOf(base);
  if (CORE_KG[tier] > 0) containers.push({ key: "core", name: CORE_NAME[tier], cap: CORE_KG[tier], kind: "core", type: tier });
  for (const b of base.buildings || []) { const kg = buildingKg(b.type); if (kg > 0) containers.push({ key: `b:${b.id}`, name: BUILDINGS[b.type].name, cap: kg, kind: "building", type: b.type }); }
  if (state && !base.group) for (const v of carsAtBase(state, base.id)) { const kg = vehicleStoreKg(v); if (kg > 0) containers.push({ key: `v:${v.id}`, name: v.name, cap: kg, kind: "vehicle", type: v.type }); }
  const armory = base.armory || [];
  armory.forEach((it, i) => { if (it && isOpenBox(it) && boxKg(it) > 0) containers.push({ key: `a:${i}`, name: it.name, cap: boxKg(it), kind: "box", type: it.key }); });
  out.cap = containers.reduce((a, c) => a + c.cap, 0);

  // The goods, ranked (THE FILL).
  /** @type {{ sup?: string, i?: number, kg: number, unit: number, q: number, dens: number, rank: number }[]} */
  const goods = [];
  for (const [k, q] of Object.entries(base.stock || {})) {
    if (typeof q !== "number" || !(q > EPS) || NOT_STORED.has(k) || !SUPPLIES[k]) continue;
    const w = supWeight(k);
    if (!(w > 0)) continue;
    goods.push({ sup: k, kg: q * w, unit: w, q, dens: supDensity(k), rank: 0 });
  }
  armory.forEach((it, i) => {
    if (!it || !GEAR[it.key]) return;
    const open = isOpenBox(it);
    const kg = open ? Math.max(0, itemLoad(it) - itemKg(it)) : itemLoad(it); // an opened box: only what is still in it
    if (!(kg > EPS)) return;
    goods.push({ i, kg, unit: kg, q: 1, dens: open ? Infinity : itemValue(it) / kg, rank: 1 }); // what is in a box stays in the box
  });
  goods.sort((a, b) => b.dens - a.dens || a.rank - b.rank || (a.sup && b.sup ? (a.sup < b.sup ? -1 : a.sup > b.sup ? 1 : 0) : (a.i || 0) - (b.i || 0)));
  let room = out.cap;
  for (const g of goods) {
    out.used += g.kg;
    if (g.sup) {
      const fit = Math.min(g.q, Math.floor((room + EPS) / g.unit));
      room -= fit * g.unit;
      const left = g.q - fit;
      if (left > EPS) { out.outside.sup[g.sup] = Math.round(left * 100) / 100; out.outsideKg += left * g.unit; }
    } else if (g.kg <= room + EPS) room -= g.kg;
    else { out.outside.gear.push(/** @type {number} */ (g.i)); out.outsideKg += g.kg; }
  }
  out.outside.gear.sort((a, b) => a - b);
  out.used = r1(out.used);
  out.outsideKg = r1(out.outsideKg);
  out.inside = r1(Math.max(0, out.used - out.outsideKg));
  out.free = r1(Math.max(0, out.cap - out.inside));
  return out;
}
/** The share of a base's goods (by weight) lying outside, 0–1: raiders find it easier (basemap.js). @param {any} state @param {any} base */
export function outsideShare(state, base) {
  const s = storageOf(state, base);
  return s.used > 0 ? Math.min(1, s.outsideKg / s.used) : 0;
}

// ---------- words ----------
const an = (w) => (/^[aeiou]/i.test(w) ? "an" : "a");
const plural = (w) => (/(box|ch|sh)$/i.test(w) ? `${w}es` : /s$/i.test(w) ? w : `${w}s`);
const kgText = (v) => `${Math.round(v)}`;
// The containers in words: "storage shed 600, 2 storage boxes 120, the pickup truck 650 while it is parked".
function containerWords(st) {
  /** @type {Map<string, { name: string, n: number, cap: number, kind: string }>} */
  const by = new Map();
  for (const c of st.containers) {
    const k = c.kind === "vehicle" ? c.key : `${c.kind}:${c.type}`;
    const e = by.get(k) || { name: c.name, n: 0, cap: 0, kind: c.kind };
    e.n++; e.cap += c.cap;
    by.set(k, e);
  }
  return [...by.values()].map((e) => {
    const nm = e.name.toLowerCase();
    if (e.kind === "vehicle") return `the ${nm} ${kgText(e.cap)} while it is parked`;
    if (e.kind === "box") return `${e.n > 1 ? `${e.n} opened ${plural(nm)}` : `an opened ${nm}`} ${kgText(e.cap)}`;
    return `${e.n > 1 ? `${e.n} ${plural(nm)}` : nm} ${kgText(e.cap)}`;
  });
}
// What lies outside in words: "12 scrap, 40 firewood, a fire axe" (the heaviest first, at most `max` of them).
function outsideWords(base, st, max = 8) {
  const bits = [];
  for (const [k, q] of Object.entries(st.outside.sup)) bits.push({ kg: q * supWeight(k), t: `${Math.round(q * 10) / 10} ${keyWord(k) === k && SUPPLIES[k] ? SUPPLIES[k].name.toLowerCase() : keyWord(k)}` });
  for (const i of st.outside.gear) { const it = (base.armory || [])[i]; if (it) bits.push({ kg: itemLoad(it), t: `${an(it.name)} ${it.name.toLowerCase()}` }); }
  bits.sort((a, b) => b.kg - a.kg);
  const shown = bits.slice(0, max).map((b) => b.t);
  if (bits.length > max) shown.push(`${bits.length - max} more`);
  return shown;
}
/**
 * The storage in words for the base window: [the head ("Storage 420 / 650 kg"), the room ("Room: …" or "No storage
 * yet: …"), what lies outside ("80 kg outside: …"; only when something does)].
 * @param {any} state @param {any} base @returns {string[]}
 */
export function storageSummary(state, base) {
  const st = storageOf(state, base);
  const rows = [`Storage ${kgText(st.used)} / ${kgText(st.cap)} kg`];
  rows.push(st.containers.length ? `Room: ${containerWords(st).join(", ")}` : "No storage yet: park a vehicle here or build a storage box");
  if (st.outsideKg > 0) rows.push(`${kgText(st.outsideKg)} kg outside: ${outsideWords(base, st).join(", ")}`);
  return rows;
}
/** The storage in one line ("Storage 420 / 650 kg: shed 600, …; 80 kg outside: 12 scrap, …"). @param {any} state @param {any} base */
export function storageLine(state, base) {
  const st = storageOf(state, base);
  const room = st.containers.length ? containerWords(st).join(", ") : "no storage yet";
  return `Storage ${kgText(st.used)} / ${kgText(st.cap)} kg: ${room}${st.outsideKg > 0 ? `; ${kgText(st.outsideKg)} kg outside: ${outsideWords(base, st).join(", ")}` : ""}`;
}

// ---------- the daily wear outside ----------
/** Whether the day was wet at a tile (rain, a storm, snow, a blizzard). @param {any} state @param {number} dayNumber @param {number} tile */
function wetDay(state, dayNumber, tile) {
  const w = weatherOnDay(state, dayNumber, tile);
  return !!w && (WET.has(w.key) || (w.rain || 0) > 0 || (w.snow || 0) > 0);
}
/**
 * One base's day outside: every item lying outside that wears loses its share. Returns { n, kg } (the items worn,
 * what everything outside weighs).
 * @param {any} state @param {any} base @param {boolean} wet
 */
export function weatherOutside(state, base, wet) {
  const st = storageOf(state, base);
  let n = 0;
  for (const i of st.outside.gear) {
    const it = base.armory[i];
    if (!it || !rollsWear(it.key) || isPaper(it.key)) continue;
    const left = itemDur(it), full = itemDurMax(it);
    if (left == null || !full || left <= 1) continue;
    it.dur = Math.max(1, Math.round((left - full * OUTSIDE_WEAR * (wet ? WET_WEAR : 1)) * 100) / 100);
    n++;
  }
  return { n, kg: st.outsideKg };
}
/** The daily tick (world.js, after basesDaily): things outside wear at every base, yours and the groups'. @param {any} state */
export function storageDaily(state) {
  const dayNumber = Math.max(1, Math.floor((state.hour - 1) / 24) + 1); // the day that just ended
  const today = day(state);
  const seen = new Set();
  for (const base of state.bases || []) {
    seen.add(base);
    if (!base.armory || !base.armory.length) continue;
    const r = weatherOutside(state, base, wetDay(state, dayNumber, base.tile));
    if (r.n > 0 && (base.storageWarnDay == null || today - base.storageWarnDay >= WARN_DAYS)) {
      base.storageWarnDay = today;
      log(state, `${base.name}: the things left outside are weathering (${r.n} item${r.n === 1 ? "" : "s"}, ${kgText(r.kg)} kg; build storage)`, "warn");
    }
  }
  for (const f of state.factions || []) for (const h of Object.values(f.homes || {})) {
    if (!h || seen.has(h) || !h.armory || !h.armory.length) continue;
    seen.add(h);
    weatherOutside(state, h, wetDay(state, dayNumber, h.tile));
  }
}
