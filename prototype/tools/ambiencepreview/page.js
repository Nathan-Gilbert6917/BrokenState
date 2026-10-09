// The ambience previews (tools/ambiencepreview/main.cjs loads this page in a hidden Electron window): each scene is
// played into an OfflineAudioContext through the game's chain at the default sliders (ambience 50% → 0.25, master
// 70% → 0.49, the master compressor), its frames run four a second as in the game (ui/ambience.js ambPlay). Scenes
// that change (a storm passing, a horde coming) give a scene per frame. The old ambience (the code before this
// branch: one wind band, rain, the drone, thunder, birds, crickets) is rebuilt here for the comparisons.
import { VOICES } from "../../src/ui/audio.js";
import { ambienceMix } from "../../src/ui/soundcues.js";
import { AMB_OPTS, ambEngine, bedNodes, busy } from "../../src/ui/ambkit.js";
import { makeScene, ambiencePlan } from "../../src/ui/ambscene.js";
import { ambPlay } from "../../src/ui/ambience.js";
import { wildCall, CALLS, CALL_SR } from "../../src/ui/ambwild.js";
import { RECIPES, SOUND_SR } from "../../src/ui/ambweather.js";
import { stats, rngOf } from "../../src/ui/sfxdsp.js";

AMB_OPTS.sync = true;
const SR = 48000, AMB = 0.25, MASTER = 0.49, MAKEUP = 4; // +12 dB for listening, old and new alike
const lerp = (a, b, u) => a + (b - a) * Math.max(0, Math.min(1, u));

// ---------- the scenes ----------
// scene(t) -> makeScene(...) for that moment; wx: the raw weather (for the old ambience too); calls: [t, name] showcase
// calls on top of the natural ones (the rare animals, so a short preview has them).
const fixed = (o) => () => makeScene(o);
const SCENES = {
  calm_day: { secs: 40, wx: { key: "clear", wind: 0.25, rain: 0, temp: 20 }, hour: 11, season: "summer", ter: { field: 0.6, forest: 0.4 } },
  rainy_night: { secs: 40, wx: { key: "rain", wind: 0.4, rain: 0.55, temp: 9 }, hour: 1, season: "spring", ter: { field: 0.5, town: 0.2, forest: 0.3 } },
  spring_dawn_forest: { secs: 45, wx: { key: "clear", wind: 0.15, rain: 0, temp: 8 }, hour: 6, season: "spring", ter: { forest: 0.85, field: 0.15, river: 0.4 }, calls: [[14, "woodpecker"]] },
  summer_noon_farm: { secs: 40, wx: { key: "heat", wind: 0.12, rain: 0, temp: 31 }, hour: 13.5, season: "summer", ter: { field: 0.9, forest: 0.1 }, calls: [[9, "crow"], [26, "dogBark"]] },
  summer_night_lake: { secs: 45, wx: { key: "clear", wind: 0.2, rain: 0, temp: 21 }, hour: 23, season: "summer", ter: { field: 0.4, forest: 0.3, water: 0.3, lake: 1 }, calls: [[8, "bullfrog"], [24, "owlHoot"]] },
  autumn_dusk_hills: { secs: 45, wx: { key: "overcast", wind: 0.35, rain: 0, temp: 8 }, hour: 19.4, season: "autumn", ter: { hills: 0.7, forest: 0.3 }, calls: [[6, "geese"], [20, "elkBugle"], [36, "coyote"]] },
  winter_snow_day: { secs: 40, wx: { key: "snow", wind: 0.35, snow: 0.5, temp: -4, cover: 0.7 }, hour: 12, season: "winter", ter: { field: 0.6, forest: 0.4 }, calls: [[18, "raven"]] },
  fog_morning_town: { secs: 40, wx: { key: "fog", wind: 0.04, rain: 0, temp: 6 }, hour: 7.5, season: "autumn", ter: { town: 0.8, field: 0.2 }, wet: 0.3, calls: [[12, "dogBark"], [27, "crow"]] },
  frozen_river_night: { secs: 40, wx: { key: "frost", wind: 0.15, rain: 0, temp: -12, cover: 0.5 }, hour: 23, season: "winter", ter: { field: 0.6, forest: 0.3, water: 0.1, frozen: 1 }, calls: [[22, "wolfHowl"]] },
};
// A storm coming and passing (summer afternoon, farmland and a town's edge): distant thunder and the wind rising, the
// first drops, the storm overhead, then it moves off and the dripping is left.
SCENES.storm_passing = { secs: 45, season: "summer", hour: 16, ter: { field: 0.6, town: 0.3, forest: 0.1 }, scene(t) {
  const base = { hour: 16, season: "summer", ter: this.ter };
  if (t < 9) return makeScene({ ...base, wx: { key: "overcast", wind: lerp(0.25, 0.5, t / 9), temp: 26 }, approach: lerp(0.4, 1, t / 9) });
  if (t < 14) return makeScene({ ...base, wx: { key: "rain", rain: lerp(0.25, 0.6, (t - 9) / 5), wind: 0.6, temp: 23 }, wx2: 0, approach: 1, wet: 0.3 });
  if (t < 32) return makeScene({ ...base, wx: { key: "storm", rain: lerp(0.8, 1, (t - 14) / 6), wind: 0.92, temp: 20 } });
  if (t < 39) return makeScene({ ...base, wx: { key: "rain", rain: lerp(0.6, 0.2, (t - 32) / 7), wind: lerp(0.6, 0.3, (t - 32) / 7), temp: 20, storm: 0.3 } });
  return makeScene({ ...base, wx: { key: "overcast", wind: 0.25, temp: 20 }, wet: 0.8 });
} };
// The dead coming: a spring morning in the forest, then a horde comes within a few tiles (the birds flush and go
// quiet) and stays.
SCENES.horde_silence = { secs: 45, season: "spring", hour: 7, ter: { forest: 0.8, field: 0.2 }, scene(t) {
  const hush = t < 16 ? 0 : 1 - Math.exp(-(t - 16) / 2.5);
  return makeScene({ hour: 7, season: "spring", wx: { key: "clear", wind: 0.2, temp: 12 }, ter: this.ter, hush: { horde: hush }, flush: t >= 16 && t < 16.25 });
} };
// A building raid with rain outside: indoors, the rain on the roof through the walls, the wind dulled, no wildlife.
SCENES.raid_rain_indoors = { secs: 35, season: "autumn", hour: 15, ter: { town: 0.9, field: 0.1 }, scene() {
  return makeScene({ mode: "battle", battle: true, indoor: true, room: "inside", hour: 15, season: "autumn", wx: { key: "rain", rain: 0.65, wind: 0.45, temp: 11 }, ter: this.ter, hush: { battle: 1 } });
} };
for (const k of Object.keys(SCENES)) {
  const S = SCENES[k];
  if (!S.scene) S.scene = fixed({ hour: S.hour, season: S.season, wx: S.wx, ter: S.ter, wet: S.wet || 0 });
}

// ---------- the chain ----------
function chain(c) {
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.25;
  comp.connect(c.destination);
  const master = c.createGain(); master.gain.value = MASTER; master.connect(comp);
  const amb = c.createGain(); amb.gain.value = AMB; amb.connect(master);
  return amb;
}

// ---------- the new ambience ----------
async function renderNew(S) {
  const c = new OfflineAudioContext(2, Math.ceil(S.secs * SR), SR);
  const E = ambEngine(c, chain(c));
  let frameMs = 0, bedMax = 0, calls = 0;
  const bake0 = E.stats.bakeMs;
  for (let k = 0; k * 0.25 < S.secs; k++) {
    const t = k * 0.25, P = ambiencePlan(S.scene(t));
    const f0 = performance.now();
    ambPlay(E, P, t);
    frameMs += performance.now() - f0;
    for (const [at, name] of S.calls || []) if (at >= t && at < t + 0.25) wildCall(E, P, name, at);
    bedMax = Math.max(bedMax, bedNodes(E) + 4);
  }
  calls = E.stats.shots;
  const r0 = performance.now();
  const buf = await c.startRendering();
  return { buf, renderMs: Math.round(performance.now() - r0), frameMs: Math.round((frameMs - (E.stats.bakeMs - bake0)) / (S.secs * 4) * 1000) / 1000, bakeMs: Math.round(E.stats.bakeMs), bedMax, calls };
}

// ---------- the old ambience (as it was before this branch) ----------
const OLD_LEVELS = { wind: 0.32, rain: 0.26, rainLow: 0.3, drone: 0.13 };
function oldNoise(c) {
  const n = (secs) => c.createBuffer(1, Math.floor(c.sampleRate * secs), c.sampleRate);
  const white = n(1.5), brown = n(3), w = white.getChannelData(0), br = brown.getChannelData(0);
  for (let i = 0; i < w.length; i++) w[i] = Math.random() * 2 - 1;
  let last = 0;
  for (let i = 0; i < br.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; br[i] = last * 3.5; }
  const loop = (b) => { const s = c.createBufferSource(); s.buffer = b; s.loop = true; s.start(); return s; };
  return { white: loop(white), brown: loop(brown) };
}
function lfo(c, rate, depth, param) { const o = c.createOscillator(); o.frequency.value = rate; const g = c.createGain(); g.gain.value = depth; o.connect(g); g.connect(param); o.start(); }
function oldLayers(c, amb) {
  const { white, brown } = oldNoise(c), L = {};
  L.windBand = c.createBiquadFilter(); L.windBand.type = "bandpass"; L.windBand.Q.value = 0.9; L.windBand.frequency.value = 400;
  L.gust = c.createGain(); L.wind = c.createGain(); L.wind.gain.value = 0;
  brown.connect(L.windBand); L.windBand.connect(L.gust); L.gust.connect(L.wind); L.wind.connect(amb);
  lfo(c, 0.09, 0.45, L.gust.gain); lfo(c, 0.05, 120, L.windBand.frequency);
  const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1200;
  const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 7000;
  L.rain = c.createGain(); L.rain.gain.value = 0;
  white.connect(hp); hp.connect(lp); lp.connect(L.rain); L.rain.connect(amb);
  const low = c.createBiquadFilter(); low.type = "lowpass"; low.frequency.value = 450;
  L.rainLow = c.createGain(); L.rainLow.gain.value = 0;
  brown.connect(low); low.connect(L.rainLow); L.rainLow.connect(amb);
  const dlp = c.createBiquadFilter(); dlp.type = "lowpass"; dlp.frequency.value = 300;
  L.drone = c.createGain(); L.drone.gain.value = 0;
  for (const [f, type, g] of [[55, "sine", 0.6], [82.8, "sine", 0.45], [110.4, "triangle", 0.15]]) {
    const o = c.createOscillator(); o.type = type; o.frequency.value = f;
    const og = c.createGain(); og.gain.value = g; o.connect(og); og.connect(dlp); o.start();
  }
  dlp.connect(L.drone); L.drone.connect(amb);
  lfo(c, 0.04, 0.02, L.drone.gain);
  return L;
}
async function renderOld(S) {
  const c = new OfflineAudioContext(2, Math.ceil(S.secs * SR), SR);
  const amb = chain(c), L = oldLayers(c, amb), N = { thunder: 0, bird: 0, cricket: 0 };
  const play = (name, t, o) => VOICES[name].play(c, amb, t + 0.01, { gain: 1, pitch: 0.94 + Math.random() * 0.12, ...o });
  for (let k = 0; k * 0.25 < S.secs; k++) {
    const t = k * 0.25, sc = S.scene(t), w = S.wx || { key: sc.wx.key, wind: sc.wx.wind, rain: sc.wx.rainI, temp: sc.wx.temp };
    const m = ambienceMix(w, sc.hour, sc.season);
    if (sc.battle) m.birds = 0;
    L.wind.gain.setTargetAtTime(m.wind * OLD_LEVELS.wind, t, 1.5);
    L.windBand.frequency.setTargetAtTime(m.windTone, t, 2);
    L.rain.gain.setTargetAtTime(m.rain * OLD_LEVELS.rain, t, 1.5);
    L.rainLow.gain.setTargetAtTime(m.rainLow * OLD_LEVELS.rainLow, t, 1.5);
    L.drone.gain.setTargetAtTime(m.drone * OLD_LEVELS.drone, t, 3);
    if (m.thunder && t >= N.thunder) { if (N.thunder) play("thunder", t, { near: Math.random() }); N.thunder = t + 12 + Math.random() * 28; }
    if (!m.thunder) N.thunder = 0;
    if (m.birds > 0.05 && t >= N.bird) { if (N.bird) play("bird", t, { gain: 0.5 + m.birds * 0.5 }); N.bird = t + (2 + Math.random() * 8) / m.birds; }
    if (m.crickets > 0.05 && t >= N.cricket) { if (N.cricket) play("cricket", t, { gain: m.crickets }); N.cricket = t + 0.6 + Math.random() * 1.6 / m.crickets; }
  }
  const r0 = performance.now();
  const buf = await c.startRendering();
  return { buf, renderMs: Math.round(performance.now() - r0), frameMs: 0, bakeMs: 0, bedMax: 21, calls: 0 };
}

// ---------- rendering and measuring ----------
export const RENDERS = {};
for (const k of Object.keys(SCENES)) RENDERS[`${k}_new`] = { S: SCENES[k], old: false };
for (const k of ["calm_day", "rainy_night", "storm_passing", "summer_night_lake", "spring_dawn_forest"]) RENDERS[`${k}_old`] = { S: SCENES[k], old: true };
const db = (x) => (x > 0 ? Math.round(20 * Math.log10(x) * 10) / 10 : -120);
const b64 = (i16) => { const u8 = new Uint8Array(i16.buffer); let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
export async function render(name) {
  const R = RENDERS[name];
  const out = R.old ? await renderOld(R.S) : await renderNew(R.S);
  const L = out.buf.getChannelData(0), Rr = out.buf.getChannelData(1), n = L.length;
  const i16 = new Int16Array(n * 2), mono = new Float32Array(n);
  let sum = 0, wavPk = 0, clip = 0, nan = false;
  const seg = [], segN = 5 * SR;
  let sacc = 0;
  for (let i = 0; i < n; i++) {
    const l = L[i], r = Rr[i];
    if (!Number.isFinite(l) || !Number.isFinite(r)) { nan = true; continue; }
    mono[i] = Math.abs(l) > Math.abs(r) ? l : r;
    sum += (l * l + r * r) / 2; sacc += (l * l + r * r) / 2;
    if ((i + 1) % segN === 0) { seg.push(db(Math.sqrt(sacc / segN))); sacc = 0; }
    const wl = l * MAKEUP, wr = r * MAKEUP;
    wavPk = Math.max(wavPk, Math.abs(wl), Math.abs(wr));
    if (Math.abs(wl) >= 1 || Math.abs(wr) >= 1) clip++;
    i16[2 * i] = Math.max(-32768, Math.min(32767, Math.round(wl * 32767)));
    i16[2 * i + 1] = Math.max(-32768, Math.min(32767, Math.round(wr * 32767)));
  }
  const st = stats(mono, SR);
  return { name, sr: SR, data: b64(i16), stats: { secs: R.S.secs, rmsDb: db(Math.sqrt(sum / n)), peakDb: st.peakDb, wavPeakDb: db(wavPk), wavClip: clip, seg, renderMs: out.renderMs, frameMs: out.frameMs, bakeMs: out.bakeMs, bedMax: out.bedMax, calls: out.calls, nan } };
}

// The cost: nodes per one-shot (counted on a real context), the bake time of each voice (ms, mean of its variants at
// its rate), the loops' bake time.
export async function cost() {
  const c = new OfflineAudioContext(2, SR, SR);
  const E = ambEngine(c, c.destination);
  const P = ambiencePlan(makeScene({ hour: 6, season: "spring", wx: { key: "clear", temp: 12 }, ter: { forest: 1 } }));
  wildCall(E, P, "songRobin", 0.1); // warm the bake
  const names = ["createGain", "createBiquadFilter", "createBufferSource", "createStereoPanner"], keep = {};
  let n = 0;
  const P0 = Object.getPrototypeOf(c);
  for (const m of names) { keep[m] = c[m]; c[m] = (...a) => { n++; return P0[m].apply(c, a); }; }
  wildCall(E, P, "songRobin", 0.2);
  const perCall = n;
  n = 0;
  wildCall(E, { ...P, fog: true }, "dogBark", 0.2);
  const perFarCall = n;
  for (const m of names) delete c[m];
  const bake = {};
  for (const [k, f] of Object.entries(CALLS)) { const sr = CALL_SR[k] || 32000, t0 = performance.now(); for (let v = 0; v < 3; v++) f(sr, rngOf(v + 1)); bake[k] = Math.round((performance.now() - t0) / 3 * 10) / 10; }
  for (const [k, f] of Object.entries(RECIPES)) { const sr = SOUND_SR[k] || 32000, t0 = performance.now(); for (let v = 0; v < 3; v++) f(sr, rngOf(v + 1)); bake[k] = Math.round((performance.now() - t0) / 3 * 10) / 10; }
  const loops = {};
  const E2 = ambEngine(new OfflineAudioContext(2, SR, SR), c.destination);
  for (const k of ["drone", "river", "lake", "crickets", "frogs", "cicadas"]) { const t0 = performance.now(); const P2 = ambiencePlan(makeScene({})); for (const b of Object.keys(P2.beds)) P2.beds[b] = 0; P2.beds[k] = 0.5; ambPlay(E2, { ...P2, weather: {}, wild: {} }, 0); loops[k] = Math.round(performance.now() - t0); }
  const mem = [...E.bufs.values(), ...E2.bufs.values()].reduce((a, b) => a + b.length * b.numberOfChannels * 4, 0);
  return { nodesPerCall: perCall, nodesPerDullCall: perFarCall, bakeMs: bake, loopBakeMs: loops, bufferBytesSample: mem };
}
window.AMB = { render, names: Object.keys(RENDERS), cost, ready: true };
