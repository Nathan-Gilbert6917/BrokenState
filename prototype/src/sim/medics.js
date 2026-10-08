// Medics, the downed and dragging them in battle (combat.js hooks, each marked "medics.js").
//
// A medic is no class of its own: anyone who takes the field with a med kit (a bandage, trauma or surgical kit; in the
// off hand, a pocket or the pack) with uses left. Their Medicine (skill + the kit's bonus, crafting.js medKitBonus)
// says how good they are. On top of Use meds they can:
//   Heal    1 action, 1 meds (your side's pool) and a kit use: more than plain meds (HEAL), on themselves or next to them.
//   Revive  2 actions, 1 meds and a kit use, next to a downed ally: REVIVE.BASE + REVIVE.MED a point of Medicine +
//           REVIVE.KIT a point of the kit's bonus (+ REVIVE.STAB when already stabilized), at most REVIVE.MAX. Up: 25-40%
//           health, no actions until their next turn, shaken (−SHAKEN aim for the rest of the battle). Failed: they
//           are stabilized at least; the meds and the kit use are spent.
// Anyone can stabilize a downed ally (Use meds): sure with meds in the pool, else with their hands (pressure, a belt
// for a tourniquet): HANDS.BASE + HANDS.MED a point of Medicine, at most HANDS.MAX, and a failed try can be repeated.
// Anyone can drag a downed ally (Drag ally): picked up for free, moved at half speed (both actions go on moving, no
// shooting), put down for free: in cover, on the evac strip, or laid in the team's vehicle.
//
// Enemy people go down at 0 health too (they used to die): they bleed out in BLEED turns unless stabilized, their own
// people drag them out of the line of fire and stabilize them, and a medic among them (MEDIC.ENEMY: about one group
// in five of soldiers, guards, militia and fighters has one) revives them. Your people can finish a downed enemy
// (Finish: a shot, FINISH, or a blow from next to them): dead for good. After a won battle the downed who were
// stabilized or tied up are prisoners (stealth.js battleCaptives); the rest die.
// Raiders and zealots finish your downed when nothing more urgent is going on (a line of sight and less than full
// cover, or from next to them); now and then (FINISH.CAPTURE) one next to a downed survivor drags them off toward
// the edge instead: freed if the dragger goes down or is hurt badly, a captive of their group (conflicts.js
// takeCaptive) if the dragger gets them off the map or the battle is lost with them still in hand.
// The AI (both sides, the raid bot, "the AI plays my side") weighs a rescue against the fight: one rescuer for each
// downed ally, only when the way there is not open ground under fire (unless it is close), dragging to the cell with
// the most cover and the fewest eyes on it, reviving or stabilizing there; a medic heals the badly hurt.
import { GEAR } from "./data.js";
import { gearEffect, survivorById, factionById, hurt } from "./world.js";
import { packOf } from "./inventory.js";
import { itemDur, wearHeld } from "./crafting.js";
import { hash01 } from "./skills.js";
import { takeCaptive } from "./conflicts.js";
import { dropHaul, atVehicle } from "./raidloot.js";
import { WORM } from "./worm.js";
import { shotNoise } from "./stealth.js";
import {
  say, fx, active, adjacent, unitById, unitAt, medsLeft, reachable, pathTo, moveAlong, coverAgainst, los, sightRange, canSeeAt,
  canFire, hasShots, isRanged, damage, distField, loadMag, magIn, hasMag, WEAPONS, shotOdds, CELL, aboardCount, alertNear,
} from "./combat.js";

export const MEDIC = {
  HEAL: { BASE: 25, MED: 2, KIT: 4 },
  REVIVE: { AP: 2, BASE: 50, MED: 4, KIT: 5, STAB: 15, MAX: 95, HP: [0.25, 0.4], SHAKEN: 10 },
  HANDS: { BASE: 50, MED: 4, MAX: 90 },
  DRAG: 0.5,              // move × while dragging someone
  BLEED: 3,
  OVERKILL: 1,            // an enemy hit for at least this × their health in one blow dies outright (no going down)               // an enemy's turns to bleed out (as your people's, combat.js BLEED_TURNS)
  TREATING: 1.25,         // shotPriority × for a medic who treated, dragged or stabilized someone this turn or the last
  END_KIT: 5,             // endBattle: a medic with a kit left counts this much more Medicine for the downed's odds
  // Enemy medics: one in about GROUP battles of these kits has one, carrying KIT with USES, Medicine MED.
  ENEMY: { GROUP: 0.2, KITS: { soldiers: "traumakit", guards: "bandagekit", militia: "bandagekit", fighters: "bandagekit" }, MED: [3, 6], USES: 4 },
  // Finishing someone who is down: a shot BASE% out to FROM tiles, PER% less a tile past it (at least MIN), a blow
  // from next to them sure. Enemy KITS do it (when no standing foe is next to them and no shot of URGENT% or more is
  // on offer); CAPTURE of the time one next to a downed survivor drags them off as a prisoner instead; a dragger hurt
  // under LET_GO of their health lets go.
  FINISH: { BASE: 90, FROM: 6, PER: 5, MIN: 30, KITS: ["raiders", "zealots"], URGENT: 55, CAPTURE: 0.15, LET_GO: 0.5 },
  // The AI's sense of danger at a cell (exposure): a shooter that sees it through full / half / no cover, a melee foe
  // within MELEE_R. SAFE: under this is safe; HEAVY: open ground under fire (a rescuer goes there only when the
  // downed ally is within one move); REVIVE: a medic revives (2 actions) only under this.
  RISK: { FULL: 0.5, HALF: 2, OPEN: 4, MELEE: 3, MELEE_R: 3.5, SAFE: 1, HEAVY: 4, REVIVE: 2 },
  // By the numbers (breakoff.js rollFight): a won fight fought to the end; each member who fell is saved (barely
  // alive) by a medic with a kit still standing: SAVE + PER_MED a point of their Medicine, at most MAX.
  NUMBERS: { SAVE: 0.15, PER_MED: 0.025, MAX: 0.6 },
};

// combat.js internals the medic code needs (set once by combat.js: setMedicHooks). `var`: usable before this module's
// body has run (the imports are circular).
var H; // eslint-disable-line no-var
export function setMedicHooks(h) { H = h; }

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const first = (u) => u.name.split(" ")[0];

// ---------- the kit ----------
const isKitItem = (it) => !!(it && GEAR[it.key] && GEAR[it.key].medKit && (itemDur(it) == null || itemDur(it) > 0));
// A survivor's med kit: the off hand's, else the first in a pocket or the pack. { item, pack } or null.
export function kitOf(s) {
  if (!s || !s.gear) return null;
  if (isKitItem(s.gear.tool)) return { item: s.gear.tool, pack: false };
  const pk = packOf(s);
  for (const it of [...(s.pockets || []), ...((pk && pk.contents) || [])]) if (isKitItem(it)) return { item: it, pack: true };
  return null;
}
// The Medicine a kit adds for this survivor (crafting.js medKitBonus's rule, for a kit wherever it is carried).
export function kitBonusOf(s, it) {
  const d = it && GEAR[it.key];
  if (!d || !d.medKit) return 0;
  const eff = gearEffect(s, it);
  return eff.usable ? Math.round(d.medKit * eff.mult * 10) / 10 : 0;
}
// combat.js playerUnit: a kit in a pocket or the pack counts in battle too (the off hand's is counted there already).
export function fitMedic(u, s) {
  if (u.medKit) return;
  const k = kitOf(s);
  if (!k || !k.pack) return;
  u.medKit = k.item; u.kitPack = true;
  u.kitBonus = kitBonusOf(s, k.item);
  u.kitLeft = itemDur(k.item) ?? Infinity;
  u.medicine += u.kitBonus;
}
// A medic: a kit with uses left that they can use.
export const isMedic = (u) => !!(u && u.medKit && u.kitBonus > 0 && (u.kitUses || 0) < u.kitLeft);
const medSkill = (u) => Math.max(0, (u.medicine || 0) - (u.kitBonus || 0));
// By the numbers (breakoff.js memberOf): Medicine with the kit, and whether there is a kit.
export function memberMedic(s) {
  const k = kitOf(s);
  return { kit: !!k && kitBonusOf(s, k.item) > 0, bonus: k ? kitBonusOf(s, k.item) : 0, offHand: !!k && !k.pack };
}
// The best medic among these units for the downed's odds when a battle ends (combat.js endBattle).
export const medicLevel = (list) => Math.max(0, ...list.map((u) => (u.medicine || 0) + (isMedic(u) ? MEDIC.END_KIT : 0)));

function useKit(b, u) {
  if (!u.medKit || !u.kitBonus) return;
  u.kitUses = (u.kitUses || 0) + 1;
  if (u.kitUses >= u.kitLeft) {
    u.medicine -= u.kitBonus;
    u.kitBonus = 0;
    say(b, `${u.name}'s ${u.medKit.name} is used up.`, "info");
  }
}
// combat.js wearFielded: a kit carried in a pocket or the pack wears by its uses too.
export function wearPackKit(state, u, s) {
  if (u.kitUses && u.medKit && u.kitPack) wearHeld(state, u.medKit, [s], [], u.kitUses);
}
// Meds out of your side's pool (the enemy carries their own: their kit).
function spendMeds(b, u) {
  if (u.side !== "player") return;
  H.take(b, "meds", 1);
  b.medsUsed++;
}
const treated = (b, u) => { u.treating = b.turn; };
function rescueRecord(b, u, t) {
  if (u === t || u.sid == null || t.sid == null) return;
  ((b.rescuesBy || (b.rescuesBy = {}))[u.sid] || (b.rescuesBy[u.sid] = [])).push(t.sid);
}

// ---------- enemy medics ----------
// combat.js enemyUnit: the first person of an eligible kit in a battle is its group's medic about one battle in five
// (own dice: the battle's are not used).
export function enemyMedic(b, rng, u, kind) {
  const key = MEDIC.ENEMY.KITS[kind];
  if (!key || !GEAR[key]) return;
  const roll = b.medicRoll || (b.medicRoll = {});
  if (!(kind in roll)) roll[kind] = hash01("medic", kind, b.tileId, rng && Number.isFinite(rng.state) ? rng.state : b.turn || 0) < MEDIC.ENEMY.GROUP;
  if (roll[kind] !== true) return;
  roll[kind] = "done";
  makeEnemyMedic(u, key, MEDIC.ENEMY.MED[0] + Math.floor(hash01("medicine", u.id, kind) * (MEDIC.ENEMY.MED[1] - MEDIC.ENEMY.MED[0] + 1)));
}
export function makeEnemyMedic(u, key = "bandagekit", med = 4) {
  u.medKit = { key, name: GEAR[key].name };
  u.kitBonus = GEAR[key].medKit;
  u.kitLeft = MEDIC.ENEMY.USES;
  u.kitUses = 0;
  u.medicine = med + u.kitBonus;
  u.isMedicKit = true;
  return u;
}

// ---------- treatments ----------
export function healRefusal(b, u, t) {
  if (!isMedic(u)) return "Heal needs a med kit with uses left (a bandage, trauma or surgical kit, in the off hand or the pack).";
  if (!t || t.side !== u.side || t.dead || t.left || t.off) return "No one to treat.";
  if (t !== u && !adjacent(u, t)) return "Must be next to them.";
  if (t.down) return "They are down: Revive them (2 actions), or stabilize them with Use meds.";
  if (t.hp >= t.maxHp) return "Not hurt.";
  if (u.side === "player" && medsLeft(b) < 1) return "No meds left.";
  if (u.ap < 1) return "No actions left.";
  return "";
}
export const healAmount = (u, t) => Math.round((MEDIC.HEAL.BASE + MEDIC.HEAL.MED * medSkill(u) + MEDIC.HEAL.KIT * (u.kitBonus || 0)) * (u.healMult || 1) * (t.wormed ? WORM.HEAL : 1));
export function medicHeal(b, u, t) {
  const amt = healAmount(u, t);
  spendMeds(b, u);
  if (u.xpT) u.xpT.heals++;
  if (u !== t && u.sid != null && t.sid != null) (b.healsBy || (b.healsBy = {}))[u.sid] = (b.healsBy[u.sid] || 0) + 1;
  const was = t.hp;
  t.hp = Math.min(t.maxHp, t.hp + amt);
  say(b, `${u.name} treats ${t === u ? "their own wounds" : t.name} with the ${u.medKit.name} (+${Math.round(t.hp - was)}).`, u.side === "player" ? "good" : "danger");
  fx(b, { type: "heal", to: [t.x, t.y] });
  useKit(b, u);
  u.ap -= 1;
  treated(b, u);
}

export const reviveOdds = (u, t) => Math.min(MEDIC.REVIVE.MAX, Math.round(MEDIC.REVIVE.BASE + MEDIC.REVIVE.MED * medSkill(u) + MEDIC.REVIVE.KIT * (u.kitBonus || 0) + (t && t.stab ? MEDIC.REVIVE.STAB : 0)));
// Someone down who could be revived (not one knocked out: they come to by themselves, stealth.js).
const revivable = (t) => !!t && t.down && !t.dead && !t.left && !t.off && !t.ko;
export function reviveRefusal(b, u, t) {
  if (!u.medKit || !(u.kitBonus > 0) || (u.kitUses || 0) >= u.kitLeft) return "Revive needs a med kit with uses left (a bandage, trauma or surgical kit) and meds: anyone can only stabilize (Use meds).";
  if (u.side === "player" && medsLeft(b) < 1) return "Revive needs meds as well as the kit: none left.";
  if (!revivable(t) || t.side !== u.side) return "Revive someone of yours who is down.";
  if (!adjacent(u, t)) return "Move next to them first.";
  if (u.ap < MEDIC.REVIVE.AP) return "Revive takes both actions.";
  return "";
}
// Up again: 25-40% health, no actions until their side's next turn, shaken for the rest of the battle.
export function standUp(b, t) {
  releaseDragged(b, t);
  t.down = false; t.stab = false; t.stabSure = false; t.bleed = 0; t.wounded = false;
  t.hp = Math.max(1, Math.round(t.maxHp * b.rng.range(MEDIC.REVIVE.HP[0], MEDIC.REVIVE.HP[1])));
  if (!t.shaken) { t.shaken = true; t.aim -= MEDIC.REVIVE.SHAKEN; }
  t.ap = 0; t.ow = t.hunker = false;
  if (t.side === "enemy") t.aware = true;
}
export function revive(b, u, t) {
  const p = reviveOdds(u, t);
  spendMeds(b, u);
  useKit(b, u);
  u.ap -= MEDIC.REVIVE.AP;
  if (u.xpT) u.xpT.heals += 2;
  rescueRecord(b, u, t);
  treated(b, u);
  fx(b, { type: "heal", to: [t.x, t.y] });
  if (b.rng.chance(p / 100)) {
    standUp(b, t);
    say(b, `${u.name} gets ${t.name} back on their feet (${p}%): ${Math.round(t.hp)} health, shaken (−${MEDIC.REVIVE.SHAKEN} aim). They can act next turn.`, u.side === "player" ? "good" : "danger");
    return true;
  }
  t.stab = true;
  if (u.miracle) t.stabSure = true;
  say(b, `${u.name} cannot bring ${t.name} round (${p}%), but stops the bleeding: stabilized.`, u.side === "player" ? "info" : "good");
  return false;
}

export const handsOdds = (u) => Math.min(MEDIC.HANDS.MAX, Math.round(MEDIC.HANDS.BASE + MEDIC.HANDS.MED * (u.medicine || 0)));
// Stabilize with bare hands (no meds; an enemy without a kit): 1 action, a roll; a failed try can be repeated.
export function stabilizeRefusal(b, u, t) {
  if (!revivable(t) || t.side !== u.side) return "Stabilize someone of yours who is down.";
  if (t.stab) return "Already stabilized.";
  if (t !== u && !adjacent(u, t)) return "Must be next to them.";
  if (u.ap < 1) return "No actions left.";
  return "";
}
export function stabilizeByHand(b, u, t) {
  const why = stabilizeRefusal(b, u, t);
  if (why) return why;
  const p = handsOdds(u);
  u.ap -= 1;
  treated(b, u);
  if (b.rng.chance(p / 100)) {
    t.stab = true;
    if (u.miracle) t.stabSure = true;
    if (u.xpT) u.xpT.heals++;
    rescueRecord(b, u, t);
    say(b, `${u.name} stops ${t.name}'s bleeding with bare hands and a belt (${p}%): stabilized.`, u.side === "player" ? "good" : "info");
    fx(b, { type: "heal", to: [t.x, t.y] });
  } else say(b, `${u.name} presses on ${t.name}'s wounds but cannot stop the bleeding (${p}%). It can be tried again.`, u.side === "player" ? "danger" : "info");
  return "";
}
// The AI's stabilize: meds from the pool (your side, sure: combat.js heal), the kit (an enemy medic, sure), else hands.
function stabilize(b, u, t) {
  if (u.side === "player" && medsLeft(b) >= 1) { H.heal(b, u, t); u.ap -= 1; treated(b, u); return; }
  if (u.side !== "player" && isMedic(u)) {
    useKit(b, u);
    t.stab = true;
    u.ap -= 1;
    treated(b, u);
    say(b, `${u.name} patches ${t.name} up with the ${u.medKit.name}: stabilized.`, "info");
    fx(b, { type: "heal", to: [t.x, t.y] });
    return;
  }
  stabilizeByHand(b, u, t);
}

// ---------- dragging ----------
export const dragging = (b, u) => (u && u.dragging != null ? unitById(b, u.dragging) || null : null);
export function liftRefusal(b, u, t) {
  if (u.dragging != null) return "Already dragging someone: put them down first.";
  if (u.carrying != null) return "Hands full: put the body down first.";
  if (!revivable(t) || t.side !== u.side) return "Drag a downed ally next to you.";
  if (t.draggedBy != null) return "Someone is already dragging them.";
  if (!adjacent(u, t)) return "Move next to them first.";
  if ((t.f || 0) !== (u.f || 0)) return "They are on another floor.";
  return "";
}
// Free: from now on the unit moves at half speed with the downed ally behind it, and cannot shoot.
export function lift(b, u, t, capture = false) {
  u.dragging = t.id;
  t.draggedBy = u.id;
  u.dragMob = u.mob;
  u.mob = Math.max(1, u.mob * MEDIC.DRAG);
  u.ow = u.hunker = false;
  u.captor = !!capture;
  treated(b, u);
  if (!capture) say(b, `${u.name} grabs ${t.name} to drag them (half their move, no shooting).`, "info");
}
// Put the dragged ally down where they are (behind the dragger). into "vehicle": laid in the team's vehicle.
export function dropRefusal(b, u, into) {
  const t = dragging(b, u);
  if (!t) return "Not dragging anyone.";
  if (into === "vehicle") {
    if (!b.vehicle) return "There is no vehicle here.";
    if (!atVehicle(b, u)) return "Stand next to the vehicle to lay them in it.";
    if (aboardCount(b) >= (b.vehicle.seats || 4)) return `The ${b.vehicle.kind} is full.`;
  }
  return "";
}
export function dropAlly(b, u, into = null, quiet = false) {
  const t = dragging(b, u);
  u.dragging = null;
  if (u.dragMob != null) { u.mob = u.dragMob; u.dragMob = null; }
  u.captor = false;
  if (!t) return;
  t.draggedBy = null;
  if (into === "vehicle" && b.vehicle) {
    t.aboard = true; t.off = true; t.carried = true; // in the vehicle counts as carried out (combat.js endBattle)
    t.x = b.vehicle.x; t.y = b.vehicle.y;
    say(b, `${u.name} lays ${t.name} in the ${b.vehicle.kind}.`, "good");
    return;
  }
  if (!quiet) say(b, `${u.name} puts ${t.name} down${H.evacAt(b, t.x, t.y) ? " on the evac strip" : ""}.`, "info");
}
// The one who was dragging this downed unit lets go (it stood up, died, or was taken).
function releaseDragged(b, t) {
  if (t.draggedBy == null) return;
  const u = unitById(b, t.draggedBy);
  if (u && u.dragging === t.id) dropAlly(b, u, null, true);
  t.draggedBy = null;
}
// combat.js moveAlong: the dragged ally comes along, on the cell behind the dragger.
export function dragFollow(b, u, from, walked) {
  const t = dragging(b, u);
  if (!t) return;
  const cells = [from, ...walked];
  for (let i = cells.length - 2; i >= 0; i--) {
    const [x, y] = cells[i];
    const o = unitAt(b, x, y);
    if (o && o !== t) continue;
    if (t.x === x && t.y === y) return;
    const was = [t.x, t.y];
    t.x = x; t.y = y; t.f = u.f || 0;
    fx(b, { type: "move", unit: t.id, from: was, path: [[x, y]] });
    return;
  }
}
// combat.js bump: a dragger who is no longer standing (down, dead, gone, aboard) lets go; so does one whose ally got up.
export function dragSweep(b) {
  for (const u of b.units) {
    if (u.dragging == null) continue;
    const t = unitById(b, u.dragging);
    if (!active(u) || !t || !t.down || t.dead || t.left || t.off) dropAlly(b, u, null, true);
  }
}

// ---------- the downed: going down, finishing ----------
// combat.js damage, once the hit has brought the unit to 0: a downed survivor hit by someone is finished (dead); an
// enemy person goes down (instead of dying) the first time, unless the blow was so heavy (eff at least OVERKILL × their
// health) that it killed outright. true: handled.
export function downedHit(b, t, by, eff = 0) {
  if (t.side === "player" && t.down && by) {
    killDowned(b, t, by);
    return true;
  }
  if (t.side === "enemy" && t.kind === "human" && !t.down && !t.boss && !t.wild && eff < MEDIC.OVERKILL * (t.maxHp || 100)) {
    t.down = true; t.wounded = true; t.hp = 0;
    t.bleed = MEDIC.BLEED;
    t.ow = t.hunker = false;
    releaseDragged(b, t);
    if (t.dragging != null) dropAlly(b, t, null, true);
    // Counted as put down (skills.js XP, the service record) now: finishing them later counts nothing more.
    if (by && by.xpT) by.xpT.kills++;
    if (by && by.sid != null) { const k = (b.killsBy || (b.killsBy = {}))[by.sid] || (b.killsBy[by.sid] = { z: 0, h: 0 }); k.h++; }
    say(b, `${t.name} goes down, bleeding.`, "good");
    return true;
  }
  if (t.side === "player" && !t.down && t.dragging != null) dropAlly(b, t, null, true); // going down: lets go
  return false;
}
// A downed survivor killed (finished off by an enemy, shot again).
function killDowned(b, t, by, how = "") {
  releaseDragged(b, t);
  t.dead = true;
  t.killedBy = by ? by.side : null;
  const pile = dropHaul(b, t); // raidloot.js: their body, what they carried loose on it
  void pile;
  say(b, by ? `${by.name} finishes ${t.name} off${how}.` : `${t.name} dies where they lie.`, "death");
  fx(b, { type: "melee", from: [by ? by.x : t.x, by ? by.y : t.y], to: [t.x, t.y], hit: true, crit: false, dmg: 0, side: by ? by.side : "enemy", text: "KILLED" });
}
// An enemy who is down killed for good (finished, bled out, the battle over): the usual death (the body, a raid's body
// to search). by is left out: they were counted when they went down.
export function killFoe(b, t, line = "") {
  releaseDragged(b, t);
  if (line) say(b, line, "good");
  t.down = true;
  damage(b, t, 9999, null);
  t.down = false; // dead now: not "down"
}
// combat.js endPlayerTurn: the enemy's downed bleed (stabilized ones do not).
export function foesBleed(b) {
  for (const t of b.units) {
    if (t.side !== "enemy" || !t.wounded || !t.down || t.dead || t.stab) continue;
    t.bleed = (t.bleed || MEDIC.BLEED) - 1;
    if (t.bleed <= 0) killFoe(b, t, `${t.name} bleeds out.`);
  }
}
// combat.js endBattle / endRaid: the enemy's downed after the battle. Won: those stabilized or tied up are prisoners
// (knocked out to stealth.js battleCaptives); the rest die. Anything else: they die (their people leave with them or
// they are left to bleed: either way not yours).
export function settleFoes(b, outcome) {
  for (const t of b.units) {
    if (t.side !== "enemy" || !t.wounded || !t.down || t.dead) continue;
    releaseDragged(b, t);
    if ((outcome === "victory" || outcome === "raid") && (t.stab || t.tied)) { t.ko = true; continue; }
    t.dead = true;
  }
}

// ---------- finishing a downed enemy (your side: act "finish") ----------
const finishable = (t) => !!t && t.side === "enemy" && t.kind === "human" && t.down && !t.dead && !t.off && !t.left;
export const finishOdds = (u, t) => (adjacent(u, t) ? 100 : Math.max(MEDIC.FINISH.MIN, Math.min(95, MEDIC.FINISH.BASE - MEDIC.FINISH.PER * Math.max(0, dist(u.x, u.y, t.x, t.y) - MEDIC.FINISH.FROM))));
export function finishRefusal(b, u, t) {
  if (!finishable(t)) return "Finish needs an enemy who is down.";
  if (adjacent(u, t)) return "";
  if (!isRanged(u)) return "Move next to them to finish them with a blow.";
  if (!canFire(b, u)) return H.fireRefusal(b, u) || "Cannot shoot right now.";
  if (!canSeeAt(b, u, t.x, t.y)) return "No line of sight.";
  return "";
}
// 1 action: a blow from next to them (sure, silent), else one round (FINISH odds, the noise of a shot).
export function finishOff(b, u, t) {
  const why = finishRefusal(b, u, t);
  if (why) return why;
  u.ap -= 1;
  u.hunker = false;
  u.face = [Math.sign(t.x - u.x), Math.sign(t.y - u.y)];
  if (adjacent(u, t)) {
    fx(b, { type: "melee", from: [u.x, u.y], to: [t.x, t.y], hit: true, crit: false, dmg: 0, side: u.side, text: "KILLED" });
    killFoe(b, t, `${u.name} finishes ${t.name} off with a blow.`);
    return "";
  }
  const w = WEAPONS[u.weapon];
  const p = finishOdds(u, t);
  H.spendRounds(b, u, w);
  const noise = shotNoise(b, u, w);
  b.noise += noise;
  if (noise) b.gunshots = (b.gunshots || 0) + noise / w.noise;
  const hit = b.rng.chance(p / 100);
  fx(b, { type: "shot", from: [u.x, u.y], to: [t.x, t.y], hit, crit: false, dmg: 0, side: u.side });
  if (hit) killFoe(b, t, `${u.name} puts a round into ${t.name} where they lie (${p}%): dead.`);
  else say(b, `${u.name} shoots at ${t.name} on the ground and misses (${p}%).`, "info");
  if (noise && b.raid) alertNear(b, u.x, u.y, (9 + w.noise * 2) * (noise / w.noise), noise < w.noise ? "The muffled shot still carries." : "The gunshot alerts everything nearby.");
  else if (noise && noise < w.noise) alertNear(b, u.x, u.y, (9 + w.noise * 2) * (noise / w.noise), "The muffled shot still carries.");
  else if (noise) H.alertAll(b, "The gunshot alerts everyone nearby.");
  return "";
}

// ---------- the AI ----------
// The danger at (x, y) from these foes: { threat, safe }.
export function exposure(b, x, y, foes) {
  const R = MEDIC.RISK;
  let threat = 0;
  for (const f of foes) {
    const d = dist(f.x, f.y, x, y);
    if (f.kind === "zombie" || !isRanged(f) || !hasShots(b, f)) { if (d <= R.MELEE_R) threat += R.MELEE; continue; }
    if (d > sightRange(b, f) || !los(b, f.x, f.y, x, y)) continue;
    const c = coverAgainst(b, x, y, f.x, f.y).level;
    threat += c >= 2 ? R.FULL : c === 1 ? R.HALF : R.OPEN;
  }
  return { threat, safe: threat < R.SAFE };
}
// Whom the AI is wary of: the foes standing and aware (the sleeping and the fleeing do not shoot).
const threats = (b, u) => H.foesOf(b, u).filter((f) => f.aware !== false && !f.dormant && !f.fleeing && (f.f || 0) === (u.f || 0));
// The cell to drag to with one action at drag speed: where the dragged ally lands (the cell behind the dragger) has
// the least exposure, then the farthest from the foes. { x, y, path, threat, at: [x, y] of the ally } or null.
export function dragCell(b, u, foes) {
  const t = dragging(b, u);
  if (!t) return null;
  const r = reachable(b, u, u.mob);
  const W = b.w;
  let best = null;
  for (let i = 0; i < r.dist.length; i++) {
    if (!isFinite(r.dist[i]) || r.dist[i] <= 0) continue;
    const p = r.prev[i] >= 0 ? r.prev[i] : u.y * W + u.x;
    const px = p % W, py = (p / W) | 0;
    const o = unitAt(b, px, py);
    if (o && o !== t && o !== u) continue;
    const x = i % W, y = (i / W) | 0;
    const e = exposure(b, px, py, foes);
    const near = foes.length ? Math.min(...foes.map((f) => dist(f.x, f.y, px, py))) : 20;
    const sc = -e.threat * 3 - exposure(b, x, y, foes).threat * 0.5 + Math.min(12, near) * 0.3 - r.dist[i] * 0.05 + (u.side === "player" && H.evacAt(b, px, py) ? 1 : 0);
    if (!best || sc > best.sc) best = { x, y, sc, threat: e.threat, at: [px, py], i };
  }
  if (best) best.path = pathTo(r, best.x, best.y);
  return best;
}
// The edge the enemy leaves by (combat.js exitEdge: east, or the side a base was attacked from).
function enemyEdge(b) {
  const out = [];
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const edge = b.side === "west" ? x === 0 : b.side === "north" ? y === 0 : b.side === "south" ? y === b.h - 1 : x === b.w - 1;
    if (edge && CELL[b.cells[y * b.w + x].k].walk) out.push([x, y]);
  }
  return out;
}
const onEnemyEdge = (b, x, y) => (b.side === "west" ? x === 0 : b.side === "north" ? y === 0 : b.side === "south" ? y === b.h - 1 : x === b.w - 1);
// A raider dragging one of yours off: one action toward the edge; there, gone with them.
function captorStep(b, u) {
  const t = dragging(b, u);
  if (!t) return false;
  if (u.hp < u.maxHp * MEDIC.FINISH.LET_GO) { say(b, `${u.name} lets go of ${t.name} and backs off.`, "good"); dropAlly(b, u, null, true); return false; }
  if (!onEnemyEdge(b, u.x, u.y)) {
    const field = distField(b, enemyEdge(b));
    const r = reachable(b, u, u.mob);
    let best = -1;
    for (let i = 0; i < r.dist.length; i++) if (isFinite(r.dist[i]) && r.dist[i] > 0 && (best < 0 || field[i] < field[best])) best = i;
    if (best < 0 || field[best] >= field[u.y * b.w + u.x]) { dropAlly(b, u, null, true); return false; }
    u.ap -= 1;
    moveAlong(b, u, pathTo(r, best % b.w, (best / b.w) | 0));
    if (!active(u) || u.dragging == null) return true;
  }
  if (onEnemyEdge(b, u.x, u.y)) {
    t.taken = b.setup && b.setup.enemy ? b.setup.enemy.factionId ?? null : null;
    t.takenBy = u.name;
    dropAlly(b, u, null, true);
    t.off = true;
    u.fled = true; u.ap = 0;
    say(b, `${u.name} gets away with ${t.name}.`, "death");
  }
  return true;
}
// Who among the downed of the unit's side this unit should see to.
function downedOf(b, u) {
  return b.units.filter((t) => t.side === u.side && revivable(t) && t.draggedBy == null && !t.taken && (t.f || 0) === (u.f || 0)
    && !(t.rescuer != null && t.rescuer !== u.id && t.rescueTurn === b.turn && active(unitById(b, t.rescuer) || {})));
}
const claim = (b, u, t) => { t.rescuer = u.id; t.rescueTurn = b.turn; b.rescuing = b.rescuing || {}; b.rescuing[u.side] = b.turn; };
// One step of a rescue (an action, or a free pick-up / put-down). true when it did something.
export function rescueStep(b, u) {
  if (!active(u) || u.ap < 1 || u.kind !== "human" || u.carrying != null || (u.side !== "player" && u.side !== "enemy")) return false;
  const foes = threats(b, u);
  // Dragging: on to a cell with more cover, or down where they are once it is safe there (or nowhere is better).
  if (u.dragging != null) {
    if (u.captor) return captorStep(b, u);
    const t = dragging(b, u);
    if (!t) { dropAlly(b, u, null, true); return false; }
    const here = exposure(b, t.x, t.y, foes);
    if (here.safe) { dropAlly(b, u); t.noDrag = b.turn; return true; }
    const mv = dragCell(b, u, foes);
    if (mv && mv.threat < here.threat - 0.25 && mv.path.length) { u.ap -= 1; moveAlong(b, u, mv.path); return true; }
    dropAlly(b, u); t.noDrag = b.turn;
    return true;
  }
  if (foes.some((f) => adjacent(u, f))) return false; // something is on them: fight first
  const pool = u.side !== "player" || medsLeft(b) >= 1;
  for (const t of downedOf(b, u).sort((a, c) => dist(u.x, u.y, a.x, a.y) - dist(u.x, u.y, c.x, c.y))) {
    const ex = exposure(b, t.x, t.y, foes);
    const canRev = isMedic(u) && pool;
    if (adjacent(u, t)) {
      // Bleeding out this turn: stop it first. Exposed: out of the line of fire. Safe enough: revive (a medic) or stabilize.
      if (!t.stab && (t.bleed || 0) <= 1) { claim(b, u, t); stabilize(b, u, t); return true; }
      if (!ex.safe && t.noDrag !== b.turn && !liftRefusal(b, u, t)) { claim(b, u, t); lift(b, u, t); return true; }
      if (canRev && u.ap >= MEDIC.REVIVE.AP && ex.threat < MEDIC.RISK.REVIVE) { claim(b, u, t); revive(b, u, t); return true; }
      if (!t.stab) { claim(b, u, t); stabilize(b, u, t); return true; }
      continue;
    }
    // Not next to them: worth going over if they bleed, could be revived, or lie exposed.
    if (t.stab && !canRev && ex.safe) continue;
    const r = reachable(b, u, u.mob * u.ap);
    let best = null;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const x = t.x + dx, y = t.y + dy;
      if ((!dx && !dy) || x < 0 || y < 0 || x >= b.w || y >= b.h) continue;
      const c = r.dist[y * b.w + x];
      if (!isFinite(c)) continue;
      const e = exposure(b, x, y, foes);
      const sc = e.threat + c * 0.1;
      if (!best || sc < best.sc) best = { x, y, c, e, sc };
    }
    if (!best) continue;
    const close = best.c <= u.mob;
    // Open ground under fire: only when they are close (one move). A dash (both actions): only where it is quiet.
    if (best.e.threat >= MEDIC.RISK.HEAVY && !close) continue;
    if (!close && best.e.threat >= MEDIC.RISK.REVIVE) continue;
    claim(b, u, t);
    u.ap -= close ? 1 : 2;
    u.hunker = false;
    moveAlong(b, u, pathTo(r, best.x, best.y));
    return true;
  }
  // A medic heals the badly hurt (themselves or next to them).
  if (isMedic(u) && pool) {
    const hurtOnes = b.units.filter((o) => o.side === u.side && active(o) && (o === u || adjacent(u, o)) && o.hp < o.maxHp * 0.5).sort((a, c) => a.hp / a.maxHp - c.hp / c.maxHp);
    if (hurtOnes.length) { medicHeal(b, u, hurtOnes[0]); return true; }
  }
  return false;
}

// Raiders and zealots: finish one of your downed in reach when nothing more urgent is going on; now and then drag one
// off as a prisoner instead. true when it acted.
export function finishTurn(b, u) {
  if (u.side !== "enemy" || u.kind !== "human" || !MEDIC.FINISH.KITS.includes(u.kit) || u.dragging != null || u.ap < 1) return false;
  const prey = b.units.filter((t) => t.side === "player" && t.down && !t.dead && !t.left && !t.off && !t.taken && (t.f || 0) === (u.f || 0));
  if (!prey.length) return false;
  const foes = threats(b, u);
  if (foes.some((f) => adjacent(u, f))) return false;
  if (canFire(b, u) && foes.some((f) => canSeeAt(b, u, f.x, f.y) && shotOdds(b, u, f).chance >= MEDIC.FINISH.URGENT)) return false;
  const adj = prey.find((t) => adjacent(u, t));
  if (adj) {
    const fid = b.setup && b.setup.enemy ? b.setup.enemy.factionId : null;
    if (fid != null && !b.raid && adj.draggedBy == null && b.rng.chance(MEDIC.FINISH.CAPTURE)) {
      lift(b, u, adj, true);
      say(b, `${u.name} drags ${adj.name} away as a prisoner!`, "death");
      captorStep(b, u);
      return true;
    }
    u.ap -= 1;
    killDowned(b, adj, u, " with a blow");
    return true;
  }
  if (!canFire(b, u)) return false;
  const seen = prey.filter((t) => canSeeAt(b, u, t.x, t.y) && coverAgainst(b, t.x, t.y, u.x, u.y).level < 2).sort((a, c) => dist(u.x, u.y, a.x, a.y) - dist(u.x, u.y, c.x, c.y));
  const t = seen[0];
  if (!t) return false;
  const w = WEAPONS[u.weapon];
  if (hasMag(u)) loadMag(u, magIn(u) - w.ammo);
  b.gunshots = (b.gunshots || 0) + 1;
  const p = finishOdds(u, t);
  u.ap = 0;
  u.face = [Math.sign(t.x - u.x), Math.sign(t.y - u.y)];
  const hit = b.rng.chance(p / 100);
  fx(b, { type: "shot", from: [u.x, u.y], to: [t.x, t.y], hit, crit: false, dmg: 0, side: u.side });
  if (hit) killDowned(b, t, u, ` with a shot (${p}%)`);
  else say(b, `${u.name} shoots at ${t.name} on the ground and misses (${p}%).`, "info");
  return true;
}

// combat.js aiUnit: a rescue and (raiders) finishing before the usual fighting. flees: the unit is about to run (it
// drops whoever it drags). true: it did something (the AI goes on with the actions left).
export function rescueTurn(b, u, flees = false) {
  if (u.kind !== "human" || (u.side !== "player" && u.side !== "enemy")) return false;
  if (flees) { if (u.dragging != null) dropAlly(b, u); return false; }
  let acted = false;
  for (let i = 0; i < 4 && u.ap > 0 && active(u); i++) {
    if (!rescueStep(b, u)) break;
    acted = true;
  }
  if (u.ap > 0 && active(u) && finishTurn(b, u)) acted = true;
  if (u.dragging != null && u.ap > 0) u.ap = 0; // a dragger does nothing else
  return acted;
}
// combat.js aiUnit: with a rescue under way on its side, a unit with nothing better to do covers it (overwatch).
export const coveringRescue = (b, u) => !!(b.rescuing && b.rescuing[u.side] === b.turn);
// combat.js shotPriority: a medic seen treating someone is shot first.
export const treatingMult = (b, t) => (t.treating != null && b.turn - t.treating <= 1 && (isMedic(t) || t.dragging != null) ? MEDIC.TREATING : 1);

// ---------- after the battle ----------
// combat.js endBattle, for each of your people: taken off the map by a raider, or still being dragged off when the
// battle is lost: a captive of their group (conflicts.js takeCaptive), or dead if the group cannot hold anyone.
// Returns { line, dead } or null.
export function takenAway(state, b, u, s, outcome) {
  const captor = u.draggedBy != null ? unitById(b, u.draggedBy) : null;
  const held = u.taken !== undefined || (captor && captor.captor && outcome !== "victory");
  if (!held || u.dead) return null;
  const fid = u.taken !== undefined ? u.taken : b.setup.enemy.factionId;
  const f = fid != null ? factionById(state, fid) : null;
  if (f && f.alive && f.bases && f.bases.length) {
    const p = b.setup.partyId != null ? state.parties.find((x) => x.id === b.setup.partyId) : null;
    s.health = Math.min(s.health, Math.max(5, Math.round(s.health * 0.3)));
    takeCaptive(state, s, f, p);
    u.captured = true;
    return { line: `${u.name} was dragged away by ${f.name}: a prisoner now.`, dead: false };
  }
  hurt(state, s, 9999, b.tileId, `dragged off by ${b.setup.enemy.name || b.setup.enemy.kind}`);
  return { line: `${u.name} was dragged off and never seen again.`, dead: true };
}
export { survivorById };
