// The AI groups' machines over a long run (machines-2 2026-10-10: their machine parts income, groupworks.js
// groupPartsDaily): governor campaigns, sampled every 30 days. For the living groups that build (not the hardcore
// military): their machine parts on hand (average, and for the mid-size groups of 12–25 people), how many have an
// ethanol still standing (not broken), a generator, a walk-in freezer and a freezer running, the parts their workshops
// made and spent on machines, the breakdowns, the parts that went into guns (arsenal.js f.partsGuns), and the day each
// group first had a generator and a walk-in freezer. Pure reading: it changes nothing in the world.
// Usage: node tools/machinecensus.js [days=540] [seeds...=1 2 3]
import { createWorld, tickHour, day } from "../src/sim/world.js";
import { setAutopilot, autopilotResolve } from "../src/sim/autopilot.js";
import { groupFreezerOn, groupsBuild } from "../src/sim/groupworks.js";

const days = Number(process.argv[2] || 540);
const seeds = process.argv.length > 3 ? process.argv.slice(3).map(Number) : [1, 2, 3];
const r1 = (v) => Math.round(v * 10) / 10;
const has = (f, k) => f.bases.some((t) => f.works && f.works[t] && f.works[t][k]);
const standing = (f, k) => f.bases.some((t) => { const w = f.works && f.works[t]; return w && w[k] && !(w.mach && w.mach[k] && w.mach[k].broken); });
const rows = [], totals = [], firsts = []; // firsts: the day each group first had a generator / a freezer
const t0 = Date.now();
for (const seed of seeds) {
  const st = createWorld({ seed, factionCount: 7 });
  st.started = true;
  setAutopilot(st, true, "balanced");
  while (day(st) <= days && !st.gameOver) {
    autopilotResolve(st);
    tickHour(st);
    if (st.hour % 24 !== 12) continue;
    for (const f of st.factions) {
      if (!f.works) continue;
      if (f.firstGen == null && has(f, "power")) f.firstGen = day(st);
      if (f.firstFz == null && has(f, "freezer")) f.firstFz = day(st);
    }
    if (day(st) % 30) continue;
    const gs = st.factions.filter((f) => f.alive && groupsBuild(st, f) && f.bases.length);
    const mid = gs.filter((f) => f.pop >= 12 && f.pop <= 25);
    const avg = (list, fn) => (list.length ? list.reduce((a, f) => a + fn(f), 0) / list.length : 0);
    rows.push({
      seed, day: day(st), n: gs.length, mid: mid.length,
      parts: avg(gs, (f) => f.stock.parts || 0), midParts: avg(mid, (f) => f.stock.parts || 0), pop: avg(gs, (f) => f.pop),
      still: gs.filter((f) => standing(f, "still")).length, power: gs.filter((f) => has(f, "power")).length,
      freezer: gs.filter((f) => has(f, "freezer")).length, freezerOn: gs.filter((f) => groupFreezerOn(f)).length,
      midMach: mid.filter((f) => standing(f, "still") || groupFreezerOn(f)).length,
      made: gs.reduce((a, f) => a + (f.partsMade || 0), 0), guns: gs.reduce((a, f) => a + (f.partsGuns || 0), 0), spent: gs.reduce((a, f) => a + (f.machParts || 0), 0), broke: gs.reduce((a, f) => a + (f.machBroke || 0), 0),
    });
  }
  const tot = (k) => st.factions.reduce((a, f) => a + (f[k] || 0), 0); // every group, the fallen too
  firsts.push(...st.factions.filter((f) => f.works).map((f) => ({ seed, name: f.name, type: f.type, gen: f.firstGen, fz: f.firstFz })));
  totals.push({ made: tot("partsMade"), machines: tot("machParts"), guns: tot("partsGuns") });
  console.log(`seed ${seed}: ${st.gameOver ? `fell day ${day(st)}` : `day ${day(st)}`} (${Math.round((Date.now() - t0) / 1000)} s)`);
}
// By 90-day stretch, summed over the seeds.
console.log("\nday   groups  pop   parts  (mid-size: n, parts, with a still or freezer on)  still  generator  freezer  freezer on  made  spent  broke  into guns");
const buckets = new Map();
for (const r of rows) { const k = Math.ceil(r.day / 90) * 90; if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(r); }
for (const [k, list] of [...buckets].sort((a, b) => a[0] - b[0])) {
  const a = (fn) => r1(list.reduce((s, r) => s + fn(r), 0) / list.length);
  const last = seeds.map((s) => list.filter((r) => r.seed === s).pop()).filter(Boolean);
  const sumLast = (fn) => last.reduce((s, r) => s + fn(r), 0);
  console.log(`≤${String(k).padEnd(4)} ${String(a((r) => r.n)).padEnd(6)}  ${String(a((r) => r.pop)).padEnd(5)} ${String(a((r) => r.parts)).padEnd(6)} (${a((r) => r.mid)}, ${a((r) => r.midParts)}, ${a((r) => r.midMach)})${" ".repeat(26)}${String(a((r) => r.still)).padEnd(6)} ${String(a((r) => r.power)).padEnd(10)} ${String(a((r) => r.freezer)).padEnd(8)} ${String(a((r) => r.freezerOn)).padEnd(11)} ${String(sumLast((r) => r.made)).padEnd(5)} ${String(sumLast((r) => r.spent)).padEnd(6)} ${String(sumLast((r) => r.broke)).padEnd(6)} ${sumLast((r) => r.guns)}`);
}
const all = (fn) => r1(rows.reduce((s, r) => s + fn(r), 0) / Math.max(1, rows.length));
const late = rows.filter((r) => r.day > days / 2);
const lateA = (fn) => r1(late.reduce((s, r) => s + fn(r), 0) / Math.max(1, late.length));
console.log(`\nwhole run: parts on hand ${all((r) => r.parts)} (mid-size ${all((r) => r.midParts)}), groups with a still standing ${all((r) => r.still)}, a freezer running ${all((r) => r.freezerOn)} of ${all((r) => r.n)}`);
console.log(`second half: parts on hand ${lateA((r) => r.parts)} (mid-size ${lateA((r) => r.midParts)}), still ${lateA((r) => r.still)}, freezer on ${lateA((r) => r.freezerOn)} of ${lateA((r) => r.n)}; mid-size groups with a still or a freezer on ${lateA((r) => r.midMach)} of ${lateA((r) => r.mid)}`);
console.log(`all groups over the run, the fallen too (per seed): parts made ${totals.map((t) => t.made).join(" / ")}, into machines ${totals.map((t) => t.machines).join(" / ")}, into guns ${totals.map((t) => t.guns).join(" / ")}`);
const fd = (k) => { const d = firsts.map((x) => x[k]).filter((v) => v != null).sort((a, b) => a - b); return d.length ? `${d.length} of ${firsts.length} groups, first day ${d[0]}, median ${d[Math.floor(d.length / 2)]}, mean ${Math.round(d.reduce((a, v) => a + v, 0) / d.length)}` : `none of ${firsts.length} groups`; };
console.log(`first generator: ${fd("gen")}
first freezer: ${fd("fz")}`);
console.log(`by group: ${firsts.map((x) => `${x.seed}:${x.type} gen ${x.gen ?? "-"} fz ${x.fz ?? "-"}`).join(", ")}`);
