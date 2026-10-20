// @ts-check
// Beds as furniture (2026-10-20, the user's request: "Cots 1x2 mood debuff, Beds 1x2, bunkbeds 1x2 mood debuff and
// large beds 2x2 mood buff can be created and set in buildings to add beds for a base"). Plain data that imports
// nothing; the rules are sim/beds.js. Merged by: data.js (BED_GEAR into GEAR), crafting.js (BED_CRAFTS into CRAFTS),
// buildings.js (BED_BUILDINGS into BUILDINGS), basemap.js (BED_FOOT into FOOT), loot.js (BED_TAGS into ITEM_TAGS),
// groupbases.js (BED_WORKS_BUILDING into WORKS_BUILDING).
//
// Four pieces, cheapest to dearest (BED_KINDS). Each is an item while it is in the stores or carried (bulky, both
// arms: the In arms slot, a cart or the team's cargo, never a pocket or a pack), crafted at a crafting bench (the
// default for a recipe with no `needs`), and a placed thing once it is set inside a general building on the base map
// (BUILDINGS fit + furniture: it stands on the floor of a hut, cabin, lodge, hall or barn, as the fittings do).
//   w × h       its footprint on the floor (turned by the map's R)
//   sleepers    the beds it adds to its base (beds.js furnitureBeds, buildings.js baseBeds)
//   mood        a day's mood for each person who sleeps in it (beds.js bedLine, relations.js moodFactors): a cot is
//               a sagging sheet of canvas, a bunk bed is cramped and shared, a bed is a bed, a large bed is the one
//               good night's sleep left in the world
/** @type {string[]} */
export const BED_KINDS = ["cot", "bed", "bunkbed", "bigbed"];
/** @type {Record<string, { name: string, w: number, h: number, sleepers: number, mood: number, word: string }>} */
export const BED_SPEC = {
  cot:     { name: "Cot",       w: 1, h: 2, sleepers: 1, mood: -1,   word: "on a cot" },
  bed:     { name: "Bed",       w: 1, h: 2, sleepers: 1, mood: 0,    word: "in a bed" },
  bunkbed: { name: "Bunk bed",  w: 1, h: 2, sleepers: 2, mood: -0.5, word: "in a bunk bed" },
  bigbed:  { name: "Large bed", w: 2, h: 2, sleepers: 2, mood: 1,    word: "in a large bed" },
};
// The rest of a base's beds (the camp's bedrolls, the shelter's and the base's own, a bunkhouse's and a barracks'
// built-in bunks) sleep as a plain bed (mood 0); the bunk beds fitting built inside a general building (buildings.js
// bunks) is a bunk bed by another road and sleeps as one. Nobody in a bed: they sleep rough (BED_MOOD.rough a day, on
// top of the base's crowding: morale.js).
export const BED_MOOD = { plain: 0, bunks: -0.5, rough: -1 };

// The items (data.js Object.assign(GEAR, BED_GEAR)). slot "pack" + bulky + twoHands: carried in both arms only (as the
// fire safe: inventory.js, carry.js handsCount), or in a cart, the team's cargo or a vehicle; kept in the base's
// armory (its weight counts against the base's storage room: basestorage.js). burnShare: the share of its weight that
// breaks down into firewood.
/** @type {Record<string, any>} */
export const BED_GEAR = {
  cot:     { name: "Cot", slot: "pack", skill: null, power: 0, req: 0, value: 6, noise: 0, weight: 7, cat: "camp", bulky: true, twoHands: true, burnShare: 0.5, furniture: "cot",
    desc: "A folding camp cot: canvas stretched over a frame of poles and scrap tubing. Set it inside a hut, cabin, lodge, hall or barn (the base map's Build list, Furniture) for 1 bed. It sags and creaks: whoever sleeps on it loses 1 mood a day. 1 × 2 cells. Carried in both arms or in a cart." },
  bed:     { name: "Bed", slot: "pack", skill: null, power: 0, req: 0, value: 14, noise: 0, weight: 22, cat: "camp", bulky: true, twoHands: true, burnShare: 0.7, furniture: "bed",
    desc: "A single bed: a plank frame, slats and a stuffed mattress. Set it inside a hut, cabin, lodge, hall or barn (the base map's Build list, Furniture) for 1 bed that sleeps as a bed should (no mood lost). 1 × 2 cells. 22 kg: carried in both arms or in a cart." },
  bunkbed: { name: "Bunk bed", slot: "pack", skill: null, power: 0, req: 0, value: 20, noise: 0, weight: 32, cat: "camp", bulky: true, twoHands: true, burnShare: 0.7, furniture: "bunkbed",
    desc: "Two beds stacked on posts with a ladder. Set it inside a hut, cabin, lodge, hall or barn (the base map's Build list, Furniture) for 2 beds on one 1 × 2 floor. Cramped and shared: each of the two loses half a mood a day. 32 kg: carried in both arms or in a cart." },
  bigbed:  { name: "Large bed", slot: "pack", skill: null, power: 0, req: 0, value: 30, noise: 0, weight: 45, cat: "camp", bulky: true, twoHands: true, burnShare: 0.6, furniture: "bigbed",
    desc: "A big double bed with a sprung mattress. Set it inside a cabin, lodge, hall or barn (the base map's Build list, Furniture) for 2 beds on a 2 × 2 floor: the two who sleep in it gain 1 mood a day. 45 kg: carried in both arms or in a cart (a hut's floor has no room for it)." },
};

// The recipes (crafting.js Object.assign(CRAFTS, BED_CRAFTS)): wood (key wood) for the frame, scrap for the fixings,
// a machine part's springs in the large bed's mattress. No `needs`: a crafting bench at the base (crafting.js
// benchNeeded), as most of the hand recipes.
/** @type {Record<string, any>} */
export const BED_CRAFTS = {
  cot:     { gear: "cot",     in: { wood: 30, scrap: 3 },             hours: 3,  skill: "mechanics", min: 0 },
  bed:     { gear: "bed",     in: { wood: 90, scrap: 4 },             hours: 6,  skill: "mechanics", min: 1 },
  bunkbed: { gear: "bunkbed", in: { wood: 140, scrap: 6 },            hours: 9,  skill: "mechanics", min: 2 },
  bigbed:  { gear: "bigbed",  in: { wood: 160, scrap: 6, parts: 1 },  hours: 12, skill: "mechanics", min: 3 },
};

// The placed pieces (buildings.js Object.assign(BUILDINGS, BED_BUILDINGS)): fit (only on a general building's floor,
// basemap.js placeProblemAt) and furniture (beds.js: set from the stores, never queued for the builders; picked up
// again by Demolish, back into the stores whole). No cost and no hours: the item is the cost. max: per base.
/** @type {Record<string, any>} */
export const BED_BUILDINGS = Object.fromEntries(BED_KINDS.map((k) => [k, {
  name: BED_SPEC[k].name, fit: true, furniture: true, cost: {}, hours: 0, max: 60,
  desc: `${BED_GEAR[k].desc.split(". Set it")[0]}. Set from the stores onto the floor of a general building: ${BED_SPEC[k].sleepers === 1 ? "1 bed" : `${BED_SPEC[k].sleepers} beds`}${BED_SPEC[k].mood ? `, ${BED_SPEC[k].mood > 0 ? "+" : "−"}${Math.abs(BED_SPEC[k].mood)} mood a day for each sleeper` : ""}. Demolish picks it up again (back into the stores).`,
}]));

// Their footprints (basemap.js Object.assign(FOOT, BED_FOOT)): bed cells on the battle map (combat.js CELL bed: half
// cover, blocks the way; barricade.js FURNITURE bed: shoved, battered to rubble), only inside a general building.
/** @type {Record<string, any>} */
export const BED_FOOT = Object.fromEntries(BED_KINDS.map((k) => [k, { kind: "prop", k: "bed", w: BED_SPEC[k].w, h: BED_SPEC[k].h, fit: true, indoor: true }]));

// Where they are kept (loot.js ITEM_TAGS).
/** @type {Record<string, string[]>} */
export const BED_TAGS = { cot: ["camp", "military", "prison", "medical", "fire"], bed: ["home", "mall"], bunkbed: ["military", "prison", "camp", "fire", "home"], bigbed: ["home", "mall"] };
// Raid wear (breakdowns.js Object.assign(FIXTURES, BED_FIXTURES)): a piece battered on the battle map wears as the
// fittings do (raid damage only); a broken one sleeps nobody until it is repaired (beds.js furnitureBeds) or picked up
// and set again. Repairs by the frame: wood is split in the work, a scrap's nails and fixings.
/** @type {Record<string, any>} */
export const BED_FIXTURES = {
  cot:     { raidOnly: true, repair: { hours: 1, cost: { scrap: 1 }, min: 0 }, rig: { hours: 1, cost: { scrap: 1 }, min: 0 }, what: "a torn cot: 1 fewer bed" },
  bed:     { raidOnly: true, repair: { hours: 1, cost: { scrap: 1 }, min: 0 }, rig: { hours: 1, cost: { scrap: 1 }, min: 0 }, what: "a smashed bed: 1 fewer bed" },
  bunkbed: { raidOnly: true, repair: { hours: 2, cost: { scrap: 2 }, min: 0 }, rig: { hours: 1, cost: { scrap: 1 }, min: 0 }, what: "a collapsed bunk bed: 2 fewer beds" },
  bigbed:  { raidOnly: true, repair: { hours: 2, cost: { scrap: 2 }, min: 0 }, rig: { hours: 1, cost: { scrap: 1 }, min: 0 }, what: "a smashed large bed: 2 fewer beds" },
};
// Loose beds and cots found on a search (beds.js rollBedFind, scavenge.js: a roll of its own each search hour, so no
// other find got rarer): rare, and only where people slept. p: the chance a search hour at full loot.
/** @type {Record<string, { p: number, items: Record<string, number> }>} */
export const BED_FINDS = {
  house: { p: 0.012, items: { bed: 1, bigbed: 1, bunkbed: 0.6 } }, neighbourhood: { p: 0.012, items: { bed: 1, bigbed: 1, bunkbed: 0.6 } },
  apartments: { p: 0.01, items: { bed: 1, bigbed: 0.8, bunkbed: 0.4 } }, motel: { p: 0.015, items: { bed: 1.5, bigbed: 1 } },
  mall: { p: 0.008, items: { bigbed: 1, bed: 1 } }, cabin: { p: 0.01, items: { bed: 1, bunkbed: 0.6 } }, ranch: { p: 0.008, items: { bed: 1, bigbed: 0.5 } },
  military: { p: 0.015, items: { cot: 2, bunkbed: 1.5 } }, prison: { p: 0.012, items: { bunkbed: 2, cot: 0.5 } }, firestation: { p: 0.012, items: { cot: 1, bunkbed: 1 } },
  hospital: { p: 0.01, items: { cot: 1 } }, lodge: { p: 0.01, items: { bunkbed: 1, cot: 1 } },
  campground: { p: 0.015, items: { cot: 2 } }, campsite: { p: 0.01, items: { cot: 1 } }, hikercamp: { p: 0.008, items: { cot: 1 } },
};

// AI groups (docs/adr/0001-ai-parity.md; beds.js groupBedsDaily): their furniture is a count a base (f.works[tile][kind],
// crafted from their stock at BED_CRAFTS' costs, one piece a day at most), set in the general building they put up
// for it (the "hall" work: your Lodge, its cost and hours as their works scale yours). Their bases' map shows them
// (groupbases.js WORKS_BUILDING: the hall a Lodge, each piece itself; the auto layout puts them on its floor in this
// order, the large beds first so the 2 × 2 finds its floor before the 1 × 2s cut it up).
/** @type {Record<string, string>} */
export const BED_WORKS_BUILDING = { hall: "gen_lodge", bigbed: "bigbed", bunkbed: "bunkbed", bed: "bed", cot: "cot" };
//   pop        the people before they want a hall (their main base) at all
//   keep       scrap a head they keep back from furniture (and the hall) for everything else
//   room       floor cells a hall gives their furniture (a Lodge's 4 × 3 floor less the cells inside its two doors and
//              a path: what the auto layout fits; tools/bedstest.js checks it)
//   morale     their desertion pressure falls by this × the mean bed mood a head (groupcare.js desertPressure), as hot
//              meals' does (groupworks.js KITCHEN.morale)
export const BEDS_AI = { pop: 6, keep: 3, room: 8, morale: 0.5 };
