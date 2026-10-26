// The campus's turn time and save size (issue #28: src/sim/campus.js), headless: a raid on a state university with the
// dead at CAMPUS.DEAD_MAX (100), every one of them aware (the worst case: the whole horde on the move), the raid bot
// playing your side. Reports the map, the build time, a player turn and an enemy phase (mean and worst of N turns), and
// the save's size (serializeState, gzip as the browser stores it). Not a test (no *test* in the name): run it by hand.
// Usage: node tools/campusbench.js [kind=state] [turns=6] [seed=42] [groups=5]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { createBattle, runEnemyPhase, autoPlayerTurn } from "../src/sim/combat.js";
import { launchExpedition } from "../src/sim/parties.js";
import { serializeState } from "../src/sim/save.js";
import { CAMPUS } from "../src/sim/campus.js";
import { gzipSync } from "zlib";

const kind = process.argv[2] || "state", turns = Number(process.argv[3] || 6), seed = Number(process.argv[4] || 42);
const st = createWorld({ seed, factionCount: 8 }); st.started = true; st.cards.length = 0; st.crashNext = 1e9;
const t = st.tiles.find((x) => x.loc && x.loc.type === "univ"); t.loc.campus = kind;
const h = hub(st), crew = atBase(st, h.id).slice(0, 4);
const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: h.tile, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 60 } });
const p = res.party; p.path = [t.id]; p.idx = 0; p.dest = t.id; p.phase = "engaged";
// The roster: groups of 20 (createRaid's cap a group), each × the campus's area (campusDead), to CAMPUS.DEAD_MAX in all.
const groups = Array.from({ length: Number(process.argv[5] || 5) }, () => ({ kind: "zombies", count: 20, power: 3 }));
const setup = { mode: "raid", tile: t.id, partyId: p.id, canRetreat: true, ambush: null, handler: "scavenge", enemy: { kind: "zombies", count: 100, power: 3, name: "the dead", groups }, raid: { heat0: 5 }, context: {} };
let t0 = Date.now();
const b = createBattle(st, setup); st.combat = b;
const build = Date.now() - t0;
const dead = b.units.filter((u) => u.kind === "zombie");
for (const u of dead) u.aware = true;
const cells = (b.floors || [{ cells: b.cells }]).reduce((a, F) => a + F.cells.length, 0);
console.log(JSON.stringify({ kind, map: `${b.w}x${b.h}`, floors: b.floors ? b.floors.length : 1, cells, buildings: b.raid.plan.houses.length, containers: b.raid.containers.length, dead: dead.length, cap: CAMPUS.DEAD_MAX, buildMs: build }));
const pt = [], et = [];
for (let i = 0; i < turns && !b.over; i++) {
  t0 = Date.now(); autoPlayerTurn(st); pt.push(Date.now() - t0);
  for (const u of b.units) if (u.kind === "zombie" && !u.dead) u.aware = true;
  t0 = Date.now(); runEnemyPhase(st); et.push(Date.now() - t0);
}
const mean = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
console.log(JSON.stringify({ turns: et.length, playerMs: { mean: mean(pt), worst: Math.max(...pt) }, enemyMs: { mean: mean(et), worst: Math.max(...et) }, turnMs: mean(pt.map((v, i) => v + et[i])), over: b.over }));
t0 = Date.now();
const json = JSON.stringify(serializeState(st, { dropCards: true }));
const ser = Date.now() - t0;
console.log(JSON.stringify({ saveMB: +(json.length / 1048576).toFixed(1), gzipMB: +(gzipSync(json).length / 1048576).toFixed(2), serializeMs: ser }));
