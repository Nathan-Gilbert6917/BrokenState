// @ts-check
// Survival gear (2026-10-19, user request: "Add more items a zombie survival game should have such as utility, tools,
// guns, attachments, etc with sprites balanced values and other attributes needed"). Plain data that imports nothing,
// merged like data-blades.js: data.js Object.assign(GEAR, SURV_ITEMS), combat.js Object.assign(WEAPONS,
// SURV_MELEE) and SURV_KIT_PATCH appended to KITS' loot lists, armour.js Object.assign(ARMOUR, SURV_ARMOUR), lights.js
// Object.assign(LIGHTS, SURV_LIGHTS), loot.js Object.assign(ITEM_TAGS, SURV_TAGS). Where they turn up: survival.js
// (their own tables and dice, rolled last). The guns and gun parts of the same request are in data-guns.js SURV_GEAR,
// data-gunmods.js (the platforms and the parts) and data-kit.js SURV_MAGS; the drawings in ui/itemart/*.js.
//
// Every item works through a system the game already has, so its numbers are the whole story:
//   halligan      a firefighter's forcible-entry bar: a pry tool (forces locks like a crowbar, locks.js barOf) and a
//                 pick-headed melee weapon (pierce, finds a dead soldier's gap), heavy and slow (−2 to hit)
//   pipewrench    a heavy steel wrench: a blunt club that can stagger, nearly unbreakable, cheap and everywhere
//   leatherjacket torso armour AC 1 (soft): a biker's jacket that turns most bites and scratches (armour.js)
//   chainsleeves  arm armour AC 2 (steel): a butcher's chainmail sleeves, near bite-proof and slow to wear by teeth
//   motopants     leg armour AC 1 (padding): armoured motorcycle trousers with knee and shin pads
//   anglelight    a light clipped to the chest (lights.js free: hands free wherever it is carried): further than a
//                 headlamp down a narrower beam, and seen a little further off
//   solarlantern  a light in the off hand: a pool of light 4 tiles all round, lighter and dimmer than the lantern
//   legrig        a drop-leg rig (EQUIP "rig"): two pistol magazine pouches, an admin pouch and a pocket
//   jumpbag       a paramedic's jump bag: a med kit (+3 Medicine when treating, 10 treatments), too big for a pocket
//   rangefinder   a laser rangefinder (optics.js): a little better at finding hidden places, a tile further on a survey
// Values are the hidden base barter values (valuation.js), weights in kg; dur: wear (fights for armour and weapons,
// treatments for the jump bag).
import { ROWS, mergeRows } from "./data-shops.js";

const W = "weapon", ML = "melee";
/** @type {Record<string, any>} */
export const SURV_ITEMS = {
  // ---------- tools that are weapons ----------
  halligan:      { name: "Halligan bar",            slot: W, skill: ML, power: 2.2, req: 1, value: 28, noise: 0, pry: true, weight: 4, dur: 120, cat: "melee",
                   desc: "A firefighter's forcible-entry bar: a fork at one end, an adze and a pick at the other. It forces any lock a crowbar does (loud), and its pick punches through a skull or a dead soldier's armour; heavy (−2 to hit) and it can stagger (15%). Fire stations and fire engines. Needs Melee 1 to use well." },
  pipewrench:    { name: "Pipe wrench",             slot: W, skill: ML, power: 1.6, req: 0, value: 6,  noise: 0, weight: 1.8, dur: 150, cat: "melee",
                   desc: "Eighteen inches of cast iron from under a sink or a plumber's van: a club that cracks heads and can stagger (15%), and it all but never breaks." },
  // ---------- armour against teeth ----------
  leatherjacket: { name: "Leather jacket",          slot: "armor", skill: null, power: 1, req: 0, value: 18, noise: 0, weight: 1.8, dur: 30, cat: "armor",
                   desc: "A heavy biker's jacket (armour class 1, soft): teeth and nails mostly do not get through, a knife or a bullet does. Cheap, common and light: the poor man's armour against the dead." },
  chainsleeves:  { name: "Chainmail sleeves",       slot: "arms",  skill: null, power: 1.2, req: 0, value: 30, noise: 0, weight: 1.4, dur: 35, cat: "armor",
                   desc: "A butcher's stainless chainmail gauntlets and sleeves (armour class 2, steel): almost no bite gets through to the forearm, and teeth barely wear it. Meat counters, packing plants and kitchen suppliers." },
  motopants:     { name: "Armoured motorcycle trousers", slot: "legs", skill: null, power: 0.8, req: 0, value: 20, noise: 0, weight: 1.6, dur: 25, cat: "armor",
                   desc: "Cordura riding trousers with foam knee and shin armour sewn in (armour class 1, padding): a crawler's bite at the ankle has to chew through it first." },
  // ---------- lights ----------
  anglelight:    { name: "Angle-head flashlight",   slot: "pack", skill: null, power: 0, req: 0, value: 16, noise: 0, small: true, weight: 0.4, cat: "tools",
                   desc: "An army right-angle flashlight clipped to the chest strap: hands free wherever it is carried, like a headlamp, but a longer, narrower beam (9 tiles ahead at night). Guards notice it from 3 tiles further off (a headlamp 1)." },
  solarlantern:  { name: "Solar camping lantern",   slot: "tool", skill: null, power: 0, req: 0, value: 14, noise: 0, weight: 0.5, cat: "tools",
                   desc: "A collapsible lantern with a solar panel on top, charged on a windowsill: in the off hand at night a pool of light 4 tiles all round (the oil lantern 5), less than half the weight, and guards notice it from 3 tiles further off (the lantern 4)." },
  // ---------- carry and kit ----------
  legrig:        { name: "Drop-leg rig",            slot: "rig", skill: null, power: 0, req: 0, value: 18, noise: 0, weight: 0.5, carry: 0.5, cat: "packs",
                   pouches: ["pistol", "pistol", "admin", "pocket"],
                   desc: "A thigh platform with two pistol magazine pouches, an admin pouch and a pocket (anything a pocket takes); +0.5 kg max load. A magazine from a pouch reloads in 1 action. Police and military kit; not over a vest or a carrier with its own pouches." },
  jumpbag:       { name: "Paramedic's jump bag",    slot: "tool", skill: "medicine", power: 3, req: 3, value: 35, noise: 0, makeshift: true, dur: 10, medKit: 3, weight: 3, cat: "medical",
                   desc: "An ambulance crew's orange bag: dressings, splints, a BVM, IV kit and burn gel. +3 Medicine when treating (at a base, in the field or in battle), about 10 treatments. Needs Medicine 3 for the full bonus; too big for a pocket (a trauma kit fits one)." },
  rangefinder:   { name: "Laser rangefinder",       slot: "pack", skill: null, power: 0, req: 0, value: 30, noise: 0, small: true, weight: 0.3, cat: "optics", optics: { look: 1.15, reach: 1, spot: 0.03 },
                   desc: "A hunter's 6× laser rangefinder: carried by anyone on a team it spots hidden places and finds ×1.15, looks a tile further when the team surveys, and sees others a little sooner on the road. Not as good a glass as binoculars for looking around." },
};

// The melee numbers (combat.js WEAPONS): fields as data-guns.js's melee.
/** @type {Record<string, any>} */
export const SURV_MELEE = {
  halligan:   { name: "Halligan bar", melee: true, dmg: [19, 29], mclass: "pierce", meleeAim: -2, stagger: 0.15, takedown: 10, stab: true },
  pipewrench: { name: "Pipe wrench",  melee: true, dmg: [15, 23], mclass: "blunt", stagger: 0.15, takedown: 15 },
};
// Armour classes (armour.js ARMOUR: AC, dmax = the GEAR dur, material).
/** @type {Record<string, { ac: number, dmax: number, mat: string }>} */
export const SURV_ARMOUR = {
  leatherjacket: { ac: 1, dmax: 30, mat: "soft" },
  chainsleeves:  { ac: 2, dmax: 35, mat: "steel" },
  motopants:     { ac: 1, dmax: 25, mat: "padding" },
};
// The lights (lights.js LIGHTS: sight, seen, survey, free, cone, beam / round + pool).
/** @type {Record<string, any>} */
export const SURV_LIGHTS = {
  anglelight:   { sight: 9, seen: 3, survey: 0.48, free: true,  cone: 4, beam: 18, name: "angle-head flashlight" },
  solarlantern: { sight: 9, seen: 3, survey: 0.5,  free: false, round: true, cone: 4, pool: 4, name: "solar lantern" },
};

// Where each is normally kept (loot.js ITEM_TAGS; tools/loottest.js).
/** @type {Record<string, string[]>} */
export const SURV_TAGS = {
  halligan: ["fire", "tools", "industry", "police"],
  pipewrench: ["tools", "garage", "industry", "home", "farm"],
  leatherjacket: ["home", "garage", "crime", "mall", "shop", "travel"],
  chainsleeves: ["kitchen", "industry", "shop"],
  motopants: ["garage", "home", "sport", "shop", "mall", "travel"],
  anglelight: ["military", "camp", "police", "outdoor"],
  solarlantern: ["camp", "outdoor", "home", "shop", "mall"],
  legrig: ["police", "military", "guns"],
  jumpbag: ["medical", "fire"],
  rangefinder: ["hunt", "military", "guns", "sport", "outdoor"],
};

// Where they turn up (survival.js): a site's search hour by site type, a raid container by area type, a trader's table
// by group type; p: the chance, items: weights. Fire stations the Halligan bar and the jump bag, hardware stores and
// garages the wrench, malls and truck stops the leathers, kitchens and packing plants the chainmail, police and army
// sites the rig and the angle-head light, hunting lodges and gun stores the rangefinder, campgrounds the solar lantern.
/** @type {Record<string, { p: number, items: Record<string, number> }>} */
export const SURV_FINDS = {
  firestation: { p: 0.07, items: { halligan: 3, jumpbag: 2 } },
  hospital: { p: 0.03, items: { jumpbag: 2 } },
  clinic: { p: 0.03, items: { jumpbag: 1 } },
  ranger: { p: 0.04, items: { jumpbag: 1, anglelight: 1, solarlantern: 1, halligan: 0.3 } },
  hardware: { p: 0.05, items: { pipewrench: 3, solarlantern: 1, halligan: 0.2 } },
  autoshop: { p: 0.04, items: { pipewrench: 2, leatherjacket: 1, motopants: 1 } },
  factory: { p: 0.03, items: { pipewrench: 2, chainsleeves: 0.6, halligan: 0.2 } },
  warehouse: { p: 0.03, items: { pipewrench: 1, chainsleeves: 0.5, solarlantern: 0.6 } },
  supermarket: { p: 0.02, items: { chainsleeves: 1, solarlantern: 0.5 } },
  grocery: { p: 0.02, items: { chainsleeves: 1 } },
  mall: { p: 0.04, items: { leatherjacket: 2, motopants: 1, solarlantern: 1.5, rangefinder: 0.5 } },
  town: { p: 0.02, items: { leatherjacket: 2, pipewrench: 1, motopants: 0.6, solarlantern: 0.6 } },
  city: { p: 0.02, items: { leatherjacket: 2, pipewrench: 0.5, legrig: 0.2 } },
  police: { p: 0.04, items: { legrig: 2, anglelight: 1, halligan: 0.5, rangefinder: 0.3 } },
  military: { p: 0.04, items: { anglelight: 2, legrig: 1, rangefinder: 1 } },
  crash_mil: { p: 0.02, items: { anglelight: 1, rangefinder: 0.5 } },
  gunstore: { p: 0.1, items: { rangefinder: 2, legrig: 2.5 } }, // shops.js: the gun and gear shops' racks (was 0.05, legrig 1)
  pawnshop: { p: 0.1, items: { legrig: 1.5, rangefinder: 1, solarlantern: 2, anglelight: 1, leatherjacket: 2, motopants: 1, pipewrench: 1.5 } }, // shops.js: what was pawned
  lodge: { p: 0.04, items: { rangefinder: 1, solarlantern: 1.5, anglelight: 0.5 } },
  campground: { p: 0.04, items: { solarlantern: 2, anglelight: 1 } },
  cabin: { p: 0.03, items: { solarlantern: 1, rangefinder: 0.5, leatherjacket: 0.5 } },
  farm: { p: 0.02, items: { pipewrench: 2, leatherjacket: 0.6, rangefinder: 0.3 } },
  truckstop: { p: 0.03, items: { leatherjacket: 1.5, motopants: 0.6, solarlantern: 0.6, pipewrench: 0.6 } },
  gas: { p: 0.02, items: { pipewrench: 1, solarlantern: 0.5 } },
};
/** @type {Record<string, { p: number, items: Record<string, number> }>} */
export const AREA_SURV = {
  house: { p: 0.02, items: { leatherjacket: 1, solarlantern: 0.6, pipewrench: 0.4 } },
  garage: { p: 0.04, items: { pipewrench: 2, leatherjacket: 0.6, motopants: 0.6 } },
  hardware: { p: 0.05, items: { pipewrench: 3, solarlantern: 1, halligan: 0.3 } }, // shops.js
  workshop: { p: 0.04, items: { pipewrench: 2, halligan: 0.2, chainsleeves: 0.4 } },
  kitchen: { p: 0.02, items: { chainsleeves: 1 } },
  store: { p: 0.02, items: { solarlantern: 1, leatherjacket: 0.6, chainsleeves: 0.3 } },
  clinic: { p: 0.03, items: { jumpbag: 1 } },
  armory: { p: 0.04, items: { legrig: 2, anglelight: 1, rangefinder: 0.4 } },
  barracks: { p: 0.04, items: { anglelight: 2, legrig: 1 } },
  campsite: { p: 0.04, items: { solarlantern: 2, anglelight: 0.6 } },
  cabin: { p: 0.03, items: { solarlantern: 1, rangefinder: 0.4 } },
  gunshop: { p: 0.08, items: { rangefinder: 1.5, legrig: 2 } },
  pawnshop: { p: 0.08, items: { legrig: 1.2, rangefinder: 0.8, solarlantern: 1.5, anglelight: 0.8, leatherjacket: 1.5, motopants: 0.6, pipewrench: 1 } },
  roadcars: { p: 0.02, items: { leatherjacket: 1, pipewrench: 0.5, motopants: 0.3 } },
};
/** @type {Record<string, { p: number, items: Record<string, number> }>} */
export const WARE_SURV = {
  traders: { p: 0.2, items: { pipewrench: 1, leatherjacket: 1, solarlantern: 1, rangefinder: 0.5, anglelight: 0.5 } },
  military: { p: 0.2, items: { anglelight: 2, legrig: 1, rangefinder: 1 } },
  raider: { p: 0.15, items: { leatherjacket: 2, motopants: 1, halligan: 0.4, pipewrench: 1 } },
  expansionist: { p: 0.12, items: { legrig: 1, halligan: 0.5, chainsleeves: 0.5 } },
  fortress: { p: 0.12, items: { halligan: 1, chainsleeves: 1, jumpbag: 0.5 } },
  commune: { p: 0.12, items: { solarlantern: 1, pipewrench: 1, jumpbag: 0.3 } },
  zealot: { p: 0.08, items: { leatherjacket: 1, chainsleeves: 0.5 } },
  merchants: { p: 0.25, items: { rangefinder: 1, solarlantern: 1, chainsleeves: 0.6, jumpbag: 0.5, legrig: 0.5 } },
};
// What the AI's people have on them (combat.js KITS loot lists, appended: on their bodies after a fight).
/** @type {Record<string, Record<string, string[]>>} */
export const SURV_KIT_PATCH = {
  raiders:   { loot: ["leatherjacket", "pipewrench"] },
  survivors: { loot: ["solarlantern", "pipewrench"] },
  militia:   { loot: ["rangefinder"] },
  soldiers:  { loot: ["anglelight"] },
  guards:    { loot: ["legrig"] },
  fighters:  { loot: ["halligan"] },
};

// The Help topic (ui/help.js, after "Knives and swords").
export const SURV_HELP = `<b>Survival guns.</b> The SKS carbine (7.62×39 like the AK, a fixed ten-round magazine filled three at a
  time or at once from a stripper clip; cheap and all but unbreakable), the Uzi (a heavy open-bolt 9mm with its own 20- and
  32-round magazines, steadier on full auto than the newer submachine guns), the folding 9mm carbine (it takes the polymer
  9mm pistols' magazines), the bullpup pump shotgun (fourteen shells in twin tubes, short through a door, a little fussy)
  and the takedown .22 survival rifle (the lightest rifle there is, eight-round magazines, jams). <b>Their parts</b>: a
  digital night vision scope (+8 aim at night), a compact 2× prism, a folding AK stock (an SKS takes it too), an angled
  foregrip, a linear compensator (steadier, and no louder), a single-point sling and a flashlight duct-taped to the
  barrel. <b>Survival gear</b>: the Halligan bar (forces locks like a crowbar and punches through skulls), the pipe
  wrench (a club that never breaks), armour against teeth (a leather jacket, a butcher's chainmail sleeves, armoured
  motorcycle trousers), an angle-head flashlight (hands free, further than a headlamp), a solar camping lantern, a
  drop-leg rig, a paramedic's jump bag (+3 Medicine) and a laser rangefinder. Fire stations, hardware stores, garages,
  malls, kitchens, police and army sites, lodges and campgrounds keep them; traders sell them.`;

// data-shops.js: the town's and the city's shops and services (their rows; this module's own rows win).
mergeRows(SURV_FINDS, ROWS.SURV_FINDS); mergeRows(AREA_SURV, ROWS.AREA_SURV);
