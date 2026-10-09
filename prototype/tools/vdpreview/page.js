// The vehicle and door previews (tools/vdpreview/main.cjs loads this page in a hidden Electron window): every engine's
// start, idle, drive and stop, the failing and dead starts, a hotwire, breakdowns, car doors and tailgates, a team
// setting off and coming home on the map, a convoy's hum, every kind of building door opened and shut, locked,
// picked, forced and broken, the base's gates; and a 9 mm shot and footsteps beside them for the levels. Everything
// at the game's own level (the default sliders, no makeup), battle sounds through gun-sfx's spatialOut 2 tiles off.
import { VOICES } from "../../src/ui/audio.js";
import { labRender } from "../../src/ui/sfxlab.js";
import { place, playGun, labPlan, spatialOut, busOf } from "../../src/ui/gunsfx.js";
import { stats } from "../../src/ui/sfxdsp.js";
import { engineLoops, MAP_GAIN, ENGINE_KEYS, isBikeKey } from "../../src/ui/sfx-vehicles.js";
import { DOOR_KINDS } from "../../src/ui/sfx-doors.js";
import { STEP_GAIN } from "../../src/ui/sfx-steps.js";

const near = (o = {}) => place({ dist: 2, pan: 0, room: "town", ...o });
// A battle voice at a placement, into spatialOut (as ui/audio.js sfx plays it in battle through ui/sfx-out.js voiceOut).
const bv = (name, o = {}, sp = near()) => (c, t) => VOICES[name].play(c, spatialOut(c, sp), t + (o.delay || 0), { gain: 1, pitch: 1, ...o });
// A map voice: into the effects bus with a light pan, at the map's gain (ui/sfx-vehicles.js MAP_GAIN).
const mv = (name, o = {}) => (c, t, sfx) => { const p = c.createStereoPanner(); p.pan.value = o.pan || 0; p.connect(sfx); VOICES[name].play(c, p, t + (o.delay || 0), { gain: MAP_GAIN, pitch: 1, ...o }); };
const seq = (...fns) => (c, t, sfx) => { for (const f of fns) f(c, t, sfx); };
// An engine loop (ui/sfx-vehicles.js engineLoops) for secs; then let go. later: [[at, want]] updates (a drive's revs).
const loop = (want, secs, later = []) => (c, t, sfx) => {
  const dests = { battle: busOf(c).in, map: sfx };
  engineLoops(c, dests, [want], t, null);
  for (const [at, w] of later) engineLoops(c, dests, [w], t + at, null);
  engineLoops(c, dests, [], t + secs);
};

export const RENDERS = {};
const R = RENDERS;
// the references
R.ref_pistol9 = { secs: 2, fn: (c, t) => playGun(c, t, labPlan("pistol"), near()) };
R.ref_step_walk = { secs: 1, fn: bv("step", { surf: "hard", gait: "walk", gain: STEP_GAIN }) };
R.ref_step_run_laden = { secs: 1, fn: bv("step", { surf: "gravel", gait: "run", load: 3, gain: STEP_GAIN * 1.25 }) };
// each engine
for (const k of ENGINE_KEYS) {
  R[`${k}_start`] = { secs: 3.6, fn: bv("engineStart", { key: k }) };
  if (!isBikeKey(k)) R[`${k}_idle5s`] = { secs: 5.6, fn: loop({ id: "veh", battle: true, keys: [k], level: 1 }, 5) };
  R[`${k}_drive`] = { secs: 3.4, fn: bv("drive", { key: k, cells: 6, surf: "asphalt" }) };
  R[`${k}_stop`] = { secs: 4.2, fn: bv("engineStop", { key: k }) };
}
// starts that go wrong, a hotwire, breakdowns
R.start_poor_condition_sedan = { secs: 5.2, fn: bv("engineStart", { key: "sedan", cond: 20 }) };
R.start_low_fuel_pickup = { secs: 4.6, fn: bv("engineStart", { key: "pickup", fuel: 1 }) };
R.start_hotwired_sedan = { secs: 4, fn: bv("engineStart", { key: "sedan", hot: true }) };
R.nostart_wreck = { secs: 1.6, fn: bv("engineNoStart", { key: "sedan", why: "wreck" }) };
R.nostart_dead = { secs: 2.4, fn: bv("engineNoStart", { key: "pickup", why: "dead" }) };
R.hotwire_sparks = { secs: 1, fn: bv("hotwire", { ok: true }) };
R.breakdown_pickup = { secs: 3.6, fn: mv("breakdown", { key: "pickup" }) };
R.breakdown_out_of_fuel_sedan = { secs: 3.6, fn: mv("breakdown", { key: "sedan", fuel: true }) };
R.breakdown_bicycle = { secs: 2.4, fn: mv("breakdown", { key: "bicycle" }) };
// drives on other ground, a cold drive, the idle loop revving (someone aboard drives)
R.drive_gravel_pickup = { secs: 3.4, fn: bv("drive", { key: "pickup", cells: 7, surf: "gravel" }) };
R.drive_mud_humvee = { secs: 3.4, fn: bv("drive", { key: "humvee", cells: 7, surf: "mud" }) };
R.drive_cold_sedan = { secs: 4.4, fn: bv("drive", { key: "sedan", cells: 6, surf: "asphalt", cold: true }) };
R.drive_loop_rev_pickup = { secs: 6, fn: seq(loop({ id: "veh", battle: true, keys: ["pickup"], level: 1 }, 5.5, [[1, { id: "veh", battle: true, keys: ["pickup"], level: 1, rev: { seq: 1, cells: 7 } }]]), bv("drive", { key: "pickup", cells: 7, surf: "asphalt", loop: true, delay: 1 })) };
// car doors, tailgates
R.cardoor_car = { secs: 1.6, fn: bv("carDoor", { heavy: "car" }) };
R.cardoor_car_x4 = { secs: 2, fn: bv("carDoor", { heavy: "car", n: 4 }) };
R.cardoor_truck = { secs: 1.6, fn: bv("carDoor", { heavy: "truck" }) };
R.cardoor_military = { secs: 1.6, fn: bv("carDoor", { heavy: "mil" }) };
R.cardoor_van_sliding = { secs: 1.8, fn: bv("carDoor", { heavy: "van", n: 2 }) };
R.tailgate_truck = { secs: 1.8, fn: mv("tailgate", { heavy: "truck" }) };
R.tailgate_military = { secs: 1.8, fn: mv("tailgate", { heavy: "mil" }) };
// the map: a team setting off from a base (doors, start, pulling away, the gate, the hum) and coming home
R.map_team_sets_off = { secs: 9.5, fn: seq(mv("carDoor", { heavy: "car", n: 3 }), mv("engineStart", { key: "suv", go: true, delay: 0.9 }), mv("gateOpen", { dk: "gate", delay: 2.2 }), loop({ id: "map", battle: false, keys: ["suv"], n: 1, level: 0.8, pan: 0, rpmK: 1.9, bump: 0.06, road: true, delay: 4.2 }, 9)) };
R.map_team_arrives = { secs: 6.5, fn: seq(mv("gateOpen", { dk: "gate" }), mv("engineStop", { key: "suv", delay: 1.4 }), mv("carDoor", { heavy: "car", n: 3, delay: 2.6 })) };
R.map_convoy3_hum_road = { secs: 6.5, fn: loop({ id: "map", battle: false, keys: ["miltruck", "pickup"], n: 3, level: 1.4, pan: 0, rpmK: 1.9, bump: 0.06, road: true }, 6) };
R.map_convoy3_hum_offroad = { secs: 6.5, fn: loop({ id: "map", battle: false, keys: ["miltruck", "pickup"], n: 3, level: 1.4, pan: 0, rpmK: 2.3, bump: 0.3, road: false }, 6) };
R.map_hum_zoomed_out_half = { secs: 4.5, fn: loop({ id: "map", battle: false, keys: ["sedan"], n: 1, level: 0.4, pan: 0.3, rpmK: 1.9, bump: 0.06, road: true }, 4) };
// building doors and gates (inner doors in the tight room, outer ones with the town's slapback)
const roomOf = (dk) => (dk === "wood" || dk === "cell" ? "inside" : "town");
for (const dk of DOOR_KINDS) {
  R[`door_open_${dk}`] = { secs: dk === "gate" || dk === "roller" ? 3 : 2, fn: bv("door", { dk }, near({ room: roomOf(dk) })) };
  R[`door_close_${dk}`] = { secs: dk === "gate" || dk === "roller" ? 3 : 2, fn: bv("doorClose", { dk }, near({ room: roomOf(dk) })) };
}
R.door_locked_rattle = { secs: 1, fn: bv("doorRattle", { dk: "front" }, near({ room: "town" })) };
R.door_lockpick_success = { secs: 1.6, fn: bv("lockPick", { ok: true }, near({ room: "inside" })) };
R.door_lockpick_fail = { secs: 1.4, fn: bv("lockPick", { ok: false }, near({ room: "inside" })) };
R.door_kick_breach = { secs: 2, fn: seq(bv("doorForce", { how: "kick", ok: true, dk: "front" }, near({ room: "town" })), bv("door", { dk: "front", delay: 0.75 }, near({ room: "town" }))) };
R.door_kick_holds = { secs: 1.6, fn: bv("doorForce", { how: "kick", ok: false, dk: "front" }, near({ room: "town" })) };
R.door_crowbar_wood = { secs: 1.8, fn: bv("doorForce", { how: "pry", ok: true, dk: "wood" }, near({ room: "inside" })) };
R.door_crowbar_steel = { secs: 1.8, fn: bv("doorForce", { how: "pry", ok: true, dk: "metal" }, near({ room: "town" })) };
R.car_window_smashed = { secs: 1.4, fn: bv("doorForce", { how: "glass", ok: true, dk: "metal" }) };
R.door_broken_wood = { secs: 2, fn: bv("doorBreak", { dk: "wood" }, near({ room: "inside" })) };
R.door_broken_steel = { secs: 2.2, fn: bv("doorBreak", { dk: "metal" }, near({ room: "town" })) };
R.door_threshold_wood = { secs: 0.8, fn: bv("threshold", { dk: "wood" }, near({ room: "inside" })) };
R.door_peek = { secs: 1, fn: bv("doorPeek", { dk: "wood" }, near({ room: "inside" })) };
R.door_brace = { secs: 0.8, fn: bv("doorBrace", { dk: "wood" }, near({ room: "inside" })) };
R.gate_battered = { secs: 1.2, fn: bv("gateBatter", {}) };
R.gun_safe_opens = { secs: 2.4, fn: seq(bv("unlock", {}, near({ room: "inside" })), bv("door", { dk: "vault", delay: 0.4 }, near({ room: "inside" }))) };
R.base_gate_palisade = { secs: 5, fn: mv("gateOpen", { dk: "gate" }) };
R.base_gate_reinforced = { secs: 5, fn: mv("gateOpen", { dk: "steel" }) };
R.base_no_wall_front_door = { secs: 3, fn: mv("gateOpen", { dk: "front" }) };
R.city_crawl_building_door = { secs: 1.6, fn: seq(mv("door", { dk: "front" }), mv("doorClose", { dk: "front", delay: 0.9 })) };

const b64 = (i16) => { const u8 = new Uint8Array(i16.buffer); let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
export async function render(name) {
  const X = RENDERS[name];
  const out = await labRender(X.fn, X.secs, { limiter: true, makeup: 1 });
  const n = out.L.length, i16 = new Int16Array(n * 2), mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const l = out.L[i], r = out.R[i];
    mono[i] = Math.abs(l) > Math.abs(r) ? l : r;
    i16[2 * i] = Math.max(-32768, Math.min(32767, Math.round(l * 32767)));
    i16[2 * i + 1] = Math.max(-32768, Math.min(32767, Math.round(r * 32767)));
  }
  return { name, sr: out.sr, data: b64(i16), stats: stats(mono, out.sr) };
}
// CPU: the nodes each sound builds (counted on a counting context around a real one), and an engine's bake time.
export async function nodeCount() {
  const c = new OfflineAudioContext(2, 48000, 48000);
  const { installBus } = await import("../../src/ui/gunsfx.js");
  installBus(c, c.destination);
  const counts = {};
  const P = Object.getPrototypeOf(c), names = ["createGain", "createBiquadFilter", "createBufferSource", "createStereoPanner", "createOscillator", "createConvolver", "createDynamicsCompressor", "createWaveShaper", "createBuffer"];
  const wrap = (key, fn) => { let n = 0; for (const m of names) c[m] = (...a) => { n++; return P[m].apply(c, a); }; try { fn(); } finally { for (const m of names) delete c[m]; } counts[key] = n; };
  const sp = () => spatialOut(c, near());
  for (const k of ["sedan", "pickup", "miltruck"]) VOICES.engineStart.play(c, c.destination, 0.1, { key: k, gain: 1, pitch: 1 }); // bake first
  wrap("engineStart (pickup)", () => VOICES.engineStart.play(c, sp(), 0.2, { key: "pickup", gain: 1, pitch: 1 }));
  wrap("engineStop (pickup)", () => VOICES.engineStop.play(c, sp(), 0.2, { key: "pickup", gain: 1, pitch: 1 }));
  wrap("drive (pickup, 6 cells)", () => VOICES.drive.play(c, sp(), 0.2, { key: "pickup", cells: 6, surf: "gravel", gain: 1, pitch: 1 }));
  wrap("carDoor (1)", () => VOICES.carDoor.play(c, sp(), 0.2, { heavy: "car", gain: 1, pitch: 1 }));
  wrap("carDoor (4)", () => VOICES.carDoor.play(c, sp(), 0.2, { heavy: "car", n: 4, gain: 1, pitch: 1 }));
  wrap("door (wood)", () => VOICES.door.play(c, sp(), 0.2, { dk: "wood", gain: 1, pitch: 1 }));
  wrap("door (roller)", () => VOICES.door.play(c, sp(), 0.2, { dk: "roller", gain: 1, pitch: 1 }));
  wrap("door (gate)", () => VOICES.door.play(c, sp(), 0.2, { dk: "gate", gain: 1, pitch: 1 }));
  wrap("gateOpen (map)", () => VOICES.gateOpen.play(c, c.destination, 0.2, { dk: "gate", gain: 1, pitch: 1 }));
  wrap("idle loop (battle)", () => engineLoops(c, { battle: busOf(c).in, map: c.destination }, [{ id: "veh", battle: true, keys: ["pickup"], level: 1 }], 0.2, null));
  wrap("convoy hum (map, 2 engines)", () => engineLoops(c, { battle: busOf(c).in, map: c.destination }, [{ id: "map", battle: false, keys: ["miltruck", "pickup"], n: 3, level: 1, rpmK: 1.9, bump: 0.06, road: true }], 0.2, null));
  wrap("a loop's frame update (nothing changed)", () => engineLoops(c, { battle: busOf(c).in, map: c.destination }, [{ id: "map", battle: false, keys: ["miltruck", "pickup"], n: 3, level: 1, rpmK: 1.9, bump: 0.06, road: true }], 0.3, null));
  const { bakeEngine, ENGINES } = await import("../../src/ui/sfx-vehicles.js");
  const t0 = performance.now(); for (const k of ENGINE_KEYS) if (!isBikeKey(k)) bakeEngine(48000, ENGINES[k], 1);
  return { counts, bakeAllMs48k: Math.round(performance.now() - t0) };
}
window.SFX = { render, names: Object.keys(RENDERS), nodeCount, ready: true };
