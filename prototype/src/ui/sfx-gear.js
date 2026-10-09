// The rest of the battle's and the interface's small sounds (not guns, not the dead's voices): searching a container,
// a lock, keys, fuel; a bandage; a door swinging open; your vehicle driving in battle; a team's engine starting or
// stopping on the map; a window opening and closing; an item picked up and put down in the inventory.
// Pure functions until a voice plays: node tools import it.
//
//   lootSound(text)           the sound of a search or a lock by its effect's text (sim fx type "loot")
//   gearCues(state, mem)      the battle's: loot, heal, doors opened by a move, the vehicle driven
//   uiCues(state, ui, mem)    the interface's and the map's: windows, the inventory's held item, engines
//   clickSound(el)            the sound of a button press (null: none, another cue covers it)
//   gearVoices(K)             the voices, built on audio.js's building blocks K
import { itemAt } from "../sim/inventory.js";
import { GEAR } from "../sim/data.js";
import { partyVehicle, isBike } from "../sim/vehicles.js";
import { panOfX } from "./sfx-out.js";

// ---------- battle ----------
export function lootSound(text) {
  const t = String(text || "");
  if (/fuel/.test(t)) return { name: "glug" };
  if (/^\+/.test(t)) return { name: "rummage", found: true };
  if (/^(empty|nothing|nothing yet|no keys)$/.test(t)) return { name: "rummage" };
  if (/^locked$|^\d+\/\d+$/.test(t)) return { name: "lockRattle" };
  if (/^keys!$/.test(t)) return { name: "jingle" };
  if (/^(unlocked|open|case open|cut!|cut free|free|wired|claimed)$/.test(t)) return { name: "unlock" };
  return null; // DEAF, RISES, WORMS, SLEEPER, PANIC, WINDS UP…: not a search (their sounds are elsewhere)
}
const DOORS = new Set(["idoor", "bdoor"]);
export function gearCues(state, mem) {
  const b = state && state.combat;
  const out = [];
  if (!b || !b.fx) return out;
  if (mem.battle !== b) {
    mem.battle = b;
    mem.seq = b.fxSeq || 0;
    mem.doors = new Map(); // floor -> the cells that were closed doors when first seen
    mem.veh = b.vehicle ? `${b.vehicle.x},${b.vehicle.y}` : null;
    doorsOf(b, mem);
    return out;
  }
  const fresh = b.fx.filter((f) => f.seq > mem.seq);
  if (fresh.length) mem.seq = fresh[fresh.length - 1].seq;
  const doors = doorsOf(b, mem);
  for (const f of fresh) {
    if (f.type === "loot") {
      const s = lootSound(f.text);
      if (s) out.push({ ...s, at: f.to, pan: panOfX(b, f.to && f.to[0]) });
    } else if (f.type === "heal") out.push({ name: f.self ? "tourniquet" : "bandage", at: f.to, pan: panOfX(b, f.to && f.to[0]), ...(f.self ? { ok: f.ok !== false } : {}) }); // f.self: a downed one's own tourniquet or trauma kit (sim/medics.js selfStabilize)
    else if (f.type === "move" && f.path && doors.size) {
      // A closed door the mover walked through has swung open (buildingmaps.js openDoor): heard once a door.
      for (let i = 0; i < f.path.length; i++) {
        const [x, y] = f.path[i], k = y * b.w + x;
        if (!doors.has(k) || DOORS.has((b.cells[k] || {}).k)) continue;
        doors.delete(k);
        out.push({ name: "door", delay: (i * 70) / 1000, at: [x, y], enemy: true, pan: panOfX(b, x) });
      }
    }
  }
  // Your vehicle driven across the field (combat.js driveTo): the engine revs.
  if (b.vehicle) {
    const at = `${b.vehicle.x},${b.vehicle.y}`;
    if (mem.veh && at !== mem.veh && !b.vehicle.blownUp) out.push({ name: "drive", big: !!b.vehicle.mil, at: [b.vehicle.x, b.vehicle.y], pan: panOfX(b, b.vehicle.x) });
    mem.veh = at;
  }
  return out;
}
function doorsOf(b, mem) {
  const fl = b.floor || 0;
  let s = mem.doors.get(fl);
  if (!s) {
    s = new Set();
    if (b.cells) for (let i = 0; i < b.cells.length; i++) if (DOORS.has(b.cells[i].k)) s.add(i);
    mem.doors.set(fl, s);
  }
  return s;
}

// ---------- the interface and the map ----------
// The windows whose opening and closing is heard (main.js freshUi): a soft swish up, and down.
export const WINDOW_KEYS = ["inv", "settings", "codex", "ledger", "radioWith", "bgEditor", "caravanPlan", "ask"];
// What an item sounds like in the hand: a gun or a blade (metal), something worn (cloth and straps), anything else.
export function itemKind(it) {
  const key = it && (it.key || it.k || it.item);
  const g = key ? GEAR[key] : null;
  if (!g) return "item";
  if (g.slot === "weapon" || g.cat === "gunmod" || g.cat === "ammo") return g.cat === "melee" ? "blade" : "gun";
  if (["armor", "head", "arms", "legs", "backpack"].includes(g.slot)) return "cloth";
  return "item";
}
export function uiCues(state, ui, mem) {
  const out = [];
  if (!ui) return out;
  const first = !mem.seen;
  mem.seen = true;
  // Windows.
  const open = WINDOW_KEYS.filter((k) => ui[k]).join();
  if (!first && open !== mem.open) {
    const was = new Set((mem.open || "").split(",").filter(Boolean)), now = new Set(open.split(",").filter(Boolean));
    if ([...now].some((k) => !was.has(k))) out.push({ name: "uiOpen" });
    else if ([...was].some((k) => !now.has(k))) out.push({ name: "uiClose" });
  }
  mem.open = open;
  // The inventory: an item picked up (ui.invSel set), put down (cleared while the window stays open).
  const sel = ui.inv ? ui.invSel || null : null;
  if (!first && sel !== (mem.sel ?? null) && ui.inv) {
    if (sel) {
      let it = null;
      try { it = itemAt(state, sel); } catch { it = null; }
      mem.held = itemKind(it);
      out.push({ name: "pickup", kind: mem.held });
    } else if (mem.sel) out.push({ name: "putdown", kind: mem.held || "item" });
  }
  mem.sel = sel;
  // The map: one of your teams in a car or truck setting off, or arriving (sim/parties.js path, idx).
  if (state && state.parties && !ui.timelapse && !state.combat) {
    const moving = new Map();
    for (const p of state.parties) {
      if (p.owner !== "player" || !p.vehicleId) continue;
      let v = null;
      try { v = partyVehicle(state, p); } catch { v = null; }
      if (!v || isBike(v) || v.destroyed) continue;
      moving.set(p.id, !!(p.path && p.path.length > 1 && (p.idx || 0) < p.path.length - 1));
    }
    if (!first && mem.cars && ui.started) {
      for (const [id, m] of moving) {
        const was = mem.cars.get(id);
        if (was === false && m) out.push({ name: "engineStart" });
        else if (was === true && !m) out.push({ name: "engineStop" });
      }
    }
    mem.cars = moving;
  }
  return out;
}
// A button press: the soft click, except where the state's own cue says it (an inventory cell: pick up / put down).
export function clickSound(el) {
  const a = el && el.dataset ? el.dataset.action : null;
  if (a === "inv-click") return null;
  return "click";
}

// ---------- the voices ----------
export function gearVoices(K) {
  const { env, filt, noise, tone, crackle, R } = K;
  const tick = (c, out, t, f, g, d = 0.012, q = 3) => noise(c, "white", t, d + 0.01, filt(c, "bandpass", f, q, env(c, out, t, g, d, 0.001)));
  // Hands in a box or a bag: a few rustles and knocks.
  function rummage(c, out, t, o) {
    const n = 4;
    for (let i = 0; i < n; i++) {
      const tt = t + i * R(0.06, 0.1);
      noise(c, "white", tt, 0.06, filt(c, "bandpass", R(900, 2600) * o.pitch, 1.2, env(c, out, tt, R(0.08, 0.16) * o.gain, 0.05, 0.008)));
    }
    tick(c, out, t + R(0.1, 0.2), 900, 0.15 * o.gain, 0.02, 4);
    if (o.found) { tone(c, "sine", 1150, 0, t + 0.38, 0.06, env(c, out, t + 0.38, 0.05 * o.gain, 0.05, 0.003)); tick(c, out, t + 0.38, 1600, 0.12 * o.gain); }
    else tone(c, "triangle", 260, 200, t + 0.36, 0.08, env(c, out, t + 0.36, 0.08 * o.gain, 0.07, 0.002)); // a hollow knock: nothing in it
  }
  return {
    rummage: { dur: 0.5, play: rummage },
    lockRattle: { dur: 0.35, play(c, out, t, o) {
      for (let i = 0; i < 4; i++) tick(c, out, t + i * 0.055 + R(0, 0.01), R(2600, 3400) * o.pitch, 0.18 * o.gain);
      tone(c, "sine", 180, 120, t + 0.24, 0.05, env(c, out, t + 0.24, 0.15 * o.gain, 0.04, 0.002));
    } },
    unlock: { dur: 0.25, play(c, out, t, o) {
      tick(c, out, t, 2400 * o.pitch, 0.22 * o.gain);
      tick(c, out, t + 0.09, 1500 * o.pitch, 0.28 * o.gain, 0.02);
      tone(c, "sine", 900, 600, t + 0.09, 0.05, env(c, out, t + 0.09, 0.06 * o.gain, 0.04, 0.001));
    } },
    jingle: { dur: 0.4, play(c, out, t, o) {
      for (let i = 0; i < 5; i++) { const tt = t + R(0, 0.25); tone(c, "sine", R(3200, 5200), 0, tt, 0.08, env(c, out, tt, 0.05 * o.gain, R(0.04, 0.08), 0.001)); }
    } },
    glug: { dur: 0.6, play(c, out, t, o) {
      for (let i = 0; i < 4; i++) {
        const tt = t + i * 0.12, f = R(260, 380) * o.pitch;
        const b = filt(c, "bandpass", f, 9, env(c, out, tt, 0.3 * o.gain, 0.08, 0.01));
        b.frequency.setValueAtTime(f, tt); b.frequency.exponentialRampToValueAtTime(f * 1.7, tt + 0.08);
        noise(c, "brown", tt, 0.1, b);
      }
    } },
    // Cloth torn off a roll, the tape, a pat.
    bandage: { dur: 0.55, play(c, out, t, o) {
      const g = env(c, out, t, 0.2 * o.gain, 0.22, 0.05);
      const am = c.createGain(); am.gain.value = 0.5; am.connect(g);
      K.lfo(c, R(35, 50), 0.5, am.gain).stop(t + 0.35);
      noise(c, "white", t, 0.3, filt(c, "bandpass", 2600 * o.pitch, 0.9, am));
      noise(c, "brown", t + 0.38, 0.05, filt(c, "lowpass", 400, 0.7, env(c, out, t + 0.38, 0.25 * o.gain, 0.04, 0.003)));
    } },
    // A tourniquet cinched on oneself (sim/medics.js selfStabilize): the strap ripped off its hook-and-loop, the
    // windlass rod cranked in quick clicks, a strained breath out; a failed try: fewer clicks and a slip.
    tourniquet: { dur: 0.8, play(c, out, t, o) {
      const g = env(c, out, t, 0.18 * o.gain, 0.14, 0.01);
      const am = c.createGain(); am.gain.value = 0.5; am.connect(g);
      K.lfo(c, R(90, 130), 0.5, am.gain).stop(t + 0.16);
      noise(c, "white", t, 0.15, filt(c, "bandpass", 3200 * o.pitch, 0.8, am));
      const n = o.ok === false ? 2 : 4;
      for (let i = 0; i < n; i++) tick(c, out, t + 0.22 + i * (0.09 - i * 0.008), R(1300, 1600) * o.pitch, 0.13 * o.gain, 0.012);
      if (o.ok === false) noise(c, "white", t + 0.45, 0.08, filt(c, "bandpass", 1800, 0.8, env(c, out, t + 0.45, 0.1 * o.gain, 0.07, 0.005)));
      else noise(c, "brown", t + 0.6, 0.18, filt(c, "bandpass", 900, 0.7, env(c, out, t + 0.6, 0.06 * o.gain, 0.16, 0.04)));
    } },
    // A door: the latch, a creaking hinge.
    door: { dur: 0.6, play(c, out, t, o) {
      tick(c, out, t, 1800 * o.pitch, 0.2 * o.gain, 0.015);
      const v = tone(c, "sawtooth", R(95, 130) * o.pitch, R(140, 180), t + 0.04, 0.42, filt(c, "bandpass", 1100, 7, env(c, out, t + 0.04, 0.07 * o.gain, 0.3, 0.06, 0.05)));
      K.lfo(c, R(14, 22), 25, v.frequency).stop(t + 0.5);
    } },
    // A car or truck across the battlefield: the revs climbing and dying, the tyres on the ground.
    drive: { dur: 1.3, play(c, out, t, o) {
      const f0 = (o.big ? 42 : 55) * o.pitch;
      const lp = filt(c, "lowpass", 380, 1, env(c, out, t, 0.32 * o.gain, 0.6, 0.12, 0.4));
      const e = tone(c, "sawtooth", f0, 0, t, 1.2, lp);
      e.frequency.setValueAtTime(f0, t); e.frequency.linearRampToValueAtTime(f0 * 1.9, t + 0.4); e.frequency.linearRampToValueAtTime(f0 * 1.3, t + 1.1);
      K.lfo(c, 22, 6, e.frequency).stop(t + 1.2);
      noise(c, "brown", t + 0.1, 1, filt(c, "lowpass", 280, 0.7, env(c, out, t + 0.1, 0.25 * o.gain, 0.5, 0.2, 0.3)));
      crackle(c, out, t + 0.2, 5, 0.7, 0.05 * o.gain);
    } },
    // A team's engine on the map: the starter cranking, the engine catching and settling; and switched off.
    engineStart: { dur: 1.6, play(c, out, t, o) {
      for (let i = 0; i < 3; i++) { const tt = t + i * 0.13; tone(c, "sawtooth", 38, 30, tt, 0.09, filt(c, "lowpass", 300, 1, env(c, out, tt, 0.18 * o.gain, 0.08, 0.01))); }
      const tt = t + 0.42, lp = filt(c, "lowpass", 420, 1, env(c, out, tt, 0.25 * o.gain, 0.7, 0.05, 0.3));
      const e = tone(c, "sawtooth", 50, 0, tt, 1.05, lp);
      e.frequency.setValueAtTime(50, tt); e.frequency.linearRampToValueAtTime(95, tt + 0.25); e.frequency.linearRampToValueAtTime(60, tt + 0.9);
      K.lfo(c, 18, 4, e.frequency).stop(tt + 1.05);
    } },
    engineStop: { dur: 0.8, play(c, out, t, o) {
      const lp = filt(c, "lowpass", 380, 1, env(c, out, t, 0.2 * o.gain, 0.5, 0.03, 0.1));
      tone(c, "sawtooth", 62, 28, t, 0.6, lp, 0.55);
      tick(c, out, t + 0.66, 1400, 0.08 * o.gain, 0.015);
    } },
    // The interface: a window opening (a soft swish up) and closing (down); an item in the hand and put down.
    uiOpen: { dur: 0.15, play(c, out, t, o) {
      const f = filt(c, "bandpass", 700, 1.2, env(c, out, t, 0.08 * o.gain, 0.08, 0.03));
      f.frequency.setValueAtTime(700, t); f.frequency.exponentialRampToValueAtTime(2400, t + 0.1);
      noise(c, "white", t, 0.12, f);
      tone(c, "sine", 880, 1180, t + 0.02, 0.06, env(c, out, t + 0.02, 0.04 * o.gain, 0.05, 0.004));
    } },
    uiClose: { dur: 0.15, play(c, out, t, o) {
      const f = filt(c, "bandpass", 2200, 1.2, env(c, out, t, 0.07 * o.gain, 0.08, 0.02));
      f.frequency.setValueAtTime(2200, t); f.frequency.exponentialRampToValueAtTime(650, t + 0.1);
      noise(c, "white", t, 0.12, f);
      tone(c, "sine", 990, 700, t + 0.01, 0.05, env(c, out, t + 0.01, 0.035 * o.gain, 0.04, 0.003));
    } },
    pickup: { dur: 0.15, play(c, out, t, o) {
      if (o.kind === "cloth") noise(c, "white", t, 0.09, filt(c, "bandpass", 1800, 0.8, env(c, out, t, 0.1 * o.gain, 0.08, 0.01)));
      else if (o.kind === "gun" || o.kind === "blade") { tick(c, out, t, 2300, 0.14 * o.gain); tick(c, out, t + 0.035, 1500, 0.12 * o.gain, 0.015); }
      else tick(c, out, t, 1700, 0.1 * o.gain, 0.015, 2);
    } },
    putdown: { dur: 0.15, play(c, out, t, o) {
      noise(c, "brown", t, 0.05, filt(c, "lowpass", 500, 0.7, env(c, out, t, 0.25 * o.gain, 0.04, 0.002)));
      if (o.kind === "gun" || o.kind === "blade") tick(c, out, t + 0.005, 1200, 0.16 * o.gain, 0.02);
      else if (o.kind === "cloth") noise(c, "white", t, 0.06, filt(c, "bandpass", 1500, 0.8, env(c, out, t, 0.07 * o.gain, 0.05, 0.006)));
      else tick(c, out, t, 1000, 0.08 * o.gain, 0.015, 2);
    } },
  };
}
export const GEAR_LABELS = {
  rummage: "Searching a container", lockRattle: "A lock that holds", unlock: "A lock opening", jingle: "Keys", glug: "Fuel siphoned", bandage: "Bandaging", tourniquet: "A tourniquet cinched (stabilizing oneself)",
  door: "A door opening", drive: "Your vehicle in battle", engineStart: "Engine starting (a team sets off)", engineStop: "Engine off (a team arrives)",
  uiOpen: "Window opens", uiClose: "Window closes", pickup: "Item picked up", putdown: "Item put down",
};
// The throttle's limits (ui/audio.js LIMITS): gap in seconds between two starts, how many at once.
export const GEAR_LIMITS = {
  rummage: { gap: 0.3, max: 2 }, lockRattle: { gap: 0.3, max: 1 }, unlock: { gap: 0.2, max: 2 }, jingle: { gap: 0.4, max: 1 }, glug: { gap: 0.5, max: 1 },
  bandage: { gap: 0.4, max: 2 }, tourniquet: { gap: 0.4, max: 1 }, door: { gap: 0.15, max: 3 }, drive: { gap: 1, max: 1 }, engineStart: { gap: 2, max: 1 }, engineStop: { gap: 2, max: 1 },
  uiOpen: { gap: 0.08, max: 1 }, uiClose: { gap: 0.08, max: 1 }, pickup: { gap: 0.05, max: 2 }, putdown: { gap: 0.05, max: 2 },
};
