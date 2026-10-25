// The biggest mall's turn, headless (issue #30: a turn under 1.5 s with 100 dead): a regional mall raid with about
// 100 of the dead, the map made, then a few rounds of the player's turn (the raid bot) and the enemy phase, timed.
// Usage: node tools/mallbench.js [seed] [rounds] [--aware]   (not a test: it prints the times)
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { createBattle, runEnemyPhase, autoPlayerTurn, endPlayerTurn } from "../src/sim/combat.js";
import { launchExpedition } from "../src/sim/parties.js";
import { poiRaidSetup } from "../src/sim/poiraid.js";
import { buildingMap } from "../src/sim/buildingmaps.js";

const seed = Number(process.argv[2] || 7), rounds = Number(process.argv[3] || 5);
const st = createWorld({ seed, factionCount: 6 });
st.started = true; st.cards.length = 0; st.crashNext = 1e9;
const malls = st.tiles.filter((t) => t.loc && t.loc.type === "mall" && t.pois && t.pois[0] && t.pois[0].site);
// The biggest of the world's malls (by the map's cells × its levels).
let best = null;
for (const t of malls) { const m = buildingMap(st, t.id, { id: "regionalmall", key: "regionalmall", name: "Mall" }, false); const size = m.w * m.h * m.storeys; if (!best || size > best.size) best = { t, size, m }; }
const t = best.t;
const h = hub(st), crew = atBase(st, h.id).slice(0, 4);
const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: h.tile, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 2, water: 2, ammo: 0 } });
const p = res.party;
p.path = [t.id]; p.idx = 0; p.dest = t.id; p.phase = "engaged";
const rs = poiRaidSetup(st, t, 0);
const t0 = performance.now();
const b = createBattle(st, { mode: "raid", tile: t.id, partyId: p.id, canRetreat: true, ambush: null, handler: "scavenge", enemy: { kind: "zombies", count: 0, power: 3, name: "the dead", groups: [{ kind: "zombies", count: 20, power: 3 }, { kind: "zombies", count: 7, power: 3 }] }, raid: { heat0: 5, poi: 0, kind: rs.kind || null, place: rs.place || null }, context: {} });
st.combat = b;
const setup = performance.now() - t0;
const dead = b.units.filter((u) => u.side === "enemy" && u.kind === "zombie").length;
console.log(`Mall: ${b.w} × ${b.h}, ${b.raid.storeys} levels, ${b.raid.containers.length} containers, ${b.raid.plan.houses.length} buildings, ${dead} dead; set up in ${setup.toFixed(0)} ms`);
if (b.plan) b.plan = null; // raidplan.js: straight in (the side as made)
// --aware: every one of the dead has heard you (the worst case: all of them pathing toward the team).
if (process.argv.includes("--aware")) for (const u of b.units) if (u.side === "enemy") u.aware = true;
const times = [];
for (let r = 0; r < rounds && !b.over; r++) {
  const a = performance.now();
  autoPlayerTurn(st);
  if (!b.over && b.phase === "player") endPlayerTurn(st);
  const mid = performance.now();
  if (!b.over) runEnemyPhase(st);
  const e = performance.now();
  times.push([mid - a, e - mid]);
  console.log(`  round ${r + 1}: player ${(mid - a).toFixed(0)} ms, enemy phase ${(e - mid).toFixed(0)} ms (turn ${(e - a).toFixed(0)} ms; aware ${b.units.filter((u) => u.side === "enemy" && u.aware && !u.dead).length})`);
}
const tot = times.map(([x, y]) => x + y);
console.log(`Turn: mean ${(tot.reduce((s, v) => s + v, 0) / Math.max(1, tot.length)).toFixed(0)} ms, max ${Math.max(...tot).toFixed(0)} ms over ${tot.length} rounds`);
