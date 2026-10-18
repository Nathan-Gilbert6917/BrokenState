// @ts-check
// Raiders and the dead in a raid (the user's request 2026-10-18). On a raid map the people holding the place and the
// dead wandering it share a side in the sim (both "enemy"), so they never fought. Now:
//   - Contact: one of the dead with a living enemy (a raider, a soldier, anyone of theirs) next to it or within CONTACT
//     tiles in its line of sight goes for them (deadContacts; foesOf adds them to its foes, crossTurn makes an unaware
//     one attack without waking to your people). A raider with the dead coming at them in sight within SHOOT tiles, or
//     one right next to them, shoots or strikes back (raiderThreats; an unaware raider too, without learning you are
//     here). The wild dead the Heat brings in already went for anyone alive.
//   - Their noise draws the dead to them while you are unseen: a raider's shot (fire, suppress), their grenade or
//     flashbang, used to wake the dead nearby, who then hunted your people wherever they stood. While none of the raiders
//     knows you are here (playerSeen), the unaware dead within earshot go to look where the noise was instead
//     (u.investigate, stealth.js), and so do the raiders near it; the dead a raider's bullet hits go for the shooter.
//     The noise still feeds the raid's Heat (combat.js raidTurn reads b.noise) and the tile's heat (b.gunshots).
//   - Third-partying: a noise maker you throw (a bottle, a firecracker: stealth.js throwAt) pulls the unaware dead and
//     the unaware raiders to where it lands; the dead that find raiders there fall on them. Nothing new in the sim: the
//     pull was there, the contact rule does the rest.
//   - Heard, not seen: a shot or a blast made by anyone not of your side, out of your people's sight, is marked in the fog
//     of war (b.noises: a "?" with sound arcs and a tag) with a guess of what it was by the sound: a shotgun's boom and
//     automatic fire carry unmistakably; a pistol or a rifle is told from one another only within SURE tiles, beyond that
//     "a gun of some kind"; a suppressed shot is a dull crack; a grenade or a pipe bomb; a flashbang's sharp crack; a
//     launcher's round. Heard HEARD[what] tiles off, scaled by the listener's ears (hearing.js hearRange; nothing while
//     deaf), FLOOR_DAMP tiles more a storey. The marker stays LINGER turns (noiseGhosts; combat.js crossRound). The log
//     says it once a shooter a turn, with the direction from your nearest person.
// Hooks in combat.js (all marked "crossfire.js"): foesOf (crossFoes), aiUnit (crossTurn), alertNear (crossDraw),
// fire's cry-out (crossHit), fire / suppress (noteShot), startPlayerTurn (crossRound), enemyGhosts' readers
// (noiseGhosts: ui/combat.js, ui/isoview.js drawGhost); throwables.js landEffect / flashBurst (noteBlast).
// Dice: none. Everything here is arithmetic on the map (a far marker's drift is a hash of where and when).
import { active, activeAny, canSee, los, adjacent, canFire, WEAPONS, say, fire, strike, bestShot, reachable, pathTo, moveAlong, distField, dashRange, playerSeesCell } from "./combat.js";
import { hearRange, HEAR } from "./hearing.js";
import { faceToward } from "./vision.js";

export const CROSS = {
  CONTACT: 5,  // a raider this close, in sight: the dead go for them
  SHOOT: 9,    // the dead coming at them this close, in sight: a raider shoots
  LOOK: 2,     // turns the dead and the raiders drawn by a noise spend looking where it was
  LINGER: 3,   // turns a heard-noise marker stays in the fog
  SURE: 12,    // beyond this many tiles a pistol and a rifle sound alike (a shotgun and automatic fire still carry)
  DRIFT: 14,   // beyond this many tiles the marker may sit a tile off the true spot
  HEARD: { shot: 28, auto: 32, blast: 40, flash: 40 }, // how far each sound is heard by your people (× their ears / HEAR.BASE)
  FLOOR_DAMP: 5, // a storey between a noise and a listener counts as this many tiles more
  KEEP: 40,    // noise markers kept at most
};

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const sameFloor = (a, c) => (a.f || 0) === (c.f || 0);
export const crossOn = (b) => !!(b && b.raid);
const isDead = (u) => u.kind === "zombie";
const theirs = (u) => u.side === "enemy" && u.kind === "human"; // the living of the other side: raiders, guards, a watcher
// One of the raiders knows your people are here: the fight with you is on, and their noise is part of it.
export const playerSeen = (b) => b.units.some((u) => theirs(u) && u.aware && activeAny(u));

// ---------- who fights whom ----------
// The living enemies one of the dead is in contact with: next to it, or within CONTACT tiles in its line of sight.
export function deadContacts(b, z) {
  return b.units.filter((h) => theirs(h) && active(h) && sameFloor(h, z) && (adjacent(z, h) || (dist(z.x, z.y, h.x, h.y) <= CROSS.CONTACT && los(b, z.x, z.y, h.x, h.y))));
}
// The dead a raider fights: one right next to them (whatever it was doing), or one up and coming (aware, wild, or
// drawn by a noise) within SHOOT tiles that they can see (their own cone: the dead get them from behind).
export function raiderThreats(b, h) {
  return b.units.filter((z) => z.side === "enemy" && isDead(z) && active(z) && sameFloor(z, h) && !z.dormant && (adjacent(h, z) || ((z.aware || z.wild || z.investigate || z.cross) && dist(h.x, h.y, z.x, z.y) <= CROSS.SHOOT && canSee(b, h, z))));
}
// combat.js foesOf: base is who the unit fought before; the contacts and the threats are added in a raid.
export function crossFoes(b, u, base) {
  if (!crossOn(b) || u.side !== "enemy") return base;
  if (isDead(u) && !u.wild) { const c = deadContacts(b, u); return c.length ? base.concat(c) : base; }
  if (u.kind === "human") { const t = raiderThreats(b, u); return t.length ? base.concat(t) : base; }
  return base;
}

// ---------- the turn of an unaware one in contact ----------
// combat.js aiUnit, before the unaware patrol: true when the unit spent its turn fighting the other half of its side.
// An aware unit takes the usual AI (its foes now include them, foesOf).
export function crossTurn(b, u) {
  if (!crossOn(b) || u.side !== "enemy" || u.aware || !active(u) || u.ap < 1) return false;
  if (isDead(u)) return deadTurn(b, u);
  if (u.kind === "human") return raiderTurn(b, u);
  return false;
}
function nearest(u, list) { let best = null, bd = Infinity; for (const o of list) { const d = dist(u.x, u.y, o.x, o.y); if (d < bd) { bd = d; best = o; } } return best; }
// One of the dead with raiders in contact: tears into the one next to it, else closes on the nearest. It does not wake
// to your people (u.aware stays false): it is after them, not you. It follows them a couple of turns (u.investigate).
function deadTurn(b, z) {
  const c = deadContacts(b, z);
  if (!c.length) return false;
  if (!z.cross) say(b, `${z.name} turns on ${c.length === 1 ? c[0].name : "the people there"}.`, "info");
  z.cross = b.turn;
  const adj = c.filter((h) => adjacent(z, h)).sort((p, q) => p.hp - q.hp);
  if (adj.length) { strike(b, z, adj[0]); z.ap = 0; return true; }
  const r = reachable(b, z, dashRange(z));
  const field = distField(b, c.map((h) => [h.x, h.y]), z);
  let best = -1;
  for (let i = 0; i < b.w * b.h; i++) {
    if (!isFinite(r.dist[i]) || !isFinite(field[i])) continue;
    if (best < 0 || field[i] < field[best] || (field[i] === field[best] && r.dist[i] < r.dist[best])) best = i;
  }
  if (best >= 0 && r.dist[best] > 0) moveAlong(b, z, pathTo(r, best % b.w, (best / b.w) | 0));
  const t = nearest(z, c);
  if (t) { faceToward(z, t.x, t.y); z.investigate = { x: t.x, y: t.y, turns: CROSS.LOOK }; }
  z.ap = 0;
  return true;
}
// An unaware raider with the dead on them: shoots the best shot (the noise draws more: crossDraw), or strikes the one
// next to them; a melee hand with nothing in reach steps toward the nearest. They do not learn you are here.
function raiderTurn(b, h) {
  const t = raiderThreats(b, h);
  if (!t.length) return false;
  h.cross = b.turn;
  for (let step = 0; step < 2 && h.ap > 0 && active(h); step++) {
    const threats = raiderThreats(b, h);
    if (!threats.length) break;
    const shot = canFire(b, h) ? bestShot(b, h, threats) : null;
    if (shot) { fire(b, h, shot.t); h.ap -= 1; continue; }
    const adj = threats.filter((z) => adjacent(h, z)).sort((p, q) => p.hp - q.hp);
    if (adj.length) { strike(b, h, adj[0]); h.ap = 0; break; }
    const w = WEAPONS[h.weapon];
    const near = nearest(h, threats);
    if (w && w.melee && near && dist(h.x, h.y, near.x, near.y) <= 3) {
      const r = reachable(b, h, h.mob);
      const field = distField(b, [[near.x, near.y]], h);
      let best = -1;
      for (let i = 0; i < b.w * b.h; i++) { if (!isFinite(r.dist[i]) || !isFinite(field[i])) continue; if (best < 0 || field[i] < field[best]) best = i; }
      if (best >= 0 && r.dist[best] > 0) { moveAlong(b, h, pathTo(r, best % b.w, (best / b.w) | 0)); h.ap -= 1; continue; }
    }
    if (near) faceToward(h, near.x, near.y);
    h.ap = 0;
  }
  h.ap = 0;
  return true;
}

// ---------- their noise draws the dead to them ----------
// combat.js alertNear: a noise at (x, y) made by src (one of theirs, or the third side) while you are still unseen.
// The unaware dead within radius (FLOOR_DAMP tiles more a storey) go to look there, and so do the unaware raiders;
// nobody wakes to your people. False when the noise is yours, or the raiders know you are here: the old wake.
export function crossDraw(b, x, y, radius, src, why) {
  if (!crossOn(b) || !src || src.side === "player" || playerSeen(b)) return false;
  let n = 0;
  for (const u of b.units) {
    if (u.side !== "enemy" || u.aware || !activeAny(u) || u === src || u.dormant) continue;
    if (dist(u.x, u.y, x, y) + CROSS.FLOOR_DAMP * Math.abs((u.f || 0) - (src.f || 0)) > radius) continue;
    if (isDead(u) && u.investigate && u.investigate.turns > CROSS.LOOK) continue; // already going to look at something louder (a decoy)
    u.investigate = { x, y, turns: CROSS.LOOK };
    n++;
  }
  if (n) say(b, `The noise carries: ${n === 1 ? "one of them turns" : `${n} of them turn`} toward it, not toward your people.`, "info");
  return true;
}
// combat.js fire / strike / a thrown spear: a hit by one of theirs (not your people) on an unaware one of the other
// half of their side, while you are unseen. Instead of the victim's pod waking to hunt your people: one of the dead
// hit goes for the one who hit it; a raider hit keeps fighting (crossTurn) and the unaware mates of his pod come to
// look where he stands. True when handled.
export function crossHit(b, a, t) {
  if (!crossOn(b) || !a || a.side === "player" || !t || t.side !== "enemy" || playerSeen(b)) return false;
  if (isDead(t)) { if (!isDead(a)) { t.investigate = { x: a.x, y: a.y, turns: CROSS.LOOK }; t.cross = b.turn; return true; } return false; }
  if (t.kind !== "human" || !isDead(a)) return false;
  t.cross = b.turn;
  for (const u of b.units) if (u !== t && theirs(u) && !u.aware && activeAny(u) && u.pod === t.pod && !u.investigate) u.investigate = { x: t.x, y: t.y, turns: CROSS.LOOK };
  return true;
}

// ---------- heard, not seen ----------
const PISTOL_CAL = /^(9mm|45acp|357|38spl|22lr|44mag|40sw|10mm|380|57x28)$/;
// What a shot sounds like: label (the log, the tooltip), tag (the marker), guess (what it probably was), sure (told from
// far off too). w: the weapon; muffled: a suppressor took the noise down; auto: a stream or a burst.
export function shotSound(w, muffled, auto, vague) {
  if (w && w.mounted) return { label: "Heavy gunfire", tag: "GUN?", guess: "a mounted gun, by the weight of it", sure: true };
  if (muffled) return { label: "A muffled shot", tag: "SHOT?", guess: "a suppressed gun, by the dull crack", sure: true };
  if (auto) return { label: "Automatic fire", tag: "AUTO?", guess: "a rifle or a submachine gun on automatic", sure: true };
  const cal = w && w.cal ? String(w.cal) : "";
  if (/ga$/.test(cal)) return { label: "A gunshot", tag: "SHOT?", guess: "a shotgun, by the boom", sure: true };
  if (vague) return { label: "A gunshot", tag: "SHOT?", guess: "a gun of some kind, too far to tell", sure: false };
  if (PISTOL_CAL.test(cal)) return { label: "A gunshot", tag: "SHOT?", guess: "a pistol or a revolver, by the sound", sure: false };
  return { label: "A gunshot", tag: "SHOT?", guess: "a rifle, by the crack", sure: false };
}
export function blastSound(kind) {
  if (kind === "flash") return { label: "A sharp bang", tag: "BANG?", guess: "a flashbang, maybe: a crack with no shrapnel in it", sure: true };
  if (kind === "he40" || kind === "rocket") return { label: "A heavy blast", tag: "BLAST?", guess: "a launcher's round, by the weight of it", sure: true };
  return { label: "A blast", tag: "BLAST?", guess: "a grenade, or a pipe bomb", sure: true };
}
const DIRS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
const dirWord = (fx, fy, tx, ty) => { const a = Math.atan2(ty - fy, tx - fx); return DIRS[(Math.round(((a + Math.PI / 2) / (Math.PI / 4))) + 8) % 8]; };
const hash = (x, y, t) => { let h = (x * 73856093) ^ (y * 19349663) ^ (t * 83492791); h = Math.imul(h ^ (h >>> 13), 0x5bd1e995); return (h ^ (h >>> 15)) >>> 0; };
// Your people's ears that hear a noise at (x, y) on floor f, what tiles off: the nearest listener's distance, or null.
function heardBy(b, x, y, f, reach) {
  let best = null;
  for (const u of b.units) {
    if (u.side !== "player" || u.kind !== "human" || !active(u)) continue;
    const ears = hearRange(u);
    if (!(ears > 0)) continue;
    const d = dist(u.x, u.y, x, y) + CROSS.FLOOR_DAMP * Math.abs((u.f || 0) - (f || 0));
    if (d > reach * (ears / HEAR.BASE)) continue;
    if (best == null || d < best.d) best = { d, u };
  }
  return best;
}
// A noise made at (x, y) on floor f by `by` (not your side), out of your people's sight: marked in the fog with the
// sound's guess, and said once a maker a turn. what: shot | auto | blast | flash.
export function noteNoise(b, x, y, f, what, by, sound) {
  if (!b || !b.units || !by || by.side === "player" || !sound) return null;
  if ((f || 0) === (b.floor || 0) && playerSeesCell(b, x, y)) return null; // in plain sight: nothing to guess
  const ear = heardBy(b, x, y, f, CROSS.HEARD[what] || CROSS.HEARD.shot);
  if (!ear) return null;
  const vague = ear.d > CROSS.SURE && !sound.sure;
  let mx = x, my = y;
  if (ear.d > CROSS.DRIFT) { // far off: the spot is a guess too, a tile either way (the same drift for the same shot)
    const h = hash(x, y, b.turn);
    mx = Math.max(0, Math.min(b.w - 1, x + ((h % 3) - 1))); my = Math.max(0, Math.min(b.h - 1, y + (((h >>> 4) % 3) - 1)));
  }
  const list = b.noises || (b.noises = []);
  const same = list.find((n) => n.x === mx && n.y === my && n.turn === b.turn && (n.f || 0) === (f || 0) && n.what === what);
  const guess = vague ? shotSound(null, false, false, true).guess : sound.guess;
  if (same) same.n++;
  else { list.push({ x: mx, y: my, f: f || 0, turn: b.turn, what, label: sound.label, tag: sound.tag, guess, n: 1, by: by.id }); if (list.length > CROSS.KEEP) list.shift(); }
  if (by.noiseSaidT !== b.turn) {
    by.noiseSaidT = b.turn;
    say(b, `${sound.label} to the ${dirWord(ear.u.x, ear.u.y, x, y)}, out of sight: ${guess}.${crossOn(b) ? " The dead hear it too (Heat)." : ""}`, "danger");
  }
  return same || list[list.length - 1];
}
// combat.js fire / suppress: a shot by a (noise: what stealth.js shotNoise gave it; auto: a burst or a stream).
export function noteShot(b, a, w, noise, auto = false) {
  if (!a || a.side === "player" || !w || !(noise > 0)) return null;
  const ear = heardBy(b, a.x, a.y, a.f || 0, CROSS.HEARD[auto ? "auto" : "shot"]);
  const s = shotSound(w, noise < (w.noise || 0), auto, !!ear && ear.d > CROSS.SURE);
  return noteNoise(b, a.x, a.y, a.f || 0, auto ? "auto" : "shot", a, s);
}
// throwables.js landEffect / flashBurst: a blast at (x, y) thrown or fired by `by` (null: nobody's: not marked).
export function noteBlast(b, by, x, y, kind) {
  if (!by || by.side === "player") return null;
  return noteNoise(b, x, y, by.f || 0, kind === "flash" ? "flash" : "blast", by, blastSound(kind));
}
// combat.js startPlayerTurn: the markers fade after LINGER turns.
export function crossRound(b) {
  if (b.noises && b.noises.length) b.noises = b.noises.filter((n) => b.turn - n.turn < CROSS.LINGER);
}
// The noise markers to draw on the floor shown (ui/combat.js, with enemyGhosts): heard, not seen, with the guess.
export function noiseGhosts(b) {
  if (!b || !b.noises || !b.noises.length) return [];
  const out = [];
  for (let i = 0; i < b.noises.length; i++) {
    const n = b.noises[i];
    if (b.turn - n.turn >= CROSS.LINGER || (b.floors && (n.f || 0) !== (b.floor || 0))) continue;
    out.push({ id: `noise${n.turn}:${n.x},${n.y}:${i}`, x: n.x, y: n.y, turn: n.turn, f: n.f || 0, kind: "noise", name: n.label, unit: null, heard: true, noise: n.what, tag: n.tag, label: n.label, guess: n.guess, n: n.n, age: b.turn - n.turn });
  }
  return out;
}
