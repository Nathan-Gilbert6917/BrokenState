// The season on the ground of the battle, raid and base maps (the user's request 2026-10-23: "In raid and base view:
// Spring can create random mud on dirt tiles slows movement speed. Fall can have the red orange and brown leaves on
// the ground. Winter has snow on the ground slowing movement speed."): how ui/isoview.js paints it, texel by texel,
// on the flat ground (floorColor, flatGroundFor / groundFor), the hills' tops (terrainPrims) and the skirt past the
// map's edge (battleedge.js skirtFor). Drawing only; what lies where is sim/seasonground.js's (c.gnd "mud" | "snow",
// c.sd the snow's depth, b.ground) and the leaves are the season's look (ui/seasontrees.js treeLookFor).
//   - Spring's mud: dark wet earth with a puddle's grey sheen here and there, its edges ragged.
//   - Winter's snow: drifts covering snowShare(depth) of the ground (all of it at full cover), the rest frosted.
//   - Autumn's leaves: FALL's red, orange, brown and rust (ui/seasontrees.js, the trees' own) scattered on the
//     outdoor ground, more as the season goes on (LEAF.BASE by the look) and thickest under and near the trees
//     (LEAF.NEAR within LEAF.R cells), fewer on the road; none on water, a building's floor or the snow.
// Every picture keyed (groundLookKey): a new season, snow or mud paints the ground again; nothing here runs per frame.
// API: groundTexel(col, c, X, Y, lf) -> the texel's colour; snowShare(depth); leafBase(look); leafField(b, look, key)
//      -> per-cell leaf density (or null); groundLookKey(b, look); LEAF.
import { FALL } from "./seasontrees.js";

export const LEAF = {
  BASE: { fall0: 0.05, fall1: 0.09, fall2: 0.13, fall: 0.18 }, // leaves on open ground by the look (the season's days)
  NEAR: 0.6,     // more right under a tree, less further out
  R: 3,          // cells out from a tree that its leaves fall
  MAX: 0.55,     // the share of the ground's specks that are leaves at density 1
  ROAD: 0.3,     // on the road and gravel (blown off, driven over)
  SNOW_ROAD: 0.85, // the snow's cover on the road and gravel (the asphalt shows through in patches)
  FLOORS: new Set(["grass", "field", "dirt", "gravel", "road", "rubble"]),
};
const MUD_C = [62, 44, 32], MUD_SHEEN = [74, 76, 84], SNOW_C = [221, 227, 232], SNOW_SHADE = [186, 198, 214];

function hash(a, b, c) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// Tables made once that the texels look up instead of hashing (a whole map's ground is millions of texels, painted
// again whenever the ground changes): LAT random values (256 × 256), DRIFT the snow's drifts and the mud's sheen,
// smooth noise (512 × 512 texels: 32 cells before it repeats).
let LAT = null, DRIFT = null;
function lat() {
  LAT = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) LAT[i] = hash(i & 255, i >> 8, 91);
  return LAT;
}
const rnd = (X, Y, k) => (LAT || lat())[(((Y + k * 97) & 255) << 8) | ((X + k * 61) & 255)]; // 0..1 at a point (repeats every 256)
// Smooth noise over the texels (s: texels between its points; a multiple of 512 / s apart wraps round).
function vnoise(X, Y, s, k) {
  const fx = X / s, fy = Y / s, ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy, m = Math.round(512 / s);
  const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  const a = rnd(ix % m, iy % m, k), b = rnd((ix + 1) % m, iy % m, k), c = rnd(ix % m, (iy + 1) % m, k), d = rnd((ix + 1) % m, (iy + 1) % m, k);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}
function drift() {
  DRIFT = new Float32Array(512 * 512);
  for (let Y = 0; Y < 512; Y++) for (let X = 0; X < 512; X++) DRIFT[Y * 512 + X] = vnoise(X, Y, 8, 3) * 0.75 + vnoise(X, Y, 4, 4) * 0.25;
  return DRIFT;
}
const driftAt = (X, Y) => (DRIFT || drift())[((Y & 511) << 9) | (X & 511)];
const mul = (c, f) => [c[0] * f, c[1] * f, c[2] * f];

/** The share of the ground under drifts at a snow cover (sim/seasonground.js c.sd, b.snowLie): all of it at 1. */
export const snowShare = (d) => (d > 0 ? Math.min(1, 0.35 + 0.65 * d) : 0);
/** The leaves on open ground for a look (ui/seasontrees.js treeSeason): none but autumn's. */
export const leafBase = (look) => (look && LEAF.BASE[look]) || 0;
/** The pictures' key part for the season on the ground: the cells' mud or snow (b.ground) and the leaves' look. */
export const groundLookKey = (b, look) => `${b && b.ground ? b.ground.key : ""}|${leafBase(look) ? look : ""}`;

// Per-cell leaf density (0..1) for a map in a look: the base, and more near the trees (cells: the ground floor's, where
// the trees stand). Memoised by the map, the look and the cells' key (isoview.js sceneFor's: trees felled change it).
let memo = { b: null, look: "", key: "", f: null };
/** @param {any} b @param {string} look @param {string} [key] @param {any[]} [cells] */
export function leafField(b, look, key = "", cells = b && b.cells) {
  const base = leafBase(look);
  if (!base || !b || !cells) return null;
  if (memo.b === b && memo.look === look && memo.key === key) return memo.f;
  const W = b.w, H = b.h, f = new Float32Array(W * H), R = LEAF.R;
  for (let i = 0; i < f.length; i++) f[i] = base;
  for (let i = 0; i < f.length; i++) {
    if (cells[i].k !== "tree") continue;
    const x = i % W, y = (i / W) | 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const nx = x + dx, ny = y + dy, d = Math.hypot(dx, dy);
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || d > R + 0.5) continue;
      const j = ny * W + nx;
      f[j] = Math.min(1, f[j] + LEAF.NEAR * (1 - d / (R + 1)));
    }
  }
  memo = { b, look, key, f };
  return f;
}

/**
 * A texel of the ground with the season on it. col: the ground's own colour; c: the cell (c.gnd, c.sd, c.f); X, Y:
 * the texel's place over the whole map (16 a cell; the hills' tops: art px); lf: the leaves' density there (0 none);
 * edge: how far in from the cell's edge (0 at it, 1 in the middle; the mud's ragged rim).
 * @param {number[]} col @param {any} c @param {number} X @param {number} Y @param {number} [lf] @param {number} [edge]
 */
export function groundTexel(col, c, X, Y, lf = 0, edge = 1) {
  X |= 0; Y |= 0;
  const q = rnd(X, Y, 1);
  if (c.gnd === "snow") {
    const share = snowShare(c.sd || 0) * (c.f === "road" || c.f === "gravel" ? LEAF.SNOW_ROAD : 1), n = driftAt(X, Y);
    if (n < share) { // its drifts, blue in their dips
      const t = Math.min(1, Math.max(0, n - share + 0.12) * 3), f = 0.95 + q * 0.06;
      return [(SNOW_C[0] + (SNOW_SHADE[0] - SNOW_C[0]) * t) * f, (SNOW_C[1] + (SNOW_SHADE[1] - SNOW_C[1]) * t) * f, (SNOW_C[2] + (SNOW_SHADE[2] - SNOW_C[2]) * t) * f];
    }
    return [col[0] + (SNOW_C[0] - col[0]) * 0.3, col[1] + (SNOW_C[1] - col[1]) * 0.3, col[2] + (SNOW_C[2] - col[2]) * 0.3]; // frosted between them
  }
  if (c.gnd === "mud") {
    if (edge < 0.25 && q < 0.45) return col; // the rim, ragged
    const n = driftAt(X + 211, Y + 137);
    if (n > 0.78) return mul(MUD_SHEEN, 0.9 + q * 0.2); // a puddle's sheen
    const f = 0.82 + n * 0.3 + q * 0.1;
    return [(MUD_C[0] * 0.82 + col[0] * 0.18) * f, (MUD_C[1] * 0.82 + col[1] * 0.18) * f, (MUD_C[2] * 0.82 + col[2] * 0.18) * f];
  }
  if (lf > 0 && LEAF.FLOORS.has(c.f) && !c.wet) {
    const sx = X >> 1, sy = Y >> 1, h = rnd(sx, sy, 7); // a leaf two texels across
    const p = lf * LEAF.MAX * (c.f === "road" || c.f === "gravel" ? LEAF.ROAD : 1);
    if (h < p) { const t = rnd(sx, sy, 8); return mul(FALL[Math.floor(t * FALL.length)], 0.8 + ((t * 7) % 1) * 0.35); }
  }
  return col;
}
