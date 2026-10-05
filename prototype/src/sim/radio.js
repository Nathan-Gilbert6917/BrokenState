// Radio: the network (radio stations and relays), talking to other groups, deals over the radio, and the
// groups' own calls to you.
//
// Network
// - A radio station (buildings.js "radio") reaches RADIO_RANGE (8) tiles around its base.
// - A radio relay (buildings.js "relay", outposts only) reaches RELAY_RANGE (6) tiles. It is an unmanned repeater:
//   it needs no operator but uses 1 part every RELAY_UPKEEP_DAYS (10) days (from its outpost, else from the hub).
//   With no part it goes offline until one is there (checked each day).
// - A relay only works when it is linked: it stands within range of a station or of another linked relay
//   (a chain back to a station). Coverage is the union of the ranges of every station and linked relay.
// - Your teams in coverage report live (world.js radioBasesInRange); groups whose base is within coverage plus
//   GROUP_REACH (4) tiles (their own sets reach that far) can be called.
//
// Talking to a group (Groups tab → Radio…), each with a cooldown:
// - Greet: +2 goodwill (+1 if hostile), every 3 days. Scan the airwaves: groups in reach you have not met are
//   "heard on the radio" (known, their main base marked), once a day.
// - News (every 5 days, not hostile): a report of every tile within 2 (neutral), 3 (friendly) or 4 (allied) tiles
//   of their bases, and every horde within 10 tiles of them.
// - Request a trade (every 4 days): neutral-or-better groups (aggressive types need goodwill 0+) say yes with a
//   chance of 45% + goodwill% (+25% traders, +15% commune), clamped 10–95%, and send a caravan of what they can
//   spare (caravans.js) if a land route to your base exists.
// - A deal ("we want 20 meds, paying 60 ammo"): accepted when it is fair for them at their prices (trade.js) and
//   they have the goods; their caravan brings the goods and the trade window opens with the deal filled in.
// - Call for help (every 10 days, friendly or a pact): a raid on its way to you is harried (its strength × 0.7);
//   with no raid and less than 3 days of food at the hub they send 20–30 food as aid; costs 4 goodwill either way.
// - Pacts: the same rules as at their gates.
// Groups also call you: each day a group in reach that is not hostile may radio an offer (their surplus for what
// they need) or a request (they need something, paying with their surplus): 15% a day for traders, 10% for a
// commune, 6% for others, at most one every 6 days per group, never while one of their caravans is out.
import { RADIO_RANGE, day, log, hub, baseById, addCard, atBase, skill, snapshot } from "./world.js";
import { SUPPLIES, SUPPLY_KEYS } from "./data.js";
import { count } from "./buildings.js";
import { radioBoost } from "./power.js";
import { attitude, changeGoodwill, isAggressiveType, strength } from "./factions.js";
import { planPath, spawnAiParty } from "./parties.js";
import { sellPrice, buyPrice, available, need, maxBuyable, minSellable, proposePact, ensureWares } from "./trade.js";
import { sendCaravan, caravanEnRoute, caravanSurplus } from "./caravans.js";
import { tradeSpeech, gainXp, USE } from "./skills.js";
import { marketOf } from "./trade.js";
import { diplomacyDaily } from "./diplomacy.js";
import { thirstFactor } from "./weather.js";
import { rumourFromNews, RUMOUR } from "./survey.js";
import { raidPaceOpen, noteRaid } from "./eras.js";

export const RELAY_RANGE = 6;
export const RELAY_UPKEEP_DAYS = 10;
export const GROUP_REACH = 4;
export const COOLDOWN = { greet: 3, news: 5, caravan: 4, help: 10, scan: 1, offer: 6 };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- network ----------
// Every transmitter: { base, tile, range, kind: "station" | "relay", linked, offline }.
export function radioNodes(state) {
  const nodes = [];
  for (const b of state.bases) {
    if (b.radio) nodes.push({ base: b, tile: b.tile, range: RADIO_RANGE + radioBoost(b), kind: "station", linked: true, offline: false }); // +2 on generator power (power.js)
    else if (count(b, "relay")) nodes.push({ base: b, tile: b.tile, range: RELAY_RANGE, kind: "relay", linked: false, offline: !!b.relayOffline });
  }
  const g = state.grid;
  for (let grew = true; grew;) {
    grew = false;
    for (const n of nodes) {
      if (n.linked || n.offline) continue;
      if (nodes.some((m) => m.linked && g.distance(m.tile, n.tile) <= m.range)) { n.linked = true; grew = true; }
    }
  }
  return nodes;
}
// Linked transmitters whose range (plus extra) covers a tile.
export function coverNodes(state, tile, extra = 0) {
  return radioNodes(state).filter((n) => n.linked && state.grid.distance(n.tile, tile) <= n.range + extra);
}
export const inCoverage = (state, tile, extra = 0) => coverNodes(state, tile, extra).length > 0;
export const hasNetwork = (state) => radioNodes(state).some((n) => n.linked);

// One line for the base screen.
export function radioSummary(state, base) {
  const n = radioNodes(state).find((x) => x.base === base);
  if (n && n.kind === "station") return `Radio station: ${n.range} tiles of coverage`;
  if (n) {
    if (n.offline) return "Relay offline: it needs 1 part (from this outpost or the hub)";
    if (!n.linked) return `Relay not linked: no station or linked relay within range (it reaches ${n.range} tiles)`;
    return `Relay linked: ${n.range} tiles of coverage. Upkeep 1 part every ${RELAY_UPKEEP_DAYS} days, next on day ${base.relayDue ?? day(state) + RELAY_UPKEEP_DAYS}`;
  }
  const by = coverNodes(state, base.tile)[0];
  return by ? `In coverage (from ${by.base.name})` : "No radio here, and out of coverage";
}

// Relays use a part every few days; without one they go offline until one turns up.
function relayUpkeep(state) {
  const today = day(state);
  const h = hub(state);
  for (const b of state.bases) {
    if (!count(b, "relay")) continue;
    if (b.relayDue == null) b.relayDue = today + RELAY_UPKEEP_DAYS;
    if (today < b.relayDue && !b.relayOffline) continue;
    const from = (b.stock.parts || 0) >= 1 ? b : h && (h.stock.parts || 0) >= 1 ? h : null;
    if (from) {
      from.stock.parts -= 1;
      b.relayDue = today + RELAY_UPKEEP_DAYS;
      if (b.relayOffline) log(state, `The radio relay at ${b.name} is back on the air.`, "good");
      b.relayOffline = false;
    } else if (!b.relayOffline) {
      b.relayOffline = true;
      log(state, `The radio relay at ${b.name} went off the air: it needs 1 part (at the outpost or the hub).`, "danger");
    }
  }
}

// ---------- who can be called ----------
export const canRadioGroup = (state, f) => !!f && f.alive && f.bases.some((b) => inCoverage(state, b, GROUP_REACH));
// Speech on the radio: the best talker at a base with a transmitter that reaches them (else at the hub).
export function radioSpeech(state) {
  const h = hub(state);
  return tradeSpeech(h ? atBase(state, h.id) : []); // Haggler +5 (skills.js)
}
const since = (state, f, key) => day(state) - (f.radio?.[key] ?? -999);
const mark = (state, f, key) => { (f.radio = f.radio || {})[key] = day(state); };
// Days until a call of this kind can be made again (0 = now).
export const radioCooldown = (state, f, key) => Math.max(0, (COOLDOWN[key] || 0) - since(state, f, key));
function note(state, f, text) {
  const r = (f.radioLog = f.radioLog || []);
  r.unshift({ day: day(state), text });
  if (r.length > 6) r.pop();
  return text;
}
// Why a group will not take your call or your business (null = they will).
export function refusal(state, f, forTrade = false) {
  if (!f || !f.alive) return "Nobody answers on that channel any more.";
  if (!canRadioGroup(state, f)) return `${f.name} is out of radio reach.`;
  if (attitude(f) === "Hostile") return `${f.name} curse at you and go silent.`;
  if (forTrade && f.goodwill < (isAggressiveType(f) ? 0 : -15)) return `${f.name} do not trust you enough to deal. (Goodwill ${isAggressiveType(f) ? 0 : -15} needed.)`;
  return null;
}
// The base their caravans come to: the hub if they can reach it over land, else your nearest reachable base.
export function tradeBase(state, f) {
  const from = f.bases[0];
  if (from == null) return null;
  const list = [...state.bases].sort((a, b) => (a.type === "hub" ? -1 : 0) - (b.type === "hub" ? -1 : 0) || state.grid.distance(from, a.tile) - state.grid.distance(from, b.tile));
  return list.find((b) => planPath(state, from, b.tile, false)) || null;
}

// ---------- your calls ----------
export function radioScan(state) {
  if (!hasNetwork(state)) return "You need a radio station first.";
  if (state.radioScanDay === day(state)) return "You already scanned the airwaves today.";
  state.radioScanDay = day(state);
  const heard = [];
  for (const f of state.factions) {
    if (!f.alive || f.known || !canRadioGroup(state, f)) continue;
    f.known = true;
    f.heard = true;
    const b = f.bases[0];
    if (b != null) state.knowledge[b] = snapshot(state, b);
    heard.push(f.name);
  }
  const text = heard.length ? `New voices on the radio: ${heard.join(", ")}. Their base is marked on the map.` : "Static. No new voices within reach.";
  log(state, text, heard.length ? "good" : "info");
  return text;
}

export function radioGreet(state, f) {
  if (!f || !f.alive || !canRadioGroup(state, f)) return refusal(state, f);
  if (since(state, f, "greet") < COOLDOWN.greet) return "You talked recently. Give it a few days.";
  mark(state, f, "greet");
  f.lastRadio = day(state);
  f.lastDiplomacy = day(state);
  f.known = true;
  changeGoodwill(state, f, attitude(f) === "Hostile" ? 1 : 2, "regular contact");
  return note(state, f, attitude(f) === "Hostile" ? `${f.name} listen, then cut you off. A little less hostile, maybe.` : `You keep in touch with ${f.name} over the radio.`);
}

export function radioNews(state, f) {
  const why = refusal(state, f);
  if (why) return note(state, f, why);
  if (since(state, f, "news") < COOLDOWN.news) return "They told you what they know a few days ago.";
  mark(state, f, "news");
  const a = attitude(f);
  const r = a === "Allied" ? 4 : a === "Friendly" ? 3 : 2;
  const g = state.grid;
  const tiles = new Set();
  for (const b of f.bases) for (const id of g.within(b, r)) tiles.add(id);
  let hordes = 0;
  for (const h of state.hordes) if (f.bases.some((b) => g.distance(b, h.tile) <= 10)) { tiles.add(h.tile); hordes++; }
  for (const id of tiles) {
    const cur = state.knowledge[id];
    if (!cur || cur.hour <= state.hour) state.knowledge[id] = snapshot(state, id);
  }
  f.lastDiplomacy = day(state);
  const rumour = rumourFromNews(state, f.name, "radio", RUMOUR.groupNews); // survey.js: now and then word of a hidden place
  return note(state, f, `${f.name} pass on what they see: ${tiles.size} tiles around their land${hordes ? `, ${hordes} horde${hordes === 1 ? "" : "s"} on the move near them` : ", no hordes near them"}. It is on your map.${rumour}`);
}

// Ask them to send a caravan of their goods. Rolls once (uses the world's random numbers).
export function radioRequestCaravan(state, f) {
  const why = refusal(state, f, true);
  if (why) return note(state, f, why);
  if (caravanEnRoute(state, f)) return "Their caravan is already on its way or at your gates.";
  if (since(state, f, "caravan") < COOLDOWN.caravan) return `You asked ${f.name} for a caravan recently.`;
  const base = tradeBase(state, f);
  if (!base) return note(state, f, `${f.name} have no way to reach any of your bases over land.`);
  mark(state, f, "caravan");
  const bonus = f.type === "traders" ? 0.25 : f.type === "commune" ? 0.15 : 0;
  const chance = clamp(0.45 + f.goodwill / 100 + bonus, 0.1, 0.95);
  if (!state.rng.chance(chance)) return note(state, f, `${f.name} have nothing to spare for a trip right now. (${Math.round(chance * 100)}% chance with them.)`);
  ensureWares(state, f);
  const c = sendCaravan(state, f, base, { goods: caravanSurplus(state, f) });
  if (!c) return note(state, f, `${f.name} cannot get a caravan to ${base.name}.`);
  return note(state, f, `${f.name} agree: a caravan sets out for ${base.name} (about ${c.eta}h).`);
}

// What a deal { wantKey, wantQty, payKey, payQty } looks like to them (no random numbers; the UI shows it).
export function dealQuote(state, f, d) {
  const out = { ok: false, reason: "", minPay: null, maxWant: null };
  const wantQty = Math.floor(Number(d.wantQty)), payQty = Math.floor(Number(d.payQty));
  if (!SUPPLIES[d.wantKey] || !SUPPLIES[d.payKey]) return { ...out, reason: "Pick what you want and what you pay with." };
  if (d.wantKey === d.payKey) return { ...out, reason: "Ask for one good and pay with another." };
  if (!(wantQty >= 1) || !(payQty >= 1)) return { ...out, reason: "Both amounts must be at least 1." };
  const speech = radioSpeech(state);
  const have = available(f, d.wantKey);
  const pay = payQty * sellPrice(state, f, d.payKey, speech, payQty);
  const cost = wantQty * buyPrice(state, f, d.wantKey, speech, wantQty);
  out.maxWant = maxBuyable(state, f, d.wantKey, speech, pay);
  const min = minSellable(state, f, d.payKey, speech, cost);
  out.minPay = Number.isFinite(min) ? min : null;
  if (have < wantQty) return { ...out, reason: `They can spare only ${have} ${d.wantKey}.` };
  if (pay + 1e-9 < cost) return { ...out, reason: `Not enough for them: they would want at least ${out.minPay ?? "more"} ${d.payKey}, or give at most ${out.maxWant} ${d.wantKey}.` };
  const h = hub(state);
  const short = (h.stock[d.payKey] || 0) < payQty ? ` The hub has only ${Math.floor(h.stock[d.payKey] || 0)} ${d.payKey} right now: have it ready when they arrive.` : "";
  return { ...out, ok: true, reason: `Fair for them.${short}` };
}

export function radioDeal(state, f, d) {
  const why = refusal(state, f, true);
  if (why) return { ok: false, text: note(state, f, why) };
  if (caravanEnRoute(state, f)) return { ok: false, text: "Their caravan is already on its way or at your gates." };
  const q = dealQuote(state, f, d);
  if (!q.ok) return { ok: false, text: note(state, f, `${f.name}: no deal. ${q.reason}`) };
  const base = tradeBase(state, f);
  if (!base) return { ok: false, text: note(state, f, `${f.name} have no way to reach any of your bases over land.`) };
  const wantQty = Math.floor(Number(d.wantQty)), payQty = Math.floor(Number(d.payQty));
  const c = sendCaravan(state, f, base, { goods: { supplies: { [d.wantKey]: wantQty }, gear: [] }, deal: { offer: { [d.payKey]: payQty }, ask: { [d.wantKey]: wantQty } } });
  if (!c) return { ok: false, text: note(state, f, `${f.name} cannot get a caravan to ${base.name}.`) };
  mark(state, f, "caravan");
  const h = hub(state);
  if (h) gainXp(state, atBase(state, h.id).sort((a, b) => skill(b, "speech") - skill(a, "speech") || a.id - b.id)[0], "speech", USE.radio); // skills.js
  return { ok: true, caravan: c, text: note(state, f, `Deal: ${wantQty} ${d.wantKey} for ${payQty} ${d.payKey}. Their caravan sets out for ${base.name} (about ${c.eta}h).`) };
}

export function radioHelp(state, f) {
  const why = refusal(state, f);
  if (why) return note(state, f, why);
  if (!(attitude(f) === "Friendly" || attitude(f) === "Allied" || f.pact)) return note(state, f, `${f.name} do not owe you that kind of favour. (Friendly or a pact needed.)`);
  if (since(state, f, "help") < COOLDOWN.help) return `${f.name} helped you not long ago.`;
  const raid = state.parties.find((q) => q.kind === "raid" && !q.returning && q.target && q.target.kind === "player" && q.owner !== f.id);
  const h = hub(state);
  const mouths = Math.max(1, atBase(state, h.id).length);
  if (raid) {
    mark(state, f, "help");
    raid.strength *= 0.7;
    changeGoodwill(state, f, -4, "a favour");
    return note(state, f, `${f.name} send fighters to harry the raiders heading for ${baseById(state, raid.target.baseId)?.name || "your base"}. The raid is weaker (strength about ${Math.round(raid.strength)}).`);
  }
  if ((h.stock.food || 0) < mouths * 3) {
    const base = tradeBase(state, f);
    const food = Math.min(available(f, "food"), state.rng.int(20, 30));
    if (!base || food < 5) return note(state, f, `${f.name} have no food to spare.`);
    mark(state, f, "help");
    const c = sendCaravan(state, f, base, { goods: { supplies: { food }, gear: [] }, gift: true });
    if (!c) return note(state, f, `${f.name} cannot reach ${base.name}.`);
    changeGoodwill(state, f, -4, "a favour");
    return note(state, f, `${f.name} send ${food} food as aid (about ${c.eta}h).`);
  }
  return note(state, f, `${f.name}: "You look fine from here. Call us when you are in real trouble."`);
}

export function radioPact(state, f, kind) {
  const why = refusal(state, f);
  if (why) return note(state, f, why);
  return note(state, f, proposePact(state, f, kind));
}

// ---------- daily: relays, groups' water and wares, grudges, and the groups' own calls ----------
export function radioDaily(state) {
  relayUpkeep(state);
  const today = day(state);
  const rng = state.rng;
  for (const f of state.factions) {
    if (!f.alive) continue;
    // Groups have wells: water refills toward 6 a head (what you sell them stays), slower when they drink more (summer,
    // a heat wave: weather.js), so their water runs lower and dearer then.
    const cap = f.pop * 6;
    if (f.stock.water == null) f.stock.water = cap;
    else if (f.stock.water < cap) f.stock.water = Math.min(cap, f.stock.water + (f.pop * 0.5) / thirstFactor(state));
    if (f.wares && today - (f.waresDay || 0) >= 7) ensureWares(state, f, true);
    grudgeRaid(state, f);
  }
  diplomacyDaily(state); // diplomacy.js: relations, pacts and wars between groups, market lists, jobs, the coalition
  if (!hasNetwork(state)) return;
  for (const f of state.factions) {
    if (!f.alive || !f.known || refusal(state, f, true) || caravanEnRoute(state, f)) continue;
    if (since(state, f, "offer") < COOLDOWN.offer || state.cards.some((c) => c.radioFrom === f.id)) continue;
    const chance = f.type === "traders" ? 0.15 : f.type === "commune" ? 0.1 : 0.06;
    if (!rng.chance(chance)) continue;
    const card = offerCard(state, f);
    if (card) { addCard(state, card); mark(state, f, "offer"); }
  }
}

// A group you crossed (you attacked their caravan) sends raids for a while, whatever its type.
function grudgeRaid(state, f) {
  if (!f.grudgeUntil || day(state) > f.grudgeUntil || attitude(f) !== "Hostile" || f.pop < 6) return;
  if (state.parties.some((q) => q.owner === f.id && q.kind === "raid")) return;
  if (!raidPaceOpen(state)) return; // eras.js: the pace of raids on you
  if (!state.rng.chance(0.12)) return;
  const g = state.grid;
  const targets = state.bases.filter((b) => f.bases.some((fb) => g.distance(fb, b.tile) <= 24));
  if (!targets.length) return;
  const b = state.rng.pick(targets);
  const p = spawnAiParty(state, f, "raid", f.bases[0], b.tile, { strength: Math.max(4, strength(f) * state.rng.range(0.25, 0.4)), target: { kind: "player", baseId: b.id, tile: b.tile } });
  if (p) { p.grudge = true; noteRaid(state); }
}

// What the hub can spare of a good (keeps a few days of food and water, some meds and ammo).
function hubSpare(state, key) {
  const h = hub(state);
  const n = Math.max(1, atBase(state, h.id).length);
  const keep = { food: n * 6, water: n * 5, meds: 3, ammo: n * 10, fuel: 8, parts: 2, scrap: 20 }[key] || 0;
  return Math.max(0, Math.floor((h.stock[key] || 0) - keep));
}

// An offer or a request from a group, as a card. null when they have nothing sensible to say.
export function offerCard(state, f) {
  const base = tradeBase(state, f);
  if (!base) return null;
  const speech = radioSpeech(state);
  const keys = SUPPLY_KEYS;
  // What they are short of and you can spare; what they have plenty of: this week's wants and surplus lists
  // (trade.js marketOf), most wanted / most plentiful first.
  const m = marketOf(state, f);
  const wants = m.wants.map((x) => x.key).filter((k) => hubSpare(state, k) >= 3);
  const spare = m.surplus.map((x) => x.key).filter((k) => available(f, k) >= 5);
  if (!spare.length) return null;
  const rng = state.rng;
  const payKey = spare[0];
  let deal, text;
  if (wants.length && rng.chance(0.5)) {
    // A request: they need something, paying with their surplus.
    const k = wants[0];
    const qty = Math.max(3, Math.min(hubSpare(state, k), Math.ceil((REF_QTY[k] || 10) * rng.range(0.6, 1.2))));
    const value = qty * sellPrice(state, f, k, speech, qty);
    const pay = maxBuyable(state, f, payKey, speech, value);
    if (pay < 1) return null;
    deal = { offer: { [k]: qty }, ask: { [payKey]: pay } };
    text = `"We need ${qty} ${k}. We can pay ${pay} ${payKey}, delivered to ${base.name}."`;
  } else {
    // An offer: their surplus for something you have.
    const qty = Math.max(5, Math.min(available(f, payKey), Math.ceil((REF_QTY[payKey] || 10) * rng.range(0.8, 1.5))));
    const cost = qty * buyPrice(state, f, payKey, speech, qty);
    const k = keys.filter((x) => x !== payKey && hubSpare(state, x) > 0).sort((a, b) => need(f, b) - need(f, a))[0];
    if (!k) return null;
    const want = minSellable(state, f, k, speech, cost);
    if (!Number.isFinite(want) || want < 1) return null;
    deal = { offer: { [k]: want }, ask: { [payKey]: qty } };
    text = `"We have ${qty} ${payKey} to spare. We would take ${want} ${k} for it, delivered to ${base.name}."`;
  }
  const [giveKey, giveQty] = Object.entries(deal.offer)[0];
  const [getKey, getQty] = Object.entries(deal.ask)[0];
  return {
    title: `On the radio: ${f.name}`,
    radioFrom: f.id,
    text: `${f.name} (${attitude(f).toLowerCase()}) call you. ${text} If you agree, their caravan brings the ${getKey} and the trade window opens when it arrives; it waits a day.`,
    choices: [
      {
        label: `Agree: ${giveQty} ${giveKey} for ${getQty} ${getKey}`,
        affordable: (st) => (hub(st).stock[giveKey] || 0) >= giveQty, // the autopilot agrees only then
        hint: `Have ${giveQty} ${giveKey} ready at ${base.name} when they arrive (the hub has ${Math.floor(hub(state).stock[giveKey] || 0)} now)`,
        resolve: (st) => {
          const why = refusal(st, f, true);
          if (why) return why;
          if (caravanEnRoute(st, f)) return "Their caravan is already on its way.";
          const c = sendCaravan(st, f, base, { goods: { supplies: { [getKey]: getQty }, gear: [] }, deal });
          if (!c) return `${f.name} cannot reach ${base.name} after all.`;
          return note(st, f, `Deal: ${giveQty} ${giveKey} for ${getQty} ${getKey}. Their caravan sets out for ${base.name} (about ${c.eta}h).`);
        },
      },
      { label: "No, thank you", hint: "Nothing changes", resolve: (st) => note(st, f, `You turned down ${f.name}'s offer.`) },
    ],
  };
}
const REF_QTY = { food: 25, water: 25, fuel: 12, meds: 8, ammo: 60, parts: 3, scrap: 20 };

// ---------- autopilot: radio trade when the hub runs short ----------
// needs: the governor's needs table (0 plenty … 3 urgent). Picks the most urgent good, a group in reach that has
// it, and pays with the hub's most plentiful good. At most one radio deal every 6 days. Returns a log text or "".
export function radioTradeIfShort(state, needs) {
  if (!hasNetwork(state)) return "";
  if (state.radioAutoDay != null && day(state) - state.radioAutoDay < 6) return "";
  const short = Object.keys(needs).filter((k) => needs[k] >= 1.8).sort((a, b) => needs[b] - needs[a]);
  const plenty = Object.keys(needs).filter((k) => needs[k] <= 0.4 && hubSpare(state, k) >= 5).sort((a, b) => needs[a] - needs[b]);
  if (!short.length || !plenty.length) return "";
  const speech = radioSpeech(state);
  for (const want of short) {
    // Every group and every way to pay, cheapest first (what the payment is worth to the hub per unit got): the
    // group that sells it cheap and wants what you pay with most (their kind and state, trade.js) wins.
    const deals = [];
    for (const f of state.factions) {
      if (!f.known || refusal(state, f, true) || caravanEnRoute(state, f) || available(f, want) < 3) continue;
      for (const pay of plenty) {
        if (pay === want) continue;
        const budgetUnits = hubSpare(state, pay);
        const value = budgetUnits * sellPrice(state, f, pay, speech, budgetUnits);
        const qty = Math.min(REF_QTY[want] || 10, maxBuyable(state, f, want, speech, value));
        if (qty < 2) continue;
        const cost = qty * buyPrice(state, f, want, speech, qty);
        const payQty = minSellable(state, f, pay, speech, cost, budgetUnits);
        if (!Number.isFinite(payQty)) continue;
        deals.push({ f, pay, qty, payQty, per: (payQty * SUPPLIES[pay].value * (needs[pay] + 0.2)) / qty });
      }
    }
    deals.sort((a, b) => a.per - b.per || a.f.id - b.f.id);
    for (const d of deals) {
      const res = radioDeal(state, d.f, { wantKey: want, wantQty: d.qty, payKey: d.pay, payQty: d.payQty });
      if (res.ok) {
        state.radioAutoDay = day(state);
        return `radio deal with ${d.f.name}: ${d.qty} ${want} for ${d.payQty} ${d.pay}`;
      }
    }
  }
  return "";
}

