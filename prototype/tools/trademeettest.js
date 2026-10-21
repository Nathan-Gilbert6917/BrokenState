// Meeting places for trades (sim/trademeet.js): the halfway tile and the tiles nobody meets on; a caravan you ask for
// meets your team at a tile in the open (the trade window from what the team carries, both carry limits); one nobody
// meets goes home; a radio deal met halfway (their side on the caravan, the planner aimed at the tile, the deal filled
// in and honoured); a group calling with an offer asks to meet halfway when your base is far; the groups' own convoys
// (a swap both ways at the partner's base when near, both meeting halfway when far, nothing from nowhere); a save and
// load with a caravan waiting; the HTML of the screens.
// Usage: node tools/trademeettest.js [seed]
import { setFood } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { setRounds } from "../src/sim/ammo.js";
import { createWorld, tickHour, hub, makeSurvivor } from "../src/sim/world.js";
import { addBuilding } from "../src/sim/buildings.js";
import { planPath, partyTile, startReturn } from "../src/sim/parties.js";
import { foodIn } from "../src/sim/foods.js";
import { tradeContext, tradeVerdict, executeTrade, endTrade, setQty, balanceWith } from "../src/sim/trade.js";
import { canRadioGroup, radioRequestCaravan, offerCard } from "../src/sim/radio.js";
import { launchCaravan, caravanDestinations } from "../src/sim/caravans.js";
import { openRadioTrade, setMeetTile, deliveryHours } from "../src/sim/radiotrade.js";
import { halfwayTile, meetProblem, meetRefusal, meetPlaces, meetCaravans, meetCaravanForm, sendGroupConvoy, groupRoadHours, MEET } from "../src/sim/trademeet.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { tradeWindow, radioModal, caravanPlanModal } from "../src/ui/tradewindow.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const AMMO = "a_9mm_fmj";
const land = (st, t) => st.tiles[t].terrain !== "water" && st.tiles[t].terrain !== "mountain";

// A friendly trading group a good walk from the hub, in radio reach; no hordes near.
function setup(s, minDist = 8) {
  const st = createWorld({ seed: s, factionCount: 8 });
  const h = hub(st);
  addBuilding(h, "radio");
  const f = st.factions.filter((x) => x.alive && x.bases.length && planPath(st, x.bases[0], h.tile, false))
    .sort((a, b) => Math.abs(st.grid.distance(a.bases[0], h.tile) - minDist) - Math.abs(st.grid.distance(b.bases[0], h.tile) - minDist))[0];
  Object.assign(f, { type: "traders", goodwill: 60, known: true, pop: Math.max(f.pop, 24), atWar: false });
  f.bases = [f.bases[0]];
  if (!canRadioGroup(st, f)) f.bases = [st.grid.within(h.tile, 10).find((t) => land(st, t) && st.grid.distance(t, h.tile) >= 7 && !st.bases.some((b) => b.tile === t) && planPath(st, t, h.tile, false))];
  Object.assign(f.stock, { ammo: 600, meds: 60, fuel: 60, parts: 10, scrap: 120, water: 150 }); setFood(f, 300);
  for (const x of st.factions) if (x !== f) x.goodwill = Math.max(x.goodwill, -20);
  st.hordes = [];
  Object.assign(h.stock, { water: 200 }); setFood(h, 200); setRounds(h.stock, 0); h.stock[AMMO] = 600;
  for (let i = 0; i < 3; i++) {
    const p = makeSurvivor(st);
    p.skills.speech = 6; p.traits = []; p.health = 100;
    p.location = { kind: "base", baseId: h.id };
    st.survivors.push(p);
  }
  return { st, h, f };
}
// Ticks hours, answering cards harmlessly (keep(card) ones stay); a trade window stays open only when keep("trade").
function drive(st, pred, maxHours, keep = () => false) {
  for (let i = 0; i < maxHours; i++) {
    if (pred()) return true;
    tickHour(st);
    for (const p of st.parties) if (p.owner === "player") p.lastConflict = st.hour;
    for (let g = 0; g < 20; g++) {
      const c = st.cards.find((x) => !keep(x));
      if (!c) break;
      st.cards.splice(st.cards.indexOf(c), 1);
      const opts = c.choices.filter((x) => !(typeof x.disabled === "function" ? x.disabled(st) : x.disabled) && !x.uiAction);
      const ch = opts.find((x) => /^Hold here|^No, thank|^OK/.test(x.label)) || opts.find((x) => !/Return home|Fight|Attack|Agree|Complete|Trade with|Go on|Stay here/.test(x.label)) || opts[0];
      if (ch) ch.resolve(st);
    }
    if (st.trade && !keep("trade")) endTrade(st);
  }
  return pred();
}
const crewOf = (st, h, n = 2) => st.survivors.filter((s) => s.alive && s.location.kind === "base" && s.location.baseId === h.id).slice(0, n).map((s) => s.id);
function ask(st, f, where) {
  for (let i = 0; i < 12; i++) {
    const msg = radioRequestCaravan(st, f, where);
    if (/agree/.test(msg)) return msg;
    (f.radio = f.radio || {}).caravan = -99; // the cooldown, for another roll
  }
  return "";
}

// 1. Where to meet.
{
  console.log("Where to meet");
  const { st, h, f } = setup(seed);
  const mid = halfwayTile(st, f.bases[0], h.tile, f.id);
  const path = planPath(st, f.bases[0], h.tile, false, f.id).path;
  check(mid != null && path.includes(mid) && mid !== h.tile && mid !== f.bases[0], `halfway: a tile on their road, neither base (${mid})`);
  const i = path.indexOf(mid);
  check(i > 0 && i < path.length - 1 && Math.abs(i - (path.length - 1) / 2) <= path.length / 2, "somewhere in the middle of the road");
  check(!meetProblem(st, f, mid), `halfway is fine to meet at (${meetProblem(st, f, mid)})`);
  check(/your own base/.test(meetProblem(st, f, h.tile) || ""), "your own base: pick it as a base");
  check(/their own base/.test(meetProblem(st, f, f.bases[0]) || ""), "their base: fetch it yourself");
  const water = st.tiles.find((t) => t.terrain === "water" && !t.bridge);
  if (water) check(/water/.test(meetProblem(st, f, water.id) || ""), "nobody meets on the water");
  st.hordes.push({ tile: mid, size: 30 });
  check(/dead/.test(meetProblem(st, f, mid) || ""), "nor where the dead are");
  st.hordes = [];
  const places = meetPlaces(st, f);
  check(places.some((x) => x.baseId === h.id) && places.some((x) => x.half && x.tile === mid), "the places offered: your base and halfway to it");
  f.goodwill = -5; f.type = "commune";
  check(/trust/.test(meetRefusal(st, f, mid) || ""), "no trust, no meeting");
  f.goodwill = 60; f.type = "traders";
  check(!meetRefusal(st, f, mid), "friendly traders will meet");
}

// 2. A caravan you ask for meets your team halfway.
{
  console.log("A caravan met halfway");
  const { st, h, f } = setup(seed + 1);
  const mid = halfwayTile(st, f.bases[0], h.tile, f.id);
  const msg = ask(st, f, { meetTile: mid });
  const c = meetCaravans(st).find((x) => x.owner === f.id);
  check(c && c.meetTile === mid && c.baseId == null && /meet you/.test(msg), `they agree to meet at the tile: ${msg}`);
  check(caravanDestinations(st).some((x) => x.tile === mid && x.meetId === c.id), "the planner offers the meeting as a destination");
  const form = { crew: crewOf(st, h), vehicleId: null, stance: "normal", goods: { [AMMO]: 200 }, travel: { food: 15, water: 15, fuel: 0 }, gear: [], stops: [mid] };
  const res = launchCaravan(st, form);
  check(!res.error, `your caravan sets out for the meeting${res.error ? `: ${res.error}` : ""}`);
  const p = res.party;
  const met = drive(st, () => st.trade && st.trade.meet, 24 * 8, (x) => x === "trade" || (x && x.isCaravan && x.partyId === p.id));
  check(met && c.phase === "trading" && partyTile(p) === mid, "the trade window opens when both are on the tile");
  const ctx = tradeContext(st);
  check(ctx && ctx.kind === "meet" && ctx.p === p && ctx.caravan === c && ctx.myGear === p.cargo.gear && ctx.have[AMMO] >= 200, "your side: what the team carries; theirs: the caravan's goods");
  if (ctx) {
    const meds = Math.min(4, ctx.theirHave.meds || 0);
    const key = meds ? "meds" : Object.keys(ctx.theirHave).find((k) => ctx.theirHave[k] > 0 && k !== AMMO);
    setQty(st, "theirs", key, meds || 2);
    balanceWith(st, AMMO);
    const v = tradeVerdict(st);
    const give = st.trade.offer[AMMO] || 0, take = st.trade.ask[key];
    const team0 = (p.cargo.supplies[key] || 0), car0 = c.goods.supplies[AMMO] || 0, mine0 = (p.cargo.supplies[AMMO] || 0) + (p.supplies[AMMO] || 0);
    check(v.ok, `a fair deal (${v.reason})`);
    const out = executeTrade(st);
    check((p.cargo.supplies[key] || 0) === team0 + take && (c.goods.supplies[AMMO] || 0) === car0 + give && (p.cargo.supplies[AMMO] || 0) + (p.supplies[AMMO] || 0) === mine0 - give, `done: ${out}`);
    setQty(st, "theirs", key, 9999);
    const big = Object.keys(ctx.theirHave).filter((k) => ctx.theirHave[k] > 0).sort((a, b) => ctx.theirHave[b] - ctx.theirHave[a])[0];
    if (big) { setQty(st, "theirs", big, 99999); check(!tradeVerdict(st).ok, `the team's carry limit holds (${tradeVerdict(st).reason})`); }
    endTrade(st);
    check(!st.trade && st.cards.some((x) => x.isCaravan && x.partyId === p.id && x.choices.some((y) => /^Trade with the .* caravan here/.test(y.label))), "closed: the stop card offers to trade with the caravan again");
  }
  const left = drive(st, () => !st.parties.includes(c) || c.leaving, MEET.WAIT_HOURS + 4, (x) => x && x.isCaravan);
  check(left, "its wait up, it goes home");
  // Nobody meets the next one: it goes home after its wait (your team gone home first).
  st.cards = st.cards.filter((x) => x.partyId !== p.id);
  startReturn(st, p);
  drive(st, () => !st.parties.includes(p), 24 * 6);
  (f.radio = f.radio || {}).caravan = -99;
  const c2msg = ask(st, f, { meetTile: mid });
  const c2 = meetCaravans(st).find((x) => x.owner === f.id && x !== c);
  check(!!c2, `a second caravan (${c2msg})`);
  if (c2) {
    drive(st, () => c2.phase === "trading", 24 * 6);
    const t0 = st.hour;
    drive(st, () => c2.leaving || !st.parties.includes(c2), MEET.WAIT_HOURS + 4);
    check(c2.leaving && st.hour - t0 >= MEET.WAIT_HOURS - 1 && st.log.some((l) => /Nobody came to meet it/.test(l.text)), "nobody came: it waits its two days and goes home");
  }
}

// 3. A radio deal met halfway.
{
  console.log("A radio deal met halfway");
  const { st, h, f } = setup(seed + 2);
  check(openRadioTrade(st, f, h.id, "meet") === "", "the window opens with We meet");
  const mid = halfwayTile(st, f.bases[0], h.tile, f.id);
  let ctx = tradeContext(st);
  check(ctx.delivery === "meet" && ctx.meetTile === mid && ctx.fee === 0, "halfway to the base, no fee");
  setMeetTile(st, h.tile);
  setQty(st, "theirs", "meds", 5);
  check(/your own base/.test(tradeVerdict(st).reason), `a picked tile is checked (${tradeVerdict(st).reason})`);
  setMeetTile(st, null);
  balanceWith(st, AMMO);
  const ammo = st.trade.offer[AMMO];
  const v = tradeVerdict(st);
  check(v.ok, `fair (${v.reason})`);
  const msg = executeTrade(st);
  const c = meetCaravans(st).find((x) => x.owner === f.id);
  check(!st.trade && c && c.meetTile === mid && c.goods.supplies.meds === 5 && c.deal && c.deal.offer[AMMO] === ammo && h.stock[AMMO] === 600, `booked: their caravan sets out with their side, nothing leaves your base yet: ${msg}`);
  const form = meetCaravanForm(st, c);
  check(form.stops[0] === mid && form.fromBaseId === h.id && form.goods[AMMO] === ammo, "the planner: from your base to the tile, your side loaded");
  form.crew = crewOf(st, h);
  form.travel = { food: 15, water: 15, fuel: 0 };
  const res = launchCaravan(st, form);
  check(!res.error, `your caravan sets out${res.error ? `: ${res.error}` : ""}`);
  const p = res.party;
  drive(st, () => st.trade && st.trade.meet, 24 * 8, (x) => x === "trade" || (x && x.isCaravan && x.partyId === p.id));
  const v2 = tradeVerdict(st);
  check(st.trade && st.trade.deal && v2.ok && v2.honoured, `at the tile the deal is filled in and honoured (${v2.reason})`);
  if (st.trade) {
    const meds0 = p.cargo.supplies.meds || 0;
    executeTrade(st);
    check((p.cargo.supplies.meds || 0) === meds0 + 5 && c.dealDone && (c.goods.supplies[AMMO] || 0) >= ammo, "the swap: their meds on your team, your rounds on their caravan");
    endTrade(st);
  }
  // The html.
  const ui = { radioWith: f.id, radioMsg: "", tradeMsg: "", caravanPlan: form };
  check(/Where to meet|Meet/.test(radioModal(st, ui) || ""), "the radio panel offers a meeting place");
  check(typeof caravanPlanModal(st, ui) === "string", "the planner renders with a meeting stop");
  openRadioTrade(st, f, h.id, "meet");
  check(/We meet/.test(tradeWindow(st, ui)), "the radio trade window has We meet");
  endTrade(st);
}

// 4. A group far away asks to meet halfway.
{
  console.log("A call to meet halfway");
  let card = null;
  for (let k = 0; k < 8 && !card; k++) {
    const { st, h, f } = setup(seed + 10 + k);
    const far = st.grid.within(h.tile, 18).filter((t) => land(st, t) && st.grid.distance(t, h.tile) >= 12 && !st.bases.some((b) => b.tile === t) && !st.factions.some((x) => x.bases.includes(t)) && planPath(st, t, h.tile, false))
      .find((t) => { f.bases = [t]; return deliveryHours(st, f, h) > MEET.OFFER_HOURS && canRadioGroup(st, f); });
    if (far == null) continue;
    if (!canRadioGroup(st, f)) continue;
    for (let i = 0; i < 30 && !card; i++) {
      const c = offerCard(st, f);
      if (c && /Meet us halfway/.test(c.text)) card = { c, st, f };
    }
  }
  check(!!card, "a far group calls asking to meet halfway");
  if (card) {
    const { c, st, f } = card;
    const yes = c.choices.find((x) => /^Agree to meet/.test(x.label));
    check(yes && yes.uiAction && yes.uiAction.type === "meetCaravan" && !yes.affordable(st), "agree opens the planner; the governor declines");
    const msg = yes.resolve(st);
    check(meetCaravans(st).some((x) => x.owner === f.id && x.deal), `agreed: their caravan sets out with the deal (${msg})`);
  }
}

// 5. The groups' convoys: at the partner's base when near, halfway when far; a swap both ways.
{
  console.log("The groups' convoys");
  const st = createWorld({ seed: seed + 20, factionCount: 10 });
  st.hordes = [];
  const gs = st.factions.filter((x) => x.alive && x.bases.length);
  const pairs = [];
  for (const a of gs) for (const b of gs) if (a.id < b.id) { const hr = groupRoadHours(st, a, b); if (hr != null) pairs.push([a, b, hr]); }
  pairs.sort((x, y) => x[2] - y[2]);
  const near = pairs.find((x) => x[2] <= MEET.AI_FAR_HOURS);
  const far = [...pairs].reverse().find((x) => x[2] > MEET.AI_FAR_HOURS && halfwayTile(st, x[0].bases[0], x[1].bases[0], x[0].id) != null);
  const total = (f) => foodIn(f.stock) + (f.stock.scrap || 0);
  for (const [label, pr] of [["near", near], ["far", far]]) {
    if (!check(!!pr, `a ${label} pair of groups`)) continue;
    const [a, b] = pr;
    for (const f of [a, b]) { setFood(f, 200); f.stock.scrap = 200; f.pop = Math.max(f.pop, 10); }
    const sum0 = total(a) + total(b);
    const trades0 = (st.stats.groupTrades || 0), meets0 = (st.stats.groupMeets || 0);
    const sent = sendGroupConvoy(st, a, b);
    const loads = sent.reduce((s, q) => s + foodIn(q.goods.supplies) + (q.goods.supplies.scrap || 0) + foodIn(q.rations || {}), 0); // their road rations too (parties.js spawnAiParty)
    check(label === "near" ? sent.length === 1 && sent[0].meetTile == null : sent.length === 2 && sent[0].meetTile != null && sent[0].meetTile === sent[1].meetTile && sent[1].owner === b.id,
      `${label}: ${label === "near" ? "one convoy to their base" : "both send a convoy to the halfway tile"}`);
    check(Math.abs(total(a) + total(b) + loads - sum0) < 1e-6, `${label}: the loads come out of their own stores`);
    const done = drive(st, () => sent.every((q) => !st.parties.includes(q)), 24 * 10);
    check(done && (st.stats.groupTrades || 0) > trades0 && (label === "near" || (st.stats.groupMeets || 0) > meets0), `${label}: the swap is made and they go home (trades ${(st.stats.groupTrades || 0) - trades0}, meets ${(st.stats.groupMeets || 0) - meets0})`);
  }
}

// 6. A save and load with a caravan waiting at the tile.
{
  console.log("Save and load");
  const { st, h, f } = setup(seed + 3);
  const mid = halfwayTile(st, f.bases[0], h.tile, f.id);
  ask(st, f, { meetTile: mid });
  const c = meetCaravans(st).find((x) => x.owner === f.id);
  drive(st, () => c && c.phase === "trading", 24 * 6);
  const st2 = deserializeState(serializeState(st));
  const c2 = meetCaravans(st2).find((x) => x.owner === f.id);
  check(c2 && c2.meetTile === mid && c2.phase === "trading" && c2.stayUntil === c.stayUntil, "the waiting caravan comes back as it was");
}

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
