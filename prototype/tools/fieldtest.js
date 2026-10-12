// Field rules (scripted cases): zombie speed in battle, Heat for teams that stand still (build-up, decay, trouble by
// Heat and danger), trip plans (presets run in order, ETA and rations for the whole plan, "come home" conditions,
// cards on finds), the radio rule (no orders out of contact except through the team's cards) and the battle's
// end-turn confirmation. Usage: node tools/fieldtest.js [seed]
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { createWorld, tickHour, hub, atBase, addCard, survivorById, makeSurvivor } from "../src/sim/world.js";
import {
  launchExpedition, planPath, partyTile, partyMembers, partyCapacity, cargoLoad, awaitOrders, orderMove, tileLabel, waterPerHour,
  TEAM_INTEL_EVERYWHERE,
} from "../src/sim/parties.js";
import { queueEstimate, startOrder, contactable, queueText, besideWater, FETCH_WATER_HOURS } from "../src/sim/orders.js";
import { createBattle, registerCombatHandler } from "../src/sim/combat.js";
import { searchHour, extract } from "../src/sim/scavenge.js";
import {
  heatGain, heatInfo, fieldHeatHour, troubleChance, tileDanger, heatPreview, HEAT_DECAY, stationaryActivity, CAMP_HEAT,
} from "../src/sim/fieldheat.js";
import { PRESETS, estimatePlan, commandable, stepsToOrders, nearbySites, CHECKIN_HOURS } from "../src/sim/plans.js";
import { hiveDistance } from "../src/sim/hives.js";
import { seasonOfDay, thirstFactor, THIRST } from "../src/sim/weather.js";
import { NEEDS } from "../src/sim/needs.js";
import { waterIn, RAW } from "../src/sim/water.js";
import { endTurnDecision, requestEndTurn, setConfirmEnd, unitsWithActions, cui } from "../src/ui/combat.js";

const SEED = Number(process.argv[2] || 42);
let fails = 0, passed = 0;
const check = (ok, msg) => { if (ok) passed++; else { fails++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);
const note = (s) => console.log(`  ${s}`);

function mk(seed = SEED) {
  const state = createWorld({ seed, factionCount: 7 });
  state.started = true;
  state.autoCombat = true;
  Object.assign(hub(state).stock, { water: 400, fuel: 100, meds: 20, ammo: 300, parts: 10, scrap: 100 }); setFood(hub(state), 400);
  return state;
}
const crewOf = (state, n) => atBase(state, hub(state).id).slice(0, n).map((s) => s.id);
const choiceOk = (state, c) => !(typeof c.disabled === "function" ? c.disabled(state) : c.disabled);
// A land tile d..d2 tiles from the hub that can be reached on foot (and is not a base), matching `filter`.
function tileNear(state, d, d2, filter = () => true) {
  const h = hub(state).tile;
  return state.tiles.find((t) => {
    const dist = state.grid.distance(h, t.id);
    return dist >= d && dist <= d2 && t.terrain !== "water" && !state.bases.some((b) => b.tile === t.id) && filter(t) && planPath(state, h, t.id, false);
  })?.id ?? null;
}
// A team standing on `tile` doing `task` (placed there directly: the rules on the spot are what is tested).
function placeTeam(state, tile, n = 3, task = { type: "camp", hours: null }) {
  const res = launchExpedition(state, { memberIds: crewOf(state, n), dest: tileNear(state, 2, 6), mission: "move", stance: "normal", supplies: { food: 8, water: 8, ammo: 10 } });
  if (res.error) throw new Error(res.error);
  const p = res.party;
  Object.assign(p.supplies, { water: 40, wood: 300 }); setFood(p, 40); // plenty for the case (not carried weight that matters here); firewood keeps the camp fire lit (woodcutting.js campFireHour: with none it goes out)
  p.path = [tile]; p.idx = 0; p.dest = tile; p.progress = 0; p.orders = [];
  if (task) startOrder(state, p, task);
  else { p.phase = "waiting"; p.task = null; }
  return p;
}
// Plays the clock with a simple auto-player: event cards take "Continue…" or the first open choice, searches run
// 3 hours like simtest, battles resolve by the numbers. Returns the hours until `until` (or null).
function play(state, p, hours, { until = null, pick = null, log = [] } = {}) {
  for (let i = 0; i < hours; i++) {
    tickHour(state);
    if (state.engagement) { if (!state.engagement.approach) state.engagement.approach = "normal"; if (state.engagement.hours < 3) searchHour(state); else extract(state); }
    let guard = 0;
    while (state.cards.length && guard++ < 20) {
      const c = state.cards.shift();
      log.push(c.title);
      const ch = (pick && pick(c)) || c.choices.find((x) => /^(Continue|Carry on|Take all)/.test(x.label) && choiceOk(state, x)) || c.choices.find((x) => choiceOk(state, x)) || c.choices[0];
      ch.resolve(state);
    }
    if (until && until()) return i + 1;
  }
  return null;
}
const home = (state, p) => !state.parties.includes(p);

// ======================================================================
section("Zombie speed in battle: 3 tiles an action, 4 for the strong (power 5+), survivors 5 (C-10)");
{
  const state = mk();
  const ids = crewOf(state, 3);
  registerCombatHandler("fieldtest", () => {});
  for (const [power, want] of [[1, 3], [3.5, 3], [5, 4], [7, 4]]) {
    const b = createBattle(state, { tile: hub(state).tile, baseId: hub(state).id, fighterIds: ids, enemy: { kind: "zombies", count: 6, power }, ambush: null, canRetreat: false, handler: "fieldtest" });
    const z = b.units.filter((u) => u.kind === "zombie");
    check(z.length && z.every((u) => u.mob === want), `power ${power} zombies move ${want} (got ${[...new Set(z.map((u) => u.mob))].join("/")})`);
    check(b.units.filter((u) => u.side === "player").every((u) => u.mob === 5), "survivors move 5");
  }
  state.combat = null;
}

// ======================================================================
section("Heat: builds while a team stands still, faster with a camp, in a city, near a hive, by night; falls on the move");
{
  const state = mk();
  const quietT = tileNear(state, 4, 14, (t) => (t.terrain === "plains" || t.terrain === "forest") && t.infection < 0.1 && !t.road);
  const cityT = state.tiles.find((t) => t.terrain === "city")?.id;
  const hiveT = state.tiles.find((t) => t.terrain !== "water" && hiveDistance(state, t.id) === 1)?.id;
  const p = placeTeam(state, quietT, 3, { type: "camp", hours: null });
  check(stationaryActivity(p) === "camp", "a camping team counts as standing still");
  const day = (h) => { state.hour = Math.floor(state.hour / 24) * 24 + h; };
  day(12);
  const camp = heatGain(state, p).gain;
  // The camp danger model (fieldheat.js CAMP_HEAT): camped 0.3 + 0.12 a person + the fire by day 0.5.
  const campWant = CAMP_HEAT.presence + 3 * CAMP_HEAT.person + CAMP_HEAT.fireDay;
  check(Math.abs(camp - campWant) < 1e-9, `quiet countryside camp by day, 3 people, fire lit: +${campWant.toFixed(2)} an hour (got ${camp.toFixed(2)})`);
  const waitG = heatGain(state, p, "waiting").gain;
  check(Math.abs(waitG - 1) < 1e-9 && waitG < camp, `waiting: +1.0 an hour, half a camp (got ${waitG.toFixed(2)})`);
  check(heatGain(state, p, "camp", 23).gain > camp && heatGain(state, p, "waiting", 23).gain < waitG, "at night a camp fire carries further, waiting in the dark less");
  p.stance = "stealthy";
  check(heatGain(state, p).gain < camp, "stealthy stance: less Heat");
  p.stance = "normal";
  if (cityT != null) {
    const c = placeTeam(state, cityT, 3, { type: "camp", hours: null });
    check(heatGain(state, c).gain > camp * 1.7, `a city camp builds Heat faster (${heatGain(state, c).gain.toFixed(1)} vs ${camp.toFixed(1)})`);
    check(tileDanger(state, c).danger > tileDanger(state, p).danger * 2, `a city is more dangerous to stay in (${tileDanger(state, c).danger.toFixed(2)} vs ${tileDanger(state, p).danger.toFixed(2)})`);
    c.members.forEach((id) => { survivorById(state, id).location = { kind: "base", baseId: hub(state).id }; });
    state.parties.splice(state.parties.indexOf(c), 1);
  }
  if (hiveT != null) {
    const hv = placeTeam(state, hiveT, 3, { type: "camp", hours: null });
    check(heatGain(state, hv).gain > camp * 1.9, `next to a hive: ×2 (${heatGain(state, hv).gain.toFixed(1)})`);
    hv.members.forEach((id) => { survivorById(state, id).location = { kind: "base", baseId: hub(state).id }; });
    state.parties.splice(state.parties.indexOf(hv), 1);
  }
  // Build-up hour by hour through the real hourly path (no trouble: the road's conflict cooldown is kept on).
  p.heat = 0;
  let expect = 0;
  for (let i = 0; i < 10; i++) {
    p.lastConflict = state.hour + 1;
    expect = Math.min(100, expect * (1 - CAMP_HEAT.settle) + heatGain(state, p, "camp", state.hour + 1).gain); // a camp settles
    tickHour(state);
    state.cards.length = 0;
  }
  check(Math.abs(p.heat - expect) < 1e-6, `10 hours of camp: Heat ${p.heat.toFixed(1)} as summed (${expect.toFixed(1)})`);
  check(p.heat > 8 && p.heat < 40, `a night's camp in a quiet spot stays low (Heat ${p.heat.toFixed(1)})`);
  const info = heatInfo(state, p);
  check(/Heat \d+\/100/.test(info.text) && /Chance of trouble/.test(info.text) && !/NaN|undefined/.test(info.text), "the panel text explains the risk");
  // Moving on: Heat falls 8 an hour.
  const before = p.heat;
  const away = tileNear(state, 8, 14);
  orderMove(state, p, away);
  p.lastConflict = state.hour + 1;
  tickHour(state);
  state.cards.length = 0;
  check(p.phase !== "out" || Math.abs(p.heat - Math.max(0, before - HEAT_DECAY)) < 1e-6, `on the move Heat falls ${HEAT_DECAY} an hour (${before.toFixed(1)} → ${p.heat.toFixed(1)})`);
  // At a base: none.
  p.path = [hub(state).tile]; p.idx = 0; p.phase = "waiting"; p.dest = hub(state).tile;
  fieldHeatHour(state, p, addCard);
  check(p.heat === 0, "at one of your bases there is no Heat");
}

// ======================================================================
section("Trouble by Heat and danger: a quiet night is mostly safe, days next to a city are not");
{
  check(troubleChance(0, 1) === 0 && troubleChance(50, 1) < troubleChance(100, 1) && troubleChance(100, 0.2) < troubleChance(100, 1), "the hourly chance grows with Heat and with danger");
  check(Math.abs(troubleChance(100, 1) - 0.12) < 1e-9, "12% an hour at Heat 100 and danger 1");
  // Monte Carlo with the real hourly rule (cooldowns, halving) on fixed tiles.
  const runs = (state, tile, hours, n = 300) => {
    const p = placeTeam(state, tile, 3, { type: "camp", hours: null });
    let any = 0, total = 0;
    for (let k = 0; k < n; k++) {
      p.heat = 0; p.heatTrouble = null; p.lastConflict = null; p.eventHour = null;
      let c = 0;
      const t0 = state.hour;
      for (let h = 0; h < hours; h++) {
        state.hour = t0 + h;
        const card = fieldHeatHour(state, p, () => {});
        if (p.heatTrouble === state.hour) c++;
        if (card) { p.phase = "task"; delete p.conflictResume; }
        state.cards.length = 0;
      }
      state.hour = t0;
      if (c) any++;
      total += c;
    }
    p.members.forEach((id) => { survivorById(state, id).location = { kind: "base", baseId: hub(state).id }; });
    state.parties.splice(state.parties.indexOf(p), 1);
    return { any: any / n, mean: total / n };
  };
  for (const seed of [SEED, 7]) {
    const state = mk(seed);
    state.hour = Math.floor(state.hour / 24) * 24 + 20; // camp from 20:00
    const quietT = tileNear(state, 4, 16, (t) => (t.terrain === "plains" || t.terrain === "forest") && t.infection < 0.1 && !t.road && !state.factions.some((f) => f.bases.some((b) => state.grid.distance(b, t.id) <= 6)));
    const cityT = state.tiles.find((t) => t.terrain === "city" && t.infection > 0.3)?.id;
    const q = runs(state, quietT, 10);
    const q3 = runs(state, quietT, 72);
    const c1 = runs(state, cityT, 10);
    const c3 = runs(state, cityT, 72);
    note(`seed ${seed}: quiet night ${Math.round(q.any * 100)}% · quiet 3 days ${Math.round(q3.any * 100)}% (mean ${q3.mean.toFixed(1)}) · city night ${Math.round(c1.any * 100)}% · city 3 days ${Math.round(c3.any * 100)}% (mean ${c3.mean.toFixed(1)} troubles)`);
    check(q.any < 0.05, `a night (10h) in a quiet spot: trouble under 5% (${(q.any * 100).toFixed(1)}%)`);
    check(c3.any > 0.9 && c3.mean >= 1.5, `three days in a city: trouble nearly always, more than once on average (${(c3.any * 100).toFixed(0)}%, ${c3.mean.toFixed(1)})`);
    check(q3.mean < c3.mean / 2, "staying in the countryside is much safer than in a city");
    const pv = heatPreview(state, { owner: "player", members: crewOf(state, 3), path: [cityT], idx: 0, stance: "normal", heat: 0 }, "camp", 72, state.hour);
    check(pv.risk > 0.9 && pv.heat === 100, "the planner's look-ahead agrees: a city camp for days is asking for trouble");
  }
  // An encounter while camping uses the conflict cards and the team goes back to its camp afterwards.
  const state = mk();
  const cityT = state.tiles.find((t) => t.terrain === "city" && t.infection > 0.3).id;
  let p = placeTeam(state, cityT, 3, { type: "camp", hours: null });
  let seen = 0, kinds = new Set(), bad = 0, lost = 0;
  for (let k = 0; k < 400 && seen < 25; k++) {
    p.heat = 100; p.heatTrouble = null; p.lastConflict = null; p.eventHour = null;
    // Patched up between encounters: fights by the numbers are as deadly as the battle map (breakoff.js), and this
    // checks the encounters, not how long a team lasts.
    for (const id of p.members || []) { const s = survivorById(state, id); if (s && s.alive) s.health = 100; }
    if (p.phase !== "task" || !p.task) startOrder(state, p, { type: "camp", hours: null });
    state.cards.length = 0;
    const card = fieldHeatHour(state, p, addCard);
    if (!card) continue;
    seen++;
    kinds.add(card.title);
    check(card.kind === "conflict" && card.partyId === p.id && p.phase === "engaged", "trouble is a conflict card that halts the team");
    check(p.conflictResume === "task", "it remembers the camp");
    // Answer it with the first open choice; battles resolve by the numbers.
    play(state, p, 0);
    const c = state.cards.shift();
    // No fight if it can be helped: fights by the numbers are as deadly as the battle map now (breakoff.js), and a
    // team lost in the fifth encounter would end the count.
    if (c) { (c.choices.find((x) => choiceOk(state, x) && !x.fight) || c.choices.find((x) => choiceOk(state, x)) || c.choices[0]).resolve(state); }
    for (let g = 0; g < 6 && state.cards.length; g++) { const d = state.cards.shift(); (d.choices.find((x) => /^Carry on|^Wait here|^Continue/.test(x.label)) || d.choices.find((x) => choiceOk(state, x)) || d.choices[0]).resolve(state); }
    // A team lost in a fight (as deadly by the numbers as on the battle map, breakoff.js): the next one camps there.
    if (!state.parties.includes(p)) {
      lost++;
      for (const s of state.survivors) if (s.alive && s.location.kind === "base") s.health = 100;
      if (atBase(state, hub(state).id).length < 3) for (let n = 0; n < 3; n++) { const s = makeSurvivor(state); s.location = { kind: "base", baseId: hub(state).id }; state.survivors.push(s); }
      p = placeTeam(state, cityT, 3, { type: "camp", hours: null });
      continue;
    }
    if (p.phase === "out" && p.path.length <= 1) bad++;
  }
  check(seen >= 10, `trouble came (${seen} cards: ${[...kinds].join(", ")})`);
  check(bad === 0, `after trouble on the spot the team never sets off to "arrive" where it stands (${bad})`);
}

// ======================================================================
section("Plans: presets run in order and the team comes home");
for (const [preset, mission] of [["recon", "recon"], ["scavenge", "scavenge"], ["explore", "recon"], ["camp", "move"]]) {
  const state = mk();
  const dest = tileNear(state, 4, 8, (t) => t.loc && t.loot > 0.3 && t.loc.type !== "town");
  const steps = PRESETS[preset].steps(1);
  check(PRESETS[preset].mission === mission, `${preset}: mission ${mission}`);
  const res = launchExpedition(state, { memberIds: crewOf(state, 3), dest, mission, stance: "normal", supplies: { food: 12, water: 12, ammo: 20 }, plan: { preset, steps } });
  if (res.error) throw new Error(res.error);
  const p = res.party;
  const want = stepsToOrders(state, steps, dest).map((o) => o.type);
  check(JSON.stringify(p.orders.map((o) => o.type)) === JSON.stringify(want), `${preset}: the plan is the queue (${queueText(state, p)})`);
  const seq = [];
  const log0 = state.log.length;
  play(state, p, 24 * 6, { until: () => home(state, p) });
  for (const l of state.log.slice(0, state.log.length - log0).reverse()) {
    const m = /next order, (.+)\.$/.exec(l.text) || /next, (.+?) \(/.exec(l.text);
    if (m && l.text.includes(p.members.length ? "" : "")) seq.push(m[1]);
  }
  check(home(state, p), `${preset}: back home (${seq.join(" → ")})`);
  if (preset === "camp") check(seq[0] === "Rest 24h" && seq[seq.length - 1] === "Return home", `camp preset (Rest N days): rest, then home (${seq.join(" → ")})`);
  if (preset === "explore") check(seq[0].startsWith("Scavenge the best site") && seq[seq.length - 1] === "Return home", `explore: recon, then the nearby searches, then home (${seq.join(" → ")})`);
  if (preset === "recon" || preset === "scavenge") check(seq[seq.length - 1] === "Return home", `${preset}: then home`);
}
{
  // Nearby sites: richest first, a searched site is not picked again, and the target counts after a recon.
  const state = mk();
  const center = tileNear(state, 4, 8, (t) => t.loc);
  const list = nearbySites(state, { center, radius: 3 });
  check(list.every((s, i) => !i || list[i - 1].score >= s.score), "nearby sites come richest first (loot, danger, distance)");
  check(!nearbySites(state, { center, radius: 3, exclude: list.slice(0, 1).map((s) => s.tile) }).some((s) => list[0] && s.tile === list[0].tile), "an excluded (searched) site is not picked again");
}

// ======================================================================
section("ETA and rations for a whole plan match the trip");
{
  let matched = 0, total = 0;
  for (const seed of [SEED, 7, 11]) {
    for (const [mission, steps, vehicle] of [
      ["move", [{ kind: "camp", hours: 24 }, { kind: "home" }], false],
      ["recon", [{ kind: "survey" }, { kind: "wait", hours: 4 }, { kind: "home" }], false],
      ["move", [{ kind: "wait", hours: 3 }, { kind: "home" }], true],
      ["recon", [{ kind: "camp", hours: 8 }, { kind: "survey" }, { kind: "home" }], true],
    ]) {
      const state = mk(seed);
      const dest = tileNear(state, 5, 9, (t) => !t.loc && planPath(state, hub(state).tile, t.id, vehicle));
      const v = vehicle ? state.vehicles.find((x) => x.loc.kind === "base") : null;
      if (v) { v.fuel = 30; v.condition = 100; }
      const ids = crewOf(state, 3);
      const est0 = estimatePlan(state, { memberIds: ids, dest, vehicle: !!v, stance: "normal", fuel: v ? v.fuel : 0, mission, steps });
      check(est0 && est0.returns && est0.food === Math.ceil((3 * est0.total) / 24) && est0.water === est0.food, `${mission} + ${steps.length} steps: rations cover the whole plan (${est0 && est0.food} for ${est0 && est0.total}h)`);
      // The plan weighed with what the team packs (food by type: the items it would take, parties.js packedSupplies).
      const supplies = { food: est0.food + 2, water: est0.water + 2, ammo: 10 };
      const est = estimatePlan(state, { memberIds: ids, dest, vehicle: !!v, stance: "normal", fuel: v ? v.fuel : 0, mission, steps, supplies });
      const res = launchExpedition(state, { memberIds: ids, dest, mission, stance: "normal", vehicleId: v ? v.id : null, supplies, plan: { preset: "custom", steps } });
      const p = res.party;
      p.nightPlan = "push"; // the plan times the march (nightmarch.js: making camp at 22:00 is the player's choice of hours, not a slower road)
      // The team panel's queue estimate agrees with the planner at launch.
      const q = queueEstimate(state, p);
      const qsum = est.hoursOut + q.reduce((s, x) => s + (x.hours ?? 0), 0);
      check(qsum === est.total, `the queue estimate after launch matches the planner (${qsum} vs ${est.total})`);
      const t0 = state.hour;
      // Road event cards take their first plain choice (like etatest) and their delays are counted; the plan's own
      // report cards change nothing here and are dropped.
      let cards = 0, delay = 0;
      for (let i = 0; i < 24 * 5 && !home(state, p); i++) {
        p.lastConflict = state.hour + 1; state.hordes.length = 0;
        tickHour(state);
        if (p.roadblock && p.roadblock.hour === state.hour) delay += p.roadblock.mins / 60; // a road blockage (sim/roadblocks.js) is a delay like a card's, as in etatest
        for (let k = state.cards.length - 1; k >= 0; k--) {
          const c = state.cards[k];
          if (c.isOrders || c.planCard) { state.cards.splice(k, 1); continue; }
          state.cards.splice(k, 1);
          const before = p.progress;
          const ch = c.choices.find((x) => !x.uiAction && choiceOk(state, x));
          if (ch) ch.resolve(state);
          if (c.partyId === p.id) cards++;
          if (c.partyId === p.id && /^Armed strangers$/.test(c.title)) delay += 1; // a hold-up stops the team where it stands for the hour (wanderers.js)
          if (p.progress < before) delay += before - p.progress;
        }
        if (state.combat) state.combat = null;
      }
      const took = state.hour - t0;
      total++;
      if (!delay) { check(took === est.total, `seed ${seed} ${mission}${v ? " by vehicle" : ""}: home in ${took}h, planned ${est.total}h${cards ? ` (${cards} card(s) without delay)` : ""}`); matched += took === est.total ? 1 : 0; }
      else note(`seed ${seed} ${mission}: road cards and blockages added ~${Math.round(delay)}h: ${took}h vs ${est.total}h planned`);
    }
  }
  note(`${matched}/${total} plans without road cards matched to the hour`);
}

// ======================================================================
section("Summer and heat waves: a plan's water at each day's thirst matches what the team drinks");
{
  let compared = 0;
  for (const seed of [SEED, 7, 11]) {
    for (const [mission, steps, preset] of [["move", PRESETS.camp.steps(1), "camp"], ["recon", [{ kind: "survey" }, { kind: "camp", hours: 24 }, { kind: "home" }], "custom"]]) {
      const state = mk(seed);
      // From the day before the first hot summer day: the camp runs into the heat wave.
      let hotD = null;
      for (let d = 0; d < 112 * 3 && hotD == null; d++) if (seasonOfDay(d).key === "summer" && thirstFactor(state, d) >= THIRST.heat) hotD = d;
      state.hour = (hotD - 1) * 24 + 8;
      const dest = tileNear(state, 4, 7, (t) => !t.loc);
      const ids = crewOf(state, 3);
      const est = estimatePlan(state, { memberIds: ids, dest, vehicle: false, stance: "normal", fuel: 0, mission, steps });
      check(est && est.water > est.food && est.water === Math.ceil(est.waterExact - 1e-9), `seed ${seed} ${preset} plan in summer: ${est.food} food, ${est.water} water (more water: summer and the heat wave)`);
      const res = launchExpedition(state, { memberIds: ids, dest, mission, stance: "normal", supplies: { food: est.food + 2, water: est.water + 4, ammo: 10 }, plan: { preset, steps } });
      const p = res.party;
      p.nightPlan = "push"; // as above: the plan's hours, not a night's camp the planner was never asked for
      let drunk = 0, delay = 0, events = 0;
      for (let i = 0; i < 24 * 6 && !home(state, p); i++) {
        p.lastConflict = state.hour + 1; state.hordes.length = 0;
        const mouths = partyMembers(state, p).length;
        const want = waterPerHour(state, p, partyMembers(state, p), state.hour + 1);
        // needs.js: people drink when their thirst gauge is low, so count the gauges with the water carried.
        const thirst = () => ids.reduce((a, id) => a + (state.survivors.find((x) => x.id === id).thirst ?? 100), 0) / NEEDS.water;
        const before = p.supplies.water + (p.cargo.supplies.water || 0) + thirst();
        tickHour(state);
        const after = home(state, p) ? before - want : p.supplies.water + (p.cargo.supplies.water || 0) + thirst();
        if (Math.abs(before - after - want) > 1e-9) events++;
        if (!home(state, p) && p.phase === "engaged") events++; // held up an hour by people met on the road (wanderers.js)
        if (mouths !== ids.length || (!home(state, p) && partyMembers(state, p).length !== ids.length)) events++; // someone met on the road joined (or left): more or fewer mouths than planned
        drunk += want;
        for (let k = state.cards.length - 1; k >= 0; k--) {
          const c = state.cards[k];
          state.cards.splice(k, 1);
          if (c.isOrders || c.planCard) continue;
          const b = p.progress;
          const ch = c.choices.find((x) => !x.uiAction && choiceOk(state, x));
          if (ch) ch.resolve(state);
          if (p.progress < b) delay += b - p.progress;
        }
        if (state.combat) { state.combat = null; events++; }
      }
      if (delay || events) { note(`seed ${seed} ${preset}: road events (${Math.round(delay)}h delay, ${events} odd hours): not compared`); continue; }
      compared++;
      check(home(state, p) && Math.abs(drunk - est.waterExact) < 1e-6, `seed ${seed} ${preset}: drank ${drunk.toFixed(2)} water, planned ${est.waterExact.toFixed(2)}`);
    }
  }
  check(compared >= 2, `summer plans compared to the trip (${compared})`);
}

// ======================================================================
section("Fetch water: a plan to a river or lake shore fills the containers and brings the water home");
{
  const state = mk();
  const h = hub(state);
  const shore = tileNear(state, 2, 9, (t) => besideWater(state, t.id));
  const dry = tileNear(state, 2, 6, (t) => !besideWater(state, t.id));
  check(shore != null && dry != null, "test setup: a shore and a dry tile in reach");
  const steps = [{ kind: "water" }, { kind: "home" }];
  const ids = crewOf(state, 3);
  const est = estimatePlan(state, { memberIds: ids, dest: shore, vehicle: false, stance: "normal", mission: "move", steps });
  check(est && est.returns && est.legs.some((l) => l.label === "Fetch water" && l.hours === FETCH_WATER_HOURS), `the plan counts ${FETCH_WATER_HOURS}h to fill the containers`);
  const res = launchExpedition(state, { memberIds: ids, dest: shore, mission: "move", stance: "normal", supplies: { food: est.food + 2, water: est.water + 2 }, plan: { preset: "custom", steps } });
  const p = res.party;
  check(p.orders[0] && p.orders[0].type === "water" && p.orders[0].at === shore, "the queue: Fetch water at the shore, then home");
  // water.js: the shore's water is un-purified (rawwater) in the cargo and the hub's stock; count both kinds.
  const w0 = waterIn(h.stock);
  let filled = 0;
  for (let i = 0; i < 24 * 5 && !home(state, p); i++) {
    p.lastConflict = state.hour + 1; state.hordes.length = 0;
    tickHour(state);
    filled = Math.max(filled, waterIn(p.cargo.supplies));
    for (let k = state.cards.length - 1; k >= 0; k--) { const c = state.cards[k]; state.cards.splice(k, 1); const ch = c.choices.find((x) => !x.uiAction && choiceOk(state, x)); if (!c.isOrders && !c.planCard && ch) ch.resolve(state); }
    if (state.combat) state.combat = null;
  }
  check(home(state, p) && filled >= 30, `home with ${Math.floor(filled)} water filled at the shore`);
  check(waterIn(h.stock) > w0 + filled * 0.5, `the hub's water went up (${Math.round(w0)} → ${Math.round(waterIn(h.stock))}, ${Math.round(h.stock[RAW] || 0)} of it un-purified)`);
  // Not on a dry tile: the order fails with a reason.
  const st2 = mk();
  const r2 = launchExpedition(st2, { memberIds: crewOf(st2, 2), dest: dry, mission: "move", stance: "normal", supplies: { food: 6, water: 6 } });
  const p2 = r2.party;
  for (let i = 0; i < 48 && p2.phase !== "waiting"; i++) { p2.lastConflict = st2.hour + 1; st2.hordes.length = 0; tickHour(st2); st2.cards.length = 0; if (st2.combat) st2.combat = null; }
  const msg = startOrder(st2, p2, { type: "water" });
  check(/only on a tile next to a river or lake/.test(msg) && !(p2.cargo.supplies.water > 0), `away from water: "${msg}"`);
}

// ======================================================================
section("Plan conditions: if … then come home");
{
  const mkTrip = (cond, steps = [{ kind: "camp", hours: 48 }, { kind: "home" }]) => {
    const state = mk();
    const dest = tileNear(state, 6, 10, (t) => !t.loc);
    const res = launchExpedition(state, { memberIds: crewOf(state, 3), dest, mission: "move", stance: "normal", supplies: { food: 12, water: 12, ammo: 10 }, plan: { preset: "custom", steps, conditions: cond } });
    return { state, p: res.party, dest };
  };
  { // hurt
    const { state, p } = mkTrip({ hurt: 50 });
    play(state, p, 3);
    const m = partyMembers(state, p)[0];
    m.health = 35;
    play(state, p, 1, { pick: (c) => c.choices.find((x) => x.label === "Continue home") });
    check(p.phase === "back", "someone hurt below 50: the team turns for home by itself");
    check(state.log.some((l) => /Following the plan's rule/.test(l.text)), "and says why in the log");
  }
  { // card choices: resume the plan
    const { state, p, dest } = mkTrip({ hurt: 50 });
    play(state, p, 3);
    partyMembers(state, p)[0].health = 35;
    let card = null;
    play(state, p, 1, { pick: (c) => { if (c.title === "Coming home") { card = c; return c.choices.find((x) => x.label === "Resume the plan"); } return null; } });
    check(card && card.planCard && card.choices.some((x) => x.label === "Stop and wait for orders"), "a 'Coming home' card reports it, with continue / resume / stop");
    check(p.phase === "out" && p.dest === dest && p.orders.some((o) => o.type === "camp"), `"Resume the plan" puts the rest back (${queueText(state, p)})`);
    play(state, p, 2);
    check(p.phase === "out" || p.phase === "task", "the same rule does not fire again on this trip");
  }
  { // food
    const { state, p } = mkTrip({ food: 2 });
    play(state, p, 2);
    setFood(p, 4); setFood(p.cargo, 0); setJarred(p, 0);
    play(state, p, 1, { pick: (c) => c.choices.find((x) => x.label === "Continue home") });
    check(p.phase === "back", "food below 2 days: home");
  }
  { // cargo full
    const { state, p } = mkTrip({ cargo: true });
    play(state, p, 2);
    p.cargo.supplies.scrap = Math.ceil(partyCapacity(state, p));
    setFood(p.cargo, 0);
    check(cargoLoad(p.cargo) >= partyCapacity(state, p) * 0.95, "cargo filled");
    play(state, p, 1, { pick: (c) => c.choices.find((x) => x.label === "Continue home") });
    check(p.phase === "back", "cargo full: home");
  }
  { // no condition: keeps going
    const { state, p } = mkTrip({});
    play(state, p, 3);
    partyMembers(state, p)[0].health = 20;
    play(state, p, 2);
    check(p.phase === "out" || p.phase === "task", "without a rule the hurt team carries on");
  }
}

// ======================================================================
section("Orders reach a team anywhere (TEAM-01: no radio-range limit); live intel everywhere while TEAM_INTEL_EVERYWHERE");
{
  const state = mk();
  const far = tileNear(state, 12, 20, (t) => !t.loc);
  const res = launchExpedition(state, { memberIds: crewOf(state, 2), dest: far, mission: "move", stance: "normal", supplies: { food: 10, water: 10 }, plan: { preset: "custom", steps: [{ kind: "camp", hours: 8 }, { kind: "home" }] } });
  const p = res.party;
  let out = false;
  for (let i = 0; i < 48 && !out; i++) { p.lastConflict = state.hour + 1; tickHour(state); state.cards.length = 0; out = !p.radioLive && p.phase === "out" && state.grid.distance(partyTile(p), hub(state).tile) >= 2; }
  if (check(out, "the team left radio range on its way")) {
    check(commandable(state, p), "out of radio range on the road: orders allowed");
    check(contactable(p), "…and it counts as in reach for every order screen");
    check(TEAM_INTEL_EVERYWHERE ? p.sightNow.length > 0 && p.sightNow.every((id) => state.live.has(id)) : p.sightNow.length === 0, `out of radio range: its sightings reach the map live only with TEAM_INTEL_EVERYWHERE (${TEAM_INTEL_EVERYWHERE})`);
    const back = tileNear(state, 2, 4, (t) => !t.loc);
    const msg = startOrder(state, p, { type: "move", tile: back });
    check(p.phase === "out" && p.path[p.path.length - 1] === back, `a redirect out of radio range takes (${msg})`);
    check(!commandable(state, { ...p, kind: "convoy" }), "a convoy still takes no team orders");
  }
  // A team holding out of radio range raises no repeated check-in cards: it can be ordered at any time.
  const s2 = mk();
  const t = tileNear(s2, 12, 20, (x) => !x.loc);
  const w = placeTeam(s2, t, 2, null);
  awaitOrders(s2, w, "Arrived.");
  s2.cards.length = 0; // "Hold here": no card
  let got = null;
  for (let i = 0; i < CHECKIN_HOURS + 2 && !got; i++) { w.lastConflict = s2.hour + 1; tickHour(s2); got = s2.cards.find((c) => c.partyId === w.id && c.isOrders); for (const c of s2.cards.filter((c) => !c.isOrders)) s2.cards.splice(s2.cards.indexOf(c), 1); }
  check(!w.radioLive && !got && commandable(s2, w), `a held team out of radio range waits quietly, orderable (${got ? got.title : "no card"})`);
}

// ======================================================================
section("Cards on finds while following a plan: a horde, a rich site, supplies short of home");
{
  const state = mk();
  const dest = tileNear(state, 6, 10, (t) => !t.loc);
  const res = launchExpedition(state, { memberIds: crewOf(state, 3), dest, mission: "move", stance: "normal", supplies: { food: 12, water: 12 }, plan: { preset: "custom", steps: [{ kind: "camp", hours: 48 }, { kind: "home" }] } });
  const p = res.party;
  play(state, p, 2);
  state.hordes.push({ id: 99901, tile: partyTile(p), size: 40, role: "roam", path: [], bosses: 0 });
  let card = null;
  play(state, p, 1, { pick: (c) => { if (c.planCard) card = c; return null; } });
  check(card && card.title === "Horde spotted" && card.choices.some((x) => x.label === "Come home") && card.choices.some((x) => x.label.startsWith("Change the plan")), `a horde in sight raises a card (continue / change the plan / come home)`);
  state.hordes = state.hordes.filter((h) => h.id !== 99901);
  // A rich site in sight, not on the plan and not known to be rich at the hub (the team is moved next to one, away
  // from home: sites near your bases are not news).
  const site = state.tiles.find((t) => t.loc && t.terrain !== "water" && !t.hive && !state.bases.some((b) => state.grid.distance(b.tile, t.id) <= 5) && !state.factions.some((f) => f.bases.includes(t.id)) &&
    state.grid.within(t.id, 1).some((id) => id !== t.id && state.tiles[id].terrain !== "water"));
  if (site) {
    const next = state.grid.within(site.id, 1).find((id) => id !== site.id && state.tiles[id].terrain !== "water");
    p.path = [next]; p.idx = 0; p.dest = next; p.progress = 0;
    startOrder(state, p, { type: "camp", hours: 48 });
    site.loot = 0.95; state.knowledge[site.id] = null;
    card = null;
    play(state, p, 1, { pick: (c) => { if (c.planCard && c.title.startsWith("Rich site")) { card = c; return c.choices.find((x) => x.label === "Search it next"); } return null; } });
    check(card && p.orders[0] && p.orders[0].type === "move" && p.orders[0].tile === site.id && p.orders[1].mission === "scavenge", `a rich site raises a card; "Search it next" puts it at the front of the plan`);
  } else note("no site next to the team on this seed: rich-site card not checked");
  // Supplies short of the way home.
  setFood(p, 1); setFood(p.cargo, 0);
  card = null;
  play(state, p, 2, { pick: (c) => { if (c.title === "Supplies running low") card = c; return null; } });
  check(card && card.planCard, "food short of the way home raises a card");
}

// ======================================================================
section("Battle: Space asks once while units still have actions (U-18)");
{
  check(endTurnDecision({ left: 2, asked: false, confirm: true, key: "space" }) === "ask", "first Space with 2 units left: ask");
  check(endTurnDecision({ left: 2, asked: true, confirm: true, key: "space" }) === "end", "second Space: end");
  check(endTurnDecision({ left: 2, asked: false, confirm: true, key: "enter" }) === "end", "Enter: end at once");
  check(endTurnDecision({ left: 2, asked: false, confirm: true, key: "button" }) === "ask", "End turn button: asks too");
  check(endTurnDecision({ left: 0, asked: false, confirm: true, key: "space" }) === "end", "nobody has actions left: end");
  check(endTurnDecision({ left: 3, asked: false, confirm: false, key: "space" }) === "end", "confirmation switched off: end");
  const state = mk();
  registerCombatHandler("fieldtest2", () => {});
  state.combat = createBattle(state, { tile: hub(state).tile, baseId: hub(state).id, fighterIds: crewOf(state, 3), enemy: { kind: "zombies", count: 4, power: 1 }, ambush: null, canRetreat: false, handler: "fieldtest2" });
  const b = state.combat;
  setConfirmEnd(true);
  check(unitsWithActions(b) === 3, "3 units with actions");
  check(requestEndTurn(state, "space") === "ask" && b.phase === "player", "Space: the turn is not ended, the panel asks");
  check(requestEndTurn(state, "space") === "end" && b.phase !== "player", "Space again: the turn ends");
  state.combat = null;
}

console.log(`\n${fails ? `${fails} check(s) FAILED` : `All ${passed} checks passed.`}`);
process.exit(fails ? 1 : 0);
