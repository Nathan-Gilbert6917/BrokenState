// Hordes: spawned by nests, they grow, merge and drift toward noise (Hub Heat) and people.
import { newId, log, day, atBase, hurt, hub, factionById, removeBase } from "./world.js";
import { mannedStations } from "./buildings.js";
import { baseDefense, resolveRaidOnFaction } from "./factions.js";
import { tileLabel } from "./parties.js";

const HOURS_PER_TILE = 4;
const MAX_HORDES = 18; // the 64×42 map has 6–8 nests (mapgen.js)
export const HORDE_MAX_SIZE = 140; // growth and merging both stop here
export const HORDE_MIN_SIZE = 5;   // fewer than this is no longer a horde: it is removed

// Takes n of the dead off a horde. A horde below HORDE_MIN_SIZE is removed from the map at once; returns true
// then. Every place that shrinks a horde goes through here (or is caught by pruneHordes within the hour).
export function reduceHorde(state, h, n) {
  h.size = Math.max(0, Math.round(h.size - Math.max(0, n)));
  if (h.size >= HORDE_MIN_SIZE) return false;
  const i = state.hordes.indexOf(h);
  if (i >= 0) state.hordes.splice(i, 1);
  return true;
}

// Safety net, every hour: no horde of fewer than HORDE_MIN_SIZE stays on the map, whoever shrank it.
export function pruneHordes(state) {
  for (let i = state.hordes.length - 1; i >= 0; i--) if (!(state.hordes[i].size >= HORDE_MIN_SIZE)) state.hordes.splice(i, 1);
}

export function baseHeat(state, base) {
  const people = atBase(state, base.id);
  const workshop = mannedStations(state, base); // stations with an operator at work; idle "Operate" people make no noise
  return people.length + workshop * 3 + (base.radio ? 2 : 0) + (base.type === "hub" ? 3 : 0);
}

export function hordesHour(state) {
  const g = state.grid;
  pruneHordes(state);
  for (const h of [...state.hordes]) {
    h.move = (h.move || 0) + 1;
    if (h.move < HOURS_PER_TILE) continue;
    h.move = 0;
    if (h.target == null || h.target === h.tile) continue;
    const opts = g.neighbors(h.tile).filter((id) => {
      const t = state.tiles[id];
      return t.terrain !== "water" || t.bridge;
    });
    if (!opts.length) continue;
    opts.sort((a, b) => g.distance(a, h.target) - g.distance(b, h.target) + (state.rng.next() - 0.5) * 0.6);
    h.tile = opts[0];
    onHordeEnter(state, h);
  }
  // Merge hordes that meet.
  for (let i = 0; i < state.hordes.length; i++) {
    for (let j = state.hordes.length - 1; j > i; j--) {
      if (state.hordes[i].tile === state.hordes[j].tile) {
        state.hordes[i].size = Math.min(HORDE_MAX_SIZE, state.hordes[i].size + state.hordes[j].size);
        state.hordes.splice(j, 1);
      }
    }
  }
}

function onHordeEnter(state, h) {
  const base = state.bases.find((b) => b.tile === h.tile);
  if (base) return hordeAttackPlayer(state, h, base);
  const f = state.factions.find((f) => f.alive && f.bases.includes(h.tile));
  if (f) {
    const held = resolveRaidOnFaction(state, { strength: h.size * 0.12, owner: null, target: { factionId: f.id, tile: h.tile } }, []);
    h.target = null;
    reduceHorde(state, h, h.size - h.size * (held ? 0.45 : 0.7));
  }
}

function hordeAttackPlayer(state, h, base) {
  const rng = state.rng;
  const people = atBase(state, base.id);
  const def = baseDefense(state, base);
  const att = h.size * 0.14;
  let lost = 0;
  base.stock.ammo = Math.max(0, (base.stock.ammo || 0) - people.length * 4);
  if (def >= att * 1.1) {
    const killed = Math.min(h.size, Math.round(def * 2.5));
    lost = killed;
    log(state, `A horde hit ${base.name}. The walls held and about ${killed} of the dead were cut down.`, "good");
    if (people.length && rng.chance(0.3)) hurt(state, rng.pick(people), rng.int(10, 30), base.tile, `fighting the horde at ${base.name}`);
  } else {
    lost = h.size * 0.4;
    for (const k of Object.keys(base.stock)) base.stock[k] = Math.floor(base.stock[k] * 0.85);
    log(state, `A horde broke into ${base.name}.`, "death");
    for (let i = 0; i < 3 && people.length; i++) hurt(state, rng.pick(people), rng.int(20, 60), base.tile, `when the horde broke into ${base.name}`);
    if (base.type === "outpost" && def < att * 0.6) {
      removeBase(state, base, "was overrun and abandoned"); // world.js: people flee, vehicles are left there, the log says what was lost
    }
  }
  h.target = null;
  reduceHorde(state, h, lost);
}

export function hordesDaily(state) {
  const rng = state.rng;
  const g = state.grid;
  const d = day(state);
  // Nests spawn new hordes; infection creeps outward from them.
  for (const t of state.tiles) {
    if (!t.nest) continue;
    for (const id of g.within(t.id, 3)) state.tiles[id].infection = Math.min(1, state.tiles[id].infection + 0.003);
    if (state.hordes.length < MAX_HORDES && rng.chance(1 / 6)) {
      state.hordes.push({ id: newId(), tile: t.id, size: Math.round(10 + Math.min(60, d * 0.4) * rng.range(0.6, 1.2)), target: null, move: 0 });
    }
  }
  for (const h of state.hordes) {
    h.size = Math.min(HORDE_MAX_SIZE, Math.round(h.size * 1.006));
    if (h.lureUntil && state.hour < h.lureUntil) continue;
    // Drift toward the loudest, closest people.
    let best = null;
    for (const b of state.bases) {
      const dist = g.distance(h.tile, b.tile);
      if (dist > 9) continue;
      const score = baseHeat(state, b) / (1 + dist * 0.35);
      if (!best || score > best.score) best = { tile: b.tile, score };
    }
    for (const f of state.factions) {
      if (!f.alive) continue;
      for (const fb of f.bases) {
        const dist = g.distance(h.tile, fb);
        if (dist > 9) continue;
        const score = (f.pop * 0.5) / (1 + dist * 0.35);
        if (!best || score > best.score) best = { tile: fb, score };
      }
    }
    if (best && rng.chance(0.7)) h.target = best.tile;
    else {
      const wander = g.within(h.tile, 4);
      h.target = rng.pick(wander);
    }
  }
}

