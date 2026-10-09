// Headless checks for lightning on the State Map (src/ui/lightningfx.js; the thunder in ui/ambweather.js; the hooks in
// ui/render.js and ui/display.js):
// - strikes only under storms, only over the storms on screen or near the listening tile, on storm tiles; none from a
//   storm far off; strikes off screen near the listening tile (heard, not seen);
// - the gaps between one storm's strikes (light 9-20 s, heavy 6-13 s; heavy ones more often);
// - never more than 3 flashes in any second (flickers counted), with the strikes coming as fast as they can;
// - each strike calls the ambience's thunder with its "near" (by the distance from the listening tile), the
//   ambience plays it after the light, and on the map plays no near or rolling thunder of its own (it still does in a
//   battle); the title's storm still thunders as before;
// - Full / Soft / Off and Reduce motion forcing Soft; the whole-map brightening capped; fog: a glow, no bolt; zoom:
//   a small bolt far out, a big one close in; at night the lift is stronger;
// - nothing drawn while no flash runs; a bolt's path made once per strike; the timelapse skips it all;
// - determinism: the world plays the same with and without it (and drawing never changes the save).
// Usage: node tools/lightningtest.js [seed]
import { createWorld, tickHour, setNextId } from "../src/sim/world.js";
import { saveToString } from "../src/sim/save.js";
import { weatherAt, tileUnits, dropWeatherCaches, regionOnDay, visibleFronts } from "../src/sim/weather.js";
import {
  drawLightning, lightningWants, strikeNow, setLightning, lightningLevel, seedLightning, resetLightning, lightningStats,
  strikeLog, lightningActive, LIGHTNING, strikeGap, nearOf,
} from "../src/ui/lightningfx.js";
import { takeFlashes, mapSky, thunderFor, weatherFrame, ambLightning, MAP_SKY_HOLD } from "../src/ui/ambweather.js";
import { ambiencePlan, makeScene } from "../src/ui/ambscene.js";
import { AMB_OPTS, ambEngine } from "../src/ui/ambkit.js";
import { ambTarget } from "../src/ui/ambience.js";
import { readDisplayOptions, DISPLAY_DEFAULTS, LIGHTNING_LEVELS } from "../src/ui/displayopts.js";
import { setNightShade } from "../src/ui/nightfx.js";
import { readFileSync } from "node:fs";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok" : "FAIL"}: ${what}`); return ok; };
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const HEX = 26, U = HEX * Math.sqrt(3), CW = 1920, CH = 1080;
AMB_OPTS.sync = true;
seedLightning(1234);
setNightShade("dark");

// ---------- a recording canvas ----------
function makeCtx() {
  const calls = [];
  return {
    calls, globalAlpha: 1, globalCompositeOperation: "source-over", fillStyle: "", strokeStyle: "", lineWidth: 1, lineCap: "", lineJoin: "", imageSmoothingEnabled: true,
    save() { calls.push(["save"]); }, restore() { calls.push(["restore"]); }, setTransform() {},
    createRadialGradient(...a) { const g = { a, stops: [], addColorStop(o, c) { this.stops.push([o, c]); } }; calls.push(["grad", g]); return g; },
    fillRect(x, y, w, h) { calls.push(["fill", this.globalCompositeOperation, this.fillStyle, x, y, w, h]); },
    beginPath() {}, moveTo(x, y) { calls.push(["move", x, y]); }, lineTo(x, y) { calls.push(["line", x, y]); },
    stroke() { calls.push(["stroke", this.globalCompositeOperation, this.strokeStyle, this.lineWidth]); },
  };
}
const alphaOf = (c) => { const m = /rgba\([^)]*,([\d.]+)\)$/.exec(String(c)); return m ? Number(m[1]) : NaN; };

// ---------- a world with a storm where we want it ----------
// A day whose sky is fair and mild (a storm front stays a storm, a fog bank shows) and an hour of it.
function fairHour(W, hourOfDay) {
  for (let d = 3; d < 80; d++) {
    const r = regionOnDay(W, d + 1);
    if (["clear", "overcast"].includes(r.key) && (r.hi + r.lo) / 2 > 6) return d * 24 + hourOfDay;
  }
  return 5 * 24 + hourOfDay;
}
function world(s = seed, hourOfDay = 13) {
  const W = createWorld({ seed: s, factionCount: 3 });
  W.hour = fairHour(W, hourOfDay);
  weatherAt(W, 0); // the fronts up to now
  W.weather.fronts = W.weather.fronts.filter((f) => f.t0 > W.hour + 24 * 4); // no fronts of its own near now
  dropWeatherCaches();
  return W;
}
// A front (k) over tile, radius r tiles, standing still for days; p: how heavy.
function addFront(W, k, tile, r, p = 0.9) {
  const w = W.weather, [x, y] = tileUnits(W, tile);
  const f = { k, x, y, vx: 0, vy: 0, r, t0: W.hour - 4, t1: W.hour + 200, p, id: w.nf++ };
  let i = w.fronts.length;
  while (i > 0 && w.fronts[i - 1].t0 > f.t0) i--;
  w.fronts.splice(i, 0, f);
  dropWeatherCaches();
  return f;
}
const mid = (W) => Math.floor(W.grid.height / 2) * W.grid.width + Math.floor(W.grid.width / 2);
const tileAt = (W, dx, dy) => { const c = mid(W), x = c % W.grid.width + dx, y = Math.floor(c / W.grid.width) + dy; return y * W.grid.width + x; };
// The camera centred on a tile at scale S (device px per world px).
const cam = (W, tile, S = 1) => { const [px, py] = W.grid.toPixel(tile, HEX); return { S, ox: px * S - CW / 2, oy: py * S - CH / 2 }; };
let T = 1e7; // the test's clock (ms)
// Frames for `secs` at `fps`: returns the draw calls made and the strikes logged.
function frames(W, c, secs, { fps = 20, timelapse = false, ctx = null } = {}) {
  const x = ctx || makeCtx();
  strikeLog.on = true; strikeLog.list = [];
  const n = Math.round(secs * fps);
  for (let i = 0; i < n; i++) {
    drawLightning(x, { state: W, cw: CW, ch: CH, S: c.S, ox: c.ox, oy: c.oy, hex: HEX, frac: 0, timelapse, now: T });
    T += 1000 / fps;
  }
  const list = strikeLog.list;
  strikeLog.on = false; strikeLog.list = [];
  return { calls: x.calls, list };
}
const fresh = (level = "full", calm = false) => { resetLightning(); takeFlashes(); setLightning(level, calm); T += 10000; };
// A tile's centre on screen (m: a margin in tiles; a strike lands anywhere in its tile).
const onScreen = (W, c, tile, m = 0.6) => { const [px, py] = W.grid.toPixel(tile, HEX), e = m * U * c.S; const sx = px * c.S - c.ox, sy = py * c.S - c.oy; return sx >= -e && sx <= CW + e && sy >= -e && sy <= CH + e; };

// ---------- 1. when and where ----------
console.log("When and where");
{
  fresh();
  const W = world(), c0 = mid(W), C = cam(W, c0);
  const idle = frames(W, C, 120);
  check(idle.list.length === 0 && idle.calls.length === 0 && !lightningWants(T), "no storm: no strikes in two minutes, nothing drawn, no frames asked for");
  addFront(W, "rain", c0, 7);
  const rain = frames(W, C, 120);
  check(rain.list.length === 0 && rain.calls.length === 0, "a rain belt: no lightning");
  W.weather.fronts = W.weather.fronts.filter((f) => f.k !== "rain"); dropWeatherCaches();
  addFront(W, "storm", c0, 6, 0.9);
  check(weatherAt(W, c0).key === "storm", "(the test storm is a storm over the middle tile)");
  const run = frames(W, C, 600);
  const L = run.list;
  check(L.length >= 30, `a storm on screen: ${L.length} strikes in 10 minutes`);
  check(L.every((s) => weatherAt(W, s.tile).key === "storm"), "every strike on a storm tile");
  check(L.every((s) => onScreen(W, C, s.tile) || W.grid.distance(c0, s.tile) <= LIGHTNING.reach + 1), "every strike on screen or near the listening tile");
  // Far away: a storm 25 tiles off, the camera elsewhere.
  fresh();
  const W2 = world(), far = tileAt(W2, -24, 0), C2 = cam(W2, tileAt(W2, 6, 0));
  addFront(W2, "storm", far, 5);
  check(frames(W2, C2, 300).list.length === 0, "a storm far off screen and out of earshot: no strikes (the ambience's distant grumbles only)");
  // Zoomed right in on a big storm: some strikes off screen but in the listening area.
  fresh();
  const W3 = world(), c3 = mid(W3), C3 = cam(W3, c3, 12);
  addFront(W3, "storm", c3, 9);
  const close = frames(W3, C3, 900).list;
  const off = close.filter((s) => !onScreen(W3, C3, s.tile));
  check(close.length > 20 && off.length > 0 && off.every((s) => W3.grid.distance(c3, s.tile) <= LIGHTNING.reach + 1), `zoomed in: ${off.length} of ${close.length} strikes just off screen, all within earshot of the listening tile (heard, not seen)`);
}

// ---------- 2. how often ----------
console.log("How often");
{
  const gaps = (heavy) => { const a = []; for (let i = 0; i < 3000; i++) a.push(strikeGap(heavy)); return a; };
  const lg = gaps(0), hv = gaps(1);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  check(lg.every((x) => x >= 9 && x <= 20) && hv.every((x) => x >= 6 && x <= 13), `the gaps: a light storm ${Math.min(...lg).toFixed(1)}-${Math.max(...lg).toFixed(1)} s, a heavy one ${Math.min(...hv).toFixed(1)}-${Math.max(...hv).toFixed(1)} s`);
  check(mean(hv) < mean(lg) - 3, `heavy storms strike more often (mean ${mean(hv).toFixed(1)} s against ${mean(lg).toFixed(1)} s)`);
  const run = (p) => {
    fresh();
    const W = world(), c = mid(W);
    addFront(W, "storm", c, 6, p);
    const L = frames(W, cam(W, c), 1200).list;
    const d = [];
    for (let i = 1; i < L.length; i++) d.push((L[i].at - L[i - 1].at) / 1000);
    return d;
  };
  const dl = run(0), dh = run(1);
  check(dl.length > 30 && dl.every((x) => x >= 9 - 0.06 && x <= 20 + 0.06), `a light storm on the map: ${dl.length + 1} strikes in 20 min, ${Math.min(...dl).toFixed(1)}-${Math.max(...dl).toFixed(1)} s apart`);
  check(dh.length > 50 && dh.every((x) => x >= 6 - 0.06 && x <= 13 + 0.06), `a heavy storm: ${dh.length + 1} strikes, ${Math.min(...dh).toFixed(1)}-${Math.max(...dh).toFixed(1)} s apart`);
  check(new Set(dh.map((x) => x.toFixed(1))).size > 20, "irregular (no fixed beat)");
  // Flickers: some strikes flash twice or three times (Full).
  fresh();
  const W = world(), c = mid(W);
  addFront(W, "storm", c, 6, 1);
  const L = frames(W, cam(W, c), 1800).list;
  const by = [1, 2, 3].map((n) => L.filter((s) => s.pulses.length === n).length);
  check(by[0] > by[1] && by[1] > 0 && by[0] + by[1] + by[2] === L.length, `flickers now and then: ${by[0]} single, ${by[1]} double, ${by[2]} triple`);
  check(L.every((s) => s.pulses.every((t, i) => !i || (t - s.pulses[i - 1] >= 70 && t - s.pulses[i - 1] <= 150))), "a flicker's flashes 70-150 ms apart");
}

// ---------- 3. the cap ----------
console.log("At most 3 flashes a second");
{
  const keep = JSON.stringify(LIGHTNING);
  const okCap = (pulses) => { const p = pulses.slice().sort((a, b) => a - b); for (let i = 0; i + 3 < p.length; i++) if (p[i + 3] - p[i] <= 1000) return false; return true; };
  fresh();
  LIGHTNING.every = { light: [0.05, 0.1], heavy: [0.05, 0.1] };
  LIGHTNING.first = [0.01, 0.05];
  LIGHTNING.flicker.three = 0.6; LIGHTNING.flicker.two = 0.3;
  const W = world(), c = mid(W);
  for (const [dx, dy] of [[-6, 0], [0, 0], [6, 0]]) addFront(W, "storm", tileAt(W, dx, dy), 4, 1);
  const L = frames(W, cam(W, c), 120, { fps: 60 }).list;
  const pulses = L.flatMap((s) => s.pulses);
  check(pulses.length >= 200 && okCap(pulses), `three storms striking as fast as they may for 2 minutes: ${pulses.length} flashes, never 4 within a second`);
  check(pulses.length <= 3 * 121, "at most 3 a second overall");
  Object.assign(LIGHTNING, JSON.parse(keep));
  // strikeNow pressed hard
  fresh();
  strikeLog.on = true; strikeLog.list = [];
  let yes = 0;
  for (let i = 0; i < 100; i++) { if (strikeNow(W, c, { now: T + i * 37, dist: 0 })) yes++; }
  const sp = strikeLog.list.flatMap((s) => s.pulses);
  strikeLog.on = false;
  check(yes < 20 && yes >= 3 && okCap(sp), `strikeNow 100 times in 3.7 s: ${yes} let through, ${sp.length} flashes, the cap holds`);
}

// ---------- 4. the thunder ----------
console.log("Thunder");
{
  check(nearOf(0) === 1 && nearOf(1) > 0.6 && nearOf(1) < 0.65 && nearOf(2) < nearOf(1) && nearOf(5) < 0.15, `near by distance: 1 overhead, ${nearOf(1).toFixed(2)} a tile off, ${nearOf(2).toFixed(2)} two, ${nearOf(5).toFixed(2)} five`);
  check(thunderFor(0.9) === "thunderNear" && thunderFor(0.4) === "thunderFar" && thunderFor(0.08) === "thunderDistant" && thunderFor(0.01) === null, "the thunder by how near: a crack, rolling, a distant grumble, nothing");
  fresh();
  const W = world(), c = mid(W);
  addFront(W, "storm", c, 6, 1);
  takeFlashes();
  const L = frames(W, cam(W, c), 300).list;
  const F = takeFlashes();
  check(L.length > 10 && F.length >= Math.min(L.length, 6) && F.every((f) => f.from === "map"), `each strike calls the ambience's thunder (ambLightning(near, "map")): ${L.length} strikes`);
  const tail = L.slice(-F.length);
  check(tail.every((s, i) => Math.abs(s.near - F[i].near) < 1e-9), "with the strike's near");
  check(L.every((s) => { const d = W.grid.distance(c, s.tile); return s.near <= Math.exp(-d / LIGHTNING.hear) + 1e-9 && s.near >= Math.exp(-(d + 0.4) / LIGHTNING.hear) - 1e-9; }), "near by the strike's distance from the listening tile");
  // The ambience: map strikes play after the light; no thunder of its own on the map; its own in a battle.
  const stub = () => {
    const starts = [];
    const param = (v = 0) => { const p = { value: v }; for (const k of ["setValueAtTime", "linearRampToValueAtTime", "exponentialRampToValueAtTime", "setTargetAtTime", "cancelScheduledValues"]) p[k] = () => p; return p; };
    const node = (x = {}) => ({ connect: (d) => d, disconnect() {}, ...x });
    const s = (x) => node({ start(t) { starts.push({ t: t ?? 0, buf: this.buffer }); }, stop() {}, ...x });
    const ctx = {
      sampleRate: 8000, currentTime: 0,
      createGain: () => node({ gain: param(1) }), createBiquadFilter: () => node({ type: "", frequency: param(350), Q: param(1) }),
      createOscillator: () => s({ type: "", frequency: param(440) }), createBufferSource: () => s({ buffer: null, loop: false, playbackRate: param(1) }),
      createBuffer: (ch, len, sr) => { const d = Array.from({ length: ch }, () => new Float32Array(len)); return { duration: len / sr, length: len, sampleRate: sr, numberOfChannels: ch, getChannelData: (i) => d[i], copyToChannel: (a, i) => d[i].set(a) }; },
      createStereoPanner: () => node({ pan: param() }),
    };
    return { E: ambEngine(ctx, { connect() {}, disconnect() {} }), starts };
  };
  // The thunder voices baked (ui/ambkit.js bakeBuffer keeps them by "name:variant").
  const thunderBufs = new Set();
  const thunders = (starts, E) => { note(E); return starts.filter((s) => s.buf && thunderBufs.has(s.buf)); };
  const note = (E) => { for (const [k, b] of E.bufs) if (k.startsWith("thunder")) thunderBufs.add(b); };
  const storm = (mode) => { const P = ambiencePlan(makeScene({ hour: 14, season: "summer", wx: { key: "storm", wind: 0.9, rainI: 0.9, temp: 18, storm: 1 }, ter: { field: 1 } })); P.mode = mode; return P; };
  {
    const { E, starts } = stub();
    takeFlashes();
    const P = storm("map");
    check(P.weather.thunderNear > 0 && P.weather.thunderFar > 0, "(the plan for a storm still has near and rolling thunder: a battle plays them)");
    for (let t = 0; t < 300; t += 0.25) { mapSky(); weatherFrame(E, P, t); }
    check(thunders(starts, E).length === 0, "on the map under a storm, 5 minutes: the ambience plays no thunder of its own (the map's strikes are the thunder)");
    mapSky();
    ambLightning(0.95, "map");
    const before = starts.length;
    weatherFrame(E, P, 300);
    const th = thunders(starts.slice(before), E);
    check(th.length === 1 && th[0].t > 300 && th[0].t < 300 + 2.6, `a map strike overhead: one near crack, ${(th[0] ? th[0].t - 300 : NaN).toFixed(2)} s after the light`);
    ambLightning(0.3, "map");
    const b2 = starts.length;
    weatherFrame(E, P, 310);
    const th2 = thunders(starts.slice(b2), E);
    check(th2.length === 1 && th2[0].t - 310 > (th[0].t - 300), `a strike two or three tiles off: rolling thunder, later (${(th2[0] ? th2[0].t - 310 : NaN).toFixed(2)} s)`);
  }
  {
    const { E, starts } = stub();
    const P = storm("battle");
    for (let t = 0; t < 300; t += 0.25) { mapSky(); weatherFrame(E, P, t); }
    check(thunders(starts, E).length >= 4, `in a battle the ambience keeps its own thunder (${thunders(starts, E).length} in 5 minutes)`);
  }
  {
    const { E, starts } = stub();
    const P = storm("map");
    const until = performance.now() + MAP_SKY_HOLD + 50;
    while (performance.now() < until) { /* the map not drawn for a while */ }
    for (let t = 0; t < 300; t += 0.25) weatherFrame(E, P, t);
    check(thunders(starts, E).length >= 4, "the map not drawn (its sky stale): the ambience thunders by itself again");
  }
  // The title's storm: as before.
  {
    const { E, starts } = stub();
    takeFlashes();
    ambLightning(0.8);
    const P = ambTarget(null, { title: true }, {}, 0, {});
    weatherFrame(E, P, 0);
    const th = thunders(starts, E).filter((s) => s.t >= 1 && s.t <= 4);
    check(P.beds.rainWash > 0 && th.length === 1, `the title's storm: thunder a second or three after its flash (${th[0] ? th[0].t.toFixed(1) : "?"} s), rain while it flashes`);
    ambLightning(0.8, "map");
    const before = starts.length;
    weatherFrame(E, ambTarget(null, { title: true }, {}, 0, {}), 1);
    check(thunders(starts.slice(before), E).length === 0, "a map strike is not heard on the title screen");
  }
}

// ---------- 5. the look and the options ----------
console.log("Look and options");
{
  const W = world(), c = mid(W), C = cam(W, c);
  addFront(W, "storm", c, 6, 1);
  const peak = (level, calm = false, { S = 1, hourOfDay = 13, fog = false, wash = true } = {}) => {
    fresh(level, calm);
    W.hour = Math.floor(W.hour / 24) * 24 + hourOfDay;
    const cc = cam(W, c, S);
    const fr = visibleFronts(W, 0).find((f) => f.k === "storm");
    const r = strikeNow(W, c, { now: T, dist: 0, fog, wash: wash ? fr : null });
    const ctx = makeCtx();
    drawLightning(ctx, { state: W, cw: CW, ch: CH, S: cc.S, ox: cc.ox, oy: cc.oy, hex: HEX, frac: 0, timelapse: false, now: T + 90 });
    return { r, calls: ctx.calls };
  };
  const whole = (calls) => calls.filter((x) => x[0] === "fill" && x[1] === "color-dodge" && x[3] === 0 && x[4] === 0 && x[5] === CW && x[6] === CH);
  const full = peak("full");
  const wf = whole(full.calls);
  check(wf.length === 1 && full.calls.some((x) => x[0] === "stroke") && full.calls.some((x) => x[0] === "fill" && x[1] === "screen"), "Full: the whole map brightens, the storm's clouds light up, a bolt");
  check(wf.every((x) => alphaOf(x[2]) <= LIGHTNING.global[1] / 1.6 + 1e-3) && LIGHTNING.global[1] <= 0.45, `the whole-map brightening capped: gain at most ${(1 + LIGHTNING.global[1]).toFixed(2)} at full night, ${(1 + LIGHTNING.global[0]).toFixed(2)} by day`);
  const soft = peak("soft");
  check(whole(soft.calls).length === 0 && !soft.calls.some((x) => x[1] === "screen") && soft.calls.some((x) => x[0] === "stroke") && soft.calls.some((x) => x[0] === "grad"), "Soft: no whole-map brightening, the bolt and a glow round it");
  setLightning("full", true);
  check(lightningLevel() === "soft", "Reduce motion makes Full Soft");
  setLightning("off", true);
  check(lightningLevel() === "off", "Off stays Off with Reduce motion");
  setLightning("purple");
  check(lightningLevel() === "full", "an unknown setting reads as Full");
  takeFlashes();
  const off = peak("off");
  check(off.r === true && off.calls.length === 0 && lightningActive() === 0 && takeFlashes().some((f) => f.from === "map"), "Off: nothing drawn, the thunder still comes");
  fresh("soft");
  const Ws = world(), cs = mid(Ws);
  addFront(Ws, "storm", cs, 6, 1);
  const softL = frames(Ws, cam(Ws, cs), 600).list;
  check(softL.length > 10 && softL.every((s) => s.pulses.length === 1), "Soft: no flickers");
  // Fog: a glow, no bolt.
  const fog = peak("full", false, { fog: true });
  check(!fog.calls.some((x) => x[0] === "stroke") && fog.calls.some((x) => x[0] === "grad"), "a strike in fog: a diffuse glow, no bolt");
  {
    fresh();
    const Wf = world(), cf = mid(Wf);
    addFront(Wf, "storm", cf, 6, 1);
    addFront(Wf, "fog", cf, 4);
    strikeLog.on = true; strikeLog.list = [];
    strikeNow(Wf, cf, { now: T, dist: 0 });
    const s = strikeLog.list[0];
    strikeLog.on = false;
    const seen = visibleFronts(Wf, 0).some((f) => f.k === "fog");
    check(!seen || (s && s.fog), `a strike inside a fog bank is foggy (${seen ? "fog bank on the map" : "no fog bank shows on this day"})`);
  }
  // Zoom: a small bolt far out, a big one close in.
  const span = (calls) => { const ys = calls.filter((x) => x[0] === "move" || x[0] === "line").map((x) => x[2]); return Math.max(...ys) - Math.min(...ys); };
  const farOut = span(peak("full", false, { S: 0.25 }).calls), closeIn = span(peak("full", false, { S: 3 }).calls);
  check(farOut < 80 && closeIn > 500, `zoom: the bolt ${farOut.toFixed(0)} px tall far out, ${closeIn.toFixed(0)} px close in`);
  // Night: the flash lifts the shade round the strike (a stronger lift than by day).
  const localA = (calls) => Math.max(...calls.filter((x) => x[0] === "grad").map((x) => x[1]).filter((g) => /153,158,168/.test(g.stops[0][1])).map((g) => alphaOf(g.stops[0][1])));
  const day = localA(peak("full", false, { hourOfDay: 13 }).calls), night = localA(peak("full", false, { hourOfDay: 1 }).calls);
  check(night > day * 1.8, `at night the lift round the strike is stronger (${night.toFixed(2)} against ${day.toFixed(2)} by day)`);
  // Display options.
  const o = readDisplayOptions({});
  check(o.lightning === "full" && DISPLAY_DEFAULTS.lightning === "full" && Object.keys(LIGHTNING_LEVELS).join() === "full,soft,off", "default: Lightning flashes Full");
  check(readDisplayOptions({}, { lightning: "soft" }).lightning === "soft" && readDisplayOptions({}, { lightning: "blinding" }).lightning === "full", "stored values read back, junk ignored");
  const d = src("src/ui/display.js");
  check(/data-action="dsp-lightning"/.test(d) && /"dsp-lightning": \(ui, el\)/.test(d) && /setLightning\(OPT\.lightning, !!OPT\.calm\)/.test(d), "Settings → Display: Lightning flashes (Full / Soft / Off), applied with Reduce motion");
  check(/<b>Lightning flashes<\/b>/.test(d) && /Never more than 3 flashes/.test(d), "Help → Readability explains it");
}

// ---------- 6. cheap ----------
console.log("Cheap");
{
  fresh();
  const W = world(), c = mid(W), C = cam(W, c);
  addFront(W, "storm", c, 6, 1);
  const ctx = makeCtx();
  const r = frames(W, C, 300, { fps: 60, ctx });
  check(r.list.length > 10 && lightningStats.paths === lightningStats.strikes && lightningStats.frames > 0, `a bolt's path made once per strike (${lightningStats.paths} paths, ${lightningStats.strikes} strikes, ${lightningStats.frames} frames with a flash)`);
  // Between flashes nothing is drawn: frames with calls are only those within a strike's life.
  fresh();
  const W2 = world(), c2 = mid(W2), C2 = cam(W2, c2);
  addFront(W2, "storm", c2, 6, 1);
  let quiet = 0, busy = 0, strayCalls = 0;
  strikeLog.on = true; strikeLog.list = [];
  for (let i = 0; i < 60 * 120; i++) {
    const x = makeCtx(), was = lightningActive();
    drawLightning(x, { state: W2, cw: CW, ch: CH, S: 1, ox: C2.ox, oy: C2.oy, hex: HEX, frac: 0, timelapse: false, now: T });
    if (!was && !lightningActive()) { quiet++; if (x.calls.length) strayCalls++; } else busy++;
    T += 1000 / 60;
  }
  strikeLog.on = false;
  check(quiet > busy * 3 && strayCalls === 0, `nothing drawn with no flash running (${quiet} quiet frames, ${busy} with a flash)`);
  check(!lightningWants(T - 1e6) || lightningActive() > 0, "no frames asked for while idle (lightningWants false)");
  // The same path frame to frame.
  fresh();
  strikeNow(W2, c2, { now: T, dist: 0 });
  const a = makeCtx(), b = makeCtx();
  const v = { state: W2, cw: CW, ch: CH, S: 1, ox: C2.ox, oy: C2.oy, hex: HEX, frac: 0, timelapse: false };
  drawLightning(a, { ...v, now: T + 20 });
  drawLightning(b, { ...v, now: T + 60 });
  const pts = (x) => JSON.stringify(x.calls.filter((k) => k[0] === "move" || k[0] === "line"));
  check(pts(a).length > 50 && pts(a) === pts(b), "the bolt keeps its shape from frame to frame");
  // The render hook: after the night shade, before what stays bright.
  const R = src("src/ui/render.js");
  check(/if \(lightningWants\(now\)\) forceDraw = true;/.test(R) && R.indexOf("lightningWants(now)") < R.indexOf("unchanged(state, now)) { mapStats"), "render.js asks for the frame while a flash runs");
  check(R.indexOf("drawLightning(ctx") > R.indexOf("drawNight(ctx") && R.indexOf("drawLightning(ctx") < R.indexOf("drawLabels(labels") && R.indexOf("drawLightning(ctx") < R.indexOf("const inView = (id)"), "render.js draws it right after the night shade, before bases, teams, labels and the selection");
  check(!/lightning/i.test(src("src/ui/minimap.js")), "the minimap has none");
}

// ---------- 7. the timelapse ----------
console.log("Timelapse");
{
  fresh();
  const W = world(), c = mid(W), C = cam(W, c);
  addFront(W, "storm", c, 6, 1);
  strikeNow(W, c, { now: T, dist: 0 });
  const r = frames(W, C, 300, { timelapse: true });
  check(r.list.length === 0 && r.calls.length === 0 && lightningActive() === 0 && !lightningWants(T), "the timelapse: no strikes, nothing drawn, a running flash dropped");
}

// ---------- 8. determinism ----------
console.log("Determinism");
{
  fresh();
  const W = world(), c = mid(W);
  addFront(W, "storm", c, 6, 1);
  const before = saveToString(W);
  frames(W, cam(W, c), 300, { fps: 30 });
  for (let i = 0; i < 20; i++) strikeNow(W, c + i, { now: T + i * 1500, dist: 1 });
  check(saveToString(W) === before, "drawing and striking never changes the world (the same save)");
  const run = (watch) => {
    setNextId(6_000_000);
    const st = createWorld({ seed: seed + 3, factionCount: 3 });
    weatherAt(st, 0);
    addFront(st, "storm", mid(st), 7, 1);
    const C = cam(st, mid(st));
    for (let h = 0; h < 72; h++) {
      tickHour(st);
      st.cards.length = 0;
      if (st.combat) st.combat = null;
      if (watch) for (let i = 0; i < 40; i++) { drawLightning(makeCtx(), { state: st, cw: CW, ch: CH, S: 1, ox: C.ox, oy: C.oy, hex: HEX, frac: i / 40, timelapse: false, now: T }); T += 250; }
    }
    const o = JSON.parse(saveToString(st));
    if (o.state && o.state.chronicle) delete o.state.chronicle.ms;
    return JSON.stringify(o);
  };
  fresh();
  const a = run(false), b = run(true);
  check(a.length > 1000 && a === b, `72 hours under a storm with and without the lightning: the same save (${a.length} chars, ${lightningStats.strikes} strikes)`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
