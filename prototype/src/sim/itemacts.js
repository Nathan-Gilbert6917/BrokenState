// The item right-click menu's rules (ui/itemmenu.js; user request 2026-10-18: "a small right click actions menu on
// items ... similar to tarkov"). The menu itself mostly calls what the inventory's buttons already call (Use, Repair,
// Split, Salvage, the gun builder); this module holds what is new:
//   - a gun's and a magazine's rounds out of a fight, physical (2026-10-20): Reload / Reload with, Unload, Remove and
//     Insert magazine on a gun, Load rounds / Load rounds with and Unload rounds on a magazine, free, the rounds out of
//     what the holder carries and the stores of the place (the section below);
//   - eating and drinking now: from a food or water stack (a base's stores, a team's found supplies, what a fighter carries
//     loose), food or water held as an item on the one who eats it (supitems.js: a can in a pocket, a bottle in the pack;
//     spoiled food and food with the worm's eggs refused) or from the pack of food and water everyone carries (eating.js
//     s.ration). Up to their fullness target out of a
//     fight; in a fight a snack (BATTLE_EAT) or a few gulps (BATTLE_DRINK).
//   - in a fight (combat.js combatAct "useItem" and "modPart"; the fighter's own things only, in your turn):
//       a treat (GEAR use: chocolate, coffee, a smoke, a drink), eating or drinking: ITEM_AP by where it is (to hand
//       1 action, from the pack 2: the magazines' rule, mags.js MAGS.AP);
//       fitting or taking off a gun part (the gun builder over the battle): MOD_AP, the part from or to the fighter's own
//       pockets, rig or pack (nothing reaches the team's cargo in a fight).
//     combat.js refits the unit afterwards (refitUnit): a buzz's aim, hunger and thirst's, the gun's new parts count at once.
import { GEAR } from "./data.js";
import { MAGAZINES } from "./data-kit.js";
import { survivorById, baseById } from "./world.js";
import { itemAt, parseLoc, placeOfLoc, personPlace, storageFor, useOneAt, removeAt, stow, packOf, ensureInv, rigPouches, fitModAt, carriedSpots, newItem, putAt } from "./inventory.js";
import { applyUse } from "./comforts.js";
import { FOODS, unitsOf, takeItem } from "./foods.js";
import { NEEDS } from "./needs.js";
import { eatTarget, eatPack, drinkPack, noteEat, packFood, packWater } from "./eating.js";
import { calOf, gunLoads, loadRefusal, sweepBoxes } from "./ammo.js";
import { roundName, typesOf, loadId, keyFor, withHand, typeFor } from "./rounds.js";
import { isMag, magCalsOf, magOut, detachable, fittedMag, standardMag, magFitsGun, magItemLoad } from "./mags.js";
import { isRoundGun, gunCapacity } from "./gunrounds.js";
import { stockFor, gunStackOf, setGunStack, giveBack } from "./gunload.js";
import { ROUND_SUPPLIES } from "./data-ammo.js";
import { INTERNAL } from "./data-kit.js";
import { magCapOf } from "./gunmods.js";
import { isRoundItem, isBulk } from "./itemstack.js";
import { stackN, topKey, copyStack, pushTop, pushBottom, takeTop, stackText, loadOfKey } from "./roundstack.js";
import { stripMod, fitsSlot } from "./gunmods.js";
import { stockKeyOf, spoiled } from "./supitems.js"; // food and water held as items (s_<key>, item.dur the units)

// Actions a thing costs to use in a fight, by where it is (an inventory slot, a rig pouch, a pocket, the pack, the
// fighter's arms). The pack of food and water: "ration" (eating from it), "water" (a drink from the canteen).
export const ITEM_AP = { hand: 1, pocket: 1, rig: 1, haul: 1, pack: 2, bag: 2, ration: 2, water: 1 };
export const MOD_AP = 1; // a gun part fitted or taken off in a fight, each
export const BATTLE_EAT = 0.34; // days of food at most, a snack in a fight (about a meal)
export const BATTLE_DRINK = 0.5; // water at most, a few gulps in a fight

const EPS = 1e-6;
const first = (s) => String((s && s.name) || "They").split(" ")[0];
const r1 = (x) => Math.round(x * 10) / 10;

// Where on a person a location is, for ITEM_AP: "hand" (any worn or held slot), "pocket", "rig", "pack", "bag".
export function spotOf(loc) {
  const L = parseLoc(loc);
  if (L.o === "haul") return "haul";
  if (L.o !== "s") return null;
  if (L.slot === "pocket" || L.slot === "rig" || L.slot === "pack" || L.slot === "bag") return L.slot;
  return "hand";
}
export const apAt = (loc) => ITEM_AP[spotOf(loc)] || 1;

// ---------- rounds out of a fight: physical (2026-10-20, the user's reports) ----------
// "The gun said it had 3 bullets in it but would not reload with the 3 that were in the base storage. Then when I
// checked again the 9mm pistol had 0 bullets in it." / "When I right-click a gun I should have an option to remove
// magazine ... And then I can reload that magazine with bullets."
// Out of a fight a gun holds the rounds on its record (gunload.js it.loaded: the stack in firing order) and a magazine
// its stack (item.stack); the badge counts exactly those (gunrounds.js). Everything here is free out of a fight and
// moves real rounds:
//   - the sources of a load (roundSourcesAt): the round items the holder carries (pockets, rig pouches, the pack), then
//     the round items lying in the place's storage list, then the stores of the place (a base's stock; a team's found
//     cargo, then what it packed). A gun or a magazine in the armory or the cargo: the storage and the stores only;
//   - a gun: Reload (reloadGunAt: up to its capacity, one kind of round: the one picked, else its own, the chamber's,
//     its calibre's common round, then whatever it takes that there is), Unload (unloadGunAt: every round onto the
//     holder as loose rounds, the rest into the stores), Remove magazine (removeMagAt: the magazine with every round
//     but the chambered one, onto the holder or into the storage; gun.magOut), Insert magazine (insertMagAt);
//   - a magazine: Load rounds (loadMagAt: up to its capacity, any round it holds, the one picked first) and Unload
//     rounds (unloadMagAt: onto the holder, or into the stores).
// Unloaded by hand (item.unloaded): a fight's start leaves it empty (mags.js fillUnit); loading it again clears that.
// In a fight the magazines are the fight's (mags.js: the Reload picker, the Inventory window, combatAct "inv" op
// "magout" / "unload" / "load").
const inFight = (state) => !!(state.combat && !state.combat.over);
// The round types a magazine can be loaded with: [{ id, name }] (its own calibre's first, then any other it holds).
export function magLoadChoices(item) {
  const m = item && MAGAZINES[item.key];
  if (!m) return [];
  const out = [];
  for (const c of magCalsOf(item.key)) for (const t of typesOf(c)) { const id = loadId(m.cal, c, t); if (!out.some((x) => x.id === id)) out.push({ id, name: roundName(m.cal, id) }); }
  return out;
}
// Where a thing at loc is and who holds it: { L, s (the person carrying it, or null), place, st (the storage: the
// armory or the cargo), stock (the stores' record a round goes back into), pools (the stores' records a load draws on,
// in order) }.
function placeAt(state, loc) {
  const L = parseLoc(loc);
  const s = L.o === "s" ? survivorById(state, L.id) : null;
  const place = placeOfLoc(state, L);
  const st = place ? storageFor(state, place) : null;
  const stock = st ? stockFor(state, st) : null;
  const pools = !st ? [] : st.o === "cargo" ? [st.party.cargo.supplies || (st.party.cargo.supplies = {}), st.party.supplies || (st.party.supplies = {})] : [stock].filter(Boolean);
  return { L, s, place, st, stock, pools };
}
const storesName = (P) => (!P.st ? "the stores" : P.st.o === "cargo" ? "the team's supplies" : `${P.st.name.replace(/'s armory$/, "")}'s stores`);
// Every round a load out of a fight can draw on at loc: [{ k, n, where, take(q) }] (where: "pocket" | "rig" | "pack" on
// the holder, "storage" a round item lying in the armory or the cargo, "stores" the stock).
export function roundSourcesAt(state, loc) {
  const P = placeAt(state, loc);
  const out = [];
  const item = (it, where) => ({ k: it.key, n: Math.max(0, Math.floor(Number(it.dur) || 0)), where, take: (q) => { it.dur = Math.max(0, Math.floor(Number(it.dur) || 0) - q); } });
  if (P.s && P.s.alive) for (const x of carriedSpots(P.s)) if (isRoundItem(x.item) && !isBulk(x.item) && ["pocket", "rig", "pack"].includes(x.where)) out.push(item(x.item, x.where));
  for (const it of (P.st && P.st.list) || []) if (isRoundItem(it) && !isBulk(it)) out.push(item(it, "storage"));
  for (const rec of P.pools) for (const [k, q] of Object.entries(rec)) if (ROUND_SUPPLIES[k] && q >= 1) out.push({ k, n: Math.floor(q), where: "stores", take: (n) => { rec[k] = Math.max(0, Math.floor(rec[k] || 0) - n); if (!(rec[k] >= 1)) delete rec[k]; } });
  return out;
}
// Rounds of a load to hand where the thing at loc is (the menu's numbers): what roundSourcesAt lists of it.
export function roundsToHand(state, loc, cal, load) {
  const keys = withHand(keyFor(cal, load));
  return roundSourcesAt(state, loc).reduce((a, x) => a + (keys.includes(x.k) ? x.n : 0), 0);
}
// Fills `st` with up to `room` rounds of the first of `loads` there are any of (its handloads after it), out of the
// sources in order; the first taken ends up on top (the chamber). Returns the runs taken ([{ k, n, where }]).
function fillFrom(st, room, cal, loads, srcs) {
  if (!(room > 0)) return [];
  for (const l of loads) {
    const keys = withHand(keyFor(cal, l));
    if (!srcs.some((x) => keys.includes(x.k) && x.n > 0)) continue;
    const runs = [];
    let left = room;
    for (const k of keys) for (const x of srcs) {
      if (left <= 0) break;
      if (x.k !== k || !(x.n > 0)) continue;
      const q = Math.min(left, x.n);
      x.take(q); x.n -= q; left -= q;
      runs.push({ k, n: q, where: x.where });
    }
    for (let i = runs.length - 1; i >= 0; i--) pushTop(st, runs[i].k, runs[i].n);
    return runs;
  }
  return [];
}
// Spent round items thrown away where a load drew on them (the holder's slots, the storage list).
function sweepAt(state, loc) {
  const P = placeAt(state, loc);
  if (P.s) sweepBoxes(P.s);
  if (P.st && Array.isArray(P.st.list)) for (let i = P.st.list.length - 1; i >= 0; i--) { const it = P.st.list[i]; if (isRoundItem(it) && !isBulk(it) && !(Number(it.dur) >= 1)) P.st.list.splice(i, 1); }
}
const WHERE_WORDS = { pocket: "pockets", rig: "rig", pack: "pack", storage: "storage", stores: "stores" };
function fromWords(state, loc, runs) {
  const P = placeAt(state, loc);
  const who = P.s ? first(P.s) : "";
  const places = [...new Set(runs.map((r) => r.where))].map((w) => (["pocket", "rig", "pack"].includes(w) ? `${who}'s ${WHERE_WORDS[w]}` : w === "storage" ? (P.st ? P.st.name : "the storage") : storesName(P)));
  return places.length > 1 ? `${places.slice(0, -1).join(", ")} and ${places[places.length - 1]}` : places[0] || "";
}
// Rounds onto the holder as loose rounds (onto stacks of the kind first, else a free slot), the rest into the stores.
// Returns the runs that found no place (nothing is thrown away: the caller keeps them where they were).
function putRounds(P, runs) {
  const left = [];
  for (const r of runs) {
    const put = P.s || P.stock ? giveBack(P.s, r.k, r.n, P.stock) : 0;
    if (put < r.n) left.push({ k: r.k, n: r.n - put });
  }
  return left;
}
const intoWords = (P) => (P.s ? `${first(P.s)}'s pockets and pack${P.stock ? " (the stores for what has no room)" : ""}` : storesName(P));
// Why the thing at loc cannot be loaded, unloaded or changed now ("" when it can).
function bench(state, loc, item) {
  if (!item) return "Nothing there.";
  if (inFight(state)) return "Not in the middle of a fight: in a fight the gun in the hands is reloaded from the battle panel (or its menu), a spare loaded in the Inventory window.";
  const L = parseLoc(loc);
  if (L.o === "body") return "Take it first.";
  if (!placeOfLoc(state, L)) return "Out of reach.";
  return "";
}

// ---------- magazines ----------
const magCal = (it) => MAGAZINES[it.key].cal;
const magCapacityOf = (it) => (isMag(it) ? magCapOf(it.key) || MAGAZINES[it.key].cap : 0);
// The loads a magazine is loaded with when none is picked: its own (item.load), the one on top of it, its calibre's
// common round, then every other it holds.
function magLoads(it, pick) {
  if (pick) return [pick];
  const cal = magCal(it);
  const top = Array.isArray(it.stack) && it.stack.length ? loadOfKey(cal, topKey(it.stack)) : null;
  return [...new Set([it.load || null, top, typeFor(cal, null), ...magLoadChoices(it).map((x) => x.id)].filter(Boolean))];
}
export function unloadMagRefusal(state, loc) {
  const it = itemAt(state, loc);
  if (!isMag(it)) return "Not a magazine.";
  const why = bench(state, loc, it);
  if (why) return why;
  if (!(stackN(it.stack) > 0)) return `The ${it.name} is empty.`;
  const P = placeAt(state, loc);
  if (!P.s && !P.stock) return "There are no stores here to put the rounds in.";
  return "";
}
// Unload rounds: every round in it out, onto the one carrying it as loose rounds (else into the stores here); it stays
// empty until loaded again (a fight's start leaves it so).
export function unloadMagAt(state, loc) {
  const why = unloadMagRefusal(state, loc);
  if (why) return why;
  const it = itemAt(state, loc);
  const P = placeAt(state, loc);
  const runs = copyStack(it.stack);
  const left = putRounds(P, runs);
  it.stack = left;
  const n = stackN(runs) - stackN(left);
  if (!left.length) it.unloaded = true;
  return `${n} round${n === 1 ? "" : "s"} out of the ${it.name} into ${intoWords(P)}${left.length ? `: no room for ${stackN(left)}, they stay in it` : ""}.`;
}
export function loadMagRefusal(state, loc, load = null) {
  const it = itemAt(state, loc);
  if (!isMag(it)) return "Not a magazine.";
  const why = bench(state, loc, it);
  if (why) return why;
  if (load && !magLoadChoices(it).some((x) => x.id === load)) return `The ${it.name} does not take that round.`;
  const cap = magCapacityOf(it);
  if (stackN(it.stack) >= cap) return `The ${it.name} is full (${cap}/${cap}).`;
  const srcs = roundSourcesAt(state, loc);
  const cal = magCal(it);
  if (!magLoads(it, load).some((l) => { const keys = withHand(keyFor(cal, l)); return srcs.some((x) => keys.includes(x.k)); })) return `No ${load ? roundName(cal, load) : `rounds the ${it.name} takes`} to hand: none on them${placeAt(state, loc).st ? " or in the stores here" : ""}.`;
  return "";
}
// Load rounds: up to its capacity, physically, out of what its holder carries, then the storage and the stores here
// (load: the round picked; else its own, the one on top, the common round, then any it holds). The rounds go in on top
// of what is in it (an assortment: the last in is the first fired).
export function loadMagAt(state, loc, load = null) {
  const why = loadMagRefusal(state, loc, load);
  if (why) return why;
  const it = itemAt(state, loc);
  const cal = magCal(it), cap = magCapacityOf(it);
  if (!Array.isArray(it.stack)) it.stack = [];
  const runs = fillFrom(it.stack, cap - stackN(it.stack), cal, magLoads(it, load), roundSourcesAt(state, loc));
  delete it.unloaded;
  if (load) it.load = load;
  sweepAt(state, loc);
  const n = runs.reduce((a, r) => a + r.n, 0);
  return `Loaded ${n} ${roundName(cal, loadOfKey(cal, runs[0] && runs[0].k) || load)} into the ${it.name} from ${fromWords(state, loc, runs)} (${stackN(it.stack)}/${cap}${it.stack.length > 1 ? `: ${stackText(cal, it.stack)}` : ""}).`;
}

// ---------- guns out of a fight ----------
// The loads a gun takes: [{ id, name }] ("" the standard round first).
export function gunLoadChoices(item) {
  const cal = item && calOf(item.key);
  if (!cal) return [];
  return gunLoads(item.key).map((id) => ({ id, name: roundName(cal, id) }));
}
// The loads a gun is reloaded with when none is picked: its own (item.load), the chamber's, the common round, then
// every other it takes.
function gunLoadsFor(gun, pick) {
  const cal = calOf(gun.key);
  if (pick) return [pick];
  const st = gunStackOf(gun);
  const own = gun.load && gun.load !== "auto" ? gun.load : null;
  return [...new Set([own, st.length ? loadOfKey(cal, topKey(st)) : null, typeFor(cal, null), ...gunLoads(gun.key)].filter(Boolean))];
}
export function reloadGunRefusal(state, loc, load = null) {
  const it = itemAt(state, loc);
  if (!it || !isRoundGun(it)) return "Not a gun that takes rounds.";
  const why = bench(state, loc, it);
  if (why) return why;
  if (load && load !== "auto" && (loadRefusal(it.key, load) || !gunLoadChoices(it).some((x) => x.id === load))) return `The ${it.name} does not take that round.`;
  const cap = gunCapacity(it), n = stackN(gunStackOf(it));
  if (n >= cap) return magOut(it) ? `A round in the chamber and no magazine in the ${it.name}: insert one.` : `The ${it.name} is full (${cap}/${cap}).`;
  const cal = calOf(it.key);
  const srcs = roundSourcesAt(state, loc);
  if (!gunLoadsFor(it, load === "auto" ? null : load).some((l) => { const keys = withHand(keyFor(cal, l)); return srcs.some((x) => keys.includes(x.k)); })) return `No ${load && load !== "auto" ? roundName(cal, load) : `rounds for the ${it.name}`} to hand: none on them${placeAt(state, loc).st ? " or in the stores here" : ""}.`;
  return "";
}
// Reload: the gun filled up to its capacity (its magazine, a tube, a cylinder; the chamber only with its magazine out),
// physically, out of what its holder carries, then the storage and the stores here (2026-10-20: a survivor at the base
// loads from the base's stores). load: the round picked (it also becomes the round the gun takes the field with:
// item.load); "auto" the best to hand when a fight starts (nothing is loaded now).
export function reloadGunAt(state, loc, load = null) {
  const it = itemAt(state, loc);
  if (load === "auto" && it && isRoundGun(it) && !inFight(state)) { it.load = "auto"; return `The ${it.name} takes the best round to hand when a fight starts.`; }
  const why = reloadGunRefusal(state, loc, load);
  if (why) return why;
  const cal = calOf(it.key), cap = gunCapacity(it);
  const st = gunStackOf(it);
  const runs = fillFrom(st, cap - stackN(st), cal, gunLoadsFor(it, load), roundSourcesAt(state, loc));
  setGunStack(it, st);
  delete it.unloaded;
  if (load) it.load = load;
  sweepAt(state, loc);
  const n = runs.reduce((a, r) => a + r.n, 0);
  return `Loaded ${n} ${roundName(cal, loadOfKey(cal, runs[0] && runs[0].k) || load)} into the ${it.name} from ${fromWords(state, loc, runs)} (${stackN(st)}/${cap}${st.length > 1 ? `: ${stackText(cal, st)}` : ""}).`;
}
// The round a gun takes the field with, picked out of a fight (Reload with): loads it now as well.
export const setGunLoad = (state, loc, load) => reloadGunAt(state, loc, load);
// Unload: every round in the gun out (its magazine's and the chamber's), onto the one carrying it as loose rounds, else
// into the stores here. It stays empty until reloaded (a fight's start leaves it so).
export function unloadGunRefusal(state, loc) {
  const it = itemAt(state, loc);
  if (!it || !isRoundGun(it)) return "Not a gun that takes rounds.";
  const why = bench(state, loc, it);
  if (why) return why;
  if (!(stackN(gunStackOf(it)) > 0)) return `The ${it.name} is empty.`;
  const P = placeAt(state, loc);
  if (!P.s && !P.stock) return "There are no stores here to put the rounds in.";
  return "";
}
export function unloadGunAt(state, loc) {
  const why = unloadGunRefusal(state, loc);
  if (why) return why;
  const it = itemAt(state, loc);
  const P = placeAt(state, loc);
  const runs = gunStackOf(it);
  const left = putRounds(P, runs);
  setGunStack(it, left);
  if (!left.length) it.unloaded = true;
  const n = stackN(runs) - stackN(left);
  return `Unloaded the ${it.name}: ${n} round${n === 1 ? "" : "s"} into ${intoWords(P)}${left.length ? `; no room for ${stackN(left)}, they stay in it` : ""}.`;
}

// ---------- the magazine out of a gun and in again (2026-10-20 user request) ----------
// Remove magazine: any gun with a detachable magazine (mags.js detachable: not a fixed box, a tube, a cylinder or a
// stripper-clip gun). The magazine (the fitted one, or the gun's own standard magazine made a thing of) comes out with
// every round in the gun but the one in the chamber, which stays (gun.magOut: the gun holds that round, nothing more).
// It goes onto the one carrying the gun (a rig pouch, a pocket, the pack), else into the storage here.
export function removeMagRefusal(state, loc) {
  const it = itemAt(state, loc);
  if (!it || !isRoundGun(it)) return "Not a gun that takes rounds.";
  if (magOut(it)) return `There is no magazine in the ${it.name}.`;
  if (!detachable(it)) return `The ${it.name}'s magazine does not come out: it is loaded through the action.`;
  return bench(state, loc, it);
}
// Takes the magazine out of `gun` (with all but the chambered round) and puts it with `place` (a function that puts
// it somewhere and returns where, or ""). Returns { mag, n, chamber } or null when it found no place (nothing changed).
function takeMagOut(gun, place) {
  const fitted = fittedMag(gun);
  const mag = fitted || newItem(standardMag(gun.key));
  const rest = gunStackOf(gun);
  const chamber = takeTop(rest, 1);
  mag.stack = rest;
  delete mag.unloaded;
  const to = place(mag);
  if (!to) { delete mag.stack; return null; }
  if (fitted) { const mods = { ...(gun.mods || {}) }; delete mods.mag; gun.mods = mods; }
  gun.magOut = true;
  setGunStack(gun, chamber);
  return { mag, n: stackN(rest), chamber, to };
}
export function removeMagAt(state, loc) {
  const why = removeMagRefusal(state, loc);
  if (why) return why;
  const gun = itemAt(state, loc);
  const P = placeAt(state, loc);
  const cal = calOf(gun.key);
  const r = takeMagOut(gun, (mag) => (P.s && stow(P.s, mag)) || (P.st && P.st.list.push(mag) ? "storage" : ""));
  if (!r) return `No room for the magazine: ${P.s ? `${first(P.s)} needs a free pouch, pocket or pack slot` : "nowhere to put it"}.`;
  const went = r.to === "storage" ? P.st.name : `${first(P.s)}'s ${spotWord(r.to)}`;
  return `The ${r.mag.name} out of the ${gun.name} (${r.n ? `${r.n} in it` : "empty"}) into ${went}; ${stackN(r.chamber) ? `a round stays in the chamber (${roundName(cal, loadOfKey(cal, topKey(r.chamber)))})` : "the chamber is empty"}.`;
}
const spotWord = (loc) => { const w = spotOf(loc); return w === "rig" ? "rig" : w === "pack" ? "pack" : w === "pocket" ? "pocket" : "kit"; };
// The magazines that can go into the gun at gunLoc: [{ loc, item, where }] (on its holder, else in the storage here).
export function magsForGun(state, gunLoc) {
  const gun = itemAt(state, gunLoc);
  if (!gun || !isRoundGun(gun) || !(detachable(gun) || magOut(gun))) return [];
  const P = placeAt(state, gunLoc);
  const out = [];
  if (P.s) for (const x of carriedSpots(P.s)) if (isMag(x.item) && ["pocket", "rig", "pack"].includes(x.where) && magFitsGun(gun.key, x.item.key)) out.push({ loc: x.loc, item: x.item, where: `${first(P.s)}'s ${WHERE_WORDS[x.where]}` });
  if (P.st) P.st.list.forEach((it, i) => { if (isMag(it) && magFitsGun(gun.key, it.key)) out.push({ loc: `${P.st.o}:${P.st.id}:list:${i}`, item: it, where: P.st.name }); });
  return out;
}
export function insertMagRefusal(state, gunLoc, magLoc) {
  const gun = itemAt(state, gunLoc), mag = itemAt(state, magLoc);
  if (!gun || !isRoundGun(gun)) return "Not a gun that takes rounds.";
  if (!isMag(mag)) return "Not a magazine.";
  const why = bench(state, gunLoc, gun) || bench(state, magLoc, mag);
  if (why) return why;
  if (!(detachable(gun) || magOut(gun))) return `The ${gun.name} takes no magazine.`;
  if (!magFitsGun(gun.key, mag.key)) return `The ${mag.name} does not fit the ${gun.name}.`;
  if (placeOfLoc(state, gunLoc) !== placeOfLoc(state, magLoc)) return "The gun and the magazine are not in the same place.";
  return "";
}
// Insert magazine: the magazine at magLoc goes into the gun at gunLoc with the rounds in it; the round in the chamber
// stays on top while there is room (one over its capacity is ejected: onto the holder, else into the stores). A gun with
// a magazine in it has that one taken out first (as Remove magazine), into the place the new one came from.
export function insertMagAt(state, gunLoc, magLoc) {
  const why = insertMagRefusal(state, gunLoc, magLoc);
  if (why) return why;
  const gun = itemAt(state, gunLoc);
  const P = placeAt(state, gunLoc);
  const cal = calOf(gun.key);
  const mag = removeAt(state, magLoc);
  let swapped = "";
  if (!magOut(gun)) { // the one in it out first, into the place the new one lay (else wherever it fits)
    const r = takeMagOut(gun, (old) => (putAt(state, magLoc, old) ? magLoc : "") || (P.s && stow(P.s, old)) || (P.st && P.st.list.push(old) ? "storage" : ""));
    if (!r) { putAt(state, magLoc, mag); return "No room for the magazine that is in it."; }
    swapped = ` The ${r.mag.name} that was in it (${r.n}) goes where this one was.`;
  }
  const chamber = gunStackOf(gun);
  const st = Array.isArray(mag.stack) ? copyStack(mag.stack) : [];
  delete mag.stack;
  delete mag.unloaded;
  const mods = { ...(gun.mods || {}) };
  if (mag.key === standardMag(gun.key)) delete mods.mag; else mods.mag = mag; // its own standard magazine is part of the gun (gunmods.js); another is a fitted part
  gun.mods = mods;
  delete gun.magOut;
  const cap = gunCapacity(gun);
  for (let i = chamber.length - 1; i >= 0; i--) { const q = Math.min(chamber[i].n, Math.max(0, cap - stackN(st))); if (q > 0) pushTop(st, chamber[i].k, q); chamber[i].n -= q; }
  const eject = chamber.filter((r) => r.n > 0);
  const kept = putRounds(P, eject);
  for (const r of kept) pushBottom(st, r.k, r.n); // (nowhere at all for it: it stays in, over the count, rather than vanish)
  setGunStack(gun, st);
  delete gun.unloaded;
  return `The ${mag.name} into the ${gun.name} (${stackN(st)}/${cap}${st.length > 1 ? `: ${stackText(cal, st)}` : ""})${eject.length ? `: the round that was in the chamber is ejected into ${intoWords(P)}` : ""}.${swapped}`;
}

// ---------- loaded up (a new run, its Start, an old save) ----------
// Every gun and magazine your people carry topped up physically (not one Unloaded by hand, not a gun with its magazine
// out) out of what each carries and then the stores of the place (stores false: what they carry only): every gun first
// (the one in the hands, then the others), then the spares a magazine each in turn, so a short stock never fills one
// person's spares while a teammate's gun stays empty (combat.js fillTeamSpares' order). What the badge showed them
// holding before 2026-10-20 becomes real rounds in them, nothing counted twice (the old badge counted a shared stock
// once for each person). Returns the rounds loaded.
function loadOne(state, s, x, stores) {
  const it = x.item;
  if (!it || it.unloaded) return 0;
  const srcs = roundSourcesAt(state, x.loc).filter((y) => stores || ["pocket", "rig", "pack"].includes(y.where));
  let n = 0;
  if (isRoundGun(it)) {
    if (magOut(it)) return 0;
    const st = gunStackOf(it);
    n = fillFrom(st, gunCapacity(it) - stackN(st), calOf(it.key), gunLoadsFor(it, null), srcs).reduce((a, r) => a + r.n, 0);
    if (n) setGunStack(it, st);
  } else if (isMag(it)) {
    const held = s.gear && s.gear.weapon;
    const gun = held && isRoundGun(held) && magFitsGun(held.key, it.key) ? held : null;
    const pick = !it.load && gun && gun.load && gun.load !== "auto" ? magItemLoad(it.key, calOf(gun.key), gun.load) : null; // a spare with no load of its own takes the held gun's (mags.js fitMags)
    const st = Array.isArray(it.stack) ? copyStack(it.stack) : [];
    n = fillFrom(st, magCapacityOf(it) - stackN(st), magCal(it), pick ? [pick, ...magLoads(it, null)] : magLoads(it, null), srcs).reduce((a, r) => a + r.n, 0);
    if (n) it.stack = st; // (nothing to hand: left as it was)
  }
  if (n) sweepAt(state, x.loc);
  return n;
}
const gunsToLoad = (s) => { const spots = carriedSpots(s), held = s.gear && s.gear.weapon; return [...spots.filter((x) => x.item === held && isRoundGun(x.item)), ...spots.filter((x) => x.item !== held && isRoundGun(x.item))]; };
export function loadUpAll(state, { stores = true, people = null } = {}) {
  if (inFight(state)) return 0;
  const who = (people || state.survivors || []).filter((s) => s && s.alive && s.gear && personPlace(s));
  let n = 0;
  for (const s of who) for (const x of gunsToLoad(s)) n += loadOne(state, s, x, stores);
  const tried = new Set();
  for (let more = true, guard = 0; more && guard < 200; guard++) { more = false; for (const s of who) { const x = carriedSpots(s).find((y) => isMag(y.item) && !y.item.unloaded && !tried.has(y.item)); if (x) { tried.add(x.item); n += loadOne(state, s, x, stores); more = true; } } }
  return n;
}
// One person's (a newcomer's kit, a test).
export const loadUpPerson = (state, s, opts = {}) => loadUpAll(state, { ...opts, people: [s] });

// ---------- eating and drinking ----------
// The supply record of a stack location ("armory:<id>:sup:<key>", "cargo:<id>:sup:<key>", "haul:<uid>:sup:<key>") and
// the place it is at: { holder (for foods.js takeItem), rec, place } or null.
function stackAt(state, loc) {
  const [o, idStr, slot, key] = String(loc).split(":");
  if (slot !== "sup" || !key) return null;
  const id = Number(idStr);
  if (o === "armory") { const b = baseById(state, id); return b ? { holder: b, rec: b.stock, place: `base:${id}`, key } : null; }
  if (o === "cargo") { const p = state.parties.find((x) => x.id === id); if (!p) return null; p.cargo = p.cargo || { supplies: {}, gear: [] }; return { holder: p.cargo, rec: p.cargo.supplies, place: `party:${id}`, key }; }
  if (o === "haul") { const b = state.combat; const u = b && b.units.find((x) => x.id === id); return u && u.haul ? { holder: u.haul.sup, rec: u.haul.sup, place: null, uid: id, key } : null; }
  return null;
}
// A food or water held as an item: its stock key, or null.
export const heldKeyOf = (it) => { const k = stockKeyOf(it); return k && (FOODS[k] || k === "water" || k === "rawwater") ? k : null; };
// A held food or water at an inventory location on a person, as a source: { held, item, key, rec ({ [key]: units }), sid }.
function heldAt(state, loc) {
  const L = parseLoc(loc);
  if (L.o !== "s" || L.slot === "sup") return null;
  const it = itemAt(state, loc);
  const key = heldKeyOf(it);
  return key ? { held: true, item: it, key, rec: { [key]: Math.max(0, Number(it.dur) || 0) }, sid: L.id } : null;
}
export const isFoodKey = (k) => !!FOODS[k];
export const isDrinkKey = (k) => k === "water" || k === "rawwater";
// Hunger and thirst room in days of food / water.
const foodRoom = (s, cap = Infinity) => Math.min(cap, Math.max(0, eatTarget(s) - (s.hunger ?? NEEDS.max)) / NEEDS.food);
const waterRoom = (s, cap = Infinity) => Math.min(cap, Math.max(0, NEEDS.max - (s.thirst ?? NEEDS.max)) / NEEDS.water);
// Why s cannot eat or drink from the stack at loc ("" when they can). fight: a fighter's own (haul) stack.
export function stackUseRefusal(state, s, loc) {
  const at = stackAt(state, loc) || heldAt(state, loc);
  if (!s || !s.alive) return "Nobody to eat it.";
  if (!at || !((at.rec[at.key] || 0) > EPS)) return "Nothing there.";
  if (at.held) {
    if (at.sid !== s.id) return `Only the one carrying it can ${isDrinkKey(at.key) ? "drink" : "eat"} it: hand it to ${first(s)} first.`;
    if (at.item.egg) return "It carries the worm's eggs: cook it first.";
    if (spoiled(state, at.item)) return "It has gone off.";
  } else if (at.uid != null) { const u = state.combat.units.find((x) => x.id === at.uid); if (!u || u.sid !== s.id) return `Only the one carrying it can ${isDrinkKey(at.key) ? "drink" : "eat"} it in a fight.`; }
  else if (inFight(state)) return "Not in the middle of a fight.";
  else if (personPlace(s) !== at.place) return `${first(s)} is not where it is.`;
  if (at.key === "rawwater") return "Un-purified water carries the worm's eggs: boil, filter or treat it first.";
  if (isDrinkKey(at.key)) return waterRoom(s) > 0.02 ? "" : `${first(s)} is not thirsty.`;
  const f = FOODS[at.key];
  if (!f) return "Not something to eat.";
  if (f.raw) return `Raw: cook it first (raw ${f.group === "rawfish" ? "fish" : "meat"} can carry the worm).`;
  return foodRoom(s) > 0.02 ? "" : `${first(s)} is full.`;
}
// Eats (whole items, as many as fit their hunger: one at least) or drinks from the stack. cap: days of food / water at
// most (a fight's snack). Returns the message.
export function useStack(state, sid, loc, cap = Infinity) {
  const s = survivorById(state, sid);
  const why = stackUseRefusal(state, s, loc);
  if (why) return why;
  const at = stackAt(state, loc) || heldAt(state, loc);
  if (at.held) return useHeld(state, s, loc, at, cap);
  if (isDrinkKey(at.key)) {
    const q = Math.min(at.rec.water || 0, Math.max(0.1, waterRoom(s, cap)));
    at.rec.water = Math.max(0, (at.rec.water || 0) - q);
    const before = s.thirst ?? NEEDS.max;
    s.thirst = Math.min(NEEDS.max, before + q * NEEDS.water);
    return `${first(s)} drinks ${r1(q)} water: thirst ${Math.round(before)} → ${Math.round(s.thirst)}.`;
  }
  const per = unitsOf(at.key, 1);
  const n = Math.max(1, Math.min(Math.floor(at.rec[at.key] + EPS), Math.round(foodRoom(s, cap) / Math.max(per, EPS))));
  const got = takeItem(at.holder, at.key, n, { state, eggs: false });
  if (!(got.q > EPS)) return `The ${FOODS[at.key].name.toLowerCase()} here carries the worm's eggs: cook it first.`;
  const units = unitsOf(at.key, got.q);
  const before = s.hunger ?? NEEDS.max;
  s.hunger = Math.min(NEEDS.max, before + units * NEEDS.food);
  noteEat(state, s, { units, items: { [at.key]: got.q }, lots: got.lots, from: at.uid != null ? "pack" : "store" }, {});
  return `${first(s)} eats ${got.q === 1 ? "a" : r1(got.q)} ${FOODS[at.key].name.toLowerCase()}: hunger ${Math.round(before)} → ${Math.round(s.hunger)}.`;
}
// A held food or water item: whole units (cans, bars, a bottle's litres), as many as fit (one at least); the item goes
// when it is used up.
function useHeld(state, s, loc, at, cap) {
  const it = at.item, have = at.rec[at.key];
  const drink = isDrinkKey(at.key);
  const per = drink ? 1 : unitsOf(at.key, 1); // water by the litre; food by its days of food a unit (a can, a bar)
  const room = drink ? waterRoom(s, cap) : foodRoom(s, cap);
  const n = Math.max(1, Math.min(Math.floor(have + EPS), Math.round(room / Math.max(per, EPS))));
  it.dur = Math.max(0, have - n);
  if (!(it.dur > EPS)) removeAt(state, loc);
  if (drink) {
    const before = s.thirst ?? NEEDS.max;
    s.thirst = Math.min(NEEDS.max, before + n * NEEDS.water);
    return `${first(s)} drinks ${n} water they carried: thirst ${Math.round(before)} → ${Math.round(s.thirst)}.`;
  }
  const before = s.hunger ?? NEEDS.max;
  s.hunger = Math.min(NEEDS.max, before + unitsOf(at.key, n) * NEEDS.food);
  noteEat(state, s, { units: unitsOf(at.key, n), items: { [at.key]: n }, lots: [], from: "pack" }, {});
  return `${first(s)} eats ${n === 1 ? "a" : n} ${FOODS[at.key].name.toLowerCase()} they carried: hunger ${Math.round(before)} → ${Math.round(s.hunger)}.`;
}

// The pack of food and water everyone carries (eating.js s.ration).
export function packUseRefusal(state, s, what) {
  if (!s || !s.alive) return "Nobody to eat it.";
  if (what === "drink") return packWater(s) > EPS ? (waterRoom(s) > 0.02 ? "" : `${first(s)} is not thirsty.`) : `${first(s)} has no water on them.`;
  return packFood(s) > EPS ? (foodRoom(s) > 0.02 ? "" : `${first(s)} is full.`) : `${first(s)} has no food on them.`;
}
export function usePack(state, sid, what, cap = Infinity) {
  const s = survivorById(state, sid);
  const why = packUseRefusal(state, s, what);
  if (why) return why;
  if (what === "drink") {
    const before = s.thirst ?? NEEDS.max;
    const q = drinkPack(s, waterRoom(s, cap));
    s.thirst = Math.min(NEEDS.max, before + q * NEEDS.water);
    return `${first(s)} drinks from their water: thirst ${Math.round(before)} → ${Math.round(s.thirst)}.`;
  }
  const before = s.hunger ?? NEEDS.max;
  const got = eatPack(state, s, foodRoom(s, cap));
  if (!(got.units > EPS)) return `${first(s)} has nothing in their pack to eat.`;
  s.hunger = Math.min(NEEDS.max, before + got.units * NEEDS.food);
  noteEat(state, s, { ...got, from: "pack" }, {});
  return `${first(s)} eats from their pack: hunger ${Math.round(before)} → ${Math.round(s.hunger)}.`;
}

// ---------- in a fight (combat.js combatAct) ----------
// What a "useItem" act costs and why it cannot be done ({ ap, why }). act.what: "treat" (act.loc: a treat on them),
// "eat" / "drink" (their pack), "stack" (act.loc: a food or water stack they carry loose).
export function battleUsePlan(state, b, u, act) {
  const s = u && u.sid != null ? survivorById(state, u.sid) : null;
  if (!s) return { ap: 1, why: "Nobody to use it." };
  if (act.what === "eat" || act.what === "drink") return { ap: ITEM_AP[act.what === "eat" ? "ration" : "water"], why: packUseRefusal(state, s, act.what) };
  if (act.what === "stack") {
    const L = parseLoc(act.loc);
    if (!((L.o === "haul" && L.id === u.id) || (L.o === "s" && L.id === s.id && heldAt(state, act.loc)))) return { ap: 1, why: "Only what they carry themselves." };
    return { ap: L.o === "haul" ? ITEM_AP.haul : apAt(act.loc), why: stackUseRefusal(state, s, act.loc) };
  }
  if (act.what === "treat") {
    const L = parseLoc(act.loc || "");
    const it = itemAt(state, act.loc);
    if (L.o !== "s" || L.id !== s.id || !it) return { ap: 1, why: "Only what they carry themselves." };
    if (!GEAR[it.key] || !GEAR[it.key].use) return { ap: 1, why: `The ${it.name} is not something to use up.` };
    return { ap: apAt(act.loc), why: "" };
  }
  return { ap: 1, why: "Unknown action." };
}
// Carries it out (the actions are taken here; combat.js refits the unit). Returns "" or the refusal.
export function battleUse(state, b, u, act, say) {
  const p = battleUsePlan(state, b, u, act);
  if (p.why) return p.why;
  if (u.ap < p.ap) return `That takes ${p.ap} action${p.ap === 1 ? "" : "s"}.`;
  const s = survivorById(state, u.sid);
  let line;
  if (act.what === "eat") line = usePack(state, s.id, "eat", BATTLE_EAT);
  else if (act.what === "drink") line = usePack(state, s.id, "drink", BATTLE_DRINK);
  else if (act.what === "stack") line = useStack(state, s.id, act.loc, isDrinkKey((stackAt(state, act.loc) || heldAt(state, act.loc)).key) ? BATTLE_DRINK : BATTLE_EAT);
  else {
    const it = itemAt(state, act.loc);
    useOneAt(state, act.loc); // one of a stack (itemstack.js), else the item
    line = applyUse(state, s, it.key);
  }
  u.ap -= p.ap;
  u.hunker = false;
  if (say) say(b, line, "info");
  return "";
}
// A gun part fitted (act.part: its location) or taken off (act.part null) the gun at act.gun's act.slot, in a fight:
// the fighter's own gun and parts, MOD_AP each. Returns "" or the refusal.
export function battleModRefusal(state, b, u, act) {
  const s = u && u.sid != null ? survivorById(state, u.sid) : null;
  const G = parseLoc(act.gun || "");
  const gun = itemAt(state, act.gun);
  if (!s || G.o !== "s" || G.id !== s.id || !gun) return "Only a gun the fighter carries.";
  if (u.ap < MOD_AP) return `Changing a part takes ${MOD_AP} action.`;
  if (act.part) {
    const P = parseLoc(act.part);
    const part = itemAt(state, act.part);
    if (P.o !== "s" || P.id !== s.id || !part) return `The part has to be on ${first(s)}: a pocket, the rig or the pack.`;
    return fitsSlot(gun, part, act.slot) || "";
  }
  if (!gun.mods || !gun.mods[act.slot]) return "Nothing fitted there.";
  return "";
}
export function battleMod(state, b, u, act, say) {
  const why = battleModRefusal(state, b, u, act);
  if (why) return why;
  const s = survivorById(state, u.sid);
  const gun = itemAt(state, act.gun);
  let line;
  if (act.part) {
    // fitModAt: what was on the slot goes where the part came from; anything more it carried into the storage list,
    // which a fighter cannot reach: those go on the fighter instead (they stay in the list if nothing is free).
    const st = storageFor(state, personPlace(s));
    const n0 = st ? st.list.length : 0;
    line = fitModAt(state, act.gun, act.part);
    if (st) for (const x of st.list.splice(n0)) if (!stow(s, x)) st.list.push(x);
  } else {
    const before = { ...(gun.mods || {}) };
    const list = stripMod(gun, act.slot);
    const put = [];
    for (const x of list) { const at = stow(s, x); if (at) put.push(at); else break; }
    if (put.length < list.length) {
      for (const at of put) removeAt(state, at);
      gun.mods = before;
      return `No room for the ${list[0].name}: ${first(s)} needs a free pocket or pack slot.`;
    }
    line = `${list.map((x) => x.name).join(" and the ")} taken off the ${gun.name}: ${first(s)} carries ${list.length > 1 ? "them" : "it"}.`;
  }
  u.ap -= MOD_AP;
  u.hunker = false;
  if (say) say(b, `${first(s)}: ${line}`, "info");
  return "";
}
// The parts on the fighter (pockets, rig pouches, pack) that fit a slot of the gun: [{ loc, item, where }] (the gun
// builder's list over a battle).
export function battleParts(state, gunLoc, slot, fits) {
  const G = parseLoc(gunLoc);
  const s = G.o === "s" ? survivorById(state, G.id) : null;
  const gun = itemAt(state, gunLoc);
  if (!s || !gun) return [];
  ensureInv(s);
  const out = [];
  s.pockets.forEach((it, i) => { if (it && fits(gun, slot, it)) out.push({ loc: `s:${s.id}:pocket:${i}`, item: it, where: `${first(s)}'s pocket` }); });
  (rigPouches(s) || []).forEach((it, i) => { if (it && fits(gun, slot, it)) out.push({ loc: `s:${s.id}:rig:${i}`, item: it, where: `${first(s)}'s rig` }); });
  (packOf(s) || []).forEach((it, i) => { if (it && fits(gun, slot, it)) out.push({ loc: `s:${s.id}:pack:${i}`, item: it, where: `${first(s)}'s pack` }); });
  return out;
}
