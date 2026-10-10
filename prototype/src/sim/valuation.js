// What things are worth to whom. Every good has a hidden base value (data.js SUPPLIES / GEAR value) that the player
// never sees: the trade window shows only what one group pays or charges (trade.js), other screens at most a rough
// worth tier (worthTier: junk, cheap, decent, valuable, rare). A price is
//
//   base worth × the group's kind (TRADE_PREFS) × the group's state (STATE_MODS) × how much of it they hold × spread
//
// - Base worth: itemValue for an item (base value × condition × uses left; a pack adds its contents), the base value
//   for a unit of supplies.
// - Kind: every category (data.js CATEGORIES, the item's cat) has a multiplier per kind of group, e.g. the military
//   prize automatic weapons (1.5) and electronics (1.5) and care little for drugs (0.4); zealots refuse liquor,
//   drugs and cigarettes (0: no deal either way). Traders and merchants from outside add a margin to what they charge.
// - State, from the live world only (no dice): at war, hordes near their bases (or a horde attack in the last 14
//   days), raided lately (10 days) or a base lost (20 days), sickness in their camp (8 days in some 30-day spells:
//   15%, 30% in winter, by a hash of the group and the spell), the season, starving or thirsty, rich or poor (supplies
//   per head). The product of these is held to 0.35–2.6.
// - Holdings: supplies follow the stock-per-head curve (trade.js need), and starving or thirsty groups pay up to 60%
//   more again for food or water as their stock runs out. Gear follows what they already hold of it: each piece of
//   the same category on their shelf (their wares, or their caravan's goods; books and manuals by title) lowers what
//   they pay for the next one, from 1.15 with none down to 0.25 (gearNeed). Every unit of a deal is priced at the
//   holding halfway through it, so selling something and buying it back always loses (the spread decides it).
// Effects that depend on a group's supplies (starving, rich, poor) apply only to gear, so trading supplies never
// moves the price of the same supplies through them.
import { SUPPLIES, GEAR, CATEGORIES, TRADE_PREFS, FACTION_TYPES } from "./data.js";
import { day } from "./world.js";
import { season } from "./weather.js";
import { hash01 } from "./skills.js";
import { itemDur, itemDurMax } from "./crafting.js";
import { isRoundItem, isBulk, loadsOf, countOf } from "./itemstack.js"; // stacks: n of a consumable, rounds past one box, a bulk container's rounds

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- categories ----------
// The trade category of a gear key: its cat, else a guess from the def (so untagged new items still trade sensibly).
export function itemCat(key) {
  const d = GEAR[key];
  if (!d) return SUPPLIES[key] ? SUPPLIES[key].cat || key : "tools";
  if (d.cat && CATEGORIES[d.cat]) return d.cat;
  if (d.blueprint) return "manuals";
  if (d.book) return d.book.skill ? "books" : "luxury";
  if (d.valuable) return "collectibles";
  if (d.throw) return "explosive";
  if (d.medKit) return "medical";
  if (d.slot === "backpack") return "packs";
  if (["armor", "head", "arms", "legs"].includes(d.slot)) return "armor";
  if (d.slot === "weapon") return d.noise ? (d.power >= 6 ? "automatic" : d.power >= 4 ? "rifle" : "pistol") : "melee";
  return "tools";
}
// The category of a supply key or a gear key.
export const catOf = (key) => (SUPPLIES[key] ? SUPPLIES[key].cat || key : itemCat(key));
export const catName = (cat) => (CATEGORIES[cat] ? CATEGORIES[cat].name : cat);
const isFine = (cat) => !!(CATEGORIES[cat] && CATEGORIES[cat].fine);
const WEAPON_CATS = ["melee", "pistol", "shotgun", "rifle", "automatic", "bow", "explosive", "gunmod"];

// ---------- hidden worth ----------
// Base value × condition (0.2 + 0.8 × quality) × uses left (gear that wears: 0.3 + 0.7 × uses left / full uses); a pack
// adds its contents, a gun its fitted attachments.
export function itemValue(item) {
  const d = item && GEAR[item.key];
  if (!d) return 0;
  const q = clamp(Number.isFinite(item.quality) ? item.quality : 1, 0, 1.5);
  const dur = itemDur(item);
  // A count stack (GEAR count: true: a box of rounds, primers...) is worth its share left; wear costs at most 70%.
  // A stack of boxes or loose rounds (itemstack.js) is worth its rounds: no cap at one box.
  const durF = dur == null ? 1 : d.count ? (isRoundItem(item) ? Math.max(0, dur / d.dur) : clamp(dur / d.dur, 0, 1)) : 0.3 + 0.7 * clamp(dur / itemDurMax(item), 0, 1);
  let v = d.value * (0.2 + 0.8 * q) * durF * countOf(item); // a stack of a consumable: n of it
  if (isBulk(item)) for (const l of loadsOf(item)) if (l) v += itemValue(l); // a bulk ammo container: its rounds
  // A maximum lowered by repairs (repair.js: item.durBase, the maximum before the first) sells low: × 0.4 at none left.
  if (item.durBase > 0 && dur != null) v *= 0.4 + 0.6 * clamp(itemDurMax(item) / item.durBase, 0, 1);
  if (Array.isArray(item.contents)) for (const c of item.contents) if (c) v += itemValue(c);
  if (item.mods) for (const m of Object.values(item.mods)) if (m) v += itemValue(m); // a gun's fitted attachments (gunmods.js) sell with it
  if (item.inserts) for (const p of Object.values(item.inserts)) if (p) v += itemValue(p); // a plate carrier's plates (section 16)
  return v;
}
// What the player sees outside a trade: a rough tier, never a number.
export const WORTH_TIERS = [[4, "junk"], [12, "cheap"], [35, "decent"], [90, "valuable"], [Infinity, "rare"]];
export function worthTier(item) {
  const v = itemValue(item);
  for (const [lim, name] of WORTH_TIERS) if (v < lim) return name;
  return "rare";
}

// ---------- the kind of group ----------
// The price profile: a group's type, or for outsiders (visitors.js) merchants / explorers / raiders.
export function profileOf(f) {
  if (f && f.outsider) return f.kind === "merchants" ? "merchants" : f.kind === "explorers" ? "explorers" : "raider";
  return (f && f.type) || "traders";
}
export const PROFILE_LABEL = { merchants: "Merchants from outside", explorers: "Travellers" };
export const profileLabel = (f) => PROFILE_LABEL[profileOf(f)] || (FACTION_TYPES[profileOf(f)] || {}).label || "They";
export function typePref(f, cat) {
  const t = TRADE_PREFS[profileOf(f)] || {};
  return t[cat] ?? t["*"] ?? 1;
}
export const margin = (f) => (TRADE_PREFS[profileOf(f)] || {}).margin || 1;
export const refuses = (f, key) => typePref(f, catOf(key)) === 0;

// ---------- the state they are in ----------
export const HORDE_NEAR = 5, HORDE_SIZE = 20, HORDE_DAYS = 14, RAIDED_DAYS = 10, LOST_BASE_DAYS = 20;
export const SICK = { cycle: 30, days: 8, chance: 0.15, winter: 0.3 };
const hordeCache = new WeakMap();
function hordeNear(state, f) {
  const hordes = state.hordes || [];
  const c = hordeCache.get(f);
  if (c && c.hour === state.hour && c.n === hordes.length && c.b === f.bases.length) return c.v;
  let sum = 0;
  const g = state.grid;
  if (g && f.bases && f.bases.length) for (const h of hordes) if (f.bases.some((b) => g.distance(b, h.tile) <= HORDE_NEAR)) sum += h.size || 0;
  hordeCache.set(f, { hour: state.hour, n: hordes.length, b: f.bases.length, v: sum });
  return sum;
}
export function groupSick(state, f) {
  if (!f || f.outsider || !(f.pop > 0)) return false;
  // By the group's name (ids depend on what else was made in the process; names come from the seed).
  const d = day(state) + Math.floor(hash01(state.seed ?? 0, "sickphase", f.name) * SICK.cycle);
  if (d % SICK.cycle >= SICK.days) return false;
  return hash01(state.seed ?? 0, "groupsick", f.name, Math.floor(d / SICK.cycle)) < (season(state).key === "winter" ? SICK.winter : SICK.chance);
}
const perHead = (f, key) => Math.max(0, (f.stock && f.stock[key]) || 0) / Math.max(1, f.pop || 1);
const wealthOf = (f) => Object.keys(SUPPLIES).reduce((a, k) => a + Math.max(0, (f.stock && f.stock[k]) || 0) * SUPPLIES[k].value, 0) / Math.max(1, f.pop || 1) / 50;
// Everything about their situation that moves prices: { war, hordes, raided, lostBase, sick, season, winterSoon,
// starving, thirsty, rich, poor }.
export function conditions(state, f) {
  const today = day(state);
  const s = season(state);
  const wealth = wealthOf(f);
  return {
    war: !!f.atWar,
    hordes: hordeNear(state, f) >= HORDE_SIZE || (f.hordeHitDay != null && today - f.hordeHitDay <= HORDE_DAYS),
    lostBase: f.lostBaseDay != null && today - f.lostBaseDay <= LOST_BASE_DAYS,
    raided: f.hitDay != null && today - f.hitDay <= RAIDED_DAYS,
    sick: groupSick(state, f),
    season: s.key,
    winterSoon: s.key === "autumn" && s.daysLeft <= 10,
    starving: perHead(f, "food") + perHead(f, "preserved") < 2,
    thirsty: f.stock && f.stock.water != null && perHead(f, "water") < 1.5,
    rich: wealth >= 1.6 && !f.atWar,
    poor: wealth < 0.6,
  };
}

// The state modifiers: when (from conditions), the multiplier per category, and what the trade window says.
// gearOnly: the effect depends on their supplies, so it moves gear prices only (see the header).
const W = (m) => Object.fromEntries(WEAPON_CATS.map((c) => [c, m]));
const FINE = (m) => Object.fromEntries(Object.keys(CATEGORIES).filter(isFine).map((c) => [c, m]));
export const STATE_MODS = [
  { key: "war", when: (c) => c.war, cats: { ...W(1.3), armor: 1.3, defence: 1.3, ammo: 1.35, medical: 1.35, ...FINE(0.85) }, up: "At war: {c} wanted", down: "At war: no time for {c}" },
  { key: "hordes", when: (c) => c.hordes, cats: { ...W(1.2), ammo: 1.25, armor: 1.15, defence: 1.4 }, up: "Hordes at their walls: {c} wanted" },
  { key: "lostBase", when: (c) => c.lostBase, cats: { ...W(1.25), ammo: 1.15, armor: 1.2, defence: 1.4, ...FINE(0.75) }, up: "Lost a base lately: {c} wanted", down: "Lost a base lately: selling off {c}" },
  { key: "raided", when: (c) => c.raided && !c.lostBase, cats: { ...W(1.15), armor: 1.15, defence: 1.3, ...FINE(0.85) }, up: "Raided lately: {c} wanted", down: "Raided lately: selling off {c}" },
  { key: "sick", when: (c) => c.sick, cats: { medical: 1.5 }, up: "Sickness in their camp: {c} wanted" },
  { key: "winter", when: (c) => c.season === "winter", cats: { fuel: 1.4, firewood: 1.5, clothing: 1.4, food: 1.15, camp: 0.85 }, up: "Winter: {c} wanted", down: "Winter: no use for {c}" },
  { key: "winterSoon", when: (c) => c.winterSoon, cats: { fuel: 1.25, firewood: 1.35, clothing: 1.25, food: 1.1 }, up: "Winter is coming: {c} wanted" },
  { key: "harvest", when: (c) => c.season === "autumn" && !c.winterSoon, cats: { containers: 1.25, food: 0.9 }, up: "Harvest time: {c} wanted", down: "Harvest time: plenty of {c}" },
  { key: "summer", when: (c) => c.season === "summer", cats: { water: 1.2, camp: 1.3, clothing: 0.8, firewood: 0.7 }, up: "Summer heat: {c} wanted", down: "Summer heat: no use for {c}" },
  { key: "spring", when: (c) => c.season === "spring", cats: { farming: 1.4 }, up: "Planting season: {c} wanted" },
  { key: "starving", when: (c) => c.starving, gearOnly: true, cats: { ...FINE(0.6), household: 0.85 }, down: "Starving: they cannot eat {c}" },
  { key: "rich", when: (c) => c.rich, gearOnly: true, cats: FINE(1.2), up: "Rich and at peace: they pay well for {c}" },
  { key: "poor", when: (c) => c.poor, gearOnly: true, cats: FINE(0.8), down: "Poor: little to spare for {c}" },
];
export const STATE_CLAMP = [0.35, 2.6];

// Their kind and state for one category: { pref, state (the state product, clamped), mult (pref × state),
// refused, notes: [{ text, m }] } (notes: biggest effect first, only those of 10% or more). gear: pricing an item.
export function priceInfo(state, f, cat, gear = false) {
  const pref = typePref(f, cat);
  const notes = [];
  const name = catName(cat);
  const label = profileLabel(f);
  const t = TRADE_PREFS[profileOf(f)] || {};
  if (pref === 0) notes.push({ text: `${label}: they will not touch ${name}`, m: 0 });
  else if (t[cat] != null && Math.abs(Math.log(pref)) >= Math.log(1.1)) notes.push({ text: pref > 1 ? `${label}: ${name} prized` : `${label}: little use for ${name}`, m: pref });
  let st = 1;
  const c = conditions(state, f);
  for (const mod of STATE_MODS) {
    const m = mod.cats[cat];
    if (m == null || m === 1 || (mod.gearOnly && !gear) || !mod.when(c)) continue;
    st *= m;
    const tmpl = m > 1 ? mod.up : mod.down;
    if (tmpl) notes.push({ text: tmpl.replace("{c}", name), m });
  }
  st = clamp(st, STATE_CLAMP[0], STATE_CLAMP[1]);
  notes.sort((a, b) => (a.m === 0 ? -1 : b.m === 0 ? 1 : Math.abs(Math.log(b.m)) - Math.abs(Math.log(a.m))));
  return { pref, state: st, mult: pref * st, refused: pref === 0, notes: notes.filter((n) => n.m === 0 || Math.abs(Math.log(n.m)) >= Math.log(1.1)) };
}

// ---------- holdings ----------
// Starving or thirsty: food (and preserved food) or water cost up to 60% more again as their stock runs out. stock =
// their stock of this key at the point of the deal (the rest of their food counts as it is).
export function starveBoost(f, key, stock) {
  const cat = SUPPLIES[key] && SUPPLIES[key].cat;
  const pop = Math.max(1, f.pop || 1);
  if (cat === "food") {
    const other = key === "food" ? "preserved" : "food";
    const e = (Math.max(0, stock) + Math.max(0, (f.stock && f.stock[other]) || 0)) / pop;
    return 1 + 0.6 * clamp((2 - e) / 2, 0, 1);
  }
  if (key === "water") return 1 + 0.6 * clamp((1.5 - Math.max(0, stock) / pop) / 1.5, 0, 1);
  return 1;
}
// Gear: pieces per head at which a group is comfortable with a category.
export const GEAR_REF = { pistol: 0.25, shotgun: 0.2, rifle: 0.25, automatic: 0.15, melee: 0.3, bow: 0.1, explosive: 0.2, armor: 0.4, medical: 0.1, packs: 0.2, tools: 0.15, books: 0.04, manuals: 0.04, electronics: 0.06 };
// 1.15 with none on their shelf, falling 0.5 per comfortable amount, at least 0.25 (a group that is full up).
export function gearNeed(f, cat, held) {
  const ref = Math.max(1, Math.max(1, f.pop || 1) * (GEAR_REF[cat] ?? 0.15));
  return clamp(1.15 - (0.5 * Math.max(0, held)) / ref, 0.25, 1.15);
}
// How many pieces like this one they hold (their shelf or caravan): same category, or same title for books.
export function heldLike(item, pool) {
  const cat = itemCat(item.key);
  const byKey = CATEGORIES[cat] && CATEGORIES[cat].stockBy === "key";
  let n = 0;
  for (const g of pool || []) if (g && (byKey ? g.key === item.key : itemCat(g.key) === cat)) n++;
  return n;
}

// ---------- what the trade window says about a group ----------
// Their situation in a few words (only what moves prices).
export function situation(state, f) {
  const c = conditions(state, f);
  const out = [];
  if (c.war) out.push("at war");
  if (c.hordes) out.push("hordes near their walls");
  if (c.lostBase) out.push("lost a base lately");
  else if (c.raided) out.push("raided lately");
  if (c.sick) out.push("sickness in their camp");
  if (c.starving) out.push("starving");
  if (c.thirsty) out.push("short of water");
  if (c.season === "winter") out.push("winter");
  else if (c.winterSoon) out.push("winter is coming");
  else if (c.season === "summer") out.push("summer heat");
  else if (c.season === "spring") out.push("planting season");
  else if (c.season === "autumn") out.push("harvest time");
  if (c.rich) out.push("rich");
  if (c.poor) out.push("poor");
  return out;
}
// What their kind prizes, shuns and refuses (category names, strongest first).
export function tastes(f) {
  const t = TRADE_PREFS[profileOf(f)] || {};
  const e = Object.entries(t).filter(([k]) => CATEGORIES[k]);
  return {
    likes: e.filter(([, v]) => v >= 1.25).sort((a, b) => b[1] - a[1]).map(([k]) => catName(k)),
    dislikes: e.filter(([, v]) => v > 0 && v <= 0.7).sort((a, b) => a[1] - b[1]).map(([k]) => catName(k)),
    refuses: e.filter(([, v]) => v === 0).map(([k]) => catName(k)),
    dear: margin(f) > 1,
  };
}
