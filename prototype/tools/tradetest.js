// Radio and trade: item values, the one price model (no buy-back profit, fairness, carry limits, goodwill caps),
// what things are worth to whom (valuation.js: kinds of group, their state, refusals, arbitrage that pays then
// shrinks, valuables, the autopilot's sales, no base value on screen),
// radio relays and coverage chains, radio contact rules, a radio deal brought by a caravan, attacking a caravan
// (hostility and raids), a trade caravan of yours through three stops with every arrival option, intel that lifts
// the fog only where paid, determinism, a render check of the trade window and its handlers, and 200-day runs
// (simple auto-play and the autopilot) without NaN.
// Usage: node tools/tradetest.js [seed] [days]
import { typedFood, bestFoodKey, FOODS } from "../src/sim/foods.js";
const FK = "f_cannedmeat"; // the food traded in these tests (sim/foods.js)
const noFood = (s) => Object.fromEntries(Object.entries(s).filter(([k]) => !FOODS[k] && k !== "food" && k !== "preserved"));
import { payFood } from "../src/sim/foods.js";
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { totalRounds } from "../src/sim/ammo.js"; // rounds by calibre
// Your side trades rounds by calibre (ammo.js): a box of 9mm stands in for the old generic "ammo" as a currency.
const AMMO = "a_9mm_fmj";
const biggestKey = (rec) => Object.keys(rec).filter((k) => /^a_/.test(k)).sort((a, b) => (rec[b] || 0) - (rec[a] || 0))[0];
import { readFileSync } from "node:fs";
import { createWorld, tickHour, hub, atBase, makeSurvivor, radioBasesInRange, day, newId, RADIO_RANGE } from "../src/sim/world.js";
import { GEAR, SUPPLY_KEYS, CATEGORIES, TRADE_PREFS, FACTION_TYPES } from "../src/sim/data.js";
import { itemLoad } from "../src/sim/inventory.js";
import { itemCat, groupSick, worthTier } from "../src/sim/valuation.js";
import { itemTip } from "../src/ui/inventory.js";
import { addBuilding } from "../src/sim/buildings.js";
import { launchExpedition, planPath, partyTile, giveOrder } from "../src/sim/parties.js";
import { attitude } from "../src/sim/factions.js";
import { newItem } from "../src/sim/inventory.js";
import { makeItem, itemDurMax } from "../src/sim/crafting.js";
import {
  itemValue, sellPrice, buyPrice, spread, need, tradeContext, tradeVerdict, tradeTotals, executeTrade, endTrade, setQty, balanceWith,
  setIntel, toggleGear, openTrade, INTEL, gearSellPrice, gearBuyPrice, gearInfo, supplyInfo, priceWhy, marketLists, autoGearOffer,
} from "../src/sim/trade.js";
import {
  radioNodes, inCoverage, canRadioGroup, radioScan, radioDeal, dealQuote, radioNews, radioRequestCaravan, radioDaily, RELAY_RANGE, GROUP_REACH,
} from "../src/sim/radio.js";
import { radioBoost } from "../src/sim/power.js";
import { attackCaravan, launchCaravan, caravansAt } from "../src/sim/caravans.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { tradeWindow, radioModal, caravanPlanModal, groupsRadioHeader, caravanLines, newCaravanForm, TRADE_ACTIONS, TRADE_CHANGE_ACTIONS } from "../src/ui/tradewindow.js";
import { DIPLO_ACTIONS, DIPLO_CHANGE } from "../src/ui/diplomacy.js";
import { LISTEN_ACTIONS } from "../src/ui/radiolisten.js"; // main.js registers these in a loop (xp-listen, bl-listen)
import { INTEL_ACTIONS, INTEL_CHANGE } from "../src/ui/intel.js"; // and these (radio security: discipline, decoys)
import { VOL_ACTIONS, VOL_CHANGE } from "../src/ui/volunteers.js"; // and these (the radio panel's Ask for volunteers: vol-open)
import { groupRounds } from "../src/sim/arsenal.js";

const seed = Number(process.argv[2] || 42);
const longDays = Number(process.argv[3] || 200);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const world = (s = seed, n = 8) => createWorld({ seed: s, factionCount: n });
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const choice = (card, re) => card.choices.find((c) => re.test(c.label));
const off = (state, c) => (typeof c.disabled === "function" ? c.disabled(state) : !!c.disabled);

function fighter(state) {
  const s = makeSurvivor(state);
  s.skills.shooting = 10;
  s.skills.speech = 6;
  s.traits = [];
  s.health = 100;
  s.gear.weapon = newItem("huntrifle");
  s.location = { kind: "base", baseId: hub(state).id };
  state.survivors.push(s);
  return s;
}
function outpost(state, tile, name) {
  const b = { id: newId(), tile, type: "outpost", name, stock: { food: 10, water: 10, fuel: 0, meds: 0, ammo: 0, parts: 0, scrap: 0 }, radio: false, watchtower: false, buildings: [], construction: [], armory: [] };
  state.bases.push(b);
  return b;
}
const land = (state, t) => state.tiles[t].terrain !== "water" && state.tiles[t].terrain !== "mountain";
// A friendly trading group whose main base is reachable over land from the hub.
function friend(state, skip = []) {
  const h = hub(state);
  const f = state.factions.filter((x) => x.alive && !skip.includes(x) && x.bases.length && planPath(state, x.bases[0], h.tile, false))
    .sort((a, b) => state.grid.distance(a.bases[0], h.tile) - state.grid.distance(b.bases[0], h.tile))[0];
  f.type = "traders";
  f.goodwill = 45;
  f.known = true;
  f.pop = Math.max(f.pop, 24);
  Object.assign(f.stock, { ammo: 600, meds: 60, fuel: 60, parts: 10, scrap: 120, water: 150 }); setFood(f, 300);
  return f;
}
// Ticks hours, answering cards that are not the one we wait for; stops when pred() is true.
function drive(state, pred, maxHours, keep = null) {
  for (let i = 0; i < maxHours; i++) {
    if (pred()) return true;
    tickHour(state);
    for (const p of state.parties) if (p.owner === "player") p.lastConflict = state.hour; // no road conflicts in these runs
    for (let g = 0; g < 20 && state.cards.length; g++) {
      const c = state.cards.find((x) => !(keep && keep(x)));
      if (!c) break;
      state.cards.splice(state.cards.indexOf(c), 1);
      const opts = c.choices.filter((x) => !off(state, x) && !x.uiAction);
      const ch = opts.find((x) => /^Resume queued|^Trade caravan/.test(x.label)) || opts.find((x) => !/Return home|Fight|Attack|Agree/.test(x.label)) || opts[0];
      if (ch) ch.resolve(state);
    }
    if (state.trade && !(keep && keep("trade"))) { executeTrade(state); endTrade(state); }
  }
  return pred();
}

// 1. Item values: base value × condition × uses left.
{
  console.log("Item values");
  const pistol = newItem("pistol", 1);
  check(near(itemValue(pistol), GEAR.pistol.value), `a pistol in full condition is worth its base value (${itemValue(pistol)})`);
  const worn = newItem("pistol", 0.5);
  check(near(itemValue(worn), GEAR.pistol.value * 0.6), `at 50% condition it is worth 60% (${itemValue(worn).toFixed(1)})`);
  check(itemValue(newItem("pistol", 0.3)) < itemValue(worn) && itemValue(worn) < itemValue(pistol), "lower condition, lower value");
  const bat = makeItem("spikedbat", 1);
  const used = makeItem("spikedbat", 1);
  used.dur = itemDurMax(used) / 2; // a crafted item's own full uses (crafting.js craftedDur)
  check(near(itemValue(bat), GEAR.spikedbat.value) && near(itemValue(used), GEAR.spikedbat.value * 0.65), `a makeshift bat with half its uses left is worth 65% (${itemValue(used).toFixed(2)} of ${itemValue(bat)})`);
  const bag = makeItem("backpack", 1);
  bag.contents[0] = newItem("pistol", 1);
  check(near(itemValue(bag), GEAR.backpack.value + GEAR.pistol.value), "a pack counts what is inside it");
  check(itemValue(newItem("ar", 1)) > itemValue(newItem("knife", 1)), "an assault rifle is worth more than a kitchen knife");
}

// 2. Prices: spread, speech, goodwill, scarcity, water, and no profit from selling and buying back.
{
  console.log("Price model");
  const st = world();
  const f = friend(st);
  let worst = Infinity, cases = 0;
  for (const k of SUPPLY_KEYS) for (const q of [1, 5, 20, 80]) for (const sp of [0, 10, 20]) for (const gw of [-30, 0, 80]) {
    f.goodwill = gw;
    const before = f.stock[k];
    const got = q * sellPrice(st, f, k, sp, q);
    f.stock[k] = (before || 0) + q; // a key they hold none of (water, building materials): undefined + q was NaN
    const cost = q * buyPrice(st, f, k, sp, q);
    f.stock[k] = before;
    worst = Math.min(worst, cost - got);
    cases++;
  }
  check(worst > 0, `selling and buying the same back always loses (${cases} cases, smallest loss ${worst.toFixed(2)})`);
  f.goodwill = 0;
  check(spread(f, 20).sell > spread(f, 0).sell && spread(f, 20).buy < spread(f, 0).buy, "Speech narrows the spread");
  f.goodwill = 80;
  const friendly = spread(f, 10);
  f.goodwill = -30;
  const cold = spread(f, 10);
  check(friendly.sell > cold.sell && friendly.buy < cold.buy, "goodwill narrows the spread");
  check(friendly.buy > friendly.sell, "they always charge more than they pay");
  f.goodwill = 45;
  const rich = food(f);
  const pRich = sellPrice(st, f, "food", 0);
  setFood(f, 0);
  check(sellPrice(st, f, "food", 0) > pRich, "they pay more for what they are short of");
  setFood(f, rich);
  f.stock.meds = 10;
  check(sellPrice(st, f, "meds", 0, 40) < sellPrice(st, f, "meds", 0, 1), "a big sale pays less per unit");
  const g = st.factions.find((x) => x !== f);
  delete g.stock.water;
  const n0 = need(g, "water");
  radioDaily(st);
  check(n0 < 2.2 && need(g, "water") <= 1 && Number.isFinite(g.stock.water), `groups have water now: they no longer pay the top price for it (need ${n0.toFixed(2)} → ${need(g, "water").toFixed(2)})`);
}

// A team at a group's gates with what it carries (supplies in its cargo).
function visit(st, f, n = 2, cargo = {}) {
  const h = hub(st);
  const crew = [];
  for (let i = 0; i < n; i++) crew.push(fighter(st));
  addDays(h, 20); h.stock.water += 20;
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: f.bases[0], mission: "move", stance: "normal", supplies: { food: 4, water: 4 } });
  if (res.error) throw new Error(res.error);
  const p = res.party;
  p.path = [f.bases[0]]; p.idx = 0; p.dest = f.bases[0];
  p.cargo.supplies = { ...cargo };
  giveOrder(st, p, "trade");
  return p;
}

// 3. Fairness, buy-back with real deals, carry limits and the goodwill cap.
{
  console.log("Deals");
  const st = world();
  const f = friend(st);
  const p = visit(st, f, 2, { [FK]: 40 }); // food by type (sim/foods.js): 40 cans of meat
  check(!!st.trade && tradeContext(st)?.kind === "visit", "a trade visit opens the trade window");
  setQty(st, "theirs", "meds", 20);
  setQty(st, "mine", FK, 1);
  const v = tradeVerdict(st);
  const meds0 = f.stock.meds;
  check(!v.ok && /Not enough|cannot carry/.test(v.reason) && executeTrade(st) === v.reason && f.stock.meds === meds0, `an unfair deal is refused and nothing moves ("${v.reason}")`);
  // Sell 40 cans for ammo, then buy them back with all that ammo: fewer than before.
  st.trade.ask = {}; st.trade.offer = {};
  setQty(st, "mine", FK, 40);
  balanceWith(st, AMMO);
  const t1 = tradeTotals(st);
  check(tradeVerdict(st).ok && t1.ask <= t1.offer && st.trade.ask[AMMO] > 0, `balance with ammo: ${st.trade.ask[AMMO]} ${AMMO} for 40 cans of meat`);
  executeTrade(st);
  const ammo = p.cargo.supplies[AMMO];
  setQty(st, "mine", AMMO, ammo);
  if (!(f.stock[FK] > 0)) f.stock[FK] = 40; // they have it on the shelf (they took ours)
  balanceWith(st, FK);
  const back = st.trade.ask[FK] || 0;
  executeTrade(st);
  check(back < 40 && (p.cargo.supplies[FK] || 0) === back, `buying the cans back with that ammo gets only ${back} of 40`);
  // Gear: buy an item from their wares.
  const item = (f.wares || [])[0];
  if (check(!!item, "the group has gear for sale")) {
    st.trade.offer = {}; st.trade.ask = {};
    p.cargo.supplies = { [AMMO]: 300 };
    toggleGear(st, "theirs", 0);
    balanceWith(st, AMMO);
    const vg = tradeVerdict(st);
    const ok = vg.ok;
    executeTrade(st);
    check(ok && p.cargo.gear.includes(item) && !f.wares.includes(item), `bought ${item.name} item by item (${vg.reason})`);
  }
  // Carry: a team of one on foot cannot take 60 food.
  st.trade.offer = {}; st.trade.ask = {}; st.trade.askGear = []; st.trade.offerGear = [];
  p.members = p.members.slice(0, 1);
  p.cargo.supplies = { [AMMO]: 400 };
  setQty(st, "mine", AMMO, 400);
  f.stock[FK] = Math.max(f.stock[FK] || 0, 150);
  setQty(st, "theirs", FK, 150); // 60 kg of cans
  const vc = tradeVerdict(st);
  check(!vc.ok && /cannot carry/.test(vc.reason), `the team's carry space limits what it takes ("${vc.reason}")`);
  // Goodwill: twenty generous little trades in one day give at most 4.
  st.trade.offer = {}; st.trade.ask = {};
  st.hour += 24; // a new day
  const gw0 = f.goodwill;
  let gwr = "";
  for (let i = 0; i < 20; i++) { setQty(st, "mine", AMMO, 15); gwr = executeTrade(st); }
  check(f.goodwill - gw0 <= 4 + 1e-9 && f.goodwill > gw0, `goodwill from trading is capped at 4 a day (+${(f.goodwill - gw0).toFixed(2)} from 20 trades; ${gwr})`);
  endTrade(st);
  check(!st.trade && p.phase === "waiting", "leaving the window: the team waits for orders");
}

// 3b. Hidden values, kinds of group, their state, refusals, arbitrage (valuation.js).
{
  console.log("What things are worth to whom");
  const st = world(seed + 11);
  st.hordes = [];
  st.hour = 5 * 24; // spring
  const base = st.factions[0];
  base.pop = 20;
  // A group of each kind in the same shape: comfortable stock, no war, nothing on the shelf.
  const comfy = { ...typedFood(null, "stores", 120), f_jarred: 40, water: 100, fuel: 40, meds: 20, ammo: 200, parts: 10, scrap: 60, jars: 20, wood: 80, arrows: 40, brass: 0, powder: 0, primers: 0, blackpowder: 0, matchprimers: 0 }; // the reloading bench's inputs: a group keeps them (factions.js), none here
  const group = (type, extra = {}) => ({ ...base, type, stock: { ...comfy }, wares: [], atWar: 0, goodwill: 30, hitDay: undefined, hordeHitDay: undefined, lostBaseDay: undefined, ...extra });
  const mil = group("military"), com = group("commune"), rai = group("raider"), zea = group("zealot"), tra = group("traders"), fort = group("fortress");
  const ar = newItem("ar", 1), gold = newItem("goldring", 1), whiskey = newItem("whiskey", 1), coffee = newItem("coffee", 1), batt = newItem("batteries", 1);
  const pay = (f, it, sp = 0) => gearSellPrice(st, f, it, sp);
  // Kinds.
  check(pay(mil, ar) > pay(tra, ar) && pay(tra, ar) > pay(com, ar) && near(pay(mil, ar) / pay(com, ar), 1.5 / 0.5), `the same assault rifle: military ${pay(mil, ar).toFixed(1)}, traders ${pay(tra, ar).toFixed(1)}, commune ${pay(com, ar).toFixed(1)}`);
  check(pay(rai, whiskey) > pay(com, whiskey) && pay(rai, gold) > pay(com, gold) && pay(com, coffee) / pay(com, gold) > pay(rai, coffee) / pay(rai, gold) && pay(mil, batt) > pay(rai, batt), "raiders pay for liquor and gold, the commune for coffee over gold, the military for batteries");
  check(pay(fort, newItem("scrapvest", 1)) > pay(com, newItem("scrapvest", 1)) && sellPrice(st, fort, "scrap", 0, 10) > sellPrice(st, mil, "scrap", 0, 10), "a fortress wants armor and scrap");
  check(gearBuyPrice(st, tra, ar, 0) / pay(tra, ar) > gearBuyPrice(st, mil, ar, 0) / pay(mil, ar) + 0.1, "traders sell dear (a margin on what they charge)");
  check(gearInfo(st, zea, whiskey).refused && gearInfo(st, zea, newItem("cigarettes")).refused && pay(zea, whiskey) === 0 && pay(zea, gold) < pay(rai, gold) * 0.5, "zealots refuse liquor and cigarettes, and think little of gold (vanity)");
  GEAR._testgun = { name: "Test rifle", slot: "weapon", skill: "shooting", power: 5, req: 3, value: 50, noise: 3 };
  check(itemCat("_testgun") === "rifle" && CATEGORIES[itemCat("goldring")].group === "valuables", "an untagged new item gets a sensible category; valuables are their own family");
  delete GEAR._testgun;
  check(GEAR.goldring.valuable && itemLoad(gold) < itemLoad(newItem("pistol")) / 10 && itemLoad(coffee) < itemLoad(newItem("pistol")), "valuables are light for their worth");
  // State.
  const ratio = (f, it, set) => { const a = pay(f, it); set(); return pay(f, it) / a; };
  const w = group("commune");
  check(near(ratio(w, ar, () => { w.atWar = 1; }), 1.3) && near(pay(w, gold) / pay(group("commune"), gold), 0.85), "at war: weapons 30% dearer, trinkets 15% cheaper");
  const h1 = group("commune");
  const ammoCalm = sellPrice(st, h1, "ammo", 0, 10);
  const hr = ratio(h1, ar, () => st.hordes.push({ id: 999999, tile: h1.bases[0], size: 60 }));
  check(near(hr, 1.2) && near(sellPrice(st, h1, "ammo", 0, 10) / ammoCalm, 1.25) && priceWhy(st, h1, ar, { max: 3 }).some((x) => x.text.startsWith("Hordes")), `a horde of 60 at their walls: weapons ×${hr.toFixed(2)}, ammo ×1.25 ("${priceWhy(st, h1, ar, { max: 3 }).map((x) => x.text).join("; ")}")`);
  st.hordes = [];
  const h2 = group("commune", { hordeHitDay: day(st), hitDay: day(st) }); // factions.js sets both
  check(near(pay(h2, ar) / pay(group("commune"), ar), 1.2 * 1.15), "a horde attack in the last two weeks counts the same (and as a raid)");
  const r1 = group("commune", { hitDay: day(st) }), r2 = group("commune", { lostBaseDay: day(st) });
  check(near(pay(r1, ar) / pay(com, ar), 1.15) && near(pay(r2, ar) / pay(com, ar), 1.25) && near(pay(r2, gold) / pay(com, gold), 0.75), "raided lately: weapons ×1.15; a base lost: ×1.25, and they sell off gold");
  const s1 = group("raider");
  const food0 = sellPrice(st, s1, "food", 0, 10), gold0 = pay(s1, gold);
  setFood(s1, 0); setJarred(s1, 0);
  const sf = sellPrice(st, s1, "food", 0, 10) / food0;
  check(sf > 2.6 && pay(s1, gold) / gold0 <= 0.6 + 1e-9 && priceWhy(st, s1, gold).some((x) => /Starving/.test(x.text)) && priceWhy(st, s1, "food").some((x) => /Starving/.test(x.text)), `starving: food ×${sf.toFixed(2)} (shortage alone would be at most ×2.2), gold ×${(pay(s1, gold) / gold0).toFixed(2)} ("they cannot eat it")`);
  const t1 = group("raider");
  t1.stock.water = 0;
  check(sellPrice(st, t1, "water", 0, 10) / sellPrice(st, rai, "water", 0, 10) > 2.6, "thirsty: water skyrockets");
  const fuelSpring = sellPrice(st, com, "fuel", 0, 10);
  st.hour = 80 * 24; // winter
  const fuelWinter = sellPrice(st, com, "fuel", 0, 10);
  check(near(fuelWinter / fuelSpring, 1.4) && priceWhy(st, com, "fuel").some((x) => /^Winter/.test(x.text)), `winter: fuel ×${(fuelWinter / fuelSpring).toFixed(2)} ("${priceWhy(st, com, "fuel")[0].text}")`);
  st.hour = 64 * 24; // late autumn
  check(near(sellPrice(st, com, "fuel", 0, 10) / fuelSpring, 1.25) && /Winter is coming/.test(priceWhy(st, com, "fuel")[0].text), "late autumn: winter is coming, fuel ×1.25");
  st.hour = 5 * 24;
  // Sickness: some spell in the year makes them pay 50% more for meds.
  const sk = group("commune");
  let sickDay = null, wellDay = null;
  for (let d = 0; d < 400 && (sickDay == null || wellDay == null); d++) { st.hour = d * 24; if (groupSick(st, sk)) sickDay = sickDay ?? d; else wellDay = wellDay ?? d; }
  if (check(sickDay != null && wellDay != null, `sickness comes and goes (sick on day ${sickDay + 1})`)) {
    st.hour = sickDay * 24; const ms = sellPrice(st, sk, "meds", 0, 5); const why = priceWhy(st, sk, "meds")[0];
    st.hour = wellDay * 24; const mw = sellPrice(st, sk, "meds", 0, 5);
    check(near(ms / mw, 1.5) && /Sickness/.test(why.text), `sickness in their camp: meds ×${(ms / mw).toFixed(2)} ("${why.text}")`);
  }
  st.hour = 5 * 24;
  const all = group("commune", { atWar: 1, hitDay: day(st), lostBaseDay: day(st), hordeHitDay: day(st) });
  check(gearInfo(st, all, ar).state <= 2.6 + 1e-9, `everything at once is held to ×2.6 (${gearInfo(st, all, ar).state.toFixed(2)})`);
  // Wealth: rich groups pay more for fine things.
  const rich = group("commune", { stock: Object.fromEntries(Object.entries(comfy).map(([k, v]) => [k, v * 3])) });
  check(near(pay(rich, gold) / pay(com, gold), 1.2) && near(pay(rich, ar) / pay(com, ar), 1), "rich and at peace: fine things ×1.2 (weapons as before)");
  // Selling and buying back loses, for every kind, in every state, for every good and item.
  let worst = Infinity, cases = 0;
  const states = [{}, { atWar: 1 }, { hitDay: day(st), lostBaseDay: day(st) }, { stock: { ...noFood(comfy), water: 0 } }];
  for (const type of [...Object.keys(TRADE_PREFS).filter((k) => FACTION_TYPES[k])]) for (const s of states) for (const hour of [5 * 24, 80 * 24]) {
    st.hour = hour;
    const f = group(type, s);
    for (const k of SUPPLY_KEYS) for (const q of [1, 10, 60]) for (const sp of [0, 20]) for (const gw of [-100, 100]) {
      if (supplyInfo(st, f, k).refused) continue;
      f.goodwill = gw;
      const before = f.stock[k];
      const got = q * sellPrice(st, f, k, sp, q);
      f.stock[k] = (before || 0) + q; // a key they hold none of (water, building materials): undefined + q was NaN
      const cost = q * buyPrice(st, f, k, sp, q);
      f.stock[k] = before;
      worst = Math.min(worst, cost - got); cases++;
    }
    for (const key of Object.keys(GEAR)) for (const sp of [0, 20]) {
      const it = newItem(key, 0.8);
      if (gearInfo(st, f, it).refused) continue;
      f.goodwill = 100;
      const got = gearSellPrice(st, f, it, sp);
      f.wares.push(it);
      const cost = gearBuyPrice(st, f, it, sp);
      f.wares.pop();
      worst = Math.min(worst, cost - got); cases++;
    }
  }
  st.hour = 5 * 24;
  check(worst > 0, `every kind, at war, raided, starving, in winter: selling and buying back still loses (${cases} cases, smallest loss ${worst.toFixed(3)})`);
  // Arbitrage: buy rifles where they are plentiful, sell where they are wanted. It pays, then the buyer fills up.
  const seller = group("commune", { wares: Array.from({ length: 10 }, () => newItem("ar", 1)) });
  const buyer = group("military", { atWar: 1 });
  const margins = [];
  for (let i = 0; i < 10; i++) {
    const it = seller.wares[0];
    const cost = gearBuyPrice(st, seller, it, 10);
    const got = gearSellPrice(st, buyer, it, 10);
    seller.wares.shift(); buyer.wares.push(it);
    margins.push(got - cost);
  }
  const firstLoss = margins.findIndex((m) => m <= 0);
  check(margins[0] > 0 && margins.every((m, i) => !i || m <= margins[i - 1] + 1e-9) && firstLoss > 0, `rifles from a commune to the military at war: +${margins[0].toFixed(1)} on the first, shrinking, a loss from rifle ${firstLoss + 1}`);
  const farm = group("commune", { stock: { ...noFood(comfy), ...typedFood(null, "commune", 600) } });
  const hungry = group("raider", { stock: noFood(comfy) });
  const lots = [];
  for (let i = 0; i < 30; i++) {
    const cost = 20 * buyPrice(st, farm, "food", 10, 20), got = 20 * sellPrice(st, hungry, "food", 10, 20);
    payFood(farm, 20); addDays(hungry, 20);
    lots.push(got - cost);
  }
  const lossAt = lots.findIndex((m) => m <= 0);
  check(lots[0] > 0 && lossAt > 0 && lots.every((m, i) => !i || m <= lots[i - 1] + 1e-9), `food from a farm to starving raiders: +${lots[0].toFixed(1)} on the first 20, shrinking, a loss from lot ${lossAt + 1} (${lots.slice(0, lossAt).reduce((a, b) => a + b, 0).toFixed(0)} in all)`);
  // Market lists use the same demand: a sick commune asks for meds, a group at war for ammo.
  const warm = group("expansionist", { atWar: 1 });
  check(marketLists(st, warm).wants.some((x) => x.key === "ammo") && !marketLists(st, group("expansionist")).wants.some((x) => x.key === "ammo"), "a group at war puts ammo on its wants list (the same stock at peace does not)");
  // The autopilot's sales: valuables, and spare weapons to a group that prizes them.
  const h = hub(st);
  const armory = [gold, newItem("pistol", 1), newItem("ar", 1), newItem("ar", 0.9), newItem("huntrifle", 1), newItem("vest", 1)];
  const offer = autoGearOffer(st, { base: h, myGear: armory, f: buyer });
  const weapons = offer.filter((g) => GEAR[g.key].slot === "weapon").length;
  check(!offer.includes(gold) && autoGearOffer(st, { base: h, myGear: armory, f: rai }).includes(gold) && weapons >= 1 && armory.filter((g) => GEAR[g.key].slot === "weapon").length - weapons >= 2, `the autopilot offers ${weapons} spare weapon(s) to the military at war, keeping spares (the gold ring goes to raiders)`);
  check(!autoGearOffer(st, { base: h, myGear: armory, f: com }).some((g) => GEAR[g.key].slot === "weapon"), "and keeps its weapons when the buyer does not prize them");
}

// 3c. Refusals and the window: zealots will not touch liquor; no base value anywhere on screen.
{
  console.log("Refusals and hidden values on screen");
  const st = world(seed + 12);
  const f = friend(st);
  f.type = "zealot";
  const p = visit(st, f, 2, { food: 30, [AMMO]: 100 });
  const bottle = newItem("whiskey", 1);
  p.cargo.gear.push(newItem("ar", 0.9), bottle, newItem("goldring", 1));
  toggleGear(st, "mine", p.cargo.gear.indexOf(bottle));
  check(!st.trade.offerGear.includes(bottle), "zealots: the whiskey cannot be put on the table");
  st.trade.offerGear = [bottle];
  const v = tradeVerdict(st);
  check(!v.ok && /will not touch liquor/.test(v.reason), `and a deal with it is refused ("${v.reason}")`);
  st.trade.offerGear = [];
  toggleGear(st, "mine", 0);
  const html = tradeWindow(st, { tradeMsg: "", attackConfirm: null });
  const raw = /base value|\bvalue \d|Value \d|Barter value/.exec(html);
  check(!raw, `the trade window shows no base value${raw ? ` (${html.slice(raw.index - 60, raw.index + 40)})` : ""}`);
  check(/tw-why/.test(html) && /Won't touch/.test(html) && /will not touch/.test(html) && /Zealots/.test(html), "it shows why lines, the refusal and what their kind prizes and shuns");
  check(Object.keys(GEAR).every((k) => !new RegExp(`\\bvalue ${GEAR[k].value}\\b`, "i").test(itemTip(newItem(k, 1)))) && /worth: (junk|cheap|decent|valuable|rare)/.test(itemTip(newItem("ar", 1))), "item tooltips give a worth tier, never the number");
  check(worthTier(newItem("ar", 1)) === "rare" && worthTier(newItem("pipespear", 1)) === "junk" && worthTier(newItem("goldring", 1)) === "decent", "worth tiers: an assault rifle is rare, a pipe spear junk, a gold ring decent");
  endTrade(st);
}

// 4. Relays: coverage chains back to a station; upkeep.
{
  console.log("Radio relays");
  const st = world();
  const h = hub(st);
  const g = st.grid;
  check(radioNodes(st).length === 0 && !inCoverage(st, h.tile), "no radio, no coverage");
  const aTile = st.tiles.find((t) => land(st, t.id) && g.distance(t.id, h.tile) === 7).id;
  // B beyond the station's own reach (RADIO_RANGE 12, unpowered here), so it can only link through A.
  const bTile = st.tiles.find((t) => land(st, t.id) && g.distance(t.id, aTile) <= RELAY_RANGE && g.distance(t.id, h.tile) > RADIO_RANGE).id;
  const cTile = st.tiles.find((t) => land(st, t.id) && g.distance(t.id, h.tile) >= 30 && g.distance(t.id, bTile) >= 20).id;
  const A = outpost(st, aTile, "Relay A"), B = outpost(st, bTile, "Relay B"), C = outpost(st, cTile, "Relay C");
  for (const b of [A, B, C]) addBuilding(b, "relay");
  check(radioNodes(st).every((n) => !n.linked), "relays with no station are not linked");
  addBuilding(h, "radio");
  const nodes = radioNodes(st);
  const L = (b) => nodes.find((n) => n.base === b).linked;
  check(L(A) && L(B) && !L(C), `A (7 from the hub) links to the station, B (${g.distance(bTile, h.tile)} from the hub, ${g.distance(bTile, aTile)} from A) links through A, C far away does not`);
  const beyond = st.tiles.find((t) => g.distance(t.id, bTile) === RELAY_RANGE && g.distance(t.id, h.tile) > RADIO_RANGE &&g.distance(t.id, aTile) > RELAY_RANGE);
  if (beyond) check(inCoverage(st, beyond.id) && radioBasesInRange(st, beyond.id).includes(B), "coverage reaches the edge of the chain (teams there report live)");
  check(!inCoverage(st, cTile), "C's land is not covered");
  // Upkeep: no parts anywhere, A goes off the air on its due day and B (linked through A) drops with it.
  h.stock.parts = 0; A.stock.parts = 0; B.stock.parts = 0; C.stock.parts = 0;
  for (let d = 0; d < 11; d++) { st.hour += 24; radioDaily(st); }
  const n2 = radioNodes(st);
  check(A.relayOffline && !n2.find((n) => n.base === B).linked, "a relay without parts goes off the air, and the relays behind it lose their link");
  h.stock.parts = 5;
  st.hour += 24; radioDaily(st);
  check(!A.relayOffline && radioNodes(st).find((n) => n.base === B).linked && h.stock.parts < 5, "a part at the hub puts it back on the air");
}

// 5. Radio contact rules.
{
  console.log("Radio contact");
  const st = world();
  const h = hub(st);
  const g = st.grid;
  addBuilding(h, "radio");
  // A station reaches RADIO_RANGE (12) tiles, +2 on generator power (power.js radioBoost); a group's own set reaches
  // GROUP_REACH (6) beyond that, so a group whose base is within 18 (20 powered) of the hub can be called.
  const R = radioNodes(st).find((n) => n.base === h).range;
  check(R === RADIO_RANGE + radioBoost(h), `the hub's station reaches ${RADIO_RANGE}${radioBoost(h) ? " + 2 on power" : ""} tiles (${R})`);
  let right = 0, total = 0;
  for (const f of st.factions) {
    const expect = f.bases.some((b) => g.distance(b, h.tile) <= R + GROUP_REACH);
    total++;
    if (canRadioGroup(st, f) === expect) right++;
  }
  check(right === total, `a group can be called when a base of theirs is within coverage (${R}) + ${GROUP_REACH} (${right}/${total})`);
  const f = st.factions[0];
  f.bases = [g.within(h.tile, 9).find((t) => g.distance(t, h.tile) === 9)];
  f.known = false;
  const msg = radioScan(st);
  check(f.known && f.heard && /New voices/.test(msg), "scanning the airwaves finds a group in reach");
  check(/already scanned/.test(radioScan(st)), "once a day");
  f.goodwill = -60;
  check(/curse|silent/.test(radioNews(st, f)) && /curse|silent/.test(radioRequestCaravan(st, f)), "a hostile group will not talk business");
  f.goodwill = 40; f.type = "traders";
  Object.assign(f.stock, { meds: 50, ammo: 400 });
  const q = dealQuote(st, f, { wantKey: "meds", wantQty: 5, payKey: "ammo", payQty: 1 });
  check(!q.ok && q.minPay > 1, `a lowball deal is refused, with their price (${q.minPay} ammo for 5 meds)`);
  check(dealQuote(st, f, { wantKey: "meds", wantQty: 5, payKey: "ammo", payQty: q.minPay }).ok, "their price is accepted");
  check(!dealQuote(st, f, { wantKey: "meds", wantQty: 5, payKey: "ammo", payQty: q.minPay - 1 }).ok, "one less is not");
  const far = st.factions[1];
  far.bases = [st.tiles.find((t) => g.distance(t.id, h.tile) > R + GROUP_REACH + 5).id];
  check(!canRadioGroup(st, far), "a group out of reach cannot be called");
}

// 6. A radio deal: their caravan comes, the deal is done, it stays a day and goes home.
function dealWorld(s) {
  const st = world(s);
  const h = hub(st);
  addBuilding(h, "radio");
  const f = friend(st);
  f.bases = [f.bases[0]];
  for (const x of st.factions) if (x !== f) x.goodwill = Math.max(x.goodwill, -20); // keep raids out of these runs
  h.stock.ammo = 400;
  // Their base within radio reach and a walk from the hub.
  if (!canRadioGroup(st, f)) f.bases = [st.grid.within(h.tile, 10).find((t) => land(st, t) && st.grid.distance(t, h.tile) >= 6 && !st.bases.some((b) => b.tile === t) && planPath(st, t, h.tile, false))];
  return { st, h, f };
}
{
  console.log("Radio deal and caravan");
  const { st, h, f } = dealWorld(seed);
  if (!canRadioGroup(st, f)) f.bases = [st.grid.within(h.tile, 10).find((t) => land(st, t) && planPath(st, t, h.tile, false) && st.grid.distance(t, h.tile) >= 6)];
  const q = dealQuote(st, f, { wantKey: "meds", wantQty: 6, payKey: "ammo", payQty: 1 });
  const res = radioDeal(st, f, { wantKey: "meds", wantQty: 6, payKey: "ammo", payQty: q.minPay });
  if (check(res.ok, `the deal is agreed: ${res.text}`)) {
    const c = res.caravan;
    check(c.kind === "caravan" && c.owner === f.id && c.goods.supplies.meds === 6 && c.deal, "a caravan with the goods sets out");
    const arrived = drive(st, () => c.phase === "trading", 24 * 40, (x) => x === "trade");
    check(arrived && st.trade && st.trade.caravanId === c.id, `it arrives at ${hub(st).name} and the trade window opens (day ${day(st)})`);
    const v = tradeVerdict(st);
    const meds = h.stock.meds, ammo = totalRounds(h.stock);
    check(v.ok && v.honoured, "the agreed deal is filled in and honoured");
    executeTrade(st);
    check(h.stock.meds === meds + 6 && totalRounds(h.stock) === ammo - q.minPay && c.dealDone, `done: +6 meds, −${q.minPay} ammo`);
    endTrade(st);
    check(!st.trade && caravansAt(st, h.id).includes(c), "closing the window: the caravan stays");
    const stock0 = groupRounds(f); // arsenal.js: their stores' rounds and what their people carry (the day's kit-out moves rounds between them)
    drive(st, () => c.leaving, 30);
    check(c.leaving && c.phase === "out", "after a day it leaves");
    const home = drive(st, () => !st.parties.includes(c), 24 * 40);
    check(home && groupRounds(f) >= stock0 + q.minPay - 1, `home again, the payment goes into their stores (${stock0} → ${groupRounds(f)} rounds)`);
  }
}

// 7. Attacking a caravan: hostility, pact torn up, raids.
{
  console.log("Attacking a caravan");
  const { st, h, f } = dealWorld(seed + 1);
  f.pact = "trade";
  for (let i = 0; i < 4; i++) fighter(st);
  const fk = bestFoodKey(f.stock) || FK;
  if (!(f.stock[fk] > 20)) f.stock[fk] = 40;
  const res = radioDeal(st, f, { wantKey: fk, wantQty: 10, payKey: "ammo", payQty: 200 }); // food by type: an item they hold
  if (check(res.ok, "a caravan is on its way")) {
    const c = res.caravan;
    drive(st, () => c.phase === "trading", 24 * 40, (x) => x === "trade");
    const loot = food(c.goods) || 0;
    const food0 = food(h);
    attackCaravan(st, c);
    check(attitude(f) === "Hostile" && f.pact === null && f.grudgeUntil > day(st), "attacking makes the whole group hostile and tears up the pact");
    const won = !st.parties.includes(c);
    check(won ? food(h) >= food0 + loot : c.leaving, won ? `won: its ${loot} food is yours` : "lost: the caravan gets away");
    f.pop = 30;
    let raids = 0;
    const seen = new Set();
    for (let hr = 0; hr < 24 * 60 && !st.gameOver; hr++) {
      tickHour(st);
      st.cards.length = 0;
      if (st.trade) endTrade(st);
      for (const p of st.parties) if (p.owner === f.id && p.kind === "raid" && !seen.has(p.id)) { seen.add(p.id); raids++; }
    }
    check(raids >= 1, `a trading group you crossed sends raids (${raids} in 60 days)`);
  }
}

// 8. Your trade caravan through three stops, with every arrival option.
{
  console.log("Trade caravan with a destination queue");
  const st = world(seed + 2);
  const h = hub(st);
  const g1 = friend(st);
  const g2 = friend(st, [g1]);
  for (const x of st.factions) if (x !== g1 && x !== g2) x.goodwill = Math.max(x.goodwill, -20);
  const oTile = st.tiles.find((t) => land(st, t.id) && st.grid.distance(t.id, h.tile) === 4 && planPath(st, h.tile, t.id, false) && !st.factions.some((f) => f.bases.includes(t.id))).id;
  const o = outpost(st, oTile, "Test Outpost");
  const crew = [fighter(st), fighter(st), fighter(st)];
  Object.assign(h.stock, { water: 300, ammo: 400, fuel: 100 }); setFood(h, 300);
  const stops = [g1.bases[0], oTile, g2.bases[0]];
  const truck = st.vehicles.find((v) => v.loc.kind === "base" && v.loc.baseId === h.id);
  const byTruck = truck && stops.every((t, i) => planPath(st, i ? stops[i - 1] : h.tile, t, true)) && planPath(st, stops[2], h.tile, true);
  if (byTruck) truck.fuel = 30;
  const res = launchCaravan(st, { crew: crew.map((s) => s.id), vehicleId: byTruck ? truck.id : null, stance: "normal", goods: { ammo: 200 }, travel: byTruck ? { food: 40, water: 40, fuel: 40 } : { food: 15, water: 15 }, gear: [], stops });
  if (check(!res.error, `launched: ${res.error || "3 stops"}`)) {
    const p = res.party;
    const cardAt = (tile) => st.cards.find((c) => c.isCaravan && c.partyId === p.id && partyTile(p) === tile);
    const keep = (c) => c === "trade" ? true : !!c.isCaravan;
    const take = (c, re) => { const ch = choice(c, re); st.cards.splice(st.cards.indexOf(c), 1); return ch ? ch.resolve(st) : null; };
    check(drive(st, () => cardAt(g1.bases[0]), 24 * 30, keep), `stop 1: the caravan card at ${g1.name}`);
    let card = cardAt(g1.bases[0]);
    check(card && ["Trade with", "Stay here a day", "Go on to", "Return home"].every((l) => card.choices.some((c) => c.label.startsWith(l))), "it offers trade, stay a day, go on and return home");
    check(card && /\(about \d+h\)/.test(choice(card, /^Go on to/).label) && /\(about \d+h\)/.test(choice(card, /^Return home/).label), "with the ETA of each leg");
    take(card, /^Trade with/);
    check(st.trade && st.trade.partyId === p.id, "trade there: the trade window opens");
    setQty(st, "mine", biggestKey(p.cargo.supplies), 60); // ammo.js: the caravan's ammo goes by calibre
    balanceWith(st, "meds");
    const r = executeTrade(st);
    check(/^Traded/.test(r), `a trade at the first stop (${r})`);
    endTrade(st);
    card = cardAt(g1.bases[0]);
    check(!!card, "leaving the window brings the caravan card back");
    const h0 = st.hour;
    take(card, /^Stay here a day/);
    check(drive(st, () => cardAt(g1.bases[0]), 40, keep) && st.hour - h0 >= 24, `stay a day: the card comes back after ${st.hour - h0}h`);
    take(cardAt(g1.bases[0]), /^Go on to/);
    check(drive(st, () => cardAt(oTile), 24 * 30, keep), "go on: stop 2, the outpost");
    card = cardAt(oTile);
    const ammo0 = totalRounds(o.stock);
    take(card, /^Unload/);
    check(totalRounds(o.stock) > ammo0 && !Object.values(p.cargo.supplies).some((q) => q >= 1), `unload: the goods go into ${o.name}`);
    take(cardAt(oTile), /^Go on to/);
    check(drive(st, () => cardAt(g2.bases[0]), 24 * 30, keep), `go on: stop 3, ${g2.name}`);
    card = cardAt(g2.bases[0]);
    check(!choice(card, /^Go on to/), "no further destination at the last stop");
    take(card, /^Return home/);
    check(drive(st, () => !st.parties.includes(p), 24 * 30, keep), "return home: the caravan comes home");
    check(crew.every((s) => !s.alive || s.location.kind === "base"), "and its crew are back at the hub");
  }
}

// 9. Intel lifts the fog only on the tiles paid for.
{
  console.log("Intel");
  const { st, h, f } = dealWorld(seed + 3);
  const res = radioDeal(st, f, { wantKey: "meds", wantQty: 2, payKey: "ammo", payQty: 100 });
  if (res.ok) {
    const c = res.caravan;
    drive(st, () => c.phase === "trading", 24 * 40, (x) => x === "trade");
    if (check(st.trade && st.trade.caravanId === c.id, "a caravan to buy intel from")) {
      st.trade.offer = {}; st.trade.ask = {}; st.trade.deal = null;
      setIntel(st, "area", "near");
      balanceWith(st, biggestKey(h.stock));
      const ctx = tradeContext(st);
      const center = ctx.center;
      st.knowledge = st.knowledge.map(() => null);
      const ok = tradeVerdict(st).ok;
      executeTrade(st);
      const inside = st.grid.within(center, INTEL.near.r);
      const ring = st.grid.within(center, INTEL.near.r + 3).filter((t) => st.grid.distance(t, center) > INTEL.near.r);
      check(ok && inside.every((t) => st.knowledge[t] && st.knowledge[t].hour === st.hour), `the ${inside.length} tiles paid for are reported`);
      check(ring.every((t) => !st.knowledge[t]), `the ${ring.length} tiles just outside stay in the fog`);
      endTrade(st);
    }
  } else check(false, `no deal for the intel test: ${res.text}`);
}

// 10. Render check: the trade window, radio panel, caravan planner; every data-action has a handler.
{
  console.log("Trade window HTML");
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const known = new Set([...Object.keys(TRADE_ACTIONS), ...Object.keys(TRADE_CHANGE_ACTIONS), ...Object.keys(DIPLO_ACTIONS), ...Object.keys(DIPLO_CHANGE), ...Object.keys(LISTEN_ACTIONS), ...Object.keys(INTEL_ACTIONS), ...Object.keys(INTEL_CHANGE), ...Object.keys(VOL_ACTIONS), ...Object.keys(VOL_CHANGE)]); // main.js registers these tables
  const handled = (a) => known.has(a) || new RegExp(`(^|[\\s{,])"?${a.replace(/[-]/g, "\\-")}"?\\s*:`, "m").test(main);
  const scan = (html, where) => {
    const acts = [...html.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]);
    const missing = [...new Set(acts)].filter((a) => !handled(a));
    check(acts.length > 0 && !missing.length, `${where}: ${new Set(acts).size} actions, all handled${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`);
    const bad = /\b(undefined|NaN|Infinity)\b|\[object /.exec(html.replace(/data:image[^"]*/g, ""));
    check(!bad, `${where}: no undefined / NaN in the HTML${bad ? ` (${bad[0]} near ${html.slice(Math.max(0, bad.index - 80), bad.index + 40)})` : ""}`);
    const open = (html.match(/<(div|table|tr|td|button|span|label|select|h1|h3)\b/g) || []).length;
    const close = (html.match(/<\/(div|table|tr|td|button|span|label|select|h1|h3)>/g) || []).length;
    check(open === close, `${where}: tags balanced (${open} / ${close})`);
  };
  const { st, h, f } = dealWorld(seed + 4);
  const ui = { tradeMsg: "", attackConfirm: null, radioWith: f.id, radioDeal: { wantKey: "meds", wantQty: 5, payKey: "ammo", payQty: 30 }, caravanPlan: newCaravanForm() };
  const p = visit(st, f, 2, { food: 30, [AMMO]: 100 });
  p.cargo.gear.push(newItem("pistol", 0.7), makeItem("spikedbat", 1));
  setIntel(st, "area", "near");
  toggleGear(st, "mine", 1);
  scan(tradeWindow(st, ui), "trade window (visit)");
  endTrade(st);
  const res = radioDeal(st, f, { wantKey: "meds", wantQty: 3, payKey: "ammo", payQty: 80 });
  if (res.ok) {
    drive(st, () => res.caravan.phase === "trading", 24 * 40, (x) => x === "trade");
    h.armory.push(newItem("shotgun", 0.8));
    if (st.trade) {
      scan(tradeWindow(st, ui), "trade window (caravan)");
      ui.attackConfirm = res.caravan.id;
      scan(tradeWindow(st, ui), "trade window (attack confirm)");
    }
    scan(caravanLines(st, h), "Bases tab caravan line");
  }
  scan(radioModal(st, ui), "radio panel");
  scan(groupsRadioHeader(st), "Groups tab radio header");
  ui.caravanPlan.stops = [f.bases[0]];
  ui.caravanPlan.crew = [atBase(st, h.id)[0].id];
  scan(caravanPlanModal(st, ui), "caravan planner");
}

// 11. Determinism and long runs.
function autoplay(state, opts = {}) {
  const stats = { caravans: new Set(), trades: 0, offers: 0, nan: [] };
  const h = hub(state);
  addBuilding(h, "radio");
  for (let d = 0; d < opts.days && !state.gameOver; d++) {
    for (let hr = 0; hr < 24 && !state.gameOver; hr++) {
      tickHour(state);
      while (state.cards.length) {
        const c = state.cards.shift();
        if (c.radioFrom != null) stats.offers++;
        const ch = c.choices.find((x) => x.label === "Return home") || c.choices.find((x) => !off(state, x) && !x.uiAction);
        if (ch) ch.resolve(state);
      }
      if (state.trade) { if (/^Traded/.test(executeTrade(state))) stats.trades++; endTrade(state); }
      for (const p of state.parties) {
        if (p.owner === "player" && p.phase === "waiting") p.orders = [], p.phase = "waiting";
        if (p.kind === "caravan") stats.caravans.add(p.id);
      }
    }
    if (d % 10 === 5) for (const f of state.factions) if (f.known && canRadioGroup(state, f)) radioRequestCaravan(state, f);
    if (d === 3) for (const f of state.factions) if (canRadioGroup(state, f)) f.known = true;
    const bad = (o, where) => { for (const [k, v] of Object.entries(o || {})) if (typeof v === "number" && !Number.isFinite(v)) stats.nan.push(`${where}.${k}=${v} (day ${day(state)})`); };
    for (const b of state.bases) bad(b.stock, b.name);
    for (const f of state.factions) { bad(f.stock, f.name); bad({ goodwill: f.goodwill, pop: f.pop }, f.name); }
    for (const p of state.parties) if (p.goods) bad(p.goods.supplies, "caravan");
  }
  return stats;
}
const signature = (state) => JSON.stringify({
  hour: state.hour, rng: state.rng.state, stock: state.bases.map((b) => b.stock), log: state.log.length,
  f: state.factions.map((f) => [f.pop, Math.round(f.goodwill * 1000), f.stock]), parties: state.parties.map((p) => [p.kind, partyTile(p)]),
});
{
  console.log("Determinism");
  // b is made after a has played (as tools/sameseedtest.js does): ids come from one process-wide counter, and a world
  // made before the other one plays would hand out other world-local ids (world.js localId) than the same world made
  // after it, which the dice keyed by them (intel.js hearing) would read differently.
  const a = world(seed + 5);
  autoplay(a, { days: 60 });
  const b = world(seed + 5);
  autoplay(b, { days: 60 });
  check(signature(a) === signature(b), "the same seed plays out the same (60 days with radio, deals and caravans)");
}
{
  console.log(`Long runs (${longDays} days)`);
  const t0 = performance.now();
  const st = world(seed + 6);
  const s = autoplay(st, { days: longDays });
  check(!s.nan.length, `simple auto-play: no NaN in stocks, goodwill or caravans${s.nan.length ? ` (${s.nan.slice(0, 3).join("; ")})` : ""}`);
  console.log(`  auto-play: day ${day(st)}${st.gameOver ? " (fell)" : ""}, ${s.caravans.size} caravans, ${s.trades} trades, ${s.offers} radio offers, ${Math.round(performance.now() - t0)} ms`);
  const t1 = performance.now();
  const ap = world(seed + 7);
  setAutopilot(ap, true, "balanced");
  addBuilding(hub(ap), "radio");
  const nan = [];
  let caravans = new Set();
  for (let hr = 0; hr < longDays * 24 && !ap.gameOver; hr++) {
    tickHour(ap);
    for (const p of ap.parties) if (p.kind === "caravan") caravans.add(p.id);
    if (hr % 24 === 0) for (const o of [...ap.bases.map((b) => b.stock), ...ap.factions.map((f) => f.stock)]) for (const v of Object.values(o)) if (!Number.isFinite(v)) nan.push(v);
  }
  check(!nan.length, "autopilot: no NaN");
  const attacked = ap.log.filter((l) => /attacked the .* caravan/.test(l.text)).length;
  check(attacked === 0, "the Balanced autopilot never attacks a caravan");
  console.log(`  autopilot: day ${day(ap)}${ap.gameOver ? " (fell)" : ""}, ${caravans.size} caravans, ${ap.log.filter((l) => /Radio: radio deal/.test(l.text)).length} radio deals in the recent log, ${Math.round(performance.now() - t1)} ms`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
