// Lists the tests a change can affect, so a session runs those and not the whole suite (docs/agents/testing.md).
// Usage (from prototype/): node tools/affected.js [changed paths...]   (no paths: git diff --name-only origin/dev)
//   node tools/runtests.js --quick $(node tools/affected.js)
// For each changed src/sim/<m>.js or src/ui/<m>.js: the tests that import it, plus the tests named for it. A core
// module matched by more than CAP tests is narrowed to the tests that name a function changed in it (from the diff
// against origin/dev) and the ones named for it; what was left out goes to stderr. A changed test runs itself.
// Not named *test*, so runtests.js never runs it.
import { readdirSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = execSync("git rev-parse --show-toplevel", { cwd: here }).toString().trim();
const CAP = 20;
const git = cmd => { try { return execSync(cmd, { cwd: root, maxBuffer: 1 << 26 }).toString(); } catch { return ""; } };
const paths = process.argv.length > 2 ? process.argv.slice(2) : git("git diff --name-only origin/dev").split("\n").filter(Boolean);
const tests = readdirSync(here).filter(f => /test.*\.js$/.test(f) && f !== "runtests.js");
const src = Object.fromEntries(tests.map(f => [f, readFileSync(join(here, f), "utf8")]));
const picked = new Set();
for (const p of paths) {
  const name = basename(p);
  if (tests.includes(name)) { picked.add(name); continue; }
  const m = p.match(/src\/(sim|ui)\/(.+)\.js$/);
  if (!m) continue;
  const mod = m[2], needle = `${m[1]}/${mod}.js`;
  const stem = basename(mod).replace(/^data-/, "");
  const named = tests.filter(f => f.startsWith(stem));
  let hits = tests.filter(f => src[f].includes(needle));
  if (hits.length > CAP) {
    // The functions this diff touches in the module: hunk headers and changed lines that declare one.
    const diff = git(`git diff -U0 origin/dev -- "prototype/src/${m[1]}/${mod}.js"`);
    const fns = new Set([...diff.matchAll(/(?:^@@.*@@.*|^[+-].*)\bfunction\s+(\w+)|^[+-]\s*(?:export\s+)?const\s+(\w+)\s*=/gm)].map(x => x[1] || x[2]));
    const keep = hits.filter(f => [...fns].some(fn => new RegExp(`\\b${fn}\\b`).test(src[f])));
    console.error(`${needle}: ${hits.length} tests import it; kept ${keep.length} naming ${[...fns].join(", ") || "(no changed function found)"} and ${named.length} named for it; left out ${hits.length - keep.length}`);
    hits = keep;
  }
  for (const f of [...hits, ...named]) picked.add(f);
}
console.log([...picked].sort().join(" "));
