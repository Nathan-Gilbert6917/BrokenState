// Outsiders (src/sim/visitors.js, src/ui/visitors.js): raiders, merchants and explorers from beyond the state.
// Usage: node tools/visitortest.js [days] [seed]     (default 365 days, seed 42)
// - Spawns: only on land tiles of the map's border (not within 6 of a base; merchants on a road when there is one),
//   frequency by day (no raiders before day 20, the first by day 26, more often later, caps on the map), sizes and
//   gear by day.
// - Raiders: a raid on your base (held, a break-in that carries your stock off, paid off, talked down, defended in
//   person), on a group's base (factions.js resolveRaidOnFaction), on a group's convoy, on merchants; team cards
//   (stopped / seen first, every choice); leaving off the map at a border tile.
// - Merchants: rare goods (a manual, books, gear, fuel, meds, preserved food), the price model (cheap fuel, dear
//   food), the trade window at your base (buy a blueprint), a team trading on the road, trade with a group, the radio
//   call and invitation, reputation after an attack (traders, communes and fortresses, the next merchants).
// - Explorers: intel that lifts the fog only on the tiles given (and as of when they passed), the scouts' maps, the
//   recruit card, shelter (food and water a day, mood, a gift; thieves rob you), the road card.
// - Fog: unseen outsiders are not known, not listed, not in tooltips; seen or heard ones are; the timelapse records
//   them.
// - Determinism (two worlds in one process), save / load mid-visit (identical after 30 more days), the autopilot's
//   choices, a [days]-day Balanced run per style without NaN, and the UI pieces (Groups tab section, alerts, trade
//   window extras) without undefined / NaN and with a handler for every data-action.
import { foodSplit, foodText, FOODS } from "../src/sim/foods.js";
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { totalRounds } from "../src/sim/ammo.js"; // rounds by calibre
import { readFileSync, readdirSync } from "node:fs";
import { createWorld, tickHour, day, hub, atBase, newId, residents, combatPower } from "../src/sim/world.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { launchExpedition, partyTile, spawnAiParty, planPath } from "../src/sim/parties.js";
import { addBuilding } from "../src/sim/buildings.js";
import { attitude } from "../src/sim/factions.js";
import { tradeContext, tradeVerdict, toggleGear, balanceWith, executeTrade, endTrade, buyPrice, sellPrice, need } from "../src/sim/trade.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { chronicleReader } from "../src/sim/chronicle.js";
import * as V from "../src/sim/visitors.js";
import { outsidersSection, visitorAlerts, visitorTradeButtons, visitorTradeHead, VISITOR_ACTIONS } from "../src/ui/visitors.js";
import { tradeWindow } from "../src/ui/tradewindow.js";
import { digest } from "./digest.js";

const days = Number(process.argv[2] || 365);
const seed = Number(process.argv[3] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 8 }); st.started = true; return st; };
const tick = (st, n = 1) => { for (let i = 0; i < n && !st.gameOver; i++) tickHour(st); };
const clearCards = (st) => { st.cards.length = 0; };
const answer = (st, re) => { const c = st.cards.find((x) => x.choices.some((ch) => re.test(ch.label))); if (!c) return null; st.cards.splice(st.cards.indexOf(c), 1); const ch = c.choices.find((x) => re.test(x.label)); return ch.resolve(st); };
const cardWith = (st, re) => st.cards.find((c) => re.test(c.title));
const isBorder = (st, id) => { const t = st.tiles[id], g = st.grid; return t.x === 0 || t.y === 0 || t.x === g.width - 1 || t.y === g.height - 1; };
const place = (st, v, tile) => { v.tile = tile; v.path = [tile]; v.idx = 0; v.progress = 0; };
const ringLand = (st, center, r) => st.grid.within(center, r).filter((t) => st.grid.distance(t, center) === r && st.tiles[t].terrain !== "water");
const nanIn = (o, path = "") => {
  if (typeof o === "number") return Number.isNaN(o) ? path : null;
  if (!o || typeof o !== "object") return null;
  for (const [k, v] of Object.entries(o)) { const r = nanIn(v, `${path}.${k}`); if (r) return r; }
  return null;
};

// ======================================================================================
section("Spawns: border land tiles, frequency by day, sizes");
{
  const st = world();
  tick(st, 24);
  const g = st.grid;
  let bad = 0, roads = 0, merchants = 0, near = 0;
  for (let i = 0; i < 30; i++) {
    for (const kind of V.VISITOR_KINDS) {
      const v = V.spawnVisitor(st, kind);
      if (!v) { bad++; continue; }
      const entry = v.trail[0];
      if (!isBorder(st, entry) || st.tiles[entry].terrain === "water") bad++;
      if (st.bases.some((b) => g.distance(b.tile, entry) <= 6)) near++;
      if (kind === "merchants") { merchants++; if (st.tiles[entry].road) roads++; }
      V.leaveMap(st, v, "broken");
    }
  }
  check(bad === 0, `every spawn on a land tile of the border (${bad} not)`);
  check(near === 0, "never within 6 tiles of a base");
  check(roads >= merchants * 0.9, `merchants come in on a road (${roads} of ${merchants})`);
  // The schedule (visitorInfo's own dice): days of the first raiders and the gaps by day.
  const info = V.visitorInfo(world(seed + 1));
  check(info.next.raiders >= 20 && info.next.raiders <= 26, `first raiders between days 20 and 26 (day ${info.next.raiders})`);
  check(info.next.merchants >= 8 && info.next.merchants <= 14 && info.next.explorers >= 5 && info.next.explorers <= 10, `first merchants on days 8–14 (${info.next.merchants}), explorers 5–10 (${info.next.explorers})`);
  const rng = info.rng;
  const avg = (d) => { let s = 0; for (let i = 0; i < 400; i++) s += V.gapDays("raiders", d, rng); return s / 400; };
  const [a30, a120, a240, a340] = [30, 120, 240, 340].map(avg);
  console.log(`  raider gap on average: day 30 ${a30.toFixed(1)}, day 120 ${a120.toFixed(1)}, day 240 ${a240.toFixed(1)}, day 340 ${a340.toFixed(1)} days`);
  check(a30 > a120 && a120 > a240 && a240 >= a340 && a340 >= 7.4, "raiders come more often as the year goes on (never under 10 × 0.75 days)");
  const s20 = V.raiderSize(20, 0), s300 = V.raiderSize(300, 2);
  check(s20 === 4 && s300 === 14 && V.raiderPower(20) < V.raiderPower(200) && V.raiderPower(400) === 6, `bands grow with the day (size ${s20} → ${s300}, power ${V.raiderPower(20)} → ${V.raiderPower(400)})`);
  check(/clubs/.test(V.gearText(V.raiderPower(20))) && /plate/.test(V.gearText(V.raiderPower(400))), "and so does their gear");
}

// ======================================================================================
section("Fog: unseen outsiders are not known");
{
  const st = world();
  tick(st, 24);
  clearCards(st);
  const h = hub(st);
  const far = st.tiles.filter((t) => t.terrain !== "water" && st.grid.distance(t.id, h.tile) >= 15 && !st.live.has(t.id)).map((t) => t.id);
  const v = V.spawnVisitor(st, "explorers", { sub: "scouts", hostile: false, wantsYou: false });
  place(st, v, far[0]);
  v.path = [far[0], far[1]];
  tick(st);
  check(!v.known && !V.knownVisitors(st).includes(v), "far away: not known, not listed");
  check(!/scouts/.test(outsidersSection(st)), "the Groups tab does not show it");
  check(V.visitorTipLines(st, v.tile).length === 0, "no tooltip line for its tile");
  const near = ringLand(st, h.tile, 2)[0];
  place(st, v, near);
  v.goal = { kind: "site", tile: near };
  tick(st);
  check(v.known && v.live && v.seen && v.seen.tile === near, "in sight: known, its position seen");
  check(st.log.slice(0, 5).some((l) => /scouts from/.test(l.text)), "a log line announces it");
  check(/scouts/.test(outsidersSection(st)) && V.visitorTipLines(st, near).length === 1, "listed in the Groups tab and in the tooltip");
  place(st, v, far[2]);
  tick(st);
  check(V.visitorView(st, v).tile === near && /last seen/.test(outsidersSection(st)), "out of sight again: the last known position");
  // Radio coverage: heard, not seen.
  addBuilding(h, "radio"); h.radio = true;
  const cov = ringLand(st, h.tile, 7)[0];
  place(st, v, cov);
  tick(st);
  check(v.heard && !v.live && V.visitorView(st, v).tile === cov, "in radio coverage: heard, its position known");
}

// ======================================================================================
section("Raiders at your base");
{
  const st = world();
  tick(st, 24);
  clearCards(st);
  const h = hub(st);
  // A weak band against the hub: the warning, then held after 8 hours.
  const weak = V.spawnVisitor(st, "raiders", { size: 3, power: 2.6 });
  place(st, weak, ringLand(st, h.tile, 3)[0]);
  weak.goal = { kind: "base", baseId: h.id, tile: h.tile };
  weak.path = planPath(st, weak.tile, h.tile, false).path;
  for (let i = 0; i < 30 && weak.phase !== "siege"; i++) tick(st);
  check(weak.phase === "siege" && !!cardWith(st, /^Outsider raiders heading for/), "a warning card when they come in sight, then the siege");
  const card = cardWith(st, /^Outsider raiders heading for/);
  check(card && card.choices.length === 5 && card.choices.every((c) => typeof c.ai === "function"), "five choices, each scored for the autopilot");
  answer(st, /^Hold as you are/);
  const repelled = st.stats.raidsRepelled;
  for (let i = 0; i < 9 && st.visitors.includes(weak) && weak.phase === "siege"; i++) tick(st);
  check(st.stats.raidsRepelled === repelled + 1 && st.log.slice(0, 8).some((l) => /drove off/.test(l.text)), "held: the raid is repelled");
  // A band already warned of at another base (it raided an outpost first) is warned of again when it comes here.
  clearCards(st);
  const again = V.spawnVisitor(st, "raiders", { size: 3, power: 2.6 });
  place(st, again, ringLand(st, h.tile, 3)[1] ?? ringLand(st, h.tile, 3)[0]);
  again.warned = true; again.warnedBase = -1;
  again.goal = { kind: "base", baseId: h.id, tile: h.tile };
  for (let i = 0; i < 30 && again.phase !== "siege"; i++) tick(st);
  check(again.phase === "siege" && !!cardWith(st, /^Outsider raiders heading for/), "a band warned of at another base gets a new warning card at this one");
  clearCards(st);
  V.leaveMap(st, again);
  // A strong band: a break-in, and what they take, they carry.
  clearCards(st);
  for (const s of atBase(st, h.id)) s.health = 15;
  const food0 = food(h);
  const strong = V.spawnVisitor(st, "raiders", { size: 14, power: 6 });
  place(st, strong, h.tile);
  strong.goal = { kind: "base", baseId: h.id, tile: h.tile };
  const carried0 = food(strong);
  tick(st);
  check(strong.phase === "siege", "a strong band besieges the hub");
  for (let i = 0; i < 9 && strong.phase === "siege"; i++) tick(st);
  check(food(h) < food0 * 0.85 && food(strong) > carried0, `the stock was carried off (${Math.round(food0)} → ${Math.round(food(h))} food; they carry ${food(strong)})`);
  check(st.log.slice(0, 12).some((l) => /broke into|overran/.test(l.text)), "a break-in or overrun in the log");
  check(strong.phase === "travel" && (strong.spared || []).includes(h.id), "and they move on (never this base again)");
  for (const s of atBase(st, h.id)) s.health = 90;
  // Pay off and talk down.
  clearCards(st);
  Object.assign(h.stock, { ammo: 400, meds: 20 }); setFood(h, 300);
  // Someone on watch: the break-in above can kill the hub's only guard (which of them dies is the dice's: with the
  // normal start's backgrounds, seed 42 loses its guard there), and on an unwatched night nobody at the base sees a
  // band coming (watch.js lookoutsSpot) until it is at the walls. The warning card is wanted 2 tiles out.
  if (!atBase(st, h.id).some((s) => s.role === "guard")) atBase(st, h.id)[0].role = "guard";
  const p1 = V.spawnVisitor(st, "raiders", { size: 6, power: 3 });
  place(st, p1, ringLand(st, h.tile, 2)[0]);
  p1.goal = { kind: "base", baseId: h.id, tile: h.tile };
  p1.path = planPath(st, p1.tile, h.tile, false).path;
  tick(st);
  const ammo0 = totalRounds(h.stock); // ammo.js: every round, any calibre
  const msg = answer(st, /^Pay them off/);
  check(p1.paid && totalRounds(h.stock) < ammo0 && p1.goal.kind === "exit", `paid off: ${msg}`);
  check(!V.raidTargets(st, p1).some((t) => t.goal.kind === "base" && t.goal.baseId === h.id), "a band you paid never targets that base again");
  // Defend in person (resolved by the numbers headless): win and their loot is yours.
  clearCards(st);
  for (const s of atBase(st, h.id)) { s.health = 100; s.role = "guard"; }
  const d1 = V.spawnVisitor(st, "raiders", { size: 3, power: 2.6 });
  d1.stock.meds = 7;
  place(st, d1, ringLand(st, h.tile, 2)[1]);
  d1.goal = { kind: "base", baseId: h.id, tile: h.tile };
  d1.path = planPath(st, d1.tile, h.tile, false).path;
  tick(st);
  const meds0 = h.stock.meds;
  st.autoCombat = true;
  answer(st, /^Defend in person/);
  const won = !st.visitors.includes(d1);
  const def = cardWith(st, /^Raid defense/);
  check(!!def, `the battle's result card (${def ? def.text.slice(0, 90) : "none"})`);
  if (won) check(h.stock.meds >= meds0 + 7, "won: the band's loot goes into the stores");
  // Talk down (both ways over many tries: the chance is on the label).
  let talked = 0, tries = 0;
  for (let i = 0; i < 30; i++) {
    clearCards(st);
    const t = V.spawnVisitor(st, "raiders", { size: 5, power: 3 });
    place(st, t, ringLand(st, h.tile, 2)[2] ?? ringLand(st, h.tile, 2)[0]);
    t.goal = { kind: "base", baseId: h.id, tile: h.tile };
    t.path = planPath(st, t.tile, h.tile, false).path;
    tick(st);
    if (!cardWith(st, /^Outsider raiders/)) { V.leaveMap(st, t, "broken"); continue; }
    tries++;
    answer(st, /^Talk them down/);
    if (t.paid) talked++;
    V.leaveMap(st, t, "broken");
    setFood(h, 300); h.stock.ammo = 400;
  }
  console.log(`  talked down ${talked} of ${tries}`);
  check(tries > 20 && talked > 0 && talked < tries, "talking works sometimes, not always");
}

// ======================================================================================
section("Raiders and everyone else: groups, their caravans, merchants, sites; leaving the map");
{
  const st = world();
  tick(st, 24);
  clearCards(st);
  const f = st.factions.find((x) => x.alive && x.type !== "military");
  const b = f.bases[0];
  const pop0 = f.pop, stock0 = food(f);
  const v = V.spawnVisitor(st, "raiders", { size: 14, power: 6 });
  place(st, v, b);
  v.goal = { kind: "faction", factionId: f.id, tile: b };
  v.phase = "travel";
  tick(st);
  check(v.phase === "siege", "a band besieges a group's base");
  for (let i = 0; i < 13 && v.phase === "siege"; i++) tick(st);
  check(V.visitorInfo(st).stats.raidsOnGroups >= 1 && (f.pop < pop0 || food(f) < stock0), `the group's raid is resolved (pop ${pop0} → ${f.pop}, food ${Math.round(stock0)} → ${Math.round(food(f))})`);
  check(!V.raidTargets(st, v).some((t) => t.goal.kind === "faction"), "one group's base a band at most");
  // A group's convoy.
  const from = st.factions.find((x) => x.alive && x !== f) || f;
  const to = st.factions.find((x) => x.alive && x !== from);
  const q = spawnAiParty(st, from, "caravan", from.bases[0], to.bases[0], { strength: 3 });
  q.goods = { supplies: { food: 20, meds: 4 }, gear: [] };
  const r2 = V.spawnVisitor(st, "raiders", { size: 8, power: 4 });
  place(st, r2, partyTile(q));
  r2.goal = { kind: "aiparty", partyId: q.id, tile: partyTile(q) };
  const robbed0 = V.visitorInfo(st).stats.robbed;
  for (let i = 0; i < 6 && st.parties.includes(q); i++) tick(st);
  check(!st.parties.includes(q) && V.visitorInfo(st).stats.robbed === robbed0 + 1 && r2.stock.meds >= 4, "a group's caravan is robbed (its goods go with the band)");
  // Merchants.
  const m = V.spawnVisitor(st, "merchants");
  const r3 = V.spawnVisitor(st, "raiders", { size: 14, power: 6 });
  place(st, m, ringLand(st, b, 4)[0]); place(st, r3, m.tile);
  r3.goal = { kind: "visitor", visitorId: m.id, tile: m.tile };
  const fuel0 = m.stock.fuel;
  tick(st);
  check(m.stock.fuel < fuel0 && r3.stock.fuel > 0, `merchants plundered (fuel ${fuel0} → ${m.stock.fuel})`);
  // A rich site.
  const site = st.tiles.find((t) => t.loc && t.loot >= 0.5 && t.owner == null && !t.hive && !st.bases.some((x) => x.tile === t.id));
  const r4 = V.spawnVisitor(st, "raiders", { size: 5, power: 3 });
  place(st, r4, site.id);
  r4.goal = { kind: "site", tile: site.id };
  const loot0 = site.loot;
  tick(st, 10);
  check(site.loot < loot0 && site.loot >= 0.03 && site.loot > loot0 * 0.7, `a site is looted (${loot0.toFixed(2)} → ${site.loot.toFixed(2)})`);
  let sitesSeen = 0, onGrounds = 0;
  for (const t of st.tiles.filter((x) => x.terrain !== "water").filter((_, i) => i % 97 === 0)) {
    place(st, r4, t.id);
    for (const o of V.raidTargets(st, r4)) if (o.goal.kind === "site") { sitesSeen++; if (V.nearGroups(st, o.goal.tile)) onGrounds++; }
  }
  check(sitesSeen > 0 && onGrounds === 0, `never a site within ${V.GROUND} tiles of a group's base (${sitesSeen} site targets looked at)`);
  // Everyone leaves by a border tile (out of time, they slip away wherever they are: leftAtBorder counts the rest).
  const st2 = world(seed + 3);
  setAutopilot(st2, true, "balanced");
  while (day(st2) <= 120) { if (st2.gameOver) st2.gameOver = false; tickHour(st2); }
  const s2 = V.visitorInfo(st2).stats;
  const left = { border: s2.leftAtBorder || 0, other: s2.left - (s2.leftAtBorder || 0) };
  console.log(`  120 days on seed ${seed + 3}: ${left.border} left at a border tile, ${left.other} elsewhere (out of time); ${JSON.stringify(s2)}`);
  check(left.border >= 5 && left.other <= left.border * 0.1, "they leave off the map at a border tile");
}

// ======================================================================================
section("Your teams meet them");
{
  const st = world();
  tick(st, 24);
  clearCards(st);
  const h = hub(st);
  st.autoCombat = true;
  const away = st.tiles.find((t) => t.terrain !== "water" && st.grid.distance(t.id, h.tile) === 6 && planPath(st, h.tile, t.id, false)).id;
  const crew = atBase(st, h.id).slice(0, 2).map((s) => s.id);
  const res = launchExpedition(st, { memberIds: crew, dest: away, mission: "move", stance: "normal", supplies: { food: 10, water: 10, ammo: 30 } });
  const p = res.party;
  while (partyTile(p) !== away && st.parties.includes(p)) tick(st);
  clearCards(st);
  p.lastConflict = null;
  const r = V.spawnVisitor(st, "raiders", { size: 9, power: 5 });
  place(st, r, away);
  r.goal = { kind: "party", partyId: p.id, tile: away };
  tick(st);
  const c = st.cards.find((x) => x.partyId === p.id && /^Raiders/.test(x.title));
  check(!!c && p.phase === "engaged" && p.lastConflict === st.hour, `a team gets a card (${c ? c.title : "none"}), stops, and no other road encounter for 20 hours`);
  if (c) {
    check(c.choices.every((x) => typeof x.ai === "function"), "every choice scored for the autopilot");
    const pay = c.choices.find((x) => /Pay the toll|Lie low/.test(x.label)) || c.choices[c.choices.length - 1];
    st.cards.splice(st.cards.indexOf(c), 1);
    pay.resolve(st);
    check(p.phase !== "engaged" || st.cards.some((x) => x.partyId === p.id), `answered: the team goes on (${p.phase})`);
  }
  // A fight: the band is broken or the team robbed; a result card either way.
  clearCards(st);
  const r2 = V.spawnVisitor(st, "raiders", { size: 2, power: 2.6 });
  r2.stock.meds = 4;
  place(st, r2, partyTile(p));
  r2.goal = { kind: "party", partyId: p.id, tile: partyTile(p) };
  r2.met = {};
  p.lastConflict = null;
  tick(st);
  const c2 = st.cards.find((x) => x.partyId === p.id && /^Raiders/.test(x.title));
  if (c2) {
    st.cards.splice(st.cards.indexOf(c2), 1);
    (c2.choices.find((x) => /^Fight|^Ambush/.test(x.label))).resolve(st);
    check(st.cards.some((x) => /^The fight with/.test(x.title)), "a fight ends with a result card");
  } else check(false, "a second card for the fight");
  // Merchants on the road: the trade window from what the team carries.
  clearCards(st);
  if (st.parties.includes(p)) {
    p.phase = "waiting";
    const m = V.spawnVisitor(st, "merchants");
    place(st, m, partyTile(p));
    m.phase = "travel";
    p.lastConflict = null;
    tick(st);
    const mc = st.cards.find((x) => x.partyId === p.id && /^Traders on the road/.test(x.title));
    check(!!mc, "merchants met on the road: a card");
    if (mc) {
      st.cards.splice(st.cards.indexOf(mc), 1);
      mc.choices.find((x) => /^Trade with them/.test(x.label)).resolve(st);
      const ctx = tradeContext(st);
      check(ctx && ctx.kind === "visit" && ctx.visitor === m && ctx.p === p, "the trade window opens for the team");
      // Leave (the player): back to the traders' card, the team still stopped with its resume order kept.
      endTrade(st, { back: true });
      const mc2 = st.cards.find((x) => x.partyId === p.id && /^Traders on the road/.test(x.title));
      check(!st.trade && !!mc2 && p.phase === "engaged" && p.conflictResume === "waiting" && st.cards.filter((x) => x.visitorId === m.id).length === 1, "closing the trade window brings back the traders' card (one, the team's resume order kept)");
      if (mc2) {
        st.cards.splice(st.cards.indexOf(mc2), 1);
        mc2.choices.find((x) => /^Trade with them/.test(x.label)).resolve(st);
        check(!!tradeContext(st), "and trading again from it opens the window again");
        endTrade(st); // the autopilot's close: the team waits for orders, no card
        check(!st.cards.some((x) => x.visitorId === m.id) && p.phase !== "engaged", "a close without back ends the meeting as before");
      }
    }
    // Explorers on the road.
    clearCards(st);
    p.phase = "waiting";
    const e = V.spawnVisitor(st, "explorers", { sub: "scouts", hostile: false });
    place(st, e, partyTile(p));
    e.trail = [partyTile(p)]; e.trailHours = [st.hour];
    p.lastConflict = null;
    tick(st);
    const ec = st.cards.find((x) => x.partyId === p.id && /^Travellers from outside/.test(x.title));
    check(!!ec, "travellers met on the road: a card");
    if (ec) {
      st.cards.splice(st.cards.indexOf(ec), 1);
      ec.choices.find((x) => /^Swap news/.test(x.label)).resolve(st);
      check(p.seen.size > 0, `their map goes into the team's report (${p.seen.size} tiles)`);
    }
  }
}

// ======================================================================================
section("The governor and a toll that would strand the team");
{
  // Progression census 2026-10-09 (seed 7002 hardcore): a hive squad three days out paid its water and its fire fuel
  // as a toll, went home parched and never set the fire. The toll's score (the governor's) drops to 5 when it would
  // leave the team less water or food than the way home takes, or takes a hive squad's fuel.
  const tollAi = (supplies, mission = "move", far = 9) => {
    const st = world(seed + 11);
    tick(st, 24);
    clearCards(st);
    const h = hub(st);
    st.autoCombat = true;
    for (const [k, q] of Object.entries(supplies)) h.stock[k] = Math.max(h.stock[k] || 0, q + 20);
    const dest = st.tiles.find((t) => t.terrain !== "water" && st.grid.distance(t.id, h.tile) === far && planPath(st, h.tile, t.id, false)).id;
    const crew = atBase(st, h.id).slice(0, 3).map((s) => s.id);
    const res = launchExpedition(st, { memberIds: crew, dest, mission, stance: "normal", supplies });
    const p = res.party;
    if (!p) return { why: res.error };
    tick(st, 2);
    // The band stops them (Raiders from outside) unless the team spots it first (Raiders ahead): a fresh band until it does.
    for (let i = 0; i < 12; i++) {
      clearCards(st);
      p.lastConflict = null;
      st.visitors.length = 0;
      const r = V.spawnVisitor(st, "raiders", { size: 9, power: 5 });
      place(st, r, partyTile(p));
      r.goal = { kind: "party", partyId: p.id, tile: partyTile(p) };
      tick(st);
      const c = st.cards.find((x) => x.partyId === p.id && /^Raiders from outside/.test(x.title));
      const pay = c && c.choices.find((x) => /^Pay the toll/.test(x.label));
      if (pay) return { ai: pay.ai(st), label: pay.label };
    }
    return { why: "no toll card in 12 tries" };
  };
  const dry = tollAi({ water: 20, food: 6 }); // enough water to pay the toll (food travels as typed items, water partly in canteens), not enough left for the way home
  check(dry.ai === 5, `a toll paid in the water the team needs to get home: score ${dry.ai} (${dry.label || dry.why})`);
  const rich = tollAi({ water: 20, food: 12, scrap: 30 });
  check(rich.ai >= 55, `a toll paid from spare scrap: the usual score ${rich.ai} (${rich.label || rich.why})`);
  const fire = tollAi({ water: 20, food: 12, fuel: 12 }, "hive");
  check(fire.ai === 5 || !/fuel/.test(fire.label || ""), `a hive squad's fire fuel as a toll: score ${fire.ai} (${fire.label || fire.why})`);
}

// ======================================================================================
section("Merchants: goods, prices, the trade window, groups, the radio");
{
  const st = world();
  tick(st, 24);
  clearCards(st);
  const h = hub(st);
  const m = V.spawnVisitor(st, "merchants", { spec: "general" }); // escorts.js: general goods (the others carry by their speciality)
  const bp = m.wares.filter((g) => /^bp_/.test(g.key));
  console.log(`  ${m.name}: ${V.goodsText(m)}`);
  check(m.stock.fuel >= 15 && m.stock.meds >= 8 && foodSplit(m.stock).stable >= 20 && m.wares.length >= 3, `rare goods: fuel, meds, food that keeps, items (${foodText(Object.fromEntries(Object.entries(m.stock).filter(([k]) => FOODS[k])))})`);
  check(m.guards >= 2 && m.size === m.guards + 2 && m.escort, `guards and traders (${m.guards} + 2, ${m.escort && m.escort.tier} escort)`);
  check(buyPrice(st, m, "fuel", 0, 10) < buyPrice(st, m, "food", 0, 10) * 1.5 + 2 && sellPrice(st, m, "food", 0, 10) > 1.5, `cheap fuel (${buyPrice(st, m, "fuel", 0, 10).toFixed(2)} a unit), dear food (they pay ${sellPrice(st, m, "food", 0, 10).toFixed(2)})`);
  check(need(m, "fuel") <= 0.6 && need(m, "food") > need(m, "fuel") + 0.5, `their need: plenty of fuel, food wanted more (${need(m, "food").toFixed(2)}; food by type: every kind counts, the food that keeps too)`);
  // At the hub: the trade window, a blueprint bought with ammo.
  Object.assign(h.stock, { ammo: 900, scrap: 200 }); setFood(h, 300);
  place(st, m, h.tile);
  m.goal = { kind: "base", baseId: h.id, tile: h.tile };
  m.phase = "travel";
  tick(st);
  check(m.phase === "stop" && st.trade && st.trade.visitorId === m.id, "they stop at your base and the trade window opens");
  check(st.log.slice(0, 5).some((l) => /^A merchant caravan from .+ has arrived at/.test(l.text)), "a log line says so");
  const ctx = tradeContext(st);
  check(ctx && ctx.kind === "caravan" && ctx.visitor === m && ctx.base === h, "trade context: your stores against their wagons");
  const item = bp[0] || m.wares[0];
  const armory0 = h.armory.length;
  toggleGear(st, "theirs", ctx.theirGear.indexOf(item));
  balanceWith(st, "ammo");
  const verdict = tradeVerdict(st);
  check(verdict.ok, `a fair deal for ${item.name}: ${verdict.reason}`);
  const msg = executeTrade(st);
  check(h.armory.includes(item) && h.armory.length === armory0 + 1 && !m.wares.includes(item), `bought: ${msg}`);
  const html = tradeWindow(st, { attackConfirm: null });
  check(/from outside the state/.test(html) && /vis-attack/.test(html) && !/data-action="pact"/.test(html) && !/undefined|NaN/.test(html), "the trade window: merchants' header, Rob button, no pacts, no undefined / NaN");
  endTrade(st);
  // Leaving after 24 hours.
  tick(st, 25);
  check(m.phase === "travel" && m.goal.kind !== "base", "after a day they move on");
  // With a group.
  const f = st.factions.find((x) => x.alive && x.type !== "raider" && x.type !== "zealot");
  f.stock.meds = 0; setFood(f, f.pop * 20);
  const m2 = V.spawnVisitor(st, "merchants", { spec: "general" });
  const meds0 = m2.stock.meds, lack0 = ["food", "water", "scrap", "jars"].map((k) => m2.stock[k] || 0);
  const traded = V.tradeWithGroup(st, m2, f);
  const gotLack = ["food", "water", "scrap", "jars"].filter((k, i) => (m2.stock[k] || 0) > lack0[i]);
  check(traded && f.stock.meds > 0 && m2.stock.meds < meds0 && gotLack.length, `trade with ${f.name}: meds for what the merchants lack (${meds0} → ${m2.stock.meds} meds, for ${gotLack.join(", ")})`);
  // The radio call and the invitation.
  clearCards(st);
  addBuilding(h, "radio"); h.radio = true;
  const m3 = V.spawnVisitor(st, "merchants");
  m3.wantsYou = false; m3.stops = m3.stops.filter((s) => s.kind !== "base");
  place(st, m3, ringLand(st, h.tile, 6).find((t) => planPath(st, t, h.tile, false)));
  m3.goal = { kind: "site", tile: m3.tile }; m3.phase = "travel";
  tick(st);
  const call = st.cards.find((c) => c.visitorId === m3.id && /^Traders on the radio/.test(c.title));
  check(!!call && /if you want/.test(call.text), `the radio call: ${call ? call.text.slice(0, 120) : "none"}`);
  if (call) { st.cards.splice(st.cards.indexOf(call), 1); call.choices.find((c) => /^Yes, come to/.test(c.label)).resolve(st); }
  check(m3.goal.kind === "base" && m3.goal.baseId === h.id, "invited: they head for the hub next");
  // Reputation.
  clearCards(st);
  const trader = st.factions.find((x) => x.type === "traders") || st.factions[0];
  trader.known = true;
  const commune = st.factions.find((x) => x.type === "commune" || x.type === "fortress");
  if (commune) commune.known = true;
  const gw0 = trader.goodwill, gwc = commune ? commune.goodwill : 0;
  m3.phase = "stop"; m3.goal = { kind: "base", baseId: h.id, tile: h.tile }; place(st, m3, h.tile); m3.stayUntil = st.hour + 10;
  st.autoCombat = true;
  V.attackMerchants(st, m3, { baseId: h.id });
  check(V.merchantRep(st) === -45, `merchant reputation −45 (${V.merchantRep(st)})`);
  check(trader.goodwill <= gw0 - 14.9 + (trader.type === "traders" ? 0 : 7), `traders hear of it (${Math.round(gw0)} → ${Math.round(trader.goodwill)})`);
  if (commune) check(commune.goodwill <= gwc - 7.9, `${commune.type} too (${Math.round(gwc)} → ${Math.round(commune.goodwill)})`);
  const next = V.spawnVisitor(st, "merchants");
  check(next.goodwill === 15 - 45 && !next.wantsYou, `the next merchants come warier (goodwill ${next.goodwill}) and skip your bases`);
  V.visitorInfo(st).rep = -90;
  const hostile = V.spawnVisitor(st, "merchants");
  place(st, hostile, h.tile); hostile.goal = { kind: "base", baseId: h.id, tile: h.tile }; hostile.phase = "stop"; hostile.stayUntil = st.hour + 5;
  V.openVisitorTrade(st, hostile, { baseId: h.id });
  check(attitude(hostile) === "Hostile" && !tradeVerdict(st).ok, "at −90: hostile, no trade");
  st.trade = null;
  // The daily drift, in a world of its own: the auto-resolved fight above is the combat dice's, and when the hub's
  // six lose it to the guards the run is over and no day passes (visitorsDaily stops at game over). Days 2–6: no
  // merchants have come yet (first ones on days 8–14), so none leaving can lift it either.
  const sd = world();
  tick(sd, 24);
  V.visitorInfo(sd).rep = -80;
  tick(sd, 24 * 4);
  check(!sd.gameOver && V.merchantRep(sd) > -80 && V.merchantRep(sd) <= -78.9, `reputation recovers 0.25 a day (−80 → ${V.merchantRep(sd)} in 4 days)`);
}

// ======================================================================================
section("Explorers: intel, maps, recruits, shelter, thieves");
{
  const st = world();
  tick(st, 24);
  clearCards(st);
  const h = hub(st);
  const g = st.grid;
  const e = V.spawnVisitor(st, "explorers", { sub: "refugees", hostile: false, wantsYou: true });
  const far = st.tiles.filter((t) => t.terrain !== "water" && g.distance(t.id, h.tile) >= 12).map((t) => t.id);
  e.trail = [far[0], far[5]]; e.trailHours = [st.hour - 30, st.hour - 10];
  for (let i = 0; i < st.knowledge.length; i++) st.knowledge[i] = null;
  const given = V.giveIntel(st, e, 1);
  const expect = new Set([...g.within(far[0], 1), ...g.within(far[5], 1)]);
  const known = st.knowledge.map((k, i) => (k ? i : -1)).filter((i) => i >= 0);
  check(given === expect.size && known.length === expect.size && known.every((i) => expect.has(i)), `intel lifts the fog only where given (${known.length} tiles, ${expect.size} expected)`);
  check(st.knowledge[far[0]].hour === st.hour - 30 && st.knowledge[far[5]].hour === st.hour - 10, "as of when they passed");
  check(V.scoutPrice(e) >= 12, "scouts' maps have a price");
  // At the gate: news, who wants to stay, shelter.
  place(st, e, h.tile);
  e.goal = { kind: "base", baseId: h.id, tile: h.tile };
  e.phase = "travel";
  e.joiners = 2; e.size = 4;
  tick(st);
  check(e.phase === "gate" && !!cardWith(st, /^Travellers at/), "at the gate: a card");
  const n0 = st.knowledge.filter(Boolean).length;
  answer(st, /^Hear their news/);
  check(st.knowledge.filter(Boolean).length >= n0 && st.log.slice(0, 3).some((l) => /Travellers at/.test(l.text)), "their news in the log");
  answer(st, /^Hear who wants to stay/);
  const rc = st.cards.find((c) => c.recruit);
  check(!!rc && rc.recruit.candidates.length === 2 && rc.recruit.source === "outsiders", "a recruit card with the two who want to stay (recruits.js)");
  const people0 = st.survivors.filter((s) => s.alive).length;
  if (rc) { st.cards.splice(st.cards.indexOf(rc), 1); rc.choices.find((c) => c.kind === "take").resolve(st); }
  check(st.survivors.filter((s) => s.alive).length === people0 + 2, "taken in");
  Object.assign(h.stock, { water: 200 }); setFood(h, 200);
  const mood0 = residents(st, h.id).reduce((a, s) => a + s.mood, 0) / residents(st, h.id).length;
  answer(st, /^Shelter them/);
  check(e.phase === "sheltered", "sheltered");
  const mood1 = residents(st, h.id).reduce((a, s) => a + s.mood, 0) / residents(st, h.id).length;
  check(mood1 > mood0, `mood rises (${mood0.toFixed(1)} → ${mood1.toFixed(1)})`);
  clearCards(st);
  const food0 = food(h);
  let used = 0;
  for (let d = 0; d < 3; d++) { const f0 = food(h); V.visitorsDaily(st); used += f0 - food(h); }
  check(Math.abs(used - e.size * 3) < 1e-6, `they eat 1 food each a day (${used} for ${e.size} over 3 days)`);
  setFood(h, food0);
  e.shelterUntil = st.hour;
  tick(st);
  check(e.phase !== "sheltered", "after 3 days they leave");
  // Thieves.
  clearCards(st);
  const t = V.spawnVisitor(st, "explorers", { sub: "wanderers", hostile: true, wantsYou: true });
  place(st, t, h.tile);
  t.goal = { kind: "base", baseId: h.id, tile: h.tile };
  t.phase = "travel";
  tick(st);
  answer(st, /^Shelter them/);
  const meds0 = h.stock.meds = 50;
  t.shelterUntil = st.hour;
  tick(st);
  check(h.stock.meds < meds0 && st.log.slice(0, 4).some((l) => /were thieves/.test(l.text)), "robbers in disguise rob the base that shelters them");
  // A trip through ruins lowers the loot a little.
  const site = st.tiles.find((x) => x.loc && x.loot >= 0.4 && x.owner == null && !x.hive);
  const w = V.spawnVisitor(st, "explorers", { sub: "scouts", hostile: false, wantsYou: false });
  place(st, w, site.id);
  w.goal = { kind: "site", tile: site.id };
  const l0 = site.loot;
  tick(st, 10);
  check(site.loot < l0 && site.loot > l0 * 0.88, `ruins explored: loot ${l0.toFixed(2)} → ${site.loot.toFixed(2)}`);
}

// ======================================================================================
section("Travellers at the gate: put off, sent off, after a trade (DIALOG-01, DIALOG-02)");
{
  const st = world();
  tick(st, 24);
  clearCards(st);
  const h = hub(st);
  const e = V.spawnVisitor(st, "explorers", { sub: "wanderers", hostile: false, wantsYou: false });
  place(st, e, h.tile);
  e.goal = { kind: "base", baseId: h.id, tile: h.tile };
  e.phase = "travel";
  e.joiners = 0;
  e.stock.meds = 3;
  tick(st);
  const gc = () => st.cards.find((c) => c.visitorId === e.id && /^Travellers at/.test(c.title));
  check(e.phase === "gate" && !!gc(), "at the gate: a card");
  const decide = gc() && gc().choices.find((c) => /^Decide later/.test(c.label));
  check(!!decide && decide.default === true, "Decide later is the card's default (a tray card left alone keeps them at the gate)");
  answer(st, /^Decide later/);
  check(!gc() && e.phase === "gate" && V.gateTalkBase(st, e) === h, "put off: they wait at the gate, and can be talked to again");
  check(V.visitorView(st, e).gate === h, "the Groups tab offers the gate again");
  tick(st, 2);
  check(e.phase === "gate", "still waiting a few hours on");
  V.reopenGate(st, e);
  check(!!gc() && st.cards.filter((c) => c.visitorId === e.id).length === 1, "selecting them brings the card back (one)");
  V.reopenGate(st, e);
  check(st.cards.filter((c) => c.visitorId === e.id).length === 1, "never two cards");
  // A trade from the gate: closing the window comes back to the gate card, nothing restarted.
  answer(st, /^Trade with them/);
  check(!!tradeContext(st) && e.phase === "stop", "the trade window opens");
  endTrade(st, { back: true });
  check(!st.trade && e.phase === "gate" && !!gc() && gc().choices.some((c) => /^Trade with them again/.test(c.label)) && st.cards.filter((c) => c.visitorId === e.id).length === 1, "closing it brings back the gate card (Trade with them again)");
  check(gc() && gc().choices.some((c) => /^Hear their news/.test(c.label)), "the rest of their offers are still there");
  answer(st, /^Hear their news/);
  check(!!gc() && !gc().choices.some((c) => /^Hear their news/.test(c.label)), "what was done stays done");
  // Sent on their way: called back while still on the base's tile.
  answer(st, /^Send them on their way/);
  check(e.phase === "travel" && V.gateTalkBase(st, e) === h, "sent off but still at the gate: they can be called back");
  V.reopenGate(st, e);
  check(e.phase === "gate" && !!gc() && /call them back/.test(gc().text), "called back: the gate card again");
  answer(st, /^Send them on their way/);
  place(st, e, st.grid.within(h.tile, 1).find((t) => t !== h.tile));
  check(V.gateTalkBase(st, e) === null, "once they leave the tile, no calling back");
  // The map's selection card (ui/mapselect.js) and its handler.
  place(st, e, h.tile);
  e.phase = "gate";
  e.known = true;
  const sel = readFileSync(new URL("../src/ui/mapselect.js", import.meta.url), "utf8");
  check(/talkButton\(state, at\.ref\)/.test(sel) && /data-action="vis-gate"/.test(sel) && typeof VISITOR_ACTIONS["vis-gate"] === "function", "a selected traveller's card has Talk to them (vis-gate)");
  VISITOR_ACTIONS["vis-gate"](st, {}, { id: e.id });
  check(!!gc(), "vis-gate opens the card");
  clearCards(st);
}

// ======================================================================================
section("The autopilot");
{
  const st = world();
  tick(st, 24);
  clearCards(st);
  setAutopilot(st, true, "balanced");
  const h = hub(st);
  Object.assign(h.stock, { ammo: 800, scrap: 150 }); setFood(h, 250);
  h.stock.meds = 0;
  const m = V.spawnVisitor(st, "merchants", { spec: "general" });
  place(st, m, h.tile);
  m.goal = { kind: "base", baseId: h.id, tile: h.tile };
  m.phase = "travel";
  const meds0 = h.stock.meds, armory0 = h.armory.length;
  tick(st, 2);
  check(!st.trade && (h.stock.meds > meds0 || h.armory.length > armory0), `trades with the merchants when useful (meds ${meds0} → ${h.stock.meds}, armory ${armory0} → ${h.armory.length})`);
  check(st.log.slice(0, 30).some((l) => /Outsiders \(.+\) at /.test(l.text)), "and says so");
  // Raid warnings by style: Cautious pays a band it might not hold, Aggressive fights it.
  const pick = (style, size) => {
    const s2 = world();
    tick(s2, 24);
    clearCards(s2);
    const hb = hub(s2);
    Object.assign(hb.stock, { ammo: 500 }); setFood(hb, 300);
    const r = V.spawnVisitor(s2, "raiders", { size, power: 3.5 });
    place(s2, r, ringLand(s2, hb.tile, 2)[0]);
    r.goal = { kind: "base", baseId: hb.id, tile: hb.tile };
    r.path = planPath(s2, r.tile, hb.tile, false).path;
    tick(s2);
    const c = cardWith(s2, /^Outsider raiders/);
    if (!c) return "none";
    s2.governor = { personality: style };
    return [...c.choices].filter((x) => !(typeof x.disabled === "function" ? x.disabled(s2) : x.disabled)).sort((a, b) => b.ai(s2) - a.ai(s2))[0].label;
  };
  // A band of 12: the hub's prepared defence holds it at under 1.5× (a band of 9 no longer: the hub's knife and machete
  // hands fight by their Melee skill since melee-skill, world.js combatPower, so Cautious rightly prepares against 9).
  const cau = pick("cautious", 12), agg = pick("aggressive", 12), bal = pick("balanced", 3);
  console.log(`  a band of 12 at the hub: Cautious → ${cau}; Aggressive → ${agg}. A band of 3, Balanced → ${bal}`);
  check(/^Pay them off|^Talk/.test(cau), "Cautious pays (or talks)");
  check(/^Defend in person|^Prepare/.test(agg), "Aggressive fights or prepares");
  check(/^Hold|^Prepare/.test(bal), "Balanced does not pay a weak band");
}

// ======================================================================================
section("Determinism, save / load mid-visit, the timelapse");
{
  const ID_STEP = 1e6;
  const run = (n) => {
    let id0 = newId();
    while (id0 % ID_STEP) id0 = newId();
    const st = world(7);
    setAutopilot(st, true, "balanced");
    const lines = [];
    const unshift = st.log.unshift;
    st.log.unshift = function (...x) { for (const l of x) lines.push(`${l.hour} ${l.text}`); return unshift.apply(this, x); };
    while (day(st) <= n && !st.gameOver) tickHour(st);
    return { st, lines, id0, id1: newId() };
  };
  const A = run(70), B = run(70);
  check(digest(A) === digest(B), "the same seed, the same outsiders (two worlds in one process, ids from their own start)");
  check(V.visitorInfo(A.st).stats.raiders + V.visitorInfo(A.st).stats.merchants + V.visitorInfo(A.st).stats.explorers >= 5, "and some came");
  // Save on a day with outsiders on the map, load, play 30 more days each.
  const st = world(7);
  setAutopilot(st, true, "balanced");
  while ((day(st) < 30 || !st.visitors.length || st.cards.length) && day(st) < 120) tickHour(st);
  const on = st.visitors.length;
  const save = saveToString(st);
  const end = day(st) + 30;
  while (day(st) <= end && !st.gameOver) tickHour(st);
  const loaded = loadFromString(save); // after the original has played on: the saved id counter comes back with it
  check(loaded.visitors.length === on && loaded.visitorInfo.rng.state !== st.visitorInfo.rng.state, `saved with ${on} outsider${on === 1 ? "" : "s"} on the map (day ${day(loaded)}), loaded`);
  while (day(loaded) <= end && !loaded.gameOver) tickHour(loaded);
  const d = (s) => digest({ st: s, lines: [], id0: 0, id1: Number.MAX_SAFE_INTEGER });
  st.chronicle.ms = loaded.chronicle.ms = 0; // recording time (a clock), not the world
  check(d(st) === d(loaded) && saveToString(st) === saveToString(loaded), "the original and the loaded world end identical 30 days later");
  // The timelapse records them.
  const r = chronicleReader(st);
  let seen = 0;
  for (let t = 24; t <= st.hour; t += 24) seen += (r.frameState(t).visitors || []).length;
  check(seen > 0, `the timelapse frames carry the outsiders (${seen} sightings over ${day(st)} days)`);
  const caps = st.chronicle.events.filter((e) => /outside|merchant caravan/i.test(e.text));
  check(caps.length > 0 && st.chronicle.events.every((e, i) => i === 0 || e.h >= st.chronicle.events[i - 1].h), `captions for them (${caps.length}), still in time order`);
}

// ======================================================================================
section("UI: the Groups tab, alerts, the trade window extras");
{
  const st = world();
  tick(st, 24);
  clearCards(st);
  const h = hub(st);
  addBuilding(h, "radio"); h.radio = true;
  const kinds = [V.spawnVisitor(st, "raiders", { size: 7 }), V.spawnVisitor(st, "merchants"), V.spawnVisitor(st, "explorers", { sub: "scouts", hostile: false })];
  kinds.forEach((v, i) => { place(st, v, ringLand(st, h.tile, 2 + i)[0]); v.goal = i === 0 ? { kind: "base", baseId: h.id, tile: h.tile } : { kind: "site", tile: v.tile }; if (i === 0) v.path = planPath(st, v.tile, h.tile, false).path; });
  tick(st);
  const html = outsidersSection(st);
  check(!/undefined|NaN/.test(html) && /Raiders from outside/.test(html) && /Merchants from outside/.test(html) && /Travellers from outside/.test(html), "the Outsiders section lists all three, no undefined / NaN");
  const al = visitorAlerts(st);
  check(al.some((a) => a.kind === "outsiders" && a.tone === "danger") && al.every((a) => a.text && a.go && !/undefined|NaN/.test(a.text + a.tip)), `an alert for the raiders coming (${al.map((a) => a.text).join("; ")})`);
  const used = [...html.matchAll(/data-action="([^"]+)"/g)].map((x) => x[1]);
  const mainSrc = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const handled = new Set([...mainSrc.matchAll(/^\s{2}"?([a-z][\w-]*)"?\s*:\s*\(/gm)].map((x) => x[1]).concat(Object.keys(VISITOR_ACTIONS)));
  check(used.length > 0 && used.every((a) => handled.has(a)), `every data-action handled (${[...new Set(used)].join(", ")})`);
  check(/VISITOR_ACTIONS/.test(mainSrc), "main.js registers the handlers");
  // The trade window's extras.
  const m = kinds[1];
  place(st, m, h.tile); m.goal = { kind: "base", baseId: h.id, tile: h.tile }; m.phase = "travel"; m.declined = false;
  tick(st);
  const ctx = tradeContext(st);
  check(ctx && /from outside the state/.test(visitorTradeHead(st, ctx)) && /vis-attack/.test(visitorTradeButtons(st, {}, ctx)) && (() => { const u = {}; VISITOR_ACTIONS["vis-attack"](st, u, { id: String(m.id), base: String(h.id) }); return !!u.ask && u.ask.action === "vis-attack-yes" && u.ask.kind === "rob"; })(), "the trade window: header, Rob button and its confirmation (the confirmation box: ui/confirm.js)");
  // Every vis-* handler runs without throwing.
  const ui = {};
  let threw = 0;
  for (const [k, fn] of Object.entries(VISITOR_ACTIONS)) {
    try { fn(st, ui, { id: String(kinds[0].id), base: String(h.id) }); } catch (err) { threw++; console.log(`  ${k}: ${err.message}`); }
  }
  check(threw === 0, "every handler runs");
}

// ======================================================================================
section(`${days} days per autopilot style without NaN (seed ${seed})`);
for (const style of ["balanced", "cautious", "aggressive"]) {
  const st = world();
  setAutopilot(st, true, style);
  let maxOn = 0, nan = null, neg = null;
  while (day(st) <= days) {
    if (st.gameOver) { st.gameOver = false; } // the world goes on after the holdout falls
    tickHour(st);
    maxOn = Math.max(maxOn, (st.visitors || []).length);
    if (st.hour % 24 === 0) {
      nan = nan || nanIn({ visitors: st.visitors, info: { ...st.visitorInfo, rng: 0 }, stock: st.bases.map((b) => b.stock) });
      for (const v of st.visitors) for (const [k, q] of Object.entries(v.stock)) if (q < 0) neg = `${v.name} ${k} ${q}`;
      for (const v of st.visitors) if (!(v.size >= 1) || v.tile == null) neg = neg || `${v.name} size ${v.size} tile ${v.tile}`;
    }
  }
  const s = V.visitorInfo(st).stats;
  console.log(`  ${style}: ${s.raiders} raider bands, ${s.merchants} merchant caravans, ${s.explorers} explorer parties; at most ${maxOn} on the map; ${s.raidsOnYou} raids on you, ${s.raidsOnGroups} on groups, ${s.robbed} robberies, ${s.sites} sites searched, ${s.trades} trades with you, ${s.groupTrades} with groups, ${s.intel} intel reports, ${s.sheltered} sheltered, ${s.paid} paid off, ${s.left} left, ${s.wiped} broken or wiped out; merchant reputation ${Math.round(V.merchantRep(st))}`);
  check(!nan, `no NaN (${nan || "none"})`);
  check(!neg, `no negative stock or empty parties (${neg || "none"})`);
  check(s.raiders >= Math.floor((days - 30) / 35) && s.merchants >= Math.floor(days / 20) && s.explorers >= Math.floor(days / 14), "all three kinds came");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
