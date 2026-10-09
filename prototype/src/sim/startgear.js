// @ts-check
// Starting gear picked on the new-run screen (2026-10-08, user request: "when starting and setting new characters for
// a start and checking customization allow to set starting gear"). With Customize ticked (not with Ironman), each
// colonist's worn and held slots and the things they carry can be set from the whole catalogue, free, like skills.
//
// s.startGear (on the colonist only while the new-run screen is up: ui/newgame.js crewSnapshot carries it through every
// rebuild, world.js applyCrew puts it back, main.js's Start takes it off; once the run starts it is ordinary gear):
//   slots: { [slot]: key | "" }  a picked slot: that item ("" : nothing there). A slot not named is as rolled (the dice,
//                                 or a custom background's kit).
//   items: [keys] | undefined     what they carry (pockets, rig pouches, the pack), placed where it fits. Undefined: as
//                                 rolled; [] : nothing.
//   rolled, left, rig             written when the picks are put on (applyStartGear) for the editor: what the dice gave
//                                 in each picked slot, the picked things there was no room for, a rig that would not go
//                                 over the vest. Never carried into a rebuild (sanitizeStartGear drops them).
// s.startDice: { weapon?, armor? } the dice's items a pick replaced, so a normal start's crew snapshot carries the dice's
// weapon and vest (Randomize all shuffles them) and not the picked ones: a pick cleared later gets the dice's back.
//
// The picks go on after the dice and any custom background (the same dice for everyone else, so picking for one
// colonist changes nobody else's start):
//   a normal start (normalStartGear, world.js createWorld): what a pick replaces goes to the hub's armory (the hub's kit
//     total does not drop), and so do the things there is no room for;
//   Hardcore (grabStartGear, hardcore-start.js setupHardcoreStart): a replaced grab is simply not grabbed, the rounds
//     that came with a replaced gun neither; what does not fit is left behind.
// Picked items are made new (the item factory, no wear: what a custom background gives; a carrier with steel plates).
// A picked gun comes with its rounds (a full load and two more, the common round of its calibre: the team's or the
// hub's stock, where rounds are counted) and the start kit's two spare magazines where it takes them (carrykit.js
// starterMags: a rig pouch, the pack, a pocket while two stay free; a normal start's hub armory, else none); a launcher
// with LAUNCH of its rounds (a one-shot tube: its rocket is in it), a bow or crossbow with a quiver of ARROWS.
// Player only: the AI groups do not pick gear (a new-run option).
import { GEAR } from "./data.js";
import { WEAPONS } from "./combat.js";
import { KIT_LOOT } from "./data-kit.js";
import { newItem, startKit, ensureInv, packOf, rigOf, rigPouches, pouchesOf, pouchKindOf, pouchReason, packSize, isBulky, isSmall, fitReason } from "./inventory.js";
import { calOf, addRecord } from "./ammo.js";
import { keyFor } from "./rounds.js";
import { starterMags } from "./carrykit.js";
import { standardMag, magFitsGun } from "./mags.js";
import { wornLoad, maxLoad, feelFactor, bandIndex, LOAD_BANDS } from "./load.js";

export const START_GEAR = {
  // Worn and held, in the order the editor lists them (inventory.js EQUIP_SLOTS but the arms' carried bag).
  SLOTS: ["weapon", "tool", "armor", "head", "arms", "legs", "rig", "backpack"],
  ITEMS: 20, // carried things picked at most (a frame rucksack's 14 slots, the 4 pockets and a few pouches)
  LOADS: 3, // a picked gun's rounds: its full load this many times (one in the gun, two spares: the start kit's 2 magazines)
  LAUNCH: 2, // a picked grenade launcher's or rocket launcher's rounds (a one-shot tube: none, its rocket is in it)
  ARROWS: 12, // a picked bow or crossbow: a quiver (as Hardcore's grab)
};

// The catalogue for a worn or held slot, and for the things carried (anything that goes in a pocket, a pouch or a
// pack: no packs, no rig, nothing bulky, no bicycle).
/** @param {string} slot */
export const slotChoices = (slot) => Object.keys(GEAR).filter((k) => GEAR[k].slot === slot);
export const carryChoices = () => Object.keys(GEAR).filter((k) => { const d = GEAR[k]; return !["backpack", "cargo", "rig"].includes(d.slot) && !d.bulky && !d.slots; });

// Anything kept on the colonist or carried in a crew snapshot, made safe: unknown keys and slots dropped, an item only
// in its own slot, at most ITEMS carried. null when nothing is picked.
/** @param {any} raw @returns {{ slots: Record<string, string>, items?: string[] } | null} */
export function sanitizeStartGear(raw) {
  if (!raw || typeof raw !== "object") return null;
  /** @type {Record<string, string>} */
  const slots = {};
  for (const slot of START_GEAR.SLOTS) {
    const k = raw.slots && raw.slots[slot];
    if (k === "" || (typeof k === "string" && GEAR[k] && GEAR[k].slot === slot)) slots[slot] = k;
  }
  const ok = new Set(carryChoices());
  const items = Array.isArray(raw.items) ? raw.items.filter((k) => ok.has(k)).slice(0, START_GEAR.ITEMS) : undefined;
  if (!Object.keys(slots).length && !items) return null;
  return items ? { slots, items } : { slots };
}
/** @param {any} sg */
export const hasPicks = (sg) => !!(sg && ((sg.slots && Object.keys(sg.slots).length) || Array.isArray(sg.items)));

// A picked item: new (no wear), its factory parts, a carrier's plates steel (inventory.js startKit).
/** @param {string} key */
const makeItem = (key) => startKit(newItem(key, 1));

// Everything in their pockets, rig pouches and pack, taken out (to be put back where it fits). In that order.
/** @param {any} s */
function takeCarried(s) {
  const out = [];
  s.pockets.forEach((it, i) => { if (it) { out.push(it); s.pockets[i] = null; } });
  for (const list of [rigPouches(s), packOf(s)]) (list || []).forEach((it, i) => { if (it) { out.push(it); list[i] = null; } });
  return out;
}
// A rig pouch of its kind (meds and tablets an admin pouch), else a pocket for a small thing, else the pack (no pack in
// a pack, nothing bulky). Returns false when there is no room.
/** @param {any} s @param {any} it */
function place(s, it) {
  const r = KIT_LOOT.on ? rigOf(s) : null;
  if (r) {
    const pr = rigPouches(s) || [], kinds = pouchesOf(r) || [], d = GEAR[it.key];
    const want = pouchKindOf(it) || (d && (d.medKit || d.tabs || d.selfStab) ? "admin" : null);
    const i = want ? kinds.findIndex((k, j) => !pr[j] && k === want && !pouchReason(it, want)) : -1;
    if (i >= 0) { pr[i] = it; return true; }
  }
  if (isSmall(it.key)) { const i = s.pockets.indexOf(null); if (i >= 0) { s.pockets[i] = it; return true; } }
  const pk = packOf(s);
  if (pk && !packSize(it) && !isBulky(it.key)) { const i = pk.indexOf(null); if (i >= 0) { pk[i] = it; return true; } }
  return false;
}
// A rolled thing that only went with the gun a pick replaced: its spare magazines and boxes of its rounds (not the
// picked gun's).
/** @param {any} it @param {any} gun */
function wentWithOldGun(it, gun) {
  const d = GEAR[it.key];
  if (!d) return false;
  if (d.mag) return !(gun && magFitsGun(gun.key, it.key));
  if (d.rounds && d.count) return !(gun && calOf(gun.key) === d.rounds.cal);
  return false;
}

// Puts a colonist's picks on them (after the dice and any custom background). Returns what the caller hands on:
// { replaced: items the picks took off them, left: picked things with no room, mags: spare magazines with no room,
//   rounds: { round key: n } for a picked gun or launcher, arrows, gun: a gun was picked (its rolled rounds are not
//   theirs) } or null with no picks.
/** @param {any} s */
export function applyStartGear(s) {
  const P = sanitizeStartGear(s && s.startGear);
  if (!P) return null;
  ensureInv(s);
  /** @type {{ replaced: any[], left: any[], mags: any[], rounds: Record<string, number>, arrows: number, gun: boolean }} */
  const out = { replaced: [], left: [], mags: [], rounds: {}, arrows: 0, gun: "weapon" in P.slots };
  /** @type {Record<string, string>} */
  const rolled = {};
  // What they carry comes out first when where it goes changes: a new pack, rig or vest, a new gun (its own
  // magazines and rounds), or a list of their own.
  const moves = ["weapon", "armor", "rig", "backpack"].some((k) => k in P.slots) || !!P.items;
  const loose = moves ? takeCarried(s) : [];
  for (const slot of START_GEAR.SLOTS) {
    if (!(slot in P.slots)) continue;
    const old = s.gear[slot];
    rolled[slot] = old ? old.name : "";
    if (slot === "weapon" || slot === "armor") s.startDice = { ...(s.startDice || {}), [slot]: old || null };
    if (old) out.replaced.push(old);
    s.gear[slot] = P.slots[slot] ? makeItem(P.slots[slot]) : null;
  }
  // A chest rig does not go over a vest with pouches of its own (inventory.js fitReason): the body armour stays.
  let rigOff = "";
  if (s.gear.rig && fitReason(s.gear.rig, "rig", s)) {
    rigOff = fitReason(s.gear.rig, "rig", s);
    (P.slots.rig ? out.left : out.replaced).push(s.gear.rig);
    s.gear.rig = null;
  }
  let things = loose;
  if (P.items) { out.replaced.push(...loose); things = P.items.map(makeItem); }
  else if (out.gun) { // as rolled, but what only went with the replaced gun goes with it
    out.replaced.push(...loose.filter((it) => wentWithOldGun(it, s.gear.weapon)));
    things = loose.filter((it) => !wentWithOldGun(it, s.gear.weapon));
  }
  for (const it of things) if (!place(s, it)) (P.items ? out.left : out.replaced).push(it);
  // A picked gun: the start kit's spare magazines and its rounds; a launcher's rounds; a bow's quiver.
  const gun = P.slots.weapon ? s.gear.weapon : null;
  const w = gun && WEAPONS[gun.key];
  if (gun && w) {
    if (standardMag(gun.key)) starterMags(s, out.mags);
    const cal = calOf(gun.key);
    if (cal) out.rounds[keyFor(cal, null)] = Math.max(1, w.cap || 1) * START_GEAR.LOADS;
    else if (w.launcher && !w.oneShot) out.rounds[keyFor(w.launcher, null)] = START_GEAR.LAUNCH;
    if (GEAR[gun.key].cat === "bow") out.arrows = START_GEAR.ARROWS;
  }
  // For the editor (the next rebuild writes them again).
  s.startGear = { ...P, rolled, left: out.left.map((it) => it.name), ...(rigOff ? { rig: rigOff } : {}) };
  return out;
}

// A normal start (world.js createWorld, after the custom backgrounds' kit): everyone's picks on them; what they replace,
// what has no room and spare magazines with no room go to the hub's armory; a picked gun's rounds and a bow's arrows
// to its stock.
/** @param {any} state @param {any} base */
export function normalStartGear(state, base) {
  for (const s of state.survivors) {
    const out = applyStartGear(s);
    if (!out) continue;
    base.armory.push(...out.replaced, ...out.left, ...out.mags);
    addRecord(base.stock, out.rounds);
    if (out.arrows) base.stock.arrows = (base.stock.arrows || 0) + out.arrows;
  }
}

// Hardcore (hardcore-start.js setupHardcoreStart, right after one survivor's grab is rolled): their picks on them in
// place of what they grabbed, which is not grabbed (nor the rounds and arrows of a replaced gun, unless a custom
// background set them). got is updated for the day-1 lines (the bag, the weapon, the vest, the things); got.rounds:
// the picked gun's rounds, for the line. Returns { rounds, arrows } to add to the team's supplies, or null.
/** @param {any} state @param {any} s @param {any} got */
export function grabStartGear(state, s, got) {
  const out = applyStartGear(s);
  if (!out) return null;
  if (out.gun && !got.custom) { got.ammo = 0; got.arrows = 0; }
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

// Start: the picks are ordinary gear from here on; nothing of the new-run screen stays on the colonists.
/** @param {any} state */
export function clearStartGear(state) {
  for (const s of state.survivors) { delete s.startGear; delete s.startDice; }
}
