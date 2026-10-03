// Timelapse check (sim/chronicle.js, ui/timelapse.js): plays a campaign headless with a simtest-style auto-player,
// then, if the holdout still stands, forces one death a day until it falls (the last death lands outside the
// hourly tick, like a lost battle). Checks: a frame for every day, frame hours, memory (estimate and measured heap,
// scaled to 365 days), captions, decoding (sequential vs random access, and against the live world sampled during
// the run), the recorder leaving the simulation untouched (same seed without recording), a frame state for every
// day and every frame drawn by the real map renderer on a stub canvas, and the viewer's overlay HTML.
// Usage: node tools/timelapsetest.js [days] [seed] [factions]
import v8 from "node:v8";
import vm from "node:vm";
import { createWorld, tickHour, day, alive, hub, killSurvivor } from "../src/sim/world.js";
import { launchExpedition, estimateTrip, startReturn } from "../src/sim/parties.js";
import { searchHour, extract } from "../src/sim/scavenge.js";
import { executeTrade, endTrade } from "../src/sim/trade.js";
import { chronicleReader, chronicleSize, finishChronicle, INF_Q } from "../src/sim/chronicle.js";

const days = Number(process.argv[2] || 240);
const seed = Number(process.argv[3] || 42);
const factionCount = Number(process.argv[4] || 8);

let failures = 0;
const check = (ok, what) => { if (!ok) { failures++; console.log(`  FAIL ${what}`); } return ok; };
const kb = (b) => `${(b / 1024).toFixed(1)} KB`;

// ---------- the campaign ----------
function autoplay(state) {
  while (state.cards.length) {
    const c = state.cards.shift();
    const ch = c.choices.find((x) => x.label === "Return home") || c.choices.find((x) => !(typeof x.disabled === "function" ? x.disabled(state) : x.disabled));
    if (ch) ch.resolve(state);
  }
  if (state.engagement) {
    if (!state.engagement.approach) state.engagement.approach = "normal";
    if (state.engagement.hours < 3 && state.engagement.heat < 50) { searchHour(state); tickHour(state); }
    else extract(state);
  }
  if (state.trade) { executeTrade(state); endTrade(state); }
  for (const p of state.parties) if (p.owner === "player" && p.phase === "waiting") startReturn(state, p);
  if (state.hour % (24 * 6) === 12 && !state.parties.some((p) => p.owner === "player")) {
    const h = hub(state);
    const people = alive(state).filter((s) => s.location.kind === "base" && s.location.baseId === h.id).slice(0, 2);
    const targets = state.tiles.filter((t) => t.loc && state.grid.distance(t.id, h.tile) <= 8 && t.id !== h.tile);
    const dest = state.rng.pick(targets).id;
    const est = estimateTrip(state, { memberIds: people.map((s) => s.id), dest, vehicle: false, stance: "normal" });
    if (est && people.length) {
      launchExpedition(state, {
        memberIds: people.map((s) => s.id), dest, mission: "scavenge", stance: "normal",
        supplies: { food: Math.min(h.stock.food, est.food + 2), water: Math.min(h.stock.water, est.water + 2), ammo: Math.min(h.stock.ammo, 20) },
      });
    }
  }
}

// Ground truth of the live world, taken right after a frame was recorded (owners, quantized infection, hordes).
function sample(state) {
  return {
    hour: state.hour,
    owner: state.tiles.map((t) => t.owner ?? null),
    inf: state.tiles.map((t) => Math.round((t.infection || 0) * INF_Q)),
    hordes: state.hordes.map((h) => `${h.tile}:${h.size}`).sort().join(" "),
    pop: alive(state).length,
  };
}

function campaign(record) {
  const state = createWorld({ seed, factionCount });
  if (!record) state.chronicle = null;
  const truth = [];
  let forced = 0;
  const t0 = performance.now();
  while (!state.gameOver) {
    tickHour(state);
    if (record && state.hour % 24 === 0 && day(state) % 7 === 0 && state.chronicle.lastHour === state.hour) truth.push(sample(state));
    autoplay(state);
    // The holdout still stands after `days`: one death a day at noon (first by id, no rng) until it falls.
    if (day(state) > days && state.hour % 24 === 12 && !state.gameOver) {
      const s = alive(state).sort((a, b) => a.id - b.id)[0];
      if (s) { killSurvivor(state, s, hub(state).tile, "in the test's forced decline"); forced++; }
    }
    if (day(state) > days + 400) break; // safety
  }
  return { state, ms: performance.now() - t0, truth, forced };
}

console.log(`Timelapse test: ${days}+ days, seed ${seed}, ${factionCount} groups.`);
const run = campaign(true);
const state = run.state, c = state.chronicle;
const lastDay = day(state);
console.log(`Campaign: game over on day ${lastDay} (${run.forced} forced deaths after day ${days}), ${run.ms.toFixed(0)} ms.`);
// The last death came outside tickHour (as in a battle): the viewer calls finishChronicle when it opens.
const before = c.frames.length;
finishChronicle(state);
check(c.frames.length === before + 1, "finishChronicle adds the game-over frame");
check(c.overAt === state.hour, "game over recorded at the hour it happened");

// ---------- frames ----------
console.log("\nFrames");
const perDay = new Map();
for (const f of c.frames) perDay.set(Math.floor(f.h / 24) + 1, (perDay.get(Math.floor(f.h / 24) + 1) || 0) + 1);
let missing = 0;
for (let d = 1; d <= lastDay; d++) if (!perDay.get(d)) missing++;
const counts = [...perDay.values()];
check(missing === 0, `a frame for every day (${missing} days missing)`);
check(c.frames.every((f, i) => i === 0 || f.h >= c.frames[i - 1].h), "frame hours never go back");
check(c.frames[0].h === 6, "first frame at day 1, 06:00");
const daily = c.frames.filter((f) => f.h % 24 === 0).length;
const early = c.frames.filter((f) => f.h < 72 && f.h % 6 === 0 && f.h % 24 !== 0).length;
console.log(`  ${c.frames.length} frames over ${lastDay} days: ${daily} daily (midnight), ${early} early 6-hourly, ${c.frames.length - daily - early} event / start / end frames; per day min ${Math.min(...counts)}, max ${Math.max(...counts)}`);
const last = c.frames[c.frames.length - 1];
check(last.d[0] === 0, "last frame has 0 people");

// ---------- memory ----------
console.log("\nMemory");
const size = chronicleSize(c);
// Measured: heap growth from a deep copy of everything the chronicle keeps (frames, typed arrays, interned
// lists, captions with fresh strings, the two working buffers).
let heap = null;
try {
  v8.setFlagsFromString("--expose-gc");
  const gc = vm.runInNewContext("gc");
  gc(); gc();
  const h0 = process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers;
  const twin = new Map();
  const copy = (x) => { if (!twin.has(x)) twin.set(x, JSON.parse(JSON.stringify(x))); return twin.get(x); };
  const clone = {
    frames: c.frames.map((f) => ({ h: f.h, d: f.d.slice(), full: f.full ? f.full.slice() : null, bases: copy(f.bases), fb: copy(f.fb), nests: copy(f.nests) })),
    events: c.events.map((e) => ({ ...e, text: e.text.split("").join("") })),
    own: c.own.slice(), inf: c.inf.slice(), factions: JSON.parse(JSON.stringify(c.factions)),
  };
  gc(); gc();
  heap = process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers - h0;
  if (!clone.frames.length) heap = null;
} catch { /* no gc available: estimate only */ }
const per365 = (b) => kb((b / lastDay) * 365);
console.log(`  ${size.frames} frames (${size.keyframes} keyframes), ${size.interned} distinct base / group-base / nest lists, ${size.captions} captions`);
console.log(`  typed-array payload ${kb(size.payload)}, captions ~${kb(size.captionBytes)}, estimated total ${kb(size.approx)}${heap != null ? `, measured heap ${kb(heap)}` : ""}`);
console.log(`  scaled to 365 days: estimate ${per365(size.approx)}${heap != null ? `, measured ${per365(heap)}` : ""}`);
check(size.approx < 2 * 1024 * 1024, "under 2 MB");

// ---------- captions ----------
console.log("\nCaptions");
const byKind = {};
for (const e of c.events) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
const withTile = c.events.filter((e) => e.tile >= 0).length;
console.log(`  ${c.events.length} captions (${Object.entries(byKind).map(([k, v]) => `${k} ${v}`).join(", ")}), ${c.events.filter((e) => e.major).length} major, ${withTile} with a map position`);
check(c.events.every((e, i) => i === 0 || e.h >= c.events[i - 1].h), "captions in time order");
check(c.events.some((e) => /has fallen/.test(e.text)), "game-over caption");
check(c.events.some((e) => / died /.test(e.text)), "survivor deaths captioned");
const show = (e) => `    d${Math.floor(e.h / 24) + 1} ${String(e.h % 24).padStart(2, "0")}h [${e.kind}${e.major ? "*" : ""}${e.tile >= 0 ? " @" + e.tile : ""}] ${e.text}`;
console.log("  first:");
c.events.slice(0, 8).forEach((e) => console.log(show(e)));
console.log("  world events (fog off):");
c.events.filter((e) => e.kind === "world").slice(0, 8).forEach((e) => console.log(show(e)));
console.log("  last:");
c.events.slice(-8).forEach((e) => console.log(show(e)));

// ---------- decoding ----------
console.log("\nDecoding");
const sum = (slot) => { let s = 0; for (let i = 0; i < slot.own.length; i++) s = (s * 31 + slot.own[i] * 64 + slot.inf[i]) >>> 0; return s; };
const seq = chronicleReader(state);
const sums = c.frames.map((_, k) => sum(seq.decode(k)));
const rnd = chronicleReader(state);
const order = c.frames.map((_, k) => k).sort((a, b) => ((a * 7919) % 101) - ((b * 7919) % 101));
check(order.every((k) => sum(rnd.decode(k)) === sums[k]), "random-access decode matches sequential decode");
let truthOk = 0;
for (const tr of run.truth) {
  const fs = seq.frameState(tr.hour);
  const k = fs.frame;
  const ownOk = fs.tiles.every((t, i) => (t.owner ?? null) === tr.owner[i]);
  const infOk = fs.tiles.every((t, i) => Math.round(t.infection * INF_Q) === tr.inf[i]);
  const hordesOk = fs.hordes.map((h) => `${h.tile}:${h.size}`).sort().join(" ") === tr.hordes;
  const popOk = fs.info.pop === tr.pop && c.frames[k].h === tr.hour;
  if (check(ownOk && infOk && hordesOk && popOk, `frame at day ${Math.floor(tr.hour / 24) + 1} matches the live world (owners ${ownOk}, infection ${infOk}, hordes ${hordesOk}, people ${popOk})`)) truthOk++;
}
console.log(`  ${c.frames.length} frames decoded both ways; ${truthOk}/${run.truth.length} weekly samples match the live world exactly`);

// ---------- the recorder does not change the game ----------
console.log("\nDeterminism");
const bare = campaign(false);
const sig = (s) => `${s.hour}|${alive(s).length}|${s.hordes.map((h) => h.size).join(",")}|${s.factions.map((f) => `${f.pop}/${f.bases.length}`).join(",")}|${s.log.length}`;
check(sig(bare.state) === sig(state), "same seed without recording ends the same");
console.log(`  same end state without recording (${bare.ms.toFixed(0)} ms warm vs ${run.ms.toFixed(0)} ms cold with it); time inside the recorder: ${c.ms.toFixed(1)} ms for ${c.frames.length} frames (${(c.ms / c.frames.length).toFixed(3)} ms per frame)`);

// ---------- frame states drawn by the real renderer ----------
console.log("\nRendering");
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
let draws = 0;
const noop = () => {};
const counted = new Set(["fill", "stroke", "drawImage", "fillText", "fillRect", "strokeText"]);
const ctx = new Proxy({ measureText: (t) => ({ width: String(t).length * 5 }), getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) },
  { get: (o, k) => (k in o ? o[k] : counted.has(k) ? () => draws++ : noop), set: (o, k, v) => ((o[k] = v), true) });
const R = await import("../src/ui/render.js");
R.initRenderer({ getContext: () => ctx, getBoundingClientRect: () => ({ width: 1600, height: 900 }), width: 0, height: 0 });
R.view.layers = new Set(["pois", "territory", "teams", "hordes", "infection"]);
R.zoomAt(800, 450, 0.5 / R.camera.zoom);
const reader = chronicleReader(state);
let built = 0, errors = 0, maxParties = 0, maxHordes = 0, fallenSeen = false;
const t1 = performance.now();
const times = [];
for (let d = 1; d <= lastDay; d++) times.push((d - 1) * 24 + 12); // mid-day: between two frames
for (const f of c.frames) times.push(f.h);
for (const t of times) {
  try {
    const fs = reader.frameState(t);
    R.render(fs);
    built++;
    maxParties = Math.max(maxParties, fs.parties.length);
    maxHordes = Math.max(maxHordes, fs.hordes.length);
    if (fs.fallen.length) fallenSeen = true;
  } catch (err) {
    if (errors++ < 3) console.log(`  error at hour ${t}: ${err.stack}`);
  }
}
const ms = performance.now() - t1;
check(errors === 0, "every frame state renders without errors");
check(fallenSeen, "the last frame shows the fallen holdout");
console.log(`  ${built} frame states built and rendered (${lastDay} mid-day + ${c.frames.length} frame hours), ${(ms / built).toFixed(2)} ms each (JS only), ${draws} draw calls; up to ${maxHordes} hordes and ${maxParties} parties on screen`);

// ---------- viewer overlay (pure HTML builders) ----------
const TL = await import("../src/ui/timelapse.js");
const s = TL.tlSession(state, "end");
let html = TL.shellHTML(s).length;
for (const t of [s.reader.h0, (s.reader.h0 + s.reader.h1) / 2, s.reader.h1]) {
  s.t = t;
  const fs = s.reader.frameState(t);
  html += TL.valuesHTML(s, fs.info).length + TL.captionsHTML(s).length + TL.controlsHTML(s).length;
}
s.metric = "pop";
html += TL.groupChartSVG(s).length;
check(html > 2000, "overlay HTML builds");
console.log(`  viewer overlay: ${html} characters of HTML for 3 moments (default speed ${s.speed} days/s for ${lastDay} days)`);

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed.");
process.exitCode = failures ? 1 : 0;
