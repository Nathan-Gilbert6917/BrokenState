// @ts-check
// Amusement parks, fairgrounds and water parks as places (issue #60 of the round-2 epic #39; the user's request
// 2026-10-26: "amusement parks"). Pure data (it imports nothing), merged by the modules that take each part, as
// data-shops.js NEW_KINDS is:
//
//   PARK_KINDS   the site type "amusement" (data-shops.js NEW_KINDS: data.js LOCATIONS from site, loot.js SITE_TAGS from
//                tags, combat.js AREA_SETS from areas, battlesize.js SIZES.SITE from size). Its raid map is the whole
//                park (amusement.js parkMap, on compound.js); where it stands: data-placement.js PLACEMENT_ROWS and
//                placement.js PLACE_EXTRA (#42), a new world's only.
//   PARK_AREA_DEFS  its raid rooms (data-shops.js AREA_DEFS → combat.js AREAS, loot.js AREA_TAGS): a concession stand's
//                snacks, a games booth's prizes, the gift shop, the first-aid station, the maintenance shop's tools and
//                parts, the fuel for the generators and the go-karts, the cash office (its safe: buildingmaps.js boxLock),
//                the employees' lockers, a ride's station, a fair's exhibition hall.
//   PARK_GEAR    the prizes: a stuffed prize bear (data.js GEAR), kept only where a park keeps it (PARK_TAGS: loot.js
//                ITEM_TAGS, the "park" tag no other place has, so no other place's pool or trader draws it).
// Every tag but "park" is one the other places already use (loot.js), so the theme check (tools/loottest.js) reads the
// park's rooms as it reads a mall's.

export const PARK_KINDS = {
  amusement: {
    site: { name: "Amusement park", glyph: "Ap", cat: "urban", danger: 2, gearRate: 1.2, loot: { food: 3, water: 2, scrap: 2, parts: 1.5, fuel: 1, meds: 0.4 },
      gear: ["flashlight", "handradio", "slingbag", "backpack", "toolbox", "prybar", "hammer", "bandagekit", "candy", "plush", "cashbox"], richness: 0.85, known: "public" },
    tags: ["park", "shop", "kitchen", "tools", "garage", "mall", "medical"],
    areas: ["concession", "midway", "giftshop", "ridemaint", "parkstaff", "wreck"], size: 1, storeys: [1, 2],
  },
};

export const PARK_AREA_DEFS = {
  concession: { tags: ["park", "kitchen", "shop"], def: { name: "Concession stand", boxes: ["counter", "shelf", "freezer"],
    loot: { food: [0.85, 3, 8], water: [0.75, 2, 6] }, gear: [["candy", 0.12], ["chocolate", 0.1], ["knife", 0.03]] } },
  midway: { tags: ["park", "shop"], def: { name: "Games booth", boxes: ["shelf", "counter", "shelf"],
    loot: { scrap: [0.3, 1, 2], food: [0.15, 1, 2] }, gear: [["plush", 0.35], ["candy", 0.08], ["firecracker", 0.03]] } },
  giftshop: { tags: ["park", "shop", "mall"], def: { name: "Gift shop", boxes: ["shelf", "shelf", "counter"],
    loot: { scrap: [0.35, 1, 3], water: [0.3, 1, 3], food: [0.3, 1, 3] }, gear: [["plush", 0.2], ["candy", 0.1], ["chocolate", 0.06], ["slingbag", 0.04], ["backpack", 0.03], ["flashlight", 0.03], ["comic", 0.02]] } },
  parkaid: { tags: ["park", "medical"], def: { name: "First-aid station", boxes: ["cabinet", "shelf", "locker"],
    loot: { meds: [0.8, 1, 4], water: [0.45, 1, 3] }, gear: [["bandagekit", 0.16], ["surgkit", 0.02]] } },
  ridemaint: { tags: ["park", "tools", "garage"], def: { name: "Maintenance shop", boxes: ["crate", "locker", "shelf"],
    loot: { parts: [0.7, 1, 3], scrap: [0.75, 2, 6], fuel: [0.3, 1, 3] }, gear: [["toolbox", 0.06], ["hammer", 0.05], ["prybar", 0.05], ["crowbar", 0.03], ["sledge", 0.03], ["repairkit", 0.03], ["flashlight", 0.05], ["headlamp", 0.03]] } },
  parkfuel: { tags: ["park", "garage", "tools"], def: { name: "Fuel and generators", boxes: ["crate", "shelf"],
    loot: { fuel: [0.75, 2, 6], parts: [0.35, 1, 2] }, gear: [["flashlight", 0.03]] } },
  cashoffice: { tags: ["park", "office", "shop"], def: { name: "Cash office", boxes: ["cabinet", "counter"],
    loot: { scrap: [0.3, 1, 2], water: [0.2, 1, 2] }, gear: [["cashbox", 0.12], ["handradio", 0.05], ["flashlight", 0.04]] } },
  parkstaff: { tags: ["park", "office", "kitchen"], def: { name: "Employee area", boxes: ["locker", "locker", "cabinet"],
    loot: { food: [0.45, 1, 4], water: [0.45, 1, 3], meds: [0.08, 1, 1], scrap: [0.25, 1, 2] }, gear: [["backpack", 0.04], ["slingbag", 0.04], ["flashlight", 0.04], ["cards", 0.03]] } },
  ridestation: { tags: ["park", "tools", "tech"], def: { name: "Ride station", boxes: ["cabinet", "locker"],
    loot: { parts: [0.3, 1, 2], scrap: [0.35, 1, 3], water: [0.2, 1, 2] }, gear: [["handradio", 0.05], ["flashlight", 0.04]] } },
  exhibit: { tags: ["park", "kitchen", "shop"], def: { name: "Exhibition hall", boxes: ["shelf", "counter", "shelf"],
    loot: { food: [0.5, 2, 6], preserved: [0.35, 1, 4], scrap: [0.3, 1, 3] }, gear: [["candy", 0.04]] } },
};

export const PARK_GEAR = {
  plush: { name: "Stuffed prize bear", slot: "pack", skill: null, power: 0, req: 0, value: 3, noise: 0, weight: 0.4, cat: "luxury", comfort: { team: 0.2 },
    desc: "Won at a ring toss by somebody, once. Something soft to hold at night: +0.2 mood a day for everyone at the base or on the team that has one." },
};
// Where they are kept (loot.js ITEM_TAGS).
export const PARK_TAGS = { plush: ["park"] };
