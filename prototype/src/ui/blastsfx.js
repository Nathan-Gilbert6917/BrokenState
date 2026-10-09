// Explosions and grenades (the user's ask: better explosion and grenade sounds), on the gun sounds' bus (ui/gunsfx.js:
// pan, distance, reverb, the ducking and the deafened muffle; the limiter in ui/audio.js). Rendered once per kind
// into buffers like the guns (ui/sfxdsp.js); a blast is then a body and a rumble tail (plus glass near cars and
// windows): a few nodes however big. ui/soundcues.js plans them from the battle's effects (throws, rockets, the blast
// hits, a vehicle wrecked), merges a frame's blasts into one bigger sound and times them to the throw's flight.
//
// A blast, in layers: the crack (an instant broadband transient, the shock front); the sub thump (a sine falling from
// 60–90 Hz, saturated so it is felt on small speakers too); the roar (broadband noise whose top closes down); the low
// rumble tail (long, rolling, under the room's reverb); debris, dirt and gravel pattering down a moment later; by kind
// fragment whizzes (a frag), pipe shards (a pipe bomb), a fireball and cook-off crackle (a vehicle), popcorn (rounds
// cooking off), a flashbang's ring. Far away a blast is a low-passed thud that arrives late (sound's speed); close, it
// ducks everything else for a moment. Grenade handling: the pin and spoon, the can clattering where it lands; a
// Molotov's bottle smashing, the whoomph and a fire that crackles and fades; smoke's pop and hiss; a flare's pop,
// fizz and sizzle; the 40 mm thoonk and the rocket's launch are gun voices (ui/gunsfx.js gl40, rocket).
import { rngOf, hashStr, noiseLayer, toneLayer, metalLayer, shape, rollTail } from "./sfxdsp.js";
import { spatialOut, busOf, place, GUN_TRIM, GUNVOL, HANDLING } from "./gunsfx.js";
import { groupGain, assignGroup } from "./soundgroups.js"; // the mixer: Explosions and grenades

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// size: 0–1.2 (merging, ducking, the distance rolloff); level: the body's peak; crack { amp, tau, hp }; sub { f0, f1,
// dur, amp, drive }; roar { amp, lp0, lp1, tau, dur }; rumble { amp, len, lp }; debris { n, from, span, amp, f };
// dirt { amp, from, dur }; whizz { n, amp } (frag); shards { n, amp } (pipe, glass); fireball, pops, crackle, ring, hiss.
export const BLASTS = {
  pipebomb: { label: "Pipe bomb (sharp, tinny)", size: 0.8, level: 0.9, crack: { amp: 1, tau: 0.004, hp: 900 }, sub: { f0: 90, f1: 34, dur: 0.3, amp: 0.5, drive: 2.5 },
              roar: { amp: 0.8, lp0: 7500, lp1: 600, tau: 0.16, dur: 0.7 }, rumble: { amp: 0.42, len: 2.4, lp: 240 }, debris: { n: 26, from: 0.18, span: 0.9, amp: 0.2 }, dirt: { amp: 0.13, from: 0.25, dur: 0.9 }, shards: { n: 7, amp: 0.3 } },
  frag:     { label: "Frag grenade (crack, fragments)", size: 0.85, level: 1, crack: { amp: 1, tau: 0.003, hp: 700 }, sub: { f0: 80, f1: 30, dur: 0.36, amp: 0.7, drive: 3 },
              roar: { amp: 0.85, lp0: 5200, lp1: 420, tau: 0.22, dur: 0.85 }, rumble: { amp: 0.5, len: 2.8, lp: 220 }, debris: { n: 34, from: 0.2, span: 1.1, amp: 0.22 }, dirt: { amp: 0.16, from: 0.25, dur: 1.1 }, whizz: { n: 6, amp: 0.32 } },
  gl40:     { label: "40 mm HE (tight, punchy)", size: 0.9, level: 0.95, crack: { amp: 1, tau: 0.0025, hp: 700 }, sub: { f0: 75, f1: 30, dur: 0.26, amp: 0.78, drive: 3.2 },
              roar: { amp: 0.8, lp0: 5600, lp1: 480, tau: 0.14, dur: 0.55 }, rumble: { amp: 0.42, len: 2.2, lp: 230 }, debris: { n: 24, from: 0.15, span: 0.8, amp: 0.2 }, dirt: { amp: 0.14, from: 0.2, dur: 0.8 } },
  rocket:   { label: "Rocket warhead (big)", size: 1.05, level: 1, crack: { amp: 1, tau: 0.005, hp: 500 }, sub: { f0: 60, f1: 24, dur: 0.55, amp: 1, drive: 3.6 },
              roar: { amp: 0.9, lp0: 4500, lp1: 260, tau: 0.4, dur: 1.4 }, rumble: { amp: 0.7, len: 4.2, lp: 190 }, debris: { n: 60, from: 0.25, span: 1.8, amp: 0.27 }, dirt: { amp: 0.24, from: 0.3, dur: 1.8 } },
  vehicle:  { label: "Vehicle / fuel (huge, fireball)", size: 1.2, level: 1, crack: { amp: 0.9, tau: 0.006, hp: 400 }, sub: { f0: 55, f1: 22, dur: 0.7, amp: 1, drive: 3.8 },
              roar: { amp: 0.9, lp0: 3800, lp1: 220, tau: 0.5, dur: 1.6 }, rumble: { amp: 0.8, len: 5, lp: 170 }, debris: { n: 50, from: 0.3, span: 2, amp: 0.25 }, dirt: { amp: 0.2, from: 0.3, dur: 2 },
              fireball: { amp: 0.75, from: 0.05, dur: 2.4 }, pops: { n: 5, from: 0.7, span: 2.4, amp: 0.45 }, crackle: { n: 40, from: 0.9, span: 3, amp: 0.2 }, glass: true, len: 4 },
  secondary:{ label: "Secondary (a carried bomb)", size: 0.75, level: 0.85, crack: { amp: 0.9, tau: 0.0035, hp: 800 }, sub: { f0: 85, f1: 32, dur: 0.3, amp: 0.55, drive: 2.6 },
              roar: { amp: 0.8, lp0: 6000, lp1: 500, tau: 0.16, dur: 0.7 }, rumble: { amp: 0.4, len: 2.2, lp: 230 }, debris: { n: 20, from: 0.18, span: 0.8, amp: 0.18 } },
  cookoff:  { label: "Ammo cooking off (popcorn)", size: 0.5, level: 0.6, crack: { amp: 0.5, tau: 0.002, hp: 1500 }, sub: { f0: 100, f1: 50, dur: 0.12, amp: 0.25, drive: 2 },
              roar: { amp: 0.3, lp0: 4000, lp1: 800, tau: 0.08, dur: 0.3 }, rumble: { amp: 0.15, len: 1.2, lp: 300 }, crackle: { n: 34, from: 0.05, span: 2.6, amp: 0.55 }, len: 3 },
  flash:    { label: "Flashbang (sharp bang, ring)", size: 0.7, level: 1, crack: { amp: 1, tau: 0.0016, hp: 2200 }, sub: { f0: 120, f1: 60, dur: 0.12, amp: 0.35, drive: 2.2 },
              roar: { amp: 0.6, lp0: 10000, lp1: 1800, tau: 0.05, dur: 0.25 }, rumble: { amp: 0.22, len: 1.3, lp: 400 }, ring: { f: 6200, amp: 0.1, dur: 1.4 }, len: 1.6 },
  firecracker: { label: "Firecrackers", size: 0.3, level: 0.5, crack: { amp: 0.6, tau: 0.0015, hp: 2000 }, sub: { f0: 160, f1: 90, dur: 0.05, amp: 0.15, drive: 1.5 },
              roar: { amp: 0.2, lp0: 6000, lp1: 2000, tau: 0.03, dur: 0.1 }, rumble: { amp: 0.08, len: 0.8, lp: 500 }, crackle: { n: 16, from: 0.05, span: 1.0, amp: 0.8, f: 2600 }, len: 1.3 },
  molotov:  { label: "Molotov (smash, whoomph)", size: 0.45, level: 0.7, smash: true, fireball: { amp: 1, from: 0.07, dur: 1.1 }, rumble: { amp: 0.2, len: 1.2, lp: 300 }, fire: true, len: 1.3 },
  smoke:    { label: "Smoke (pop, hiss)", size: 0.15, level: 0.45, pop: true, hiss: { amp: 0.55, dur: 3.6, f: 3200, am: 7 }, rumble: { amp: 0.04, len: 0.6, lp: 400 }, len: 3.8 },
  flare:    { label: "Flare (fizz, sizzle)", size: 0.1, level: 0.4, pop: true, hiss: { amp: 0.5, dur: 3, f: 2800, am: 13, sizzle: true }, rumble: { amp: 0.03, len: 0.5, lp: 400 }, len: 3.2 },
  glass:    { label: "Bottle (glass)", size: 0.05, level: 0.4, smash: true, rumble: { amp: 0.02, len: 0.3, lp: 500 }, len: 0.6 },
  clatter:  { label: "Something lands (clatter)", size: 0.02, level: 0.3, clatter: true, rumble: { amp: 0.02, len: 0.3, lp: 500 }, len: 0.6 },
};
assignGroup(Object.keys(BLASTS).map((k) => `blast:${k}`).concat(["fireloop"]), "weapons.blasts"); // the mixer's names for these (tools/soundmixtest.js)
export const BLAST_TRIM = 0.89; // all blasts under the effects slider: up 5 dB with the guns (a frag still well over a rifle), × the Explosions and grenades group
export const BIG = new Set(["pipebomb", "frag", "gl40", "rocket", "vehicle", "secondary", "flash"]);

// Grenade handling and the small things (rendered like the gun handling, ui/gunsfx.js HANDLING).
const MT = (start, amp, m, tick = 0.5) => ({ k: "metal", start, amp, modes: m, tick });
const NZ = (start, amp, dur, tau, f, q = 1, color = "white") => ({ k: "noise", start, amp, dur, tau, filters: [{ type: "bandpass", f, q }], color });
const TN = (start, amp, f0, f1, dur, tau) => ({ k: "tone", start, amp, f0, f1, dur, tau });
Object.assign(HANDLING, {
  pin:     [NZ(0, 0.4, 0.06, 0.02, 3800, 2), MT(0.05, 0.7, [[4600, 0.05, 1], [7100, 0.03, 0.5], [9800, 0.02, 0.3]]), MT(0.32, 1, [[3100, 0.12, 1], [4820, 0.07, 0.6], [7300, 0.04, 0.3]], 0.6)], // pin out, then the spoon flying off (ping)
  fuse:    [MT(0, 0.5, [[3800, 0.006, 1], [6000, 0.004, 0.5]]), NZ(0.02, 0.8, 0.5, 0.3, 4500, 0.9)], // a pipe bomb's fuse lit and sizzling
  light:   [MT(0, 0.6, [[4100, 0.005, 1], [6600, 0.004, 0.5]]), NZ(0.04, 0.8, 0.25, 0.1, 1400, 0.8, "pink")], // a lighter flicked, the rag catching
  strike:  [NZ(0, 1, 0.12, 0.04, 3000, 0.9), TN(0, 0.4, 300, 200, 0.03, 0.01)], // a flare struck
  clatter: [TN(0, 0.6, 140, 90, 0.04, 0.012), MT(0, 1, [[1150, 0.03, 1], [2330, 0.02, 0.6], [3900, 0.012, 0.3]]), MT(0.14, 0.55, [[1180, 0.025, 1], [2380, 0.017, 0.6]]), MT(0.23, 0.3, [[1200, 0.02, 1], [2400, 0.014, 0.5]]), NZ(0.27, 0.2, 0.18, 0.06, 1800, 1)],
  smash:   [TN(0, 0.5, 220, 120, 0.05, 0.015), NZ(0, 1, 0.12, 0.03, 4200, 0.7), ...[0.004, 0.015, 0.028, 0.04, 0.06, 0.08, 0.11].map((s, i) => MT(s, 0.6 - i * 0.05, [[3000 + i * 410, 0.05, 1], [4700 + i * 330, 0.03, 0.5]], 0.2))],
});

assignGroup(["pin", "fuse", "light", "strike", "clatter", "smash"].map((k) => `hand:${k}`), "weapons.blasts"); // a throw's handling: Explosions and grenades
// ---------- rendering ----------
function norm(buf, peak) {
  let pk = 0;
  for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > pk) pk = a; }
  if (pk > 0) for (let i = 0; i < buf.length; i++) buf[i] *= peak / pk;
  return buf;
}
// Gravel and debris: n tiny impacts from `from` over span s, thinning out (most early), each a short bandpassed tick.
function patter(buf, sr, r, o, base = 2600) {
  for (let i = 0; i < o.n; i++) {
    const u = r(), at = o.from + o.span * u * u;
    const f = (o.f || base) * (0.6 + r() * 0.9);
    noiseLayer(buf, sr, { start: at, dur: 0.02, amp: o.amp * (1 - u * 0.7) * (0.4 + r() * 0.6), a: 0.0005, tau: 0.004, filters: [{ type: "bandpass", f, q: 1.4 }], rnd: r });
  }
}
// Popcorn / cook-off crackle: little sharp bangs of noise with a body.
function popcorn(buf, sr, r, o) {
  for (let i = 0; i < o.n; i++) {
    const at = o.from + r() * o.span, f = (o.f || 1800) * (0.7 + r() * 0.8);
    noiseLayer(buf, sr, { start: at, dur: 0.04, amp: o.amp * (0.35 + r() * 0.65), a: 0.0002, tau: 0.006, filters: [{ type: "bandpass", f, q: 0.9 }], rnd: r });
    toneLayer(buf, sr, { start: at, f0: 240 + r() * 120, f1: 120, dur: 0.03, amp: o.amp * 0.35, a: 0.0004, tau: 0.008 });
  }
}
function events(buf, sr, ev, r, at = 0, amp = 1) {
  for (const e of ev) {
    if (e.k === "metal") metalLayer(buf, sr, { start: at + e.start, amp: e.amp * amp, modes: e.modes, tick: e.tick, rnd: r });
    else if (e.k === "noise") noiseLayer(buf, sr, { start: at + e.start, dur: e.dur, amp: e.amp * amp, a: 0.001, tau: e.tau, color: e.color, filters: e.filters, rnd: r });
    else toneLayer(buf, sr, { start: at + e.start, f0: e.f0, f1: e.f1, dur: e.dur, amp: e.amp * amp, a: 0.0015, tau: e.tau });
  }
}
export function renderBlast(kind, sr, seed = 1) {
  const K = BLASTS[kind] || BLASTS.frag, r = rngOf(hashStr(kind) + seed * 7919);
  const len = K.len || Math.max(1.3, (K.debris ? K.debris.from + K.debris.span : 0) + 0.2, K.roar ? K.roar.dur + 0.1 : 0);
  const body = new Float32Array(Math.ceil(len * sr));
  if (K.crack) {
    noiseLayer(body, sr, { start: 0.001, dur: K.crack.tau * 10, amp: K.crack.amp, a: 0.0001, tau: K.crack.tau, filters: [{ type: "highpass", f: K.crack.hp, q: 0.7 }], rnd: r });
    toneLayer(body, sr, { start: 0.001, f0: 420, f1: 160, dur: 0.012, amp: K.crack.amp * 0.6, a: 0.0002, tau: 0.003 }); // the shock front's push
  }
  if (K.roar) noiseLayer(body, sr, { start: 0.002, dur: K.roar.dur, amp: K.roar.amp, a: 0.002, tau: K.roar.tau, filters: [{ type: "lowpass", f: K.roar.lp0, q: 0.6, to: K.roar.lp1, sweep: K.roar.dur * 0.8 }], rnd: r });
  if (K.sub) toneLayer(body, sr, { start: 0.001, f0: K.sub.f0, f1: K.sub.f1, glide: K.sub.dur, dur: K.sub.dur * 1.6, amp: K.sub.amp, a: 0.002, tau: K.sub.dur * 0.45, drive: K.sub.drive });
  if (K.crack) shape(body, sr, 0, 0.08, 2.4);
  if (K.whizz) for (let i = 0; i < K.whizz.n; i++) {
    const at = 0.025 + r() * 0.15, f0 = 4500 + r() * 2500;
    noiseLayer(body, sr, { start: at, dur: 0.12, amp: K.whizz.amp * (0.5 + r() * 0.5), a: 0.01, tau: 0.035, filters: [{ type: "bandpass", f: f0, q: 6, to: f0 * 0.35, sweep: 0.11 }], rnd: r });
  }
  if (K.shards) for (let i = 0; i < K.shards.n; i++) metalLayer(body, sr, { start: 0.02 + r() * 0.5, amp: K.shards.amp * (0.4 + r() * 0.6), modes: [[2000 + r() * 3500, 0.04, 1], [5200 + r() * 2000, 0.025, 0.5]], tick: 0.3, rnd: r });
  if (K.fireball) {
    const F = K.fireball;
    noiseLayer(body, sr, { start: F.from, dur: F.dur, amp: F.amp, a: F.dur * 0.12, tau: F.dur * 0.35, color: "pink", filters: [{ type: "bandpass", f: 220, q: 0.6, to: 1300, sweep: F.dur * 0.4 }], rnd: r });
    noiseLayer(body, sr, { start: F.from, dur: F.dur, amp: F.amp * 0.6, a: F.dur * 0.1, tau: F.dur * 0.4, color: "brown", filters: [{ type: "lowpass", f: 400, q: 0.7 }], rnd: r });
  }
  if (K.pops) for (let i = 0; i < K.pops.n; i++) {
    const at = K.pops.from + r() * K.pops.span, a = K.pops.amp * (0.4 + r() * 0.6);
    noiseLayer(body, sr, { start: at, dur: 0.25, amp: a, a: 0.0005, tau: 0.04, filters: [{ type: "lowpass", f: 2500, q: 0.7 }], rnd: r });
    toneLayer(body, sr, { start: at, f0: 95, f1: 40, dur: 0.18, amp: a * 0.8, a: 0.002, tau: 0.06, drive: 2 });
  }
  if (K.crackle) popcorn(body, sr, r, K.crackle);
  if (K.debris) patter(body, sr, r, K.debris);
  if (K.dirt) noiseLayer(body, sr, { start: K.dirt.from, dur: K.dirt.dur, amp: K.dirt.amp, a: K.dirt.dur * 0.15, tau: K.dirt.dur * 0.35, color: "pink", filters: [{ type: "highpass", f: 1500, q: 0.7 }, { type: "lowpass", f: 6000, q: 0.7 }], rnd: r });
  if (K.ring) {
    toneLayer(body, sr, { start: 0.01, f0: K.ring.f, f1: K.ring.f * 0.97, dur: K.ring.dur, amp: K.ring.amp, a: 0.01, tau: K.ring.dur * 0.35 });
    metalLayer(body, sr, { start: 0.05, amp: 0.12, modes: [[2700, 0.06, 1], [4300, 0.04, 0.5]], tick: 0.2, rnd: r }); // the empty canister
  }
  if (K.smash) events(body, sr, HANDLING.smash, r, 0, 1);
  if (K.clatter) events(body, sr, HANDLING.clatter, r, 0, 1);
  if (K.pop) { toneLayer(body, sr, { start: 0, f0: 260, f1: 140, dur: 0.06, amp: 0.8, a: 0.001, tau: 0.015 }); noiseLayer(body, sr, { start: 0, dur: 0.03, amp: 0.6, a: 0.0005, tau: 0.006, filters: [{ type: "bandpass", f: 1500, q: 0.8 }], rnd: r }); }
  if (K.hiss) {
    const H = K.hiss;
    noiseLayer(body, sr, { start: 0.06, dur: H.dur, amp: H.amp, a: 0.15, hold: H.dur * 0.45, tau: H.dur * 0.18, filters: [{ type: "highpass", f: H.f * 0.7, q: 0.7 }, { type: "lowpass", f: H.f * 2.4, q: 0.6 }], am: [H.am, 0.45], rnd: r });
    if (H.sizzle) popcorn(body, sr, r, { n: 50, from: 0.1, span: H.dur * 0.8, amp: 0.25, f: 5000 });
  }
  norm(body, K.level);
  const tsr = Math.max(22050, Math.round(sr / 2));
  const R = K.rumble || { amp: 0.1, len: 0.5, lp: 300 };
  const tail = norm(rollTail(tsr, { len: R.len, lp: R.lp, lpEnd: R.lp * 0.6, rise: 0.05, color: "brown", rnd: r }), R.amp * K.level);
  return { body, tail, tsr };
}
// The fire a Molotov leaves: a crackling loop (2 s) that fades out (FIRE_SECS).
export const FIRE_SECS = 5;
export function renderFireLoop(sr, seed = 3) {
  const r = rngOf(seed), n = Math.round(2 * sr), buf = new Float32Array(n);
  noiseLayer(buf, sr, { start: 0, dur: 2, amp: 0.45, a: 0.001, hold: 2, tau: 1e9, color: "brown", filters: [{ type: "lowpass", f: 500, q: 0.7 }], am: [0.7, 0.4], rnd: r });
  popcorn(buf, sr, r, { n: 70, from: 0, span: 1.95, amp: 0.5, f: 2200 });
  // seamless: fade the last 50 ms into the first
  const f = Math.round(0.05 * sr);
  for (let i = 0; i < f; i++) { const k = i / f; buf[i] = buf[i] * k + buf[n - f + i] * (1 - k); }
  return norm(buf.subarray(0, n - f).slice(), 1);
}

const BAKED = new Map();
const CTX = new WeakMap();
function bufs(c, kind) {
  let m = CTX.get(c);
  if (!m) { m = new Map(); CTX.set(c, m); }
  let b = m.get(kind);
  if (b) return b;
  const key = `${c.sampleRate}|${kind}`;
  let d = BAKED.get(key);
  if (!d) { d = kind === "fireloop" ? { body: renderFireLoop(c.sampleRate) } : renderBlast(kind, c.sampleRate); BAKED.set(key, d); }
  const mk = (data, sr) => { const x = c.createBuffer(1, data.length, sr || c.sampleRate); const ch = x.getChannelData(0); if (ch && ch.set) ch.set(data); return x; };
  b = { body: mk(d.body), tail: d.tail ? mk(d.tail, d.tsr) : null };
  m.set(kind, b);
  return b;
}
export function prewarmBlasts(c, kinds) { for (const k of kinds) bufs(c, k); }
export const bakedBlast = (sr, kind) => { const key = `${sr}|${kind}`; let d = BAKED.get(key); if (!d) { d = renderBlast(kind, sr); BAKED.set(key, d); } return d; };

// ---------- playing ----------
// Far, a blast loses its top much faster than a shot (a low thud) and arrives late: distance × SOUND_S, capped.
export const BLAST_DIST = { LP_HALF: 4, LP_MIN: 450, SOUND_S: 0.005, SOUND_MAX: 0.25, DUCK_R: 7 };
export function blastPlace(sp) {
  const d = sp.dist || 0;
  const lp = Math.min(sp.lp, clamp(20000 * Math.pow(0.5, Math.max(0, d - 3) / BLAST_DIST.LP_HALF), BLAST_DIST.LP_MIN, 20000));
  return { ...sp, lp, delay: Math.min(BLAST_DIST.SOUND_MAX, d * BLAST_DIST.SOUND_S), gain: sp.gain * (1 + 0.15 * Math.min(1, d / 20)) }; // the low end carries: it falls off a little slower
}
// A blast at t: cue.blast = { kind, n (merged), extra: [kind, dt], glass }; sp: spatial(). Returns its length (s).
export function playBlast(c, t, B, sp = place({})) {
  const K = BLASTS[B.kind] || BLASTS.frag;
  const s2 = blastPlace(sp);
  const n = Math.max(1, B.n || 1);
  const out = spatialOut(c, s2, { gain: BLAST_TRIM * GUNVOL.v * groupGain("weapons.blasts") * Math.min(1.6, 1 + 0.25 * (n - 1)) * (B.gain ?? 1), raw: true });
  const tb = t + s2.delay, b = bufs(c, B.kind);
  const s = c.createBufferSource(); s.buffer = b.body; s.connect(out); s.start(tb);
  if (b.tail) { const g = c.createGain(); g.gain.value = (sp.tail ?? 1) * Math.min(1.5, 1 + 0.2 * (n - 1)); const st = c.createBufferSource(); st.buffer = b.tail; st.connect(g); g.connect(out); st.start(tb + 0.01); }
  if (B.extra && BLASTS[B.extra[0]]) { const e = bufs(c, B.extra[0]); const g = c.createGain(); g.gain.value = 0.55; const x = c.createBufferSource(); x.buffer = e.body; x.playbackRate.value = 0.94; x.connect(g); g.connect(out); x.start(tb + B.extra[1]); }
  if ((B.glass || K.glass) && s2.dist < 16) { const gb = bufs(c, "glass"); const g = c.createGain(); g.gain.value = 0.7; const x = c.createBufferSource(); x.buffer = gb.body; x.connect(g); g.connect(out); x.start(tb + 0.06 + Math.random() * 0.08); }
  if (K.fire) {
    const fl = bufs(c, "fireloop"), g = c.createGain(), x = c.createBufferSource();
    g.gain.setValueAtTime(0.0001, tb + 0.3); g.gain.linearRampToValueAtTime(0.5, tb + 0.9); g.gain.setTargetAtTime(0.0001, tb + 2, FIRE_SECS / 4);
    x.buffer = fl.body; x.loop = true; x.connect(g); g.connect(out); x.start(tb + 0.3); x.stop(tb + 0.3 + FIRE_SECS + 1);
  }
  // close: the ears compress, everything else in the battle dips for a moment
  const bus = busOf(c);
  if (bus && BIG.has(B.kind) && s2.dist < BLAST_DIST.DUCK_R) bus.duckAt(tb, clamp(0.25 + 0.07 * s2.dist, 0.25, 0.7), 0.3 + 0.1 * K.size);
  return (K.len || 1.5) + (K.rumble ? K.rumble.len * 0.3 : 0);
}

// ---------- planning (ui/soundcues.js) ----------
// What lands where after a throw: the kind of blast or effect by throwable (sim/stealth.js THROWABLES fx / key), and
// the handling as it leaves the hand.
export const THROW_BLAST = { frag: "frag", pipebomb: "pipebomb", flashbang: "flash", molotov: "molotov", smokegren: "smoke", flare: "flare", firecracker: "firecracker", bottle: "glass" };
export const THROW_HAND = { frag: "pin", flashbang: "pin", smokegren: "pin", pipebomb: "fuse", molotov: "light", flare: "strike" };
export const THROW_CLATTER = new Set(["frag", "flashbang", "smokegren", "pipebomb"]);
// The flight is drawn over THROW_FLIGHT s (ui/isoview.js, ui/combat.js: 500 ms); the can rolls FUSE s before it goes.
export const THROW_FLIGHT = 0.5;
export const FUSE = { frag: 0.45, pipebomb: 0.3, flash: 0.25, smoke: 0.2, firecracker: 0.12 };
// A launcher's round in the air: a 40 mm lobbed (slow) or a rocket (fast), by tiles flown, capped.
export const flight = (kind, d) => (kind === "rocket" ? Math.min(0.5, 0.08 + d * 0.022) : Math.min(1.2, 0.3 + d * 0.035));
// Blast kind for a launcher's round landing: HE → gl40, smoke, flare (illumination), a rocket.
export const launchBlast = (item, rocket) => (rocket ? "rocket" : item === "smokegren" ? "smoke" : item === "flare" ? "flare" : "gl40");
// Merge one frame's blasts: the biggest kind leads, the count makes it louder, the runner-up a moment later.
const RANK = ["clatter", "glass", "flare", "smoke", "firecracker", "molotov", "cookoff", "flash", "secondary", "pipebomb", "frag", "gl40", "rocket", "vehicle"];
export function mergeBlasts(list) {
  if (list.length <= 1) return list;
  const sorted = [...list].sort((a, b) => RANK.indexOf(b.blast.kind) - RANK.indexOf(a.blast.kind) || (a.delay || 0) - (b.delay || 0));
  const lead = { ...sorted[0], blast: { ...sorted[0].blast, n: list.reduce((s, c) => s + (c.blast.n || 1), 0) } };
  const second = sorted[1];
  if (second && second.blast.kind !== "clatter") lead.blast.extra = [second.blast.kind, clamp((second.delay || 0) - (lead.delay || 0), 0.06, 0.4)];
  lead.blast.glass = list.some((c) => c.blast.glass);
  lead.delay = Math.min(...list.map((c) => c.delay || 0));
  return [lead];
}
// Glass near the blast: a car (or truck) or a window within 2 tiles of (x, y).
export function glassNear(b, x, y) {
  if (!b || !b.cells || !b.w) return false;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const cx = x + dx, cy = y + dy;
    if (cx < 0 || cy < 0 || cx >= b.w || cy >= (b.h || b.cells.length / b.w)) continue;
    const c = b.cells[cy * b.w + cx];
    if (c && (c.car || c.k === "car" || c.k === "truck" || c.k === "window")) return true;
  }
  return false;
}
export const LAB_BLASTS = Object.keys(BLASTS).filter((k) => k !== "clatter").map((k) => [k, BLASTS[k].label]);
export { GUN_TRIM };
