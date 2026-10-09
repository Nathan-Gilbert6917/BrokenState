// Vehicles: an engine of its own for each kind of vehicle (a sedan's four, an SUV's or a van's six, a pickup's V8
// burble, the Humvee's heavy diesel V8, the Army truck's clattering straight six, a motorbike if one ever turns up;
// bicycles have none: a chain, a freewheel, a bell, brakes), started (the key or the start switch or the hotwire, the
// starter cranking, longer and failing on a worn one, sputtering when the tank is nearly dry, the catch and the rev
// settling to idle), switched off (the clunk, the engine dying, the hot metal ticking), dead (a wreck: a click and
// nothing), breaking down on the road (a cough and a bang, or sputtering out of fuel); driven across a battle map
// (the revs, a gear change on a longer drive, the tyres on the ground), idling while someone sits in it; the car doors
// as people get in and out, the tailgate when cargo goes in; on the State Map the team's doors and engine when it sets
// off or stops, the base's gate as it leaves or comes home, and a quiet convoy hum for the team you are watching.
// Pure functions until a voice plays: node tools import it. UI only: nothing here touches the sim's dice.
//
//   VEHICLE_SOUNDS / VEHICLE_LOOPS   the voices and the loops of this file (the mixer's "vehicles" group)
//   ENGINES, engineOf(v)             the engine voices, and which one a vehicle record has
//   bakeEngine(sr, E, seed)          an engine's firing pulses at idle, one seamless loop (sample array; ui/sfxdsp.js)
//   vehicleCues(state, mem, fresh)   the battle's: doors and engines as people board and leave, the drive, found cars
//   carLoot(b, f)                    a found car's fx (sim/foundcars.js: wired, open, locked): its sounds (null: not a car)
//   mapCues(state, ui, mem, cam)     the map's: teams setting off and stopping, gates, breakdowns, repairs, crawl doors,
//                                    the tailgate as the team inventory loads or drops off cargo
//   loopWants(state, ui, cam)        the engine loops wanted now: your vehicle idling in battle, the convoy hum on the map
//   engineLoops(c, dests, wants, t, L)  makes, moves and lets go of those loops (at most 2 in battle, 1 on the map)
//   vehicleVoices(K)                 the voices, on audio.js's building blocks K
import * as VEH from "../sim/vehicles.js";
import { onTheMove, partyMembers } from "../sim/parties.js";
import { wallTier } from "../sim/defences.js";
import { weatherAt } from "../sim/weather.js";
import { rngOf, hashStr, Filt } from "./sfxdsp.js";
import { spatial, place } from "./gunsfx.js";
import { panOfX } from "./sfx-out.js";
import { surfaceAt, groundOf } from "./sfx-steps.js";
import { camera, HEX } from "./render.js";
import { selectedTeam } from "./teamsel.js";

export const VEHICLE_SOUNDS = ["engineStart", "engineNoStart", "engineStop", "breakdown", "drive", "carDoor", "tailgate", "hotwire"];
export const VEHICLE_LOOPS = ["engineIdle", "convoyHum"];

// ---------- the engines ----------
// cyl: cylinders (four-stroke: the firing rate is rpm / 60 × cyl / 2); idle, rev: rpm; body: the exhaust's resonance
// (Hz, Q); lp: the low-pass at idle and at the rev limit; pop: the firing pulse's ring (Hz, s); grit: combustion noise
// in each pulse; clatter: a diesel's knock; pattern: each cylinder's pulse strength in firing order (a cross-plane
// V8's uneven banks: the burble); uneven: a V-twin's odd spacing; intake: the intake's hiss (level, Hz); whine: a
// mechanical whine at × the crank's rate (a turbo's on the Army truck); crank: the starter (compressions a second,
// motor Hz) and how long it turns over; flare: the first rev past idle as it catches; door: what its doors sound
// like; size: the biggest in a convoy leads the hum.
const V8 = [1, 0.78, 1.08, 0.86, 0.96, 0.74, 1.12, 0.82], I6 = [1, 0.94, 1.02, 0.97, 1, 0.92];
export const ENGINES = {
  compact:   { name: "Compact car (three)", cyl: 3, idle: 850, rev: 4600, body: [210, 1.4], lp: [900, 3200], pop: [140, 0.0035], grit: 0.25, clatter: 0, pattern: [1, 0.88, 1.06], rough: 0.05, intake: [0.05, 1500], whine: [6.2, 0.012], crank: [5.8, 190, 0.5], flare: 2.4, gain: 0.9, door: "car", size: 1 },
  sedan:     { name: "Sedan (four)", cyl: 4, idle: 780, rev: 4200, body: [165, 1.3], lp: [800, 3000], pop: [120, 0.004], grit: 0.2, clatter: 0, pattern: [1, 0.93, 1.04, 0.95], rough: 0.04, intake: [0.05, 1300], whine: [5.3, 0.01], crank: [5.2, 175, 0.55], flare: 2.3, gain: 0.9, door: "car", size: 2 },
  suv:       { name: "SUV (six)", cyl: 6, idle: 700, rev: 3800, body: [130, 1.2], lp: [700, 2600], pop: [105, 0.0045], grit: 0.18, clatter: 0, pattern: I6, rough: 0.035, intake: [0.045, 1100], whine: [4.6, 0.01], crank: [4.8, 165, 0.6], flare: 2.1, gain: 0.95, door: "car", size: 3 },
  van:       { name: "Work van (six)", cyl: 6, idle: 720, rev: 3600, body: [140, 1.6], lp: [650, 2400], pop: [110, 0.0045], grit: 0.2, clatter: 0, pattern: I6, rough: 0.04, intake: [0.05, 1000], whine: [4.2, 0.014], crank: [4.8, 160, 0.6], flare: 2, gain: 0.95, door: "van", size: 3.5 },
  pickup:    { name: "Pickup truck (V8)", cyl: 8, idle: 640, rev: 3400, body: [100, 1.1], lp: [600, 2200], pop: [90, 0.005], grit: 0.22, clatter: 0, pattern: V8, rough: 0.05, intake: [0.05, 900], whine: [3.6, 0.008], crank: [4.4, 150, 0.65], flare: 2.2, gain: 1, door: "truck", size: 4 },
  humvee:    { name: "Humvee (diesel V8)", cyl: 8, diesel: true, idle: 680, rev: 3000, body: [72, 1], lp: [520, 1900], pop: [75, 0.006], grit: 0.3, clatter: 0.35, pattern: [1, 0.85, 1.05, 0.9, 0.97, 0.82, 1.08, 0.88], rough: 0.06, intake: [0.06, 800], whine: [3.2, 0.012], crank: [3.8, 135, 1], flare: 1.6, gain: 1.05, door: "mil", size: 5 },
  miltruck:  { name: "Army truck (diesel six)", cyl: 6, diesel: true, idle: 600, rev: 2500, body: [62, 1], lp: [480, 1700], pop: [65, 0.007], grit: 0.3, clatter: 0.55, pattern: I6, rough: 0.05, intake: [0.07, 700], whine: [7.5, 0.018], crank: [3.4, 120, 1.2], flare: 1.5, gain: 1.1, door: "mil", size: 6 },
  motorbike: { name: "Motorbike (twin)", cyl: 2, idle: 1150, rev: 7500, body: [280, 1.5], lp: [1100, 4200], pop: [170, 0.003], grit: 0.3, clatter: 0, pattern: [1, 0.85], uneven: 0.25, rough: 0.08, intake: [0.05, 2000], whine: [9, 0.01], crank: [7, 230, 0.4], flare: 3, gain: 0.85, door: null, size: 0.5 },
  bicycle:   { name: "Bicycle", bike: true, door: null, size: 0 },
};
export const ENGINE_KEYS = Object.keys(ENGINES);
// A vehicle record (sim/vehicles.js) to its engine: by its type (an MRAP is an Army truck), else by what it looks like.
const BY_TYPE = { truck: "pickup", sedan: "sedan", suv: "suv", hummer: "humvee", van: "van", miltruck: "miltruck", bike: "bicycle" };
export function engineOf(v) {
  if (!v) return "sedan";
  if (VEH.isBike(v)) return "bicycle";
  const t = String(v.type || "");
  if (BY_TYPE[t]) return BY_TYPE[t];
  if (/moto|dirt|scooter/.test(t)) return "motorbike";
  const T = VEH.VEHICLE_TYPES[t];
  if (T && !T.motor) return "bicycle";
  return T && T.tank <= 14 ? "compact" : "sedan";
}
// A battle's vehicle body (sim/combat.js vehicleBody) or a found car's model (sim/foundcars.js MODELS) to an engine.
const BY_BODY = { bike: "bicycle", miltruck: "miltruck", truck: "pickup", car: "sedan", humvee: "humvee", mrap: "miltruck" };
const BY_MODEL = { sedan: "sedan", van: "van", pickup: "pickup", cargo: "miltruck", humvee: "humvee", mrap: "miltruck" };
export const isBikeKey = (k) => !!(ENGINES[k] && ENGINES[k].bike);
export const doorOf = (k) => (ENGINES[k] ? ENGINES[k].door : "car");
const firing = (E, rpm) => (rpm / 60) * (E.cyl / 2);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clamp01 = (v) => clamp(v, 0, 1);

// The vehicles of a team: sim/vehicles.js partyVehicles where team-form's fleets are in, else p.vehicleIds, else the
// one vehicle (partyVehicle).
export function teamVehicles(state, p) {
  if (!state || !p) return [];
  try {
    if (typeof VEH.partyVehicles === "function") return VEH.partyVehicles(state, p) || [];
    if (Array.isArray(p.vehicleIds) && p.vehicleIds.length) return p.vehicleIds.map((id) => VEH.vehicleById(state, id)).filter(Boolean);
    const v = VEH.partyVehicle(state, p);
    return v ? [v] : [];
  } catch { return []; }
}
const motorsOf = (list) => list.filter((v) => v && !VEH.isBike(v) && !v.destroyed).sort((a, b) => ENGINES[engineOf(b)].size - ENGINES[engineOf(a)].size);

// ---------- baking an engine (plain JS, ui/sfxdsp.js) ----------
// One seamless loop of the engine at idle: whole engine cycles of firing pulses (a thump and the pulse's ring, some
// combustion noise; a diesel's knock just before each), every cylinder at its own strength, written round the end of
// the buffer so it loops without a seam. Played back faster for more rpm; the exhaust's body and the low-pass are
// live filters after it, so the resonance stays where it is as the revs climb.
export function bakeEngine(sr, E, seed = 1) {
  const r = rngOf(seed);
  const fF = firing(E, E.idle);
  const cycles = Math.max(2, Math.round((1.4 * fF) / E.cyl));
  const n = cycles * E.cyl, len = Math.max(64, Math.round((n / fF) * sr));
  const out = new Float32Array(len);
  const tau = E.pop[1], span = Math.min(len, Math.round(tau * 7 * sr)), w = 2 * Math.PI * E.pop[0] / sr;
  const grit = new Filt("lowpass", Math.min(sr * 0.4, 2400), 0.7, sr), knock = new Filt("bandpass", Math.min(sr * 0.4, 3200), 1.2, sr);
  const kspan = Math.round(0.004 * sr), kpre = Math.round(0.0015 * sr);
  const pat = E.pattern || [1];
  for (let k = 0; k < n; k++) {
    let pos = (k * len) / n;
    if (E.uneven && k % 2) pos += (E.uneven * len) / n;
    pos = Math.round(pos);
    const a = pat[k % pat.length] * (1 + (E.rough || 0) * (r() * 2 - 1)), ph = r() * 0.6;
    for (let j = 0; j < span; j++) {
      const tt = j / sr, e = Math.exp(-tt / tau);
      const v = 0.65 * (tt / tau) * Math.exp(1 - tt / tau) + 0.45 * Math.sin(w * j + ph) * e + (E.grit || 0) * grit.run(r() * 2 - 1) * e * 2;
      out[(pos + j) % len] += a * v;
    }
    if (E.clatter) for (let j = 0; j < kspan; j++) out[(pos - kpre + j + len) % len] += a * E.clatter * 3 * knock.run(r() * 2 - 1) * Math.exp(-j / (0.0009 * sr));
  }
  let mean = 0;
  for (let i = 0; i < len; i++) mean += out[i];
  mean /= len;
  let pk = 0;
  for (let i = 0; i < len; i++) { out[i] -= mean; pk = Math.max(pk, Math.abs(out[i])); }
  if (pk > 0) for (let i = 0; i < len; i++) out[i] /= pk;
  return out;
}
const BAKED = new WeakMap(); // context -> Map(engine key -> AudioBuffer)
export function engineBuffer(c, key) {
  let m = BAKED.get(c);
  if (!m) BAKED.set(c, (m = new Map()));
  if (m.has(key)) return m.get(key);
  const E = ENGINES[key] && !ENGINES[key].bike ? ENGINES[key] : ENGINES.sedan;
  const d = bakeEngine(c.sampleRate, E, hashStr(key));
  const buf = c.createBuffer(1, d.length, c.sampleRate);
  buf.getChannelData(0).set(d);
  m.set(key, buf);
  return buf;
}

// ---------- the live engine (a handful of nodes) ----------
// The baked loop → a low-pass (opening with the revs) → the exhaust's body → the level; the intake's hiss and a
// mechanical whine into the level beside it. h.rpm / h.level schedule the revs and the level ("set", "lin" ramp,
// "tgt" target), h.stop lets it go. keys: one engine, or a convoy's (each its own loop, detuned a little, summed
// before the filters: one sound, not four).
export const VEH_LEVEL = 1;  // × every vehicle voice (tools/vdpreview measures it against a 9 mm shot and a footstep)
export const ENGINE_TRIM = 0.36; // the engine's body under the doors and the starter
function at(p, t, v, mode = "lin", tc = 0.15) {
  if (!p) return;
  if (mode === "set") p.setValueAtTime(v, t);
  else if (mode === "tgt") p.setTargetAtTime(v, t, tc);
  else p.linearRampToValueAtTime(v, t);
}
function liveEngine(c, out, t, keys, o, K) {
  const list = (Array.isArray(keys) ? keys : [keys]).filter((k) => ENGINES[k] && !ENGINES[k].bike);
  if (!list.length) list.push("sedan");
  const E = ENGINES[list[0]];
  const dur = o.dur ?? 3600;
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.connect(out);
  const body = c.createBiquadFilter(); body.type = "peaking"; body.frequency.value = E.body[0]; body.Q.value = E.body[1]; if (body.gain) body.gain.value = 9; body.connect(g);
  const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = E.lp[0]; lp.Q.value = 0.8; lp.connect(body);
  const srcs = list.slice(0, 2).map((k, i) => {
    const s = c.createBufferSource();
    s.buffer = engineBuffer(c, k);
    s.loop = true;
    const det = i === 0 ? 1 : 1 + (o.detune ?? 0.035) * (ENGINES[k].idle / E.idle);
    s.det = det * (ENGINES[k].idle / E.idle);
    s.playbackRate.setValueAtTime(s.det, t);
    if (i) { const sg = c.createGain(); sg.gain.value = 0.75; s.connect(sg); sg.connect(lp); } else s.connect(lp);
    s.start(t, (o.phase ?? Math.random()) * Math.max(0.01, s.buffer.duration * 0.9));
    s.stop(t + dur + 0.1);
    return s;
  });
  const ig = c.createGain(); ig.gain.setValueAtTime(0.0001, t); ig.connect(g);
  const ns = K.noise(c, "white", t, dur, K.filt(c, "bandpass", E.intake[1], 0.9, ig));
  const wg = c.createGain(); wg.gain.setValueAtTime(0.0001, t); wg.connect(g);
  const osc = K.tone(c, "sine", firing(E, E.idle) * E.whine[0], 0, t, dur, wg);
  const lpAt = (rpm) => E.lp[0] + (E.lp[1] - E.lp[0]) * clamp01((rpm - E.idle) / (E.rev - E.idle));
  const h = {
    E, g, srcs, lp, gain: o.gain ?? 1,
    rpm(tt, rpm, mode = "lin", tc = 0.15) {
      const k = Math.max(0.05, rpm / E.idle), x = clamp01((rpm - E.idle) / (E.rev - E.idle));
      for (const s of srcs) at(s.playbackRate, tt, k * s.det, mode, tc);
      at(lp.frequency, tt, lpAt(rpm), mode, tc);
      at(osc.frequency, tt, Math.max(1, firing(E, rpm) * E.whine[0]), mode, tc);
      at(ig.gain, tt, Math.max(0.0001, E.intake[0] * (0.4 + 1.6 * x) * h.gain), mode, tc);
      at(wg.gain, tt, Math.max(0.0001, E.whine[1] * (0.5 + 1.5 * x) * h.gain), mode, tc);
    },
    level(tt, v, mode = "lin", tc = 0.15) { at(g.gain, tt, Math.max(0.0001, v * E.gain * ENGINE_TRIM), mode, tc); },
    stop(tt) { for (const s of srcs) s.stop(tt); ns.stop(tt); osc.stop(tt); },
  };
  h.rpm(t, o.rpm ?? E.idle, "set");
  return h;
}

// ---------- the timings shared by the cues and the voices ----------
// When a start catches and when its sound is over (s after its start): the key or the switch or the hotwire, a worn
// one's failed first try, the cranking.
export function startTiming(key, o = {}) {
  const E = ENGINES[key] || ENGINES.sedan;
  if (E.bike) return { crank: 0, catchAt: 0.3, end: 1.6 };
  const pre = o.hot ? 0.5 : E.diesel ? 0.75 : 0.2;
  const poor = (o.cond ?? 70) < 35;
  const crank = E.crank[2] * (poor ? 1.5 : 1) * ((o.fuel ?? 10) < 2 ? 1.4 : 1);
  const catchAt = pre + (poor ? 1.45 : 0) + crank;
  return { pre, poor, crank, catchAt, end: catchAt + (o.go ? 4.1 : (o.hold ?? 1.7) + 0.55) };
}

// ---------- the battle ----------
const DOOR_GAP = 0.28, MAX_VEH_CUES = 5;
// What the team's vehicle on this map is: its engine, condition, fuel (the party's record when there is one).
function battleVehicle(state, b, v) {
  if (!v) return null;
  let rec = null;
  try {
    const p = b.setup && b.setup.partyId != null ? (state.parties || []).find((x) => x.id === b.setup.partyId) : null;
    rec = v.vid != null ? VEH.vehicleById(state, v.vid) : p ? VEH.partyVehicle(state, p) : null;
  } catch { rec = null; }
  const key = rec ? engineOf(rec) : v.mil ? "miltruck" : BY_BODY[v.kind] || "sedan";
  return { key, cond: rec ? rec.condition : 70, fuel: rec ? rec.fuel : 10, hot: !!(rec && rec.found && rec.found.hot), mil: !!(v.mil || (rec && rec.found && /cargo|humvee|mrap/.test(rec.found.model || ""))) };
}
const vehAt = (v) => [v.x + Math.floor((v.w || 1) / 2), v.y + Math.floor((v.h || 1) / 2)];
const groundAt = (state, b) => { try { return groundOf(weatherAt(state, b.setup && b.setup.tile != null ? b.setup.tile : 0)); } catch { return null; } };
function tyreSurf(state, b, x, y) {
  const s = surfaceAt(b, x, y, groundAt(state, b));
  return s === "hard" || s === "wood" || s === "carpet" ? "asphalt" : s === "wet" ? "wet" : s === "grass" ? "dirt" : s;
}
// mem.live: what the loops read (loopWants): the start's delay, the drive's revs.
export const LIVE = { battle: null, map: null };
export function vehicleCues(state, mem, fresh = []) {
  const b = state && state.combat;
  const out = [];
  if (!b) return out;
  LIVE.battle = mem;
  const aboardNow = new Set(b.units.filter((u) => u.aboard && !u.dead).map((u) => u.id));
  const fleet = [b.vehicle, ...(b.convoy || [])].filter(Boolean);
  const posOf = () => new Map(fleet.map((v, i) => [v.vid ?? `i${i}`, `${v.x},${v.y}`]));
  const carsOf = () => new Map(Object.values(b.cars || {}).map((r) => [r.id, { open: isOpenCar(b, r), claimed: r.claimed }]));
  if (mem.battle !== b) {
    mem.battle = b; mem.aboard = aboardNow; mem.pos = posOf(); mem.cars = carsOf(); mem.blown = !!(b.vehicle && b.vehicle.blownUp);
    mem.rev = null; mem.loopDelay = 0; mem.revSeq = 0;
    return out;
  }
  const V = b.vehicle, info = battleVehicle(state, b, V);
  const pan = (x) => panOfX(b, x);
  const atV = V ? vehAt(V) : null;
  // Boarding and getting out (sim/combat.js boardVehicle / disembark / landAll / leaveAboard).
  if (V && info) {
    const units = new Map(b.units.map((u) => [u.id, u]));
    const inNow = [...aboardNow].filter((id) => !mem.aboard.has(id)), outNow = [...mem.aboard].filter((id) => !aboardNow.has(id));
    const bike = isBikeKey(info.key), heavy = doorOf(info.key), base = { at: atV, pan: pan(atV[0]), enemy: false, heavy };
    let doors = 0;
    if (inNow.length) {
      const first = mem.aboard.size === 0;
      if (bike) out.push({ name: "engineStart", ...base, key: "bicycle" });
      else {
        for (let i = 0; i < inNow.length && doors < 3; i++, doors++) out.push({ name: "carDoor", ...base, delay: i * DOOR_GAP });
        if (first && !V.blownUp) {
          const o = { key: info.key, cond: info.cond, fuel: info.fuel, hot: info.hot, mil: info.mil, hold: 1.9 };
          const d = 0.75;
          out.push({ name: "engineStart", ...base, ...o, delay: d });
          mem.loopDelay = d + startTiming(info.key, o).catchAt + 1.5; // the idle loop takes over as the start's own idle fades
        }
      }
    }
    if (outNow.length) {
      const drove = outNow.some((id) => { const u = units.get(id); return u && u.left && u.exitVehicle; });
      if (drove && aboardNow.size === 0 && !V.blownUp) out.push({ name: "drive", ...base, key: info.key, away: true, cells: 6, surf: tyreSurf(state, b, atV[0], atV[1]) });
      else if (!drove) {
        const last = aboardNow.size === 0 && !V.blownUp;
        if (bike) { if (last) out.push({ name: "engineStop", ...base, key: "bicycle" }); }
        else {
          if (last) out.push({ name: "engineStop", ...base, key: info.key });
          for (let i = 0; i < outNow.length && doors < 3; i++, doors++) out.push({ name: "carDoor", ...base, delay: (last ? 0.7 : 0) + i * DOOR_GAP });
        }
      }
    }
  }
  // Driven (sim/combat.js driveTo): with someone in it the idle loop revs (the voice brings the tyres); with nobody in
  // it, a cold drive (started, driven, switched off). A convoy's other vehicles too (team-form's b.convoy).
  const pos = posOf();
  fleet.forEach((v, i) => {
    const id = v.vid ?? `i${i}`, was = mem.pos.get(id), now = pos.get(id);
    if (!was || was === now || v.blownUp) return;
    const [ox, oy] = was.split(",").map(Number), cells = Math.abs(v.x - ox) + Math.abs(v.y - oy);
    const vi = v === V ? info : battleVehicle(state, b, v);
    const [cx, cy] = vehAt(v), surf = tyreSurf(state, b, cx, cy);
    const running = v === V && aboardNow.size > 0 && !isBikeKey(vi.key);
    if (running) { mem.revSeq = (mem.revSeq || 0) + 1; mem.rev = { seq: mem.revSeq, cells }; }
    out.push({ name: "drive", at: [cx, cy], pan: pan(cx), enemy: false, key: vi.key, cells, surf, big: vi.key === "miltruck" || vi.key === "humvee", ...(running ? { loop: true } : { cold: aboardNow.size === 0 || v !== V }) });
  });
  mem.pos = pos;
  // Found cars (sim/foundcars.js): a door opened without a lock's fx (the "enter" order), a running car claimed: it starts.
  const cars = carsOf();
  for (const [id, c] of cars) {
    const was = mem.cars.get(id), r = b.cars[id];
    if (!was || !r) continue;
    const ax = r.x + Math.floor(r.w / 2), ay = r.y + Math.floor(r.h / 2), key = BY_MODEL[r.model] || "sedan";
    if (c.open && !was.open && !fresh.some((f) => f.type === "loot" && f.to && f.to[0] === ax && f.to[1] === ay)) out.push({ name: "carDoor", at: [ax, ay], pan: pan(ax), enemy: false, heavy: doorOf(key), only: "open" });
    if (c.claimed && !was.claimed && r.cond && r.cond.engine === "ok" && r.cond.tyres === "ok" && r.cond.battery === "ok" && (r.keys || r.hot || r.mil)) out.push({ name: "engineStart", at: [ax, ay], pan: pan(ax), enemy: false, key, cond: r.condition, fuel: r.cond.fuel, hot: !!(r.hot && !r.keys), mil: !!r.mil, delay: 0.3 });
  }
  mem.cars = cars;
  mem.aboard = aboardNow;
  mem.blown = !!(V && V.blownUp);
  return out.slice(0, MAX_VEH_CUES);
}
const isOpenCar = (b, r) => !!r.open;
// A found car's lock fx (sim/foundcars.js carAct: "wired", "open", "locked" with f.how): the hotwire's sparks; the lock
// picked, the door pried or the glass smashed, and the door opening. Null when the fx is not at a car.
export function carLoot(b, f) {
  if (!b || !f || f.type !== "loot" || !f.to) return null;
  const [x, y] = f.to, c = b.cells && x >= 0 && y >= 0 && x < b.w && y < b.h ? b.cells[y * b.w + x] : null;
  if (!c || !c.car || (c.k !== "car" && c.k !== "truck")) return null;
  const t = String(f.text || ""), base = { at: [x, y], pan: panOfX(b, x), enemy: false };
  const rec = b.cars ? b.cars[c.car.id] : null;
  const heavy = doorOf(rec ? BY_MODEL[rec.model] || "sedan" : "sedan");
  if (t === "wired") return [{ name: "hotwire", ...base, ok: true }];
  if (t === "nothing") return [{ name: "hotwire", ...base, ok: false }];
  if (t !== "open" && t !== "locked") return null;
  const ok = t === "open", how = f.how || null;
  const out = [];
  if (how === "pick") out.push({ name: "lockPick", ...base, ok, dk: "front" });
  else if (how === "pry" || how === "glass" || how === "kick") out.push({ name: "doorForce", ...base, ok, how: how === "kick" ? "pry" : how, dk: "metal" });
  else if (!ok) out.push({ name: "doorRattle", ...base, dk: "metal" });
  if (ok) out.push({ name: "carDoor", ...base, heavy, only: "open", delay: 0.4 });
  return out;
}

// ---------- the State Map ----------
// mem: kept by the caller (sfx-gear.js uiCues). cam: { zoom, w, h, toScreen(tile) -> [x, y] } (mapCam, or a test's).
export const MAP_GAIN = 0.6; // the map's one-shots, unpositioned, under the battle's
const playerBase = (state, tile) => (state.bases || []).find((b) => b.tile === tile && (b.owner == null || b.owner === "player")) || null;
const gateKind = (base) => { let w = 0; try { w = wallTier(base); } catch { w = 0; } return w >= 2 ? "steel" : w >= 1 ? "gate" : "front"; };
export function mapCam(state) {
  try {
    const el = typeof document !== "undefined" && document.getElementById ? document.getElementById("map") : null;
    return { zoom: camera.zoom, w: el ? el.clientWidth : 0, h: el ? el.clientHeight : 0, toScreen: (tile) => { const [px, py] = state.grid.toPixel(tile, HEX); return [(px - camera.x) * camera.zoom, (py - camera.y) * camera.zoom]; } };
  } catch { return null; }
}
const tileOf = (p) => (p && Array.isArray(p.path) && p.path.length ? p.path[Math.min(p.idx || 0, p.path.length - 1)] : p ? p.tile : null);
function panOn(cam, tile) {
  if (!cam || !cam.w || tile == null) return 0;
  try { const [sx] = cam.toScreen(tile); return Number.isFinite(sx) ? clamp((sx / cam.w - 0.5) * 0.7, -0.6, 0.6) : 0; } catch { return 0; }
}
// A team that has stopped or is about to: on the road (onTheMove), not held back by a delay (sim/events.js delay: the
// progress below 0 while a breakdown is fixed), not waiting on its breakdown card.
const onRoad = (p) => !!p && (p.phase == null ? Array.isArray(p.path) && p.path.length > 1 && (p.idx || 0) < p.path.length - 1 : onTheMove(p));
const breakdownFor = (state, p) => (state.cards || []).some((c) => c && c.partyId === p.id && c.title === "Breakdown");
function teamSnap(state, p) {
  const vs = teamVehicles(state, p), motors = motorsOf(vs);
  const lead = motors[0] || null, bike = !lead && vs.some((v) => VEH.isBike(v));
  const keys = motors.map(engineOf);
  return {
    moving: onRoad(p) && (p.progress ?? 0) >= 0 && !breakdownFor(state, p),
    tile: tileOf(p), keys, bike, ids: vs.map((v) => v.id), lead, n: motors.length,
    riders: (() => { try { return partyMembers(state, p).length; } catch { return (p.members || []).length; } })(),
    task: p.phase === "task" && p.task ? { type: p.task.type, vid: p.task.vehicleId ?? null } : null,
    crawl: !!(p.crawl && p.crawl.inside), cargo: cargoSig(p),
  };
}
const cargoSig = (p) => { const c = p.cargo || {}; let n = (c.gear || []).length * 1000; for (const v of Object.values(c.supplies || {})) n += Number(v) || 0; for (const v of Object.values(p.supplies || {})) n += Number(v) || 0; return Math.round(n); };
// Doors as a team gets in or out: one a person up to four in the lead car, one more for each other car (at most 4).
const doorsFor = (s) => Math.max(1, Math.min(4, Math.min(4, s.riders || 1) + Math.max(0, s.n - 1)));
export function mapCues(state, ui, mem, cam = null) {
  const out = [];
  if (!state || !state.parties) return out;
  LIVE.map = mem;
  const live = !!(ui && ui.started && !ui.timelapse);
  const seen = mem.seen;
  mem.seen = true;
  const now = new Map();
  for (const p of state.parties) if (p.owner === "player") now.set(p.id, { p, s: teamSnap(state, p) });
  const prev = mem.teams || new Map();
  const say = (name, o) => out.push({ gain: MAP_GAIN, ...o, name });
  const camOf = () => cam || (cam = mapCam(state));
  // City crawls (sim/citycrawl.js p.crawl.inside): into a building and out again: its door. Heard in battle too
  // (going in starts the building's fight).
  if (seen && live) for (const [id, { s }] of now) {
    const was = prev.get(id);
    if (was && was.crawl !== s.crawl) say(s.crawl ? "door" : "doorClose", { dk: "front", pan: panOn(camOf(), s.tile) });
  }
  // Cards seen so far (a breakdown is heard when its card comes up, never for one already there).
  mem.cards = mem.cards || new WeakSet();
  const fresh = [];
  for (const c of state.cards || []) if (c && typeof c === "object" && !mem.cards.has(c)) { mem.cards.add(c); fresh.push(c); }
  if (seen && live && !state.combat) {
    // Breakdowns on the road (sim/events.js breakdownCard): the cough and the bang (a bike: a tyre and a chain).
    for (const c of fresh) {
      const t = c.title === "Breakdown" ? now.get(c.partyId) : null;
      if (!t) continue;
      const v = c.vehicleId != null ? VEH.vehicleById(state, c.vehicleId) : t.s.lead;
      const key = v ? engineOf(v) : t.s.keys[0] || "sedan";
      say("breakdown", { key, bike: isBikeKey(key), pan: panOn(camOf(), t.s.tile) });
      const m = prev.get(c.partyId);
      if (m) m.dead = true;
    }
    for (const [id, { p, s }] of now) {
      const was = prev.get(id);
      const pan = panOn(camOf(), s.tile);
      const car = s.keys.length > 0, key = s.keys[0];
      const lead = s.lead || {};
      if (!was) {
        // A team that has just left one of your bases (sent out, moved out): the gate, then the doors and the engine.
        const base = s.tile != null && s.moving ? playerBase(state, s.tile) : null;
        if (base) { // in the yard: doors, the engine, and the gate opening as they pull out (on foot: the gate)
          if (car) { say("carDoor", { heavy: doorOf(key), n: doorsFor(s), pan }); say("engineStart", { key, keys: s.keys, cond: lead.condition, fuel: lead.fuel, hot: !!(lead.found && lead.found.hot), go: true, pan, delay: 0.9 }); }
          else if (s.bike) say("engineStart", { key: "bicycle", pan });
          say("gateOpen", { dk: gateKind(base), pan, close: true, delay: car ? 2.2 : s.bike ? 0.8 : 0 });
        }
        continue;
      }
      s.dead = was.dead && !s.moving;
      // A vehicle gone from a moving team with an empty tank: it sputtered out (sim/parties.js onEnterTile "ran out of fuel").
      for (const vid of was.ids) if (!s.ids.includes(vid) && was.moving) {
        const v = VEH.vehicleById(state, vid);
        if (v && !VEH.isBike(v) && (v.fuel || 0) <= 0.5) { say("breakdown", { key: engineOf(v), fuel: true, pan }); s.dead = true; }
      }
      if (s.moving && !was.moving) {
        const base = s.tile != null ? playerBase(state, s.tile) : null;
        if (base) say("gateOpen", { dk: gateKind(base), pan, close: true, delay: car ? 2.2 : s.bike ? 0.8 : 0 }); // leaving one of your bases
        if (car) { say("carDoor", { heavy: doorOf(key), n: doorsFor(s), pan }); say("engineStart", { key, keys: s.keys, cond: lead.condition, fuel: lead.fuel, hot: !!(lead.found && lead.found.hot), go: true, pan, delay: 0.9 }); }
        else if (s.bike) say("engineStart", { key: "bicycle", pan });
      } else if (!s.moving && was.moving && !was.dead && !s.dead) {
        if (car) { say("engineStop", { key, pan }); say("carDoor", { heavy: doorOf(key), n: doorsFor(s), pan, delay: 1.2 }); }
        else if (s.bike) say("engineStop", { key: "bicycle", pan });
      }
      // The end of work on a vehicle (sim/orders.js): a found car that now runs catches (or not); a field repair's test start.
      if (was.task && (!s.task || s.task.type !== was.task.type)) {
        if (was.task.type === "fixcar" && was.task.vid != null) {
          const v = VEH.vehicleById(state, was.task.vid);
          if (v && v.found && !v.found.repair) say("engineStart", { key: engineOf(v), cond: v.condition, fuel: v.fuel, pan });
          else if (v) say("engineNoStart", { key: engineOf(v), why: "dead", pan });
        } else if (was.task.type === "repair" && car && !s.moving) say("engineStart", { key, cond: lead.condition, fuel: lead.fuel, pan, hold: 1.2 });
      }
      // Cargo loaded or dropped off from the team inventory at a base (ui/teaminv.js): the tailgate.
      if (car && ui.inv && Number(ui.inv.team) === id && (ui.inv.tab === "drop" || ui.inv.tab === "load") && was.cargo !== s.cargo) say("tailgate", { heavy: doorOf(key), pan, gain: MAP_GAIN * 0.9 });
    }
    // A team gone from the map on one of your bases: home (or moved in): the gate, the engine off, the doors.
    for (const [id, was] of prev) {
      if (now.has(id) || was.tile == null) continue;
      const base = playerBase(state, was.tile);
      if (!base) continue;
      const pan = panOn(camOf(), was.tile), key = was.keys[0];
      say("gateOpen", { dk: gateKind(base), pan, close: true });
      if (key && !was.dead) {
        if (was.moving) say("engineStop", { key, pan, delay: 1.4 });
        say("carDoor", { heavy: doorOf(key), n: doorsFor(was), pan, delay: was.moving ? 2.6 : 1.2 });
      } else if (was.bike && was.moving) say("engineStop", { key: "bicycle", pan, delay: 1.2 });
    }
  }
  const keepDead = new Map();
  for (const [id, { s }] of now) keepDead.set(id, s);
  mem.teams = keepDead;
  return out;
}

// ---------- the loops ----------
export const MAX_BATTLE_LOOPS = 2, MAX_MAP_LOOPS = 1;
export const LOOP_LEVEL = { battle: 0.55, map: 0.42 }; // × the engine at idle (under the one-shots)
export const HUM = { zoomOff: 0.55, zoomFull: 1.5, road: 1.9, offroad: 2.3 };
// The convoy hum's wish on the map: the team you selected, else the one nearest the middle of the view, moving with an
// engine (another group's driving team you can see when none of yours is). Louder zoomed in, gone zoomed far out.
export function mapHumWant(state, ui, cam) {
  if (!state || !state.parties || !cam || !(cam.zoom > 0)) return null;
  const zk = clamp01((cam.zoom - HUM.zoomOff) / (HUM.zoomFull - HUM.zoomOff));
  if (!(zk > 0)) return null;
  let sel = null;
  try { sel = selectedTeam(state, ui); } catch { sel = null; }
  let best = null;
  for (const p of state.parties) {
    const mine = p.owner === "player";
    if (!onRoad(p) || (p.progress ?? 0) < 0) continue;
    if (mine && breakdownFor(state, p)) continue;
    const tile = tileOf(p);
    if (tile == null) continue;
    let keys;
    if (mine) { keys = motorsOf(teamVehicles(state, p)).map(engineOf); if (!keys.length) continue; }
    else { if (p.vehicle !== true || !(state.live && state.live.has && state.live.has(tile))) continue; keys = [p.kind === "convoy" ? "van" : "pickup"]; }
    let sx = 0, sy = 0, inView = true;
    if (cam.w) { try { [sx, sy] = cam.toScreen(tile); } catch { sx = sy = NaN; } inView = Number.isFinite(sx) && sx > -60 && sy > -60 && sx < cam.w + 60 && sy < cam.h + 60; }
    const isSel = mine && sel === p;
    if (!inView && !isSel) continue;
    const centre = cam.w ? 1 - Math.min(1, Math.hypot(sx - cam.w / 2, sy - cam.h / 2) / Math.hypot(cam.w / 2, cam.h / 2)) : 0.5;
    const score = (isSel ? 3 : 0) + (mine ? 1 : 0) + centre;
    if (best && best.score >= score) continue;
    const next = p.path && p.path[(p.idx || 0) + 1];
    const tt = state.tiles && state.tiles[tile];
    const road = !!(tt && Array.isArray(tt.roadLinks) && next != null && tt.roadLinks.includes(next));
    best = {
      score, id: "map", battle: false, keys: keys.slice(0, 2), n: keys.length, road, party: p.id,
      level: zk * (isSel ? 1 : 0.8) * (inView ? 1 : 0.5) * (mine ? 1 : 0.6) * Math.min(1.5, 1 + 0.2 * (keys.length - 1)),
      pan: cam.w && Number.isFinite(sx) ? clamp((sx / cam.w - 0.5) * 0.8, -0.6, 0.6) : 0,
      rpmK: road ? HUM.road : HUM.offroad, bump: road ? 0.06 : 0.3,
    };
  }
  if (best) delete best.score;
  return best;
}
// The loops wanted now (pure: tests call it): your vehicle idling in battle while someone is in it (the start's delay
// and the drive's revs from vehicleCues), else on the map the convoy hum.
export function loopWants(state, ui, cam = null) {
  const out = [];
  if (!state || (ui && ui.timelapse)) return out;
  const b = state.combat;
  if (b) {
    const V = b.vehicle;
    if (V && !V.blownUp && !b.over && b.units.some((u) => u.aboard && !u.dead)) {
      const info = battleVehicle(state, b, V);
      if (info && !isBikeKey(info.key)) {
        const m = LIVE.battle && LIVE.battle.battle === b ? LIVE.battle : {};
        out.push({ id: "veh", battle: true, keys: [info.key], at: vehAt(V), level: 1, delay: m.loopDelay || 0, rev: m.rev || null });
      }
    }
    return out.slice(0, MAX_BATTLE_LOOPS);
  }
  if (!ui || !ui.started || ui.title) return out;
  const w = mapHumWant(state, ui, cam || mapCam(state));
  if (w) out.push(w);
  return out;
}
const LOOPS = new WeakMap(); // context -> Map(id -> loop)
export const loopsOf = (c) => LOOPS.get(c) || new Map();
// dests: { battle: the battle bus's input (ui/gunsfx.js), map: the effects bus }. L: the battle's listener (ui/
// gunsfx.js listener) to place the loop by; without it, near and centred. K: audio.js's building blocks.
export function engineLoops(c, dests, wants, t = c.currentTime, L = null, K = null) {
  let m = LOOPS.get(c);
  if (!m) LOOPS.set(c, (m = new Map()));
  const keep = new Set();
  const list = [...wants.filter((w) => w.battle).slice(0, MAX_BATTLE_LOOPS), ...wants.filter((w) => !w.battle).slice(0, MAX_MAP_LOOPS)];
  for (const w of list) {
    const dest = w.battle ? dests && dests.battle : dests && dests.map;
    if (!dest || !K) continue;
    keep.add(w.id);
    let lp = m.get(w.id);
    const sig = `${w.keys.join("+")}|${w.battle ? "b" : "m"}`;
    if (lp && (lp.sig !== sig || lp.dest !== dest)) { lp.stop(t); m.delete(w.id); lp = null; }
    if (!lp) { lp = makeLoop(c, dest, w, t + Math.max(0, w.delay || 0), K); lp.sig = sig; lp.dest = dest; m.set(w.id, lp); }
    lp.update(w, t, L);
  }
  for (const [id, lp] of m) if (!keep.has(id)) { lp.stop(t); m.delete(id); }
  return m;
}
function makeLoop(c, dest, w, t0, K) {
  // Placement: level → highs → pan → the bus (updated as the vehicle moves and the listener with it).
  const pg = c.createGain(); pg.gain.value = 1;
  const plp = c.createBiquadFilter(); plp.type = "lowpass"; plp.frequency.value = Math.min(16000, c.sampleRate * 0.45); plp.Q.value = 0.6;
  const pn = c.createStereoPanner ? c.createStereoPanner() : null;
  pg.connect(plp);
  if (pn) { plp.connect(pn); pn.connect(dest); } else plp.connect(dest);
  const eng = liveEngine(c, pg, t0, w.keys, { detune: 0.03 }, K);
  const E = eng.E;
  // A slow wander of the idle (a real engine never sits dead still) and, on the map, the ride over the ground.
  const wob = K.lfo(c, 0.6 + Math.random() * 0.3, 0.012, eng.srcs[0].playbackRate);
  const bump = c.createGain(); bump.gain.value = 1;
  let tyre = null, tg = null;
  if (!w.battle) {
    eng.g.disconnect(); eng.g.connect(bump); bump.connect(pg);
    tg = c.createGain(); tg.gain.value = 0.0001; tg.connect(bump);
    tyre = K.noise(c, "brown", t0, 3600, K.filt(c, "lowpass", 420, 0.7, tg));
  }
  const bl = K.lfo(c, 3.3, 0, bump.gain);
  const LV = w.battle ? LOOP_LEVEL.battle : LOOP_LEVEL.map;
  eng.level(t0, 0.0001, "set");
  const L0 = { revUntil: 0, revSeq: w.rev ? w.rev.seq : 0 }; // a drive seen before the loop was made is not replayed
  const last = {}; // the targets last scheduled: a frame that changes nothing schedules nothing
  const moved = (k, v) => { const o = last[k]; if (o != null && Math.abs(v - o) <= Math.max(0.005, Math.abs(o) * 0.01)) return false; last[k] = v; return true; };
  return {
    eng, stopped: false,
    update(wt, t, Lr) {
      if (this.stopped) return;
      const start = Math.max(t, t0);
      // where it is
      const sp = wt.battle && wt.at && Lr ? spatial(Lr, wt.at[0], wt.at[1], {}) : place({ pan: wt.pan || 0, dist: 0 });
      if (moved("g", sp.gain)) pg.gain.setTargetAtTime(sp.gain, t, 0.1);
      const f = Math.min(16000, c.sampleRate * 0.45, sp.lp);
      if (moved("lp", f)) plp.frequency.setTargetAtTime(f, t, 0.1);
      if (pn && moved("pan", sp.pan)) pn.pan.setTargetAtTime(sp.pan, t, 0.15);
      // how loud and how fast
      const lv = LV * (wt.level ?? 1);
      if (moved("lv", lv)) eng.level(start, lv, "tgt", start > t ? 0.35 : 0.4);
      if (!wt.battle) {
        const rpm = E.idle * (wt.rpmK || HUM.road);
        if (moved("rpm", rpm)) eng.rpm(start, rpm, "tgt", 0.8);
        const tv = Math.max(0.0001, (wt.road ? 0.05 : 0.11) * (wt.level ?? 1));
        if (moved("tyre", tv)) tg.gain.setTargetAtTime(tv, start, 0.6);
        if (moved("bump", wt.bump || 0)) { bl.frequency.setTargetAtTime(wt.road ? 2.1 : 3.4, t, 0.5); try { bl.disconnect(); } catch { /* none */ } const d = c.createGain(); d.gain.value = wt.bump || 0; bl.connect(d); d.connect(bump.gain); }
        return;
      }
      // the drive's revs (sim/combat.js driveTo through vehicleCues): first gear up, a change on a long drive, back to idle
      if (wt.rev && wt.rev.seq !== L0.revSeq) {
        L0.revSeq = wt.rev.seq;
        const cells = wt.rev.cells || 3, secs = clamp(0.7 + cells * 0.17, 1, 2.6);
        const a = t + 0.02;
        eng.rpm(a, E.idle + (E.rev - E.idle) * 0.45, "tgt", 0.12);
        eng.level(a, LV * 1.5, "tgt", 0.08);
        if (cells >= 5) { eng.rpm(a + secs * 0.45, E.idle + (E.rev - E.idle) * 0.25, "tgt", 0.05); eng.rpm(a + secs * 0.5, E.idle + (E.rev - E.idle) * 0.4, "tgt", 0.15); }
        eng.rpm(a + secs * 0.8, E.idle, "tgt", 0.25);
        eng.level(a + secs * 0.8, LV, "tgt", 0.3);
        L0.revUntil = a + secs;
        last.idle = null;
      }
      if (t >= L0.revUntil && moved("idle", E.idle)) eng.rpm(start, E.idle, "tgt", 0.3);
    },
    stop(t) {
      if (this.stopped) return;
      this.stopped = true;
      eng.g.gain.setTargetAtTime(0.0001, t, 0.12);
      eng.stop(t + 0.8); wob.stop(t + 0.8); bl.stop(t + 0.8); if (tyre) tyre.stop(t + 0.8);
    },
  };
}

// ---------- the voices ----------
export function vehicleVoices(K) {
  const { env, filt, noise, tone, thud, bell, crackle, lfo, R } = K;
  const tick = (c, out, t, f, g, d = 0.012, q = 3) => noise(c, "white", t, d + 0.01, filt(c, "bandpass", f, q, env(c, out, t, g, d, 0.001)));
  const gv = (o) => (o.gain ?? 1) * VEH_LEVEL;
  const keyOf = (o) => (ENGINES[o.key] ? o.key : o.big ? "miltruck" : "sedan");
  // The starter: its motor's whirr through a band, pumping with each compression; a weak battery turns it slower and
  // lower, dying away.
  function crank(c, out, t, E, dur, g, weak = false) {
    const e = env(c, out, t, 0.13 * g, 0.1, 0.03, Math.max(0.01, dur - 0.12));
    const am = c.createGain(); am.gain.value = 0.55; am.connect(e);
    const rate = E.crank[0] * (weak ? 0.6 : 1);
    const l = lfo(c, rate, 0.45, am.gain); l.stop(t + dur + 0.1);
    if (weak) l.frequency.linearRampToValueAtTime(rate * 0.6, t + dur);
    const f = E.crank[1] * (weak ? 0.75 : 1);
    tone(c, "sawtooth", f, f * (weak ? 0.6 : 0.93), t, dur, filt(c, "bandpass", 650, 1.2, am));
    noise(c, "brown", t, dur, filt(c, "lowpass", 280, 0.8, am));
    tone(c, "sine", f * 2.1, f * 1.9, t, dur, filt(c, "lowpass", 2000, 0.7, env(c, am, t, 0.15, 0.1, 0.03, Math.max(0.01, dur - 0.12))));
  }
  const keyTurn = (c, out, t, g) => { tick(c, out, t, 3400, 0.05 * g, 0.01, 4); tick(c, out, t + 0.06, 2300, 0.14 * g, 0.012); tick(c, out, t + 0.14, 1500, 0.18 * g, 0.015); };
  const toggle = (c, out, t, g) => { tick(c, out, t, 1100, 0.22 * g, 0.02, 2); thud(c, out, t, 180, 0.08 * g, 0.04); tick(c, out, t + 0.4, 900, 0.08 * g, 0.015, 2); }; // a start switch; the glow plugs' relay
  function sparks(c, out, t, g, ok = true) { // the hotwire: wires touched together, a buzz and sparks
    for (let i = 0; i < 4; i++) {
      const tt = t + i * 0.09 + R(0, 0.03);
      tone(c, "sawtooth", 100, 0, tt, 0.05, filt(c, "bandpass", 1800, 1.2, env(c, out, tt, 0.06 * g, 0.04, 0.002)));
      crackle(c, out, tt, 4, 0.04, 0.12 * g);
    }
    if (ok) tick(c, out, t + 0.42, 1300, 0.16 * g, 0.02);
  }
  function coolTicks(c, out, t, n, span, g) { for (let i = 0; i < n; i++) { const tt = t + R(0, span); tick(c, out, tt, R(3200, 6200), R(0.02, 0.045) * g, 0.006, 8); } }
  function pop(c, out, t, g, f = 70) { thud(c, out, t, f, 0.25 * g, 0.08); noise(c, "white", t, 0.05, filt(c, "bandpass", 900, 1, env(c, out, t, 0.08 * g, 0.04, 0.001))); }
  // Tyres on the ground (a drive's): asphalt's roll and a hiss when wet, gravel's grains, dirt's soft rush, mud's
  // squelch, snow's crunch.
  function tyres(c, out, t, dur, surf, g) {
    const e = (peak) => env(c, out, t, peak * g, dur * 0.35, Math.min(0.25, dur * 0.2), dur * 0.45);
    switch (surf) {
      case "gravel": noise(c, "brown", t, dur, filt(c, "lowpass", 500, 0.7, e(0.1))); crackle(c, out, t, Math.round(dur * 36), dur, 0.05 * g); break;
      case "mud": { const m = e(0.14), am = c.createGain(); am.gain.value = 0.5; am.connect(m); lfo(c, R(4, 6), 0.45, am.gain).stop(t + dur + 0.1); noise(c, "brown", t, dur, filt(c, "lowpass", 300, 0.9, am)); noise(c, "white", t, dur, filt(c, "bandpass", 260, 3, am)); break; }
      case "snow": noise(c, "white", t, dur, filt(c, "bandpass", 1800, 1, e(0.03))); crackle(c, out, t, Math.round(dur * 20), dur, 0.025 * g); noise(c, "brown", t, dur, filt(c, "lowpass", 400, 0.7, e(0.06))); break;
      case "wet": noise(c, "brown", t, dur, filt(c, "lowpass", 650, 0.7, e(0.09))); noise(c, "white", t, dur, filt(c, "bandpass", 3200, 0.8, e(0.035))); break;
      case "asphalt": noise(c, "brown", t, dur, filt(c, "lowpass", 700, 0.7, e(0.09))); noise(c, "white", t, dur, filt(c, "highpass", 3500, 0.7, e(0.008))); break;
      default: noise(c, "brown", t, dur, filt(c, "lowpass", 420, 0.7, e(0.09))); noise(c, "white", t, dur, filt(c, "bandpass", 1200, 0.8, e(0.012)));
    }
  }
  // Bicycles: the chain and the pedals; the freewheel's pawls ticking as it coasts; the bell; the brakes.
  function chainRun(c, out, t, dur, g) {
    const e = env(c, out, t, 0.035 * g, dur * 0.3, 0.2, dur * 0.5), am = c.createGain(); am.gain.value = 0.5; am.connect(e);
    const l = lfo(c, 1.6, 0.4, am.gain); l.frequency.linearRampToValueAtTime(2.6, t + dur); l.stop(t + dur + 0.1);
    noise(c, "white", t, dur, filt(c, "bandpass", 2600, 2, am));
    let tt = t + 0.1, gap = 0.16;
    while (tt < t + dur) { tick(c, out, tt, R(1700, 2200), 0.03 * g, 0.006, 5); tt += gap; gap = Math.max(0.07, gap * 0.92); }
  }
  function freewheel(c, out, t, dur, g) { let tt = t, gap = 0.035; while (tt < t + dur) { tick(c, out, tt, R(3800, 4600), 0.04 * g, 0.004, 8); tt += gap; gap *= 1.07; } }
  const bikeBell = (c, out, t, g) => { bell(c, out, t, 2650, 0.07 * g, 0.9); bell(c, out, t + 0.22, 2650, 0.06 * g, 1.1); };
  function brakes(c, out, t, g) {
    const v = tone(c, "sine", R(2700, 3100), 0, t, 0.5, filt(c, "bandpass", 2900, 4, env(c, out, t, 0.04 * g, 0.35, 0.05, 0.1)));
    lfo(c, 7, 40, v.frequency).stop(t + 0.6);
    noise(c, "white", t, 0.5, filt(c, "bandpass", 1800, 1.5, env(c, out, t, 0.03 * g, 0.4, 0.05)));
  }
  // A car door: the handle, the latch letting go and the seal (open); the slam, the latch, the panel (shut). heavy:
  // car, van (a sliding side door), truck, mil (steel: a clang).
  const SLAM = { car: [105, 0.42], van: [92, 0.45], truck: [86, 0.5], mil: [62, 0.55] };
  function doorOpen(c, out, t, heavy, g) {
    tick(c, out, t, 2300, 0.12 * g); tick(c, out, t + 0.03, 1500, 0.1 * g);
    thud(c, out, t + 0.05, heavy === "mil" ? 160 : 220, 0.08 * g, 0.05);
    noise(c, "brown", t + 0.06, 0.12, filt(c, "lowpass", 500, 0.7, env(c, out, t + 0.06, 0.08 * g, 0.1, 0.005)));
    if (heavy === "truck" || heavy === "mil") { const v = tone(c, "sawtooth", 140, 120, t + 0.1, 0.25, filt(c, "bandpass", 900, 6, env(c, out, t + 0.1, 0.03 * g, 0.18, 0.04))); lfo(c, 19, 12, v.frequency).stop(t + 0.4); }
    if (heavy === "mil") bell(c, out, t + 0.05, 640, 0.02 * g, 0.3);
  }
  function doorSlam(c, out, t, heavy, g) {
    const [f, p] = SLAM[heavy] || SLAM.car;
    thud(c, out, t, f, p * g, 0.12);
    tick(c, out, t + 0.005, 1100, 0.2 * g, 0.02, 2);
    noise(c, "white", t, 0.08, filt(c, "bandpass", 650, 1, env(c, out, t, 0.07 * g, 0.06, 0.002)));
    if (heavy === "mil") { bell(c, out, t, 380, 0.06 * g, 0.5); bell(c, out, t + 0.01, 910, 0.025 * g, 0.3); }
  }
  function slide(c, out, t, g, shut) { // a van's side door rolling on its track
    noise(c, "brown", t, 0.45, filt(c, "bandpass", 420, 1, env(c, out, t, 0.09 * g, 0.3, 0.05, 0.1)));
    for (let i = 0; i < 3; i++) tick(c, out, t + 0.05 + i * 0.12, 900, 0.04 * g, 0.015, 3);
    if (shut) { thud(c, out, t + 0.45, 88, 0.5 * g, 0.14); tick(c, out, t + 0.46, 1000, 0.2 * g, 0.02, 2); }
  }
  // An engine that catches: the catch, the flare past idle, settling to idle; o.go: pulling away (the map's convoy
  // hum takes over); else idling o.hold s and fading (the battle's idle loop takes over).
  function catchRun(c, out, tc, key, o, g, low, poor) {
    const E = ENGINES[key];
    const end = tc + (o.go ? 4.1 : (o.hold ?? 1.7) + 0.55);
    const h = liveEngine(c, out, tc - 0.01, o.keys && o.keys.length ? o.keys : [key], { dur: end - tc + 0.2, rpm: E.idle * 0.5, gain: g }, K);
    const lv = g;
    h.level(tc - 0.01, 0.0001, "set");
    h.level(tc + 0.05, lv, "lin");
    h.rpm(tc + 0.12, E.idle * (low ? 0.85 : 1.15), "lin");
    if (low) { // it stumbles on the dregs of the tank
      for (const [d, k] of [[0.2, 0.25], [0.32, 1], [0.5, 0.3], [0.6, 1]]) h.level(tc + d, lv * k, "set");
      lfo(c, 3, 0.08, h.srcs[0].playbackRate).stop(end);
    }
    h.rpm(tc + 0.35, E.idle * (poor || low ? E.flare * 0.8 : E.flare), "lin");
    h.rpm(tc + 1.0, E.idle * 1.12, "lin");
    h.rpm(tc + 1.6, E.idle, "lin");
    if (o.go) {
      h.level(tc + 2.0, lv, "lin"); h.rpm(tc + 2.0, E.idle, "lin");
      h.rpm(tc + 2.8, E.idle * 2.1, "lin"); h.level(tc + 2.8, lv * 1.15, "lin");
      h.level(end, 0.0001, "lin");
    } else { h.level(end - 0.55, lv, "lin"); h.level(end, 0.0001, "lin"); }
    h.stop(end + 0.05);
  }
  return {
    // A start: o.key (ENGINES), o.cond (a worn one fails its first try), o.fuel (under 2: it sputters), o.hot (hotwired),
    // o.mil (a start switch), o.go (pulls away), o.hold (idles this long first), o.keys (a convoy: they all catch).
    // A bicycle: the bell and the chain.
    engineStart: { dur: 2.5, play(c, out, t, o) {
      const key = keyOf(o), E = ENGINES[key], g = gv(o);
      if (E.bike) { bikeBell(c, out, t, g); chainRun(c, out, t + 0.3, 1.3, g); return; }
      const T = startTiming(key, o), low = (o.fuel ?? 10) < 2;
      if (o.hot) sparks(c, out, t, g);
      else if (E.diesel) toggle(c, out, t, g);
      else keyTurn(c, out, t, g);
      let tt = t + T.pre;
      if (T.poor) { crank(c, out, tt, E, 0.95, g); tt += 1.45; } // a worn one: the first try does not catch
      crank(c, out, tt, E, T.crank, g);
      if (low) for (let i = 0; i < 3; i++) pop(c, out, tt + T.crank * (0.3 + i * 0.22), g * 0.8, E.body[0]); // a misfire or two
      catchRun(c, out, t + T.catchAt, key, o, g, low, T.poor);
    } },
    // Will not start: o.why "wreck" (a click and the solenoid chattering on a dead battery) or "dead" (it turns over
    // and over and never catches, slowing).
    engineNoStart: { dur: 2, play(c, out, t, o) {
      const key = keyOf(o), E = ENGINES[key], g = gv(o);
      if (E.bike) return;
      keyTurn(c, out, t, g);
      if (o.why === "wreck") { for (let i = 0; i < 6; i++) tick(c, out, t + 0.25 + i * 0.08, 1100, 0.12 * g, 0.012, 3); }
      else crank(c, out, t + 0.2, E, 1.6, g, true);
    } },
    // Switched off: the key, the engine running down with a shudder, the hot metal ticking. A bicycle: the brakes and
    // the freewheel coasting to a stop.
    engineStop: { dur: 3.8, play(c, out, t, o) {
      const key = keyOf(o), E = ENGINES[key], g = gv(o);
      if (E.bike) { brakes(c, out, t, g); freewheel(c, out, t + 0.3, 1.4, g); return; }
      tick(c, out, t, 900, 0.16 * g, 0.02, 2); thud(c, out, t, 140, 0.06 * g, 0.04);
      const d = E.diesel ? 0.95 : 0.7;
      const h = liveEngine(c, out, t, [key], { dur: d + 0.3, gain: g }, K);
      h.level(t, g, "set"); h.level(t + d * 0.5, g * 0.85, "lin"); h.level(t + d, 0.0001, "lin");
      h.rpm(t + d * 0.55, E.idle * 0.5, "lin"); h.rpm(t + d, E.idle * 0.15, "lin");
      h.stop(t + d + 0.1);
      thud(c, out, t + d * 0.85, E.diesel ? 42 : 52, 0.18 * g, 0.18); // it settles on its mounts
      coolTicks(c, out, t + d + 0.4, E.diesel ? 9 : 7, 2.4, g);
    } },
    // On the road: a cough or two and a bang, the engine dying, steam hissing; o.fuel: sputtering out instead. A bike:
    // a tyre bursting and the chain snapping.
    breakdown: { dur: 3.4, play(c, out, t, o) {
      const key = keyOf(o), E = ENGINES[key], g = gv(o);
      if (E.bike) {
        thud(c, out, t, 180, 0.3 * g, 0.06); noise(c, "white", t, 0.06, filt(c, "bandpass", 2500, 1, env(c, out, t, 0.18 * g, 0.05, 0.001)));
        noise(c, "white", t + 0.03, 0.9, filt(c, "highpass", 3000, 0.7, env(c, out, t + 0.03, 0.05 * g, 0.7, 0.01)));
        bell(c, out, t + 0.5, 3200, 0.04 * g, 0.3);
        for (let i = 0; i < 6; i++) tick(c, out, t + 0.55 + R(0, 0.3), R(2500, 4000), 0.05 * g, 0.01, 4);
        freewheel(c, out, t + 0.9, 1.2, g);
        return;
      }
      const run = E.idle * 1.7, dieAt = o.fuel ? 1.5 : 1.0;
      const h = liveEngine(c, out, t, [key], { dur: dieAt + 0.9, rpm: run, gain: g }, K);
      h.level(t, 0.0001, "set"); h.level(t + 0.05, g, "lin");
      const chops = o.fuel ? [[0.3, 0.15], [0.4, 1], [0.6, 0.1], [0.72, 0.9], [0.95, 0.1], [1.1, 0.7], [1.3, 0.05]] : [[0.35, 0.2], [0.42, 1], [0.6, 0.15], [0.68, 1]];
      for (const [d, k] of chops) h.level(t + d, g * k, "set");
      if (!o.fuel) { pop(c, out, t + 0.85, g * 2.2, 60); crackle(c, out, t + 0.85, 6, 0.08, 0.1 * g); }
      h.rpm(t + dieAt, run, "lin"); h.rpm(t + dieAt + 0.7, E.idle * 0.15, "lin");
      h.level(t + dieAt, g * (o.fuel ? 0.4 : 0.9), "lin"); h.level(t + dieAt + 0.75, 0.0001, "lin");
      h.stop(t + dieAt + 0.85);
      if (!o.fuel) noise(c, "white", t + dieAt + 0.6, 1.6, filt(c, "highpass", 3500, 0.7, env(c, out, t + dieAt + 0.6, 0.03 * g, 1.2, 0.2)));
      coolTicks(c, out, t + dieAt + 1, 4, 1.4, g);
    } },
    // Driven across the battle map: o.key, o.cells, o.surf (the tyres), o.loop (the idle loop has the engine: tyres
    // and the gear change only), o.cold (nobody in it: started, driven and switched off), o.away (off the map: it
    // revs and goes). A bicycle: the chain and the tyres.
    drive: { dur: 2.2, play(c, out, t, o) {
      const key = keyOf(o), E = ENGINES[key], g = gv(o);
      const cells = Math.max(1, o.cells || 3), secs = o.away ? 2.4 : clamp(0.7 + cells * 0.17, 1, 2.6);
      if (E.bike) { chainRun(c, out, t, secs, g); tyres(c, out, t, secs, o.surf, g * 0.6); brakes(c, out, t + secs - 0.3, g * 0.6); return; }
      let t0 = t;
      if (o.cold && !o.loop) { keyTurn(c, out, t, g); crank(c, out, t + 0.2, E, 0.35, g); t0 = t + 0.55; }
      tyres(c, out, t0 + 0.1, secs, o.surf, g);
      const shift = cells >= 5;
      if (shift) { tick(c, out, t0 + secs * 0.45, 600, 0.07 * g, 0.02, 2); thud(c, out, t0 + secs * 0.46, 90, 0.05 * g, 0.05); }
      if (o.loop) return;
      const h = liveEngine(c, out, t0, [key], { dur: secs + 0.6, gain: g }, K);
      const hi = E.idle + (E.rev - E.idle) * 0.55;
      h.level(t0, 0.0001, "set"); h.level(t0 + 0.06, g, "lin");
      h.rpm(t0 + 0.08, E.idle * 1.3, "lin");
      h.rpm(t0 + secs * 0.4, hi, "lin"); h.level(t0 + secs * 0.4, g * 1.4, "lin");
      if (shift) { h.level(t0 + secs * 0.45, g * 0.6, "set"); h.rpm(t0 + secs * 0.47, E.idle + (E.rev - E.idle) * 0.3, "lin"); h.level(t0 + secs * 0.5, g * 1.3, "lin"); h.rpm(t0 + secs * 0.7, E.idle + (E.rev - E.idle) * 0.45, "lin"); }
      if (o.away) { h.rpm(t0 + secs, hi * 1.1, "lin"); h.level(t0 + secs, 0.0001, "lin"); h.stop(t0 + secs + 0.05); return; }
      h.rpm(t0 + secs, E.idle, "lin"); h.level(t0 + secs, g, "lin");
      if (o.cold) { h.rpm(t0 + secs + 0.45, E.idle * 0.2, "lin"); h.level(t0 + secs + 0.45, 0.0001, "lin"); coolTicks(c, out, t0 + secs + 0.8, 3, 1, g); }
      else h.level(t0 + secs + 0.4, 0.0001, "lin");
      h.stop(t0 + secs + 0.55);
    } },
    // Car doors: o.heavy (car, van, truck, mil), o.n doors (1-4, one after another), o.only ("open" / "close"; both by
    // default: someone getting in or out).
    carDoor: { dur: 1.2, play(c, out, t, o) {
      const g = gv(o), heavy = o.heavy || "car", n = clamp(Math.round(o.n || 1), 1, 4);
      const OPEN = [0, 0.18, 0.37, 0.52], SHUT = [0.62, 0.86, 1.02, 1.3];
      for (let i = 0; i < n; i++) {
        const k = 1 - i * 0.08;
        if (heavy === "van" && i === 1) { if (o.only !== "close") slide(c, out, t + OPEN[i], g * k, false); if (o.only !== "open") slide(c, out, t + SHUT[i] - 0.3, g * k, true); continue; }
        if (o.only !== "close") doorOpen(c, out, t + OPEN[i], heavy, g * k);
        if (o.only !== "open") doorSlam(c, out, t + (o.only === "close" ? OPEN[i] : SHUT[i]) + R(0, 0.04), heavy, g * k);
      }
    } },
    // The tailgate or the rear doors as cargo goes in or out (o.heavy as carDoor's): down, and up again.
    tailgate: { dur: 1.6, play(c, out, t, o) {
      const g = gv(o), heavy = o.heavy || "truck";
      if (heavy === "mil" || heavy === "van") { // rear doors: both latches, both doors
        for (let i = 0; i < 2; i++) { tick(c, out, t + i * 0.2, 1200, 0.14 * g, 0.02, 2); thud(c, out, t + i * 0.2 + 0.05, 160, 0.1 * g, 0.06); }
        for (let i = 0; i < 2; i++) doorSlam(c, out, t + 1.05 + i * 0.25, heavy, g);
        return;
      }
      if (heavy === "car") { tick(c, out, t, 1500, 0.14 * g, 0.015); thud(c, out, t + 0.04, 200, 0.08 * g, 0.05); thud(c, out, t + 1.1, 95, 0.35 * g, 0.12); tick(c, out, t + 1.11, 1200, 0.16 * g, 0.02, 2); return; }
      tick(c, out, t, 1200, 0.16 * g, 0.02, 2);
      const v = tone(c, "sawtooth", 300, 250, t + 0.05, 0.25, filt(c, "bandpass", 1500, 5, env(c, out, t + 0.05, 0.03 * g, 0.2, 0.03))); lfo(c, 21, 15, v.frequency).stop(t + 0.35);
      thud(c, out, t + 0.3, 75, 0.45 * g, 0.16);
      for (let i = 0; i < 4; i++) tick(c, out, t + 0.31 + i * 0.04, R(2500, 3500), 0.05 * g, 0.01, 4); // the cables' links
      thud(c, out, t + 1.2, 90, 0.42 * g, 0.12); tick(c, out, t + 1.21, 1100, 0.2 * g, 0.02, 2);
    } },
    // Hotwiring a found car (sim/foundcars.js "hotwire"): the wires buzzing and sparking; o.ok: it takes.
    hotwire: { dur: 0.6, play(c, out, t, o) { sparks(c, out, t, gv(o), o.ok !== false); } },
  };
}
export const VEHICLE_LABELS = {
  engineStart: "Engine starting", engineNoStart: "Engine that will not start", engineStop: "Engine off", breakdown: "Breakdown on the road", drive: "A vehicle driven in battle",
  carDoor: "Car doors", tailgate: "Tailgate or rear doors", hotwire: "Hotwiring a car",
};
// The throttle's limits (ui/audio.js LIMITS): gap in seconds between two starts, how many at once.
export const VEHICLE_LIMITS = {
  engineStart: { gap: 1.5, max: 1 }, engineNoStart: { gap: 1.5, max: 1 }, engineStop: { gap: 1.5, max: 1 }, breakdown: { gap: 2, max: 1 }, drive: { gap: 0.8, max: 1 },
  carDoor: { gap: 0.12, max: 3 }, tailgate: { gap: 1, max: 1 }, hotwire: { gap: 0.4, max: 1 },
};
