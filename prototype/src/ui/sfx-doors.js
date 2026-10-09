// Doors and gates: a building's doors in battle by kind (a wooden inner door, a heavy front door, a steel fire door, a
// cell door, a roller door rattling up, a barred door, a base's gate, a steel security door or a gun safe's), opened,
// closed, tried while locked, picked, forced (a kick, a crowbar, glass), battered or broken; a soft sound at the
// threshold of a door already open; a door eased ajar for a peek, a shoulder bracing one. On the State Map the
// base's gate (ui/sfx-vehicles.js mapCues plays it) and a building's door on a city crawl.
// Pure functions until a voice plays: node tools import it. UI only: nothing here touches the sim's dice.
//
//   DOOR_SOUNDS            the voices of this file (the mixer's "doors" group: ui/soundgroups.js can map them)
//   doorKind(b, i)         wood | front | metal | cell | roller | barred | gate | vault (the cell at index i)
//   doorCues(state, mem, fresh)  the battle's: doors opened and closed (by anyone: the sim's cells change), thresholds,
//                          peeks, braces, a gate battered, doors broken. fresh: the frame's new fx (sfx-gear.js gearCues)
//   doorLoot(b, f, rec)    a lock's fx ("loot": locked / unlocked, sim/locks.js how) at a door or a gun safe: the
//                          rattle, the picks, the kick or the crowbar, the swing (null: not a door, sfx-gear.js lootSound)
//   doorVoices(K)          the voices, on audio.js's building blocks K
import { BMAP } from "../sim/buildingmaps.js";
import { playerSees } from "../sim/combat.js";
import { panOfX } from "./sfx-out.js";

export const DOOR_SOUNDS = ["door", "doorClose", "doorRattle", "lockPick", "doorForce", "doorBreak", "threshold", "doorPeek", "doorBrace", "gateBatter", "gateOpen"];
export const DOOR_KINDS = ["wood", "front", "metal", "cell", "roller", "barred", "gate", "vault"];

// ---------- what a door is ----------
const DOORISH = new Set(["idoor", "odoor", "door", "bdoor", "doorway", "gate", "open"]);
// Buildings whose outer doors are steel (a fire door with a push bar) rather than a house's front door.
const STEEL = new Set(["warehouse", "factory", "hangar", "motorpool", "autoshop", "garage", "workshop", "machineshed", "police", "hospital", "clinic", "infirmary",
  "lab", "barracks", "armorybldg", "cellblock", "control", "radio", "terminal", "firestation", "offices", "school", "supermarket", "deptstore", "messhall", "truckstop", "gasstation"]);
const cellAt = (b, x, y) => (b && b.cells && x >= 0 && y >= 0 && x < b.w && y < b.h ? b.cells[y * b.w + x] : null);
const raidDoorAt = (b, x, y) => (b && b.raid && b.raid.doors ? b.raid.doors.find((d) => d.x === x && d.y === y && (d.f || 0) === (b.floor || 0)) : null);
// A door in the building's outer wall (sim/buildingmaps.js plan.building), else one with the outdoors on a side.
export function exteriorDoor(b, x, y) {
  const r = b && b.raid && b.raid.plan && b.raid.plan.building;
  if (r) return x === r.x0 || y === r.y0 || x === r.x0 + r.w - 1 || y === r.y0 + r.h - 1;
  let inside = false, outside = false;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const n = cellAt(b, x + dx, y + dy);
    if (!n || n.k === "wall") continue;
    if (n.f === "floor") inside = true; else outside = true;
  }
  return inside && outside;
}
export function doorKind(b, i) {
  const c = b && b.cells ? b.cells[i] : null;
  if (!c) return "wood";
  const x = i % b.w, y = (i / b.w) | 0;
  if (c.k === "gate") return "gate";
  if (c.k === "bdoor") return "barred";
  if (c.roll) return "roller";
  const rd = raidDoorAt(b, x, y);
  if ((rd && rd.lock && rd.lock.kind === "vault") || c.mhp >= BMAP.DOOR.vault) return "vault";
  if (c.mhp === BMAP.DOOR.cell) return "cell";
  if (exteriorDoor(b, x, y)) return STEEL.has(b.raid && b.raid.interior ? b.raid.interior.key : "") ? "metal" : "front";
  return "wood";
}
// Where a door is heard: an inner door in the tight room, an outer one with the town's slapback.
const roomOfDoor = (b, x, y) => (b && b.raid && b.raid.interior ? (exteriorDoor(b, x, y) ? "town" : "inside") : null);

// ---------- the battle ----------
// mem: kept by the caller. A battle (or a floor, or a new map of the same battle) first seen is quiet.
const cue = (b, name, x, y, o = {}) => ({ name, at: [x, y], pan: panOfX(b, x), enemy: true, ...(roomOfDoor(b, x, y) ? { room: roomOfDoor(b, x, y) } : {}), ...o });
function seed(b, mem) {
  mem.cells = b.cells;
  mem.map = new Map(); // index -> { k, held, bar }
  if (b.cells) for (let i = 0; i < b.cells.length; i++) { const c = b.cells[i]; if (c && DOORISH.has(c.k) && c.k !== "open") mem.map.set(i, { k: c.k, held: c.held ?? null, bar: c.bar }); }
  mem.peeks = (b.peeks || []).length;
  mem.passed = new Map(); // door index -> the turn someone last went through it (the threshold: the first one through)
}
export const MAX_DOOR_CUES = 4;
export function doorCues(state, mem, fresh = []) {
  const b = state && state.combat;
  const out = [];
  if (!b || !b.cells) return out;
  if (mem.battle !== b || mem.cells !== b.cells) { mem.battle = b; seed(b, mem); return out; }
  const turnKey = `${b.turn}:${b.phase}`;
  // Who went through which cell this frame (a move's path): the delay along the slide (70 ms a cell), the mover.
  const through = new Map();
  const unitOf = (id) => b.units.find((u) => u.id === id);
  for (const f of fresh) {
    if (f.type !== "move" || !f.path) continue;
    for (let i = 0; i < f.path.length; i++) {
      const [x, y] = f.path[i], k = y * b.w + x;
      if (!through.has(k)) through.set(k, { delay: (i * 70) / 1000, u: unitOf(f.unit) });
    }
  }
  const handled = mem.handled || new Set();
  mem.handled = new Set();
  const heard = (u) => !u || u.side === "player" || (() => { try { return playerSees(b, u); } catch { return true; } })();
  // The cells' doors: what changed since the last frame.
  for (const [i, was] of mem.map) {
    const c = b.cells[i];
    if (!c) continue;
    const x = i % b.w, y = (i / b.w) | 0;
    const now = { k: c.k, held: c.held ?? null, bar: c.bar };
    if (now.k !== was.k) {
      const t = through.get(i), dk = doorKind(b, i);
      if ((was.k === "idoor" || was.k === "door") && (now.k === "odoor" || now.k === "open")) {
        // opened: by someone walking into it (sim/combat.js openDoor), or a lock that gave (doorLoot played its part first)
        out.push(cue(b, "door", x, y, { dk, delay: handled.has(i) ? 0.35 : t ? t.delay : 0, ...(t && t.u && t.u.side === "player" ? { enemy: false } : {}) }));
        mem.passed.set(i, turnKey);
      } else if (was.k === "odoor" && now.k === "idoor") out.push(cue(b, "doorClose", x, y, { dk })); // closed (buildingmaps.js doorAct "close")
      else if (now.k === "doorway") out.push(cue(b, "doorBreak", x, y, { dk, layer: fresh.some((f) => f.type === "melee" && f.to && f.to[0] === x && f.to[1] === y) })); // broken in
    } else if (now.k === "gate" && was.bar && !now.bar) out.push(cue(b, "doorBreak", x, y, { dk: "gate" })); // the gate gives way
    else if (now.held != null && was.held == null && (now.k === "idoor" || now.k === "door")) out.push(cue(b, "doorBrace", x, y, { dk: doorKind(b, i), enemy: false })); // braced with a shoulder
    // Through a door already open: a soft threshold sound, only for the first one through this turn.
    if (now.k === was.k && (now.k === "odoor" || now.k === "doorway") && through.has(i) && mem.passed.get(i) !== turnKey) {
      const t = through.get(i);
      mem.passed.set(i, turnKey);
      if (heard(t.u)) out.push(cue(b, "threshold", x, y, { dk: doorKind(b, i), delay: t.delay, ...(t.u && t.u.side === "player" ? { enemy: false } : {}) }));
    }
    mem.map.set(i, now);
  }
  // A peek through a closed door (buildingmaps.js doorAct "peek"): the door eased ajar.
  const peeks = b.peeks || [];
  if (peeks.length > mem.peeks) {
    const p = peeks[peeks.length - 1], c = cellAt(b, p.dx, p.dy);
    if (c && c.k === "idoor") out.push(cue(b, "doorPeek", p.dx, p.dy, { dk: doorKind(b, p.dy * b.w + p.dx), enemy: false }));
  }
  mem.peeks = peeks.length;
  // The gate battered (sim/combat.js bash on a gate cell): the chains and hinges under the blow (ui/sfx-melee.js has the blow).
  for (const f of fresh) if (f.type === "melee" && f.to && f.hit) {
    const c = cellAt(b, f.to[0], f.to[1]);
    if (c && c.k === "gate") out.push(cue(b, "gateBatter", f.to[0], f.to[1], { broke: f.text === "BROKEN" }));
  }
  return out.slice(0, MAX_DOOR_CUES);
}
// A lock's fx at a door, a gun safe or a steel cabinet (sim/locks.js openLock / openSafe: f.text "locked" or
// "unlocked", f.how the method). mem: doorCues' memory (marks the door so its swing follows the lock's sound).
const SAFE_KINDS = new Set(["safe", "cage"]);
export function doorLoot(b, f, mem = null) {
  if (!b || !f || f.type !== "loot" || !f.to) return null;
  const [x, y] = f.to, t = String(f.text || "");
  if (t !== "locked" && t !== "unlocked") return null;
  const c = cellAt(b, x, y), rd = raidDoorAt(b, x, y);
  const atDoor = !!rd || (c && (c.k === "door" || c.k === "idoor"));
  const box = !atDoor && b.raid ? (b.raid.containers || []).find((q) => q.lock && q.x === x && q.y === y && (q.f || 0) === (b.floor || 0)) : null;
  const safe = !!(box && box.lock && (SAFE_KINDS.has(box.lock.kind) || box.lock.tier > 0));
  if (!atDoor && !safe) return null;
  const ok = t === "unlocked", how = f.how || null;
  const dk = atDoor ? (rd && rd.lock && rd.lock.kind === "vault" ? "vault" : doorKind(b, y * b.w + x)) : "vault";
  if (atDoor && mem && mem.map && ok) (mem.handled || (mem.handled = new Set())).add(y * b.w + x);
  const base = { at: [x, y], pan: panOfX(b, x), dk, ok };
  const out = [];
  if (how === "pick") out.push({ name: "lockPick", ...base });
  else if (how === "pry" || how === "kick" || how === "glass" || how === "smash" || how === "force") out.push({ name: "doorForce", ...base, how: how === "smash" || how === "force" ? "kick" : how });
  else if (how === "drill" || how === "grind" || how === "blow") return null; // the drill and the charge have their own sounds (sfx-gear.js lootSound, blasts)
  else if (!ok) out.push({ name: "doorRattle", ...base }); // tried, and it holds
  else out.push({ name: "unlock", at: [x, y], pan: base.pan }); // a key, a combination, a bypass
  if (ok && safe) out.push({ name: "door", ...base, dk: "vault", delay: 0.4 }); // the safe's door swings open (a door's swing comes with the cell: doorCues)
  return out;
}

// ---------- the voices ----------
export const DOOR_LEVEL = 1; // × every door voice (tools/vdpreview measures it against a 9 mm shot and a footstep)
// Each kind's swing levelled (tools/vdpreview, the loudest 50 ms at the game's level): opening from about −31 dB (a
// wooden inner door, level with a footstep) to −24 (a roller door's racket), shutting a few dB over that, a 9 mm
// shot near you about −19.
const SWING = {
  open: { wood: 10.7, front: 6, metal: 1.9, cell: 0.6, roller: 1.4, barred: 0.93, gate: 5.5, vault: 1.4 },
  close: { wood: 1, front: 0.6, metal: 0.65, cell: 0.62, roller: 0.69, barred: 0.49, gate: 0.38, vault: 0.4 },
};
export function doorVoices(K) {
  const { env, filt, noise, tone, thud, bell, crackle, shards, lfo, R } = K;
  const tick = (c, out, t, f, g, d = 0.012, q = 3) => noise(c, "white", t, d + 0.01, filt(c, "bandpass", f, q, env(c, out, t, g, d, 0.001)));
  // A hinge: a sawtooth's buzz through a narrow band, wobbling (the stick-slip of the pin).
  const creak = (c, out, t, f0, f1, dur, band, g, wob = 22, rate = 17, q = 7) => {
    const v = tone(c, "sawtooth", f0, f1, t, dur, filt(c, "bandpass", band, q, env(c, out, t, g, dur * 0.65, dur * 0.18, dur * 0.12)));
    lfo(c, rate, wob, v.frequency).stop(t + dur + 0.05);
  };
  const air = (c, out, t, dur, f, g) => noise(c, "brown", t, dur, filt(c, "bandpass", f, 0.8, env(c, out, t, g, dur * 0.6, dur * 0.3)));
  const chain = (c, out, t, span, n, g) => { for (let i = 0; i < n; i++) { const tt = t + R(0, span); tick(c, out, tt, R(2600, 5200), g * R(0.4, 1), R(0.008, 0.02), 4); } };
  const clank = (c, out, t, f, g, d = 0.5) => { bell(c, out, t, f, g * 0.5, d); tick(c, out, t, 1400, g, 0.02, 2); };
  const slats = (c, out, t, dur, rate0, rate1, g) => { // a roller door's slats running over each other
    let tt = t, rate = rate0;
    for (let i = 0; tt < t + dur && i < 80; i++) { tick(c, out, tt, R(1300, 2600), g * R(0.5, 1), 0.012, 3); rate = rate0 + (rate1 - rate0) * ((tt - t) / dur); tt += 1 / rate; }
  };
  // The swing of each kind of door, open (o.close false) or shut.
  function swing(c, out, t, o, shut) {
    const dk = SWING.open[o.dk] ? o.dk : "wood", g = (o.gain ?? 1) * DOOR_LEVEL * SWING[shut ? "close" : "open"][dk], p = o.pitch || 1;
    switch (dk) {
      case "front":
        if (!shut) { tick(c, out, t, 1500 * p, 0.3 * g, 0.02); tick(c, out, t + 0.08, 2100 * p, 0.22 * g); creak(c, out, t + 0.12, R(80, 100) * p, R(110, 140), 0.5, 850, 0.06 * g); air(c, out, t + 0.1, 0.45, 300, 0.06 * g); }
        else { air(c, out, t, 0.25, 350, 0.06 * g); thud(c, out, t + 0.22, 85 * p, 0.42 * g, 0.16); tick(c, out, t + 0.23, 1300 * p, 0.25 * g, 0.02); }
        break;
      case "metal": // a steel fire door: the push bar, the closer's hiss, the ring of the frame
        if (!shut) { tick(c, out, t, 1200 * p, 0.32 * g, 0.02, 2); bell(c, out, t, 520 * p, 0.05 * g, 0.35); creak(c, out, t + 0.1, R(60, 75) * p, R(80, 95), 0.45, 520, 0.05 * g, 10, 9); noise(c, "white", t + 0.15, 0.6, filt(c, "bandpass", 3200, 1.5, env(c, out, t + 0.15, 0.025 * g, 0.4, 0.15))); }
        else { noise(c, "white", t, 0.5, filt(c, "bandpass", 3000, 1.5, env(c, out, t, 0.03 * g, 0.35, 0.1))); thud(c, out, t + 0.45, 95 * p, 0.38 * g, 0.12); clank(c, out, t + 0.46, 430 * p, 0.2 * g, 0.6); tick(c, out, t + 0.47, 1100, 0.22 * g, 0.02); }
        break;
      case "cell": // barred steel: the clank, the bars rattling in the frame
        clank(c, out, t, 310 * p, 0.32 * g, 0.7);
        chain(c, out, t + 0.05, 0.25, 5, 0.1 * g);
        if (!shut) creak(c, out, t + 0.1, 70 * p, 90, 0.5, 600, 0.05 * g, 12, 11); else { thud(c, out, t, 120, 0.25 * g, 0.1); clank(c, out, t + 0.02, 740 * p, 0.12 * g, 0.4); }
        break;
      case "roller": // up: the slats rattling faster and the top clunk; down: rattling and the bang at the bottom
        noise(c, "brown", t, 1.4, filt(c, "bandpass", 500, 0.9, env(c, out, t, 0.08 * g, 1.1, 0.12, 0.2)));
        slats(c, out, t, 1.3, shut ? 30 : 16, shut ? 18 : 34, 0.14 * g);
        if (!shut) { thud(c, out, t + 1.32, 140, 0.2 * g, 0.12); clank(c, out, t + 1.33, 260, 0.12 * g, 0.5); }
        else { thud(c, out, t + 1.3, 75, 0.45 * g, 0.2); clank(c, out, t + 1.31, 210, 0.25 * g, 0.8); }
        break;
      case "barred": // a base building's door: the bar lifted out of its brackets, a heavy creak
        if (!shut) { thud(c, out, t, 160 * p, 0.22 * g, 0.08); noise(c, "white", t + 0.08, 0.2, filt(c, "bandpass", 1100, 1.2, env(c, out, t + 0.08, 0.06 * g, 0.15, 0.04))); creak(c, out, t + 0.3, R(55, 70) * p, R(80, 95), 0.7, 650, 0.07 * g); }
        else { thud(c, out, t, 80 * p, 0.45 * g, 0.18); thud(c, out, t + 0.3, 150, 0.2 * g, 0.08); }
        break;
      case "gate": // a base's gate: the chain and the bolt, the long heavy creak; shut, the boom and the bolt home
        if (!shut) { chain(c, out, t, 0.4, 9, 0.13 * g); noise(c, "white", t + 0.35, 0.25, filt(c, "bandpass", 1600, 1.4, env(c, out, t + 0.35, 0.07 * g, 0.18, 0.05))); creak(c, out, t + 0.6, R(44, 52) * p, R(62, 72), 1.5, 420, 0.1 * g, 16, 7, 5); air(c, out, t + 0.7, 1.4, 160, 0.08 * g); }
        else { creak(c, out, t, 60 * p, 48, 0.9, 380, 0.07 * g, 14, 7, 5); thud(c, out, t + 0.85, 62 * p, 0.55 * g, 0.3); chain(c, out, t + 0.9, 0.3, 6, 0.1 * g); noise(c, "white", t + 1.15, 0.2, filt(c, "bandpass", 1500, 1.4, env(c, out, t + 1.15, 0.07 * g, 0.12, 0.03))); tick(c, out, t + 1.32, 900, 0.25 * g, 0.03, 2); }
        break;
      case "vault": // a steel security door or a gun safe: the bolts, the heavy hinge, the ring of the steel
        if (!shut) { for (let i = 0; i < 3; i++) { thud(c, out, t + i * 0.12, 150 * p, 0.2 * g, 0.06); tick(c, out, t + i * 0.12, 1700, 0.16 * g, 0.015, 2); } creak(c, out, t + 0.45, R(38, 44) * p, R(50, 58), 1.1, 300, 0.09 * g, 8, 6, 4); bell(c, out, t + 0.4, 210 * p, 0.04 * g, 1.4); }
        else { thud(c, out, t, 60 * p, 0.6 * g, 0.35); bell(c, out, t, 180 * p, 0.08 * g, 1.6); for (let i = 0; i < 3; i++) tick(c, out, t + 0.35 + i * 0.1, 1500, 0.15 * g, 0.015, 2); }
        break;
      default: // wood: an inner door, the latch and a creaking hinge; shut, the soft swing and the latch
        if (!shut) { tick(c, out, t, 1800 * p, 0.2 * g, 0.015); creak(c, out, t + 0.04, R(95, 130) * p, R(140, 180), 0.42, 1100, 0.07 * g); }
        else { air(c, out, t, 0.2, 420, 0.04 * g); thud(c, out, t + 0.18, 120 * p, 0.25 * g, 0.08); tick(c, out, t + 0.19, 1700 * p, 0.2 * g, 0.015); }
    }
  }
  return {
    // A door opening, by its kind (o.dk); the base's gate on the map (gateOpen) opens and shuts behind (o.close).
    door: { dur: 0.6, play(c, out, t, o) { swing(c, out, t, o, false); } },
    doorClose: { dur: 0.6, play(c, out, t, o) { swing(c, out, t, o, true); } },
    // A locked door tried: the handle jiggled, the door knocking in its frame.
    doorRattle: { dur: 0.45, play(c, out, t, o) {
      const g = (o.gain ?? 1) * DOOR_LEVEL * 2;
      for (let i = 0; i < 4; i++) tick(c, out, t + i * 0.07 + R(0, 0.012), R(1800, 2600) * (o.pitch || 1), 0.2 * g);
      thud(c, out, t + 0.05, o.dk === "metal" || o.dk === "vault" ? 140 : 110, 0.15 * g, 0.05);
      thud(c, out, t + 0.2, o.dk === "metal" || o.dk === "vault" ? 140 : 110, 0.13 * g, 0.05);
      if (o.dk === "metal" || o.dk === "vault") bell(c, out, t + 0.05, 480, 0.03 * g, 0.3);
    } },
    // Lockpicks: the pins, the tension wrench's scrape; a lock that gives, the click and the turn.
    lockPick: { dur: 1, play(c, out, t, o) {
      const g = (o.gain ?? 1) * DOOR_LEVEL * 2.5;
      noise(c, "white", t, 0.75, filt(c, "bandpass", 5200, 3, env(c, out, t, 0.02 * g, 0.5, 0.1, 0.1)));
      let tt = t + 0.05;
      for (let i = 0; i < 9; i++) { tick(c, out, tt, R(3600, 6200), R(0.06, 0.13) * g, 0.006, 6); tt += R(0.05, 0.11); }
      if (o.ok) { tick(c, out, tt + 0.05, 1700, 0.24 * g, 0.015); tick(c, out, tt + 0.16, 1100, 0.26 * g, 0.02); tone(c, "sine", 850, 600, tt + 0.16, 0.05, env(c, out, tt + 0.16, 0.05 * g, 0.04, 0.001)); }
    } },
    // Forcing it: o.how kick (two kicks, splinters if it gives), pry (the bar seated, the strain, the crunch; steel
    // shrieks), glass (a car's window shattered).
    doorForce: { dur: 1, play(c, out, t, o) {
      const g = (o.gain ?? 1) * DOOR_LEVEL * 0.8, steel = o.dk === "metal" || o.dk === "vault" || o.dk === "cell" || o.dk === "roller";
      if (o.how === "glass") {
        thud(c, out, t, 140, 0.3 * g, 0.06);
        if (o.ok) { shards(c, out, t + 0.02, 14, 0.12 * g); crackle(c, out, t + 0.05, 10, 0.35, 0.08 * g); } else { tick(c, out, t + 0.01, 2400, 0.2 * g, 0.03, 2); }
      } else if (o.how === "pry") {
        tick(c, out, t, 2100, 0.2 * g, 0.015, 2); bell(c, out, t, 880, 0.04 * g, 0.25);
        if (steel) { const v = tone(c, "sawtooth", 900, 2300, t + 0.18, 0.55, filt(c, "bandpass", 1900, 6, env(c, out, t + 0.18, 0.06 * g, 0.4, 0.12))); lfo(c, 31, 60, v.frequency).stop(t + 0.8); }
        else creak(c, out, t + 0.15, 120, 260, 0.5, 1400, 0.08 * g, 30, 23);
        if (o.ok) { crackle(c, out, t + 0.62, 14, 0.18, 0.14 * g); thud(c, out, t + 0.62, steel ? 130 : 95, 0.4 * g, 0.12); noise(c, "brown", t + 0.62, 0.2, filt(c, "lowpass", 700, 0.7, env(c, out, t + 0.62, 0.3 * g, 0.15, 0.003))); if (steel) bell(c, out, t + 0.63, 340, 0.08 * g, 0.7); }
      } else { // kick
        for (let i = 0; i < 2; i++) { const tt = t + i * 0.42; thud(c, out, tt, steel ? 120 : 88, 0.55 * g, 0.14); noise(c, "white", tt, 0.08, filt(c, "bandpass", steel ? 900 : 1300, 1, env(c, out, tt, 0.12 * g, 0.06, 0.002))); if (steel) bell(c, out, tt, 300, 0.07 * g, 0.5); }
        if (o.ok) { crackle(c, out, t + 0.45, 18, 0.25, 0.16 * g); noise(c, "white", t + 0.45, 0.4, filt(c, "bandpass", 2400, 0.9, env(c, out, t + 0.45, 0.1 * g, 0.3, 0.003))); }
      }
    } },
    // A door broken in (battered or shot down): splinters and the door going down; steel shrieks and clangs. o.layer:
    // the blow itself already played (ui/sfx-melee.js), only what follows.
    doorBreak: { dur: 1.2, play(c, out, t, o) {
      const g = (o.gain ?? 1) * DOOR_LEVEL * 0.8, dk = o.dk || "wood";
      const steel = dk === "metal" || dk === "vault" || dk === "cell" || dk === "roller";
      const t1 = o.layer ? t + 0.05 : t;
      if (!o.layer) { thud(c, out, t, steel ? 110 : 80, 0.55 * g, 0.18); noise(c, "white", t, 0.1, filt(c, "bandpass", 1200, 0.9, env(c, out, t, 0.18 * g, 0.08, 0.002))); }
      if (steel) { const v = tone(c, "sawtooth", 1500, 700, t1 + 0.04, 0.4, filt(c, "bandpass", 1300, 5, env(c, out, t1 + 0.04, 0.05 * g, 0.3, 0.02))); lfo(c, 37, 40, v.frequency).stop(t1 + 0.5); bell(c, out, t1 + 0.35, 190, 0.1 * g, 0.9); bell(c, out, t1 + 0.38, 410, 0.06 * g, 0.6); }
      else if (dk === "gate") { crackle(c, out, t1, 16, 0.3, 0.14 * g); chain(c, out, t1 + 0.1, 0.6, 12, 0.12 * g); thud(c, out, t1 + 0.5, 55, 0.5 * g, 0.35); }
      else { crackle(c, out, t1, 20, 0.3, 0.13 * g); noise(c, "white", t1, 0.35, filt(c, "bandpass", 2500, 0.9, env(c, out, t1, 0.08 * g, 0.28, 0.003))); }
      thud(c, out, t1 + 0.42, steel ? 95 : 70, 0.4 * g, 0.2); // it comes down
      crackle(c, out, t1 + 0.45, 6, 0.3, 0.06 * g);
    } },
    // Through a door already open (the first one through): a creak of the frame, a step on the sill. Soft.
    threshold: { dur: 0.3, play(c, out, t, o) {
      const g = (o.gain ?? 1) * DOOR_LEVEL * 1.6;
      if (o.dk === "metal" || o.dk === "vault" || o.dk === "roller" || o.dk === "cell") { tick(c, out, t, 900, 0.07 * g, 0.02, 2); bell(c, out, t, 360, 0.012 * g, 0.25); }
      else { creak(c, out, t, R(150, 190), R(200, 240), 0.16, 950, 0.025 * g, 25, 21); thud(c, out, t + 0.02, 160, 0.08 * g, 0.04); }
    } },
    // A door eased ajar to peek through: the latch held back, a slow, quiet creak.
    doorPeek: { dur: 0.6, play(c, out, t, o) {
      const g = (o.gain ?? 1) * DOOR_LEVEL * 5;
      tick(c, out, t, 1900, 0.06 * g, 0.012);
      creak(c, out, t + 0.06, R(70, 90), R(95, 115), 0.5, 950, 0.03 * g, 14, 9);
    } },
    // A shoulder against a door, bracing it: the thump, the door rattling in its frame.
    doorBrace: { dur: 0.35, play(c, out, t, o) {
      const g = (o.gain ?? 1) * DOOR_LEVEL * 0.75;
      thud(c, out, t, 100, 0.35 * g, 0.1);
      noise(c, "brown", t, 0.08, filt(c, "lowpass", 500, 0.7, env(c, out, t, 0.2 * g, 0.06, 0.002)));
      for (let i = 0; i < 3; i++) tick(c, out, t + 0.03 + i * 0.04, R(1500, 2200), 0.07 * g, 0.012);
    } },
    // The gate battered: its chains and hinges jumping under the blow (the blow itself: ui/sfx-melee.js).
    gateBatter: { dur: 0.6, play(c, out, t, o) {
      const g = (o.gain ?? 1) * DOOR_LEVEL * 0.6;
      chain(c, out, t + 0.01, 0.35, 10, 0.14 * g);
      thud(c, out, t, 58, 0.35 * g, 0.25);
      creak(c, out, t + 0.05, 48, 40, 0.3, 360, 0.05 * g, 10, 8, 5);
    } },
    // A base's gate on the map (ui/sfx-vehicles.js mapCues): it opens, and (o.close, the default) shuts behind after
    // o.hold s. o.dk: gate (a palisade's), steel (a reinforced wall's: heavier, metal), front (no wall: the front door).
    gateOpen: { dur: 4.5, play(c, out, t, o) {
      const dk = o.dk === "front" ? "front" : "gate";
      const steel = o.dk === "steel";
      swing(c, out, t, { ...o, dk, pitch: steel ? 0.85 : 1 }, false);
      if (steel) { bell(c, out, t + 0.6, 170, 0.04 * (o.gain ?? 1), 1.6); noise(c, "white", t + 0.6, 1.2, filt(c, "bandpass", 2400, 6, env(c, out, t + 0.6, 0.02 * (o.gain ?? 1), 0.9, 0.2))); }
      if (o.close !== false) {
        const tc = t + (o.hold ?? (dk === "front" ? 1.2 : 2.6));
        swing(c, out, tc, { ...o, dk, pitch: steel ? 0.85 : 1 }, true);
        if (steel) bell(c, out, tc + 0.85, 150, 0.06 * (o.gain ?? 1), 1.6);
      }
    } },
  };
}
export const DOOR_LABELS = {
  door: "A door opening (by kind)", doorClose: "A door closing", doorRattle: "A locked door tried", lockPick: "Picking a lock", doorForce: "Forcing a door (kick, crowbar, glass)",
  doorBreak: "A door broken in", threshold: "Through an open door", doorPeek: "A door eased ajar (peek)", doorBrace: "Bracing a door", gateBatter: "The gate battered", gateOpen: "A base's gate (map)",
};
// The throttle's limits (ui/audio.js LIMITS): gap in seconds between two starts, how many at once.
export const DOOR_LIMITS = {
  door: { gap: 0.15, max: 3 }, doorClose: { gap: 0.15, max: 2 }, doorRattle: { gap: 0.3, max: 1 }, lockPick: { gap: 0.5, max: 1 }, doorForce: { gap: 0.4, max: 1 },
  doorBreak: { gap: 0.3, max: 2 }, threshold: { gap: 0.25, max: 2 }, doorPeek: { gap: 0.3, max: 1 }, doorBrace: { gap: 0.3, max: 1 }, gateBatter: { gap: 0.2, max: 2 }, gateOpen: { gap: 2, max: 1 },
};
