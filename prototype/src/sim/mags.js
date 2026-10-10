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
//   - no loaded spare: Top up, the magazine in the gun refilled (2 actions).
//   - an internal magazine (a pump, a lever-action, a revolver, a bolt-action's box, a double barrel: data-kit.js
//     INTERNAL): Reload (1 action) puts that many rounds in; a speedloader or a stripper clip carried (CLIPS) fills it at
//     once, once a fight (1 action from a pouch or a pocket, 2 from the pack).
//   - a shotgun (SHELLS.GUNS) is loaded from the shells at hand (pockets, rig, loose; not the pack: Get shells first):
//     a tube 2–4 shells a Reload (1 action), a double barrel both barrels at once (see shellPlan).
// Units with no u.mags (made some other way, an old save's battle, a turret, a launcher) keep the old rule: Reload is 1
// action and fills the magazine.
import { GEAR } from "./data.js";
import { MAGAZINES, INTERNAL, CLIPS } from "./data-kit.js";
import { CALIBERS, ROUND_SUPPLIES } from "./data-ammo.js";
import { WEAPONS } from "./combat.js";
import { modFits, platformOf, magCapOf, gunMods } from "./gunmods.js";
import { roundsOf, calOf } from "./ammo.js";
import { typeFor, roundName, typeName, withHand, keyFor } from "./rounds.js";
import { hash01 } from "./skills.js";

export const MAGS = {
  AP: { gun: 0, rig: 1, pocket: 1, pack: 2 }, // actions to reload from a spare kept there
  TOPUP_AP: 2, // refill the magazine in the gun with no loaded spare
  ENEMY: { soldiers: [3, 5], default: [1, 3] }, // spare magazines an enemy carries
};
const num = (v) => (Number.isFinite(v) ? v : 0);

// ---------- the items ----------
export const isMag = (it) => !!(it && MAGAZINES[it.key]);
export const isClip = (it) => !!(it && CLIPS[it.key]);
export const magSpec = (key) => MAGAZINES[key] || null;
// Does this magazine fit this gun (its platform)?
export const magFitsGun = (gunKey, magKey) => !!(MAGAZINES[magKey] && gunKey && WEAPONS[gunKey] && modFits(gunKey, magKey));
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
// The kind of round a magazine item holds for this gun's calibre (its own load, else the given default).
export function magLoad(it, cal, dflt = null) {
  const t = it && it.load;
  return cal && t && CALIBERS[cal] && CALIBERS[cal].types.includes(t) ? t : typeFor(cal, dflt);
}
// A magazine's text: "5.56 magazine (30), FMJ" / "(empty: AP)".
export const magText = (it) => (isMag(it) ? `${it.name}${it.load ? `, ${typeName(it.load)}` : ""}` : "");

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
    if (isShellGun(u)) startHand(b, u); // SHELLS: a handful of loose shells out of the team's bags
    return;
  }
  u.magMode = "box";
  const fit = fittedMag(u.item);
  const gunLoad = typeFor(cal, u.load);
  // n = cap: what a magazine holds is bounded as it is used by the rounds of its type to hand that the gun and the
  // quicker spares have not claimed (loaded).
  u.mags = [{ key: fit ? fit.key : standardMag(key), cap: staticCap, load: gunLoad, n: staticCap, where: "gun" }];
  for (const x of spots) {
    if (!isMag(x.item) || !["rig", "pocket", "pack"].includes(x.where) || !magFitsGun(key, x.item.key)) continue;
    const load = magLoad(x.item, cal, u.load);
    const cap = magCapOf(x.item.key) || MAGAZINES[x.item.key].cap;
    u.mags.push({ key: x.item.key, cap, load, n: cap, where: x.where });
  }
}
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
    u.mags.push({ key: it.key, cap, load: items ? magLoad(it, cal, u.load) : load, n: cap, where: hasRig ? "rig" : i < 2 ? "pocket" : "pack" });
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
// At hand (shellsAt), per type:
//   - box: boxes of shells in the shooter's pockets and rig pouches (the first u.handBoxes of u.boxes: fitMags puts the
//     rig's boxes right after the pockets', so a shot, which takes its round from the shooter's own boxes first, spends
//     them first), less what is already in the gun;
//   - hand: loose shells on the person out of the team's bags (u.hand[type], virtual like the magazines). The team's
//     packed rounds (b.pools) have no place on anyone, so a shotgunner takes the field with a handful of them loose
//     (START_HAND, topped up to that with what their pockets and rig hold), every other side the same (AI parity:
//     their reserve is endless, their handful the same).
//   - pack: the rest (a box in the shooter's own pack, a teammate's, the team's bags; every other side: endless). Not
//     loaded from directly: Get shells (1 action: getShells) takes GRAB of them out, up to HAND_MAX loose; a Reload with
//     none at hand is refused ("Shells are in the pack: take some out first"). The AI (reload(): doReload's "fetch"
//     plan) spends that action itself.
// Shells a Reload (1 action) puts in: a tube BASE (2 or 3, the battle's dice) + 1 steady hands (aim STEADY_AIM+: a
// colonist with Shooting 6, a power-4 enemy) - 1 shaken (hurt below half, pinned by suppressing fire, dazed by a
// flashbang), MIN..MAX; a break action both barrels (2), the pipe gun its one; never more than the room in the gun and
// the shells at hand. Off (SHELLS.on = false: tools/shotgunreloadtest.js's baseline): the old rule, INTERNAL a Reload
// from anywhere.
export const SHELLS = {
  on: true,
  GUNS: { shotgun: "tube", semishotgun: "tube", dbshotgun: "break", sawnoff: "break", pipegun: "single" }, // a box-magazine shotgun (none yet) would swap magazines
  BREAK: 2, // a break action: both barrels at once
  BASE: [2, 3],
  MIN: 1,
  MAX: 4,
  STEADY_AIM: 55,
  HURT: 0.5,
  START_HAND: 8, // loose shells on a shotgunner at the start of a fight, out of the team's bags (or the AI's)
  GRAB: 8, // shells one Get shells takes out of the pack
  HAND_MAX: 16, // loose shells out of the pack a person keeps at hand (pockets, belt)
};
const isBox = (x) => x && x.item && ROUND_SUPPLIES[x.item.key];
// Puts the boxes of rounds in rig pouches into u.boxes right after the pockets' (ammo.js boxesOf has pockets, then the
// pack) and counts the boxes at hand (u.handBoxes: pockets and rig).
function fitHandBoxes(u, spots) {
  if (!Array.isArray(u.boxes)) { u.handBoxes = 0; return; }
  const list = spots || [];
  const pockets = list.filter((x) => x.where === "pocket" && isBox(x)).length;
  const rig = list.filter((x) => x.where === "rig" && isBox(x)).map((x) => x.item);
  const add = rig.filter((it) => !u.boxes.includes(it));
  if (add.length) u.boxes.splice(pockets, 0, ...add);
  u.handBoxes = pockets + rig.length;
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
function poolShells(b, keys) {
  let n = 0;
  for (const p of b.pools || []) for (const k of keys) n += Math.max(0, Math.floor(num(p[k])));
  return n;
}
// The shells of a type this unit has: { box (pockets, rig), hand (loose, out of the bags), pack, at (box + hand) }, none
// of them counting what is in the gun. mag: the rounds in the gun to count with (a switch of type empties it).
export function shellsAt(b, u, type = null, mag = null) {
  const cal = calOf(u.weapon);
  const t = typeFor(cal, type || u.load);
  const m = mag == null ? Math.max(0, num(u.mag)) : mag;
  const claimed = typeFor(cal, u.load) === t ? m : 0;
  const hand0 = Math.max(0, num(u.hand && u.hand[t]));
  if (u.side !== "player") return { box: 0, hand: hand0, pack: Infinity, at: hand0 };
  const keys = withHand(keyFor(cal, t));
  const total = Math.max(0, roundsOf(b, u, t));
  const boxN = Math.min(total, shellsIn((u.boxes || []).slice(0, Math.max(0, u.handBoxes || 0)), keys));
  const box = Math.max(0, boxN - claimed);
  const rest = Math.max(0, total - Math.max(claimed, boxN));
  const hand = Math.min(hand0, rest);
  return { box, hand, pack: rest - hand, at: box + hand };
}
// The handful a shotgunner takes the field with (fitMags, enemyMags): loose shells of the loaded type out of the team's
// bags, up to START_HAND with what the pockets and rig hold.
function startHand(b, u) {
  u.hand = {};
  const cal = calOf(u.weapon), t = typeFor(cal, u.load);
  if (u.side !== "player") { u.hand[t] = SHELLS.START_HAND; return; }
  const keys = withHand(keyFor(cal, t));
  const box = shellsIn((u.boxes || []).slice(0, Math.max(0, u.handBoxes || 0)), keys);
  u.hand[t] = Math.max(0, Math.min(SHELLS.START_HAND - box, poolShells(b, keys)));
}
export const isShaken = (u) => !!((u.maxHp > 0 && u.hp < u.maxHp * SHELLS.HURT) || u.suppressed || u.stun);
// The shells a Reload puts in now with the dice at roll (0: BASE[0], 1: BASE[1]): { n, at, pack, steady, shaken, room }.
// type: the type loaded (a switch empties the gun first). null for a gun that is not a shotgun.
export function shellPlan(b, u, type = null, roll = 0) {
  const kind = shellKind(u);
  if (!kind) return null;
  const cal = calOf(u.weapon);
  const cur = typeFor(cal, u.load), want = type ? typeFor(cal, type) : cur;
  const m = want !== cur ? 0 : Math.max(0, num(u.mag));
  const room = Math.max(0, (u.magMax ?? 0) - m);
  const s = shellsAt(b, u, want, m);
  const steady = num(u.aim) >= SHELLS.STEADY_AIM, shaken = isShaken(u);
  const n = kind === "break" ? SHELLS.BREAK : kind === "single" ? 1 : Math.max(SHELLS.MIN, Math.min(SHELLS.MAX, SHELLS.BASE[roll ? 1 : 0] + (steady ? 1 : 0) - (shaken ? 1 : 0)));
  return { n: Math.max(0, Math.min(n, room, s.at)), at: s.at, pack: s.pack, steady, shaken, room };
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
  if (!(s.pack > 0)) return s.at > 0 ? `No more ${roundName(cal, t)} in the pack: ${s.at} at hand.` : `No ${roundName(cal, t)} in the pack.`;
  if (s.hand >= SHELLS.HAND_MAX) return `${s.hand} loose shells at hand already: room for no more.`;
  return "";
}
// Get shells (1 action; the caller takes it): GRAB shells of the type out of the pack, loose at hand. Returns the log line.
export function getShells(b, u, type = null) {
  const cal = calOf(u.weapon), t = typeFor(cal, type || u.load);
  const s = shellsAt(b, u, t);
  const n = Math.max(0, Math.min(SHELLS.GRAB, s.pack, SHELLS.HAND_MAX - s.hand));
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
export const PACK_REFUSAL = "Shells are in the pack: take some out first (Get shells, 1 action).";
// A Reload now would have to dig in the pack first (no shells of the type at hand, some in the pack).
export const shellsInPack = (b, u, type = null) => isShellGun(u) && tracksMags(u) && reloadPlan(b, u, type).mode === "fetch";

// ---------- reloading ----------
// What a Reload would do now: { mode: "swap" | "topup" | "internal" | "clip", cost (actions), i (the spare's index in
// u.mags, the clip's in u.clips), load (the type it loads), why ("" or the refusal) }. type: a type asked for (the
// Reload act's act.ammo): a spare loaded with it, else a top-up with it. The legacy checks (no gun, hands full, the type
// does not fit the calibre) are combat.js reloadRefusal's.
export function reloadPlan(b, u, type = null) {
  const cal = calOf(u.weapon);
  const cur = typeFor(cal, u.load);
  const want = type ? typeFor(cal, type) : cur;
  const sw = want !== cur;
  const max = u.magMax ?? 0, m = u.mag ?? 0;
  if (u.magMode === "internal") {
    if (!sw && m >= max) return { mode: "internal", cost: 1, load: want, why: `The ${gunWord(u)} is full (${max}/${max}).` };
    const pool = avail(b, u, want);
    if (pool < 1) return { mode: "internal", cost: 1, load: want, why: `No ammo left to load (no ${roundName(cal, want)}).` };
    if (!sw && u.side === "player" && pool <= m) return { mode: "internal", cost: 1, load: want, why: `No spare ammo (${roundName(cal, want)}): every round left is already loaded.` };
    const clips = u.clips || [];
    let ci = -1;
    for (let i = 0; i < clips.length; i++) if (!clips[i].used && (ci < 0 || MAGS.AP[clips[i].where] < MAGS.AP[clips[ci].where])) ci = i;
    const room = sw ? max : max - m;
    if (isShellGun(u) && shellsAt(b, u, want, sw ? 0 : m).at < 1) return { mode: "fetch", cost: 1, load: want, why: "" }; // SHELLS: none at hand, some in the pack (Get shells; the AI's reload() does it)
    if (ci >= 0 && room > internalOf(u.weapon)) return { mode: "clip", cost: MAGS.AP[clips[ci].where] || 1, i: ci, load: want, why: "" };
    return { mode: "internal", cost: 1, load: want, why: "" };
  }
  // A box magazine: the next loaded spare (its type; with no type asked, any type when its own has none).
  let best = -1, bestAny = -1;
  const better = (i, j) => j < 0 || MAGS.AP[u.mags[i].where] < MAGS.AP[u.mags[j].where] || (MAGS.AP[u.mags[i].where] === MAGS.AP[u.mags[j].where] && loaded(b, u, u.mags[i]) > loaded(b, u, u.mags[j]));
  u.mags.forEach((g, i) => {
    if (g.where === "gun" || loaded(b, u, g) < 1) return;
    if (g.load === want) { if (better(i, best)) best = i; }
    else if (!type && better(i, bestAny)) bestAny = i;
  });
  if (!sw && m >= max && best < 0) return { mode: "topup", cost: MAGS.TOPUP_AP, load: want, why: `The ${gunWord(u)} is full (${max}/${max}).` };
  if (!sw && m >= max) return { mode: "swap", cost: MAGS.AP[u.mags[best].where], i: best, load: want, why: `The ${gunWord(u)} is full (${max}/${max}).` };
  const pick = best >= 0 ? best : bestAny; // none of its own type loaded: the next loaded magazine of another (a top-up only with no loaded spare left)
  if (pick >= 0) return { mode: "swap", cost: MAGS.AP[u.mags[pick].where] || 1, i: pick, load: u.mags[pick].load, why: "" };
  const pool = avail(b, u, want);
  if (pool < 1) return { mode: "topup", cost: MAGS.TOPUP_AP, load: want, why: `No ammo left to load (no ${roundName(cal, want)}).` };
  if (!sw && u.side === "player" && pool <= m) return { mode: "topup", cost: MAGS.TOPUP_AP, load: want, why: `No spare ammo (${roundName(cal, want)}): every round left is already loaded.` };
  return { mode: "topup", cost: MAGS.TOPUP_AP, load: want, why: "" };
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
    if (g) { g.n = u.mag ?? 0; g.where = fresh.where; } // the emptied magazine is kept: where the fresh one came from
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
  if (plan.mode === "fetch") return getShells(b, u, plan.load); // SHELLS: nothing at hand: shells out of the pack first (the AI's reload)
  if (plan.mode === "internal" && isShellGun(u)) { // SHELLS: shells thumbed in from what is at hand
    const kind = shellKind(u);
    const roll = kind === "tube" && b.rng && typeof b.rng.int === "function" ? b.rng.int(0, 1) : 0;
    const sp = shellPlan(b, u, plan.load, roll);
    const sw = plan.load !== was;
    const before = sw ? 0 : u.mag || 0;
    useHand(b, u, plan.load, sp.n, before);
    if (sw) { u.load = plan.load; u.mag = 0; }
    u.mag = Math.min(max, before + sp.n);
    u.lastShells = sp.n; // tools/shotgunreloadtest.js
    const what = `${sp.n} ${sp.n === 1 ? "shell" : "shells"}`;
    const left = u.side === "player" ? `, ${shellsAt(b, u).at} left at hand` : "";
    const shaky = sp.shaken && kind === "tube" ? ", shaky hands" : "";
    if (kind === "break") return `${u.name} breaks open the ${gunWord(u)} and drops in ${sp.n === 1 ? "a shell" : what}${sw ? ` of ${roundName(cal, u.load)}` : ""} (${shown(b, u)}/${max}${left}).`;
    return sw
      ? `${u.name} loads the ${gunWord(u)} with ${roundName(cal, u.load)}: ${what} in (${shown(b, u)}/${max}${left}${shaky}).`
      : `${u.name} ${kind === "tube" ? "racks in" : "loads"} ${what} (${shown(b, u)}/${max}${left}${shaky}).`;
  }
  if (plan.mode === "internal") {
    if (plan.load !== was) { u.load = plan.load; u.mag = 0; }
    const room = Math.max(0, avail(b, u, u.load) - (u.mag || 0));
    u.mag = Math.min(max, (u.mag || 0) + Math.min(internalOf(u.weapon) || max, room));
    return plan.load !== was ? `${u.name} loads the ${gunWord(u)} with ${roundName(cal, u.load)} (${shown(b, u)}/${max}).` : `${u.name} reloads the ${gunWord(u)} (${shown(b, u)}/${max}).`;
  }
  // Top up: the magazine in the gun refilled.
  u.load = plan.load;
  const g = gunEntry(u);
  if (g) g.load = u.load;
  u.mag = Math.min(max, avail(b, u, u.load));
  return plan.load !== was ? `${u.name} loads the ${gunWord(u)} with ${roundName(cal, u.load)} (${shown(b, u)}/${max}): no spare magazine, a top-up (2 actions).` : `${u.name} reloads the ${gunWord(u)} (${shown(b, u)}/${max}): no spare magazine left, a top-up (2 actions).`;
}
const shown = (b, u) => (u.side === "player" ? Math.min(u.mag || 0, Math.max(0, roundsOf(b, u))) : u.mag || 0);
const gunWord = (u) => { const n = u.weaponName || (WEAPONS[u.weapon] && WEAPONS[u.weapon].name) || "gun"; return /^[A-Z][a-z]/.test(n) ? n[0].toLowerCase() + n.slice(1) : n; };

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
  return `+${full.length} mag${full.length === 1 ? "" : "s"}${sp.length > full.length ? ` (${sp.length - full.length} empty)` : ""}${types.length ? `, ${types.map(typeName).join("/")}` : ""}`;
}
// Rounds the unit's spare magazines hold loaded (the battle screen's tooltip).
export const spareRounds = (b, u) => spares(u).reduce((a, m) => a + loaded(b, u, m), 0);
// The same unit's rounds in magazines (any), for a check: gun + spares.
export const magRoundsUnit = (b, u) => num(u.mag) + spareRounds(b, u);
// What Reload does now, in words (the battle screen's Reload button).
export function reloadText(b, u) {
  if (!tracksMags(u)) return "1 action: fill the magazine from the team's ammo.";
  const p = reloadPlan(b, u);
  const n = p.cost === 1 ? "1 action" : `${p.cost} actions`;
  if (p.mode === "fetch") return `${PACK_REFUSAL} ${shellsLine(b, u)}.`;
  if (p.mode === "internal" && isShellGun(u)) {
    const r = shellRange(b, u), kind = shellKind(u);
    if (!(r.hi > 0)) return `${n}: ${shellsLine(b, u)}.`;
    const k = r.lo === r.hi ? `${r.lo}` : `${r.lo}–${r.hi}`;
    const mods = kind === "tube" ? [r.steady ? "steady hands +1" : "", r.shaken ? "shaken −1" : ""].filter(Boolean) : [];
    const what = kind === "break" ? `both barrels (${k} ${r.hi === 1 ? "shell" : "shells"})` : kind === "single" ? "its one shell" : `${k} ${r.hi === 1 ? "shell" : "shells"} thumbed into the tube${mods.length ? ` (${mods.join(", ")})` : ""}`;
    return `${n}: ${what}, from the shells at hand. ${shellsLine(b, u)}. Shells in a pocket or the rig load straight in; the pack's need Get shells (1 action) first.`;
  }
  if (p.mode === "internal") return `${n}: ${internalOf(u.weapon)} more rounds in (an internal magazine; a speedloader or a stripper clip carried fills it at once).`;
  if (p.mode === "clip") return `${n}: a ${String(GEAR[u.clips[p.i].key].name).toLowerCase()} fills it at once.`;
  if (p.mode === "swap") return `${n}: a fresh magazine from ${u.mags[p.i].where === "pack" ? "the pack" : u.mags[p.i].where === "pocket" ? "a pocket" : "a rig pouch"} (the empty one is kept).`;
  return `${n}: no loaded spare magazine, so the one in the gun is topped up from the team's ammo.`;
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
