// The deep countryside's tables and the yearly heat maps of the dead (issue #76) from the lines that
// tools/deadspreadrun.js --maps writes (every tile's count, cap and land class and the hives' tiles, at day 1 and each
// year's end). Not a test. The zones are worked out here from those lines with this build's reach tables
// (deadspread.js DEADSPREAD.REACH, DEEP), so a run of an older build is read the same way as a new one.
// Prints, per run and averaged over the seeds, the deep countryside's mean fill (% of cap) and its share at each band
// at each year, the mean fill by zone and the land classes' order; with --out, writes the heat maps' data (JSON: each
// year's fill per tile, quantized, base64) for the heat-map page.
// Usage: node tools/spreadmaps.js [--out maps.json] [--html page.html] [--notes notes.html] <label>=<file.maps> ...
//   (label: before-42, after-42, ...; --html: tools/spreadmaps.html with the data inlined, the heat-map page)
import { readFileSync, writeFileSync } from "node:fs";
import { DEADSPREAD } from "../src/sim/deadspread.js";
import { bandOfCount } from "../src/sim/deadpop.js";

const argv = process.argv.slice(2), opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const out = opt("--out"), html = opt("--html"), notes = opt("--notes");
const runs = argv.filter((a, i) => a.includes("=") && !["--out", "--html", "--notes"].includes(argv[i - 1])).map((a) => { const [label, file] = a.split("="); return { label, file }; });
const EVEN = [1, 0, 0, -1, -1, -1, -1, 0, -1, 1, 0, 1], ODD = [1, 0, 1, -1, 0, -1, -1, 0, 0, 1, 1, 1];
const KINDS = ["city", "town", "hive"], WORDS = ["none", "low", "medium", "high", "overrun"];
const ZONES = ["city land", "towns", "0-2 steps out", "3-5 steps out", "past 5 steps, not deep", "deep countryside"];
const u8 = (s) => new Uint8Array(Buffer.from(s, "base64"));
const u16 = (s) => { const b = Buffer.from(s, "base64"); return new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2); };

/** Steps from each tile to the nearest source of each kind (as deadspread.js reachDist), from a line. */
function dists(L, cls) {
  const W = L.w, H = L.h, n = cls.length, hs = new Set(L.hives), out = {};
  const isCity = (c) => c === 0 || c === 1 || c === 2, isTown = (c) => c === 3;
  for (const kind of KINDS) {
    const d = (out[kind] = new Int32Array(n).fill(-1)), q = new Int32Array(n);
    let qn = 0;
    for (let id = 0; id < n; id++) {
      if (cls[id] === 255) continue;
      if (kind === "hive" ? hs.has(id) : kind === "city" ? isCity(cls[id]) : isTown(cls[id])) { d[id] = 0; q[qn++] = id; }
    }
    for (let qi = 0; qi < qn; qi++) {
      const id = q[qi], x = id % W, y = (id - x) / W, dirs = y & 1 ? ODD : EVEN;
      for (let k = 0; k < 12; k += 2) {
        const nx = x + dirs[k], ny = y + dirs[k + 1];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const nid = ny * W + nx;
        if (d[nid] < 0) { d[nid] = d[id] + 1; q[qn++] = nid; }
      }
    }
  }
  return out;
}

const data = { runs: [], reach: DEADSPREAD.REACH, floor: DEADSPREAD.FLOOR, zones: ZONES };
const rows = {};
for (const { label, file } of runs) {
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const run = { label, seed: lines[0].seed, w: lines[0].w, h: lines[0].h, years: [] };
  for (const L of lines) {
    const n = u16(L.n), cap = u16(L.cap), cls = u8(L.cls), D = dists(L, cls), C = L.classes;
    const deepCls = new Set(DEADSPREAD.DEEP.map((c) => C.indexOf(c)));
    const fill = new Uint8Array(cls.length), zone = new Uint8Array(cls.length), step = new Uint8Array(cls.length);
    const deep = { n: 0, fill: 0, bands: [0, 0, 0, 0, 0], over15: 0, max: 0 };
    const z = ZONES.map(() => ({ n: 0, fill: 0 })), byStep = [], cm = {};
    for (let id = 0; id < cls.length; id++) {
      if (cls[id] === 255) { fill[id] = 255; zone[id] = 255; step[id] = 255; continue; }
      const f = cap[id] ? n[id] / cap[id] : 0;
      fill[id] = Math.min(254, Math.round(f * 200));
      const c = C[cls[id]];
      const e = cm[c] || (cm[c] = [0, 0]); e[0]++; e[1] += n[id];
      const ds = KINDS.map((k) => D[k][id]), near = Math.min(...ds.map((d) => (d < 0 ? 1e9 : d)));
      step[id] = Math.min(254, near);
      const reached = KINDS.some((k, i) => ds[i] > 0 && ds[i] <= DEADSPREAD.REACH[k].length);
      const zi = cls[id] <= 2 ? 0 : cls[id] === 3 ? 1 : near > 0 && !reached && deepCls.has(cls[id]) ? 5 : near <= 2 ? 2 : near <= 5 ? 3 : 4;
      zone[id] = zi;
      z[zi].n++; z[zi].fill += f;
      if (near > 0) { const s = Math.min(near, 12); const b = byStep[s] || (byStep[s] = [0, 0]); b[0]++; b[1] += f; }
      if (zi === 5) {
        deep.n++; deep.fill += f; deep.bands[bandOfCount(n[id], cap[id]).band]++; deep.max = Math.max(deep.max, f);
        if (f > 0.15) deep.over15++;
      }
    }
    const means = {};
    for (const c of C) if (cm[c]) means[c] = cm[c][1] / cm[c][0];
    const y = Math.round(L.year);
    const rec = {
      year: y, day: L.day, hives: L.hives,
      deep: { n: deep.n, fill: deep.fill / (deep.n || 1), bands: deep.bands.map((b) => b / (deep.n || 1)), over15: deep.over15, max: deep.max },
      zones: z.map((e) => ({ n: e.n, fill: e.fill / (e.n || 1) })),
      steps: byStep.map((b, s) => (b ? { s, fill: b[1] / b[0] } : null)).filter(Boolean),
      means, fill: Buffer.from(fill).toString("base64"), zone: Buffer.from(zone).toString("base64"), step: Buffer.from(step).toString("base64"),
    };
    if (y === 0) run.cls = Buffer.from(cls).toString("base64");
    run.years.push(rec);
    rows[`${label}|${y}`] = rec;
  }
  data.runs.push(run);
}

const pct = (v) => `${(v * 100).toFixed(1)}%`;
const cell = (r) => (r ? `${pct(r.deep.fill)} · ${r.deep.bands.map((b) => Math.round(b * 100)).join("/")}${r.deep.over15 ? ` · ${r.deep.over15} >15%` : ""}` : "–");
const seeds = [...new Set(data.runs.map((r) => r.seed))].sort((a, b) => a - b);
const years = [...new Set(data.runs.flatMap((r) => r.years.map((y) => y.year)))].sort((a, b) => a - b);
console.log("Deep countryside: mean fill (% of cap) · none/low/medium/high/overrun % [· tiles over 15% of cap]\n");
console.log("| seed | year | before | after |\n|---|---|---|---|");
for (const s of seeds) for (const y of years) console.log(`| ${s} | ${y} | ${cell(rows[`before-${s}|${y}`])} | ${cell(rows[`after-${s}|${y}`])} |`);
const avg = (w, y, f) => { const v = seeds.map((s) => rows[`${w}-${s}|${y}`]).filter(Boolean); return v.length ? { v: v.reduce((a, r) => a + f(r), 0) / v.length, n: v.length } : null; };
console.log("\nAveraged over the seeds (n: seeds that reached the year)\n\n| year | before: mean fill · bands | after: mean fill · bands |\n|---|---|---|");
for (const y of years) {
  const c = (w) => { const m = avg(w, y, (r) => r.deep.fill); if (!m) return "–"; return `${pct(m.v)} · ${[0, 1, 2, 3, 4].map((i) => Math.round(avg(w, y, (r) => r.deep.bands[i]).v * 100)).join("/")} (n=${m.n})`; };
  console.log(`| ${y} | ${c("before")} | ${c("after")} |`);
}
console.log("\nMean fill by zone (averaged over the seeds)\n");
console.log(`| year | ${ZONES.map((z) => `${z} before / after`).join(" | ")} |\n|---|${ZONES.map(() => "---").join("|")}|`);
for (const y of years) console.log(`| ${y} | ${ZONES.map((_, i) => ["before", "after"].map((w) => { const m = avg(w, y, (r) => r.zones[i].fill); return m ? pct(m.v) : "–"; }).join(" / ")).join(" | ")} |`);
console.log("\nThe land classes' order (mean count): centre > city > suburb > town > rural\n");
for (const r of data.runs) for (const y of r.years) {
  const o = ["centre", "city", "suburb", "town", "rural"].map((c) => y.means[c] || 0);
  console.log(`  ${r.label} year ${y.year}: ${o.map((v) => v.toFixed(0)).join(" > ")} ${o.every((v, i) => i === 0 || v < o[i - 1]) ? "ok" : "NOT IN ORDER"}`);
}
if (notes) data.notes = readFileSync(notes, "utf8");
if (out) { writeFileSync(out, JSON.stringify(data)); console.log(`\nwrote ${out}`); }
// The heat-map page: tools/spreadmaps.html with the data inlined.
if (html) {
  const page = readFileSync(new URL("./spreadmaps.html", import.meta.url), "utf8").replace("__DATA__", () => JSON.stringify(data).replace(/</g, "\\u003c"));
  writeFileSync(html, page);
  console.log(`wrote ${html}`);
}
