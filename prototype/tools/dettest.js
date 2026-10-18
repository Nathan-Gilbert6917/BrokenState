// Determinism across worlds in one process: the sim's results must depend only on the seed and the actions, never
// on process-global counters (world.js newId), object identity, Date or Math.random, or module state left over
// from an earlier world. For each seed: world A runs N days on the Balanced autopilot, then world B (same seed,
// made in the same process after A) runs the same N days; a digest of the state (stocks, buildings, repairs,
// survivors' health / skills / mood / place, parties, hordes, hives, factions, diplomacy, prisoners, crashes, tech
// and every log line) must be identical. Ids (world.js newId is process-wide, so world B's start higher) are
// compared by their offset from the first id of their own world. Then the same with a world on another seed (and
// another autopilot style) run in between, with another world first, and against the same run in a fresh process.
// Last, a tactical battle is played alone and with another world's battle (on a map turned to 13 x 18) set up while
// it is under way (combat.js keeps the grid size of the battle being set up): the same.
// The checks run side by side in worker threads (tools/pool.js): each check's worlds in one thread, in the order it
// needs them; --workers 1 runs them one after another.
// Usage: node tools/dettest.js [days] [seeds...] [--workers N]
import { createWorld, tickHour, day, newId, hub, atBase } from "../src/sim/world.js";
import { createBattle, transformBattle, autoPlayerTurn, runEnemyPhase, registerCombatHandler } from "../src/sim/combat.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { digest } from "./digest.js";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { pool, serve, isMainThread, workerCount, withoutWorkers } from "./pool.js";

const fresh = process.argv[2] === "--digest"; // child mode: print the digest hash of one fresh run
const args = withoutWorkers(fresh ? process.argv.slice(3) : process.argv.slice(2));
const days = Number(args[0] || 60);
const seeds = args.length > 1 ? args.slice(1).map(Number) : [42, 7, 1234];

// World ids come from world.js newId, one counter for the whole process. Each world here starts its ids at the next
// multiple of a million (taking ids changes nothing in a world), so any id in the digest is a number in
// (id0, id1), and world-local numbers (hive, crash, war and job numbers, tiles, stocks) are far below that.
const ID_STEP = 1e6;
function run(seed, style = "balanced", n = days) {
  let id0 = newId();
  while (id0 % ID_STEP) id0 = newId();
  const st = createWorld({ seed, factionCount: 8 });
  st.started = true;
  setAutopilot(st, true, style);
  // Every log line of the run (state.log keeps the last 200), oldest first.
  const lines = st.log.slice().reverse().map((l) => `${l.hour} ${l.text}`);
  const unshift = st.log.unshift;
  st.log.unshift = function (...x) { for (const l of x) lines.push(`${l.hour} ${l.text}`); return unshift.apply(this, x); };
  while (day(st) <= n && !st.gameOver) tickHour(st);
  return { st, lines, id0, id1: newId() };
}

function firstDiff(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return `at char ${i}: …${a.slice(Math.max(0, i - 120), i + 80)}… vs …${b.slice(Math.max(0, i - 120), i + 80)}…`;
}
// Two runs compared: { ok, lines } (the lines say where they part).
function same(label, A, B) {
  const da = digest(A), db = digest(B);
  if (da === db) return { ok: true, lines: [] };
  const lines = [`  FAIL: ${label}: digests differ ${firstDiff(da, db)}`];
  let i = 0;
  while (i < A.lines.length && i < B.lines.length && A.lines[i] === B.lines[i]) i++;
  if (i < A.lines.length || i < B.lines.length) lines.push(`    first different log line (${i}): A "${A.lines[i]}" / B "${B.lines[i]}"`);
  return { ok: false, lines };
}

const hashOf = (s) => createHash("sha1").update(s).digest("hex");
if (fresh) { console.log(hashOf(digest(run(seeds[0])))); process.exit(0); }

// ---------- the checks, one job each (a job's worlds run in one thread, in order) ----------
const ok = (line) => ({ ok: true, lines: [line] });
// A battle at the hub played out by the AI, with or without another world's battle (on a map turned to 13 x 18) set
// up while it is under way.
function battle(seed, other) {
  registerCombatHandler("dettest", () => {});
  const st = createWorld({ seed, factionCount: 6 });
  const base = hub(st);
  const people = atBase(st, base.id).slice(0, 3);
  st.combat = createBattle(st, { tile: base.tile, baseId: base.id, fighterIds: people.map((s) => s.id), enemy: { kind: "raiders", count: 4, power: 4 }, ambush: null, canRetreat: false, handler: "dettest" });
  const b = st.combat;
  for (let g = 0; g < 60 && !b.over; g++) {
    if (other && g === 1) {
      const o = createWorld({ seed: seed + 1, factionCount: 6 });
      const oh = hub(o);
      o.combat = createBattle(o, { tile: oh.tile, baseId: oh.id, fighterIds: atBase(o, oh.id).slice(0, 2).map((s) => s.id), enemy: { kind: "zombies", count: 5, power: 2 }, ambush: null, canRetreat: false, handler: "dettest" });
      transformBattle(o.combat, "north");
    }
    autoPlayerTurn(st);
    runEnemyPhase(st);
  }
  return JSON.stringify([b.over, b.turn, b.w, b.h, b.units.map((u) => [u.side, u.x, u.y, u.hp, !!u.dead]), b.log.map((l) => l.text)]);
}
const CHECKS = {
  // The same seed twice in one thread.
  twice({ seed, days: n }) {
    const A = run(seed, "balanced", n), B = run(seed, "balanced", n);
    const c = same(`seed ${seed}, world B after world A`, A, B);
    return c.ok ? ok(`  seed ${seed}: identical (${A.lines.length} log lines, day ${day(A.st) - 1}${A.st.gameOver ? ", game over" : ""}, ${A.st.survivors.filter((x) => x.alive).length} alive)`) : c;
  },
  // A world on another seed (and another style) run in between.
  between({ seed, other, style, days: n }) {
    const A = run(seed, "balanced", n);
    run(other, style, Math.ceil(n / 2));
    const B = run(seed, "balanced", n);
    const c = same(`seed ${seed}, after a world on seed ${other}`, A, B);
    return c.ok ? ok(`  seed ${seed} after seed ${other}: identical`) : c;
  },
  // Another world first, then the seed twice (a fresh world's ids start higher).
  after({ seed, other, days: n }) {
    run(other, "balanced", n);
    const A = run(seed, "balanced", n), B = run(seed, "balanced", n);
    const c = same(`seed ${seed}, both after another world`, A, B);
    return c.ok ? ok(`  seed ${seed}: identical`) : c;
  },
  // This thread (after another world) against a fresh process.
  fresh({ seed, other, days: n }) {
    run(other, "balanced", Math.ceil(n / 2));
    const here = hashOf(digest(run(seed, "balanced", n)));
    const there = execFileSync(process.execPath, [fileURLToPath(import.meta.url), "--digest", String(n), String(seed)], { encoding: "utf8" }).trim();
    return here === there ? ok(`  seed ${seed}: identical to a fresh process (${here.slice(0, 12)})`)
      : { ok: false, lines: [`  FAIL: seed ${seed}: this process (after other worlds) and a fresh one differ (${here} vs ${there})`] };
  },
  battle({ seed }) {
    const alone = battle(seed, false), mixed = battle(seed, true);
    return alone === mixed ? ok(`  seed ${seed}: identical`) : { ok: false, lines: [`  FAIL: seed ${seed}: the battle plays out differently with another battle set up halfway`] };
  },
};
if (!isMainThread) serve((job) => CHECKS[job.kind](job));
else {
  const t0 = performance.now();
  const other = seeds[1] || seeds[0] + 1;
  const SECTIONS = [
    [`Same seed twice in one process (${days} days, Balanced autopilot)`, seeds.map((seed) => ({ kind: "twice", seed }))],
    ["With a world on another seed (and another style) run in between", seeds.map((seed, i) => ({ kind: "between", seed, other: seeds[(i + 1) % seeds.length] + 1, style: i % 2 ? "aggressive" : "cautious" }))],
    ["A world on another seed first, then the seed (a fresh world's ids start higher)", [{ kind: "after", seed: seeds[0], other }]],
    ["The same run in a fresh process", [{ kind: "fresh", seed: seeds[0], other }]],
    ["A battle with another world's battle set up halfway (combat.js grid size per battle)", seeds.map((seed) => ({ kind: "battle", seed }))],
  ];
  const jobs = SECTIONS.flatMap(([, list], si) => list.map((j) => ({ ...j, days, si })));
  // The longest first, so no core waits on one long job at the end (the battles are short).
  const COST = { after: 3, between: 2.5, fresh: 2.5, twice: 2, battle: 0.1 };
  const order = jobs.map((_, i) => i).sort((a, b) => COST[jobs[b].kind] - COST[jobs[a].kind] || a - b);
  const done = await pool(import.meta.url, order.map((i) => jobs[i]), { workers: workerCount(process.argv), onResult: () => process.stdout.write(".") });
  const results = new Array(jobs.length);
  order.forEach((i, k) => { results[i] = done[k]; });
  process.stdout.write("\n");
  let passes = 0, fails = 0;
  SECTIONS.forEach(([title], si) => {
    console.log(title);
    jobs.forEach((j, i) => {
      if (j.si !== si) return;
      const r = results[i];
      if (r.error) { fails++; console.log(`  FAIL: ${j.kind} seed ${j.seed} crashed: ${r.error.split("\n").slice(0, 4).join(" | ")}`); return; }
      if (r.ok) passes++; else fails++;
      for (const l of r.lines) console.log(l);
    });
  });
  console.log(`\n${passes} passed, ${fails} failed. (${Math.round(performance.now() - t0)} ms)`);
  process.exit(fails ? 1 : 0);
}
