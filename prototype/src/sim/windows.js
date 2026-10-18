// Windows on the battle maps (the user's request of 2026-10-17; ui/windows.js is the panel layout, not this). Every
// window cell carries a state, c.win = { open, lock: "none" | "locked" | "fixed", known }, rolled where the map is made
// (buildingmaps.js assemble, combat.js genMap and genRaidMap, interior.js layInterior) from hash dice of the map's own
// seed (no world dice consumed; an old save's window with no state is a closed, unlocked one). Plain data on the cell:
// saved and loaded as is.
//   unlocked   opens from either side
//   locked     opens from the inside only (insideOf: a room, a house's floor, the base's buildings)
//   fixed      never opens: it can only be broken
// Checking a window is free and tells which (c.win.known, the tooltip and the log). Opening or closing costs one action
// and is quiet; breaking is loud at the FORCE scale (locks.js): the raid's noise, Heat, the unaware within BREAK.radius
// wake (combat.js alertNear). A melee blow on a window (combat.js bash → breakCell) breaks it the same way. A broken
// window is the "smashed" cell: half cover, nobody stands in it, vaulted through like an open one (combat.js VAULT); a
// closed one can be vaulted too, but the vault crashes through it: loud, and the vaulter is cut (HURT), the quick way
// out. The bottom half of a window is half cover in every state (CELL window / smashed cover 1). Shots and sight pass
// through a window in every state (CELL los false); a throw passes an open or broken one (buildingmaps.js
// throwBlocks). The dead clamber through an open or broken window at the vault's cost (reachable, distField), never
// a closed one (on a base's map they batter it: its hit points).
//
//   WINDOW             the numbers (OPEN_AP, BREAK, HURT, SMASH_COST, MIX)
//   windowState(c)     { open, lock, known, broken } of a window or smashed cell, null for anything else
//   windowOpen(c)      a broken window, or an open one
//   isWindow(c)        a window cell, open, closed or broken
//   rollWin(seed, mix, ...keys)   a fresh state from hash dice; winMixOf(key) the mix for a building's archetype
//   insideOf(b, x, y)  is this cell indoors (a room, a house's floor, a base building's inside)?
//   windowsBy(b, u)    the windows next to the unit (not diagonally): [{ x, y, c, inside }]
//   windowAct(state, b, u, act, H)  combatAct "checkwindow" | "openwindow" | "closewindow" | "breakwindow"
//   openRefusal(b, u, c, inside)    why the window cannot be opened from where the unit stands ("" when it can)
//   smashWindow(b, c)  the cell becomes "smashed" (quiet: the noise is glassNoise's)
//   glassNoise(b, x, y, H, why)     the crash: the raid's noise, Heat, the unaware nearby wake
//   windowWord(c)      "open" | "broken" | "unlocked" | "locked" | "fixed" | "?" (not checked yet)
import { CELL } from "./combat.js"; // the cell kinds (call-time only: the modules load in a circle)
import { hash01 } from "./skills.js";

export const WINDOW = {
  OPEN_AP: 1,                                   // opening or closing one (quiet)
  BREAK: { ap: 1, noise: 2, heat: 6, radius: 8 },  // breaking one, by hand or crashing through it: the FORCE scale (locks.js: Heat +6, 8 tiles)
  HURT: [1, 3],                                 // the cuts of a vault through a closed window
  SMASH_COST: 1,                                // tiles over the vault's cost for a vault through a closed window (the path prefers an open way as short)
  // The state mix by the building: [unlocked, locked] shares, the rest fixed. Houses mostly open; shop fronts and
  // offices are mostly fixed glass.
  MIX: { house: [0.5, 0.35], shop: [0.15, 0.25] },
};
const HOUSE_KEYS = new Set(["house", "farmhouse", "cabin", "lodge", "ranger", "motel", "apartments", "neighbourhood", "church", "barn", "diner", "field"]);
export const winMixOf = (key) => (HOUSE_KEYS.has(key) ? WINDOW.MIX.house : WINDOW.MIX.shop);
export function rollWin(seed, mix, ...keys) {
  const r = hash01(seed, "win", ...keys);
  const m = mix || WINDOW.MIX.house;
  return { open: false, lock: r < m[0] ? "none" : r < m[0] + m[1] ? "locked" : "fixed" };
}

const DEFAULT_WIN = { open: false, lock: "none" }; // a window placed before the states were (an old save): closed, unlocked
export const isWindow = (c) => !!c && (c.k === "window" || c.k === "smashed");
export function windowState(c) {
  if (!c) return null;
  if (c.k === "smashed") return { open: true, lock: "none", known: true, broken: true };
  if (c.k !== "window") return null;
  const w = c.win || DEFAULT_WIN;
  return { open: !!w.open, lock: w.lock || "none", known: !!w.known, broken: false };
}
export const windowOpen = (c) => !!c && (c.k === "smashed" || (c.k === "window" && !!(c.win && c.win.open)));
const winOf = (c) => c.win || (c.win = { ...DEFAULT_WIN });
export function windowWord(c) {
  const s = windowState(c);
  if (!s) return "";
  if (s.broken) return "broken";
  if (s.open) return "open";
  if (!s.known) return "?";
  return s.lock === "none" ? "unlocked" : s.lock;
}

// Indoors: inside a raid's room (b.raid.areas, on this floor), a base building's inside (b.tier.indoor), else a cell
// with floorboards (a field map's houses, the street map's: f "floor"). A wall, and a window in it, is nobody's side.
export function insideOf(b, x, y) {
  if (x < 0 || y < 0 || x >= b.w || y >= b.h) return false;
  const c = b.cells[y * b.w + x];
  if (!c || c.k === "wall" || c.k === "boarded" || isWindow(c)) return false; // boarded: a door or window under boards (barricade.js)
  if (b.raid && b.raid.areas) {
    const f = b.floor || 0;
    for (const a of b.raid.areas) if (!a.outdoor && (a.f || 0) === f && x > a.x0 && x < a.x0 + a.w - 1 && y > a.y0 && y < a.y0 + a.h - 1) return true;
    if (b.raid.interior) return c.f === "floor" && !!(c.fl || c.k === "stairs" || c.k === "loft"); // a room's cell (its own floor), off the areas' rects (a door cell is a wall's)
  }
  if (b.tier && b.tier.indoor) return !!b.tier.indoor[y * b.w + x];
  return c.f === "floor";
}

const NEXT4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// The windows next to a unit (not diagonally), and whether the unit stands indoors.
export function windowsBy(b, u) {
  const out = [];
  const inside = insideOf(b, u.x, u.y);
  for (const [dx, dy] of NEXT4) {
    const x = u.x + dx, y = u.y + dy;
    if (x < 0 || y < 0 || x >= b.w || y >= b.h) continue;
    const c = b.cells[y * b.w + x];
    if (isWindow(c)) out.push({ x, y, c, inside });
  }
  return out;
}
// Why a closed window cannot be opened from where the unit stands ("" when it can).
export function openRefusal(b, u, c, inside) {
  const s = windowState(c);
  if (!s) return "Not a window.";
  if (s.broken) return "The window is broken: nothing to open.";
  if (s.open) return "The window is open already.";
  if (s.lock === "fixed") return "The window is fixed: it does not open. Break it (loud), or vault through it.";
  if (s.lock === "locked" && !inside) return "The window is locked from the inside: it opens only from indoors. Break it (loud), or vault through it.";
  return "";
}
export function smashWindow(b, c) {
  c.k = "smashed";
  delete c.win;
  if (c.hp != null) c.hp = 0;
  b.losCache.fill(0);
}
// The crash of breaking glass: the raid's noise (Heat with the turn), Heat at once in a raid, the unaware within
// earshot wake. H: { say, alertNear } (combat.js).
export function glassNoise(b, x, y, H, why = "Breaking glass carries: the unaware nearby turn toward it.") {
  const B = WINDOW.BREAK;
  b.noise = (b.noise || 0) + B.noise;
  if (b.raid) b.raid.heat = Math.min(100, b.raid.heat + B.heat);
  H.alertNear(b, x, y, B.radius, why);
}
const faceAt = (u, x, y) => { u.face = [Math.sign(x - u.x), Math.sign(y - u.y)]; };
// act: { type, unit, x?, y? } (the window, else the first one next to the unit). H: { say, alertNear, fx }. Returns
// "" when the action happened, else why not.
export function windowAct(state, b, u, act, H) {
  const list = windowsBy(b, u);
  const o = act.x != null ? list.find((w) => w.x === Number(act.x) && w.y === Number(act.y)) : list[0];
  if (!o) return "Stand right next to a window (not diagonally).";
  const c = o.c, first = u.name.split(" ")[0];
  const s = windowState(c);
  if (act.type === "checkwindow") { // free
    if (s.broken) { H.say(b, `${u.name} looks at the window: broken, the frame empty.`, "info"); return ""; }
    const w = winOf(c);
    w.known = true;
    const word = s.open ? "open" : w.lock === "none" ? "unlocked: it opens from either side" : w.lock === "locked" ? `locked: it opens from the inside only${o.inside ? ` (${first} is inside)` : ""}` : "fixed: it does not open, only breaks";
    H.say(b, `${u.name} tries the window: ${word}.`, "info");
    faceAt(u, o.x, o.y);
    return "";
  }
  if (act.type === "openwindow") {
    const why = openRefusal(b, u, c, o.inside);
    if (why) { if (!s.broken) winOf(c).known = true; return why; }
    if (u.ap < WINDOW.OPEN_AP) return "No actions left this turn.";
    const w = winOf(c);
    w.open = true; w.known = true;
    u.ap -= WINDOW.OPEN_AP;
    u.hunker = false;
    faceAt(u, o.x, o.y);
    b.losCache.fill(0);
    H.say(b, `${u.name} slides the window open${w.lock === "locked" ? " (unlatched from the inside)" : ""}: quiet. It can be climbed or vaulted through now.`, "info");
    return "";
  }
  if (act.type === "closewindow") {
    if (s.broken) return "The window is broken: it cannot be closed.";
    if (!s.open) return "The window is closed already.";
    if (u.ap < WINDOW.OPEN_AP) return "No actions left this turn.";
    const w = winOf(c);
    w.open = false; w.known = true;
    u.ap -= WINDOW.OPEN_AP;
    u.hunker = false;
    faceAt(u, o.x, o.y);
    b.losCache.fill(0);
    H.say(b, `${u.name} slides the window shut: quiet.`, "info");
    return "";
  }
  if (act.type === "breakwindow") {
    if (s.broken) return "The window is broken already.";
    if (u.ap < WINDOW.BREAK.ap) return "No actions left this turn.";
    u.ap -= WINDOW.BREAK.ap;
    u.hunker = false;
    faceAt(u, o.x, o.y);
    smashWindow(b, c);
    H.fx(b, { type: "melee", from: [u.x, u.y], to: [o.x, o.y], hit: true, crit: false, dmg: 0, side: u.side, text: "BROKEN" });
    H.say(b, `${u.name} smashes the window with a crash${b.raid ? ` (Heat +${WINDOW.BREAK.heat})` : ""}. It can be vaulted through now.`, "danger");
    glassNoise(b, o.x, o.y, H);
    return "";
  }
  return "Unknown window order.";
}
