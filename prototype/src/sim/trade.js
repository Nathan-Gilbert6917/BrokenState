// Barter with AI groups: prices follow each group's real stock levels.
import { SUPPLIES, SUPPLY_KEYS } from "./data.js";
import { log, day, hub, factionById, radioBasesInRange } from "./world.js";
import { partyMembers, bestSkill, awaitOrders } from "./parties.js";
import { attitude, changeGoodwill, isAggressiveType } from "./factions.js";

const REF = { food: 6, water: 3, fuel: 2, meds: 1, ammo: 10, parts: 0.5, scrap: 3 };

// How much this group values one unit, based on how short they are.
export function need(f, key) {
  const per = (f.stock[key] || 0) / Math.max(1, f.pop);
  return Math.max(0.5, Math.min(2.2, 2 - per / REF[key]));
}
export function sellPrice(state, f, key, speech) {
  // what they pay you per unit
  return SUPPLIES[key].value * need(f, key) * (0.8 + Math.min(0.2, speech * 0.012));
}
export function buyPrice(state, f, key, speech) {
  // what you pay them per unit
  return SUPPLIES[key].value * need(f, key) * (1.25 - Math.min(0.2, speech * 0.012));
}

export function tradeContext(state) {
  const t = state.trade;
  if (!t) return null;
  const p = state.parties.find((q) => q.id === t.partyId);
  const f = factionById(state, t.factionId);
  if (!p || !f) return null;
  const speech = bestSkill(state, p, "speech");
  // You trade from what the team carries: supplies plus anything found.
  const have = {};
  for (const k of SUPPLY_KEYS) have[k] = Math.floor((p.supplies[k] || 0) + (p.cargo.supplies[k] || 0));
  return { p, f, speech, have };
}

export function tradeTotals(state) {
  const ctx = tradeContext(state);
  if (!ctx) return null;
  const { f, speech } = ctx;
  let offer = 0, ask = 0;
  for (const [k, q] of Object.entries(state.trade.offer)) offer += q * sellPrice(state, f, k, speech);
  for (const [k, q] of Object.entries(state.trade.ask)) ask += q * buyPrice(state, f, k, speech);
  return { offer, ask };
}

function takeFromParty(p, key, qty) {
  const fromCargo = Math.min(qty, Math.floor(p.cargo.supplies[key] || 0));
  p.cargo.supplies[key] = (p.cargo.supplies[key] || 0) - fromCargo;
  p.supplies[key] = (p.supplies[key] || 0) - (qty - fromCargo);
}

export function executeTrade(state) {
  const ctx = tradeContext(state);
  const tot = tradeTotals(state);
  if (!ctx || tot.offer < tot.ask || tot.offer === 0) return "The deal is not balanced.";
  const { p, f } = ctx;
  for (const [k, q] of Object.entries(state.trade.offer)) {
    takeFromParty(p, k, q);
    f.stock[k] = (f.stock[k] || 0) + q;
  }
  for (const [k, q] of Object.entries(state.trade.ask)) {
    f.stock[k] -= q;
    p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) + q;
  }
  // Generous deals earn goodwill.
  const extra = tot.offer - tot.ask;
  changeGoodwill(state, f, 1 + Math.min(8, extra / 10), "a fair trade");
  f.lastDiplomacy = day(state);
  state.trade.offer = {};
  state.trade.ask = {};
  return `Traded with ${f.name}.`;
}

export function giftAll(state) {
  // The offered goods become a gift.
  const ctx = tradeContext(state);
  const tot = tradeTotals(state);
  if (!ctx || tot.offer <= 0) return "Offer something first.";
  const { p, f } = ctx;
  for (const [k, q] of Object.entries(state.trade.offer)) {
    takeFromParty(p, k, q);
    f.stock[k] = (f.stock[k] || 0) + q;
  }
  changeGoodwill(state, f, Math.min(20, tot.offer / 6), "a gift");
  f.lastDiplomacy = day(state);
  state.trade.offer = {};
  return `${f.name} accepts the gift.`;
}

export function proposePact(state, f, kind) {
  const att = attitude(f);
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

export function endTrade(state) {
  const ctx = tradeContext(state);
  state.trade = null;
  if (ctx) awaitOrders(state, ctx.p, `Left ${ctx.f.name}.`);
}

export function canRadio(state, f) {
  return f.bases.some((b) => radioBasesInRange(state, b, 4).length > 0);
}

export function radioTalk(state, f) {
  if (!canRadio(state, f)) return "Out of radio range.";
  if (day(state) - (f.lastRadio || -99) < 3) return "You talked recently. Give it a few days.";
  f.lastRadio = day(state);
  f.lastDiplomacy = day(state);
  changeGoodwill(state, f, attitude(f) === "Hostile" ? 1 : 2, "regular contact");
  return `You keep in touch with ${f.name} over the radio.`;
}

