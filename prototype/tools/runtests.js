// Runs every tools/*test*.js as its own node process, a few at a time, and lists the ones that fail.
// A test passes when it exits 0 within the time limit. Output of failing tests is kept in tools/.testlogs/.
// Usage: node tools/runtests.js [--jobs N] [--timeout seconds] [--only a,b] [--skip a,b] [--json out.json] [pattern...]
//   pattern: substrings; a test runs when its file name contains any of them (no pattern: all of them).
import { readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { cpus } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const jobs = Number(opt("--jobs", Math.max(1, cpus().length)));
const timeout = Number(opt("--timeout", 600)) * 1000;
// Tests that run a year of 12 seeds twice in child processes (about 20 minutes alone on 4 cores, twice that while
// other tests share them): this many times the timeout.
const SLOW = { "depletetest.js": 4, "diplotest.js": 4, "worktest.js": 2, "savetest.js": 3, "sameseedtest.js": 3, "surveytest.js": 4, "discoverytest.js": 4, "conquertest.js": 4, "autotest.js": 4 }; // worktest: about 32 minutes alone; savetest about 15 and sameseedtest about 13 (2026-10-22), over the 10-minute limit even alone; surveytest (18 autopilot runs of 90 days) and discoverytest (9 of 120) took 34 and 36 minutes with the machine shared (2026-10-23): the autopilot's days cost about twice what they did on 2026-10-18 (the 250 × 250 base maps, more teams out); conquertest: six 400-day autopilot worlds played to their first taken base (days 61-163, about 2-3 s a game day like autotest's) is 25-35 minutes (2026-10-23); autotest: five 120-day autopilot worlds, 80-160 s each with the machine to itself, over the 10-minute limit with the others running (2026-10-23)
const skip = (opt("--skip", "") || "").split(",").filter(Boolean);
const jsonOut = opt("--json", null);
const patterns = args;
// Not tests: tools that only report, or need a browser.
const NOT_TESTS = new Set(["runtests.js"]);
const files = readdirSync(here)
  .filter(f => /test.*\.js$/.test(f) && !NOT_TESTS.has(f))
  .filter(f => !patterns.length || patterns.some(p => f.includes(p)))
  .filter(f => !skip.some(p => f.includes(p)))
  .sort();
const logs = join(here, ".testlogs");
mkdirSync(logs, { recursive: true });

const results = [];
let next = 0, running = 0;
const t0 = Date.now();
function runOne(f) {
  return new Promise(res => {
    const start = Date.now();
    const child = spawn(process.execPath, [join(here, f)], { cwd: dirname(here), stdio: ["ignore", "pipe", "pipe"], detached: true }); // its own process group: a timeout kills its children too
    let out = "";
    child.stdout.on("data", d => { out += d; if (out.length > 4e6) out = out.slice(-2e6); });
    child.stderr.on("data", d => { out += d; if (out.length > 4e6) out = out.slice(-2e6); });
    const limit = timeout * (SLOW[f] || 1);
    const timer = setTimeout(() => { out += `\n[runtests] timed out after ${limit / 1000}s\n`; try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }, limit);
    child.on("close", (code, sig) => {
      clearTimeout(timer);
      const ok = code === 0;
      const secs = (Date.now() - start) / 1000;
      if (!ok) writeFileSync(join(logs, f + ".log"), out);
      res({ file: f, ok, code, sig, secs, tail: ok ? "" : out.trim().split("\n").slice(-6).join("\n") });
    });
  });
}
await new Promise(done => {
  const pump = () => {
    while (running < jobs && next < files.length) {
      const f = files[next++]; running++;
      runOne(f).then(r => {
        running--; results.push(r);
        process.stdout.write(`${r.ok ? "ok  " : "FAIL"} ${r.file} (${r.secs.toFixed(1)}s)\n`);
        if (results.length === files.length) done(); else pump();
      });
    }
  };
  if (!files.length) done(); else pump();
});
const failed = results.filter(r => !r.ok).sort((a, b) => a.file.localeCompare(b.file));
console.log(`\n${results.length - failed.length}/${results.length} passed in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
for (const r of failed) console.log(`\nFAIL ${r.file} (exit ${r.code ?? r.sig})\n${r.tail.split("\n").map(l => "  " + l).join("\n")}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results.map(({ file, ok, secs }) => ({ file, ok, secs })), null, 1));
process.exit(failed.length ? 1 : 0);
