// @ts-check
// More attachments, gun platforms and their slots (docs/weapons-overhaul-plan.md sections 5, 9, 21, 22). Plain data
// that imports nothing; data.js merges MOD_GEAR into GEAR, gunmods.js merges MOD_ATTACH into ATTACH and reads
// PLATFORMS / WEAPON_PLATFORM. Owner: the economy agent (C) for the data; the UI agent (D) reads it for the gun builder.
//
// Slots (where a part goes on a gun): optic (a sight), mount (rings or a side rail that carries an optic), muzzle
// (a suppressor, a brake, a choke), mag (a bigger magazine), under (under the barrel: a grenade launcher), stock,
// grip (a foregrip on a long gun; on a revolver its hand grips), rail (a rail handguard that carries more parts),
// tactical (a light, a laser), bipod, sling.
// Nesting: a part can carry `adds` (slots it opens): a mount adds an optic, a quad rail a grip, a tactical and a bipod.
// under and grip share the space under the handguard: fitting one blocks the other.
// Fit: muzzle devices fit by calibre (fits.cal) on a platform with a muzzle slot; everything else by platform
// (fits.plat), or on any gun with that slot open (fits.any). nocan: no suppressor fits it.
//
// Which slots a gun has (user, 2026-10-10: "each gun has attachment points for different components that make sense
// for the gun: a revolver cannot have a forward grip but can have a scope or suppressor"), from three tables:
//   PLATFORMS[p].slots   the slots a bare gun of the platform has open (parts: { slot: [part keys] } narrows a slot
//                        to those parts: a revolver's grip slot takes its hand grips, not a foregrip);
//   CATEGORIES[cat]      the kind of gun (PLATFORMS[p].cat): `never` lists the slots no gun of that kind has, bare or
//                        opened by a mount or a rail (a revolver no stock, a break action no magazine or foregrip, a
//                        bullpup no stock to swap): the realism guard every platform and every new gun goes through;
//   WEAPON_SLOTS[key]    one gun's own changes: off (slots it lacks), on (slots it has that its platform's lack, even
//                        one its kind's `never` lists: the railed police pump's foregrip), parts (as the platform's).
// gunmods.js baseSlots / slotsOf / modFits / fitsSlot read them (the gun builder, the new-run gear picker, starter
// parts, factory parts, enemies' and the AI's guns, the autopilot's armory fitting all go through fitsSlot), and a saved
// gun with a part that no longer fits has it taken off into the armory or a pack on load (gunmods.js relocateMisfits).
// A gun with no WEAPON_PLATFORM entry (another branch's new gun) gets one from PLATFORM_GUESS by its category,
// calibre and name, so it slots in with sensible slots until it is given its own.
//
// The slot table, by kind (bare; + what a mount or rail opens):
//   pistol    sight (slide cut), muzzle (threaded barrel), magazine, light / laser (railed; a 1911: a laser grip only)
//   revolver  mount (+ sight: rings), muzzle (a can or a compensator), grips, light / laser (a laser grip only)
//   smg       sight or mount, muzzle, magazine, stock, light / laser, sling; a foregrip where railed (the .45 SMG)
//   pdw       sight, muzzle, magazine, light / laser, sling (a P90-style gun: its stock is the gun, no foregrip)
//   rifle     everything (AR-15, AR-10, AK, battle rifles): sight, muzzle, magazine, stock, rail (+ foregrip, light,
//             bipod), under the barrel (AR-15), sling
//   bullpup   sight, muzzle, magazine, rail (+ foregrip, light, bipod), light / laser, sling; no stock to swap
//   bolt      sight (receiver bases), muzzle, magazine, stock, bipod, sling
//   lever     mount (+ sight: scout or receiver rings), muzzle, stock, bipod, sling; no magazine or foregrip
//   break     mount (+ sight: rib or barrel rings), muzzle (a choke, a can on a rifle), stock, sling; no magazine,
//             foregrip, light or bipod (the double, the over-unders, the single-shots; the sawn-off a sling only)
//   pump      mount (+ sight), muzzle (a choke), tube extension, stock, light, sling; a foregrip only on the railed
//             police pump
//   semi12    sight, muzzle, tube extension, stock, light / laser, sling
//   mg        sight, muzzle, belt box, light / laser; its bipod built in
//   amr       sight, magazine, sling; its bipod and muzzle brake built in
//   zip       a sling
/** @type {string[]} */
export const SLOTS = ["mount", "rail", "optic", "muzzle", "mag", "under", "stock", "grip", "tactical", "bipod", "sling"];
/** @type {Record<string, string>} */
export const SLOT_NAMES = { optic: "Sight", mount: "Mount", muzzle: "Muzzle", mag: "Magazine", under: "Under the barrel", stock: "Stock", grip: "Grip", rail: "Rail", tactical: "Light / laser", bipod: "Bipod", sling: "Sling" };
// Slots that share one space (fitting one blocks the others).
/** @type {string[][]} */
export const SHARED = [["under", "grip"]];

// Kinds of gun: the slots none of them has (see above). A per-gun `on` (WEAPON_SLOTS) overrides it.
/** @type {Record<string, { name: string, never: string[] }>} */
export const CATEGORIES = {
  pistol:   { name: "Pistol",              never: ["mount", "rail", "under", "stock", "grip", "bipod", "sling"] },
  revolver: { name: "Revolver",            never: ["rail", "under", "stock", "mag", "bipod", "sling"] },
  smg:      { name: "Submachine gun",      never: ["under", "bipod"] },
  pdw:      { name: "Personal defence weapon", never: ["under", "stock", "grip", "bipod"] },
  arpistol: { name: "AR pistol",           never: ["under", "stock", "bipod"] },
  rifle:    { name: "Rifle",               never: [] },
  bullpup:  { name: "Bullpup rifle",       never: ["stock", "under"] },
  bolt:     { name: "Bolt-action rifle",   never: ["rail", "under", "grip"] },
  lever:    { name: "Lever-action rifle",  never: ["rail", "under", "grip", "mag"] },
  break:    { name: "Break action",        never: ["rail", "under", "grip", "mag", "tactical", "bipod"] },
  pump:     { name: "Pump shotgun",        never: ["rail", "under", "grip", "bipod"] },
  semi12:   { name: "Semi-auto shotgun",   never: ["rail", "under", "bipod"] },
  mg:       { name: "Machine gun",         never: ["under", "stock"] },
  amr:      { name: "Anti-materiel rifle", never: ["under", "grip", "muzzle", "tactical"] },
  zip:      { name: "Zip gun",             never: ["mount", "rail", "optic", "muzzle", "mag", "under", "stock", "grip", "tactical", "bipod"] },
};

// Gun platforms. cat: its kind (CATEGORIES). slots: open on a bare gun. parts: { slot: [part keys] } the only parts
// that slot takes. builtin: { slot: part key } a part every gun of the platform has (counted in its numbers, never
// removed, worth nothing apart). The bolt-action ships with a scope base (its optic slot is open), the rimfire rifle
// takes a bipod (the bipod's own fit list).
/** @type {Record<string, { name: string, cat: string, slots: string[], parts?: Record<string, string[]>, builtin?: Record<string, string>, nocan?: boolean }>} */
export const PLATFORMS = {
  glock:     { name: "Polymer 9mm pistol",    cat: "pistol",   slots: ["optic", "muzzle", "mag", "tactical"] },
  p1911:     { name: "1911 pistol",           cat: "pistol",   slots: ["optic", "muzzle", "mag", "tactical"], parts: { tactical: ["laser"] } }, // no rail: a laser grip
  rimpistol: { name: ".22 target pistol",     cat: "pistol",   slots: ["optic", "muzzle", "mag"] },
  revolver:  { name: "Revolver",              cat: "revolver", slots: ["mount", "grip", "tactical", "muzzle"], parts: { grip: ["revgrip"], tactical: ["laser"] } }, // a laser grip; a can (user, 2026-10-10)
  mp5:       { name: "Submachine gun",        cat: "smg",      slots: ["mount", "muzzle", "mag", "stock", "tactical", "sling"] },
  ar15:      { name: "AR-15",                 cat: "rifle",    slots: ["optic", "muzzle", "mag", "stock", "rail", "under", "tactical", "bipod", "sling"] },
  ar10:      { name: "AR-10",                 cat: "rifle",    slots: ["optic", "muzzle", "mag", "stock", "rail", "bipod", "sling"] },
  m249:      { name: "Light machine gun",     cat: "mg",       slots: ["optic", "muzzle", "mag", "tactical"], builtin: { bipod: "bipod" } },
  ak:        { name: "Kalashnikov",           cat: "rifle",    slots: ["mount", "muzzle", "mag", "stock", "rail", "sling"] },
  bolt:      { name: "Bolt-action rifle",     cat: "bolt",     slots: ["optic", "muzzle", "mag", "stock", "bipod", "sling"] },
  lever:     { name: "Lever-action rifle",    cat: "lever",    slots: ["mount", "muzzle", "stock", "bipod", "sling"] },
  rimrifle:  { name: ".22 rifle",             cat: "bolt",     slots: ["optic", "muzzle", "mag", "stock", "bipod", "sling"] },
  pump:      { name: "Pump shotgun",          cat: "pump",     slots: ["mount", "muzzle", "mag", "stock", "tactical", "sling"] },
  semi12:    { name: "Semi-auto shotgun",     cat: "semi12",   slots: ["optic", "muzzle", "mag", "stock", "tactical", "sling"] },
  dbl:       { name: "Double-barrel shotgun", cat: "break",    slots: ["mount", "muzzle", "stock", "sling"] },
  amr:       { name: "Anti-materiel rifle",   cat: "amr",      slots: ["optic", "mag", "sling"], builtin: { bipod: "bipod" } },
  zip:       { name: "Zip gun",               cat: "zip",      slots: ["sling"] },
  // The arsenal of 2026-10-10 (data-guns.js ARSENAL_GEAR): a break-open single barrel (shotgun or rifle: a scope mount
  // for a sight), the .308 battle rifles, a bullpup (no stock to swap), a .45 SMG (a rail under it) and pistol, the
  // hand cannon (a rail under it, no threaded barrel), the belt-fed .308 machine gun (its bipod built in).
  single:    { name: "Single-shot break action", cat: "break", slots: ["mount", "muzzle", "stock", "sling"] },
  battle:    { name: "Battle rifle",          cat: "rifle",    slots: ["optic", "muzzle", "mag", "stock", "rail", "bipod", "sling"] },
  bullpup:   { name: "Bullpup rifle",         cat: "bullpup",  slots: ["optic", "muzzle", "mag", "rail", "tactical", "sling"] },
  ump:       { name: ".45 submachine gun",    cat: "smg",      slots: ["optic", "muzzle", "mag", "stock", "grip", "tactical", "sling"] },
  poly45:    { name: "Polymer .45 pistol",    cat: "pistol",   slots: ["optic", "muzzle", "mag", "tactical"] },
  deagle:    { name: "Magnum pistol",         cat: "pistol",   slots: ["optic", "mag", "tactical"] },
  m240:      { name: "General-purpose machine gun", cat: "mg", slots: ["optic", "muzzle", "mag", "tactical"], builtin: { bipod: "bipod" } },
  // Ready for the guns other branches add (2026-10-10: AR pistols, a P90 / Vector, a Mini-14, a 5.7 or other polymer
  // pistol): map them here or let PLATFORM_GUESS find them. Their magazines are data-kit.js MAGAZINES rows by platform.
  polypistol: { name: "Polymer pistol",       cat: "pistol",   slots: ["optic", "muzzle", "mag", "tactical"] },
  pdw:       { name: "Personal defence weapon", cat: "pdw",    slots: ["optic", "muzzle", "mag", "tactical", "sling"] },
  arpistol:  { name: "AR pistol",             cat: "arpistol", slots: ["optic", "muzzle", "mag", "rail", "tactical", "sling"] },
  ranch:     { name: "Ranch rifle",           cat: "rifle",    slots: ["optic", "muzzle", "mag", "stock", "bipod", "sling"] },
};
// A new platform takes the parts its look-alike takes (gunmods.js widens each part's fits.plat at load), less SKIP:
// magazines never (they are by platform: data-kit.js MAGAZINES), a bullpup no stock and no M203. (The slots it has
// decide the rest: a part for a slot the platform lacks never fits it.)
export const PLATFORM_LIKE = { single: "dbl", battle: "ar10", bullpup: "ar15", ump: "mp5", poly45: "glock", deagle: "p1911", m240: "m249",
  polypistol: "glock", pdw: "ump", arpistol: "ar15", ranch: "bolt" };
export const PLATFORM_LIKE_SKIP = { bullpup: ["collapsible", "precision", "foldstock", "m203", "drum"], poly45: ["extmag"], polypistol: ["extmag"], arpistol: ["m203"] };
// Weapon key -> platform. Keys the roster agent (B) adds (compact9, pistol45, smg, dmr, lmg, ak, sniper...) are listed
// ahead of time; a key with no WEAPONS entry is simply never met.
/** @type {Record<string, string>} weapon key -> platform key */
export const WEAPON_PLATFORM = {
  pistol: "glock", compact9: "glock", pistol45: "p1911", pistol22: "rimpistol", revolver: "revolver", smg: "mp5",
  carbine: "ar15", ar: "ar15", dmr: "ar10", lmg: "m249", ak: "ak", huntrifle: "bolt", sniper: "bolt",
  leverrifle: "lever", rifle22: "rimrifle", shotgun: "pump", semishotgun: "semi12", dbshotgun: "dbl", sawnoff: "dbl",
  amr: "amr", pipegun: "zip",
  // the arsenal of 2026-10-10 (data-guns.js ARSENAL_GEAR)
  ou12: "dbl", ou20: "dbl", single12: "single", singlerifle: "single", pump20: "pump", tacpump: "pump", lever357: "lever",
  m4: "ar15", hk416: "ar15", scarl: "ar15", aug: "bullpup", scarh: "battle", fal: "battle", m1a: "battle", m240: "m240",
  ump45: "ump", usp45: "poly45", snub357: "revolver", magnum: "deagle",
  // ahead of other branches (2026-10-10; a key no gun has is never met): the P90 and Vector, FAMAS, G3, Mini-14, AR pistol
  p90: "pdw", vector: "ump", famas: "bullpup", g3: "battle", mini14: "ranch", arpistol: "arpistol",
};
// One gun's own slots (see above): off: slots it lacks that its platform has; on: slots it has that its platform lacks
// (even against its kind's `never`); parts: { slot: [part keys] } as a platform's. The compact 9mm has no threaded
// barrel; the sawn-off is a sawn stock and two short barrels (a sling at most); the hunting rifle's scope is part of
// its own numbers (combat.js WEAPONS huntrifle: opt 12); the snub-nose takes no scope rings (a laser grip, a can); the
// police pump has a rail on its fore-end for a foregrip.
/** @type {Record<string, { off?: string[], on?: string[], parts?: Record<string, string[]> }>} */
export const WEAPON_SLOTS = {
  compact9:  { off: ["muzzle"] },
  sawnoff:   { off: ["muzzle", "stock", "mount"] },
  huntrifle: { off: ["optic", "mount"] },
  snub357:   { off: ["mount"] },
  tacpump:   { on: ["grip"] },
};
// (The old name: the slots each gun lacks.)
/** @type {Record<string, string[]>} */
export const WEAPON_SLOTS_OFF = Object.fromEntries(Object.entries(WEAPON_SLOTS).filter(([, o]) => o.off).map(([k, o]) => [k, /** @type {string[]} */ (o.off)]));
// A platform for a gun none is given for (gunmods.js platformOf, at load for every gun in GEAR): the first row whose
// cat (GEAR cat), cal (its calibre) and words (a pattern on the gun's name, then on its description) all match. Rows
// with words are tried on the name first, then on the description, then the rows without words.
/** @type {{ cat: string, cal?: string[], words?: string, plat: string }[]} */
export const PLATFORM_GUESS = [
  { cat: "pistol", words: "revolver|snub", plat: "revolver" },
  { cat: "pistol", words: "\\bAR\\b|AR-15|AR pistol", plat: "arpistol" },
  { cat: "pistol", cal: ["22lr"], plat: "rimpistol" },
  { cat: "pistol", cal: ["9mm"], plat: "glock" },
  { cat: "pistol", cal: ["45acp"], plat: "poly45" },
  { cat: "pistol", plat: "polypistol" },
  { cat: "shotgun", words: "over-under|double|side-by-side|sawn", plat: "dbl" },
  { cat: "shotgun", words: "single", plat: "single" },
  { cat: "shotgun", words: "semi|auto", plat: "semi12" },
  { cat: "shotgun", plat: "pump" },
  { cat: "rifle", words: "single-shot|single shot|break", plat: "single" },
  { cat: "rifle", words: "lever", plat: "lever" },
  { cat: "rifle", cal: ["22lr"], plat: "rimrifle" },
  { cat: "rifle", cal: ["50bmg"], plat: "amr" },
  { cat: "rifle", words: "bolt|varmint", plat: "bolt" },
  { cat: "rifle", words: "bullpup", plat: "bullpup" },
  { cat: "rifle", words: "ranch|mini-14", plat: "ranch" },
  { cat: "rifle", words: "\\bAR\\b|AR-15|carbine", plat: "ar15" },
  { cat: "rifle", cal: ["308"], plat: "battle" },
  { cat: "rifle", plat: "bolt" },
  { cat: "automatic", words: "machine gun|belt", cal: ["308"], plat: "m240" },
  { cat: "automatic", words: "machine gun|belt", plat: "m249" },
  { cat: "automatic", words: "bullpup", plat: "bullpup" },
  { cat: "automatic", words: "P90|PDW|personal defen", plat: "pdw" },
  { cat: "automatic", cal: ["762x39"], plat: "ak" },
  { cat: "automatic", cal: ["308"], plat: "battle" },
  { cat: "automatic", cal: ["9mm"], plat: "mp5" },
  { cat: "automatic", cal: ["45acp"], plat: "ump" },
  { cat: "automatic", words: "submachine|SMG", plat: "ump" },
  { cat: "automatic", plat: "ar15" },
];
// The calibre of the guns from before the overhaul (combat.js WEAPONS[k].cal, Phase 0), for the muzzle fit rule
// (this module imports nothing); the roster's new guns carry theirs in data-guns.js GUN_WEAPONS.
/** @type {Record<string, string>} */
export const BASE_CAL = { pistol: "9mm", shotgun: "12ga", huntrifle: "308", ar: "556", pipegun: "12ga", revolver: "357", leverrifle: "3030", carbine: "556" };

const RIFLE_CALS = ["556", "762x39", "308", "3030"];
// The new attachments' numbers (gunmods.js contract: aim, close, opt, fall, dmg, cap, capMult, noise ×; plus night:
// aim at night, nightNear: aim at night within 6 tiles (a weapon light), peq: aim at night with night vision worn,
// thermal: at night the shooter's shots ignore the dark, brace: aim when the gun rests on half cover next to the shooter in the shot's
// line (a bipod: combat.js restCell), moving: aim when it did (a sling), jam: × jam odds (combat.js, section 14), flashless: the muzzle flash no
// longer shows the shooter at night, light: a weapon light (works as a flashlight at night), wt: kg fitted when it
// differs from the loose part (a lighter handguard or stock replaces the factory one), aimBy: extra aim by platform,
// launcher: an under-barrel launcher (section 13)). short: how it reads in the gun's name; look: the gun builder's art
// (ui/gunart.js PART_ART, section 9).
/** @type {Record<string, any>} */
export const MOD_ATTACH = {
  tritium:      { slot: "optic",    short: "tritium sights", look: "irons",   fits: { plat: ["glock", "p1911", "rimpistol"] }, aim: 2, night: 6 },
  rmr:          { slot: "optic",    short: "RMR",            look: "reddot",  fits: { plat: ["glock", "p1911", "rimpistol"] }, aim: 4, close: 2 },
  acog:         { slot: "optic",    short: "ACOG",           look: "scope4",  fits: { plat: ["ar15", "ar10", "m249", "ak"] }, aim: 6, opt: 3, fall: -0.5, close: -4 },
  lpvo:         { slot: "optic",    short: "LPVO",           look: "scope4",  fits: { plat: ["ar15", "ar10"] }, aim: 6, opt: 2, fall: -0.4, close: -1 },
  tacscope:     { slot: "optic",    short: "tactical scope", look: "scope25", fits: { plat: ["ar10", "bolt", "amr"] }, aim: 7, opt: 6, fall: -0.8, close: -14 },
  thermalscope: { slot: "optic",    short: "thermal scope",  look: "thermal", fits: { any: true }, aim: 4, opt: 2, thermal: true },
  scrapscope:   { slot: "optic",    short: "scrap scope",    look: "scope4",  fits: { any: true }, aim: 2, opt: 2, close: -6 },
  scopemount:   { slot: "mount",    short: "scope mount",    look: "mount",   fits: { plat: ["bolt", "lever", "pump", "rimrifle", "revolver", "mp5", "single", "dbl"] }, adds: ["optic"] },
  sidemount:    { slot: "mount",    short: "side mount",     look: "mount",   fits: { plat: ["ak"] }, adds: ["optic"] },
  quadrail:     { slot: "rail",     short: "quad rail",      look: "rail",    fits: { plat: ["ar15", "ar10", "ak"] }, adds: ["grip", "tactical", "bipod"] },
  mlok:         { slot: "rail",     short: "M-LOK handguard", look: "rail",   fits: { plat: ["ar15", "ar10"] }, adds: ["grip", "tactical"], aim: 1, wt: -0.2 },
  can22:        { slot: "muzzle",   short: "suppressor",     look: "can_s",   fits: { cal: ["22lr"] }, can: true, noise: 0.35 },
  can9:         { slot: "muzzle",   short: "suppressor",     look: "can_s",   fits: { cal: ["9mm", "45acp", "357"] }, can: true, noise: 0.5, jam: 1.2 },
  can556:       { slot: "muzzle",   short: "suppressor",     look: "can_l",   fits: { cal: ["556"] }, can: true, noise: 0.55, aim: 1, jam: 1.3 },
  can308:       { slot: "muzzle",   short: "suppressor",     look: "can_l",   fits: { cal: ["308", "762x39"] }, can: true, noise: 0.6, jam: 1.3 },
  can12:        { slot: "muzzle",   short: "shotgun suppressor", look: "can_l", fits: { cal: ["12ga", "20ga"], plat: ["pump", "semi12"] }, can: true, noise: 0.7, close: -2 },
  bottlecan:    { slot: "muzzle",   short: "bottle suppressor", look: "bottle", fits: { any: true, notCal: ["12ga", "20ga", "50bmg"] }, can: true, noise: 0.6, aim: -3 },
  solventcan:   { slot: "muzzle",   short: "solvent-trap suppressor", look: "oilfilter", fits: { cal: ["22lr", "9mm", "556"] }, can: true, noise: 0.6, jam: 1.4 },
  flashhider:   { slot: "muzzle",   short: "flash hider",    look: "brake",   fits: { cal: RIFLE_CALS }, aim: 1, flashless: true },
  recoilpad:    { slot: "stock",    short: "recoil pad",     look: "stock_pad", fits: { plat: ["pump", "dbl", "semi12", "bolt", "lever", "amr"] }, aim: 2, aimBy: { pump: 1, dbl: 1, semi12: 1, amr: 1 } },
  collapsible:  { slot: "stock",    short: "collapsible stock", look: "stock_collapsible", fits: { plat: ["ar15", "mp5", "ak", "semi12"] }, aim: 2, close: 3 },
  precision:    { slot: "stock",    short: "precision stock", look: "stock_precision", fits: { plat: ["bolt", "ar10", "ar15", "rimrifle"] }, aim: 3, opt: 1, close: -3 },
  foldstock:    { slot: "stock",    short: "folding stock",  look: "stock_fold", fits: { plat: ["ak", "mp5", "semi12", "rimrifle", "ranch"] }, close: 4, aim: -2, wt: -0.4 },
  anglegrip:    { slot: "grip",     short: "angled grip",    look: "agrip",   fits: { any: true, notPlat: ["revolver"] }, aim: 1, close: 4 },
  revgrip:      { slot: "grip",     short: "rubber grips",   look: "grip",    fits: { plat: ["revolver"] }, aim: 3 },
  weaponlight:  { slot: "tactical", short: "weapon light",   look: "light",   fits: { any: true }, light: true, nightNear: 8 },
  peq:          { slot: "tactical", short: "IR laser",       look: "peq",     fits: { any: true }, peq: 8 },
  sling:        { slot: "sling",    short: "sling",          look: "sling",   fits: { any: true }, moving: 1 },
  m203:         { slot: "under",    short: "M203",           look: "m203",    fits: { plat: ["ar15"] }, launcher: "40mm" },
};

// The parts as items (data.js merges this into GEAR). small: carried in a pocket. makeshift ones wear (dur): a muzzle
// device a shot at a time, an optic a fight at a time.
const MOD = (name, value, weight, desc, more = {}) => ({ name, slot: "pack", skill: null, power: 0, req: 0, value, noise: 0, small: true, weight, cat: "gunmod", desc, ...more });
/** @type {Record<string, any>} */
export const MOD_GEAR = {
  tritium:      MOD("Tritium night sights", 20, 0.02, "Glowing front and rear sights for a pistol: +2 aim, +6 more at night. Fits the 9mm and .45 pistols and the .22 target pistol."),
  rmr:          MOD("Pistol red dot (RMR)", 35, 0.05, "A tiny reflex sight milled onto a pistol's slide: +4 aim, +2 more up close. Fits the 9mm and .45 pistols and the .22 target pistol."),
  acog:         MOD("4× combat optic (ACOG)", 90, 0.45, "A rugged fixed 4× military sight: +6 aim, +3 tiles of best range, less aim lost beyond it, −4 up close. Fits the AR-15 family, the AR-10, the light machine gun and a Kalashnikov with a side mount."),
  lpvo:         MOD("Low-power variable optic", 120, 0.6, "A 1–6× scope: quick up close, magnified at range. +6 aim, +2 tiles of best range, less aim lost beyond it, −1 up close. Fits the AR-15 family and the AR-10."),
  tacscope:     MOD("Tactical rifle scope", 160, 0.9, "A high-power sniper scope: +7 aim, +6 tiles of best range, far less aim lost beyond it, but −14 up close. Fits the AR-10, bolt-action rifles (the sniper rifle comes with one) and the .50."),
  thermalscope: MOD("Thermal weapon sight", 260, 0.7, "A heat-seeing scope: +4 aim, +2 tiles of best range, and at night the shooter's shots ignore the dark. Fits any gun with a sight slot. Very rare."),
  scrapscope:   MOD("Scrap scope", 6, 0.4, "A cheap magnifier in a pipe, wired to the gun: +2 aim, +2 tiles of best range, −6 up close. Fits any gun with a sight slot. Makeshift: lasts 30 fights.", { makeshift: true, dur: 30 }),
  scopemount:   MOD("Scope mount", 8, 0.1, "Rings and a base for a gun with no sight rail: it carries a sight. Fits lever-action rifles, the pump shotguns, the double-barrel and over-under shotguns and the single-shots (on the rib or barrel), a revolver (not the snub-nose) and the submachine gun."),
  sidemount:    MOD("Side-rail mount", 15, 0.15, "A Kalashnikov's side-rail mount: it carries a sight."),
  quadrail:     MOD("Quad rail handguard", 25, 0.3, "Rails on all four sides of the handguard: room for a foregrip, a light or laser, and a bipod. Fits the AR-15 family, the AR-10 and a Kalashnikov."),
  mlok:         MOD("M-LOK handguard", 35, 0.2, "A slim modern handguard, lighter than the factory one (−0.2 kg fitted): room for a foregrip and a light or laser, +1 aim. Fits the AR-15 family and the AR-10."),
  can22:        MOD(".22 suppressor", 40, 0.2, "A rimfire can: a .22's shots barely a third as loud. Fits .22 guns."),
  can9:         MOD("Pistol-calibre suppressor", 60, 0.3, "A 9mm / .45 / .357 can: shots half as loud, but it fouls the action (jams ×1.2). Fits 9mm, .45 and .357 guns with a threaded barrel or muzzle, a revolver too (some of the gas still escapes at the cylinder)."),
  can556:       MOD("5.56 suppressor", 90, 0.5, "A military rifle can: shots 55% as loud, +1 aim (less kick), but more fouling (jams ×1.3). Fits 5.56 rifles."),
  can308:       MOD(".308 suppressor", 110, 0.6, "A big rifle can: shots 60% as loud, but more fouling (jams ×1.3). Fits .308 and 7.62×39 rifles."),
  can12:        MOD("Shotgun suppressor", 80, 0.7, "A fat can for a 12 gauge: shots 70% as loud, −2 up close. Fits the pump and semi-auto shotguns. Very rare."),
  bottlecan:    MOD("Bottle suppressor", 1, 0.1, "A plastic bottle taped over the muzzle: shots 60% as loud, −3 aim, and it is shot through in 3 shots. Fits any gun but a shotgun or the .50. Made in the field from a bottle and a scrap.", { makeshift: true, dur: 3 }),
  solventcan:   MOD("Solvent-trap suppressor", 30, 0.5, "A cleaning kit's solvent trap drilled out into a can: shots 60% as loud, but it fouls the action (jams ×1.4). Lasts 40 shots. Fits .22, 9mm and 5.56 guns. Made at a machine shop.", { makeshift: true, dur: 40 }),
  flashhider:   MOD("Flash hider", 6, 0.1, "A birdcage on a rifle's muzzle: +1 aim, and at night the flash no longer gives the shooter away. Fits rifles."),
  recoilpad:    MOD("Recoil pad", 8, 0.2, "A thick rubber butt pad: +2 aim (+3 on a shotgun or the .50). Fits shotguns, bolt-action and lever-action rifles and the .50."),
  collapsible:  MOD("Collapsible stock", 30, 0.3, "An adjustable stock: +2 aim, +3 more up close. Fits the AR-15 family, the submachine gun, a Kalashnikov and the semi-auto shotgun."),
  precision:    MOD("Precision stock", 60, 0.8, "An adjustable marksman's stock with a cheek rest: +3 aim, +1 tile of best range, −3 up close. Fits bolt-action rifles, the .22 rifle, the AR-10 and the AR-15 family."),
  foldstock:    MOD("Folding stock", 25, 0.3, "A side-folding stock, lighter than the factory one (−0.4 kg fitted): +4 up close, −2 aim. Fits a Kalashnikov, the submachine gun, the semi-auto shotgun and the .22 rifle."),
  anglegrip:    MOD("Angled foregrip", 15, 0.1, "A short angled grip under the handguard: +1 aim, +4 more up close. Fits under an AR-15's handguard, on a rail, the .45 SMG's rail or the police pump's fore-end rail. Not a pistol, a revolver or a hunting gun."),
  revgrip:      MOD("Rubber revolver grips", 10, 0.05, "Finger-groove rubber grips that soak up the kick: +3 aim. Fits a revolver."),
  weaponlight:  MOD("Weapon light", 18, 0.15, "A light on the gun's rail (not on a revolver or a 1911: no rail): at night +8 aim within 6 tiles, and it lights the way like a flashlight without taking the off hand (but is seen from further off). Fits any gun with a light / laser slot."),
  peq:          MOD("Infrared laser (PEQ)", 120, 0.2, "A military infrared aiming laser, invisible without night vision: +8 aim at night for someone wearing night vision goggles. Fits any gun with a light / laser rail (not a revolver or a 1911)."),
  sling:        MOD("Rifle sling", 5, 0.15, "A two-point sling: the gun stays steady on the move, +1 aim when the shooter moved this turn. Fits any gun with a sling slot."),
  m203:         MOD("M203 grenade launcher", 160, 1.4, "A 40 mm launcher under an AR-15's barrel (it blocks a foregrip). Fires 40 mm grenades from the rifle it is fitted to (Launch: up to 16 tiles, lobbed over walls; its own round, reloaded on its own), and the rifle still shoots. Best with Shooting 6."),
  // Repairs (repair.js, section 21).
  repairkit:    { name: "Field repair kit", slot: "pack", skill: null, power: 0, req: 0, value: 25, noise: 0, dur: 5, weight: 1, cat: "tools", desc: "A roll of tools, pins, springs, patches and glue: 5 field repairs of a gun, an attachment, armour or a makeshift tool anywhere (half what a workbench restores, and twice the lost maximum). Needs the same skill as a workbench repair." },
  kevlarkit:    { name: "Kevlar repair kit", slot: "pack", skill: null, power: 0, req: 0, value: 20, noise: 0, small: true, weight: 0.5, cat: "armor", desc: "Ballistic fabric patches and stitching: one workbench repair of a soft vest (with 2 scrap). Police and military kit." },
};
