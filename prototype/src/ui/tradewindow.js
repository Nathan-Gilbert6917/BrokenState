// Trade window (two columns like RimWorld / Fallout), the radio panel for one group, the trade caravan planner,
// and the bits of the Groups and Bases tabs that lead to them. Handlers: TRADE_ACTIONS / TRADE_CHANGE_ACTIONS,
// registered by main.js. The rules live in sim/trade.js, sim/radio.js and sim/caravans.js.
import { SUPPLIES, SUPPLY_KEYS, STOCK_KEYS, GEAR, FACTION_TYPES } from "../sim/data.js";
import { hub, day, factionById, baseById, survivorById, atBase, skill, combatPower, RADIO_RANGE } from "../sim/world.js";
import { attitude } from "../sim/factions.js";
import { tileLabel, partyTile, carryCapacity, STANCES } from "../sim/parties.js";
import { waterIn } from "../sim/water.js"; // purified and un-purified water
import {
  tradeContext, tradeTotals, tradeVerdict, sellPrice, buyPrice, spread, intelOffer, setQty, toggleGear, setIntel, balanceWith,
  executeTrade, giftAll, proposePact, endTrade, openCaravanTrade, priceWhy, supplyInfo, gearInfo, goodsWorth,
} from "../sim/trade.js";
import { situation, tastes, profileLabel, catName, catOf, margin } from "../sim/valuation.js";
import {
  radioNodes, hasNetwork, canRadioGroup, radioScan, radioGreet, radioNews, radioRequestCaravan, radioDeal, radioHelp, radioPact, dealQuote,
  radioCooldown, refusal, tradeBase, radioSummary, RELAY_RANGE, GROUP_REACH, listeners, relaySpotFor,
} from "../sim/radio.js";
import {
  caravansAt, incomingCaravans, caravanGuards, attackCaravan, caravanDestinations, caravanEstimate, launchCaravan, caravanHome,
} from "../sim/caravans.js";
import {
  openRadioTrade, setRadioBase, setDelivery, setFeeOffer, deliveryFee, deliveryHours, pendingDeal, radioDeals, dealById, cancelRadioDeal, dealCaravanForm, dealLine, goodsText,
} from "../sim/radiotrade.js"; // trading over the radio
import { captivesOf } from "../sim/conflicts.js";
import { itemDur, itemDurMax } from "../sim/crafting.js";
import { qualityWord, rollsQuality } from "../sim/itemcond.js"; // condition in a word (poor … excellent)
import { itemLoad } from "../sim/inventory.js";
import { modLabel } from "../sim/gunmods.js";
import { vehiclesAtBase, carsAtBase, vehicleById, tank } from "../sim/vehicles.js";
import { radioDiploBlock } from "./diplomacy.js";
import { vehicleOffers, buyVehicle, sellVehicle } from "../sim/vehicletrade.js"; // the Vehicles section
import { visitorTradeHead, visitorTradeButtons } from "./visitors.js";
import { baseListenSection } from "./radiolisten.js"; // Listen in at a base (sim/radiolisten.js)
import { radioSecurity } from "./intel.js"; // radio discipline, encryption, decoys (sim/intel.js)
import { ask } from "./confirm.js"; // attacking a caravan asks first (one confirmation style)
import { supplyAmt } from "../sim/rounds.js"; // "ammo": every round, any calibre

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const n0 = (v) => Math.floor((v || 0) + 1e-9);
const p1 = (v) => (Math.round((v || 0) * 10) / 10).toFixed(1);
const attColor = (a) => ({ Hostile: "var(--danger)", Neutral: "var(--muted)", Friendly: "var(--good)", Allied: "var(--accent)" }[a]);
const when = (hour) => `day ${Math.floor(hour / 24) + 1}, ${String(hour % 24).padStart(2, "0")}:00`;
const first = (s) => esc(s.name.split(" ")[0]);

// ---------- trade window ----------
// Condition: a word and the percent for gear that has one (sim/itemcond.js), the uses left of the most it can have.
const condText = (item) => (rollsQuality(item.key) || (item.quality ?? 1) !== 1 ? `${qualityWord(item.quality ?? 1)} ${Math.round((item.quality ?? 1) * 100)}%` : "");
function gearLabel(item) {
  const dur = itemDur(item);
  const bits = [condText(item), dur != null ? `${dur}/${itemDurMax(item)} uses` : ""].filter(Boolean).join(" · ");
  return `${esc(modLabel(item))}${bits ? ` <span class="muted">${bits}</span>` : ""}`; // a gun with its attachments (sim/gunmods.js): they sell with it
}
// No base value anywhere: what this group pays or charges, and why (sim/valuation.js).
const gearTip = (item, price, mine, why) => {
  const d = GEAR[item.key];
  const dur = itemDur(item);
  const cond = [condText(item) ? `condition ${condText(item)}` : "", dur != null ? `${dur} of ${itemDurMax(item)} uses left` : ""].filter(Boolean).join(", ");
  return `${d.name}${cond ? `: ${cond}` : ""}. ${mine ? "They pay" : "They charge"} ${p1(price)}${why.length ? ` (${why.map((w) => w.text.toLowerCase()).join("; ")})` : ""}. ${d.desc || ""}`.trim();
};
// The "why" lines under a row: what moves this group's price for it (no numbers).
const whyHtml = (why) => why.map((w) => `<span class="tw-why ${w.dir}">${w.dir === "up" ? "▲" : w.dir === "down" ? "▼" : "✕"} ${esc(w.text)}</span>`).join("");

function supplyRows(state, ctx, side) {
  const { t, f, speech } = ctx;
  const mine = side === "mine";
  // Rounds go by calibre and type (sim/ammo.js): a row for each kind either side has; never the generic "ammo".
  return SUPPLY_KEYS.filter((k) => k !== "ammo" && (!(SUPPLIES[k].round || SUPPLIES[k].reload) || (ctx.have[k] || 0) >= 1 || (ctx.theirHave[k] || 0) >= 1 || (t.offer[k] || 0) > 0 || (t.ask[k] || 0) > 0)).map((k) => {
    const have = mine ? ctx.have[k] || 0 : ctx.theirHave[k] || 0;
    const q = (mine ? t.offer[k] : t.ask[k]) || 0;
    const unit = mine ? sellPrice(state, f, k, speech, Math.max(1, q)) : buyPrice(state, f, k, speech, Math.max(1, q));
    const no = supplyInfo(state, f, k).refused;
    const why = mine || no ? priceWhy(state, f, k) : []; // the why lines once, on your side (the same reasons move both prices)
    const btn = (dd, label, dis) => `<button class="mini" data-action="tw-qty" data-side="${side}" data-k="${k}" data-d="${dd}" ${dis || no ? "disabled" : ""}>${label}</button>`;
    return `<tr${tip(no ? `They will not touch ${catName(catOf(k))}.` : mine ? `What they give you per ${SUPPLIES[k].name.toLowerCase()} (${p1(unit)} each for this many). Prices fall as they take more.` : `What they charge per ${SUPPLIES[k].name.toLowerCase()} (${p1(unit)} each for this many). Prices rise as they part with more.`)}>
      <td><b>${SUPPLIES[k].name}</b>${whyHtml(why)}</td><td class="muted">${n0(have)}</td><td class="muted">${no ? "—" : p1(unit)}</td>
      <td class="tw-step">${btn(-10, "−10", q <= 0)}${btn(-1, "−", q <= 0)}<input type="number" min="0" max="${n0(have)}" class="tw-qty" data-action="tw-set" data-side="${side}" data-k="${k}" value="${q}"${no ? " disabled" : ""}>${btn(1, "+", q >= have)}${btn(10, "+10", q >= have)}${btn("max", "All", q >= have)}</td></tr>`;
  }).join("");
}

function gearRows(state, ctx, side) {
  const mine = side === "mine";
  const pool = mine ? ctx.myGear : ctx.theirGear;
  const chosen = mine ? ctx.t.offerGear : ctx.t.askGear;
  if (!pool.length) return `<div class="small muted">${mine ? (ctx.kind === "visit" ? "No items in the team's cargo." : "No items in the armory.") : "No items for sale."}</div>`;
  const prices = tradeTotals(state).lines.gear; // this group's price for each item (one not in the deal: as the next of its kind)
  return `<table class="t">${pool.map((g, i) => {
    const on = chosen.includes(g);
    const price = prices.get(g) || 0;
    const no = gearInfo(state, ctx.f, g).refused;
    const why = priceWhy(state, ctx.f, g, { pool: ctx.theirGear });
    return `<tr${tip(gearTip(g, price, mine, why))}><td>${gearLabel(g)}${whyHtml(why)}</td><td class="muted">${no ? "—" : p1(price)}</td><td><button class="mini ${on ? "active" : ""}" data-action="tw-gear" data-side="${side}" data-i="${i}"${no && !on ? " disabled" : ""}>${on ? "✓ In the deal" : no ? "Won't touch" : mine ? "Offer" : "Take"}</button></td></tr>`;
  }).join("")}</table>`;
}

function intelBlock(state, ctx) {
  const io = intelOffer(state, ctx);
  const sp = spread(ctx.f, ctx.speech);
  const it = ctx.t.intel;
  const where = ctx.kind === "visit" ? "around their gates" : `around ${ctx.f.name}'s base`;
  return `<h3${tip("Their scouts' reports. A report shows each tile as it is now: who holds it, loot left, infection, hordes and hives. The fog lifts only on the tiles you pay for. A team carries the report home (or radios it in); at your base it goes on the map at once.")}>Intel</h3>
    <div class="row small" style="flex-wrap:wrap">${io.areas.map((a) => `<button class="mini ${it.area === a.key ? "active" : ""}" data-action="tw-intel" data-f="area" data-v="${a.key}"${tip(`${a.tiles} tiles ${where}: ${p1(a.value * sp.buy)} in trade value`)}>${esc(a.name)} · ${p1(a.value * sp.buy)}</button>`).join("")}
      <button class="mini ${it.sightings ? "active" : ""}" data-action="tw-intel" data-f="sightings"${tip(`Every horde and hive within 12 tiles of them (${io.sightings.hordes} hordes, ${io.sightings.nests} hives that they know of)`)}>Horde and hive sightings · ${p1(io.sightings.value * sp.buy)}</button>
      <button class="mini ${it.sell ? "active" : ""}" data-action="tw-intel" data-f="sell" ${io.sell.ok || it.sell ? "" : "disabled"}${tip(io.sell.ok ? `Sell your own maps: ${io.sell.tiles} tiles you know well near them` : io.sell.why)}>Sell your maps · ${p1(io.sell.value * sp.sell)}</button></div>`;
}

// Vehicles (sim/vehicletrade.js): bought and sold on their own, paid in goods at their worth, outside the deal above.
function vehicleBlock(state, ctx) {
  const o = vehicleOffers(state, ctx);
  if (!o.theirs.length && !o.mine.length) return "";
  const row = (name, sub, price, act, i, label, hint) => `<tr${tip(hint)}><td>${esc(name)} <span class="muted">${esc(sub)}</span></td><td class="muted">${price}</td><td><button class="mini" data-action="${act}" data-i="${i}">${label}</button></td></tr>`;
  const sub = (v) => `${Math.round(v.condition)}% · fuel ${Math.round(v.fuel || 0)}${v.upgrades && Object.values(v.upgrades).some(Boolean) ? " · upgraded" : ""}`;
  return `<h3${tip("A vehicle changes hands on its own, paid in goods at their worth (scrap, fuel, ammo, parts, then food and meds): its type, condition and upgrades, how much they want one, and your Speech and goodwill set the price. A vehicle you sell leaves its cargo with you.")}>Vehicles</h3>
    <div class="grid2"><div>${o.mine.length ? `<table class="t">${o.mine.map((x, i) => row(x.v.name, sub(x.v), x.price, "tw-vsell", i, "Sell", `They pay goods worth ${x.price}`)).join("")}</table>` : `<div class="small muted">${ctx.visitor ? "Merchants do not buy vehicles." : "No vehicle of yours here to sell."}</div>`}</div>
    <div>${o.theirs.length ? `<table class="t">${o.theirs.map((x, i) => row(x.rec.name, sub(x.rec), x.price, "tw-vbuy", i, "Buy", ctx.kind === "radio" ? `Goods worth ${x.price} from ${ctx.base.name}; they drive it over (a day)` : `Goods worth ${x.price}`)).join("")}</table>` : `<div class="small muted">No vehicles for sale.</div>`}</div></div>`;
}
// What moves this group's prices right now, and what their kind prizes and shuns (no numbers).
const marginOf = (f) => margin(f);
export function moodBlock(state, f) {
  const s = situation(state, f);
  const t = tastes(f);
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  return `<div class="tw-mood small"${tip("What moves their prices. Goods they want more than usual are marked ▲ (they pay more for them, and charge more), goods they care little for ▼, goods they will not touch ✕.")}>
    <div><b>${esc(profileLabel(f))}</b>${t.likes.length ? ` · prize ${esc(t.likes.slice(0, 4).join(", "))}` : ""}${t.dislikes.length ? ` · little use for ${esc(t.dislikes.slice(0, 3).join(", "))}` : ""}${t.refuses.length ? ` · <span class="danger">will not touch ${esc(t.refuses.join(", "))}</span>` : ""}${t.dear ? " · they sell dear" : ""}</div>
    ${s.length ? `<div>Right now: ${esc(cap(s.join(", ")))}.</div>` : ""}</div>`;
}

// Over the radio: the base whose stores are on your side (a pick when you have more than one).
function radioBasePick(state, ctx) {
  if (state.bases.length < 2) return esc(ctx.base.name);
  return `<select data-action="tw-radiobase"${tip("The base whose stores and armory you trade from. The goods go from and to there.")}>${state.bases.map((b) => `<option value="${b.id}" ${b.id === ctx.base.id ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select>`;
}
// Over the radio: who carries the goods.
function deliveryPick(state, ctx) {
  const { f, base } = ctx;
  const hrs = deliveryHours(state, f, base);
  const fee = deliveryFee(state, f, base);
  const b = (v, label, hint) => `<button class="mini ${ctx.delivery === v ? "active" : ""}" data-action="tw-delivery" data-v="${v}"${tip(hint)}>${label}</button>`;
  return `<div class="row small" style="margin:0.3rem 0;flex-wrap:wrap"><b>Delivery:</b>
    ${b("fetch", "We fetch it", `You send a trade caravan from ${base.name} to ${f.name} with your side, and it brings theirs back. They set their side aside for about ten days. No fee.`)}
    ${b("deliver", `They bring it${hrs != null ? ` · fee ${p1(fee)}` : ""}`, hrs != null ? `Their caravan brings their side to ${base.name} (about ${hrs}h) and takes yours back. The fee (in their prices) goes on their side; they may still say no.` : `They have no way to reach ${base.name} over land.`)}
    <span class="muted">${ctx.delivery === "deliver" ? `Have your side ready at ${esc(base.name)} when they arrive.` : `Agreeing opens the trade caravan planner from ${esc(base.name)}.`}</span></div>
    ${ctx.delivery === "deliver" && hrs != null ? `<div class="row small" style="margin:0.2rem 0 0.3rem;flex-wrap:wrap"><b>Fee:</b>
      <button class="mini ${ctx.t.feeOffer == null ? "active" : ""}" data-action="tw-feemode" data-v="theirs"${tip("They name the fee for the trip")}>Their fee · ${p1(fee)}</button>
      <button class="mini ${ctx.t.feeOffer != null ? "active" : ""}" data-action="tw-feemode" data-v="mine"${tip("Name your own fee. Too low and they stay home (they tell you their lowest); more than theirs earns a little goodwill.")}>Your offer</button>
      ${ctx.t.feeOffer != null ? `<input type="number" min="0" class="tw-qty" data-action="tw-fee" value="${ctx.t.feeOffer}"${tip("Your fee, in their prices")}>` : ""}</div>` : ""}`;
}

export function tradeWindow(state, ui) {
  const ctx = tradeContext(state);
  if (!ctx) return `<div class="box"><h1>Trade</h1><div class="text">There is nobody to trade with any more.</div><button class="primary" data-action="tradeleave">Close</button></div>`;
  const { t, f, speech } = ctx;
  const tot = tradeTotals(state);
  const v = tradeVerdict(state);
  const a = attitude(f);
  const sp = spread(f, speech);
  const c = ctx.caravan;
  const radio = ctx.kind === "radio";
  const where = radio
    ? `Over the radio · trading from ${radioBasePick(state, ctx)}'s stores and armory · nothing changes hands until a caravan carries it`
    : ctx.visitor // outsiders (ui/visitors.js)
    ? `${visitorTradeHead(state, ctx)} · ${ctx.base ? `at ${esc(ctx.base.name)} until ${when(ctx.visitor.stayUntil)} · trading from ${esc(ctx.base.name)}'s stores and armory` : `met on the road (${esc(tileLabel(state, ctx.center))}) · trading from what the team carries`}`
    : ctx.kind === "visit"
    ? `Your team at their gates (${esc(tileLabel(state, ctx.center))}) · trading from what the team carries`
    : `Their caravan at ${esc(ctx.base.name)} · ${caravanGuards(f, c)} guards · leaves ${when(c.stayUntil)} · trading from ${esc(ctx.base.name)}'s stores and armory`;
  const total = tot.offer + tot.ask;
  const pct = total > 0 ? Math.round((tot.offer / total) * 100) : 50;
  const held = ctx.kind === "visit" ? captivesOf(state, f.id) : [];
  return `<div class="box wide tradebox"><h1><span class="swatch" style="background:${f.color}"></span>${esc(f.name)}</h1>
    <div class="where">${FACTION_TYPES[f.type].label} · <span style="color:${attColor(a)}">${a}</span> · goodwill ${Math.round(f.goodwill)} · your best Speech ${speech}${f.pact ? ` · ${f.pact === "trade" ? "trade pact" : "non-aggression pact"}` : ""}</div>
    <div class="small muted">${where}</div>
    ${held.length ? `<div class="small danger">They hold ${held.map(first).join(", ")}. A ransom was offered when you arrived; a Rescue team can also get them out.</div>` : ""}
    ${radio ? deliveryPick(state, ctx) : ""}
    ${t.deal ? `<div class="small good">Agreed over the radio: you give ${Object.entries(t.deal.offer).map(([k, q]) => `${q} ${k}`).join(", ")} for ${Object.entries(t.deal.ask).map(([k, q]) => `${q} ${k}`).join(", ")}. They honour it as agreed.</div>` : ""}
    ${moodBlock(state, f)}
    <div class="small muted" style="margin:0.3rem 0"${tip("Every group prices things its own way: what kind of group it is, the state it is in (war, hordes, hunger, sickness, the season, wealth) and how much of it it already has. An item's condition and uses left count too. They pay you less than they charge: Speech and goodwill narrow the gap.")}>Haggling: they pay you about ${Math.round((sp.sell / (sp.buy * marginOf(f))) * 100)}% of what they would charge for the same thing (Speech ${speech}, goodwill ${Math.round(f.goodwill)}${marginOf(f) > 1 ? "; they sell dear" : ""}).</div>
    <div class="grid2 tw-cols">
      <div><h3>You give</h3><table class="t"><tr><th></th><th>Have</th><th>Each</th><th>In the deal</th></tr>${supplyRows(state, ctx, "mine")}</table>
        <h3>Your items</h3>${gearRows(state, ctx, "mine")}</div>
      <div><h3>You get</h3><table class="t"><tr><th></th><th>They have</th><th>Each</th><th>In the deal</th></tr>${supplyRows(state, ctx, "theirs")}</table>
        <h3>Their items</h3>${gearRows(state, ctx, "theirs")}</div>
    </div>
    ${vehicleBlock(state, ctx)}
    ${radio ? "" : intelBlock(state, ctx) /* news goes by Ask for news on the radio */}
    <div class="tw-totals">
      <div class="spread small"><span${tip("What your side is worth to them")}>Your side: <b>${p1(tot.offer)}</b></span><span${tip(ctx.fee ? "What their side costs at their prices, with the delivery fee" : "What their side costs at their prices")}>Their side: <b>${p1(tot.ask)}</b>${ctx.fee ? ` <span class="muted">(${p1(ctx.fee)} of it the delivery fee)</span>` : ""}</span></div>
      <div class="tw-balance"${tip("Left: what you give. Right: what you take. The deal is fair for them when your side is at least as big.")}><i style="width:${pct}%"></i><b style="left:50%"></b></div>
      <div class="small ${v.ok ? "good" : "danger"}">${esc(v.reason)}</div>
      <div class="row small" style="margin-top:0.3rem">Balance with ${["ammo", "scrap", "food"].map((k) => `<button class="mini" data-action="tw-balance" data-k="${k}"${tip(`Short: adds ${k} to your side until it is fair. Overpaying: asks for ${k} until the sides meet.`)}>${SUPPLIES[k].name}</button>`).join("")}</div>
    </div>
    ${ui.tradeMsg ? `<div class="result">${esc(ui.tradeMsg)}</div>` : ""}
    <div class="row" style="margin-top:0.7rem;flex-wrap:wrap">
      <button class="primary" data-action="dotrade" ${v.ok ? "" : "disabled"}${tip(!v.ok ? v.reason : radio ? (ctx.delivery === "deliver" ? "Ask them to bring it. They may say no; if they agree, their caravan sets out and the trade window opens when it arrives." : "Book the deal. Their side is set aside for you, and the trade caravan planner opens to take your side to them.") : "Swap the goods. Bigger deals and overpaying earn goodwill (up to 4 a day).")}>${radio ? "Agree the deal" : "Accept the deal"}</button>
      ${radio ? "" : `<button data-action="gift" ${tot.offer > 0 ? "" : "disabled"}${tip("Give your side for nothing in return. Raises goodwill (up to 15 a day).")}>Give your side as a gift</button>`}
      ${ctx.visitor ? visitorTradeButtons(state, ui, ctx) : `<button data-action="pact" data-k="nonaggression" ${f.pact ? "disabled" : ""}${tip("They stop treating you as a target. Needs goodwill about -10 or more.")}>Non-aggression pact</button>
      <button data-action="pact" data-k="trade" ${f.pact === "trade" ? "disabled" : ""}${tip("Lets you set up a recurring trade route. Needs goodwill 20.")}>Trade pact</button>
      ${c ? `<button data-action="tw-attack" data-id="${c.id}"${tip(`Fight its ${caravanGuards(f, c)} guards for everything it carries. ${f.name} turn hostile for good, other groups think less of you, and ${f.name} will raid you. Asks first.`)}>Attack the caravan…</button>` : ""}`}
      <button data-action="tradeleave" style="margin-left:auto"${tip(radio ? "Hang up: back to the radio panel" : c ? "Close the window. The caravan stays until its day is up; reopen it from the Bases tab." : "End the visit. The team then waits for orders.")}>${radio ? "Hang up" : c ? "Close" : "Leave"}</button>
    </div></div>`;
}

// ---------- radio panel ----------
export function radioModal(state, ui) {
  const f = factionById(state, ui.radioWith);
  if (!f) return null;
  const a = attitude(f);
  const reach = canRadioGroup(state, f);
  const no = refusal(state, f);
  const noTrade = refusal(state, f, true);
  const cd = (k) => radioCooldown(state, f, k);
  const btn = (action, label, hint, dis, extra = "") => `<button data-action="${action}" data-id="${f.id}"${extra} ${dis ? "disabled" : ""}${tip(hint)}>${label}</button>`;
  const base = tradeBase(state, f);
  const pend = pendingDeal(state, f); // a radio deal waiting for your caravan (sim/radiotrade.js)
  const tb = state.bases.some((b) => b.id === ui.radioBase) ? ui.radioBase : (base || state.bases[0] || {}).id;
  const coming = incomingCaravans(state).filter((c) => c.owner === f.id);
  return `<div class="box wide"><h1>📻 ${esc(f.name)}</h1>
    <div class="where">${FACTION_TYPES[f.type].label} · <span style="color:${attColor(a)}">${a}</span> · goodwill ${Math.round(f.goodwill)}${f.pact ? ` · ${f.pact === "trade" ? "trade pact" : "non-aggression pact"}` : ""} · ${reach ? `<span class="good">in radio reach</span>` : outOfReachTag(state, f)}</div>
    <div class="grid2">
      <div>
        <h3>Calls</h3>
        <div class="choices">
          ${btn("rd-greet", "Greet them / keep in touch", cd("greet") ? `Again in ${cd("greet")} day(s)` : "+2 goodwill. Regular contact stops neutral groups drifting hostile when you expand nearby.", !reach || cd("greet"))}
          ${btn("rd-news", "Ask for news", no || (cd("news") ? `Again in ${cd("news")} day(s)` : "A report of the land around their bases (more if they like you) and the hordes near them."), !!no || cd("news"))}
          ${btn("rd-caravan", "Ask them to send a trade caravan", noTrade || (cd("caravan") ? `Again in ${cd("caravan")} day(s)` : coming.length ? "Their caravan is already out" : `If they agree, a caravan of what they can spare comes to ${base ? base.name : "your base"} and stays a day.`), !!noTrade || cd("caravan") || coming.length)}
          ${btn("rd-help", "Call for help", no || (cd("help") ? `Again in ${cd("help")} day(s)` : "Friendly groups or pact partners harry a raid on its way to you, or send food if the hub is starving. Costs 4 goodwill."), !!no || cd("help"))}
          ${btn("rd-pact", "Propose a non-aggression pact", "Needs goodwill about -10 or more", !!no || !!f.pact, ' data-k="nonaggression"')}
          ${btn("rd-pact", "Propose a trade pact", "Needs goodwill 20. Opens trade routes.", !!no || f.pact === "trade", ' data-k="trade"')}
        </div>
      </div>
      <div>
        <h3${tip("The full trade window over the radio: one of your bases' stores and armory against what they can spare. Nothing changes hands on the air: you fetch it with a caravan of yours, or ask them to bring it for a fee.")}>Trade over the radio</h3>
        ${pend ? `<div class="small">A deal is waiting: ${esc(dealLine(state, pend))}.</div>
          <div class="row" style="margin-top:0.3rem"><button data-action="rd-dealcaravan" data-id="${pend.id}"${tip("Open the trade caravan planner with your side loaded")}>Send a caravan…</button><button data-action="rd-dealcancel" data-id="${pend.id}"${tip("Their side goes back into their stores; they think less of you (goodwill -3)")}>Call it off</button></div>`
        : `<div class="row small">From ${state.bases.length > 1 ? `<select data-action="rd-tradebase">${state.bases.map((b) => `<option value="${b.id}" ${b.id === tb ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select>` : esc(state.bases[0] ? state.bases[0].name : "nowhere")}</div>
          <div style="margin-top:0.3rem">${btn("rd-trade", "Open the trade window…", noTrade || (state.trade ? "Finish the trade on screen first" : "Their spare stock and wares against your base's stores. Afterwards a caravan carries the goods: yours, or theirs for a fee."), !!noTrade || !!state.trade)}</div>`}
        ${coming.length ? `<div class="small" style="margin-top:0.4rem">${coming.map((c) => c.phase === "trading" ? `Their caravan is at ${esc(baseById(state, c.baseId)?.name || "your base")} until ${when(c.stayUntil)}.` : `Their caravan is on the way to ${esc(baseById(state, c.baseId)?.name || "your base")}.`).join(" ")}</div>` : ""}
      </div>
    </div>
    ${moodBlock(state, f)}
    ${radioDiploBlock(state, f) /* ui/diplomacy.js: wants and surplus, wars, the coalition */}
    ${ui.radioMsg ? `<div class="result">${esc(ui.radioMsg)}</div>` : ""}
    ${(f.radioLog || []).length ? `<h3>On the radio</h3><div class="small">${f.radioLog.map((l) => `<div><span class="muted">Day ${l.day}</span> ${esc(l.text)}</div>`).join("")}</div>` : ""}
    <div class="row" style="margin-top:0.8rem;justify-content:flex-end"><button class="primary" data-action="rd-close">Close</button></div></div>`;
}

// ---------- Groups tab: radio header ----------
export function groupsRadioHeader(state) {
  const net = hasNetwork(state);
  const nodes = radioNodes(state);
  const ears = listeners(state); // hand-crank radios (hearing only)
  const relays = nodes.filter((n) => n.kind === "relay");
  const coming = incomingCaravans(state);
  return `<div class="card small">
    <div class="spread"><b>📻 Radio</b><span class="muted">${net ? `${nodes.filter((n) => n.linked).length} transmitter${nodes.filter((n) => n.linked).length === 1 ? "" : "s"} on the air${ears.length ? `, ${ears.length} hand-crank radio${ears.length === 1 ? "" : "s"} listening` : ""}` : ears.length ? `No radio station: ${ears.length === 1 ? "a hand-crank radio listens" : `${ears.length} hand-crank radios listen`} (hearing only)` : "No radio station"}</span></div>
    <div class="muted">${net ? `Groups whose base is within your coverage (plus ${GROUP_REACH} tiles: they have radios too) can be called and invited into the coalition.${relays.length ? ` Relays: ${relays.map((n) => `${esc(n.base.name)} ${n.offline ? "(offline)" : n.linked ? "(linked)" : "(not linked)"}`).join(", ")}.` : ` Build radio relays at your other bases to reach further (${RELAY_RANGE} tiles each, linked in a chain back to a station).`}${relayHints(state)}` : "Build a radio station (Manage → Construction) to call other groups and hear from them."}</div>
    <div class="row" style="margin-top:0.35rem">
      <button data-action="rd-scan" ${(net || ears.length) && state.radioScanDay !== day(state) ? "" : "disabled"}${tip(net || ears.length ? `Listen for groups within reach that you have not met (once a day)${ears.length ? "; a hand-crank radio hears them inside their network but cannot call them" : ""}` : "Needs a radio station, or a hand-crank radio inside a radio network's coverage")}>Scan the airwaves</button>
      <button data-action="cp-open"${tip("A trade caravan of yours: crew, goods and a list of destinations (groups' bases, your outposts)")}>New trade caravan…</button>
    </div>
    ${baseListenSection(state)}
    ${radioSecurity(state)}
    ${radioDeals(state).map((d) => `<div style="margin-top:0.3rem">Radio deal: ${esc(dealLine(state, d))} <button class="mini" data-action="rd-dealcaravan" data-id="${d.id}"${tip("Open the trade caravan planner with your side loaded")}>Send a caravan…</button></div>`).join("")}
    ${coming.length ? coming.map((c) => {
      const f = factionById(state, c.owner);
      const b = baseById(state, c.baseId);
      return `<div style="margin-top:0.3rem">${c.phase === "trading" ? `<span class="good">Caravan from ${esc(f ? f.name : "?")} at ${esc(b ? b.name : "your base")}</span> <button class="mini" data-action="cv-trade" data-id="${c.id}">Trade</button>` : `Caravan from ${esc(f ? f.name : "?")} on the way to ${esc(b ? b.name : "your base")}${c.gift ? " (aid)" : ""}`}</div>`;
    }).join("") : ""}
  </div>`;
}

// One line per foreign caravan at a base (Bases tab card).
export function caravanLines(state, base) {
  return caravansAt(state, base.id).map((c) => {
    const f = factionById(state, c.owner);
    return `<div>Caravan</div><div><span class="good">${esc(f ? f.name : "Traders")}</span> until ${when(c.stayUntil)} <button class="mini" data-action="cv-trade" data-id="${c.id}"${tip("Open the trade window")}>Trade</button></div>`;
  }).join("") + `<div${tip(`Radio stations reach ${RADIO_RANGE} tiles, relays ${RELAY_RANGE} (when linked: within range of a station or another linked relay). A relay goes up at any base without a station.`)}>Radio</div><div>${esc(radioSummary(state, base))}</div>`;
}

// "out of reach" in a group's radio panel, with how to reach it (radio.js relaySpotFor: a relay that would do it).
function outOfReachTag(state, f) {
  const spot = relaySpotFor(state, f);
  const how = spot ? `A radio relay at ${spot.name} would bring them into your coverage (calls, pacts, the coalition's invitation).`
    : `Their base must lie within your radio coverage + ${GROUP_REACH} tiles: a station reaches ${RADIO_RANGE}, each linked relay ${RELAY_RANGE} more around its base.`;
  return `<span class="danger"${tip(how)}>out of reach</span>${spot ? ` <span class="muted">(a relay at ${esc(spot.name)} would reach them)</span>` : ""}`;
}
// The radio header's line on relays worth building: known groups out of reach that a relay at one of your bases
// would bring in (radio.js relaySpotFor), grouped by base.
function relayHints(state) {
  const by = new Map();
  for (const f of state.factions) {
    if (!f.alive || !f.known) continue;
    const spot = relaySpotFor(state, f);
    if (spot) by.set(spot, [...(by.get(spot) || []), f.name]);
  }
  return [...by].map(([b, names]) => ` A relay at ${esc(b.name)} would reach ${names.map(esc).join(", ")}.`).join("");
}

// ---------- trade caravan planner ----------
export const newCaravanForm = () => ({ crew: [], vehicleId: null, stance: "normal", goods: {}, travel: { food: 0, water: 0, fuel: 0 }, gear: [], stops: [] });

// What each group on the route would give for the goods and items loaded (today's prices, before Speech), with
// what moves it: the planner's way to pick the best buyer without seeing any base value.
function worthAtStops(state, form) {
  const h = caravanHome(state, form);
  const gear = form.gear.map((i) => h.armory[i]).filter(Boolean);
  const goods = Object.fromEntries(Object.entries(form.goods).filter(([, q]) => q > 0));
  if (!Object.keys(goods).length && !gear.length) return "";
  const rows = [];
  for (const tile of form.stops) {
    const f = state.factions.find((x) => x.alive && x.bases.includes(tile));
    if (!f || rows.some((r) => r.f === f)) continue;
    const why = [...Object.keys(goods), ...gear].map((w) => priceWhy(state, f, w, { max: 1 })[0]).filter(Boolean);
    rows.push({ f, worth: goodsWorth(state, f, goods, gear), why: why.filter((w, i) => why.findIndex((x) => x.text === w.text) === i).slice(0, 2) });
  }
  if (!rows.length) return "";
  return `<h3${tip("What each group on the route would give for what you load, at today's prices (your Speech adds to it). Their kind, their state and their stock all move it.")}>Worth to them</h3><table class="t">${rows.map((r) => `<tr><td>${esc(r.f.name)}${whyHtml(r.why)}</td><td class="muted">${p1(r.worth)}</td></tr>`).join("")}</table>`;
}

export function caravanPlanModal(state, ui) {
  const form = ui.caravanPlan;
  const h = caravanHome(state, form); // the hub, or the base picked (a radio deal's base)
  const deal = form.dealId != null ? dealById(state, form.dealId) : null;
  const pool = atBase(state, h.id);
  const est = caravanEstimate(state, form);
  const v = form.vehicleId ? vehicleById(state, form.vehicleId) : null;
  const dests = caravanDestinations(state).filter((x) => !form.stops.includes(x.tile));
  const members = form.crew.map((id) => survivorById(state, id)).filter(Boolean);
  const cap = carryCapacity(state, members, v);
  const sup = {};
  for (const k of SUPPLY_KEYS) sup[k] = (form.goods[k] || 0) + (form.travel[k] || 0);
  const load = SUPPLY_KEYS.reduce((s, k) => s + sup[k] * SUPPLIES[k].weight, 0) + form.gear.reduce((s, i) => s + (h.armory[i] ? itemLoad(h.armory[i]) : 0), 0);
  const over = members.length && load > cap + 1e-9;
  const shortStock = SUPPLY_KEYS.filter((k) => sup[k] > supplyAmt(h.stock, k)); // "ammo": every round (sim/rounds.js)
  const canGo = members.length && form.stops.length && est.ok && !over && !shortStock.length;
  return `<div class="box wide"><h1>New trade caravan</h1>
    ${state.bases.length > 1 ? `<div class="row small">From <select data-action="cp-from">${state.bases.map((b) => `<option value="${b.id}" ${b.id === h.id ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></div>` : ""}
    ${deal ? `<div class="small good" style="margin:0.3rem 0"${tip("At their base the caravan's stop card offers Complete the radio deal when it carries your side")}>For the radio deal with ${esc(dealLine(state, deal))}.</div>` : ""}
    <div class="grid2">
      <div>
        <h3>Destinations, in order</h3>
        ${form.stops.length ? `<table class="t">${form.stops.map((tile, i) => `<tr><td>${i + 1}. ${esc(est.legs[i]?.name || tileLabel(state, tile))}</td><td class="muted"${tip("Hours on the road for this leg, as the team really moves (weather included)")}>${est.legs[i]?.hours != null ? `${est.legs[i].hours}h` : "no route"}</td>
          <td><button class="mini" data-action="cp-stop" data-op="up" data-i="${i}" ${i ? "" : "disabled"}${tip("Earlier")}>↑</button><button class="mini" data-action="cp-stop" data-op="down" data-i="${i}" ${i < form.stops.length - 1 ? "" : "disabled"}${tip("Later")}>↓</button><button class="mini" data-action="cp-stop" data-op="del" data-i="${i}"${tip("Remove")}>✕</button></td></tr>`).join("")}
          <tr><td>Home to ${esc(h.name)}</td><td class="muted">${est.back != null ? `${est.back}h` : "no route"}</td><td></td></tr></table>` : `<div class="small muted">No destinations yet.</div>`}
        <div class="row small" style="margin-top:0.3rem">Add <select data-action="cp-addstop"><option value="">pick a destination…</option>${dests.map((x) => `<option value="${x.tile}">${esc(x.name)}${x.hostile ? " (hostile)" : ""}</option>`).join("")}</select></div>
        <div class="small muted" style="margin-top:0.3rem">At each stop: trade there, unload (your outposts), stay a day, go on, or return home. Planned: about ${Math.round(est.hours)}h with 6h at each stop.</div>
        ${worthAtStops(state, form)}
        <h3>Crew (${members.length})</h3>
        <div class="crew" style="grid-template-columns:1fr">${pool.map((s) => `<label class="${form.crew.includes(s.id) ? "on" : ""}"><input type="checkbox" data-action="cp-crew" data-id="${s.id}" ${form.crew.includes(s.id) ? "checked" : ""}> ${esc(s.name)} <span class="small muted">Speech ${skill(s, "speech")} · Combat ${combatPower(s).toFixed(1)}</span></label>`).join("") || `<span class="muted">Nobody is at ${esc(h.name)}.</span>`}</div>
        <h3>Transport</h3>
        <div class="row"><button data-action="cp-vehicle" data-v="" class="${!v ? "active" : ""}">On foot</button>${carsAtBase(state, h.id).map((x) => `<button data-action="cp-vehicle" data-v="${x.id}" class="${v && v.id === x.id ? "active" : ""}" ${x.condition <= 0 ? "disabled" : ""}${tip(`Fuel ${n0(x.fuel)}/${tank(x)}, condition ${Math.round(x.condition)}%`)}>${esc(x.name)}</button>`).join("")}</div>
        <div class="row" style="margin-top:0.3rem">${Object.entries(STANCES).map(([k, s]) => `<button data-action="cp-stance" data-v="${k}" class="${form.stance === k ? "active" : ""}"${tip(s.desc)}>${s.name}</button>`).join("")}</div>
      </div>
      <div>
        <h3>Goods to trade</h3>
        <table class="t"><tr><th></th><th>Trade</th><th>To live on</th><th>${h.type === "hub" ? "Hub" : "Here"}</th></tr>${STOCK_KEYS.map((k) => `<tr><td>${SUPPLIES[k].name}</td><td><input type="number" min="0" class="tw-qty" data-action="cp-good" data-k="${k}" value="${form.goods[k] || 0}"></td><td>${["food", "water", "fuel", "meds", "ammo"].includes(k) ? `<input type="number" min="0" class="tw-qty" data-action="cp-travel" data-k="${k}" value="${form.travel[k] || 0}">` : ""}</td><td class="muted">${n0(supplyAmt(h.stock, k))}</td></tr>`).join("")}</table>
        <button class="mini" data-action="cp-autofill" style="margin-top:0.3rem"${tip("Food and water for the whole route plus 25%, and fuel for the vehicle")}>Auto-fill supplies</button>
        <h3>Items from the armory</h3>
        ${h.armory.length ? `<div class="small">${h.armory.map((g, i) => `<label class="layer"><input type="checkbox" data-action="cp-gear" data-i="${i}" ${form.gear.includes(i) ? "checked" : ""}> ${gearLabel(g)}</label>`).join("")}</div>` : `<div class="small muted">The armory is empty.</div>`}
        <div class="small ${over ? "danger" : "muted"}" style="margin-top:0.4rem">Load ${p1(load)} of ${cap}${over ? ": too heavy" : ""} · needs about ${est.food} food, ${est.water} water${v ? `, ${est.fuel} fuel` : ""}</div>
        ${shortStock.length ? `<div class="small danger">Not enough at ${esc(h.name)}: ${shortStock.join(", ")}.</div>` : ""}
        ${!est.ok && form.stops.length ? `<div class="small danger">No route for one of the legs${v ? " by vehicle" : ""}.</div>` : ""}
      </div>
    </div>
    ${ui.cvMsg ? `<div class="danger" style="margin-top:0.5rem">${esc(ui.cvMsg)}</div>` : ""}
    <div class="row" style="margin-top:1rem;justify-content:flex-end"><button data-action="cp-close">Cancel</button><button class="primary" data-action="cp-launch" ${canGo ? "" : "disabled"}${tip(canGo ? "The caravan sets out (when you unpause, if paused)" : "Pick a crew and at least one destination, and keep the load within what they carry")}>Send the caravan</button></div>
  </div>`;
}

// ---------- handlers (main.js registers them) ----------
const caravanById = (state, id) => state.parties.find((p) => p.id === Number(id) && p.kind === "caravan");
const radioF = (state, ui) => factionById(state, ui.radioWith);
export const TRADE_ACTIONS = {
  // Trade window.
  "tw-qty": (state, ui, d) => {
    const t = state.trade;
    if (!t) return;
    const cur = (d.side === "mine" ? t.offer[d.k] : t.ask[d.k]) || 0;
    setQty(state, d.side, d.k, d.d === "max" ? 1e9 : cur + Number(d.d));
    ui.tradeMsg = "";
  },
  "tw-gear": (state, ui, d) => { toggleGear(state, d.side, d.i); ui.tradeMsg = ""; },
  "tw-intel": (state, ui, d) => { setIntel(state, d.f, d.v); ui.tradeMsg = ""; },
  "tw-vbuy": (state, ui, d) => { ui.tradeMsg = buyVehicle(state, Number(d.i)); },
  "tw-vsell": (state, ui, d) => { ui.tradeMsg = sellVehicle(state, Number(d.i)); },
  "tw-balance": (state, ui, d) => { ui.tradeMsg = balanceWith(state, d.k); },
  offer: (state, ui, d) => { const t = state.trade; if (t) setQty(state, "mine", d.k, (t.offer[d.k] || 0) + Number(d.d)); ui.tradeMsg = ""; },
  ask: (state, ui, d) => { const t = state.trade; if (t) setQty(state, "theirs", d.k, (t.ask[d.k] || 0) + Number(d.d)); ui.tradeMsg = ""; },
  dotrade: (state, ui) => {
    const t = state.trade;
    const f = t && t.radio ? factionById(state, t.factionId) : null;
    ui.tradeMsg = executeTrade(state);
    if (!f || state.trade) return;
    // Booked over the radio (sim/radiotrade.js): back to the radio panel, or on to the caravan planner when you fetch.
    const deal = pendingDeal(state, f);
    if (deal && t.delivery === "fetch") { ui.caravanPlan = dealCaravanForm(state, deal); ui.cvMsg = ""; ui.radioWith = null; }
    else ui.radioWith = f.id;
    ui.radioMsg = ui.tradeMsg;
    ui.tradeMsg = "";
  },
  gift: (state, ui) => { ui.tradeMsg = giftAll(state); },
  pact: (state, ui, d) => { const f = state.trade && factionById(state, state.trade.factionId); if (f) ui.tradeMsg = proposePact(state, f, d.k); },
  tradeleave: (state, ui) => { if (state.trade && state.trade.radio) ui.radioWith = state.trade.factionId; endTrade(state); ui.tradeMsg = ""; ui.attackConfirm = null; },
  // Attack the caravan: asks first (ui/confirm.js), then a battle at your base against its guards.
  "tw-attack": (state, ui, d) => {
    const c = caravanById(state, d.id), f = c ? factionById(state, c.owner) : null;
    if (!c || ask(ui, d, "tw-attack", { kind: "rob", title: `Attack ${f ? `${f.name}'s` : "the"} caravan?`, text: `A battle at your base against its ${f ? caravanGuards(f, c) : ""} guards; win and its goods are yours. ${f ? f.name : "Their group"} turn hostile for good and send raids, and other groups think less of you.`, yes: "Attack" })) return;
    ui.attackConfirm = null; ui.tradeMsg = "";
    const msg = attackCaravan(state, c);
    if (msg) ui.tradeMsg = msg;
  },
  "tw-attack-no": (state, ui) => { ui.attackConfirm = null; },
  "tw-attack-yes": (state, ui, d) => TRADE_ACTIONS["tw-attack"](state, ui, { ...d, ok: "1" }), // the old inline Yes (asked already)
  "cv-trade": (state, ui, d) => { const c = caravanById(state, d.id); if (c && !openCaravanTrade(state, c)) ui.tradeMsg = ""; ui.baseView = null; },
  // Radio panel.
  radiotalk: (state, ui, d) => { TRADE_ACTIONS["rd-open"](state, ui, d); },
  "rd-open": (state, ui, d) => { ui.radioWith = Number(d.id); ui.radioMsg = ""; ui.radioDeal = ui.radioDeal || { wantKey: "meds", wantQty: 10, payKey: "ammo", payQty: 40 }; },
  "rd-close": (state, ui) => { ui.radioWith = null; ui.radioMsg = ""; },
  "rd-scan": (state, ui) => { ui.radioMsg = radioScan(state); },
  "rd-greet": (state, ui) => { const f = radioF(state, ui); if (f) ui.radioMsg = radioGreet(state, f); },
  "rd-news": (state, ui) => { const f = radioF(state, ui); if (f) ui.radioMsg = radioNews(state, f); },
  "rd-caravan": (state, ui) => { const f = radioF(state, ui); if (f) ui.radioMsg = radioRequestCaravan(state, f); },
  "rd-help": (state, ui) => { const f = radioF(state, ui); if (f) ui.radioMsg = radioHelp(state, f); },
  "rd-pact": (state, ui, d) => { const f = radioF(state, ui); if (f) ui.radioMsg = radioPact(state, f, d.k); },
  "rd-deal": (state, ui) => { const f = radioF(state, ui); if (f) ui.radioMsg = radioDeal(state, f, ui.radioDeal || {}).text; },
  // Trade over the radio (sim/radiotrade.js): the trade window from a base; a pending deal's caravan.
  "rd-trade": (state, ui) => {
    const f = radioF(state, ui);
    if (!f) return;
    const b = state.bases.find((x) => x.id === ui.radioBase) || tradeBase(state, f) || state.bases[0];
    const why = openRadioTrade(state, f, b && b.id);
    ui.radioMsg = why;
    ui.tradeMsg = "";
  },
  "rd-dealcaravan": (state, ui, d) => {
    const deal = dealById(state, d.id);
    if (!deal) return;
    ui.caravanPlan = dealCaravanForm(state, deal);
    ui.cvMsg = "";
    ui.radioWith = null;
  },
  "rd-dealcancel": (state, ui, d) => { const deal = dealById(state, d.id); if (deal) ui.radioMsg = cancelRadioDeal(state, deal); },
  "tw-delivery": (state, ui, d) => { setDelivery(state, d.v); ui.tradeMsg = ""; },
  "tw-feemode": (state, ui, d) => { const t = state.trade; if (t && t.radio) setFeeOffer(state, d.v === "mine" ? Math.round(deliveryFee(state, factionById(state, t.factionId), baseById(state, t.baseId))) : null); ui.tradeMsg = ""; },
  // Trade caravan planner.
  "cp-open": (state, ui) => { ui.caravanPlan = newCaravanForm(); ui.cvMsg = ""; },
  "cp-close": (state, ui) => { ui.caravanPlan = null; ui.cvMsg = ""; },
  "cp-crew": (state, ui, d) => { const c = ui.caravanPlan.crew, id = Number(d.id); const i = c.indexOf(id); i >= 0 ? c.splice(i, 1) : c.push(id); },
  "cp-vehicle": (state, ui, d) => { ui.caravanPlan.vehicleId = d.v ? Number(d.v) : null; },
  "cp-stance": (state, ui, d) => { ui.caravanPlan.stance = d.v; },
  "cp-gear": (state, ui, d) => { const g = ui.caravanPlan.gear, i = Number(d.i); const j = g.indexOf(i); j >= 0 ? g.splice(j, 1) : g.push(i); },
  "cp-stop": (state, ui, d) => {
    const s = ui.caravanPlan.stops, i = Number(d.i);
    if (d.op === "del") s.splice(i, 1);
    else if (d.op === "up" && i > 0) [s[i - 1], s[i]] = [s[i], s[i - 1]];
    else if (d.op === "down" && i < s.length - 1) [s[i + 1], s[i]] = [s[i], s[i + 1]];
  },
  "cp-autofill": (state, ui) => {
    const form = ui.caravanPlan, h = caravanHome(state, form), est = caravanEstimate(state, form);
    const v = form.vehicleId ? vehicleById(state, form.vehicleId) : null;
    form.travel.food = Math.min(n0(h.stock.food) - (form.goods.food || 0), est.food);
    form.travel.water = Math.min(n0(waterIn(h.stock)) - (form.goods.water || 0) - (form.goods.rawwater || 0), est.water); // both kinds (sim/water.js): purified packed first
    form.travel.fuel = v ? Math.max(0, Math.min(n0(h.stock.fuel) - (form.goods.fuel || 0), est.fuel - Math.floor(v.fuel))) : 0;
    for (const k of ["food", "water", "fuel"]) form.travel[k] = Math.max(0, form.travel[k]);
  },
  "cp-launch": (state, ui) => {
    const res = launchCaravan(state, ui.caravanPlan);
    if (res.error) { ui.cvMsg = res.error; return; }
    ui.caravanPlan = null;
    ui.cvMsg = "";
  },
};
export const TRADE_CHANGE_ACTIONS = {
  "tw-set": (state, ui, el) => { setQty(state, el.dataset.side, el.dataset.k, el.value); ui.tradeMsg = ""; },
  "tw-fee": (state, ui, el) => { setFeeOffer(state, el.value); ui.tradeMsg = ""; },
  "tw-radiobase": (state, ui, el) => { setRadioBase(state, el.value); ui.radioBase = Number(el.value); ui.tradeMsg = ""; },
  "rd-tradebase": (state, ui, el) => { ui.radioBase = Number(el.value); },
  "cp-from": (state, ui, el) => { const form = ui.caravanPlan; form.fromBaseId = Number(el.value); form.crew = []; form.gear = []; form.vehicleId = null; },
  "rd-dealf": (state, ui, el) => {
    const d = (ui.radioDeal = ui.radioDeal || { wantKey: "meds", wantQty: 10, payKey: "ammo", payQty: 40 });
    const f = el.dataset.f;
    d[f] = /Key$/.test(f) ? el.value : Math.max(0, Math.floor(Number(el.value) || 0));
  },
  "cp-good": (state, ui, el) => { ui.caravanPlan.goods[el.dataset.k] = Math.max(0, Math.floor(Number(el.value) || 0)); },
  "cp-travel": (state, ui, el) => { ui.caravanPlan.travel[el.dataset.k] = Math.max(0, Math.floor(Number(el.value) || 0)); },
  "cp-addstop": (state, ui, el) => { if (el.value !== "") ui.caravanPlan.stops.push(Number(el.value)); },
};
