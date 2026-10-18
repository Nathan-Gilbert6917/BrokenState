// The golden hashes (docs/prompts/performance.md, PERF-0): a performance change must change how long the game takes,
// never what it does. tools/dettest.js --digest plays one fresh autopilot campaign and prints the hash of its
// determinism digest (tools/digest.js: stocks, survivors, parties, hordes, hives, factions, diplomacy, every log
// line...); this runs it for each golden seed in its own process, side by side, and prints the hashes. Run it on the
// base commit before touching code (--save), and again after (--check): every hash must be the same.
// The hashes change whenever the game changes, so they are never kept in the repo as expected values: each change
// records its own on its own base.
// Usage: node tools/perfgolden.js [--days 60] [--seeds 42,7,1234] [--save file.json] [--check file.json] [--jobs N]
import { execFile } from "node:child_process";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : dflt; };
const days = Number(opt("days", 60));
const seeds = String(opt("seeds", "42,7,1234")).split(",").map(Number);
const saveTo = opt("save", null), checkAgainst = opt("check", null);
const jobs = Math.max(1, Number(opt("jobs", Math.min(seeds.length, Math.max(1, cpus().length)))));
const DETTEST = join(dirname(fileURLToPath(import.meta.url)), "dettest.js");

// One seed's hash from a fresh process (no module state shared with any other world).
const hashOf = (seed) => new Promise((resolve) => {
  execFile(process.execPath, [DETTEST, "--digest", String(days), String(seed)], { encoding: "utf8", maxBuffer: 1 << 26 }, (err, out) => {
    const hash = String(out || "").trim().split("\n").pop();
    resolve(err || !/^[0-9a-f]{40}$/.test(hash) ? { seed, error: String(err ? err.message : out).slice(0, 400) } : { seed, hash });
  });
});

const t0 = Date.now();
const results = [];
let next = 0;
await Promise.all(Array.from({ length: Math.min(jobs, seeds.length) }, async () => {
  while (next < seeds.length) results.push(await hashOf(seeds[next++]));
}));
results.sort((a, b) => seeds.indexOf(a.seed) - seeds.indexOf(b.seed));
console.log(`Golden hashes (${days} days, Balanced autopilot, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
for (const r of results) console.log(`  seed ${String(r.seed).padEnd(6)} ${r.hash || `ERROR ${r.error}`}`);
if (results.some((r) => r.error)) process.exit(1);

const record = { days, seeds: Object.fromEntries(results.map((r) => [r.seed, r.hash])) };
if (saveTo) { writeFileSync(saveTo, JSON.stringify(record, null, 2) + "\n"); console.log(`Saved to ${saveTo}.`); }
if (checkAgainst) {
  const want = JSON.parse(readFileSync(checkAgainst, "utf8"));
  if (want.days !== days) { console.log(`FAIL: ${checkAgainst} was recorded over ${want.days} days, this run is ${days}.`); process.exit(1); }
  const differ = results.filter((r) => want.seeds[r.seed] != null && want.seeds[r.seed] !== r.hash).map((r) => r.seed);
  const missing = results.filter((r) => want.seeds[r.seed] == null).map((r) => r.seed);
  if (missing.length) console.log(`  (not in ${checkAgainst}: ${missing.join(", ")})`);
  if (differ.length) { console.log(`FAIL: the game plays differently on seed ${differ.join(", ")}: not a pure speedup.`); process.exit(1); }
  console.log(`Identical to ${checkAgainst}.`);
}
