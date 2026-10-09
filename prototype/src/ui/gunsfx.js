// Gun sounds (the user's ask: better gun sound effects) and the battle's sound space: where a sound is, how far, in
// what kind of place. Each calibre and class has its own voice built in layers like a real report (ui/sfxdsp.js renders
// them once into buffers; a shot is then two or three buffer sources). ui/blastsfx.js does the explosions on the same
// bus; ui/soundcues.js plans what to play from the battle's effects (b.fx) and the units' state between frames;
// ui/audio.js owns the context and calls playGun / playHand / playBlast. Nothing here changes the game or rolls its dice.
//
// A shot, in order (gunshot anatomy):
//   hammer      a revolver's hammer falling, 6 ms before
//   crack       the bullet's supersonic snap (an N-wave): none for subsonic rounds (.45, subsonic loads) or a .22's whisper
//   blast       the muzzle blast: a very short broadband click with a fast attack, through a waveshaper for punch
//   body        bandpassed noise and a low pitched sweep (the "bang" and its weight), a revolver's ring
//   boom        low noise, the gas still expanding
//   action      the slide, bolt carrier or open bolt slamming home a few ms after (semi-autos, automatics)
//   tail        the outdoor echo rolling away (rifles and up: long, with reflections), in the room's reverb besides
//   cycle       a manual action afterwards: the pump racked, the bolt worked, the lever thrown
//   brass       the empty cases tinkling down nearby, quietly, now and then
// Suppressed: the blast and body muffled to a thud, the tail short; the crack kept for supersonic rounds, the action
// clack louder by comparison. Full auto and bursts: the real number of rounds (b.fx rounds) at the gun's cyclic rate,
// each round a little off in pitch, level and timing, one shared tail for the burst (15 rounds are not 15 tails).
//
// Space (spatial): pan by the source's screen x in the battle view, distance from the selected unit (else the middle of
// the screen) lowers the level and the highs and delays it a little; enemy shots out of your people's sight are heard
// muffled; a generated reverb by place (ROOMS: a tight room indoors, a slapback in town, a long soft tail over fields
// and forest). The bus (installBus): battle sounds → duck (a close blast compresses the ears) → muffle (deafened) →
// the effects bus, which ui/audio.js runs through a limiter.
//
// Exports for other sound modules (ui/zombiesfx.js): spatial(L, x, y, o) and spatialOut(c, place) -> AudioNode.
import { rngOf, hashStr, noiseLayer, toneLayer, metalLayer, nwave, shape, rollTail, makeIR, filterAll } from "./sfxdsp.js";
import { WEAPONS } from "../sim/combat.js";
import { loadOf, calOf } from "../sim/ammo.js";
import { indoors } from "../sim/hearing.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- the voices ----------
// level: the body's peak; crack: the snap's peak (× level); blast: { tau, hp, pop (Hz), popAmp, drive }; body: { f, q,
// tau, amp, sweep: [f0, f1, glide, amp], ring: modes }; boom: { lp, tau, amp }; tail: { amp (× level), len, lp, lpEnd,
// rise, echoes }; nlen: the N-wave in ms (longer for a bigger bullet); rpm: the cyclic rate (automatics).
const E = (...a) => a; // [t, amp] echo
export const GUN_VOICES = {
  p22:   { label: ".22 (pop)", level: 0.42, crack: 0.12, nlen: 0.22,
           blast: { tau: 0.0010, hp: 600, pop: 950, popAmp: 0.25, drive: 1.6 }, body: { f: 2700, q: 1.3, tau: 0.010, amp: 0.45, sweep: [520, 260, 0.02, 0.15] },
           boom: { lp: 1000, tau: 0.035, amp: 0.12 }, tail: { amp: 0.10, len: 0.5, lp: 1600, echoes: [E(0.12, 0.3)] } },
  p9:    { label: "9mm pistol", level: 0.74, crack: 0.2, nlen: 0.28,
           blast: { tau: 0.0016, hp: 350, pop: 620, popAmp: 0.4, drive: 2.6 }, body: { f: 1750, q: 1.0, tau: 0.022, amp: 0.6, sweep: [380, 120, 0.05, 0.42] },
           boom: { lp: 700, tau: 0.07, amp: 0.32 }, tail: { amp: 0.15, len: 0.9, lp: 1300, echoes: [E(0.14, 0.35), E(0.42, 0.15)] } },
  p45:   { label: ".45 ACP (deeper)", level: 0.8, crack: 0, nlen: 0,
           blast: { tau: 0.0021, hp: 250, pop: 430, popAmp: 0.55, drive: 2.9 }, body: { f: 1150, q: 0.9, tau: 0.03, amp: 0.66, sweep: [300, 85, 0.06, 0.6] },
           boom: { lp: 600, tau: 0.09, amp: 0.45 }, tail: { amp: 0.17, len: 1.0, lp: 1100, echoes: [E(0.15, 0.35), E(0.45, 0.15)] } },
  r357:  { label: ".357 revolver (loud, ringing)", level: 0.92, crack: 0.36, nlen: 0.34, hammer: true,
           blast: { tau: 0.0024, hp: 250, pop: 520, popAmp: 0.5, drive: 3.3 }, body: { f: 1300, q: 1.4, tau: 0.045, amp: 0.75, sweep: [340, 105, 0.06, 0.5], ring: [[2380, 0.07, 1], [3720, 0.05, 0.6], [5150, 0.035, 0.35]] },
           boom: { lp: 750, tau: 0.12, amp: 0.55 }, tail: { amp: 0.3, len: 1.6, lp: 1200, echoes: [E(0.18, 0.4), E(0.47, 0.2), E(0.95, 0.08)] } },
  smg9:  { label: "9mm submachine gun", level: 0.68, crack: 0.2, nlen: 0.28, rpm: 1000,
           blast: { tau: 0.0014, hp: 380, pop: 640, popAmp: 0.35, drive: 2.4 }, body: { f: 1850, q: 1.0, tau: 0.016, amp: 0.55, sweep: [400, 140, 0.035, 0.35] },
           boom: { lp: 750, tau: 0.05, amp: 0.28 }, tail: { amp: 0.16, len: 1.0, lp: 1300, echoes: [E(0.14, 0.35), E(0.42, 0.15)] } },
  r556:  { label: "5.56 rifle (sharp, snappy)", level: 0.86, crack: 0.72, nlen: 0.34, rpm: 800,
           blast: { tau: 0.0013, hp: 300, pop: 700, popAmp: 0.35, drive: 3.0 }, body: { f: 2250, q: 0.9, tau: 0.018, amp: 0.55, sweep: [420, 140, 0.04, 0.4] },
           boom: { lp: 800, tau: 0.08, amp: 0.45 }, tail: { amp: 0.38, len: 1.8, lp: 1400, lpEnd: 600, echoes: [E(0.12, 0.3), E(0.38, 0.22), E(0.9, 0.1)] } },
  r762:  { label: "7.62×39 (heavier)", level: 0.9, crack: 0.76, nlen: 0.42, rpm: 650,
           blast: { tau: 0.0018, hp: 250, pop: 520, popAmp: 0.45, drive: 3.3 }, body: { f: 1600, q: 0.85, tau: 0.026, amp: 0.7, sweep: [360, 100, 0.05, 0.5] },
           boom: { lp: 700, tau: 0.1, amp: 0.55 }, tail: { amp: 0.44, len: 2.0, lp: 1200, lpEnd: 550, echoes: [E(0.13, 0.32), E(0.41, 0.22), E(1.0, 0.1)] } },
  r3030: { label: ".30-30 lever-action", level: 0.9, crack: 0.62, nlen: 0.4,
           blast: { tau: 0.0019, hp: 250, pop: 500, popAmp: 0.45, drive: 3.2 }, body: { f: 1500, q: 0.85, tau: 0.028, amp: 0.7, sweep: [350, 95, 0.05, 0.5] },
           boom: { lp: 680, tau: 0.11, amp: 0.55 }, tail: { amp: 0.46, len: 2.2, lp: 1150, lpEnd: 500, echoes: [E(0.14, 0.35), E(0.44, 0.22), E(1.05, 0.1)] } },
  r308:  { label: ".308 rifle (big crack, long roll)", level: 0.96, crack: 0.86, nlen: 0.55,
           blast: { tau: 0.0022, hp: 220, pop: 450, popAmp: 0.5, drive: 3.6 }, body: { f: 1350, q: 0.8, tau: 0.032, amp: 0.75, sweep: [320, 80, 0.06, 0.62] },
           boom: { lp: 650, tau: 0.14, amp: 0.7 }, tail: { amp: 0.6, len: 2.8, lp: 1000, lpEnd: 420, rise: 0.08, echoes: [E(0.15, 0.4), E(0.5, 0.28), E(1.1, 0.15), E(1.8, 0.08)] } },
  r50:   { label: ".50 BMG (huge, chest-thump)", level: 1, crack: 1, nlen: 0.9,
           blast: { tau: 0.0035, hp: 150, pop: 260, popAmp: 0.75, drive: 4.5 }, body: { f: 900, q: 0.7, tau: 0.05, amp: 0.9, sweep: [200, 38, 0.12, 1] },
           boom: { lp: 450, tau: 0.26, amp: 0.95 }, brake: true, tail: { amp: 0.8, len: 3.6, lp: 800, lpEnd: 300, rise: 0.1, echoes: [E(0.2, 0.5), E(0.6, 0.35), E(1.3, 0.2), E(2.2, 0.1)] } },
  m2:    { label: "M2 heavy machine gun", level: 1, crack: 0.95, nlen: 0.85, rpm: 500,
           blast: { tau: 0.0032, hp: 160, pop: 280, popAmp: 0.7, drive: 4.2 }, body: { f: 950, q: 0.7, tau: 0.045, amp: 0.9, sweep: [210, 45, 0.1, 0.9] },
           boom: { lp: 480, tau: 0.2, amp: 0.85 }, tail: { amp: 0.7, len: 3.2, lp: 800, lpEnd: 320, rise: 0.1, echoes: [E(0.2, 0.45), E(0.6, 0.3), E(1.3, 0.15)] } },
  lmg:   { label: "Light machine gun (5.56)", level: 0.88, crack: 0.72, nlen: 0.34, rpm: 650,
           blast: { tau: 0.0015, hp: 280, pop: 640, popAmp: 0.42, drive: 3.1 }, body: { f: 2000, q: 0.85, tau: 0.022, amp: 0.62, sweep: [400, 120, 0.045, 0.45] },
           boom: { lp: 780, tau: 0.09, amp: 0.5 }, tail: { amp: 0.42, len: 2.0, lp: 1300, lpEnd: 550, echoes: [E(0.12, 0.3), E(0.38, 0.22), E(0.9, 0.1)] } },
  sg12:  { label: "12 gauge (wide boom)", level: 1, crack: 0.1, nlen: 0.3,
           blast: { tau: 0.003, hp: 160, pop: 300, popAmp: 0.7, drive: 3.2 }, body: { f: 820, q: 0.55, tau: 0.06, amp: 1, sweep: [220, 58, 0.09, 0.9] },
           boom: { lp: 1100, tau: 0.15, amp: 0.85 }, tail: { amp: 0.5, len: 1.6, lp: 1000, lpEnd: 450, echoes: [E(0.14, 0.35), E(0.42, 0.15)] } },
  sgsawn:{ label: "Sawn-off (very loud)", level: 1, crack: 0.08, nlen: 0.3,
           blast: { tau: 0.0042, hp: 140, pop: 260, popAmp: 0.85, drive: 4.2 }, body: { f: 760, q: 0.5, tau: 0.075, amp: 1, sweep: [210, 52, 0.1, 1] },
           boom: { lp: 1300, tau: 0.17, amp: 0.95 }, tail: { amp: 0.52, len: 1.6, lp: 1050, lpEnd: 450, echoes: [E(0.14, 0.35), E(0.42, 0.15)] } },
  sgpipe:{ label: "Pipe shotgun (rattly)", level: 0.95, crack: 0.06, nlen: 0.3,
           blast: { tau: 0.0035, hp: 150, pop: 280, popAmp: 0.7, drive: 3.6 }, body: { f: 700, q: 0.6, tau: 0.06, amp: 0.9, sweep: [200, 60, 0.08, 0.8], ring: [[420, 0.06, 1], [1270, 0.04, 0.6], [2210, 0.025, 0.35]] },
           boom: { lp: 1000, tau: 0.14, amp: 0.8 }, tail: { amp: 0.45, len: 1.4, lp: 950, lpEnd: 450, echoes: [E(0.14, 0.3)] } },
  gl40:  { label: "40 mm launcher (thoonk)", level: 0.72, crack: 0, nlen: 0,
           blast: { tau: 0.004, hp: 90, pop: 170, popAmp: 1, drive: 2.2 }, body: { f: 360, q: 1.3, tau: 0.04, amp: 0.7, sweep: [165, 88, 0.08, 1], ring: [[240, 0.12, 1], [610, 0.05, 0.3]] },
           boom: { lp: 420, tau: 0.08, amp: 0.4 }, tail: { amp: 0.18, len: 0.9, lp: 700, echoes: [E(0.16, 0.3)] } },
  rocket:{ label: "Rocket launch (backblast, whoosh)", level: 1, crack: 0, nlen: 0, rocket: true,
           blast: { tau: 0.006, hp: 120, pop: 140, popAmp: 0.8, drive: 3.4 }, body: { f: 600, q: 0.5, tau: 0.16, amp: 1, sweep: [130, 50, 0.2, 0.7] },
           boom: { lp: 1800, tau: 0.35, amp: 0.9 }, tail: { amp: 0.55, len: 2.4, lp: 900, lpEnd: 350, rise: 0.12, echoes: [E(0.25, 0.35), E(0.8, 0.2)] } },
};
export const GUN_TRIM = 0.62; // all gun voices: a 9mm pistol near you about as loud as the old pistol (tools/sfxpreview.cjs measures it)

// ---------- which gun makes which voice ----------
// v: the voice; act: the action slamming home a few ms after the shot (MECH); cycle: a manual action played after it
// (HANDLING); brass: what it spits out; rel: its reload (RELOAD); pitch: a nudge (a short barrel is a touch higher).
export const VOICE_OF = {
  pistol22:   { v: "p22", act: "tick", brass: "brassP", rel: "pistol" },
  rifle22:    { v: "p22", act: "tick", brass: "brassP", rel: "rifle", pitch: 0.94 },
  compact9:   { v: "p9", act: "slide", brass: "brassP", rel: "pistol", pitch: 1.05 },
  pistol:     { v: "p9", act: "slide", brass: "brassP", rel: "pistol" },
  pistol45:   { v: "p45", act: "slideHeavy", brass: "brassP", rel: "pistol" },
  revolver:   { v: "r357", rel: "revolver" },
  smg:        { v: "smg9", act: "openBolt", brass: "brassP", rel: "smg" },
  ar:         { v: "r556", act: "bolt", brass: "brassR", rel: "rifle" },
  carbine:    { v: "r556", act: "bolt", brass: "brassR", rel: "rifle", pitch: 1.03 },
  lmg:        { v: "lmg", act: "openBoltLink", brass: "brassR", rel: "belt" },
  turret_lmg: { v: "lmg", act: "openBoltLink", brass: "brassR", rel: "belt" },
  ak:         { v: "r762", act: "clank", brass: "brassR", rel: "ak" },
  leverrifle: { v: "r3030", cycle: "lever", brass: "brassR", rel: "lever" },
  huntrifle:  { v: "r308", cycle: "bolt", brass: "brassR", rel: "bolt" },
  sniper:     { v: "r308", cycle: "bolt", brass: "brassR", rel: "bolt", pitch: 0.97 },
  dmr:        { v: "r308", act: "bolt", brass: "brassR", rel: "rifle" },
  amr:        { v: "r50", act: "heavy", brass: "brassR", rel: "heavy" },
  turret_m2:  { v: "m2", act: "heavy", brass: "brassR", rel: "belt" },
  m2hb:       { v: "m2", act: "heavy", brass: "brassR", rel: "belt" },
  shotgun:    { v: "sg12", cycle: "pump", brass: "hull", rel: "pump" },
  semishotgun:{ v: "sg12", act: "slideHeavy", brass: "hull", rel: "tube" },
  dbshotgun:  { v: "sg12", rel: "break" },
  sawnoff:    { v: "sgsawn", rel: "break" },
  pipegun:    { v: "sgpipe", rel: "single" },
  m79:        { v: "gl40", rel: "gl" },
  m203:       { v: "gl40", rel: "gl" },
  m32:        { v: "gl40", rel: "gl32", pitch: 1.03 },
  at4:        { v: "rocket", rel: "rocket" },
  rpg:        { v: "rocket", rel: "rocket", pitch: 0.95 },
};
// Weapons that keep a sound of their own on purpose (ui/audio.js VOICES): bows and crossbows twang, a spitter spits.
export const OWN_VOICE = { crossbow: "bow", compbow: "bow", xbow: "bow", pulleybow: "bow", acid: "acid" };
// A gun no table knows (a later addition): a voice by its calibre, then by its class. GENERIC_OK lists none: every
// gun in data-guns.js and combat.js has its row (tools/gunsfxtest.js checks).
const BY_CAL = { "22lr": "p22", "9mm": "p9", "45acp": "p45", "357": "r357", "556": "r556", "762x39": "r762", "308": "r308", "3030": "r3030", "50bmg": "r50", "12ga": "sg12", "40mm": "gl40", rocket: "rocket" };
export function gunVoice(key) {
  const row = VOICE_OF[key];
  if (row) return { ...row, generic: false };
  const w = WEAPONS[key] || {};
  const v = BY_CAL[w.cal] || (w.close > 0 ? "sg12" : w.opt >= 9 ? "r556" : "p9");
  return { v, act: w.modes ? "bolt" : "slide", brass: "brassP", rel: "rifle", generic: true };
}
// Supersonic rounds crack; the .45 and subsonic loads do not. A .22 LR and 9mm crack faintly (barely past the speed of
// sound), buckshot hardly, a slug a little more.
const SUPERSONIC = { "22lr": 1, "9mm": 1, "45acp": 0, "357": 1, "556": 1, "762x39": 1, "308": 1, "3030": 1, "50bmg": 1, "12ga": 1, "40mm": 0, rocket: 0 };
export const supersonic = (cal, type) => !!SUPERSONIC[cal] && type !== "subsonic";

// The cyclic rate of a gun firing more than one round a pull (rounds a minute), and the gap between rounds.
export const RPM = { smg: 1000, ar: 800, carbine: 800, ak: 650, lmg: 650, turret_lmg: 650, turret_m2: 500, m2hb: 500 };
export const roundGap = (key) => 60 / (RPM[key] || GUN_VOICES[gunVoice(key).v].rpm || 400);

// The plan of one shot effect (b.fx type "shot") by unit a: what the sound layer needs, read from the unit and its gun
// (no dice, nothing changed). launcher: "gl" | "rocket" when the shot was a launcher's (soundcues.js knows).
export function shotPlan(f, a, launcher = null) {
  const key = launcher === "rocket" || f.rocket ? (a && a.gl && a.gl.key) || "rpg" : launcher === "gl" ? (a && a.gl && a.gl.key) || "m79" : a ? a.weapon : "pistol";
  const row = gunVoice(VOICE_OF[key] ? key : f.rocket ? "rpg" : launcher === "gl" ? "m79" : key);
  const w = WEAPONS[key] || {};
  const cal = w.cal || calOf(key);
  let type = null;
  try { type = a && !launcher && !f.rocket ? loadOf(a) : null; } catch { type = null; }
  const sup = !!(a && a.suppressor && w.noise && !launcher && !f.rocket && row.v !== "r357");
  const sub = !supersonic(cal, type);
  const rounds = launcher || f.rocket ? 1 : Math.max(1, Math.min(30, Math.round(f.rounds || 1)));
  const gap = rounds > 1 ? roundGap(key) : 0;
  return { key, v: row.v, act: row.act || null, cycle: row.cycle || null, brass: row.brass || null, rel: row.rel, pitch: row.pitch || 1, generic: row.generic,
    sup, sub, slug: type === "slug", rounds, gap, span: (rounds - 1) * gap, unit: a ? a.id : null };
}
// The offsets (s) of n rounds at gap apart, each a little early or late (jitter ±4 ms, never before the first).
export function burstTimes(n, gap, rnd = Math.random) {
  const out = [];
  for (let k = 0; k < n; k++) out.push(k === 0 ? 0 : Math.max(0.001, k * gap + (rnd() - 0.5) * 0.008));
  return out;
}

// ---------- the mechanics (actions, handling) ----------
// Each is a list of struck-metal or noise events rendered into one short buffer. m: modes [[f, tau, amp]].
const MT = (start, amp, m, extra = {}) => ({ k: "metal", start, amp, modes: m, tick: extra.tick ?? 0.5, lp: extra.lp, tickF: extra.tickF });
const NZ = (start, amp, dur, tau, f, q = 1, color = "white", to) => ({ k: "noise", start, amp, dur, tau, filters: [{ type: "bandpass", f, q, to, sweep: dur }], color });
const TN = (start, amp, f0, f1, dur, tau) => ({ k: "tone", start, amp, f0, f1, dur, tau });
const STEEL = (f) => [[f, 0.011, 1], [f * 1.62, 0.008, 0.7], [f * 2.48, 0.005, 0.45]];
const TINK = (f, d = 0.05) => [[f, d, 1], [f * 1.52, d * 0.6, 0.6], [f * 2.12, d * 0.4, 0.4]];
export const HANDLING = {
  // in-shot actions
  tick:        [MT(0, 0.7, [[4200, 0.004, 1], [6900, 0.003, 0.6], [9800, 0.002, 0.4]])],
  slide:       [MT(0, 1, STEEL(2100)), MT(0.011, 0.7, STEEL(2600))],
  slideHeavy:  [MT(0, 1, STEEL(1650)), MT(0.013, 0.75, STEEL(2050))],
  bolt:        [MT(0, 1, STEEL(2600)), TN(0.004, 0.25, 900, 820, 0.04, 0.012)],
  clank:       [MT(0, 1, STEEL(1700), { tick: 0.7 }), MT(0.014, 0.6, STEEL(2300))],
  heavy:       [MT(0, 1, [[900, 0.03, 1], [1500, 0.022, 0.8], [2600, 0.015, 0.5]], { tick: 0.6 }), TN(0, 0.5, 140, 90, 0.05, 0.02)],
  openBolt:    [MT(0, 1, STEEL(1900), { tick: 0.4 })],
  openBoltLink:[MT(0, 1, STEEL(1750), { tick: 0.4 }), MT(0.006, 0.35, TINK(4600, 0.02))],
  // reloading
  magOut:      [MT(0, 0.5, [[3500, 0.005, 1], [5800, 0.004, 0.5]]), NZ(0.01, 0.3, 0.09, 0.03, 2500, 2)],
  magIn:       [NZ(0, 0.22, 0.06, 0.02, 2200, 1.5), MT(0.065, 1, STEEL(1800), { tick: 0.8 }), TN(0.065, 0.45, 180, 120, 0.04, 0.012)],
  charge:      [MT(0, 0.45, [[3200, 0.006, 1], [5100, 0.004, 0.5]]), NZ(0.005, 0.35, 0.1, 0.04, 3000, 1.5), MT(0.14, 1, STEEL(2300), { tick: 0.8 })],
  chargeHeavy: [MT(0, 0.5, STEEL(2400)), NZ(0.005, 0.4, 0.16, 0.06, 2200, 1.2), MT(0.22, 1, [[1100, 0.025, 1], [1800, 0.02, 0.7], [2900, 0.012, 0.4]], { tick: 0.8 })],
  slideRel:    [MT(0, 1, STEEL(2200), { tick: 0.8 })],
  shellIn:     [NZ(0, 0.45, 0.05, 0.015, 1800, 1.2), MT(0.034, 0.6, [[2600, 0.006, 1], [4100, 0.004, 0.5]])],
  pump:        [NZ(0, 0.3, 0.07, 0.025, 1400, 1), MT(0.03, 0.9, [[1200, 0.02, 1], [2100, 0.015, 0.7], [3300, 0.01, 0.4]]), NZ(0.1, 0.3, 0.06, 0.02, 1600, 1), MT(0.14, 1, [[1350, 0.02, 1], [2300, 0.014, 0.7], [3500, 0.01, 0.4]])],
  lever:       [MT(0, 0.9, [[1500, 0.015, 1], [2600, 0.01, 0.6], [3900, 0.006, 0.3]]), MT(0.12, 1, [[1700, 0.015, 1], [2900, 0.01, 0.6], [4300, 0.006, 0.3]])],
  bolt2:       [MT(0, 0.5, [[3000, 0.008, 1], [5000, 0.006, 0.6]]), NZ(0.06, 0.3, 0.07, 0.025, 2600, 1.5), MT(0.12, 0.8, STEEL(1900)), NZ(0.26, 0.3, 0.07, 0.025, 2800, 1.5), MT(0.33, 1, STEEL(2100)), MT(0.41, 0.6, [[3200, 0.008, 1], [5200, 0.005, 0.5]])],
  boltOpen:    [MT(0, 0.5, [[3000, 0.008, 1], [5000, 0.006, 0.6]]), NZ(0.06, 0.3, 0.07, 0.025, 2600, 1.5), MT(0.12, 0.8, STEEL(1900))],
  boltClose:   [NZ(0, 0.3, 0.07, 0.025, 2800, 1.5), MT(0.07, 1, STEEL(2100)), MT(0.15, 0.6, [[3200, 0.008, 1], [5200, 0.005, 0.5]])],
  breakOpen:   [MT(0, 1, [[1300, 0.02, 1], [2200, 0.015, 0.6], [3600, 0.01, 0.3]], { tick: 0.7 }), NZ(0.12, 0.4, 0.04, 0.01, 900, 1.2), NZ(0.16, 0.35, 0.04, 0.01, 1000, 1.2)],
  breakClose:  [MT(0, 1, [[1100, 0.025, 1], [1900, 0.02, 0.7], [3100, 0.012, 0.4]], { tick: 0.8 }), TN(0, 0.5, 160, 110, 0.05, 0.015)],
  cylOpen:     [MT(0, 0.7, [[3200, 0.006, 1], [5400, 0.004, 0.5]]), MT(0.06, 0.3, TINK(4200, 0.01)), MT(0.1, 0.25, TINK(4400, 0.01))],
  eject:       [0, 0.03, 0.05, 0.07, 0.09, 0.11].map((s, i) => MT(s, 0.35 + (i % 3) * 0.1, TINK(5000 + i * 230, 0.04), { tick: 0.2 })),
  speedloader: [0, 0.006, 0.013, 0.019, 0.026, 0.034].map((s) => MT(s, 0.5, [[2900, 0.006, 1], [4600, 0.004, 0.5]])).concat([MT(0.1, 0.5, [[2100, 0.008, 1], [3400, 0.006, 0.5]])]),
  cylClose:    [MT(0, 1, STEEL(2400), { tick: 0.8 }), MT(0.12, 0.25, TINK(4300, 0.01)), MT(0.17, 0.2, TINK(4500, 0.01))],
  belt:        Array.from({ length: 14 }, (_, i) => MT(i * 0.022 + (i % 3) * 0.004, 0.35 + (i % 4) * 0.08, TINK(3800 + (i % 5) * 300, 0.012))),
  coverOpen:   [MT(0, 1, [[1100, 0.02, 1], [1800, 0.015, 0.7], [2900, 0.01, 0.4]])],
  coverClose:  [MT(0, 1, [[1000, 0.025, 1], [1700, 0.02, 0.7], [2700, 0.012, 0.4]], { tick: 0.9 }), TN(0, 0.4, 150, 100, 0.04, 0.015)],
  dry:         [MT(0, 0.7, [[3800, 0.004, 1], [6200, 0.003, 0.5]], { tick: 0.8 }), TN(0, 0.2, 260, 200, 0.02, 0.006)],
  jam:         [MT(0, 1, [[700, 0.008, 1], [1300, 0.006, 0.6], [2100, 0.004, 0.3]], { lp: 2500, tick: 0.3 }), NZ(0.002, 0.4, 0.04, 0.012, 500, 0.8, "pink")],
  rack:        [MT(0, 0.6, STEEL(1600), { lp: 4000 }), NZ(0.2, 0.35, 0.1, 0.04, 3000, 1.5), MT(0.22, 0.5, [[3200, 0.006, 1], [5100, 0.004, 0.5]]), MT(0.36, 1, STEEL(2300), { tick: 0.8 })],
  lockOpen:    [MT(0, 0.6, [[2900, 0.03, 1], [4700, 0.02, 0.5], [6900, 0.012, 0.3]])],
  brassP:      [MT(0, 1, TINK(5200)), MT(0.09, 0.5, TINK(5300, 0.04)), MT(0.15, 0.25, TINK(5250, 0.03)), MT(0.19, 0.12, TINK(5400, 0.02))],
  brassR:      [MT(0, 1, TINK(3600, 0.06)), MT(0.11, 0.55, TINK(3650, 0.05)), MT(0.19, 0.28, TINK(3700, 0.04)), MT(0.24, 0.12, TINK(3620, 0.03))],
  hull:        [NZ(0, 1, 0.03, 0.007, 900, 1.2, "pink"), MT(0.002, 0.3, TINK(3100, 0.012)), NZ(0.1, 0.45, 0.03, 0.006, 1000, 1.2, "pink")],
  glOpen:      [MT(0, 1, [[900, 0.025, 1], [1500, 0.02, 0.6], [2500, 0.012, 0.3]], { tick: 0.6 }), NZ(0.15, 0.4, 0.05, 0.012, 700, 1)],
  glIn:        [NZ(0, 0.3, 0.08, 0.03, 900, 1), TN(0.07, 0.6, 190, 140, 0.05, 0.015), MT(0.07, 0.4, [[1300, 0.012, 1], [2200, 0.008, 0.5]])],
  glClose:     [MT(0, 1, [[850, 0.03, 1], [1450, 0.022, 0.7], [2400, 0.014, 0.4]], { tick: 0.9 }), TN(0, 0.5, 150, 100, 0.05, 0.02)],
  rocketLoad:  [NZ(0, 0.5, 0.3, 0.12, 700, 0.8, "pink", 1100), MT(0.32, 1, [[800, 0.03, 1], [1300, 0.022, 0.6], [2200, 0.015, 0.4]], { tick: 0.7 }), MT(0.45, 0.6, [[2600, 0.008, 1], [4100, 0.006, 0.5]])],
  taser:       [NZ(0, 1, 0.5, 0.25, 3000, 0.7, "white"), TN(0, 0.6, 62, 60, 0.5, 0.25)],
};
const handLen = (ev) => Math.max(...ev.map((e) => e.start + (e.k === "metal" ? Math.min(0.6, Math.max(...e.modes.map((m) => m[1])) * 5) : e.dur))) + 0.02;
function renderEvents(buf, sr, events, rnd, at = 0, amp = 1) {
  for (const e of events) {
    if (e.k === "metal") metalLayer(buf, sr, { start: at + e.start, amp: e.amp * amp, modes: e.modes, tick: e.tick, lp: e.lp, tickF: e.tickF, rnd });
    else if (e.k === "noise") noiseLayer(buf, sr, { start: at + e.start, dur: e.dur, amp: e.amp * amp, a: 0.001, tau: e.tau, color: e.color, filters: e.filters, rnd });
    else toneLayer(buf, sr, { start: at + e.start, f0: e.f0, f1: e.f1, dur: e.dur, amp: e.amp * amp, a: 0.0015, tau: e.tau });
  }
}
export const HAND_LEVEL = 0.32; // handling under the shots (× the gun trim): heard, never in the way
export function renderHandling(name, sr, seed = 1) {
  const ev = HANDLING[name];
  if (!ev) return null;
  const buf = new Float32Array(Math.ceil(handLen(ev) * sr));
  renderEvents(buf, sr, ev, rngOf(hashStr(name) + seed));
  normalise(buf, 1);
  return buf;
}
function normalise(buf, peak) {
  let pk = 0;
  for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > pk) pk = a; }
  if (pk > 0) for (let i = 0; i < buf.length; i++) buf[i] *= peak / pk;
  return buf;
}

// ---------- rendering a voice ----------
// The suppressed form of a voice: the blast and body muffled to a thud, the boom and tail short and low.
export function suppressedSpec(V, sub) {
  return {
    ...V, crack: sub ? 0 : V.crack, level: V.level * 0.5, sup: true,
    blast: { ...V.blast, popAmp: V.blast.popAmp * 0.5, drive: 1.4, hp: 120, lp: 1400 },
    body: { ...V.body, f: V.body.f * 0.45, q: 0.9, tau: V.body.tau * 0.7, amp: V.body.amp * 0.45, sweep: [V.body.sweep[0] * 0.8, V.body.sweep[1], V.body.sweep[2], V.body.sweep[3] * 0.35], ring: null },
    boom: { ...V.boom, lp: V.boom.lp * 0.6, tau: V.boom.tau * 0.5, amp: V.boom.amp * 0.3 },
    tail: { ...V.tail, amp: V.tail.amp * 0.22, len: Math.max(0.4, V.tail.len * 0.4), echoes: (V.tail.echoes || []).slice(0, 1) },
    puff: true,
  };
}
// One body (blast, body, boom, the action), crack and tail of voice V at sr. seed: a variant.
export function renderVoice(V, sr, seed, act = null) {
  const r = rngOf(seed);
  const t0 = V.hammer ? 0.006 : 0.0015;
  const len = Math.max(0.32, V.body.tau * 6, V.boom.tau * 3.2) + 0.05;
  const body = new Float32Array(Math.ceil(len * sr));
  if (V.hammer) renderEvents(body, sr, [MT(0, 0.12, [[3300, 0.004, 1], [5600, 0.003, 0.5]], { tick: 0.6 })], r);
  const B = V.blast;
  const bl = [{ type: "highpass", f: B.hp || 250, q: 0.7 }];
  if (B.lp) bl.push({ type: "lowpass", f: B.lp, q: 0.7 });
  noiseLayer(body, sr, { start: t0, dur: B.tau * 9, amp: 1, a: 0.00015, tau: B.tau, filters: bl, rnd: r });
  toneLayer(body, sr, { start: t0, f0: B.pop, f1: B.pop * 0.55, dur: 4 / B.pop, amp: B.popAmp, a: 0.0003, tau: 1.1 / B.pop, glide: 3 / B.pop });
  const D = V.body;
  noiseLayer(body, sr, { start: t0, dur: D.tau * 6, amp: D.amp, a: 0.0006, tau: D.tau, filters: [{ type: "bandpass", f: D.f, q: D.q }], rnd: r });
  if (D.sweep) toneLayer(body, sr, { start: t0 + 0.0005, f0: D.sweep[0], f1: D.sweep[1], glide: D.sweep[2], dur: D.sweep[2] * 2.2, amp: D.sweep[3], a: 0.0012, tau: D.sweep[2] * 0.7, drive: 1.5 });
  if (D.ring) renderEvents(body, sr, [MT(t0, 0.16, D.ring, { tick: 0 })], r);
  if (V.brake) noiseLayer(body, sr, { start: t0 + 0.002, dur: 0.2, amp: 0.4, a: 0.002, tau: 0.04, filters: [{ type: "bandpass", f: 600, q: 0.8 }], rnd: r });
  if (V.rocket) noiseLayer(body, sr, { start: t0 + 0.02, dur: Math.min(len - 0.08, 0.9), amp: 0.55, a: 0.04, tau: 0.25, filters: [{ type: "bandpass", f: 700, q: 1.2, to: 2600, sweep: 0.35 }], rnd: r }); // the motor's whoosh
  if (V.puff) noiseLayer(body, sr, { start: t0 + 0.001, dur: 0.05, amp: 0.35, a: 0.002, tau: 0.012, filters: [{ type: "bandpass", f: 520, q: 1.1 }], rnd: r });
  const M = V.boom;
  noiseLayer(body, sr, { start: t0 + 0.001, dur: Math.min(len - t0 - 0.01, M.tau * 5), amp: M.amp, a: 0.003, tau: M.tau, color: "brown", filters: [{ type: "lowpass", f: M.lp, q: 0.7 }], rnd: r });
  shape(body, sr, 0, t0 + 0.06, B.drive);
  normalise(body, 1);
  if (act && HANDLING[act]) renderEvents(body, sr, HANDLING[act], r, t0 + (V.rpm ? 0.008 : 0.016), V.sup ? 0.28 : 0.13); // the action under the bang (louder, relatively, when suppressed)
  normalise(body, V.level);
  // the crack: its own buffer (it leads the bang from far away)
  let crack = null;
  if (V.crack > 0 && V.nlen > 0) {
    crack = new Float32Array(Math.ceil(0.03 * sr));
    nwave(crack, sr, { start: 0, amp: 1, len: V.nlen, refl: 1.2 + V.nlen, rnd: r });
    normalise(crack, V.crack * V.level);
  }
  const tsr = Math.max(22050, Math.round(sr / 2));
  const T = V.tail;
  const tail = rollTail(tsr, { len: T.len, lp: T.lp, lpEnd: T.lpEnd, rise: T.rise, echoes: T.echoes, rnd: r });
  normalise(tail, T.amp * V.level);
  return { body, crack, tail, tsr };
}

// ---------- buffers, per context ----------
const BAKED = new Map(); // `${sr}|key` -> Float32Array sets (shared by every context at that rate)
const CTXBUF = new WeakMap(); // context -> Map key -> AudioBuffer
export const VARIANTS = 3;
function toBuffer(c, data, sr) {
  const b = c.createBuffer(1, data.length, sr || c.sampleRate);
  const ch = b.getChannelData(0);
  if (ch && ch.set) ch.set(data);
  return b;
}
function ctxBufs(c) { let m = CTXBUF.get(c); if (!m) { m = new Map(); CTXBUF.set(c, m); } return m; }
export function voiceKey(p) { return `${p.v}|${p.act || ""}|${p.sup ? (p.sub ? "ss" : "s") : ""}${p.slug ? "|slug" : ""}`; }
export function bakedVoice(sr, p) {
  const key = `${sr}|${voiceKey(p)}`;
  let v = BAKED.get(key);
  if (v) return v;
  let V = GUN_VOICES[p.v] || GUN_VOICES.p9;
  if (p.slug) V = { ...V, crack: 0.35, nlen: 0.45 };
  if (p.sup) V = suppressedSpec(V, p.sub);
  else if (p.sub) V = { ...V, crack: 0 };
  const parts = [];
  for (let i = 0; i < VARIANTS; i++) parts.push(renderVoice(V, sr, hashStr(key) + i * 7919, p.act));
  v = { body: parts.map((x) => x.body), crack: parts[0].crack ? parts.map((x) => x.crack) : null, tail: parts[0].tail, tsr: parts[0].tsr, V };
  BAKED.set(key, v);
  return v;
}
function voiceBuffers(c, p) {
  const m = ctxBufs(c), key = `g|${voiceKey(p)}`;
  let b = m.get(key);
  if (b) return b;
  const v = bakedVoice(c.sampleRate, p);
  b = { body: v.body.map((d) => toBuffer(c, d)), crack: v.crack ? v.crack.map((d) => toBuffer(c, d)) : null, tail: toBuffer(c, v.tail, v.tsr), V: v.V };
  m.set(key, b);
  return b;
}
export function handBuffer(c, name) {
  const m = ctxBufs(c), key = `h|${name}`;
  let b = m.get(key);
  if (b) return b;
  const bk = `${c.sampleRate}|h|${name}`;
  let d = BAKED.get(bk);
  if (!d) { d = renderHandling(name, c.sampleRate); BAKED.set(bk, d); }
  if (!d) return null;
  b = toBuffer(c, d);
  m.set(key, b);
  return b;
}
// Bake the voices a battle will need ahead of time (a few ms each), so the first shot does not stall a frame.
export function prewarm(c, plans) { for (const p of plans) try { voiceBuffers(c, p); } catch { /* best effort */ } }

// ---------- the room and the bus ----------
// The battle's reverb by place: inside (a building raid, a shot from a floor cell), town (city, suburb, a base),
// forest, field (plains, hills, water). send: how much of a near shot goes to it; tail: × the voice's own outdoor tail.
export const ROOMS = {
  inside: { label: "Indoors (tight)", len: 0.55, pre: 0.003, rt: 0.45, lp: 7000, lpEnd: 2500, early: [[0.006, 0.7], [0.011, 0.55], [0.017, 0.45], [0.026, 0.3], [0.034, 0.2]], send: 0.34, tail: 0.3 },
  town:   { label: "Town (slapback)", len: 1.5, pre: 0.008, rt: 1.2, lp: 6000, lpEnd: 1800, early: [[0.045, 0.6], [0.09, 0.45], [0.14, 0.35], [0.23, 0.22], [0.31, 0.12]], send: 0.3, tail: 0.85 },
  forest: { label: "Forest (soft, diffuse)", len: 2.6, pre: 0.02, rt: 2.2, lp: 3500, lpEnd: 900, early: [], send: 0.26, tail: 0.95 },
  field:  { label: "Field (long, open)", len: 2.8, pre: 0.03, rt: 2.4, lp: 3000, lpEnd: 800, early: [[0.38, 0.3], [0.72, 0.15]], send: 0.2, tail: 1 },
};
const TERRAIN_ROOM = { city: "town", suburb: "town", forest: "forest", swamp: "forest", jungle: "forest", plains: "field", hills: "field", mountain: "field", water: "field", desert: "field", tundra: "field" };
export function roomOf(state, b) {
  if (!b) return "field";
  if (b.raid && b.raid.plan && b.raid.plan.building) return "inside";
  const t = state && state.tiles && b.setup && b.setup.tile != null ? state.tiles[b.setup.tile] : null;
  if (b.setup && (b.setup.layout === "baseDefence" || b.setup.layout === "baseAssault")) return "town";
  return (t && TERRAIN_ROOM[t.terrain]) || (t && t.loc ? "town" : "field");
}
export const roomForLayout = (layout) => (ROOMS[layout] ? layout : layout === "baseDefence" || layout === "baseAssault" ? "town" : "field");

const BUS = new WeakMap(); // context -> the battle bus
// The battle bus on context c into dest (the effects bus): in (ducked, muffled), raw (muffled only: the blasts
// themselves), a reverb per room on demand. Returns it (also kept for spatialOut).
export function installBus(c, dest) {
  const muffle = c.createBiquadFilter(); muffle.type = "lowpass"; muffle.frequency.value = 20000; muffle.Q.value = 0.5;
  muffle.connect(dest);
  const duck = c.createGain(); duck.gain.value = 1; duck.connect(muffle);
  const inp = c.createGain(); inp.connect(duck);
  const raw = c.createGain(); raw.connect(muffle);
  const B = {
    c, in: inp, raw, duck, muffle, verbs: {}, muffled: false,
    verb(room) {
      const R = ROOMS[room] || ROOMS.field;
      if (B.verbs[room]) return B.verbs[room];
      const cv = c.createConvolver();
      const [L, Rr] = makeIR(c.sampleRate, R, hashStr(room));
      const buf = c.createBuffer(2, L.length, c.sampleRate);
      if (buf.copyToChannel) { buf.copyToChannel(L, 0); buf.copyToChannel(Rr, 1); } else { buf.getChannelData(0).set(L); buf.getChannelData(1).set(Rr); }
      cv.buffer = buf;
      cv.connect(duck);
      return (B.verbs[room] = cv);
    },
    // A close blast: the other battle sounds drop to depth and come back over rel s (the ears compressing).
    duckAt(t, depth = 0.35, rel = 0.35) {
      const g = duck.gain;
      if (g.cancelScheduledValues) g.cancelScheduledValues(t);
      g.setTargetAtTime(depth, t, 0.004);
      g.setTargetAtTime(1, t + 0.05, rel / 3);
    },
    // Deafened (sim/hearing.js, the selected unit): everything through a low-pass.
    setMuffle(on, t = c.currentTime) {
      if (on === B.muffled) return;
      B.muffled = on;
      muffle.frequency.setTargetAtTime(on ? MUFFLE_HZ : 20000, t, on ? 0.02 : 0.4);
    },
  };
  BUS.set(c, B);
  return B;
}
export const MUFFLE_HZ = 650;
export const busOf = (c) => BUS.get(c) || null;

// ---------- where a sound is ----------
// The listener for a battle: the selected unit of yours (else the middle of the screen). cam (the battle view, ui/
// combat.js LISTEN.cam): { cw, ch, S (CSS px per art px), project(wx, wy, z) -> [X, Y] }; vis: the fog of war (1 seen).
export function listener(b, o = {}) {
  const u = o.sel != null && b ? b.units.find((x) => x.id === o.sel && x.side === "player" && !x.dead && !x.off && !x.left) : null;
  return { w: b ? b.w : 0, lx: u ? u.x : null, ly: u ? u.y : null, cam: o.cam && o.cam.cw > 0 && typeof o.cam.project === "function" ? o.cam : null, vis: o.vis && b && o.vis.length === b.w * b.h ? o.vis : null, room: o.room || "field", b };
}
// Level, highs, delay, pan and reverb of a sound at (x, y) for listener L. o: { enemy (out of sight → muffled), indoor }.
export const DIST = { NEAR: 3, FALL: 0.075, LP_FROM: 4, LP_HALF: 7, LP_MIN: 1400, DELAY: 0.0035, DELAY_MAX: 0.12, PAN: 1.7, PAN_MAX: 0.9, HIDDEN_GAIN: 0.72, HIDDEN_LP: 1600 };
export function spatial(L, x, y, o = {}) {
  let pan = null, d = null;
  if (L && L.cam) {
    const [X, Y] = L.cam.project(x + 0.5, y + 0.5, 0);
    if (Number.isFinite(X)) {
      pan = clamp((X / L.cam.cw - 0.5) * DIST.PAN, -DIST.PAN_MAX, DIST.PAN_MAX);
      if (L.lx == null && Number.isFinite(Y)) d = Math.hypot(X - L.cam.cw / 2, (Y - L.cam.ch / 2) * 2) / (16 * Math.SQRT2 * (L.cam.S || 1));
    }
  }
  if (d == null) d = L && L.lx != null ? Math.hypot(x - L.lx, y - L.ly) : 0;
  if (pan == null) pan = L && L.lx != null ? clamp((x - L.lx) / 14, -0.8, 0.8) : 0;
  const seen = !o.enemy || !L || !L.vis || !L.w || !!L.vis[y * L.w + x];
  return place({ pan, dist: d, seen, room: o.indoor ? "inside" : L ? L.room : "field" });
}
// Level, highs, delay and send from a placement { pan, dist (tiles), seen, room } (spatial's second half; ui/
// zombiesfx.js can call it with its own numbers).
export function place(p) {
  const d = Math.max(0, Number(p.dist) || 0), R = ROOMS[p.room] || ROOMS.field;
  let gain = 1 / (1 + DIST.FALL * Math.max(0, d - DIST.NEAR));
  let lp = clamp(20000 * Math.pow(0.5, Math.max(0, d - DIST.LP_FROM) / DIST.LP_HALF), DIST.LP_MIN, 20000);
  let send = R.send * (0.55 + 0.45 * Math.min(1, d / 24));
  const seen = p.seen !== false;
  if (!seen) { gain *= DIST.HIDDEN_GAIN; lp = Math.min(lp, DIST.HIDDEN_LP); send *= 1.25; }
  return { pan: clamp(Number(p.pan) || 0, -1, 1), dist: d, gain, lp, delay: Math.min(DIST.DELAY_MAX, d * DIST.DELAY), send, room: p.room in ROOMS ? p.room : "field", seen, tail: R.tail };
}
// The node a sound at a placement plays into: level → highs cut → pan → the battle bus (and the room's reverb).
// sp: what spatial() or place() gave, or a bare { pan | x, dist, seen, room | layout }. o.raw: past the ducking (a
// blast itself). Without a bus (a bare offline context) it goes straight to the destination.
export function spatialOut(c, sp = {}, o = {}) {
  if (sp.gain == null) sp = place({ pan: sp.pan ?? sp.x ?? 0, dist: sp.dist ?? sp.d ?? 0, seen: sp.seen, room: sp.room || roomForLayout(sp.layout) });
  const B = busOf(c);
  const g = c.createGain();
  g.gain.value = Math.max(0, sp.gain * (o.gain ?? 1));
  let node = g;
  if (sp.lp < 16000) { const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = sp.lp; f.Q.value = 0.6; node.connect(f); node = f; }
  if (sp.pan && c.createStereoPanner) { const pn = c.createStereoPanner(); pn.pan.value = sp.pan; node.connect(pn); node = pn; }
  node.connect(B ? (o.raw ? B.raw : B.in) : c.destination);
  if (B && sp.send > 0 && o.dry !== true) { const s = c.createGain(); s.gain.value = sp.send * (o.send ?? 1); node.connect(s); s.connect(B.verb(sp.room)); }
  return g;
}

// ---------- playing ----------
const src = (c, buf, t, dest, rate = 1, gain = null) => {
  if (!buf) return null;
  const s = c.createBufferSource();
  s.buffer = buf;
  if (rate !== 1) s.playbackRate.value = rate;
  if (gain != null) { const g = c.createGain(); g.gain.value = gain; s.connect(g); g.connect(dest); } else s.connect(dest);
  s.start(Math.max(0, t));
  return s;
};
export const BRASS = { on: true, CHANCE: 0.55, NEAR: 8, LEVEL: 0.22 }; // brass tinkle: on/off (sound test), how often a near shot drops some
// A shot (or a burst) at t: plan p (shotPlan), placement sp (spatial). Returns the seconds it takes (for the throttle).
export function playGun(c, t, p, sp = place({}), rnd = Math.random) {
  const vb = voiceBuffers(c, p);
  const out = spatialOut(c, sp, { gain: GUN_TRIM * (p.gain ?? 1) });
  const n = p.rounds || 1, times = p.times || burstTimes(n, p.gap || 0, rnd);
  const lag = sp.dist > 4 && vb.crack ? Math.min(0.06, (sp.dist - 4) * 0.0025) : 0; // far away, the crack comes before the bang
  const t0 = t + sp.delay;
  for (let k = 0; k < n; k++) {
    const tk = t0 + times[k], rate = (p.pitch || 1) * (1 + (rnd() - 0.5) * (n > 1 ? 0.05 : 0.04));
    const lv = n > 1 ? Math.pow(10, ((rnd() - 0.5) * 3) / 20) * (k === 0 ? 1 : 0.92) : 1;
    const v = (k + Math.floor(rnd() * VARIANTS)) % VARIANTS;
    if (vb.crack) src(c, vb.crack[v], tk - lag * 0.2, out, rate, lv);
    src(c, vb.body[v], tk + lag, out, rate, lv);
  }
  // one tail for the burst: louder for more rounds (not one each), and a second as the last round dies
  const span = times[n - 1] || 0, tg = (sp.tail ?? 1) * (1 + 0.1 * Math.min(8, n - 1));
  src(c, vb.tail, t0 + lag + 0.005, out, p.pitch || 1, tg);
  if (n >= 4) src(c, vb.tail, t0 + lag + span, out, (p.pitch || 1) * 0.97, tg * 0.6);
  // the manual action (pump, bolt, lever) and the brass, near only
  let end = span + vb.V.tail.len * 0.4;
  if (p.cycle && sp.dist < 14) {
    const at = p.cycle === "bolt" ? 0.5 : p.cycle === "lever" ? 0.42 : 0.4;
    src(c, handBuffer(c, p.cycle === "bolt" ? "bolt2" : p.cycle), t0 + span + at + rnd() * 0.08, out, 1, HAND_LEVEL * 1.6);
    end = Math.max(end, span + at + 0.5);
  }
  if (BRASS.on && p.brass && !p.sup && sp.dist < BRASS.NEAR && rnd() < BRASS.CHANCE) {
    const drops = Math.min(3, n), cyc = p.cycle ? (p.cycle === "bolt" ? 0.85 : 0.6) : 0;
    for (let i = 0; i < drops; i++) src(c, handBuffer(c, p.brass), t0 + cyc + (n > 1 ? (span * i) / drops : 0) + 0.35 + rnd() * 0.3, out, 0.92 + rnd() * 0.16, BRASS.LEVEL * (0.6 + rnd() * 0.4));
  }
  return end;
}
// Handling: reload by platform, jam, unjam, a dry click, the slide locking back on an empty magazine, a taser.
// A script: [[buffer, at, level?]] (shells: n of them, 0.3 s apart, then what closes it).
const shells = (n, from, gap, name = "shellIn") => Array.from({ length: Math.max(1, Math.min(8, n)) }, (_, i) => [name, from + i * gap]);
export function handScript(h) {
  const n = h.n || 1, e = !!h.empty;
  switch (h.kind) {
    case "reload": {
      switch (h.rel) {
        case "pistol": return [["magOut", 0], ["magIn", 0.42], e ? ["slideRel", 0.68] : null];
        case "smg": return [["magOut", 0], ["magIn", 0.4], ["charge", 0.7]];
        case "ak": return [["magOut", 0], ["magIn", 0.5], ["charge", 0.85]];
        case "heavy": return [["magOut", 0, 1.2], ["magIn", 0.65, 1.2], ["chargeHeavy", 1.05]];
        case "belt": return [["coverOpen", 0], ["belt", 0.3], ["coverClose", 0.8], ["chargeHeavy", 1.05]];
        case "pump": { const s = shells(n, 0.1, 0.32); return [...s, e ? ["pump", 0.1 + s.length * 0.32 + 0.1] : null]; }
        case "tube": { const s = shells(n, 0.1, 0.3); return [...s, e ? ["charge", 0.1 + s.length * 0.3 + 0.1] : null]; }
        case "lever": { const s = shells(n, 0.1, 0.32); return [...s, e ? ["lever", 0.1 + s.length * 0.32 + 0.1] : null]; }
        case "bolt": { const s = shells(n, 0.32, 0.27); return [["boltOpen", 0], ...s, ["boltClose", 0.32 + s.length * 0.27 + 0.05]]; }
        case "break": { const s = shells(Math.min(2, n), 0.45, 0.3); return [["breakOpen", 0], ...s, ["breakClose", 0.45 + s.length * 0.3 + 0.15]]; }
        case "single": return [["breakOpen", 0], ["shellIn", 0.4], ["breakClose", 0.7]];
        case "revolver": return [["cylOpen", 0], ["eject", 0.25], ["speedloader", 0.7], ["cylClose", 1.0]];
        case "gl": return [["glOpen", 0], ["glIn", 0.45], ["glClose", 0.8]];
        case "gl32": { const s = shells(n, 0.35, 0.3, "glIn"); return [["glOpen", 0], ...s, ["glClose", 0.35 + s.length * 0.3 + 0.1]]; }
        case "rocket": return [["rocketLoad", 0]];
        default: return [["magOut", 0], ["magIn", 0.48], ["charge", 0.82]]; // rifle
      }
    }
    case "jam": return [["jam", 0]];
    case "unjam": return [["rack", 0]];
    case "dry": return [["dry", 0]];
    case "empty": return [["lockOpen", 0]];
    case "taser": return [["taser", 0, 0.6]];
    case "throw": return [[h.h, 0]]; // a grenade's pin and spoon, a fuse, a lighter, a flare struck (ui/blastsfx.js)
    case "clatter": return [["clatter", 0]];
    case "brass": return [[h.brass || "brassR", 0], [h.brass || "brassR", 0.13, 0.6]];
    default: return [];
  }
}
export function playHand(c, t, h, sp = place({})) {
  const out = spatialOut(c, sp, { gain: GUN_TRIM * HAND_LEVEL * (h.gain ?? 1), send: 0.6 });
  let end = 0;
  for (const ev of handScript(h)) {
    if (!ev) continue;
    const [name, at, lv] = ev;
    const buf = handBuffer(c, name);
    src(c, buf, t + sp.delay + at, out, 0.97 + Math.random() * 0.06, lv ?? 1);
    end = Math.max(end, at + (buf ? buf.duration : 0));
  }
  return end;
}

// ---------- the handling the battle shows (soundcues.js calls this every frame) ----------
// Per unit between frames: a magazine refilled (a reload: by platform, n rounds), a jam appearing (after its shot) or
// cleared (the rack), a magazine run dry by a shot (the slide or bolt locking back), a launcher reloaded, a taser fired.
const LOCKS = new Set(["pistol", "smg", "rifle", "ak", "heavy"]); // these lock open on the last round
export function handCues(b, mem) {
  const out = [];
  const seen = mem.hand || (mem.hand = new Map());
  for (const u of b.units) {
    if (u.kind !== "human" || u.dead) continue;
    const mag = u.magW === u.weapon && u.mag != null ? u.mag : null;
    const now = { w: u.weapon, mag, jam: !!u.jam, glk: u.gl ? u.gl.key : null, glMag: u.gl ? u.gl.mag : null, glLoad: u.gl ? u.gl.load : null, taser: u.nlTaser ?? null };
    const was = seen.get(u.id);
    seen.set(u.id, now);
    if (!was || u.off || u.left) continue;
    const at = [u.x, u.y], mine = u.side === "player", row = gunVoice(u.weapon);
    if (was.w === now.w && was.mag != null && now.mag != null) {
      if (now.mag > was.mag) out.push({ name: "reload", at, mine, unit: u.id, hand: { kind: "reload", rel: row.rel, n: now.mag - was.mag, empty: was.mag === 0 } });
      else if (now.mag === 0 && was.mag > 0 && LOCKS.has(row.rel)) out.push({ name: "empty", at, mine, unit: u.id, after: true, hand: { kind: "empty" } });
    }
    if (was.w === now.w && !was.jam && now.jam) out.push({ name: "jam", at, mine, unit: u.id, after: true, hand: { kind: "jam" } });
    if (was.w === now.w && was.jam && !now.jam && !(now.mag != null && was.mag != null && now.mag > was.mag)) out.push({ name: "unjam", at, mine, unit: u.id, hand: { kind: "unjam" } });
    if (was.glk && was.glk === now.glk && now.glMag > was.glMag) out.push({ name: "reload", at, mine, unit: u.id, hand: { kind: "reload", rel: gunVoice(now.glk).rel, n: now.glMag - was.glMag, empty: was.glMag === 0 } });
    if (was.taser != null && now.taser != null && now.taser < was.taser) out.push({ name: "taser", at, mine, unit: u.id, taser: true, hand: { kind: "taser" } });
  }
  return out;
}
// Did unit u just fire its launcher (its round counter dropped, or a one-shot tube is gone)? soundcues.js.
export function launched(mem, u) {
  const was = mem.hand && mem.hand.get(u.id);
  if (!was || !was.glk) return null;
  if (!u.gl) return gunVoice(was.glk).v === "rocket" ? "rocket" : "gl"; // a tube fired and gone (the AT4)
  if (u.gl.key === was.glk && u.gl.mag < was.glMag) return u.gl.cal === "rocket" ? "rocket" : "gl";
  return null;
}
export const isIndoor = (b, x, y) => { try { return indoors(b, x, y); } catch { return false; } };

// ---------- the sound test (Settings → Sound: ui/sfxlab.js) ----------
export const LAB_GUNS = [
  ["pistol22", ".22 target pistol"], ["pistol", "9mm pistol"], ["compact9", "Compact 9mm"], ["pistol45", "1911 .45"], ["revolver", ".357 revolver"],
  ["smg", "9mm SMG"], ["carbine", "Police carbine (5.56)"], ["ar", "Assault rifle (5.56)"], ["ak", "AK (7.62×39)"], ["lmg", "Light machine gun"],
  ["rifle22", ".22 rifle"], ["leverrifle", "Lever-action .30-30"], ["huntrifle", "Hunting rifle (.308)"], ["dmr", "Marksman rifle (.308)"], ["sniper", "Sniper rifle (.308)"],
  ["amr", ".50 anti-materiel rifle"], ["turret_m2", "M2 turret (.50)"], ["shotgun", "Pump shotgun"], ["semishotgun", "Semi-auto shotgun"], ["dbshotgun", "Double-barrel"],
  ["sawnoff", "Sawn-off"], ["pipegun", "Pipe shotgun"], ["m79", "40 mm launcher"], ["rpg", "Rocket launcher"],
];
// A plan for the sound test: gun key, mode (single | burst | auto), suppressed, subsonic.
export function labPlan(key, mode = "single", sup = false, sub = false) {
  const w = WEAPONS[key] || {};
  const m = w.modes && w.modes[mode] ? w.modes[mode].rounds : 1;
  const row = gunVoice(key);
  const rounds = key === "turret_m2" || key === "turret_lmg" ? (mode === "single" ? 1 : mode === "burst" ? 3 : 12) : m;
  const gap = rounds > 1 ? roundGap(key) : 0;
  const cal = w.cal || calOf(key);
  return { key, v: row.v, act: row.act || null, cycle: row.cycle || null, brass: row.brass || null, rel: row.rel, pitch: row.pitch || 1,
    sup: !!sup && row.v !== "r357" && !!w.noise, sub: sub || !supersonic(cal, null), slug: false, rounds, gap, span: (rounds - 1) * gap };
}
// test helper: the raw data of a voice (no context)
export const _filterAll = filterAll;
