// Shoving people and the dead on the battle map (the user's request 2026-10-20): a person with free arms shoves a foe
// right next to them (combatAct "shoveFoe", 1 action). Your people do it by order; enemy people, the third side and your
// own AI (one brain: docs/adr/0001-ai-parity.md) do it through aiPush.
//   The odds (pushOdds): PUSH.BASE, how well the shover fights hand to hand (u.meleeAim against PUSH.MID: your
//     people's Melee skill, nerve and traits; an enemy's strength), a Strong back, a Bulldozer, the target unaware,
//     staggered or stunned; less against a target hunkered down (PUSH.HUNKER) or bracing a door (PUSH.BRACE) or a heavy
//     one (the armoured dead, a Boneback, a dead hog or stag). Brutes, wall-breakers, brood mothers, dead cows, bosses
//     and anything bigger than a cell are not shoved at all (unshoveable).
//   A shove that lands either pushes the target back a tile (straight away from the shover: pushDest, through
//     combat.js moveAlong, so a trench, a spike pit, a mine, the flames or a spitter's acid there do what they do; no
//     overwatch fires at someone being shoved: u.shoved) or knocks it flat on its back (PUSH.KNOCK, more for a good
//     fighter, a Strong back and a Bulldozer). A crawler is low already: it is only pushed. Always flat on the back:
//     with nowhere to go, after a fall, through a window, or into someone.
//   Heights (pushDest drop): the cell behind is lower (a wall's walkway to the ground, a ladder, a roof edge): they
//     fall, PUSH.FALL damage a level and flat on their back. A higher cell behind is no room to go.
//   Windows (pushDest window): a window right behind, open, broken or closed, with a free cell beyond it: they go
//     through. A closed one is smashed (loud: windows.js glassNoise) and cuts them (PUSH.GLASS) as they crash through.
//   Chain (pushChain): someone standing right behind them (either side, anyone who can be shoved) may go down too
//     (PUSH.CHAIN): friends included.
//   Flat on their back (u.floored): no overwatch, not hunkered, blows at them +PUSH.FLOOR_AIM (combat.js meleeOdds);
//     getting up takes an action at the start of their side's next turn (getUpRound). The figure lies on the ground
//     until then (ui/isoview.js).
//   A shove that misses: the action is spent, the target keeps its feet. Either way an unaware target and its group
//     are alerted, as by a blow.
//   The AI (aiPush, aiMeleePush, aiBreakOut): anyone shoves a foe who would land in a hazard, a fall or a window; a
//     person with a melee weapon shoves a foe with no room behind them, then strikes the floored (+PUSH.FLOOR_AIM); a
//     person running with two or more foes round them shoves one aside first. All through the same odds. (A gunman
//     shoving the dead off to make room threw a shot away a turn: tools/shovebalance.js.)
import { active, foesOf, meleeReach, nearCell, unitAt, CELL, moveAlong, say, fx, alertPod, alertNear, cornerBlocked, canFire, isRanged, damage, hAt } from "./combat.js"; // call-time only: the modules load in a circle
import { canShove } from "./barricade.js";
import { faceToward } from "./vision.js";
import { hash01 } from "./skills.js";
import { isWindow, windowOpen, smashWindow, glassNoise } from "./windows.js";
import { fireAt } from "./throwables.js";
import { acidAt } from "./acid.js";

export const PUSH = {
  AP: 1, BASE: 65, MID: 75, MIN: 15, MAX: 90, STRONG: 10, UNAWARE: 20, REELING: 10, // REELING: staggered or stunned
  HUNKER: 15, BRACE: 20, // a target hunkered down, a target bracing a door
  KNOCK: 0.35, KNOCK_SKILL: 0.01, KNOCK_STRONG: 0.1, FLOOR_AIM: 20,
  FALL: [8, 14], GLASS: [3, 7], CHAIN: 0.7, // damage a level of the fall, the cuts through a closed window, the chance the one behind goes down too
  AI_MIN: 45, // the AI shoves only when its odds are at least this
  AI_HAZARD: 0.9, AI_MELEE: 0.5, AI_OUT: 0.8, // the share of the times it could: into a hazard, a fall or a window; before a blow; to break out of a ring of foes
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
  const dozer = u.bulldozer || null; // the Bulldozer trait: { shove, knock }
  const reeling = t.staggered || (t.stun && !t.stun.dazed);
  const fight = Math.round(((u.meleeAim ?? PUSH.MID) - PUSH.MID) / 2);
  const parts = [["Base", PUSH.BASE], ["Hand to hand", fight], ["Strong back", big ? PUSH.STRONG : 0], ["Bulldozer", dozer ? dozer.shove : 0], ["Target unaware", t.aware === false ? PUSH.UNAWARE : 0], ["Target reeling", reeling ? PUSH.REELING : 0], ["Target hunkered down", t.hunker ? -PUSH.HUNKER : 0], ["Target bracing a door", t.brace ? -PUSH.BRACE : 0], ["Heavy", -(HEAVY[kindOf(t)] || 0)]].filter(([, v]) => v);
  const chance = Math.max(PUSH.MIN, Math.min(PUSH.MAX, Math.round(parts.reduce((a, [, v]) => a + v, 0))));
  const knock = kindOf(t) === "crawler" ? 0 : Math.max(0, Math.min(0.9, PUSH.KNOCK + fight * PUSH.KNOCK_SKILL + (big ? PUSH.KNOCK_STRONG : 0) + (dozer ? dozer.knock : 0)));
  return { chance, knock, parts };
}
const freeCell = (b, x, y) => {
  if (x < 0 || y < 0 || x >= b.w || y >= b.h) return false;
  const c = b.cells[y * b.w + x];
  return !!c && !!CELL[c.k] && CELL[c.k].walk && c.k !== "vehicle" && !unitAt(b, x, y);
};
// Where t goes when shoved by u: straight away from u. { x, y, drop, window }, or null (nowhere to go).
//   drop: levels lower than where it stands (a fall); window: { x, y, closed } the window it goes through to the cell
//   beyond it. A cell behind that is higher, a wall, or someone's: no room (see pushBlocker).
export function pushDest(b, u, t) {
  const [ux, uy] = nearCell(u, t.x, t.y);
  const dx = Math.sign(t.x - ux), dy = Math.sign(t.y - uy);
  const x = t.x + dx, y = t.y + dy;
  if (x < 0 || y < 0 || x >= b.w || y >= b.h || cornerBlocked(b, t.x, t.y, x, y)) return null;
  const here = hAt(b, t.x, t.y), c = b.cells[y * b.w + x];
  if (isWindow(c)) { // through it, if the cell beyond is free (never on a diagonal: a window is in a straight wall)
    const wx = x + dx, wy = y + dy;
    if ((dx && dy) || !freeCell(b, wx, wy)) return null;
    const drop = here - hAt(b, wx, wy);
    if (drop < 0) return null;
    return { x: wx, y: wy, drop, window: { x, y, closed: !windowOpen(c) } };
  }
  if (!freeCell(b, x, y)) return null;
  const drop = here - hAt(b, x, y);
  return drop < 0 ? null : { x, y, drop, window: null };
}
// Someone standing right behind t (the cell pushDest looks at, or beyond a window), who may go down with it.
export function pushBlocker(b, u, t) {
  const [ux, uy] = nearCell(u, t.x, t.y);
  const x = t.x + Math.sign(t.x - ux), y = t.y + Math.sign(t.y - uy);
  const o = x < 0 || y < 0 || x >= b.w || y >= b.h ? null : unitAt(b, x, y);
  return o && o !== t && o !== u && !unshoveable(o) && (o.f || 0) === (t.f || 0) ? o : null;
}
// What waits for t where it is shoved to, in words ("" for open ground): a fire, acid, a spike pit, a trench, a mine,
// wire, a fall, a window. The rules are combat.js moveAlong's (a mine is never stepped on by one of yours, a spike pit
// not by the dead nor by one of yours, a bear trap and wire hurt the dead).
export function pushHazard(b, u, t, dest = pushDest(b, u, t)) {
  if (!dest) return "";
  const out = [];
  if (dest.window) out.push(dest.window.closed ? "through a closed window (glass)" : "through the window");
  if (dest.drop > 0) out.push(`a ${dest.drop}-level fall`);
  const c = b.cells[dest.y * b.w + dest.x], trap = CELL[c.k].trap, dead = t.kind === "zombie";
  if (fireAt(b, dest.x, dest.y)) out.push("the flames");
  if (acidAt(b, dest.x, dest.y)) out.push("the acid");
  if (c.mine && t.side !== "player") out.push("a mine");
  if (trap === "spikes" && (dead || t.side !== "player")) out.push("a spike pit");
  else if (trap === "trench") out.push("a trench");
  else if (trap === "beartrap" && dead) out.push("a bear trap");
  else if (trap === "wire" && (dead || t.kind !== "zombie")) out.push("wire");
  return out.join(" and ");
}
// Flat on their back: no overwatch, no hunker; getting up is an action. In their own side's phase (a shove from a
// friend, a third-side unit shoved in the enemy phase) it comes out of this turn at once.
function floor(b, t) {
  if (!active(t)) return;
  t.hunker = false; t.ow = false;
  if ((b.phase === "player") === (t.side === "player") && t.ap > 0) t.ap -= 1;
  else t.floored = 1;
}
// The shove (combatAct "shoveFoe" and the AI). Returns "" or why not.
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
    if (t.side === "enemy" && !t.dead && !t.aware) alertPod(b, t.pod, `${t.name} cries out!`);
    return "";
  }
  const dest = pushDest(b, u, t), behind = pushBlocker(b, u, t);
  const fall = dest && dest.drop > 0, thru = dest && dest.window;
  const knock = !dest || fall || !!thru || hash01(b.rng.state, "pushknock", b.pushes, u.id, t.id) < o.knock;
  fx(b, { type: "melee", from: [u.x, u.y], to: [t.x, t.y], hit: true, crit: false, dmg: 0, side: u.side, text: thru ? "THROUGH" : fall ? "FALL" : knock ? "FLOORED" : "SHOVED" });
  const first = t.name;
  if (dest) {
    let glass = 0;
    if (thru && thru.closed) { // the pane goes with a crash, and cuts them
      const w = b.cells[thru.y * b.w + thru.x];
      smashWindow(b, w);
      glass = Math.round(damage(b, t, PUSH.GLASS[0] + Math.floor(hash01(b.rng.state, "pushglass", b.pushes, t.id) * (PUSH.GLASS[1] - PUSH.GLASS[0] + 1)), null, false, { how: "glass" }));
      glassNoise(b, thru.x, thru.y, { say, alertNear });
    }
    say(b, `${u.name} shoves ${first} ${thru ? (thru.closed ? `through the window: the glass goes with a crash${glass ? ` and cuts them (${glass})` : ""}` : "out through the window") : fall ? `off the edge, ${dest.drop} level${dest.drop === 1 ? "" : "s"} down` : knock ? "back and flat on their back" : "back a step"}.`, good);
    if (active(t)) {
      const face = t.face;
      t.shoved = true; // no overwatch fires at someone being shoved (combat.js moveAlong)
      try { moveAlong(b, t, [[dest.x, dest.y]]); } finally { delete t.shoved; } // a trench, a pit, a mine, the flames, acid: what is there
      t.face = face; // shoved backwards: still facing the shover
    }
    if (fall && active(t)) {
      const eff = Math.round(damage(b, t, (PUSH.FALL[0] + Math.floor(hash01(b.rng.state, "pushfall", b.pushes, t.id) * (PUSH.FALL[1] - PUSH.FALL[0] + 1))) * dest.drop, null, false, { how: "fall" }));
      say(b, `${first} hits the ground (${eff}).`, good);
    }
  } else say(b, `${u.name} shoves ${first} against ${behind ? `${behind.name}` : "what is behind them"}: ${knock ? "flat on their back" : "back a step"}.`, good);
  if (t.brace) delete t.brace; // a braced door let go (buildingmaps.js)
  if (knock) floor(b, t); else { t.hunker = false; t.ow = false; }
  // The one right behind (the cell they were pushed toward) goes down too.
  if (behind && knock && !dest && hash01(b.rng.state, "pushchain", b.pushes, behind.id) < PUSH.CHAIN) {
    floor(b, behind);
    say(b, `${behind.name} is taken down with them.`, behind.side === "player" ? "danger" : "good");
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

// ---------- the AI (combat.js aiUnit) ----------
// How much a shove at t is worth to u, 0 for none: into a hazard, a fall or a window 3 (the harm, whatever u carries).
function worth(b, u, t) {
  return t.floored ? 0 : pushHazard(b, u, t) ? 3 : 0;
}
// A melee fighter shoves only what stays put to be hit: someone with no room behind them (flat for sure when it lands) or
// a hazard behind them; a shove that only moves them a tile costs the blow, the step back in being the next action.
const meleeWorth = (b, u, t) => (t.floored ? 0 : pushHazard(b, u, t) ? 3 : pushDest(b, u, t) ? 0 : 2);
const candidates = (b, u, min, score = worth) => pushTargets(b, u).map((t) => ({ t, w: score(b, u, t), o: pushOdds(b, u, t) })).filter((p) => p.w >= min && p.o.chance >= PUSH.AI_MIN).sort((p, q) => q.w - p.w || q.o.chance - p.o.chance);
const rolled = (b, u, what, p) => hash01(b.rng.state, what, b.turn, u.id) < p;
const canTry = (b, u) => u.kind === "human" && !u.ztype && u.ap >= 1 && u.pushedT !== b.turn && !pushRefusal(b, u);
// With a gun ready: only a foe who would land in a hazard, a fall or a window is worth the action (tools/shovebalance.js:
// a gunman shoving the dead off to make room, then shooting, threw away a shot a time and lost fights it won).
// Once a turn. Returns true when it shoved.
export function aiPush(b, u) {
  if (!canTry(b, u) || !isRanged(u) || !canFire(b, u)) return false;
  const list = candidates(b, u, 3);
  if (!list.length || !rolled(b, u, "aipush", PUSH.AI_HAZARD)) return false;
  u.pushedT = b.turn;
  return pushAct(b, u, list[0].t) === "";
}
// A melee fighter (no gun to shoot): a shove first, then the blow on whoever is flat (+PUSH.FLOOR_AIM) with the
// action left: at a foe with a wall or someone behind them, the dead too, or into a hazard (meleeWorth).
export function aiMeleePush(b, u) {
  if (!canTry(b, u) || canFire(b, u)) return false;
  const list = candidates(b, u, 2, meleeWorth).filter((p) => p.w === 3 || u.ap >= 2);
  if (!list.length || !rolled(b, u, "aimpush", list[0].w === 3 ? PUSH.AI_HAZARD : PUSH.AI_MELEE)) return false;
  u.pushedT = b.turn;
  return pushAct(b, u, list[0].t) === "";
}
// Running (flee) with two or more foes right round it: one is shoved aside first to open the way, the one best to
// land (not one of the dead that is bigger than a person: they are not shoved at all). The run goes on after.
export function aiBreakOut(b, u) {
  if (!canTry(b, u)) return false;
  const near = foesOf(b, u).filter((t) => (t.f || 0) === (u.f || 0) && meleeReach(b, u, t));
  if (near.length < 2) return false;
  const list = pushTargets(b, u).map((t) => ({ t, o: pushOdds(b, u, t) })).filter((p) => p.o.chance >= PUSH.AI_MIN).sort((p, q) => q.o.chance - p.o.chance);
  if (!list.length || !rolled(b, u, "aiout", PUSH.AI_OUT)) return false;
  u.pushedT = b.turn;
  return pushAct(b, u, list[0].t) === "";
}
