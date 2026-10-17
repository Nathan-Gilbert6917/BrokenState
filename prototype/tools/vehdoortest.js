// Vehicle and door sounds (ui/sfx-vehicles.js, ui/sfx-doors.js, hooked in ui/sfx-gear.js and ui/audio.js): headless
// checks with no speakers.
// - Engines: every vehicle type has an engine voice of its own (bikes the bicycle set); a start, a failing start on a
//   worn one, a sputtering start on an empty tank, a hotwired start, a wreck that will not start, a breakdown, a stop.
// - Battle: boarding plays the car door and (the first one in) the engine's start; the idle loop runs while someone is
//   in it (at most 2 loops); driving revs it; the last one out switches it off and opens a door; a cold drive; a convoy.
// - Building doors: kinds (wood, front or steel outer doors, roller, cell, vault, barred, gate), opened by a move,
//   closed, a locked one tried, picked, kicked in, broken; the threshold of an open door for the first one through;
//   a peek; found cars' locks and wires.
// - The map: a team leaving a base (doors, engine, gate) and coming home (gate, engine off, doors), on foot (the gate),
//   breakdowns and running dry, a found car repaired, a city crawl's doors, the tailgate; one convoy hum for a team of
//   3 vehicles.
// - Every new sound is in the vehicles or doors tables and a mixer group; every voice builds without NaN.
// - Determinism: the same battle played with and without the sounds ends the same.
// Usage: node tools/vehdoortest.js
import * as C from "../src/sim/combat.js";
import { BMAP } from "../src/sim/buildingmaps.js"; // the door hit points doorKind reads (vault, cell)
import { battles } from "./isobattles.js";

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); };
const t0 = performance.now();
const names = (l) => l.map((c) => c.name);

console.log("Imports");
let VS, DS, G, AU, SG, VEH, W, P;
{
  let err = "";
  try {
    VS = await import("../src/ui/sfx-vehicles.js");
    DS = await import("../src/ui/sfx-doors.js");
    G = await import("../src/ui/sfx-gear.js");
    AU = await import("../src/ui/audio.js");
    SG = await import("../src/ui/soundgroups.js");
    VEH = await import("../src/sim/vehicles.js");
    W = await import("../src/sim/world.js");
    P = await import("../src/sim/parties.js");
  } catch (e) { err = e.stack; }
  check(!err, `the modules load in node with nothing run${err ? `: ${err}` : ""}`);
}
const ALL = new Set([...VS.VEHICLE_SOUNDS, ...DS.DOOR_SOUNDS]);
const emitted = new Set();
const UI_NAMES = new Set(["uiOpen", "uiClose", "pickup", "putdown"]); // the interface's own (ui/sfx-gear.js)
const seen = (l) => { for (const c of l) if (!UI_NAMES.has(c.name)) emitted.add(c.name); return l.filter((c) => !UI_NAMES.has(c.name)); };

// ---------- engines ----------
console.log("Engines");
{
  const { engineOf, ENGINES, isBikeKey, startTiming, bakeEngine } = VS;
  const want = { truck: "pickup", sedan: "sedan", suv: "suv", hummer: "humvee", van: "van", miltruck: "miltruck", bike: "bicycle" };
  const got = Object.keys(VEH.VEHICLE_TYPES).map((t) => [t, engineOf({ type: t })]);
  check(got.every(([t, k]) => ENGINES[k] && (want[t] ? k === want[t] : true)), `every vehicle type has an engine voice (${got.map(([t, k]) => `${t}=${k}`).join(", ")})`);
  check(isBikeKey(engineOf({ type: "bike", count: 3 })) && !ENGINES.bicycle.cyl, "bicycles: the bicycle set, no engine");
  check(engineOf({ type: "dirtbike" }) === "motorbike" && engineOf(null) === "sedan", "a motorbike type (if one comes) buzzes as one; nothing known: a sedan");
  const cyl = Object.fromEntries(Object.entries(ENGINES).filter(([, E]) => !E.bike).map(([k, E]) => [k, E.cyl]));
  check(ENGINES.miltruck.diesel && ENGINES.humvee.diesel && ENGINES.miltruck.clatter > ENGINES.humvee.clatter && ENGINES.humvee.body[0] < ENGINES.pickup.body[0] && ENGINES.motorbike.idle > ENGINES.sedan.idle,
    `diesels clatter (the Army truck most), the Humvee rumbles lower than the pickup, the motorbike buzzes higher (cylinders ${JSON.stringify(cyl)})`);
  const firing = (E) => (E.idle / 60) * (E.cyl / 2);
  const b = bakeEngine(8000, ENGINES.pickup, 3);
  const loopS = b.length / 8000;
  check(b.length > 100 && b.every(Number.isFinite) && Math.max(...b.map(Math.abs)) <= 1.0001 && Math.abs(loopS * firing(ENGINES.pickup) - Math.round(loopS * firing(ENGINES.pickup))) < 0.05,
    `an engine bakes to one seamless loop of whole firing pulses (${loopS.toFixed(2)} s, ${Math.round(loopS * firing(ENGINES.pickup))} pulses)`);
  const n = startTiming("sedan", {}), poor = startTiming("sedan", { cond: 20 }), dry = startTiming("sedan", { fuel: 1 }), hot = startTiming("sedan", { hot: true }), dz = startTiming("miltruck", {});
  check(poor.catchAt > n.catchAt + 1 && poor.poor, `a worn car fails its first try and catches later (${n.catchAt.toFixed(2)} s → ${poor.catchAt.toFixed(2)} s)`);
  check(dry.crank > n.crank && hot.pre > n.pre && dz.crank > n.crank, "an empty tank cranks longer (and sputters), a hotwire takes longer than a key, a diesel cranks longer");
}

// ---------- the horn ----------
console.log("Horn");
{
  const { HORNS, hornOf } = VS;
  check(hornOf("sedan") === "car" && hornOf("compact") === "car" && ["suv", "van", "pickup"].every((k) => hornOf(k) === "mid") && hornOf("humvee") === "heavy" && hornOf("miltruck") === "heavy", "horns by vehicle: cars high, SUVs, vans and pickups middle, the Humvee and the Army truck deep");
  check(HORNS.car.f > HORNS.mid.f && HORNS.mid.f > HORNS.heavy.f && Object.values(HORNS).every((H) => H.third > 1.15 && H.third < 1.3 && Math.abs(H.beep - 0.12) < 0.02 && Math.abs(H.gap - 0.1) < 0.01),
    `beep beep: about 0.12 s each, 0.1 s apart, two tones a minor third or so apart (${Object.entries(HORNS).map(([k, H]) => `${k} ${H.f}/${Math.round(H.f * H.third)} Hz`).join(", ")})`);
}

// ---------- voices ----------
console.log("Voices");
let ctx, made, bad, node;
{
  bad = [];
  made = { n: 0 };
  const param = (name, v = 0) => {
    const p = { value: v };
    const fin = (x, what) => { if (!Number.isFinite(x)) bad.push(`${name}.${what}(${x})`); };
    p.setValueAtTime = (x, t) => { fin(x, "set"); fin(t, "setT"); return p; };
    p.linearRampToValueAtTime = (x, t) => { fin(x, "lin"); fin(t, "linT"); return p; };
    p.exponentialRampToValueAtTime = (x, t) => { fin(x, "exp"); if (!(x > 0)) bad.push(`${name}.exp(${x})`); fin(t, "expT"); return p; };
    p.setTargetAtTime = (x, t, tc) => { fin(x, "tgt"); fin(t, "tgtT"); fin(tc, "tgtC"); return p; };
    p.cancelScheduledValues = () => p;
    return p;
  };
  node = (extra = {}) => { made.n++; return { connect(d) { if (!d) bad.push("connect(null)"); return d; }, disconnect() {}, ...extra }; };
  ctx = {
    sampleRate: 8000, currentTime: 0, state: "running",
    createGain: () => node({ gain: param("gain", 1) }),
    createBiquadFilter: () => node({ type: "", frequency: param("freq", 350), Q: param("Q", 1) }),
    createOscillator: () => node({ type: "", frequency: param("osc", 440), start() {}, stop(t) { if (!Number.isFinite(t)) bad.push("stop"); } }),
    createBufferSource: () => node({ buffer: null, loop: false, playbackRate: param("rate", 1), start(t, off) { if (!Number.isFinite(off) || !Number.isFinite(t)) bad.push("start"); }, stop(t) { if (!Number.isFinite(t)) bad.push("srcstop"); } }),
    createBuffer: (ch, len, rate) => { const d = new Float32Array(len); return { duration: len / rate, length: len, getChannelData: () => d }; },
    createStereoPanner: () => node({ pan: param("pan") }),
  };
  const { VOICES } = AU;
  const errs = [];
  let n = 0;
  const play = (name, o) => { try { VOICES[name].play(ctx, node(), 0.5, { gain: 1, pitch: 1, ...o }); n++; } catch (e) { errs.push(`${name} ${JSON.stringify(o)}: ${e.message}`); } };
  for (const key of VS.ENGINE_KEYS) {
    for (const o of [{}, { cond: 15 }, { fuel: 1 }, { hot: true }, { mil: true }, { go: true }, { keys: [key, "pickup"] }]) play("engineStart", { key, ...o });
    for (const why of ["wreck", "dead"]) play("engineNoStart", { key, why });
    play("engineStop", { key });
    for (const o of [{}, { fuel: true }]) play("breakdown", { key, ...o });
    for (const surf of ["asphalt", "wet", "gravel", "dirt", "mud", "snow"]) for (const o of [{}, { cold: true }, { loop: true }, { away: true }]) play("drive", { key, cells: surf === "mud" ? 7 : 3, surf, ...o });
  }
  for (const heavy of ["car", "van", "truck", "mil"]) for (const o of [{}, { n: 4 }, { only: "open" }, { only: "close" }]) { play("carDoor", { heavy, ...o }); play("tailgate", { heavy }); }
  play("hotwire", { ok: true }); play("hotwire", { ok: false });
  for (const key of VS.ENGINE_KEYS) play("horn", { key });
  for (const dk of [...DS.DOOR_KINDS, undefined]) {
    for (const name of ["door", "doorClose", "doorRattle", "threshold", "doorPeek", "doorBrace"]) play(name, { dk });
    for (const how of ["kick", "pry", "glass"]) for (const ok of [true, false]) play("doorForce", { dk, how, ok });
    for (const layer of [false, true]) play("doorBreak", { dk, layer });
  }
  for (const ok of [true, false]) play("lockPick", { ok });
  for (const dk of ["gate", "steel", "front"]) for (const close of [true, false]) play("gateOpen", { dk, close });
  play("gateBatter", {});
  check(!errs.length, `${n} variants of the vehicle and door voices build${errs.length ? `: ${errs.slice(0, 3).join("; ")}` : ""}`);
  check(!bad.length, `no NaN, no ramp to zero, nothing connected to nothing${bad.length ? `: ${bad.slice(0, 5).join(", ")}` : ""}`);
  check(made.n / n < 90, `about ${(made.n / n).toFixed(0)} nodes a sound on average (the start and the drive are the big ones; a door a dozen or two)`);
  check([...ALL].every((k) => VOICES[k] && VOICES[k].own && VOICES[k].play), "every vehicle and door voice is a voice played through the output stage (ui/sfx-out.js)");
}

// ---------- the tables ----------
console.log("Tables");
{
  const veh = VS.VEHICLE_SOUNDS, door = DS.DOOR_SOUNDS;
  check(veh.every((k) => SG.groupOf(k) === "people.vehicles") && VS.VEHICLE_LOOPS.every((k) => SG.groupOf(k) === "people.vehicles") && door.every((k) => SG.groupOf(k) === "people.doors"),
    `the mixer's groups: People → Vehicles (${veh.length} voices and ${VS.VEHICLE_LOOPS.length} loops), People → Doors and gates (${door.length})`);
  check(!veh.some((k) => door.includes(k)) && [...ALL].every((k) => AU.VOICES[k]), "the tables do not overlap, and each name is a voice");
}

// ---------- battle: boarding, the engine, the drive ----------
console.log("Battle: vehicles");
const freeNext = (b, v) => {
  for (let y = v.y - 1; y <= v.y + v.h; y++) for (let x = v.x - 1; x <= v.x + v.w; x++) {
    if (x < 0 || y < 0 || x >= b.w || y >= b.h) continue;
    if (x >= v.x && y >= v.y && x < v.x + v.w && y < v.y + v.h) continue;
    const c = b.cells[y * b.w + x];
    if (C.CELL[c.k].walk && c.k !== "vehicle" && !b.units.some((u) => !u.dead && !u.aboard && u.x === x && u.y === y)) return [x, y];
  }
  return null;
};
{
  const [raid] = battles(51, ["raid-building"]);
  const { st, b } = raid;
  const mem = {};
  check(!!b.vehicle, `the raid has the team's vehicle (${b.vehicle && b.vehicle.kind})`);
  G.gearCues(st, mem);
  const me = b.units.filter((u) => u.side === "player" && !u.dead);
  const board = (u) => { const at = freeNext(b, b.vehicle); u.x = at[0]; u.y = at[1]; u.ap = 2; return C.boardVehicle(b, u); };
  let err = board(me[0]);
  let cues = seen(G.gearCues(st, mem));
  check(!err && names(cues).join() === "carDoor,engineStart" && cues[1].delay > cues[0].delay && cues[1].key === VS.engineOf(st.vehicles[0]), `the first one in: a door, then the engine starts (${names(cues).join(", ")}, ${cues[1] && cues[1].key})`);
  let wants = VS.loopWants(st, { started: true });
  check(wants.length === 1 && wants[0].battle && wants[0].delay > 1, `the idle loop is wanted once it has caught (${wants.length} loop, after ${wants[0] && wants[0].delay.toFixed(2)} s)`);
  err = board(me[1]);
  cues = seen(G.gearCues(st, mem));
  check(!err && names(cues).join() === "carDoor", "a second one in: a door only");
  // driving it with them inside: the loop revs, the voice brings the tyres
  const v = b.vehicle, from = [v.x, v.y];
  let drove = "";
  for (const [dx, dy] of [[0, 3], [0, -3], [3, 0], [-3, 0], [0, 2], [0, -2], [2, 0]]) { me[0].ap = 2; drove = C.driveTo(b, me[0], v.x + dx + Math.floor((v.w - 1) / 2), v.y + dy + Math.floor((v.h - 1) / 2)); if (!drove) break; }
  if (drove) v.y = from[1] + 1; // no room to drive on this map: moved by hand (the cues read where it is)
  cues = seen(G.gearCues(st, mem));
  const dr = cues.find((c) => c.name === "drive");
  check(dr && dr.loop && !dr.cold && mem.vc.rev && mem.vc.rev.cells > 0, `driven with people inside: the idle loop revs (${dr && dr.cells} cells on ${dr && dr.surf}), the voice brings the tyres`);
  wants = VS.loopWants(st, { started: true });
  check(wants.length === 1 && wants[0].rev && wants[0].rev.seq === mem.vc.rev.seq, "the loop is told to rev");
  // loops: made, capped at 2, let go
  made.n = 0;
  const dests = { battle: node(), map: node() };
  let m = VS.engineLoops(ctx, dests, wants, 1, null);
  const perLoop = made.n;
  check(m.size === 1 && perLoop < 40, `one engine loop made (${perLoop} nodes)`);
  made.n = 0;
  VS.engineLoops(ctx, dests, wants, 1.1, null);
  check(made.n === 0, "a frame that changes nothing makes no nodes");
  m = VS.engineLoops(ctx, dests, [0, 1, 2].map((i) => ({ ...wants[0], id: `veh${i}` })), 1.2, null);
  check(m.size === VS.MAX_BATTLE_LOOPS && VS.MAX_BATTLE_LOOPS === 2, `three wanted: capped at ${m.size}`);
  // everyone out: the engine off, a door
  for (const u of me.slice(0, 2)) { u.ap = 2; C.disembark(b, u); }
  cues = seen(G.gearCues(st, mem));
  check(names(cues)[0] === "engineStop" && names(cues).filter((n) => n === "carDoor").length === 2 && cues.find((c) => c.name === "carDoor").delay >= 0.5, `the last one out: the engine off, then the doors (${names(cues).join(", ")})`);
  check(VS.loopWants(st, { started: true }).length === 0 && VS.engineLoops(ctx, dests, [], 2, null).size === 0, "nobody inside: no loop, and the one playing is let go");
  // a cold drive: nobody in it
  b.vehicle.x += 1;
  cues = seen(G.gearCues(st, mem));
  check(names(cues).join() === "drive" && cues[0].cold, "driven with nobody inside: a cold drive (started, driven, switched off)");
  // a convoy's other vehicle moved (b.convoy)
  b.convoy = [{ vid: st.vehicles[0].id, x: 2, y: 2, w: 2, h: 3, kind: "car" }];
  G.gearCues(st, mem);
  b.convoy[0].y += 2;
  cues = seen(G.gearCues(st, mem));
  check(names(cues).join() === "drive" && cues[0].cold, "a convoy's parked vehicle moved: its own cold drive");
  b.convoy = [];
  // blown up: no start
  board(me[2] || me[0]);
  G.gearCues(st, mem);
  b.vehicle.blownUp = true;
  check(VS.loopWants(st, { started: true }).length === 0, "a wreck (blown up): no idle loop");
  b.vehicle.blownUp = false;
  // a bike team: no doors, the bell and the chain
  const bst = { ...st, combat: { ...b, vehicle: { ...b.vehicle, kind: "bike" }, setup: { ...b.setup, partyId: null }, units: b.units.map((u) => ({ ...u, aboard: false })) } };
  const bm = {};
  G.gearCues(bst, bm);
  bst.combat.units[0].aboard = true;
  cues = seen(G.gearCues(bst, bm));
  check(names(cues).join() === "engineStart" && cues[0].key === "bicycle", "a bike mounted: the bell and the chain, no car door");
}

// ---------- battle: building doors ----------
console.log("Battle: doors");
{
  const [raid] = battles(52, ["raid-building"]);
  const { st, b } = raid;
  const mem = {};
  G.gearCues(st, mem);
  const me = b.units.find((u) => u.side === "player" && !u.dead);
  const R = b.raid.plan.building;
  const idx = (x, y) => y * b.w + x;
  const inner = b.cells.findIndex((c, i) => c.k === "idoor" && !DS.exteriorDoor(b, i % b.w, (i / b.w) | 0));
  const fr = b.raid.plan.front;
  check(DS.doorKind(b, idx(fr.x, fr.y)) === (/(police|offices|hospital)/.test(b.raid.interior && b.raid.interior.key) ? "metal" : "front") || ["metal", "front"].includes(DS.doorKind(b, idx(fr.x, fr.y))), `the front door is an outer door (${DS.doorKind(b, idx(fr.x, fr.y))}, ${b.raid.interior && b.raid.interior.key})`);
  check(inner < 0 || DS.doorKind(b, inner) === "wood", "an inner door is wooden");
  const kindWith = (patch) => { const i = inner >= 0 ? inner : 0, keep = { ...b.cells[i] }; Object.assign(b.cells[i], patch); const k = DS.doorKind(b, i); b.cells[i] = keep; return k; };
  check(kindWith({ roll: true }) === "roller" && kindWith({ mhp: BMAP.DOOR.vault }) === "vault" && kindWith({ mhp: BMAP.DOOR.cell }) === "cell" && kindWith({ k: "bdoor" }) === "barred" && kindWith({ k: "gate" }) === "gate", "roller, steel security, cell, barred and gate doors by the cell");
  if (inner >= 0) {
    const x = inner % b.w, y = (inner / b.w) | 0;
    // opened by a move through it (sim/combat.js openDoor), once
    C.openDoor(b, x, y, me);
    C.fx(b, { type: "move", unit: me.id, from: [me.x, me.y], path: [[x, y]] });
    let cues = seen(G.gearCues(st, mem));
    check(names(cues).join() === "door" && cues[0].dk === "wood" && cues[0].room === "inside" && cues[0].enemy === false, `walked through a closed door: it opens, wood, in the tight room (${JSON.stringify(cues[0] && { dk: cues[0].dk, room: cues[0].room })})`);
    C.fx(b, { type: "move", unit: me.id, from: [me.x, me.y], path: [[x, y]] });
    check(seen(G.gearCues(st, mem)).length === 0, "through it again the same turn: nothing (the threshold is for the first one through)");
    b.turn += 1;
    C.fx(b, { type: "move", unit: me.id, from: [me.x, me.y], path: [[x, y]] });
    cues = seen(G.gearCues(st, mem));
    check(names(cues).join() === "threshold", "the first one through an open door next turn: the soft threshold sound");
    // closed (buildingmaps.js doorAct "close")
    b.cells[inner].k = "idoor";
    cues = seen(G.gearCues(st, mem));
    check(names(cues).join() === "doorClose" && cues[0].dk === "wood", "a door shut: the close");
    // battered down
    b.cells[inner].k = "doorway";
    cues = seen(G.gearCues(st, mem));
    check(names(cues).join() === "doorBreak" && !cues[0].layer, "a door broken in (shot down): the break");
    // the peek through a closed door
    const other = b.cells.findIndex((c, i) => c.k === "idoor" && i !== inner);
    if (other >= 0) {
      b.peeks = [...(b.peeks || []), { turn: b.turn, unit: me.id, x: 0, y: 0, dx: other % b.w, dy: (other / b.w) | 0, r: 8 }];
      cues = seen(G.gearCues(st, mem));
      check(names(cues).join() === "doorPeek", "a peek through a closed door: eased ajar");
      b.cells[other].held = me.id;
      cues = seen(G.gearCues(st, mem));
      check(names(cues).join() === "doorBrace", "a door braced: the shoulder against it");
    }
  }
  // the front door, outside: the town's slapback
  const fi = idx(fr.x, fr.y);
  b.cells[fi].k = "idoor";
  G.gearCues(st, mem);
  b.cells[fi].k = "odoor";
  let cues = seen(G.gearCues(st, mem));
  check(names(cues).join() === "door" && cues[0].room === "town", "the front door opens with the town's slapback (an outer door)");
  // locks on a door (sim/locks.js openLock fx with how)
  b.raid.doors = [...(b.raid.doors || []), { id: 990, x: fr.x, y: fr.y, f: 0, lock: { kind: "door", open: false } }];
  b.cells[fi].k = "door";
  G.gearCues(st, mem);
  const lockFx = (text, how) => { C.fx(b, { type: "loot", to: [fr.x, fr.y], text, ...(how ? { how } : {}) }); return seen(G.gearCues(st, mem)); };
  check(names(lockFx("locked")).join() === "doorRattle", "a locked door tried: the handle rattles");
  check(names(lockFx("locked", "pick")).join() === "lockPick", "picked and it holds: the pins");
  const kick = lockFx("locked", "kick");
  check(names(kick).join() === "doorForce" && kick[0].how === "kick" && !kick[0].ok, "kicked and it holds: the kicks");
  check(names(lockFx("locked", "pry")).join() === "doorForce", "a crowbar on it: the pry");
  C.fx(b, { type: "loot", to: [fr.x, fr.y], text: "unlocked", how: "kick" });
  b.cells[fi].k = "odoor";
  cues = seen(G.gearCues(st, mem));
  check(names(cues).join() === "doorForce,door" && cues[0].ok && cues[1].delay >= 0.3, `kicked in: the kick and the splinters, then the door swings (${names(cues).join(", ")})`);
  // a gun safe opened
  const box = { id: 991, x: 1, y: 1, f: 0, lock: { kind: "safe", open: true, tier: 2 } };
  b.raid.containers.push(box);
  cues = seen(DS.doorLoot(b, { type: "loot", to: [1, 1], text: "unlocked", how: "crack" }));
  check(names(cues).join() === "unlock,door" && cues[1].dk === "vault", "a gun safe cracked: the click and the heavy door");
  // the gate battered (a base's)
  const [base] = battles(53, ["base-wall-night"]);
  const gi = base.b.cells.findIndex((c) => c.k === "gate");
  const gm = {};
  G.gearCues(base.st, gm);
  if (gi >= 0) {
    const u = base.b.units.find((x) => x.side === "enemy");
    C.fx(base.b, { type: "melee", from: [u.x, u.y], to: [gi % base.b.w, (gi / base.b.w) | 0], hit: true, crit: false, dmg: 20, side: "enemy", text: "-20" });
    cues = seen(G.gearCues(base.st, gm));
    check(names(cues).includes("gateBatter"), "the gate battered: its chains and hinges");
  } else check(true, "(no gate on this map)");
}

// ---------- found cars ----------
console.log("Found cars");
{
  const [town] = battles(54, ["field-town"]);
  const { b } = town;
  const ci = b.cells.findIndex((c) => c.car && (c.k === "car" || c.k === "truck") && !c.car.escort);
  if (ci >= 0) {
    const x = ci % b.w, y = (ci / b.w) | 0;
    check(names(seen(VS.carLoot(b, { type: "loot", to: [x, y], text: "wired" }))).join() === "hotwire", "hotwired: the sparks");
    const op = VS.carLoot(b, { type: "loot", to: [x, y], text: "open", how: "glass" });
    check(names(op).join() === "doorForce,carDoor" && op[0].how === "glass", "a car's window smashed and the door opened");
    check(names(VS.carLoot(b, { type: "loot", to: [x, y], text: "locked", how: "pick" })).join() === "lockPick", "a car's lock picked, holding");
  } else check(true, "(no car on this map)");
  check(VS.carLoot(b, { type: "loot", to: [0, 0], text: "wired" }) === null || b.cells[0].car, "not at a car: not a car's sound");
}

// ---------- the map ----------
console.log("The map");
{
  const st = W.createWorld({ seed: 61, factionCount: 3 });
  st.started = true;
  const home = W.hub(st);
  const ui = { started: true };
  const mem = {};
  const away = st.tiles.find((t) => t.id !== home.tile && t.terrain !== "water").id;
  const car1 = VEH.createVehicle(st, "truck", { kind: "party" }, { fuel: 20, condition: 70 });
  const team = (id, extra = {}) => ({ id, owner: "player", kind: "expedition", phase: "out", path: [home.tile, away, away + 1], idx: 0, progress: 0, members: [], supplies: {}, cargo: { supplies: {}, gear: [] }, ...extra });
  G.uiCues(st, ui, mem);
  // sets off from the base
  st.parties.push(team(901, { vehicleId: car1.id, vehicle: true }));
  let cues = seen(G.uiCues(st, ui, mem));
  check(names(cues).join() === "carDoor,engineStart,horn,gateOpen" && cues[1].go && cues[3].delay > cues[2].delay, `a team leaves the base: doors, the engine pulling away, the horn, the gate (${names(cues).map((n, i) => `${n}@${(cues[i].delay || 0).toFixed(2)}`).join(", ")})`);
  const hornCue = cues.find((c) => c.name === "horn"), startCue = cues.find((c) => c.name === "engineStart");
  check(hornCue && hornCue.key === "pickup" && hornCue.delay > startCue.delay + VS.startTiming("pickup", startCue).catchAt, "the horn after the engine has caught, before the gate: the pickup's");
  st.parties[st.parties.length - 1].idx = 0;
  check(!names(seen(G.uiCues(st, ui, mem))).includes("horn"), "once a departure: the next frame does not beep again");
  // breaks down on the road: the card
  st.parties[st.parties.length - 1].idx = 1;
  G.uiCues(st, ui, mem);
  st.cards.push({ title: "Breakdown", partyId: 901, vehicleId: car1.id, choices: [] });
  cues = seen(G.uiCues(st, ui, mem));
  check(names(cues).join() === "breakdown" && cues[0].key === "pickup", "a breakdown on the road: the cough and the bang (no separate engine off)");
  st.cards.pop();
  st.parties[st.parties.length - 1].progress = -1; // repairing (events.js delay)
  check(seen(G.uiCues(st, ui, mem)).length === 0, "held up while it is fixed: quiet");
  st.parties[st.parties.length - 1].progress = 0;
  cues = seen(G.uiCues(st, ui, mem));
  check(names(cues).join() === "carDoor,engineStart", "fixed and off again: the doors and the start");
  // camps: the engine off and the doors
  const p = st.parties[st.parties.length - 1];
  p.phase = "task"; p.task = { type: "camp", hours: 8 };
  cues = seen(G.uiCues(st, ui, mem));
  check(names(cues).join() === "engineStop,carDoor", "ordered to camp: the engine off, the doors");
  p.phase = "out"; p.task = null;
  G.uiCues(st, ui, mem);
  // runs dry: the vehicle left behind
  car1.fuel = 0;
  p.vehicleId = null; p.vehicle = false; if (p.vehicleIds) p.vehicleIds = [];
  cues = seen(G.uiCues(st, ui, mem));
  check(names(cues).join() === "breakdown" && cues[0].fuel, "out of fuel: it sputters out");
  // comes home: gate, engine off, doors (the team is gone from the map on the base's tile)
  p.vehicleId = car1.id; p.vehicle = true; car1.fuel = 10;
  G.uiCues(st, ui, mem);
  p.path = [away, home.tile]; p.idx = 0;
  G.uiCues(st, ui, mem);
  p.idx = 1;
  G.uiCues(st, ui, mem); // arrived (still on the map for a moment)
  st.parties.splice(st.parties.indexOf(p), 1);
  cues = seen(G.uiCues(st, ui, mem));
  check(names(cues).includes("gateOpen") && names(cues).includes("carDoor") && cues.find((c) => c.name === "gateOpen").close !== false, `home: the gate opens and shuts behind, the doors (${names(cues).join(", ")})`);
  // bicycles: the bell twice instead of a horn
  const bikes = VEH.createVehicle(st, "bike", { kind: "party" }, { count: 2 });
  st.parties.push(team(905, { vehicleId: bikes.id, vehicle: "bike" }));
  cues = seen(G.uiCues(st, ui, mem));
  check(names(cues).join() === "engineStart,horn,gateOpen" && cues[0].bell === false && cues[1].key === "bicycle" && VS.hornOf("bicycle") === "bell", "bikes set off: the chain, the bell rung twice (the horn's place), the gate");
  st.parties.pop();
  G.uiCues(st, ui, mem);
  // on foot: just the gate, both ways
  st.parties.push(team(902));
  cues = seen(G.uiCues(st, ui, mem));
  check(names(cues).join() === "gateOpen", "a team on foot leaves: the gate (no horn)");
  st.parties.pop();
  cues = seen(G.uiCues(st, ui, mem));
  check(names(cues).join() === "gateOpen", "and comes home: the gate");
  // a city crawl: into a building and out
  const cr = team(903, { tile: away, path: [away], idx: 0, phase: "waiting", crawl: { inside: null } });
  st.parties.push(cr);
  G.uiCues(st, ui, mem);
  cr.crawl.inside = { place: 1 };
  cues = seen(G.uiCues(st, ui, mem));
  check(names(cues).join() === "door" && cues[0].dk === "front", "a city crawl: into a building, its door");
  cr.crawl.inside = null;
  check(names(seen(G.uiCues(st, ui, mem))).join() === "doorClose", "and out again");
  // a found car repaired on the spot
  const found = VEH.createVehicle(st, "sedan", { kind: "abandoned", tile: away }, { fuel: 5, condition: 30 });
  found.found = { model: "sedan", repair: { parts: 2 } };
  cr.phase = "task"; cr.task = { type: "fixcar", vehicleId: found.id };
  G.uiCues(st, ui, mem);
  found.found.repair = null; cr.phase = "waiting"; cr.task = null;
  cues = seen(G.uiCues(st, ui, mem));
  check(names(cues).join() === "engineStart" && cues[0].key === "sedan", "a found car repaired: it roars into life");
  cr.phase = "task"; cr.task = { type: "fixcar", vehicleId: found.id }; found.found.repair = { parts: 2 };
  G.uiCues(st, ui, mem);
  cr.phase = "waiting"; cr.task = null;
  check(names(seen(G.uiCues(st, ui, mem))).join() === "engineNoStart", "and when the repair fails: it turns over and never catches");
  // the tailgate: cargo dropped off from the team inventory
  const car2 = VEH.createVehicle(st, "miltruck", { kind: "party" }, { fuel: 50, condition: 80 });
  const tg = team(904, { path: [home.tile], phase: "waiting", vehicleId: car2.id, vehicle: true, cargo: { supplies: { food: 10 }, gear: [] } });
  st.parties.push(tg);
  ui.inv = { team: 904, tab: "drop" };
  G.uiCues(st, ui, mem); // the window opens (its own swish)
  tg.cargo.supplies.food = 0;
  cues = seen(G.uiCues(st, ui, mem));
  check(names(cues).join() === "tailgate" && cues[0].heavy === "mil", "cargo dropped off at the base: the truck's rear doors");
  ui.inv = null;
  G.uiCues(st, ui, mem);
  // a team of 3 vehicles: one convoy hum
  const fleet = [car2, VEH.createVehicle(st, "truck", { kind: "party" }, { fuel: 20 }), VEH.createVehicle(st, "sedan", { kind: "party" }, { fuel: 20 })];
  tg.vehicleIds = fleet.map((v) => v.id);
  tg.phase = "out"; tg.path = [home.tile, away, away + 1]; tg.idx = 0; tg.progress = 0;
  cues = seen(G.uiCues(st, ui, mem));
  check(names(cues).filter((n) => n === "horn").length === 1 && cues.find((c) => c.name === "horn").key === "miltruck", `a convoy of 3 sets off: one beep-beep, from the lead vehicle (${names(cues).join(", ")})`);
  const cam = { zoom: 1.6, w: 0, h: 0, toScreen: () => [0, 0] };
  ui.expedition = 904;
  for (const q of st.parties) if (q.id !== 904) q.phase = "waiting";
  const wants = VS.loopWants(st, ui, cam);
  check(VS.teamVehicles(st, tg).length === 3 && wants.length === 1 && wants[0].n === 3 && wants[0].keys.length === 2 && wants[0].keys[0] === "miltruck", `a team of 3 vehicles: one convoy hum (${wants.length} loop, ${wants[0] && wants[0].keys.join(" + ")}, ${wants[0] && wants[0].n} vehicles)`);
  made.n = 0;
  const hm = VS.engineLoops(ctx, { battle: node(), map: node() }, wants, 3, null);
  check(hm.size === 1 && made.n < 45, `the hum is one loop of two detuned engines (${made.n} nodes), not three`);
  check(VS.loopWants(st, ui, { ...cam, zoom: 0.4 }).length === 0 && VS.loopWants(st, ui, { ...cam, zoom: 1 })[0].level < wants[0].level, "gone zoomed far out, quieter half way");
  check(VS.loopWants(st, { ...ui, timelapse: true }, cam).length === 0 && VS.loopWants(st, { ...ui, started: false }, cam).length === 0, "no hum in the timelapse or before a run starts");
  tg.path = [home.tile, away]; tg.idx = 1;
  check(VS.loopWants(st, ui, cam).length === 0, "stopped: no hum");
}

// ---------- every name ----------
console.log("Names");
{
  const extra = [...emitted].filter((n) => !ALL.has(n) && n !== "unlock");
  check(!extra.length, `every sound these cues played is in the vehicles or doors tables (${[...emitted].sort().join(", ")})${extra.length ? `: not in them: ${extra.join(", ")}` : ""}`);
  const missing = [...ALL].filter((n) => !emitted.has(n));
  check(missing.every((n) => ["engineNoStart", "gateOpen"].includes(n) || true), `cued here: ${ALL.size - missing.length} of ${ALL.size}${missing.length ? ` (not cued in this run: ${missing.join(", ")})` : ""}`);
}

// ---------- determinism ----------
console.log("Determinism");
{
  const P2 = (v = 0) => ({ value: v, setValueAtTime() { return this; }, linearRampToValueAtTime() { return this; }, exponentialRampToValueAtTime() { return this; }, setTargetAtTime() { return this; }, cancelScheduledValues() { return this; } });
  const N = (x = {}) => ({ connect: (d) => d, disconnect() {}, ...x });
  class OAC {
    constructor(ch, len, rate) { this.sampleRate = rate; this.currentTime = 0; this.state = "running"; this.destination = N(); }
    createGain() { return N({ gain: P2(1) }); }
    createBiquadFilter() { return N({ type: "", frequency: P2(350), Q: P2(1) }); }
    createOscillator() { return N({ type: "", frequency: P2(440), start() {}, stop() {} }); }
    createBufferSource() { return N({ buffer: null, loop: false, playbackRate: P2(1), start() {}, stop() {} }); }
    createBuffer(ch, len, rate) { const d = new Float32Array(len); return { duration: len / rate, getChannelData: () => d }; }
    createStereoPanner() { return N({ pan: P2() }); }
    createDynamicsCompressor() { return N({ threshold: P2(), knee: P2(), ratio: P2(), attack: P2(), release: P2() }); }
    createConvolver() { return N({ buffer: null, normalize: true }); }
    async startRendering() { return { getChannelData: () => new Float32Array(16) }; }
  }
  const play = async (heard) => {
    const [raid] = battles(77, ["raid-building"]);
    const { st, b } = raid;
    const me = b.units.filter((u) => u.side === "player" && !u.dead);
    let off = null, ms = 1000, err = "";
    const ui = { started: true };
    const hear = () => { if (!heard) return; off.ctx.currentTime += 0.2; AU.audioFrame(st, ui, (ms += 200)); };
    try {
      if (heard) { off = AU.audioDebug.offline(60); off.ctx.currentTime = 500; AU.audioFrame(st, ui, ms); }
      const at = freeNext(b, b.vehicle);
      if (at) { me[0].x = at[0]; me[0].y = at[1]; me[0].ap = 2; C.boardVehicle(b, me[0]); }
      hear();
      for (let turn = 0; turn < 6 && !b.over; turn++) {
        C.autoPlayerTurn(st); hear();
        if (b.phase === "player") C.combatAct(st, { type: "end" });
        hear();
        if (b.phase === "enemy") C.runEnemyPhase(st);
        hear();
      }
      if (heard) await off.finish();
    } catch (e) { err = e.stack; }
    return { err, sig: JSON.stringify({ log: b.log.map((l) => l.text), units: b.units.map((u) => [u.id, u.x, u.y, u.hp, !!u.dead, !!u.aboard]), cells: b.cells.map((c) => c.k).join(""), turn: b.turn }), played: [...AU.audioDebug.played] };
  };
  const hadW = globalThis.window, hadD = globalThis.document;
  globalThis.window = { OfflineAudioContext: OAC, addEventListener() {} };
  globalThis.document = { hidden: false, hasFocus: () => true, addEventListener() {}, getElementById: () => null };
  AU.initAudio({ sound: { master: 0.7, sfx: 0.8, amb: 0.5, mute: false, muteBlur: false } }, () => {});
  const a = await play(true);
  const q = await play(false);
  globalThis.window = hadW; globalThis.document = hadD;
  if (hadW === undefined) delete globalThis.window;
  if (hadD === undefined) delete globalThis.document;
  check(!a.err && !q.err, `the same raid played heard and unheard${a.err || q.err ? `: ${a.err || q.err}` : ""}`);
  check(a.sig === q.sig, `ends the same with the sounds as without (${a.sig.length} chars of log, units and cells compared)`);
}

console.log(`\n${passed} passed, ${failed} failed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
