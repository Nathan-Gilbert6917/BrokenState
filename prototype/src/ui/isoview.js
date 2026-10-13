// The isometric battle view (pseudo-3D, the old X-COMs and Project Zomboid): the way a battle is drawn (the only
// battle view: there is no top-down one). A renderer only: every rule is in sim/combat.js; this module reads the battle and draws it.
//
// Geometry: 2:1 diamonds. In art pixels a tile is 32 × 16 and one height level (a walkway, a flat roof, an upper
// floor; a watchtower is two) LV px up. Everything is painted as pixel art at that size (procedural, in the State
// Map's gritty palette), cached, and drawn scaled up nearest-neighbour, so it stays crisp at any zoom:
//   - the ground of the whole map is one small canvas (floors textured by surface: grass, field, dirt, gravel,
//     asphalt, floorboards, concrete, rubble, water, mud and blood by the hive), rebuilt only when a floor changes or
//     the view turns;
//   - fog of war is one more (tiles none of your people see, dark and grey), rebuilt when what they see changes;
//   - every block (walls, fences, cars, trees, walkways, towers, barricades...) is a small sprite cached by its look.
// Each frame: the ground and the fog (two images), the highlights on the ground (move range, deploy cells, evac
// strip, zones), then every tile from the back to the front (painter's order: u + v, then height) with its block,
// the units standing on it, its front parts and its roof; then the silhouettes of your people hidden behind
// something, effects, labels, health bars and the cursor.
// Buildings have roofs. A building with one of your people inside (or an enemy you see, or the mouse) has its roof
// cut away and its near walls lowered to stubs (X-COM's cutaway); with Roofs off (B) every building is shown that way.
// Blocks between one of your people and the camera are drawn faded.
// Camera: pan (drag, the arrow keys, the screen edge), zoom (wheel, + / −: 9 steps), turn in eighths (Q / E, , and .:
// the four diagonal views and, between them, four straight ones looking down the map's rows and columns, where a
// tile is a rectangle and a corridor runs straight up the screen), center on the selected unit (Home). Mouse picking
// runs the screen point back along its view ray to the frontmost tile it hits (raised floors, walls and roofs
// included) or the unit sprite under it.
import { PAL as COL } from "./palette.js"; // good / bad colours (the colour-blind-safe set swaps them: ui/display.js)
import { battleOverlays } from "../sim/siege.js"; // fire, smoke, decoys, ladders, rams, auras as data (sim/siege.js)
import { CELL, active, coverSides, evacAt, barredCell, moveMob } from "../sim/combat.js";
import { canPlace } from "../sim/deploy.js";
import { acidAt } from "../sim/acid.js";
import { unitCanvas, unitFacing, muzzleOf } from "./sprites.js";
import { unitDownCanvas, drawDowned, downScale, corpseCanvas } from "./downsprites.js";
import { thirdRing } from "../sim/thirdside.js";
import { endangered, imminent } from "../sim/carriers.js"; // a body in danger from the worm
import { isMedic } from "../sim/medics.js"; // a med kit makes a medic: the cross tag
import { nlTags } from "./nonlethal.js"; // status tags of the non-lethal kit (sim/nonlethal.js)
import { battleWeather, fogColour, fogCss, skirtFor, drawVignette, setEdgeCanvas } from "./battleedge.js"; // the map's edge: ground fading into fog
import { paintLights, drawGlow, drawDarkness, drawShade, setLightsCanvas } from "./battlelights.js"; // night: flashlight beams, lantern pools, the darkness; by day a dark room's shade
import { ingestMarks, revealMarks, drawMarks, knownBody, setMarksCanvas } from "./battlemarks.js"; // blood, brass, scorch, glass that stay
import { drawGroundIso, drawPileIso } from "./ground.js";
import { groundPiles, pileCount } from "../sim/ground.js"; // things on the ground (sim/ground.js)

// ---------- constants ----------
const HW = 16, HH = 8;          // half a tile in art px (a tile: 32 × 16)
export const LV = 20;           // art px per height level
const WALL1 = 34, WALL2 = 2 * LV + 14, STUB = 7, PALISADE = LV + 9;
const UNIT_H = 30;              // a standing unit in art px
// Cars and trucks stand about head high on a survivor (the user's ask): their roofs at VEH_TOP art px. The bodies are
// drawn in their old proportions (roof at VEH_ROOF of the kind) and stretched up by VEH_TOP / roof, wheels from the ground.
const VEH_TOP = 28;
const VEH_ROOF = { m35: 20, humvee: 19, mrap: 21, truck: 17, car: 15, one: 16, oneTruck: 23 };
const vehZ = (roof) => VEH_TOP / roof;
export const ISO_ZOOMS = [0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5]; // CSS px per art px

// ---------- state ----------
const ROOFS_KEY = "brokenstate.battleRoofs";
export const iso = {
  rot: 0, straight: false, zoom: 4, cx: 0, cy: 0, battle: null, roofs: true,
  edge: null, edgeSince: 0, keys: new Set(), target: null, lastT: 0,
  rects: [], frameMs: 0, frames: 0, cw: 0, ch: 0,
  lastHover: null, // the hovered cell in the last frame: { x, y, hidden (behind a tree or other cover), cover, dash } (tools)
  builds: { scene: 0, ground: 0, fog: 0, looks: 0, sprites: 0 }, // how often each cache was (re)built (tools, the dev fps view)
};
try { iso.roofs = typeof localStorage === "undefined" || localStorage.getItem(ROOFS_KEY) !== "0"; } catch { iso.roofs = true; }
export function setRoofs(on) {
  iso.roofs = !!on;
  try { localStorage.setItem(ROOFS_KEY, on ? "1" : "0"); } catch { /* this session only */ }
}

// Canvas factory (the tools hand in a stub).
let mkCanvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
export function setIsoCanvas(fn) { mkCanvas = fn; clearIsoCache(); setEdgeCanvas(fn); setLightsCanvas(fn); setMarksCanvas(fn); }
const spriteCache = new Map();
let groundCache = null, fogCache = null, sceneCache = null, fogMaskCache = null, flatGroundCache = null;
export function clearIsoCache() { spriteCache.clear(); groundCache = fogCache = sceneCache = fogMaskCache = flatGroundCache = null; for (const k of Object.keys(looksCache)) delete looksCache[k]; }
export const isoCacheSize = () => spriteCache.size;

// ---------- small helpers ----------
function hash3(a, b, c) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const mul = (c, f) => [c[0] * f, c[1] * f, c[2] * f];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const css = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;

// ---------- view transforms ----------
// The view turns the map a quarter at a time: world (x, y) → view (u, v); the view grid is W × H, or H × W.
// iso.straight: the eighth before rotation iso.rot (between iso.rot − 1 and iso.rot), the camera looking straight
// along −v: the same view grid, a tile drawn as an SW × SH rectangle (the diamond's 32 × 16 turned an eighth:
// 16√2 × 8√2), screen x along u, the far side up the screen, only a block's top and its +v ("south") face showing.
const SW = 22, SH = 11;
// Art px (before the height) of a view point, a diamond's or a rectangle's; back; one art px up the screen as a step
// along the view ray toward the camera (picking, coverOf); the depth the painter sorts by (back to front).
const artX = (u, v, st) => (st ? u * SW : (u - v) * HW);
const artY = (u, v, st) => (st ? v * SH : (u + v) * HH);
const artUV = (ax, ay, st) => (st ? [ax / SW, ay / SH] : [(ay / HH + ax / HW) / 2, (ay / HH - ax / HW) / 2]);
const rayK = (st) => (st ? [0, 1 / SH] : [1 / (2 * HH), 1 / (2 * HH)]);
const depth = (u, v, st) => (st ? v : u + v);
// The view's eighth, 0..7 (even: the diagonal views, iso.rot × 2; odd: the straight ones), and a cache key for it.
export const viewStep = () => (2 * iso.rot - (iso.straight ? 1 : 0) + 8) & 7;
const viewKey = () => `${iso.rot}${iso.straight ? "s" : ""}`;
export const viewDims = (b, r = iso.rot) => (r & 1 ? [b.h, b.w] : [b.w, b.h]);
export function toView(x, y, r, W, H) {
  switch (r & 3) { case 0: return [x, y]; case 1: return [H - 1 - y, x]; case 2: return [W - 1 - x, H - 1 - y]; default: return [y, W - 1 - x]; }
}
export function fromView(u, v, r, W, H) {
  switch (r & 3) { case 0: return [u, v]; case 1: return [v, H - 1 - u]; case 2: return [W - 1 - u, H - 1 - v]; default: return [W - 1 - v, u]; }
}
// A continuous point (tile units: a tile's center is x + 0.5).
function ptView(wx, wy, r, W, H) {
  switch (r & 3) { case 0: return [wx, wy]; case 1: return [H - wy, wx]; case 2: return [W - wx, H - wy]; default: return [wy, W - wx]; }
}
function ptWorld(u, v, r, W, H) {
  switch (r & 3) { case 0: return [u, v]; case 1: return [v, H - u]; case 2: return [W - u, H - v]; default: return [W - v, u]; }
}
// View directions: 0 +u, 1 −u, 2 +v, 3 −v. A world step (dx, dy) as a view direction.
function viewDir(dx, dy, r) {
  const [a, c] = toView(dx, dy, r, 1, 1);
  const [o0, o1] = toView(0, 0, r, 1, 1);
  const du = a - o0, dv = c - o1;
  return du > 0 ? 0 : du < 0 ? 1 : dv > 0 ? 2 : 3;
}
const VD = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Screen (CSS px) of a world point at height z (art px), for the current camera.
let FR = { S: 2, X0: 0, Y0: 0, r: 0, st: false, W: 1, H: 1 };
export function project(wx, wy, z = 0) {
  const [u, v] = ptView(wx, wy, FR.r, FR.W, FR.H);
  return [artX(u, v, FR.st) * FR.S + FR.X0, (artY(u, v, FR.st) - z) * FR.S + FR.Y0];
}
// The frame's transform (also used by the tests to project and pick without drawing).
function setFrame(b, cw, ch) {
  const S = ISO_ZOOMS[iso.zoom];
  FR = { S, X0: cw / 2 - iso.cx * S, Y0: ch / 2 - iso.cy * S, r: iso.rot, st: iso.straight, W: b.w, H: b.h, cw, ch };
  return FR;
}

// ---------- the scene: buildings, heights, what each cell looks like ----------
const WALLISH = new Set(["wall", "window", "door", "bdoor", "doorway", "smashed", "idoor", "odoor"]);
const FLOORED = new Set(["open", "counter", "cabinet", "shelf", "locker", "crate", "loft", "stairs", "rack", "table", "bed", "bars", "ladder"]);
// Furniture that stands on a building's upper floor (sim/buildingmaps.js: a cell with a height that is not walked on)
// is drawn on a slab of the upper floor, raised with it.
const FURNITURE = new Set(["counter", "cabinet", "shelf", "locker", "crate", "rack", "table", "bed", "hay", "bars"]);
FLOORED.add("gunsafe"); FURNITURE.add("gunsafe"); // sim/locks.js gun safes: a steel box standing on the floor
// Buildings: 4-connected cells with floorboards (houses, shops, the base's buildings; flat-roofed blocks are solid).
const GROUNDY = new Set(["water", "trench", "spikes", "hivewall"]);
function sceneFor(b) {
  let sig = 0, fsig = 0;
  for (let i = 0; i < b.cells.length; i++) {
    const c = b.cells[i], kc = c.k.charCodeAt(0) * 7 + c.k.length + (c.k.charCodeAt(2) || 0), fc = (c.f ? c.f.charCodeAt(0) + c.f.length : 0) + (c.fl ? c.fl.charCodeAt(0) * 3 + c.fl.length : 0);
    sig = (Math.imul(sig, 31) + kc + fc + (c.hp > 0 ? (c.hp | 0) + 1 : 0)) | 0;
    fsig = (Math.imul(fsig, 31) + fc + (GROUNDY.has(c.k) ? kc : 0)) | 0;
  }
  // On an upper floor the ground outside the footprint is the ground floor's (floors change the key too).
  const fl = floorNo(b);
  if (fl) for (const c of b.floors[0].cells) fsig = (Math.imul(fsig, 31) + (c.f ? c.f.charCodeAt(0) + c.f.length : 0)) | 0;
  const key = `${b.w}x${b.h}:${fl}:${sig}`;
  if (sceneCache && sceneCache.b === b && sceneCache.key === key) return sceneCache;
  const n = b.w * b.h, comp = new Int16Array(n).fill(-1), blds = [];
  for (let i = 0; i < n; i++) {
    if (comp[i] >= 0 || b.cells[i].f !== "floor") continue;
    const id = blds.length, cells = [], q = [i];
    comp[i] = id;
    while (q.length) {
      const j = q.pop(); cells.push(j);
      const x = j % b.w, y = (j / b.w) | 0;
      for (const [dx, dy] of VD) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= b.w || ny >= b.h) continue;
        const k = ny * b.w + nx;
        if (comp[k] < 0 && b.cells[k].f === "floor") { comp[k] = id; q.push(k); }
      }
    }
    let two = false, inner = 0;
    for (const j of cells) { const c = b.cells[j]; if (c.t === 2 || c.k === "loft") two = true; if (!WALLISH.has(c.k)) inner++; }
    blds.push({ id, cells, top: two ? WALL2 : WALL1, two, inner, mat: Math.floor(hash3(i, b.w, 7) * 4) });
  }
  // The shell: a building's cells on its outside edge (next to a cell of no building or the map's edge). Seen from the
  // street, so drawn even where nobody has looked inside (the interior's fog of war: drawIso).
  const ext = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (comp[i] < 0) continue;
    const x = i % b.w, y = (i / b.w) | 0;
    for (let dy = -1; dy <= 1 && !ext[i]; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= b.w || ny >= b.h || comp[ny * b.w + nx] !== comp[i]) { ext[i] = 1; break; }
    }
  }
  // Single wall cells (no floor: a raid's locked doors in the open) stand alone.
  sceneCache = { b, key, comp, blds, ext, sig, groundKey: `${b.w}x${b.h}:${fl}:${fsig}` };
  iso.builds.scene++;
  return sceneCache;
}
// ---------- floors (docs/multi-storey-crawl.md) ----------
// A building with real storeys: b.floors[f] = { cells, reach, losCache, name }, every floor the size of the ground
// map, b.floor the active one (b.cells aliases it), `void` cells outside the footprint on the upper floors, u.f a
// unit's floor. The scene is built for the active floor: inside the footprint every cell is raised b.floor levels
// (the floor you see into), the storeys below are the building's outer wall mass, the storeys above are cut away
// and the roof is drawn only on the top floor; outside the footprint the ground stays at level 0, dimmed. A battle
// without b.floors (every other fight) has no lift anywhere and draws as it always did.
export const floorsOf = (b) => (b && b.floors && b.floors.length > 1 ? b.floors : null);
export const floorNo = (b) => (floorsOf(b) ? Math.max(0, Math.min(b.floors.length - 1, b.floor | 0)) : 0);
export const liftOf = (b) => floorNo(b) * LV; // art px the active floor is raised
const isVoid = (c) => c.k === "void";
const liftAt = (b, i) => (floorNo(b) && !isVoid(b.cells[i]) ? floorNo(b) * LV : 0);
// Something (a unit, a container, a room, a ghost, an effect) on the active floor: its f, 0 when it has none, as
// sim/combat.js counts it. Always true when the battle has no floors.
export const onFloor = (b, t) => !floorsOf(b) || (t.f || 0) === floorNo(b);
// A cell's rules, with a stand-in for `void` until sim/combat.js knows it.
const VOIDDEF = { walk: false, cover: 0, los: false, name: "Open air" };
const cdef = (c) => CELL[c.k] || VOIDDEF;
const hAt = (b, x, y) => { const c = b.cells[y * b.w + x]; return c.h ?? cdef(c).h ?? 0; };
// The height a unit stands at, and how tall a cell's block is drawn (for picking, fading and labels).
const standZ = (b, x, y) => hAt(b, x, y) * LV + liftAt(b, y * b.w + x);

// ---------- the pixel painter ----------
// Primitives in tile-local view space (u, v from 0 to 1 across the tile, z in art px up), painted per pixel in the
// order given (back to front): box { u0, u1, v0, v1, z0, z1, m }, cylinder { cyl: [u, v, r], z0, z1, m }, blob
// (an ellipsoid) { blob: [u, v, z], ru, rz, m }. m(face, s, t, X, Y) returns [r, g, b] or null (a hole): face "top",
// "south" (the +v side, lit), "east" (the +u side, in shade), "side" (a cylinder), "blob"; s, t across and up it.
// st: painted for a straight view (iso.straight: the top and the south side only, no east side showing).
const LIGHT = { top: 1, south: 0.8, east: 0.62 };
const RX = (st) => (st ? SW : HW * Math.SQRT2), RY = (st) => (st ? SH : HH * Math.SQRT2); // a radius of one tile across, on screen
function primBounds(p, st) {
  if (p.cyl) {
    const [u, v, r] = p.cyl, cx = artX(u, v, st), cy = artY(u, v, st), rx = r * RX(st), ry = r * RY(st);
    return [cx - rx, cx + rx, cy - p.z1 - ry, cy - p.z0 + ry];
  }
  if (p.blob) {
    const [u, v, z] = p.blob, cx = artX(u, v, st), cy = artY(u, v, st) - z, rx = p.ru * RX(st);
    return [cx - rx, cx + rx, cy - p.rz, cy + p.rz];
  }
  if (st) return [p.u0 * SW, p.u1 * SW, p.v0 * SH - p.z1, p.v1 * SH - p.z0];
  return [(p.u0 - p.v1) * HW, (p.u1 - p.v0) * HW, (p.u0 + p.v0) * HH - p.z1, (p.u1 + p.v1) * HH - p.z0];
}
function paint(prims, { fog = false, outline = false, st = iso.straight } = {}) {
  let x0 = st ? 0 : -HW, x1 = st ? SW : HW, y0 = 0, y1 = st ? SH : 2 * HH;
  for (const p of prims) { const [a, b, c, d] = primBounds(p, st); x0 = Math.min(x0, a); x1 = Math.max(x1, b); y0 = Math.min(y0, c); y1 = Math.max(y1, d); }
  x0 = Math.floor(x0) - 1; y0 = Math.floor(y0) - 1; x1 = Math.ceil(x1) + 1; y1 = Math.ceil(y1) + 1;
  const w = x1 - x0, h = y1 - y0, buf = new Uint8ClampedArray(w * h * 4);
  const put = (i, c, f) => { buf[i] = c[0] * f; buf[i + 1] = c[1] * f; buf[i + 2] = c[2] * f; buf[i + 3] = 255; };
  for (const p of prims) {
    const [ba, bb, bc, bd] = primBounds(p, st);
    const px0 = Math.max(0, Math.floor(ba - x0)), px1 = Math.min(w, Math.ceil(bb - x0) + 1), py0 = Math.max(0, Math.floor(bc - y0)), py1 = Math.min(h, Math.ceil(bd - y0) + 1);
    for (let py = py0; py < py1; py++) for (let px = px0; px < px1; px++) {
      const X = px + x0 + 0.5, Y = py + y0 + 0.5, i = (py * w + px) * 4;
      if (p.cyl) {
        const [u, v, r] = p.cyl, cx = artX(u, v, st), cy = artY(u, v, st), rx = r * RX(st), ry = r * RY(st);
        const dx = (X - cx) / rx;
        if (dx < -1 || dx > 1) continue;
        const e = Math.sqrt(1 - dx * dx), top = cy - p.z1;
        if (Math.abs(Y - top) <= ry * e) { const c = p.m("top", X - cx, Y - top, X, Y); if (c) put(i, c, 1); continue; }
        if (Y > top && Y <= cy - p.z0 + ry * e) {
          const c = p.m("side", dx, cy - p.z0 + ry * e - Y, X, Y);
          if (c) put(i, c, 0.95 - 0.36 * ((dx + 1) / 2));
        }
        continue;
      }
      if (p.blob) {
        const [u, v, z] = p.blob, cx = artX(u, v, st), cy = artY(u, v, st) - z, rx = p.ru * RX(st);
        const nx = (X - cx) / rx, ny = (Y - cy) / p.rz, q = nx * nx + ny * ny;
        if (q > 1) continue;
        const nz = Math.sqrt(1 - q), l = 0.42 + 0.58 * clamp01(-0.45 * nx - 0.5 * ny + 0.75 * nz);
        const c = p.m("blob", nx, ny, X, Y);
        if (c) put(i, c, l);
        continue;
      }
      // A box: its top, then the lit south (+v) side, then the east (+u) side in shade (none in a straight view: edge on).
      const eps = 1e-6;
      if (st) {
        const u = X / SW, v = (Y + p.z1) / SH, su = (p.u1 - p.u0) * 16;
        if (u < p.u0 - eps || u > p.u1 + eps) continue;
        const s = (u - p.u0) * 16;
        if (v >= p.v0 - eps && v <= p.v1 + eps) {
          const t = (v - p.v0) * 16, sv = (p.v1 - p.v0) * 16, col = p.m("top", s, t, X, Y, su, sv);
          if (col) put(i, col, (s > su - 1 || t > sv - 1) && !p.flat ? 1.12 : 1);
          continue;
        }
        const z = p.v1 * SH - Y;
        if (z >= p.z0 - eps && z <= p.z1 + eps) {
          const t = z - p.z0, col = p.m("south", s, t, X, Y, su, p.z1 - p.z0);
          if (col) put(i, col, LIGHT.south * (t < 1.2 && !p.flat ? 0.82 : 1));
        }
        continue;
      }
      const a = X / HW;
      let c = (Y + p.z1) / HH, u = (c + a) / 2, v = (c - a) / 2;
      if (u >= p.u0 - eps && u <= p.u1 + eps && v >= p.v0 - eps && v <= p.v1 + eps) {
        const s = (u - p.u0) * 16, t = (v - p.v0) * 16, su = (p.u1 - p.u0) * 16, sv = (p.v1 - p.v0) * 16;
        const col = p.m("top", s, t, X, Y, su, sv);
        if (col) put(i, col, (s > su - 1 || t > sv - 1) && !p.flat ? 1.12 : 1);
        continue;
      }
      u = a + p.v1; let z = (u + p.v1) * HH - Y;
      if (u >= p.u0 - eps && u <= p.u1 + eps && z >= p.z0 - eps && z <= p.z1 + eps) {
        const s = (u - p.u0) * 16, t = z - p.z0, col = p.m("south", s, t, X, Y, (p.u1 - p.u0) * 16, p.z1 - p.z0);
        if (col) put(i, col, LIGHT.south * (t < 1.2 && !p.flat ? 0.82 : 1));
        continue;
      }
      v = p.u1 - a; z = (p.u1 + v) * HH - Y;
      if (v >= p.v0 - eps && v <= p.v1 + eps && z >= p.z0 - eps && z <= p.z1 + eps) {
        const s = (v - p.v0) * 16, t = z - p.z0, col = p.m("east", s, t, X, Y, (p.v1 - p.v0) * 16, p.z1 - p.z0);
        if (col) put(i, col, LIGHT.east * (t < 1.2 && !p.flat ? 0.82 : 1));
      }
    }
  }
  if (outline) {
    // The State Map's dark outline around a prop's silhouette.
    const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && buf[(y * w + x) * 4 + 3] === 255;
    const out = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) out.push((y * w + x) * 4);
    for (const i of out) { buf[i] = 11; buf[i + 1] = 12; buf[i + 2] = 14; buf[i + 3] = 230; }
  }
  if (fog) fogPixels(buf);
  const cv = mkCanvas(w, h);
  const c = cv.getContext("2d");
  const img = c.createImageData(w, h);
  img.data.set(buf);
  c.putImageData(img, 0, 0);
  return toBitmap({ cv, ox: x0, oy: y0, w, h });
}
// Fog of war on a sprite: darker, greyer, a little blue.
function fogPixels(buf) {
  for (let i = 0; i < buf.length; i += 4) {
    if (!buf[i + 3]) continue;
    const l = buf[i] * 0.3 + buf[i + 1] * 0.59 + buf[i + 2] * 0.11;
    buf[i] = (buf[i] * 0.35 + l * 0.65) * 0.42 + 6;
    buf[i + 1] = (buf[i + 1] * 0.35 + l * 0.65) * 0.42 + 8;
    buf[i + 2] = (buf[i + 2] * 0.35 + l * 0.65) * 0.42 + 14;
  }
}

// ---------- materials ----------
const n2 = (X, Y, k = 0) => hash3(Math.floor(X), Math.floor(Y), k);
const tex = (base, amt = 0.12, k = 0) => (f, s, t, X, Y) => mul(base, 1 - amt + n2(X, Y, k) * amt * 2);
const flatM = (c) => () => c;
const PAL = {
  brick: hex("#7e5440"), mortar: hex("#5a4e44"), plaster: hex("#9c8d74"), siding: hex("#6f5a40"), block: hex("#77746c"),
  cap: hex("#4e4842"), glass: hex("#5f8aa0"), frame: hex("#3a312a"), wood: hex("#7a5a3a"), woodLt: hex("#94704a"), woodDk: hex("#4e3a26"),
  log: hex("#76593a"), metal: hex("#6c737a"), metalDk: hex("#454b51"), rust: hex("#7e4c34"), tar: hex("#3d3c3d"), shingle: hex("#5a3e38"),
  conc: hex("#6c6b66"), flesh: hex("#6a2a30"), fleshDk: hex("#3e1418"), pod: hex("#ff5a3a"), leaf: hex("#3c5530"), leaf2: hex("#56642e"),
  bark: hex("#4a3826"), stone: hex("#77736c"), sand: hex("#8e7a52"), hay: hex("#b0914a"), tire: hex("#1e1e20"), red: hex("#8e3028"),
  blue: hex("#2f5d8a"), cloth: hex("#5a5244"),
};
const CAR_COLORS = ["#7a3b34", "#3b5a7a", "#6b6b6b", "#7a6a34", "#3f6b4a", "#5a4a6a"].map(hex);
// A building's walls by its material (0 brick, 1 plaster, 2 wooden siding, 3 concrete block).
function wallFace(mat, dmg) {
  return (f, s, t, X, Y) => {
    let c;
    if (mat === 0) { // brick: 8 × 4 courses, offset every other one
      const row = Math.floor(t / 4), off = row % 2 ? 4 : 0;
      c = (t % 4 < 1 || (s + off) % 8 < 1) ? PAL.mortar : mul(PAL.brick, 0.88 + n2(Math.floor((s + off) / 8), row, 3) * 0.24);
    } else if (mat === 1) c = mul(PAL.plaster, 0.9 + n2(X, Y, 5) * 0.16 - (t < 6 ? 0.12 * (1 - t / 6) : 0));
    else if (mat === 2) c = t % 4 < 1 ? PAL.woodDk : mul(PAL.siding, 0.88 + n2(Math.floor(s / 6), Math.floor(t / 4), 9) * 0.2);
    else c = (t % 6 < 1 || Math.floor(s + (Math.floor(t / 6) % 2) * 6) % 12 < 1) ? mul(PAL.block, 0.7) : mul(PAL.block, 0.92 + n2(X, Y, 2) * 0.1);
    if (dmg && n2(X, Y, 77) < dmg * 0.18) c = mul(c, 0.45); // cracks and holes
    return c;
  };
}
const capFace = (f, s, t, X, Y) => mul(PAL.cap, 0.92 + n2(X, Y, 4) * 0.14);
// Doors (sim/combat.js CELL door, idoor, odoor): a painted leaf, a light frame, brass; a locked one oxblood.
const DOORC = { leaf: hex("#b0602c"), locked: hex("#7a2622"), trim: hex("#e6d6ac"), brass: hex("#f0c440") };
// A door's top seen from above, in its colour with a light rim (roofs off, cut away or seen past): a locked one with
// its brass lock in the middle.
const doorCap = (k, o) => (f, s, t, X, Y) => (s < 1.5 || t < 1.5 || s >= 14.5 || t >= 14.5 ? DOORC.trim : k === "door" && !o.vault && s >= 6 && s < 10 && t >= 6 && t < 10 ? DOORC.brass : mul(o.vault ? PAL.metal : k === "door" ? DOORC.locked : DOORC.leaf, 1.02 + n2(X, Y, 4) * 0.1));

// ---------- what each kind of cell is made of ----------
// o: { v: a variant 0..3 from the cell's place, j: joins (bits 1 +u, 2 −u, 4 +v, 8 −v: same-kind neighbours), n:
// "u" | "v" (the axis to the inside of the building), top (wall height), stub, mat (building material), dmg 0..1,
// barred, dir (0..3: towards the higher neighbour, ladders and stairs), part "back" | "front" }.
const along = (o) => (o.j & 3 && !(o.j & 12) ? "u" : o.j & 12 && !(o.j & 3) ? "v" : o.n === "u" ? "v" : o.n === "v" ? "u" : o.v & 1 ? "v" : "u");
// A box spanning the tile along an axis, thin across it.
const run = (ax, c0, c1, z0, z1, m, a0 = 0, a1 = 1) => (ax === "u" ? { u0: a0, u1: a1, v0: c0, v1: c1, z0, z1, m } : { u0: c0, u1: c1, v0: a0, v1: a1, z0, z1, m });

// One cell's share of a car that covers 2 × 3–4 cells (sim/combat.js placeCar: o.car = { i, j, L, ax, kind, v }). The
// body is drawn in car-local units (a along its length 0..L, c across 0..2, z in art px) and clipped to this cell, so
// the cells' pieces meet into one car: a low body, a cabin of glass in the middle (a van's longer, a pickup's bed
// The Army trucks (sim/miltrucks.js TRUCK_KINDS body) in car-local units: [a0, a1, c0, c1, z0, z1, "body" | colour].
const MIL_TOPS = {
  m35: (L) => [[0.1, 1.4, 0.15, 1.85, 3, 13, "body"], [0.15, 0.5, 0.3, 1.7, 9, 14, "#1e2418"], [1.5, L - 0.1, 0.05, 1.95, 4, 19, "#6b6a48"], [1.5, L - 0.1, 0.92, 1.08, 19, 20, "#58573a"]],
  humvee: (L) => [[0.05, L - 0.05, 0.05, 1.95, 3, 11, "body"], [0.9, 1.9, 0.3, 1.7, 11, 15, "#1e2418"], [1.25, 1.65, 0.75, 1.25, 15, 19, "#3a4228"]],
  mrap: (L) => [[0.05, L - 0.05, 0.05, 1.95, 4, 20, "body"], [0.05, 0.4, 0.4, 1.6, 13, 18, "#1c2016"], [1.4, L - 0.4, 0.3, 1.7, 20, 21, "#55603a"]],
};
const MIL_WHEELS = { m35: (L) => [0.7, L - 1.5, L - 0.6], humvee: (L) => [0.6, L - 0.6], mrap: (L) => [0.7, L - 0.7] };
// behind), wheels at the corners; a truck is a tall cab and a box. The cell's local x/y then turn with the view (r).
// A vehicle's upgrades (sim/combat.js fitMapVehicle: car.up { p plating, s scrap plating, g glass, m mesh, t turret }):
// steel plates along both sides (two rows at level 2; patchy scrap plates), a grille over the cab's glass, a thick green
// tint for bulletproof glass, and a machine gun on a ring on the roof.
const upKey = (u) => (u ? `${u.p || 0}${u.s || 0}${u.g || 0}${u.m || 0}${u.t || ""}${u.manned ? "*" : ""}` : "");
const UP_ROOF = { humvee: [1.45, 19], m35: [0.8, 14], mrap: [1.2, 21], truck: [0.8, 16], car: [null, 15], vehicle: [null, 15] };
function carUpParts(car, L, parts) {
  const u = car.up;
  const steel = flatM(PAL.metal), steelDk = flatM(PAL.metalDk), rust = flatM(PAL.rust);
  if (u.p || u.s) {
    const top = u.p > 1 ? 13 : 9;
    for (const [c0, c1] of [[0.02, 0.12], [1.88, 1.98]]) {
      if (u.s) for (let a = 0.1; a < L - 0.2; a += 0.7) parts.push([a, Math.min(L - 0.1, a + 0.55), c0, c1, 2, 8, ((a * 10) | 0) % 2 ? rust : steelDk]);
      else parts.push([0.1, L - 0.1, c0, c1, 2, top, steel]);
    }
    if (u.p) parts.push([0.02, 0.1, 0.2, 1.8, 2, top, steel]); // the nose
  }
  const [ra, rz] = UP_ROOF[car.body] || UP_ROOF[car.kind] || UP_ROOF.car;
  if (u.m) parts.push([ra ?? L / 2 - 0.6, (ra ?? L / 2 - 0.6) + 0.12, 0.3, 1.7, rz - 6, rz - 1, steelDk]); // a grille over the windscreen
  if (u.g) parts.push([ra ?? L / 2 - 0.6, (ra ?? L / 2 - 0.6) + 0.06, 0.32, 1.68, rz - 6, rz - 2, flatM(hex("#5e8f86"))]); // thick green-tinted glass
  if (u.t) {
    const a = ra ?? L / 2;
    parts.push([a - 0.2, a + 0.2, 0.8, 1.2, rz, rz + 3, steelDk]);                         // the ring and the gunner's shield
    if (u.manned) parts.push([a - 0.3, a + 0.3, 0.7, 1.3, rz - 1, rz, flatM(hex("#e8c04a"))]); // manned: a bright ring round the hatch (the gunner stands in it)
    parts.push([Math.max(0, a - (u.t === "m2hb" ? 1.3 : 1.0)), a - 0.1, 0.95, 1.05, rz + 2, rz + 3, flatM(PAL.tar)]); // the barrel, over the cab (the front is a = 0)
  }
}
function carPieces(car, r) {
  const { i, j, L, ax, kind, v } = car, big = kind === "truck" || car.body === "truck"; // "vehicle": the team's own (blue), a truck or a car by car.body
  const body = car.wrecked ? hex("#2b2723") : kind === "vehicle" ? PAL.blue : big ? mul(PAL.rust, 0.8) : CAR_COLORS[v % CAR_COLORS.length]; // wrecked: blown up (sim/launchers.js)
  const paint = (f, s, t, X, Y) => { const q = n2(X, Y, 13); return big && q < 0.35 ? mul(PAL.tire, 1.4) : q > 0.93 ? mul(PAL.rust, 1.1) : mul(body, f === "top" ? 1 : 0.95); };
  const glass = (f) => (f === "top" ? mul(body, 0.8) : PAL.glass);
  const boxM = flatM(mul(PAL.tire, 1.6)), tire = flatM(PAL.tire);
  const parts = []; // [a0, a1, c0, c1, z0, z1, m]
  const wheel = (a, c) => parts.push([a - 0.3, a + 0.3, c - 0.2, c + 0.2, 0, 5, tire]);
  const mil = MIL_TOPS[car.body]; // an Army truck (sim/miltrucks.js): olive drab; wrecked faded, burned out near black; the team's own blue
  if (mil) {
    const col = car.wrecked ? hex("#2b2723") : kind === "vehicle" ? PAL.blue : car.mil && car.mil.cond === "burnt" ? hex("#2b2723") : car.mil && car.mil.cond === "wrecked" ? hex("#4a4a34") : hex("#4d5a32");
    const m = (f, s, t, X, Y) => { const q = n2(X, Y, 13); return q > 0.94 ? mul(PAL.rust, car.mil && car.mil.cond === "burnt" ? 0.6 : 1) : mul(col, f === "top" ? 1 : 0.92); };
    for (const [a0, a1, c0, c1, z0, z1, k] of mil(L)) parts.push([a0, a1, c0, c1, z0, z1, k === "body" ? m : flatM(hex(k))]);
    for (const a of MIL_WHEELS[car.body](L)) { wheel(a, 0.2); wheel(a, 1.8); }
  } else if (car.body === "bike") { // a bike or a motorcycle: 2 x 1 cells, wheels at each end, a low frame, a seat and the bars
    const frame = flatM(kind === "vehicle" ? PAL.blue : mul(PAL.metal, 1.1)), dark = flatM(PAL.tire);
    parts.push([0.15, 0.65, 0.4, 0.6, 0, 6, dark], [1.35, 1.85, 0.4, 0.6, 0, 6, dark], [0.45, 1.55, 0.44, 0.56, 4, 7, frame], [0.75, 1.15, 0.38, 0.62, 7, 9, flatM(PAL.cloth)], [1.45, 1.55, 0.2, 0.8, 9, 11, frame]);
  } else if (big) {
    parts.push([0.1, 1.35, 0.15, 1.85, 3, 10, paint], [0.25, 1.3, 0.25, 1.75, 10, 16, glass]);  // the cab
    parts.push([1.5, L - 0.1, 0.1, 1.9, 3, 17, boxM]);                                         // the box
    for (const a of [0.7, L - 1.4, L - 0.6]) { wheel(a, 0.2); wheel(a, 1.8); }
  } else {
    parts.push([0.1, L - 0.1, 0.15, 1.85, 3, 9, paint]);                                       // the body
    if (L === 3) parts.push([0.9, 2.1, 0.3, 1.7, 9, 15, glass]);                               // a sedan's cabin
    else if (v % 2) parts.push([0.8, 3.7, 0.3, 1.7, 9, 15, glass]);                            // a van
    else parts.push([0.8, 2.0, 0.3, 1.7, 9, 15, glass], [2.2, 3.8, 0.25, 1.75, 9, 11, paint]); // a pickup: cab and bed
    for (const a of [0.6, L - 0.6]) { wheel(a, 0.2); wheel(a, 1.8); }
  }
  if (car.up) carUpParts(car, L, parts); // its upgrades (sim/vehicles.js): plating, grilles, the gun on its roof
  // Head high (VEH_TOP): every piece stretched up from the ground by the kind's factor (a bike stays as it is).
  const zk = car.body === "bike" ? 1 : vehZ(mil ? VEH_ROOF[car.body] : big ? VEH_ROOF.truck : VEH_ROOF.car);
  if (zk !== 1) for (const q of parts) { q[4] *= zk; q[5] *= zk; }
  // Clip to this cell, to local 0..1 along the world axes, then into the view's frame.
  const loc = (fx, fy) => (r & 3) === 0 ? [fx, fy] : (r & 3) === 1 ? [1 - fy, fx] : (r & 3) === 2 ? [1 - fx, 1 - fy] : [fy, 1 - fx];
  const out = [];
  for (const [a0, a1, c0, c1, z0, z1, m] of parts) {
    const A0 = Math.max(a0, i) - i, A1 = Math.min(a1, i + 1) - i, C0 = Math.max(c0, j) - j, C1 = Math.min(c1, j + 1) - j;
    if (A1 - A0 <= 0.02 || C1 - C0 <= 0.02) continue;
    const [fx0, fx1, fy0, fy1] = ax === "x" ? [A0, A1, C0, C1] : [C0, C1, A0, A1];
    const [ua, va] = loc(fx0, fy0), [ub, vb] = loc(fx1, fy1);
    out.push({ u0: Math.min(ua, ub), u1: Math.max(ua, ub), v0: Math.min(va, vb), v1: Math.max(va, vb), z0, z1, m });
  }
  return out;
}
function prims(k, o) {
  const v = o.v || 0;
  if (o.car && (k === "car" || k === "truck" || k === "vehicle")) return carPieces(o.car, iso.rot);
  switch (k) {
    case "wall": case "window": case "door": case "idoor": {
      const top = o.stub ? STUB : o.top;
      const face = wallFace(o.mat ?? 0, o.dmg);
      const winFace = (axisFace) => (f, s, t, X, Y, sw) => {
        if (f === axisFace && !o.stub) {
          const w0 = 4, w1 = (sw || 16) - 4;
          if (k === "window" && s >= w0 && s < w1 && t >= 11 && t < 25) return s < w0 + 1 || s >= w1 - 1 || t < 12 || t >= 24 ? PAL.frame : mul(PAL.glass, 0.85 + (s - t) % 5 * 0.04 + (o.dmg ? -0.3 : 0));
          // A roller door (a garage bay, a loading dock): metal slats across the whole cell.
          if (o.roll && t < 25) return t >= 24 ? PAL.frame : mul(PAL.metal, Math.floor(t) % 3 < 1 ? 0.7 : 0.92 + n2(s, t, 2) * 0.08);
          // A door, big and bright enough to find across the map: a painted leaf with panels in a light frame and a
          // brass knob (a closed door); a locked one (sim/locks.js) oxblood with a steel bar across and a brass lock
          // plate, a vault door steel.
          if ((k === "door" || k === "idoor") && s >= 3 && s < 13 && t < 27) {
            if (s < 4 || s >= 12 || t >= 26) return DOORC.trim;
            if (k === "door" && t >= 13 && t < 15) return PAL.metalDk;
            if (k === "door" && s >= 7 && s < 10 && t >= 9 && t < 13) return DOORC.brass;
            if (k === "idoor" && s >= 9 && s < 11 && t >= 12 && t < 14) return DOORC.brass;
            return mul(o.vault ? PAL.metal : k === "door" ? DOORC.locked : DOORC.leaf, (Math.floor(t) % 9 < 1 || Math.floor(s) === 7 ? 0.8 : 0.95) + n2(s, t, 1) * 0.1);
          }
        }
        return face(f, s, t, X, Y);
      };
      const wf = o.n === "u" ? "east" : o.n === "v" ? "south" : null;
      const cap = k === "door" || k === "idoor" ? doorCap(k, o) : capFace; // a door's top in its colour: found from above at any turn of the view
      const m = (f, s, t, X, Y, sw, sh) => (f === "top" ? cap(f, s, t, X, Y) : wf ?winFace(wf)(f, s, t, X, Y, sw, sh) : winFace("south")(f, s, t, X, Y, sw, sh) || winFace("east")(f, s, t, X, Y, sw, sh));
      return [{ u0: 0, u1: 1, v0: 0, v1: 1, z0: 0, z1: top, m }];
    }
    case "bdoor": case "doorway": case "smashed": case "odoor": {
      // An opening in a wall: a post at each end of the wall's run and a lintel; a barred door, a door hanging off
      // its hinges, a door swung open (a roller door rolled up into its drum) or a broken window sill between them.
      const ax = o.n === "u" ? "v" : o.n === "v" ? "u" : along(o);
      const top = o.stub ? STUB : o.top, face = wallFace(o.mat ?? 0, 0), lin = top - 7;
      const back = [run(ax, 0, 1, 0, top, face, 0, 0.2)];
      const front = [run(ax, 0, 1, 0, top, face, 0.8, 1)];
      // An open door's lintel and posts are topped in the door's colour (found from above, as a shut one: doorCap).
      const lintel = k === "odoor" ? (f, s, t, X, Y) => (f === "top" ? mul(DOORC.leaf, 1.05 + n2(X, Y, 4) * 0.1) : face(f, s, t, X, Y)) : face;
      if (k === "odoor") { back[0] = run(ax, 0, 1, 0, top, lintel, 0, 0.2); front[0] = run(ax, 0, 1, 0, top, lintel, 0.8, 1); }
      if (!o.stub) front.unshift(run(ax, 0, 1, lin, top, lintel, 0.2, 0.8));
      if (k === "bdoor") back.push(run(ax, 0.42, 0.58, 0, o.stub ? STUB : lin, (f, s, t) => (t > 9 && t < 12 ? PAL.metal : mul(PAL.wood, 0.85 + ((s | 0) % 3 === 0 ? -0.15 : 0.08))), 0.2, 0.8));
      if (k === "doorway" || (k === "odoor" && !o.roll)) {
        const wood = k === "odoor" ? tex(DOORC.leaf, 0.12) : tex(PAL.woodDk, 0.15);
        back.push(ax === "u" ? { u0: 0.2, u1: 0.28, v0: 0.1, v1: 0.62, z0: 0, z1: Math.min(lin, k === "odoor" ? 24 : 22), m: wood } : { u0: 0.1, u1: 0.62, v0: 0.2, v1: 0.28, z0: 0, z1: Math.min(lin, k === "odoor" ? 24 : 22), m: wood });
      }
      if (k === "odoor" && o.roll && !o.stub) front.unshift(run(ax, 0.3, 0.7, lin - 4, lin, tex(PAL.metal, 0.12), 0.2, 0.8));
      if (k === "smashed") back.push(run(ax, 0.2, 0.8, 0, 8, face, 0.2, 0.8));
      return o.part === "front" ? front : back;
    }
    case "palisade": {
      // The base's wall line: upright logs with pointed tops and a sheet-metal brace; battered ones are shorter.
      const ax = along(o), top = o.stub ? STUB : PALISADE;
      const logs = [];
      for (let i = 0; i < 4; i++) {
        const a = 0.125 + i * 0.25, hgt = top - (o.dmg ? Math.floor(hash3(i, v, 11) * o.dmg * 14) : 0) - (i % 2) * 2;
        const lm = (f, s, t, X, Y) => (f === "top" ? PAL.woodLt : mul(PAL.log, 0.85 + n2(X, Y, 6) * 0.2 - (t > hgt - 3 ? 0.15 : 0)));
        logs.push(ax === "u" ? { cyl: [a, 0.5, 0.13], z0: 0, z1: hgt, m: lm } : { cyl: [0.5, a, 0.13], z0: 0, z1: hgt, m: lm });
      }
      logs.push(run(ax, 0.62, 0.66, 12, 16, tex(PAL.metal, 0.1)));
      return logs;
    }
    case "gate": {
      const ax = along(o), face = (f, s, t, X, Y) => mul(PAL.log, 0.85 + n2(X, Y, 6) * 0.2);
      const posts = { back: [run(ax, 0.3, 0.7, 0, PALISADE + 3, face, 0, 0.14)], front: [run(ax, 0.3, 0.7, 0, PALISADE + 3, face, 0.86, 1)] };
      if (o.barred) posts.back.push(run(ax, 0.44, 0.56, 0, PALISADE - 2, (f, s, t) => (t > 12 && t < 16 ? PAL.metal : mul(PAL.wood, (s | 0) % 4 === 0 ? 0.7 : 0.95)), 0.14, 0.86));
      else posts.back.push(ax === "u" ? { u0: 0.14, u1: 0.22, v0: 0.04, v1: 0.5, z0: 0, z1: PALISADE - 4, m: tex(PAL.wood, 0.12) } : { u0: 0.04, u1: 0.5, v0: 0.14, v1: 0.22, z0: 0, z1: PALISADE - 4, m: tex(PAL.wood, 0.12) });
      return posts[o.part === "front" ? "front" : "back"];
    }
    case "breach": case "rubble": {
      const out = [];
      for (let i = 0; i < 5; i++) {
        const a = hash3(i, v, 21), c = hash3(i, v, 22);
        out.push({ blob: [0.2 + a * 0.6, 0.2 + c * 0.6, 2], ru: 0.1 + hash3(i, v, 23) * 0.08, rz: 3 + hash3(i, v, 24) * 2, m: tex(k === "breach" ? PAL.log : PAL.stone, 0.2, i) });
      }
      return out.sort((p, q) => p.blob[0] + p.blob[1] - q.blob[0] - q.blob[1]);
    }
    case "tower": {
      // A watchtower: four posts, a platform two levels up, a rail around it (the near rails in front of whoever
      // stands there), a ladder up one post.
      const z = 2 * LV, wood = tex(PAL.wood, 0.14), dk = tex(PAL.woodDk, 0.1);
      if (o.part === "front") return [{ u0: 0, u1: 1, v0: 0.92, v1: 1, z0: z, z1: z + 7, m: dk }, { u0: 0.92, u1: 1, v0: 0, v1: 0.92, z0: z, z1: z + 7, m: dk }];
      return [
        { u0: 0.04, u1: 0.16, v0: 0.04, v1: 0.16, z0: 0, z1: z, m: dk }, { u0: 0.84, u1: 0.96, v0: 0.04, v1: 0.16, z0: 0, z1: z, m: dk },
        { u0: 0.04, u1: 0.16, v0: 0.84, v1: 0.96, z0: 0, z1: z, m: dk },
        { u0: 0.55, u1: 0.62, v0: 0.92, v1: 0.98, z0: 0, z1: z, m: (f, s, t) => (Math.floor(t) % 5 < 1 ? PAL.woodLt : PAL.woodDk) }, // the ladder
        { u0: 0.84, u1: 0.96, v0: 0.84, v1: 0.96, z0: 0, z1: z, m: dk },
        { u0: 0, u1: 1, v0: 0, v1: 1, z0: z - 3, z1: z, m: (f, s, t) => (f === "top" ? mul(PAL.woodLt, (s | 0) % 4 < 1 ? 0.75 : 0.95 + n2(s, t, 8) * 0.1) : PAL.woodDk) },
        { u0: 0, u1: 1, v0: 0, v1: 0.08, z0: z, z1: z + 7, m: wood }, { u0: 0, u1: 0.08, v0: 0.08, v1: 1, z0: z, z1: z + 7, m: wood },
      ];
    }
    case "walkway": case "loft": case "roof": {
      // Raised floors one level up: the wall's walkway (planks on a timber frame), an upper floor, a flat roof.
      const top = (f, s, t, X, Y) => (k === "roof" ? mul(PAL.tar, 0.9 + n2(X, Y, 3) * 0.25) : mul(k === "loft" ? PAL.wood : PAL.woodLt, (Math.floor(along(o) === "u" ? t : s) % 4 < 1 ? 0.72 : 0.92 + n2(X, Y, 8) * 0.12)));
      const side = k === "roof" ? wallFace(3, 0) : (f, s, t) => (Math.floor(t) % 10 < 2 || Math.floor(s) % 8 < 2 ? PAL.woodDk : mul(PAL.wood, 0.75));
      return [{ u0: 0, u1: 1, v0: 0, v1: 1, z0: 0, z1: LV, flat: k === "loft", m: (f, s, t, X, Y, a, c) => (f === "top" ? top(f, s, t, X, Y) : side(f, s, t, X, Y, a, c)) }];
    }
    case "stairs": {
      // Four steps rising towards the higher neighbour; separate boxes, drawn from the back to the front.
      const out = [], d = o.dir ?? 0;
      const m = (f, s, t) => (f === "top" ? PAL.woodLt : mul(PAL.wood, 0.85 + (t % 5 < 1 ? -0.2 : 0)));
      for (let i = 0; i < 4; i++) {
        const a0 = d === 0 || d === 2 ? i / 4 : 1 - (i + 1) / 4, a1 = a0 + 0.25, z1 = (i + 1) * (LV / 4);
        out.push(d < 2 ? { u0: a0, u1: a1, v0: 0.1, v1: 0.9, z0: 0, z1, m } : { u0: 0.1, u1: 0.9, v0: a0, v1: a1, z0: 0, z1, m });
      }
      return out.sort((p, q) => p.u0 + p.v0 - q.u0 - q.v0);
    }
    case "ladder": {
      const d = o.dir ?? 0, m = (f, s, t) => (Math.floor(t) % 5 < 1 ? PAL.woodLt : f === "top" ? PAL.woodLt : PAL.woodDk);
      const at = d === 0 ? [0.86, 0.94] : d === 1 ? [0.06, 0.14] : d === 2 ? [0.86, 0.94] : [0.06, 0.14];
      return d < 2 ? [{ u0: at[0], u1: at[1], v0: 0.25, v1: 0.75, z0: 0, z1: LV + 2, m }] : [{ u0: 0.25, u1: 0.75, v0: at[0], v1: at[1], z0: 0, z1: LV + 2, m }];
    }
    case "tree": {
      // A broad crown of leaves on a short trunk (olive in some; one in a few a dead, bare tree).
      const dead = v === 3 && o.alt, lc = v === 1 ? PAL.leaf2 : v === 2 ? mul(PAL.leaf, 0.85) : PAL.leaf;
      const leaf = (f, s, t, X, Y) => { const q = n2(X, Y, 12); return q > 0.84 ? mul(lc, 1.4) : q < 0.14 ? mul(lc, 0.58) : mul(lc, 0.92 + q * 0.12); };
      const bark = tex(PAL.bark, 0.2);
      const out = [{ cyl: [0.5, 0.5, 0.08], z0: 0, z1: dead ? 30 : 16, m: bark }];
      if (dead) out.push({ u0: 0.25, u1: 0.5, v0: 0.47, v1: 0.53, z0: 20, z1: 22, m: bark }, { u0: 0.47, u1: 0.53, v0: 0.5, v1: 0.8, z0: 24, z1: 26, m: bark }, { u0: 0.5, u1: 0.72, v0: 0.47, v1: 0.53, z0: 27, z1: 29, m: bark });
      else {
        const a = (hash3(v, 1, 3) - 0.5) * 0.2, c = (hash3(v, 2, 3) - 0.5) * 0.2;
        out.push({ blob: [0.36 + a, 0.42, 22], ru: 0.55, rz: 9, m: leaf }, { blob: [0.6, 0.38 + c, 25], ru: 0.5, rz: 9, m: leaf }, { blob: [0.52, 0.62, 21], ru: 0.55, rz: 9, m: leaf }, { blob: [0.5 + a, 0.5 + c, 31], ru: 0.45, rz: 9, m: leaf });
      }
      return out;
    }
    case "boulder": return [
      { blob: [0.42, 0.45, 7], ru: 0.42, rz: 9, m: tex(PAL.stone, 0.16, 4) }, { blob: [0.64, 0.6, 5], ru: 0.3, rz: 7, m: tex(mul(PAL.stone, 0.9), 0.16, 5) },
      { blob: [0.35, 0.7, 3], ru: 0.2, rz: 4, m: tex(mul(PAL.stone, 1.05), 0.16, 6) },
    ];
    case "rock": return [{ blob: [0.45, 0.48, 3], ru: 0.3, rz: 4.5, m: tex(mul(PAL.stone, 1.06), 0.16, 4) }, { blob: [0.62, 0.62, 2], ru: 0.17, rz: 3, m: tex(mul(PAL.stone, 0.9), 0.16, 5) }];
    case "car": case "truck": case "vehicle": {
      const ax = v & 1 ? "v" : "u", big = k === "truck";
      const body = k === "vehicle" ? PAL.blue : big ? mul(PAL.rust, 0.8) : CAR_COLORS[(v * 7 + (o.j || 0)) % CAR_COLORS.length];
      const paint = (f, s, t, X, Y) => { const q = n2(X, Y, 13); return big && q < 0.35 ? mul(PAL.tire, 1.4) : q > 0.93 ? mul(PAL.rust, 1.1) : mul(body, f === "top" ? 1 : 0.95); };
      const glass = (f, s, t, X, Y, sw, sh) => (f === "top" ? mul(body, 0.8) : t > 1 && t < sh - 1 && s > 1 && s < sw - 1 ? (big ? PAL.tire : PAL.glass) : mul(body, 0.8));
      const wheel = { m: flatM(PAL.tire) };
      const zk = vehZ(big ? VEH_ROOF.oneTruck : VEH_ROOF.one); // head high, as the multi-cell cars (carPieces)
      const L = (a0, a1, c0, c1, z0, z1, m) => run(ax, c0, c1, z0 * zk, z1 * zk, m, a0, a1);
      const out = [];
      for (const [a, c] of [[0.2, 0.2], [0.8, 0.2]]) out.push({ ...L(a - 0.08, a + 0.08, c, c + 0.08, 0, 5, wheel.m) });
      out.push(L(0.06, 0.94, big ? 0.14 : 0.22, big ? 0.86 : 0.78, 3, big ? 16 : 10, paint));
      out.push(big ? L(0.62, 0.92, 0.18, 0.82, 16, 23, glass) : L(0.28, 0.72, 0.27, 0.73, 10, k === "vehicle" ? 17 : 16, glass));
      if (k === "vehicle") out.push(L(0.08, 0.26, 0.22, 0.78, 10, 13, paint));
      for (const [a, c] of [[0.2, 0.72], [0.8, 0.72]]) out.push({ ...L(a - 0.08, a + 0.08, c, c + 0.08, 0, 5, wheel.m) });
      return out;
    }
    case "tanktrap": {
      // A bridge barricade's tank trap (sim/deploy.js, conquest.js): a steel hedgehog, three bars crossed on a post.
      const m = tex(PAL.metalDk, 0.14, 11);
      return [
        { u0: 0.42, u1: 0.58, v0: 0.42, v1: 0.58, z0: 0, z1: 12, m },
        run("u", 0.44, 0.56, 4, 6, m, 0.1, 0.9),
        run("v", 0.44, 0.56, 4, 6, m, 0.1, 0.9),
        run("u", 0.3, 0.42, 8, 10, m, 0.2, 0.8),
        run("v", 0.58, 0.7, 8, 10, m, 0.2, 0.8),
      ];
    }
    case "rail": {
      // A bridge's railing (sim/combat.js layRoad): concrete kerb, steel posts and two rails along the deck's edge.
      const ax = along(o), post = flatM(PAL.metalDk), bar = tex(PAL.metal, 0.1, 7), kerb = tex(PAL.conc, 0.1, 8);
      return [
        run(ax, 0.3, 0.7, 0, 3, kerb),
        run(ax, 0.46, 0.54, 10, 12, bar),
        run(ax, 0.46, 0.54, 5, 7, bar),
        ...[0.15, 0.5, 0.85].map((a) => (ax === "u" ? { u0: a - 0.05, u1: a + 0.05, v0: 0.44, v1: 0.56, z0: 3, z1: 13, m: post } : { u0: 0.44, u1: 0.56, v0: a - 0.05, v1: a + 0.05, z0: 3, z1: 13, m: post })),
      ];
    }
    case "fence": case "wire": {
      // Posts and rails along the line (towards the neighbours in the line; across the tile when alone).
      const wire = k === "wire", pm = tex(wire ? PAL.metalDk : PAL.woodDk, 0.12), rm = wire ? flatM(hex("#9a9a92")) : tex(PAL.wood, 0.14);
      const j = o.j & 15 || (along(o) === "u" ? 3 : 12);
      const out = [];
      const arm = (d, z0, z1) => { const [du, dv] = VD[d]; const a0 = du ? Math.min(0.5, 0.5 + du * 0.5) : 0.46, a1 = du ? Math.max(0.5, 0.5 + du * 0.5) : 0.54, c0 = dv ? Math.min(0.5, 0.5 + dv * 0.5) : 0.46, c1 = dv ? Math.max(0.5, 0.5 + dv * 0.5) : 0.54; return { u0: a0, u1: a1, v0: c0, v1: c1, z0, z1, m: rm }; };
      for (const d of [3, 1]) if (j & (1 << d)) { out.push(arm(d, wire ? 3 : 5, wire ? 4 : 7), arm(d, wire ? 7 : 10, wire ? 8 : 12)); }
      out.push({ u0: 0.45, u1: 0.55, v0: 0.45, v1: 0.55, z0: 0, z1: wire ? 10 : 14, m: pm });
      for (const d of [0, 2]) if (j & (1 << d)) { out.push(arm(d, wire ? 3 : 5, wire ? 4 : 7), arm(d, wire ? 7 : 10, wire ? 8 : 12)); }
      if (wire) for (let i = 0; i < 3; i++) out.push({ cyl: [0.25 + i * 0.25, 0.5, 0.1], z0: 4, z1: 5, m: flatM(hex("#8a8a82")) });
      return out;
    }
    case "sandbag": {
      const ax = along(o), bag = (f, s, t) => mul(PAL.sand, ((s | 0) % 5 < 1 || (t | 0) % 4 < 1 ? 0.72 : 0.95) + (f === "top" ? 0.05 : 0));
      return [run(ax, 0.22, 0.78, 0, 5, bag), run(ax, 0.28, 0.72, 5, 10, bag, 0.04, 0.96), run(ax, 0.34, 0.66, 10, 13, bag, 0.12, 0.88)];
    }
    case "barricade": {
      const ax = along(o);
      return [
        run(ax, 0.3, 0.7, 0, 15, (f, s, t) => (Math.floor(t) % 4 < 1 ? PAL.woodDk : mul(PAL.wood, 0.85 + hash3(Math.floor(t / 4), v, 2) * 0.25))),
        run(ax, 0.66, 0.74, 3, 17, tex(PAL.metal, 0.15, 3), 0.5, 0.95),
        ax === "u" ? { cyl: [0.25, 0.85, 0.12], z0: 0, z1: 5, m: flatM(PAL.tire) } : { cyl: [0.85, 0.25, 0.12], z0: 0, z1: 5, m: flatM(PAL.tire) },
      ];
    }
    case "crate": {
      const m = (f, s, t, X, Y, sw, sh) => (s < 1 || t < 1 || s > sw - 1 || t > sh - 1 || Math.abs(s - t * (sw / sh)) < 0.8 ? PAL.woodDk : mul(PAL.woodLt, 0.86 + n2(X, Y, 9) * 0.16));
      const out = [{ u0: 0.14, u1: 0.86, v0: 0.14, v1: 0.86, z0: 0, z1: 13, m }];
      if (v >= 2) out.push({ u0: 0.25, u1: 0.72, v0: 0.22, v1: 0.7, z0: 13, z1: 22, m });
      return out;
    }
    case "hay": return [{ cyl: [0.5, 0.5, 0.36], z0: 0, z1: 13, m: (f, s, t, X, Y) => mul(PAL.hay, f === "top" ? 1 - (Math.hypot(s, t * 2) % 4 < 1 ? 0.2 : 0) : 0.9 + n2(X, Y, 10) * 0.18) }];
    case "pump": return [
      { u0: 0.2, u1: 0.8, v0: 0.25, v1: 0.75, z0: 0, z1: 3, m: flatM(PAL.conc) },
      { u0: 0.32, u1: 0.68, v0: 0.36, v1: 0.64, z0: 3, z1: 22, m: (f, s, t) => (f !== "top" && t > 11 && t < 16 && s > 1.5 ? hex("#e6e2d8") : mul(PAL.red, 1.05)) },
    ];
    case "rack": {
      // Tall store shelving or a warehouse rack: uprights, boards, goods (they block sight: the aisles between).
      const ax = along(o);
      const goods = (f, s, t, X, Y) => (f === "top" ? PAL.metalDk : Math.floor(t) % 8 < 1 ? PAL.metalDk : n2(X, Y, 14) > 0.5 ? CAR_COLORS[Math.floor(n2(X, Y, 15) * 6)] : mul(PAL.wood, 0.6 + n2(X, Y, 16) * 0.3));
      return [run(ax, 0.26, 0.74, 0, 30, goods, 0, 1), run(ax, 0.24, 0.3, 0, 31, flatM(PAL.metalDk), 0, 0.06), run(ax, 0.24, 0.3, 0, 31, flatM(PAL.metalDk), 0.94, 1)];
    }
    case "table": {
      const top = (f) => (f === "top" ? mul(PAL.woodLt, 0.95) : PAL.wood);
      return [
        { u0: 0.2, u1: 0.26, v0: 0.2, v1: 0.26, z0: 0, z1: 9, m: flatM(PAL.woodDk) }, { u0: 0.74, u1: 0.8, v0: 0.2, v1: 0.26, z0: 0, z1: 9, m: flatM(PAL.woodDk) },
        { u0: 0.2, u1: 0.26, v0: 0.74, v1: 0.8, z0: 0, z1: 9, m: flatM(PAL.woodDk) },
        { u0: 0.14, u1: 0.86, v0: 0.14, v1: 0.86, z0: 9, z1: 11, m: top },
        { u0: 0.74, u1: 0.8, v0: 0.74, v1: 0.8, z0: 0, z1: 9, m: flatM(PAL.woodDk) },
      ];
    }
    case "bed": {
      const ax = along(o), sheet = (f, s, t, X, Y) => (f === "top" ? mul(hex("#8a8678"), 0.9 + n2(X, Y, 18) * 0.15) : mul(PAL.woodDk, 1));
      return [run(ax, 0.16, 0.84, 0, 4, flatM(PAL.woodDk), 0.02, 0.98), run(ax, 0.18, 0.82, 4, 8, sheet, 0.04, 0.96)];
    }
    case "bars": {
      // Cell bars: upright steel bars along the line, a rail at the top.
      const ax = along(o), top = o.stub ? STUB : 28, out = [];
      for (let i = 0; i < 5; i++) out.push(ax === "u" ? { u0: 0.06 + i * 0.2, u1: 0.1 + i * 0.2, v0: 0.46, v1: 0.54, z0: 0, z1: top, m: flatM(PAL.metal) } : { u0: 0.46, u1: 0.54, v0: 0.06 + i * 0.2, v1: 0.1 + i * 0.2, z0: 0, z1: top, m: flatM(PAL.metal) });
      out.push(run(ax, 0.44, 0.56, top - 2, top, flatM(PAL.metalDk)));
      return out;
    }
    case "gunsafe": { // sim/locks.js: a tall dark steel box, a brass dial and a handle on its faces, a frame round the door
      const face = (f, s, t, X, Y, sw) => {
        if (f === "top") return mul(PAL.metalDk, 0.7);
        const w = sw || 9, cx = w * 0.42, d = Math.hypot(s - cx, (t - 14) * 1.1);
        if (d < 1.6) return hex("#d9b23a");
        if (d < 2.2) return mul(PAL.metal, 1.1);
        if (s > w * 0.7 && s < w * 0.82 && t > 9 && t < 15) return mul(PAL.metal, 1.2);
        if (t < 1 || t > 21 || s < 0.8 || s > w - 0.8) return mul(PAL.metalDk, 0.55);
        return mul(PAL.metalDk, 0.8 + n2(X, Y, 21) * 0.08);
      };
      return [{ u0: 0.22, u1: 0.78, v0: 0.22, v1: 0.78, z0: 0, z1: 22, m: face }];
    }
    case "shelf": case "locker": case "cabinet": case "counter": {
      const ax = along(o);
      if (k === "locker") return [run(ax, 0.3, 0.72, 0, 26, (f, s, t) => (f !== "top" && (Math.floor(s) % 5 < 1 || (t > 18 && t < 20 && Math.floor(s) % 2)) ? PAL.metalDk : PAL.metal), 0.12, 0.88)];
      if (k === "shelf") return [run(ax, 0.32, 0.68, 0, 24, (f, s, t, X, Y) => (f === "top" ? PAL.woodDk : Math.floor(t) % 6 < 1 ? PAL.woodDk : n2(X, Y, 14) > 0.55 ? CAR_COLORS[Math.floor(n2(X, Y, 15) * 6)] : mul(PAL.wood, 0.55)), 0.08, 0.92)];
      if (k === "cabinet") return [run(ax, 0.26, 0.74, 0, 14, (f, s, t) => (f === "top" ? PAL.woodLt : Math.floor(t) % 5 < 1 || Math.floor(s) % 8 < 1 ? PAL.woodDk : PAL.wood), 0.1, 0.9)];
      return [run(ax, 0.24, 0.76, 0, 12, (f, s, t) => (f === "top" ? hex("#9a8a70") : t > 10 ? hex("#6a5a46") : mul(PAL.wood, 0.85)), 0.04, 0.96)];
    }
    case "well": return [
      { cyl: [0.5, 0.5, 0.34], z0: 0, z1: 9, m: (f, s, t, X, Y) => (f === "top" ? (Math.hypot(s, t * 2) < 6 ? hex("#1d2830") : PAL.stone) : mul(PAL.stone, (Math.floor(t) % 3 < 1 ? 0.7 : 0.95) + n2(X, Y, 3) * 0.1)) },
      { u0: 0.18, u1: 0.24, v0: 0.48, v1: 0.54, z0: 9, z1: 22, m: flatM(PAL.woodDk) }, { u0: 0.2, u1: 0.8, v0: 0.48, v1: 0.54, z0: 22, z1: 24, m: flatM(PAL.wood) },
    ];
    case "barrel": return [[0.32, 0.3], [0.7, 0.36], [0.46, 0.7]].map(([a, c], i) => ({ cyl: [a, c, 0.15], z0: 0, z1: 13, m: (f, s, t) => (f === "top" ? mul(PAL.blue, 0.8) : t > 4 && t < 5.5 ? PAL.metalDk : mul(i === 1 ? PAL.rust : PAL.blue, 1)) }));
    case "hivewall": {
      const out = [];
      // Mounds of flesh: wide lumps on lumps, veined, with glowing pods.
      for (let i = 0; i < 4; i++) {
        const a = 0.22 + hash3(i, v, 31) * 0.56, c = 0.22 + hash3(i, v, 32) * 0.56, hgt = 6 + hash3(i, v, 33) * 12 + (i === 0 ? 8 : 0);
        out.push({ blob: [a, c, hgt * 0.45], ru: 0.48 + hash3(i, v, 34) * 0.16, rz: hgt * 0.5 + 4, m: (f, s, t, X, Y) => { const q = n2(X, Y, 40 + i); return q > 0.97 ? PAL.pod : q < 0.16 ? PAL.fleshDk : (Math.floor(X + Y * 0.5) % 7 === 0 ? mul(PAL.flesh, 0.7) : mul(PAL.flesh, 0.85 + q * 0.3)); } });
      }
      return out.sort((p, q) => p.blob[0] + p.blob[1] - q.blob[0] - q.blob[1]);
    }
    case "spikes": {
      const out = [];
      for (let i = 0; i < 3; i++) for (let jj = 0; jj < 3; jj++) out.push({ u0: 0.2 + i * 0.25, u1: 0.25 + i * 0.25, v0: 0.2 + jj * 0.25, v1: 0.25 + jj * 0.25, z0: 0, z1: 6 + ((i + jj) % 2) * 2, m: flatM(hex("#b4a07a")) });
      return out;
    }
    case "trench": return [run(along(o) === "u" ? "u" : "v", 0.16, 0.22, 0, 7, flatM(PAL.woodDk), 0.2, 0.26), run(along(o) === "u" ? "u" : "v", 0.16, 0.22, 0, 7, flatM(PAL.woodDk), 0.7, 0.76)];
    case "beartrap": return [{ cyl: [0.5, 0.5, 0.2], z0: 0, z1: 2, m: (f, s, t) => (f === "top" && Math.hypot(s, t * 2) < 3 ? PAL.tire : PAL.metal) }];
    default: return [];
  }
}
const OUTLINED = new Set(["tree", "boulder", "rock", "car", "truck", "vehicle", "crate", "hay", "pump", "barrel", "well", "barricade", "sandbag", "hivewall"]);

// A cached sprite for a cell's look.
function sprite(k, o, fog) {
  const key = `${iso.straight ? "s|" : ""}${k}|${o.v}|${o.alt}|${o.j}|${o.n}|${o.top}|${o.stub ? 1 : 0}|${o.mat}|${o.dmg}|${o.barred ? 1 : 0}|${o.dir}|${o.part || ""}|${o.vault ? 1 : 0}|${o.roll ? 1 : 0}|${fog ? 1 : 0}|${o.car ? `${o.car.i},${o.car.j},${o.car.L},${o.car.ax},${o.car.kind},${o.car.v},${o.car.body || ""},${o.car.mil ? o.car.mil.cond : ""},${upKey(o.car.up)},${iso.rot & 3}` : ""}`;
  let s = spriteCache.get(key);
  if (s === undefined) {
    const p = prims(k, o);
    s = p.length ? paint(p, { fog, outline: OUTLINED.has(k) }) : null;
    iso.builds.sprites++;
    if (spriteCache.size > 3000) spriteCache.clear();
    spriteCache.set(key, s);
  }
  return s;
}
// A roof piece over one cell of a building: a flat slab at the walls' height with a lip on the outside edges.
function roofSprite(mat, top, edges, fog) {
  const key = `${iso.straight ? "s|" : ""}roof|${mat}|${top}|${edges}|${fog ? 1 : 0}`;
  let s = spriteCache.get(key);
  if (s === undefined) {
    const base = [PAL.tar, PAL.rust, PAL.shingle, PAL.conc][mat & 3];
    const m = (f, sx, t, X, Y) => {
      if (f !== "top") return mul(base, 0.7);
      if (mat === 1) return mul(base, Math.floor(sx) % 3 < 1 ? 0.78 : 0.95 + n2(X, Y, 3) * 0.12); // corrugated metal
      if (mat === 2) return mul(base, Math.floor(t) % 3 < 1 ? 0.72 : 0.92 + n2(Math.floor(sx / 3), Math.floor(t / 3), 2) * 0.16); // shingles
      return mul(base, 0.88 + n2(X, Y, 3) * 0.22);
    };
    const p = [{ u0: 0, u1: 1, v0: 0, v1: 1, z0: top, z1: top + 3, flat: true, m }];
    const lip = mul(base, 0.8), lm = () => lip;
    if (edges & 2) p.push({ u0: 0, u1: 0.08, v0: 0, v1: 1, z0: top + 3, z1: top + 5, m: lm });
    if (edges & 8) p.push({ u0: 0, u1: 1, v0: 0, v1: 0.08, z0: top + 3, z1: top + 5, m: lm });
    if (edges & 1) p.push({ u0: 0.92, u1: 1, v0: 0, v1: 1, z0: top + 3, z1: top + 5, m: lm });
    if (edges & 4) p.push({ u0: 0, u1: 1, v0: 0.92, v1: 1, z0: top + 3, z1: top + 5, m: lm });
    s = paint(p, { fog });
    iso.builds.sprites++;
    spriteCache.set(key, s);
  }
  return s;
}

// The storeys below the active floor (floorsOf): the building's outer wall mass under one footprint cell, from the
// ground up to the floor's base, no interior. faces: 1 the east (+u) side, 2 the south (+v) side, only where the
// neighbour in that direction is outside the footprint (the faces inside are hidden by the raised floor in front).
// A darker course marks each storey.
function massSprite(mat, lift, faces, fog) {
  const key = `${iso.straight ? "s|" : ""}mass|${mat}|${lift}|${faces}|${fog ? 1 : 0}`;
  let s = spriteCache.get(key);
  if (s === undefined) {
    const face = wallFace(mat & 3, 0);
    const m = (f, sx, t, X, Y) => {
      if (f === "top" || (f === "east" && !(faces & 1)) || (f === "south" && !(faces & 2))) return null;
      const c = face(f, sx, t, X, Y);
      return t % LV < 1 || t % LV >= LV - 1 ? mul(c, 0.55) : c;
    };
    s = faces ? paint([{ u0: 0, u1: 1, v0: 0, v1: 1, z0: 0, z1: lift, m }], { fog }) : null;
    iso.builds.sprites++;
    spriteCache.set(key, s);
  }
  return s;
}

// ---------- the ground ----------
const FLOORC = {
  grass: hex("#4a5834"), field: hex("#6a6238"), dirt: hex("#5c4f3e"), gravel: hex("#5c5a57"), road: hex("#37393d"), deck: hex("#5e5f5c"),
  floor: hex("#5a4632"), rubble: hex("#4e4842"), roof: hex("#6a6a64"),
  // A building's floors by room (sim/buildingmaps.js c.fl): tiles, concrete, carpet, a barn's dirt.
  tile: hex("#7a7668"), conc: hex("#5e5d5a"), carpet: hex("#4e3e44"), barn: hex("#5e5040"), straw: hex("#8a7440"),
};
function floorColor(c, k, x, y, lx, ly, mud) {
  const tx = Math.min(15, Math.floor(lx * 16)), ty = Math.min(15, Math.floor(ly * 16));
  const q = hash3(x * 16 + tx, y * 16 + ty, 1), v = hash3(x, y, 2);
  if (k === "water") {
    const w = hex("#2c4e68");
    return mul(w, 0.9 + ((tx + ty * 2 + Math.floor(v * 7)) % 9 === 0 ? 0.35 : 0) + q * 0.08);
  }
  if (k === "trench" || k === "spikes") return mul(hex("#2a2016"), 0.8 + q * 0.3 + (tx === 0 || ty === 0 || tx === 15 || ty === 15 ? 0.6 : 0));
  let col;
  switch (c.f) {
    case "grass": col = q > 0.9 ? mul(FLOORC.grass, 1.28) : q < 0.08 ? mul(FLOORC.grass, 0.72) : mul(FLOORC.grass, 0.92 + v * 0.14); break;
    case "field": col = tx % 4 === 0 ? mul(FLOORC.field, 0.74) : q > 0.8 ? mul(hex("#7d8a44"), 1) : mul(FLOORC.field, 0.94 + v * 0.1); break;
    case "dirt": col = q > 0.93 ? mul(FLOORC.dirt, 1.3) : mul(FLOORC.dirt, 0.9 + q * 0.12 + v * 0.06); break;
    case "gravel": col = mul(FLOORC.gravel, 0.78 + q * 0.38); break;
    case "road": {
      if (c.deck) { // a bridge's deck (sim/combat.js layRoad): weathered concrete slabs with their joints, paler than the asphalt
        col = (tx === 0 || ty === 0) ? mul(FLOORC.deck, 0.72) : q > 0.95 ? mul(FLOORC.deck, 0.82) : mul(FLOORC.deck, 0.94 + q * 0.1 + v * 0.04);
        if (ty >= 7 && ty <= 8 && (x * 16 + tx) % 16 < 7 && v > 0.35) col = hex("#8a8262"); // faded paint
        break;
      }
      col = q > 0.97 ? mul(FLOORC.road, 0.7) : mul(FLOORC.road, 0.92 + q * 0.1);
      if (ty >= 7 && ty <= 8 && (x * 16 + tx) % 16 < 7 && v > 0.35) col = hex("#7a7254"); // faded paint
      break;
    }
    case "floor":
      if (c.fl === "tile") col = tx % 8 === 0 || ty % 8 === 0 ? mul(FLOORC.tile, 0.72) : ((tx >> 3) + (ty >> 3)) % 2 ? mul(FLOORC.tile, 0.9 + q * 0.06) : mul(FLOORC.tile, 1.02 + q * 0.06);
      else if (c.fl === "conc") col = q > 0.96 ? mul(FLOORC.conc, 0.75) : mul(FLOORC.conc, 0.9 + q * 0.12 + v * 0.04);
      else if (c.fl === "carpet") col = mul(FLOORC.carpet, 0.86 + q * 0.22);
      else if (c.fl === "dirt") col = q > 0.9 ? FLOORC.straw : mul(FLOORC.barn, 0.88 + q * 0.16);
      else col = ty % 4 === 0 ? mul(FLOORC.floor, 0.68) : mul(FLOORC.floor, 0.88 + hash3(x * 4 + Math.floor((tx + (Math.floor(ty / 4) % 2) * 8) / 16), y * 4 + Math.floor(ty / 4), 3) * 0.2);
      break;
    case "rubble": col = q > 0.82 ? mul(FLOORC.rubble, 1.35) : q < 0.1 ? mul(FLOORC.rubble, 0.6) : mul(FLOORC.rubble, 0.92 + v * 0.1); break;
    case "roof": col = mul(FLOORC.roof, 0.86 + q * 0.2); break;
    default: col = mul(FLOORC.grass, 0.92 + q * 0.12);
  }
  if (mud) { const m = clamp01(mud - hash3(x * 16 + tx, y * 16 + ty, 9) * 0.6); if (m > 0) col = mix(col, q > 0.7 ? hex("#5a1a1c") : hex("#3e2a22"), m * 0.85); }
  return col;
}
// The whole map's ground at art resolution (one canvas; the view origin's top vertex at (Hv × 16, 0); in a straight
// view the origin at (0, 0): ox, the art x of its left edge).
function groundFor(b, scene) {
  const r = iso.rot, st = iso.straight, key = `${viewKey()}:${scene.groundKey}`;
  if (groundCache && groundCache.b === b && groundCache.key === key) return groundCache;
  const [Wv, Hv] = viewDims(b, r);
  // An upper floor (floorsOf): the canvas grows by the lift at the top (oy rows) and is painted twice: the ground
  // floor's surface at level 0, dimmed (looking down from the windows), then the footprint's cells raised.
  const lift = liftOf(b);
  const gw = st ? Wv * SW : (Wv + Hv) * HW, gh = (st ? Hv * SH : (Wv + Hv) * HH) + lift, ox = st ? 0 : -Hv * HW;
  const buf = new Uint8ClampedArray(gw * gh * 4);
  // Mud and blood around the hive's flesh.
  const mud = new Float32Array(b.w * b.h);
  for (let i = 0; i < b.cells.length; i++) if (b.cells[i].k === "hivewall") {
    const x = i % b.w, y = (i / b.w) | 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < b.w && ny < b.h) mud[ny * b.w + nx] = Math.max(mud[ny * b.w + nx], 1 - Math.hypot(dx, dy) / 3); }
  }
  const passes = lift ? [[b.floors[0].cells, 0, 0.55, false], [b.cells, lift, 1, true]] : [[b.cells, 0, 1, false]];
  for (const [cells, up, dim, footOnly] of passes) for (let py = 0; py < gh; py++) for (let px = 0; px < gw; px++) {
    const [u, v] = artUV(px + 0.5 + ox, py + 0.5 - lift + up, st);
    if (u < 0 || v < 0 || u >= Wv || v >= Hv) continue;
    const iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
    const [x, y] = fromView(iu, iv, r, b.w, b.h);
    const [lx, ly] = ptWorld(fu, fv, r, 1, 1);
    const c = cells[y * b.w + x];
    if (footOnly && isVoid(c)) continue;
    let col = floorColor(c, c.k, x, y, lx, ly, mud[y * b.w + x]);
    if (fu < 0.055 || fv < 0.055) col = mul(col, 0.86); // the grid, faintly
    if (dim < 1) col = mul(col, dim);
    const i = (py * gw + px) * 4;
    buf[i] = col[0]; buf[i + 1] = col[1]; buf[i + 2] = col[2]; buf[i + 3] = 255;
  }
  const cv = mkCanvas(gw, gh), c = cv.getContext("2d"), img = c.createImageData(gw, gh);
  img.data.set(buf);
  c.putImageData(img, 0, 0);
  groundCache = toBitmap({ b, key, cv, gw, gh, Hv, ox, oy: lift });
  iso.builds.ground++;
  return groundCache;
}
// The ground on one storey (no floor raised), painted once per battle in map space: 16 × 16 texels a tile, the
// texels floorColor works in, so the colours are the same; drawIso stretches it onto the diamonds with one affine
// transform for the view's rotation (groundXform). Half the pixels of the view-space picture and no repaint when the
// view turns (groundFor took about 300 ms on a 72 × 72 fort, at the open and on every turn of the view).
const TEX = 16;
function flatGroundFor(b, scene) {
  const key = scene.groundKey;
  if (flatGroundCache && flatGroundCache.b === b && flatGroundCache.key === key) return flatGroundCache;
  const tw = b.w * TEX, th = b.h * TEX;
  const mud = new Float32Array(b.w * b.h);
  for (let i = 0; i < b.cells.length; i++) if (b.cells[i].k === "hivewall") {
    const x = i % b.w, y = (i / b.w) | 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < b.w && ny < b.h) mud[ny * b.w + nx] = Math.max(mud[ny * b.w + nx], 1 - Math.hypot(dx, dy) / 3); }
  }
  const cv = mkCanvas(tw, th), c = cv.getContext("2d"), img = c.createImageData(tw, th), buf = img.data;
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const cell = b.cells[y * b.w + x], m = mud[y * b.w + x];
    for (let ty = 0; ty < TEX; ty++) for (let tx = 0; tx < TEX; tx++) {
      let col = floorColor(cell, cell.k, x, y, (tx + 0.5) / TEX, (ty + 0.5) / TEX, m);
      if (tx === 0 || ty === 0) col = mul(col, 0.86); // the grid, faintly
      const i = ((y * TEX + ty) * tw + x * TEX + tx) * 4;
      buf[i] = col[0]; buf[i + 1] = col[1]; buf[i + 2] = col[2]; buf[i + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  flatGroundCache = toBitmap({ b, key, cv });
  iso.builds.ground++;
  return flatGroundCache;
}
// The affine map from a map-space picture (`per` pixels a tile) to the screen: map (x, y) → view (u, v) for the
// rotation (toView, continuous) → the diamond's art px (ax = (u − v)·HW + Hv·HW, ay = (u + v)·HH; a straight view's
// rectangles: ax = u·SW + Hv·HW, ay = v·SH) → × S from (gx, gy).
function groundXform(b, r, per, S, gx, gy, Hv, st = iso.straight) {
  const W = b.w, H = b.h;
  const [au, bu, cu, av, bv, cv] = [[1, 0, 0, 0, 1, 0], [0, -1, H, 1, 0, 0], [-1, 0, W, 0, -1, H], [0, 1, 0, -1, 0, W]][r & 3];
  const X = (u, v) => artX(u, v, st), Y = (u, v) => artY(u, v, st); // linear in (u, v)
  return [S * X(au, av) / per, S * Y(au, av) / per, S * X(bu, bv) / per, S * Y(bu, bv) / per, gx + S * HW * Hv + S * X(cu, cv), gy + S * Y(cu, cv)];
}

// A finished picture as an ImageBitmap (the browser keeps it on the GPU; a canvas may be uploaded again and again),
// swapped in when it is ready; until then, and without createImageBitmap (the tools), the canvas itself.
function toBitmap(o) {
  if (typeof createImageBitmap === "function" && typeof HTMLCanvasElement !== "undefined" && o.cv instanceof HTMLCanvasElement) {
    createImageBitmap(o.cv).then((bm) => { o.cv = bm; }, () => { /* keep the canvas */ });
  }
  return o;
}
// Fog of war over the ground: every tile none of your people see.
function fogFor(b, vis) {
  let sig = 0;
  for (let i = 0; i < vis.length; i++) sig = (Math.imul(sig, 31) + vis[i] + i * 3) | 0;
  const r = iso.rot, st = iso.straight, lift = liftOf(b), key = `${b.w}x${b.h}:${viewKey()}:${floorNo(b)}:${sig}:${b.night ? 1 : 0}`;
  if (fogCache && fogCache.b === b && fogCache.key === key) return fogCache;
  const [Wv, Hv] = viewDims(b, r);
  const gw = st ? Wv * SW : (Wv + Hv) * HW, gh = (st ? Hv * SH : (Wv + Hv) * HH) + lift, ox = st ? 0 : -Hv * HW; // an upper floor: the footprint's diamonds raised (oy rows on top); ox as groundFor's

  const cv = fogCache && fogCache.canvas.width === gw && fogCache.canvas.height === gh ? fogCache.canvas : mkCanvas(gw, gh);
  const c = cv.getContext("2d");
  c.clearRect(0, 0, gw, gh);
  c.fillStyle = b.night ? "rgba(4,6,16,0.72)" : "rgba(10,12,18,0.58)";
  c.beginPath();
  for (let i = 0; i < vis.length; i++) {
    if (vis[i]) continue;
    const [u, v] = toView(i % b.w, (i / b.w) | 0, r, b.w, b.h);
    const x = artX(u, v, st) - ox, y = artY(u, v, st) + lift - liftAt(b, i);
    if (st) c.rect(x, y, SW, SH);
    else { c.moveTo(x, y); c.lineTo(x + HW, y + HH); c.lineTo(x, y + 2 * HH); c.lineTo(x - HW, y + HH); c.closePath(); }
  }
  c.fill();
  fogCache = toBitmap({ b, key, cv, canvas: cv, ox, oy: lift });
  iso.builds.fog++;
  return fogCache;
}

// The fog on one storey (no floor raised): a picture one pixel a tile in view order, stretched onto the diamonds when
// it is drawn (drawIso: an affine transform takes the unit square (u, v) onto that tile's diamond, nearest pixel).
// Rebuilt with what your people see after every move, so it must be cheap: a few thousand pixels, not a path of
// thousands of diamonds filled on a canvas the size of the whole map (about 100 ms on a 72 × 72 fort, every action).
const FOG_DAY = [10, 12, 18, 148], FOG_NIGHT = [4, 6, 16, 184]; // fogFor's rgba(10,12,18,0.58) and rgba(4,6,16,0.72)
function fogMaskFor(b, vis) {
  let sig = 0;
  for (let i = 0; i < vis.length; i++) sig = (Math.imul(sig, 31) + vis[i] + i * 3) | 0;
  const r = iso.rot, key = `${b.w}x${b.h}:${r}:${sig}:${b.night ? 1 : 0}`;
  if (fogMaskCache && fogMaskCache.b === b && fogMaskCache.key === key) return fogMaskCache;
  const [Wv, Hv] = viewDims(b, r);
  const cv = fogMaskCache && fogMaskCache.Wv === Wv && fogMaskCache.Hv === Hv ? fogMaskCache.cv : mkCanvas(Wv, Hv);
  const c = cv.getContext("2d"), img = c.createImageData(Wv, Hv), d = img.data, col = b.night ? FOG_NIGHT : FOG_DAY;
  for (let i = 0; i < vis.length; i++) {
    if (vis[i]) continue;
    const [u, v] = toView(i % b.w, (i / b.w) | 0, r, b.w, b.h), p = (v * Wv + u) * 4;
    d[p] = col[0]; d[p + 1] = col[1]; d[p + 2] = col[2]; d[p + 3] = col[3];
  }
  c.putImageData(img, 0, 0);
  fogMaskCache = { b, key, cv, Wv, Hv };
  iso.builds.fog++;
  return fogMaskCache;
}

// ---------- per-cell looks ----------
const JOINS = {
  wall: WALLISH, window: WALLISH, door: WALLISH, bdoor: WALLISH, doorway: WALLISH, smashed: WALLISH, idoor: WALLISH, odoor: WALLISH,
  rack: new Set(["rack", "shelf"]), bed: new Set(["bed"]), bars: new Set(["bars", "wall", "idoor", "odoor"]), table: new Set(["table"]),
  palisade: new Set(["palisade", "gate", "breach", "siegeladder"]), gate: new Set(["palisade", "gate", "breach", "siegeladder"]),
  fence: new Set(["fence"]), wire: new Set(["wire"]), rail: new Set(["rail"]), sandbag: new Set(["sandbag", "barricade"]), barricade: new Set(["barricade", "sandbag"]),
  walkway: new Set(["walkway", "tower"]), trench: new Set(["trench"]), shelf: WALLISH, locker: WALLISH, cabinet: WALLISH, counter: WALLISH,
};
// What a cell looks like in this view: its kind and options (see prims), or null for open ground. focus: on a building's
// own map (sim/buildingmaps.js) the cutaway lowers only the walls within CUT_R tiles of these points (your people, the
// mouse, enemies you see), so the rest of a big building keeps its walls standing.
const CUT_R = 6;
function lookOf(b, scene, x, y, cut, focus = null) {
  const i = y * b.w + x, c = b.cells[i], k = c.k === "siegeladder" ? "palisade" : c.k; // a siege ladder leans on its wall (drawn on top: drawSiegeIso)
  if (k === "open" || k === "water" || k === "void") return null; // void: outside the footprint on an upper floor
  const r = iso.rot, o = { v: Math.floor(hash3(x, y, 17) * 4), alt: hash3(x, y, 99) < 0.35 ? 1 : 0, j: 0, n: null, top: WALL1, mat: 0, dmg: 0, dir: null };
  const js = JOINS[k];
  if (js) for (const [dx, dy] of VD) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= b.w || ny >= b.h) continue;
    if (js.has(b.cells[ny * b.w + nx].k)) o.j |= 1 << viewDir(dx, dy, r);
  }
  const bid = scene.comp[i];
  if (bid >= 0) {
    const B = scene.blds[bid];
    o.top = B.top; o.mat = B.mat;
    if (WALLISH.has(k) || k === "shelf" || k === "locker" || k === "cabinet" || k === "counter") {
      // The axis to the inside: the side with the building's floor.
      for (const [dx, dy] of VD) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= b.w || ny >= b.h) continue;
        const j = ny * b.w + nx;
        if (scene.comp[j] === bid && FLOORED.has(b.cells[j].k)) { const d = viewDir(dx, dy, r); o.n = d < 2 ? "u" : "v"; break; }
      }
      if (k === "shelf" || k === "locker" || k === "cabinet" || k === "counter") o.n = o.n === "u" ? "v" : o.n === "v" ? "u" : null; // furniture runs along the wall it stands by
    }
    // The cutaway: a cut building's near walls (the ones with its inside behind them) drop to stubs (behind: up the
    // screen, toward −u and −v; in a straight view toward −v).
    if (cut && cut.has(bid) && (WALLISH.has(k) || k === "bars") && (!focus || focus.some(([fx, fy]) => Math.max(Math.abs(fx - x), Math.abs(fy - y)) <= CUT_R))) {
      const [u, v] = toView(x, y, r, b.w, b.h), [Wv, Hv] = viewDims(b, r);
      for (const [du, dv] of iso.straight ? [[0, -1], [-1, -1], [1, -1]] : [[-1, 0], [0, -1], [-1, -1]]) {
        const nu = u + du, nv = v + dv;
        if (nu < 0 || nv < 0 || nu >= Wv || nv >= Hv) continue;
        const [wx, wy] = fromView(nu, nv, r, b.w, b.h), j = wy * b.w + wx;
        if (scene.comp[j] === bid && !WALLISH.has(b.cells[j].k)) { o.stub = true; break; }
      }
    }
  }
  if (c.mhp) o.dmg = Math.round(clamp01(1 - c.hp / c.mhp) * 3) / 3;
  if (k === "gate") o.barred = barredCell(c);
  if (k === "palisade" && c.t === 1) o.top = PALISADE;
  if (k === "door") { const d = ((b.raid ? b.raid.doors : b.doors) || []).find((q) => q.x === x && q.y === y); o.vault = !!(d && d.lock && d.lock.kind === "vault"); } // a raid's, a field map's houses' (sim/combat.js b.doors)
  if (c.roll) o.roll = true; // a roller door (sim/buildingmaps.js)
  if (c.h > 0 && FURNITURE.has(k)) o.raise = c.h * LV; // furniture on an upper floor
  if (k === "ladder" || k === "stairs") {
    // Towards the higher neighbour (the walkway, the loft, the roof).
    let best = -1, bh = hAt(b, x, y);
    VD.forEach(([dx, dy]) => {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= b.w || ny >= b.h || !cdef(b.cells[ny * b.w + nx]).walk) return;
      const hh = hAt(b, nx, ny);
      if (hh > bh) { bh = hh; best = viewDir(dx, dy, r); }
    });
    o.dir = best < 0 ? 0 : best;
  }
  if (c.car && (k === "car" || k === "truck" || k === "vehicle")) o.car = c.car; // one piece of a 2 × 3–4 cell car (sim/combat.js placeCar): carPieces draws its share
  else if (k === "car" || k === "truck" || k === "vehicle") {
    // Cars lie along the road, or as their dice say; the axis turns with the view.
    const roadX = (x > 0 && b.cells[i - 1].f === "road") || (x < b.w - 1 && b.cells[i + 1].f === "road");
    const worldAxis = c.f === "road" || roadX ? (hash3(x, y, 5) < 0.85 ? 0 : 1) : (o.v & 1);
    o.v = (o.v & 2) | (((worldAxis === 0) === ((r & 1) === 0)) ? 0 : 1);
  }
  return { k, o };
}
const SPLIT = new Set(["bdoor", "doorway", "smashed", "gate", "tower", "odoor"]); // drawn in two parts around who stands there
// How tall a cell's block stands (art px), for picking and fading.
function blockTop(k, o) {
  return blockTop0(k, o) + (o.raise || 0);
}
function blockTop0(k, o) {
  switch (k) {
    case "wall": case "window": case "door": case "bdoor": case "doorway": case "smashed": case "idoor": case "odoor": return o.stub ? STUB : o.top;
    case "rack": return 31; case "table": return 11; case "bed": return 8; case "bars": return o.stub ? STUB : 28;
    case "palisade": case "gate": return PALISADE;
    case "tower": return 2 * LV + 7;
    case "walkway": case "loft": case "roof": return LV;
    case "stairs": return LV / 2;
    case "ladder": return LV;
    case "tree": return o.v === 3 && o.alt ? 30 : 40;
    case "hivewall": return 30;
    // Head high (VEH_TOP, carPieces): a car's cabin cells at the roof, its hood and trunk lower.
    case "truck": return VEH_TOP;
    case "car": return o.car ? (o.car.i > 0 && o.car.i < o.car.L - 1 ? VEH_TOP : Math.round(9 * vehZ(VEH_ROOF.car))) : VEH_TOP; // a multi-cell car: its cabin cells stand taller than the hood and the trunk
    case "vehicle": return o.car ? (o.car.body === "bike" ? 11 : o.car.body === "truck" || MIL_TOPS[o.car.body] ? VEH_TOP : o.car.i > 0 && o.car.i < o.car.L - 1 ? VEH_TOP : Math.round(9 * vehZ(VEH_ROOF.car))) : VEH_TOP;
    case "locker": return 26; case "shelf": return 24; case "pump": return 22; case "gunsafe": return 22;
    case "boulder": return 20; case "crate": return o.v >= 2 ? 22 : 13;
    case "fence": return 14; case "barricade": return 16; case "sandbag": return 13; case "hay": return 13; case "cabinet": return 14; case "counter": return 12; case "well": return 12; case "barrel": return 13;
    case "rock": return 10; case "wire": return 10; case "rail": return 13; case "tanktrap": return 12;
    default: return 0;
  }
}

// Every cell's look for this view and cutaway, with its sprites (made the first time they are drawn), cached.
const looksCache = {}; // by use: "draw" (this frame's cutaway), "pick" (none)
function looksFor(b, scene, cut, slot = "draw", focus = null) {
  const ck = [...cut].sort((a, c) => a - c).join(",");
  const key = `${scene.key}:${viewKey()}:${ck}:${focus ? focus.map((p) => p.join(".")).join(",") : ""}`, lc = looksCache[slot];
  if (lc && lc.b === b && lc.key === key) return lc.list;
  const list = new Array(b.w * b.h);
  for (let i = 0; i < list.length; i++) {
    const L = lookOf(b, scene, i % b.w, (i / b.w) | 0, cut, focus);
    list[i] = L ? { k: L.k, o: L.o, top: blockTop(L.k, L.o), spr: [undefined, undefined], fspr: [undefined, undefined] } : null;
  }
  looksCache[slot] = { b, key, list };
  iso.builds.looks++;
  return list;
}
function sprOf(L, fog, front = false) {
  const a = front ? L.fspr : L.spr, f = fog ? 1 : 0;
  let s = a[f];
  if (s === undefined) { s = sprite(L.k, SPLIT.has(L.k) ? { ...L.o, part: front ? "front" : "back" } : L.o, fog); a[f] = s; }
  return s;
}

// ---------- the camera ----------
// A new battle: the whole map if it fits at 1.5 CSS px an art pixel or more; else (the bigger maps: sim/battlesize.js)
// the action: your people (the deploy area in a base battle) and the ground toward the enemy, at the zoom that shows it
// (1.5–2.5; a raid 1.5–2), centered there.
const mapKey = (b) => `${b.w}x${b.h}:${b.tier ? b.tier.map : ""}`;
function newBattleCamera(b, cw, ch) {
  iso.battle = b;
  iso.mapKey = mapKey(b);
  iso.rot = 0; iso.straight = false;
  const [Wv, Hv] = viewDims(b, 0);
  const fit = Math.min(cw / ((Wv + Hv) * HW + 40), ch / ((Wv + Hv) * HH + 90));
  const zoomFor = (f) => { let z = 0; for (let i = 0; i < ISO_ZOOMS.length; i++) if (ISO_ZOOMS[i] <= f) z = i; return z; };
  iso.zoom = zoomFor(Math.max(fit, 1.5));
  const box = ISO_ZOOMS[iso.zoom] <= fit * 1.02 ? null : actionBox(b);
  if (box) {
    // The box's corners in view space: the zoom that fits it, its middle centered.
    const pts = [[box[0], box[1]], [box[2], box[1]], [box[0], box[3]], [box[2], box[3]]].map(([x, y]) => ptView(x, y, 0, b.w, b.h));
    const X = pts.map(([u, v]) => (u - v) * HW), Y = pts.map(([u, v]) => (u + v) * HH);
    const bw = Math.max(...X) - Math.min(...X) + 60, bh = Math.max(...Y) - Math.min(...Y) + UNIT_H + 90;
    iso.zoom = zoomFor(Math.min(b.raid ? 2 : 2.5, Math.max(1.5, Math.min(cw / bw, ch / bh)))); // a raid: more of the building
    centerAt(b, (box[0] + box[2]) / 2, (box[1] + box[3]) / 2, UNIT_H / 2);
  } else centerAt(b, b.w / 2, b.h / 2, 0);
  clampCam(b);
  iso.target = null;
}
// The part of the map a battle opens on (world tiles x0, y0, x1, y1): your people on the map (in a base battle's deploy
// step, its deploy area), and two thirds of the way from them toward the enemy's middle, with 3 tiles around.
export function actionBox(b) {
  const mine = b.units.filter((u) => u.side === "player" && !u.dead && !u.left && u.x >= 0 && u.y >= 0);
  const pts = mine.map((u) => [u.x + 0.5, u.y + 0.5]);
  if (b.phase === "deploy" && b.deploy && b.deploy.zone) {
    let n = 0, sx = 0, sy = 0;
    for (let i = 0; i < b.w * b.h; i++) if (b.deploy.zone[i]) { n++; sx += (i % b.w) + 0.5; sy += ((i / b.w) | 0) + 0.5; }
    if (n) pts.push([sx / n, sy / n]);
  }
  if (!pts.length) return [0, 0, b.w, b.h];
  const mid = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0]);
  const foes = b.units.filter((u) => u.side === "enemy" && !u.dead && !u.off && !u.fled && u.x >= 0);
  if (foes.length) {
    const e = foes.reduce((a, u) => [a[0] + (u.x + 0.5) / foes.length, a[1] + (u.y + 0.5) / foes.length], [0, 0]);
    pts.push([mid[0] + (e[0] - mid[0]) * 0.67, mid[1] + (e[1] - mid[1]) * 0.67]);
  }
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.max(0, Math.min(...xs) - 3), Math.max(0, Math.min(...ys) - 3), Math.min(b.w, Math.max(...xs) + 3), Math.min(b.h, Math.max(...ys) + 3)];
}
// Off-screen enemies on a big map: a small red marker at the edge of the view pointing at each enemy your people see
// (or last saw: a ghost), so nobody is lost off the side of the screen.
function drawEdgeMarkers(ctx, b, cw, ch, v) {
  if (b.over) return;
  const m = 22, cx = cw / 2, cy = ch / 2;
  const spots = [];
  for (const t of b.units) if (t.side === "enemy" && active(t) && onFloor(b, t) && v.seen.has(t.id)) spots.push([t.x, t.y, 1]);
  for (const q of v.ghosts || []) if (onFloor(b, q)) spots.push([q.x, q.y, 0.45]);
  for (const [x, y, a] of spots) {
    const [X, Y] = project(x + 0.5, y + 0.5, standZ(b, x, y) + UNIT_H / 2);
    if (X >= m && Y >= m && X <= cw - m && Y <= ch - m) continue;
    const dx = X - cx, dy = Y - cy;
    const k = Math.min((cw / 2 - m) / Math.max(1e-6, Math.abs(dx)), (ch / 2 - m) / Math.max(1e-6, Math.abs(dy)));
    ctx.save();
    ctx.translate(cx + dx * k, cy + dy * k); ctx.rotate(Math.atan2(dy, dx));
    ctx.globalAlpha = a;
    ctx.fillStyle = COL.bad; ctx.strokeStyle = "rgba(15,17,20,0.85)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-6, -7); ctx.lineTo(-3, 0); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}
function centerAt(b, wx, wy, z) {
  const [u, v] = ptView(wx, wy, iso.rot, b.w, b.h);
  iso.cx = artX(u, v, iso.straight);
  iso.cy = artY(u, v, iso.straight) - z;
}
function clampCam(b) {
  const [Wv, Hv] = viewDims(b), st = iso.straight;
  iso.cx = Math.max(st ? 0 : -Hv * HW, Math.min(st ? Wv * SW : Wv * HW, iso.cx));
  iso.cy = Math.max(-2 * LV - liftOf(b), Math.min(st ? Hv * SH : (Wv + Hv) * HH, iso.cy));
}
// Smoothly to a unit (V, or picking one that is off screen).
export function isoCenterOn(b, x, y, smooth = true) {
  if (!b) return;
  const [u, v] = ptView(x + 0.5, y + 0.5, iso.rot, b.w, b.h);
  const t = { cx: artX(u, v, iso.straight), cy: artY(u, v, iso.straight) - standZ(b, x, y) - UNIT_H / 2 };
  if (smooth) iso.target = t;
  else { iso.cx = t.cx; iso.cy = t.cy; iso.target = null; }
}
// Is a cell on screen (with a margin, CSS px)?
export function isoOnScreen(b, x, y, margin = 60) {
  if (!FR.cw) return true;
  const [X, Y] = project(x + 0.5, y + 0.5, standZ(b, x, y));
  return X > margin && Y > margin && X < FR.cw - margin && Y < FR.ch - margin;
}
// Turn the view d eighths (1 right, −1 left: E and Q): from a diagonal view to the straight one beside it and on to
// the next diagonal one (viewStep: the straight eighth before rotation r uses r's view grid).
export function isoRotate(b, d) {
  if (!b) return;
  // Keep the point at the middle of the screen where it is.
  const [u, v] = artUV(iso.cx, iso.cy, iso.straight);
  const [wx, wy] = ptWorld(u, v, iso.rot, b.w, b.h);
  const k = (viewStep() + d + 8) & 7;
  iso.rot = ((k + 1) >> 1) & 3; iso.straight = (k & 1) === 1;
  centerAt(b, wx, wy, 0);
  iso.target = null;
  clampCam(b);
}
export function isoZoom(b, d, px = null, py = null) {
  if (!b) return;
  const z = Math.max(0, Math.min(ISO_ZOOMS.length - 1, iso.zoom + d));
  if (z === iso.zoom) return;
  const S0 = ISO_ZOOMS[iso.zoom], S1 = ISO_ZOOMS[z];
  if (px != null && FR.cw) {
    // The point under the mouse stays under it.
    const ax = (px - FR.cw / 2) / S0 + iso.cx, ay = (py - FR.ch / 2) / S0 + iso.cy;
    iso.cx = ax - (px - FR.cw / 2) / S1;
    iso.cy = ay - (py - FR.ch / 2) / S1;
  }
  iso.zoom = z;
  iso.target = null;
  clampCam(b);
}
export function isoPan(b, dx, dy) {
  if (!b) return;
  const S = ISO_ZOOMS[iso.zoom];
  iso.cx -= dx / S; iso.cy -= dy / S;
  iso.target = null;
  clampCam(b);
}
// The mouse near the canvas edge pans after a moment (px, py in CSS px; null: the mouse left).
export function isoEdge(px, py, cw, ch, now) {
  const m = 14;
  const e = px == null ? null : [px < m ? -1 : px > cw - m ? 1 : 0, py < m ? -1 : py > ch - m ? 1 : 0];
  if (!e || (!e[0] && !e[1])) { iso.edge = null; return; }
  if (!iso.edge || iso.edge[0] !== e[0] || iso.edge[1] !== e[1]) iso.edgeSince = now;
  iso.edge = e;
}
function stepCamera(b, now) {
  const dt = Math.min(0.05, iso.lastT ? (now - iso.lastT) / 1000 : 0);
  iso.lastT = now;
  const S = ISO_ZOOMS[iso.zoom], sp = 900 * dt / S;
  let dx = 0, dy = 0;
  if (iso.keys.has("ArrowLeft")) dx -= 1;
  if (iso.keys.has("ArrowRight")) dx += 1;
  if (iso.keys.has("ArrowUp")) dy -= 1;
  if (iso.keys.has("ArrowDown")) dy += 1;
  if (iso.edge && now - iso.edgeSince > 250) { dx += iso.edge[0]; dy += iso.edge[1]; }
  if (dx || dy) { iso.cx += dx * sp; iso.cy += dy * sp; iso.target = null; clampCam(b); }
  if (iso.target) {
    const k = Math.min(1, dt * 9);
    iso.cx += (iso.target.cx - iso.cx) * k; iso.cy += (iso.target.cy - iso.cy) * k;
    if (Math.abs(iso.target.cx - iso.cx) + Math.abs(iso.target.cy - iso.cy) < 0.5) iso.target = null;
  }
}

// ---------- picking ----------
// The cell under a screen point (CSS px): the unit sprite under it, else the frontmost cell its view ray hits (a
// raised floor or a block standing in front of the ground behind it). null off the map.
// Trees do not stop the ray (PICK_THROUGH): a crown hides the ground behind it, and that ground is what a click there
// means, so the pick is the ground under the point (the tree's own cell at the foot of its trunk). The tile behind
// is drawn with a dashed outline on top of the tree (drawIso, coverOf). Roofs and the walls of buildings never stopped
// the ray (below). Everything else that stands up stays a target in itself: cars, trucks and the team's vehicle (searched,
// loaded, driven to), lockers and shelves (searched), the base's walls, palisades and gates (battered, held).
// opts.solid: trees stop the ray too (the old pick; the tests).
export const PICK_THROUGH = new Set(["tree"]);
export function isoPick(b, px, py, opts = {}) {
  if (!b || !FR.S) return null;
  if (!opts.noUnits) for (let i = iso.rects.length - 1; i >= 0; i--) {
    const q = iso.rects[i];
    if (px >= q.x0 && px <= q.x1 && py >= q.y0 && py <= q.y1) return { x: q.x, y: q.y, unit: q.id };
  }
  const [u0, v0] = artUV((px - FR.X0) / FR.S, (py - FR.Y0) / FR.S, FR.st), [ku, kv] = rayK(FR.st);
  const [Wv, Hv] = viewDims(b);
  // Roofs and the walls of buildings do not stop the ray (they are cut away for whatever the mouse points at inside:
  // picking never depends on the cutaway, so it cannot flicker); raised floors and every other block do.
  const scene = sceneFor(b), looks = looksFor(b, scene, NOCUT, "pick");
  // On an upper floor (floorsOf) the footprint's cells sit at their raised height; outside it the ground is at 0.
  const topOf = (x, y) => {
    const i = y * b.w + x, c = b.cells[i];
    if (opts.ground) return liftAt(b, i); // ground: the cell under the point as if nothing stood on it (the view's checks, tools/uitest.js)
    if (cdef(c).walk && !SOLIDWALK.has(c.k)) return standZ(b, x, y);
    const L = looks[i];
    if (!L || (!opts.solid && PICK_THROUGH.has(L.k))) return liftAt(b, i);
    return (scene.comp[i] >= 0 && WALLISH.has(L.k) ? STUB : L.top) + liftAt(b, i);
  };
  // March along the ray from the front (high z) to the back (the ground).
  const zMax = WALL2 + 8 + liftOf(b);
  let best = null;
  for (let z = zMax; z >= 0; z -= 1) {
    const u = u0 + z * ku, v = v0 + z * kv;
    if (u < 0 || v < 0 || u >= Wv || v >= Hv) continue;
    const [x, y] = fromView(Math.floor(u), Math.floor(v), iso.rot, b.w, b.h);
    if (z <= topOf(x, y)) { best = { x, y }; break; }
  }
  if (!best) {
    if (u0 < 0 || v0 < 0 || u0 >= Wv || v0 >= Hv) return null;
    const [x, y] = fromView(Math.floor(u0), Math.floor(v0), iso.rot, b.w, b.h);
    best = { x, y };
  }
  return best;
}
const SOLIDWALK = new Set(["walkway", "tower", "loft", "roof", "stairs"]);
const NOCUT = new Set();

// ---------- what hides a cell ----------
// The cells standing in front of a cell's floor on the screen, nearest first: the line from the middle of its floor
// (at its standing height) toward the camera runs straight up the screen through the cells in front of it on the
// diagonal, and each one whose block (or uncut roof) reaches that line hides the floor there. Only blocks at least
// COVER_MIN taller than the floor count (a tree, a car, a wall, a locker, a roof; not a rock, a fence or sandbags).
// Its tile is then drawn with a dashed outline on top (HIDDEN_DASH): behind something.
const COVER_MIN = 20;
export const HIDDEN_DASH = [4, 3]; // CSS px at zoom 2 (scaled with the zoom)
function coverOf(b, x, y, looks, scene, cut, roofs) {
  const out = [];
  if (x < 0 || y < 0 || x >= b.w || y >= b.h) return out;
  const z0 = standZ(b, x, y), [ku, kv] = rayK(iso.straight);
  const [uc, vc] = ptView(x + 0.5, y + 0.5, iso.rot, b.w, b.h);
  const [Wv, Hv] = viewDims(b);
  const zMax = WALL2 + 8 + liftOf(b);
  let last = y * b.w + x;
  // From the floor toward the camera z rises, so a cell is reached at its lowest point: one test on the way in.
  for (let z = z0 + 1; z <= zMax; z++) {
    const u = uc + (z - z0) * ku, v = vc + (z - z0) * kv;
    if (u >= Wv || v >= Hv) break;
    const [cx, cy] = fromView(Math.floor(u), Math.floor(v), iso.rot, b.w, b.h), i = cy * b.w + cx;
    if (i === last) continue;
    last = i;
    const L = looks[i], bid = scene.comp[i];
    const top = Math.max(L ? L.top : 0, roofs && bid >= 0 && !cut.has(bid) ? scene.blds[bid].top : 0) + liftAt(b, i);
    if (top - z0 >= COVER_MIN && z <= top) out.push(i);
  }
  return out;
}
// The same for the tools and the panel: what hides cell x, y in the last frame drawn (its cutaway), or with no
// cutaway before one. [] when nothing does.
let lastCover = null; // { b, looks, scene, cut, roofs } of the last frame
export function isoCoverOf(b, x, y) {
  if (lastCover && lastCover.b === b && lastCover.rot === viewKey()) return coverOf(b, x, y, lastCover.looks, lastCover.scene, lastCover.cut, lastCover.roofs);
  const scene = sceneFor(b);
  return coverOf(b, x, y, looksFor(b, scene, NOCUT, "pick"), scene, NOCUT, !floorsOf(b));
}
// A dashed outline round a cell's floor, on top of whatever hides it (a dark edge under it, to read on leaves).
function dashedCell(ctx, b, x, y, z, col, width, inset = 0.5) {
  const S = FR.S, k = Math.max(1, S / 2);
  ctx.setLineDash(HIDDEN_DASH.map((d) => d * k));
  ctx.beginPath(); diamond(ctx, x, y, z, inset);
  ctx.strokeStyle = "rgba(10,12,16,0.7)"; ctx.lineWidth = width + 1.5; ctx.stroke();
  ctx.strokeStyle = col; ctx.lineWidth = width; ctx.stroke();
  ctx.setLineDash([]);
}

// ---------- drawing ----------
const tileTop = (b, x, y) => standZ(b, x, y);
// A cell's floor outline: a diamond, or a straight view's rectangle.
function diamond(ctx, x, y, z, inset = 0) {
  const [u, v] = ptView(x + 0.5, y + 0.5, FR.r, FR.W, FR.H);
  const cx = artX(u, v, FR.st) * FR.S + FR.X0, cy = (artY(u, v, FR.st) - z) * FR.S + FR.Y0;
  if (FR.st) { const w = (SW / 2 - inset) * FR.S, h = (SH / 2 - inset / 2) * FR.S; ctx.rect(cx - w, cy - h, 2 * w, 2 * h); return; }
  const w = (HW - inset * 2) * FR.S, h = (HH - inset) * FR.S;
  ctx.moveTo(cx, cy - h); ctx.lineTo(cx + w, cy); ctx.lineTo(cx, cy + h); ctx.lineTo(cx - w, cy); ctx.closePath();
}
// Fill the cells of a mask on the ground (and on raised floors at their height when `raised`).
function fillCells(ctx, b, test, fill, raised = true) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  let any = false;
  for (let i = 0; i < b.w * b.h; i++) {
    if (!test(i)) continue;
    const x = i % b.w, y = (i / b.w) | 0, z = tileTop(b, x, y);
    if (z && !raised) continue;
    diamond(ctx, x, y, z);
    any = true;
  }
  if (any) ctx.fill();
}
// The border of a mask's cells (ground level).
function outlineCells(ctx, b, test, color, width = 2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (let i = 0; i < b.w * b.h; i++) {
    if (!test(i)) continue;
    const x = i % b.w, y = (i / b.w) | 0, z = tileTop(b, x, y);
    const edge = (nx, ny) => nx < 0 || ny < 0 || nx >= b.w || ny >= b.h || !test(ny * b.w + nx);
    const P = (wx, wy) => project(wx, wy, z);
    const seg = (a, c) => { ctx.moveTo(...a); ctx.lineTo(...c); };
    if (edge(x, y - 1)) seg(P(x, y), P(x + 1, y));
    if (edge(x, y + 1)) seg(P(x, y + 1), P(x + 1, y + 1));
    if (edge(x - 1, y)) seg(P(x, y), P(x, y + 1));
    if (edge(x + 1, y)) seg(P(x + 1, y), P(x + 1, y + 1));
  }
  ctx.stroke();
}
// The doors, so they are found at any zoom and turn of the view: a padlock badge over every locked door (sim/locks.js:
// a raid's, a field map's houses': sim/combat.js b.doors), and over a building whose roof is on a door badge on each
// way in (a closed door filled, an open one hollow), at the roof's height (the roof hides the door's own colours). Dim
// where nobody sees it now.
function drawDoorMarks(ctx, b, scene, cut, looks, vis, S, topFloor) {
  const locked = new Set(((b.raid ? b.raid.doors : b.doors) || []).filter((d) => !d.lock.open && onFloor(b, d)).map((d) => d.y * b.w + d.x));
  const s = Math.max(4, 2.2 * S);
  for (let i = 0; i < b.w * b.h; i++) {
    const c = b.cells[i], k = c.k;
    if (k !== "door" && k !== "idoor" && k !== "odoor") continue;
    const x = i % b.w, y = (i / b.w) | 0, bid = scene.comp[i], roofed = topFloor && bid >= 0 && !cut.has(bid);
    const out = VD.some(([dx, dy]) => { const nx = x + dx, ny = y + dy; return nx < 0 || ny < 0 || nx >= b.w || ny >= b.h || b.cells[ny * b.w + nx].f !== "floor"; });
    const lock = locked.has(i);
    if (!lock && !(roofed && out)) continue;
    const L = looks[i], top = (roofed ? scene.blds[bid].top + 4 : L ? L.top : WALL1) + liftAt(b, i);
    const [X, Y] = project(x + 0.5, y + 0.5, top + 3);
    ctx.globalAlpha = vis[i] ? 1 : 0.6;
    ctx.lineWidth = Math.max(1, S * 0.45); ctx.strokeStyle = "#141414";
    if (lock) { // a padlock: the shackle, the brass body
      ctx.beginPath(); ctx.arc(X, Y - s * 1.3, s * 0.55, Math.PI, 0); ctx.stroke();
      ctx.fillStyle = "#7a2622"; rr(ctx, X - s * 0.95, Y - s * 1.35, s * 1.9, s * 1.45, 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#f0c440"; ctx.fillRect(X - s * 0.18, Y - s * 0.95, s * 0.36, s * 0.6);
    } else { // a door leaf in its frame, hollow when it stands open
      ctx.fillStyle = "#e6d6ac"; rr(ctx, X - s * 0.75, Y - s * 2, s * 1.5, s * 2, 2); ctx.fill(); ctx.stroke();
      if (k !== "odoor") { ctx.fillStyle = "#b0602c"; ctx.fillRect(X - s * 0.5, Y - s * 1.75, s, s * 1.75); ctx.fillStyle = "#f0c440"; ctx.fillRect(X + s * 0.18, Y - s * 0.95, s * 0.2, s * 0.2); }
      else { ctx.fillStyle = "#2a2018"; ctx.fillRect(X - s * 0.5, Y - s * 1.75, s, s * 1.75); ctx.fillStyle = "#b0602c"; ctx.fillRect(X - s * 0.5, Y - s * 1.75, s * 0.3, s * 1.75); }
    }
    ctx.globalAlpha = 1;
  }
}
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function tag(ctx, text, x, y, col, size) {
  ctx.font = `700 ${size}px Segoe UI, sans-serif`;
  const w = ctx.measureText(text).width + size * 0.7, h = size * 1.35;
  ctx.fillStyle = "rgba(15,17,20,0.88)";
  rr(ctx, x - w / 2, y - h, w, h, 3);
  ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = col; ctx.textAlign = "center";
  ctx.fillText(text, x, y - h * 0.28);
}

// Someone sneaking (sim/vision.js u.sneaking): drawn crouched (squashed and leaning), darker and a little see-through,
// on a broken violet ring.
export const SNEAK_LOOK = { squash: 0.8, alpha: 0.82, filter: "brightness(0.62) saturate(0.55)", ring: "#a98ce0" };

// Draw the battle. H: what ui/combat.js knows (the cached view, the selected unit, the mode, the hover, helpers).
export function drawIso(ctx, cw, ch, state, b, now, H) {
  const t0 = typeof performance !== "undefined" ? performance.now() : 0;
  if (iso.battle !== b || iso.mapKey !== mapKey(b)) newBattleCamera(b, cw, ch); // a new battle, or its map swapped (the fall back to the yard)
  iso.cw = cw; iso.ch = ch;
  stepCamera(b, now);
  setFrame(b, cw, ch);
  const S = FR.S, r = iso.rot, st = FR.st, v = H.v, u = H.u, players = b.units.filter((p) => p.side === "player");
  const scene = sceneFor(b);
  const [Wv, Hv] = viewDims(b);
  ctx.imageSmoothingEnabled = false;
  const fog = fogColour(b, battleWeather(state, b)); // behind everything: the fog the map's edge fades into (ui/battleedge.js)
  ctx.fillStyle = fogCss(fog);
  ctx.fillRect(0, 0, cw, ch);

  // Buildings cut away (the user's request 2026-10-12): only the one the selected survivor is in; from outside a
  // building nothing in it shows, the roof stays on (a click on it still picks the cell under it: moving in works as
  // before). Roofs off cuts every one away. Placing defenders (the deploy step), your own base and a battle that is
  // over keep the old rule: one of your people inside, an enemy you see inside, the mouse inside.
  const cut = new Set();
  const cutAt = (x, y) => { const bid = scene.comp[y * b.w + x]; if (bid >= 0) cut.add(bid); };
  if (!iso.roofs) scene.blds.forEach((B) => cut.add(B.id));
  const open = !!H.allKnown || b.over || b.phase === "deploy";
  if (open) {
    for (const p of b.units) if (!p.dead && !p.left && !p.fled && !p.off && onFloor(b, p) && (p.side === "player" || v.seen.has(p.id))) cutAt(p.x, p.y);
    if (H.hover) cutAt(H.hover.x, H.hover.y);
  } else if (u && u.side === "player" && !u.dead && !u.left && !u.off && onFloor(b, u) && u.x >= 0) cutAt(u.x, u.y);
  const peeks = (b.peeks || []).filter((p) => p.turn === b.turn); // a peek through a door (sim/buildingmaps.js) lifts the roof too
  for (const p of peeks) cutAt(p.x, p.y);
  // A building's own map (sim/buildingmaps.js): the walls are lowered around your people, the enemies you see and the
  // mouse only (with Roofs off, everywhere).
  let focus = null;
  if (b.raid && b.raid.interior && iso.roofs) {
    focus = [];
    for (const p of b.units) if (!p.dead && !p.left && !p.fled && !p.off && onFloor(b, p) && (p.side === "player" || v.seen.has(p.id))) focus.push([p.x, p.y]);
    if (H.hover) focus.push([H.hover.x, H.hover.y]);
    for (const p of peeks) focus.push([p.x, p.y]);
  }
  const looks = looksFor(b, scene, cut, "draw", focus);
  const seenB = new Set(); // buildings any of whose cells your people see: their roof is not fogged
  for (const B of scene.blds) for (const j of B.cells) if (v.vis[j]) { seenB.add(B.id); break; }
  // Inside a building (the fog of war indoors, the user's request 2026-10-12): you see the rooms your people see; a
  // cell nobody has seen yet (H.known: ui/combat.js, what your people have ever seen on this floor) is dark and empty
  // (its furniture, containers and room name not drawn; the building's shell is seen from outside); a cell seen
  // before but not now is greyed under the fog, with what was there when it was last seen.
  const known = !open && H.known ? H.known : null;
  const unknownCell = (i) => !!known && scene.comp[i] >= 0 && !v.vis[i] && !known.cells[i] && !scene.ext[i];

  // The ground and the fog.
  const lift = liftOf(b), F = floorsOf(b); // an upper floor of a building with storeys: the footprint raised `lift`
  const gx = (-Hv * HW - iso.cx) * S + cw / 2, gy = (0 - iso.cy) * S + ch / 2;
  const gxf = groundXform(b, iso.rot, TEX, S, gx, gy, Hv);
  const skirt = skirtFor(b, fog, floorColor, scene.groundKey); // the ground running on past the edges into the fog
  if (skirt) { ctx.save(); ctx.imageSmoothingEnabled = false; ctx.transform(...gxf); ctx.drawImage(skirt.cv, -skirt.K * TEX, -skirt.K * TEX); ctx.restore(); }
  let g = null;
  if (!lift) { // painted in map space, stretched onto the diamonds (flatGroundFor)
    const fg0 = flatGroundFor(b, scene);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.transform(...gxf);
    ctx.drawImage(fg0.cv, 0, 0);
    ctx.restore();
  } else {
    g = groundFor(b, scene);
    ctx.drawImage(g.cv, gx + (g.ox + Hv * HW) * S, gy - (g.oy || 0) * S, g.gw * S, g.gh * S);
  }
  const vis = v.vis;
  // Marks left on the ground (ui/battlemarks.js: blood, brass, scorch, glass), and the bodies lying on open ground
  // (drawn here, under the fog and every living unit; the rest in the painter's pass).
  ingestMarks(b, now);
  revealMarks(b, vis);
  const flatDead = new Set();
  if (!lift) {
    ctx.save(); ctx.imageSmoothingEnabled = false; ctx.transform(...gxf); drawMarks(ctx, b, now, floorNo(b)); ctx.restore();
    for (const t of b.units) {
      if (!t.dead || t.left || t.fled || t.off || t.x < 0 || t.ztype === "sleeper" || !onFloor(b, t) || looks[t.y * b.w + t.x] || standZ(b, t.x, t.y)) continue;
      if (!knownBody(b, t, vis)) continue;
      drawBody(ctx, state, b, { t, wx: t.x + 0.5, wy: t.y + 0.5, z: 0 }, H);
      flatDead.add(t);
    }
  }
  if (!lift) { // one pixel a tile, stretched onto the diamonds (fogMaskFor)
    const m = fogMaskFor(b, vis);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.transform(S * artX(1, 0, st), S * artY(1, 0, st), S * artX(0, 1, st), S * artY(0, 1, st), gx + S * Hv * HW, gy);
    ctx.drawImage(m.cv, 0, 0);
    ctx.restore();
  } else {
    const fg = fogFor(b, vis);
    ctx.drawImage(fg.cv, gx + (fg.ox + Hv * HW) * S, gy - (fg.oy || 0) * S, g.gw * S, g.gh * S);
  }

  if (known) fillCells(ctx, b, unknownCell, "rgba(4,5,9,0.78)"); // never seen inside: dark (drawn on the floor; nothing stands there)
  // Highlights on the ground: the floodlit area, the evac strip, a raid's zones, the deploy cells, the move range.
  const N = b.w * b.h;
  // Seen only through a peek this turn (sim/buildingmaps.js): a warm tint and a dashed edge.
  if (vis.some((q) => q === 2)) {
    fillCells(ctx, b, (i) => vis[i] === 2, "rgba(255,214,120,0.12)");
    ctx.setLineDash([5, 4]);
    outlineCells(ctx, b, (i) => vis[i] === 2, "rgba(255,214,120,0.75)", 1.5);
    ctx.setLineDash([]);
  }
  if (b.lit && b.floodAim) fillCells(ctx, b, (i) => b.lit[i], "rgba(255,236,150,0.13)");
  if (b.evacCols) {
    const ev = (i) => evacAt(b, i % b.w, (i / b.w) | 0);
    fillCells(ctx, b, ev, `rgba(${COL.goodRgb},0.2)`);
    ctx.setLineDash([6, 4]);
    outlineCells(ctx, b, ev, `rgba(${COL.goodRgb},0.75)`, 1.5);
    ctx.setLineDash([]);
  }
  // Extraction zones are on the ground floor only: not drawn while looking at an upper floor (they are void there).
  if (b.raid && !floorNo(b)) for (const z of b.raid.zones) {
    const inZ = (i) => { const x = i % b.w, y = (i / b.w) | 0; return x >= z.x0 && x < z.x0 + z.w && y >= z.y0 && y < z.y0 + z.h; };
    fillCells(ctx, b, inZ, z.vehicle ? "rgba(90,160,255,0.2)" : `rgba(${COL.goodRgb},0.2)`);
    ctx.setLineDash([6, 4]);
    outlineCells(ctx, b, inZ, z.vehicle ? "rgba(140,190,255,0.9)" : `rgba(${COL.goodRgb},0.85)`, 2);
    ctx.setLineDash([]);
  }
  const deploying = b.deploy && b.phase === "deploy";
  if (deploying) {
    const ok = new Uint8Array(N);
    for (let i = 0; i < N; i++) ok[i] = canPlace(b, i % b.w, (i / b.w) | 0) ? 1 : 0;
    fillCells(ctx, b, (i) => ok[i], `rgba(${COL.goodRgb},0.16)`);
    outlineCells(ctx, b, (i) => ok[i], `rgba(${COL.goodRgb},0.8)`, 1.5);
  }
  let bands = null;
  if (v.reach && H.mode === "move" && u) {
    bands = new Uint8Array(N);
    for (let i = 0; i < N; i++) { const d = v.reach.dist[i]; bands[i] = isFinite(d) ? (d <= moveMob(u) ? 1 : 2) : 0; }
    bands[u.y * b.w + u.x] = 1;
    fillCells(ctx, b, (i) => bands[i] === 1, "rgba(80,150,255,0.24)", false);
    fillCells(ctx, b, (i) => bands[i] === 2, "rgba(255,200,60,0.16)", false);
    if (u.ap >= 2) outlineCells(ctx, b, (i) => bands[i] >= 1 && !tileTop(b, i % b.w, (i / b.w) | 0), "rgba(255,200,60,0.85)", 2);
    outlineCells(ctx, b, (i) => bands[i] === 1 && !tileTop(b, i % b.w, (i / b.w) | 0), "rgba(110,175,255,0.95)", 2);
  }
  // Flames, smoke and flare light on the ground (sim/throwables.js).
  const ph = ((now || 0) % 900) / 900;
  const groundDisc = (c, fill) => {
    const [X, Y] = project(c.x + 0.5, c.y + 0.5, 0);
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.ellipse(X, Y, (c.r + 0.5) * RX(st) * S, (c.r + 0.5) * RY(st) * S, 0, 0, Math.PI * 2); ctx.fill();
  };
  const OV = battleOverlays(b);
  for (const c of OV.flares) groundDisc(c, "rgba(255,90,70,0.12)");
  // Burning cells: a glowing, scorched diamond each (the flames rise in the painter's pass).
  for (const c of OV.fires) {
    ctx.fillStyle = `rgba(255,${110 + Math.round(60 * Math.sin((ph + c.x * 0.13 + c.y * 0.07) * Math.PI * 2))},40,0.42)`;
    ctx.beginPath(); diamond(ctx, c.x, c.y, tileTop(b, c.x, c.y)); ctx.fill();
  }
  // A spitter's acid (sim/acid.js): a green puddle a cell with bubbles rising and popping, fading as it dries up.
  const phA = ((now || 0) % 1600) / 1600;
  for (const c of OV.acid) {
    const z0 = tileTop(b, c.x, c.y), a = c.fade;
    ctx.fillStyle = `rgba(100,180,40,${0.22 * a})`;
    ctx.beginPath(); diamond(ctx, c.x, c.y, z0); ctx.fill();
    ctx.fillStyle = `rgba(150,222,60,${0.48 * a})`;
    ctx.beginPath(); diamond(ctx, c.x, c.y, z0, 3); ctx.fill();
    for (let k = 0; k < 3; k++) {
      const t = (phA + k / 3 + c.x * 0.37 + c.y * 0.21) % 1;
      const [X, Y] = project(c.x + 0.25 + ((k * 0.31 + c.x * 0.13) % 0.5), c.y + 0.3 + ((k * 0.23 + c.y * 0.17) % 0.45), z0);
      ctx.strokeStyle = `rgba(215,255,130,${(1 - t) * 0.85 * a})`; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.ellipse(X, Y - t * 2 * S, (1 + t * 2.5) * S, (0.6 + t * 1.5) * S, 0, 0, Math.PI * 2); ctx.stroke();
    }
  }
  // A Shepherd's aura (sim/decoys.js): the dead inside ignore decoys and fire.
  for (const a of OV.auras) {
    if (!vis[a.y * b.w + a.x]) continue;
    const [X, Y] = project(a.x + 0.5, a.y + 0.5, 0);
    ctx.fillStyle = "rgba(200,190,255,0.08)";
    ctx.beginPath(); ctx.ellipse(X, Y, a.r * RX(st) * S, a.r * RY(st) * S, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(232,226,255,0.75)"; ctx.lineWidth = 1.5; ctx.setLineDash([6, 5]); ctx.lineDashOffset = -ph * 22;
    ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
  }
  // Decoys: rings out to how far they pull, by what they give off (noise yellow, heat red, light white).
  for (const l of OV.decoys) {
    if (!l.decoy) continue;
    const [X, Y] = project(l.x + 0.5, l.y + 0.5, 0);
    const col = SENSE_COL[l.sense.includes("heat") && !l.sense.includes("light") ? "heat" : l.sense.includes("light") ? "light" : "noise"];
    ctx.strokeStyle = col.replace("A", "0.32"); ctx.lineWidth = 1; ctx.setLineDash([3, 6]);
    ctx.beginPath(); ctx.ellipse(X, Y, l.radius * RX(st) * S, l.radius * RY(st) * S, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
  // Ladders and rams in the painter's pass, by the diagonal they stand on (drawSiegeIso).
  const siegeAt = new Map();
  const atD = (x, y, f) => { const [uu, vv] = toView(x, y, r, b.w, b.h); const d = depth(uu, vv, st); const a = siegeAt.get(d); if (a) a.push(f); else siegeAt.set(d, [f]); };
  for (const l of OV.ladders) if (vis[l.fy * b.w + l.fx] || vis[l.wy * b.w + l.wx]) {
    const [fu, fv] = toView(l.fx, l.fy, r, b.w, b.h), [wu, wv] = toView(l.wx, l.wy, r, b.w, b.h);
    const [x, y] = depth(fu, fv, st) >= depth(wu, wv, st) ? [l.fx, l.fy] : [l.wx, l.wy];
    atD(x, y, () => drawLadderIso(ctx, b, l, S));
  }
  // The ram is held at waist height in front of its crew: drawn after the units of its diagonal.
  const siegeOver = new Map();
  for (const m of OV.rams) if (m.x >= 0 && vis[m.y * b.w + m.x]) { const [uu, vv] = toView(m.x, m.y, r, b.w, b.h); const d = depth(uu, vv, st) + 1; const a = siegeOver.get(d); if (a) a.push(() => drawRamIso(ctx, b, m, S)); else siegeOver.set(d, [() => drawRamIso(ctx, b, m, S)]); }
  for (const f of OV.fires) if (vis[f.y * b.w + f.x]) atD(f.x, f.y, () => drawFlamesIso(ctx, b, f, S, ph));

  // Night: the lights (ui/battlelights.js), a glow on the ground under the units. By day in a raid's building: the
  // dark rooms' floors shaded (a barn, a storeroom: sim/indoorlight.js), a light switched on there cut out of it.
  if ((b.night || b.dark || b.indoor) && paintLights(b, v, groundXform(b, iso.rot, 1, S, gx, gy, Hv), cw, ch, now, (t) => H.animPos(t, now))) drawGlow(ctx, cw, ch);
  if (b.indoor && !b.night && !b.dark) drawShade(ctx, b, cw, ch);

  // ---------- the painter's pass: every cell from the back to the front ----------
  const items = [];
  // Units by where they stand (sliding along their last move).
  const shown = [];
  for (const t of b.units) {
    if (t.left || t.fled || t.off || !onFloor(b, t)) continue; // on another floor: a marker only (below)
    if (t.side !== "player" && !(active(t) ? v.seen.has(t.id) : knownBody(b, t, vis))) continue; // the enemy and the third side (sim/thirdside.js) under the fog; a body once seen stays
    const [wx, wy] = H.animPos(t, now);
    const [uu, vv] = ptView(wx, wy, r, b.w, b.h);
    const tx = Math.max(0, Math.min(b.w - 1, Math.floor(wx))), ty = Math.max(0, Math.min(b.h - 1, Math.floor(wy)));
    shown.push({ t, wx, wy, z: standZ(b, tx, ty), d: depth(Math.floor(uu), Math.floor(vv), st) });
  }
  const ghosts = (v.ghosts || []).filter((q) => !vis[q.y * b.w + q.x] && onFloor(b, q));
  // Cells close in front of one of your people are drawn faded, so nobody is lost behind a wall (in front: down the
  // screen, the cells whose blocks reach up over them; in a straight view the rows below).
  const fade = new Set();
  const FRONT = st ? [[0, 1], [-1, 1], [1, 1], [0, 2], [-1, 2], [1, 2], [0, 3], [0, 4]] : [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2], [2, 2], [3, 2], [2, 3], [3, 3]];
  for (const p of players) {
    if (!active(p) || !onFloor(b, p)) continue;
    const [pu, pv] = toView(p.x, p.y, r, b.w, b.h);
    const pz = standZ(b, p.x, p.y);
    for (const [du, dv] of FRONT) {
      const nu = pu + du, nv = pv + dv;
      if (nu < 0 || nu >= Wv || nv >= Hv) continue;
      const [x, y] = fromView(nu, nv, r, b.w, b.h);
      const L = looks[y * b.w + x];
      const bid = scene.comp[y * b.w + x];
      const top = Math.max(L ? L.top : 0, bid >= 0 && !cut.has(bid) ? scene.blds[bid].top : 0) + liftAt(b, y * b.w + x);
      if (top - pz > artY(du, dv, st) - 6) fade.add(y * b.w + x);
    }
  }
  // The hovered cell behind a tree (or anything else standing in front of it): its cursor is dashed, on top (below),
  // and the trees in the way are faded like those in front of your people; a tile the selected unit can move to,
  // everything in the way (a wall, a car, a roof), so the tile it would walk to shows.
  const roofsOn = !F;
  lastCover = { b, looks, scene, cut, roofs: roofsOn, rot: viewKey() };
  const hv = H.hover && H.hover.x >= 0 && H.hover.y >= 0 && H.hover.x < b.w && H.hover.y < b.h ? H.hover : null;
  const hoverCover = hv ? coverOf(b, hv.x, hv.y, looks, scene, cut, roofsOn) : [];
  const hoverMove = !!(hv && bands && bands[hv.y * b.w + hv.x]);
  for (const i of hoverCover) if (hoverMove || (looks[i] && PICK_THROUGH.has(looks[i].k))) fade.add(i);
  const margin = 80 * S;
  const sh = new Map(); for (const s of shown) { const a = sh.get(s.d); if (a) a.push(s); else sh.set(s.d, [s]); }
  const gh = new Map(); for (const q of ghosts) { const [gu, gv] = toView(q.x, q.y, r, b.w, b.h); const d = depth(gu, gv, st); const a = gh.get(d); if (a) a.push(q); else gh.set(d, [q]); }
  // Bodies on the ground (sim/sleepers.js), by the same depth as the units.
  const bodies = new Map();
  for (const c of b.corpses || []) { if (!onFloor(b, c)) continue; const [cu, cv] = toView(c.x, c.y, r, b.w, b.h); const d = depth(cu, cv, st); const a = bodies.get(d); if (a) a.push(c); else bodies.set(d, [c]); }
  // Things on the ground (sim/ground.js piles), by the same depth.
  const piles = new Map();
  for (const p of groundPiles(b)) { if (!pileCount(p) || !onFloor(b, p)) continue; const [cu, cv] = toView(p.x, p.y, r, b.w, b.h); const d = depth(cu, cv, st); const a = piles.get(d); if (a) a.push(p); else piles.set(d, [p]); }
  // An upper floor: which sides of a footprint cell face the outside (the wall mass below is drawn there).
  const massFaces = (uu, vv) => {
    let faces = 0;
    for (const [du, dv, bit] of [[1, 0, 1], [0, 1, 2]]) {
      const nu = uu + du, nv = vv + dv;
      if (nu >= Wv || nv >= Hv) { faces |= bit; continue; }
      const [nx, ny] = fromView(nu, nv, r, b.w, b.h);
      if (isVoid(b.cells[ny * b.w + nx])) faces |= bit;
    }
    return faces;
  };
  // A building with storeys is never roofed over: looking at any of its floors is a cutaway of the storeys above, and
  // on its top floor you want to see the floor, not the roof (the fog still hides what nobody has seen).
  const topFloor = !F;
  iso.rects = [];
  // By diagonal (u + v) from the back; in a straight view by row (v).
  for (let d = 0; d <= (st ? Hv - 1 : Wv + Hv - 2); d++) {
    const uLo = st ? 0 : Math.max(0, d - (Hv - 1)), uHi = st ? Wv - 1 : Math.min(Wv - 1, d);
    const fronts = [];
    for (let uu = uLo; uu <= uHi; uu++) {
      const vv = st ? d : d - uu;
      const sx = artX(uu, vv, st) * S + FR.X0, sy0 = artY(uu, vv, st) * S + FR.Y0;
      if (sx < -margin || sx > cw + margin || sy0 < -margin || sy0 > ch + margin * 2) continue;
      const [x, y] = fromView(uu, vv, r, b.w, b.h), i = y * b.w + x;
      const L = looks[i];
      const fog = !vis[i], faded = fade.has(i);
      const up0 = lift && !isVoid(b.cells[i]) ? lift : 0, sy = sy0 - up0 * S; // raised with the active floor
      if (up0) {
        const faces = massFaces(uu, vv);
        const mass = faces ? massSprite(scene.comp[i] >= 0 ? scene.blds[scene.comp[i]].mat : 0, lift, faces, fog) : null;
        if (mass) ctx.drawImage(mass.cv, Math.round(sx + mass.ox * S), Math.round(sy0 + mass.oy * S), Math.ceil(mass.w * S), Math.ceil(mass.h * S));
      }
      if (L && !unknownCell(i)) {
        const spr = sprOf(L, fog);
        const up = L.o.raise || 0; // furniture on an upper floor: the floor's slab under it, the piece raised
        if (up) {
          const slab = sprite("loft", { v: 0, j: 0, n: null, top: LV, mat: 0, dmg: 0, dir: null }, fog);
          if (slab) ctx.drawImage(slab.cv, Math.round(sx + slab.ox * S), Math.round(sy + slab.oy * S), Math.ceil(slab.w * S), Math.ceil(slab.h * S));
        }
        if (spr) {
          if (faded && L.top > 12) ctx.globalAlpha = 0.42;
          ctx.drawImage(spr.cv, Math.round(sx + spr.ox * S), Math.round(sy + (spr.oy - up) * S), Math.ceil(spr.w * S), Math.ceil(spr.h * S));
          ctx.globalAlpha = 1;
        }
        if (SPLIT.has(L.k)) fronts.push([L, x, y, sx, sy, fog, faded]);
      }
      // Highlights on a raised floor sit on top of it.
      const zt = tileTop(b, x, y);
      if (zt) {
        if (bands && bands[i]) { ctx.fillStyle = bands[i] === 1 ? "rgba(80,150,255,0.32)" : "rgba(255,200,60,0.22)"; ctx.beginPath(); diamond(ctx, x, y, zt); ctx.fill(); }
        if (deploying && canPlace(b, x, y)) { ctx.fillStyle = `rgba(${COL.goodRgb},0.28)`; ctx.beginPath(); diamond(ctx, x, y, zt); ctx.fill(); }
      }
    }
    for (const c of bodies.get(d) || []) drawCorpseIso(ctx, b, c, !vis[c.y * b.w + c.x]);
    for (const p of piles.get(d) || []) if (!unknownCell(p.y * b.w + p.x)) drawPileIso(ctx, p, project, (x, y) => standZ(b, x, y), S); // ui/ground.js
    for (const q of gh.get(d) || []) drawGhost(ctx, state, b, q, H);
    for (const f of siegeAt.get(d) || []) f();
    for (const s of (sh.get(d) || []).filter((q) => !flatDead.has(q.t)).sort((a, c) => a.z - c.z || (active(a.t) ? 1 : 0) - (active(c.t) ? 1 : 0))) drawUnitIso(ctx, state, b, s, H, now);
    for (const f of siegeOver.get(d) || []) f();
    for (const [L, , , sx, sy, fog, faded] of fronts) {
      const spr = sprOf(L, fog, true);
      if (!spr) continue;
      if (faded) ctx.globalAlpha = 0.42;
      ctx.drawImage(spr.cv, Math.round(sx + spr.ox * S), Math.round(sy + spr.oy * S), Math.ceil(spr.w * S), Math.ceil(spr.h * S));
      ctx.globalAlpha = 1;
    }
    // Roofs over the buildings that are not cut away (none below the top floor of a building with storeys).
    if (topFloor) for (let uu = uLo; uu <= uHi; uu++) {
      const vv = st ? d : d - uu;
      const [x, y] = fromView(uu, vv, r, b.w, b.h), i = y * b.w + x, bid = scene.comp[i];
      if (bid < 0 || cut.has(bid)) continue;
      const sx = artX(uu, vv, st) * S + FR.X0, sy = artY(uu, vv, st) * S + FR.Y0 - liftAt(b, i) * S;
      if (sx < -margin || sx > cw + margin || sy < -margin || sy > ch + margin * 2) continue;
      let edges = 0;
      VD.forEach(([du, dv], k) => { const nu = uu + du, nv = vv + dv; if (nu < 0 || nv < 0 || nu >= Wv || nv >= Hv) { edges |= 1 << k; return; } const [nx, ny] = fromView(nu, nv, r, b.w, b.h); if (scene.comp[ny * b.w + nx] !== bid) edges |= 1 << k; });
      const B = scene.blds[bid], spr = roofSprite(B.mat, B.top, edges, !seenB.has(bid));
      if (fade.has(i)) ctx.globalAlpha = 0.35;
      ctx.drawImage(spr.cv, Math.round(sx + spr.ox * S), Math.round(sy + spr.oy * S), Math.ceil(spr.w * S), Math.ceil(spr.h * S));
      ctx.globalAlpha = 1;
    }
  }

  // A building with storeys (floorsOf): units on other floors are not drawn; a faint marker at their x, y says
  // ▲ / ▼ and the floor (clicking it jumps to that floor: iso.rects). The stairwells carry an arrow for the way
  // up or down, lit when the selected unit stands on them.
  iso.markers = [];
  if (F) {
    for (const t of b.units) {
      const tf = t.f || 0;
      if (t.left || t.fled || t.off || t.dead || tf === floorNo(b)) continue;
      if (t.side !== "player" && !v.seen.has(t.id)) continue;
      const [X, Y] = project(t.x + 0.5, t.y + 0.5, standZ(b, t.x, t.y));
      const col = t.side === "player" ? "rgba(143,193,255,0.7)" : "rgba(255,143,133,0.7)";
      ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
      ctx.beginPath(); diamond(ctx, t.x, t.y, standZ(b, t.x, t.y), 2); ctx.stroke(); ctx.setLineDash([]);
      const text = `${tf > floorNo(b) ? "▲" : "▼"}${tf + 1}`;
      ctx.globalAlpha = 0.75;
      tag(ctx, text, X, Y - 2 * S, col.replace("0.7", "1"), Math.max(10, 3.4 * S));
      ctx.globalAlpha = 1;
      iso.markers.push({ id: t.id, f: tf, x: t.x, y: t.y });
      iso.rects.push({ x0: X - 10 * S, x1: X + 10 * S, y0: Y - 8 * S, y1: Y + 5 * S, x: t.x, y: t.y, id: t.id, f: tf });
    }
    const sel = H.sel != null ? b.units.find((q) => q.id === H.sel) : null;
    for (let i = 0; i < N; i++) {
      if (b.cells[i].k !== "stairs") continue;
      const x = i % b.w, y = (i / b.w) | 0;
      if (!vis[i] && !(sel && sel.x === x && sel.y === y)) continue;
      const here = !!(sel && sel.x === x && sel.y === y && onFloor(b, sel));
      const up = floorNo(b) < F.length - 1, down = floorNo(b) > 0;
      const [X, Y] = project(x + 0.5, y + 0.5, standZ(b, x, y) + LV / 2 + 4);
      isoTag(ctx, X, Y, `${up ? "▲" : ""}${down ? "▼" : ""}`, here ? "#ffe296" : "rgba(255,226,150,0.55)", S * 0.8);
    }
  }
  // A ladder carried on someone's back (sim/siege.js).
  for (const c of OV.carried) {
    const sh = shown.find((q) => q.t.id === c.unit);
    if (!sh) continue;
    const [X, Y] = feet(sh);
    ctx.strokeStyle = "#a07a4a"; ctx.lineWidth = Math.max(1.5, 0.7 * S);
    ctx.beginPath(); ctx.moveTo(X - 7 * S, Y - 4 * S); ctx.lineTo(X + 5 * S, Y - 30 * S); ctx.moveTo(X - 3 * S, Y - 2 * S); ctx.lineTo(X + 9 * S, Y - 28 * S); ctx.stroke();
    for (let k = 1; k < 5; k++) { const t = k / 5; ctx.beginPath(); ctx.moveTo(X - 7 * S + 12 * S * t, Y - 4 * S - 26 * S * t); ctx.lineTo(X - 3 * S + 12 * S * t, Y - 2 * S - 26 * S * t); ctx.stroke(); }
  }
  // Your people hidden behind something: a faint silhouette on top.
  ctx.globalAlpha = 0.3;
  for (const s of shown) if (s.t.side === "player" && active(s.t)) drawBody(ctx, state, b, s, H, true);
  ctx.globalAlpha = 1;
  // Anyone standing behind a tree (or a car, a wall, a roof: coverOf), and things lying there: their tile dashed on
  // top in their ring's colour (the selected one bolder), so they read as behind it.
  for (const s of shown) {
    if (!active(s.t)) continue;
    const tx = Math.max(0, Math.min(b.w - 1, Math.floor(s.wx))), ty = Math.max(0, Math.min(b.h - 1, Math.floor(s.wy)));
    if (coverOf(b, tx, ty, looks, scene, cut, roofsOn).length) dashedCell(ctx, b, tx, ty, s.z, ringOf(s.t), H.sel === s.t.id ? 2.5 : 1.5, 1.5);
  }
  for (const list of piles.values()) for (const p of list) {
    if (!vis[p.y * b.w + p.x] || H.unitAt(p.x, p.y)) continue;
    if (coverOf(b, p.x, p.y, looks, scene, cut, roofsOn).length) dashedCell(ctx, b, p.x, p.y, standZ(b, p.x, p.y), "rgba(230,216,184,0.85)", 1.2, 4);
  }

  // Night: the whole scene darker, the lights cut out of it (ui/battlelights.js); the fog's vignette on the edges.
  drawDarkness(ctx, b, cw, ch);
  drawVignette(ctx, cw, ch, fog);
  for (const c of OV.smoke) {
    if (c.thick) {
      // A fire's smoke: a dark column rising and drifting (it blocks sight through it).
      for (let k = 0; k < 4; k++) {
        const rise = ((ph + k / 4) % 1), [X, Y] = project(c.x + 0.5 + rise * 0.4, c.y + 0.5 - rise * 0.2, 14 + rise * 46);
        ctx.fillStyle = `rgba(40,38,40,${0.42 * (1 - rise)})`;
        ctx.beginPath(); ctx.ellipse(X, Y, (5 + rise * 9) * S, (3 + rise * 5) * S, 0, 0, Math.PI * 2); ctx.fill();
      }
      continue;
    }
    const [X, Y] = project(c.x + 0.5, c.y + 0.5, 10);
    for (let k = 0; k < 5; k++) { const a = k * 1.3 + ph; ctx.fillStyle = "rgba(200,205,210,0.22)"; ctx.beginPath(); ctx.ellipse(X + Math.cos(a) * c.r * 12 * S, Y + Math.sin(a) * c.r * 5 * S - k * 3 * S, (c.r + 0.6) * 12 * S, (c.r + 0.6) * 7 * S, 0, 0, Math.PI * 2); ctx.fill(); }
  }
  // Thrown things where they landed: a ring while the noise lasts (sim/stealth.js).
  for (const l of OV.decoys) {
    const [X, Y] = project(l.x + 0.5, l.y + 0.5, 0), q = ((now || 0) % 1200) / 1200;
    const kind = l.sense.includes("heat") && !l.sense.includes("light") ? "heat" : l.sense.includes("light") ? "light" : "noise";
    ctx.strokeStyle = SENSE_COL[kind].replace("A", String(0.65 * (1 - q))); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(X, Y, (0.4 + q * 1.4) * RX(st) * S, (0.4 + q * 1.4) * RY(st) * S, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = kind === "heat" ? "#ff7a4a" : kind === "light" ? "#fff2c0" : "#e0b048"; ctx.beginPath(); ctx.arc(X, Y - 2 * S, 2.2 * S, 0, Math.PI * 2); ctx.fill();
    if (l.decoy) tag(ctx, kind === "heat" ? "HEAT" : kind === "light" ? "LIGHT" : "NOISE", X, Y - 9 * S, kind === "heat" ? "#ff9a6a" : kind === "light" ? "#fff2c0" : "#ffd166", Math.max(9, 2.8 * S));
  }
  for (const c of b.flares || []) { const [X, Y] = project(c.x + 0.5, c.y + 0.5, 2); ctx.fillStyle = "#ffe08a"; ctx.beginPath(); ctx.arc(X, Y, 2.5 * S, 0, Math.PI * 2); ctx.fill(); }
  // Thrown spears where they lie (sim/combat.js b.spears): yours always, theirs where seen.
  for (const sp of b.spears || []) {
    if (!onFloor(b, sp) || (sp.side !== "player" && !vis[sp.y * b.w + sp.x])) continue;
    const [X0, Y0] = project(sp.x + 0.2, sp.y + 0.8, 1), [X1, Y1] = project(sp.x + 0.8, sp.y + 0.2, 1);
    ctx.strokeStyle = "#7a5a3a"; ctx.lineWidth = 2 * S; ctx.beginPath(); ctx.moveTo(X0, Y0); ctx.lineTo(X1, Y1); ctx.stroke();
    ctx.fillStyle = "#d6dde2"; ctx.beginPath(); ctx.arc(X1, Y1, 1.8 * S, 0, Math.PI * 2); ctx.fill();
  }
  drawGroundIso(ctx, b, project, (x, y) => standZ(b, x, y), S, floorNo(b)); // ui/ground.js: things on the ground, bodies searched with things left

  // A raid: names on the areas, a marker on every container.
  if (b.raid) {
    ctx.textAlign = "center";
    const roomKnown = (a) => {
      const bid = scene.comp[(a.y0 + 1) * b.w + a.x0 + 1];
      if (bid >= 0 && !cut.has(bid)) return false;
      for (let yy = a.y0 + 1; yy < a.y0 + a.h - 1; yy++) for (let xx = a.x0 + 1; xx < a.x0 + a.w - 1; xx++) { const j = yy * b.w + xx; if (j >= 0 && j < b.w * b.h && (known.cells[j] || v.vis[j]) && !WALLISH.has(b.cells[j].k)) return true; } // its floor, not the walls it shares
      return false;
    };
    for (const a of b.raid.areas) {
      if (a.noLabel || !onFloor(b, a)) continue; // halls and corridors (sim/buildingmaps.js); rooms of other floors
      if (!a.outdoor && known && !roomKnown(a)) continue; // a room nobody has seen into (or a roofed building's): not named
      // A room of a building whose roof is off: its name low over its floor; else over the roof (no roof below the
      // top floor of a building with storeys: low).
      const ai = (a.y0 + 1) * b.w + a.x0 + 1, bid = a.outdoor ? -1 : scene.comp[ai];
      const low = !a.outdoor && b.raid.interior && bid >= 0 && (cut.has(bid) || !topFloor);
      const [X, Y] = project(a.x0 + a.w / 2, a.y0 + a.h / 2, (a.outdoor ? 6 : low ? (a.up ? LV : 0) + 14 : (scene.blds[bid] ? scene.blds[bid].top : WALL1) + 12) + (a.outdoor ? 0 : liftAt(b, ai)));
      tag(ctx, a.locked && !(b.raid.doors || []).some((d) => d.area === a.id && d.lock.open) ? `🔒 ${a.name}` : a.name, X, Y, low ? "#c9bfa6" : "#e6d8b8", Math.max(10, (low ? 3.4 : 4.2) * S));
    }
    for (const c0 of b.raid.containers) {
      if (!onFloor(b, c0) || c0.kind === "ground") continue; // b.raid.containers holds every floor's; piles on the ground: ui/ground.js
      // Indoors under the fog: a roofed building's or one nobody has seen are not drawn; one seen before but out of
      // sight now shows as it was then (faded).
      const ci = c0.y * b.w + c0.x, bid = scene.comp[ci];
      let c = c0, stale = false;
      if (known && bid >= 0) {
        if (!cut.has(bid)) continue;
        let now = false;
        for (let yy = c0.y; yy < c0.y + (c0.h || 1) && !now; yy++) for (let xx = c0.x; xx < c0.x + (c0.w || 1); xx++) if (v.vis[yy * b.w + xx]) { now = true; break; }
        if (!now) { const snap = known.boxes && known.boxes.get(c0.id); if (!snap) continue; c = { ...c0, ...snap }; stale = true; }
      }
      if (stale) ctx.globalAlpha = 0.5;
      const L = looks[c.y * b.w + c.x], top = (L ? L.top : 4) + liftAt(b, c.y * b.w + c.x);
      const [X, Y] = project(c.x + (c.w || 1) / 2, c.y + (c.h || 1) / 2, top + 4); // over the middle of a car's cells
      const s = Math.max(7, 3.2 * S);
      // Rummaged through, more may be hidden (sim/search.js) is blue with "…"; things left orange; not yet ? yellow.
      ctx.fillStyle = c.searched ? "rgba(60,64,70,0.9)" : c.quick ? "#7fb8e6" : c.partial ? "#e08a4f" : "#ffd166";
      ctx.strokeStyle = "#1a1a1a"; ctx.lineWidth = 1;
      rr(ctx, X - s, Y - s * 2, s * 2, s * 2, 3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = c.searched ? "#9aa0a8" : "#1a1a1a";
      ctx.font = `700 ${Math.round(s * 1.5)}px Segoe UI, sans-serif`;
      ctx.fillText(c.searched ? "✓" : c.lock && !c.lock.open ? "🔒" : c.quick ? "…" : "?", X, Y - s * 0.45);
      ctx.globalAlpha = 1;
    }
    // Light switches (sim/indoorlight.js): a small plate on the wall beside the door, warm when the lights are on;
    // drawn once the room's floor in front of it has been seen (a roofed building's not at all).
    if (b.indoor) for (const a of b.raid.areas) {
      if (!a.sw || !onFloor(b, a)) continue;
      const si = a.sw[1] * b.w + a.sw[0], fi = a.swIn ? a.swIn[1] * b.w + a.swIn[0] : si, bid = scene.comp[si];
      if (bid >= 0 && known && !cut.has(bid)) continue;
      if (known && !(known.cells[fi] || v.vis[fi] || v.vis[si])) continue;
      const L = looks[si], z = Math.max(6, Math.min(L ? L.top : WALL1, WALL1) * 0.55) + liftAt(b, si);
      const [X, Y] = project(a.sw[0] + 0.5 + (a.swIn ? (a.swIn[0] - a.sw[0]) * 0.45 : 0), a.sw[1] + 0.5 + (a.swIn ? (a.swIn[1] - a.sw[1]) * 0.45 : 0), z);
      const s = Math.max(3, 1.6 * S);
      ctx.fillStyle = a.on ? "#ffd86b" : "#6b7078"; ctx.strokeStyle = "#16181b"; ctx.lineWidth = 1;
      rr(ctx, X - s, Y - s * 1.4, s * 2, s * 2.8, 1.5); ctx.fill(); ctx.stroke();
      ctx.fillStyle = a.on ? "#7a5a10" : "#e8e8e8";
      ctx.fillRect(X - s * 0.3, Y - (a.on ? s * 1 : s * 0.1), s * 0.6, s * 1.1); // the toggle: up for on
      if (a.on && b.night) { ctx.fillStyle = "rgba(255,216,107,0.25)"; ctx.beginPath(); ctx.arc(X, Y, s * 3, 0, Math.PI * 2); ctx.fill(); }
    }
    if (!floorNo(b)) for (const z of b.raid.zones) { // ground floor only (see the zone highlights above)
      const [X, Y] = project(z.x0 + z.w / 2, z.y0 + z.h / 2, 0);
      tag(ctx, z.vehicle ? "VEHICLE · EXTRACT" : z.name ? `${z.name.toUpperCase()} · EXTRACT` : "EXTRACT", X, Y + 4 * S, z.vehicle ? "#a9cbff" : COL.good, Math.max(10, 4 * S));
    }
  }
  drawDoorMarks(ctx, b, scene, cut, looks, vis, S, topFloor);
  // The base's buildings by name; hit points of a battered wall, gate, door or window.
  if (b.tier && b.tier.buildings) for (const s of b.tier.buildings) {
    if (!s.cells.length) continue;
    const xs = s.cells.map((c) => c[0]), ys = s.cells.map((c) => c[1]);
    const [X, Y] = project((Math.min(...xs) + Math.max(...xs) + 1) / 2, (Math.min(...ys) + Math.max(...ys) + 1) / 2, s.roof ? LV + 10 : (s.storeys === 2 ? WALL2 : WALL1) + 12);
    tag(ctx, s.name, X, Y, "#e6d8b8", Math.max(10, 3.8 * S));
  }
  for (let i = 0; i < N; i++) {
    const c = b.cells[i];
    if (!c.mhp || !(c.hp < c.mhp || c.k === "gate") || !vis[i] && !(b.deploy)) continue;
    const x = i % b.w, y = (i / b.w) | 0, L = looks[i], top = (L ? L.top : 0) + liftAt(b, i);
    const [X, Y] = project(x + 0.5, y + 0.5, top + 3), f = Math.max(0, c.hp / c.mhp), w = 18 * S * 0.6;
    ctx.fillStyle = "rgba(15,17,20,0.85)"; ctx.fillRect(X - w / 2, Y - 3, w, 4);
    ctx.fillStyle = f > 0.6 ? COL.good : f > 0.3 ? COL.mid : COL.bad; ctx.fillRect(X - w / 2, Y - 3, w * f, 4);
  }
  // The deploy step: the gate and breaches, the side the attack comes from.
  if (deploying) {
    const D = b.deploy;
    ctx.strokeStyle = "#e0a84f"; ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (const [x, y] of [...D.gate, ...D.breaches]) diamond(ctx, x, y, tileTop(b, x, y), 2);
    ctx.stroke();
    const dir = { east: [1, 0], west: [-1, 0], north: [0, -1], south: [0, 1] }[D.side] || [1, 0];
    const ex = b.w / 2 + dir[0] * (b.w / 2 + 1), ey = b.h / 2 + dir[1] * (b.h / 2 + 1);
    const [X0, Y0] = project(ex, ey, 0), [X1, Y1] = project(ex - dir[0] * 2.2, ey - dir[1] * 2.2, 0);
    arrow(ctx, X0, Y0, X1, Y1, COL.bad, 4 * S);
  }

  // Throw mode (ui/combat.js throwPreview): the range, the reach of the hovered spot, who it would catch.
  if (H.throwMarks) {
    for (const [x, y, k] of H.throwMarks.cells) {
      ctx.fillStyle = k === 2 ? "rgba(255,255,235,0.45)" : k === 1 ? "rgba(255,245,200,0.28)" : "rgba(255,209,102,0.08)";
      ctx.beginPath(); diamond(ctx, x, y, tileTop(b, x, y)); ctx.fill();
    }
    ctx.lineWidth = 2;
    for (const t of H.throwMarks.caught) { ctx.strokeStyle = t.side === "player" ? COL.bad : "#ffffff"; ctx.beginPath(); diamond(ctx, t.x, t.y, tileTop(b, t.x, t.y), 2); ctx.stroke(); }
  }
  // Move: the path to the hovered cell; meds: who can be treated.
  const h = H.hover;
  if (H.cone) fillCells(ctx, b, (i) => H.cone.has(i), "rgba(255,140,40,0.32)"); // the pepper spray's cone (ui/nonlethal.js)
  if (H.mode === "meds" && u) {
    ctx.strokeStyle = COL.good; ctx.lineWidth = 2; ctx.beginPath();
    for (const p of players) if (!p.dead && !p.left && (p === u || Math.max(Math.abs(u.x - p.x), Math.abs(u.y - p.y)) === 1)) diamond(ctx, p.x, p.y, tileTop(b, p.x, p.y), 1.5);
    ctx.stroke();
  }
  if (h && v.reach && u && H.mode === "move" && !H.unitAt(h.x, h.y) && isFinite(v.reach.dist[h.y * b.w + h.x])) {
    const path = H.pathTo(v.reach, h.x, h.y);
    ctx.strokeStyle = path.some(([x, y]) => acidAt(b, x, y)) ? "#9ad63a" : v.reach.dist[h.y * b.w + h.x] <= moveMob(u) ? "#8fc1ff" : "#ffd166"; // green: through a spitter's acid (sim/acid.js)
    ctx.lineWidth = Math.max(2, 0.8 * S);
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(...project(u.x + 0.5, u.y + 0.5, standZ(b, u.x, u.y) + 1));
    for (const [x, y] of path) ctx.lineTo(...project(x + 0.5, y + 0.5, standZ(b, x, y) + 1));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Effects: shots, blows, numbers, throws.
  drawFxIso(ctx, b, now, H, state, shown);
  // Labels over the units: health, actions, status, the hit chance against each enemy in sight.
  for (const s of shown) drawLabels(ctx, b, s, H);
  // The retreat confirm: each one's odds of getting out over their head.
  if (H.retreatOpen && H.plan) {
    for (const p of H.plan.units) {
      const t = b.units.find((q) => q.id === p.id);
      if (!t) continue;
      const [X, Y] = project(t.x + 0.5, t.y + 0.5, standZ(b, t.x, t.y) + UNIT_H + 14);
      tag(ctx, p.safe ? "SAFE" : `${p.chance}%`, X, Y, p.safe || p.chance >= 75 ? COL.good : p.chance >= 45 ? COL.mid : COL.bad, Math.max(11, 3.6 * S));
    }
  }

  // The hovered cell: a cursor on top of everything, the cover around it, the line of fire to an enemy.
  iso.lastHover = null;
  if (h && h.x >= 0 && h.y >= 0 && h.x < b.w && h.y < b.h) {
    const hi = h.y * b.w + h.x, L = looks[hi];
    const zt = cdef(b.cells[hi]).walk ? tileTop(b, h.x, h.y) : (L ? L.top : 0) + liftAt(b, hi);
    // Behind a tree (or anything else standing in front of it): a faint fill and a dashed outline over it.
    const hidden = hoverCover.length > 0;
    iso.lastHover = { x: h.x, y: h.y, hidden, cover: hoverCover, dash: hidden ? HIDDEN_DASH.slice() : [] };
    if (hidden) {
      ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.beginPath(); diamond(ctx, h.x, h.y, zt, 0.5); ctx.fill();
      dashedCell(ctx, b, h.x, h.y, zt, "rgba(255,255,255,0.95)", 1.5);
    } else {
      ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); diamond(ctx, h.x, h.y, zt, 0.5); ctx.stroke();
    }
    if (cdef(b.cells[hi]).walk) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = h.x + dx, y = h.y + dy;
        if (x < 0 || y < 0 || x >= b.w || y >= b.h || !cdef(b.cells[y * b.w + x]).walk) continue;
        if ((dx || dy) && H.unitAt(x, y)) continue;
        shieldsIso(ctx, b, x, y, dx || dy ? 0.55 : 1);
      }
    }
    // The threat preview (ui/combat.js threatAt): a line from each enemy you see that could shoot this tile (solid red,
    // its odds over its head) or walk up and strike it (dashed amber) in its next turn.
    const onTile = H.unitAt(h.x, h.y);
    if (H.threat && b.phase === "player" && !b.over && H.mode === "move" && cdef(b.cells[hi]).walk && (!onTile || onTile.side === "player")) {
      const [TX, TY] = project(h.x + 0.5, h.y + 0.5, zt + UNIT_H * 0.5);
      for (const T of H.threat(h.x, h.y)) {
        const e = T.e, shot = T.shot != null;
        const [EX, EY] = project(e.x + 0.5, e.y + 0.5, standZ(b, e.x, e.y) + UNIT_H * 0.6);
        ctx.strokeStyle = shot ? `rgba(${COL.badRgb},0.85)` : "rgba(224,168,79,0.8)";
        ctx.lineWidth = 1.5;
        if (!shot) ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(EX, EY); ctx.lineTo(TX, TY); ctx.stroke();
        ctx.setLineDash([]);
        if (shot && u) tag(ctx, `⚠ ${T.shot}%`, EX, EY - 10, T.shot >= 50 ? COL.bad : T.shot >= 25 ? "#e0a84f" : "#9aa0a8", Math.max(10, 3.2 * S));
      }
    }
    if (u && active(u) && b.phase === "player") {
      const t = H.unitAt(h.x, h.y);
      if (t && t.side === "enemy" && active(t) && v.seen.has(t.id)) {
        const o = H.odds(b, u, t);
        const col = !o.ok ? "#9aa0a8" : o.chance >= 65 ? COL.good : o.chance >= 35 ? COL.mid : COL.bad;
        const [X0, Y0] = project(u.x + 0.5, u.y + 0.5, standZ(b, u.x, u.y) + UNIT_H * 0.6), [X1, Y1] = project(t.x + 0.5, t.y + 0.5, standZ(b, t.x, t.y) + UNIT_H * 0.6);
        ctx.strokeStyle = col; ctx.lineWidth = 2;
        if (!o.ok) ctx.setLineDash([4, 5]);
        ctx.beginPath(); ctx.moveTo(X0, Y0); ctx.lineTo(X1, Y1); ctx.stroke();
        ctx.setLineDash([]);
        H.bubble(h.px + 14, h.py - 8, o.ok ? [`${o.chance}%`, `${o.dmg[0]}–${o.dmg[1]} dmg`, o.flanked ? "FLANKED" : o.cover ? (o.cover === 2 ? "Full cover" : "Half cover") : ""] : [o.label], col, cw);
      }
    }
  }
  drawEdgeMarkers(ctx, b, cw, ch, v);
  drawCompass(ctx, cw, ch);
  iso.frames++;
  if (t0) iso.frameMs = performance.now() - t0;
}

// ---------- siege objects (sim/siege.js battleOverlays) ----------
const SENSE_COL = { noise: "rgba(255,209,102,A)", heat: "rgba(255,122,74,A)", light: "rgba(255,242,192,A)" };
// A siege ladder: up, leaning from its foot onto the top of the wall section's face; down, lying at its foot.
function drawLadderIso(ctx, b, l, S) {
  const [dx, dy] = l.dir, px = -dy, py = dx; // across the ladder
  const rail = (o) => {
    if (l.up) return [project(l.fx + 0.5 + px * o - dx * 0.15, l.fy + 0.5 + py * o - dy * 0.15, 0), project(l.wx + 0.5 + px * o - dx * 0.42, l.wy + 0.5 + py * o - dy * 0.42, PALISADE + 5)];
    return [project(l.fx + 0.5 + px * o - dx * 0.4 - px * 0.0 + (px ? 0 : 0), l.fy + 0.5 + py * o - dy * 0.4, 1), project(l.fx + 0.5 + px * o + dx * 0.4, l.fy + 0.5 + py * o + dy * 0.4, 1)];
  };
  // Lying down it runs along the wall: swap the axes.
  const R = l.up ? [rail(-0.2), rail(0.2)] : [[project(l.fx + 0.5 - px * 0.6, l.fy + 0.5 - py * 0.6, 1), project(l.fx + 0.5 + px * 0.6, l.fy + 0.5 + py * 0.6, 1)], [project(l.fx + 0.5 - px * 0.6 - dx * 0.3, l.fy + 0.5 - py * 0.6 - dy * 0.3, 1), project(l.fx + 0.5 + px * 0.6 - dx * 0.3, l.fy + 0.5 + py * 0.6 - dy * 0.3, 1)]];
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(0,0,0,0.45)"; ctx.lineWidth = Math.max(2.5, 1.5 * S);
  for (const [[x0, y0], [x1, y1]] of R) { ctx.beginPath(); ctx.moveTo(x0, y0 + S); ctx.lineTo(x1, y1 + S); ctx.stroke(); }
  ctx.strokeStyle = l.side === "enemy" ? "#b08452" : "#c39a62"; ctx.lineWidth = Math.max(1.8, 1.1 * S);
  for (const [[x0, y0], [x1, y1]] of R) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
  ctx.lineWidth = Math.max(1.2, 0.7 * S);
  for (let k = 1; k <= 6; k++) {
    const t = k / 7, a = R[0], c = R[1];
    ctx.beginPath(); ctx.moveTo(a[0][0] + (a[1][0] - a[0][0]) * t, a[0][1] + (a[1][1] - a[0][1]) * t); ctx.lineTo(c[0][0] + (c[1][0] - c[0][0]) * t, c[0][1] + (c[1][1] - c[0][1]) * t); ctx.stroke();
  }
  ctx.lineCap = "butt";
}
// The battering ram: a steel-capped log carried at waist height at its lead, pointing the way the lead faces.
function drawRamIso(ctx, b, m, S) {
  const f = m.target ? [Math.sign(m.target[0] - m.x), Math.sign(m.target[1] - m.y)] : m.face && (m.face[0] || m.face[1]) ? m.face : [1, 0];
  const z = m.dropped ? 3 : 13;
  const [x0, y0] = project(m.x + 0.5 - f[0] * 0.75, m.y + 0.5 - f[1] * 0.75, z), [x1, y1] = project(m.x + 0.5 + f[0] * 0.55, m.y + 0.5 + f[1] * 0.55, z);
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(0,0,0,0.4)"; ctx.lineWidth = 7 * S;
  ctx.beginPath(); ctx.moveTo(x0, y0 + (m.dropped ? 1 : 10) * S); ctx.lineTo(x1, y1 + (m.dropped ? 1 : 10) * S); ctx.stroke();
  ctx.strokeStyle = "#5b3d22"; ctx.lineWidth = 6.5 * S;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.strokeStyle = "#7d5a34"; ctx.lineWidth = 2 * S;
  ctx.beginPath(); ctx.moveTo(x0, y0 - 1.5 * S); ctx.lineTo(x1, y1 - 1.5 * S); ctx.stroke();
  ctx.fillStyle = "#8a8f96"; ctx.beginPath(); ctx.arc(x1, y1, 3.4 * S, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#c8ccd2"; ctx.beginPath(); ctx.arc(x1 - 0.8 * S, y1 - 1 * S, 1.3 * S, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#c9b48a"; ctx.lineWidth = Math.max(1, 0.6 * S);
  for (const t of [0.25, 0.6]) { const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t; ctx.beginPath(); ctx.moveTo(x, y - 2.6 * S); ctx.lineTo(x, y + 2.6 * S); ctx.stroke(); }
  ctx.lineCap = "butt";
}
// Flames on a burning cell: tongues of fire flickering up from the ground.
function drawFlamesIso(ctx, b, c, S, ph) {
  const z0 = tileTop(b, c.x, c.y);
  for (let k = 0; k < 5; k++) {
    const a = k * 1.25 + c.x * 0.7 + c.y * 1.3, fl = (ph * 3 + k * 0.37 + c.x * 0.11) % 1;
    const [X, Y] = project(c.x + 0.5 + Math.cos(a) * 0.28, c.y + 0.5 + Math.sin(a) * 0.28, z0);
    const hgt = (7 + 6 * Math.sin(fl * Math.PI)) * S * (c.turns > 1 ? 1 : 0.7), w = 2.4 * S;
    ctx.fillStyle = k % 2 ? "rgba(255,196,70,0.9)" : "rgba(255,104,36,0.88)";
    ctx.beginPath(); ctx.moveTo(X - w, Y); ctx.quadraticCurveTo(X - w * 0.6, Y - hgt * 0.6, X + Math.sin(fl * 6) * w * 0.5, Y - hgt); ctx.quadraticCurveTo(X + w * 0.6, Y - hgt * 0.6, X + w, Y); ctx.closePath(); ctx.fill();
  }
}
function arrow(ctx, x0, y0, x1, y1, col, w) {
  const a = Math.atan2(y1 - y0, x1 - x0), L = Math.hypot(x1 - x0, y1 - y0);
  ctx.save(); ctx.translate(x0, y0); ctx.rotate(a);
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.moveTo(L, 0); ctx.lineTo(L - w * 2.2, -w * 1.4); ctx.lineTo(L - w * 2.2, -w * 0.5); ctx.lineTo(0, -w * 0.5); ctx.lineTo(0, w * 0.5); ctx.lineTo(L - w * 2.2, w * 0.5); ctx.lineTo(L - w * 2.2, w * 1.4); ctx.closePath(); ctx.fill();
  ctx.restore();
}
// North: which way the map's top edge lies in this view.
function drawCompass(ctx, cw, ch) {
  const [X0, Y0] = project(FR.W / 2, FR.H / 2, 0), [X1, Y1] = project(FR.W / 2, FR.H / 2 - 1, 0);
  const a = Math.atan2(Y1 - Y0, X1 - X0), cx = 40, cy = ch - 40;
  ctx.save();
  ctx.fillStyle = "rgba(15,17,20,0.78)"; ctx.beginPath(); ctx.arc(cx, cy, 28, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(230,226,216,0.25)"; ctx.lineWidth = 1; ctx.stroke();
  ctx.translate(cx, cy); ctx.rotate(a);
  ctx.fillStyle = COL.bad; ctx.beginPath(); ctx.moveTo(15, 0); ctx.lineTo(0, -6); ctx.lineTo(0, 6); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#9aa0a8"; ctx.beginPath(); ctx.moveTo(-15, 0); ctx.lineTo(0, -6); ctx.lineTo(0, 6); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.fillStyle = "#e6e2d8"; ctx.font = "700 12px Segoe UI, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("N", cx + Math.cos(a) * 21, cy + Math.sin(a) * 21);
  ctx.textBaseline = "alphabetic";
  void cw;
}
// Shield icons on the sides of a cell that have cover, at the cell's edges in this view.
function shieldsIso(ctx, b, x, y, alpha) {
  const sides = coverSides(b, x, y), z = tileTop(b, x, y);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const s = (alpha < 1 ? 4 : 5.5) * FR.S;
  ctx.globalAlpha = alpha;
  sides.forEach((c, i) => {
    if (!c) return;
    const [dx, dy] = dirs[i];
    const [cx, cy] = project(x + 0.5 + dx * 0.42, y + 0.5 + dy * 0.42, z + 6);
    ctx.beginPath();
    ctx.moveTo(cx - s / 2, cy - s / 2); ctx.lineTo(cx + s / 2, cy - s / 2); ctx.lineTo(cx + s / 2, cy);
    ctx.quadraticCurveTo(cx + s / 2, cy + s * 0.4, cx, cy + s / 2); ctx.quadraticCurveTo(cx - s / 2, cy + s * 0.4, cx - s / 2, cy); ctx.closePath();
    ctx.fillStyle = c === 2 ? "#4aa3ff" : "rgba(15,20,30,0.85)";
    ctx.fill();
    if (c === 1) { ctx.save(); ctx.clip(); ctx.fillStyle = "#4aa3ff"; ctx.fillRect(cx - s, cy, s * 2, s); ctx.restore(); }
    ctx.strokeStyle = "#cfe6ff"; ctx.lineWidth = 1.2; ctx.stroke();
  });
  ctx.globalAlpha = 1;
}

// ---------- units ----------
const ZRING = { runner: "#ffb43b", brute: "#c8c4b0", spitter: "#9ad63a", screamer: "#c99ae0", crawler: "#6ab0c8", shepherd: "#e8e2ff", soldier: "#a8b878", riot: "#8aa0c8", carrier: "#e6d8a8", swarm: "#f0e4c0", boneback: "#d8b48a", climber: "#8fd0a0", flinger: "#e8a0c8", sower: "#e8e070", nightmare: "#e0506e", sleeper: "#b0d8ff" };
const ringOf = (t) => (t.side === "player" ? (t.vol != null ? "#c9a2ff" : "#8fc1ff") : t.side === "third" ? thirdRing(t) : t.kind === "zombie" ? (t.ztype ? ZRING[t.ztype] || "#b5d36a" : t.boss ? COL.bad : "#b5d36a") : "#ff8f85");
function feet(s) { return project(s.wx, s.wy, s.z); }
// The sprite, standing (or lying) at the unit's feet. silhouette: only the figure (for the see-through pass).
function drawBody(ctx, state, b, s, H, silhouette = false) {
  const t = s.t, S = FR.S, [X, Y] = feet(s);
  if (t.dead || t.down) {
    // Lying on the ground: the fallen's own picture (ui/downsprites.js) laid flat onto the floor's two axes, so it
    // turns with the view (the body along the world's x).
    const [x1, y1] = project(s.wx + 1, s.wy, s.z), [x2, y2] = project(s.wx, s.wy + 1, s.z);
    drawDowned(ctx, unitDownCanvas(state, b, t, H.salt), X, Y, [x1 - X, y1 - Y], [x2 - X, y2 - Y], { facing: unitFacing(b, t), scale: downScale(t), alpha: !silhouette && t.dead ? 0.92 : 1 });
    return;
  }
  const cv = unitCanvas(state, b, t, H.salt);
  if (!cv) return;
  const facing = sideFacing(b, t, FR.r);
  const hgt = UNIT_H * unitBig(t) * S, w = hgt * (22 / 26);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(X, Y);
  if (facing < 0) ctx.scale(-1, 1);
  const spent = t.side === "player" && t.ap === 0 && b.phase === "player";
  if (!silhouette && spent) ctx.globalAlpha *= 0.65;
  // Sneaking (sim/vision.js): crouched low and leaning in, in shadow.
  if (t.sneaking && !silhouette) {
    ctx.transform(1, 0, -0.12, SNEAK_LOOK.squash, 0, 0);
    ctx.globalAlpha *= SNEAK_LOOK.alpha;
    if ("filter" in ctx) ctx.filter = SNEAK_LOOK.filter;
  }
  ctx.drawImage(cv, -w / 2, -hgt * 0.94, w, hgt);
  ctx.restore();
}
// The sprite's facing on screen: the view turned a half (rotation 1 or 2) shows the world mirrored.
const viewFacing = (facing, r) => (r === 1 || r === 2 ? -facing : facing);
// A person's facing (sim/vision.js u.face: the way picked with a move, Face or a shot) as left or right on screen in
// view rotation r; null when it points straight up or down the screen (the last move's way is kept then).
function screenSide(b, t, r) {
  const f = t.face;
  if (!f || (!f[0] && !f[1]) || t.kind !== "human") return null;
  const [u0, v0] = ptView(t.x + 0.5, t.y + 0.5, r, b.w, b.h), [u1, v1] = ptView(t.x + 0.5 + f[0], t.y + 0.5 + f[1], r, b.w, b.h);
  const d = (u1 - v1) - (u0 - v0);
  return Math.abs(d) < 0.05 ? null : d > 0 ? 1 : -1;
}
const sideFacing = (b, t, r) => screenSide(b, t, r) ?? viewFacing(unitFacing(b, t), r);
const unitBig = (t) => (t.boss === "hivemind" ? 1.8 : t.boss ? 1.35 : t.ztype === "brute" || t.ztype === "shepherd" || t.ztype === "carrier" || t.ztype === "boneback" || t.ztype === "sower" ? 1.15 : t.ztype === "crawler" || t.ztype === "swarm" ? 0.8 : 1);
// Where a unit's gun muzzle is on screen, from its feet, in view rotation r at zoom S: the muzzle pixel of the gun
// in its sprite's hand (ui/sprites.js muzzleOf; ui/gunpaint.js paintMini: past a fitted suppressor), the sprite drawn
// as drawBody draws it (mirrored when it faces left). null: no gun drawn (a zombie, bare hands).
export function muzzlePoint(state, b, t, salt, r, S = 1) {
  const mz = muzzleOf(unitCanvas(state, b, t, salt));
  if (!mz) return null;
  const hgt = UNIT_H * unitBig(t) * S, w = hgt * (22 / 26), f = sideFacing(b, t, r);
  return [f * ((mz.mx + 0.5) / 22 - 0.5) * w, -hgt * 0.94 + ((mz.my + 0.5) / 26) * hgt];
}
// A body on the ground (sim/sleepers.js), laid flat like the fallen.
function drawCorpseIso(ctx, b, c, fog) {
  const s = { wx: c.x + 0.5, wy: c.y + 0.5, z: standZ(b, c.x, c.y) };
  const [X, Y] = feet(s), [x1, y1] = project(s.wx + 1, s.wy, s.z), [x2, y2] = project(s.wx, s.wy + 1, s.z);
  drawDowned(ctx, corpseCanvas(c), X, Y, [x1 - X, y1 - Y], [x2 - X, y2 - Y], { facing: c.seed % 2 ? 1 : -1, scale: 1.05, alpha: fog ? 0.5 : 0.92 });
}
function isoTag(ctx, X, Y, text, col, S) {
  ctx.font = `800 ${Math.max(9, Math.round(7 * S))}px Segoe UI, sans-serif`;
  ctx.textAlign = "center";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.strokeText(text, X, Y);
  ctx.fillStyle = col;
  ctx.fillText(text, X, Y);
}
function drawUnitIso(ctx, state, b, s, H, now) {
  const t = s.t, S = FR.S, [X, Y] = feet(s);
  void now;
  if (t.ztype === "sleeper") {
    // A spotted Sleeper: its body is drawn with the others; a dashed ring and its letter mark it.
    if (t.dead) return;
    ctx.strokeStyle = t.id === H.sel ? "#e0a84f" : ZRING.sleeper; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.ellipse(X, Y, 14 * S, 6.5 * S, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    isoTag(ctx, X, Y - 9 * S, t.short, ZRING.sleeper, S);
    iso.rects.push({ x0: X - 14 * S, x1: X + 14 * S, y0: Y - 8 * S, y1: Y + 7 * S, x: t.x, y: t.y, id: t.id });
    return;
  }
  const ring = t.down ? (t.ko ? (t.tied ? "#c9a74a" : "#9aa0a8") : t.stab ? COL.good : COL.bad) : ringOf(t);
  if (!t.dead) { // (the dead lie in their own pool of blood: ui/downsprites.js)
    ctx.fillStyle = "rgba(0,0,0,0.38)";
    ctx.beginPath(); ctx.ellipse(X + 1.5 * S, Y + 0.5 * S, 10 * S, 4.6 * S, 0, 0, Math.PI * 2); ctx.fill();
    const sel = t.id === H.sel;
    ctx.strokeStyle = sel ? "#e0a84f" : t.sneaking ? SNEAK_LOOK.ring : ring;
    ctx.lineWidth = sel ? 3 : 2;
    if (t.sneaking) ctx.setLineDash([4, 3]); // sneaking (sim/vision.js): a broken ring
    ctx.beginPath(); ctx.ellipse(X, Y, 11 * S, 5.2 * S, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    if (sel) { ctx.strokeStyle = "rgba(224,168,79,0.45)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(X, Y, 14 * S, 6.8 * S, 0, 0, Math.PI * 2); ctx.stroke(); }
  }
  drawBody(ctx, state, b, s, H);
  if (t.down && t.tied) {
    ctx.strokeStyle = "#c9a74a"; ctx.lineWidth = Math.max(2, 0.8 * S);
    ctx.beginPath(); ctx.ellipse(X - 4 * S, Y - 2 * S, 1.6 * S, 3 * S, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(X + 4 * S, Y - 2 * S, 1.6 * S, 3 * S, 0, 0, Math.PI * 2); ctx.stroke();
  }
  // A Flinger winding up, someone panicking (sim/middead.js).
  if (t.windup != null && !t.dead) isoTag(ctx, X, Y - UNIT_H * 1.05 * S, "WINDS UP", ZRING.flinger, S);
  if (t.terror && !t.dead && !t.down) isoTag(ctx, X, Y - UNIT_H * 1.05 * S, "PANIC", ZRING.nightmare, S);
  // Its rectangle on screen, for clicking it.
  if (!t.dead && !t.down) {
    const big = t.boss === "hivemind" ? 1.8 : t.boss ? 1.35 : t.ztype === "brute" ? 1.15 : 1, hgt = UNIT_H * big * S;
    iso.rects.push({ x0: X - hgt * 0.36, x1: X + hgt * 0.36, y0: Y - hgt * 0.94, y1: Y, x: t.x, y: t.y, id: t.id });
  }
}
function drawGhost(ctx, state, b, q, H) {
  const s = { t: q.unit, wx: q.x + 0.5, wy: q.y + 0.5, z: standZ(b, q.x, q.y) };
  const [X, Y] = feet(s), S = FR.S;
  if (q.heard) { // heard, not seen (sim/hearing.js): a "?" with sound arcs, no silhouette
    ctx.strokeStyle = "rgba(255,209,102,0.7)"; ctx.lineWidth = 1.5;
    for (const k of [5, 8, 11]) { ctx.beginPath(); ctx.arc(X, Y - 8 * S, k * S, -Math.PI * 0.3, Math.PI * 0.3); ctx.stroke(); ctx.beginPath(); ctx.arc(X, Y - 8 * S, k * S, Math.PI * 0.7, Math.PI * 1.3); ctx.stroke(); }
    ctx.font = `800 ${Math.max(12, Math.round(5 * S))}px Segoe UI, sans-serif`;
    ctx.textAlign = "center"; ctx.fillStyle = "rgba(255,209,102,0.95)";
    ctx.fillText("?", X, Y - 5 * S);
    return;
  }
  ctx.globalAlpha = 0.3;
  drawBody(ctx, state, b, s, H, true);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(255,143,133,0.6)"; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(X, Y, 11 * S, 5.2 * S, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = `700 ${Math.max(10, Math.round(3.6 * S))}px Segoe UI, sans-serif`;
  ctx.textAlign = "center"; ctx.fillStyle = "rgba(255,209,102,0.9)";
  ctx.fillText(`? T${q.turn}`, X, Y - UNIT_H * S - 2);
}
// Health, action pips, status tags, the kind of a hive's special dead, height, the hit chance.
function drawLabels(ctx, b, s, H) {
  const t = s.t;
  if (t.dead) {
    // A body in danger (sim/carriers.js): a pale "!" over it while a Carrier is near or the worm is in it (red: it
    // gets up at the end of this turn), until it gets up, burns or its skull is crushed.
    if (endangered(b, t)) {
      const [X, Y0] = feet(s);
      ctx.font = `800 ${Math.max(12, Math.round(5 * FR.S))}px Segoe UI, sans-serif`;
      ctx.textAlign = "center"; ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.strokeText("!", X, Y0 - 8 * FR.S); ctx.fillStyle = imminent(b, t) ? "#ff8f85" : ZRING.carrier; ctx.fillText("!", X, Y0 - 8 * FR.S);
    }
    return;
  }
  const S = FR.S, [X, Y0] = feet(s);
  const big = t.boss === "hivemind" ? 1.8 : t.boss ? 1.35 : t.ztype === "brute" ? 1.15 : 1;
  const top = t.down ? Y0 - 10 * S : Y0 - UNIT_H * big * S;
  const f = Math.max(0, Math.min(1, t.hp / t.maxHp)), bw = Math.max(22, 16 * S), by = top - 6;
  ctx.fillStyle = "rgba(12,14,17,0.9)"; ctx.fillRect(X - bw / 2 - 1, by - 1, bw + 2, 5);
  ctx.fillStyle = f > 0.6 ? COL.good : f > 0.3 ? COL.mid : COL.bad; ctx.fillRect(X - bw / 2, by, bw * f, 3);
  const fs = Math.max(10, Math.round(3.4 * S));
  if (t.side === "player" && t.vol == null && active(t) && b.phase === "player") for (let i = 0; i < 2; i++) {
    ctx.fillStyle = i < t.ap ? "#8fc1ff" : "#2c3139";
    ctx.beginPath(); ctx.arc(X + bw / 2 + 5 + i * 7, by + 1, 2.8, 0, Math.PI * 2); ctx.fill();
  }
  const hh = hAt(b, t.x, t.y);
  const tags = [];
  if (t.down && !t.surr) tags.push([t.ko ? (t.tied ? "TIED" : "ZZ") : t.stab ? "+" : "!", t.ko ? "#9aa0a8" : t.stab ? COL.good : COL.bad]); // surr: its own tag (ui/nonlethal.js)
  else if (t.tied && !t.down) tags.push(["TIED", "#c9a74a"]); // a captive of yours tied up on a rescue raid (sim/rescueraid.js)
  if (t.ztype && !t.down) tags.push([`${t.short}${t.elite ? "★" : ""}`, ringOf(t)]);
  if (!t.down && isMedic(t)) tags.push(["✚", "#ff6b6b"]); // a medic (sim/medics.js)
  if (t.side === "player" && t.vol != null && !t.dead) tags.push(["VOL", "#c9a2ff"]); // a volunteer from an allied group: their own orders (sim/volunteers.js)
  if (t.dragging != null) tags.push(["DRAG", "#e0a84f"]);
  if (t.shaken && !t.down) tags.push(["SHK", "#ffd166"]); // revived: shaken, −10 aim
  if (t.boss && !t.down) tags.push([t.boss === "broodmother" ? "BROOD" : t.boss === "hivemind" ? "MIND" : "WALL", COL.bad]);
  if (t.ow) tags.push(["OW", "#e0a84f"]);
  if (t.hunker) tags.push(["HD", "#4aa3ff"]);
  if (t.stun && !t.down && !t.dead) tags.push(t.stun.dazed ? ["DZ", "#cfd6e0"] : ["STN", "#ffffff"]); // a flashbang (sim/throwables.js)
  if (t.side === "enemy" && !t.aware && !t.ko) tags.push(t.investigate ? ["??", "#e0a84f"] : ["?", "#ffd166"]);
  if (t.side === "player" && t.post && b.phase === "deploy") tags.push([t.post === "gate" ? "G" : t.post === "wall" ? "W" : t.post === "tower" ? "T" : "P", "#e0a84f"]);
  if (t.surprised) tags.push(["!", "#ffd166"]);
  tags.push(...nlTags(t)); // stunned, blinded, hands up, pulling blows (ui/nonlethal.js)
  if (hh && !t.down) tags.push(["▲".repeat(hh), "#ffe296"]);
  ctx.font = `700 ${fs}px Segoe UI, sans-serif`;
  let tx = X - bw / 2;
  for (const [txt, col] of tags) {
    const w = ctx.measureText(txt).width + 6;
    ctx.fillStyle = "rgba(15,17,20,0.9)"; rr(ctx, tx, by - fs - 4, w, fs + 2, 3); ctx.fill();
    ctx.fillStyle = col; ctx.textAlign = "left"; ctx.fillText(txt, tx + 3, by - 5);
    tx += w + 2;
  }
  // The hit chance of the selected unit against each enemy in sight (X-COM's labels).
  if (t.side === "enemy" && active(t) && H.hits && H.hits.has(t.id)) {
    const o = H.hits.get(t.id);
    const col = o.chance >= 65 ? COL.good : o.chance >= 35 ? COL.mid : COL.bad;
    tag(ctx, `${o.chance}%`, X + bw / 2 + 14, by + 4, col, fs);
  }
}

// ---------- effects ----------
function drawFxIso(ctx, b, now, H, state = null, shown = []) {
  const S = FR.S;
  for (const f of b.fx) {
    if (f.type === "move" || f.seq < b.fxSeq - 8 || !onFloor(b, f)) continue;
    const el = H.fxAge(f, now);
    if (el > 1400) continue;
    const zTo = f.to ? standZ(b, f.to[0], f.to[1]) : 0, zFrom = f.from ? standZ(b, f.from[0], f.from[1]) : 0;
    const [tx, ty] = f.to ? project(f.to[0] + 0.5, f.to[1] + 0.5, zTo + UNIT_H * 0.55) : [0, 0];
    if (f.type === "shot" && el < 600 && f.from) {
      const a = 1 - el / 600;
      let [fx, fy] = project(f.from[0] + 0.5, f.from[1] + 0.5, zFrom + UNIT_H * 0.6);
      // From the shooter's own muzzle (their gun's barrel end, or a fitted suppressor's), when they stand there still.
      const q = state && !f.overpen ? shown.find((o) => o.t.x === f.from[0] && o.t.y === f.from[1] && !o.t.down && !o.t.dead) : null;
      const mp = q ? muzzlePoint(state, b, q.t, H.salt, FR.r, S) : null;
      if (mp) { const [X, Y] = feet(q); fx = X + mp[0]; fy = Y + mp[1]; }
      ctx.strokeStyle = f.acid ? `rgba(154,214,58,${a})` : f.hit ? `rgba(255,180,80,${a})` : `rgba(200,200,200,${a * 0.7})`;
      ctx.lineWidth = f.hit ? 3 : 1.5;
      ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(tx + (f.hit ? 0 : 8 * S), ty + (f.hit ? 0 : -6 * S)); ctx.stroke();
      if (el < 90) { ctx.fillStyle = `rgba(255,230,150,${1 - el / 90})`; ctx.beginPath(); ctx.arc(fx, fy, 3 * S, 0, Math.PI * 2); ctx.fill(); }
    }
    if (f.type === "throw") {
      if (el < 500 && f.from) {
        const k = el / 500, [fx, fy] = project(f.from[0] + 0.5, f.from[1] + 0.5, zFrom + UNIT_H * 0.7), [gx, gy] = project(f.to[0] + 0.5, f.to[1] + 0.5, zTo);
        const px = fx + (gx - fx) * k, py = fy + (gy - fy) * k - Math.sin(k * Math.PI) * 30 * S;
        ctx.strokeStyle = "rgba(255,209,102,0.35)"; ctx.lineWidth = 1.5; ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(fx, fy); ctx.quadraticCurveTo((fx + gx) / 2, (fy + gy) / 2 - 60 * S, gx, gy); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = f.item === "molotov" ? "#ff9a3a" : f.item === "flare" ? "#ff5a3a" : "#c9b048";
        ctx.beginPath(); ctx.arc(px, py, 2.5 * S, 0, Math.PI * 2); ctx.fill();
      } else if (f.item === "flashbang" && el < 1000) { // the flash (sim/throwables.js FLASH)
        const a = 1 - (el - 500) / 500, R = 60 * S;
        const g = ctx.createRadialGradient(tx, ty, 0, tx, ty, R);
        g.addColorStop(0, `rgba(255,255,255,${0.95 * a})`); g.addColorStop(0.5, `rgba(255,250,220,${0.5 * a})`); g.addColorStop(1, "rgba(255,250,220,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(tx, ty, R, 0, Math.PI * 2); ctx.fill();
      }
      continue;
    }
    if (!f.to) continue;
    const a = Math.max(0, 1 - el / 1400);
    const text = f.text ? f.text : f.type === "heal" ? "+" : f.hit ? `${f.crit ? "CRIT " : ""}-${f.dmg}` : "MISS";
    ctx.font = `800 ${Math.round(Math.max(12, (f.crit ? 5.4 : 4.6) * S))}px Segoe UI, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillStyle = f.type === "loot" ? `rgba(255,209,102,${a})` : f.type === "heal" ? `rgba(${COL.goodRgb},${a})` : f.acid ? `rgba(170,230,70,${a})` : f.hit ? `rgba(255,${f.crit ? 210 : 110},90,${a})` : `rgba(210,210,210,${a})`;
    ctx.strokeStyle = `rgba(0,0,0,${a})`; ctx.lineWidth = 3;
    const y = ty - UNIT_H * 0.7 * S - (el / 1400) * 14 * S;
    ctx.strokeText(text, tx, y); ctx.fillText(text, tx, y);
  }
}
