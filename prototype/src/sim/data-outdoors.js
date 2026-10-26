// @ts-check
// Golf courses, campgrounds and RV parks as places (issue #61 of the round-2 epic #39, the user's request 2026-10-26:
// "golf clubhouse, camp grounds, RV parks"). Pure data with no imports, merged by data-shops.js into its tables as
// data-offices.js is (NEW_KINDS, AREA_DEFS, ROWS), so data.js LOCATIONS, loot.js SITE_TAGS / AREA_TAGS, combat.js AREAS
// / AREA_SETS and battlesize.js SIZES.SITE each take their slice. The maps are outdoors.js's.
//
// OUTDOOR_KINDS: the site types new with this module. The campground is the old one (data.js LOCATIONS campground,
//   a forest site of mapgen.js): only its raid map is new (outdoors.js), so it has no row here.
//   golfcourse  a golf course: its clubhouse (the bar, the pro shop), the cart barn (carts, fuel, tools), the
//               maintenance shed and the starter's hut; near the towns and the cities (placement.js PLACE_EXTRA).
//   rvpark      an RV park: the office, the laundry, the dump station, pads with parked RVs and trailers (each a
//               container: its own stores, propane), a pool; by the highways, the lakes and in scenic land.
// OUTDOOR_AREAS: their raid rooms (combat.js AREAS; tags: loot.js AREA_TAGS): the pro shop, the cart barn, the golf
//   carts out on the course, the camp store, the bathhouse, a tent site's cooler and picnic table, an RV pad's RV, the
//   coin laundry. A clubhouse's bar is data-shops.js's bar, its kitchen and locker rooms the usual ones.
// OUTDOOR_ROWS: their rows in the find tables (each module merges its own: loot.js SITE_FINDS …).

/** @type {Record<string, any>} */
export const OUTDOOR_KINDS = {
  golfcourse: {
    site: { name: "Golf course", glyph: "Gf", cat: "town", danger: 1, gearRate: 1.1, loot: { food: 2, water: 2, fuel: 0.8, scrap: 1, parts: 0.5 },
      gear: ["golfclub", "slingbag", "duffle", "leatherjacket", "flashlight", "binoculars", "prybar", "hammer", "handwarmer"], richness: 0.5, known: "public" },
    tags: ["sport", "shop", "kitchen", "garage", "outdoor", "tools", "office", "travel"], // office, travel: the members' cigars and scotch
    areas: ["proshop", "bar", "kitchen", "cartbarn", "golfcart", "wreck"], size: 2, storeys: [1, 2],
  },
  rvpark: {
    site: { name: "RV park", glyph: "Rv", cat: "rural", danger: 1, loot: { food: 3, water: 3, fuel: 1.2, meds: 0.4, scrap: 1, parts: 0.5 },
      gear: ["stove", "lantern", "hikingpack", "backpack", "waterfilter", "flashlight", "revolver", "shotgun", "hatchet", "fishrod", "bicycle", "binoculars"], richness: 0.45, known: "road" },
    tags: ["camp", "outdoor", "home", "travel", "garage"],
    areas: ["rvpad", "rvpad", "coinlaundry", "office", "wreck"], size: 2, storeys: [1, 1],
  },
};

// ---------- their raid rooms (combat.js AREAS; tags: loot.js AREA_TAGS) ----------
/** @type {Record<string, { tags: string[], def: any }>} */
export const OUTDOOR_AREAS = {
  // A clubhouse's pro shop: clubs and bags, golf shirts and jackets, balls and gloves, drinks and snacks at the counter.
  proshop: { tags: ["sport", "shop", "mall", "travel"], def: { name: "Pro shop", boxes: ["shelf", "counter", "locker"],
    loot: { water: [0.4, 1, 3], food: [0.3, 1, 2], scrap: [0.15, 1, 2] },
    gear: [["golfclub", 0.24], ["slingbag", 0.05], ["duffle", 0.05], ["leatherjacket", 0.03], ["handwarmer", 0.04], ["flashlight", 0.02]] } },
  // The cart barn: the fleet's charging bays, its fuel for the mowers and the gas carts, the mechanic's tools and parts.
  cartbarn: { tags: ["garage", "tools", "outdoor", "farm", "sport"], def: { name: "Cart barn", boxes: ["crate", "locker", "shelf"],
    loot: { fuel: [0.65, 2, 6], parts: [0.55, 1, 3], scrap: [0.5, 2, 5] },
    gear: [["prybar", 0.05], ["hammer", 0.05], ["crowbar", 0.03], ["golfclub", 0.04], ["flashlight", 0.04], ["hatchet", 0.02]] } },
  // A golf cart left out on the course: the bag on its back, a cooler, a bottle of water.
  golfcart: { tags: ["sport", "outdoor", "travel", "tools"], def: { name: "Golf carts", outdoor: true, boxes: ["car"],
    loot: { water: [0.45, 1, 3], food: [0.2, 1, 2], parts: [0.2, 1, 1] },
    gear: [["golfclub", 0.3], ["slingbag", 0.04], ["flashlight", 0.03]] } },
  // A campground's or a lake's camp store: food and drink, camp fuel and propane, first aid, the camping gear.
  campstore: { tags: ["camp", "outdoor", "shop", "travel", "medical", "kitchen", "hunt"], def: { name: "Camp store", boxes: ["shelf", "shelf", "counter"],
    loot: { food: [0.8, 3, 8], water: [0.7, 2, 6], meds: [0.25, 1, 2], propane: [0.35, 1, 2], fuel: [0.2, 1, 2] },
    gear: [["stove", 0.05], ["lantern", 0.05], ["headlamp", 0.05], ["waterfilter", 0.04], ["puritabs", 0.06], ["bandagekit", 0.06], ["hikingpack", 0.03], ["fishrod", 0.04], ["hatchet", 0.03], ["flashlight", 0.04], ["handwarmer", 0.04]] } },
  // A bathhouse's lockers and shelves: soap and towels left behind, a first-aid box, a torch.
  bathhouse: { tags: ["home", "camp", "medical"], def: { name: "Bathhouse", boxes: ["locker", "shelf"],
    loot: { water: [0.35, 1, 2], meds: [0.12, 1, 1], scrap: [0.15, 1, 2] },
    gear: [["wetwipes", 0.06], ["toothpaste", 0.05], ["bandagekit", 0.08], ["puritabs", 0.05], ["flashlight", 0.02]] } }, // the first-aid box on the wall
  // A tent site: the cooler by the picnic table, the camp box (a tent's own storage is campsite.js tentBoxLoot).
  tentsite: { tags: ["camp", "outdoor", "travel", "hunt", "kitchen"], def: { name: "Tent sites", outdoor: true, boxes: ["crate"],
    loot: { food: [0.5, 1, 4], water: [0.5, 1, 3], fuel: [0.1, 1, 2], propane: [0.15, 1, 1] },
    gear: [["stove", 0.04], ["lantern", 0.04], ["headlamp", 0.04], ["hikingpack", 0.03], ["knife", 0.04], ["hatchet", 0.03], ["fishrod", 0.03], ["waterfilter", 0.03], ["flashlight", 0.03], ["bandagekit", 0.03], ["puritabs", 0.03]] } },
  // An RV on its pad: someone's home on wheels (lootsense.js PERSONAL): the pantry and the fridge, the water tank,
  // the propane bottles and the fuel, the first-aid kit, the camping gear, a gun in the bedroom now and then.
  rvpad: { tags: ["home", "travel", "camp", "outdoor", "garage", "hunt"], def: { name: "RV sites", outdoor: true, boxes: ["car"],
    loot: { food: [0.7, 2, 6], water: [0.65, 2, 6], meds: [0.22, 1, 2], propane: [0.55, 1, 2], fuel: [0.35, 1, 4], ammo: [0.12, 4, 10] },
    gear: [["stove", 0.05], ["lantern", 0.04], ["hikingpack", 0.03], ["backpack", 0.03], ["waterfilter", 0.03], ["flashlight", 0.05], ["fishrod", 0.04], ["bicycle", 0.02], ["revolver", 0.02], ["shotgun", 0.015], ["binoculars", 0.03], ["bandagekit", 0.04], ["hatchet", 0.03]] } },
  // A park's coin laundry: the clothes left in the machines and on the folding table, a bag, a little change.
  coinlaundry: { tags: ["home", "shop", "camp"], def: { name: "Coin laundry", boxes: ["shelf", "cabinet"],
    loot: { scrap: [0.4, 1, 3], water: [0.25, 1, 2] },
    gear: [["leatherjacket", 0.06], ["slingbag", 0.05], ["backpack", 0.04], ["duffle", 0.04]] } },
};

// ---------- their rows in the find tables (loot.js and the others merge them: a table's own rows win) ----------
export const OUTDOOR_ROWS = {
  SITE_FINDS: {
    golfcourse: { p: 0.08, items: { cards: 1, cigars: 1.5, whiskey: 1, scotch: 1, chocolate: 1, lighters: 1 } },
    rvpark: { p: 0.1, items: { cards: 1.5, handwarmer: 1, puritabs: 1, instcoffee: 1.5, lighters: 1, harmonica: 0.5, chocolate: 1, wetwipes: 1 } },
  },
};
