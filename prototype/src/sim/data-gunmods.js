// @ts-check
// More attachments, gun platforms and their slots (docs/weapons-overhaul-plan.md sections 5, 9, 21, 22). Plain data
// that imports nothing; data.js merges MOD_GEAR into GEAR, gunmods.js merges MOD_ATTACH into ATTACH and reads
// PLATFORMS / WEAPON_PLATFORM. Owner: the economy agent (C) for the data; the UI agent (D) reads it for the gun builder.
//
// Slots (where a part goes on a gun): optic (a sight), mount (rings or a side rail that carries an optic), muzzle
// (a suppressor, a brake, a choke), mag (a bigger magazine), under (under the barrel: a grenade launcher), stock,
// grip (a foregrip), rail (a rail handguard that carries more parts), tactical (a light, a laser), bipod, sling.
// Nesting: a part can carry `adds` (slots it opens): a mount adds an optic, a quad rail a grip, a tactical and a bipod.
// under and grip share the space under the handguard: fitting one blocks the other.
// Fit: muzzle devices fit by calibre (fits.cal) on a platform with a muzzle slot; everything else by platform
// (fits.plat), or on any gun with that slot open (fits.any). nocan: no suppressor fits it (a revolver's cylinder gap).
/** @type {string[]} */
export const SLOTS = ["mount", "rail", "optic", "muzzle", "mag", "under", "stock", "grip", "tactical", "bipod", "sling"];
/** @type {Record<string, string>} */
export const SLOT_NAMES = { optic: "Sight", mount: "Mount", muzzle: "Muzzle", mag: "Magazine", under: "Under the barrel", stock: "Stock", grip: "Grip", rail: "Rail", tactical: "Light / laser", bipod: "Bipod", sling: "Sling" };
// Slots that share one space (fitting one blocks the others).
/** @type {string[][]} */
export const SHARED = [["under", "grip"]];

// Gun platforms. slots: open on a bare gun. builtin: { slot: part key } a part every gun of the platform has (counted
// in its numbers, never removed, worth nothing apart). The plan's table (section 5) with four additions so that every
// attachment that fitted a gun before still fits it: tactical and bipod on the AR-15 family (the police carbine's
// light rail, a clamp-on bipod), tactical and muzzle on the revolver (a laser grip, a ported compensator; still no
// suppressor), a grip on the pump shotgun, a muzzle and a bipod on the lever-action. The bolt-action ships with a
// scope base (its optic slot is open), the rimfire rifle takes a bipod (the bipod's own fit list).
/** @type {Record<string, { name: string, slots: string[], builtin?: Record<string, string>, nocan?: boolean }>} */
export const PLATFORMS = {
  glock:     { name: "Polymer 9mm pistol",    slots: ["optic", "muzzle", "mag", "tactical"] },
  p1911:     { name: "1911 pistol",           slots: ["optic", "muzzle", "mag", "tactical"] },
  rimpistol: { name: ".22 target pistol",     slots: ["optic", "muzzle", "mag"] },
  revolver:  { name: "Revolver",              slots: ["mount", "grip", "tactical", "muzzle"], nocan: true },
  mp5:       { name: "Submachine gun",        slots: ["mount", "muzzle", "mag", "stock", "tactical", "sling"] },
  ar15:      { name: "AR-15",                 slots: ["optic", "muzzle", "mag", "stock", "rail", "under", "tactical", "bipod", "sling"] },
  ar10:      { name: "AR-10",                 slots: ["optic", "muzzle", "mag", "stock", "rail", "bipod", "sling"] },
  m249:      { name: "Light machine gun",     slots: ["optic", "muzzle", "mag", "stock", "tactical"], builtin: { bipod: "bipod" } },
  ak:        { name: "Kalashnikov",           slots: ["mount", "muzzle", "mag", "stock", "rail", "sling"] },
  bolt:      { name: "Bolt-action rifle",     slots: ["optic", "muzzle", "mag", "stock", "bipod", "sling"] },
  lever:     { name: "Lever-action rifle",    slots: ["mount", "muzzle", "stock", "bipod", "sling"] },
  rimrifle:  { name: ".22 rifle",             slots: ["optic", "muzzle", "mag", "stock", "bipod", "sling"] },
  pump:      { name: "Pump shotgun",          slots: ["mount", "muzzle", "mag", "stock", "tactical", "grip", "sling"] },
  semi12:    { name: "Semi-auto shotgun",     slots: ["optic", "muzzle", "mag", "stock", "tactical", "sling"] },
  dbl:       { name: "Double-barrel shotgun", slots: ["muzzle", "stock", "sling"] },
  amr:       { name: "Anti-materiel rifle",   slots: ["optic", "muzzle", "mag", "sling"], builtin: { bipod: "bipod" } },
  zip:       { name: "Zip gun",               slots: ["sling"] },
  // The arsenal of 2026-10-10 (data-guns.js ARSENAL_GEAR): a break-open single barrel (shotgun or rifle: a scope mount
  // for a sight), the .308 battle rifles, a bullpup (no stock to swap), a .45 SMG and pistol, the hand cannon, the
  // belt-fed .308 machine gun (its bipod built in).
  single:    { name: "Single-shot break action", slots: ["mount", "muzzle", "stock", "sling"] },
  battle:    { name: "Battle rifle",          slots: ["optic", "muzzle", "mag", "stock", "rail", "bipod", "sling"] },
  bullpup:   { name: "Bullpup rifle",         slots: ["optic", "muzzle", "mag", "rail", "tactical", "sling"] },
  ump:       { name: ".45 submachine gun",    slots: ["optic", "muzzle", "mag", "stock", "tactical", "sling"] },
  poly45:    { name: "Polymer .45 pistol",    slots: ["optic", "muzzle", "mag", "tactical"] },
  deagle:    { name: "Magnum pistol",         slots: ["optic", "mag", "tactical"] },
  m240:      { name: "General-purpose machine gun", slots: ["optic", "muzzle", "mag", "stock", "tactical"], builtin: { bipod: "bipod" } },
  // 2026-10-10 (data-guns.js AR_GEAR): the Mini-14-style ranch rifle (its own magazines; a scope mount for a sight)
  ranch:     { name: "Ranch rifle",           slots: ["mount", "muzzle", "mag", "stock", "bipod", "sling"] },
};
// A new platform takes the parts its look-alike takes (gunmods.js widens each part's fits.plat at load), less SKIP:
// magazines never (they are by platform: data-kit.js MAGAZINES), a bullpup no stock and no M203.
export const PLATFORM_LIKE = { single: "dbl", battle: "ar10", bullpup: "ar15", ump: "mp5", poly45: "glock", deagle: "p1911", m240: "m249", ranch: "lever" };
export const PLATFORM_LIKE_SKIP = { bullpup: ["collapsible", "precision", "foldstock", "m203", "drum"], poly45: ["extmag"] };
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
// Slots a weapon lacks that its platform has: the compact 9mm has no threaded barrel, the sawn-off nothing at all, the
// hunting rifle's scope is part of its own numbers (combat.js WEAPONS huntrifle: opt 12).
/** @type {Record<string, string[]>} */
export const WEAPON_SLOTS_OFF = { compact9: ["muzzle"], sawnoff: ["muzzle", "stock", "sling"], huntrifle: ["optic", "mount"] };
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
  scopemount:   { slot: "mount",    short: "scope mount",    look: "mount",   fits: { plat: ["bolt", "lever", "pump", "rimrifle", "revolver", "mp5", "single"] }, adds: ["optic"] },
  sidemount:    { slot: "mount",    short: "side mount",     look: "mount",   fits: { plat: ["ak"] }, adds: ["optic"] },
  quadrail:     { slot: "rail",     short: "quad rail",      look: "rail",    fits: { plat: ["ar15", "ar10", "ak"] }, adds: ["grip", "tactical", "bipod"] },
  mlok:         { slot: "rail",     short: "M-LOK handguard", look: "rail",   fits: { plat: ["ar15", "ar10"] }, adds: ["grip", "tactical"], aim: 1, wt: -0.2 },
  can22:        { slot: "muzzle",   short: "suppressor",     look: "can_s",   fits: { cal: ["22lr"] }, can: true, noise: 0.35 },
  can9:         { slot: "muzzle",   short: "suppressor",     look: "can_s",   fits: { cal: ["9mm", "45acp"] }, can: true, noise: 0.5, jam: 1.2 },
  can556:       { slot: "muzzle",   short: "suppressor",     look: "can_l",   fits: { cal: ["556", "223"] }, can: true, noise: 0.55, aim: 1, jam: 1.3 },
  can308:       { slot: "muzzle",   short: "suppressor",     look: "can_l",   fits: { cal: ["308", "762x39", "300blk"] }, can: true, noise: 0.6, jam: 1.3 },
  can12:        { slot: "muzzle",   short: "shotgun suppressor", look: "can_l", fits: { cal: ["12ga", "20ga"], plat: ["pump", "semi12"] }, can: true, noise: 0.7, close: -2 },
  bottlecan:    { slot: "muzzle",   short: "bottle suppressor", look: "bottle", fits: { any: true, notCal: ["12ga", "20ga", "50bmg"] }, can: true, noise: 0.6, aim: -3 },
  solventcan:   { slot: "muzzle",   short: "solvent-trap suppressor", look: "oilfilter", fits: { cal: ["22lr", "9mm", "556", "223"] }, can: true, noise: 0.6, jam: 1.4 },
  flashhider:   { slot: "muzzle",   short: "flash hider",    look: "brake",   fits: { cal: RIFLE_CALS }, aim: 1, flashless: true },
  recoilpad:    { slot: "stock",    short: "recoil pad",     look: "stock_pad", fits: { plat: ["pump", "dbl", "semi12", "bolt", "lever", "amr"] }, aim: 2, aimBy: { pump: 1, dbl: 1, semi12: 1, amr: 1 } },
  collapsible:  { slot: "stock",    short: "collapsible stock", look: "stock_collapsible", fits: { plat: ["ar15", "mp5", "ak", "semi12"] }, aim: 2, close: 3 },
  precision:    { slot: "stock",    short: "precision stock", look: "stock_precision", fits: { plat: ["bolt", "ar10", "ar15"] }, aim: 3, opt: 1, close: -3 },
  foldstock:    { slot: "stock",    short: "folding stock",  look: "stock_fold", fits: { plat: ["ak", "mp5", "semi12"] }, close: 4, aim: -2, wt: -0.4 },
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
  scopemount:   MOD("Scope mount", 8, 0.1, "Rings and a base for a gun with no sight rail: it carries a sight. Fits bolt-action and lever-action rifles, the .22 rifle, the pump shotgun, a revolver and the submachine gun."),
  sidemount:    MOD("Side-rail mount", 15, 0.15, "A Kalashnikov's side-rail mount: it carries a sight."),
  quadrail:     MOD("Quad rail handguard", 25, 0.3, "Rails on all four sides of the handguard: room for a foregrip, a light or laser, and a bipod. Fits the AR-15 family, the AR-10 and a Kalashnikov."),
  mlok:         MOD("M-LOK handguard", 35, 0.2, "A slim modern handguard, lighter than the factory one (−0.2 kg fitted): room for a foregrip and a light or laser, +1 aim. Fits the AR-15 family and the AR-10."),
  can22:        MOD(".22 suppressor", 40, 0.2, "A rimfire can: a .22's shots barely a third as loud. Fits .22 guns."),
  can9:         MOD("Pistol-calibre suppressor", 60, 0.3, "A 9mm / .45 can: shots half as loud, but it fouls the action (jams ×1.2). Fits 9mm and .45 guns with a threaded barrel."),
  can556:       MOD("5.56 suppressor", 90, 0.5, "A military rifle can: shots 55% as loud, +1 aim (less kick), but more fouling (jams ×1.3). Fits 5.56 and .223 rifles."),
  can308:       MOD(".308 suppressor", 110, 0.6, "A big rifle can: shots 60% as loud, but more fouling (jams ×1.3). Fits .308, 7.62×39 and .300 Blackout rifles (with subsonic .300 BLK a whisper)."),
  can12:        MOD("Shotgun suppressor", 80, 0.7, "A fat can for a 12 gauge: shots 70% as loud, −2 up close. Fits the pump and semi-auto shotguns. Very rare."),
  bottlecan:    MOD("Bottle suppressor", 1, 0.1, "A plastic bottle taped over the muzzle: shots 60% as loud, −3 aim, and it is shot through in 3 shots. Fits any gun but a shotgun or the .50. Made in the field from a bottle and a scrap.", { makeshift: true, dur: 3 }),
  solventcan:   MOD("Solvent-trap suppressor", 30, 0.5, "A cleaning kit's solvent trap drilled out into a can: shots 60% as loud, but it fouls the action (jams ×1.4). Lasts 40 shots. Fits .22, 9mm, 5.56 and .223 guns. Made at a machine shop.", { makeshift: true, dur: 40 }),
  flashhider:   MOD("Flash hider", 6, 0.1, "A birdcage on a rifle's muzzle: +1 aim, and at night the flash no longer gives the shooter away. Fits rifles."),
  recoilpad:    MOD("Recoil pad", 8, 0.2, "A thick rubber butt pad: +2 aim (+3 on a shotgun or the .50). Fits shotguns, bolt-action and lever-action rifles and the .50."),
  collapsible:  MOD("Collapsible stock", 30, 0.3, "An adjustable stock: +2 aim, +3 more up close. Fits the AR-15 family, the submachine gun, a Kalashnikov and the semi-auto shotgun."),
  precision:    MOD("Precision stock", 60, 0.8, "An adjustable marksman's stock with a cheek rest: +3 aim, +1 tile of best range, −3 up close. Fits bolt-action rifles, the AR-10 and the AR-15 family."),
  foldstock:    MOD("Folding stock", 25, 0.3, "A side-folding stock, lighter than the factory one (−0.4 kg fitted): +4 up close, −2 aim. Fits a Kalashnikov, the submachine gun and the semi-auto shotgun."),
  anglegrip:    MOD("Angled foregrip", 15, 0.1, "A short angled grip under the handguard: +1 aim, +4 more up close. Fits under an AR-15's handguard or on a rail."),
  revgrip:      MOD("Rubber revolver grips", 10, 0.05, "Finger-groove rubber grips that soak up the kick: +3 aim. Fits a revolver."),
  weaponlight:  MOD("Weapon light", 18, 0.15, "A light on the gun's rail: at night +8 aim within 6 tiles, and it lights the way like a flashlight without taking the off hand (but is seen from further off). Fits any gun with a light / laser slot."),
  peq:          MOD("Infrared laser (PEQ)", 120, 0.2, "A military infrared aiming laser, invisible without night vision: +8 aim at night for someone wearing night vision goggles. Fits any gun with a light / laser slot."),
  sling:        MOD("Rifle sling", 5, 0.15, "A two-point sling: the gun stays steady on the move, +1 aim when the shooter moved this turn. Fits any gun with a sling slot."),
  m203:         MOD("M203 grenade launcher", 160, 1.4, "A 40 mm launcher under an AR-15's barrel (it blocks a foregrip). Fires 40 mm grenades from the rifle it is fitted to (Launch: up to 16 tiles, lobbed over walls; its own round, reloaded on its own), and the rifle still shoots. Best with Shooting 6."),
  // Repairs (repair.js, section 21).
  repairkit:    { name: "Field repair kit", slot: "pack", skill: null, power: 0, req: 0, value: 25, noise: 0, dur: 5, weight: 1, cat: "tools", desc: "A roll of tools, pins, springs, patches and glue: 5 field repairs of a gun, an attachment, armour or a makeshift tool anywhere (half what a workbench restores, and twice the lost maximum). Needs the same skill as a workbench repair." },
  kevlarkit:    { name: "Kevlar repair kit", slot: "pack", skill: null, power: 0, req: 0, value: 20, noise: 0, small: true, weight: 0.5, cat: "armor", desc: "Ballistic fabric patches and stitching: one workbench repair of a soft vest (with 2 scrap). Police and military kit." },
};
