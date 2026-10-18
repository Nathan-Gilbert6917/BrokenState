// Where a headless campaign spends its time (docs/prompts/performance.md, PERF-0): plays one campaign and times every
// hour (sim/world.js tickHour): the average and percentiles of an hour, the hours over 60 ms and their hour of the day
// (0 is the daily tick), the first midnight on its own (the cold costs: arsenal.js kitRef, the first market refresh).
// --stages times each call of the hour (world.js hourOfWorld: weatherHour, movePartiesHour, factionsDaily...): a copy
// of src/ in a temp folder with each `xxxHour(state)` / `xxxDaily(state)` call wrapped in a timer, so the game's own
// files are never touched. --slow N names the stages behind the N slowest hours.
// For a CPU profile of the same run: node --cpu-prof --cpu-prof-dir=/tmp/prof tools/perfprofile.js ..., then
// tools/perfcpu.js reads it.
// Usage: node tools/perfprofile.js [days=120] [seed=3] [size] [--groups 8] [--autopilot balanced|aggressive|cautious|off]
//                                  [--stages] [--slow 10] [--mode normal|hardcore]
//   size: small, normal, large or huge (also size=huge or --size=huge; tools/sizearg.js). With the autopilot off
//   nobody plays: the hub runs down and the run ends early (about day 56 on seed 3), so it measures the world's own tick.
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { takeSize } from "./sizearg.js";
import { WORLD_SIZES } from "../src/sim/worldsize.js";

const size = takeSize();
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] != null && !args[i + 1].startsWith("--") ? args[i + 1] : dflt; };
const flag = (name) => args.includes(`--${name}`);
const valued = new Set(["--groups", "--autopilot", "--slow", "--mode"]);
const pos = args.filter((a, i) => !a.startsWith("--") && !valued.has(args[i - 1]));
const days = Number(pos[0] || 120), seed = Number(pos[1] || 3);
const groups = Number(opt("groups", 8)), style = opt("autopilot", "balanced"), mode = opt("mode", "normal");
const stages = flag("stages") || flag("slow"), slowN = Number(opt("slow", stages ? 10 : 0));

// ---------- the sim: the repo's own, or a copy with the hour's calls timed ----------
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
let simDir = join(SRC, "sim");
if (stages) {
  const tmp = mkdtempSync(join(tmpdir(), "perfprofile-"));
  process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));
  cpSync(SRC, join(tmp, "src"), { recursive: true });
  writeFileSync(join(tmp, "package.json"), '{ "type": "module" }\n');
  simDir = join(tmp, "src", "sim");
  const file = join(simDir, "world.js");
  const text = readFileSync(file, "utf8");
  const head = text.indexOf("function hourOfWorld(state)");
  if (head < 0) throw new Error("perfprofile: world.js hourOfWorld not found (renamed?): --stages needs it");
  const open = text.indexOf("\n", head), close = text.indexOf("\n}\n", open);
  const SKIP = new Set(["day", "alive", "log", "hourOfWorld"]);
  const body = text.slice(open, close).replace(/\b([a-zA-Z]+)\(state(?:, "[a-z]+")?\)/g, (call, name) => (SKIP.has(name) ? call : `__stage(${JSON.stringify(name)}, () => ${call})`));
  const timer = `
const __stages = (globalThis.__perfStages = { tot: {}, max: {}, cnt: {}, hour: {} });
function __stage(name, fn) {
  const t = performance.now();
  try { return fn(); } finally {
    const d = performance.now() - t;
    __stages.tot[name] = (__stages.tot[name] || 0) + d; __stages.cnt[name] = (__stages.cnt[name] || 0) + 1;
    if (d > (__stages.max[name] || 0)) __stages.max[name] = d;
    __stages.hour[name] = (__stages.hour[name] || 0) + d;
  }
}
`;
  writeFileSync(file, text.slice(0, head) + timer + text.slice(head, open) + body + text.slice(close));
}
const sim = pathToFileURL(simDir + "/").href;
const { createWorld, tickHour, day } = await import(sim + "world.js");
const { setAutopilot } = await import(sim + "autopilot.js");

// ---------- the run ----------
const t0 = performance.now();
const state = createWorld({ seed, factionCount: groups, size, mode });
const createMs = performance.now() - t0;
state.started = true;
if (style !== "off") setAutopilot(state, true, style);
const S = globalThis.__perfStages;
const hours = []; // { ms, hour, top }
let firstMidnight = null;
const t1 = performance.now();
while (day(state) <= days && !state.gameOver) {
  if (S) S.hour = {};
  const t = performance.now();
  tickHour(state);
  const ms = performance.now() - t;
  hours.push({ ms, hour: state.hour, stages: S ? S.hour : null });
  if (firstMidnight == null && state.hour % 24 === 0) firstMidnight = ms;
}
const runMs = performance.now() - t1;

// ---------- the report ----------
const sorted = hours.map((h) => h.ms).sort((a, b) => a - b);
const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 0;
const f = (v, d = 1) => v.toFixed(d);
const when = (h) => `day ${Math.floor(h / 24) + 1} ${String(h % 24).padStart(2, "0")}:00`; // the hour the tick ended on (00:00 is the daily tick)
const worst = hours.reduce((a, h) => (h.ms > a.ms ? h : a), { ms: 0, hour: 0 });
const mids = hours.filter((h) => h.hour % 24 === 0).slice(1);
const slow = hours.filter((h) => h.ms > 60);
const byHod = {};
for (const h of slow) byHod[h.hour % 24] = (byHod[h.hour % 24] || 0) + 1;
console.log(`Seed ${seed}, ${(WORLD_SIZES[size] || {}).label || size} map, ${groups} groups, ${mode}, autopilot ${style}: ${hours.length} hours (to day ${day(state) - 1}${state.gameOver ? ", game over" : ""}) in ${f(runMs / 1000)} s${stages ? " (stage timers on)" : ""}`);
console.log(`  createWorld ${f(createMs, 0)} ms`);
console.log(`  an hour: avg ${f(runMs / Math.max(1, hours.length), 2)} ms, p50 ${f(q(0.5), 2)}, p90 ${f(q(0.9), 2)}, p99 ${f(q(0.99), 1)}, worst ${f(worst.ms, 0)} (${when(worst.hour)})`);
console.log(`  the first midnight ${firstMidnight == null ? "-" : f(firstMidnight, 0)} ms; later midnights avg ${mids.length ? f(mids.reduce((a, h) => a + h.ms, 0) / mids.length) : "-"} ms, worst ${mids.length ? f(Math.max(...mids.map((h) => h.ms)), 0) : "-"} ms`);
console.log(`  hours over 60 ms: ${slow.length}${slow.length ? ` (by hour of the day: ${Object.entries(byHod).map(([h, n]) => `${h}h ×${n}`).join(", ")})` : ""}`);
if (S) {
  const rows = Object.keys(S.tot).map((k) => ({ k, tot: S.tot[k], cnt: S.cnt[k], max: S.max[k] })).sort((a, b) => b.tot - a.tot);
  console.log(`\n  ${"stage".padEnd(22)} ${"total ms".padStart(9)} ${"calls".padStart(7)} ${"avg ms".padStart(8)} ${"worst ms".padStart(9)} ${"share".padStart(6)}`);
  for (const r of rows.slice(0, 30)) console.log(`  ${r.k.padEnd(22)} ${f(r.tot, 0).padStart(9)} ${String(r.cnt).padStart(7)} ${f(r.tot / r.cnt, 2).padStart(8)} ${f(r.max, 0).padStart(9)} ${f((100 * r.tot) / runMs).padStart(5)}%`);
}
if (slowN) {
  console.log(`\n  the ${slowN} slowest hours`);
  for (const h of [...hours].sort((a, b) => b.ms - a.ms).slice(0, slowN)) {
    const top = h.stages ? Object.entries(h.stages).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${f(v, 0)}`).join(", ") : "";
    console.log(`  ${f(h.ms, 0).padStart(6)} ms  ${when(h.hour)}  ${top}`);
  }
}
