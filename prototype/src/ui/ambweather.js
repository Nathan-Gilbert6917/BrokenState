// Weather you hear (ui/ambscene.js plans it, ui/audio.js calls weatherFrame four times a second): layered wind with
// irregular gusts, rain from drizzle to downpour with drops by surface, thunder near and far, the snow's hush, rivers
// and lakes, ice creaking, the night drone, and the loose things the wind finds. Made in code (no audio files).
//
//   WEATHER_SOUNDS            every weather sound by name: { label, bed?, trim } (a mixer maps them to "weather")
//   weatherFrame(E, plan, t)  sets the beds and plays the one-shots due
//   ambLightning(near, from)  a flash drawn somewhere (from "title": the title's storm; "map": ui/lightningfx.js):
//                             its thunder follows after the light, later the further off (near 1 overhead, 0 far)
//   mapSky()                  the map is drawn and its strikes are the thunder (ui/lightningfx.js, each frame): on
//                             the map the ambience plays no near or rolling thunder of its own, only distant grumbles
//   weatherCall(E, name, t)  one weather one-shot now (the mixer's ▶, previews)
//   onLightning(fn)           fn({ at, near, km }) when a strike is played (for a flash on the map, should one come)
import { noiseSource, loopSource, biquad, setBed, setDull, bakeBuffer, playShot, busy, clamp, expo, BED_SR,
  fmNote, noiseBurst, modes, bubble, filterIn, verb, echoes, norm, seamLoop, buf1 } from "./ambkit.js";
import { rollTail, noiseLayer } from "./sfxdsp.js";

// trim: the level at bed level 1 or a one-shot's gain 1, under the ambience slider (tuned against the old ambience:
// tools/ambiencepreview).
export const WEATHER_SOUNDS = {
  windLow:        { label: "Wind: low rumble (and a storm's roar)", bed: true, trim: 0.2 },
  windMid:        { label: "Wind: whoosh", bed: true, trim: 0.26 },
  windHigh:       { label: "Wind: whistle", bed: true, trim: 0.05 },
  rainWash:       { label: "Rain wash (the snow's hush)", bed: true, trim: 0.24 },
  river:          { label: "River running", bed: true, trim: 0.11 },
  lake:           { label: "Lake lapping", bed: true, trim: 0.16 },
  drone:          { label: "Night drone", bed: true, trim: 0.18 },
  thunderNear:    { label: "Thunder: near crack", trim: 0.75 },
  thunderFar:     { label: "Thunder: rolling", trim: 0.5 },
  thunderDistant: { label: "Thunder: distant (a storm coming)", trim: 0.32 },
  dropLeaf:       { label: "Rain on leaves", trim: 0.1 },
  dropTin:        { label: "Rain on tin roofs", trim: 0.075 },
  dropGutter:     { label: "Gutter trickle", trim: 0.09 },
  dropPuddle:     { label: "Rain in puddles", trim: 0.09 },
  drip:           { label: "Dripping after rain", trim: 0.11 },
  rattle:         { label: "Loose metal rattling", trim: 0.1 },
  creak:          { label: "Hinge and shutter creak", trim: 0.07 },
  shutter:        { label: "Shutter bang", trim: 0.12 },
  leaves:         { label: "Gust in the leaves", trim: 0.1 },
  branch:         { label: "Branch creak", trim: 0.08 },
  iceGroan:       { label: "Ice groaning", trim: 0.17 },
  icePing:        { label: "Ice singing", trim: 0.07 },
};
export const WEATHER_LIMIT = 4; // weather one-shots ringing at once (thunder and drops)
const VARIANTS = 4;
// Bake rates (Hz) where less will do (the low ones); the rest at SHOT_SR.
export const SOUND_SR = { thunderNear: 24000, thunderFar: 16000, thunderDistant: 12000, iceGroan: 16000, branch: 16000, rattle: 24000, shutter: 22050, dropGutter: 24000, dropPuddle: 24000, drip: 24000 };

// ---------- the beds ----------
const bedOut = (E) => E.c.createGain();
const BEDS = {
  windLow: { group: "weather", build(E, t) { // brown noise, low-passed: the rumble (a storm's roar shares it)
    const c = E.c, s = noiseSource(E, "brown", t), lp = biquad(c, "lowpass", 160, 0.6), out = bedOut(E);
    s.connect(lp); lp.connect(out);
    return { src: [s], nodes: 3, out, set(p, t) { lp.frequency.setTargetAtTime(p.f, t, 1.5); } };
  } },
  windMid: { group: "weather", build(E, t) { // pink noise through a band that moves with the gusts: the whoosh
    const c = E.c, s = noiseSource(E, "pink", t), bp = biquad(c, "bandpass", 520, 0.8), out = bedOut(E);
    s.connect(bp); bp.connect(out);
    return { src: [s], nodes: 3, out, set(p, t) { bp.frequency.setTargetAtTime(p.f, t, p.tau || 0.8); } };
  } },
  windHigh: { group: "weather", build(E, t) { // white noise through a narrow band: the whistle round corners and wires
    const c = E.c, s = noiseSource(E, "white", t), bp = biquad(c, "bandpass", 1500, 6), out = bedOut(E);
    s.connect(bp); bp.connect(out);
    return { src: [s], nodes: 3, out, set(p, t) { bp.frequency.setTargetAtTime(p.f, t, p.tau || 0.8); } };
  } },
  rainWash: { group: "weather", build(E, t) { // white noise between a high-pass and a low-pass: drizzle to downpour, the snow's hush
    const c = E.c, s = noiseSource(E, "white", t), hp = biquad(c, "highpass", 1500, 0.5), lp = biquad(c, "lowpass", 7000, 0.5), out = bedOut(E);
    s.connect(hp); hp.connect(lp); lp.connect(out);
    return { src: [s], nodes: 4, out, set(p, t) { hp.frequency.setTargetAtTime(p.hp, t, 2); lp.frequency.setTargetAtTime(p.lp, t, 2); } };
  } },
  drone: loopBed("weather", "drone", droneLoop, 8000),
  river: loopBed("weather", "river", riverLoop, 16000),
  lake: loopBed("weather", "lake", lakeLoop, 16000),
};
// A bed that loops a baked buffer: source → gain (2 nodes).
export function loopBed(group, key, recipe, sr = BED_SR) {
  return { group, build(E, t) {
    const b = bakeBuffer(E, `bed:${key}`, recipe, sr);
    if (!b) return null;
    const s = loopSource(E, b, t), out = bedOut(E);
    s.connect(out);
    return { src: [s], nodes: 2, out };
  } };
}

// ---------- the frame ----------
let FLASHES = []; // lightning drawn (ambLightning), waiting for its thunder
const LISTENERS = new Set();
let LAST_FLASH = -1e9, MAP_SKY = -1e9;
const nowMs = () => (typeof performance !== "undefined" ? performance.now() : 0);
export function ambLightning(near = 0.5, from = "title") {
  const at = nowMs();
  if (from !== "map") LAST_FLASH = at; // (the title's rain follows its own storm only)
  const n = Number(near);
  FLASHES.push({ near: clamp(Number.isFinite(n) ? n : 0.5, 0, 1), at, from: from === "map" ? "map" : "title" });
  if (FLASHES.length > 6) FLASHES.shift();
}
export const MAP_SKY_HOLD = 1500; // ms the map's sky counts as drawn after its last frame
export function mapSky() { MAP_SKY = nowMs(); }
export const mapSkyLive = () => nowMs() - MAP_SKY < MAP_SKY_HOLD;
// The thunder for a map strike by how near (ui/lightningfx.js nearOf): null too far to hear.
export const thunderFor = (near) => (near > 0.6 ? "thunderNear" : near >= 0.15 ? "thunderFar" : near >= 0.04 ? "thunderDistant" : null);
export const flashAge = () => (nowMs() - LAST_FLASH) / 1000; // s since the last flash drawn
export function onLightning(fn) { LISTENERS.add(fn); return () => LISTENERS.delete(fn); }
export const takeFlashes = () => { const f = FLASHES; FLASHES = []; return f; };

export function weatherFrame(E, P, t) {
  const M = E.mem.wx || (E.mem.wx = { gust: 0.4, gustT: 0, nextGust: 0, rainDrift: 1, driftT: 0, acc: {}, u: {}, last: 0 });
  const dt = M.last ? Math.max(0, Math.min(1, t - M.last)) : 0.25;
  M.last = t;
  const tr = (n) => WEATHER_SOUNDS[n].trim;
  // Gusts: a new target every second or few (more often in a high wind), now and then a strong one; the beds swell
  // into them faster than they fall back.
  if (t >= M.nextGust) {
    const r = E.rnd, base = P.wind.base;
    const strong = r() < 0.12 + 0.2 * base;
    M.gustPrev = M.gust;
    M.gust = clamp(strong ? 0.85 + r() * 0.15 : 0.15 + r() * 0.7 * P.wind.gusty + 0.2 * base, 0.05, 1);
    M.nextGust = t + (0.7 + expo(r, 0.2, 3) * (2.6 - 1.4 * base));
    M.peak = M.gust > 0.7 && M.gust - (M.gustPrev || 0) > 0.15; // a gust peak: the loose things answer it
  } else M.peak = false;
  const g = M.gust, rising = g > (M.gustPrev || 0), tau = rising ? 0.9 : 1.8;
  // Rain does not fall evenly: a slow drift of ±15%.
  if (t >= M.driftT) { M.rainDrift = 0.85 + E.rnd() * 0.3; M.driftT = t + 6 + E.rnd() * 10; }
  const B = P.beds, T = P.tone;
  setBed(E, "windLow", BEDS.windLow, B.windLow * (0.65 + 0.45 * g) * tr("windLow"), t, tau, { f: T.low });
  setBed(E, "windMid", BEDS.windMid, B.windMid * (0.35 + 0.9 * g) * tr("windMid"), t, tau, { f: T.mid * (0.75 + 0.55 * g), tau });
  setBed(E, "windHigh", BEDS.windHigh, B.windHigh * Math.pow(g, 1.6) * 1.6 * tr("windHigh"), t, tau, { f: T.high * (0.85 + 0.4 * g), tau });
  setBed(E, "rainWash", BEDS.rainWash, B.rainWash * M.rainDrift * tr("rainWash"), t, 2, { hp: T.washHp, lp: T.washLp });
  setBed(E, "drone", BEDS.drone, B.drone * (0.92 + 0.08 * Math.sin(t * 0.25)) * tr("drone"), t, 3);
  setBed(E, "river", BEDS.river, B.river * tr("river"), t, 2);
  setBed(E, "lake", BEDS.lake, B.lake * (0.85 + 0.25 * g) * tr("lake"), t, 2);
  setDull(E, "weather", P.dull.weather, t);
  // Lightning drawn: the title's, its thunder a second or three after the flash (on the title screen); the map's
  // (ui/lightningfx.js), after the light by how far off (on the map; a voice still baking tries again next frame).
  // Others are let go (a title flash heard on the map, or the map's in a battle).
  const mapLit = P.mode === "map" && mapSkyLive();
  if (FLASHES.length) {
    let again = null;
    for (const f of takeFlashes()) {
      if (f.from === "title") { if (P.mode === "title") thunder(E, f.near > 0.6 ? "thunderNear" : "thunderFar", t + 1 + (1 - f.near) * 2.5, f.near); continue; }
      const name = thunderFor(f.near), lag = Math.max(0, (nowMs() - f.at) / 1000);
      if (P.mode !== "map" || !name || lag > 3) continue;
      if (!thunder(E, name, t - Math.min(lag, 0.5), f.near)) (again || (again = [])).push(f);
    }
    if (again) FLASHES.push(...again);
  }
  // One-shots: each rate (a minute) runs up an accumulator to a random threshold (mean 1); gust peaks hurry the
  // wind's loose things along. A full house (WEATHER_LIMIT) waits a frame; thunder always gets through.
  const R = P.weather || {};
  for (const name of Object.keys(R)) {
    let rate = R[name];
    if (!(rate > 0)) { M.acc[name] = 0; continue; }
    if (GUSTY[name]) rate *= 0.3 + 1.7 * g * g;
    M.acc[name] = (M.acc[name] || 0) + rate / 60 * dt;
    if (M.u[name] == null) M.u[name] = expo(E.rnd);
    if (GUSTY[name] && M.peak && E.rnd() < 0.35 * Math.min(1, R[name] / 2)) M.acc[name] = M.u[name]; // a gust peak sets it off
    if (M.acc[name] < M.u[name]) continue;
    const isThunder = name.startsWith("thunder");
    if (mapLit && (name === "thunderNear" || name === "thunderFar")) { M.acc[name] = 0; continue; } // the map's strikes are these
    if (!isThunder && busy(E, "weather", t) >= WEATHER_LIMIT) continue;
    const at = t + E.rnd() * 0.25;
    const ok = isThunder ? thunder(E, name, at, name === "thunderNear" ? 0.65 + E.rnd() * 0.35 : name === "thunderFar" ? 0.25 + E.rnd() * 0.3 : 0.05) : playWeather(E, name, at, P);
    if (ok) { M.acc[name] = 0; M.u[name] = expo(E.rnd); }
  }
}
// One weather sound now, past the rates (the mixer's ▶, previews): false while it bakes.
export function weatherCall(E, name, t, P = { fog: false }) {
  if (!RECIPES[name]) return false;
  return name.startsWith("thunder") ? thunder(E, name, t, name === "thunderNear" ? 0.85 : 0.45, true) : playWeather(E, name, t, P);
}
const GUSTY = { rattle: 1, creak: 1, shutter: 1, leaves: 1, branch: 1 };

// A strike: the flash now (for anyone drawing one), the thunder after the light by its distance (about 3 s a km,
// shortened so a near one does not lag), sized by how near.
function thunder(E, name, t, near, now = false) {
  const v = Math.floor(E.rnd() * VARIANTS);
  const buf = bakeBuffer(E, `${name}:${v}`, RECIPES[name], SOUND_SR[name]);
  if (!buf) return false;
  const km = name === "thunderNear" ? 0.4 + (1 - near) * 1.2 : name === "thunderFar" ? 2.5 + (1 - near) * 5 : 9 + E.rnd() * 8;
  const delay = now ? 0 : Math.min(name === "thunderNear" ? 2.5 : name === "thunderFar" ? 6 : 9, km * 0.9);
  for (const fn of LISTENERS) try { fn({ at: t, near, km }); } catch { /* ignore */ }
  const pan = (E.rnd() - 0.5) * (name === "thunderNear" ? 0.6 : 1.3);
  playShot(E, "weather", buf, t + delay, { gain: WEATHER_SOUNDS[name].trim * (0.75 + 0.35 * near), pan, rate: 0.92 + E.rnd() * 0.16 });
  return true;
}
// A drop cluster, a drip, a rattle or a creak: a baked variant, panned, a little off pitch; dull when far off in fog.
function playWeather(E, name, t, P) {
  const v = Math.floor(E.rnd() * VARIANTS);
  const buf = bakeBuffer(E, `${name}:${v}`, RECIPES[name], SOUND_SR[name]);
  if (!buf) return false;
  const far = E.rnd();
  const lp = P.fog && far > 0.5 ? 2500 : 0;
  playShot(E, "weather", buf, t, { gain: WEATHER_SOUNDS[name].trim * (1 - 0.45 * far), pan: (E.rnd() - 0.5) * 1.6, rate: 0.9 + E.rnd() * 0.2, lp });
  return true;
}

// ---------- the recipes (baked once per variant; sr, rnd: a seeded generator) ----------
export const RECIPES = {
  // Thunder: a near one rips (crackles over a few hundred ms), booms and rolls on for seconds; a far one swells in
  // low and rolls; a distant one is a low grumble over the hills.
  thunderNear(sr, r) {
    const len = 6 + r() * 2, a = buf1(sr, len + 0.5);
    for (let i = 0; i < 26; i++) noiseBurst(a, sr, { at: r() * 0.35, dur: 0.02 + r() * 0.05, amp: 0.4 + r() * 0.6, f: 900 + r() * 3500, q: 0.8, tau: 0.012, rnd: r });
    noiseLayer(a, sr, { start: 0, dur: 0.9, amp: 0.9, a: 0.004, tau: 0.25, color: "white", rnd: r, filters: [{ type: "lowpass", f: 2500, to: 400, q: 0.7 }] });
    const tail = rollTail(sr, { len, lp: 700, lpEnd: 120, rise: 0.08, rnd: r, echoes: [[0.6 + r() * 0.5, 0.5], [1.4 + r() * 0.8, 0.35], [2.5 + r(), 0.25]] });
    for (let i = 0; i < tail.length && i < a.length; i++) a[i] += tail[i] * 0.85;
    return norm(a, 0.95);
  },
  thunderFar(sr, r) {
    const len = 6.5 + r() * 3, rise = 0.35 + r() * 0.5;
    const a = rollTail(sr, { len, lp: 380, lpEnd: 100, rise, rnd: r, echoes: [[rise + 0.8 + r(), 0.45], [rise + 2 + r() * 1.5, 0.3]] });
    return norm(Float32Array.from(a), 0.9);
  },
  thunderDistant(sr, r) {
    const len = 7 + r() * 3;
    const a = rollTail(sr, { len, lp: 190, lpEnd: 70, rise: 1 + r() * 0.8, rnd: r, echoes: [[2 + r() * 2, 0.4]] });
    return norm(Float32Array.from(a), 0.9);
  },
  // Rain drops (clusters of two seconds): soft pats on leaves with now and then a fat drip off them; pings on a tin
  // roof over its dull body; a gutter's trickle of plinks; plops in puddles.
  dropLeaf(sr, r) {
    const a = buf1(sr, 2);
    const n = 10 + Math.floor(r() * 12);
    for (let i = 0; i < n; i++) noiseBurst(a, sr, { at: r() * 1.9, dur: 0.012 + r() * 0.012, amp: 0.25 + r() * 0.75, f: 1600 + r() * 2600, q: 1.2, tau: 0.004 + r() * 0.004, rnd: r });
    for (let i = 0; i < 2; i++) if (r() < 0.6) noiseBurst(a, sr, { at: r() * 1.8, dur: 0.05, amp: 0.8, f: 700 + r() * 500, q: 2, tau: 0.012, rnd: r });
    return norm(a, 0.8);
  },
  dropTin(sr, r) {
    const a = buf1(sr, 2);
    const n = 6 + Math.floor(r() * 9), f0 = 2200 + r() * 1800;
    for (let i = 0; i < n; i++) {
      const at = r() * 1.85, f = f0 * (0.85 + r() * 0.3);
      modes(a, sr, { at, amp: 0.25 + r() * 0.6, modes: [[f, 0.03 + r() * 0.03, 1], [f * 1.47, 0.02, 0.5], [f * 2.31, 0.012, 0.3], [380 + r() * 200, 0.02, 0.35]], tick: 0.4, rnd: r });
    }
    return norm(a, 0.8);
  },
  dropGutter(sr, r) {
    const a = buf1(sr, 2.2);
    noiseBurst(a, sr, { at: 0, dur: 2.2, amp: 0.12, f: 500, q: 0.8, a: 0.2, r: 0.3, color: "brown", rnd: r }); // the gurgle in the pipe
    let at = r() * 0.1;
    while (at < 2.05) { bubble(a, sr, { at, f: 650 + r() * 900, up: 1.8 + r() * 1.2, tau: 0.006 + r() * 0.008, amp: 0.3 + r() * 0.7 }); at += 0.04 + r() * 0.16; }
    return norm(a, 0.8);
  },
  dropPuddle(sr, r) {
    const a = buf1(sr, 2);
    const n = 6 + Math.floor(r() * 9);
    for (let i = 0; i < n; i++) {
      const at = r() * 1.85;
      bubble(a, sr, { at, f: 350 + r() * 700, up: 2 + r() * 1.5, tau: 0.007 + r() * 0.01, amp: 0.35 + r() * 0.65 });
      noiseBurst(a, sr, { at, dur: 0.02, amp: 0.25 * r(), f: 3000, q: 0.7, tau: 0.004, rnd: r });
    }
    return norm(a, 0.8);
  },
  drip(sr, r) {
    const a = buf1(sr, 2.6);
    let at = 0.05 + r() * 0.2;
    while (at < 2.3) {
      if (r() < 0.75) bubble(a, sr, { at, f: 700 + r() * 1100, up: 2 + r(), tau: 0.01 + r() * 0.01, amp: 0.5 + r() * 0.5 });
      else modes(a, sr, { at, amp: 0.4, modes: [[2600 + r() * 1500, 0.03, 1], [4100, 0.015, 0.4]], tick: 0.3, rnd: r }); // on a tin sill
      at += 0.3 + r() * 0.7;
    }
    return norm(a, 0.8);
  },
  // The wind's loose things: a metal sheet flapping (a run of clattering hits), a hinge creaking (stick and slip
  // through two resonances), a shutter banging (a wooden knock and its rebound), leaves in a gust, a branch creaking.
  rattle(sr, r) {
    const a = buf1(sr, 1.8);
    const base = 160 + r() * 220;
    let at = 0.02, n = 4 + Math.floor(r() * 9);
    for (let i = 0; i < n && at < 1.4; i++) {
      modes(a, sr, { at, amp: (0.4 + r() * 0.6) * (1 - i / (n + 2)), modes: [[base * (0.95 + r() * 0.1), 0.08 + r() * 0.06, 1], [base * 2.7, 0.05, 0.6], [base * 5.9, 0.03, 0.4], [base * 9.4, 0.015, 0.25]], tick: 0.5, rnd: r });
      at += 0.04 + r() * 0.12;
    }
    echoes(a, sr, [[0.09 + r() * 0.06, 0.3]]);
    return norm(a, 0.85);
  },
  creak(sr, r) {
    const len = 0.6 + r() * 0.8, a = buf1(sr, len + 0.2), imp = buf1(sr, len + 0.2);
    let t = 0;
    const r0 = 14 + r() * 10, r1 = 30 + r() * 25;
    while (t < len) { const u = t / len, rate = r0 + (r1 - r0) * Math.sin(Math.PI * u); imp[Math.round(t * sr)] = (0.5 + r() * 0.5) * Math.sin(Math.PI * u); t += 1 / rate * (0.85 + r() * 0.3); }
    const f1 = 700 + r() * 700;
    const b1 = filterIn(Float32Array.from(imp), "bandpass", f1, 9, sr), b2 = filterIn(Float32Array.from(imp), "bandpass", f1 * 2.3, 7, sr);
    for (let i = 0; i < a.length; i++) a[i] = b1[i] + b2[i] * 0.6;
    return norm(a, 0.8);
  },
  shutter(sr, r) {
    const a = buf1(sr, 1);
    const knock = (at, amp) => { modes(a, sr, { at, amp, modes: [[130 + r() * 70, 0.07, 1], [380 + r() * 120, 0.035, 0.6], [900 + r() * 300, 0.015, 0.3]], tick: 0.6, tickF: 1500, rnd: r }); };
    knock(0.01, 1);
    if (r() < 0.8) knock(0.09 + r() * 0.12, 0.35);
    echoes(a, sr, [[0.11 + r() * 0.06, 0.35], [0.26 + r() * 0.1, 0.15]]);
    return norm(a, 0.85);
  },
  leaves(sr, r) {
    const len = 1.3 + r() * 1.2, a = buf1(sr, len);
    noiseBurst(a, sr, { at: 0, dur: len, amp: 0.5, f: 3500 + r() * 1500, q: 0.6, a: 0.35, r: 0.45, rnd: r });
    const n = 60 + Math.floor(r() * 80);
    for (let i = 0; i < n; i++) { const u = r(); noiseBurst(a, sr, { at: u * len, dur: 0.008, amp: (0.2 + r() * 0.5) * Math.sin(Math.PI * u), f: 2500 + r() * 4000, q: 1, tau: 0.002, rnd: r }); }
    return norm(a, 0.8);
  },
  branch(sr, r) {
    const len = 1 + r() * 1.2, a = buf1(sr, len + 0.3), imp = buf1(sr, len + 0.3);
    let t = 0;
    const rate0 = 7 + r() * 8;
    while (t < len) { const u = t / len; imp[Math.round(t * sr)] = Math.sin(Math.PI * u) * (0.6 + r() * 0.4); t += 1 / (rate0 * (0.7 + 0.6 * u)); }
    const f = 230 + r() * 260;
    const b = filterIn(Float32Array.from(imp), "bandpass", f, 7, sr), b2 = filterIn(Float32Array.from(imp), "bandpass", f * 3.1, 5, sr);
    for (let i = 0; i < a.length; i++) a[i] = b[i] + b2[i] * 0.4;
    verb(a, sr, 1.2, 0.2, 2000);
    return norm(a, 0.8);
  },
  // Ice: a long low groan as it shifts; the "singing" of a frozen river: a ping falling fast from high to low (the
  // ice sheet's dispersion), echoing down the river.
  iceGroan(sr, r) {
    const len = 1.2 + r() * 1.6, a = buf1(sr, len + 1);
    const f0 = 70 + r() * 70, f1 = f0 * (0.6 + r() * 0.9);
    fmNote(a, sr, { at: 0, dur: len, f: (u) => f0 * Math.pow(f1 / f0, u) * (1 + 0.04 * Math.sin(u * 23)), amp: 0.8, a: 0.15, r: 0.3, ratio: 1.5, index: 1.2, h2: 0.3 });
    noiseBurst(a, sr, { at: 0, dur: len, amp: 0.25, f: 220, q: 1, a: 0.2, r: 0.4, color: "brown", rnd: r });
    verb(a, sr, 1.8, 0.35, 1200);
    return norm(a, 0.85);
  },
  icePing(sr, r) {
    const a = buf1(sr, 1.6);
    const n = 1 + Math.floor(r() * 3);
    let at = 0.01;
    for (let i = 0; i < n; i++) {
      const f0 = 2600 + r() * 1800, f1 = 220 + r() * 200, d = 0.18 + r() * 0.25;
      fmNote(a, sr, { at, dur: d, f: (u) => f0 * Math.pow(f1 / f0, Math.sqrt(u)), amp: 0.9 / (i + 1), a: 0.01, r: 0.5 });
      at += 0.12 + r() * 0.25;
    }
    echoes(a, sr, [[0.21, 0.3], [0.47, 0.15]]);
    return norm(a, 0.85);
  },
};

// The loops: the night drone (two low sines a fifth apart and the octave, whole periods in 5 s so it loops clean),
// a river running (a low wash and a babble of bubbles), a lake lapping (swells, a slap at each crest, small plops).
function droneLoop(sr) {
  const len = 5, a = buf1(sr, len);
  for (const [f, g, tri] of [[55, 0.6, false], [82.8, 0.45, false], [110.4, 0.15, true]]) {
    for (let i = 0; i < a.length; i++) {
      const ph = (f * i / sr) % 1;
      a[i] += g * (tri ? (ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph) : Math.sin(2 * Math.PI * ph));
    }
  }
  filterIn(a, "lowpass", 300, 0.7, sr);
  filterIn(a, "lowpass", 300, 0.7, sr);
  return norm(a, 0.8);
}
function riverLoop(sr, r) {
  const len = 8, a = buf1(sr, len + 0.5);
  noiseBurst(a, sr, { at: 0, dur: len + 0.5, amp: 0.55, f: 450, q: 0.5, a: 0.001, r: 0.001, color: "brown", f2: 1400, rnd: r });
  noiseBurst(a, sr, { at: 0, dur: len + 0.5, amp: 0.12, f: 2200, q: 0.7, a: 0.001, r: 0.001, rnd: r });
  const n = Math.round((len + 0.5) * 80);
  for (let i = 0; i < n; i++) bubble(a, sr, { at: r() * (len + 0.45), f: 300 + Math.pow(r(), 1.5) * 1400, up: 1.4 + r() * 1.2, tau: 0.004 + r() * 0.008, amp: 0.08 + Math.pow(r(), 3) * 0.5 });
  return norm(seamLoop(a, sr, len, 0.45), 0.8);
}
function lakeLoop(sr, r) {
  const len = 8, a = buf1(sr, len + 0.5);
  let at = r() * 0.5;
  while (at < len + 0.2) {
    const d = 1.6 + r() * 1.3;
    noiseBurst(a, sr, { at, dur: d, amp: 0.5 + r() * 0.3, f: 380, q: 0.6, a: 0.45, r: 0.5, color: "brown", f2: 900, rnd: r }); // the swell
    const crest = at + d * 0.45;
    noiseBurst(a, sr, { at: crest, dur: 0.12, amp: 0.35 + r() * 0.3, f: 600 + r() * 500, q: 1, tau: 0.03, rnd: r }); // the slap
    for (let k = 0; k < 3 + r() * 4; k++) bubble(a, sr, { at: crest + r() * 0.6, f: 220 + r() * 500, up: 1.6 + r(), tau: 0.01 + r() * 0.01, amp: 0.15 + r() * 0.25 });
    noiseBurst(a, sr, { at: crest + 0.1, dur: d * 0.5, amp: 0.06, f: 3000, q: 0.5, a: 0.3, r: 0.6, rnd: r }); // the backwash
    at += d * (0.55 + r() * 0.35);
  }
  return norm(seamLoop(a, sr, len, 0.5), 0.8);
}
