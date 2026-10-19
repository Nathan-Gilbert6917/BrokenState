// Grenade launchers and rockets, and what explosions do to gear (docs/weapons-overhaul-plan.md sections 13 and 24;
// wave 2, agent F). The launchers are items (data-guns.js LATER_GEAR, merged into GEAR: the M79, the M32, the AT4 and
// the RPG; the M203 is a gun part under an AR-15, data-gunmods.js), their rounds data-ammo.js boxes and supplies
// (a_40mm_he / buck / smoke / illum, a_rocket_heat: common: false, never generic "ammo").
//
// On the battle map a launcher is a unit's second weapon, u.gl = { key, cal, cap, mag, load, from, aimD, res? }:
//   - your people: one in the hands (the M79, M32, AT4 or RPG: they fight with a sidearm from the off hand or a pocket,
//     else their fists, besides), an M203 under the rifle in their hands (the rifle still shoots), or one carried in
//     the off hand, a pocket or the pack (fitLauncher, from playerUnit). Its rounds are the team's (the boxes the
//     fighters carry, then the pools), like a gun's: gl.mag is a counter, a round leaves the pools when it is fired.
//   - the enemy: soldiers' ARs carry an M203 one time in eight (gunmods.js ENEMY_MODS) with 2–4 HE, and one soldier in
//     LAUNCH.RPG battles at power 8+ an RPG with 1–2 rockets (kitLauncher, from enemyUnit). A group's people are armed
//     from its arsenal instead (armLauncher, from arsenal.js armFromArsenal): the M203 on the issued rifle, a launcher
//     the issue gives them (arsenal.js issueKit: launchers first against walls), rounds out of the group's stores
//     (f.stock by key), the unfired ones back after the fight (settleArsenal). Raiders who captured an RPG use it (R15).
// Firing ("launch", combatAct; the turn's attack, like a shot):
//   - 40 mm: lobbed over walls like a throw (throwables.js throwBlind: a cell someone on the side sees; throwLanding with
//     LAUNCH.SCATTER −15, better than a throw), up to 20 tiles (the M79, M32) or 16 (the M203). Inside a building it
//     needs a straight line. HE blasts the cell it lands on (GL_HE: impact 34–46, splash 16–24 within 1.5); buckshot is
//     a shotgun shot at someone within 8 (28–40, best within 3); smoke a cloud (throwables.js SMOKE); illumination a
//     flare that lights 7 tiles (ILLUM).
//   - Rockets (the RPG, the AT4): straight at a cell the shooter sees, 14 tiles; a tile off now and then, and what is in
//     the way stops it. ROCKET: impact 70–95, splash 30–45 within 2, 180–260 to a gate, a door, a wall section (half),
//     a battering ram broken outright, the team's vehicle worn 70 (× 0.6 a plating level), Heat +15 in a raid.
//   - Arming: HE and rockets inside LAUNCH.ARM (3) tiles do not explode: a slug, 15–25 on whoever is on the cell.
//   - Backblast (rockets): anyone within 2 tiles behind the shooter (±45°) takes 10–20; fired from inside a building
//     (an enclosed cell) the shooter takes 8–14 and loses their next action (throwables.js stunTurnStart: u.reel).
//   - Reload: 1 action (the M32 holds 6); the AT4 is its own round: fired, it is gone (the item leaves the survivor
//     when the fight ends, an arsenal's leaves the group's books).
// Explosions vs gear (section 24): everyone a blast hits keeps a tally (blastHit, from throwables.js hurtAll): their
//   gear is worn 15–50% by the blast damage taken (bodies when they are searched: blastLoot; your people when the
//   fight ends: launcherBattleEnd), boxes and loose rounds lose 0–40% (cook-off), and a frag, pipe bomb or Molotov they
//   carry goes off 10% of the time, at their cell. A vehicle blown up (its blast wear this fight reaches its condition:
//   combat.js vehicleBlast) loses 50–80% of its cargo and the rest is worn 20–60% (blownUpCargo, settleVehicle); its
//   riders take the blast in full.
// The AI (aiLaunch, both sides: siege.js siegeAI for the enemy, autoPlayerTurn's botLaunch for yours): HE on three or
// more foes bunched up (throwables.js blastSpot, need 3, nobody of its own side near), rockets first at siege targets
// (a gate or a wall section of the other side's, a battering ram, your vehicle, their Humvee: need 1), else on three
// people; never inside the arming range, never with a friend in the backblast cone, never a rocket from inside.
// Every die is the battle's (b.rng) for what the player sees happen; wear and cook-off use hashes of their own.
import { FOODS } from "./foods.js"; // food in a pile burns
import { GEAR } from "./data.js";
import { WEAPONS, say, fx, active, damage, canSeeAt, los, coverAgainst, COVER_DEF, unitAt, alertNear, sidearmOf, heldTerms, loadMag, magCap } from "./combat.js";
import { fitMags } from "./mags.js"; // the sidearm's magazines when the launcher is in the hands (w2-kit)
import { throwBlind, throwLanding, blastSpot, landEffect, nextTurnOf, SMOKE } from "./throwables.js";
import { gunMods, modLabel, NO_MODS } from "./gunmods.js";
import { syncModes } from "./gunfire.js";
import { chooseLoad } from "./ammo.js";
import { ammoKey, CALIBERS, spreadMult } from "./data-ammo.js";
import { hash01 } from "./skills.js";
import { skill } from "./world.js";
import { itemDur, itemDurMax } from "./crafting.js";
import { burnShare } from "./woodcutting.js"; // what burns (fire on things lying on the ground: fireStuff)
import { findCarried } from "./stealth.js";
import { breakRam, isCrew } from "./siege.js";
import { lootItem, packOf, allCarried, carriedSpots, insertsOf, isCarrier } from "./inventory.js"; // allCarried: worn, held, pockets, rig pouches, the pack, a carrier's plates

export const LAUNCH = {
  ARM: 3, DUD: [15, 25], // tiles; a round that does not arm hits as a slug
  SCATTER: -15, // + a throw's chance to land a tile off (throwables.js scatterChance): −15 points
  BACK: { r: 2, cone: 45, dmg: [10, 20], self: [8, 14] }, // a rocket's backblast
  BUCK: { dmg: [28, 40], opt: 3, fall: 7, aim: 10, range: 8 }, // 40 mm canister: a shotgun shot at someone
  HEAT: { "40mm": 8, rocket: 15 }, // Heat in a raid a launch
  RES: { "40mm": [2, 4], rocket: [1, 2] }, // rounds an enemy carries for it (the one loaded among them)
  M203: 1 / 8, RPG: 0.05, RPG_POWER: 8, // soldiers: an M203 on one AR in eight (gunmods.js ENEMY_MODS); an RPG one battle in 20 at power 8+
  M79_BODY: 0.01, // a dead soldier's body: an M79 and a few HE now and then
  PACK: { "40mm": 6, rocket: 2 }, // rounds a team packs for each launcher it carries (parties.js launchExpedition)
  ARS: { "40mm": 4, rocket: 2 }, // rounds a group's fighter draws from its stores for the fight
  AI_NEED: 3, AI_SIEGE: 1,
  GEAR_WEAR: [0.15, 0.5], GEAR_REF: 60, COOK: 0.4, COOK_THROW: 0.1, // section 24: worn by the blast damage taken (60: the most)
  CARGO_LOST: [0.5, 0.8], CARGO_WEAR: [0.2, 0.6],
};
// A 40 mm HE grenade and a rocket (throwables.js landEffect T.blast): impact on the cell it lands on, dmg the splash
// within r; struct to gates, doors and windows (wall sections and ladders half); kind: combat.js BLAST_WEAR (the
// team's vehicle); heavy: also a building's doors and a bridge's tank traps; rams: breaks a battering ram; bang: the
// hearing.js loudness (section 18.4).
export const GL_HE = { r: 1.5, impact: [34, 46], dmg: [16, 24], struct: [35, 50], wake: 14, noise: 4, bang: 5, kind: "gl" };
export const ROCKET = { r: 2, impact: [70, 95], dmg: [30, 45], struct: [180, 260], wake: 22, noise: 6, bang: 7, kind: "rocket", heavy: true, rams: true };
export const ILLUM = { r: 7, turns: 4 };
// What each round does: blast (a table), buck (a shot), smoke, flare.
export const LAUNCH_ROUNDS = { he: "blast", heat: "blast", buck: "buck", smoke: "smoke", illum: "flare" };
const ROUND_NAME = { he: "HE", heat: "rocket", buck: "buckshot", smoke: "smoke", illum: "flare" };

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const inside = (b, x, y) => x >= 0 && y >= 0 && x < b.w && y < b.h;
const cellOf = (b, x, y) => b.cells[y * b.w + x];
const clamp = (v, a, c) => Math.max(a, Math.min(c, v));
const num = (v) => (Number.isFinite(v) ? v : 0);

// ---------- what a launcher is ----------
/** @param {string} k */
export const isLauncherKey = (k) => !!(WEAPONS[k] && WEAPONS[k].launcher && GEAR[k] && GEAR[k].slot === "weapon");
export const isLauncherItem = (it) => !!(it && isLauncherKey(it.key));
const underOf = (it) => (it && it.mods && it.mods.under && WEAPONS[it.mods.under.key] && WEAPONS[it.mods.under.key].launcher ? it.mods.under : null);
export const glRange = (g) => (g && WEAPONS[g.key] ? WEAPONS[g.key].range || 14 : 0);
export const glName = (g) => (g && GEAR[g.key] ? GEAR[g.key].name : g && WEAPONS[g.key] ? WEAPONS[g.key].name : "launcher");
const glWord = (g) => (g && g.key === "m203" ? "M203" : g && g.key === "at4" ? "rocket tube" : g && g.key === "rpg" ? "RPG" : g && g.key === "m32" ? "M32" : "M79");
export const roundKey = (g, type) => (g ? ammoKey(g.cal, type || g.load) : null);
export const roundLabel = (type) => ROUND_NAME[type] || type || "";
// "M79 1/1 HE" (the unit line; nothing without a launcher). b: your side's shows only what the pools still hold.
export function glLabel(b, u) {
  const g = u && u.gl;
  if (!g) return "";
  const shown = u.side === "player" && !g.oneShot ? Math.min(g.mag, glRounds(b, u, g.load)) : g.mag;
  return `${glWord(g)} ${shown}/${g.cap}${g.oneShot ? "" : ` ${roundLabel(g.load)}`}`;
}

// ---------- rounds (your side: the boxes carried, then the pools; the enemy: what they carry, gl.res) ----------
function sideKeyRounds(b, side, key) {
  let n = 0;
  for (const o of b.units || []) if (o.side === side && o.boxes) for (const it of o.boxes) if (it && it.key === key) n += Math.max(0, Math.floor(num(it.dur)));
  if (side === "player") for (const p of b.pools || []) n += Math.max(0, Math.floor(num(p[key])));
  return n;
}
// Rounds of a type for this unit's launcher (type: its loaded one when not given).
export function glRounds(b, u, type) {
  const g = u && u.gl;
  if (!g) return 0;
  if (g.oneShot) return g.mag;
  const t = type || g.load;
  if (u.side !== "player") return (g.res && g.res[t]) || 0;
  return sideKeyRounds(b, u.side, ammoKey(g.cal, t));
}
function takeRound(b, u, type) {
  const g = u.gl;
  if (u.side !== "player") { if (g.res && g.res[type] > 0) g.res[type] -= 1; return; }
  const key = ammoKey(g.cal, type);
  for (const o of [u, ...b.units.filter((x) => x !== u && x.side === u.side)]) for (const it of o.boxes || []) if (it && it.key === key && it.dur >= 1) { it.dur -= 1; return; }
  for (const p of b.pools || []) if (p[key] >= 1) { p[key] -= 1; return; }
}
// The types of round for this unit's launcher to hand: [{ type, name, n }], the loaded one first.
export function glLoads(b, u) {
  const g = u && u.gl;
  if (!g || g.oneShot || !CALIBERS[g.cal]) return [];
  return CALIBERS[g.cal].types.map((t) => ({ type: t, name: roundLabel(t), n: glRounds(b, u, t) })).filter((x) => x.n > 0 || x.type === g.load).sort((a, c) => (a.type === g.load ? -1 : c.type === g.load ? 1 : 0));
}
// The best type to start with or reload: HE (or the rocket) while there are any, else whatever there is most of.
function bestType(b, u) {
  const g = u.gl;
  const types = CALIBERS[g.cal] ? CALIBERS[g.cal].types : [];
  if (glRounds(b, u, CALIBERS[g.cal].base) > 0) return CALIBERS[g.cal].base;
  let best = CALIBERS[g.cal].base, most = 0;
  for (const t of types) { const n = glRounds(b, u, t); if (n > most) { most = n; best = t; } }
  return best;
}

// ---------- your people (combat.js playerUnit / refitUnit) ----------
// The survivor behind a unit of yours, for this session (a carried frag that cooks off leaves them at once). Not saved:
// after a load the fight's end takes it off instead (u.cooked).
const OWNER = new WeakMap();
// The aim terms a launcher would have in this survivor's hands (world.js gearEffect by its req; the M203: Shooting 6).
function launcherTerms(s, item, key) {
  if (key === "m203") {
    const gap = 6 - skill(s, "shooting");
    const mult = gap <= 0 ? 1 : gap <= 3 ? 0.85 : gap <= 7 ? 0.65 : 0;
    return { aim: -(1 - mult) * 30, usable: mult > 0 };
  }
  const t = heldTerms(s, item);
  return { aim: t.aim, usable: t.key === key };
}
// Where a survivor carries a launcher (the first found): in the hands, under the rifle in the hands, the off hand, a
// pocket, the pack. skip: spent ones still on them this fight ({ key: n }).
function carriedLauncher(s, skip = {}) {
  const left = { ...skip };
  const ok = (it) => { if (!isLauncherItem(it)) return false; if (left[it.key] > 0) { left[it.key]--; return false; } return true; };
  const g = s.gear || {};
  if (ok(g.weapon)) return { item: g.weapon, key: g.weapon.key, from: "weapon" };
  const under = underOf(g.weapon);
  if (under) return { item: under, key: under.key, from: "under" };
  if (ok(g.tool)) return { item: g.tool, key: g.tool.key, from: "tool" };
  for (const it of s.pockets || []) if (ok(it)) return { item: it, key: it.key, from: "pocket" };
  for (const it of packOf(s) || []) if (ok(it)) return { item: it, key: it.key, from: "pack" };
  return null;
}
const BOMBS = ["frag", "pipebomb", "molotov"];
const countKey = (s, key) => allCarried(s).filter((it) => it.key === key).length; // a rig's grenade pouch too
export function fitLauncher(b, u, s) {
  if (!u || !s) return;
  OWNER.set(u, s);
  delete u.gl;
  const bombs = {};
  for (const k of BOMBS) { const n = countKey(s, k) - ((u.cooked || []).filter((x) => x === k).length); if (n > 0) bombs[k] = n; }
  u.bombs = bombs; // section 24: what a blast can set off on them
  if (WEAPONS[u.weapon] && WEAPONS[u.weapon].launcher && isLauncherItem(s.gear.weapon)) {
    // A launcher in their hands (even a spent tube still held): the gun they fight with besides is a sidearm (the off
    // hand, a pocket), else fists.
    const side = sidearmOf(s);
    const from = heldTerms(s, s.gear.weapon), to = heldTerms(s, side);
    u.aim += to.aim - from.aim;
    u.dmgMult *= to.dmg / (from.dmg || 1);
    u.weapon = to.key; u.item = to.item; u.gearRisk = to.risk;
    u.weaponName = to.key === "fists" ? "Fists" : modLabel(side);
    u.gm = to.key === "fists" ? NO_MODS : gunMods(side); u.gmWeapon = u.weapon;
    u.load = chooseLoad(b, u, side ? side.load : null);
    u.mag = null; u.magW = null;
    fitMags(b, u, carriedSpots(s), magCap(u)); // mags.js: the sidearm's magazine and its spares (the launcher has none)
    loadMag(u);
    u.modesW = null; syncModes(u);
  }
  const c = carriedLauncher(s, u.glSpent || {});
  if (!c) return;
  const W = WEAPONS[c.key];
  const lt = launcherTerms(s, c.item, c.key);
  if (!lt.usable) return; // far above their skill: they cannot use it
  // The launcher's own aim against what the unit's aim already holds (the gun in its hands now).
  const cur = c.from === "under" ? 0 : heldTerms(s, u.item).aim;
  const g = { key: c.key, cal: W.launcher, cap: W.cap || 1, mag: 0, load: CALIBERS[W.launcher] ? CALIBERS[W.launcher].base : "he", from: c.from, aimD: Math.round((lt.aim - (c.from === "under" ? 0 : cur)) * 10) / 10 };
  if (W.oneShot) { g.oneShot = true; g.mag = 1; g.load = "heat"; }
  u.gl = g;
  if (!g.oneShot) { g.load = bestType(b, u); g.mag = Math.min(g.cap, glRounds(b, u, g.load)); } // carried loaded, as far as the team's rounds go
}
// Gear changed in the middle of a raid (combat.js refitUnit: f is the fresh playerUnit): the same launcher keeps what
// it had loaded, another one is taken up empty; a tube fired this fight stays fired.
export function refitLauncher(b, u, f, s) {
  if (u.glSpent && Object.values(u.glSpent).some((n) => n > 0)) { f.glSpent = { ...u.glSpent }; fitLauncher(b, f, s); }
  const was = u.gl;
  u.gl = f.gl;
  u.bombs = f.bombs;
  if (u.gl && was && was.key === u.gl.key && was.from === u.gl.from) { u.gl.mag = Math.min(u.gl.cap, was.mag); u.gl.load = was.load; }
  else if (u.gl && !u.gl.oneShot) u.gl.mag = 0;
  if (!u.gl) delete u.gl;
  if (s) OWNER.set(u, s);
}

// ---------- the enemy (combat.js enemyUnit; arsenal.js armFromArsenal) ----------
const resFor = (cal, r) => { const [lo, hi] = LAUNCH.RES[cal] || [1, 1]; return lo + Math.floor(r * (hi - lo + 1)); };
function enemyGl(key, n, item = null) {
  const W = WEAPONS[key];
  const cal = W.launcher;
  const base = CALIBERS[cal] ? CALIBERS[cal].base : "he";
  const g = { key, cal, cap: W.cap || 1, mag: 0, load: base, from: key === "m203" ? "under" : "weapon", aimD: 0, res: {} };
  if (W.oneShot) { g.oneShot = true; g.mag = 1; g.load = "heat"; return g; }
  g.mag = Math.min(g.cap, n);
  g.res[base] = Math.max(0, n - g.mag);
  if (item) g.item = true;
  return g;
}
// A KITS fighter (no group behind them): the M203 their rifle came with (gunmods.js enemyMods, u.gm.launcher) and 2–4
// HE; one soldier in LAUNCH.RPG battles at power 8+ with an RPG and a rocket or two. seed: the battle's dice
// position (read, never moved).
export function kitLauncher(b, u, kind, power, n, seed) {
  if (!u || u.kind !== "human") return;
  delete u.gl;
  if (u.gm && u.gm.launcher && u.gmWeapon === u.weapon) {
    u.gl = enemyGl("m203", resFor("40mm", hash01(seed, "glres", u.id)));
    return;
  }
  if (kind === "soldiers" && power >= LAUNCH.RPG_POWER && n === 1 && hash01(seed, "rpgbattle") < LAUNCH.RPG) {
    u.gl = enemyGl("rpg", resFor("rocket", hash01(seed, "rpgres", u.id)));
  }
}
// A group's fighter (arsenal.js armFromArsenal, lo: their loadout): the M203 on the rifle they were issued, else a
// launcher the issue gave them, with rounds out of the group's stores (taken now; what they do not fire goes back,
// settleArsenalLauncher).
export function armLauncher(state, b, u, f, lo) {
  delete u.gl;
  u.arsLauncher = null;
  const gun = u.arsItem;
  const take = (cal) => {
    const key = ammoKey(cal, CALIBERS[cal].base);
    let want = LAUNCH.ARS[cal] || 1, n = 0;
    for (const rec of [f.arsenal && f.arsenal.rounds, f.stock]) { // the arsenal's own, then any by key in their stores
      if (!rec || want <= 0) continue;
      const q = Math.min(want, Math.max(0, Math.floor(num(rec[key]))));
      if (q > 0) { rec[key] -= q; n += q; want -= q; }
    }
    return n;
  };
  if (underOf(gun)) {
    const n = take("40mm");
    if (n > 0) { u.gl = enemyGl("m203", n); u.gl.drawn = n; }
    return;
  }
  const L = lo && lo.launcher;
  if (!L || !isLauncherKey(L.key)) return;
  const W = WEAPONS[L.key];
  const n = W.oneShot ? 1 : take(W.launcher);
  if (n <= 0) return; // no rounds for it in their stores: left at home
  u.gl = enemyGl(L.key, n);
  if (!W.oneShot) u.gl.drawn = n;
  u.arsLauncher = L;
}
// After a fight (arsenal.js settleArsenal), one of their fighters: the rounds they did not fire back in the stores
// (f.arsenal.rounds) unless they died where you hold the field (then they are on the body). Returns the launcher item still theirs to
// count with the kit (null: none, or a fired AT4, struck off here). remove(it, why): arsenal.js removeFromArsenal.
export function settleArsenalLauncher(f, u, lost, remove) {
  const g = u.gl;
  if (!lost && g && g.drawn && !g.oneShot) {
    const key = ammoKey(g.cal, CALIBERS[g.cal].base);
    const left = g.mag + ((g.res && g.res[CALIBERS[g.cal].base]) || 0);
    if (left > 0 && f.arsenal) { const R = f.arsenal.rounds || (f.arsenal.rounds = {}); R[key] = num(R[key]) + left; }
  }
  const L = u.arsLauncher;
  if (!L || !f.arsenal || !f.arsenal.items.includes(L)) return null;
  if (u.glSpent && u.glSpent[L.key] > 0) { remove(L, "fired"); return null; }
  return L;
}

// ---------- firing ----------
// An enclosed cell (a room: a building's floor, a building map's interior, a base's buildings): a rocket fired from
// here hurts its shooter.
export function enclosedAt(b, x, y) {
  if (b.raid && b.raid.interior) return true;
  if (b.tier && b.tier.indoor && b.tier.indoor[y * b.w + x]) return true;
  const c = cellOf(b, x, y);
  return !!c && c.f === "floor";
}
// The cells behind a rocket's shooter (its backblast) when it fires at (x, y).
export function backblastCells(b, u, x, y) {
  const out = [];
  const ang = Math.atan2(u.y - y, u.x - x); // pointing backward
  const R = LAUNCH.BACK.r;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const cx = u.x + dx, cy = u.y + dy;
    if ((!dx && !dy) || !inside(b, cx, cy) || Math.hypot(dx, dy) > R + 0.01) continue;
    let da = Math.abs(Math.atan2(dy, dx) - ang);
    if (da > Math.PI) da = 2 * Math.PI - da;
    if (da <= (LAUNCH.BACK.cone * Math.PI) / 180 + 1e-6) out.push([cx, cy]);
  }
  return out;
}
const inCells = (cells, x, y) => cells.some(([cx, cy]) => cx === x && cy === y);
// The unit's aim with its launcher (its aim with the gun in its hands, + what the launcher's own skill needs).
export const glAim = (u) => (u.aim ?? 40) + ((u.gl && u.gl.aimD) || 0);
const direct = (b, g) => g.cal === "rocket" || g.load === "buck" || !!(b.raid && b.raid.interior);
// Why u cannot launch at (x, y) now ("" when it can).
export function launchRefusal(b, u, x, y) {
  const g = u && u.gl;
  if (!g) return "No launcher.";
  if (!active(u)) return "That unit cannot act.";
  if (u.aboard || u.gunner) return "Get out of the vehicle first.";
  if (u.carrying != null || u.dragging != null || (u.ram != null && b.rams && isCrew(b, u))) return "Hands full.";
  if (!Number.isFinite(x) || !Number.isFinite(y) || !inside(b, x, y)) return "Fire it where?";
  if (x === u.x && y === u.y) return "Not at your own feet.";
  if (g.mag < 1) return g.oneShot ? "The tube is spent." : `The ${glWord(g)} is empty: reload it (1 action).`;
  if (u.side === "player" && !g.oneShot && glRounds(b, u, g.load) < 1) return `No ${roundLabel(g.load)} rounds left for the ${glWord(g)}.`;
  const d = dist(u.x, u.y, x, y);
  const range = g.load === "buck" ? LAUNCH.BUCK.range : glRange(g);
  if (d > range + 0.01) return `Too far: the ${glWord(g)} ${g.load === "buck" ? "fires buckshot" : "reaches"} ${range} tiles.`;
  if (g.load === "buck") {
    const t = unitAt(b, x, y);
    if (!t || t.side === u.side || !active(t)) return "Buckshot needs someone to fire at.";
  }
  if (direct(b, g)) { if (!canSeeAt(b, u, x, y)) return g.cal === "rocket" ? "No line of sight: a rocket flies straight." : "No line of sight (indoors there is no lobbing over)."; }
  else if (throwBlind(b, u, x, y) === null) return "Nobody can see there: a grenade over a wall lands only where you or a teammate has eyes (or where an enemy was last seen).";
  return "";
}
// The first cell a straight flight from (x0, y0) to (x1, y1) cannot pass (los's test), or the end cell.
function flightEnd(b, x0, y0, x1, y1) {
  if (los(b, x0, y0, x1, y1)) return [x1, y1];
  const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 4);
  let px = x0, py = y0;
  for (let i = 1; i <= n; i++) {
    const cx = Math.floor(x0 + 0.5 + ((x1 - x0) * i) / n), cy = Math.floor(y0 + 0.5 + ((y1 - y0) * i) / n);
    if ((cx === px && cy === py) || (cx === x0 && cy === y0)) continue;
    if (!los(b, x0, y0, cx, cy)) return [cx, cy];
    px = cx; py = cy;
  }
  return [x1, y1];
}
// The hearing module (section 18, w2-helmets: hearing.js deafen(b, x, y, bang, shooter) and HEAR.BLAST { he40, rocket })
// registers itself here at its load (registerHearing({ deafen, HEAR }), also exported by throwables.js),
// synchronously, so every run deafens the same (a dynamic import would land at a different moment in each process).
// Until then nothing happens. Blasts: HEAR.BLAST.he40 / .rocket (else GL_HE / ROCKET bang); a rocket's launch: the
// shooter at their own cell.
// The registry lives in a hoisted function's box, so hearing.js can register at its own load even when an import cycle
// evaluates it before this module (a plain const would still be in its temporal dead zone then).
function hearingBox() { return hearingBox.box || (hearingBox.box = { deafen: null, HEAR: null }); }
export const HEARING = hearingBox();
export function registerHearing(m) { if (m && typeof m.deafen === "function") { const H = hearingBox(); H.deafen = m.deafen; H.HEAR = m.HEAR || null; } }
export const blastBang = (B) => { const H = HEARING.HEAR && HEARING.HEAR.BLAST; const k = B === ROCKET ? "rocket" : "he40"; return H && Number.isFinite(H[k]) ? H[k] : B.bang; };
export function deafenAt(b, x, y, bang, shooter) {
  if (typeof HEARING.deafen !== "function") return;
  try { HEARING.deafen(b, x, y, bang, shooter); } catch { /* the hearing module's own business */ }
}
// Fire it (check launchRefusal first): the round, the backblast, where it comes down and what it does there. Ends the
// unit's turn (like a shot). Returns [x, y] where it came down.
export function launch(b, u, x, y) {
  const g = u.gl;
  const W = WEAPONS[g.key];
  const type = g.load;
  g.mag -= 1;
  if (!g.oneShot && u.side === "player") takeRound(b, u, type); // your side's round leaves the pools now (the magazine is a counter); theirs was in it
  u.ap = 0;
  u.hunker = false; u.ow = false;
  u.face = [Math.sign(x - u.x), Math.sign(y - u.y)];
  if (u.xpT) u.xpT.shots++;
  // The launch itself: its noise, its Heat; a rocket's bang at the shooter and its backblast.
  b.noise = (b.noise || 0) + (W.noise || 3);
  if (b.raid) b.raid.heat = Math.min(100, b.raid.heat + (LAUNCH.HEAT[g.cal] || 0));
  alertNear(b, u.x, u.y, 9 + (W.noise || 3) * 2, "The launch carries.");
  const who = glWord(g);
  const parts = [];
  if (g.cal === "rocket") {
    deafenAt(b, u.x, u.y, blastBang(ROCKET), u);
    parts.push(...backblast(b, u, x, y));
  }
  let lx = x, ly = y, off = false;
  const kind = LAUNCH_ROUNDS[type] || "blast";
  if (kind === "buck") {
    buckShot(b, u, unitAt(b, x, y), who);
    finishLaunch(b, u, g);
    return [x, y];
  }
  const shooter = { ...u, aim: glAim(u) };
  if (direct(b, g)) {
    [lx, ly, off] = throwLanding(b, shooter, { scatter: LAUNCH.SCATTER }, x, y, false);
    [lx, ly] = flightEnd(b, u.x, u.y, lx, ly);
  } else [lx, ly, off] = throwLanding(b, shooter, { scatter: LAUNCH.SCATTER }, x, y, throwBlind(b, u, x, y));
  fx(b, g.cal === "rocket" ? { type: "shot", from: [u.x, u.y], to: [lx, ly], hit: true, side: u.side, rocket: true } : { type: "throw", from: [u.x, u.y], to: [lx, ly], item: type === "smoke" ? "smokegren" : type === "illum" ? "flare" : "frag" });
  const short = lx !== x || ly !== y ? (off ? " It lands a tile off." : " Something in the way stops it short.") : "";
  let what = "";
  if (kind === "smoke") what = landEffect(b, u, { fx: "smoke" }, lx, ly);
  else if (kind === "flare") { (b.flares || (b.flares = [])).push({ x: lx, y: ly, r: ILLUM.r, turns: ILLUM.turns }); what = `A flare hangs over it: everything within ${ILLUM.r} tiles is lit.`; }
  else if (dist(u.x, u.y, lx, ly) < LAUNCH.ARM - 1e-6) what = dud(b, u, lx, ly, g);
  else {
    const B = g.cal === "rocket" ? ROCKET : GL_HE;
    what = landEffect(b, u, { fx: "blast", blast: B }, lx, ly);
    deafenAt(b, lx, ly, blastBang(B));
  }
  say(b, `${u.name} fires the ${who}${g.cal === "rocket" ? "" : ` (${roundLabel(type)})`}.${short} ${what}${parts.length ? ` Backblast: ${parts.join(", ")}.` : ""}`.replace(/\s+/g, " ").trim(), u.side === "enemy" ? "danger" : "good");
  finishLaunch(b, u, g);
  return [lx, ly];
}
function finishLaunch(b, u, g) {
  if (g.oneShot) {
    (u.glSpent || (u.glSpent = {}))[g.key] = ((u.glSpent || {})[g.key] || 0) + 1;
    delete u.gl;
  }
  if (b.rev != null) b.rev++;
}
// Inside the arming range: no blast, a slug on whoever stands there.
function dud(b, u, x, y, g) {
  const t = unitAt(b, x, y);
  if (!t || !active(t)) return `It does not arm inside ${LAUNCH.ARM} tiles: the ${g.cal === "rocket" ? "rocket" : "grenade"} thumps down, harmless.`;
  const eff = Math.round(damage(b, t, b.rng.int(LAUNCH.DUD[0], LAUNCH.DUD[1]), u, false, { how: "bash" }));
  fx(b, { type: "melee", from: [u.x, u.y], to: [t.x, t.y], hit: true, crit: false, dmg: eff, side: u.side, text: "DUD" });
  return `It does not arm inside ${LAUNCH.ARM} tiles: it hits ${t.name} like a brick (${eff}${t.dead ? ", dead" : t.down ? ", down" : ""}).`;
}
// 40 mm canister: a shotgun shot at someone (LAUNCH.BUCK), its own odds.
function buckShot(b, u, t, who) {
  if (!t) return;
  const B = LAUNCH.BUCK;
  const d = dist(u.x, u.y, t.x, t.y);
  const cover = coverAgainst(b, t.x, t.y, u.x, u.y).level;
  const chance = clamp(Math.round(glAim(u) + B.aim - COVER_DEF[cover] - Math.max(0, d - B.opt) * B.fall), 5, 95);
  fx(b, { type: "shot", from: [u.x, u.y], to: [t.x, t.y], hit: true, side: u.side });
  if (!b.rng.chance(chance / 100)) { say(b, `${u.name} fires buckshot from the ${who} at ${t.name} and misses (${chance}%).`, "info"); return; }
  // Its buckshot spreads with range like a shotgun's (data-ammo.js spreadMult; its floor: a .22's hit over its own mean).
  const sm = spreadMult("buck", d, { base: (B.dmg[0] + B.dmg[1]) / 2 });
  const eff = Math.round(damage(b, t, b.rng.int(B.dmg[0], B.dmg[1]) * sm, u, false, { how: "shot", cal: "12ga", ammo: "buck", pen: 10, spread: true })); // a canister of buckshot: armour takes it like a shotgun's
  if (u.xpT && t.side !== u.side) { u.xpT.hits++; if (t.dead) u.xpT.kills++; }
  fx(b, { type: "melee", from: [u.x, u.y], to: [t.x, t.y], hit: true, crit: false, dmg: eff, side: u.side, text: `-${eff}` });
  say(b, `${u.name} fires buckshot from the ${who}: ${t.name} takes ${eff}${t.dead ? " and drops" : ""} (${chance}%${sm < 1 ? `, spread ×${Math.round(sm * 100) / 100}` : ""}).`, u.side === "enemy" ? "danger" : "good");
}
// The backblast: anyone in the cone behind takes 10–20; a shooter in a room takes 8–14 and loses their next action.
function backblast(b, u, x, y) {
  const cells = backblastCells(b, u, x, y);
  const out = [];
  for (const t of b.units) {
    if (t === u || !active(t) || !inCells(cells, t.x, t.y)) continue;
    const eff = Math.round(damage(b, t, b.rng.int(LAUNCH.BACK.dmg[0], LAUNCH.BACK.dmg[1]), u, false, { how: "blast" }));
    blastHit(b, t, eff);
    fx(b, { type: "melee", from: [t.x, t.y], to: [t.x, t.y], hit: true, crit: false, dmg: eff, side: u.side, text: "BACKBLAST" });
    out.push(`${t.name} ${eff}${t.dead ? " (dead)" : t.down ? " (down)" : ""}`);
  }
  if (enclosedAt(b, u.x, u.y)) {
    const eff = Math.round(damage(b, u, b.rng.int(LAUNCH.BACK.self[0], LAUNCH.BACK.self[1]), null, false, { how: "blast" }));
    blastHit(b, u, eff);
    if (active(u)) u.reel = { next: nextTurnOf(b, u), why: "the backblast in the room" };
    out.push(`${u.name} ${eff}, fired in a room (−1 action next turn)`);
  }
  return out;
}
// Reload: 1 action (a type to switch to, or the loaded one / the best to hand).
export function glReloadRefusal(b, u, type = null) {
  const g = u && u.gl;
  if (!g) return "No launcher.";
  if (g.oneShot) return "A rocket tube is its own round: it cannot be reloaded.";
  if (!active(u) || u.ap < 1) return "That unit cannot act.";
  if (u.carrying != null || u.dragging != null) return "Hands full.";
  const t = type || g.load;
  if (CALIBERS[g.cal] && !CALIBERS[g.cal].types.includes(t)) return `The ${glWord(g)} takes no such rounds.`;
  const sw = t !== g.load;
  if (!sw && g.mag >= g.cap) return `The ${glWord(g)} is loaded (${g.cap}/${g.cap}).`;
  const have = glRounds(b, u, t);
  if (have < 1) return `No ${roundLabel(t)} rounds for the ${glWord(g)}.`;
  if (!sw && u.side === "player" && have <= g.mag) return `No spare ${roundLabel(t)} rounds: every one is loaded.`;
  return "";
}
export function glReload(b, u, type = null) {
  const g = u.gl;
  const t = type || g.load;
  if (t !== g.load) { if (u.side !== "player" && g.res) g.res[g.load] = (g.res[g.load] || 0) + g.mag; g.load = t; g.mag = 0; }
  if (u.side === "player") g.mag = Math.min(g.cap, glRounds(b, u, t));
  else { const n = Math.min(g.cap - g.mag, glRounds(b, u, t)); g.mag += n; g.res[t] -= n; }
  u.ap -= 1;
  u.hunker = false;
  say(b, `${u.name} reloads the ${glWord(g)} (${g.mag}/${g.cap} ${roundLabel(t)}).`, "info");
}

// ---------- explosions vs gear (section 24) ----------
// Everyone a blast hits (throwables.js hurtAll, a backblast, a vehicle's riders): their tally of blast damage (their
// gear's wear when they are searched or the fight ends), and 10% of the time a frag, pipe bomb or Molotov they carry
// goes off at their cell (queued: throwables.js landEffect sets them off after the blast that did it).
export function blastHit(b, t, eff) {
  if (!t || t.kind !== "human" || !(eff >= 0)) return;
  t.blastDmg = Math.round(((t.blastDmg || 0) + eff) * 10) / 10;
  t.blastN = (t.blastN || 0) + 1;
  const carried = t.side === "player" ? t.bombs || {} : t.throwables || {};
  const keys = BOMBS.filter((k) => carried[k] > 0);
  if (!keys.length) return;
  if (hash01("cookoff", b.dseed ?? 0, t.id, t.blastN, b.turn || 0) >= LAUNCH.COOK_THROW) return;
  const key = keys[Math.floor(hash01("cookkey", t.id, t.blastN) * keys.length) % keys.length];
  carried[key] -= 1;
  if (t.side === "player") {
    const s = OWNER.get(t);
    const it = s ? findCarried(s, key) : null;
    if (it) it.take(); else (t.cooked || (t.cooked = [])).push(key);
  }
  (b.cookQueue || (b.cookQueue = [])).push({ x: t.x, y: t.y, key, who: t.name });
}
// The carried bombs a blast set off (throwables.js landEffect, after the blast). Each is a blast or a fire of its own
// at the carrier's cell (which can set off more: a chain, at most 6).
export function cookOffs(b) {
  const out = [];
  for (let n = 0; b.cookQueue && b.cookQueue.length && n < 6; n++) {
    const c = b.cookQueue.shift();
    const T = { fx: c.key === "frag" ? "frag" : c.key === "pipebomb" ? "blast" : "fire" };
    out.push(`The ${GEAR[c.key] ? GEAR[c.key].name.toLowerCase() : c.key} ${c.where || `on ${c.who}`} goes off! ${landEffect(b, null, T, c.x, c.y)}`);
  }
  if (b.cookQueue) b.cookQueue = [];
  return out.join(" ");
}
// The share of its condition every piece of gear on someone loses from the blasts that hit them (15–50% by the damage).
export const blastWearShare = (dmg) => LAUNCH.GEAR_WEAR[0] + (LAUNCH.GEAR_WEAR[1] - LAUNCH.GEAR_WEAR[0]) * clamp(num(dmg) / LAUNCH.GEAR_REF, 0, 1);
function wearShare(it, share) {
  const d = GEAR[it.key];
  if (!d || d.count) return false;
  const left = itemDur(it);
  if (left == null) return false;
  it.dur = Math.max(1, Math.round(left - Math.max(1, left * share))); // worn, never broken outright (the loot is there to see)
  if (it.mods) for (const m of Object.values(it.mods)) if (m) wearShare(m, share);
  return true;
}
// Rounds that cook off (0–40%): a box item's count, a record's rounds by key.
const cookShare = (...salt) => LAUNCH.COOK * hash01("cookrounds", ...salt);
function cookBox(it, ...salt) {
  const d = GEAR[it.key];
  if (!d || !d.count || !d.rounds || !(it.dur >= 1)) return;
  it.dur = Math.max(0, Math.floor(it.dur * (1 - cookShare(it.key, ...salt))));
}
function cookRecord(rec, ...salt) {
  for (const k of Object.keys(rec || {})) if (/^a_/.test(k) && rec[k] >= 1) rec[k] = Math.max(0, Math.floor(rec[k] * (1 - cookShare(k, ...salt))));
}
// Every item of a person or a body (inventory.js allCarried: worn, held, pockets, the rig's pouches, the pack's
// contents, a carrier's plates; a gun's fitted parts and a helmet's mounts go with it: wearShare). A pile: its items.
const everyItem = (holder) => deepItems(Array.isArray(holder) ? holder : holder && holder.gear ? allCarried(holder) : []);
// The items and what they hold (a rig's pouches, a pack's slots, a carrier's plates), each once.
function deepItems(list) {
  const out = [], seen = new Set();
  const walk = (it) => {
    if (!it || seen.has(it)) return;
    seen.add(it); out.push(it);
    if (Array.isArray(it.contents)) for (const c of it.contents) walk(c);
    if (isCarrier(it)) for (const p of Object.values(insertsOf(it))) walk(p);
  };
  for (const it of list || []) walk(it);
  return out;
}
// A body (inventory.js enemyBody's, or a raid body's contents { sup, gear }) of someone the blasts hit: its gear worn
// by the blast damage, its rounds cooked off. u: the unit it was. Changes it in place.
export function blastLoot(b, u, body) {
  if (!u || !(u.blastDmg > 0 || u.groundWear > 0) || !body) return body;
  const share = Math.max(u.blastDmg > 0 ? blastWearShare(u.blastDmg) : 0, u.groundWear || 0); // hit alive, or lying dead where a blast went off (groundBlast)
  const items = everyItem(Array.isArray(body.gear) ? body.gear : body);
  for (const it of items) { wearShare(it, share); cookBox(it, u.id, "body"); }
  cookRecord(body.supplies || body.sup, u.id, "body");
  return body;
}

// ---------- bodies: the launcher and its rounds (combat.js endBattle, searchBox) ----------
// What the dead fought with besides their gun: the launcher (a group's own item; a fired AT4 is gone; the M203 is on
// the rifle already), the rounds they did not fire, and now and then a dead soldier's M79. Into a body (gear slots) or
// a raid body's contents ({ sup, gear }). src: itemcond.js source.
export function launcherLoot(u, src = "military") {
  const out = { gear: [], sup: {} };
  if (!u || u.kind !== "human") return out;
  const g = u.gl;
  if (g) {
    if (g.key !== "m203" && !(g.oneShot && g.mag < 1)) out.gear.push(u.arsLauncher && u.arsLauncher.key === g.key ? u.arsLauncher : lootItem(g.key, src, [u.id, "gl"]));
    if (!g.oneShot) {
      const left = g.mag + Object.values(g.res || {}).reduce((a, n) => a + num(n), 0);
      if (left > 0) out.sup[ammoKey(g.cal, CALIBERS[g.cal].base)] = left;
    }
  }
  if (u.kit === "soldiers" && hash01("m79body", u.id, u.name) < LAUNCH.M79_BODY) {
    out.gear.push(lootItem("m79", src, [u.id, "m79"]));
    out.sup.a_40mm_he = (out.sup.a_40mm_he || 0) + 2 + Math.floor(hash01("m79he", u.id) * 3);
  }
  return out;
}
// The same onto an inventory.js body (the hands first, then the off hand; rounds into its supplies) and the blast's
// wear on everything. Returns the body.
export function launcherBody(b, u, body) {
  if (!body || !u) return body;
  if (u.who && !u.kitGl) return blastLoot(b, u, body); // fighters.js: a person's launcher and rounds are on their body already
  const L = launcherLoot(u, u.kit === "soldiers" ? "military" : "raider");
  for (const it of L.gear) {
    if (!body.gear.weapon) body.gear.weapon = it;
    else if (!body.gear.tool) body.gear.tool = it;
  }
  for (const [k, n] of Object.entries(L.sup)) body.supplies[k] = (body.supplies[k] || 0) + n;
  return blastLoot(b, u, body);
}

// ---------- your people when the fight ends (combat.js wearFielded) ----------
// The AT4s fired leave the survivor; carried bombs that cooked off after a load leave too; the blasts' wear on what
// they carry and their boxes' cook-off.
export function launcherBattleEnd(state, b) {
  for (const u of b.units) {
    if (u.side !== "player" || u.sid == null) continue;
    const s = (state.survivors || []).find((x) => x.id === u.sid);
    if (!s) continue;
    for (const [key, n] of Object.entries(u.glSpent || {})) for (let i = 0; i < n; i++) { const c = findCarried(s, key); if (c) c.take(); }
    for (const key of u.cooked || []) { const c = findCarried(s, key); if (c) c.take(); }
    u.glSpent = {}; u.cooked = [];
    if (u.blastDmg > 0 && s.alive !== false) {
      const share = blastWearShare(u.blastDmg);
      for (const it of everyItem(s)) { wearShare(it, share); cookBox(it, u.id, "mine", b.turn || 0); }
      u.blastDmg = 0;
    }
  }
}

// ---------- the team's vehicle blown up (combat.js vehicleBlast, settleVehicle) ----------
// When a vehicle's blast wear this fight reaches its condition, it is blown up: its riders take the blast in full
// (vehicleBlast), and after the fight (settleVehicle) 50–80% of what is in its cargo is gone and everything left with
// a condition is worn 20–60%. party: the team; salt: anything for the dice. Returns a log line or "".
export function blownUpCargo(state, b, party) {
  const v = b && b.vehicle;
  if (!v || !party || !party.cargo || v.cargoDone) return "";
  if (!v.blownUp) return cargoShaken(state, b, party);
  v.cargoDone = true;
  const salt = [state.seed, "blownup", party.id, b.turn || 0];
  const [l0, l1] = LAUNCH.CARGO_LOST, [w0, w1] = LAUNCH.CARGO_WEAR;
  const share = l0 + (l1 - l0) * hash01(...salt, "share");
  const gear = party.cargo.gear || [];
  const keep = [];
  let lost = 0;
  gear.forEach((it, i) => {
    if (!it) return;
    if (hash01(...salt, "item", i) < share) { lost++; return; }
    if (itemDurMax(it)) wearShare(it, Math.max(v.cargoWear || 0, w0 + (w1 - w0) * hash01(...salt, "wear", i)));
    cookBox(it, ...salt, i);
    keep.push(it);
  });
  party.cargo.gear = keep;
  let sup = 0;
  for (const [k, q] of Object.entries(party.cargo.supplies || {})) {
    if (!(q >= 1)) continue;
    const gone = Math.floor(q * share);
    party.cargo.supplies[k] = q - gone;
    sup += gone;
  }
  return `The ${v.mil ? "Army truck" : v.kind} was blown up: ${lost} of the ${gear.length} things in its cargo ${lost === 1 ? "is" : "are"} gone${sup ? ` and ${sup} of its supplies` : ""}; the rest is knocked about.`;
}
// A blast that reached the vehicle without blowing it up (groundBlast: v.cargoWear, by how close): what is in its
// cargo is worn by that share, its rounds cook off, and an explosive in it may go off (it did, in the fight: gone).
function cargoShaken(state, b, party) {
  const v = b.vehicle;
  if (!(v.cargoWear > 0)) return "";
  v.cargoDone = true;
  const salt = [state.seed, "cargoshake", party.id, b.turn || 0];
  const gear = party.cargo.gear || [];
  let n = 0;
  party.cargo.gear = gear.filter((it, i) => {
    if (!it) return false;
    if (BOMBS.includes(it.key) && hash01(...salt, "chain", i) < GROUND.CHAIN) return false;
    if (wearShare(it, v.cargoWear)) n++;
    cookBox(it, ...salt, i);
    return true;
  });
  cookRecord(party.cargo.supplies, ...salt);
  return n ? `The blasts next to the ${v.mil ? "Army truck" : v.kind} knocked about what is in it (${n} thing${n === 1 ? "" : "s"} worn).` : "";
}

// ---------- explosions vs what lies on the ground (the user's rule) ----------
// Everything lying within a blast (frag, pipe bomb, 40 mm, rocket: each at its own radius) is worn by how close it
// was: on the cell it went off in 30–60% of its condition, in the splash 10–35% (less the further off). Rounds lying
// there cook off 0–40%, an explosive lying there goes off one time in ten (a chain: throwables.js landEffect sets them
// off after the blast), and a rocket landing on (or next to) a crate, shelf, cabinet or counter blows it open: its
// contents spill out (unlocked), with the damage done. What it reaches: a raid's containers and bodies (their contents
// now, or once rolled: box.blast, blastBox), the dead lying on a battle map (u.groundWear: their body's loot,
// blastLoot), a thrown spear, the weapons dropped by those who gave up, the cargo of the team's vehicle.
export const GROUND = { impact: [0.3, 0.6], splash: [0.1, 0.35], CHAIN: 0.1, SPILL: ["crate", "shelf", "cabinet", "counter", "barrel"] };
// The share for something d tiles from the blast's cell (onCell: on it).
export function groundShare(d, r, onCell, ...salt) {
  const h = hash01("groundwear", ...salt);
  if (onCell) return GROUND.impact[0] + (GROUND.impact[1] - GROUND.impact[0]) * h;
  const near = clamp(1 - (Math.max(1, d) - 1) / Math.max(0.5, r), 0, 1);
  return GROUND.splash[0] + (GROUND.splash[1] - GROUND.splash[0]) * clamp(near * (0.8 + 0.2 * h), 0, 1);
}
const both = (a, s) => Math.min(0.95, 1 - (1 - (a || 0)) * (1 - s)); // two blasts: what is left of the first, worn again
// Items and rounds lying together (a container's contents): worn, cooked off; explosives may go off (where: the log's
// "in the crate"). Returns the items still there.
function blastStuff(b, gear, sup, share, at, where, salt, chain = true) {
  const keep = [];
  (gear || []).forEach((it, i) => {
    if (!it) return;
    if (chain && BOMBS.includes(it.key) && hash01("groundchain", ...salt, it.key, i) < GROUND.CHAIN) { (b.cookQueue || (b.cookQueue = [])).push({ x: at[0], y: at[1], key: it.key, where }); return; }
    wearShare(it, share);
    cookBox(it, ...salt, i);
    deepItems([it]).slice(1).forEach((c, j) => { wearShare(c, share); cookBox(c, ...salt, i, "in", j); }); // a rig's pouches, a pack's slots, a carrier's plates
    keep.push(it);
  });
  if (sup) cookRecord(sup, ...salt);
  return keep;
}
const boxCells = (c) => { const out = []; for (let y = c.y; y < c.y + (c.h || 1); y++) for (let x = c.x; x < c.x + (c.w || 1); x++) out.push([x, y]); return out; };
// Fire on what lies on the ground (ground.js groundFire: a pile on a burning cell, each turn it burns): what burns
// (woodcutting.js burnShare half or more: wood, cloth, paper, a pack and what is in it) is gone, the rest is worn by
// the heat like a blast's wear on the cell (GROUND.impact), boxed rounds and loose rounds cook off (cookBox,
// cookRecord); food, meds, firewood, fuel, arrows, powder and primers burn. Returns { gear (what is left), lost }.
export const GROUND_FIRE = { BURN_AT: 0.5, SUPPLIES: ["food", "preserved", "meds", "wood", "fuel", "arrows", "powder", "blackpowder", "primers", "matchprimers"] };
export function fireStuff(gear, sup, ...salt) {
  const keep = [];
  let lost = 0;
  (gear || []).forEach((it, i) => {
    if (!it) return;
    if (burnShare(it.key) >= GROUND_FIRE.BURN_AT || BOMBS.includes(it.key)) { lost++; return; } // a bomb past FIRE_COOK_N.CAP: it burns (the rest went off: cookFrom first)
    const share = GROUND.impact[0] + (GROUND.impact[1] - GROUND.impact[0]) * hash01("groundfire", ...salt, it.key, i);
    for (const c of deepItems([it])) { wearShare(c, share); cookBox(c, ...salt, i); }
    if (Array.isArray(it.contents)) it.contents.forEach((c, j) => { if (c && burnShare(c.key) >= GROUND_FIRE.BURN_AT) { it.contents[j] = null; lost++; } }); // a pouch's or a case's burnables
    keep.push(it);
  });
  if (sup) {
    cookRecord(sup, ...salt);
    for (const k of Object.keys(sup)) if ((GROUND_FIRE.SUPPLIES.includes(k) || FOODS[k]) && sup[k] > 0) { lost += Math.floor(sup[k]); delete sup[k]; } // food of every kind burns (foods.js)
  }
  return { gear: keep, lost };
}
// ---------- explosives in a fire (the user's call: grenades in fire explode) ----------
// What goes off in the flames, by item or round key, and what it does where it lies (throwables.js landEffect, the
// same as thrown or fired there): a frag or pipe bomb blasts (units, gear on the ground, cover, vehicles), a Molotov
// starts a fire, a smoke grenade smokes, a flashbang flashes, a road flare lights up; a 40 mm HE round and a rocket
// blast with their own tables, 40 mm smoke smokes, 40 mm illumination lights up. Canister rounds and boxed rifle
// rounds cook off as before (cookRecord, cookBox: lost, nothing more).
export const FIRE_COOK = {
  frag: { fx: "frag" }, pipebomb: { fx: "blast" }, molotov: { fx: "fire" }, smokegren: { fx: "smoke" }, flashbang: { fx: "flash" }, flare: { fx: "flare" },
  a_40mm_he: { fx: "blast", blast: GL_HE }, a_rocket_heat: { fx: "blast", blast: ROCKET }, a_40mm_smoke: { fx: "smoke" }, a_40mm_illum: { fx: "illum" },
};
// FIRE.TURN: how many go off at each burn tick (the start of each side's turn); the rest go at the next one, so a crate
// of grenades is a string of blasts, not one frame. FIRE.CAP: at most this many from one pile or body (the rest burn).
export const FIRE_COOK_N = { TURN: 2, CAP: 12 };
const cookName = (k) => (k === "a_40mm_he" ? "40 mm grenade" : k === "a_rocket_heat" ? "rocket" : k === "a_40mm_smoke" ? "40 mm smoke round" : k === "a_40mm_illum" ? "40 mm flare round" : GEAR[k] ? GEAR[k].name.toLowerCase() : k);
// How many go off for an item (a box of launcher rounds: one a round; anything else: one).
const cookCount = (it) => (GEAR[it.key] && GEAR[it.key].count ? Math.max(0, Math.floor(it.dur || 0)) : 1);
function queueCook(b, key, n, x, y, where, left) {
  const q = b.fireCook || (b.fireCook = []);
  let k = 0;
  for (; k < n && left.n > 0; k++, left.n--) q.push({ key, x, y, where });
  return k;
}
// The explosives in what lies on a burning cell (gear: an item list, deep: a bag's contents, a rig's pouches; sup: a
// supply record), taken out and queued to go off there. Returns how many were queued.
export function cookFrom(b, gear, sup, x, y, where) {
  if (!b) return 0;
  const left = { n: FIRE_COOK_N.CAP };
  let n = 0;
  const walk = (arr) => {
    for (let i = 0; i < (arr || []).length; i++) {
      const it = arr[i];
      if (!it) continue;
      if (FIRE_COOK[it.key]) { n += queueCook(b, it.key, cookCount(it), x, y, where, left); arr[i] = null; continue; }
      if (Array.isArray(it.contents)) walk(it.contents);
    }
  };
  walk(gear);
  if (Array.isArray(gear)) for (let i = gear.length - 1; i >= 0; i--) if (!gear[i]) gear.splice(i, 1); // a list closes up (a bag's slots stay)
  for (const k of Object.keys(sup || {})) if (FIRE_COOK[k] && sup[k] >= 1) { n += queueCook(b, k, Math.floor(sup[k]), x, y, where, left); delete sup[k]; }
  return n;
}
// A body burning (carriers.js burnBody): the grenades, bombs and launcher rounds on it go off in turn. A body searched
// in the fight: what is left in its container; otherwise what the fighter carried (the enemy's counts and launcher
// rounds; one of yours: their kit, a bag in the arms too). Returns how many were queued.
export function cookBody(b, t) {
  if (!b || !t) return 0;
  const where = `on ${t.name}'s burning body`;
  const boxes = b.raid ? b.raid.containers : b.fieldLoot ? b.fieldLoot.containers : [];
  const box = boxes.find((c) => c.kind === "body" && c.uid === t.id && c.contents);
  if (box) return cookFrom(b, box.contents.gear, box.contents.sup, t.x, t.y, where);
  const left = { n: FIRE_COOK_N.CAP };
  let n = 0;
  if (t.side === "player") {
    const s = OWNER.get(t);
    if (s && s.gear) for (const it of deepItems(allCarried(s))) if (FIRE_COOK[it.key]) n += queueCook(b, it.key, cookCount(it), t.x, t.y, where, left); // their things burn with them anyway (claimFallen)
  } else {
    for (const [k, c] of Object.entries(t.throwables || {})) if (FIRE_COOK[k] && c > 0) n += queueCook(b, k, c, t.x, t.y, where, left);
    t.throwables = {};
    const g = t.gl;
    if (g) {
      const key = g.cal === "rocket" ? "a_rocket_heat" : `a_40mm_${g.load || "he"}`;
      if (FIRE_COOK[key]) n += queueCook(b, key, Math.max(0, (g.mag || 0) + (g.res || 0)), t.x, t.y, where, left);
      delete t.gl;
    }
  }
  return n;
}
// The queued cook-offs go off (carriers.js burnUnderFire, after the burning piles and bodies): FIRE_COOK_N.TURN at a
// time, each with its own log line. Returns the lines.
export function fireCookOffs(b) {
  const out = [];
  for (let i = 0; b.fireCook && b.fireCook.length && i < FIRE_COOK_N.TURN && !b.over; i++) {
    const c = b.fireCook.shift();
    const T = FIRE_COOK[c.key];
    if (!T) continue;
    fx(b, { type: "cookoff", from: [c.x, c.y], to: [c.x, c.y], item: c.key, hit: true, text: T.fx === "fire" ? "WHOOMPH" : T.fx === "smoke" || T.fx === "illum" || T.fx === "flare" ? "HISS" : "BOOM" });
    let what;
    if (T.fx === "illum") { (b.flares || (b.flares = [])).push({ x: c.x, y: c.y, r: ILLUM.r, turns: ILLUM.turns }); what = `A flare burns there: everything within ${ILLUM.r} tiles is lit.`; }
    else {
      what = landEffect(b, null, T, c.x, c.y);
      if (T.blast) deafenAt(b, c.x, c.y, blastBang(T.blast));
    }
    const line = `The fire sets off the ${cookName(c.key)} ${c.where}! ${what}`.replace(/\s+/g, " ").trim();
    say(b, line, "danger");
    out.push(line);
  }
  if (b.fireCook && !b.fireCook.length) delete b.fireCook;
  return out;
}
// A blast at (x, y) of radius r (heavy: a rocket) on what lies there. Returns how many things it reached.
export function groundBlast(b, x, y, r, heavy = false) {
  let n = 0;
  const salt0 = [b.dseed ?? 0, b.turn || 0, x, y];
  const floor = b.floor || 0;
  const field = !b.raid && b.fieldLoot ? b.fieldLoot.containers : []; // ground.js: a field battle's piles on the ground and bodies searched there
  for (const box of (b.raid ? b.raid.containers : field)) {
    if ((box.f || 0) !== floor || box.burnt) continue;
    let d = Infinity, on = false, at = [box.x, box.y];
    for (const [cx, cy] of boxCells(box)) { const dd = dist(cx, cy, x, y); if (dd < d) { d = dd; at = [cx, cy]; } if (cx === x && cy === y) on = true; }
    if (d > r + 1e-6) continue;
    const share = groundShare(d, r, on, ...salt0, "box", box.id);
    if (heavy && d <= 1 + 1e-6 && GROUND.SPILL.includes(box.kind) && !box.spilled) { box.spilled = true; if (box.lock) box.lock.open = true; box.label = `${box.label} (blown open)`; }
    if (box.contents) box.contents.gear = blastStuff(b, box.contents.gear, box.contents.sup, share, at, `in the ${String(box.label).toLowerCase()}`, [...salt0, box.id]);
    else box.blast = both(box.blast, share);
    n++;
  }
  for (const t of b.units) {
    if (b.raid || t.kind !== "human" || !t.dead || t.side === "player" || t.burnt || t.off || dist(t.x, t.y, x, y) > r + 1e-6) continue; // a raid's dead are its body containers (above)
    if (field.some((c) => c.kind === "body" && c.uid === t.id)) continue; // searched in the battle: its container (above)
    t.groundWear = both(t.groundWear, groundShare(dist(t.x, t.y, x, y), r, t.x === x && t.y === y, ...salt0, "dead", t.id));
    const carried = t.throwables || {};
    for (const k of BOMBS) if (carried[k] > 0 && hash01("deadchain", ...salt0, t.id, k) < GROUND.CHAIN) { carried[k] -= 1; (b.cookQueue || (b.cookQueue = [])).push({ x: t.x, y: t.y, key: k, where: `on ${t.name}'s body` }); }
    n++;
  }
  for (const sp of b.spears || []) {
    if ((sp.f || 0) !== floor || dist(sp.x, sp.y, x, y) > r + 1e-6) continue;
    const owner = b.units.find((o) => o.id === sp.owner);
    const it = sp.item || (owner && owner.spearOut && owner.spearOut.item);
    if (it) { wearShare(it, groundShare(dist(sp.x, sp.y, x, y), r, sp.x === x && sp.y === y, ...salt0, "spear", sp.owner)); n++; }
  }
  if (!b.raid) for (const d of b.nlDrops || []) {
    if (d.gone || dist(d.x, d.y, x, y) > r + 1e-6) continue;
    d.blast = both(d.blast, groundShare(dist(d.x, d.y, x, y), r, d.x === x && d.y === y, ...salt0, "drop", d.uid));
    n++;
  }
  const v = b.vehicle;
  if (v && v.kind !== "bike") {
    let d = Infinity, on = false;
    for (const [cx, cy] of boxCells(v)) { d = Math.min(d, dist(cx, cy, x, y)); if (cx === x && cy === y) on = true; }
    if (d <= r + 0.5 + 1e-6) { v.cargoWear = both(v.cargoWear, groundShare(d, r + 0.5, on, ...salt0, "cargo")); n++; }
  }
  return n;
}
// A raid container's contents rolled after a blast reached it (combat.js searchBox): the wear it took then.
export function blastBox(b, box) {
  if (!box || !(box.blast > 0) || !box.contents) return;
  box.contents.gear = blastStuff(b, box.contents.gear, box.contents.sup, box.blast, [box.x, box.y], "", [b.dseed ?? 0, "boxlate", box.id], false);
  delete box.blast;
}
// The piles of weapons the surrendered threw down (nonlethal.js nlDropPiles, in their order): a blast's wear on them.
export function blastPiles(b, piles) {
  const drops = (b.nlDrops || []).filter((d) => !d.gone);
  piles.forEach((pile, i) => { const d = drops[i]; if (d && d.blast > 0) for (const it of everyItem(pile)) wearShare(it, d.blast); });
  return piles;
}

// ---------- the wreck: a vehicle blown up is gone for good (the user's rule) ----------
// Condition 0 and destroyed: no garage, roadside, card, AI or autopilot repair restores it, no claim or recovery
// restarts it; it can be stripped for parts and scrap (vehicles.js stripVehicle at a base; a team that goes back to it
// strips it where it lies, parties.js recoverVehicle) and what is left of its cargo taken out. An M2 on it is lost.
export const isWrecked = (v) => !!(v && v.destroyed);

// ---------- the AI ----------
const foesOf = (b, u) => b.units.filter((t) => t.side !== u.side && active(t) && !t.off);
const friendsNear = (b, u, x, y, r) => b.units.some((m) => m.side === u.side && active(m) && dist(m.x, m.y, x, y) <= r + 1e-6);
const friendBehind = (b, u, x, y) => { const cells = backblastCells(b, u, x, y); return b.units.some((m) => m !== u && m.side === u.side && active(m) && inCells(cells, m.x, m.y)); };
// Structures and machines worth a rocket on their own (need 1): the other side's barred gate, doors and wall sections
// (a fort's holders' side), a battering ram, your vehicle (the enemy's), their Humvee (yours). [{ x, y, w }].
function siegeTargets(b, u) {
  const out = [];
  const holders = b.holders || "player";
  if (u.side !== holders && b.tier) {
    for (let i = 0; i < b.cells.length; i++) {
      const c = b.cells[i];
      if (!(c.hp > 0)) continue;
      const w = c.k === "gate" && c.bar ? 3 : c.k === "bdoor" ? 1.5 : c.k === "palisade" ? 1 : 0;
      if (w) out.push({ x: i % b.w, y: (i / b.w) | 0, w });
    }
  }
  for (const r of b.rams || []) {
    if (r.side === u.side || r.dropped || r.inVehicle) continue;
    const L = r.lead != null ? b.units.find((o) => o.id === r.lead) : null;
    if (L && active(L)) out.push({ x: L.x, y: L.y, w: 3.5 });
  }
  const rect = (R, w) => { for (let y = R.y; y < R.y + R.h; y++) for (let x = R.x; x < R.x + R.w; x++) out.push({ x, y, w }); };
  if (u.side === "enemy" && b.vehicle && b.vehicle.kind !== "bike") rect(b.vehicle, 2.5);
  if (u.side === "player" && b.raidHumvee) rect(b.raidHumvee, 2.5);
  return out;
}
// How far its own side must be from where the AI aims (the blast, + 1, + the most it can land off: a tile, two when
// lobbed blind past 5 tiles), so a launch never catches its own.
const clearOf = (b, u, g, blast) => blast.r + 1 + (direct(b, g) ? Math.SQRT2 : 2 * Math.SQRT2) + 0.05;
// The best place for this unit's launcher now: { x, y, n, why } or null. Never inside the arming range, never with
// one of its own side within the blast (+1), never a rocket with a friend in the backblast cone or from a room.
export function launchSpot(b, u) {
  const g = u.gl;
  if (!g || g.mag < 1) return null;
  const R = glRange(g);
  const blast = g.cal === "rocket" ? ROCKET : GL_HE;
  if (g.cal === "rocket") {
    if (enclosedAt(b, u.x, u.y)) return null;
    let best = null;
    for (const t of siegeTargets(b, u)) {
      const d = dist(u.x, u.y, t.x, t.y);
      if (d < LAUNCH.ARM + 0.5 || d > R) continue;
      const sc = t.w - d * 0.02;
      if (best && sc <= best.sc) continue;
      if (friendsNear(b, u, t.x, t.y, clearOf(b, u, g, blast)) || friendBehind(b, u, t.x, t.y) || !canSeeAt(b, u, t.x, t.y)) continue;
      best = { x: t.x, y: t.y, n: LAUNCH.AI_SIEGE, sc, why: "siege" };
    }
    if (best) return best;
  }
  if (g.load !== (CALIBERS[g.cal] ? CALIBERS[g.cal].base : "he")) return null; // the bots switch to HE first (aiLaunch)
  const spot = blastSpot(b, u, R, blast.r, { need: LAUNCH.AI_NEED, min: LAUNCH.ARM + 0.5, direct: direct(b, g), clear: clearOf(b, u, g, blast) });
  if (!spot) return null;
  if (g.cal === "rocket" && friendBehind(b, u, spot.x, spot.y)) return null;
  return { x: spot.x, y: spot.y, n: spot.n, why: "crowd" };
}
// A unit's turn with its launcher (both sides): an empty one is reloaded when nobody is close (1 action, the base
// round), then a launch at the best spot. Returns true when it launched (the turn is spent).
export function aiLaunch(b, u) {
  const g = u && u.gl;
  if (!g || !active(u) || u.ap < 1 || u.kind !== "human" || u.aboard || u.gunner || u.carrying != null || u.dragging != null) return false;
  if (u.ram != null && b.rams && isCrew(b, u)) return false;
  const base = CALIBERS[g.cal] ? CALIBERS[g.cal].base : "he";
  const close = foesOf(b, u).some((f) => Math.max(Math.abs(f.x - u.x), Math.abs(f.y - u.y)) <= 1);
  if (!g.oneShot && (g.mag < 1 || g.load !== base)) {
    if (close || u.ap < 2 || glReloadRefusal(b, u, base)) return false;
    glReload(b, u, base);
  }
  const spot = launchSpot(b, u);
  if (!spot || launchRefusal(b, u, spot.x, spot.y)) return false;
  launch(b, u, spot.x, spot.y);
  return true;
}

// ---------- packing for a trip (parties.js launchExpedition) ----------
// Rounds for the launchers the team carries (LAUNCH.PACK each: six 40 mm, two rockets), the base round first, out of
// the base's stock and within kg (what the crew can still carry). Returns { key: q } (taken from `from`).
/** @param {Record<string, number>} from @param {any[]} members @param {number} [kg] @returns {Record<string, number>} */
export function packLauncherRounds(from, members, kg = Infinity) {
  /** @type {Record<string, number>} */
  const out = {};
  if (!from) return out;
  let room = kg;
  for (const s of members || []) {
    const c = s ? carriedLauncher(s) : null;
    if (!c || WEAPONS[c.key].oneShot) continue;
    const cal = WEAPONS[c.key].launcher;
    const C = CALIBERS[cal];
    if (!C) continue;
    let want = LAUNCH.PACK[cal] || 0;
    for (const t of [C.base, ...C.types.filter((x) => x !== C.base)]) {
      if (want <= 0) break;
      const key = ammoKey(cal, t);
      const q = Math.min(want, Math.max(0, Math.floor(num(from[key]))), Math.floor(room / C.kg));
      if (q <= 0) continue;
      from[key] -= q; out[key] = (out[key] || 0) + q; want -= q; room -= q * C.kg;
    }
  }
  return out;
}

// ---------- the Help topic (ui/help.js) ----------
export const LAUNCH_HELP = `<b>Grenade launchers and rockets.</b> The M79 and the six-shot M32 lob 40 mm grenades up to 20 tiles,
  the M203 under an assault rifle up to 16 (the rifle still shoots); like a thrown grenade they come down over walls
  wherever someone of yours sees (a tile off now and then, less often than a throw). HE hits whoever is on the spot hard
  (34–46) and everyone within a tile and a half for 16–24; buckshot is a giant shotgun shell at someone within 8 tiles;
  smoke makes a cloud, a flare lights 7 tiles. The AT4 (a single rocket: fired, it is gone) and the RPG (reloadable) fire
  straight at what the shooter sees, 14 tiles: 70–95 on the spot, 30–45 within 2, and they break gates, doors, wall
  sections, a battering ram and vehicles. Inside 3 tiles neither HE nor a rocket arms: it hits like a brick. A rocket's
  backblast hurts anyone 2 tiles behind the shooter, and fired from inside a room it hurts the shooter (and costs their
  next action). Launch (Shift+L) shows the range, the 3-tile ring where nothing arms and the backblast; a reload is 1 action.
  The bearer of an M79, M32, AT4 or RPG fights with a sidearm (off hand or a pocket) or their fists besides.
  <br><b>Explosions and gear.</b> Anyone a blast hits has their gear knocked about (15–50% of its condition, by how hard
  it hit them), their rounds cook off (up to 40% lost) and a grenade, pipe bomb or Molotov they carry can go off
  (one time in ten). Loot from someone killed by explosives is worn. A vehicle blown up (blasts that wear it past its
  condition) loses half to four fifths of its cargo and the rest is battered; its riders take the blast. Soldiers carry
  an M203 now and then, and one battle in twenty a strong patrol brings an RPG; a group that captures launchers uses
  them, on your gate too.`;
