// The item right-click menu's rules (ui/itemmenu.js; user request 2026-10-18: "a small right click actions menu on
// items ... similar to tarkov"). The menu itself mostly calls what the inventory's buttons already call (Use, Repair,
// Split, Salvage, the gun builder); this module holds what is new:
//   - a magazine Unloaded (item.unloaded): kept empty, so it is not filled from the rounds to hand at the start of a fight
//     (mags.js fitMags: n = 0) and its rounds badge reads 0 (gunrounds.js). Load fills it again (optionally with a type:
//     item.load). Out of a fight only: in a fight nothing moves physically (mags.js).
//   - a gun's Reload with a type out of a fight: the round it takes the field with (item.load, as the gun builder's Ammo
//     list); Unload: the rounds kept on the gun itself (gunload.js it.loaded) into the stores where it is.
//   - eating and drinking now: from a food or water stack (a base's stores, a team's found supplies, what a fighter carries
//     loose) or from the pack of food and water everyone carries (eating.js s.ration). Up to their fullness target out of a
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
import { itemAt, parseLoc, placeOfLoc, personPlace, storageFor, useOneAt, removeAt, stow, packOf, ensureInv, rigPouches, fitModAt } from "./inventory.js";
import { applyUse } from "./comforts.js";
import { FOODS, unitsOf, takeItem } from "./foods.js";
import { NEEDS } from "./needs.js";
import { eatTarget, eatPack, drinkPack, noteEat, packFood, packWater } from "./eating.js";
import { calOf, gunLoads, loadRefusal } from "./ammo.js";
import { roundName, typesOf, loadId, keyFor, withHand } from "./rounds.js";
import { isMag, magCalsOf } from "./mags.js";
import { roundsAt } from "./gunrounds.js";
import { unloadInto, stockFor } from "./gunload.js";
import { stripMod, fitsSlot } from "./gunmods.js";

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

// ---------- magazines ----------
// The round types a magazine can be loaded with: [{ id, name }] (its own calibre's first, then any other it holds).
export function magLoadChoices(item) {
  const m = item && MAGAZINES[item.key];
  if (!m) return [];
  const out = [];
  for (const c of magCalsOf(item.key)) for (const t of typesOf(c)) { const id = loadId(m.cal, c, t); if (!out.some((x) => x.id === id)) out.push({ id, name: roundName(m.cal, id) }); }
  return out;
}
// Rounds of a load to hand where the thing at loc is (the place's stores, the boxes its holder carries).
export function roundsToHand(state, loc, cal, load) {
  const at = roundsAt(state, loc);
  let n = 0;
  for (const k of withHand(keyFor(cal, load))) {
    for (const p of at.pools) n += Math.max(0, Math.floor(Number(p[k]) || 0));
    for (const it of at.boxes) if (it.key === k) n += Math.max(0, Math.floor(Number(it.dur) || 0));
  }
  return n;
}
const inFight = (state) => !!(state.combat && !state.combat.over);
// Why the thing at loc cannot be loaded or unloaded now ("" when it can).
function bench(state, loc, item) {
  if (!item) return "Nothing there.";
  if (inFight(state)) return "Not in the middle of a fight: in a fight the magazines are counted by the gun's Reload.";
  const L = parseLoc(loc);
  if (L.o === "body") return "Take it first.";
  if (!placeOfLoc(state, L)) return "Out of reach.";
  return "";
}
export function unloadMagRefusal(state, loc) {
  const it = itemAt(state, loc);
  if (!isMag(it)) return "Not a magazine.";
  return bench(state, loc, it) || (it.unloaded ? `The ${it.name} is already empty.` : "");
}
// Unload: kept empty until loaded again (the rounds stay counted in the stores: they were never taken out of them).
export function unloadMagAt(state, loc) {
  const why = unloadMagRefusal(state, loc);
  if (why) return why;
  const it = itemAt(state, loc);
  it.unloaded = true;
  return `Unloaded the ${it.name}: it stays empty (not filled for a fight) until it is loaded again.`;
}
export function loadMagRefusal(state, loc, load = null) {
  const it = itemAt(state, loc);
  if (!isMag(it)) return "Not a magazine.";
  const why = bench(state, loc, it);
  if (why) return why;
  if (load && !magLoadChoices(it).some((x) => x.id === load)) return `The ${it.name} does not take that round.`;
  if (!it.unloaded && (load || null) === (it.load || null)) return load ? `It is loaded with ${roundName(MAGAZINES[it.key].cal, load)} already.` : "It is loaded already.";
  return "";
}
// Load: filled from the rounds to hand at the next fight (load: a type of its own; null keeps the one it has).
export function loadMagAt(state, loc, load = null) {
  const why = loadMagRefusal(state, loc, load);
  if (why) return why;
  const it = itemAt(state, loc);
  delete it.unloaded;
  if (load) it.load = load;
  const cal = MAGAZINES[it.key].cal;
  const n = it.load ? roundsToHand(state, loc, cal, it.load) : null;
  return `Loaded the ${it.name}${it.load ? ` with ${roundName(cal, it.load)} (${n} to hand)` : " with the gun's own round"}.`;
}

// ---------- guns out of a fight ----------
// The loads a gun takes: [{ id, name }] ("" the standard round first).
export function gunLoadChoices(item) {
  const cal = item && calOf(item.key);
  if (!cal) return [];
  return gunLoads(item.key).map((id) => ({ id, name: roundName(cal, id) }));
}
// Reload with a type out of a fight: the round the gun is loaded with when the fight starts (item.load).
export function setGunLoad(state, loc, load) {
  const it = itemAt(state, loc);
  if (!it || !calOf(it.key)) return "Not a gun that takes rounds.";
  if (inFight(state)) return "In a fight: Reload from the battle panel (or the menu on the gun in the hands).";
  if (load === "auto") { it.load = "auto"; return `The ${it.name} is loaded with the best round to hand for the next fight.`; }
  const why = loadRefusal(it.key, load);
  if (why) return why;
  if (!gunLoadChoices(it).some((x) => x.id === load)) return `The ${it.name} does not take that round.`;
  it.load = load;
  const cal = calOf(it.key);
  return `The ${it.name} is loaded with ${roundName(cal, load)} (${roundsToHand(state, loc, cal, load)} to hand) for the next fight.`;
}
// The rounds kept on a gun (gunload.js it.loaded: one taken off a body, a picked start gun) into the stores where it is.
export function unloadGunRefusal(state, loc) {
  const it = itemAt(state, loc);
  if (!it || !calOf(it.key)) return "Not a gun that takes rounds.";
  if (inFight(state)) return "Not in the middle of a fight.";
  if (!(it.loaded && it.loaded.n > 0)) return `The ${it.name} holds no rounds of its own: it is loaded from the rounds to hand when a fight starts.`;
  const L = parseLoc(loc);
  if (L.o === "body") return "Take it first.";
  if (!stockFor(state, storageFor(state, placeOfLoc(state, L)))) return "There are no stores here to put the rounds in.";
  return "";
}
export function unloadGunAt(state, loc) {
  const why = unloadGunRefusal(state, loc);
  if (why) return why;
  const it = itemAt(state, loc);
  const st = storageFor(state, placeOfLoc(state, parseLoc(loc)));
  const n = unloadInto(st, [it], stockFor(state, st));
  return `Unloaded the ${it.name}: ${n} round${n === 1 ? "" : "s"} into ${st.o === "cargo" ? "the team's supplies" : `${st.name}'s stores`}.`;
}

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
export const isFoodKey = (k) => !!FOODS[k];
export const isDrinkKey = (k) => k === "water" || k === "rawwater";
// Hunger and thirst room in days of food / water.
const foodRoom = (s, cap = Infinity) => Math.min(cap, Math.max(0, eatTarget(s) - (s.hunger ?? NEEDS.max)) / NEEDS.food);
const waterRoom = (s, cap = Infinity) => Math.min(cap, Math.max(0, NEEDS.max - (s.thirst ?? NEEDS.max)) / NEEDS.water);
// Why s cannot eat or drink from the stack at loc ("" when they can). fight: a fighter's own (haul) stack.
export function stackUseRefusal(state, s, loc) {
  const at = stackAt(state, loc);
  if (!s || !s.alive) return "Nobody to eat it.";
  if (!at || !((at.rec[at.key] || 0) > EPS)) return "Nothing there.";
  if (at.uid != null) { const u = state.combat.units.find((x) => x.id === at.uid); if (!u || u.sid !== s.id) return `Only the one carrying it can ${isDrinkKey(at.key) ? "drink" : "eat"} it in a fight.`; }
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
  const at = stackAt(state, loc);
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
    if (L.o !== "haul" || L.id !== u.id) return { ap: 1, why: "Only what they carry themselves." };
    return { ap: ITEM_AP.haul, why: stackUseRefusal(state, s, act.loc) };
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
  else if (act.what === "stack") line = useStack(state, s.id, act.loc, isDrinkKey(stackAt(state, act.loc).key) ? BATTLE_DRINK : BATTLE_EAT);
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
