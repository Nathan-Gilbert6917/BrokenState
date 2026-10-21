// Footsteps in battle: every unit that moves (sim/combat.js fx type "move": unit, from, path) is heard stepping along
// the path as the battle screen walks it there (ui/moveanim.js: the mover's pace, eased in and out), on what it walks on, by its
// gait and by its load. The dead have their own steps by kind. Everyone alike: your people, the enemy, the third side.
// Pure functions until a voice plays: node tools import it.
//
//   surfaceAt(b, x, y, ground)  grass, dirt, gravel, hard, wood, carpet, mud, wet, snow (ground: the weather's mud/snow)
//   gaitOf(b, u, len)           walk, run (a dash: further than one action's move), sneak (your people while the enemy is unaware)
//   deadKind(u)                 the dead's steps: shuffle, runner, brute, crawler, armoured (null: a person)
//   stepCues(state, mem, now)   the steps to play this frame: { name: "step", delay, gain, at, enemy, pan, dist, seen, surf, gait, load, dk, foot }
//   stepVoices(K)               the voice, built on audio.js's building blocks K
//
// Heard: your people, anyone you can see, and those you cannot see within HEAR_TILES of one of yours (muffled and
// quieter: something is moving out there). At most MAX_MOVERS movers a frame (yours first), MAX_STEPS steps a move.
import { playerSees, active } from "../sim/combat.js";
import { weatherAt } from "../sim/weather.js";
import { panOfX } from "./sfx-out.js";
import { deadKind, gaitOf, planOf, timeAt } from "./moveanim.js"; // the gaits and the walk's timing (the battle screen's)
export { deadKind, gaitOf };

export const MAX_STEPS = 6;     // steps heard for one move
export const MAX_MOVERS = 3;    // movers heard in one frame
export const HEAR_TILES = 6;    // an unseen mover this close to one of your people is heard (muffled)
export const STEP_GAIN = 0.55;  // under the effects volume and the Footsteps slider
// Cells per step, by gait and by the dead's kind: a run is a step a cell, a walk one every cell and a half…
const STRIDE = { run: 1, walk: 1.5, sneak: 2, shuffle: 2, runner: 1, brute: 2, crawler: 2.5, armoured: 1.6 };
const GAIT_GAIN = { run: 1.25, walk: 1, sneak: 0.4 };

// The ground under a cell. ground: { mud, snow } from the weather on the battle's tile (outdoors only).
const HARD_FL = { tile: "hard", conc: "hard", wood: "wood", carpet: "carpet", dirt: "dirt" };
const CELL_SURF = {
  stairs: "wood", ladder: "wood", siegeladder: "wood", tower: "wood", walkway: "wood", gate: "wood", loft: "wood",
  roof: "hard", rubble: "gravel", smashed: "gravel", breach: "gravel", wire: "gravel", trench: "mud", spikes: "dirt", tanktrap: "hard",
};
const FLOOR_SURF = { grass: "grass", field: "grass", dirt: "dirt", gravel: "gravel", rubble: "gravel", road: "hard", deck: "hard", air: "wood" };
export function surfaceAt(b, x, y, ground = null) {
  const c = b && b.cells && b.w ? b.cells[y * b.w + x] : null;
  if (!c) return "dirt";
  if (c.f === "floor") return HARD_FL[c.fl] || "wood"; // indoors: the room's floor (buildingmaps.js fl)
  let s = CELL_SURF[c.k] || (c.deck ? "hard" : FLOOR_SURF[c.f]) || "grass";
  if (ground && s !== "wood") {
    if (ground.snow) s = "snow";
    else if (ground.mud && (s === "grass" || s === "dirt")) s = "mud";
    else if (ground.wet && s === "hard") s = "wet";
  }
  return s;
}
// The ground's state from the weather (sim/weather.js): snow lying, mud, rain falling.
export function groundOf(wx) {
  if (!wx) return null;
  const k = wx.key;
  return {
    snow: (Number(wx.snowCover) || 0) >= 0.15,
    mud: !wx.frozen && ((Number(wx.mud) || 0) >= 0.35 || k === "rain" || k === "storm"),
    wet: k === "rain" || k === "storm",
  };
}

// The steps of the moves logged since the last call. mem: kept by the caller (a new or loaded battle starts quiet).
export function stepCues(state, mem, now = 0) {
  const b = state && state.combat;
  const out = [];
  if (!b || !b.fx) return out;
  if (mem.battle !== b) {
    mem.battle = b;
    mem.seq = b.fxSeq || 0;
    mem.foot = 0;
    mem.wxAt = -1e9;
    return out;
  }
  const fresh = b.fx.filter((f) => f.seq > mem.seq);
  if (fresh.length) mem.seq = fresh[fresh.length - 1].seq;
  if (b.over) return out;
  const moves = [];
  for (const f of fresh) {
    if (f.type !== "move" || !f.path || !f.path.length) continue;
    const u = b.units.find((x) => x.id === f.unit);
    if (!u || u.dead || u.ztype === "swarm" || u.aboard) continue; // a worm swarm is zombie-sfx's; those in a vehicle ride
    let seen = u.side === "player";
    if (!seen) try { seen = playerSees(b, u); } catch { seen = false; }
    // Tiles to the nearest of your people (yours: 0, the listener is with them).
    let dist = 0;
    if (u.side !== "player") {
      dist = Infinity;
      for (const p of b.units) if (p.side === "player" && active(p)) dist = Math.min(dist, Math.max(Math.abs(p.x - u.x), Math.abs(p.y - u.y)));
    }
    if (!seen && !(dist <= HEAR_TILES)) continue;
    moves.push({ f, u, seen, dist: Number.isFinite(dist) ? dist : 0, rank: u.side === "player" ? 0 : seen ? 1 : 2 });
  }
  if (!moves.length) return out;
  moves.sort((a, c) => a.rank - c.rank);
  // The weather's ground on the battle's tile, looked up every few seconds (outdoors it decides mud and snow).
  if (now - mem.wxAt > 5) {
    mem.wxAt = now;
    mem.ground = null;
    try { if (b.setup && b.setup.tile != null && state.tiles) mem.ground = groundOf(weatherAt(state, b.setup.tile)); } catch { mem.ground = null; }
  }
  const rng = mem.rng || Math.random;
  for (const { f, u, seen, dist } of moves.slice(0, MAX_MOVERS)) {
    const len = f.path.length;
    const dk = deadKind(u);
    const gait = dk ? null : gaitOf(b, u, len);
    const n = Math.max(1, Math.min(MAX_STEPS, Math.round(len / STRIDE[dk || gait])));
    const plan = planOf(b, u, f); // walked as the screen walks it (ui/moveanim.js): after the mover's moves before it, eased
    const load = dk ? (dk === "armoured" ? 2 : 0) : Math.max(0, Math.min(3, Number(u.loadBand) || 0));
    const gain = STEP_GAIN * (dk ? 1 : GAIT_GAIN[gait]) * (seen ? 1 : 0.55) * (u.side === "player" ? 1 : 0.85);
    for (let i = 0; i < n; i++) {
      const k = Math.min(len - 1, Math.floor((i * len) / n));
      const [x, y] = f.path[k];
      out.push({
        name: "step", delay: (plan.delay + timeAt(plan, (i * len) / n)) / 1000 + rng() * 0.012, gain, at: [x, y], enemy: u.side !== "player", pan: panOfX(b, x), dist, seen, surf: surfaceAt(b, x, y, mem.ground),
        gait, load, dk, foot: (mem.foot = 1 - mem.foot),
      });
    }
  }
  return out;
}

// ---------- the voice ----------
// o: { gain, pitch, surf, gait, load (0–3), dk, foot (0/1: left, right) }.
export function stepVoices(K) {
  const { env, filt, noise, tone, crackle, R } = K;
  // The ground's part of a step at t (peak g): the sound of what is underfoot.
  function ground(c, out, t, o, g, p) {
    switch (o.surf) {
      case "grass": // a soft brush of grass and a muted pad
        noise(c, "white", t, 0.08, filt(c, "bandpass", 2600 * p, 0.7, env(c, out, t, 0.22 * g, 0.07, 0.006)));
        noise(c, "brown", t, 0.06, filt(c, "lowpass", 320 * p, 0.7, env(c, out, t, 0.6 * g, 0.05, 0.003)));
        break;
      case "gravel": // gravel, rubble, glass: a crunch of small stones
        crackle(c, out, t, 3 + Math.round(o.load || 0), 0.05, 0.35 * g);
        noise(c, "brown", t, 0.06, filt(c, "lowpass", 520 * p, 0.7, env(c, out, t, 0.6 * g, 0.05, 0.002)));
        break;
      case "hard": case "wet": // road, concrete, tiles: the heel's click (in the rain a splash with it)
        noise(c, "white", t, 0.03, filt(c, "bandpass", 1900 * p, 1.6, env(c, out, t, 0.5 * g, 0.022, 0.001)));
        tone(c, "sine", 150 * p, 90, t, 0.04, env(c, out, t, 0.35 * g, 0.035, 0.001));
        if (o.surf === "wet") noise(c, "white", t + 0.008, 0.08, filt(c, "highpass", 2800, 0.7, env(c, out, t + 0.008, 0.25 * g, 0.07, 0.004)));
        break;
      case "wood": // floorboards, a walkway, a ladder: a hollow knock
        tone(c, "triangle", 210 * p * R(0.95, 1.05), 160 * p, t, 0.07, env(c, out, t, 0.3 * g, 0.06, 0.002));
        noise(c, "white", t, 0.05, filt(c, "bandpass", 520 * p, 3, env(c, out, t, 0.4 * g, 0.045, 0.002)));
        break;
      case "carpet":
        noise(c, "brown", t, 0.06, filt(c, "lowpass", 300 * p, 0.7, env(c, out, t, 0.4 * g, 0.05, 0.006)));
        break;
      case "mud": // a squelch sliding down
        { const f = filt(c, "bandpass", 600 * p, 4, env(c, out, t, 0.4 * g, 0.11, 0.01));
          f.frequency.setValueAtTime(650 * p, t); f.frequency.exponentialRampToValueAtTime(240, t + 0.11);
          noise(c, "white", t, 0.12, f); }
        noise(c, "brown", t, 0.06, filt(c, "lowpass", 300, 0.7, env(c, out, t, 0.5 * g, 0.05, 0.003)));
        break;
      case "snow": // packed snow: a dry crunch
        noise(c, "white", t, 0.1, filt(c, "bandpass", 1900 * p, 1.1, env(c, out, t, 0.3 * g, 0.09, 0.012)));
        crackle(c, out, t + 0.005, 3, 0.07, 0.18 * g);
        break;
      default: // dirt: a dull, dry pad
        noise(c, "brown", t, 0.06, filt(c, "lowpass", 620 * p, 0.7, env(c, out, t, 0.7 * g, 0.05, 0.002)));
        noise(c, "white", t, 0.03, filt(c, "bandpass", 1200 * p, 1, env(c, out, t, 0.12 * g, 0.025, 0.002)));
    }
  }
  function step(c, out, t, o) {
    const load = Math.max(0, Math.min(3, Number(o.load) || 0));
    const p = o.pitch * (o.foot ? 1.04 : 0.97) * (1 - 0.06 * load);
    let g = o.gain;
    switch (o.dk) {
      case "crawler": // dragging itself along: a long scrape, no step at all
        noise(c, "white", t, 0.22, filt(c, "bandpass", 700 * p, 0.9, env(c, out, t, 0.18 * g, 0.12, 0.06, 0.03)));
        noise(c, "brown", t, 0.12, filt(c, "lowpass", 260, 0.7, env(c, out, t + 0.05, 0.3 * g, 0.08, 0.02)));
        return;
      case "shuffle": // a walker: a foot put down, then dragged (one foot drags more: a limp)
        ground(c, out, t, o, g * 0.7, p * 0.92);
        noise(c, "white", t + 0.03, 0.16, filt(c, "bandpass", (o.foot ? 820 : 640) * p, 0.9, env(c, out, t + 0.03, (o.foot ? 0.16 : 0.09) * g, 0.1, 0.05)));
        return;
      case "runner": // fast, slapping bare feet
        noise(c, "white", t, 0.03, filt(c, "bandpass", 1500 * p, 1.2, env(c, out, t, 0.4 * g, 0.025, 0.001)));
        ground(c, out, t, o, g * 0.8, p);
        return;
      case "brute": // a heavy stomp: the floor takes it
        tone(c, "sine", 62 * p, 38, t, 0.18, env(c, out, t, 0.9 * g, 0.16, 0.003));
        ground(c, out, t, o, g * 1.3, p * 0.8);
        return;
      case "armoured": // a dead soldier: boots and loose gear clanking
        ground(c, out, t, o, g, p);
        for (const d of [0.02, R(0.04, 0.06)]) tone(c, "sine", R(1700, 2600), 0, t + d, 0.05, env(c, out, t + d, 0.05 * g, 0.04, 0.001));
        noise(c, "white", t + 0.025, 0.02, filt(c, "bandpass", 3200, 3, env(c, out, t + 0.025, 0.12 * g, 0.015, 0.001)));
        return;
    }
    // A person: the heel (heavier with the load), the ground; kit rattling on the heavily laden.
    if (o.gait === "sneak") g *= 0.9;
    const a = o.gait === "sneak" ? 0.012 : 0.002;
    tone(c, "sine", (100 - 9 * load) * p, 55, t, 0.06, env(c, out, t, (0.22 + 0.1 * load) * g, 0.045 + 0.012 * load, a));
    ground(c, out, t, o, g * (o.gait === "run" ? 1.1 : 1), p);
    if (load >= 2 && o.gait !== "sneak") {
      const d = R(0.015, 0.035);
      noise(c, "white", t + d, 0.02, filt(c, "bandpass", R(2800, 3600), 3, env(c, out, t + d, 0.08 * load * g, 0.015, 0.001)));
    }
  }
  const STEP = (extra) => ({ dur: 0.25, own: true, steps: true, play(c, out, t, o) { step(c, out, t, { ...o, ...extra }); } });
  return {
    step: { dur: 0.25, own: true, steps: true, play: step },
    // For Options → Hear: a few steps on each ground and of each kind of the dead.
    hearStepGrass: walk({ surf: "grass" }), hearStepRoad: walk({ surf: "hard" }), hearStepWood: walk({ surf: "wood" }),
    hearStepGravel: walk({ surf: "gravel" }), hearStepMud: walk({ surf: "mud" }), hearStepSnow: walk({ surf: "snow" }),
    hearStepLaden: walk({ surf: "dirt", load: 3, gait: "run" }, 0.07), hearStepSneak: walk({ surf: "wood", gait: "sneak" }, 0.14),
    hearStepWalker: walk({ surf: "dirt", dk: "shuffle" }, 0.15), hearStepRunner: walk({ surf: "hard", dk: "runner" }, 0.07),
    hearStepBrute: walk({ surf: "hard", dk: "brute" }, 0.18), hearStepCrawler: walk({ surf: "dirt", dk: "crawler" }, 0.2),
    hearStepArmoured: walk({ surf: "hard", dk: "armoured" }, 0.11),
  };
  function walk(extra, gap = 0.105) {
    const one = STEP(extra);
    return { dur: gap * 4 + 0.25, own: true, steps: true, play(c, out, t, o) { for (let i = 0; i < 4; i++) one.play(c, out, t + i * gap, { gain: 0.8, ...o, foot: i % 2 }); } };
  }
}
export const STEP_LABELS = {
  step: "Footstep",
  hearStepGrass: "Footsteps: grass", hearStepRoad: "Footsteps: road", hearStepWood: "Footsteps: wooden floor", hearStepGravel: "Footsteps: gravel and rubble",
  hearStepMud: "Footsteps: mud", hearStepSnow: "Footsteps: snow", hearStepLaden: "Footsteps: running in heavy kit", hearStepSneak: "Footsteps: sneaking",
  hearStepWalker: "Footsteps: a walker shuffling", hearStepRunner: "Footsteps: a runner", hearStepBrute: "Footsteps: a brute", hearStepCrawler: "Footsteps: a crawler",
  hearStepArmoured: "Footsteps: armoured dead",
};
