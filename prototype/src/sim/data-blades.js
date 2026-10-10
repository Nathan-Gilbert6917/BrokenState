// @ts-check
// Knives and swords (2026-10-09, user requests "Add items like knifes and sabers" and "Pocket knives, flip knives other
// common types of knives"). Plain data that imports nothing, merged like data-guns.js: data.js Object.assign(GEAR,
// BLADE_GEAR) (before the Melee skill pass: they go by Melee), combat.js Object.assign(WEAPONS, BLADE_WEAPONS) and
// BLADE_KIT_PATCH appended to KITS' lists, loot.js Object.assign(ITEM_TAGS, BLADE_TAGS). Where they turn up: blades.js
// (their own tables and dice). The looks: BLADE_LOOK (ui/sprites.js, ui/downsprites.js).
//
// The spread: everyday folders and kitchen knives are light, quiet, cheap, quick (a strike for 1 action, one a turn:
// strike and step away) and weak; fixed blades hit harder; the swords are the rare heavy end, not quick, and want some
// Melee (req: the skill-gap rule, world.js gearEffect). Fields as data-guns.js's melee: mclass (armour by class),
// quick, meleeAim, bleed, stagger, takedown (stealth.js), stab (finds a dead soldier's gap, deadsoldiers.js).
// Every one scales with the Melee skill like any melee weapon (world.js MELEE_SKILL). Blades are silent (noise 0).

const W = "weapon", ML = "melee";
/** @type {Record<string, any>} */
export const BLADE_GEAR = {
  // ---------- everyday knives: folders, kitchen, utility ----------
  pocketknife:   { name: "Pocket knife",         slot: W, skill: ML, power: 0.6, req: 0, value: 3,  noise: 0, small: true, weight: 0.1,  dur: 30, cat: "melee",
                   desc: "A two-inch folding knife off a key ring or out of a kitchen drawer. Quick (strike and still move), weightless, and not much of a weapon." },
  flipknife:     { name: "Flick knife",          slot: W, skill: ML, power: 0.8, req: 0, value: 6,  noise: 0, small: true, weight: 0.12, dur: 30, cat: "melee",
                   desc: "A switchblade that flicks open with a button: quick, +3 to hit (it is out before they see it), light. Common in pockets and evidence lockers." },
  lockback:      { name: "Lockback folding knife", slot: W, skill: ML, power: 0.9, req: 0, value: 7, noise: 0, small: true, weight: 0.15, dur: 40, cat: "melee",
                   desc: "A sturdy folder with a locking blade, a hunter's or a trucker's pocket knife. Quick, and it does not fold on your fingers." },
  multitool:     { name: "Multitool",            slot: W, skill: ML, power: 0.4, req: 0, value: 10, noise: 0, small: true, weight: 0.25, dur: 80, cat: "melee",
                   desc: "Pliers, screwdrivers and a short blade on one handle: lasts forever, and the blade is the least of it. Quick, but barely a weapon." },
  boxcutter:     { name: "Box cutter",           slot: W, skill: ML, power: 0.4, req: 0, value: 1,  noise: 0, small: true, weight: 0.08, dur: 12, cat: "melee",
                   desc: "A utility knife with a snap-off blade: quick, cuts that bleed people (20%), and it snaps soon." },
  balisong:      { name: "Butterfly knife",      slot: W, skill: ML, power: 0.9, req: 0, value: 8,  noise: 0, small: true, weight: 0.15, dur: 35, cat: "melee",
                   desc: "A balisong, flipped open in one hand: quick, +5 to hit in the hands of anyone who practised, and now and then a cut that bleeds (10%)." },
  steakknife:    { name: "Steak knife",          slot: W, skill: ML, power: 0.6, req: 0, value: 2,  noise: 0, small: true, weight: 0.1,  dur: 20, cat: "melee",
                   desc: "A serrated table knife from a block of six. Quick and light; it will do if nothing else is to hand." },
  filletknife:   { name: "Fillet knife",         slot: W, skill: ML, power: 0.8, req: 0, value: 6,  noise: 0, small: true, weight: 0.12, dur: 30, cat: "melee",
                   desc: "A thin flexible blade for fish: quick, and its long cuts bleed people (25%)." },
  cleaver:       { name: "Meat cleaver",         slot: W, skill: ML, power: 1.3, req: 0, value: 6,  noise: 0, weight: 0.7, dur: 45, cat: "melee",
                   desc: "A butcher's cleaver: a heavy chopping blow (not quick) that can stagger (10%) and bleed (15%)." },
  // ---------- fixed blades ----------
  huntknife:     { name: "Hunting knife",        slot: W, skill: ML, power: 1.4, req: 0, value: 12, noise: 0, small: true, weight: 0.3, dur: 50, cat: "melee",
                   desc: "A drop-point skinning knife in a leather sheath: quick, a point that finds a dead soldier's gap, cuts that bleed (15%). Good for takedowns (+10)." },
  survivalknife: { name: "Survival knife",       slot: W, skill: ML, power: 1.4, req: 0, value: 14, noise: 0, small: true, weight: 0.35, dur: 60, cat: "melee",
                   desc: "A saw-backed fixed blade with a compass in the hollow handle: quick, tough (lasts long), and its point finds a dead soldier's gap." },
  bowie:         { name: "Bowie knife",          slot: W, skill: ML, power: 1.7, req: 0, value: 16, noise: 0, weight: 0.45, dur: 55, cat: "melee",
                   desc: "A big clip-point fighting knife: quick, the hardest-hitting knife there is, cuts that bleed (20%)." },
  bayonet:       { name: "Bayonet",                slot: W, skill: ML, power: 1.4, req: 0, value: 10, noise: 0, small: true, weight: 0.4, dur: 50, cat: "melee",
                   desc: "An army bayonet, used in the hand (no rifle here takes one): quick, +3 to hit, and its point finds a dead soldier's gap." },
  shiv:          { name: "Scrap shiv",           slot: W, skill: ML, power: 0.6, req: 0, value: 1,  noise: 0, small: true, weight: 0.1, makeshift: true, dur: 10, cat: "melee",
                   desc: "A strip of scrap ground to a point, the handle wrapped in tape: quick, finds a dead soldier's gap, and breaks soon. Anyone can make one (crafting, also in the field)." },
  // ---------- swords: the rare heavy end ----------
  cutlass:       { name: "Cutlass",               slot: W, skill: ML, power: 2.3, req: 2, value: 30, noise: 0, weight: 1.2, dur: 45, cat: "melee",
                   desc: "A short heavy sword with a basket guard, off a wall or out of a pawn shop: deep cuts that bleed (25%). Needs Melee 2 to use well." },
  sabre:         { name: "Cavalry sabre",         slot: W, skill: ML, power: 2.5, req: 3, value: 40, noise: 0, weight: 1.1, dur: 40, cat: "melee",
                   desc: "An antique cavalry sabre, still keen: +3 to hit, long cuts that bleed (25%). Rare: a collector's house, a pawn shop, a church's war memorial. Needs Melee 3 to use well." },
  broadsword:    { name: "Broadsword",            slot: W, skill: ML, power: 2.9, req: 5, value: 50, noise: 0, weight: 1.6, dur: 50, cat: "melee",
                   desc: "A replica broadsword that turned out to be real steel: slow (−3 to hit) but crushing blows that stagger (20%) and bleed (20%). Rare. Needs Melee 5 to use well." },
};

/** @type {Record<string, any>} */
export const BLADE_WEAPONS = {
  pocketknife:   { name: "Pocket knife",       melee: true, dmg: [9, 15],  mclass: "blade",  quick: true, takedown: 10 },
  flipknife:     { name: "Flick knife",        melee: true, dmg: [11, 17], mclass: "blade",  quick: true, meleeAim: 3, takedown: 10 },
  lockback:      { name: "Lockback folding knife", melee: true, dmg: [12, 18], mclass: "blade", quick: true, takedown: 10 },
  multitool:     { name: "Multitool",          melee: true, dmg: [7, 12],  mclass: "blade",  quick: true, takedown: 5 },
  boxcutter:     { name: "Box cutter",         melee: true, dmg: [7, 13],  mclass: "blade",  quick: true, bleed: 0.2, takedown: 5 },
  balisong:      { name: "Butterfly knife",    melee: true, dmg: [11, 17], mclass: "blade",  quick: true, meleeAim: 5, bleed: 0.1, takedown: 10 },
  steakknife:    { name: "Steak knife",        melee: true, dmg: [10, 16], mclass: "blade",  quick: true, takedown: 5 },
  filletknife:   { name: "Fillet knife",       melee: true, dmg: [11, 17], mclass: "blade",  quick: true, bleed: 0.25, takedown: 10 },
  cleaver:       { name: "Meat cleaver",       melee: true, dmg: [16, 25], mclass: "chop",   stagger: 0.1, bleed: 0.15, takedown: 5 },
  huntknife:     { name: "Hunting knife",      melee: true, dmg: [15, 23], mclass: "pierce", quick: true, bleed: 0.15, takedown: 10, stab: true },
  survivalknife: { name: "Survival knife",     melee: true, dmg: [15, 23], mclass: "pierce", quick: true, takedown: 10, stab: true },
  bowie:         { name: "Bowie knife",        melee: true, dmg: [18, 27], mclass: "blade",  quick: true, bleed: 0.2, takedown: 10 },
  bayonet:       { name: "Bayonet",            melee: true, dmg: [15, 23], mclass: "pierce", quick: true, meleeAim: 3, takedown: 10, stab: true },
  shiv:          { name: "Scrap shiv",         melee: true, dmg: [10, 16], mclass: "pierce", quick: true, takedown: 10, stab: true },
  cutlass:       { name: "Cutlass",            melee: true, dmg: [21, 31], mclass: "blade",  bleed: 0.25, takedown: 5 },
  sabre:         { name: "Cavalry sabre",      melee: true, dmg: [22, 32], mclass: "blade",  meleeAim: 3, bleed: 0.25, takedown: 5 },
  broadsword:    { name: "Broadsword",         melee: true, dmg: [25, 37], mclass: "chop",   meleeAim: -3, stagger: 0.2, bleed: 0.2, takedown: 5 },
};

// Who carries them (combat.js KITS loot lists, appended: on their bodies after a fight; groups' arsenals take what they
// pick up, arsenal.js). Nobody's battle weapon changed (KITS weapons lists are as they were).
/** @type {Record<string, Record<string, string[]>>} */
export const BLADE_KIT_PATCH = {
  raiders:   { loot: ["flipknife", "bowie", "balisong"] },
  survivors: { loot: ["pocketknife", "lockback", "multitool"] },
  militia:   { loot: ["huntknife"] },
  soldiers:  { loot: ["bayonet"] },
  zealots:   { loot: ["cutlass"] },
  fighters:  { loot: ["bowie"] },
};

// Where each is normally kept (loot.js ITEM_TAGS; tools/loottest.js).
/** @type {Record<string, string[]>} */
export const BLADE_TAGS = {
  pocketknife: ["home", "shop", "travel", "outdoor", "camp", "crime", "garage"],
  flipknife: ["crime", "prison", "home", "shop", "travel"],
  lockback: ["outdoor", "hunt", "travel", "shop", "camp", "home"],
  multitool: ["tools", "garage", "camp", "outdoor", "shop", "home", "travel"],
  boxcutter: ["industry", "shop", "tools", "office", "garage", "home"],
  balisong: ["crime", "mall", "home", "police", "travel"],
  steakknife: ["kitchen", "home"],
  filletknife: ["kitchen", "hunt", "outdoor"],
  cleaver: ["kitchen", "home"],
  huntknife: ["hunt", "outdoor", "guns", "camp", "farm"],
  survivalknife: ["camp", "outdoor", "mall", "military", "shop", "hunt", "guns"],
  bowie: ["hunt", "guns", "home", "crime", "farm"],
  bayonet: ["military", "guns", "crash"],
  shiv: ["prison", "crime"],
  cutlass: ["home", "shop", "crime"],
  sabre: ["home", "shop", "crime", "church"],
  broadsword: ["mall", "shop", "home"],
};

// The looks (ui/sprites.js drawWeapon, ui/downsprites.js droppedWeapon): blade length (pixels), blade and handle
// colours, a guard's colour (swords), curve (a sabre's), hilt length.
/** @type {Record<string, { len: number, blade: string, handle: string, guard?: string, curve?: boolean, hilt?: number }>} */
export const BLADE_LOOK = {
  pocketknife: { len: 2, blade: "#c2c9cf", handle: "#a83a2a" }, flipknife: { len: 3, blade: "#d6dde2", handle: "#1a1c20" },
  lockback: { len: 3, blade: "#c2c9cf", handle: "#7a5230" }, multitool: { len: 2, blade: "#9aa3ab", handle: "#6d7378" },
  boxcutter: { len: 1, blade: "#d6dde2", handle: "#d9b23a" }, balisong: { len: 3, blade: "#d6dde2", handle: "#55595e", hilt: 3 },
  steakknife: { len: 3, blade: "#c2c9cf", handle: "#3a2a1c" }, filletknife: { len: 4, blade: "#d6dde2", handle: "#2b2e33" },
  cleaver: { len: 3, blade: "#9aa3ab", handle: "#3a2a1c", guard: "#9aa3ab" }, huntknife: { len: 4, blade: "#c2c9cf", handle: "#5b3a22" },
  survivalknife: { len: 4, blade: "#7d858c", handle: "#2b2e33", guard: "#55595e" }, bowie: { len: 5, blade: "#d6dde2", handle: "#5b3a22", guard: "#b89a4a" },
  bayonet: { len: 5, blade: "#5a6066", handle: "#3d4a2e", guard: "#2b2e33" }, shiv: { len: 2, blade: "#8a8a8a", handle: "#6d7378" },
  cutlass: { len: 7, blade: "#c2c9cf", handle: "#3a2a1c", guard: "#b89a4a", curve: true }, sabre: { len: 9, blade: "#d6dde2", handle: "#1a1c20", guard: "#b89a4a", curve: true },
  broadsword: { len: 9, blade: "#c2c9cf", handle: "#5b3a22", guard: "#6d7378", hilt: 3 },
};

// The Help topic (ui/help.js, after "Guns and melee weapons").
export const BLADES_HELP = `<b>Everyday knives.</b> Pocket knives, flick knives, lockback folders, butterfly knives, multitools, box cutters,
  steak and fillet knives: in pockets, kitchen drawers, glove boxes and the dead's coats everywhere. Light, silent, cheap
  (a point or two under Customize) and quick (a strike for 1 action, then a move), but weak; the box cutter and the fillet
  knife cut people so they bleed, the flick knife and the butterfly knife are quicker to hit with. <b>Fixed blades</b> hit
  harder: the hunting knife, the survival knife, the army bayonet (used in the hand) and the Bowie knife, the best of
  them; the hunting and survival knives, the bayonet and a scrap shiv (anyone can make one, even on the road) find the
  gap in a dead soldier's armour. The meat cleaver chops (not quick) and can stagger. <b>Swords</b> are the rare heavy end:
  a cutlass, an antique cavalry sabre, a broadsword. Not quick, they hit like an axe and bleed people, and want some
  Melee to use well (2, 3 and 5). Every blade scales with the Melee skill. Hunting stores and lodges keep the good
  knives, army sites the bayonets, prisons the shivs; a collector's house, a pawn shop or a church's war memorial now and
  then a sword; traders and merchants sell them, and raiders, survivors, soldiers and zealots carry them.`;
