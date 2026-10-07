// Type checking (README "Type checking"): runs the TypeScript checker over the modules that start with // @ts-check
// (jsconfig.json: checkJs is off, so the rest are read for their types but not checked). Nothing is built and the game
// needs no install: TypeScript comes from a local install if there is one (node_modules/typescript), else npx fetches
// a pinned version into its cache once. Offline with neither, the check is skipped (it says so, exit 0).
// A checked file passes with no errors in it; errors in any other file (types.d.ts, a broken import) fail too. Also:
// the core modules are still opted in, and no module imports the types file at run time (the browser has no such .js).
// Usage: node tools/typechecktest.js [--list]   (npm run typecheck)
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const TS_VERSION = "5.6.3"; // pinned: the same checker everywhere (npx caches it after the first run)
const root = join(dirname(fileURLToPath(import.meta.url)), ".."); // prototype/
// The sim's core, checked from the start (suggestions-4 #31). More can opt in; these must not drop out.
const CORE = ["world", "parties", "save", "rng", "hex", "data", "economy", "weather"].map((m) => `src/sim/${m}.js`);

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else { failed++; console.log(`  FAIL: ${msg}`); } return ok; };
const rel = (p) => relative(root, p).split(sep).join("/");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".js")) out.push(p);
  }
  return out;
}
// Opted in: // @ts-check in the comments before the first line of code.
const optedIn = (text) => {
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t === "// @ts-check") return true;
    if (t && !t.startsWith("//")) return false;
  }
  return false;
};
const files = walk(join(root, "src")).map((p) => ({ path: rel(p), text: readFileSync(p, "utf8") }));
const checked = files.filter((f) => optedIn(f.text)).map((f) => f.path).sort();

// Which checker: a local install first, else npx with the pinned version.
function findTsc() {
  for (const base of [root, join(root, "..")]) {
    try { return { cmd: process.execPath, args: [createRequire(join(base, "noop.js")).resolve("typescript/bin/tsc")], how: "local install" }; } catch { /* not installed there */ }
  }
  return { cmd: "npx", args: ["--yes", "-p", `typescript@${TS_VERSION}`, "tsc"], how: `npx typescript@${TS_VERSION}`, shell: process.platform === "win32" };
}

console.log(`Type checking (${checked.length} module${checked.length === 1 ? "" : "s"} opted in with // @ts-check)`);
if (process.argv.includes("--list")) for (const f of checked) console.log(`  ${f}`);
for (const f of CORE) check(checked.includes(f), `${f} is opted in (a core module: keep its // @ts-check)`);
// The types file is for the checker only: a module may name it in a JSDoc @import or import("./types"), never in an
// import statement (the browser would ask the server for a types.js that does not exist).
const typesAtRunTime = files.filter((f) => /^\s*(import|export)\b[^\n]*from\s*["']\.\.?\/(sim\/)?types(\.js|\.d\.ts)?["']/m.test(f.text)).map((f) => f.path);
check(!typesAtRunTime.length, `the types file is imported at run time by ${typesAtRunTime.join(", ")} (use /** @import { … } from "./types" */)`);
if (!existsSync(join(root, "jsconfig.json"))) check(false, "jsconfig.json is there");

const tsc = findTsc();
const t0 = performance.now();
const run = spawnSync(tsc.cmd, [...tsc.args, "-p", "jsconfig.json", "--pretty", "false"], { cwd: root, encoding: "utf8", shell: !!tsc.shell, timeout: 10 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
const out = `${run.stdout || ""}${run.stderr || ""}`;
const errLines = out.split(/\r?\n/).filter((l) => /\berror TS\d+/.test(l)); // a config error has no file and line
const ran = run.status === 0 || errLines.length > 0;
if (!ran) {
  // No checker to run (offline with nothing cached, no npx): say so and pass.
  const why = run.error ? run.error.message : out.trim().split(/\r?\n/).slice(-3).join(" / ") || `exit ${run.status}`;
  console.log(`\nSKIPPED: TypeScript could not be run (${tsc.how}): ${why}`);
  console.log("Install it once with `npm install --no-save typescript` in prototype/, or run online so npx can fetch it.");
  console.log(`\n${passed} passed, ${failed} failed (the type check itself was skipped)`);
  process.exit(failed ? 1 : 0);
}
console.log(`Checker: ${tsc.how}, ${((performance.now() - t0) / 1000).toFixed(1)} s`);

// Errors by file (continuation lines of a message follow it, indented).
const byFile = new Map();
let last = null;
for (const line of out.split(/\r?\n/)) {
  const m = /^(\S.*?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line);
  if (m) {
    const file = m[1].split("\\").join("/");
    if (!byFile.has(file)) byFile.set(file, []);
    last = { line: Number(m[2]), col: Number(m[3]), code: m[4], text: m[5] };
    byFile.get(file).push(last);
  } else if (last && /^\s+\S/.test(line)) last.text += ` ${line.trim()}`;
}
for (const f of checked) {
  const errs = byFile.get(f) || [];
  if (!check(!errs.length, `${f}: ${errs.length} type error${errs.length === 1 ? "" : "s"}`)) for (const e of errs.slice(0, 20)) console.log(`    ${f}:${e.line}:${e.col} ${e.code} ${e.text}`);
}
for (const [f, errs] of byFile) {
  if (checked.includes(f)) continue;
  check(false, `${f}: ${errs.length} error${errs.length === 1 ? "" : "s"} (not an opted-in module: a types file or a broken import?)`);
  for (const e of errs.slice(0, 20)) console.log(`    ${f}:${e.line}:${e.col} ${e.code} ${e.text}`);
}
const unplaced = errLines.filter((l) => !/^\S.*\(\d+,\d+\): error TS\d+/.test(l));
if (unplaced.length) check(false, `the checker reports: ${unplaced.slice(0, 5).join(" / ")}`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
