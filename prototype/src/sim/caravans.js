// Caravans: the groups' caravans that come to your bases to trade, and your own trade caravans with a list of
// destinations.
//
// Their caravans (party kind "caravan", owner = the group)
// - Sent when a radio deal or request is agreed (radio.js), or as aid. They walk with a wagon (the group's convoy
//   sprite) along a land route from their main base; no land route, no caravan. Guards: 2 + 1 per 12 people
//   (at most 5), each as strong as one of their fighters. Carry space 60 + 15 per guard.
// - Hordes and raiders on the way can hit them like any other group party (parties.js aiPartyHour); a raider gang
//   that wins takes everything it carries. Your teams can attack one anywhere on the road (caravanraids.js).
// - At your base the trade window opens (or waits its turn) with any radio deal filled in. The caravan stays
//   CARAVAN_STAY_HOURS (24) and then goes home with what it has; reopen the window from the Bases tab meanwhile.
//   A radio deal not done by then costs 3 goodwill.
// - You may attack it (trade window or Bases tab): a battle at your base against its guards. Win and its goods
//   are yours; either way the group turns hostile (goodwill −70), tears up any pact, other groups you know that
//   are not aggressive lose 5 goodwill, and for 60 days the group sends raids whatever its type (radio.js).
//
// - A radio trade they bring (radiotrade.js) carries its items too: the window fills them in and honours them.
//
// Your trade caravans (a team with mission "caravan")
// - From the hub or another base (form.fromBaseId: a radio deal's base, or picked in the planner). At a group's base
//   with a radio deal waiting (radiotrade.js), the stop card's first choice completes it.
// - Crew, vehicle or on foot, goods to trade and gear from the hub's armory, and an ordered list of destinations
//   (known groups' bases, your outposts). It runs on the normal order queue: a move to the next stop, then the
//   caravan stop order. At each stop a card offers: trade there (the trade window), unload the goods (your
//   outposts), stay a day (24h camp), go on to the next destination, or return home, each with its ETA.
import { SUPPLIES, SUPPLY_KEYS, FACTION_TYPES } from "./data.js";
import { log, day, hub, baseById, factionById, addCard, atBase, survivorById } from "./world.js";
import {
  planPath, travelHours, spawnAiParty, removeParty, partyTile, tileLabel, partyMembers, awaitOrders, startReturn, launchExpedition,
  partySpeed, carryCapacity, supplyLoad, fuelForPath, plannedPace, paceOpts, modeSpeed, foodForHours, waterForHours,
} from "./parties.js";
import { attitude, changeGoodwill, isAggressiveType, baseDefense } from "./factions.js";
import { startCombat, registerCombatHandler } from "./combat.js";
import { startOrder } from "./orders.js";
import { partyVehicle, partyFuel, vehicleById, isCar } from "./vehicles.js";
import { itemLoad } from "./inventory.js";
import {
  available, need, demand, roundNeeds, openTrade, openCaravanTrade, tradeContext, executeTrade, endTrade, setQty, balanceWith, tradeVerdict, ensureWares, WARES_MAX,
  autoSellGear,
} from "./trade.js";
import { marketOf, groupStockKey } from "./trade.js";
import { partDeficit, kitWants } from "./repair.js"; // the parts and kits the governor keeps (it buys below them)
import { escortArrived, pickupArrived } from "./jobs.js";
import { keyWord } from "./water.js"; // "un-purified water" in texts
import { spendAmmo } from "./rounds.js"; // rounds by calibre
import { baseCals, expandAmmo, kindTheme } from "./ammo.js";
import { payoutBreaks } from "./upkeep.js"; // the governor never pays food or water out of the base's reserve
import { groupEscort, escortStrength, cargoValue } from "./escorts.js"; // a caravan's guards: the cargo's wish, what they can spare
import { pendingDeal, dealCarried, completeRadioDeal, goodsText } from "./radiotrade.js"; // deals agreed over the radio

export const CARAVAN_STAY_HOURS = 24;
export const CARAVAN_SPEED = 0.9; // on foot with a wagon (parties.js aiPartyHour)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- their caravans ----------
export const isCaravan = (p) => p && p.kind === "caravan";
export const caravanEnRoute = (state, f) => state.parties.some((p) => isCaravan(p) && p.owner === f.id && !p.leaving);
export const caravansAt = (state, baseId) => state.parties.filter((p) => isCaravan(p) && p.phase === "trading" && p.baseId === baseId);
export const incomingCaravans = (state) => state.parties.filter((p) => isCaravan(p) && !p.leaving && p.escortJob == null); // an escorted caravan (jobs.js) goes to another group
export const guardPower = (f) => 2.2 + FACTION_TYPES[f.type].arms * 1.6;
export const caravanGuards = (f, c) => (c.escort ? clamp(c.escort.guards, 1, 14) : clamp(Math.round(c.strength / guardPower(f)), 1, 8)); // escorts.js: who went with it
// Guards a group sends with a caravan, and what it can carry (radiotrade.js checks a radio deal against it).
const guardsFor = (f) => clamp(2 + Math.floor(f.pop / 12), 2, 5);
export const caravanCapacity = (f) => 60 + guardsFor(f) * 15;

// What a group brings when you just ask for a caravan: about half of what it can spare of the goods on its
// surplus list (trade.js marketOf: this week's), then of anything else it has plenty of, up to a value of about
// 160, and a few items from its wares.
export function caravanSurplus(state, f) {
  const goods = { supplies: {}, gear: [] };
  let value = 0;
  const listed = marketOf(state, f).surplus.map((x) => x.key);
  for (const k of [...listed, ...[...SUPPLY_KEYS].filter((x) => !listed.includes(x)).sort((a, b) => need(f, a) - need(f, b))]) {
    if (need(f, k) > 1.1 || value >= 160 || SUPPLIES[k].round) continue; // rounds: their one ammo count goes as "ammo" (sorted by calibre in the deal, trade.js)
    const q = Math.min(Math.floor(available(f, k) * 0.5), Math.ceil((160 - value) / SUPPLIES[k].value));
    if (q < 1) continue;
    goods.supplies[k] = q;
    value += q * SUPPLIES[k].value;
  }
  goods.gear = (f.wares || []).slice(0, f.type === "traders" ? 4 : 2);
  return goods;
}

// Sends a caravan from the group's main base to one of your bases. Takes the goods from their stock (they come
// back if the caravan gets home). Returns the party, or null when there is no land route.
export function sendCaravan(state, f, base, { goods = null, deal = null, gift = false } = {}) {
  const from = f.bases[0];
  if (from == null || !base) return null;
  const route = planPath(state, from, base.tile, false);
  if (!route) return null;
  const guards = guardsFor(f);
  const p = spawnAiParty(state, f, "caravan", from, base.tile, { strength: guards * guardPower(f) });
  if (!p) return null;
  const g = { supplies: {}, gear: [] };
  for (const [k, q] of Object.entries((goods && goods.supplies) || {})) {
    const sk = SUPPLIES[k] && SUPPLIES[k].round ? "ammo" : groupStockKey(k, f); // rounds by key come out of their one ammo count, a part kind out of their one count of parts
    const take = Math.max(0, Math.min(Math.floor(q), Math.floor(f.stock[sk] || 0)));
    if (!take) continue;
    f.stock[sk] -= take;
    g.supplies[k] = take;
  }
  if (!deal) expandAmmo(g.supplies, kindTheme(f.type)); // ammo.js: their "ammo" on the road as rounds by calibre (what their kind keeps), named wherever the load is shown; a deal's goods are keyed already
  for (const item of (goods && goods.gear) || []) {
    const i = (f.wares || []).indexOf(item);
    if (i < 0) continue;
    f.wares.splice(i, 1);
    g.gear.push(item);
  }
  const eta = travelHours(state, route.path, { vehicle: false, speed: CARAVAN_SPEED }).hours;
  Object.assign(p, { goods: g, deal, gift, dealDone: false, baseId: base.id, home: from, capacity: caravanCapacity(f), leaving: false, eta, sentDay: day(state) });
  escortParty(state, f, p, g); // escorts.js: the guards the cargo is worth to them, out of what they can spare
  f.known = true;
  f.lastDiplomacy = day(state);
  log(state, `${f.name} ${gift ? "send aid" : "send a caravan"} to ${base.name}. It should arrive in about ${eta}h.`, "info");
  return p;
}

// A group's caravan or convoy gets its escort (escorts.js groupEscort): what the cargo makes them want to send, out
// of the fighters they can spare from home (and their Humvee, if they have one free); its strength follows.
export function escortParty(state, f, p, goods) {
  p.escort = groupEscort(state, f, cargoValue(goods.supplies, goods.gear));
  p.strength = Math.max(1, escortStrength(p.escort));
  return p.escort;
}

// parties.js aiPartyHour: a caravan reached the end of its path.
export function caravanArrive(state, p) {
  const f = factionById(state, p.owner);
  if (p.escortJob != null && !p.leaving) {
    // A caravan you escorted (jobs.js) reached the other group: it unloads there and goes home.
    escortArrived(state, p);
    const back = f && f.alive ? planPath(state, partyTile(p), p.home, false) : null;
    if (!back) return removeParty(state, p);
    Object.assign(p, { leaving: true, phase: "out", path: back.path, idx: 0, progress: 0 });
    return;
  }
  if (p.leaving) {
    // Home again: what it carries goes back into their stores.
    if (f && f.alive) {
      for (const [k, q] of Object.entries(p.goods.supplies)) { const tk = k === "rawwater" ? "water" : k; f.stock[tk] = (f.stock[tk] || 0) + Math.max(0, q); } // one water pool (trade.js poolKey)
      f.wares = [...(f.wares || []), ...p.goods.gear].slice(-WARES_MAX);
    }
    removeParty(state, p);
    return;
  }
  const base = baseById(state, p.baseId);
  if (!base || !f || !f.alive || attitude(f) === "Hostile") {
    caravanLeave(state, p, "");
    return;
  }
  if (p.pickupJob != null && pickupArrived(state, p, base)) {
    // They came to fetch a job's goods (jobs.js): taken from the base's stores, then home.
    caravanLeave(state, p, "");
    return;
  }
  if (p.gift) {
    for (const [k, q] of Object.entries(p.goods.supplies)) base.stock[k] = (base.stock[k] || 0) + q;
    base.armory.push(...p.goods.gear);
    const what = Object.entries(p.goods.supplies).map(([k, q]) => `${q} ${keyWord(k)}`).join(", ") || "nothing";
    log(state, `Aid from ${f.name} reached ${base.name}: ${what}.`, "good");
    p.goods = { supplies: {}, gear: [] };
    caravanLeave(state, p, "");
    return;
  }
  p.phase = "trading";
  p.stayUntil = state.hour + CARAVAN_STAY_HOURS;
  f.known = true;
  log(state, `A caravan from ${f.name} has arrived at ${base.name}${p.deal ? " with the goods you agreed on" : ""}. It stays until day ${Math.floor(p.stayUntil / 24) + 1}, ${String(p.stayUntil % 24).padStart(2, "0")}:00.`, "good");
  openCaravanTrade(state, p);
}

// parties.js aiPartyHour, every hour a caravan is not on the road: it waits out its day at your base.
export function caravanHour(state, p) {
  if (p.phase === "trading" && state.hour >= p.stayUntil) caravanLeave(state, p, "Its day is up.");
  // A fight with it that never happened (nobody left to fight it): it goes home.
  if (p.phase === "fighting") {
    const mine = (s) => s && s.handler === "caravanAttack" && s.context && s.context.caravanId === p.id;
    if (!mine(state.combat && state.combat.setup) && !(state.combatQueue || []).some(mine)) { p.phase = "trading"; p.deal = null; caravanLeave(state, p, ""); }
  }
}

export function caravanLeave(state, p, why) {
  const f = factionById(state, p.owner);
  if (state.trade && state.trade.caravanId === p.id) state.trade = null;
  if (state.tradeQueue) state.tradeQueue = state.tradeQueue.filter((v) => v.caravanId !== p.id);
  if (p.phase === "trading" && p.deal && !p.dealDone && f && f.alive) changeGoodwill(state, f, -3, "you did not keep the deal");
  if (p.phase === "trading" && f && why) log(state, `The ${f.name} caravan leaves ${baseById(state, p.baseId)?.name || "your base"}. ${why}`, "info");
  const back = planPath(state, partyTile(p), p.home, false);
  if (!back || !f || !f.alive) return removeParty(state, p);
  p.phase = "out";
  p.leaving = true;
  p.path = back.path;
  p.idx = 0;
  p.progress = 0;
}

// ---------- attacking a caravan ----------
export function turnHostile(state, f, why) {
  changeGoodwill(state, f, -(f.goodwill + 70), why);
  f.grudgeUntil = day(state) + 60;
  f.raidCooldown = Math.min(f.raidCooldown ?? 99, 2);
  f.lastDiplomacy = day(state);
  for (const o of state.factions) {
    if (o === f || !o.alive || !o.known || isAggressiveType(o)) continue;
    changeGoodwill(state, o, -5, "word of your attack spreads");
  }
}

export function attackCaravan(state, p) {
  if (!isCaravan(p) || p.phase !== "trading") return "That caravan is not at your gates.";
  const f = factionById(state, p.owner);
  const base = baseById(state, p.baseId);
  if (!f || !base) return "";
  if (!atBase(state, base.id).length) return `Nobody at ${base.name} can fight.`;
  if (state.trade && state.trade.caravanId === p.id) state.trade = null;
  p.phase = "fighting";
  turnHostile(state, f, "you attacked their caravan");
  log(state, `You turn your guns on the ${f.name.replace(/^The /, "")} caravan at ${base.name}.`, "danger");
  startCombat(state, {
    tile: base.tile, baseId: base.id,
    enemy: { kind: "guards", count: caravanGuards(f, p), power: Math.round(guardPower(f) * 10) / 10, factionId: f.id, name: `${f.name} caravan guards` },
    ambush: "player", canRetreat: true, handler: "caravanAttack", context: { caravanId: p.id, baseId: base.id, factionId: f.id },
  });
  return "";
}

function onCaravanCombat(state, result, setup) {
  const c = setup.context;
  const p = state.parties.find((x) => x.id === c.caravanId);
  const f = factionById(state, c.factionId);
  const base = baseById(state, c.baseId);
  if (f) f.pop = Math.max(0, f.pop - Math.ceil((result.enemiesKilled || 0) * 0.7));
  let text;
  if (result.outcome === "victory" && p) {
    const sup = Object.entries(p.goods.supplies).filter(([, q]) => q >= 1);
    if (base) {
      for (const [k, q] of sup) base.stock[k] = (base.stock[k] || 0) + Math.floor(q);
      base.armory.push(...p.goods.gear);
    }
    const what = [...sup.map(([k, q]) => `${Math.floor(q)} ${keyWord(k)}`), ...p.goods.gear.map((g) => g.name)];
    removeParty(state, p);
    text = `The ${f ? f.name : ""} caravan is yours: ${what.join(", ") || "it carried nothing of use"}${base ? `, all in ${base.name}'s stores` : ""}. ${f ? `${f.name} will not forget it.` : ""}`;
    log(state, text, "danger");
  } else {
    if (p) {
      p.strength = Math.max(1, (result.enemiesLeft || 1) * (f ? guardPower(f) : 3));
      p.phase = "trading"; // so it leaves like any other caravan, with what it has
      p.deal = null;
      caravanLeave(state, p, "");
    }
    text = `The caravan guards held you off and got away. ${f ? `${f.name} are your enemies now.` : ""}`;
    log(state, text, "danger");
  }
  addCard(state, { title: "The caravan raid", text, choices: [{ label: "OK", resolve: () => "" }] });
}
registerCombatHandler("caravanAttack", onCaravanCombat);

// ---------- autopilot ----------
// The governor at their caravan: takes a radio deal if it can pay; otherwise buys what the hub is short of with
// what it has plenty of. Only the Aggressive style ever attacks a caravan (an aggressive group's, lightly
// guarded); Cautious and Balanced never do. Returns a log text.
export function autoCaravanTrade(state, needs, style, spare = {}) {
  const ctx = tradeContext(state);
  if (!ctx || ctx.kind !== "caravan") return "";
  const { f, caravan, base } = ctx;
  if (style === "aggressive" && isAggressiveType(f) && caravan.strength < 0.4 * baseDefense(state, base) && atBase(state, base.id).length >= 3) {
    attackCaravan(state, caravan);
    return `attacked the ${f.name.replace(/^The /, "")} caravan`;
  }
  let text = "nothing worth swapping";
  needs = roundNeeds(state, ctx, needs); // trade.js: ammo asked for and sold as rounds by calibre
  // A radio deal agreed days ago: paid only while the food or water it costs leaves the base its pay-out reserve
  // (upkeep.js PAYOUT); otherwise the caravan goes home without it.
  if (ctx.t.deal && payoutBreaks(state, base, ctx.t.offer)) text = `${base.name} cannot spare the food or water the deal costs now`;
  else if (ctx.t.deal && tradeVerdict(state).ok) text = executeTrade(state);
  else {
    ctx.t.offer = {}; ctx.t.ask = {}; ctx.t.deal = null;
    const short = Object.keys(needs).filter((k) => needs[k] >= 1.2 && (ctx.theirHave[k] || 0) > 0).sort((a, b) => needs[b] - needs[a]);
    // Pay with what they want most (trade.js demand: their stock, kind and state) among what the hub has plenty of.
    const plenty = Object.keys(needs).filter((k) => needs[k] <= 0.5 && (ctx.have[k] || 0) > 0).sort((a, b) => demand(state, f, b) - demand(state, f, a) || needs[a] - needs[b]);
    for (const k of short.slice(0, 2)) setQty(state, "theirs", k, Math.min(ctx.theirHave[k], k === "ammo" || (SUPPLIES[k] && SUPPLIES[k].round) ? 80 : ["parts", "carparts", "gunparts", "electronics"].includes(k) ? Math.max(1, partDeficit(state, base, k)) : 20));
    const kit = kitWants(state, base).map((k) => ctx.theirGear.find((g) => g && g.key === k)).find(Boolean); // a Kevlar or field repair kit (repair.js)
    if (kit && plenty.length) ctx.t.askGear = [kit];
    for (const k of plenty) {
      if (tradeVerdict(state).ok) break;
      if (!ctx.t.ask[k]) balanceWith(state, k);
      if (spare[k] != null && (ctx.t.offer[k] || 0) > spare[k]) setQty(state, "mine", k, spare[k]); // never below what the hub needs (autopilot.js tradeSpare)
    }
    if ((short.length || kit) && tradeVerdict(state).ok) text = executeTrade(state);
  }
  // Spare weapons to a group that prizes them (at war, hordes at its walls...), valuables to anyone who pays.
  if (tradeContext(state)) {
    const sold = autoSellGear(state, needs);
    if (/^Traded/.test(sold)) text = /^Traded/.test(text) ? `${text.replace(/\.$/, "")}; then ${sold.replace(/^Traded with [^:]+: /, "")}` : sold;
  }
  endTrade(state);
  return text;
}

// ---------- your trade caravans ----------
// Where a caravan can go: the bases of groups you know, and your outposts.
export function caravanDestinations(state) {
  const out = [];
  for (const f of state.factions) {
    if (!f.alive || !f.known) continue;
    for (const b of f.bases) out.push({ tile: b, name: `${f.name} (${tileLabel(state, b)})`, factionId: f.id, hostile: attitude(f) === "Hostile" });
  }
  for (const b of state.bases) if (b.type === "outpost") out.push({ tile: b.tile, name: `${b.name} (your outpost)`, baseId: b.id });
  return out;
}
const destName = (state, tile) => {
  const f = state.factions.find((x) => x.alive && x.bases.includes(tile));
  const b = state.bases.find((x) => x.tile === tile);
  return f && f.known ? f.name : b ? b.name : tileLabel(state, tile);
};

// Leg by leg estimate for a planned caravan: { legs: [{ tile, name, hours | null }], back, hours, food, water, fuel }.
export function caravanEstimate(state, form) {
  const h = caravanHome(state, form);
  const v0 = form.vehicleId ? vehicleById(state, form.vehicleId) : null;
  const v = isCar(v0) ? v0 : null; // caravans go by car or on foot
  // The caravan's load (goods and road supplies, load.js) sets its pace and rations, as for any team.
  const members = (form.crew || []).map((id) => survivorById(state, id)).filter(Boolean);
  const sup = {};
  for (const [k, q] of Object.entries(form.goods || {})) if (SUPPLIES[k] && q > 0) sup[k] = (sup[k] || 0) + q;
  for (const [k, q] of Object.entries(form.travel || {})) if (SUPPLIES[k] && q > 0) sup[k] = (sup[k] || 0) + q;
  const pace = plannedPace(state, { members, supplies: sup, v, stance: form.stance || "normal" });
  let from = h.tile, at = state.hour, total = 0, fuel = 0, ok = true, eat = 0, drink = 0;
  const n = Math.max(1, (form.crew || []).length);
  const legs = [];
  const leg = (to) => {
    const r = planPath(state, from, to, !!v) || null;
    if (!r) { ok = false; return null; }
    const t = travelHours(state, r.path, { vehicle: !!v, speed: pace.speed, footSpeed: pace.footSpeed, fuelMult: pace.fuelMult, startHour: at });
    fuel += v ? fuelForPath(state, r.path, pace.fuelMult) : 0;
    // Food and water hour by hour at each day's cold and thirst (weather.js: more in winter, in summer and a heat wave).
    const segs = members.length ? [[t.rideHours, pace.eatMove], [t.hours - t.rideHours, pace.eatFoot], [6, n]] : [[t.hours + 6, n]];
    eat += foodForHours(state, at, members.length ? [[t.rideHours, pace.foodMove], [t.hours - t.rideHours, pace.foodFoot], [6, pace.foodRest]] : segs); // food: each one's appetite (a Glutton)
    drink += waterForHours(state, at, segs);
    at += t.hours + 6;
    total += t.hours + 6;
    from = to;
    return t.hours;
  };
  for (const tile of form.stops || []) legs.push({ tile, name: destName(state, tile), hours: leg(tile) });
  const back = (form.stops || []).length ? leg(h.tile) : 0;
  return { legs, back, hours: total, ok, food: Math.ceil(eat * 1.25), water: Math.ceil(drink * 1.25), fuel: Math.ceil(fuel * 1.15), pace };
}

// The base a planned caravan sets out from: form.fromBaseId (a radio deal's base, or picked in the planner), else the hub.
export const caravanHome = (state, form) => (form.fromBaseId != null && baseById(state, form.fromBaseId)) || hub(state);

// Launches a trade caravan from the hub (or form.fromBaseId). form: { crew: [ids], vehicleId, stance, goods: { key: qty } to trade,
// travel: { key: qty } to live on, gear: [hub armory indices], stops: [tiles] }. Returns { party } or { error }.
export function launchCaravan(state, form) {
  const h = caravanHome(state, form);
  const stops = (form.stops || []).filter((t) => Number.isInteger(t));
  if (!stops.length) return { error: "Add at least one destination." };
  const goods = {}, supplies = {};
  for (const [k, q] of Object.entries(form.goods || {})) if (SUPPLIES[k] && q > 0) goods[k] = Math.floor(q);
  if (goods.ammo > 0) { // ammo.js: "N ammo" to trade goes as the rounds the hub's guns need least
    const n = goods.ammo;
    delete goods.ammo;
    for (const [k, q] of Object.entries(spendAmmo({ ...h.stock }, n, baseCals(state, h)).keys)) goods[k] = (goods[k] || 0) + q;
  }
  for (const k of SUPPLY_KEYS) supplies[k] = (goods[k] || 0) + Math.max(0, Math.floor((form.travel || {})[k] || 0));
  const idx = [...new Set((form.gear || []).map(Number))].filter((i) => h.armory[i]).sort((a, b) => b - a);
  const items = idx.map((i) => h.armory[i]);
  const members = (form.crew || []).map((id) => survivorById(state, id)).filter(Boolean);
  const v = form.vehicleId ? vehicleById(state, form.vehicleId) : null;
  const cap = carryCapacity(state, members, v);
  const load = supplyLoad(supplies) + items.reduce((s, g) => s + itemLoad(g), 0);
  if (members.length && load > cap + 1e-9) return { error: `Too much to carry: goods and supplies weigh ${Math.ceil(load)}, the crew${v ? ` and the ${v.name}` : ""} can carry ${cap}.` };
  const res = launchExpedition(state, { memberIds: form.crew, dest: stops[0], mission: "move", stance: form.stance || "normal", vehicleId: form.vehicleId || null, supplies, fromBaseId: h.id });
  if (res.error) return res;
  const p = res.party;
  // The goods to trade travel as cargo; the rest is what the crew lives on.
  for (const [k, q] of Object.entries(goods)) {
    p.supplies[k] -= q;
    p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) + q;
  }
  for (const i of idx) p.cargo.gear.push(...h.armory.splice(i, 1));
  p.teamMission = "caravan";
  p.caravan = { stops, idx: -1 };
  if (form.dealId != null) p.dealId = form.dealId; // sent for a radio deal (radiotrade.js)
  p.orders = [{ type: "mission", mission: "caravan", at: stops[0] }];
  log(state, `A trade caravan sets out: ${stops.map((t) => destName(state, t)).join(" → ")}, then home.`, "info");
  return { party: p };
}

// Hours from one tile to another for this team (the same stepping as the real trip).
export function legHours(state, p, from, to) {
  const r = planPath(state, from, to, p.vehicle) || (p.vehicle ? planPath(state, from, to, false) : null);
  if (!r) return null;
  const mode = p.vehicle && planPath(state, from, to, p.vehicle) ? p.vehicle : false;
  return travelHours(state, r.path, { vehicle: mode, ...paceOpts(p), speed: modeSpeed(p, mode), fuel: mode === true ? partyFuel(state, p) : 0 }).hours;
}

// The caravan stop order (parties.js arrive, mission "caravan").
export function caravanStop(state, p) {
  if (!p.caravan) return awaitOrders(state, p, "", { failed: true });
  const tile = partyTile(p);
  const k = p.caravan.stops.findIndex((t, i) => i > p.caravan.idx && t === tile);
  if (k >= 0) p.caravan.idx = k;
  const f = state.factions.find((x) => x.alive && x.bases.includes(tile));
  if (f) f.known = true;
  caravanCard(state, p, k >= 0 ? `Stop ${k + 1} of ${p.caravan.stops.length}: ${destName(state, tile)}.` : "");
  return "";
}

// The card at a caravan stop: trade, unload, stay a day, go on, or go home (with ETAs).
export function caravanCard(state, p, text = "") {
  if (!state.parties.includes(p) || !partyMembers(state, p).length) return;
  const tile = partyTile(p);
  p.task = null;
  p.phase = "waiting";
  p.path = [tile];
  p.idx = 0;
  p.dest = tile;
  for (let i = state.cards.length - 1; i >= 0; i--) if (state.cards[i].partyId === p.id && (state.cards[i].isOrders || state.cards[i].isCaravan)) state.cards.splice(i, 1);
  const f = state.factions.find((x) => x.alive && x.bases.includes(tile));
  const own = state.bases.find((b) => b.tile === tile);
  const c = p.caravan;
  const next = c.stops[c.idx + 1];
  const home = baseById(state, p.homeBaseId) || hub(state);
  const eta = (to) => { const hrs = legHours(state, p, tile, to); return hrs == null ? "no route" : `about ${hrs}h`; };
  const cargo = Object.entries(p.cargo.supplies).filter(([, q]) => q >= 1).map(([k, q]) => `${Math.floor(q)} ${keyWord(k)}`).concat(p.cargo.gear.map((g) => g.name));
  const route = c.stops.map((t, i) => `${i <= c.idx ? "✓ " : ""}${destName(state, t)}`).join(" → ");
  const choices = [];
  const deal = f ? pendingDeal(state, f) : null;
  if (deal) {
    // A deal agreed over the radio (radiotrade.js): your side to them, theirs into the caravan.
    const can = dealCarried(state, p, deal);
    choices.push({
      label: `Complete the radio deal: hand over ${goodsText(deal.give)}, load ${goodsText(deal.get)}`, disabled: !can.ok,
      hint: can.ok ? `Agreed over the radio (by day ${deal.due})` : can.why,
      resolve: (st) => { const msg = completeRadioDeal(st, p, deal); caravanCard(st, p, msg); return msg; },
    });
  }
  if (f) {
    const hostile = attitude(f) === "Hostile";
    choices.push({ label: `Trade with ${f.name}`, hint: hostile ? `${f.name} are hostile: they will not trade` : "Opens the trade window: supplies, every item, intel", disabled: hostile, resolve: (st) => { openTrade(st, p, f); return ""; } });
  }
  if (own && (cargo.length)) {
    choices.push({
      label: `Unload the goods into ${own.name}`, hint: `Cargo: ${cargo.join(", ")}`,
      resolve: (st) => {
        for (const [k, q] of Object.entries(p.cargo.supplies)) if (q >= 1) own.stock[k] = (own.stock[k] || 0) + Math.floor(q);
        own.armory.push(...p.cargo.gear);
        p.cargo = { supplies: {}, gear: [] };
        caravanCard(st, p, `Goods unloaded at ${own.name}.`);
        return `Goods unloaded at ${own.name}.`;
      },
    });
  }
  choices.push({
    label: "Stay here a day (24h)", hint: "Camp here for a day (the hurt rest), then this card comes back", order: true,
    resolve: (st) => { const msg = startOrder(st, p, { type: "camp", hours: 24 }); p.orders = [{ type: "mission", mission: "caravan", at: tile }, ...(p.orders || [])]; return msg; },
  });
  if (next != null) {
    choices.push({
      label: `Go on to ${destName(state, next)} (${eta(next)})`, hint: `Next destination, stop ${c.idx + 2} of ${c.stops.length}`, order: true,
      resolve: (st) => {
        const msg = startOrder(st, p, { type: "move", tile: next });
        if (p.phase === "out" && p.dest === next) p.orders = [{ type: "mission", mission: "caravan", at: next }, ...(p.orders || []).filter((o) => !(o.type === "mission" && o.mission === "caravan"))];
        return msg;
      },
    });
  }
  if (home) choices.push({ label: `Return home to ${home.name} (${eta(home.tile)})`, hint: "Everything carried goes into the stores there", order: true, resolve: (st) => startReturn(st, p) || "" });
  choices.push({ label: "Team panel…", hint: "People, gear, supplies and vehicle", uiAction: { type: "expedition", partyId: p.id }, resolve: () => "" });
  choices.push({ label: "Other orders…", hint: "The usual orders card: move anywhere, camp, scavenge, …", resolve: (st) => { awaitOrders(st, p, "The caravan waits for orders."); return ""; } });
  addCard(state, {
    title: `Trade caravan at ${tileLabel(state, tile)}`, partyId: p.id, isCaravan: true,
    text: `${text ? text + " " : ""}Route: ${route}, then home. Carrying ${cargo.join(", ") || "no trade goods"}. Food ${Math.floor(p.supplies.food || 0)}, water ${Math.floor((p.supplies.water || 0) + (p.supplies.rawwater || 0))}.`,
    choices,
  });
}

