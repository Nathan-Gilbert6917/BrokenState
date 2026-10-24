// Same seed, same game, in one process: world ids come from one process-wide counter (world.js newId), so a second
// world made from the same seed in the same process hands out other ids. Nothing a world rolls may depend on that: any
// id fed to the dice (hash01, an Rng seed, id arithmetic) must be world-local (world.js localId, a world serial, a
// battle's own unit numbers, a tile). For each seed and autopilot style: world A runs N days, then world B (same seed,
// same style, made after A in the same process, so every id is at least a million higher) runs the same N days, and
// their states must match: survivors alive and their health / skills / place, every base's stocks, each group's
// strength, population and stores, parties, hordes, hives, diplomacy and a hash of every log line (tools/digest.js,
// with ids written as offsets from each world's first id). The autopilot plays its battles out (live tactical battles
// and fights by the numbers); the run counts the tactical ones so a quiet run is visible.
// Each pair of worlds (and each battle pair) runs in a worker thread of its own, side by side (tools/pool.js);
// --workers 1 runs them one after another.
// Usage: node tools/sameseedtest.js [days=120] [seeds=42,7,1234,99] [styles=balanced,aggressive,cautious] [mode=normal|hardcore] [--workers N]
// Quick form (BS_QUICK=1, npm run test:quick): 25 days on seed 42 in the three styles, the seed's seven battles on its
// world after 5 days, on 2 workers; the same checks on less (the full form: about 13 minutes alone).
import { createWorld, tickHour, day, newId, hub, atBase } from "../src/sim/world.js";
import { createBattle, autoPlayerTurn, runEnemyPhase, registerCombatHandler } from "../src/sim/combat.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { strength } from "../src/sim/factions.js";
import { digest } from "./digest.js";
import { createHash } from "node:crypto";
import { pool, serve, isMainThread, workerCount, withoutWorkers } from "./pool.js";

const QUICK = !!process.env.BS_QUICK;
const argv = withoutWorkers(process.argv.slice(2));
const days = Number(argv[0] || (QUICK ? 25 : 120));
const BATTLE_DAY = QUICK ? 5 : 10; // the battles at the hub are fought on the seed's world after this many days
const seeds = (argv[1] || (QUICK ? "42" : "42,7,1234,99")).split(",").map(Number);
const styles = (argv[2] || "balanced,aggressive,cautious").split(",");
const mode = argv[3] || "normal"; // or "hardcore"
const sha = (s) => createHash("sha1").update(s).digest("hex");

// Each world's ids start at the next multiple of a million (tools/digest.js normalizeIds), so world B's ids are
// never world A's.
const ID_STEP = 1e6;
function run(seed, style, days, mode) {
  let id0 = newId();
  while (id0 % ID_STEP) id0 = newId();
  const st = createWorld({ seed, factionCount: 8, mode });
  st.started = true;
  setAutopilot(st, true, style);
  const lines = st.log.slice().reverse().map((l) => `${l.hour} ${l.text}`);
  const unshift = st.log.unshift;
  st.log.unshift = function (...x) { for (const l of x) lines.push(`${l.hour} ${l.text}`); return unshift.apply(this, x); };
  // Tactical battles: each new state.combat (the autopilot plays them to the end within the hour).
  let combat = st.combat, battles = 0;
  Object.defineProperty(st, "combat", { get: () => combat, set: (v) => { if (v && v !== combat) battles++; combat = v; }, enumerable: true, configurable: true });
  while (day(st) <= days && !st.gameOver) tickHour(st);
  const id1 = newId();
  return { st, lines, id0, id1, battles };
}
// The headline numbers (printed, and compared on their own so a failure says what moved).
function summary({ st, lines, battles }) {
  const stock = {};
  for (const b of st.bases) for (const [k, v] of Object.entries(b.stock || {})) if (typeof v === "number") stock[k] = Math.round(((stock[k] || 0) + v) * 1000) / 1000;
  return {
    day: day(st) - 1, over: !!st.gameOver,
    alive: st.survivors.filter((s) => s.alive).map((s) => s.name).sort(),
    stock,
    groups: st.factions.map((f) => [f.name, !!f.alive, f.pop, Math.round(strength(f) * 1000) / 1000]),
    battles, logLines: lines.length, logHash: sha(lines.join("\n")).slice(0, 12),
  };
}

// One pair: world A then world B on the same seed and style, in one thread: { ok, line(s) }.
function pair({ seed, style, days, mode }) {
  const A = run(seed, style, days, mode), B = run(seed, style, days, mode);
  const sa = summary(A), sb = summary(B);
  const da = digest(A), db = digest(B);
  const head = `seed ${seed} ${style}`;
  const bits = Object.keys(sa).filter((k) => JSON.stringify(sa[k]) !== JSON.stringify(sb[k]));
  if (da === db && !bits.length) {
    const str = sa.groups.filter((g) => g[1]).reduce((a, g) => a + g[3], 0);
    return { ok: true, lines: [`  ${head}: identical (day ${sa.day}${sa.over ? ", game over" : ""}, ${sa.alive.length} alive, ${sa.groups.filter((g) => g[1]).length} groups strength ${Math.round(str)}, ${sa.battles} tactical battles, ${sa.logLines} log lines ${sa.logHash}; ids from ${A.id0} and ${B.id0})`] };
  }
  const lines = [`  FAIL ${head}: ${bits.length ? `differs in ${bits.join(", ")}` : "the full digest differs"}`];
  let i = 0;
  while (i < da.length && i < db.length && da[i] === db[i]) i++;
  lines.push(`    digest at char ${i}: …${da.slice(Math.max(0, i - 120), i + 80)}… vs …${db.slice(Math.max(0, i - 120), i + 80)}…`);
  let j = 0;
  while (j < A.lines.length && j < B.lines.length && A.lines[j] === B.lines[j]) j++;
  if (j < A.lines.length || j < B.lines.length) lines.push(`    first different log line (${j}): A "${A.lines[j]}" / B "${B.lines[j]}"`);
  return { ok: false, lines };
}
// The autopilot plays few tactical battles, so: a battle at the hub against each kind of enemy (soldiers bring armour
// plates, launchers, rigs and medics; guards tactical vests; zombies the dead), on the seed's world after 10 days,
// played out by the autopilot's turns: world A, then world B (same seed, made after A) must fight it the same way.
const KINDS = ["raiders", "soldiers", "guards", "fighters", "militia", "zealots", "zombies"];
function battle(seed, kind, mode) {
  registerCombatHandler("sameseed", () => {});
  let id0 = newId();
  while (id0 % ID_STEP) id0 = newId();
  const st = createWorld({ seed, factionCount: 8, mode });
  st.started = true;
  setAutopilot(st, true, "balanced");
  while (day(st) <= BATTLE_DAY && !st.gameOver) tickHour(st);
  setAutopilot(st, false);
  const base = hub(st);
  const people = atBase(st, base.id).filter((s) => s.alive).slice(0, 4);
  if (!people.length) return null;
  st.combat = createBattle(st, { tile: base.tile, baseId: base.id, fighterIds: people.map((s) => s.id), enemy: { kind, count: 5, power: kind === "zombies" ? 3 : 5 }, ambush: null, canRetreat: false, handler: "sameseed" });
  const b = st.combat;
  for (let g = 0; g < 80 && !b.over; g++) { autoPlayerTurn(st); runEnemyPhase(st); }
  const units = b.units.map((u) => [u.side, u.name, u.x, u.y, u.hp, !!u.dead, !!u.down, u.bleeding || 0, u.staggered || 0,
    u.pieces ? Object.values(u.pieces).map((x) => (x ? `${x.key}:${x.dur}` : "")) : null, u.gl ? 1 : 0, u.rigKey || "", u.medKit ? u.medKit.key : "", u.selfKits ? u.selfKits.length : 0]);
  return { key: JSON.stringify([b.over, b.turn, units, b.log.map((l) => l.text)]), turns: b.turn, lines: b.log.length };
}
// One kind's battle on world A, then on world B: null when the same, else what went wrong.
function battlePair({ seed, kind, mode }) {
  const A = battle(seed, kind, mode), B = battle(seed, kind, mode);
  return !A || !B ? `${kind}: no one to fight` : A.key === B.key ? null : `${kind}: differs`;
}

if (!isMainThread) serve((job) => (job.kind === "pair" ? pair(job) : battlePair(job)));
else {
  const t0 = performance.now();
  const pairs = seeds.flatMap((seed) => styles.map((style) => ({ kind: "pair", seed, style, days, mode })));
  const battles = seeds.flatMap((seed) => KINDS.map((kind) => ({ kind, seed, mode })));
  const jobs = [...pairs, ...battles]; // the long campaigns first
  const res = await pool(import.meta.url, jobs, { workers: workerCount(process.argv, QUICK ? 2 : null), onResult: () => process.stdout.write(".") });
  process.stdout.write("\n");
  let fails = 0, passes = 0;
  const crash = (j, r) => `${j.kind === "pair" ? `seed ${j.seed} ${j.style}` : `seed ${j.seed} ${j.kind}`} crashed: ${r.error.split("\n").slice(0, 4).join(" | ")}`;
  console.log(`Same seed twice in one process (${mode}): ${days} days, seeds ${seeds.join(", ")}, styles ${styles.join(", ")}`);
  pairs.forEach((j, i) => {
    const r = res[i];
    if (r && r.error) { fails++; console.log(`  FAIL ${crash(j, r)}`); return; }
    if (r.ok) passes++; else fails++;
    for (const l of r.lines) console.log(l);
  });
  console.log(`Tactical battles at the hub after ${BATTLE_DAY} days, every enemy kind`);
  for (const seed of seeds) {
    const bad = [];
    battles.forEach((j, k) => {
      if (j.seed !== seed) return;
      const r = res[pairs.length + k];
      if (r && r.error) bad.push(crash(j, r));
      else if (r) bad.push(r);
    });
    if (!bad.length) { passes++; console.log(`  seed ${seed}: ${KINDS.length} battles identical`); }
    else { fails++; console.log(`  FAIL seed ${seed}: ${bad.join("; ")}`); }
  }
  console.log(`\n${passes} passed, ${fails} failed. (${Math.round((performance.now() - t0) / 1000)} s)`);
  process.exit(fails ? 1 : 0);
}
