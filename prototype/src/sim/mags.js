// @ts-check
// Magazines in battle (docs/weapons-overhaul-plan.md section 15, "physical magazines, virtual rounds"; the user's
// decisions in section 20: R13 a magazine from a chest rig, a pouch or a pocket reloads in 1 action, from the pack in 2).
//
// The magazine items (data-kit.js MAGAZINES: mag_<plat>_<cap>, the old extmag and drum) decide how many rounds a gun
// takes before a reload, how many quick reloads a fighter has, and which type is loaded (item.load: one type a
// magazine; null: the gun's own load). The rounds stay counted in the pools (ammo.js roundsOf / takeBattleRounds): a
// shot takes its rounds from the pools as before, u.mag is a counter of what is in the gun (combat.js magIn / magShown).
//
// A battle unit's magazines: u.mags = [{ key, cap, load, n, where }] for the weapon u.magsW, where "gun" (the one in
// the gun: its rounds are u.mag), "rig" (a rig pouch), "pocket" or "pack". Built when the unit is made (fitMags for
// your people: the gun's fitted magazine, else its implicit standard one, and every compatible spare they carry;
// enemies: kitMags, 1–3, soldiers 3–5). Each starts at n = cap, your side's bounded by the rounds of its type to hand
// (taken in turn, the gun first). Nothing moves physically during a fight: the items stay where they are, and out of a
// fight loading them is free (they are full again for the next one).
// Reload (reloadPlan / doReload):
//   - the next loaded spare (its type first, then any): 1 action from a rig pouch or a pocket, 2 from the pack. Its type
//     becomes u.load. The emptied magazine is kept: it goes back where the fresh one came from (with what was left in it).
//   - no loaded spare: Top up, the magazine in the gun refilled from the rounds to hand. The source decides the cost
//     (roundSource, 2026-10-17 user request: "reload guns including shotguns from loose ammo/shells from pockets, rigs
//     in addition to pack, only reload from pack uses double action"): 1 action from loose rounds or a box in a pocket
//     or a rig pouch (u.handBoxes), 2 from the pack (SOURCE_AP), 2 from a teammate's boxes or the team's bags (no nearer than the pack).
//   - an internal magazine (a pump, a lever-action, a revolver, a bolt-action's box, a double barrel: data-kit.js
//     INTERNAL): Reload puts that many rounds in, 1 action from the pockets or the rig, 2 from the pack, a teammate's or
//     the team's bags (anything not at hand: both actions); a speedloader or a stripper clip carried (CLIPS) fills it at once, once a fight
//     (1 action from a pouch or a pocket, 2 from the pack).
//   - a shotgun (SHELLS.GUNS) is loaded from the shells at hand (pockets, rig, loose): a tube 2–4 shells a Reload (1
//     action), a double barrel both barrels at once (see shellPlan); with none at hand, straight out of the pack for
//     both actions (plan { mode: tube | break | single, from: "pack" }), or Get shells (1 action) brings a handful to
//     hand first for 1-action Reloads after.
//   - a spare magazine loaded by hand (loadMagPlan / loadMagFrom, 2026-10-18 user request: "Reload magazine by dragging
//     loose ammo onto a magazine uses action to do so from pocket to rig or two actions to reload from dragging loose
//     ammo from pack to magazine"): in the fight's Inventory window loose rounds dropped onto one of the gun's spares
//     (combat.js invAct, a "load") put up to what the handful holds into it, 1 action when the rounds are in a pocket or
//     a rig pouch, both when they are in the pack (LOAD_AP: MAGS.SOURCE_AP). Its type becomes the rounds' (an empty
//     one takes any the magazine and the gun accept; one with rounds in it only more of the same). The rounds stay
//     where they lie, as every magazine's do (virtual rounds: a shot spends them, ammo.js takeBattleRounds), so a
//     magazine fills only with rounds the gun and the quicker spares have not claimed (loaded). A box must be opened
//     first; a magazine of another gun is not loaded (the unit tracks only its own gun's).
// Units with no u.mags (made some other way, an old save's battle, a turret, a launcher) keep the old rule: Reload is 1
// action and fills the magazine.
import { GEAR } from "./data.js";
import { MAGAZINES, INTERNAL, CLIPS } from "./data-kit.js";
import { CALIBERS, ROUND_SUPPLIES, CAL_ACCEPTS, HAND_SUPPLIES } from "./data-ammo.js";
import { WEAPONS } from "./combat.js";
import { modFits, platformOf, magCapOf, gunMods, unitMods } from "./gunmods.js";
import { roundsOf, calOf, loadRefusal } from "./ammo.js";
import { typeFor, roundName, typeName, withHand, keyFor, rebaseLoad, loadCal, loadId, roundOf } from "./rounds.js";
import { isRoundItem, amountOf } from "./itemstack.js"; // loose rounds dropped onto a magazine (loadMagPlan)
import { hash01 } from "./skills.js";

export const MAGS = {
  AP: { gun: 0, rig: 1, pocket: 1, pack: 2 }, // actions to reload from a spare kept there
  TOPUP_AP: 2, // refill the magazine in the gun with no loaded spare, from a teammate's rounds or the team's bags
  SOURCE_AP: { hand: 1, pack: 2 }, // rounds (not a magazine) loaded from the unit's own pockets or rig, or from its pack (roundSource)
  ENEMY: { soldiers: [3, 5], default: [1, 3] }, // spare magazines an enemy carries
};
const num = (v) => (Number.isFinite(v) ? v : 0);

// ---------- the items ----------
export const isMag = (it) => !!(it && MAGAZINES[it.key]);
export const isClip = (it) => !!(it && CLIPS[it.key]);
export const magSpec = (key) => MAGAZINES[key] || null;
// Does this magazine fit this gun (its platform, and some calibre the gun takes: gunmods.js modFits)?
export const magFitsGun = (gunKey, magKey) => !!(MAGAZINES[magKey] && gunKey && WEAPONS[gunKey] && modFits(gunKey, magKey));
// The calibres a magazine holds (data-kit.js MAGAZINES cals; else data-ammo.js CAL_ACCEPTS of its calibre): a STANAG
// magazine 5.56, .223 and .300 BLK.
/** @param {string} magKey @returns {string[]} */
export const magCalsOf = (magKey) => { const m = MAGAZINES[magKey]; return !m ? [] : m.cals || CAL_ACCEPTS[m.cal] || [m.cal]; };
/** @param {string} magKey @param {string | null | undefined} cal */
export const magTakes = (magKey, cal) => !!cal && magCalsOf(magKey).includes(cal);
// An internal magazine (rounds put in one at a time): the gun has one and no magazine item is fitted to it.
export const internalOf = (gunKey) => INTERNAL[gunKey] || 0;
export const fittedMag = (gun) => (gun && gun.mods && gun.mods.mag && MAGAZINES[gun.mods.mag.key] ? gun.mods.mag : null);
export const usesInternal = (gunKey, gun = null) => !!INTERNAL[gunKey] && !fittedMag(gun);
// A gun that takes magazine items at all (some magazine fits its platform).
const MAG_GUN = new Map();
export function takesMagItems(gunKey) {
  if (!MAG_GUN.has(gunKey)) MAG_GUN.set(gunKey, !!(WEAPONS[gunKey] && platformOf(gunKey) && Object.keys(MAGAZINES).some((k) => magFitsGun(gunKey, k))));
  return MAG_GUN.get(gunKey);
}
// The standard magazine of a gun: the one of its platform that holds its WEAPONS cap (the implicit magazine of a gun
// with none fitted), else the smallest that fits. null: none (an internal magazine, a bow, a launcher).
const STD = new Map();
export function standardMag(gunKey) {
  if (STD.has(gunKey)) return STD.get(gunKey);
  const w = WEAPONS[gunKey];
  let out = null;
  if (w && !INTERNAL[gunKey] && takesMagItems(gunKey)) {
    const fits = Object.keys(MAGAZINES).filter((k) => magFitsGun(gunKey, k)).sort((a, b) => MAGAZINES[a].cap - MAGAZINES[b].cap);
    out = fits.find((k) => MAGAZINES[k].cap === w.cap) || fits.find((k) => MAGAZINES[k].cap >= w.cap) || fits[0] || null;
  }
  STD.set(gunKey, out);
  return out;
}
// The kind of round a magazine item holds for a gun of calibre `cal` (its own load, else the given default). A magazine
// item's load is written against the magazine's own calibre (rounds.js loads: a STANAG with .223 in it "223:fmj"), a
// gun's against the gun's: it is moved over (rebaseLoad). gunKey: a load the gun refuses (.300 BLK in a 5.56 gun) or
// the magazine cannot hold is not used (out of a fight a spare is filled with what the gun takes: the default).
export function magLoad(it, cal, dflt = null, gunKey = null) {
  const t = it && it.load, m = it && MAGAZINES[it.key];
  const home = m ? m.cal : cal;
  if (cal && t && CALIBERS[home] && typeFor(home, t) === t) {
    const l = typeFor(cal, rebaseLoad(home, t, cal));
    if (!(gunKey && loadRefusal(gunKey, l)) && !(m && !magTakes(it.key, loadCal(cal, l)))) return l;
  }
  return typeFor(cal, dflt);
}
// The load a magazine item of `magKey` gets from a gun's load (a gun of calibre `cal`): written against the magazine's
// calibre; null for its common round, or one it cannot hold.
/** @param {string} magKey @param {string | null} cal @param {string | null | undefined} load */
export function magItemLoad(magKey, cal, load) {
  const m = MAGAZINES[magKey];
  if (!m || !cal || !load || load === "auto") return null;
  const l = rebaseLoad(cal, load, m.cal);
  return magTakes(magKey, loadCal(m.cal, l)) ? (l === typeFor(m.cal, null) ? null : l) : null;
}
// A magazine's text: "5.56 magazine (30), FMJ" / "5.56 magazine (30), .223 Rem soft point".
export const magText = (it) => (isMag(it) ? `${it.name}${it.load ? `, ${String(it.load).includes(":") && MAGAZINES[it.key] ? roundName(MAGAZINES[it.key].cal, it.load) : typeName(it.load)}` : ""}` : "");

// ---------- a battle unit's magazines ----------
export const tracksMags = (u) => !!(u && Array.isArray(u.mags) && u.magsW === u.weapon);
export const gunEntry = (u) => (tracksMags(u) ? u.mags.find((m) => m.where === "gun") || null : null);
export const spares = (u) => (tracksMags(u) ? u.mags.filter((m) => m.where !== "gun") : []);
export const isInternalUnit = (u) => tracksMags(u) && u.magMode === "internal";
// What a magazine of this unit holds now: a spare's virtual count, bounded (your side) by the rounds of its type to hand
// that the gun and the spares before it (the quicker to hand first) have not already claimed.
function loaded(b, u, m) {
  if (!(m.n > 0)) return 0;
  if (u.side !== "player") return m.n;
  let left = Math.max(0, roundsOf(b, u, m.load)) - (typeFor(calOf(u.weapon), u.load) === m.load ? Math.max(0, num(u.mag)) : 0);
  for (const o of order(u)) {
    if (o === m) break;
    if (o.where !== "gun" && o.load === m.load) left -= Math.min(o.n, Math.max(0, left));
  }
  return Math.max(0, Math.min(m.n, left));
}
const order = (u) => u.mags.filter((x) => x.where !== "gun").sort((a, c) => (MAGS.AP[a.where] || 0) - (MAGS.AP[c.where] || 0));
// Rounds of a type left to hand for a unit's next magazine (your side; others: endless).
const avail = (b, u, t) => (u.side === "player" ? Math.max(0, roundsOf(b, u, t)) : Infinity);
// Clips for an internal magazine: [{ key, where, used }].
const clipsFor = (u, spots) => spots.filter((x) => CLIPS[x.item.key] && CLIPS[x.item.key].weapons.includes(u.weapon)).map((x) => ({ key: x.item.key, where: x.where, used: false }));

// Your person's magazines (combat.js playerUnit, after u.load and u.item are set, before loadMag). spots: inventory.js
// carriedSpots(s) (what they carry and where: pockets, rig pouches, the pack).
export function fitMags(b, u, spots, staticCap) {
  u.mags = null; u.magsW = null; u.clips = null; u.magMode = null;
  fitHandBoxes(u, spots); // the shells at hand (shellsAt): boxes in the pockets and the rig, the first u.handBoxes of u.boxes
  const key = u.weapon, w = WEAPONS[key], cal = calOf(key);
  if (!w || !(w.cap > 0) || w.mounted || w.launcher || w.mount || !cal) return;
  if (!INTERNAL[key] && !takesMagItems(key)) return;
  u.magsW = key;
  if (usesInternal(key, u.item)) {
    u.magMode = "internal";
    u.mags = [];
    u.clips = clipsFor(u, spots);
    if (isShellGun(u)) startHand(b, u); // SHELLS: the loose shells they start with (a side-saddle's)
    return;
  }
  u.magMode = "box";
  const fit = fittedMag(u.item);
  const gunLoad = typeFor(cal, u.load);
  // n = cap: what a magazine holds is bounded as it is used by the rounds of its type to hand that the gun and the
  // quicker spares have not claimed (loaded).
  u.mags = [{ key: fit ? fit.key : standardMag(key), cap: staticCap, load: gunLoad, n: staticCap, where: "gun" }];
  for (const x of spots) { const m = spareFor(key, cal, u.load, x); if (m) u.mags.push(m); }
}
// The spare a carried thing (a carriedSpots entry) makes for this gun, or null: a magazine in a pocket, a rig pouch or
// the pack that fits the gun and holds a calibre its load can be. The entries of u.mags follow the spots' order, so
// the k-th of one key in one place is the k-th such item carried (magEntryAt; refitKit and doReload keep the order).
function spareFor(key, cal, uLoad, x) {
  if (!x || !isMag(x.item) || !["rig", "pocket", "pack"].includes(x.where) || !magFitsGun(key, x.item.key)) return null;
  const load = magLoad(x.item, cal, uLoad, key);
  if (!magTakes(x.item.key, loadCal(cal, load))) return null; // (the gun's load is a calibre this magazine cannot hold)
  const cap = magCapOf(x.item.key) || MAGAZINES[x.item.key].cap;
  return { key: x.item.key, cap, load, n: x.item.unloaded ? 0 : cap, where: x.where }; // itemacts.js: one unloaded (the item menu) stays empty
}
// The u.mags entry of the magazine item at an inventory location on the unit's survivor (spots: inventory.js
// carriedSpots(s)), or null (no such item, not one of this gun's, or no magazines tracked). The k-th magazine of its
// key in its place among the spots is the k-th entry of that key and place.
export function magEntryAt(u, spots, loc) {
  if (!tracksMags(u) || u.magMode !== "box") return null;
  const key = u.weapon, cal = calOf(key);
  const i = (spots || []).findIndex((x) => x.loc === loc);
  if (i < 0 || !spareFor(key, cal, u.load, spots[i])) return null;
  const it = spots[i].item, where = spots[i].where;
  let k = 0;
  for (let j = 0; j < i; j++) if (spots[j].item.key === it.key && spots[j].where === where && spareFor(key, cal, u.load, spots[j])) k++;
  const same = u.mags.filter((m) => m.where !== "gun" && m.key === it.key && m.where === where);
  return same[k] || same[same.length - 1] || null;
}
// What a magazine of the unit holds now (loaded: bounded by the rounds of its type to hand not claimed before it).
export const loadedIn = (b, u, m) => loaded(b, u, m);
// An enemy's magazines (carrykit.js kitEnemy): the gun's and `count` spares of its standard magazine (or the given
// items: a group's own, arsenal.js), all of the unit's load; where: "rig" when it wears one, else pockets then the pack.
export function enemyMags(u, staticCap, count, hasRig, items = null) {
  u.mags = null; u.magsW = null; u.clips = null; u.magMode = null;
  const key = u.weapon, w = WEAPONS[key], cal = calOf(key);
  if (!w || !(w.cap > 0) || w.mounted || w.launcher || w.mount || !cal) return;
  if (!INTERNAL[key] && !takesMagItems(key)) return;
  u.magsW = key;
  const gun = u.arsItem || (u.modItems ? { key, mods: u.modItems } : null);
  if (usesInternal(key, gun)) { u.magMode = "internal"; u.mags = []; u.clips = []; if (isShellGun(u)) startHand(null, u); return; } // SHELLS: their handful too
  u.magMode = "box";
  const load = typeFor(cal, u.load);
  const fit = fittedMag(gun);
  u.mags = [{ key: fit ? fit.key : standardMag(key), cap: staticCap, load, n: staticCap, where: "gun" }];
  const list = items ? items.filter((it) => magFitsGun(key, it.key)) : Array.from({ length: Math.max(0, count) }, () => ({ key: standardMag(key) })).filter((it) => it.key);
  list.forEach((it, i) => {
    const cap = magCapOf(it.key) || MAGAZINES[it.key].cap;
    u.mags.push({ key: it.key, cap, load: items ? magLoad(it, cal, u.load, key) : load, n: cap, where: hasRig ? "rig" : i < 2 ? "pocket" : "pack" });
  });
}
// How many spare magazines an enemy of this kit carries (own dice).
export function enemyMagCount(kind, ...salt) {
  const [lo, hi] = MAGS.ENEMY[kind] || MAGS.ENEMY.default;
  return lo + Math.floor(hash01("enemymags", kind, ...salt) * (hi - lo + 1));
}

// ---------- shotgun shells (the user's calls, 2026-10-09) ----------
// A shotgun (SHELLS.GUNS: the tube-fed pump and semi-auto, the break-action double barrel and sawn-off, the pipe gun)
// is loaded a shell at a time from the shells AT HAND: "Shotguns reload from shells in your pocket, rig or anything that
// holds them that is not your backpack that needs an additional action".
// 2026-10-18 (the user's bug: "free reloads not pulling from the survivor's inventory ... they can reload forever"):
// Reload loads only the shells AT HAND on the person (boxes in pockets and rig pouches, loose ones taken out of a pack),
// or straight out of the pack for both actions, and nobody of yours starts a fight with a free handful. What counts as
// the pack depends on the fight:
//   - a team on the road (a party's fight, a raid, a crawl): their own backpack and the team's bags (what the team
//     packed, its cargo, a raid's finds, a teammate's box: b.pools and the side's boxes, carried on the team's backs);
//   - a base's defence: their own backpack only (stockFight). The base's stock sits in the armory, not on anyone:
//     nothing is loaded from it in the fight (before, every defender dug out of it for as long as it lasted). Defenders
//     get CARRY shells each out of the stock into a pocket as the fight starts (combat.js createBattle: packShells).
// With no shells at hand or in the pack, Reload and Get shells are refused (the refusal says where the shells are).
// At hand (shellsAt), per type:
//   - box: boxes of shells in the shooter's pockets and rig pouches (the first u.handBoxes of u.boxes: fitMags puts the
//     rig's boxes right after the pockets', so a shot, which takes its round from the shooter's own boxes first, spends
//     them first), less what is already in the gun;
//   - hand: loose shells taken out of the pack (u.hand[type], virtual like the magazines: a shot spends the pack's box or
//     the team's rounds). Every other side: their reserve is endless, so they take the field with START_HAND loose.
//   - a side-saddle (or an elastic shell holder) on a tube's receiver holds SADDLE shells of its own on the gun, out of
//     the pack: that many loose at the start, and the most kept loose (HAND_MAX) that many more (and a Reload puts a
//     shell more in);
//   - pack: the rest (above; every other side: endless). A Reload straight out of it takes both actions, or Get shells
//     (1 action: getShells) takes GRAB of them out, up to HAND_MAX loose, for 1-action Reloads. The AI (reload():
//     doReload's "fetch" plan) spends that action itself.
// A team packed for a trip (parties.js launchExpedition: carrykit.js packShells) carries CARRY shells a shotgunner in a
// pocket or a rig pouch, out of what it packs, so the first reloads need no digging; a base's defenders get the same out
// of its stock as the fight starts (combat.js createBattle), so a shotgun at home is not a club after six shots.
// Shells a Reload (1 action) puts in: a tube BASE (2 or 3, the battle's dice) + 1 steady hands (aim STEADY_AIM+: a
// colonist with Shooting 6, a power-4 enemy) - 1 shaken (hurt below half, pinned by suppressing fire, dazed by a
// flashbang), MIN..MAX; a break action both barrels (2), the pipe gun its one; never more than the room in the gun and
// the shells at hand. Off (SHELLS.on = false: tools/shotgunreloadtest.js's baseline): the old rule, INTERNAL a Reload
// from anywhere.
export const SHELLS = {
  on: true,
  GUNS: { shotgun: "tube", semishotgun: "tube", dbshotgun: "break", sawnoff: "break", pipegun: "single", tacpump: "tube", pump20: "tube", ou12: "break", ou20: "break", single12: "single" }, // a box-magazine shotgun (none yet) would swap magazines
  BREAK: 2, // a break action: both barrels at once
  BASE: [2, 3],
  MIN: 1,
  MAX: 4,
  STEADY_AIM: 55,
  HURT: 0.5,
  START_HAND: 8, // loose shells an enemy (or third-side) shotgunner starts a fight with, out of an endless bag (yours start with what they carry)
  GRAB: 8, // shells one Get shells takes out of the pack
  HAND_MAX: 16, // loose shells out of the pack a person keeps at hand (pockets, belt)
  SADDLE: 6, // shells a side-saddle (an elastic shell holder) holds on the gun: the handful and HAND_MAX that many more
  CARRY: 30, // shells a shotgunner packed for a trip carries in a pocket or a rig pouch (carrykit.js packShells): the gun's load and the rest at hand
};
// Shells a side-saddle on this unit's tube holds (0: none, or not a tube).
export const saddleHold = (u) => (isTubeShotgun(u) && num(unitMods(u).reload) > 0 ? SHELLS.SADDLE : 0);
// The most loose shells this unit keeps at hand.
export const handMax = (u) => SHELLS.HAND_MAX + saddleHold(u);
const isBox = (x) => x && x.item && ROUND_SUPPLIES[x.item.key];
// Counts the boxes of rounds at hand (u.handBoxes: the pockets' and the rig's, the first of u.boxes; u.pocketBoxes: the
// pockets' alone, for "from a pocket" / "from the rig"). ammo.js boxesOf lists them in that order (pockets, rig, pack);
// a u.boxes built without the rig's (another caller's) gets them put in right after the pockets'.
function fitHandBoxes(u, spots) {
  if (!Array.isArray(u.boxes)) { u.handBoxes = 0; u.pocketBoxes = 0; return; }
  const list = spots || [];
  const pockets = list.filter((x) => x.where === "pocket" && isBox(x)).length;
  const rig = list.filter((x) => x.where === "rig" && isBox(x)).map((x) => x.item);
  const add = rig.filter((it) => !u.boxes.includes(it));
  if (add.length) u.boxes.splice(pockets, 0, ...add);
  u.handBoxes = pockets + rig.length;
  u.pocketBoxes = pockets;
}
export const shellKind = (u) => (SHELLS.on && u && u.magMode === "internal" && SHELLS.GUNS[u.weapon]) || null;
export const isShellGun = (u) => !!shellKind(u);
export const isTubeShotgun = (u) => shellKind(u) === "tube";
export const isBreakAction = (u) => shellKind(u) === "break";
function shellsIn(list, keys) {
  let n = 0;
  for (const it of list || []) if (it && keys.includes(it.key)) n += Math.max(0, Math.floor(num(it.dur)));
  return n;
}
// The shells of a type this unit carries (u.boxes: pockets, rig, pack), none of the team's.
const ownShells = (u, keys) => shellsIn(u.boxes || [], keys);
// A fight at one of your bases: its stock is the pool, and not on anyone (a team's fight: the pools are its bags).
export const stockFight = (b) => !!(b && b.setup && b.setup.baseId && !b.setup.partyId);
// The shells of a type this unit can load in this fight, counting what is in the gun out (mag: the rounds in the gun
// to count with; a switch of type empties it): { box (pockets, rig), hand (loose, out of the pack), pack, at (box +
// hand) }. The pack: their backpack, and on the road the team's bags (never a base's stock: stockFight). The gun's load
// is claimed out of these first (the boxes at hand, then the pack): a shotgunner with nothing on them and a loaded tube
// has 0 at hand, 0 in the pack, and the tube's shells to shoot.
export function shellsAt(b, u, type = null, mag = null) {
  const cal = calOf(u.weapon);
  const t = typeFor(cal, type || u.load);
  const m = mag == null ? Math.max(0, num(u.mag)) : mag;
  const claimed = typeFor(cal, u.load) === t ? m : 0;
  const hand0 = Math.max(0, num(u.hand && u.hand[t]));
  if (u.side !== "player") return { box: 0, hand: hand0, pack: Infinity, at: hand0 };
  const keys = withHand(keyFor(cal, t));
  const total = stockFight(b) ? ownShells(u, keys) : Math.max(0, roundsOf(b, u, t));
  const boxN = Math.min(total, shellsIn((u.boxes || []).slice(0, Math.max(0, u.handBoxes || 0)), keys));
  const box = Math.max(0, boxN - claimed);
  const rest = Math.max(0, total - Math.max(claimed, boxN));
  const hand = Math.min(hand0, rest);
  return { box, hand, pack: rest - hand, at: box + hand };
}
// The loose shells a shotgunner takes the field with (fitMags, enemyMags). Your side: none but a side-saddle's or a
// buttstock holder's, out of the pack (shellsAt bounds them); every other side: START_HAND out of an endless reserve.
function startHand(b, u) {
  u.hand = {};
  const cal = calOf(u.weapon), t = typeFor(cal, u.load);
  const cuff = Math.max(0, num(unitMods(u).hand)); // a buttstock shell holder (gunmods.js hand)
  const hold = saddleHold(u) + cuff; // a side-saddle's shells and a buttstock holder's
  u.hand[t] = (u.side !== "player" ? SHELLS.START_HAND : 0) + hold;
}
export const isShaken = (u) => !!((u.maxHp > 0 && u.hp < u.maxHp * SHELLS.HURT) || u.suppressed || u.stun);
// The shells a Reload puts in now with the dice at roll (0: BASE[0], 1: BASE[1]): { n, at, pack, steady, shaken, room }.
// type: the type loaded (a switch empties the gun first). fromPack: a Reload straight out of the pack (both actions):
// the pack's shells count too. null for a gun that is not a shotgun.
export function shellPlan(b, u, type = null, roll = 0, fromPack = false) {
  const kind = shellKind(u);
  if (!kind) return null;
  const cal = calOf(u.weapon);
  const cur = typeFor(cal, u.load), want = type ? typeFor(cal, type) : cur;
  const m = want !== cur ? 0 : Math.max(0, num(u.mag));
  const room = Math.max(0, (u.magMax ?? 0) - m);
  const s = shellsAt(b, u, want, m);
  const steady = num(u.aim) >= SHELLS.STEADY_AIM, shaken = isShaken(u);
  const saddle = kind === "tube" ? Math.max(0, num(unitMods(u).reload)) : 0; // a side-saddle on the receiver (gunmods.js reload)
  const n = kind === "break" ? SHELLS.BREAK : kind === "single" ? 1 : Math.max(SHELLS.MIN, Math.min(SHELLS.MAX + saddle, SHELLS.BASE[roll ? 1 : 0] + (steady ? 1 : 0) - (shaken ? 1 : 0) + saddle));
  return { n: Math.max(0, Math.min(n, room, fromPack ? s.at + s.pack : s.at)), at: s.at, pack: s.pack, steady, shaken, saddle, room };
}
// The shells a Reload of this shotgun puts in, as a range for the Reload button: { lo, hi, at, pack, steady, shaken }.
export function shellRange(b, u, type = null) {
  const a = shellPlan(b, u, type, 0), c = shellPlan(b, u, type, 1);
  return a && c ? { ...a, lo: a.n, hi: c.n } : null;
}
// Why Get shells cannot be done now ("" when it can): a shotgun, shells of its type in the pack, room at hand.
export function getShellsRefusal(b, u, type = null) {
  if (!isShellGun(u)) return "Only a shotgun is loaded from loose shells.";
  const cal = calOf(u.weapon), t = typeFor(cal, type || u.load);
  const s = shellsAt(b, u, t);
  if (!(s.pack > 0)) return s.at > 0 ? `No more ${roundName(cal, t)} in the pack: ${s.at} at hand.` : `No ${roundName(cal, t)} in the pack.${teamNote(b, u, t)}`;
  if (s.hand >= handMax(u)) return `${s.hand} loose shells at hand already: room for no more.`;
  return "";
}
// Get shells (1 action; the caller takes it): GRAB shells of the type out of the pack, loose at hand. Returns the log line.
export function getShells(b, u, type = null) {
  const cal = calOf(u.weapon), t = typeFor(cal, type || u.load);
  const s = shellsAt(b, u, t);
  const n = Math.max(0, Math.min(SHELLS.GRAB, s.pack, handMax(u) - s.hand));
  if (!u.hand) u.hand = {};
  u.hand[t] = s.hand + n;
  const at = shellsAt(b, u, t).at;
  return u.side === "player"
    ? `${u.name} takes ${n} ${n === 1 ? "shell" : "shells"} of ${roundName(cal, t)} out of the pack (${at} at hand).`
    : `${u.name} digs ${n} shells out of a bag (${at} at hand).`;
}
// Takes the n shells just loaded off what is at hand: the boxes in the pockets and the rig first (claimed by the gun from
// then on), then the loose ones.
function useHand(b, u, t, n, magBefore) {
  const s = shellsAt(b, u, t, magBefore);
  const fromHand = Math.max(0, n - s.box);
  if (fromHand > 0 && u.hand) u.hand[t] = Math.max(0, s.hand - fromHand);
}
// "3 shells at hand (pockets, rig, loose), 22 in the pack" for the Reload button.
export function shellsLine(b, u, type = null) {
  if (!isShellGun(u)) return "";
  const s = shellsAt(b, u, type);
  const pk = u.side !== "player" ? "" : s.pack > 0 ? `, ${s.pack} in the pack` : ", none in the pack";
  return `${s.at} ${s.at === 1 ? "shell" : "shells"} at hand${pk}`;
}
// Where the shells of the type this unit cannot load are (a base's defence: its stock, a teammate's pockets), for the
// refusal: " The base's 40 are in its stock and 12 are on teammates, not to hand in a fight: …" / "" (nowhere else).
export function teamNote(b, u, type = null) {
  if (u.side !== "player" || !stockFight(b)) return "";
  const cal = calOf(u.weapon), t = typeFor(cal, type || u.load), keys = withHand(keyFor(cal, t));
  let pool = 0;
  for (const p of b.pools || []) for (const k of keys) pool += Math.max(0, Math.floor(num(p[k])));
  const mates = Math.max(0, roundsOf(b, u, t) - ownShells(u, keys) - pool);
  if (!(pool > 0) && !(mates > 0)) return "";
  const parts = [];
  if (pool > 0) parts.push(`the base's ${pool} are in its stock`);
  if (mates > 0) parts.push(`${mates} are on teammates`);
  const line = parts.join(" and ");
  return ` ${line[0].toUpperCase()}${line.slice(1)}, not to hand in a fight: a shotgun loads only the shells its shooter carries (pockets, rig, pack).`;
}
// Why a shotgun cannot be loaded at all now ("" when some shells of the type are to hand or in the pack): none.
export function noShellsRefusal(b, u, type = null, mag = null) {
  if (!isShellGun(u) || u.side !== "player") return "";
  const cal = calOf(u.weapon), t = typeFor(cal, type || u.load);
  const s = shellsAt(b, u, t, mag);
  if (s.at + s.pack > 0) return "";
  const keys = withHand(keyFor(cal, t));
  const total = stockFight(b) ? ownShells(u, keys) : Math.max(0, roundsOf(b, u, t));
  if (total > 0) return `No spare ${roundName(cal, t)}: every shell ${stockFight(b) ? "they carry" : "the team has"} is already loaded.${teamNote(b, u, t)}`;
  return stockFight(b) ? `No ${roundName(cal, t)} on them (none in their pockets, rig or pack).${teamNote(b, u, t)}` : `No ${roundName(cal, t)} left to load (none on them or in the team's bags).`;
}
// A Reload now would load straight out of the pack (no shells of the type at hand, some in the pack: both actions; Get
// shells, 1 action, brings a handful to hand instead).
export const shellsInPack = (b, u, type = null) => isShellGun(u) && tracksMags(u) && reloadPlan(b, u, type).from === "pack";

// ---------- where the rounds come from (2026-10-17: the source decides a Reload's cost) ----------
// The rounds of a type this unit has past what is loaded, by where they are: { hand (loose rounds and boxes in its
// pockets and rig pouches: the first u.handBoxes of u.boxes, and a shotgunner's loose handful), pack (its own pack's
// boxes and ammo cans), mate (its teammates' boxes), pool (the team's bags, or the base's stock) }. What the gun and
// the loaded spares hold is claimed off the quickest first, as a shot spends them (ammo.js takeBattleRounds). Other
// sides: an endless reserve, counted as the team's bags (pool); their internal reloads keep the old 1 action.
export function roundSplit(b, u, type = null) {
  const out = { hand: 0, pack: 0, mate: 0, pool: 0 };
  const cal = calOf(u.weapon);
  if (!cal) return out;
  if (u.side !== "player") { out.pool = Infinity; return out; }
  const t = typeFor(cal, type || u.load);
  const keys = withHand(keyFor(cal, t));
  const inList = (list) => { let n = 0; for (const it of list || []) if (it && keys.includes(it.key)) n += Math.max(0, Math.floor(num(it.dur))); return n; };
  const hb = Math.max(0, num(u.handBoxes));
  const pack = inList((u.boxes || []).slice(hb));
  let mate = 0;
  for (const o of b.units || []) if (o !== u && o.side === u.side && o.boxes) mate += inList(o.boxes);
  if (isShellGun(u)) { // SHELLS: shellsAt knows the handful and the gun's claim; the rest is its own pack's, then the others'
    const s = shellsAt(b, u, t);
    out.hand = s.at;
    out.pack = Math.min(pack, s.pack);
    out.mate = Math.min(mate, s.pack - out.pack);
    out.pool = Math.max(0, s.pack - out.pack - out.mate);
    return out;
  }
  out.hand = inList((u.boxes || []).slice(0, hb));
  out.pack = pack;
  out.mate = mate;
  for (const p of b.pools || []) for (const k of keys) out.pool += Math.max(0, Math.floor(num(p[k])));
  let claim = typeFor(cal, u.load) === t ? Math.max(0, num(u.mag)) : 0; // in the gun, and in the spares loaded with the type
  if (tracksMags(u) && u.magMode === "box") for (const g of spares(u)) if (g.load === t) claim += loaded(b, u, g);
  for (const k of ["hand", "pack", "mate", "pool"]) { const q = Math.min(out[k], claim); out[k] -= q; claim -= q; }
  return out;
}
// Where the next rounds of a type come from: "hand" | "pack" | "mate" | "pool", or null (none left to load).
export function roundSource(b, u, type = null) {
  const r = roundSplit(b, u, type);
  return r.hand > 0 ? "hand" : r.pack > 0 ? "pack" : r.mate > 0 ? "mate" : r.pool > 0 ? "pool" : null;
}
// Actions a reload of rounds from this source takes: SOURCE_AP (hand 1, pack 2), else `dflt` (a teammate's, the team's
// bags, none: as before).
const sourceAp = (src, dflt) => (src && MAGS.SOURCE_AP[src] != null ? MAGS.SOURCE_AP[src] : dflt);
// Where a plan's rounds come from, in words for the log and the Reload button: "a pocket" / "the rig" (the first box at
// hand with rounds of the type; a shotgunner's loose handful: "the shells at hand") / "the pack" / "a teammate's
// rounds" / "the team's ammo".
export function sourceWord(u, src, type = null) {
  if (src === "hand") {
    const cal = calOf(u.weapon);
    const keys = cal ? withHand(keyFor(cal, typeFor(cal, type || u.load))) : [];
    const hb = Math.max(0, num(u.handBoxes));
    const i = (u.boxes || []).slice(0, hb).findIndex((it) => it && keys.includes(it.key) && num(it.dur) >= 1);
    if (i < 0) return "the shells at hand";
    return u.pocketBoxes == null ? "a pocket or the rig" : i < Math.min(hb, Math.max(0, num(u.pocketBoxes))) ? "a pocket" : "the rig"; // (a unit from before pocketBoxes: either)
  }
  return src === "pack" ? "the pack" : src === "mate" ? "a teammate's rounds" : src === "pool" ? "the team's ammo" : "the rounds to hand";
}

// ---------- reloading ----------
// What a Reload would do now: { mode: "swap" | "topup" | "internal" | "clip" | "tube" | "break" | "single", from (where
// the rounds come from: a spare's or a clip's place, "gun" | "rig" | "pocket" | "pack"; rounds: roundSource's "hand" |
// "pack" | "mate" | "pool" | null), cost (actions), i (the spare's index in u.mags, the clip's in u.clips), load (the
// type it loads), why ("" or the refusal) }. The shotgun modes (shellKind) are a Reload straight out of the pack (both
// actions): the shells at hand load as "internal". type: a type asked for (the Reload act's act.ammo): a spare loaded
// with it, else a top-up with it. The legacy checks (no gun, hands full, the type does not fit the calibre) are
// combat.js reloadRefusal's.
export function reloadPlan(b, u, type = null) {
  const cal = calOf(u.weapon);
  const cur = typeFor(cal, u.load);
  const want = type ? typeFor(cal, type) : cur;
  const sw = want !== cur;
  const max = u.magMax ?? 0, m = u.mag ?? 0;
  if (u.magMode === "internal") {
    const from = roundSource(b, u, want), cost = sourceAp(from, u.side === "player" ? MAGS.SOURCE_AP.pack : 1); // a teammate's boxes or the team's bags are no nearer than the pack: both actions (an enemy's endless pool stays 1)
    if (!sw && m >= max) return { mode: "internal", from, cost, load: want, why: `The ${gunWord(u)} is full (${max}/${max}).` };
    if (isShellGun(u) && u.side === "player") { const why = noShellsRefusal(b, u, want, sw ? 0 : m); if (why) return { mode: "internal", from, cost, load: want, why }; } // SHELLS: only the shells at hand and in the pack count (shellsAt: never a base's stock)
    const pool = avail(b, u, want);
    if (pool < 1) return { mode: "internal", from, cost, load: want, why: `No ammo left to load (no ${roundName(cal, want)}).` };
    if (!sw && u.side === "player" && pool <= m) return { mode: "internal", from, cost, load: want, why: `No spare ammo (${roundName(cal, want)}): every round left is already loaded.` };
    if (isShellGun(u)) { // SHELLS: thumbed in from what is at hand (1 action); none at hand: straight out of the pack (both)
      if (shellsAt(b, u, want, sw ? 0 : m).at >= 1) return { mode: "internal", from: "hand", cost: MAGS.SOURCE_AP.hand, load: want, why: "" };
      return { mode: shellKind(u), from: "pack", cost: MAGS.SOURCE_AP.pack, load: want, why: "" };
    }
    const clips = u.clips || [];
    let ci = -1;
    for (let i = 0; i < clips.length; i++) if (!clips[i].used && (ci < 0 || MAGS.AP[clips[i].where] < MAGS.AP[clips[ci].where])) ci = i;
    const room = sw ? max : max - m;
    if (ci >= 0 && room > internalOf(u.weapon)) return { mode: "clip", from: clips[ci].where, cost: MAGS.AP[clips[ci].where] || 1, i: ci, load: want, why: "" };
    return { mode: "internal", from, cost, load: want, why: "" };
  }
  // A box magazine: the next loaded spare (its type; with no type asked, any type when its own has none).
  let best = -1, bestAny = -1;
  const better = (i, j) => j < 0 || MAGS.AP[u.mags[i].where] < MAGS.AP[u.mags[j].where] || (MAGS.AP[u.mags[i].where] === MAGS.AP[u.mags[j].where] && loaded(b, u, u.mags[i]) > loaded(b, u, u.mags[j]));
  u.mags.forEach((g, i) => {
    if (g.where === "gun" || loaded(b, u, g) < 1) return;
    if (g.load === want) { if (better(i, best)) best = i; }
    else if (!type && better(i, bestAny)) bestAny = i;
  });
  const topup = (why) => { const from = roundSource(b, u, want); return { mode: "topup", from, cost: sourceAp(from, MAGS.TOPUP_AP), load: want, why }; }; // rounds into the magazine in the gun: the source decides
  if (!sw && m >= max && best < 0) return topup(`The ${gunWord(u)} is full (${max}/${max}).`);
  if (!sw && m >= max) return { mode: "swap", from: u.mags[best].where, cost: MAGS.AP[u.mags[best].where], i: best, load: want, why: `The ${gunWord(u)} is full (${max}/${max}).` };
  const pick = best >= 0 ? best : bestAny; // none of its own type loaded: the next loaded magazine of another (a top-up only with no loaded spare left)
  if (pick >= 0) return { mode: "swap", from: u.mags[pick].where, cost: MAGS.AP[u.mags[pick].where] || 1, i: pick, load: u.mags[pick].load, why: "" };
  const pool = avail(b, u, want);
  if (pool < 1) return topup(`No ammo left to load (no ${roundName(cal, want)}).`);
  if (!sw && u.side === "player" && pool <= m) return topup(`No spare ammo (${roundName(cal, want)}): every round left is already loaded.`);
  return topup("");
}
// The gun's attachment numbers (u.gm) with this magazine in it: the magazine is an attachment (mount "mag": a drum's
// −2 aim and its jams, an extended magazine's), so a swap to a magazine of another kind changes them. The gun's own
// item is not touched (the swap is virtual for the fight). The standard magazine: none fitted (the gun's own numbers).
export function refitGm(u, magKey) {
  if (!u || u.gmWeapon !== u.weapon) return;
  const gun = u.item && u.item.key === u.weapon ? u.item : u.arsItem && u.arsItem.key === u.weapon ? u.arsItem : u.modItems ? { key: u.weapon, mods: u.modItems } : null;
  if (!gun) return;
  const mods = { ...(gun.mods || {}) };
  if (magKey && magKey !== standardMag(u.weapon) && MAGAZINES[magKey]) mods.mag = { key: magKey }; else delete mods.mag;
  u.gm = gunMods({ ...gun, mods });
}
// Carries out a plan (combat.js reload: the actions are taken there). Returns the log line.
export function doReload(b, u, plan) {
  const cal = calOf(u.weapon);
  const was = typeFor(cal, u.load);
  const max = u.magMax ?? 0;
  if (plan.mode === "swap") {
    const fresh = u.mags[plan.i], g = gunEntry(u);
    const n = loaded(b, u, fresh);
    if (g) { // the emptied magazine is kept: where the fresh one came from (and in its place in the list: magEntryAt)
      g.n = u.mag ?? 0; g.where = fresh.where;
      const gi = u.mags.indexOf(g), fi = u.mags.indexOf(fresh);
      if (gi >= 0 && fi >= 0) { u.mags[gi] = fresh; u.mags[fi] = g; }
    }
    fresh.where = "gun";
    u.load = fresh.load;
    u.magMax = fresh.cap;
    u.mag = Math.min(fresh.cap, n);
    fresh.n = u.mag;
    if (!g || g.key !== fresh.key) refitGm(u, fresh.key); // a drum's aim and jams go with the drum (and come with it)
    const from = g ? (g.where === "pack" ? "the pack" : g.where === "pocket" ? "a pocket" : "a rig pouch") : "";
    return u.load !== was ? `${u.name} loads the ${gunWord(u)} with ${roundName(cal, u.load)} (${shown(b, u)}/${u.magMax}): a magazine from ${from}.` : `${u.name} reloads the ${gunWord(u)} (${shown(b, u)}/${u.magMax}): a fresh magazine from ${from}.`;
  }
  if (plan.mode === "clip") {
    const c = u.clips[plan.i];
    c.used = true;
    if (plan.load !== was) { u.load = plan.load; u.mag = 0; }
    u.mag = Math.min(max, (u.mag || 0) + CLIPS[c.key].n, (u.mag || 0) + avail(b, u, u.load));
    return `${u.name} reloads the ${gunWord(u)} (${shown(b, u)}/${max}) from a ${String(GEAR[c.key].name).toLowerCase()}.`;
  }
  if (isShellGun(u) && (plan.mode === "internal" || plan.mode === shellKind(u))) { // SHELLS: shells thumbed in from what is at hand, or straight out of the pack (both actions)
    const kind = shellKind(u);
    const fromPack = plan.from === "pack";
    const roll = kind === "tube" && b.rng && typeof b.rng.int === "function" ? b.rng.int(0, 1) : 0;
    const sp = shellPlan(b, u, plan.load, roll, fromPack);
    const sw = plan.load !== was;
    const before = sw ? 0 : u.mag || 0;
    if (!fromPack) useHand(b, u, plan.load, sp.n, before);
    if (sw) { u.load = plan.load; u.mag = 0; }
    u.mag = Math.min(max, before + sp.n);
    u.lastShells = sp.n; // tools/shotgunreloadtest.js
    const what = `${sp.n} ${sp.n === 1 ? "shell" : "shells"}`;
    const src = fromPack ? (u.side === "player" ? " out of the pack" : " out of a bag") : "";
    const left = u.side === "player" ? `, ${shellsAt(b, u).at} left at hand` : "";
    const both = fromPack ? ", both actions" : "";
    const shaky = sp.shaken && kind === "tube" ? ", shaky hands" : "";
    if (kind === "break") return `${u.name} breaks open the ${gunWord(u)} and drops in ${sp.n === 1 ? "a shell" : what}${sw ? ` of ${roundName(cal, u.load)}` : ""}${src} (${shown(b, u)}/${max}${left}${both}).`;
    return sw
      ? `${u.name} loads the ${gunWord(u)} with ${roundName(cal, u.load)}: ${what} in${src} (${shown(b, u)}/${max}${left}${shaky}${both}).`
      : `${u.name} ${kind === "tube" ? "racks in" : "loads"} ${what}${src} (${shown(b, u)}/${max}${left}${shaky}${both}).`;
  }
  if (plan.mode === "internal") {
    if (plan.load !== was) { u.load = plan.load; u.mag = 0; }
    const room = Math.max(0, avail(b, u, u.load) - (u.mag || 0));
    const plus = internalOf(u.weapon) ? Math.max(0, num(unitMods(u).reload)) : 0; // a cartridge cuff on a lever-action
    u.mag = Math.min(max, (u.mag || 0) + Math.min((internalOf(u.weapon) || max) + plus, room));
    const src = plan.from === "pack" ? " out of the pack, both actions" : plan.from === "hand" ? ` from ${sourceWord(u, "hand", u.load)}` : "";
    return plan.load !== was ? `${u.name} loads the ${gunWord(u)} with ${roundName(cal, u.load)} (${shown(b, u)}/${max}${src}).` : `${u.name} reloads the ${gunWord(u)} (${shown(b, u)}/${max}${src}).`;
  }
  // Top up: the magazine in the gun refilled from the rounds to hand (the source decides the cost).
  u.load = plan.load;
  const g = gunEntry(u);
  if (g) g.load = u.load;
  u.mag = Math.min(max, avail(b, u, u.load));
  const top = `a top-up from ${sourceWord(u, plan.from, u.load)} (${plan.cost === 1 ? "1 action" : `${plan.cost} actions`})`;
  return plan.load !== was ? `${u.name} loads the ${gunWord(u)} with ${roundName(cal, u.load)} (${shown(b, u)}/${max}): no spare magazine, ${top}.` : `${u.name} reloads the ${gunWord(u)} (${shown(b, u)}/${max}): no spare magazine left, ${top}.`;
}
const shown = (b, u) => (u.side === "player" ? Math.min(u.mag || 0, Math.max(0, roundsOf(b, u))) : u.mag || 0);
const gunWord = (u) => { const n = u.weaponName || (WEAPONS[u.weapon] && WEAPONS[u.weapon].name) || "gun"; return /^[A-Z][a-z]/.test(n) ? n[0].toLowerCase() + n.slice(1) : n; };

// ---------- loading a spare magazine by hand (the fight's Inventory window) ----------
export const LOAD_AP = MAGS.SOURCE_AP; // the loose rounds' place decides: a pocket or the rig 1, the pack both
const placeWord = (w) => (w === "pack" ? "the pack" : w === "rig" ? "the rig" : "a pocket");
// What dropping the loose rounds `it` (lying in `from`: "pocket" | "rig" | "pack") onto the unit's magazine entry `m`
// would do: { cost, n (rounds that go in), load (the type it is loaded with then), why ("" or the refusal) }.
export function loadMagPlan(b, u, m, it, from) {
  const cost = LOAD_AP[from === "pack" ? "pack" : "hand"];
  const out = { cost, n: 0, load: m ? m.load : null, why: "" };
  const no = (why) => ({ ...out, why });
  if (!tracksMags(u) || u.magMode !== "box") return no(`The ${gunWord(u)} takes no magazines to load.`);
  if (!m || m.where === "gun") return no(`Only a spare magazine of the ${gunWord(u)} is loaded by hand (the one in the gun: Reload).`);
  if (!isRoundItem(it)) return no("Only rounds load a magazine.");
  if (!it.loose) return no("Open the box first (Open box, 1 action): loose rounds load a magazine.");
  const cal = calOf(u.weapon);
  const r = roundOf(it.key) || (HAND_SUPPLIES[it.key] && HAND_SUPPLIES[it.key].round);
  if (!cal || !r) return no("Only rounds load a magazine.");
  if (!magTakes(m.key, r.cal)) return no(`The ${magName(m)} does not take ${roundName(r.cal, r.type)}.`);
  const load = loadId(cal, r.cal, r.type);
  const bad = loadRefusal(u.weapon, load);
  if (bad) return no(bad);
  const cur = loaded(b, u, m);
  if (cur > 0 && m.load !== load) return no(`The ${magName(m)} holds ${roundName(cal, m.load)}: no other rounds go in until it is empty.`);
  if (cur >= m.cap) return no(`The ${magName(m)} is full (${m.cap}/${m.cap}).`);
  const have = amountOf(it);
  if (have < 1) return no("No rounds there.");
  // The rounds stay where they lie (virtual rounds): what the gun and the quicker spares have claimed is not free.
  const wasN = m.n, wasLoad = m.load;
  m.load = load; m.n = Math.min(m.cap, cur + have);
  const after = loaded(b, u, m);
  m.n = wasN; m.load = wasLoad;
  if (after <= cur) return no(`No spare ${roundName(cal, load)}: every round left is already loaded (the ${gunWord(u)} and the other magazines claim them).`);
  return { cost, n: after - cur, load, why: "" };
}
const magName = (m) => String((GEAR[m.key] && GEAR[m.key].name) || "magazine").toLowerCase();
// Carries out a plan (combat.js invAct: the actions are taken there). Returns the log line.
export function loadMagFrom(b, u, m, it, from, plan = null) {
  const p = plan || loadMagPlan(b, u, m, it, from);
  if (p.why) return "";
  const cal = calOf(u.weapon);
  const cur = loaded(b, u, m);
  m.load = p.load;
  m.n = Math.min(m.cap, cur + p.n);
  const now = loaded(b, u, m);
  return `${u.name} loads ${p.n} ${roundName(cal, p.load)} into a magazine in ${placeWord(m.where)} from ${placeWord(from)} (${now}/${m.cap}${p.cost === 1 ? "" : ", both actions"}).`;
}

// The magazines line on a unit's card: "+3 mags (2 rig, 1 pack)" / "2 speedloaders" / "".
export function magsLine(b, u) {
  if (!tracksMags(u)) return "";
  if (u.magMode === "internal") {
    const c = (u.clips || []).filter((x) => !x.used).length;
    return c ? `${c} ${c === 1 ? "clip" : "clips"}` : "";
  }
  const sp = spares(u);
  const full = sp.filter((m) => loaded(b, u, m) > 0);
  if (!sp.length) return "no spare mags";
  const types = [...new Set(full.map((m) => m.load))].filter((t) => t !== typeFor(calOf(u.weapon), null));
  return `+${full.length} mag${full.length === 1 ? "" : "s"}${sp.length > full.length ? ` (${sp.length - full.length} empty)` : ""}${types.length ? `, ${types.map((t) => (String(t).includes(":") ? roundName(calOf(u.weapon), t) : typeName(t))).join("/")}` : ""}`; // (another calibre: ".223 Rem FMJ")
}
// Rounds the unit's spare magazines hold loaded (the battle screen's tooltip).
export const spareRounds = (b, u) => spares(u).reduce((a, m) => a + loaded(b, u, m), 0);
// The same unit's rounds in magazines (any), for a check: gun + spares.
export const magRoundsUnit = (b, u) => num(u.mag) + spareRounds(b, u);
// What Reload does now, in words (the battle screen's Reload button).
export function reloadText(b, u) {
  if (!tracksMags(u)) return "1 action: fill the magazine from the team's ammo.";
  const p = reloadPlan(b, u);
  const n = p.cost === 1 ? "1 action" : p.cost === 2 ? "Both actions" : `${p.cost} actions`;
  const pack = p.from === "pack" ? " (both actions: the rounds are in the pack)" : "";
  if (isShellGun(u) && (p.mode === "internal" || p.mode === shellKind(u))) {
    const fromPack = p.from === "pack";
    const r = shellRange(b, u), kind = shellKind(u);
    const hi = fromPack ? shellPlan(b, u, null, 1, true).n : r.hi, lo = fromPack ? shellPlan(b, u, null, 0, true).n : r.lo;
    if (!(hi > 0)) return `${n}: ${shellsLine(b, u)}.`;
    const k = lo === hi ? `${lo}` : `${lo}–${hi}`;
    const mods = kind === "tube" ? [r.steady ? "steady hands +1" : "", r.shaken ? "shaken −1" : "", r.saddle ? `side-saddle +${r.saddle}` : ""].filter(Boolean) : [];
    const what = kind === "break" ? `both barrels (${k} ${hi === 1 ? "shell" : "shells"})` : kind === "single" ? "its one shell" : `${k} ${hi === 1 ? "shell" : "shells"} thumbed into the tube${mods.length ? ` (${mods.join(", ")})` : ""}`;
    if (fromPack) return `${n}: ${what}, dug out of the pack (none at hand). ${shellsLine(b, u)}. Get shells (1 action) brings ${SHELLS.GRAB} to hand instead, for 1-action Reloads after.`;
    return `${n}: ${what}, from the shells at hand. ${shellsLine(b, u)}. Shells in a pocket or the rig load straight in; the pack's take both actions (or Get shells, 1 action, first).`;
  }
  if (p.mode === "internal") return `${n}: ${internalOf(u.weapon) + Math.max(0, num(unitMods(u).reload))} more rounds in from ${sourceWord(u, p.from)}${pack} (an internal magazine; a speedloader or a stripper clip carried fills it at once).`;
  if (p.mode === "clip") return `${n}: a ${String(GEAR[u.clips[p.i].key].name).toLowerCase()} fills it at once.`;
  if (p.mode === "swap") return `${n}: a fresh magazine from ${u.mags[p.i].where === "pack" ? "the pack" : u.mags[p.i].where === "pocket" ? "a pocket" : "a rig pouch"} (the empty one is kept).`;
  return `${n}: no loaded spare magazine, so the one in the gun is topped up from ${sourceWord(u, p.from)}${pack}. Rounds in a pocket or the rig top it up in 1 action; the pack's, a teammate's or the team's bags take both.`;
}
// The spare magazines split by how quick they are to hand (the battle HUD, ui/battlehud.js): at hand (a rig pouch or a
// pocket: a 1-action Reload) and in the pack (2 actions), each { mags: loaded ones, empty, rounds }.
export function spareSplit(b, u) {
  const out = { hand: { mags: 0, empty: 0, rounds: 0 }, pack: { mags: 0, empty: 0, rounds: 0 } };
  for (const m of spares(u)) {
    const o = m.where === "pack" ? out.pack : out.hand, n = loaded(b, u, m);
    if (n > 0) { o.mags++; o.rounds += n; } else o.empty++;
  }
  return out;
}
