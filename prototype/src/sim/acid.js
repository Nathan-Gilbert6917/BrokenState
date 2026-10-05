// A spitter's acid sac bursts when it dies (zombietypes.js; every number in ACID). Any death, any battle: a field
// fight, a raid or a building's interior, a base battle, a city crawl's street (combat.js damage calls spitterBurst).
//   The burst: its tile and the 8 around it become an acid pool (b.acid = [{ x, y, turns }], one cell each): floor
//     only (cells you can stand on that do not block sight: not walls, closed doors, ladders or stairs), at its own
//     height, never round a corner both sides of which are walls. Everyone living standing in it is splashed at once
//     (ACID.burst): your people, hostile people, the third side. The dead are never hurt by it.
//   The pool: lasts ACID.turns rounds (counted down at the start of each player turn, like fire: throwables.js
//     burnRound). A living unit that steps into it or walks through it (combat.js moveAlong) is burned (ACID.pool), at
//     most once a round; so is anyone standing in it when their side's turn starts (your people at the start of the
//     player turn, the enemy and the third side at the start of theirs). Acid eats through half of what body armour
//     would stop (ACID.armor); the armoured dead are not hurt at all.
//   The AI: people (any side) path around it at ACID.cost extra a cell (combat.js reachable, distField: not closed,
//     only dearer) and score ending a move in it ACID.stand worse; an order by hand only prefers the same-length way
//     round (ACID.manual). The dead walk straight through.
// The battle's own rng only, and only when a spitter dies: battles without spitters play exactly as before.
import { CELL, say, fx, damage, active, heightAt, alertPod } from "./combat.js";

export const ACID = {
  burst: [10, 16], // the splash when it bursts (its spit: 16–22 × its damage; a Molotov landing 12–18)
  pool: [6, 10],   // stepping in, or starting a turn in it (fire: 8–14)
  turns: 3,        // rounds the pool lasts
  armor: 0.5,      // the share of armour's protection acid still respects
  cost: 4,         // extra path cost of a pool cell for people's AI
  manual: 0.05,    // the same for an order by hand: only a way round of the same length is preferred
  stand: 10,       // how much worse the AI scores ending a move in a pool (combat.js scoreCell)
};

export const acidAt = (b, x, y) => (b.acid && b.acid.length ? b.acid.find((p) => p.x === x && p.y === y) || null : null);
// Who acid hurts: the living (your people, hostile people, the third side), never the dead.
export const acidHurts = (u) => active(u) && u.kind !== "zombie";
// × the damage acid does through someone's armour (armour 0.82: 0.91).
export const acidArmor = (t) => 1 - (1 - (t.armor ?? 1)) * ACID.armor;
// Per-cell extra path weight for a walker (null: none, the dead or no pools).
export function acidWeights(b, u, manual = false) {
  if (!b.acid || !b.acid.length || !u || u.kind === "zombie") return null;
  const w = new Float32Array(b.w * b.h);
  const c = manual ? ACID.manual : ACID.cost;
  for (const p of b.acid) w[p.y * b.w + p.x] = c;
  return w;
}

// The cells a burst at (x, y) covers.
export function burstCells(b, x, y) {
  const h0 = heightAt(b, x, y);
  const floor = (cx, cy) => {
    if (cx < 0 || cy < 0 || cx >= b.w || cy >= b.h) return false;
    const C = CELL[b.cells[cy * b.w + cx].k];
    return !!C && C.walk && !C.los && !C.climb && heightAt(b, cx, cy) === h0;
  };
  const out = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = x + dx, cy = y + dy;
    if (dx || dy) {
      if (!floor(cx, cy)) continue;
      if (dx && dy && !floor(x + dx, y) && !floor(x, y + dy)) continue; // round a wall's corner
    } else if (!(CELL[b.cells[cy * b.w + cx].k] || {}).walk) continue;
    out.push([cx, cy]);
  }
  return out;
}

// A spitter has died (combat.js damage): the pool, and the splash on everyone living in it.
export function spitterBurst(b, u) {
  if (u.burst || u.x == null || u.x < 0) return;
  u.burst = true;
  const cells = burstCells(b, u.x, u.y);
  const list = b.acid || (b.acid = []);
  for (const [x, y] of cells) {
    const p = acidAt(b, x, y);
    if (p) p.turns = Math.max(p.turns, ACID.turns);
    else list.push({ x, y, turns: ACID.turns });
  }
  const caught = b.units.filter((t) => acidHurts(t) && cells.some(([x, y]) => t.x === x && t.y === y));
  const hits = caught.map((t) => { const raw = b.rng.int(ACID.burst[0], ACID.burst[1]); return { t, raw, eff: Math.round(raw * acidArmor(t)) }; });
  say(b, `${u.name} bursts, spraying acid!${hits.length ? ` Caught in the spray: ${hits.map((h) => `${h.t.name} ${h.eff}`).join(", ")}.` : ""}`, hits.some((h) => h.t.side === "player") ? "danger" : "info");
  fx(b, { type: "melee", from: [u.x, u.y], to: [u.x, u.y], hit: true, crit: false, dmg: 0, side: "acid", text: "BURST", acid: true });
  for (const h of hits) {
    h.t.acidT = b.turn;
    fx(b, { type: "melee", from: [h.t.x, h.t.y], to: [h.t.x, h.t.y], hit: true, crit: false, dmg: h.eff, side: "acid", text: `ACID -${h.eff}`, acid: true });
    damage(b, h.t, h.raw, null, false, { how: "acid" });
    if (h.t.side === "enemy" && !h.t.dead && !h.t.aware) alertPod(b, h.t.pod, `${h.t.name} cries out!`);
  }
}

// One burn from the pool (at most once a round: u.acidT).
function scald(b, u, what) {
  const raw = b.rng.int(ACID.pool[0], ACID.pool[1]);
  const eff = Math.round(raw * acidArmor(u));
  u.acidT = b.turn;
  say(b, `${u.name} ${what} (${eff}).`, u.side === "player" ? "danger" : "good");
  fx(b, { type: "melee", from: [u.x, u.y], to: [u.x, u.y], hit: true, crit: false, dmg: eff, side: "acid", text: `ACID -${eff}`, acid: true });
  damage(b, u, raw, null, false, { how: "acid" });
  if (u.side === "enemy" && !u.dead && !u.aware) alertPod(b, u.pod, `${u.name} cries out!`);
}

// Walking into the acid (combat.js moveAlong). true: burned.
export function acidStep(b, u, x, y) {
  if (!b.acid || !b.acid.length || !acidHurts(u) || u.acidT === b.turn || !acidAt(b, x, y)) return false;
  scald(b, u, "steps into the acid");
  return true;
}

// The start of a side's turn: whoever of `sides` stands in a pool is burned. At the start of the player turn
// (tick) the pools then dry up a round.
export function acidRound(b, sides, tick = false) {
  if (!b.acid || !b.acid.length) return;
  for (const t of b.units) {
    if (!sides.includes(t.side) || !acidHurts(t) || t.acidT === b.turn || !acidAt(b, t.x, t.y)) continue;
    scald(b, t, "stands in the acid");
  }
  if (!tick) return;
  for (const p of b.acid) p.turns -= 1;
  b.acid = b.acid.filter((p) => p.turns > 0);
}
