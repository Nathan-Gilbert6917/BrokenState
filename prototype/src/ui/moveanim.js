// Walking on the battle map (the user's request 2026-10-21: "add movement animations for battle map currently its like
// teleportations"): a move (sim/combat.js fx "move": unit, from, path) is walked out cell by cell at the mover's own
// pace, easing in at the start and out at the end, the figure facing the step it is on, its legs striding and its arms
// swinging (ui/figures.js stride) with a little bob. A unit's moves in a row (two actions spent moving, an enemy's
// whole turn) are walked one after the other, never the last one alone (ui/combat.js stampMoves). Pure functions: ui/combat.js
// (where a unit is drawn and when the enemy's next one goes), ui/isoview.js (its heading and stride), ui/sfx-steps.js
// (the footsteps along it), the node tools.
//
//   deadKind(u)            the dead's gait by kind: shuffle, runner, brute, crawler, armoured (null: a person)
//   gaitOf(b, u, len)      a person's: walk, run (further than one action's move), sneak (nobody has seen you yet)
//   moveGait(b, u, f)      the gait a move is walked at: the dead's, a person's, sneaking, shove (shoved back)
//   planOf(b, u, f)        { gait, len, per (ms a cell at full pace), ramp (ms easing in and out), total (ms), delay }, kept per move
//   moveAt(b, u, f, el)    where the move is el ms in: { x, y, dir, dist, gait }, or null once it is over
//   timeAt(plan, d)        the ms in at which the walker has gone d cells
//   strideOf(m)            the walk cycle at that point: { stride (-1 .. 1 in halves: the left leg ahead > 0), bob (art px) }
import { active } from "../sim/combat.js";

// Ms a cell at full pace, by gait. A walk is a brisk step, a run (a dash) quicker, a sneak slow; the dead by kind.
export const PACE = { walk: 170, run: 115, sneak: 240, shuffle: 220, runner: 115, brute: 240, crawler: 280, armoured: 200, shove: 110 };
export const MAX_WALK_MS = 1500; // a long move is walked faster than its pace rather than taking longer than this
export const MIN_PER = 80;       // ...but never faster than this a cell
// Cells a step (half the walk cycle) and the bob at the passing step (art px), by gait. 0: no stride (a crawl, a shove).
const STEP_CELLS = { walk: 0.75, run: 1, sneak: 0.55, shuffle: 0.6, runner: 0.95, brute: 0.8, crawler: 0, armoured: 0.7, shove: 0 };
const BOB = { walk: 1, run: 1.6, sneak: 0.5, shuffle: 0.7, runner: 1.6, brute: 1.2, crawler: 0, armoured: 0.8, shove: 0 };

const HEAVY_DEAD = new Set(["brute", "boneback", "flinger", "nightmare", "deadcow", "deadhog"]); // the dead beasts (sim/deadbeasts.js): a cow and a hog tread heavy, a stag and a dog run
export function deadKind(u) {
  if (!u || u.kind !== "zombie") return null;
  if (u.low || u.ztype === "crawler") return "crawler";
  if (u.ztype === "soldier" || u.ztype === "riot") return "armoured";
  if (u.boss || HEAVY_DEAD.has(u.ztype) || u.variant === "wallbreaker" || u.variant === "broodmother") return "brute";
  if (u.ztype === "runner" || u.ztype === "climber" || u.ztype === "deadstag" || u.ztype === "deadhound") return "runner";
  return "shuffle";
}
export function gaitOf(b, u, len) {
  if (u.side === "player" && b.units.some((e) => e.side === "enemy" && !e.aware && active(e))) return "sneak"; // stealth: nobody has seen you yet
  const mob = Number(u.mob) || 5;
  return len > mob ? "run" : "walk";
}
export function moveGait(b, u, f) {
  if (f.shove) return "shove";
  const dk = deadKind(u);
  if (dk) return dk;
  if (u && u.sneaking) return "sneak"; // sim/vision.js: crouched, moving quietly
  return gaitOf(b, u, (f.path || []).length);
}

// A move's timing, worked out once (the gait can change under it: an enemy waking mid-move must not jump the walker).
const plans = new WeakMap(); // the fx -> its plan
export function planOf(b, u, f) {
  let p = plans.get(f);
  if (p) return p;
  const len = (f.path || []).length, gait = u ? moveGait(b, u, f) : "walk";
  if (gait === "shove") p = { gait, len, per: PACE.shove, ramp: 0, total: len * PACE.shove, delay: 0 };
  else {
    const per = Math.max(MIN_PER, Math.min(PACE[gait] || PACE.walk, MAX_WALK_MS / Math.max(1, len)));
    const ramp = Math.min(per * 0.6, (len * per) / 2); // easing in and out, each taking this long
    p = { gait, len, per, ramp, total: len * per + ramp, delay: 0 }; // delay: ms after it was logged that it starts (ui/combat.js stampMoves)
  }
  plans.set(f, p);
  return p;
}
// Cells gone at t ms: a trapezoid of speed (up to full pace over the ramp, full pace, down to a stop over the ramp).
function distAt(p, t) {
  if (t <= 0) return 0;
  if (t >= p.total) return p.len;
  if (!p.ramp) return t / p.per;
  const v = 1 / p.per, r = p.ramp;
  if (t < r) return (0.5 * v * t * t) / r;
  if (t <= p.total - r) return v * (t - r / 2);
  const s = p.total - t;
  return p.len - (0.5 * v * s * s) / r;
}
export function timeAt(p, d) {
  if (d <= 0) return 0;
  if (d >= p.len) return p.total;
  if (!p.ramp) return d * p.per;
  const v = 1 / p.per, r = p.ramp, d0 = (0.5 * v * r);
  if (d < d0) return Math.sqrt((2 * d * r) / v);
  if (d <= p.len - d0) return d / v + r / 2;
  return p.total - Math.sqrt((2 * (p.len - d) * r) / v);
}
export function moveAt(b, u, f, el) {
  const p = planOf(b, u, f);
  if (el >= p.total || !p.len) return null;
  const pts = [f.from, ...f.path];
  let d, s, fr;
  if (p.gait === "shove") { // shoved back (sim/shoving.js): a stumble a cell, fast then slowing
    const k = Math.max(0, el) / p.per;
    s = Math.floor(k); const lin = k - s; fr = 1 - (1 - lin) * (1 - lin); d = s + fr;
  } else { d = distAt(p, el); s = Math.min(p.len - 1, Math.floor(d)); fr = d - s; }
  const a = pts[s], c = pts[Math.min(pts.length - 1, s + 1)];
  let dir = [c[0] - a[0], c[1] - a[1]];
  if (!dir[0] && !dir[1]) dir = null; // a step in place (turned, nothing walked)
  if (p.gait === "shove") dir = null; // stumbling back: still facing whoever shoved them
  return { x: a[0] + (c[0] - a[0]) * fr, y: a[1] + (c[1] - a[1]) * fr, dir, dist: d, gait: p.gait };
}
// The walk cycle at a point of the move: the legs by halves (5 poses, so ui/figures.js paints few of them) and the
// body's bob, highest as the legs pass each other.
export function strideOf(m) {
  const sc = m && STEP_CELLS[m.gait];
  if (!sc || !m.dir) return { stride: 0, bob: 0 };
  const ph = (m.dist / sc) * Math.PI; // a step is half a cycle
  return { stride: Math.round(Math.sin(ph) * 2) / 2 || 0, bob: (BOB[m.gait] || 0) * Math.cos(ph) ** 2 };
}
