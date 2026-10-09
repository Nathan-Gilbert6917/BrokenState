// Sound: every sound is made on the spot with WebAudio (oscillators, filtered noise and envelopes), so there are no
// audio files. ui/soundcues.js decides what to play from the game's state; this module plays it.
//
//   sfx(name, opts)          one sound (VOICES below); opts { gain, delay (s), pitch, pan }
//   audioFrame(state, ui)    main.js calls it every frame: the battle's and the map's cues, the ambience
//   initAudio(options, save) main.js at startup: the Sound options, the first-gesture unlock, button clicks, focus
//
// Buses: effects (the UI, cards, battle) and ambience (wind, rain, thunder, the night drone, birds, crickets) go to a
// master gain and a gentle compressor. Browsers keep sound locked until the player clicks or presses a key: the
// context is made (or resumed) on that first gesture. Muted, or with the window in the background and "Mute when
// not focused" on, the context is suspended (no CPU). Nothing here runs at import time, so node tools can import it.
import { battleCues, worldCues, ambienceMix, makeThrottle, LISTEN } from "./soundcues.js";
import { installBus, spatial } from "./gunsfx.js"; // the gun voices, the battle's sound space (pan, distance, reverb, ducking, the deafened muffle)
import { frameListener, playCue, cueSpan, prewarmBattle } from "./battlesfx.js"; // guns, blasts and handling cues to their voices
import { LAB, LAB_ACTIONS, LAB_CHANGE, labGunHtml, makeLimiter } from "./sfxlab.js"; // Settings → Sound: the gun and blast sound test
import { weatherAt, season } from "../sim/weather.js";
import { playerTile } from "../sim/hardcore-start.js";
import { screenToTile, view } from "./render.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");

// ---------- options ----------
// options.sound (ui/saves.js keeps it with the other options): volumes 0–1, mute, mute when the window is not focused.
export const SOUND_DEFAULTS = { master: 0.7, sfx: 0.8, amb: 0.5, mute: false, muteBlur: true };
const vol = (v, d) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(1, Number(v))) : d);
export function soundOptions(o) {
  const s = o && typeof o.sound === "object" && o.sound ? o.sound : {};
  const D = SOUND_DEFAULTS;
  const clean = {
    master: vol(s.master, D.master), sfx: vol(s.sfx, D.sfx), amb: vol(s.amb, D.amb),
    mute: typeof s.mute === "boolean" ? s.mute : D.mute, muteBlur: typeof s.muteBlur === "boolean" ? s.muteBlur : D.muteBlur,
  };
  if (o) o.sound = clean;
  return clean;
}
// Slider position to gain: squared, so the low half of the slider is usable (loudness is not linear).
const curve = (v) => v * v;
const SFX_TRIM = 0.8, AMB_TRIM = 1; // the buses' fixed levels under their sliders

// ---------- the engine ----------
let OPT = null;          // main.js's options object
let SAVE = () => {};
let A = null;            // { ctx, master, sfx, amb, comp, amb layers… } once the first gesture made the context
let offWanted = false;   // the context was suspended on purpose (muted, window in the background)
const LIMITS = {
  click: { gap: 0.04, max: 3 }, cardRoutine: { gap: 1, max: 1 }, cardWarning: { gap: 1, max: 1 }, cardCrisis: { gap: 1, max: 1 },
  alert: { gap: 2.5, max: 1 }, good: { gap: 3, max: 1 }, bark: { gap: 0.5, max: 1 }, alarm: { gap: 12, max: 1 }, horde: { gap: 6, max: 1 }, battle: { gap: 3, max: 1 },
  pistol: { gap: 0.045, max: 4 }, revolver: { gap: 0.045, max: 4 }, rifle: { gap: 0.045, max: 4 }, shotgun: { gap: 0.06, max: 3 },
  suppressed: { gap: 0.045, max: 4 }, bow: { gap: 0.05, max: 3 }, auto: { gap: 0.1, max: 3 }, acid: { gap: 0.1, max: 2 },
  launcher: { gap: 0.1, max: 2 }, rocket: { gap: 0.2, max: 2 }, reload: { gap: 0.1, max: 3 }, jam: { gap: 0.1, max: 2 }, unjam: { gap: 0.1, max: 2 },
  dry: { gap: 0.06, max: 2 }, empty: { gap: 0.06, max: 2 }, taser: { gap: 0.1, max: 2 },
  hit: { gap: 0.04, max: 3 }, whiz: { gap: 0.08, max: 2 }, ricochet: { gap: 0.08, max: 2 },
  melee: { gap: 0.06, max: 3 }, meleeCrit: { gap: 0.06, max: 3 }, whoosh: { gap: 0.06, max: 3 }, bite: { gap: 0.06, max: 3 },
  groan: { gap: 0.8, max: 2 }, scream: { gap: 0.5, max: 1 }, blast: { gap: 0.15, max: 2 }, fire: { gap: 0.3, max: 2 },
  glass: { gap: 0.2, max: 2 }, hiss: { gap: 0.2, max: 2 }, flare: { gap: 0.2, max: 2 }, downed: { gap: 0.4, max: 2 }, death: { gap: 0.4, max: 2 },
  thunder: { gap: 4, max: 1 }, bird: { gap: 0.3, max: 2 }, cricket: { gap: 0.15, max: 2 },
};
const throttle = makeThrottle(LIMITS, 28);
export const audioDebug = { played: [], dropped: 0, get ctx() { return A && A.ctx; } }; // for tests in the browser

const live = () => !!A && (A.test || A.ctx.state === "running");
const focused = () => typeof document === "undefined" || (!document.hidden && (typeof document.hasFocus !== "function" || document.hasFocus()));
function wantOn() {
  const s = OPT ? OPT.sound : SOUND_DEFAULTS;
  return !!s && !s.mute && s.master > 0 && !(s.muteBlur && !focused());
}

// test: an OfflineAudioContext to play into instead of the speakers (audioDebug.offline, for tests in the browser).
function makeContext(test = null) {
  if (A && !test) return A;
  const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!AC && !test) return null;
  let ctx = test;
  if (!ctx) try { ctx = new AC({ latencyHint: "interactive" }); } catch { return null; }
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.25;
  comp.connect(ctx.destination);
  const master = ctx.createGain(), sfxBus = ctx.createGain(), ambBus = ctx.createGain();
  master.gain.value = 0;
  master.connect(comp);
  const limit = makeLimiter(ctx); // full auto and blasts on top of each other never clip (ui/sfxlab.js makeLimiter)
  sfxBus.connect(limit);
  limit.connect(master);
  ambBus.connect(master);
  const gb = installBus(ctx, sfxBus); // the battle's sounds: ducked by a close blast, muffled while deafened, a reverb by place (ui/gunsfx.js)
  A = { ctx, comp, limit, gb, master, sfx: sfxBus, amb: ambBus, layers: null, next: { thunder: 0, bird: 0, cricket: 0 }, mix: null, test: !!test };
  applyGains(true);
  return A;
}
// The volumes and the mute (also the window's focus): the buses follow the sliders, and a silent context is suspended.
export function applyGains(now = false) {
  if (!A || !OPT) return;
  const s = OPT.sound, t = A.ctx.currentTime, on = wantOn();
  const set = (p, v) => (now ? p.setValueAtTime(v, t) : p.setTargetAtTime(v, t, 0.08));
  set(A.master.gain, on ? curve(s.master) : 0);
  set(A.sfx.gain, curve(s.sfx) * SFX_TRIM);
  set(A.amb.gain, curve(s.amb) * AMB_TRIM);
  if (A.test) return;
  if (!on && A.ctx.state === "running") {
    offWanted = true;
    setTimeout(() => { if (!wantOn() && A.ctx.state === "running") A.ctx.suspend().catch(() => {}); }, 300); // after the fade
  } else if (on && A.ctx.state === "suspended" && (offWanted || A.unlocked)) {
    offWanted = false;
    A.ctx.resume().catch(() => {});
  }
}
// The first click or key press makes the context (browsers block sound before one).
function unlock() {
  const a = makeContext();
  if (!a) return;
  a.unlocked = true;
  if (wantOn() && a.ctx.state !== "running") a.ctx.resume().catch(() => {});
  applyGains();
}

export function initAudio(options, save) {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  OPT = options;
  SAVE = save || (() => {});
  soundOptions(OPT);
  for (const ev of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(ev, unlock, { capture: true, passive: true });
  window.addEventListener("blur", () => applyGains());
  window.addEventListener("focus", () => applyGains());
  document.addEventListener("visibilitychange", () => applyGains());
  // A soft click on every button the player presses.
  document.addEventListener("click", (ev) => {
    const el = ev.target && ev.target.closest ? ev.target.closest("button, [data-action]") : null;
    if (!el || el.disabled || el.tagName === "SELECT" || el.tagName === "INPUT" || el.dataset.action === "snd-test" || el.dataset.action === "lab-play") return;
    sfx("click");
  });
  // A volume slider being dragged is heard at once (the change event saves it: SOUND_CHANGE).
  document.addEventListener("input", (ev) => {
    const el = ev.target;
    if (!el || !el.dataset || el.dataset.action !== "snd-vol") return;
    setVolume(el.dataset.k, Number(el.value) / 100);
    const out = el.parentElement && el.parentElement.querySelector(".sndval");
    if (out) out.textContent = `${Math.round(Number(el.value))}%`;
  });
}
function setVolume(k, v) {
  if (!OPT || !["master", "sfx", "amb"].includes(k)) return;
  OPT.sound[k] = vol(v, SOUND_DEFAULTS[k]);
  applyGains();
}

// A sound's options: gain 1 and a pitch a few percent either way unless given (an undefined gain is not given).
export const voiceOpts = (opts = {}) => ({ ...opts, gain: Number.isFinite(opts.gain) ? opts.gain : 1, pitch: Number.isFinite(opts.pitch) ? opts.pitch : 0.94 + Math.random() * 0.12 });
// Plays one sound. False when it was not played (no context yet, muted, the throttle said no).
export function sfx(name, opts = {}) {
  const V = VOICES[name];
  if (!V || !live() || !wantOn()) return false;
  const ctx = A.ctx;
  const t = ctx.currentTime + 0.01 + Math.max(0, opts.delay || 0);
  if (!throttle.allow(name, t, V.dur)) { audioDebug.dropped++; return false; }
  let out = V.amb ? A.amb : opts.battle && A.gb ? A.gb.in : A.sfx;
  if (opts.lp > 0 && opts.lp < Math.min(16000, ctx.sampleRate * 0.45)) { // far away or out of sight (ui/gunsfx.js spatial)
    const f = ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = opts.lp; f.Q.value = 0.6;
    f.connect(out);
    out = f;
  }
  if (opts.pan && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, opts.pan));
    p.connect(out);
    out = p;
  }
  try {
    V.play(ctx, out, t, voiceOpts(opts));
  } catch (e) {
    console.warn(`Broken State: the ${name} sound failed`, e);
    return false;
  }
  audioDebug.played.push(name);
  if (audioDebug.played.length > 60) audioDebug.played.shift();
  return true;
}

// ---------- every frame (main.js) ----------
const battleMem = {};
const worldMem = {};
let lastWorld = 0, lastAmb = 0;
export function audioFrame(state, ui, nowMs = performance.now()) {
  if (!OPT || !state) return;
  const now = nowMs / 1000;
  const on = live();
  // The memories move on even while silent, so unmuting does not play what happened meanwhile.
  if (state.combat && !ui.timelapse) {
    const cues = battleCues(state.combat, battleMem, now);
    if (on && A.warm !== state.combat) { A.warm = state.combat; prewarmBattle(A.ctx, state, state.combat); } // bake its guns, blasts and reverb while it opens
    if (on && cues.length) {
      const L = frameListener(state, state.combat, LISTEN); // where you are listening from: the selected unit, the view, the fog
      for (const c of cues) battleSound(c, L);
    }
    if (on && A.gb) A.gb.setMuffle(!!battleMem.deaf); // deafened: everything through a low-pass
  }
  if (nowMs - lastWorld >= 150 && ui.started && !ui.timelapse) {
    lastWorld = nowMs;
    for (const c of worldCues(state, ui, worldMem)) if (on) sfx(c.name, { gain: c.gain, delay: c.delay });
  }
  if (nowMs - lastAmb >= 250) {
    lastAmb = nowMs;
    if (on) ambience(state, ui);
  }
}

// A battle cue: a gun, a blast or a handling sound (ui/battlesfx.js), else one of the VOICES placed where it happens.
function battleSound(c, L) {
  if (!(c.gun || c.blast || c.hand)) {
    const sp = c.at && L ? spatial(L, c.at[0], c.at[1], { enemy: c.enemy }) : null;
    return sfx(c.name, { gain: (c.gain ?? 1) * (sp ? sp.gain : 1), delay: (c.delay || 0) + (sp ? sp.delay : 0), pan: sp ? sp.pan : (Math.random() - 0.5) * 0.5, lp: sp ? sp.lp : 0, battle: true });
  }
  if (!live() || !wantOn()) return false;
  const ctx = A.ctx, base = ctx.currentTime + 0.01, t = base + Math.max(0, c.delay || 0);
  if (!throttle.allow(c.name, t, cueSpan(c))) { audioDebug.dropped++; return false; }
  try { playCue(ctx, base, t, c, L); } catch (e) { console.warn(`Broken State: the ${c.name} sound failed`, e); return false; }
  audioDebug.played.push(c.name);
  if (audioDebug.played.length > 60) audioDebug.played.shift();
  return true;
}

// ---------- ambience ----------
// Where the player is listening: the battle's tile, else the middle of the map view (the hub as a fallback). Weather
// is read through weatherAt so a regional sky (one per area) is heard where the camera is.
function listenTile(state) {
  if (state.combat && state.combat.setup && state.combat.setup.tile != null) return state.combat.setup.tile;
  try {
    const c = document.getElementById("map");
    if (c && c.clientWidth) {
      const t = screenToTile(state, c.clientWidth / 2, c.clientHeight / 2);
      if (t != null && t >= 0 && state.tiles && state.tiles[t]) return t;
    }
  } catch { /* no map yet */ }
  return playerTile(state);
}
function ambienceTarget(state, ui) {
  const off = { wind: 0, windTone: 400, rain: 0, rainLow: 0, thunder: 0, drone: 0, birds: 0, crickets: 0 };
  if (ui.timelapse) return off;
  if (ui.title || !ui.started) return { ...off, wind: 0.3, drone: 0.45 }; // the title and new-run screens: wind and the drone
  let wx = null, sKey = "summer";
  try {
    wx = weatherAt(state, listenTile(state));
    sKey = season(state).key;
  } catch { /* a world with no weather yet */ }
  const mix = ambienceMix(wx, (state.hour % 24) + (view.hourFrac || 0), sKey);
  if (state.combat) mix.birds = 0; // the birds keep quiet in a firefight
  return mix;
}
function layers() {
  if (A.layers) return A.layers;
  const c = A.ctx, L = {};
  const white = loopNoise(c, "white"), brown = loopNoise(c, "brown");
  // Wind: brown noise through a band that drifts, with slow gusts.
  L.windBand = c.createBiquadFilter(); L.windBand.type = "bandpass"; L.windBand.Q.value = 0.9; L.windBand.frequency.value = 400;
  L.gust = c.createGain(); L.gust.gain.value = 1;
  L.wind = c.createGain(); L.wind.gain.value = 0;
  brown.connect(L.windBand); L.windBand.connect(L.gust); L.gust.connect(L.wind); L.wind.connect(A.amb);
  lfo(c, 0.09, 0.45, L.gust.gain);
  lfo(c, 0.05, 120, L.windBand.frequency);
  // Rain: white noise, high and bright, over a low wash (a storm's roar).
  const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1200;
  const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 7000;
  L.rain = c.createGain(); L.rain.gain.value = 0;
  white.connect(hp); hp.connect(lp); lp.connect(L.rain); L.rain.connect(A.amb);
  const low = c.createBiquadFilter(); low.type = "lowpass"; low.frequency.value = 450;
  L.rainLow = c.createGain(); L.rainLow.gain.value = 0;
  brown.connect(low); low.connect(L.rainLow); L.rainLow.connect(A.amb);
  // The drone: two low sines a fifth apart, beating slowly, and an octave above, under a low-pass.
  const dlp = c.createBiquadFilter(); dlp.type = "lowpass"; dlp.frequency.value = 300;
  L.drone = c.createGain(); L.drone.gain.value = 0;
  for (const [f, type, g] of [[55, "sine", 0.6], [82.8, "sine", 0.45], [110.4, "triangle", 0.15]]) {
    const o = c.createOscillator(); o.type = type; o.frequency.value = f;
    const og = c.createGain(); og.gain.value = g;
    o.connect(og); og.connect(dlp); o.start();
  }
  dlp.connect(L.drone); L.drone.connect(A.amb);
  lfo(c, 0.04, 0.02, L.drone.gain);
  A.layers = L;
  return L;
}
// Layer levels: how loud each one is at mix 1 (under the ambience slider). Fades are slow (weather changes by the day,
// night comes over two hours).
export const AMB_LEVELS = { wind: 0.32, rain: 0.26, rainLow: 0.3, drone: 0.13 };
function ambience(state, ui) {
  const L = layers(), c = A.ctx, t = c.currentTime;
  const m = ambienceTarget(state, ui);
  A.mix = m;
  L.wind.gain.setTargetAtTime(m.wind * AMB_LEVELS.wind, t, 1.5);
  L.windBand.frequency.setTargetAtTime(m.windTone, t, 2);
  L.rain.gain.setTargetAtTime(m.rain * AMB_LEVELS.rain, t, 1.5);
  L.rainLow.gain.setTargetAtTime(m.rainLow * AMB_LEVELS.rainLow, t, 1.5);
  L.drone.gain.setTargetAtTime(m.drone * AMB_LEVELS.drone, t, 3);
  // The one-shots: thunder every 12–40 s in a storm, birds every few seconds (more at dawn), cricket trains.
  const N = A.next;
  if (m.thunder && t >= N.thunder) { if (N.thunder) sfx("thunder", { near: Math.random() }); N.thunder = t + 12 + Math.random() * 28; }
  if (!m.thunder) N.thunder = 0;
  if (m.birds > 0.05 && t >= N.bird) { if (N.bird) sfx("bird", { gain: 0.5 + m.birds * 0.5 }); N.bird = t + (2 + Math.random() * 8) / m.birds; }
  if (m.crickets > 0.05 && t >= N.cricket) { if (N.cricket) sfx("cricket", { gain: m.crickets }); N.cricket = t + 0.6 + Math.random() * 1.6 / m.crickets; }
}

// ---------- building blocks ----------
const NOISE = new WeakMap(); // context -> { white, brown }
function buffers(c) {
  let b = NOISE.get(c);
  if (b) return b;
  const n = (secs) => c.createBuffer(1, Math.floor(c.sampleRate * secs), c.sampleRate);
  const white = n(1.5), brown = n(3);
  const w = white.getChannelData(0), br = brown.getChannelData(0);
  for (let i = 0; i < w.length; i++) w[i] = Math.random() * 2 - 1;
  let last = 0;
  for (let i = 0; i < br.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; br[i] = last * 3.5; }
  b = { white, brown };
  NOISE.set(c, b);
  return b;
}
function loopNoise(c, kind) {
  const s = c.createBufferSource();
  s.buffer = buffers(c)[kind];
  s.loop = true;
  s.start();
  return s;
}
// A slow wobble added to a parameter: depth either way, rate in Hz.
function lfo(c, rate, depth, param) {
  const o = c.createOscillator(); o.frequency.value = rate;
  const g = c.createGain(); g.gain.value = depth;
  o.connect(g); g.connect(param); o.start();
  return o;
}
// An envelope: a gain node into dest that rises to peak in a seconds, holds, and dies away over d.
function env(c, dest, t, peak, d, a = 0.002, hold = 0) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t + a);
  if (hold) g.gain.setValueAtTime(Math.max(0.0002, peak), t + a + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + d);
  g.connect(dest);
  return g;
}
function filt(c, type, f, q, dest) {
  const n = c.createBiquadFilter();
  n.type = type;
  n.frequency.value = f;
  if (q != null) n.Q.value = q;
  n.connect(dest);
  return n;
}
// Noise of a kind for dur seconds from t (a random spot in the loop, so no two shots are the same).
function noise(c, kind, t, dur, dest, rate = 1) {
  const s = c.createBufferSource();
  s.buffer = buffers(c)[kind];
  s.loop = true;
  s.playbackRate.value = rate;
  s.connect(dest);
  s.start(t, Math.random() * (s.buffer.duration - 0.2));
  s.stop(t + dur + 0.05);
  return s;
}
// A tone gliding from f0 to f1 over glide seconds.
function tone(c, type, f0, f1, t, dur, dest, glide = dur) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + glide);
  if (dest) o.connect(dest);
  o.start(t);
  o.stop(t + dur + 0.05);
  return o;
}
const R = (a, b) => a + Math.random() * (b - a);

// A gunshot: a crack (high noise), the body (a band of noise), the boom and its tail (low noise), a thump in the chest.
function gun(c, out, t, o, s) {
  const g = o.gain, p = o.pitch;
  if (s.crack) noise(c, "white", t, 0.06, filt(c, "highpass", 2500 * p, 0.7, env(c, out, t, s.crack * g, s.crackD || 0.035, 0.001)));
  noise(c, "white", t, s.bodyD + 0.05, filt(c, "bandpass", s.band * p, s.q || 0.9, env(c, out, t, s.body * g, s.bodyD, 0.001)));
  noise(c, "brown", t, s.tail + 0.1, filt(c, "lowpass", s.lp * p, 0.7, env(c, out, t, s.boom * g, s.tail, 0.003)));
  tone(c, "sine", s.thumpF * p, 40, t, 0.12, env(c, out, t, s.thump * g, 0.1, 0.002), 0.09);
  if (s.echo) noise(c, "brown", t + s.echo, s.tail + 0.1, filt(c, "lowpass", s.lp * 0.7, 0.7, env(c, out, t + s.echo, s.boom * g * 0.35, s.tail, 0.01)));
}
const PISTOL = { crack: 0.6, band: 1600, body: 0.7, bodyD: 0.09, lp: 700, boom: 0.4, tail: 0.25, thumpF: 150, thump: 0.5 };
const REVOLVER = { crack: 0.8, band: 1200, body: 0.85, bodyD: 0.12, lp: 650, boom: 0.65, tail: 0.45, thumpF: 130, thump: 0.75, echo: 0.16 };
const RIFLE = { crack: 1, crackD: 0.025, band: 2000, body: 0.6, bodyD: 0.08, lp: 700, boom: 0.75, tail: 0.7, thumpF: 120, thump: 0.6, echo: 0.2 };
const SHOTGUN = { crack: 0.5, band: 900, q: 0.6, body: 1, bodyD: 0.16, lp: 1200, boom: 0.9, tail: 0.5, thumpF: 95, thump: 1 };
const BURST = { crack: 0.8, crackD: 0.02, band: 1900, body: 0.6, bodyD: 0.06, lp: 750, boom: 0.4, tail: 0.25, thumpF: 120, thump: 0.5 };
// A metallic bell: inharmonic partials, the high ones dying first.
function bell(c, out, t, f, peak, d) {
  for (const [r, a, k] of [[1, 1, 1], [2.76, 0.5, 0.6], [5.4, 0.25, 0.4], [8.93, 0.12, 0.25]]) tone(c, "sine", f * r, 0, t, d * k, env(c, out, t, peak * a, d * k, 0.002));
}
// Short sparkly pings (breaking glass).
function shards(c, out, t, n, peak) {
  for (let i = 0; i < n; i++) {
    const tt = t + R(0, 0.09);
    tone(c, "sine", R(2500, 5200), 0, tt, 0.12, env(c, out, tt, peak * R(0.4, 1), R(0.04, 0.12), 0.001));
  }
  noise(c, "white", t, 0.12, filt(c, "highpass", 4000, 0.7, env(c, out, t, peak * 0.8, 0.1, 0.001)));
}
// Crackle: tiny clicks of noise spread over a while.
function crackle(c, out, t, n, span, peak) {
  for (let i = 0; i < n; i++) {
    const tt = t + R(0, span);
    noise(c, "white", tt, 0.02, filt(c, "bandpass", R(1500, 4000), 1.5, env(c, out, tt, peak * R(0.3, 1), R(0.008, 0.02), 0.001)));
  }
}
// A low thud (a body, a club, a drum).
function thud(c, out, t, f, peak, d) {
  tone(c, "sine", f, f * 0.45, t, d + 0.05, env(c, out, t, peak, d, 0.002), d);
  noise(c, "brown", t, d, filt(c, "lowpass", f * 4, 0.7, env(c, out, t, peak * 0.8, d * 0.8, 0.002)));
}
// Notes for the chimes: [frequency, start offset] with a soft envelope.
function notes(c, out, t, type, list, peak, d, lp = 0) {
  const dest = lp ? filt(c, "lowpass", lp, 0.7, out) : out;
  for (const [f, at] of list) tone(c, type, f, 0, t + at, d, env(c, dest, t + at, peak, d, 0.01));
}

// ---------- the sounds ----------
// dur: how long it rings (for the throttle); amb: on the ambience bus. Each one's feel is in the README (Sound).
export const VOICES = {
  // The interface.
  click: { dur: 0.04, play(c, out, t, o) {
    tone(c, "sine", 1700 * o.pitch, 1100, t, 0.03, env(c, out, t, 0.12 * o.gain, 0.025, 0.001));
    noise(c, "white", t, 0.01, filt(c, "highpass", 5000, 0.7, env(c, out, t, 0.04 * o.gain, 0.008, 0.001)));
  } },
  cardRoutine: { dur: 0.5, play(c, out, t, o) { notes(c, out, t, "sine", [[659, 0], [880, 0.09]], 0.16 * o.gain, 0.35); notes(c, out, t, "triangle", [[1318, 0.09]], 0.03 * o.gain, 0.25); } },
  cardWarning: { dur: 0.7, play(c, out, t, o) { notes(c, out, t, "triangle", [[392, 0], [311, 0.16]], 0.24 * o.gain, 0.5, 2200); } },
  cardCrisis: { dur: 1.2, play(c, out, t, o) {
    const lp = filt(c, "lowpass", 900, 1, out);
    const g = env(c, lp, t, 0.2 * o.gain, 0.9, 0.02, 0.15);
    lfo(c, 6, 0.06 * o.gain, g.gain).stop(t + 1.2);
    for (const f of [147, 208]) tone(c, "sawtooth", f, f * 0.97, t, 1.1, g);
    thud(c, out, t, 70, 0.5 * o.gain, 0.3);
  } },
  alert: { dur: 0.8, play(c, out, t, o) { bell(c, out, t, 1320, 0.12 * o.gain, 0.7); } },
  good: { dur: 0.45, play(c, out, t, o) { notes(c, out, t, "sine", [[1047, 0], [1568, 0.08]], 0.09 * o.gain, 0.3); } },
  // An important combat bark (ui/barks.js: someone going down, the shout that they are): a short radio-like chirp.
  bark: { dur: 0.16, play(c, out, t, o) { notes(c, out, t, "square", [[880 * o.pitch, 0], [660 * o.pitch, 0.06]], 0.035 * o.gain, 0.08, 2400); } },

  // Gunfire by weapon class (soundcues.js weaponSound).
  pistol: { dur: 0.35, play(c, out, t, o) { gun(c, out, t, o, PISTOL); } },
  revolver: { dur: 0.7, play(c, out, t, o) { gun(c, out, t, o, REVOLVER); } },
  rifle: { dur: 1, play(c, out, t, o) { gun(c, out, t, o, RIFLE); } },
  shotgun: { dur: 0.7, play(c, out, t, o) {
    gun(c, out, t, o, SHOTGUN);
    for (const at of [0.42, 0.52]) noise(c, "white", t + at, 0.03, filt(c, "bandpass", 3000, 2, env(c, out, t + at, 0.18 * o.gain, 0.025, 0.001))); // the pump
  } },
  auto: { dur: 0.6, play(c, out, t, o) { for (let i = 0; i < 3; i++) gun(c, out, t + i * 0.075 + R(0, 0.008), o, BURST); } },
  suppressed: { dur: 0.2, play(c, out, t, o) {
    noise(c, "white", t, 0.08, filt(c, "bandpass", 700 * o.pitch, 1, env(c, out, t, 0.5 * o.gain, 0.06, 0.001)));
    noise(c, "white", t, 0.02, filt(c, "bandpass", 4000, 2, env(c, out, t, 0.15 * o.gain, 0.015, 0.001)));
    tone(c, "sine", 120, 50, t, 0.08, env(c, out, t, 0.3 * o.gain, 0.06, 0.002));
  } },
  bow: { dur: 0.3, play(c, out, t, o) {
    tone(c, "triangle", 180 * o.pitch, 140, t, 0.25, filt(c, "lowpass", 1200, 1, env(c, out, t, 0.35 * o.gain, 0.22, 0.002)));
    noise(c, "white", t + 0.01, 0.1, filt(c, "bandpass", 3000, 1.5, env(c, out, t + 0.01, 0.2 * o.gain, 0.08, 0.005)));
  } },
  acid: { dur: 0.35, play(c, out, t, o) {
    noise(c, "white", t, 0.3, filt(c, "bandpass", 700 * o.pitch, 2, env(c, out, t, 0.45 * o.gain, 0.25, 0.01)));
    tone(c, "sine", 220, 90, t, 0.22, env(c, out, t, 0.3 * o.gain, 0.2, 0.005));
  } },
  hit: { dur: 0.12, play(c, out, t, o) { thud(c, out, t, 110 * o.pitch, 0.5 * o.gain, 0.07); } },
  whiz: { dur: 0.18, play(c, out, t, o) {
    const f = filt(c, "bandpass", 4000, 6, env(c, out, t, 0.25 * o.gain, 0.12, 0.02));
    f.frequency.setValueAtTime(4000 * o.pitch, t);
    f.frequency.exponentialRampToValueAtTime(1500, t + 0.14);
    noise(c, "white", t, 0.16, f);
  } },
  ricochet: { dur: 0.4, play(c, out, t, o) {
    tone(c, "sine", 2600 * o.pitch, 1700, t, 0.35, env(c, out, t, 0.16 * o.gain, 0.33, 0.002));
    noise(c, "white", t, 0.02, filt(c, "highpass", 3000, 0.7, env(c, out, t, 0.2 * o.gain, 0.015, 0.001)));
  } },

  // Melee and the dead.
  melee: { dur: 0.15, play(c, out, t, o) { thud(c, out, t, 140 * o.pitch, 0.7 * o.gain, 0.1); } },
  meleeCrit: { dur: 0.2, play(c, out, t, o) {
    thud(c, out, t, 120 * o.pitch, 0.9 * o.gain, 0.14);
    noise(c, "white", t + 0.005, 0.08, filt(c, "bandpass", 1800, 1.5, env(c, out, t + 0.005, 0.6 * o.gain, 0.06, 0.001))); // the crunch
  } },
  whoosh: { dur: 0.25, play(c, out, t, o) {
    const f = filt(c, "bandpass", 500, 1.5, env(c, out, t, 0.35 * o.gain, 0.14, 0.07));
    f.frequency.setValueAtTime(500 * o.pitch, t);
    f.frequency.exponentialRampToValueAtTime(1600, t + 0.1);
    f.frequency.exponentialRampToValueAtTime(400, t + 0.22);
    noise(c, "white", t, 0.24, f);
  } },
  bite: { dur: 0.45, play(c, out, t, o) {
    const crunch = env(c, out, t, 0.5 * o.gain, 0.16, 0.003);
    const am = c.createGain(); am.gain.value = 0.5; am.connect(crunch);
    lfo(c, 30, 0.5, am.gain).stop(t + 0.3);
    noise(c, "white", t, 0.2, filt(c, "bandpass", 1400 * o.pitch, 1.2, am));
    const growl = tone(c, "sawtooth", 85 * o.pitch, 70, t, 0.4, filt(c, "lowpass", 600, 1, env(c, out, t, 0.3 * o.gain, 0.3, 0.03, 0.05)));
    lfo(c, 9, 6, growl.frequency).stop(t + 0.45);
  } },
  groan: { dur: 1.6, play(c, out, t, o) {
    const f0 = R(70, 110) * o.pitch, d = R(1, 1.5);
    const g = env(c, out, t, 0.32 * o.gain, d, 0.25, 0.15);
    const voice = c.createOscillator();
    voice.type = "sawtooth";
    voice.frequency.setValueAtTime(f0, t);
    voice.frequency.exponentialRampToValueAtTime(f0 * 0.8, t + d + 0.3);
    voice.start(t);
    voice.stop(t + d + 0.45);
    for (const [a, b, q, k] of [[450, 600, 4, 1], [1000, 800, 5, 0.5]]) { // two formants gliding: a mouth that opens
      const f = c.createBiquadFilter(); f.type = "bandpass"; f.Q.value = q;
      f.frequency.setValueAtTime(a, t); f.frequency.linearRampToValueAtTime(b, t + d);
      const fg = c.createGain(); fg.gain.value = k;
      voice.connect(f); f.connect(fg); fg.connect(g);
    }
    lfo(c, R(4, 6), 3, voice.frequency).stop(t + d + 0.5);
  } },
  scream: { dur: 0.9, play(c, out, t, o) {
    const v = c.createOscillator(); v.type = "sawtooth";
    v.frequency.setValueAtTime(700 * o.pitch, t); v.frequency.linearRampToValueAtTime(950, t + 0.25); v.frequency.linearRampToValueAtTime(600, t + 0.85);
    v.connect(filt(c, "bandpass", 1500, 1, env(c, out, t, 0.25 * o.gain, 0.6, 0.05, 0.2)));
    lfo(c, 7, 30, v.frequency).stop(t + 0.9);
    v.start(t); v.stop(t + 0.9);
    noise(c, "white", t, 0.85, filt(c, "bandpass", 2500, 1, env(c, out, t, 0.08 * o.gain, 0.6, 0.05, 0.2)));
  } },
  // Throwables: a pipe bomb or a grenade, a Molotov, a bottle or a noise maker, smoke, a flare.
  blast: { dur: 1.8, play(c, out, t, o) {
    noise(c, "white", t, 0.1, filt(c, "lowpass", 3000, 0.7, env(c, out, t, 1 * o.gain, 0.08, 0.001)));
    const lp = filt(c, "lowpass", 900, 0.7, env(c, out, t, 1.2 * o.gain, 1.6, 0.005));
    lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(120, t + 1.2);
    noise(c, "brown", t, 1.7, lp, 0.8);
    tone(c, "sine", 60, 28, t, 0.6, env(c, out, t, 1 * o.gain, 0.5, 0.003));
    crackle(c, out, t + 0.3, 8, 0.6, 0.25 * o.gain); // debris coming down
  } },
  fire: { dur: 1.6, play(c, out, t, o) {
    shards(c, out, t, 5, 0.25 * o.gain);
    const f = filt(c, "bandpass", 300, 0.8, env(c, out, t + 0.05, 0.6 * o.gain, 0.6, 0.1));
    f.frequency.setValueAtTime(300, t + 0.05); f.frequency.exponentialRampToValueAtTime(1500, t + 0.65);
    noise(c, "white", t + 0.05, 0.8, f); // the whoosh as it catches
    crackle(c, out, t + 0.3, 12, 1.2, 0.18 * o.gain);
  } },
  glass: { dur: 0.25, play(c, out, t, o) { shards(c, out, t, 3, 0.15 * o.gain); } },
  ring: { dur: 1.4, play(c, out, t, o) { tone(c, "sine", 3800 * o.pitch, 3700, t, 1.3, env(c, out, t, 0.05 * o.gain, 1.2, 0.02)); } }, // tinnitus: the ears ringing after a bang (soundcues.js, sim/hearing.js)
  hiss: { dur: 1.1, play(c, out, t, o) { noise(c, "white", t, 1, filt(c, "highpass", 3000, 0.7, env(c, out, t, 0.22 * o.gain, 0.8, 0.05, 0.2))); } },
  flare: { dur: 1.6, play(c, out, t, o) {
    tone(c, "sine", 400, 150, t, 0.06, env(c, out, t, 0.3 * o.gain, 0.05, 0.002));
    noise(c, "white", t + 0.05, 1.5, filt(c, "bandpass", 2500, 0.8, env(c, out, t + 0.05, 0.18 * o.gain, 0.9, 0.05, 0.5)));
  } },
  // Your people falling: a body hitting the ground and a tone that drops away; the dead get a low minor chord.
  downed: { dur: 1, play(c, out, t, o) {
    thud(c, out, t, 80, 0.9 * o.gain, 0.25);
    notes(c, out, t + 0.12, "sine", [[440, 0], [523, 0]], 0.1 * o.gain, 0.8);
    const lp = filt(c, "lowpass", 900, 0.7, env(c, out, t + 0.12, 0.12 * o.gain, 0.8, 0.02));
    tone(c, "triangle", 330, 165, t + 0.12, 0.85, lp);
  } },
  death: { dur: 2.4, play(c, out, t, o) {
    thud(c, out, t, 70, 0.9 * o.gain, 0.3);
    notes(c, out, t + 0.1, "triangle", [[110, 0], [130.8, 0.05], [164.8, 0.1]], 0.14 * o.gain, 2, 700);
  } },
  battle: { dur: 0.7, play(c, out, t, o) { thud(c, out, t, 90, 0.6 * o.gain, 0.3); thud(c, out, t + 0.28, 85, 0.85 * o.gain, 0.4); } },

  // The map: a horde newly seen near you, a raid on a base.
  horde: { dur: 2.6, play(c, out, t, o) {
    thud(c, out, t, 55, 1 * o.gain, 0.9);
    const lp = filt(c, "lowpass", 180, 1.2, env(c, out, t, 0.24 * o.gain, 1.9, 0.4, 0.2));
    lp.frequency.setValueAtTime(180, t); lp.frequency.linearRampToValueAtTime(1100, t + 1); lp.frequency.linearRampToValueAtTime(250, t + 2.4);
    for (const f of [73.4, 77.8, 110]) tone(c, "sawtooth", f, f * 0.98, t, 2.5, lp); // D, D# and A: a minor second's grind
  } },
  alarm: { dur: 1.3, play(c, out, t, o) { for (let i = 0; i < 6; i++) bell(c, out, t + i * 0.17, i % 2 ? 470 : 520, 0.22 * o.gain, 0.5); } },

  // Ambience one-shots (ambience bus).
  thunder: { dur: 5, amb: true, play(c, out, t, o) {
    const near = o.near ?? 0.5;
    if (near > 0.6) noise(c, "white", t, 0.3, filt(c, "lowpass", 3500, 0.7, env(c, out, t, 0.5 * o.gain, 0.25, 0.002)));
    const lp = filt(c, "lowpass", 120 + near * 200, 0.7, env(c, out, t, (0.45 + near * 0.45) * o.gain, 3.5, 0.2 + (1 - near) * 0.6));
    for (let i = 1; i <= 4; i++) lp.frequency.setValueAtTime(R(80, 140 + near * 260), t + i * 0.6);
    noise(c, "brown", t, 4.8, lp, 0.5);
  } },
  bird: { dur: 0.7, amb: true, play(c, out, t, o) {
    const n = 2 + Math.floor(Math.random() * 4), base = R(2500, 4500), up = R(1.1, 1.5);
    let tt = t;
    for (let i = 0; i < n; i++) {
      const f0 = base * R(0.9, 1.2);
      tone(c, "sine", f0, f0 * up, tt, 0.07, env(c, out, tt, 0.07 * o.gain, 0.06, 0.005));
      tt += R(0.07, 0.13);
    }
  } },
  cricket: { dur: 0.25, amb: true, play(c, out, t, o) {
    const f = R(4200, 4800);
    for (let i = 0; i < 3; i++) tone(c, "sine", f, 0, t + i * 0.045, 0.025, env(c, out, t + i * 0.045, 0.035 * o.gain, 0.02, 0.003));
  } },
};
export const SOUND_NAMES = Object.keys(VOICES);

// Renders one sound offline (no speakers, no gesture needed) and measures it: for tests in the browser.
audioDebug.renderOffline = async (name, opts = {}) => {
  const V = VOICES[name];
  const OAC = typeof window !== "undefined" && (window.OfflineAudioContext || window.webkitOfflineAudioContext);
  if (!V || !OAC) return null;
  const rate = 22050, c = new OAC(1, Math.ceil(rate * (V.dur + 0.3)), rate);
  V.play(c, c.destination, 0.01, { gain: 1, pitch: 1, ...opts });
  const buf = await c.startRendering();
  const d = buf.getChannelData(0);
  let peak = 0, sum = 0;
  for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; sum += v * v; }
  return { name, peak: Math.round(peak * 1000) / 1000, rms: Math.round(Math.sqrt(sum / d.length) * 1000) / 1000, nan: d.some((v) => Number.isNaN(v)) };
};

// Plays the game into an OfflineAudioContext for secs seconds instead of the speakers: audioFrame, sfx and the
// ambience all go there. finish() renders it, measures it and puts the speakers back. For tests in the browser.
audioDebug.offline = (secs = 4) => {
  const OAC = typeof window !== "undefined" && (window.OfflineAudioContext || window.webkitOfflineAudioContext);
  if (!OAC || !OPT) return null;
  const keep = A;
  A = null;
  makeContext(new OAC(2, Math.ceil(22050 * secs), 22050));
  const test = A;
  audioDebug.played.length = 0;
  return {
    get ctx() { return test.ctx; },
    get mix() { return test.mix; },
    async finish() {
      A = keep;
      const buf = await test.ctx.startRendering();
      const d = buf.getChannelData(0);
      let peak = 0, sum = 0, nan = false;
      for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (Number.isNaN(v)) nan = true; else { if (v > peak) peak = v; sum += v * v; } }
      return { peak: Math.round(peak * 1000) / 1000, rms: Math.round(Math.sqrt(sum / d.length) * 10000) / 10000, nan, played: [...audioDebug.played] };
    },
  };
};

// ---------- the Options tab (ui/settings.js) ----------
const SOUND_LABELS = {
  click: "Button click", cardRoutine: "Card: routine", cardWarning: "Card: warning", cardCrisis: "Card: crisis", alert: "Alert", good: "Good news", bark: "Combat bark",
  pistol: "Pistol", revolver: "Revolver", rifle: "Rifle", shotgun: "Shotgun", auto: "Assault rifle burst", suppressed: "Suppressed shot", bow: "Bow or crossbow",
  acid: "Acid spit", hit: "Bullet hit", whiz: "Miss (whiz)", ricochet: "Miss (ricochet)", melee: "Melee hit", meleeCrit: "Melee critical", whoosh: "Melee miss",
  bite: "Zombie bite", groan: "Zombie groan", scream: "Scream", blast: "Pipe bomb / grenade", fire: "Molotov", glass: "Bottle", hiss: "Smoke", flare: "Flare",
  downed: "Someone down", death: "Someone dies", battle: "Battle starts", horde: "Horde spotted", alarm: "Raid alarm", thunder: "Thunder", bird: "Birds", cricket: "Crickets",
};
let hearPick = "pistol";
export function soundOptionsHtml(options) {
  const s = soundOptions(options);
  const slider = (k, label, t) => `<label class="sndvol" style="margin-right:0.6rem"${tip(t)}>${label} <input type="range" min="0" max="100" step="5" value="${Math.round(s[k] * 100)}" data-action="snd-vol" data-k="${k}"> <span class="sndval">${Math.round(s[k] * 100)}%</span></label>`;
  const box = (k, on, label, t) => `<button class="setopt ${on ? "active" : ""}" data-action="snd-opt" data-k="${k}"${tip(t)}>${on ? "✔" : "✗"} ${label}</button>`;
  const locked = A ? A.ctx.state === "suspended" && !offWanted && !A.unlocked : !A;
  return `<h3>Sound</h3><div class="setrow">
      ${box("on", !s.mute, "Sound", "All sound on or off. Sounds are made on the spot (no audio files): clicks, card chimes, gunfire and the dead in battle, wind, rain and night around you, a sting when a horde is seen near you, the alarm bell when a base is raided.")}
      ${slider("master", "Master", "Everything")}
      ${slider("sfx", "Effects", "Clicks, card chimes, battle sounds, the horde sting and the alarm")}
      ${slider("amb", "Ambience", "Wind and rain with the weather, thunder in storms, a low drone at night, birds by day, crickets on warm nights")}
      ${box("muteBlur", s.muteBlur, "Mute when the window is not focused", "Silence while you are in another window or tab")}
    </div><div class="setrow">
      <label${tip("Hear one sound, to set the volumes or to judge it")}>Hear <select data-action="snd-pick">${SOUND_NAMES.map((n) => `<option value="${n}" ${n === hearPick ? "selected" : ""}>${esc(SOUND_LABELS[n] || n)}</option>`).join("")}</select></label>
      <button data-action="snd-test"${tip("Play the sound picked")}>▶ Play</button>
      ${locked ? `<span class="small muted">The browser starts sound after your first click or key press.</span>` : ""}
    </div>${labGunHtml()}`;
}
// The sound test plays through the game's own context and battle bus (ui/sfxlab.js).
LAB.ctx = () => { unlock(); return A && live() && wantOn() ? A.ctx : null; };
LAB.old = (name) => sfx(name, { pitch: 1 });
// Registered with the menu's actions (ui/settings.js): fn(state, ui, data, api) and fn(state, ui, el, api).
export const SOUND_ACTIONS = {
  "snd-opt": (state, ui, d) => {
    if (!OPT) return;
    const s = OPT.sound;
    if (d.k === "on") s.mute = !s.mute;
    else if (d.k === "muteBlur") s.muteBlur = !s.muteBlur;
    applyGains();
    SAVE();
  },
  "snd-test": () => { unlock(); sfx(hearPick, { pitch: 1 }); },
  ...LAB_ACTIONS, // the gun and blast sound test (ui/sfxlab.js)
};
export const SOUND_CHANGE = {
  "snd-vol": (state, ui, el) => {
    setVolume(el.dataset.k, Number(el.value) / 100);
    SAVE();
    if (el.dataset.k !== "amb") sfx("alert", { gain: 0.8 });
    try { el.blur(); } catch { /* ignore */ } // Esc closes the menu again
  },
  "snd-pick": (state, ui, el) => { if (VOICES[el.value]) { hearPick = el.value; unlock(); sfx(hearPick, { pitch: 1 }); } },
  ...LAB_CHANGE,
};

// The Help tab's topic (ui/help.js).
export function soundHelp() {
  return `Every sound is made by the game on the spot (no audio files). <b>Effects</b>: a soft click on buttons; a chime when a card comes up (a light two-note one for routine news, a falling one for trouble that wants a decision, a low tense chord for a crisis); a bell for a new warning in the alerts; in battle each calibre has its own report (a .22's pop to a .50's thump, 12 gauge, the machine guns, launchers), bursts and full auto round by round, suppressed shots, reloads, jams and brass, placed left or right and near or far, muffled out of sight, in the echo of the place; grenades, rockets and explosions in layers, with hits, misses, melee blows, bites, groans of the dead, blasts and fire, and a falling tone when one of your people goes down. A low grinding sting means a horde has been seen near a base or one of your teams; a hammered alarm bell means a base is being raided. <b>Ambience</b> follows the weather and the clock where the map is looking: wind, rain, thunder in storms, a low drone at night, birds on fair days, crickets on warm nights.<br><br>⚙ Menu → Options → Sound: master, effects and ambience volumes, sound on / off, mute when the window is not focused, and <b>Hear</b> to play any one sound. Browsers start sound only after your first click or key press.`;
}
