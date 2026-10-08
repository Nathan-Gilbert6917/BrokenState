// A rescue raid on a group's base, played on its map (conflicts.js rescue card: "Sneak in" / "Storm the base" on the
// map; tools/rescuetest.js).
//
// The map: the group's base as a fort (fort.js fortAssault: their buildings in a yard; a wall ring with a gate in each
// side and breaches, or no walls at all for a group that has built none: the ring is opened up). Two of their buildings
// matter:
//   the cell   your captives, by the group's jail tier (JAIL; jailhouse.js groupJailTier when that is in the game, else
//              a chain-link cage for raiders and the like, holding cells for soldiers): its doors are locked (locks.js
//              difficulty by the tier), its windows bars or chain-link. A guard with the keys (the jailer) stands by it.
//   the armory a rack of the group's weapons (their arsenal when the arsenal work is in, else a few of their kit's guns
//              and armour, kept on the group: f.armory) and some of their ammo; its door is locked about two times in
//              three (the jailer's keys open it too).
// The guards are the people at that base (conquest.js assaultForce: the same head count an assault meets, without
// their Humvee). Storming: everyone is awake and aware. Sneaking: nobody has seen you; by day the sentries on the
// walls and towers look further (+2 sight), at night a third of the guards are asleep in the bunkhouses and the rest
// see less (combat.js b.dark). The first guard who notices anyone raises the alarm at his next move: everyone is
// aware and the sleepers come out (ALARM).
//
// Your captives are your units from the start (combat.js u.captive), hurt and stripped, tied up (u.tied: not anyone's
// target and not one of your fighters until free). What anyone can do (combatAct "rescue", act.op; 1 action each):
//   ropes   a captive works at the ropes: ROPES.base + ROPES.stealth a Stealth point + the tier's, 10–85%. A miss a
//           guard can see raises the alarm and earns a beating (5–10).
//   cut     cut a tied captive next to you free (a teammate or a captive already free).
//   search  a captive searches the cell for a nail or a bobby pin: 30% (once each).
//   pick    pick a locked door next to you (the cell's, the armory's): locks.js PICK (55% + 4% a Stealth point − 15%
//           a difficulty step above 1, + Quiet Hands) with the lockpicks; −15% with a pin, −35% with nothing at all.
//   force   force it (locks.js FORCE with a crowbar or a pry weapon, else SMASH: both actions, difficulty 1–2 only):
//           loud, the alarm goes up.
//   key     take the jailer's keys off him, once he is down, knocked out or dead (next to him).
//   unlock  with the keys: any locked door here, sure, silent.
//   grab    a weapon off a downed or dead guard next to you (and some of his rounds); again, his armour. A captive
//           puts it on at once (combat.js refitUnit); a teammate's goes in the team's cargo.
//   armory  at the armory's rack (its door open): the best weapon and a piece of armour for a captive who has none,
//           or up to two things for a teammate's cargo, and up to 20 rounds. What is taken is gone from the group.
// Captives also fight bare-handed (Melee: fists) once their ropes are off.
// The guards (guardTurn, each guard's move): the alarm; a downed captive next to them is taken back; once the alarm is
// up and anyone of yours is near the armory (or it is open), the two nearest guards go to retake it: there they re-arm
// from the rack, lock it again (if the keys are still theirs) and one stays posted at its door. Guards shoot to wound
// captives (×SPARE.dmg) and take them back rather than kill them, unless they are raiders losing badly (under 40% of
// them left standing). Every round (rescueRound): a downed captive with a guard next to him and none of your
// teammates is taken back; a captive alone, under 40% health, with 3 guards within two cells gives up (50%). Taken
// back: stripped (it all goes back to the rack) and tied up in the cell again (locked again while the keys are theirs).
// The way out: the evac strip round the edge of the map (Retreat, Evac, Sound the retreat). Captives out with the team
// come home with it, hurt, with what they picked up; the battle won, everyone left alive is free. Captives still
// there when the team has gone stay where they were (a pin or the keys they kept make a later escape likelier:
// conflicts.js captivesDaily).
// "AI plays my side" (rescueBot): captives work the ropes when no guard can see them (or the alarm is up anyway),
// search for a pin and pick the lock, go for the jailer's keys when he is alone, grab weapons, never stay cornered
// alone (they make for a teammate), then make for the way out; the team goes for the cell, opens it (keys, picks,
// force), cuts the ropes, then everyone evacuates.
import { CELL, WEAPONS, KITS, active, isTied, cornerBlocked, meleeReach, unitAt, moveAlong, say, fx, playerUnit, refitUnit, reachable, pathTo, distField, canSee, adjacent, unitById, evacAt, combatAct, registerBattleLayout, registerBattleSize, registerCombatHandler, startCombat, enemyUnit, isRanged, loadMag } from "./combat.js";
import { survivorById, skill, factionById, log, isNight, hub, addCard } from "./world.js";
import { FACTION_TYPES, GEAR } from "./data.js";
import { captivesOf, freeCaptive, settleRescue, isCaptive } from "./conflicts.js";
import { assaultForce } from "./conquest.js";
import { fortAssault, fortSize, assaultBase } from "./fort.js";
import { lootItem, stripAll, ARMOR_SLOTS, itemLoad } from "./inventory.js";
import { kitSource, spend } from "./itemcond.js";
import { PICK, FORCE, SMASH, picksOf, barOf } from "./locks.js";
import { changeGoodwill, collapseFaction, groupBroken } from "./factions.js";
import { partyMembers, partyTile, tileLabel, awaitOrders, wipeIfEmpty, addGearToCargo } from "./parties.js";
import { itemValue } from "./valuation.js";
import { hasPerk, gainXp } from "./skills.js";
import { Rng } from "./rng.js";
import { removeFromArsenal } from "./arsenal.js";
import * as Groupworks from "./groupworks.js"; // groupJailTier (the jailhouse work), when it is there

export const RESCUE_RAID = {
  ROPES: { base: 0.1, stealth: 0.03, min: 0.05, max: 0.75, beat: [5, 10] },
  PIN: 0.3, PIN_PICK: -0.2, BARE_PICK: -0.45,
  GRAB_AMMO: [4, 10], ARMORY_AMMO: 20, ARMORY_LOCKED: 0.65, ARMORY_SEED: { min: 2, max: 6, armour: 1 },
  SPARE: { dmg: 0.6, losing: 0.4 }, SURRENDER: { hp: 0.4, guards: 3, range: 2, alone: 3, chance: 0.5 },
  RETAKE: { near: 4, guards: 2 }, ASLEEP: 0.35, SENTRY_SIGHT: 2, GOODWILL: { assault: -30, sneak: -20, quiet: -10 },
};
// Jail tiers (jailhouse.js groupworks when merged): the cell doors' lock difficulty, the ropes and the windows.
export const JAIL = {
  makeshift: { name: "chain-link cage", diff: 1, ropes: 0.1, window: "fence" },
  holding:   { name: "holding cell",    diff: 2, ropes: 0,   window: "bars" },
  jailhouse: { name: "jailhouse block", diff: 3, ropes: -0.05, window: "bars" },
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const first = (n) => String(n).split(" ")[0];
const cheb = (a, x, y) => Math.max(Math.abs(a.x - x), Math.abs(a.y - y));
const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export function jailTier(f, tile) {
  const fn = Groupworks && typeof Groupworks.groupJailTier === "function" ? Groupworks.groupJailTier : null;
  const t = fn ? fn(f, tile) : null;
  if (t && JAIL[t]) return t;
  return f && (f.type === "military" || f.type === "fortress") ? "holding" : "makeshift";
}

// ---------- the group's armory ----------
// Their weapons and armour: the arsenal's items when the group has one (the arsenal work), else f.armory, a few of their
// kit's guns and armour made once (hashed from the world's seed: the world's dice are not touched).
const KIND_OF = { raider: "raiders", expansionist: "fighters", zealot: "zealots", military: "soldiers", fortress: "soldiers", traders: "guards", commune: "militia" };
export const kindOf = (f) => KIND_OF[f && f.type] || "raiders";
const armouryItem = (it) => !!(it && GEAR[it.key] && (GEAR[it.key].slot === "weapon" ? !!WEAPONS[it.key] && it.key !== "fists" : ARMOR_SLOTS.includes(GEAR[it.key].slot)));
export function groupArmory(state, f) {
  if (f.arsenal && Array.isArray(f.arsenal.items)) return f.arsenal.items;
  if (!f.armory) {
    const kit = KITS[kindOf(f)] || KITS.raiders;
    const rng = new Rng(((state.seed || 1) * 7919 + f.id * 104729) >>> 0);
    const S = RESCUE_RAID.ARMORY_SEED;
    const n = clamp(Math.round(S.min + f.pop / 6), S.min, S.max);
    f.armory = [];
    for (let i = 0; i < n; i++) { const k = rng.pick(i === 0 && kit.strong ? kit.strong : kit.weapons); if (GEAR[k]) f.armory.push(lootItem(k, kitSource(kindOf(f)), spend(rng))); }
    const arm = (kit.armor || []).filter(Boolean);
    for (let i = 0; i < S.armour && arm.length; i++) { const k = rng.pick(arm); if (GEAR[k]) f.armory.push(lootItem(k, kitSource(kindOf(f)), spend(rng))); }
  }
  return f.armory;
}
function takeFromGroup(f, it) {
  if (f.arsenal && removeFromArsenal(f, it, "stolen")) return; // arsenal.js: off their books (counted)
  const list = f.arsenal && Array.isArray(f.arsenal.items) ? f.arsenal.items : f.armory || [];
  const i = list.indexOf(it);
  if (i >= 0) list.splice(i, 1);
  if (f.arsenal && Array.isArray(f.arsenal.items)) f.arsenal.rev = (f.arsenal.rev || 0) + 1;
}
function giveToGroup(f, it) {
  if (!f || !it) return;
  const list = f.arsenal && Array.isArray(f.arsenal.items) ? f.arsenal.items : f.armory || (f.armory = []);
  if (!list.includes(it)) list.push(it);
  if (f.arsenal && Array.isArray(f.arsenal.items)) f.arsenal.rev = (f.arsenal.rev || 0) + 1;
}
const weaponScore = (it) => (it && WEAPONS[it.key] ? (WEAPONS[it.key].dmg ? (WEAPONS[it.key].dmg[0] + WEAPONS[it.key].dmg[1]) / 2 : 5) * (WEAPONS[it.key].melee ? 0.6 : 1) + itemValue(it) * 0.05 : 0);

// ---------- starting one ----------
export const tacticalPossible = (state) => !(state.autoCombat || typeof window === "undefined");
// mode: "sneak" | "assault". Returns "" (the battle is open, or was fought by the numbers headless).
export function startRescueRaid(state, p, f, mode = "assault") {
  const tile = partyTile(p);
  const held = captivesOf(state, f.id).filter((s) => s.location.tile === tile);
  const list = held.length ? held : captivesOf(state, f.id);
  const force = assaultForce(state, f, tile, null);
  const night = isNight(state);
  p.phase = "engaged";
  startCombat(state, {
    tile, partyId: p.id,
    enemy: { kind: force.kind, count: force.count, power: force.power, factionId: f.id, name: `${f.name} guards`, walls: force.walls, fortified: mode === "sneak" ? 1 : force.fortified },
    ambush: mode === "sneak" ? "player" : null, canRetreat: true, handler: "rescueRaid", layout: "rescueRaid",
    context: { partyId: p.id, factionId: f.id, tile, mode, captiveIds: list.map((s) => s.id), people: force.people, night, tier: jailTier(f, tile) },
  });
  return "";
}

// ---------- the map ----------
registerBattleSize("rescueRaid", (state, setup) => fortSize(assaultBase(state, setup), {}));
registerBattleLayout("rescueRaid", (b, ctx) => {
  const c = b.setup.context || {};
  fortAssault(b, ctx, c); // fort.js: their base, both phases
  if (ctx.phase === "map") return rescueMap(b, ctx, c);
  rescueUnits(b, ctx, c);
});
// The road ambush at a handover (ransom.js): the captives tied up behind their people, no cell.
registerBattleLayout("rescueRoad", (b, ctx) => {
  if (ctx.phase !== "units") return;
  const c = b.setup.context || {};
  b.rescue = newRecord(c, "road");
  const foes = b.units.filter((u) => u.side === "enemy");
  const cx = foes.length ? Math.round(foes.reduce((a, u) => a + u.x, 0) / foes.length) : ctx.W - 4;
  const cy = foes.length ? Math.round(foes.reduce((a, u) => a + u.y, 0) / foes.length) : Math.floor(ctx.H / 2);
  const spots = [];
  for (let y = 0; y < ctx.H; y++) for (let x = 0; x < ctx.W; x++) if (ctx.standable(x, y)) spots.push([x, y, Math.hypot(x - (cx + 2), y - cy)]);
  spots.sort((a, d) => a[2] - d[2]);
  addCaptives(ctx.state, b, c.captiveIds || [], spots.map(([x, y]) => [x, y]));
  say(b, "They have your people with them, tied up behind their line. Cut them free (Rescue: Cut free) and get everyone out.", "danger");
});

function newRecord(c, kind) {
  return { kind, mode: c.mode || "assault", factionId: c.factionId ?? null, tier: c.tier || "makeshift", alarm: c.mode !== "sneak", doors: [], cell: null, armory: null, keyUnit: null, jailer: null, asleep: 0, took: [], returned: [], pins: {}, searched: {}, retakers: [], escapes: 0, recaptured: 0 };
}

function rescueMap(b, ctx, c) {
  const F = b.deployPlan && b.deployPlan.fort;
  const R = (b.rescue = newRecord(c, "base"));
  if (!F) return;
  const W = b.w, at = (x, y) => b.cells[y * W + x];
  // No walls built: the ring and its walkway are open ground (their base stands in the open).
  if (!((b.setup.enemy || {}).walls >= 1)) {
    for (const [x, y] of F.ring) { const q = at(x, y); q.k = "open"; q.f = "dirt"; delete q.t; delete q.hp; delete q.mhp; delete q.bar; delete q.h; }
    for (const [x, y] of F.walkway) { const q = at(x, y); if (q.k === "walkway" || q.k === "ladder") { q.k = "open"; delete q.h; } }
    for (const side of Object.keys(F.gates)) for (const [x, y] of F.gates[side]) { const q = at(x, y); q.k = "open"; delete q.bar; delete q.hp; delete q.mhp; }
  }
  const tier = JAIL[R.tier] || JAIL.makeshift;
  const blds = F.buildings.filter((s) => s.doors && s.doors.length && !s.roof).map((s) => ({ s, cells: interior(b, s) })).filter((o) => o.cells.length >= 2);
  if (!blds.length) return;
  // The cell: the smallest building (a storehouse or a cellar first); the armory: another one, a workshop or a store.
  const pref = (o, keys) => (keys.includes(o.s.key) ? -100 : 0) + o.cells.length;
  const cell = [...blds].sort((a, d) => pref(a, ["cellar", "storehouse", "radio"]) - pref(d, ["cellar", "storehouse", "radio"]))[0];
  const rest = blds.filter((o) => o !== cell);
  const arm = rest.length ? [...rest].sort((a, d) => pref(a, ["ammo_bench", "garage", "storehouse"]) - pref(d, ["ammo_bench", "garage", "storehouse"]))[0] : null;
  // The cell's doors locked, its windows barred (or chain-link).
  for (const [x, y] of cell.s.doors) { lockDoor(b, x, y); R.doors.push({ x, y, area: "cell", diff: tier.diff, open: false, tries: 0 }); }
  for (let y = cell.s.y0; y < cell.s.y0 + cell.s.h; y++) for (let x = cell.s.x0; x < cell.s.x0 + cell.s.w; x++) { const q = at(x, y); if (q && q.k === "window") { q.k = tier.window; delete q.hp; delete q.mhp; } }
  R.cell = { name: tier.name, building: cell.s.name, cells: cell.cells, doors: cell.s.doors.map((d) => [...d]) };
  if (arm) {
    // The rack: the indoor cell furthest from the doors (out of the way).
    const far = [...arm.cells].sort((p, q) => Math.min(...arm.s.doors.map(([dx, dy]) => Math.hypot(q[0] - dx, q[1] - dy))) - Math.min(...arm.s.doors.map(([dx, dy]) => Math.hypot(p[0] - dx, p[1] - dy))))[0];
    at(far[0], far[1]).k = "locker";
    const locked = ctx.rng.chance(RESCUE_RAID.ARMORY_LOCKED);
    for (const [x, y] of arm.s.doors) {
      if (locked) { lockDoor(b, x, y); R.doors.push({ x, y, area: "armory", diff: 2, open: false, tries: 0 }); }
      else { const q = at(x, y); q.k = "odoor"; delete q.hp; delete q.mhp; delete q.bar; }
    }
    const f = factionById(ctx.state, c.factionId);
    const items = f ? groupArmory(ctx.state, f).filter(armouryItem) : [];
    R.armory = { x: far[0], y: far[1], building: arm.s.name, locked, items: [...items], ammo: f ? Math.min(Math.floor((f.stock && f.stock.ammo) || 0), 60) : 20 };
  }
}
// The walkable indoor cells of a building.
function interior(b, s) {
  const out = [];
  for (let y = s.y0; y < s.y0 + s.h; y++) for (let x = s.x0; x < s.x0 + s.w; x++) {
    const q = b.cells[y * b.w + x];
    if (q && CELL[q.k] && CELL[q.k].walk && q.k !== "bdoor" && q.k !== "idoor" && q.k !== "odoor" && !(q.h > 0) && q.k !== "stairs" && q.k !== "ladder") out.push([x, y]);
  }
  return out;
}
function lockDoor(b, x, y) {
  const q = b.cells[y * b.w + x];
  q.k = "door"; q.f = "floor"; delete q.hp; delete q.mhp; delete q.bar;
  if (b.losCache) b.losCache.fill(0);
}
function openDoorCell(b, d) {
  const q = b.cells[d.y * b.w + d.x];
  q.k = "odoor"; q.f = "floor";
  d.open = true;
  if (b.losCache) b.losCache.fill(0);
}

function rescueUnits(b, ctx, c) {
  const R = b.rescue;
  const state = ctx.state;
  if (!R) return;
  const foes = b.units.filter((u) => u.side === "enemy");
  // The jailer: the guard nearest the cell, posted at its door with the keys.
  if (R.cell && R.cell.doors.length && foes.length) {
    const [dx, dy] = R.cell.doors[0];
    const outside = N8.map(([ox, oy]) => [dx + ox, dy + oy]).filter(([x, y]) => ctx.standable(x, y) && !R.cell.cells.some(([cx, cy]) => cx === x && cy === y));
    const j = [...foes].sort((a, d) => Math.hypot(a.x - dx, a.y - dy) - Math.hypot(d.x - dx, d.y - dy))[0];
    if (outside.length) { j.x = outside[0][0]; j.y = outside[0][1]; }
    j.post = "door"; j.cellKey = true; j.name = `${j.name} (the keys)`;
    R.jailer = j.id;
  }
  // Sneaking in: nobody knows you are here. By day the sentries look further; at night a third of them sleep indoors.
  if (R.mode === "sneak") {
    for (const u of foes) { u.aware = false; if (u.post === "tower" || u.post === "wall") u.sight += RESCUE_RAID.SENTRY_SIGHT; }
    if (c.night) {
      const sleepers = foes.filter((u) => !u.cellKey && u.post !== "tower" && u.post !== "door").slice(0, Math.floor(foes.length * RESCUE_RAID.ASLEEP));
      R.asleep = sleepers.length;
      b.units = b.units.filter((u) => !sleepers.includes(u));
    }
  } else for (const u of foes) u.aware = true;
  addCaptives(state, b, c.captiveIds || [], R.cell ? R.cell.cells : []);
  const n = b.units.filter((u) => u.captive).length;
  say(b, `${n} of your people ${n === 1 ? "is" : "are"} held in the ${R.cell ? `${R.cell.name} (${R.cell.building.toLowerCase()})` : "yard"}, tied up. ${R.jailer != null ? "A guard by the door has the keys. " : ""}${R.armory ? `Their weapons are in the ${R.armory.building.toLowerCase()}${R.armory.locked ? " (locked)" : ""}. ` : ""}Free them (Rescue actions), then get everyone out by the edge of the map.${R.mode === "sneak" ? ` Nobody has seen you yet${c.night ? `: it is night and ${R.asleep} of them are asleep` : ""}. Once one of them raises the alarm, they all come.` : ""}`, "info");
}

// Your people held here, on the map: tied up, stripped, hurt.
function addCaptives(state, b, ids, cells) {
  const free = cells.filter(([x, y]) => !unitAt(b, x, y));
  for (const id of ids) {
    const s = survivorById(state, id);
    if (!s || !isCaptive(s)) continue;
    const u = playerUnit(b, s);
    u.captive = true; u.tied = true;
    u.fit = { aim: u.aim, dmgMult: u.dmgMult, armor: u.armor, medicine: u.medicine }; // refitUnit: weapons picked up count at once
    const spot = free.shift() || fallbackSpot(b, u);
    if (!spot) continue;
    u.x = spot[0]; u.y = spot[1];
    u.ap = b.phase === "deploy" ? 0 : 2;
    b.units.push(u);
  }
}
function fallbackSpot(b, u) {
  for (let y = 0; y < b.h; y++) for (let x = b.w - 1; x >= 0; x--) { const q = b.cells[y * b.w + x]; if (CELL[q.k].walk && !unitAt(b, x, y)) return [x, y]; }
  return null;
}

// ---------- what can be done (combatAct "rescue") ----------
const Rof = (b) => b.rescue;
export const rescueRefusal = (b, u) => `${first(u.name)} is tied up: work the ropes (Rescue), or have someone cut ${u.name.split(" ")[0]} free.`;
const doorNear = (b, u, pred = () => true) => (Rof(b) ? Rof(b).doors.filter((d) => !d.open && cheb(u, d.x, d.y) <= 1 && pred(d)) : []);
const bodyNear = (b, u) => b.units.filter((t) => t.side === "enemy" && t.kind === "human" && (t.dead || t.down || t.ko) && cheb(u, t.x, t.y) <= 1 && !t.off && !cornerBlocked(b, u.x, u.y, t.x, t.y));
// Anyone of yours tied up next to you: a captive, or a teammate the guards tied (knocked out or given up: nonlethal).
const boundNear = (b, u) => b.units.filter((t) => t.side === "player" && isTied(t) && !t.dead && !t.left && t !== u && cheb(u, t.x, t.y) <= 1 && !doorBetween(b, u, t));
// No reaching diagonally past a wall's corner (combat.js cornerBlocked, as for a blow).
const doorBetween = (b, a, t) => cornerBlocked(b, a.x, a.y, t.x, t.y);
const inCell = (b, u) => !!(Rof(b) && Rof(b).cell && Rof(b).cell.cells.some(([x, y]) => x === u.x && y === u.y));
const armoryOpen = (b) => { const R = Rof(b); return !!(R && R.armory && !R.doors.some((d) => d.area === "armory" && !d.open)); };
const hasKeys = (b, u) => Rof(b) && Rof(b).keyUnit === u.id;
const jailerOf = (b) => (Rof(b) && Rof(b).jailer != null ? unitById(b, Rof(b).jailer) : null);
export function ropeOdds(state, b, u) {
  const s = survivorById(state, u.sid);
  const T = JAIL[Rof(b).tier] || JAIL.makeshift;
  return clamp(RESCUE_RAID.ROPES.base + RESCUE_RAID.ROPES.stealth * (s ? skill(s, "stealth") : 0) + T.ropes, RESCUE_RAID.ROPES.min, RESCUE_RAID.ROPES.max);
}
export function pickOdds(state, b, u, d) {
  const s = survivorById(state, u.sid);
  const tool = s && picksOf(s) ? "picks" : u.pin ? "pin" : "none";
  const c = PICK.base + PICK.perStealth * (s ? skill(s, "stealth") : 0) - PICK.perDiff * (d.diff - 1) + (u.quiet || (s && hasPerk(s, "quiethands")) ? PICK.quiet : 0) + (tool === "pin" ? RESCUE_RAID.PIN_PICK : tool === "none" ? RESCUE_RAID.BARE_PICK : 0);
  return { chance: clamp(c, 0.05, 0.95), tool };
}
export function forceOdds(state, b, u, d) {
  const s = survivorById(state, u.sid);
  if (s && barOf(s)) return { chance: clamp(FORCE.base + FORCE.perMech * skill(s, "mechanics") - FORCE.perDiff * (d.diff - 1), 0.05, 0.95), ap: 1, bar: true };
  if (d.diff > SMASH.maxDiff) return { chance: 0, ap: 1, why: "Too solid to smash without a crowbar." };
  return { chance: clamp(SMASH.base - SMASH.perDiff * (d.diff - 1), 0.05, 0.95), ap: SMASH.ap, bar: false };
}

// The buttons for one unit (ui/combat.js): [{ op, label, tip, ok }].
export function rescueOptions(state, b, u) {
  const R = Rof(b);
  if (!R || !u || u.side !== "player" || u.dead || u.left) return [];
  const out = [];
  const ap = u.ap || 0;
  if (isTied(u)) {
    if (u.down) return out; // knocked out or given up as well: someone has to cut them loose
    out.push({ op: "ropes", label: "Work the ropes", tip: `1 action: ${Math.round(ropeOdds(state, b, u) * 100)}% to get free of the ropes. A miss a guard can see raises the alarm and earns a beating.`, ok: ap > 0 });
    return out;
  }
  if (!active(u)) return out;
  const bn = boundNear(b, u);
  out.push({ op: "cut", label: "Cut free", tip: bn.length ? `1 action: cut ${first(bn[0].name)} loose.` : "Stand next to someone tied up.", ok: ap > 0 && bn.length > 0 });
  const doors = doorNear(b, u);
  if (u.captive && inCell(b, u) && !R.searched[u.id]) out.push({ op: "search", label: "Search the cell", tip: `1 action: look for a nail or a bobby pin to pick the lock with (${Math.round(RESCUE_RAID.PIN * 100)}%, once).`, ok: ap > 0 });
  if (doors.length) {
    const d = doors[0];
    if (hasKeys(b, u)) out.push({ op: "unlock", label: "Unlock (keys)", tip: "1 action, silent: the jailer's keys open it.", ok: ap > 0 });
    const po = pickOdds(state, b, u, d);
    out.push({ op: "pick", label: "Pick the lock", tip: `1 action: ${Math.round(po.chance * 100)}% (${po.tool === "picks" ? "lockpicks" : po.tool === "pin" ? "with a pin: −15%" : "bare hands: −35%"}). Quiet.`, ok: ap > 0 });
    const fo = forceOdds(state, b, u, d);
    out.push({ op: "force", label: fo.bar ? "Force the door" : "Smash the door", tip: fo.why || `${fo.ap} action${fo.ap > 1 ? "s" : ""}: ${Math.round(fo.chance * 100)}%. Loud: the alarm goes up.`, ok: !fo.why && ap >= fo.ap });
  }
  const bodies = bodyNear(b, u);
  const j = jailerOf(b);
  if (j && R.keyUnit == null && j.cellKey && bodies.includes(j)) out.push({ op: "key", label: "Take the keys", tip: `1 action: the keys off ${j.name.replace(" (the keys)", "")}. They open the cell and the armory.`, ok: ap > 0 });
  const loot = bodies.filter((t) => (t.weapon && t.weapon !== "fists" && GEAR[t.weapon]) || t.armorKey);
  if (loot.length) out.push({ op: "grab", label: "Take his weapon", tip: `1 action: ${loot[0].weapon && loot[0].weapon !== "fists" ? `the ${WEAPONS[loot[0].weapon] ? WEAPONS[loot[0].weapon].name : loot[0].weapon} and some rounds` : "his armour"} off ${loot[0].name.replace(" (the keys)", "")}.${u.captive ? " Put on at once." : " Into the team's cargo."}`, ok: ap > 0 });
  if (R.armory && cheb(u, R.armory.x, R.armory.y) <= 1) out.push({ op: "armory", label: "Take from the armory", tip: armoryOpen(b) ? `1 action: ${u.captive ? "the best weapon and a piece of armour" : "up to two things for the cargo"} and up to ${RESCUE_RAID.ARMORY_AMMO} rounds (${R.armory.items.length} things on the rack, ${R.armory.ammo} rounds).` : "The armory is locked.", ok: ap > 0 && armoryOpen(b) && (R.armory.items.length > 0 || R.armory.ammo > 0) });
  return out;
}

export function rescueAct(state, b, u, act) {
  const R = Rof(b);
  if (!R) return "There is nobody to rescue here.";
  const op = act.op;
  const s = survivorById(state, u.sid);
  const rng = b.rng;
  if (u.tied && op !== "ropes") return rescueRefusal(b, u);
  switch (op) {
    case "ropes": {
      if (!isTied(u)) return "Not tied up.";
      if (u.down) return "Knocked out: someone has to cut them loose.";
      const ch = ropeOdds(state, b, u);
      u.ap -= 1;
      if (rng.chance(ch)) {
        u.tied = false;
        R.escapes++;
        if (s) gainXp(state, s, "stealth", 2);
        say(b, `${u.name} works free of the ropes (${Math.round(ch * 100)}%).`, "good");
        fx(b, { type: "loot", to: [u.x, u.y], text: "free" });
        return "";
      }
      const seen = b.units.filter((g) => g.side === "enemy" && active(g) && canSee(b, g, u));
      if (seen.length) {
        const [lo, hi] = RESCUE_RAID.ROPES.beat;
        u.hp = Math.max(1, u.hp - rng.int(lo, hi));
        raiseAlarm(state, b, `${seen[0].name} sees ${first(u.name)} straining at the ropes and shouts. The alarm is up!`);
        say(b, `${seen[0].name} gives ${first(u.name)} a beating for it.`, "danger");
      } else say(b, `${u.name} strains at the ropes, but they hold (${Math.round(ch * 100)}%).`, "info");
      return "";
    }
    case "cut": {
      const t = act.target != null ? boundNear(b, u).find((x) => x.id === Number(act.target)) : boundNear(b, u)[0];
      if (!t) return "Stand next to someone tied up.";
      t.tied = false; // a knocked out one still has to come to (stealth.js / nonlethal wake), one who gave up stays down
      if (!t.down) t.ap = Math.max(t.ap || 0, b.phase === "player" ? 1 : 0);
      u.ap -= 1;
      say(b, `${u.name} cuts ${t.name} free.`, "good");
      fx(b, { type: "loot", to: [t.x, t.y], text: "cut free" });
      return "";
    }
    case "search": {
      if (!u.captive || !inCell(b, u)) return "Only in the cell.";
      if (R.searched[u.id]) return "Nothing more to find here.";
      R.searched[u.id] = true;
      u.ap -= 1;
      if (rng.chance(RESCUE_RAID.PIN)) { u.pin = true; say(b, `${u.name} finds a bent nail in a crack in the floor: something to pick the lock with.`, "good"); }
      else say(b, `${u.name} goes over the cell inch by inch and finds nothing useful.`, "info");
      return "";
    }
    case "pick": case "force": case "unlock": {
      const d = doorNear(b, u)[0];
      if (!d) return "Stand next to a locked door.";
      if (op === "unlock") {
        if (!hasKeys(b, u)) return "You do not have the keys.";
        u.ap -= 1;
        openDoorCell(b, d);
        if (d.area === "cell") for (const o of R.doors) if (o.area === d.area && !o.open) openDoorCell(b, o);
        say(b, `${u.name} unlocks the ${d.area === "cell" ? R.cell.name : "armory"} with the jailer's keys.`, "good");
        return "";
      }
      if (op === "pick") {
        const po = pickOdds(state, b, u, d);
        u.ap -= 1;
        d.tries++;
        if (s) gainXp(state, s, "stealth", 2);
        if (rng.chance(po.chance)) { openDoorCell(b, d); say(b, `${u.name} picks the lock of the ${d.area === "cell" ? R.cell.name : "armory"} (${Math.round(po.chance * 100)}%).`, "good"); }
        else say(b, `${u.name} works the lock${po.tool === "none" ? " with bare fingers" : po.tool === "pin" ? " with the nail" : ""}, but it holds (${Math.round(po.chance * 100)}%).`, "info");
        return "";
      }
      const fo = forceOdds(state, b, u, d);
      if (fo.why) return fo.why;
      if (u.ap < fo.ap) return "Smashing it takes both actions.";
      u.ap -= fo.ap;
      b.noise = (b.noise || 0) + 2;
      const ok = rng.chance(fo.chance);
      if (ok) { openDoorCell(b, d); d.broken = true; } // broken: it cannot be locked again
      say(b, ok ? `${u.name} ${fo.bar ? "forces" : "smashes"} the door open with a crash (${Math.round(fo.chance * 100)}%).` : `${u.name} heaves at the door, but it holds (${Math.round(fo.chance * 100)}%).`, ok ? "good" : "danger");
      raiseAlarm(state, b, "The crash carries across the yard. The alarm is up!");
      return "";
    }
    case "key": {
      const j = jailerOf(b);
      if (!j || !j.cellKey || R.keyUnit != null || !bodyNear(b, u).includes(j)) return "Stand next to the jailer once he is down.";
      R.keyUnit = u.id;
      j.cellKey = false;
      u.ap -= 1;
      say(b, `${u.name} takes the keys off ${j.name.replace(" (the keys)", "")}.`, "good");
      return "";
    }
    case "grab": {
      const t = (act.target != null ? bodyNear(b, u).filter((x) => x.id === Number(act.target)) : bodyNear(b, u)).find((x) => (x.weapon && x.weapon !== "fists" && GEAR[x.weapon]) || x.armorKey);
      if (!t) return "Nothing to take off anyone next to you.";
      u.ap -= 1;
      if (t.weapon && t.weapon !== "fists" && GEAR[t.weapon]) {
        const it = t.arsItem || lootItem(t.weapon, kitSource(t.kit || "raiders"), spend(rng));
        t.weapon = "fists"; t.weaponName = "Fists"; t.arsItem = null;
        const rounds = isRanged({ weapon: it.key }) ? rng.int(RESCUE_RAID.GRAB_AMMO[0], RESCUE_RAID.GRAB_AMMO[1]) : 0;
        if (rounds && b.pools && b.pools.length) { const pool = b.pools[b.pools.length - 1]; pool.ammo = (pool.ammo || 0) + rounds; }
        const where = equipOrStow(state, b, u, s, it, "weapon");
        say(b, `${u.name} takes ${t.name.replace(" (the keys)", "")}'s ${it.name}${rounds ? ` and ${rounds} rounds` : ""}${where}.`, "good");
        return "";
      }
      const it = lootItem(t.armorKey, kitSource(t.kit || "raiders"), spend(rng));
      t.armorKey = null;
      const where = equipOrStow(state, b, u, s, it, GEAR[it.key] ? GEAR[it.key].slot : "armor");
      say(b, `${u.name} strips ${t.name.replace(" (the keys)", "")}'s ${it.name}${where}.`, "good");
      return "";
    }
    case "armory": {
      const A = R.armory;
      if (!A || cheb(u, A.x, A.y) > 1) return "Stand at the armory's rack.";
      if (!armoryOpen(b)) return "The armory is locked.";
      if (!A.items.length && !A.ammo) return "The rack is empty.";
      const f = factionById(state, R.factionId);
      u.ap -= 1;
      const got = [];
      const take = (it) => { A.items.splice(A.items.indexOf(it), 1); if (f) takeFromGroup(f, it); R.took.push(it); };
      if (u.captive) {
        const gun = [...A.items].filter((it) => GEAR[it.key].slot === "weapon").sort((a, d) => weaponScore(d) - weaponScore(a))[0];
        if (gun && (!s || !s.gear.weapon || weaponScore(gun) > weaponScore(s.gear.weapon))) { take(gun); got.push(gun.name + equipOrStow(state, b, u, s, gun, "weapon")); }
        const armour = A.items.find((it) => ARMOR_SLOTS.includes(GEAR[it.key].slot) && s && !s.gear[GEAR[it.key].slot]);
        if (armour) { take(armour); got.push(armour.name + equipOrStow(state, b, u, s, armour, GEAR[armour.key].slot)); }
      } else {
        for (const it of [...A.items].sort((a, d) => itemValue(d) - itemValue(a)).slice(0, 2)) {
          const p = state.parties.find((x) => x.id === b.setup.partyId);
          if (p && addGearToCargo(state, p, it)) { A.items.splice(A.items.indexOf(it), 1); if (f) takeFromGroup(f, it); R.took.push(it); got.push(it.name); }
        }
      }
      const rounds = Math.min(A.ammo, RESCUE_RAID.ARMORY_AMMO);
      if (rounds > 0) {
        A.ammo -= rounds;
        if (f && f.stock) f.stock.ammo = Math.max(0, (f.stock.ammo || 0) - rounds);
        if (b.pools && b.pools.length) { const pool = b.pools[b.pools.length - 1]; pool.ammo = (pool.ammo || 0) + rounds; }
        got.push(`${rounds} rounds`);
      }
      say(b, got.length ? `${u.name} raids the armory: ${got.join(", ")}.` : `${u.name} finds nothing here that fits.`, got.length ? "good" : "info");
      return "";
    }
    default:
      return "Unknown rescue action.";
  }
}
// A captive puts it on (their unit counts it at once); a teammate's goes in the team's cargo (" (in the cargo)").
function equipOrStow(state, b, u, s, it, slot) {
  if (s && (u.captive || !s.gear[slot])) {
    const old = s.gear[slot];
    if (old) { const p = state.parties.find((x) => x.id === b.setup.partyId); if (!(p && addGearToCargo(state, p, old))) { /* dropped where they stand */ } }
    if (!u.fit) { const id = b.nextId; const f0 = playerUnit(b, s); b.nextId = id; u.fit = { aim: f0.aim, dmgMult: f0.dmgMult, armor: f0.armor, medicine: f0.medicine }; }
    s.gear[slot] = it;
    refitUnit(b, u, s);
    if (slot === "weapon") loadMag(u, 0);
    (u.picked || (u.picked = [])).push(it);
    return slot === "weapon" ? " and arms himself" : " and puts it on";
  }
  const p = state.parties.find((x) => x.id === b.setup.partyId);
  return p && addGearToCargo(state, p, it) ? " (into the cargo)" : " (no room: left on the ground)";
}

// ---------- the guards ----------
function raiseAlarm(state, b, why) {
  const R = Rof(b);
  for (const u of b.units) if (u.side === "enemy" && !u.dead && !u.ko) u.aware = true;
  if (R.alarm) return;
  R.alarm = true;
  say(b, why, "danger");
  // The sleepers come out of the bunkhouses.
  if (R.asleep > 0) {
    const e = b.setup.enemy || {};
    const doors = (b.deployPlan && b.deployPlan.fort ? b.deployPlan.fort.buildings : []).filter((s) => s.doors && s.doors.length && (!R.cell || s.name !== R.cell.building) && (!R.armory || s.name !== R.armory.building));
    let n = 0;
    for (let i = 0; i < R.asleep; i++) {
      const u = enemyUnit(b, b.rng, e.kind || "raiders", e.power || 3, 50 + i);
      u.aware = true;
      if (e.factionId != null) u.factionId = e.factionId;
      const spot = doorSpot(b, doors[i % Math.max(1, doors.length)]);
      if (!spot) continue;
      u.x = spot[0]; u.y = spot[1];
      b.units.push(u);
      n++;
    }
    R.asleep = 0;
    if (n) say(b, `${n} more of them stumble out of the bunkhouses.`, "danger");
  }
}
function doorSpot(b, s) {
  const cand = [];
  const src = s ? s.doors : [[Math.floor(b.w / 2), Math.floor(b.h / 2)]];
  for (const [dx, dy] of src) for (let r = 1; r <= 4; r++) for (let y = dy - r; y <= dy + r; y++) for (let x = dx - r; x <= dx + r; x++) {
    if (x < 0 || y < 0 || x >= b.w || y >= b.h) continue;
    const q = b.cells[y * b.w + x];
    if (CELL[q.k].walk && !unitAt(b, x, y) && b.reach && b.reach[y * b.w + x]) cand.push([x, y, Math.hypot(x - dx, y - dy)]);
  }
  cand.sort((a, d) => a[2] - d[2]);
  return cand[0] || null;
}
// Guards spare captives (they are worth something), unless they are raiders losing badly.
export function spareCaptives(b) {
  const e = b.setup.enemy || {};
  if (e.kind !== "raiders") return true;
  const left = b.units.filter((u) => u.side === "enemy" && active(u)).length;
  return left >= Math.max(1, (b.enemyStart || 1) * RESCUE_RAID.SPARE.losing);
}
// One guard's move (combat.js enemyStep, before its usual AI). true: the turn is spent.
export function guardTurn(state, b, u) {
  const R = Rof(b);
  if (!R) return false;
  if (!R.alarm && b.units.some((g) => g.side === "enemy" && g.aware && active(g)) && R.kind === "base") raiseAlarm(state, b, `${u.aware ? u.name : "A guard"} raises the alarm!`);
  if (!u.aware || !active(u)) return false;
  // A downed captive within reach: taken back.
  if (spareCaptives(b)) {
    const down = b.units.find((t) => t.captive && t.down && !t.dead && !t.left && meleeReach(b, u, t));
    if (down) { recapture(state, b, down, `${u.name} drags ${first(down.name)} back`); u.ap = 0; return true; }
  }
  // Retake the armory: once the alarm is up and your people are near it (or it stands open).
  const A = R.armory;
  if (A && R.alarm && R.kind === "base") {
    const near = b.units.some((p) => p.side === "player" && active(p) && cheb(p, A.x, A.y) <= RESCUE_RAID.RETAKE.near);
    if ((near || armoryOpen(b)) && !A.held) {
      R.retakers = R.retakers.filter((id) => { const g = unitById(b, id); return g && active(g); });
      if (R.retakers.length < RESCUE_RAID.RETAKE.guards && !R.retakers.includes(u.id) && !u.cellKey) {
        const others = b.units.filter((g) => g.side === "enemy" && active(g) && g.aware && !g.cellKey && !R.retakers.includes(g.id)).sort((a, d) => Math.hypot(a.x - A.x, a.y - A.y) - Math.hypot(d.x - A.x, d.y - A.y));
        if (others.indexOf(u) >= 0 && others.indexOf(u) < RESCUE_RAID.RETAKE.guards - R.retakers.length) { R.retakers.push(u.id); u.post = null; }
      }
    }
    if (R.retakers.includes(u.id) && !A.held) {
      if (cheb(u, A.x, A.y) <= 1) { retake(state, b, u); return true; }
      stepToward(b, u, ring(b, A.x, A.y));
      return false; // the other action: the usual (a shot)
    }
  }
  // A captive down further off: the nearest guard goes for them.
  if (spareCaptives(b)) {
    const down = b.units.filter((t) => t.captive && t.down && !t.dead && !t.left);
    for (const t of down) {
      const nearest = b.units.filter((g) => g.side === "enemy" && active(g) && g.aware).sort((a, d) => Math.hypot(a.x - t.x, a.y - t.y) - Math.hypot(d.x - t.x, d.y - t.y))[0];
      if (nearest === u && Math.hypot(u.x - t.x, u.y - t.y) <= 10) { stepToward(b, u, ring(b, t.x, t.y)); return false; }
    }
  }
  return false;
}
function retake(state, b, u) {
  const R = Rof(b), A = R.armory;
  A.held = true;
  // Re-arm from the rack: a better gun than the one they hold.
  const gun = [...A.items].filter((it) => GEAR[it.key] && GEAR[it.key].slot === "weapon" && WEAPONS[it.key]).sort((a, d) => weaponScore(d) - weaponScore(a))[0];
  let line = `${u.name} retakes the armory`;
  if (gun && weaponScore(gun) > weaponScore({ key: u.weapon, quality: 1 })) {
    A.items.splice(A.items.indexOf(gun), 1);
    u.weapon = gun.key; u.weaponName = gun.name; u.arsItem = gun; u.mag = null; u.magW = null;
    loadMag(u);
    (R.issued || (R.issued = [])).push({ uid: u.id, item: gun });
    line += ` and takes up the ${gun.name}`;
  }
  // Locked again while the keys are theirs; one of them stays posted at its door.
  const doors = R.doors.filter((d) => d.area === "armory" && d.open && !d.broken && !unitAt(b, d.x, d.y));
  if (doors.length && R.keyUnit == null) { for (const d of doors) { lockDoor(b, d.x, d.y); d.open = false; } line += ", locks it again"; }
  u.post = "door";
  u.ap = 0;
  say(b, `${line} and stands guard there.`, "danger");
}
// Cells next to (x, y) a unit can stand on.
function ring(b, x, y) {
  const out = [];
  for (const [dx, dy] of N8) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < b.w && ny < b.h && CELL[b.cells[ny * b.w + nx].k].walk) out.push([nx, ny]); }
  return out;
}
// One action's move toward the target cells (the nearest by walking).
function stepToward(b, u, targets, aps = 1) {
  if (!targets.length || u.ap < 1) return false;
  const field = distField(b, targets, u);
  const r = reachable(b, u, u.mob * aps, { manual: u.side === "player" });
  const here = field[u.y * b.w + u.x];
  let best = -1;
  for (let i = 0; i < b.w * b.h; i++) {
    if (!isFinite(r.dist[i]) || r.dist[i] <= 0 || !isFinite(field[i]) || unitAt(b, i % b.w, (i / b.w) | 0)) continue;
    if (best < 0 || field[i] < field[best] || (field[i] === field[best] && r.dist[i] < r.dist[best])) best = i;
  }
  if (best < 0 || !(field[best] < here)) return false;
  const path = pathTo(r, best % b.w, (best / b.w) | 0);
  if (!path.length) return false;
  u.ap -= r.dist[best] <= u.mob ? 1 : 2;
  u.hunker = false;
  moveAlong(b, u, path);
  return true;
}
// Your side's step (the bot): through combatAct, so overwatch, detection and the rest happen as for a click.
function walkToward(state, b, u, targets) {
  if (!targets.length || u.ap < 1) return false;
  const field = distField(b, targets, u);
  const r = reachable(b, u, u.mob, { manual: true });
  const here = field[u.y * b.w + u.x];
  let best = -1;
  for (let i = 0; i < b.w * b.h; i++) {
    if (!isFinite(r.dist[i]) || r.dist[i] <= 0 || !isFinite(field[i]) || unitAt(b, i % b.w, (i / b.w) | 0)) continue;
    if (best < 0 || field[i] < field[best] || (field[i] === field[best] && r.dist[i] < r.dist[best])) best = i;
  }
  if (best < 0 || !(field[best] < here)) return false;
  return !combatAct(state, { type: "move", unit: u.id, x: best % b.w, y: (best / b.w) | 0 });
}

// Taken back: stripped (everything back to the rack), tied up in the cell again (locked while the keys are theirs).
export function recapture(state, b, u, why) {
  const R = Rof(b);
  const s = survivorById(state, u.sid);
  const f = factionById(state, R.factionId);
  const back = [];
  if (s) for (const it of stripAll(s)) { if (R.armory) R.armory.items.push(it); giveToGroup(f, it); R.returned.push(it); back.push(it.name); }
  if (R.keyUnit === u.id) { R.keyUnit = null; const g = b.units.filter((x) => x.side === "enemy" && active(x)).sort((a, d) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(d.x - u.x, d.y - u.y))[0]; if (g) { g.cellKey = true; R.jailer = g.id; } }
  u.pin = false;
  u.picked = [];
  if (s) { refitUnit(b, u, s); u.weapon = "fists"; u.weaponName = "Fists"; }
  u.tied = true; u.down = false; u.ko = false; u.surr = false; u.stab = false; u.bleed = 0; u.ow = u.hunker = false; u.ap = 0;
  u.hp = Math.max(5, u.hp || 0);
  u.carrying = null;
  const spot = R.cell ? R.cell.cells.find(([x, y]) => !unitAt(b, x, y)) : null;
  if (spot) { u.x = spot[0]; u.y = spot[1]; }
  if (R.cell && R.keyUnit == null) for (const d of R.doors) if (d.area === "cell" && d.open && !d.broken && !unitAt(b, d.x, d.y)) { lockDoor(b, d.x, d.y); d.open = false; }
  R.recaptured++;
  say(b, `${why}: ${first(u.name)} is stripped${back.length ? ` (${back.join(", ")} back to their rack)` : ""} and tied up in the ${R.cell ? R.cell.name : "yard"} again.`, "death");
}

// Every round before your turn (combat.js startPlayerTurn): the downed taken back, the cornered give up.
export function rescueRound(state, b) {
  const R = Rof(b);
  if (!R || b.over) return;
  const spare = spareCaptives(b);
  for (const u of b.units.filter((t) => t.captive && !t.dead && !t.left && !t.tied)) {
    const guards = b.units.filter((g) => g.side === "enemy" && active(g) && g.aware);
    const mates = b.units.filter((p) => p.side === "player" && p !== u && active(p) && !p.tied);
    // Down, or given up (nonlethal: u.surr) with a guard next to them and none of yours: taken back.
    if (u.down || u.surr) {
      if (spare && guards.some((g) => cheb(g, u.x, u.y) <= 1) && !mates.some((p) => cheb(p, u.x, u.y) <= 1)) recapture(state, b, u, "The guards take back the downed");
      continue;
    }
    const S = RESCUE_RAID.SURRENDER;
    if (u.hp < u.maxHp * S.hp && guards.filter((g) => cheb(g, u.x, u.y) <= S.range).length >= S.guards && !mates.some((p) => cheb(p, u.x, u.y) <= S.alone) && b.rng.chance(S.chance)) {
      recapture(state, b, u, `Hurt, alone and surrounded, ${first(u.name)} gives up`);
    }
  }
}
// Guards shoot to wound a captive (combat.js damage).
export const captiveHitMult = (b, t, by) => (t && t.captive && by && by.side === "enemy" && b.rescue && spareCaptives(b) ? RESCUE_RAID.SPARE.dmg : 1);

// ---------- the end ----------
// combat.js endBattle: a captive still held when it ends (not out with the team, the battle not won) stays a captive,
// hurt but alive (not "left behind and lost"). true: handled here.
export function captiveStays(state, b, u, s, outcome) {
  if (u.dead) return false;
  if (outcome === "victory") return false;
  if (u.left && !u.tied) return false;
  s.health = clamp(Math.min(s.health, u.down ? 10 : u.hp), 5, 100);
  return true;
}
// Is there anyone left to free? (the bot's evac, combat.js autoPlayerTurn)
export const rescueDone = (b) => !b.units.some((u) => u.captive && !u.dead && !u.left);

registerCombatHandler("rescueRaid", onRescueRaid);

function onRescueRaid(state, result, setup, battle) {
  const c = setup.context;
  if (!result.tactical || !battle) {
    // By the numbers (headless, the autopilot): the old rescue fight (conflicts.js).
    settleRescue(state, result, { context: { partyId: c.partyId, factionId: c.factionId, mode: c.mode === "sneak" ? "alarm" : "assault" } });
    return;
  }
  const out = afterRescueBattle(state, result, setup, battle);
  const p = state.parties.find((x) => x.id === c.partyId);
  const f = factionById(state, c.factionId);
  if (f) {
    f.pop = Math.max(0, f.pop - Math.ceil((result.enemiesKilled || 0) * 0.6));
    const R = battle.rescue || {};
    changeGoodwill(state, f, c.mode === "assault" ? RESCUE_RAID.GOODWILL.assault : R.alarm ? RESCUE_RAID.GOODWILL.sneak : RESCUE_RAID.GOODWILL.quiet, "you broke into their base");
    if (groupBroken(f)) collapseFaction(state, f);
  }
  log(state, out.text, out.freed.length ? "good" : "danger");
  if (p && state.parties.includes(p) && !wipeIfEmpty(state, p)) { delete p.conflictResume; awaitOrders(state, p, out.text); }
}

// Who came out free, who is still held, and the group's armory put right. Returns { freed, held, text }.
export function afterRescueBattle(state, result, setup, battle) {
  const c = setup.context || {};
  const R = (battle && battle.rescue) || { took: [], returned: [] };
  const p = state.parties.find((x) => x.id === c.partyId);
  const f = factionById(state, c.factionId);
  const freed = [], held = [], lost = [];
  for (const u of battle ? battle.units.filter((x) => x.captive) : []) {
    const s = survivorById(state, u.sid);
    if (!s) continue;
    if (!s.alive) { lost.push(s); continue; }
    const out = result.outcome === "victory" || (u.left && !u.tied);
    if (out && isCaptive(s)) {
      if (p && state.parties.includes(p)) freeCaptive(state, s, p);
      else { s.location = { kind: "base", baseId: (hub(state) || state.bases[0] || { id: null }).id }; s.role = "rest"; }
      freed.push(s);
    } else if (isCaptive(s)) {
      // Still held: what they picked up goes back to the group; a pin or the keys kept hidden help them later.
      for (const it of stripAll(s)) giveToGroup(f, it);
      s.location.tool = R.keyUnit === u.id ? "key" : u.pin ? "pin" : s.location.tool || null;
      held.push(s);
    }
  }
  // A guard who took up a gun from the rack and died with it: that gun is on his body now (yours to loot after a win).
  for (const is of R.issued || []) { const g = battle ? unitById(battle, is.uid) : null; if (g && g.dead && f) takeFromGroup(f, is.item); }
  const st = state.stats.conflicts || (state.stats.conflicts = { types: {}, outcomes: {}, captured: 0, rescued: 0, joined: 0, captiveEvents: {} });
  st.outcomes[`rescueraid-${result.outcome}`] = (st.outcomes[`rescueraid-${result.outcome}`] || 0) + 1;
  const bits = [];
  if (freed.length) bits.push(`${freed.map((s) => first(s.name)).join(", ")} ${freed.length === 1 ? "is" : "are"} free${p && state.parties.includes(p) ? " and with the team" : ", making their own way home"}.`);
  if (held.length) bits.push(`${held.map((s) => first(s.name)).join(", ")} ${held.length === 1 ? "is" : "are"} still held by ${f ? f.name : "them"}.`);
  if (lost.length) bits.push(`${lost.map((s) => first(s.name)).join(", ")} did not live through it.`);
  if (R.took && R.took.length) bits.push(`Out of their armory: ${R.took.map((it) => it.name).join(", ")}.`);
  const text = `${result.outcome === "victory" ? "The guards are beaten." : result.outcome === "retreat" ? "The team got out." : "The rescue failed."} ${bits.join(" ")}`.trim();
  return { freed, held, lost, text };
}

// ---------- "AI plays my side" (combat.js autoPlayerTurn) ----------
// Captives first (the safest way out: the ropes when nobody watches, a pin and the lock, the jailer's keys when he is
// alone, weapons, never cornered alone, then the way out); then the team (to the cell, open it, cut the ropes, the
// keys off the jailer; once nobody is left tied up, everyone evacuates). What they leave of their actions the usual
// battle AI spends (a shot).
const act = (state, u, op, extra = {}) => !combatAct(state, { type: "rescue", unit: u.id, op, ...extra });
export function rescueBot(state, b) {
  const R = Rof(b);
  if (!R || b.over || b.phase !== "player") return;
  const guards = () => b.units.filter((g) => g.side === "enemy" && active(g));
  const cellOpen = () => R.doors.some((d) => d.area === "cell" && d.open);
  const lockedCell = () => (cellOpen() ? [] : R.doors.filter((d) => d.area === "cell" && !d.open));
  const pending = () => b.units.filter((t) => t.captive && t.tied && !t.dead && !t.left);
  const inCellCell = (x, y) => !!(R.cell && R.cell.cells.some(([cx, cy]) => cx === x && cy === y));
  // Captives.
  for (const u of b.units.filter((t) => t.captive && !t.dead && !t.left && !t.down)) {
    for (let step = 0; step < 4 && !b.over && u.ap > 0 && !u.left; step++) {
      if (u.tied) {
        const watched = guards().some((g) => g.aware && canSee(b, g, u));
        if (watched && !R.alarm) { u.ap = 0; break; } // wait for a better moment
        if (!act(state, u, "ropes")) break;
        continue;
      }
      if (!active(u)) break;
      if (boundNear(b, u).length && act(state, u, "cut")) continue;
      const s = survivorById(state, u.sid);
      if (inCell(b, u) && lockedCell().length) {
        if (doorNear(b, u).length) {
          if (hasKeys(b, u) && act(state, u, "unlock")) continue;
          if ((u.pin || (s && picksOf(s)) || R.searched[u.id]) && act(state, u, "pick")) continue;
        }
        if (!R.searched[u.id] && act(state, u, "search")) continue;
        if (walkToward(state, b, u, lockedCell().flatMap((d) => ring(b, d.x, d.y)).filter(([x, y]) => inCellCell(x, y)))) continue;
        if (doorNear(b, u).length && act(state, u, "pick")) continue;
        u.ap = 0;
        break;
      }
      if (hasKeys(b, u) && pending().length && lockedCell().length) {
        if (doorNear(b, u, (d) => d.area === "cell").length && act(state, u, "unlock")) continue;
        if (walkToward(state, b, u, lockedCell().flatMap((d) => ring(b, d.x, d.y)).filter(([x, y]) => !inCellCell(x, y)))) continue;
      }
      const unarmed = !s || !s.gear.weapon;
      const bodies = bodyNear(b, u);
      if (bodies.some((t) => (unarmed && t.weapon && t.weapon !== "fists" && GEAR[t.weapon]) || (t.armorKey && s && !s.gear.armor)) && act(state, u, "grab")) continue;
      const j = jailerOf(b);
      if (j && j.cellKey && R.keyUnit == null && bodies.includes(j) && pending().length && act(state, u, "key")) continue;
      // The jailer alone and close: go for his keys bare-handed.
      if (j && active(j) && j.cellKey && pending().length && lockedCell().length && Math.hypot(j.x - u.x, j.y - u.y) <= 6 && !guards().some((g) => g !== j && Math.hypot(g.x - j.x, g.y - j.y) <= 5)) {
        if (meleeReach(b, u, j)) { if (!combatAct(state, { type: "melee", unit: u.id, target: j.id })) continue; }
        else if (walkToward(state, b, u, ring(b, j.x, j.y))) continue;
      }
      // The armory, open and close by: a weapon.
      if (unarmed && R.armory && armoryOpen(b) && R.armory.items.length && Math.hypot(R.armory.x - u.x, R.armory.y - u.y) <= 8) {
        if (cheb(u, R.armory.x, R.armory.y) <= 1) { if (act(state, u, "armory")) continue; }
        else if (walkToward(state, b, u, ring(b, R.armory.x, R.armory.y))) continue;
      }
      // Never cornered alone: toward the nearest teammate when guards are close and nobody of yours is.
      const mates = b.units.filter((p) => p.side === "player" && p !== u && active(p) && !p.captive);
      const close = guards().filter((g) => g.aware && Math.hypot(g.x - u.x, g.y - u.y) <= 4).length;
      if (close && mates.length && !mates.some((p) => Math.hypot(p.x - u.x, p.y - u.y) <= 4)) {
        const m = [...mates].sort((a, d) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(d.x - u.x, d.y - u.y))[0];
        if (walkToward(state, b, u, ring(b, m.x, m.y))) continue;
      }
      // Out: the evac strip.
      if (evacAt(b, u.x, u.y)) { if (!combatAct(state, { type: "retreat", unit: u.id })) break; }
      if (!walkToward(state, b, u, evacCells(b))) break;
    }
  }
  if (b.over) return;
  // The team: to the cell while anyone is tied up or locked in; then with the freed until they are out; then out.
  const stuck = () => b.units.filter((t) => t.captive && !t.dead && !t.left && (t.tied || (inCell(b, t) && lockedCell().length)));
  const loose = b.units.filter((t) => t.captive && !t.dead && !t.left && !t.tied && !stuck().includes(t));
  if (!stuck().length) {
    if (loose.length) {
      for (const u of b.units.filter((t) => t.side === "player" && !t.captive && active(t) && t.ap > 0)) {
        const near = [...loose].sort((a, d) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(d.x - u.x, d.y - u.y))[0];
        if (Math.hypot(near.x - u.x, near.y - u.y) > 4) walkToward(state, b, u, ring(b, near.x, near.y));
      }
      return;
    }
    if (!b.evacOrder && b.units.some((u) => u.side === "player" && active(u))) combatAct(state, { type: "evac" });
    return;
  }
  for (const u of b.units.filter((t) => t.side === "player" && !t.captive && active(t))) {
    for (let step = 0; step < 3 && !b.over && u.ap > 0 && active(u); step++) {
      if (!stuck().length) break;
      if (boundNear(b, u).length && act(state, u, "cut")) continue;
      const s = survivorById(state, u.sid);
      const cellDoor = doorNear(b, u, (d) => d.area === "cell");
      if (cellDoor.length) {
        if (hasKeys(b, u) && act(state, u, "unlock")) continue;
        if (s && picksOf(s) && act(state, u, "pick")) continue;
        const fo = forceOdds(state, b, u, cellDoor[0]);
        if (!fo.why && u.ap >= fo.ap && act(state, u, "force")) continue;
      }
      const j = jailerOf(b);
      if (j && j.cellKey && R.keyUnit == null && bodyNear(b, u).includes(j) && act(state, u, "key")) continue;
      // Where to: a tied captive the team can reach (the cell open), else the cell's door (or the jailer, for a door
      // nobody here can open).
      let targets;
      if (!lockedCell().length || !stuck().some((t) => inCell(b, t))) targets = stuck().flatMap((t) => ring(b, t.x, t.y));
      else {
        const canOpen = hasKeys(b, u) || (s && picksOf(s)) || lockedCell().some((d) => !forceOdds(state, b, u, d).why);
        targets = canOpen ? lockedCell().flatMap((d) => ring(b, d.x, d.y)).filter(([x, y]) => !inCellCell(x, y))
          : j && !j.dead && j.cellKey ? ring(b, j.x, j.y) : [];
      }
      walkToward(state, b, u, targets);
      break; // one move toward it a turn; the other action for the fight
    }
  }
}
function evacCells(b) {
  const out = [];
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (evacAt(b, x, y) && CELL[b.cells[y * b.w + x].k].walk) out.push([x, y]);
  return out;
}

// The Help topic (ui/help.js): getting your people back.
export const RESCUE_HELP = `<p>Your people taken by another group are <b>captives</b>: their line on the People tab says who holds them, where and since when, with two buttons.</p>
<p><b>Plan a rescue</b> opens the planner with the Rescue mission on their base. At the gates you choose: <b>Sneak in on the map</b> or <b>Storm the base on the map</b> (a battle on their base's own map), the same two <b>by the numbers</b> (a dice roll, no battle screen), talk them round, or pay at the gates. On the map your captives are your units from the start, tied up and stripped, in a cell (a chain-link cage for raiders, holding cells for soldiers) whose door is locked; a guard by it has the keys. They can <b>work the ropes</b> (Stealth helps; a guard who sees it raises the alarm and beats them), <b>search the cell</b> for a nail or a pin (30%) and <b>pick the lock</b> (easier with a pin, easiest with lockpicks), fight bare-handed, take the jailer's keys once he is down, and <b>take weapons</b> off downed guards or out of their armory. Your team can cut the ropes, pick or force the door (forcing is loud) and raid the armory too: what is taken is gone from the group. Once the alarm is up everyone comes (at night some were asleep), two guards go to retake the armory, and a captive who is beaten down or cornered alone and hurt is taken back, stripped and tied up again: guards want them alive. Get everyone out over the edge of the map; whoever is still inside when your team is gone stays a captive (a pin or the keys they kept make a later escape likelier).</p>
<p><b>Negotiate</b> asks their price for everyone they hold: by radio when your network reaches them, else an envoy rides out. Any group will deal, raiders too. The price grows with the captives' skills and the group's hostility, and is paid in what they want (raiders: guns, ammo, meds, fuel, food). Haggle once (Speech), or offer prisoners from your cells in exchange (their own people count for more). Peaceful groups bring your people home themselves; raiders, zealots and anyone hostile name a <b>meeting point</b>: send a team with the goods. Raiders betray about one handover in six (fewer against a strong team): an ambush on the road, your people tied up behind their line. Win and you keep both; lose or run and they keep both. Zealots who hate you want double, or nothing.</p>
<p>The autopilot pays a ransom when the hub can spare it, sends a rescue raid when its squad would beat the guards and the captive is worth it, and otherwise waits.</p>`;
