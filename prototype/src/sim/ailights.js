// The battle AI and the lights (the user's request of 2026-10-12: "make non-zombie enemies switch lights on when
// alerted, move into a building with the lights off etc and friendly AI groups"). Every person the AI moves counts:
// the enemy's people, the third side (thirdside.js: neutrals, soldiers), the volunteers with your team
// (volunteers.js) and your own people while the AI plays your side (combat.js autoPlayerTurn, the raid bot). The dead
// have no hands for a switch.
//
// Flashlights (vision.js activeLight: u.light carried, u.lightOff switched off):
//   - the enemy and the third side keep theirs off while unaware (a guard at his post in the dark: a light would give
//     the post away), and switch it on the moment they are alerted (combat.js alertPod / alertAll / alertNear call
//     wakeLights) or go to look at a noise (an investigation: stealth.js investigate);
//   - your side under the AI (the bot, volunteers) keeps them off while the team is still unseen (no enemy aware of
//     anyone) and switches them on once it is found, as the enemy does;
//   - night vision on (vision.js nvgOn) beats a light: it stays off.
//   Only where it is dark: at night outdoors, or in an unlit room (indoorlight.js darkAt). By day in a lit place the
//   light is put away again.
// Room lights (indoorlight.js: switches beside the doors): an AI person who knows the fight is on (aware; your side
//   once found) and stands in a dark room with a switch, or in its doorway, flips it on: 1 action, from next to the
//   switch (lightsAct). From further in the room, with nothing of the other side in sight, they first walk to it (one
//   move: the switch's floor cell, a.swIn) when it is within a move. So an alerted guard lights the room he is in, and
//   anyone moving into a dark building lights the rooms as they come to them. An investigating guard lights the room
//   the noise came from.
// No dice: what they do follows from where they are and what they know.
import { activeLight, nvgOn, nightReach } from "./vision.js";
import { darkAt, switchOptions, lightsAct, roomAt, roomLit } from "./indoorlight.js";
import { active, say, reachable, pathTo, moveAlong, canSee } from "./combat.js";
import { LIGHTS } from "./lights.js";
import { STEALTH } from "./stealth.js";

export const AILIGHT = { WALK: true }; // WALK: an AI person walks to a dark room's switch within a move to flip it

// Is this unit one the battle AI moves (not one of yours under your orders)? auto: the AI plays your side now.
const aiMoved = (u, auto = false) => !!u && u.kind === "human" && !u.ztype && !u.boss && (u.side !== "player" || u.vol != null || auto);
// Does the unit's side know the fight is on? The enemy and the third side: it is aware (or looking into a noise);
// your side: an enemy is aware of someone.
export function inTheKnow(b, u) {
  if (u.side !== "player") return !!(u.aware || u.investigate);
  return b.units.some((e) => e.side === "enemy" && active(e) && e.aware);
}
const darkHere = (b, u) => darkAt(b, u.x, u.y, u.f || 0);

// What an enemy sees with what it has switched on (stealth.js nightEyes' rule: at night at least the old 7, a light's
// beam or pool, the dark by the hour; by day all of it).
function refreshSight(b, u) {
  if (u.daySight == null) return;
  if (u.side === "player") { u.sight = b.night ? Math.min(u.daySight, nightReach(b, u)) : u.daySight; return; }
  u.sight = b.night ? Math.min(u.daySight, Math.max(STEALTH.NIGHT_SIGHT, nightReach(b, u))) : u.daySight;
}

// The flashlight where it should be for this unit now (see the header). Returns true when it was switched.
export function aiFlashlight(b, u, auto = false) {
  if (!aiMoved(u, auto) || !u.light) return false;
  const want = inTheKnow(b, u) && !nvgOn(u) && darkHere(b, u);
  const on = !!activeLight(u);
  if (want === on) return false;
  u.lightOff = !want;
  refreshSight(b, u);
  if (want && u.side !== "enemy") say(b, `${u.name} switches on the ${(LIGHTS[u.light] && LIGHTS[u.light].name) || "light"}.`, "info");
  return true;
}

// Alerted (combat.js alertPod / alertAll / alertNear): the people among them switch their lights on where it is dark.
export function wakeLights(b, units) {
  let n = 0;
  for (const u of units) if (aiFlashlight(b, u)) n++;
  return n;
}

// A dark room's switch: flipped on from next to it (1 action), or walked to first (one move) when it is within a move
// and nobody of the other side is in sight. Returns true when it did either (the turn goes on with what is left).
export function aiRoomLights(b, u, auto = false) {
  if (!b.indoor || !aiMoved(u, auto) || !active(u) || u.ap < 1 || !inTheKnow(b, u)) return false;
  const reach = switchOptions(b, u).filter((a) => !roomLit(b, a));
  if (reach.length) {
    const r = lightsAct(b, u, { area: reach[0].id });
    if (r.err) return false;
    u.ap -= 1;
    say(b, `${u.name} switches the lights on in the ${r.room.name.toLowerCase()}.`, u.side === "enemy" ? "danger" : "info");
    return true;
  }
  if (!AILIGHT.WALK || u.ap < 2) return false; // a move and the flip: both actions
  const room = roomAt(b, u.x, u.y, u.f || 0);
  if (!room || roomLit(b, room) || !room.sw || !room.swIn) return false;
  if (b.units.some((o) => o.side !== u.side && active(o) && o.kind === "human" && canSee(b, u, o))) return false; // a fight on: not now
  const r = reachable(b, u, u.mob);
  const [sx, sy] = room.swIn, i = sy * b.w + sx;
  if (!isFinite(r.dist[i]) || r.dist[i] === 0) return false;
  u.ap -= 1;
  moveAlong(b, u, pathTo(r, sx, sy));
  if (!active(u)) return true;
  aiRoomLights(b, u, auto);
  return true;
}

// The start of an AI person's go: the flashlight, then a dark room's switch.
export function aiLights(b, u, auto = false) {
  aiFlashlight(b, u, auto);
  return aiRoomLights(b, u, auto);
}
