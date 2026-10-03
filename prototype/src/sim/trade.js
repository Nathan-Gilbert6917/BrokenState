// Barter with AI groups. One price model for every trade: visits by your teams (and trade caravans), their
// caravans at your gates, deals made over the radio (radio.js) and trade routes.
//
// Price model
// - Gear: itemValue(item) = base value (data.js GEAR) × quality factor (0.2 + 0.8 × condition) × durability factor
//   (makeshift gear: 0.3 + 0.7 × uses left / full uses; real gear does not wear and counts 1). A pack adds its contents.
// - Supplies: base value (data.js SUPPLIES) × the group's need for it (their stock per head against a reference:
//   0.5 when they have plenty, up to 2.2 when they have none). Every unit of a deal is priced along that curve:
//   q units are priced at the stock level halfway through the deal (stock + q/2 when they buy, stock − q/2 when
//   they sell), so a big sale pays less per unit and selling something then buying it back always loses.
// - Spread: they pay you value × (0.75 + Speech bonus + goodwill bonus) and charge you value × (1.3 − both).
//   Speech bonus = 0.008 per point of your best Speech (up to 0.12), goodwill bonus = goodwill / 1000 (−0.1 … +0.1),
//   so what they charge is always more than what they pay for the same thing.
// - A deal is fair for them when what you give, at their buying price, is worth at least what you take, at
//   their selling price. Deals agreed over the radio are honoured at the agreed amounts.
// - Goodwill from trading grows with the deal's size and with what you overpay, at most 4 a day per group (the old
//   flat +1 per trade could be farmed with tiny deals). Gifts give up to 15 a day.
import { SUPPLIES, SUPPLY_KEYS, GEAR } from "./data.js";
import { log, day, newId, survivorById, factionById, baseById, atBase, skill, snapshot, mergeKnowledge } from "./world.js";
import { partyMembers, partyTile, bestSkill, awaitOrders, partyCapacity, cargoLoad } from "./parties.js";
import { attitude, changeGoodwill, isAggressiveType } from "./factions.js";
import { ransomOnTradeCard } from "./conflicts.js";
import { itemLoad, newItem } from "./inventory.js";
import { itemDur } from "./crafting.js";
import { canRadioGroup, radioGreet } from "./radio.js";
import { caravanCard } from "./caravans.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- item and supply values ----------
export function itemValue(item) {
  const d = item && GEAR[item.key];
  if (!d) return 0;
  const q = clamp(Number.isFinite(item.quality) ? item.quality : 1, 0, 1.5);
  const dur = itemDur(item);
  const durF = dur == null ? 1 : 0.3 + 0.7 * clamp(dur / d.dur, 0, 1);
  let v = d.value * (0.2 + 0.8 * q) * durF;
  if (Array.isArray(item.contents)) for (const c of item.contents) if (c) v += itemValue(c);
  return v;
}

// Stock per head at which a group is comfortable (need 1 at the reference, 0.5 at 1.5× it, 2.2 at none).
const REF = { food: 6, water: 5, fuel: 2, meds: 1, ammo: 10, parts: 0.5, scrap: 3 };
// Per head a group never sells: it keeps this much for itself.
const RESERVE = { food: 2, water: 1.5, fuel: 0.5, meds: 0.3, ammo: 3, parts: 0, scrap: 0 };
// Groups always have some water (wells, rain barrels): with no figure yet they count as comfortable.
const stockOf = (f, key) => Math.max(0, f.stock[key] ?? (key === "water" ? f.pop * REF.water : 0));

// How much this group values one unit at a given stock level (default: what they hold now).
export function need(f, key, stock = stockOf(f, key)) {
  const per = Math.max(0, stock) / Math.max(1, f.pop);
  return clamp(2 - per / REF[key], 0.5, 2.2);
}
export function spread(f, speech = 0) {
  const s = Math.min(0.12, Math.max(0, speech || 0) * 0.008);
  const g = clamp((f.goodwill || 0) / 1000, -0.1, 0.1);
  return { sell: 0.75 + s + g, buy: 1.3 - s - g };
}
// What they pay you per unit when they take qty units (stock rising as they do).
export function sellPrice(state, f, key, speech, qty = 1) {
  const q = Math.max(1, qty);
  return SUPPLIES[key].value * need(f, key, stockOf(f, key) + q / 2) * spread(f, speech).sell;
}
// What you pay them per unit when you take qty units (stock falling as you do).
export function buyPrice(state, f, key, speech, qty = 1) {
  const q = Math.max(1, qty);
  return SUPPLIES[key].value * need(f, key, stockOf(f, key) - q / 2) * spread(f, speech).buy;
}
export const gearSellPrice = (f, item, speech) => itemValue(item) * spread(f, speech).sell;
export const gearBuyPrice = (f, item, speech) => itemValue(item) * spread(f, speech).buy;
// What a group can spare of a supply (they keep a reserve per head).
export const available = (f, key) => Math.max(0, Math.floor(stockOf(f, key) - (RESERVE[key] || 0) * f.pop));

// Largest whole amount of `key` whose total buying price stays within `budget` (binary search, prices move with qty).
export function maxBuyable(state, f, key, speech, budget, cap = Infinity) {
  let lo = 0, hi = Math.max(0, Math.floor(Math.min(cap, available(f, key))));
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
const WARES = {
  traders: ["pistol", "shotgun", "huntrifle", "vest", "machete", "bikehelmet", "kneeguards", "backpack", "bandagekit", "crowbar", "waterfilter", "assaultpack"],
  commune: ["machete", "huntrifle", "pipespear", "waterfilter", "bandagekit", "backpack", "padding"],
  military: ["ar", "vest", "plate", "riothelmet", "milradio", "nvg", "assaultpack", "pistol"],
  fortress: ["shotgun", "huntrifle", "vest", "riothelmet", "kneeguards", "crowbar"],
  raider: ["pistol", "shotgun", "machete", "spikedbat", "tirevest", "bikehelmet", "pipegun"],
  expansionist: ["pistol", "shotgun", "huntrifle", "vest", "riothelmet", "scrapvest"],
  zealot: ["machete", "knife", "shotgun", "pipespear", "bandagekit"],
};
export const WARES_MAX = 12;
// Fills a group's gear for sale (sim-side only: uses the world's random numbers). refresh: new stock for the week.
export function ensureWares(state, f, refresh = false) {
  if (f.wares && !refresh) return f.wares;
  const rng = state.rng;
  const pool = WARES[f.type] || WARES.traders;
  const n = f.type === "traders" ? rng.int(4, 6) : rng.int(1, 3);
  const keep = (f.wares || []).slice(-Math.max(0, WARES_MAX - n));
  for (let i = 0; i < n; i++) {
    const it = newItem(rng.pick(pool), Math.round(rng.range(0.5, 1) * 100) / 100);
    if (it.dur) it.dur = Math.max(1, Math.round(it.dur * rng.range(0.4, 1)));
    keep.push(it);
  }
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
  if (t.deal) {
    t.offer = { ...t.deal.offer };
    t.ask = { ...t.deal.ask };
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
  const f = factionById(state, t.factionId);
  if (!f || !f.alive) return null;
  const have = {}, theirHave = {};
  if (t.caravanId != null) {
    const c = state.parties.find((q) => q.id === t.caravanId);
    const base = baseById(state, t.baseId);
    if (!c || !base || c.phase !== "trading") return null;
    const speech = Math.max(0, ...atBase(state, base.id).map((s) => skill(s, "speech")));
    for (const k of SUPPLY_KEYS) {
      have[k] = Math.max(0, Math.floor(base.stock[k] || 0));
      theirHave[k] = Math.max(0, Math.floor(c.goods.supplies[k] || 0));
    }
    return { kind: "caravan", t, f, caravan: c, base, p: null, speech, have, theirHave, myGear: base.armory, theirGear: c.goods.gear, center: f.bases[0] ?? partyTile(c) };
  }
  const p = state.parties.find((q) => q.id === t.partyId);
  if (!p) return null;
  const speech = bestSkill(state, p, "speech");
  // You trade from what the team carries: supplies plus anything found.
  for (const k of SUPPLY_KEYS) {
    have[k] = Math.max(0, Math.floor((p.supplies[k] || 0) + (p.cargo.supplies[k] || 0)));
    theirHave[k] = available(f, k);
  }
  return { kind: "visit", t, f, p, caravan: null, base: null, speech, have, theirHave, myGear: p.cargo.gear, theirGear: f.wares || [], center: partyTile(p) };
}

// The items in the deal that are still where they were (a list can change while the window is open).
const liveGear = (list, pool) => (list || []).filter((g) => pool.includes(g));

// Totals at the group's prices: offer = what they give you credit for, ask = what they charge. lines: per row.
export function tradeTotals(state) {
  const ctx = tradeContext(state);
  if (!ctx) return null;
  const { t, f, speech } = ctx;
  let offer = 0, ask = 0;
  const lines = { offer: {}, ask: {}, intel: {} };
  for (const [k, q] of Object.entries(t.offer)) if (q > 0) { const v = q * sellPrice(state, f, k, speech, q); lines.offer[k] = v; offer += v; }
  for (const [k, q] of Object.entries(t.ask)) if (q > 0) { const v = q * buyPrice(state, f, k, speech, q); lines.ask[k] = v; ask += v; }
  for (const g of liveGear(t.offerGear, ctx.myGear)) offer += gearSellPrice(f, g, speech);
  for (const g of liveGear(t.askGear, ctx.theirGear)) ask += gearBuyPrice(f, g, speech);
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
  for (const [k, q] of Object.entries(t.offer)) if (q > (ctx.have[k] || 0)) return out(false, `You only have ${ctx.have[k] || 0} ${k}.`);
  for (const [k, q] of Object.entries(t.ask)) if (q > (ctx.theirHave[k] || 0)) return out(false, `They can spare only ${ctx.theirHave[k] || 0} ${k}.`);
  // Carry space: a team carries what it gets; their caravan carries what it takes.
  if (ctx.kind === "visit") {
    const p = ctx.p;
    const freed = Object.entries(t.offer).reduce((s, [k, q]) => s + Math.min(q, Math.floor(p.cargo.supplies[k] || 0)) * SUPPLIES[k].weight, 0) + gearWeight(offerGear);
    const room = partyCapacity(state, p) - cargoLoad(p.cargo) + freed;
    const need = weigh(t.ask) + gearWeight(askGear);
    // Only a deal that adds weight is held to it (a team that is already loaded can still hand goods over).
    if (need > room + 1e-9 && need > freed + 1e-9) return out(false, `The team cannot carry that much: what you ask for weighs ${Math.ceil(need)}, and there is room for ${Math.max(0, Math.floor(room))}.`);
  } else {
    const c = ctx.caravan;
    const room = c.capacity - weigh(c.goods.supplies) - gearWeight(c.goods.gear) + weigh(t.ask) + gearWeight(askGear);
    const need = weigh(t.offer) + gearWeight(offerGear);
    if (need > room + 1e-9 && need > weigh(t.ask) + gearWeight(askGear) + 1e-9) return out(false, `Their caravan cannot carry that much: your goods weigh ${Math.ceil(need)}, and they have room for ${Math.max(0, Math.floor(room))}.`);
  }
  if (t.deal && sameMap(t.offer, t.deal.offer) && sameMap(t.ask, t.deal.ask) && !offerGear.length && !askGear.length && !t.intel.area && !t.intel.sightings && !t.intel.sell) {
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
  const max = side === "mine" ? ctx.have[key] || 0 : ctx.theirHave[key] || 0;
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
  else list.push(item);
}
export function setIntel(state, field, value) {
  const ctx = tradeContext(state);
  if (!ctx) return;
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
  const q = maxBuyable(state, f, key, speech, curV + (tot.offer - tot.ask), ctx.theirHave[key] || 0);
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
  const { t, f } = ctx;
  const offerGear = liveGear(t.offerGear, ctx.myGear), askGear = liveGear(t.askGear, ctx.theirGear);
  const theirSup = ctx.kind === "caravan" ? ctx.caravan.goods.supplies : f.stock;
  const theirGear = ctx.kind === "caravan" ? ctx.caravan.goods.gear : (f.wares = f.wares || []);
  const gave = [], got = [];
  for (const [k, q] of Object.entries(t.offer)) {
    if (!(q > 0)) continue;
    if (ctx.kind === "visit") takeFromParty(ctx.p, k, q);
    else ctx.base.stock[k] = (ctx.base.stock[k] || 0) - q;
    theirSup[k] = (theirSup[k] || 0) + q;
    gave.push(`${q} ${k}`);
  }
  for (const [k, q] of Object.entries(t.ask)) {
    if (!(q > 0)) continue;
    theirSup[k] = (theirSup[k] || 0) - q;
    if (ctx.kind === "visit") ctx.p.cargo.supplies[k] = (ctx.p.cargo.supplies[k] || 0) + q;
    else ctx.base.stock[k] = (ctx.base.stock[k] || 0) + q;
    got.push(`${q} ${k}`);
  }
  for (const g of offerGear) { moveItem(ctx.myGear, theirGear, g); gave.push(g.name); }
  for (const g of askGear) { moveItem(theirGear, ctx.myGear, g); got.push(g.name); }
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
  tradeGoodwill(state, f, tot.offer + tot.ask, tot.offer - tot.ask);
  f.lastDiplomacy = day(state);
  t.offer = {};
  t.ask = {};
  t.offerGear = [];
  t.askGear = [];
  t.intel = { area: "", sightings: false, sell: false };
  t.deal = null;
  const msg = `Traded with ${f.name}: ${gave.join(", ") || "nothing"} for ${got.join(", ") || "nothing"}.`;
  log(state, msg, "good");
  return msg;
}

export function giftAll(state) {
  // The offered goods become a gift.
  const ctx = tradeContext(state);
  const tot = tradeTotals(state);
  if (!ctx || tot.offer <= 0) return "Offer something first.";
  const { t, f } = ctx;
  const theirSup = ctx.kind === "caravan" ? ctx.caravan.goods.supplies : f.stock;
  const theirGear = ctx.kind === "caravan" ? ctx.caravan.goods.gear : (f.wares = f.wares || []);
  for (const [k, q] of Object.entries(t.offer)) {
    if (!(q > 0)) continue;
    if (ctx.kind === "visit") takeFromParty(ctx.p, k, q);
    else ctx.base.stock[k] = (ctx.base.stock[k] || 0) - q;
    theirSup[k] = (theirSup[k] || 0) + q;
  }
  for (const g of liveGear(t.offerGear, ctx.myGear)) moveItem(ctx.myGear, theirGear, g);
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
  const have = Math.max(0, Math.floor(f.stock[route.recvKey] || 0));
  const give = Math.max(0, Math.min(agreed, maxRecv, have));
  f.stock[route.sendKey] = (f.stock[route.sendKey] || 0) + sent;
  p.cargo.supplies[route.sendKey] = 0;
  f.stock[route.recvKey] = (f.stock[route.recvKey] || 0) - give;
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

