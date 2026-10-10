// Timelapse check (sim/chronicle.js, ui/timelapse.js): plays a campaign headless with a simtest-style auto-player,
// then, if the holdout still stands, forces one death a day until it falls (the last death lands outside the
// hourly tick, like a lost battle). Checks: a frame for every day, frame hours, memory (estimate and measured heap,
// scaled to 365 days), captions, decoding (sequential vs random access, and against the live world sampled during
// the run), the recorder leaving the simulation untouched (same seed without recording), a frame state for every
// day and every frame drawn by the real map renderer on a stub canvas, the viewer's overlay HTML, and a Retreat that
// lost every base before the last death (the last frame marks where the last base stood, and says so).
// Usage: node tools/timelapsetest.js [days] [seed] [factions] [size=small|normal|large|huge]
// The memory budget (2 MB on a Normal map) scales with the map's tile count.
import v8 from "node:v8";
import vm from "node:vm";
import { createWorld, tickHour, day, alive, hub, killSurvivor } from "../src/sim/world.js";
import { launchExpedition, estimateTrip, startReturn } from "../src/sim/parties.js";
import { searchHour, extract } from "../src/sim/scavenge.js";
import { executeTrade, endTrade } from "../src/sim/trade.js";
import { chronicleReader, chronicleSize, finishChronicle, INF_Q } from "../src/sim/chronicle.js";
import { sizeDef, areaScale } from "../src/sim/worldsize.js";
import { retreatFrom, occupyPlayerBase } from "../src/sim/conquest.js";
import { takeSize } from "./sizearg.js";

const mapSize = takeSize();

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
    ruins: state.tiles.filter((t) => t.ruin).map((t) => `${t.id}:${t.ruin.name}`).join(","),
  };
}

function campaign(record) {
  const state = createWorld({ seed, factionCount, size: mapSize });
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

console.log(`Timelapse test: ${days}+ days, seed ${seed}, ${factionCount} groups, ${sizeDef(mapSize).label} map (${sizeDef(mapSize).w}×${sizeDef(mapSize).h}).`);
const run = campaign(true);
const state = run.state, c = state.chronicle;
const lastDay = day(state);
console.log(`Campaign: game over on day ${lastDay} (${run.forced} forced deaths after day ${days}), ${run.ms.toFixed(0)} ms.`);
// The last death came outside tickHour (as in a battle): the viewer calls finishChronicle when it opens.
// When the game ended inside the hourly tick instead (a horde breaking in can now end it before the forced
// decline), that frame is recorded already and finishChronicle adds none.
const before = c.frames.length, already = c.overAt != null;
finishChronicle(state);
check(c.frames.length === before + (already ? 0 : 1) && c.overAt != null, already ? "the game ended inside the hourly tick: its game-over frame is recorded and finishChronicle adds none" : "finishChronicle adds the game-over frame");
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
    frames: c.frames.map((f) => ({ h: f.h, d: f.d.slice(), full: f.full ? f.full.slice() : null, bases: copy(f.bases), fb: copy(f.fb), hives: copy(f.hives), sites: copy(f.sites) })),
    events: c.events.map((e) => ({ ...e, text: e.text.split("").join("") })),
    own: c.own.slice(), inf: c.inf.slice(), factions: JSON.parse(JSON.stringify(c.factions)),
  };
  gc(); gc();
  heap = process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers - h0;
  if (!clone.frames.length) heap = null;
} catch { /* no gc available: estimate only */ }
const per365 = (b) => kb((b / lastDay) * 365);
console.log(`  ${size.frames} frames (${size.keyframes} keyframes), ${size.interned} distinct base / group-base / hive / site lists, ${size.captions} captions`);
console.log(`  typed-array payload ${kb(size.payload)}, captions ~${kb(size.captionBytes)}, estimated total ${kb(size.approx)}${heap != null ? `, measured heap ${kb(heap)}` : ""}`);
console.log(`  scaled to 365 days: estimate ${per365(size.approx)}${heap != null ? `, measured ${per365(heap)}` : ""}`);
const budget = 2 * Math.max(1, areaScale(sizeDef(mapSize))); // MB: 2 on a Normal map, by tile count on a bigger one
check(size.approx < budget * 1024 * 1024, `under ${budget.toFixed(1)} MB`);

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
let truthOk = 0, ruinSamples = 0;
for (const tr of run.truth) {
  const fs = seq.frameState(tr.hour);
  const k = fs.frame;
  if (fs.info.fallen) continue; // the holdout fell in this hour: its last frame shows your land gone on purpose
  const ownOk = fs.tiles.every((t, i) => (t.owner ?? null) === tr.owner[i]);
  const infOk = fs.tiles.every((t, i) => Math.round(t.infection * INF_Q) === tr.inf[i]);
  const hordesOk = fs.hordes.map((h) => `${h.tile}:${h.size}`).sort().join(" ") === tr.hordes;
  const popOk = fs.info.pop === tr.pop && c.frames[k].h === tr.hour;
  const ruinsOk = fs.tiles.filter((t) => t.ruin).map((t) => `${t.id}:${t.ruin.name}`).join(",") === tr.ruins;
  if (tr.ruins) ruinSamples++;
  if (check(ownOk && infOk && hordesOk && popOk && ruinsOk, `frame at day ${Math.floor(tr.hour / 24) + 1} matches the live world (owners ${ownOk}, infection ${infOk}, hordes ${hordesOk}, people ${popOk}, ruins ${ruinsOk})`)) truthOk++;
}
console.log(`  ruins of razed bases in ${ruinSamples} of the weekly samples (each frame's ruins match the live world's)`);
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
let built = 0, errors = 0, maxParties = 0, maxHordes = 0, fallenSeen = false, lastFs = null;
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
    lastFs = fs; // (the last time is the last frame's hour)
  } catch (err) {
    if (errors++ < 3) console.log(`  error at hour ${t}: ${err.stack}`);
  }
}
const ms = performance.now() - t1;
check(errors === 0, "every frame state renders without errors");
// Every base already lost before the last death (a raid's Retreat card, then the road: conquest.js retreatFrom): no
// base of yours left to mark, the frame says the holdout fell all the same.
const lostFirst = !c.frames[c.frames.length - 1].bases.length;
if (lostFirst) check(!!(lastFs && lastFs.info.fallen && !lastFs.bases.length), "the last frame says the holdout fell (its bases lost before the last death: none left to mark)");
else check(fallenSeen, "the last frame shows the fallen holdout");
console.log(`  ${built} frame states built and rendered (${lastDay} mid-day + ${c.frames.length} frame hours), ${(ms / built).toFixed(2)} ms each (JS only), ${draws} draw calls; up to ${maxHordes} hordes and ${maxParties} parties on screen`);

// Ruins in the timelapse: a ruin appears in the frames from the day the base burned, with its name, is drawn by the
// renderer, and is gone from the frames after an outpost was founded on it; frames from before it burned never show
// it (the replay's tiles take their ruins from the frames, not from today's map).
{
  const w = createWorld({ seed: seed + 1, factionCount: 4, size: mapSize });
  const h = hub(w);
  const rt = w.grid.within(h.tile, 3).find((id) => id !== h.tile && w.tiles[id].terrain !== "water");
  const step = (n) => { for (let i = 0; i < n; i++) tickHour(w); };
  step(4 * 24);
  w.tiles[rt].ruin = { name: "Oak Hill Outpost", day: day(w), by: "raiders", from: "you", yours: true };
  step(4 * 24);
  delete w.tiles[rt].ruin; // an outpost founded on the ruins (parties.js deletes tile.ruin)
  step(4 * 24);
  w.tiles[rt].ruin = { name: "Oak Hill Outpost", day: day(w), by: "raiders", from: "you", yours: true }; // burned again: today's map has it
  const rd = chronicleReader(w);
  const at = (d) => rd.frameState((d - 1) * 24 + 12).tiles[rt].ruin;
  const before = at(3), during = at(6), after = at(10);
  check(!before && during && during.name === "Oak Hill Outpost" && during.yours && !after, `the replay shows the ruins only while they stood (day 3 ${!!before}, day 6 ${!!during}, day 10 ${!!after})`);
  R.view.layers = new Set(["pois", "territory", "teams", "hordes"]);
  R.camera.zoom = 1;
  const fs6 = rd.frameState(5 * 24 + 12);
  R.centerOn(fs6, rt);
  R.render(fs6);
  const drawn6 = R.mapOverlay().ruins.includes(rt);
  const fs10 = rd.frameState(9 * 24 + 12);
  R.render(fs10);
  check(drawn6 && !R.mapOverlay().ruins.includes(rt), "the renderer draws the ruins in the frames that have them, and not after the outpost was founded");
}

// A Retreat that lost every base before the last death (conquest.js retreatFrom, then the raid moving in): the last
// frame marks where the last base stood (your empty base, "Empty: <name> (your last base, lost day N)", drawn by the
// renderer), the overlay and the game-over caption say so, and no frame before the end has the marker.
{
  const w = createWorld({ seed: seed + 2, factionCount: 4, size: mapSize });
  const h = hub(w), name = h.name, tile = h.tile;
  const step = (n) => { for (let i = 0; i < n && !w.gameOver; i++) tickHour(w); };
  step(5 * 24);
  const f = w.factions.find((x) => x.alive) || w.factions[0];
  retreatFrom(w, h, null);
  occupyPlayerBase(w, h, f, { retreated: true });
  const lostDay = day(w);
  step(3 * 24);
  for (const s of alive(w).sort((a, b) => a.id - b.id)) killSurvivor(w, s, tile, "in the test's forced decline");
  finishChronicle(w);
  const rd = chronicleReader(w);
  const end = rd.frameState(rd.h1), early = rd.frameState(3 * 24 + 12);
  const lb = end.lastBase;
  check(w.gameOver && !w.bases.length && end.info.fallen, `the retreat left no base and everyone died (game over ${!!w.gameOver}, bases ${w.bases.length})`);
  check(!!lb && lb.tile === tile && lb.name === name && Math.abs(lb.day - lostDay) <= 1 && end.abandoned.some((a) => a.tile === tile && a.from === "player"), `the last frame marks where the last base stood (${lb ? `${lb.name} @${lb.tile}, lost day ${lb.day}` : "no marker"}; ${name} @${tile}, lost day ${lostDay})`);
  check(!early.lastBase && !early.abandoned.length, "no last-base marker before the end");
  const cap = rd.events[rd.events.length - 1];
  check(cap && cap.tile === tile && cap.text.includes(name) && /marks where it stood/.test(cap.text) && /on the road for \d+ day/.test(cap.text), `the game-over caption says where the last base stood ("${cap ? cap.text : ""}")`);
  R.view.layers = new Set(["pois", "territory", "teams", "hordes"]);
  R.camera.zoom = 1;
  R.centerOn(end, tile);
  R.render(end);
  check(R.mapOverlay().empty.includes(tile), "the renderer draws your empty last base at that tile");
  const TLv = await import("../src/ui/timelapse.js");
  check(TLv.lastBaseHTML(end.info).includes(name) && TLv.lastBaseHTML(early.info) === "", "the overlay says where the last base stood (only at the end)");
  console.log(`  retreat with no base left: ${name} lost on day ${lostDay}, last death on day ${day(w)}; "${TLv.lastBaseHTML(end.info).replace(/<[^>]+>/g, "")}"`);
}

// Terrain detail (ui/terraindeco.js) in the timelapse: zoomed in, every 10th day with decals and rippled water, the
// same decals as the game's map (the frame state carries the world's seed), none with the Flat option.
{
  const T = await import("../src/ui/terraindeco.js");
  let atlas = new Set(), decals = 0, errs = 0;
  const dctx = new Proxy(ctx, { get: (o, k) => (k === "drawImage" ? (cv) => { draws++; if (atlas.has(cv)) decals++; } : o[k]) });
  T.setDecoCanvas((w, h) => ({ width: w, height: h, getContext: () => dctx }));
  R.initRenderer({ getContext: () => dctx, getBoundingClientRect: () => ({ width: 1600, height: 900 }), width: 0, height: 0 });
  for (const r of [1, 2]) atlas.add(T.decoAtlas(r).cv);
  R.camera.zoom = 1.2;
  const run2 = (detail) => {
    T.setMapDetail(detail);
    decals = 0;
    const t0 = performance.now();
    let k = 0;
    for (let d = 1; d <= lastDay; d += 10) {
      try { const fs = reader.frameState((d - 1) * 24 + 12); R.centerOn(fs, hub(state)?.tile ?? fs.bases[0]?.tile ?? 0); R.render(fs); k++; } catch (err) { if (errs++ < 3) console.log(`  error (day ${d}): ${err.stack}`); }
    }
    return { k, ms: (performance.now() - t0) / Math.max(1, k), decals };
  };
  const det = run2(true), flat = run2(false);
  T.setMapDetail(true);
  T.setDecoCanvas(null);
  check(!errs && det.decals > 0 && flat.decals === 0, "zoomed in, the timelapse draws the terrain detail (none with Flat)");
  const rows = (D) => T.decorRows(D).map((r) => r.join(",")).join(";");
  check(rows(T.placeDecor(reader.frameState(12), R.HEX)) === rows(T.placeDecor(state, R.HEX)), "the timelapse places the same decals as the game's map");
  console.log(`  zoom 1.2, every 10th day: ${det.k} frames, ${det.decals} decals, ${det.ms.toFixed(2)} ms a frame detailed vs ${flat.ms.toFixed(2)} ms flat (JS only)`);
}

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
