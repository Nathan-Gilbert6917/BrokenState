// The ambience's engine room (ui/ambweather.js, ui/ambwild.js): two buses, lazily built continuous beds, baked
// one-shot buffers and their playback, a node count. All UI: nothing here reads or changes the game.
//
//   ambEngine(c, dest)          the engine on context c (made once per context, into dest: the ambience bus, or
//                                { weather, wildlife }: the mixer's group buses, ui/soundgroups.js groupBus)
//   E.bus.weather / .wildlife    { in (gain: the group's level, for a mixer), lp (dulling: snow cover, fog, walls) }
//   bakeBuffer(E, key, recipe)  a baked AudioBuffer, or null while it waits for an idle moment (E.sync: at once)
//   setBed(E, name, def, level, t, tau)   a continuous bed: built when it is first heard, let go after BED_IDLE s of
//                                silence (no nodes while unheard)
//   playShot(E, group, buf, t, o)         a one-shot: buffer → [lowpass] → gain → pan → its group's bus
//   busy(E, group, t)            one-shots of a group still ringing at t
// Sounds are baked from code (ui/sfxdsp.js's kit plus the voices here): no audio files.
import { rngOf, Filt } from "./sfxdsp.js";

export const BED_IDLE = 10;      // s of silence before a bed's nodes are let go
export const SHOT_SR = 32000;    // one-shots are baked at this rate (or the context's, if lower)
export const BED_SR = 22050;     // the baked loops (insects, water, the drone)
const ENGINES = new WeakMap();   // context -> engine
export const AMB_OPTS = { sync: false }; // tools and previews bake at once instead of in idle moments

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export { clamp };
export const nyquist = (c) => Math.min(20000, c.sampleRate * 0.45);

// ---------- the engine ----------
export function ambEngine(c, dest) {
  let E = ENGINES.get(c);
  if (E) return E;
  const out = (name) => (dest && dest[name] && typeof dest[name].connect === "function" ? dest[name] : dest);
  const bus = (name) => {
    const lp = c.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = nyquist(c); lp.Q.value = 0.5;
    const g = c.createGain();
    g.gain.value = 1;
    g.connect(lp);
    lp.connect(out(name));
    return { name, in: g, lp, open: true };
  };
  E = {
    c, dest, bus: { weather: bus("weather"), wildlife: bus("wildlife") },
    beds: {}, bufs: new Map(), jobs: [], queued: new Set(), shots: { weather: [], wildlife: [] },
    rnd: rngOf((Math.random() * 4294967296) >>> 0), // never the world's dice
    sync: AMB_OPTS.sync, idleOn: false, noise: null, stats: { bakeMs: 0, baked: 0, shots: 0, dropped: 0 },
    mem: {}, // the frames' own memory (ui/ambweather.js, ui/ambwild.js)
  };
  ENGINES.set(c, E);
  return E;
}
export const engineOf = (c) => ENGINES.get(c) || null;
// Nodes the beds hold now (the buses' four not counted).
export function bedNodes(E) { let n = 0; for (const b of Object.values(E.beds)) if (b.live) n += b.nodes; return n; }

// Dulling: a group's low-pass (Hz; 0 or above the Nyquist: open).
export function setDull(E, group, hz, t, tau = 1.2) {
  const B = E.bus[group], top = nyquist(E.c);
  const f = !(hz > 0) || hz >= top ? top : clamp(hz, 200, top);
  B.lp.frequency.setTargetAtTime(f, t, tau);
}

// ---------- baking ----------
// recipe(sr, rnd) -> Float32Array (mono) or [L, R]. Kept per context. With E.sync, baked at once; else queued for an
// idle moment (one job each) and null until then.
export function bakeBuffer(E, key, recipe, sr = SHOT_SR) {
  const have = E.bufs.get(key);
  if (have) return have;
  if (E.sync) return bakeNow(E, key, recipe, sr);
  if (!E.queued.has(key)) { E.queued.add(key); E.jobs.push(() => bakeNow(E, key, recipe, sr)); idle(E); }
  return null;
}
function bakeNow(E, key, recipe, sr) {
  const c = E.c, rate = Math.min(sr, c.sampleRate);
  const t0 = typeof performance !== "undefined" ? performance.now() : 0;
  let d;
  try { d = recipe(rate, rngOf(hashKey(key))); } catch (e) { console.warn(`Broken State: the ${key} ambience failed`, e); d = new Float32Array(16); }
  const chans = Array.isArray(d) ? d : [d];
  const buf = c.createBuffer(chans.length, chans[0].length, rate);
  for (let i = 0; i < chans.length; i++) {
    if (buf.copyToChannel) buf.copyToChannel(chans[i], i); else buf.getChannelData(i).set(chans[i]);
  }
  E.bufs.set(key, buf);
  E.queued.delete(key);
  E.stats.baked++;
  if (typeof performance !== "undefined") E.stats.bakeMs += performance.now() - t0;
  return buf;
}
const hashKey = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
function idle(E) {
  if (E.idleOn) return;
  E.idleOn = true;
  const later = typeof requestIdleCallback === "function" ? (f) => requestIdleCallback(f, { timeout: 400 }) : (f) => setTimeout(f, 20);
  const next = () => {
    const j = E.jobs.shift();
    if (!j) { E.idleOn = false; return; }
    try { j(); } catch { /* best effort */ }
    later(next);
  };
  later(next);
}

// ---------- noise for the live beds ----------
function noiseBufs(E) {
  if (E.noise) return E.noise;
  const c = E.c, sr = c.sampleRate, r = E.rnd;
  const make = (secs, gen) => { const b = c.createBuffer(1, Math.floor(sr * secs), sr); const d = new Float32Array(b.length); for (let i = 0; i < d.length; i++) d[i] = gen(); if (b.copyToChannel) b.copyToChannel(d, 0); else b.getChannelData(0).set(d); return b; };
  let last = 0, b0 = 0, b1 = 0, b2 = 0;
  E.noise = {
    white: make(2.3, () => r() * 2 - 1),
    brown: make(4.1, () => { last = (last + 0.02 * (r() * 2 - 1)) / 1.02; return last * 3.5; }),
    pink: make(3.7, () => { const w = r() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; return (b0 + b1 + b2 + w * 0.1848) * 0.25; }),
  };
  return E.noise;
}
// A looping source of a noise colour (a random start, so two beds never line up).
export function noiseSource(E, kind, t) {
  const s = E.c.createBufferSource();
  s.buffer = noiseBufs(E)[kind];
  s.loop = true;
  s.start(t, E.rnd() * (s.buffer.duration - 0.1));
  return s;
}
export function loopSource(E, buf, t, rate = 1) {
  const s = E.c.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  if (rate !== 1) s.playbackRate.value = rate;
  s.start(t, E.rnd() * Math.max(0, buf.duration - 0.05));
  return s;
}
export function biquad(c, type, f, q = 0.707) { const n = c.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; }

// ---------- beds ----------
// def: { group, build(E, t) -> { src: [sources], nodes, out (gain node: the bed's level), set?(params, t) } }.
// level: 0–1 × the bed's trim; params go to its set() (filter tones).
export function setBed(E, name, def, level, t, tau = 1.5, params = null) {
  let b = E.beds[name];
  const want = level > 0.0015;
  if (!b) { if (!want) return null; b = E.beds[name] = { live: false, quietSince: t, nodes: 0, level: 0 }; }
  if (want && !b.live) {
    const made = def.build(E, t);
    if (!made) return null; // its loop is still baking
    Object.assign(b, made, { live: true, quietSince: t });
    b.out.gain.setValueAtTime(0.0001, t);
    b.out.connect(E.bus[def.group].in);
  }
  if (!b.live) return b;
  b.out.gain.setTargetAtTime(Math.max(0, level), t, tau);
  b.level = level;
  if (params && b.set) b.set(params, t);
  if (want) b.quietSince = t;
  else if (t - b.quietSince > BED_IDLE) { // let it go
    for (const s of b.src) try { s.stop(t + 0.05); } catch { /* already */ }
    try { b.out.disconnect(); } catch { /* ignore */ }
    b.live = false;
    b.nodes = 0;
  }
  return b;
}

// ---------- one-shots ----------
// o: { gain, pan (-1..1), lp (Hz: 0 open), rate (playback), cut (s: fade out and stop early), dur (s, for busy) }
export function playShot(E, group, buf, t, o = {}) {
  if (!buf) return 0;
  const c = E.c;
  const s = c.createBufferSource();
  s.buffer = buf;
  const rate = o.rate || 1;
  if (rate !== 1) s.playbackRate.value = rate;
  let node = s;
  if (o.lp > 0 && o.lp < Math.min(16000, nyquist(c))) { const f = biquad(c, "lowpass", o.lp, 0.6); node.connect(f); node = f; }
  const g = c.createGain();
  g.gain.value = Math.max(0, o.gain ?? 1);
  node.connect(g); node = g;
  if (o.pan && c.createStereoPanner) {
    const p = c.createStereoPanner();
    p.pan.value = clamp(o.pan, -1, 1);
    if (o.panTo != null && o.panTo !== o.pan) { p.pan.setValueAtTime(clamp(o.pan, -1, 1), t); p.pan.linearRampToValueAtTime(clamp(o.panTo, -1, 1), t + buf.duration / rate); }
    node.connect(p); node = p;
  }
  node.connect(E.bus[group].in);
  const len = buf.duration / rate;
  let end = t + len;
  s.start(t);
  if (o.cut && o.cut < len) {
    g.gain.setValueAtTime(Math.max(0, o.gain ?? 1), t + o.cut * 0.7);
    g.gain.linearRampToValueAtTime(0, t + o.cut);
    end = t + o.cut;
  }
  s.stop(end + 0.05);
  E.shots[group].push(end);
  E.stats.shots++;
  return end;
}
export function busy(E, group, t) {
  const a = E.shots[group];
  for (let i = a.length - 1; i >= 0; i--) if (a[i] <= t) a.splice(i, 1);
  return a.length;
}

// ---------- the synth kit for the recipes ----------
// Envelope at u (0–1 of the note): a raised-cosine attack over a, a raised-cosine release over r (fractions).
export function envU(u, a, r) {
  if (u < a) return 0.5 - 0.5 * Math.cos(Math.PI * u / a);
  if (u > 1 - r) return 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, 1 - u) / r);
  return 1;
}
// One FM note added into buf (or into [L, R] at pan): o { at (s), dur, f(u) → Hz, amp, a, r (envelope fractions),
// ratio, index (FM; indexEnv(u) shapes it), h2, h3 (harmonics), vib: [Hz, depth], am: [Hz, depth], pan, wrap (loop) }
export function fmNote(buf, sr, o) {
  const L = Array.isArray(buf) ? buf[0] : buf, R = Array.isArray(buf) ? buf[1] : null, N = L.length;
  const i0 = Math.round(o.at * sr), n = Math.max(2, Math.round(o.dur * sr));
  const pan = o.pan || 0, gl = R ? Math.cos((pan + 1) * Math.PI / 4) : 1, gr = R ? Math.sin((pan + 1) * Math.PI / 4) : 0;
  let pc = o.phase || 0, pm = 0;
  const ratio = o.ratio || 1, idx = o.index || 0, h2 = o.h2 || 0, h3 = o.h3 || 0, a = o.a ?? 0.1, r = o.r ?? 0.2;
  for (let i = 0; i < n; i++) {
    const u = i / n, t = i / sr;
    let f = o.f(u);
    if (o.vib) f *= 1 + o.vib[1] * Math.sin(2 * Math.PI * o.vib[0] * t);
    pc += f / sr; pm += f * ratio / sr;
    const ph = 2 * Math.PI * pc + (idx ? idx * (o.indexEnv ? o.indexEnv(u) : 1) * Math.sin(2 * Math.PI * pm) : 0);
    let x = Math.sin(ph);
    if (h2) x += h2 * Math.sin(2 * ph);
    if (h3) x += h3 * Math.sin(3 * ph);
    let e = envU(u, a, r) * o.amp;
    if (o.am) e *= 1 - o.am[1] * (0.5 + 0.5 * Math.cos(2 * Math.PI * o.am[0] * t));
    let j = i0 + i;
    if (o.wrap) j = ((j % N) + N) % N; else if (j >= N) break;
    if (j < 0) continue;
    L[j] += x * e * gl;
    if (R) R[j] += x * e * gr;
  }
}
// A burst of filtered noise added into buf: o { at, dur, amp, a, r (fractions) or tau (s: exponential decay), f, q,
// type (bandpass), color: white|brown, pan, wrap, rnd }
export function noiseBurst(buf, sr, o) {
  const L = Array.isArray(buf) ? buf[0] : buf, R = Array.isArray(buf) ? buf[1] : null, N = L.length;
  const i0 = Math.round(o.at * sr), n = Math.max(2, Math.round(o.dur * sr)), r = o.rnd || Math.random;
  const F = new Filt(o.type || "bandpass", o.f || 2000, o.q ?? 1, sr), F2 = o.f2 ? new Filt(o.type2 || "lowpass", o.f2, o.q2 ?? 0.7, sr) : null;
  const pan = o.pan || 0, gl = R ? Math.cos((pan + 1) * Math.PI / 4) : 1, gr = R ? Math.sin((pan + 1) * Math.PI / 4) : 0;
  let br = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    let w = r() * 2 - 1;
    if (o.color === "brown") { br = (br + 0.02 * w) / 1.02; w = br * 3.5; }
    let x = F.run(w);
    if (F2) x = F2.run(x);
    const e = (o.tau ? Math.exp(-(i / sr) / o.tau) * Math.min(1, i / Math.max(1, (o.att || 0.001) * sr)) : envU(u, o.a ?? 0.1, o.r ?? 0.3)) * o.amp;
    let j = i0 + i;
    if (o.wrap) j = ((j % N) + N) % N; else if (j >= N) break;
    if (j < 0) continue;
    L[j] += x * e * gl;
    if (R) R[j] += x * e * gr;
  }
}
// Damped modes (struck wood or metal) added into buf: o { at, modes [[f, tau, amp]], amp, tick (noise share), pan, wrap, rnd }
export function modes(buf, sr, o) {
  const L = Array.isArray(buf) ? buf[0] : buf, R = Array.isArray(buf) ? buf[1] : null, N = L.length;
  const r = o.rnd || Math.random, i0 = Math.round(o.at * sr);
  const len = Math.min(1.2, Math.max(...o.modes.map((m) => m[1])) * 6), n = Math.round(len * sr);
  const pan = o.pan || 0, gl = R ? Math.cos((pan + 1) * Math.PI / 4) : 1, gr = R ? Math.sin((pan + 1) * Math.PI / 4) : 0;
  const ms = o.modes.map(([f, tau, a]) => ({ w: 2 * Math.PI * f / sr, k: Math.exp(-1 / (tau * sr)), a, ph: r() * 6.283 }));
  const hp = new Filt("highpass", o.tickF || 2500, 0.7, sr), tickN = Math.round(0.003 * sr);
  for (let i = 0; i < n; i++) {
    let x = 0;
    for (const m of ms) { x += Math.sin(m.ph + m.w * i) * m.a; m.a *= m.k; }
    if (o.tick && i < tickN * 3) x += hp.run(r() * 2 - 1) * o.tick * Math.exp(-i / tickN);
    let j = i0 + i;
    if (o.wrap) j = ((j % N) + N) % N; else if (j >= N) break;
    if (j < 0) continue;
    L[j] += x * o.amp * gl;
    if (R) R[j] += x * o.amp * gr;
  }
}
// A water drop or bubble: a sine gliding up fast (the bubble's resonance) and dying in a few ms.
export function bubble(buf, sr, o) {
  const f0 = o.f, f1 = o.f * (o.up || 2.2), tau = o.tau || 0.008, dur = tau * 6;
  fmNote(buf, sr, { at: o.at, dur, f: (u) => f0 * Math.pow(f1 / f0, Math.min(1, u * 1.6)), amp: o.amp, a: 0.02, r: 0.6, pan: o.pan, wrap: o.wrap, h2: 0.05 });
}
// The whole buffer through a filter (in place); several bands summed (formants) with formants().
export function filterIn(a, type, f, q = 0.707, sr = 32000) { const F = new Filt(type, f, q, sr); for (let i = 0; i < a.length; i++) a[i] = F.run(a[i]); return a; }
export function formants(a, sr, bands) {
  const out = new Float32Array(a.length);
  for (const [f, q, g] of bands) { const F = new Filt("bandpass", f, q, sr); for (let i = 0; i < a.length; i++) out[i] += F.run(a[i]) * g; }
  return out;
}
// A small outdoor reverb (four damped combs and two all-passes) mixed in: rt (s to −60 dB), mix, lp (the tail's top).
export function verb(a, sr, rt = 1.5, mix = 0.3, lp = 3000) {
  const n = a.length, wet = new Float32Array(n);
  for (const ms of [29.7, 37.1, 41.1, 43.7]) {
    const d = Math.round(ms / 1000 * sr * (1 + rt * 0.15)), g = Math.pow(10, -3 * (d / sr) / rt), line = new Float32Array(d), k = 1 - Math.exp(-2 * Math.PI * lp / sr);
    let p = 0, s = 0;
    for (let i = 0; i < n; i++) { const y = line[p]; s += k * (y - s); line[p] = a[i] + s * g; p = (p + 1) % d; wet[i] += y * 0.25; }
  }
  for (const ms of [5, 1.7]) {
    const d = Math.round(ms / 1000 * sr), line = new Float32Array(d), g = 0.7;
    let p = 0;
    for (let i = 0; i < n; i++) { const b = line[p], y = -g * wet[i] + b; line[p] = wet[i] + g * y; p = (p + 1) % d; wet[i] = y; }
  }
  for (let i = 0; i < n; i++) a[i] = a[i] * (1 - mix * 0.5) + wet[i] * mix;
  return a;
}
// Discrete echoes (a treeline, a building, a valley side): [[delay s, gain]], each a little darker.
export function echoes(a, sr, list) {
  const src = Float32Array.from(a);
  for (const [d, g] of list) {
    const off = Math.round(d * sr), F = new Filt("lowpass", 2500, 0.6, sr);
    for (let i = 0; i + off < a.length; i++) a[i + off] += F.run(src[i]) * g;
  }
  return a;
}
// Scale to a peak (and a short fade at the ends so nothing clicks).
export function norm(a, peak = 0.9) {
  const chans = Array.isArray(a) ? a : [a];
  let pk = 0;
  for (const ch of chans) for (let i = 0; i < ch.length; i++) pk = Math.max(pk, Math.abs(ch[i]));
  const k = pk > 0 ? peak / pk : 0;
  for (const ch of chans) {
    const fade = Math.min(64, ch.length >> 2);
    for (let i = 0; i < ch.length; i++) ch[i] *= k * (i < fade ? i / fade : 1) * (i > ch.length - fade ? (ch.length - i) / fade : 1);
  }
  return a;
}
// A loop's seam: the last xf seconds crossfaded into the start (equal power), then cut to len seconds.
export function seamLoop(a, sr, len, xf = 0.4) {
  const chans = Array.isArray(a) ? a : [a], n = Math.round(len * sr), x = Math.round(xf * sr);
  const out = chans.map((ch) => {
    const o = ch.slice(0, n);
    for (let i = 0; i < x && n + i < ch.length; i++) { const u = i / x; o[i] = o[i] * Math.sin(u * Math.PI / 2) + ch[n + i] * Math.cos(u * Math.PI / 2); }
    return o;
  });
  return Array.isArray(a) ? out : out[0];
}
export const buf1 = (sr, secs) => new Float32Array(Math.max(16, Math.round(sr * secs)));
export const buf2 = (sr, secs) => [buf1(sr, secs), buf1(sr, secs)];
// Poisson timing: an exponential wait with mean 1, kept within [lo, hi] (no long droughts, no machine-gun runs).
export const expo = (r, lo = 0.3, hi = 2.6) => clamp(-Math.log(1 - r() * 0.999), lo, hi);
