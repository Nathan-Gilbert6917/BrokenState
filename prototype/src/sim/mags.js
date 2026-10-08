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
// Units with no u.mags (made some other way, an old save's battle, a turret, a launcher) keep the old rule: Reload is 1
// action and fills the magazine.
import { GEAR } from "./data.js";
import { MAGAZINES, INTERNAL, CLIPS } from "./data-kit.js";
import { CALIBERS } from "./data-ammo.js";
import { WEAPONS } from "./combat.js";
import { modFits, platformOf, magCapOf, gunMods } from "./gunmods.js";
import { roundsOf, calOf } from "./ammo.js";
import { typeFor, roundName, typeName } from "./rounds.js";
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
  const key = u.weapon, w = WEAPONS[key], cal = calOf(key);
  if (!w || !(w.cap > 0) || w.mounted || w.launcher || w.mount || !cal) return;
  if (!INTERNAL[key] && !takesMagItems(key)) return;
  u.magsW = key;
  if (usesInternal(key, u.item)) {
    u.magMode = "internal";
    u.mags = [];
    u.clips = clipsFor(u, spots);
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
  if (usesInternal(key, gun)) { u.magMode = "internal"; u.mags = []; u.clips = []; return; }
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
  if (p.mode === "internal") return `${n}: ${internalOf(u.weapon)} more rounds in (an internal magazine; a speedloader or a stripper clip carried fills it at once).`;
  if (p.mode === "clip") return `${n}: a ${String(GEAR[u.clips[p.i].key].name).toLowerCase()} fills it at once.`;
  if (p.mode === "swap") return `${n}: a fresh magazine from ${u.mags[p.i].where === "pack" ? "the pack" : u.mags[p.i].where === "pocket" ? "a pocket" : "a rig pouch"} (the empty one is kept).`;
  return `${n}: no loaded spare magazine, so the one in the gun is topped up from the team's ammo.`;
}
