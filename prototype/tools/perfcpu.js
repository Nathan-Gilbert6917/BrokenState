// Reads a V8 CPU profile (docs/prompts/performance.md, PERF-0) and prints where the time went: the functions with
// the most self time and the most inclusive time, or who calls a function (--callers) and what it calls (--callees),
// by inclusive time. Make a profile of any headless tool with
//   node --cpu-prof --cpu-prof-dir=/tmp/prof --cpu-prof-interval 500 tools/perfprofile.js 120 3
// (or of the browser through the DevTools Performance panel: Save profile gives the same JSON).
// Usage: node tools/perfcpu.js <file.cpuprofile> [--top 40] [--callers fn] [--callees fn] [--depth 2] [--min 50]
//   --min: hide rows under this many ms (callers / callees)
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && !/^\d+$/.test(a));
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : dflt; };
if (!file) { console.log("Usage: node tools/perfcpu.js <file.cpuprofile> [--top 40] [--callers fn] [--callees fn] [--depth 2] [--min 50]"); process.exit(1); }
const top = Number(opt("top", 40)), depth = Number(opt("depth", 2)), minMs = Number(opt("min", 50));
const callersOf = opt("callers", null), calleesOf = opt("callees", null);

const prof = JSON.parse(readFileSync(file, "utf8"));
const nodes = new Map(prof.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of prof.nodes) for (const c of n.children || []) parent.set(c, n.id);
// Self time per node (µs), then inclusive time per node.
const self = new Map();
for (let i = 0; i < prof.samples.length; i++) self.set(prof.samples[i], (self.get(prof.samples[i]) || 0) + (prof.timeDeltas[i] || 0));
const incl = new Map();
const inclOf = (id) => { // iterative post-order (deep profiles overflow a recursive walk)
  const stack = [[id, false]];
  while (stack.length) {
    const [n, done] = stack.pop();
    const node = nodes.get(n);
    if (done) { let t = self.get(n) || 0; for (const c of node.children || []) t += incl.get(c) || 0; incl.set(n, t); continue; }
    stack.push([n, true]);
    for (const c of node.children || []) stack.push([c, false]);
  }
};
inclOf(prof.nodes[0].id);
const total = [...self.values()].reduce((a, b) => a + b, 0);
const where = (n) => n.callFrame.url.replace(/^.*\/(src|tools)\//, "$1/").replace(/^file:\/\//, "");
const label = (n) => `${n.callFrame.functionName || "(anon)"} ${where(n)}:${n.callFrame.lineNumber + 1}`;
const ms = (us) => (us / 1000).toFixed(0).padStart(8);
const pct = (us) => `${((100 * us) / total).toFixed(1).padStart(5)}%`;
const rows = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

if (!callersOf && !calleesOf) {
  const bySelf = new Map(), byIncl = new Map();
  for (const [id, t] of self) { const k = label(nodes.get(id)); bySelf.set(k, (bySelf.get(k) || 0) + t); }
  for (const n of prof.nodes) {
    // A function counts once per stack: skip a node whose ancestor is the same function (recursion).
    let rec = false;
    for (let a = parent.get(n.id); a != null; a = parent.get(a)) if (label(nodes.get(a)) === label(n)) { rec = true; break; }
    if (!rec) { const k = label(n); byIncl.set(k, (byIncl.get(k) || 0) + incl.get(n.id)); }
  }
  console.log(`Total sampled: ${(total / 1e6).toFixed(2)} s`);
  console.log(`\nSelf time`);
  for (const [k, t] of rows(bySelf, top)) console.log(`${ms(t)} ms ${pct(t)}  ${k}`);
  console.log(`\nInclusive time`);
  for (const [k, t] of rows(byIncl, top)) console.log(`${ms(t)} ms ${pct(t)}  ${k}`);
}

const matches = (n, fn) => n.callFrame.functionName === fn;
const outer = (n, fn) => { for (let a = parent.get(n.id); a != null; a = parent.get(a)) if (matches(nodes.get(a), fn)) return false; return true; };

if (calleesOf) {
  const roots = prof.nodes.filter((n) => matches(n, calleesOf) && outer(n, calleesOf));
  console.log(`\n${calleesOf}: ${(roots.reduce((a, n) => a + incl.get(n.id), 0) / 1000).toFixed(0)} ms inclusive; its callees by inclusive time`);
  const walk = (list, d, indent) => {
    const m = new Map();
    for (const n of list) for (const c of n.children || []) {
      const cn = nodes.get(c), k = label(cn), e = m.get(k) || { t: 0, nodes: [] };
      e.t += incl.get(c); e.nodes.push(cn); m.set(k, e);
    }
    for (const [k, e] of [...m.entries()].sort((a, b) => b[1].t - a[1].t)) {
      if (e.t / 1000 < minMs) continue;
      console.log(`${indent}${ms(e.t)} ms  ${k}`);
      if (d > 1) walk(e.nodes, d - 1, indent + "    ");
    }
  };
  walk(roots, depth, "  ");
}

if (callersOf) {
  const agg = new Map();
  let sum = 0;
  for (const n of prof.nodes) {
    if (!matches(n, callersOf) || !outer(n, callersOf)) continue;
    const t = incl.get(n.id);
    sum += t;
    const chain = [];
    for (let a = parent.get(n.id), i = 0; a != null && i < depth; a = parent.get(a), i++) chain.push(label(nodes.get(a)));
    const k = chain.join("  <-  ");
    agg.set(k, (agg.get(k) || 0) + t);
  }
  console.log(`\n${callersOf}: ${(sum / 1000).toFixed(0)} ms inclusive; called from`);
  for (const [k, t] of rows(agg, Infinity)) if (t / 1000 >= minMs) console.log(`${ms(t)} ms  ${k}`);
}
