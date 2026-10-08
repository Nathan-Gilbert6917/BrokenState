// Sounding the retreat (src/sim/combat.js soundRetreat, escapeOdds, retreatPlan, retreatAdvice): rule checks, then a
// paired measurement of the AI's retreat. Each battle is played twice from the same start (same team, same map, same
// dice), once with the AI never retreating and once with it free to sound the retreat in the given style, so the
// two runs are identical up to the turn the AI pulls out. Also the retreat by the numbers (src/sim/breakoff.js: the
// policies, the escape check, a team's fight, the card, autopilot and crews, save and load), and the measurement
// resolves each battle by the numbers too, to compare the two modes.
// Usage: node tools/retreattest.js [battles per matchup] [seed] [style|all]   (default 40, 7, all; RT_VERBOSE=1 lists
// every check)
import { setRounds, totalRounds } from "../src/sim/ammo.js"; // rounds by calibre
import { createWorld, makeSurvivor, hub, survivorById } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import {
  active, createBattle, autoPlayerTurn, runEnemyPhase, closeCombat, registerCombatHandler, combatAct, endPlayerTurn,
  soundRetreat, retreatPlan, retreatRefusal, escapeOdds, retreatAdvice, fightOutlook, evacAt, inEvac, RETREAT, RETREAT_AI, unitAt,
} from "../src/sim/combat.js";
import { newItem } from "../src/sim/inventory.js";
import "../src/sim/hives.js"; // the "hive" battle layout
import { combatAction, combatKey, retreatAskOpen, retreatConfirmHtml, cui } from "../src/ui/combat.js";
import { autoResolveCombat } from "../src/sim/combat.js";
import {
  RETREAT_POLICIES, POLICY_ORDER, BREAKOFF, STYLE_POLICY, escapeChanceByNumbers, wantsOut, rollFight, teamPolicy, policySource, policyFor,
  setTeamPolicy, crewPolicy, tacticalStyleFor, fightForecast, breakOff,
} from "../src/sim/breakoff.js";
import { launchExpedition, partyMembers, partyTile } from "../src/sim/parties.js";
import { triggerConflict } from "../src/sim/conflicts.js";
import { hordeCard } from "../src/sim/events.js";
import { makeHorde } from "../src/sim/hordes.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { Rng } from "../src/sim/rng.js";
import { retreatPolicyRow, fightForecastHtml } from "../src/ui/ui.js";

const N = Number(process.argv[2] || 40);
const seed = Number(process.argv[3] || 7);
const styleArg = process.argv[4] || "all";
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } if (process.env.RT_VERBOSE) console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); return ok; };
let last = null;
const handled = [];
registerCombatHandler("rt", (st, result, setup) => { last = result; handled.push({ outcome: result.outcome, setup }); });

function fighter(state, { weapon = "huntrifle", shooting = 9, scouting = 4 } = {}) {
  const s = makeSurvivor(state);
  s.skills.shooting = shooting;
  s.skills.scouting = scouting;
  s.traits = [];
  s.health = 100;
  s.gear.weapon = weapon ? newItem(weapon) : null;
  for (const slot of ["head", "armor", "arms", "legs"]) s.gear[slot] = null;
  s.location = { kind: "base", baseId: hub(state).id };
  state.survivors.push(s);
  return s;
}
// A battle on an open map with units placed by hand. Every cell made open, nobody near the strip unless placed.
function openBattle(state, crew, enemy, { canRetreat = true } = {}) {
  const h = hub(state);
  setRounds(h.stock, 200, crew.map((s) => s.gear.weapon && s.gear.weapon.key).filter(Boolean)); h.stock.meds = 4; // ammo.js: rounds for the crew's guns
  const b = (state.combat = createBattle(state, { tile: h.tile, baseId: h.id, fighterIds: crew.map((s) => s.id), enemy, ambush: null, canRetreat, handler: "rt", context: {} }));
  for (const c of b.cells) c.k = "open";
  b.losCache.fill(0);
  b.reach.fill(1);
  b.dark = false;
  for (const u of b.units) if (u.side === "enemy") { u.aware = true; u.x = -10; u.y = -10; }
  return b;
}
const place = (b, u, x, y) => { u.x = x; u.y = y; };
const foe = (b, i) => b.units.filter((u) => u.side === "enemy")[i];
const mine = (b, i) => b.units.filter((u) => u.side === "player")[i];
const park = (b, u) => { u.dead = true; u.x = -20; u.y = -20; }; // takes an enemy out of the picture

// 1. The order is offered and refused correctly.
{
  console.log("Offered and refused");
  const st = createWorld({ seed, factionCount: 4 });
  const crew = [fighter(st), fighter(st)];
  const b = openBattle(st, crew, { kind: "raiders", count: 2, power: 3 });
  check(retreatRefusal(b) === "", "a field battle with an evac strip offers the retreat on the player's turn");
  b.phase = "enemy";
  check(/enemy turn/.test(retreatRefusal(b)), "not during the enemy turn");
  b.phase = "player";
  st.combat = null;
  const noWay = openBattle(st, crew, { kind: "raiders", count: 2, power: 3 }, { canRetreat: false });
  check(/no way out/.test(retreatRefusal(noWay)) && /no way out/.test(soundRetreat(st)), "refused where the battle has no way out (a base defence without a strip)");
  check(!noWay.over, "a refused order changes nothing");
  st.combat = null;
  const fake = { over: false, raid: {}, evacCols: 0, phase: "player", units: [] };
  check(/extract/.test(retreatRefusal(fake)), "a raid says to extract instead");
  check(evacAt(noWay, 0, 5) === inEvac(noWay, 0) && evacAt(b, 1, 3) === inEvac(b, 1) && evacAt(b, 1, 3) && !evacAt(b, 2, 3), "the strip is read through inEvac (one helper to move it)");
}

// 2. Escape odds respond to distance, enemies next to them, shooters, wounds, armor, Scouting, night and carrying.
{
  console.log("Escape odds");
  const st = createWorld({ seed, factionCount: 4 });
  const crew = [fighter(st), fighter(st)];
  const b = openBattle(st, crew, { kind: "raiders", count: 3, power: 4 });
  const u = mine(b, 0), v = mine(b, 1);
  place(b, v, 1, 0);
  const [e0, e1, e2] = [foe(b, 0), foe(b, 1), foe(b, 2)];
  for (const e of [e0, e1, e2]) { e.weapon = "machete"; park(b, e); }
  const wake = (e, x, y) => { e.dead = false; place(b, e, x, y); };
  const sum = (o) => 100 + o.parts.reduce((a, p) => a + p[1], 0);
  place(b, u, 1, 6);
  const strip = escapeOdds(b, u);
  check(strip.safe && strip.chance === 100, `on the strip with nobody next to them: safe (${strip.chance}%)`);
  place(b, u, 6, 6);
  const calm = escapeOdds(b, u);
  check(calm.safe, "off the strip with no enemy close, in sight or next to them: safe");
  // A machete raider within two moves chases.
  wake(e0, 12, 6);
  const near = escapeOdds(b, u);
  place(b, u, 10, 6);
  const far = escapeOdds(b, u);
  check(!near.safe && near.chasers === 1 && far.chance === near.chance - (far.tiles - near.tiles) * RETREAT.PER_TILE, `farther from the strip, lower odds (${near.tiles} tiles ${near.chance}% → ${far.tiles} tiles ${far.chance}%)`);
  place(b, e0, 11, 6);
  const pin1 = escapeOdds(b, u);
  wake(e1, 11, 7);
  const pin2 = escapeOdds(b, u);
  check(pin1.pinned === 1 && pin2.pinned === 2 && pin1.chance - pin2.chance === RETREAT.PINNED, `each enemy next to them −${RETREAT.PINNED} (${far.chance}% → ${pin1.chance}% → ${pin2.chance}%)`);
  u.hp = 50;
  const p1 = escapeOdds(b, u).lostIfCaught;
  park(b, e1);
  const p0 = escapeOdds(b, u).lostIfCaught;
  check(p1 > p0, `caught next to two enemies, two blows: likelier to go down (${Math.round(p0 * 100)}% → ${Math.round(p1 * 100)}% at 50 health)`);
  u.hp = 100;
  park(b, e0);
  // A rifleman who sees them.
  e2.weapon = "huntrifle";
  wake(e2, 15, 6);
  const shot = escapeOdds(b, u);
  check(shot.shooters === 1 && !shot.safe && shot.chance === sum(shot) && shot.parts.some((p) => p[1] === -RETREAT.SHOOTER), `a rifleman who sees them −${RETREAT.SHOOTER} (${shot.chance}%)`);
  const fresh = shot.chance;
  u.hp = 25;
  const hurtOdds = escapeOdds(b, u);
  check(hurtOdds.chance === fresh + Math.round(-RETREAT.WOUNDS * 0.75),`wounds lower the odds (100 health ${fresh}% → 25 health ${hurtOdds.chance}%)`);
  check(hurtOdds.lostIfCaught > shot.lostIfCaught, `and a wounded unit that is caught may go down (${Math.round(shot.lostIfCaught * 100)}% → ${Math.round(hurtOdds.lostIfCaught * 100)}%)`);
  u.hp = 100;
  u.armLoad = 4; // the armour worn (u.load is the loaded round now: ammo.js)
  const heavy = escapeOdds(b, u);
  check(heavy.chance === fresh - 4 * RETREAT.ARMOR, `a plate carrier slows them (${heavy.chance}%)`);
  u.armLoad = 0;
  const sc0 = u.scouting;
  u.scouting = sc0 + 8;
  const scout = escapeOdds(b, u);
  check(scout.chance === fresh + 8 * RETREAT.SCOUTING, `Scouting helps (+8 Scouting: ${scout.chance}%)`);
  u.scouting = sc0;
  b.dark = true;
  const night = escapeOdds(b, u);
  b.dark = false;
  check(night.chance === Math.min(RETREAT.MAX, fresh + RETREAT.NIGHT), `night helps (+${RETREAT.NIGHT}: ${night.chance}%)`);
  // Carrying: a downed teammate next to them.
  place(b, v, 9, 6);
  v.down = true; v.hp = 0; v.bleed = 3;
  const carry = escapeOdds(b, u, v);
  check(carry.chance === sum(carry) && carry.chance < fresh - RETREAT.CARRY && carry.parts.some((p) => p[1] === Math.round(-carry.tiles * RETREAT.CARRY_TILE)), `carrying a downed teammate costs (${fresh}% → ${carry.chance}%)`);
  const plan = retreatPlan(b);
  check(plan.units.length === 1 && plan.units[0].carrying === v.id && plan.downed[0].by === u.name, "the plan has the one standing next to the downed carry them");
  const planLeave = retreatPlan(b, [v.id]);
  check(planLeave.units[0].carrying === null && planLeave.downed[0].left, "the confirm can leave someone behind instead");
  st.combat = null;
}

// 3. Sounding it: the strip leaves safely, carried allies get out, the caught are hit or left, and the handler sees "retreat".
{
  console.log("Sounding the retreat");
  let carriedOut = 0, carriedTries = 0, caught = 0, downedCaught = 0, safeOut = 0, safeTries = 0, handlerRetreats = 0, runs = 0, deadDropped = 0, dropped = 0;
  for (let i = 0; i < 60; i++) {
    const st = createWorld({ seed: seed + i, factionCount: 4 });
    const crew = [fighter(st), fighter(st), fighter(st), fighter(st)];
    const b = openBattle(st, crew, { kind: "zombies", count: 4, power: 3 });
    const [a, c, d, e] = [mine(b, 0), mine(b, 1), mine(b, 2), mine(b, 3)];
    place(b, a, 0, 3);          // on the strip
    place(b, c, 9, 6); place(b, d, 8, 6); // c carries d
    d.down = true; d.hp = 0; d.bleed = 3; d.stab = true;
    place(b, e, 12, 9); e.hp = 30; // wounded, a zombie next to them
    place(b, foe(b, 0), 13, 9); place(b, foe(b, 1), 10, 6); place(b, foe(b, 2), 16, 2); place(b, foe(b, 3), 17, 12);
    handled.length = 0;
    const plan = retreatPlan(b);
    check(soundRetreat(st) === "", "the order goes through");
    runs++;
    check(b.over && ["retreat", "defeat"].includes(b.result.outcome), "the battle ends as a retreat (or a defeat if nobody got out)");
    safeTries++; if (a.left && !a.down) safeOut++;
    carriedTries++;
    const cs = survivorById(st, c.sid), ds = survivorById(st, d.sid);
    if (b.result.retreatOrder.carried.includes(d.sid)) { if (ds.alive) carriedOut++; }
    else if (b.result.retreatOrder.dropped.includes(d.sid)) { dropped++; if (!ds.alive) deadDropped++; }
    if (b.result.retreatOrder.caught.includes(e.sid)) { caught++; if (e.down) downedCaught++; }
    check(plan.units.find((p) => p.id === c.id).carrying === d.id, "the plan had c carry d");
    void cs;
    closeCombat(st);
    if (handled.length && handled[0].outcome === "retreat") handlerRetreats++;
  }
  check(safeOut === safeTries, `the one on the strip always gets out (${safeOut}/${safeTries})`);
  check(carriedOut > 0 && carriedOut + dropped === carriedTries, `a stabilized teammate who is carried out lives (${carriedOut} carried out alive, ${dropped} dropped of ${carriedTries})`);
  check(dropped === 0 || deadDropped === dropped, `a dropped teammate is left behind (${deadDropped}/${dropped} died)`);
  check(caught > 0 && downedCaught > 0 && downedCaught < caught + 1, `the wounded unit next to a zombie is often caught, and sometimes dragged down (${caught} caught, ${downedCaught} down of 60)`);
  check(handlerRetreats >= runs * 0.9, `the outcome reaches the battle's handler as "retreat" (${handlerRetreats}/${runs})`);

  // A downed teammate dragged onto the strip goes with the last one out (per-unit Retreat).
  const st = createWorld({ seed, factionCount: 4 });
  const crew = [fighter(st), fighter(st)];
  const b = openBattle(st, crew, { kind: "raiders", count: 2, power: 3 });
  const [a, d] = [mine(b, 0), mine(b, 1)];
  place(b, a, 1, 4); place(b, d, 0, 4);
  d.down = true; d.hp = 0; d.stab = true;
  place(b, foe(b, 0), 16, 4); place(b, foe(b, 1), 16, 6);
  check(combatAct(st, { type: "retreat", unit: a.id }) === "" && b.over && b.result.outcome === "retreat", "the last one out by the strip ends it as a retreat");
  check(b.result.carriedIds.includes(d.sid) && survivorById(st, d.sid).alive, "a stabilized teammate lying on the strip is carried out with them");
  closeCombat(st);

  // The order from the UI path (combatAct) with the leave list.
  const st2 = createWorld({ seed: seed + 1, factionCount: 4 });
  const crew2 = [fighter(st2), fighter(st2)];
  const b2 = openBattle(st2, crew2, { kind: "raiders", count: 2, power: 3 });
  const [a2, d2] = [mine(b2, 0), mine(b2, 1)];
  place(b2, a2, 5, 4); place(b2, d2, 5, 5);
  d2.down = true; d2.hp = 0; d2.stab = true;
  place(b2, foe(b2, 0), 16, 4); park(b2, foe(b2, 1));
  check(combatAct(st2, { type: "soundRetreat", leave: [d2.id] }) === "" && b2.over, "combatAct sounds the retreat");
  check(!b2.result.retreatOrder.carried.length && b2.result.survivorsDead.includes(d2.sid), "someone the player chose to leave is left behind");
  closeCombat(st2);
}

// 4. The AI sounds the retreat in a hopeless fight, not in a winning one; Cautious earlier than Aggressive.
{
  console.log("AI retreat");
  const st = createWorld({ seed, factionCount: 4 });
  const crew = [fighter(st, { weapon: "pistol", shooting: 4 }), fighter(st, { weapon: "pistol", shooting: 4 })];
  const b = openBattle(st, crew, { kind: "soldiers", count: 6, power: 8 });
  b.units.filter((u) => u.side === "enemy").forEach((e, i) => place(b, e, 15, 2 + i));
  mine(b, 0).x = 3; mine(b, 0).y = 4; mine(b, 1).x = 3; mine(b, 1).y = 8;
  const o = fightOutlook(b);
  check(o.ratio < RETREAT_AI.aggressive.ratio && !!retreatAdvice(b, "aggressive"), `2 weak shooters against 6 elite soldiers: every style retreats (ratio ${o.ratio.toFixed(2)})`);
  autoPlayerTurn(st);
  check(b.over && b.result.outcome === "retreat" && b.result.retreatOrder.by === "ai", "autoPlayerTurn sounds it");
  closeCombat(st);
  const b2 = openBattle(st, [fighter(st, { shooting: 14 }), fighter(st, { shooting: 14 }), fighter(st, { shooting: 14 })], { kind: "zombies", count: 4, power: 2 });
  b2.units.filter((u) => u.side === "enemy").forEach((e, i) => place(b2, e, 15, 2 + i * 2));
  b2.units.filter((u) => u.side === "player").forEach((u, i) => place(b2, u, 3, 3 + i * 2));
  check(!retreatAdvice(b2, "cautious") && fightOutlook(b2).ratio > 1, `3 riflemen against 4 of the dead: not even Cautious retreats (ratio ${fightOutlook(b2).ratio.toFixed(2)})`);
  autoPlayerTurn(st, { style: "cautious" });
  check(!b2.over || b2.result.outcome === "victory", "and the AI fights on");
  st.combat = null;
  // A middling fight: Cautious goes, Aggressive stays.
  const b3 = openBattle(st, [fighter(st), fighter(st), fighter(st)], { kind: "raiders", count: 4, power: 4 });
  b3.units.filter((u) => u.side === "enemy").forEach((e, i) => place(b3, e, 15, 2 + i * 2));
  b3.units.filter((u) => u.side === "player").forEach((u, i) => place(b3, u, 3, 3 + i * 2));
  const ps = b3.units.filter((u) => u.side === "player");
  ps[0].down = true; ps[0].hp = 0; ps[0].bleed = 3;
  ps[1].hp = 45;
  const r3 = fightOutlook(b3);
  check(!!retreatAdvice(b3, "cautious") && !retreatAdvice(b3, "aggressive"), `one down, one hurt, against four raiders (ratio ${r3.ratio.toFixed(2)}, ${Math.round(r3.down * 100)}% down): Cautious retreats, Aggressive fights on`);
  b3.setup.layout = "baseDefence";
  check(!retreatAdvice(b3, "cautious"), "defending a base (with a way out) every style holds on as long as Aggressive");
  b3.setup.layout = undefined;
  // No retreat where there is no way out.
  st.combat = null;
  const b4 = openBattle(st, [fighter(st, { weapon: "pistol", shooting: 2 })], { kind: "soldiers", count: 6, power: 8 }, { canRetreat: false });
  check(!retreatAdvice(b4, "cautious"), "no retreat advice in a battle with no way out");
  st.combat = null;
}

// 5. Determinism: the same battle with the same dice plays out the same, retreat included.
{
  console.log("Determinism");
  const run = () => {
    const st = createWorld({ seed: seed + 3, factionCount: 4 });
    const crew = [fighter(st, { weapon: "pistol", shooting: 5 }), fighter(st, { weapon: "pistol", shooting: 5 }), fighter(st, { weapon: "pistol", shooting: 5 })];
    const h = hub(st);
    setRounds(h.stock, 200, ["pistol"]); h.stock.meds = 3; // ammo.js: 9mm for the pistols
    const b = (st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: crew.map((s) => s.id), enemy: { kind: "soldiers", count: 5, power: 7 }, ambush: null, canRetreat: true, handler: "rt", context: {} }));
    for (let g = 0; g < 60 && !b.over; g++) { autoPlayerTurn(st); runEnemyPhase(st); }
    const out = JSON.stringify([b.result && b.result.outcome, b.turn, b.log.map((l) => l.text), b.units.map((u) => [u.x, u.y, Math.round(u.hp), !!u.left, !!u.down, !!u.dead])]);
    st.combat = null;
    return out;
  };
  const a = run(), c = run();
  check(a === c, "two runs of the same battle are identical");
  check(/sound the retreat/.test(a), "and the AI sounded the retreat in it");
}

// 6. The battle panel's confirm (ui/combat.js): ask, the odds shown, leave someone, go; Esc and refusals.
{
  console.log("The confirm");
  const st = createWorld({ seed, factionCount: 4 });
  const crew = [fighter(st), fighter(st), fighter(st)];
  const b = openBattle(st, crew, { kind: "raiders", count: 2, power: 4 });
  const [a, c, d] = [mine(b, 0), mine(b, 1), mine(b, 2)];
  place(b, a, 1, 2); place(b, c, 8, 6); place(b, d, 7, 6);
  d.down = true; d.hp = 0; d.bleed = 3;
  place(b, foe(b, 0), 14, 6); place(b, foe(b, 1), 15, 9);
  combatAction(st, "cb-retreat", { v: "ask" });
  check(retreatAskOpen(b), "the button opens the confirm");
  const html = retreatConfirmHtml(b, retreatPlan(b, cui.retreatAsk.leave));
  check(!/undefined|NaN/.test(html), "the confirm has no undefined / NaN");
  check(/safe/.test(html) && /\d+%/.test(html) && html.includes(`carried by ${c.name}`) && html.includes(`carrying ${d.name}`), "it shows the odds per unit (safe on the strip, a percentage off it) and who carries whom");
  check(['data-v="go"', 'data-v="cancel"', 'data-v="toggle"'].every((k) => html.includes(k)), "with Sound the retreat, Keep fighting and a Leave button");
  combatAction(st, "cb-retreat", { v: "toggle", id: String(d.id) });
  const html2 = retreatConfirmHtml(b, retreatPlan(b, cui.retreatAsk.leave));
  check(cui.retreatAsk.leave.includes(d.id) && /left behind/.test(html2) && !html2.includes(`carrying ${d.name}`), "Leave takes the downed teammate off the carrier");
  combatKey(st, { code: "Escape" });
  check(!retreatAskOpen(b) && !b.over, "Esc closes it and nothing happens");
  combatKey(st, { code: "KeyR", shiftKey: true });
  check(retreatAskOpen(b), "Shift+R opens it");
  combatKey(st, { code: "Space" });
  check(retreatAskOpen(b) && !b.over && b.phase === "player", "Space does not end the turn while it is open");
  combatKey(st, { code: "Enter" });
  check(b.over && b.result.outcome === "retreat" && b.result.retreatOrder && b.result.retreatOrder.by === "player", "Enter gives the order: the battle ends as a retreat");
  check(b.summary.some((l) => /gets out|makes it out|caught/.test(l)), "the result's summary lists who got out and who was caught");
  closeCombat(st);
  const nb = openBattle(st, [fighter(st)], { kind: "raiders", count: 1, power: 4 }, { canRetreat: false });
  place(nb, foe(nb, 0), 14, 6);
  combatAction(st, "cb-retreat", { v: "ask" });
  check(!retreatAskOpen(nb) && /no way out/.test(cui.msg), "with no way out the button only says why");
  st.combat = null;
}

// ======================================================================================
// Retreat by the numbers (src/sim/breakoff.js): a fight resolved by the numbers broken off by the team's policy.
// ======================================================================================
function teamOut(st, n = 3, opts = {}) {
  const h = hub(st);
  Object.assign(h.stock, { food: 200, water: 200, ammo: 300, meds: 20 });
  const crew = [];
  for (let i = 0; i < n; i++) crew.push(fighter(st, opts));
  const dest = st.tiles.find((t) => t.terrain !== "water" && st.grid.distance(t.id, h.tile) === 3).id;
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest, mission: "move", stance: opts.stance || "normal", vehicleId: null, supplies: { ammo: 40, food: 6, water: 6 } });
  return res.party;
}
const numbersSetup = (p, enemy, extra = {}) => ({ tile: partyTile(p), partyId: p.id, enemy, ambush: null, canRetreat: true, handler: "rt", context: {}, ...extra });

// 7. The policies, and the escape check by the numbers agreeing with the tactical one.
{
  console.log("Retreat by the numbers: policies and the escape check");
  check(POLICY_ORDER.length === 4 && POLICY_ORDER.every((k) => RETREAT_POLICIES[k] && RETREAT_POLICIES[k].name && RETREAT_POLICIES[k].desc), "four policies: Never, When most are down, If losing, At first blood");
  const st = createWorld({ seed, factionCount: 4 });
  const crew = [fighter(st), fighter(st)];
  let same = 0, tried = 0, diff = "";
  for (let k = 0; k < 40; k++) {
    const b = openBattle(st, crew, { kind: k % 3 ? "raiders" : "zombies", count: 4, power: 4 });
    const u = mine(b, 0);
    place(b, u, st.rng.int(4, 9), st.rng.int(0, 12));
    u.hp = st.rng.int(20, 100); u.armLoad = st.rng.int(0, 4); u.scouting = st.rng.int(0, 10);
    b.dark = st.rng.chance(0.3);
    for (let i = 0; i < 4; i++) { const e = foe(b, i); if (st.rng.chance(0.25)) park(b, e); else { e.weapon = st.rng.pick(["machete", "huntrifle", "pistol"]); place(b, e, Math.min(17, u.x + st.rng.int(1, 6)), Math.max(0, Math.min(12, u.y + st.rng.int(-2, 2)))); if (unitAt(b, e.x, e.y) !== e) park(b, e); } }
    const t = escapeOdds(b, u);
    if (t.onStrip) { st.combat = null; continue; }
    tried++;
    const nb = escapeChanceByNumbers({ hp: u.hp, maxHp: u.maxHp, load: u.armLoad, scouting: u.scouting, mult: u.armor }, { tiles: t.tiles, pinned: t.pinned, shooters: t.shooters, chasers: t.chasers, night: !!(b.night || b.dark) });
    if (nb.chance === t.chance && nb.safe === t.safe && Math.abs(nb.lostIfCaught - t.lostIfCaught) < 1e-9) same++;
    else diff = `tactical ${t.chance}% (${JSON.stringify(t.parts)}) vs numbers ${nb.chance}% (${JSON.stringify(nb.parts)})`;
    st.combat = null;
  }
  check(tried >= 25 && same === tried, `the numbers' escape check is the tactical formula: the same odds and chance to go down when caught in ${same}/${tried} placed battles ${diff}`);
  const m = { hp: 80, maxHp: 100, load: 2, scouting: 3, mult: 1 };
  const e = { tiles: 4, pinned: 0, shooters: 2, chasers: 0, night: false };
  const base = escapeChanceByNumbers(m, e).chance;
  const at = (x) => escapeChanceByNumbers(m, { ...e, ...x }).chance;
  check(at({ vehicle: true }) === base + BREAKOFF.VEHICLE && at({ vehicle: "bike" }) === base + BREAKOFF.BIKE && at({ stealthy: true }) === base + BREAKOFF.STEALTHY && at({ night: true }) === base + RETREAT.NIGHT,
    `by the numbers a car close by (+${BREAKOFF.VEHICLE}), bikes (+${BREAKOFF.BIKE}), a stealthy stance (+${BREAKOFF.STEALTHY}) and night (+${RETREAT.NIGHT}) help (${base}% → ${at({ vehicle: true })}%, ${at({ stealthy: true })}%)`);
  check(at({ carrying: true }) === base - RETREAT.CARRY - Math.round(e.tiles * (RETREAT.CARRY_TILE - RETREAT.PER_TILE)) && at({ pinned: 1 }) === base - RETREAT.PINNED, `carrying a downed teammate and an enemy on them cost what they cost on the map (${at({ carrying: true })}%, ${at({ pinned: 1 })}%)`);
  check(escapeChanceByNumbers(m, { tiles: 4 }).safe && escapeChanceByNumbers(m, { tiles: 4 }).chance === 100, "nobody on them, shooting or chasing and nobody to carry: safe");
  // wantsOut: the policies' rules.
  const look = (o) => ({ turning: false, hit: 0, down: 0, badly: 0, n: 4, ...o });
  check(!wantsOut("never", look({ turning: true, down: 3, hit: 4, badly: 1 })), "Never never pulls out");
  check(wantsOut("blood", look({ hit: 1 })) && !wantsOut("losing", look({ hit: 1 })) && wantsOut("losing", look({ turning: true })) && wantsOut("losing", look({ down: 1 })), "At first blood pulls out at the first wound, If losing when it turns or anyone is down");
  check(!wantsOut("most", look({ down: 1, badly: 1 })) && wantsOut("most", look({ down: 2, badly: 1 })) && !wantsOut("most", look({ turning: true })), "When most are down: only with more than half of the team down or badly hurt");
}

// 8. The model: paired with Never, honoured, ordered by caution.
{
  console.log("Retreat by the numbers: the fight's rounds");
  const rng = new Rng(seed * 101 + 3);
  const stats = Object.fromEntries(POLICY_ORDER.map((k) => [k, { retreats: 0, winnable: 0, deaths: 0, wins: 0 }]));
  let paired = 0, prefix = 0, broke = 0;
  const M = 3000;
  for (let i = 0; i < M; i++) {
    const n = rng.int(2, 5);
    const members = [];
    for (let k = 0; k < n; k++) members.push({ id: k + 1, name: `M${k} X`, hp: rng.int(30, 100), maxHp: 100, mult: rng.pick([1, 0.85, 0.7]), load: rng.int(0, 3), scouting: rng.int(0, 8), medicine: rng.int(0, 8) });
    const model = { members, win: rng.range(0.1, 0.9), enemy: { kind: rng.pick(["raiders", "zombies", "mixed", "soldiers"]), count: rng.int(2, 30) }, ambush: rng.pick([null, "player", "enemy"]), night: rng.chance(0.3), vehicle: false, stealthy: false, capture: 0.5 };
    const at = rng.state;
    const runs = {};
    for (const k of POLICY_ORDER) { const r = new Rng(at); runs[k] = rollFight(r, model, k); }
    const never = runs.never;
    for (const k of POLICY_ORDER) {
      const r = runs[k];
      const s = stats[k];
      if (r.outcome === "victory") s.wins++;
      if (r.round != null) {
        s.retreats++; if (r.win) s.winnable++;
        broke++;
        if (r.hits.every((h, j) => never.hits[j] && never.hits[j].id === h.id && never.hits[j].raw === h.raw)) prefix++;
        s.deaths += r.run.left.length + r.run.carried.filter((c) => !c.lives).length;
      } else {
        s.deaths += r.members.filter((x) => x.down).length;
        if (JSON.stringify(r.hits) === JSON.stringify(never.hits) && r.outcome === never.outcome && r.killShare === never.killShare) paired++;
      }
    }
  }
  const unbroken = POLICY_ORDER.reduce((a, k) => a + (M - stats[k].retreats), 0);
  check(stats.never.retreats === 0, "Never never breaks off");
  check(paired === unbroken, `a fight that is not broken off plays out exactly as with Never (${paired}/${unbroken})`);
  check(prefix === broke, `a broken-off fight took the same wounds as Never up to that round (${prefix}/${broke})`);
  check(stats.blood.retreats >= stats.losing.retreats && stats.losing.retreats >= stats.most.retreats && stats.most.retreats > 0, `the more cautious the policy, the more it pulls out (blood ${stats.blood.retreats}, losing ${stats.losing.retreats}, most ${stats.most.retreats} of ${M})`);
  check(stats.losing.winnable / Math.max(1, stats.losing.retreats) <= 0.25, `If losing: at most a quarter of its retreats are from fights that would have been won (${stats.losing.winnable}/${stats.losing.retreats})`);
  for (const k of ["most", "losing", "blood"]) check(stats[k].deaths <= stats.never.deaths, `${RETREAT_POLICIES[k].name}: no more deaths than fighting it out (${stats.never.deaths} → ${stats[k].deaths} in ${M} fights)`);
  check(stats.blood.wins <= stats.losing.wins && stats.losing.wins <= stats.never.wins, `and it gives up wins (${stats.never.wins} → ${stats.losing.wins} → ${stats.blood.wins})`);
  // The hardest case: a big crowd of the dead, wounded runners (the dead close in and pin them).
  const mob = Object.fromEntries(POLICY_ORDER.map((k) => [k, 0]));
  for (let i = 0; i < 3000; i++) {
    const n = rng.int(2, 4);
    const members = [];
    for (let k = 0; k < n; k++) members.push({ id: k + 1, name: `M${k} X`, hp: rng.int(40, 100), maxHp: 100, mult: rng.pick([1, 0.9, 0.8]), load: rng.int(0, 2), scouting: rng.int(0, 6), medicine: rng.int(0, 4) });
    const model = { members, win: rng.range(0.15, 0.85), enemy: { kind: "zombies", count: rng.int(16, 40) }, ambush: rng.pick([null, "player", "enemy"]), night: rng.chance(0.3), vehicle: false, stealthy: false, capture: 0 };
    const at = rng.state;
    for (const k of POLICY_ORDER) {
      const r = rollFight(new Rng(at), model, k);
      mob[k] += r.round == null ? r.members.filter((x) => x.down).length : r.run.left.length + r.run.carried.filter((c) => !c.lives).length;
    }
  }
  check(["most", "losing", "blood"].every((k) => mob[k] <= mob.never), `against 16–40 of the dead, breaking off costs no extra lives either (fought out ${mob.never}, when most are down ${mob.most}, if losing ${mob.losing}, at first blood ${mob.blood})`);
}

// 9. A real fight broken off: escape checks, the carried and the left behind, partial losses, no loot, ammo.
{
  console.log("Retreat by the numbers: a team's fight");
  const st = createWorld({ seed, factionCount: 6 });
  const f = st.factions.find((x) => x.alive && x.bases.length);
  const seen = { retreat: 0, carriedLive: 0, carriedDied: 0, carriedTried: 0, medicSum: 0, left: 0, captured: 0, leftDead: 0, partial: 0, noLoot: 0, refund: 0, consistent: 0, zLeftDead: 0, zLeft: 0 };
  for (let i = 0; i < 260; i++) {
    const zombies = i % 4 === 3;
    const p = teamOut(st, 3, { shooting: 4, weapon: "pistol" });
    for (const s of partyMembers(st, p)) s.health = st.rng.int(35, 100);
    const enemy = zombies ? { kind: "zombies", count: 10, power: 3, name: "the dead" } : { kind: "raiders", count: 5, power: 5, factionId: f.id, name: "raiders" };
    const before = partyMembers(st, p).map((s) => s.id);
    const ammo0 = totalRounds(p.supplies) + totalRounds(p.cargo.supplies); // ammo.js: every round, any calibre
    const r = autoResolveCombat(st, numbersSetup(p, enemy, { retreatPolicy: i % 2 ? "most" : "losing" }));
    const ammo1 = totalRounds(p.supplies) + totalRounds(p.cargo.supplies);
    if (r.outcome === "retreat") {
      seen.retreat++;
      const ro = r.retreatOrder;
      if (ro && ro.by === "policy" && r.loot.gear.length === 0 && !Object.keys(r.loot.supplies).length) seen.noLoot++;
      if (r.enemiesKilled < enemy.count && r.enemiesLeft > 0) seen.partial++;
      if (ammo0 - ammo1 === r.ammoUsed && r.ammoUsed < Math.min(ammo0, 3 * 6) && ro.round < BREAKOFF.ROUNDS) seen.refund++;
      // Everyone is accounted for: home with the team, dead, or a prisoner.
      const ok = before.every((id) => { const s = survivorById(st, id); return !s.alive ? r.survivorsDead.includes(id) : s.location.kind === "captive" ? r.captured.includes(id) : partyMembers(st, p).includes(s); });
      if (ok) seen.consistent++;
      for (const id of r.carriedIds) { const s = survivorById(st, id); if (s && s.alive && s.health <= 15) seen.carriedLive++; }
      seen.carriedTried += ro.carried.length + 0;
      for (const id of ro.dropped) {
        const s = survivorById(st, id);
        if (zombies) { seen.zLeft++; if (!s.alive) seen.zLeftDead++; } else { seen.left++; if (s.alive && s.location.kind === "captive") seen.captured++; else if (!s.alive) seen.leftDead++; }
      }
    }
    // Clear the team away for the next fight.
    for (const s of partyMembers(st, p)) s.alive = false;
    st.parties = st.parties.filter((x) => x !== p);
    st.cards = [];
  }
  check(seen.retreat >= 40, `teams broke off ${seen.retreat} of 260 losing-prone fights`);
  check(seen.noLoot === seen.retreat, `a broken-off fight takes no loot and is marked as the policy's retreat (${seen.noLoot}/${seen.retreat})`);
  check(seen.partial === seen.retreat, `the enemy loses part of its people, not all (${seen.partial}/${seen.retreat})`);
  check(seen.consistent === seen.retreat, `everyone is home with the team, dead or a prisoner (${seen.consistent}/${seen.retreat})`);
  check(seen.refund >= seen.retreat * 0.5, `the rounds not fought do not use their ammo (${seen.refund}/${seen.retreat})`);
  check(seen.carriedLive > 0, `the downed are carried out, and come home barely alive (${seen.carriedLive})`);
  check(seen.left > 0 && seen.left === seen.captured + seen.leftDead && seen.captured > 0 && seen.leftDead > 0, `left to a group's people: taken prisoner or killed (${seen.captured} taken, ${seen.leftDead} killed of ${seen.left})`);
  check(seen.zLeft === seen.zLeftDead, `left to the dead: lost (${seen.zLeftDead}/${seen.zLeft})`);
  // The carried pull through at the tactical rate: 50% + 2% a point of the best medic's Medicine.
  const rng = new Rng(99);
  let live = 0, tries = 0;
  for (let i = 0; i < 3000; i++) {
    const members = [{ id: 1, name: "A a", hp: 1, mult: 1, load: 0, scouting: 0, medicine: 0 }, { id: 2, name: "B b", hp: 100, mult: 1, load: 0, scouting: 10, medicine: 10 }];
    const model = { members, win: 0.2, enemy: { kind: "raiders", count: 2 }, ambush: "player", night: true, vehicle: true, stealthy: true, capture: 0 };
    const r = rollFight(rng, model, "losing");
    if (r.round == null || !r.run.carried.length || r.run.carried[0].id !== 1) continue; // the medic carried out (downed too) is not the case measured
    tries++; if (r.run.carried[0].lives) live++;
  }
  check(tries > 100 && Math.abs(live / tries - 0.7) < 0.06, `carried out by a medic with Medicine 10: ${Math.round((live / Math.max(1, tries)) * 100)}% pull through (70% expected, ${tries} carried)`);
}

// 10. The conflict card: the policy offered, honoured, the forecast, loot only on victory.
{
  console.log("Retreat by the numbers: the conflict card");
  const st = createWorld({ seed, factionCount: 6 });
  const f = st.factions.find((x) => x.alive && x.bases.length && x.type !== "traders");
  const p = teamOut(st, 3, { shooting: 4, weapon: "pistol" });
  const card = triggerConflict(st, p, "ambush", f.id);
  st.cards = [];
  const fightCh = card.choices.find((c) => c.fight);
  check(!!fightCh && fightCh.fight.enemy && fightCh.fight.odds > 0, "the conflict card's fight choice carries the fight (odds, enemy, ambush) for the policy and forecast");
  const row = retreatPolicyRow(st, card);
  check(POLICY_ORDER.every((k) => row.includes(`data-action="retreat-policy" data-v="${k}"`)) && /data-v="never" class="active"/.test(row), "the card offers the four policies, Never by default for a player's team");
  const rng0 = st.rng.state;
  const fc0 = fightForecastHtml(st, card, fightCh);
  check(/If auto-resolved: Never: about \d+% to win, fought to the end/.test(fc0) && st.rng.state === rng0, `the forecast on the fight choice ("${fc0.replace(/<[^>]+>/g, "")}"), without touching the game's dice`);
  setTeamPolicy(st, p, "losing");
  const row2 = retreatPolicyRow(st, card);
  const fc1 = fightForecastHtml(st, card, fightCh);
  check(/data-v="losing" class="active"/.test(row2) && /If losing: about \d+% to win; if it turns, (nearly all|most|about half|few) get away/.test(fc1), `choosing If losing marks it and changes the forecast ("${fc1.replace(/<[^>]+>/g, "")}")`);
  check(!setTeamPolicy(st, p, "bogus") && p.retreatPolicy === "losing", "an unknown policy is refused");
  const fcN = fightForecast(st, p, partyMembers(st, p), { odds: 0.5, enemy: { kind: "raiders", count: 4 }, ambush: null }, "never");
  const fcB = fightForecast(st, p, partyMembers(st, p), { odds: 0.5, enemy: { kind: "raiders", count: 4 }, ambush: null }, "blood");
  check(Math.abs(fcN.win - 0.5) < 0.08 && fcB.win < fcN.win && fcB.retreat > 0.3 && fcB.deaths <= fcN.deaths, `the forecast: 50% fought out (${Math.round(fcN.win * 100)}%), At first blood wins less and pulls out often (${Math.round(fcB.win * 100)}% / ${Math.round(fcB.retreat * 100)}%), with no more deaths (${fcN.deaths.toFixed(2)} → ${fcB.deaths.toFixed(2)})`);
  // Honoured through the card: answer "Fight back" with At first blood until a fight is broken off.
  let gotRetreat = null, gotWin = null;
  for (let i = 0; i < 80 && (!gotRetreat || !gotWin); i++) {
    const q = teamOut(st, 3, i % 2 ? { shooting: 4, weapon: "pistol" } : { shooting: 11, weapon: "huntrifle" });
    setTeamPolicy(st, q, i % 2 ? "blood" : "never");
    const c = triggerConflict(st, q, "ambush", f.id);
    st.cards = [];
    const cargo0 = JSON.stringify(q.cargo.supplies);
    const pop0 = f.pop;
    c.choices.find((x) => x.fight).resolve(st);
    const after = st.cards.find((x) => x.title === "After the fight" && x.partyId === q.id);
    if (after && /broke off the fight/.test(after.text) && !gotRetreat) gotRetreat = { text: after.text, cargoSame: JSON.stringify(q.cargo.supplies) === cargo0 || !/Taken from the bodies/.test(after.text), pop: pop0 - f.pop };
    if (after && /You won/.test(after.text) && !gotWin) gotWin = after.text;
    st.cards = [];
  }
  check(!!gotRetreat && /You pulled back/.test(gotRetreat.text) && !/Taken from the bodies/.test(gotRetreat.text), `At first blood: the fight is broken off and nothing is looted ("${gotRetreat ? gotRetreat.text.slice(0, 160) : "none"}…")`);
  check(!!gotWin && /Taken from the bodies/.test(gotWin), "a fight won (Never) is looted as before");
  check(gotRetreat && gotRetreat.pop >= 0, `the group loses the people killed before the break (${gotRetreat ? gotRetreat.pop : "?"})`);
  // The horde's Fight: broken off between wounds by the policy, the horde only partly thinned.
  const hordeRun = (pol) => {
    const w = createWorld({ seed: seed + 1, factionCount: 4 });
    const q = teamOut(w, 3, { shooting: 6, weapon: "pistol" });
    setTeamPolicy(w, q, pol);
    const horde = makeHorde(w, { tile: partyTile(q), size: 60 });
    w.hordes.push(horde);
    const hc = hordeCard(w, q, horde);
    const ch = hc.choices.find((x) => x.label === "Fight");
    const text = ch.resolve(w);
    return { text, size: horde.size, hint: ch.hint, row: retreatPolicyRow(w, hc) };
  };
  const hn = hordeRun("never"), hb = hordeRun("blood");
  check(/broke off/.test(hb.text) && hb.size > hn.size && !/broke off/.test(hn.text), `a horde fight At first blood breaks off and runs for it, the horde thinned less (${hn.size} vs ${hb.size} left): "${hb.text.slice(0, 120)}…"`);
  check(/Retreat at first blood/.test(hb.hint) && /data-v="blood" class="active"/.test(hb.row), "the horde card shows the policy");
}

// 11. The autopilot's and crews' policies; base fights keep theirs; the hive assault's AI style.
{
  console.log("Retreat by the numbers: autopilot, crews, where it applies");
  const st = createWorld({ seed, factionCount: 4 });
  const p = teamOut(st, 2);
  check(teamPolicy(st, p) === "never" && policySource(st, p) === "default", "a player's team: Never until set on a card");
  st.autopilot = true;
  const g0 = st.governor;
  st.governor = { ...(g0 || {}), personality: "cautious" };
  const cau = teamPolicy(st, p);
  st.governor.personality = "aggressive";
  const agg = teamPolicy(st, p);
  st.governor.personality = "balanced";
  check(cau === "losing" && agg === "most" && teamPolicy(st, p) === "losing" && policySource(st, p) === "autopilot", `the autopilot by style: Cautious ${cau}, Balanced ${teamPolicy(st, p)}, Aggressive ${agg}`);
  setTeamPolicy(st, p, "blood");
  check(teamPolicy(st, p) === "blood", "a policy set on the team's card wins over the autopilot's style");
  delete p.retreatPolicy;
  st.autopilot = false; st.governor = g0;
  const role = { id: "crewX", name: "Scouts", kind: "crew", crew: { style: "aggressive" } };
  st.work = st.work || { roles: [] };
  st.work.roles.push(role);
  p.crewRole = role.id;
  check(teamPolicy(st, p) === "most" && policySource(st, p) === "crew", "a crew takes its role's style (Aggressive: when most are down)");
  role.crew.retreat = "blood";
  check(teamPolicy(st, p) === "blood" && crewPolicy(role.crew) === "blood" && tacticalStyleFor(st, p) === "cautious", "and the role's own Retreat setting, also as the AI style of a battle it plays headless (a hive assault)");
  delete p.crewRole;
  check(tacticalStyleFor(st, p) === undefined, "a team with no policy set keeps the battle's usual AI style");
  setTeamPolicy(st, p, "blood");
  check(policyFor(st, { partyId: p.id, enemy: {}, canRetreat: true }) === "blood", "a team's field fight uses it");
  check(policyFor(st, { baseId: hub(st).id, enemy: {}, canRetreat: true }) === "never" && policyFor(st, { partyId: p.id, mode: "raid", canRetreat: true }) === "never" && policyFor(st, { partyId: p.id, layout: "baseDefence", deploy: true, canRetreat: true }) === "never" && policyFor(st, { partyId: p.id, canRetreat: false }) === "never",
    "a base defence, a raid and a fight with no way out are not broken off by the numbers");
  // The helper for "abandon the base" by the numbers (defences.js may use it): runners, the downed carried, the left behind.
  const h = hub(st);
  const people = [fighter(st), fighter(st), fighter(st)];
  people[2].health = 5;
  const run = breakOff(st, people, { downed: [people[2].id], enemy: { kind: "raiders", count: 6 }, tile: h.tile, cause: "abandoning the base" });
  check(run.escaped.length + run.dead.filter((id) => id !== people[2].id).length + run.captured.filter((id) => id !== people[2].id).length >= 2 && (run.carried.includes(people[2].id) || run.dropped.includes(people[2].id) || run.dead.includes(people[2].id)) && run.lines.length >= 2,
    `breakOff: everyone standing runs, the downed is carried or dropped (${run.lines.join(" ")})`);
}

// 12. The same fights play out the same; a team's policy survives a save and load.
{
  console.log("Retreat by the numbers: determinism, save and load");
  const play = (viaSave) => {
    let st = createWorld({ seed: seed + 5, factionCount: 5 });
    const f = st.factions.find((x) => x.alive && x.bases.length);
    const p = teamOut(st, 3, { shooting: 5, weapon: "pistol" });
    setTeamPolicy(st, p, "losing");
    st.work = st.work || { roles: [] };
    if (viaSave) {
      st = loadFromString(saveToString(st));
    }
    const q = st.parties.find((x) => x.id === p.id);
    const ids = [...q.members];
    const at = (list) => list.map((id) => ids.indexOf(id)).join(","); // ids differ between worlds: who by place in the team
    const out = [];
    for (let i = 0; i < 12 && st.parties.includes(q) && partyMembers(st, q).length; i++) {
      const r = autoResolveCombat(st, numbersSetup(q, { kind: "raiders", count: 4, power: 5, factionId: f.id, name: "x" }));
      out.push(`${r.outcome}/${r.rounds}/${at(r.survivorsDead)}/${r.enemiesKilled}/${r.retreatOrder ? at(r.retreatOrder.escaped) : ""}`);
      for (const s of partyMembers(st, q)) s.health = 100;
    }
    return { out: out.join(" "), policy: q.retreatPolicy };
  };
  const a = play(false), b = play(false), c = play(true);
  check(a.out === b.out && /retreat/.test(a.out), `the same fights by the numbers play out the same, broken off where they were (${a.out.slice(0, 200)} / ${b.out.slice(0, 200)})`);
  check(c.policy === "losing" && c.out === a.out, "a team's policy is kept by a save and load, and the fights after it play out the same");
}

// ======================================================================================
// Measurement: the same battles with and without the AI's retreat.
// ======================================================================================
const TERRAINS = ["plains", "forest", "hills", "suburb", "city", "mountain"];
const LOCS = [null, null, "town", "farm", "gas", "police", "military", "mall", "quarry", "apartments", "ranch", "cabin"];
const MATCHUPS = [
  { name: "3 vs 3 raiders, even", players: 3, enemy: { kind: "raiders", count: 3 }, power: "match" },
  { name: "3 vs 3 raiders, they ambush", players: 3, enemy: { kind: "raiders", count: 3 }, power: "match", ambush: "enemy" },
  { name: "3 vs 4 raiders (power 5)", players: 3, enemy: { kind: "raiders", count: 4 }, power: 5 },
  { name: "3 vs 4 soldiers (power 7)", players: 3, enemy: { kind: "soldiers", count: 4 }, power: 7 },
  { name: "3 vs 6 raiders (power 6)", players: 3, enemy: { kind: "raiders", count: 6 }, power: 6 },
  { name: "3 vs 12 zombies (power 2)", players: 3, enemy: { kind: "zombies", count: 12 }, power: 2 },
  { name: "3 vs 16 zombies (power 4), they ambush", players: 3, enemy: { kind: "zombies", count: 16 }, power: 4, ambush: "enemy" },
  { name: "4 vs 6 mixed (power 4)", players: 4, enemy: { kind: "mixed", count: 6 }, power: 4 },
  { name: "6 vs 16 brood (power 3.5), hive", players: 6, enemy: { kind: "zombies", count: 16 }, power: 3.5, layout: "hive" },
];

function measure(style) {
  const state = createWorld({ seed, factionCount: 6 });
  const base = hub(state);
  const rows = [];
  const tot = { off: { dead: 0, wipes: 0, wins: 0 }, on: { dead: 0, wipes: 0, wins: 0, retreats: 0, winnable: 0, saved: 0 }, n: 0, unpaired: 0 };
  // By the numbers (breakoff.js): the same team and enemy resolved by the numbers, fought out and with the style's
  // policy; and how the retreats compare with the map's (escape odds per enemy kind, runners out, team home alive).
  const policy = STYLE_POLICY[style] || "losing";
  tot.num = { off: { dead: 0, wipes: 0, wins: 0 }, on: { dead: 0, wipes: 0, wins: 0, retreats: 0, winnable: 0 }, policy };
  const cmp = { tac: { odds: {}, runners: 0, out: 0, team: 0, home: 0, n: 0 }, num: { odds: {}, runners: 0, out: 0, team: 0, home: 0, n: 0 } };
  tot.cmp = cmp;
  const addOdds = (o, kind, chance) => { const a = (o[kind] = o[kind] || [0, 0, 0]); a[0] += chance; a[1]++; a[2] += chance * chance; };
  const addParts = (side, kind, u) => { const P = ((side.parts = side.parts || {})[kind] = side.parts[kind] || { n: 0, tiles: 0, pinned: 0, shooters: 0, chasers: 0, carry: 0, safe: 0 }); P.n++; P.tiles += u.tiles || 0; P.pinned += u.pinned || 0; P.shooters += u.shooters || 0; P.chasers += u.chasers || 0; P.carry += u.carrying != null ? 1 : 0; P.safe += u.chance >= 100 ? 1 : 0; };
  const noteRetreat = (c, res, size) => { c.n++; c.team += size; c.home += size - res.survivorsDead.length; };
  // Runners are counted over every break-off, also one that ended in a defeat (nobody got out): counted only after a
  // retreat, a lone runner lost was never in the share, and "When most are down" by the numbers usually breaks off
  // with one standing, so its share came out 100% whatever happened to the runners.
  const noteRun = (c, res) => {
    const ro = res.retreatOrder;
    if (ro) { const runners = new Set([...ro.escaped, ...ro.caught]); c.runners += runners.size; c.out += ro.escaped.length; }
  };
  for (const m of MATCHUPS) {
    const r = { off: { win: 0, dead: 0, wipes: 0 }, on: { win: 0, retreat: 0, dead: 0, wipes: 0, winnable: 0, turn: 0 }, noff: { win: 0, dead: 0 }, non: { win: 0, dead: 0, retreat: 0 } };
    for (let i = 0; i < N; i++) {
      const rng = state.rng;
      const tile = rng.pick(state.tiles.filter((t) => t.terrain !== "water"));
      const fake = { ...tile, terrain: rng.pick(TERRAINS), road: rng.chance(0.4), infection: 0 };
      const lt = rng.pick(LOCS);
      fake.loc = lt ? { type: lt, name: lt } : null;
      const people = [];
      for (let k = 0; k < m.players; k++) {
        const s = makeSurvivor(state);
        s.skills.shooting = rng.int(5, 11);
        const w = rng.pick(["pistol", "pistol", "huntrifle", "shotgun"]);
        s.gear.weapon = { key: w, name: GEAR[w].name, quality: 1 };
        s.location = { kind: "base", baseId: base.id };
        people.push(s);
      }
      const snap = structuredClone(people), snapN = structuredClone(people), snapP = structuredClone(people);
      const power = m.power === "match" ? 4 : m.power;
      const rngAt = rng.state;
      const armoryAt = [...base.armory]; // the same armory for both runs (the battle AI throws Molotovs and pipe bombs from it)
      const play = (crew, retreat) => {
        state.survivors.push(...crew);
        state.tiles[tile.id] = fake;
        setRounds(base.stock, 200, crew.map((s) => s.gear.weapon.key)); base.stock.meds = 3; // ammo.js: 200 rounds that fit the crew's guns, every run alike
        base.armory = [...armoryAt];
        // The risen of earlier test battles (carriers.js walkingLoot: people who died and turned, still walking) stay
        // out: the first of the pair would meet one near the tile and put it down, and the second would not.
        state.walkingLoot = [];
        rng.state = rngAt;
        const setup = { tile: tile.id, baseId: base.id, fighterIds: crew.map((s) => s.id), enemy: { ...m.enemy, power }, ambush: m.ambush || null, canRetreat: true, handler: "rt", layout: m.layout, context: {} };
        const b = (state.combat = createBattle(state, setup));
        for (let g = 0; g < 60 && !b.over; g++) {
          // The odds each runner has as the AI is about to sound the retreat (the same check autoPlayerTurn makes).
          if (retreat && b.phase === "player" && retreatAdvice(b, style)) for (const u of retreatPlan(b).units) { addOdds(cmp.tac.odds, m.enemy.kind, u.chance); addParts(cmp.tac, m.enemy.kind, u); }
          autoPlayerTurn(state, { retreat, style }); runEnemyPhase(state);
        }
        let res;
        if (b.over) { closeCombat(state); res = last; } else { state.combat = null; res = { outcome: "timeout", survivorsDead: [] }; }
        state.tiles[tile.id] = tile;
        state.survivors = state.survivors.filter((s) => !crew.includes(s));
        state.deathSites = []; state.cards = []; state.gameOver = false;
        if (res.outcome === "retreat" && b.retreatOrder && b.retreatOrder.by === "ai") noteRetreat(cmp.tac, res, crew.length);
        if (b.retreatOrder && b.retreatOrder.by === "ai") noteRun(cmp.tac, res);
        return { outcome: res.outcome, dead: res.survivorsDead.length, wipe: res.survivorsDead.length === crew.length, turn: b.turn, ai: !!(b.retreatOrder && b.retreatOrder.by === "ai") };
      };
      // The same fight by the numbers (the Auto-resolve button, the autopilot): fought out, or by the style's policy.
      const playNum = (crew, pol) => {
        state.survivors.push(...crew);
        setRounds(base.stock, 200, crew.map((s) => s.gear.weapon.key)); // ammo.js: as above
        state.walkingLoot = [];
        rng.state = rngAt;
        const res = autoResolveCombat(state, { tile: tile.id, baseId: base.id, fighterIds: crew.map((s) => s.id), enemy: { ...m.enemy, power }, ambush: m.ambush || null, canRetreat: true, handler: "rt", context: {}, breakOff: true, retreatPolicy: pol });
        state.survivors = state.survivors.filter((s) => !crew.includes(s));
        state.deathSites = []; state.cards = []; state.gameOver = false;
        if (res.retreatOrder) { for (const o of res.retreatOrder.odds) { addOdds(cmp.num.odds, m.enemy.kind, o.chance); addParts(cmp.num, m.enemy.kind, o); } if (res.outcome === "retreat") noteRetreat(cmp.num, res, crew.length); noteRun(cmp.num, res); }
        return res;
      };
      const off = play(people, false);
      const on = play(snap, true);
      r.off.win += off.outcome === "victory"; r.off.dead += off.dead; r.off.wipes += off.wipe;
      r.on.win += on.outcome === "victory"; r.on.dead += on.dead; r.on.wipes += on.wipe;
      if (on.ai) { r.on.retreat++; r.on.turn += on.turn; if (off.outcome === "victory") r.on.winnable++; }
      else if (on.outcome !== off.outcome || on.dead !== off.dead || on.turn !== off.turn) tot.unpaired++; // no retreat: the same battle
      const goOn = rng.state; // the next battle starts from where the map's runs left the dice (the same sample as before)
      const nOff = playNum(snapN, "never"), nOn = playNum(snapP, policy);
      rng.state = goOn;
      const T = tot.num;
      r.noff.win += nOff.outcome === "victory"; r.noff.dead += nOff.survivorsDead.length;
      r.non.win += nOn.outcome === "victory"; r.non.dead += nOn.survivorsDead.length; r.non.retreat += nOn.outcome === "retreat";
      T.off.wins += nOff.outcome === "victory"; T.off.dead += nOff.survivorsDead.length; T.off.wipes += nOff.survivorsDead.length === m.players;
      T.on.wins += nOn.outcome === "victory"; T.on.dead += nOn.survivorsDead.length; T.on.wipes += nOn.survivorsDead.length === m.players;
      if (nOn.retreatOrder) { T.on.retreats++; if (nOn.retreatOrder.wouldWin) T.on.winnable++; }
    }
    rows.push([m.name, r]);
    tot.n += N;
    tot.off.dead += r.off.dead; tot.off.wipes += r.off.wipes; tot.off.wins += r.off.win;
    tot.on.dead += r.on.dead; tot.on.wipes += r.on.wipes; tot.on.wins += r.on.win; tot.on.retreats += r.on.retreat; tot.on.winnable += r.on.winnable;
  }
  const pc = (x) => `${Math.round((x / N) * 100)}%`.padStart(4);
  console.log(`\nAI retreat, ${style} (${N} paired battles a matchup, seed ${seed}):`);
  console.log(`${"matchup".padEnd(40)}   no retreat: win  dead  wipes  |  with retreat: win  retreat  (turn)  dead  wipes  retreated from a fight it would have won`);
  for (const [name, r] of rows) {
    console.log(`${name.padEnd(40)}               ${pc(r.off.win)} ${(r.off.dead / N).toFixed(2)}  ${pc(r.off.wipes)}  |                ${pc(r.on.win)}    ${pc(r.on.retreat)}  (${r.on.retreat ? (r.on.turn / r.on.retreat).toFixed(1) : " - "})  ${(r.on.dead / N).toFixed(2)}  ${pc(r.on.wipes)}  ${r.on.winnable}/${r.on.retreat}`);
  }
  console.log(`all: deaths ${tot.off.dead} → ${tot.on.dead} (${tot.off.dead - tot.on.dead} people saved), team wipes ${tot.off.wipes} → ${tot.on.wipes}, wins ${tot.off.wins} → ${tot.on.wins}, retreats ${tot.on.retreats} (${tot.on.winnable} from a fight the no-retreat run won)`);
  const T = tot.num;
  console.log(`\nBy the numbers, ${style} (policy ${RETREAT_POLICIES[policy].name}), the same teams and enemies:`);
  console.log(`${"matchup".padEnd(40)}   fought out: win  dead  |  policy: win  retreat  dead`);
  for (const [name, r] of rows) console.log(`${name.padEnd(40)}               ${pc(r.noff.win)} ${(r.noff.dead / N).toFixed(2)}  |          ${pc(r.non.win)}   ${pc(r.non.retreat)}  ${(r.non.dead / N).toFixed(2)}`);
  console.log(`all: deaths ${T.off.dead} → ${T.on.dead}, team wipes ${T.off.wipes} → ${T.on.wipes}, wins ${T.off.wins} → ${T.on.wins}, retreats ${T.on.retreats} (${T.on.winnable} from a fight it would have won)`);
  const avg = (o, k) => (o[k] ? o[k][0] / o[k][1] : null);
  const kinds = [...new Set([...Object.keys(cmp.tac.odds), ...Object.keys(cmp.num.odds)])];
  // What the odds are made of, a runner on average (RT_PARTS=1): tiles, enemies on them, shooters, chasers, carrying.
  if (process.env.RT_PARTS) for (const k of kinds) console.log(`  ${k}: ${["tac", "num"].map((w) => { const P = cmp[w].parts && cmp[w].parts[k]; return P ? `${w} ${["tiles", "pinned", "shooters", "chasers", "carry", "safe"].map((f) => `${f} ${(P[f] / P.n).toFixed(2)}`).join(" ")} (${P.n})` : `${w} -`; }).join(" | ")}`);
  console.log(`escape odds per runner, on the map vs by the numbers: ${kinds.map((k) => `${k} ${avg(cmp.tac.odds, k) == null ? "-" : Math.round(avg(cmp.tac.odds, k))}% (${cmp.tac.odds[k] ? cmp.tac.odds[k][1] : 0}) vs ${avg(cmp.num.odds, k) == null ? "-" : Math.round(avg(cmp.num.odds, k))}% (${cmp.num.odds[k] ? cmp.num.odds[k][1] : 0})`).join(", ")}`);
  const share = (c, a, b) => (c[b] ? c[a] / c[b] : null);
  const f2 = (x) => (x == null ? "-" : `${Math.round(x * 100)}%`);
  console.log(`runners who got out of a break-off ${f2(share(cmp.tac, "out", "runners"))} on the map vs ${f2(share(cmp.num, "out", "runners"))} by the numbers; after a retreat, the team home alive ${f2(share(cmp.tac, "home", "team"))} vs ${f2(share(cmp.num, "home", "team"))} (${cmp.tac.n} vs ${cmp.num.n} retreats)`);
  console.log(`deaths a battle fought out: ${(tot.off.dead / tot.n).toFixed(2)} on the map vs ${(T.off.dead / tot.n).toFixed(2)} by the numbers (calibrated on the map: tools/calibrate.js)`);
  return tot;
}

const styles = styleArg === "all" ? ["cautious", "balanced", "aggressive"] : [styleArg];
if (N > 0) {
  const res = {};
  for (const s of styles) res[s] = measure(s);
  for (const s of styles) {
    const t = res[s];
    check(t.unpaired === 0, `${s}: a battle the AI did not retreat from plays out exactly as without the retreat (${t.unpaired} differ)`);
    check(t.on.dead <= t.off.dead, `${s}: the retreat costs no extra lives (${t.off.dead} → ${t.on.dead})`);
    check(t.on.wipes <= t.off.wipes, `${s}: fewer or as many team wipes (${t.off.wipes} → ${t.on.wipes})`);
    check(t.on.retreats === 0 || t.on.winnable / t.on.retreats <= 0.25, `${s}: at most a quarter of its retreats are from fights it would have won (${t.on.winnable}/${t.on.retreats})`);
    // The style's rate of wins given up, plus 2 standard errors of the count (Poisson, sqrt of the expected count):
    // a few winnable fights abandoned is dice (balanced over 5 seeds of 360 battles gave up 4-12, mean 9, both before
    // and after the determinism fix), so a flat 3% of 360 (10.8) failed about one seed in five.
    const giveUp = t.n * ({ cautious: 0.06, balanced: 0.03, aggressive: 0.02 }[s] || 0.03), giveUpMax = Math.max(3, giveUp + 2 * Math.sqrt(giveUp));
    check(t.off.wins - t.on.wins <= giveUpMax, `${s}: wins given up stay small (${t.off.wins} → ${t.on.wins} of ${t.n}; at most ${giveUpMax.toFixed(1)}: ${giveUp.toFixed(1)} + 2 standard errors)`);
  }
  if (res.cautious && res.aggressive) check(res.cautious.on.retreats >= res.aggressive.on.retreats, `Cautious retreats at least as often as Aggressive (${res.cautious.on.retreats} vs ${res.aggressive.on.retreats})`);
  // By the numbers: the policy saves lives like the map's retreat, and both modes agree on the escape itself.
  for (const s of styles) {
    const T = res[s].num, c = res[s].cmp;
    const md = res[s].off.dead;
    check(Math.abs(T.off.dead - md) <= 0.5 * md + 5, `${s}: fought out, a fight by the numbers is about as deadly as on the map (${md} vs ${T.off.dead} dead, within 50%; tools/calibrate.js checks it closer)`);
    check(T.on.dead <= T.off.dead && T.on.wipes <= T.off.wipes, `${s}, by the numbers (${T.policy}): no extra lives or wipes (deaths ${T.off.dead} → ${T.on.dead}, wipes ${T.off.wipes} → ${T.on.wipes})`);
    check(T.on.retreats === 0 || T.on.winnable / T.on.retreats <= 0.25, `${s}, by the numbers: at most a quarter of its retreats are from fights it would have won (${T.on.winnable}/${T.on.retreats})`);
    // Allowed gap: 15 points, or 2.5 standard errors of the difference when the samples are small (10 runners by the
    // numbers at 85% come out 100% about one time in seven by chance alone).
    if (c.tac.runners >= 10 && c.num.runners >= 10) {
      const a = c.tac.out / c.tac.runners, b = c.num.out / c.num.runners, pp = (c.tac.out + c.num.out) / (c.tac.runners + c.num.runners);
      // 17 points: by the numbers a runner caught who tears free counts as out, and with the calibrated blood
      // (breakoff.js LOST_DOWN, tools/calibrate.js) "When most are down" breaks off with fewer standing to catch.
      // (Aggressive came out 83% on the map vs 100% by the numbers, right at the edge, before the runners by the
      // numbers carried the fight's wear, breakoff.js WEAR, and the count took in break-offs nobody got out of:
      // seed 7, 73% vs 78%; Balanced 88% vs 100%, Cautious 98% vs 100%.)
      const tol = Math.max(0.17, 2.5 * Math.sqrt(Math.max(0.0025, pp * (1 - pp)) * (1 / c.tac.runners + 1 / c.num.runners)));
      check(Math.abs(a - b) <= tol, `${s}: runners who get out, on the map ${Math.round(a * 100)}% (${c.tac.runners}) vs by the numbers ${Math.round(b * 100)}% (${c.num.runners}) (within ${Math.round(tol * 100)} points)`);
    }
    // A lost fight by the numbers is now as deadly as on the map (breakoff.js, calibrated by tools/calibrate.js): "When
    // most are down" (Aggressive) waits until more than half are down or badly hurt, later than the map's Aggressive
    // AI, which sees the fight turn: 20 points for it, 10 for the others.
    const slack = T.policy === "most" ? 0.2 : 0.1;
    if (c.tac.n >= 5 && c.num.n >= 5) check(c.num.home / c.num.team >= c.tac.home / c.tac.team - slack, `${s}: a retreat by the numbers brings home at least as many as the map's (−${Math.round(slack * 100)} points): ${Math.round((c.tac.home / c.tac.team) * 100)}% vs ${Math.round((c.num.home / c.num.team) * 100)}%`);
  }
  // A runner's escape odds per enemy kind where both pull out at about the same moment: the Cautious AI on the map
  // sounds the retreat early, as If losing breaks off early (the later styles meet more of the dead around them).
  if (res.cautious) {
    const c = res.cautious.cmp;
    for (const k of Object.keys(c.tac.odds)) {
      const a = c.tac.odds[k], b = c.num.odds[k];
      if (!b || a[1] < 8 || b[1] < 8) continue;
      // 15 points, or 2.5 standard errors of the difference when the samples are small (a mixed fight: 4-10 runners on
      // the map from two or three retreats, seeds 7, 9, 11). The runners of one retreat share its moment, so each
      // side's error counts the retreats (about 3 runners each), not the runners.
      const se = (x) => { const m = x[0] / x[1], v = Math.max(100, x[2] / x[1] - m * m); return Math.sqrt(v / Math.max(1, x[1] / 3)); };
      const tol = Math.max(15, 2.5 * Math.sqrt(se(a) ** 2 + se(b) ** 2));
      check(Math.abs(a[0] / a[1] - b[0] / b[1]) <= tol, `a runner's escape odds against ${k}, Cautious on the map ${Math.round(a[0] / a[1])}% (${a[1]}) vs If losing by the numbers ${Math.round(b[0] / b[1])}% (${b[1]}) (within ${Math.round(tol)})`);
    }
  }
  if (res.cautious && res.aggressive) check(res.cautious.num.on.retreats >= res.aggressive.num.on.retreats, `by the numbers too, Cautious retreats at least as often as Aggressive (${res.cautious.num.on.retreats} vs ${res.aggressive.num.on.retreats})`);
}

void active; void endPlayerTurn; void unitAt; void GEAR;
console.log(`\n${passes} passed, ${fails} failed`);
if (fails) process.exit(1);
