// @ts-check
// The lie of the land in a fight (the user's word 2026-10-23: "improve high ground accuracy and sight range, low ground
// inaccuracy and can't see beyond the first tiles around a hollow. High ground acts as half cover if one layer high and
// can see the survivor and full cover if two layers high. You can use hills to see into upper floors of buildings if any
// are in range with a window. Update AI pathing"). The hills and hollows themselves are relief.js and basescatter.js
// reliefLayer (c.h with c.ter, a hollow a level down; a mountain's crag its rock height c.ch, which combat.js losTop
// counts for every line here too); the height rules that every raised floor shares (sight, aim, cover by the height
// difference, the climb) are combat.js HEIGHT, sightRange, shotOdds, coverAgainst and climbCost. What is here:
//   - Hollows: whoever stands in one (ground below the land round it) sees the hollow and the first cells round its rim,
//     and nothing beyond; nothing beyond sees them either (one line of sight both ways: combat.js los asks hollowShut).
//   - Hills into upper floors (buildingmaps.js storeys, b.floors): someone on a hill as high as a floor or higher sees
//     into that floor through a window on the wall facing them, within their sight, and can shoot through it; whoever is
//     at the window sees and shoots back (windowSees, crossLos, floorCover, windowFoes). Nothing else crosses floors.
//   - Where the AI stands (combat.js scoreCell): a person with a gun takes the high ground and keeps out of a hollow
//     (terrainScore, TERRAIN_AI). The pathfinders cost the ground's climb (combat.js reachable, distField: climbCost).
import { CELL, HEIGHT, losTop, coverAgainst, active, activeAny, isTied, mapLv } from "./combat.js"; // call-time only (combat.js imports this)
import { coned, nightSees } from "./vision.js";

// Where the AI stands (combat.js scoreCell): a ranged person's score + HIGH a level of hill under them (up to MAX_LV
// levels), − HOLLOW a level down in a hollow (it sees only the rim from there).
export const TERRAIN_AI = { HIGH: 2, MAX_LV: 3, HOLLOW: 6 };

// The ground's own height under a cell (a hill or a hollow: c.ter), 0 for anything else.
const terH = (c) => (c && c.ter ? c.h || 0 : 0);
// Is a cell sunk ground, below level ground (a base's map on a hill is laid from its own level: combat.js mapLv)?
const sunk = (b, c) => !!c && !!c.ter && (c.h || 0) + mapLv(b) < 0;

// ---------- hollows ----------
// The hollow a cell is in: every cell of sunk ground (c.ter, c.h < 0) joined to it eight ways, as a Set of indexes, or
// null when the cell is not in one. One search kept (the last asked; a battle's eyes ask the same hollow again and
// again), for this map's cells and revision.
let memo = null;
function hollowOf(b, i) {
  const cells = b.cells;
  if (!sunk(b, cells[i])) return null;
  if (memo && memo.cells === cells && memo.rev === b.rev && memo.set.has(i)) return memo.set;
  const W = b.w, H = b.h, set = new Set([i]), q = [i];
  for (let k = 0; k < q.length; k++) {
    const j = q[k], x = j % W, y = (j / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (!set.has(n) && sunk(b, cells[n])) { set.add(n); q.push(n); }
    }
  }
  memo = { cells, rev: b.rev, set };
  return set;
}
// In the hollow, or one of the first cells round its rim (next to it, diagonals too).
function byHollow(b, set, x, y) {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < b.w && ny < b.h && set.has(ny * b.w + nx)) return true;
  }
  return false;
}
// Is the line between (x0, y0) and (x1, y1) shut by a hollow: one end in a hollow, the other neither in it nor on its
// rim? Both ways alike (the los cache holds one answer for the pair).
export function hollowShut(b, x0, y0, x1, y1) {
  const W = b.w, ca = b.cells[y0 * W + x0], cb = b.cells[y1 * W + x1];
  if (!sunk(b, ca) && !sunk(b, cb)) return false;
  const ha = hollowOf(b, y0 * W + x0);
  if (ha && !byHollow(b, ha, x1, y1)) return true;
  const hb = hollowOf(b, y1 * W + x1);
  return !!hb && !byHollow(b, hb, x0, y0);
}
// Is a cell in a hollow (for the hover text and the tests)?
export const inHollow = (b, x, y) => sunk(b, b.cells[y * b.w + x]);

// ---------- hills into upper floors ----------
// Units on different floors of a building with storeys (b.floors): only a window between a hill and an upper floor
// joins them (windowSees).
export const acrossFloors = (b, a, t) => !!(b && b.floors) && (a.f || 0) !== (t.f || 0);
// The cells of floor f (the active one's are b.cells).
const floorCells = (b, f) => (b.floors && b.floors[f] ? b.floors[f].cells : b.cells);
// The height a unit stands at, in levels from the ground floor: its floor plus the cell's own height there (a hill's
// on the ground floor). (x, y): where it would stand (the AI weighing a cell).
export function standH(b, u, x = u.x, y = u.y) {
  const f = u.f || 0, c = floorCells(b, f)[y * b.w + x];
  return f + (c ? c.h ?? (CELL[c.k] && CELL[c.k].h) ?? 0 : 0);
}
// How far a unit sees from a height (combat.js sightRange with that height).
const reachFrom = (a, h) => a.sight + HEIGHT.SIGHT * h + (a.optic || 0) + (a.vsight || 0);
// Can a (at ax, ay) see t on another floor? Only between someone on a hill on the ground floor and someone on an upper
// floor the hill reaches (the hill's height is the floor's or more), within the viewer's sight from its height (at
// night down its cones), along a line that gets into the building through an opening on that floor (a window) and
// nowhere else (crossLos).
export function windowSees(b, a, t, ax = a.x, ay = a.y) {
  if (!acrossFloors(b, a, t)) return false;
  const fa = a.f || 0, ft = t.f || 0;
  if (fa !== 0 && ft !== 0) return false;
  const [gx, gy, up] = fa === 0 ? [ax, ay, ft] : [t.x, t.y, fa];
  if (terH(b.floors[0].cells[gy * b.w + gx]) < up) return false; // the hill does not reach that floor
  const ha = standH(b, a, ax, ay), ht = standH(b, t);
  const d = Math.hypot(t.x - ax, t.y - ay);
  if (coned(b, a) ? !nightSees(b, a, t.x, t.y, d, HEIGHT.SIGHT * ha + (a.optic || 0)) : d > reachFrom(a, ha)) return false;
  return crossLos(b, ax, ay, ha + HEIGHT.EYE, t.x, t.y, ht + HEIGHT.EYE, up);
}
// The line of sight between two eyes at absolute heights e0 and e1 across the floors of a building with storeys: outside
// the building (no upper floor there) the ground floor's cells block as combat.js los has them (hills, trees, walls);
// inside it the line must stay on floor `up` (the one being looked into: a slab, a lower storey or the roof between
// blocks it), where that floor's walls, shelving and closed doors block and its windows (and anything open) let it
// through. Grazing a cell's edge never blocks (a corner glimpsed past).
export function crossLos(b, x0, y0, e0, x1, y1, e1, up) {
  const W = b.w, F = b.floors, ground = F[0].cells;
  const dx = x1 - x0, dy = y1 - y0, n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 4);
  for (let i = 1; i < n; i++) {
    const px = x0 + 0.5 + (dx * i) / n, py = y0 + 0.5 + (dy * i) / n;
    const cx = Math.floor(px), cy = Math.floor(py);
    if ((cx === x0 && cy === y0) || (cx === x1 && cy === y1)) continue;
    const fx = px - cx, fy = py - cy;
    if (!(fx > 0.12 && fx < 0.88 && fy > 0.12 && fy < 0.88)) continue; // an edge grazed
    const k = cy * W + cx, e = e0 + ((e1 - e0) * i) / n;
    let inside = false;
    for (let g = 1; g < F.length && !inside; g++) if (F[g].cells[k].k !== "void") inside = true;
    if (inside) {
      const g = Math.floor(e);
      if (g !== up) return false; // through a floor, the roof or a lower storey
      const c = F[g].cells[k], C = CELL[c.k];
      if (!C || c.k === "void") continue;
      if (e <= g + losTop(c, C)) return false;
    } else {
      const c = ground[k], C = CELL[c.k];
      if (C && e <= losTop(c, C)) return false;
    }
  }
  return true;
}
// The cover t has on another floor against a shooter at (ax, ay): combat.js coverAgainst on t's own floor (the sill of
// the window they stand at, a wall beside them), the height rule by `rise` (t's height over the shooter's).
export function floorCover(b, t, tx, ty, ax, ay, rise) {
  const keep = b.cells;
  b.cells = floorCells(b, t.f || 0);
  try { return coverAgainst(b, tx, ty, ax, ay, rise); } finally { b.cells = keep; }
}
// Standing on another floor (away from the active one) but on their feet: a target across the floors.
export const standsAway = (t) => !!t.away && activeAny(t) && !isTied(t);
// Still a target for a's shot: on a's floor and up, or on another one through a window.
export const shootable = (b, a, t) => active(t) || (activeAny(t) && !isTied(t) && acrossFloors(b, a, t));
// The foes of u on other floors it sees through a window (the AI's shot across: combat.js aiUnit, either side).
export function windowFoes(b, u) {
  if (!b.floors) return [];
  const foe = u.side === "enemy" ? "player" : u.side === "player" ? "enemy" : null;
  if (!foe) return [];
  return b.units.filter((o) => o.side === foe && activeAny(o) && !isTied(o) && !o.dormant && acrossFloors(b, u, o) && windowSees(b, u, o));
}
// Does anyone of a side see t on another floor through a window (the fog's markers: combat.js playerSees, sideSees)?
export function windowSeen(b, side, t) {
  if (!b.floors) return false;
  return b.units.some((o) => o.side === side && activeAny(o) && !isTied(o) && (o.f || 0) !== (t.f || 0) && windowSees(b, o, t));
}

// ---------- where the AI stands ----------
// combat.js scoreCell: a person with a gun likes the high ground (a hill's levels, up to MAX_LV) and keeps out of a
// hollow (it sees only the rim from there).
export function terrainScore(b, x, y) {
  const c = b.cells[y * b.w + x], g = c && c.ter ? (c.h || 0) + mapLv(b) : 0; // from level ground (combat.js mapLv)
  return g > 0 ? TERRAIN_AI.HIGH * Math.min(g, TERRAIN_AI.MAX_LV) : g < 0 ? -TERRAIN_AI.HOLLOW * -g : 0;
}
