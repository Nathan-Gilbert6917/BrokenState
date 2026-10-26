// The merge gate for dev (issue #46): run it before merging to dev; a merge that adds a failing check is not done.
// Runs the typecheck and a fixed core set of shared tests in parallel, reads every FAIL line they print, and compares
// those check names with tools/gate-baseline.json (the checks known to fail on dev, owned by other tickets).
//   - a check failing that is not in the baseline: printed under "New failures", exit 1;
//   - a baseline check that now passes: printed under "Fixed"; --update drops it from the baseline. The baseline only
//     ever shrinks: --update never adds a check (a new failure is fixed, not baselined).
//   - --against <ref>: runs the same tests in a temporary worktree of <ref> too and diffs the check names, failing
//     here only, there only and on both (how a session proves a failure is old). Exit 1 when one fails here only.
// A check's name is the test's file name and its FAIL line, with every number written # (the counts in a message
// change from run to run; the check stays the same) and cut at 200 characters. A test that crashes or times out
// with no FAIL line counts as the check "<test>: exit <code>" / "<test>: timed out".
// Usage (from prototype/): node tools/gate.js [--against <ref>] [--update] [--jobs N] [--timeout seconds] [test...]
//   test: run these tests (file-name substrings) instead of the core set, against the same baseline.
// Not named *test*, so runtests.js never runs it.
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { cpus, tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const proto = dirname(here);
const BASELINE = join(here, "gate-baseline.json");
// The core set: [test, quick]. quick runs it with BS_QUICK=1 (fewer seeds, the same checks); shopstest and
// interiortest run at their full seeds, as the epic asks before every merge.
const CORE = [
  ["typechecktest", false], ["shopstest", false], ["interiortest", false], ["storeytest", false],
  ["scaletest", true], ["varianttest", true], ["itemarttest", false], ["furnituretest", false],
  ["citycrawltest", false], ["scenestest", false], ["basefurnituretest", false], ["malltest", true],
  ["neighbourhoodtest", false], ["shopvarianttest", false],
  ["carryplaytest", true], // #48: the carry playthrough (raid, crawl, base; one and two survivors, with and without a vehicle); quick: seeds 42 and 5
  ["loottest", false], ["gunmodtest", false], // #45: they run again since the skills import cycle broke (skillmilestones.js)
  // #63: red tests made green, kept so (each under 5 minutes alone on 2026-10-26: seasonground 6 s, puddle 7 s,
  // zombiesfx 14 s, siege 28 s, allyorders 25 s, hivebirth 60 s, sizetest 160 s, rescue 220 s, hiveplus 300 s); hivetest
  // (47 minutes) is left out
  ["seasongroundtest", false], ["puddletest", false], ["zombiesfxtest", false], ["siegetest", false],
  ["allyorderstest", false], ["hivebirthtest", false], ["sizetest", false], ["rescuetest", false], ["hiveplustest", false],
  ["stealthtest", true], // quick: 20-day soaks, 160 prisoners a setup; about 3 minutes
  // #63's later twelve made green (alone on 2026-10-26: basestorage 7 s, basestorageui 14 s, basestoragemap 12 s,
  // ailocks 6 s, floorfolk 19 s, field 36 s, basebuildauto 50 s, bridge 83 s); left out: basetest (7 minutes), medstest
  // (25 minutes of CPU), and depletetest and exploretest (quick about 2 minutes each, in child processes; left out while
  // citycrawltest ran at 1748 s of its 1800 in the gate, before #74 split it)
  ["basestoragetest", false], ["basestorageuitest", false], ["basestoragemaptest", false], ["ailockstest", false],
  ["floorfolktest", false], ["fieldtest", false], ["basebuildautotest", false], ["bridgetest", false],
  // #72: red tests made green, kept so (officestest 80 s, plannametest 65 s in the gate on 2026-10-26); savetest is left out,
  // too long (quick: 8 minutes alone, 12 in the gate, where it pushed citycrawltest past the time limit; full: over 30)
  ["officestest", false], ["plannametest", false],
  // #73: red tests made green, kept so (alone on 2026-10-26: occupytest 274 s, farmtest quick 323 s); left out, too long:
  // custompointstest (12 minutes), hcstarttest (16), uitest (12) and farmtest at full length (17)
  ["occupytest", false], ["farmtest", true],
  // #74: citycrawltest split in four, side by side (its sections 1-5; the grid, saving and 10a-10d; 10e's quick search by
  // kind, every other kind in each; the shared setup in citycrawlkit.js), scenestest at full seeds (above; 141 s alone),
  // indoorlighttest (14 s alone)
  ["citycrawlgridtest", false], ["citycrawlquicktest", false], ["citycrawlquick2test", false], ["indoorlighttest", false],
  // #75: red tests made green, kept so (alone on 2026-10-26: landorder 10 s, detach 11 s, claims 17 s, guide 30 s,
  // teamctx 33 s)
  ["landordertest", false], ["detachtest", false], ["claimstest", false], ["guidetest", false], ["teamctxtest", false],
];

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const against = opt("--against", null);
const jobs = Number(opt("--jobs", Math.max(1, cpus().length)));
const timeout = Number(opt("--timeout", 1800)) * 1000;
const update = flag("--update");
const picked = args.length
  ? readdirSync(here).filter((f) => /test.*\.js$/.test(f) && f !== "runtests.js" && args.some((p) => f.includes(p))).map((f) => [f.replace(/\.js$/, ""), (CORE.find(([t]) => t + ".js" === f) || [, false])[1]])
  : CORE;
if (!picked.length) { console.log(`no test matches ${args.join(" ")}`); process.exit(2); }

const checkName = (test, line) => `${test}: ${line.replace(/\d+(\.\d+)?/g, "#").replace(/\s+/g, " ").trim().slice(0, 200)}`;
// The failing checks in one test's output.
function failures(test, out, code, timedOut) {
  const names = new Set();
  for (const line of out.split("\n")) {
    const m = line.match(/^\s*FAIL\b:?\s*(.*)$/);
    if (m) names.add(checkName(test, m[1]));
  }
  if (timedOut) names.add(`${test}: timed out`);
  else if (code !== 0 && !names.size) names.add(`${test}: exit ${code}`);
  return [...names];
}

function runOne(dir, test, quick) {
  return new Promise((res) => {
    const file = join(dir, "tools", test + ".js");
    if (!existsSync(file)) return res({ test, missing: true, fails: [], secs: 0 });
    const start = Date.now();
    const child = spawn(process.execPath, [file], { cwd: dir, env: quick ? { ...process.env, BS_QUICK: "1" } : { ...process.env, BS_QUICK: "" }, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let out = "", timedOut = false;
    const keep = (d) => { out += d; if (out.length > 8e6) out = out.slice(-4e6); };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }, timeout);
    child.on("close", (code) => {
      clearTimeout(timer);
      res({ test, code, out, fails: failures(test, out, code, timedOut), secs: (Date.now() - start) / 1000 });
    });
  });
}

// Runs every [dir, test, quick] job, a few at a time; the longest tests first, so the set ends sooner.
async function runAll(list) {
  const results = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      const [dir, test, quick, label] = list[i];
      const r = await runOne(dir, test, quick);
      results[i] = { ...r, label };
      console.log(`${r.missing ? "--  " : r.fails.length ? "FAIL" : "ok  "} ${label ? label + " " : ""}${test} (${r.missing ? "not in this tree" : r.secs.toFixed(0) + "s" + (r.fails.length ? `, ${r.fails.length} failing` : "")})`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, list.length) }, worker));
  return results;
}

const ORDER = ["citycrawlquicktest", "citycrawlquick2test", "citycrawlgridtest", "citycrawltest", "interiortest", "varianttest", "shopstest", "scenestest", "shopvarianttest", "storeytest", "scaletest"]; // slowest first
const sorted = [...picked].sort((a, b) => (ORDER.indexOf(a[0]) + 1 || 99) - (ORDER.indexOf(b[0]) + 1 || 99));
const t0 = Date.now();
let otherDir = null;
const list = sorted.map(([t, q]) => [proto, t, q, against ? "here" : ""]);
if (against) {
  const tmp = mkdtempSync(join(tmpdir(), "gate-"));
  execFileSync("git", ["worktree", "add", "--detach", "-q", tmp, against], { cwd: proto, stdio: "inherit" });
  otherDir = join(tmp, "prototype");
  list.push(...sorted.map(([t, q]) => [otherDir, t, q, against]));
}
let results;
try {
  results = await runAll(list);
} finally {
  if (otherDir) { try { execFileSync("git", ["worktree", "remove", "--force", dirname(otherDir)], { cwd: proto }); } catch { rmSync(dirname(otherDir), { recursive: true, force: true }); } }
}
const secs = ((Date.now() - t0) / 1000).toFixed(0);
const mine = results.filter((r) => r.label !== against || !against);
const failing = new Set(mine.flatMap((r) => r.fails));
const ranTests = new Set(mine.filter((r) => !r.missing).map((r) => r.test));
const print = (title, names) => { if (!names.length) return; console.log(`\n${title} (${names.length}):`); for (const n of names.sort()) console.log(`  ${n}`); };

if (against) {
  const theirs = new Set(results.filter((r) => r.label === against).flatMap((r) => r.fails));
  const missingThere = results.filter((r) => r.label === against && r.missing).map((r) => r.test);
  const hereOnly = [...failing].filter((n) => !theirs.has(n));
  print("Fail on both (old)", [...failing].filter((n) => theirs.has(n)));
  print(`Fail on ${against} only (fixed here)`, [...theirs].filter((n) => !failing.has(n)));
  print(`Fail here only (new since ${against})`, hereOnly);
  if (missingThere.length) console.log(`\nNot in ${against}: ${missingThere.join(", ")} (every failure in them is new)`);
  console.log(`\n${hereOnly.length ? "NEW" : "no new"} failures against ${against}; ${secs}s`);
  process.exit(hereOnly.length ? 1 : 0);
}

const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : { checks: [] };
const known = new Set(base.checks);
const fresh = [...failing].filter((n) => !known.has(n));
// Fixed: a baseline check of a test that ran and no longer fails.
const fixed = base.checks.filter((n) => ranTests.has(n.slice(0, n.indexOf(":"))) && !failing.has(n));
print("Known failures (baseline)", [...failing].filter((n) => known.has(n)));
print("Fixed (in the baseline, passing now)", fixed);
print("NEW FAILURES (not in the baseline)", fresh);
if (fixed.length && update) {
  base.checks = base.checks.filter((n) => !fixed.includes(n));
  writeFileSync(BASELINE, JSON.stringify(base, null, 1) + "\n");
  console.log(`\nbaseline: dropped ${fixed.length}, ${base.checks.length} left`);
} else if (fixed.length) console.log(`\nnode tools/gate.js --update drops the fixed checks from the baseline`);
console.log(`\n${fresh.length ? "GATE FAILED" : "gate passed"}: ${mine.length} tests, ${failing.size} failing checks, ${fresh.length} new, ${fixed.length} fixed; ${secs}s`);
process.exit(fresh.length ? 1 : 0);
