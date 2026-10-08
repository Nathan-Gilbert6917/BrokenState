// Barter with AI groups. One price model for every trade: visits by your teams (and trade caravans), their
// caravans at your gates, deals made over the radio (radio.js) and trade routes.
//
// Price model (the worth of things to each group: valuation.js, whose header has the numbers)
// - Every good has a hidden base value (data.js) that the player never sees: the trade window shows what this
//   group pays or charges and why ("At war: rifles wanted"), other screens at most a worth tier.
// - Gear: itemValue(item) = base value (data.js GEAR) × quality factor (0.2 + 0.8 × condition) × durability factor
//   (gear that wears, data.js GEAR dur / GEAR_DUR: 0.3 + 0.7 × uses left / full uses; gear that does not wear counts 1). A pack adds its contents.
//   Then × the group's kind and state for its category (valuation.js priceInfo) × how much like it they hold
//   (gearNeed: their shelf; each piece in a deal priced at the holding halfway through it).
// - Supplies: base value (data.js SUPPLIES) × the group's need for it (their stock per head against a reference:
//   0.5 when they have plenty, up to 2.2 when they have none; food and water up to 60% more again when they starve
//   or thirst) × their kind and state. Every unit of a deal is priced along that curve:
//   q units are priced at the stock level halfway through the deal (stock + q/2 when they buy, stock − q/2 when
//   they sell), so a big sale pays less per unit and selling something then buying it back always loses.
// - Spread: they pay you value × (0.75 + Speech bonus + goodwill bonus) and charge you value × (1.3 − both)
//   (× a margin for traders and merchants from outside: they sell dear).
//   Speech bonus = 0.008 per point of your best Speech (up to 0.12), goodwill bonus = goodwill / 1000 (−0.1 … +0.1),
//   so what they charge is always more than what they pay for the same thing.
// - Refusals: a group never deals in a category its kind refuses (zealots: liquor, drugs, cigarettes).
// - Buying from one group and selling to another can pay (that is what trade routes are for), but every sale moves
//   the buyer's stock or shelf, so the margin shrinks with each unit.
// - A deal is fair for them when what you give, at their buying price, is worth at least what you take, at
//   their selling price. Deals agreed over the radio are honoured at the agreed amounts.
// - Goodwill from trading grows with the deal's size and with what you overpay, at most 4 a day per group (the old
//   flat +1 per trade could be farmed with tiny deals). Gifts give up to 15 a day.
import { SUPPLIES, SUPPLY_KEYS, GEAR, supplyFew } from "./data.js";
import { log, day, newId, survivorById, factionById, baseById, atBase, skill, snapshot, mergeKnowledge } from "./world.js";
import { partyMembers, partyTile, bestSkill, awaitOrders, partyCapacity, cargoLoad, cargoRoom } from "./parties.js";
import { attitude, changeGoodwill, isAggressiveType } from "./factions.js";
import { ransomOnTradeCard } from "./conflicts.js";
import { itemLoad, lootItem } from "./inventory.js";
import { traderSource, spend } from "./itemcond.js"; // the condition of what they sell, by the kind of group
import { gunmodWares, pickWeighted } from "./loot.js"; // a gun attachment on the table now and then
import { itemValue, itemCat, catOf, catName, priceInfo, starveBoost, gearNeed, heldLike, margin, refuses } from "./valuation.js";
import { canRadioGroup, radioGreet } from "./radio.js";
import { caravanCard } from "./caravans.js";
import { tradeSpeech, bookWares, gainXp, USE, hash01 } from "./skills.js";
import { armsSold } from "./diplomacy.js";
import { visitorTradeContext, resumeVisitorTrade } from "./visitors.js";
import { RAW, keyWord } from "./water.js";
import { isRoundKey, totalRounds, ROUND_KEYS, roundOf, spendAmmo } from "./rounds.js"; // rounds by calibre
import { kindShare, kindTheme, expandAmmo, partyCals, baseCals, wantedKey, dealRounds } from "./ammo.js";
import { radioTradeContext, radioTradeProblem, bookRadioTrade, matchGear, sameGear } from "./radiotrade.js"; // the trade window over the radio
import { intoArsenalFromShelf, shelfSurplus } from "./arsenal.js"; // group arsenals: the guns you sell them they use; their surplus is for sale

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- item and supply values ----------
// The hidden worth of an item (valuation.js): base value × condition × uses left; a pack adds its contents.
export { itemValue };

// Stock per head at which a group is comfortable (need 1 at the reference, 0.5 at 1.5× it, 2.2 at none).
// Preserved food (storage.js) keeps, so every group wants some; jars matter only to those who preserve. Firewood
// (woodcutting.js): groups cut their own; the seasons move its price (valuation.js: dear in winter, cheap in summer).
// Arrows (hunting.js): groups fletch their own and keep them (comfortable, none to spare) until they hold more.
const REF = { food: 6, water: 5, fuel: 2, meds: 1, ammo: 10, arrows: 2, parts: 0.5, scrap: 3, preserved: 2, jars: 1, wood: 120, carparts: 0.5, gunparts: 0.5, electronics: 0.5, brass: 5, powder: 3, primers: 3, blackpowder: 1, matchprimers: 1 }; // reloading.js: the bench's inputs (cases, charges, primers); wood: 12 kg a head; the part kinds are priced by the group's one count of parts
// Per head a group never sells: it keeps this much for itself.
const RESERVE = { food: 2, water: 1.5, fuel: 0.5, meds: 0.3, ammo: 3, arrows: 2, parts: 0, scrap: 0, preserved: 0.5, jars: 0, wood: 60, carparts: 0, gunparts: 0, electronics: 0, brass: 0, powder: 0, primers: 0, blackpowder: 0, matchprimers: 0 };
// Groups always have some water (wells, rain barrels), firewood (they cut their own: woodcutting.js) and arrows (they
// make their own): with no figure yet they count as comfortable.
// Water (water.js): other groups keep a single pool (f.stock.water; they purify their own). Un-purified water is
// priced by that pool at its own base value (half of purified water's), goes into the pool when they take it, and is
// never for sale from them: they sell purified water.
// Rounds (ammo.js, by calibre and type): a group's stores keep one ammo count (f.stock.ammo), priced as one good (a
// round key's need is the group's whole ammo), and offered as rounds by its kind's mix (data-ammo.js KIND_MIX: the
// military 5.56, a commune shotgun shells and .22); a caravan's or an outsider's goods hold rounds by key.
export const poolKey = (key) => (key === RAW ? "water" : isRoundKey(key) ? "ammo" : key);
// Parts by kind (data.js SUPPLIES: machine parts, car parts, gun parts, electronics; section 10): other groups keep one
// count of parts (f.stock.parts) and price every kind by it; what they offer of each kind is their share of it by the
// kind of group (KIND_MIX: the military's parts are a third electronics and a third gun parts), and whatever kind you
// buy from them or sell them comes out of or goes into that one count (groupStockKey). Outsiders (visitors.js) and
// caravans' loads keep each kind as it is.
export const PART_KINDS = ["carparts", "gunparts", "electronics"];
export const KIND_MIX = {
  "*":          { parts: 0.7,  carparts: 0.15, gunparts: 0.08, electronics: 0.07 },
  military:     { parts: 0.2,  carparts: 0.2,  gunparts: 0.3,  electronics: 0.3 },
  raider:       { parts: 0.4,  carparts: 0.3,  gunparts: 0.2,  electronics: 0.1 },
  expansionist: { parts: 0.45, carparts: 0.35, gunparts: 0.1,  electronics: 0.1 },
  traders:      { parts: 0.5,  carparts: 0.2,  gunparts: 0.15, electronics: 0.15 },
  fortress:     { parts: 0.75, carparts: 0.1,  gunparts: 0.1,  electronics: 0.05 },
  commune:      { parts: 0.8,  carparts: 0.1,  gunparts: 0.03, electronics: 0.07 },
  zealot:       { parts: 0.85, carparts: 0.1,  gunparts: 0.05, electronics: 0 },
};
const pooled = (f) => !!(f && !f.outsider && f.stock);
export const partShare = (f, key) => ((KIND_MIX[f && f.type] || KIND_MIX["*"])[key] ?? 0); // (not ammo.js kindShare: rounds by a group's kind)
// Where a supply goes in a group's stores: one water pool, one count of parts.
export const groupStockKey = (key, f = null) => (PART_KINDS.includes(key) && (!f || pooled(f)) ? "parts" : poolKey(key));
const stockOf = (f, key) => {
  if (isRoundKey(key)) return Math.max(0, (f.stock[key] || 0) + kindShare(Math.max(0, f.stock.ammo || 0), f.type, key)); // its own rounds of that key and its kind's share of its generic ammo
  if (key === "ammo") return Math.max(0, totalRounds(f.stock));
  const k = pooled(f) ? groupStockKey(key) : poolKey(key); return Math.max(0, f.stock[k] ?? (k === "water" || k === "wood" || k === "arrows" ? (f.pop || 0) * REF[k] : 0));
};
// The stock a price is read at: a round key at the group's whole ammo.
const priceStock = (f, key) => stockOf(f, isRoundKey(key) ? "ammo" : key);
// A group's reorder level for parts (merchants sell it parts below it: visitors.js tradeWithGroup): 4 + 1 per 5
// people, half again for the builders and fighters (fortress, expansionist, military).
export const groupPartsTarget = (f) => Math.round((4 + Math.floor((f.pop || 0) / 5)) * (["fortress", "expansionist", "military"].includes(f.type) ? 1.5 : 1));
export const groupPartsLow = (f) => pooled(f) && Math.max(0, f.stock.parts || 0) < groupPartsTarget(f);
// Part kinds left in a group's stores by the code that adds supplies by key (a delivery, a gift, a caravan's load) go
// into its one count of parts (refreshMarkets, each day, and after a trade).
export function foldPartKinds(f) {
  if (!pooled(f)) return;
  for (const k of PART_KINDS) if (k in f.stock) { f.stock.parts = Math.max(0, (Number.isFinite(f.stock.parts) ? f.stock.parts : 0) + (Number.isFinite(f.stock[k]) ? f.stock[k] : 0)); delete f.stock[k]; }
}

// How much this group values one unit at a given stock level (default: what they hold now).
export function need(f, key, stock = priceStock(f, key)) {
  const per = Math.max(0, stock) / Math.max(1, f.pop);
  return clamp(2 - per / (REF[poolKey(key)] || 1), 0.5, 2.2);
}
// Need with the starving / thirsty boost (valuation.js starveBoost): what their stock alone does to the price.
export const scarcity = (f, key, stock = priceStock(f, key)) => need(f, key, stock) * starveBoost(f, poolKey(key), stock);
export function spread(f, speech = 0) {
  const s = Math.min(0.12, Math.max(0, speech || 0) * 0.008);
  const g = clamp((f.goodwill || 0) / 1000, -0.1, 0.1);
  return { sell: 0.75 + s + g, buy: 1.3 - s - g };
}
// A group at war (diplomacy.js, f.atWar = wars it is in) values ammo and meds 35% more and weapons and armor 30%
// more, both ways (so selling and buying back still loses), and keeps twice its reserve of food, ammo, meds and
// fuel: it has less to trade. These premiums are valuation.js STATE_MODS "war" (with hordes, raids, sickness,
// the seasons, hunger and wealth).
export const WAR_PREMIUM = { ammo: 1.35, meds: 1.35 };
export const WAR_GEAR_PREMIUM = 1.3;
const WAR_RESERVE = { food: 2, ammo: 2, meds: 2, fuel: 2 };
// Their kind and state for a supply key or an item (valuation.js priceInfo: mult, refused, the "why" notes).
export const supplyInfo = (state, f, key) => priceInfo(state, f, catOf(key), false);
export const gearInfo = (state, f, item) => priceInfo(state, f, itemCat(item.key), true);
// What a unit is worth to them before the spread, as a multiple of its base value: stock, kind and state together
// (1 = an ordinary price). The market lists, the autopilot and outsiders use it.
export const demand = (state, f, key, stock = priceStock(f, key)) => scarcity(f, key, stock) * supplyInfo(state, f, key).mult;
// What they pay you per unit when they take qty units (stock rising as they do).
export function sellPrice(state, f, key, speech, qty = 1) {
  const q = Math.max(1, qty);
  return SUPPLIES[key].value * demand(state, f, key, priceStock(f, key) + q / 2) * spread(f, speech).sell;
}
// What you pay them per unit when you take qty units (stock falling as you do). Traders add their margin.
export function buyPrice(state, f, key, speech, qty = 1) {
  const q = Math.max(1, qty);
  return SUPPLIES[key].value * demand(state, f, key, priceStock(f, key) - q / 2) * margin(f) * spread(f, speech).buy;
}
// Gear: worth × kind and state × what they hold like it (valuation.js gearNeed; pool = their shelf: their wares
// unless given, e.g. a caravan's goods; nth = how many like it come before it in the same deal) × spread.
const gearPool = (f, pool) => pool || f.wares || [];
export function gearSellPrice(state, f, item, speech, { pool = null, nth = 0 } = {}) {
  return itemValue(item) * gearInfo(state, f, item).mult * gearNeed(f, itemCat(item.key), heldLike(item, gearPool(f, pool)) + 0.5 + nth) * spread(f, speech).sell;
}
export function gearBuyPrice(state, f, item, speech, { pool = null, nth = 0 } = {}) {
  const p = gearPool(f, pool);
  const held = heldLike(item, p) + (p.includes(item) ? 0 : 1); // it is theirs: it counts in what they hold
  return itemValue(item) * gearInfo(state, f, item).mult * gearNeed(f, itemCat(item.key), held - 0.5 - nth) * margin(f) * spread(f, speech).buy;
}
// What a group can spare of a supply (they keep a reserve per head; twice that of some goods at war). Nothing of
// what they refuse to deal in.
// kinds: the trade window's offer, where a group's parts are split by kind (KIND_MIX); everywhere else (the AI's own
// deals, tribute, caravans) they offer only "parts", the whole count, as before the kinds. A round key: its share of
// the ammo they can spare.
export function available(f, key, { kinds = false } = {}) {
  if (refuses(f, key) || key === RAW) return 0;
  if (isRoundKey(key)) return roundsAvailable(f, key);
  const split = pooled(f) && (PART_KINDS.includes(key) || key === "parts");
  if (split && !kinds && key !== "parts") return 0;
  const stock = split && kinds ? stockOf(f, key) * partShare(f, key) : stockOf(f, key);
  return Math.max(0, Math.floor(stock - (RESERVE[poolKey(key)] || 0) * f.pop * (f.atWar ? WAR_RESERVE[poolKey(key)] || 1 : 1)));
}
// A round key they can spare: its share of the ammo they can spare (they keep their ammo reserve over all of it).
function roundsAvailable(f, key) {
  const all = stockOf(f, "ammo");
  if (all <= 0) return 0;
  const spare = Math.max(0, all - (RESERVE.ammo || 0) * f.pop * (f.atWar ? WAR_RESERVE.ammo || 1 : 1));
  return Math.max(0, Math.floor(Math.min(stockOf(f, key), (spare * stockOf(f, key)) / all)));
}
// Why this group prices a supply key or an item the way it does, in words (the trade window's "why" lines; never a
// number): [{ text, dir: "up" | "down" | "no" }], the strongest first, at most `max`. pool: their shelf for an item.
export function priceWhy(state, f, what, { pool = null, max = 2 } = {}) {
  const gear = typeof what === "object";
  const key = gear ? what.key : what;
  const info = gear ? gearInfo(state, f, what) : supplyInfo(state, f, key);
  const out = info.notes.filter((n) => !info.refused || n.m === 0) // refused: that is all there is to say
    .map((n) => ({ text: n.text, dir: n.m === 0 ? "no" : n.m > 1 ? "up" : "down", w: n.m === 0 ? 99 : Math.abs(Math.log(n.m)) }));
  const name = catName(catOf(key));
  if (!info.refused) {
    if (gear) {
      const p = gearPool(f, pool);
      const g = gearNeed(f, itemCat(key), heldLike(what, p) - (p.includes(what) ? 1 : 0) + 0.5); // the others like it
      if (g <= 0.85) out.push({ text: `They already have spare ${name}`, dir: "down", w: Math.abs(Math.log(g)) });
    } else {
      const sb = starveBoost(f, key, stockOf(f, key));
      const n = need(f, key);
      if (sb >= 1.15) out.push({ text: poolKey(key) === "water" ? "Thirsty: water wanted badly" : "Starving: food wanted badly", dir: "up", w: Math.log(sb * n) });
      else if (n >= 1.4) out.push({ text: `Short of ${SUPPLIES[key].name.toLowerCase()}`, dir: "up", w: Math.log(n) });
      else if (n <= 0.7) out.push({ text: `Plenty of ${SUPPLIES[key].name.toLowerCase()} already`, dir: "down", w: Math.abs(Math.log(n)) });
    }
  }
  return out.sort((a, b) => b.w - a.w).slice(0, max).map(({ text, dir }) => ({ text, dir }));
}
// The autopilot's needs (autopilot.js needs: "ammo" as one good) for a deal where rounds change hands by key: the
// calibres the guns here shoot at the need for ammo (never "plenty": surplus rounds of a gun you use stay), the round
// that fits best and is on their side a little above that (asked for first), every other calibre plenty (sold).
export function roundNeeds(state, ctx, needs) {
  if (!ctx || !needs || needs.ammo == null) return needs;
  const cals = ctx.p ? partyCals(state, ctx.p) : ctx.base ? baseCals(state, ctx.base) : {};
  const out = { ...needs };
  delete out.ammo;
  for (const k of ROUND_KEYS) out[k] = cals[roundOf(k).cal] ? Math.max(needs.ammo, 0.7) : 0.2;
  const want = wantedKey(cals, ctx.theirHave || {});
  if (want) out[want] = Math.max(needs.ammo, 0.7) + 0.01;
  return out;
}
// ---------- the autopilot's sales ----------
// Items the governor can spare from the base's armory (their caravan or merchants at your gates): valuables (good
// for nothing but trade) when they pay at least an ordinary price, and weapons and armor beyond the spares the base
// keeps (a third of its people, at least 2 of each, the weakest go first) when this group prizes them (×1.2 or
// more: a group at war, hordes at its walls, the military for rifles...). At most `max` items.
const ARMOR_SLOTS_ALL = ["armor", "head", "arms", "legs"];
export function autoGearOffer(state, ctx, max = 3) {
  if (!ctx || !ctx.base) return [];
  const pool = ctx.myGear || [];
  const keep = Math.max(2, Math.ceil(atBase(state, ctx.base.id).length / 3));
  const out = [];
  const mult = (g) => gearInfo(state, ctx.f, g).mult;
  for (const g of pool) if (GEAR[g.key] && GEAR[g.key].valuable && mult(g) >= 0.95) out.push(g);
  for (const slots of [["weapon"], ARMOR_SLOTS_ALL]) {
    const list = pool.filter((g) => GEAR[g.key] && slots.includes(GEAR[g.key].slot) && !g.contents).sort((a, b) => GEAR[a.key].power - GEAR[b.key].power || itemValue(a) - itemValue(b));
    for (const g of list.slice(0, Math.max(0, list.length - keep))) if (mult(g) >= 1.2) out.push(g);
  }
  return out.filter((g) => !refuses(ctx.f, g.key)).slice(0, max);
}
// Offers those items for the good the base needs most that they have (needs: autopilot.js, 0 … 3), balanced to a
// fair deal. Returns the trade text or "".
export function autoSellGear(state, needs) {
  const ctx = tradeContext(state);
  if (!ctx) return "";
  const items = autoGearOffer(state, ctx);
  if (!items.length) return "";
  const t = ctx.t;
  t.offer = {}; t.ask = {}; t.offerGear = [...items]; t.askGear = []; t.deal = null;
  // Firewood (woodcutting.js) only when the base is really short of it: it is cheap, so a deal balanced with it fills
  // the woodpile with hundreds the base does not need.
  const want = Object.keys(needs).filter((k) => SUPPLIES[k] && (ctx.theirHave[k] || 0) > 0 && (k !== "wood" || needs[k] >= 1.2)).sort((a, b) => needs[b] - needs[a] || a.localeCompare(b))[0];
  if (want) balanceWith(state, want);
  const v = tradeVerdict(state);
  if (!v.ok || !Object.values(t.ask).some((q) => q > 0)) { t.offer = {}; t.ask = {}; t.offerGear = []; return ""; }
  return executeTrade(state);
}
// What a load would fetch from them, before Speech (the autopilot picks a buyer with it; the caravan planner shows it).
export function goodsWorth(state, f, supplies = {}, gear = [], speech = 0) {
  let v = 0;
  for (const [k, q] of Object.entries(supplies || {})) if (q > 0 && SUPPLIES[k]) v += q * sellPrice(state, f, k, speech, q);
  gear.forEach((g, i) => { if (g) v += gearSellPrice(state, f, g, speech, { nth: gear.slice(0, i).filter((x) => x && itemCat(x.key) === itemCat(g.key)).length }); });
  return v;
}

// ---------- wants and surplus (the market board) ----------
// Refreshed every 7 days from the group's real stock and need (refreshMarkets, from diplomacy.js once a day):
// wants = goods with demand 1.25+ (stock, kind and state: demand above; what they pay you per unit for a lot of
// LOT[k], before Speech), qty = what would bring them back to comfortable (need 1), at least half a lot; surplus =
// goods with demand 0.9 or less and 5+ to spare (what they charge per unit for a lot), qty = what they can spare.
// Nothing they refuse. prices: both prices for every good; prev: last week's.
// Their radio offers and requests (radio.js) and the caravans you ask for (caravans.js) use these lists.
export const WANT_NEED = 1.25, SURPLUS_NEED = 0.9, MARKET_DAYS = 7;
export const LOT = { food: 20, water: 20, rawwater: 20, fuel: 10, meds: 6, ammo: 50, arrows: 20, parts: 3, scrap: 20, preserved: 10, jars: 10, wood: 600, carparts: 3, gunparts: 4, electronics: 4, brass: 100, powder: 100, primers: 100, blackpowder: 100, matchprimers: 50 }; // wood: 60 kg
export const wantQty = (f, k) => Math.max(1, Math.ceil((LOT[k] || 10) / 2), Math.ceil(REF[poolKey(k)] * f.pop - stockOf(f, k)));
export function marketLists(state, f, speech = 0) {
  const wants = [], surplus = [], prices = {};
  for (const k of SUPPLY_KEYS) {
    const lot = LOT[k] || 10;
    prices[k] = { pay: sellPrice(state, f, k, speech, lot), ask: buyPrice(state, f, k, speech, lot) };
    if (refuses(f, k) || k === RAW) continue; // un-purified water: priced, but the lists ask for and offer purified water
    if (isRoundKey(k)) continue; // rounds: the lists ask for and offer ammo as one good (sold by calibre in the window)
    if (SUPPLIES[k].reload && !(stockOf(f, k) >= 1)) continue; // the reloading bench's inputs: on the board only from a group that holds some
    if (PART_KINDS.includes(k) && pooled(f)) continue; // they want and offer "parts"; the kinds are in the trade window
    const n = demand(state, f, k);
    if (n >= WANT_NEED) wants.push({ key: k, need: n, qty: wantQty(f, k), price: prices[k].pay });
    else if (n <= SURPLUS_NEED && available(f, k) >= supplyFew(k, 5)) surplus.push({ key: k, need: n, qty: available(f, k), price: prices[k].ask });
  }
  wants.sort((a, b) => b.need - a.need || a.key.localeCompare(b.key));
  surplus.sort((a, b) => a.need - b.need || a.key.localeCompare(b.key));
  return { wants, surplus, prices };
}
export function refreshMarket(state, f) {
  const m = marketLists(state, f);
  f.market = { day: day(state), wants: m.wants, surplus: m.surplus, prices: m.prices, prev: f.market ? f.market.prices : null };
  return f.market;
}
export function refreshMarkets(state) {
  for (const f of state.factions) foldPartKinds(f);
  for (const f of state.factions) if (f.alive && (!f.market || day(state) - f.market.day >= MARKET_DAYS)) refreshMarket(state, f);
}
// This week's lists (made now if they have none yet).
export const marketOf = (state, f) => f.market || refreshMarket(state, f);
// Price trend vs last week for a good: "up" / "down" / "same" (side: "pay" what they pay you, "ask" what they charge).
export function priceTrend(f, key, side) {
  const m = f.market;
  if (!m || !m.prev || !m.prev[key] || !m.prices[key]) return "same";
  const a = m.prices[key][side], b = m.prev[key][side];
  return a > b * 1.03 ? "up" : a < b * 0.97 ? "down" : "same";
}
// The market board: groups you know in radio reach (not hostile), best price for the good first.
// side "sell": who pays you most for it; "buy": who charges least.
export function marketBoard(state, key, side = "sell") {
  const rows = [];
  for (const f of state.factions) {
    if (!f.alive || !f.known || attitude(f) === "Hostile" || !canRadioGroup(state, f)) continue;
    const m = marketOf(state, f);
    const p = m.prices[key];
    if (!p) continue;
    const want = m.wants.find((x) => x.key === key), spare = m.surplus.find((x) => x.key === key);
    rows.push({ f, pay: p.pay, ask: p.ask, want: want ? want.qty : 0, spare: spare ? spare.qty : 0, trend: priceTrend(f, key, side === "sell" ? "pay" : "ask"), atWar: !!f.atWar });
  }
  rows.sort((a, b) => (side === "sell" ? b.pay - a.pay : a.ask - b.ask) || a.f.id - b.f.id);
  return rows;
}

// Largest whole amount of `key` whose total buying price stays within `budget` (binary search, prices move with qty).
export function maxBuyable(state, f, key, speech, budget, cap = Infinity, kinds = false) {
  let lo = 0, hi = Math.max(0, Math.floor(Math.min(cap, available(f, key, { kinds }))));
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (mid * buyPrice(state, f, key, speech, mid) <= budget + 1e-9) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
// Smallest whole amount of `key` they must take from you to be worth `value` to them (Infinity if `cap` is not enough).
export function minSellable(state, f, key, speech, value, cap = Infinity) {
  if (value <= 0) return 0;
  let lo = 1, hi = Math.min(cap, 100000);
  if (hi * sellPrice(state, f, key, speech, hi) < value - 1e-9) return Infinity;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (mid * sellPrice(state, f, key, speech, mid) >= value - 1e-9) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

// ---------- the goods a group has for sale ----------
// Each group's stock fits what it is: raiders sell what they took (and drink), the military its kit, the commune
// farm and camp things, the fortress its defences.
export const WARES = {
  traders: ["pistol", "shotgun", "huntrifle", "vest", "machete", "bikehelmet", "kneeguards", "backpack", "bandagekit", "crowbar", "waterfilter", "assaultpack",
    "revolver", "leverrifle", "compbow", "slingbag", "hikingpack", "camonet", "stove", "flare", "cards", "guitar", "chocolate", "instcoffee", "smokes", "vodka", "binoculars", "monocular", "deodorant", "toothpaste", "perfume"],
  commune: ["machete", "huntrifle", "pipespear", "waterfilter", "bandagekit", "backpack", "padding", "bat", "compbow", "slingbag", "stove", "ghillie", "harmonica", "cards",
    "beartrap", "barbedwire", "tripwire", "chocolate", "toothpaste", "shampoo"],
  military: ["ar", "vest", "plate", "riothelmet", "milradio", "nvg", "assaultpack", "pistol", "carbine", "rucksack", "camonet", "smokegren", "flare", "frag", "heatpack", "sandbags", "barbedwire", "instcoffee", "binoculars", "thermal"],
  fortress: ["shotgun", "huntrifle", "vest", "riothelmet", "kneeguards", "crowbar", "sledge", "prybar", "fireaxe", "sandbags", "barbedwire", "beartrap", "tripwire", "riotarms"],
  raider: ["pistol", "shotgun", "machete", "spikedbat", "tirevest", "bikehelmet", "pipegun", "revolver", "bat", "nailbat", "molotov", "pipebomb", "ladder", "vodka", "smokes"],
  expansionist: ["pistol", "shotgun", "huntrifle", "vest", "riothelmet", "scrapvest", "carbine", "leverrifle", "revolver", "hikingpack", "riotarms", "smokegren", "flare", "binoculars"],
  zealot: ["machete", "knife", "shotgun", "pipespear", "bandagekit", "fireaxe", "bat", "molotov", "compbow"],
};
// A farming commune also sells the tools of the land now and then (its own dice: the rest of the stock is unchanged):
// { p: chance a week, items: weights }.
export const WARE_EXTRAS = {
  commune: { p: 0.7, items: { fishrod: 2, fishnet: 1.5, snarewire: 2, lantern: 1.5, fireaxe: 1, sledge: 0.7, honey: 1.5, tobacco: 1, dewormer: 1 } },
};
export const WARES_MAX = 12;
// Fills a group's gear for sale (sim-side only: uses the world's random numbers). refresh: new stock for the week.
// The kinds come from the group's list (WARES); the condition from what kind of group it is (itemcond.js: the
// military's kit kept up, raiders' knocked about), priced by it (valuation.js itemValue).
export function ensureWares(state, f, refresh = false) {
  if (f.wares && !refresh) return f.wares;
  const rng = state.rng;
  const pool = WARES[f.type] || WARES.traders;
  const n = f.type === "traders" ? rng.int(4, 6) : rng.int(1, 3);
  const keep = (f.wares || []).slice(-Math.max(0, WARES_MAX - n));
  const src = traderSource(f.type);
  for (let i = 0; i < n; i++) {
    const key = rng.pick(pool);
    spend(rng, GEAR[key] && GEAR[key].dur ? 2 : 1); // the old quality and wear draws, still taken (the world's dice stay put)
    keep.push(lootItem(key, src, rng));
  }
  const ex = WARE_EXTRAS[f.type];
  if (ex && hash01(state.seed, "wareex", f.name, day(state)) < ex.p) {
    const key = pickWeighted(ex.items, hash01(state.seed, "wareexk", f.name, day(state)));
    if (key) keep.push(lootItem(key, src, [state.seed, "wareexd", f.name, day(state)]));
  }
  keep.push(...gunmodWares(state, f.type, f.name, day(state))); // loot.js: a gun attachment now and then (its own dice)
  keep.push(...bookWares(state, f)); // skills.js: now and then a book (its own dice: the rest of the stock is unchanged)
  keep.push(...shelfSurplus(state, f)); // arsenal.js: weapons beyond what their people need (no dice)
  f.wares = keep.slice(-WARES_MAX);
  f.waresDay = day(state);
  return f.wares;
}

// ---------- intel (map reports) ----------
// Bought by area around the place you trade at (radius 3 / 6 / 10 tiles): every tile in it is reported as it is
// now (owner, loot left, infection, hordes, hives). The fog lifts only on the tiles paid for. Horde and nest
// sightings: every horde and hive within 12 tiles. Your own maps sell for what you know fresh (seen in the last
// 15 days) within 12 tiles of them: 0.15 a tile, up to 40, to a group once every 10 days.
export const INTEL = {
  near: { r: 3, name: "Nearby area (3 tiles)" },
  region: { r: 6, name: "The region (6 tiles)" },
  wide: { r: 10, name: "Wide area (10 tiles)" },
};
export const INTEL_PER_TILE = 0.4;
export const SIGHTINGS_RANGE = 12;
export const INTEL_SELL_DAYS = 10;

export function intelOffer(state, ctx) {
  const g = state.grid;
  const areas = Object.entries(INTEL).map(([key, a]) => {
    const tiles = g.within(ctx.center, a.r).length;
    return { key, r: a.r, name: a.name, tiles, value: tiles * INTEL_PER_TILE };
  });
  const hordes = state.hordes.filter((h) => g.distance(h.tile, ctx.center) <= SIGHTINGS_RANGE).length;
  const nests = state.tiles.filter((t) => t.hive && g.distance(t.id, ctx.center) <= SIGHTINGS_RANGE).length;
  const fresh = state.hour - 15 * 24;
  let mine = 0;
  for (const id of g.within(ctx.center, SIGHTINGS_RANGE)) {
    const k = state.knowledge[id];
    if (k && k.hour >= fresh) mine++;
  }
  const last = ctx.f.lastIntelBuy;
  const soon = last != null && day(state) - last < INTEL_SELL_DAYS;
  return {
    areas,
    sightings: { value: 8 + 3 * (hordes + nests), hordes, nests },
    sell: { value: Math.min(40, mine * 0.15), tiles: mine, ok: mine >= 10 && !soon, why: soon ? `They bought your maps on day ${last}.` : mine < 10 ? "You know too little around here to sell." : "" },
  };
}
function intelTiles(state, center, intel) {
  const tiles = new Set();
  if (intel.area && INTEL[intel.area]) for (const id of state.grid.within(center, INTEL[intel.area].r)) tiles.add(id);
  if (intel.sightings) {
    for (const h of state.hordes) if (state.grid.distance(h.tile, center) <= SIGHTINGS_RANGE) tiles.add(h.tile);
    for (const t of state.tiles) if (t.hive && state.grid.distance(t.id, center) <= SIGHTINGS_RANGE) tiles.add(t.id);
  }
  return [...tiles];
}

// ---------- trade screens: one at a time, the rest wait their turn ----------
// state.trade is the trade on screen:
//   a visit: { partyId, factionId, ... } (your team at their base, or a trade caravan of yours there)
//   a caravan: { caravanId, baseId, factionId, deal?, ... } (their caravan at one of your bases)
//   over the radio: { radio: true, factionId, baseId, delivery: "fetch" | "deliver", ... } (radiotrade.js: a base's
//   stores and armory against their spare stock and wares; agreeing books the deal, a caravan carries it)
// Both: offer / ask = supplies { key: qty } you give / you take; offerGear / askGear = the items; intel =
// { area: "" | "near" | "region" | "wide", sightings, sell }. A second trade that comes up while one is open
// waits in state.tradeQueue (like battles in combat.js).
const freshTrade = (fields) => ({ ...fields, offer: {}, ask: {}, offerGear: [], askGear: [], intel: { area: "", sightings: false, sell: false } });

export function openTrade(state, p, f) {
  ensureWares(state, f);
  const visit = freshTrade({ partyId: p.id, factionId: f.id });
  p.phase = "engaged";
  if (state.trade && state.trade.partyId !== p.id && tradeContext(state)) {
    (state.tradeQueue = state.tradeQueue || []).push(visit);
    return false;
  }
  beginVisit(state, visit, p, f);
  return true;
}

function beginVisit(state, visit, p, f) {
  state.trade = visit;
  f.known = true;
  // Your people held here: offer a ransom before the barter starts.
  const ransom = ransomOnTradeCard(state, p, f);
  if (ransom) state.cards.push(ransom);
}

// Their caravan at one of your bases: the trade window opens (or waits its turn). A deal agreed over the radio
// is filled in.
export function openCaravanTrade(state, c) {
  if (!c || c.phase !== "trading") return false;
  if (state.trade && state.trade.caravanId === c.id) return true;
  const t = freshTrade({ caravanId: c.id, baseId: c.baseId, factionId: c.owner, deal: c.deal && !c.dealDone ? c.deal : null });
  const cf = factionById(state, c.owner), cb = baseById(state, c.baseId);
  if (t.deal && cf && cb && ((t.deal.ask && t.deal.ask.ammo) || (t.deal.offer && t.deal.offer.ammo))) { // ammo.js: "N ammo" as rounds by calibre
    expandAmmo(c.goods.supplies, kindTheme(cf.type));
    const cals = baseCals(state, cb);
    t.deal = { ...t.deal, ask: dealRounds(t.deal.ask, c.goods.supplies, cals, true), offer: dealRounds(t.deal.offer, cb.stock, cals, false) };
  }
  if (t.deal) {
    t.offer = { ...t.deal.offer };
    t.ask = { ...t.deal.ask };
    // Items agreed over the radio (radiotrade.js): yours still in the base's armory, theirs on the caravan.
    const base = baseById(state, c.baseId);
    t.offerGear = (base && matchGear(base.armory, t.deal.offerGear || [])) || [];
    t.askGear = matchGear(c.goods.gear, t.deal.askGear || []) || [];
  }
  if (state.trade && tradeContext(state)) {
    const q = (state.tradeQueue = state.tradeQueue || []);
    if (!q.some((v) => v.caravanId === c.id)) q.push(t);
    return false;
  }
  state.trade = t;
  return true;
}

// Is a trade visit for this team open or waiting its turn?
export const tradePending = (state, partyId) =>
  !!(state.trade && state.trade.partyId === partyId) || (state.tradeQueue || []).some((v) => v.partyId === partyId);

// Opens the next waiting trade when the screen is free. A waiting team that is gone or has moved on is skipped;
// one whose hosts are gone or have turned hostile gets orders instead; a caravan that has left is skipped.
export function advanceTradeQueue(state) {
  if (state.trade && !tradeContext(state)) state.trade = null; // that team, caravan or group no longer exists
  const q = state.tradeQueue;
  while (!state.trade && q && q.length) {
    const v = q.shift();
    if (v.visitorId != null) { resumeVisitorTrade(state, v); continue; } // outsiders (visitors.js)
    const f = factionById(state, v.factionId);
    if (v.caravanId != null) {
      const c = state.parties.find((x) => x.id === v.caravanId);
      if (c && c.phase === "trading" && f && f.alive) state.trade = v;
      continue;
    }
    const p = state.parties.find((x) => x.id === v.partyId);
    if (!p || p.phase !== "engaged" || !partyMembers(state, p).length) continue;
    if (!f || !f.alive || attitude(f) === "Hostile" || !f.bases.includes(partyTile(p))) {
      awaitOrders(state, p, `${f ? f.name : "They"} will not trade now.`);
      continue;
    }
    beginVisit(state, v, p, f);
  }
}

// Everything the trade window and the rules need about the open trade.
export function tradeContext(state) {
  const t = state.trade;
  if (!t) return null;
  if (t.visitorId != null) return visitorTradeContext(state, t); // merchants and travellers from outside (visitors.js)
  if (t.radio) return radioTradeContext(state, t); // over the radio (radiotrade.js)
  const f = factionById(state, t.factionId);
  if (!f || !f.alive) return null;
  const have = {}, theirHave = {};
  if (t.caravanId != null) {
    const c = state.parties.find((q) => q.id === t.caravanId);
    const base = baseById(state, t.baseId);
    if (!c || !base || c.phase !== "trading") return null;
    const speech = tradeSpeech(atBase(state, base.id)); // best Speech here, Haggler +5 (skills.js)
    expandAmmo(c.goods.supplies, kindTheme(f.type)); // ammo.js: their ammo as rounds by calibre
    for (const k of SUPPLY_KEYS) {
      have[k] = Math.max(0, Math.floor(base.stock[k] || 0));
      theirHave[k] = Math.max(0, Math.floor(c.goods.supplies[k] || 0));
    }
    have.ammo = theirHave.ammo = 0; // rounds change hands by calibre and type (ammo.js)
    return { kind: "caravan", t, f, caravan: c, base, p: null, speech, have, theirHave, myGear: base.armory, theirGear: c.goods.gear, center: f.bases[0] ?? partyTile(c) };
  }
  const p = state.parties.find((q) => q.id === t.partyId);
  if (!p) return null;
  const speech = tradeSpeech(partyMembers(state, p)); // best Speech on the team, Haggler +5 (skills.js)
  // You trade from what the team carries: supplies plus anything found.
  for (const k of SUPPLY_KEYS) {
    have[k] = Math.max(0, Math.floor((p.supplies[k] || 0) + (p.cargo.supplies[k] || 0)));
    theirHave[k] = available(f, k, { kinds: true }); // their parts split by kind (KIND_MIX)
  }
  have.ammo = theirHave.ammo = 0; // rounds change hands by calibre and type (ammo.js)
  return { kind: "visit", t, f, p, caravan: null, base: null, speech, have, theirHave, myGear: p.cargo.gear, theirGear: f.wares || [], center: partyTile(p) };
}

// The items in the deal that are still where they were (a list can change while the window is open).
const liveGear = (list, pool) => (list || []).filter((g) => pool.includes(g));

// The price of every item in the deal and of every item that could join it, at the group's prices: [item, { price,
// mine }]. Items of one category in the deal are priced one after another (each moves what they hold); an item not
// in the deal is priced as the next one of its kind.
export function dealGearPrices(state, ctx) {
  const { t, f, speech } = ctx;
  const out = [];
  for (const [mine, pool, chosen] of [[true, ctx.myGear, liveGear(t.offerGear, ctx.myGear)], [false, ctx.theirGear, liveGear(t.askGear, ctx.theirGear)]]) {
    const seen = {};
    const priceOf = (g, nth) => (mine ? gearSellPrice(state, f, g, speech, { pool: ctx.theirGear, nth }) : gearBuyPrice(state, f, g, speech, { pool: ctx.theirGear, nth }));
    const keyOf = (g) => { const c = itemCat(g.key); return c === "books" || c === "manuals" ? `${c}:${g.key}` : c; };
    for (const g of chosen) { const k = keyOf(g); out.push([g, { price: priceOf(g, seen[k] || 0), mine, inDeal: true }]); seen[k] = (seen[k] || 0) + 1; }
    for (const g of pool) if (g && !chosen.includes(g)) out.push([g, { price: priceOf(g, seen[keyOf(g)] || 0), mine, inDeal: false }]);
  }
  return out;
}

// Totals at the group's prices: offer = what they give you credit for, ask = what they charge. lines: per row
// (lines.gear: item → its price in the deal).
export function tradeTotals(state) {
  const ctx = tradeContext(state);
  if (!ctx) return null;
  const { t, f, speech } = ctx;
  let offer = 0, ask = 0;
  const lines = { offer: {}, ask: {}, intel: {} };
  for (const [k, q] of Object.entries(t.offer)) if (q > 0) { const v = q * sellPrice(state, f, k, speech, q); lines.offer[k] = v; offer += v; }
  for (const [k, q] of Object.entries(t.ask)) if (q > 0) { const v = q * buyPrice(state, f, k, speech, q); lines.ask[k] = v; ask += v; }
  const gearLines = new Map();
  for (const [g, side] of dealGearPrices(state, ctx)) {
    gearLines.set(g, side.price);
    if (side.inDeal) { if (side.mine) offer += side.price; else ask += side.price; }
  }
  lines.gear = gearLines;
  if (ctx.fee) { lines.fee = ctx.fee; ask += ctx.fee; } // over the radio, they bring it: the delivery fee (radiotrade.js)
  const intel = t.intel || {};
  if (intel.area || intel.sightings || intel.sell) {
    const io = intelOffer(state, ctx);
    const sp = spread(f, speech);
    if (intel.area) { const a = io.areas.find((x) => x.key === intel.area); if (a) { lines.intel.area = a.value * sp.buy; ask += lines.intel.area; } }
    if (intel.sightings) { lines.intel.sightings = io.sightings.value * sp.buy; ask += lines.intel.sightings; }
    if (intel.sell && io.sell.ok) { lines.intel.sell = io.sell.value * sp.sell; offer += lines.intel.sell; }
  }
  return { offer, ask, lines };
}

const weigh = (sup) => Object.entries(sup || {}).reduce((s, [k, q]) => s + Math.max(0, q) * SUPPLIES[k].weight, 0);
const gearWeight = (list) => list.reduce((s, g) => s + itemLoad(g), 0);
const sameMap = (a, b) => {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) if ((a[k] || 0) !== (b[k] || 0)) return false;
  return true;
};

// Is the deal on the table acceptable? { ok, reason, honoured, ctx, tot }.
export function tradeVerdict(state) {
  const ctx = tradeContext(state);
  if (!ctx) return { ok: false, reason: "Nobody to trade with." };
  const { t, f } = ctx;
  const tot = tradeTotals(state);
  const out = (ok, reason, extra = {}) => ({ ok, reason, ctx, tot, ...extra });
  if (attitude(f) === "Hostile") return out(false, `${f.name} will not trade with you.`);
  const offerGear = liveGear(t.offerGear, ctx.myGear), askGear = liveGear(t.askGear, ctx.theirGear);
  const empty = !Object.values(t.offer).some((q) => q > 0) && !Object.values(t.ask).some((q) => q > 0) && !offerGear.length && !askGear.length && !t.intel.area && !t.intel.sightings && !t.intel.sell;
  if (empty) return out(false, "Put something on the table first.");
  // Their kind refuses some goods outright (valuation.js: zealots and liquor).
  for (const k of [...Object.keys(t.offer).filter((x) => t.offer[x] > 0), ...Object.keys(t.ask).filter((x) => t.ask[x] > 0), ...offerGear.map((g) => g.key), ...askGear.map((g) => g.key)]) {
    if (refuses(f, k)) return out(false, `${f.name} will not touch ${catName(catOf(k))}.`);
  }
  for (const [k, q] of Object.entries(t.offer)) if (q > (ctx.have[k] || 0)) return out(false, `You only have ${ctx.have[k] || 0} ${k}.`);
  for (const [k, q] of Object.entries(t.ask)) if (q > (ctx.theirHave[k] || 0)) return out(false, `They can spare only ${ctx.theirHave[k] || 0} ${k}.`);
  // Carry space: a team carries what it gets; their caravan carries what it takes.
  if (ctx.kind === "radio") {
    const why = radioTradeProblem(state, ctx, offerGear, askGear); // radiotrade.js: a deal waiting, their caravan's load
    if (why) return out(false, why);
  } else if (ctx.kind === "visit") {
    const p = ctx.p;
    const freed = weigh(t.offer) + gearWeight(offerGear); // what leaves the team is weight it no longer carries (sim/load.js: one pool)
    const room = cargoRoom(state, p) + freed;
    const need = weigh(t.ask) + gearWeight(askGear);
    // Only a deal that adds weight is held to it (a team that is already loaded can still hand goods over).
    if (need > room + 1e-9 && need > freed + 1e-9) return out(false, `The team cannot carry that much: what you ask for weighs ${Math.ceil(need)}, and there is room for ${Math.max(0, Math.floor(room))}.`);
  } else {
    const c = ctx.caravan;
    const room = c.capacity - weigh(c.goods.supplies) - gearWeight(c.goods.gear) + weigh(t.ask) + gearWeight(askGear);
    const need = weigh(t.offer) + gearWeight(offerGear);
    if (need > room + 1e-9 && need > weigh(t.ask) + gearWeight(askGear) + 1e-9) return out(false, `Their caravan cannot carry that much: your goods weigh ${Math.ceil(need)}, and they have room for ${Math.max(0, Math.floor(room))}.`);
  }
  if (t.deal && sameMap(t.offer, t.deal.offer) && sameMap(t.ask, t.deal.ask) && sameGear(offerGear, t.deal.offerGear) && sameGear(askGear, t.deal.askGear) && !t.intel.area && !t.intel.sightings && !t.intel.sell) {
    return out(true, "The deal agreed over the radio.", { honoured: true });
  }
  if (tot.offer + 1e-9 < tot.ask) return out(false, `Not enough for them: your side is worth ${Math.floor(tot.offer)} to them, theirs ${Math.ceil(tot.ask)}.`);
  return out(true, tot.offer - tot.ask > Math.max(5, tot.ask * 0.25) ? "Fair, and generous: they will like you for it." : "Fair: they accept.");
}

// ---------- editing the deal ----------
// side: "mine" (what you give) or "theirs" (what you take). A good is only ever on one side.
export function setQty(state, side, key, qty) {
  const ctx = tradeContext(state);
  if (!ctx || !SUPPLIES[key]) return;
  const max = refuses(ctx.f, key) ? 0 : side === "mine" ? ctx.have[key] || 0 : ctx.theirHave[key] || 0;
  const q = clamp(Math.floor(Number(qty) || 0), 0, max);
  const t = ctx.t;
  if (side === "mine") { t.offer[key] = q; if (q) t.ask[key] = 0; }
  else { t.ask[key] = q; if (q) t.offer[key] = 0; }
}
export function toggleGear(state, side, index) {
  const ctx = tradeContext(state);
  if (!ctx) return;
  const pool = side === "mine" ? ctx.myGear : ctx.theirGear;
  const item = pool[Number(index)];
  if (!item) return;
  const list = side === "mine" ? (ctx.t.offerGear = liveGear(ctx.t.offerGear, pool)) : (ctx.t.askGear = liveGear(ctx.t.askGear, pool));
  const i = list.indexOf(item);
  if (i >= 0) list.splice(i, 1);
  else if (!refuses(ctx.f, item.key)) list.push(item); // they will not touch it
}
export function setIntel(state, field, value) {
  const ctx = tradeContext(state);
  if (!ctx || ctx.kind === "radio") return; // news goes by Ask for news (radio.js)
  const it = ctx.t.intel;
  if (field === "area") it.area = INTEL[value] && it.area !== value ? value : "";
  else if (field === "sightings") it.sightings = !it.sightings;
  else if (field === "sell") it.sell = !it.sell && intelOffer(state, ctx).sell.ok;
}

// "Balance with" a currency-like good: when your side is short, add that good to your side until it is fair;
// when you overpay, ask for that good until the two sides meet. Returns a message.
export function balanceWith(state, key) {
  const ctx = tradeContext(state);
  if (!ctx || !SUPPLIES[key]) return "";
  const { t, f, speech } = ctx;
  const tot = tradeTotals(state);
  if (key === "ammo") { // rounds go by calibre (ammo.js): pay with the kind your guns need least, ask for the one they need most
    const cals = ctx.p ? partyCals(state, ctx.p) : ctx.base ? baseCals(state, ctx.base) : {};
    const pick = tot.offer < tot.ask ? Object.keys(spendAmmo({ ...ctx.have, ammo: 0 }, 1, cals).keys)[0] : wantedKey(cals, ctx.theirHave) || ROUND_KEYS.filter((k) => (ctx.theirHave[k] || 0) >= 1).sort((a, b) => ctx.theirHave[b] - ctx.theirHave[a])[0];
    if (!pick) return tot.offer < tot.ask ? "You have no rounds to pay with." : "They have no rounds to spare.";
    return balanceWith(state, pick);
  }
  if (Math.abs(tot.offer - tot.ask) < 0.5) return "It is already balanced.";
  if (tot.offer < tot.ask) {
    if (t.ask[key]) return `You are asking for ${key}: take it off their side first.`;
    const cur = t.offer[key] || 0;
    const curV = cur ? cur * sellPrice(state, f, key, speech, cur) : 0;
    const want = minSellable(state, f, key, speech, curV + (tot.ask - tot.offer), ctx.have[key] || 0);
    if (!Number.isFinite(want)) return `You do not have enough ${key} to balance it (${ctx.have[key] || 0}).`;
    setQty(state, "mine", key, want);
    return `Added ${want - cur} ${key} to your side.`;
  }
  if (t.offer[key]) return `You are offering ${key}: take it off your side first.`;
  const cur = t.ask[key] || 0;
  const curV = cur ? cur * buyPrice(state, f, key, speech, cur) : 0;
  const q = maxBuyable(state, f, key, speech, curV + (tot.offer - tot.ask), ctx.theirHave[key] || 0, true);
  if (q <= cur) return `Your surplus is not enough for one more ${key}.`;
  setQty(state, "theirs", key, q);
  return `Asked for ${q - cur} more ${key}.`;
}

// ---------- doing the deal ----------
function takeFromParty(p, key, qty) {
  const fromCargo = Math.min(qty, Math.floor(p.cargo.supplies[key] || 0));
  p.cargo.supplies[key] = (p.cargo.supplies[key] || 0) - fromCargo;
  p.supplies[key] = (p.supplies[key] || 0) - (qty - fromCargo);
}
const moveItem = (from, to, item) => { const i = from.indexOf(item); if (i >= 0) from.splice(i, 1); to.push(item); };

// Goodwill from trading: more for bigger deals and for overpaying, at most 4 a day per group.
function tradeGoodwill(state, f, volume, extra) {
  const today = day(state);
  if (f.tradeGwDay !== today) { f.tradeGwDay = today; f.tradeGw = 0; }
  const want = Math.min(2, volume / 80) + Math.min(4, Math.max(0, extra) / 15);
  const gain = Math.max(0, Math.min(want, 4 - f.tradeGw));
  f.tradeGw += gain;
  if (gain > 0) changeGoodwill(state, f, gain, "a fair trade");
}

export function executeTrade(state) {
  const v = tradeVerdict(state);
  if (!v.ok) return v.reason || "The deal is not balanced.";
  const { ctx, tot } = v;
  if (ctx.kind === "radio") return bookRadioTrade(state, v); // over the radio: booked, a caravan carries it (radiotrade.js)
  const { t, f } = ctx;
  const offerGear = liveGear(t.offerGear, ctx.myGear), askGear = liveGear(t.askGear, ctx.theirGear);
  const theirSup = ctx.kind === "caravan" ? ctx.caravan.goods.supplies : f.stock;
  const theirGear = ctx.kind === "caravan" ? ctx.caravan.goods.gear : (f.wares = f.wares || []);
  const gave = [], got = [];
  for (const [k, q] of Object.entries(t.offer)) {
    if (!(q > 0)) continue;
    if (ctx.kind === "visit") takeFromParty(ctx.p, k, q);
    else ctx.base.stock[k] = (ctx.base.stock[k] || 0) - q;
    const tk = ctx.kind === "caravan" ? k : groupStockKey(k, f); // a group's own stores: one water pool, one count of parts
    theirSup[tk] = (theirSup[tk] ?? (ctx.kind === "caravan" ? 0 : stockOf(f, k))) + q; // a group with no figure yet (water, firewood) starts from its comfortable stock
    gave.push(`${q} ${keyWord(k)}`);
  }
  for (const [k, q] of Object.entries(t.ask)) {
    if (!(q > 0)) continue;
    const tk = ctx.kind === "caravan" ? k : groupStockKey(k, f); // a group's own stores: one ammo count, one count of parts
    theirSup[tk] = (theirSup[tk] ?? (ctx.kind === "caravan" ? 0 : stockOf(f, tk))) - q;
    if (ctx.kind === "visit") ctx.p.cargo.supplies[k] = (ctx.p.cargo.supplies[k] || 0) + q;
    else ctx.base.stock[k] = (ctx.base.stock[k] || 0) + q;
    got.push(`${q} ${keyWord(k)}`);
  }
  for (const g of offerGear) { moveItem(ctx.myGear, theirGear, g); gave.push(g.name); }
  for (const g of askGear) { moveItem(theirGear, ctx.myGear, g); got.push(g.name); }
  if (ctx.kind !== "caravan") intoArsenalFromShelf(state, f, offerGear); // arsenal.js: the guns and armour they bought go to their fighters
  if (ctx.kind === "visit" && f.wares.length > WARES_MAX) f.wares.splice(0, f.wares.length - WARES_MAX);
  // Intel: the tiles paid for are reported (a team carries the report home, or radios it in when in contact).
  const tiles = intelTiles(state, ctx.center, t.intel);
  if (tiles.length) {
    if (ctx.p) {
      for (const id of tiles) ctx.p.seen.set(id, snapshot(state, id));
      if (ctx.p.radioLive) mergeKnowledge(state, ctx.p.seen);
    } else for (const id of tiles) state.knowledge[id] = snapshot(state, id);
    got.push(`a report on ${tiles.length} tile${tiles.length === 1 ? "" : "s"}`);
  }
  if (t.intel.sell) { f.lastIntelBuy = day(state); gave.push("your maps"); }
  if (v.honoured && ctx.caravan) ctx.caravan.dealDone = true;
  armsSold(state, f, Object.entries(t.offer).reduce((a, [k, q]) => a + (isRoundKey(k) || k === "ammo" ? q || 0 : 0), 0), offerGear.some((g) => GEAR[g.key] && GEAR[g.key].slot === "weapon")); // diplomacy.js: arming one side of a war
  tradeGoodwill(state, f, tot.offer + tot.ask, tot.offer - tot.ask);
  f.lastDiplomacy = day(state);
  t.offer = {};
  t.ask = {};
  t.offerGear = [];
  t.askGear = [];
  t.intel = { area: "", sightings: false, sell: false };
  t.deal = null;
  const msg = `Traded with ${f.name}: ${gave.join(", ") || "nothing"} for ${got.join(", ") || "nothing"}.`;
  // skills.js: Speech XP for whoever did the talking (the best Speech on the team, or at the base).
  const talkers = ctx.kind === "visit" ? partyMembers(state, ctx.p) : atBase(state, ctx.base.id);
  gainXp(state, [...talkers].sort((a, b) => skill(b, "speech") - skill(a, "speech") || a.id - b.id)[0], "speech", USE.trade);
  log(state, msg, "good");
  return msg;
}

export function giftAll(state) {
  // The offered goods become a gift.
  const ctx = tradeContext(state);
  const tot = tradeTotals(state);
  if (!ctx || tot.offer <= 0) return "Offer something first.";
  if (ctx.kind === "radio") return "A gift cannot go over the radio: give it at their gates, or when their caravan is at yours.";
  const { t, f } = ctx;
  const theirSup = ctx.kind === "caravan" ? ctx.caravan.goods.supplies : f.stock;
  const theirGear = ctx.kind === "caravan" ? ctx.caravan.goods.gear : (f.wares = f.wares || []);
  for (const [k, q] of Object.entries(t.offer)) {
    if (!(q > 0)) continue;
    if (ctx.kind === "visit") takeFromParty(ctx.p, k, q);
    else ctx.base.stock[k] = (ctx.base.stock[k] || 0) - q;
    const tk = ctx.kind === "caravan" ? k : groupStockKey(k, f);
    theirSup[tk] = (theirSup[tk] || 0) + q;
  }
  const given = liveGear(t.offerGear, ctx.myGear);
  for (const g of given) moveItem(ctx.myGear, theirGear, g);
  if (ctx.kind !== "caravan") intoArsenalFromShelf(state, f, given); // arsenal.js
  const today = day(state);
  if (f.giftGwDay !== today) { f.giftGwDay = today; f.giftGw = 0; }
  const gain = Math.max(0, Math.min(tot.offer / 6, 15 - f.giftGw));
  f.giftGw += gain;
  if (gain > 0) changeGoodwill(state, f, gain, "a gift");
  f.lastDiplomacy = day(state);
  t.offer = {};
  t.offerGear = [];
  return `${f.name} accepts the gift.${gain < 1 ? " (They have had plenty of gifts today.)" : ""}`;
}

export function proposePact(state, f, kind) {
  const att = attitude(f);
  if (att === "Hostile") return `${f.name} will not sign anything with you.`;
  if (kind === "nonaggression") {
    const needed = isAggressiveType(f) ? -15 : -10;
    if (f.goodwill < needed) return `${f.name} refuses. (Needs goodwill ${needed} or more.)`;
    f.pact = f.pact === "trade" ? "trade" : "nonaggression";
    f.goodwill = Math.max(f.goodwill, needed + 5);
    f.lastDiplomacy = day(state);
    log(state, `Non-aggression pact signed with ${f.name}.`, "good");
    return "Pact signed.";
  }
  if (kind === "trade") {
    if (f.goodwill < 20) return `${f.name} does not trust you enough for a trade pact yet. (Needs goodwill 20.)`;
    f.pact = "trade";
    f.lastDiplomacy = day(state);
    log(state, `Trade pact signed with ${f.name}. You can now set up a trade route.`, "good");
    return "Trade pact signed.";
  }
  return att;
}

// Closing the window. A team waits for orders (a trade caravan of yours gets its caravan card back); their
// caravan stays at your base until its day is up (reopen it from the Bases tab).
export function endTrade(state) {
  const ctx = tradeContext(state);
  state.trade = null;
  if (ctx && ctx.p) {
    if (ctx.p.caravan) caravanCard(state, ctx.p, `Left ${ctx.f.name}.`);
    else awaitOrders(state, ctx.p, `Left ${ctx.f.name}.`);
  }
  advanceTradeQueue(state); // the next team waiting at a gate gets the screen
}

// ---------- trade routes ----------
// A route swaps a fixed load for another good at the group's barter prices (the same model as every trade, with
// no haggling: Speech 0). The terms are checked when the route is set up and again at every exchange, so a
// convoy never brings back more than its load is worth that day.
export function routeWorth(state, f, sendKey, sendQty, recvKey) {
  const q = Math.max(0, sendQty);
  const worth = q > 0 ? q * sellPrice(state, f, sendKey, 0, q) : 0;
  return { worth, maxRecv: maxBuyable(state, f, recvKey, 0, worth, Math.max(0, Math.floor(stockOf(f, recvKey)))) };
}

// Checks route terms { factionId, sendKey, sendQty, recvKey, recvQty }. Returns "" when they are acceptable,
// otherwise the reason as a sentence the form can show.
export function routeProblem(state, terms) {
  const f = factionById(state, terms.factionId);
  if (!f || !f.alive) return "That group is gone.";
  if (f.pact !== "trade") return `${f.name} has no trade pact with you.`;
  const { sendKey, recvKey } = terms;
  const sendQty = Number(terms.sendQty), recvQty = Number(terms.recvQty);
  if (!SUPPLIES[sendKey] || !SUPPLIES[recvKey]) return "Pick what to send and what to receive.";
  if (sendKey === recvKey) return "Send one kind of goods and receive another.";
  if (!Number.isInteger(sendQty) || sendQty < 1) return "Send a whole number, at least 1.";
  if (!Number.isInteger(recvQty) || recvQty < 1) return "Ask for a whole number, at least 1.";
  const { maxRecv } = routeWorth(state, f, sendKey, sendQty, recvKey);
  if (maxRecv < 1) return `${f.name} will not give any ${recvKey} for ${sendQty} ${sendKey}. Send more.`;
  if (recvQty > maxRecv) return `${f.name} will give at most ${maxRecv} ${recvKey} for ${sendQty} ${sendKey} at today's prices.`;
  return "";
}

// Sets up a route after checking the terms: { factionId, sendKey, sendQty, recvKey, recvQty, interval, escort,
// escortIds }. Returns { route } or { error } (the reason from routeProblem).
export function createRoute(state, terms) {
  const error = routeProblem(state, terms);
  if (error) return { error };
  const f = factionById(state, terms.factionId);
  const route = {
    id: newId(), factionId: f.id, sendKey: terms.sendKey, sendQty: Number(terms.sendQty), recvKey: terms.recvKey, recvQty: Number(terms.recvQty),
    interval: Math.max(2, Math.round(Number(terms.interval) || 5)), escort: terms.escort || "standard", escortIds: [...(terms.escortIds || [])],
    nextDay: day(state), active: true,
  };
  state.routes.push(route);
  for (const id of route.escortIds) {
    const s = survivorById(state, id);
    if (s) s.location = { kind: "route", routeId: route.id };
  }
  log(state, `Trade route to ${f.name} set up. The first convoy leaves at the next dawn.`, "good");
  return { route };
}

// A route convoy at the partner's gates (parties.js convoyArrive): the load is handed over and paid for at the
// prices of the day. The convoy gets the agreed amount at most, never more than the load is worth to them now
// and never more than they have; one log line says so when that is less than agreed.
export function routeExchange(state, p, route, f) {
  const sent = Math.max(0, p.cargo.supplies[route.sendKey] || 0);
  const { maxRecv } = routeWorth(state, f, route.sendKey, sent, route.recvKey);
  const agreed = route.sendQty > 0 ? Math.floor(route.recvQty * Math.min(1, sent / route.sendQty)) : 0;
  const have = Math.max(0, Math.floor(isRoundKey(route.recvKey) ? stockOf(f, route.recvKey) : f.stock[route.recvKey] || 0));
  const give = Math.max(0, Math.min(agreed, maxRecv, have));
  f.stock[poolKey(route.sendKey)] = (f.stock[poolKey(route.sendKey)] || 0) + sent; // one water pool
  p.cargo.supplies[route.sendKey] = 0;
  f.stock[poolKey(route.recvKey)] = (f.stock[poolKey(route.recvKey)] || 0) - give; // a round key: out of their one ammo count
  p.cargo.supplies[route.recvKey] = (p.cargo.supplies[route.recvKey] || 0) + give;
  if (give < agreed) {
    const why = have <= maxRecv ? "that is all they have" : "that is what the load is worth to them today";
    log(state, `${f.name} gave ${give} ${route.recvKey} for ${Math.floor(sent)} ${route.sendKey}, not the agreed ${agreed}: ${why}.`, "info");
  }
  return { sent, give, agreed };
}

// ---------- radio (radio.js) ----------
export const canRadio = (state, f) => canRadioGroup(state, f);
export const radioTalk = (state, f) => radioGreet(state, f);

