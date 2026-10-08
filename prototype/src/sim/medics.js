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
// cover, or from next to them) and none of your people stands within FINISH.GUARD tiles of them; now and then
// (nonlethal.js NL_TAKE, by the group's type) one next to a downed survivor drags them off toward the edge instead:
// freed if the dragger goes down or is hurt badly, a captive of their group (conflicts.js takeCaptive) if the dragger
// gets them off the map or the battle is lost with them still in hand.
// The AI (both sides, the raid bot, "the AI plays my side") weighs a rescue against the fight: one rescuer for each
// downed ally, only when the way there is not open ground under fire (unless it is close), dragging to the cell with
// the most cover and the fewest eyes on it (with a medic of theirs about: to a quiet cell, the medic named to revive
// them there, PLAN), reviving or stabilizing there, pulling one out of a vehicle first; a medic
// heals the badly hurt, and plain meds go on the standing, only above the side's reserve kept for a revive (RESERVE).
import { GEAR } from "./data.js";
import { gearEffect, survivorById, factionById, hurt } from "./world.js";
import { packOf } from "./inventory.js";
import { itemDur, wearHeld } from "./crafting.js";
import { hash01 } from "./skills.js";
import { takeCaptive } from "./conflicts.js";
import { dropHaul, atVehicle } from "./raidloot.js";
import { WORM } from "./worm.js";
import { shotNoise } from "./stealth.js";
import { NL_TAKE, TYPE_KIT } from "./nonlethal.js"; // how much each group's type takes people alive
import {
  say, fx, active, adjacent, unitById, unitAt, medsLeft, reachable, pathTo, moveAlong, coverAgainst, los, sightRange, canSeeAt,
  canFire, hasShots, isRanged, damage, meleeReach, distField, loadMag, magIn, hasMag, WEAPONS, shotOdds, CELL, aboardCount, alertNear,
  leaveTurret,
} from "./combat.js";

export const MEDIC = {
  HEAL: { BASE: 25, MED: 2, KIT: 4 },
  // Revive odds: BASE + MED a point of Medicine skill + KIT a point of the kit's bonus (+ STAB stabilized), at most MAX.
  // BASE 40, MED 3 and MAX 85 (were 50, 4 and 95: a Medicine 6-7 medic with a trauma kit hit the 95% cap on anyone
  // stabilized, and lowering only BASE or MAX still let them): an ordinary medic (Medicine 6-8, a bandage or trauma
  // kit) is at about 68-79%, 83-85% on the stabilized; the cap fresh takes Medicine 10 with a trauma kit.
  REVIVE: { AP: 2, BASE: 40, MED: 3, KIT: 5, STAB: 15, MAX: 85, HP: [0.25, 0.4], SHAKEN: 10 },
  // The meds the AI keeps back for a revive (your side's pool; an enemy medic's own kit uses), on any side with a medic
  // standing: 1 for every PER of its people in the fight (standing or down), at least MIN. Healing the standing (a
  // medic's Heal, plain meds on oneself) only spends above it; stabilizing and reviving the downed spend it.
  RESERVE: { PER: 3, MIN: 1 },
  // Pull out: a downed person in a vehicle (a rider, the turret's gunner who dropped inside, the gunner on the enemy's
  // Humvee) is pulled out by someone standing next to it onto a free cell next to both, for AP actions.
  PULL: { AP: 2 },
  // Drag first, then revive (the AI, both sides): a downed ally out in the open is dragged to a quiet cell (as quiet
  // as a revive needs: RISK.REVIVE) and put down there with a medic of theirs named to revive them (t.plan): the
  // dragger if they are one, else the nearest standing medic within reach of it next turn (two moves). For TURNS
  // turns after, that medic sees to them before anyone else; the others only stabilize them while the medic is on
  // the way (from next to them, with meds, a kit or by hand), and do not drag them off.
  PLAN: { TURNS: 2 },
  HANDS: { BASE: 50, MED: 4, MAX: 90 },
  DRAG: 0.5,              // move × while dragging someone
  BLEED: 3,               // an enemy's turns to bleed out (as your people's, combat.js BLEED_TURNS)
  OVERKILL: 2,            // an enemy hit for at least this × their full health in one blow dies outright (no going down)
  TREATING: 1.25,         // shotPriority × for a medic who treated, dragged or stabilized someone this turn or the last
  END_KIT: 5,             // endBattle: a medic with a kit left counts this much more Medicine for the downed's odds
  // Enemy medics: one in about GROUP battles of these kits has one, carrying KIT with USES, Medicine MED.
  ENEMY: { GROUP: 0.2, KITS: { soldiers: "traumakit", guards: "bandagekit", militia: "bandagekit", fighters: "bandagekit" }, MED: [3, 6], USES: 4 },
  // Finishing someone who is down: a shot BASE% out to FROM tiles, PER% less a tile past it (at least MIN), a blow
  // from next to them sure. Enemy KITS may do it (WILL of the time they could: when no standing foe is next to them and
  // no shot of URGENT% or more at one is on offer), and only a downed one with none of their people standing within
  // GUARD tiles (same floor; walls do not matter: someone close enough to come back for them). WILL was 0.5. One
  // next to a downed survivor takes them instead the share of the time their group's type takes people alive
  // (nonlethal.js NL_TAKE: raiders 25%, zealots never): one bleeding or stabilized is dragged off toward the edge, one knocked out or surrendered is tied up (taken after the battle,
  // nonlethal.js takenByEnemy). A dragger hurt under LET_GO of their health lets go.
  FINISH: { BASE: 90, FROM: 6, PER: 5, MIN: 30, KITS: ["raiders", "zealots"], URGENT: 35, WILL: 0.25, GUARD: 4, LET_GO: 0.5 },
  // The AI's sense of danger at a cell (exposure): a shooter that sees it through full / half / no cover, a melee foe
  // within MELEE_R. HEAVY: open ground under fire (a rescuer goes there only when the
  // downed ally is within one move); REVIVE: a medic revives (2 actions) only under this.
  RISK: { FULL: 0.5, HALF: 2, OPEN: 4, MELEE: 3, MELEE_R: 3.5, HEAVY: 4, REVIVE: 2 },
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
// The meds a side's AI keeps back for a revive (MEDIC.RESERVE): with a medic of theirs standing (or aboard), 1 for
// every PER of their people still in the fight, at least MIN; with none, nothing (no one could revive).
export function medsReserve(b, side) {
  const mine = b.units.filter((o) => o.side === side && o.kind === "human" && !o.dead && !o.left && !o.fled && !o.taken && (!o.off || o.aboard));
  if (!mine.some((o) => isMedic(o) && !o.down)) return 0;
  return Math.max(MEDIC.RESERVE.MIN, Math.ceil(mine.length / MEDIC.RESERVE.PER));
}
// What the AI may spend on healing the standing: your side's pool, an enemy medic's own kit uses, above the reserve.
export function spareMeds(b, u) {
  const have = u.side === "player" ? medsLeft(b) : isMedic(u) ? u.kitLeft - (u.kitUses || 0) : 0;
  return have - medsReserve(b, u.side);
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
  if (t !== u && !meleeReach(b, u, t)) return "Must be next to them (not across a wall's corner).";
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
// The states of the downed (stealth.js heldDown has the whole list): bleeding (down) or stabilized (down + stab) can be
// revived and stabilized; knocked out (ko) comes to by itself; surrendered (surr) is not down in need.
// Tied (combat.js isTied: a prisoner of either side, a captive in a rescue raid) is cut free first, never revived or dragged.
const revivable = (t) => !!t && t.down && !t.dead && !t.left && !t.off && !t.ko && !t.surr && !t.tied;
// Who a teammate can drag: the bleeding, the stabilized and the knocked out.
const draggable = (t) => !!t && t.down && !t.dead && !t.left && !t.off && !t.surr && !t.tied;
// The share of the time an enemy of this kit takes one of yours alive rather than finish them (nonlethal.js NL_TAKE by
// the group type the kit stands for: raiders 25%, zealots 0).
export const takeShare = (kit) => { const type = Object.keys(TYPE_KIT).find((k) => TYPE_KIT[k] === kit); return (type && NL_TAKE[type]) || 0; };
export function reviveRefusal(b, u, t) {
  if (!u.medKit || !(u.kitBonus > 0) || (u.kitUses || 0) >= u.kitLeft) return "Revive needs a med kit with uses left (a bandage, trauma or surgical kit) and meds: anyone can only stabilize (Use meds).";
  if (u.side === "player" && medsLeft(b) < 1) return "Revive needs meds as well as the kit: none left.";
  if (!revivable(t) || t.side !== u.side) return "Revive someone of yours who is down.";
  if (!meleeReach(b, u, t)) return "Move next to them first (not across a wall's corner).";
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
  if (t !== u && !meleeReach(b, u, t)) return "Must be next to them (not across a wall's corner).";
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
  if (!draggable(t) || t.side !== u.side) return "Drag a downed ally next to you.";
  if (t.draggedBy != null) return "Someone is already dragging them.";
  if (!meleeReach(b, u, t)) return "Move next to them first (not across a wall's corner).";
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
    // Still bleeding: stopped on the way in when the one laying them there has an action left (layInStab), as Use
    // meds would: sure with meds, by hand without (a roll). Laid in bleeding they bleed out inside as anywhere.
    if (layInStab(b, u, t)) stabilize(b, u, t);
    t.aboard = true; t.off = true; t.carried = true; // in the vehicle counts as carried out (combat.js endBattle)
    t.x = b.vehicle.x; t.y = b.vehicle.y;
    say(b, `${u.name} lays ${t.name} in the ${b.vehicle.kind}.`, "good");
    return;
  }
  if (!quiet) say(b, `${u.name} puts ${t.name} down${H.evacAt(b, t.x, t.y) ? " on the evac strip" : ""}.`, "info");
}
// Laying a bleeding ally in the vehicle stabilizes them first (1 action: meds from the pool, sure; none, by hand at
// handsOdds) when the one laying them in has an action left. "meds", "hands" or "" (none: they go in bleeding).
export function layInStab(b, u, t) {
  if (!revivable(t) || t.stab || !u || u.ap < 1) return "";
  return u.side === "player" ? (medsLeft(b) >= 1 ? "meds" : "hands") : isMedic(u) ? "meds" : "hands";
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

// ---------- pulling the downed out of a vehicle ----------
// A downed person in a vehicle cannot be treated, dragged or finished where they lie: a rider of your vehicle (down
// aboard: the turret's gunner who dropped inside, one hit by a blast through the windows, one laid in it), or the gunner
// on the enemy's Humvee (combat.js manEnemyTurret), who drops on its roof. Pull out (MEDIC.PULL.AP actions, either
// side): someone standing next to the vehicle hauls them out onto a free cell next to both (the one with the fewest eyes
// on it), where they can be revived, stabilized, dragged, tied or finished as usual. Pulled out of your vehicle, one
// laid in it no longer counts as carried out.
// The vehicle's rect they lie in: { x, y, w, h } (your vehicle for a rider aboard, else the car under them), or null.
export function vehicleOf(b, t) {
  if (!t || !t.down || t.dead || t.left || t.taken) return null;
  if (t.aboard) return b.vehicle ? { x: b.vehicle.x, y: b.vehicle.y, w: b.vehicle.w, h: b.vehicle.h } : null;
  if (t.off || t.x == null) return null;
  const c = b.cells[t.y * b.w + t.x];
  if (!c || !c.car || CELL[c.k].walk) return null;
  let x0 = t.x, y0 = t.y, x1 = t.x, y1 = t.y; // the car's cells share its id (combat.js placeCar)
  for (let y = Math.max(0, t.y - 6); y <= Math.min(b.h - 1, t.y + 6); y++) for (let x = Math.max(0, t.x - 6); x <= Math.min(b.w - 1, t.x + 6); x++) {
    const o = b.cells[y * b.w + x];
    if (o.car && o.car.id === c.car.id && o.k === c.k) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
const inRect = (r, x, y) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
const byRect = (r, x, y) => !inRect(r, x, y) && Math.max(r.x - x, x - (r.x + r.w - 1), r.y - y, y - (r.y + r.h - 1), 0) <= 1;
// The downed in a vehicle next to this unit (either side), the most urgent first: their own bleeding, their own
// stabilized, then the other side's.
export function pullTargets(b, u) {
  return b.units.filter((t) => { const r = t !== u && (t.f || 0) === (u.f || 0) ? vehicleOf(b, t) : null; return !!r && byRect(r, u.x, u.y); })
    .sort((a, c) => (a.side !== u.side) - (c.side !== u.side) || !!a.stab - !!c.stab || (a.bleed || 9) - (c.bleed || 9) || a.id - c.id);
}
// Where they are laid: a free walkable cell next to the vehicle and next to the puller (not across a wall's corner),
// the least exposed to the puller's foes (exposure), then the nearest. [x, y] or null.
export function pullCell(b, u, t, foes = threats(b, u)) {
  const r = vehicleOf(b, t);
  if (!r) return null;
  let best = null;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = u.x + dx, y = u.y + dy;
    if ((!dx && !dy) || x < 0 || y < 0 || x >= b.w || y >= b.h || !byRect(r, x, y)) continue;
    if (!CELL[b.cells[y * b.w + x].k].walk || unitAt(b, x, y) || !meleeReach(b, u, { x, y })) continue;
    const sc = exposure(b, x, y, foes).threat + (dx && dy ? 0.01 : 0);
    if (!best || sc < best.sc) best = { x, y, sc };
  }
  return best ? [best.x, best.y] : null;
}
export function pullRefusal(b, u, t) {
  if (!u || u.kind !== "human" || !active(u)) return "That unit cannot act.";
  if (u.dragging != null || u.carrying != null) return "Hands full: put down who (or what) they are dragging first.";
  const r = vehicleOf(b, t);
  if (!r) return "Pull out someone who is down inside a vehicle.";
  if ((t.f || 0) !== (u.f || 0) || !byRect(r, u.x, u.y)) return "Stand next to the vehicle first.";
  if (u.ap < MEDIC.PULL.AP) return `Pulling someone out takes ${MEDIC.PULL.AP} actions.`;
  if (!pullCell(b, u, t)) return "No free cell next to both of you to lay them on.";
  return "";
}
export function pullOut(b, u, t) {
  const why = pullRefusal(b, u, t);
  if (why) return why;
  const [x, y] = pullCell(b, u, t);
  const from = [t.x, t.y], r = vehicleOf(b, t);
  if (t.gunner) leaveTurret(b, t, true);
  if (t.aboard) { t.aboard = false; t.off = false; t.carried = false; }
  else if (b.raidHumvee && b.raidHumvee.gunAt === t.y * b.w + t.x) { // off the enemy Humvee's roof: no one on its gun now
    delete b.cells[b.raidHumvee.gunAt].h;
    for (let cy = r.y; cy < r.y + r.h; cy++) for (let cx = r.x; cx < r.x + r.w; cx++) { const c = b.cells[cy * b.w + cx]; if (c.car && c.car.up) c.car.up = { ...c.car.up, manned: false }; }
    b.raidHumvee.gunAt = null;
    if (b.losCache) b.losCache.fill(0);
  }
  t.x = x; t.y = y; t.f = u.f || 0;
  t.draggedBy = null;
  u.ap -= MEDIC.PULL.AP;
  u.ow = u.hunker = false;
  if (t.side === u.side) treated(b, u);
  fx(b, { type: "move", unit: t.id, from, path: [[x, y]] });
  const own = t.side === u.side;
  say(b, `${u.name} pulls ${t.name} out of the ${own ? "vehicle" : "enemy's vehicle"}${own ? "" : ` (${t.stab ? "stabilized" : t.ko ? "out cold" : "bleeding"})`}.`, u.side !== "player" ? "danger" : own ? "good" : "info");
  return "";
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
// (stealth.js prisonerOf: the one rule for battleCaptives, with the knocked out and the tied who surrendered); the rest die. Anything else: they die (their people leave with them or
// they are left to bleed: either way not yours).
export function settleFoes(b, outcome) {
  for (const t of b.units) {
    if (t.side !== "enemy" || !t.wounded || !t.down || t.dead) continue;
    releaseDragged(b, t);
    if ((outcome === "victory" || outcome === "raid") && (t.stab || t.tied)) continue; // prisoners (stealth.js prisonerOf, battleCaptives)
    t.dead = true;
  }
}

// ---------- finishing a downed enemy (your side: act "finish") ----------
// Finish: the bleeding or stabilized (u.wounded) who are not tied. Someone who gave up, is out cold or tied is a
// prisoner: killing them is Execute (nonlethal.js), which your people take hard.
const finishable = (t) => !!t && t.side === "enemy" && t.kind === "human" && t.down && t.wounded && !t.ko && !t.surr && !t.tied && !t.dead && !t.off && !t.left;
export const finishOdds = (u, t, b = null) => ((b ? meleeReach(b, u, t) : adjacent(u, t)) ? 100 : Math.max(MEDIC.FINISH.MIN, Math.min(95, Math.round(MEDIC.FINISH.BASE - MEDIC.FINISH.PER * Math.max(0, dist(u.x, u.y, t.x, t.y) - MEDIC.FINISH.FROM)))));
export function finishRefusal(b, u, t) {
  if (t && t.side === "enemy" && !t.dead && (t.ko || t.surr || t.tied)) return `${t.name} ${t.surr ? "has given up" : t.ko ? "is out cold" : "is tied up"}: a prisoner. Execute (next to them) kills them, and your people take it hard.`;
  if (!finishable(t)) return "Finish needs an enemy who is down.";
  if (meleeReach(b, u, t)) return "";
  if (!isRanged(u)) return adjacent(u, t) ? "Not across a wall's corner: move to their side to finish them with a blow." : "Move next to them to finish them with a blow.";
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
  if (meleeReach(b, u, t)) {
    fx(b, { type: "melee", from: [u.x, u.y], to: [t.x, t.y], hit: true, crit: false, dmg: 0, side: u.side, text: "KILLED" });
    killFoe(b, t, `${u.name} finishes ${t.name} off with a blow.`);
    return "";
  }
  const w = WEAPONS[u.weapon];
  const p = finishOdds(u, t, b);
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
// The danger at (x, y) from these foes: { threat, safe, exposed }. safe: no shooter sees it through less than full
// cover and no melee foe is close.
export function exposure(b, x, y, foes) {
  const R = MEDIC.RISK;
  let threat = 0, exposed = 0;
  for (const f of foes) {
    const d = dist(f.x, f.y, x, y);
    if (f.kind === "zombie" || !isRanged(f) || !hasShots(b, f)) { if (d <= R.MELEE_R) { threat += R.MELEE; exposed++; } continue; }
    if (d > sightRange(b, f) || !los(b, f.x, f.y, x, y)) continue;
    const c = coverAgainst(b, x, y, f.x, f.y).level;
    threat += c >= 2 ? R.FULL : c === 1 ? R.HALF : R.OPEN;
    if (c < 2) exposed++;
  }
  return { threat, exposed, safe: exposed === 0 };
}
// Whom the AI is wary of: the foes standing and aware (the sleeping and the fleeing do not shoot).
const threats = (b, u) => H.foesOf(b, u).filter((f) => f.aware !== false && !f.dormant && !f.fleeing && (f.f || 0) === (u.f || 0));
// The cell to drag to with the actions left at drag speed: where the dragged ally lands (the cell behind the dragger)
// has the least exposure, then the farthest from the foes. { x, y, path, cost, threat, at: [x, y] of the ally } or null.
export function dragCell(b, u, foes) {
  const t = dragging(b, u);
  if (!t) return null;
  const r = reachable(b, u, u.mob * Math.max(1, Math.min(2, u.ap)));
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
    if (!best || sc > best.sc) best = { x, y, sc, threat: e.threat, at: [px, py], i, cost: r.dist[i] };
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
  return b.units.filter((t) => t.side === u.side && revivable(t) && t.draggedBy == null && !t.taken && (t.f || 0) === (u.f || 0) && !vehicleOf(b, t) // in a vehicle: pulled out first (stuckOf)
    && !(t.rescuer != null && t.rescuer !== u.id && t.rescueTurn === b.turn && active(unitById(b, t.rescuer) || {})));
}
// The plan to revive this downed one (MEDIC.PLAN): { medic, turn } while it holds (the medic still standing and able
// to revive), else null.
const planOf = (b, t) => (t.plan && b.turn - t.plan.turn <= MEDIC.PLAN.TURNS && revivable(t) && canRevive(b, unitById(b, t.plan.medic)) ? t.plan : null);
// A medic who could revive now (standing, a kit with uses, meds for your side).
const canRevive = (b, m) => !!m && active(m) && isMedic(m) && (m.side !== "player" || medsLeft(b) >= 1);
// The medic to name for reviving t once dragged to a quiet cell by u: u, else the nearest of their side who is
// standing, free (not dragging) and within two moves of them. null: no one (the dragger only stabilizes then).
function planMedic(b, u, t) {
  if (canRevive(b, u)) return u;
  return b.units.filter((m) => m.side === u.side && m !== u && m.kind === "human" && canRevive(b, m) && m.dragging == null && (m.f || 0) === (t.f || 0) && dist(m.x, m.y, t.x, t.y) <= m.mob * 2 + 1.5)
    .sort((a, c) => dist(a.x, a.y, t.x, t.y) - dist(c.x, c.y, t.x, t.y) || a.id - c.id)[0] || null;
}
// Out of every line of fire but behind full cover, or nearly: where a medic revives (RISK.REVIVE).
const quiet = (e) => e.safe || e.threat < MEDIC.RISK.REVIVE;
const claim = (b, u, t) => { t.rescuer = u.id; t.rescueTurn = b.turn; b.rescuing = b.rescuing || {}; b.rescuing[u.side] = b.turn; };
// Theirs down in a vehicle (vehicleOf), bleeding or stabilized, not already seen to by another rescuer this turn; not one
// laid in your vehicle and stabilized (carried out already).
const stuckOf = (b, u) => b.units.filter((t) => t.side === u.side && t.kind === "human" && !t.ko && !t.surr && !t.tied && !(t.carried && t.stab) && (t.f || 0) === (u.f || 0) && vehicleOf(b, t)
  && !(t.rescuer != null && t.rescuer !== u.id && t.rescueTurn === b.turn && active(unitById(b, t.rescuer) || {})));
// Over to the cell among these (reachable this turn: r) with the least exposure, then the nearest: 1 action within one
// move, both for a dash. Not across open ground under fire unless it is one move (RISK.HEAVY), and a dash only to a
// cell that is quiet (RISK.REVIVE). go: called before the move. true when it moved.
function goOver(b, u, cells, foes, r, go) {
  let best = null;
  for (const [x, y] of cells) {
    if (x < 0 || y < 0 || x >= b.w || y >= b.h) continue;
    const c = r.dist[y * b.w + x];
    if (!isFinite(c)) continue;
    const e = exposure(b, x, y, foes);
    const sc = e.threat + c * 0.1;
    if (!best || sc < best.sc) best = { x, y, c, e, sc };
  }
  if (!best) return false;
  const close = best.c <= u.mob;
  // Open ground under fire: only when they are close (one move). A dash (both actions): only where it is quiet.
  if (best.e.threat >= MEDIC.RISK.HEAVY && !close) return false;
  if (!close && best.e.threat >= MEDIC.RISK.REVIVE) return false;
  go();
  u.ap -= close ? 1 : 2;
  u.hunker = false;
  moveAlong(b, u, pathTo(r, best.x, best.y));
  return true;
}
// One step of a rescue (an action, or a free pick-up / put-down). true when it did something.
export function rescueStep(b, u) {
  if (!active(u) || u.ap < 1 || u.kind !== "human" || u.carrying != null || (u.side !== "player" && u.side !== "enemy")) return false;
  const foes = threats(b, u);
  // Dragging: on to a cell with more cover, or down where they are once it is safe there (or nowhere is better).
  if (u.dragging != null) {
    if (u.captor) return captorStep(b, u);
    const t = dragging(b, u);
    if (!t) { dropAlly(b, u, null, true); return false; }
    // With a medic to revive them (planMedic), down as soon as it is quiet enough for the revive; else once safe.
    const m = planMedic(b, u, t);
    const here = exposure(b, t.x, t.y, foes);
    const putDown = () => {
      const plan = m && quiet(exposure(b, t.x, t.y, foes));
      dropAlly(b, u, null, plan && m !== u); t.noDrag = b.turn;
      if (plan) {
        t.plan = { medic: m.id, turn: b.turn };
        if (m !== u) say(b, `${u.name} gets ${t.name} into cover for ${m.name} to see to.`, "info");
      }
      return true;
    };
    if (here.safe || (m && quiet(here))) return putDown();
    const mv = dragCell(b, u, foes);
    if (mv && mv.threat < here.threat - 0.25 && mv.path.length) { u.ap -= mv.cost <= u.mob ? 1 : 2; u.hunker = false; moveAlong(b, u, mv.path); return true; }
    return putDown();
  }
  if (foes.some((f) => adjacent(u, f))) return false; // something is on them: fight first
  const pool = u.side !== "player" || medsLeft(b) >= 1;
  let reach = null; // where the unit can get to this turn (worked out once, only if someone needs going to)
  const mine = (t) => (planOf(b, t) && t.plan.medic === u.id ? 1 : 0); // the one this medic was named to revive: first
  for (const t of downedOf(b, u).sort((a, c) => mine(c) - mine(a) || dist(u.x, u.y, a.x, a.y) - dist(u.x, u.y, c.x, c.y))) {
    const ex = exposure(b, t.x, t.y, foes);
    const canRev = isMedic(u) && pool;
    // Named for another medic to revive (PLAN): the others only stabilize them, from next to them (meds, a kit or by
    // hand; no claim, so the medic still comes), and otherwise leave them where they were put for the medic.
    if (planOf(b, t) && t.plan.medic !== u.id) {
      if (!t.stab && meleeReach(b, u, t)) { stabilize(b, u, t); return true; }
      continue;
    }
    if (meleeReach(b, u, t)) {
      // Bleeding out this turn: stop it first. Quiet enough: a medic revives. Exposed: out of the line of fire (with a
      // medic to revive them: to a quiet cell, then the plan; else to a safe one). Else stabilize.
      if (!t.stab && (t.bleed || 0) <= 1) { claim(b, u, t); stabilize(b, u, t); return true; }
      const quietMe = quiet(exposure(b, u.x, u.y, foes));
      if (canRev && u.ap >= MEDIC.REVIVE.AP && quiet(ex) && quietMe) { claim(b, u, t); revive(b, u, t); return true; }
      // A medic by a quiet one but in the open themselves: round to a quiet cell beside them (the revive next turn).
      if (canRev && quiet(ex) && !quietMe) {
        const r = reach || (reach = reachable(b, u, u.mob * u.ap));
        const spots = [];
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          const x = t.x + dx, y = t.y + dy;
          if ((dx || dy) && (x !== u.x || y !== u.y) && x >= 0 && y >= 0 && x < b.w && y < b.h && quiet(exposure(b, x, y, foes))) spots.push([x, y]);
        }
        if (spots.length && goOver(b, u, spots, foes, r, () => claim(b, u, t))) return true;
      }
      const drag = planMedic(b, u, t) ? !quiet(ex) : !ex.safe;
      if (drag && t.noDrag !== b.turn && !liftRefusal(b, u, t)) { claim(b, u, t); lift(b, u, t); return true; }
      // The medic named to revive them, short of the actions for it, with time left (still bleeding next turn): waits
      // for the revive rather than spend meds on stabilizing first.
      if (mine(t) && canRev && !t.stab && (t.bleed || 0) > 2 && quiet(ex)) { claim(b, u, t); continue; }
      if (!t.stab) { claim(b, u, t); stabilize(b, u, t); return true; }
      continue;
    }
    // Not next to them: worth going over if they bleed, could be revived, or lie exposed.
    if (t.stab && !canRev && ex.safe) continue;
    if (dist(u.x, u.y, t.x, t.y) > u.mob * u.ap + 1.5) continue; // out of reach this turn
    const r = reach || (reach = reachable(b, u, u.mob * u.ap));
    const around = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (dx || dy) around.push([t.x + dx, t.y + dy]);
    if (goOver(b, u, around, foes, r, () => claim(b, u, t))) return true;
  }
  // One of theirs down in a vehicle (pullTargets: where no one can treat them): pulled out (MEDIC.PULL.AP) onto a cell
  // quiet enough for a revive (RISK.REVIVE), or gone over to from where it is not under heavy fire; not one laid in
  // your vehicle on purpose and stabilized (that counts as carried out).
  for (const t of stuckOf(b, u)) {
    const v = vehicleOf(b, t);
    if (byRect(v, u.x, u.y)) {
      const cell = pullRefusal(b, u, t) ? null : pullCell(b, u, t, foes);
      if (cell && exposure(b, cell[0], cell[1], foes).threat < MEDIC.RISK.REVIVE) { claim(b, u, t); pullOut(b, u, t); return true; }
      continue;
    }
    if (dist(u.x, u.y, v.x + v.w / 2, v.y + v.h / 2) > u.mob * u.ap + (v.w + v.h) / 2 + 1) continue; // out of reach this turn
    const r = reach || (reach = reachable(b, u, u.mob * u.ap));
    const ring = [];
    for (let y = v.y - 1; y <= v.y + v.h; y++) for (let x = v.x - 1; x <= v.x + v.w; x++) if (byRect(v, x, y)) ring.push([x, y]);
    if (goOver(b, u, ring, foes, r, () => claim(b, u, t))) return true;
  }
  // A medic heals the badly hurt (themselves or next to them), keeping the side's reserve of meds (medsReserve; an
  // enemy medic: of their kit's uses) and a kit use back for a revive.
  if (isMedic(u) && spareMeds(b, u) >= 1 && u.kitLeft - (u.kitUses || 0) >= 2) {
    const hurtOnes = b.units.filter((o) => o.side === u.side && active(o) && (o === u || meleeReach(b, u, o)) && o.hp < o.maxHp * 0.5).sort((a, c) => a.hp / a.maxHp - c.hp / c.maxHp);
    if (hurtOnes.length) { medicHeal(b, u, hurtOnes[0]); return true; }
  }
  return false;
}

// Someone of theirs standing within FINISH.GUARD tiles of a downed one (same floor): close enough to come back for them.
export const guarded = (b, t) => b.units.some((o) => o.side === t.side && o !== t && active(o) && (o.f || 0) === (t.f || 0) && dist(o.x, o.y, t.x, t.y) <= MEDIC.FINISH.GUARD);
// Raiders and zealots: finish one of your downed in reach when nothing more urgent is going on and none of your people
// stands near them (guarded); now and then drag one off as a prisoner instead. true when it acted.
export function finishTurn(b, u) {
  if (u.side !== "enemy" || u.kind !== "human" || !MEDIC.FINISH.KITS.includes(u.kit) || u.dragging != null || u.ap < 1) return false;
  // Your downed of every state but tied (already theirs): bleeding, stabilized, knocked out, surrendered; left alone.
  const prey = b.units.filter((t) => t.side === "player" && t.down && !t.dead && !t.left && !t.off && !t.taken && !t.tied && (t.f || 0) === (u.f || 0) && !guarded(b, t));
  if (!prey.length) return false;
  const foes = threats(b, u);
  if (foes.some((f) => adjacent(u, f))) return false;
  if (canFire(b, u) && foes.some((f) => canSeeAt(b, u, f.x, f.y) && shotOdds(b, u, f).chance >= MEDIC.FINISH.URGENT)) return false;
  const adj = prey.find((t) => meleeReach(b, u, t)); // combat.js: not across a wall's corner
  const inSight = adj || (canFire(b, u) && prey.some((t) => canSeeAt(b, u, t.x, t.y) && coverAgainst(b, t.x, t.y, u.x, u.y).level < 2));
  if (!inSight || !b.rng.chance(MEDIC.FINISH.WILL)) return false; // not every time: they may have other things on their mind
  if (adj) {
    const fid = b.setup && b.setup.enemy ? b.setup.enemy.factionId : null;
    if (fid != null && b.rng.chance(takeShare(u.kit))) {
      // Out cold or hands up: tied where they lie (the enemy takes them if it holds the field, nonlethal.js).
      if (adj.ko || adj.surr) { adj.tied = true; u.ap -= 1; say(b, `${u.name} ties up ${adj.name} to take them away.`, "danger"); return true; }
      if (!b.raid && adj.draggedBy == null) {
        lift(b, u, adj, true);
        say(b, `${u.name} drags ${adj.name} away as a prisoner!`, "death");
        captorStep(b, u);
        return true;
      }
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
  const p = finishOdds(u, t, b);
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

// Help → Medics and the downed (ui/help.js), from the numbers above.
const R = MEDIC.REVIVE, F = MEDIC.FINISH;
export const MEDICS_HELP = `<b>Medics.</b> Anyone who takes a med kit into a fight is a medic: a bandage kit (+2 Medicine), a field trauma kit
  (+3) or a surgical kit (+4), in the off hand, a pocket or the pack, with uses left. A small red cross marks them on the map and
  in the roster. Their Medicine says how good they are.<br>
  <b>Heal</b> (Shift+H): 1 action, 1 meds and a use of the kit: ${MEDIC.HEAL.BASE} + ${MEDIC.HEAL.MED} a point of Medicine + ${MEDIC.HEAL.KIT}
  a point of the kit's bonus, on themselves or a teammate next to them (plain meds heal less).<br>
  <b>Revive</b> (Shift+V): both actions, 1 meds and a use of the kit, next to a teammate who is down: ${R.BASE}% + ${R.MED} a point of
  Medicine + ${R.KIT} a point of the kit's bonus (+${R.STAB} if already stabilized), at most ${R.MAX}%. They get up with
  ${Math.round(R.HP[0] * 100)}–${Math.round(R.HP[1] * 100)}% health, act from their next turn and are shaken (−${R.SHAKEN} aim) for the rest of
  the battle. A failed try still stabilizes them. Only with a kit and meds: the button is shown greyed with the reason otherwise.<br>
  <b>Stabilize</b> (Use meds, M): anyone can. With meds it is sure; with none, by hand (pressure, a belt for a tourniquet):
  ${MEDIC.HANDS.BASE}% + ${MEDIC.HANDS.MED} a point of Medicine, at most ${MEDIC.HANDS.MAX}%, and a failed try can be repeated. Healing
  health always needs meds.<br>
  <b>Drag</b> (Shift+D) a downed teammate: anyone can take hold of one next to them (bleeding, stabilized or knocked out), for
  free, and drag them: half the move distance (both actions can go on moving), no shooting. Shift+D again puts them down; next to the vehicle they can be laid
  in it (counts as carried out; one still bleeding is stabilized on the way in, 1 action: sure with meds, by hand
  without, and the button warns ⚠ when that may fail). <b>Pull out</b> (Shift+U): ${MEDIC.PULL.AP} actions from next to a vehicle: someone down inside it (a
  rider, the gunner who dropped in, the gunner on the enemy's Humvee) is laid on a free cell next to you, to be treated,
  dragged, tied or finished as anyone on the ground. Drag them out of the line of fire: raiders and zealots finish the
  downed they can see when none of yours stands within ${F.GUARD} tiles of them, one chance in ${Math.round(1 / F.WILL)} a turn (as often as their group takes people alive, a quarter of the time for raiders, never for zealots, they take one next to
  them instead: one bleeding is dragged off, a prisoner of their group if they get away; down or badly hurt, the dragger
  lets go; one knocked out or who gave up is tied up and taken if they hold the field), and the dead go for the downed in
  their way. Other groups' people leave your downed be (they take people alive their own way: Non-lethal weapons).<br>
  <b>One model of the downed</b>, both sides: bleeding (down), stabilized, knocked out, surrendered, and tied up on top of
  any of them. Bleeding becomes stabilized (meds, a kit, bare hands) and stabilized gets up again (Revive); knocked out
  comes to unless tied; surrendered walks off unless tied. Finish is for the bleeding and the stabilized; killing one who
  is out cold, gave up or is tied is Execute.<br>
  <b>The enemy's downed.</b> People you fight go down at 0 health too (a blow of twice their health kills outright) and bleed
  out in ${MEDIC.BLEED} turns. Their friends drag them into cover, stabilize them, and their medic (about one group in five of
  soldiers, guards, militia and fighters) revives them. <b>Finish</b> (Shift+K): 1 action, a blow from next to them (sure,
  silent) or one round (${F.BASE}% out to ${F.FROM} tiles, −${F.PER} a tile past it, the noise of a shot): dead for good. A plain
  click never does it. Tie them up (T) instead: after a won fight the stabilized, the tied, the knocked out and the
  tied who surrendered come home as prisoners (one rule); the bleeding die and the untied who gave up walk off. Their
  medic's kit is on the body to loot.<br>
  <b>Who draws fire.</b> A medic seen treating or dragging someone is shot first (×${MEDIC.TREATING}).<br>
  <b>The AI</b> (AI plays my side, the raid bot, the enemy): one rescuer for each of the downed, only when the way there is
  not open ground under fire (unless it is close); it drags them to the cell with the most cover and the fewest eyes on it,
  revives or stabilizes there while the others cover. With a medic about, a downed one in the open is dragged to a cell
  quiet enough for a revive and that medic is named to see to them: they come over and revive them there, usually the
  next turn, and the others leave them to it; a medic heals the badly hurt, and nobody spends meds on the
  standing below a reserve kept for a revive (with a medic on the side: 1 for every ${MEDIC.RESERVE.PER} people, at least ${MEDIC.RESERVE.MIN}; an
  enemy medic counts their kit's uses).<br>
  <b>By the numbers</b> (auto-resolve, teams on the road): a medic with a kit still standing after a won fight saves some
  of the fallen (${Math.round(MEDIC.NUMBERS.SAVE * 100)}% + ${MEDIC.NUMBERS.PER_MED * 100}% a point of Medicine, at most ${Math.round(MEDIC.NUMBERS.MAX * 100)}%), and the carried pull through more often.`;
