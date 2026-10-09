// Lightning on the State Map in thunderstorms (sim/weather.js storm fronts): strikes over the storms you can see and
// over the listening tile's area, each a flash of light over the land, a bolt down to the tile it hits, and its
// thunder after the light (ui/ambweather.js: the map is where the strikes come from while it is drawn; the ambience
// keeps only the distant grumbles of storms off screen or coming).
//
// When: each storm front on screen (or within LIGHTNING.reach tiles of the listening tile, the middle of the view)
// strikes every LIGHTNING.every seconds, irregularly, a heavy storm (its rain) more often; now and then a strike
// flickers twice or three times. A day a tool made a storm over the whole state strikes over the view. The dice are
// this module's own (never the world's).
// Where: a tile under the storm, on screen or in the listening area, that has the storm now (weatherAt).
// What: the land brightens (up in LIGHTNING.rise ms, gone over LIGHTNING.decay ms), most round the strike; the bolt (a
// jagged line with forks, made once per strike, from the clouds or the top of the view down to the tile: big zoomed
// in, small zoomed out with the glow round it regional) is gone in about LIGHTNING.bolt ms with a faint afterglow. At
// night the flash lifts the night shade for a moment, most round the strike (holes in the shade, as the lights make:
// ui/nightfx.js nightFlash, so the land shows as it is, not washed out); the storm's clouds brighten with it; a strike
// in a fog bank is a diffuse glow with no bolt. ui/render.js calls lightningFrame before the night shade and
// drawLightning after it, before bases, teams, labels, icons and the selection (they are never flashed).
// Comfort: never more than LIGHTNING.perSec flashes (flickers count) in any LIGHTNING.window ms; the whole map's
// brightening is capped (LIGHTNING.screen.all, lift.all); Display → Lightning flashes: Full, Soft (no whole-map
// brightening and no flickers: the bolt and a local glow) or Off (the thunder only); Reduce motion makes Full Soft.
// Cost: nothing is drawn while no flash runs (one comparison a frame); a flash paints a small light map (a quarter of
// the map's pixels each way, reused) and puts it on with one "screen" draw, then strokes the bolt; the night shade's
// own small overlay takes the holes. The strikes are a small pool of preallocated slots. The hour is in no cache key.
// Not in the timelapse (days fly by: it would strobe) or the minimap.
// Pure UI: reads the state, never changes it, never touches the world's dice.
//
//   lightningFrame(v)           ui/render.js, every drawn map frame before the night shade: strikes due, this frame's
//                               flash, the shade's lift (v: below)
//   drawLightning(ctx[, v])     ui/render.js after the night shade: the light and the bolts (with v: the frame first)
//   lightningWants(now)         a flash is running or a strike is due: render.js draws the frame
//   strikeNow(state, tile, o)   a strike now (dev tools, tests, screenshots); false when the cap says no
//   setLightning(level, calm)   ui/display.js: the Display option; lightningLevel() the one in force
//   seedLightning(n), resetLightning(), lightningStats, LIGHTNING
import { visibleFronts, weatherAt } from "../sim/weather.js";
import { ambLightning, mapSky } from "./ambweather.js";
import { nightLevel, shadeAlpha, mapHour, nightShade, nightFlash } from "./nightfx.js";
import { LIGHTNING_LEVELS } from "./displayopts.js";

const SQ3 = Math.sqrt(3);
export const LIGHTNING = {
  every: { light: [9, 20], heavy: [6, 13] }, // s between one storm's strikes (light rain 0.75 to the heaviest 1)
  first: [1.5, 7],         // s before a storm newly in sight strikes
  reach: 2,                // tiles round the listening tile that strike even off screen (heard, not seen)
  hear: 2.2,               // near = e^(-tiles / hear): 1 overhead, 0.63 a tile off, 0.4 two, 0.1 five
  perSec: 3, window: 1000, // at most perSec flashes in any window ms (photosensitivity: WCAG 2.3.1)
  rise: [60, 120], decay: [300, 500], // ms: the brightening up and down
  bolt: 200, after: 650,   // ms: the bolt gone, the afterglow gone
  flicker: { three: 0.08, two: 0.22, gap: [70, 150], dim: [0.65, 0.9] },
  // The light (a "screen" over the land: s lifts a pixel d to d + s(1 - d)): the whole map at most `screen.all`, round
  // the strike `screen.local`, by day (first) to full night (second). At night the shade itself lifts instead
  // (ui/nightfx.js nightFlash): all over by up to `lift.all` of it (Full), round the strike by up to `lift.local`, so
  // at full night the flash costs no extra pass over the map (the shade's own small overlay takes it).
  screen: { all: [0.12, 0], local: [0.3, 0] }, lift: { all: 0.35, local: 0.85 },
  glowTiles: 3.2,          // the local glow's radius in tiles (at least glowMin device px)
  glowMin: 70,
  boltWorld: 230,          // the bolt's height in world px (5 tiles), at least boltMin device px
  boltMin: 44,
  wash: 0.16,              // the storm's clouds brighten (a screen pass, this strong at the peak)
};
const POOL = 4, MAIN = 17, BR = 3, BRP = 6;

// ---------- the option ----------
const opt = { level: "full", calm: false };
export function setLightning(level, calm = false) { opt.level = Object.hasOwn(LIGHTNING_LEVELS, level) ? level : "full"; opt.calm = !!calm; }
export const lightningLevel = () => (opt.level === "full" && opt.calm ? "soft" : opt.level);

// ---------- dice (this module's own) ----------
let seed = (Date.now() ^ 0x5bd1e995) >>> 0;
export const seedLightning = (n) => { seed = n >>> 0; };
function rnd() { // mulberry32
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const range = (a) => a[0] + (a[1] - a[0]) * rnd();
const clamp01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x);

export const lightningStats = { strikes: 0, pulses: 0, capped: 0, paths: 0, thunder: 0, frames: 0, ms: 0, lastMs: 0, maxMs: 0 };
// For the tools: with on set, every strike as { at, tile, near, fog, pulses: [ms] } (nothing kept otherwise).
export const strikeLog = { on: false, list: [] };
export const lightningActive = () => active;

// ---------- the strikes: a pool of slots, reused ----------
const slot = () => ({
  on: false, t0: 0, end: 0, tile: -1, ox: 0, oy: 0, near: 0, fog: false, wash: null,
  n: 0, pt: new Float64Array(3), pk: new Float32Array(3), rise: 80, decay: 400,
  main: new Float32Array(MAIN * 2), br: new Float32Array(BR * BRP * 2), brN: 0,
});
const strikes = Array.from({ length: POOL }, slot);
let active = 0;
const flashes = new Float64Array(16); // the start of every flash lately (ring), for the cap
let flashN = 0;

// The storms that strike (front id → when next), worked out again every SRC_MS.
const sources = new Map();
const SRC_MS = 400;
let srcAt = -1e9, lastFrame = -1e9, nextDue = Infinity;
let fogs = []; // fog banks [x, y, r] in tile units
const live = [];  // this refresh's storms: { id, x, y, r } in tile units (reused objects)

export function resetLightning() {
  for (const s of strikes) s.on = false;
  active = 0;
  flashN = 0;
  flashes.fill(-1e12);
  sources.clear();
  live.length = 0;
  fogs = [];
  srcAt = -1e9; lastFrame = -1e9; nextDue = Infinity;
  nightFlash.n = 0; nightFlash.all = 0; FR.on = false;
  for (const k of Object.keys(lightningStats)) lightningStats[k] = 0;
}
flashes.fill(-1e12);

// A flash running, or a strike due: the map is drawn this frame.
export const lightningWants = (now) => active > 0 || now >= nextDue;

// ---------- the cap ----------
// A flash at t fits when no LIGHTNING.window holds more than LIGHTNING.perSec flashes with it: the ones drawn lately
// and planned (a flicker's later pulses are recorded ahead) and `plan` (the strike's own pulses before it).
const near4 = new Float64Array(32), planned = new Float64Array(3);
function fits(t, plan, nPlan) {
  const W = LIGHTNING.window;
  let n = 0;
  for (let i = 0; i < flashes.length; i++) if (Math.abs(flashes[i] - t) <= W) near4[n++] = flashes[i];
  for (let j = 0; j < nPlan; j++) if (Math.abs(plan[j] - t) <= W) near4[n++] = plan[j];
  near4[n++] = t;
  for (let i = 1; i < n; i++) { const x = near4[i]; let j = i - 1; while (j >= 0 && near4[j] > x) { near4[j + 1] = near4[j]; j--; } near4[j + 1] = x; }
  const k = LIGHTNING.perSec;
  for (let i = 0; i + k < n; i++) if (near4[i + k] - near4[i] <= W) return false;
  return true;
}
// How many of a strike's pulses (at now + offs[i]) may flash: 0, none now.
function allowPulses(now, offs, n) {
  let ok = 0;
  while (ok < n && fits(now + offs[ok], planned, ok)) { planned[ok] = now + offs[ok]; ok++; }
  return ok;
}
// When the next flash may start: now, or just after one in the window leaves it.
function freeAt(now) {
  if (fits(now, planned, 0)) return now;
  let best = Infinity;
  for (let i = 0; i < flashes.length; i++) {
    const c = flashes[i] + LIGHTNING.window + 1;
    if (c > now && c < best && fits(c, planned, 0)) best = c;
  }
  return best < Infinity ? best : now + LIGHTNING.window;
}

// ---------- the bolt: made once per strike ----------
// The main channel from the cloud (v 0) to the ground (v 1, u 0) by midpoint displacement, u across in bolt heights;
// a few forks off it.
function makeBolt(s) {
  const m = s.main;
  const u0 = (rnd() - 0.5) * 0.3;
  m[0] = u0; m[1] = 0; m[(MAIN - 1) * 2] = 0; m[(MAIN - 1) * 2 + 1] = 1;
  for (let step = MAIN - 1, amp = 0.2; step > 1; step >>= 1, amp *= 0.62) {
    for (let i = step >> 1; i < MAIN - 1; i += step) {
      const a = i - (step >> 1), b = i + (step >> 1);
      m[i * 2] = (m[a * 2] + m[b * 2]) / 2 + (rnd() - 0.5) * amp;
      m[i * 2 + 1] = (m[a * 2 + 1] + m[b * 2 + 1]) / 2 + (rnd() - 0.5) * amp * 0.25;
    }
  }
  s.brN = s.fog ? 0 : 1 + Math.floor(rnd() * BR);
  for (let k = 0; k < s.brN; k++) {
    const at = 2 + Math.floor(rnd() * 9), side = rnd() < 0.5 ? -1 : 1;
    let u = m[at * 2], v = m[at * 2 + 1];
    const len = 0.18 + rnd() * 0.24, o = k * BRP * 2;
    for (let p = 0; p < BRP; p++) {
      s.br[o + p * 2] = u; s.br[o + p * 2 + 1] = v;
      u += side * (0.35 + rnd() * 0.7) * len / BRP; v += (0.45 + rnd() * 0.6) * len / BRP;
    }
  }
  lightningStats.paths++;
}

// ---------- where the storms are ----------
const tileXY = (state, id) => { const W = state.grid.width, x = id % W, y = (id - x) / W; return [x + 0.5 * (y & 1), y * SQ3 / 2]; };
function refresh(state, frac, view, listen) {
  live.length = 0;
  fogs = [];
  let fronts = [];
  try { fronts = visibleFronts(state, frac); } catch { /* no weather yet */ }
  const L = listen >= 0 ? tileXY(state, listen) : null;
  for (const f of fronts) {
    if (!(f.r > 0)) continue;
    if (f.k === "fog") { fogs.push([f.x, f.y, f.r]); continue; }
    if (f.k !== "storm") continue;
    const nx = Math.max(view[0], Math.min(f.x, view[2])), ny = Math.max(view[1], Math.min(f.y, view[3]));
    const seen = (f.x - nx) ** 2 + (f.y - ny) ** 2 <= f.r * f.r;
    const heard = L && Math.hypot(f.x - L[0], f.y - L[1]) <= f.r + LIGHTNING.reach;
    if (seen || heard) live.push({ id: f.id, x: f.x, y: f.y, r: f.r, sky: false });
  }
  // A storm over the whole state (no front: a day a tool forced): it strikes over the view.
  if (!live.length && listen >= 0) {
    let w = null;
    try { w = weatherAt(state, listen); } catch { /* bare state */ }
    if (w && w.key === "storm" && !w.front) live.push({ id: "sky", x: (view[0] + view[2]) / 2, y: (view[1] + view[3]) / 2, r: Math.hypot(view[2] - view[0], view[3] - view[1]) / 2, sky: true });
  }
}

// Picks a tile for a storm to strike: in the storm, on screen or near the listening tile, under the storm now.
function pickTile(state, src, view, listen) {
  const g = state.grid, L = listen >= 0 ? tileXY(state, listen) : null;
  for (let i = 0; i < 10; i++) {
    let x, y;
    if (L && i % 3 === 2) { const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * LIGHTNING.reach; x = L[0] + Math.cos(a) * d; y = L[1] + Math.sin(a) * d; }
    else { const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * src.r; x = src.x + Math.cos(a) * d; y = src.y + Math.sin(a) * d; }
    if (!src.sky && (x - src.x) ** 2 + (y - src.y) ** 2 > src.r * src.r) continue;
    const onScreen = x >= view[0] && x <= view[2] && y >= view[1] && y <= view[3];
    if (!onScreen && !(L && Math.hypot(x - L[0], y - L[1]) <= LIGHTNING.reach)) continue;
    const row = Math.round(y / (SQ3 / 2)), col = Math.round(x - 0.5 * (row & 1));
    if (row < 0 || col < 0 || row >= g.height || col >= g.width) continue;
    const id = row * g.width + col;
    let w = null;
    try { w = weatherAt(state, id); } catch { /* bare state */ }
    if (!w || w.key !== "storm") continue;
    return { id, ox: x - (col + 0.5 * (row & 1)), oy: y - row * SQ3 / 2, heavy: clamp01(((Number(w.rain) || 0.85) - 0.75) / 0.25) };
  }
  return null;
}
// Seconds to a storm's next strike: heavy ones more often.
export const strikeGap = (heavy) => {
  const E = LIGHTNING.every, h = clamp01(heavy);
  return range([E.light[0] + (E.heavy[0] - E.light[0]) * h, E.light[1] + (E.heavy[1] - E.light[1]) * h]);
};
// How near a strike `d` tiles from the listening tile sounds (ui/ambweather.js picks the thunder by it).
export const nearOf = (d, within = 0) => Math.exp(-(Math.max(0, d) + within * 0.4) / LIGHTNING.hear);

// ---------- a strike ----------
const offs = new Float64Array(3);
// Strikes a tile now: the thunder always (unless the cap says no), the flash unless the option is Off. Returns the
// strike's slot (or true with flashes off), false when the cap holds it back (try at `lightningFreeAt`).
function strike(state, now, id, ox, oy, o) {
  const level = lightningLevel();
  let n = 1;
  if (level === "full") { const u = rnd(); n = u < LIGHTNING.flicker.three ? 3 : u < LIGHTNING.flicker.three + LIGHTNING.flicker.two ? 2 : 1; }
  offs[0] = 0;
  for (let i = 1; i < n; i++) offs[i] = offs[i - 1] + range(LIGHTNING.flicker.gap);
  const ok = allowPulses(now, offs, n);
  if (!ok) { lightningStats.capped++; return false; }
  if (ok < n) lightningStats.capped++;
  n = ok;
  for (let i = 0; i < n; i++) { flashes[flashN] = now + offs[i]; flashN = (flashN + 1) % flashes.length; }
  lightningStats.strikes++;
  lightningStats.pulses += n;
  // The thunder: after the light, by how far from where you listen.
  const near = o.near != null ? o.near : nearOf(o.dist ?? 8, Math.hypot(ox, oy));
  ambLightning(near, "map");
  lightningStats.thunder++;
  if (strikeLog.on) strikeLog.list.push({ at: now, tile: id, near, fog: !!o.fog, pulses: Array.from(offs.subarray(0, n), (x) => now + x) });
  if (level === "off") return true;
  let s = strikes.find((x) => !x.on);
  if (!s) { s = strikes[0]; for (const x of strikes) if (x.t0 < s.t0) s = x; active--; } // the oldest gives way
  s.on = true; active++;
  s.t0 = now; s.tile = id; s.ox = ox; s.oy = oy; s.near = near; s.n = n;
  s.rise = range(LIGHTNING.rise); s.decay = range(LIGHTNING.decay);
  for (let i = 0; i < n; i++) { s.pt[i] = offs[i]; s.pk[i] = i ? range(LIGHTNING.flicker.dim) : 1; }
  s.end = now + offs[n - 1] + Math.max(s.rise + s.decay, LIGHTNING.after);
  s.wash = o.wash || null;
  const [tx, ty] = tileXY(state, id);
  s.fog = o.fog != null ? !!o.fog : fogs.some(([x, y, r]) => (tx + ox - x) ** 2 + (ty + oy - y) ** 2 <= r * r);
  if (strikeLog.on) strikeLog.list[strikeLog.list.length - 1].fog = s.fog;
  makeBolt(s);
  return s;
}

// A strike on `tile` now (dev tools, tests, screenshots): its thunder by its distance from `o.listen` (or o.near).
export function strikeNow(state, tile, o = {}) {
  if (!state || !state.grid || tile == null || tile < 0) return false;
  const now = o.now ?? performance.now();
  if (o.fog == null) {
    try { fogs = visibleFronts(state, 0).filter((f) => f.k === "fog").map((f) => [f.x, f.y, f.r]); } catch { fogs = []; }
  }
  const dist = o.listen != null && o.listen >= 0 ? state.grid.distance(o.listen, tile) : o.dist;
  return strike(state, now, tile, o.ox || 0, o.oy || 0, { near: o.near, dist, fog: o.fog, wash: o.wash });
}
export const lightningFreeAt = (now) => freeAt(now);

// ---------- the frame ----------
// This frame's flash, worked out by lightningFrame for drawLightning (and the night shade, nightfx.js nightFlash).
const FR = { on: false, v: null, now: 0, level: "full", whole: 0, night: 0 };
const pos = Array.from({ length: POOL }, () => new Float64Array(5)); // per slot: screen x, y, e, bolt e, glow radius (device px)

// v: { state, cw, ch (device px), S (device px per world px), ox, oy (the camera in device px), hex (world px),
// frac (the minutes of the coming hour), timelapse, now? }. Strikes due, then this frame's flash; returns the
// flashes running. ui/render.js calls it before the night shade (which it lifts) and drawLightning after.
export function lightningFrame(v) {
  const { state } = v;
  const now = v.now ?? performance.now();
  FR.on = false;
  nightFlash.n = 0; nightFlash.all = 0;
  if (v.timelapse || !state || !state.grid) { // the timelapse: nothing (and nothing left over for afterwards)
    if (active || sources.size) { for (const s of strikes) s.on = false; active = 0; sources.clear(); }
    nextDue = Infinity;
    return 0;
  }
  mapSky(); // the map is where the strikes come from (ui/ambweather.js leaves near thunder to it)
  if (now - lastFrame > 2000) sources.clear(); // back on the map after a while: the storms start again
  lastFrame = now;
  const U = v.hex * SQ3, S = v.S;
  // The view and the listening tile (its middle, as ui/audio.js listens) in tile units.
  const view = [v.ox / S / U, v.oy / S / U, (v.ox + v.cw) / S / U, (v.oy + v.ch) / S / U];
  const listen = state.grid.fromPixel((v.ox + v.cw / 2) / S, (v.oy + v.ch / 2) / S, v.hex);
  if (now - srcAt >= SRC_MS || now >= nextDue) {
    srcAt = now;
    refresh(state, v.frac || 0, view, listen);
    for (const k of sources.keys()) if (!live.some((x) => x.id === k)) sources.delete(k);
    for (const x of live) if (!sources.has(x.id)) sources.set(x.id, now + range(LIGHTNING.first) * 1000);
    // Strikes due.
    for (const x of live) {
      const due = sources.get(x.id);
      if (now < due) continue;
      const free = freeAt(now);
      if (free > now) { sources.set(x.id, free); continue; }
      const t = pickTile(state, x, view, listen);
      if (!t) { sources.set(x.id, now + range(LIGHTNING.first) * 1000); continue; }
      const r = strike(state, now, t.id, t.ox, t.oy, { dist: listen >= 0 ? state.grid.distance(listen, t.id) : 8, wash: x.sky ? null : x });
      sources.set(x.id, r ? now + strikeGap(t.heavy) * 1000 : freeAt(now));
    }
    nextDue = Infinity;
    for (const t of sources.values()) if (t < nextDue) nextDue = t;
  }
  if (!active) return 0;
  const level = lightningLevel();
  const diag = Math.hypot(v.cw, v.ch);
  let whole = 0;
  for (let i = 0; i < POOL; i++) {
    const s = strikes[i];
    if (!s.on) continue;
    if (now >= s.end || level === "off") { s.on = false; active--; continue; }
    const e = envelope(s, now, false), eb = s.fog ? 0 : envelope(s, now, true);
    const [tx, ty] = tileXY(state, s.tile);
    const wx = (tx + s.ox) * U, wy = (ty + s.oy) * U, gx = wx * S - v.ox, gy = wy * S - v.oy;
    const R = Math.min(1.4 * diag, Math.max(LIGHTNING.glowMin, LIGHTNING.glowTiles * U * S)) * (s.fog ? 1.5 : 1) * (level === "soft" ? 0.75 : 1);
    const P = pos[i];
    P[0] = gx; P[1] = gy; P[2] = e; P[3] = eb; P[4] = R;
    // The whole map: the strongest strike's light, less the further off screen it is.
    const out = Math.hypot(Math.max(0, -gx, gx - v.cw), Math.max(0, -gy, gy - v.ch));
    whole = Math.max(whole, e * clamp01(1 - out / (0.6 * diag)) * (s.fog ? 0.7 : 1));
    // The night shade lifts round the strike (a hole in it, as a light makes: ui/nightfx.js).
    if (e > 0.01) {
      const H = nightFlash.holes[nightFlash.n++];
      H[0] = wx; H[1] = wy; H[2] = (R / S) * 1.15; H[3] = Math.min(1, LIGHTNING.lift.local * e * (s.fog ? 0.8 : 1));
    }
  }
  if (!active) return 0;
  nightFlash.all = level === "full" ? LIGHTNING.lift.all * whole : 0;
  let a = 0;
  try { a = shadeAlpha(nightLevel(mapHour(state, v.frac || 0)), nightShade()); } catch { a = 0; }
  FR.on = true; FR.v = v; FR.now = now; FR.level = level; FR.whole = whole; FR.night = clamp01(a / 0.62);
  return active;
}

// Draws this frame's flash (after the night shade): the light over the land (a small light map, put on with one
// "screen" draw), then the bolts. With v, works the frame out first (the tools).
export function drawLightning(ctx, v = null) {
  if (v) lightningFrame(v);
  if (!FR.on || !active) return 0;
  const t0 = performance.now();
  const n = drawFlashes(ctx, FR.v, FR.now);
  const ms = performance.now() - t0;
  lightningStats.frames++; lightningStats.ms += ms; lightningStats.lastMs = ms;
  if (ms > lightningStats.maxMs) lightningStats.maxMs = ms;
  return n;
}

// How bright a strike is at `now` (0–1): its pulses' envelopes, the brightest. bolt: the bolt's (sharp, ~200 ms).
function envelope(s, now, bolt) {
  let e = 0;
  for (let i = 0; i < s.n; i++) {
    const dt = now - s.t0 - s.pt[i];
    if (dt < 0) continue;
    let x;
    if (bolt) x = dt < 50 ? 1 : dt < LIGHTNING.bolt ? (LIGHTNING.bolt - dt) / (LIGHTNING.bolt - 50) : 0;
    else x = dt < s.rise ? dt / s.rise : (1 - Math.min(1, (dt - s.rise) / s.decay)) ** 2;
    x *= s.pk[i];
    if (x > e) e = x;
  }
  return e;
}

// The light map: a quarter of the map's device pixels each way (at most LM_MAX wide), black where no light.
let lm = null, lmx = null;
const LM_MAX = 960;
const makeCanvas = () => (typeof document !== "undefined" && document && typeof document.createElement === "function" ? document.createElement("canvas") : null);
const mix = (a, k) => a[0] + (a[1] - a[0]) * k;

const box = new Float64Array(4); // the lit part of the light map this frame: x0, y0, x1, y1
function drawFlashes(ctx, v, now) {
  const { S, cw, ch } = v;
  const level = FR.level, U = v.hex * SQ3;
  const sAll = level === "full" ? mix(LIGHTNING.screen.all, FR.night) * FR.whole : 0;
  const sLocal = mix(LIGHTNING.screen.local, FR.night), sWash = level === "full" ? LIGHTNING.wash * (1 - FR.night) : 0;
  if (!lm) { lm = makeCanvas(); lmx = lm ? lm.getContext("2d") : null; }
  const q = lmx ? Math.max(4, Math.ceil(cw / LM_MAX)) : 1, w = Math.max(1, Math.ceil(cw / q)), h = Math.max(1, Math.ceil(ch / q));
  const g = lmx || ctx; // no offscreen canvas (the headless tools): straight onto the map
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  // The whole map (Full), capped: one plain fill over it.
  if (sAll > 0.005) {
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = `rgba(${LIGHT_ALL},${sAll.toFixed(3)})`;
    ctx.fillRect(0, 0, cw, ch);
  }
  // The local light (round the strikes, the storm's clouds): on the light map, then put on over just the part it
  // covers (none at full night: the shade's lift is the light there).
  let lit = false;
  for (let i = 0; i < POOL && !lit; i++) if (strikes[i].on && pos[i][2] * Math.max(sLocal, strikes[i].wash ? sWash : 0) > 0.004) lit = true;
  let drawn = 0;
  if (lit) {
    if (lmx) {
      if (lm.width !== w || lm.height !== h) { lm.width = w; lm.height = h; }
      g.globalCompositeOperation = "copy";
      g.fillStyle = "#000";
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = "lighter";
    } else g.globalCompositeOperation = "screen";
    box[0] = w; box[1] = h; box[2] = 0; box[3] = 0;
    for (let i = 0; i < POOL; i++) {
      const s = strikes[i];
      if (!s.on) continue;
      const P = pos[i], e = P[2];
      if (e <= 0.01) continue;
      // The storm's clouds light up from inside (Full).
      if (sWash > 0 && s.wash) {
        const cx = (s.wash.x * U * S - v.ox) / q, cy = (s.wash.y * U * S - v.oy) / q, RW = (s.wash.r * 1.25 * U * S) / q;
        glow(g, cx, cy, RW, LIGHT_WASH, sWash * e, 0.55, w, h);
      }
      // Round the strike: wider and softer in fog.
      glow(g, P[0] / q, P[1] / q, P[4] / q, LIGHT_LOCAL, sLocal * e * (s.fog ? 0.8 : 1), s.fog ? 0.5 : 0.3, w, h);
    }
    if (lmx && box[2] > box[0] && box[3] > box[1]) { // one draw, over the lit part of the map
      const x0 = Math.floor(box[0]), y0 = Math.floor(box[1]), x1 = Math.min(w, Math.ceil(box[2])), y1 = Math.min(h, Math.ceil(box[3]));
      ctx.globalCompositeOperation = "screen";
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(lm, x0, y0, x1 - x0, y1 - y0, x0 * q, y0 * q, (x1 - x0) * q, (y1 - y0) * q);
    }
  }
  for (let i = 0; i < POOL; i++) if (strikes[i].on) drawn++;
  // The bolts (none in fog), and their afterglow.
  for (let i = 0; i < POOL; i++) {
    const s = strikes[i];
    if (s.on && !s.fog) drawBolt(ctx, s, pos[i][0], pos[i][1], S, ch, pos[i][3], now);
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.restore();
  return drawn;
}
const LIGHT_ALL = "190,205,240", LIGHT_LOCAL = "200,215,255", LIGHT_WASH = "150,170,215";
// A soft round light (k at its heart, half of it at `knee`), clipped to the w × h canvas.
function glow(g, x, y, R, rgb, k, knee, w, h) {
  if (k <= 0.004 || R <= 0 || x + R < 0 || y + R < 0 || x - R > w || y - R > h) return;
  const gr = g.createRadialGradient(x, y, 0, x, y, R);
  gr.addColorStop(0, `rgba(${rgb},${Math.min(1, k).toFixed(3)})`);
  gr.addColorStop(knee, `rgba(${rgb},${Math.min(1, k * 0.5).toFixed(3)})`);
  gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr;
  const x0 = Math.max(0, x - R), y0 = Math.max(0, y - R), x1 = Math.min(w, x + R), y1 = Math.min(h, y + R);
  g.fillRect(x0, y0, x1 - x0, y1 - y0);
  if (x0 < box[0]) box[0] = x0;
  if (y0 < box[1]) box[1] = y0;
  if (x1 > box[2]) box[2] = x1;
  if (y1 > box[3]) box[3] = y1;
}

function drawBolt(ctx, s, gx, gy, S, ch, eb, now) {
  const dt = now - s.t0 - s.pt[s.n - 1];
  const after = dt < LIGHTNING.after ? 0.28 * (1 - Math.max(0, dt) / LIGHTNING.after) : 0;
  if (eb <= 0.01 && after <= 0.01) return;
  const H = Math.min(1.6 * ch, Math.max(LIGHTNING.boltMin, LIGHTNING.boltWorld * S));
  const w = Math.max(1, Math.min(3.5, H / 160));
  if (gy - H > ch || gy < -H * 0.1) return;
  const path = (arr, from, n) => { ctx.moveTo(gx + arr[from] * H, gy - H + arr[from + 1] * H); for (let i = 1; i < n; i++) ctx.lineTo(gx + arr[from + i * 2] * H, gy - H + arr[from + i * 2 + 1] * H); };
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  const glow = Math.max(eb * 0.9, after);
  // glow, the channel, the white core; the forks thinner and fainter
  for (const [rgb, k, width] of STROKES) {
    const al = (width > 3 ? glow : eb) * k;
    if (al <= 0.01) continue;
    ctx.strokeStyle = `rgba(${rgb},${al.toFixed(3)})`;
    ctx.lineWidth = w * width;
    ctx.beginPath(); path(s.main, 0, MAIN); ctx.stroke();
    if (s.brN) {
      ctx.strokeStyle = `rgba(${rgb},${(al * 0.75).toFixed(3)})`;
      ctx.lineWidth = w * width * 0.6;
      ctx.beginPath();
      for (let b = 0; b < s.brN; b++) path(s.br, b * BRP * 2, BRP);
      ctx.stroke();
    }
  }
}
const STROKES = [["120,150,255", 0.22, 9], ["170,200,255", 0.5, 3.5], ["245,248,255", 0.95, 1.3]];
