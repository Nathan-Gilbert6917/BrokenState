// Sounding the retreat (src/sim/combat.js soundRetreat, escapeOdds, retreatPlan, retreatAdvice): rule checks, then a
// paired measurement of the AI's retreat. Each battle is played twice from the same start (same team, same map, same
// dice), once with the AI never retreating and once with it free to sound the retreat in the given style, so the
// two runs are identical up to the turn the AI pulls out.
// Usage: node tools/retreattest.js [battles per matchup] [seed] [style|all]   (default 40, 7, all)
import { createWorld, makeSurvivor, hub, survivorById } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import {
  active, createBattle, autoPlayerTurn, runEnemyPhase, closeCombat, registerCombatHandler, combatAct, endPlayerTurn,
  soundRetreat, retreatPlan, retreatRefusal, escapeOdds, retreatAdvice, fightOutlook, evacAt, inEvac, RETREAT, RETREAT_AI, unitAt,
} from "../src/sim/combat.js";
import { newItem } from "../src/sim/inventory.js";
import "../src/sim/hives.js"; // the "hive" battle layout
import { combatAction, combatKey, retreatAskOpen, retreatConfirmHtml, cui } from "../src/ui/combat.js";

const N = Number(process.argv[2] || 40);
const seed = Number(process.argv[3] || 7);
const styleArg = process.argv[4] || "all";
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
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
  h.stock.ammo = 200; h.stock.meds = 4;
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
  u.load = 4;
  const heavy = escapeOdds(b, u);
  check(heavy.chance === fresh - 4 * RETREAT.ARMOR, `a plate carrier slows them (${heavy.chance}%)`);
  u.load = 0;
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
    h.stock.ammo = 200; h.stock.meds = 3;
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
  for (const m of MATCHUPS) {
    const r = { off: { win: 0, dead: 0, wipes: 0 }, on: { win: 0, retreat: 0, dead: 0, wipes: 0, winnable: 0, turn: 0 } };
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
      const snap = structuredClone(people);
      const power = m.power === "match" ? 4 : m.power;
      const rngAt = rng.state;
      const armoryAt = [...base.armory]; // the same armory for both runs (the battle AI throws Molotovs and pipe bombs from it)
      const play = (crew, retreat) => {
        state.survivors.push(...crew);
        state.tiles[tile.id] = fake;
        base.stock.ammo = 200; base.stock.meds = 3;
        base.armory = [...armoryAt];
        rng.state = rngAt;
        const setup = { tile: tile.id, baseId: base.id, fighterIds: crew.map((s) => s.id), enemy: { ...m.enemy, power }, ambush: m.ambush || null, canRetreat: true, handler: "rt", layout: m.layout, context: {} };
        const b = (state.combat = createBattle(state, setup));
        for (let g = 0; g < 60 && !b.over; g++) { autoPlayerTurn(state, { retreat, style }); runEnemyPhase(state); }
        let res;
        if (b.over) { closeCombat(state); res = last; } else { state.combat = null; res = { outcome: "timeout", survivorsDead: [] }; }
        state.tiles[tile.id] = tile;
        state.survivors = state.survivors.filter((s) => !crew.includes(s));
        state.deathSites = []; state.cards = []; state.gameOver = false;
        return { outcome: res.outcome, dead: res.survivorsDead.length, wipe: res.survivorsDead.length === crew.length, turn: b.turn, ai: !!(b.retreatOrder && b.retreatOrder.by === "ai") };
      };
      const off = play(people, false);
      const on = play(snap, true);
      r.off.win += off.outcome === "victory"; r.off.dead += off.dead; r.off.wipes += off.wipe;
      r.on.win += on.outcome === "victory"; r.on.dead += on.dead; r.on.wipes += on.wipe;
      if (on.ai) { r.on.retreat++; r.on.turn += on.turn; if (off.outcome === "victory") r.on.winnable++; }
      else if (on.outcome !== off.outcome || on.dead !== off.dead || on.turn !== off.turn) tot.unpaired++; // no retreat: the same battle
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
    check(t.off.wins - t.on.wins <= Math.max(3, t.n * ({ cautious: 0.05, balanced: 0.03, aggressive: 0.02 }[s] || 0.03)),`${s}: wins given up stay small (${t.off.wins} → ${t.on.wins} of ${t.n})`);
  }
  if (res.cautious && res.aggressive) check(res.cautious.on.retreats >= res.aggressive.on.retreats, `Cautious retreats at least as often as Aggressive (${res.cautious.on.retreats} vs ${res.aggressive.on.retreats})`);
}

void active; void endPlayerTurn; void unitAt; void GEAR;
console.log(`\n${passes} passed, ${fails} failed`);
if (fails) process.exit(1);
