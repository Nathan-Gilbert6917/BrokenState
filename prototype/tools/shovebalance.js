// Does shoving change how fights go? (sim/shoving.js, the user's request 2026-10-20.) Plays the same battles twice, the AI
// on both sides (autoPlayerTurn, runEnemyPhase), once as the game was before it (every AI shove off, PUSH.AI_*: 0, and
// the dead never getting hold, GRIP.CHANCE: 0) and once as it is, and prints the difference: wins, your downed, the
// turns a fight takes, the shoves thrown (how many landed) and the grips the dead got. A table to read, not a test: it only fails if shoving swings a
// fight's result by more than SWING (a win rate off by more than that many points either way).
// Usage: node tools/shovebalance.js [fights per case] [seed]   (default 40; about 1 minute)
import { createWorld, makeSurvivor, hub } from "../src/sim/world.js";
import { createBattle, registerCombatHandler, autoPlayerTurn, runEnemyPhase, endBattleNow } from "../src/sim/combat.js";
import { PUSH, GRIP } from "../src/sim/shoving.js";
import { newItem } from "../src/sim/inventory.js";

const N = Number(process.argv[2] || 40), SEED = Number(process.argv[3] || 100);
const SWING = 20; // points of win rate; at 40 fights a case the noise alone is about ±11
registerCombatHandler("shovebalance", () => {});
const CASES = [
  { name: "4 survivors with pistols vs 12 of the dead", crew: ["pistol", "pistol", "pistol", "pistol"], enemy: { kind: "zombies", count: 12, power: 3 } },
  { name: "4 survivors with bats vs 12 of the dead", crew: ["bat", "bat", "bat", "bat"], enemy: { kind: "zombies", count: 12, power: 3 } },
  { name: "4 with machetes vs 4 raiders", crew: ["machete", "machete", "machete", "machete"], enemy: { kind: "raiders", count: 4, power: 3 } },
  { name: "4 with pistols vs 4 raiders", crew: ["pistol", "pistol", "pistol", "pistol"], enemy: { kind: "raiders", count: 4, power: 3 } },
];
const AI = ["AI_HAZARD", "AI_MELEE", "AI_OUT"];
const saved = Object.fromEntries(AI.map((k) => [k, PUSH[k]])), grip = GRIP.CHANCE;

function fight(c, seed) {
  const st = createWorld({ seed, factionCount: 4 });
  const h = hub(st);
  const crew = c.crew.map((w) => {
    const s = makeSurvivor(st);
    s.skills.melee = 5; s.skills.shooting = 5; s.traits = []; s.health = 100;
    s.gear.weapon = newItem(w);
    for (const slot of ["head", "armor", "arms", "legs", "tool"]) s.gear[slot] = null;
    s.pockets = [null, null, null, null];
    s.location = { kind: "base", baseId: h.id };
    st.survivors.push(s);
    return s;
  });
  h.stock.ammo = 400; h.stock.meds = 0;
  const b = (st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: crew.map((s) => s.id), enemy: c.enemy, ambush: null, canRetreat: false, handler: "shovebalance", context: {} }));
  let shoves = 0, landed = 0, grabs = 0, seen = 0;
  let turns = 0;
  for (; turns < 40 && st.combat && !st.combat.over; turns++) {
    autoPlayerTurn(st, { retreat: false });
    if (st.combat && !st.combat.over) runEnemyPhase(st);
    for (const l of b.log.slice(seen)) { if (/ shoves /.test(l.text)) { shoves++; if (!/keeps their feet/.test(l.text)) landed++; } if (/ gets hold of /.test(l.text)) grabs++; }
    seen = b.log.length;
  }
  const mine = b.units.filter((u) => u.side === "player"), foes = b.units.filter((u) => u.side !== "player");
  const win = !foes.some((u) => u.hp > 0 && !u.dead && !u.left && !u.fled);
  return { win, dead: mine.filter((u) => u.dead || u.down).length, turns, shoves, landed, grabs };
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
let fails = 0;
console.log(`${N} fights a case, seeds ${SEED}..${SEED + N - 1}; before shoving (no AI shoves, no grips) → now\n`);
console.log("case".padEnd(46) + "wins".padEnd(16) + "your downed".padEnd(16) + "turns".padEnd(14) + "shoves (landed)".padEnd(18) + "grips/fight");
for (const c of CASES) {
  const run = (on) => { for (const k of AI) PUSH[k] = on ? saved[k] : 0; GRIP.CHANCE = on ? grip : 0; const out = []; for (let i = 0; i < N; i++) out.push(fight(c, SEED + i)); return out; };
  const off = run(false), on = run(true);
  for (const k of AI) PUSH[k] = saved[k];
  GRIP.CHANCE = grip;
  const pct = (r) => Math.round((100 * r.filter((x) => x.win).length) / r.length);
  const d = pct(on) - pct(off);
  console.log(c.name.padEnd(46) + `${pct(off)}% → ${pct(on)}%`.padEnd(16) + `${mean(off.map((x) => x.dead)).toFixed(2)} → ${mean(on.map((x) => x.dead)).toFixed(2)}`.padEnd(16) + `${mean(off.map((x) => x.turns)).toFixed(1)} → ${mean(on.map((x) => x.turns)).toFixed(1)}`.padEnd(14) + `${mean(on.map((x) => x.shoves)).toFixed(1)} (${mean(on.map((x) => x.landed)).toFixed(1)})`.padEnd(18) + mean(on.map((x) => x.grabs)).toFixed(1));
  if (Math.abs(d) > SWING) { fails++; console.log(`  FAIL shoving and grips swing this case by ${d} points of win rate (more than ${SWING})`); }
}
console.log(fails ? `\n${fails} case(s) swing too far: tune sim/shoving.js PUSH / GRIP` : "\nNo case swings by more than " + SWING + " points.");
process.exit(fails ? 1 : 0);
