// Power sweep: 3 survivors vs 3 raiders at increasing enemy power, to calibrate the tactical engine
// against world.combatPower. Usage: node tools/combattest_sweep.js [battles] [seed]
import { createWorld, makeSurvivor, combatPower, hub } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { createBattle, autoPlayerTurn, runEnemyPhase, closeCombat, registerCombatHandler } from "../src/sim/combat.js";

const N = Number(process.argv[2] || 200);
const state = createWorld({ seed: Number(process.argv[3] || 3), factionCount: 6 });
const base = hub(state);
let last = null;
registerCombatHandler("sweep", (st, r) => { last = r; });
let cp = 0, cpn = 0;
for (const kind of ["raiders", "soldiers", "zombies"]) {
  const powers = kind === "zombies" ? [2, 3, 4, 5] : [3, 4, 5, 6, 7, 8, 9];
  for (const power of powers) {
    let wins = 0;
    for (let i = 0; i < N; i++) {
      const people = [];
      for (let k = 0; k < 3; k++) {
        const s = makeSurvivor(state);
        s.skills.shooting = state.rng.int(5, 11);
        const w = state.rng.pick(["pistol", "pistol", "huntrifle", "shotgun"]);
        s.gear.weapon = { key: w, name: GEAR[w].name, quality: 1 };
        s.location = { kind: "base", baseId: base.id };
        state.survivors.push(s);
        people.push(s);
        cp += combatPower(s); cpn++;
      }
      base.stock.ammo = 200; base.stock.meds = 3;
      const count = kind === "zombies" ? 3 * Math.round(6 / power + 1) : 3;
      state.combat = createBattle(state, { tile: state.rng.int(0, state.tiles.length - 1), baseId: base.id, fighterIds: people.map((s) => s.id), enemy: { kind, count, power }, ambush: null, canRetreat: false, handler: "sweep" });
      for (let g = 0; g < 60 && !state.combat.over; g++) { autoPlayerTurn(state); runEnemyPhase(state); }
      if (state.combat.over) { closeCombat(state); if (last.outcome === "victory") wins++; } else state.combat = null;
      state.survivors = state.survivors.filter((s) => !people.includes(s));
      state.gameOver = false; state.cards = []; state.deathSites = [];
    }
    const count = kind === "zombies" ? 3 * Math.round(6 / power + 1) : 3;
    console.log(`3 vs ${count} ${kind} power ${power}: survivors win ${Math.round((wins / N) * 100)}%`);
  }
}
console.log(`average survivor combatPower ${(cp / cpn).toFixed(1)}`);
