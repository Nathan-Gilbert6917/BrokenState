// Radio trades: the full trade window over the radio, with one of your bases' stores and armory on your side and the
// group's spare stock and wares on theirs. Nothing changes hands on the air: the goods travel by caravan afterwards.
//
// Who carries the goods (the one who made the call chooses):
// - "fetch": the caller sends its own caravan. When you call, the deal is booked as a pending radio deal
//   (state.radioDeals): their side is set aside for you (out of their stock and wares) and the trade caravan planner
//   opens from that base, aimed at their base with your side loaded. At their base the caravan's stop card has
//   "Complete the radio deal": your side goes to them, theirs into the caravan, which brings it home.
// - "deliver": the caller asks the other side to send its caravan, for a fee (deliveryFee: 6 + 0.4 a hour on the
//   road, a quarter less from traders, a fifth less with a pact; in their prices, added to what you must give). You
//   take their fee or offer your own (t.feeOffer): they go as low as minFee (their fee × 1 − goodwill/200, traders
//   another 10% off, never under 60%) and say what that is when you offer less; paying over their fee earns goodwill
//   (1 per 10 over, at most 3). They may also say no (deliveryRefusal: too few of them, the dead at their walls, at war, no trust, too far); then you can
//   fetch it yourself. If they agree, their caravan (caravans.js) brings their side to your base and the trade window
//   opens there with the deal filled in.
// Groups call you the same way (radio.js offerCard): mostly they bring their side themselves; sometimes (more often
// when they cannot send a caravan) they ask you to bring yours and add a fee to what they pay. You may agree at their
// fee, ask for half as much again (they agree with goodwill 25+ or when short of what you bring: counterOk; else the
// call comes back without that choice), or decline. Agreeing books the same pending deal and opens the planner; the
// governor agrees at their fee when the base can spare the goods and the people (autopilot.js autoDealCaravan).
// A pending deal waits RADIO_DEAL_DAYS (10, or longer for a far base) for your caravan. Not collected by then, or
// called off, their goods go back to their stores and they think less of you (goodwill −5 / −3). One pending deal per
// group at a time. Gear is matched by what it is (key, condition, uses, contents), so a save and load keeps a deal.
import { SUPPLIES, SUPPLY_KEYS } from "./data.js";
import { log, day, factionById, baseById, atBase, skill } from "./world.js";
import { planPath, travelHours, partyMembers, cargoRoom } from "./parties.js";
import { attitude, changeGoodwill } from "./factions.js";
import { available, poolKey, ensureWares, WARES_MAX, need } from "./trade.js";
import { refusal } from "./radio.js";
import { sendCaravan, caravanEnRoute, caravanCapacity, CARAVAN_SPEED } from "./caravans.js";
import { tradeSpeech, gainXp, USE } from "./skills.js";
import { itemLoad } from "./inventory.js";
import { keyWord } from "./water.js";
import { totalRounds, spendAmmo } from "./rounds.js"; // rounds by calibre ("ammo": any of them)

export const RADIO_DEAL_DAYS = 10;

// ---------- gear by what it is ----------
export const gearSig = (g) => JSON.stringify(g);
// The items of `pool` that match `want` one for one (null if any is missing).
export function matchGear(pool, want) {
  const used = new Set();
  const out = [];
  for (const w of want || []) {
    const s = gearSig(w);
    const i = pool.findIndex((g, j) => !used.has(j) && (g === w || gearSig(g) === s));
    if (i < 0) return null;
    used.add(i);
    out.push(pool[i]);
  }
  return out;
}
export const sameGear = (a, b) => (a || []).length === (b || []).length && !!matchGear(a || [], b || []);
const weigh = (sup) => Object.entries(sup || {}).reduce((s, [k, q]) => s + Math.max(0, q) * (SUPPLIES[k] ? SUPPLIES[k].weight : 0), 0);
export const goodsWeight = (goods) => weigh(goods.supplies) + (goods.gear || []).reduce((s, g) => s + itemLoad(g), 0);
export const goodsText = (goods) => {
  const parts = Object.entries(goods.supplies || {}).filter(([, q]) => q > 0).map(([k, q]) => `${q} ${keyWord(k)}`);
  for (const g of goods.gear || []) parts.push(g.name);
  return parts.join(", ") || "nothing";
};

// ---------- delivery: their caravan to your base ----------
// Hours their caravan walks from their main base to this base (null: no land route).
export function deliveryHours(state, f, base) {
  const from = f && f.bases[0];
  if (from == null || !base) return null;
  const r = planPath(state, from, base.tile, false);
  return r ? travelHours(state, r.path, { vehicle: false, speed: CARAVAN_SPEED }).hours : null;
}
// The fee for a caravan trip between their base and this one, in their prices.
export function deliveryFee(state, f, base) {
  const h = deliveryHours(state, f, base);
  if (h == null) return 0;
  return Math.round((6 + h * 0.4) * (f.type === "traders" ? 0.75 : 1) * (f.pact ? 0.8 : 1));
}
// The lowest fee they take: theirs less a goodwill discount (traders another 10%), never under 60% of it.
export function minFee(state, f, base) {
  const fee = deliveryFee(state, f, base);
  return Math.ceil(fee * Math.max(0.6, 1 - Math.max(0, f.goodwill) / 200 - (f.type === "traders" ? 0.1 : 0)));
}
// The fee on the table for a radio trade: your offer, else theirs.
export const feeOf = (state, f, base, t) => (t.delivery !== "deliver" ? 0 : t.feeOffer != null ? t.feeOffer : deliveryFee(state, f, base));
// Your own offer (null: their fee).
export function setFeeOffer(state, v) {
  const t = state.trade;
  if (!t || !t.radio) return;
  t.feeOffer = v == null || v === "" ? null : Math.max(0, Math.round(Number(v) || 0));
}
// A group asking you to bring your side: would they pay half as much again for the trip?
export const counterOk = (state, f, giveKey) => f.goodwill >= 25 || need(f, giveKey) >= 1.4;

// Why they will not send a caravan to this base for you (null: they will).
export function deliveryRefusal(state, f, base) {
  if (!f || !f.alive) return "Nobody answers any more.";
  if (caravanEnRoute(state, f)) return "Their caravan is already on the road.";
  const h = deliveryHours(state, f, base);
  if (h == null) return `They have no way to reach ${base ? base.name : "your base"} over land.`;
  if (f.pop < 6) return "There are too few of them to spare guards for a caravan.";
  const g = state.grid;
  if (state.hordes.some((x) => g.distance(x.tile, f.bases[0]) <= 3)) return "The dead are at their walls: nobody goes out.";
  if (f.atWar && f.goodwill < 40) return "They are at war and keep every gun at home. (Goodwill 40 needed.)";
  if (f.goodwill < 0 && f.type !== "traders") return "They do not trust you enough to send their people to your gates. (Goodwill 0 needed.)";
  const most = Math.round(48 + Math.max(0, f.goodwill) + (f.type === "traders" ? 24 : 0) + (f.pact ? 24 : 0));
  if (h > most) return `${base.name} is too far: about ${h}h each way, and they go at most ${most}h for you.`;
  return null;
}

// ---------- the trade window over the radio ----------
// Opens the trade window with this group over the radio, trading from a base of yours. Returns "" or why not.
export function openRadioTrade(state, f, baseId, delivery = "fetch") {
  const why = refusal(state, f, true);
  if (why) return why;
  if (state.trade) return "Finish the trade on screen first.";
  const base = baseById(state, baseId) || state.bases[0];
  if (!base) return "You have no base to trade from.";
  ensureWares(state, f);
  state.trade = { radio: true, factionId: f.id, baseId: base.id, delivery: delivery === "deliver" ? "deliver" : "fetch", offer: {}, ask: {}, offerGear: [], askGear: [], intel: { area: "", sightings: false, sell: false } };
  return "";
}
// Another base's stores on your side (what is in the deal is cleared: it was counted from the old base).
export function setRadioBase(state, baseId) {
  const t = state.trade;
  const b = baseById(state, Number(baseId));
  if (!t || !t.radio || !b) return;
  t.baseId = b.id;
  t.offer = {};
  t.offerGear = [];
}
export function setDelivery(state, v) {
  const t = state.trade;
  if (t && t.radio) t.delivery = v === "deliver" ? "deliver" : "fetch";
}
// trade.js tradeContext for a radio trade.
export function radioTradeContext(state, t) {
  const f = factionById(state, t.factionId);
  const base = baseById(state, t.baseId);
  if (!f || !f.alive || !base) return null;
  const have = {}, theirHave = {};
  for (const k of SUPPLY_KEYS) {
    have[k] = Math.max(0, Math.floor(base.stock[k] || 0));
    theirHave[k] = available(f, k);
  }
  have.ammo = theirHave.ammo = 0; // rounds change hands by calibre and type (ammo.js)
  const fee = feeOf(state, f, base, t);
  return { kind: "radio", t, f, base, p: null, caravan: null, speech: tradeSpeech(atBase(state, base.id)), have, theirHave, myGear: base.armory, theirGear: (f.wares = f.wares || []), center: f.bases[0], fee, theirFee: t.delivery === "deliver" ? deliveryFee(state, f, base) : 0, delivery: t.delivery };
}
// trade.js tradeVerdict: what only a radio trade can fail on (null: nothing).
export function radioTradeProblem(state, ctx, offerGear, askGear) {
  const { f, base, t } = ctx;
  const why = refusal(state, f, true);
  if (why) return why;
  if (pendingDeal(state, f)) return `A radio deal with ${f.name} is still waiting for your caravan: complete it or call it off first.`;
  if (t.delivery === "deliver") {
    if (caravanEnRoute(state, f)) return "Their caravan is already on the road.";
    const cap = caravanCapacity(f);
    const out = weigh(t.ask) + askGear.reduce((s, g) => s + itemLoad(g), 0);
    const back = weigh(t.offer) + offerGear.reduce((s, g) => s + itemLoad(g), 0);
    if (Math.max(out, back) > cap + 1e-9) return `Their caravan carries at most ${cap}: ${out > back ? "what you ask for" : "your side"} weighs ${Math.ceil(Math.max(out, back))}.`;
    if (deliveryHours(state, f, base) == null) return `They have no way to reach ${base.name} over land.`;
  }
  return null;
}

// trade.js executeTrade for a radio trade: nothing changes hands now; the deal is booked. v: the verdict.
export function bookRadioTrade(state, v) {
  const { ctx } = v;
  const { t, f, base } = ctx;
  const offerGear = (t.offerGear || []).filter((g) => ctx.myGear.includes(g));
  const askGear = (t.askGear || []).filter((g) => ctx.theirGear.includes(g));
  const offer = Object.fromEntries(Object.entries(t.offer).filter(([, q]) => q > 0));
  const ask = Object.fromEntries(Object.entries(t.ask).filter(([, q]) => q > 0));
  const talker = [...atBase(state, base.id)].sort((a, b) => skill(b, "speech") - skill(a, "speech") || a.id - b.id)[0];
  if (t.delivery === "deliver") {
    const no = deliveryRefusal(state, f, base);
    if (no) return `${f.name} will not bring it: ${no} Pick "We fetch it" to send a caravan of your own.`;
    const low = minFee(state, f, base);
    if (t.feeOffer != null && t.feeOffer < low) return `${f.name}: "For ${t.feeOffer} we stay home. We would do it for ${low}." Raise your offer, take their fee, or fetch it yourself.`;
    if (ctx.fee > ctx.theirFee + 1) changeGoodwill(state, f, Math.min(3, (ctx.fee - ctx.theirFee) / 10), "a generous fee");
    const c = sendCaravan(state, f, base, { goods: { supplies: ask, gear: askGear }, deal: { offer, ask, offerGear, askGear, fee: ctx.fee } });
    if (!c) return `${f.name} cannot get a caravan to ${base.name}.`;
    f.lastDiplomacy = day(state);
    gainXp(state, talker, "speech", USE.radio);
    state.trade = null;
    const text = `Deal over the radio: ${goodsText({ supplies: offer, gear: offerGear })} for ${goodsText({ supplies: ask, gear: askGear })}, with a delivery fee. Their caravan sets out for ${base.name} (about ${c.eta}h); have your side ready there.`;
    log(state, text, "good");
    return text;
  }
  const deal = bookDeal(state, f, base, { supplies: offer, gear: offerGear }, { supplies: ask, gear: askGear }, "you");
  gainXp(state, talker, "speech", USE.radio);
  state.trade = null;
  return `Deal over the radio: ${goodsText(deal.give)} for ${goodsText(deal.get)}. Send a caravan from ${base.name} to ${f.name} by day ${deal.due} to make the swap.`;
}

// ---------- pending deals (your caravan fetches) ----------
export const radioDeals = (state) => (state.radioDeals = state.radioDeals || []);
export const pendingDeal = (state, f) => (f ? radioDeals(state).find((d) => d.factionId === f.id) || null : null);
export const dealById = (state, id) => radioDeals(state).find((d) => d.id === Number(id)) || null;

// Books a deal your caravan fetches. give: your side (left at the base until you load it); get: theirs, set aside
// now. by: who called ("you" | "them"). Returns the deal.
export function bookDeal(state, f, base, give, get, by) {
  const held = { supplies: {}, gear: [] };
  for (const [k, q] of Object.entries(get.supplies || {})) {
    const take = Math.max(0, Math.min(Math.floor(q), available(f, k)));
    if (!take) continue;
    const pk = poolKey(k);
    f.stock[pk] = (f.stock[pk] ?? take) - take;
    held.supplies[k] = take;
  }
  for (const g of get.gear || []) {
    const i = (f.wares || []).indexOf(g);
    if (i >= 0) held.gear.push(...f.wares.splice(i, 1));
  }
  const hrs = deliveryHours(state, f, base) || 0;
  state.radioDealSeq = (state.radioDealSeq || 0) + 1;
  const deal = {
    id: state.radioDealSeq, factionId: f.id, baseId: base.id, by,
    give: { supplies: { ...(give.supplies || {}) }, gear: [...(give.gear || [])] }, get: held,
    day: day(state), due: day(state) + Math.max(RADIO_DEAL_DAYS, Math.ceil((hrs * 2) / 24) + 6),
  };
  radioDeals(state).push(deal);
  f.lastDiplomacy = day(state);
  log(state, `Radio deal with ${f.name}: your caravan takes ${goodsText(deal.give)} to them and brings back ${goodsText(deal.get)}, by day ${deal.due}.`, "good");
  return deal;
}

function dropDeal(state, deal, gw, why) {
  const f = factionById(state, deal.factionId);
  const list = radioDeals(state);
  const i = list.indexOf(deal);
  if (i >= 0) list.splice(i, 1);
  if (!f || !f.alive) return;
  for (const [k, q] of Object.entries(deal.get.supplies)) { const pk = poolKey(k); f.stock[pk] = (f.stock[pk] || 0) + q; }
  f.wares = [...(f.wares || []), ...deal.get.gear].slice(-WARES_MAX);
  if (gw) changeGoodwill(state, f, gw, why);
}
export function cancelRadioDeal(state, deal) {
  const f = factionById(state, deal.factionId);
  dropDeal(state, deal, -3, "you called off a deal");
  const text = `You called off the radio deal with ${f ? f.name : "them"}.`;
  log(state, text, "info");
  return text;
}
// radio.js radioDaily: deals past their day lapse; a group that is gone or hostile drops its deal.
export function radioDealsDaily(state) {
  for (const d of [...radioDeals(state)]) {
    const f = factionById(state, d.factionId);
    if (!f || !f.alive) { dropDeal(state, d, 0, ""); continue; }
    if (attitude(f) === "Hostile") { dropDeal(state, d, 0, ""); log(state, `${f.name} have turned hostile: the radio deal with them is off.`, "warn"); continue; }
    if (day(state) > d.due) {
      dropDeal(state, d, -5, "you never came for the deal");
      log(state, `No caravan of yours came for the radio deal with ${f.name}: it is off, and they think less of you.`, "warn");
    }
  }
}

// Does this team carry your side of the deal, with room for theirs? { ok, why, gear }.
export function dealCarried(state, p, deal) {
  const short = [];
  for (const [k, q] of Object.entries(deal.give.supplies)) {
    const has = Math.floor(k === "ammo" ? totalRounds(p.cargo.supplies) + totalRounds(p.supplies) : (p.cargo.supplies[k] || 0) + (p.supplies[k] || 0)); // "ammo": any rounds (rounds.js)
    if (has < q) short.push(`${q - has} ${keyWord(k)}`);
  }
  const gear = matchGear(p.cargo.gear, deal.give.gear);
  if (!gear) short.push("the items you promised");
  if (short.length) return { ok: false, why: `The caravan is short of ${short.join(", ")}.` };
  const freed = goodsWeight(deal.give);
  const need = goodsWeight(deal.get);
  if (need > cargoRoom(state, p) + freed + 1e-9) return { ok: false, why: `No room for their side: it weighs ${Math.ceil(need)}, and there is room for ${Math.floor(cargoRoom(state, p) + freed)}.` };
  return { ok: true, why: "", gear };
}
// The swap at their base (caravans.js caravanCard). Returns a text.
export function completeRadioDeal(state, p, deal) {
  const f = factionById(state, deal.factionId);
  if (!f || !f.alive || !radioDeals(state).includes(deal)) return "The deal is off.";
  const c = dealCarried(state, p, deal);
  if (!c.ok) return c.why;
  for (const [k, q] of Object.entries(deal.give.supplies)) {
    if (k === "ammo") { const c0 = spendAmmo(p.cargo.supplies, q, p.ammoCals).n; spendAmmo(p.supplies, q - c0, p.ammoCals); } // rounds.js: any rounds, the ones its guns need least
    else {
      const fromCargo = Math.min(q, Math.floor(p.cargo.supplies[k] || 0));
      p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) - fromCargo;
      p.supplies[k] = (p.supplies[k] || 0) - (q - fromCargo);
    }
    const pk = poolKey(k);
    f.stock[pk] = (f.stock[pk] || 0) + q;
  }
  f.wares = f.wares || [];
  for (const g of c.gear) { p.cargo.gear.splice(p.cargo.gear.indexOf(g), 1); f.wares.push(g); }
  if (f.wares.length > WARES_MAX) f.wares.splice(0, f.wares.length - WARES_MAX);
  for (const [k, q] of Object.entries(deal.get.supplies)) p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) + q;
  p.cargo.gear.push(...deal.get.gear);
  radioDeals(state).splice(radioDeals(state).indexOf(deal), 1);
  changeGoodwill(state, f, 1, "a deal kept");
  f.lastDiplomacy = day(state);
  const talker = [...partyMembers(state, p)].sort((a, b) => skill(b, "speech") - skill(a, "speech") || a.id - b.id)[0];
  gainXp(state, talker, "speech", USE.trade);
  const text = `Radio deal done with ${f.name}: handed over ${goodsText(deal.give)}, loaded ${goodsText(deal.get)}.`;
  log(state, text, "good");
  return text;
}

// The trade caravan planner's form for a deal: from its base, to their base, your side loaded.
export function dealCaravanForm(state, deal) {
  const f = factionById(state, deal.factionId);
  const base = baseById(state, deal.baseId) || state.bases[0];
  const gear = matchGear(base.armory, deal.give.gear) || [];
  return {
    crew: [], vehicleId: null, stance: "normal", goods: { ...deal.give.supplies }, travel: { food: 0, water: 0, fuel: 0 },
    gear: gear.map((g) => base.armory.indexOf(g)), stops: f && f.bases[0] != null ? [f.bases[0]] : [], fromBaseId: base.id, dealId: deal.id,
  };
}
export const dealLine = (state, deal) => {
  const f = factionById(state, deal.factionId);
  const b = baseById(state, deal.baseId);
  return `${f ? f.name : "?"}: take ${goodsText(deal.give)}${b ? ` from ${b.name}` : ""}, bring back ${goodsText(deal.get)}, by day ${deal.due}`;
};
