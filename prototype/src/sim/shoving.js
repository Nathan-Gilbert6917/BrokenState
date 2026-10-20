// Shoving people and the dead on the battle map (the user's request 2026-10-20): a person with free arms shoves a foe
// right next to them (combatAct "shoveFoe", 1 action). Your people do it by order; enemy people, the third side and your
// own AI (one brain: docs/adr/0001-ai-parity.md) do it through aiPush.
//   The odds (pushOdds): PUSH.BASE, how well the shover fights hand to hand (u.meleeAim against PUSH.MID: your
//     people's Melee skill, nerve and traits; an enemy's strength), a Strong back, the target unaware, staggered or
//     stunned; heavy ones (the armoured dead, a Boneback, a dead hog or stag) take more. Brutes,
//     wall-breakers, brood mothers, dead cows, bosses and anything bigger than a cell are not shoved at all (IMMOVABLE).
//   A shove that lands either pushes the target back a tile (straight away from the shover, onto a free cell it could
//     walk: moveAlong, so a trench, a spike pit, a mine, the flames or a spitter's acid there do what they do) or
//     knocks it flat on its back (PUSH.KNOCK, more for a good fighter and a Strong back; always when there is nowhere behind
//     it to go: a wall, someone standing there, a wall's corner). A crawler is low already: it is only pushed.
//   Flat on their back (u.floored): no overwatch, not hunkered, blows at them +PUSH.FLOOR_AIM (combat.js meleeOdds);
//     getting up takes an action at the start of their side's next turn (getUpRound). The figure lies on the ground
//     until then (ui/isoview.js).
//   A shove that misses: the action is spent, the target keeps its feet. Either way an unaware target and its group
//     are alerted, as by a blow.
import { active, foesOf, meleeReach, nearCell, unitAt, CELL, moveAlong, say, fx, alertPod, cornerBlocked, canFire, isRanged } from "./combat.js"; // call-time only: the modules load in a circle
import { canShove } from "./barricade.js";
import { faceToward } from "./vision.js";
import { hash01 } from "./skills.js";

export const PUSH = {
  AP: 1, BASE: 65, MID: 75, MIN: 15, MAX: 90, STRONG: 10, UNAWARE: 20, REELING: 10, // REELING: staggered or stunned
  KNOCK: 0.35, KNOCK_SKILL: 0.01, KNOCK_STRONG: 0.1, FLOOR_AIM: 20,
  AI_MIN: 45, AI_ODDS: 0.6, // the AI shoves when its odds are at least AI_MIN, AI_ODDS of the time it could
};
const IMMOVABLE = new Set(["brute", "wallbreaker", "broodmother", "deadcow"]);
const HEAVY = { soldier: 15, riot: 15, boneback: 20, deadhog: 15, deadstag: 15 };
const kindOf = (t) => t.ztype || t.variant || t.zkind || "";

// Can t be shoved at all (by anyone)? "" when it can, else why not.
export function unshoveable(t) {
  if (!t || !active(t)) return "Nobody there to shove.";
  if (t.boss || (t.size || 1) > 1 || IMMOVABLE.has(kindOf(t))) return `${t.name} is too big and heavy to shove.`;
  if (t.aboard || t.gunner) return `${t.name} is in a vehicle.`;
  return "";
}
// The foes u can shove from where it stands: next to it (not across a wall's corner), shoveable.
export function pushTargets(b, u) {
  if (!u || !canShove(u)) return [];
  return foesOf(b, u).filter((t) => (t.f || 0) === (u.f || 0) && meleeReach(b, u, t) && !unshoveable(t));
}
// Why u cannot shove (t: a given target, else anyone next to it). "" when it can.
export function pushRefusal(b, u, t = null) {
  if (!u || u.kind !== "human" || u.ztype) return "Only people shove.";
  if (!canShove(u)) return u.aboard || u.gunner ? "Get out of the vehicle first." : "The arms must be free to shove someone (nothing carried, nobody dragged, no cart).";
  if (u.ap < PUSH.AP) return "No action left.";
  if (t) {
    const why = unshoveable(t);
    if (why) return why;
    if (!foesOf(b, u).includes(t)) return `${t.name} is not someone to shove.`;
    if (!meleeReach(b, u, t)) return "Must be right next to them (not across a wall's corner).";
    return "";
  }
  return pushTargets(b, u).length ? "" : "Nobody right next to them to shove.";
}
// The odds of u shoving t: { chance, knock, parts }.
export function pushOdds(b, u, t) {
  const big = !!u.strongBack; // combat.js playerUnit: the Strong back trait
  const reeling = t.staggered || (t.stun && !t.stun.dazed);
  const fight = Math.round(((u.meleeAim ?? PUSH.MID) - PUSH.MID) / 2);
  const parts = [["Base", PUSH.BASE], ["Hand to hand", fight], ["Strong back", big ? PUSH.STRONG : 0], ["Target unaware", t.aware === false ? PUSH.UNAWARE : 0], ["Target reeling", reeling ? PUSH.REELING : 0], ["Heavy", -(HEAVY[kindOf(t)] || 0)]].filter(([, v]) => v);
  const chance = Math.max(PUSH.MIN, Math.min(PUSH.MAX, Math.round(parts.reduce((a, [, v]) => a + v, 0))));
  const knock = kindOf(t) === "crawler" ? 0 : Math.max(0, Math.min(0.9, PUSH.KNOCK + fight * PUSH.KNOCK_SKILL + (big ? PUSH.KNOCK_STRONG : 0)));
  return { chance, knock, parts };
}
// The cell t is pushed onto by u: straight away from u, a free cell it could walk on (no higher than where it stands),
// not past a wall's corner. null: nowhere.
export function pushDest(b, u, t) {
  const [ux, uy] = nearCell(u, t.x, t.y);
  const dx = Math.sign(t.x - ux), dy = Math.sign(t.y - uy);
  const x = t.x + dx, y = t.y + dy;
  if (x < 0 || y < 0 || x >= b.w || y >= b.h) return null;
  const c = b.cells[y * b.w + x], here = b.cells[t.y * b.w + t.x];
  if (!c || !CELL[c.k] || !CELL[c.k].walk || c.k === "vehicle" || unitAt(b, x, y)) return null;
  if ((c.h ?? CELL[c.k].h ?? 0) > (here.h ?? CELL[here.k].h ?? 0)) return null;
  if (cornerBlocked(b, t.x, t.y, x, y)) return null;
  return { x, y };
}
// The shove (combatAct "shoveFoe" and aiPush). Returns "" or why not.
export function pushAct(b, u, t) {
  if (!t) { const list = pushTargets(b, u); if (list.length !== 1) return list.length ? "Pick who to shove." : pushRefusal(b, u); t = list[0]; } // the one next to them
  const why = pushRefusal(b, u, t);
  if (why) return why;
  const o = pushOdds(b, u, t);
  b.pushes = (b.pushes || 0) + 1; // the shove's own dice (hash01 of the battle's rng position): no other roll in the battle changes
  const roll = hash01(b.rng.state, "push", b.pushes, u.id, t.id);
  u.ap -= PUSH.AP;
  u.hunker = false;
  faceToward(u, t.x, t.y);
  const good = u.side === "player" ? "good" : "danger";
  if (roll * 100 >= o.chance) {
    say(b, `${u.name} shoves at ${t.name}, who keeps their feet (${o.chance}%).`, "info");
    fx(b, { type: "melee", from: [u.x, u.y], to: [t.x, t.y], hit: false, side: u.side });
  } else {
    const dest = pushDest(b, u, t);
    const knock = !dest || hash01(b.rng.state, "pushknock", b.pushes, u.id, t.id) < o.knock;
    fx(b, { type: "melee", from: [u.x, u.y], to: [t.x, t.y], hit: true, crit: false, dmg: 0, side: u.side, text: knock ? "FLOORED" : "SHOVED" });
    // Shoved in their own side's phase (the third side and the enemy move together): getting up comes out of this turn.
    const now = (b.phase === "player") === (t.side === "player") && t.ap > 0;
    say(b, knock ? `${u.name} shoves ${t.name} ${dest ? "back and " : ""}flat on their back: getting up will take them ${now ? "an action now" : "an action"}.` : `${u.name} shoves ${t.name} back a step.`, good);
    if (dest) {
      const face = t.face;
      moveAlong(b, t, [[dest.x, dest.y]]); // a trench, a pit, a mine, the flames, acid: what is there
      t.face = face; // shoved backwards: still facing the shover
    }
    t.hunker = false; t.ow = false;
    if (t.brace) delete t.brace; // a braced door let go (buildingmaps.js)
    if (knock && active(t)) { if (now) t.ap -= 1; else t.floored = 1; }
  }
  if (t.side === "enemy" && !t.dead && !t.aware) alertPod(b, t.pod, `${t.name} cries out!`);
  return "";
}
// The start of a side's turn (sides: the sides whose turn it is): whoever is flat on their back gets up, an action.
export function getUpRound(b, sides) {
  for (const u of b.units) {
    if (!u.floored || !sides.includes(u.side)) continue;
    if (active(u) && u.ap > 0) { u.ap -= 1; say(b, `${u.name} gets back up off the ground (one action this turn).`, u.side === "player" ? "danger" : "good"); }
    u.floored = 0;
  }
}
// The AI (any side's person, combat.js aiUnit): with a gun ready and one of the dead or someone fighting hand to hand
// right next to them, a shove first makes room for the shot (the dead first); the turn goes on with the action left.
// Once a turn. Returns true when it shoved.
export function aiPush(b, u) {
  if (u.kind !== "human" || u.ap < 2 || u.pushedT === b.turn || !isRanged(u) || !canFire(b, u) || pushRefusal(b, u)) return false;
  const worth = (t) => (t.kind === "zombie" ? 2 : isRanged(t) ? 0 : 1);
  const list = pushTargets(b, u).filter((t) => worth(t) > 0).map((t) => ({ t, o: pushOdds(b, u, t) })).filter((p) => p.o.chance >= PUSH.AI_MIN);
  if (!list.length) return false;
  list.sort((p, q) => worth(q.t) - worth(p.t) || q.o.chance - p.o.chance);
  if (hash01(b.rng.state, "aipush", b.turn, u.id) >= PUSH.AI_ODDS) return false;
  u.pushedT = b.turn;
  return pushAct(b, u, list[0].t) === "";
}
