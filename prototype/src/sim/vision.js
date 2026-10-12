// Facing, view cones and sneaking on the battle map (the user's request of 2026-10-12).
//
// Facing: every person on the map faces a way (u.face, a direction vector: any angle, not only the 8 neighbours).
//   Every step, shot and blow turns them (combat.js); a move by hand ends facing the way the player picked (act.face,
//   radians, or act.faceX / act.faceY, a cell to look at); Face (act "face") turns in place, free (it needs an
//   action left, it does not use one). The dead have no front (zombies, a hive's special dead, bosses), nor has a
//   gunner up on a turret or anyone in a vehicle: they see all round.
// The view cone: HALF either side of the facing (a 120° arc). By day it is what an unaware guard notices you in
//   (stealth.js detectRange: outside it only what they hear, half the range, nothing at all from someone sneaking)
//   and what an overwatch covers (combat.js moveAlong: a mover outside the watcher's cone draws no reaction). Your
//   people and the aware see all round by day as before (fog of war, shooting).
// At night (b.night, every battle that starts between 20:00 and 06:00; a base's battle by its context) eyes are cones:
//   - in the dark, DARK[hour the battle started] tiles ahead within NIGHT_HALF either side (7 at dusk, 4 in the dead
//     of night), and NEAR all round (the cells next to them);
//   - a light (lights.js) is a beam the way they face: its sight, within its `beam` half-angle (a headlamp wide, a
//     military flashlight long and narrow); a torch or a lantern a pool all round (`pool`); night vision the day's
//     sight down the night cone;
//   - a light is seen: whoever carries one is seen from the daylight range by anyone facing it (canSee);
//   - enemies have the same eyes (a soldier's military flashlight, a raider's flashlight one time in three), and the
//     aware ones look toward the nearest of yours they can make out at the start of their turn (aiLook).
// Sneaking (act "sneak", free, toggles; u.sneaking): moves at SNEAK_MOB of the pace, makes no sound (nothing heard
//   behind a guard, no footsteps), and the enemy cannot see them behind half or full cover facing them (canSee:
//   from further than a tile). Not while an aware enemy has eyes on them. A shot that is not suppressed ends it.
//   Sprite: crouched and shadowed (ui/isoview.js).
// Footsteps when not sneaking: a dash (both actions' move) is heard DASH_NOISE tiles off (the unaware there, the dead
//   that hear, come to look: stealth.js noiseAt); a plain move (the blue range) STEP_NOISE.chance (less a point of
//   Stealth, at least min) of a scuff heard STEP_NOISE.r tiles off. Behind full cover facing a guard you are not
//   seen; behind half cover you are.
// Loot: searching a container (or a body, or a pile on the ground) needs the searcher next to it AND facing it
//   (LOOT_HALF either side of the facing: the three cells in front).
// Dice: none of the battle's (hash01: footsteps' scuffs, a guard's glance), so a battle's other dice are unchanged.
import { LIGHTS } from "./lights.js";
import { hash01 } from "./skills.js";

const D = Math.PI / 180;
export const VISION = {
  HALF: 60 * D, NIGHT_HALF: 50 * D, NEAR: 1.5, LOOT_HALF: 68 * D,
  DARK: { 20: 7, 21: 6, 22: 5, 23: 4, 0: 4, 1: 4, 2: 4, 3: 4, 4: 5, 5: 6 }, // tiles ahead in the dark, by the hour the battle started
  SNEAK_MOB: 0.6, DASH_NOISE: 7, STEP_NOISE: { chance: 0.06, perStealth: 0.005, min: 0.01, r: 4 },
  GLANCE: 0.3, // an unaware guard standing about looks another way this share of turns
};

// ---------- facing ----------
export const faceAng = (u) => { const f = u && u.face; return f && (f[0] || f[1]) ? Math.atan2(f[1], f[0]) : null; };
export function setFacing(u, ang) {
  if (!u || !Number.isFinite(ang)) return;
  u.face = [Math.round(Math.cos(ang) * 1000) / 1000, Math.round(Math.sin(ang) * 1000) / 1000];
}
export function faceToward(u, x, y) {
  if (!u || (x === u.x && y === u.y)) return;
  setFacing(u, Math.atan2(y - u.y, x - u.x));
}
export const angDiff = (a, c) => Math.abs(Math.atan2(Math.sin(a - c), Math.cos(a - c)));
// Has a front: a person on foot. The dead, bosses and anyone in or on a vehicle see all round.
export const hasFront = (u) => !!u && u.kind === "human" && !u.ztype && !u.boss && !u.aboard && !u.gunner && faceAng(u) != null;
// Is (x, y) within `half` of where u faces? Someone with no front: always.
export function inArc(u, x, y, half = VISION.HALF) {
  if (!hasFront(u) || (x === u.x && y === u.y)) return true;
  return angDiff(Math.atan2(y - u.y, x - u.x), faceAng(u)) <= half + 1e-6;
}

// ---------- night ----------
// Tiles ahead in the dark for a battle that started at this hour.
export const darkSight = (b) => VISION.DARK[b && Number.isFinite(b.hour) ? b.hour : 0] ?? VISION.DARK[0];
// What the night is like (the battle banner, the panel): "dead of night".
export function nightWord(b) {
  const h = b && Number.isFinite(b.hour) ? b.hour : 0;
  return h === 20 ? "dusk" : h === 5 ? "first light" : h === 21 || h === 4 ? "dark" : "dead of night";
}
const beamOf = (u) => (u && u.light && LIGHTS[u.light] && !LIGHTS[u.light].round ? LIGHTS[u.light] : null);
const poolOf = (u) => (u && u.light && LIGHTS[u.light] && LIGHTS[u.light].round ? LIGHTS[u.light].pool || 0 : 0);
// The eyes of someone with a front at night: cones { r, half } ahead and the radius all round (near). extra: tiles
// added to every cone (height, optics: combat.js sightRange less the unit's own sight).
export function nightEyes(b, u, extra = 0) {
  const cones = [{ r: (u.nvg ? u.daySight ?? 13 : darkSight(b)) + extra, half: VISION.NIGHT_HALF }];
  const L = beamOf(u);
  if (L) cones.push({ r: L.sight + extra, half: (L.beam || 20) * D });
  return { cones, near: Math.max(VISION.NEAR, poolOf(u)) };
}
// How far someone sees at night at most (u.sight at night: anything that reads a unit's sight as one number).
export function nightReach(b, u) {
  const L = beamOf(u);
  return Math.max(u.nvg ? u.daySight ?? 13 : darkSight(b), L ? L.sight : 0, poolOf(u));
}
// Does a unit with a front see (x, y), d tiles off, at night (range and direction only: combat.js canSeeAt does the
// line of sight)?
export function nightSees(b, u, x, y, d, extra = 0) {
  const e = nightEyes(b, u, extra);
  if (d <= e.near + 1e-6) return true;
  const a = faceAng(u), to = Math.atan2(y - u.y, x - u.x);
  for (const c of e.cones) if (d <= c.r + 1e-6 && angDiff(to, a) <= c.half + 1e-6) return true;
  return false;
}
// Cones are used for sight: at night, for a person on foot with a facing.
export const coned = (b, u) => !!(b && b.night) && hasFront(u);

// ---------- sneaking ----------
export const sneakMob = (u) => Math.max(1, Math.round(u.mob * VISION.SNEAK_MOB * 2) / 2);
// Footsteps of a move: "dash" (heard far), "scuff" (heard near) or "" (silent). cost: what the move cost, mob: the
// pace it was measured against.
export function stepNoise(b, u, cost, mob) {
  if (u.sneaking || u.side !== "player") return "";
  if (cost > mob + 1e-6) return "dash";
  const S = VISION.STEP_NOISE;
  const p = Math.max(S.min, S.chance - S.perStealth * (u.stealth || 0));
  return hash01("scuff", b.turn, u.id, u.x, u.y, b.nextId) < p ? "scuff" : "";
}

// ---------- the enemy's look ----------
// An unaware person standing about looks another way now and then (a quarter or half turn; no dice of the battle's).
export function glance(b, u) {
  if (!hasFront(u) || u.aware) return;
  const h = hash01("glance", b.turn, u.id);
  if (h >= VISION.GLANCE) return;
  const turn = (h < VISION.GLANCE / 2 ? 1 : -1) * (hash01("glance2", b.turn, u.id) < 0.5 ? 45 : 90) * D;
  setFacing(u, faceAng(u) + turn);
}
// The light an enemy carries at night: soldiers a military flashlight, others a flashlight one time in three (their
// own dice: the unit's id and the hour).
export function enemyLight(b, u) {
  if (!b.night || u.kind !== "human" || u.ztype || u.light !== undefined) return;
  u.light = u.kit === "soldiers" ? "tacflash" : hash01("elight", u.id, b.hour, u.name) < 0.35 ? "flashlight" : null;
  if (u.light && LIGHTS[u.light]) u.sight = Math.max(u.sight, Math.min(u.daySight ?? u.sight, LIGHTS[u.light].sight));
}

// ---------- loot ----------
// Is the unit next to a box (a container of x, y, w, h) and facing it?
export function facesBox(u, box) {
  const w = box.w || 1, h = box.h || 1;
  if (u.x >= box.x && u.y >= box.y && u.x < box.x + w && u.y < box.y + h) return true;
  if (!hasFront(u)) return true;
  for (let y = box.y; y < box.y + h; y++) for (let x = box.x; x < box.x + w; x++) {
    if (Math.max(Math.abs(x - u.x), Math.abs(y - u.y)) > 1) continue;
    if (inArc(u, x, y, VISION.LOOT_HALF)) return true;
  }
  return false;
}
export const faceRefusal = (what = "it") => `Face ${what} to search it: turn with Face (free) or move next to it facing it.`;

// ---------- drawing (ui) ----------
// The wedges to draw for a unit's view: [{ r, half, ang }] and near (all round). mover: one of yours, for an unaware
// enemy's noticing range (detect: a function (e, mover) → tiles) instead of its sight.
export function viewWedges(b, u, sightOf, detect = null) {
  const ang = faceAng(u);
  if (!hasFront(u)) return { ang: 0, wedges: [], near: Math.max(0, detect ? detect(u) : sightOf(u)), round: true };
  if (detect) return { ang, wedges: [{ r: detect(u), half: VISION.HALF }], near: 0, round: false };
  if (coned(b, u)) { const e = nightEyes(b, u, sightOf(u) - u.sight); return { ang, wedges: e.cones, near: e.near, round: false }; }
  return { ang, wedges: [{ r: sightOf(u), half: VISION.HALF }], near: 0, round: false };
}
// Turn toward a box's nearest cell (the bots' free Face before a search).
export function turnToBox(u, box) {
  const w = box.w || 1, h = box.h || 1;
  const x = Math.max(box.x, Math.min(box.x + w - 1, u.x)), y = Math.max(box.y, Math.min(box.y + h - 1, u.y));
  faceToward(u, x, y);
}
