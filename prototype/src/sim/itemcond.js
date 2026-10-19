// @ts-check
// The condition of a found or bought item: one roller for every piece of loot and every trader's stock.
//
// What an item IS comes from where it was found (a site's gear list, a raid container, a body's kit, a trader's ware
// list: those tables live with their sources). How GOOD it is comes from here: rollCondition gives it a quality
// (item.quality, the condition the trade window shows and itemValue prices: valuation.js) and the uses left
// (item.dur of its full GEAR dur) from the kind of place it came from (COND_SOURCES). A gun shop's stock is good but
// picked over, a burned-out wreck's is scorched, a soldier's rifle was looked after, a raider's was not.
//
// Dice: a hash of the roll in hand (an Rng's position, a number 0–1 from a hash of its own, or a list of parts) and
// the item. It never draws from an Rng, so making loot with it moves none of the world's random numbers. Where a
// creation point used to draw a quality from the world's dice (rng.pick of a few qualities), it still spends that
// draw (spend) so everything after it stays where it was.
//
// Not rolled: books and blueprints (paper: quality 1, no wear); counts (tablets, toiletries, a box of rounds: what is
// left, not wear); consumables (drink, smokes, treats, household goods, throwables) and valuables keep quality 1 and
// roll no wear. Crafted items keep the crafting roll (crafting.js makeItem). Starting and recruit gear is not loot
// (inventory.js START_DUR).
import { GEAR } from "./data.js";
import { YEAR_DAYS } from "./eras.js"; // the game year (112 days); eras.js imports nothing

// q: quality range; d: uses left as a share of full. name: what the source is (the report table, tools/itemcondtest.js).
// boxed (optional): { p, q, d }: a share p of the finds roll from these ranges instead (a sealed box at the back).
// Shops: the stock sat for months behind broken windows, rained on, knocked off the shelves and picked over by every
// looter before you; what is left is good but used (quality 50–88%, uses 45–85%), now and then (6%) something still
// boxed (92–102%, 90–100%). Their edge is how much they hold and what kinds (the gear lists), not the condition: a
// military crate or a soldier's kit is kept better. (Before: 80–105% and 80–100%, better than the Army's own.)
export const SHOP = { q: [0.5, 0.88], d: [0.45, 0.85], boxed: { p: 0.06, q: [0.92, 1.02], d: [0.9, 1] } };
export const COND_SOURCES = {
  military: { name: "Military crates and trucks", q: [0.75, 1], d: [0.6, 1] },
  gunsafe:  { name: "Gun safes and gun cages", q: [0.75, 1], d: [0.7, 1] },
  police:   { name: "Police and prisons", q: [0.7, 1], d: [0.5, 1] },
  shop:     { name: "Shops (picked-over stock)", ...SHOP },
  // Homes: as picked over as the shops (quality 50–90%, uses 40–90%; before 60–100% and 40–100%): what people left
  // behind when they ran, and every looter since.
  home:     { name: "Homes", q: [0.5, 0.9], d: [0.4, 0.9] },
  site:     { name: "Workplaces, farms, the outdoors", q: [0.55, 1], d: [0.3, 1] },
  wreck:    { name: "Wrecks and burned sites", q: [0.4, 0.8], d: [0.15, 0.6] },
  // Bodies, by kit (combat.js KITS; KIT_SOURCE). Professionals look after their kit: a soldier's (and a hired
  // contractor's) rifle is cleaned and its worn parts swapped, so its uses left start at 55% (typically 65–85%); a
  // guard's (and a caravan escort's) at 45%. Everyone else's runs from 25%. The battle path takes the same ranges
  // (gunfire.js enemyGunQ / enemyGunCond: the looted gun keeps the condition it fought in), and so do fights by the
  // numbers (conflicts.js, wanderers.js, escorts.js guardGear) and the groups' arsenals (arsenal.js starterKit).
  soldier:  { name: "Soldiers' and contractors' bodies", q: [0.7, 0.95], d: [0.55, 0.95] },
  guard:    { name: "Guards' and escorts' bodies", q: [0.6, 0.9], d: [0.45, 0.9] },
  fighter:  { name: "Fighters' bodies", q: [0.55, 0.9], d: [0.25, 0.9] },
  militia:  { name: "Militia bodies", q: [0.5, 0.9], d: [0.25, 0.9] },
  raider:   { name: "Raiders' and zealots' bodies", q: [0.45, 0.85], d: [0.25, 0.9] },
  survivor: { name: "Survivors' bodies and the dead's pockets", q: [0.4, 0.8], d: [0.25, 0.9] },
  // The armoured dead (deadsoldiers.js MILDEAD.BODY): quality from their own table (opts.quality); this q only as a fallback.
  armoured: { name: "The armoured dead's gear", q: [0.3, 0.7], d: [0.2, 0.7] },
  // Traders.
  merchant:     { name: "Merchants from outside", q: [0.6, 1], d: [0.5, 1] },
  trader:       { name: "Group traders", q: [0.55, 1], d: [0.45, 1] },
  traderMil:    { name: "Military remnant traders", q: [0.75, 1], d: [0.6, 1] },
  traderRaider: { name: "Raider and zealot traders", q: [0.45, 0.85], d: [0.3, 0.9] },
  traveller:    { name: "Travellers' packs", q: [0.5, 0.9], d: [0.35, 0.95] },
};

// ---------- the years since the fall (shops and homes keep getting worse) ----------
// Shops and homes lie open to the weather: the longer since the fall, the worse what is left in them. Their ranges (q,
// d above) hold through the first year and a half since the fall (FROM: a normal game's year 1, which starts
// NORMAL_FALL days after the fall); then they slide, a little every year, to the floor ranges (SOURCES) reached FULL
// years after the fall (late in a normal game's year 8). Boxed finds keep their own ranges (a sealed box keeps), only the
// main ranges slide. Locked storage, military crates and bodies do not age (their owners kept them, or the lock did).
// In years since the fall: a normal game's day 1 is NORMAL_FALL days after it (the middle of a hardcore run's 56–112
// days to the normal start: hardcore-outbreak.js ERA_OFFSET); a hardcore run starts on the day of the fall itself, so
// its first year (the outbreak spreading) counts from its own day 1.
// How far along, at the start of each game year (normal game): year 1 0, year 2 2%, year 3 16%, year 5 45%, year 7 73%,
// year 8 88%, the floor from late in year 8 (day ~870). A hardcore run's day N is a normal game's day N − 84 here.
export const COND_AGE = {
  FROM: 1.5, FULL: 8.5, NORMAL_FALL: 84,
  SOURCES: {
    shop: { q: [0.35, 0.72], d: [0.3, 0.7] }, // from 50–88% and 45–85%
    home: { q: [0.35, 0.75], d: [0.3, 0.75] }, // from 50–90% and 40–90%
  },
};
// The world's age in years since the fall, for the roller (it has no state to hand: set by world.js every hour, at
// createWorld and on load: noteLootAge). A tool rolling loot with no world sets it itself (setLootAge).
let LOOT_AGE = 0;
export const setLootAge = (years) => { LOOT_AGE = Math.max(0, Number(years) || 0); return LOOT_AGE; };
export const lootAge = () => LOOT_AGE;
export function lootAgeOf(state) {
  if (!state || !Number.isFinite(state.hour)) return 0;
  const days = Math.floor(state.hour / 24) + (state.mode === "hardcore" ? 0 : COND_AGE.NORMAL_FALL);
  return days / YEAR_DAYS;
}
export const noteLootAge = (state) => setLootAge(lootAgeOf(state));
// How far a source has slid to its floor (0–1) at an age in years since the fall.
export const ageShare = (years) => Math.max(0, Math.min(1, (years - COND_AGE.FROM) / (COND_AGE.FULL - COND_AGE.FROM)));
// A source's ranges at an age: its own, slid toward its floor.
export function agedSource(source, years = LOOT_AGE) {
  const S = COND_SOURCES[source] || COND_SOURCES.site;
  const F = COND_AGE.SOURCES[source], t = F ? ageShare(years) : 0;
  if (!t) return S;
  const mix = (a, b) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return { ...S, q: mix(S.q, F.q), d: mix(S.d, F.d) };
}

// Where a source comes from. A site type (data.js LOCATIONS), anything not listed: "site".
export const SITE_SOURCE = {
  military: "military", airdrop: "military", convoy: "military",
  police: "police", prison: "police",
  gunstore: "shop", hardware: "shop", mall: "shop", pharmacy: "shop", supermarket: "shop", grocery: "shop", feedstore: "shop",
  town: "home", city: "home", apartments: "home", motel: "home", farm: "home", ranch: "home", cabin: "home",
  house: "home", neighbourhood: "home", corner: "shop", pizza: "shop", farmstand: "shop", // points of interest (pois.js)
  crashsite: "wreck", crash_mil: "wreck", crash_cargo: "wreck", crash_med: "wreck", crash_news: "wreck",
};
// A raid container's area type (combat.js AREAS); an armoury goes by its site (a police or a military one).
export const AREA_SOURCE = {
  house: "home", farmhouse: "home", kitchen: "home", lockers: "home", cabin: "home",
  store: "shop", pharmacy: "shop", gunshop: "shop",
  barracks: "military", motorpool: "military", cargodrop: "military",
  cellblock: "police", control: "police",
  wreck: "wreck", roadcars: "wreck", milwreck: "wreck", medwreck: "wreck", newswreck: "wreck", fuselage: "wreck",
};
// A locked container's contents (locks.js LOCK_LOOT by lock kind).
export const LOCK_SOURCE = {
  cash: "home", gear: "site", meds: "shop", evidence: "police", cargo: "site", guns: "gunsafe", safe: "gunsafe",
  crash: "military", miltruck: "military", car: "home",
};
// A body by its kit (combat.js KITS).
export const KIT_SOURCE = { soldiers: "soldier", contractors: "soldier", guards: "guard", escorts: "guard", fighters: "fighter", militia: "militia", raiders: "raider", zealots: "raider", survivors: "survivor", looters: "raider", survivalists: "militia", preppers: "fighter", drifters: "survivor" };
// A group's trader by its type (data.js FACTION_TYPES).
export const TRADER_SOURCE = { military: "traderMil", raider: "traderRaider", zealot: "traderRaider" };

export const siteSource = (type) => SITE_SOURCE[type] || "site";
export function areaSource(area, site = null) {
  if (area === "armory") return site === "military" ? "military" : "police";
  return AREA_SOURCE[area] || (site ? siteSource(site) : "site");
}
// A gun store's gun cages and safes (site "gunstore"): the military's range, not the gun safe's. The lock is still
// worth opening (better than the shop floor), but a store's back room does not beat the Army's own crates.
export const GUNSTORE_LOCKED = "military";
export const lockSource = (loot, site = null) => { const s = LOCK_SOURCE[loot] || "site"; return s === "gunsafe" && site === "gunstore" ? GUNSTORE_LOCKED : s; };
export const kitSource = (kit) => KIT_SOURCE[kit] || "survivor";
export const traderSource = (type) => (type === "merchants" ? "merchant" : TRADER_SOURCE[type] || "trader");

// ---------- what rolls ----------
const NO_QUALITY_CATS = new Set(["smokes", "liquor", "treats", "household", "books", "manuals", "luxury", "collectibles", "jewelry", "explosive", "food", "ammo", "toiletries"]);
export const isPaper = (key) => { const d = GEAR[key]; return !!(d && (d.book || d.blueprint)); };
// Has a condition worth rolling (weapons, armour, packs, tools, kit): not paper, counts, consumables or valuables.
export function rollsQuality(key) {
  const d = GEAR[key];
  return !!d && !d.book && !d.blueprint && !d.count && !d.tabs && !d.groom && !d.throw && !d.valuable && !NO_QUALITY_CATS.has(d.cat);
}
// Wears by use (its uses left are rolled): the same rule as inventory.js newItem.
export const rollsWear = (key) => { const d = GEAR[key]; return !!(d && d.dur && !d.tabs && !d.groom && !d.count); };

// ---------- the dice ----------
function mix01(...parts) {
  let h = 2166136261 >>> 0;
  for (const c of parts.join("|")) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
/** @param {any} roll an Rng (its position), a number, a string or a list of parts */
const rollBase = (roll) => (roll && typeof roll === "object" && !Array.isArray(roll) && "state" in roll ? `r${roll.state}` : Array.isArray(roll) ? roll.join(":") : String(roll));
const lerp = ([a, b], u) => a + (b - a) * u;
const r2 = (v) => Math.round(v * 100) / 100;

// The condition one item gets from a source: { quality, dur } (dur: uses left, or null for an item that does not
// wear). opts.quality: a quality fixed by the caller (the armoured dead's own table), only the wear is rolled.
// opts.age: years since the fall (else the world's: noteLootAge); shops and homes slide with it (COND_AGE).
/** @param {string} key @param {string} source @param {any} roll @param {{ quality?: number, age?: number }} [opts] */
export function rollCondition(key, source, roll, opts = {}) {
  const d = GEAR[key];
  if (!d) return null;
  const S0 = agedSource(source, opts.age != null ? opts.age : LOOT_AGE);
  const base = rollBase(roll);
  const S = S0.boxed && mix01(base, key, source, "box") < S0.boxed.p ? S0.boxed : S0; // a boxed one (shops): its own ranges
  const quality = opts.quality != null ? opts.quality : rollsQuality(key) ? r2(lerp(S.q, mix01(base, key, source, "q"))) : 1;
  const dur = rollsWear(key) ? Math.max(1, Math.round(d.dur * lerp(S.d, mix01(base, key, source, "d")))) : d.dur ? d.dur : null;
  return { quality, dur };
}

// Gives an item (made by inventory.js newItem) its condition from a source, in place. Returns the item.
const ROLLED = new WeakSet(); // tools/itemcondtest.js: every piece of loot passed through here
/** @param {any} item @param {string} source @param {any} roll @param {{ quality?: number, age?: number }} [opts] */
export function condition(item, source, roll, opts = {}) {
  const c = item && rollCondition(item.key, source, roll, opts);
  if (!c) return item;
  item.quality = c.quality;
  if (c.dur != null && item.dur != null) item.dur = c.dur;
  ROLLED.add(item);
  return item;
}
export const condRolled = (item) => !!item && ROLLED.has(item);
// A crafted item's condition came from its maker's quality roll (crafting.js craftRoll), yours or a group's.
export const craftedCond = (item) => { if (item && typeof item === "object") ROLLED.add(item); return item; };

// A draw a creation point used to make for the quality, still taken so the rest of the world's dice stay put.
/** @param {{ next: () => number }} rng */
export function spend(rng, n = 1) {
  for (let i = 0; i < n; i++) rng.next();
  return rng;
}

// ---------- in words ----------
export const QUALITY_WORDS = [[0.5, "poor"], [0.7, "worn"], [0.88, "good"], [1, "fine"], [Infinity, "excellent"]];
export function qualityWord(q) {
  const v = Number.isFinite(q) ? q : 1;
  for (const [lim, w] of QUALITY_WORDS) if (v < lim) return w;
  return "excellent";
}
