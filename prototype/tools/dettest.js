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
// Usage: node tools/dettest.js [days] [seeds...]
import { createWorld, tickHour, day, newId, hub, atBase } from "../src/sim/world.js";
import { createBattle, transformBattle, autoPlayerTurn, runEnemyPhase, registerCombatHandler } from "../src/sim/combat.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { partyTile } from "../src/sim/parties.js";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const fresh = process.argv[2] === "--digest"; // child mode: print the digest hash of one fresh run
const args = fresh ? process.argv.slice(3) : process.argv.slice(2);
const days = Number(args[0] || 60);
const seeds = args.length > 1 ? args.slice(1).map(Number) : [42, 7, 1234];
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };

const r3 = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : v);
const roundAll = (o) => JSON.parse(JSON.stringify(o, (k, v) => r3(v)));

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

// Ids (values, numeric strings, and numbers inside object keys such as "388|389") → their offset from the world's
// first id, so the same ids handed out in the same order compare equal.
function normalizeIds(obj, id0, id1) {
  const isId = (v) => Number.isInteger(v) && v > id0 && v < id1;
  const map = (v) => (isId(v) ? `#${v - id0}` : v);
  const fix = (o) => {
    if (Array.isArray(o)) return o.map(fix);
    if (o && typeof o === "object") {
      const out = {};
      for (const [k, v] of Object.entries(o)) out[k.replace(/\d{7,}/g, (x) => map(Number(x)))] = fix(v);
      return out;
    }
    if (typeof o === "string" && /^\d{7,}$/.test(o)) return map(Number(o));
    return map(o);
  };
  return JSON.stringify(fix(obj));
}

function digest({ st, lines, id0, id1 }) {
  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
  const d = {
    day: day(st), hour: st.hour, over: !!st.gameOver, rng: st.rng ? st.rng.state : null,
    bases: st.bases.map((b) => ({
      id: b.id, name: b.name, type: b.type, tile: b.tile, stock: b.stock, buildings: b.buildings.map((x) => pick(x, ["id", "type", "wear", "broken", "rigged", "built"])),
      construction: b.construction.map((c) => pick(c, ["type", "progress", "hours"])), repairs: b.repairs || [], pump: b.pump || null,
      armory: (b.armory || []).map((g) => [g.key, g.q, g.uses]), radio: !!b.radio, dog: b.dog ? b.dog.name : null,
    })),
    survivors: st.survivors.map((s) => ({
      id: s.id, name: s.name, alive: s.alive, health: s.health, mood: s.mood, role: s.role, skills: s.skills, xp: s.xp, perks: s.perks,
      traits: s.traits, location: s.location, wounds: (s.conditions || []).map((c) => [c.key, c.sev]), rec: s.rec,
    })),
    parties: st.parties.map((p) => ({ id: p.id, owner: p.owner, kind: p.kind, mission: p.mission, tile: partyTile(p), phase: p.phase || null, cargo: p.cargo ? Object.fromEntries(Object.entries(p.cargo).filter(([, v]) => typeof v === "number")) : null })),
    hordes: st.hordes.map((h) => pick(h, ["id", "tile", "size", "target", "boss", "mode"])),
    hives: (st.hives || []).map((h) => pick(h, ["id", "tile", "res", "alive", "stage"])),
    factions: st.factions.map((f) => pick(f, ["id", "name", "type", "alive", "pop", "bases", "goodwill", "known", "stock", "atWar"])),
    diplo: st.diplo || null, jobs: st.jobs || null, alliance: st.alliance || null, tech: st.tech || null,
    prisoners: (st.prisoners || []).map((p) => pick(p, ["id", "name", "factionId", "at", "mode", "opinion", "unfed"])),
    crashes: st.crashes || null, rel: st.rel || null, stats: st.stats, lines,
  };
  return normalizeIds(roundAll(d), id0, id1);
}

function firstDiff(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return `at char ${i}: …${a.slice(Math.max(0, i - 120), i + 80)}… vs …${b.slice(Math.max(0, i - 120), i + 80)}…`;
}
function same(label, A, B) {
  const da = digest(A), db = digest(B);
  if (!check(da === db, `${label}: digests differ ${firstDiff(da, db)}`)) {
    let i = 0;
    while (i < A.lines.length && i < B.lines.length && A.lines[i] === B.lines[i]) i++;
    if (i < A.lines.length || i < B.lines.length) console.log(`    first different log line (${i}): A "${A.lines[i]}" / B "${B.lines[i]}"`);
  }
  return da === db;
}

const hashOf = (s) => createHash("sha1").update(s).digest("hex");
if (fresh) { console.log(hashOf(digest(run(seeds[0])))); process.exit(0); }

const t0 = performance.now();
console.log(`Same seed twice in one process (${days} days, Balanced autopilot)`);
for (const s of seeds) {
  const A = run(s), B = run(s);
  if (same(`seed ${s}, world B after world A`, A, B)) console.log(`  seed ${s}: identical (${A.lines.length} log lines, day ${day(A.st) - 1}${A.st.gameOver ? ", game over" : ""}, ${A.st.survivors.filter((x) => x.alive).length} alive)`);
}
console.log("With a world on another seed (and another style) run in between");
for (let i = 0; i < seeds.length; i++) {
  const s = seeds[i], other = seeds[(i + 1) % seeds.length] + 1;
  const A = run(s);
  run(other, i % 2 ? "aggressive" : "cautious", Math.ceil(days / 2));
  const B = run(s);
  if (same(`seed ${s}, after a world on seed ${other}`, A, B)) console.log(`  seed ${s} after seed ${other}: identical`);
}
console.log("A world on another seed first, then the seed (a fresh world's ids start higher)");
{
  const s = seeds[0];
  run(seeds[1] || s + 1, "balanced", days);
  const A = run(s), B = run(s);
  if (same(`seed ${s}, both after another world`, A, B)) console.log(`  seed ${s}: identical`);
}
console.log("The same run in a fresh process");
{
  const s = seeds[0];
  const here = hashOf(digest(run(s)));
  const there = execFileSync(process.execPath, [fileURLToPath(import.meta.url), "--digest", String(days), String(s)], { encoding: "utf8" }).trim();
  if (check(here === there, `seed ${s}: this process (after other worlds) and a fresh one differ (${here} vs ${there})`)) console.log(`  seed ${s}: identical to a fresh process (${here.slice(0, 12)})`);
}
console.log("A battle with another world's battle set up halfway (combat.js grid size per battle)");
{
  registerCombatHandler("dettest", () => {});
  const battle = (seed, other) => {
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
  };
  for (const s of seeds) {
    const alone = battle(s, false), mixed = battle(s, true);
    if (check(alone === mixed, `seed ${s}: the battle plays out differently with another battle set up halfway`)) console.log(`  seed ${s}: identical`);
  }
}
console.log(`\n${passes} passed, ${fails} failed. (${Math.round(performance.now() - t0)} ms)`);
process.exit(fails ? 1 : 0);
