// Fights by the numbers against the tactical map (src/sim/combat.js autoResolveCombat, breakoff.js): a grid of field
// fights (people against raiders, soldiers, the dead, a mix; a hive's brood), each played on the battle map by the AI
// on both sides, fought out (no retreat), and resolved by the numbers from the same start. Prints win rates and
// deaths per fight in both modes by matchup and in all, and the by-the-numbers ratio (squad power over the enemy's,
// the odds the cards show) against the map's win rate. --raw path writes every map fight (for fitting the model).
// Fails when, over the whole grid, the wins by the numbers are more than 8 points or the deaths a fight more than 25%
// from the map's. The fitted numbers live in combat.js ODDS (the odds) and breakoff.js BREAKOFF (the blood).
// Usage: node tools/calibrate.js [fights per matchup=24] [seed=5] [--raw path]
import { writeFileSync } from "node:fs";
import { createWorld, makeSurvivor, hub, combatPower } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { createBattle, autoPlayerTurn, runEnemyPhase, closeCombat, registerCombatHandler, autoResolveCombat, byNumbersOdds } from "../src/sim/combat.js";
import "../src/sim/hives.js"; // the "hive" battle layout

const args = process.argv.slice(2);
const rawAt = args.indexOf("--raw");
const rawPath = rawAt >= 0 ? args.splice(rawAt, 2)[1] : null;
const N = Number(args[0] || 24);
const seed = Number(args[1] || 5);
let last = null;
registerCombatHandler("cal", (st, result) => { last = result; });

export const MATCHUPS = [
  { name: "3 vs 2 raiders (power 4)", players: 3, enemy: { kind: "raiders", count: 2, power: 4 } },
  { name: "3 vs 3 raiders (power 4)", players: 3, enemy: { kind: "raiders", count: 3, power: 4 } },
  { name: "3 vs 4 raiders (power 5)", players: 3, enemy: { kind: "raiders", count: 4, power: 5 } },
  { name: "4 vs 6 raiders (power 5)", players: 4, enemy: { kind: "raiders", count: 6, power: 5 } },
  { name: "5 vs 4 raiders (power 6)", players: 5, enemy: { kind: "raiders", count: 4, power: 6 } },
  { name: "3 vs 3 soldiers (power 7)", players: 3, enemy: { kind: "soldiers", count: 3, power: 7 } },
  { name: "5 vs 5 soldiers (power 7)", players: 5, enemy: { kind: "soldiers", count: 5, power: 7 } },
  { name: "3 vs 3 raiders, they ambush", players: 3, enemy: { kind: "raiders", count: 3, power: 4 }, ambush: "enemy" },
  { name: "2 vs 8 zombies (power 2)", players: 2, enemy: { kind: "zombies", count: 8, power: 2 } },
  { name: "3 vs 12 zombies (power 2)", players: 3, enemy: { kind: "zombies", count: 12, power: 2 } },
  { name: "3 vs 20 zombies (power 2)", players: 3, enemy: { kind: "zombies", count: 20, power: 2 } },
  { name: "3 vs 12 zombies (power 4)", players: 3, enemy: { kind: "zombies", count: 12, power: 4 } },
  { name: "4 vs 16 zombies (power 4)", players: 4, enemy: { kind: "zombies", count: 16, power: 4 } },
  { name: "3 vs 16 zombies (power 4), they ambush", players: 3, enemy: { kind: "zombies", count: 16, power: 4 }, ambush: "enemy" },
  { name: "4 vs 6 mixed (power 4)", players: 4, enemy: { kind: "mixed", count: 6, power: 4 } },
  { name: "6 vs 14 brood (power 5), hive", players: 6, enemy: { kind: "zombies", count: 14, power: 5 }, layout: "hive" },
  { name: "6 vs 18 brood (power 5.5), hive", players: 6, enemy: { kind: "zombies", count: 18, power: 5.5 }, layout: "hive" },
  { name: "3 vs 5 raiders (power 3)", players: 3, enemy: { kind: "raiders", count: 5, power: 3 } },
  { name: "4 vs 4 raiders (power 5)", players: 4, enemy: { kind: "raiders", count: 4, power: 5 } },
  { name: "6 vs 8 raiders (power 5)", players: 6, enemy: { kind: "raiders", count: 8, power: 5 } },
  { name: "4 vs 3 soldiers (power 7)", players: 4, enemy: { kind: "soldiers", count: 3, power: 7 } },
  { name: "2 vs 6 zombies (power 3)", players: 2, enemy: { kind: "zombies", count: 6, power: 3 } },
  { name: "5 vs 20 zombies (power 3)", players: 5, enemy: { kind: "zombies", count: 20, power: 3 } },
  { name: "4 vs 10 zombies (power 5)", players: 4, enemy: { kind: "zombies", count: 10, power: 5 } },
  { name: "6 vs 12 brood (power 5), hive", players: 6, enemy: { kind: "zombies", count: 12, power: 5 }, layout: "hive" },
  { name: "3 vs 5 mixed (power 4)", players: 3, enemy: { kind: "mixed", count: 5, power: 4 } },
  { name: "3 vs 4 raiders, you strike first", players: 3, enemy: { kind: "raiders", count: 4, power: 5 }, ambush: "player" },
];
const WEAPONS = ["pistol", "pistol", "huntrifle", "shotgun", "machete", "ar"];

function main() {
  const state = createWorld({ seed, factionCount: 6 });
  const base = hub(state);
  const raw = [];
  const tot = { map: { win: 0, dead: 0 }, num: { win: 0, dead: 0 }, n: 0 };
  console.log(`${"matchup".padEnd(42)} ratio  | map: win  dead/fight | numbers: win  dead/fight`);
  for (const m of MATCHUPS) {
    const r = { map: { win: 0, dead: 0 }, num: { win: 0, dead: 0 }, ratio: 0 };
    for (let i = 0; i < N; i++) {
      const rng = state.rng;
      const people = [];
      for (let k = 0; k < m.players; k++) {
        const s = makeSurvivor(state);
        s.skills.shooting = rng.int(4, 12);
        const w = rng.pick(WEAPONS);
        s.gear.weapon = { key: w, name: GEAR[w].name, quality: 1 };
        if (rng.chance(0.4)) s.gear.armor = { key: "vest", name: GEAR.vest.name, quality: 1 };
        s.location = { kind: "base", baseId: base.id };
        people.push(s);
      }
      const snap = structuredClone(people);
      const rngAt = rng.state;
      const setupOf = (crew) => ({ tile: base.tile, baseId: base.id, fighterIds: crew.map((s) => s.id), enemy: { ...m.enemy }, ambush: m.ambush || null, canRetreat: true, handler: "cal", layout: m.layout, context: {}, breakOff: false, retreatPolicy: "never" });
      // On the map.
      state.survivors.push(...people);
      base.stock.ammo = 300; base.stock.meds = 3; base.armory = [];
      const odds = byNumbersOdds(state, setupOf(people));
      const b = (state.combat = createBattle(state, setupOf(people)));
      for (let g = 0; g < 80 && !b.over; g++) { autoPlayerTurn(state, { retreat: false }); runEnemyPhase(state); }
      let res;
      if (b.over) { closeCombat(state); res = last; } else { state.combat = null; res = { outcome: "timeout", survivorsDead: [] }; }
      state.survivors = state.survivors.filter((s) => !people.includes(s));
      state.deathSites = []; state.cards = []; state.gameOver = false;
      const after = rng.state;
      // By the numbers, from the same start.
      state.survivors.push(...snap);
      base.stock.ammo = 300;
      rng.state = rngAt;
      const nres = autoResolveCombat(state, setupOf(snap));
      state.survivors = state.survivors.filter((s) => !snap.includes(s));
      state.deathSites = []; state.cards = []; state.gameOver = false;
      rng.state = after;
      r.map.win += res.outcome === "victory"; r.map.dead += res.survivorsDead.length;
      r.num.win += nres.outcome === "victory"; r.num.dead += nres.survivorsDead.length;
      r.ratio += odds.ratio;
      raw.push({ m: m.name, kind: m.enemy.kind, players: m.players, count: m.enemy.count, power: m.enemy.power, ambush: m.ambush || null, hive: !!m.layout, ratio: odds.ratio, mine: odds.mine, theirs: odds.theirs, win: res.outcome === "victory" ? 1 : 0, dead: res.survivorsDead.length, nwin: nres.outcome === "victory" ? 1 : 0, ndead: nres.survivorsDead.length });
    }
    const pc = (x) => `${Math.round((100 * x) / N)}%`.padStart(4);
    console.log(`${m.name.padEnd(42)} ${(r.ratio / N).toFixed(2)}   |      ${pc(r.map.win)}  ${(r.map.dead / N).toFixed(2)}      |          ${pc(r.num.win)}  ${(r.num.dead / N).toFixed(2)}`);
    tot.map.win += r.map.win; tot.map.dead += r.map.dead; tot.num.win += r.num.win; tot.num.dead += r.num.dead; tot.n += N;
  }
  console.log(`\nall ${tot.n} fights: map win ${Math.round((100 * tot.map.win) / tot.n)}%, ${(tot.map.dead / tot.n).toFixed(2)} dead a fight | by the numbers win ${Math.round((100 * tot.num.win) / tot.n)}%, ${(tot.num.dead / tot.n).toFixed(2)} dead a fight`);
  if (rawPath) writeFileSync(rawPath, JSON.stringify(raw));
  // Pass / fail: over the whole grid, the wins within 8 points and the deaths a fight within 25% of the map's.
  const dw = Math.abs(tot.map.win - tot.num.win) / tot.n, dd = Math.abs(tot.map.dead - tot.num.dead) / Math.max(1, tot.map.dead);
  const ok = dw <= 0.08 && dd <= 0.25;
  console.log(`${ok ? "ok" : "FAIL"}: by the numbers within 8 points of the map's wins (${Math.round(dw * 100)}) and 25% of its deaths (${Math.round(dd * 100)}%)`);
  process.exitCode = ok ? 0 : 1;
  return { tot, raw };
}
main();
