// Trading over the radio (sim/radiotrade.js): the trade window with a base's stores and armory on your side; agreeing
// books the deal and a caravan carries it. We fetch it (their side set aside, the caravan planner from that base,
// "Complete the radio deal" at their gates), they bring it (a delivery fee on their side, refusals, their caravan's
// window honours the deal with items), deals that lapse or are called off, a group asking you to bring your side
// (agree books a deal, decline does nothing), a save and load with a deal waiting, and the HTML of every screen.
// Usage: node tools/radiotradetest.js [seed]
import { setRounds } from "../src/sim/ammo.js"; // rounds by calibre
const AMMO = "a_9mm_fmj"; // your side pays in a box of 9mm (rounds go by calibre: ammo.js)
import { readFileSync } from "node:fs";
import { createWorld, tickHour, hub, makeSurvivor, newId, day } from "../src/sim/world.js";
import { addBuilding } from "../src/sim/buildings.js";
import { planPath, partyTile } from "../src/sim/parties.js";
import { newItem } from "../src/sim/inventory.js";
import { tradeContext, tradeVerdict, tradeTotals, executeTrade, endTrade, setQty, balanceWith, toggleGear, giftAll } from "../src/sim/trade.js";
import { canRadioGroup, offerCard } from "../src/sim/radio.js";
import { launchCaravan } from "../src/sim/caravans.js";
import {
  openRadioTrade, setDelivery, setRadioBase, deliveryFee, deliveryRefusal, pendingDeal, radioDeals, radioDealsDaily, cancelRadioDeal, dealCaravanForm, bookDeal,
  setFeeOffer, minFee,
} from "../src/sim/radiotrade.js";
import { crewAI, autopilotDaily, setAutopilot } from "../src/sim/autopilot.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { tradeWindow, radioModal, caravanPlanModal, groupsRadioHeader, TRADE_ACTIONS, TRADE_CHANGE_ACTIONS } from "../src/ui/tradewindow.js";
import { DIPLO_ACTIONS, DIPLO_CHANGE } from "../src/ui/diplomacy.js";
import { LISTEN_ACTIONS } from "../src/ui/radiolisten.js";
import { INTEL_ACTIONS, INTEL_CHANGE } from "../src/ui/intel.js"; // radio security in the Groups header

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const off = (state, c) => (typeof c.disabled === "function" ? c.disabled(state) : !!c.disabled);
const land = (state, t) => state.tiles[t].terrain !== "water" && state.tiles[t].terrain !== "mountain";

function fighter(state) {
  const s = makeSurvivor(state);
  s.skills.speech = 6;
  s.traits = [];
  s.health = 100;
  s.location = { kind: "base", baseId: hub(state).id };
  state.survivors.push(s);
  return s;
}
// A friendly trading group within radio reach and a walk from the hub; no hordes near it.
function setup(s) {
  const st = createWorld({ seed: s, factionCount: 8 });
  const h = hub(st);
  addBuilding(h, "radio");
  const f = st.factions.filter((x) => x.alive && x.bases.length && planPath(st, x.bases[0], h.tile, false))
    .sort((a, b) => st.grid.distance(a.bases[0], h.tile) - st.grid.distance(b.bases[0], h.tile))[0];
  Object.assign(f, { type: "traders", goodwill: 45, known: true, pop: Math.max(f.pop, 24) });
  f.bases = [f.bases[0]];
  if (!canRadioGroup(st, f)) f.bases = [st.grid.within(h.tile, 10).find((t) => land(st, t) && st.grid.distance(t, h.tile) >= 6 && !st.bases.some((b) => b.tile === t) && planPath(st, t, h.tile, false))];
  Object.assign(f.stock, { food: 300, ammo: 600, meds: 60, fuel: 60, parts: 10, scrap: 120, water: 150 });
  for (const x of st.factions) if (x !== f) x.goodwill = Math.max(x.goodwill, -20);
  st.hordes = st.hordes.filter((x) => st.grid.distance(x.tile, f.bases[0]) > 6);
  Object.assign(h.stock, { food: 200, water: 200 }); setRounds(h.stock, 0); h.stock[AMMO] = 600; // ammo.js: your side pays in rounds by calibre
  for (let i = 0; i < 3; i++) fighter(st);
  for (const s of st.survivors) s.traits = s.traits.filter((t) => t !== "diplomatic"); // a Diplomatic crew softens the goodwill lost (traits.js): the checks count the plain numbers
  return { st, h, f };
}
// Ticks hours; cards: keep(card) ones stay, others get a harmless answer. Stops when pred() is true.
function drive(state, pred, maxHours, keep = () => false) {
  for (let i = 0; i < maxHours; i++) {
    if (pred()) return true;
    tickHour(state);
    for (const p of state.parties) if (p.owner === "player") p.lastConflict = state.hour;
    for (let g = 0; g < 20; g++) {
      const c = state.cards.find((x) => !keep(x));
      if (!c) break;
      state.cards.splice(state.cards.indexOf(c), 1);
      const opts = c.choices.filter((x) => !off(state, x) && !x.uiAction);
      const ch = opts.find((x) => !/Return home|Fight|Attack|Agree|Complete/.test(x.label)) || opts[0];
      if (ch) ch.resolve(state);
    }
    if (state.trade && !keep("trade")) endTrade(state);
  }
  return pred();
}

// 1. The window over the radio: a base's stores and armory against their spare stock and wares.
{
  console.log("The trade window over the radio");
  const { st, h, f } = setup(seed);
  h.armory.push(newItem("pistol", 0.8));
  check(openRadioTrade(st, f, h.id) === "", "it opens");
  const ctx = tradeContext(st);
  check(ctx && ctx.kind === "radio" && ctx.base === h && ctx.myGear === h.armory && ctx.have[AMMO] === h.stock[AMMO], "your side: the hub's stores and armory");
  check(ctx.theirGear === f.wares && ctx.theirHave.meds > 0 && ctx.theirHave.meds < f.stock.meds, "their side: what they can spare and their wares");
  check(ctx.delivery === "fetch" && ctx.fee === 0, "by default you fetch it: no fee");
  check(/over the radio/i.test(giftAll(st)) || tradeTotals(st).offer === 0, "no gifts over the radio");
  setDelivery(st, "deliver");
  const fee = deliveryFee(st, f, h);
  check(tradeContext(st).fee === fee && fee > 0, `asking them to bring it adds the delivery fee (${fee})`);
  setQty(st, "theirs", "meds", 5);
  balanceWith(st, AMMO);
  const withFee = tradeContext(st).t.offer[AMMO];
  setDelivery(st, "fetch");
  setQty(st, "mine", AMMO, 0);
  balanceWith(st, AMMO);
  const noFee = tradeContext(st).t.offer[AMMO];
  check(withFee > noFee, `the fee costs more of your side (${withFee} ammo against ${noFee})`);
  const other = { id: newId(), tile: st.grid.within(h.tile, 3).find((t) => land(st, t) && t !== h.tile), type: "outpost", name: "Elm", stock: { food: 5, [AMMO]: 3 }, buildings: [], construction: [], armory: [] };
  st.bases.push(other);
  setRadioBase(st, other.id);
  check(tradeContext(st).base === other && tradeContext(st).have[AMMO] === 3 && !(st.trade.offer[AMMO] > 0), "another base's stores: the old side is cleared");
  st.bases.pop();
  endTrade(st);
  check(!st.trade, "hanging up closes it");
}

// 2. We fetch it: their side set aside, the planner from the base, the swap at their gates.
{
  console.log("We fetch it");
  const { st, h, f } = setup(seed + 1);
  const pistol = newItem("pistol", 0.9);
  h.armory.push(pistol);
  openRadioTrade(st, f, h.id, "fetch");
  setQty(st, "theirs", "meds", 6);
  toggleGear(st, "mine", h.armory.indexOf(pistol));
  balanceWith(st, AMMO);
  const v = tradeVerdict(st);
  const ammo = st.trade.offer[AMMO] || 0;
  const meds0 = f.stock.meds, hubMeds = h.stock.meds, hubAmmo = h.stock[AMMO];
  check(v.ok, `the deal is fair (${v.reason})`);
  const msg = executeTrade(st);
  const d = pendingDeal(st, f);
  check(!st.trade && d && d.by === "you", `agreeing books it and closes the window: ${msg}`);
  check(f.stock.meds === meds0 - 6 && d.get.supplies.meds === 6, "their 6 meds are set aside for you");
  check(h.stock.meds === hubMeds && h.stock[AMMO] === hubAmmo && h.armory.includes(pistol), "nothing leaves your base yet");
  check(d.give.supplies[AMMO] === ammo && d.give.gear.length === 1, "your side is on the deal: ammo and the pistol");
  openRadioTrade(st, f, h.id);
  setQty(st, "theirs", "food", 2);
  check(!tradeVerdict(st).ok && /still waiting/.test(tradeVerdict(st).reason), "one deal at a time with a group");
  endTrade(st);
  const form = dealCaravanForm(st, d);
  check(form.stops[0] === f.bases[0] && form.fromBaseId === h.id && form.goods[AMMO] === ammo && h.armory[form.gear[0]] === pistol, "the planner: their base, your side loaded");
  form.crew = st.survivors.filter((s) => s.alive && s.location.kind === "base").slice(0, 2).map((s) => s.id);
  form.travel = { food: 20, water: 20, fuel: 0 };
  const res = launchCaravan(st, form);
  check(!res.error && !h.armory.includes(pistol), `the caravan sets out with your side${res.error ? `: ${res.error}` : ""}`);
  const p = res.party;
  let card = null;
  drive(st, () => (card = st.cards.find((c) => c.isCaravan && c.partyId === p.id)), 24 * 20, (c) => c.isCaravan && c.partyId === p.id);
  const done = card && card.choices.find((c) => /^Complete the radio deal/.test(c.label));
  check(done && !off(st, done), "at their gates: Complete the radio deal");
  if (done) {
    const fAmmo = f.stock.ammo, meds0 = p.cargo.supplies.meds || 0; // what it found on the road stays
    st.cards.splice(st.cards.indexOf(card), 1);
    done.resolve(st);
    check(!pendingDeal(st, f) && p.cargo.supplies.meds === meds0 + 6 && f.stock.ammo === fAmmo + ammo && f.wares.includes(pistol), `the swap: their meds in the caravan, your ammo and pistol with them (deal ${!pendingDeal(st, f)}, meds ${p.cargo.supplies.meds}, ammo ${f.stock.ammo - fAmmo} of ${ammo}, pistol ${f.wares.includes(pistol)})`);
    check(st.cards.some((c) => c.isCaravan && c.partyId === p.id && !c.choices.some((x) => /^Complete the radio/.test(x.label))), "the stop card comes back without the deal");
  }
}

// 3. They bring it: the fee, a refusal, their caravan honours the deal with items.
{
  console.log("They bring it");
  const { st, h, f } = setup(seed + 2);
  const knife = newItem("pistol", 0.6);
  h.armory.push(knife);
  f.pop = 4;
  openRadioTrade(st, f, h.id, "deliver");
  setQty(st, "theirs", "meds", 4);
  balanceWith(st, AMMO);
  check(!!deliveryRefusal(st, f, h), "too few of them to send a caravan");
  const msg = executeTrade(st);
  check(st.trade && /will not bring it/.test(msg) && !st.parties.some((q) => q.kind === "caravan" && q.owner === f.id), `they say no and the window stays open: ${msg}`);
  f.pop = 24;
  toggleGear(st, "mine", h.armory.indexOf(knife));
  balanceWith(st, AMMO);
  const ammo = st.trade.offer[AMMO];
  const ok = executeTrade(st);
  const c = st.parties.find((q) => q.kind === "caravan" && q.owner === f.id);
  check(!st.trade && c && c.goods.supplies.meds === 4 && c.deal && c.deal.fee > 0, `they agree and their caravan sets out: ${ok}`);
  if (c) {
    drive(st, () => c.phase === "trading", 24 * 20, (x) => x === "trade");
    const v = tradeVerdict(st);
    check(st.trade && st.trade.caravanId === c.id && st.trade.offerGear.includes(knife) && v.ok && v.honoured, "it arrives: the deal with the pistol is filled in and honoured");
    const meds = h.stock.meds;
    executeTrade(st);
    check(h.stock.meds === meds + 4 && c.goods.gear.includes(knife) && h.stock[AMMO] === 600 - ammo, "done: meds in, ammo and the pistol out");
    endTrade(st);
  }
}

// 4. Deals that lapse or are called off.
{
  console.log("Lapsed and called-off deals");
  const { st, h, f } = setup(seed + 3);
  const meds0 = f.stock.meds, gw0 = f.goodwill;
  const d = bookDeal(st, f, h, { supplies: { ammo: 40 }, gear: [] }, { supplies: { meds: 5 }, gear: [] }, "you");
  check(f.stock.meds === meds0 - 5, "booked: their meds set aside");
  cancelRadioDeal(st, d);
  check(!pendingDeal(st, f) && f.stock.meds === meds0 && f.goodwill < gw0, "called off: their meds back, goodwill down");
  const d2 = bookDeal(st, f, h, { supplies: { ammo: 40 }, gear: [] }, { supplies: { meds: 5 }, gear: [] }, "you");
  const gw1 = f.goodwill;
  st.hour = (d2.due + 1) * 24;
  radioDealsDaily(st);
  check(!pendingDeal(st, f) && f.stock.meds === meds0 && f.goodwill <= gw1 - 5, "never fetched: it lapses, goods back, goodwill −5");
}

// 5. A group asks you to bring your side.
{
  console.log("They ask you to bring it");
  const { st, h, f } = setup(seed + 4);
  f.pop = 5; // too few to send a caravan: they always ask you to come
  f.stock.meds = 200;
  let card = null;
  for (let i = 0; i < 30 && !card; i++) { const c = offerCard(st, f); if (c && /bring it to us/.test(c.text)) card = c; }
  if (check(!!card, "a call asking you to bring it")) {
    const yes = card.choices.find((c) => /^Agree and send a caravan/.test(c.label));
    const no = card.choices.find((c) => /^No, thank you/.test(c.label));
    check(yes && yes.uiAction && yes.uiAction.type === "radioCaravan" && !yes.affordable(st), "agree opens the planner (the governor declines)");
    no.resolve(st);
    check(!pendingDeal(st, f), "decline: no deal");
    yes.resolve(st);
    const d = pendingDeal(st, f);
    check(d && d.by === "them" && Object.values(d.get.supplies)[0] >= 2, "agree: a deal your caravan fetches, with their fee in what they pay");
    // Save and load with the deal waiting.
    const st2 = deserializeState(serializeState(st));
    const f2 = st2.factions.find((x) => x.id === f.id);
    check(pendingDeal(st2, f2) && pendingDeal(st2, f2).due === d.due, "a save and load keeps the deal");
  }
}

// 7. Your own fee: too low and they name their lowest; at it they come; over theirs earns goodwill.
{
  console.log("Your own delivery fee");
  const { st, h, f } = setup(seed + 6);
  f.goodwill = 40;
  const fee = deliveryFee(st, f, h), low = minFee(st, f, h);
  check(low < fee && low >= Math.ceil(fee * 0.6), `their lowest is under their fee (${low} of ${fee})`);
  openRadioTrade(st, f, h.id, "deliver");
  setQty(st, "theirs", "meds", 4);
  setFeeOffer(st, low - 1);
  check(tradeContext(st).fee === low - 1, "your offer replaces their fee on their side");
  balanceWith(st, AMMO);
  const no = executeTrade(st);
  check(st.trade && new RegExp(`would do it for ${low}`).test(no) && !st.parties.some((q) => q.kind === "caravan" && q.owner === f.id), `too low: they stay home and name their lowest ("${no}")`);
  setFeeOffer(st, low);
  setQty(st, "mine", AMMO, 0);
  balanceWith(st, AMMO);
  executeTrade(st);
  const c = st.parties.find((q) => q.kind === "caravan" && q.owner === f.id);
  check(!st.trade && c && c.deal.fee === low, "at their lowest: they come, at your fee");
  const { st: s2, h: h2, f: f2 } = setup(seed + 7);
  openRadioTrade(s2, f2, h2.id, "deliver");
  setQty(s2, "theirs", "meds", 4);
  setFeeOffer(s2, deliveryFee(s2, f2, h2) + 30);
  balanceWith(s2, AMMO);
  const gw = f2.goodwill;
  executeTrade(s2);
  check(!s2.trade && f2.goodwill > gw, "over their fee: a little goodwill");
  setFeeOffer(s2, null);
}

// 8. They ask you to bring it: their fee, or ask more (yes when they like you or need it; no: the call comes back).
{
  console.log("Asking more for the trip");
  const ask = (s, gw) => {
    const { st, h, f } = setup(s);
    f.pop = 5; f.goodwill = gw; f.stock.meds = 200;
    for (const k of Object.keys(f.stock)) if (k !== "meds") f.stock[k] = Math.max(f.stock[k], 400); // nothing short: only goodwill counts
    f.stock.wood = 3000; // firewood they pay with has room for a higher fee
    let card = null;
    for (let i = 0; i < 40 && !card; i++) { const c = offerCard(st, f); if (c && c.bring && c.choices.some((x) => /^Ask more/.test(x.label))) card = c; }
    return { st, h, f, card };
  };
  const a = ask(seed + 8, 40);
  if (check(!!a.card, "a call with Ask more for the trip")) {
    const more = a.card.choices.find((x) => /^Ask more/.test(x.label));
    const want = Number(/: (\d+)/.exec(more.label)[1]);
    more.resolve(a.st);
    const d = pendingDeal(a.st, a.f);
    check(d && Object.values(d.get.supplies)[0] === want, `goodwill 40: they pay the higher fee (${want})`);
  }
  const b = ask(seed + 9, 5);
  if (b.card) {
    const more = b.card.choices.find((x) => /^Ask more/.test(x.label));
    const n = b.st.cards.length;
    more.resolve(b.st);
    const again = b.st.cards[b.st.cards.length - 1];
    check(!pendingDeal(b.st, b.f) && b.st.cards.length === n + 1 && again.bring && !again.choices.some((x) => /^Ask more/.test(x.label)) && again.choices.some((x) => /^Agree and send/.test(x.label)), "goodwill 5, not short: no; the call comes back at their fee");
  }
}

// 9. The autopilot: yes and the caravan sets out when the base can spare the goods and the people; no otherwise.
{
  console.log("The autopilot and calls to bring it");
  const { st, h, f } = setup(seed + 10);
  for (let i = 0; i < 4; i++) fighter(st);
  setAutopilot(st, true, "balanced");
  f.pop = 5; Object.assign(f.stock, { meds: 200, wood: 0, scrap: 0, food: 0 }); // they pay in light goods: a caravan of two carries it home
  Object.assign(h.stock, { ammo: 2000, scrap: 400, parts: 40, fuel: 40, meds: 40, food: 600, water: 400 });
  let card = null;
  for (let i = 0; i < 60 && !card; i++) { const c = offerCard(st, f); if (c && c.bring) card = c; }
  if (check(!!card, "a call asking you to bring it")) {
    const pick = crewAI.answer(st, card, "balanced");
    check(pick && /^Agree and send/.test(pick.label), `a well-stocked base with people to spare: yes (${pick && pick.label})`);
    const text = pick ? pick.resolve(st) : "";
    const d = pendingDeal(st, f);
    const p = st.parties.find((q) => q.owner === "player" && d && q.dealId === d.id);
    check(d && p && /sets out/.test(text), `the deal is booked and the caravan sets out: ${text}`);
    if (p) {
      // The autopilot answers its own cards as the hours go by (autopilot.js autopilotHour).
      for (let i = 0; i < 24 * 20 && pendingDeal(st, f) && st.parties.includes(p); i++) { tickHour(st); p.lastConflict = st.hour; }
      check(!pendingDeal(st, f), `the governor completes the deal at their gates (${st.parties.includes(p) ? `${p.phase} at ${partyTile(p)}, their base ${f.bases[0]}, cards ${st.cards.filter((c) => c.partyId === p.id).map((c) => c.title).join("; ")}` : "the caravan is home"})`);
    }
  }
  const { st: s2, h: h2, f: f2 } = setup(seed + 11);
  setAutopilot(s2, true, "balanced");
  f2.pop = 5; f2.stock.meds = 200;
  for (const s of s2.survivors) if (s.location && s.location.kind === "base") s.health = 30; // nobody fit to go
  let c2 = null;
  for (let i = 0; i < 60 && !c2; i++) { const c = offerCard(s2, f2); if (c && c.bring) c2 = c; }
  if (c2) {
    const pick = crewAI.answer(s2, c2, "balanced");
    check(pick && /^No, thank/.test(pick.label), "nobody fit to send: no");
  }
  // A deal waiting from before the autopilot was on: its daily check sends the caravan.
  const { st: s3, h: h3, f: f3 } = setup(seed + 12);
  for (let i = 0; i < 4; i++) fighter(s3);
  setAutopilot(s3, true, "balanced");
  Object.assign(h3.stock, { ammo: 2000, food: 600, water: 400 });
  const d3 = bookDeal(s3, f3, h3, { supplies: { ammo: 60 }, gear: [] }, { supplies: { meds: 4 }, gear: [] }, "you");
  autopilotDaily(s3);
  check(s3.parties.some((q) => q.owner === "player" && q.dealId === d3.id), "a deal already waiting: the daily check sends the caravan");
}

// 6. HTML: the window over the radio, the radio panel, the Groups header, the planner; every action handled.
{
  console.log("HTML");
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const known = new Set([...Object.keys(TRADE_ACTIONS), ...Object.keys(TRADE_CHANGE_ACTIONS), ...Object.keys(DIPLO_ACTIONS), ...Object.keys(DIPLO_CHANGE), ...Object.keys(LISTEN_ACTIONS), ...Object.keys(INTEL_ACTIONS), ...Object.keys(INTEL_CHANGE)]);
  const handled = (a) => known.has(a) || new RegExp(`(^|[\\s{,])"?${a.replace(/[-]/g, "\\-")}"?\\s*:`, "m").test(main);
  const scan = (html, where) => {
    const acts = [...html.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]);
    const missing = [...new Set(acts)].filter((a) => !handled(a));
    check(acts.length > 0 && !missing.length, `${where}: actions handled${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`);
    const bad = /\b(undefined|NaN|Infinity)\b|\[object /.exec(html);
    check(!bad, `${where}: no undefined / NaN${bad ? ` (${html.slice(Math.max(0, bad.index - 80), bad.index + 40)})` : ""}`);
    const open = (html.match(/<(div|table|tr|td|button|span|label|select|h1|h3)\b/g) || []).length;
    const close = (html.match(/<\/(div|table|tr|td|button|span|label|select|h1|h3)>/g) || []).length;
    check(open === close, `${where}: tags balanced (${open} / ${close})`);
  };
  const { st, h, f } = setup(seed + 5);
  st.bases.push({ id: newId(), tile: st.grid.within(h.tile, 3).find((t) => land(st, t) && t !== h.tile), type: "outpost", name: "Elm", stock: { food: 5 }, buildings: [], construction: [], armory: [] });
  const ui = { tradeMsg: "", radioWith: f.id, radioMsg: "", caravanPlan: null };
  scan(radioModal(st, ui), "radio panel");
  TRADE_ACTIONS["rd-trade"](st, ui, {});
  check(st.trade && st.trade.radio, "Open the trade window… opens it");
  setQty(st, "theirs", "meds", 3);
  TRADE_ACTIONS["tw-delivery"](st, ui, { v: "deliver" });
  scan(tradeWindow(st, ui), "trade window over the radio (they bring it)");
  TRADE_ACTIONS["tw-feemode"](st, ui, { v: "mine" });
  check(st.trade.feeOffer === Math.round(deliveryFee(st, f, h)), "Your offer starts at their fee");
  TRADE_CHANGE_ACTIONS["tw-fee"](st, ui, { value: "9" });
  check(st.trade.feeOffer === 9 && tradeContext(st).fee === 9, "typing a fee sets it");
  scan(tradeWindow(st, ui), "trade window over the radio (your fee)");
  TRADE_ACTIONS["tw-feemode"](st, ui, { v: "theirs" });
  check(st.trade.feeOffer == null, "Their fee again");
  TRADE_ACTIONS["tw-delivery"](st, ui, { v: "fetch" });
  TRADE_ACTIONS["tw-balance"](st, ui, { k: "ammo" });
  scan(tradeWindow(st, ui), "trade window over the radio (we fetch)");
  TRADE_ACTIONS.dotrade(st, ui, {});
  check(!st.trade && ui.caravanPlan && ui.caravanPlan.dealId === pendingDeal(st, f).id && ui.radioWith == null, "agreeing to fetch opens the caravan planner for the deal");
  scan(caravanPlanModal(st, ui), "caravan planner for a radio deal");
  ui.radioWith = f.id;
  scan(radioModal(st, ui), "radio panel with a deal waiting");
  scan(groupsRadioHeader(st), "Groups tab radio header with a deal waiting");
  TRADE_ACTIONS["rd-dealcancel"](st, ui, { id: pendingDeal(st, f).id });
  check(!pendingDeal(st, f), "Call it off works from the panel");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
