// @ts-check
// Magazines in battle (docs/weapons-overhaul-plan.md section 15; the user's decisions in section 20: R13 a magazine from
// a chest rig, a pouch or a pocket reloads in 1 action, from the pack in 2).
//
// 2026-10-18 (the user's rules, docs/reload-rules.md): PHYSICAL ROUNDS for your side. In a fight the rounds in a gun
// and in each magazine are real: a stack (roundstack.js, firing order, the chamber first) on the unit (u.stack: the
// gun's) and on each magazine item (item.stack). A shot takes its rounds off the top of the gun's stack (ammo.js
// takeBattleRounds); the chamber's round decides the shot (u.load follows it: roundstack.js syncGun).
//   - Who feeds a Reload: ONLY what the survivor carries (pockets, rig pouches, pack: u.boxes). Never a teammate's
//     rounds, never the team's bags, a vehicle or a base's stock (roundSources). A reload takes the rounds out of those
//     items (item.dur) as it loads them: a 6-shell tube with 3 in gets 3, and 3 leave the pocket.
//   - Loose rounds: up to MAGS.LOOSE (6) a Reload, whatever the gun (a tube, a cylinder, a bolt's box, a box magazine
//     topped up in the gun, a spare loaded by hand in the Inventory window): a 12-shell tube from empty is two Reloads.
//     Any mix of the rounds the gun takes, in the order picked (the first picked is in the chamber): reloadPlan with
//     { rounds: [{ i, n }] } (i: the item's index in u.boxes, reloadOptions lists them); with no pick, the chamber's
//     own round from the nearest place (a pocket or the rig 1 action; the pack both, only when nothing is at hand).
//   - A spare magazine: { mag: j } (the j-th of u.mags) swaps it in for its place's cost (rig 1, pocket 1, pack 2). The
//     swap is physical: the fresh magazine becomes the gun's fitted one (gun.mods.mag), the one that was in the gun
//     (or the gun's own standard magazine, made a thing of) goes where the fresh one lay, with the rounds it had.
//     Magazines hold an assortment too (item.stack); the chamber is the magazine's top.
//   - Unloading a spare in a fight (unloadMagFrom; combat.js invAct "unload") puts every round in it back as loose
//     rounds on the person, each kind its own stack; loading one by hand (loadMagPlan / loadMagFrom: rounds dropped onto
//     it) puts up to MAGS.LOOSE in on top.
//   - The fight's start (fillUnit, combat.js createBattle): the gun and the spares are filled physically, from the
//     gun's own rounds (gunload.js item.loaded), then the person's own rounds, then the team's bags (the rounds a team
//     forming at a base took for its guns, gunrounds.js loadoutRounds; every gun on the team before anyone's spares,
//     then a spare each in turn: combat.js fillTeamSpares); nothing of a teammate's. When the fight ends
//     (gunload.js returnStacks) what is left in the gun and the magazines goes back onto the person as loose rounds (or
//     into the stores), so out of a fight the rounds are counted where they always were.
// Enemies and the third side keep the old rule (an endless reserve, u.mags counters, a shotgun's handful): planLegacy /
// doLegacy below. A unit of yours from a save made before this is brought over on load (migrateUnitStacks).
// Units with no u.mags (made some other way, a turret, a launcher) keep the oldest rule: Reload is 1 action and fills
// the magazine (combat.js reload).
import { GEAR } from "./data.js";
import { MAGAZINES, INTERNAL, CLIPS } from "./data-kit.js";
import { CALIBERS, ROUND_SUPPLIES, CAL_ACCEPTS } from "./data-ammo.js";
import { WEAPONS } from "./combat.js";
import { modFits, platformOf, magCapOf, gunMods, unitMods, modLabel } from "./gunmods.js";
import { roundsOf, calOf, loadRefusal, gunLoads } from "./ammo.js";
import { typeFor, roundName, typeName, withHand, keyFor, rebaseLoad, loadCal, loadId, roundOf } from "./rounds.js";
import { isRoundItem, amountOf, roundItems, roomIn } from "./itemstack.js";
import { newItem, rigPouches, packOf, stow, carriedSpots } from "./inventory.js"; // call-time only (the import cycle through combat.js)
import { stackN, topKey, copyStack, tidyStack, pushTop, pushBottom, takeTop, stackText, loadOfKey, syncGun } from "./roundstack.js";
import { hash01 } from "./skills.js";

export const MAGS = {
  AP: { gun: 0, rig: 1, pocket: 1, pack: 2 }, // actions to reload from a spare kept there
  TOPUP_AP: 2, // (legacy sides) refill the magazine in the gun with no loaded spare, from the team's bags
  SOURCE_AP: { hand: 1, pack: 2 }, // rounds (not a magazine) loaded from the unit's own pockets or rig, or from its pack
  LOOSE: 6, // rounds one Reload (or one magazine loaded by hand) puts in loose, at most (2026-10-18 user rule)
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
// A gun whose magazine has been taken out (Remove magazine: itemacts.js out of a fight, removeMagUnit in one): it holds
// the round in the chamber and nothing more until a magazine goes in (insertMag, a swap).
export const magOut = (gun) => !!(gun && gun.magOut);
// A gun with a detachable magazine (a box magazine that comes out: a pistol, a rifle on its STANAG, an Uzi), not a
// fixed box, a tube, a cylinder or a stripper-clip gun (data-kit.js INTERNAL with nothing fitted).
export const detachable = (gun) => !!(gun && WEAPONS[gun.key] && calOf(gun.key) && !WEAPONS[gun.key].launcher && takesMagItems(gun.key) && !usesInternal(gun.key, gun));
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
const magCapacity = (key) => magCapOf(key) || (MAGAZINES[key] ? MAGAZINES[key].cap : 0);

// ---------- a battle unit's magazines ----------
export const tracksMags = (u) => !!(u && Array.isArray(u.mags) && u.magsW === u.weapon);
export const gunEntry = (u) => (tracksMags(u) ? u.mags.find((m) => m.where === "gun") || null : null);
export const spares = (u) => (tracksMags(u) ? u.mags.filter((m) => m.where !== "gun") : []);
export const isInternalUnit = (u) => tracksMags(u) && u.magMode === "internal";
// One of yours with physical rounds (u.stack: the gun's; item.stack: each spare's).
// Physical rounds for every person on the map (docs/adr/0001-ai-parity.md: yours, and anyone else built from a person,
// fighters.js u.who): what they carry is all they have. A unit made some other way (a turret) keeps the old rule.
export const physical = (u) => !!(u && (u.side === "player" || u.who));
export const isStacked = (u) => !!(u && physical(u) && Array.isArray(u.stack) && tracksMags(u));
const stacked = isStacked;
// The load a spare holds now: its stack's top (yours), else the entry's.
const entryLoad = (cal, g) => (g && g.item && Array.isArray(g.item.stack) && g.item.stack.length ? loadOfKey(cal, topKey(g.item.stack)) || g.load : g.load);
// What a magazine of this unit holds now: yours the rounds in it (item.stack); other sides a spare's virtual count,
// bounded (legacy player units) by the rounds of its type to hand that the gun and the spares before it have not claimed.
function loaded(b, u, m) {
  if (m.where === "gun") return stacked(u) ? stackN(u.stack) : Math.max(0, num(u.mag));
  if (stacked(u)) return m.item && Array.isArray(m.item.stack) ? stackN(m.item.stack) : 0;
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
// Rounds of a type left to hand for a legacy unit's next magazine (a player's from a save made before; others: endless).
const avail = (b, u, t) => (u.side === "player" ? Math.max(0, roundsOf(b, u, t)) : Infinity);
// Clips for an internal magazine: [{ key, where, used }].
const clipsFor = (u, spots) => spots.filter((x) => CLIPS[x.item.key] && CLIPS[x.item.key].weapons.includes(u.weapon)).map((x) => ({ key: x.item.key, where: x.where, used: false }));
// Keeps a unit's entries true to the rounds (yours): the gun entry counts u.stack, each spare its item's stack; the
// load of each is its top.
export function syncMags(u) {
  if (!tracksMags(u) || !physical(u)) return;
  const cal = calOf(u.weapon);
  for (const m of u.mags) {
    if (m.where === "gun") { m.n = stackN(u.stack); const l = cal ? loadOfKey(cal, topKey(u.stack)) : null; if (l) m.load = l; continue; }
    const st = m.item && Array.isArray(m.item.stack) ? m.item.stack : null;
    m.n = st ? stackN(st) : 0;
    const l = st && cal ? loadOfKey(cal, topKey(st)) : null;
    if (l) m.load = l;
  }
}

// Your person's magazines (combat.js playerUnit, after u.load and u.item are set, before loadMag). spots: inventory.js
// carriedSpots(s) (what they carry and where: pockets, rig pouches, the pack); s: the survivor (each spare entry then
// knows the slot it lies in: list, i; a swap puts the other magazine there). Nothing is filled here: fillUnit does
// that once, as the fight starts.
export function fitMags(b, u, spots, staticCap, s = null) {
  u.mags = null; u.magsW = null; u.clips = null; u.magMode = null;
  fitHandBoxes(u, spots); // the rounds at hand: boxes in the pockets and the rig, the first u.handBoxes of u.boxes
  const key = u.weapon, w = WEAPONS[key], cal = calOf(key);
  if (!w || !(w.cap > 0) || w.mounted || w.launcher || w.mount || !cal) return;
  if (!INTERNAL[key] && !takesMagItems(key)) return;
  u.magsW = key;
  if (physical(u) && !Array.isArray(u.stack)) u.stack = [];
  if (usesInternal(key, u.item)) {
    u.magMode = "internal";
    u.mags = [];
    u.clips = clipsFor(u, spots);
    if (isShellGun(u) && !physical(u)) startHand(b, u); // SHELLS: a handful out of an endless bag (a person: every shell is a thing they carry)
    if (physical(u)) u.hand = null;
    return;
  }
  u.magMode = "box";
  const fit = fittedMag(u.item);
  const gunLoad = typeFor(cal, u.load);
  u.mags = [{ key: fit ? fit.key : standardMag(key), cap: staticCap, load: gunLoad, n: staticCap, where: "gun", ...(magOut(u.item) ? { out: true } : {}) }]; // out: its magazine taken out (removeMag): the chamber only
  for (const x of spots) { const m = spareFor(key, cal, u.load, x, s); if (m) u.mags.push(m); }
  if (physical(u)) syncMags(u);
}
// The spare a carried thing (a carriedSpots entry) makes for this gun, or null: a magazine in a pocket, a rig pouch or
// the pack that fits the gun and holds a calibre its load can be. The entry keeps the item (its stack is the rounds
// in it) and, with s, the slot it lies in (list[i]).
function spareFor(key, cal, uLoad, x, s = null) {
  if (!x || !isMag(x.item) || !["rig", "pocket", "pack"].includes(x.where) || !magFitsGun(key, x.item.key)) return null;
  const load = magLoad(x.item, cal, uLoad, key);
  if (!magTakes(x.item.key, loadCal(cal, load))) return null; // (the gun's load is a calibre this magazine cannot hold)
  const cap = magCapacity(x.item.key);
  const m = { key: x.item.key, cap, load, n: x.item.unloaded ? 0 : cap, where: x.where, item: x.item };
  if (s) {
    const i = Number(String(x.loc || "").split(":").pop());
    const list = x.where === "pocket" ? s.pockets : x.where === "rig" ? rigPouches(s) : packOf(s);
    if (list && Number.isInteger(i) && list[i] === x.item) { m.list = list; m.i = i; }
  }
  return m;
}
// The u.mags entry of the magazine item at an inventory location on the unit's survivor (spots: inventory.js
// carriedSpots(s)), or null (no such item, not one of this gun's, or no magazines tracked).
export function magEntryAt(u, spots, loc) {
  if (!tracksMags(u) || u.magMode !== "box") return null;
  const x = (spots || []).find((y) => y.loc === loc);
  if (!x) return null;
  const hit = u.mags.find((m) => m.where !== "gun" && m.item === x.item);
  if (hit) return hit;
  // (a legacy unit's entries: the k-th magazine of its key in its place among the spots is the k-th entry of that key and place)
  const key = u.weapon, cal = calOf(key);
  const i = spots.indexOf(x);
  if (!spareFor(key, cal, u.load, x)) return null;
  let k = 0;
  for (let j = 0; j < i; j++) if (spots[j].item.key === x.item.key && spots[j].where === x.where && spareFor(key, cal, u.load, spots[j])) k++;
  const same = u.mags.filter((m) => m.where !== "gun" && m.key === x.item.key && m.where === x.where);
  return same[k] || same[same.length - 1] || null;
}
// What a magazine of the unit holds now.
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
    const cap = magCapacity(it.key);
    u.mags.push({ key: it.key, cap, load: items ? magLoad(it, cal, u.load, key) : load, n: cap, where: hasRig ? "rig" : i < 2 ? "pocket" : "pack" });
  });
}
// How many spare magazines an enemy of this kit carries (own dice).
export function enemyMagCount(kind, ...salt) {
  const [lo, hi] = MAGS.ENEMY[kind] || MAGS.ENEMY.default;
  return lo + Math.floor(hash01("enemymags", kind, ...salt) * (hi - lo + 1));
}

// ---------- the rounds a fighter of yours carries (the only source of a Reload) ----------
// The round items this unit carries that its gun takes, in the order they are reached (u.boxes: pockets, rig pouches,
// the pack; ammo.js boxesOf): [{ i (the index in u.boxes), item, where: "pocket" | "rig" | "pack", k (the round's key),
// n (rounds in it), load (as a load of the gun), cal, type, hand (a handload), loose, cost (actions: a pocket or the rig
// 1, the pack 2) }]. forMag: only rounds that magazine holds too. Never a teammate's, never the team's bags.
export function roundSources(u, forMag = null) {
  const out = [];
  const cal = calOf(u && u.weapon);
  if (!cal) return out;
  const boxes = u.boxes || [], hb = Math.max(0, num(u.handBoxes)), pb = u.pocketBoxes == null ? hb : Math.max(0, num(u.pocketBoxes));
  boxes.forEach((it, i) => {
    if (!it || !(num(it.dur) >= 1)) return;
    const r = roundOf(it.key);
    if (!r) return;
    const load = loadId(cal, r.cal, r.type);
    if (loadRefusal(u.weapon, load)) return; // ammo.js: a calibre the chamber refuses
    if (forMag && !magTakes(forMag, r.cal)) return;
    out.push({ i, item: it, where: i < pb ? "pocket" : i < hb ? "rig" : "pack", k: it.key, n: Math.floor(num(it.dur)), load, cal: r.cal, type: r.type, hand: !!(/** @type {any} */ (r).hand), loose: !!it.loose, cost: MAGS.SOURCE_AP[i < hb ? "hand" : "pack"] });
  });
  return out;
}
// Up to n rounds of a load off the nearest place: the pockets and the rig first (the factory rounds before the bench's
// handloads); only with none at hand, the pack. Never both in one Reload (the nearest decides the cost). Returns runs
// [{ i, k, n, where }].
function autoRuns(u, load, n) {
  const cal = calOf(u.weapon);
  const keys = withHand(keyFor(cal, load));
  const all = roundSources(u).filter((s) => keys.includes(s.k));
  const tier = (list) => { const out = []; let left = n; for (const k of keys) for (const s of list) { if (left <= 0) break; if (s.k !== k) continue; const q = Math.min(left, s.n); if (q > 0) { out.push({ i: s.i, k, n: q, where: s.where }); left -= q; } } return out; };
  const hand = tier(all.filter((s) => s.where !== "pack"));
  return hand.length ? hand : tier(all.filter((s) => s.where === "pack"));
}
// Takes the runs' rounds out of the items they name.
function takeRuns(u, runs) {
  for (const r of runs || []) { const it = (u.boxes || [])[r.i]; if (it) it.dur = Math.max(0, Math.floor(num(it.dur)) - Math.floor(num(r.n))); }
}
const runsN = (runs) => (runs || []).reduce((a, r) => a + Math.max(0, Math.floor(num(r.n))), 0);
const runsFrom = (runs) => ((runs || []).some((r) => r.where === "pack") ? "pack" : "hand");
// Fills a stack with rounds of a load up to cap: the person's own rounds first (pockets, rig, pack), then the team's
// bags (b.pools: at a fight's start only). Nothing of that load (and the stack empty): the first other load the gun
// (and the magazine) takes that there is any of. Returns { n, load } (the load used, or null when nothing went in).
function fillTo(b, u, st, cap, load, magKey = null, pools = true) {
  const cal = calOf(u.weapon);
  if (!(Math.max(0, cap - stackN(st)) > 0)) return { n: 0, load: null };
  const tryLoad = (l) => {
    if (!l || loadRefusal(u.weapon, l) || (magKey && !magTakes(magKey, loadCal(cal, l)))) return 0;
    let want = Math.max(0, cap - stackN(st)), got = 0;
    for (const k of withHand(keyFor(cal, l))) {
      if (want <= 0) break;
      for (const src of roundSources(u, magKey)) {
        if (want <= 0) break;
        if (src.k !== k) continue;
        const q = Math.min(want, src.n);
        if (q > 0) { src.item.dur = Math.floor(num(src.item.dur)) - q; pushBottom(st, k, q); want -= q; got += q; }
      }
      for (const p of (pools && b && b.pools) || []) {
        if (want <= 0) break;
        const q = Math.min(want, Math.max(0, Math.floor(num(p && p[k]))));
        if (q > 0) { p[k] -= q; pushBottom(st, k, q); want -= q; got += q; }
      }
    }
    return got;
  };
  let n = tryLoad(load);
  let used = n > 0 ? load : null;
  if (!(n > 0) && !stackN(st)) for (const l of gunLoads(u.weapon)) { if (l === load) continue; n = tryLoad(l); if (n > 0) { used = l; break; } }
  return { n, load: used };
}
// Loads the gun and the spares physically (combat.js createBattle as the fight starts; refitUnit for a gun taken up in
// the middle of one): the gun from the rounds kept on it (gunload.js item.loaded: exactly those, gun: false says so),
// then what they carry, then the team's bags (pools: false in the middle of a fight: never the bags then); each spare
// the same (one Unloaded in the item menu stays empty; one with a stack already keeps it). spares: false loads the gun
// only, a number at most that many spares not loaded yet (combat.js fillBattleUnit: every gun on the team first, then
// a spare each in turn, so the bags never fill one person's spares while a teammate's gun starts empty). Returns how
// many spares it loaded (or left empty). Anyone of another side (a person: fighters.js) loads from what they carry only.
// top (the fight's start, combat.js fillBattleUnit; 2026-10-20): out of a fight a gun and its magazines keep the
// rounds left in them (gunload.js returnStacks), so as the next fight starts a gun with rounds of its own and a magazine
// with a stack are topped up too (the record first, then the same sources), each magazine once a fight (TOPPED). A gun
// or a magazine Unloaded by hand (item.unloaded) stays empty.
const TOPPED = new WeakMap(); // battle → the magazine items topped up at its start
const topped = (b) => { const k = b || TOPPED; let w = TOPPED.get(k); if (!w) TOPPED.set(k, (w = new WeakSet())); return w; };
/** @returns {number} */
export function fillUnit(b, u, { gun = true, pools = true, spares: withSpares = /** @type {boolean | number} */ (true), top = false } = {}) {
  if (!tracksMags(u) || !physical(u)) return 0;
  if (u.side !== "player") pools = false; // the team's bags are yours: anyone else has only what they carry
  if (!Array.isArray(u.stack)) u.stack = [];
  const cal = calOf(u.weapon);
  const it = u.item;
  const pref = typeFor(cal, u.load); // the load it takes the field with (ammo.js chooseLoad: item.load), before the record's chamber speaks
  let rec = false;
  if (it && it.loaded) { // a gun with its own rounds on it (put down earlier, found, handed over, left from the last fight): those first (topped up only at a fight's start: top)
    const r = it.loaded;
    delete it.loaded;
    u.stack = Array.isArray(r.stack) ? copyStack(r.stack) : num(r.n) > 0 && r.key ? [{ k: r.key, n: Math.floor(r.n) }] : [];
    const l = loadOfKey(cal, topKey(u.stack));
    if (l) u.load = l;
    rec = true;
  }
  if (gun && !(it && it.unloaded) && (!rec || top)) { const got = fillTo(b, u, u.stack, Math.max(0, num(u.magMax)), rec ? pref : typeFor(cal, u.load), null, pools); if (got.load && !rec) u.load = got.load; }
  syncGun(u, cal);
  let left = withSpares === true ? Infinity : Math.max(0, Number(withSpares) || 0), done = 0;
  const seen = topped(b);
  for (const m of spares(u)) {
    if (!(left > 0)) break;
    if (!m.item) continue;
    if (Array.isArray(m.item.stack) && (!top || seen.has(m.item))) continue; // loaded already (by hand, or when the gun was taken up; topped up at this fight's start)
    seen.add(m.item);
    if (!Array.isArray(m.item.stack)) m.item.stack = [];
    left--; done++;
    if (m.item.unloaded) continue; // itemacts.js: kept empty on purpose
    fillTo(b, u, m.item.stack, m.cap, m.load, m.key, pools);
  }
  syncMags(u);
  return done;
}
// A unit of yours from a save made before physical rounds (u.mags counters, no u.stack): the rounds it showed loaded
// become real, out of what it carries and the team's bags (save.js, on load).
export function migrateUnitStacks(b, u, s) {
  if (!u || u.side !== "player" || !tracksMags(u) || Array.isArray(u.stack) || !s) return;
  const cal = calOf(u.weapon);
  const old = (u.mags || []).filter((m) => m.where !== "gun").map((m) => ({ key: m.key, where: m.where, n: Math.max(0, num(m.n)), load: m.load }));
  const gunN = Math.max(0, Math.min(num(u.mag), num(u.magMax)));
  const gunLoad = typeFor(cal, u.load);
  const was = u.mags;
  u.stack = [];
  fitMags(b, u, carriedSpots(s), Math.max(0, num(u.magMax)), s);
  if (!tracksMags(u)) { u.mags = was; u.stack = null; return; }
  fillTo(b, u, u.stack, gunN, gunLoad);
  syncGun(u, cal);
  for (const m of spares(u)) {
    if (!m.item) continue;
    m.item.stack = [];
    const j = old.findIndex((o) => o.key === m.key && o.where === m.where);
    const o = j >= 0 ? old.splice(j, 1)[0] : null;
    if (!o || !(o.n > 0)) continue;
    fillTo(b, u, m.item.stack, Math.min(m.cap, o.n), o.load || m.load, m.key);
  }
  syncMags(u);
}

// ---------- shotgun shells ----------
// Your side (2026-10-18): a shotgun is loaded like every gun, from the shells on the person (roundSources), up to
// MAGS.LOOSE a Reload, any mix; shellsAt counts them (box: pockets and rig; pack), shellPlan says how many a Reload puts
// in. Get shells is gone for your people (nothing is dug out first: the pack loads straight in for both actions).
// Enemies and the third side keep the old rule (the user's calls, 2026-10-09): loaded a shell at a time from the shells
// AT HAND: a tube BASE (2 or 3, the dice) + 1 steady hands (aim STEADY_AIM+) − 1 shaken, MIN..MAX; a break action both
// barrels; START_HAND loose shells out of an endless bag, Get shells (GRAB) for more.
export const SHELLS = {
  on: true,
  GUNS: { shotgun: "tube", semishotgun: "tube", dbshotgun: "break", sawnoff: "break", pipegun: "single", tacpump: "tube", pump20: "tube", ou12: "break", ou20: "break", single12: "single" }, // a box-magazine shotgun (none yet) would swap magazines
  BREAK: 2, // a break action: both barrels at once
  BASE: [2, 3],
  MIN: 1,
  MAX: 4,
  STEADY_AIM: 55,
  HURT: 0.5,
  START_HAND: 8, // loose shells an enemy (or third-side) shotgunner starts a fight with, out of an endless bag
  GRAB: 8, // shells one Get shells takes out of the pack (other sides)
  HAND_MAX: 16, // loose shells out of the pack a person keeps at hand (other sides)
  SADDLE: 6, // shells a side-saddle (an elastic shell holder) holds on the gun (other sides)
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
// The shells of a type this unit can load: { box (pockets, rig), hand (loose, out of the pack: other sides), pack, at
// (box + hand) }. Yours: the shells on the person past the ones in the gun (physical: the gun's are not counted).
// Other sides: the handful and an endless bag. mag: (legacy) the rounds in the gun to count with.
export function shellsAt(b, u, type = null, mag = null) {
  const cal = calOf(u.weapon);
  const t = typeFor(cal, type || u.load);
  if (stacked(u)) {
    const keys = withHand(keyFor(cal, t));
    const srcs = roundSources(u).filter((s) => keys.includes(s.k));
    const box = srcs.filter((s) => s.where !== "pack").reduce((a, s) => a + s.n, 0);
    const pack = srcs.filter((s) => s.where === "pack").reduce((a, s) => a + s.n, 0);
    return { box, hand: 0, pack, at: box };
  }
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
// The loose shells an enemy (or third-side) shotgunner takes the field with: START_HAND out of an endless reserve, a
// side-saddle's and a buttstock holder's on top.
function startHand(b, u) {
  u.hand = {};
  const cal = calOf(u.weapon), t = typeFor(cal, u.load);
  const cuff = Math.max(0, num(unitMods(u).hand)); // a buttstock shell holder (gunmods.js hand)
  const hold = saddleHold(u) + cuff;
  u.hand[t] = (u.side !== "player" ? SHELLS.START_HAND : 0) + hold;
}
export const isShaken = (u) => !!((u.maxHp > 0 && u.hp < u.maxHp * SHELLS.HURT) || u.suppressed || u.stun);
// The shells a Reload puts in now: { n, at, pack, steady, shaken, saddle, room }. Yours: up to MAGS.LOOSE of the shells
// at hand (fromPack: the pack's too), as many as the room. Other sides: the dice at roll (0: BASE[0], 1: BASE[1]).
// null for a gun that is not a shotgun.
export function shellPlan(b, u, type = null, roll = 0, fromPack = false) {
  const kind = shellKind(u);
  if (!kind) return null;
  const cal = calOf(u.weapon);
  const cur = typeFor(cal, u.load), want = type ? typeFor(cal, type) : cur;
  if (stacked(u)) {
    const m = stackN(u.stack);
    const room = Math.max(0, (u.magMax ?? 0) - m);
    const s = shellsAt(b, u, want);
    return { n: Math.max(0, Math.min(MAGS.LOOSE, room, fromPack ? s.at + s.pack : s.at)), at: s.at, pack: s.pack, steady: false, shaken: false, saddle: 0, room };
  }
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
// Why Get shells cannot be done now ("" when it can): other sides only (yours load straight from what they carry).
export function getShellsRefusal(b, u, type = null) {
  if (!isShellGun(u)) return "Only a shotgun is loaded from loose shells.";
  if (stacked(u)) return "Shells load straight from what they carry (a pocket or the rig 1 action, the pack both): nothing to get out first.";
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
// Takes the n shells just loaded off what is at hand (legacy): the boxes in the pockets and the rig first, then the loose ones.
function useHand(b, u, t, n, magBefore) {
  const s = shellsAt(b, u, t, magBefore);
  const fromHand = Math.max(0, n - s.box);
  if (fromHand > 0 && u.hand) u.hand[t] = Math.max(0, s.hand - fromHand);
}
// "3 shells at hand (pockets, rig), 22 in the pack" for the Reload button.
export function shellsLine(b, u, type = null) {
  if (!isShellGun(u)) return "";
  const s = shellsAt(b, u, type);
  const pk = u.side !== "player" ? "" : s.pack > 0 ? `, ${s.pack} in the pack` : ", none in the pack";
  return `${s.at} ${s.at === 1 ? "shell" : "shells"} at hand${pk}`;
}
// Where the rounds of the type this unit cannot load are (a base's defence: its stock, a teammate's pockets), for the
// refusal: " The base's 40 are in its stock and 12 are on teammates, not to hand in a fight: …" / "" (nowhere else).
export function teamNote(b, u, type = null) {
  if (u.side !== "player" || !(stockFight(b) || stacked(u))) return "";
  const cal = calOf(u.weapon), t = typeFor(cal, type || u.load), keys = withHand(keyFor(cal, t));
  let pool = 0;
  for (const p of b.pools || []) for (const k of keys) pool += Math.max(0, Math.floor(num(p[k])));
  let mates = 0;
  for (const o of b.units || []) if (o !== u && o.side === u.side && o.boxes) mates += shellsIn(o.boxes, keys);
  if (!(pool > 0) && !(mates > 0)) return "";
  const parts = [];
  if (pool > 0) parts.push(`${stockFight(b) ? "the base's" : "the team's"} ${pool} are in ${stockFight(b) ? "its stock" : "its bags"}`);
  if (mates > 0) parts.push(`${mates} are on teammates`);
  const line = parts.join(" and ");
  return ` ${line[0].toUpperCase()}${line.slice(1)}, not to hand in a fight: a gun loads only what its shooter carries (pockets, rig, pack).`;
}
// Why a shotgun cannot be loaded at all now ("" when some shells of the type are on them): none.
export function noShellsRefusal(b, u, type = null, mag = null) {
  if (!isShellGun(u) || !physical(u)) return "";
  const cal = calOf(u.weapon), t = typeFor(cal, type || u.load);
  const s = shellsAt(b, u, t, mag);
  if (s.at + s.pack > 0) return "";
  if (stacked(u)) return `No ${roundName(cal, t)} on them (none in their pockets, rig or pack).${teamNote(b, u, t)}`;
  const keys = withHand(keyFor(cal, t));
  const total = stockFight(b) ? ownShells(u, keys) : Math.max(0, roundsOf(b, u, t));
  if (total > 0) return `No spare ${roundName(cal, t)}: every shell ${stockFight(b) ? "they carry" : "the team has"} is already loaded.${teamNote(b, u, t)}`;
  return stockFight(b) ? `No ${roundName(cal, t)} on them (none in their pockets, rig or pack).${teamNote(b, u, t)}` : `No ${roundName(cal, t)} left to load (none on them or in the team's bags).`;
}
// A Reload now would load straight out of the pack (legacy sides: no shells at hand, some in the pack; Get shells
// brings a handful first). Yours: never (the pack loads straight in for both actions; the picker says so).
export const shellsInPack = (b, u, type = null) => !stacked(u) && isShellGun(u) && tracksMags(u) && reloadPlan(b, u, type).from === "pack";

// ---------- where the rounds come from ----------
// The rounds of a type this unit has past what is loaded, by where they are: { hand (loose rounds and boxes in its
// pockets and rig pouches), pack (its own pack's boxes and ammo cans), mate (its teammates' boxes), pool (the team's
// bags, or the base's stock) }. Yours: mate and pool are 0 (never a source). Other sides: an endless reserve, counted
// as the team's bags (pool).
export function roundSplit(b, u, type = null) {
  const out = { hand: 0, pack: 0, mate: 0, pool: 0 };
  const cal = calOf(u.weapon);
  if (!cal) return out;
  const t = typeFor(cal, type || u.load);
  const keys = withHand(keyFor(cal, t));
  if (!stacked(u) && u.side !== "player") { out.pool = Infinity; return out; } // (a unit with no rounds of its own: the old endless reserve)
  if (stacked(u)) {
    for (const s of roundSources(u)) if (keys.includes(s.k)) out[s.where === "pack" ? "pack" : "hand"] += s.n;
    return out;
  }
  const inList = (list) => { let n = 0; for (const it of list || []) if (it && keys.includes(it.key)) n += Math.max(0, Math.floor(num(it.dur))); return n; };
  const hb = Math.max(0, num(u.handBoxes));
  const pack = inList((u.boxes || []).slice(hb));
  let mate = 0;
  for (const o of b.units || []) if (o !== u && o.side === u.side && o.boxes) mate += inList(o.boxes);
  if (isShellGun(u)) {
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
  let claim = typeFor(cal, u.load) === t ? Math.max(0, num(u.mag)) : 0;
  if (tracksMags(u) && u.magMode === "box") for (const g of spares(u)) if (g.load === t) claim += loaded(b, u, g);
  for (const k of ["hand", "pack", "mate", "pool"]) { const q = Math.min(out[k], claim); out[k] -= q; claim -= q; }
  return out;
}
// Where the next rounds of a type come from: "hand" | "pack" | "mate" | "pool", or null (none left to load).
export function roundSource(b, u, type = null) {
  const r = roundSplit(b, u, type);
  return r.hand > 0 ? "hand" : r.pack > 0 ? "pack" : r.mate > 0 ? "mate" : r.pool > 0 ? "pool" : null;
}
// Actions a reload of rounds from this source takes: SOURCE_AP (hand 1, pack 2), else `dflt`.
const sourceAp = (src, dflt) => (src && MAGS.SOURCE_AP[src] != null ? MAGS.SOURCE_AP[src] : dflt);
// Where a plan's rounds come from, in words for the log and the Reload button: "a pocket" / "the rig" (the first box at
// hand with rounds of the type) / "the pack" / "a teammate's rounds" / "the team's ammo".
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
const placeWord = (w) => (w === "pack" ? "the pack" : w === "rig" ? "the rig" : w === "gun" ? "the gun" : "a pocket");
const runsWord = (runs) => { const w = [...new Set((runs || []).map((r) => r.where))]; return w.length === 1 ? placeWord(w[0]) : w.includes("pack") ? "the pack and the pockets" : "the pockets and the rig"; };
const magWord = (m) => String((GEAR[m.key] && GEAR[m.key].name) || "magazine").toLowerCase();
const clipWord = (c) => String((GEAR[c.key] && GEAR[c.key].name) || "clip").toLowerCase();
const gunWord = (u) => { const n = u.weaponName || (WEAPONS[u.weapon] && WEAPONS[u.weapon].name) || "gun"; return /^[A-Z][a-z]/.test(n) ? n[0].toLowerCase() + n.slice(1) : n; };
const shown = (b, u) => (stacked(u) ? stackN(u.stack) : u.side === "player" ? Math.min(u.mag || 0, Math.max(0, roundsOf(b, u))) : u.mag || 0);

// ---------- reloading ----------
// What a Reload would do now: { mode: "swap" | "clip" | "rounds" (yours; legacy sides: "swap" | "topup" | "internal" |
// "clip" | "tube" | "break" | "single"), kind ("swap" | "clip" | "topup" | "internal" | a shotgun's shellKind), from
// (where it comes from: a spare's or a clip's place "rig" | "pocket" | "pack"; rounds: "hand" | "pack"), cost
// (actions), i (the spare's index in u.mags, the clip's in u.clips), load (the type in the chamber after), n (rounds
// that go in), runs (the rounds by item: [{ i, k, n, where }]), why ("" or the refusal) }.
// pick: null (the chamber's own round from the nearest place, or the next loaded spare of it), a type (a load of the
// gun: that round, a spare loaded with it first), { mag: j } (that spare), { clip: i } (that clip), { rounds: [{ i, n
// }] } (those rounds in that order, i: the index in u.boxes; reloadOptions lists them). The legacy checks (no gun, hands
// full, the type does not fit the calibre) are combat.js reloadRefusal's.
export function reloadPlan(b, u, pick = null) {
  if (stacked(u)) return planPlayer(b, u, pick);
  return planLegacy(b, u, typeof pick === "string" ? pick : null);
}
function planPlayer(b, u, pick) {
  const cal = calOf(u.weapon);
  const cur = typeFor(cal, u.load);
  const max = Math.max(0, num(u.magMax)), m = stackN(u.stack), room = Math.max(0, max - m);
  const box = u.magMode === "box";
  const base = { mode: "rounds", kind: shellKind(u) || (box ? "topup" : "internal"), from: null, cost: MAGS.SOURCE_AP.hand, i: -1, load: cur, n: 0, runs: [], why: "" };
  const no = (why, x = {}) => ({ ...base, ...x, why });
  const full = `The ${gunWord(u)} is full (${max}/${max}).`;
  const jammed = !!(u.jam && u.jam.kind === "double"); // gunfire.js jamReload: the magazine comes out whatever is in it
  const P = pick && typeof pick === "object" ? pick : null;
  if (P && P.mag != null) {
    if (!box) return no(`The ${gunWord(u)} takes no magazines: it is loaded with rounds.`);
    const j = Number(P.mag), g = u.mags[j];
    if (!g || g.where === "gun") return no("No such spare magazine.");
    const n = loaded(b, u, g);
    const plan = { ...base, mode: "swap", kind: "swap", from: g.where, cost: MAGS.AP[g.where] || 1, i: j, load: entryLoad(cal, g) || cur, n };
    const out = magOut(u.item); // no magazine in the gun: any one goes in (empty too), over the round in the chamber
    if (!g.item || !g.list) plan.why = `The ${magWord(g)} cannot be reached from here.`;
    else if (n < 1 && !out) plan.why = `The ${magWord(g)} in ${placeWord(g.where)} is empty.`;
    else if (room < 1 && !jammed && !out) plan.why = full;
    return plan;
  }
  if (P && P.clip != null) {
    const ci = Number(P.clip), c = (u.clips || [])[ci];
    if (!c) return no("No such clip.");
    if (c.used) return no(`The ${clipWord(c)} was used already (it is filled again after the fight).`);
    if (room < 1) return no(full);
    const want = P.load ? typeFor(cal, P.load) : cur;
    const runs = autoRuns(u, want, Math.min(room, CLIPS[c.key].n));
    if (!runs.length) return no(`No ${roundName(cal, want)} on them to fill the ${clipWord(c)} with.`);
    return { ...base, mode: "clip", kind: "clip", from: c.where, cost: MAGS.AP[c.where] || 1, i: ci, load: loadOfKey(cal, runs[0].k) || cur, n: runsN(runs), runs };
  }
  if (P && Array.isArray(P.rounds)) return roundsPlan(u, P.rounds, room, base, no, full);
  const type = typeof pick === "string" ? typeFor(cal, pick) : null;
  const want = type || cur;
  if (box) {
    // The next loaded spare of the type (the quickest, then the fullest); with no type asked, any loaded one when its own has none.
    let best = -1, bestAny = -1;
    const ap = (i) => MAGS.AP[u.mags[i].where] || 0;
    const better = (i, j) => j < 0 || ap(i) < ap(j) || (ap(i) === ap(j) && loaded(b, u, u.mags[i]) > loaded(b, u, u.mags[j]));
    u.mags.forEach((g, i) => {
      if (g.where === "gun" || !g.item || !g.list || loaded(b, u, g) < 1) return;
      if (entryLoad(cal, g) === want) { if (better(i, best)) best = i; }
      else if (!type && better(i, bestAny)) bestAny = i;
    });
    const j = best >= 0 ? best : bestAny;
    if (j >= 0) {
      const g = u.mags[j];
      const plan = { ...base, mode: "swap", kind: "swap", from: g.where, cost: MAGS.AP[g.where] || 1, i: j, load: entryLoad(cal, g) || cur, n: loaded(b, u, g) };
      if (room < 1 && !jammed && !magOut(u.item)) plan.why = full;
      return plan;
    }
  }
  if (room < 1) return no(full);
  let runs = autoRuns(u, want, Math.min(MAGS.LOOSE, room));
  let load = want;
  if (!runs.length && !type) for (const l of gunLoads(u.weapon)) { if (l === want) continue; runs = autoRuns(u, l, Math.min(MAGS.LOOSE, room)); if (runs.length) { load = l; break; } }
  if (!runs.length) {
    const none = `none in their pockets, rig or pack`;
    if (type || !box) return no(`No ammo to load: no ${roundName(cal, want)} on them (${none}).${box ? " No loaded spare magazine of it either." : ""}${teamNote(b, u, want)}`);
    return no(`No ammo to load: no loaded spare magazine, and no rounds for the ${gunWord(u)} on them (${none}).${teamNote(b, u, want)}`);
  }
  return { ...base, from: runsFrom(runs), cost: MAGS.SOURCE_AP[runsFrom(runs)], load, n: runsN(runs), runs };
}
// The rounds picked by hand, in the order they should fire: checked against what is on them, MAGS.LOOSE and the room.
function roundsPlan(u, list, room, base, no, full) {
  const cal = calOf(u.weapon);
  if (room < 1) return no(full);
  const srcs = roundSources(u);
  const runs = [];
  const perSrc = new Map();
  for (const e of list) {
    const s = srcs.find((x) => x.i === Number(e && e.i));
    if (!s) return no("Those rounds are not on them any more: pick again.");
    const q = Math.floor(num(e && e.n));
    if (!(q >= 1)) continue;
    const used = (perSrc.get(s.i) || 0) + q;
    if (used > s.n) return no(`Only ${s.n} ${roundName(s.cal, s.type)} in ${placeWord(s.where)}.`);
    perSrc.set(s.i, used);
    runs.push({ i: s.i, k: s.k, n: q, where: s.where });
  }
  const total = runsN(runs);
  if (!runs.length) return no("Pick the rounds to load.");
  if (total > MAGS.LOOSE) return no(`Up to ${MAGS.LOOSE} rounds go in by hand in one Reload: ${total} picked.`);
  if (total > room) return no(`Only room for ${room} more in the ${gunWord(u)}: ${total} picked.`);
  return { ...base, from: runsFrom(runs), cost: MAGS.SOURCE_AP[runsFrom(runs)], load: loadOfKey(cal, runs[0].k) || base.load, n: total, runs };
}
// Legacy sides (and a unit of yours from a save made before): the old rule (virtual rounds).
function planLegacy(b, u, type) {
  const cal = calOf(u.weapon);
  const cur = typeFor(cal, u.load);
  const want = type ? typeFor(cal, type) : cur;
  const sw = want !== cur;
  const max = u.magMax ?? 0, m = u.mag ?? 0;
  if (u.magMode === "internal") {
    const from = roundSource(b, u, want), cost = sourceAp(from, u.side === "player" ? MAGS.SOURCE_AP.pack : 1);
    if (!sw && m >= max) return { mode: "internal", kind: "internal", from, cost, load: want, why: `The ${gunWord(u)} is full (${max}/${max}).` };
    if (isShellGun(u) && u.side === "player") { const why = noShellsRefusal(b, u, want, sw ? 0 : m); if (why) return { mode: "internal", kind: "internal", from, cost, load: want, why }; }
    const pool = avail(b, u, want);
    if (pool < 1) return { mode: "internal", kind: "internal", from, cost, load: want, why: `No ammo left to load (no ${roundName(cal, want)}).` };
    if (!sw && u.side === "player" && pool <= m) return { mode: "internal", kind: "internal", from, cost, load: want, why: `No spare ammo (${roundName(cal, want)}): every round left is already loaded.` };
    if (isShellGun(u)) {
      if (shellsAt(b, u, want, sw ? 0 : m).at >= 1) return { mode: "internal", kind: shellKind(u), from: "hand", cost: MAGS.SOURCE_AP.hand, load: want, why: "" };
      return { mode: shellKind(u), kind: shellKind(u), from: "pack", cost: MAGS.SOURCE_AP.pack, load: want, why: "" };
    }
    const clips = u.clips || [];
    let ci = -1;
    for (let i = 0; i < clips.length; i++) if (!clips[i].used && (ci < 0 || MAGS.AP[clips[i].where] < MAGS.AP[clips[ci].where])) ci = i;
    const room = sw ? max : max - m;
    if (ci >= 0 && room > internalOf(u.weapon)) return { mode: "clip", kind: "clip", from: clips[ci].where, cost: MAGS.AP[clips[ci].where] || 1, i: ci, load: want, why: "" };
    return { mode: "internal", kind: "internal", from, cost, load: want, why: "" };
  }
  let best = -1, bestAny = -1;
  const better = (i, j) => j < 0 || MAGS.AP[u.mags[i].where] < MAGS.AP[u.mags[j].where] || (MAGS.AP[u.mags[i].where] === MAGS.AP[u.mags[j].where] && loaded(b, u, u.mags[i]) > loaded(b, u, u.mags[j]));
  u.mags.forEach((g, i) => {
    if (g.where === "gun" || loaded(b, u, g) < 1) return;
    if (g.load === want) { if (better(i, best)) best = i; }
    else if (!type && better(i, bestAny)) bestAny = i;
  });
  const topup = (why) => { const from = roundSource(b, u, want); return { mode: "topup", kind: "topup", from, cost: sourceAp(from, MAGS.TOPUP_AP), load: want, why }; };
  if (!sw && m >= max && best < 0) return topup(`The ${gunWord(u)} is full (${max}/${max}).`);
  if (!sw && m >= max) return { mode: "swap", kind: "swap", from: u.mags[best].where, cost: MAGS.AP[u.mags[best].where], i: best, load: want, why: `The ${gunWord(u)} is full (${max}/${max}).` };
  const pick = best >= 0 ? best : bestAny;
  if (pick >= 0) return { mode: "swap", kind: "swap", from: u.mags[pick].where, cost: MAGS.AP[u.mags[pick].where] || 1, i: pick, load: u.mags[pick].load, why: "" };
  const pool = avail(b, u, want);
  if (pool < 1) return topup(`No ammo left to load (no ${roundName(cal, want)}).`);
  if (!sw && u.side === "player" && pool <= m) return topup(`No spare ammo (${roundName(cal, want)}): every round left is already loaded.`);
  return topup("");
}
// The gun's attachment numbers (u.gm) with this magazine in it (legacy sides: the swap is virtual; yours: the swap is
// physical and gunMods reads the gun itself).
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
  if (!stacked(u)) return doLegacy(b, u, plan);
  const cal = calOf(u.weapon);
  if (plan.mode === "swap") return swapMag(b, u, plan);
  const was = typeFor(cal, u.load);
  const runs = plan.runs || [];
  takeRuns(u, runs);
  for (let i = runs.length - 1; i >= 0; i--) pushTop(u.stack, runs[i].k, runs[i].n); // the first picked ends up in the chamber
  syncGun(u, cal);
  syncMags(u);
  const max = u.magMax ?? 0, n = runsN(runs);
  const kinds = [...new Set(runs.map((r) => r.k))];
  const what = kinds.length > 1 ? `${n} rounds (${stackText(cal, runs.map((r) => ({ k: r.k, n: r.n })))})` : `${n} ${roundName(cal, loadOfKey(cal, runs[0] && runs[0].k) || plan.load)}`;
  const both = plan.cost > 1 ? ", both actions" : "";
  const chamber = kinds.length > 1 || u.load !== was ? `; chamber: ${roundName(cal, u.load)}` : "";
  if (plan.mode === "clip") {
    const c = u.clips[plan.i];
    c.used = true;
    return `${u.name} reloads the ${gunWord(u)} with a ${clipWord(c)}: ${what} (${shown(b, u)}/${max}${chamber}).`;
  }
  const kind = plan.kind || shellKind(u);
  const from = ` from ${runsWord(runs)}`;
  if (kind === "break") return `${u.name} breaks open the ${gunWord(u)} and drops in ${what}${from} (${shown(b, u)}/${max}${chamber}${both}).`;
  if (kind === "tube" || kind === "single") return `${u.name} ${kind === "tube" ? "racks in" : "loads"} ${what}${from} (${shown(b, u)}/${max}${chamber}${both}).`;
  if (kind === "topup") return `${u.name} tops up the ${gunWord(u)}'s magazine by hand: ${what}${from} (${shown(b, u)}/${max}${chamber}${both}).`;
  return `${u.name} reloads the ${gunWord(u)}: ${what}${from} (${shown(b, u)}/${max}${chamber}${both}).`;
}
// A swap, physical: the fresh magazine into the gun (its fitted magazine from now), the one that was in the gun (the
// fitted item, or the gun's own standard magazine made a thing of) into the slot the fresh one lay in, with the rounds
// it had. The entries follow (the gun's: the fresh one's key and capacity; the slot's: the other's).
function swapMag(b, u, plan) {
  const cal = calOf(u.weapon);
  const was = typeFor(cal, u.load);
  const g = u.mags[plan.i], X = g && g.item;
  if (!g || !X || !g.list || g.list[g.i] !== X) return `${u.name} finds no magazine there.`;
  const gun = u.item;
  const stdKey = standardMag(u.weapon);
  const fitted = fittedMag(gun);
  const out = magOut(gun); // no magazine in it (removeMagUnit): nothing comes out, the round in the chamber stays
  const old = out ? null : fitted || newItem(stdKey || g.key);
  if (!Array.isArray(X.stack)) X.stack = [];
  const chamber = out ? copyStack(u.stack) : [];
  if (old) old.stack = copyStack(u.stack);
  u.stack = copyStack(X.stack);
  X.stack = [];
  delete X.unloaded;
  if (old) { if (!stackN(old.stack)) old.unloaded = true; else delete old.unloaded; } // itemacts.js: an empty one stays empty out of the fight until Loaded
  if (gun) { gun.mods = { ...(gun.mods || {}), mag: X }; delete gun.magOut; }
  const cap = magCapacity(X.key) || u.magMax;
  let ejected = 0;
  if (out) { // the round in the chamber over the fresh magazine's, while there is room; one over that is ejected into the slot the magazine came from
    for (let i = chamber.length - 1; i >= 0; i--) { const q = Math.min(chamber[i].n, Math.max(0, cap - stackN(u.stack))); if (q > 0) pushTop(u.stack, chamber[i].k, q); chamber[i].n -= q; }
    const left = chamber.filter((r) => r.n > 0);
    ejected = stackN(left);
    g.list[g.i] = left.length ? roundItems(left[0].k, left[0].n, true)[0] || null : null;
  } else g.list[g.i] = old;
  // The entries: the gun's is the fresh one, the slot's the other (none when the gun had no magazine).
  const gi = u.mags.findIndex((m) => m.where === "gun");
  const gunEntryNew = { key: X.key, cap, load: entryLoad(cal, g) || was, n: stackN(u.stack), where: "gun" };
  const slotEntry = old ? { key: old.key, cap: magCapacity(old.key) || (gi >= 0 ? u.mags[gi].cap : cap), load: loadOfKey(cal, topKey(old.stack)) || was, n: stackN(old.stack), where: g.where, item: old, list: g.list, i: g.i } : null;
  if (gi >= 0) u.mags[gi] = gunEntryNew; else u.mags.unshift(gunEntryNew);
  if (slotEntry) u.mags[u.mags.indexOf(g)] = slotEntry; else u.mags.splice(u.mags.indexOf(g), 1);
  u.magW = u.weapon;
  u.magMax = cap;
  if (gun) { u.gm = gunMods(gun); u.gmWeapon = u.weapon; u.weaponName = modLabel(gun); }
  syncGun(u, cal);
  syncMags(u);
  const from = placeWord(g.where);
  const mixed = u.stack.length > 1 ? ` (${stackText(cal, u.stack)})` : "";
  if (out) return `${u.name} puts a magazine from ${from} into the ${gunWord(u)} (${shown(b, u)}/${u.magMax})${mixed}${ejected ? `: the round in the chamber is ejected into ${from}` : ""}.`;
  const kept = stackN(old.stack) ? ` with its ${stackN(old.stack)}` : " empty";
  return u.load !== was
    ? `${u.name} loads the ${gunWord(u)} with ${roundName(cal, u.load)} (${shown(b, u)}/${u.magMax})${mixed}: a magazine from ${from}; the other goes there${kept}.`
    : `${u.name} reloads the ${gunWord(u)} (${shown(b, u)}/${u.magMax})${mixed}: a fresh magazine from ${from}; the other goes there${kept}.`;
}
function doLegacy(b, u, plan) {
  const cal = calOf(u.weapon);
  const was = typeFor(cal, u.load);
  const max = u.magMax ?? 0;
  if (plan.mode === "swap") {
    const fresh = u.mags[plan.i], g = gunEntry(u);
    const n = loaded(b, u, fresh);
    if (g) {
      g.n = u.mag ?? 0; g.where = fresh.where;
      const gi = u.mags.indexOf(g), fi = u.mags.indexOf(fresh);
      if (gi >= 0 && fi >= 0) { u.mags[gi] = fresh; u.mags[fi] = g; }
    }
    fresh.where = "gun";
    u.load = fresh.load;
    u.magMax = fresh.cap;
    u.mag = Math.min(fresh.cap, n);
    fresh.n = u.mag;
    if (!g || g.key !== fresh.key) refitGm(u, fresh.key);
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
  if (isShellGun(u) && (plan.mode === "internal" || plan.mode === shellKind(u))) {
    const kind = shellKind(u);
    const fromPack = plan.from === "pack";
    const roll = kind === "tube" && b.rng && typeof b.rng.int === "function" ? b.rng.int(0, 1) : 0;
    const sp = shellPlan(b, u, plan.load, roll, fromPack);
    const sw = plan.load !== was;
    const before = sw ? 0 : u.mag || 0;
    if (!fromPack) useHand(b, u, plan.load, sp.n, before);
    if (sw) { u.load = plan.load; u.mag = 0; }
    u.mag = Math.min(max, before + sp.n);
    u.lastShells = sp.n;
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
    const plus = internalOf(u.weapon) ? Math.max(0, num(unitMods(u).reload)) : 0;
    u.mag = Math.min(max, (u.mag || 0) + Math.min((internalOf(u.weapon) || max) + plus, room));
    const src = plan.from === "pack" ? " out of the pack, both actions" : plan.from === "hand" ? ` from ${sourceWord(u, "hand", u.load)}` : "";
    return plan.load !== was ? `${u.name} loads the ${gunWord(u)} with ${roundName(cal, u.load)} (${shown(b, u)}/${max}${src}).` : `${u.name} reloads the ${gunWord(u)} (${shown(b, u)}/${max}${src}).`;
  }
  u.load = plan.load;
  const g = gunEntry(u);
  if (g) g.load = u.load;
  u.mag = Math.min(max, avail(b, u, u.load));
  const top = `a top-up from ${sourceWord(u, plan.from, u.load)} (${plan.cost === 1 ? "1 action" : `${plan.cost} actions`})`;
  return plan.load !== was ? `${u.name} loads the ${gunWord(u)} with ${roundName(cal, u.load)} (${shown(b, u)}/${max}): no spare magazine, ${top}.` : `${u.name} reloads the ${gunWord(u)} (${shown(b, u)}/${max}): no spare magazine left, ${top}.`;
}

// ---------- loading and unloading a spare magazine by hand (the fight's Inventory window) ----------
export const LOAD_AP = MAGS.SOURCE_AP; // the rounds' place decides: a pocket or the rig 1, the pack both
// What dropping the rounds `it` (lying in `from`: "pocket" | "rig" | "pack") onto the unit's magazine entry `m` would
// do: { cost, n (rounds that go in: up to MAGS.LOOSE), load (the round), why ("" or the refusal) }. Any round the
// magazine and the gun take goes in on top of what is there (an assortment).
export function loadMagPlan(b, u, m, it, from) {
  const cost = LOAD_AP[from === "pack" ? "pack" : "hand"];
  const out = { cost, n: 0, load: m ? m.load : null, why: "" };
  const no = (why) => ({ ...out, why });
  if (!tracksMags(u) || u.magMode !== "box") return no(`The ${gunWord(u)} takes no magazines to load.`);
  if (!stacked(u)) return no("Not on this battle (a save from before): the magazines are counted by the gun's Reload.");
  if (!m || m.where === "gun" || !m.item) return no(`Only a spare magazine of the ${gunWord(u)} is loaded by hand (the one in the gun: Reload).`);
  if (!isRoundItem(it)) return no("Only rounds load a magazine.");
  const cal = calOf(u.weapon);
  const r = roundOf(it.key);
  if (!cal || !r) return no("Only rounds load a magazine.");
  if (!magTakes(m.key, r.cal)) return no(`The ${magWord(m)} does not take ${roundName(r.cal, r.type)}.`);
  const load = loadId(cal, r.cal, r.type);
  const bad = loadRefusal(u.weapon, load);
  if (bad) return no(bad);
  const cur = loaded(b, u, m);
  if (cur >= m.cap) return no(`The ${magWord(m)} is full (${m.cap}/${m.cap}).`);
  const have = amountOf(it);
  if (have < 1) return no("No rounds there.");
  return { cost, n: Math.min(MAGS.LOOSE, m.cap - cur, have), load, why: "" };
}
// Carries out a plan (combat.js invAct: the actions are taken there). Returns the log line.
export function loadMagFrom(b, u, m, it, from, plan = null) {
  const p = plan || loadMagPlan(b, u, m, it, from);
  if (p.why) return "";
  const cal = calOf(u.weapon);
  if (!Array.isArray(m.item.stack)) m.item.stack = [];
  it.dur = Math.max(0, Math.floor(num(it.dur)) - p.n);
  pushTop(m.item.stack, it.key, p.n);
  delete m.item.unloaded;
  syncMags(u);
  const now = loaded(b, u, m);
  const mixed = m.item.stack.length > 1 ? `: ${stackText(cal, m.item.stack)}` : "";
  return `${u.name} loads ${p.n} ${roundName(cal, p.load)} into a magazine in ${placeWord(m.where)} from ${placeWord(from)} (${now}/${m.cap}${mixed}${p.cost === 1 ? "" : ", both actions"}).`;
}
// What unloading the unit's spare `m` by hand would do: { cost, n, why }.
export function unloadMagPlan(b, u, m) {
  const no = (why) => ({ cost: 1, n: 0, why });
  if (!tracksMags(u) || u.magMode !== "box") return no(`The ${gunWord(u)} takes no magazines.`);
  if (!stacked(u)) return no("Not on this battle (a save from before): the magazines are counted by the gun's Reload.");
  if (!m || m.where === "gun" || !m.item) return no("Only a spare magazine is unloaded by hand (the one in the gun: a Reload swaps it).");
  const n = loaded(b, u, m);
  if (n < 1) return no(`The ${magWord(m)} is empty.`);
  return { cost: 1, n, why: "" };
}
// Empties the spare: every round in it comes out as loose rounds onto the person, each kind its own stack (onto a
// stack of the same kind first, else a free pocket, rig pouch or pack slot). Returns the log line ("" and nothing
// moved when there is no room for them; the caller says so).
export function unloadMagFrom(b, u, m, s) {
  const p = unloadMagPlan(b, u, m);
  if (p.why || !s) return "";
  const cal = calOf(u.weapon);
  const runs = copyStack(m.item.stack);
  // Room first: what goes onto stacks of the same kind, the rest needs a free slot each (a pocket or a pack slot).
  let slots = 0;
  const free = (s.pockets || []).filter((x) => !x).length + ((packOf(s) || []).filter((x) => !x).length);
  for (const r of runs) {
    let left = r.n;
    for (const x of carriedSpots(s)) if (x.item && x.item.key === r.k && x.item.loose && isRoundItem(x.item)) left -= Math.min(left, roomIn(x.item));
    if (left > 0) slots += roundItems(r.k, left, true).length;
  }
  if (slots > free) return "";
  m.item.stack = [];
  m.item.unloaded = true; // itemacts.js: it stays empty out of the fight until Loaded
  const back = [];
  for (const r of runs) for (const it of roundItems(r.k, r.n, true)) { const at = stow(s, it); if (!at) back.push({ k: r.k, n: Math.floor(num(it.dur)) }); }
  for (let i = back.length - 1; i >= 0; i--) pushTop(m.item.stack, back[i].k, back[i].n); // (no room after all: these stay in it)
  if (stackN(m.item.stack)) delete m.item.unloaded;
  syncMags(u);
  return `${u.name} unloads the ${magWord(m)} in ${placeWord(m.where)}: ${stackText(cal, runs)} into their pockets and pack.`;
}

// ---------- the magazine taken out of the gun in the hands (2026-10-20 user request: "When I right-click a gun I
// should have an option to remove magazine") ----------
// combat.js invAct op "magout" (the item menu on the gun in the hands): the magazine (the fitted one, or the gun's own
// standard magazine made a thing of) comes out with every round in it but the one in the chamber, which stays in the
// gun (gun.magOut: it holds that round and nothing more, magCap 1, until a magazine goes in: a swap, swapMag above).
// It goes where it fits on them (a rig pouch for magazines, a pocket, the pack: stow), for the place's cost (a pouch or
// a pocket 1 action, the pack both: MAGS.AP, the swap's). Out of a fight: itemacts.js removeMagAt.
export function removeMagPlan(b, u) {
  const no = (why) => ({ cost: 1, why });
  if (!stacked(u) || u.magMode !== "box") return no(`The ${gunWord(u)} has no magazine that comes out.`);
  const gun = u.item;
  if (!gun || gun.key !== u.weapon || !detachable(gun)) return no(`The ${gunWord(u)}'s magazine does not come out.`);
  if (magOut(gun)) return no(`There is no magazine in the ${gunWord(u)}.`);
  return { cost: 1, why: "" };
}
// Carries it out on the unit and its survivor s. Returns { line, cost } or { why } (nothing changed).
export function removeMagUnit(b, u, s) {
  const p = removeMagPlan(b, u);
  if (p.why) return { why: p.why };
  if (!s) return { why: "Only one of yours." };
  const cal = calOf(u.weapon);
  const gun = u.item;
  const fitted = fittedMag(gun);
  const mag = fitted || newItem(standardMag(u.weapon));
  const rest = copyStack(u.stack);
  const chamber = takeTop(rest, 1);
  mag.stack = rest;
  delete mag.unloaded;
  const at = stow(s, mag);
  if (!at) { delete mag.stack; return { why: "No room for the magazine: a free rig pouch, pocket or pack slot is needed." }; }
  const slot = String(at).split(":")[2];
  const where = slot === "rig" ? "rig" : slot === "pack" ? "pack" : "pocket";
  const cost = MAGS.AP[where] || 1;
  if (num(u.ap) < cost) { const x = carriedSpots(s).find((y) => y.item === mag); if (x) x.take(); delete mag.stack; return { why: `The magazine would go in the pack: both actions (${num(u.ap)} left).` }; }
  if (fitted) { const mods = { ...(gun.mods || {}) }; delete mods.mag; gun.mods = mods; }
  gun.magOut = true;
  u.stack = chamber.map((r) => ({ k: r.k, n: r.n }));
  const gi = u.mags.findIndex((m) => m.where === "gun");
  if (gi >= 0) u.mags[gi] = { ...u.mags[gi], key: standardMag(u.weapon), cap: 1, n: stackN(u.stack), out: true };
  u.magW = u.weapon;
  u.magMax = 1;
  u.gm = gunMods(gun); u.gmWeapon = u.weapon; u.weaponName = modLabel(gun);
  syncGun(u, cal);
  syncMags(u);
  const n = stackN(rest);
  return { cost, line: `${u.name} takes the magazine out of the ${gunWord(u)} (${n ? `${n} in it${rest.length > 1 ? `: ${stackText(cal, rest)}` : ""}` : "empty"}) into ${placeWord(where)}; ${stackN(u.stack) ? `a round stays in the chamber (${roundName(cal, u.load)})` : "the chamber is empty"}.` };
}
// The spares of the unit that can go into the gun now: [{ j (index in u.mags), item, where, n, cap, why }] (Insert
// magazine: a swap, reloadPlan { mag: j }).
export function insertChoices(b, u) {
  if (!stacked(u) || u.magMode !== "box") return [];
  const out = [];
  u.mags.forEach((g, j) => { if (g.where !== "gun" && g.item) { const p = planPlayer(b, u, { mag: j }); out.push({ j, item: g.item, where: g.where, n: loaded(b, u, g), cap: g.cap, cost: p.cost, why: p.why }); } });
  return out;
}

// ---------- the Reload picker (ui/combat.js reloadPicker; tools/reloadpicktest.js) ----------
// Everything a Reload can take, as the survivor carries it now: { box (a magazine gun), room, cap, per (MAGS.LOOSE),
// cur (the gun's stack), curText, mags: [{ j, key, name, where, cost, n, cap, text, load, why }] (the spares, with
// what is in each), clips: [{ i, key, name, where, cost, used, why }], rounds: [{ i, k, name, short, where, cost, n,
// loose, load, hand }] (every round item on them the gun takes, pockets, rig, pack) }.
export function reloadOptions(b, u) {
  const cal = calOf(u && u.weapon);
  const out = { box: false, room: 0, cap: 0, per: MAGS.LOOSE, cur: [], curText: "", mags: [], clips: [], rounds: [] };
  if (!stacked(u) || !cal) return out;
  out.box = u.magMode === "box";
  out.cap = Math.max(0, num(u.magMax));
  out.room = Math.max(0, out.cap - stackN(u.stack));
  out.cur = copyStack(u.stack);
  out.curText = stackText(cal, u.stack);
  u.mags.forEach((g, j) => {
    if (g.where === "gun" || !g.item) return;
    const p = planPlayer(b, u, { mag: j });
    out.mags.push({ j, key: g.key, name: String((GEAR[g.key] && GEAR[g.key].name) || "magazine"), where: g.where, cost: p.cost, n: loaded(b, u, g), cap: g.cap, text: stackText(cal, g.item.stack), load: entryLoad(cal, g), why: p.why });
  });
  (u.clips || []).forEach((c, i) => {
    const p = planPlayer(b, u, { clip: i });
    out.clips.push({ i, key: c.key, name: String((GEAR[c.key] && GEAR[c.key].name) || "clip"), where: c.where, cost: p.cost, used: !!c.used, why: p.why });
  });
  for (const s of roundSources(u)) out.rounds.push({ i: s.i, k: s.k, name: roundName(s.cal, s.type) + (s.hand ? " (handload)" : ""), short: typeName(s.type) + (s.hand ? " (hand)" : ""), where: s.where, cost: s.cost, n: s.n, loose: s.loose, load: s.load, hand: s.hand });
  return out;
}
// The gun's stack in words ("slug ×2, buckshot ×4", the chamber first; "" for a unit without one).
export const gunStackText = (b, u, short = true) => (stacked(u) ? stackText(calOf(u.weapon), u.stack, { short }) : "");

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
  const cal = calOf(u.weapon);
  const types = [...new Set(full.map((m) => entryLoad(cal, m)))].filter((t) => t !== typeFor(cal, null));
  return `+${full.length} mag${full.length === 1 ? "" : "s"}${sp.length > full.length ? ` (${sp.length - full.length} empty)` : ""}${types.length ? `, ${types.map((t) => (String(t).includes(":") ? roundName(cal, t) : typeName(t))).join("/")}` : ""}`;
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
  if (stacked(u)) {
    const cal = calOf(u.weapon);
    const pick = " Reload opens the picker: any spare magazine or rounds they carry, the rounds in the order they should fire (the first picked is in the chamber).";
    if (p.why) return `${p.why}${pick}`;
    if (p.mode === "swap") return `${n}: a fresh magazine from ${placeWord(p.from)} (${p.n} in it${u.mags[p.i] && u.mags[p.i].item && u.mags[p.i].item.stack && u.mags[p.i].item.stack.length > 1 ? `: ${stackText(cal, u.mags[p.i].item.stack, { short: true })}` : ""}); the one in the gun goes where it lay, with what is in it.${pick}`;
    const what = isShellGun(u) ? `${p.n} ${p.n === 1 ? "shell" : "shells"}` : `${p.n} ${p.n === 1 ? "round" : "rounds"}`;
    const how = p.kind === "topup" ? `${what} by hand into the magazine in the gun` : p.kind === "break" ? `${what} into the barrels` : p.kind === "tube" ? `${what} thumbed into the tube` : `${what} in`;
    return `${n}: ${how} (${roundName(cal, p.load)}) from ${runsWord(p.runs)}${p.from === "pack" ? " (both actions: the rounds are in the pack)" : ""}. Up to ${MAGS.LOOSE} go in by hand a Reload, from a pocket or the rig in 1 action, the pack both; only what they carry (never a teammate's or the team's bags).${pick}`;
  }
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
