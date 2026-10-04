// Radio and trade: item values, the one price model (no buy-back profit, fairness, carry limits, goodwill caps),
// radio relays and coverage chains, radio contact rules, a radio deal brought by a caravan, attacking a caravan
// (hostility and raids), a trade caravan of yours through three stops with every arrival option, intel that lifts
// the fog only where paid, determinism, a render check of the trade window and its handlers, and 200-day runs
// (simple auto-play and the autopilot) without NaN.
// Usage: node tools/tradetest.js [seed] [days]
import { readFileSync } from "node:fs";
import { createWorld, tickHour, hub, atBase, makeSurvivor, radioBasesInRange, day, newId } from "../src/sim/world.js";
import { GEAR, SUPPLY_KEYS } from "../src/sim/data.js";
import { addBuilding } from "../src/sim/buildings.js";
import { launchExpedition, planPath, partyTile, giveOrder } from "../src/sim/parties.js";
import { attitude } from "../src/sim/factions.js";
import { newItem } from "../src/sim/inventory.js";
import { makeItem } from "../src/sim/crafting.js";
import {
  itemValue, sellPrice, buyPrice, spread, need, tradeContext, tradeVerdict, tradeTotals, executeTrade, endTrade, setQty, balanceWith,
  setIntel, toggleGear, openTrade, INTEL,
} from "../src/sim/trade.js";
import {
  radioNodes, inCoverage, canRadioGroup, radioScan, radioDeal, dealQuote, radioNews, radioRequestCaravan, radioDaily, RELAY_RANGE, GROUP_REACH,
} from "../src/sim/radio.js";
import { attackCaravan, launchCaravan, caravansAt } from "../src/sim/caravans.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { tradeWindow, radioModal, caravanPlanModal, groupsRadioHeader, caravanLines, newCaravanForm, TRADE_ACTIONS, TRADE_CHANGE_ACTIONS } from "../src/ui/tradewindow.js";
import { DIPLO_ACTIONS, DIPLO_CHANGE } from "../src/ui/diplomacy.js";

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
  Object.assign(f.stock, { food: 300, ammo: 600, meds: 60, fuel: 60, parts: 10, scrap: 120, water: 150 });
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
  used.dur = GEAR.spikedbat.dur / 2;
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
    f.stock[k] = before + q;
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
  const rich = f.stock.food;
  const pRich = sellPrice(st, f, "food", 0);
  f.stock.food = 0;
  check(sellPrice(st, f, "food", 0) > pRich, "they pay more for what they are short of");
  f.stock.food = rich;
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
  h.stock.food += 20; h.stock.water += 20;
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
  const p = visit(st, f, 2, { food: 40 });
  check(!!st.trade && tradeContext(st)?.kind === "visit", "a trade visit opens the trade window");
  setQty(st, "theirs", "meds", 20);
  setQty(st, "mine", "food", 1);
  const v = tradeVerdict(st);
  const meds0 = f.stock.meds;
  check(!v.ok && /Not enough|cannot carry/.test(v.reason) && executeTrade(st) === v.reason && f.stock.meds === meds0, `an unfair deal is refused and nothing moves ("${v.reason}")`);
  // Sell 40 food for ammo, then buy food back with all that ammo: less food than before.
  st.trade.ask = {}; st.trade.offer = {};
  setQty(st, "mine", "food", 40);
  balanceWith(st, "ammo");
  const t1 = tradeTotals(st);
  check(tradeVerdict(st).ok && t1.ask <= t1.offer, `balance with ammo: ${st.trade.ask.ammo} ammo for 40 food`);
  executeTrade(st);
  const ammo = p.cargo.supplies.ammo;
  setQty(st, "mine", "ammo", ammo);
  balanceWith(st, "food");
  const back = st.trade.ask.food || 0;
  executeTrade(st);
  check(back < 40 && (p.cargo.supplies.food || 0) === back, `buying the food back with that ammo gets only ${back} of 40`);
  // Gear: buy an item from their wares.
  const item = (f.wares || [])[0];
  if (check(!!item, "the group has gear for sale")) {
    st.trade.offer = {}; st.trade.ask = {};
    p.cargo.supplies = { ammo: 300 };
    toggleGear(st, "theirs", 0);
    balanceWith(st, "ammo");
    const vg = tradeVerdict(st);
    const ok = vg.ok;
    executeTrade(st);
    check(ok && p.cargo.gear.includes(item) && !f.wares.includes(item), `bought ${item.name} item by item (${vg.reason})`);
  }
  // Carry: a team of one on foot cannot take 60 food.
  st.trade.offer = {}; st.trade.ask = {}; st.trade.askGear = []; st.trade.offerGear = [];
  p.members = p.members.slice(0, 1);
  p.cargo.supplies = { ammo: 400 };
  setQty(st, "mine", "ammo", 400);
  setQty(st, "theirs", "food", 60);
  const vc = tradeVerdict(st);
  check(!vc.ok && /cannot carry/.test(vc.reason), `the team's carry space limits what it takes ("${vc.reason}")`);
  // Goodwill: twenty generous little trades in one day give at most 4.
  st.trade.offer = {}; st.trade.ask = {};
  st.hour += 24; // a new day
  const gw0 = f.goodwill;
  let gwr = "";
  for (let i = 0; i < 20; i++) { setQty(st, "mine", "ammo", 15); gwr = executeTrade(st); }
  check(f.goodwill - gw0 <= 4 + 1e-9 && f.goodwill > gw0, `goodwill from trading is capped at 4 a day (+${(f.goodwill - gw0).toFixed(2)} from 20 trades; ${gwr})`);
  endTrade(st);
  check(!st.trade && p.phase === "waiting", "leaving the window: the team waits for orders");
}

// 4. Relays: coverage chains back to a station; upkeep.
{
  console.log("Radio relays");
  const st = world();
  const h = hub(st);
  const g = st.grid;
  check(radioNodes(st).length === 0 && !inCoverage(st, h.tile), "no radio, no coverage");
  const aTile = st.tiles.find((t) => land(st, t.id) && g.distance(t.id, h.tile) === 7).id;
  const bTile = st.tiles.find((t) => land(st, t.id) && g.distance(t.id, aTile) <= RELAY_RANGE && g.distance(t.id, h.tile) >= 12).id;
  const cTile = st.tiles.find((t) => land(st, t.id) && g.distance(t.id, h.tile) >= 30 && g.distance(t.id, bTile) >= 20).id;
  const A = outpost(st, aTile, "Relay A"), B = outpost(st, bTile, "Relay B"), C = outpost(st, cTile, "Relay C");
  for (const b of [A, B, C]) addBuilding(b, "relay");
  check(radioNodes(st).every((n) => !n.linked), "relays with no station are not linked");
  addBuilding(h, "radio");
  const nodes = radioNodes(st);
  const L = (b) => nodes.find((n) => n.base === b).linked;
  check(L(A) && L(B) && !L(C), `A (7 from the hub) links to the station, B (${g.distance(bTile, h.tile)} from the hub, ${g.distance(bTile, aTile)} from A) links through A, C far away does not`);
  const beyond = st.tiles.find((t) => g.distance(t.id, bTile) === RELAY_RANGE && g.distance(t.id, h.tile) > 8 && g.distance(t.id, aTile) > RELAY_RANGE);
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
  let right = 0, total = 0;
  for (const f of st.factions) {
    const expect = f.bases.some((b) => g.distance(b, h.tile) <= 8 + GROUP_REACH);
    total++;
    if (canRadioGroup(st, f) === expect) right++;
  }
  check(right === total, `a group can be called when a base of theirs is within coverage + ${GROUP_REACH} (${right}/${total})`);
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
  far.bases = [st.tiles.find((t) => g.distance(t.id, h.tile) > 8 + GROUP_REACH + 5).id];
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
    const meds = h.stock.meds, ammo = h.stock.ammo;
    check(v.ok && v.honoured, "the agreed deal is filled in and honoured");
    executeTrade(st);
    check(h.stock.meds === meds + 6 && h.stock.ammo === ammo - q.minPay && c.dealDone, `done: +6 meds, −${q.minPay} ammo`);
    endTrade(st);
    check(!st.trade && caravansAt(st, h.id).includes(c), "closing the window: the caravan stays");
    const stock0 = f.stock.ammo;
    drive(st, () => c.leaving, 30);
    check(c.leaving && c.phase === "out", "after a day it leaves");
    const home = drive(st, () => !st.parties.includes(c), 24 * 40);
    check(home && f.stock.ammo >= stock0 + q.minPay - 1, "home again, the payment goes into their stores");
  }
}

// 7. Attacking a caravan: hostility, pact torn up, raids.
{
  console.log("Attacking a caravan");
  const { st, h, f } = dealWorld(seed + 1);
  f.pact = "trade";
  for (let i = 0; i < 4; i++) fighter(st);
  const res = radioDeal(st, f, { wantKey: "food", wantQty: 10, payKey: "ammo", payQty: 200 });
  if (check(res.ok, "a caravan is on its way")) {
    const c = res.caravan;
    drive(st, () => c.phase === "trading", 24 * 40, (x) => x === "trade");
    const loot = c.goods.supplies.food || 0;
    const food0 = h.stock.food;
    attackCaravan(st, c);
    check(attitude(f) === "Hostile" && f.pact === null && f.grudgeUntil > day(st), "attacking makes the whole group hostile and tears up the pact");
    const won = !st.parties.includes(c);
    check(won ? h.stock.food >= food0 + loot : c.leaving, won ? `won: its ${loot} food is yours` : "lost: the caravan gets away");
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
  Object.assign(h.stock, { food: 300, water: 300, ammo: 400, fuel: 100 });
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
    setQty(st, "mine", "ammo", 60);
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
    const ammo0 = o.stock.ammo;
    take(card, /^Unload/);
    check(o.stock.ammo > ammo0 && !Object.values(p.cargo.supplies).some((q) => q >= 1), `unload: the goods go into ${o.name}`);
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
      balanceWith(st, "ammo");
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
  const known = new Set([...Object.keys(TRADE_ACTIONS), ...Object.keys(TRADE_CHANGE_ACTIONS), ...Object.keys(DIPLO_ACTIONS), ...Object.keys(DIPLO_CHANGE)]); // main.js registers both tables
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
  const p = visit(st, f, 2, { food: 30, ammo: 100 });
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
  const a = world(seed + 5), b = world(seed + 5);
  autoplay(a, { days: 60 });
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
