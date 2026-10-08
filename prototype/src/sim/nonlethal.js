// Non-lethal weapons and taking people alive, on both sides of a battle (combat.js calls in here through small hooks).
//
//   Knocked out: a living person brought to 0 by a non-lethal hit (Subdue and pulled blows, a stun baton, a taser on
//     someone already under 40%, beanbag or rubber rounds: data-ammo.js AMMO_TYPES[type].nonlethal) is knocked out, not
//     killed or left bleeding. An enemy wakes as before (stealth.js knockOut, 4–6 turns); one of your people wakes 2–4
//     turns later (NL.WAKE) at 15% health with one action, unless tied up or carried. The dead have no pain or
//     consciousness to target: a taser or pepper spray does nothing to them, and a non-lethal blow is a plain blow.
//   Taser (data-nonlethal.js, carried beside the gun): 1 action and the turn, 4 tiles, quiet. A hit stuns (the next 2
//     actions lost), then −20 aim the turn after; under 40% health it knocks out. 2 cartridges, a cartridge pack
//     reloads (1 action). Stun baton (a quick melee weapon): blows never kill the living and stun (−1 action).
//     Pepper spray: a cone 3 tiles out (about 90° wide), everyone living in it blinded 2 turns (−40 aim, no
//     overwatch); 3 sprays a can. Pull blows (u.pull, any weapon): melee and gun-butt blows at 60% damage, −10 to hit,
//     never lethal (the stance of stealth.js Subdue's non-lethal blow; the enemy AI uses it too).
//   The AI (nlAI): every group's fighters may take people alive by kit (NL_STYLE) and how the fight is going: police and
//     guards (arrest), the military remnant and communes when winning; raiders now and then, and more for strong or
//     skilled-looking people (slaves); zealots never; a losing or desperate side goes lethal. They tie up whoever is
//     knocked out or has surrendered next to them, spray, tase, and close in on the weak to club them down. Your own
//     AI does the same when the battle's "Take them alive" is on (b.takeAlive).
//   Surrender: at the start of the enemy turn an enemy may give up when its side has lost half its people and is
//     outnumbered, and it is hurt, out of shots, flanked or alone near your people (SURRENDER); zealots and the
//     fearless never, raiders less, soldiers rarely, leaders hold out longer. It drops its weapon on its cell (loot),
//     raises its hands and stops (down, not a target). Tie it up (the Tie act) and it is a prisoner after a win; left
//     untied it walks off after 3 turns alone, or picks its weapon up again if its side recovers. Several giving up
//     at once break the rest (combat.js shouldFlee). Execute (adjacent, 1 action) kills a surrendered or knocked-out
//     enemy, at a mood cost to your people (prisoners.js PRISON.EXECUTE) and goodwill with their group.
//     Your people may surrender too (the Surrender act): police, soldiers and communes take them captive; raiders may
//     finish them (SURRENDER.finish); zealots take no prisoners. The AI never surrenders for you.
//   After the battle: the enemy holding the field takes your knocked-out and surrendered people captive through
//     conflicts.js takeCaptive ({ kind: "captive", factionId, ... }, the medics branch's shape), or finishes some;
//     with no group behind them they come to after the enemy has gone. Tied surrendered enemies go home as
//     prisoners (stealth.js battleCaptives, prisoners.js); untied ones walk away, their dropped weapons stay to loot.
//   By the numbers: a group that takes people alive takes a share of a beaten group's losses as prisoners in AI raids
//     (raidPrisoners: fewer dead), held and later recruited, ransomed back or escaping (aiCaptivesDaily); a decisive
//     win of yours by the numbers takes a couple of the beaten side prisoner (numbersSurrenders).
import { GEAR } from "./data.js";
import { AMMO_TYPES } from "./data-ammo.js";
import {
  WEAPONS, COVER_DEF, active, activeAny, adjacent, say, fx, damage, meleeOdds, coverAgainst, canSee, alertPod,
  reachable, pathTo, moveAlong, fightOutlook, hasShots, isRanged, evacAt, canSeeAt,
} from "./combat.js";
import { knockOut, findCarried } from "./stealth.js";
import { survivorById, baseById, factionById } from "./world.js";
import { EQUIP_SLOTS, packOf, lootItem, ensureInv, stow } from "./inventory.js";
import { kitSource } from "./itemcond.js";
import { hash01 } from "./skills.js";
import { takeCaptive } from "./conflicts.js";
import { PRISON } from "./prisoners.js";
import { addMood } from "./relations.js";
import { changeGoodwill } from "./factions.js";

export const NL = {
  TASER: { range: 4, shots: 2, stun: 2, daze: 20, ko: 0.4, aim: 10, fall: 8 },
  BATON: { stun: 1 },
  PEPPER: { range: 3, cone: 50, blind: 40, turns: 2 },
  PULL: { dmg: 0.6, aim: -10 },
  WAKE: [2, 4], WAKE_HP: 0.15,
  WEAK: 0.4, // the AI closes in to club down a foe under this share of health
};
// The off-hand taser and spray an enemy brings, by kit: chance each. A group with a real arsenal (f.arsenal, the
// arsenal branch) hands out only what it owns.
export const NL_KIT = {
  guards: { taser: 0.4, pepper: 0.45 }, soldiers: { taser: 0.12, pepper: 0.2 }, militia: { pepper: 0.25 },
  survivors: { pepper: 0.08 }, fighters: { pepper: 0.08 }, raiders: { taser: 0.04 },
};
// How much a group wants people alive (0–1), by kit. prize: raiders and expansionists after a strong or skilled-looking
// target (slaves, recruits). Scaled by how the fight goes (aliveMult): winning ×1, even ×0.5, losing 0.
export const NL_STYLE = {
  guards: { alive: 0.85, why: "arrest" }, soldiers: { alive: 0.6, why: "detain" }, militia: { alive: 0.7, why: "subdue" },
  raiders: { alive: 0.2, prize: 0.6, why: "take slaves" }, fighters: { alive: 0.3, prize: 0.45, why: "take recruits" },
  survivors: { alive: 0.3, why: "rob" }, zealots: { alive: 0, why: "purify" },
};
// A group type's kit (conflicts.js KIND_OF).
export const TYPE_KIT = { raider: "raiders", expansionist: "fighters", zealot: "zealots", military: "soldiers", fortress: "soldiers", traders: "guards", commune: "militia" };
// AI raids between groups: the share of a beaten group's losses the winners take alive, by the winners' type.
export const NL_TAKE = { traders: 0.45, commune: 0.4, military: 0.35, fortress: 0.35, raider: 0.25, expansionist: 0.2, zealot: 0 };
// Prisoners held between groups, a day each: joined their captors, ransomed back, slipped away.
export const AI_HELD = { recruit: 0.03, ransom: 0.03, escape: 0.01, ransomFood: 4 };
export const SURRENDER = {
  lost: 0.5, base: 0.05, hurt: 0.25, empty: 0.15, flanked: 0.15, alone: 0.15, max: 0.8, leader: 0.4, walk: 3, recover: 1.5,
  kit: { guards: 1, militia: 1, survivors: 1, fighters: 0.8, raiders: 0.6, soldiers: 0.3, zealots: 0 },
  // Your people knocked out or surrendered where the enemy holds the field: the chance they finish them instead of
  // taking them (by kit; a tied one is always taken).
  finish: { raiders: 0.3, fighters: 0.15, survivors: 0.2, zealots: 1, soldiers: 0.05, guards: 0, militia: 0.05 },
  // By the numbers: prisoners from a decisive win, per enemy, by kit (× SURRENDER.kit), at most NUMBERS_MAX.
  numbers: 0.15, NUMBERS_MAX: 2,
};

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const roll = (b, ...parts) => hash01(b.nlSeed || "nl", ...parts); // the battle's own dice: no draw from the world's
const nlOf = (u) => u.nl || (u.nl = {});
const sameFloor = (a, t) => (a.f || 0) === (t.f || 0);
const otherSide = (u) => (u.side === "enemy" ? "player" : "enemy");
const living = (t) => t.kind === "human" && !t.ztype;
const kitOf = (b, u) => (u && u.side === "enemy" && u.kit) || (b.setup && b.setup.enemy && b.setup.enemy.kind) || "raiders";
const enemyKit = (b) => {
  const k = b.setup && b.setup.enemy && b.setup.enemy.kind;
  if (k && k !== "mixed" && k !== "zombies") return k;
  const h = b.units.find((u) => u.side === "enemy" && u.kind === "human" && u.kit);
  return h ? h.kit : k || "raiders";
};

// ---------- the hit (combat.js damage) ----------
// Is this hit non-lethal? A beanbag or rubber round (AMMO_TYPES[type].nonlethal; the ammo agent's types), a stun baton's
// blow, or a hit flagged hit.nonLethal. Only the living count: the dead take a plain hit.
export function nlHit(t, by, hit) {
  if (!hit || !t || !living(t)) return false;
  if (hit.nonLethal) return true;
  const type = hit.ammo || hit.ammoType || (hit.how === "shot" && by ? by.ammoType : null);
  if (type && AMMO_TYPES[type] && AMMO_TYPES[type].nonlethal) return true;
  return !!(by && hit.how === "melee" && WEAPONS[by.weapon] && WEAPONS[by.weapon].nonlethal);
}
// A living person at 0 from a non-lethal hit: knocked out (yours: koSurvivor; anyone else: stealth.js knockOut).
// Returns true when it handled it (the dead: false, they die as usual).
export function nlDown(b, t, by) {
  if (!living(t)) return false;
  if (t.side === "player") koSurvivor(b, t, by);
  else knockOut(b, t, by);
  return true;
}
// After a hit the living take: a stun baton's stun.
export function nlAfterHit(b, t, by, hit) {
  if (!by || !hit || hit.how !== "melee" || !living(t) || !(t.hp > 0)) return;
  const w = WEAPONS[by.weapon];
  if (w && w.stun) { stun(t, w.stun, false); say(b, `${t.name} is stunned by the shock (−${w.stun} action).`, t.side === "player" ? "danger" : "good"); }
}
function stun(t, ap, daze) {
  const n = nlOf(t);
  n.stun = Math.max(n.stun || 0, ap);
  if (daze) n.dazeAfter = true;
  t.ow = false;
}
// One of your people knocked out: down, not bleeding; wakes in 2–4 turns unless tied up or carried.
export function koSurvivor(b, t, by) {
  t.hp = 0;
  t.down = true;
  t.ko = true;
  t.bleed = null;
  t.ow = t.hunker = false;
  t.wake = b.turn + b.rng.int(NL.WAKE[0], NL.WAKE[1]);
  (b.downedIds || (b.downedIds = [])).push(t.sid); // service record (relations.js)
  fx(b, { type: "melee", from: [t.x, t.y], to: [t.x, t.y], hit: true, crit: false, dmg: 0, side: by ? by.side : "enemy", text: "KO" });
  say(b, `${t.name} is knocked out${by ? ` by ${by.name}` : ""}. Wakes in about ${t.wake - b.turn} turns unless they tie ${t.name.split(" ")[0]} up first.`, "danger");
}

// ---------- aim, overwatch ----------
// Aim lost to a taser's daze or pepper spray (shotOdds, meleeOdds, the taser's own odds).
export function nlAimPen(u) {
  const n = u && u.nl;
  if (!n) return 0;
  return (n.dazeOn ? NL.TASER.daze : 0) + (n.blind > 0 || n.blindOn ? NL.PEPPER.blind : 0);
}
// No overwatch while blinded or stunned.
export const nlNoOw = (u) => !!(u && u.nl && (u.nl.blind > 0 || u.nl.blindOn || u.nl.stun > 0));
export const blinded = (u) => !!(u && u.nl && (u.nl.blind > 0 || u.nl.blindOn));
export const stunnedNow = (u) => !!(u && u.nl && u.nl.stun > 0);
export const dazed = (u) => !!(u && u.nl && (u.nl.dazeOn || u.nl.dazeNext));

// ---------- battle setup (createBattle / createRaid) ----------
const storeOf = (state, b) => {
  if (b.setup.partyId != null) { const p = state.parties.find((x) => x.id === b.setup.partyId); return p && p.cargo ? p.cargo.gear : null; }
  if (b.setup.baseId != null) { const base = baseById(state, b.setup.baseId); return base ? base.armory : null; }
  return null;
};
function countOn(s, key) {
  if (!s || !s.gear) return 0;
  let n = 0;
  for (const slot of EQUIP_SLOTS) if (s.gear[slot] && s.gear[slot].key === key) n++;
  for (const it of s.pockets || []) if (it && it.key === key) n++;
  for (const it of packOf(s) || []) if (it && it.key === key) n++;
  return n;
}
// What a group owns, if it keeps a real arsenal (f.arsenal: a list of items or keys, or { key: count }); null without one.
export function arsenalCount(f, key) {
  const a = f && f.arsenal;
  if (!a) return null;
  if (Array.isArray(a)) return a.filter((x) => (typeof x === "string" ? x : x && x.key) === key).length;
  if (typeof a === "object") { const v = a[key]; return typeof v === "number" ? v : Array.isArray(v) ? v.length : v ? 1 : 0; }
  return null;
}
// Your people's tasers and spray (from what they carry), the enemy's off-hand kit, the battle's own dice.
export function nlSetup(state, b) {
  b.nlSeed = `${state.seed}:${b.tileId}:${state.hour}:${b.units.length}`;
  b.nlHumans0 = b.units.filter((u) => u.side === "enemy" && u.kind === "human").length;
  const fid = b.setup && b.setup.enemy ? b.setup.enemy.factionId : null;
  const f = fid != null ? factionById(state, fid) : null;
  const owned = { taser: arsenalCount(f, "taser"), pepper: arsenalCount(f, "pepper") };
  for (const u of b.units) {
    if (u.side === "player") { nlEnsure(state, b, u); continue; }
    if (u.side !== "enemy" || u.kind !== "human") continue;
    const K = NL_KIT[u.kit] || {};
    for (const key of ["taser", "pepper"]) {
      const p = K[key] || 0;
      if (owned[key] != null) { if (owned[key] <= 0 || roll(b, "kit", key, u.id) >= Math.max(p * 2, 0.25)) continue; owned[key]--; }
      else if (!p || roll(b, "kit", key, u.id) >= p) continue;
      if (key === "taser") { u.nlTaser = NL.TASER.shots; u.nlCarts = 99; } // their reserve is endless, like their guns'
      else u.nlPepper = 2 + Math.floor(roll(b, "spray", u.id) * 2);
    }
  }
}
// A unit of yours: its taser's cartridges, spare cartridge packs (carried and the team's store), pepper spray (once:
// also for a taser picked up mid-raid, when it is next looked at).
export function nlEnsure(state, b, u) {
  if (!u || u.side !== "player") return;
  const s = u.sid != null ? survivorById(state, u.sid) : null;
  if (!s) return;
  if (u.nlTaser == null) {
    const tz = findCarried(s, "taser");
    if (tz) {
      u.nlTaser = tz.item.shots ?? NL.TASER.shots;
      const store = storeOf(state, b) || [];
      u.nlCarts = countOn(s, "tasercart") + store.filter((it) => it && it.key === "tasercart").length;
      u.nlCartsUsed = 0;
    }
  }
  if (u.nlPepper == null) {
    const p = findCarried(s, "pepper");
    if (p) u.nlPepper = p.item.dur ?? GEAR.pepper.dur;
  }
}
// The battle is over: the taser's cartridges, the packs used and the spray left go back onto the items.
function writeBack(state, b) {
  for (const u of b.units) {
    if (u.side !== "player" || u.sid == null) continue;
    const s = survivorById(state, u.sid);
    if (!s || !s.alive) continue;
    if (u.nlTaser != null) { const tz = findCarried(s, "taser"); if (tz) tz.item.shots = u.nlTaser; }
    for (let i = 0; i < (u.nlCartsUsed || 0); i++) {
      const c = findCarried(s, "tasercart");
      if (c) { c.take(); continue; }
      const store = storeOf(state, b);
      const k = store ? store.findIndex((it) => it && it.key === "tasercart") : -1;
      if (k >= 0) store.splice(k, 1);
    }
    u.nlCartsUsed = 0;
    if (u.nlPepper != null) {
      const p = findCarried(s, "pepper");
      if (p) { if (u.nlPepper <= 0) p.take(); else p.item.dur = u.nlPepper; }
    }
  }
}

// ---------- the turn ----------
// The start of a side's turn (sides: ["player"], or ["enemy", "third"]): the stunned of those sides lose their actions,
// a daze and blindness go on; the other side's turn has just ended, so its daze is over and spent blindness lifts.
// Your knocked-out people come to here (enemies: stealth.js stealthTurn).
export function nlTurnStart(b, sides) {
  for (const u of b.units) {
    if (sides.includes(u.side) && u.side === "player" && u.ko && !u.dead && !u.left && !u.tied && !u.carried && u.wake != null && b.turn >= u.wake) wakeUp(b, u);
    const n = u.nl;
    if (!n) continue;
    if (sides.includes(u.side)) {
      if (n.dazeNext) { n.dazeOn = true; n.dazeNext = false; }
      if (n.stun > 0) {
        if (activeAny(u)) {
          const lost = Math.min(u.ap, n.stun);
          u.ap -= lost;
          u.ow = false;
          if (lost) say(b, `${u.name} is still twitching from the shock (−${lost} action${lost === 1 ? "" : "s"}).`, u.side === "player" ? "danger" : "good");
        }
        n.stun = 0;
        if (n.dazeAfter) { n.dazeNext = true; n.dazeAfter = false; }
      }
      if (n.blind > 0) { n.blindOn = true; n.blind--; u.ow = false; }
    } else {
      n.dazeOn = false;
      if (!(n.blind > 0)) n.blindOn = false;
    }
  }
}
function wakeUp(b, u) {
  u.down = false;
  u.ko = false;
  u.hp = Math.max(u.hp, Math.round(u.maxHp * NL.WAKE_HP));
  u.ap = 1; // groggy: one action
  say(b, `${u.name} comes to, groggy (${Math.round(u.hp)} hp).`, "good");
}

// ---------- surrender ----------
const leaderOf = (u) => !!(u.leader || u.boss || u.chief || u.captain);
// Enemies who give up at the start of the enemy turn. Returns how many did.
export function surrenderCheck(b) {
  if (b.over || (b.raid && !b.units.some((u) => u.side === "enemy" && u.kind === "human" && u.aware))) return 0;
  const people = b.units.filter((u) => u.side === "enemy" && u.kind === "human" && !u.reinforcement);
  const start = Math.max(b.nlHumans0 || 0, people.length);
  const standing = people.filter((u) => active(u));
  const mine = b.units.filter((u) => u.side === "player" && active(u));
  if (!start || !standing.length || !mine.length) return 0;
  if ((start - standing.length) / start < SURRENDER.lost || standing.length >= mine.length) return 0;
  let n = 0;
  for (const u of standing) {
    if (u.fearless || !u.aware) continue;
    const km = SURRENDER.kit[u.kit] ?? 0.8;
    if (!km) continue;
    const hurtNow = u.hp < u.maxHp * 0.5;
    const empty = isRanged(u) && !hasShots(b, u);
    const flanked = mine.some((p) => sameFloor(p, u) && canSee(b, p, u) && coverAgainst(b, u.x, u.y, p.x, p.y).level === 0);
    const alone = !standing.some((o) => o !== u && dist(o.x, o.y, u.x, u.y) <= 4) && mine.some((p) => dist(p.x, p.y, u.x, u.y) <= 3);
    if (!hurtNow && !empty && !flanked && !alone) continue;
    let p = SURRENDER.base + (hurtNow ? SURRENDER.hurt : 0) + (empty ? SURRENDER.empty : 0) + (flanked ? SURRENDER.flanked : 0) + (alone ? SURRENDER.alone : 0);
    p = Math.min(SURRENDER.max, p * km * (leaderOf(u) ? SURRENDER.leader : 1));
    if (roll(b, "surrender", u.id, b.turn) >= p) continue;
    surrender(b, u);
    n++;
  }
  // Several at once, or most of those left: the rest break and run (combat.js shouldFlee).
  const left = standing.filter((u) => active(u)).length;
  if (n && (n >= 2 || n >= left) && left && !b.nlBreak) { b.nlBreak = b.turn; say(b, "The rest of them waver and fall back.", "good"); }
  return n;
}
// One enemy gives up: the weapon on the ground, hands up, out of the fight.
export function surrender(b, u) {
  u.surr = true;
  u.down = true;
  u.ko = false;
  u.ap = 0;
  u.ow = u.hunker = false;
  u.aware = true;
  delete u.investigate;
  u.surrTurn = b.turn;
  u.surrAlone = 0;
  const w = u.weapon;
  let what = "";
  if (w && w !== "fists" && GEAR[w]) {
    const drop = { x: u.x, y: u.y, f: u.f || 0, key: w, kit: u.kit || null, uid: u.id, name: u.name };
    (b.nlDrops || (b.nlDrops = [])).push(drop);
    if (b.raid) {
      const item = lootItem(w, kitSource(u.kit), roll(b, "drop", u.id));
      drop.box = b.nextId++;
      b.raid.containers.push({ id: drop.box, x: u.x, y: u.y, f: u.f || 0, kind: "body", area: null, searched: false, label: `${u.name}'s dropped ${WEAPONS[w].name.toLowerCase()}`, uid: null, dropOf: u.id, contents: { sup: {}, gear: [item] } });
    }
    u.nlWeapon = w;
    u.weapon = "fists";
    u.weaponName = "Fists";
    what = ` and drops the ${WEAPONS[w].name.toLowerCase()}`;
  }
  fx(b, { type: "melee", from: [u.x, u.y], to: [u.x, u.y], hit: true, crit: false, dmg: 0, side: "player", text: "HANDS UP" });
  say(b, `${u.name} gives up${what}, hands raised. Tie them up (T) to take them prisoner.`, "good");
}
// Combat.js shouldFlee: the rest break once several gave up.
export const nlBreak = (b) => !!b.nlBreak;
// The start of the enemy turn for the ones who gave up: untied and left alone for 3 turns they walk off; if their side
// has recovered (it outnumbers yours 1.5 to 1 again) and the weapon still lies there, they take it up again.
function surrenderedTurn(b) {
  const standing = b.units.filter((u) => u.side === "enemy" && u.kind === "human" && active(u)).length;
  const mine = b.units.filter((u) => u.side === "player" && active(u));
  for (const u of b.units) {
    if (u.side !== "enemy" || !u.surr || u.dead || u.fled || u.tied) continue;
    const watched = mine.some((p) => sameFloor(p, u) && dist(p.x, p.y, u.x, u.y) <= 2);
    u.surrAlone = watched ? 0 : (u.surrAlone || 0) + 1;
    const drop = (b.nlDrops || []).find((d) => d.uid === u.id && !d.gone);
    const there = drop && drop.x === u.x && drop.y === u.y && !(b.raid && b.raid.containers.some((c) => c.id === drop.box && (c.searched || (c.contents && !c.contents.gear.length))));
    if (there && standing >= 2 && standing >= mine.length * SURRENDER.recover) {
      u.surr = false; u.down = false; u.weapon = drop.key; u.weaponName = WEAPONS[drop.key].name; u.ap = 0;
      drop.gone = true;
      if (b.raid) b.raid.containers = b.raid.containers.filter((c) => c.id !== drop.box);
      say(b, `${u.name} sees their side rally and grabs the ${WEAPONS[drop.key].name.toLowerCase()} again!`, "danger");
      continue;
    }
    if (u.surrAlone >= SURRENDER.walk) {
      u.fled = true;
      u.down = false;
      say(b, `${u.name}, left untied, slips away.`, "info");
    }
  }
}
// The start of the enemy turn (combat.js endPlayerTurn, after their actions are set).
export function nlEnemyPhase(b) {
  nlTurnStart(b, ["enemy", "third"]);
  surrenderedTurn(b);
  surrenderCheck(b);
}

// ---------- the taser, the spray, pulled blows ----------
export function taserOdds(b, a, t) {
  if (!t || t.dead || t.left || t.fled) return { ok: false, chance: 0, label: "No target." };
  const d = dist(a.x, a.y, t.x, t.y);
  if (d > NL.TASER.range + 0.01) return { ok: false, chance: 0, label: `Out of taser range (${NL.TASER.range} tiles)` };
  if (!canSee(b, a, t)) return { ok: false, chance: 0, label: "No line of sight" };
  const flat = t.surprised || (!t.aware && t.side === "enemy");
  const cov = flat || t.kind === "zombie" ? 0 : coverAgainst(b, t.x, t.y, a.x, a.y).level;
  const aim = a.aim + NL.TASER.aim - COVER_DEF[cov] - (t.hunker && cov ? 20 : 0) - Math.max(0, d - 2) * NL.TASER.fall - nlAimPen(a) + (flat ? 15 : 0);
  const chance = Math.round(clamp(aim, 5, 95));
  const ko = living(t) && t.hp < t.maxHp * NL.TASER.ko;
  const what = !living(t) ? "does nothing to the dead" : ko ? `knocks them out (under ${Math.round(NL.TASER.ko * 100)}% health)` : `stuns: −${NL.TASER.stun} actions, then −${NL.TASER.daze} aim`;
  return { ok: true, chance, ko, label: `Taser ${chance}% to hit: ${what}` };
}
function fireTaser(b, a, t) {
  const o = taserOdds(b, a, t);
  a.nlTaser -= 1;
  a.face = [Math.sign(t.x - a.x), Math.sign(t.y - a.y)];
  a.hunker = false;
  if (a.xpT) a.xpT.shots++;
  const hit = b.rng.chance(o.chance / 100);
  fx(b, { type: "shot", from: [a.x, a.y], to: [t.x, t.y], hit, crit: false, dmg: 0, side: a.side });
  const good = a.side === "player" ? "good" : "danger";
  if (!hit) { say(b, `${a.name} fires the taser at ${t.name} and misses (${o.chance}%).`, "info"); }
  else if (!living(t)) { say(b, `${a.name}'s taser barbs hang in ${t.name}. The dead feel nothing.`, "info"); }
  else {
    if (a.xpT) a.xpT.hits++;
    if (o.ko) {
      if (t.side === "enemy" && t.kind === "human") say(b, `${a.name} tases ${t.name}, who drops (${o.chance}%).`, good);
      nlDown(b, t, a);
    } else {
      stun(t, NL.TASER.stun, true);
      t.hunker = false;
      fx(b, { type: "melee", from: [t.x, t.y], to: [t.x, t.y], hit: true, crit: false, dmg: 0, side: a.side, text: "STUN" });
      say(b, `${a.name} tases ${t.name} (${o.chance}%): locked up, they lose their next ${NL.TASER.stun} actions.`, good);
    }
  }
  if (t.side === "enemy" && !t.dead && !t.down && !t.aware) alertPod(b, t.pod, `${t.name} cries out!`);
  a.ap = 0;
}
function reloadTaser(b, u) {
  u.nlTaser = NL.TASER.shots;
  u.nlCarts -= 1;
  if (u.side === "player") u.nlCartsUsed = (u.nlCartsUsed || 0) + 1;
  u.ap -= 1;
  say(b, `${u.name} snaps a fresh cartridge pair into the taser.`, "info");
}
// The cells a spray from a toward (x, y) covers: within 3 tiles, within about 50° of the line, in sight.
export function coneCells(b, a, x, y) {
  const out = [];
  if (x === a.x && y === a.y) return out;
  const dir = Math.atan2(y - a.y, x - a.x);
  const R = NL.PEPPER.range, max = (NL.PEPPER.cone * Math.PI) / 180;
  for (let cy = a.y - R; cy <= a.y + R; cy++) for (let cx = a.x - R; cx <= a.x + R; cx++) {
    if (cx < 0 || cy < 0 || cx >= b.w || cy >= b.h || (cx === a.x && cy === a.y)) continue;
    const d = dist(a.x, a.y, cx, cy);
    if (d > R + 0.5) continue;
    let da = Math.abs(Math.atan2(cy - a.y, cx - a.x) - dir);
    if (da > Math.PI) da = 2 * Math.PI - da;
    if (da > max + 1e-6) continue;
    if (!canSeeCell(b, a, cx, cy)) continue;
    out.push([cx, cy]);
  }
  return out;
}
const canSeeCell = (b, a, x, y) => canSeeAt(b, a, x, y);
// Who a spray toward (x, y) would catch: { foes, friends, dead } (units in the cone).
export function coneUnits(b, a, x, y) {
  const cells = new Set(coneCells(b, a, x, y).map(([cx, cy]) => cy * b.w + cx));
  const inCone = b.units.filter((t) => t !== a && !t.dead && !t.left && !t.fled && !t.off && !t.away && !t.aboard && sameFloor(a, t) && cells.has(t.y * b.w + t.x));
  return {
    foes: inCone.filter((t) => t.side !== a.side && living(t)),
    friends: inCone.filter((t) => t.side === a.side && living(t)),
    dead: inCone.filter((t) => !living(t)),
  };
}
function sprayPepper(b, a, x, y) {
  const { foes, friends, dead } = coneUnits(b, a, x, y);
  a.nlPepper -= 1;
  a.ap -= 1;
  a.hunker = false;
  a.face = [Math.sign(x - a.x), Math.sign(y - a.y)];
  fx(b, { type: "melee", from: [a.x, a.y], to: [x, y], hit: true, crit: false, dmg: 0, side: a.side, text: "PEPPER" });
  const caught = [...foes, ...friends];
  for (const t of caught) {
    const n = nlOf(t);
    n.blind = Math.max(n.blind || 0, NL.PEPPER.turns);
    t.ow = false;
    if (t.side === "enemy" && !t.aware && !t.down) alertPod(b, t.pod, `${t.name} screams, eyes burning!`);
  }
  const names = caught.map((t) => t.name);
  say(b, `${a.name} sprays pepper: ${names.length ? `${names.join(", ")} blinded for ${NL.PEPPER.turns} turns` : "nobody caught in it"}${dead.length ? `; the dead in it do not even blink` : ""}.`, names.length ? (a.side === "player" ? "good" : "danger") : "info");
}
// A pulled blow (u.pull; the enemy AI's subdue): stealth.js Subdue's non-lethal blow for either side.
export function nlBlow(b, a, t) {
  const m = meleeOdds(b, a, t);
  const chance = Math.max(10, m.chance + NL.PULL.aim);
  a.face = [Math.sign(t.x - a.x), Math.sign(t.y - a.y)];
  if (a.xpT) a.xpT.melee++;
  const w = WEAPONS[a.weapon];
  if (b.rng.chance(chance / 100)) {
    const raw = b.rng.int(m.dmg[0], m.dmg[1]) * NL.PULL.dmg * (a.meleeMult || 1);
    const eff = Math.round(damage(b, t, raw, a, true, { how: w && w.melee ? "melee" : "bash" }));
    if (!t.ko) say(b, `${a.name} ${living(t) ? "pulls the blow and clubs" : "clubs"} ${t.name} for ${eff}.`, a.side === "player" ? "good" : "danger");
    fx(b, { type: "melee", from: [a.x, a.y], to: [t.x, t.y], hit: true, crit: false, dmg: eff, side: a.side });
  } else {
    say(b, `${a.name} swings to subdue ${t.name} and misses.`, "info");
    fx(b, { type: "melee", from: [a.x, a.y], to: [t.x, t.y], hit: false, side: a.side });
  }
  if (t.side === "enemy" && !t.dead && !t.down && !t.aware) alertPod(b, t.pod, `${t.name} cries out!`);
}
// Combat.js strike: a unit pulling its blows strikes a living person non-lethally. True when it did.
export function nlStrike(b, a, t) {
  if (!a || !a.pull || a.kind !== "human" || !t || !living(t) || !active(t)) return false;
  nlBlow(b, a, t);
  return true;
}

// ---------- player actions (combat.js combatAct) ----------
// taser, reloadTaser, pepper, pull, execute, surrender. Returns an error, or "" when it happened.
export function nlAct(state, b, u, t, act) {
  nlEnsure(state, b, u);
  switch (act.type) {
    case "taser": {
      if (u.nlTaser == null) return "Nobody here carries a taser.";
      if (u.nlTaser <= 0) return u.nlCarts > 0 ? "The taser is spent: reload it (1 action)." : "The taser is spent and there are no spare cartridges.";
      if (!t || t.side === "player" || !activeAny(t)) return "No target.";
      const o = taserOdds(b, u, t);
      if (!o.ok) return o.label;
      fireTaser(b, u, t);
      return "";
    }
    case "reloadTaser": {
      if (u.nlTaser == null) return "Nobody here carries a taser.";
      if (u.nlTaser >= NL.TASER.shots) return "The taser is loaded.";
      if (!(u.nlCarts > 0)) return "No spare taser cartridges.";
      reloadTaser(b, u);
      return "";
    }
    case "pepper": {
      if (!(u.nlPepper > 0)) return u.nlPepper === 0 ? "The pepper spray is empty." : "Nobody here carries pepper spray.";
      const x = Number(act.x), y = Number(act.y);
      if (!(x >= 0 && y >= 0 && x < b.w && y < b.h) || (x === u.x && y === u.y)) return "Spray which way? Click a tile in front.";
      if (dist(u.x, u.y, x, y) > NL.PEPPER.range + 0.5) return `Pepper spray reaches ${NL.PEPPER.range} tiles.`;
      sprayPepper(b, u, x, y);
      return "";
    }
    case "pull": {
      u.pull = act.on != null ? !!act.on : !u.pull;
      say(b, u.pull ? `${u.name} will pull their blows: melee hits knock people out instead of killing (60% damage, −10 to hit).` : `${u.name} strikes to kill again.`, "info");
      return ""; // free
    }
    case "execute": {
      if (!t || t.side !== "enemy" || t.dead || !(t.surr || t.ko)) return "Execute someone who has surrendered or is knocked out.";
      if (!adjacent(u, t)) return "Move next to them first.";
      execute(state, b, u, t);
      u.ap -= 1;
      return "";
    }
    case "surrender": {
      const why = surrenderRefusal(b, u);
      if (why) return why;
      u.surr = true;
      u.down = true;
      u.ap = 0;
      u.ow = u.hunker = false;
      const k = enemyKit(b);
      say(b, `${u.name} drops to their knees, hands up.${(NL_STYLE[k] || {}).alive >= 0.5 ? " They will be taken in if the enemy holds the field." : " Raiders may take them, or may not bother."}`, "danger");
      return "";
    }
    default:
      return "Unknown action.";
  }
}
// Why one of your people cannot surrender ("" when they can).
export function surrenderRefusal(b, u) {
  if (!u || u.side !== "player" || !active(u)) return "They cannot surrender now.";
  const k = enemyKit(b);
  if (!b.units.some((e) => e.side === "enemy" && e.kind === "human" && activeAny(e))) return "There is nobody here to surrender to: the dead do not take prisoners.";
  if (k === "zealots" || (NL_STYLE[k] && NL_STYLE[k].alive === 0)) return "Zealots take no prisoners.";
  return "";
}
function execute(state, b, u, t) {
  t.down = false; t.ko = false; t.surr = false; t.tied = false;
  t.hp = Math.max(1, t.hp);
  damage(b, t, 9999, u);
  say(b, `${u.name} executes ${t.name}.`, "death");
  fx(b, { type: "melee", from: [u.x, u.y], to: [t.x, t.y], hit: true, crit: false, dmg: 0, side: u.side, text: "EXECUTED" });
  b.nlExecuted = (b.nlExecuted || 0) + 1;
  // Everyone of yours who saw it: the prison execution's mood (prisoners.js PRISON.EXECUTE), the soft-hearted worse.
  const E = PRISON.EXECUTE, S = PRISON.SEEN;
  for (const p of b.units) {
    if (p.side !== "player" || p.sid == null || p.dead || p.left) continue;
    const s = survivorById(state, p.sid);
    if (!s || !s.alive) continue;
    const tr = s.traits || [];
    addMood(state, s, S.hardTraits.some((x) => tr.includes(x)) ? E.hardened : S.softTraits.some((x) => tr.includes(x)) ? E.soft : E.mood, `${t.name} was executed in the fight`);
  }
  const fid = t.factionId ?? (b.setup.enemy || {}).factionId;
  const f = fid != null ? factionById(state, fid) : null;
  if (f && f.alive) changeGoodwill(state, f, Math.round(E.goodwill / 2), "you executed one of their people who had given up");
}

// ---------- the AI (combat.js aiUnit; both sides) ----------
// How the fight looks to the enemy (cached a phase): their strength ÷ yours.
function enemyEdge(b) {
  const key = `${b.turn}:${b.phase}`;
  if (!b.nlEdge || b.nlEdge.key !== key) { const o = fightOutlook(b); b.nlEdge = { key, r: o.ratio > 0 ? (isFinite(o.ratio) ? 1 / o.ratio : 0) : 99 }; }
  return b.nlEdge.r;
}
// Winning ×1, even ×0.5, losing (desperate) 0.
export function aliveMult(b) {
  const r = enemyEdge(b);
  return r >= 1.25 ? 1 : r >= 0.8 ? 0.5 : 0;
}
// A strong or skilled-looking one of yours: worth taking (raiders' slaves, recruits).
export const isPrize = (t) => !!t && t.side === "player" && ((t.aim || 0) >= 55 || (t.medicine || 0) >= 6 || (t.meleeAim || 0) >= 80 || (t.hp >= 80 && t.maxHp >= 100));
// Does this enemy want t (or anyone, t null) alive this turn? Its kit, the fight, a prize (the battle's own dice).
export function wantsAlive(b, u, t = null) {
  if (u.side === "player") return !!b.takeAlive;
  if (u.side !== "enemy" || u.kind !== "human") return false;
  const S = NL_STYLE[u.kit] || NL_STYLE.raiders;
  const base = t && S.prize && isPrize(t) ? Math.max(S.alive, S.prize) : S.alive;
  const p = base * aliveMult(b);
  return p > 0 && roll(b, "alive", u.id, b.turn, t ? t.id : "") < p;
}
const foesFor = (b, u) => b.units.filter((o) => o.side === otherSide(u) && active(o) && living(o) && sameFloor(u, o));
// The AI's non-lethal turn. True when the unit's turn is used up; false lets the usual AI go on (with u.pull set).
export function nlAI(b, u) {
  if (u.kind !== "human" || !active(u) || u.ap < 1) return false;
  if (u.side !== "enemy" && !(u.side === "player" && b.takeAlive)) return false;
  const foes = foesFor(b, u);
  const adj = foes.filter((f) => adjacent(u, f));
  const want = wantsAlive(b, u, adj[0] || foes.find(isPrize) || null);
  u.pull = want;
  if (!want) return false;
  // Whoever is knocked out or has given up next to them: tied up.
  const bound = b.units.find((o) => o.side === otherSide(u) && (o.ko || o.surr) && !o.dead && !o.tied && !o.fled && !o.left && adjacent(u, o));
  if (bound) {
    bound.tied = true;
    u.ap -= 1;
    say(b, `${u.name} ties up ${bound.name}.`, u.side === "enemy" ? "danger" : "good");
    if (u.ap < 1) return true;
  }
  // Pepper: two of them in the cone, or one close; none of their own.
  if (u.nlPepper > 0) {
    let best = null;
    for (const f of foes) {
      if (dist(u.x, u.y, f.x, f.y) > NL.PEPPER.range + 0.5) continue;
      const c = coneUnits(b, u, f.x, f.y);
      if (c.friends.length) continue;
      const fresh = c.foes.filter((x) => !blinded(x) && !x.down);
      const close = fresh.some((x) => dist(u.x, u.y, x.x, x.y) <= 2);
      if (fresh.length >= 2 || close) { const v = fresh.length + (close ? 0.5 : 0); if (!best || v > best.v) best = { f, v }; }
    }
    if (best) { sprayPepper(b, u, best.f.x, best.f.y); if (u.ap < 1) return true; }
  }
  // The taser: a reload when nobody is next to them, then the best target (a weak one drops).
  if (u.nlTaser != null) {
    if (u.nlTaser <= 0 && u.nlCarts > 0 && !adj.length && u.ap >= 1) { reloadTaser(b, u); if (u.ap < 1) return true; }
    if (u.nlTaser > 0) {
      let best = null;
      for (const f of foes) {
        if (stunnedNow(f)) continue;
        const o = taserOdds(b, u, f);
        if (!o.ok || o.chance < 35) continue;
        const v = o.chance / 100 * (o.ko ? 2 : 1) * (isPrize(f) ? 1.2 : 1);
        if (!best || v > best.v) best = { f, v };
      }
      if (best) { fireTaser(b, u, best.f); return true; }
    }
  }
  // Someone weak in reach: close in and club them down (the pulled blow), rather than shoot them dead.
  const weak = foes.filter((f) => f.hp <= f.maxHp * NL.WEAK).sort((a, c) => a.hp - c.hp);
  const near = weak.find((f) => adjacent(u, f));
  if (near) { nlBlow(b, u, near); u.ap = 0; return true; }
  if (weak.length && u.ap >= 2) {
    const r = reachable(b, u, u.mob);
    let cell = null;
    for (const f of weak) {
      for (let dy = -1; dy <= 1 && !cell; dy++) for (let dx = -1; dx <= 1 && !cell; dx++) {
        const x = f.x + dx, y = f.y + dy;
        if ((dx || dy) && x >= 0 && y >= 0 && x < b.w && y < b.h && isFinite(r.dist[y * b.w + x]) && r.dist[y * b.w + x] > 0) cell = [x, y, f];
      }
      if (cell) break;
    }
    if (cell) {
      u.ap -= 1;
      moveAlong(b, u, pathTo(r, cell[0], cell[1]));
      if (active(u) && active(cell[2]) && adjacent(u, cell[2])) { nlBlow(b, u, cell[2]); u.ap = 0; return true; }
      return u.ap < 1;
    }
  }
  return false;
}

// ---------- after the fight ----------
// Combat.js endBattle, before it counts your people: the items written back; where the enemy holds the field your
// knocked-out and surrendered people are taken captive (or finished: they die in the count), and the carried-out
// knocked out live. Returns lines for the summary.
export function nlBattleEnd(state, b, outcome) {
  writeBack(state, b);
  const lines = [];
  for (const u of b.units) {
    if (u.side !== "player" || u.dead || u.left || !(u.ko || u.surr)) continue;
    if (outcome === "victory") continue;
    if (outcome === "retreat" && (u.carried || evacAt(b, u.x, u.y))) { u.stab = true; continue; }
    lines.push(...takenByEnemy(state, b, u));
  }
  return lines;
}
// Combat.js endRaid: someone got out, so the knocked out are carried; with nobody out (or one who gave up), taken.
export function nlRaidEnd(state, b, anyOut) {
  writeBack(state, b);
  for (const u of b.units) {
    if (u.side !== "player" || u.dead || u.left || !(u.ko || u.surr)) continue;
    if (anyOut && u.ko && !u.tied) { u.stab = true; continue; }
    takenByEnemy(state, b, u);
  }
}
function takenByEnemy(state, b, u) {
  const s = survivorById(state, u.sid);
  if (!s || !s.alive) return [];
  const e = b.setup.enemy || {};
  const kit = enemyKit(b);
  if (e.kind === "zombies" || !b.units.some((x) => x.side === "enemy" && x.kind === "human" && !x.dead)) { u.ko = false; u.surr = false; return []; } // only the dead: a plain downed fate
  const finish = u.tied ? 0 : SURRENDER.finish[kit] ?? 0.2;
  if (roll(b, "fate", u.id) < finish) { u.dead = true; u.ko = false; u.surr = false; return []; } // combat.js counts the death
  const f = e.factionId != null ? factionById(state, e.factionId) : null;
  if (!f || !f.alive || !f.bases || !f.bases.length) return [`${u.name} came to after ${e.name || "the enemy"} had moved on.`];
  const party = b.setup.partyId != null ? state.parties.find((x) => x.id === b.setup.partyId) : null;
  s.health = Math.max(5, Math.min(s.health, u.hp > 0 ? u.hp : 15));
  takeCaptive(state, s, f, party);
  u.nlTaken = true;
  b.nlTaken = (b.nlTaken || []).concat(s.id);
  return [`${u.name} was ${u.tied ? "tied up and " : ""}taken prisoner by ${f.name}.`];
}
// Combat.js endBattle after a win: the weapons the surrendered dropped, each a pile to loot.
export function nlDropPiles(state, b) {
  const out = [];
  for (const d of b.nlDrops || []) {
    if (d.gone) continue;
    const pile = ensureInv({ name: `${d.name}'s dropped ${WEAPONS[d.key].name.toLowerCase()}`, kind: "human", uid: null, kit: d.kit, supplies: {} });
    stow(pile, lootItem(d.key, kitSource(d.kit), roll(b, "pile", d.uid)), "");
    out.push(pile);
  }
  return out;
}
// Your own surrendered or knocked-out person lives through a won fight; a surrendered one is not hurt by it.
export const nlSpared = (u) => !!(u.ko || u.surr);

// ---------- by the numbers ----------
// AI raids between groups (factions.js): of a beaten group's losses, how many the winners take alive (held by them,
// attacker.held[target id]). Its own dice. Returns the number taken.
export function raidPrisoners(state, attacker, target, loss) {
  if (!attacker || !target || loss <= 0) return 0;
  const share = NL_TAKE[attacker.type] ?? 0.2;
  const n = Math.min(loss, Math.floor(loss * share + hash01(state.seed, "nlraid", attacker.id, target.id, state.hour)));
  if (n <= 0) return 0;
  const held = attacker.held || (attacker.held = {});
  held[target.id] = (held[target.id] || 0) + n;
  state.stats.aiPrisoners = (state.stats.aiPrisoners || 0) + n;
  return n;
}
// A war raid's capture chance (diplomacy.js: 25% base) by the raiders' wish to take people.
export const warCaptureMult = (attacker) => (attacker ? 0.5 + 2 * (NL_TAKE[attacker.type] ?? 0.2) : 1);
// Held prisoners between groups, a day: some join their captors, some are ransomed back (food to the captors), some
// slip away home; a group gone frees its prisoners or loses its people.
export function aiCaptivesDaily(state) {
  for (const f of state.factions) {
    if (!f.held) continue;
    for (const [tid, n0] of Object.entries(f.held)) {
      let n = n0;
      const t = factionById(state, Number(tid));
      for (let i = 0; i < n0; i++) {
        const r = hash01(state.seed, "nlheld", f.id, tid, state.hour, i);
        if (!f.alive) { n--; if (t && t.alive) t.pop += 1; continue; }
        if (r < AI_HELD.recruit) { n--; f.pop += 1; state.stats.aiRecruited = (state.stats.aiRecruited || 0) + 1; }
        else if (r < AI_HELD.recruit + AI_HELD.ransom && t && t.alive && (t.stock.food || 0) >= AI_HELD.ransomFood) { n--; t.pop += 1; t.stock.food -= AI_HELD.ransomFood; f.stock.food = (f.stock.food || 0) + AI_HELD.ransomFood; state.stats.aiRansomed = (state.stats.aiRansomed || 0) + 1; }
        else if (r < AI_HELD.recruit + AI_HELD.ransom + AI_HELD.escape || !t || !t.alive) { n--; if (t && t.alive) t.pop += 1; }
      }
      if (n > 0) f.held[tid] = n; else delete f.held[tid];
    }
    if (!Object.keys(f.held).length) delete f.held;
  }
}
// A decisive win of yours by the numbers (no one of yours dead, at least 3 of them): a couple of the beaten side give
// up and are taken (prisoners.js makes the records). Zealots never. Its own dice. Returns how many.
export function numbersSurrenders(state, setup, result) {
  const e = setup && setup.enemy;
  if (!e || e.kind === "zombies" || !result || result.outcome !== "victory" || (result.survivorsDead || []).length || (e.count || 0) < 3) return 0;
  const kit = e.kind === "mixed" ? "raiders" : e.kind;
  const km = SURRENDER.kit[kit] ?? 0.8;
  if (!km) return 0;
  const n = Math.floor(e.count * SURRENDER.numbers * km + hash01(state.seed, "nlnumbers", e.factionId ?? e.name ?? "", state.hour));
  return Math.min(SURRENDER.NUMBERS_MAX, n);
}

// The status of a unit in words (the battle view): "" for none.
export function nlStatus(b, u) {
  if (u.surr && !u.dead) return u.tied ? "Surrendered, tied up" : u.side === "player" ? "Surrendered" : `Surrendered (hands up${u.surrAlone ? `, left alone ${u.surrAlone} turn${u.surrAlone === 1 ? "" : "s"}` : ""})`;
  if (u.ko && !u.dead) return u.tied ? "Knocked out, tied up" : `Knocked out (wakes in ${Math.max(1, (u.wake ?? b.turn + 1) - b.turn)})`;
  const bits = [];
  if (u.nl) {
    if (u.nl.stun > 0) bits.push(`Stunned (−${u.nl.stun} action${u.nl.stun === 1 ? "" : "s"})`);
    else if (u.nl.dazeOn || u.nl.dazeNext) bits.push(`Dazed (aim −${NL.TASER.daze})`);
    if (blinded(u)) bits.push(`Blinded (aim −${NL.PEPPER.blind}, no overwatch)`);
  }
  if (u.pull && active(u)) bits.push("Pulling blows");
  return bits.join(", ");
}

// Help → Non-lethal weapons and surrender (ui/help.js).
export const NL_HELP = `<b>Knocked out, not killed.</b> A living person brought to 0 by a non-lethal hit is knocked out, on either side:
  Subdue and pulled blows, a stun baton, a taser on someone already under ${Math.round(NL.TASER.ko * 100)}% health, beanbag and rubber rounds.
  An enemy wakes in 4–6 turns, one of yours in ${NL.WAKE[0]}–${NL.WAKE[1]} turns at low health, unless tied up (or carried). Tie up (T) the
  knocked out next to you: after a win they are your prisoners. The enemy ties up yours too: if they hold the field, your
  knocked-out and surrendered people are taken captive (rescue, ransom or goodwill brings them back), though raiders may
  finish some off. The dead feel nothing: a taser or pepper spray does nothing to them, and a pulled blow is a plain blow.
  <br><b>The kit.</b> <b>Taser</b> (carried beside your gun): 1 action and the turn, ${NL.TASER.range} tiles, quiet; a hit costs the
  target its next ${NL.TASER.stun} actions, then −${NL.TASER.daze} aim; 2 cartridges, a cartridge pack reloads it (1 action).
  <b>Stun baton</b>: a quick melee weapon that never kills the living and stuns (−1 action). <b>Pepper spray</b>: a cone ${NL.PEPPER.range}
  tiles out toward the tile you click (the map shows it): everyone living in it, yours too, is blinded for ${NL.PEPPER.turns} turns
  (−${NL.PEPPER.blind} aim, no overwatch); 3 sprays a can. <b>Pull blows</b> (free): melee and gun-butt hits do 60% damage at −10 to
  hit and knock out instead of killing. Found at police stations, prisons and gun stores, and on guards.
  <br><b>Take them alive.</b> The battle's "Take them alive" button makes the AI playing your side go for tasers, spray and pulled
  blows, club down the weak and tie up whoever drops. The other groups do this by their nature: police and guards arrest,
  the military remnant and communes take people when they are winning, raiders now and then (more for a strong or skilled
  one: slaves), zealots never, and any side that is losing fights to kill. Groups that take people alive also take more
  prisoners and kill fewer when they raid each other; those prisoners are recruited, ransomed back or escape.
  <br><b>Surrender.</b> Enemies who have lost half their people and are outnumbered may give up when they are hurt, out of
  shots, flanked or alone near your people (zealots and the fearless never; raiders less, soldiers rarely; leaders hold out
  longer). They drop their weapon (loot it) and raise their hands: no longer a target. Tie (take prisoner) one next to you;
  left untied and alone for 3 turns they walk off, and if their side rallies they take the weapon up again. Several giving
  up at once can break the rest. Execute (next to them, asks first) kills one who gave up or is out cold: your people take it
  hard and their group hears of it. Your own people can Surrender too (asks first): police, soldiers and communes take them
  captive, raiders might not bother keeping them alive, zealots take no prisoners. The AI never surrenders for you. By the
  numbers, a decisive win takes a couple of the beaten side prisoner.`;
