// @ts-check
// Lockable boxes and cases (2026-10-19, user request: "Add lock boxes and other containers that can hold valuables or
// nothing, some are locked and need to be forced open with an action with proper tools via right click in the
// inventory or in a storage and it will open up a window of items within the box. Weapon cases as well ... you can
// tell if a gun is in it if it is heavy: the weight of the box or case is the base weight of the case + a sum of all
// the items' weights in it. Weapon cases can have guns, ammo, or nothing and other items that make sense like camera
// gear"). Plain data that imports nothing: data.js merges BOX_GEAR into GEAR and patches BOX_PATCH onto the two gun
// cases; the rules are sim/boxes.js (what is inside, the lock, the tools, opening, taking things out), the window
// ui/boxview.js.
//
// GEAR box: { lock: the lock's kind (BOX_LOCKS), locked: the chance a found one is locked, holds: its contents table
// (BOX_HOLDS) }. A box's contents are item.contents (items) and item.sup (supplies: rounds), unseen until it is opened
// (item.opened): the inventory shows only its weight, which is the box's own plus everything inside (inventory.js
// itemLoad), so a heavy one has something in it and a rifle case that weighs a rifle more than its own 3.5 kg most
// likely holds one.
import { ROWS, mergeRows } from "./data-shops.js";

/** @type {Record<string, any>} */
export const BOX_GEAR = {
  cashbox:   { name: "Cash box",               slot: "pack", skill: null, power: 0, req: 0, value: 5,  noise: 0, weight: 1.2, cat: "containers", box: { lock: "cheap", locked: 0.6, holds: "cash" },
               desc: "A grey steel petty-cash box with a carry handle and a wafer lock: rings, coins, a watch, papers, or nothing at all. Locked, it opens to a blade or lockpicks (quiet) or a pry bar (loud). It weighs 1.2 kg empty: anything heavier has something inside." },
  firebox:   { name: "Fireproof lock box",     slot: "pack", skill: null, power: 0, req: 0, value: 12, noise: 0, weight: 6, cat: "containers", bulky: true, twoHands: true, box: { lock: "steel", locked: 0.85, holds: "safe" },
               desc: "A small fire safe for papers and heirlooms from under a bed or a closet shelf: jewellery, coins, a stamp album, family photos, now and then a handgun and its rounds. Its steel lock wants a pry bar (loud, 2 actions in a fight), a power drill or an angle grinder; a blade or picks will not do. 6 kg empty. Carried in both arms only (no pocket, pack or pouch takes it). Opened in a base's armory it is a little lockable storage: 15 kg of room." },
  toolbox:   { name: "Steel toolbox",          slot: "pack", skill: null, power: 0, req: 0, value: 6,  noise: 0, weight: 2.5, cat: "containers", box: { lock: "cheap", locked: 0.15, holds: "tools" },
               desc: "A red cantilever toolbox from a garage or a truck bed, now and then padlocked: hand tools, a multitool, tape and batteries, or someone already took them. 2.5 kg empty." },
  gearcase:  { name: "Hard equipment case",    slot: "pack", skill: null, power: 0, req: 0, value: 14, noise: 0, weight: 2.8, cat: "containers", box: { lock: "cheap", locked: 0.3, holds: "gear" },
               desc: "A waterproof foam-lined case (a Pelican 1510-style carry-on) for cameras, optics, radios and laptops, or a handgun: whoever owned it decided. 2.8 kg empty: heft it before you open it." },
};

// The two gun cases (data.js riflecase, pistolcase) become boxes too: their contents table (a gun, rounds only, camera
// or optics gear, fishing rods in a long case, or nothing) and their cheap lock.
/** @type {Record<string, any>} */
export const BOX_PATCH = {
  riflecase:  { twoHands: true, box: { lock: "cheap", locked: 0.4, holds: "riflecase" } },
  pistolcase: { box: { lock: "cheap", locked: 0.4, holds: "pistolcase" } },
};

// Base storage (basestorage.js, the user's request 2026-10-19: "You can steal storage boxes like small safes (Carried
// only slot two hands) weapon cases etc."): an opened box (item.opened, or forced) kept in a base's armory is room for
// the base's goods, this many kg a box (its own weight is not counted: it is the room). A sealed one is just an item
// until it is opened. The fire safe and the rifle case are twoHands (GEAR): carried in the arms only (bulky: never a
// pocket, a pack slot or a rig pouch), and they fill both hands (carry.js handsCount).
/** @type {Record<string, number>} */
export const BOX_STORE_KG = { cashbox: 3, firebox: 15, toolbox: 10, gearcase: 12, riflecase: 8, pistolcase: 3 };

// The locks. tools: what opens it (sim/boxes.js boxTool: "blade" any knife or bladed melee weapon, "picks" lockpicks or
// makeshift picks, "pry" a pry bar (locks.js barOf), "power" a power drill or an angle grinder), in the order they are
// tried; ap: actions in a fight; heat: raid Heat by the tool used (a quiet pick, a loud pry or drill).
export const BOX_LOCKS = {
  cheap: { name: "a cheap wafer lock", tools: ["picks", "blade", "pry", "power"], ap: 1, heat: { picks: 0, blade: 1, pry: 2, power: 3 } },
  steel: { name: "a steel lock",       tools: ["pry", "power"],                   ap: 2, heat: { pry: 3, power: 4 } },
};

// What a box or case holds (sim/boxes.js rollBoxContents). kinds: { kind: weight } of what it turns out to hold:
//   empty   nothing (the weight gives it away)
//   gun     a gun case's gun (gunsafes.js rollGunStash: the gun, its magazines, a little ammo)
//   rounds  a box or two of rounds and nothing else (ammo: the round supplies by weight, [lo, hi] rounds)
//   items   n [lo, hi] picks from items { key: weight } (each pick its own die; a key twice is two)
//   pistol  a small handgun from pistols { key: weight } with a few rounds of its calibre (a cash box's, a fire safe's)
/** @type {Record<string, { kinds: Record<string, number>, items?: Record<string, number>, n?: number[], ammo?: Record<string, number>, rounds?: number[], pistols?: Record<string, number> }>} */
export const BOX_HOLDS = {
  cash: {
    kinds: { empty: 3, items: 6, pistol: 0.4 },
    items: { coins: 3, goldring: 2, watch: 1.5, goldchain: 1.5, photos: 2, stamps: 1, pearls: 0.5, diamond: 0.25, cigarettes: 1, lighters: 0.5 }, n: [1, 2],
    pistols: { snub38: 2, compact9: 1.5, pistol22: 0.5 },
  },
  safe: {
    kinds: { empty: 2, items: 6, pistol: 1.2 },
    items: { photos: 3, coins: 3, goldchain: 2, goldring: 2, watch: 2, stamps: 1.5, pearls: 1, diamond: 0.6, tcards: 1, silverware: 0.8 }, n: [1, 3],
    pistols: { snub357: 1.5, pistol: 1.5, pistol45: 1, snub38: 1, service38: 0.6 },
  },
  tools: {
    kinds: { empty: 2, items: 8 },
    items: { hammer: 3, pipewrench: 2, multitool: 2, boxcutter: 3, batteries: 1.5, lighters: 1, repairkit: 0.4, powerdrill: 0.3, headlamp: 1, flashlight: 1, makeshiftpick: 0.5, handsaw: 1.5, handdrill: 0.6, sewingkit: 0.6 }, n: [2, 3],
  },
  gear: {
    kinds: { empty: 3, items: 5, gun: 1.5 },
    items: { camera: 3, laptop: 1.5, binoculars: 2, rangefinder: 1, monocular: 1, handradio: 1, phone: 1.5, batteries: 2, spotscope: 0.6, console: 0.6 }, n: [1, 3],
  },
  pistolcase: {
    kinds: { gun: 11, rounds: 3, items: 2, empty: 4 },
    items: { camera: 2, phone: 1, monocular: 1.5, rangefinder: 1, batteries: 1, tritium: 0.4, holopistol: 0.4 }, n: [1, 2],
    ammo: { a_9mm_fmj: 4, a_9mm_hp: 1.5, a_45acp_fmj: 1.5, a_38spl_fmj: 1.5, a_357_fmj: 1, a_22lr_fmj: 2 }, rounds: [20, 50],
  },
  riflecase: {
    kinds: { gun: 11, rounds: 2, items: 3, empty: 4 },
    items: { fishrod: 2.5, spotscope: 1.5, binoculars: 1, camera: 1, huntrifscope: 1, scope4x: 0.6, bipod: 0.8, sling: 1, telescope: 0.3 }, n: [1, 2],
    ammo: { a_308_sp: 2, a_308_fmj: 1.5, a_3030_sp: 1.5, a_556_fmj: 2, a_223_sp: 1, a_762x39_fmj: 1, a_12ga_buck: 1.5, a_12ga_slug: 1, a_22lr_fmj: 1.5 }, rounds: [20, 60],
  },
};

// Where the new boxes turn up (sim/boxes.js: their own dice, after everything else a search hour or a raid container
// rolls). site: a search hour's chance by site type; area: a raid container's by area type; items: { box: weight }.
/** @type {{ site: Record<string, { p: number, items: Record<string, number> }>, area: Record<string, { p: number, items: Record<string, number> }> }} */
export const BOX_FINDS = {
  site: {
    town: { p: 0.025, items: { cashbox: 3, firebox: 1.5, toolbox: 2, gearcase: 0.8 } },
    city: { p: 0.025, items: { cashbox: 3, firebox: 1.5, gearcase: 1, toolbox: 1 } },
    apartments: { p: 0.03, items: { cashbox: 2, firebox: 2, gearcase: 0.6 } },
    motel: { p: 0.02, items: { cashbox: 2, gearcase: 0.5 } },
    gas: { p: 0.02, items: { cashbox: 3, toolbox: 1 } },
    truckstop: { p: 0.025, items: { cashbox: 2, toolbox: 2 } },
    diner: { p: 0.02, items: { cashbox: 3 } },
    office: { p: 0.03, items: { cashbox: 3, firebox: 1, gearcase: 1 } },
    mall: { p: 0.03, items: { cashbox: 2, gearcase: 1.5 } },
    hardware: { p: 0.03, items: { toolbox: 3, cashbox: 1 } },
    autoshop: { p: 0.04, items: { toolbox: 3 } },
    farm: { p: 0.02, items: { toolbox: 2, firebox: 1, cashbox: 0.5 } },
    ranch: { p: 0.02, items: { toolbox: 1.5, firebox: 1 } },
    cabin: { p: 0.02, items: { firebox: 1, toolbox: 1, gearcase: 0.6 } },
    church: { p: 0.02, items: { cashbox: 3 } },
    crash_news: { p: 0.05, items: { gearcase: 3 } },
    airport: { p: 0.03, items: { gearcase: 2, cashbox: 1 } },
    univ: { p: 0.02, items: { gearcase: 2, cashbox: 1 } },
  },
  area: {
    house: { p: 0.03, items: { cashbox: 2, firebox: 2, toolbox: 0.6, gearcase: 0.5 } },
    farmhouse: { p: 0.03, items: { firebox: 1.5, toolbox: 1.5, cashbox: 1 } },
    store: { p: 0.04, items: { cashbox: 3 } },
    office: { p: 0.04, items: { cashbox: 3, firebox: 0.8, gearcase: 0.8 } },
    garage: { p: 0.04, items: { toolbox: 3 } },
    hardware: { p: 0.05, items: { toolbox: 3, cashbox: 0.5 } }, // shops.js: a hardware store's aisles
    workshop: { p: 0.04, items: { toolbox: 3 } },
    warehouse: { p: 0.02, items: { toolbox: 1, cashbox: 1 } },
    cabin: { p: 0.02, items: { firebox: 1, gearcase: 0.6, toolbox: 0.6 } },
    roadcars: { p: 0.02, items: { gearcase: 1, toolbox: 1, cashbox: 0.6 } },
    newswreck: { p: 0.1, items: { gearcase: 3 } },
    chapel: { p: 0.03, items: { cashbox: 2 } },
    lab: { p: 0.02, items: { gearcase: 2 } },
  },
};
// Where each is normally kept (loot.js ITEM_TAGS).
/** @type {Record<string, string[]>} */
export const BOX_TAGS = {
  cashbox: ["shop", "office", "home", "travel", "kitchen", "church", "crime"],
  firebox: ["home", "office", "farm", "hunt"],
  toolbox: ["tools", "garage", "farm", "home", "industry", "travel", "shop"],
  gearcase: ["tech", "travel", "home", "office", "school", "crash", "mall", "hunt"],
};

// The Help topic (ui/help.js).
export const BOX_HELP = `<b>Boxes and cases.</b> Cash boxes, fireproof lock boxes, steel toolboxes, hard equipment cases and the
  rifle and pistol cases turn up in houses, shops, offices, garages, cars and gun stores. Nobody knows what is in one until
  it is opened: what you can tell is its weight, which is the box's own plus everything inside (the description says what
  an empty one weighs), so a rifle case heavier than its 3.5 kg most likely holds a rifle, and a cash box at its own 1.2 kg
  is empty. Right-click one (in a pack, a pocket, the armory or the cargo) to open it: an unlocked one simply opens; a
  locked one has to be forced with the right tool, carried by whoever opens it or lying in the same storage. A cheap
  wafer lock (cash boxes, toolboxes, gun and equipment cases) gives to lockpicks (quiet), a blade, a pry bar or a power
  tool; a fire safe's steel lock only to a pry bar, a power drill or an angle grinder. Forcing takes an action in a fight
  (the steel lock two) and is loud in a raid; at a base or a camp it is free. An opened box shows a window of what was
  inside: take things one at a time or all at once. Gun cases hold a gun and its rounds most often, sometimes rounds
  alone, a camera, optics or a fishing rod, or nothing.`;

// data-shops.js: the town's and the city's shops and services (their rows; this module's own rows win).
mergeRows(BOX_FINDS.site, ROWS.BOX_SITE); mergeRows(BOX_FINDS.area, ROWS.BOX_AREA);
