// Choices before a raid (sim/raidplan.js; docs/suggestions-5.md #23): the side to come in from, a scout sent first,
// waiting for night. Headless checks on raid maps made as the browser makes them (createBattle with plan: true).
// Usage: node tools/raidapproachtest.js [worlds]   (default 40)
// - Entry side: every side a map offers puts the team (and its vehicle) on that edge, the same map otherwise.
// - The scout: its odds are the sim's formula (notice range, look, optics, Scouting); over many raids the share that
//   succeed matches the odds shown; a success marks the enemies within reach (ghosts) and the fog's memory, a failure
//   alerts every person of theirs and adds Heat; an hour passes either way.
// - Wait for night: by day the clock runs to 20:00, the battle is a night battle (b.night, the dark by the hour), the
//   raid's Heat starts at 0, the map is the same.
// - The AI playing your side closes the plan (scouts with a good scout) and plays the raid out; a battle without a
//   plan (setup.plan unset: tests, fights by the numbers) has none.
// - Going in from a side (enterFrom: the team placed on that edge, the plan closed, the battle on); Leave (callOff):
//   the battle ends at once, nobody hurt, nothing searched, a raid as called off (afterRaid: the team awaits orders,
//   no more hours), an assault as a retreat with everyone out.
// - A save keeps an open plan (and the scout's marks); the hour-by-hour search's scout and night.
import { createWorld, hub, atBase, isNight, hourOfDay } from "../src/sim/world.js";
import { launchExpedition } from "../src/sim/parties.js";
import { createBattle, autoPlayerTurn, runEnemyPhase, registerCombatHandler, finishCombat } from "../src/sim/combat.js";
import { raidEnemies, startScavenge } from "../src/sim/scavenge.js";
import { newItem } from "../src/sim/inventory.js";
import { planOf, planOpen, setEntry, sendScout, waitNight, goIn, enterFrom, callOff, botPlan, scoutChoices, scoutOdds, SCOUT, hoursToNight, engScout, engWaitNight, engScoutChoices } from "../src/sim/raidplan.js";
import { serializeState, deserializeState } from "../src/sim/save.js";

const N = Number(process.argv[2] || 40);
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log("FAIL:", msg); } };
registerCombatHandler("test", () => {});

const SITES = ["town", "farm", "gas", "police", "military", "city", "cabin", "truckstop"];
function raid(seed, siteType, opts = {}) {
  const state = createWorld({ seed, factionCount: 7 });
  const h = hub(state);
  const tile = state.tiles.find((t) => t.loc && t.loc.type === siteType && t.id !== h.tile) || state.tiles.find((t) => t.loc && t.id !== h.tile);
  if (opts.hour != null) state.hour += ((opts.hour - hourOfDay(state)) + 24) % 24;
  const crew = atBase(state, h.id).slice(0, 3);
  if (opts.kit) for (const s of crew) opts.kit(s);
  const res = launchExpedition(state, { memberIds: crew.map((s) => s.id), dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: opts.vehicle ? state.vehicles[0].id : null, supplies: { food: 6, water: 6, ammo: 40, meds: 2 } });
  if (res.error) return null;
  const p = res.party;
  p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
  const groups = raidEnemies(state, tile.id);
  const setup = { mode: "raid", tile: tile.id, partyId: p.id, canRetreat: true, ambush: null, handler: opts.handler || "test", enemy: { kind: "mixed", count: 1, power: 3, groups }, raid: { heat0: isNight(state) ? 0 : 5 }, context: {}, plan: opts.plan === false ? undefined : true };
  if (opts.building) setup.raid.building = opts.building;
  state.combat = createBattle(state, setup);
  return { state, p, tile, setup };
}
const mine = (b) => b.units.filter((u) => u.side === "player" && !u.off);
const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
// The map's cells (a gun safe is one of the containers it may stand in, and a door locked or not: locks.js by the hour).
const BOX = new Set(["gunsafe", "crate", "cabinet", "locker", "shelf", "counter"]);
const layout = (b) => b.cells.map((c) => (BOX.has(c.k) ? "box" : c.k === "vehicle" || c.k === "door" ? "open" : c.k)); // the team's vehicle moves with the entry; locks.js locks doors by the hour

// ---------- entry side ----------
{
  let sides = 0, maps = 0, buildingMaps = 0;
  for (let i = 0; i < N; i++) {
    const r = raid(9100 + i, SITES[i % SITES.length], { vehicle: i % 2 === 0 });
    if (!r) continue;
    const { state } = r;
    let b = state.combat;
    const P = planOf(b);
    ok(P && P.open, `seed ${i}: the raid opens with its plan`);
    if (!P) continue;
    maps++;
    if (b.raid.interior) buildingMaps++;
    ok(P.side === b.raid.zones[0].side, `seed ${i}: the plan's side is the entry zone's (${P.side} / ${b.raid.zones[0].side})`);
    ok(P.sides.length >= 1 && P.sides.includes(P.side), `seed ${i}: its ways in (${P.sides.join(", ")})`);
    const cells0 = layout(b);
    for (const side of P.sides) {
      const err = setEntry(state, side);
      ok(!err, `seed ${i}: setEntry ${side}: ${err}`);
      b = state.combat;
      sides++;
      ok(b.raid.zones[0].side === side && planOf(b).side === side, `seed ${i}: the entry zone is the ${side} one`);
      const us = mine(b);
      const ax = mean(us.map((u) => u.x)) / b.w, ay = mean(us.map((u) => u.y)) / b.h;
      const on = side === "west" ? ax < 0.25 : side === "east" ? ax > 0.75 : side === "north" ? ay < 0.25 : ay > 0.75;
      ok(on, `seed ${i}: the team starts on the ${side} edge (${ax.toFixed(2)}, ${ay.toFixed(2)})`);
      if (b.vehicle) { const z = b.raid.zones[0]; ok(Math.abs(b.vehicle.x - z.x0) <= 4 && Math.abs(b.vehicle.y - z.y0) <= 4, `seed ${i}: the vehicle waits at the ${side} zone`); }
      // The same site: the map's walls and buildings barely change (only the cells by the zones and the vehicle).
      const cells = layout(b);
      let diff = 0;
      const kinds = {};
      for (let k = 0; k < cells.length; k++) if (cells[k] !== cells0[k]) { diff++; kinds[`${cells0[k]}>${cells[k]}`] = (kinds[`${cells0[k]}>${cells[k]}`] || 0) + 1; }
      ok(cells.length !== cells0.length || diff === 0, `seed ${i}: the same map from the ${side} (${(diff / cells.length * 100).toFixed(1)}% of cells differ: ${JSON.stringify(kinds)})`);
      ok(planOpen(b), `seed ${i}: still planning after the side`);
    }
    ok(setEntry(state, "up") !== "", "a side that is not there is refused");
  }
  console.log(`Entry side: ${maps} maps (${buildingMaps} building maps), ${sides} sides tried`);
}

// ---------- the scout ----------
{
  // The formula: Stealth 4, Scouting 4, by day, guards: notice 7, look 8 → 0.5 + 0.06 + 0.08 = 0.64; binoculars +3 → 0.82.
  const r = raid(9300, "police");
  const s = r && atBase(r.state, hub(r.state).id)[0] || r && r.state.survivors[0];
  if (s) {
    s.skills.stealth = 4; s.skills.scouting = 4;
    const tool = s.gear.tool; s.gear.tool = null;
    const day = scoutOdds(s, { night: false, hour: 12, humans: true });
    ok(Math.abs(day.odds - 0.64) < 1e-9 && day.look === 8 && day.notice === 7, `scout odds by day: ${day.odds} look ${day.look} notice ${day.notice}`);
    const zed = scoutOdds(s, { night: false, hour: 12, humans: false });
    ok(zed.notice === 5 && Math.abs(zed.odds - 0.76) < 1e-9, `the dead notice at 5: ${zed.odds}`);
    const night = scoutOdds(s, { night: true, hour: 23, humans: true });
    ok(night.notice === 4 && night.look === 4 && Math.abs(night.odds - 0.58) < 1e-9, `at night (23:00): notice 4, look 4: ${night.odds}`);
    s.gear.tool = newItem("binoculars");
    const bino = scoutOdds(s, { night: false, hour: 12, humans: true });
    ok(bino.look === 11 && Math.abs(bino.odds - 0.82) < 1e-9, `binoculars: look 11, ${bino.odds}`);
    s.gear.tool = newItem("nvg");
    const nvg = scoutOdds(s, { night: true, hour: 23, humans: true });
    ok(nvg.look === 12 && nvg.odds > night.odds, `night vision: look 12, ${nvg.odds}`);
    s.gear.tool = tool;
  }
  let tries = 0, wins = 0, oddsSum = 0, revealed = 0, alertedOk = 0, failsN = 0, heatOk = 0, hourOk = 0, wounded = 0;
  for (let i = 0; i < N * 4; i++) {
    const r2 = raid(9400 + i, SITES[i % SITES.length], { hour: 8 + (i % 10) });
    if (!r2) continue;
    const { state } = r2;
    const b = state.combat;
    const best = scoutChoices(state, b)[0];
    if (!best) continue;
    const h0 = state.hour, heat0 = b.raid.heat;
    const err = sendScout(state);
    ok(!err, `scout ${i}: ${err}`);
    const nb = state.combat;
    const sc = planOf(nb).scout;
    tries++; oddsSum += sc.odds;
    ok(Math.abs(sc.odds - best.odds) < 1e-9, `scout ${i}: the best scout was sent (${sc.odds} / ${best.odds})`);
    if (state.hour === h0 + SCOUT.HOURS) hourOk++;
    ok(planOpen(nb), `scout ${i}: still planning after the scout`);
    if (sc.ok) {
      wins++;
      const cx = Math.floor(nb.w / 2), cy = Math.floor(nb.h / 2);
      const within = nb.units.filter((u) => u.side === "enemy" && !u.dead && !u.off && (u.f || 0) === 0 && Math.hypot(u.x - cx, u.y - cy) <= sc.reach);
      const marked = within.every((u) => nb.ghosts && nb.ghosts[u.id]);
      const memo = nb.seenMemo && nb.seenMemo[0] && nb.seenMemo[0].cells;
      if (marked && memo && memo.charCodeAt(cy * nb.w + cx) === 49 && sc.seen === within.length) revealed++;
      else ok(false, `scout ${i}: success marks ${within.length} within ${sc.reach} (marked ${marked}, memo ${!!memo})`);
    } else {
      failsN++;
      const people = nb.units.filter((u) => u.side === "enemy" && u.kind === "human" && !u.dead && !u.off);
      if (people.every((u) => u.aware)) alertedOk++;
      if (nb.raid.heat >= Math.min(100, heat0 + SCOUT.FAIL_HEAT) - 1e-9) heatOk++;
      if (sc.wound) wounded++;
    }
    ok(sendScout(state) !== "", `scout ${i}: one scout a raid`);
  }
  const rate = wins / Math.max(1, tries), exp = oddsSum / Math.max(1, tries);
  console.log(`Scout: ${tries} sent, ${wins} came back unseen (${(rate * 100).toFixed(1)}%; the odds shown averaged ${(exp * 100).toFixed(1)}%); ${revealed}/${wins} successes marked what was within reach; ${alertedOk}/${failsN} failures alerted everyone, ${heatOk}/${failsN} added Heat, ${wounded} scouts hurt; ${hourOk}/${tries} took an hour`);
  ok(tries >= N * 2, "enough scouts sent");
  ok(Math.abs(rate - exp) < 0.08, `success rate ${rate.toFixed(3)} matches the odds ${exp.toFixed(3)}`);
  ok(revealed === wins, "every success marks what is within reach");
  ok(alertedOk === failsN && heatOk === failsN, "every failure alerts them and adds Heat");
  ok(failsN === 0 || wounded > 0, "a failed scout is sometimes hurt");
  ok(hourOk === tries, "the scout takes an hour");
}

// ---------- wait for night ----------
{
  let waited = 0;
  for (let i = 0; i < N; i++) {
    const r = raid(9700 + i, SITES[i % SITES.length], { hour: 9 + (i % 9) });
    if (!r) continue;
    const { state, setup } = r;
    const b = state.combat;
    ok(!b.night && setup.raid.heat0 === 5, `night ${i}: a day raid to start with`);
    const n = hoursToNight(state), h0 = state.hour;
    const cells0 = layout(b);
    const err = waitNight(state);
    ok(!err, `night ${i}: ${err}`);
    const nb = state.combat;
    ok(state.hour === h0 + n && hourOfDay(state) === 20, `night ${i}: the clock ran ${n} hours to 20:00 (${hourOfDay(state)}:00)`);
    ok(nb.night === true && nb.hour === 20, `night ${i}: a night battle (night ${nb.night}, hour ${nb.hour})`);
    ok(setup.raid.heat0 === 0 && nb.raid.heat === 0, `night ${i}: the raid starts quiet (Heat ${nb.raid.heat})`);
    { const L = layout(nb), d = {}; L.forEach((k, j) => { if (k !== cells0[j]) d[`${cells0[j]}>${k}`] = (d[`${cells0[j]}>${k}`] || 0) + 1; }); ok(!Object.keys(d).length, `night ${i}: the same map at night (${JSON.stringify(d)})`); }
    ok(mine(nb).every((u) => u.sight <= Math.max(12, u.daySight)), `night ${i}: night sight`);
    ok(waitNight(state) !== "", `night ${i}: no second wait at night`);
    ok(planOf(nb).night && planOf(nb).night.hours === n, `night ${i}: the plan says so`);
    waited++;
  }
  console.log(`Wait for night: ${waited} raids waited for 20:00`);
}

// ---------- the AI playing your side; no plan ----------
{
  let played = 0, scouted = 0, overN = 0;
  for (let i = 0; i < Math.max(6, N / 4); i++) {
    const r = raid(9900 + i, SITES[i % SITES.length], { vehicle: i % 2 === 1, hour: 14 + (i % 6) });
    if (!r) continue;
    const { state } = r;
    const best = scoutChoices(state, state.combat)[0];
    botPlan(state, state.combat); // the battle screen's AI playing your side (ui/combat.js combatTick)
    const b = state.combat;
    ok(!planOpen(b), `bot ${i}: the plan is closed once the AI plays`);
    if (best && best.odds >= SCOUT.BOT_ODDS) { ok(!!planOf(b).scout, `bot ${i}: a scout of ${best.odds.toFixed(2)} is sent`); if (planOf(b).scout) scouted++; }
    let guard = 0;
    while (state.combat && !state.combat.over && guard++ < 200) { runEnemyPhase(state); if (state.combat.over) break; autoPlayerTurn(state); }
    played++;
    if (state.combat && state.combat.over) overN++;
  }
  console.log(`AI plays your side: ${played} raids, ${scouted} scouted first, ${overN} played out`);
  ok(overN === played, "every raid the AI played ended");
  const r0 = raid(9949, "farm", { hour: 12 });
  const b0 = r0.state.combat, h0 = r0.state.hour;
  autoPlayerTurn(r0.state);
  ok(r0.state.combat === b0 && !planOpen(b0) && !planOf(b0).scout && r0.state.hour === h0, "the battle AI elsewhere (headless, the autopilot) goes in as things are");
  const r = raid(9950, "town", { plan: false });
  ok(r && !planOf(r.state.combat), "a battle without plan: true has no plan");
  const r2 = raid(9951, "town");
  goIn(r2.state);
  ok(!planOpen(r2.state.combat), "Go in closes the plan");
}

// ---------- going in from a side; leaving ----------
{
  let entered = 0, left = 0;
  for (let i = 0; i < Math.max(6, N / 4); i++) {
    const r = raid(9970 + i, SITES[i % SITES.length], { vehicle: i % 2 === 0, hour: 10 + (i % 8) });
    if (!r) continue;
    const { state } = r;
    const P = planOf(state.combat);
    // Another side than the one the map was made with: the team is placed on that edge and the plan is closed.
    const side = P.sides.find((x) => x !== P.side) || P.side;
    const err = enterFrom(state, side);
    ok(!err, `enter ${i}: enterFrom ${side}: ${err}`);
    const b = state.combat;
    ok(b && !b.over && !planOpen(b) && planOf(b).side === side && b.raid.zones[0].side === side, `enter ${i}: in from the ${side}, the plan closed`);
    const us = mine(b);
    const ax = mean(us.map((u) => u.x)) / b.w, ay = mean(us.map((u) => u.y)) / b.h;
    ok(side === "west" ? ax < 0.25 : side === "east" ? ax > 0.75 : side === "north" ? ay < 0.25 : ay > 0.75, `enter ${i}: the team stands on the ${side} edge`);
    ok(enterFrom(state, side) !== "" && callOff(state) !== "", `enter ${i}: nothing to plan once in`);
    entered++;
  }
  for (let i = 0; i < Math.max(6, N / 4); i++) {
    const r = raid(9980 + i, SITES[i % SITES.length], { vehicle: i % 2 === 1, hour: 9 + (i % 8), handler: "scavenge" });
    if (!r) continue;
    const { state, p } = r;
    const hp0 = Object.fromEntries(mine(state.combat).map((u) => [u.sid, state.survivors.find((s) => s.id === u.sid).health]));
    if (i % 2 === 0) sendScout(state); // a scout first (an hour on the clock), then second thoughts
    const b = state.combat, P = planOf(b);
    ok(P.open, `leave ${i}: still planning before Leave`);
    const h0 = state.hour, hours = P.hours;
    const err = callOff(state);
    ok(!err, `leave ${i}: callOff: ${err}`);
    ok(b.over && !planOpen(b) && P.calledOff, `leave ${i}: the battle is over at once, called off`);
    const R = b.result && b.result.raid;
    ok(R && R.calledOff && R.hours === 0 && R.searched === 0 && b.result.outcome === "extracted", `leave ${i}: a raid called off: no hours on the site, nothing searched, everyone out (${JSON.stringify(R && { calledOff: R.calledOff, hours: R.hours, searched: R.searched })}, ${b.result && b.result.outcome})`);
    ok(!b.result.survivorsDead.length && Object.entries(hp0).every(([sid, hp]) => { const s = state.survivors.find((x) => x.id === Number(sid)); return s.alive && (P.scout && P.scout.sid === Number(sid) ? s.health >= hp - (P.scout.wound || 0) - 0.01 : s.health >= hp - 0.01); }), `leave ${i}: nobody hurt but a scout who was seen`);
    ok(R && R.vehicleKept === R.hadVehicle, `leave ${i}: the vehicle comes back with them`);
    finishCombat(state, b.setup, b.result); // scavenge.js afterRaid: the team turns back for orders, no more hours
    ok(!state.combat && state.hour === h0 && state.parties.includes(p) && p.phase !== "engaged", `leave ${i}: the team is out of the fight awaiting orders (phase ${p.phase}), the clock where it was (${hours} h spent before)`);
    left++;
  }
  console.log(`Going in from a side: ${entered} raids; Leave: ${left} raids called off`);
}

// ---------- saves ----------
{
  const r = raid(9960, "police", { hour: 11 });
  const { state } = r;
  sendScout(state);
  const P0 = planOf(state.combat);
  const loaded = deserializeState(JSON.parse(JSON.stringify(serializeState(state))));
  const P1 = planOf(loaded.combat);
  ok(P1 && P1.open && P1.side === P0.side && P1.scout && P1.scout.ok === P0.scout.ok && P1.rs === P0.rs, "a save keeps the open plan and the scout");
  ok(loaded.combat.setup.plan === P1, "the loaded battle's plan is its setup's");
  ok(JSON.stringify(loaded.combat.ghosts || {}) === JSON.stringify(state.combat.ghosts || {}), "a save keeps the scout's marks");
  ok(!waitNight(loaded) && loaded.combat.night, "a loaded plan still waits for night");
}

// ---------- the hour-by-hour search ----------
{
  let n = 0, okN = 0;
  for (let i = 0; i < N; i++) {
    const state = createWorld({ seed: 9970 + i, factionCount: 7 });
    const h = hub(state);
    state.hour += ((12 - hourOfDay(state)) + 24) % 24;
    const tile = state.tiles.find((t) => t.loc && t.id !== h.tile);
    const crew = atBase(state, h.id).slice(0, 3).map((s) => s.id);
    const res = launchExpedition(state, { memberIds: crew, dest: tile.id, mission: "scavenge", stance: "normal", supplies: { food: 6, water: 6, ammo: 40, meds: 2 } });
    if (res.error) continue;
    const p = res.party;
    p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
    startScavenge(state, p);
    const e = state.engagement;
    if (!e) continue;
    const heat0 = e.heat, best = engScoutChoices(state, p, e)[0];
    ok(!engScout(state, p), `engagement ${i}: scout`);
    n++;
    if (e.scout.ok) { okN++; ok(e.heat === Math.max(0, heat0 - SCOUT.ENG_HEAT), `engagement ${i}: a scout's success cools Heat`); }
    else ok(e.heat === Math.min(100, heat0 + SCOUT.ENG_FAIL_HEAT), `engagement ${i}: a scout seen stirs it up`);
    ok(Math.abs(e.scout.odds - best.odds) < 1e-9, `engagement ${i}: the best scout`);
    const before = state.hour, wait = hoursToNight(state);
    ok(!engWaitNight(state) && state.hour === before + wait && isNight(state), `engagement ${i}: waited ${wait} h for the dark`);
  }
  console.log(`Hour-by-hour search: ${n} scouted (${okN} unseen), each then waited for night`);
}

console.log(fails ? `\n${fails} FAILED` : "\nAll raid approach checks passed.");
process.exit(fails ? 1 : 0);
