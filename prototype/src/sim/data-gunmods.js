// @ts-check
// More attachments, gun platforms and their slots (docs/weapons-overhaul-plan.md sections 5, 9, 21, 22). Plain data
// that imports nothing; data.js merges MOD_GEAR into GEAR, gunmods.js merges MOD_ATTACH into ATTACH and reads
// PLATFORMS / WEAPON_PLATFORM. Owner: the economy agent (C) for the data; the UI agent (D) reads it for the gun builder.
//
// Slots (where a part goes on a gun): optic (a sight), mount (rings or a side rail that carries an optic), muzzle
// (a suppressor, a brake, a choke), mag (a bigger magazine), under (under the barrel: a grenade launcher), stock,
// grip (a foregrip), pgrip (the pistol grip: a rifle's, a revolver's grips), rail (a rail handguard that carries
// more parts), tactical (a light, a laser), bipod, sling, receiver (a charging handle, a side-saddle shell carrier).
// Nesting: a part can carry `adds` (slots it opens): a mount adds an optic, a quad rail a grip, a tactical and a bipod.
// under and grip share the space under the handguard: fitting one blocks the other.
// Fit: muzzle devices fit by calibre (fits.cal) on a platform with a muzzle slot; everything else by platform
// (fits.plat), or on any gun with that slot open (fits.any). nocan: no suppressor fits it.
//
// Which slots a gun has (user, 2026-10-10: "each gun has attachment points for different components that make sense
// for the gun: a revolver cannot have a forward grip but can have a scope or suppressor"), from three tables:
//   PLATFORMS[p].slots   the slots a bare gun of the platform has open (parts: { slot: [part keys] } narrows a slot
//                        to those parts: a revolver's light / laser slot takes a laser grip, not a rail light);
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
//   revolver  mount (+ sight: rings), muzzle (a can or a compensator), pistol grip (its grips), light / laser (a laser
//             grip only); never a foregrip
//   smg       sight or mount, muzzle, magazine, stock, light / laser, sling; a foregrip where railed (the .45 SMG)
//   pdw       sight, muzzle, magazine, light / laser, sling (a P90-style gun: its stock is the gun, no foregrip)
//   rifle     everything (AR-15, AR-10, AK, battle rifles): sight, muzzle, magazine, stock, rail (+ foregrip, light,
//             bipod), under the barrel (AR-15), pistol grip (AR, AK), receiver (an AR's charging handle), sling
//   arpistol  as the AR-15 less the under-barrel and bipod; its stock slot takes a pistol brace only
//   bullpup   sight, muzzle, magazine, rail (+ foregrip, light, bipod), light / laser, sling; no stock to swap
//   bolt      sight (receiver bases), muzzle, magazine, stock, bipod, sling
//   lever     mount (+ sight: scout or receiver rings), muzzle, stock, bipod, sling; no magazine or foregrip
//   break     mount (+ sight: rib or barrel rings), muzzle (a choke, a can on a rifle), stock, sling; no magazine,
//             foregrip, light or bipod (the double, the over-unders, the single-shots; the sawn-off a sling only)
//   pump      mount (+ sight), muzzle (a choke), tube extension, stock, light, receiver (a side-saddle), sling; a
//             foregrip only on the railed police pump
//   semi12    sight, muzzle, tube extension, stock, light / laser, receiver (a side-saddle), sling
//   mg        sight, muzzle, belt box, light / laser; its bipod built in
//   amr       sight, magazine, sling; its bipod and muzzle brake built in
//   zip       a sling
/** @type {string[]} */
export const SLOTS = ["mount", "rail", "optic", "muzzle", "mag", "under", "stock", "grip", "pgrip", "tactical", "bipod", "sling", "receiver"];
/** @type {Record<string, string>} */
export const SLOT_NAMES = { optic: "Sight", mount: "Mount", muzzle: "Muzzle", mag: "Magazine", under: "Under the barrel", stock: "Stock", grip: "Foregrip", pgrip: "Pistol grip", rail: "Rail", tactical: "Light / laser", bipod: "Bipod", sling: "Sling", receiver: "Receiver" };
// Slots that share one space (fitting one blocks the others).
/** @type {string[][]} */
export const SHARED = [["under", "grip"]];

// Kinds of gun: the slots none of them has (see above). A per-gun `on` (WEAPON_SLOTS) overrides it.
/** @type {Record<string, { name: string, never: string[] }>} */
export const CATEGORIES = {
  pistol:   { name: "Pistol",              never: ["mount", "rail", "under", "stock", "grip", "pgrip", "bipod", "sling", "receiver"] },
  revolver: { name: "Revolver",            never: ["rail", "under", "stock", "grip", "mag", "bipod", "sling", "receiver"] },
  smg:      { name: "Submachine gun",      never: ["under", "bipod", "receiver"] },
  pdw:      { name: "Personal defence weapon", never: ["under", "stock", "grip", "pgrip", "bipod", "receiver"] },
  arpistol: { name: "AR pistol",           never: ["under", "bipod"] },
  rifle:    { name: "Rifle",               never: [] },
  bullpup:  { name: "Bullpup rifle",       never: ["stock", "under", "pgrip", "receiver"] },
  bolt:     { name: "Bolt-action rifle",   never: ["rail", "under", "grip", "pgrip", "receiver"] },
  lever:    { name: "Lever-action rifle",  never: ["rail", "under", "grip", "pgrip", "mag", "receiver"] },
  break:    { name: "Break action",        never: ["rail", "under", "grip", "pgrip", "mag", "tactical", "bipod", "receiver"] },
  pump:     { name: "Pump shotgun",        never: ["rail", "under", "grip", "pgrip", "bipod"] },
  semi12:   { name: "Semi-auto shotgun",   never: ["rail", "under", "pgrip", "bipod"] },
  mg:       { name: "Machine gun",         never: ["under", "stock", "pgrip", "receiver"] },
  amr:      { name: "Anti-materiel rifle", never: ["under", "grip", "pgrip", "muzzle", "tactical", "receiver"] },
  zip:      { name: "Zip gun",             never: ["mount", "rail", "optic", "muzzle", "mag", "under", "stock", "grip", "pgrip", "tactical", "bipod", "receiver"] },
};

// Gun platforms. cat: its kind (CATEGORIES). slots: open on a bare gun. parts: { slot: [part keys] } the only parts
// that slot takes. builtin: { slot: part key } a part every gun of the platform has (counted in its numbers, never
// removed, worth nothing apart). The bolt-action ships with a scope base (its optic slot is open), the rimfire rifle
// takes a bipod (the bipod's own fit list).
/** @type {Record<string, { name: string, cat: string, slots: string[], parts?: Record<string, string[]>, builtin?: Record<string, string>, nocan?: boolean }>} */
export const PLATFORMS = {
  glock:     { name: "Polymer 9mm pistol",    cat: "pistol",   slots: ["optic", "muzzle", "mag", "tactical"] },
  p1911:     { name: "1911 pistol",           cat: "pistol",   slots: ["optic", "muzzle", "mag", "tactical"], parts: { tactical: ["laser", "lasergrip"] } }, // no rail: a laser grip
  rimpistol: { name: ".22 target pistol",     cat: "pistol",   slots: ["optic", "muzzle", "mag"] },
  revolver:  { name: "Revolver",              cat: "revolver", slots: ["mount", "pgrip", "tactical", "muzzle"], parts: { tactical: ["laser", "lasergrip"] } }, // a laser grip; a can (user, 2026-10-10)
  mp5:       { name: "Submachine gun",        cat: "smg",      slots: ["mount", "muzzle", "mag", "stock", "tactical", "sling"] },
  ar15:      { name: "AR-15",                 cat: "rifle",    slots: ["optic", "muzzle", "mag", "stock", "rail", "under", "pgrip", "tactical", "bipod", "sling", "receiver"] },
  ar10:      { name: "AR-10",                 cat: "rifle",    slots: ["optic", "muzzle", "mag", "stock", "rail", "pgrip", "bipod", "sling", "receiver"] },
  m249:      { name: "Light machine gun",     cat: "mg",       slots: ["optic", "muzzle", "mag", "tactical"], builtin: { bipod: "bipod" } },
  ak:        { name: "Kalashnikov",           cat: "rifle",    slots: ["mount", "muzzle", "mag", "stock", "rail", "pgrip", "sling"] },
  bolt:      { name: "Bolt-action rifle",     cat: "bolt",     slots: ["optic", "muzzle", "mag", "stock", "bipod", "sling"] },
  lever:     { name: "Lever-action rifle",    cat: "lever",    slots: ["mount", "muzzle", "stock", "bipod", "sling"] },
  rimrifle:  { name: ".22 rifle",             cat: "bolt",     slots: ["optic", "muzzle", "mag", "stock", "bipod", "sling"] },
  pump:      { name: "Pump shotgun",          cat: "pump",     slots: ["mount", "muzzle", "mag", "stock", "tactical", "sling", "receiver"] },
  semi12:    { name: "Semi-auto shotgun",     cat: "semi12",   slots: ["optic", "muzzle", "mag", "stock", "tactical", "sling", "receiver"] },
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
  // 2026-10-10 (data-guns.js AR_GEAR): the Mini-14-style ranch rifle (its own magazines; a scope mount for a sight)
  ranch:     { name: "Ranch rifle",           cat: "rifle",    slots: ["mount", "muzzle", "mag", "stock", "bipod", "sling"] },
  // Ready for the guns other branches add (2026-10-10: a P90-style PDW, a 5.7 or other polymer pistol, an AR pistol
  // on a platform of its own): map them here or let PLATFORM_GUESS find them. Their magazines are data-kit.js MAGAZINES rows by platform.
  polypistol: { name: "Polymer pistol",       cat: "pistol",   slots: ["optic", "muzzle", "mag", "tactical"] },
  pdw:       { name: "Personal defence weapon", cat: "pdw",    slots: ["optic", "muzzle", "mag", "tactical", "sling"] },
  arpistol:  { name: "AR pistol",             cat: "arpistol", slots: ["optic", "muzzle", "mag", "stock", "rail", "pgrip", "tactical", "sling", "receiver"], parts: { stock: ["pistolbrace"] } },

};
// A new platform takes the parts its look-alike takes (gunmods.js widens each part's fits.plat at load), less SKIP:
// magazines never (they are by platform: data-kit.js MAGAZINES), a bullpup no stock and no M203. (The slots it has
// decide the rest: a part for a slot the platform lacks never fits it.)
export const PLATFORM_LIKE = { single: "dbl", battle: "ar10", bullpup: "ar15", ump: "mp5", poly45: "glock", deagle: "p1911", m240: "m249",
  polypistol: "glock", pdw: "ump", arpistol: "ar15", ranch: "lever" };
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
  // the AR platform and calibres of 2026-10-10 (data-guns.js AR_GEAR): every AR-15 pattern gun takes STANAG magazines
  // and the AR-15's parts
  ar15rifle: "ar15", ar223: "ar15", arpistol: "ar15", ar300: "ar15", sbr300: "ar15", ardmr: "ar15",
  single556: "single", single223: "single", single300: "single", varmint223: "bolt", ranch223: "ranch", snub38: "revolver", service38: "revolver",
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
  // the AR platform of 2026-10-10 (data-guns.js AR_GEAR): the AR pistol is an AR-15 (its magazines and parts) with no
  // under-barrel launcher or bipod and a pistol brace for its only stock; the .38 snub-nose no scope rings either
  arpistol:  { off: ["under", "bipod"], parts: { stock: ["pistolbrace"] } },
  snub38:    { off: ["mount"] },
  varmint223: { off: ["mag"] }, // an internal box magazine (data-kit.js INTERNAL), no detachable one
};
// More calibres of 2026-10-10 (data-guns.js CALIBRE_GEAR): their own platforms where they take their own magazines.
// The 5.7 PDW (a P90: a sight rail on top, no stock to swap), the 5.7 pistol, the low-recoil .45 SMG (a Vector), the G3
// (its own magazines; a battle rifle's parts) and the FAMAS (a bullpup: no stock, a bipod). The .44s use the revolver,
// lever and single-shot platforms. PLATFORM_LIKE: the parts and the drawing of a look-alike. cat: their kind (CATEGORIES:
// the P90 a PDW, the Vector an SMG, the G3 a rifle, the FAMAS a bullpup).
Object.assign(PLATFORMS, {
  p90:    { name: "Bullpup PDW",          cat: "pdw",     slots: ["optic", "muzzle", "mag", "tactical", "sling"] },
  fn57:   { name: "5.7 pistol",           cat: "pistol",  slots: ["optic", "muzzle", "mag", "tactical"] },
  vector: { name: "Low-recoil SMG",       cat: "smg",     slots: ["optic", "muzzle", "mag", "stock", "grip", "tactical", "sling"] }, // (gun-attach: the rail under it takes a foregrip, as the .45 SMG's)
  // The G3: no top rail; a sight goes on its claw mount (2026-10-10, user: "the G3 gets a claw scope mount"). The FAMAS:
  // its folding bipod legs are part of the gun (built in, as the machine guns': rested on half cover, +8).
  g3:     { name: "Roller-delayed rifle", cat: "rifle",   slots: ["mount", "muzzle", "mag", "stock", "rail", "bipod", "sling"], parts: { mount: ["clawmount"] } },
  famas:  { name: "Bullpup rifle (FAMAS)", cat: "bullpup", slots: ["optic", "muzzle", "mag", "tactical", "sling"], builtin: { bipod: "bipod" } },
});
Object.assign(PLATFORM_LIKE, { p90: "mp5", fn57: "glock", vector: "mp5", g3: "ar10", famas: "ar15" });
Object.assign(PLATFORM_LIKE_SKIP, { p90: ["collapsible", "foldstock"], fn57: ["extmag"], famas: ["collapsible", "precision", "foldstock", "m203", "drum"] });
Object.assign(WEAPON_PLATFORM, { fiveseven: "fn57", p90: "p90", vector: "vector", g3: "g3", famas: "famas", revolver44: "revolver", lever44: "lever", single44: "single" });
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

const RIFLE_CALS = ["556", "762x39", "308", "3030", "223", "300blk"];
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
  can9:         { slot: "muzzle",   short: "suppressor",     look: "can_s",   fits: { cal: ["9mm", "45acp", "357", "38spl", "57x28"] }, can: true, noise: 0.5, jam: 1.2 },
  can556:       { slot: "muzzle",   short: "suppressor",     look: "can_l",   fits: { cal: ["556", "223"] }, can: true, noise: 0.55, aim: 1, jam: 1.3 },
  can308:       { slot: "muzzle",   short: "suppressor",     look: "can_l",   fits: { cal: ["308", "762x39", "300blk"] }, can: true, noise: 0.6, jam: 1.3 },
  can12:        { slot: "muzzle",   short: "shotgun suppressor", look: "can_l", fits: { cal: ["12ga", "20ga"], plat: ["pump", "semi12"] }, can: true, noise: 0.7, close: -2 },
  bottlecan:    { slot: "muzzle",   short: "bottle suppressor", look: "bottle", fits: { any: true, notCal: ["12ga", "20ga", "50bmg"] }, can: true, noise: 0.6, aim: -3 },
  solventcan:   { slot: "muzzle",   short: "solvent-trap suppressor", look: "oilfilter", fits: { cal: ["22lr", "9mm", "556", "223"] }, can: true, noise: 0.6, jam: 1.4 },
  flashhider:   { slot: "muzzle",   short: "flash hider",    look: "brake",   fits: { cal: RIFLE_CALS }, aim: 1, flashless: true },
  recoilpad:    { slot: "stock",    short: "recoil pad",     look: "stock_pad", fits: { plat: ["pump", "dbl", "semi12", "bolt", "lever", "amr"] }, aim: 2, aimBy: { pump: 1, dbl: 1, semi12: 1, amr: 1 } },
  collapsible:  { slot: "stock",    short: "collapsible stock", look: "stock_collapsible", fits: { plat: ["ar15", "mp5", "ak", "semi12"] }, aim: 2, close: 3 },
  precision:    { slot: "stock",    short: "precision stock", look: "stock_precision", fits: { plat: ["bolt", "ar10", "ar15", "rimrifle"] }, aim: 3, opt: 1, close: -3 },
  foldstock:    { slot: "stock",    short: "folding stock",  look: "stock_fold", fits: { plat: ["ak", "mp5", "semi12", "rimrifle", "ranch"] }, close: 4, aim: -2, wt: -0.4 },
  anglegrip:    { slot: "grip",     short: "angled grip",    look: "agrip",   fits: { any: true, notPlat: ["revolver"] }, aim: 1, close: 4 },
  revgrip:      { slot: "pgrip",     short: "rubber grips",   look: "grip",    fits: { plat: ["revolver"] }, aim: 3 },
  weaponlight:  { slot: "tactical", short: "weapon light",   look: "light",   fits: { any: true }, light: true, nightNear: 8 },
  peq:          { slot: "tactical", short: "IR laser",       look: "peq",     fits: { any: true }, peq: 8 },
  sling:        { slot: "sling",    short: "sling",          look: "sling",   fits: { any: true }, moving: 1 },
  m203:         { slot: "under",    short: "M203",           look: "m203",    fits: { plat: ["ar15"] }, launcher: "40mm" },
  // ---------- the parts catalogue of 2026-10-10 (user: "attachments that you would find in Tarkov and that would be
  // common in the US, and Chinese products that are less valuable and have less stats than American / European
  // brands"). Three tiers (PART_INFO tier): brand (modelled on a US / European maker: dearer, better, rarer, police,
  // military and gun-store stock), civil (a sound mid-priced part) and budget (a Chinese clone or an airsoft-grade
  // copy: cheap, worse, wears out (dur: fights, a muzzle device's shots), found in homes, malls, pawn shelves and
  // cheap traders). A budget part's brandOf is the part it copies (tools/gunslottest.js: never better, always cheaper).
  // reload: + shells a Reload puts in a tube (a side-saddle; mags.js).
  // sights
  aimpoint:     { slot: "optic",    short: "Aimpoint dot",   look: "reddot",  fits: { plat: ["pump", "semi12", "lever", "ar15", "ak", "mp5", "dbl", "ranch", "ar10", "m249"] }, aim: 5, close: 1 },
  holosun:      { slot: "optic",    short: "Holosun dot",    look: "reddot",  fits: { plat: ["pump", "semi12", "lever", "ar15", "ak", "mp5", "dbl", "ranch", "ar10", "revolver"] }, aim: 4, close: 1 },
  cheapdot:     { slot: "optic",    short: "cheap red dot",  look: "reddot",  fits: { plat: ["glock", "p1911", "revolver", "pump", "semi12", "lever", "ar15", "ak", "mp5", "dbl", "ranch", "ar10"] }, aim: 2 },
  cheapholo:    { slot: "optic",    short: "cheap holo",     look: "holo",    fits: { plat: ["pump", "semi12", "ar15", "ak", "mp5", "m249"] }, aim: 3, close: 1 },
  holomag:      { slot: "optic",    short: "holo + 3× magnifier", look: "holo", fits: { plat: ["ar15", "ar10", "ak", "m249"] }, aim: 5, close: 1, opt: 2, fall: -0.3 },
  cheapmag:     { slot: "optic",    short: "cheap dot + magnifier", look: "holo", fits: { plat: ["ar15", "ar10", "ak", "m249"] }, aim: 2, opt: 1, fall: -0.1, close: -1 },
  holopistol:   { slot: "optic",    short: "pistol dot",     look: "rmr",     fits: { plat: ["glock", "p1911", "rimpistol"] }, aim: 3, close: 2 },
  cheaprmr:     { slot: "optic",    short: "cheap pistol dot", look: "rmr",   fits: { plat: ["glock", "p1911", "rimpistol"] }, aim: 2, close: 1 },
  huntscope:    { slot: "optic",    short: "3–9× scope",     look: "scope9",  fits: { plat: ["lever", "rimrifle", "single", "bolt", "ranch"] }, aim: 1, opt: 4, fall: -0.6, close: -7 },
  cheapscope:   { slot: "optic",    short: "cheap 3–9× scope", look: "scope4", fits: { plat: ["lever", "rimrifle", "single", "bolt", "ranch"] }, opt: 2, fall: -0.3, close: -9 },
  cheapacog:    { slot: "optic",    short: "cheap 4× prism", look: "acog",    fits: { plat: ["ar15", "ar10", "m249", "ak"] }, aim: 3, opt: 2, fall: -0.3, close: -5 },
  cheaplpvo:    { slot: "optic",    short: "cheap 1–6× scope", look: "lpvo",  fits: { plat: ["ar15", "ar10"] }, aim: 3, opt: 1, fall: -0.2, close: -2 },
  // mounts and rails
  cheapmount:   { slot: "mount",    short: "cheap rings",    look: "mount",   fits: { plat: ["bolt", "lever", "pump", "rimrifle", "revolver", "mp5", "single", "dbl"] }, adds: ["optic"], aim: -1 },
  mlokpro:      { slot: "rail",     short: "free-float M-LOK", look: "rail",  fits: { plat: ["ar15", "ar10"] }, adds: ["grip", "tactical", "bipod"], aim: 2, wt: -0.25 },
  cheaprail:    { slot: "rail",     short: "cheap quad rail", look: "rail",   fits: { plat: ["ar15", "ar10", "ak"] }, adds: ["grip", "tactical", "bipod"], aim: -1, wt: 0.45 },
  // muzzle devices
  can9pro:      { slot: "muzzle",   short: "Osprey can",     look: "can_s",   fits: { cal: ["9mm", "45acp", "357", "38spl", "57x28"] }, can: true, noise: 0.4, jam: 1.1 },
  can556pro:    { slot: "muzzle",   short: "SOCOM can",      look: "can_l",   fits: { cal: ["556", "223"] }, can: true, noise: 0.45, aim: 1, jam: 1.15 },
  can308pro:    { slot: "muzzle",   short: ".308 can",       look: "can_l",   fits: { cal: ["308", "762x39", "300blk"] }, can: true, noise: 0.5, jam: 1.15 },
  can22pro:     { slot: "muzzle",   short: "Sparrow can",    look: "can_s",   fits: { cal: ["22lr"] }, can: true, noise: 0.3 },
  cheapcan:     { slot: "muzzle",   short: "fuel-filter can", look: "oilfilter", fits: { cal: ["22lr", "9mm", "556", "223"] }, can: true, noise: 0.65, jam: 1.5 },
  brakepro:     { slot: "muzzle",   short: "match brake",    look: "brake",   fits: { cal: RIFLE_CALS }, aim: 4, noise: 1.3 },
  cheapbrake:   { slot: "muzzle",   short: "cheap brake",    look: "brake",   fits: { cal: RIFLE_CALS }, aim: 2, noise: 1.35 },
  flashpro:     { slot: "muzzle",   short: "Warcomp",        look: "fh",      fits: { cal: RIFLE_CALS }, aim: 2, flashless: true },
  cheapcomp:    { slot: "muzzle",   short: "cheap compensator", look: "comp", fits: { cal: ["9mm", "45acp", "357", "38spl", "57x28", "44mag"] }, aim: 1, noise: 1.2 },
  turkeychoke:  { slot: "muzzle",   short: "turkey choke",   look: "choke",   fits: { cal: ["12ga", "20ga"] }, opt: 3, fall: -2.5, close: -6, spread: 3 },
  icchoke:      { slot: "muzzle",   short: "IC choke",       look: "choke",   fits: { cal: ["12ga", "20ga"] }, opt: 1, fall: -1, close: -1, spread: 1 },
  // stocks and grips
  ctrstock:     { slot: "stock",    short: "CTR stock",      look: "collapsible", fits: { plat: ["ar15", "ar10"] }, aim: 3, close: 3 },
  fixedstock:   { slot: "stock",    short: "A2 stock",       look: "stock_fixed", fits: { plat: ["ar15", "ar10"] }, aim: 3, close: -1 },
  cheapstock:   { slot: "stock",    short: "cheap stock",    look: "collapsible", fits: { plat: ["ar15", "ar10", "mp5", "ak"] }, aim: 1, close: 2 },
  pistolbrace:  { slot: "stock",    short: "pistol brace",   look: "fold",    fits: { plat: ["arpistol", "ar15"], guns: ["arpistol"] }, aim: 2, close: 2 },
  vgrippro:     { slot: "grip",     short: "BCM grip",       look: "vgrip",   fits: { any: true, notPlat: ["revolver"] }, aim: 2, close: 3 },
  handstop:     { slot: "grip",     short: "handstop",       look: "agrip",   fits: { any: true, notPlat: ["revolver"] }, aim: 1, close: 2 },
  cheapgrip:    { slot: "grip",     short: "cheap grip",     look: "vgrip",   fits: { any: true, notPlat: ["revolver"] }, aim: 1, close: 1 },
  pgrip:        { slot: "pgrip",    short: "MOE grip",       look: "revgrip", fits: { plat: ["ar15", "ar10", "ak", "arpistol"] }, aim: 1, close: 1 },
  cheappgrip:   { slot: "pgrip",    short: "cheap rifle grip", look: "revgrip", fits: { plat: ["ar15", "ar10", "ak", "arpistol"] }, close: 1 },
  cheaprevgrip: { slot: "pgrip",    short: "cheap grips",    look: "revgrip", fits: { plat: ["revolver"] }, aim: 1 },
  // the receiver: a charging handle, a shell carrier
  chandle:      { slot: "receiver", short: "Raptor handle",  look: "mount",   fits: { plat: ["ar15", "ar10", "arpistol"] }, jam: 0.85 },
  cheapchandle: { slot: "receiver", short: "cheap handle",   look: "mount",   fits: { plat: ["ar15", "ar10", "arpistol"] }, jam: 0.95 },
  sidesaddle:   { slot: "receiver", short: "side-saddle",    look: "tube_ext", fits: { plat: ["pump", "semi12"] }, reload: 1 },
  cheapsaddle:  { slot: "receiver", short: "shell holder",   look: "tube_ext", fits: { plat: ["pump", "semi12"] }, reload: 1 },
  // lights and lasers
  surefire:     { slot: "tactical", short: "SureFire light", look: "light",   fits: { any: true }, light: true, nightNear: 10 },
  pistollight:  { slot: "tactical", short: "TLR light",      look: "light",   fits: { any: true }, light: true, nightNear: 9 },
  lightlaser:   { slot: "tactical", short: "light / laser",  look: "peq",     fits: { any: true }, light: true, nightNear: 8, aim: 1, close: 5 },
  lasergrip:    { slot: "tactical", short: "laser grips",    look: "laser",   fits: { plat: ["revolver", "p1911", "glock"] }, aim: 1, close: 7 },
  cheaplight:   { slot: "tactical", short: "cheap light",    look: "light",   fits: { any: true }, light: true, nightNear: 4 },
  cheaplaser:   { slot: "tactical", short: "airsoft laser",  look: "laser",   fits: { any: true }, close: 3 },
  cheappeq:     { slot: "tactical", short: "replica PEQ",    look: "peq",     fits: { any: true }, light: true, nightNear: 3, close: 2 },
  // bipods and slings
  harris:       { slot: "bipod",    short: "Harris bipod",   look: "bipod",   fits: { any: true }, brace: 10 },
  cheapbipod:   { slot: "bipod",    short: "cheap bipod",    look: "bipod",   fits: { any: true }, brace: 5 },
  slingpro:     { slot: "sling",    short: "padded sling",   look: "sling",   fits: { any: true }, moving: 2 },
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
  can9:         MOD("Pistol-calibre suppressor", 60, 0.3, "A 9mm / .45 / 5.7 / .357 / .38 can: shots half as loud, but it fouls the action (jams ×1.2). Fits 9mm, .45, 5.7, .357 and .38 guns with a threaded barrel or muzzle, a revolver too (some of the gas still escapes at the cylinder)."),
  can556:       MOD("5.56 suppressor", 90, 0.5, "A military rifle can: shots 55% as loud, +1 aim (less kick), but more fouling (jams ×1.3). Fits 5.56 and .223 rifles."),
  can308:       MOD(".308 suppressor", 110, 0.6, "A big rifle can: shots 60% as loud, but more fouling (jams ×1.3). Fits .308, 7.62×39 and .300 Blackout rifles (with subsonic .300 BLK a whisper)."),
  can12:        MOD("Shotgun suppressor", 80, 0.7, "A fat can for a 12 gauge: shots 70% as loud, −2 up close. Fits the pump and semi-auto shotguns. Very rare."),
  bottlecan:    MOD("Bottle suppressor", 1, 0.1, "A plastic bottle taped over the muzzle: shots 60% as loud, −3 aim, and it is shot through in 3 shots. Fits any gun but a shotgun or the .50. Made in the field from a bottle and a scrap.", { makeshift: true, dur: 3 }),
  solventcan:   MOD("Solvent-trap suppressor", 30, 0.5, "A cleaning kit's solvent trap drilled out into a can: shots 60% as loud, but it fouls the action (jams ×1.4). Lasts 40 shots. Fits .22, 9mm, 5.56 and .223 guns. Made at a machine shop.", { makeshift: true, dur: 40 }),
  flashhider:   MOD("Flash hider", 6, 0.1, "A birdcage on a rifle's muzzle: +1 aim, and at night the flash no longer gives the shooter away. Fits rifles."),
  recoilpad:    MOD("Recoil pad", 8, 0.2, "A thick rubber butt pad: +2 aim (+3 on a shotgun or the .50). Fits shotguns, bolt-action and lever-action rifles and the .50."),
  collapsible:  MOD("Collapsible stock", 30, 0.3, "An adjustable stock: +2 aim, +3 more up close. Fits the AR-15 family, the submachine gun, a Kalashnikov and the semi-auto shotgun."),
  precision:    MOD("Precision stock", 60, 0.8, "An adjustable marksman's stock with a cheek rest: +3 aim, +1 tile of best range, −3 up close. Fits bolt-action rifles, the .22 rifle, the AR-10 and the AR-15 family."),
  foldstock:    MOD("Folding stock", 25, 0.3, "A side-folding stock, lighter than the factory one (−0.4 kg fitted): +4 up close, −2 aim. Fits a Kalashnikov, the submachine gun, the semi-auto shotgun and the .22 rifle."),
  anglegrip:    MOD("Angled foregrip", 15, 0.1, "A short angled grip under the handguard: +1 aim, +4 more up close. Fits under an AR-15's handguard, on a rail, the .45 SMG's rail or the police pump's fore-end rail. Not a pistol, a revolver or a hunting gun."),
  revgrip:      MOD("Rubber revolver grips", 10, 0.05, "Finger-groove rubber grips that soak up the kick, modelled on Hogue's: +3 aim. Fits a revolver."),
  weaponlight:  MOD("Weapon light", 18, 0.15, "A light on the gun's rail (not on a revolver or a 1911: no rail): at night +8 aim within 6 tiles, and it lights the way like a flashlight without taking the off hand (but is seen from further off). Fits any gun with a light / laser slot."),
  peq:          MOD("Infrared laser (PEQ)", 120, 0.2, "A military infrared aiming laser, invisible without night vision: +8 aim at night for someone wearing night vision goggles. Fits any gun with a light / laser rail (not a revolver or a 1911)."),
  sling:        MOD("Rifle sling", 5, 0.15, "A two-point sling: the gun stays steady on the move, +1 aim when the shooter moved this turn. Fits any gun with a sling slot."),
  m203:         MOD("M203 grenade launcher", 160, 1.4, "A 40 mm launcher under an AR-15's barrel (it blocks a foregrip). Fires 40 mm grenades from the rifle it is fitted to (Launch: up to 16 tiles, lobbed over walls; its own round, reloaded on its own), and the rifle still shoots. Best with Shooting 6."),
  // Repairs (repair.js, section 21).
  repairkit:    { name: "Field repair kit", slot: "pack", skill: null, power: 0, req: 0, value: 25, noise: 0, dur: 5, weight: 1, cat: "tools", desc: "A roll of tools, pins, springs, patches and glue: 5 field repairs of a gun, an attachment, armour or a makeshift tool anywhere (half what a workbench restores, and twice the lost maximum). Needs the same skill as a workbench repair." },
  kevlarkit:    { name: "Kevlar repair kit", slot: "pack", skill: null, power: 0, req: 0, value: 20, noise: 0, small: true, weight: 0.5, cat: "armor", desc: "Ballistic fabric patches and stitching: one workbench repair of a soft vest (with 2 scrap). Police and military kit." },
};

// ---------- the parts catalogue of 2026-10-10: the new parts as items ----------
// name, value, weight (kg), tier (brand / civil / budget), rarity (data-ammo.js RARITY: common ... veryrare; the find
// weight, PART_FINDS.FIND_W), tags (loot.js ITEM_TAGS: where it is kept), brandOf (a budget clone: the part it copies),
// dur (a budget part's life: fights, a muzzle device's shots; it wears like a makeshift one and falls apart). Generic
// names in the game's style; the description names the real maker it is modelled on. Its numbers and its drawing
// (look: an existing part's for now): MOD_ATTACH above. Merged into MOD_GEAR below.
/** @type {Record<string, { name: string, value: number, weight: number, tier: string, rarity: string, tags: string[], brandOf?: string, dur?: number, desc: string }>} */
export const PART_INFO = {
  aimpoint:     { name: "Military red dot", value: 60, weight: 0.22, tier: "brand", rarity: "scarce", tags: ["military", "police", "guns"],
                  desc: "A rugged tube red dot modelled on an Aimpoint (Swedish; the US Army's M68): +5 aim, +1 more up close, years on one battery. Fits rifles, carbines, the SMG, shotguns and the lever-action (on rings)." },
  holosun:      { name: "Red dot sight (Holosun-style)", value: 30, weight: 0.18, tier: "civil", rarity: "uncommon", tags: ["guns", "sport", "police", "hunt"],
                  desc: "A modern open red dot modelled on a Holosun: +4 aim, +1 more up close. A sound mid-priced sight for rifles, shotguns, the lever-action and a revolver (on rings)." },
  cheapdot:     { name: "Budget red dot (Chinese clone)", value: 6, weight: 0.25, tier: "budget", rarity: "common", tags: ["home", "mall", "shop", "crime", "sport"], brandOf: "aimpoint", dur: 25,
                  desc: "A no-name red dot off a marketplace, a copy of the real thing: +2 aim, a dim smeary dot, and it loses its zero and dies within about 25 fights. Fits most guns with a sight slot or rings." },
  cheapholo:    { name: "Budget holo sight (Chinese EOTech clone)", value: 8, weight: 0.4, tier: "budget", rarity: "common", tags: ["mall", "shop", "crime", "sport"], brandOf: "holo", dur: 25,
                  desc: "A reflex sight dressed up to look like an EOTech holographic: +3 aim, +1 up close; the window fogs and the zero drifts, about 25 fights. Fits rifles, shotguns, the SMG and the machine gun." },
  holomag:      { name: "Holo sight and 3× magnifier", value: 150, weight: 0.65, tier: "brand", rarity: "rare", tags: ["military"],
                  desc: "A holographic sight with a flip-to-side 3× magnifier behind it, modelled on an EOTech EXPS3 and G33: +5 aim, +1 up close, and +2 tiles of best range with less aim lost beyond it. Fits the AR-15 family, the AR-10, a Kalashnikov (side mount) and the machine gun." },
  cheapmag:     { name: "Budget dot and 3× magnifier set (Chinese clone)", value: 20, weight: 0.7, tier: "budget", rarity: "uncommon", tags: ["mall", "sport", "crime", "shop"], brandOf: "holomag", dur: 25,
                  desc: "An airsoft-shop dot and magnifier combo: +2 aim, +1 tile of best range, −1 up close; blurry glass and a wandering zero, about 25 fights." },
  holopistol:   { name: "Pistol red dot (Holosun-style)", value: 22, weight: 0.04, tier: "civil", rarity: "uncommon", tags: ["guns", "police", "sport"],
                  desc: "A slide-mounted pistol dot modelled on a Holosun 507: +3 aim, +2 more up close. Fits the 9mm and .45 pistols and the .22 target pistol." },
  cheaprmr:     { name: "Budget pistol dot (Chinese RMR clone)", value: 7, weight: 0.06, tier: "budget", rarity: "common", tags: ["home", "mall", "shop", "crime", "sport"], brandOf: "rmr", dur: 25,
                  desc: "A copy of a Trijicon RMR that does not hold up to a slide's slam: +2 aim, +1 up close, about 25 fights. Fits the pistols." },
  huntscope:    { name: "Hunting scope 3–9×", value: 75, weight: 0.45, tier: "brand", rarity: "uncommon", tags: ["hunt", "guns", "farm"],
                  desc: "A clear variable hunting scope modelled on a Leupold VX: +1 aim, +4 tiles of best range, much less aim lost beyond it, −7 up close. Fits bolt-action, lever-action, .22 and single-shot rifles (on rings where they need them)." },
  cheapscope:   { name: "Budget 3–9× scope (Chinese clone)", value: 9, weight: 0.5, tier: "budget", rarity: "common", tags: ["home", "farm", "mall", "shop"], brandOf: "huntscope", dur: 30,
                  desc: "A big-box-store scope of no known make: +2 tiles of best range, a little less aim lost beyond it, −9 up close; dim, and it loses its zero in about 30 fights." },
  cheapacog:    { name: "Budget 4× prism (Chinese ACOG clone)", value: 18, weight: 0.5, tier: "budget", rarity: "uncommon", tags: ["crime", "mall", "sport", "shop"], brandOf: "acog", dur: 30,
                  desc: "A copy of a Trijicon ACOG with a painted-on fibre: +3 aim, +2 tiles of best range, −5 up close, about 30 fights. Fits the AR-15 family, the AR-10, the machine gun and a Kalashnikov (side mount)." },
  cheaplpvo:    { name: "Budget 1–6× scope (Chinese clone)", value: 25, weight: 0.7, tier: "budget", rarity: "uncommon", tags: ["mall", "sport", "shop", "crime"], brandOf: "lpvo", dur: 30,
                  desc: "A low-power variable scope from an online marketplace: +3 aim, +1 tile of best range, −2 up close; soft glass, about 30 fights. Fits the AR-15 family and the AR-10." },
  cheapmount:   { name: "Budget scope rings (Chinese clone)", value: 3, weight: 0.12, tier: "budget", rarity: "common", tags: ["home", "farm", "mall", "shop", "hunt"], brandOf: "scopemount",
                  desc: "Soft-alloy rings that never quite hold zero: they carry a sight, −1 aim. Fits what a scope mount fits." },
  mlokpro:      { name: "Free-float M-LOK handguard", value: 90, weight: 0.25, tier: "brand", rarity: "rare", tags: ["military", "guns"],
                  desc: "A long free-floating handguard modelled on a Geissele MK16: the barrel touches nothing, +2 aim, lighter than the factory one (−0.25 kg fitted); room for a foregrip, a light or laser and a bipod. Fits the AR-15 family and the AR-10." },
  cheaprail:    { name: "Budget quad rail (Chinese clone)", value: 8, weight: 0.45, tier: "budget", rarity: "common", tags: ["crime", "mall", "sport", "shop"], brandOf: "quadrail",
                  desc: "A heavy cast quad rail with sharp edges and wobbly screws: room for a foregrip, a light or laser and a bipod, but −1 aim and +0.45 kg fitted. Fits the AR-15 family, the AR-10 and a Kalashnikov." },
  can9pro:      { name: "Premium pistol suppressor", value: 120, weight: 0.3, tier: "brand", rarity: "rare", tags: ["police", "military", "guns"],
                  desc: "A light modular pistol can modelled on a SilencerCo Osprey: shots 40% as loud, little fouling (jams ×1.1). Fits 9mm, .45, 5.7, .357 and .38 guns with a threaded barrel, a revolver too." },
  can556pro:    { name: "Premium 5.56 suppressor", value: 160, weight: 0.5, tier: "brand", rarity: "rare", tags: ["military"],
                  desc: "A quick-detach military rifle can modelled on a SureFire SOCOM: shots 45% as loud, +1 aim (less kick), jams ×1.15. Fits 5.56 and .223 rifles." },
  can308pro:    { name: "Premium .308 suppressor", value: 180, weight: 0.6, tier: "brand", rarity: "rare", tags: ["military", "guns"],
                  desc: "A big-bore rifle can modelled on an AAC / Gemtech: shots half as loud, jams ×1.15. Fits .308, 7.62×39 and .300 Blackout rifles." },
  can22pro:     { name: "Premium .22 suppressor", value: 75, weight: 0.15, tier: "brand", rarity: "scarce", tags: ["guns", "hunt"],
                  desc: "A take-apart rimfire can modelled on a SilencerCo Sparrow: a .22's shots under a third as loud. Fits .22 guns." },
  cheapcan:     { name: "Budget fuel-filter can (Chinese import)", value: 12, weight: 0.35, tier: "budget", rarity: "uncommon", tags: ["crime", "garage", "mall", "shop"], brandOf: "can9", dur: 60,
                  desc: "A 'solvent trap' kit sold online as a fuel filter, drilled into a can: shots 65% as loud, it fouls the action (jams ×1.5), shot loose in about 60 shots. Fits .22, 9mm, 5.56 and .223 guns." },
  brakepro:     { name: "Precision muzzle brake", value: 55, weight: 0.12, tier: "brand", rarity: "scarce", tags: ["guns", "military", "hunt"],
                  desc: "A tuned three-port brake modelled on a Precision Armament M4-72: +4 aim (the muzzle stays down), shots 30% louder. Fits rifles." },
  cheapbrake:   { name: "Budget muzzle brake (Chinese clone)", value: 5, weight: 0.15, tier: "budget", rarity: "common", tags: ["crime", "mall", "sport", "shop", "garage"], brandOf: "brake",
                  desc: "A copy of a muzzle brake, machined off-centre: +2 aim, shots 35% louder. Fits rifles." },
  flashpro:     { name: "Combat flash hider", value: 40, weight: 0.12, tier: "brand", rarity: "scarce", tags: ["military", "guns"],
                  desc: "A hybrid flash hider and brake modelled on a SureFire Warcomp: +2 aim, and at night the flash no longer gives the shooter away. Fits rifles." },
  cheapcomp:    { name: "Budget pistol compensator (Chinese clone)", value: 4, weight: 0.1, tier: "budget", rarity: "common", tags: ["home", "mall", "shop", "crime", "sport"], brandOf: "comp",
                  desc: "A slip-on compensator copy: +1 aim, shots 20% louder. Fits 9mm, .45, 5.7, .357, .38 and .44 guns." },
  turkeychoke:  { name: "Extra-full turkey choke", value: 28, weight: 0.06, tier: "civil", rarity: "uncommon", tags: ["hunt", "guns", "farm"],
                  desc: "A long extra-full choke tube modelled on a Carlson's turkey choke: a tight pattern, +3 tiles of best range and much less aim lost beyond it, −6 up close. Fits 12 and 20 gauge guns." },
  icchoke:      { name: "Improved-cylinder choke", value: 10, weight: 0.05, tier: "civil", rarity: "common", tags: ["hunt", "guns", "farm", "sport"],
                  desc: "An open choke tube for close birds and slugs: +1 tile of best range, a little less aim lost beyond it, −1 up close. Fits 12 and 20 gauge guns." },
  ctrstock:     { name: "Adjustable carbine stock (Magpul-style)", value: 45, weight: 0.25, tier: "brand", rarity: "uncommon", tags: ["guns", "police", "military"],
                  desc: "A locking six-position stock modelled on a Magpul CTR: +3 aim, +3 more up close. Fits the AR-15 family and the AR-10." },
  fixedstock:   { name: "Fixed rifle stock (A2-style)", value: 20, weight: 0.4, tier: "civil", rarity: "uncommon", tags: ["guns", "military"],
                  desc: "The long fixed stock of an M16A2: a solid cheek weld, +3 aim, −1 up close. Fits the AR-15 family and the AR-10." },
  cheapstock:   { name: "Budget adjustable stock (Chinese clone)", value: 8, weight: 0.3, tier: "budget", rarity: "common", tags: ["home", "mall", "shop", "crime", "sport"], brandOf: "ctrstock",
                  desc: "A rattling copy of a carbine stock: +1 aim, +2 up close. Fits the AR-15 family, the AR-10, the SMG and a Kalashnikov (with its adapter)." },
  pistolbrace:  { name: "Pistol stabilizing brace", value: 40, weight: 0.3, tier: "civil", rarity: "uncommon", tags: ["guns", "crime", "home"],
                  desc: "An arm brace for an AR pistol modelled on an SB Tactical SBA3: braced on the forearm or the shoulder, +2 aim, +2 up close. Fits an AR pistol only (its only stock)." },
  vgrippro:     { name: "Vertical grip (BCM-style)", value: 30, weight: 0.08, tier: "brand", rarity: "uncommon", tags: ["military", "police", "guns"],
                  desc: "A short stubby vertical grip modelled on a BCM Gunfighter: +2 aim, +3 more up close. Fits under a rail or a handguard (not a pistol, a revolver or a hunting gun)." },
  handstop:     { name: "Handstop (Magpul-style)", value: 10, weight: 0.03, tier: "civil", rarity: "common", tags: ["guns", "police", "military", "sport"],
                  desc: "A small stop at the front of the handguard for a straight-arm grip, modelled on a Magpul handstop: +1 aim, +2 up close." },
  cheapgrip:    { name: "Budget vertical grip (Chinese clone)", value: 3, weight: 0.15, tier: "budget", rarity: "common", tags: ["home", "mall", "shop", "crime", "sport"], brandOf: "foregrip",
                  desc: "An airsoft-grade plastic foregrip that flexes when it is pulled: +1 aim, +1 up close." },
  pgrip:        { name: "Rifle pistol grip (Magpul MOE-style)", value: 15, weight: 0.08, tier: "civil", rarity: "uncommon", tags: ["guns", "military", "police"],
                  desc: "A textured polymer pistol grip modelled on a Magpul MOE: +1 aim, +1 up close. Fits the AR-15 family, the AR-10, a Kalashnikov and an AR pistol." },
  cheappgrip:   { name: "Budget rifle grip (Chinese clone)", value: 3, weight: 0.1, tier: "budget", rarity: "common", tags: ["home", "mall", "shop", "crime", "sport"], brandOf: "pgrip",
                  desc: "A slick copy of a rifle pistol grip: +1 up close, no more." },
  cheaprevgrip: { name: "Budget revolver grips (Chinese clone)", value: 3, weight: 0.06, tier: "budget", rarity: "common", tags: ["home", "mall", "shop", "crime"], brandOf: "revgrip",
                  desc: "Hard rubber copies of finger-groove revolver grips: +1 aim. Fits a revolver." },
  chandle:      { name: "Extended charging handle (Radian-style)", value: 45, weight: 0.05, tier: "brand", rarity: "uncommon", tags: ["guns", "military"],
                  desc: "An ambidextrous charging handle with big latches modelled on a Radian Raptor: a jam is cleared quicker (jams ×0.85). Fits the AR-15 family, the AR-10 and an AR pistol." },
  cheapchandle: { name: "Budget charging handle (Chinese clone)", value: 6, weight: 0.05, tier: "budget", rarity: "common", tags: ["crime", "mall", "shop", "sport"], brandOf: "chandle", dur: 40,
                  desc: "A copy of an ambidextrous charging handle: a little quicker on a jam (×0.95) until its latch snaps, about 40 fights." },
  sidesaddle:   { name: "Side-saddle shell carrier", value: 30, weight: 0.2, tier: "civil", rarity: "uncommon", tags: ["guns", "police", "hunt"],
                  desc: "Six shells held on the receiver, modelled on a Mesa Tactical SureShell: a Reload puts one more shell in the tube. Fits the pump and semi-auto shotguns." },
  cheapsaddle:  { name: "Elastic shell holder (Chinese import)", value: 4, weight: 0.05, tier: "budget", rarity: "common", tags: ["home", "mall", "shop", "farm", "sport"], brandOf: "sidesaddle", dur: 30,
                  desc: "An elastic strip of shell loops stuck on the receiver: a Reload puts one more shell in the tube, until the elastic gives (about 30 fights). Fits the pump and semi-auto shotguns." },
  surefire:     { name: "Rifle weapon light (SureFire-style)", value: 55, weight: 0.12, tier: "brand", rarity: "scarce", tags: ["police", "military", "guns"],
                  desc: "A blinding rail light modelled on a SureFire Scout: at night +10 aim within 6 tiles, and it lights the way like a flashlight. Fits any gun with a light / laser rail." },
  pistollight:  { name: "Pistol light (Streamlight-style)", value: 35, weight: 0.1, tier: "brand", rarity: "uncommon", tags: ["police", "guns", "home"],
                  desc: "A compact rail light modelled on a Streamlight TLR-1: at night +9 aim within 6 tiles, a flashlight on the gun. Fits any gun with a light / laser rail." },
  lightlaser:   { name: "Light and laser unit (Streamlight-style)", value: 75, weight: 0.15, tier: "brand", rarity: "scarce", tags: ["police", "guns", "military"],
                  desc: "A rail light with a laser in one body, modelled on a Streamlight TLR-2: +1 aim, +5 up close, and at night +8 aim within 6 tiles. Fits any gun with a light / laser rail." },
  lasergrip:    { name: "Laser grips (Crimson Trace-style)", value: 45, weight: 0.06, tier: "brand", rarity: "uncommon", tags: ["guns", "police", "home"],
                  desc: "Grips with a laser that switches on as the hand closes, modelled on a Crimson Trace: +1 aim, +7 up close. Fits a revolver, a 1911 and the polymer 9mm pistols." },
  cheaplight:   { name: "Budget tactical flashlight (Chinese clone)", value: 5, weight: 0.15, tier: "budget", rarity: "common", tags: ["home", "mall", "shop", "crime", "sport", "garage"], brandOf: "surefire", dur: 20,
                  desc: "A 'tactical' flashlight with a rail clamp from a gas-station shelf: at night +4 aim within 6 tiles, a dim beam that flickers out in about 20 fights." },
  cheaplaser:   { name: "Airsoft-grade laser (Chinese clone)", value: 4, weight: 0.08, tier: "budget", rarity: "common", tags: ["home", "mall", "shop", "crime", "sport"], brandOf: "laser", dur: 20,
                  desc: "A toy-store red laser on a rail clamp: +3 aim up close, while it holds its zero (about 20 fights)." },
  cheappeq:     { name: "Replica PEQ box (Chinese airsoft clone)", value: 10, weight: 0.2, tier: "budget", rarity: "uncommon", tags: ["crime", "mall", "sport", "shop"], brandOf: "lightlaser", dur: 20,
                  desc: "A plastic copy of a military PEQ box with a weak light and a visible laser (no infrared): +2 up close, at night +3 within 6 tiles, about 20 fights." },
  harris:       { name: "Precision bipod (Harris-style)", value: 45, weight: 0.35, tier: "brand", rarity: "uncommon", tags: ["hunt", "guns", "military"],
                  desc: "A spring-legged bipod modelled on a Harris: +10 aim when the gun rests on half cover next to the shooter in the line of fire. Fits any gun with a bipod slot." },
  cheapbipod:   { name: "Budget bipod (Chinese clone)", value: 6, weight: 0.45, tier: "budget", rarity: "common", tags: ["home", "farm", "mall", "shop", "hunt"], brandOf: "harris",
                  desc: "A wobbly copy of a hunting bipod: +5 aim rested on half cover." },
  slingpro:     { name: "Padded two-point sling", value: 25, weight: 0.15, tier: "brand", rarity: "uncommon", tags: ["military", "police", "guns"],
                  desc: "A quick-adjust padded sling modelled on a Blue Force Gear Vickers: +2 aim when the shooter moved this turn." },
};
// More calibres of 2026-10-10: the G3's claw mount (HK-style: clamps onto the receiver's dimples, carries any rifle sight).
Object.assign(MOD_ATTACH, { clawmount: { slot: "mount", short: "claw mount", look: "mount", fits: { plat: ["g3"] }, adds: ["optic"] } });
Object.assign(PART_INFO, {
  clawmount: { name: "Claw scope mount (HK-style)", value: 35, weight: 0.3, tier: "brand", rarity: "scarce", tags: ["military", "guns"],
               desc: "A steel claw mount that clamps onto the G3's receiver and holds a sight rock-steady: it carries a scope, a red dot or a holo sight (the G3 has no top rail). Fits the roller-delayed battle rifle only." },
});
for (const [k, i] of Object.entries(PART_INFO)) MOD_GEAR[k] = MOD(i.name, i.value, i.weight, i.desc, { tier: i.tier, ...(i.dur ? { dur: i.dur, budget: true } : {}) });
// The parts from before the catalogue, by tier and rarity (their places: loot.js ITEM_TAGS, GUNMOD_FINDS, SITE_MODS).
/** @type {Record<string, [string, string]>} key -> [tier, rarity] */
export const OLD_PART_CLASS = {
  reddot: ["civil", "common"], holo: ["brand", "uncommon"], scope4x: ["civil", "common"], laser: ["civil", "common"], foregrip: ["civil", "common"],
  bipod: ["civil", "common"], pistolcan: ["civil", "scarce"], riflecan: ["civil", "scarce"], suppressor: ["makeshift", "uncommon"], brake: ["civil", "common"],
  comp: ["civil", "common"], choke: ["civil", "common"], tubeext: ["civil", "common"], tritium: ["brand", "uncommon"], rmr: ["brand", "uncommon"],
  acog: ["brand", "scarce"], lpvo: ["brand", "rare"], tacscope: ["brand", "rare"], thermalscope: ["brand", "veryrare"], scrapscope: ["makeshift", "common"],
  scopemount: ["civil", "common"], sidemount: ["civil", "uncommon"], quadrail: ["civil", "uncommon"], mlok: ["civil", "uncommon"], can22: ["civil", "uncommon"],
  can9: ["civil", "scarce"], can556: ["civil", "scarce"], can308: ["civil", "scarce"], can12: ["brand", "veryrare"], bottlecan: ["makeshift", "common"],
  solventcan: ["makeshift", "uncommon"], flashhider: ["civil", "common"], recoilpad: ["civil", "common"], collapsible: ["civil", "uncommon"],
  precision: ["brand", "scarce"], foldstock: ["civil", "uncommon"], anglegrip: ["civil", "uncommon"], revgrip: ["civil", "common"], weaponlight: ["civil", "common"],
  peq: ["brand", "rare"], sling: ["civil", "common"], m203: ["brand", "rare"], extmag: ["civil", "common"], drum: ["civil", "scarce"],
};
// The catalogue's own finds (partfinds.js, every roll on its own dice: nothing else found changes): the parts of
// PART_INFO (and the budget magazines, BUDGET_MAGS) whose tags meet the place's (loot.js SITE_TAGS / AREA_TAGS,
// WARE_TAGS here), weighted by FIND_W of their rarity. site: a search hour's chance by site type; area: a raid
// container's by area type; wares: a group's table a week by its type. The cheap clones turn up in homes, malls, the
// town's pawn shelves (shop, crime) and cheap traders; the brands at gun stores, police and the military.
export const PART_FINDS = {
  FIND_W: { common: 1, uncommon: 0.5, scarce: 0.22, rare: 0.08, veryrare: 0.025 },
  site: { gunstore: 0.09, police: 0.04, prison: 0.015, military: 0.05, crash_mil: 0.03, convoy: 0.03, airdrop: 0.01, mall: 0.04, town: 0.012,
          city: 0.012, apartments: 0.008, motel: 0.006, truckstop: 0.006, gas: 0.004, farm: 0.01, ranch: 0.012, cabin: 0.015, lodge: 0.02,
          feedstore: 0.008, hardware: 0.006, school: 0.003 },
  area: { gunshop: 0.08, armory: 0.06, barracks: 0.03, milwreck: 0.03, house: 0.008, farmhouse: 0.012, cabin: 0.02, store: 0.012, lockers: 0.006,
          roadcars: 0.004, garage: 0.004 },
  wares: { traders: 0.4, military: 0.3, fortress: 0.15, expansionist: 0.2, raider: 0.25, commune: 0.15, zealot: 0.05, merchants: 0.45 },
  WARE_TAGS: { traders: ["guns", "hunt", "home", "farm", "mall", "shop"], military: ["military"], fortress: ["police", "military"],
               merchants: ["guns", "hunt", "police", "military", "mall"], expansionist: ["police", "guns", "military", "shop"],
               raider: ["crime", "home", "mall", "shop"], commune: ["farm", "hunt", "home"], zealot: ["farm", "home"] },
};
// The budget magazines (data-kit.js MAGAZINES: their numbers) in the catalogue's finds, with the magazine they copy.
/** @type {Record<string, { tier: string, rarity: string, tags: string[], brandOf: string }>} */
export const BUDGET_MAGS = {
  mag_stanag_30c: { tier: "budget", rarity: "common", tags: ["home", "mall", "shop", "crime", "sport"], brandOf: "mag_stanag_30" },
  mag_glock_17c:  { tier: "budget", rarity: "common", tags: ["home", "mall", "shop", "crime", "sport"], brandOf: "mag_glock_17" },
};
