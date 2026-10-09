// The dead's voices, made on the spot with WebAudio (no audio files). ui/soundcues.js decides what is heard from the
// battle's effects and the units' changes (the hooks below are pure: no browser, the simulation never knows about
// sound, and no world dice are drawn); ui/audio.js plays the cues through its throttle and buses.
//
// Voices: formant synthesis. A glottal pulse (a PeriodicWave with a rough throat's harmonics; a sawtooth where there is
//   none) with jittered pitch (low-passed noise on the frequency), rasp (white noise amplitude-modulated by the pulse),
//   vocal fry (amplitude modulation at a subharmonic), a waveshaper for the throat's distortion, then 2–3 band-pass
//   formants sliding between vowel shapes, breath noise, and wet gurgle bubbles (short rising sine blips).
//   Each unit has a voice seed (voiceSeed: a hash of its id and the battle's tile, never the world's dice) that sets
//   its pitch, rasp, formant offsets, wetness, drawl and a limp, so one zombie keeps its voice and no two are the same;
//   each call also varies a little (its own small generator), so the same zombie never says the same thing twice.
// Kinds (voiceKind): the common dead (walker; the turned too), the armoured dead (soldier, riot: muffled, clanking),
//   the special dead (runner, brute, spitter, screamer, crawler), the Carrier and the worm swarm, the mid game's dead
//   (shepherd, boneback, climber, flinger, sower, nightmare, sleeper) and the bosses (wallbreaker, broodmother).
//   VOICE_SETS maps each kind's events (idle, aggro, attack, bite, hurt, death, step and its own: smash, bash, spit,
//   sizzle, shriek, strike, burst, worms, heave, fling, climb, wake) to recipes (RECIPES).
// The crowd (crowdMix, zombieCrowd): one shared bed for the battle, three looped buffers synthesised once per context
//   (a few moans, a dense murmur, shuffling feet) crossfaded by the count of the living dead, low-passed by their
//   distance. Individual voices pop out on top of it. A few nodes whatever the horde's size.
// The State Map (hordeAmbience, zombieMapAmbience): a horde you can see near a base or one of your teams is a distant,
//   wind-blown moaning that swells now and then (louder by size and nearness, more present at night); a known hive near
//   you is a low organic drone with a slow heartbeat (the Broodmother). hordeChorus: distant moans under the map sting.
// zRoute is the one place a voice meets the speakers: ui/gunsfx.js spatialOut (pan by the screen, level and highs by
//   distance, muffled out of sight, the room's reverb, the battle bus with its ducking and the deafened muffle), at the
//   zombie voice gain (ZOMBIE_VOICE_GAIN with its trims × the event's mixer group, ui/soundgroups.js). The crowd bed
//   goes through the zombie bus (the Crowd murmur group); the map layer through the ambience bus (Map hordes, Hive drone).
import { MIDDEAD } from "../sim/hiveconst.js";
import { spatial, spatialOut, isIndoor, place } from "./gunsfx.js";
import { groupGain, groupOf } from "./soundgroups.js"; // the mixer: each event's group (Moans, Attacks, Shrieks, Special) as it is played // the battle's sound space (shared with the guns, the blows and the steps)

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clamp01 = (v) => clamp(v, 0, 1);
const r2 = (v) => Math.round(v * 100) / 100;

// ---------- seeds ----------
export function hash32(n) {
  let x = (n >>> 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}
// A unit's voice seed: its id (and a salt: the battle's tile), never the world's or the battle's dice.
export const voiceSeed = (id, salt = 0) => hash32(Math.imul((Number(id) | 0) + 1, 0x9e3779b1) ^ Math.imul((Number(salt) | 0) + 7, 0x85ebca6b));
const battleSalt = (b) => (b && b.setup && Number.isFinite(b.setup.tile) ? b.setup.tile : 0);
export const unitSeed = (b, u) => voiceSeed(u.id, battleSalt(b));
// A small generator of its own (mulberry32).
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// What a seed makes of a voice.
export function voiceParams(seed) {
  const r = mulberry(seed >>> 0);
  return {
    seed: seed >>> 0,
    pitch: r2(0.8 + r() * 0.45),   // × the kind's pitch
    rasp: r2(0.25 + r() * 0.75),   // how torn the throat is
    f1: r2(0.86 + r() * 0.28), f2: r2(0.86 + r() * 0.28), f3: r2(0.9 + r() * 0.2), // × the formants: the mouth's shape
    gurgle: r2(r()),               // wetness
    drawl: r2(0.82 + r() * 0.4),   // × how long it takes over things
    jitter: r2(0.02 + r() * 0.05), // × f0: how unsteady the pitch is
    drive: r2(0.6 + r() * 0.8),    // × the throat's distortion
    vowel: Math.floor(r() * 4),    // the moan it favours
    limp: r() < 0.45,              // drags a foot
  };
}

// ---------- kinds ----------
// Per kind: base pitch (f0, Hz), formant shift, rasp, drive, wetness, fry; slow: × durations; giant: bosses; muffle:
// a helmet or a riot visor (low-pass Hz).
export const PROFILE = { // sub: a second, detuned pulse an octave down (diplophonia: a torn, inharmonic throat)
  walker:      { f0: 62, shift: 0.88, rasp: 0.85, drive: 3, wet: 0.6, fry: 0.45, sub: 0.35 },
  armoured:    { f0: 60, shift: 0.85, rasp: 0.8, drive: 3, wet: 0.3, fry: 0.45, sub: 0.3, muffle: 1400 },
  runner:      { f0: 150, shift: 1.1, rasp: 0.85, drive: 3.4, wet: 0.2, fry: 0.15, sub: 0.2 },
  brute:       { f0: 42, shift: 0.7, rasp: 0.9, drive: 4.5, wet: 0.4, fry: 0.65, sub: 0.45, slow: 1.2 },
  spitter:     { f0: 72, shift: 0.95, rasp: 0.7, drive: 2.6, wet: 1, fry: 0.4, sub: 0.3 },
  screamer:    { f0: 160, shift: 1.2, rasp: 0.7, drive: 3.4, wet: 0.2, fry: 0.15, sub: 0.25 },
  crawler:     { f0: 85, shift: 0.95, rasp: 1, drive: 2.6, wet: 0.4, fry: 0.4, sub: 0.3 },
  carrier:     { f0: 50, shift: 0.78, rasp: 0.6, drive: 2.2, wet: 1, fry: 0.5, sub: 0.4, slow: 1.15 },
  swarm:       { f0: 200, shift: 1.3, rasp: 0.3, drive: 1, wet: 1, fry: 0, sub: 0 },
  shepherd:    { f0: 80, shift: 0.86, rasp: 0.45, drive: 1.8, wet: 0.3, fry: 0.2, sub: 0.35 },
  boneback:    { f0: 55, shift: 0.8, rasp: 0.75, drive: 3, wet: 0.3, fry: 0.5, sub: 0.4 },
  climber:     { f0: 110, shift: 1.05, rasp: 0.9, drive: 2.6, wet: 0.3, fry: 0.3, sub: 0.25 },
  flinger:     { f0: 58, shift: 0.82, rasp: 0.75, drive: 3, wet: 0.8, fry: 0.5, sub: 0.4 },
  sower:       { f0: 60, shift: 0.88, rasp: 0.85, drive: 2.2, wet: 0.9, fry: 0.65, sub: 0.35 },
  nightmare:   { f0: 80, shift: 0.95, rasp: 0.6, drive: 2.4, wet: 0.2, fry: 0.3, sub: 0.3 },
  sleeper:     { f0: 66, shift: 0.9, rasp: 0.8, drive: 2.4, wet: 0.7, fry: 0.4, sub: 0.3 },
  wallbreaker: { f0: 34, shift: 0.6, rasp: 1, drive: 5.5, wet: 0.4, fry: 0.8, sub: 0.5, slow: 1.35, giant: true },
  broodmother: { f0: 30, shift: 0.56, rasp: 0.85, drive: 4.5, wet: 1, fry: 0.7, sub: 0.5, slow: 1.4, giant: true },
};
// The voice set a unit uses.
export function voiceKind(u) {
  if (!u) return "walker";
  if (u.boss) return u.boss === "broodmother" ? "broodmother" : "wallbreaker";
  const z = u.ztype;
  if (z === "soldier" || z === "riot") return "armoured";
  return z && PROFILE[z] ? z : "walker";
}

// ---------- building blocks ----------
const VW = { // formants (Hz) of the vowel shapes the mouths slide between
  uh: [520, 1190, 2390], aa: [730, 1090, 2440], oh: [570, 840, 2410], oo: [300, 870, 2240], ae: [660, 1720, 2410],
  ee: [270, 2290, 3010], eh: [530, 1840, 2480], er: [490, 1350, 1690], ah: [700, 1220, 2600],
};
const MOAN_PATHS = [["uh", "aa", "oh"], ["oh", "uh", "er"], ["er", "aa", "uh"], ["uh", "oh", "uh"]]; // dark, open mouths: no clean "ooh"

const NOISE = new WeakMap(); // context -> { white, brown } (seeded, so renders repeat)
function noiseBufs(c) {
  let b = NOISE.get(c);
  if (b) return b;
  const len = Math.max(1, Math.floor(c.sampleRate * 2));
  const white = c.createBuffer(1, len, c.sampleRate), brown = c.createBuffer(1, len, c.sampleRate);
  const w = white.getChannelData(0), br = brown.getChannelData(0), r = mulberry(0x5eed);
  let last = 0;
  for (let i = 0; i < len; i++) { w[i] = r() * 2 - 1; last = (last + 0.02 * (r() * 2 - 1)) / 1.02; br[i] = last * 3.5; }
  b = { white, brown };
  NOISE.set(c, b);
  return b;
}
function noise(c, kind, t, dur, dest, rnd, rate = 1) {
  const s = c.createBufferSource();
  s.buffer = noiseBufs(c)[kind];
  s.loop = true;
  s.playbackRate.value = rate;
  s.connect(dest);
  s.start(t, rnd() * Math.max(0, (s.buffer.duration || 1) - 0.3));
  s.stop(t + dur + 0.05);
  return s;
}
const WAVES = new WeakMap();
function glottal(c, o) {
  if (!c.createPeriodicWave || !o.setPeriodicWave) { o.type = "sawtooth"; return; }
  let w = WAVES.get(c);
  if (!w) {
    const n = 40, re = new Float32Array(n), im = new Float32Array(n);
    for (let k = 1; k < n; k++) im[k] = Math.pow(k, -1.2) * (k % 2 ? 1 : 0.8);
    w = c.createPeriodicWave(re, im);
    WAVES.set(c, w);
  }
  o.setPeriodicWave(w);
}
function osc(c, type, f, t, dur, dest) {
  const o = c.createOscillator();
  if (type === "glottal") glottal(c, o); else o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (dest) o.connect(dest);
  o.start(t);
  o.stop(t + dur + 0.05);
  return o;
}
function gainN(c, v, dest) {
  const g = c.createGain();
  g.gain.value = v;
  if (dest) g.connect(dest);
  return g;
}
// An envelope into dest: up to peak in a, held, down over d.
function envG(c, dest, t, peak, a, hold, d) {
  const g = c.createGain(), p = Math.max(0.0002, peak), A = Math.max(0.001, a);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(p, t + A);
  if (hold > 0) g.gain.setValueAtTime(p, t + A + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + A + Math.max(0, hold) + Math.max(0.005, d));
  g.connect(dest);
  return g;
}
function biq(c, type, f, q, dest, t) {
  const n = c.createBiquadFilter();
  n.type = type;
  if (t != null) n.frequency.setValueAtTime(f, t); else n.frequency.value = f;
  if (q != null) n.Q.value = q;
  if (dest) n.connect(dest);
  return n;
}
function lfo(c, rate, depth, param, t, dur, type = "sine") {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.value = rate;
  const g = c.createGain();
  g.gain.value = depth;
  o.connect(g); g.connect(param);
  o.start(t); o.stop(t + dur + 0.05);
  return o;
}
// A gain into dest whose level wobbles at rate (depth 0–1).
function am(c, dest, rate, depth, t, dur, type = "sine") {
  const g = gainN(c, 1 - depth * 0.5, dest);
  lfo(c, rate, depth * 0.5, g.gain, t, dur, type);
  return g;
}
const CURVES = new Map();
function curveFor(k) {
  k = Math.round(clamp(k, 0.5, 14) * 4) / 4;
  let cv = CURVES.get(k);
  if (!cv) {
    cv = new Float32Array(1024);
    const n = Math.tanh(k);
    for (let i = 0; i < 1024; i++) cv[i] = Math.tanh(k * (i / 511.5 - 1)) / n;
    CURVES.set(k, cv);
  }
  return cv;
}
// The throat's distortion (a tanh waveshaper; a plain gain where there is none).
function shaper(c, k, dest) {
  if (!c.createWaveShaper || !(k > 0.3)) return gainN(c, 1, dest);
  const s = c.createWaveShaper();
  s.curve = curveFor(k);
  s.oversample = "2x";
  s.connect(dest);
  return s;
}
// Band-passed noise sweeping from f0 to f1.
function sweep(c, out, t, dur, f0, f1, q, peak, a, hold, d, rnd, kind = "white") {
  const f = biq(c, "bandpass", f0, q, envG(c, out, t, peak, a, hold, d), t);
  f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  noise(c, kind, t, dur, f, rnd);
}
// Short ticks of noise (bone, gristle, claws, splinters).
function clicks(c, out, t, n, span, peak, rnd, lo, hi, q = 2) {
  for (let i = 0; i < n; i++) {
    const tt = t + rnd() * span;
    noise(c, "white", tt, 0.03, biq(c, "bandpass", lo + rnd() * (hi - lo), q, envG(c, out, tt, peak * (0.4 + rnd() * 0.6), 0.001, 0, 0.008 + rnd() * 0.02)), rnd);
  }
}
// Wet gurgle bubbles: short sine blips rising in pitch.
function bubbles(c, out, t, span, n, peak, rnd, lo = 200, hi = 750) {
  for (let i = 0; i < n; i++) {
    const tt = t + rnd() * span, f = lo + rnd() * (hi - lo);
    const o = osc(c, "sine", f, tt, 0.08, envG(c, out, tt, peak * (0.4 + rnd() * 0.6), 0.003, 0, 0.03 + rnd() * 0.04));
    o.frequency.exponentialRampToValueAtTime(f * (1.4 + rnd() * 0.8), tt + 0.05);
  }
}
// A low thud (a body, a foot, a blow).
function thud(c, out, t, f, peak, d, rnd) {
  osc(c, "sine", f, t, d + 0.05, envG(c, out, t, peak, 0.003, 0, d)).frequency.exponentialRampToValueAtTime(f * 0.45, t + d);
  noise(c, "brown", t, d, biq(c, "lowpass", f * 4, 0.7, envG(c, out, t, peak * 0.8, 0.003, 0, d * 0.8)), rnd);
}
// Metal: inharmonic partials, the high ones dying first.
function metal(c, out, t, base, peak, d, rnd) {
  for (const [k, a] of [[1, 1], [2.53, 0.6], [4.11, 0.4], [6.7, 0.25], [9.3, 0.15]]) {
    const f = base * k * (0.96 + rnd() * 0.08);
    osc(c, "sine", f, t, d, envG(c, out, t, peak * a, 0.001, 0, d / Math.sqrt(k)));
  }
}

// One voice. s: { f0, dur, contour [[fraction, × f0]...], vowels [[F1, F2, F3]...], form [× F1, × F2, × F3], shift (× all
// formants), q [Q1, Q2, Q3], fw [formant weights], lp (low-pass Hz), breathHz, sub (a detuned pulse an octave
// down), nform (2 or 3), rasp, fry (0–1), fryHz, jitter (× f0), vib [Hz, × f0], drive, a, hold, rel
// (the envelope), peak, breath (× peak), ring [carrier Hz, mix, carrier Hz at the end],
// ringWob [× a second carrier's detune, drift × the carrier] }.
function vocal(c, out, t, s, rnd) {
  const dur = Math.max(0.05, s.dur), f0 = clamp(s.f0, 25, 2000);
  const o = osc(c, "glottal", f0, t, dur + 0.05);
  const fq = o.frequency;
  for (const [fr, m] of s.contour || [[1, 0.85]]) fq.exponentialRampToValueAtTime(clamp(f0 * m, 20, 3000), t + dur * clamp(fr, 0.01, 1));
  if (s.jitter) noise(c, "brown", t, dur + 0.05, gainN(c, f0 * s.jitter, fq), rnd, 0.3 + rnd() * 0.3);
  if (s.vib) lfo(c, s.vib[0], f0 * s.vib[1], fq, t, dur);
  let voiced = o;
  if (s.sub > 0.02) { // a second pulse a detuned octave down: the throat torn in two (beating, inharmonic)
    const k = 0.5 * (1.008 + rnd() * 0.012);
    const o2 = osc(c, "glottal", f0 * k, t, dur + 0.05);
    for (const [fr, m] of s.contour || [[1, 0.85]]) o2.frequency.exponentialRampToValueAtTime(clamp(f0 * m * k, 20, 3000), t + dur * clamp(fr, 0.01, 1));
    const mix = gainN(c, 1);
    o.connect(mix);
    o2.connect(gainN(c, s.sub, mix));
    voiced = mix;
  }
  const src = voiced;
  if (s.fry > 0.02) { // vocal fry: the level wobbling at a subharmonic (or a rattle's rate)
    const g = gainN(c, 1 - s.fry * 0.5);
    src.connect(g);
    lfo(c, s.fryHz || f0 * 0.5, s.fry * 0.5, g.gain, t, dur, "triangle");
    voiced = g;
  }
  const sum = gainN(c, 1);
  voiced.connect(sum);
  if (s.rasp > 0.02) { // rasp: white noise amplitude-modulated by the pulse
    const rg = gainN(c, 0, sum);
    voiced.connect(gainN(c, s.rasp * 1.2, rg.gain));
    noise(c, "white", t, dur + 0.05, rg, rnd);
  }
  let post = out;
  if (s.ring) { // ring modulation: an inhuman, metallic edge
    post = gainN(c, 1);
    post.connect(gainN(c, 1 - s.ring[1], out));
    const rm = gainN(c, 0, gainN(c, s.ring[1] * 1.4, out));
    post.connect(rm);
    const car = osc(c, "sine", s.ring[0], t, dur + 0.05, rm.gain);
    if (s.ring[2]) car.frequency.exponentialRampToValueAtTime(s.ring[2], t + dur);
    if (s.ringWob) { // a less clean ring: the carrier drifts (low-passed noise) and a second one, detuned, beats against it
      noise(c, "brown", t, dur + 0.05, gainN(c, s.ring[0] * s.ringWob[1], car.frequency), rnd, 0.6 + rnd() * 0.4);
      const car2 = osc(c, "sine", s.ring[0] * s.ringWob[0], t, dur + 0.05, gainN(c, 0.6, rm.gain));
      if (s.ring[2]) car2.frequency.exponentialRampToValueAtTime(s.ring[2] * s.ringWob[0], t + dur);
    }
  }
  const a = s.a ?? dur * 0.2, hold = s.hold ?? dur * 0.3, rel = s.rel ?? dur * 0.5;
  const dark = s.lp ? biq(c, "lowpass", s.lp, 0.6, post) : post; // a dark throat: the highs rolled off
  const env = envG(c, dark, t, s.peak, a, hold, rel);
  const bankIn = gainN(c, 1);
  sum.connect(shaper(c, s.drive || 0, bankIn));
  const V = s.vowels, F = s.form || [1, 1, 1], sh = s.shift || 1, Q = s.q || [4.5, 5.5, 6.5], W = s.fw || [1, 0.55, 0.3];
  for (let k = 0; k < (s.nform || 3); k++) {
    const bp = biq(c, "bandpass", clamp(V[0][k] * F[k] * sh, 60, 9000), Q[k], gainN(c, W[k] * Math.sqrt(Q[k]) / 2.2, env), t);
    bankIn.connect(bp);
    for (let i = 1; i < V.length; i++) bp.frequency.linearRampToValueAtTime(clamp(V[i][k] * F[k] * sh, 60, 9000), t + dur * i / (V.length - 1));
  }
  if (s.breath) noise(c, "white", t, dur, biq(c, "bandpass", (s.breathHz || 1600) * sh, 0.9, envG(c, dark, t, s.peak * s.breath, a, hold, rel)), rnd);
  return o;
}

// ---------- recipes ----------
// X: { c, t, vp (voiceParams), rnd, P (PROFILE), g (gain), p (pitch: the call's × the seed's), o (the cue's options) }.
function say(X, out, s) {
  const { vp, P } = X;
  if (P.muffle) out = biq(X.c, "lowpass", P.muffle, 0.7, out);
  return vocal(X.c, out, X.t + (s.at || 0), {
    form: [vp.f1, vp.f2, vp.f3], shift: P.shift, jitter: vp.jitter, fry: P.fry, sub: P.sub, ...s,
    vowels: s.vowels.map((k) => (typeof k === "string" ? VW[k] : k)),
    rasp: (s.rasp ?? P.rasp) * (0.6 + vp.rasp * 0.6), drive: (s.drive ?? P.drive) * vp.drive,
    peak: s.peak * X.g,
  }, X.rnd);
}
const stepsOf = (X, max) => clamp(Math.round(X.o.steps || 2), 1, max);
const pick = (X, list) => list[Math.floor(X.rnd() * list.length) % list.length];
function slump(X, out, at) {
  const { c, rnd, g, P } = X, big = P.giant ? 1.3 : 1;
  thud(c, out, at, 75 / big, 0.5 * g * big, 0.22 * big, rnd);
  noise(c, "brown", at + 0.03, 0.2, biq(c, "lowpass", 900, 0.7, envG(c, out, at + 0.03, 0.22 * g, 0.01, 0.03, 0.15)), rnd);
}
function humanScream(c, out, t, rnd, g) {
  const f0 = 300 + rnd() * 180, dur = 0.7 + rnd() * 0.35;
  vocal(c, out, t, { f0, dur, contour: [[0.12, 1.3], [0.55, 1.2], [1, 0.72]], vowels: [VW.aa, VW.ah, VW.ae], shift: 1.05 + rnd() * 0.1,
    rasp: 0.25, drive: 1.5, jitter: 0.01, vib: [5.5 + rnd(), 0.025], a: 0.04, hold: dur * 0.4, rel: dur * 0.55, peak: 0.5 * g, breath: 0.15 }, rnd);
}

// The screamer's shriek, per unit (its seed) and per take (rnd): the in-breath, the first call (1.6–2.2 s, cracking
// partway, a ragged tail), a pause (0.4–0.8 s) and a second call (lower, cracked, 60–80% as long), which for some
// screamers breaks into a stuttering sob-shriek. Times in s from the start; total: when the last sound has died away.
export const SCREECH = { DUR: [1.6, 2.2], GAP: [0.4, 0.8], SECOND: [0.6, 0.8], SOB: 0.4, TAIL: 0.4 };
export function screechPlan(seed, rnd = Math.random) {
  const U = mulberry(hash32((seed >>> 0) ^ 0x5c4ea3)); // the unit's own: the same screamer always shrieks its way
  const S = SCREECH;
  const p = {
    f: 0.85 + U() * 0.35, ring: 0.3 + U() * 0.18, crack: 0.35 + U() * 0.25, vow: Math.floor(U() * 3), sob: U() < S.SOB,
    rise: 1.4 + U() * 0.45, lower: 0.82 + U() * 0.08, sobHz: 6 + U() * 3, gap: S.GAP[0] + U() * (S.GAP[1] - S.GAP[0]),
    second: S.SECOND[0] + U() * (S.SECOND[1] - S.SECOND[0]), base: S.DUR[0] + U() * (S.DUR[1] - S.DUR[0]), pull: 0.18 + U() * 0.06,
  };
  p.dur = clamp(p.base * (0.95 + rnd() * 0.1), S.DUR[0], S.DUR[1]);
  p.at = p.pull + 0.24;
  p.at2 = p.at + p.dur + S.TAIL * 0.5 + p.gap; // after the first call's tail has frayed
  p.dur2 = p.dur * p.second;
  p.total = p.at2 + p.dur2 + S.TAIL;
  return p;
}
const SCREECH_VOWELS = [["aa", "ae", "ee", "ae", "aa"], ["ae", "ee", "eh", "ee", "ah"], ["ah", "ae", "ee", "aa", "eh"]];
// One call of the shriek at X.t + at: raw (a hard waveshaper, noise in the source, strained fry), a crack where the voice
// breaks, an unstable detuned ring, a lower body, grit, and a ragged tail; sob: gated into a stuttering sob-shriek.
function screamCall(X, out, at, dur, f0, S, k, sob) {
  const { c, t, rnd, g } = X;
  const T = t + at, cr = clamp(S.crack + (rnd() - 0.5) * 0.06, 0.3, 0.65), R = S.rise;
  const dest = sob ? am(c, out, S.sobHz, 1, T, dur, "square") : out;
  const contour = sob
    ? [[0.1, R], [0.25, R * 0.8], [0.4, R * 1.05], [0.55, R * 0.75], [0.7, R], [1, 0.62]]
    : [[0.1, R], [cr, R * 1.1], [cr + 0.035, R * 0.6], [cr + 0.12, R * 1.15], [0.8, R * 0.95], [1, 0.68]];
  const vowels = SCREECH_VOWELS[S.vow];
  say(X, dest, { at, f0, dur, contour, vowels, shift: 1.25, rasp: 1.7, drive: 11, jitter: 0.1, vib: [8 + rnd() * 3, 0.05], sub: 0.45,
    fry: 0.45, fryHz: 70 + rnd() * 40, a: 0.03, hold: dur * 0.55, rel: dur * 0.42, peak: 0.52 * k, breath: 0.55,
    ring: [f0 * S.ring + 97, 0.55, f0 * S.ring * 0.55 + 50], ringWob: [1.017 + rnd() * 0.01, 0.04] });
  say(X, dest, { at, f0: f0 * 0.5, dur, contour, vowels: ["aa", "aa", "ah"], drive: 7, sub: 0.3, fry: 0.6, fryHz: 45, a: 0.05, hold: dur * 0.5, rel: dur * 0.45, peak: 0.27 * k });
  noise(c, "white", T, dur, biq(c, "bandpass", 3200, 1.5, am(c, envG(c, dest, T, 0.17 * g * k, 0.06, dur * 0.45, dur * 0.45), 30 + rnd() * 20, 0.8, T, dur, "square")), rnd); // grit
  if (!sob) noise(c, "white", T + dur * cr, 0.08, biq(c, "bandpass", 1900, 1.2, envG(c, out, T + dur * cr, 0.2 * g * k, 0.003, 0.02, 0.05)), rnd); // the voice breaking
  const tail = T + dur * 0.92; // the ragged tail: breath rattling down
  sweep(c, out, tail, SCREECH.TAIL, 2600, 800, 2, 0.16 * g * k, 0.03, 0.1, SCREECH.TAIL - 0.13, rnd);
  noise(c, "white", tail, SCREECH.TAIL, biq(c, "bandpass", 1300, 1.5, am(c, envG(c, out, tail, 0.12 * g * k, 0.02, 0.1, SCREECH.TAIL - 0.12), 12 + rnd() * 5, 1, tail, SCREECH.TAIL, "square")), rnd);
}

// Peaks of the voices that are compared (a snarl out of a silence near the aggro, both well over a moan), and the beat
// of silence before an aggro.
export const LEVELS = { moan: 0.72, bark: 1.05, aggro: 1.1, aggroWait: 0.5 };

export const RECIPES = {
  silent() {},
  // Moans and gurgles: the dead at rest.
  moan(X, out) {
    const { vp, rnd, P } = X;
    const dur = (1.1 + rnd() * 0.7) * vp.drawl * (P.slow || 1);
    const path = MOAN_PATHS[(vp.vowel + (rnd() < 0.3 ? 1 : 0)) % MOAN_PATHS.length];
    // Broken up by a slow, irregular tremor (no steady pitch, no clean vowel): a throat that no longer works.
    const shake = am(X.c, out, 2.3 + rnd() * 2.6, 0.55, X.t, dur, rnd() < 0.5 ? "triangle" : "sine");
    say(X, shake, { f0: P.f0 * X.p * (0.9 + rnd() * 0.18), dur, contour: [[0.25, 1.04 + rnd() * 0.1], [0.6, 0.92 + rnd() * 0.1], [1, 0.66 + rnd() * 0.1]], vowels: path,
      rasp: Math.min(1.3, P.rasp * 1.35), fw: [1, 0.3, 0.08], lp: 950, breathHz: 650, a: dur * 0.3, hold: dur * 0.2, rel: dur * 0.5, peak: LEVELS.moan, breath: 0.5 });
    if (rnd() < 0.2 + P.wet * vp.gurgle) bubbles(X.c, out, X.t + dur * 0.4, dur * 0.6, 2 + Math.floor(rnd() * 4), 0.07 * X.g, rnd);
  },
  wheeze(X, out) { // ragged breathing up close: rattling breaths in and out, never quite in time
    const { c, t, rnd, g } = X, n = 3 + Math.floor(rnd() * 3);
    let at = t;
    for (let i = 0; i < n; i++) {
      const inb = i % 2 === 0, d = (inb ? 0.35 : 0.5) + rnd() * 0.3;
      const f = biq(c, "bandpass", inb ? 1100 : 700, 2.5, am(c, envG(c, out, at, (inb ? 0.5 : 0.65) * g, d * 0.4, d * 0.2, d * 0.4), 22 + rnd() * 18, 0.9, at, d, "square"), at);
      f.frequency.exponentialRampToValueAtTime(inb ? 1600 : 450, at + d);
      noise(c, "white", at, d, f, rnd);
      if (!inb && rnd() < 0.5) bubbles(c, out, at + d * 0.3, d * 0.6, 3, 0.07 * g, rnd, 150, 400);
      at += d + 0.08 + rnd() * 0.35; // irregular: the gaps are never the same
    }
  },
  gurgle(X, out) {
    const { c, t, vp, rnd, P } = X, dur = (0.6 + rnd() * 0.4) * vp.drawl;
    say(X, out, { f0: P.f0 * X.p * 0.9, dur, contour: [[1, 0.8]], vowels: ["oo", "uh"], fry: 0.6, fryHz: 9 + rnd() * 8, rasp: 1, fw: [1, 0.4, 0.12], lp: 1100, a: 0.08, hold: dur * 0.3, rel: dur * 0.6, peak: 0.5, breath: 0.1, breathHz: 700 });
    bubbles(c, out, t + 0.05, dur, 5 + Math.floor(rnd() * 6), 0.11 * X.g, rnd, 150, 520);
    noise(c, "brown", t, dur, biq(c, "lowpass", 380, 1, am(c, envG(c, out, t, 0.3 * X.g, 0.05, dur * 0.4, dur * 0.5), 6 + rnd() * 6, 0.8, t, dur)), rnd);
  },
  rumble(X, out) { // a big one breathing: a low growl through the chest
    const { c, t, rnd, P } = X, dur = (1.4 + rnd() * 0.6) * (P.slow || 1);
    say(X, out, { f0: P.f0 * X.p * 0.95, dur, contour: [[0.5, 1.05], [1, 0.85]], vowels: ["oh", "uh", "oh"], fry: 0.85, rasp: 0.9, fw: [1, 0.4, 0.12], lp: 1000, a: dur * 0.3, hold: dur * 0.3, rel: dur * 0.4, peak: 0.7, breath: 0.2, breathHz: 600 });
    noise(c, "brown", t, dur, biq(c, "lowpass", 160, 0.8, envG(c, out, t, 0.3 * X.g, dur * 0.3, dur * 0.3, dur * 0.4)), rnd);
  },
  // Noticing someone, lunging, biting, hurting, dying.
  spot(X, out) { // seeing someone: a quick breath in, a beat of silence, then a sudden snarling shriek
    const { c, t, rnd, P, g } = X;
    sweep(c, out, t, 0.14, 600, 1800, 2, 0.1 * g, 0.12, 0, 0.02, rnd);
    const at = LEVELS.aggroWait + rnd() * 0.15, f0 = P.f0 * X.p * 2.6, dur = 0.5 + rnd() * 0.2;
    say(X, out, { at, f0, dur, contour: [[0.08, 1.5], [0.4, 1.3], [1, 0.62]], vowels: ["ae", "aa", "uh"], fry: 0.5, rasp: 1.3, drive: P.drive * 2.4,
      a: 0.004, hold: dur * 0.2, rel: dur * 0.75, peak: LEVELS.aggro, breath: 0.5, ring: [f0 * 0.71 + 40, 0.25] });
    say(X, out, { at, f0: f0 * 0.5, dur, contour: [[0.1, 1.4], [1, 0.6]], vowels: ["aa", "uh"], fry: 0.8, drive: P.drive * 2, a: 0.004, hold: dur * 0.2, rel: dur * 0.75, peak: 0.48 });
    noise(c, "brown", t + at, 0.15, biq(c, "lowpass", 300, 0.8, envG(c, out, t + at, 0.45 * g, 0.002, 0.02, 0.12)), rnd); // the hit: a body lurching
  },
  bark(X, out) { // out of a silence: a sudden snarl, no build-up, a short wet tail
    const { c, t, rnd, P, g } = X, dur = 0.28 + rnd() * 0.14, f0 = P.f0 * X.p * (2 + rnd() * 0.5);
    say(X, out, { f0, dur, contour: [[0.12, 1.45], [1, 0.58]], vowels: [pick(X, ["ae", "aa"]), "aa", "uh"], fry: 0.6, rasp: 1.4, drive: P.drive * 2.4,
      a: 0.003, hold: dur * 0.35, rel: dur * 0.6, peak: LEVELS.bark, breath: 0.5, ring: [f0 * 0.66 + 35, 0.2] });
    say(X, out, { f0: f0 * 0.5, dur, contour: [[0.12, 1.4], [1, 0.6]], vowels: ["aa", "uh"], fry: 0.8, drive: P.drive * 2, a: 0.003, hold: dur * 0.35, rel: dur * 0.6, peak: 0.6 });
    noise(c, "white", t, 0.14, biq(c, "bandpass", 1300, 1.2, envG(c, out, t, 0.45 * g, 0.002, 0.03, 0.1)), rnd); // the bark's hit
    const wt = t + dur * 0.8; // the wet tail
    bubbles(c, out, wt, 0.22, 4, 0.12 * g, rnd, 160, 500);
    noise(c, "brown", wt, 0.2, biq(c, "lowpass", 480, 1, envG(c, out, wt, 0.3 * g, 0.01, 0.03, 0.15)), rnd);
  },
  growl(X, out) {
    const { rnd, P } = X, dur = (0.65 + rnd() * 0.3) * (P.slow || 1);
    say(X, out, { f0: P.f0 * X.p * 1.1, dur, contour: [[0.25, 1.3], [1, 0.78]], vowels: ["uh", "aa", "aa"], fry: 0.7, rasp: Math.min(1.2, P.rasp * 1.4), drive: P.drive * 1.6, lp: 2400,
      a: 0.05, hold: dur * 0.35, rel: dur * 0.6, peak: 0.62, breath: 0.25 });
  },
  snarl(X, out) {
    const { c, t, rnd, P } = X, dur = 0.32 + rnd() * 0.12;
    say(X, out, { f0: P.f0 * X.p * 1.5, dur, contour: [[0.2, 1.35], [1, 0.7]], vowels: ["ae", "aa"], fry: 0.4, rasp: 1.1, drive: P.drive * 2, a: 0.015, hold: dur * 0.3, rel: dur * 0.65, peak: 0.6, breath: 0.4 });
    clicks(c, out, t + dur * 0.85, 2, 0.02, 0.25 * X.g, rnd, 2500, 3500, 3); // the teeth snapping shut
  },
  bite(X, out) { // a wet tearing crunch, a growl, and the victim's scream if they are living
    const { c, t, rnd, g } = X;
    noise(c, "white", t, 0.22, biq(c, "bandpass", 1500 + rnd() * 500, 1.3, am(c, envG(c, out, t, 0.55 * g, 0.003, 0.02, 0.16), 34 + rnd() * 10, 1, t, 0.25, "square")), rnd);
    clicks(c, out, t + 0.02, 3, 0.08, 0.35 * g, rnd, 1800, 4200, 2); // bone and gristle
    sweep(c, out, t + 0.05, 0.3, 500, 2600, 2, 0.32 * g, 0.03, 0.08, 0.2, rnd); // tearing
    noise(c, "brown", t + 0.06, 0.25, biq(c, "lowpass", 520, 1, envG(c, out, t + 0.06, 0.45 * g, 0.01, 0.04, 0.2)), rnd); // the squelch
    bubbles(c, out, t + 0.08, 0.3, 4 + Math.floor(rnd() * 3), 0.1 * g, rnd);
    say(X, out, { f0: X.P.f0 * X.p * 1.2, dur: 0.42, contour: [[1, 0.75]], vowels: ["uh", "aa"], fry: 0.5, drive: X.P.drive * 1.4, a: 0.02, hold: 0.1, rel: 0.3, peak: 0.35, breath: 0.2 });
    if (X.o.human) humanScream(c, out, t + 0.07, rnd, g * 0.75);
  },
  grunt(X, out) {
    const { rnd, P } = X, dur = 0.17 + rnd() * 0.1;
    say(X, out, { f0: P.f0 * X.p * 1.2, dur, contour: [[1, 0.72]], vowels: ["uh", "uh"], fry: 0.3, lp: 1800, a: 0.008, hold: dur * 0.25, rel: dur * 0.7, peak: 0.6, breath: 0.25, breathHz: 900 });
  },
  gruntClang(X, out) { // the armoured dead: a grunt and the round on the plate
    RECIPES.grunt(X, out);
    metal(X.c, out, X.t, 900 + X.rnd() * 500, 0.12 * X.g, 0.35, X.rnd);
  },
  rattle(X, out) { // the death rattle and the body slumping
    const { t, rnd, P } = X, dur = (0.9 + rnd() * 0.5) * (P.slow || 1);
    say(X, out, { f0: P.f0 * X.p, dur, contour: [[0.2, 1.08], [1, 0.5]], vowels: ["aa", "uh", "oo"], fry: 0.9, fryHz: 18 + rnd() * 10, rasp: 1.2, lp: 1400, a: 0.03, hold: dur * 0.2, rel: dur * 0.75, peak: 0.55, breath: 0.2, breathHz: 800 });
    slump(X, out, t + dur * 0.7);
    RECIPES.wheeze({ ...X, t: t + dur * 0.95, g: X.g * 0.5 }, out); // the last breaths
  },
  rise(X, out) { // a body getting up: a gasp, then the first growl
    RECIPES.gasp(X, out);
    RECIPES.growl({ ...X, t: X.t + 0.35 }, out);
  },
  // Feet.
  shuffle(X, out) { // a scuff and a heel; one in two of them drags a foot
    const { c, t, rnd, vp, g } = X, n = stepsOf(X, 4), gap = 0.36 * vp.drawl;
    for (let i = 0; i < n; i++) {
      const at = t + i * gap + rnd() * 0.04;
      if (vp.limp && i % 2 === 1) { sweep(c, out, at, 0.32, 650, 1150, 0.9, 0.12 * g, 0.06, 0.12, 0.16, rnd); continue; }
      noise(c, "white", at, 0.12, biq(c, "bandpass", 900 + rnd() * 500, 0.8, envG(c, out, at, 0.12 * g, 0.015, 0.02, 0.1)), rnd);
      noise(c, "brown", at, 0.1, biq(c, "lowpass", 280, 0.7, envG(c, out, at, 0.25 * g, 0.004, 0, 0.08)), rnd);
    }
  },
  slap(X, out) { // a runner's bare feet slapping
    const { c, t, rnd, g } = X, n = stepsOf(X, 6);
    for (let i = 0; i < n; i++) {
      const at = t + i * (0.12 + rnd() * 0.03);
      noise(c, "white", at, 0.04, biq(c, "highpass", 700, 0.7, envG(c, out, at, 0.26 * g, 0.001, 0, 0.025)), rnd);
      noise(c, "brown", at, 0.06, biq(c, "lowpass", 260, 0.7, envG(c, out, at, 0.22 * g, 0.002, 0, 0.05)), rnd);
    }
  },
  stomp(X, out) { // heavy feet
    const { c, t, rnd, g, P } = X, n = stepsOf(X, 3), big = P.giant ? 1.3 : 1;
    for (let i = 0; i < n; i++) {
      const at = t + i * 0.55 * big + rnd() * 0.05;
      thud(c, out, at, 55 / big, 0.6 * g * big, 0.3 * big, rnd);
      clicks(c, out, at + 0.02, 3, 0.15, 0.06 * g, rnd, 800, 2400, 2);
    }
  },
  clank(X, out) { // the armoured dead: shuffling in gear that rattles
    RECIPES.shuffle(X, out);
    const { c, t, rnd, g, vp } = X;
    for (let i = 0; i < stepsOf(X, 4); i++) {
      const at = t + i * 0.36 * vp.drawl + 0.03;
      metal(c, out, at, 1300 + rnd() * 900, 0.05 * g, 0.12, rnd);
      clicks(c, out, at, 2, 0.06, 0.08 * g, rnd, 3500, 6000, 4);
    }
  },
  bonestep(X, out) { // a Boneback: its plates clacking as it walks
    RECIPES.shuffle(X, out);
    const { c, t, rnd, g, vp } = X;
    for (let i = 0; i < stepsOf(X, 4); i++) clicks(c, out, t + i * 0.36 * vp.drawl + 0.02, 2, 0.06, 0.16 * g, rnd, 2100, 2900, 12);
  },
  scrabble(X, out) { // a Climber: claws on everything
    const { c, t, rnd, g } = X, n = stepsOf(X, 4);
    for (let i = 0; i < n; i++) {
      const at = t + i * 0.22;
      clicks(c, out, at, 5, 0.18, 0.15 * g, rnd, 2000, 4500, 3);
      sweep(c, out, at, 0.1, 1500, 2600, 3, 0.06 * g, 0.01, 0.03, 0.06, rnd);
    }
  },
  crawl(X, out) { // dragging itself through the grass
    const { c, t, rnd, g } = X;
    for (let i = 0; i < stepsOf(X, 3); i++) sweep(c, out, t + i * 0.5, 0.45, 300, 520, 1.2, 0.14 * g, 0.1, 0.15, 0.2, rnd, "brown");
    noise(c, "white", t, 0.6, biq(c, "highpass", 3500, 0.7, envG(c, out, t, 0.03 * g, 0.2, 0.2, 0.2)), rnd);
  },
  squirm(X, out) { // the worm swarm: a writhing wet mass
    const { c, t, rnd, g } = X, dur = 0.8 + rnd() * 0.4;
    const f = biq(c, "bandpass", 700, 4, envG(c, out, t, 0.28 * g, 0.12, dur * 0.5, dur * 0.4), t);
    for (let tt = t + 0.05; tt < t + dur; tt += 0.05 + rnd() * 0.06) f.frequency.linearRampToValueAtTime(300 + rnd() * 1400, tt);
    noise(c, "white", t, dur, f, rnd);
    noise(c, "brown", t, dur, biq(c, "lowpass", 420, 1, am(c, envG(c, out, t, 0.35 * g, 0.1, dur * 0.5, dur * 0.4), 9 + rnd() * 6, 1, t, dur)), rnd);
    bubbles(c, out, t, dur, 10 + Math.floor(rnd() * 6), 0.09 * g, rnd, 300, 1300);
  },
  squelch(X, out) { // the swarm biting: small, many, wet
    const { c, t, rnd, g } = X;
    noise(c, "white", t, 0.15, biq(c, "bandpass", 2200, 1.5, am(c, envG(c, out, t, 0.35 * g, 0.003, 0.02, 0.12), 50, 1, t, 0.2, "square")), rnd);
    bubbles(c, out, t, 0.25, 6, 0.12 * g, rnd, 400, 1400);
    RECIPES.squirm({ ...X, g: g * 0.5 }, out);
  },
  splat(X, out) { // a wet thing bursting under a blow
    const { c, t, rnd, g } = X;
    noise(c, "brown", t, 0.2, biq(c, "lowpass", 900, 0.8, envG(c, out, t, 0.5 * g, 0.002, 0.01, 0.14)), rnd);
    noise(c, "white", t, 0.1, biq(c, "bandpass", 1800, 1, envG(c, out, t, 0.2 * g, 0.002, 0, 0.07)), rnd);
    bubbles(c, out, t + 0.03, 0.4, 5, 0.09 * g, rnd);
  },
  // Runners.
  pant(X, out) {
    const { c, t, rnd, g } = X, n = 4 + Math.floor(rnd() * 4), gap = 0.15 + rnd() * 0.05;
    for (let i = 0; i < n; i++) {
      const at = t + i * gap;
      noise(c, "white", at, 0.12, biq(c, "bandpass", i % 2 ? 950 : 1350, 1.4, envG(c, out, at, (i % 2 ? 0.16 : 0.12) * g, 0.025, 0.01, 0.08)), rnd);
    }
    if (rnd() < 0.45) RECIPES.yelp({ ...X, t: t + n * gap }, out);
  },
  shriek(X, out) {
    const { rnd, P } = X, dur = 0.5 + rnd() * 0.2;
    say(X, out, { f0: P.f0 * X.p * 2.2, dur, contour: [[0.3, 1.45], [1, 0.85]], vowels: ["ae", "ee", "aa"], fry: 0.15, rasp: 1, drive: P.drive * 1.8, vib: [8, 0.03],
      a: 0.03, hold: dur * 0.35, rel: dur * 0.6, peak: 0.5, breath: 0.3 });
  },
  yelp(X, out) {
    const { rnd, P } = X, dur = 0.16 + rnd() * 0.08;
    say(X, out, { f0: P.f0 * X.p * 2, dur, contour: [[0.3, 1.3], [1, 0.8]], vowels: ["ae", "aa"], rasp: 0.9, drive: P.drive * 1.5, a: 0.01, hold: dur * 0.3, rel: dur * 0.6, peak: 0.45, breath: 0.3 });
  },
  // Brutes and the bosses.
  roar(X, out) {
    if (X.ev === "aggro" && !X.held) { // the breath in and the beat of silence before it
      sweep(X.c, out, X.t, 0.2, 400, 1200, 2, 0.12 * X.g, 0.18, 0, 0.02, X.rnd);
      return RECIPES.roar({ ...X, t: X.t + LEVELS.aggroWait + 0.1, g: X.g * 1.12, held: true }, out);
    }
    const { c, t, rnd, P, g } = X, dur = (1.2 + rnd() * 0.4) * (P.giant ? 1.3 : 1), f0 = P.f0 * X.p;
    say(X, out, { f0, dur, contour: [[0.25, 1.5], [0.6, 1.35], [1, 0.75]], vowels: ["uh", "aa", "aa", "oh"], fry: 0.85, rasp: 1.2, drive: P.drive * 1.4,
      a: 0.12, hold: dur * 0.45, rel: dur * 0.45, peak: 0.7, breath: 0.3 });
    osc(c, "sine", f0 * 0.5, t, dur, envG(c, out, t, 0.28 * g, 0.12, dur * 0.45, dur * 0.4)).frequency.exponentialRampToValueAtTime(f0 * 0.4, t + dur);
    noise(c, "brown", t, dur, biq(c, "lowpass", 200, 0.8, envG(c, out, t, 0.32 * g, 0.1, dur * 0.4, dur * 0.5)), rnd);
    if (P.wet > 0.6) bubbles(c, out, t + dur * 0.3, dur * 0.6, 8, 0.1 * g, rnd, 120, 420);
  },
  roarShort(X, out) {
    const { c, t, rnd, P, g } = X, dur = 0.5 + rnd() * 0.15;
    say(X, out, { f0: P.f0 * X.p * 1.3, dur, contour: [[0.3, 1.3], [1, 0.8]], vowels: ["aa", "aa", "uh"], fry: 0.8, rasp: 1.2, drive: P.drive * 1.5, a: 0.03, hold: dur * 0.3, rel: dur * 0.6, peak: 0.65, breath: 0.35 });
    sweep(c, out, t, 0.25, 400, 1300, 1.2, 0.18 * g, 0.06, 0.04, 0.15, rnd); // the swing
  },
  roarDeath(X, out) {
    const { t, rnd, P } = X, dur = (1.3 + rnd() * 0.4) * (P.slow || 1);
    say(X, out, { f0: P.f0 * X.p * 1.2, dur, contour: [[0.15, 1.3], [1, 0.45]], vowels: ["aa", "uh", "oo"], fry: 0.9, fryHz: 14 + rnd() * 6, rasp: 1.2, a: 0.04, hold: dur * 0.25, rel: dur * 0.7, peak: 0.65, breath: 0.25 });
    slump(X, out, t + dur * 0.75);
  },
  bellow(X, out) { // the Broodmother at rest: a huge, wet groan
    RECIPES.rumble(X, out);
    bubbles(X.c, out, X.t + 0.2, 1.6, 12, 0.12 * X.g, X.rnd, 90, 380);
  },
  smash(X, out) { // breaking through: wood splinters, metal crunches, a wall comes down
    const { c, t, rnd, g, P } = X, mat = X.o.mat || "wood";
    thud(c, out, t, P.giant ? 48 : 65, 0.6 * g, 0.25, rnd);
    if (mat !== "metal") { // wood
      clicks(c, out, t + 0.01, 16, 0.35, 0.3 * g, rnd, 1200, 4500, 2);
      const cr = osc(c, "sawtooth", 170 + rnd() * 40, t + 0.02, 0.32, biq(c, "bandpass", 850, 6, envG(c, out, t + 0.02, 0.14 * g, 0.02, 0.05, 0.25)));
      cr.frequency.exponentialRampToValueAtTime(110, t + 0.3);
      noise(c, "white", t, 0.16, biq(c, "bandpass", 2200, 1, envG(c, out, t, 0.4 * g, 0.002, 0.01, 0.14)), rnd);
    }
    if (mat === "metal" || mat === "wall") {
      metal(c, out, t, 300 + rnd() * 60, (mat === "metal" ? 0.15 : 0.08) * g, 0.8, rnd);
      noise(c, "white", t, 0.16, biq(c, "bandpass", 3000, 1.2, envG(c, out, t, 0.3 * g, 0.002, 0.01, 0.15)), rnd);
      clicks(c, out, t + 0.03, 6, 0.4, 0.12 * g, rnd, 3000, 6000, 4);
    }
    if (mat === "wall") {
      noise(c, "brown", t + 0.05, 0.9, biq(c, "lowpass", 280, 0.7, envG(c, out, t + 0.05, 0.55 * g, 0.02, 0.1, 0.8)), rnd);
      clicks(c, out, t + 0.25, 10, 0.8, 0.1 * g, rnd, 500, 2000, 2); // debris coming down
    }
    say(X, out, { at: 0.02, f0: P.f0 * X.p * 1.25, dur: 0.35, contour: [[1, 0.75]], vowels: ["aa", "uh"], fry: 0.6, rasp: 1, a: 0.01, hold: 0.08, rel: 0.25, peak: 0.4, breath: 0.2 });
  },
  bash(X, out) { // pounding on a door or a wall that holds
    const { c, t, rnd, g, P } = X, big = P.giant ? 1.5 : 1;
    thud(c, out, t, 90 / big, 0.55 * g * big, 0.14 * big, rnd);
    noise(c, "white", t, 0.1, biq(c, "bandpass", 420, 1.5, envG(c, out, t, 0.3 * g, 0.002, 0.01, 0.08)), rnd);
    if (X.o.mat === "metal") metal(c, out, t, 380 + rnd() * 80, 0.12 * g, 0.45, rnd);
  },
  // Spitters.
  spit(X, out) { // a hawking wet gather, then the spit
    const { c, t, rnd, g, P } = X;
    noise(c, "white", t, 0.45, biq(c, "bandpass", 400, 3, am(c, envG(c, out, t, 0.3 * g, 0.25, 0.1, 0.1), 16 + rnd() * 6, 0.9, t, 0.45), t), rnd)
      .playbackRate.value = 1;
    const gf = biq(c, "bandpass", 400, 3, envG(c, out, t, 0.22 * g, 0.25, 0.1, 0.1), t);
    gf.frequency.exponentialRampToValueAtTime(1500, t + 0.4);
    noise(c, "white", t, 0.45, gf, rnd);
    bubbles(c, out, t + 0.05, 0.38, 6, 0.1 * g, rnd, 180, 600);
    say(X, out, { f0: P.f0 * X.p * 0.8, dur: 0.38, contour: [[1, 1.15]], vowels: ["oo", "er"], fry: 0.6, fryHz: 12, rasp: 1, a: 0.1, hold: 0.15, rel: 0.12, peak: 0.25 });
    const at = t + 0.46; // "ptah"
    noise(c, "white", at, 0.06, biq(c, "highpass", 900, 0.7, envG(c, out, at, 0.55 * g, 0.001, 0, 0.04)), rnd);
    say(X, out, { at: 0.47, f0: P.f0 * X.p * 1.6, dur: 0.12, contour: [[1, 0.8]], vowels: ["aa", "ah"], rasp: 0.6, a: 0.005, hold: 0.03, rel: 0.08, peak: 0.25 });
    noise(c, "white", at + 0.01, 0.15, biq(c, "bandpass", 3000, 1, envG(c, out, at + 0.01, 0.22 * g, 0.004, 0.02, 0.12)), rnd); // the spray
  },
  sizzle(X, out) { // acid eating into something
    const { c, t, rnd, g } = X;
    noise(c, "white", t, 1, biq(c, "highpass", 2500, 0.7, envG(c, out, t, 0.18 * g, 0.02, 0.2, 0.7)), rnd);
    clicks(c, out, t, 22, 0.9, 0.14 * g, rnd, 3000, 7000, 3);
    noise(c, "white", t, 0.8, biq(c, "bandpass", 900, 2, envG(c, out, t, 0.08 * g, 0.05, 0.2, 0.5)), rnd);
  },
  // Screamers: the signature. A piercing, distorted shriek with a ring-modulated edge, heard from far off.
  whimper(X, out) {
    const { rnd, P } = X, dur = 0.6 + rnd() * 0.3;
    say(X, out, { f0: P.f0 * X.p * 1.3, dur, contour: [[0.5, 1.15], [1, 0.85]], vowels: ["ee", "uh"], rasp: 0.6, vib: [6, 0.05], a: 0.1, hold: dur * 0.3, rel: dur * 0.5, peak: 0.32, breath: 0.25 });
  },
  screech(X, out) {
    const { c, t, rnd, vp, P, g } = X;
    const S = screechPlan(vp.seed, rnd);
    const single = X.ev === "aggro"; // noticing you: the first call alone, shorter
    // The gasping in-breath: two ragged pulls.
    sweep(c, out, t, 0.16, 700, 2200, 2.5, 0.13 * g, 0.12, 0, 0.03, rnd);
    sweep(c, out, t + S.pull, 0.18, 900, 2800, 2.5, 0.2 * g, 0.15, 0, 0.03, rnd);
    const f0 = clamp(P.f0 * X.p * 3.4 * S.f, 380, 950);
    screamCall(X, out, S.at, single ? S.dur * 0.7 : S.dur, f0, S, 1, false);
    if (single) return;
    screamCall(X, out, S.at2 - 0, S.dur2, f0 * S.lower, S, 0.82, S.sob);
  },
  // Crawlers: barely there while hidden, then a hiss and a snap.
  lurk(X, out) {
    const { c, t, rnd, g } = X;
    RECIPES.crawl({ ...X, g: g * 0.5, o: { ...X.o, steps: 1 } }, out);
    noise(c, "white", t + 0.2, 0.7, biq(c, "bandpass", 3800, 1.2, envG(c, out, t + 0.2, (X.o.hidden ? 0.05 : 0.12) * g, 0.25, 0.1, 0.35)), rnd);
    if (!X.o.hidden) say(X, out, { at: 0.2, f0: X.P.f0 * X.p, dur: 0.6, contour: [[1, 0.85]], vowels: ["er", "uh"], rasp: 1, a: 0.2, hold: 0.1, rel: 0.3, peak: 0.25, breath: 0.4 });
  },
  hiss(X, out) {
    const { c, t, rnd, g } = X;
    noise(c, "white", t, 0.5, biq(c, "bandpass", 3600, 1, envG(c, out, t, 0.35 * g, 0.05, 0.15, 0.3)), rnd);
    say(X, out, { f0: X.P.f0 * X.p * 1.2, dur: 0.45, contour: [[1, 0.8]], vowels: ["ee", "er"], rasp: 1.2, a: 0.04, hold: 0.12, rel: 0.28, peak: 0.3, breath: 0.6 });
  },
  strike(X, out) { // out of the grass: a sharp hiss, the jaws snapping, a snarl
    const { c, t, rnd, g } = X;
    noise(c, "white", t, 0.25, biq(c, "bandpass", 3500, 1, envG(c, out, t, 0.45 * g, 0.03, 0.08, 0.1)), rnd);
    const at = t + 0.18;
    noise(c, "white", at, 0.03, biq(c, "highpass", 1800, 0.7, envG(c, out, at, 0.4 * g, 0.001, 0, 0.015)), rnd);
    osc(c, "sine", 170, at, 0.06, envG(c, out, at, 0.32 * g, 0.001, 0, 0.05)).frequency.exponentialRampToValueAtTime(60, at + 0.05);
    RECIPES.snarl({ ...X, t: at + 0.03 }, out);
  },
  // Carriers and the worm.
  bloat(X, out) { // a bloated gurgle
    const { c, t, rnd, P, g } = X, dur = 1.2 + rnd() * 0.5;
    say(X, out, { f0: P.f0 * X.p * 0.95, dur, contour: [[0.5, 1.05], [1, 0.8]], vowels: ["oo", "oh", "uh"], rasp: 0.6, fry: 0.5, fryHz: 7 + rnd() * 5, lp: 1000, fw: [1, 0.4, 0.12], a: dur * 0.3, hold: dur * 0.3, rel: dur * 0.4, peak: 0.42, breath: 0.08 });
    bubbles(c, out, t + 0.1, dur, 10 + Math.floor(rnd() * 5), 0.14 * g, rnd, 120, 450);
    noise(c, "brown", t, dur, biq(c, "lowpass", 350, 1, am(c, envG(c, out, t, 0.32 * g, 0.2, dur * 0.4, dur * 0.4), 7, 0.9, t, dur)), rnd);
  },
  burst(X, out) { // a wet pop, a splatter, and the swarm pouring out
    const { c, t, rnd, g } = X;
    osc(c, "sine", 160, t, 0.25, envG(c, out, t, 0.65 * g, 0.002, 0, 0.2)).frequency.exponentialRampToValueAtTime(35, t + 0.2);
    noise(c, "brown", t, 0.15, biq(c, "lowpass", 1200, 0.8, envG(c, out, t, 0.8 * g, 0.001, 0.01, 0.12)), rnd);
    clicks(c, out, t + 0.02, 16, 0.5, 0.25 * g, rnd, 1000, 3000, 1.5); // splatter
    bubbles(c, out, t + 0.1, 0.8, 10, 0.12 * g, rnd);
    RECIPES.squirm({ ...X, t: t + 0.25, g: g * 0.7 }, out);
  },
  // The mid game's dead.
  call(X, out) { // a Shepherd's herding call: tongue clicks, then two low hoots a fourth apart
    const { c, t, rnd, P, g } = X, f = P.f0 * X.p;
    clicks(c, out, t, 3, 0.18, 0.22 * g, rnd, 1800, 2600, 8);
    say(X, out, { at: 0.22, f0: f, dur: 0.55, contour: [[1, 0.97]], vowels: ["oo", "oh"], rasp: 0.3, drive: 1.2, fry: 0.1, vib: [4.5, 0.015], a: 0.06, hold: 0.25, rel: 0.25, peak: 0.5, breath: 0.15 });
    say(X, out, { at: 0.82, f0: f * 0.75, dur: 0.7, contour: [[1, 0.92]], vowels: ["oh", "oo"], rasp: 0.3, drive: 1.2, fry: 0.1, vib: [4.5, 0.015], a: 0.06, hold: 0.3, rel: 0.3, peak: 0.45, breath: 0.15 });
  },
  ululate(X, out) { // a Shepherd rallying the dead: a long wavering call
    const { rnd, P } = X, dur = 1.5 + rnd() * 0.3;
    say(X, out, { f0: P.f0 * X.p * 1.15, dur, contour: [[0.5, 1.1], [1, 0.8]], vowels: ["oo", "oh", "oo", "oh"], rasp: 0.35, drive: 1.4, vib: [6.5, 0.07], a: 0.15, hold: dur * 0.5, rel: dur * 0.35, peak: 0.55, breath: 0.15 });
  },
  creak(X, out) { // a Boneback at rest: a moan and the plates creaking
    RECIPES.moan(X, out);
    const { c, t, rnd, g } = X;
    const o = osc(c, "sawtooth", 80 + rnd() * 30, t + 0.3, 0.6, biq(c, "bandpass", 620, 8, envG(c, out, t + 0.3, 0.1 * g, 0.15, 0.2, 0.25)));
    o.frequency.linearRampToValueAtTime(60 + rnd() * 20, t + 0.9);
  },
  crack(X, out) { // a Boneback hit: its bone plates cracking
    const { c, t, rnd, g } = X;
    noise(c, "white", t, 0.03, biq(c, "highpass", 1500, 0.7, envG(c, out, t, 0.7 * g, 0.0005, 0, 0.012)), rnd);
    for (const f of [1700, 3100, 4600]) noise(c, "white", t, 0.12, biq(c, "bandpass", f * (0.95 + rnd() * 0.1), 18, envG(c, out, t, 0.5 * g, 0.001, 0, 0.08)), rnd);
    clicks(c, out, t + 0.03, 4, 0.12, 0.2 * g, rnd, 2000, 3500, 10);
    RECIPES.grunt({ ...X, t: t + 0.04 }, out);
  },
  chitter(X, out) { // a Climber: a clicking hiss
    const { c, t, rnd, g } = X;
    clicks(c, out, t, 10 + Math.floor(rnd() * 6), 0.7, 0.16 * g, rnd, 1500, 3500, 6);
    noise(c, "white", t, 0.7, biq(c, "bandpass", 2800, 1.5, am(c, envG(c, out, t, 0.12 * g, 0.1, 0.3, 0.3), 14, 1, t, 0.7, "square")), rnd);
    say(X, out, { at: 0.1, f0: X.P.f0 * X.p * 1.4, dur: 0.35, contour: [[1, 0.9]], vowels: ["ee", "eh"], rasp: 1, a: 0.05, hold: 0.1, rel: 0.2, peak: 0.22, breath: 0.4 });
  },
  climb(X, out) { // over a wall: scrabbling and nails on wood
    const { c, t, rnd, g } = X;
    RECIPES.scrabble({ ...X, o: { ...X.o, steps: 4 } }, out);
    for (let i = 0; i < 3; i++) sweep(c, out, t + 0.1 + i * 0.25, 0.25, 2400 + rnd() * 600, 1300, 8, 0.1 * g, 0.02, 0.1, 0.12, rnd);
  },
  heave(X, out) { // a Flinger winding up: a straining groan and the slosh of what it holds
    const { c, t, rnd, P, g } = X, dur = 0.9 + rnd() * 0.2;
    say(X, out, { f0: P.f0 * X.p * 0.9, dur, contour: [[1, 1.6]], vowels: ["uh", "er", "eh"], fry: 0.6, rasp: 1, drive: P.drive * 1.3, a: dur * 0.4, hold: dur * 0.4, rel: dur * 0.2, peak: 0.55, breath: 0.2 });
    noise(c, "brown", t, dur, biq(c, "bandpass", 300, 2, am(c, envG(c, out, t, 0.35 * g, 0.2, dur * 0.4, dur * 0.3), 5, 1, t, dur)), rnd);
    bubbles(c, out, t, dur, 8, 0.11 * g, rnd, 150, 500);
  },
  fling(X, out) { // the throw: a grunt, a wet whoosh, the mass landing
    const { c, t, rnd, P, g } = X;
    say(X, out, { f0: P.f0 * X.p * 1.4, dur: 0.25, contour: [[1, 0.7]], vowels: ["aa", "uh"], fry: 0.5, rasp: 1, a: 0.01, hold: 0.06, rel: 0.18, peak: 0.5, breath: 0.3 });
    const f = biq(c, "bandpass", 400, 2, envG(c, out, t + 0.05, 0.35 * g, 0.12, 0.08, 0.15), t + 0.05);
    f.frequency.exponentialRampToValueAtTime(1800, t + 0.2);
    f.frequency.exponentialRampToValueAtTime(600, t + 0.38);
    noise(c, "white", t + 0.05, 0.36, f, rnd);
    RECIPES.splat({ ...X, t: t + 0.45 }, out);
    RECIPES.squirm({ ...X, t: t + 0.5, g: g * 0.5 }, out);
  },
  spores(X, out) { // a Sower: a wet rattling exhale and a hiss of spores
    const { c, t, rnd, P, g } = X, dur = 1 + rnd() * 0.4;
    say(X, out, { f0: P.f0 * X.p * 0.9, dur, contour: [[1, 0.75]], vowels: ["oh", "uh"], fry: 0.9, fryHz: 26 + rnd() * 8, rasp: 1.1, lp: 1200, a: dur * 0.2, hold: dur * 0.3, rel: dur * 0.5, peak: 0.36 });
    noise(c, "white", t + 0.2, dur, biq(c, "highpass", 4200, 0.7, envG(c, out, t + 0.2, 0.08 * g, dur * 0.3, dur * 0.3, dur * 0.4)), rnd);
    bubbles(c, out, t, dur, 5, 0.08 * g, rnd);
  },
  // Nightmares: something truly wrong. A child-like wail and a deep voice a tritone apart swell together, ring-
  // modulated by a falling carrier, over whispering, and stop dead (a reversed swell).
  whisper(X, out) {
    const { c, t, rnd, g } = X, dur = 1.4 + rnd() * 0.6;
    const e = envG(c, out, t, 0.14 * g, dur * 0.4, dur * 0.3, dur * 0.3);
    for (const k of [0, 1, 2]) {
      const f = biq(c, "bandpass", VW.uh[k], 10, gainN(c, [1, 0.6, 0.4][k], e), t);
      let tt = t;
      while (tt < t + dur) { tt += 0.08 + rnd() * 0.1; f.frequency.linearRampToValueAtTime(VW[pick(X, ["ee", "aa", "oo", "eh", "uh"])][k], tt); }
      noise(c, "white", t, dur, f, rnd);
    }
    clicks(c, out, t, 4, dur, 0.1 * g, rnd, 1500, 3000, 6);
  },
  nightmare(X, out) {
    const { c, t, rnd, vp, P, g } = X, dur = 2.1 * clamp(vp.drawl, 0.9, 1.15), f0 = clamp(P.f0 * X.p * 5.4, 380, 720);
    const swell = { a: dur * 0.8, hold: dur * 0.08, rel: 0.12 };
    say(X, out, { f0, dur, contour: [[0.5, 1.06], [0.85, 1.12], [1, 0.94]], vowels: ["oo", "ee", "ee", "aa"], shift: 1.3, rasp: 0.25, drive: 1.6, vib: [5, 0.035], ...swell,
      peak: 0.42, ring: [333, 0.5, 89] });
    say(X, out, { f0: f0 * 0.177, dur, contour: [[1, 0.8]], vowels: ["oh", "oo"], fry: 0.7, drive: 3, ...swell, peak: 0.42 });
    RECIPES.whisper({ ...X, g: g * 1.6 }, out);
    noise(c, "brown", t, dur, biq(c, "lowpass", 700, 0.8, envG(c, out, t, 0.25 * g, swell.a, swell.hold, 0.05)), rnd); // the reversed swell
    clicks(c, out, t + dur, 1, 0.01, 0.4 * g, rnd, 1200, 2000, 2); // and the stop
  },
  laugh(X, out) { // a Nightmare noticing you: a stuttering breathy laugh
    const { rnd, P } = X;
    for (let i = 0; i < 5; i++) say(X, out, { at: i * 0.14, f0: P.f0 * X.p * (2.4 - i * 0.15) * (0.95 + rnd() * 0.1), dur: 0.09, contour: [[1, 0.85]], vowels: ["eh", "ah"], rasp: 0.9, a: 0.01, hold: 0.02, rel: 0.06, peak: 0.3, breath: 0.8 });
  },
  glitch(X, out) { // a Nightmare hurt: a yelp that stutters
    RECIPES.yelp(X, out);
    RECIPES.yelp({ ...X, t: X.t + 0.09, p: X.p * 1.33 }, out);
  },
  wail(X, out) { // a Nightmare dying: the wail falling away
    const { t, P } = X, dur = 1.6;
    say(X, out, { f0: clamp(P.f0 * X.p * 5, 380, 700), dur, contour: [[0.2, 1.1], [1, 0.3]], vowels: ["ee", "aa", "oo"], shift: 1.3, rasp: 0.4, drive: 2, vib: [5, 0.05], a: 0.05, hold: 0.3, rel: dur - 0.35, peak: 0.42, ring: [333, 0.4, 60] });
    slump(X, out, t + dur * 0.8);
  },
  gasp(X, out) { // a Sleeper waking (or a body rising): a sharp breath in, then the croak
    const { c, t, rnd, g } = X;
    sweep(c, out, t, 0.3, 500, 2400, 2.5, 0.45 * g, 0.28, 0.02, 0.05, rnd);
    say(X, out, { at: 0.3, f0: X.P.f0 * X.p * 1.1, dur: 0.3, contour: [[1, 0.7]], vowels: ["aa", "uh"], fry: 0.7, rasp: 1.2, a: 0.01, hold: 0.06, rel: 0.22, peak: 0.45, breath: 0.3 });
  },
  wake(X, out) { // a Sleeper splitting open
    RECIPES.gasp(X, out);
    const { c, t, rnd, g } = X;
    sweep(c, out, t + 0.35, 0.3, 500, 2600, 2, 0.32 * g, 0.03, 0.08, 0.2, rnd); // tearing
    bubbles(c, out, t + 0.4, 0.5, 8, 0.12 * g, rnd);
    RECIPES.squirm({ ...X, t: t + 0.5, g: g * 0.7 }, out);
  },
};

// The common dead's voices; every kind starts from these and changes what is its own.
const COMMON = {
  idle: ["moan", "moan", "gurgle", "wheeze"], aggro: "spot", attack: "snarl", bite: "bite", hurt: "grunt", death: "rattle", step: "shuffle",
  wake: "rise", bash: "bash", smash: "smash", sizzle: "sizzle", worms: "squirm", burst: "burst", shriek: "shriek", strike: "strike", spit: "spit",
  heave: "heave", fling: "fling", climb: "climb", snarl: "bark",
};
export const VOICE_SETS = {
  walker: COMMON,
  armoured: { ...COMMON, idle: ["moan", "gurgle", "wheeze"], hurt: "gruntClang", step: "clank" },
  runner: { ...COMMON, idle: ["pant", "pant", "moan"], aggro: "shriek", hurt: "yelp", step: "slap" },
  brute: { ...COMMON, idle: ["moan", "rumble"], aggro: "roar", attack: "roarShort", death: "roarDeath", step: "stomp" },
  spitter: { ...COMMON, idle: ["gurgle", "gurgle", "moan"] },
  screamer: { ...COMMON, idle: "whimper", aggro: "screech", shriek: "screech" },
  crawler: { ...COMMON, idle: "lurk", aggro: "hiss", step: "crawl" },
  carrier: { ...COMMON, idle: ["bloat", "bloat", "gurgle"], death: "burst" },
  swarm: { ...COMMON, idle: "squirm", aggro: "squirm", attack: "squelch", bite: "squelch", hurt: "splat", death: "splat", step: "squirm", wake: "squirm", snarl: "squelch" },
  shepherd: { ...COMMON, idle: "call", aggro: "ululate" },
  boneback: { ...COMMON, idle: ["moan", "creak"], hurt: "crack", step: "bonestep" },
  climber: { ...COMMON, idle: "chitter", step: "scrabble" },
  flinger: { ...COMMON, idle: ["gurgle", "moan"] },
  sower: { ...COMMON, idle: "spores" },
  nightmare: { ...COMMON, idle: "whisper", aggro: "laugh", hurt: "glitch", death: "wail", shriek: "nightmare" },
  sleeper: { ...COMMON, idle: "silent", aggro: "gasp", wake: "wake", death: "splat", step: "silent", snarl: "silent" },
  wallbreaker: { ...COMMON, idle: "rumble", aggro: "roar", attack: "roarShort", death: "roarDeath", step: "stomp", bash: "smash" },
  broodmother: { ...COMMON, idle: ["bellow", "bloat"], aggro: "roar", attack: "roarShort", death: "roarDeath", step: "stomp", bash: "smash" },
};
export const CORE_EVENTS = ["idle", "aggro", "attack", "bite", "hurt", "death", "step"];
// Footsteps (shuffle, drag, slap, stomp, clank, bonestep, scrabble, crawl) are owned by the sfx-melee-steps branch: off
// here (one switch, so one side can be dropped at integration). The worm swarm's squirm as it moves and a Climber
// going over a wall are the creature's own and stay.
export const ZOMBIE_STEPS = { on: false };
const OWN_STEP = new Set(["swarm"]);
// The cue name (ui/audio.js VOICES, the throttle) of each event.
export const EVENT_CUE = {
  idle: "zIdle", aggro: "zAggro", attack: "zAttack", bite: "zBite", hurt: "zHurt", death: "zDeath", step: "zStep", smash: "zSmash", bash: "zBash",
  spit: "zSpit", sizzle: "zSizzle", shriek: "zShriek", strike: "zStrike", burst: "zBurst", worms: "zWorms", heave: "zHeave", fling: "zFling",
  climb: "zClimb", wake: "zWake", snarl: "zSnarl",
};
export const EVENT_DUR = { idle: 2.4, aggro: 2, attack: 0.7, bite: 1.2, hurt: 0.5, death: 2.2, step: 1.6, smash: 1.2, bash: 0.5, spit: 1, sizzle: 1.1, shriek: 5.9, strike: 0.7, burst: 1.6, worms: 1.3, heave: 1.2, fling: 1.4, climb: 1.2, wake: 1.4, snarl: 0.9 };
// Throttle limits (ui/audio.js LIMITS): gap (s) between two starts, max playing at once.
export const ZOMBIE_LIMITS = {
  zIdle: { gap: 0.7, max: 2 }, zAggro: { gap: 0.45, max: 2 }, zAttack: { gap: 0.15, max: 2 }, zBite: { gap: 0.12, max: 2 }, zHurt: { gap: 0.1, max: 3 },
  zDeath: { gap: 0.25, max: 3 }, zStep: { gap: 0.1, max: 3 }, zSmash: { gap: 0.3, max: 2 }, zBash: { gap: 0.15, max: 2 }, zSpit: { gap: 0.3, max: 2 },
  zSizzle: { gap: 0.2, max: 2 }, zShriek: { gap: 1.5, max: 1 }, zStrike: { gap: 0.2, max: 2 }, zBurst: { gap: 0.3, max: 2 }, zWorms: { gap: 0.3, max: 2 },
  zHeave: { gap: 0.5, max: 1 }, zFling: { gap: 0.3, max: 2 }, zClimb: { gap: 0.25, max: 2 }, zWake: { gap: 0.4, max: 2 },
  zSnarl: { gap: 1.5, max: 1 },
};
// Their place in a frame's volley (soundcues.js PRIORITY: lower is heard first): the screamer's shriek near the top.
export const Z_PRIORITY = {
  zShriek: 2, zBurst: 3, zBite: 4, zSmash: 4, zStrike: 4, zSpit: 5, zFling: 5, zWake: 5, zSnarl: 5, zDeath: 6, zAttack: 6, zHeave: 6,
  zBash: 7, zAggro: 7, zHurt: 7, zSizzle: 7, zWorms: 7, zClimb: 8, zIdle: 9, zStep: 10,
};
export const ZOMBIE_SOUND_NAMES = Object.values(EVENT_CUE);

// The recipe a kind uses for an event (null: none, e.g. a Sleeper at rest is silent).
export function recipeFor(kind, ev, rnd = Math.random) {
  const set = VOICE_SETS[kind] || COMMON;
  const r = set[ev] ?? COMMON[ev];
  if (!r) return null;
  return Array.isArray(r) ? r[Math.floor(rnd() * r.length) % r.length] : r;
}

let takes = 0; // each call varies a little (a fresh generator from the seed and this count)
export function resetTakes(n = 0) { takes = n; }
// Plays one event of a kind's voice set into out (through zRoute). o: { kind, seed, gain, pitch, dist, pan, far, human,
// steps, mat, hidden }. Returns the recipe's name (or null).
export function playZombie(ev, c, out, t, o = {}) {
  const kind = PROFILE[o.kind] ? o.kind : "walker";
  const seed = Number.isFinite(o.seed) ? o.seed >>> 0 : (Math.random() * 4294967296) >>> 0;
  const rnd = mulberry(hash32(seed ^ Math.imul(++takes, 0x27d4eb2d)));
  const name = recipeFor(kind, ev, rnd);
  if (!name || name === "silent") return name;
  const group = groupGain(groupOf(EVENT_CUE[ev]) || "zombies"); // the mixer (ui/soundgroups.js): off, nothing is built
  if (!(group > 0)) return name;
  const vp = voiceParams(seed);
  const far = o.far ?? (ev === "shriek" || ev === "smash");
  const dest = zRoute(c, out, t, { ...o, far, ev, recipe: name, group });
  const X = { c, t, vp, rnd, P: PROFILE[kind], g: Number.isFinite(o.gain) ? o.gain : 1, p: vp.pitch * (Number.isFinite(o.pitch) ? o.pitch : 1), o, kind, ev };
  RECIPES[name](X, dest);
  return name;
}
// The voices ui/audio.js adds to its VOICES (routes: they pan themselves, so sfx adds no panner of its own).
export const ZOMBIE_VOICES = Object.fromEntries(Object.entries(EVENT_CUE).map(([ev, cue]) => [cue, {
  dur: EVENT_DUR[ev], routes: true, play(c, out, t, o) { playZombie(ev, c, out, t, o); },
}]));

// ---------- the zombie bus ----------
// The crowd bed goes through it on its way to the battle bus (ui/audio.js): a gain (ZOMBIE_BUS_GAIN, +2 dB, × the
// mixer's Crowd murmur group), a soft limiter (a fast compressor, threshold -6 dB, ratio 12) and a soft clip whose
// ceiling is -1 dBFS, so a horde never clips whatever the sliders say. The voices go through gun-sfx's spatial chain
// instead (zRoute: its battle bus and the effects bus's limiter, ui/sfxlab.js makeLimiter). zombieVolume: a 0–1.5
// slider value to a gain (squared, like the other sliders).
// The levels came down for the mixer (the user: zombie voices down a touch so everything fits without the limiter
// working as hard): in a firefight into a horde of 24 the effects limiter was pulling 1.3 dB on average, 5 dB at most,
// 84% of the time; now about 0.1 dB, 2.5 at most, a third of the time (tools/zombiesfxpreview.cjs; the report).
export const ZOMBIE_BUS_GAIN = 1.259; // the crowd bed: +2 dB over the level it was first made at (was +4)
export const ZOMBIE_VOICE_GAIN = 0.944; // the voices: -0.5 dB (were +4), the moans at +1.5 (EVENT_TRIM)
export const ZOMBIE_CEIL = 0.891;     // -1 dBFS
export const ZOMBIE_TRIM = 0.785;         // × after the limiter: undoes the make-up gain browsers add to a compressor (measured)
export const zombieVolume = (v = 1) => clamp(Number.isFinite(Number(v)) ? Number(v) : 1, 0, 1.5) ** 2;
// An extra gain on every voice, read by zRoute (1; the mixer's groups do the player's volumes; the measuring tools use it).
export const ZOMVOL = { v: 1 };
export function setZombieVolume(v) { ZOMVOL.v = zombieVolume(v); }
// Trims on top of ZOMBIE_VOICE_GAIN, by event and by recipe: the moans 2 dB back up (2.5 dB under where they were, still
// well over the old groan); a bite at arm's length 1 dB off; the loudest (a runner's shriek or a brute's roar as it
// spots you) 2 dB more off, and a brute's roar 1.5 dB more again (it was louder than a screamer's shriek at arm's
// length). So a horde charging does not pin the limiter, and the screamer's call is the one that carries.
export const EVENT_TRIM = { idle: 1.259, aggro: 0.79, bite: 0.89 };
export const RECIPE_TRIM = { roar: 0.84 };
export const FAR_GAIN = 1.1; // a voice made to carry (the screamer's shriek, a smash): a little over the rest, and it falls off slower (CARRY)
const CLIP = new Map();
function softClip(k) { // linear to 0.7 of the ceiling, then a tanh knee up to it
  let cv = CLIP.get(k);
  if (!cv) {
    cv = new Float32Array(2048);
    const lin = 0.7 * k;
    for (let i = 0; i < 2048; i++) {
      const x = (i / 1023.5 - 1) * 4, a = Math.abs(x); // the shaper's input range is ±1: the gain before it is ÷4
      cv[i] = Math.sign(x) * (a <= lin ? a : lin + (k - lin) * Math.tanh((a - lin) / (k - lin)));
    }
    CLIP.set(k, cv);
  }
  return cv;
}
// o.limiter false: the gain alone (for measuring what the limiter takes off).
export function makeZombieBus(c, dest, o = {}) {
  const input = gainN(c, ZOMBIE_BUS_GAIN);
  let tail = input;
  let comp = null;
  if (o.limiter === false) { input.connect(dest); return { input, comp, setVolume(v, t = c.currentTime) { input.gain.setValueAtTime(ZOMBIE_BUS_GAIN * zombieVolume(v), t); }, setGain(g, t = c.currentTime) { input.gain.setValueAtTime(ZOMBIE_BUS_GAIN * g, t); } }; }
  if (c.createDynamicsCompressor) {
    comp = c.createDynamicsCompressor();
    comp.threshold.value = -6; comp.knee.value = 4; comp.ratio.value = 12; comp.attack.value = 0.002; comp.release.value = 0.2;
    input.connect(comp);
    tail = gainN(c, ZOMBIE_TRIM); // the compressor's own make-up gain taken back off, so the bus is +4 dB below the limit
    comp.connect(tail);
  }
  if (c.createWaveShaper) {
    const pre = gainN(c, 0.25), sh = c.createWaveShaper(); // ÷4 in, the curve gives the level back (±4 → ±ceiling)
    sh.curve = softClip(ZOMBIE_CEIL);
    tail.connect(pre); pre.connect(sh); sh.connect(dest);
  } else tail.connect(dest);
  return {
    input, comp,
    setVolume(v, t = c.currentTime, now = false) { this.setGain(zombieVolume(v), t, now); },
    // The mixer's Crowd murmur group (ui/soundgroups.js groupGain: × Zombies): a gain, ramped.
    setGain(k, t = c.currentTime, now = false) {
      const g = ZOMBIE_BUS_GAIN * Math.max(0, Number(k) || 0);
      if (now) input.gain.setValueAtTime(g, t); else input.gain.setTargetAtTime(g, t, 0.06);
    },
  };
}

// ---------- where a voice is heard from ----------
// The one place a zombie voice meets the speakers: gun-sfx's spatial chain (ui/gunsfx.js spatialOut: level and highs
// by distance, muffled out of sight, pan, the room's reverb send, into the battle bus with its ducking and the deafened
// muffle, then the effects bus and its limiter). The voice's level: ZOMBIE_VOICE_GAIN × its trims (EVENT_TRIM, RECIPE_TRIM)
// × o.group (the mixer's gain for the event's group, ui/soundgroups.js: Moans, Attacks, Shrieks, Special, each × Zombies;
// so the Gunfire group never touches the dead, nor these the guns or the blows) × FAR_GAIN for a voice made to carry ×
// ZOMVOL (1: a lever for the measuring tools). o.sp: the placement soundcues gave the cue (gunsfx.js spatial); else { pan, dist, seen,
// room } of its own (the sound test: near and in front). out: where it goes on a context with no battle bus (spatialOut
// finds the bus on the context; a bare offline render or a test stub has none).
// A voice made to carry (o.far) also falls off more slowly past CARRY.FROM tiles (half the distance counts), so the
// screamer's call is plain at 12–16 tiles without being hot up close.
export const CARRY = { FROM: 6, K: 0.35 };
export const carryDist = (d) => (d > CARRY.FROM ? CARRY.FROM + (d - CARRY.FROM) * CARRY.K : d);
export function zRoute(c, out, t, o = {}) {
  let sp = o.sp || { pan: o.pan, dist: o.dist, seen: o.seen, room: o.room };
  const d = Number(sp.dist) || 0;
  if (o.far && d > CARRY.FROM) sp = { ...place({ pan: sp.pan ?? sp.x ?? 0, dist: carryDist(d), seen: sp.seen, room: sp.room }), delay: sp.delay ?? 0 };
  return spatialOut(c, sp, { gain: ZOMBIE_VOICE_GAIN * ZOMVOL.v * (EVENT_TRIM[o.ev] ?? 1) * (RECIPE_TRIM[o.recipe] ?? 1) * (o.far ? FAR_GAIN : 1) * (o.group ?? 1), dest: out });
}

// ---------- the battle's cues (soundcues.js battleCues; pure) ----------
const CLIMB = new Set([...(MIDDEAD.CLIMBER.CLIMB || []), "gate"]);
const at = (b, p, not) => (p ? b.units.find((u) => u !== not && u.x === p[0] && u.y === p[1] && !u.dead) || null : null);
const zAt = (b, p) => (p ? b.units.find((u) => u.kind === "zombie" && u.x === p[0] && u.y === p[1] && !u.dead) || b.units.find((u) => u.kind === "zombie" && u.x === p[0] && u.y === p[1]) || null : null);
const cheb = (a, p) => Math.max(Math.abs(a.x - p[0]), Math.abs(a.y - p[1]));
const cellK = (b, x, y) => (b.cells && b.w && x >= 0 && y >= 0 && x < b.w ? (b.cells[y * b.w + x] || {}).k : null);
// What a structure is made of, by the cell left where it stood.
export function matAt(b, p) {
  const k = p ? String(cellK(b, p[0], p[1]) || "") : "";
  if (/gate|car|truck|metal|van|bus/.test(k)) return "metal";
  if (/breach|palisade|wall|rubble/.test(k)) return "wall";
  return "wood";
}
// Where the player hears from: the selected one of your people, else the middle of them.
export function listenerOf(b, selId = null) {
  const sel = selId != null ? b.units.find((u) => u.id === selId && u.side === "player" && !u.dead) : null;
  if (sel) return { x: sel.x, y: sel.y };
  const ps = b.units.filter((u) => u.side === "player" && !u.dead && !u.left && u.x >= 0);
  if (!ps.length) return { x: (b.w || 20) / 2, y: (b.h || 20) / 2 };
  return { x: ps.reduce((s, u) => s + u.x, 0) / ps.length, y: ps.reduce((s, u) => s + u.y, 0) / ps.length };
}
// Where the dead are heard from: gun-sfx's listener for the frame (ui/battlesfx.js frameListener: the selected unit, the
// view, the fog of war, the room) with x, y (the selected unit, else the middle of your people) for the nearest moaner
// and the crowd's distance. With no view (a headless test) and no one selected, placements are heard from x, y.
export function zListener(FL, b, selId = null) {
  const c = listenerOf(b, selId);
  const L = { ...(FL || {}), x: c.x, y: c.y, b };
  if (L.lx == null && !L.cam) { L.lx = c.x; L.ly = c.y; }
  if (!L.w) L.w = b.w || 0;
  return L;
}
// A spot's placement (gunsfx.js spatial, as one of the enemy: muffled out of sight; indoors in a room's echo), carried
// on the cue as sp; pan and dist are kept on it for the tests and the volley.
export function zPlace(L, x, y) {
  const sp = spatial(L, x, y, { enemy: true, indoor: L && L.b ? isIndoor(L.b, x, y) : false });
  return { sp, pan: r2(sp.pan), dist: r2(sp.dist) };
}
function cue(ev, u, b, L, extra = {}, p = null) {
  const pos = p || [u.x, u.y];
  return { name: EVENT_CUE[ev], kind: voiceKind(u), seed: unitSeed(b, u), ...zPlace(L, pos[0], pos[1]), ...extra };
}
// The memory of the dead in this battle (kept in soundcues' battle memory): id -> { aw, hp, low, dead, aggro }.
export function zombieMemory(b) {
  const z = new Map();
  for (const u of b.units) if (u.kind === "zombie") z.set(u.id, { aw: !!u.aware, hp: u.hp, low: !!u.low, dead: !!u.dead, aggro: !!u.dead });
  return { z, corpses: new Set((b.corpses || []).filter((c) => c.burst).map((c) => c.id)), flung: false };
}
// One battle effect (combat.js fx): pushes the dead's cues to out; true when it was theirs (soundcues skips its own).
export function zombieFxCue(b, f, zm, L, out) {
  if (f.type === "shot") {
    const a = zAt(b, f.from);
    if (!a || a.side === "player") return false;
    if (f.worm) { zm.flung = true; out.push(cue("fling", a, b, L)); return true; }
    if (f.acid) {
      out.push(cue("spit", a, b, L));
      if (f.hit && f.to) out.push(cue("sizzle", a, b, L, { delay: 0.55, gain: 0.8 }, f.to));
      return true;
    }
    return false;
  }
  if (f.type === "melee") {
    if (f.acid) { // the acid pool or a spitter's burst sac
      out.push({ name: EVENT_CUE.sizzle, kind: "spitter", seed: voiceSeed(f.seq || 0, battleSalt(b)), ...zPlace(L, f.to[0], f.to[1]), gain: f.text === "BURST" ? 1 : 0.6 });
      return true;
    }
    const a = zAt(b, f.from);
    if (!a || a.side === "player" || (f.from && f.to && f.from[0] === f.to[0] && f.from[1] === f.to[1] && !f.hit)) return false;
    if (f.from && f.to && f.from[0] === f.to[0] && f.from[1] === f.to[1]) return false; // a blow landing on itself (a retreat caught): not theirs
    if (f.text === "SMASH" || f.text === "BROKEN") { out.push(cue("smash", a, b, L, { mat: matAt(b, f.to) })); return true; }
    const t = at(b, f.to, a) || b.units.find((u) => u !== a && f.to && u.x === f.to[0] && u.y === f.to[1]);
    if (!t) { out.push(f.hit ? cue("bash", a, b, L, { mat: matAt(b, f.to) }) : cue("attack", a, b, L)); return true; }
    const m = zm.z.get(a.id);
    if (m && m.low && a.ztype === "crawler") { out.push(cue("strike", a, b, L)); m.low = false; }
    out.push(f.hit ? cue("bite", a, b, L, { human: t.kind === "human" }) : cue("attack", a, b, L));
    return true;
  }
  if (f.type === "scream") {
    const a = zAt(b, f.from);
    const kind = a ? voiceKind(a) : "screamer";
    const k2 = kind === "nightmare" || kind === "screamer" ? kind : "screamer";
    out.push({ name: EVENT_CUE.shriek, kind: k2, seed: a ? unitSeed(b, a) : voiceSeed(f.seq || 0), ...zPlace(L, f.from[0], f.from[1]), far: true });
    return true;
  }
  if (f.type === "loot" && f.to) {
    if (f.text === "WINDS UP") { const a = zAt(b, f.to); if (a) out.push(cue("heave", a, b, L)); return !!a; }
    if (f.text === "RISES") { const a = zAt(b, f.to); if (a) out.push(cue("wake", a, b, L)); return !!a; }
    if (f.text === "WORMS") {
      if (zm.flung) return true; // a Flinger's throw: the fling has its landing
      const dying = b.units.some((u) => u.ztype === "carrier" && u.dead && cheb(u, f.to) <= 1 && zm.z.has(u.id) && !zm.z.get(u.id).dead);
      if (dying) return true; // a Carrier bursting: its burst has the swarm
      const corpse = (b.corpses || []).find((c) => c.burst && !zm.corpses.has(c.id) && cheb(c, f.to) <= 1);
      if (corpse) {
        zm.corpses.add(corpse.id);
        out.push({ name: EVENT_CUE.wake, kind: "sleeper", seed: voiceSeed(100000 + (corpse.id | 0), battleSalt(b)), ...zPlace(L, corpse.x, corpse.y) });
        return true;
      }
      const w = zAt(b, f.to);
      out.push({ name: EVENT_CUE.worms, kind: "swarm", seed: w ? unitSeed(b, w) : voiceSeed(f.seq || 0), ...zPlace(L, f.to[0], f.to[1]) });
      return true;
    }
    return false;
  }
  if (f.type === "move") {
    const u = b.units.find((o) => o.id === f.unit);
    if (!u || u.kind !== "zombie") return false;
    const m = zm.z.get(u.id);
    if (m && m.aggro !== true) aggroCue(b, u, m, zm, L, out);
    const path = f.path || [];
    if (u.ztype === "climber" && path.some((p) => CLIMB.has(cellK(b, p[0], p[1])))) out.push(cue("climb", u, b, L));
    else if (ZOMBIE_STEPS.on || OWN_STEP.has(voiceKind(u))) out.push(cue("step", u, b, L, { steps: Math.max(1, path.length), gain: 0.8 }));
    return true;
  }
  return false;
}
// The dead's changes since the last frame: noticing someone (aggro), hurt, dying (a Carrier bursts). Pushes to out.
export function zombieUnitCues(b, zm, L, out) {
  for (const u of b.units) {
    if (u.kind !== "zombie") continue;
    let m = zm.z.get(u.id);
    if (!m) { zm.z.set(u.id, { aw: !!u.aware, hp: u.hp, low: !!u.low, dead: !!u.dead, aggro: !!u.dead }); continue; } // new on the field: its arrival had its own sound
    if (u.dead && !m.dead) {
      m.dead = true;
      if (!u.sank) out.push(cue("death", u, b, L));
    } else if (!u.dead) {
      if (u.hp < m.hp) out.push(cue("hurt", u, b, L, { gain: 0.8 }));
      if (u.aware && !m.aw && m.aggro !== true) aggroCue(b, u, m, zm, L, out);
    }
    m.hp = u.hp; m.aw = !!u.aware; m.low = !!u.low;
  }
  zm.flung = false;
  zm.anyZ = out.some((c) => /^z/.test(c.name)); // a zombie one-shot this frame (a snarl keeps its distance from it)
}
// One of the dead starting for your people: the silent-then-shriek, but not from every one of them: always the first of
// the fight and any that come within AGGRO_NEAR tiles of your people, else about AGGRO_SHARE of them (by its seed).
// The others stay quiet ("quiet") until they come that close.
export const AGGRO_SHARE = 0.5, AGGRO_NEAR = 2;
export const aggroLucky = (b, u) => hash32(unitSeed(b, u) ^ 0xa66) / 4294967296 < AGGRO_SHARE;
function aggroCue(b, u, m, zm, L, out) {
  const near = b.units.some((o) => o.side === "player" && !o.dead && !o.left && o.x >= 0 && Math.max(Math.abs(o.x - u.x), Math.abs(o.y - u.y)) <= AGGRO_NEAR);
  if (!zm.firstAggro || near || (m.aggro !== "quiet" && aggroLucky(b, u))) { zm.firstAggro = true; m.aggro = true; out.push(cue("aggro", u, b, L)); }
  else m.aggro = "quiet";
}
// The living dead that can be heard (not a Sleeper lying still, not one gone off the map).
const upDead = (b) => b.units.filter((u) => u.kind === "zombie" && !u.dead && !u.left && !u.off && !u.dormant && u.x >= 0);
// The dead at rest: moans in irregular clusters (CLUSTER moans, STEP s apart), then a stretch of near-silence (SILENCE
// s, shorter the more of them are up, so a big horde never goes quiet; the crowd bed dips through it). During or just
// after a silence, now and then (about one every SNARL_EVERY s of quiet) one of the nearer dead snarls, sudden and
// loud, never within SNARL_GAP s of another of their sounds. Every interval jittered by a generator seeded from the
// battle (its tile and its units' ids): the same battle, the same pattern; no world dice. mem: soundcues' battle
// memory (mem.zi: this scheduler; mem.zm.anyZ: a zombie sound this frame). The fifth argument is ignored (soundcues
// passes its own dice; the pattern is the battle's).
export const IDLE = { CLUSTER: [2, 5], STEP: [0.7, 3.2], SILENCE: [6, 15], SNARL_EVERY: 30, SNARL_GAP: 1.5, HUSH: 0.45, FIRST: [2, 5] };
const QUIET = new WeakMap(); // battle -> 1 while the dead are in a silence (the crowd bed dips); the battle is not touched
export const hushOf = (b) => QUIET.get(b) || 0;
export function idleSeed(b) { return hash32(battleSalt(b) * 31 + b.units.reduce((s, u) => (s * 33 + (u.kind === "zombie" ? u.id | 0 : 0)) >>> 0, 7)); }
export function zombieIdleCue(b, mem, L, now) {
  if (b.over) { QUIET.delete(b); return null; }
  const up = upDead(b);
  if (!up.length) { QUIET.delete(b); return null; }
  let S = mem.zi;
  if (!S || S.b !== b) {
    const r = mulberry(idleSeed(b));
    S = mem.zi = { b, r, phase: "silence", until: now + IDLE.FIRST[0] + r() * (IDLE.FIRST[1] - IDLE.FIRST[0]), next: 0, left: 0, snarlAt: null, lastShot: -99 };
  }
  const r = S.r, I = IDLE, scale = 1 / (1 + up.length / 20);
  if (mem.zm && mem.zm.anyZ) S.lastShot = now;
  if (S.phase === "silence" && now >= S.until) {
    S.phase = "cluster";
    S.left = I.CLUSTER[0] + Math.floor(r() * (I.CLUSTER[1] - I.CLUSTER[0] + 1)) + Math.floor(up.length / 15);
    S.next = now;
  }
  let out = null;
  if (S.phase === "cluster" && now >= S.next) {
    let u = null, best = Infinity;
    for (let i = 0; i < Math.min(3, up.length); i++) {
      const c = up[Math.floor(r() * up.length) % up.length], d = Math.hypot(c.x - L.x, c.y - L.y);
      if (d < best) { best = d; u = c; }
    }
    out = cue("idle", u, b, L, { gain: (0.55 + 0.45 * Math.min(1, up.length / 12)) * (u.low ? 0.6 : 1), hidden: !!u.low });
    if (--S.left <= 0) {
      S.phase = "silence";
      const d = Math.max(2.5, (I.SILENCE[0] + r() * (I.SILENCE[1] - I.SILENCE[0])) * (0.35 + 0.65 * scale) * (0.85 + r() * 0.3));
      S.until = now + d;
      S.snarlAt = r() < clamp(d / I.SNARL_EVERY, 0.15, 0.6) ? now + 1.2 + r() * (d + 1.5 - 1.2) : null; // during it or just after
    } else S.next = now + (I.STEP[0] + r() * (I.STEP[1] - I.STEP[0])) * (0.55 + 0.45 * scale) * (r() < 0.2 ? 1.8 : 1);
  }
  if (!out && S.snarlAt != null && now >= S.snarlAt) {
    if (now - S.lastShot < I.SNARL_GAP) S.snarlAt = S.lastShot + I.SNARL_GAP + r() * 0.5;
    else {
      S.snarlAt = null;
      const seen = up.filter((u) => !u.low && recipeFor(voiceKind(u), "snarl", () => 0) !== "silent");
      if (seen.length) {
        seen.sort((a, c) => Math.hypot(a.x - L.x, a.y - L.y) - Math.hypot(c.x - L.x, c.y - L.y) || a.id - c.id);
        const u = seen[Math.floor(r() * Math.min(3, seen.length))];
        out = cue("snarl", u, b, L, { gain: 1 });
        S.next = Math.max(S.next, now + I.SNARL_GAP); S.until = Math.max(S.until, now + I.SNARL_GAP); // and room after it
      }
    }
  }
  if (out) S.lastShot = now;
  QUIET.set(b, S.phase === "silence" ? 1 : 0);
  return out;
}
// The crowd: how many of the dead are up, the nearest and their mean distance from the listener.
export function crowdState(b, L) {
  if (!b || b.over) return { count: 0, near: 99, mean: 99 };
  const up = upDead(b);
  if (!up.length) return { count: 0, near: 99, mean: 99 };
  const ds = up.map((u) => Math.hypot(u.x - L.x, u.y - L.y));
  return { count: up.length, near: r2(Math.min(...ds)), mean: r2(ds.reduce((s, d) => s + d, 0) / ds.length), hush: hushOf(b) };
}

// ---------- the crowd bed ----------
// Levels of the bed's layers for a crowd (crowdState): a few moans from 3 of the dead, the dense murmur from about 6
// and full at 30, the shuffling feet; the whole by count (log) and nearness, the low-pass opening as they come close.
export const CROWD_LEVEL = 0.24;
export function crowdMix(cs) {
  const n = cs ? Math.max(0, Math.floor(cs.count || 0)) : 0;
  if (n < 3) return { count: n, sparse: 0, dense: 0, feet: 0, gain: 0, cutoff: 600 };
  const near = Number.isFinite(cs.near) ? cs.near : 10, mean = Number.isFinite(cs.mean) ? cs.mean : near;
  const close = 1 / (1 + Math.max(0, mean - 2) / 6);
  return {
    count: n,
    sparse: r2(clamp01((n - 2) / 4)),
    dense: r2(clamp01((n - 5) / 25)),
    feet: r2(clamp01(n / 14) * 0.8),
    gain: r2(clamp01((0.25 + 0.75 * Math.log2(1 + n) / Math.log2(41)) * (0.25 + 0.75 / (1 + Math.max(0, near - 2) / 6))) * (1 - IDLE.HUSH * (cs.hush || 0))),
    cutoff: Math.round(500 + 2300 * close),
  };
}
const CROWD_RATE = 22050, CROWD_SECS = 6;
const CROWD = new WeakMap();
// RBJ band-pass (0 dB peak) coefficients and one step of it (direct form I): for the buffers made in JS.
function bpCoef(f, q, rate) {
  const w = 2 * Math.PI * Math.min(f, rate * 0.45) / rate, al = Math.sin(w) / (2 * q), a0 = 1 + al;
  return [al / a0, 0, -al / a0, -2 * Math.cos(w) / a0, (1 - al) / a0];
}
function bq(co, s, x) {
  const y = co[0] * x + co[1] * s[0] + co[2] * s[1] - co[3] * s[2] - co[4] * s[3];
  s[1] = s[0]; s[0] = x; s[3] = s[2]; s[2] = y;
  return y;
}
// One moan written into a looped stereo buffer (wrapping round, so the loop has no seam).
function moanInto(L, R, len, r) {
  const rate = CROWD_RATE, dur = 0.9 + r() * 1.6, n = Math.floor(dur * rate), start = Math.floor(r() * len);
  const f0 = 40 + r() * 48, glide = 0.65 + r() * 0.35, amp = 0.4 + r() * 0.6, att = 0.2 + r() * 0.3;
  const va = VW[MOAN_PATHS[Math.floor(r() * 4)][0]], vb = VW[MOAN_PATHS[Math.floor(r() * 4)][2]];
  const fo1 = 0.85 + r() * 0.3, fo2 = 0.85 + r() * 0.3;
  const pan = r() * 2 - 1, gl = Math.cos((pan + 1) * Math.PI / 4) * amp, gr = Math.sin((pan + 1) * Math.PI / 4) * amp;
  let ph = 0, jit = 0, c1 = null, c2 = null;
  const s1 = [0, 0, 0, 0], s2 = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const fr = i / n;
    if ((i & 31) === 0) {
      c1 = bpCoef((va[0] + (vb[0] - va[0]) * fr) * fo1, 6, rate);
      c2 = bpCoef((va[1] + (vb[1] - va[1]) * fr) * fo2, 8, rate);
    }
    jit = jit * 0.999 + (r() - 0.5) * 0.004;
    ph += f0 * (1 + (glide - 1) * fr) * (1 + jit) / rate;
    if (ph >= 1) ph -= 1;
    const x = (2 * ph - 1) * 0.7 + (r() * 2 - 1) * (ph < 0.2 ? 0.85 : 0.3);
    const e = fr < att ? fr / att : Math.pow(1 - (fr - att) / (1 - att), 1.4);
    const y = (bq(c1, s1, x) + 0.5 * bq(c2, s2, x)) * e;
    const k = (start + i) % len;
    L[k] += y * gl; R[k] += y * gr;
  }
}
// A shuffling footstep (low-passed noise with a quick decay).
function scuffInto(L, R, len, r) {
  const n = Math.floor((0.05 + r() * 0.15) * CROWD_RATE), start = Math.floor(r() * len), amp = 0.3 + r() * 0.7, a = 0.05 + r() * 0.15;
  const pan = r() * 2 - 1, gl = Math.cos((pan + 1) * Math.PI / 4) * amp, gr = Math.sin((pan + 1) * Math.PI / 4) * amp;
  let lp = 0;
  for (let i = 0; i < n; i++) {
    lp += a * ((r() * 2 - 1) - lp);
    const e = Math.exp(-i / (n * 0.3)) * Math.min(1, i / 40);
    const k = (start + i) % len;
    L[k] += lp * e * gl; R[k] += lp * e * gr;
  }
}
function normalize(L, R, peak) {
  let m = 0;
  for (let i = 0; i < L.length; i++) m = Math.max(m, Math.abs(L[i]), Math.abs(R[i]));
  if (m > 0) for (let i = 0; i < L.length; i++) { L[i] *= peak / m; R[i] *= peak / m; }
}
// The bed's three loops, made once per context (seeded: the same every time). About 1 M samples of work, once.
export function crowdBuffers(c) {
  let B = CROWD.get(c);
  if (B) return B;
  const len = CROWD_RATE * CROWD_SECS;
  const mk = (seed, fill) => {
    const buf = c.createBuffer(2, len, CROWD_RATE);
    const L = buf.getChannelData(0), R = buf.getChannelData(1), r = mulberry(seed);
    fill(L, R, r);
    normalize(L, R, 0.8);
    return buf;
  };
  B = {
    sparse: mk(11, (L, R, r) => { for (let i = 0; i < 5; i++) moanInto(L, R, len, r); }),
    dense: mk(23, (L, R, r) => { for (let i = 0; i < 22; i++) moanInto(L, R, len, r); }),
    feet: mk(37, (L, R, r) => { for (let i = 0; i < 70; i++) scuffInto(L, R, len, r); }),
  };
  CROWD.set(c, B);
  return B;
}
// The bed: 3 looped sources and their gains, a low-pass, a level with a slow breathing wobble: 10 nodes in all.
export function makeCrowdBed(c, out, t = c.currentTime) {
  const B = crowdBuffers(c);
  const master = gainN(c, 0, out);
  const lp = biq(c, "lowpass", 900, 0.5, master);
  const L = {};
  const sources = [];
  for (const [k, rate] of [["sparse", 1], ["dense", 0.97], ["feet", 1]]) {
    const s = c.createBufferSource();
    s.buffer = B[k];
    s.loop = true;
    s.playbackRate.value = rate;
    const g = gainN(c, 0, lp);
    s.connect(g);
    s.start(t, (k === "dense" ? 2.1 : k === "feet" ? 4.3 : 0.7));
    sources.push(s);
    L[k] = g;
  }
  const breath = gainN(c, 1, lp); // unused input kept for symmetry; the wobble goes on the master
  breath.disconnect && breath.disconnect();
  const wob = c.createOscillator();
  wob.frequency.value = 0.07;
  const wg = gainN(c, 0, master.gain);
  wob.connect(wg);
  wob.start(t);
  sources.push(wob);
  return {
    nodes: 11, idleSince: null, mix: null,
    update(m, now) {
      this.mix = m;
      for (const k of ["sparse", "dense", "feet"]) L[k].gain.setTargetAtTime(m[k], now, 0.6);
      lp.frequency.setTargetAtTime(m.cutoff, now, 0.8);
      const lvl = m.gain * CROWD_LEVEL;
      master.gain.setTargetAtTime(lvl, now, 0.8);
      wg.gain.setTargetAtTime(lvl * 0.25, now, 0.8);
      this.idleSince = m.gain > 0 ? null : this.idleSince ?? now;
    },
    stop(now) { for (const s of sources) { try { s.stop(now + 0.05); } catch { /* already stopped */ } } },
  };
}
const BEDS = new WeakMap();
export const DEMO = { crowd: null, map: null }; // the Options tab's demos: { from, until }
// ui/audio.js every ambience tick: the battle's crowd (crowdState, or null for none) into out. The bed is made when the
// dead are first heard and let go after 4 s of silence.
export function zombieCrowd(c, out, cs, t = c.currentTime) {
  let m = crowdMix(cs);
  const d = DEMO.crowd;
  if (d && t < d.until) { const k = clamp01((t - d.from) / (d.until - d.from - 1.5)); m = crowdMix({ count: Math.round(4 + 32 * k), near: 12 - 10 * k, mean: 16 - 12 * k }); }
  else if (d) DEMO.crowd = null;
  let bed = BEDS.get(c);
  if (!bed) {
    if (!m.gain) return null;
    bed = makeCrowdBed(c, out, t);
    BEDS.set(c, bed);
  }
  bed.update(m, t);
  if (bed.idleSince != null && t - bed.idleSince > 4) { bed.stop(t); BEDS.delete(c); return null; }
  return bed;
}

// ---------- the State Map ----------
export const HORDE_HEAR = 16; // tiles from a base or one of your teams: a horde you can see this close is heard (fading out)
export const HIVE_HEAR = 5;  // tiles: a known hive this close is heard (its drone and heartbeat)
const nightOf = (hour) => {
  const h = (((Number(hour) || 0) % 24) + 24) % 24;
  return h >= 21 || h < 5 ? 1 : h >= 19 ? (h - 19) / 2 : h < 7 ? 1 - (h - 5) / 2 : 0;
};
// Levels (0–1) of the map's zombie ambience: horde (moaning on the wind: a big horde roars, a small one mutters; full
// within 2 tiles of a base or one of your teams, fading smoothly to nothing at HORDE_HEAR; more present at night; several
// hordes add up softly, 1 - the product of what each leaves quiet, so it never passes 1), hive (a known hive's drone
// near you; a Broodmother ready: stronger), and near (tiles), size, big (0–1: the loudest horde's size), night,
// close (0–1) for the filter. Pure; reads only what you can see or know.
export const hordeSizeLevel = (size) => clamp01(0.2 + 0.8 * Math.log10(1 + Math.max(0, size || 0) / 10) / Math.log10(41));
export const hordeDistLevel = (d) => (d <= 2 ? 1 : d >= HORDE_HEAR ? 0 : Math.pow(1 - (d - 2) / (HORDE_HEAR - 2), 1.5));
export function hordeAmbience(state) {
  const none = { horde: 0, hive: 0, near: 99, size: 0, big: 0, night: 0, close: 0, count: 0 };
  if (!state || !state.grid || !state.live) return none;
  const g = state.grid;
  const spots = (state.bases || []).map((b) => b.tile);
  for (const p of state.parties || []) if (p.owner === "player" && p.path && p.path.length && p.path[p.idx] != null) spots.push(p.path[p.idx]);
  if (!spots.length) return none;
  const dist = (tile) => spots.reduce((m, s) => Math.min(m, g.distance(tile, s)), 99);
  const night = r2(nightOf(state.hour));
  let quiet = 1, best = 0, big = 0, near = 99, size = 0, count = 0;
  for (const h of state.hordes || []) {
    if (!h || !state.live.has(h.tile)) continue;
    const d = dist(h.tile);
    if (d >= HORDE_HEAR) continue;
    const sz = Math.max(0, h.size || 0);
    const v = clamp01(hordeSizeLevel(sz) * hordeDistLevel(d) * (0.8 + 0.3 * night));
    quiet *= 1 - v;
    if (v > best) { best = v; big = hordeSizeLevel(sz); }
    near = Math.min(near, d); size += sz; count++;
  }
  let hive = 0;
  for (const hv of state.hives || []) {
    const known = state.live.has(hv.tile) ? !!(state.tiles[hv.tile] || {}).hive : !!(state.knowledge && state.knowledge[hv.tile] && state.knowledge[hv.tile].hive);
    if (!known) continue;
    const d = dist(hv.tile);
    if (d > HIVE_HEAR) continue;
    hive = Math.max(hive, (1 - d / (HIVE_HEAR + 1)) * (hv.bossReady ? 1 : 0.75));
  }
  return { horde: r2(1 - quiet), hive: r2(hive), near, size, big: r2(big), night, close: near < HORDE_HEAR ? r2(hordeDistLevel(near)) : 0, count };
}
// How loud (under the ambience slider, and the horde under its own Map horde volume) at level 1. The horde is meant to
// be heard plainly over the wind when it is near; the hive stays a low presence.
export const MAP_LEVELS = { horde: 1.75, hive: 0.1, beat: 0.28 };
export const MAP_HORDE_OLD = 0.22; // the level before the hordes were made louder (for the comparison in the report)
// The map layer: the dense murmur slowed and band-passed far off, gusting on the wind and panned by it, swelling now
// and then, through a soft limiter (several hordes never clip); the hive's drone (two low sines beating, brown noise)
// and its heartbeat. About 24 nodes while heard; let go after 5 s of silence.
export const MAP_TRIM = 0.617; // × after the map's limiter: undoes the browser's make-up gain (measured)
export function makeMapLayer(c, out, t = c.currentTime, o = {}) {
  const B = crowdBuffers(c);
  let lim = out;
  if (c.createDynamicsCompressor && o.limiter !== false) {
    lim = c.createDynamicsCompressor();
    lim.threshold.value = -10; lim.knee.value = 6; lim.ratio.value = 10; lim.attack.value = 0.01; lim.release.value = 0.4;
    lim.connect(gainN(c, MAP_TRIM, out));
  }
  const level = gainN(c, 0, lim);
  const swell = gainN(c, 0.15, level);
  const gust = gainN(c, 0.75, swell);
  lfo(c, 0.11, 0.3, gust.gain, t, 1e5);
  let pan = gust;
  if (c.createStereoPanner) { pan = c.createStereoPanner(); pan.connect(gust); lfo(c, 0.035, 0.45, pan.pan, t, 1e5); }
  const lp = biq(c, "lowpass", 700, 0.6, pan);
  const bp = biq(c, "bandpass", 420, 0.6, lp);
  const s = c.createBufferSource();
  s.buffer = B.dense; s.loop = true; s.playbackRate.value = 0.82;
  s.connect(bp); s.start(t, 1.3);
  const hiveOut = gainN(c, 1, out); // the Hive drone group (its drone and heartbeat)
  const hiveG = gainN(c, 0, hiveOut);
  const breathe = gainN(c, 0.7, hiveG); // the drone breathes (0.4–1 of its level)
  const dlp = biq(c, "lowpass", 140, 0.7, breathe);
  const o1 = osc(c, "sine", 41, t, 1e5, gainN(c, 0.5, dlp)), o2 = osc(c, "sine", 43.7, t, 1e5, gainN(c, 0.4, dlp));
  const nz = c.createBufferSource();
  nz.buffer = noiseBufs(c).brown; nz.loop = true; nz.connect(gainN(c, 0.6, dlp)); nz.start(t);
  lfo(c, 0.17, 0.3, breathe.gain, t, 1e5);
  const sources = [s, o1, o2, nz];
  const rnd = mulberry(0xbeef);
  return {
    nodes: 22, idleSince: null, nextSwell: t + 1 + rnd() * 2, swellEnd: 0, nextBeat: t + 0.5, lv: null, beats: 0, swells: 0,
    update(lv, now, vol = 1, hiveVol = 1) {
      this.lv = lv;
      hiveOut.gain.setTargetAtTime(hiveVol, now, 0.06);
      this.level = lv.horde * MAP_LEVELS.horde * vol;
      level.gain.setTargetAtTime(this.level, now, 1.5);
      lp.frequency.setTargetAtTime(350 + 800 * lv.close + 500 * lv.night + 600 * (lv.big || 0), now, 2);
      hiveG.gain.setTargetAtTime(lv.hive * MAP_LEVELS.hive, now, 2);
      const base = 0.35 + 0.3 * lv.night * lv.horde; // between the swells it never quite goes away
      if (lv.horde > 0.02 && now >= this.nextSwell) { // a gust brings the moaning in, then it falls back
        const att = 1.5 + rnd() * 1.5, hold = 1 + rnd() * 2, rel = 3 + rnd() * 2;
        swell.gain.setTargetAtTime(1, now, att / 3);
        swell.gain.setTargetAtTime(base, now + att + hold, rel / 3);
        this.swellEnd = now + att + hold + rel;
        this.nextSwell = this.swellEnd + (4 + rnd() * 10) / (0.6 + lv.horde);
        this.swells++;
      } else if (now > this.swellEnd) swell.gain.setTargetAtTime(base, now, 1);
      if (lv.hive > 0.05) { // the heartbeat: lub-dub
        if (this.nextBeat < now) this.nextBeat = now + 0.05;
        while (this.nextBeat < now + 0.6) {
          const bt = this.nextBeat, pk = lv.hive * MAP_LEVELS.beat;
          beat(c, hiveOut, bt, 52, pk, rnd);
          beat(c, hiveOut, bt + 0.24, 44, pk * 0.7, rnd);
          this.beats++;
          this.nextBeat += 1.35 - 0.25 * lv.hive;
        }
      }
      this.idleSince = lv.horde > 0 || lv.hive > 0 ? null : this.idleSince ?? now;
    },
    stop(now) { for (const x of sources) { try { x.stop(now + 0.05); } catch { /* already stopped */ } } },
  };
}
function beat(c, out, t, f, peak, rnd) {
  osc(c, "sine", f, t, 0.3, envG(c, out, t, peak, 0.012, 0, 0.22)).frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.2);
  noise(c, "brown", t, 0.2, biq(c, "lowpass", 160, 0.8, envG(c, out, t, peak * 0.5, 0.01, 0, 0.16)), rnd);
}
const MAPS = new WeakMap();
// ui/audio.js every ambience tick on the map: lv from hordeAmbience (null: nothing, e.g. in a battle or on the title);
// vol: the Map hordes group's gain (× the horde's level; 1 at the default); hiveVol: the Hive drone group's.
export function zombieMapAmbience(c, out, lv, t = c.currentTime, vol = 1, hiveVol = 1) {
  let L = lv || { horde: 0, hive: 0, near: 99, size: 0, big: 0, night: 0, close: 0 };
  const d = DEMO.map;
  if (d && t < d.until) L = { horde: d.hiveOnly ? 0 : 0.9, hive: d.hive ? 0.8 : 0, near: 2, size: 150, big: 0.85, night: 1, close: 0.9 };
  else if (d) DEMO.map = null;
  let m = MAPS.get(c);
  if (!m) {
    if (!(L.horde > 0) && !(L.hive > 0)) return null;
    m = makeMapLayer(c, out, t);
    MAPS.set(c, m);
  }
  m.update(L, t, vol, hiveVol);
  if (m.idleSince != null && t - m.idleSince > 5) { m.stop(t); MAPS.delete(c); return null; }
  return m;
}
// Distant moans under the map's horde sting (ui/audio.js VOICES.horde).
export function hordeChorus(c, out, t, o = {}) {
  const rnd = mulberry(Number.isFinite(o.seed) ? o.seed >>> 0 : (Math.random() * 4294967296) >>> 0);
  const lp = biq(c, "lowpass", 900, 0.7, out);
  for (let i = 0; i < 4; i++) {
    const at2 = t + 0.15 + i * 0.28 + rnd() * 0.15, f0 = 62 + rnd() * 40, d = 1.3 + rnd() * 0.6;
    vocal(c, lp, at2, { f0, dur: d, contour: [[0.3, 1.08], [1, 0.75]], vowels: [VW.uh, VW.aa, VW.oh], form: [0.9 + rnd() * 0.2, 0.9 + rnd() * 0.2, 1], shift: 0.95,
      rasp: 0.6, drive: 2, jitter: 0.04, fry: 0.3, a: d * 0.35, hold: d * 0.2, rel: d * 0.45, peak: 0.11 * (Number.isFinite(o.gain) ? o.gain : 1), breath: 0.1, lp: 900 }, rnd);
  }
}

// ---------- the Options tab: Zombie sounds ----------
const KIND_LABEL = {
  walker: "Walker", armoured: "Armoured dead", runner: "Runner", brute: "Brute", spitter: "Spitter", screamer: "Screamer", crawler: "Crawler",
  carrier: "Carrier", swarm: "Worm swarm", shepherd: "Shepherd", boneback: "Boneback", climber: "Climber", flinger: "Flinger", sower: "Sower",
  nightmare: "Nightmare", sleeper: "Sleeper", wallbreaker: "Wallbreaker", broodmother: "Broodmother",
};
const EVENT_LABEL = {
  idle: "at rest", aggro: "notices you", attack: "lunges", bite: "bites someone", hurt: "is hit", death: "dies", step: "walks",
  smash: "smashes a barricade", bash: "pounds on a door", spit: "spits acid", sizzle: "acid sizzling", shriek: "shrieks", strike: "strikes from hiding",
  burst: "bursts", worms: "worms pour out", snarl: "snarls out of a silence", heave: "winds up", fling: "throws worms", climb: "climbs a wall", wake: "wakes",
};
const EXTRA = { // each kind's own sounds in the list (besides the core events)
  spitter: ["spit", "sizzle"], screamer: ["shriek"], crawler: ["strike"], carrier: ["burst"], climber: ["climb"],
  flinger: ["heave", "fling"], nightmare: ["shriek"], sleeper: ["wake"], wallbreaker: ["smash"], walker: ["snarl", "wake", "bash"], runner: ["snarl"], brute: ["smash", "snarl"],
};
export const ZOMBIE_TESTS = [
  ...Object.keys(KIND_LABEL).map((k) => ({
    label: KIND_LABEL[k],
    items: [...CORE_EVENTS, ...(EXTRA[k] || [])].filter((ev) => recipeFor(k, ev, () => 0) !== "silent" && (ev !== "step" || ZOMBIE_STEPS.on || OWN_STEP.has(k))).map((ev) => [`${k}:${ev}`, `${KIND_LABEL[k]} ${EVENT_LABEL[ev]}`]),
  })),
  { label: "Crowds and the map", items: [["demo:crowd", "A horde closing in (crowd, 12 s)"], ["demo:map", "Horde on the wind and a hive heartbeat (map, 12 s)"], ["brute:smash:metal", "Brute smashes a gate (metal)"], ["wallbreaker:smash:wall", "Wallbreaker breaks a wall"]] },
];
let zPick = "screamer:shriek";
export function zombieTestHtml(esc = (s) => s) {
  const opts = ZOMBIE_TESTS.map((g) => `<optgroup label="${esc(g.label)}">${g.items.map(([v, l]) => `<option value="${v}" ${v === zPick ? "selected" : ""}>${esc(l)}</option>`).join("")}</optgroup>`).join("");
  return `<div class="setrow"><label data-tip="Hear one of the dead. Each play is a different zombie: every one has a voice of its own.">Zombie sounds <select data-action="zsnd-pick">${opts}</select></label>
      <button data-action="zsnd-test" data-tip="Play the zombie sound picked (a new voice each time)">▶ Play</button></div>`;
}
// A few seconds of a near horde on the map (the Map horde volume slider, as it is dragged).
export const demoMapHorde = (t, secs = 5) => { DEMO.map = { from: t, until: t + secs, hive: false }; };
export const demoMapHive = (t, secs = 5) => { DEMO.map = { from: t, until: t + secs, hive: true, hiveOnly: true }; }; // the mixer's Hive drone preview
export const demoCrowd = (t, secs = 6) => { DEMO.crowd = { from: t, until: t + secs }; }; // the mixer's Crowd murmur preview
export const zombiePick = (v) => { if (v != null && ZOMBIE_TESTS.some((g) => g.items.some(([x]) => x === v))) zPick = v; return zPick; };
// Plays the picked test: play(name, opts) is ui/audio.js sfx; t: the context's time (for the demos).
export function playZombieTest(value, play, t = 0) {
  const v = zombiePick(value);
  if (v === "demo:crowd") { DEMO.crowd = { from: t, until: t + 12 }; return true; }
  if (v === "demo:map") { DEMO.map = { from: t, until: t + 12, hive: true }; return true; }
  const [kind, ev, mat] = v.split(":");
  return play(EVENT_CUE[ev], { kind, seed: (Math.random() * 4294967296) >>> 0, pitch: 1, human: true, mat: mat || "wood", steps: 4, hidden: kind === "crawler" && ev === "idle" });
}
