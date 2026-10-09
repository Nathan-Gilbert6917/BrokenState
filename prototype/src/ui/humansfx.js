// The survivors' voices (and the enemy's people): non-verbal, made on the spot with WebAudio like the dead's
// (ui/zombiesfx.js DSP: the same formant synthesis, a cleaner throat). ui/soundcues.js calls humanCues each battle frame
// (pure: no browser, the simulation never knows; no world dice), ui/audio.js plays the cues; ui/barks.js has the shout.
//
// A voice per person (humanVoice): from their id and their looks (sim/appearance.js: facial hair puts a voice low, a
//   heavy build darkens it, a slim one brightens it) and traits (Loud: a harsher throat, Coward: breathier, Tough:
//   gruffer); the rest is seeded: a low or a high register, young, grown or older (older: rasp and a less steady pitch),
//   now and then a smoker's rasp. The game keeps no sex or age for people, so the register is the seed's (with the
//   beard as the only hint). Enemy people by their kit (humanStyle): raiders rough and taunting (a harsh laugh on a
//   kill), soldiers and guards clipped and controlled, zealots ecstatic; everyone else plain.
// In battle (humanCues): hurt grunts by the damage, a sharp cry on a critical hit (and the bite's victim screams in their
//   own voice: zombiesfx HUMAN_HOOK), a strangled cry going down, a last faded breath dying, a ragged gasp revived;
//   effort grunts on blows and throws (the blows themselves are ui/sfx-melee.js's); and now and then, by state: frightened
//   breathing pinned down, a muffled "mmph" tied up, sobbing breaths panicked, wheezing while bleeding, coughing sick,
//   panting hurt after moving; a muffled groan as the ears go; a whimper with their hands up. At most HUMAN_MAX at once,
//   a cooldown a person, the important first.
// Out of battle (humanMapVoices): a murmur of voices from a base you have selected on the map with people home (more at
//   the evening meal, quiet at night, a laugh now and then, coughs in winter), and a scream when someone dies at a base.
// hRoute and hMapOut are the two places these voices meet the speakers, each with its gain hook (HUMAN_GAIN): at the
// sound mixer's integration they become its "voices" group (the barks' shout included).
import { DSP, HUMAN_HOOK, mulberry, hash32 } from "./zombiesfx.js";
import { spatialOut, place } from "./gunsfx.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = (v) => Math.round(v * 100) / 100;

// ---------- the cues ----------
// name: { ev (recipe), dur (s, the throttle's), limit { gap, max }, pri (the volley: lower first), imp (beats the cap) }.
export const HUMAN_CUES = {
  hHurt:    { ev: "grunt",   dur: 0.6, limit: { gap: 0.12, max: 2 }, pri: 6 },
  hCry:     { ev: "cry",     dur: 1.1, limit: { gap: 0.25, max: 1 }, pri: 3, imp: true },
  hDown:    { ev: "down",    dur: 1.6, limit: { gap: 0.4, max: 1 }, pri: 2, imp: true },
  hDeath:   { ev: "death",   dur: 2.2, limit: { gap: 0.4, max: 1 }, pri: 3, imp: true },
  hGasp:    { ev: "gasp",    dur: 1.4, limit: { gap: 0.4, max: 1 }, pri: 5 },
  hEffort:  { ev: "effort",  dur: 0.4, limit: { gap: 0.15, max: 2 }, pri: 8 },
  hPant:    { ev: "pant",    dur: 1.8, limit: { gap: 0.6, max: 1 }, pri: 10 },
  hWheeze:  { ev: "wheeze",  dur: 2.2, limit: { gap: 0.6, max: 1 }, pri: 10 },
  hCough:   { ev: "cough",   dur: 1.2, limit: { gap: 0.6, max: 1 }, pri: 10 },
  hDeaf:    { ev: "deaf",    dur: 1.4, limit: { gap: 0.6, max: 1 }, pri: 7 },
  hScared:  { ev: "scared",  dur: 1.8, limit: { gap: 0.6, max: 1 }, pri: 9 },
  hPlea:    { ev: "plea",    dur: 1.6, limit: { gap: 0.6, max: 1 }, pri: 7 },
  hMuffled: { ev: "muffled", dur: 1.4, limit: { gap: 0.8, max: 1 }, pri: 10 },
  hPanic:   { ev: "panic",   dur: 2.4, limit: { gap: 0.6, max: 1 }, pri: 7 },
  hTaunt:   { ev: "laugh",   dur: 1.4, limit: { gap: 1, max: 1 }, pri: 6 },
  hEcstatic: { ev: "ecstatic", dur: 1.8, limit: { gap: 1, max: 1 }, pri: 6 },
  hShout:   { ev: "shout",   dur: 0.9, limit: { gap: 0.4, max: 1 }, pri: 4, imp: true },
};
export const HUMAN_SOUND_NAMES = Object.keys(HUMAN_CUES);
export const HUMAN_LIMITS = Object.fromEntries(HUMAN_SOUND_NAMES.map((n) => [n, HUMAN_CUES[n].limit]));
export const H_PRIORITY = Object.fromEntries(HUMAN_SOUND_NAMES.map((n) => [n, HUMAN_CUES[n].pri]));
export const HUMAN_MAX = 2;         // human vocals at once (the battle's)
export const HUMAN_COOL = 1;        // s: one person's reactive sounds this far apart (a death, going down: always)
export const HUMAN_IDLE = [5, 12];  // s between one person's state sounds (panting, coughing, …), seeded
// INTEGRATION (sound mixer): the voices' level. Every human voice goes through hRoute or hMapOut with this gain; the
// mixer's group call for "voices" replaces it.
export const HUMAN_GAIN = { v: 1 };

// ---------- who sounds how ----------
// Enemy people by kit (sim/combat.js KITS); your people and anyone else: survivor.
export const KIT_STYLE = { raiders: "raider", soldiers: "soldier", guards: "soldier", contractors: "soldier", zealots: "zealot", fighters: "survivor", militia: "survivor", escorts: "survivor", survivors: "survivor" };
export const STYLE = {
  survivor: { drive: 0, rasp: 0, gain: 1, cry: 1 },
  raider:   { drive: 0.8, rasp: 0.2, gain: 1.05, cry: 1, taunt: true },
  soldier:  { drive: 0.2, rasp: 0, gain: 0.8, cry: 0.7, clipped: true },
  zealot:   { drive: 0.3, rasp: 0.1, gain: 1, cry: 1.1, ecstatic: true },
};
export const humanStyle = (u) => (!u || u.side === "player" ? "survivor" : KIT_STYLE[u.kit] || "survivor");
const survivorOf = (state, u) => (state && u && u.sid != null ? (state.survivors || []).find((s) => s.id === u.sid) || null : null);
// A person's voice: { seed, f0, shift, rasp, breath, drive, jitter, age, low, style }.
export function humanVoice(u, state = null) {
  const s = survivorOf(state, u) || (u && u.survivor) || null;
  const app = (s && s.appearance) || (u && u.app) || null;
  const traits = (s && s.traits) || (u && u.traits) || [];
  const id = s ? s.id : u ? u.id : 0;
  const style = humanStyle(u);
  const seed = hash32(Math.imul((Number(id) | 0) + 1, 0x9e3779b1) ^ (s ? 0x5117 : 0x7e3) ^ (u && u.side === "player" ? 0 : 0x1234));
  const r = mulberry(seed);
  const facial = !!(app && app.facial && app.facial !== "none");
  const low = facial || r() < 0.5;
  const age = (() => { const x = r(); return x < 0.25 ? "young" : x < 0.72 ? "adult" : "older"; })();
  let f0 = low ? 95 + r() * 45 : 175 + r() * 75;
  if (age === "older") f0 *= 0.92; else if (age === "young") f0 *= 1.06;
  const build = app && app.build;
  const shift = (low ? 0.92 : 1.08) * (build === "heavy" ? 0.94 : build === "slim" ? 1.05 : 1) * (0.96 + r() * 0.08);
  const smoker = r() < 0.2;
  const St = STYLE[style];
  return {
    seed, low, age, style, smoker,
    f0: r2(f0), shift: r2(shift),
    rasp: r2(clamp(0.06 + r() * 0.16 + (age === "older" ? 0.22 : 0) + (smoker ? 0.25 : 0) + (traits.includes("loud") ? 0.15 : 0) + St.rasp, 0, 0.9)),
    breath: r2(0.15 + r() * 0.2 + (traits.includes("coward") ? 0.15 : 0)),
    drive: r2(1 + r() * 0.6 + (traits.includes("tough") ? 0.5 : 0) + St.drive),
    jitter: r2(0.008 + r() * 0.01 + (age === "older" ? 0.02 : 0)),
  };
}

// ---------- the recipes ----------
// (c, out, t, V voice, o { gain, n }, rnd). Human formants: the vowel table, the voice's shift, a cleaner throat.
const vw = (k) => DSP.VW[k];
function voc(c, out, t, V, s, rnd, g) {
  return DSP.vocal(c, out, t, {
    form: [1, 1, 1], shift: V.shift, rasp: V.rasp, drive: V.drive, jitter: V.jitter, q: [6, 8, 9], ...s,
    f0: V.f0 * (s.k || 1), vowels: s.vowels.map(vw), peak: s.peak * g,
  }, rnd);
}
function breaths(c, out, t, n, gap, band, peak, rnd, rattle = 0) {
  for (let i = 0; i < n; i++) {
    const at = t + i * gap * (0.85 + rnd() * 0.3), inb = i % 2 === 0, d = gap * 0.7;
    const dest = rattle ? DSP.am(c, DSP.envG(c, out, at, peak * (inb ? 0.8 : 1), d * 0.35, d * 0.2, d * 0.45), rattle, 0.7, at, d, "square") : DSP.envG(c, out, at, peak * (inb ? 0.8 : 1), d * 0.35, d * 0.2, d * 0.45);
    DSP.noise(c, "white", at, d, DSP.biq(c, "bandpass", band * (inb ? 1.2 : 0.85), 1.6, dest), rnd);
  }
}
export const HUMAN_RECIPES = {
  grunt(c, out, t, V, o, rnd) { // hurt: by how bad (o.sev 0–1)
    const sev = clamp(o.sev ?? 0.3, 0, 1), d = 0.14 + sev * 0.22;
    voc(c, out, t, V, { k: 1.05 + sev * 0.3, dur: d, contour: [[0.2, 1.15], [1, 0.75]], vowels: ["uh", "ah"], a: 0.008, hold: d * 0.25, rel: d * 0.7, peak: 0.32 + sev * 0.25, breath: V.breath + 0.2, fry: 0.2 }, rnd, o.gain);
  },
  cry(c, out, t, V, o, rnd) { // a sharp cry: a critical hit, a bite
    const d = 0.5 + rnd() * 0.25, St = STYLE[V.style];
    voc(c, out, t, V, { k: 1.7 * St.cry, dur: d * (St.clipped ? 0.7 : 1), contour: [[0.12, 1.25], [0.5, 1.12], [1, 0.7]], vowels: ["aa", "ah", "ae"], vib: [5.5 + rnd(), 0.025], a: 0.02, hold: d * 0.35, rel: d * 0.55, peak: 0.62, breath: V.breath }, rnd, o.gain);
  },
  down(c, out, t, V, o, rnd) { // going down: a strangled cry falling into a choke
    const d = 0.8;
    voc(c, out, t, V, { k: 1.4, dur: d, contour: [[0.15, 1.2], [1, 0.55]], vowels: ["aa", "uh", "er"], fry: 0.6, fryHz: 22, a: 0.02, hold: d * 0.25, rel: d * 0.7, peak: 0.55, breath: V.breath + 0.15 }, rnd, o.gain);
    breaths(c, out, t + d * 0.9, 2, 0.35, 900, 0.12 * o.gain, rnd, 24);
  },
  death(c, out, t, V, o, rnd) { // a last breath, fading
    const d = 1.3;
    voc(c, out, t, V, { k: 0.9, dur: d * 0.5, contour: [[1, 0.7]], vowels: ["ah", "uh"], fry: 0.7, fryHz: 16, a: 0.08, hold: 0.1, rel: d * 0.4, peak: 0.22, breath: 0.8 }, rnd, o.gain);
    DSP.sweep(c, out, t + 0.1, d, 1300, 500, 1.2, 0.16 * o.gain, 0.15, 0.2, d - 0.4, rnd);
  },
  gasp(c, out, t, V, o, rnd) { // revived: a ragged gasp and a cough
    DSP.sweep(c, out, t, 0.32, 500 * V.shift, 2200 * V.shift, 2.2, 0.32 * o.gain, 0.28, 0.02, 0.05, rnd);
    HUMAN_RECIPES.cough(c, out, t + 0.45, V, { ...o, gain: o.gain * 0.8, n: 1 }, rnd);
  },
  effort(c, out, t, V, o, rnd) { // a blow, a throw: "hngh"
    const d = 0.12 + rnd() * 0.08;
    voc(c, out, t, V, { k: 1.15, dur: d, contour: [[1, 0.85]], vowels: ["uh", "er"], fry: 0.45, fryHz: 30 + rnd() * 20, a: 0.006, hold: d * 0.3, rel: d * 0.6, peak: 0.28, breath: 0.5 }, rnd, o.gain);
  },
  pant(c, out, t, V, o, rnd) { // hurt and moving: heavy panting
    breaths(c, out, t, 5 + Math.floor(rnd() * 3), 0.26, 1100 * V.shift, 0.14 * o.gain, rnd);
  },
  wheeze(c, out, t, V, o, rnd) { // bleeding: wet, ragged breaths
    breaths(c, out, t, 3, 0.6, 850 * V.shift, 0.13 * o.gain, rnd, 26);
    DSP.bubbles(c, out, t + 0.5, 1.2, 3, 0.05 * o.gain, rnd, 150, 420);
  },
  cough(c, out, t, V, o, rnd) { // sick: two or three coughs
    const n = o.n || 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      const at = t + i * (0.24 + rnd() * 0.1);
      DSP.noise(c, "white", at, 0.12, DSP.biq(c, "bandpass", (700 + rnd() * 500) * V.shift, 1.2, DSP.envG(c, out, at, 0.3 * o.gain, 0.004, 0.02, 0.1)), rnd);
      voc(c, out, at, V, { k: 1.1, dur: 0.1, contour: [[1, 0.8]], vowels: ["uh"], rasp: Math.max(0.4, V.rasp), a: 0.004, hold: 0.02, rel: 0.08, peak: 0.16 }, rnd, o.gain);
    }
  },
  deaf(c, out, t, V, o, rnd) { // the ears gone: a muffled, dazed groan
    voc(c, DSP.biq(c, "lowpass", 520, 0.7, out), t, V, { k: 0.9, dur: 0.9, contour: [[0.5, 1.05], [1, 0.8]], vowels: ["oh", "uh"], fry: 0.3, a: 0.15, hold: 0.3, rel: 0.45, peak: 0.32, breath: 0.4 }, rnd, o.gain);
  },
  scared(c, out, t, V, o, rnd) { // pinned down: rapid shallow breathing, a whimper
    breaths(c, out, t, 8, 0.17, 1300 * V.shift, 0.1 * o.gain, rnd);
    voc(c, out, t + 1.3, V, { k: 1.45, dur: 0.3, contour: [[0.5, 1.1], [1, 0.85]], vowels: ["ee", "uh"], vib: [7, 0.05], a: 0.04, hold: 0.08, rel: 0.18, peak: 0.14, breath: 0.6 }, rnd, o.gain);
  },
  plea(c, out, t, V, o, rnd) { // hands up: whimpering
    for (let i = 0; i < 3; i++) voc(c, out, t + i * 0.42, V, { k: 1.5 - i * 0.08, dur: 0.3, contour: [[0.4, 1.08], [1, 0.82]], vowels: ["eh", "uh"], vib: [6.5, 0.06], a: 0.03, hold: 0.08, rel: 0.19, peak: 0.2, breath: 0.6 }, rnd, o.gain);
  },
  muffled(c, out, t, V, o, rnd) { // tied and gagged: "mmph"
    const lp = DSP.biq(c, "lowpass", 420, 0.7, out);
    for (let i = 0; i < 2 + Math.floor(rnd() * 2); i++) voc(c, lp, t + i * 0.38, V, { k: 1.1 + rnd() * 0.2, dur: 0.24, contour: [[1, 0.85]], vowels: ["oo", "er"], a: 0.02, hold: 0.08, rel: 0.14, peak: 0.3, breath: 0.2 }, rnd, o.gain);
  },
  panic(c, out, t, V, o, rnd) { // terror: hyperventilating, a sob
    breaths(c, out, t, 10, 0.15, 1350 * V.shift, 0.11 * o.gain, rnd);
    const sob = DSP.am(c, out, 7, 1, t + 1.5, 0.7, "square");
    voc(c, sob, t + 1.5, V, { k: 1.4, dur: 0.7, contour: [[0.3, 1.1], [1, 0.75]], vowels: ["uh", "ah", "uh"], vib: [6, 0.05], a: 0.05, hold: 0.25, rel: 0.4, peak: 0.24, breath: 0.6 }, rnd, o.gain);
  },
  laugh(c, out, t, V, o, rnd) { // a raider's harsh laugh on a kill (and a laugh at the base)
    for (let i = 0; i < 4; i++) voc(c, out, t + i * 0.16, V, { k: (1.35 - i * 0.06) * (0.95 + rnd() * 0.1), dur: 0.1, contour: [[1, 0.85]], vowels: ["ah", "aa"], drive: V.drive + (V.style === "raider" ? 1 : 0), a: 0.008, hold: 0.02, rel: 0.07, peak: 0.34, breath: 0.6 }, rnd, o.gain);
  },
  ecstatic(c, out, t, V, o, rnd) { // a zealot's ecstatic moan
    voc(c, out, t, V, { k: 1.15, dur: 1.3, contour: [[0.6, 1.25], [1, 1.05]], vowels: ["ah", "aa", "oh"], vib: [5, 0.06], a: 0.3, hold: 0.5, rel: 0.5, peak: 0.36, breath: 0.4 }, rnd, o.gain);
  },
  shout(c, out, t, V, o, rnd) { // a bark: urgent ("man down": two rising), strained ("I'm hit")
    if (o.tone === "strained") { voc(c, out, t, V, { k: 1.3, dur: 0.35, contour: [[0.3, 1.15], [1, 0.8]], vowels: ["ae", "uh"], fry: 0.5, fryHz: 40, a: 0.01, hold: 0.1, rel: 0.24, peak: 0.55, breath: 0.4 }, rnd, o.gain); return; }
    for (let i = 0; i < 2; i++) voc(c, out, t + i * 0.32, V, { k: 1.55 + i * 0.12, dur: 0.24, contour: [[0.3, 1.15], [1, 0.9]], vowels: ["ae", "aa"], a: 0.01, hold: 0.08, rel: 0.15, peak: 0.6, breath: 0.25 }, rnd, o.gain);
  },
};
HUMAN_HOOK.cry = (c, out, t, V, g) => HUMAN_RECIPES.cry(c, out, t, V, { gain: g }, mulberry(V.seed ^ 0xc41));

// ---------- where they are heard ----------
// INTEGRATION (sound mixer): the one place a positioned human voice meets the speakers, at HUMAN_GAIN (the "voices"
// group). o.sp: gun-sfx's placement (soundcues spatial), else a place from o.pan / o.dist; dest: the bus it came in on.
export function hRoute(c, out, t, o = {}) {
  return spatialOut(c, o.sp || place({ pan: o.pan || 0, dist: o.dist || 0, seen: o.seen, room: o.room }), { gain: HUMAN_GAIN.v * (STYLE[o.voice && o.voice.style] || STYLE.survivor).gain, dest: out, dry: !!o.dry });
}
// INTEGRATION (sound mixer): the one place an unpositioned human voice (the base murmur, a scream at a base) meets the
// speakers, at HUMAN_GAIN.
export function hMapOut(c, out, level = 1) {
  const g = c.createGain();
  g.gain.value = HUMAN_GAIN.v * level;
  g.connect(out);
  return g;
}
let takes = 0;
// Plays a human cue: o { voice (humanVoice), gain, sev, tone, n, sp | pan, dist }.
export function playHuman(name, c, out, t, o = {}) {
  const C = HUMAN_CUES[name];
  if (!C) return null;
  const V = o.voice || humanVoice({ id: o.id ?? Math.floor(Math.random() * 100000), side: o.side || "player", kit: o.kit }); // the Hear list: a new person each time
  const rnd = mulberry(hash32(V.seed ^ Math.imul(++takes, 0x27d4eb2d)));
  HUMAN_RECIPES[C.ev](c, hRoute(c, out, t, { ...o, voice: V }), t, V, { ...o, gain: Number.isFinite(o.gain) ? o.gain : 1 }, rnd);
  return C.ev;
}
// For ui/audio.js VOICES (routes: placed by soundcues like the dead's, played through hRoute).
export const HUMAN_VOICES = Object.fromEntries(HUMAN_SOUND_NAMES.map((n) => [n, { dur: HUMAN_CUES[n].dur, routes: true, play(c, out, t, o) { playHuman(n, c, out, t, o); } }]));

// ---------- the battle's cues (pure) ----------
const CTX = { state: null };
const isHuman = (u) => u && u.kind === "human";
const unitAt = (b, p, not = null) => (p ? b.units.find((u) => u !== not && u.x === p[0] && u.y === p[1] && !u.dead) || null : null);
const stillUp = (u) => !u.dead && !u.down && !u.left && !u.off && u.x >= 0;
const NO_EFFORT = new Set(["KILLED", "CRUSHED", "EXECUTED", "HANDS UP", "KO", "STUN", "PEPPER", "DAZED", "BURN", "FIRE", "BOOM", "BACKBLAST", "RAMMED", "LADDER", "PUSHED", "ROCK", "DUD"]);
const SICK = new Set(["chestcold", "flu", "fever", "pneumonia", "cough"]);
// The voice of a battle unit (cached a battle: seeds and looks do not change mid-fight).
function voiceOf(hm, u) {
  let v = hm.voices.get(u.id);
  if (!v) { v = humanVoice(u, CTX.state); hm.voices.set(u.id, v); }
  return v;
}
// mem: soundcues' battle memory (mem.hm: this module's). L: the listener (place: zPlace-like, from ui/zombiesfx.js).
// fresh: this frame's new effects. place(L, x, y) → { sp, pan, dist }. Pushes cues to out.
export function humanCues(b, mem, L, now, state, fresh, out, placeAt) {
  if (state) CTX.state = state;
  let hm = mem.hm;
  if (!hm || hm.b !== b) {
    hm = mem.hm = { b, units: new Map(), voices: new Map(), playing: [], cool: new Map(), next: new Map(), crit: new Set(), atk: new Map() };
    for (const u of b.units) if (isHuman(u)) hm.units.set(u.id, { hp: u.hp, down: !!u.down, dead: !!u.dead, deaf: u.deaf > 0 });
    return;
  }
  const cand = [];
  const want = (name, u, extra = {}) => cand.push({ name, u, ...extra });
  const bitten = new Set(out.filter((c) => c.name === "zBite" && c.victimId != null).map((c) => c.victimId));
  // The bite's victim: their own voice in the bite (zombiesfx HUMAN_HOOK).
  for (const c of out) if (c.name === "zBite" && c.victimId != null) { const v = b.units.find((u) => u.id === c.victimId); if (isHuman(v)) c.victim = voiceOf(hm, v); }
  hm.crit.clear();
  for (const f of fresh || []) {
    if ((f.type === "shot" || f.type === "melee") && f.to) {
      const a = unitAt(b, f.from), t = unitAt(b, f.to, a) || b.units.find((u) => u !== a && u.x === f.to[0] && u.y === f.to[1]);
      if (t && isHuman(t) && a && a !== t) { hm.atk.set(t.id, a.id); if (f.crit) hm.crit.add(t.id); }
      if (f.type === "melee" && a && isHuman(a) && stillUp(a) && f.from && f.to && !(f.from[0] === f.to[0] && f.from[1] === f.to[1]) && !NO_EFFORT.has(f.text) && !f.acid) want("hEffort", a);
    }
    if (f.type === "melee" && f.text === "HANDS UP") { const a = unitAt(b, f.from); if (isHuman(a)) want("hPlea", a, { imp: true }); }
    if (f.type === "throw") { const a = unitAt(b, f.from); if (isHuman(a) && stillUp(a)) want("hEffort", a); }
    if (f.type === "loot" && f.text === "PANIC" && f.to) { const a = unitAt(b, f.to); if (isHuman(a)) want("hPanic", a, { imp: true }); }
  }
  for (const u of b.units) {
    if (!isHuman(u)) continue;
    let m = hm.units.get(u.id);
    if (!m) { hm.units.set(u.id, { hp: u.hp, down: !!u.down, dead: !!u.dead, deaf: u.deaf > 0 }); continue; }
    if (u.dead && !m.dead) {
      want("hDeath", u, { imp: true });
      const k = b.units.find((o) => o.id === hm.atk.get(u.id));
      if (k && isHuman(k) && stillUp(k) && k.side !== u.side) {
        const st = humanStyle(k);
        if (STYLE[st].taunt) want("hTaunt", k, { delay: 0.45, imp: true });
        else if (STYLE[st].ecstatic) want("hEcstatic", k, { delay: 0.45, imp: true });
      }
    } else if (!u.dead && u.down && !m.down) want("hDown", u, { imp: true });
    else if (!u.dead && !u.down && m.down) want("hGasp", u, { imp: true });
    else if (stillUp(u) && u.hp < m.hp && !bitten.has(u.id)) {
      const sev = clamp((m.hp - u.hp) / Math.max(1, u.maxHp || 100), 0, 1);
      if (hm.crit.has(u.id) || sev >= 0.25) want("hCry", u, { sev, imp: true });
      else want(STYLE[humanStyle(u)].ecstatic && sev > 0.1 ? "hEcstatic" : "hHurt", u, { sev, gain: 0.7 + sev });
    }
    if (stillUp(u) && u.deaf > 0 && !m.deaf) want("hDeaf", u);
    m.hp = u.hp; m.down = !!u.down; m.dead = !!u.dead; m.deaf = u.deaf > 0;
    // Now and then, by their state.
    if (!stillUp(u) && !(u.captive && !u.dead)) continue;
    const V = voiceOf(hm, u);
    let nx = hm.next.get(u.id);
    if (nx == null) { nx = { t: now + HUMAN_IDLE[0] * mulberry(V.seed ^ 0x1d1e)() * 1.2, n: 0 }; hm.next.set(u.id, nx); }
    if (now < nx.t) continue;
    const r = mulberry(hash32(V.seed ^ Math.imul(++nx.n, 0x85ebca6b)));
    nx.t = now + HUMAN_IDLE[0] + r() * (HUMAN_IDLE[1] - HUMAN_IDLE[0]);
    const s = survivorOf(CTX.state, u);
    const sick = !!(s && Array.isArray(s.conditions) && s.conditions.some((c) => SICK.has(c.key)));
    const hurt = u.hp < (u.maxHp || 100) * 0.4;
    if (u.captive && u.tied) want("hMuffled", u, { gain: 0.8 });
    else if (u.terror) want("hPanic", u);
    else if (u.suppressed > 0) want("hScared", u);
    else if (u.bleeding > 0) want("hWheeze", u);
    else if (sick) want("hCough", u);
    else if (hurt && u.movedT === b.turn) want("hPant", u);
  }
  // The cap: the important first, then by priority; HUMAN_MAX at once; a cooldown a person (not for the important).
  hm.playing = hm.playing.filter((p) => p.end > now);
  cand.sort((a, c) => (c.imp ? 1 : 0) - (a.imp ? 1 : 0) || HUMAN_CUES[a.name].pri - HUMAN_CUES[c.name].pri || a.u.id - c.u.id);
  const heardBy = new Set();
  for (const k of cand) {
    if (heardBy.has(k.u.id)) continue;
    if (!k.imp && now - (hm.cool.get(k.u.id) ?? -99) < HUMAN_COOL) continue;
    if (hm.playing.length >= HUMAN_MAX) { if (!k.imp) continue; hm.playing.shift(); }
    const V = voiceOf(hm, k.u);
    const pl = placeAt ? placeAt(L, k.u.x, k.u.y) : {};
    out.push({ name: k.name, voice: V, unit: k.u.id, gain: k.gain ?? 1, sev: k.sev, delay: k.delay || 0, ...pl });
    hm.playing.push({ end: now + (k.delay || 0) + HUMAN_CUES[k.name].dur, unit: k.u.id });
    hm.cool.set(k.u.id, now);
    heardBy.add(k.u.id);
  }
}
// The barks' shout (ui/barks.js, for the important ones): a short non-verbal shout in the speaker's own voice.
// trig "goingdown" → strained ("I'm hit"), else urgent ("man down"). Returns [name, opts] for sfx.
export function barkShout(state, u, trig) {
  if (state) CTX.state = state;
  return ["hShout", { voice: humanVoice(u, state), tone: trig === "goingdown" || trig === "hit" ? "strained" : "urgent", dist: 2 }];
}

// ---------- the State Map: a base's murmur, a scream ----------
// How busy a base's voices are (0–1) by the hour: the evening meal loudest, quiet at night; × how many are home.
export function murmurLevel(hour, people) {
  if (!(people > 0)) return 0;
  const h = (((Number(hour) || 0) % 24) + 24) % 24;
  const t = h >= 23 || h < 6 ? 0.06 : h < 8 ? 0.35 : h < 17 ? 0.45 : h < 20 ? 1 : 0.5;
  return r2(t * clamp(people / 8, 0.25, 1));
}
// The base selected on the map (its tile) with people home: { base, people, level, winter, night }; or null.
export function baseMurmur(state, tile) {
  if (!state || tile == null || tile < 0) return null;
  const base = (state.bases || []).find((b) => b.tile === tile);
  if (!base) return null;
  const people = (state.survivors || []).filter((s) => s.alive !== false && s.location && s.location.kind === "base" && s.location.baseId === base.id).length;
  const h = ((state.hour || 0) % 24 + 24) % 24;
  const day0 = Math.floor((state.hour || 0) / 24) % 360;
  return { base, people, level: murmurLevel(h, people), winter: day0 >= 330 || day0 < 60, night: h >= 23 || h < 6 };
}
// People who died at a base since the last look (a WeakMap a world, no change to it).
const DEAD = new WeakMap();
export function deathsAtBases(state) {
  if (!state || !state.survivors) return [];
  let m = DEAD.get(state);
  const fresh = [];
  if (!m) { m = { alive: new Set(state.survivors.filter((s) => s.alive !== false).map((s) => s.id)), hour: state.hour }; DEAD.set(state, m); return fresh; }
  const quiet = Math.abs((state.hour || 0) - (m.hour || 0)) > 3; // a long jump (a battle, a load, a fast skip): no screams for what happened meanwhile
  for (const s of state.survivors) {
    if (s.alive !== false || !m.alive.has(s.id)) continue;
    m.alive.delete(s.id);
    if (!quiet && s.location && s.location.kind === "base") fresh.push(s);
  }
  for (const s of state.survivors) if (s.alive !== false) m.alive.add(s.id);
  m.hour = state.hour;
  return fresh;
}
// The murmur's loop: many voices' syllables (no words), made once a context in JS (seeded), like the crowd bed.
const BABBLE = new WeakMap();
function babbleBuffer(c) {
  let buf = BABBLE.get(c);
  if (buf) return buf;
  const rate = 22050, len = rate * 6;
  buf = c.createBuffer(2, len, rate);
  const L = buf.getChannelData(0), R = buf.getChannelData(1), r = mulberry(0xba661e);
  const V = DSP.VW, keys = ["aa", "eh", "ee", "oh", "uh", "ae", "ah", "er"];
  const bp = (f, q) => { const w = 2 * Math.PI * f / rate, al = Math.sin(w) / (2 * q), a0 = 1 + al; return [al / a0, -al / a0, -2 * Math.cos(w) / a0, (1 - al) / a0]; };
  for (let talker = 0; talker < 9; talker++) {
    const f0 = r() < 0.5 ? 100 + r() * 40 : 180 + r() * 60, pan = r() * 2 - 1, gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
    let at = Math.floor(r() * len);
    for (let phrase = 0; phrase < 6; phrase++) {
      const syl = 3 + Math.floor(r() * 7);
      for (let k = 0; k < syl; k++) {
        const n = Math.floor((0.09 + r() * 0.16) * rate), v = V[keys[Math.floor(r() * keys.length)]], c1 = bp(v[0], 5), c2 = bp(v[1], 7);
        const s1 = [0, 0, 0, 0], s2 = [0, 0, 0, 0], ff = f0 * (0.85 + r() * 0.35), amp = 0.4 + r() * 0.6;
        let ph = 0;
        for (let i = 0; i < n; i++) {
          ph += ff * (1 - 0.15 * i / n) / rate; if (ph >= 1) ph -= 1;
          const x = (2 * ph - 1) * 0.6 + (r() * 2 - 1) * 0.08;
          const y1 = c1[0] * x + c1[1] * s1[1] - c1[2] * s1[2] - c1[3] * s1[3]; s1[1] = s1[0]; s1[0] = x; s1[3] = s1[2]; s1[2] = y1;
          const y2 = c2[0] * x + c2[1] * s2[1] - c2[2] * s2[2] - c2[3] * s2[3]; s2[1] = s2[0]; s2[0] = x; s2[3] = s2[2]; s2[2] = y2;
          const e = Math.sin(Math.PI * i / n) * amp, y = (y1 + 0.5 * y2) * e, j = (at + i) % len;
          L[j] += y * gl; R[j] += y * gr;
        }
        at = (at + n + Math.floor(r() * 0.06 * rate)) % len;
      }
      at = (at + Math.floor((0.3 + r() * 1.2) * rate)) % len;
    }
  }
  let mx = 0;
  for (let i = 0; i < len; i++) mx = Math.max(mx, Math.abs(L[i]), Math.abs(R[i]));
  if (mx > 0) for (let i = 0; i < len; i++) { L[i] *= 0.8 / mx; R[i] *= 0.8 / mx; }
  BABBLE.set(c, buf);
  return buf;
}
export const MURMUR_LEVEL = 0.12; // the murmur at level 1, under the ambience slider: a background, never a crowd
const MAPV = new WeakMap();
// ui/audio.js every ambience tick on the map: the selected base's murmur (tile: the selected tile; null in a battle, on
// the title or in a time-lapse), its laughs and winter coughs, and a scream for someone who died at a base. 7 nodes for
// the murmur while heard (let go after 4 s of silence); a laugh, a cough or a scream are short one-shots.
export function humanMapVoices(c, out, state, tile, t = c.currentTime) {
  const bm = baseMurmur(state, tile);
  const level = bm ? bm.level : 0;
  let M = MAPV.get(c);
  if (!M && level > 0) {
    const g = hMapOut(c, out, 1), lv = c.createGain(); lv.gain.value = 0;
    const lp = DSP.biq(c, "lowpass", 1500, 0.6, lv); lv.connect(g);
    const s = c.createBufferSource(); s.buffer = babbleBuffer(c); s.loop = true; s.connect(lp); s.start(t, 0.8);
    M = { lv, s, idle: null, next: t + 4, r: mulberry(0x6a5e), base: null };
    MAPV.set(c, M);
  }
  if (M) {
    M.lv.gain.setTargetAtTime(level * MURMUR_LEVEL, t, 1.2);
    if (bm && level > 0.05 && t >= M.next) { // a laugh now and then, a cough in winter
      const V = humanVoice({ id: 1000 + Math.floor(M.r() * 50), side: "player" });
      const name = bm.winter && M.r() < 0.5 ? "hCough" : "hTaunt";
      playHuman(name, c, hMapOut(c, out, 1), t, { voice: { ...V, style: "survivor" }, gain: 0.35 * level, dist: 10, dry: true });
      M.next = t + (6 + M.r() * 14) / Math.max(0.3, level);
    }
    M.idle = level > 0 ? null : M.idle ?? t;
    if (M.idle != null && t - M.idle > 4) { try { M.s.stop(t + 0.05); } catch { /* stopped */ } MAPV.delete(c); }
  }
  for (const s of deathsAtBases(state)) playHuman("hCry", c, hMapOut(c, out, 1), t + 0.1, { voice: humanVoice({ id: s.id, sid: s.id, side: "player" }, state), gain: 0.7, dist: 8, dry: true });
  return { level, people: bm ? bm.people : 0 };
}
