// @ts-check
// Weapons overhaul content (docs/weapons-overhaul-plan.md sections 3, 4, 13, 20, 22): new guns, melee weapons and launchers.
// Plain data that imports nothing, merged by one line each: data.js Object.assign(GEAR, GUN_GEAR), combat.js
// Object.assign(WEAPONS, GUN_WEAPONS) and the KIT_PATCH merge into KITS (each list field is appended to that kit's list).
// Owner: the roster agent (B). Keep every existing GEAR / WEAPONS key.
//
// What is here:
//   GUN_GEAR       the items (data.js GEAR): name, slot, power (combatPower), req, value, noise, kg, trade category.
//   GUN_WEAPONS    their battle numbers (combat.js WEAPONS), and the launchers' and the M2's (data only, see LATER_GEAR).
//   WEAPON_PATCH   fields added to weapons that were already there (combat.js merges them in): the melee traits below,
//                  the lever-action's tube of six.
//   GEAR_PATCH     the same for items already in data.js GEAR (a description that changed).
//   KIT_PATCH      what each kind of fighter now carries (combat.js KITS); spearThrow: they throw their spears.
//   FACTORY_FIT    the parts a gun is always (or often) found with (factoryfit.js: the sniper rifle's scope and bipod).
//   LATER_GEAR     the launchers (M79, M32, AT4, RPG) as items: merged into GEAR (data.js) in wave 2; launchers.js
//                  fires them (the M203 is a gun part, the rounds data-ammo.js boxes). The M2 is never an item.
//   ROSTER_TAGS    loot.js theme tags for every new item (where it is normally kept).
//   ROSTER_HELP    the Help topic.
//
// Guns: cal = calibre (data-ammo.js CALIBERS), cap = magazine, rel = jam % a shot for a new gun on factory rounds
// (section 14), common: false = fires typed rounds only (the .50). Automatic weapons have fire modes (section 20, R12):
// modes = { single, burst, auto }: { rounds a pull of the trigger, aim for each round }; ammo stays the default a shot.
// heavy: { mob: −1 tile an action, brace: +aim when the gun rests on half cover next to the shooter (its bipod) }; brace (a number): aim when
// the shooter DID move this turn (a big rifle snapped up off the shoulder); pierce: cover counts that many steps less.
// sniper: the enemy AI keeps its distance with it (section 22). launcher: fired by launchers.js ("launch"), never the
// shoot code (dmg: a round inside its arming range, hitting as a slug); mount: the M2 on a vehicle's turret.
//
// Melee (section 4): mclass = blade | pierce | chop | blunt | heavy (armour by class, section 2); quick = a strike costs
// 1 action instead of the turn, one strike a turn (hit and step away); stagger = chance a hit (twice on a critical) costs
// the target an action on its next turn (not brutes, wall-breakers, brood mothers or bosses); bleed = chance a hit on a
// living person bleeds them 5 at the start of each of their next 2 turns; reach: 2 = strikes 2 tiles off in a straight
// line with nobody between; throw = a spear thrown that many tiles (combat.js "throwspear"); takedown = + to a
// takedown with it (stealth.js); stab = finds a dead soldier's gap like a knife (deadsoldiers.js STAB).

const W = "weapon", SH = "shooting";
/** @type {Record<string, any>} */
export const GUN_GEAR = {
  // ---------- pistols ----------
  pistol22:    { name: ".22 target pistol",      slot: W, skill: SH, power: 2,   req: 0,  value: 18,  noise: 1, small: true, weight: 0.9, cat: "pistol",
                 desc: "A long-barrelled .22 for plinking: ten tiny rounds, barely a kick and barely a bang. Weak, but anyone can hit with it, and it hardly carries." },
  compact9:    { name: "Compact 9mm",            slot: W, skill: SH, power: 2.6, req: 1,  value: 24,  noise: 2, small: true, weight: 0.65, cat: "pistol",
                 desc: "A pocket 9mm from a glovebox or a nightstand: eight rounds, short sights. Needs Shooting 1." },
  pistol45:    { name: "1911 .45",               slot: W, skill: SH, power: 3.3, req: 3,  value: 38,  noise: 2, small: true, weight: 1.1, cat: "pistol",
                 desc: "A steel .45 automatic, seven big slow rounds: hits harder than a 9mm. Needs Shooting 3." },
  // ---------- automatic weapons ----------
  smg:         { name: "9mm submachine gun",     slot: W, skill: SH, power: 6,   req: 7,  value: 95,  noise: 2, weight: 2.9, cat: "automatic", hunt: { big: 0.5, small: 0.6 },
                 desc: "A police SWAT submachine gun: 30 rounds of 9mm, single shots, bursts or full auto. Quick up close, poor at range, hungry for ammo. Needs Shooting 7." },
  ak:          { name: "AK-pattern rifle",       slot: W, skill: SH, power: 7.5, req: 9,  value: 110, noise: 3, weight: 3.6, cat: "automatic",
                 desc: "A battered 7.62×39 rifle that never stops working: 30 rounds, single, burst or full auto, a heavy kick. Needs Shooting 9." },
  lmg:         { name: "Light machine gun",      slot: W, skill: SH, power: 9.5, req: 12, value: 240, noise: 4, weight: 8, cat: "automatic",
                 desc: "An M249 with a 100-round box: a wall of 5.56. Heavy (a tile less a move); steady on its bipod when rested on half cover next to the gunner in the line of fire (+8 aim). The best gun for overwatch. Needs Shooting 12." },
  // ---------- shotguns ----------
  dbshotgun:   { name: "Double-barrel shotgun",  slot: W, skill: SH, power: 4.5, req: 3,  value: 32,  noise: 3, weight: 3.2, cat: "shotgun",
                 desc: "Two barrels, two shells, then break it open and reload. Brutal up close and nearly never fails. Saw it short for a sawn-off. Needs Shooting 3." },
  sawnoff:     { name: "Sawn-off shotgun",       slot: W, skill: SH, power: 4,   req: 2,  value: 26,  noise: 4, weight: 2.2, cat: "shotgun",
                 desc: "A double-barrel cut down to a stub: two shells that tear anything within a couple of tiles apart, and nothing much past that. Very loud. Needs Shooting 2." },
  semishotgun: { name: "Semi-auto shotgun",      slot: W, skill: SH, power: 6,   req: 7,  value: 120, noise: 3, weight: 3.8, cat: "shotgun",
                 desc: "A police semi-automatic 12 gauge with eight in the tube: the pump's punch, fired as fast as you can pull. Needs Shooting 7." },
  // ---------- rifles ----------
  rifle22:     { name: ".22 rifle",              slot: W, skill: SH, power: 2.5, req: 0,  value: 24,  noise: 1, weight: 2.3, cat: "rifle", hunt: { big: 0.25, small: 1.1 },
                 desc: "A farm .22 for rabbits and crows: ten rounds, quiet, accurate, weak. The best small-game gun there is." },
  dmr:         { name: "Marksman rifle",         slot: W, skill: SH, power: 8,   req: 11, value: 170, noise: 3, weight: 5, cat: "rifle",
                 desc: "A semi-automatic .308 (AR-10) with a 20-round magazine: long range and hard hitting, shot after shot. Often found with a scope or a bipod. Needs Shooting 11." },
  sniper:      { name: "Bolt-action sniper rifle", slot: W, skill: SH, power: 8.5, req: 11, value: 220, noise: 3, weight: 5.5, cat: "rifle", hunt: { big: 1.25, small: 0.4 },
                 desc: "An M24-style .308 with a tactical scope and a bipod: the best long-range gun short of the .50. Five rounds; poor up close, and shaky if the shooter moved this turn (−15). Needs Shooting 11." },
  amr:         { name: ".50 anti-materiel rifle", slot: W, skill: SH, power: 10, req: 13, value: 450, noise: 6, weight: 14, cat: "rifle", hunt: { big: 0.6, small: 0.1 },
                 desc: "A .50 BMG rifle with a scope, ten rounds: goes through cover (a step less) and through people. Fires only .50 rounds. Brutally loud, 14 kg, −20 if the shooter moved this turn. Needs Shooting 13." },
  // ---------- melee ----------
  combatknife: { name: "Combat knife",           slot: W, skill: SH, power: 1.7, req: 0,  value: 18,  noise: 0, small: true, weight: 0.35, cat: "melee",
                 desc: "A military fighting knife: quick (strike and still move), +5 to hit, and its point finds the gap in a dead soldier's armour. Good for takedowns (+15)." },
  hatchet:     { name: "Hatchet",                slot: W, skill: SH, power: 1.8, req: 0,  value: 10,  noise: 0, weight: 0.8, cat: "melee", chop: 1.4,
                 desc: "A camp hatchet: quick (strike and still move), and it cuts firewood and an ice hole." },
  tomahawk:    { name: "Tomahawk",               slot: W, skill: SH, power: 2.1, req: 0,  value: 30,  noise: 0, pry: true, weight: 0.7, cat: "melee", chop: 1.3,
                 desc: "A steel tactical tomahawk with a spike: quick (strike and still move), cuts wood, and pries locks open in a raid." },
  kukri:       { name: "Kukri",                  slot: W, skill: SH, power: 2.1, req: 0,  value: 20,  noise: 0, weight: 0.6, cat: "melee", chop: 1.2,
                 desc: "A heavy curved blade: deep cuts that bleed people (35% a hit: 5 a turn for two turns)." },
  katana:      { name: "Katana",                 slot: W, skill: SH, power: 2.8, req: 3,  value: 45,  noise: 0, weight: 1.2, cat: "melee",
                 desc: "A collector's sword, sharper than it has any right to be: +5 to hit, hard hits that bleed people (30%). Needs Shooting 3 to use well." },
  pickaxe:     { name: "Pickaxe",                slot: W, skill: SH, power: 2.3, req: 1,  value: 12,  noise: 0, pry: true, weight: 3, cat: "melee",
                 desc: "A miner's pick: slow (−8 to hit) but it punches through skulls and helmets, staggers (20%), and pries locks open in a raid." },
  hammer:      { name: "Claw hammer",            slot: W, skill: SH, power: 1.1, req: 0,  value: 4,   noise: 0, small: true, weight: 0.6, cat: "melee",
                 desc: "A framing hammer from a toolbox: quick (strike and still move), fits a pocket, and a decent club for a takedown (+15)." },
  etool:       { name: "Entrenching tool",       slot: W, skill: SH, power: 1.8, req: 0,  value: 10,  noise: 0, weight: 1.1, cat: "melee", chop: 1.1,
                 desc: "An army folding shovel with a sharpened edge: chops like an axe and staggers (20%)." },
  golfclub:    { name: "Golf club",              slot: W, skill: SH, power: 1.4, req: 0,  value: 6,   noise: 0, weight: 0.5, cat: "melee",
                 desc: "A steel driver from a garage or a locker: light, staggers (20%), good for a takedown (+15)." },
};
// Durability (data.js GEAR_DUR, crafting.js wear): fights before it breaks. Guns 50–90 (the AK and the double-barrel
// last longest, the compact and the .22s the least), melee 30–70 (steel tools outlast a golf club or a sword).
const ROSTER_DUR = {
  pistol22: 55, compact9: 50, pistol45: 70, smg: 60, ak: 90, lmg: 60, dbshotgun: 80, sawnoff: 70, semishotgun: 60,
  rifle22: 65, dmr: 60, sniper: 80, amr: 70,
  combatknife: 50, hatchet: 50, tomahawk: 60, kukri: 55, katana: 40, pickaxe: 70, hammer: 60, etool: 50, golfclub: 30,
};
for (const [k, v] of Object.entries(ROSTER_DUR)) if (GUN_GEAR[k]) GUN_GEAR[k].dur = v;

/** @type {Record<string, any>} */
export const GUN_WEAPONS = {
  // ---------- pistols ----------
  pistol22:    { name: ".22 target pistol",  dmg: [10, 16], opt: 6, fall: 3,   aim: 8,  ammo: 1, noise: 1, cap: 10, cal: "22lr",  rel: 1.0 },
  compact9:    { name: "Compact 9mm",        dmg: [14, 21], opt: 5, fall: 5,   aim: 2,  ammo: 1, noise: 2, cap: 8,  cal: "9mm",   rel: 0.45 },
  pistol45:    { name: "1911 .45",           dmg: [18, 26], opt: 5, fall: 4.5, aim: 2,  ammo: 1, noise: 2, cap: 7,  cal: "45acp", rel: 0.4 },
  // ---------- automatic weapons (fire modes: section 20 R12) ----------
  smg:         { name: "9mm submachine gun", dmg: [15, 22], opt: 7, fall: 3.5, aim: 6,  ammo: 2, noise: 2, close: 4, cap: 30, cal: "9mm", rel: 0.5,
                 modes: { single: { rounds: 1, aim: 0 }, burst: { rounds: 3, aim: -6 }, auto: { rounds: 12, aim: -18 } } },
  ak:          { name: "AK-pattern rifle",   dmg: [24, 34], opt: 8, fall: 3.5, aim: 5,  ammo: 2, noise: 3, cap: 30, cal: "762x39", rel: 0.15,
                 modes: { single: { rounds: 1, aim: 0 }, burst: { rounds: 2, aim: -8 }, auto: { rounds: 10, aim: -22 } } },
  lmg:         { name: "Light machine gun",  dmg: [22, 32], opt: 8, fall: 3.5, aim: 0,  ammo: 3, noise: 4, cap: 100, cal: "556", rel: 0.9, heavy: { mob: -1, brace: 8 },
                 modes: { single: { rounds: 1, aim: 0 }, burst: { rounds: 3, aim: -4 }, auto: { rounds: 15, aim: -14 } } },
  // ---------- shotguns ----------
  dbshotgun:   { name: "Double-barrel shotgun", dmg: [26, 38], opt: 4, fall: 7,  aim: 8, ammo: 1, noise: 3, close: 12, cap: 2, cal: "12ga", rel: 0.1 },
  sawnoff:     { name: "Sawn-off shotgun",   dmg: [26, 38], opt: 2, fall: 10,  aim: 2,  ammo: 1, noise: 4, close: 18, cap: 2, cal: "12ga", rel: 0.1 },
  semishotgun: { name: "Semi-auto shotgun",  dmg: [24, 36], opt: 4, fall: 6.5, aim: 11, ammo: 1, noise: 3, close: 10, cap: 8, cal: "12ga", rel: 0.7 },
  // ---------- rifles ----------
  rifle22:     { name: ".22 rifle",          dmg: [11, 17], opt: 9,  fall: 2.5, aim: 8,  ammo: 1, noise: 1, cap: 10, cal: "22lr", rel: 1.0 },
  dmr:         { name: "Marksman rifle",     dmg: [33, 45], opt: 13, fall: 1.8, aim: 8,  ammo: 1, noise: 3, close: -8, cap: 20, cal: "308", rel: 0.6 },
  sniper:      { name: "Bolt-action sniper rifle", dmg: [35, 49], opt: 15, fall: 1.2, aim: 9, ammo: 1, noise: 3, close: -14, cap: 5, cal: "308", rel: 0.1, brace: -15, sniper: true },
  amr:         { name: ".50 anti-materiel rifle", dmg: [62, 84], opt: 16, fall: 1.2, aim: -2, ammo: 1, noise: 6, close: -20, cap: 10, cal: "50bmg", rel: 0.6, brace: -20, pierce: 1, common: false },
  // Mounted only, never an item (a military vehicle's turret, section 11: fired as combat.js turret_m2).
  m2hb:        { name: "M2 heavy machine gun", dmg: [46, 64], // (40–58 before 2026-10-10: a .50 outhits a 12 ga slug, the balance ladder)
                 opt: 14, fall: 1.5, aim: 6, ammo: 3, noise: 6, cap: 100, cal: "50bmg", rel: 0.5, common: false, mount: true, pierce: 1, // no item: bolted to a military vehicle, it fires as combat.js turret_m2
                 modes: { single: { rounds: 1, aim: 0 }, burst: { rounds: 3, aim: -4 }, auto: { rounds: 12, aim: -12 } } },
  // ---------- launchers (section 13): data only; the launcher agent (wave 2) fires them ("launch") ----------
  // dmg: a 40 mm HE round or a rocket hitting as a slug inside its arming range. range: tiles a round is sent.
  m79:         { name: "Grenade launcher",   dmg: [15, 25], opt: 12, fall: 2, aim: 0, ammo: 1, noise: 3, cap: 1, cal: "40mm", rel: 0.1, launcher: "40mm", range: 20 },
  m203:        { name: "Underbarrel grenade launcher", dmg: [15, 25], opt: 10, fall: 2, aim: -2, ammo: 1, noise: 3, cap: 1, cal: "40mm", rel: 0.1, launcher: "40mm", under: true, range: 16 },
  m32:         { name: "Revolver grenade launcher", dmg: [15, 25], opt: 12, fall: 2, aim: 0, ammo: 1, noise: 3, cap: 6, cal: "40mm", rel: 0.2, launcher: "40mm", range: 20 },
  at4:         { name: "Rocket tube",        dmg: [15, 25], opt: 10, fall: 2, aim: 0, ammo: 1, noise: 6, cap: 1, cal: "rocket", rel: 0.1, launcher: "rocket", oneShot: true, range: 14 },
  rpg:         { name: "Rocket launcher",    dmg: [15, 25], opt: 10, fall: 2, aim: -2, ammo: 1, noise: 6, cap: 1, cal: "rocket", rel: 0.3, launcher: "rocket", range: 14 },
  // ---------- melee ----------
  combatknife: { name: "Combat knife",       melee: true, dmg: [16, 24], meleeAim: 5, mclass: "pierce", quick: true, takedown: 15, stab: true },
  hatchet:     { name: "Hatchet",            melee: true, dmg: [17, 26], mclass: "chop", quick: true, takedown: 10 },
  tomahawk:    { name: "Tomahawk",           melee: true, dmg: [19, 28], mclass: "chop", quick: true, takedown: 10 },
  kukri:       { name: "Kukri",              melee: true, dmg: [19, 29], mclass: "blade", bleed: 0.35, takedown: 10 },
  katana:      { name: "Katana",             melee: true, dmg: [24, 34], meleeAim: 5, mclass: "blade", bleed: 0.3, takedown: 10 },
  pickaxe:     { name: "Pickaxe",            melee: true, dmg: [22, 34], meleeAim: -8, mclass: "pierce", stagger: 0.2, takedown: 5 },
  hammer:      { name: "Claw hammer",        melee: true, dmg: [11, 17], mclass: "blunt", quick: true, takedown: 15 },
  etool:       { name: "Entrenching tool",   melee: true, dmg: [17, 26], mclass: "chop", stagger: 0.2, takedown: 10 },
  golfclub:    { name: "Golf club",          melee: true, dmg: [14, 22], mclass: "blunt", stagger: 0.2, takedown: 15 },
};

// Fields for weapons that were already in combat.js WEAPONS (merged in after GUN_WEAPONS). Takedown values are the
// old stealth.js CLUB table's.
/** @type {Record<string, any>} */
export const WEAPON_PATCH = {
  fists:      { mclass: "blunt", takedown: 5 },
  knife:      { mclass: "blade", quick: true, takedown: 10 },
  machete:    { mclass: "blade", bleed: 0.25, takedown: 10 },
  spikedbat:  { mclass: "blunt", bleed: 0.15, takedown: 20 },
  pipespear:  { mclass: "pierce", reach: 2, throw: 4, takedown: 5 }, // the makeshift spear: a shorter throw
  spear:      { mclass: "pierce", reach: 2, throw: 5, takedown: 5 }, // the steel spear (data.js, fishing too)
  springmachete: { mclass: "blade", bleed: 0.3, takedown: 10 },
  sawmachete: { mclass: "blade", bleed: 0.3, takedown: 10 },
  bat:        { mclass: "blunt", stagger: 0.25, takedown: 20 },
  nailbat:    { mclass: "blunt", stagger: 0.2, bleed: 0.2, takedown: 15 },
  prybar:     { mclass: "blunt", takedown: 15 },
  fireaxe:    { mclass: "chop", stagger: 0.2, takedown: 10 },
  sledge:     { mclass: "heavy", stagger: 0.45, takedown: 10 },
  baton:      { mclass: "blunt", quick: true, takedown: 20 },
  leverrifle: { cap: 6 }, // section 3: a tube of six (gunmags had eight)
};
/** @type {Record<string, any>} */
export const GEAR_PATCH = {
  leverrifle: { desc: "A ranch rifle with six in the tube: accurate at range, lighter and handier than a bolt-action hunting rifle. Needs Shooting 4." },
  pipespear:  { desc: "A kitchen knife taped to a steel pipe. A makeshift spear: strikes 2 tiles off in a straight line, can be thrown up to 4 tiles (walk over it to pick it up), and spears fish in the shallows (fishing in daylight, not through ice)." },
  spear:      { desc: "A boar spear off a hunting lodge wall: a long steel head on an ash shaft. Strikes 2 tiles off in a straight line, can be thrown up to 5 tiles (Throw spear: walk over it to pick it up, or 1 action next to it; after a won fight it is picked up), and spears fish in the shallows (0.5 food an hour, best in daylight; no use through ice)." },
};

// What each kind of fighter carries now (appended to combat.js KITS lists). Soldiers' strong picks (power 7 and up,
// half the time): about 1 in 7 a light machine gun, 1 in 10 a marksman rifle and 1 in 10 a sniper rifle.
/** @type {Record<string, Record<string, any>>} */
export const KIT_PATCH = {
  raiders:   { weapons: ["compact9", "sawnoff", "dbshotgun"], strong: ["ak"], loot: ["compact9", "sawnoff", "hatchet", "kukri"] },
  soldiers:  { weapons: ["smg"], strong: ["ar", "ar", "lmg", "lmg", "lmg", "dmr", "dmr", "sniper", "sniper"], loot: ["smg", "combatknife", "etool"] },
  guards:    { weapons: ["smg", "semishotgun", "pistol45"], strong: ["semishotgun", "carbine"], loot: ["pistol45", "semishotgun"] },
  militia:   { weapons: ["rifle22", "dbshotgun", "pistol45"], loot: ["rifle22", "dbshotgun", "hatchet"] },
  survivors: { weapons: ["pistol22", "compact9", "rifle22", "dbshotgun"], loot: ["pistol22", "compact9", "hammer", "golfclub"] },
  zealots:   { weapons: ["dbshotgun", "spear"], loot: ["spear", "dbshotgun", "hatchet"], spearThrow: true },
  fighters:  { strong: ["ak", "semishotgun"], loot: ["dbshotgun", "etool"] },
};

// The parts a gun comes with wherever it is found (factoryfit.js): [chance, [part keys: one of them]] per row. A row
// whose parts do not exist yet (data-gunmods.js, agent C) or do not fit the gun is skipped. Chance 1: always (also
// where no dice are at hand); below 1 only where the source has dice of its own (raid boxes, enemy guns).
/** @type {Record<string, [number, string[]][]>} */
export const FACTORY_FIT = {
  sniper: [[1, ["tacscope"]], [1, ["bipod"]]],
  dmr:    [[0.6, ["acog", "tacscope"]], [0.4, ["bipod"]]],
  amr:    [[1, ["tacscope"]]],
};

// Army trucks (miltrucks.js truckLoot, through TRUCK_LOOT_HOOKS): the new military weapons in a truck's load, [key,
// chance] each on dice of their own (the truck's other rolls are unchanged). Wrecked trucks hold 60% as many, burnt none.
/** @type {Record<string, [string, number][]>} */
export const TRUCK_GEAR = {
  cargo:  [["smg", 0.1], ["dmr", 0.06], ["sniper", 0.04], ["lmg", 0.06], ["amr", 0.01], ["combatknife", 0.2], ["etool", 0.25], ["tomahawk", 0.03],
           ["at4", 0.04], ["m79", 0.02], ["a_40mm_he", 0.05], ["a_40mm_smoke", 0.02], ["rpg", 0.005], ["a_rocket_heat", 0.01]], // launchers (wave 2): a convoy's AT4s, a crate of 40 mm
  humvee: [["smg", 0.08], ["dmr", 0.05], ["sniper", 0.03], ["lmg", 0.06], ["combatknife", 0.15], ["etool", 0.2], ["at4", 0.03], ["a_40mm_he", 0.03]],
  mrap:   [["smg", 0.08], ["dmr", 0.05], ["sniper", 0.03], ["lmg", 0.05], ["combatknife", 0.15], ["etool", 0.15], ["at4", 0.04], ["a_40mm_he", 0.03]],
};

// The launchers as items (section 13; merged into GEAR by data.js since wave 2, fired by launchers.js). The M203 is the
// economy agent's under-barrel part (data-gunmods.js MOD_GEAR, cat gunmod); the rounds are data-ammo.js boxes
// (a_40mm_he / buck / smoke / illum, a_rocket_heat: common: false). The AT4 is its own round: fired, it is gone. The M2
// is no item at all (the user's rule): it is bolted to its military vehicle's turret (vehicles.js), fires there as
// combat.js turret_m2 (its numbers: GUN_WEAPONS m2hb), and is lost with the vehicle.
/** @type {Record<string, any>} */
export const LATER_GEAR = {
  m79:  { name: "Grenade launcher",          slot: W, skill: SH, power: 6, req: 6, value: 180, noise: 3, weight: 2.7, cat: "explosive", launcher: "40mm", dur: 70,
          desc: "A break-action 40 mm launcher (M79): one grenade at a time, lobbed up to 20 tiles over walls. HE blasts the spot it lands on (a grenade inside 3 tiles does not arm: it hits like a stone). Also takes buckshot, smoke and flares. The bearer fights with a sidearm or their fists besides. Needs Shooting 6." },
  m32:  { name: "Revolver grenade launcher", slot: W, skill: SH, power: 8, req: 8, value: 400, noise: 3, weight: 5.3, cat: "explosive", launcher: "40mm", dur: 60,
          desc: "A six-shot 40 mm launcher (M32): six grenades before a reload, lobbed up to 20 tiles. Needs Shooting 8." },
  at4:  { name: "Rocket tube",               slot: W, skill: SH, power: 7, req: 4, value: 300, noise: 6, weight: 6.7, bulky: true, cat: "explosive", launcher: "rocket",
          desc: "A single-shot rocket (AT4): the tube is the round. Fired straight at what the shooter sees (14 tiles), it breaks gates, walls, rams and vehicles. Fired, it is gone. Mind the backblast: 2 tiles behind the shooter, and never from inside a building. Needs Shooting 4." },
  rpg:  { name: "Rocket launcher",           slot: W, skill: SH, power: 8, req: 8, value: 350, noise: 6, weight: 6.3, bulky: true, cat: "explosive", launcher: "rocket", dur: 60,
          desc: "A reloadable rocket launcher (RPG): a rocket at a time, fired straight at what the shooter sees (14 tiles). Breaks gates, walls, rams and vehicles. Mind the backblast. Needs Shooting 8." },
};

// Where each new item is normally kept (loot.js ITEM_TAGS; tools/loottest.js checks every site and raid area holds
// only what fits its tags).
/** @type {Record<string, string[]>} */
export const ROSTER_TAGS = {
  pistol22: ["guns", "home", "hunt", "camp", "farm"], compact9: ["home", "guns", "travel", "crime", "police", "shop"],
  pistol45: ["guns", "police", "farm", "home", "military"], smg: ["police", "military", "guns"],
  ak: ["guns", "crime", "military"], lmg: ["military"], dbshotgun: ["farm", "hunt", "guns", "home", "outdoor"],
  sawnoff: ["crime"], semishotgun: ["police", "prison", "military", "guns"], rifle22: ["farm", "hunt", "guns", "outdoor", "home"],
  dmr: ["military", "crash"], sniper: ["military", "police"], amr: ["military", "crash"],
  combatknife: ["military", "guns", "crash"], hatchet: ["tools", "outdoor", "camp", "hunt", "garage"], tomahawk: ["military", "guns"],
  kukri: ["guns", "home", "crime", "mall"], katana: ["mall", "home", "shop"],   pickaxe: ["industry", "tools", "farm"], hammer: ["tools", "garage", "home", "industry"], etool: ["military", "camp"],
  golfclub: ["home", "sport", "garage", "mall", "shop"],
  // the launchers and the M2 (wave 2): army stock; a rocket launcher in a gang's armoury now and then
  m79: ["military", "crash"], m32: ["military"], at4: ["military", "crash"], rpg: ["military", "crime"],
};

// ---------- the arsenal of 2026-10-10 (user: over-unders, single-shots, 20 gauge, a gun for every calibre, the
// NATO / European / American guns of games like Tarkov) ----------
// Generic names (the game's style: "AK-pattern rifle", "1911 .45"); the description names the real gun it is like.
// Each one's numbers keep to its calibre's band on the damage ladder (data-ammo.js CAL_DMG, LADDER.BAND). Platforms,
// magazines and slots: data-gunmods.js WEAPON_PLATFORM / PLATFORMS, data-kit.js MAGAZINES / INTERNAL, mags.js SHELLS
// (break actions load both barrels at once, a single-shot its one). Art: an existing platform's drawing
// (data-gunmods.js PLATFORM_LIKE, ui/gunart.js) and battle sprite (GUN_SPRITE, ui/sprites.js). Where they turn up:
// ARSENAL_FINDS (gunfinds.js, its own dice), KIT_PATCH (the AI's people), TRUCK_GEAR.
/** @type {Record<string, any>} */
export const ARSENAL_GEAR = {
  // ---------- shotguns ----------
  ou12:        { name: "Over-under shotgun",     slot: W, skill: SH, power: 4.7, req: 3,  value: 70,  noise: 3, weight: 3.4, cat: "shotgun",
                 desc: "A sporting over-under 12 gauge (a Beretta or Browning-style clay gun): two barrels stacked, two shells, then break it open and load both. Better made and better balanced than a side-by-side, a touch more reach. Needs Shooting 3." },
  single12:    { name: "Single-shot shotgun",    slot: W, skill: SH, power: 3.3, req: 1,  value: 16,  noise: 3, weight: 2.6, cat: "shotgun",
                 desc: "A cheap break-open single-barrel 12 gauge (an H&R-style farm gun): one shell, then break it and load another. Light, simple, all but never fails. Needs Shooting 1." },
  pump20:      { name: "20-gauge pump shotgun",  slot: W, skill: SH, power: 4.2, req: 4,  value: 40,  noise: 3, weight: 3.0, cat: "shotgun",
                 desc: "A lighter pump-action 20 gauge (a youth or upland Remington 870 / Mossberg 500-style gun): five shells, less kick and less punch than a 12 gauge. Fires 20 gauge only. Needs Shooting 4." },
  ou20:        { name: "20-gauge over-under",    slot: W, skill: SH, power: 3.8, req: 2,  value: 55,  noise: 3, weight: 2.8, cat: "shotgun",
                 desc: "A light 20 gauge over-under for birds: two shells, break it open and load both, an easy kick. Fires 20 gauge only. Needs Shooting 2." },
  tacpump:     { name: "Police pump shotgun",    slot: W, skill: SH, power: 5.4, req: 6,  value: 70,  noise: 3, weight: 3.7, cat: "shotgun",
                 desc: "A police and military pump 12 gauge (a Mossberg 590-style gun): an extended tube of seven and one in the chamber, a heat shield and a rail for a light. Needs Shooting 6." },
  // ---------- rifles ----------
  singlerifle: { name: ".308 single-shot rifle", slot: W, skill: SH, power: 4.3, req: 3,  value: 38,  noise: 3, weight: 3.2, cat: "rifle", hunt: { big: 1.1, small: 0.4 },
                 desc: "A break-open single-shot hunting rifle in .308 (an H&R Handi-Rifle-style gun): one round, then open it and load the next. Accurate and hard-hitting, slow to fire; takes a scope mount. Needs Shooting 3." },
  lever357:    { name: "Lever-action .357 carbine", slot: W, skill: SH, power: 4.3, req: 3, value: 50,  noise: 3, weight: 2.8, cat: "rifle",
                 desc: "A short lever-action carbine in .357 Magnum (a Marlin 1894-style ranch gun): ten in the tube, light and handy, the same rounds as a .357 revolver. Needs Shooting 3." },
  m4:          { name: "Military carbine",       slot: W, skill: SH, power: 7.8, req: 9,  value: 130, noise: 3, weight: 3.4, cat: "automatic",
                 desc: "A short military 5.56 carbine (an M4): single shots, three-round bursts or full auto from a 30-round magazine; handier up close than the assault rifle, a little less reach. Needs Shooting 9." },
  hk416:       { name: "Piston carbine",         slot: W, skill: SH, power: 8.3, req: 10, value: 170, noise: 3, weight: 3.6, cat: "automatic",
                 desc: "A gas-piston 5.56 carbine (an HK416-style rifle): built like an AR but runs cleaner and jams far less. Single, burst or full auto, 30 rounds. Needs Shooting 10." },
  scarl:       { name: "Modular combat rifle",   slot: W, skill: SH, power: 8.2, req: 10, value: 175, noise: 3, weight: 3.5, cat: "automatic",
                 desc: "A special-forces 5.56 rifle (a SCAR-L-style gun): a long top rail, a folding stock, AR magazines; single, burst or full auto. Needs Shooting 10." },
  aug:         { name: "Bullpup rifle",          slot: W, skill: SH, power: 8.0, req: 9,  value: 150, noise: 3, weight: 3.6, cat: "automatic",
                 desc: "A bullpup 5.56 rifle (a Steyr AUG-style gun): the action behind the grip makes it short and quick to swing with a full-length barrel. Takes its own translucent AUG magazines (30 or 42), 5.56 or .223; single, burst or full auto. Needs Shooting 9." },
  scarh:       { name: "Battle rifle",           slot: W, skill: SH, power: 8.9, req: 12, value: 270, noise: 4, weight: 4.2, cat: "automatic",
                 desc: "A modular 7.62 NATO battle rifle (a SCAR-H-style gun): .308 hits from its own 20-round magazine, single, burst or a hard-to-hold full auto. Needs Shooting 12." },
  fal:         { name: "FAL battle rifle",       slot: W, skill: SH, power: 8.5, req: 11, value: 210, noise: 4, weight: 4.4, cat: "automatic",
                 desc: "The free world's old battle rifle (an FN FAL): .308 from its own 20- or 30-round metric FAL magazines, long and heavy; single, burst or full auto. Needs Shooting 11." },
  m1a:         { name: "M14-pattern rifle",      slot: W, skill: SH, power: 8.1, req: 10, value: 185, noise: 3, weight: 4.6, cat: "rifle", hunt: { big: 1.15, small: 0.4 },
                 desc: "A semi-automatic .308 in a wooden stock (an M1A / M14): 20 rounds from its own M14 magazines, long reach, a soldier's rifle sold to hunters and collectors. Sometimes found with a scope. Needs Shooting 10." },
  m240:        { name: "General-purpose machine gun", slot: W, skill: SH, power: 10, req: 13, value: 400, noise: 5, weight: 12.3, cat: "automatic",
                 desc: "A belt-fed 7.62 NATO machine gun (an M240): a 100-round belt of .308, heavy (a tile less a move), steady on its bipod when rested on half cover next to the gunner in the line of fire (+8 aim). Very rare. Needs Shooting 13." },
  // ---------- submachine guns and pistols ----------
  ump45:       { name: ".45 submachine gun",     slot: W, skill: SH, power: 6.1, req: 7,  value: 115, noise: 2, weight: 2.3, cat: "automatic", hunt: { big: 0.5, small: 0.6 },
                 desc: "A polymer .45 submachine gun (a UMP-style gun): 25 big slow rounds, single, burst or full auto; hits harder than the 9mm one and kicks more. Needs Shooting 7." },
  usp45:       { name: "Polymer .45 pistol",     slot: W, skill: SH, power: 3.4, req: 3,  value: 42,  noise: 2, small: true, weight: 0.9, cat: "pistol",
                 desc: "A polymer-framed .45 service pistol (an HK USP-style gun): twelve rounds of .45, a light rail, takes a suppressor. Needs Shooting 3." },
  snub357:     { name: ".357 snub-nose revolver", slot: W, skill: SH, power: 3.0, req: 2, value: 28,  noise: 3, small: true, weight: 0.65, cat: "pistol",
                 desc: "A five-shot snub-nose .357 from a nightstand or an ankle holster: easy to carry, a hard kick, poor past a few tiles. Needs Shooting 2." },
  magnum:      { name: "Magnum hand cannon",     slot: W, skill: SH, power: 3.9, req: 6,  value: 95,  noise: 3, small: true, weight: 2.0, cat: "pistol",
                 desc: "A huge gas-operated .357 Magnum pistol (a Desert Eagle-style showpiece): nine heavy rounds, a brutal kick, finicky. Rare. Needs Shooting 6." },
};
const ARSENAL_DUR = {
  ou12: 85, single12: 80, pump20: 70, ou20: 85, tacpump: 75, singlerifle: 85, lever357: 75, m4: 60, hk416: 75, scarl: 70, aug: 70,
  scarh: 70, fal: 80, m1a: 75, m240: 65, ump45: 65, usp45: 70, snub357: 80, magnum: 55,
};
for (const [k, v] of Object.entries(ARSENAL_DUR)) ARSENAL_GEAR[k].dur = v;
const AUTO_556 = { single: { rounds: 1, aim: 0 }, burst: { rounds: 2, aim: -8 }, auto: { rounds: 10, aim: -18 } };
const AUTO_308 = { single: { rounds: 1, aim: 0 }, burst: { rounds: 2, aim: -12 }, auto: { rounds: 10, aim: -26 } };
/** @type {Record<string, any>} */
export const ARSENAL_WEAPONS = {
  ou12:        { name: "Over-under shotgun",   dmg: [25, 37], opt: 5,  fall: 6.5, aim: 10, ammo: 1, noise: 3, close: 12, cap: 2,  cal: "12ga",  rel: 0.08 },
  single12:    { name: "Single-shot shotgun",  dmg: [24, 36], opt: 4,  fall: 7,   aim: 8,  ammo: 1, noise: 3, close: 10, cap: 1,  cal: "12ga",  rel: 0.05 },
  pump20:      { name: "20-gauge pump shotgun", dmg: [20, 30], opt: 4, fall: 7,   aim: 12, ammo: 1, noise: 3, close: 10, cap: 5,  cal: "20ga",  rel: 0.3 },
  ou20:        { name: "20-gauge over-under",  dmg: [21, 31], opt: 5,  fall: 6.5, aim: 12, ammo: 1, noise: 3, close: 12, cap: 2,  cal: "20ga",  rel: 0.08 },
  tacpump:     { name: "Police pump shotgun",  dmg: [24, 36], opt: 4,  fall: 7,   aim: 10, ammo: 1, noise: 3, close: 10, cap: 8,  cal: "12ga",  rel: 0.25 },
  singlerifle: { name: ".308 single-shot rifle", dmg: [34, 46], opt: 12, fall: 2, aim: 6,  ammo: 1, noise: 3, close: -8, cap: 1,  cal: "308",   rel: 0.05 },
  lever357:    { name: "Lever-action .357 carbine", dmg: [21, 31], opt: 8, fall: 3, aim: 6, ammo: 1, noise: 3, cap: 10, cal: "357", rel: 0.25 },
  m4:          { name: "Military carbine",     dmg: [21, 31], opt: 8,  fall: 3,   aim: 8,  ammo: 2, noise: 3, close: 3, cap: 30, cal: "556", rel: 0.5,
                 modes: { single: { rounds: 1, aim: 0 }, burst: { rounds: 3, aim: -6 }, auto: { rounds: 10, aim: -18 } } },
  hk416:       { name: "Piston carbine",       dmg: [22, 32], opt: 9,  fall: 3,   aim: 8,  ammo: 2, noise: 3, close: 2, cap: 30, cal: "556", rel: 0.25, modes: AUTO_556 },
  scarl:       { name: "Modular combat rifle", dmg: [22, 32], opt: 9,  fall: 3,   aim: 8,  ammo: 2, noise: 3, close: 2, cap: 30, cal: "556", rel: 0.35, modes: AUTO_556 },
  aug:         { name: "Bullpup rifle",        dmg: [22, 32], opt: 9,  fall: 3,   aim: 9,  ammo: 2, noise: 3, close: 3, cap: 30, cal: "556", rel: 0.4, modes: AUTO_556 },
  scarh:       { name: "Battle rifle",         dmg: [33, 45], opt: 11, fall: 2,   aim: 6,  ammo: 1, noise: 4, close: -2, cap: 20, cal: "308", rel: 0.4, modes: AUTO_308 },
  fal:         { name: "FAL battle rifle",     dmg: [33, 45], opt: 11, fall: 2,   aim: 5,  ammo: 1, noise: 4, close: -2, cap: 20, cal: "308", rel: 0.35, modes: AUTO_308 },
  m1a:         { name: "M14-pattern rifle",    dmg: [34, 46], opt: 12, fall: 1.8, aim: 7,  ammo: 1, noise: 3, close: -6, cap: 20, cal: "308", rel: 0.45 },
  m240:        { name: "General-purpose machine gun", dmg: [32, 44], opt: 10, fall: 2.5, aim: -2, ammo: 3, noise: 5, cap: 100, cal: "308", rel: 0.7, heavy: { mob: -1, brace: 8 },
                 modes: { single: { rounds: 1, aim: 0 }, burst: { rounds: 3, aim: -5 }, auto: { rounds: 15, aim: -16 } } },
  ump45:       { name: ".45 submachine gun",   dmg: [18, 26], opt: 6,  fall: 3.5, aim: 6,  ammo: 2, noise: 2, close: 4, cap: 25, cal: "45acp", rel: 0.4,
                 modes: { single: { rounds: 1, aim: 0 }, burst: { rounds: 2, aim: -6 }, auto: { rounds: 10, aim: -16 } } },
  usp45:       { name: "Polymer .45 pistol",   dmg: [18, 26], opt: 5,  fall: 4.5, aim: 3,  ammo: 1, noise: 2, cap: 12, cal: "45acp", rel: 0.3 },
  snub357:     { name: ".357 snub-nose revolver", dmg: [19, 28], opt: 4, fall: 6, aim: -3, ammo: 1, noise: 3, close: 4, cap: 5, cal: "357", rel: 0.05 },
  magnum:      { name: "Magnum hand cannon",   dmg: [21, 31], opt: 6,  fall: 4.5, aim: -4, ammo: 1, noise: 3, cap: 9,  cal: "357",   rel: 0.8, cals: ["357"] }, // (gas-operated: it will not cycle .38 Special, data-ammo.js CAL_ACCEPTS)
};
// Where each is normally kept (loot.js ITEM_TAGS, merged with ROSTER_TAGS).
/** @type {Record<string, string[]>} */
export const ARSENAL_TAGS = {
  ou12: ["guns", "hunt", "farm", "home", "sport"], single12: ["farm", "hunt", "home", "guns", "outdoor"], pump20: ["farm", "hunt", "guns", "home"],
  ou20: ["hunt", "guns", "farm", "home", "sport"], tacpump: ["police", "prison", "military", "guns"], singlerifle: ["hunt", "farm", "guns", "outdoor", "home"],
  lever357: ["farm", "hunt", "guns", "home", "outdoor"], m4: ["military", "crash", "guns"], hk416: ["military", "crash"], scarl: ["military", "crash"],
  aug: ["military", "police", "guns"], scarh: ["military", "crash"], fal: ["military", "guns", "crime"], m1a: ["guns", "military", "hunt"], m240: ["military"],
  ump45: ["police", "military", "guns"], usp45: ["police", "guns", "military", "home"], snub357: ["home", "police", "crime", "guns", "travel"], magnum: ["guns", "crime", "home"],
};
// ---------- more calibres of 2026-10-10 (user: "a 5.7×28 calibre with a P90, plus a Vector, G3 and FAMAS"; "add
// .44 mag ammo, revolvers, lever actions, single shot rifles") ----------
// 5.7×28 (data-ammo.js CALIBERS "57x28": a little over a 9mm a hit, through a soft vest), .44 Magnum ("44mag": over the
// .357, under the .308). Each gun takes one calibre and keeps to its band on the ladder. Merged into the arsenal's
// tables below (ARSENAL_GEAR / ARSENAL_WEAPONS / ARSENAL_TAGS), so its finds (gunfinds.js), the balance sheet and the
// tests treat them as the arsenal's. Magazines: data-kit.js CALIBRE_MAGS; platforms: data-gunmods.js (the 5.7s, the
// Vector, the G3 and the FAMAS have their own magazines); art and sprites: look-alikes (GUN_SPRITE below).
/** @type {Record<string, any>} */
export const CALIBRE_GEAR = {
  fiveseven:  { name: "5.7 pistol",             slot: W, skill: SH, power: 3.4, req: 3,  value: 70,  noise: 2, small: true, weight: 0.75, cat: "pistol",
                desc: "A light polymer pistol in 5.7×28 (an FN Five-seveN): twenty small, fast rounds that hit a little harder than a 9mm and go through a soft vest. Mild kick. Fires 5.7 only. Needs Shooting 3." },
  p90:        { name: "5.7 PDW",                slot: W, skill: SH, power: 6.8, req: 8,  value: 165, noise: 2, weight: 2.6, cat: "automatic", hunt: { big: 0.4, small: 0.6 },
                desc: "A compact bullpup personal defence weapon (an FN P90): a 50-round magazine on top, 5.7×28 that goes through soft armour, so little kick that full auto stays on target. Short reach. Military and police issue: rare. Needs Shooting 8." },
  vector:     { name: "Low-recoil .45 SMG",     slot: W, skill: SH, power: 6.6, req: 7,  value: 190, noise: 2, weight: 2.7, cat: "automatic", hunt: { big: 0.5, small: 0.6 },
                desc: "A .45 submachine gun with a recoil-soaking action (a KRISS Vector): a very high rate of fire that barely climbs, so its bursts and full auto stay on target (much less aim lost than other SMGs). Takes 13- and 25-round .45 magazines. Needs Shooting 7." },
  g3:         { name: "Roller-delayed battle rifle", slot: W, skill: SH, power: 8.5, req: 11, value: 200, noise: 4, weight: 4.4, cat: "automatic",
                desc: "A steel 7.62 NATO battle rifle with a roller-delayed action (an HK G3): .308 hits from a 20-round magazine, single, burst or a hard-to-hold full auto; runs dirty and keeps running. Needs Shooting 11." },
  famas:      { name: "High-rate bullpup rifle", slot: W, skill: SH, power: 7.9, req: 9, value: 140, noise: 3, weight: 3.6, cat: "automatic",
                desc: "A French bullpup 5.56 rifle with a carry handle (a FAMAS): short and quick, a very fast rate of fire (three-round bursts, long streams), its own 25-round magazines, fussy about them. Needs Shooting 9." },
  revolver44: { name: ".44 Magnum revolver",    slot: W, skill: SH, power: 4.0, req: 5,  value: 60,  noise: 4, weight: 1.4, cat: "pistol",
                desc: "A big six-shot .44 Magnum revolver (a Smith & Wesson Model 29): a heavy gun with a brutal kick and a huge bang, hitting harder than any other handgun. No suppressor fits it. Needs Shooting 5." },
  lever44:    { name: "Lever-action .44 carbine", slot: W, skill: SH, power: 4.8, req: 4, value: 60, noise: 3, weight: 2.9, cat: "rifle", hunt: { big: 1.0, small: 0.4 },
                desc: "A short lever-action carbine in .44 Magnum (a Marlin 1894 / Winchester 94-style gun): ten in the tube, hits like a deer rifle out to middling range. Shares rounds with a .44 revolver. Needs Shooting 4." },
  single44:   { name: ".44 single-shot rifle",  slot: W, skill: SH, power: 3.8, req: 2,  value: 32,  noise: 3, weight: 3.0, cat: "rifle", hunt: { big: 1.0, small: 0.4 },
                desc: "A break-open single-shot rifle in .44 Magnum (an H&R Handi-Rifle-style gun): one round, then open it and load the next. Cheap, light, hard-hitting; takes a scope mount. Needs Shooting 2." },
};
const CALIBRE_DUR = { fiveseven: 65, p90: 70, vector: 60, g3: 85, famas: 65, revolver44: 85, lever44: 80, single44: 85 };
for (const [k, v] of Object.entries(CALIBRE_DUR)) CALIBRE_GEAR[k].dur = v;
/** @type {Record<string, any>} */
export const CALIBRE_WEAPONS = {
  fiveseven:  { name: "5.7 pistol",           dmg: [15, 22], opt: 6,  fall: 4,   aim: 4,  ammo: 1, noise: 2, cap: 20, cal: "57x28", rel: 0.3 },
  p90:        { name: "5.7 PDW",              dmg: [16, 23], opt: 7,  fall: 3.2, aim: 7,  ammo: 2, noise: 2, close: 5, cap: 50, cal: "57x28", rel: 0.3,
                modes: { single: { rounds: 1, aim: 0 }, burst: { rounds: 3, aim: -5 }, auto: { rounds: 12, aim: -13 } } }, // little kick: auto steadier than the 9mm SMG's
  vector:     { name: "Low-recoil .45 SMG",   dmg: [18, 26], opt: 6,  fall: 3.5, aim: 6,  ammo: 2, noise: 2, close: 5, cap: 25, cal: "45acp", rel: 0.45,
                modes: { single: { rounds: 1, aim: 0 }, burst: { rounds: 2, aim: -3 }, auto: { rounds: 12, aim: -10 } } }, // the recoil-soaking action: -10 on auto (the UMP-style .45 -16)
  g3:         { name: "Roller-delayed battle rifle", dmg: [33, 45], opt: 11, fall: 2, aim: 5, ammo: 1, noise: 4, close: -2, cap: 20, cal: "308", rel: 0.2, modes: AUTO_308 },
  famas:      { name: "High-rate bullpup rifle", dmg: [22, 32], opt: 9, fall: 3,  aim: 8,  ammo: 2, noise: 3, close: 3, cap: 25, cal: "556", rel: 0.45,
                modes: { single: { rounds: 1, aim: 0 }, burst: { rounds: 3, aim: -7 }, auto: { rounds: 12, aim: -20 } } },
  revolver44: { name: ".44 Magnum revolver",  dmg: [27, 37], opt: 5,  fall: 5,   aim: -4, ammo: 1, noise: 4, cap: 6,  cal: "44mag", rel: 0.05 },
  lever44:    { name: "Lever-action .44 carbine", dmg: [28, 38], opt: 9, fall: 2.8, aim: 5, ammo: 1, noise: 3, cap: 10, cal: "44mag", rel: 0.25 },
  single44:   { name: ".44 single-shot rifle", dmg: [28, 38], opt: 9, fall: 2.5, aim: 6, ammo: 1, noise: 3, close: -4, cap: 1, cal: "44mag", rel: 0.05 },
};
/** @type {Record<string, string[]>} */
export const CALIBRE_TAGS = {
  fiveseven: ["police", "guns", "military"], p90: ["military", "police"], vector: ["police", "guns", "military"], g3: ["military", "guns", "crime"],
  famas: ["military", "guns"], revolver44: ["guns", "hunt", "home", "crime"], lever44: ["hunt", "farm", "guns", "home", "outdoor"],
  single44: ["hunt", "farm", "guns", "outdoor"],
};
Object.assign(ARSENAL_GEAR, CALIBRE_GEAR);
Object.assign(ARSENAL_WEAPONS, CALIBRE_WEAPONS);
Object.assign(ARSENAL_TAGS, CALIBRE_TAGS);
Object.assign(GUN_GEAR, ARSENAL_GEAR);
Object.assign(GUN_WEAPONS, ARSENAL_WEAPONS);
Object.assign(ROSTER_TAGS, ARSENAL_TAGS);
// The AI's people carry them too (AI parity; appended to KIT_PATCH's lists, then to combat.js KITS). Soldiers' strong
// picks keep the machine gun at about 1 in 6 and the sniper rifle 1 in 10 (tools/rostertest.js).
/** @type {Record<string, Record<string, string[]>>} */
export const ARSENAL_KITS = {
  raiders:   { weapons: ["single12", "snub357"], strong: ["fal"], loot: ["single12", "snub357"] },
  soldiers:  { weapons: ["m4", "m4", "m4"], strong: ["m4", "hk416", "scarl", "lmg", "lmg", "lmg", "scarh", "m240", "sniper", "sniper"], loot: ["m4", "tacpump"] },
  guards:    { weapons: ["tacpump", "usp45"], strong: ["aug", "ump45"], loot: ["usp45", "tacpump"] },
  militia:   { weapons: ["single12", "lever357", "pump20", "singlerifle"], strong: ["m1a"], loot: ["single12", "lever357"] },
  survivors: { weapons: ["single12", "pump20", "snub357"], loot: ["single12", "snub357", "ou20"] },
  zealots:   { weapons: ["single12"], loot: ["single12"] },
  fighters:  { weapons: ["ou12", "lever357"], strong: ["fal", "m1a"], loot: ["ou12"] },
};
for (const [kind, add] of Object.entries(ARSENAL_KITS)) {
  const k = (KIT_PATCH[kind] = KIT_PATCH[kind] || {});
  for (const [f, list] of Object.entries(add)) k[f] = [...(k[f] || []), ...list];
}
// The more-calibres guns on the AI's people (AI parity): guards the 5.7 pistol and, among their strong picks, the PDW
// and the low-recoil .45; raiders and militia the .44s and the G3; fighters the .44s, the G3 and the FAMAS.
/** @type {Record<string, Record<string, string[]>>} */
export const CALIBRE_KITS = {
  guards:    { weapons: ["fiveseven"], strong: ["p90", "vector"], loot: ["fiveseven"] },
  raiders:   { weapons: ["revolver44"], strong: ["g3"], loot: ["revolver44"] },
  militia:   { weapons: ["lever44", "single44"], strong: ["g3"], loot: ["lever44", "single44"] },
  survivors: { weapons: ["single44"], loot: ["revolver44"] },
  fighters:  { weapons: ["revolver44", "lever44"], strong: ["famas", "g3"], loot: ["lever44"] },
};
for (const [kind, add] of Object.entries(CALIBRE_KITS)) {
  const k = (KIT_PATCH[kind] = KIT_PATCH[kind] || {});
  for (const [f, list] of Object.entries(add)) k[f] = [...(k[f] || []), ...list];
}
TRUCK_GEAR.cargo.push(["m4", 0.08], ["hk416", 0.02], ["scarh", 0.015], ["m240", 0.008], ["tacpump", 0.03]);
TRUCK_GEAR.humvee.push(["m4", 0.08], ["scarl", 0.015], ["m240", 0.006]);
TRUCK_GEAR.mrap.push(["m4", 0.08], ["hk416", 0.02], ["scarh", 0.01]);
Object.assign(FACTORY_FIT, { m1a: [[0.35, ["acog", "tacscope"]]], scarh: [[0.3, ["acog", "lpvo"]]], singlerifle: [[0.3, ["scopemount"]]] });
Object.assign(FACTORY_FIT, { single44: [[0.3, ["scopemount"]]] });

// How common each gun is (user, 2026-10-10: "rarity and where it's found"), every gun the player can hold: common,
// uncommon, scarce, rare, veryrare (data-ammo.js RARITY). ARSENAL_FINDS weighs the arsenal's own finds by it.
/** @type {Record<string, string>} */
export const GUN_RARITY = {
  pistol: "common", compact9: "common", revolver: "common", pistol22: "uncommon", pistol45: "uncommon", snub357: "uncommon", usp45: "uncommon", magnum: "veryrare",
  shotgun: "common", dbshotgun: "common", single12: "common", pipegun: "common", sawnoff: "uncommon", pump20: "uncommon", ou20: "uncommon", ou12: "uncommon",
  tacpump: "uncommon", semishotgun: "scarce",
  rifle22: "common", huntrifle: "common", leverrifle: "common", singlerifle: "common", lever357: "uncommon", carbine: "uncommon", m1a: "rare",
  ar: "scarce", m4: "scarce", smg: "scarce", ak: "scarce", ump45: "rare", aug: "rare", hk416: "rare", scarl: "rare", fal: "rare", dmr: "rare", sniper: "rare",
  scarh: "veryrare", lmg: "rare", m240: "veryrare", amr: "veryrare",
  m79: "rare", at4: "rare", m32: "veryrare", rpg: "veryrare",
  // the AR platform and calibres of 2026-10-10 (AR_GEAR below): civilian ARs about as common as a lever gun, the
  // military .300 BLK rare
  ar15rifle: "uncommon", ar223: "uncommon", arpistol: "scarce", ar300: "scarce", sbr300: "rare", ardmr: "scarce",
  single556: "uncommon", single223: "common", single300: "scarce", varmint223: "uncommon", ranch223: "uncommon", snub38: "common", service38: "common",
};
// The more-calibres guns' rarity (merged into GUN_RARITY).
/** @type {Record<string, string>} */
export const CALIBRE_RARITY = { fiveseven: "scarce", p90: "rare", vector: "rare", g3: "rare", famas: "rare", revolver44: "uncommon", lever44: "uncommon", single44: "uncommon" };
Object.assign(GUN_RARITY, CALIBRE_RARITY);
// The extra-gun rolls (gunfinds.js, every roll on its own dice: nothing else found changes): which gun, the source's
// draws in the gun distribution (gundist.js, GUN_SOURCES below: site:<type>, area:<type>, trader:<type>,
// stash:<table>), weighted by FIND_W of its rarity (every gun source's rarity weight). site: the chance a search hour by
// site type; area: a raid container by area type; wares: a group's shelf a week by its type; scav: an AI scavenging
// trip's chance a loot taken (arsenal.js scavenge); stash: a gun safe's or a gun case's extra gun by its table (gunsafes.js).
export const ARSENAL_FINDS = {
  FIND_W: { common: 1, uncommon: 0.5, scarce: 0.22, rare: 0.08, veryrare: 0.025 },
  site: { gunstore: 0.06, police: 0.03, prison: 0.02, military: 0.03, crash_mil: 0.02, convoy: 0.02, airdrop: 0.01, farm: 0.02, ranch: 0.025,
          barn: 0.01, feedstore: 0.008, cabin: 0.025, lodge: 0.02, town: 0.006, city: 0.006, motel: 0.005, apartments: 0.005, truckstop: 0.004 },
  area: { gunshop: 0.08, armory: 0.07, barracks: 0.03, milwreck: 0.04, motorpool: 0.015, cabin: 0.04, farmhouse: 0.03, barn: 0.015, house: 0.006,
          cellblock: 0.008, roadcars: 0.005 },
  wares: { traders: 0.45, military: 0.35, fortress: 0.25, expansionist: 0.3, raider: 0.2, commune: 0.2, zealot: 0.08, merchants: 0.5 },
  scav: 0.25,
  stash: { cheap: 0.15, mid: 0.35, high: 0.35, highMil: 0.4, pistolcase: 0.12, riflecase: 0.15 },
};
// The battle sprite (ui/sprites.js drawWeapon) of each new gun: an existing gun's.
export const GUN_SPRITE = {
  ou12: "dbshotgun", single12: "pipegun", pump20: "shotgun", ou20: "dbshotgun", tacpump: "semishotgun", singlerifle: "huntrifle", lever357: "leverrifle",
  m4: "carbine", hk416: "ar", scarl: "ar", aug: "carbine", scarh: "dmr", fal: "dmr", m1a: "huntrifle", m240: "lmg", ump45: "smg", usp45: "pistol",
  snub357: "revolver", magnum: "pistol45",
  ar15rifle: "carbine", ar223: "carbine", arpistol: "carbine", ar300: "carbine", sbr300: "carbine", ardmr: "dmr",
  single556: "huntrifle", single223: "huntrifle", single300: "huntrifle", varmint223: "huntrifle", ranch223: "huntrifle", snub38: "revolver", service38: "revolver",
};
Object.assign(GUN_SPRITE, { fiveseven: "pistol", p90: "smg", vector: "smg", g3: "dmr", famas: "carbine", revolver44: "revolver", lever44: "leverrifle", single44: "huntrifle" });

// ---------- the gun distribution (gundist.js; user, 2026-10-10: "put the new guns in escort and contractor kits and in
// hive-crawl rewards", "add guns to all loot pools that make sense ... and items that AI groups can have") ----------
// One table says what kind of gun each one is, another what each place, person and shelf draws. A source that yields a
// gun (a site's search, a raid container, a body, a safe, an Army truck, a trader's shelf, a crawl, a kit) keeps its own
// dice and its own odds of a gun; WHICH gun comes from its draws, weighted by the gun's rarity (GUN_RARITY → FIND_W).
// A gun added later needs only its line here (and a GUN_RARITY tier) to turn up everywhere it fits.
//
// GUN_CLASS: its uses (who keeps such a gun) and its era, one list:
//   civilian  sold over the counter for the home and the range      hunting   a deer, duck or varmint gun
//   police    a duty or SWAT gun                                     military  an Army issue weapon
//   special   special forces' and contractors' picks, rare imports  makeshift a zip gun, a cut-down gun
//   surplus   a foreign or old military pattern sold on (the AK, the FAL, the M14)
//   eras: old (designs from before 1950), coldwar (1950–1989), modern (1990 on)
export const GUN_USES = ["civilian", "hunting", "police", "military", "special", "makeshift", "surplus"];
export const GUN_ERAS = ["old", "coldwar", "modern"];
/** @type {Record<string, string[]>} */
export const GUN_CLASS = {
  // pistols
  pistol22: ["civilian", "hunting", "coldwar"], compact9: ["civilian", "police", "modern"], pistol: ["civilian", "police", "military", "modern"],
  snub357: ["civilian", "police", "coldwar"], pistol45: ["civilian", "police", "military", "old"], usp45: ["police", "civilian", "special", "modern"],
  revolver: ["civilian", "police", "hunting", "coldwar"], magnum: ["civilian", "modern"],
  // shotguns
  single12: ["hunting", "civilian", "old"], pipegun: ["makeshift", "modern"], ou20: ["hunting", "civilian", "coldwar"], sawnoff: ["makeshift", "old"],
  pump20: ["hunting", "civilian", "coldwar"], dbshotgun: ["hunting", "civilian", "old"], ou12: ["hunting", "civilian", "coldwar"],
  shotgun: ["civilian", "hunting", "police", "coldwar"], tacpump: ["police", "military", "modern"], semishotgun: ["police", "military", "modern"],
  // rifles
  rifle22: ["hunting", "civilian", "old"], singlerifle: ["hunting", "old"], lever357: ["hunting", "civilian", "coldwar"], leverrifle: ["hunting", "civilian", "old"],
  huntrifle: ["hunting", "coldwar"], carbine: ["police", "military", "modern"], m1a: ["civilian", "hunting", "surplus", "coldwar"],
  dmr: ["military", "special", "modern"], sniper: ["military", "police", "coldwar"], amr: ["military", "special", "modern"],
  // automatic weapons
  smg: ["police", "special", "coldwar"], ump45: ["police", "special", "modern"], ak: ["surplus", "coldwar"], m4: ["military", "modern"],
  ar: ["military", "coldwar"], aug: ["special", "police", "coldwar"], scarl: ["special", "military", "modern"], hk416: ["special", "military", "modern"],
  fal: ["surplus", "military", "coldwar"], scarh: ["special", "military", "modern"], lmg: ["military", "coldwar"], m240: ["military", "coldwar"],
  // the AR platform and .38s (ar-platform, 2026-10-10)
  ar15rifle: ["civilian", "police", "modern"], ar223: ["civilian", "hunting", "coldwar"], arpistol: ["civilian", "modern"],
  ar300: ["civilian", "hunting", "modern"], sbr300: ["special", "military", "modern"], ardmr: ["civilian", "police", "hunting", "modern"],
  single556: ["hunting", "civilian", "modern"], single223: ["hunting", "civilian", "modern"], single300: ["hunting", "civilian", "modern"],
  varmint223: ["hunting", "coldwar"], ranch223: ["civilian", "hunting", "coldwar"], snub38: ["civilian", "police", "old"], service38: ["police", "civilian", "old"],
  // 5.7, the Vector, G3, FAMAS and the .44s (calibres-more, 2026-10-10)
  fiveseven: ["police", "special", "modern"], p90: ["special", "police", "modern"], vector: ["special", "police", "modern"],
  g3: ["surplus", "military", "coldwar"], famas: ["surplus", "military", "coldwar"],
  revolver44: ["civilian", "hunting", "coldwar"], lever44: ["hunting", "civilian", "old"], single44: ["hunting", "civilian", "old"],
};
// What each source draws: draws { use: weight } or the name of a GUN_DRAWS profile (a gun counts its best use), and optionally theme (only guns whose
// loot.js ITEM_TAGS meet these: places keep the loot audit), band (a kit's gun: only guns within ± this much power of
// the gun its list gave, the same kind first, so a fighter is as strong as before), cats (GEAR cats), era { era: × },
// tier { rarity tier: × } (a hive's deep rooms: the rare guns more often), power [lo, hi] (GEAR power).
// Places (gundist.js placeSource): "site:<type>" and "area:<type>" (or "area:<type>@police" / "@military": the
// armoury of a police station or an Army base) use PLACE_DRAWS when listed, else the draws of their loot.js theme tags
// (THEME_DRAWS, the best of each use), always with their theme tags as the theme.
/** @type {Record<string, Record<string, number>>} */
export const THEME_DRAWS = {
  guns: { civilian: 1, hunting: 1, police: 0.3, surplus: 0.5, special: 0.06 }, hunt: { hunting: 1, civilian: 0.3 }, farm: { hunting: 1, civilian: 0.5 },
  outdoor: { hunting: 1, civilian: 0.3 }, camp: { hunting: 0.6, civilian: 0.5 }, home: { civilian: 1, hunting: 0.4 }, sport: { civilian: 0.8, hunting: 0.6 },
  police: { police: 1, civilian: 0.25 }, prison: { police: 1 }, military: { military: 1, special: 0.2, police: 0.1 }, crash: { military: 1, special: 0.25 },
  crime: { civilian: 1, makeshift: 1, surplus: 0.6, police: 0.1 }, travel: { civilian: 1, hunting: 0.2 }, shop: { civilian: 0.6 },
};
// Draw profiles shared by several sources (a source's `draws` may name one: "raiders"), one place to tune them (the
// balance sheet's gun draws table edits these, THEME_DRAWS, PLACE_DRAWS and each source's own draws).
/** @type {Record<string, Record<string, number>>} */
export const GUN_DRAWS = {
  town: { civilian: 1, hunting: 0.25, makeshift: 0.15, surplus: 0.1, police: 0.1 },
  farm: { hunting: 1, civilian: 0.5 },
  woods: { hunting: 1, civilian: 0.3 },
  gunshop: { civilian: 1, hunting: 1, police: 0.3, surplus: 0.5, special: 0.06 },
  army: { military: 1, special: 0.15 },
  raiders: { civilian: 1, makeshift: 0.8, hunting: 0.6, surplus: 0.6, police: 0.15, military: 0.1 },
  soldiers: { military: 1, special: 0.25, police: 0.1 },
  guards: { police: 1, civilian: 0.6, hunting: 0.3 },
  militia: { hunting: 1, civilian: 0.8, surplus: 0.3, makeshift: 0.3 },
  fighters: { civilian: 1, hunting: 1, surplus: 0.5, police: 0.2, military: 0.15 },
  zealots: { hunting: 1, civilian: 0.8, makeshift: 0.5 },
  survivors: { civilian: 1, hunting: 0.8, makeshift: 0.3 },
  escorts: { hunting: 1, civilian: 0.8, police: 0.4, surplus: 0.2, military: 0.15 },
  contractors: { special: 1, military: 0.6, police: 0.4, civilian: 0.3, hunting: 0.2 },
};
/** @type {Record<string, Record<string, number> | string>} */
export const PLACE_DRAWS = {
  "site:gunstore": "gunshop", "site:police": { police: 1, civilian: 0.25 }, "site:prison": { police: 1 },
  "site:military": { military: 1, special: 0.2, police: 0.15 }, "site:crash_mil": { military: 1, special: 0.3 }, "site:convoy": { military: 1, special: 0.1 },
  "site:airdrop": { military: 1, special: 0.3 },
  "site:farm": "farm", "site:ranch": "farm", "site:barn": "farm", "site:feedstore": "farm",
  "site:cabin": "woods", "site:lodge": "woods", "site:ranger": "woods", "site:campground": "woods",
  "site:town": "town", "site:city": "town", "site:apartments": "town", "site:motel": "town", "site:gas": "town", "site:truckstop": "town",
  "area:gunshop": "gunshop", "area:armory": { police: 1, military: 0.6, special: 0.15 },
  "area:armory@police": { police: 1, military: 0.1, special: 0.1 }, "area:armory@military": { military: 1, special: 0.25, police: 0.15 },
  "area:barracks": { military: 1, special: 0.15 }, "area:milwreck": { military: 1, special: 0.3 }, "area:motorpool": { military: 1 }, "area:cargodrop": { military: 1, special: 0.2 },
  "area:cellblock": { police: 1, makeshift: 0.5 }, "area:cabin": "woods", "area:farmhouse": "farm", "area:barn": "farm",
  "area:house": { civilian: 1, hunting: 0.4 }, "area:roadcars": { civilian: 1, hunting: 0.3 },
};
// band 0.6: a fighter's gun (kits) within ± 0.6 GEAR power of the gun the kit's list gave.
/** @type {Record<string, any>} */
export const GUN_SOURCES = {
  // ---- the people with a kit (combat.js KITS by kind: enemyUnit's gun, arsenal.js's starting kits, newcomers, a
  // group's own gunsmith and its buying; escorts.js GUARD_KIT for a caravan's guards; rescueraid.js's armoury): within the band ----
  "kit:raiders": { draws: "raiders", band: 0.6 }, "kit:soldiers": { draws: "soldiers", band: 0.6 }, "kit:zealots": { draws: "zealots", band: 0.6 },
  "kit:fighters": { draws: "fighters", band: 0.6 }, "kit:guards": { draws: "guards", band: 0.6 }, "kit:militia": { draws: "militia", band: 0.6 },
  "kit:escorts": { draws: "escorts", band: 0.6 }, "kit:contractors": { draws: "contractors", band: 0.6, era: { modern: 1, coldwar: 0.5, old: 0.2 } },
  "kit:survivors": { draws: "survivors", band: 0.6 },
  // ---- the spare gear on their bodies (KITS loot): any gun they would keep ----
  "body:raiders": { draws: "raiders" }, "body:soldiers": { draws: "soldiers" }, "body:zealots": { draws: "zealots" },
  "body:fighters": { draws: "fighters" }, "body:guards": { draws: "guards" }, "body:militia": { draws: "militia" },
  "body:escorts": { draws: "escorts" }, "body:contractors": { draws: "contractors", era: { modern: 1, coldwar: 0.5, old: 0.2 } }, "body:survivors": { draws: "survivors" },
  "body:deadsoldier": { draws: { military: 1 }, band: 0.6 }, // deadsoldiers.js: the armoured dead's rifle (an Army rifle like it)
  // ---- shelves: a group's wares by its type (trade.js WARES, gunfinds.js gunWares), a visiting arms dealer, a job's pay ----
  "trader:traders": { draws: { civilian: 1, hunting: 1, police: 0.3, surplus: 0.3 } }, "trader:military": { draws: { military: 1, special: 0.2, police: 0.2 } },
  "trader:fortress": { draws: { police: 1, military: 0.5, civilian: 0.3 } }, "trader:expansionist": { draws: { civilian: 1, police: 0.6, military: 0.4, surplus: 0.4 } },
  "trader:raider": { draws: "raiders" }, "trader:commune": { draws: { hunting: 1, civilian: 0.4 } }, "trader:zealot": { draws: { hunting: 1, civilian: 0.6 } },
  "trader:merchants": { draws: { civilian: 1, hunting: 1, police: 0.5, surplus: 0.6, military: 0.2, special: 0.1 } },
  // ---- gun safes and gun cases (gunsafes.js GUN_STASH by table) ----
  "stash:cheap": { draws: { hunting: 1, civilian: 0.6 } }, "stash:mid": { draws: { civilian: 1, hunting: 1, surplus: 0.3, police: 0.2 } },
  "stash:high": { draws: { police: 1, civilian: 0.2 } }, "stash:highMil": { draws: { military: 1, special: 0.2 } },
  "stash:pistolcase": { draws: { civilian: 1, police: 0.5 }, cats: ["pistol"] }, "stash:riflecase": { draws: { hunting: 1, civilian: 0.6 }, cats: ["rifle", "shotgun"] },
  // a case at a police station, a prison or an Army site (gunsafes.js: @service) holds a service gun too
  "stash:pistolcase@service": { draws: { police: 1, civilian: 0.6, military: 0.3 }, cats: ["pistol"] }, "stash:riflecase@service": { draws: { hunting: 1, police: 0.8, civilian: 0.5, military: 0.4 }, cats: ["rifle", "shotgun"] },
  // locked containers in a raid or a search (locks.js LOCK_LOOT by lock kind): a gun cage, a police evidence room, a
  // cash box, a locked car, a crashed helicopter's locker
  "lock:guns": { draws: { civilian: 1, hunting: 0.8, police: 0.3, surplus: 0.3 } }, "lock:evidence": { draws: { civilian: 1, makeshift: 0.6, police: 0.4, surplus: 0.4 } },
  "lock:cash": { draws: { civilian: 1 } }, "lock:car": { draws: { civilian: 1, hunting: 0.3 } }, "lock:crash": { draws: "army" },
  // ---- Army trucks (miltrucks.js TRUCK_LOOT by kind) and a crashed Humvee (events.js) ----
  "truck:cargo": { draws: "army" }, "truck:humvee": { draws: "army" }, "truck:mrap": { draws: "army" },
  // ---- the hive crawl (hivecrawl.js): the bones of its dead (anything they carried), the core's hoard by the hive's
  // tier (the pools' power bands), and the deep rooms' rare finds (HIVE_GUNS) ----
  "hive:bones": { draws: { civilian: 1, hunting: 1, police: 0.5, military: 0.3, surplus: 0.3, makeshift: 0.2 } },
  "hive:hoard1": { draws: { civilian: 1, hunting: 1, police: 0.6, surplus: 0.3, makeshift: 0.3 }, power: [0, 5.6] },
  "hive:hoard2": { draws: { police: 1, military: 1, civilian: 0.6, surplus: 0.6, special: 0.3 }, power: [5.4, 8.6] },
  "hive:hoard3": { draws: { military: 1, special: 0.6, surplus: 0.4, police: 0.3 }, power: [7.5, 99] },
  "hive:deep": { draws: { military: 1, special: 1, police: 0.6, surplus: 0.6, civilian: 0.3 }, power: [5.5, 99], tier: { scarce: 1.5, rare: 4, veryrare: 6 } },
  // ---- a city crawl's raiders' sentry (citycrawl.js) ----
  "city:sentry": { draws: "raiders" },
  // ---- the people who join you: a recruit's own gun (recruits.js), Hardcore's grab from the house (hardcore-start.js
  // WEAPONS, a background's own list: hc:<background>), the prepper's go-bag; within the band ----
  "recruit": { draws: "survivors", band: 0.6 }, "hc:home": { draws: { civilian: 1, hunting: 0.5 }, band: 0.6 }, "hc:prepper": { draws: { civilian: 1, hunting: 0.7, surplus: 0.3 }, band: 0.6 },
  "hc:veteran": { draws: { civilian: 1, surplus: 0.5, hunting: 0.4 }, band: 0.6 }, "hc:farmer": { draws: { hunting: 1, civilian: 0.5 }, band: 0.6 },
  "hc:hunter": { draws: { hunting: 1, civilian: 0.3 }, band: 0.6 }, "hc:police": { draws: { police: 1, civilian: 0.4 }, band: 0.6 },
};
// The deep rooms of a hive (hivecrawl.js bones rooms): from layer `from` on, a rare gun among the bones at p + perLayer a
// layer deeper (hive:deep; its own dice), and in the core's hoard at hoard + hoardTier × the hive's tier.
// When each gun came into the game (a date, YYYY-MM-DD), and the newness factor of the extra-gun rolls (gunfinds.js
// only: a search hour's, a raid container's, a shelf's, a safe's, a crawl room's extra gun; never a list's swap or a
// kit, so no fight changes): a gun added on or after GUN_NEWNESS.from is mult × as likely there, so new guns turn up
// more often for a while. Move `from` on (or set mult 1) to retire it. A gun with no date counts as old.
/** @type {Record<string, string>} */
export const GUN_ADDED = {
  // the weapons overhaul's roster (2026-10-07)
  pistol22: "2026-10-07", compact9: "2026-10-07", pistol45: "2026-10-07", smg: "2026-10-07", ak: "2026-10-07", lmg: "2026-10-07", dbshotgun: "2026-10-07",
  sawnoff: "2026-10-07", semishotgun: "2026-10-07", rifle22: "2026-10-07", dmr: "2026-10-07", sniper: "2026-10-07", amr: "2026-10-07",
  // the arsenal of 2026-10-10
  ou12: "2026-10-10", single12: "2026-10-10", pump20: "2026-10-10", ou20: "2026-10-10", tacpump: "2026-10-10", singlerifle: "2026-10-10", lever357: "2026-10-10",
  m4: "2026-10-10", hk416: "2026-10-10", scarl: "2026-10-10", aug: "2026-10-10", scarh: "2026-10-10", fal: "2026-10-10", m1a: "2026-10-10", m240: "2026-10-10",
  ump45: "2026-10-10", usp45: "2026-10-10", snub357: "2026-10-10", magnum: "2026-10-10",
  // the AR platform and the .38s (2026-10-10)
  ar15rifle: "2026-10-10", ar223: "2026-10-10", arpistol: "2026-10-10", ar300: "2026-10-10", sbr300: "2026-10-10", ardmr: "2026-10-10", single556: "2026-10-10",
  single223: "2026-10-10", single300: "2026-10-10", varmint223: "2026-10-10", ranch223: "2026-10-10", snub38: "2026-10-10", service38: "2026-10-10",
  // more calibres (2026-10-10)
  fiveseven: "2026-10-10", p90: "2026-10-10", vector: "2026-10-10", g3: "2026-10-10", famas: "2026-10-10", revolver44: "2026-10-10", lever44: "2026-10-10", single44: "2026-10-10",
};
export const GUN_NEWNESS = { mult: 1.5, from: "2026-10-10" };
export const HIVE_GUNS = { from: 3, p: 0.06, perLayer: 0.05, max: 0.35, hoard: 0.1, hoardTier: 0.08 };
// ---------- the AR platform and calibres of 2026-10-10 (user: "AR-15 and other AR platform guns that use STANAG mags
// shooting 5.56, .223 or 300 blackout"; ".223 guns that only take .223"; "300 blackout guns"; "single-shot rifles for
// .308, 5.56, .223, .44 Mag, 300 blackout"; ".38 Special as its own revolver calibre") ----------
// Which rounds each takes: data-ammo.js CAL_ACCEPTS (a 5.56 gun fires .223 too, a .223 gun refuses 5.56, a .300 BLK gun
// takes only .300 BLK; a .357 fires .38 Special). The AR-15 pattern guns are the ar15 platform (STANAG magazines,
// every AR part: data-gunmods.js WEAPON_PLATFORM); the ranch rifle takes its own magazines (data-kit.js mag_mini14_*).
// Placeholder art (GUN_SPRITE, the platform's drawing) and voices (ui/gunsfx.js) until the gun-art branch draws them.
/** @type {Record<string, any>} */
export const AR_GEAR = {
  ar15rifle:  { name: "AR-15 rifle",            slot: W, skill: SH, power: 7.0, req: 7,  value: 105, noise: 3, weight: 3.0, cat: "rifle", hunt: { big: 0.8, small: 0.6 },
                desc: "A civilian semi-automatic AR-15 (a 16-inch 5.56 rifle off a gun store wall or out of a closet): one round a pull from a 30-round STANAG magazine, light and accurate, takes every AR part. Chambered in 5.56, it fires .223 too (a touch lighter, a touch straighter). Needs Shooting 7." },
  ar223:      { name: "AR-15 rifle (.223)",     slot: W, skill: SH, power: 6.6, req: 6,  value: 85,  noise: 3, weight: 3.1, cat: "rifle", hunt: { big: 0.7, small: 0.8 },
                desc: "An older sporting AR-15 whose barrel is marked .223 Remington (a varmint or target rifle): STANAG magazines and every AR part, but .223 only: 5.56 runs too hot for its chamber and is refused. Needs Shooting 6." },
  arpistol:   { name: "AR pistol",              slot: W, skill: SH, power: 6.0, req: 6,  value: 85,  noise: 4, weight: 2.5, cat: "rifle",
                desc: "A 10.5-inch 5.56 AR with a pistol brace for a stock: short and quick through a doorway, loud, a little less reach. STANAG magazines, every AR part; fires .223 too. Needs Shooting 6." },
  ar300:      { name: ".300 Blackout carbine",  slot: W, skill: SH, power: 7.2, req: 8,  value: 130, noise: 3, weight: 3.0, cat: "rifle", hunt: { big: 1.0, small: 0.5 },
                desc: "An AR-15 in .300 Blackout (a hog hunter's carbine): a heavier bullet out of the same STANAG magazines, harder hits close in, drops sooner past 8 tiles. Subsonic rounds through a suppressor are barely a cough. .300 BLK only: never 5.56 or .223. Needs Shooting 8." },
  sbr300:     { name: "Suppressed .300 BLK carbine", slot: W, skill: SH, power: 7.8, req: 9, value: 230, noise: 3, weight: 3.1, cat: "automatic",
                desc: "A short-barrelled .300 Blackout AR (an MCX- or Honey Badger-style special-forces gun) found with a suppressor on it: single, burst or full auto from STANAG magazines, and with subsonic rounds quieter than any rifle. .300 BLK only. Rare. Needs Shooting 9." },
  ardmr:      { name: "AR marksman rifle",      slot: W, skill: SH, power: 7.8, req: 9,  value: 165, noise: 3, weight: 4.3, cat: "rifle", hunt: { big: 0.9, small: 0.6 },
                desc: "A heavy 20-inch AR-15 with a match barrel (a .223 Wylde chamber: 5.56 or .223 alike) and a free-floated handguard: semi-automatic, long reach, 20-round STANAG magazines. Often found with a scope or a bipod. Needs Shooting 9." },
  single556:  { name: "5.56 single-shot rifle", slot: W, skill: SH, power: 3.6, req: 2,  value: 32,  noise: 3, weight: 3.0, cat: "rifle", hunt: { big: 0.75, small: 0.8 },
                desc: "A break-open single-shot rifle in 5.56 (an H&R Handi-Rifle-style gun): one round, then open it and load the next. Light, accurate, all but never fails; fires .223 too. Takes a scope mount. Needs Shooting 2." },
  single223:  { name: ".223 single-shot rifle", slot: W, skill: SH, power: 3.4, req: 2,  value: 28,  noise: 3, weight: 3.0, cat: "rifle", hunt: { big: 0.7, small: 0.9 },
                desc: "A break-open single-shot varmint rifle in .223 Remington: one round at a time, accurate, made for coyotes and groundhogs. .223 only: 5.56 is refused. Takes a scope mount. Needs Shooting 2." },
  single300:  { name: ".300 BLK single-shot rifle", slot: W, skill: SH, power: 3.8, req: 2, value: 36, noise: 3, weight: 2.9, cat: "rifle", hunt: { big: 0.95, small: 0.5 },
                desc: "A break-open single-shot rifle in .300 Blackout with a threaded muzzle: one heavy round at a time, made to wear a suppressor with subsonic rounds. .300 BLK only. Needs Shooting 2." },
  varmint223: { name: ".223 varmint rifle",     slot: W, skill: SH, power: 5.4, req: 4,  value: 70,  noise: 3, weight: 4.0, cat: "rifle", hunt: { big: 0.75, small: 1.0 },
                desc: "A heavy-barrelled bolt-action .223 (a Remington 700 varmint-style rifle): five in its internal box, the straightest-shooting light rifle there is. .223 only: 5.56 is refused. Takes a scope and a bipod. Needs Shooting 4." },
  ranch223:   { name: "Ranch rifle",            slot: W, skill: SH, power: 6.2, req: 5,  value: 75,  noise: 3, weight: 2.9, cat: "rifle", hunt: { big: 0.7, small: 0.8 },
                desc: "A Mini-14-style semi-automatic ranch rifle in .223 Remington: a wooden stock, its own 20- or 30-round magazines, light and handy around a farm. .223 only: 5.56 is refused. Needs Shooting 5." },
  snub38:     { name: ".38 snub-nose revolver", slot: W, skill: SH, power: 2.6, req: 1,  value: 20,  noise: 3, small: true, weight: 0.55, cat: "pistol",
                desc: "A five-shot .38 Special snub-nose (a J-frame from a purse or a nightstand): light, easy to hide, a modest kick. .38 Special only (a .357 round is too long for its cylinder). Needs Shooting 1." },
  service38:  { name: ".38 service revolver",   slot: W, skill: SH, power: 3.0, req: 2,  value: 26,  noise: 3, small: true, weight: 0.95, cat: "pistol",
                desc: "A six-shot .38 Special police revolver with a four-inch barrel (a Model 10-style service gun): steady, forgiving, takes a speedloader. .38 Special only. Needs Shooting 2." },
};
const AR_DUR = {
  ar15rifle: 65, ar223: 65, arpistol: 60, ar300: 65, sbr300: 60, ardmr: 65, single556: 85, single223: 85, single300: 85, varmint223: 80, ranch223: 75,
  snub38: 80, service38: 85,
};
for (const [k, v] of Object.entries(AR_DUR)) AR_GEAR[k].dur = v;
/** @type {Record<string, any>} */
export const AR_WEAPONS = {
  ar15rifle:  { name: "AR-15 rifle",            dmg: [22, 30], opt: 9,  fall: 3,   aim: 8,  ammo: 1, noise: 3, close: 2,  cap: 30, cal: "556",    rel: 0.45 },
  ar223:      { name: "AR-15 rifle (.223)",     dmg: [21, 28], opt: 10, fall: 2.6, aim: 8,  ammo: 1, noise: 3, close: 1,  cap: 20, cal: "223",    rel: 0.4 },
  arpistol:   { name: "AR pistol",              dmg: [20, 28], opt: 7,  fall: 3.5, aim: 5,  ammo: 1, noise: 4, close: 5,  cap: 30, cal: "556",    rel: 0.55 },
  ar300:      { name: ".300 Blackout carbine",  dmg: [23, 32], opt: 8,  fall: 3.2, aim: 7,  ammo: 1, noise: 3, close: 3,  cap: 30, cal: "300blk", rel: 0.45 },
  sbr300:     { name: "Suppressed .300 BLK carbine", dmg: [22, 31], opt: 7, fall: 3.5, aim: 7, ammo: 2, noise: 3, close: 5, cap: 30, cal: "300blk", rel: 0.5, modes: AUTO_556 },
  ardmr:      { name: "AR marksman rifle",      dmg: [24, 33], opt: 12, fall: 2,   aim: 10, ammo: 1, noise: 3, close: -6, cap: 20, cal: "556",    rel: 0.4 },
  single556:  { name: "5.56 single-shot rifle", dmg: [22, 31], opt: 10, fall: 2.6, aim: 8,  ammo: 1, noise: 3, close: -4, cap: 1,  cal: "556",    rel: 0.05 },
  single223:  { name: ".223 single-shot rifle", dmg: [21, 29], opt: 11, fall: 2.4, aim: 8,  ammo: 1, noise: 3, close: -4, cap: 1,  cal: "223",    rel: 0.05 },
  single300:  { name: ".300 BLK single-shot rifle", dmg: [23, 33], opt: 9, fall: 3, aim: 6, ammo: 1, noise: 3, close: -2, cap: 1,  cal: "300blk", rel: 0.05 },
  varmint223: { name: ".223 varmint rifle",     dmg: [21, 29], opt: 13, fall: 1.6, aim: 9,  ammo: 1, noise: 3, close: -10, cap: 5, cal: "223",    rel: 0.1, brace: -6 },
  ranch223:   { name: "Ranch rifle",            dmg: [20, 28], opt: 9,  fall: 3,   aim: 6,  ammo: 1, noise: 3, close: 2,  cap: 20, cal: "223",    rel: 0.35 },
  snub38:     { name: ".38 snub-nose revolver", dmg: [15, 22], opt: 4,  fall: 6,   aim: -1, ammo: 1, noise: 3, close: 4,  cap: 5,  cal: "38spl",  rel: 0.05 },
  service38:  { name: ".38 service revolver",   dmg: [16, 24], opt: 5,  fall: 5,   aim: 1,  ammo: 1, noise: 3, cap: 6,  cal: "38spl",  rel: 0.05 },
};
// Where each is normally kept (loot.js ITEM_TAGS): civilian ARs in gun stores, homes and police armouries; the
// military .300 BLK in army stock; the varmint and ranch guns on farms.
/** @type {Record<string, string[]>} */
export const AR_TAGS = {
  ar15rifle: ["guns", "home", "police", "crime", "farm"], ar223: ["guns", "home", "farm", "hunt"], arpistol: ["guns", "crime", "home"],
  ar300: ["guns", "hunt", "home"], sbr300: ["military", "crash"], ardmr: ["guns", "police", "military", "hunt"],
  single556: ["hunt", "farm", "guns", "home", "outdoor"], single223: ["hunt", "farm", "guns", "outdoor", "home"], single300: ["hunt", "guns", "farm"],
  varmint223: ["hunt", "farm", "guns"], ranch223: ["farm", "guns", "home", "hunt", "outdoor"],
  snub38: ["home", "police", "crime", "guns", "travel"], service38: ["police", "home", "guns", "prison", "farm"],
};
// The AI's people carry them too (AI parity: appended to KIT_PATCH, then to combat.js KITS).
/** @type {Record<string, Record<string, string[]>>} */
export const AR_KITS = {
  raiders:   { weapons: ["arpistol", "snub38"], strong: ["ar15rifle"], loot: ["snub38", "arpistol"] },
  guards:    { weapons: ["service38", "ar15rifle"], strong: ["ardmr"], loot: ["service38", "ar15rifle"] },
  militia:   { weapons: ["ar223", "ranch223", "single223", "varmint223"], strong: ["ar300"], loot: ["ranch223", "single223"] },
  survivors: { weapons: ["snub38", "single556", "ranch223"], loot: ["snub38", "single223", "single300"] },
  zealots:   { weapons: ["service38"], loot: ["service38"] },
  fighters:  { weapons: ["ar15rifle"], strong: ["ar300", "ardmr"], loot: ["ar15rifle"] },
  soldiers:  { strong: ["sbr300"] },
};
Object.assign(ARSENAL_GEAR, AR_GEAR); // (the arsenal's finds, gunfinds.js, roll them too)
Object.assign(ARSENAL_TAGS, AR_TAGS);
Object.assign(GUN_GEAR, AR_GEAR);
Object.assign(GUN_WEAPONS, AR_WEAPONS);
Object.assign(ROSTER_TAGS, AR_TAGS);
for (const [kind, add] of Object.entries(AR_KITS)) {
  const k = (KIT_PATCH[kind] = KIT_PATCH[kind] || {});
  for (const [f, list] of Object.entries(add)) k[f] = [...(k[f] || []), ...list];
}
TRUCK_GEAR.cargo.push(["sbr300", 0.01]);
TRUCK_GEAR.humvee.push(["sbr300", 0.008]);
Object.assign(FACTORY_FIT, { sbr300: [[1, ["can308"]]], ardmr: [[0.6, ["acog", "lpvo"]], [0.3, ["bipod"]]], varmint223: [[0.5, ["tacscope"]], [0.3, ["bipod"]]] });

// The Help topic (ui/help.js, after "Gun attachments").
export const ROSTER_HELP = `<b>Guns.</b> Pistols: the .22 target pistol (quiet, weak, easy to hit with), the compact 9mm (8 rounds), the 9mm
  (15), the 1911 .45 (7 big rounds) and the .357 revolver. Shotguns: the pump, the double-barrel (2 shells, nearly never
  fails), the sawn-off (brutal within two tiles, useless past four) and the semi-automatic (8 shells). Rifles: the .22
  rifle (rabbits and crows), the lever-action (6 in the tube), the hunting rifle, the marksman rifle (a 20-round .308,
  often found with a scope or a bipod), the bolt-action sniper rifle (always with a tactical scope and a bipod: the best
  long gun short of the .50, −15 if the shooter moved this turn) and the .50 anti-materiel rifle (through cover and
  through people, .50 rounds only, −20 if moved). Automatic weapons (the submachine gun, the AK, the assault rifle and the
  light machine gun) fire single shots, bursts or full auto. The machine gun is heavy (a tile less a move) and steady when
  its bipod rests on half cover next to the gunner in the line of fire (+8; the .50's built-in bipod the same). Every gun fires its own calibre.
  <br><b>More guns.</b> Over-under shotguns (12 and 20 gauge: two shells, both loaded at once), the single-shot shotgun and
  the .308 single-shot rifle (one round a Reload), a 20 gauge pump, the police pump (eight shells), the lever-action .357
  carbine, the military carbine, the piston carbine, the modular and bullpup 5.56 rifles, the .308 battle rifles (FAL,
  the modular one, the M14-pattern), the .45 SMG and pistol, the snub-nose and the Magnum hand cannon, and a belt-fed
  .308 machine gun. The rarer the gun, the fewer places keep one. In 5.7×28: a pistol (20 rounds) and the PDW (a
  50-round top magazine, steady on full auto); both go through soft vests. The low-recoil .45 SMG (bursts and full auto
  that barely climb), the roller-delayed .308 battle rifle (G3) and the high-rate bullpup 5.56 (FAMAS, 25-round
  magazines). In .44 Magnum: a six-shot revolver, a lever-action carbine (ten in the tube) and a single-shot rifle.
  <br><b>AR-15s, .223, .300 Blackout and .38 Special.</b> Civilian AR-15s (5.56; an older one marked .223), an AR
  pistol, a .300 Blackout carbine and a suppressed .300 BLK short rifle, an AR marksman rifle: every AR takes STANAG
  magazines and the AR's parts. .223 Remington is a civilian round, about as common as 5.56: it fires from any 5.56 gun
  and loads in STANAG magazines, hits a touch lighter but shoots a touch straighter (+3 aim). A gun chambered in .223
  (the varmint rifle, the ranch rifle, the .223 AR, the .223 single-shot) refuses 5.56: too hot for it. .300 Blackout
  fits the same magazines but never a 5.56 or .223 barrel (refused: it would blow the gun apart); subsonic .300 BLK
  through a suppressor is barely a cough. A .357 revolver or lever gun fires .38 Special too (a little lighter); a .38
  revolver takes .38 only. Single-shot rifles come in .308, 5.56, .223, .300 BLK and .44 Magnum. The AUG, the FAL, the M14 and the
  SCAR-H each take their own magazines.
  <br><b>How hard rounds hit.</b> From weakest to strongest: .22, 9mm, 5.7×28, .38 Special, .45, .357, .223, 20 gauge
  buckshot, 5.56, .300 Blackout, 7.62×39, 12 gauge buckshot, .44 Magnum, .30-30, .308, a 12 gauge slug, .50 BMG.
  Buckshot spreads: full damage out to 4 tiles, then less each tile (60% at 8, 40% from 10; birdshot sooner); a slug
  keeps its damage. Hollow and soft points hit harder on the unarmoured, AP
  goes through armour; a slug hits harder than a .308 but goes through less. 5.56, .308, .22, 9mm and 12 gauge are the
  rounds found most; the stronger and the special rounds are rarer and dearer.
  <br><b>Melee.</b> Quick weapons (knives, the hatchet, the tomahawk, the hammer, the baton) strike for 1 action instead of the
  turn: strike, then step away (one strike a turn). Clubs and heavy weapons can stagger (the target loses an action next
  turn; not brutes or bosses); blades can make people bleed (5 a turn for two turns). Spears strike 2 tiles off in a
  straight line with nobody between, and can be thrown up to 5 tiles (Throw spear: the spear's damage on whoever is where
  it lands, a tile off now and then like any throw). A thrown spear lies where it lands: walk over it to pick it up again
  (or 1 action next to it); until then the thrower fights with a pistol from a pocket or bare hands. After a won fight it
  is picked up. Zealots throw spears too. Clubs (bats, batons, golf clubs, hammers) are best for takedowns.
  <br><b>The Melee skill.</b> How well someone fights hand to hand, with any melee weapon, bare hands or a gun swung as
  a club: 75% to hit at Melee 5, 2% more or less a point (65% at 0, 85% at 10, 95% at most), melee damage 3% more or
  less a point (× 0.85 at 0, × 1.15 at 10), takedowns 1% a point; a melee weapon's own "Needs" go by Melee, and by the
  numbers someone holding one fights by their Melee where a gunman fights by Shooting. It grows in battle (a swing, a
  blow landed, a melee kill; takedowns and thrown spears too) and from fights by the numbers with a melee weapon in hand,
  and has perks at 5, 10 and 15 like every skill (Heavy Hands or Parry, Butcher or Knockout Artist, Bonebreaker or Pit
  Fighter). Volunteers from other groups have it too, by their group's ways.`;
