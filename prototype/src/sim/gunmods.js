// Gun attachments (sights, mounts, muzzle devices, magazines, stocks, grips, rails, lights and lasers, bipods, slings)
// fitted to a weapon item: item.mods = { slot: modItem }. An attachment is an ordinary item (data.js GEAR, cat
// "gunmod": looted, traded, carried in a pocket or the pack); fitted, it rides on the gun: it weighs and is worth what it
// is with the gun (inventory.js itemLoad, valuation.js itemValue), moves, is sold and is looted with it, and is saved
// with it (save.js writes the item as it is).
//
// Contract shared with the magazine / reload branch and the weapons overhaul (keep the names): gunMods(item) -> what
// the item's fitted attachments add up to, neutral (NO_MODS) for a gun without any or anything that is not a gun:
//   aim: + to hit, close: + to hit within 2.5 tiles, opt: + best range (tiles), fall: + aim lost per tile beyond it,
//   dmg: × damage, cap: + rounds in the magazine, capMult: × magazine size, noise: × shot noise,
//   weight: + kg, value: + trade value (base values; the item's own worth is valuation.js itemValue),
//   night: + aim at night, nightNear: + aim at night within 6 tiles (a weapon light), peq: + aim at night for a
//   shooter with night vision (an IR laser), brace: + aim when the gun rests on half cover in the shot's line (a bipod),
//   moving: + aim when it did (a sling), jam: × jam odds (combat.js jams, section 14), thermal: the shooter sees in the
//   dark (a thermal sight), light: a weapon light (works as a flashlight, lights.js), flashless: the muzzle flash no
//   longer shows the shooter, launcher: an under-barrel launcher's ammo ("40mm", section 13) or null.
// Magazine size (combat.js, the magazine branch) = round(WEAPONS[key].cap × capMult) + cap.
//
// Where the numbers act: combat.js shotOdds reads the unit's gm (playerUnit / refitUnit / enemyUnit set it: aim, close,
// opt, fall, dmg; situationalAim: brace, moving, night, nightNear, peq); stealth.js shotNoise multiplies a shot's noise
// by noise (battle earshot and alerts, raid Heat, the map's gunfire Heat through b.gunshots); hunting.js
// huntWeaponInfo takes the gun's noise × noise (a hunt's Heat, the base's hunting noise and the chance the wandering
// dead turn toward the shots).
//
// Platforms and slots (data-gunmods.js): every gun is on a platform (WEAPON_PLATFORM) with its open slots; a part goes
// in one slot (ATTACH[key].slot), one part a slot; some parts open more slots (adds: a scope mount carries a sight, a
// quad rail a grip, a light and a bipod); under and grip share the space under the handguard. Muzzle devices fit by
// calibre, everything else by platform (or any gun with that slot open). The gun builder (ui/gunbuilder.js, agent D)
// calls slotsOf / fitsSlot / fitAt / stripAt; the inventory's Fit / Remove buttons the item-level fitMod / stripMod.
// Saves from before the slots (four mounts: optic, muzzle, mag, under) are migrated (migrateMods): the laser, the
// foregrip and the bipod leave "under" for the tactical, grip and bipod slots, and a sight on a gun that now needs a
// mount for one gets its rings.
//
// The numbers, against the weapon table (combat.js WEAPONS: a 9mm aims +4, the assault rifle +8; half cover is −20 and
// full cover −40, so no attachment is worth a step of cover; base aim is 40 + 2.5 a Shooting level, so +4 is what
// 1.6 levels of Shooting give). The first fifteen (before the overhaul):
//   attachment            slot    aim close opt  fall  dmg   cap  ×cap noise  kg    value  fits
//   Red dot sight         optic   +4                                          0.2   22     pistols, revolver (mount), shotguns, lever (mount), AR-15, AK (mount), SMG (mount)
//   Holographic sight     optic   +5  +3                                      0.35  35     pump (mount), semi-auto shotgun, AR-15, AK (mount), SMG (mount), LMG
//   4× rifle scope        optic       −8   +3   −0.5                          0.6   40     lever (mount), AR-15, AK (mount), .22 rifle (the hunting rifle has its own)
//   Laser sight           tactical +1 +6                                      0.1   20     any gun with a light / laser slot
//   Vertical foregrip     grip    +2  +2                                      0.15  12     the AR-15 (under the handguard), the pump shotgun, a rail
//   Bipod                 bipod   +8 rested on half cover next to the shooter 0.4  18     bolt, lever, AR-15, AR-10, .22 rifle, a quad rail
//   9mm suppressor        muzzle           −1         ×0.95           ×0.35   0.25  45     9mm
//   Rifle suppressor      muzzle           −1         ×0.95           ×0.4    0.55  60     5.56, 7.62×39, .308, .30-30
//   Oil-filter suppressor muzzle                                      ×0.5    0.4   12     9mm, 5.56, .308, .30-30; wears out in 12 shots
//   Muzzle brake          muzzle  +3                                  ×1.3    0.15  18     rifle calibres (louder)
//   Pistol compensator    muzzle  +2                                  ×1.15   0.1   14     9mm, .45, .357 (louder)
//   Shotgun choke         muzzle      −4   +2   −2                            0.05  12     12 gauge (tighter spread: reaches further, less up close)
//   Extended pistol mag   mag                              +9                 0.15  14     9mm pistols (15 → 24 rounds)
//   Drum magazine         mag     −2                             ×2           1.1   38     the AR-15 family (30 → 60; heavy and clumsy)
//   Shotgun tube extension mag                             +2                 0.25  14     pump shotgun (6 → 8)
// The rest: data-gunmods.js MOD_ATTACH (the plan's section 5 table). Which slots a gun has: data-gunmods.js PLATFORMS,
// CATEGORIES and WEAPON_SLOTS (a revolver takes a scope on rings, a can or a compensator, grips and a laser grip, never
// a foregrip; user, 2026-10-10); a shotgun takes only the rare shotgun can (and a bottle never); bows and melee weapons take nothing,
// the pipe shotgun a sling. Fall never drops below FALL_MIN a tile. A shot's noise × noise: a suppressed rifle shot
// (noise 3) is 1.2, heard 15 × 0.4 = 6 tiles off in a raid (9 + 2 × noise, × the share) instead of 15.
import { GEAR } from "./data.js";
import { GUN_WEAPONS } from "./data-guns.js";
import { CALIBERS, CAL_ACCEPTS } from "./data-ammo.js";
import { SLOTS, SLOT_NAMES, SHARED, PLATFORMS, CATEGORIES, WEAPON_PLATFORM, WEAPON_SLOTS, PLATFORM_GUESS, BASE_CAL, MOD_ATTACH, PLATFORM_LIKE, PLATFORM_LIKE_SKIP, PART_INFO, OLD_PART_CLASS, BUDGET_MAGS } from "./data-gunmods.js";
import { KIT_ATTACH } from "./data-kit.js"; // magazines as items (section 15): the extended mag and the drum are magazine items now
// The gun builder's sim calls on inventory locations (they live with the inventory's location handling).
export { fitAt, stripAt } from "./inventory.js";
import { activeLight, nvgOn } from "./vision.js"; // the switches: a light, night vision on or off (call time only)
import { stow } from "./inventory.js"; // (call time only: relocateMisfits puts a part taken off into the carrier's kit)
export { SLOTS, SLOT_NAMES, PLATFORMS, CATEGORIES, WEAPON_PLATFORM, WEAPON_SLOTS };

export const NO_MODS = Object.freeze({
  aim: 0, close: 0, opt: 0, fall: 0, dmg: 1, cap: 0, capMult: 1, noise: 1, weight: 0, value: 0,
  night: 0, nightNear: 0, peq: 0, brace: 0, moving: 0, jam: 1, spread: 0, thermal: false, light: false, flashless: false, launcher: null,
  reload: 0, // + shells a tube Reload puts in (a side-saddle: mags.js), + rounds a lever-action's (a cartridge cuff)
  hand: 0, // + loose shells at hand at a fight's start (a buttstock shell holder: mags.js SHELLS.START_HAND)
});
// Budget sights drift off zero (user pick 2026-10-10): a budget optic, magnifier or set of rings loses 1 aim every PER
// fights since it was last zeroed (item.zero: fights since), up to MAX, until it breaks (its dur) or is re-zeroed at a
// workbench (repair.js rezeroHour: free, every morning, on the guns at a base with a workbench).
export const DRIFT = { PER: 5, MAX: 4, SLOTS: ["optic", "magnifier", "mount"] };
/** The aim a fitted part has lost to drift (0 for a part that does not drift). @param {any} m */
export function driftOf(m) {
  const a = m && ATTACH[m.key], d = m && GEAR[m.key];
  if (!a || !d || !d.budget || !DRIFT.SLOTS.includes(a.slot)) return 0;
  return Math.min(DRIFT.MAX, Math.floor((m.zero || 0) / DRIFT.PER));
}
export const MOUNTS = SLOTS; // every slot (the old name: there were four mounts)
export const MOUNT_NAMES = SLOT_NAMES;
export const FALL_MIN = 0.5;
const RIFLE_CALS = ["556", "762x39", "308", "3030"];

// Battle and noise numbers by GEAR key (the item itself, its name, weight, value and description: data.js GEAR).
// slot: where it goes (mount: the same, the old name); fits: { cal, plat, any, notCal, notPlat }; short: how it reads
// in a weapon's name ("9mm pistol (red dot, suppressor)"); look: the gun builder's art.
const LEGACY = {
  reddot:    { slot: "optic",    short: "red dot",      look: "reddot",   fits: { plat: ["glock", "p1911", "revolver", "pump", "semi12", "lever", "ar15", "ak", "mp5", "dbl", "ranch"] }, adds: ["magnifier"], aim: 4 },
  holo:      { slot: "optic",    short: "holo sight",   look: "holo",     fits: { plat: ["pump", "semi12", "ar15", "ak", "mp5", "m249"] }, adds: ["magnifier"], aim: 5, close: 3 },
  scope4x:   { slot: "optic",    short: "4× scope",     look: "scope4",   fits: { plat: ["lever", "ar15", "ak", "rimrifle", "single", "revolver", "ranch"] }, opt: 3, fall: -0.5, close: -8 },
  laser:     { slot: "tactical", short: "laser",        look: "laser",    fits: { any: true }, aim: 1, close: 6 },
  foregrip:  { slot: "grip",     short: "foregrip",     look: "vgrip",    fits: { any: true, notPlat: ["revolver"] }, aim: 2, close: 2 },
  bipod:     { slot: "bipod",    short: "bipod",        look: "bipod",    fits: { any: true }, brace: 8 },
  pistolcan: { slot: "muzzle",   short: "suppressor",   look: "can_s",    fits: { cal: ["9mm"] }, can: true, opt: -1, dmg: 0.95, noise: 0.35, jam: 1.2 },
  riflecan:  { slot: "muzzle",   short: "suppressor",   look: "can_l",    fits: { cal: RIFLE_CALS }, can: true, opt: -1, dmg: 0.95, noise: 0.4, jam: 1.3 },
  suppressor:{ slot: "muzzle",   short: "oil-filter suppressor", look: "oilfilter", fits: { cal: ["9mm", "556", "308", "3030"] }, can: true, noise: 0.5, jam: 1.5 }, // makeshift: GEAR dur = shots
  brake:     { slot: "muzzle",   short: "muzzle brake", look: "brake",    fits: { cal: RIFLE_CALS }, aim: 3, noise: 1.3 },
  comp:      { slot: "muzzle",   short: "compensator",  look: "comp",     fits: { cal: ["9mm", "45acp", "357", "38spl", "57x28", "44mag"] }, aim: 2, noise: 1.15 },
  choke:     { slot: "muzzle",   short: "choke",        look: "choke",    fits: { cal: ["12ga", "20ga"] }, opt: 2, fall: -2, close: -4, spread: 2 }, // spread: + tiles of buckshot's full damage (data-ammo.js spreadMult)
  extmag:    { slot: "mag",      short: "extended mag", look: "stick20",  fits: { plat: ["glock"] }, cap: 9 },
  drum:      { slot: "mag",      short: "drum mag",     look: "drum",     fits: { plat: ["ar15"] }, capMult: 2, aim: -2, jam: 1.5 },
  tubeext:   { slot: "mag",      short: "tube extension", look: "tube_ext", fits: { plat: ["pump", "semi12"] }, cap: 2 },
};
export const ATTACH = {};
for (const [k, a] of Object.entries({ ...LEGACY, ...MOD_ATTACH, ...KIT_ATTACH })) ATTACH[k] = { ...a, mount: a.slot };
// The new platforms (data-gunmods.js PLATFORM_LIKE) take what their look-alike takes, magazines aside.
for (const [plat, like] of Object.entries(PLATFORM_LIKE)) {
  for (const [k, a] of Object.entries(ATTACH)) {
    const f = a.fits;
    if (!f || !f.plat || !f.plat.includes(like) || f.plat.includes(plat) || a.magCap || (PLATFORM_LIKE_SKIP[plat] || []).includes(k)) continue;
    ATTACH[k] = { ...a, fits: { ...f, plat: [...f.plat, plat] } };
  }
}
// A part's tier (brand / civil / budget / makeshift), rarity (data-ammo.js RARITY), tags (where it is kept) and, for a
// budget clone, the part it copies (data-gunmods.js PART_INFO, OLD_PART_CLASS, BUDGET_MAGS): the loot tables' and the
// gun-loot branch's handle on every part. null for a key that is no part.
export function partClass(key) {
  const i = PART_INFO[key] || BUDGET_MAGS[key];
  if (i) return { tier: i.tier, rarity: i.rarity, tags: [...i.tags], brandOf: i.brandOf || null };
  const o = OLD_PART_CLASS[key];
  if (o) return { tier: o[0], rarity: o[1], tags: null, brandOf: null };
  return ATTACH[key] ? { tier: "civil", rarity: "common", tags: null, brandOf: null } : null;
}
// A magazine item (data-kit.js MAGAZINES): its rounds (null: not a magazine).
export const magCapOf = (key) => (ATTACH[key] && ATTACH[key].magCap) || null;
export const isGunmod = (key) => !!ATTACH[key];
export const modDef = (key) => ATTACH[key] || null;

// ---------- platforms, calibres, slots ----------
export const calOf = (gunKey) => (GUN_WEAPONS[gunKey] && GUN_WEAPONS[gunKey].cal) || BASE_CAL[gunKey] || null;
const NOT_GUN_CAL = ["40mm", "rocket"];
// A platform for a gun with none in WEAPON_PLATFORM (data-gunmods.js PLATFORM_GUESS: by its category, calibre and name
// or description), or null (not a gun: a bow, a launcher, a blade).
export function guessPlatform(gunKey) {
  const d = GEAR[gunKey], cal = calOf(gunKey);
  if (!d || d.slot !== "weapon" || !cal || NOT_GUN_CAL.includes(cal) || d.launcher) return null;
  const rows = PLATFORM_GUESS.filter((r) => r.cat === d.cat && (!r.cal || r.cal.includes(cal)) && PLATFORMS[r.plat]);
  for (const text of [d.name || "", d.desc || ""]) {
    const hit = rows.find((r) => r.words && new RegExp(r.words, "i").test(text));
    if (hit) return hit.plat;
  }
  const plain = rows.find((r) => !r.words);
  return plain ? plain.plat : null;
}
// Every gun in GEAR has a platform from here on (the modules that read WEAPON_PLATFORM directly see it too: the gun
// art, misfires, reloading); a gun added later is guessed when it is first asked about.
for (const k of Object.keys(GEAR)) if (!WEAPON_PLATFORM[k]) { const p = guessPlatform(k); if (p) WEAPON_PLATFORM[k] = p; }
export const platformOf = (gunKey) => {
  if (WEAPON_PLATFORM[gunKey]) return WEAPON_PLATFORM[gunKey];
  const p = guessPlatform(gunKey);
  if (p) WEAPON_PLATFORM[gunKey] = p;
  return p;
};
// The calibres a gun takes (data-ammo.js CAL_ACCEPTS, a gun's own cals; ammo.js gunCalsOf without the WEAPONS import).
const gunCalsHere = (gunKey) => { const w = GUN_WEAPONS[gunKey], c = calOf(gunKey); return w && Array.isArray(w.cals) ? w.cals : c ? CAL_ACCEPTS[c] || [c] : []; };
const builtinOf = (gunKey) => (PLATFORMS[platformOf(gunKey)] || {}).builtin || {};
const sharedWith = (slot) => (SHARED.find((g) => g.includes(slot)) || [slot]);
// The slots a slot gives room for: the space under the barrel takes a foregrip instead (not the other way round).
const expand = (slot) => (slot === "under" ? ["under", "grip"] : [slot]);
// The kind of gun (data-gunmods.js CATEGORIES) a weapon is, by its platform: "pistol", "revolver", "break"...
export const gunCategory = (gunKey) => (PLATFORMS[platformOf(gunKey)] || {}).cat || null;
// A gun's slot rules (data-gunmods.js PLATFORMS, CATEGORIES, WEAPON_SLOTS): slots: open bare; never: the slots it can
// never have (its kind's, less its own `on`, plus its own `off` and its built-in parts' slots); parts: { slot: [keys] }.
// Kept per gun key: the tables are fixed once loaded, and a gun item asks for its rules dozens of times (fitting,
// migrating, every fit check), a group's starting kit thousands. The same object comes back: read it, never change it.
const RULES = new Map();
export function slotRules(gunKey) {
  let r = RULES.get(gunKey);
  if (!r) RULES.set(gunKey, (r = readSlotRules(gunKey)));
  return r;
}
function readSlotRules(gunKey) {
  const P = PLATFORMS[platformOf(gunKey)];
  if (!P) return { slots: [], never: new Set(SLOTS), parts: {} };
  const own = WEAPON_SLOTS[gunKey] || {};
  const on = own.on || [];
  const never = new Set([...((CATEGORIES[P.cat] || {}).never || []).filter((s) => !on.includes(s)), ...(own.off || []), ...Object.keys(P.builtin || {})]);
  const open = new Set();
  for (const s of [...P.slots, ...on]) if (!never.has(s)) for (const x of expand(s)) if (!never.has(x)) open.add(x);
  return { slots: SLOTS.filter((s) => open.has(s)), never, parts: { ...(P.parts || {}), ...(own.parts || {}) } };
}
// The slots a bare gun has open (its platform's and its own, less what it lacks, its kind never has and is built in).
export const baseSlots = (gunKey) => slotRules(gunKey).slots;
// The slots this part opens on this gun (a mount's sight, a rail's grip, light and bipod), less those it can never have.
function opensOn(gunKey, modKey, rules = slotRules(gunKey)) {
  const a = ATTACH[modKey];
  const out = [];
  for (const s of (a && a.adds) || []) for (const x of expand(s)) if (!rules.never.has(x) && !out.includes(x)) out.push(x);
  return out;
}
// Does the part fit this kind of gun at all (calibre, platform, the slot's part list; the slot it needs exists on the
// gun bare or once a mount or rail that fits is on)? Not whether that slot is free now: fitsSlot.
export function modFits(gunKey, modKey) {
  const a = ATTACH[modKey], plat = platformOf(gunKey);
  if (!a || !plat || !PLATFORMS[plat]) return false;
  if (!partFitsStatic(gunKey, modKey)) return false;
  if (a.can && PLATFORMS[plat].nocan) return false;
  return couldHaveSlot(gunKey, a.slot);
}
// Can the gun have this slot: open bare, or opened by parts that fit it, nested (a mount's sight, that sight's
// magnifier: the slots reachable, reachableSlots).
function couldHaveSlot(gunKey, slot) {
  const rules = slotRules(gunKey);
  if (rules.never.has(slot)) return false;
  return rules.slots.includes(slot) || reachableSlots(gunKey).includes(slot);
}
// modFits without the slot test (for the parts that open slots: their own slot is a base one): calibre, platform and
// the slot's part list (a revolver's grip slot takes its grips, its light / laser slot a laser grip).
function partFitsStatic(gunKey, modKey) {
  const a = ATTACH[modKey], plat = platformOf(gunKey);
  const f = a.fits || {};
  const cal = calOf(gunKey);
  if (f.notPlat && f.notPlat.includes(plat)) return false;
  if (f.notCal && cal && f.notCal.includes(cal)) return false;
  if (f.plat && !f.plat.includes(plat)) return false;
  if (f.cal && !f.cal.includes(cal)) return false;
  if (f.guns && !f.guns.includes(gunKey)) return false; // a magazine for only some guns of its platform (the battle rifles)
  if (a.magCap && a.magCal) { const held = a.magCals || CAL_ACCEPTS[a.magCal] || [a.magCal]; if (!gunCalsHere(gunKey).some((c) => held.includes(c))) return false; } // it holds nothing the gun takes
  const only = slotRules(gunKey).parts[a.slot];
  if (only && !only.includes(modKey)) return false;
  return !!(f.plat || f.cal || f.any);
}
// Does this gun (a WEAPONS / GEAR key) take any attachment at all?
export const takesMods = (gunKey) => baseSlots(gunKey).length > 0;
// Attachments that fit a gun, by GEAR key.
export const modsFor = (gunKey) => Object.keys(ATTACH).filter((k) => modFits(gunKey, k));
const nameOf = (key) => (GEAR[key] ? GEAR[key].name : key);
// Every slot a gun can have: bare, or opened by a mount or a rail that fits it (the balance sheet, tools/gunslottest.js).
const OPENERS = Object.keys(ATTACH).filter((k) => ATTACH[k].adds);
// Kept per gun key, as slotRules (read it, never change it).
const REACHABLE = new Map();
export function reachableSlots(gunKey) {
  let r = REACHABLE.get(gunKey);
  if (!r) REACHABLE.set(gunKey, (r = readReachable(gunKey)));
  return r;
}
function readReachable(gunKey) {
  const rules = slotRules(gunKey);
  const out = new Set(rules.slots);
  for (let grew = true; grew;) {
    grew = false;
    for (const k of OPENERS) {
      if (!out.has(ATTACH[k].slot) || !partFitsStatic(gunKey, k)) continue;
      for (const s of opensOn(gunKey, k, rules)) if (!out.has(s)) { out.add(s); grew = true; }
    }
  }
  return SLOTS.filter((s) => out.has(s));
}
// The parts that fit a gun, by slot: { slot: [part keys] }.
export function partsBySlot(gunKey) {
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const k of modsFor(gunKey)) (out[ATTACH[k].slot] || (out[ATTACH[k].slot] = [])).push(k);
  return out;
}
// The parts on a gun, in slot order (any slot key: an unmigrated save's "under" too).
function fitted(item) {
  if (!item || !item.mods) return [];
  migrateMods(item);
  if (!item.mods) return []; // (migrateMods drops an empty mods object)
  const at = (k) => (SLOTS.indexOf(k) < 0 ? 99 : SLOTS.indexOf(k));
  const keys = Object.keys(item.mods).sort((a, b) => at(a) - at(b));
  return keys.map((k) => item.mods[k]).filter((x) => x && ATTACH[x.key]);
}
export const fittedMods = fitted;
// The slots open on a gun item now: its base slots, the slots its fitted mounts and rails add, and any slot with a
// part on it. Ordered as SLOTS. (A gun builder box per slot.)
export function slotsOf(item) {
  if (!item || !GEAR[item.key]) return [];
  const out = new Set(baseSlots(item.key));
  for (const [slot, m] of Object.entries(item.mods || {})) {
    if (!m || !ATTACH[m.key]) continue;
    out.add(slot);
    if (modFits(item.key, m.key)) for (const x of opensOn(item.key, m.key)) out.add(x);
  }
  for (const s of Object.keys(builtinOf(item.key))) out.delete(s);
  return SLOTS.filter((s) => out.has(s));
}
// Slots opened by the part in `slot` (its children: they come off first when it does).
export const childSlots = (item, slot) => {
  const m = item && item.mods && item.mods[slot];
  const adds = m && ATTACH[m.key] && ATTACH[m.key].adds;
  return adds ? SLOTS.filter((s) => adds.some((a) => expand(a).includes(s)) && !baseSlots(item.key).includes(s)) : []; // (children: whatever sits there, even a slot it can no longer open)
};
// The built-in parts of a gun (the light machine gun's and the .50's bipod): { slot: key }.
export const builtinMods = (gunKey) => ({ ...builtinOf(gunKey) });

// Why this part cannot go in that slot of this gun ("" when it can; whatever is in that slot now comes off). Takes
// (gun, part, slot?) or the gun builder's order (gun, slot, part).
export function fitsSlot(gun, mod, slot = null) {
  if (typeof mod === "string") [mod, slot] = [slot, mod];
  const a = mod && ATTACH[mod.key];
  if (!a) return `${mod ? mod.name : "That"} is not a gun attachment.`;
  if (!gun || !GEAR[gun.key]) return "No gun to fit it to.";
  const want = slot || a.slot;
  const gunName = GEAR[gun.key].name.toLowerCase();
  if (want !== a.slot) return `The ${mod.name} goes on the ${SLOT_NAMES[a.slot].toLowerCase()}, not the ${(SLOT_NAMES[want] || want).toLowerCase()}.`;
  if (!modFits(gun.key, mod.key)) {
    const plat = PLATFORMS[platformOf(gun.key)];
    if (a.can && plat && plat.nocan) return `No suppressor fits a ${gunName}.`;
    const rules = slotRules(gun.key);
    const an = (w) => (/^[aeiou]/i.test(w) ? "an" : "a");
    if (!couldHaveSlot(gun.key, a.slot)) return `${an(gunName) === "an" ? "An" : "A"} ${gunName} has no ${(a.slot === "grip" ? "foregrip" : SLOT_NAMES[a.slot]).toLowerCase()} slot${rules.never.has(a.slot) && plat && CATEGORIES[plat.cat] ? ` (no ${CATEGORIES[plat.cat].name.toLowerCase()} has)` : ""}.`;
    const only = rules.parts[a.slot];
    if (only && !only.includes(mod.key)) {
      const names = only.map((k) => { const n = nameOf(k).toLowerCase(); return /s$/.test(n) ? n : `${an(n)} ${n}`; }).join(" or ");
      return a.slot === "grip" ? `${an(gunName) === "an" ? "An" : "A"} ${gunName} has no foregrip slot (its grip takes ${names}).` : `On ${an(gunName)} ${gunName} the ${SLOT_NAMES[a.slot].toLowerCase()} slot takes only ${names}.`;
    }
    return `The ${mod.name} does not fit a ${gunName}.`;
  }
  // The slot must be open now (a sight on a gun that needs a mount for one, a grip with no rail or room under it).
  const bare = { ...gun, mods: { ...(gun.mods || {}) } };
  delete bare.mods[want];
  for (const c of childSlots(gun, want)) delete bare.mods[c];
  const open = new Set(baseSlots(gun.key));
  for (const m of Object.values(bare.mods)) if (m && ATTACH[m.key] && modFits(gun.key, m.key)) for (const y of opensOn(gun.key, m.key)) open.add(y);
  if (!open.has(want)) {
    const opener = Object.keys(ATTACH).find((k) => ATTACH[k].adds && opensOn(gun.key, k).includes(want) && modFits(gun.key, k));
    return `The ${gunName} has no ${SLOT_NAMES[want].toLowerCase()} slot free${opener ? `: fit a ${nameOf(opener).toLowerCase()} first` : ""}.`;
  }
  for (const s of sharedWith(want)) if (s !== want && bare.mods[s]) return `The ${bare.mods[s].name} takes that space (${SLOT_NAMES[s].toLowerCase()} and ${SLOT_NAMES[want].toLowerCase()} share it): take it off first.`;
  return "";
}
export const modFitReason = (gun, mod) => fitsSlot(gun, mod);
// Fits mod to gun. { ok, why, old, off }: old = what came off that slot (null when it was free); off = everything that
// came off (old, and the parts on the slots old had opened that the new one does not).
export function fitMod(gun, mod) {
  const why = fitsSlot(gun, mod);
  if (why) return { ok: false, why, old: null, off: [] };
  const slot = ATTACH[mod.key].slot;
  gun.mods = gun.mods || {};
  const old = gun.mods[slot] || null;
  const kids = old ? childSlots(gun, slot) : [];
  gun.mods[slot] = mod;
  const off = old ? [old] : [];
  const open = new Set(slotsOf({ key: gun.key, mods: Object.fromEntries(Object.entries(gun.mods).filter(([k]) => !kids.includes(k))) }));
  for (const c of kids) if (gun.mods[c] && !open.has(c)) { off.unshift(gun.mods[c]); delete gun.mods[c]; }
  return { ok: true, why: "", old, off };
}
// Takes the part off a slot and returns it (null when there is none). The parts on the slots it opened stay fitted:
// stripMod takes them off too.
export function removeMod(gun, slot) {
  if (!gun || !gun.mods || !gun.mods[slot]) return null;
  const m = gun.mods[slot];
  delete gun.mods[slot];
  if (!Object.keys(gun.mods).length) delete gun.mods;
  return m;
}
// Takes the part off a slot with the parts it carries (children first). Returns them all ([] when the slot is empty).
export function stripMod(gun, slot) {
  if (!gun || !gun.mods || !gun.mods[slot]) return [];
  const out = [];
  for (const c of childSlots(gun, slot)) if (gun.mods && gun.mods[c]) out.push(...stripMod(gun, c));
  const m = removeMod(gun, slot);
  if (m) out.push(m);
  return out;
}
// A mount that fits this gun and opens `slot` (a sight's rings on a lever-action, a side mount on an AK), or null.
export function mountFor(gunKey, slot) {
  return Object.keys(ATTACH).find((k) => ATTACH[k].adds && opensOn(gunKey, k).includes(slot) && ATTACH[k].slot === "mount" && modFits(gunKey, k)) || null;
}

// Saves from before the slots (four mounts: optic, muzzle, mag, under): a part on the wrong slot key moves to its own
// (the laser to tactical, the foregrip to grip, the bipod to bipod); a sight on a gun that needs a mount for one gets
// its rings (a free scope mount or side mount, at the sight's condition: it had to sit on something). Safe to call any
// number of times; returns the item.
export function migrateMods(item) {
  const mods = item && item.mods;
  if (!mods || typeof mods !== "object") return item;
  for (const slot of Object.keys(mods)) {
    const m = mods[slot];
    if (!m) { delete mods[slot]; continue; }
    const a = ATTACH[m.key];
    if (!a || a.slot === slot || mods[a.slot]) continue;
    mods[a.slot] = m;
    delete mods[slot];
  }
  for (const slot of Object.keys(mods)) {
    const m = mods[slot];
    if (!m || !ATTACH[m.key] || mods.mount || slot === "mount") continue;
    if (!platformOf(item.key) || baseSlots(item.key).includes(slot) || !modFits(item.key, m.key)) continue;
    const mk = mountFor(item.key, slot);
    if (mk) mods.mount = makeMod(mk, m.quality ?? 1);
  }
  if (!Object.keys(mods).length) delete item.mods;
  return item;
}
// Every gun in a save (a walk over the state: people, armories, cargo, bodies, wares, sites...). save.js on load.
export function migrateAllMods(state) {
  const seen = new Set();
  const walk = (o) => {
    if (!o || typeof o !== "object" || seen.has(o) || ArrayBuffer.isView(o)) return;
    seen.add(o);
    if (o instanceof Map) { for (const v of o.values()) walk(v); return; }
    if (o instanceof Set || Array.isArray(o)) { for (const v of o) walk(v); return; }
    if (o.mods && typeof o.key === "string" && GEAR[o.key]) migrateMods(o);
    for (const k of Object.keys(o)) { const v = o[k]; if (v && typeof v === "object") walk(v); }
  };
  walk(state);
}

// ---------- parts that no longer fit (the slot rules of 2026-10-10, or any later change) ----------
// Takes off the parts on a gun item that do not fit it as it is now (fitsSlot: a foregrip on a plain pump, a weapon
// light on a revolver, a part on a slot its kind never has), each with what it carried, and returns them (slot order).
// A part this game no longer knows (no ATTACH entry) is left where it is.
export function stripMisfits(item) {
  const out = [];
  if (!item || !item.mods || typeof item.mods !== "object" || !GEAR[item.key]) return out;
  migrateMods(item);
  for (let n = 0; n < 24 && item.mods; n++) {
    const order = [...SLOTS, ...Object.keys(item.mods).filter((k) => !SLOTS.includes(k))];
    const slot = order.find((s) => { const m = item.mods && item.mods[s]; return m && ATTACH[m.key] && !!fitsSlot(item, m, s); });
    if (!slot) break;
    out.push(...stripMod(item, slot));
  }
  return out;
}
// Where the player's things are kept: a part taken off a gun there with nowhere nearer goes to the home armory.
const PLAYER_ROOTS = ["survivors", "parties", "bases"];
// On load (save.js): every gun in the state loses the parts that no longer fit it, and keeps them close (never
// deleted): in the list the gun lies in when it is an armory (beside it), else in the pockets or pack of the person
// carrying it (inventory.js stow), else the armory of the base it is at, else (the player's people, teams and bases)
// the home armory. A part with nowhere to go stays on the gun (gunMods never counts a part that does not fit).
// Returns [{ part, gun, where }] (where: "armory", "kit:<name>", "beside", "" for left on).
// A walk over the state for the load-time fixes (relocateMisfits, migrateParts): visit(o, ctx, keep) on every plain
// object; keep(item, ctx) puts an item by where the walk is (relocateMisfits' rules) and says where ("" for nowhere).
function walkKept(state, visit) {
  const seen = new Set();
  const hubArmory = () => {
    const h = (state.bases || []).find((b) => b && b.type === "hub") || (state.bases || [])[0];
    return h && Array.isArray(h.armory) ? h.armory : null;
  };
  const keep = (part, ctx) => {
    if (ctx.list && ctx.listName === "armory") { ctx.list.push(part); return "armory"; }
    if (ctx.person) {
      try { if (stow(ctx.person, part)) return `kit:${ctx.person.name || "someone"}`; } catch { /* a malformed person: keep looking */ }
    }
    if (ctx.armory) { ctx.armory.push(part); return "armory"; }
    if (PLAYER_ROOTS.includes(ctx.root)) { const a = hubArmory(); if (a) { a.push(part); return "armory"; } }
    return "";
  };
  const isPerson = (o) => o && typeof o === "object" && o.gear && typeof o.gear === "object" && Array.isArray(o.pockets);
  const walk = (o, ctx) => {
    if (!o || typeof o !== "object" || seen.has(o) || ArrayBuffer.isView(o)) return;
    seen.add(o);
    if (o instanceof Map) { for (const v of o.values()) walk(v, { ...ctx, list: null }); return; }
    if (o instanceof Set) { for (const v of o) walk(v, { ...ctx, list: null }); return; }
    if (Array.isArray(o)) { for (const v of [...o]) walk(v, { ...ctx, list: o }); return; }
    visit(o, ctx, keep, seen);
    const next = { ...ctx };
    if (isPerson(o)) next.person = o;
    if (Array.isArray(o.armory)) next.armory = o.armory;
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (v && typeof v === "object") walk(v, { ...next, listName: k, root: ctx.root ?? (o === state ? k : null) });
    }
  };
  walk(state, { root: null, list: null, listName: null, person: null, armory: null });
}
// Parts of 2026-10-10 that became others (user picks): a holo sight and magnifier in one (holomag) is now a holo sight and
// a magnifier, the budget set (cheapmag) a budget red dot and a budget magnifier; and the hunting rifle's scope is a part
// now (data-guns.js FACTORY_FIT): a hunting rifle from before gets it fitted (its numbers came down by as much).
export const SPLIT_PARTS = { holomag: ["holo", "magnifier"], cheapmag: ["cheapdot", "cheapmagnifier"] };
// On load (save.js, once: state.attachV 2). Returns { split, scoped }: how many of each.
export function migrateParts(state) {
  const out = { split: 0, scoped: 0 };
  const remake = (old, key) => { const it = makeMod(key, old.quality ?? 1); if (old.dur != null && GEAR[key] && GEAR[key].dur) it.dur = Math.min(GEAR[key].dur, old.dur); return it; };
  walkKept(state, (o, ctx, keep, seen) => {
    if (typeof o.key !== "string" || o.quality == null) return; // items only (a new-run pick is { key, mods: { slot: key } })
    if (o.mods && typeof o.mods === "object" && GEAR[o.key] && GEAR[o.key].slot === "weapon") {
      for (const [slot, m] of Object.entries(o.mods)) {
        const sp = m && SPLIT_PARTS[m.key];
        if (!sp) continue;
        o.mods[slot] = remake(m, sp[0]);
        const mag = remake(m, sp[1]);
        if (!o.mods.magnifier) o.mods.magnifier = mag; else keep(mag, ctx);
        seen.add(o.mods[slot]); seen.add(mag);
        out.split++;
      }
      if (o.key === "huntrifle" && !(o.mods && o.mods.optic)) { o.mods.optic = makeMod("huntrifscope", o.quality ?? 1); seen.add(o.mods.optic); out.scoped++; }
      return;
    }
    if (o.key === "huntrifle" && o.name) { o.mods = { optic: makeMod("huntrifscope", o.quality ?? 1) }; seen.add(o.mods.optic); out.scoped++; return; }
    const sp = SPLIT_PARTS[o.key];
    if (sp && o.name && !GEAR[o.key]) {
      const first = remake(o, sp[0]);
      Object.assign(o, first); if (first.dur == null) delete o.dur;
      const mag = remake({ quality: o.quality }, sp[1]);
      seen.add(mag);
      keep(mag, ctx);
      out.split++;
    }
  });
  return out;
}
export function relocateMisfits(state) {
  const moved = [];
  const seen = new Set();
  const hubArmory = () => {
    const h = (state.bases || []).find((b) => b && b.type === "hub") || (state.bases || [])[0];
    return h && Array.isArray(h.armory) ? h.armory : null;
  };
  const place = (part, gun, ctx) => {
    if (ctx.list && ctx.listName === "armory") { ctx.list.push(part); return "armory"; }
    if (ctx.person) {
      try { if (stow(ctx.person, part)) return `kit:${ctx.person.name || "someone"}`; } catch { /* a malformed person: keep looking */ }
    }
    if (ctx.armory) { ctx.armory.push(part); return "armory"; }
    if (PLAYER_ROOTS.includes(ctx.root)) { const a = hubArmory(); if (a) { a.push(part); return "armory"; } }
    return "";
  };
  const isPerson = (o) => o && typeof o === "object" && o.gear && typeof o.gear === "object" && Array.isArray(o.pockets);
  const walk = (o, ctx) => {
    if (!o || typeof o !== "object" || seen.has(o) || ArrayBuffer.isView(o)) return;
    seen.add(o);
    if (o instanceof Map) { for (const v of o.values()) walk(v, { ...ctx, list: null }); return; }
    if (o instanceof Set) { for (const v of o) walk(v, { ...ctx, list: null }); return; }
    if (Array.isArray(o)) { for (const v of o) walk(v, { ...ctx, list: o }); return; }
    if (o.mods && typeof o.key === "string" && GEAR[o.key] && GEAR[o.key].slot === "weapon") {
      for (const part of stripMisfits(o)) {
        const where = place(part, o, ctx);
        if (!where) { (o.mods || (o.mods = {}))[ATTACH[part.key].slot] = o.mods[ATTACH[part.key].slot] || part; } // nowhere: back on (not counted)
        moved.push({ part, gun: o, where });
      }
    }
    const next = { ...ctx };
    if (isPerson(o)) next.person = o;
    if (Array.isArray(o.armory)) next.armory = o.armory;
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (v && typeof v === "object") walk(v, { ...next, listName: k, root: ctx.root ?? (o === state ? k : null) });
    }
  };
  walk(state, { root: null, list: null, listName: null, person: null, armory: null });
  return moved;
}
// The log line for what relocateMisfits moved ("" when nothing).
export function misfitNote(moved) {
  const kept = moved.filter((x) => x.where);
  if (!kept.length) return "";
  const at = (w) => (w === "armory" ? "to the armory" : w.startsWith("kit:") ? `to ${w.slice(4)}'s kit` : "beside it");
  const list = kept.slice(0, 6).map((x) => `${x.part.name} off the ${(x.gun.name || (GEAR[x.gun.key] || {}).name || x.gun.key)} (${at(x.where)})`);
  return `Gun parts that no longer fit their guns were taken off and kept: ${list.join("; ")}${kept.length > 6 ? `; and ${kept.length - 6} more` : ""}.`;
}

// What the attachments on an item add up to (the contract above).
export function gunMods(item) {
  const list = fitted(item);
  const built = item && GEAR[item.key] ? Object.values(builtinOf(item.key)) : [];
  if (!list.length && !built.length) return NO_MODS;
  const out = { ...NO_MODS };
  const plat = platformOf(item.key);
  const sum = (a) => {
    out.aim += (a.aim || 0) + ((a.aimBy && a.aimBy[plat]) || 0); out.close += a.close || 0; out.opt += a.opt || 0; out.fall += a.fall || 0;
    out.dmg *= a.dmg ?? 1; out.cap += a.cap || 0; out.capMult *= a.capMult ?? 1; out.noise *= a.noise ?? 1;
    out.night += a.night || 0; out.nightNear += a.nightNear || 0; out.peq = Math.max(out.peq, a.peq || 0);
    out.brace += a.brace || 0; out.moving += a.moving || 0; out.jam *= a.jam ?? 1; out.reload += a.reload || 0; out.hand += a.hand || 0;
    out.spread += a.spread || 0; // a choke: + tiles of buckshot's full damage (data-ammo.js spreadMult)
    if (a.thermal) out.thermal = true;
    if (a.light) out.light = true;
    if (a.flashless) out.flashless = true;
    if (a.launcher) out.launcher = a.launcher;
  };
  for (const k of built) if (ATTACH[k]) sum(ATTACH[k]); // built in: in its numbers, weighs and costs nothing more
  for (const m of list) {
    if (!modFits(item.key, m.key)) continue; // never on the wrong gun (a save edited by hand)
    const a = ATTACH[m.key];
    sum(a);
    out.aim -= driftOf(m); // a budget sight off zero
    out.weight += fittedKg(m);
    const d = GEAR[m.key];
    out.value += d ? d.value || 0 : 0;
  }
  return out;
}
// What a fitted part weighs on the gun (kg): its own weight, or less for a handguard or stock that replaces the
// factory one (ATTACH wt).
export function fittedKg(m) {
  const a = m && ATTACH[m.key];
  if (a && Number.isFinite(a.wt)) return a.wt;
  const d = m && GEAR[m.key];
  return d && Number.isFinite(d.weight) ? d.weight : 0;
}
// A battle unit's attachments (combat.js sets u.gm and u.gmWeapon): nothing when its weapon has changed since (a raider
// handed a better gun, floorfolk.js; a thrown-in weapon swap, thirdside.js).
export const unitMods = (u) => (u && u.gm && u.gmWeapon === u.weapon ? u.gm : NO_MODS);
// Light rounds at long range (user request 2026-10-08: a scoped assault rifle or carbine rivalled the hunting rifle at
// range). An intermediate round (5.56, 7.62×39) or a rimfire .22 flies true out to its reach (tiles) and then drops and
// drifts, whatever sight is on the gun: an attachment (a scope, a precision stock) never pushes the gun's best range
// past the round's reach (a bare gun's own best range stays where it is), and every tile past the reach costs drop aim
// on top of the gun's fall-off, and a hit past it does dmg × its damage (it has slowed: user pick G3) (combat.js
// shotOdds; the Sniper perk's no-fall-off does not cover it; a loaded type's range, match +1 or subsonic −1, moves the
// reach with it). Pistol rounds (9mm, .45 ACP, .357) the same past 8 tiles (user pick G6: a scrap or thermal scope on an
// SMG or a pistol no longer reaches out). Full-power rounds (.308, .30-30, .50 BMG) have no reach: the hunting rifle, the
// marksman and sniper rifles and the .50 own the long shots; shotgun shells fall off hard by their guns' own numbers.
// With a 65-aim shooter: an AR-15 with an ACOG 79 / 57 / 34% at 10 / 15 / 20 tiles (was 79 / 72 / 59), the hunting
// rifle 70 / 64 / 54%.
export const ROUND_REACH = {
  "556": { reach: 10, drop: 2, dmg: 0.85 }, "762x39": { reach: 9, drop: 2, dmg: 0.85 }, "22lr": { reach: 9, drop: 2, dmg: 0.85 },
  "9mm": { reach: 8, drop: 2, dmg: 0.85 }, "45acp": { reach: 8, drop: 2, dmg: 0.85 }, "357": { reach: 8, drop: 2, dmg: 0.85 },
  // 2026-10-10: the 5.7×28 (small and fast: a tile flatter than a 9mm) and the .44 Magnum (a heavy magnum: a tile more
  // from a carbine's barrel), both still past their reach at a rifle's range
  "57x28": { reach: 9, drop: 2, dmg: 0.85 }, "44mag": { reach: 9, drop: 2, dmg: 0.85 },
  // 2026-10-10: .223 carries like 5.56, .300 BLK (a short, heavy, slow round) drops sooner, .38 like the other pistols
  "223": { reach: 10, drop: 2, dmg: 0.85 }, "300blk": { reach: 8, drop: 2.5, dmg: 0.8 }, "38spl": { reach: 7, drop: 2, dmg: 0.85 },
};
export const roundReach = (w) => (w && w.cal && ROUND_REACH[w.cal]) || null;
// The effective best range and fall-off of a weapon with its attachments (combat.js shotOdds), the range capped at
// the round's reach (ROUND_REACH).
export function modRange(w, m) {
  const rr = roundReach(w);
  let opt = (w.opt || 0) + m.opt;
  if (rr && m.opt > 0) opt = Math.min(opt, Math.max(w.opt || 0, rr.reach));
  return { opt, fall: Math.max(Math.min(FALL_MIN, w.fall || 0), (w.fall || 0) + m.fall) };
}
// A sight that magnifies (a scope: the optic slot, more best range: the 4× scope, the ACOG, the LPVO, the tactical,
// thermal and scrap scopes; not a red dot, a holo sight or tritium). hunting.js: a scoped gun hunts better.
export const isScope = (key) => !!(ATTACH[key] && ATTACH[key].slot === "optic" && (ATTACH[key].opt || 0) > 0);
export const hasScope = (item) => fitted(item).some((m) => isScope(m.key) && modFits(item.key, m.key));
// The aim attachments give by the moment (combat.js shotOdds): a bipod when the gun rests on half cover next to the
// shooter in the line of the shot (rested: combat.js restCell, user request 2026-10-08; standing still alone no longer
// counts), a sling when the shooter moved this turn (u.movedT, combat.js moveAlong); at night a tritium sight, a weapon
// light within 6 tiles (not with the lights switched off: vision.js activeLight) and an IR laser for a shooter with
// night vision on (vision.js nvgOn; u.nvg, stealth.js). d: the distance to the target.
export function situationalAim(b, u, d, gm = unitMods(u), rested = false) {
  if (!gm || gm === NO_MODS) return 0;
  const moved = !!b && u.movedT != null && u.movedT === b.turn;
  let aim = (moved ? gm.moving || 0 : 0) + (rested ? gm.brace || 0 : 0);
  if (b && (b.night || b.dark)) aim += (gm.night || 0) + (d <= 6 && !(u.light && !activeLight(u)) ? gm.nightNear || 0 : 0) + (nvgOn(u) ? gm.peq || 0 : 0);
  return aim;
}

// The fitted suppressor (the item that muffles the shot: a can, an oil filter, a bottle), or null.
export const fittedSuppressor = (item) => fitted(item).find((m) => (ATTACH[m.key].noise ?? 1) < 1 && ATTACH[m.key].slot === "muzzle" && modFits(item.key, m.key)) || null;
// A shot's wear on a makeshift muzzle device (GEAR dur = shots): n shots off it. Returns the item when it is worn out
// (it is gone from the gun), else null.
export function wearMuzzle(item, n = 1) {
  const m = item && item.mods && item.mods.muzzle;
  if (!m || !GEAR[m.key] || !GEAR[m.key].dur || !(n > 0)) return null;
  m.dur = Math.max(0, (m.dur ?? GEAR[m.key].dur) - n);
  if (m.dur > 0) return null;
  removeMod(item, "muzzle");
  return m;
}
// A fight's wear on the gun's other makeshift parts (a scrap scope: GEAR dur = fights). Returns the parts worn out (gone
// from the gun). crafting.js wearAfterFight.
export function wearMakeshiftMods(item, n = 1) {
  const out = [];
  for (const [slot, m] of Object.entries((item && item.mods) || {})) {
    if (slot === "muzzle" || !m || !GEAR[m.key] || !GEAR[m.key].dur || !(GEAR[m.key].makeshift || GEAR[m.key].budget)) continue; // a scrap scope, a budget clone
    m.dur = Math.max(0, (m.dur ?? GEAR[m.key].dur) - n);
    if (GEAR[m.key].budget) m.zero = (m.zero || 0) + n; // fights since it was zeroed (driftOf)
    if (m.dur <= 0) out.push(...stripMod(item, slot).filter((x) => x === m));
  }
  return out;
}

// "9mm pistol (red dot, suppressor)": the weapon's name with what is fitted to it (mounts and rails left out).
export function modLabel(item) {
  if (!item) return "";
  const list = fitted(item).filter((m) => !["mount", "rail", "sling", "pgrip", "receiver"].includes(ATTACH[m.key].slot));
  return list.length ? `${item.name} (${list.map((m) => ATTACH[m.key].short).join(", ")})` : item.name;
}
const sgn = (v, unit = "") => `${v > 0 ? "+" : "−"}${Math.round(Math.abs(v) * 100) / 100}${unit}`;
// One attachment's effects in words ("+4 aim, −8 aim up close, +3 tiles best range").
export function attachText(key) {
  const a = ATTACH[key];
  if (!a) return "";
  const bits = [];
  if (a.aim) bits.push(`${sgn(a.aim)} aim${a.aimBy ? ` (${sgn(a.aim + Math.max(...Object.values(a.aimBy)))} on some)` : ""}`);
  if (a.close) bits.push(`${sgn(a.close)} aim within 2.5 tiles`);
  if (a.opt) bits.push(`${sgn(a.opt)} tile${Math.abs(a.opt) === 1 ? "" : "s"} best range`);
  if (a.fall) bits.push(`${sgn(a.fall)} aim lost a tile beyond it`);
  if (a.dmg && a.dmg !== 1) bits.push(`damage ×${a.dmg}`);
  if (a.magCap) bits.push(`a ${a.magCap}-round magazine`); // data-kit.js: a magazine item
  if (a.cap) bits.push(`${sgn(a.cap)} rounds a magazine`);
  if (a.capMult && a.capMult !== 1) bits.push(`magazine ×${a.capMult}`);
  if (a.noise && a.noise !== 1) bits.push(a.noise < 1 ? `shots ${Math.round(a.noise * 100)}% as loud` : `shots ${Math.round((a.noise - 1) * 100)}% louder`);
  if (a.jam && a.jam !== 1) bits.push(`jams ×${a.jam}`);
  if (a.brace) bits.push(`${sgn(a.brace)} aim when the shot's line crosses half cover or a wall shot over right next to the shooter (rested on it)`);
  if (a.moving) bits.push(`${sgn(a.moving)} aim when the shooter moved this turn`);
  if (a.night) bits.push(`${sgn(a.night)} aim at night`);
  if (a.nightNear) bits.push(`${sgn(a.nightNear)} aim at night within 6 tiles, a light without the off hand`);
  if (a.peq) bits.push(`${sgn(a.peq)} aim at night with night vision`);
  if (a.thermal) bits.push("sees in the dark");
  if (a.flashless) bits.push("no muzzle flash at night");
  if (a.adds) bits.push(`carries ${a.adds.map((s) => (s === "optic" ? "a sight" : s === "grip" ? "a foregrip" : s === "tactical" ? "a light or laser" : `a ${s}`)).join(", ")}`);
  if (a.launcher) bits.push("a 40 mm grenade launcher");
  if (a.reload) bits.push(`${sgn(a.reload)} ${a.slot === "cuff" ? "round" : "shell"}${a.reload === 1 ? "" : "s"} a tube Reload`);
  if (a.hand) bits.push(`${sgn(a.hand)} loose shells at hand at a fight's start`);
  if (GEAR[key] && GEAR[key].budget && DRIFT.SLOTS.includes(a.slot)) bits.push(`drifts off zero: −1 aim every ${DRIFT.PER} fights (up to −${DRIFT.MAX}) until re-zeroed at a workbench`);
  if (GEAR[key] && GEAR[key].budget) bits.push(`a budget part: wears out in about ${GEAR[key].dur} ${a.slot === "muzzle" ? "shots" : "fights"}`);
  if (Number.isFinite(a.wt)) bits.push(`${sgn(a.wt)} kg fitted`);
  return bits.join(", ");
}
// The fit list in words (".22 LR, 9mm guns", "AR-15, AR-10", "any gun with a sling slot").
export function fitsText(key) {
  const a = ATTACH[key];
  if (!a) return "";
  const f = a.fits || {};
  const parts = [];
  if (f.cal) parts.push(`${f.cal.map((c) => (CALIBERS[c] ? CALIBERS[c].name : c)).join(", ")} guns${f.plat ? ` (${f.plat.map((p) => PLATFORMS[p].name.toLowerCase()).join(", ")})` : ""}`);
  else if (f.plat) parts.push(f.plat.map((p) => (PLATFORMS[p] ? PLATFORMS[p].name : p)).join(", "));
  else if (f.any) parts.push(`any gun with a ${SLOT_NAMES[a.slot].toLowerCase()} slot`);
  if (f.notCal) parts.push(`not ${f.notCal.map((c) => (CALIBERS[c] ? CALIBERS[c].name : c)).join(" or ")}`);
  if (f.notPlat) parts.push(`not a ${f.notPlat.map((p) => PLATFORMS[p].name.toLowerCase()).join(" or ")}`);
  return parts.join("; ");
}
// A gun's net attachment effects in words, or "" (the inventory tooltip).
export function modsText(item) {
  const list = fitted(item);
  if (!list.length) return "";
  const m = gunMods(item);
  const bits = [];
  if (m.aim) bits.push(`${sgn(m.aim)} aim`);
  if (m.close) bits.push(`${sgn(m.close)} aim up close`);
  if (m.opt) bits.push(`${sgn(m.opt)} best range`);
  if (m.fall) bits.push(`${sgn(m.fall)} fall-off a tile`);
  if (m.dmg !== 1) bits.push(`damage ×${Math.round(m.dmg * 100) / 100}`);
  if (m.cap) bits.push(`${sgn(m.cap)} rounds`);
  if (m.capMult !== 1) bits.push(`magazine ×${m.capMult}`);
  if (m.noise !== 1) bits.push(`noise ×${Math.round(m.noise * 100) / 100}`);
  if (m.jam !== 1) bits.push(`jams ×${Math.round(m.jam * 100) / 100}`);
  if (m.brace) bits.push(`${sgn(m.brace)} aim rested on half cover`);
  if (m.moving) bits.push(`${sgn(m.moving)} aim on the move`);
  if (m.night || m.nightNear || m.peq) bits.push("better at night");
  const off = list.filter((x) => driftOf(x) > 0).map((x) => `${x.name} off zero, −${driftOf(x)} aim (re-zero it at a workbench)`);
  const worn = list.filter((x) => GEAR[x.key] && GEAR[x.key].dur).map((x) => `${x.name}: ${x.dur ?? GEAR[x.key].dur} of ${GEAR[x.key].dur} ${ATTACH[x.key] && ATTACH[x.key].slot !== "muzzle" ? "fights" : "shots"} left`);
  return `fitted: ${list.map((x) => x.name).join(", ")} (${bits.join(", ") || "no effect"}${worn.length ? `; ${worn.join("; ")}` : ""}${off.length ? `; ${off.join("; ")}` : ""})`;
}

// ---------- enemies' guns ----------
// How often an enemy's gun carries an attachment, by its kit (combat.js KITS): [chance, candidates] per slot; only the
// candidates that fit the gun count (none fit: nothing there). A sight on a gun that needs a mount for one comes with
// its mount. Soldiers' rifles are well kept: half carry a sight (ACOGs, holo sights), a quarter a suppressor, a light,
// a grip, now and then an IR laser, and one AR in eight an M203 under the barrel (launchers.js: 2-4 HE with it). Guards (police): lights, lasers, pistol dots,
// bigger magazines. Militia and fighters (hunters at heart): scopes on mounts, recoil pads, bipods and slings.
// Raiders, survivors and zealots: cheap or makeshift parts (a red dot, an oil filter, a folding stock, a side mount).
export const ENEMY_MODS = {
  soldiers: { under: [0.125, ["m203"]], optic: [0.55, ["reddot", "holo", "holo", "scope4x", "acog", "acog", "aimpoint", "aimpoint", "holo"]], magnifier: [0.15, ["magnifier"]], muzzle: [0.25, ["riflecan", "pistolcan", "can556", "flashhider", "flashhider", "can556pro", "flashpro"]], grip: [0.2, ["foregrip", "foregrip", "anglegrip", "vgrippro"]], tactical: [0.25, ["weaponlight", "weaponlight", "laser", "peq", "surefire"]], mag: [0.08, ["drum"]], sling: [0.3, ["sling", "slingpro"]], pgrip: [0.15, ["pgrip"]], stock: [0.1, ["ctrstock"]], receiver: [0.08, ["chandle"]] },
  guards:   { optic: [0.1, ["reddot", "rmr", "holopistol", "aimpoint"]], tactical: [0.2, ["laser", "weaponlight", "weaponlight", "pistollight", "lightlaser"]], mag: [0.08, ["extmag", "tubeext"]], receiver: [0.1, ["sidesaddle"]] },
  escorts:  { optic: [0.15, ["scope4x", "reddot"]], bipod: [0.04, ["bipod"]], tactical: [0.04, ["laser"]], mag: [0.06, ["extmag", "tubeext"]] }, // merchant caravans' riflemen (escorts.js)
  contractors: { optic: [0.45, ["reddot", "holo", "scope4x"]], muzzle: [0.15, ["riflecan", "comp"]], grip: [0.08, ["foregrip"]], tactical: [0.08, ["laser"]], mag: [0.08, ["drum"]] }, // their hired guns
  militia:  { optic: [0.15, ["scope4x", "scope4x", "reddot", "huntscope", "cheapscope"]], bipod: [0.1, ["bipod", "harris", "cheapbipod"]], stock: [0.12, ["recoilpad"]], sling: [0.25, ["sling"]], muzzle: [0.06, ["icchoke", "turkeychoke"]] , cuff: [0.1, ["buttcuff", "cheapcuff", "riflecuff"]] },
  fighters: { optic: [0.12, ["scope4x", "reddot", "holosun", "cheapdot"]], grip: [0.04, ["foregrip", "cheapgrip"]], bipod: [0.04, ["bipod", "cheapbipod"]], mag: [0.05, ["extmag", "tubeext"]], sling: [0.1, ["sling"]], receiver: [0.04, ["cheapsaddle"]] },
  raiders:  { mount: [0.06, ["sidemount"]], optic: [0.1, ["reddot", "cheapdot", "cheapdot", "cheapholo"]], muzzle: [0.1, ["comp", "suppressor", "choke", "cheapcan", "cheapcomp", "cheapcan308", "cheapcan12"]], mag: [0.08, ["extmag", "tubeext", "mag_ak_75c"]], stock: [0.08, ["foldstock", "cheapstock"]], tactical: [0.06, ["cheaplaser", "cheaplight"]] },
  survivors: { optic: [0.05, ["reddot", "cheapdot"]], muzzle: [0.04, ["suppressor", "comp", "choke"]], mag: [0.04, ["extmag"]], sling: [0.05, ["sling", "cheapsling"]], tactical: [0.04, ["cheaplight", "cheaplaser"]] },
  zealots:  { muzzle: [0.05, ["choke"]] , cuff: [0.06, ["cheapcuff", "buttcuff"]] },
};
// A number in [0, 1) from any parts (no random numbers used up: the battle's dice stay as they were).
function h01(...parts) {
  let h = 2166136261 >>> 0;
  for (const part of parts) {
    const str = String(part);
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
    h = Math.imul(h ^ 0x9e3779b9, 16777619) >>> 0;
  }
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
// A loose attachment item (inventory.js newItem's shape; kept here so this module needs nothing but data).
export function makeMod(key, quality = 1) {
  const d = GEAR[key];
  const it = { key, name: d.name, quality };
  if (d.dur) it.dur = d.dur;
  return it;
}
// Fits a part (a new item) to a gun, with a mount first when its slot needs one. Returns the gun's mods or null.
function fitWithMount(gun, key, q) {
  const a = ATTACH[key];
  const mod = makeMod(key, q);
  if (!fitsSlot(gun, mod)) { fitMod(gun, mod); return mod; }
  const mk = !gun.mods || !gun.mods.mount ? mountFor(gun.key, a.slot) : null;
  if (!mk) return null;
  const mount = makeMod(mk, q);
  if (fitsSlot(gun, mount)) return null;
  fitMod(gun, mount);
  if (fitsSlot(gun, mod)) { removeMod(gun, "mount"); return null; }
  fitMod(gun, mod);
  return mod;
}
// The attachments an enemy's gun carries ({ slot: item } or null). seed / salt: anything that varies per unit and battle.
// Dice of their own per slot (h01 of the slot's name), so the battle's random numbers are untouched.
export function enemyMods(kit, weapon, seed, salt) {
  const tab = ENEMY_MODS[kit];
  if (!tab || !takesMods(weapon) || !GEAR[weapon]) return null;
  const gun = { key: weapon, name: GEAR[weapon].name };
  for (const slot of SLOTS) {
    const row = tab[slot];
    if (!row) continue;
    const cands = row[1].filter((k) => ATTACH[k] && GEAR[k] && ATTACH[k].slot === slot && modFits(weapon, k));
    if (!cands.length || h01(seed, salt, kit, weapon, slot) >= row[0]) continue;
    const key = cands[Math.floor(h01(seed, salt, slot, "pick") * cands.length) % cands.length];
    const q = [0.6, 0.75, 0.9, 1][Math.floor(h01(seed, salt, slot, "q") * 4) % 4];
    const it = fitWithMount(gun, key, q);
    if (it && it.dur) it.dur = Math.max(2, Math.round(it.dur * (0.4 + 0.6 * h01(seed, salt, slot, "dur"))));
  }
  return gun.mods && Object.keys(gun.mods).length ? gun.mods : null;
}

// ---------- starting guns ----------
// The cheap parts a colonist's gun may come with at the start of a run (never a scope, a drum or a proper suppressor).
export const STARTER_MODS = ["suppressor", "reddot", "laser", "comp", "extmag", "choke", "tubeext", "foregrip",
  "recoilpad", "revgrip", "sling", "flashhider", "anglegrip", "scopemount", "tritium",
  // the parts catalogue (2026-10-10): the cheap clones and the common civilian parts a household gun carries
  "cheapdot", "cheaplaser", "cheaplight", "cheapgrip", "cheapbipod", "cheapmount", "cheaprevgrip", "cheapsaddle", "cheappgrip", "icchoke", "handstop", "cheapsling", "cheapcuff"];
export const STARTER = { none: 0.3, two: 0.2 }; // 30% of guns come bare, 20% with two parts, the rest with one
// Fits 0–2 cheap parts that suit the gun, drawn by 1 / value (the cheapest most often). rng: the run's seeded
// generator; its position is read, never moved, so the rest of the world comes out exactly as before. Returns the
// parts fitted.
/** @param {any} rng @param {any} item @param {string | number} [salt] @returns {any[]} */
export function randomStarterMods(rng, item, salt = "") {
  if (!item || !takesMods(item.key)) return [];
  const seed = rng && Number.isFinite(rng.state) ? rng.state : 0;
  const r = h01(seed, salt, item.key, item.name, "starter");
  const n = r < STARTER.none ? 0 : r < STARTER.none + STARTER.two ? 2 : 1;
  const got = [];
  for (let i = 0; i < n; i++) {
    const cands = STARTER_MODS.filter((k) => ATTACH[k] && GEAR[k] && !(item.mods && item.mods[ATTACH[k].slot]) && !fitsSlot(item, makeMod(k)));
    if (!cands.length) break;
    const w = cands.map((k) => 1 / Math.max(1, GEAR[k].value));
    let x = h01(seed, salt, item.key, i, "pick") * w.reduce((a, b) => a + b, 0);
    let key = cands[cands.length - 1];
    for (let j = 0; j < cands.length; j++) { x -= w[j]; if (x < 0) { key = cands[j]; break; } }
    const mod = makeMod(key, [0.6, 0.75, 0.9][Math.floor(h01(seed, salt, i, "q") * 3) % 3]);
    if (mod.dur) mod.dur = Math.max(3, Math.round(mod.dur * (0.5 + 0.5 * h01(seed, salt, i, "dur"))));
    fitMod(item, mod);
    got.push(mod);
  }
  return got;
}

// ---------- fitting what lies around (the autopilot: autopilot.js equipFromArmory) ----------
// How much an attachment is worth on a gun for a fight: aim counts, up close half, range a little, a suppressor a
// good deal (quiet shots, less Heat), a brake's noise against it; magazines a little (the reload branch counts them);
// a sling half its bonus (only some shots), a bipod a quarter (only rested on half cover in the line of fire:
// MOD_SCORE.rest, user pick G5), night aids a little, jams against.
export const MOD_SCORE = { rest: 0.25 };
const OPENER_SLOTS = ["mount", "rail"];
const isOpener = (a) => !!(a && a.adds && OPENER_SLOTS.includes(a.slot));
export function modScore(key) {
  const a = ATTACH[key];
  if (!a) return 0;
  if (a.adds && OPENER_SLOTS.includes(a.slot)) return 0.5; // a mount or rail: only for what it carries
  return (a.aim || 0) + 0.5 * (a.close || 0) + 0.8 * (a.opt || 0) - 2 * (a.fall || 0) - 20 * (1 - (a.dmg ?? 1))
    + 6 * (1 - (a.noise ?? 1)) + 0.25 * (a.cap || 0) + 3 * ((a.capMult ?? 1) - 1) + (GEAR[key] && GEAR[key].dur ? -1 : 0)
    + MOD_SCORE.rest * (a.brace || 0) + 0.5 * (a.moving || 0) + 0.25 * ((a.night || 0) + (a.nightNear || 0) + (a.peq || 0)) - 4 * ((a.jam ?? 1) - 1)
    + (a.thermal ? 2 : 0) + (a.launcher ? -1 : 0) + 1.5 * (a.reload || 0) + 0.3 * (a.hand || 0);
}
// Fits loose attachments from pool (an armory list) to the guns given (best first), one per free slot and only where
// it helps (modScore > 0); a mount or a rail only when what it carries is in the pool too. Takes what it fits out of
// pool. Returns [{ gun, mod }].
export function fitFromPool(pool, guns) {
  const out = [];
  const take = (gun, it) => { pool.splice(pool.indexOf(it), 1); fitMod(gun, it); out.push({ gun, mod: it }); };
  for (const gun of guns) {
    if (!gun || !takesMods(gun.key)) continue;
    for (const slot of SLOTS) {
      if (gun.mods && gun.mods[slot]) continue;
      let best = null;
      for (const it of pool) {
        const a = it && ATTACH[it.key];
        if (!a || a.slot !== slot || isOpener(a) || modScore(it.key) <= 0 || fitsSlot(gun, it)) continue;
        if (!best || modScore(it.key) > modScore(best.key)) best = it;
      }
      if (best) { take(gun, best); continue; }
      // A sight or a grip for which the gun needs a mount or a rail first, both in the pool.
      for (const it of pool) {
        const a = it && ATTACH[it.key];
        if (!a || a.slot !== slot || isOpener(a) || modScore(it.key) <= 0 || !modFits(gun.key, it.key)) continue;
        const opener = pool.find((o) => o && ATTACH[o.key] && ATTACH[o.key].adds && ATTACH[o.key].adds.includes(slot) && !(gun.mods && gun.mods[ATTACH[o.key].slot]) && !fitsSlot(gun, o));
        if (!opener) continue;
        take(gun, opener);
        if (!fitsSlot(gun, it)) take(gun, it);
        break;
      }
    }
  }
  return out;
}

// The Help topic (ui/help.js).
export const GUNMODS_HELP = `Sights, mounts, suppressors, muzzle brakes, bigger magazines, stocks, grips, rails, lights and lasers, bipods and
  slings fit on guns: one in each slot. Which slots a gun has depends on its kind, as on the real thing: an AR-15 takes
  nearly everything; a bolt-action rifle a scope, a muzzle device, a stock, a bipod and a sling; a revolver a scope on
  rings, a suppressor or a compensator, grips and a laser grip, never a foregrip or a stock; a pistol a slide sight, a
  threaded-barrel can and a light or laser on its rail; a double-barrel, an over-under or a single-shot a choke, a stock
  and a sight on rings, never a magazine or a foregrip; a pump a light, a tube extension and a sight on rings (a foregrip
  only on the railed police pump); a bullpup no stock to swap. Some parts open more slots: a scope mount carries a
  sight on a gun with no rail, a quad rail a foregrip, a light or laser and a bipod. A foregrip and an under-barrel
  launcher share the space under the handguard. Muzzle devices fit by calibre, the rest by the kind of gun. They are
  found where guns are kept (gun stores, police stations, the National Guard, hunting lodges and cabins, army wrecks,
  sports shelves in malls), on the guns of soldiers and now and then of raiders and other fighters (they come with the
  gun when you loot it), traders and merchants sell them, and a few makeshift ones are crafted. To fit or take them
  off, open the gun builder: select a gun in the inventory and press Modify (or the ⚙ on the gun in someone's hands).
  It shows the gun with a box for every slot it has (a rifle's pistol grip and receiver too: a charging handle, a
  shotgun's side-saddle that puts a shell more in the tube each Reload); click a box to fit a part from the person's pockets and pack or
  the storage here, or to take one off (into storage, else a pocket or the pack). Not during a fight. A fitted
  attachment adds its weight and worth to the gun, and is sold or looted with it.
  <br>Sights: a red dot (+4 aim), a holographic sight (+5, +3 up close), a 4× scope or an ACOG (more range, less up
  close), a tactical scope (far range, −14 up close), tritium sights and weapon lights for the night. Muzzle: a
  suppressor makes a shot a third to two thirds as loud (fewer of the dead and the guards hear it, less Heat, a hunt
  draws less; some foul the action: more jams), the makeshift oil filter and bottle wear out fast, a muzzle brake (+3
  aim) and a pistol compensator (+2) make the shot louder, a shotgun choke reaches further but spreads less up close.
  A revolver takes a pistol-calibre can (some gas still escapes at the cylinder). Magazines: an extended 9mm magazine (24 rounds), a drum for the AR-15 family (twice
  the rounds, heavy, −2 aim), a shotgun tube extension (+2 shells). A bipod: +8 aim when the gun rests on half cover
  (sandbags, crates, a car, a fence, a window sill) or a wall you shoot over (a palisade from its walkway, a barricade)
  right next to the shooter that the shot's line crosses; a sling +1 when the shooter moved this turn.
  <br>Brands and clones: many parts come as a brand-name part modelled on a US or European maker (an Aimpoint-style
  red dot, a SureFire-style light, a Magpul-style stock, a Harris-style bipod: dearer, better, found at gun stores,
  police stations and the military) and as a cheap Chinese clone or an airsoft-grade copy (a budget red dot, an
  airsoft laser, a fuel-filter can: a fraction of the price, weaker, and they wear out and fall apart after some
  fights, found in homes, malls, pawn shelves and with cheap traders). A budget sight drifts off zero: −1 aim every 5
  fights (up to −4) until it is re-zeroed: every morning at a base with a workbench. A 3× magnifier goes behind a red
  dot or holo sight on a rifle or shotgun (fit the sight first). A buttstock shell holder keeps 5 more shells at hand
  (3 for the elastic one) on a shotgun with a stock; a cartridge cuff puts a round more in a lever-action each Reload.
  The hunting rifle comes with its 3–9× scope as a part: take it off for a better one. A 5.56, 7.62×39 or .22 round drops past 10 tiles (9 for the 7.62×39 and the .22), a pistol round past 8, scope
  or not: −2 aim a tile and ×0.85 damage, and no sight pushes its best range past that. None is worth a step of cover.`;
