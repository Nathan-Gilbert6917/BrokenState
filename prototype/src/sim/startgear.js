// @ts-check
// Starting gear picked on the new-run screen (2026-10-08, user requests: "when starting and setting new characters for
// a start and checking customization allow to set starting gear"; then "Manually set the gear and items in backpack and
// items in starting vehicle"). With Customize ticked (not with Ironman), each colonist's worn and held slots, what they
// carry (placed by hand in each pocket, rig or vest pouch and pack slot) and what is in the starting vehicle's back
// are set from the whole catalogue, each thing priced in customization points (custompoints.js).
//
// s.startGear (on the colonist only while the new-run screen is up: ui/newgame.js crewSnapshot carries it through every
// rebuild, world.js applyCrew puts it back, main.js's Start takes it off; once the run starts it is ordinary gear):
//   slots: { [slot]: key | "" }  a picked slot: that item ("" : nothing there). A slot not named is as rolled (the dice,
//                                 or a custom background's kit). Under Customize every slot is named.
//   carry: { pocket: [], pouch: [], pack: [] } | undefined   what they carry, placed by hand: each list one entry a
//                                 slot of that container (a key, or null for an empty one): the 4 pockets, the pouches
//                                 of the rig (or of a vest or carrier with pouches of its own) in order, the pack's
//                                 slots. Undefined: as rolled; all empty: nothing carried.
//   mods: { [gun slot]: key | "" } | undefined   the gun in the hands' parts (applyGunMods below).
//   A carried pick (and a thing in a starting vehicle's back, state.fleet[i].load.items) is a key, or { key, mods } for a gun with
//   parts picked (the same mods as the hands'; pickKey / pickMods read either form, cleanPick makes it safe: a gun
//   with no parts left goes back to the plain key, so older picks and crew snapshots need no change).
//   rolled, left, rig             written when the picks are put on (applyStartGear) for the editor: what the dice gave
//                                 in each picked slot, the picked things there was no room for, a rig that would not go
//                                 over the vest. Never carried into a rebuild (sanitizeStartGear drops them).
// s.startDice: { weapon?, armor? } the dice's items a pick replaced, so a normal start's crew snapshot carries the dice's
// weapon and vest (Randomize all shuffles them) and not the picked ones: a pick cleared later gets the dice's back.
// s.diceKit: what the dice gave them, as picks (every slot and where each carried thing was), written as the picks go
// on: the new-run screen's "Start from the dice" loads it. s.diceTrunk (on the Hardcore car's owner): what the dice put
// in the car's back (shown as its "As rolled" load). Neither is carried into a rebuild.
// The starting vehicles' backs (2026-10-24, user request: startfleet.js): no longer on a colonist (s.startVehicle and the
// car pool are gone) but on each vehicle of the new-run screen's Starting vehicles, each with its own point limit:
// state.fleet[i].load, { items: [picks], supplies: { key: n } } (null: as rolled). Hardcore, the car the team flees in
// (a load in place of the dice's back: trunkFromPicks); a normal or Custom start, each vehicle at the hub is unloaded
// into the hub's armory and stores on the first day (normalStartVehicle).
//
// The picks go on after the dice and any custom background (the same dice for everyone else, so picking for one
// colonist changes nobody else's start):
//   a normal start (normalStartGear, world.js createWorld): what a pick replaces goes to the hub's armory (the hub's kit
//     total does not drop), and so do the things there is no room for; a colonist built on points (s.startPoints,
//     Customize) paid for their kit, so the dice's is not handed out on top: what their picks replace is gone;
//   Hardcore (grabStartGear, hardcore-start.js setupHardcoreStart): a replaced grab is simply not grabbed, the rounds
//     that came with a replaced gun neither; what does not fit is left behind.
// Picked items are made new (the item factory, no wear: what a custom background gives; a carrier with steel plates).
// A picked gun comes with its rounds (a full load and two more, the common round of its calibre: the team's or the
// hub's stock, where rounds are counted); a launcher with LAUNCH of its rounds (a one-shot tube: its rocket is in it),
// a bow or crossbow with a quiver of ARROWS. Outside Customize (the tools) it also brings the start kit's two spare
// magazines where it takes them (carrykit.js starterMags); under Customize the magazines are things you place.
// Player only: the AI groups do not pick gear (a new-run option).
import { addFoodUnits } from "./foods.js"; // the back's days of food as items
import { GEAR, SUPPLIES } from "./data.js";
import { WEAPONS, magCap } from "./combat.js";
import { CALIBERS } from "./data-ammo.js";
import { ATTACH, SLOTS as GUN_SLOTS, fitMod, fitsSlot, stripMod, makeMod, takesMods } from "./gunmods.js";
import { KIT_LOOT } from "./data-kit.js";
import { newItem, startKit, ensureInv, packOf, rigOf, rigPouches, pouchesOf, pouchKindOf, pouchReason, packSize, isBulky, isSmall, fitReason, POCKETS } from "./inventory.js";
import { calOf, addRecord, capRounds, gunCalsOf, gunTakes } from "./ammo.js";
import { ROUND_SUPPLIES } from "./data-ammo.js";
import { keyFor } from "./rounds.js";
import { starterMags } from "./carrykit.js";
import { standardMag, magFitsGun, fittedMag, usesInternal } from "./mags.js";
import { wornLoad, maxLoad, feelFactor, bandIndex, LOAD_BANDS } from "./load.js";
import { AMMO_STACK } from "./data-stacks.js";
import { stackMax, withCount } from "./itemstack.js"; // a stack picked: n of a consumable, n boxes of rounds
import { startsWithVehicle } from "./custommode.js"; // Start with a vehicle (2026-10-24): off, no pickup to unload

export const START_GEAR = {
  // Worn and held, in the order the editor lists them (inventory.js EQUIP_SLOTS but the arms' carried bag).
  SLOTS: ["weapon", "tool", "armor", "head", "ears", "arms", "legs", "rig", "backpack"], // ears: Ear pro (helmets.js earGearOf: the only ear protection that works)
  POUCHES: 16, PACK: 24, // the most a rig's pouches and a pack's slots are kept for (the frame rucksack has 14)
  LOADS: 3, // a picked gun's rounds: its full load this many times (one in the gun, two spares)
  LAUNCH: 2, // a picked grenade launcher's or rocket launcher's rounds (a one-shot tube: none, its rocket is in it)
  ARROWS: 12, // a picked bow or crossbow: a quiver (as Hardcore's grab)
};
// Where carried things go, in the order they are listed.
export const CARRY_PLACES = ["pocket", "pouch", "pack"];
export const PLACE_NAMES = { pocket: "Pockets", pouch: "Pouches", pack: "Pack" };

// The catalogue for a worn or held slot, and for the things carried (anything that goes in a pocket, a pouch or a
// pack: no packs, no rig, nothing bulky, no bicycle).
/** @param {string} slot */
export const slotChoices = (slot) => Object.keys(GEAR).filter((k) => GEAR[k].slot === slot);
export const carryChoices = () => Object.keys(GEAR).filter((k) => { const d = GEAR[k]; return !["backpack", "cargo", "rig"].includes(d.slot) && !d.bulky && !d.slots && !d.supKey; }); // supplies held as items (supitems.js) are not starting kit
// The vehicle's back holds anything but another vehicle.
export const trunkChoices = () => Object.keys(GEAR).filter((k) => k !== "bicycle" && !GEAR[k].supKey);

const limitOf = (where) => (where === "pocket" ? POCKETS : where === "pouch" ? START_GEAR.POUCHES : START_GEAR.PACK); // (read late: inventory.js loads after this file)
// Anything kept on the colonist or carried in a crew snapshot, made safe: unknown keys and slots dropped, an item only
// in its own slot, each carried list a list of keys or nulls no longer than its container can be. null when nothing
// is picked.
/** @param {any} raw @returns {{ slots: Record<string, string>, carry?: Record<string, any[]>, mods?: Record<string, string> } | null} */
export function sanitizeStartGear(raw) {
  if (!raw || typeof raw !== "object") return null;
  /** @type {Record<string, string>} */
  const slots = {};
  for (const slot of START_GEAR.SLOTS) {
    const k = raw.slots && raw.slots[slot];
    if (k === "" || (typeof k === "string" && GEAR[k] && GEAR[k].slot === slot)) slots[slot] = k;
  }
  /** @type {Record<string, any[]> | undefined} */
  let carry;
  if (raw.carry && typeof raw.carry === "object") {
    const ok = new Set(carryChoices());
    /** @type {Record<string, any[]>} */
    const c = {};
    for (const where of CARRY_PLACES) {
      const list = (Array.isArray(raw.carry[where]) ? raw.carry[where].slice(0, limitOf(where)) : []).map((/** @type {any} */ k) => cleanPick(k, ok));
      while (list.length && list[list.length - 1] == null) list.pop(); // trailing empties
      c[where] = list;
    }
    carry = c;
  }
  if (!Object.keys(slots).length && !carry) return null;
  const mods = slots.weapon ? sanitizeGunMods(slots.weapon, raw.mods) : null; // the gun in the hands' parts
  /** @type {{ slots: Record<string, string>, carry?: Record<string, any[]>, mods?: Record<string, string> }} */
  const out = carry ? { slots, carry } : { slots };
  if (mods) out.mods = mods;
  return out;
}
/** @param {any} sg */
export const hasPicks = (sg) => !!(sg && ((sg.slots && Object.keys(sg.slots).length) || sg.carry));
// Every carried pick in order: [{ key, where, i, mods (a gun's parts, or null), entry (as kept) }].
/** @param {any} P */
export const carryList = (P) => (P && P.carry ? CARRY_PLACES.flatMap((where) => (P.carry[where] || []).map((e, i) => ({ key: pickKey(e), where, i, mods: pickMods(e), entry: e })).filter((x) => x.key)) : []);
// A pick as kept: its key ("" / null: none) and a gun's parts.
/** @param {any} e @returns {string | null} */
export const pickKey = (e) => (typeof e === "string" ? e || null : e && typeof e === "object" && typeof e.key === "string" ? e.key : null);
/** @param {any} e @returns {Record<string, string> | null} */
export const pickMods = (e) => (e && typeof e === "object" && e.mods && typeof e.mods === "object" ? e.mods : null);
// A pick made safe: a known key (of ok, when given), and for a gun its parts that fit; the plain key when it has none.
/** @param {any} e @param {Set<string>} [ok] */
export function cleanPick(e, ok = null) {
  const key = pickKey(e);
  if (!key || !GEAR[key] || (ok && !ok.has(key))) return null;
  const mods = sanitizeGunMods(key, pickMods(e));
  if (mods) return { key, mods };
  const n = Math.min(pickN(e), pickStackMax(key));
  return n > 1 ? { key, n } : key;
}
// A stack picked (2026-10-10, user request: the new-run "×N" adds one stack): { key, n }, n of a consumable that
// stacks or n boxes of rounds (itemstack.js; at most a slot's worth: pickStackMax). 1 for anything else.
/** @param {any} e */
export const pickN = (e) => (e && typeof e === "object" && Number(e.n) > 1 ? Math.floor(Number(e.n)) : 1);
/** @param {string} key the most of it one pick (one slot) holds: a consumable's stack, five boxes of rounds */
export const pickStackMax = (key) => (ROUND_SUPPLIES[key] && GEAR[key] && GEAR[key].count ? AMMO_STACK.BOXES : stackMax(key));
// The item a pick makes: new, a gun with its parts, loaded (a gun carried or in the back: loadGun); a stack of n.
/** @param {any} e */
export function pickItem(e) {
  const key = /** @type {string} */ (pickKey(e)), n = pickN(e);
  const it = loadGun(gunWith(key, pickMods(e)));
  if (n > 1) { if (ROUND_SUPPLIES[key] && GEAR[key].count) it.dur = Math.max(1, GEAR[key].dur || 1) * n; else withCount(it, n); }
  return it;
}
// A gun item's parts as picks: those not as it comes ("" for a factory part it lacks), or null (the dice's gear: the
// random starter parts the dice put on a gun come with it, gunmods.js randomStarterMods).
/** @param {any} item @returns {Record<string, string> | null} */
export function modsOf(item) {
  if (!item || !GEAR[item.key] || !WEAPONS[item.key] || !takesMods(item.key)) return null;
  const fac = makeItem(item.key).mods || {}, have = item.mods || {};
  /** @type {Record<string, string>} */
  const out = {};
  for (const slot of GUN_SLOTS) {
    const h = have[slot] && have[slot].key, f = fac[slot] && fac[slot].key;
    if (h && h !== f) out[slot] = h;
    else if (!h && f) out[slot] = "";
  }
  return sanitizeGunMods(item.key, out);
}
// An item as a pick: its key, with its parts when it has any of its own.
/** @param {any} it */
export const pickOf = (it) => { if (!it || !GEAR[it.key]) return null; const mods = modsOf(it); return mods ? { key: it.key, mods } : it.key; };

// A picked item: new (no wear), its factory parts, a carrier's plates steel (inventory.js startKit).
/** @param {string} key */
const makeItem = (key) => startKit(newItem(key, 1));

// ---------- a picked gun: its calibre and capacity, its parts, its loaded magazine ----------
// (2026-10-09, user request: "For choosing guns for character customization provide how much capacity and what ammo
// caliber it takes as well as allow for gun customization with those customizations adding to the gun value for
// customization points. All guns chosen start with a loaded magazine.")
// P.mods (the gun in the hands): { [gun slot]: part key | "" }: a part fitted in that slot (in place of any factory
// part there), or "" for the factory part taken off. A slot not named is as the gun comes (its factory parts:
// factoryfit.js). Put on in gunmods.js SLOTS order (a mount or rail before what goes on it); a part that does not fit
// (gunmods.js fitsSlot: by platform, calibre and the slots open) is dropped. The parts are worth what they are worth
// (valuation.js itemValue counts a gun's fitted parts), so the gun's points go up with them (custompoints.js gunPoints).
// Picks keyed by an old slot name (a revolver's grips were on "grip" before the pistol-grip slot, 2026-10-10) move to
// the part's own slot.
/** @param {any} raw @returns {any} */
const ownSlots = (raw) => {
  const o = { ...raw };
  for (const [s, k] of Object.entries(raw)) if (typeof k === "string" && k && ATTACH[k] && ATTACH[k].slot !== s && !(ATTACH[k].slot in o)) { o[ATTACH[k].slot] = k; delete o[s]; }
  return o;
};
/** @param {any} gun @param {any} mods */
export function applyGunMods(gun, mods) {
  if (!gun || !mods) return gun;
  mods = ownSlots(mods);
  for (const slot of GUN_SLOTS) if (mods[slot] === "") stripMod(gun, slot);
  for (const slot of GUN_SLOTS) {
    const k = mods[slot];
    if (typeof k !== "string" || !k || !ATTACH[k] || ATTACH[k].slot !== slot) continue;
    const m = makeMod(k, 1);
    if (!fitsSlot(gun, m)) fitMod(gun, m);
  }
  return gun;
}
// A picked gun as it will be: new, its factory parts, then the picked ones.
/** @param {string} key @param {any} [mods] */
export const gunWith = (key, mods = null) => applyGunMods(makeItem(key), mods);
// The picked parts made safe for this gun: only what fits, in turn (null: none, or not a gun that takes parts).
/** @param {string} key @param {any} raw @returns {Record<string, string> | null} */
export function sanitizeGunMods(key, raw) {
  if (!raw || typeof raw !== "object" || !key || !WEAPONS[key] || !GEAR[key] || !takesMods(key)) return null;
  raw = ownSlots(raw);
  const gun = makeItem(key);
  /** @type {Record<string, string>} */
  const out = {};
  for (const slot of GUN_SLOTS) if (raw[slot] === "" && gun.mods && gun.mods[slot]) { stripMod(gun, slot); out[slot] = ""; }
  for (const slot of GUN_SLOTS) {
    const k = raw[slot];
    if (typeof k !== "string" || !k || !ATTACH[k] || ATTACH[k].slot !== slot) continue;
    const m = makeMod(k, 1);
    if (fitsSlot(gun, m)) continue;
    fitMod(gun, m);
    out[slot] = k;
  }
  for (const slot of Object.keys(out)) if (out[slot] && !(gun.mods && gun.mods[slot] && gun.mods[slot].key === out[slot])) delete out[slot]; // knocked off by a later one
  return Object.keys(out).length ? out : null;
}
// Rounds a gun holds loaded (its fitted magazine's, else its own: an internal magazine, a tube, a cylinder): combat.js
// magCap on the item. 0: no magazine (a bow, melee).
/** @param {any} item */
export const gunCap = (item) => (item && WEAPONS[item.key] && WEAPONS[item.key].cap > 0 ? magCap({ weapon: item.key, item }) : 0);
const probeGuns = new Map();
/** @param {string} key */
const stockGun = (key) => { if (!probeGuns.has(key)) probeGuns.set(key, makeItem(key)); return probeGuns.get(key); };
// What a gun takes, for the pickers: { cal (or null), calName, cap, text ("9mm · 17 rds"), long (a sentence) }, or null
// for what is not a gun (melee, a tool). item: a gun as fitted (its magazine), else the gun as it comes.
/** @param {string} key @param {any} [item] */
export function gunInfo(key, item = null) {
  const w = WEAPONS[key], d = GEAR[key];
  if (!w || !d) return null;
  const it = item || stockGun(key);
  const cal = calOf(key);
  if (cal && CALIBERS[cal]) {
    const cap = gunCap(it), mag = fittedMag(it), internal = usesInternal(key, it), std = standardMag(key);
    const how = internal ? "loaded a few at a time (an internal magazine, tube or cylinder)" : mag ? `in its ${mag.name}` : std ? `a magazine (${GEAR[std].name})` : "a magazine";
    const also = gunCalsOf(key).filter((c) => c !== cal).map((c) => CALIBERS[c].name); // another calibre it takes (.223 in a 5.56 gun)
    return { cal, calName: CALIBERS[cal].name, cap, text: `${CALIBERS[cal].name}${also.length ? ` / ${also.join(" / ")}` : ""} · ${cap} rds`, long: `Takes ${CALIBERS[cal].name}${also.length ? ` (and ${also.join(", ")})` : ""}: ${cap} round${cap === 1 ? "" : "s"} ${how}.` };
  }
  if (w.launcher) {
    const sup = SUPPLIES[keyFor(w.launcher, null)];
    const name = sup ? sup.name : `${w.launcher} rounds`;
    return { cal: null, calName: name, cap: w.cap || 1, text: `${name} · ${w.cap || 1}`, long: `Fires ${name}${w.oneShot ? " (one shot: the tube comes loaded, then it is spent)" : `, ${w.cap || 1} loaded at a time`}.` };
  }
  if (d.cat === "bow") return { cal: null, calName: "arrows", cap: 1, text: "arrows", long: "Shoots arrows (a quiver comes with one held)." };
  return null;
}
// A gun's own magazine, full, on the item (gunload.js it.loaded: { n, key }; the common round of its calibre). Every
// gun picked is loaded so (one carried or in the vehicle's back too: they are real rounds, in its price: custompoints.js
// loosePoints). The gun in the hands is loaded from the team's rounds at the start of every fight (combat.js
// playerUnit), and its first full load is the first of its START_GEAR.LOADS (in the price), so it gets no record: one
// would sit idle while it is held. Launchers keep their own loading (launchers.js) and bows have none. Returns the item.
/** @param {any} item */
export function loadGun(item) {
  const w = item && WEAPONS[item.key], cal = item && calOf(item.key);
  if (!w || !(w.cap > 0) || w.launcher || !cal || !CALIBERS[cal]) return item;
  item.loaded = { n: gunCap(item), key: keyFor(cal, null) };
  return item;
}
// The rounds a picked gun carried or in the back comes loaded with (its fitted magazine's, with parts picked), as
// supplies { key: n } ({} for anything else).
/** @param {string} key @param {any} [mods] */
export function gunLoad(key, mods = null) {
  const it = GEAR[key] ? loadGun(mods ? gunWith(key, mods) : { ...stockGun(key) }) : null;
  return it && it.loaded ? { [it.loaded.key]: it.loaded.n } : {};
}

// ---------- the containers ----------
// What they can carry with these picks (the slots picked, else what they wear now): { pocket: { n }, pouch: { kinds,
// name }, pack: { n, name } }. A chest rig's pouches, else a vest's or carrier's own; none when a chest rig would go over a
// pouched vest (it does not fit: fitReason).
/** @param {any} P @param {any} [s] */
export function carrySpec(P, s = null) {
  const keyIn = (slot) => (P && P.slots && slot in P.slots ? P.slots[slot] || null : s && s.gear && s.gear[slot] ? s.gear[slot].key : null);
  const bag = keyIn("backpack"), rig = keyIn("rig"), armor = keyIn("armor");
  const armorPouches = armor && GEAR[armor].pouches;
  const rigKey = rig && GEAR[rig].pouches && !armorPouches ? rig : armorPouches ? armor : null;
  return {
    pocket: { n: POCKETS, name: "Pockets" },
    pouch: { n: rigKey ? GEAR[rigKey].pouches.length : 0, kinds: rigKey ? [...GEAR[rigKey].pouches] : [], name: rigKey ? GEAR[rigKey].name : "" },
    pack: { n: bag ? GEAR[bag].slots || 0 : 0, name: bag ? GEAR[bag].name : "" },
  };
}
const probe = new Map();
/** @param {string} key */
const probeItem = (key) => { if (!probe.has(key)) probe.set(key, newItem(key, 1)); return probe.get(key); };
// Why this thing cannot go in that place ("" when it can): the container's own rules (a pocket: small things; a
// pouch: its kind; a pack: no packs, nothing bulky) and that the slot is there.
/** @param {string} key @param {string} where @param {number} i @param {ReturnType<typeof carrySpec>} spec */
export function carryReason(key, where, i, spec) {
  const d = GEAR[key];
  if (!d) return "Unknown item.";
  const it = probeItem(key);
  if (where === "pocket") return i < 0 || i >= spec.pocket.n ? "No such pocket." : fitReason(it, "pocket");
  if (where === "pouch") {
    if (!spec.pouch.n) return "No rig or vest with pouches: pick one under Rig or Body first.";
    if (i < 0 || i >= spec.pouch.n) return `The ${spec.pouch.name} has ${spec.pouch.n} pouches.`;
    return pouchReason(it, spec.pouch.kinds[i]);
  }
  if (where === "pack") {
    if (!spec.pack.n) return "No bag: pick one under Bag first.";
    if (i < 0 || i >= spec.pack.n) return `The ${spec.pack.name} has ${spec.pack.n} slots.`;
    return fitReason(it, "pack");
  }
  return "Nowhere to put it.";
}
// The first free place a thing fits (a pouch of its kind, a pocket for a small thing, the pack), as { where, i }, or
// null. The editor's Add and the dice's load use it.
/** @param {any} P @param {string} key @param {ReturnType<typeof carrySpec>} spec */
export function firstFit(P, key, spec) {
  const carry = (P && P.carry) || {};
  const free = (where, i) => !(carry[where] && carry[where][i]);
  // A pouch of its kind first (magazines, grenades, a radio, meds in the admin pouch), then a pocket, then the rig's own
  // pockets (data-kit.js "pocket": a pouch that takes anything small), then the pack.
  /** @param {number} i */
  const pocketPouch = (i) => spec.pouch.kinds[i] === "pocket";
  /** @type {["pocket" | "pouch" | "pack", (i: number) => boolean][]} */
  const order = [["pouch", (i) => !pocketPouch(i)], ...(isSmall(key) ? /** @type {["pocket" | "pouch", (i: number) => boolean][]} */ ([["pocket", () => true], ["pouch", pocketPouch]]) : []), ["pack", () => true], ["pocket", () => true]];
  for (const [where, ok] of order) {
    for (let i = 0; i < spec[where].n; i++) if (ok(i) && free(where, i) && !carryReason(key, where, i, spec)) return { where, i };
  }
  return null;
}
// Carried picks that no longer fit these containers (a smaller bag, the rig gone): [{ key, where, i, why }].
/** @param {any} P @param {ReturnType<typeof carrySpec>} spec */
export const misfits = (P, spec) => carryList(P).map((x) => ({ ...x, why: carryReason(x.key, x.where, x.i, spec) })).filter((x) => x.why);

// Everything in their pockets, rig pouches and pack, taken out (to be put back where it fits). In that order.
/** @param {any} s */
function takeCarried(s) {
  const out = [];
  s.pockets.forEach((it, i) => { if (it) { out.push(it); s.pockets[i] = null; } });
  for (const list of [rigPouches(s), packOf(s)]) (list || []).forEach((it, i) => { if (it) { out.push(it); list[i] = null; } });
  return out;
}
// A rig pouch of its kind (meds and tablets an admin pouch), else a pocket for a small thing, else the rig's own pocket
// pouch, else the pack (no pack in a pack, nothing bulky). Returns false when there is no room.
/** @param {any} s @param {any} it */
function place(s, it) {
  const r = KIT_LOOT.on ? rigOf(s) : null;
  const pr = r ? rigPouches(s) || [] : [], kinds = r ? pouchesOf(r) || [] : [];
  if (r) {
    const d = GEAR[it.key];
    const want = pouchKindOf(it) || (d && (d.medKit || d.tabs || d.selfStab) ? "admin" : null);
    const i = want ? kinds.findIndex((k, j) => !pr[j] && k === want && !pouchReason(it, want)) : -1;
    if (i >= 0) { pr[i] = it; return true; }
  }
  if (isSmall(it.key)) {
    const i = s.pockets.indexOf(null);
    if (i >= 0) { s.pockets[i] = it; return true; }
    const j = kinds.findIndex((k, n) => !pr[n] && k === "pocket" && !pouchReason(it, "pocket"));
    if (j >= 0) { pr[j] = it; return true; }
  }
  const pk = packOf(s);
  if (pk && !packSize(it) && !isBulky(it.key)) { const i = pk.indexOf(null); if (i >= 0) { pk[i] = it; return true; } }
  return false;
}
// Exactly where it was put (Customize), if it still fits there; else anywhere it fits (place). false: no room.
/** @param {any} s @param {any} it @param {string} where @param {number} i */
function placeAt(s, it, where, i) {
  const list = where === "pocket" ? s.pockets : where === "pouch" ? rigPouches(s) : packOf(s);
  const kind = where === "pouch" && rigOf(s) ? (pouchesOf(rigOf(s)) || [])[i] : null;
  const fits = list && i < list.length && !list[i] && !(where === "pocket" ? fitReason(it, "pocket") : where === "pouch" ? pouchReason(it, kind) : fitReason(it, "pack"));
  if (fits) { list[i] = it; return true; }
  return place(s, it);
}
// A rolled thing that only went with the gun a pick replaced: its spare magazines and boxes of its rounds (not the
// picked gun's).
/** @param {any} it @param {any} gun */
function wentWithOldGun(it, gun) {
  const d = GEAR[it.key];
  if (!d) return false;
  if (d.mag) return !(gun && magFitsGun(gun.key, it.key));
  if (d.rounds && d.count) return !(gun && gunTakes(gun.key, d.rounds.cal)); // (a box of .223 goes with a 5.56 gun too)
  return false;
}
// What the dice gave them, as picks (every slot, and where each thing they carry was; a gun's parts as the dice fitted
// them, its starter parts too): s.diceKit.
/** @param {any} s */
export function noteDiceKit(s) {
  ensureInv(s);
  /** @type {Record<string, string>} */
  const slots = {};
  for (const slot of START_GEAR.SLOTS) slots[slot] = s.gear[slot] ? s.gear[slot].key : "";
  const keys = (list) => (list || []).map((it) => pickOf(it)); // a gun with the parts the dice put on it (randomStarterMods)
  s.diceKit = sanitizeStartGear({ slots, carry: { pocket: keys(s.pockets), pouch: keys(rigPouches(s)), pack: keys(packOf(s)) }, mods: modsOf(s.gear.weapon) });
}

// Puts a colonist's picks on them (after the dice and any custom background). Returns what the caller hands on:
// { replaced: items the picks took off them, left: picked things with no room, mags: spare magazines with no room,
//   rounds: { round key: n } for a picked gun or launcher, arrows, gun: a gun was picked (its rolled rounds are not
//   theirs) } or null with no picks.
/** @param {any} s */
export function applyStartGear(s) {
  noteDiceKit(s);
  const P = sanitizeStartGear(s && s.startGear);
  if (!P) return null;
  ensureInv(s);
  /** @type {{ replaced: any[], left: any[], mags: any[], rounds: Record<string, number>, arrows: number, gun: boolean }} */
  const out = { replaced: [], left: [], mags: [], rounds: {}, arrows: 0, gun: "weapon" in P.slots };
  /** @type {Record<string, string>} */
  const rolled = {};
  // What they carry comes out first when where it goes changes: a new pack, rig or vest, a new gun (its own
  // magazines and rounds), or their own placing.
  const moves = ["weapon", "armor", "rig", "backpack"].some((k) => k in P.slots) || !!P.carry;
  const loose = moves ? takeCarried(s) : [];
  for (const slot of START_GEAR.SLOTS) {
    if (!(slot in P.slots)) continue;
    const old = s.gear[slot];
    rolled[slot] = old ? old.name : "";
    if (slot === "weapon" || slot === "armor") s.startDice = { ...(s.startDice || {}), [slot]: old || null };
    if (old) out.replaced.push(old);
    s.gear[slot] = P.slots[slot] ? (slot === "weapon" ? gunWith(P.slots[slot], P.mods) : makeItem(P.slots[slot])) : null;
  }
  // A chest rig does not go over a vest with pouches of its own (inventory.js fitReason): the body armour stays.
  let rigOff = "";
  if (s.gear.rig && fitReason(s.gear.rig, "rig", s)) {
    rigOff = fitReason(s.gear.rig, "rig", s);
    (P.slots.rig ? out.left : out.replaced).push(s.gear.rig);
    s.gear.rig = null;
  }
  if (P.carry) { // placed by hand: each where it was put (or wherever it fits, if the containers changed since)
    out.replaced.push(...loose);
    for (const { entry, where, i } of carryList(P)) { const it = pickItem(entry); if (!placeAt(s, it, where, i)) out.left.push(it); }
  } else {
    let things = loose;
    if (out.gun) { // as rolled, but what only went with the replaced gun goes with it
      out.replaced.push(...loose.filter((it) => wentWithOldGun(it, s.gear.weapon)));
      things = loose.filter((it) => !wentWithOldGun(it, s.gear.weapon));
    }
    for (const it of things) if (!place(s, it)) out.replaced.push(it);
  }
  // A picked gun: its rounds (and outside Customize the start kit's spare magazines); a launcher's rounds; a bow's quiver.
  const gun = P.slots.weapon ? s.gear.weapon : null;
  const w = gun && WEAPONS[gun.key];
  if (gun && w) {
    if (standardMag(gun.key) && !s.startPoints) starterMags(s, out.mags);
    const cal = calOf(gun.key);
    if (cal) out.rounds[keyFor(cal, null)] = Math.max(1, gunCap(gun) || w.cap || 1) * START_GEAR.LOADS; // its capacity as fitted (a bigger magazine picked: more)
    else if (w.launcher && !w.oneShot) out.rounds[keyFor(w.launcher, null)] = START_GEAR.LAUNCH;
    if (GEAR[gun.key].cat === "bow") out.arrows = START_GEAR.ARROWS;
  }
  // For the editor (the next rebuild writes them again).
  s.startGear = { ...P, rolled, left: out.left.map((it) => it.name), ...(rigOff ? { rig: rigOff } : {}) };
  return out;
}

// A normal start (world.js createWorld, after the custom backgrounds' kit): everyone's picks on them; what they replace
// (not for a colonist built on points: s.startPoints), what has no room and spare magazines with no room go to the
// hub's armory; a picked gun's rounds and a bow's arrows to its stock. Then the hub's pickup is unloaded (normalStartVehicle).
/** @param {any} state @param {any} base */
export function normalStartGear(state, base) {
  for (const s of state.survivors) {
    const out = applyStartGear(s);
    if (!out) continue;
    if (!s.startPoints) base.armory.push(...out.replaced);
    base.armory.push(...out.left, ...out.mags);
    addRecord(base.stock, out.rounds);
    if (out.arrows) base.stock.arrows = (base.stock.arrows || 0) + out.arrows;
  }
  normalStartVehicle(state, base);
}

// ---------- the vehicle's back ----------
// What a back can be loaded with on the new-run screen (Normal and Hardcore): at most this much of each supply and ITEMS
// things (and no more than the vehicle's room: startfleet.js fleetRoom). The materials (wood, stone, jars, building
// materials, metal sheets, car and gun parts, electronics) since the user's request 2026-10-24 ("update the truck
// inventory for the start to add the new materials like wood and rocks"), each capped at about a pickup's tenth: wood
// 600 (60 kg), stone 60 (60 kg), building materials 10 (30 kg), metal sheets 6 (36 kg). Priced like anything else (custompoints.js
// vehiclePoints), against the vehicle's own point limit (startfleet.js).
// Rounds go by calibre and type (2026-10-09, user request: "All ammo should be based on caliber"): any round keys,
// ROUNDS in all; a back saved with a generic "ammo" number gets the common rounds of the guns in it (9mm and 12 gauge).
export const START_TRUNK = { SUPPLIES: { food: 60, water: 60, fuel: 40, meds: 20, arrows: 60, scrap: 40, parts: 20, wood: 600, stone: 60, jars: 20, buildmat: 10, metalsheet: 6, carparts: 6, gunparts: 10, electronics: 10 }, ROUNDS: 300, ITEMS: 16 };
// Custom mode's backs (2026-10-24, user request: "The items can be any item and material in the game"): any thing and any
// supply or material (data.js SUPPLIES: wood, stone, scrap, parts, fuel, water, meds, rounds by calibre, foods...), with
// no caps but these (to keep a typo from hanging the game): the vehicle's point limit and its room limit them.
export const OPEN_TRUNK = { ITEMS: 120, MAX: 99999, ROUNDS: 99999 };
const TRUNK_CAPS = START_TRUNK.SUPPLIES, TRUNK_ITEMS = START_TRUNK.ITEMS;
export const TRUNK_SUPPLIES = Object.keys(TRUNK_CAPS);
// Every supply key a Custom back may hold (no generic "ammo", no rounds: those go by calibre): "food" (days of it) first.
export const openSupplyKeys = () => ["food", ...Object.keys(SUPPLIES).filter((k) => k !== "ammo" && !ROUND_SUPPLIES[k])];
// The vehicle's back made safe: { items: [keys] (at most TRUNK_ITEMS), supplies: { key: n } (TRUNK_CAPS) } or null.
// open (Custom mode): any thing and any supply key, only OPEN_TRUNK's caps.
/** @param {any} raw @param {boolean} [open] */
export function sanitizeStartVehicle(raw, open = false) {
  if (!raw || typeof raw !== "object") return null;
  const ok = new Set(trunkChoices());
  const items = (Array.isArray(raw.items) ? raw.items : []).map((k) => cleanPick(k, ok)).filter(Boolean).slice(0, open ? OPEN_TRUNK.ITEMS : TRUNK_ITEMS);
  /** @type {Record<string, number>} */
  const supplies = {};
  const src = raw.supplies && typeof raw.supplies === "object" ? raw.supplies : {};
  if (open) {
    for (const k of openSupplyKeys()) { const n = Math.round(Number(src[k])); if (n > 0) supplies[k] = Math.min(OPEN_TRUNK.MAX, n); }
  } else {
    for (const [k, cap] of Object.entries(TRUNK_CAPS)) { const n = Math.round(Number(src[k])); if (n > 0) supplies[k] = Math.min(cap, n); }
  }
  /** @type {Record<string, number>} */
  const cals = {};
  for (const k of items) { const c = calOf(k); if (c) cals[c] = (cals[c] || 0) + 1; }
  Object.assign(supplies, capRounds(src, open ? OPEN_TRUNK.ROUNDS : START_TRUNK.ROUNDS, cals)); // ammo.js: rounds by calibre
  return { items, supplies };
}
// What the back weighs (kg): its things and supplies.
/** @param {any} v */
export function trunkKg(v) {
  if (!v) return 0;
  // Summed in one order whatever the order of the keys: the float sum of the same amounts differs in its last place with
  // the order, and at an x.x5 kg boundary rounds up or down by it, so a back randomTrunk fit to the room (fits: this)
  // weighed 0.1 kg more once sanitizeStartVehicle had put its keys in its own order, and Start refused it.
  const per = new Map();
  for (const e of v.items || []) { const k = pickKey(e); if (k && GEAR[k]) per.set(`i:${k}`, (per.get(`i:${k}`) || 0) + (GEAR[k].weight ?? 1) * pickN(e)); }
  for (const [k, n] of Object.entries(v.supplies || {})) if (SUPPLIES[k]) per.set(`s:${k}`, (per.get(`s:${k}`) || 0) + (SUPPLIES[k].weight || 0) * n);
  const kg = [...per.keys()].sort().reduce((a, k) => a + per.get(k), 0);
  return Math.round(kg * 10) / 10;
}
// A normal or Custom start: each starting vehicle's back set on the new-run screen (state.fleet[i].load, startfleet.js)
// is unloaded into the hub's armory and stores on the first day; one left as rolled (null) comes empty.
/** @param {any} state @param {any} base */
export function normalStartVehicle(state, base) {
  if (!startsWithVehicle(state)) return; // Start with a vehicle off (custommode.js): no vehicles, no backs
  const open = !!state.custom; // Custom mode: any thing and material
  for (const f of state.fleet || []) {
    const v = f && f.vid != null ? sanitizeStartVehicle(f.load, open) : null;
    if (!v) continue;
    for (const e of v.items) base.armory.push(pickItem(e));
    for (const [k, n] of Object.entries(v.supplies)) {
      if (k === "food" || k === "preserved") addFoodUnits(state, base, k === "preserved" ? "keeps" : "house", n); // foods.js: days of food as a house's kitchen food
      else base.stock[k] = (base.stock[k] || 0) + n;
    }
  }
}
// Hardcore (hardcore-start.js rollCar): the back set on the new-run screen in place of the dice's. Returns { gear: items, supplies }.
/** @param {any} v */
export function trunkFromPicks(v) {
  const P = sanitizeStartVehicle(v);
  return { gear: P ? P.items.map(pickItem) : [], supplies: P ? { ...P.supplies } : {} };
}

// Hardcore (hardcore-start.js setupHardcoreStart, right after one survivor's grab is rolled): their picks on them in
// place of what they grabbed, which is not grabbed (nor the rounds and arrows of a replaced gun, unless a custom
// background set them). got is updated for the day-1 lines (the bag, the weapon, the vest, the things); got.rounds:
// the picked gun's rounds, for the line. Returns { rounds, arrows } to add to the team's supplies, or null.
/** @param {any} state @param {any} s @param {any} got */
export function grabStartGear(state, s, got) {
  const out = applyStartGear(s);
  if (!out) return null;
  if (out.gun && !got.custom) { got.ammo = 0; got.roundKeys = {}; got.arrows = 0; }
  got.weapon = s.gear.weapon;
  got.armor = s.gear.armor;
  got.bag = s.gear.backpack;
  got.items = [s.gear.tool, s.gear.head, s.gear.arms, s.gear.legs, s.gear.rig, ...s.pockets, ...(rigPouches(s) || []), ...(packOf(s) || [])].filter(Boolean);
  got.rounds = Object.values(out.rounds).reduce((a, n) => a + n, 0);
  return { rounds: out.rounds, arrows: out.arrows };
}
// The team's supplies get what the picks brought (rounds by key, arrows).
/** @param {Record<string, number>} sup @param {{ rounds: Record<string, number>, arrows: number }[]} list */
export function addPickedSupplies(sup, list) {
  for (const x of list) {
    addRecord(sup, x.rounds);
    if (x.arrows) sup.arrows = (sup.arrows || 0) + x.arrows;
  }
}

// What a colonist's own kit weighs against what they can carry (load.js): { kg, max, band } (band: Light, Medium,
// Heavy, Overloaded by the felt load: an assault pack's frame, a bad back). The team's supplies are shared out on top.
/** @param {any} s */
export function kitLoad(s) {
  const kg = Math.round(wornLoad(s) * 10) / 10;
  const band = bandIndex(kg * feelFactor(s));
  return { kg, max: maxLoad(s), band, name: LOAD_BANDS[band].name };
}

// Start: the picks are ordinary gear from here on; nothing of the new-run screen stays on the colonists (s.startVehicle
// and s.carPool: crew snapshots from before the starting vehicles had their own loads), nor the starting vehicles' loads
// (state.fleet: unloaded or in the car already).
/** @param {any} state */
export function clearStartGear(state) {
  delete state.fleet;
  for (const s of state.survivors) {
    for (const k of ["startGear", "startDice", "diceKit", "diceRoll", "diceTrunk", "startVehicle", "startPoints", "carPool", "ownMax", "grabRoll", "grabPick", "stuffRoll", "carRoll", "bgKept"]) delete s[k];
  }
}
