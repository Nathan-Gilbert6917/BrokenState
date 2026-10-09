// The preview renders (tools/sfxpreview/main.cjs loads this page in a hidden Electron window): every gun voice,
// fire mode, suppressed form, distance and room, the handling, every blast and the grenade sequences, the old sound
// of each class next to them, and two 6-second mixes (a firefight, a grenade fight) old and new. Each render goes
// through the game's chain at the default sliders (ui/sfxlab.js labRender) with the same makeup gain for old and new.
import { VOICES } from "../../src/ui/audio.js";
import { labRender, grenadeFight } from "../../src/ui/sfxlab.js";
import { labPlan, place, playGun, playHand, gunVoice } from "../../src/ui/gunsfx.js";
import { playBlast, flight } from "../../src/ui/blastsfx.js";
import { weaponSound } from "../../src/ui/soundcues.js";
import { stats } from "../../src/ui/sfxdsp.js";
import { WEAPONS } from "../../src/sim/combat.js";

export const MAKEUP = 1.4; // +3 dB for listening, the same for old and new (stats.json: subtract it for the game's level)
const near = (o = {}) => place({ dist: 2, pan: 0, room: "field", ...o });
const old = (name, gain = 1) => ({ old: true, secs: Math.max(1.2, (VOICES[name].dur || 1) + 0.6), fn: (c, t, sfx) => VOICES[name].play(c, sfx, t, { gain, pitch: 1 }) });
const gun = (key, mode = "single", o = {}, secs = 3) => ({ secs, fn: (c, t) => playGun(c, t, labPlan(key, mode, o.sup, o.sub), near(o.sp)) });
const hand = (h, key = "ar", secs = 2.2) => ({ secs, fn: (c, t) => playHand(c, t, { ...h, rel: h.rel || gunVoice(key).rel }, near()) });
const blast = (kind, o = {}, secs = 4) => ({ secs, fn: (c, t) => playBlast(c, t, { kind, glass: o.glass }, near(o.sp)) });

export const RENDERS = {
  // the old sounds, one per class
  pistol_old: old("pistol"), revolver_old: old("revolver"), rifle_old: old("rifle"), shotgun_old: old("shotgun"), auto_old: old("auto"), suppressed_old: old("suppressed"),
  bow_old: old("bow"), blast_old: old("blast"), fire_old: old("fire"), hiss_old: old("hiss"), flare_old: old("flare"),
  // the new guns, near, single
  pistol22_new: gun("pistol22"), rifle22_new: gun("rifle22"), pistol9_new: gun("pistol"), compact9_new: gun("compact9"), pistol45_new: gun("pistol45"), revolver357_new: gun("revolver"),
  smg9_new: gun("smg"), carbine556_new: gun("carbine"), rifle556_new: gun("ar"), ak762_new: gun("ak"), lmg556_new: gun("lmg"),
  lever3030_new: gun("leverrifle"), hunt308_new: gun("huntrifle"), dmr308_new: gun("dmr"), sniper308_new: gun("sniper", "single", {}, 4), amr50_new: gun("amr", "single", {}, 4.5), m2_new: gun("turret_m2", "single", {}, 4),
  shotgun12_new: gun("shotgun"), semishotgun_new: gun("semishotgun"), dbshotgun_new: gun("dbshotgun"), sawnoff_new: gun("sawnoff"), pipegun_new: gun("pipegun"),
  gl40_new: gun("m79"), rocket_new: gun("rpg", "single", {}, 3.5),
  // fire modes
  smg9_burst_new: gun("smg", "burst"), smg9_auto_new: gun("smg", "auto"), rifle556_burst_new: gun("ar", "burst"), rifle556_auto_new: gun("ar", "auto"),
  ak762_auto_new: gun("ak", "auto"), lmg556_auto_new: gun("lmg", "auto", {}, 4), m2_auto_new: gun("turret_m2", "auto", {}, 5),
  // suppressed, subsonic
  pistol9_suppressed_new: gun("pistol", "single", { sup: true }), pistol9_supp_subsonic_new: gun("pistol", "single", { sup: true, sub: true }),
  pistol45_suppressed_new: gun("pistol45", "single", { sup: true }), rifle22_supp_subsonic_new: gun("rifle22", "single", { sup: true, sub: true }),
  rifle556_suppressed_new: gun("ar", "single", { sup: true }), rifle556_supp_auto_new: gun("ar", "auto", { sup: true }), hunt308_suppressed_new: gun("huntrifle", "single", { sup: true }),
  // distance, out of sight, place
  rifle556_mid_new: gun("ar", "single", { sp: { dist: 12 } }), rifle556_far_new: gun("ar", "single", { sp: { dist: 30 } }), rifle556_hidden_new: gun("ar", "single", { sp: { dist: 12, seen: false } }),
  hunt308_town_new: gun("huntrifle", "single", { sp: { room: "town" } }, 4), hunt308_forest_new: gun("huntrifle", "single", { sp: { room: "forest" } }, 4),
  hunt308_inside_new: gun("huntrifle", "single", { sp: { room: "inside" } }, 4), hunt308_left_new: gun("huntrifle", "single", { sp: { pan: -0.7 } }, 4),
  // handling
  reload_pistol_new: hand({ kind: "reload", empty: true }, "pistol"), reload_rifle_new: hand({ kind: "reload" }, "ar"), reload_ak_new: hand({ kind: "reload" }, "ak"),
  reload_pump_new: hand({ kind: "reload", n: 4, empty: true }, "shotgun"), reload_double_new: hand({ kind: "reload", n: 2 }, "dbshotgun"), reload_revolver_new: hand({ kind: "reload" }, "revolver"),
  reload_bolt_new: hand({ kind: "reload", n: 5 }, "huntrifle"), reload_belt_new: hand({ kind: "reload" }, "lmg"), reload_gl40_new: hand({ kind: "reload" }, "m79"), reload_rocket_new: hand({ kind: "reload" }, "rpg"),
  jam_new: hand({ kind: "jam" }), unjam_new: hand({ kind: "unjam" }), dryfire_new: hand({ kind: "dry" }), empty_lock_new: hand({ kind: "empty" }, "pistol"), brass_new: hand({ kind: "brass", brass: "brassR", gain: 2.2 }),
  taser_new: hand({ kind: "taser" }),
  // blasts
  pipebomb_new: blast("pipebomb"), frag_new: blast("frag"), gl40he_new: blast("gl40"), rocket_warhead_new: blast("rocket", {}, 5.5), vehicle_new: blast("vehicle", {}, 6.5),
  secondary_new: blast("secondary"), cookoff_new: blast("cookoff"), flashbang_new: blast("flash"), firecracker_new: blast("firecracker"),
  molotov_new: blast("molotov", {}, 6), smoke_new: blast("smoke"), flare_new: blast("flare"), frag_glass_new: blast("frag", { glass: true }),
  frag_mid_new: blast("frag", { sp: { dist: 12 } }), frag_far_new: blast("frag", { sp: { dist: 30 } }), rocket_far_new: blast("rocket", { sp: { dist: 30 } }, 5.5),
  // sequences
  grenade_throw_new: { secs: 4.5, fn: (c, t) => { playHand(c, t, { kind: "throw", h: "pin", gain: 1.4 }, near()); playHand(c, t + 0.75, { kind: "clatter", gain: 1.6 }, near({ dist: 6 })); playBlast(c, t + 1.2, { kind: "frag" }, near({ dist: 6 })); } },
  molotov_throw_new: { secs: 6.5, fn: (c, t) => { playHand(c, t, { kind: "throw", h: "light", gain: 1.4 }, near()); playBlast(c, t + 0.5, { kind: "molotov" }, near({ dist: 6 })); } },
  gl40_seq_new: { secs: 4.5, fn: (c, t) => { playGun(c, t, labPlan("m79"), near()); playBlast(c, t + flight("gl", 14), { kind: "gl40" }, near({ dist: 14 })); } },
  rocket_seq_new: { secs: 6, fn: (c, t) => { playGun(c, t, labPlan("rpg"), near()); playBlast(c, t + flight("rocket", 12), { kind: "rocket" }, near({ dist: 12 })); } },
};

// The 6-second firefight: [t, gun, mode, distance, pan, side]. Old: the old class voice at the old gains (a random pan
// within ±0.25, no distance); new: the new voice placed in town.
const FIGHT = [
  [0.0, "ar", "burst", 3, -0.3, "p"], [0.35, "ak", "auto", 14, 0.55, "e"], [0.9, "pistol", "single", 2, -0.5, "p"], [1.2, "huntrifle", "single", 22, 0.7, "e"],
  [1.6, "lmg", "auto", 4, 0.1, "p"], [2.5, "shotgun", "single", 8, 0.4, "e"], [2.9, "smg", "auto", 11, 0.6, "e"], [3.4, "revolver", "single", 2, -0.6, "p"],
  [3.8, "ar", "auto", 3, -0.3, "p"], [4.4, "ak", "burst", 17, 0.8, "e"], [4.8, "sniper", "single", 30, -0.8, "e"], [5.2, "carbine", "single", 3, -0.2, "p"],
];
RENDERS.firefight_new = { secs: 6, fn: (c, t) => { for (const [at, k, m, d, pan, side] of FIGHT) playGun(c, t + at, { ...labPlan(k, m), gain: side === "p" ? 1 : 0.85 }, place({ dist: d, pan, room: "town", seen: d < 20 })); } };
RENDERS.firefight_old = { old: true, secs: 6, fn: (c, t, sfx) => {
  for (const [at, k, m, , , side] of FIGHT) {
    const p = c.createStereoPanner(); p.pan.value = (Math.random() - 0.5) * 0.5; p.connect(sfx);
    VOICES[weaponSound(k)].play(c, p, t + at, { gain: side === "p" ? 1 : 0.85, pitch: 1 });
  }
} };
RENDERS.grenadefight_new = { secs: 6.5, fn: (c, t) => grenadeFight(c, t, { room: "town" }) };
RENDERS.grenadefight_old = { old: true, secs: 6.5, fn: (c, t, sfx) => {
  const V = (n, at, g = 1) => VOICES[n].play(c, sfx, t + at, { gain: g, pitch: 1 });
  [[0, "auto"], [0.5, "auto"], [1.2, "rifle"], [2.4, "auto"], [3.1, "pistol"], [4.2, "auto"], [5.0, "auto"]].forEach(([at, n]) => V(n, at, 0.9));
  V("blast", 1.2 + 0.45); V("blast", 2.6); V("blast", 3.3 + flight("gl", 10)); V("fire", 4.3); V("blast", 4.6 + flight("rocket", 14));
} };

// Both sliders at 100% and no makeup: what reaches the speakers at the loudest settings (the limiter's job).
for (const k of ["firefight_new", "firefight_old", "grenadefight_new", "grenadefight_old"]) RENDERS[k.replace(/_(new|old)$/, "_max_$1")] = { ...RENDERS[k], max: true, makeup: 1 };
// The game's own level (no makeup) at the default sliders, and with the Gunfire slider at 150% on top of full sliders,
// metered: the limiter's gain reduction.
for (const k of ["firefight_new", "grenadefight_new", "firefight_old", "grenadefight_old"]) RENDERS[k.replace(/_(new|old)$/, "_game_$1")] = { ...RENDERS[k], makeup: 1, meter: true };
for (const k of ["firefight_new", "grenadefight_new"]) RENDERS[k.replace(/_new$/, "_max150_new")] = { ...RENDERS[k], max: true, makeup: 1, gunVol: 2.25, meter: true };
for (const k of ["firefight_max_new", "grenadefight_max_new", "pistol9_new", "rifle556_new", "amr50_new", "m2_auto_new", "lmg556_auto_new", "frag_new", "rocket_warhead_new", "vehicle_new"]) RENDERS[k].meter = true;
const b64 = (i16) => { const u8 = new Uint8Array(i16.buffer); let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
export async function render(name) {
  const R = RENDERS[name];
  const out = await labRender(R.fn, R.secs, { limiter: !R.old, makeup: R.makeup ?? MAKEUP, max: !!R.max, gunVol: R.gunVol, meter: !!R.meter });
  const n = out.L.length, i16 = new Int16Array(n * 2), mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const l = out.L[i], r = out.R[i];
    mono[i] = Math.abs(l) > Math.abs(r) ? l : r;
    i16[2 * i] = Math.max(-32768, Math.min(32767, Math.round(l * 32767)));
    i16[2 * i + 1] = Math.max(-32768, Math.min(32767, Math.round(r * 32767)));
  }
  return { name, sr: out.sr, data: b64(i16), stats: { ...stats(mono, out.sr), ...(out.reduction ? { reduction: out.reduction } : {}) } };
}
// CPU: the nodes one shot and one full-auto burst build (counted on a counting context around a real one).
export async function nodeCount() {
  const c = new OfflineAudioContext(2, 48000, 48000);
  const counts = {};
  const wrap = (key, fn) => { let n = 0; const P = Object.getPrototypeOf(c); const names = ["createGain", "createBiquadFilter", "createBufferSource", "createStereoPanner", "createOscillator", "createConvolver", "createDynamicsCompressor", "createWaveShaper"]; const keep = {}; for (const m of names) { keep[m] = c[m]; c[m] = (...a) => { n++; return P[m].apply(c, a); }; } fn(); for (const m of names) delete c[m]; counts[key] = n; };
  const { installBus } = await import("../../src/ui/gunsfx.js");
  installBus(c, c.destination);
  // warm the buffers and the reverb first (cached afterwards)
  playGun(c, 0.1, labPlan("pistol"), near()); playGun(c, 0.1, labPlan("ar", "auto"), near()); playBlast(c, 0.1, { kind: "frag" }, near());
  wrap("pistol single", () => playGun(c, 0.2, labPlan("pistol"), near()));
  wrap("rifle single (far)", () => playGun(c, 0.2, labPlan("ar"), near({ dist: 20 })));
  wrap("assault rifle full auto (10 rounds)", () => playGun(c, 0.2, labPlan("ar", "auto"), near()));
  wrap("LMG full auto (15 rounds)", () => playGun(c, 0.2, labPlan("lmg", "auto"), near()));
  wrap("frag blast", () => playBlast(c, 0.2, { kind: "frag" }, near()));
  wrap("old pistol", () => VOICES.pistol.play(c, c.destination, 0.2, { gain: 1, pitch: 1 }));
  wrap("old auto (3 shots)", () => VOICES.auto.play(c, c.destination, 0.2, { gain: 1, pitch: 1 }));
  wrap("old blast", () => VOICES.blast.play(c, c.destination, 0.2, { gain: 1, pitch: 1 }));
  // bake time (first use of a voice): ms
  const { bakedVoice } = await import("../../src/ui/gunsfx.js");
  const t0 = performance.now(); bakedVoice(44100, labPlan("amr")); const bake = Math.round(performance.now() - t0);
  return { counts, bakeMs50: bake };
}
window.SFX = { render, names: Object.keys(RENDERS), nodeCount, ready: true };
