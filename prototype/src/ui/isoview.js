// The isometric battle view (pseudo-3D, the old X-COMs and Project Zomboid): the way a battle is drawn (the only
// battle view: there is no top-down one). A renderer only: every rule is in sim/combat.js; this module reads the battle and draws it.
//
// Geometry: 2:1 diamonds. In art pixels a tile is 32 × 16 and one height level (a walkway, a flat roof, an upper
// floor; a watchtower is two) LV px up. Everything is painted as pixel art at that size (procedural, in the State
// Map's gritty palette), cached, and drawn scaled up nearest-neighbour, so it stays crisp at any zoom:
//   - the ground of the whole map is one small canvas (floors textured by surface: grass, field, dirt, gravel,
//     asphalt, floorboards, concrete, rubble, water, mud and blood by the hive; a building's rooms by their floor and
//     their decor, sim/decor.js: rugs, clutter, the pools of its lights), rebuilt only when a floor changes or the view
//     turns;
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
import { CELL, active, coverSides, evacAt, barredCell, moveMob, vaultable, vaultBreaks } from "../sim/combat.js";
import { canPlace } from "../sim/deploy.js";
import { acidAt } from "../sim/acid.js";
import { unitCanvas, unitFacing, muzzleOf } from "./sprites.js";
import { unitFigure, unitFigureDown, corpseFigure, figureMuzzle, figureStats, FIG, setPieceArt, carryLook, CARRY_SCALE } from "./figures.js"; // every body as a low-poly figure, facing its way; the fallen lying along the world's x
import { unitDownCanvas, drawDowned, downScale, corpseCanvas } from "./downsprites.js";
import { thirdRing } from "../sim/thirdside.js";
import { parleyStatus } from "../sim/parley.js"; // another group's people on a raid's map: the hostility badge
import { endangered, imminent } from "../sim/carriers.js"; // a body in danger from the worm
import { isMedic } from "../sim/medics.js"; // a med kit makes a medic: the cross tag
import { nlTags } from "./nonlethal.js"; // status tags of the non-lethal kit (sim/nonlethal.js)
import { battleWeather, fogColour, fogCss, skirtFor, skirtTiles, drawVignette, setEdgeCanvas } from "./battleedge.js"; // the map's edge: ground fading into fog
import { drawBattleWx, setWxCanvas } from "./battlewx.js"; // rain, fog and snow over the view: the State Map's weather over the battle's tile
import { paintLights, drawGlow, drawDarkness, drawShade, setLightsCanvas } from "./battlelights.js"; // night: flashlight beams, lantern pools, the darkness; by day a dark room's shade
import { ingestMarks, revealMarks, drawMarks, knownBody, setMarksCanvas } from "./battlemarks.js"; // blood, brass, scorch, glass that stay
import { drawGroundIso, drawPileIso, drawCartIso, drawCartBoxIso } from "./ground.js";
import { isCart, parkCells, cartSpec } from "../sim/carts.js"; // a cart pushed (u.bag), its look; Park cart's cells
import { groundPiles, pileCount } from "../sim/ground.js"; // things on the ground (sim/ground.js)
import { planOpen } from "../sim/raidplan.js"; // before a raid: while the plan is open the team is not on the map yet (not drawn)
import { onForgetPictures } from "./pictures.js"; // the pictures kept here are dropped when the GPU context comes back (they would be blank)
import { strideOf } from "./moveanim.js"; // walking: the step of the walk cycle and the bob
import { treeLookFor, treeStyle, styleKey, FALL } from "./seasontrees.js"; // trees and bushes by the season (seasonTree, seasonBush)
import { snowOnFor } from "./roofsnow.js"; // snow on the buildings in winter (roofSprite, snowPrims)
import { ringingCars } from "../sim/caralarms.js"; // a car alarm ringing (2026-10-23): its hazard lights blinking, how far it is heard
import { groundTexel, leafField, leafBase, groundLookKey, snowShare, puddleField, puddleAt, puddleTexel } from "./groundlook.js"; // spring's mud, autumn's leaves, winter's snow on the ground (sim/seasonground.js); puddles after rain (sim/puddles.js)
import { FURNITURE_KINDS } from "../sim/data-furniture.js";
import { carriedPiece, partnerOf, setTargets } from "../sim/furnicarry.js"; // a piece of furniture carried (issue #12): drawn in the arms, between a pair (issue #17) // the furniture and appliance catalogue: the furniture set, its sprites (FURN_DRAW)
import { puddleGround } from "../sim/puddles.js"; // where a puddle may run onto (ui/groundlook.js puddleField)
import { vehicleCellSprite, vehicleOneSprite, setVehicleCanvas } from "./vehiclemodel.js"; // the cars and trucks as low-poly models, the State Map's look: a cell's share of one, a car on one cell

// ---------- constants ----------
const HW = 16, HH = 8;          // half a tile in art px (a tile: 32 × 16)
export const LV = 20;           // art px per height level
const WALL1 = 34, WALL2 = 2 * LV + 14, STUB = 7, PALISADE = LV + 9;
const UNIT_H = 30;              // a standing unit in art px
// Cars and trucks stand about head high on a survivor (the user's ask): their roofs at VEH_TOP art px. The bodies are
// drawn in their old proportions (roof at VEH_ROOF of the kind) and stretched up by VEH_TOP / roof, wheels from the ground.
const VEH_TOP = 28;
const VEH_ROOF = { m35: 20, humvee: 19, mrap: 21, truck: 17, car: 15, one: 16, oneTruck: 23, engine: 16.5, ambulance: 16, police: 15.5 };
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
  bottomInset: 0, // the battle's bottom bar over the map (px; ui/combat.js barInset): the compass sits above it
};
try { iso.roofs = typeof localStorage === "undefined" || localStorage.getItem(ROOFS_KEY) !== "0"; } catch { iso.roofs = true; }
export function setRoofs(on) {
  iso.roofs = !!on;
  try { localStorage.setItem(ROOFS_KEY, on ? "1" : "0"); } catch { /* this session only */ }
}

// Canvas factory (the tools hand in a stub).
let mkCanvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
export function setIsoCanvas(fn) { mkCanvas = fn; clearIsoCache(); setEdgeCanvas(fn); setLightsCanvas(fn); setMarksCanvas(fn); setWxCanvas(fn); setVehicleCanvas(fn); }
const spriteCache = new Map();
const groundCaches = new Map(), GROUNDS = 6; // groundFor: key -> picture, of one battle (dropped with a new one), least recently used first
let fogCache = null, sceneCache = null, fogMaskCache = null, flatGroundCache = null;
export function clearIsoCache() { spriteCache.clear(); groundCaches.clear(); fogCache = sceneCache = fogMaskCache = flatGroundCache = null; for (const k of Object.keys(looksCache)) delete looksCache[k]; }
export const isoCacheSize = () => spriteCache.size;
export const isoSpriteKeys = () => [...spriteCache.keys()]; // the cached sprites' keys (tools/decortest.js)

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
const WALLISH = new Set(["wall", "window", "door", "bdoor", "doorway", "smashed", "idoor", "odoor", "boarded"]); // boarded: a door or window under boards (sim/barricade.js)
const FLOORED = new Set(["open", "counter", "cabinet", "shelf", "locker", "crate", "loft", "stairs", "rack", "table", "bed", "bars", "ladder"]);
// Furniture that stands on a building's upper floor (sim/buildingmaps.js: a cell with a height that is not walked on)
// is drawn on a slab of the upper floor, raised with it.
// Both are driven from the furniture catalogue (sim/data-furniture.js): every piece but the yard's (hay bales and rain
// barrels stand outdoors on the ground, never on a floor; hay is raised with a hayloft all the same), and the
// wall-standing pieces turn to run along the wall they stand by (lookOf, JOINS).
const FURNITURE = new Set(Object.keys(FURNITURE_KINDS).filter((k) => k !== "barrel"));
for (const k of Object.keys(FURNITURE_KINDS)) if (k !== "hay" && k !== "barrel") FLOORED.add(k);
const WALL_FURN = new Set(Object.keys(FURNITURE_KINDS).filter((k) => FURNITURE_KINDS[k].wall));
FLOORED.add("cart"); // sim/carts.js: a cart parked on a cell (drawn as its sprite, ui/ground.js) // sim/locks.js gun safes: a steel box standing on the floor
// Buildings: 4-connected cells with floorboards (houses, shops, the base's buildings; flat-roofed blocks are solid).
const GROUNDY = new Set(["water", "trench", "spikes", "hivewall"]);
function sceneFor(b) {
  let sig = 0, fsig = 0;
  for (let i = 0; i < b.cells.length; i++) {
    const c = b.cells[i], kc = c.k.charCodeAt(0) * 7 + c.k.length + (c.k.charCodeAt(2) || 0), fc = (c.f ? c.f.charCodeAt(0) + c.f.length : 0) + (c.fl ? c.fl.charCodeAt(0) * 3 + c.fl.length : 0) + (c.deco ? decoSig(c.deco) : 0) + (c.wc ? c.wc.charCodeAt(3) * 11 + c.wc.charCodeAt(5) : 0) + (c.wart ? c.wart.k.charCodeAt(1) * 17 + c.wart.d : 0); // decor (sim/decor.js) drawn in the ground and the walls
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
  const pits = []; // the fire pits: their flames, sparks, smoke and glow drawn each frame while lit (drawCampfireIso)
  for (let i = 0; i < n; i++) if (b.cells[i].k === "firepit") pits.push(i);
  sceneCache = { b, key, comp, blds, ext, sig, pits, groundKey: `${b.w}x${b.h}:${fl}:${fsig}` };
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
// The ground a building's cell stands on (sim/basemap.js groundBuilt: a hut up on a hill, or down on the plain below a
// camp on a hilltop): its roof and its top that much higher or lower than the building's own (scene.blds top).
const bldGround = (b, i) => groundLv(b.cells[i]) * LV;
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
// The light, the one the survivor sprites and the item icons use: the top lit, the south (+v, screen-left) face
// about the colour itself, the east (+u, screen-right) face well into shade. A top's far edges catch it (EDGE).
const LIGHT = { top: 1.04, south: 0.92, east: 0.62 }, EDGE = 1.16;
// Round things (cylinders and blobs) shade in facets, like the figures' eight-sided limbs, not in a smooth gradient.
const FACETS = 8, BANDS = 5;
const facet = (q, n) => Math.round(q * (n - 1)) / (n - 1);
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
function paint(prims, o = {}) {
  const { buf, w, h, x0, y0 } = paintPx(prims, o);
  const cv = mkCanvas(w, h);
  const c = cv.getContext("2d");
  const img = c.createImageData(w, h);
  img.data.set(buf);
  c.putImageData(img, 0, 0);
  return toBitmap({ cv, ox: x0, oy: y0, w, h });
}
// The pixels themselves (paint; ui/figures.js paints a carried piece's into a figure: pieceArt): RGBA, w × h, its
// corner at art px (x0, y0).
function paintPx(prims, { fog = false, outline = false, st = iso.straight } = {}) {
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
        if (Math.abs(Y - top) <= ry * e) { const c = p.m("top", X - cx, Y - top, X, Y); if (c) put(i, c, LIGHT.top); continue; }
        if (Y > top && Y <= cy - p.z0 + ry * e) {
          const c = p.m("side", dx, cy - p.z0 + ry * e - Y, X, Y);
          if (c) put(i, c, 0.98 - 0.4 * facet((dx + 1) / 2, FACETS));
        }
        continue;
      }
      if (p.blob) {
        const [u, v, z] = p.blob, cx = artX(u, v, st), cy = artY(u, v, st) - z, rx = p.ru * RX(st);
        const nx = (X - cx) / rx, ny = (Y - cy) / p.rz, q = nx * nx + ny * ny;
        if (q > 1) continue;
        const nz = Math.sqrt(1 - q), l = 0.42 + 0.58 * facet(clamp01(-0.45 * nx - 0.5 * ny + 0.75 * nz), BANDS);
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
          if (col) put(i, col, (s > su - 1 || t > sv - 1) && !p.flat ? EDGE : LIGHT.top);
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
        if (col) put(i, col, (s > su - 1 || t > sv - 1) && !p.flat ? EDGE : LIGHT.top);
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
  return { buf, w, h, x0, y0 };
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

// One cell's share of a car that covers 2 × 3–4 cells (sim/combat.js placeCar: o.car = { i, j, L, ax, kind, v }), as
// prisms: the fallback when the car's low-poly model cannot be painted (no canvas: the tools); every view draws the
// model, the State Map's look, cut by cell the same way (ui/vehiclemodel.js vehicleCellSprite; carModelSprite below). The
// body is drawn in car-local units (a along its length 0..L, c across 0..2, z in art px) and clipped to this cell, so
// the cells' pieces meet into one car: a low body, a cabin of glass in the middle (a van's longer, a pickup's bed
// The Army trucks (sim/miltrucks.js TRUCK_KINDS body) in car-local units: [a0, a1, c0, c1, z0, z1, "body" | colour].
const MIL_TOPS = {
  m35: (L) => [[0.1, 1.4, 0.15, 1.85, 3, 13, "body"], [0.15, 0.5, 0.3, 1.7, 9, 14, "#1e2418"], [1.5, L - 0.1, 0.05, 1.95, 4, 19, "#6b6a48"], [1.5, L - 0.1, 0.92, 1.08, 19, 20, "#58573a"]],
  humvee: (L) => [[0.05, L - 0.05, 0.05, 1.95, 3, 11, "body"], [0.9, 1.9, 0.3, 1.7, 11, 15, "#1e2418"], [1.25, 1.65, 0.75, 1.25, 15, 19, "#3a4228"]],
  mrap: (L) => [[0.05, L - 0.05, 0.05, 1.95, 4, 20, "body"], [0.05, 0.4, 0.4, 1.6, 13, 18, "#1c2016"], [1.4, L - 0.4, 0.3, 1.7, 20, 21, "#55603a"]],
};
const MIL_WHEELS = { m35: (L) => [0.7, L - 1.5, L - 0.6], humvee: (L) => [0.6, L - 0.6], mrap: (L) => [0.7, L - 0.7] };
// The civic vehicles parked inside (sim/civiclayout.js, issue #15): a fire engine (red, a ladder on its roof, hose reels
// on its flanks, a light bar on the cab), an ambulance (a white box with a red stripe), a police car (black and white, a
// light bar on its roof). [a0, a1, c0, c1, z0, z1, colour] along its length and across it, as MIL_TOPS; "body" its paint.
const CIV_TOPS = {
  engine: (L) => [[0.1, 1.5, 0.1, 1.9, 3, 14, "body"], [0.15, 0.45, 0.3, 1.7, 9, 14, "#2a3a44"], [0.4, 1.2, 0.5, 1.5, 14, 15.5, "#d04030"], [1.6, L - 0.1, 0.05, 1.95, 3, 15, "body"],
    [2.0, 2.8, 0, 0.08, 6, 12, "#b8bec4"], [3.2, 4.0, 0, 0.08, 6, 12, "#b8bec4"], [2.0, 2.8, 1.92, 2, 6, 12, "#b8bec4"], [3.2, 4.0, 1.92, 2, 6, 12, "#b8bec4"],
    [1.7, L - 0.2, 0.6, 0.72, 15, 16.5, "#b8bec4"], [1.7, L - 0.2, 1.28, 1.4, 15, 16.5, "#b8bec4"]],
  ambulance: (L) => [[0.1, 1.3, 0.15, 1.85, 3, 11, "body"], [0.2, 0.5, 0.3, 1.7, 8, 11, "#2a3a44"], [1.35, L - 0.1, 0.1, 1.9, 3, 16, "body"], [1.35, L - 0.1, 0.06, 0.1, 8, 10, "#b02a20"], [1.35, L - 0.1, 1.9, 1.94, 8, 10, "#b02a20"], [0.5, 1.1, 0.6, 1.4, 11, 12.5, "#d04030"]],
  police: (L) => [[0.1, L - 0.1, 0.15, 1.85, 3, 9, "body"], [0.1, L - 0.1, 0.12, 0.16, 5, 8, "#e8e8e0"], [0.1, L - 0.1, 1.84, 1.88, 5, 8, "#e8e8e0"], [0.9, L - 1.1, 0.3, 1.7, 9, 14, "#2a3a44"], [1.3, 1.9, 0.4, 1.0, 14, 15.5, "#d04030"], [1.3, 1.9, 1.0, 1.6, 14, 15.5, "#3050c0"]],
};
const CIV_PAINT = { engine: "#a8241c", ambulance: "#dcdad2", police: "#22252a" };
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
  } else if (CIV_TOPS[car.body]) {
    const col = car.wrecked ? hex("#2b2723") : hex(CIV_PAINT[car.body]);
    const m = (f, s, t, X, Y) => (n2(X, Y, 13) > 0.95 ? mul(PAL.rust, 1.1) : mul(col, f === "top" ? 1 : 0.92));
    for (const [a0, a1, c0, c1, z0, z1, k] of CIV_TOPS[car.body](L)) parts.push([a0, a1, c0, c1, z0, z1, k === "body" ? m : flatM(hex(k))]);
    for (const a of car.body === "engine" ? [0.7, L - 1.5, L - 0.6] : [0.6, L - 0.6]) { wheel(a, 0.2); wheel(a, 1.8); }
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
  const zk = car.body === "bike" ? 1 : vehZ(mil || CIV_TOPS[car.body] ? VEH_ROOF[car.body] : big ? VEH_ROOF.truck : VEH_ROOF.car);
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
// A spotlight's post and lamp head from z0 up (a stand's platform or a ground base): its glass lit pale yellow, dark
// when it is smashed (broken).
function spotHead(z0, broken = false) {
  return [
    { u0: 0.46, u1: 0.54, v0: 0.46, v1: 0.54, z0, z1: z0 + 14, m: tex(PAL.metalDk, 0.1) },
    { u0: 0.3, u1: 0.7, v0: 0.36, v1: 0.64, z0: z0 + 13, z1: z0 + 21, m: (f) => (f === "top" ? PAL.metal : broken ? hex("#3a3a36") : hex("#f6eeb0")) },
  ];
}
// What a cell draws: the ground's own height under it first (terrainPrims: a column of earth, banks to lower ground),
// then its own look raised onto it; trees and bushes drawn larger (the playtest 2026-10-23: "Make trees and bushes
// larger they now seem small in comparison to survivors and hills": GROWN).
const GROWN = { tree: [1.45, 1.18], bush: [1.6, 1.3] }; // [height ×, spread ×]
function prims(k, o) {
  if (k === "crag" && o.ter) return rockPrims(o.ter); // a mountain's rock: its own height, one mass with its neighbours
  let own = k === "open" || k === "water" ? [] : primsOf(k, o); // water: a pond's deep middle (sim/ponds.js), drawn by wetPrims
  if (GROWN[k]) own = scalePrims(own, GROWN[k][0], GROWN[k][1]);
  if (o.sn) own = snowPrims(own, o.sn); // snow on its tops (lookOf: SNOW_ON)
  if (!o.ter) return own;
  return [...terrainPrims(o.ter, o), ...wetPrims(o), ...raisePrims(own, o.ter.e * LV)];
}
// A hollow's pond or its ice (sim/ponds.js, the user's word 2026-10-23: "hollows turning into ponds ... a frozen pond"):
// a flat sheet at the water's level (o.wl) over the cell, the river's water (floorColor) with its glints, darker where
// it is deep; ice pale and cracked, snow lying on it in drifts. The banks round it are the cells beside it (theirs drawn
// before it behind, after it in front), so the water laps up them. Mud is the hollow's own top (terrainPrims topC).
const ICE_C = hex("#a8bfcc"), MUD_C = hex("#45332a"), SNOW_C = hex("#dde3e8");
const drift = (X, Y, k) => n2(Math.floor(X / 6), Math.floor(Y / 3), k); // patches a few pixels across (snow, puddles)
function wetPrims(o) {
  if (!o.wet || o.wet === "mud") return [];
  const z = o.wl * LV, ice = o.wet === "ice", deep = o.wet === "deep";
  const m = (f, s, t, X, Y) => {
    if (f !== "top") return null;
    const q = n2(X, Y, 3);
    if (ice) {
      if (o.snow && drift(X, Y, 31) < o.snow * 0.4) return mul(SNOW_C, 0.94 + q * 0.06);
      return n2(Math.floor(X / 4), Math.floor(Y / 2), 17) > 0.93 ? mul(ICE_C, 0.72) : mul(ICE_C, 0.92 + q * 0.12);
    }
    const w = mul(hex("#2c4e68"), deep ? 0.8 : 0.95);
    return mul(w, 0.92 + ((Math.floor(X) + Math.floor(Y) * 2 + Math.floor(q * 7)) % 9 === 0 ? 0.35 : 0) + q * 0.08);
  };
  return [{ u0: 0, u1: 1, v0: 0, v1: 1, z0: z - 1, z1: z, flat: true, m }];
}
const raisePrims = (list, dz) => (!dz ? list : list.map((p) => (p.blob ? { ...p, blob: [p.blob[0], p.blob[1], p.blob[2] + dz] } : { ...p, z0: (p.z0 || 0) + dz, z1: (p.z1 || 0) + dz })));
// Taller by sz, wider by sr about the cell's middle.
function scalePrims(list, sz, sr) {
  const at = (q) => 0.5 + (q - 0.5) * sr;
  return list.map((p) => {
    if (p.blob) return { ...p, blob: [at(p.blob[0]), at(p.blob[1]), p.blob[2] * sz], ru: p.ru * sr, rz: p.rz * sz };
    if (p.cyl) return { ...p, cyl: [at(p.cyl[0]), at(p.cyl[1]), p.cyl[2] * sr], z0: p.z0 * sz, z1: p.z1 * sz };
    return { ...p, z0: p.z0 * sz, z1: p.z1 * sz };
  });
}
// The ground's height at a cell (sim/basescatter.js reliefLayer, sim/relief.js; sim/combat.js c.h with c.ter): a column
// of earth from the lowest ground beside it up to its own level, its top the floor it has (grass, a road, gravel), and on
// each side where the ground beside it is lower a bank falling away to that level (RISE: the band, its foot), a rounded
// shoulder where two such sides meet. T: { e (its level), bottom (the lowest beside it), falls: [+u, −u, +v, −v] the
// ground's level that way }.
function terrainPrims(T, o) {
  const f = o.f || "grass", zt = T.e * LV;
  const topC = (X, Y, k = 1) => {
    const q = n2(X, Y, 6);
    // A hollow's mud (sim/ponds.js): dark and wet, a puddle's sheen here and there; snow lying (o.snow, the battle's
    // b.snowLie) on the hills' tops and banks in drifts; the season on the ground (o.gt: spring's mud, winter's snow,
    // autumn's leaves o.lf, as on the level ground: ui/groundlook.js groundTexel).
    if (o.wet === "mud") return mul(drift(X, Y, 29) > 0.86 ? hex("#3e4048") : MUD_C, k * (0.86 + q * 0.2));
    if (o.snow && T.e > 0 && !o.gt && drift(X, Y, 31) < snowShare(o.snow)) return mul(SNOW_C, k * (0.92 + q * 0.08));
    const c = f === "road" ? mul(FLOORC.road, 0.9 + q * 0.12) : f === "gravel" || f === "deck" ? mul(FLOORC.gravel, 0.8 + q * 0.35) : f === "dirt" ? mul(FLOORC.dirt, 0.88 + q * 0.2) : f === "field" ? mul(FLOORC.field, 0.9 + q * 0.12) : f && f !== "grass" && FLOORC[f] ? mul(FLOORC[f], 0.9 + q * 0.12) : q > 0.9 ? mul(PAL.leaf2, 0.9) : mul(FLOORC.grass, 0.88 + q * 0.2); // a building's floor on a hill (sim/basemap.js groundBuilt)
    if (o.gt) { const g = groundTexel(c, o.gt, X, Y, o.lf || 0); if (g !== c) return mul(g, k); }
    return mul(c, k * (1 + 0.07 * T.e)); // the higher, the lighter: the levels read apart
  };
  const side = (f2, s, t, X, Y) => { const q = n2(X, Y, 4); return Math.floor(t + q * 4) % 7 < 1 ? mul(PAL.stone, 0.72) : mul(FLOORC.dirt, 0.78 + q * 0.22); };
  const [fu, fnu, fv, fnv] = T.falls, B = RISE.BANK;
  const pu = fu < T.e, nu = fnu < T.e, pv = fv < T.e, nv = fnv < T.e;
  const u0 = nu ? B : 0, u1 = pu ? 1 - B : 1, v0 = nv ? B : 0, v1 = pv ? 1 - B : 1;
  // The column's faces go down only as far as the ground in front of them (a face below its neighbour's ground would be
  // drawn over that ground: the rim of a hollow read as a box): the south face (+v) to the +v neighbour's level, the
  // east face (+u) to the +u one's, each from a box of its own (the other face left out: m gives null).
  const zS = Math.min(T.e, fv) * LV, zE = Math.min(T.e, fu) * LV, zf = Math.max(zS, zE);
  const out = [
    { u0, u1, v0, v1, z0: zS, z1: zt, flat: true, m: (f2, s, t, X, Y) => (f2 === "top" ? topC(X, Y) : f2 === "east" ? null : side(f2, s, t, X, Y)) },
    { u0, u1, v0, v1, z0: zE, z1: zt, flat: true, m: (f2, s, t, X, Y) => (f2 === "top" ? topC(X, Y) : f2 === "south" ? null : side(f2, s, t, X, Y)) },
  ];
  // A bank down to `lo` (a level): h 0 at the top's edge, 1 at the cell's.
  const zAt = (h, lo) => zt - (zt - (lo * LV + RISE.FOOT * LV)) * Math.pow(h, 1.4);
  // A bank in grass, a little darker the further down, its faces in part shade (the slopes facing away read darker).
  const bankM = (h) => halfLit((f2, s, t, X, Y) => (f2 === "top" ? topC(X, Y, 1 - 0.2 * h) : t < 1.5 ? mul(FLOORC.dirt, 0.8) : topC(X, Y, 0.9 - 0.2 * h)));
  const N = RISE.SLICES;
  for (let i = 0; i < N; i++) {
    const h = (i + 0.5) / N, a = (i * B) / N, b = ((i + 1) * B) / N, m = bankM(h);
    if (pu) out.push({ u0: 1 - B + a, u1: 1 - B + b, v0, v1, z0: Math.min(zf, zAt(h, fu)), z1: zAt(h, fu), flat: true, m });
    if (nu) out.push({ u0: B - b, u1: B - a, v0, v1, z0: Math.min(zf, zAt(h, fnu)), z1: zAt(h, fnu), flat: true, m });
    if (pv) out.push({ u0, u1, v0: 1 - B + a, v1: 1 - B + b, z0: Math.min(zf, zAt(h, fv)), z1: zAt(h, fv), flat: true, m });
    if (nv) out.push({ u0, u1, v0: B - b, v1: B - a, z0: Math.min(zf, zAt(h, fnv)), z1: zAt(h, fnv), flat: true, m });
  }
  for (const [cu, cv, lo] of [[pu && pv && [1 - B, 1], [1 - B, 1], Math.max(fu, fv)], [pu && nv && [1 - B, 1], [0, B], Math.max(fu, fnv)], [nu && pv && [0, B], [1 - B, 1], Math.max(fnu, fv)], [nu && nv && [0, B], [0, B], Math.max(fnu, fnv)]]) {
    if (!cu) continue;
    const M = 4;
    for (let i = 0; i < M; i++) for (let k = 0; k < M; k++) {
      const a0 = cu[0] + (i * B) / M, b0 = cv[0] + (k * B) / M;
      const du = cu[0] === 0 ? (M - 1 - i + 0.5) / M : (i + 0.5) / M, dv = cv[0] === 0 ? (M - 1 - k + 0.5) / M : (k + 0.5) / M;
      const h = Math.min(1, Math.hypot(du, dv));
      out.push({ u0: a0, u1: a0 + B / M, v0: b0, v1: b0 + B / M, z0: Math.min(zf, zAt(h, lo)), z1: zAt(h, lo), flat: true, m: bankM(h) });
    }
  }
  return out.sort((p, q) => p.u0 + p.v0 - q.u0 - q.v0);
}
// A mountain's rock (the playtest 2026-10-23: "Make the mountains more pointed instead of rounded and make it all
// combine into the center instead of dozens of ball pyramid looking things"): a cell of crag at its height (T.e, the
// massif's: higher in from its edge), falling straight to each lower neighbour across half the cell (ROCK.BANK), so the
// cells run together into one mass: a cell with lower rock all round comes to a point, one between two lower sides
// to a crest; banded grey faces, snow above ROCK.SNOW levels.
const ROCK = { GRID: 7, SNOW: 8 }; // GRID: the little columns a cell's surface is drawn in, a side
function rockPrims(T) {
  const g = T.g || [[T.e, T.e, T.e], [T.e, T.e, T.e], [T.e, T.e, T.e]], c = g[1][1];
  // The surface: the cell's own height at its middle, half way to each side neighbour at the middle of that side, the
  // four cells' mean at each corner, eased between (bilinear in each quarter): one surface across the cells, a point
  // where the middle stands above all round it, a crest along a line of the highest.
  const side = (dv, du) => (c + g[1 + dv][1 + du]) / 2;
  const corner = (dv, du) => (c + g[1 + dv][1] + g[1][1 + du] + g[1 + dv][1 + du]) / 4;
  const zAt = (u, v) => {
    const du = u < 0.5 ? -1 : 1, dv = v < 0.5 ? -1 : 1, fu = Math.abs(u - 0.5) * 2, fv = Math.abs(v - 0.5) * 2;
    const a = c + (side(0, du) - c) * fu, b = side(dv, 0) + (corner(dv, du) - side(dv, 0)) * fu;
    return (a + (b - a) * fv) * LV;
  };
  // Snow above ROCK.SNOW levels (patchy just below it: the rock shows through), smooth, not speckled.
  const rockC = (z, X, Y, k) => { const q = n2(X, Y, 8), snow = z >= ROCK.SNOW * LV ? q > 0.04 : z >= (ROCK.SNOW - 1) * LV ? n2(Math.floor(X / 4), Math.floor(Y / 3), 14) > 0.55 : false; return snow ? mul(hex("#e2e6ea"), (0.95 + q * 0.05) * k) : mul(PAL.stone, (0.9 + q * 0.2) * k); };
  const M = (z) => halfLit((f, s, t, X, Y) => { const q = n2(X, Y, 9), crack = n2(Math.floor(X / 3), Math.floor(Y / 2), 13) > 0.9; return f === "top" ? rockC(z, X, Y, 1) : crack ? mul(PAL.stone, 0.5) : rockC(z, X, Y, Math.floor((t + q * 5) / 6) % 2 ? 0.8 : 0.9); });
  const K = ROCK.GRID, z1 = [];
  for (let j = 0; j < K; j++) { z1.push([]); for (let i = 0; i < K; i++) z1[j].push(zAt((i + 0.5) / K, (j + 0.5) / K)); }
  // Each little column down to the lowest of the next ones toward the camera (+u, +v), or at the cell's own edge to
  // the ground there (the front neighbour's height: never below what is drawn in front of it).
  const out = [];
  for (let j = 0; j < K; j++) for (let i = 0; i < K; i++) {
    const zt = z1[j][i];
    const zu = i + 1 < K ? z1[j][i + 1] : Math.min(zt, g[1][2] * LV), zv = j + 1 < K ? z1[j + 1][i] : Math.min(zt, g[2][1] * LV);
    out.push({ u0: i / K, u1: (i + 1) / K, v0: j / K, v1: (j + 1) / K, z0: Math.min(zt, zu, zv), z1: zt, flat: true, m: M(zt) });
  }
  return out.sort((p, q) => p.u0 + p.v0 - q.u0 - q.v0);
}
// A rock and a boulder (the user's request 2026-10-23: "Fix the way boulders and rocks look in raids they are too
// circular make them similar to how the hills taper but make them grey or so for rocks and make some that are shorter
// for half cover and tall ones for tall cover"): a heap of grey stone in little columns, as the mountain's rock
// (rockPrims), with a flat top whose sides taper down as the hills' banks do (rounded at the shoulder, steep at the
// foot: STONE.TAPER, STONE.FLAT), its outline uneven (lobes by the cell's variant) and a lower shelf off one side. A
// rock is knee high (half cover, sim/combat.js CELL.rock), a boulder head high (full cover, blocks sight:
// CELL.boulder), STONE.H by its variant. Grey faces in strata STONE.BAND px deep, level across the heap.
const STONE = { GRID: 8, H: { tall: [24, 29], short: [8, 11] }, R: { tall: 0.47, short: 0.42 }, TAPER: 1.6, FLAT: 1.45, BAND: 4 };
const STONEC = hex("#808285"); // a cool grey: the mountain's PAL.stone is warmer
function stonePrims(o, tall) {
  const v = o.v || 0, sd = v * 2 + (o.alt ? 1 : 0), r3 = (i) => hash3(sd, i, 41);
  const [h0, h1] = tall ? STONE.H.tall : STONE.H.short, H = h0 + (h1 - h0) * r3(1), R = tall ? STONE.R.tall : STONE.R.short;
  const pu = 0.5 + (r3(2) - 0.5) * 0.12, pv = 0.5 + (r3(3) - 0.5) * 0.12, ph = r3(4) * 6.3, ph2 = r3(5) * 6.3;
  const sa = r3(6) * 6.3, su = 0.5 + Math.cos(sa) * 0.22, sv = 0.5 + Math.sin(sa) * 0.22; // the shelf's middle
  const lobe = (u, w) => { const a = Math.atan2(w, u); return 0.84 + 0.11 * Math.sin(3 * a + ph) + 0.07 * Math.sin(5 * a + ph2); };
  const mound = (u, w, h, r) => { const d = Math.hypot(u, w) / (r * lobe(u, w)); return d >= 1 ? 0 : h * Math.min(1, STONE.FLAT * (1 - Math.pow(d, STONE.TAPER))) * (0.94 + 0.06 * (1 - d)); };
  const zAt = (u, w) => Math.max(mound(u - pu, w - pv, H, R), mound(u - su, w - sv, H * 0.55, R * 0.6));
  const K = STONE.GRID, z = [];
  for (let j = 0; j < K; j++) { z.push([]); for (let i = 0; i < K; i++) z[j].push(Math.round(zAt((i + 0.5) / K, (j + 0.5) / K))); }
  // A column's faces by their height above the ground (z0 + t), so the strata run level round the heap.
  const m = (z0) => (f, s, t, X, Y) => {
    const q = n2(X, Y, 23);
    if (f === "top") return q > 0.96 ? hex("#7f8a5e") : mul(STONEC, 1.04 + q * 0.08);
    if (n2(Math.floor(X / 3), Math.floor(Y / 2), 24) > 0.92) return mul(STONEC, 0.55);
    return mul(STONEC, (Math.floor((z0 + t + q * 1.5) / STONE.BAND) % 2 ? 0.84 : 0.94) + q * 0.05);
  };
  // Each column down to the lower of the next ones toward the camera (+u, +v), or the ground at the heap's edge.
  const out = [];
  for (let j = 0; j < K; j++) for (let i = 0; i < K; i++) {
    const zt = z[j][i];
    if (zt < 1) continue;
    const z0 = Math.min(zt, i + 1 < K ? z[j][i + 1] : 0, j + 1 < K ? z[j + 1][i] : 0);
    out.push({ u0: i / K, u1: (i + 1) / K, v0: j / K, v1: (j + 1) / K, z0, z1: zt, flat: true, m: m(z0) });
  }
  return out.sort((p, q) => p.u0 + p.v0 - q.u0 - q.v0);
}
// ---------- the furniture catalogue's pieces (sim/data-furniture.js FURNITURE_KINDS, issue #8 2026-10-25) ----------
// Boxes and cylinders in the style of the old pieces above: a fridge a tall white box with its door line and handles,
// a stove a box with four rings, a toilet a low bowl in front of its tank, a sofa a low seat with a back... Each kind:
// { top: its height in art px (blockTop0), p(o, v): its prims }. A wall-standing piece runs along the wall (along(o):
// lookOf turns it), a piece bigger than a cell joins with its neighbours of the same kind (JOINS) and is drawn as
// one run across them. Colours: FURNC.
const FURNC = {
  white: hex("#c9c7bd"), enamel: hex("#d8d5c8"), porc: hex("#dad8d0"), steel: hex("#8c9298"), chrome: hex("#b8bec4"),
  black: hex("#26272a"), ring: hex("#151515"), glassDk: hex("#2a3a44"), screen: hex("#1c2a30"), fabric: hex("#5a4a62"),
  fabricDk: hex("#463a4e"), leather: hex("#5a3424"), sheet: hex("#b4b2aa"), scrubs: hex("#4f7b88"), felt: hex("#3e6a4a"),
  red: hex("#8e3028"), beige: hex("#a89c84"), cream: hex("#d9cfa8"), gold: hex("#d9b23a"), cloth: hex("#e2ddcc"),
  led: hex("#5ad06a"), amber: hex("#e0a030"), water: hex("#5f8aa0"), bag: hex("#a8c4cc"),
};
const fbox = (u0, u1, v0, v1, z0, z1, m) => ({ u0, u1, v0, v1, z0, z1, m });
// A point across (c) and along (a) a piece's axis, as the view's u, v.
const fat = (ax, c, a) => (ax === "u" ? [a, c] : [c, a]);
const fcyl = (ax, c, a, r, z0, z1, m) => { const [u, w] = fat(ax, c, a); return { cyl: [u, w, r], z0, z1, m }; };
// Four thin legs at the corners of [a0, a1] × [b0, b1] (back ones first).
const flegs = (a0, a1, b0, b1, z1, m, w = 0.05) => [[a0, b0], [a1, b0], [a0, b1], [a1, b1]].map(([u, v]) => fbox(u, u + w, v, v + w, 0, z1, m));
// An appliance's enamel: lines across it at the heights in `lines` (a door's edge), chrome handles near one edge in
// the bands in `grips`, a light speckle.
const fappl = (base, lines = [], grips = []) => (f, s, t, X, Y) => {
  if (f === "top") return mul(base, 1.06);
  if (lines.some((z) => t >= z && t < z + 0.9)) return mul(base, 0.62);
  if (s >= 1.2 && s < 2.2 && grips.some(([a, b]) => t >= a && t < b)) return FURNC.chrome;
  return mul(base, 0.93 + n2(X, Y, 23) * 0.06);
};
// Drawers: wood (or steel) with a line every `h` px and a knob in the middle of each.
const fdrawers = (base, h, knob = PAL.woodDk) => (f, s, t, X, Y, sw) => {
  if (f === "top") return mul(base, 1.1);
  if (Math.floor(t) % h < 1) return mul(base, 0.6);
  if (Math.abs(s - (sw || 16) / 2) < 1 && Math.floor(t) % h === Math.floor(h / 2)) return knob;
  return mul(base, 0.92 + n2(X, Y, 24) * 0.08);
};
// A glass front with goods behind it (a cold case, a vending machine, a display case).
const fgoods = (X, Y, k) => CAR_COLORS[Math.floor(n2(X, Y, k) * 6)];
// A safe's face (the gun safe's look, squat): a dial, a handle, a frame round the door.
const fsafe = (hgt) => (f, s, t, X, Y, sw) => {
  if (f === "top") return mul(PAL.metalDk, 0.7);
  const w = sw || 9, cx = w * 0.42, d = Math.hypot(s - cx, (t - hgt * 0.6) * 1.1);
  if (d < 1.6) return FURNC.gold;
  if (d < 2.2) return mul(PAL.metal, 1.1);
  if (s > w * 0.7 && s < w * 0.82 && t > hgt * 0.4 && t < hgt * 0.7) return mul(PAL.metal, 1.2);
  if (t < 1 || t > hgt - 1 || s < 0.8 || s > w - 0.8) return mul(PAL.metalDk, 0.55);
  return mul(PAL.metalDk, 0.8 + n2(X, Y, 21) * 0.08);
};
const fwood = (base = PAL.wood, k = 25) => (f, s, t, X, Y) => (f === "top" ? mul(base, 1.12) : mul(base, 0.88 + n2(Math.floor(X / 3), Y, k) * 0.14));
const FURN_DRAW = {
  // ---------- kitchen and laundry ----------
  fridge: { top: 28, p: (o) => { const ax = along(o); return [run(ax, 0.24, 0.76, 0, 28, fappl(FURNC.white, [17], [[19, 25], [7, 14]]), 0.14, 0.86)]; } },
  freezer: { top: 12, p: (o) => { const ax = along(o); return [run(ax, 0.2, 0.8, 0, 12, fappl(FURNC.white, [9.5], [[10.5, 11.5]]), 0.04, 0.96)]; } },
  stove: { top: 14, p: (o) => {
    const ax = along(o), face = (f, s, t, X, Y, sw) => (f === "top" ? mul(FURNC.black, 1.2) : t >= 3 && t < 8 && s > 2 && s < (sw || 16) - 2 ? FURNC.glassDk : t >= 10 ? mul(FURNC.steel, 0.9) : mul(FURNC.white, 0.95 + n2(X, Y, 26) * 0.05));
    const out = [run(ax, 0.2, 0.8, 0, 12, face, 0.14, 0.86)];
    for (const [c, a] of [[0.35, 0.33], [0.35, 0.67], [0.65, 0.33], [0.65, 0.67]]) out.push(fcyl(ax, c, a, 0.09, 12, 13, (f) => (f === "top" ? FURNC.ring : mul(FURNC.ring, 1.4))));
    return out;
  } },
  oven: { top: 16, p: (o) => {
    const ax = along(o), face = (f, s, t, X, Y, sw) => (f === "top" ? FURNC.steel : t >= 3 && t < 11 && s > 2 && s < (sw || 16) - 2 ? (t >= 9.5 ? FURNC.chrome : FURNC.glassDk) : t >= 13 ? FURNC.black : mul(FURNC.steel, 0.92 + n2(X, Y, 27) * 0.08));
    return [run(ax, 0.22, 0.78, 0, 16, face, 0.14, 0.86)];
  } },
  microwave: { top: 14, p: (o) => {
    const ax = along(o), face = (f, s, t, X, Y, sw) => (f === "top" ? mul(FURNC.white, 1.05) : s > 1 && s < (sw || 10) * 0.65 && t > 9.5 && t < 13 ? FURNC.glassDk : mul(FURNC.white, 0.92));
    return [run(ax, 0.26, 0.74, 0, 8, fwood(PAL.wood), 0.12, 0.88), run(ax, 0.3, 0.7, 8, 14, face, 0.24, 0.76)];
  } },
  dishwasher: { top: 12, p: (o) => { const ax = along(o); return [run(ax, 0.22, 0.78, 0, 12, fappl(FURNC.white, [9.5, 1], [[10, 11]]), 0.12, 0.88)]; } },
  washer: { top: 13, p: (o) => {
    const ax = along(o), face = (f, s, t, X, Y, sw) => { if (f === "top") return mul(FURNC.white, 1.06); const d = Math.hypot(s - (sw || 12) / 2, t - 6); return d < 2.6 ? FURNC.glassDk : d < 3.6 ? FURNC.chrome : t > 11 ? mul(FURNC.white, 0.8) : mul(FURNC.white, 0.93 + n2(X, Y, 28) * 0.05); };
    return [run(ax, 0.22, 0.78, 0, 13, face, 0.14, 0.86)];
  } },
  dryer: { top: 13, p: (o) => {
    const ax = along(o), face = (f, s, t, X, Y, sw) => { if (f === "top") return mul(FURNC.enamel, 1.04); const d = Math.hypot(s - (sw || 12) / 2, t - 6); return d < 3 ? mul(FURNC.black, 1.4) : d < 3.7 ? FURNC.steel : t > 11 ? mul(FURNC.enamel, 0.78) : mul(FURNC.enamel, 0.93 + n2(X, Y, 29) * 0.05); };
    return [run(ax, 0.22, 0.78, 0, 13, face, 0.14, 0.86)];
  } },
  waterheater: { top: 27, p: () => [{ cyl: [0.5, 0.5, 0.3], z0: 0, z1: 24, m: (f, s, t) => (f === "top" ? FURNC.steel : t < 2 ? mul(FURNC.steel, 0.8) : mul(FURNC.enamel, 0.95)) }, { cyl: [0.5, 0.5, 0.06], z0: 24, z1: 27, m: flatM(PAL.rust) }] },
  boiler: { top: 26, p: (o) => {
    const ax = along(o), face = (f, s, t, X, Y, sw) => { if (f === "top") return mul(FURNC.steel, 0.9); if (Math.hypot(s - (sw || 16) * 0.3, t - 15) < 1.8) return FURNC.cream; return t % 6 < 0.8 ? mul(FURNC.steel, 0.65) : mul(FURNC.steel, 0.85 + n2(X, Y, 30) * 0.1); };
    return [run(ax, 0.2, 0.8, 0, 22, face, 0.14, 0.86), fcyl(ax, 0.4, 0.3, 0.06, 22, 26, flatM(PAL.rust)), fcyl(ax, 0.4, 0.7, 0.06, 22, 26, flatM(PAL.rust))];
  } },
  // ---------- bathroom ----------
  sink: { top: 13, p: (o) => {
    const ax = along(o), basin = (f, s, t, X, Y) => (f === "top" ? (n2(Math.floor(X / 5), Math.floor(Y / 3), 31) > 0.35 ? mul(FURNC.porc, 0.72) : FURNC.porc) : mul(FURNC.porc, 0.9));
    return [run(ax, 0.26, 0.74, 0, 10, fwood(PAL.woodLt), 0.14, 0.86), run(ax, 0.24, 0.76, 10, 11, basin, 0.12, 0.88), run(ax, 0.26, 0.32, 11, 13, flatM(FURNC.chrome), 0.46, 0.54)];
  } },
  toilet: { top: 12, p: (o) => {
    const ax = along(o), porc = (f) => (f === "top" ? FURNC.porc : mul(FURNC.porc, 0.9));
    return [run(ax, 0.22, 0.38, 4, 12, porc, 0.3, 0.7), fcyl(ax, 0.58, 0.5, 0.11, 0, 4, porc), fcyl(ax, 0.58, 0.5, 0.19, 4, 7, (f) => (f === "top" ? mul(FURNC.porc, 0.8) : FURNC.porc))];
  } },
  bathtub: { top: 9, p: (o) => {
    const ax = along(o), tub = (f, s, t, X, Y) => (f === "top" ? (n2(Math.floor(X / 6), Math.floor(Y / 3), 32) > 0.3 ? mul(FURNC.porc, 0.7) : FURNC.porc) : mul(FURNC.porc, 0.9 + n2(X, Y, 33) * 0.05));
    return [run(ax, 0.14, 0.86, 0, 9, tub, o.j & (ax === "u" ? 2 : 8) ? 0 : 0.06, o.j & (ax === "u" ? 1 : 4) ? 1 : 0.94)];
  } },
  shower: { top: 30, p: (o) => {
    const ax = along(o), glass = (f, s, t) => (t > 27 ? FURNC.chrome : mul(FURNC.water, 1.25));
    return [fbox(0.14, 0.86, 0.14, 0.86, 0, 2, flatM(FURNC.porc)), run(ax, 0.14, 0.2, 2, 30, flatM(mul(FURNC.porc, 0.85)), 0.14, 0.86), run(ax, 0.8, 0.86, 2, 30, glass, 0.14, 0.86), run(ax, 0.2, 0.3, 22, 24, flatM(FURNC.chrome), 0.46, 0.54)];
  } },
  // ---------- living rooms and bedrooms ----------
  sofa: { top: 13, p: (o) => {
    const ax = along(o), back = o.v & 2 ? [0.64, 0.8] : [0.2, 0.36], cushion = (f, s, t, X, Y) => (f === "top" ? (Math.floor(X) % 11 < 1 ? FURNC.fabricDk : mul(FURNC.fabric, 1.08)) : mul(FURNC.fabric, 0.9 + n2(X, Y, 34) * 0.08));
    const seat = run(ax, 0.2, 0.8, 0, 7, cushion, 0.02, 0.98), rest = run(ax, back[0], back[1], 7, 13, flatM(FURNC.fabricDk), 0.02, 0.98);
    return o.v & 2 ? [seat, rest] : [rest, seat];
  } },
  armchair: { top: 13, p: (o) => {
    const ax = along(o);
    return [run(ax, 0.22, 0.36, 0, 13, flatM(FURNC.leather), 0.22, 0.78), run(ax, 0.36, 0.78, 0, 7, (f) => (f === "top" ? mul(FURNC.leather, 1.15) : FURNC.leather), 0.22, 0.78), run(ax, 0.36, 0.78, 7, 10, flatM(mul(FURNC.leather, 0.85)), 0.22, 0.3), run(ax, 0.36, 0.78, 7, 10, flatM(mul(FURNC.leather, 0.85)), 0.7, 0.78)];
  } },
  chair: { top: 14, p: (o) => {
    const ax = along(o), w = flatM(PAL.woodDk);
    return [...flegs(0.32, 0.64, 0.32, 0.64, 6, w, 0.04), run(ax, 0.3, 0.7, 6, 7, flatM(PAL.woodLt), 0.3, 0.7), run(ax, 0.3, 0.35, 7, 14, fwood(PAL.wood), 0.3, 0.7)];
  } },
  desk: { top: 11, p: (o) => {
    const ax = along(o), w = flatM(PAL.woodDk);
    return [run(ax, 0.2, 0.26, 0, 9, w, 0.06, 0.12), run(ax, 0.74, 0.8, 0, 9, w, 0.06, 0.12), run(ax, 0.2, 0.8, 0, 9, fdrawers(PAL.wood, 3), 0.62, 0.94), run(ax, 0.16, 0.84, 9, 11, fwood(PAL.woodLt), 0.02, 0.98)];
  } },
  filing: { top: 18, p: (o) => { const ax = along(o); return [run(ax, 0.28, 0.72, 0, 18, fdrawers(FURNC.steel, 4.5, FURNC.chrome), 0.22, 0.78)]; } },
  bookshelf: { top: 26, p: (o) => {
    const ax = along(o), books = (f, s, t, X, Y) => (f === "top" ? PAL.woodDk : Math.floor(t) % 6 < 1 || s < 0.8 ? PAL.woodDk : n2(Math.floor(X), Math.floor(t / 6), 35) > 0.2 ? mul(fgoods(Math.floor(X), Math.floor(t / 6), 36), 1.1) : mul(PAL.wood, 0.5));
    return [run(ax, 0.3, 0.7, 0, 26, books, 0.08, 0.92)];
  } },
  wardrobe: { top: 28, p: (o) => {
    const ax = along(o), face = (f, s, t, X, Y, sw) => { if (f === "top") return mul(PAL.wood, 1.1); const m = (sw || 16) / 2; if (Math.abs(s - m) < 0.6 || t < 1.5 || t > 26) return PAL.woodDk; if (Math.abs(s - m) < 2 && t > 13 && t < 15) return FURNC.gold; return mul(PAL.wood, 0.9 + n2(Math.floor(X / 3), Y, 37) * 0.1); };
    return [run(ax, 0.24, 0.76, 0, 28, face, 0.1, 0.9)];
  } },
  dresser: { top: 13, p: (o) => { const ax = along(o); return [run(ax, 0.26, 0.74, 0, 13, fdrawers(PAL.woodLt, 4), 0.12, 0.88)]; } },
  nightstand: { top: 12, p: () => [fbox(0.3, 0.7, 0.3, 0.7, 0, 9, fdrawers(PAL.wood, 4.5)), { cyl: [0.5, 0.5, 0.04], z0: 9, z1: 10, m: flatM(FURNC.gold) }, { cyl: [0.5, 0.5, 0.1], z0: 10, z1: 12, m: flatM(FURNC.cream) }] },
  tvstand: { top: 18, p: (o) => {
    const ax = along(o), tv = (f, s, t, X, Y, sw) => (f === "top" ? FURNC.black : s < 0.8 || s > (sw || 16) - 0.8 || t < 0.8 || t > 10.2 ? FURNC.black : mul(FURNC.screen, 0.9 + n2(X, Y, 38) * 0.15));
    return [run(ax, 0.3, 0.7, 0, 7, fdrawers(PAL.woodDk, 7, FURNC.chrome), 0.1, 0.9), run(ax, 0.46, 0.52, 7, 18, tv, 0.14, 0.86)];
  } },
  piano: { top: 20, p: (o) => {
    const ax = along(o), gloss = (f, s, t, X, Y) => (f === "top" ? mul(FURNC.black, 1.5) : mul(FURNC.black, 1 + n2(X, Y, 39) * 0.25));
    const keys = (f, s, t, X) => (f === "top" ? (Math.floor(X) % 3 === 0 ? FURNC.black : FURNC.cloth) : FURNC.black);
    return [run(ax, 0.2, 0.56, 0, 20, gloss, 0.02, 0.98), run(ax, 0.56, 0.78, 9, 11, keys, 0.04, 0.96), run(ax, 0.56, 0.78, 0, 9, flatM(FURNC.black), 0.04, 0.1), run(ax, 0.56, 0.78, 0, 9, flatM(FURNC.black), 0.9, 0.96)];
  } },
  // ---------- churches ----------
  pew: { top: 12, p: (o) => {
    const ax = along(o), w = fwood(PAL.wood, 40);
    return [run(ax, 0.24, 0.32, 4, 12, w, 0.02, 0.98), run(ax, 0.32, 0.72, 4, 6, w, 0.02, 0.98), run(ax, 0.24, 0.72, 0, 4, flatM(PAL.woodDk), 0.1, 0.16), run(ax, 0.24, 0.72, 0, 4, flatM(PAL.woodDk), 0.84, 0.9)];
  } },
  altar: { top: 15, p: (o) => {
    const ax = along(o), cloth = (f, s, t) => (f === "top" ? FURNC.cloth : t > 9 ? (t < 10 ? FURNC.gold : FURNC.cloth) : mul(PAL.stone, 1.1));
    return [run(ax, 0.22, 0.78, 0, 12, cloth, 0.04, 0.96), fcyl(ax, 0.4, 0.3, 0.04, 12, 15, flatM(FURNC.cream)), fcyl(ax, 0.4, 0.7, 0.04, 12, 15, flatM(FURNC.cream))];
  } },
  pulpit: { top: 20, p: (o) => {
    const ax = along(o), panel = (f, s, t, X, Y, sw) => (f === "top" ? PAL.woodLt : s < 1.5 || s > (sw || 8) - 1.5 || t < 2 || t > 16 ? PAL.woodDk : mul(PAL.wood, 0.95 + n2(X, Y, 41) * 0.08));
    return [run(ax, 0.28, 0.72, 0, 18, panel, 0.26, 0.74), run(ax, 0.24, 0.6, 18, 20, flatM(PAL.woodLt), 0.24, 0.76)];
  } },
  // ---------- hospitals, clinics and vets ----------
  hospbed: { top: 11, p: (o) => {
    const ax = along(o), s0 = flatM(FURNC.steel);
    return [run(ax, 0.16, 0.84, 0, 2, s0, 0.06, 0.94), run(ax, 0.2, 0.8, 2, 5, flatM(mul(FURNC.steel, 0.8)), 0.1, 0.9), run(ax, 0.18, 0.82, 5, 8, (f, s, t, X, Y) => (f === "top" ? mul(FURNC.sheet, 1.08 + n2(X, Y, 42) * 0.06) : FURNC.sheet), 0.04, 0.96), run(ax, 0.14, 0.18, 6, 11, s0, 0.2, 0.8), run(ax, 0.82, 0.86, 6, 11, s0, 0.2, 0.8)];
  } },
  gurney: { top: 10, p: (o) => {
    const ax = along(o), s0 = flatM(FURNC.chrome), [a0, b0] = ax === "u" ? [0.2, 0.3] : [0.3, 0.2];
    return [...flegs(a0, ax === "u" ? 0.75 : 0.65, b0, ax === "u" ? 0.65 : 0.75, 7, s0, 0.04), run(ax, 0.3, 0.7, 7, 8, flatM(FURNC.steel), 0.04, 0.96), run(ax, 0.32, 0.68, 8, 10, flatM(FURNC.scrubs), 0.06, 0.94)];
  } },
  ivstand: { top: 25, p: () => [{ cyl: [0.5, 0.5, 0.13], z0: 0, z1: 1, m: flatM(FURNC.steel) }, fbox(0.48, 0.52, 0.48, 0.52, 1, 25, flatM(FURNC.chrome)), fbox(0.53, 0.62, 0.46, 0.54, 17, 23, flatM(FURNC.bag))] },
  medcab: { top: 20, p: (o) => {
    const ax = along(o), face = (f, s, t, X, Y, sw) => { if (f === "top") return FURNC.white; const w = sw || 8, m = w / 2; if (t > 15 && t < 19 && ((Math.abs(s - m) < 0.8 && t > 15.2) || (Math.abs(t - 17) < 0.7 && Math.abs(s - m) < 2))) return FURNC.red; if (t > 2 && t < 14 && s > 1 && s < w - 1) return Math.abs(s - m) < 0.5 ? mul(FURNC.white, 0.7) : mul(FURNC.water, 1.2); return mul(FURNC.white, 0.94); };
    return [run(ax, 0.3, 0.7, 0, 20, face, 0.2, 0.8)];
  } },
  optable: { top: 11, p: (o) => {
    const ax = along(o);
    return [run(ax, 0.38, 0.62, 0, 8, flatM(FURNC.steel), 0.3, 0.7), run(ax, 0.24, 0.76, 8, 10, flatM(FURNC.chrome), 0.04, 0.96), run(ax, 0.26, 0.74, 10, 11, flatM(FURNC.felt), 0.06, 0.94)];
  } },
  medcart: { top: 14, p: (o) => {
    const ax = along(o), s0 = flatM(FURNC.chrome);
    return [...flegs(0.26, 0.7, 0.26, 0.7, 2, s0), run(ax, 0.26, 0.74, 2, 14, fdrawers(FURNC.water, 3, FURNC.chrome), 0.24, 0.76)];
  } },
  // The rooms room by room (sim/roomlayout.js MEDICAL_STYLES, issue #14): a curtain on its rail, the drug safe, the
  // instrument cabinet's glass front, the morgue's steel drawers, the autopsy table, a wheelchair, a linen cart, a
  // monitor on its stand, an infant cot, an exam bed, a vet's steel table.
  curtain: { top: 22, p: (o) => {
    const ax = along(o), folds = (f, s, t, X) => (f === "top" ? FURNC.chrome : mul(FURNC.scrubs, 1.1 + (Math.floor(X) % 3 === 0 ? -0.15 : 0.05)));
    return [run(ax, 0.47, 0.53, 21, 22, flatM(FURNC.chrome), 0, 1), run(ax, 0.46, 0.54, 2, 21, folds, 0.02, 0.98)];
  } },
  drugsafe: { top: 18, p: (o) => {
    const ax = along(o), face = (f, s, t, X, Y, sw) => (f === "top" ? mul(FURNC.steel, 1.1) : Math.abs(s - (sw || 8) / 2) < 1.2 && Math.abs(t - 10) < 1.2 ? FURNC.chrome : t < 1 || t > 17 ? mul(FURNC.steel, 0.7) : mul(FURNC.steel, 0.95 + n2(X, Y, 49) * 0.05));
    return [run(ax, 0.24, 0.76, 0, 18, face, 0.16, 0.84)];
  } },
  instcab: { top: 26, p: (o) => {
    const ax = along(o), face = (f, s, t, X, Y, sw) => { if (f === "top") return FURNC.white; const w = sw || 8; if (t > 2 && t < 25 && s > 1 && s < w - 1) return Math.floor(t) % 6 < 1 ? FURNC.chrome : n2(Math.floor(X), Math.floor(t / 6), 50) > 0.6 ? FURNC.chrome : mul(FURNC.water, 1.25); return mul(FURNC.white, 0.94); };
    return [run(ax, 0.3, 0.7, 0, 26, face, 0.12, 0.88)];
  } },
  morguelocker: { top: 26, p: (o) => {
    const ax = along(o), face = (f, s, t, X, Y, sw) => { if (f === "top") return FURNC.chrome; if (Math.floor(t) % 9 < 1) return mul(FURNC.steel, 0.6); if (Math.abs(s - (sw || 8) / 2) < 1.5 && Math.floor(t) % 9 === 5) return FURNC.chrome; return mul(FURNC.steel, 1.05 + n2(X, Y, 51) * 0.05); };
    return [run(ax, 0.2, 0.8, 0, 26, face, 0.02, 0.98)];
  } },
  autopsy: { top: 10, p: (o) => {
    const ax = along(o);
    return [run(ax, 0.42, 0.58, 0, 8, flatM(FURNC.steel), 0.3, 0.7), run(ax, 0.22, 0.78, 8, 10, (f) => (f === "top" ? mul(FURNC.chrome, 1.1) : FURNC.chrome), 0.04, 0.96)];
  } },
  wheelchair: { top: 12, p: (o) => {
    const ax = along(o), s0 = flatM(FURNC.chrome);
    return [fcyl(ax, 0.22, 0.5, 0.2, 0, 1, s0), fcyl(ax, 0.78, 0.5, 0.2, 0, 1, s0), fbox(0.25, 0.75, 0.25, 0.75, 5, 7, flatM(FURNC.black)), run(ax, 0.28, 0.72, 7, 12, flatM(FURNC.black), 0.22, 0.3)];
  } },
  linencart: { top: 13, p: (o) => {
    const ax = along(o), s0 = flatM(FURNC.chrome);
    return [...flegs(0.25, 0.72, 0.25, 0.72, 3, s0), fbox(0.24, 0.76, 0.24, 0.76, 3, 13, (f, s, t, X, Y) => (f === "top" ? mul(FURNC.cloth, 1.05 + n2(X, Y, 52) * 0.05) : FURNC.scrubs))];
  } },
  monitor: { top: 22, p: () => [{ cyl: [0.5, 0.5, 0.14], z0: 0, z1: 1, m: flatM(FURNC.steel) }, fbox(0.48, 0.52, 0.48, 0.52, 1, 15, flatM(FURNC.chrome)), fbox(0.34, 0.66, 0.42, 0.58, 15, 22, (f, s, t) => (f === "top" ? FURNC.black : t > 16 && t < 21 && s > 1 ? (Math.abs(t - 18.5 - Math.sin(s * 1.7)) < 0.6 ? FURNC.led : FURNC.screen) : FURNC.black))] },
  crib: { top: 10, p: (o) => {
    const ax = along(o), bars = (f, s, t, X) => (f === "top" ? PAL.woodLt : Math.floor(X) % 2 ? PAL.wood : mul(PAL.woodLt, 1.1));
    return [...flegs(0.2, 0.76, 0.2, 0.76, 4, flatM(PAL.wood)), fbox(0.2, 0.8, 0.2, 0.8, 4, 5, flatM(FURNC.cloth)), run(ax, 0.2, 0.8, 5, 10, bars, 0.18, 0.82)];
  } },
  exambed: { top: 9, p: (o) => {
    const ax = along(o);
    return [run(ax, 0.24, 0.76, 0, 6, flatM(FURNC.beige), 0.08, 0.92), run(ax, 0.22, 0.78, 6, 8, flatM(FURNC.scrubs), 0.04, 0.96), run(ax, 0.24, 0.76, 8, 9, flatM(FURNC.cloth), 0.06, 0.94)];
  } },
  vettable: { top: 10, p: (o) => {
    const ax = along(o);
    return [run(ax, 0.42, 0.58, 0, 8, flatM(FURNC.steel), 0.4, 0.6), run(ax, 0.2, 0.8, 8, 10, (f) => (f === "top" ? mul(FURNC.chrome, 1.12) : FURNC.chrome), 0.12, 0.88)];
  } },
  // ---------- shops, restaurants and bars ----------
  vending: { top: 30, p: (o) => {
    const ax = along(o), face = (f, s, t, X, Y, sw) => { if (f === "top") return mul(FURNC.red, 0.8); const w = sw || 16; if (s > 1.2 && s < w * 0.64 && t > 7 && t < 27) return Math.floor(t) % 5 < 1 ? FURNC.black : mul(fgoods(Math.floor(X / 2), Math.floor(t / 5), 43), 1.15); if (s > w * 0.72 && s < w * 0.86 && t > 17 && t < 21) return FURNC.chrome; return mul(FURNC.red, 0.95 + n2(X, Y, 44) * 0.08); };
    return [run(ax, 0.24, 0.76, 0, 30, face, 0.12, 0.88)];
  } },
  checkout: { top: 15, p: (o) => {
    const ax = along(o), reg = (f, s, t, X, Y, sw) => (f === "top" ? FURNC.black : t > 3 && s > 1 && s < (sw || 8) - 1 ? mul(FURNC.led, 0.6) : FURNC.black);
    return [run(ax, 0.24, 0.76, 0, 10, (f) => (f === "top" ? mul(FURNC.black, 1.6) : FURNC.beige), 0.04, 0.96), run(ax, 0.34, 0.6, 10, 15, reg, 0.3, 0.62)];
  } },
  displaycase: { top: 14, p: (o) => {
    const ax = along(o), glass = (f, s, t, X, Y) => (f === "top" ? mul(FURNC.water, 1.35) : t < 1 || t > 7 ? FURNC.chrome : n2(Math.floor(X / 2), Y, 45) > 0.7 ? fgoods(Math.floor(X / 2), Y, 46) : mul(FURNC.water, 1.2));
    return [run(ax, 0.26, 0.74, 0, 6, fwood(PAL.woodDk), 0.06, 0.94), run(ax, 0.26, 0.74, 6, 14, glass, 0.06, 0.94)];
  } },
  coldcase: { top: 28, p: (o) => {
    const ax = along(o), face = (f, s, t, X, Y, sw) => { if (f === "top") return FURNC.white; if (t < 3 || t > 26 || s < 1 || s > (sw || 16) - 1) return FURNC.white; if (Math.floor(t) % 6 < 1) return FURNC.chrome; return n2(Math.floor(X), Math.floor(t / 6), 47) > 0.25 ? mul(fgoods(Math.floor(X), Math.floor(t / 6), 48), 1.2) : mul(FURNC.water, 1.3); };
    return [run(ax, 0.24, 0.76, 0, 28, face, 0.04, 0.96)];
  } },
  booth: { top: 15, p: (o) => {
    const ax = along(o), red = (f) => (f === "top" ? mul(FURNC.red, 1.15) : FURNC.red);
    return [run(ax, 0.1, 0.18, 0, 15, red, 0.02, 0.98), run(ax, 0.18, 0.42, 0, 6, red, 0.02, 0.98), run(ax, 0.62, 0.68, 0, 8, flatM(FURNC.chrome), 0.46, 0.54), run(ax, 0.46, 0.9, 8, 9, flatM(FURNC.cream), 0.08, 0.92)];
  } },
  barcounter: { top: 14, p: (o) => {
    const ax = along(o), panel = (f, s, t, X) => (Math.floor(X) % 8 < 1 ? mul(PAL.woodDk, 0.7) : t < 1.5 ? FURNC.gold : mul(PAL.woodDk, 1.05));
    return [run(ax, 0.22, 0.78, 0, 13, panel, 0, 1), run(ax, 0.18, 0.82, 13, 14, (f, s, t, X, Y) => mul(PAL.woodLt, 1.05 + n2(X, Y, 49) * 0.1), 0, 1)];
  } },
  barstool: { top: 11, p: () => [{ cyl: [0.5, 0.5, 0.12], z0: 0, z1: 1, m: flatM(FURNC.chrome) }, fbox(0.47, 0.53, 0.47, 0.53, 1, 9, flatM(FURNC.chrome)), { cyl: [0.5, 0.5, 0.16], z0: 9, z1: 11, m: (f) => (f === "top" ? mul(FURNC.red, 1.15) : FURNC.red) }] },
  // ---------- shops, restaurants, bars, offices, motels, banks and big stores (issue #16, sim/shoplayout.js) ----------
  range: { top: 15, p: (o) => {
    const ax = along(o), face = (f, s, t, X, Y, sw) => (f === "top" ? mul(FURNC.black, 1.2) : t >= 2 && t < 8 && s > 2 && s < (sw || 16) - 2 ? FURNC.glassDk : t >= 9 && t < 10 ? FURNC.black : mul(FURNC.steel, 0.95 + n2(X, Y, 90) * 0.06));
    const out = [run(ax, 0.18, 0.82, 0, 13, face, 0.06, 0.94)];
    for (const c of [0.34, 0.66]) for (const a of [0.22, 0.5, 0.78]) out.push(fcyl(ax, c, a, 0.08, 13, 14, (f) => (f === "top" ? FURNC.ring : mul(FURNC.ring, 1.4))));
    return out;
  } },
  fryer: { top: 14, p: (o) => {
    const ax = along(o), oil = (f, s, t, X, Y) => (f === "top" ? mul(FURNC.amber, 0.7 + n2(X, Y, 91) * 0.15) : FURNC.steel);
    return [run(ax, 0.22, 0.78, 0, 12, fappl(FURNC.steel, [8], [[9, 10]]), 0.14, 0.86), run(ax, 0.3, 0.7, 12, 13, oil, 0.22, 0.48), run(ax, 0.3, 0.7, 12, 13, oil, 0.52, 0.78), run(ax, 0.2, 0.28, 13, 14, flatM(FURNC.chrome), 0.3, 0.7)];
  } },
  pizzaoven: { top: 22, p: (o) => {
    const ax = along(o), brick = (f, s, t, X, Y) => (f === "top" ? mul(PAL.brick, 0.8) : t > 6 && t < 12 && s > 4 && s < 12 ? mul(FURNC.black, 1.3 + n2(X, Y, 92) * 0.3) : t % 4 < 1 ? PAL.mortar : mul(PAL.brick, 0.9 + n2(Math.floor(X / 4), Math.floor(t / 4), 93) * 0.2));
    return [run(ax, 0.16, 0.84, 0, 18, brick, 0.04, 0.96), run(ax, 0.3, 0.7, 18, 22, flatM(mul(PAL.brick, 0.75)), 0.4, 0.6)];
  } },
  coldshelf: { top: 24, p: (o) => {
    const ax = along(o), face = (f, s, t, X, Y) => (f === "top" ? FURNC.chrome : Math.floor(t) % 6 < 1 ? FURNC.chrome : n2(Math.floor(X / 2), Math.floor(t / 6), 94) > 0.45 ? mul(fgoods(Math.floor(X / 2), Math.floor(t / 6), 95), 1.05) : mul(FURNC.steel, 0.6));
    return [run(ax, 0.26, 0.74, 0, 24, face, 0.06, 0.94)];
  } },
  jukebox: { top: 22, p: (o) => {
    const ax = along(o), face = (f, s, t, X, Y, sw) => { if (f === "top") return mul(FURNC.red, 1.1); const w = sw || 12; if (t > 14 && Math.abs(s - w / 2) < w * 0.32) return mul(FURNC.amber, 1 + n2(X, Y, 96) * 0.3); if (t > 6 && t < 12 && s > 2 && s < w - 2) return FURNC.glassDk; return mul(FURNC.red, 0.9); };
    return [run(ax, 0.28, 0.72, 0, 22, face, 0.2, 0.8)];
  } },
  pooltable: { top: 11, p: (o) => {
    const ax = along(o), felt = (f, s, t, X, Y) => (f === "top" ? mul(FURNC.felt, 1.05 + n2(X, Y, 97) * 0.06) : PAL.woodDk);
    return [run(ax, 0.3, 0.7, 0, 8, fwood(PAL.woodDk), 0.2, 0.8), run(ax, 0.12, 0.88, 8, 10, flatM(PAL.woodDk), 0.02, 0.98), run(ax, 0.16, 0.84, 10, 11, felt, 0.06, 0.94)];
  } },
  clothesrack: { top: 20, p: (o, v) => {
    const ax = along(o), clothes = (f, s, t, X) => mul(fgoods(Math.floor(X / 2), v, 98), 1.1);
    return [run(ax, 0.48, 0.52, 0, 20, flatM(FURNC.chrome), 0.1, 0.14), run(ax, 0.48, 0.52, 0, 20, flatM(FURNC.chrome), 0.86, 0.9), run(ax, 0.48, 0.52, 19, 20, flatM(FURNC.chrome), 0.1, 0.9), run(ax, 0.34, 0.66, 7, 19, clothes, 0.16, 0.84)];
  } },
  tank: { top: 18, p: (o) => {
    const ax = along(o), glass = (f, s, t, X, Y) => (f === "top" ? FURNC.black : t > 16 ? FURNC.black : n2(Math.floor(X / 2), Math.floor(t / 3), 99) > 0.85 ? FURNC.amber : t < 3 ? mul(FURNC.sheet, 0.8) : mul(FURNC.water, 1.1 + n2(X, Y, 100) * 0.1));
    return [run(ax, 0.26, 0.74, 0, 8, fwood(PAL.woodDk), 0.1, 0.9), run(ax, 0.28, 0.72, 8, 18, glass, 0.12, 0.88)];
  } },
  pottingbench: { top: 16, p: (o) => {
    const ax = along(o), w = flatM(PAL.woodDk), pots = (f) => (f === "top" ? mul(FLOORC.dirt, 0.8) : mul(PAL.rust, 1.1));
    return [run(ax, 0.24, 0.3, 0, 10, w, 0.04, 0.1), run(ax, 0.7, 0.76, 0, 10, w, 0.04, 0.1), run(ax, 0.24, 0.3, 0, 10, w, 0.9, 0.96), run(ax, 0.7, 0.76, 0, 10, w, 0.9, 0.96), run(ax, 0.2, 0.8, 10, 12, fwood(PAL.woodLt), 0.02, 0.98), fcyl(ax, 0.5, 0.25, 0.1, 12, 16, pots), fcyl(ax, 0.5, 0.7, 0.12, 12, 15, pots)];
  } },
  palletrack: { top: 30, p: (o) => {
    const ax = along(o), steel = flatM(hex("#c8742a")), load = (f, s, t, X, Y) => mul(n2(Math.floor(X / 4), Math.floor(t / 10), 101) > 0.5 ? FURNC.beige : PAL.woodLt, 0.9 + n2(X, Y, 102) * 0.1);
    return [run(ax, 0.14, 0.86, 0, 30, flatM(FURNC.steel), 0.02, 0.06), run(ax, 0.14, 0.86, 0, 30, flatM(FURNC.steel), 0.94, 0.98), run(ax, 0.14, 0.86, 9, 10, steel, 0, 1), run(ax, 0.14, 0.86, 19, 20, steel, 0, 1), run(ax, 0.2, 0.8, 0, 8, load, 0.08, 0.92), run(ax, 0.2, 0.8, 10, 18, load, 0.08, 0.92), run(ax, 0.2, 0.8, 20, 28, load, 0.08, 0.92)];
  } },
  tirerack: { top: 20, p: (o) => {
    const ax = along(o), out = [run(ax, 0.22, 0.26, 0, 20, flatM(FURNC.steel), 0.06, 0.94)];
    for (const z of [2, 11]) for (const a of [0.28, 0.72]) out.push(fcyl(ax, 0.5, a, 0.2, z, z + 7, (f) => (f === "top" ? mul(PAL.tire, 1.6) : PAL.tire)));
    return out;
  } },
  carlift: { top: 22, p: (o) => {
    const ax = along(o), post = flatM(hex("#c8402f"));
    return [run(ax, 0.36, 0.64, 0, 22, post, 0.36, 0.64), run(ax, 0.3, 0.7, 0, 1, flatM(FURNC.steel), 0.3, 0.7), run(ax, 0.6, 0.98, 6, 7, flatM(FURNC.steel), 0.44, 0.56)];
  } },
  machine: { top: 20, p: (o) => {
    const ax = along(o), body = (f, s, t, X, Y) => (f === "top" ? mul(FURNC.felt, 0.8) : t < 2 ? FURNC.black : mul(FURNC.felt, 0.7 + n2(X, Y, 103) * 0.1));
    return [run(ax, 0.2, 0.8, 0, 12, body, 0.04, 0.96), run(ax, 0.3, 0.6, 12, 20, body, 0.1, 0.4), fcyl(ax, 0.5, 0.75, 0.1, 12, 15, flatM(FURNC.chrome))];
  } },
  forklift: { top: 26, p: (o) => {
    const ax = along(o), yel = (f) => (f === "top" ? mul(FURNC.gold, 1.05) : FURNC.gold);
    return [run(ax, 0.2, 0.8, 1, 10, yel, 0.3, 0.98), run(ax, 0.22, 0.26, 10, 26, flatM(FURNC.black), 0.32, 0.98), run(ax, 0.74, 0.78, 10, 26, flatM(FURNC.black), 0.32, 0.98), run(ax, 0.22, 0.78, 25, 26, flatM(FURNC.black), 0.32, 0.98), run(ax, 0.3, 0.7, 0, 18, flatM(FURNC.steel), 0.04, 0.08), run(ax, 0.32, 0.4, 0, 1, flatM(FURNC.steel), 0.04, 0.3), run(ax, 0.6, 0.68, 0, 1, flatM(FURNC.steel), 0.04, 0.3)];
  } },
  saddlerack: { top: 18, p: (o) => {
    const ax = along(o), saddle = (f, s, t, X, Y) => mul(FURNC.leather, (f === "top" ? 1.2 : 1) + n2(X, Y, 104) * 0.1);
    return [run(ax, 0.2, 0.28, 0, 18, fwood(PAL.woodDk), 0.2, 0.8), run(ax, 0.28, 0.7, 10, 16, saddle, 0.24, 0.76), run(ax, 0.34, 0.62, 4, 10, flatM(mul(FURNC.leather, 0.8)), 0.3, 0.7)];
  } },
  cubicle: { top: 16, p: (o) => {
    const ax = along(o), panel = (f, s, t, X, Y) => (f === "top" ? FURNC.steel : t > 15 ? FURNC.steel : mul(hex("#6a7480"), 0.9 + n2(Math.floor(X / 2), Math.floor(t / 2), 105) * 0.1));
    return [run(ax, 0.45, 0.55, 0, 16, panel, 0, 1)];
  } },
  whiteboard: { top: 22, p: (o) => {
    const ax = along(o), face = (f, s, t, X, Y, sw) => (f === "top" || s < 0.8 || s > (sw || 12) - 0.8 || t < 8.8 || t > 21 ? FURNC.chrome : n2(Math.floor(X / 3), Math.floor(t), 106) > 0.9 ? hex("#2f5d8a") : mul(FURNC.white, 1.1));
    return [run(ax, 0.42, 0.5, 8, 22, face, 0.08, 0.92), run(ax, 0.42, 0.5, 0, 8, flatM(FURNC.chrome), 0.1, 0.14), run(ax, 0.42, 0.5, 0, 8, flatM(FURNC.chrome), 0.86, 0.9)];
  } },
  watercooler: { top: 22, p: () => [fbox(0.32, 0.68, 0.32, 0.68, 0, 13, fappl(FURNC.white, [], [[9, 11]])), { cyl: [0.5, 0.5, 0.15], z0: 13, z1: 22, m: (f, s, t, X, Y) => mul(FURNC.water, (f === "top" ? 1.3 : 1.15) + n2(X, Y, 107) * 0.1) }] },
  secdesk: { top: 16, p: (o) => {
    const ax = along(o), mon = (f, s, t, X, Y) => (f === "top" ? FURNC.black : t > 12 && n2(Math.floor(X / 4), 0, 108) > 0.3 ? mul(FURNC.screen, 1.4 + n2(X, Y, 109) * 0.3) : FURNC.black);
    return [run(ax, 0.18, 0.82, 0, 10, fdrawers(FURNC.beige, 5, FURNC.black), 0.02, 0.98), run(ax, 0.16, 0.84, 10, 11, flatM(mul(FURNC.beige, 1.1)), 0, 1), run(ax, 0.22, 0.34, 11, 16, mon, 0.08, 0.92)];
  } },
  keyrack: { top: 16, p: (o) => {
    const ax = along(o), face = (f, s, t, X) => (f === "top" ? PAL.woodDk : t < 10 && Math.floor(X) % 2 ? FURNC.gold : PAL.wood);
    return [run(ax, 0.44, 0.52, 6, 16, face, 0.2, 0.8)];
  } },
  icemachine: { top: 24, p: (o) => { const ax = along(o); return [run(ax, 0.22, 0.78, 0, 24, fappl(FURNC.steel, [14], [[15, 18]]), 0.1, 0.9)]; } },
  teller: { top: 26, p: (o) => {
    const ax = along(o), glass = (f, s, t) => (f === "top" ? FURNC.chrome : t > 24.5 ? FURNC.chrome : mul(FURNC.water, 1.3));
    return [run(ax, 0.3, 0.7, 0, 12, fwood(PAL.woodDk), 0, 1), run(ax, 0.26, 0.74, 12, 13, flatM(FURNC.cream), 0, 1), run(ax, 0.46, 0.52, 13, 26, glass, 0, 1)];
  } },
  deposit: { top: 28, p: (o) => {
    const ax = along(o), face = (f, s, t, X) => (f === "top" ? FURNC.steel : Math.floor(t) % 4 < 1 || Math.floor(X) % 4 < 1 ? mul(FURNC.steel, 0.6) : Math.floor(X) % 4 === 2 && Math.floor(t) % 4 === 2 ? FURNC.gold : mul(FURNC.chrome, 0.9));
    return [run(ax, 0.26, 0.74, 0, 28, face, 0.04, 0.96)];
  } },
  atm: { top: 24, p: (o) => {
    const ax = along(o), face = (f, s, t, X, Y, sw) => { if (f === "top") return FURNC.steel; const w = sw || 12; if (t > 14 && t < 20 && s > 2 && s < w - 2) return mul(FURNC.screen, 1.5); if (t > 9 && t < 12 && s > 3 && s < w - 3) return FURNC.black; return mul(hex("#2f5d8a"), 0.9 + n2(X, Y, 110) * 0.1); };
    return [run(ax, 0.24, 0.76, 0, 24, face, 0.16, 0.84)];
  } },
  stanchion: { top: 16, p: () => [{ cyl: [0.5, 0.5, 0.14], z0: 0, z1: 1, m: flatM(FURNC.chrome) }, { cyl: [0.5, 0.5, 0.04], z0: 1, z1: 15, m: flatM(FURNC.chrome) }, { cyl: [0.5, 0.5, 0.07], z0: 15, z1: 16, m: flatM(FURNC.gold) }, fbox(0.5, 1, 0.47, 0.53, 12, 13, flatM(FURNC.red))] },
  // ---------- hotels (issue #29, sim/hotellayout.js) ----------
  // The reception desk: a long panelled wood front with a pale marble top, a monitor on it; a suitcase standing on its
  // end with its handle up; a minibar: a little brown fridge with a glass door; the luggage cart: a brass frame on a
  // carpeted deck, a bag on it; a round banquet table in its white cloth; lift doors: brushed steel doors in a frame with
  // the call button and the floor light; a lounge chair; a white pool lounger; a tennis net on its two posts.
  frontdesk: { top: 16, p: (o) => {
    const ax = along(o), panel = (f, s, t, X, Y) => (f === "top" ? PAL.woodDk : Math.floor(X) % 6 < 1 ? mul(PAL.woodDk, 0.8) : mul(PAL.wood, 0.9 + n2(Math.floor(X / 3), Y, 140) * 0.1));
    return [run(ax, 0.24, 0.76, 0, 11, panel, 0.02, 0.98), run(ax, 0.2, 0.8, 11, 12.5, (f) => (f === "top" ? mul(FURNC.cream, 1.15) : FURNC.cream), 0, 1), run(ax, 0.42, 0.58, 12.5, 16, (f, s, t) => (f === "top" ? FURNC.black : t > 13.5 ? FURNC.screen : FURNC.black), 0.36, 0.56)];
  } },
  suitcase: { top: 14, p: (o) => {
    const ax = along(o), shell = (f, s, t, X, Y) => (f === "top" ? mul(FURNC.fabricDk, 1.2) : Math.floor(t) % 4 < 1 ? mul(FURNC.fabricDk, 0.7) : mul(FURNC.fabricDk, 1 + n2(X, Y, 141) * 0.08));
    return [run(ax, 0.38, 0.62, 0.5, 11, shell, 0.24, 0.76), run(ax, 0.48, 0.52, 11, 14, flatM(FURNC.chrome), 0.36, 0.4), run(ax, 0.48, 0.52, 11, 14, flatM(FURNC.chrome), 0.6, 0.64), run(ax, 0.48, 0.52, 13.5, 14, flatM(FURNC.black), 0.36, 0.64)];
  } },
  minifridge: { top: 12, p: (o) => {
    const ax = along(o), face = (f, s, t, X, Y, sw) => (f === "top" ? mul(PAL.woodDk, 1.1) : s > 1.2 && s < (sw || 10) - 1.2 && t > 1.5 && t < 10.5 ? (Math.floor(t) % 3 < 1 ? FURNC.chrome : mul(fgoods(Math.floor(X / 2), Math.floor(t / 3), 142), 0.9)) : mul(PAL.woodDk, 0.95));
    return [run(ax, 0.3, 0.7, 0, 12, face, 0.22, 0.78)];
  } },
  luggagecart: { top: 26, p: (o) => {
    const ax = along(o), brass = flatM(FURNC.gold);
    return [run(ax, 0.2, 0.8, 1, 3, flatM(FURNC.red), 0.12, 0.88), fcyl(ax, 0.22, 0.14, 0.06, 0, 1, flatM(FURNC.black)), fcyl(ax, 0.78, 0.86, 0.06, 0, 1, flatM(FURNC.black)),
      run(ax, 0.2, 0.26, 3, 26, brass, 0.12, 0.18), run(ax, 0.2, 0.26, 3, 26, brass, 0.82, 0.88), run(ax, 0.2, 0.26, 24, 26, brass, 0.12, 0.88), run(ax, 0.3, 0.7, 3, 11, flatM(FURNC.fabricDk), 0.3, 0.7)];
  } },
  banquet: { top: 10, p: () => [{ cyl: [0.5, 0.5, 0.06], z0: 0, z1: 8, m: flatM(FURNC.steel) }, { cyl: [0.5, 0.5, 0.42], z0: 6, z1: 10, m: (f, s, t, X, Y) => mul(FURNC.cloth, (f === "top" ? 1.1 : 0.95) + n2(X, Y, 143) * 0.04) }] },
  liftdoor: { top: 30, p: (o) => {
    const ax = along(o), door = (f, s, t, X, Y, sw) => { if (f === "top") return FURNC.steel; const w = sw || 14; if (t > 26 || s < 1 || s > w - 1) return mul(FURNC.steel, 0.7); if (Math.abs(s - w / 2) < 0.4) return FURNC.black; if (t > 27.5) return FURNC.amber; return mul(FURNC.chrome, 0.9 + n2(Math.floor(X), Math.floor(t / 4), 144) * 0.08); };
    return [run(ax, 0.42, 0.5, 0, 30, door, 0.06, 0.94)];
  } },
  loungechair: { top: 12, p: (o) => {
    const ax = along(o), cloth = (f) => (f === "top" ? mul(FURNC.fabric, 1.15) : FURNC.fabric);
    return [run(ax, 0.26, 0.38, 0, 12, flatM(FURNC.fabricDk), 0.24, 0.76), run(ax, 0.38, 0.76, 0, 6, cloth, 0.24, 0.76), run(ax, 0.38, 0.76, 6, 9, flatM(FURNC.fabricDk), 0.24, 0.3), run(ax, 0.38, 0.76, 6, 9, flatM(FURNC.fabricDk), 0.7, 0.76)];
  } },
  lounger: { top: 8, p: (o) => {
    const ax = along(o), white = (f, s, t, X) => (f === "top" ? (Math.floor(X) % 3 < 1 ? mul(FURNC.white, 0.8) : mul(FURNC.white, 1.12)) : FURNC.white);
    return [...flegs(0.3, 0.66, 0.06, 0.9, 3, flatM(FURNC.chrome), 0.04), run(ax, 0.3, 0.7, 3, 4, white, 0.04, 0.72), run(ax, 0.3, 0.7, 4, 8, white, 0.72, 0.96)];
  } },
  tennisnet: { top: 9, p: (o) => {
    const ax = along(o), mesh = (f, s, t, X) => (f === "top" || t > 7.5 ? FURNC.cloth : (Math.floor(X) + Math.floor(t)) % 2 ? FURNC.black : mul(FURNC.black, 1.8));
    return [run(ax, 0.47, 0.53, 1, 8, mesh, 0, 1), fcyl(ax, 0.5, 0.04, 0.04, 0, 9, flatM(FURNC.steel)), fcyl(ax, 0.5, 0.96, 0.04, 0, 9, flatM(FURNC.steel))];
  } },
  // ---------- workshops and bays ----------
  workbench: { top: 14, p: (o) => {
    const ax = along(o), w = flatM(PAL.woodDk);
    return [run(ax, 0.22, 0.28, 0, 9, w, 0.04, 0.1), run(ax, 0.72, 0.78, 0, 9, w, 0.04, 0.1), run(ax, 0.22, 0.28, 0, 9, w, 0.9, 0.96), run(ax, 0.72, 0.78, 0, 9, w, 0.9, 0.96), run(ax, 0.22, 0.78, 2, 3, fwood(PAL.wood), 0.04, 0.96), run(ax, 0.2, 0.8, 9, 12, fwood(PAL.woodLt, 50), 0.02, 0.98), run(ax, 0.6, 0.76, 12, 14, flatM(FURNC.steel), 0.7, 0.86)];
  } },
  toolchest: { top: 18, p: (o) => { const ax = along(o); return [run(ax, 0.28, 0.72, 0, 18, fdrawers(FURNC.red, 3, FURNC.chrome), 0.18, 0.82)]; } },
  // ---------- police, barracks, schools, offices ----------
  bunk: { top: 22, p: (o) => {
    const ax = along(o), s0 = flatM(FURNC.steel), mat = (f, s, t, X, Y) => (f === "top" ? mul(FURNC.felt, 0.9 + n2(X, Y, 51) * 0.12) : mul(FURNC.felt, 0.75));
    const posts = [[0.18, 0.04], [0.78, 0.04], [0.18, 0.92], [0.78, 0.92]].map(([c, a]) => run(ax, c, c + 0.04, 0, 22, s0, a, a + 0.04));
    return [posts[0], posts[1], run(ax, 0.18, 0.82, 3, 4, s0, 0.02, 0.98), run(ax, 0.2, 0.8, 4, 6, mat, 0.04, 0.96), run(ax, 0.18, 0.82, 14, 15, s0, 0.02, 0.98), run(ax, 0.2, 0.8, 15, 17, mat, 0.04, 0.96), posts[2], posts[3]];
  } },
  schooldesk: { top: 10, p: (o) => {
    const ax = along(o), s0 = flatM(FURNC.steel);
    return [run(ax, 0.3, 0.34, 0, 8, s0, 0.3, 0.34), run(ax, 0.3, 0.34, 0, 8, s0, 0.66, 0.7), run(ax, 0.66, 0.7, 0, 8, s0, 0.3, 0.34), run(ax, 0.66, 0.7, 0, 8, s0, 0.66, 0.7), run(ax, 0.28, 0.72, 6, 8, flatM(FURNC.steel), 0.28, 0.72), run(ax, 0.24, 0.76, 8, 10, fwood(FURNC.cream, 52), 0.24, 0.76)];
  } },
  teacherdesk: { top: 12, p: (o) => {
    const ax = along(o);
    return [run(ax, 0.2, 0.26, 0, 9, fwood(PAL.wood), 0.04, 0.96), run(ax, 0.26, 0.8, 0, 9, fdrawers(PAL.wood, 3), 0.66, 0.94), run(ax, 0.16, 0.84, 9, 11, fwood(PAL.woodLt), 0.02, 0.98), run(ax, 0.36, 0.56, 11, 12, flatM(FURNC.cloth), 0.2, 0.4)];
  } },
  bleachers: { top: 20, p: (o) => {
    const ax = along(o), plank = (f, s, t, X, Y) => (f === "top" ? mul(PAL.woodLt, 1 + n2(X, Y, 53) * 0.1) : Math.floor(t) % 6 < 1 ? mul(PAL.woodLt, 0.95) : mul(FURNC.steel, 0.8));
    return [run(ax, 0.02, 0.35, 0, 20, plank, 0, 1), run(ax, 0.35, 0.67, 0, 13, plank, 0, 1), run(ax, 0.67, 0.98, 0, 6, plank, 0, 1)];
  } },
  serverrack: { top: 30, p: (o) => {
    const ax = along(o), face = (f, s, t, X, Y, sw) => { if (f === "top") return mul(FURNC.black, 1.3); if (s < 1 || s > (sw || 16) - 1 || t < 1) return mul(FURNC.black, 1.6); if (Math.floor(t) % 3 < 1) return FURNC.ring; const q = n2(Math.floor(X), Math.floor(t), 54); return q > 0.93 ? FURNC.led : q > 0.88 ? FURNC.amber : FURNC.black; };
    return [run(ax, 0.26, 0.74, 0, 30, face, 0.14, 0.86)];
  } },
  copier: { top: 16, p: (o) => {
    const ax = along(o);
    return [run(ax, 0.22, 0.78, 0, 12, fdrawers(FURNC.beige, 4, FURNC.black), 0.18, 0.82), run(ax, 0.26, 0.74, 12, 15, flatM(mul(FURNC.beige, 1.1)), 0.22, 0.78), run(ax, 0.26, 0.74, 15, 16, flatM(FURNC.black), 0.26, 0.74)];
  } },
  safe: { top: 18, p: () => [fbox(0.24, 0.76, 0.24, 0.76, 0, 18, fsafe(18))] },
  // ---------- police, fire stations, schools and churches (issue #15, sim/civiclayout.js) ----------
  // A gun rack: a wooden back board with long guns standing in it; an ammo cabinet and an evidence locker steel doors
  // (the evidence locker's tagged in yellow); a turnout locker open-fronted with a coat and a helmet; a school's narrow
  // lockers in a row of painted doors; a storage cage of mesh with balls in it; a lab bench with a sink and a black top;
  // a weight bench with its bar; an air compressor's tank; a canvas cot; candlesticks on a stand.
  gunrack: { top: 24, p: (o) => {
    const ax = along(o), guns = (f, s, t, X) => (f === "top" ? FURNC.black : Math.floor(X) % 3 < 1 ? mul(PAL.wood, 0.8) : FURNC.black);
    return [run(ax, 0.22, 0.32, 0, 24, fwood(PAL.woodDk, 55), 0.06, 0.94), run(ax, 0.32, 0.5, 0, 4, fwood(PAL.wood, 56), 0.06, 0.94), run(ax, 0.34, 0.42, 4, 22, guns, 0.12, 0.88)];
  } },
  ammocab: { top: 24, p: (o) => { const ax = along(o); return [run(ax, 0.26, 0.74, 0, 24, fdrawers(mul(FURNC.steel, 0.75), 6, FURNC.chrome), 0.12, 0.88)]; } },
  evlocker: { top: 26, p: (o) => {
    const ax = along(o), face = (f, s, t, X, Y, sw) => { if (f === "top") return FURNC.steel; const w = sw || 16; if (Math.abs(s - w / 2) < 0.4 || Math.floor(t) % 9 < 1) return mul(FURNC.steel, 0.6); if (t > 18 && t < 21 && s > 1 && s < 4) return FURNC.amber; return mul(FURNC.steel, 0.92 + n2(X, Y, 57) * 0.08); };
    return [run(ax, 0.26, 0.74, 0, 26, face, 0.08, 0.92)];
  } },
  turnout: { top: 26, p: (o) => {
    const ax = along(o), coat = (f) => (f === "top" ? mul(FURNC.amber, 0.8) : mul(hex("#c8b048"), 0.85));
    return [run(ax, 0.22, 0.3, 0, 26, flatM(mul(FURNC.red, 0.8)), 0.06, 0.94), run(ax, 0.3, 0.7, 0, 2, flatM(mul(FURNC.red, 0.8)), 0.06, 0.94), run(ax, 0.32, 0.56, 6, 20, coat, 0.2, 0.8), run(ax, 0.34, 0.6, 21, 25, flatM(FURNC.black), 0.3, 0.7)];
  } },
  schoollocker: { top: 26, p: (o) => {
    const ax = along(o), face = (f, s, t, X) => (f === "top" ? mul(FURNC.scrubs, 0.8) : Math.floor(X) % 5 < 1 || t < 1 ? mul(FURNC.scrubs, 0.55) : t > 22 && t < 24 ? mul(FURNC.scrubs, 0.7) : FURNC.scrubs);
    return [run(ax, 0.28, 0.7, 0, 26, face, 0.02, 0.98)];
  } },
  sportcage: { top: 22, p: (o) => {
    const ax = along(o), mesh = (f, s, t, X) => ((Math.floor(X) + Math.floor(t)) % 3 < 1 ? FURNC.chrome : f === "top" ? mul(FURNC.steel, 0.5) : mul(PAL.metalDk, 0.9));
    return [fcyl(ax, 0.5, 0.35, 0.14, 0, 6, flatM(FURNC.amber)), fcyl(ax, 0.55, 0.68, 0.12, 0, 5, flatM(FURNC.red)), run(ax, 0.2, 0.8, 0, 22, mesh, 0.04, 0.96)];
  } },
  labbench: { top: 13, p: (o) => {
    const ax = along(o);
    return [run(ax, 0.22, 0.78, 0, 11, fdrawers(PAL.woodLt, 5), 0.04, 0.96), run(ax, 0.18, 0.82, 11, 12, flatM(FURNC.black), 0.02, 0.98), run(ax, 0.3, 0.6, 11.5, 12, flatM(FURNC.chrome), 0.4, 0.6), run(ax, 0.22, 0.26, 12, 13, flatM(FURNC.chrome), 0.48, 0.52)];
  } },
  weightbench: { top: 16, p: (o) => {
    const ax = along(o), s0 = flatM(FURNC.black);
    return [run(ax, 0.44, 0.56, 0, 6, flatM(FURNC.steel), 0.1, 0.9), run(ax, 0.38, 0.62, 6, 8, flatM(FURNC.leather), 0.06, 0.94), run(ax, 0.06, 0.94, 12, 13, flatM(FURNC.chrome), 0.18, 0.22), run(ax, 0.04, 0.14, 9, 16, s0, 0.14, 0.26), run(ax, 0.86, 0.96, 9, 16, s0, 0.14, 0.26)];
  } },
  compressor: { top: 14, p: (o) => {
    const ax = along(o);
    return [fcyl(ax, 0.5, 0.5, 0.26, 0, 10, (f) => (f === "top" ? mul(FURNC.red, 1.1) : FURNC.red)), run(ax, 0.4, 0.6, 10, 14, flatM(FURNC.black), 0.32, 0.62)];
  } },
  cot: { top: 7, p: (o) => {
    const ax = along(o), s0 = flatM(FURNC.steel), canvas = (f, s, t, X, Y) => (f === "top" ? mul(FURNC.felt, 0.95 + n2(X, Y, 58) * 0.1) : mul(FURNC.felt, 0.8));
    return [...flegs(0.24, 0.72, 0.06, 0.9, 5, s0, 0.04), run(ax, 0.22, 0.78, 5, 7, canvas, 0.04, 0.96)];
  } },
  candles: { top: 18, p: () => [{ cyl: [0.5, 0.5, 0.12], z0: 0, z1: 1, m: flatM(FURNC.gold) }, fbox(0.48, 0.52, 0.48, 0.52, 1, 12, flatM(FURNC.gold)), fbox(0.3, 0.7, 0.47, 0.53, 12, 13, flatM(FURNC.gold)), fbox(0.3, 0.36, 0.47, 0.53, 13, 18, flatM(FURNC.cream)), fbox(0.64, 0.7, 0.47, 0.53, 13, 18, flatM(FURNC.cream)), fbox(0.47, 0.53, 0.47, 0.53, 13, 18, flatM(FURNC.cream))] },
  // ---------- lootable decor (issue #13, sim/decor.js) ----------
  // A plant in a clay pot, a floor lamp with its shade; a painting and a wall clock as they stand once set down (on a
  // wall they are drawn on its face: wartTexel).
  plant: { top: 18, p: (o, v) => [{ cyl: [0.5, 0.5, 0.16], z0: 0, z1: 6, m: (f) => (f === "top" ? mul(FLOORC.dirt, 0.8) : mul(PAL.rust, 1.1)) }, { cyl: [0.5, 0.5, 0.27], z0: 6, z1: 18, m: (f, s, t, X, Y) => mul(n2(X, Y, 81 + v) > 0.6 ? PAL.leaf2 : PAL.leaf, (f === "top" ? 1.25 : 1) + n2(X, Y, 82) * 0.2) }] },
  floorlamp: { top: 28, p: () => [{ cyl: [0.5, 0.5, 0.14], z0: 0, z1: 1, m: flatM(PAL.metalDk) }, { cyl: [0.5, 0.5, 0.03], z0: 1, z1: 22, m: flatM(FURNC.chrome) }, { cyl: [0.5, 0.5, 0.17], z0: 22, z1: 28, m: (f) => (f === "top" ? mul(FURNC.cream, 1.1) : FURNC.cream) }] },
  painting: { top: 14, p: (o) => { const ax = along(o), face = (f, s, t, X, Y, sw) => { if (f === "top" || s < 1 || s > (sw || 12) - 1 || t < 1 || t > 13) return WARTC.frame; return t < 7 + Math.sin(s) * 0.8 ? WARTC.hill : WARTC.sky; }; return [run(ax, 0.42, 0.52, 0, 14, face, 0.18, 0.82)]; } },
  wallclock: { top: 8, p: (o) => { const ax = along(o), face = (f, s, t, X, Y, sw) => { const d = Math.hypot(s - (sw || 6) / 2, t - 4); return f === "top" || d > 3 ? WARTC.rim : d < 0.6 || (Math.abs(s - (sw || 6) / 2) < 0.4 && t > 4) ? WARTC.rim : WARTC.white; }; return [run(ax, 0.44, 0.52, 0, 8, face, 0.3, 0.7)]; } },
};
// A piece carried (sim/furnicarry.js, issue #17): its own cells' prims (primsOf), its long side along the view's ax
// ("u" | "v"), a 2-cell piece both its cells joined in one run (as JOINS draws it standing), on the ground at (0, 0).
function carriedPrims(k, ax) {
  const d = FURNITURE_KINDS[k];
  if (!d) return [];
  const long = Math.max(d.size[0], d.size[1]), out = [];
  for (let i = 0; i < long; i++) {
    const j = long < 2 ? 0 : ax === "u" ? (i < long - 1 ? 1 : 0) | (i ? 2 : 0) : (i < long - 1 ? 4 : 0) | (i ? 8 : 0);
    const du = ax === "u" ? i : 0, dv = ax === "v" ? i : 0;
    for (const q of primsOf(k, { v: 0, j, n: ax === "u" ? "v" : "u", top: 28, mat: 0, dmg: 0 })) {
      if (q.cyl) out.push({ ...q, cyl: [q.cyl[0] + du, q.cyl[1] + dv, q.cyl[2]] });
      else if (q.blob) out.push({ ...q, blob: [q.blob[0] + du, q.blob[1] + dv, q.blob[2]] });
      else out.push({ ...q, u0: q.u0 + du, u1: q.u1 + du, v0: q.v0 + dv, v1: q.v1 + dv });
    }
  }
  return out;
}
// Its middle on the ground (view u, v) and height (art px).
const carriedMid = (k, ax) => { const d = FURNITURE_KINDS[k], L = d ? Math.max(d.size[0], d.size[1]) : 1; return ax === "u" ? [L / 2, 0.5] : [0.5, L / 2]; };
const carriedTop = (k) => (FURN_DRAW[k] ? FURN_DRAW[k].top : blockTop0(k, { top: 28 }) || 12);
// The piece in a carrier's arms as pixels (ui/figures.js setPieceArt: painted into the figure), the diagonal view's
// projection (the figures' own), cached by kind and side.
const pieceArtCache = new Map();
export function pieceArt(k, ax) {
  const key = `${k}|${ax}`;
  if (pieceArtCache.has(key)) return pieceArtCache.get(key);
  const prims = carriedPrims(k, ax);
  let art = null;
  if (prims.length) {
    const px = paintPx(prims, { st: false }), [u, v] = carriedMid(k, ax);
    art = { ...px, cx: artX(u, v, false), cy: artY(u, v, false), top: carriedTop(k) };
  }
  pieceArtCache.set(key, art);
  return art;
}
setPieceArt(pieceArt);
export const furnProbe = { primsOf: (k, o) => primsOf(k, o), blockTop0: (k, o) => blockTop0(k, o), FURN_DRAW, FURNITURE, FLOORED, OUTLINED: () => OUTLINED, JOINS: () => JOINS }; // tools/furnituretest.js

function primsOf(k, o) {
  const v = o.v || 0;
  if (o.car && (k === "car" || k === "truck" || k === "vehicle")) return carPieces(o.car, iso.rot);
  if (FURN_DRAW[k]) return FURN_DRAW[k].p(o, v); // the furniture catalogue's appliances and pieces (sim/data-furniture.js)
  switch (k) {
    case "wall": case "window": case "door": case "idoor": case "boarded": {
      const top = o.stub ? STUB : o.top;
      const outer = wallFace(o.mat ?? 0, o.dmg), inE = o.ie ? innerFace(o.ie) : null, inS = o.is ? innerFace(o.is) : null; // inE, inS: a room's paint on the inside faces (sim/decor.js c.wc)
      const art = o.art && !o.stub ? { f: o.art[0] === "e" ? "east" : "south", k: o.art.slice(1) } : null; // wall art, gone with the wall cut away
      const face = inE || inS || art ? (f, s, t, X, Y, sw) => (art && f === art.f && wartTexel(art.k, s, t, sw || 16, v)) || (f === "east" && inE ? inE(f, s, t, X, Y) : f === "south" && inS ? inS(f, s, t, X, Y) : outer(f, s, t, X, Y)) : outer;
      const winFace = (axisFace) => (f, s, t, X, Y, sw) => {
        if (f === axisFace && !o.stub) {
          const w0 = 4, w1 = (sw || 16) - 4;
          if (k === "window" && s >= w0 && s < w1 && t >= 11 && t < 25) return s < w0 + 1 || s >= w1 - 1 || t < 12 || t >= 24 ? PAL.frame : mul(PAL.glass, 0.85 + (s - t) % 5 * 0.04 + (o.dmg ? -0.3 : 0));
          // A roller door (a garage bay, a loading dock): metal slats across the whole cell.
          if (o.roll && t < 25) return t >= 24 ? PAL.frame : mul(PAL.metal, Math.floor(t) % 3 < 1 ? 0.7 : 0.92 + n2(s, t, 2) * 0.08);
          // A door, big and bright enough to find across the map: a painted leaf with panels in a light frame and a
          // brass knob (a closed door); a locked one (sim/locks.js) oxblood with a steel bar across and a brass lock
          // plate, a vault door steel.
          // Boards nailed across a door or a window (sim/barricade.js): planks of raw wood, a nail head at each end.
          if (k === "boarded" && s >= 1 && s < 15 && t < 28) {
            const row = Math.floor(t / 5), lean = (row % 2 ? 1 : -1) * Math.floor(s / 7);
            const tt = t + lean;
            if (Math.floor(tt) % 5 === 4) return mul(PAL.woodDk, 0.7);
            if ((s < 3 || s >= 13) && Math.floor(tt) % 5 === 2) return PAL.metalDk;
            return mul(PAL.wood, 0.78 + n2(Math.floor(s / 4), row, 6) * 0.22);
          }
          if ((k === "door" || k === "idoor") && s >= 3 && s < 13 && t < 27) {
            if (s < 4 || s >= 12 || t >= 26) return DOORC.trim;
            if (k === "door" && t >= 13 && t < 15) return PAL.metalDk;
            if (k === "door" && s >= 7 && s < 10 && t >= 9 && t < 13) return DOORC.brass;
            if (k === "idoor" && s >= 9 && s < 11 && t >= 12 && t < 14) return DOORC.brass;
            return mul(o.vault ? PAL.metal : k === "door" ? DOORC.locked : DOORC.leaf, (Math.floor(t) % 9 < 1 || Math.floor(s) === 7 ? 0.8 : 0.95) + n2(s, t, 1) * 0.1);
          }
        }
        return face(f, s, t, X, Y, sw);
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
      // The base's wall line: upright logs with pointed tops and a sheet-metal brace; battered ones are shorter. A wall
      // piece (sim/basemap.js) by its material (o.mat, sim/buildings.js WALL_TIERS): planks, logs, scrap metal, sheets.
      const ax = along(o), top = o.stub ? STUB : PALISADE;
      if (o.mat === 1 || o.mat === 3 || o.mat === 4) {
        const dmgTop = top - (o.dmg ? Math.floor(o.dmg * 10) : 0);
        const face = o.mat === 1 ? (f, s, t, X, Y) => (f === "top" ? PAL.woodLt : Math.floor(s) % 5 < 1 ? PAL.woodDk : mul(PAL.wood, 0.85 + n2(Math.floor(s / 5), 0, 7 + v) * 0.25))
          : o.mat === 3 ? (f, s, t, X, Y) => { const q = n2(Math.floor(s / 6), Math.floor(t / 5), 13 + v); return q > 0.72 ? mul(PAL.rust, 0.85 + n2(X, Y, 5) * 0.25) : q < 0.22 ? PAL.metalDk : mul(PAL.metal, 0.82 + n2(X, Y, 4) * 0.22); }
          : (f, s, t, X, Y) => (Math.floor(s) % 8 < 1 || Math.floor(t) % 10 < 1 ? PAL.metalDk : mul(PAL.metal, 0.95 + n2(X, Y, 3) * 0.08));
        const post = o.mat === 1 ? tex(PAL.woodDk, 0.1) : tex(PAL.metalDk, 0.08);
        return [run(ax, 0.4, 0.6, 0, dmgTop, face), run(ax, 0.36, 0.64, 0, dmgTop + 2, post, 0, 0.1), run(ax, 0.36, 0.64, 0, dmgTop + 2, post, 0.9, 1)];
      }
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
    case "stand": {
      // A wall stand (sim/basemap.js): a plank platform a level up on four posts, a ladder up its back.
      const z = LV, dk = tex(PAL.woodDk, 0.1);
      return [
        { u0: 0.04, u1: 0.16, v0: 0.04, v1: 0.16, z0: 0, z1: z, m: dk }, { u0: 0.84, u1: 0.96, v0: 0.04, v1: 0.16, z0: 0, z1: z, m: dk },
        { u0: 0.04, u1: 0.16, v0: 0.84, v1: 0.96, z0: 0, z1: z, m: dk },
        { u0: 0.42, u1: 0.58, v0: 0.92, v1: 0.98, z0: 0, z1: z, m: (f, s, t) => (Math.floor(t) % 5 < 1 ? PAL.woodLt : PAL.woodDk) }, // the ladder
        { u0: 0.84, u1: 0.96, v0: 0.84, v1: 0.96, z0: 0, z1: z, m: dk },
        { u0: 0, u1: 1, v0: 0, v1: 1, z0: z - 3, z1: z, m: (f, s, t) => (f === "top" ? mul(PAL.woodLt, (s | 0) % 4 < 1 ? 0.75 : 0.95 + n2(s, t, 8) * 0.1) : PAL.woodDk) },
        ...(o.spot ? spotHead(z, o.spot === 2) : []), // a mounted spotlight up on the stand (sim/data-power.js)
      ];
    }
    case "spot": return [ // a mounted spotlight on the ground (sim/data-power.js): a weighted base, a short post, the lamp head
      { u0: 0.3, u1: 0.7, v0: 0.3, v1: 0.7, z0: 0, z1: 3, m: flatM(PAL.metalDk) },
      ...spotHead(3, o.spot === 2),
    ];
    case "walkway": case "loft": case "roof": {
      // Raised floors one level up: the wall's walkway (planks on a timber frame), an upper floor, a flat roof.
      const top = (f, s, t, X, Y) => (k === "roof" ? mul(PAL.tar, 0.9 + n2(X, Y, 3) * 0.25) : mul(k === "loft" ? PAL.wood : PAL.woodLt, (Math.floor(along(o) === "u" ? t : s) % 4 < 1 ? 0.72 : 0.92 + n2(X, Y, 8) * 0.12)));
      const side = k === "roof" ? wallFace(3, 0) : (f, s, t) => (Math.floor(t) % 10 < 2 || Math.floor(s) % 8 < 2 ? PAL.woodDk : mul(PAL.wood, 0.75));
      return [{ u0: 0, u1: 1, v0: 0, v1: 1, z0: 0, z1: LV, flat: k === "loft", m: (f, s, t, X, Y, a, c) => (f === "top" ? top(f, s, t, X, Y) : side(f, s, t, X, Y, a, c)) }];
    }
    case "crag": { // a mountain's ridge (sim/basescatter.js reliefLayer): one mass of rock three levels up and more, its
      // faces banded and cracked, its top broken a little cell to cell, the highest snow-capped; a side with no crag
      // beside it (o.j, JOINS.crag) steps in as it rises, so the ridge's flanks are steep but not walls.
      const q0 = hash3(v, o.alt, 23), hh = 3 * LV + Math.round((q0 - 0.3) * 10), snow = q0 > 0.72;
      const rock = (f, s2, t, X, Y) => {
        const q = n2(X, Y, 8), crack = n2(Math.floor(X / 3), Math.floor(Y / 2), 13) > 0.9;
        if (f === "top") return snow && q > 0.25 ? mul(hex("#d9dde0"), 0.9 + q * 0.1) : mul(PAL.stone, 1.02 + q * 0.16);
        return crack ? mul(PAL.stone, 0.5) : mul(PAL.stone, (Math.floor((t + q * 5) / 6) % 2 ? 0.74 : 0.84) + q * 0.1);
      };
      const open = (d) => !(o.j & (1 << d)), I = 0.16;
      const tier = (z0, z1, k) => ({ u0: open(1) ? I * k : 0, u1: open(0) ? 1 - I * k : 1, v0: open(3) ? I * k : 0, v1: open(2) ? 1 - I * k : 1, z0, z1, flat: true, m: rock });
      return [tier(0, hh * 0.45, 0), tier(hh * 0.45, hh * 0.8, 1), tier(hh * 0.8, hh, 2)];
    }
    case "rise": { // high ground (sim/basescatter.js highLayer): a block of earth a level up, grass on its top
      // Its open sides (no high ground or slope beside it: o.j, JOINS.rise) fall away in a grassy bank (the playtest
      // 2026-10-23: the hills' edges read as staircases): the top is drawn RISE.BANK in from each, the bank slopes down
      // across that band to RISE.FOOT of the height, a rounded shoulder where two open sides meet. The rules are the
      // block's (a drop at the edge, sim/combat.js CELL.rise): only the look is softened.
      const top = (X, Y, k = 1) => { const q = n2(X, Y, 6); return q > 0.9 ? mul(PAL.leaf2, 0.9 * k) : mul(FLOORC.grass, (0.88 + q * 0.2) * k); };
      const side = (f, s, t, X, Y) => { const q = n2(X, Y, 4); return t > LV - 3 ? mul(FLOORC.grass, 0.7) : Math.floor(t + q * 4) % 6 < 1 ? mul(PAL.stone, 0.7) : mul(FLOORC.dirt, 0.8 + q * 0.25); };
      const open = (d) => !(o.j & (1 << d)), B = RISE.BANK;
      const [pu, nu, pv, nv] = [open(0), open(1), open(2), open(3)]; // the +u, −u, +v, −v sides fall away
      const u0 = nu ? B : 0, u1 = pu ? 1 - B : 1, v0 = nv ? B : 0, v1 = pv ? 1 - B : 1;
      const out = [{ u0, u1, v0, v1, z0: 0, z1: LV, flat: true, m: (f, s, t, X, Y) => (f === "top" ? top(X, Y) : side(f, s, t, X, Y)) }];
      // The banks: thin slices, each lower toward the open side (h: 0 at the top's edge, 1 at the cell's).
      const zAt = (h) => LV * (1 - (1 - RISE.FOOT) * Math.pow(h, 1.5));
      // A bank's slices are grass on their faces too (a grassy slope, not terraces of earth), earth only at the very foot.
      // Its faces lit as its top is (rampLit: the slices blend into one slope, no stripes), the shade by how far down.
      const bankM = (h) => rampLit((f, s, t, X, Y) => (f === "top" ? top(X, Y, 1 - 0.18 * h) : t < 2 ? mul(FLOORC.dirt, 0.75 + n2(X, Y, 4) * 0.2) : top(X, Y, (f === "east" ? 0.86 : 0.94) - 0.18 * h)));
      const N = RISE.SLICES;
      for (let i = 0; i < N; i++) {
        const h = (i + 0.5) / N, a = (i * B) / N, b = ((i + 1) * B) / N, z1 = zAt(h), m = bankM(h);
        if (pu) out.push({ u0: 1 - B + a, u1: 1 - B + b, v0, v1, z0: 0, z1, flat: true, m });
        if (nu) out.push({ u0: B - b, u1: B - a, v0, v1, z0: 0, z1, flat: true, m });
        if (pv) out.push({ u0, u1, v0: 1 - B + a, v1: 1 - B + b, z0: 0, z1, flat: true, m });
        if (nv) out.push({ u0, u1, v0: B - b, v1: B - a, z0: 0, z1, flat: true, m });
      }
      // The corners where two open sides meet: a rounded shoulder (by the distance out from the top's corner).
      for (const [cu, cv] of [[pu && pv && [1 - B, 1], [1 - B, 1]], [pu && nv && [1 - B, 1], [0, B]], [nu && pv && [0, B], [1 - B, 1]], [nu && nv && [0, B], [0, B]]]) {
        if (!cu) continue;
        const M = 4;
        for (let i = 0; i < M; i++) for (let k = 0; k < M; k++) {
          const a0 = cu[0] + (i * B) / M, a1 = a0 + B / M, b0 = cv[0] + (k * B) / M, b1 = b0 + B / M;
          const du = cu[0] === 0 ? (M - 1 - i + 0.5) / M : (i + 0.5) / M, dv = cv[0] === 0 ? (M - 1 - k + 0.5) / M : (k + 0.5) / M;
          const h = Math.min(1, Math.hypot(du, dv));
          out.push({ u0: a0, u1: a1, v0: b0, v1: b1, z0: 0, z1: zAt(h), flat: true, m: bankM(h) });
        }
      }
      return out.sort((p, q) => p.u0 + p.v0 - q.u0 - q.v0);
    }
    case "slope": { // the way up onto it: a smooth ramp of earth and trodden grass rising towards the high ground
      const out = [], d = o.dir ?? 0, N = RISE.SLICES * 4;
      const tread = (X, Y, k) => mul(mix(mul(FLOORC.dirt, 0.95 + n2(X, Y, 5) * 0.2), FLOORC.grass, n2(X, Y, 7) * 0.45), k);
      const m = rampLit((f, s, t, X, Y) => (f === "top" ? tread(X, Y, 1) : tread(X, Y, f === "east" ? 0.86 : 0.94)));
      for (let i = 0; i < N; i++) {
        const a0 = d === 0 || d === 2 ? i / N : 1 - (i + 1) / N, a1 = a0 + 1 / N, z1 = Math.max(1, ((i + 1) / N) * LV);
        out.push(d < 2 ? { u0: a0, u1: a1, v0: 0, v1: 1, z0: 0, z1, flat: true, m } : { u0: 0, u1: 1, v0: a0, v1: a1, z0: 0, z1, flat: true, m });
      }
      return out.sort((p, q) => p.u0 + p.v0 - q.u0 - q.v0);
    }
    case "stairs": {
      if (o.len) {
        // A step of a stair run: two treads of its share of the storey, from the floor to the floor above over the run
        // (the top step reaches it); a railing (posts and a handrail) on the open side; on the top floor the opening
        // down: a dark well, treads falling away under a railing.
        const out = [], d = o.dir ?? 0, N = 2;
        const m = (f, s, t) => (o.well ? mul(PAL.woodDk, f === "top" ? 0.75 : 0.55) : f === "top" ? (o.air ? mul(PAL.metal, 1.1) : PAL.woodLt) : mul(o.air ? PAL.metal : PAL.wood, 0.85 + (t % 5 < 1 ? -0.2 : 0)));
        const zAt = (i) => (o.well ? Math.max(1, LV / 6 - ((o.step - 1) * N + i) * 1) : (((o.step - 1) * N + i + 1) / (o.len * N)) * LV);
        for (let i = 0; i < N; i++) {
          const a0 = d === 0 || d === 2 ? i / N : 1 - (i + 1) / N, a1 = a0 + 1 / N, z1 = zAt(i);
          out.push(d < 2 ? { u0: a0, u1: a1, v0: 0.04, v1: 0.96, z0: 0, z1, m } : { u0: 0.04, u1: 0.96, v0: a0, v1: a1, z0: 0, z1, m });
        }
        const rail = (f, s, t) => mul(o.air ? PAL.metalDk : PAL.woodDk, f === "top" ? 1.2 : 1);
        const top = o.well ? 12 : zAt(N - 1) + 11;
        for (let q = 0; q < 4; q++) {
          if (!(o.rail & (1 << q))) continue;
          const e = q === 0 || q === 2 ? [0.9, 0.98] : [0.02, 0.1]; // the edge on that side
          const across = q < 2; // a rail on a ±u edge runs along v
          const post = (p) => (across ? { u0: e[0], u1: e[1], v0: p, v1: p + 0.08, z0: 0, z1: top, m: rail } : { u0: p, u1: p + 0.08, v0: e[0], v1: e[1], z0: 0, z1: top, m: rail });
          out.push(post(0.46), across ? { u0: e[0], u1: e[1], v0: 0, v1: 1, z0: top - 2, z1: top, m: rail } : { u0: 0, u1: 1, v0: e[0], v1: e[1], z0: top - 2, z1: top, m: rail });
        }
        return out.sort((p, q) => p.u0 + p.v0 - q.u0 - q.v0);
      }
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
      if (o.sea) return seasonTree(o, v); // autumn's colours, winter's bare branches (seasonTree)
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
    case "boulder": return stonePrims(o, true);
    case "rock": return stonePrims(o, false);
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
    case "wirefence": {
      // A farmland field's post-and-wire fence (sim/basescatter.js fieldLayer): a weathered post in the middle of the
      // tile and three taut strands of plain wire along the line (towards the neighbours in it; across the tile alone).
      const post = tex(PAL.woodDk, 0.14, 23), strand = flatM(hex("#a4a69e")), out = [];
      const j = o.j & 15 || (along(o) === "u" ? 3 : 12);
      const arm = (d, z) => { const [du, dv] = VD[d]; const a0 = du ? Math.min(0.5, 0.5 + du * 0.5) : 0.485, a1 = du ? Math.max(0.5, 0.5 + du * 0.5) : 0.515, c0 = dv ? Math.min(0.5, 0.5 + dv * 0.5) : 0.485, c1 = dv ? Math.max(0.5, 0.5 + dv * 0.5) : 0.515; return { u0: a0, u1: a1, v0: c0, v1: c1, z0: z, z1: z + 0.6, m: strand }; };
      for (const d of [3, 1]) if (j & (1 << d)) for (const z of [5, 8.5, 12]) out.push(arm(d, z));
      out.push({ u0: 0.455, u1: 0.545, v0: 0.455, v1: 0.545, z0: 0, z1: 13, m: post });
      for (const d of [0, 2]) if (j & (1 << d)) for (const z of [5, 8.5, 12]) out.push(arm(d, z));
      return out;
    }
    case "fieldgate": {
      // A farmland field's gate (sim/basescatter.js fieldLayer), two cells of it: a five-bar gate of pale boards along
      // the fence's line with a diagonal brace, a stout post where it meets the fence (o.dir: those joins' bits).
      const ax = along(o), rail = flatM(PAL.woodLt), stile = flatM(mul(PAL.woodLt, 0.86)), brace = flatM(mul(PAL.woodLt, 0.78)), post = tex(PAL.woodDk, 0.12, 22), out = [];
      for (const a of [0.08, 0.86]) out.push(run(ax, 0.47, 0.53, 3, 13, stile, a, a + 0.06)); // the stiles
      for (const [z0, z1] of [[4, 5], [7.5, 8.5], [11, 12.5]]) out.push(run(ax, 0.47, 0.53, z0, z1, rail, 0.14, 0.86)); // the bars
      for (let i = 0; i < 6; i++) { const a = 0.14 + i * 0.12; out.push(run(ax, 0.53, 0.57, 4.5 + i * 1.3, 6 + i * 1.3, brace, a, a + 0.12)); } // the brace on its face, low end to high
      const [p0, p1] = ax === "u" ? [2, 1] : [8, 4]; // the joins at the leaf's two ends (−, +)
      if (o.dir & p0) out.push(run(ax, 0.42, 0.58, 0, 15, post, 0, 0.08));
      if (o.dir & p1) out.push(run(ax, 0.42, 0.58, 0, 15, post, 0.92, 1));
      return out;
    }
    case "sandbag": {
      // Three courses of bags, each narrower than the one below, laid like bricks: a bag half a tile long, each course's
      // seams half a bag over from the one below, counted from the tile's edge so they carry on into the next cell.
      // Joined (JOINS: the sandbag and barricade neighbours, sim/basemap.js sandbag1 pieces side by side) a course runs
      // out to that side of the tile; round a corner the two runs meet square; a free end steps in course by course.
      // A lone cell is a short stack along its axis (along), both ends stepped in.
      const COURSES = [[0.2, 0.8, 0, 5, 0.06], [0.26, 0.74, 5, 10, 0.12], [0.33, 0.67, 10, 13, 0.2]]; // across, z0, z1, a free end's step
      const bag = (ax, a0, row) => (f, s, t, X, Y) => {
        const d = f === "top" ? (ax === "u" ? s : t) : f === (ax === "u" ? "south" : "east") ? s : -1; // along the run (a run's end face: none)
        const p = d < 0 ? -1 : a0 * 16 + d + (row & 1) * 4, i = Math.floor(p / 8);
        const seam = (p >= 0 && p % 8 < 0.9) || (f !== "top" && t < 0.7);
        const tuck = f === "top" && (ax === "u" ? t : s) < 1.2; // the fold of the sack along the back
        return mul(PAL.sand, seam ? 0.7 : (0.88 + hash3(i, row, 31) * 0.14) * (tuck ? 0.9 : 1) + (f === "top" ? 0.05 : 0));
      };
      const ju = o.j & 3, jv = o.j & 12, out = [];
      COURSES.forEach(([c0, c1, z0, z1, e], row) => {
        if (!ju && !jv) { const ax = along(o); out.push(run(ax, c0, c1, z0, z1, bag(ax, e, row), e, 1 - e)); return; }
        if (ju) { const a0 = o.j & 2 ? 0 : jv ? c0 : e, a1 = o.j & 1 ? 1 : jv ? c1 : 1 - e; out.push(run("u", c0, c1, z0, z1, bag("u", a0, row), a0, a1)); }
        if (jv) { const a0 = o.j & 8 ? 0 : ju ? c0 : e, a1 = o.j & 4 ? 1 : ju ? c1 : 1 - e; out.push(run("v", c0, c1, z0, z1, bag("v", a0, row), a0, a1)); }
      });
      return out;
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
    // The base map (sim/basemap.js): a building's outline while it goes up (a stake at the corner with string along
    // the sides toward the neighbours in the outline), a camp's tent, its fire pit, a floodlight on its pole.
    case "outline": {
      const j = o.j & 15, str = flatM(hex("#d8d2b8")), post = tex(PAL.woodDk, 0.1);
      const out = [{ u0: 0.06, u1: 0.14, v0: 0.06, v1: 0.14, z0: 0, z1: 9, m: post }];
      for (const d of [0, 1, 2, 3]) if (j & (1 << d)) { const [du, dv] = VD[d]; out.push({ u0: du ? Math.min(0.1, 0.1 + du * 0.5) : 0.09, u1: du ? Math.max(0.1, 0.1 + du * 0.5) : 0.11, v0: dv ? Math.min(0.1, 0.1 + dv * 0.5) : 0.09, v1: dv ? Math.max(0.1, 0.1 + dv * 0.5) : 0.11, z0: 6, z1: 7, m: str }); }
      return out;
    }
    case "tent": {
      // A ridge tent (sim/buildings.js TENTS: 1 × 2, 2 × 2, 3 × 3): the ridge runs along the view's u axis between its rows;
      // each cell is the slope of its half, stepped up to the ridge on the side it joins the other row (o.j: 4 +v, 8 −v),
      // its ends closed where it stops along u (no join there), a dark flap at the open ends. A lone cell: a pup tent.
      const cloth = tex(hex("#6f7452"), 0.1, 3), dk = tex(hex("#4e5238"), 0.1, 4), flap = flatM(hex("#2e3022"));
      const lo = o.j & 2 ? 0 : 0.08, hi = o.j & 1 ? 1 : 0.92;
      const side = o.j & 4 ? 1 : o.j & 8 ? -1 : 0;
      if ((o.j & 12) === 12) return [{ u0: lo, u1: hi, v0: 0, v1: 1, z0: 0, z1: 15, m: cloth }, { u0: lo, u1: hi, v0: 0.2, v1: 0.8, z0: 15, z1: 20, m: dk }]; // the middle row of a big tent (3 × 3): the ridge over it
      if (!side) return [run("u", 0.1, 0.9, 0, 6, cloth, lo, hi), run("u", 0.2, 0.8, 6, 11, cloth, lo, hi), run("u", 0.36, 0.64, 11, 15, dk, lo, hi)];
      const band = (a0, a1) => (side > 0 ? [a0, a1] : [1 - a1, 1 - a0]); // a band of this cell's v, measured from the far edge toward the ridge
      const out = [];
      for (const [v0, z0, z1, m] of [[0.06, 0, 5, cloth], [0.32, 5, 10, cloth], [0.6, 10, 15, cloth], [0.84, 15, 18, dk]]) { const [c0, c1] = band(v0, 1); out.push({ u0: lo, u1: hi, v0: c0, v1: c1, z0, z1, m }); }
      if (hi < 1) { const [c0, c1] = band(0.4, 1); out.push({ u0: hi - 0.03, u1: hi, v0: c0, v1: c1, z0: 0, z1: 10, m: flap }); }
      return out;
    }
    // A tent slashed open or flattened (sim/softcover.js torn): the canvas in a heap on its poles, the cuts dark.
    case "torn": {
      const cloth = tex(hex("#6f7452"), 0.14, 3), cut = flatM(hex("#2e3022"));
      const a = (hash3(v, 9, 3) - 0.5) * 0.2;
      return [{ blob: [0.42 + a, 0.46, 2], ru: 0.36, rz: 3, m: cloth }, { blob: [0.62, 0.58 - a, 2], ru: 0.26, rz: 4, m: cloth }, { u0: 0.3, u1: 0.7, v0: 0.48, v1: 0.52, z0: 3, z1: 4, m: cut }, { u0: 0.18, u1: 0.24, v0: 0.2, v1: 0.26, z0: 0, z1: 6, m: flatM(PAL.woodDk) }];
    }
    // The base map's scatter (sim/basescatter.js): bushes, a tree stump, a fallen log (joined along its length).
    case "bush": {
      if (o.sea) return seasonBush(o, v);
      const lc = v === 1 ? PAL.leaf2 : mul(PAL.leaf, 0.9 + (v & 2) * 0.05);
      const leaf = (f, s, t, X, Y) => { const q = n2(X, Y, 19); return q > 0.88 ? mul(lc, 1.35) : q < 0.18 ? mul(lc, 0.6) : mul(lc, 0.9 + q * 0.15); };
      const a = (hash3(v, 5, 7) - 0.5) * 0.16;
      return [{ blob: [0.38 + a, 0.42, 6], ru: 0.32, rz: 6, m: leaf }, { blob: [0.64, 0.56 - a, 5], ru: 0.27, rz: 5, m: leaf }, { blob: [0.46, 0.7, 4], ru: 0.22, rz: 4, m: leaf }].sort((p, q) => p.blob[0] + p.blob[1] - q.blob[0] - q.blob[1]);
    }
    case "stump": return [
      { cyl: [0.5, 0.5, 0.2], z0: 0, z1: 6, m: (f, s, t, X, Y) => (f === "top" ? mul(PAL.woodLt, Math.round(Math.hypot(s, t * 2)) % 2 ? 0.82 : 1) : mul(PAL.bark, 0.9 + n2(X, Y, 6) * 0.2)) },
      { u0: 0.62, u1: 0.8, v0: 0.46, v1: 0.54, z0: 0, z1: 2, m: tex(PAL.bark, 0.2) }, { u0: 0.46, u1: 0.54, v0: 0.18, v1: 0.36, z0: 0, z1: 2, m: tex(PAL.bark, 0.2) },
    ];
    case "log": {
      const ax = along(o), lo = ax === "u" ? (o.j & 2 ? 0 : 0.08) : (o.j & 8 ? 0 : 0.08), hi = ax === "u" ? (o.j & 1 ? 1 : 0.92) : (o.j & 4 ? 1 : 0.92);
      const bark = (f, s, t, X, Y) => mul(PAL.bark, (f === "top" ? 1.05 : 0.85) + n2(X, Y, 7) * 0.2);
      const out = [run(ax, 0.32, 0.68, 0, 6, bark, lo, hi), run(ax, 0.38, 0.62, 6, 7, bark, lo + 0.04, hi - 0.04)];
      for (const [e, end] of [[lo, !(ax === "u" ? o.j & 2 : o.j & 8)], [hi, !(ax === "u" ? o.j & 1 : o.j & 4)]]) if (end) out.push(run(ax, 0.34, 0.66, 0, 6, flatM(PAL.woodLt), e === lo ? lo : hi - 0.02, e === lo ? lo + 0.02 : hi)); // the cut ends
      return out;
    }
    // A fire pit (the user's request 2026-10-23: "Improve campfire look"): a ring of field stones, each its own lump in
    // its own grey, round a bed of ash. Lit (o.lit: the cell's c.lit, sim/campsite.js and sim/basemap.js): a log-cabin
    // lay of four split logs, charred and cracked with glowing seams, over a bed of embers; its flames, sparks, smoke
    // and the glow on the ground are drawn each frame (drawCampfireIso). Cold: grey ash and two charred logs.
    case "firepit": {
      const lit = !!o.lit;
      const stones = [];
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + hash3(v, i, 51) * 0.3, rr = 0.32 + hash3(v, i, 52) * 0.04;
        const col = mul(i % 3 === 0 ? hex("#9a958b") : i % 3 === 1 ? hex("#7d786f") : hex("#625e57"), 0.9 + hash3(v, i, 53) * 0.2);
        stones.push({ blob: [0.5 + Math.cos(a) * rr, 0.5 + Math.sin(a) * rr, 0.9], ru: 0.06 + hash3(v, i, 54) * 0.02, rz: 1 + hash3(v, i, 55) * 0.6, m: (f, nx, ny, X, Y) => { const g = 0.92 + n2(X, Y, 56 + i) * 0.16; return lit ? [col[0] * g * 1.1, col[1] * g, col[2] * g * 0.9] : mul(col, g); } }); // lit: warmed by the fire
      }
      const back = stones.filter((p) => p.blob[0] + p.blob[1] < 1).sort((p, q) => p.blob[0] + p.blob[1] - q.blob[0] - q.blob[1]);
      const front = stones.filter((p) => p.blob[0] + p.blob[1] >= 1).sort((p, q) => p.blob[0] + p.blob[1] - q.blob[0] - q.blob[1]);
      const bed = { cyl: [0.5, 0.5, 0.29], z0: 0, z1: 0.6, m: (f, s, t, X, Y) => {
        const d = Math.hypot(s, t * 2), q = n2(X, Y, 2);
        if (f !== "top") return mul(hex("#3a332c"), 0.9);
        if (!lit) return mul(hex("#6b6862"), 0.8 + q * 0.35);
        return d < 3.2 ? (q > 0.55 ? hex("#ffb347") : hex("#e0602a")) : d < 5.2 ? (q > 0.72 ? hex("#ff8a2a") : q > 0.4 ? hex("#a8381c") : hex("#2f2420")) : mul(hex("#4a423a"), 0.8 + q * 0.3);
      } };
      if (!lit) return [
        bed, ...back,
        { u0: 0.34, u1: 0.64, v0: 0.46, v1: 0.53, z0: 0.6, z1: 2, m: tex(hex("#2b2622"), 0.15, 57) }, { u0: 0.46, u1: 0.53, v0: 0.35, v1: 0.62, z0: 2, z1: 3.2, m: tex(hex("#33302b"), 0.15, 58) },
        ...front,
      ];
      // A split log: bark on its sides, a pale cut end, charred toward the middle where it burns, seams glowing.
      const logM = (k) => (f, s, t, X, Y) => {
        const q = n2(X, Y, k);
        if (q > 0.86) return q > 0.94 ? hex("#ffc04a") : hex("#f07a2a");
        const char = clamp01(1 - Math.abs(s - 2.6) / 3);
        return mul(f === "top" ? PAL.woodLt : PAL.bark, (1 - char * 0.62) * (0.88 + q * 0.2));
      };
      return [
        bed, ...back,
        { u0: 0.33, u1: 0.67, v0: 0.37, v1: 0.44, z0: 0.6, z1: 2.4, m: logM(60) }, { u0: 0.33, u1: 0.67, v0: 0.56, v1: 0.63, z0: 0.6, z1: 2.4, m: logM(61) },
        { u0: 0.37, u1: 0.44, v0: 0.33, v1: 0.67, z0: 2.4, z1: 4.2, m: logM(62) }, { u0: 0.56, u1: 0.63, v0: 0.33, v1: 0.67, z0: 2.4, z1: 4.2, m: logM(63) },
        ...front,
      ];
    }
    case "lamp": return [
      { u0: 0.38, u1: 0.62, v0: 0.38, v1: 0.62, z0: 0, z1: 3, m: flatM(PAL.conc) }, { u0: 0.46, u1: 0.54, v0: 0.46, v1: 0.54, z0: 3, z1: 34, m: tex(PAL.metalDk, 0.1) },
      { u0: 0.3, u1: 0.7, v0: 0.42, v1: 0.58, z0: 32, z1: 38, m: (f) => (f === "top" ? PAL.metal : hex("#f3e4a0")) },
    ];
    default: return [];
  }
}
// Trees and bushes by the season (ui/seasontrees.js; the user's request 2026-10-23: "In fall the trees should be red
// orange and brown in winter the trees are leaf less and have snow on them."). o.sea (lookOf, from the cell's hash):
// "f0".."f3" the crown in that FALL colour, a few leaves of another among them; "b" bare: the trunk, its limbs and a
// see-through crown of twigs; "bs" bare with snow on the limbs and the twigs' tops. The dead tree keeps its own look
// (snow on its limbs in winter). Same places and sizes as the green ones (GROWN): only the look changes.
let treeLook = "green"; // this frame's (drawIso: treeLookFor)
let snowLook = 0; // the snow lying on the buildings this frame (drawIso: ui/roofsnow.js snowOnFor; roofSprite, snowPrims)
let leafNow = null; // autumn's leaves, per cell (ui/groundlook.js leafField), while looksFor builds the looks
const groundCells = (b) => (floorsOf(b) ? b.floors[0].cells : b.cells); // the ground floor's (where the trees stand)
const BARE = /^b/; // o.sea of a bare tree or bush: drawn with no outline (sprite)
const SNOWY = hex("#e9eef3"), TWIG = hex("#5b4b3d");
const snowy = (X, Y) => mul(SNOWY, 0.93 + n2(X, Y, 5) * 0.07);
// A crown of bare twigs: branches fanning out from the blob's middle (spokes that bend a little on the way out), holes
// between them (null); snow lying along the top of each, in the upper part of the crown. rz: the blob's height in px.
const twigs = (snow, k = 37, rz = 10) => {
  const on = (nx, ny) => {
    const r = Math.hypot(nx, ny), a = Math.atan2(ny, nx) / (2 * Math.PI) + 0.5 + 0.05 * Math.sin(r * 7 + k);
    const n = r < 0.45 ? 7 : 13, d = Math.abs(((a * n + hash3(k, Math.floor(a * n), 3) * 0.3) % 1) - 0.5); // 7 boughs, forking to 13 twigs
    return d >= 0.5 - Math.min(0.25, 0.09 / (r + 0.05)); // about a pixel wide all the way out
  };
  return (f, nx, ny, X, Y) => {
    if (!on(nx, ny)) return null;
    if (snow && ny < 0.05 && n2(X, Y, k + 9) < 0.35 - ny * 0.4 && !on(nx, ny - 1 / rz)) return snowy(X, Y); // nothing above it: snow on it, more higher up
    return mul(TWIG, 0.85 + n2(X, Y, k) * 0.3);
  };
};
function seasonTree(o, v) {
  const dead = v === 3 && o.alt, bare = o.sea[0] === "b", snow = o.sea === "bs", bark = tex(PAL.bark, 0.2);
  const limb = snow ? (f, s, t, X, Y) => (f === "top" ? snowy(X, Y) : bark(f, s, t, X, Y)) : bark; // snow along its top
  if (dead) return [{ cyl: [0.5, 0.5, 0.08], z0: 0, z1: 30, m: limb }, { u0: 0.25, u1: 0.5, v0: 0.47, v1: 0.53, z0: 20, z1: 22, m: limb }, { u0: 0.47, u1: 0.53, v0: 0.5, v1: 0.8, z0: 24, z1: 26, m: limb }, { u0: 0.5, u1: 0.72, v0: 0.47, v1: 0.53, z0: 27, z1: 29, m: limb }];
  const a = (hash3(v, 1, 3) - 0.5) * 0.2, c = (hash3(v, 2, 3) - 0.5) * 0.2;
  const crown = [[0.36 + a, 0.42, 22, 0.55], [0.6, 0.38 + c, 25, 0.5], [0.52, 0.62, 21, 0.55], [0.5 + a, 0.5 + c, 31, 0.45]];
  if (!bare) {
    const i = Number(o.sea.slice(1)) % FALL.length, lc = FALL[i], lc2 = FALL[(i + 1 + (v & 1)) % FALL.length];
    const leaf = (f, s, t, X, Y) => { const q = n2(X, Y, 12); return q > 0.86 ? mul(lc, 1.25) : q < 0.12 ? mul(lc, 0.55) : n2(X / 2, Y / 2, 29) > 0.8 ? mul(lc2, 0.95) : mul(lc, 0.88 + q * 0.14); };
    return [{ cyl: [0.5, 0.5, 0.08], z0: 0, z1: 16, m: bark }, ...crown.map(([u, w, z, r]) => ({ blob: [u, w, z], ru: r, rz: 9, m: leaf }))];
  }
  // Bare: a taller trunk, four limbs rising out from it (each a few short steps, up a little at each), the twigs'
  // crown round where the leaves were.
  const out = [], L = 0.24 + hash3(v, 3, 3) * 0.08, N = 4;
  const limbOut = (du, dv, z) => {
    for (let i = 0; i < N; i++) {
      const a = 0.5 + ((du || dv) * L * i) / N, b = 0.5 + ((du || dv) * L * (i + 1)) / N, lo = Math.min(a, b), hi = Math.max(a, b), zi = z + i * 3, w = 0.04 - i * 0.005;
      out.push(du ? { u0: lo, u1: hi, v0: 0.5 - w, v1: 0.5 + w, z0: zi, z1: zi + 2.5, m: limb } : { u0: 0.5 - w, u1: 0.5 + w, v0: lo, v1: hi, z0: zi, z1: zi + 2.5, m: limb });
    }
  };
  limbOut(-1, 0, 15); limbOut(0, -1, 24); // behind the trunk first
  out.push({ cyl: [0.5, 0.5, 0.075], z0: 0, z1: 32, m: limb });
  limbOut(1, 0, 21); limbOut(0, 1, 18);
  for (const [u, w, z, r] of crown) out.push({ blob: [u, w, z + 2], ru: r, rz: 10, m: twigs(snow, 37 + v, 10 * GROWN.tree[0]) });
  return out;
}
function seasonBush(o, v) {
  const a = (hash3(v, 5, 7) - 0.5) * 0.16;
  const parts = [[0.38 + a, 0.42, 6, 0.32, 6], [0.64, 0.56 - a, 5, 0.27, 5], [0.46, 0.7, 4, 0.22, 4]];
  let m = null;
  if (o.sea[0] === "f") { // autumn: the bush's leaves turned, browner than the trees' (FALL's brown and rust most)
    const i = Number(o.sea.slice(1)) % FALL.length, lc = mix(FALL[i], FALL[2], 0.35);
    m = (f, s, t, X, Y) => { const q = n2(X, Y, 19); return q > 0.88 ? mul(lc, 1.3) : q < 0.18 ? mul(lc, 0.6) : mul(lc, 0.88 + q * 0.15); };
  } // winter (m null): bare twigs, snow on their tops
  return parts.map(([u, w, z, ru, rz]) => ({ blob: [u, w, z], ru, rz, m: m || twigs(o.sea === "bs", 43 + z, rz * GROWN.bush[0]) })).sort((p, q) => p.blob[0] + p.blob[1] - q.blob[0] - q.blob[1]);
}
const OUTLINED = new Set(["tree", "boulder", "rock", "car", "truck", "vehicle", "crate", "hay", "pump", "barrel", "well", "barricade", "sandbag", "hivewall",
  "table", "bed", "rack", "locker", "shelf", "cabinet", "counter", "gunsafe", "tanktrap", "spikes", "beartrap", "stairs", "ladder", "tower", "bars", "gate", "palisade",
  "tent", "torn", "lamp", "spot", "firepit", "bush", "stump", "log"]); // props stand out with an outline (the base map's tent, floodlight and fire pit too: sim/basemap.js)
for (const k of Object.keys(FURNITURE_KINDS)) OUTLINED.add(k); // every piece of furniture (sim/data-furniture.js)

// The cells' block sprites by look (sprite, roofSprite, massSprite; null: nothing to draw): a key holds all the picture
// depends on, so one never goes stale. Each entry keeps the frame it was last drawn in (iso.frames); past SPRITES
// entries, those not drawn in this frame or the last are dropped, so the scene on screen stays (rotating the view or a
// long battle used to pass 3,000, clear them all and paint the whole scene again in one frame).
const SPRITES = 6000;
let spriteSweep = SPRITES;
function spriteGet(key) {
  const e = spriteCache.get(key);
  if (e === undefined) return undefined;
  e.used = iso.frames;
  return e.s;
}
function spritePut(key, s) {
  if (spriteCache.size >= spriteSweep) {
    for (const [k, e] of spriteCache) if (e.used < iso.frames - 1) spriteCache.delete(k);
    spriteSweep = Math.max(SPRITES, spriteCache.size + SPRITES / 4); // a scene bigger than the bound: swept again a quarter later, not every sprite
  }
  spriteCache.set(key, { s, used: iso.frames });
}
// A cached sprite for a cell's look.
function sprite(k, o, fog) {
  const key = `${iso.straight ? "s|" : ""}${o.sea ? `${o.sea}|` : ""}${k}|${o.v}|${o.alt}|${o.j}|${o.n}|${o.top}|${o.stub ? 1 : 0}|${o.mat}|${o.dmg}|${o.barred ? 1 : 0}|${o.dir}|${o.part || ""}|${o.vault ? 1 : 0}|${o.roll ? 1 : 0}|${o.lit ? 1 : 0}|${o.spot || 0}|${fog ? 1 : 0}|${o.ter ? `${o.ter.key}${o.f}${o.wet ? `${o.wet}${o.wl}` : ""}${o.snow || ""}${o.gt ? `${o.gnd}${o.lf}` : ""}` : ""}|${o.car ? `${o.car.i},${o.car.j},${o.car.L},${o.car.ax},${o.car.kind},${o.car.v},${o.car.body || ""},${o.car.type || ""},${o.car.mil ? `${o.car.mil.cond}${o.car.mil.enemy ? "e" : ""}` : ""},${o.car.wrecked ? "w" : ""},${upKey(o.car.up)},${iso.rot & 3}` : ""}${o.sn ? `|n${o.sn}` : ""}${o.ie || o.is || o.art ? `|w${o.ie || ""}/${o.is || ""}/${o.art || ""}` : ""}${o.len ? `|st${o.step}/${o.len}${o.rail}${o.well ? "w" : ""}${o.air ? "a" : ""}` : ""}`;
  let s = spriteGet(key);
  if (s === undefined) {
    const car = CAR_CELLS.has(k) ? carModelSprite(k, o, fog) : null; // a car as its model (ui/vehiclemodel.js): this cell's share, or a car on this one cell
    const p = car ? [] : prims(k, o);
    s = car ? toBitmap(car) : p.length ? paint(p, { fog, outline: OUTLINED.has(k) && !(k === "sandbag" && o.j) && !o.ter && !BARE.test(o.sea || "") }) : null; // BARE: a bare tree's twigs outlined would be a black mass // !o.ter: on a hill the outline would trace the ground's column and banks too // joined sandbags: no outline, or each cell's would cross the wall at the join
    iso.builds.sprites++;
    spritePut(key, s);
  }
  return s;
}
// A car's cell drawn from the car's low-poly model (ui/vehiclemodel.js: the State Map's vehicles' look, the user's ask
// 2026-10-25), the car headed along its axis in the view (a yaw in the figures' degrees: the angle in the view's u, v),
// in the diagonal views and the straight one (its own projection there); a car on one cell (no o.car) as the model
// shrunk onto it. Null without a canvas: the prisms then.
const CAR_CELLS = new Set(["car", "truck", "vehicle"]);
function carYaw(ax, r) {
  const d = ax === "y" ? [0, 1] : [1, 0], [u0, v0] = ptView(0, 0, r, 0, 0), [u1, v1] = ptView(d[0], d[1], r, 0, 0);
  return (Math.atan2(v1 - v0, u1 - u0) * 180) / Math.PI;
}
function carModelSprite(k, o, fog) {
  const opt = { fog, sn: o.sn, straight: iso.straight };
  try { return o.car ? vehicleCellSprite(o.car, carYaw(o.car.ax, iso.rot), opt) : vehicleOneSprite(k, (o.v || 0) * 7 + (o.j || 0), o.v & 1 ? "v" : "u", opt); } catch (e) { void e; return null; } // a model that cannot be painted: the prisms
}
// Snow on the buildings (the user's request 2026-10-23: "In raid and base view: Winter has snow on buildings."), by
// the snow lying (ui/roofsnow.js snowOnFor: quarters, 0 none; this frame's snowLook), in the sprites' cache keys only
// (roofSprite's sn and v, o.sn in sprite's), so a frame costs nothing new and no snow changes nothing.
//   - Roofs (roofSnow): a layer of snow over the slab, ROOF_SNOW.DEPTH px deep, in drifts: patchy at a dusting, whole
//     from about half; thinner toward the roof's outside edges (ROOF_SNOW.EDGE px), where the roof shows a little; the
//     lips' tops white, a lip of snow over their outer faces (snowLip). How much a roof holds goes by its pitch (HOLD:
//     tar and concrete flat; corrugated metal a low pitch, its ridges show through; shingles pitched, their courses
//     show, one px of snow at most). v (0..3, from the cell) moves the drifts, so roof cells side by side differ.
//   - Walls, fences, sandbags, tents and the rest out in the open (lookOf: SNOW_ON, no building's inside): snowPrims
//     whitens the tops of their pieces in drifts, a px of snow over the top edge of their sides from half deep, the
//     upper cap of the round ones (rocks, rubble, a torn tent).
const ROOF_SNOW = { HOLD: [1, 0.72, 0.55, 1], EDGE: 4, DEPTH: [1, 1, 2, 2] }; // HOLD by roof material (tar, metal, shingles, concrete); DEPTH by the quarter
const SNOWC = hex("#e7ecf1"), SNOW_SH = hex("#bcc8d4"); // snow; its cool shade in the drifts' hollows
const snowC = (X, Y, k) => mul(SNOWC, 0.93 + n2(X, Y, k) * 0.07);
// Snow's drifts: patches a few px across with a little grain; under `cover` (0..1+) it lies.
const snowQ = (X, Y, k) => (n2(Math.floor(X / 6), Math.floor(Y / 3), k) + n2(Math.floor((X + 3) / 6), Math.floor((Y + 1.5) / 3), k + 5)) * 0.37 + n2(X, Y, k + 1) * 0.26; // two offset grids of patches: softer shapes than one
const snowShade = (X, Y, k) => { const dr = n2(Math.floor(X / 7), Math.floor(Y / 4), k + 4); return dr < 0.2 ? mix(snowC(X, Y, k), SNOW_SH, 0.4) : mul(snowC(X, Y, k), 0.97 + dr * 0.04); };
function roofSnow(mat, z, edges, sn, v) {
  const hold = ROOF_SNOW.HOLD[mat], cover = 0.2 + sn * hold * 1.2, E = ROOF_SNOW.EDGE;
  const dz = hold < 1 ? 1 : ROOF_SNOW.DEPTH[Math.max(0, Math.min(3, Math.round(sn * 4) - 1))];
  const ox = v * 5, oy = v * 3, k = 61 + v;
  const m = (f, s, t, X, Y) => {
    const X2 = X + ox, Y2 = Y + oy;
    if (f !== "top") return n2(X2, Y2, k + 3) < 0.3 + sn * 0.6 ? mul(snowC(X2, Y2, k), 0.92) : null; // its edge, ragged: the roof's slab shows where it is not
    const d = Math.min(edges & 2 ? s : 99, edges & 1 ? 16 - s : 99, edges & 8 ? t : 99, edges & 4 ? 16 - t : 99); // px in from the roof's outside edge
    let q = snowQ(X2, Y2, k);
    if (d < E) q += (1 - d / E) * 0.45 * (1.25 - sn); // thinner toward the edge (less so when deep)
    if (q > cover) return null;
    if (mat === 2 && Math.floor(t) % 3 < 1 && n2(X2, Y2, k + 2) > sn * 1.1) return null; // the shingles' courses
    if (mat === 1 && Math.floor(s) % 3 < 1 && n2(X2, Y2, k + 2) > sn * 1.1) return null; // the metal's ridges
    return snowShade(X2, Y2, k);
  };
  return { u0: 0, u1: 1, v0: 0, v1: 1, z0: z, z1: z + dz, flat: true, m };
}
const snowLip = (lip, sn, v) => (f, s, t, X, Y, a, h) => {
  const X2 = X + v * 5, Y2 = Y + v * 3;
  if (f === "top") return n2(X2, Y2, 67) < 0.25 + sn ? snowC(X2, Y2, 67) : lip;
  return sn >= 0.5 && t >= h - 1 && n2(X2, Y2, 68) < 0.3 + sn * 0.5 ? mul(snowC(X2, Y2, 67), 0.9) : lip;
};
// The pieces of a prop out in the open with snow on them (see above): each piece's top whitened in drifts.
function snowPrims(list, sn) {
  const cover = 0.25 + sn;
  return list.map((p, i) => {
    const m = p.m, k = 71 + i * 3;
    if (!m) return p;
    if (p.blob) { // a round thing: snow on its upper cap, further down the deeper it lies
      const lim = -0.85 + sn * 0.75;
      return { ...p, m: (f, nx, ny, X, Y, a, c) => { const col = m(f, nx, ny, X, Y, a, c); return col && ny < lim + (n2(X, Y, k) - 0.5) * 0.3 ? snowC(X, Y, k) : col; } };
    }
    const h = (p.z1 || 0) - (p.z0 || 0);
    return { ...p, m: (f, s, t, X, Y, a, c) => {
      const col = m(f, s, t, X, Y, a, c);
      if (!col) return col;
      if (f === "top") return snowQ(X, Y, k) < cover ? snowShade(X, Y, k) : col;
      if (!p.cyl && sn >= 0.5 && h >= 3 && t >= h - 1 && n2(X, Y, k + 2) < 0.3 + sn * 0.5) return mul(snowC(X, Y, k), 0.9); // over the top edge
      return col;
    } };
  });
}
// What carries snow out in the open (lookOf: not inside a building, whose roof carries it): the walls and what stands
// in the yard or the street. Not the trees and bushes (ui/seasontrees.js), the ground and its hills, a fire, a well's
// mouth, the hive's warm flesh, furniture, stairs and ladders.
const SNOW_ON = new Set(["wall", "window", "door", "idoor", "boarded", "bdoor", "doorway", "smashed", "odoor", "palisade", "gate", "tower", "stand", "walkway", "roof",
  "fence", "wirefence", "fieldgate", "wire", "rail", "sandbag", "barricade", "tanktrap", "crate", "hay", "barrel", "pump", "car", "truck", "vehicle", "boulder", "rock", "rubble", "breach",
  "tent", "torn", "log", "stump"]);
export const snowProbe = { roofSprite: (...a) => roofSprite(...a), sprite: (...a) => sprite(...a), SNOW_ON }; // tools/roofsnowtest.js
// A roof piece over one cell of a building: a flat slab at the walls' height with a lip on the outside edges. sn: the
// snow lying on it (0 none), v: its drifts' variant (0..3, from the cell).
function roofSprite(mat, top, edges, fog, sn = 0, v = 0) {
  const key = `${iso.straight ? "s|" : ""}roof|${mat}|${top}|${edges}|${fog ? 1 : 0}${sn ? `|n${sn}${v}` : ""}`;
  let s = spriteGet(key);
  if (s === undefined) {
    const base = [PAL.tar, PAL.rust, PAL.shingle, PAL.conc][mat & 3];
    const m = (f, sx, t, X, Y) => {
      if (f !== "top") return mul(base, 0.7);
      if (mat === 1) return mul(base, Math.floor(sx) % 3 < 1 ? 0.78 : 0.95 + n2(X, Y, 3) * 0.12); // corrugated metal
      if (mat === 2) return mul(base, Math.floor(t) % 3 < 1 ? 0.72 : 0.92 + n2(Math.floor(sx / 3), Math.floor(t / 3), 2) * 0.16); // shingles
      return mul(base, 0.88 + n2(X, Y, 3) * 0.22);
    };
    const p = [{ u0: 0, u1: 1, v0: 0, v1: 1, z0: top, z1: top + 3, flat: true, m }];
    if (sn) p.push(roofSnow(mat & 3, top + 3, edges, sn, v)); // snow on it (above)
    const lip = mul(base, 0.8), lm = sn ? snowLip(lip, sn, v) : () => lip;
    if (edges & 2) p.push({ u0: 0, u1: 0.08, v0: 0, v1: 1, z0: top + 3, z1: top + 5, m: lm });
    if (edges & 8) p.push({ u0: 0, u1: 1, v0: 0, v1: 0.08, z0: top + 3, z1: top + 5, m: lm });
    if (edges & 1) p.push({ u0: 0.92, u1: 1, v0: 0, v1: 1, z0: top + 3, z1: top + 5, m: lm });
    if (edges & 4) p.push({ u0: 0, u1: 1, v0: 0.92, v1: 1, z0: top + 3, z1: top + 5, m: lm });
    s = paint(p, { fog });
    iso.builds.sprites++;
    spritePut(key, s);
  }
  return s;
}

// The storeys below the active floor (floorsOf): the building's outer wall mass under one footprint cell, from the
// ground up to the floor's base, no interior. faces: 1 the east (+u) side, 2 the south (+v) side, only where the
// neighbour in that direction is outside the footprint (the faces inside are hidden by the raised floor in front).
// A darker course marks each storey.
function massSprite(mat, lift, faces, fog) {
  const key = `${iso.straight ? "s|" : ""}mass|${mat}|${lift}|${faces}|${fog ? 1 : 0}`;
  let s = spriteGet(key);
  if (s === undefined) {
    const face = wallFace(mat & 3, 0);
    const m = (f, sx, t, X, Y) => {
      if (f === "top" || (f === "east" && !(faces & 1)) || (f === "south" && !(faces & 2))) return null;
      const c = face(f, sx, t, X, Y);
      return t % LV < 1 || t % LV >= LV - 1 ? mul(c, 0.55) : c;
    };
    s = faces ? paint([{ u0: 0, u1: 1, v0: 0, v1: 1, z0: 0, z1: lift, m }], { fog }) : null;
    iso.builds.sprites++;
    spritePut(key, s);
  }
  return s;
}

// ---------- the ground ----------
const FLOORC = {
  grass: hex("#4a5834"), field: hex("#6a6238"), dirt: hex("#5c4f3e"), gravel: hex("#5c5a57"), road: hex("#37393d"), deck: hex("#5e5f5c"),
  floor: hex("#5a4632"), rubble: hex("#4e4842"), roof: hex("#6a6a64"),
  // A building's floors by room (sim/buildingmaps.js c.fl): tiles, concrete, carpet, a barn's dirt.
  tile: hex("#7a7668"), conc: hex("#5e5d5a"), carpet: hex("#4e3e44"), barn: hex("#5e5040"), straw: hex("#8a7440"),
  // The room-appropriate floors of 2026-10-25 (issue #13): kitchens' and wards' lino, a bathroom's checker, a home's
  // hardwood (narrow, warm) and a cabin's or a barn's planks (the old floorboards), a gym's rubber, the bays' steel plate.
  lino: hex("#8a8a76"), checkA: hex("#8e8a80"), checkB: hex("#34322e"), hardwood: hex("#7a5636"), rubber: hex("#3a3c3e"), steel: hex("#6a6e72"),
  // A hotel's grounds (issue #29, sim/hotellayout.js): the pool deck's paving, the empty pool's pale tiles (leaves and
  // a dark puddle at its deep end), a tennis court's green with its white lines.
  paving: hex("#8a8478"), pool: hex("#7aa8b8"), court: hex("#3e6a4e"),
};
// Which way the roads run on a map (the user's request 2026-10-22: "In base view and raids fix road tiles to look
// better"): every road cell painted a lane dash of its own laid a hatching of dashes over the whole asphalt. Now each
// road cell knows its road (roadRuns: the run of road cells through it along x and along y; the long one is the way the
// road goes, the short one its width) and floorColor paints the road as one: a dashed centre line, a faded edge line
// each side, worn shoulders, broad patches of older asphalt; a crossing (both runs long) and a road too wide to read
// are bare asphalt. ax: 0 not a road, 1 along x, 2 along y, 3 a crossing; off: cells from the road's near edge; wid:
// its width in cells.
const ROAD = { MAXW: 12, EDGE: [0.2, 0.3], SHOULDER: 0.2, MID: 0.065, DASH: 3, GAP: 0.5, WORN: 0.18 };
function roadRuns(cells, W, H) {
  const N = W * H, ax = new Uint8Array(N), off = new Uint8Array(N), wid = new Uint8Array(N);
  const hLen = new Uint16Array(N), hAt = new Uint16Array(N), vLen = new Uint16Array(N), vAt = new Uint16Array(N);
  const road = (i) => cells[i] && cells[i].f === "road";
  for (let y = 0; y < H; y++) for (let x = 0; x < W;) {
    if (!road(y * W + x)) { x++; continue; }
    let e = x;
    while (e < W && road(y * W + e)) e++;
    for (let i = x; i < e; i++) { hLen[y * W + i] = e - x; hAt[y * W + i] = x; }
    x = e;
  }
  for (let x = 0; x < W; x++) for (let y = 0; y < H;) {
    if (!road(y * W + x)) { y++; continue; }
    let e = y;
    while (e < H && road(e * W + x)) e++;
    for (let i = y; i < e; i++) { vLen[i * W + x] = e - y; vAt[i * W + x] = y; }
    y = e;
  }
  for (let i = 0; i < N; i++) {
    if (!road(i)) continue;
    const h = hLen[i], v = vLen[i];
    if (h >= v * 2 && v <= ROAD.MAXW) { ax[i] = 1; off[i] = ((i / W) | 0) - vAt[i]; wid[i] = v; }
    else if (v >= h * 2 && h <= ROAD.MAXW) { ax[i] = 2; off[i] = (i % W) - hAt[i]; wid[i] = h; }
    else ax[i] = 3;
  }
  return { ax, off, wid, W };
}
// A road's asphalt at a point: s along the road, a across it (cells from its near edge), w its width; null R (no runs:
// the ground beyond the map, battleedge.js) or a crossing: bare asphalt.
function roadColor(x, y, tx, ty, lx, ly, R) {
  const X = x * 16 + tx, Y = y * 16 + ty, q = hash3(X, Y, 1);
  const i = R ? y * R.W + x : -1, ax = R ? R.ax[i] : 0;
  const s = ax === 2 ? y + ly : x + lx, a = ax === 2 ? R.off[i] + lx : ax === 1 ? R.off[i] + ly : 0, w = ax === 1 || ax === 2 ? R.wid[i] : 0;
  // Broad patches of older and newer asphalt (2 × 2 cells, eased between), fine grit, now and then a crack.
  const patch = hash3(Math.floor((X + 8) / 40), Math.floor((Y + 8) / 40), 4);
  let col = mul(FLOORC.road, 0.9 + patch * 0.12 + q * 0.07);
  if (q > 0.985) col = mul(FLOORC.road, 0.68);
  if (!w) return col;
  const worn = hash3(X >> 1, Y >> 1, 6) < ROAD.WORN; // the paint flaked off here
  if (a < ROAD.SHOULDER || a > w - ROAD.SHOULDER) return mix(col, hex("#55524a"), 0.35 + q * 0.3); // the shoulder: grit and dust
  if (!worn && ((a >= ROAD.EDGE[0] && a < ROAD.EDGE[1]) || (a > w - ROAD.EDGE[1] && a <= w - ROAD.EDGE[0]))) return mix(col, hex("#9a978c"), 0.62); // an edge line
  if (!worn && Math.abs(a - w / 2) < ROAD.MID && (s % ROAD.DASH) / ROAD.DASH < ROAD.GAP) return mix(col, hex("#a8924a"), 0.7); // the dashed centre line
  return col;
}
// A crop plot's wood border (the user's request 2026-10-23: "a small wood border around the 2x2 plot ... when putting a plot
// next to each other remove the wood border between to have the plots merge seamlessly"): per cell, a bit for each side
// with no plot cell beside it (1 north, 2 south, 4 west, 8 east); null when the map has no plots. The border is drawn
// in floorColor on those sides only, so two plots side by side read as one bed.
const PLOT_EDGE = { W: 0.14, WOOD: hex("#a37a45") };
export function plotEdges(cells, w, h) {
  let out = null;
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i].plot) continue;
    out = out || new Uint8Array(w * h);
    const x = i % w, y = (i / w) | 0, no = (xx, yy) => xx < 0 || yy < 0 || xx >= w || yy >= h || !cells[yy * w + xx].plot;
    out[i] = (no(x, y - 1) ? 1 : 0) | (no(x, y + 1) ? 2 : 0) | (no(x - 1, y) ? 4 : 0) | (no(x + 1, y) ? 8 : 0);
  }
  return out;
}
function floorColor(c, k, x, y, lx, ly, mud, R = null, lf = 0, pd = 0, pe = 0) { // lf: autumn's leaves here (ui/groundlook.js leafField); pd: a puddle's depth here (puddleAt); pe: a crop plot's sides with no plot beside it (plotEdges)

  const tx = Math.min(15, Math.floor(lx * 16)), ty = Math.min(15, Math.floor(ly * 16));
  const q = hash3(x * 16 + tx, y * 16 + ty, 1), v = hash3(x, y, 2);
  if (k === "water" && !c.ter) { // a pond's deep middle (c.ter, sim/ponds.js): its ground's floor here, the water drawn at its level (wetPrims)
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
      col = roadColor(x, y, tx, ty, lx, ly, R); // the paint follows the road (roadRuns)
      break;
    }
    case "floor":
      if (c.fl === "tile") col = tx % 8 === 0 || ty % 8 === 0 ? mul(FLOORC.tile, 0.72) : ((tx >> 3) + (ty >> 3)) % 2 ? mul(FLOORC.tile, 0.9 + q * 0.06) : mul(FLOORC.tile, 1.02 + q * 0.06);
      else if (c.fl === "conc") col = q > 0.96 ? mul(FLOORC.conc, 0.75) : mul(FLOORC.conc, 0.9 + q * 0.12 + v * 0.04);
      else if (c.fl === "carpet") col = mul(FLOORC.carpet, 0.86 + q * 0.22);
      else if (c.fl === "dirt") col = q > 0.9 ? FLOORC.straw : mul(FLOORC.barn, 0.88 + q * 0.16);
      else if (c.fl === "lino") col = (tx === 0 && ty % 16 === 0) ? mul(FLOORC.lino, 0.8) : mul(FLOORC.lino, 0.93 + q * 0.05 + (hash3(x * 4 + (tx >> 2), y * 4 + (ty >> 2), 5) > 0.8 ? 0.05 : 0)); // smooth sheet, a faint fleck
      else if (c.fl === "checker") col = ((tx >> 2) + (ty >> 2)) % 2 ? mul(FLOORC.checkA, 0.92 + q * 0.08) : mul(FLOORC.checkB, 0.9 + q * 0.12); // 4 px checks
      else if (c.fl === "hardwood") { const row = ty >> 2, off = hash3(x, y * 4 + row, 8) * 16; col = ty % 4 === 0 ? mul(FLOORC.hardwood, 0.7) : (tx + off) % 16 < 1 ? mul(FLOORC.hardwood, 0.76) : mul(FLOORC.hardwood, 0.9 + hash3(x * 2 + Math.floor((tx + off) / 16), y * 4 + row, 3) * 0.18 + q * 0.04); } // narrow boards, joints staggered
      else if (c.fl === "rubber") col = (tx % 4 === 1 && ty % 4 === 1) ? mul(FLOORC.rubber, 1.25) : mul(FLOORC.rubber, 0.92 + q * 0.08); // studded mats
      else if (c.fl === "steel") col = ((tx + ty) % 6 === 0 && (tx >> 1) % 2 === 0) || ((tx - ty + 16) % 6 === 3 && (tx >> 1) % 2 === 1) ? mul(FLOORC.steel, 1.22) : tx === 0 || ty === 0 ? mul(FLOORC.steel, 0.7) : mul(FLOORC.steel, 0.9 + q * 0.08); // diamond plate
      else col = ty % 4 === 0 ? mul(FLOORC.floor, 0.68) : mul(FLOORC.floor, 0.88 + hash3(x * 4 + Math.floor((tx + (Math.floor(ty / 4) % 2) * 8) / 16), y * 4 + Math.floor(ty / 4), 3) * 0.2);
      break;
    case "rubble": col = q > 0.82 ? mul(FLOORC.rubble, 1.35) : q < 0.1 ? mul(FLOORC.rubble, 0.6) : mul(FLOORC.rubble, 0.92 + v * 0.1); break;
    case "roof": col = mul(FLOORC.roof, 0.86 + q * 0.2); break;
    case "paving": col = tx % 8 === 0 || ty % 8 === 0 ? mul(FLOORC.paving, 0.78) : mul(FLOORC.paving, 0.9 + q * 0.12); break;
    case "pool": col = tx % 4 === 0 || ty % 4 === 0 ? mul(FLOORC.pool, 0.8) : q > 0.94 ? mul(FLOORC.dirt, 1.1) : c.deep && v > 0.5 && q > 0.6 ? mul(FLOORC.road, 0.9) : mul(FLOORC.pool, 0.92 + q * 0.1); break; // c.deep: the deep end, rain standing in it
    case "court": col = c.line && ((c.line & 1 && ty < 2) || (c.line & 2 && ty > 13) || (c.line & 4 && tx < 2) || (c.line & 8 && tx > 13)) ? hex("#d8d8d0") : mul(FLOORC.court, 0.94 + q * 0.08); break; // c.line: the court's white lines on its sides (bits n, s, w, e)
    default: col = mul(FLOORC.grass, 0.92 + q * 0.12);
  }
  if (c.deco) col = decoTexel(col, c.deco, x, y, tx, ty); // rugs, clutter, a light's pool (sim/decor.js)
  if (pe && c.plot) { const W = PLOT_EDGE.W; if (((pe & 1) && ly < W) || ((pe & 2) && ly > 1 - W) || ((pe & 4) && lx < W) || ((pe & 8) && lx > 1 - W)) col = mul(PLOT_EDGE.WOOD, 0.88 + (((tx >> 1) + (ty >> 1)) % 2) * 0.12 + q * 0.08); } // the plot's wood edge: planks
  if (!c.plot && (c.gnd || lf)) col = groundTexel(col, c, x * 16 + tx, y * 16 + ty, lf, Math.min(tx, 15 - tx, ty, 15 - ty) / 7.5); // the season on the ground (ui/groundlook.js); a built plot is the top layer: none on it
  if (pd > 0 && !c.plot) col = puddleTexel(col, c, x * 16 + tx, y * 16 + ty, pd); // rain water standing on it (ui/groundlook.js, sim/puddles.js); not on a plot
  if (mud) { const m = clamp01(mud - hash3(x * 16 + tx, y * 16 + ty, 9) * 0.6); if (m > 0) col = mix(col, q > 0.7 ? hex("#5a1a1c") : hex("#3e2a22"), m * 0.85); }
  return col;
}
// ---------- interior decor (sim/decor.js) ----------
// The floor's decor (c.deco) painted into the ground canvas with the floor (cached with it: no cost a frame): rugs with
// a border on their outer sides, papers, books, glass, trash and tins, clothes, toys, cracked tiles, stains, straw,
// leaves; a light fixture overhead as the pool of light under it (a lamp warm, a strip light cool).
const DECOC = {
  rug: ["#7a3a32", "#3a4a6a", "#5a6a3a", "#7a6036", "#5a3a5a", "#4a5a5a"].map(hex), rugEdge: hex("#c8b890"),
  paper: hex("#d8d4c4"), book: ["#7a2a2a", "#2a4a6a", "#3a5a2a", "#6a5a2a", "#4a2a4a", "#2a2a2a"].map(hex),
  glass: hex("#b8d0d8"), trash: [hex("#6a5a44"), hex("#8a8070"), hex("#4a4038")], tin: hex("#9a9ea2"),
  cloth: ["#5a6a8a", "#8a4a4a", "#c8c0a8", "#3a3a3a", "#6a8a5a", "#8a7a4a"].map(hex), toy: ["#d84a3a", "#e8c040", "#3a8ad8", "#4ab04a"].map(hex),
  crack: hex("#2e2c28"), stain: hex("#6a5a3a"), oil: hex("#141414"), straw: hex("#a88a48"), leaf: ["#8a5a24", "#a8702a", "#6a5228", "#9a8a3a"].map(hex),
  lamp: hex("#fff0c8"), strip: hex("#e8f0ff"),
};
const decoSig = (d) => d.k.charCodeAt(0) * 5 + d.k.charCodeAt(1) + (d.v | 0) * 3 + (d.e | 0) * 7 + (d.lt | 0) * 13;
// A blob's mask: inside a wobbly circle round (cx, cy) of radius r px.
const blobIn = (tx, ty, cx, cy, r, sd) => Math.hypot(tx - cx, ty - cy) < r * (0.8 + 0.3 * hash3(Math.floor(Math.atan2(ty - cy, tx - cx) * 2), sd, 61));
function decoTexel(col, d, x, y, tx, ty) {
  const v = d.v | 0, X = x * 16 + tx, Y = y * 16 + ty, q = hash3(X, Y, 51), r = (i) => hash3(x * 8 + i, y, 52 + v);
  switch (d.k) {
    case "rug": {
      const e = d.e | 0, edge = ((e & 1) && ty < 2) || ((e & 2) && ty > 13) || ((e & 4) && tx < 2) || ((e & 8) && tx > 13);
      const base = DECOC.rug[v % DECOC.rug.length];
      col = edge ? mul(DECOC.rugEdge, 0.7 + q * 0.12) : ((X + Y) % 8 < 1 || (X - Y + 1024) % 8 < 1) ? mul(base, 1.25) : mul(base, 0.88 + q * 0.14); // woven: a diamond lattice
      break;
    }
    case "papers": for (let i = 0; i < 3; i++) { const px = 1 + r(i) * 11, py = 1 + r(i + 3) * 11; if (tx >= px && tx < px + 4 && ty >= py && ty < py + 3) { col = mul(DECOC.paper, 0.85 + q * 0.15); break; } } break;
    case "books": for (let i = 0; i < 2; i++) { const px = 2 + r(i) * 10, py = 2 + r(i + 3) * 10; if (tx >= px && tx < px + 3 && ty >= py && ty < py + 4) { col = mul(DECOC.book[(v + i) % 6], tx < px + 1 ? 0.7 : 0.95); break; } } break;
    case "glass": if (q > 0.86) col = mul(DECOC.glass, 0.8 + q * 0.2); break;
    case "trash": if (q > 0.84) col = mul(DECOC.trash[Math.floor(q * 97) % 3], 0.85 + q * 0.2); else if (blobIn(tx, ty, 4 + r(1) * 8, 4 + r(2) * 8, 2, x + y)) col = DECOC.trash[1]; break;
    case "tins": for (let i = 0; i < 2; i++) { const dd = Math.hypot(tx - (3 + r(i) * 10), ty - (3 + r(i + 3) * 10)); if (dd < 2) { col = mul(DECOC.tin, dd < 1 ? 0.75 : 1.05); break; } } break;
    case "clothes": if (blobIn(tx, ty, 5 + r(1) * 6, 5 + r(2) * 6, 4, x * 3 + y)) col = mul(DECOC.cloth[v % 6], 0.8 + (((tx + ty) >> 1) % 2) * 0.12 + q * 0.06); break;
    case "toys": for (let i = 0; i < 3; i++) { const px = 2 + r(i) * 11, py = 2 + r(i + 3) * 11; if (tx >= px && tx < px + 2 && ty >= py && ty < py + 2) { col = DECOC.toy[(v + i) % 4]; break; } } break;
    case "crack": { const a = 4 + r(1) * 8, run = Math.abs(ty - (a + (tx - 8) * (r(2) - 0.5) + Math.sin(tx * 1.3 + v) * 1.2)); if (run < 0.6) col = mul(DECOC.crack, 1 + q * 0.3); break; }
    case "stain": if (blobIn(tx, ty, 8, 8, 6, x + y * 3)) col = mix(col, DECOC.stain, 0.35); break;
    case "oil": if (blobIn(tx, ty, 7 + r(1) * 2, 7 + r(2) * 2, 5.5, x * 5 + y)) col = mix(col, DECOC.oil, 0.65 + q * 0.1); break;
    case "straw": if (hash3(X >> 2, Y, 53) > 0.55 || q > 0.8) col = mul(DECOC.straw, 0.82 + q * 0.25); break;
    case "leaves": if (hash3(X >> 1, Y >> 1, 54) > 0.72) col = mul(DECOC.leaf[Math.floor(hash3(X >> 1, Y >> 1, 55) * 4)], 0.85 + q * 0.2); break;
  }
  if (d.lt) { const dd = Math.hypot(tx - 7.5, ty - 7.5) / 8; if (dd < 1) col = mix(col, d.lt === 2 ? DECOC.strip : DECOC.lamp, 0.13 * (1 - dd)); } // the light's pool under the fixture
  return col;
}
// The inside faces of the walls (c.wc on the room's cells, sim/decor.js): painted in the room's colour, a skirting
// board along the foot, grime low down; wall art (c.wart) on the face toward its room, at eye height.
const wcCache = new Map();
const wcRgb = (h) => { let c = wcCache.get(h); if (!c) wcCache.set(h, (c = mul(hex(h), 0.74))); return c; }; // dimmed to the battle view's palette
const innerFace = (wc) => (f, s, t, X, Y) => (t < 2 ? mul(PAL.woodDk, 0.95 + n2(X, Y, 3) * 0.1) : mul(wcRgb(wc), 0.92 + n2(X, Y, 5) * 0.08 - (t < 7 ? 0.08 * (1 - t / 7) : 0)));
const WARTC = { frame: hex("#4a3424"), sky: hex("#7a98a8"), hill: hex("#5a6a3a"), white: hex("#e0e0d8"), rim: hex("#2a2a2a"), mirror: hex("#a8b8c0"), cork: hex("#8a6a44"), poster: ["#c8402f", "#3a6fb0", "#e8c04a", "#5a3a7a"].map(hex), shelf: hex("#6a4a2e"), knick: ["#b0a080", "#7a8a9a", "#9a5a4a"].map(hex), sign: hex("#2f6a4a") };
function wartTexel(k, s, t, sw, v) {
  const m = sw / 2; // the middle of the face
  switch (k) {
    case "painting": if (Math.abs(s - m) < 5 && t >= 13 && t < 24) return Math.abs(s - m) >= 4 || t < 14 || t >= 23 ? FURNC.gold : t < 18.5 - Math.sin(s * 0.8) ? mul(WARTC.sky, 0.9 + (s % 3) * 0.05) : t < 20 ? WARTC.hill : mul(WARTC.hill, 0.75); return null; // the catalogue's painting (sim/data-furniture.js): gilt-framed, bigger
    case "wallclock": return wartTexel("clock", s, t, sw, v); // the catalogue's wall clock: a clock's face
    case "picture": if (Math.abs(s - m) < 4 && t >= 15 && t < 23) return Math.abs(s - m) >= 3 || t < 16 || t >= 22 ? WARTC.frame : t < 19 - Math.sin(s) * 0.8 ? WARTC.sky : WARTC.hill; return null;
    case "clock": { const dd = Math.hypot(s - m, t - 21); if (dd < 3) return dd >= 2.2 ? WARTC.rim : (Math.abs(s - m) < 0.6 && t >= 21 && t < 23) || (Math.abs(t - 21) < 0.6 && s >= m && s < m + 1.6) ? WARTC.rim : WARTC.white; return null; }
    case "mirror": if (Math.abs(s - m) < 3 && t >= 13 && t < 26) return Math.abs(s - m) >= 2.4 || t < 14 || t >= 25 ? WARTC.frame : mul(WARTC.mirror, 0.9 + ((s + t) % 5) * 0.03); return null;
    case "whiteboard": if (Math.abs(s - m) < 6 && t >= 14 && t < 23) return Math.abs(s - m) >= 5.4 || t < 14.6 || t >= 22.4 ? PAL.metalDk : (t | 0) % 3 === 0 && (s | 0) % 4 < 2 && Math.abs(s - m) < 4 ? WARTC.poster[1 + ((t | 0) % 2)] : WARTC.white; return null;
    case "poster": if (Math.abs(s - m) < 3 && t >= 14 && t < 24) return t >= 21 ? WARTC.white : mul(WARTC.poster[v % 4], 0.85 + ((t | 0) % 3) * 0.06); return null;
    case "crucifix": if ((Math.abs(s - m) < 0.8 && t >= 14 && t < 26) || (Math.abs(t - 22) < 0.8 && Math.abs(s - m) < 3)) return WARTC.frame; return null;
    case "notice": if (Math.abs(s - m) < 5 && t >= 14 && t < 23) { if (Math.abs(s - m) >= 4.4 || t < 14.6 || t >= 22.4) return WARTC.frame; const cell = Math.floor((s - m + 5) / 3) * 3 + Math.floor((t - 14) / 3); return hash3(cell, v, 71) > 0.5 && (s | 0) % 3 && (t | 0) % 3 ? (hash3(cell, v, 72) > 0.7 ? WARTC.poster[2] : WARTC.white) : WARTC.cork; } return null;
    case "sign": if (Math.abs(s - m) < 6 && t >= 22 && t < 26) { if (Math.abs(s - m) >= 5.4 || t < 22.5 || t >= 25.5) return WARTC.white; return (s | 0) % 3 && t >= 23.4 && t < 24.6 && Math.abs(s - m) < 4 ? WARTC.white : WARTC.sign; } return null; // a hospital's corridor sign (sim/decor.js MED_ART): white letters on green
    case "shelf": if (Math.abs(s - m) < 6 && t >= 19 && t < 20.5) return WARTC.shelf; if (Math.abs(s - m) < 5.5 && t >= 20.5 && t < 23.5) { const i = Math.floor((s - m + 6) / 2.4); return hash3(i, v, 73) > 0.4 ? WARTC.knick[i % 3] : null; } return null;
  }
  return null;
}
// The whole map's ground at art resolution (one canvas; the view origin's top vertex at (Hv × 16, 0); in a straight
// view the origin at (0, 0): ox, the art x of its left edge).
// Kept for a few floors and views (groundCaches: the key as the one-slot cache had, the view and the floor's ground
// key, of this battle only), so going up and down the storeys does not paint each floor again (76-250 ms a switch).
function groundFor(b, scene) {
  const r = iso.rot, st = iso.straight, key = `${viewKey()}:${groundKeyOf(b, scene)}`;
  const hit = groundCaches.get(key);
  if (hit && hit.b === b) { groundCaches.delete(key); groundCaches.set(key, hit); return hit; }
  for (const [k, g] of groundCaches) if (g.b !== b) groundCaches.delete(k);
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
  const lfF = leafField(b, treeLook, scene.key, groundCells(b)); // autumn's leaves (ui/groundlook.js)
  const pF = puddleField(b, puddleGround, groundCells(b)); // puddles after rain (ui/groundlook.js, sim/puddles.js)
  for (const [cells, up, dim, footOnly] of passes) for (let py = 0, R = roadRuns(cells, b.w, b.h), PE = plotEdges(cells, b.w, b.h); py < gh; py++) for (let px = 0; px < gw; px++) {
    const [u, v] = artUV(px + 0.5 + ox, py + 0.5 - lift + up, st);
    if (u < 0 || v < 0 || u >= Wv || v >= Hv) continue;
    const iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
    const [x, y] = fromView(iu, iv, r, b.w, b.h);
    const [lx, ly] = ptWorld(fu, fv, r, 1, 1);
    const c = cells[y * b.w + x];
    if (footOnly && isVoid(c)) continue;
    const pd = pF && !up && pF.ok[y * b.w + x] ? puddleAt(pF, x, y, lx, ly) : 0;
    let col = floorColor(c, c.k, x, y, lx, ly, mud[y * b.w + x], R, lfF && !up ? lfF[y * b.w + x] : 0, pd, PE ? PE[y * b.w + x] : 0);
    if (fu < 0.055 || fv < 0.055) col = mul(col, 0.86); // the grid, faintly
    if (dim < 1) col = mul(col, dim);
    const i = (py * gw + px) * 4;
    buf[i] = col[0]; buf[i + 1] = col[1]; buf[i + 2] = col[2]; buf[i + 3] = 255;
  }
  const cv = mkCanvas(gw, gh), c = cv.getContext("2d"), img = c.createImageData(gw, gh);
  img.data.set(buf);
  c.putImageData(img, 0, 0);
  const g = toBitmap({ b, key, cv, gw, gh, Hv, ox, oy: lift });
  groundCaches.delete(key);
  groundCaches.set(key, g);
  while (groundCaches.size > GROUNDS) groundCaches.delete(groundCaches.keys().next().value);
  iso.builds.ground++;
  return g;
}
// The ground on one storey (no floor raised), painted once per battle in map space: 16 × 16 texels a tile, the
// texels floorColor works in, so the colours are the same; drawIso stretches it onto the diamonds with one affine
// transform for the view's rotation (groundXform). Half the pixels of the view-space picture and no repaint when the
// view turns (groundFor took about 300 ms on a 72 × 72 fort, at the open and on every turn of the view).
const TEX = 16;
// The ground's pictures' key: the cells' floors (sceneFor groundKey) and the season on them (ui/groundlook.js: the
// mud or snow, sim/seasonground.js b.ground; autumn's leaves by the look).
const groundKeyOf = (b, scene) => `${scene.groundKey}:${groundLookKey(b, treeLook)}`;
// The skirt's colours (battleedge.js skirtFor: the edge cells' floors running on past the map): the map's snow on it,
// autumn's leaves at their open-ground density; with neither, floorColor itself. Made again only for a new look.
const SKIRT_SNOW = new Set(["grass", "field", "dirt", "gravel", "road", "rubble"]);
let skirtFn = { b: null, key: "", fn: floorColor };
function skirtColor(b) {
  const snow = b.ground && b.ground.snow ? b.ground.snow : 0, lf = leafBase(treeLook);
  if (!snow && !lf) return floorColor;
  const key = `${snow}|${lf}`;
  if (skirtFn.b === b && skirtFn.key === key) return skirtFn.fn;
  const snowy = new WeakMap(); // a skirt tile's ground (one object a tile) with the snow on it
  const onIt = (g) => { let o = snowy.get(g); if (!o) snowy.set(g, (o = { ...g, gnd: "snow", sd: snow })); return o; };
  const fn = (g, k, x, y, lx, ly, m) => floorColor(snow && k !== "water" && SKIRT_SNOW.has(g.f) ? onIt(g) : g, k, x, y, lx, ly, m, null, lf);
  skirtFn = { b, key, fn };
  return fn;
}
function flatGroundFor(b, scene) {
  const key = groundKeyOf(b, scene);
  if (flatGroundCache && flatGroundCache.b === b && flatGroundCache.key === key) return flatGroundCache;
  const tw = b.w * TEX, th = b.h * TEX;
  const mud = new Float32Array(b.w * b.h);
  for (let i = 0; i < b.cells.length; i++) if (b.cells[i].k === "hivewall") {
    const x = i % b.w, y = (i / b.w) | 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < b.w && ny < b.h) mud[ny * b.w + nx] = Math.max(mud[ny * b.w + nx], 1 - Math.hypot(dx, dy) / 3); }
  }
  const R = roadRuns(b.cells, b.w, b.h); // which way the roads run (the paint follows them)
  const PE = plotEdges(b.cells, b.w, b.h); // the crop plots' wood edges
  const lfF = leafField(b, treeLook, scene.key, groundCells(b)); // autumn's leaves (ui/groundlook.js)
  const pF = b.cells === groundCells(b) ? puddleField(b, puddleGround) : null; // puddles after rain (ui/groundlook.js, sim/puddles.js)
  const cv = mkCanvas(tw, th), c = cv.getContext("2d"), img = c.createImageData(tw, th), buf = img.data;
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const cell = b.cells[y * b.w + x], m = mud[y * b.w + x], lf = lfF ? lfF[y * b.w + x] : 0, wet = pF && pF.ok[y * b.w + x];
    for (let ty = 0; ty < TEX; ty++) for (let tx = 0; tx < TEX; tx++) {
      const lx = (tx + 0.5) / TEX, ly = (ty + 0.5) / TEX;
      let col = floorColor(cell, cell.k, x, y, lx, ly, m, R, lf, wet ? puddleAt(pF, x, y, lx, ly) : 0, PE ? PE[y * b.w + x] : 0);
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
    else { c.moveTo(x, y); c.lineTo(x + HW, y + HH); c.lineTo(x, y + 2 * HH); c.lineTo(x - HW, y + HH); } // filled: no closePath (diamond)
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
// The high ground's look (prims "rise", "slope"): the band its open sides fall away across, how far down the bank goes
// at the cell's edge (a share of the height), and the slices a bank or a ramp is drawn in (smooth at this scale).
const RISE = { BANK: 0.44, FOOT: 0.1, SLICES: 7 };
// A slope drawn in thin slices: each slice's faces lit as a top is (the painter shades a south face LIGHT.south and an
// east face LIGHT.east), so the slices read as one smooth surface, not a flight of steps.
// Half way: the faces of a terrain bank keep some of their shade (a slope away from the light reads darker).
const halfLit = (m) => (f, s, t, X, Y, a, c) => { const col = m(f, s, t, X, Y, a, c); return !col || f === "top" ? col : mul(col, (1 + LIGHT.top / (f === "east" ? LIGHT.east : LIGHT.south)) / 2); };
const rampLit = (m) => (f, s, t, X, Y, a, c) => { const col = m(f, s, t, X, Y, a, c); return !col || f === "top" ? col : mul(col, LIGHT.top / (f === "east" ? LIGHT.east : LIGHT.south)); };
const JOINS = {
  wall: WALLISH, window: WALLISH, door: WALLISH, bdoor: WALLISH, doorway: WALLISH, smashed: WALLISH, idoor: WALLISH, odoor: WALLISH, boarded: WALLISH,
  rack: new Set(["rack", "shelf"]), bed: new Set(["bed"]), bars: new Set(["bars", "wall", "idoor", "odoor"]), table: new Set(["table"]),
  palisade: new Set(["palisade", "gate", "breach", "siegeladder"]), gate: new Set(["palisade", "gate", "breach", "siegeladder"]),
  fence: new Set(["fence", "fieldgate"]), fieldgate: new Set(["fence", "wirefence", "fieldgate"]), wirefence: new Set(["wirefence", "fieldgate"]), wire: new Set(["wire"]), rail: new Set(["rail"]), sandbag: new Set(["sandbag", "barricade"]), barricade: new Set(["barricade", "sandbag"]),
  walkway: new Set(["walkway", "tower", "stand"]), stand: new Set(["stand", "walkway", "tower"]), trench: new Set(["trench"]), shelf: WALLISH, locker: WALLISH, cabinet: WALLISH, counter: WALLISH,
  rise: new Set(["rise", "slope"]), // high ground: its banks fall away on the sides with none beside it (prims rise)
  crag: new Set(["crag"]), // a mountain's ridge: one mass of rock (prims crag)
  outline: new Set(["outline"]), // the base map: a building's outline joins along its sides (sim/basemap.js)
  tent: new Set(["tent"]), log: new Set(["log"]), // a camp's 2 × 1 ridge tent, a fallen log two cells long (sim/basemap.js, basescatter.js)
};
// The catalogue's pieces (sim/data-furniture.js): one bigger than a cell joins with its own kind (a sofa, a bathtub, a
// pew run on along their length), one against a wall with the walls too; the old kinds keep their own joins above.
for (const [k, d] of Object.entries(FURNITURE_KINDS)) {
  if (JOINS[k]) continue;
  const big = d.size[0] * d.size[1] > 1;
  if (d.wall || big) JOINS[k] = new Set([...(d.wall ? WALLISH : []), ...(big ? [k] : [])]);
}
// What a cell looks like in this view: its kind and options (see prims), or null for open ground. focus: on a building's
// own map (sim/buildingmaps.js) the cutaway lowers only the walls within CUT_R tiles of these points (your people, the
// mouse, enemies you see), so the rest of a big building keeps its walls standing.
const CUT_R = 6;
// The ground's level at a cell (sim/combat.js c.h with c.ter; 0 level ground; a raised floor or a wall: 0, it is not the
// ground's), and the look under the cell: null when it and everything round it is level ground.
const groundLv = (c) => (c && c.k === "crag" ? c.ch || 3 : c && c.ter ? c.h || 0 : (c && c.gh) || 0); // a mountain's rock: its own height (sim/basescatter.js reliefLayer); gh: the hill under a loft, a wall stand, a watchtower (sim/basemap.js groundBuilt)
// Past the map's edge: the land beyond (beyondBoard) where a base map has it, else level ground (a hill the edge cuts
// banks down to it there).
function terrainOf(b, x, y) {
  const c = b.cells[y * b.w + x], e = groundLv(c), r = iso.rot;
  const at = (nx, ny) => (nx >= 0 && ny >= 0 && nx < b.w && ny < b.h ? groundLv(b.cells[ny * b.w + nx]) : offLv(b, nx, ny));
  let bottom = e;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) bottom = Math.min(bottom, at(x + dx, y + dy));
  if (!e && bottom === 0) return null;
  const falls = [e, e, e, e];
  VD.forEach(([dx, dy]) => { falls[viewDir(dx, dy, r)] = at(x + dx, y + dy); });
  // A mountain's rock: its neighbours' heights all round in view space (g[v + 1][u + 1]: the surface runs through them).
  let g = null;
  if (c.k === "crag") {
    g = [[e, e, e], [e, e, e], [e, e, e]];
    const [o0, o1] = toView(0, 0, r, 1, 1);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= b.w || ny >= b.h) continue;
      const [a, q] = toView(dx, dy, r, 1, 1);
      g[Math.sign(q - o1) + 1][Math.sign(a - o0) + 1] = groundLv(b.cells[ny * b.w + nx]);
    }
  }
  return { e, bottom, falls, g, key: `${e}${bottom}${falls.join("")}${g ? g.flat().join("") : ""}` };
}
// ---------- the land past the edge ----------
// The user's request 2026-10-23: "The outer margin of the base should not just terminate a terrain it should continue
// the terrain so it does not just terminate at the border". A base map's land runs on past its edge (sim/basescatter.js
// landBeyond: F.beyond, BEYOND_R cells all round): a board that much bigger, the map's own cells in its middle and the
// land's round them, so the looks of the cells outside (lookOf on the board: a hill's banks against the map's ground,
// trees, rocks, the crag) are worked out as the map's are; drawn in the painter's pass at their depth, fading with the
// distance from the map into the skirt's fog (battleedge.js). Scenery only: no hover, no clicks.
const beyondBoards = new WeakMap();
function beyondBoard(b) {
  const F = b.deployPlan && b.deployPlan.fort, BY = F && F.beyond;
  if (!BY || !BY.cells || !BY.cells.length || floorsOf(b)) return null;
  let bd = beyondBoards.get(BY);
  if (bd && bd.b === b && bd.cells0 === b.cells) return bd;
  const R = BY.R, w = b.w + 2 * R, h = b.h + 2 * R, OPEN = { k: "open" }, cells = new Array(w * h).fill(OPEN);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) cells[(y + R) * w + x + R] = b.cells[y * b.w + x];
  for (const [x, y, k, f, hh, ch] of BY.cells) { const c = { k, f: f || "" }; if (hh) { c.h = hh; c.ter = 1; } if (ch) c.ch = ch; cells[(y + R) * w + x + R] = c; }
  bd = { b, cells0: b.cells, R, board: { w, h, cells, snowLie: 0 }, scene: { comp: new Int16Array(w * h).fill(-1), blds: [] }, list: BY.cells, looks: null, key: "" };
  beyondBoards.set(BY, bd);
  return bd;
}
// A sprite drawn into the fog: solid (a see-through tree reads as a ghost), its colours a share t of the way to the
// fog's (FOG_STEPS of them, each made once a sprite and a fog colour).
const FOG_STEPS = 6, fogTints = new WeakMap();
function fogTinted(spr, fogC, t) {
  if (t <= 0) return spr.cv;
  let m = fogTints.get(spr);
  if (!m) { m = new Map(); fogTints.set(spr, m); }
  const key = `${fogC.join(",")}|${t}`;
  let cv = m.get(key);
  if (!cv) {
    cv = mkCanvas(spr.cv.width, spr.cv.height);
    const c = cv.getContext("2d");
    c.drawImage(spr.cv, 0, 0);
    c.globalCompositeOperation = "source-atop";
    c.fillStyle = fogCss(fogC, t);
    c.fillRect(0, 0, cv.width, cv.height);
    m.set(key, cv);
  }
  return cv;
}
// The ground's level at (x, y) off the map (map coordinates): the land beyond, else level ground.
function offLv(b, x, y) {
  const bd = beyondBoard(b);
  if (!bd) return 0;
  const X = x + bd.R, Y = y + bd.R;
  return X < 0 || Y < 0 || X >= bd.board.w || Y >= bd.board.h ? 0 : groundLv(bd.board.cells[Y * bd.board.w + X]);
}
// The outside cells' looks ({ x, y, L } in map coordinates), again when the view turns or the season changes.
function beyondLooks(b, bd) {
  const key = `${viewKey()}:${treeLook}:${snowLook}:${b.snowLie || 0}`;
  if (bd.looks && bd.key === key) return bd.looks;
  const keep = leafNow;
  leafNow = null; // the autumn leaves are the map's, by its cells
  bd.board.snowLie = b.snowLie || 0;
  const out = [];
  try {
    for (const [x, y] of bd.list) {
      const L = lookOf(bd.board, bd.scene, x + bd.R, y + bd.R, null);
      if (L) out.push({ x, y, L: { k: L.k, o: L.o, top: blockTop(L.k, L.o), spr: [undefined, undefined], fspr: [undefined, undefined] } });
    }
  } finally { leafNow = keep; }
  bd.looks = out; bd.key = key;
  return out;
}
function lookOf(b, scene, x, y, cut, focus = null) {
  const i = y * b.w + x, c = b.cells[i], k = c.k === "siegeladder" ? "palisade" : c.k; // a siege ladder leans on its wall (drawn on top: drawSiegeIso)
  if ((k === "water" && !c.ter) || k === "void") return null; // void: outside the footprint on an upper floor; a pond's water is drawn at its level (wetPrims)
  const ter = terrainOf(b, x, y); // the ground's height here (a hill, a hollow, a rim): drawn under the cell's own look
  if (k === "open" && !ter) return null;
  const r = iso.rot, o = { v: Math.floor(hash3(x, y, 17) * 4), alt: hash3(x, y, 99) < 0.35 ? 1 : 0, j: 0, n: null, top: WALL1, mat: 0, dmg: 0, dir: null, ter, f: ter ? c.f || "" : "", wet: ter && c.wet ? c.wet : "", wl: c.wl || 0, snow: ter ? b.snowLie || 0 : 0 }; // wet, wl: a hollow's pond, mud or ice (sim/ponds.js); snow: the snow lying
  if (ter && (c.gnd || (leafNow && leafNow[i]))) { o.gnd = c.gnd || ""; o.lf = leafNow ? Math.round(leafNow[i] * 4) / 4 : 0; o.gt = { gnd: o.gnd, sd: c.sd || 0, f: c.f, wet: c.wet }; } // the season on a hill's ground (ui/groundlook.js; sprite key: gnd, lf)
  if (k === "tree" || k === "bush") { const sea = styleKey(treeStyle(treeLook, x, y)); if (sea) o.sea = sea; } // the season's look (ui/seasontrees.js)
  const js = JOINS[k];
  if (js) for (const [dx, dy] of VD) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= b.w || ny >= b.h) continue;
    if (js.has(b.cells[ny * b.w + nx].k)) o.j |= 1 << viewDir(dx, dy, r);
    if (k === "fieldgate" && FIELD_FENCE.has(b.cells[ny * b.w + nx].k)) o.dir = (o.dir || 0) | (1 << viewDir(dx, dy, r)); // a field gate's posts: where it meets the fence (prims)
  }
  const bid = scene.comp[i];
  if (bid >= 0) {
    const B = scene.blds[bid];
    o.top = B.top; o.mat = B.mat;
    if (WALLISH.has(k) || WALL_FURN.has(k)) {
      // The axis to the inside: the side with the building's floor.
      for (const [dx, dy] of VD) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= b.w || ny >= b.h) continue;
        const j = ny * b.w + nx;
        if (scene.comp[j] === bid && FLOORED.has(b.cells[j].k)) { const d = viewDir(dx, dy, r); o.n = d < 2 ? "u" : "v"; break; }
      }
      if (WALL_FURN.has(k)) o.n = o.n === "u" ? "v" : o.n === "v" ? "u" : null; // furniture runs along the wall it stands by (sim/data-furniture.js wall)
    }
    // The inside faces toward the camera (+u: east, +v: south) in the colour of the room beyond them (c.wc), and the
    // wall art on the face toward its room (c.wart; sim/decor.js). The outside keeps the building's colour.
    if (k === "wall") for (const [dx, dy] of VD) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= b.w || ny >= b.h) continue;
      const d = viewDir(dx, dy, r), face = d === 0 ? "e" : d === 2 ? "s" : null;
      if (!face) continue;
      const nc = b.cells[ny * b.w + nx];
      if (nc.wc && scene.comp[ny * b.w + nx] === bid) o[face === "e" ? "ie" : "is"] = nc.wc;
      if (c.wart && VD[c.wart.d] && VD[c.wart.d][0] === dx && VD[c.wart.d][1] === dy) o.art = `${face}${c.wart.k}`;
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
  if ((k === "palisade" || k === "gate") && c.wm) o.mat = c.wm; // a wall piece's material (sim/basemap.js)
  if (k === "door") { const d = ((b.raid ? b.raid.doors : b.doors) || []).find((q) => q.x === x && q.y === y); o.vault = !!(d && d.lock && d.lock.kind === "vault"); } // a raid's, a field map's houses' (sim/combat.js b.doors)
  if (c.roll) o.roll = true; // a roller door (sim/buildingmaps.js)
  if (k === "firepit" && c.lit) o.lit = true; // a fire pit burning (its flames: prims)
  if (c.spot) o.spot = c.spotBroken ? 2 : 1; // a mounted spotlight, on the ground or up on a wall stand (sim/basemap.js)
  if (c.h - (c.gh || 0) > 0 && FURNITURE.has(k) && !c.ter) o.raise = (c.h - (c.gh || 0)) * LV; // furniture on an upper floor (on a hill: raised with the ground, prims)
  if (k === "stairs" && c.dir != null && c.len > 1) {
    // A step of a stair run (sim/buildingmaps.js STAIR_DIRS): c.step of c.len, rising the run's way (c.dir) to the floor
    // above at its top step; a railing on each open side across the run (o.rail: view directions), none against a wall;
    // on the top floor (nothing above) the run is the stairwell's opening down (o.well).
    const [wx, wy] = VD[c.dir];
    o.dir = viewDir(wx, wy, r); o.step = c.step; o.len = c.len;
    if (c.openair) o.air = true;
    o.rail = 0;
    for (const [dx, dy] of wx ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= b.w || ny >= b.h) continue;
      const nk = b.cells[ny * b.w + nx].k;
      if (!WALLISH.has(nk) && nk !== "stairs" && nk !== "window" && nk !== "smashed" && nk !== "void") o.rail |= 1 << viewDir(dx, dy, r);
      else if (nk === "void") o.rail |= 1 << viewDir(dx, dy, r); // an outside stair over open air
    }
    if (floorsOf(b) && floorNo(b) === b.floors.length - 1) o.well = true;
  } else if (k === "ladder" || k === "stairs" || k === "slope") {
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
  if (snowLook && SNOW_ON.has(k) && bid < 0 && !(c.h > 0 && FURNITURE.has(k))) o.sn = snowLook; // snow on it out in the open (snowPrims; a building's roof carries its own: roofSprite)
  if (c.car && (k === "car" || k === "truck" || k === "vehicle")) o.car = c.car; // one piece of a 2 × 3–4 cell car (sim/combat.js placeCar): carPieces draws its share
  else if (k === "car" || k === "truck" || k === "vehicle") {
    // Cars lie along the road, or as their dice say; the axis turns with the view.
    const roadX = (x > 0 && b.cells[i - 1].f === "road") || (x < b.w - 1 && b.cells[i + 1].f === "road");
    const worldAxis = c.f === "road" || roadX ? (hash3(x, y, 5) < 0.85 ? 0 : 1) : (o.v & 1);
    o.v = (o.v & 2) | (((worldAxis === 0) === ((r & 1) === 0)) ? 0 : 1);
  }
  return { k, o };
}
// Farmland's field fences (sim/basescatter.js fieldLayer) and where they run off the map (the user's word 2026-10-23:
// "Show it going off the map and not just terminating"; "Fill in the gap"): a fence line that meets the map's edge (its
// edge cell and the one in from it: a field's fence runs right out to the edge, sim/basescatter.js layLand) goes on
// straight out across the skirt (ui/battleedge.js) into the fog, fading with it. Scenery only, like the skirt: nothing in the sim
// knows of it. [{ x, y (outside the map), k, dx, dy (the way out), t (tiles out from the edge) }].
const FIELD_FENCE = new Set(["fence", "wirefence"]);
export function offEdgeFences(b, K = skirtTiles()) {
  const out = [];
  if (!K || b.w < 4 || b.h < 4) return out;
  const at = (x, y) => b.cells[y * b.w + x].k;
  const side = (n, cell, dx, dy) => {
    for (let a = 1; a < n - 1; a++) {
      const [x0, y0] = cell(a, 0), k = at(x0, y0), [x1, y1] = cell(a, 1);
      if (!FIELD_FENCE.has(k) || at(x1, y1) !== k) continue;
      for (let t = 1; t <= K; t++) out.push({ x: x0 + dx * t, y: y0 + dy * t, k, dx, dy, t });
    }
  };
  side(b.w, (a, i) => [a, i], 0, -1);
  side(b.w, (a, i) => [a, b.h - 1 - i], 0, 1);
  side(b.h, (a, i) => [i, a], -1, 0);
  side(b.h, (a, i) => [b.w - 1 - i, a], 1, 0);
  return out;
}
const SPLIT = new Set(["bdoor", "doorway", "smashed", "gate", "tower", "odoor"]); // drawn in two parts around who stands there
// How tall a cell's block stands (art px), for picking and fading.
function blockTop(k, o) {
  return blockTop0(k, o) * (GROWN[k] ? GROWN[k][0] : 1) + (o.raise || 0) + (o.ter ? Math.max(0, o.ter.e) * LV : 0);
}
function blockTop0(k, o) {
  switch (k) {
    case "wall": case "window": case "door": case "bdoor": case "doorway": case "smashed": case "idoor": case "odoor": case "boarded": return o.stub ? STUB : o.top;
    case "rack": return 31; case "table": return 11; case "bed": return 8; case "bars": return o.stub ? STUB : 28;
    case "palisade": case "gate": return PALISADE;
    case "tower": return 2 * LV + 7;
    case "walkway": case "loft": case "roof": case "stand": return LV;
    case "stairs": if (o.len) return o.well ? 12 : Math.round((o.step / o.len) * LV); return LV / 2; // a run's step: its height up the storey
    case "slope": return LV / 2;
    case "rise": return LV;
    case "crag": return o.ter ? 0 : 3 * LV + 4; // with its height (o.ter): counted below
    case "ladder": return LV;
    case "tree": return o.v === 3 && o.alt ? 30 : 40;
    case "hivewall": return 30;
    // Head high (VEH_TOP, carPieces): a car's cabin cells at the roof, its hood and trunk lower.
    case "truck": return VEH_TOP;
    case "car": return o.car ? (o.car.i > 0 && o.car.i < o.car.L - 1 ? VEH_TOP : Math.round(9 * vehZ(VEH_ROOF.car))) : VEH_TOP; // a multi-cell car: its cabin cells stand taller than the hood and the trunk
    case "vehicle": return o.car ? (o.car.body === "bike" ? 11 : o.car.body === "truck" || MIL_TOPS[o.car.body] ? VEH_TOP : o.car.i > 0 && o.car.i < o.car.L - 1 ? VEH_TOP : Math.round(9 * vehZ(VEH_ROOF.car))) : VEH_TOP;
    case "locker": return 26; case "shelf": return 24; case "pump": return 22; case "gunsafe": return 22;
    case "boulder": return STONE.H.tall[1]; case "crate": return o.v >= 2 ? 22 : 13;
    case "fence": return 14; case "fieldgate": return 13; case "wirefence": return 13; case "barricade": return 16; case "sandbag": return 13; case "hay": return 13; case "cabinet": return 14; case "counter": return 12; case "well": return 12; case "barrel": return 13;
    case "rock": return STONE.H.short[1]; case "wire": return 10; case "rail": return 13; case "tanktrap": return 12;
    case "outline": return 9; case "tent": return 18; case "torn": return 5; case "firepit": return 7; case "lamp": return 38; case "spot": return 24; // the base map (sim/basemap.js; torn: sim/softcover.js)
    case "bush": return 12; case "stump": return 6; case "log": return 7; // its scatter (sim/basescatter.js)
    default: return FURN_DRAW[k] ? FURN_DRAW[k].top : 0; // the catalogue's pieces (sim/data-furniture.js): their heights with their sprites
  }
}

// Every cell's look for this view and cutaway, with its sprites (made the first time they are drawn), cached.
const looksCache = {}; // by use: "draw" (this frame's cutaway), "pick" (none)
function looksFor(b, scene, cut, slot = "draw", focus = null) {
  const ck = [...cut].sort((a, c) => a - c).join(",");
  const key = `${scene.key}:${viewKey()}:${treeLook}:${snowLook}:${ck}:${focus ? focus.map((p) => p.join(".")).join(",") : ""}`, lc = looksCache[slot];
  if (lc && lc.b === b && lc.key === key) return lc.list;
  leafNow = leafField(b, treeLook, scene.key, groundCells(b)); // autumn's leaves on the hills (lookOf o.lf)
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
  // The same raid made again before going in (sim/raidplan.js: another side, a scout's hour, the night): the same map,
  // the view as it was, moved to the team.
  const prev = iso.battle;
  // The base map laid out again after a change (sim/basemap.js refreshBaseMap): the same view, nothing moves.
  // The map's crop may have grown or shrunk (something placed further out): the grid cell at the middle of the screen
  // stays there (grid = map − the fort record's ox, oy).
  if (prev && b.keepCam && b.layout && prev.layout === b.layout) {
    const pF = prev.deployPlan && prev.deployPlan.fort, nF = b.deployPlan && b.deployPlan.fort;
    const dx = pF && nF ? nF.ox - pF.ox : 0, dy = pF && nF ? nF.oy - pF.oy : 0;
    if (dx || dy || prev.w !== b.w || prev.h !== b.h) {
      const [u, v] = artUV(iso.cx, iso.cy, iso.straight);
      const [wx, wy] = ptWorld(u, v, iso.rot, prev.w, prev.h);
      centerAt(b, wx + dx, wy + dy, 0);
      clampCam(b);
    }
    iso.battle = b; iso.mapKey = mapKey(b);
    return;
  }
  if (prev && prev !== b && prev.setup === b.setup && b.setup && b.setup.plan && prev.w === b.w && prev.h === b.h) {
    iso.battle = b;
    iso.mapKey = mapKey(b);
    const mine = b.units.filter((u) => u.side === "player" && !u.off && u.x >= 0);
    if (mine.length) isoCenterOn(b, Math.round(mine.reduce((a, u) => a + u.x, 0) / mine.length), Math.round(mine.reduce((a, u) => a + u.y, 0) / mine.length));
    return;
  }
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
  // The camp's spot (sim/basemap.js openSiteView): the game's own spot and the ground round it.
  if (b.site && b.site.focus && b.deployPlan && b.deployPlan.fort) { const F = b.deployPlan.fort, x = b.site.focus[0] + F.ox, y = b.site.focus[1] + F.oy; return [x - 14, y - 14, x + 15, y + 15]; }
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
const SOLIDWALK = new Set(["walkway", "tower", "loft", "roof", "stairs", "stand", "rise", "slope"]);
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
    const top = Math.max(L ? L.top : 0, roofs && bid >= 0 && !cut.has(bid) ? scene.blds[bid].top + bldGround(b, i) : 0) + liftAt(b, i);
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
// A cell's floor outline: a diamond, or a straight view's rectangle. close: end the subpath with closePath, which a
// stroke needs for its last edge and join; a fill closes every subpath itself, so a path of many diamonds to fill
// leaves it out (Chromium's closePath costs more the more subpaths the path has: fillCells went quadratic).
function diamond(ctx, x, y, z, inset = 0, close = true) {
  const [u, v] = ptView(x + 0.5, y + 0.5, FR.r, FR.W, FR.H);
  const cx = artX(u, v, FR.st) * FR.S + FR.X0, cy = (artY(u, v, FR.st) - z) * FR.S + FR.Y0;
  if (FR.st) { const w = (SW / 2 - inset) * FR.S, h = (SH / 2 - inset / 2) * FR.S; ctx.rect(cx - w, cy - h, 2 * w, 2 * h); return; }
  const w = (HW - inset * 2) * FR.S, h = (HH - inset) * FR.S;
  ctx.moveTo(cx, cy - h); ctx.lineTo(cx + w, cy); ctx.lineTo(cx, cy + h); ctx.lineTo(cx - w, cy);
  if (close) ctx.closePath();
}
// The no-build margin on a cell of the base map (sim/basemap.js c.nb; the user's request 2026-10-23: "make sure the
// buildable line limit shows on all surfaces mountains, hills and hollows and decor"): a dark red wash over the cell at
// its ground's height (a hill's top, a hollow's floor, the rock's), drawn after the cell's own sprite so a hill, the
// crag or what stands there does not hide it, and the line where the margin ends (toward the cells that take things).
const NB = { FILL: "rgba(150,40,40,0.26)", LINE: "rgba(232,96,80,0.9)" };
function nbMark(ctx, b, x, y) {
  const c = b.cells[y * b.w + x], z = c.k === "crag" ? (c.ch || 3) * LV : tileTop(b, x, y);
  ctx.fillStyle = NB.FILL;
  ctx.beginPath(); diamond(ctx, x, y, z, 0, false); ctx.fill();
  const free = (nx, ny) => nx >= 0 && ny >= 0 && nx < b.w && ny < b.h && !b.cells[ny * b.w + nx].nb;
  const P = (wx, wy) => project(wx, wy, z);
  ctx.strokeStyle = NB.LINE; ctx.lineWidth = Math.max(1.5, 0.9 * FR.S);
  ctx.beginPath();
  const seg = (a, e) => { ctx.moveTo(...a); ctx.lineTo(...e); };
  if (free(x, y - 1)) seg(P(x, y), P(x + 1, y));
  if (free(x, y + 1)) seg(P(x, y + 1), P(x + 1, y + 1));
  if (free(x - 1, y)) seg(P(x, y), P(x, y + 1));
  if (free(x + 1, y)) seg(P(x + 1, y), P(x + 1, y + 1));
  ctx.stroke();
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
    diamond(ctx, x, y, z, 0, false); // filled, so no closePath (diamond)
    any = true;
  }
  if (any) ctx.fill();
}
// The deploy step's green cells (sim/deploy.js canPlace at every cell), worked out once per battle revision instead of
// every frame (4,356 calls a frame on the 66 × 66 yard): every deploy act bumps b.rev, and a new reach, zone or floor
// is a new array (each part of the key), so the mask is the one canPlace would give now.
let deployCache = null;
function deployMask(b) {
  const c = deployCache, D = b.deploy;
  if (c && c.b === b && c.rev === b.rev && c.reach === b.reach && c.zone === D.zone && c.cells === b.cells) return c.ok;
  const N = b.w * b.h, ok = new Uint8Array(N);
  for (let i = 0; i < N; i++) ok[i] = canPlace(b, i % b.w, (i / b.w) | 0) ? 1 : 0;
  deployCache = { b, rev: b.rev, reach: b.reach, zone: D.zone, cells: b.cells, ok };
  return ok;
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
    const L = looks[i], top = (roofed ? scene.blds[bid].top + 4 + bldGround(b, i) : L ? L.top : WALL1) + liftAt(b, i);
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
  carryFrame.pair = 0; carryFrame.shown.clear(); // the pieces carried drawn this frame (drawPairPiece, drawBody)
  frameNow = now; // the frame's clock, for the bodies' own animations (toppleOf)
  walkPaints = WALK_PAINTS;
  const t0 = typeof performance !== "undefined" ? performance.now() : 0;
  if (iso.battle !== b || iso.mapKey !== mapKey(b)) newBattleCamera(b, cw, ch); // a new battle, or its map swapped (the fall back to the yard)
  iso.cw = cw; iso.ch = ch;
  stepCamera(b, now);
  setFrame(b, cw, ch);
  frameFigs.length = 0;
  // Before going in (sim/raidplan.js: the plan open; the user's request 2026-10-18): nobody of yours is on the map yet.
  // The sim has the team at its zone; the drawing leaves them out until the side to go in from is picked.
  // A captive of yours on a rescue raid (sim/rescueraid.js u.captive) is there already, tied up in their base: drawn.
  const hold = planOpen(b) && !b.over;
  const held = (p) => hold && p.side === "player" && !p.captive;
  const S = FR.S, r = iso.rot, st = FR.st, v = H.v, u = H.u, players = b.units.filter((p) => p.side === "player" && !held(p));
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
    for (const p of b.units) if (!p.dead && !p.left && !p.fled && !p.off && onFloor(b, p) && ((p.side === "player" && !held(p)) || v.seen.has(p.id))) cutAt(p.x, p.y);
    if (H.hover) cutAt(H.hover.x, H.hover.y);
  } else if (u && u.side === "player" && !held(u) && !u.dead && !u.left && !u.off && onFloor(b, u) && u.x >= 0) cutAt(u.x, u.y);
  const peeks = (b.peeks || []).filter((p) => p.turn === b.turn); // a peek through a door (sim/buildingmaps.js) lifts the roof too
  for (const p of peeks) cutAt(p.x, p.y);
  // A building's own map (sim/buildingmaps.js): the walls are lowered around your people, the enemies you see and the
  // mouse only (with Roofs off, everywhere).
  let focus = null;
  if (b.raid && b.raid.interior && iso.roofs) {
    focus = [];
    for (const p of b.units) if (!p.dead && !p.left && !p.fled && !p.off && onFloor(b, p) && ((p.side === "player" && !held(p)) || v.seen.has(p.id))) focus.push([p.x, p.y]);
    if (H.hover) focus.push([H.hover.x, H.hover.y]);
    for (const p of peeks) focus.push([p.x, p.y]);
  }
  treeLook = treeLookFor(state, b); // the trees' season (ui/seasontrees.js): a new look draws them again (looksFor's key)
  snowLook = snowOnFor(state, b); // the snow on the buildings (ui/roofsnow.js): in looksFor's key and the sprites' keys
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
  const skirt = skirtFor(b, fog, skirtColor(b), groundKeyOf(b, scene)); // the ground running on past the edges into the fog (the season on it too)
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
      drawBody(ctx, state, b, { t, wx: t.x + (t.size || 1) / 2, wy: t.y + (t.size || 1) / 2, z: 0 }, H);
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
  const ok = deploying && !b.layout && !b.site ? deployMask(b) : null;
  if (deploying && !b.layout && !b.site) {
    fillCells(ctx, b, (i) => ok[i], `rgba(${COL.goodRgb},0.16)`);
    outlineCells(ctx, b, (i) => ok[i], `rgba(${COL.goodRgb},0.8)`, 1.5);
  }
  // The base map's layout mode (sim/basemap.js): the pick's footprint under the mouse (green where it fits, red where
  // not), with the cells outside its doors. The yard's edge has no dashed line (the user's request 2026-10-23); the
  // no-build margin (c.nb) is drawn cell by cell in the painter's pass (nbMark), on whatever ground the cell has.
  // The land being cleared (sim/basemap.js F.clearing: the construction queue's clearing jobs): an amber wash over the
  // pieces and a dashed edge; how far each is goes over it with the tags (below).
  const FmL = b.layout && b.deployPlan && b.deployPlan.fort;
  if (FmL && FmL.clearing && FmL.clearing.length) {
    const inC = new Set(FmL.clearing.flatMap((c) => c.cells.map(([x, y]) => y * b.w + x)));
    fillCells(ctx, b, (i) => inC.has(i), "rgba(230,170,60,0.28)");
    ctx.setLineDash([4, 3]);
    outlineCells(ctx, b, (i) => inC.has(i), "rgba(240,190,80,0.95)", 1.5);
    ctx.setLineDash([]);
  }
  // A picked thing being moved: where it stands now dimmed under a dashed edge while its ghost follows the mouse.
  if (H.ghost && H.ghost.from) {
    const inF = new Set(H.ghost.from.map(([x, y]) => y * b.w + x));
    fillCells(ctx, b, (i) => inF.has(i), "rgba(10,12,16,0.45)");
    ctx.setLineDash([5, 4]);
    outlineCells(ctx, b, (i) => inF.has(i), "rgba(230,216,184,0.7)", 1.5);
    ctx.setLineDash([]);
  }
  // The camp's spot (sim/basemap.js siteGhostAt): the 5 × 5 picked, in gold, under the one the mouse is over.
  if (H.ghost && H.ghost.picked) {
    const inP = new Set(H.ghost.picked.map(([x, y]) => y * b.w + x));
    fillCells(ctx, b, (i) => inP.has(i), "rgba(255,209,102,0.3)");
    outlineCells(ctx, b, (i) => inP.has(i), "rgba(255,209,102,0.95)", 2.5);
  }
  if (H.ghost) {
    const inG = new Set(H.ghost.cells.map(([x, y]) => y * b.w + x)), inD = new Set(H.ghost.doors.map(([x, y]) => y * b.w + x));
    fillCells(ctx, b, (i) => inG.has(i), H.ghost.ok ? `rgba(${COL.goodRgb},0.35)` : "rgba(220,70,60,0.35)");
    outlineCells(ctx, b, (i) => inG.has(i), H.ghost.ok ? `rgba(${COL.goodRgb},0.95)` : "rgba(240,90,80,0.95)", 2);
    if (inD.size) { fillCells(ctx, b, (i) => inD.has(i), "rgba(224,168,79,0.3)"); outlineCells(ctx, b, (i) => inD.has(i), "#e0a84f", 1.5); }
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
  // Your base's land mines (sim/mines.js): a small dark plate with a red pin on each one still in the ground. Only your
  // people know where they are; the attackers see nothing.
  if (b.mines) for (let i = 0; i < b.cells.length; i++) {
    if (!b.cells[i].mine) continue;
    const x = i % b.w, y = (i - x) / b.w;
    const [X, Y] = project(x + 0.5, y + 0.5, tileTop(b, x, y));
    ctx.fillStyle = "rgba(40,36,30,0.85)";
    ctx.beginPath(); ctx.ellipse(X, Y, 3.2 * S, 1.8 * S, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(230,60,50,0.95)";
    ctx.beginPath(); ctx.ellipse(X, Y - 0.6 * S, 0.9 * S, 0.6 * S, 0, 0, Math.PI * 2); ctx.fill();
  }
  // The Diggers' tunnels (sim/tunnels.js): a hole of dark earth at each end your people have seen, a ring of spoil
  // round it, and a faint dashed line under the ground between two seen ends.
  if (b.tunnels) for (const t of b.tunnels) {
    if (!t.open) continue;
    const ends = [[t.a, t.seenA], [t.b, t.seenB]].filter(([p, seen]) => seen && p && p[0] >= 0 && p[1] >= 0 && p[0] < b.w && p[1] < b.h);
    for (const [[x, y]] of ends) {
      const [X, Y] = project(x + 0.5, y + 0.5, tileTop(b, x, y));
      ctx.fillStyle = "rgba(110,84,52,0.9)";
      ctx.beginPath(); ctx.ellipse(X, Y, 5.2 * S, 2.9 * S, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(12,8,4,0.95)";
      ctx.beginPath(); ctx.ellipse(X, Y + 0.3 * S, 3.4 * S, 1.8 * S, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (ends.length === 2) {
      const [X0, Y0] = project(t.a[0] + 0.5, t.a[1] + 0.5, 0), [X1, Y1] = project(t.b[0] + 0.5, t.b[1] + 0.5, 0);
      ctx.strokeStyle = "rgba(176,138,90,0.45)"; ctx.lineWidth = 1.2; ctx.setLineDash([3, 5]);
      ctx.beginPath(); ctx.moveTo(X0, Y0); ctx.lineTo(X1, Y1); ctx.stroke(); ctx.setLineDash([]);
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
  // A car alarm ringing (sim/caralarms.js ringingCars): its lure is a decoy (siege.js battleOverlays), so the ring
  // above shows how far it is heard; its lights and tag after the painter's pass.
  const alarms = floorNo(b) ? [] : ringingCars(b);
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
  // Lit fire pits (a camp's fire, a cook fire, a campsite's): a warm glow on the ground round them now, their flames,
  // sparks and smoke in the painter's pass.
  const pitsLit = scene.pits.filter((i) => b.cells[i].lit && vis[i]);
  for (const i of pitsLit) campfireGlow(ctx, b, i % b.w, (i / b.w) | 0, S, now, st, !!(b.night || b.dark));
  for (const i of pitsLit) atD(i % b.w, (i / b.w) | 0, () => drawCampfireIso(ctx, b, i % b.w, (i / b.w) | 0, S, now));

  // Night: the lights (ui/battlelights.js), a glow on the ground under the units. By day in a raid's building: the
  // dark rooms' floors shaded (a barn, a storeroom: sim/indoorlight.js), a light switched on there cut out of it.
  if ((b.night || b.dark || b.indoor) && paintLights(b, v, groundXform(b, iso.rot, 1, S, gx, gy, Hv), cw, ch, now, (t) => H.animPos(t, now), pitsLit)) drawGlow(ctx, cw, ch);
  if (b.indoor && !b.night && !b.dark) drawShade(ctx, b, cw, ch);

  // ---------- the painter's pass: every cell from the back to the front ----------
  const items = [];
  // Units by where they stand (walking their moves: ui/moveanim.js).
  const shown = [];
  for (const t of b.units) {
    if (t.left || t.fled || t.off || !onFloor(b, t)) continue; // on another floor: a marker only (below)
    if (held(t)) continue; // not on the map until the team goes in (sim/raidplan.js)
    if (t.side !== "player" && !(active(t) ? v.seen.has(t.id) : knownBody(b, t, vis))) continue; // the enemy and the third side (sim/thirdside.js) under the fog; a body once seen stays
    const [wx, wy] = H.animPos(t, now);
    const [uu, vv] = ptView(wx, wy, r, b.w, b.h);
    const tx = Math.max(0, Math.min(b.w - 1, Math.floor(wx))), ty = Math.max(0, Math.min(b.h - 1, Math.floor(wy)));
    shown.push({ t, wx, wy, z: standZ(b, tx, ty), d: depth(Math.floor(uu), Math.floor(vv), st) });
  }
  frameShown = shown; // a pair carrying a piece: where the other one stands (drawPairPiece)
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
      const top = Math.max(L ? L.top : 0, bid >= 0 && !cut.has(bid) ? scene.blds[bid].top + bldGround(b, y * b.w + x) : 0) + liftAt(b, y * b.w + x);
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
  for (const p of groundPiles(b)) { if ((!pileCount(p) && !p.cart) || !onFloor(b, p)) continue; const [cu, cv] = toView(p.x, p.y, r, b.w, b.h); const d = depth(cu, cv, st); const a = piles.get(d); if (a) a.push(p); else piles.set(d, [p]); } // a cart (sim/carts.js) is drawn even empty
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
  // The field fences running off the map (offEdgeFences), by depth like the cells: fading out across the skirt.
  const offFence = new Map();
  if (skirt && !lift) for (const q of offEdgeFences(b, skirt.K)) {
    const [qu, qv] = toView(q.x, q.y, r, b.w, b.h), d = depth(qu, qv, st), a = offFence.get(d);
    const s = { ...q, sx: artX(qu, qv, st) * S + FR.X0, sy: artY(qu, qv, st) * S + FR.Y0 };
    if (a) a.push(s); else offFence.set(d, [s]);
  }
  const drawOffFence = (list) => {
    for (const q of list || []) {
      if (q.sx < -margin || q.sx > cw + margin || q.sy < -margin || q.sy > ch + margin * 2) continue;
      const vd = viewDir(q.dx, q.dy, r), j = (1 << vd) | (1 << (vd ^ 1)); // joined both ways along the line (VD pairs: 0/1, 2/3)
      const spr = sprite(q.k, { v: 0, alt: 0, j, n: null, top: WALL1, mat: 0, dmg: 0, dir: null, ...(snowLook ? { sn: snowLook } : {}) }, false);
      if (!spr) continue;
      const f = Math.max(0, Math.min(1, (q.t - 0.6) / (skirt.K - 0.6)));
      ctx.globalAlpha = 1 - f * f * (3 - 2 * f);
      ctx.drawImage(spr.cv, Math.round(q.sx + spr.ox * S), Math.round(q.sy + spr.oy * S), Math.ceil(spr.w * S), Math.ceil(spr.h * S));
      ctx.globalAlpha = 1;
    }
  };
  const dMax = st ? Hv - 1 : Wv + Hv - 2;
  for (const [, list] of [...offFence].filter(([d]) => d < 0).sort((a, c) => a[0] - c[0])) drawOffFence(list); // behind the map
  // The land past the edge (beyondBoard), by depth, fading out with its distance from the map; not where the map is
  // unknown round a camp set up blind (b.knownMask), nor with the map's edge off (Display: battleedge.js).
  const beyond = new Map(), bdb = !b.knownMask && skirtTiles() > 0 ? beyondBoard(b) : null;
  if (bdb) for (const e of beyondLooks(b, bdb)) {
    const [bu, bv] = toView(e.x, e.y, r, b.w, b.h), d = depth(bu, bv, st);
    const out = Math.max(-bu, bu - (Wv - 1), -bv, bv - (Hv - 1));
    const t = Math.round(clamp01((out - 0.5) / (bdb.R + 0.5)) * FOG_STEPS) / FOG_STEPS; // how far into the fog (fogTinted)
    if (t >= 1) continue;
    const q = { e, bu, bv, t, fog: !vis[Math.max(0, Math.min(b.h - 1, e.y)) * b.w + Math.max(0, Math.min(b.w - 1, e.x))] };
    const l = beyond.get(d); if (l) l.push(q); else beyond.set(d, [q]);
  }
  const drawBeyond = (d) => {
    for (const q of beyond.get(d) || []) {
      const sx = artX(q.bu, q.bv, st) * S + FR.X0, sy = artY(q.bu, q.bv, st) * S + FR.Y0;
      if (sx < -margin || sx > cw + margin || sy < -margin || sy > ch + margin * 2) continue;
      const spr = sprOf(q.e.L, q.fog);
      if (!spr) continue;
      ctx.drawImage(fogTinted(spr, fog, q.t), Math.round(sx + spr.ox * S), Math.round(sy + spr.oy * S), Math.ceil(spr.w * S), Math.ceil(spr.h * S));
    }
  };
  const lastD = dMax;
  const nbOn = !!(b.layout && b.deployPlan && b.deployPlan.fort); // the base map's layout mode: its no-build margin (nbMark)
  if (bdb) for (const d of [...beyond.keys()].filter((k) => k < 0).sort((p, q) => p - q)) drawBeyond(d);
  // By diagonal (u + v) from the back; in a straight view by row (v).
  for (let d = 0; d <= lastD; d++) {
    drawBeyond(d);
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
      if (nbOn && b.cells[i].nb) nbMark(ctx, b, x, y); // the no-build margin, on the cell's own ground (over its sprite)
      // Highlights on a raised floor sit on top of it.
      const zt = tileTop(b, x, y);
      if (zt) {
        if (bands && bands[i]) { ctx.fillStyle = bands[i] === 1 ? "rgba(80,150,255,0.32)" : "rgba(255,200,60,0.22)"; ctx.beginPath(); diamond(ctx, x, y, zt); ctx.fill(); }
        if (ok && ok[i]) { ctx.fillStyle = `rgba(${COL.goodRgb},0.28)`; ctx.beginPath(); diamond(ctx, x, y, zt); ctx.fill(); }
      }
    }
    drawOffFence(offFence.get(d));
    for (const c of bodies.get(d) || []) drawCorpseIso(ctx, b, c, !vis[c.y * b.w + c.x]);
    for (const p of piles.get(d) || []) if (!unknownCell(p.y * b.w + p.x)) { if (p.cart) drawCartBoxIso(ctx, p, project, (x, y) => standZ(b, x, y), S, { yaw: parkedYaw(b, p), fog: !vis[p.y * b.w + p.x] }); else drawPileIso(ctx, p, project, (x, y) => standZ(b, x, y), S); } // ui/ground.js (a cart: its own model, ui/cartmodel.js)
    for (const q of gh.get(d) || []) drawGhost(ctx, state, b, q, H);
    for (const f of siegeAt.get(d) || []) f();
    for (const s of (sh.get(d) || []).filter((q) => !flatDead.has(q.t)).sort((a, c) => a.z - c.z || (active(a.t) ? 1 : 0) - (active(c.t) ? 1 : 0))) {
      drawUnitIso(ctx, state, b, s, H, now);
    }
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
      const sx = artX(uu, vv, st) * S + FR.X0, sy = artY(uu, vv, st) * S + FR.Y0 - (liftAt(b, i) + bldGround(b, i)) * S; // on the ground it stands on
      if (sx < -margin || sx > cw + margin || sy < -margin || sy > ch + margin * 2) continue;
      let edges = 0;
      VD.forEach(([du, dv], k) => { const nu = uu + du, nv = vv + dv; if (nu < 0 || nv < 0 || nu >= Wv || nv >= Hv) { edges |= 1 << k; return; } const [nx, ny] = fromView(nu, nv, r, b.w, b.h); if (scene.comp[ny * b.w + nx] !== bid) edges |= 1 << k; });
      const B = scene.blds[bid], spr = roofSprite(B.mat, B.top, edges, !seenB.has(bid), snowLook, snowLook ? Math.floor(hash3(x, y, 61) * 4) : 0); // snow on it, its drifts by the cell
      if (fade.has(i)) ctx.globalAlpha = 0.35;
      ctx.drawImage(spr.cv, Math.round(sx + spr.ox * S), Math.round(sy + spr.oy * S), Math.ceil(spr.w * S), Math.ceil(spr.h * S));
      ctx.globalAlpha = 1;
    }
  }
  if (bdb) for (const d of [...beyond.keys()].filter((k) => k > lastD).sort((p, q) => p - q)) drawBeyond(d); // the land in front of the map's near edges

  for (const [, list] of [...offFence].filter(([d]) => d > dMax).sort((a, c) => a[0] - c[0])) drawOffFence(list); // in front of it
  // A building with storeys (floorsOf): units on other floors are not drawn; a faint marker at their x, y says
  // ▲ / ▼ and the floor (clicking it jumps to that floor: iso.rects). The stairwells carry an arrow for the way
  // up or down, lit when the selected unit stands on them.
  iso.markers = [];
  if (F) {
    for (const t of b.units) {
      const tf = t.f || 0;
      if (t.left || t.fled || t.off || t.dead || tf === floorNo(b)) continue;
      if (t.side !== "player" ? !v.seen.has(t.id) : held(t)) continue; // (held: the team is not on the map yet)
      const [X, Y] = project(t.x + (t.size || 1) / 2, t.y + (t.size || 1) / 2, standZ(b, t.x, t.y));
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
      if (b.cells[i].k !== "stairs" || (b.cells[i].step != null && !b.cells[i].top)) continue; // a run's top step only: where the floor changes
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
  { // ui/battlewx.js: the rain, fog or snow (screen space; the labels, bars and cursor stay on top); rings on the puddles in sight (sim/puddles.js)
    const [ax, ay] = project(b.w / 2, b.h / 2, 0), [p0x, p0y] = project(0, 0, 0), [p1x, p1y] = project(1, 0, 0);
    const spot = b.puddles && b.cells === groundCells(b) ? (x, y) => (vis[y * b.w + x] ? project(x + 0.5, y + 0.5, 0) : null) : null;
    drawBattleWx(ctx, cw, ch, state, b, now, ax, ay, spot, Math.hypot(p1x - p0x, p1y - p0y));
  }
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
    if (l.key === "caralarm") continue; // a car alarm: its own lights and tag below
    const [X, Y] = project(l.x + 0.5, l.y + 0.5, 0), q = ((now || 0) % 1200) / 1200;
    const kind = l.sense.includes("heat") && !l.sense.includes("light") ? "heat" : l.sense.includes("light") ? "light" : "noise";
    ctx.strokeStyle = SENSE_COL[kind].replace("A", String(0.65 * (1 - q))); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(X, Y, (0.4 + q * 1.4) * RX(st) * S, (0.4 + q * 1.4) * RY(st) * S, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = kind === "heat" ? "#ff7a4a" : kind === "light" ? "#fff2c0" : "#e0b048"; ctx.beginPath(); ctx.arc(X, Y - 2 * S, 2.2 * S, 0, Math.PI * 2); ctx.fill();
    if (l.decoy) tag(ctx, kind === "heat" ? "HEAT" : kind === "light" ? "LIGHT" : "NOISE", X, Y - 9 * S, kind === "heat" ? "#ff9a6a" : kind === "light" ? "#fff2c0" : "#ffd166", Math.max(9, 2.8 * S));
  }
  // A ringing car alarm: the hazard lights at its four corners blinking orange and white (about twice a second), a soft
  // halo round each while lit, a ring pulsing out from it and an ALARM tag with the turns left over its roof. The
  // lights only where your people see the car; the ring and the tag always (everyone hears it).
  for (const a of alarms) {
    const q = ((now || 0) % 1100) / 1100, on = ((now || 0) % 520) < 300, white = ((now || 0) % 1040) < 520;
    const mid = (a.y + Math.floor(a.h / 2)) * b.w + a.x + Math.floor(a.w / 2), L = looks[mid], top = (L ? L.top : VEH_TOP) + liftAt(b, mid);
    let seen = false;
    for (let yy = a.y; yy < a.y + a.h && !seen; yy++) for (let xx = a.x; xx < a.x + a.w; xx++) if (vis[yy * b.w + xx]) { seen = true; break; }
    const [GX, GY] = project(a.x + a.w / 2, a.y + a.h / 2, 0);
    ctx.strokeStyle = `rgba(255,170,60,${0.7 * (1 - q)})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(GX, GY, (Math.max(a.w, a.h) / 2 + q * 2.2) * RX(st) * S, (Math.max(a.w, a.h) / 2 + q * 2.2) * RY(st) * S, 0, 0, Math.PI * 2); ctx.stroke();
    if (seen && on) {
      const col = white ? "255,250,230" : "255,150,40";
      for (const [cx, cy] of [[a.x + 0.15, a.y + 0.15], [a.x + a.w - 0.15, a.y + 0.15], [a.x + 0.15, a.y + a.h - 0.15], [a.x + a.w - 0.15, a.y + a.h - 0.15]]) {
        const [X, Y] = project(cx, cy, top * 0.45);
        const g = ctx.createRadialGradient(X, Y, 0, X, Y, 7 * S);
        g.addColorStop(0, `rgba(${col},0.75)`); g.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, 7 * S, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgb(${col})`; ctx.beginPath(); ctx.arc(X, Y, 1.6 * S, 0, Math.PI * 2); ctx.fill();
      }
    }
    const [TX, TY] = project(a.x + a.w / 2, a.y + a.h / 2, top + 12);
    tag(ctx, `ALARM · ${a.left}`, TX, TY, on ? "#ffb347" : "#ffe0b0", Math.max(9, 2.8 * S));
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
      const [X, Y] = project(a.x0 + a.w / 2, a.y0 + a.h / 2, (a.outdoor ? 6 : low ? (a.up ? LV : 0) + 14 : (scene.blds[bid] ? scene.blds[bid].top + bldGround(b, ai) : WALL1) + 12) + (a.outdoor ? 0 : liftAt(b, ai)));
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
      tag(ctx, z.vehicle && !hold ? "VEHICLE · EXTRACT" : z.name ? `${z.name.toUpperCase()} · EXTRACT` : "EXTRACT", X, Y + 4 * S, z.vehicle && !hold ? "#a9cbff" : COL.good, Math.max(10, 4 * S)); // hold (sim/raidplan.js): the team and its vehicle are not there yet
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
  // The base map's land being cleared: how far each clearing is, over its pieces; the picked thing's old spot dimmed
  // over its sprites (a dimmed copy while the ghost follows the mouse).
  const FmT = b.layout && b.deployPlan && b.deployPlan.fort;
  if (FmT && FmT.clearing) for (const c of FmT.clearing) {
    if (!c.cells.length) continue;
    const xs = c.cells.map((q) => q[0]), ys = c.cells.map((q) => q[1]);
    const [X, Y] = project((Math.min(...xs) + Math.max(...xs) + 1) / 2, (Math.min(...ys) + Math.max(...ys) + 1) / 2, 34);
    // A hollow being dug or a hill raised (sim/terraform.js: c.terra): its wash again over the raised and sunk cells, whose
    // own earth is painted over the ground's wash.
    if (c.terra) { const inT = new Set(c.cells.filter(([x, y]) => tileTop(b, x, y) !== 0).map(([x, y]) => y * b.w + x)); if (inT.size) fillCells(ctx, b, (i) => inT.has(i), "rgba(230,170,60,0.28)"); }
    tag(ctx, `${c.who && c.who.length ? `${c.who.slice(0, 3).join(", ")}${c.who.length > 3 ? ` +${c.who.length - 3}` : ""}: ` : ""}${c.verb || "Clearing"} ${c.pct}%`, X, Y, "#f0c060", Math.max(10, 3.6 * S)); // woodwork: who is felling it (sim/woodwork.js chopHands); verb: terraform.js "Digging", "Raising"
  }
  // The camp's spot on high ground or in a hollow (sim/basescatter.js reliefLayer): its raised and sunk cells again over the blocks painted on them;
  // so too the terraforming pick's area (sim/basemap.js terraGhost).
  if (H.ghost && (b.site || H.ghost.terraPick)) {
    const up = (cells) => new Set(cells.filter(([x, y]) => tileTop(b, x, y) !== 0).map(([x, y]) => y * b.w + x)); // raised or sunk (a hollow's floor is drawn over the ground)
    const inP = up(H.ghost.picked || []), inG = up(H.ghost.cells || []);
    if (inP.size) { fillCells(ctx, b, (i) => inP.has(i), "rgba(255,209,102,0.3)"); outlineCells(ctx, b, (i) => inP.has(i), "rgba(255,209,102,0.95)", 2.5); }
    if (inG.size) { fillCells(ctx, b, (i) => inG.has(i), H.ghost.ok ? `rgba(${COL.goodRgb},0.35)` : "rgba(220,70,60,0.35)"); outlineCells(ctx, b, (i) => inG.has(i), H.ghost.ok ? `rgba(${COL.goodRgb},0.95)` : "rgba(240,90,80,0.95)", 2); }
  }
  if (H.ghost && H.ghost.pickedAt) { const [X, Y] = project(H.ghost.pickedAt[0] + 0.5, H.ghost.pickedAt[1] + 0.5, 34); tag(ctx, "Camp fire here", X, Y, "#ffd166", Math.max(10, 3.6 * S)); } // the camp's spot picked (sim/basemap.js siteGhostAt)
  if (H.ghost && H.ghost.gameAt) { const [X, Y] = project(H.ghost.gameAt[0] + 0.5, H.ghost.gameAt[1] + 0.5, 24); tag(ctx, "The game's pick", X, Y, "#9fd3c7", Math.max(9, 3.2 * S)); } // the game's own spot (sim/siteinfo.js bestSite) while another is picked
  if (H.ghost && H.ghost.from) for (const [x, y] of H.ghost.from) { ctx.fillStyle = "rgba(12,14,18,0.42)"; ctx.beginPath(); diamond(ctx, x, y, 14); ctx.fill(); }
  // The stores on a base map (sim/basemap.js): a crate marker over each building that holds goods, with its weight.
  if (b.stores) for (const c0 of b.stores.containers) {
    const ci = c0.y * b.w + c0.x;
    let seen = !!b.deploy || !!b.layout || !!b.site;
    for (let yy = c0.y; yy < c0.y + c0.h && !seen; yy++) for (let xx = c0.x; xx < c0.x + c0.w; xx++) if (vis[yy * b.w + xx]) { seen = true; break; }
    if (!seen) continue;
    const L = looks[ci], top = Math.max(L ? L.top : 4, WALL1) + liftAt(b, ci);
    const [X, Y] = project(c0.x + c0.w / 2, c0.y + c0.h / 2, top + 6);
    const s = Math.max(7, 3.2 * S);
    ctx.fillStyle = c0.kg > 0.5 ? "#b08a4a" : "rgba(60,64,70,0.9)"; ctx.strokeStyle = "#1a1a1a"; ctx.lineWidth = 1;
    rr(ctx, X - s, Y - s * 2, s * 2, s * 2, 3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#1a1a1a"; ctx.font = `700 ${Math.round(s * 1.4)}px Segoe UI, sans-serif`; ctx.textAlign = "center";
    ctx.fillText("▣", X, Y - s * 0.45);
    tag(ctx, `${Math.round(c0.kg)} kg`, X, Y + s * 0.4, c0.kg > 0.5 ? "#e6d8b8" : "#9aa0a8", Math.max(9, 3.2 * S));
  }
  for (let i = 0; i < N; i++) {
    const c = b.cells[i];
    if (!c.mhp || !(c.hp < c.mhp || c.k === "gate") || !vis[i] && !(b.deploy)) continue;
    const x = i % b.w, y = (i / b.w) | 0, L = looks[i], top = (L ? L.top : 0) + liftAt(b, i);
    const [X, Y] = project(x + 0.5, y + 0.5, top + 3), f = Math.max(0, c.hp / c.mhp), w = 18 * S * 0.6;
    ctx.fillStyle = "rgba(15,17,20,0.85)"; ctx.fillRect(X - w / 2, Y - 3, w, 4);
    ctx.fillStyle = f > 0.6 ? COL.good : f > 0.3 ? COL.mid : COL.bad; ctx.fillRect(X - w / 2, Y - 3, w * f, 4);
  }
  // The deploy step: the gate and breaches, the side the attack comes from (not on the base map: nothing attacks).
  if (deploying && !b.layout && !b.site) {
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
  if (H.mode === "parkCart" && u) { const ps = new Set(parkCells(b, u).map(([x, y]) => y * b.w + x)); fillCells(ctx, b, (i) => ps.has(i), "rgba(224,168,79,0.38)"); } // sim/carts.js: the four cells beside them a cart can be parked on
  if (H.mode === "setPiece" && u) { const ps = new Set(setTargets(b, u).flatMap((o) => o.cells.map(([x, y]) => y * b.w + x))); fillCells(ctx, b, (i) => ps.has(i), "rgba(224,168,79,0.38)"); } // sim/furnicarry.js: where the piece carried can be set down (Park cart's highlight)
  if (H.callout && H.callout.length) { // Call out (ui/combat.js): whom the selected one can call to, one per group
    ctx.strokeStyle = "#ffd166"; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); ctx.beginPath();
    for (const t of H.callout) if (onFloor(b, t)) diamond(ctx, t.x, t.y, tileTop(b, t.x, t.y), 1.5);
    ctx.stroke(); ctx.setLineDash([]);
  }
  if (H.allyMarks) drawAllyGround(ctx, b, H.allyMarks); // Ally orders (ui/combat.js allyMarks): the reach, the allies in it
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
    // Half cover vaulted on the way (sim/combat.js VAULT, vaultable): the cell outlined solid in the path's colour with a
    // VAULT tag over it (the path goes over it, never ends on it); a closed window crashed through (vaultBreaks,
    // sim/windows.js: loud, and it cuts) gets a SMASH tag in the danger colour instead.
    for (const [x, y] of path) {
      const c = b.cells[y * b.w + x];
      if (CELL[c.k].walk || !vaultable(b, c)) continue;
      const smash = vaultBreaks(c), col = smash ? "#ff6b6b" : ctx.strokeStyle;
      ctx.lineWidth = Math.max(1.5, 0.5 * S);
      const keep = ctx.strokeStyle;
      ctx.strokeStyle = col;
      ctx.beginPath(); diamond(ctx, x, y, tileTop(b, x, y), 1); ctx.stroke();
      ctx.strokeStyle = keep;
      const [X, Y] = project(x + 0.5, y + 0.5, tileTop(b, x, y) + 10);
      tag(ctx, smash ? "SMASH" : "VAULT", X, Y, col, Math.max(9, 2.8 * S));
    }
  }

  // Effects: shots, blows, numbers, throws.
  drawFxIso(ctx, b, now, H, state, shown);
  // Labels over the units: health, actions, status, the hit chance against each enemy in sight.
  for (const s of shown) drawLabels(ctx, b, s, H);
  if (H.allyMarks) drawAllyMarks(ctx, b, H.allyMarks); // Ally orders: the flags you set, the targets, the tile being picked
  // The retreat confirm: each one's odds of getting out over their head.
  if (H.retreatOpen && H.plan) {
    for (const p of H.plan.units) {
      const t = b.units.find((q) => q.id === p.id);
      if (!t) continue;
      const [X, Y] = project(t.x + (t.size || 1) / 2, t.y + (t.size || 1) / 2, standZ(b, t.x, t.y) + UNIT_H + 14);
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
    if (u && active(u) && b.phase === "player" && !String(H.mode || "").startsWith("ally")) { // (an ally's target being picked: not your shot)
      const t = H.unitAt(h.x, h.y);
      if (t && t.side === "enemy" && active(t) && v.seen.has(t.id)) {
        const o = H.odds(b, u, t);
        const col = !o.ok ? "#9aa0a8" : o.chance >= 65 ? COL.good : o.chance >= 35 ? COL.mid : COL.bad;
        const [X0, Y0] = project(u.x + 0.5, u.y + 0.5, standZ(b, u.x, u.y) + UNIT_H * 0.6), [X1, Y1] = project(t.x + (t.size || 1) / 2, t.y + (t.size || 1) / 2, standZ(b, t.x, t.y) + UNIT_H * 0.6);
        ctx.strokeStyle = col; ctx.lineWidth = 2;
        if (!o.ok) ctx.setLineDash([4, 5]);
        ctx.beginPath(); ctx.moveTo(X0, Y0); ctx.lineTo(X1, Y1); ctx.stroke();
        ctx.setLineDash([]);
        H.bubble(h.px + 14, h.py - 8, o.ok ? [`${o.chance}%`, `${o.dmg[0]}–${o.dmg[1]} dmg`, o.flanked ? "FLANKED" : o.cover ? `${o.cover === 2 ? "Full cover" : "Half cover"}${o.high ? `: ${o.high === "hill" ? "hill" : "higher ground"}` : ""}` : ""] : [o.label], col, cw);
      }
    }
  }
  drawEdgeMarkers(ctx, b, cw, ch, v);
  drawCompass(ctx, cw, ch);
  warmTurns(state, b, H);
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
// A lit fire pit's glow (the user's request 2026-10-23: "Improve campfire look"): warm light on the ground round it,
// breathing with the flames; brighter at night.
function campfireGlow(ctx, b, x, y, S, now, st, dark) {
  const [X, Y] = project(x + 0.5, y + 0.5, tileTop(b, x, y)), t = (now || 0) / 1000;
  const fl = 1 + 0.06 * Math.sin(t * 7.3 + x) + 0.04 * Math.sin(t * 13.1 + y);
  ctx.save();
  ctx.translate(X, Y); ctx.scale(RX(st) * S * 1.6 * fl, RY(st) * S * 1.6 * fl);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, `rgba(255,150,60,${dark ? 0.42 : 0.24})`); g.addColorStop(0.45, `rgba(255,120,40,${dark ? 0.16 : 0.08})`); g.addColorStop(1, "rgba(255,110,40,0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
// A lit fire pit's fire over its logs: tongues of flame in three layers (deep orange outside, gold, a pale core), each
// swaying and flickering on its own; sparks rising and winking out; a thin smoke drifting up and spreading.
function drawCampfireIso(ctx, b, x, y, S, now) {
  const t = (now || 0) / 1000, seed = x * 1.7 + y * 2.3;
  const [X, Y] = project(x + 0.5, y + 0.5, tileTop(b, x, y) + 3);
  const tongue = (dx, w, h, sway, col) => {
    const bx = X + dx * S, tip = bx + sway * S;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(bx - w * S, Y);
    ctx.bezierCurveTo(bx - w * S, Y - h * 0.45 * S, tip - w * 0.35 * S, Y - h * 0.7 * S, tip, Y - h * S);
    ctx.bezierCurveTo(tip + w * 0.35 * S, Y - h * 0.7 * S, bx + w * S, Y - h * 0.45 * S, bx + w * S, Y);
    ctx.closePath(); ctx.fill();
  };
  const fl = (k, sp) => Math.sin(t * sp + seed + k * 2.1) * 0.5 + Math.sin(t * sp * 2.3 + k * 1.3) * 0.25;
  // Smoke first: behind the flames.
  for (let k = 0; k < 3; k++) {
    const p = (t * 0.22 + k / 3 + seed * 0.01) % 1;
    ctx.fillStyle = `rgba(150,146,140,${0.2 * Math.sin(p * Math.PI)})`;
    ctx.beginPath(); ctx.arc(X + (Math.sin(p * 4 + k + seed) * 3 + p * 4) * S, Y - (12 + p * 30) * S, (1.6 + p * 4.5) * S, 0, Math.PI * 2); ctx.fill();
  }
  for (const [dx, k] of [[-2.4, 0], [2.4, 1], [-0.8, 2], [1.2, 3]]) tongue(dx, 1.9, 8 + 3 * fl(k, 9), fl(k + 4, 5) * 2, "rgba(226,86,32,0.88)");
  for (const [dx, k] of [[-1.3, 5], [1.3, 6], [0, 7]]) tongue(dx, 1.6, 6.5 + 2.5 * fl(k, 11), fl(k + 4, 6) * 1.6, "rgba(255,158,46,0.92)");
  for (const [dx, k] of [[-0.5, 8], [0.7, 9]]) tongue(dx, 1, 4 + 1.5 * fl(k, 14), fl(k + 4, 7), "rgba(255,236,160,0.95)");
  // Sparks.
  for (let k = 0; k < 5; k++) {
    const p = (t * (0.7 + k * 0.09) + k * 0.31 + seed * 0.05) % 1;
    ctx.fillStyle = `rgba(255,${190 + k * 10},90,${1 - p})`;
    const r = Math.max(0.6, 0.9 * S);
    ctx.fillRect(X + Math.sin(p * 7 + k * 2 + seed) * 3.5 * S - r / 2, Y - (6 + p * 24) * S - r / 2, r, r);
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
  const a = Math.atan2(Y1 - Y0, X1 - X0), cx = 40, cy = ch - 40 - (iso.bottomInset || 0); // above the bottom bar (ui/battlebar.js)
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
const ZRING = { runner: "#ffb43b", brute: "#c8c4b0", spitter: "#9ad63a", screamer: "#c99ae0", crawler: "#6ab0c8", shepherd: "#e8e2ff", soldier: "#a8b878", riot: "#8aa0c8", carrier: "#e6d8a8", swarm: "#f0e4c0", boneback: "#d8b48a", climber: "#8fd0a0", flinger: "#e8a0c8", sower: "#e8e070", nightmare: "#e0506e", digger: "#b08a5a", melter: "#c8f04a", husk: "#d8c09a", tripper: "#e2a02f", darkwalker: "#9a9ab8", sleeper: "#b0d8ff", deadstag: "#d2a86a", deadhog: "#8c7a66", deadhound: "#c0b8a8", deadcow: "#e8dcc0", deadcat: "#b8a8c8" }; // the dead beasts (sim/deadbeasts.js)
const ringOf = (t) => (t.side === "player" ? (t.vol != null ? "#c9a2ff" : "#8fc1ff") : t.side === "third" ? thirdRing(t) : t.kind === "zombie" ? (t.ztype ? ZRING[t.ztype] || "#b5d36a" : t.boss ? COL.bad : "#b5d36a") : "#ff8f85");
function feet(s) { return project(s.wx, s.wy, s.z); }
// The sprite, standing (or lying) at the unit's feet. silhouette: only the figure (for the see-through pass).
// Shoved flat on their back (sim/shoving.js fx "topple": { unit, dir }): the newest topple of t and how far it has
// gone, 0 (still on their feet, while the shove's stumble slides them back) to 1 (down), or null when it is over.
const TOPPLE = { DELAY: 110, MS: 260 };
let frameNow = 0; // drawIso's now: the clock every effect of the frame is timed by (H.fxAge) // DELAY: the stumble back (ui/combat.js animTile's shove step); MS: the fall
function toppleOf(b, t, H) {
  if (!H || !H.fxAge || !b.fx) return null;
  for (let i = b.fx.length - 1; i >= 0; i--) {
    const f = b.fx[i];
    if (f.type !== "topple" || f.unit !== t.id) continue;
    const el = H.fxAge(f, frameNow) - TOPPLE.DELAY;
    return el >= TOPPLE.MS ? { f, p: 1, done: true } : { f, p: Math.max(0, el / TOPPLE.MS), done: false };
  }
  return null;
}
function drawBody(ctx, state, b, s, H, silhouette = false) {
  const t = s.t, S = FR.S, [X, Y] = feet(s);
  const flat = t.floored && !t.dead && !t.down ? toppleOf(b, t, H) : null; // shoved flat on their back (sim/shoving.js)
  if (flat && !flat.done) { // still going over: the standing figure tips toward the way they fall, about its feet
    const d = flat.f.dir || [1, 0], [x1, y1] = project(s.wx + d[0], s.wy + d[1], s.z), dx = x1 - X, dy = y1 - Y, len = Math.hypot(dx, dy) || 1;
    const e = flat.p * flat.p; // falling: slow at first, then fast
    const fig = unitFigure(state, b, t, H.salt, unitYaw(b, t, FR.r));
    frameFigs.push(["up", t]);
    if (fig) {
      ctx.save();
      ctx.translate(X, Y);
      ctx.rotate((dx >= 0 ? 1 : -1) * e * 1.4 * (Math.abs(dx) / len)); // sideways on screen: a turn about the feet
      ctx.scale(1, 1 - e * 0.65 * (Math.abs(dy) / len)); // toward or away from the viewer: it shortens as it goes over
      drawFigure(ctx, fig, 0, 0, S, 1);
      ctx.restore();
      return;
    }
  }
  if (t.dead || t.down || t.floored) { // floored: shoved flat on their back (sim/shoving.js) until they get up
    // Lying on the ground: the figure laid along the world's x (the head toward -x, or +x facing the other way), so it
    // turns with the view; the flat picture (ui/downsprites.js) laid onto the floor's axes when there is none. Shoved
    // flat: the head the way they fell.
    const f = unitFacing(b, t);
    const fig = unitFigureDown(state, b, t, H.salt, dirYaw(b, t, FR.r, flat && flat.f.dir ? flat.f.dir : [-f, 0]));
    frameFigs.push(["down", t]);
    if (fig) { drawFigure(ctx, fig, X, Y, S, !silhouette && t.dead ? 0.92 : 1); return; }
    const [x1, y1] = project(s.wx + 1, s.wy, s.z), [x2, y2] = project(s.wx, s.wy + 1, s.z);
    drawDowned(ctx, unitDownCanvas(state, b, t, H.salt), X, Y, [x1 - X, y1 - Y], [x2 - X, y2 - Y], { facing: f, scale: downScale(t), alpha: !silhouette && t.dead ? 0.92 : 1 });
    return;
  }
  const m = H.moveOf ? H.moveOf(t, frameNow) : null; // walking (ui/combat.js moveNow): facing the step it is on, striding
  const yaw = m && m.dir ? dirYaw(b, t, FR.r, m.dir) : unitYaw(b, t, FR.r);
  const walk = m ? strideOf(m) : null;
  const fig = walkFigure(state, b, t, H.salt, yaw, walk) || unitFigure(state, b, t, H.salt, yaw); // a low-poly figure facing its way (ui/figures.js), else the flat sprite mirrored to its side
  frameFigs.push(["up", t]);
  const carry = t.piece ? carryLook(state, b, t) : null; // a piece of furniture in the arms (ui/figures.js: the pose, the piece alone)
  if (fig && carry && carry.kind) carryFrame.shown.add(t.id);
  const sway = carry && carry.low ? Math.round(Math.sin((frameNow * Math.PI) / CARRY_VIEW.SWAY_MS)) : 0; // a heavy piece alone: a slow 1 px bob
  const cv = fig || unitCanvas(state, b, t, H.salt);
  if (!cv) return;
  // A cart in the arms (sim/carts.js) rolls with its pusher, facing their way (ui/ground.js, ui/cartmodel.js): the
  // wheelbarrow pushed ahead, the hand cart pulled behind; whichever end is nearer the viewer drawn over the figure.
  const cart = isCart(t.bag) ? t.bag : null;
  const a = (yaw * Math.PI) / 180, ahead = Math.cos(a) + Math.sin(a) > 0, cartOver = cart && (cartLookOf(cart) === "cart" ? !ahead : ahead);
  if (cart && !cartOver) drawCartIso(ctx, cart, X, Y, S, { yaw, held: true });
  const facing = sideFacing(b, t, FR.r);
  const hgt = UNIT_H * unitBig(t) * S, w = hgt * (22 / 26);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(X, Y - (walk ? walk.bob * S : 0) + sway * S); // walking: up a little as the legs pass
  if (!fig && facing < 0) ctx.scale(-1, 1);
  const spent = t.side === "player" && t.ap === 0 && b.phase === "player";
  if (!silhouette && spent) ctx.globalAlpha *= 0.65;
  // Sneaking (sim/vision.js): crouched low and leaning in, in shadow.
  if (t.sneaking && !silhouette) {
    ctx.transform(1, 0, -0.12, SNEAK_LOOK.squash, 0, 0);
    ctx.globalAlpha *= SNEAK_LOOK.alpha;
    if ("filter" in ctx) ctx.filter = SNEAK_LOOK.filter;
  }
  if (fig) { const g = cv.figure || FIG; ctx.drawImage(cv, -g.ox * S, -g.oy * S, g.w * S, g.h * S); } // 1 grid px = 1 art px, the feet at (ox, oy)
  else ctx.drawImage(cv, -w / 2, -hgt * 0.94, w, hgt);
  ctx.restore();
  if (cartOver) drawCartIso(ctx, cart, X, Y, S, { yaw, held: true });
}
const cartLookOf = (item) => (cartSpec(item) || {}).look || "barrow";
// A step of a walk (ui/moveanim.js strideOf) as a figure: painted when first needed, at most WALK_PAINTS new ones a
// frame (a horde setting off at once), the standing figure meanwhile (null).
const WALK_PAINTS = 4;
let walkPaints = WALK_PAINTS;
function walkFigure(state, b, t, salt, yaw, walk) {
  if (!walk || !walk.stride) return null;
  const n = figureStats.painted, fig = unitFigure(state, b, t, salt, yaw, false, { stride: walk.stride, cached: walkPaints <= 0 });
  if (figureStats.painted > n) walkPaints--;
  return fig;
}
// A parked cart's heading: one of the world's four ways, by the container (it keeps it while it stands), as a yaw.
function parkedYaw(b, c) {
  const d = [[1, 0], [0, 1], [-1, 0], [0, -1]][(((c.id || 0) * 2654435761) >>> 0) % 4];
  return dirYaw(b, c, FR.r, d);
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
// The way a unit's figure faces, as a yaw for ui/figures.js (0: the view's +u, screen right-down; 90: +v, screen
// left-down): a person's own facing (sim/vision.js u.face), else the last move's or shot's way in the battle's
// effect list, else the old default (yours toward +x, the others toward -x), turned into the view's frame. In a
// straight view the figure's own projection sits 45° off the view's axes.
function unitMoveDir(b, t) {
  const fx = b.fx || [];
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    if (f.type === "move" && f.unit === t.id) {
      const pts = [f.from, ...(f.path || [])];
      for (let k = pts.length - 1; k > 0; k--) { const dx = pts[k][0] - pts[k - 1][0], dy = pts[k][1] - pts[k - 1][1]; if (dx || dy) return [dx, dy]; }
    } else if ((f.type === "shot" || f.type === "melee") && f.from && f.from[0] === t.x && f.from[1] === t.y && f.to) { const dx = f.to[0] - f.from[0], dy = f.to[1] - f.from[1]; if (dx || dy) return [dx, dy]; }
  }
  return null;
}
function unitYaw(b, t, r, st = iso.straight) {
  const o = t.tether != null && t.piece ? partnerOf(b, t) : null; // one of a pair carrying a piece (sim/furnicarry.js): facing it, and the other
  if (o && (o.x !== t.x || o.y !== t.y)) return dirYaw(b, t, r, [o.x - t.x, o.y - t.y], st);
  return dirYaw(b, t, r, (t.face && (t.face[0] || t.face[1]) && t.kind === "human" ? t.face : null) || unitMoveDir(b, t) || [unitFacing(b, t), 0], st);
}
// A world direction at a unit's tile as a figure's yaw in view rotation r (st: a straight view).
function dirYaw(b, t, r, d, st = iso.straight) {
  const [u0, v0] = ptView(t.x + 0.5, t.y + 0.5, r, b.w, b.h), [u1, v1] = ptView(t.x + 0.5 + d[0], t.y + 0.5 + d[1], r, b.w, b.h);
  return (Math.atan2(v1 - v0, u1 - u0) * 180) / Math.PI - (st ? 45 : 0);
}
// The figures for the views a turn away (E / Q): every body drawn this frame (frameFigs), at the heading it would show
// one eighth either way, painted ahead in idle time, a few ms a slice (ui/figures.js keeps them by look and heading; a
// frame that needs one not painted yet paints it itself, as before), so the first frame after a turn of the view does
// not paint the whole scene's figures at once (75-166 ms). Queued again when the battle, its revision, the view, the
// floor or the bodies drawn change; the newest WARM_Q kept. Only with requestIdleCallback (a browser; the tools warm
// nothing).
const frameFigs = []; // [kind ("up", "down", "corpse"), the unit or body] drawn this frame
const WARM_Q = 240, WARM_MS = 4;
let warmKey = "", warmB = null, warmQ = [], warmOn = false;
function warmTurns(state, b, H) {
  if (typeof requestIdleCallback !== "function") return;
  const step = viewStep(), key = `${b.rev}|${step}|${floorNo(b)}|${H.salt}|${frameFigs.length}`;
  if (warmB === b && warmKey === key) return;
  warmB = b; warmKey = key; warmQ = [];
  const once = { up: new Set(), down: new Set(), corpse: new Set() }, figs = frameFigs.filter(([kind, t]) => !once[kind].has(t) && once[kind].add(t)); // the see-through pass draws yours twice
  for (const d of [1, -1]) {
    const k = (step + d + 8) & 7, r = ((k + 1) >> 1) & 3, st = (k & 1) === 1;
    for (const [kind, t] of figs) {
      if (kind === "up") warmQ.push(() => unitFigure(state, b, t, H.salt, unitYaw(b, t, r, st)));
      else if (kind === "down") warmQ.push(() => unitFigureDown(state, b, t, H.salt, dirYaw(b, t, r, [-unitFacing(b, t), 0], st)));
      else warmQ.push(() => corpseFigure(t, dirYaw(b, t, r, [-(t.seed % 2 ? 1 : -1), 0], st)));
    }
  }
  if (warmQ.length > WARM_Q) warmQ = warmQ.slice(-WARM_Q);
  if (!warmOn && warmQ.length) { warmOn = true; requestIdleCallback(warmSlice, { timeout: 1000 }); }
}
function warmSlice(deadline) {
  const t0 = performance.now();
  while (warmQ.length) {
    const fn = warmQ.shift();
    try { fn(); } catch { /* best effort: the frame paints it when it needs it */ }
    if (performance.now() - t0 > WARM_MS || (deadline && !deadline.didTimeout && deadline.timeRemaining() < 1)) break;
  }
  if (warmQ.length) requestIdleCallback(warmSlice, { timeout: 1000 });
  else warmOn = false;
}
// A figure's canvas with its tile centre (feet, or a lying body's middle) at (X, Y), 1 grid px = 1 art px.
function drawFigure(ctx, cv, X, Y, S, alpha = 1) {
  const g = cv.figure || FIG;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(cv, X - g.ox * S, Y - g.oy * S, g.w * S, g.h * S);
  ctx.restore();
}
const unitBig = (t) => (t.boss === "hivemind" ? 1.8 : t.boss ? 1.35 : t.ztype === "brute" || t.ztype === "shepherd" || t.ztype === "carrier" || t.ztype === "boneback" || t.ztype === "sower" || t.ztype === "deadcow" ? 1.15 : t.ztype === "crawler" || t.ztype === "swarm" || t.ztype === "deadhound" ? 0.8 : t.ztype === "deadcat" ? 0.6 : 1);
// Where a unit's gun muzzle is on screen, from its feet, in view rotation r at zoom S: the muzzle pixel of the gun
// in its sprite's hand (ui/sprites.js muzzleOf; ui/gunpaint.js paintMini: past a fitted suppressor), the sprite drawn
// as drawBody draws it (mirrored when it faces left). null: no gun drawn (a zombie, bare hands).
export function muzzlePoint(state, b, t, salt, r, S = 1) {
  const fig = unitFigure(state, b, t, salt, unitYaw(b, t, r));
  if (fig) { const m = figureMuzzle(fig), g = fig.figure || FIG; return m ? [(m.mx - g.ox) * S, (m.my - g.oy) * S] : null; } // the figure's gun, its far end (ui/figures.js)
  const mz = muzzleOf(unitCanvas(state, b, t, salt));
  if (!mz) return null;
  const hgt = UNIT_H * unitBig(t) * S, w = hgt * (22 / 26), f = sideFacing(b, t, r);
  return [f * ((mz.mx + 0.5) / 22 - 0.5) * w, -hgt * 0.94 + ((mz.my + 0.5) / 26) * hgt];
}
// A body on the ground (sim/sleepers.js), laid flat like the fallen.
function drawCorpseIso(ctx, b, c, fog) {
  const s = { wx: c.x + 0.5, wy: c.y + 0.5, z: standZ(b, c.x, c.y) };
  const [X, Y] = feet(s), f = c.seed % 2 ? 1 : -1;
  const fig = corpseFigure(c, dirYaw(b, c, FR.r, [-f, 0]));
  frameFigs.push(["corpse", c]);
  if (fig) { drawFigure(ctx, fig, X, Y, FR.S, fog ? 0.5 : 0.92); return; }
  const [x1, y1] = project(s.wx + 1, s.wy, s.z), [x2, y2] = project(s.wx, s.wy + 1, s.z);
  drawDowned(ctx, corpseCanvas(c), X, Y, [x1 - X, y1 - Y], [x2 - X, y2 - Y], { facing: f, scale: 1.05, alpha: fog ? 0.5 : 0.92 });
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
// ---------- a piece of furniture carried (sim/furnicarry.js; issue #17) ----------
// Alone the piece is in the figure (ui/figures.js carryLook, paintBoxFigure). A pair's is drawn once, between them, by
// whichever of the two is nearer the viewer (just before its body: over the far one, under the near one): its own
// picture (carriedPrims) at CARRY_SCALE, its long side along the line between them, its middle on the midpoint at the
// hands' height (CARRY_VIEW.HAND art px up, its middle there); a 1-cell piece leaves a gap, so a 1-px line in their
// ring's colour joins the hands under it (the tether). carryFrame: the pieces drawn this frame (the CARRY tag, the tools).
export const CARRY_VIEW = { HAND: 14, REACH: 0.3, SWAY_MS: 760 }; // the hands' height (art px); how far toward the other they reach (tiles); a heavy piece's bob, half the walk's rate
export const carryFrame = { pair: 0, shown: new Set() };
export const carryProbe = { unitYaw: (b, t) => unitYaw(b, t, FR.r), dirYaw: (b, t, d) => dirYaw(b, t, FR.r, d) }; // tools/carryviewtest.js
let frameShown = [];
function carriedSprite(k, ax) {
  const key = `carried|${iso.straight ? "s" : ""}|${k}|${ax}`;
  let spr = spriteGet(key);
  if (spr === undefined) { const p = carriedPrims(k, ax); spr = p.length ? paint(p, { st: iso.straight }) : null; spritePut(key, spr); }
  return spr;
}
function drawPairPiece(ctx, b, s) {
  const t = s.t, o = partnerOf(b, t), P = o ? carriedPiece(b, t) : null;
  if (!P) return;
  const so = frameShown.find((q) => q.t === o);
  if (!so) return;
  const [X0, Y0] = feet(s), [X1, Y1] = feet(so);
  if (so.d > s.d || (so.d === s.d && (Y1 > Y0 || (Y1 === Y0 && o.id > t.id)))) return; // the nearer one draws it
  const k = P.def.kind, S = FR.S, K = CARRY_SCALE, r = FR.r;
  const [u0, v0] = ptView(s.wx, s.wy, r, b.w, b.h), [u1, v1] = ptView(so.wx, so.wy, r, b.w, b.h);
  const ax = Math.abs(u1 - u0) >= Math.abs(v1 - v0) ? "u" : "v", spr = carriedSprite(k, ax);
  if (!spr) return;
  const mx = (s.wx + so.wx) / 2, my = (s.wy + so.wy) / 2, z = (s.z + so.z) / 2, top = carriedTop(k) * K;
  const d = FURNITURE_KINDS[k], one = !d || d.size[0] * d.size[1] < 2;
  if (one) { // the tether: hand to hand, under the piece
    const dx = so.wx - s.wx, dy = so.wy - s.wy, n = Math.hypot(dx, dy) || 1, q = CARRY_VIEW.REACH / n;
    const [hx0, hy0] = project(s.wx + dx * q, s.wy + dy * q, s.z + CARRY_VIEW.HAND), [hx1, hy1] = project(so.wx - dx * q, so.wy - dy * q, so.z + CARRY_VIEW.HAND);
    ctx.strokeStyle = ringOf(t); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(hx0, hy0); ctx.lineTo(hx1, hy1); ctx.stroke();
  }
  const [X, Y] = project(mx, my, z + Math.max(1, CARRY_VIEW.HAND - top / 2));
  const [cu, cv] = carriedMid(k, ax), st = iso.straight, cx = artX(cu, cv, st), cy = artY(cu, cv, st);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(spr.cv, X + (spr.ox - cx) * S * K, Y + (spr.oy - cy) * S * K, spr.w * S * K, spr.h * S * K);
  ctx.restore();
  carryFrame.pair++;
  carryFrame.shown.add(t.id); carryFrame.shown.add(o.id);
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
  if (t.tether != null && t.piece && !t.dead && !t.down) drawPairPiece(ctx, b, s);
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
    const big = t.size === 2 ? 2.2 : t.boss ? 1.35 : t.ztype === "brute" ? 1.15 : 1, hgt = UNIT_H * big * S; // a 2 × 2 boss: its whole model
    iso.rects.push({ x0: X - hgt * 0.36, x1: X + hgt * 0.36, y0: Y - hgt * 0.94, y1: Y, x: t.x, y: t.y, id: t.id });
  }
}
function drawGhost(ctx, state, b, q, H) {
  const s = { t: q.unit, wx: q.x + 0.5, wy: q.y + 0.5, z: standZ(b, q.x, q.y) };
  const [X, Y] = feet(s), S = FR.S;
  if (q.noise) { // a shot or a blast heard, not seen (sim/crossfire.js): sound arcs, the sound's tag and a "?", fading with age
    const a = q.age ? Math.max(0.35, 1 - 0.3 * q.age) : 1;
    const col = q.noise === "flash" ? `rgba(255,245,200,${0.9 * a})` : q.noise === "blast" ? `rgba(255,150,90,${0.9 * a})` : `rgba(255,120,100,${0.9 * a})`;
    ctx.strokeStyle = col; ctx.lineWidth = 1.5;
    for (const k of [6, 10, 14]) { ctx.beginPath(); ctx.arc(X, Y - 8 * S, k * S, -Math.PI * 0.35, Math.PI * 0.35); ctx.stroke(); ctx.beginPath(); ctx.arc(X, Y - 8 * S, k * S, Math.PI * 0.65, Math.PI * 1.35); ctx.stroke(); }
    ctx.font = `800 ${Math.max(12, Math.round(5 * S))}px Segoe UI, sans-serif`;
    ctx.textAlign = "center"; ctx.lineWidth = 3; ctx.strokeStyle = `rgba(0,0,0,${0.8 * a})`; ctx.fillStyle = col;
    ctx.strokeText("?", X, Y - 5 * S); ctx.fillText("?", X, Y - 5 * S);
    ctx.font = `700 ${Math.max(9, Math.round(3.2 * S))}px Segoe UI, sans-serif`;
    ctx.strokeText(q.tag || "NOISE?", X, Y - 16 * S); ctx.fillText(q.tag || "NOISE?", X, Y - 16 * S);
    return;
  }
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
  // Another group's people on a raid's map (sim/parley.js): ⚔ while actively hostile, else the word (Truce, Allied …);
  // an amber ! when the sim says one of yours sees through them (status.tell, nothing else).
  const g = b.raid && t.side !== "player" && !t.down ? parleyStatus(b, t) : null;
  if (g) tags.push(g.active ? ["⚔", g.color || COL.bad, true] : [String(g.label || "").toUpperCase(), g.color || "#e9d98f"]); // true: a filled pill
  const ao = H.allyMarks && H.allyMarks.icons && H.allyMarks.icons.get(t.id);
  if (ao) tags.push([ao, ALLY_COL]); // an ally under your orders (sim/allyorders.js): the order's icon
  if (g && g.tell) tags.push(["!", "#f0b44a", true]); // a tell (parleyStatus.tell: one of yours saw through them, and they give themselves away now)
  if (t.down && !t.surr) tags.push([t.ko ? (t.tied ? "TIED" : "ZZ") : t.stab ? "+" : "!", t.ko ? "#9aa0a8" : t.stab ? COL.good : COL.bad]); // surr: its own tag (ui/nonlethal.js)
  else if (t.tied && !t.down) tags.push(["TIED", "#c9a74a"]); // a captive of yours tied up on a rescue raid (sim/rescueraid.js)
  if (t.ztype && !t.down) tags.push([`${t.short}${t.elite ? "★" : ""}`, ringOf(t)]);
  if (!t.down && isMedic(t)) tags.push(["✚", "#ff6b6b"]); // a medic (sim/medics.js)
  if (t.side === "player" && t.vol != null && !t.dead) tags.push(["VOL", "#c9a2ff"]); // a volunteer from an allied group: their own orders (sim/volunteers.js)
  if (t.dragging != null) tags.push(["DRAG", "#e0a84f"]);
  if (t.piece && !t.down && !carryFrame.shown.has(t.id)) tags.push(["CARRY", "#e0a84f"]); // a piece in the arms not drawn (a flat sprite, the other one of a pair out of the picture)
  if (t.shaken && !t.down) tags.push(["SHK", "#ffd166"]); // revived: shaken, −10 aim
  if (t.boss && !t.down) tags.push([t.boss === "broodmother" ? "BROOD" : t.boss === "hivemind" ? "MIND" : "WALL", COL.bad]);
  if (t.ow) tags.push(["OW", "#e0a84f"]);
  if (t.hunker) tags.push(["HD", "#4aa3ff"]);
  if (t.floored && !t.down && !t.dead) tags.push(["FLAT", "#ffd166"]); // shoved flat on their back (sim/shoving.js): an action to get up
  if (t.heldBy != null && !t.down && !t.dead) tags.push(["HELD", "#ff8f85"]); // one of the dead has hold of them (sim/shoving.js gripOf)
  if (t.stun && !t.down && !t.dead) tags.push(t.stun.dazed ? ["DZ", "#cfd6e0"] : ["STN", "#ffffff"]); // a flashbang (sim/throwables.js)
  if (t.side === "enemy" && !t.aware && !t.ko && !(g && g.label === "Unaware" && !t.investigate)) tags.push(t.investigate ? ["??", "#e0a84f"] : ["?", "#ffd166"]);
  if (t.side === "player" && t.post && b.phase === "deploy") tags.push([t.post === "gate" ? "G" : t.post === "wall" ? "W" : t.post === "tower" ? "T" : "P", "#e0a84f"]);
  if (t.surprised) tags.push(["!", "#ffd166"]);
  tags.push(...nlTags(t)); // stunned, blinded, hands up, pulling blows (ui/nonlethal.js)
  if (hh && !t.down) tags.push([hh > 0 ? "▲".repeat(hh) : "▼".repeat(-hh), "#ffe296"]); // ▼: down in a hollow (sim/ponds.js: wading in its pond)
  ctx.font = `700 ${fs}px Segoe UI, sans-serif`;
  let tx = X - bw / 2;
  for (const [txt, col, fill] of tags) {
    const w = ctx.measureText(txt).width + 6;
    ctx.fillStyle = fill ? col : "rgba(15,17,20,0.9)"; rr(ctx, tx, by - fs - 4, w, fs + 2, 3); ctx.fill();
    ctx.fillStyle = fill ? "#1a0f0e" : col; ctx.textAlign = "left"; ctx.fillText(txt, tx + 3, by - 5);
    tx += w + 2;
  }
  // The hit chance of the selected unit against each enemy in sight (X-COM's labels).
  if (t.side === "enemy" && active(t) && H.hits && H.hits.has(t.id)) {
    const o = H.hits.get(t.id);
    const col = o.chance >= 65 ? COL.good : o.chance >= 35 ? COL.mid : COL.bad;
    tag(ctx, `${o.chance}%`, X + bw / 2 + 14, by + 4, col, fs);
  }
}

// ---------- orders to allies (ui/combat.js allyMarks, sim/allyorders.js) ----------
// Only what your people set or see: a flag on a tile you sent an ally to (wherever it is, the fog too), a thin dashed
// line to it from an ally your people see, a crosshair on a target they see; while picking, the reach (shaded), the
// allies in it, the tile under the mouse. Nothing an ally sees is drawn.
const ALLY_COL = "#4fe08a"; // sim/parley.js's Allied
function drawAllyGround(ctx, b, M) {
  for (const m of M.intel || []) drawIntelMark(ctx, b, m, FR.S); // Tell me what you see: told, not seen
  if (M.ring) {
    const { x: rx, y: ry, r } = M.ring;
    fillCells(ctx, b, (i) => Math.hypot((i % b.w) - rx, ((i / b.w) | 0) - ry) <= r, "rgba(79,224,138,0.07)");
  }
  if (M.pick && M.pick.length) {
    ctx.strokeStyle = M.color || ALLY_COL; ctx.lineWidth = 2; ctx.beginPath();
    for (const t of M.pick) if (onFloor(b, t)) diamond(ctx, t.x, t.y, tileTop(b, t.x, t.y), 1.5);
    ctx.stroke();
  }
}
// What an ally told your people is in the fog (sim/allyorders.js allyIntel; ui/combat.js keeps only the fogged cells):
// a dim, dashed shadow of what it is with a "?" over it; the fog stays as it is.
const INTEL_TINT = { zombie: "181,211,106", person: "200,214,232" }; // the dead green, people pale
function isoBox(ctx, b, x0, y0, x1, y1, z0, z1) { // the outline of a box on the ground (cells), its top filled
  const p = (x, y, z) => project(x, y, z), top = [p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1)], bot = [p(x0, y0, z0), p(x1, y0, z0), p(x1, y1, z0), p(x0, y1, z0)];
  ctx.beginPath(); top.forEach(([X, Y], i) => (i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y))); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); bot.forEach(([X, Y], i) => (i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y))); ctx.closePath();
  for (let i = 0; i < 4; i++) { ctx.moveTo(...top[i]); ctx.lineTo(...bot[i]); }
  ctx.stroke();
}
function drawIntelMark(ctx, b, m, S) {
  const { x, y } = m, z = tileTop(b, x, y), [X, Y] = project(x + 0.5, y + 0.5, z);
  const rgb = INTEL_TINT[m.kind] || "190,226,200";
  ctx.save();
  ctx.fillStyle = `rgba(${rgb},0.2)`; ctx.strokeStyle = `rgba(${rgb},0.7)`; ctx.lineWidth = 1.4; ctx.setLineDash([3, 3]);
  let top = Y - 14 * S;
  if (m.kind === "zombie" || m.kind === "person") { // a figure: the head, the body
    const lean = m.kind === "zombie" ? 2 * S : 0;
    ctx.beginPath(); ctx.ellipse(X, Y, 7 * S, 3.2 * S, 0, 0, Math.PI * 2); ctx.stroke();
    rr(ctx, X - 4 * S + lean, Y - 21 * S, 8 * S, 19 * S, 3 * S); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(X + lean * 1.5, Y - 25 * S, 3.6 * S, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    top = Y - 30 * S;
  } else if (m.kind === "door" || m.kind === "window") { // a frame (a window's with its cross bar, higher up)
    const lo = m.kind === "door" ? Y : Y - 10 * S, hi = m.kind === "door" ? Y - 24 * S : Y - 22 * S, w = (m.kind === "door" ? 6 : 7) * S;
    ctx.fillRect(X - w, hi, 2 * w, lo - hi); ctx.strokeRect(X - w, hi, 2 * w, lo - hi);
    if (m.kind === "window") { ctx.beginPath(); ctx.moveTo(X, hi); ctx.lineTo(X, lo); ctx.moveTo(X - w, (hi + lo) / 2); ctx.lineTo(X + w, (hi + lo) / 2); ctx.stroke(); }
    top = hi - 4 * S;
  } else if (m.kind === "vehicle") { // a car: the body, the cabin
    isoBox(ctx, b, x + 0.06, y + 0.22, x + 0.94, y + 0.78, z, z + 7);
    isoBox(ctx, b, x + 0.3, y + 0.28, x + 0.72, y + 0.72, z + 7, z + 12);
    top = Y - 20 * S;
  } else if (m.kind === "body") isoBox(ctx, b, x + 0.15, y + 0.35, x + 0.85, y + 0.65, z, z + 2.5); // someone lying there
  else { const k = m.kind === "item" ? 0.32 : 0.22; isoBox(ctx, b, x + k, y + k, x + 1 - k, y + 1 - k, z, z + (m.kind === "item" ? 4 : 9)); } // a crate, a thing
  ctx.setLineDash([]);
  ctx.font = `800 ${Math.max(13, Math.round(5.2 * S))}px Segoe UI, sans-serif`; ctx.textAlign = "center";
  ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.75)"; ctx.fillStyle = "rgba(190,236,206,0.92)";
  ctx.strokeText("?", X, top); ctx.fillText("?", X, top);
  ctx.restore();
}
// A flag on a tile: a pole and a pennant, the tile outlined, dashed.
function allyFlag(ctx, b, x, y, S, alpha = 1) {
  const z = tileTop(b, x, y);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = ALLY_COL; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
  ctx.beginPath(); diamond(ctx, x, y, z, 2); ctx.stroke(); ctx.setLineDash([]);
  const [X, Y] = project(x + 0.5, y + 0.5, z), top = Y - UNIT_H * 0.9 * S;
  ctx.strokeStyle = "rgba(15,17,20,0.9)"; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X, top); ctx.stroke();
  ctx.strokeStyle = "#d8e8dc"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X, top); ctx.stroke();
  const pw = Math.max(9, 5 * S), ph = Math.max(7, 3.6 * S);
  ctx.fillStyle = ALLY_COL; ctx.beginPath(); ctx.moveTo(X, top); ctx.lineTo(X + pw, top + ph / 2); ctx.lineTo(X, top + ph); ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 1;
}
// A crosshair on a target: a ring and four ticks at the chest.
function allyCross(ctx, b, x, y, n, S, alpha = 1) {
  const [X, Y] = project(x + n / 2, y + n / 2, standZ(b, x, y) + UNIT_H * 0.55), R = Math.max(7, 4.2 * S) * n;
  ctx.globalAlpha = alpha; ctx.strokeStyle = ALLY_COL; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(X, Y, R, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(X + dx * R * 0.5, Y + dy * R * 0.5); ctx.lineTo(X + dx * R * 1.4, Y + dy * R * 1.4); }
  ctx.stroke(); ctx.globalAlpha = 1;
}
// A thin dashed line from the ally (cells, their middle) to a tile or a unit.
function allyLine(ctx, b, from, x, y, z, alpha = 1) {
  const [x0, y0] = from, fx = Math.max(0, Math.min(b.w - 1, Math.floor(x0))), fy = Math.max(0, Math.min(b.h - 1, Math.floor(y0)));
  const [X0, Y0] = project(x0, y0, standZ(b, fx, fy) + UNIT_H * 0.3), [X1, Y1] = project(x, y, z);
  ctx.globalAlpha = alpha; ctx.strokeStyle = ALLY_COL; ctx.lineWidth = 1.2; ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.moveTo(X0, Y0); ctx.lineTo(X1, Y1); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
}
function drawAllyMarks(ctx, b, M) {
  const S = FR.S, inMap = (x, y) => x >= 0 && y >= 0 && x < b.w && y < b.h;
  for (const f of M.flags || []) {
    if (!inMap(f.x, f.y)) continue;
    if (f.from) allyLine(ctx, b, f.from, f.x + 0.5, f.y + 0.5, tileTop(b, f.x, f.y), 0.8);
    allyFlag(ctx, b, f.x, f.y, S);
  }
  for (const t of M.cross || []) {
    if (t.from) allyLine(ctx, b, t.from, t.x + t.size / 2, t.y + t.size / 2, standZ(b, t.x, t.y) + UNIT_H * 0.45, 0.6);
    allyCross(ctx, b, t.x, t.y, t.size, S);
  }
  const h = M.hover;
  if (h && inMap(h.x, h.y)) {
    if (h.unit) { allyLine(ctx, b, h.from, h.x + h.size / 2, h.y + h.size / 2, standZ(b, h.x, h.y) + UNIT_H * 0.45, 0.9); allyCross(ctx, b, h.x, h.y, h.size, S, 0.9); }
    else { allyLine(ctx, b, h.from, h.x + 0.5, h.y + 0.5, tileTop(b, h.x, h.y), 0.9); allyFlag(ctx, b, h.x, h.y, S, 0.65); }
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
    // sim/caralarms.js: a car alarm going off ("alarm"), stopping ("alarmoff"): no text of their own, not a miss.
    const text = f.text ? f.text : f.type === "alarm" ? "ALARM!" : f.type === "alarmoff" ? "quiet" : f.type === "heal" ? "+" : f.hit ? `${f.crit ? "CRIT " : ""}-${f.dmg}` : "MISS";
    ctx.font = `800 ${Math.round(Math.max(12, (f.crit ? 5.4 : 4.6) * S))}px Segoe UI, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillStyle = f.type === "alarm" || f.type === "alarmoff" ? `rgba(255,170,60,${a})` : f.type === "loot" ? `rgba(255,209,102,${a})` : f.type === "heal" ? `rgba(${COL.goodRgb},${a})` : f.acid ? `rgba(170,230,70,${a})` : f.hit ? `rgba(255,${f.crit ? 210 : 110},90,${a})` : `rgba(210,210,210,${a})`;
    ctx.strokeStyle = `rgba(0,0,0,${a})`; ctx.lineWidth = 3;
    const y = ty - UNIT_H * 0.7 * S - (el / 1400) * 14 * S;
    ctx.strokeText(text, tx, y); ctx.fillText(text, tx, y);
  }
}
onForgetPictures(() => clearIsoCache()); // ui/pictures.js: after a lost GPU context the kept ground, fog and sprites are blank; drawn again
