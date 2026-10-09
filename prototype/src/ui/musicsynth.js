// The music's instruments, rendered in plain JS into sample arrays once and played back as buffers (one source node a
// drum hit or bass note, a source and a gain for a melodic note): the CPU stays low however busy the music gets.
// Built on gun-sfx's DSP kit (ui/sfxdsp.js: the biquad, seeded noise, struck metal, the reverb impulse).
//
//   bakeVoice(inst, midi, sr, vel)   one note or hit of an instrument: { data: Float32Array, loop: [start, end] | null }
//   makeBank(ctx)                    the buffers on a context, baked on first use (pitched ones every 3 semitones,
//                                    played at the nearest with a playback rate); bank.get(inst, midi, vel)
//   makeHiss(sr) / makeMusicIR(sr)   the tape's hiss loop, the music's room
//
// Instruments: guitar and banjo (Karplus-Strong plucked strings), muted (a palm-muted pluck), epiano (two-operator FM
// with a tine), bell (inharmonic FM), pad (three detuned saws, a seamless loop), stab (a short brassy saw chord tone),
// bassShort / bassLong (a sub with a touch of second harmonic so small speakers hear it), and the kit: kick, snare,
// hatC, hatO, tomL, tomM, heart, shaker, anvil (struck metal), boom (a low impact), swell (a rising noise wash).
import { Filt, rngOf, hashStr, metalLayer, noiseLayer, toneLayer, makeIR } from "./sfxdsp.js";
import { midiHz } from "./musicscore.js";

const TAU = Math.PI * 2;
export const PITCHED = new Set(["guitar", "banjo", "muted", "epiano", "bell", "pad", "stab", "bassShort", "bassLong"]);
export const GAINED = new Set(["guitar", "banjo", "epiano", "bell", "pad", "swell"]); // played through a gain of their own (velocity, a release); the rest are baked at three velocities
export const STEP = 3; // pitched instruments are baked every 3 semitones (played within ±1.5 at a rate)
export const PITCH_RATE = 32000; // pitched instruments are baked at this rate (plenty for a worn, tape-like sound)
export const LOW_RATE = 16000;   // the pads (low-passed live anyway), the bass and the low drums: half that
const LOW = new Set(["pad", "bassShort", "bassLong", "kick", "heart", "tomL", "tomM", "boom"]);
// The rate an instrument is baked at on a context of rate sr: low ones at LOW_RATE, pitched at PITCH_RATE, the bright kit (hats, snare, shaker, anvil, swell) at the context's.
export const bakeRate = (inst, sr) => Math.min(sr, LOW.has(inst) ? LOW_RATE : PITCHED.has(inst) ? PITCH_RATE : sr);
const VEL_LEVELS = [0.45, 0.72, 1];
export const velLevel = (v) => (v < 0.58 ? 0 : v < 0.86 ? 1 : 2);

function normalise(a, peak = 0.9) {
  let pk = 0;
  for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > pk) pk = v; }
  if (pk > 0) { const k = peak / pk; for (let i = 0; i < a.length; i++) a[i] *= k; }
  return a;
}
function fadeOut(a, sr, secs = 0.05) {
  const n = Math.min(a.length, Math.round(secs * sr));
  for (let i = 0; i < n; i++) a[a.length - 1 - i] *= i / n;
  return a;
}

// ---------- plucked strings (Karplus-Strong) ----------
// A delay line one period long filled with a burst of filtered noise (picked at a point along the string), fed back
// through a gentle low-pass with a loss tuned to the ring time, and an all-pass for the fractional period.
function pluck(sr, f, o, seed) {
  const r = rngOf(seed);
  const dur = o.dur, n = Math.round(dur * sr), out = new Float32Array(n);
  const P = sr / f, N = Math.max(2, Math.floor(P - 0.5 - 1e-3)), d = P - 0.5 - N, C = (1 - d) / (1 + d);
  const dl = new Float32Array(N);
  let lp = 0;
  const a = 0.15 + o.bright * 0.8;
  for (let i = 0; i < N; i++) { lp += a * ((r() * 2 - 1) - lp); dl[i] = lp; }
  const pk = Math.max(1, Math.round(N * o.pick)), ex = dl.slice();
  for (let i = 0; i < N; i++) dl[i] = ex[i] - 0.85 * ex[(i - pk + N) % N];
  const t60 = o.decay * Math.pow(220 / f, 0.35);
  const g = Math.pow(10, -3 / (t60 * f));
  const s = o.damp; // 0.5: the classic average; lower keeps more highs
  let prev = 0, apx = 0, apy = 0, w = 0;
  for (let i = 0; i < n; i++) {
    const x = dl[w];
    out[i] = x;
    const l = g * ((1 - s) * x + s * prev); prev = x;
    const y = C * l + apx - C * apy; apx = l; apy = y;
    dl[w] = y; w = (w + 1) % N;
  }
  // The body: a low and a mid resonance (a guitar's box; a banjo's bright head).
  if (o.body) {
    const b1 = new Filt("peaking", o.body[0], 1.2, sr, o.body[1]), b2 = new Filt("peaking", o.body[2], 1.4, sr, o.body[3]);
    const hp = new Filt("highpass", 70, 0.7, sr);
    for (let i = 0; i < n; i++) out[i] = hp.run(b2.run(b1.run(out[i])));
  }
  if (o.mute) { for (let i = 0; i < n; i++) out[i] *= Math.exp(-i / (o.mute * sr)); }
  for (let i = 0; i < Math.min(n, 24); i++) out[i] *= i / 24; // no click at the pick
  return fadeOut(normalise(out), sr, 0.08);
}

// ---------- FM keys ----------
// The electric piano: a sine carrier modulated by a sine at the same frequency (the body, its index falling as the note
// dies) and a brief high modulator (the tine's ping). The bell: an inharmonic ratio and a long ring.
function fm(sr, f, o) {
  const n = Math.round(o.dur * sr), out = new Float32Array(n);
  let pc = 0, pm = 0, pt = 0;
  const tauA = o.tau * Math.pow(220 / f, 0.3);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const idx = o.i0 * Math.exp(-t / o.iTau) + o.i1;
    pm += (f * o.ratio) / sr; pt += (f * o.tine) / sr;
    const mod = Math.sin(TAU * pm) * idx + (o.tineI ? Math.sin(TAU * pt) * o.tineI * Math.exp(-t / 0.012) : 0);
    pc += f / sr;
    const env = Math.min(1, t / o.att) * Math.exp(-t / tauA);
    out[i] = Math.sin(TAU * pc + mod) * env + (o.partial ? Math.sin(TAU * pc * o.partial[0]) * o.partial[1] * Math.exp(-t / (tauA * 0.5)) : 0) * Math.min(1, t / o.att);
  }
  if (o.lp) { const F = new Filt("lowpass", o.lp, 0.7, sr); for (let i = 0; i < n; i++) out[i] = F.run(out[i]); }
  return fadeOut(normalise(out), sr, 0.1);
}

// ---------- the pad: detuned saws, looped seamlessly ----------
const blep = (t, dt) => (t < dt ? (t /= dt, t + t - t * t - 1) : t > 1 - dt ? (t = (t - 1) / dt, t * t + t + t + 1) : 0);
function saws(sr, f, n, detunes, seed) {
  const r = rngOf(seed), out = new Float32Array(n);
  for (const c of detunes) {
    const ff = f * Math.pow(2, c / 1200), dt = ff / sr;
    let ph = r();
    for (let i = 0; i < n; i++) { out[i] += (2 * ph - 1 - blep(ph, dt)) / detunes.length; ph += dt; if (ph >= 1) ph -= 1; }
  }
  return out;
}
function pad(sr, f, seed) {
  const LOOP = 4, X = 0.6, n = Math.round((LOOP + X) * sr), L = Math.round(LOOP * sr), x = Math.round(X * sr);
  const raw = saws(sr, f, n, [-9, -2, 6, 13], seed);
  // a soft sub an octave under the lowest pads, a low-pass that softens the fizz (the live filter does the movement)
  const lp = new Filt("lowpass", Math.min(5200, f * 14), 0.6, sr), lp2 = new Filt("lowpass", Math.min(5200, f * 14), 0.6, sr);
  let sp = 0;
  for (let i = 0; i < n; i++) { sp += f * 0.5 / sr; raw[i] = lp2.run(lp.run(raw[i])) + (f < 130 ? Math.sin(TAU * sp) * 0.25 : 0); }
  const out = new Float32Array(L);
  for (let i = 0; i < L; i++) out[i] = raw[i];
  for (let i = 0; i < x; i++) { const k = i / x; out[i] = raw[i] * Math.sqrt(k) + raw[L + i] * Math.sqrt(1 - k); } // the tail folded into the head: the loop has no seam
  return normalise(out, 0.8);
}
function stab(sr, f, vel, seed) {
  const n = Math.round(0.3 * sr), raw = saws(sr, f, n, [-8, 0, 7], seed);
  const F = new Filt("lowpass", 3200, 0.9, sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if ((i & 31) === 0) F.set(600 + (1500 + 2600 * vel) * Math.exp(-t / 0.07));
    raw[i] = F.run(raw[i]) * Math.min(1, t / 0.004) * Math.exp(-t / 0.09);
  }
  return fadeOut(normalise(raw, 0.9 * VEL_LEVELS[velLevel(vel)]), sr, 0.04);
}
function bass(sr, f, long) {
  const dur = long ? 2.8 : 0.2, n = Math.round(dur * sr), out = new Float32Array(n);
  let p = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    p += f / sr;
    const x = Math.sin(TAU * p) + 0.3 * Math.sin(TAU * 2 * p) + 0.08 * Math.sin(TAU * 3 * p);
    const env = Math.min(1, t / (long ? 0.02 : 0.004)) * (long ? Math.exp(-t / 1.4) : Math.exp(-t / 0.09));
    out[i] = Math.tanh(x * 1.3) * env;
  }
  return fadeOut(normalise(out, 0.9), sr, long ? 0.2 : 0.03);
}

// ---------- the kit ----------
function drum(inst, sr, vel, seed) {
  const r = rngOf(seed), v = VEL_LEVELS[velLevel(vel)], soft = 1 - v; // softer hits are darker as well as quieter
  const buf = (secs) => new Float32Array(Math.round(secs * sr));
  let a;
  switch (inst) {
    case "kick": a = buf(0.36);
      toneLayer(a, sr, { f0: 150, f1: 46, glide: 0.07, dur: 0.36, amp: 1, a: 0.001, tau: 0.13, drive: 1.4 });
      noiseLayer(a, sr, { dur: 0.012, amp: 0.25 * (1 - soft), a: 0.0005, tau: 0.003, rnd: r, filters: [{ type: "highpass", f: 2500 }] });
      break;
    case "heart": a = buf(0.3);
      toneLayer(a, sr, { f0: 70, f1: 42, glide: 0.06, dur: 0.3, amp: 1, a: 0.006, tau: 0.08 });
      break;
    case "snare": a = buf(0.32);
      noiseLayer(a, sr, { dur: 0.32, amp: 0.8, a: 0.001, tau: 0.075, rnd: r, filters: [{ type: "bandpass", f: 1800 - soft * 600, q: 0.7 }] });
      toneLayer(a, sr, { f0: 200, f1: 170, dur: 0.12, amp: 0.55, a: 0.001, tau: 0.04 });
      noiseLayer(a, sr, { dur: 0.2, amp: 0.4 * (1 - soft * 0.6), a: 0.001, tau: 0.05, rnd: r, filters: [{ type: "highpass", f: 5000 }] });
      break;
    case "hatC": a = buf(0.07);
      noiseLayer(a, sr, { dur: 0.07, amp: 1, a: 0.0005, tau: 0.018, rnd: r, filters: [{ type: "highpass", f: 7000 - soft * 1500 }, { type: "peaking", f: 10000, q: 1, db: 4 }] });
      break;
    case "hatO": a = buf(0.42);
      noiseLayer(a, sr, { dur: 0.42, amp: 1, a: 0.001, tau: 0.13, rnd: r, filters: [{ type: "highpass", f: 6500 }, { type: "peaking", f: 9000, q: 1, db: 4 }] });
      break;
    case "tomL": case "tomM": { const f = inst === "tomL" ? 92 : 128; a = buf(0.6);
      toneLayer(a, sr, { f0: f * 1.35, f1: f, glide: 0.06, dur: 0.6, amp: 1, a: 0.001, tau: 0.2, drive: 1.2 });
      noiseLayer(a, sr, { dur: 0.08, amp: 0.3, a: 0.001, tau: 0.02, rnd: r, filters: [{ type: "lowpass", f: 900 }] });
      break; }
    case "shaker": a = buf(0.1);
      noiseLayer(a, sr, { dur: 0.1, amp: 1, a: 0.012, tau: 0.03, rnd: r, filters: [{ type: "bandpass", f: 6000, q: 1.2 }] });
      break;
    case "anvil": a = buf(1.1);
      metalLayer(a, sr, { amp: 1, rnd: r, tick: 0.5, tickF: 3000, lp: 7000, modes: [[540, 0.45, 1], [1385, 0.3, 0.65], [2210, 0.22, 0.5], [3460, 0.14, 0.32], [4820, 0.08, 0.2]] });
      toneLayer(a, sr, { f0: 90, f1: 55, dur: 0.4, amp: 0.5, a: 0.001, tau: 0.12 }); // the weight behind it
      break;
    case "boom": a = buf(2.2);
      toneLayer(a, sr, { f0: 62, f1: 30, glide: 1.2, dur: 2.2, amp: 1, a: 0.003, tau: 0.6, drive: 1.3 });
      noiseLayer(a, sr, { dur: 2.2, amp: 0.45, color: "brown", a: 0.005, tau: 0.5, rnd: r, filters: [{ type: "lowpass", f: 300, to: 80, sweep: 1.5 }] });
      break;
    case "swell": { a = buf(2.6); // rising noise, a reversed cymbal's shape, cut at the end (the beat it leads to)
      const n = a.length, F = new Filt("lowpass", 300, 0.8, sr), H = new Filt("highpass", 200, 0.7, sr);
      for (let i = 0; i < n; i++) { const t = i / n; if ((i & 31) === 0) F.set(300 * Math.pow(20, t)); a[i] = H.run(F.run(r() * 2 - 1)) * Math.pow(t, 2.6); }
      for (let i = 0; i < Math.round(0.01 * sr); i++) a[n - 1 - i] *= i / (0.01 * sr);
      break; }
    default: a = buf(0.1);
  }
  return normalise(a, 0.9 * (inst === "swell" ? 1 : v));
}

// ---------- one voice ----------
// inst at midi (pitched) or velocity (the kit, the stabs): { data, loop }. sr: the rate it is rendered at.
export function bakeVoice(inst, midi, sr, vel = 1) {
  const f = midiHz(midi), seed = hashStr(`${inst}:${midi}:${velLevel(vel)}`);
  switch (inst) {
    case "guitar": return { data: pluck(sr, f, { dur: 2.6, bright: 0.45, pick: 0.17, decay: 2.4, damp: 0.5, body: [190, 5, 1400, 2.5] }, seed), loop: null };
    case "banjo": return { data: pluck(sr, f, { dur: 1.4, bright: 0.85, pick: 0.09, decay: 0.9, damp: 0.38, body: [420, 3, 2300, 6] }, seed), loop: null };
    case "muted": return { data: pluck(sr, f, { dur: 0.5, bright: 0.35, pick: 0.2, decay: 1.2, damp: 0.6, body: [160, 6, 1100, 2], mute: 0.07 }, seed), loop: null };
    case "epiano": return { data: fm(sr, f, { dur: 3, att: 0.003, tau: 0.9, ratio: 1, i0: 1.6, iTau: 0.35, i1: 0.25, tine: 14, tineI: 0.9, partial: [2, 0.15], lp: 6000 }), loop: null };
    case "bell": return { data: fm(sr, f, { dur: 4.5, att: 0.002, tau: 1.6, ratio: 3.5, i0: 2.2, iTau: 0.9, i1: 0.15, tine: 0, tineI: 0, partial: [2.76, 0.2], lp: 7000 }), loop: null };
    case "pad": { const d = pad(sr, f, seed); return { data: d, loop: [0, d.length / sr] }; }
    case "stab": return { data: stab(sr, f, vel, seed), loop: null };
    case "bassShort": return { data: bass(sr, f, false), loop: null };
    case "bassLong": return { data: bass(sr, f, true), loop: null };
    default: return { data: drum(inst, sr, vel, seed), loop: null };
  }
}
// The tape's hiss: a soft pink-ish band with a few faint crackles, looped (secs long).
export function makeHiss(sr, secs = 3) {
  const n = Math.round(secs * sr), a = new Float32Array(n), r = rngOf(4242);
  noiseLayer(a, sr, { dur: secs, amp: 1, color: "pink", a: 0.001, hold: secs, tau: 0, rnd: r, filters: [{ type: "highpass", f: 1800 }, { type: "lowpass", f: 8500 }] });
  for (let k = 0; k < 9; k++) { const at = Math.floor(r() * (n - 40)); for (let i = 0; i < 30; i++) a[at + i] += (r() * 2 - 1) * 1.6 * Math.exp(-i / 5); }
  const x = Math.round(0.2 * sr); // seamless
  for (let i = 0; i < x; i++) { const k = i / x; a[i] = a[i] * k + a[n - x + i] * (1 - k); }
  return normalise(a.subarray(0, n - x), 0.9);
}
// The music's room: a soft hall, darker as it dies (ui/sfxdsp.js makeIR).
export const makeMusicIR = (sr) => makeIR(sr, { len: 3.4, pre: 0.025, rt: 3, lp: 4200, lpEnd: 900, early: [[0.031, 0.35], [0.067, 0.25], [0.11, 0.18]] }, 909);

// ---------- the bank on a context ----------
// Buffers baked on first use; pitched instruments every STEP semitones at PITCH_RATE, the kit and the stabs at three
// velocities at the context's rate. get(inst, midi, vel) -> { buf, rate, loop }. Baking costs a few milliseconds a
// voice; bank.warm(list, budgetMs) bakes ahead of need (ui/music.js warms a state's instruments before it plays).
export function makeBank(ctx) {
  const cache = new Map();
  const stats = { baked: 0, ms: 0, bytes: 0 };
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const anchor = (midi) => Math.round(midi / STEP) * STEP;
  const keyOf = (inst, midi, vel) => (PITCHED.has(inst) ? `${inst}:${anchor(midi)}${inst === "stab" ? `:${velLevel(vel)}` : ""}` : `${inst}:${velLevel(vel)}`);
  function bake(inst, midi, vel) {
    const k = keyOf(inst, midi, vel);
    let e = cache.get(k);
    if (e) return e;
    const t0 = now();
    const pitched = PITCHED.has(inst);
    const sr = bakeRate(inst, ctx.sampleRate);
    const m = pitched ? anchor(midi) : 60;
    const v = bakeVoice(inst, m, sr, vel);
    const buf = ctx.createBuffer(1, v.data.length, sr);
    if (buf.copyToChannel) buf.copyToChannel(v.data, 0); else buf.getChannelData(0).set(v.data);
    e = { buf, midi: m, loop: v.loop, secs: v.data.length / sr };
    cache.set(k, e);
    stats.baked++; stats.ms += now() - t0; stats.bytes += v.data.length * 4;
    return e;
  }
  return {
    stats,
    has: (inst, midi, vel = 1) => cache.has(keyOf(inst, midi, vel)),
    get(inst, midi, vel = 1) {
      const e = bake(inst, midi, vel);
      return { buf: e.buf, rate: PITCHED.has(inst) ? Math.pow(2, (midi - e.midi) / 12) : 1, loop: e.loop, secs: e.secs };
    },
    // Bake what is missing from list [[inst, midi, vel]] until budgetMs is spent; returns how many are left.
    warm(list, budgetMs = 4) {
      const t0 = now();
      let left = 0;
      for (const [inst, midi, vel] of list) {
        if (cache.has(keyOf(inst, midi, vel ?? 1))) continue;
        if (now() - t0 > budgetMs) { left++; continue; }
        bake(inst, midi, vel ?? 1);
      }
      return left;
    },
  };
}
