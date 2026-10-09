// A tiny sound-design kit in plain JS (no WebAudio): the gun, blast and handling sounds (ui/gunsfx.js, ui/blastsfx.js)
// are rendered once into sample arrays from these layers, then played as buffers (two or three nodes a shot instead
// of a dozen live filters). Everything is seeded, so a voice renders the same each time; nothing touches the game.
//
//   rngOf(seed)                 a seeded 0–1 generator (mulberry32)
//   Filt                        an RBJ biquad (lowpass, highpass, bandpass, peaking), retunable per sample block
//   noiseLayer / toneLayer      filtered noise and gliding sines with an attack and an exponential decay
//   metalLayer                  a struck piece of metal: damped inharmonic modes plus a tick of noise (clicks, clacks)
//   nwave                       a bullet's supersonic snap (an N-shaped pressure wave and its ground reflection)
//   shape                       a tanh waveshaper over a stretch (punch, saturation)
//   rollTail                    a rolling outdoor echo: low noise with a slow random swell and discrete reflections
//   makeIR                      a stereo reverb impulse (decaying noise, early reflections, darker as it dies)
//   stats                       peak, RMS, clipping, spectral centroid, length above −60 dB (for the tests and previews)
// Amplitudes: each layer is rendered on its own, normalised to a peak of 1, then mixed in at its amp.

export function rngOf(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

// ---------- filters ----------
export class Filt {
  constructor(type, f, q = 0.707, sr = 48000, db = 0) { this.type = type; this.sr = sr; this.db = db; this.z1 = 0; this.z2 = 0; this.set(f, q); }
  set(f, q = this.q) {
    this.f = f; this.q = q;
    const w = 2 * Math.PI * Math.max(10, Math.min(f, this.sr * 0.45)) / this.sr, cs = Math.cos(w), al = Math.sin(w) / (2 * Math.max(0.05, q));
    let b0, b1, b2, a0, a1, a2;
    if (this.type === "highpass") { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else if (this.type === "bandpass") { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else if (this.type === "peaking") { const A = Math.pow(10, this.db / 40); b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; }
    else { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  run(x) { const y = this.b0 * x + this.z1; this.z1 = this.b1 * x - this.a1 * y + this.z2; this.z2 = this.b2 * x - this.a2 * y; return y; }
}
// A filter over a whole array (in place).
export function filterAll(a, type, f, q = 0.707, sr = 48000) { const F = new Filt(type, f, q, sr); for (let i = 0; i < a.length; i++) a[i] = F.run(a[i]); return a; }

// ---------- sources ----------
function noiseGen(color, r) {
  if (color === "brown") { let l = 0; return () => { l = (l + 0.02 * (r() * 2 - 1)) / 1.02; return l * 3.5; }; }
  if (color === "pink") { let b0 = 0, b1 = 0, b2 = 0; return () => { const w = r() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; return (b0 + b1 + b2 + w * 0.1848) * 0.25; }; }
  return () => r() * 2 - 1;
}
// The envelope at t (s): a linear attack, a hold, then an exponential decay with time constant tau (or none).
const envAt = (t, a, hold, tau) => (t < a ? t / a : t < a + hold ? 1 : tau > 0 ? Math.exp(-(t - a - hold) / tau) : 1);
function addNorm(buf, i0, tmp, amp) {
  let pk = 0;
  for (let i = 0; i < tmp.length; i++) { const v = Math.abs(tmp[i]); if (v > pk) pk = v; }
  if (!(pk > 0)) return;
  const k = amp / pk;
  for (let i = 0; i < tmp.length && i0 + i < buf.length; i++) if (i0 + i >= 0) buf[i0 + i] += tmp[i] * k;
}
// Noise: o { start, dur, amp, a (attack s), hold, tau, color, filters: [{ type, f, q, to, sweep }], rnd, am: [rate Hz, depth] }
export function noiseLayer(buf, sr, o) {
  const i0 = Math.round((o.start || 0) * sr), n = Math.max(1, Math.round(o.dur * sr));
  const tmp = new Float32Array(n), gen = noiseGen(o.color || "white", o.rnd || Math.random);
  const fs = (o.filters || []).map((F) => ({ F, f: new Filt(F.type, F.f, F.q ?? 0.707, sr, F.db || 0) }));
  const a = Math.max(1 / sr, o.a ?? 0.001), hold = o.hold || 0, tau = o.tau ?? o.dur / 5;
  let amPh = 0, amV = 1;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if ((i & 31) === 0) for (const { F, f } of fs) if (F.to && F.to !== F.f) f.set(F.f * Math.pow(F.to / F.f, Math.min(1, t / (F.sweep || o.dur))));
    let x = gen();
    for (const { f } of fs) x = f.run(x);
    if (o.am) { amPh += o.am[0] / sr; amV = 1 - o.am[1] * (0.5 + 0.5 * Math.sin(2 * Math.PI * amPh)); }
    tmp[i] = x * envAt(t, a, hold, tau) * amV;
  }
  addNorm(buf, i0, tmp, o.amp);
}
// A sine (or a softened triangle) gliding exponentially from f0 to f1 over glide s. o.drive: tanh saturation.
export function toneLayer(buf, sr, o) {
  const i0 = Math.round((o.start || 0) * sr), n = Math.max(1, Math.round(o.dur * sr));
  const tmp = new Float32Array(n);
  const a = Math.max(1 / sr, o.a ?? 0.002), hold = o.hold || 0, tau = o.tau ?? o.dur / 5, glide = o.glide || o.dur;
  let ph = o.phase || 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = o.f1 && o.f1 !== o.f0 ? o.f0 * Math.pow(o.f1 / o.f0, Math.min(1, t / glide)) : o.f0;
    ph += f / sr;
    let x = Math.sin(2 * Math.PI * ph);
    if (o.drive) x = Math.tanh(x * o.drive);
    tmp[i] = x * envAt(t, a, hold, tau);
  }
  addNorm(buf, i0, tmp, o.amp);
}
// Struck metal: modes [[f, tau, amp]] (damped sines at random phase), plus a short tick of highpassed noise.
export function metalLayer(buf, sr, o) {
  const r = o.rnd || Math.random;
  const longest = Math.max(...o.modes.map((m) => m[1])) * 5;
  const n = Math.max(1, Math.round(Math.min(longest, 0.6) * sr)), i0 = Math.round((o.start || 0) * sr);
  const tmp = new Float32Array(n);
  for (const [f, tau, a] of o.modes) {
    const ph = r() * Math.PI * 2, w = 2 * Math.PI * f * (0.98 + r() * 0.04) / sr, k = Math.exp(-1 / (tau * sr));
    let e = a;
    for (let i = 0; i < n && e > 1e-5; i++) { tmp[i] += Math.sin(ph + w * i) * e; e *= k; }
  }
  if (o.tick) {
    const hp = new Filt("highpass", o.tickF || 2500, 0.7, sr), tn = Math.min(n, Math.round(0.004 * sr));
    const mpk = o.modes.reduce((s, m) => s + m[2], 0);
    for (let i = 0; i < tn; i++) tmp[i] += hp.run(r() * 2 - 1) * o.tick * mpk * Math.exp(-i / (0.0008 * sr));
  }
  if (o.lp) filterAll(tmp, "lowpass", o.lp, 0.7, sr);
  addNorm(buf, i0, tmp, o.amp);
}
// A supersonic snap: an N-wave of len ms (a step up, a straight fall to −1, a step back), a little hiss on it, and
// its ground reflection refl ms later at half.
export function nwave(buf, sr, o) {
  const len = Math.max(2, Math.round((o.len || 0.4) / 1000 * sr)), n = len + Math.round(0.012 * sr);
  const tmp = new Float32Array(n), r = o.rnd || Math.random;
  const put = (at, k) => { for (let i = 0; i < len; i++) tmp[at + i] += k * (1 - 2 * i / (len - 1)); };
  put(0, 1);
  const refl = Math.round(((o.refl ?? 1.6) / 1000) * sr);
  if (refl + len < n) put(refl, 0.45);
  const hp = new Filt("highpass", 3500, 0.7, sr);
  for (let i = 0; i < n; i++) tmp[i] += hp.run(r() * 2 - 1) * 0.25 * Math.exp(-i / (0.0015 * sr));
  filterAll(tmp, "lowpass", Math.min(16000, sr * 0.45), 0.6, sr); // round the corners a touch (no aliasing fizz)
  addNorm(buf, Math.round((o.start || 0) * sr), tmp, o.amp);
}
// tanh drive over [t0, t1) s, keeping the peak where it was.
export function shape(buf, sr, t0, t1, drive) {
  const i0 = Math.max(0, Math.round(t0 * sr)), i1 = Math.min(buf.length, Math.round(t1 * sr));
  let pk = 0;
  for (let i = i0; i < i1; i++) pk = Math.max(pk, Math.abs(buf[i]));
  if (!(pk > 0)) return;
  const k = pk / Math.tanh(drive);
  for (let i = i0; i < i1; i++) buf[i] = Math.tanh((buf[i] / pk) * drive) * k;
}
// A rolling outdoor tail: lowpassed noise that swells in over rise s and dies over len s (−40 dB at len), swaying
// slowly (rolling thunder), plus discrete echoes [[t, amp]] (a wall, a treeline, a hill).
export function rollTail(sr, o) {
  const r = o.rnd || Math.random, n = Math.round((o.len + 0.1) * sr);
  const out = new Float32Array(n), gen = noiseGen(o.color || "brown", r);
  const lp = new Filt("lowpass", o.lp || 900, 0.7, sr), lp2 = new Filt("lowpass", o.lp || 900, 0.7, sr);
  const tau = o.len / 4.6, rise = o.rise || 0.06;
  let sway = 1, target = 1, step = Math.round(0.03 * sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if (i % step === 0) target = 0.45 + r() * 0.85;
    sway += (target - sway) * (1 / step) * 2.5;
    if ((i & 63) === 0) { const f = (o.lp || 900) * Math.pow(o.lpEnd ? o.lpEnd / (o.lp || 900) : 1, Math.min(1, t / o.len)); lp.set(f); lp2.set(f); }
    const e = t < rise ? Math.pow(t / rise, 1.5) : Math.exp(-(t - rise) / tau);
    out[i] = lp2.run(lp.run(gen())) * e * sway;
  }
  let pk = 0;
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(out[i]));
  if (pk > 0) for (let i = 0; i < n; i++) out[i] /= pk;
  for (const [te, ae] of o.echoes || []) {
    noiseLayer(out, sr, { start: te, dur: 0.18, amp: ae, a: 0.004, tau: 0.035, color: "pink", rnd: r, filters: [{ type: "lowpass", f: (o.lp || 900) * 1.6, q: 0.7 }] });
  }
  return out;
}
// A stereo reverb impulse: room { len, pre, rt (s to −60 dB), early: [[t, amp]], lp, lpEnd, width }.
export function makeIR(sr, room, seed = 7) {
  const n = Math.max(1, Math.round(room.len * sr)), L = new Float32Array(n), R = new Float32Array(n);
  const r = rngOf(seed), tau = room.rt / 6.9, pre = Math.round((room.pre || 0) * sr);
  for (const ch of [L, R]) {
    let lpS = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      const f = room.lp * Math.pow((room.lpEnd || room.lp) / room.lp, Math.min(1, t / room.len)); // darker as it dies
      const k = 1 - Math.exp(-2 * Math.PI * f / sr);
      lpS += k * ((r() * 2 - 1) - lpS);
      const e = Math.exp(-t / tau) * Math.min(1, t / 0.004 + 0.1);
      ch[i] = lpS * e * 1.6;
    }
    for (const [te, ae] of room.early || []) {
      const at = pre + Math.round(te * sr * (0.96 + r() * 0.08));
      for (let k = 0; k < 24 && at + k < n; k++) ch[at + k] += (r() * 2 - 1) * ae * Math.exp(-k / 6);
    }
  }
  return [L, R];
}

// ---------- measuring ----------
// Mono or interleaved-free channel data: peak, RMS (whole and loudest 50 ms), samples at or over full scale, spectral
// centroid (Hz, of the loudest 85 ms, by a DFT on 2048 points), length until it stays under −60 dB of its peak.
export function stats(d, sr) {
  let peak = 0, sum = 0, clip = 0, nan = false;
  for (let i = 0; i < d.length; i++) { const v = d[i]; if (Number.isNaN(v)) { nan = true; continue; } const a = Math.abs(v); if (a > peak) peak = a; if (a >= 0.999) clip++; sum += v * v; }
  const win = Math.max(1, Math.round(0.05 * sr));
  let best = 0, acc = 0, at = 0;
  for (let i = 0; i < d.length; i++) { acc += d[i] * d[i]; if (i >= win) acc -= d[i - win] * d[i - win]; if (acc > best) { best = acc; at = i - win + 1; } }
  const thr = peak * 0.001;
  let last = 0;
  for (let i = d.length - 1; i >= 0; i--) if (Math.abs(d[i]) > thr) { last = i; break; }
  // centroid of the loudest stretch
  const N = 2048, s0 = Math.max(0, Math.min(d.length - N, at));
  let num = 0, den = 0;
  for (let k = 1; k < N / 2; k += 2) {
    let re = 0, im = 0;
    const w = 2 * Math.PI * k / N;
    for (let i = 0; i < N && s0 + i < d.length; i++) { const x = d[s0 + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); re += x * Math.cos(w * i); im -= x * Math.sin(w * i); }
    const m = Math.hypot(re, im);
    num += m * (k * sr / N); den += m;
  }
  const db = (x) => (x > 0 ? Math.round(20 * Math.log10(x) * 10) / 10 : -Infinity);
  return {
    peak: Math.round(peak * 1000) / 1000, peakDb: db(peak), rmsDb: db(Math.sqrt(sum / Math.max(1, d.length))), rms50Db: db(Math.sqrt(best / win)),
    clip, nan, centroid: den ? Math.round(num / den) : 0, len: Math.round((last / sr) * 100) / 100,
  };
}
