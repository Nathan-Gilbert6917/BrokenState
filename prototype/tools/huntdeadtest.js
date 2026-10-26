// Hunt the dead (src/sim/deadhunt.js, issue #68, the heat epic #64 §6; the user's request 2026-10-26: "Killing zombies
// in the tile (add an order to hunt down zombies in a tile to reduce the overall threat level, when you encounter Them
// open a small raid map to attack or retreat in)", "No hunt raiders just hunt zombies").
// Usage: node tools/huntdeadtest.js [seed]
// - the encounter rate grows with the open ground's density and the stance (Stealthy < Normal < Lure), Scouting helps;
//   group sizes grow with the density and the stance; Lure adds noise on the tile
// - the order: offered and started on the team's tile (2–24 h, a stance), its label, its hours in the queue's estimate;
//   an encounter puts up the Attack / Retreat card and holds the hunt's clock
// - Attack: a small map (24 × 18, the tile's own land), played headless by the battle AI (defences.js fightNow); the
//   killed come off the tile's count, the ones left alive go back to the open ground
// - Retreat: made, nobody is drawn and the hunt goes on; failed, the fight anyway, caught out
// - the hunt ends with its hours, or stops when the team is hurt past the line; the estimate for the box
// - headless resolution the same odds (the same hash dice: the same encounters, two runs)
// - an AI group's hunt on its own land (the same pool), and the governor's pick
// - no Hunt raiders order anywhere
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setFood } from "./foodkit.js";
import { createWorld, hub, atBase, tickHour } from "../src/sim/world.js";
import { huntRuns, setAutopilot } from "../src/sim/autopilot.js";
import { launchExpedition, planPath, partyMembers } from "../src/sim/parties.js";
import { stripAll, newItem } from "../src/sim/inventory.js";
import { startOrder, taskHour, describeOrder, queueOrder } from "../src/sim/orders.js";
import { tileClass } from "../src/sim/placement.js";
import { openDead, tileDead, popCap, recentKills, noiseOf, deadBand, putBack, drawFromTile } from "../src/sim/deadpop.js";
import {
  DEAD_HUNT, encounterChance, groupMean, rollGroup, deadHuntEstimate, deadHuntProblem, retreatOdds, huntAbstract, aiHuntsDaily, govHuntPick, huntFight, huntRetreat,
} from "../src/sim/deadhunt.js";
import { battleSize } from "../src/sim/combat.js";
import { stepsToOrders, STEP_KINDS } from "../src/sim/plans.js";
import { askLand, landHtml, landModel, LAND_ACTIONS } from "../src/ui/landorder.js";
import { landPick, runTeamAction, teamTileMenu } from "../src/ui/teamctx.js";

const SEED = Number(process.argv[2] || 42);
const TRACE = process.argv.includes("--trace");
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else { failed++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);

function mk(seed = SEED) {
  const state = createWorld({ seed, factionCount: 5 });
  state.started = true; state.noWanderers = true; state.cards = [];
  state.hour = Math.floor(state.hour / 24) * 24 + 8;
  Object.assign(hub(state).stock, { water: 300, fuel: 100, meds: 20, parts: 10, scrap: 100 }); setFood(hub(state), 300);
  return state;
}
const homes = (state) => new Set(state.bases.map((b) => b.tile));
function tileOf(state, cls, min = 1) {
  const h = homes(state);
  return state.tiles.find((t) => t.terrain !== "water" && !h.has(t.id) && !t.hive && tileClass(state, t) === cls && openDead(state, t.id) >= min && planPath(state, hub(state).tile, t.id, false)) || null;
}
// A team of n with a rifle each, stood on `tile`, waiting.
function team(state, n, tile) {
  const h = hub(state);
  const crew = atBase(state, h.id).slice(0, n);
  for (const s of crew) { s.health = 100; }
  const dest = state.tiles.find((t) => t.terrain !== "water" && state.grid.distance(h.tile, t.id) === 2 && planPath(state, h.tile, t.id, false)).id;
  const res = launchExpedition(state, { memberIds: crew.map((s) => s.id), dest, mission: "move", stance: "normal", vehicleId: null, supplies: { food: 4, water: 4, ammo: 60 } });
  if (res.error) throw new Error(`launch: ${res.error}`);
  const p = res.party;
  p.path = [tile]; p.idx = 0; p.progress = 0; p.phase = "waiting"; p.orders = []; p.radioLive = true; p.dest = tile;
  state.cards = [];
  return p;
}

if (TRACE) { console.log(trace()); process.exit(0); }

section("Encounters by density and stance");
{
  const state = mk();
  const rural = tileOf(state, "rural"), town = tileOf(state, "town", 10), city = tileOf(state, "city", 30) || tileOf(state, "suburb", 20);
  check(rural && town && city, "a rural, a town and a city tile with the dead on their open ground");
  const pr = encounterChance(state, rural.id, "normal", 0), pt = encounterChance(state, town.id, "normal", 0), pc = encounterChance(state, city.id, "normal", 0);
  console.log(`  open ground: rural ${openDead(state, rural.id)}, town ${openDead(state, town.id)}, city ${openDead(state, city.id)}; an hour's chance ${pr.toFixed(2)} / ${pt.toFixed(2)} / ${pc.toFixed(2)}`);
  check(pr < pt && pt <= pc, "denser ground, more encounters");
  const ps = encounterChance(state, town.id, "stealthy", 0), pl = encounterChance(state, town.id, "lure", 0);
  check(ps < pt && pt < pl, `Stealthy ${ps.toFixed(2)} < Normal ${pt.toFixed(2)} < Lure ${pl.toFixed(2)}`);
  check(encounterChance(state, town.id, "normal", 10) > pt, "Scouting finds more");
  check(groupMean(state, rural.id, "normal") < groupMean(state, city.id, "normal"), "bigger groups on denser ground");
  check(groupMean(state, town.id, "stealthy") < groupMean(state, town.id, "normal") && groupMean(state, town.id, "normal") < groupMean(state, town.id, "lure"), "Stealthy smaller groups, Lure bigger");
  const all = drawFromTile(state, rural.id, 1e6);
  check(encounterChance(state, rural.id, "lure", 20) === 0 && groupMean(state, rural.id, "normal") === 0, "an empty open ground: nothing to meet");
  putBack(state, rural.id, null, all);
  let ok = true;
  for (let k = 0; k < 50; k++) { const n = rollGroup(state, town.id, "lure", [k]); if (n < 1 || n > DEAD_HUNT.SIZE.max || n > openDead(state, town.id)) ok = false; }
  check(ok, "a group is 1 to the most, never more than the open ground holds");
}

section("The order: started on the team's tile, a card at an encounter, Attack on a small map");
{
  const state = mk();
  const town = tileOf(state, "town", 15);
  const p = team(state, 4, town.id);
  check(!deadHuntProblem(state, p), "a fit team can hunt");
  const msg = startOrder(state, p, { type: "deadhunt", hours: 30, stance: "lure" });
  check(p.phase === "task" && p.task && p.task.type === "deadhunt", `started: ${msg}`);
  check(p.task.hours === DEAD_HUNT.HOURS.max && p.task.stance === "lure", "hours clamped to 24, the stance kept");
  check(/Hunt the dead 24h \(Lure\)/.test(describeOrder(state, p.task)), `labelled: ${describeOrder(state, p.task)}`);
  const n0 = noiseOf(state, town.id);
  let card = null, hours = 0;
  while (!card && hours < 24) { state.hour++; taskHour(state, p); hours++; card = state.cards.find((c) => c.deadHunt && c.partyId === p.id); }
  check(noiseOf(state, town.id) > n0, "Lure is loud: the tile's noise rises");
  check(!!card, `a group met within ${hours}h`);
  if (card) {
    check(card.choices.map((c) => c.label).join("/") === "Attack/Retreat", "the card: Attack or Retreat");
    const done = p.task.done;
    state.hour++; taskHour(state, p);
    check(p.task.done === done && state.cards.filter((c) => c.deadHunt).length === 1, "the hunt's clock waits while the card is up, no second group");
    const n = p.task.enc.n, open0 = openDead(state, town.id), all0 = tileDead(state, town.id), k0 = recentKills(state, town.id);
    state.cards.splice(state.cards.indexOf(card), 1);
    let size = null;
    const t0 = Date.now();
    card.choices[0].resolve(state);
    console.log(`  a fight with ${n} of the dead played out in ${Date.now() - t0} ms; ${p.task ? `${p.task.kills} killed` : "the hunt ended"}`);
    const killed = all0 - tileDead(state, town.id);
    check(killed >= 0 && killed <= n + 8, `the killed came off the tile's count (${all0} → ${tileDead(state, town.id)})`);
    check(recentKills(state, town.id) >= k0 + Math.min(1, killed), "the kills are in the tile's kill memory");
    check(openDead(state, town.id) === open0 - killed, `the ones left alive are back on the open ground (${open0} → ${openDead(state, town.id)}, ${killed} killed)`);
    check(!p.task || !p.task.enc, "the encounter is over");
    size = battleSize(state, { layout: "deadHunt" });
    check(size[0] === 24 && size[1] === 18, "the small map: 24 × 18");
  }
}

section("Retreat: made, nobody drawn; failed, the fight, caught out");
{
  const state = mk();
  const town = tileOf(state, "town", 15);
  const p = team(state, 3, town.id);
  startOrder(state, p, { type: "deadhunt", hours: 8, stance: "stealthy" });
  const odds = retreatOdds(state, p, 4, "stealthy");
  check(odds > retreatOdds(state, p, 4, "lure") && retreatOdds(state, p, 2, "normal") > retreatOdds(state, p, 9, "normal"), `the escape odds: better Stealthy than Lure, better from fewer (${odds}%)`);
  partyMembers(state, p)[0].health = 50;
  check(retreatOdds(state, p, 4, "normal") < retreatOdds(state, p, 4, "normal") + 1 && retreatOdds(state, p, 4, "normal") < odds, "wounds slow the escape");
  partyMembers(state, p)[0].health = 100;
  let made = 0, caught = 0, tries = 0;
  for (let k = 0; k < 30 && (made === 0 || caught === 0); k++) {
    if (!p.task || p.task.type !== "deadhunt") startOrder(state, p, { type: "deadhunt", hours: 8, stance: "stealthy" });
    for (const s of partyMembers(state, p)) s.health = 100;
    p.task.enc = { n: 6, at: state.hour }; p.task.met++;
    const open0 = openDead(state, town.id), fled0 = p.task.fled;
    state.hour += 1;
    huntRetreat(state, p);
    tries++;
    if (p.task && p.task.fled > fled0) { made++; check(openDead(state, town.id) === open0, "made: the group stays out on the open ground, untouched"); }
    else { caught++; check(!p.task || !p.task.enc, "caught out: the fight was fought"); }
  }
  console.log(`  ${tries} retreats: ${made} made, ${caught} caught out`);
  check(made > 0 && caught > 0, "both outcomes come up");
}

section("The hunt ends with its hours, or stops hurt past the line");
{
  const state = mk();
  const rural = tileOf(state, "rural");
  const p = team(state, 2, rural.id);
  const all = drawFromTile(state, rural.id, 1e6); // nothing to meet
  startOrder(state, p, { type: "deadhunt", hours: 3 });
  for (let h = 0; h < 4 && p.phase === "task"; h++) { state.hour++; taskHour(state, p); }
  check(p.phase === "waiting", "3 hours and the team reports in");
  check(/no dead found/.test(JSON.stringify(state.cards)), "its summary: no dead found");
  putBack(state, rural.id, null, all);
  partyMembers(state, p)[0].health = 20;
  check(/too hurt/.test(deadHuntProblem(state, p)), "too hurt to start");
  const r = startOrder(state, p, { type: "deadhunt", hours: 4 });
  check(p.phase !== "task" || !p.task || p.task.type !== "deadhunt", `not started: ${r}`);
  // Hurt in a fight: the hunt stops and says why.
  partyMembers(state, p)[0].health = 100;
  const town = tileOf(state, "town", 15);
  p.path = [town.id]; p.dest = town.id;
  startOrder(state, p, { type: "deadhunt", hours: 8 });
  p.task.enc = { n: 3, at: state.hour };
  const s0 = partyMembers(state, p)[0];
  s0.health = DEAD_HUNT.HURT - 1; // hurt already, a fight then stops it
  huntFight(state, p, false);
  check(!p.task || p.task.type !== "deadhunt" || p.phase !== "task", "hurt past the line after a fight: the hunt stops");
  check(state.log.slice(0, 8).some((l) => /hunt (stops|is over)/.test(l.text)), "and says why");
}

section("The estimate for the box");
{
  const state = mk();
  const town = tileOf(state, "town", 15);
  const p = team(state, 4, town.id);
  const e2 = deadHuntEstimate(state, p, { hours: 2 }), e8 = deadHuntEstimate(state, p, { hours: 8 }), e24 = deadHuntEstimate(state, p, { hours: 24 });
  console.log(`  town, 4 people: 8h normal ${e8.encounters} groups of ~${e8.size}, ~${e8.kills} kills (${Math.round(e8.win * 100)}%)`);
  check(e2.encounters < e8.encounters && e8.encounters < e24.encounters && e8.kills > e2.kills, "more hours, more met and killed");
  const es = deadHuntEstimate(state, p, { hours: 8, stance: "stealthy" }), el = deadHuntEstimate(state, p, { hours: 8, stance: "lure" });
  check(es.encounters < e8.encounters && e8.encounters < el.encounters, "Stealthy meets fewer, Lure more");
  check(e24.kills <= openDead(state, town.id), "never more kills than the open ground holds");
  check(deadHuntEstimate(state, p, { hours: 1 }).hours === 2 && deadHuntEstimate(state, p, { hours: 99 }).hours === 24, "2–24 hours");
}

section("Headless: the same dice, the same hunt");
{
  // In a process of its own each time (ids are process-wide: a second world here would number its teams on).
  const run = () => execFileSync(process.execPath, [fileURLToPath(import.meta.url), String(SEED), "--trace"], { encoding: "utf8" }).trim();
  const a = run(), b = run();
  console.log(`  encounters (hour:size): ${a}`);
  check(a.length > 0 && a === b, "two runs of the same seed meet the same groups at the same hours");
}
function trace() {
  {
    const state = mk();
    const town = tileOf(state, "town", 15);
    const p = team(state, 4, town.id);
    startOrder(state, p, { type: "deadhunt", hours: 8 });
    const met = [];
    for (let h = 0; h < 12 && p.phase === "task"; h++) {
      state.hour++; taskHour(state, p);
      const c = state.cards.find((x) => x.deadHunt);
      if (c) { met.push(`${state.hour}:${p.task.enc.n}`); state.cards.splice(state.cards.indexOf(c), 1); c.choices[1].resolve(state); }
    }
    return met.join(",");
  }
}

section("AI parity: a group hunts its own land from the same pool");
{
  const state = mk();
  const f = state.factions.find((x) => x.alive && !x.outsider && x.bases.length && Array.isArray(x.people) && x.people.length >= 3);
  check(!!f, "a group with people");
  if (f) {
    const tile = f.bases[0];
    const all0 = tileDead(state, tile), open0 = openDead(state, tile);
    const people = f.people.filter((s) => s.alive !== false).slice(0, 4);
    const r = huntAbstract(state, f, tile, people, { hours: 12, stance: "lure" });
    console.log(`  ${f.name} at ${tile} (open ${open0}): ${r.met} met, ${r.kills} killed, ${r.lost} lost`);
    check(tileDead(state, tile) === all0 - r.kills && openDead(state, tile) === open0 - r.kills, "their kills off the tile's count, the rest back on the open ground");
    check(r.met > 0 || open0 === 0, "they meet the dead on their own land");
    // The daily hook: groups at medium or above hunt now and then.
    let hunts = 0;
    for (let d = 0; d < 6; d++) { state.hour += 24; aiHuntsDaily(state); hunts += state.factions.filter((x) => x.deadHunts && x.deadHunts.day === Math.floor(state.hour / 24) + 1).length; }
    console.log(`  6 days: ${hunts} group hunts`);
  }
}

section("The right-click menu, the team panel and the box: hours and stance");
{
  const state = mk();
  const town = tileOf(state, "town", 15);
  const p = team(state, 3, town.id);
  const menu = teamTileMenu(state, {}, p, town.id, { append: false });
  const it = menu.items.find((x) => x.key === "deadhunt");
  check(!!it && !it.disabled && it.group === "Land", "Hunt the dead… on the team's own tile (the Land group)");
  const other = state.tiles.find((t) => t.terrain !== "water" && state.grid.distance(town.id, t.id) === 2 && planPath(state, town.id, t.id, false));
  check(!teamTileMenu(state, {}, p, other.id, { append: false }).items.some((x) => x.key === "deadhunt"), "not on another tile");
  const lp = landPick(state, {}, { id: p.id, tile: town.id, key: "deadhunt", mode: "replace" });
  check(lp && lp.type === "deadhunt" && lp.hours === DEAD_HUNT.HOURS.def, "the menu item opens the box");
  const ui = {};
  check(askLand(state, ui, { id: String(p.id), tile: String(town.id), key: "deadhunt", mode: "replace" }, { via: "tc", ...lp }) && ui.landAsk.stance === "normal", "the box: Normal to start with");
  LAND_ACTIONS["land-sethours"](state, ui, { h: "1" });
  check(ui.landAsk.hours === 2, "2 hours at least");
  LAND_ACTIONS["land-sethours"](state, ui, { h: "12" });
  LAND_ACTIONS["land-stance"](state, ui, { stance: "lure" });
  const html = landHtml(state, ui);
  check(/Hunt the dead: how long, and how\?/.test(html) && /Lure/.test(html) && /group/.test(html) && /killed/.test(html), "it shows the stances and the groups and kills expected");
  const m = landModel(state, ui);
  check(m.all.length === DEAD_HUNT.HOURS.max - DEAD_HUNT.HOURS.min + 1 && m.lengths.length === DEAD_HUNT.HOURS.presets.length, "every length on the slider, the presets compared");
  let msg = null;
  LAND_ACTIONS["land-go"](state, ui, {}, null, { "tc-do": (d) => { msg = runTeamAction(state, {}, d); } });
  check(p.phase === "task" && p.task && p.task.type === "deadhunt" && p.task.hours === 12 && p.task.stance === "lure", `Hunt the dead 12h, Lure, under way (${msg})`);
  // The team panel's button (the xp-order route) and the queue.
  p.phase = "waiting"; p.task = null; p.orders = [];
  const ui2 = {};
  check(askLand(state, ui2, { id: String(p.id), type: "deadhunt" }, { via: "xp", type: "deadhunt", tile: town.id }), "the team panel's button opens the box too");
  check(!askLand(state, ui2, { id: String(p.id), type: "deadhunt", asked: "1" }, { via: "xp", type: "deadhunt", tile: town.id }), "not asked twice");
  startOrder(state, p, { type: "wait", hours: 2 });
  queueOrder(state, p, { type: "deadhunt", hours: 6, stance: "stealthy", at: town.id });
  check(p.orders.length === 1 && /Hunt the dead 6h \(Stealthy\)/.test(describeOrder(state, p.orders[0])), "queued: Hunt the dead 6h (Stealthy)");
  // The planner's step.
  const orders = stepsToOrders(state, [{ kind: "deadhunt", hours: 30, stance: "lure" }, { kind: "home" }], town.id);
  check(orders[0].type === "deadhunt" && orders[0].hours === 24 && orders[0].stance === "lure" && orders[0].at === town.id && STEP_KINDS.deadhunt, "the planner's step: Hunt the dead on the target");
}

section("The governor's pick; no Hunt raiders");
{
  const state = mk();
  const h = hub(state);
  const home = atBase(state, h.id);
  const pick = govHuntPick(state, h, home);
  console.log(`  the hub's tile is ${deadBand(state, h.tile).word}: ${pick.ids.length ? `${pick.ids.length} go` : pick.why}`);
  check(deadBand(state, h.tile).band >= DEAD_HUNT.GOV.band || /the dead here/.test(pick.why), "no hunt on a low tile");
  // The hub's tile filled to medium: the governor sends a team out on its own tile, and it hunts and comes home.
  putBack(state, h.tile, null, Math.ceil(popCap(state, h.tile) * 0.5));
  for (const s of home) { s.health = 100; s.leader = false; }
  setAutopilot(state, true, "balanced");
  const before = state.parties.length;
  huntRuns(state);
  const p = state.parties.find((x) => x.apDeadHunt);
  check(deadBand(state, h.tile).band >= DEAD_HUNT.GOV.band && !!p && state.parties.length === before + 1, `medium (${deadBand(state, h.tile).word}): a hunting team goes out (${p ? partyMembers(state, p).length : 0} people)`);
  huntRuns(state);
  check(state.parties.filter((x) => x.apDeadHunt).length === 1, "one at a time");
  if (p) {
    let hunted = false, met = 0;
    for (let k = 0; k < 40 && state.parties.includes(p); k++) {
      tickHour(state);
      if (p.task && p.task.type === "deadhunt") { hunted = true; met = Math.max(met, p.task.met || 0); }
      const c = state.cards.find((x) => x.deadHunt && x.partyId === p.id);
      if (c) { state.cards.splice(state.cards.indexOf(c), 1); const best = [...c.choices].sort((a, b) => b.ai(state) - a.ai(state))[0]; best.resolve(state); }
    }
    console.log(`  the governor's hunt: ${met} groups met; the team ${state.parties.includes(p) ? `is ${p.phase}` : "is home"}`);
    check(hunted, "the team hunts on the base's own tile");
    check(met > 0, "and meets the dead there (the governor answers the cards itself)");
    check(state.log.some((l) => /Hunting the dead: \d+ group/.test(l.text) || /slipped away|put down/.test(l.text)), "its hunt is in the log");
  }
  check(!Object.keys(DEAD_HUNT.STANCES).some((k) => /raider/i.test(k)) && !/raider/i.test(describeOrder(state, { type: "deadhunt" })), "zombies only: no Hunt raiders");
}

console.log(`\nhuntdeadtest: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
