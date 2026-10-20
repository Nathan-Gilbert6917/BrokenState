// Melee sounds: what a blow sounds like by the weapon swung, what it lands on and how it ends. ui/soundcues.js hands
// every melee effect (sim/combat.js fx type "melee") from someone who is not one of the dead to meleeCue, and ui/audio.js
// plays the cue with the voices made here (meleeVoices). Pure functions until a voice plays: node tools import it.
//
//   meleeClass(key, how)   the sound class of a weapon: punch, wood, metal, heavy, blade, chop, stab, butt, claws
//   meleeCue(b, f, a, mem) one cue for one blow: { name: melee | meleeCrit | whoosh, cls, w, mat, head, kill, struct }
//   meleeVoices(K)         the voices, built on audio.js's building blocks K (env, filt, noise, tone, thud, bell, crackle, R)
//
// The names stay the old three (melee, meleeCrit, whoosh): the volley's priorities and the throttle know them. A hit
// is the swing and the impact in one voice (the swing's whoosh leads into it), so a blow is one sound in the volley.
// Armour (sim/combat.js strike: fx mat / through / loc): a blow stopped by a plate or a helmet is heard on it (a
// clang on steel, a hard clack on ceramic, a knock on a polymer helmet, a dull thump on soft armour); one that goes
// through is heard on both. A blow that kills (or a critical) is heavier: a crunch of bone and the body going down.
import { WEAPONS, hitMult } from "../sim/combat.js";
import { panOfX } from "./sfx-out.js";

// Sound class by weapon key, then by its melee class (data-guns.js mclass: blade | pierce | chop | blunt | heavy).
const BY_KEY = {
  fists: "punch", claws: "claws",
  bat: "wood", spikedbat: "wood", nailbat: "wood", golfclub: "metal",
  prybar: "metal", baton: "metal", stunbaton: "metal", hammer: "metal", pipespear: "stab", spear: "stab", combatknife: "stab",
  sledge: "heavy", pickaxe: "heavy", etool: "chop",
};
const BY_MCLASS = { blade: "blade", pierce: "stab", chop: "chop", blunt: "metal", heavy: "heavy" };
export const MELEE_CLASSES = ["punch", "wood", "metal", "heavy", "blade", "chop", "stab", "butt", "claws"];
// Per class: w = how heavy the swing is (0 a jab, 1 a sledgehammer: a slower, lower whoosh), lead = seconds from the
// swing's start to the impact.
export const CLASS = {
  punch: { w: 0.1, lead: 0.05 }, wood: { w: 0.55, lead: 0.09 }, metal: { w: 0.45, lead: 0.08 }, heavy: { w: 1, lead: 0.16 },
  blade: { w: 0.35, lead: 0.06 }, chop: { w: 0.7, lead: 0.11 }, stab: { w: 0.3, lead: 0.05 }, butt: { w: 0.6, lead: 0.09 },
  claws: { w: 0.2, lead: 0.04 },
};
export function meleeClass(key, how = null) {
  const w = WEAPONS[key];
  if (how === "bash" || (w && !w.melee)) return "butt"; // a gun swung as a club
  return BY_KEY[key] || (w && BY_MCLASS[w.mclass]) || "metal";
}

// Armoured dead (sim/deadsoldiers.js ARMORED, a Boneback's plates): no pieces, so the blow is heard on armour when it
// takes most of it (hitMult under ARMOUR_HEARD).
export const ARMOUR_HEARD = 0.75;
const DEAD_MAT = { soldier: "ceramic", riot: "hard", boneback: "bone" };

const at = (b, [x, y]) => b.units.filter((u) => u.x === x && u.y === y && !u.off);
// The one a blow at [x, y] struck: someone still up there before the fallen (a body under a living one is not it).
function struckAt(b, to) {
  const here = at(b, to);
  return here.find((u) => !u.dead && !u.down) || here[0] || null;
}

// One blow as a cue. a: the striker (soundcues.js unitAt; null for effects with no striker). Effects that are not a
// plain blow (a knock-out, a stun, a ram, a burst of acid: f.text) keep the old plain thud with no class.
export function meleeCue(b, f, a, mem = {}) {
  return { ...blowCue(b, f, a, mem), at: f.to, enemy: f.side !== "player", pan: panOfX(b, f.to && f.to[0]) }; // at: placed by ui/gunsfx.js spatial (pan: with no listener)
}
const SHOVE_TEXT = new Set(["SHOVED", "FLOORED", "FALL", "THROUGH"]);
function blowCue(b, f, a, mem) {
  if (!f.hit) return { name: "whoosh", ...(a ? clsOf(a) : {}) };
  const text = f.text || "";
  const t = struckAt(b, f.to);
  const self = f.from && f.to && f.from[0] === f.to[0] && f.from[1] === f.to[1];
  // A door, a window, a barricade, a wall battered (combat.js bash, siege.js): no one stands there.
  if (!t && !self && a) return { name: /BROKEN|SMASHED/.test(text) ? "meleeCrit" : "melee", struct: true, broke: /BROKEN|SMASHED/.test(text), ...clsOf(a) };
  if (SHOVE_TEXT.has(text)) return { name: text === "SHOVED" ? "melee" : "meleeCrit", shove: true, floor: text !== "SHOVED" }; // sim/shoving.js: a shoulder into them; flat on their back, a fall, through a window: the body going down
  if (text) return { name: (f.dmg || 0) >= 25 ? "meleeCrit" : "melee" }; // KO, STUN, RAMMED, ROCK, a launcher's round (gun-sfx's)…
  const cue = { name: "melee", ...(a ? clsOf(a) : { cls: "metal", w: CLASS.metal.w }) };
  const kill = !!(t && (t.dead || t.down) && (f.dmg || 0) > 0);
  if (kill) cue.kill = true;
  if (f.crit) cue.crit = true;
  if (kill || f.crit || (f.dmg || 0) >= 25) cue.name = "meleeCrit";
  if (f.loc === "head") cue.head = true;
  if (f.mat) { cue.mat = f.mat; cue.through = !!f.through; } // a person's armour (sim/armour.js)
  else if (t && t.ztype && DEAD_MAT[t.ztype] && !f.crit) {
    let m = 1;
    try { m = hitMult(t, a, { how: cue.cls === "butt" ? "bash" : "melee", crit: false }); } catch { m = 1; }
    if (m < ARMOUR_HEARD) { cue.mat = DEAD_MAT[t.ztype]; cue.through = m > 0.5; }
  }
  return cue;
}
function clsOf(a) {
  const cls = a.kind === "zombie" ? "claws" : meleeClass(a.weapon);
  return { cls, w: CLASS[cls].w };
}

// ---------- the voices ----------
// o: { gain, pitch, cls, w, mat, through, head, kill, crit, struct, broke, shove, floor }. K: audio.js's building blocks.
export function meleeVoices(K) {
  const { env, filt, noise, tone, thud, bell, crackle, R } = K;
  // The swing: a band of noise sweeping up and down; a heavy weapon's is longer and lower. Ends about when it lands.
  function swing(c, out, t, o, peak) {
    const w = Number.isFinite(o.w) ? o.w : 0.4;
    const d = 0.11 + 0.17 * w;
    const f0 = (1500 - 700 * w) * o.pitch * R(0.9, 1.1);
    const f = filt(c, "bandpass", f0, 1.4, env(c, out, t, peak * (0.7 + 0.5 * w) * o.gain, d * 0.6, d * 0.45));
    f.frequency.setValueAtTime(f0 * 0.6, t);
    f.frequency.exponentialRampToValueAtTime(f0 * 1.6, t + d * 0.5);
    f.frequency.exponentialRampToValueAtTime(f0 * 0.5, t + d);
    noise(c, "white", t, d + 0.02, f);
  }
  // The impact by class at t: what the weapon itself sounds like meeting a body.
  function impact(c, out, t, o, k) {
    const p = o.pitch, g = o.gain * k;
    switch (o.cls) {
      case "punch": // a meaty smack: a low thump and the slap of skin
        thud(c, out, t, 105 * p, 0.6 * g, 0.07);
        noise(c, "white", t, 0.04, filt(c, "bandpass", 1300 * p, 1, env(c, out, t, 0.35 * g, 0.03, 0.001)));
        break;
      case "wood": // a bat: a hollow wooden knock over the thud
        thud(c, out, t, 115 * p, 0.6 * g, 0.09);
        noise(c, "white", t, 0.06, filt(c, "bandpass", R(650, 800) * p, 4, env(c, out, t, 0.6 * g, 0.05, 0.001)));
        tone(c, "triangle", 430 * p, 310 * p, t, 0.07, env(c, out, t, 0.18 * g, 0.06, 0.001));
        break;
      case "heavy": // a sledgehammer: a deep blow, a crunch and the ground shaking
        thud(c, out, t, 68 * p, 1 * g, 0.2);
        noise(c, "white", t, 0.09, filt(c, "bandpass", 850 * p, 1.2, env(c, out, t, 0.5 * g, 0.08, 0.001)));
        break;
      case "blade": // a slice: a bright hiss falling fast, and a small wet thud
        { const f = filt(c, "highpass", 3200 * p, 0.8, env(c, out, t, 0.4 * g, 0.07, 0.001));
          f.frequency.setValueAtTime(4200 * p, t); f.frequency.exponentialRampToValueAtTime(1600, t + 0.07);
          noise(c, "white", t, 0.08, f); }
        noise(c, "white", t + 0.01, 0.08, filt(c, "bandpass", 600 * p, 3, env(c, out, t + 0.01, 0.3 * g, 0.07, 0.004)));
        thud(c, out, t, 165 * p, 0.3 * g, 0.05);
        break;
      case "chop": // an axe: a thunk with a sharp crack at its front
        thud(c, out, t, 100 * p, 0.8 * g, 0.11);
        noise(c, "white", t, 0.03, filt(c, "bandpass", 1900 * p, 2, env(c, out, t, 0.55 * g, 0.025, 0.001)));
        noise(c, "white", t + 0.015, 0.09, filt(c, "bandpass", 520 * p, 2.5, env(c, out, t + 0.015, 0.25 * g, 0.08, 0.004)));
        break;
      case "stab": // a thrust: short and punchy, a squelch sliding down
        thud(c, out, t, 150 * p, 0.55 * g, 0.05);
        { const f = filt(c, "bandpass", 900 * p, 3, env(c, out, t, 0.35 * g, 0.1, 0.004));
          f.frequency.setValueAtTime(900 * p, t); f.frequency.exponentialRampToValueAtTime(380, t + 0.1);
          noise(c, "white", t, 0.11, f); }
        break;
      case "butt": // a rifle butt: a thud and the gun's parts rattling
        thud(c, out, t, 112 * p, 0.7 * g, 0.09);
        for (const d of [0.012, 0.03]) noise(c, "white", t + d, 0.012, filt(c, "bandpass", 2700 * p, 3, env(c, out, t + d, 0.22 * g, 0.01, 0.001)));
        break;
      case "claws": // a swipe that connects: a scratch
        noise(c, "white", t, 0.07, filt(c, "bandpass", 2200 * p, 1.5, env(c, out, t, 0.3 * g, 0.06, 0.003)));
        thud(c, out, t, 130 * p, 0.35 * g, 0.05);
        break;
      default: // a pipe, a crowbar, a baton (and anything unknown): the thud and a dull metal clunk
        thud(c, out, t, 125 * p, 0.7 * g, 0.1);
        if (o.cls === "metal") for (const [f, a] of [[880, 0.12], [2350, 0.06]]) tone(c, "sine", f * p * R(0.95, 1.05), 0, t, 0.09, env(c, out, t, a * g, 0.08, 0.001));
    }
  }
  // Armour taking it at t: a helmet (head) rings higher.
  function armour(c, out, t, o, k) {
    const p = o.pitch * (o.head ? 1.18 : 1), g = o.gain * k;
    switch (o.mat) {
      case "steel": // a clang
        bell(c, out, t, R(520, 700) * p, 0.22 * g, 0.4);
        noise(c, "white", t, 0.02, filt(c, "highpass", 3000, 0.7, env(c, out, t, 0.3 * g, 0.015, 0.001)));
        break;
      case "ceramic": // a hard, gritty clack
        noise(c, "white", t, 0.03, filt(c, "highpass", 2600 * p, 0.8, env(c, out, t, 0.45 * g, 0.025, 0.001)));
        noise(c, "white", t, 0.07, filt(c, "bandpass", 1150 * p, 6, env(c, out, t, 0.4 * g, 0.06, 0.001)));
        crackle(c, out, t + 0.01, 3, 0.05, 0.12 * g);
        break;
      case "soft": case "padding": // soft armour: a dead, muffled thump
        noise(c, "brown", t, 0.09, filt(c, "lowpass", 420 * p, 0.7, env(c, out, t, 0.7 * g, 0.08, 0.002)));
        tone(c, "sine", 90 * p, 55, t, 0.08, env(c, out, t, 0.4 * g, 0.07, 0.002));
        break;
      default: // hard polymer (a helmet, riot gear), a Boneback's plates: a hollow knock
        noise(c, "white", t, 0.05, filt(c, "bandpass", (o.mat === "bone" ? 560 : 1400) * p, 5, env(c, out, t, 0.5 * g, 0.04, 0.001)));
        tone(c, "triangle", (o.mat === "bone" ? 330 : 720) * p, (o.mat === "bone" ? 260 : 520) * p, t, 0.06, env(c, out, t, 0.2 * g, 0.05, 0.001));
    }
  }
  // A kill: bone giving way, then the body hitting the ground.
  function kill(c, out, t, o) {
    noise(c, "white", t + 0.005, 0.06, filt(c, "bandpass", 1700 * o.pitch, 1.4, env(c, out, t + 0.005, 0.4 * o.gain, 0.05, 0.001)));
    crackle(c, out, t + 0.01, 4, 0.05, 0.18 * o.gain);
    const drop = t + R(0.24, 0.34);
    thud(c, out, drop, 62 * o.pitch, 0.55 * o.gain, 0.2);
    noise(c, "brown", drop + 0.04, 0.12, filt(c, "lowpass", 500, 0.7, env(c, out, drop + 0.04, 0.25 * o.gain, 0.1, 0.004)));
  }
  // A door, a window, a barricade: a wooden boom, splinters when it gives way.
  function structure(c, out, t, o) {
    thud(c, out, t, 80 * o.pitch, 0.8 * o.gain, 0.16);
    noise(c, "white", t, 0.12, filt(c, "bandpass", 320 * o.pitch, 2, env(c, out, t, 0.5 * o.gain, 0.11, 0.002)));
    if (o.broke) {
      crackle(c, out, t + 0.02, 10, 0.3, 0.3 * o.gain);
      noise(c, "white", t + 0.01, 0.25, filt(c, "bandpass", 1600, 0.9, env(c, out, t + 0.01, 0.35 * o.gain, 0.22, 0.003)));
    }
  }
  // A shove (sim/shoving.js): no swing, a shoulder into them (a dull low thump and the rustle of clothes), feet
  // scuffing back; floor: the body hitting the ground a moment later (no bone giving way: nobody was struck).
  function shove(c, out, t, o) {
    thud(c, out, t, 88 * o.pitch, 0.5 * o.gain, 0.09);
    noise(c, "brown", t, 0.1, filt(c, "lowpass", 700 * o.pitch, 0.7, env(c, out, t, 0.35 * o.gain, 0.09, 0.003)));
    noise(c, "white", t + 0.07, 0.14, filt(c, "bandpass", 2300, 0.8, env(c, out, t + 0.07, 0.09 * o.gain, 0.12, 0.01)));
    if (!o.floor) return;
    const drop = t + R(0.3, 0.38);
    thud(c, out, drop, 60 * o.pitch, 0.6 * o.gain, 0.2);
    noise(c, "brown", drop + 0.03, 0.14, filt(c, "lowpass", 480, 0.7, env(c, out, drop + 0.03, 0.28 * o.gain, 0.12, 0.004)));
  }
  // A blow that lands: the swing, then (lead later) the impact, the armour, the kill.
  function blow(c, out, t, o, heavy) {
    if (o.shove) return shove(c, out, t, o);
    if (o.struct) { swing(c, out, t, o, 0.12); return structure(c, out, t + (CLASS[o.cls] || CLASS.metal).lead, o); }
    if (!o.cls) { // a plain thud (an effect with no striker: the old sound)
      thud(c, out, t, (heavy ? 120 : 140) * o.pitch, (heavy ? 0.9 : 0.7) * o.gain, heavy ? 0.14 : 0.1);
      if (heavy) noise(c, "white", t + 0.005, 0.08, filt(c, "bandpass", 1800, 1.5, env(c, out, t + 0.005, 0.6 * o.gain, 0.06, 0.001)));
      return;
    }
    const C = CLASS[o.cls] || CLASS.metal;
    swing(c, out, t, o, 0.14);
    const ti = t + C.lead * R(0.85, 1.15);
    const k = heavy ? 1.25 : 1;
    const q = heavy ? { ...o, pitch: o.pitch * 0.92 } : o;
    if (o.mat) {
      armour(c, out, ti, q, o.through ? 0.45 : 1);
      impact(c, out, ti + 0.004, q, o.through ? 0.85 * k : 0.3); // stopped: little of the blow reaches the body
    } else impact(c, out, ti, q, k);
    if (o.kill || o.crit) kill(c, out, ti, q);
  }
  return {
    melee: { dur: 0.45, play(c, out, t, o) { blow(c, out, t, o, false); } },
    meleeCrit: { dur: 0.6, play(c, out, t, o) { blow(c, out, t, o, true); } },
    whoosh: { dur: 0.32, play(c, out, t, o) { swing(c, out, t, o, 0.3); } },
    // For Options → Hear (the same voices with a class set).
    hearPunch: { dur: 0.45, play(c, out, t, o) { blow(c, out, t, { ...o, cls: "punch", w: CLASS.punch.w }, false); } },
    hearBat: { dur: 0.45, play(c, out, t, o) { blow(c, out, t, { ...o, cls: "wood", w: CLASS.wood.w }, false); } },
    hearPipe: { dur: 0.45, play(c, out, t, o) { blow(c, out, t, { ...o, cls: "metal", w: CLASS.metal.w }, false); } },
    hearBlade: { dur: 0.45, play(c, out, t, o) { blow(c, out, t, { ...o, cls: "blade", w: CLASS.blade.w }, false); } },
    hearAxe: { dur: 0.45, play(c, out, t, o) { blow(c, out, t, { ...o, cls: "chop", w: CLASS.chop.w }, false); } },
    hearSledge: { dur: 0.6, play(c, out, t, o) { blow(c, out, t, { ...o, cls: "heavy", w: CLASS.heavy.w, kill: true }, true); } },
    hearPlate: { dur: 0.45, play(c, out, t, o) { blow(c, out, t, { ...o, cls: "metal", w: CLASS.metal.w, mat: "steel" }, false); } },
    hearHelmet: { dur: 0.45, play(c, out, t, o) { blow(c, out, t, { ...o, cls: "wood", w: CLASS.wood.w, mat: "hard", head: true }, false); } },
  };
}
export const MELEE_LABELS = {
  melee: "Melee hit", meleeCrit: "Melee kill or critical", whoosh: "Melee miss (swing)",
  hearPunch: "Melee: punch", hearBat: "Melee: bat", hearPipe: "Melee: pipe or crowbar", hearBlade: "Melee: blade", hearAxe: "Melee: axe",
  hearSledge: "Melee: sledgehammer kill", hearPlate: "Melee: blow on a steel plate", hearHelmet: "Melee: blow on a helmet",
};
