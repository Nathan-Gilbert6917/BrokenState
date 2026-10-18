// Light inside a raid's buildings (the user's request of 2026-10-12: "Barns are dark inside; buildings can have light
// switches to turn on/off lights", and with the lights off survivors "see as much as they can based on the day
// time/building lighting").
//
// Rooms: every room of a raid's building is one of b.raid.areas (a building's own map, buildingmaps.js: its rooms on
// every floor, a.f; the street map, combat.js genRaidMap: one room a building), a rectangle x0, y0, w, h with its walls
// round it. Its floor cells (inside the walls) are lit or dark:
//   - lit by day (daylight through the windows), except the DARK rooms: a barn's (barn floor, hayloft, tack room; a
//     street map's barn by its area type), a storeroom and the windowless back rooms (ROLES windows: false: a pantry,
//     a restroom, a gun room, a dispensary, a pharmacy's back room, an armory or gun cage, the evidence room), dark even
//     at noon (a.dark);
//   - at night (b.night) every room is dark unless its lights are on (a.on).
//   A wall, door or window cell between two rooms (or a room and the outside) takes the lighter side: a lit room's
//   doorway is lit, a dark room's wall onto the street is the street's (by day lit, at night the night's own).
// Sight (combat.js canSeeAt): what counts is the light on the cell looked at, wherever the one looking stands (from a
//   dark barn you see the sunlit yard through the door; from the yard you do not see into the barn). A lit room is seen
//   as by day, at night too (as the floodlit cells are: everyone sees all round out to their daylight sight); a dark
//   one only as at night (vision.js): someone with a front down the dark cone ahead (DARK tiles, less at dusk outside:
//   min(the hour's darkSight, DARK)) and the cells right round them, a switched-on light's beam or pool, night vision
//   the day's sight down that cone; the dead and anyone without a front all round, ROUND tiles at most. Both sides
//   alike: an unaware guard notices someone standing in a dark room as at night (stealth.js noticeRange: × NIGHT_DETECT,
//   a light carried seen further) and someone in a lit room at night as by day. A guard in a room whose lights go on
//   sees it as by day (and notices whoever stands in it: combat.js runs the noticing check when they come on).
// Switches: every room with power has one (a.sw = [x, y]: a wall cell beside one of its doors, the inside of the
//   wall; a.swIn: the floor cell in front of it). A barn has no power: no switch (its rooms stay dark). Lights (act
//   "lights", 1 action: a deliberate act, a hand on the switch; act.area picks the room when two are in reach) flips
//   them on or off from next to the switch (any of the 8 cells round it, inside that room or in its doorway; facing
//   it is not needed). Quiet: no noise and no Heat, but a lit room is seen by anyone looking in. Rooms start dark at
//   night and unlit by day. The state lives on the areas (a.on, a.dark, a.sw: plain values, saved with the battle);
//   b.indoor marks a raid set up with them (a save from before has none: every cell keeps the old rules).
// Not changed: battles that are not raids (your own base's, a field fight), every outdoor cell (the battle's own day
//   or night, flares and floodlights as before). No dice (no b.rng, no hash01 needed: the switch's place is the first
//   free wall cell beside a door).
import { LIGHTS } from "./lights.js";
import { VISION, hasFront, faceAng, angDiff, darkSight, activeLight, nvgOn } from "./vision.js";
import { CELL } from "./combat.js";

const D = Math.PI / 180;
export const INDOOR = {
  DARK: 4,   // tiles ahead down the cone in an unlit room (the dead of night's)
  ROUND: 5,  // the dead and anyone with no front, all round in an unlit room
  AP: 1,     // flipping a switch
  UNPOWERED: ["barnfloor", "hayloft", "tack"], // a barn's rooms: no wiring, no switch
  DARK_ROLES: ["barnfloor", "hayloft", "tack", "storage", "pantry", "restroom", "gunroom", "dispensary", "pharmroom", "armory", "evidence"], // dark even by day
  DARK_TYPES: ["barn"], // a street map's buildings (no roles): by their area type
};
export const LIT = 1, DARK = 2; // lightAt: 0 outdoors (the battle's own rules)

// A room of a building (not an outdoor area: wrecks, pumps, a campsite, the cars on the road).
const isRoom = (a) => !!a && !a.outdoor && a.x0 != null && a.w > 2 && a.h > 2;
const inner = (a, x, y) => x > a.x0 && x < a.x0 + a.w - 1 && y > a.y0 && y < a.y0 + a.h - 1;
const onRect = (a, x, y) => x >= a.x0 && x <= a.x0 + a.w - 1 && y >= a.y0 && y <= a.y0 + a.h - 1;
const cellsOf = (b, f) => (b.floors && b.floors[f] ? b.floors[f].cells : b.cells);

// Is a room lit now? Its lights on, or by day one with windows.
export const roomLit = (b, a) => !!a.on || (!b.night && !a.dark);

// ---------- setup (combat.js createRaid, after stealth.js has set the night) ----------
export function indoorSetup(b) {
  if (!b || !b.raid || !Array.isArray(b.raid.areas)) return;
  const used = new Set();
  for (const a of b.raid.areas) {
    if (!isRoom(a)) continue;
    a.dark = a.role ? INDOOR.DARK_ROLES.includes(a.role) : INDOOR.DARK_TYPES.includes(a.type);
    a.on = false;
    const powered = a.role ? !INDOOR.UNPOWERED.includes(a.role) : !INDOOR.DARK_TYPES.includes(a.type);
    const sw = powered ? switchSpot(b, a, used) : null;
    a.sw = sw ? sw.at : null;
    a.swIn = sw ? sw.inside : null;
    if (sw) used.add(`${a.f || 0}:${sw.at[0]},${sw.at[1]}`);
  }
  b.indoor = 1;
  CACHE.delete(b);
}
// The switch: a plain wall cell of the room's own wall right beside one of its doors (the first that has floor in
// front of it inside the room), else any such wall cell; null when there is none.
function switchSpot(b, a, used) {
  const f = a.f || 0, cells = cellsOf(b, f);
  if (!cells) return null;
  const W = b.w, H = b.h, x1 = a.x0 + a.w - 1, y1 = a.y0 + a.h - 1;
  const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? cells[y * W + x] : null);
  // The inside cell in front of a wall cell of this room (null on a corner or off the wall).
  const front = (x, y) => {
    const corner = (x === a.x0 || x === x1) && (y === a.y0 || y === y1);
    if (corner) return null;
    if (y === a.y0) return [x, y + 1];
    if (y === y1) return [x, y - 1];
    if (x === a.x0) return [x + 1, y];
    if (x === x1) return [x - 1, y];
    return null;
  };
  const ok = (x, y) => {
    const c = at(x, y), fr = front(x, y);
    if (!c || c.k !== "wall" || !fr || used.has(`${f}:${x},${y}`)) return null;
    const fc = at(fr[0], fr[1]);
    return fc && CELL[fc.k] && CELL[fc.k].walk ? { at: [x, y], inside: fr } : null;
  };
  for (const d of a.doors || []) {
    const dx = Array.isArray(d) ? d[0] : d.x, dy = Array.isArray(d) ? d[1] : d.y;
    if (dx == null || dy == null) continue;
    const along = dy === a.y0 || dy === y1 ? [[dx - 1, dy], [dx + 1, dy]] : [[dx, dy - 1], [dx, dy + 1]];
    for (const [x, y] of along) { const s = ok(x, y); if (s) return s; }
  }
  for (let x = a.x0 + 1; x < x1; x++) for (const y of [y1, a.y0]) { const s = ok(x, y); if (s) return s; }
  for (let y = a.y0 + 1; y < y1; y++) for (const x of [a.x0, x1]) { const s = ok(x, y); if (s) return s; }
  return null;
}

// ---------- which room a cell is in ----------
// Per floor: own[i] the index (in b.raid.areas) of the room whose floor the cell is, -1 none; edge: the cells of the
// rooms' walls → { rooms: [indices], out: it borders the outside }. Only a cache (rebuilt after a load).
const CACHE = new WeakMap();
function grid(b, f) {
  let C = CACHE.get(b);
  if (!C || C.areas !== b.raid.areas || C.w !== b.w || C.h !== b.h) { C = { areas: b.raid.areas, w: b.w, h: b.h, f: {} }; CACHE.set(b, C); }
  if (C.f[f]) return C.f[f];
  const W = b.w, H = b.h, own = new Int16Array(W * H).fill(-1), edge = new Map();
  b.raid.areas.forEach((a, k) => {
    if (!isRoom(a) || (a.f || 0) !== f) return;
    for (let y = Math.max(0, a.y0); y <= Math.min(H - 1, a.y0 + a.h - 1); y++) for (let x = Math.max(0, a.x0); x <= Math.min(W - 1, a.x0 + a.w - 1); x++) {
      const i = y * W + x;
      if (inner(a, x, y)) own[i] = k;
      else { const e = edge.get(i) || { rooms: [], out: false }; e.rooms.push(k); edge.set(i, e); }
    }
  });
  for (const [i, e] of edge) {
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) { e.out = true; break; }
      const j = ny * W + nx;
      if (own[j] < 0 && !edge.has(j)) { e.out = true; break; }
    }
  }
  return (C.f[f] = { own, edge });
}
// The room whose floor (x, y) is on floor f (the active one by default), or null.
export function roomAt(b, x, y, f = b && b.floor ? b.floor : 0) {
  if (!b || !b.indoor || !b.raid || x < 0 || y < 0 || x >= b.w || y >= b.h) return null;
  const k = grid(b, f).own[y * b.w + x];
  return k >= 0 ? b.raid.areas[k] : null;
}
// How (x, y) on floor f is lit: 0 outdoors (the battle's own day or night), LIT, DARK.
export function lightAt(b, x, y, f = b && b.floor ? b.floor : 0) {
  if (!b || !b.indoor || !b.raid || x < 0 || y < 0 || x >= b.w || y >= b.h) return 0;
  const G = grid(b, f), i = y * b.w + x, k = G.own[i];
  if (k >= 0) return roomLit(b, b.raid.areas[k]) ? LIT : DARK;
  const e = G.edge.get(i);
  if (!e) return 0;
  if (e.rooms.some((r) => roomLit(b, b.raid.areas[r]))) return LIT;
  return e.out ? 0 : DARK;
}
// Is (x, y) in the dark (an unlit room, or outdoors at night)? stealth.js noticeRange, search.js.
export function darkAt(b, x, y, f) {
  const lt = lightAt(b, x, y, f);
  return lt ? lt === DARK : !!(b && b.night);
}

// ---------- sight ----------
// Does a see the cell (x, y), d tiles off, lit as lt (LIT / DARK)? Range and direction only (combat.js canSeeAt does
// the line of sight). range: a's sight from where it stands (combat.js sightRange: height, optics); day: the same with
// its daylight sight (a lit room at night is seen as by day).
export function indoorSees(b, a, x, y, d, lt, range, day) {
  if (lt === LIT) return d <= (b.night ? Math.max(range, day) : range) + 1e-6;
  const extra = range - a.sight;
  if (!hasFront(a)) return d <= (nvgOn(a) ? range : Math.min(range, INDOOR.ROUND)) + 1e-6;
  const L = activeLight(a) ? LIGHTS[activeLight(a)] : null;
  const near = Math.max(VISION.NEAR, L && L.round ? L.pool || 0 : 0);
  if (d <= near + 1e-6) return true;
  const to = Math.atan2(y - a.y, x - a.x), ang = faceAng(a);
  const dark = (nvgOn(a) ? a.daySight ?? a.sight : Math.min(darkSight(b), INDOOR.DARK)) + extra;
  if (d <= dark + 1e-6 && angDiff(to, ang) <= VISION.NIGHT_HALF + 1e-6) return true;
  return !!(L && !L.round && d <= L.sight + extra + 1e-6 && angDiff(to, ang) <= (L.beam || 20) * D + 1e-6);
}

// ---------- switches ----------
// The switches a unit can reach now: rooms on its floor whose switch is one of the 8 cells round it, standing inside
// that room or in one of its doorways.
export function switchOptions(b, u) {
  if (!b || !b.indoor || !b.raid || !u) return [];
  const f = u.f || 0;
  return b.raid.areas.filter((a) => isRoom(a) && a.sw && (a.f || 0) === f && Math.max(Math.abs(a.sw[0] - u.x), Math.abs(a.sw[1] - u.y)) <= 1
    && (inner(a, u.x, u.y) || (onRect(a, u.x, u.y) && (a.doors || []).some((d) => (Array.isArray(d) ? d[0] === u.x && d[1] === u.y : d.x === u.x && d.y === u.y)))));
}
// The room whose switch is on (x, y) of floor f, or null.
export function switchAt(b, x, y, f = b && b.floor ? b.floor : 0) {
  if (!b || !b.indoor || !b.raid) return null;
  return b.raid.areas.find((a) => isRoom(a) && a.sw && (a.f || 0) === f && a.sw[0] === x && a.sw[1] === y) || null;
}
// Lights (act "lights"): flips the room's lights. act.area: the room's id (else the one in reach), or act.x / act.y:
// its switch. Returns { room } (flipped) or { err }; the caller spends the action and runs the noticing check.
export function lightsAct(b, u, act = {}) {
  if (!b || !b.indoor) return { err: "No light switches here." };
  const opts = switchOptions(b, u);
  const a = act.area != null ? opts.find((o) => o.id === Number(act.area)) : act.x != null ? opts.find((o) => o.sw[0] === Number(act.x) && o.sw[1] === Number(act.y)) : opts[0];
  if (!a) return { err: opts.length || !switchNear(b, u) ? "Stand next to a light switch (in the room or its doorway) to flip it." : "Reach the switch from inside the room (or its doorway)." };
  if (u.ap < INDOOR.AP) return { err: "Not enough actions." };
  a.on = !a.on;
  return { room: a };
}
const switchNear = (b, u) => b.raid.areas.some((a) => isRoom(a) && a.sw && (a.f || 0) === (u.f || 0) && Math.max(Math.abs(a.sw[0] - u.x), Math.abs(a.sw[1] - u.y)) <= 1);
// Words for the panel and the hover text: "on" / "off".
export const switchWord = (a) => (a && a.on ? "on" : "off");

// ---------- drawing (ui) ----------
// The floor cells of the dark rooms on the active floor (by day: the shade over them) and of the rooms lit by their
// lights (at night: their warm light), as cell indices.
export function roomCells(b, which) {
  const out = [];
  if (!b || !b.indoor || !b.raid) return out;
  const f = b.floor || 0;
  for (const a of b.raid.areas) {
    if (!isRoom(a) || (a.f || 0) !== f) continue;
    const want = which === "dark" ? !roomLit(b, a) : !!a.on && b.night;
    if (!want) continue;
    for (let y = Math.max(0, a.y0 + 1); y < Math.min(b.h, a.y0 + a.h - 1); y++) for (let x = Math.max(0, a.x0 + 1); x < Math.min(b.w, a.x0 + a.w - 1); x++) out.push(y * b.w + x);
  }
  return out;
}
