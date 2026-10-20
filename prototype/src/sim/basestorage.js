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
//      The AI groups' bases (groupbases.js) are measured the same way: their main base a hub, an outpost of theirs an
//      outpost, one still an outpost camp (groupworks.js isCamp) a camp. They build the storage below as you do
//      (groupworks.js storageWork).
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
// So the valuables are kept in and the cheap, heavy things (scrap, wood, building materials) are what lies outside.
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
import { BUILDINGS, isCamp, isShelter, tentOf } from "./buildings.js"; // call-time only (the import cycle)
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

// The tier as the base map reads it (basemap.js tierKey). A group's own base (groupbases.js: no tier field) is the hub or
// an outpost, or a camp while its outpost camp is not yet established (camp: groupworks.js isCamp; as your outpost camp,
// a tier-0 base with camp: true); a base of yours they took keeps its tier.
const groupCamp = (base) => !!base.group && base.tier == null && !!base.camp;
const tierOf = (base) => (isCamp(base) || groupCamp(base) ? "camp" : isShelter(base) ? "shelter" : base.type === "hub" ? "hub" : "outpost");
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

// Worth a kg of an armory item (an opened box: what is in it stays in it, first of all).
const itemDensity = (it, kg) => (isOpenBox(it) ? Infinity : kg > 0 ? itemValue(it) / kg : 0);
/** THE FILL's order: the densest first, supplies before items on a tie, then by key or armory order. */
export const byWorth = (a, b) => b.dens - a.dens || a.rank - b.rank || (a.sup && b.sup ? (a.sup < b.sup ? -1 : a.sup > b.sup ? 1 : 0) : (a.i || 0) - (b.i || 0));
/** Whether a supply key is a good that takes room (in SUPPLIES, has a weight; not water). @param {string} k */
export const storedKey = (k) => !NOT_STORED.has(k) && !!SUPPLIES[k] && supWeight(k) > 0;
/** The kg an armory item takes in the room (an opened box: only what is still in it). @param {any} it */
export const itemRoomKg = (it) => (!it || !GEAR[it.key] ? 0 : isOpenBox(it) ? Math.max(0, itemLoad(it) - itemKg(it)) : itemLoad(it));
/** A good of the fill: a supply stack ({ sup, q, unit }) or an armory item ({ i }), with its worth a kg. */
export const supGood = (k, q) => ({ sup: k, kg: q * supWeight(k), unit: supWeight(k), q, dens: supDensity(k), rank: 0 });
export const itemGood = (it, i) => { const kg = itemRoomKg(it); return { i, kg, unit: kg, q: 1, dens: itemDensity(it, kg), rank: 1 }; };
// Containers the goods can be assigned to by containers.js (item.store, base.bins): the core, a building, a parked car.
// An opened box is room but no assignable container: it is an item of the armory, and its index moves.
const ASSIGNABLE = new Set(["core", "building", "vehicle"]);

/**
 * The base's storage: its containers' room (cap, kg), all its goods' weight (used, kg: inside and outside), what lies
 * outside (outsideKg, and outside.sup units by key, outside.gear armory indices), the containers.
 * THE ASSIGNMENTS (containers.js, base building 2026-10-19): a good the player or the game put in a container
 * (item.store = its key; base.bins[key][supply] = whole units) fills that container first, up to its room, in THE
 * FILL's order within it (clamped to the books as it is read: a bin never counts more than the stock still holds,
 * earlier containers first; nothing is changed here). Each container then carries what it holds by assignment (sup,
 * gear: armory indices, kg). What is not assigned (and what an assignment could not fit) fills the room left over by
 * THE FILL, pooled over every container (loose: what lies inside wherever there is room), and the rest lies outside.
 * With nothing assigned this is THE FILL exactly.
 * @param {any} state @param {any} base
 * @returns {{ cap: number, used: number, inside: number, outsideKg: number, free: number,
 *   containers: { key: string, name: string, cap: number, kind: "core" | "building" | "vehicle" | "box", type: string, sup: Record<string, number>, gear: number[], kg: number }[],
 *   outside: { sup: Record<string, number>, gear: number[] }, loose: { sup: Record<string, number>, gear: number[], kg: number } }}
 */
export function storageOf(state, base) {
  /** @type {{ key: string, name: string, cap: number, kind: "core" | "building" | "vehicle" | "box", type: string, sup: Record<string, number>, gear: number[], kg: number }[]} */
  const containers = [];
  const out = { cap: 0, used: 0, inside: 0, outsideKg: 0, free: 0, containers, outside: { sup: /** @type {Record<string, number>} */ ({}), gear: /** @type {number[]} */ ([]) }, loose: { sup: /** @type {Record<string, number>} */ ({}), gear: /** @type {number[]} */ ([]), kg: 0 } };
  if (!base) return out;
  const tier = tierOf(base);
  const box = (key, name, cap, kind, type) => ({ key, name, cap, kind, type, sup: {}, gear: [], kg: 0 });
  if (CORE_KG[tier] > 0) containers.push(box("core", CORE_NAME[tier], CORE_KG[tier], "core", tier));
  for (const b of base.buildings || []) { const kg = b.type === "tent" ? tentOf(b).storeKg : buildingKg(b.type); if (kg > 0) containers.push(box(`b:${b.id}`, b.type === "tent" ? tentOf(b).name : BUILDINGS[b.type].name, kg, "building", b.type)); } // a tent keeps its kind's kg out of the weather (buildings.js TENTS)
  if (state && !base.group) for (const v of carsAtBase(state, base.id)) { const kg = vehicleStoreKg(v); if (kg > 0) containers.push(box(`v:${v.id}`, v.name, kg, "vehicle", v.type)); }
  const armory = base.armory || [];
  armory.forEach((it, i) => { if (it && isOpenBox(it) && boxKg(it) > 0) containers.push(box(`a:${i}`, it.name, boxKg(it), "box", it.key)); });
  out.cap = containers.reduce((a, c) => a + c.cap, 0);

  // The assigned goods into their containers (THE ASSIGNMENTS).
  const stock = base.stock || {};
  const have = (k) => { const q = stock[k]; return typeof q === "number" && q > EPS && storedKey(k) ? q : 0; };
  /** @type {Record<string, number>} */
  const asgUnits = {};
  const placed = new Set();
  const bins = base.bins && typeof base.bins === "object" ? base.bins : null;
  let held = 0;
  for (const c of containers) {
    if (!ASSIGNABLE.has(c.kind)) continue;
    const mine = [];
    const bin = bins && bins[c.key];
    if (bin && typeof bin === "object") for (const k of Object.keys(bin).sort()) {
      const n = Math.min(Math.floor(Number(bin[k]) || 0), Math.floor(have(k) - (asgUnits[k] || 0) + EPS));
      if (n > 0) mine.push(supGood(k, n));
    }
    armory.forEach((it, i) => { if (it && it.store === c.key && GEAR[it.key] && !isOpenBox(it) && !placed.has(i)) { const g = itemGood(it, i); if (g.kg > EPS) mine.push(g); } });
    mine.sort(byWorth);
    let room = c.cap, kg = 0;
    for (const g of mine) {
      if (g.sup) {
        const fit = Math.min(g.q, Math.floor((room + EPS) / g.unit));
        if (fit <= 0) continue;
        c.sup[g.sup] = fit; asgUnits[g.sup] = (asgUnits[g.sup] || 0) + fit;
        room -= fit * g.unit; kg += fit * g.unit;
      } else if (g.kg <= room + EPS) { c.gear.push(/** @type {number} */ (g.i)); placed.add(g.i); room -= g.kg; kg += g.kg; }
    }
    c.gear.sort((a, b) => a - b);
    c.kg = r1(kg);
    held += kg;
    out.used += kg;
  }

  // The rest, ranked (THE FILL), into the room left over.
  /** @type {{ sup?: string, i?: number, kg: number, unit: number, q: number, dens: number, rank: number }[]} */
  const goods = [];
  for (const k of Object.keys(stock)) {
    const q = have(k) - (asgUnits[k] || 0);
    if (q > EPS) goods.push(supGood(k, q));
  }
  armory.forEach((it, i) => {
    if (!it || !GEAR[it.key] || placed.has(i)) return;
    const g = itemGood(it, i);
    if (g.kg > EPS) goods.push(g);
  });
  goods.sort(byWorth);
  let room = Math.max(0, out.cap - held);
  for (const g of goods) {
    out.used += g.kg;
    if (g.sup) {
      const fit = Math.min(g.q, Math.floor((room + EPS) / g.unit));
      room -= fit * g.unit;
      if (fit > EPS) { out.loose.sup[g.sup] = Math.round(fit * 100) / 100; out.loose.kg += fit * g.unit; }
      const left = g.q - fit;
      if (left > EPS) { out.outside.sup[g.sup] = Math.round(left * 100) / 100; out.outsideKg += left * g.unit; }
    } else if (g.kg <= room + EPS) { room -= g.kg; out.loose.gear.push(/** @type {number} */ (g.i)); out.loose.kg += g.kg; }
    else { out.outside.gear.push(/** @type {number} */ (g.i)); out.outsideKg += g.kg; }
  }
  out.outside.gear.sort((a, b) => a - b);
  out.loose.gear.sort((a, b) => a - b);
  out.loose.kg = r1(out.loose.kg);
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
// What lies outside in words: "12 scrap, 40 wood, a fire axe" (the heaviest first, at most `max` of them).
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
