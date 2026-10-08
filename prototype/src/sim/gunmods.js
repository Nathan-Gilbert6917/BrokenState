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
//   shooter with night vision (an IR laser), brace: + aim when the shooter did not move this turn (a bipod),
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
//   Bipod                 bipod   +8 when the shooter did not move this turn  0.4   18     bolt, lever, AR-15, AR-10, .22 rifle, a quad rail
//   9mm suppressor        muzzle           −1         ×0.95           ×0.35   0.25  45     9mm
//   Rifle suppressor      muzzle           −1         ×0.95           ×0.4    0.55  60     5.56, 7.62×39, .308, .30-30
//   Oil-filter suppressor muzzle                                      ×0.5    0.4   12     9mm, 5.56, .308, .30-30; wears out in 12 shots
//   Muzzle brake          muzzle  +3                                  ×1.3    0.15  18     rifle calibres (louder)
//   Pistol compensator    muzzle  +2                                  ×1.15   0.1   14     9mm, .45, .357 (louder)
//   Shotgun choke         muzzle      −4   +2   −2                            0.05  12     12 gauge (tighter spread: reaches further, less up close)
//   Extended pistol mag   mag                              +9                 0.15  14     9mm pistols (15 → 24 rounds)
//   Drum magazine         mag     −2                             ×2           1.1   38     the AR-15 family (30 → 60; heavy and clumsy)
//   Shotgun tube extension mag                             +2                 0.25  14     pump shotgun (6 → 8)
// The rest: data-gunmods.js MOD_ATTACH (the plan's section 5 table). No suppressor fits a revolver (the gas escapes at
// the cylinder); a shotgun takes only the rare shotgun can (and a bottle never); bows and melee weapons take nothing,
// the pipe shotgun a sling. Fall never drops below FALL_MIN a tile. A shot's noise × noise: a suppressed rifle shot
// (noise 3) is 1.2, heard 15 × 0.4 = 6 tiles off in a raid (9 + 2 × noise, × the share) instead of 15.
import { GEAR } from "./data.js";
import { GUN_WEAPONS } from "./data-guns.js";
import { CALIBERS } from "./data-ammo.js";
import { SLOTS, SLOT_NAMES, SHARED, PLATFORMS, WEAPON_PLATFORM, WEAPON_SLOTS_OFF, BASE_CAL, MOD_ATTACH } from "./data-gunmods.js";
import { KIT_ATTACH } from "./data-kit.js"; // magazines as items (section 15): the extended mag and the drum are magazine items now
// The gun builder's sim calls on inventory locations (they live with the inventory's location handling).
export { fitAt, stripAt } from "./inventory.js";
export { SLOTS, SLOT_NAMES, PLATFORMS, WEAPON_PLATFORM };

export const NO_MODS = Object.freeze({
  aim: 0, close: 0, opt: 0, fall: 0, dmg: 1, cap: 0, capMult: 1, noise: 1, weight: 0, value: 0,
  night: 0, nightNear: 0, peq: 0, brace: 0, moving: 0, jam: 1, thermal: false, light: false, flashless: false, launcher: null,
});
export const MOUNTS = SLOTS; // every slot (the old name: there were four mounts)
export const MOUNT_NAMES = SLOT_NAMES;
export const FALL_MIN = 0.5;
const RIFLE_CALS = ["556", "762x39", "308", "3030"];

// Battle and noise numbers by GEAR key (the item itself, its name, weight, value and description: data.js GEAR).
// slot: where it goes (mount: the same, the old name); fits: { cal, plat, any, notCal, notPlat }; short: how it reads
// in a weapon's name ("9mm pistol (red dot, suppressor)"); look: the gun builder's art.
const LEGACY = {
  reddot:    { slot: "optic",    short: "red dot",      look: "reddot",   fits: { plat: ["glock", "p1911", "revolver", "pump", "semi12", "lever", "ar15", "ak", "mp5"] }, aim: 4 },
  holo:      { slot: "optic",    short: "holo sight",   look: "holo",     fits: { plat: ["pump", "semi12", "ar15", "ak", "mp5", "m249"] }, aim: 5, close: 3 },
  scope4x:   { slot: "optic",    short: "4× scope",     look: "scope4",   fits: { plat: ["lever", "ar15", "ak", "rimrifle"] }, opt: 3, fall: -0.5, close: -8 },
  laser:     { slot: "tactical", short: "laser",        look: "laser",    fits: { any: true }, aim: 1, close: 6 },
  foregrip:  { slot: "grip",     short: "foregrip",     look: "vgrip",    fits: { any: true, notPlat: ["revolver"] }, aim: 2, close: 2 },
  bipod:     { slot: "bipod",    short: "bipod",        look: "bipod",    fits: { any: true }, brace: 8 },
  pistolcan: { slot: "muzzle",   short: "suppressor",   look: "can_s",    fits: { cal: ["9mm"] }, can: true, opt: -1, dmg: 0.95, noise: 0.35, jam: 1.2 },
  riflecan:  { slot: "muzzle",   short: "suppressor",   look: "can_l",    fits: { cal: RIFLE_CALS }, can: true, opt: -1, dmg: 0.95, noise: 0.4, jam: 1.3 },
  suppressor:{ slot: "muzzle",   short: "oil-filter suppressor", look: "oilfilter", fits: { cal: ["9mm", "556", "308", "3030"] }, can: true, noise: 0.5, jam: 1.5 }, // makeshift: GEAR dur = shots
  brake:     { slot: "muzzle",   short: "muzzle brake", look: "brake",    fits: { cal: RIFLE_CALS }, aim: 3, noise: 1.3 },
  comp:      { slot: "muzzle",   short: "compensator",  look: "comp",     fits: { cal: ["9mm", "45acp", "357"] }, aim: 2, noise: 1.15 },
  choke:     { slot: "muzzle",   short: "choke",        look: "choke",    fits: { cal: ["12ga"] }, opt: 2, fall: -2, close: -4 },
  extmag:    { slot: "mag",      short: "extended mag", look: "stick20",  fits: { plat: ["glock"] }, cap: 9 },
  drum:      { slot: "mag",      short: "drum mag",     look: "drum",     fits: { plat: ["ar15"] }, capMult: 2, aim: -2, jam: 1.5 },
  tubeext:   { slot: "mag",      short: "tube extension", look: "tube_ext", fits: { plat: ["pump"] }, cap: 2 },
};
export const ATTACH = {};
for (const [k, a] of Object.entries({ ...LEGACY, ...MOD_ATTACH, ...KIT_ATTACH })) ATTACH[k] = { ...a, mount: a.slot };
// A magazine item (data-kit.js MAGAZINES): its rounds (null: not a magazine).
export const magCapOf = (key) => (ATTACH[key] && ATTACH[key].magCap) || null;
export const isGunmod = (key) => !!ATTACH[key];
export const modDef = (key) => ATTACH[key] || null;

// ---------- platforms, calibres, slots ----------
export const platformOf = (gunKey) => WEAPON_PLATFORM[gunKey] || null;
export const calOf = (gunKey) => (GUN_WEAPONS[gunKey] && GUN_WEAPONS[gunKey].cal) || BASE_CAL[gunKey] || null;
const builtinOf = (gunKey) => (PLATFORMS[platformOf(gunKey)] || {}).builtin || {};
const sharedWith = (slot) => (SHARED.find((g) => g.includes(slot)) || [slot]);
// The slots a slot gives room for: the space under the barrel takes a foregrip instead (not the other way round).
const expand = (slot) => (slot === "under" ? ["under", "grip"] : [slot]);
// The slots a bare gun has open (its platform's, less what the weapon lacks and what is built in).
export function baseSlots(gunKey) {
  const P = PLATFORMS[platformOf(gunKey)];
  if (!P) return [];
  const off = WEAPON_SLOTS_OFF[gunKey] || [];
  const b = builtinOf(gunKey);
  const out = new Set();
  for (const s of P.slots) if (!off.includes(s) && !b[s]) for (const x of expand(s)) out.add(x);
  return SLOTS.filter((s) => out.has(s));
}
// Does the part fit this kind of gun at all (calibre, platform; the slot it needs exists on the gun bare or once a
// mount or rail that fits is on)? Not whether that slot is free now: fitsSlot.
export function modFits(gunKey, modKey) {
  const a = ATTACH[modKey], plat = platformOf(gunKey);
  if (!a || !plat) return false;
  const f = a.fits || {};
  const cal = calOf(gunKey);
  if (f.notPlat && f.notPlat.includes(plat)) return false;
  if (f.notCal && cal && f.notCal.includes(cal)) return false;
  if (a.can && PLATFORMS[plat].nocan) return false;
  if (f.cal && !f.cal.includes(cal)) return false;
  if (f.plat && !f.plat.includes(plat)) return false;
  if (!f.cal && !f.plat && !f.any) return false;
  return couldHaveSlot(gunKey, a.slot);
}
// Can the gun have this slot: open bare, or opened by a mount or rail that fits it (one level of nesting).
function couldHaveSlot(gunKey, slot) {
  if (builtinOf(gunKey)[slot] || (WEAPON_SLOTS_OFF[gunKey] || []).includes(slot)) return false;
  const base = baseSlots(gunKey);
  if (base.includes(slot)) return true;
  return Object.entries(ATTACH).some(([k, a]) => a.adds && a.adds.some((s) => expand(s).includes(slot)) && base.includes(a.slot) && partFitsStatic(gunKey, k));
}
// modFits without the slot test (for the parts that open slots: their own slot is a base one).
function partFitsStatic(gunKey, modKey) {
  const a = ATTACH[modKey], plat = platformOf(gunKey);
  const f = a.fits || {};
  if (f.notPlat && f.notPlat.includes(plat)) return false;
  if (f.plat && !f.plat.includes(plat)) return false;
  if (f.cal && !f.cal.includes(calOf(gunKey))) return false;
  return !!(f.plat || f.cal || f.any);
}
// Does this gun (a WEAPONS / GEAR key) take any attachment at all?
export const takesMods = (gunKey) => baseSlots(gunKey).length > 0;
// Attachments that fit a gun, by GEAR key.
export const modsFor = (gunKey) => Object.keys(ATTACH).filter((k) => modFits(gunKey, k));
const nameOf = (key) => (GEAR[key] ? GEAR[key].name : key);
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
    if (modFits(item.key, m.key)) for (const s of ATTACH[m.key].adds || []) for (const x of expand(s)) out.add(x);
  }
  for (const s of Object.keys(builtinOf(item.key))) out.delete(s);
  return SLOTS.filter((s) => out.has(s));
}
// Slots opened by the part in `slot` (its children: they come off first when it does).
export const childSlots = (item, slot) => {
  const m = item && item.mods && item.mods[slot];
  const adds = m && ATTACH[m.key] && ATTACH[m.key].adds;
  return adds ? SLOTS.filter((s) => adds.some((a) => expand(a).includes(s)) && !baseSlots(item.key).includes(s)) : [];
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
    if (a.can && plat && plat.nocan) return `No suppressor fits a ${gunName} (the gas escapes at the cylinder).`;
    return `The ${mod.name} does not fit a ${gunName}.`;
  }
  // The slot must be open now (a sight on a gun that needs a mount for one, a grip with no rail or room under it).
  const bare = { ...gun, mods: { ...(gun.mods || {}) } };
  delete bare.mods[want];
  for (const c of childSlots(gun, want)) delete bare.mods[c];
  const open = new Set(baseSlots(gun.key));
  for (const m of Object.values(bare.mods)) if (m && ATTACH[m.key] && modFits(gun.key, m.key)) for (const x of ATTACH[m.key].adds || []) for (const y of expand(x)) open.add(y);
  if (!open.has(want)) {
    const opener = Object.keys(ATTACH).find((k) => ATTACH[k].adds && ATTACH[k].adds.some((x) => expand(x).includes(want)) && modFits(gun.key, k));
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
  return Object.keys(ATTACH).find((k) => ATTACH[k].adds && ATTACH[k].adds.includes(slot) && ATTACH[k].slot === "mount" && modFits(gunKey, k)) || null;
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
    out.brace += a.brace || 0; out.moving += a.moving || 0; out.jam *= a.jam ?? 1;
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
// The effective best range and fall-off of a weapon with its attachments (combat.js shotOdds).
export const modRange = (w, m) => ({ opt: (w.opt || 0) + m.opt, fall: Math.max(Math.min(FALL_MIN, w.fall || 0), (w.fall || 0) + m.fall) });
// The aim attachments give by the moment (combat.js shotOdds): a bipod when the shooter did not move this turn
// (u.movedT, combat.js moveAlong), a sling when it did; at night a tritium sight, a weapon light within 6 tiles and
// an IR laser for a shooter wearing night vision (u.nvg, stealth.js). d: the distance to the target.
export function situationalAim(b, u, d, gm = unitMods(u)) {
  if (!gm || gm === NO_MODS) return 0;
  const moved = !!b && u.movedT != null && u.movedT === b.turn;
  let aim = moved ? gm.moving || 0 : gm.brace || 0;
  if (b && (b.night || b.dark)) aim += (gm.night || 0) + (d <= 6 ? gm.nightNear || 0 : 0) + (u.nvg ? gm.peq || 0 : 0);
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
    if (slot === "muzzle" || !m || !GEAR[m.key] || !GEAR[m.key].dur || !GEAR[m.key].makeshift) continue;
    m.dur = Math.max(0, (m.dur ?? GEAR[m.key].dur) - n);
    if (m.dur <= 0) out.push(...stripMod(item, slot).filter((x) => x === m));
  }
  return out;
}

// "9mm pistol (red dot, suppressor)": the weapon's name with what is fitted to it (mounts and rails left out).
export function modLabel(item) {
  if (!item) return "";
  const list = fitted(item).filter((m) => !["mount", "rail", "sling"].includes(ATTACH[m.key].slot));
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
  if (a.brace) bits.push(`${sgn(a.brace)} aim when the shooter did not move this turn`);
  if (a.moving) bits.push(`${sgn(a.moving)} aim when the shooter moved this turn`);
  if (a.night) bits.push(`${sgn(a.night)} aim at night`);
  if (a.nightNear) bits.push(`${sgn(a.nightNear)} aim at night within 6 tiles, a light without the off hand`);
  if (a.peq) bits.push(`${sgn(a.peq)} aim at night with night vision`);
  if (a.thermal) bits.push("sees in the dark");
  if (a.flashless) bits.push("no muzzle flash at night");
  if (a.adds) bits.push(`carries ${a.adds.map((s) => (s === "optic" ? "a sight" : s === "grip" ? "a foregrip" : s === "tactical" ? "a light or laser" : `a ${s}`)).join(", ")}`);
  if (a.launcher) bits.push("a 40 mm grenade launcher");
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
  if (m.brace) bits.push(`${sgn(m.brace)} aim braced`);
  if (m.moving) bits.push(`${sgn(m.moving)} aim on the move`);
  if (m.night || m.nightNear || m.peq) bits.push("better at night");
  const worn = list.filter((x) => GEAR[x.key] && GEAR[x.key].dur).map((x) => `${x.name}: ${x.dur ?? GEAR[x.key].dur} of ${GEAR[x.key].dur} ${x.key === "scrapscope" ? "fights" : "shots"} left`);
  return `fitted: ${list.map((x) => x.name).join(", ")} (${bits.join(", ") || "no effect"}${worn.length ? `; ${worn.join("; ")}` : ""})`;
}

// ---------- enemies' guns ----------
// How often an enemy's gun carries an attachment, by its kit (combat.js KITS): [chance, candidates] per slot; only the
// candidates that fit the gun count (none fit: nothing there). A sight on a gun that needs a mount for one comes with
// its mount. Soldiers' rifles are well kept: half carry a sight (ACOGs, holo sights), a quarter a suppressor, a light,
// a grip, now and then an IR laser, and one AR in eight an M203 under the barrel (launchers.js: 2-4 HE with it). Guards (police): lights, lasers, pistol dots,
// bigger magazines. Militia and fighters (hunters at heart): scopes on mounts, recoil pads, bipods and slings.
// Raiders, survivors and zealots: cheap or makeshift parts (a red dot, an oil filter, a folding stock, a side mount).
export const ENEMY_MODS = {
  soldiers: { under: [0.125, ["m203"]], optic: [0.55, ["reddot", "holo", "holo", "scope4x", "acog", "acog"]], muzzle: [0.25, ["riflecan", "pistolcan", "can556", "flashhider", "flashhider"]], grip: [0.2, ["foregrip", "foregrip", "anglegrip"]], tactical: [0.25, ["weaponlight", "weaponlight", "laser", "peq"]], mag: [0.08, ["drum"]], sling: [0.3, ["sling"]] },
  guards:   { optic: [0.1, ["reddot", "rmr"]], tactical: [0.2, ["laser", "weaponlight", "weaponlight"]], mag: [0.08, ["extmag", "tubeext"]] },
  escorts:  { optic: [0.15, ["scope4x", "reddot"]], bipod: [0.04, ["bipod"]], tactical: [0.04, ["laser"]], mag: [0.06, ["extmag", "tubeext"]] }, // merchant caravans' riflemen (escorts.js)
  contractors: { optic: [0.45, ["reddot", "holo", "scope4x"]], muzzle: [0.15, ["riflecan", "comp"]], grip: [0.08, ["foregrip"]], tactical: [0.08, ["laser"]], mag: [0.08, ["drum"]] }, // their hired guns
  militia:  { optic: [0.15, ["scope4x", "scope4x", "reddot"]], bipod: [0.1, ["bipod"]], stock: [0.12, ["recoilpad"]], sling: [0.25, ["sling"]] },
  fighters: { optic: [0.12, ["scope4x", "reddot"]], grip: [0.04, ["foregrip"]], bipod: [0.04, ["bipod"]], mag: [0.05, ["extmag", "tubeext"]], sling: [0.1, ["sling"]] },
  raiders:  { mount: [0.06, ["sidemount"]], optic: [0.1, ["reddot"]], muzzle: [0.1, ["comp", "suppressor", "choke"]], mag: [0.08, ["extmag", "tubeext"]], stock: [0.08, ["foldstock"]] },
  survivors: { optic: [0.05, ["reddot"]], muzzle: [0.04, ["suppressor", "comp", "choke"]], mag: [0.04, ["extmag"]], sling: [0.05, ["sling"]] },
  zealots:  { muzzle: [0.05, ["choke"]] },
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
  "recoilpad", "revgrip", "sling", "flashhider", "anglegrip", "scopemount", "tritium"];
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
// a bipod and a sling half their bonus (only some shots), night aids a little, jams against.
export function modScore(key) {
  const a = ATTACH[key];
  if (!a) return 0;
  if (a.adds) return 0.5; // a mount or rail: only for what it carries
  return (a.aim || 0) + 0.5 * (a.close || 0) + 0.8 * (a.opt || 0) - 2 * (a.fall || 0) - 20 * (1 - (a.dmg ?? 1))
    + 6 * (1 - (a.noise ?? 1)) + 0.25 * (a.cap || 0) + 3 * ((a.capMult ?? 1) - 1) + (GEAR[key] && GEAR[key].dur ? -1 : 0)
    + 0.5 * (a.brace || 0) + 0.5 * (a.moving || 0) + 0.25 * ((a.night || 0) + (a.nightNear || 0) + (a.peq || 0)) - 4 * ((a.jam ?? 1) - 1)
    + (a.thermal ? 2 : 0) + (a.launcher ? -1 : 0);
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
        if (!a || a.slot !== slot || a.adds || modScore(it.key) <= 0 || fitsSlot(gun, it)) continue;
        if (!best || modScore(it.key) > modScore(best.key)) best = it;
      }
      if (best) { take(gun, best); continue; }
      // A sight or a grip for which the gun needs a mount or a rail first, both in the pool.
      for (const it of pool) {
        const a = it && ATTACH[it.key];
        if (!a || a.slot !== slot || a.adds || modScore(it.key) <= 0 || !modFits(gun.key, it.key)) continue;
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
  slings fit on guns: one in each slot. Which slots a gun has depends on its kind (a bolt-action rifle takes a scope, a
  bipod and a sling; an AR-15 nearly everything; a revolver little). Some parts open more slots: a scope mount carries a
  sight on a gun with no rail, a quad rail a foregrip, a light or laser and a bipod. A foregrip and an under-barrel
  launcher share the space under the handguard. Muzzle devices fit by calibre, the rest by the kind of gun. They are
  found where guns are kept (gun stores, police stations, the National Guard, hunting lodges and cabins, army wrecks,
  sports shelves in malls), on the guns of soldiers and now and then of raiders and other fighters (they come with the
  gun when you loot it), traders and merchants sell them, and a few makeshift ones are crafted. To fit or take them
  off, open the gun builder: select a gun in the inventory and press Modify (or the ⚙ on the gun in someone's hands).
  It shows the gun with a box for every slot it has; click a box to fit a part from the person's pockets and pack or
  the storage here, or to take one off (into storage, else a pocket or the pack). Not during a fight. A fitted
  attachment adds its weight and worth to the gun, and is sold or looted with it.
  <br>Sights: a red dot (+4 aim), a holographic sight (+5, +3 up close), a 4× scope or an ACOG (more range, less up
  close), a tactical scope (far range, −14 up close), tritium sights and weapon lights for the night. Muzzle: a
  suppressor makes a shot a third to two thirds as loud (fewer of the dead and the guards hear it, less Heat, a hunt
  draws less; some foul the action: more jams), the makeshift oil filter and bottle wear out fast, a muzzle brake (+3
  aim) and a pistol compensator (+2) make the shot louder, a shotgun choke reaches further but spreads less up close.
  No suppressor fits a revolver. Magazines: an extended 9mm magazine (24 rounds), a drum for the AR-15 family (twice
  the rounds, heavy, −2 aim), a shotgun tube extension (+2 shells). A bipod: +8 aim when the shooter did not move this
  turn; a sling +1 when it did. None is worth a step of cover.`;
