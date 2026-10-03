// Barter with AI groups: prices follow each group's real stock levels.
import { SUPPLIES, SUPPLY_KEYS } from "./data.js";
import { log, addCard, day, hub, newId, survivorById, factionById, radioBasesInRange } from "./world.js";
import { partyMembers, partyTile, bestSkill, awaitOrders, partyCapacity, cargoLoad } from "./parties.js";
import { attitude, changeGoodwill, isAggressiveType } from "./factions.js";
import { ransomOnTradeCard } from "./conflicts.js";

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

// ---------- trade visits: one screen at a time, the rest wait their turn ----------
// state.trade is the visit on screen. A second team that arrives for a visit while one is open goes into
// state.tradeQueue (like battles in combat.js) instead of taking the screen and leaving the first team stuck.
export function openTrade(state, p, f) {
  const visit = { partyId: p.id, factionId: f.id, offer: {}, ask: {} };
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
  if (ransom) addCard(state, ransom);
}

// Is a trade visit for this team open or waiting its turn?
export const tradePending = (state, partyId) =>
  !!(state.trade && state.trade.partyId === partyId) || (state.tradeQueue || []).some((v) => v.partyId === partyId);

// Opens the next waiting visit when the screen is free. A waiting team that is gone or has moved on is skipped;
// one whose hosts are gone or have turned hostile gets orders instead.
export function advanceTradeQueue(state) {
  if (state.trade && !tradeContext(state)) state.trade = null; // that team or group no longer exists
  const q = state.tradeQueue;
  while (!state.trade && q && q.length) {
    const v = q.shift();
    const p = state.parties.find((x) => x.id === v.partyId);
    const f = factionById(state, v.factionId);
    if (!p || p.phase !== "engaged" || !partyMembers(state, p).length) continue;
    if (!f || !f.alive || attitude(f) === "Hostile" || !f.bases.includes(partyTile(p))) {
      awaitOrders(state, p, `${f ? f.name : "They"} will not trade now.`);
      continue;
    }
    beginVisit(state, v, p, f);
  }
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
  // What you get has to be carried (it goes into the cargo): the room left after the offered goods are handed over.
  const weigh = (o) => Object.entries(o).reduce((s, [k, q]) => s + q * SUPPLIES[k].weight, 0);
  const freed = Object.entries(state.trade.offer).reduce((s, [k, q]) => s + Math.min(q, Math.floor(p.cargo.supplies[k] || 0)) * SUPPLIES[k].weight, 0);
  const room = partyCapacity(state, p) - cargoLoad(p.cargo) + freed;
  if (weigh(state.trade.ask) > room + 1e-9) return `The team cannot carry that much: what you ask for weighs ${Math.ceil(weigh(state.trade.ask))}, and there is room for ${Math.max(0, Math.floor(room))}.`;
  for (const [k, q] of Object.entries(state.trade.offer)) {
    takeFromParty(p, k, q);
    f.stock[k] = (f.stock[k] || 0) + q;
  }
  for (const [k, q] of Object.entries(state.trade.ask)) {
    f.stock[k] = (f.stock[k] || 0) - q;
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
  advanceTradeQueue(state); // the next team waiting at a gate gets the screen
}

// ---------- trade routes ----------
// A route swaps a fixed load for another good at the group's barter prices (the same sellPrice / buyPrice as a
// trade visit, with no haggling: Speech 0). The terms are checked when the route is set up and again at every
// exchange, so a convoy never brings back more than its load is worth that day.
export function routeWorth(state, f, sendKey, sendQty, recvKey) {
  const worth = Math.max(0, sendQty) * sellPrice(state, f, sendKey, 0);
  return { worth, maxRecv: Math.floor(worth / buyPrice(state, f, recvKey, 0) + 1e-9) };
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

