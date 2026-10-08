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
  rifle22:     { name: ".22 rifle",          dmg: [12, 18], opt: 9,  fall: 2.5, aim: 8,  ammo: 1, noise: 1, cap: 10, cal: "22lr", rel: 1.0 },
  dmr:         { name: "Marksman rifle",     dmg: [27, 37], opt: 13, fall: 1.8, aim: 8,  ammo: 1, noise: 3, close: -8, cap: 20, cal: "308", rel: 0.6 },
  sniper:      { name: "Bolt-action sniper rifle", dmg: [30, 40], opt: 15, fall: 1.2, aim: 9, ammo: 1, noise: 3, close: -14, cap: 5, cal: "308", rel: 0.1, brace: -15, sniper: true },
  amr:         { name: ".50 anti-materiel rifle", dmg: [62, 84], opt: 16, fall: 1.2, aim: -2, ammo: 1, noise: 6, close: -20, cap: 10, cal: "50bmg", rel: 0.6, brace: -20, pierce: 1, common: false },
  // Mounted only, never an item (a military vehicle's turret, section 11: fired as combat.js turret_m2).
  m2hb:        { name: "M2 heavy machine gun", dmg: [40, 58], opt: 14, fall: 1.5, aim: 6, ammo: 3, noise: 6, cap: 100, cal: "50bmg", rel: 0.5, common: false, mount: true, pierce: 1, // no item: bolted to a military vehicle, it fires as combat.js turret_m2
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
  <br><b>Melee.</b> Quick weapons (knives, the hatchet, the tomahawk, the hammer, the baton) strike for 1 action instead of the
  turn: strike, then step away (one strike a turn). Clubs and heavy weapons can stagger (the target loses an action next
  turn; not brutes or bosses); blades can make people bleed (5 a turn for two turns). Spears strike 2 tiles off in a
  straight line with nobody between, and can be thrown up to 5 tiles (Throw spear: the spear's damage on whoever is where
  it lands, a tile off now and then like any throw). A thrown spear lies where it lands: walk over it to pick it up again
  (or 1 action next to it); until then the thrower fights with a pistol from a pocket or bare hands. After a won fight it
  is picked up. Zealots throw spears too. Clubs (bats, batons, golf clubs, hammers) are best for takedowns.`;
