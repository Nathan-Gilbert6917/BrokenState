// @ts-check
// Tents (tents.js; the user's request 2026-10-20: "Add tents as items that can be found: 1x2 tile tent for 1 person,
// 2x2 tile tents for 2 people, 3x3 tile tents for 4 people. These are obtained by portable tent bags which have one of
// the 3 tents in it, that can be carried in the carried slot and can be put in vehicles. These are ways to set up camp
// quicker on explorations. AI groups do the same. For the hardcore mode provide X 1x2 tile tents for each starting
// survivor. Tents have some storage away from the elements. Makeshift tents have none, 1x2 has some, 2x2 has double
// 1x2 and 3x3 has 4 times 1x2 storage."). Plain data that imports nothing; data.js merges TENT_GEAR into GEAR, loot.js
// TENT_TAGS into ITEM_TAGS.
//
// ONE PLACE FOR THE NUMBERS (the pt-int merge, 2026-10-20: the only tent table). TENT_TYPES is the tent as a map piece
// and a bed: its footprint (w × h cells on a base's map), its sleepers, the kg it keeps out of the weather (storeKg:
// 0 / S / 2S / 4S), the mood a night in it is worth (beds.js bedSlots: a bed among the base's beds, best first) and
// whether it comes in a bag. buildings.js TENTS is this table (re-exported, not a copy): the base map's tent pieces
// (basemap.js pitchTent, a record { type: "tent", tent: k } in base.buildings) read it, and the bags (TENT_GEAR) carry
// the same keys: a bag of key k pitches a tent of type k.
//   makeshift  1 × 2, 1 sleeper, no storage, mood −1: the only one built (tarps and poles, on the base map); no bag
//   tent1      1 × 2, 1 sleeper, S kg, mood 0
//   tent2      2 × 2, 2 sleepers, 2S kg, mood 0
//   tent4      3 × 3, 4 sleepers, 4S kg, mood 0
//
// THE BAGS (TENT_GEAR). slot "pack" + bulky: never worn, never in a pack, a pocket or a rig pouch; carried in the arms
// (the In arms slot: inventory.js isCarryable reads `arms`; the four-person tent's big bag takes both arms, twoHands),
// in a cart's bed (its kg allowing), in the team's cargo (a vehicle's trunk when it has one) or a base's armory. No
// wear (no dur): a tent in a bag is a tent.
/** S: the kg a one-person tent keeps out of the weather, the unit of every tent's storage. */
export const TENT_S = 15;
/** @type {Record<string, { name: string, w: number, h: number, sleepers: number, storeKg: number, mood: number, bag: boolean, buildable?: boolean }>} */
export const TENT_TYPES = {
  makeshift: { name: "Makeshift tent", w: 1, h: 2, sleepers: 1, storeKg: 0, mood: -1, bag: false, buildable: true },
  tent1: { name: "One-person tent", w: 1, h: 2, sleepers: 1, storeKg: TENT_S, mood: 0, bag: true },
  tent2: { name: "Two-person tent", w: 2, h: 2, sleepers: 2, storeKg: 2 * TENT_S, mood: 0, bag: true },
  tent4: { name: "Four-person tent", w: 3, h: 3, sleepers: 4, storeKg: 4 * TENT_S, mood: 0, bag: true },
};
/** The bag keys, smallest first. */
export const TENT_BAGS = ["tent1", "tent2", "tent4"];

// The rules (tents.js):
//   PITCH_FULL   hours to set up camp (staging.js Set up camp, Establish base, Build outpost) when the team's bags sleep
//                everyone: 30 minutes against the hour of tarps and bedrolls (buildings.js CAMP.setupHours). Bags that
//                sleep only some of them: between the two by the share they sleep.
//   (Sleeping rough at a base, a camp included, is beds.js's one rule: bedLine, data-beds.js BED_MOOD.rough and
//                ROUGH_WEATHER. The road's is here.)
//   ROAD_ROUGH   mood a night for whoever the team's bags do not sleep on the road (nightmarch.js Make camp, orders.js
//                rest "camp"): spread over the night's hours, ×WET on a wet night.
//   SPOIL        the AI bands' coarse food aging (foods.js ageCoarse) on the share of their fresh food their pitched
//                tents hold: storage.js FACTOR.dry / FACTOR.outside (the player's camp: storage.js storeSpaces' Tents room).
//   HARDCORE     X: one-person tent bags a starting survivor gets in a hardcore start (hardcore-start.js).
export const TENTS = { PITCH_FULL: 0.5, WET: 2, ROAD_ROUGH: 2, SPOIL: 1 / 1.5, HARDCORE: 1 };

/** @type {Record<string, any>} */
export const TENT_GEAR = {
  tent1: { name: "One-person tent", slot: "pack", skill: null, power: 0, req: 0, value: 12, noise: 0, bulky: true, arms: true, weight: 2.5, cat: "camp", tent: "tent1",
    desc: `A one-person backpacking tent rolled in its bag with poles and pegs. Carried in the arms (In arms), in a cart or in the cargo (a vehicle's trunk). At a camp it sleeps 1 under cover and keeps ${TENT_S} kg out of the weather (food in it keeps as in a pantry, gear in it does not weather). A team whose bags sleep everyone sets up camp in half an hour instead of an hour. Struck, it is a bag again.` },
  tent2: { name: "Two-person tent", slot: "pack", skill: null, power: 0, req: 0, value: 20, noise: 0, bulky: true, arms: true, weight: 4.5, cat: "camp", tent: "tent2",
    desc: `A two-person dome tent in its bag. Carried in the arms (In arms), in a cart or in the cargo (a vehicle's trunk). At a camp it sleeps 2 under cover and keeps ${2 * TENT_S} kg out of the weather. A team whose bags sleep everyone sets up camp in half an hour instead of an hour. Struck, it is a bag again.` },
  tent4: { name: "Four-person tent", slot: "pack", skill: null, power: 0, req: 0, value: 35, noise: 0, bulky: true, arms: true, twoHands: true, weight: 9, cat: "camp", tent: "tent4",
    desc: `A big four-person family tent in a long duffle: it takes both arms (In arms), a cart or the cargo (a vehicle's trunk). At a camp it sleeps 4 under cover and keeps ${4 * TENT_S} kg out of the weather. A team whose bags sleep everyone sets up camp in half an hour instead of an hour. Struck, it is a bag again.` },
};

// Where they are kept (loot.js ITEM_TAGS): camping and outdoors places, the sporting goods aisle, a house's garage,
// army stores.
const TAGS = ["camp", "outdoor", "sport", "garage", "home", "military"];
/** @type {Record<string, string[]>} */
export const TENT_TAGS = { tent1: TAGS, tent2: TAGS, tent4: TAGS };

// The hour-by-hour search (scavenge.js; tents.js rollTentFind, its own dice), by the site or the point of interest
// searched (data.js LOCATIONS keys): p a search hour at a full pool, items the weights. The four-person tent is rarest.
/** @type {Record<string, { p: number, items: Record<string, number> }>} */
export const TENT_FINDS = {
  campground: { p: 0.05, items: { tent1: 3, tent2: 2.5, tent4: 0.7 } },   // left in the sites
  campsite: { p: 0.06, items: { tent1: 3, tent2: 2.5, tent4: 0.6 } },
  hikercamp: { p: 0.06, items: { tent1: 4, tent2: 1.5, tent4: 0.3 } },
  ranger: { p: 0.03, items: { tent1: 2, tent2: 1.5, tent4: 0.5 } },
  lodge: { p: 0.03, items: { tent1: 2, tent2: 1.5, tent4: 0.5 } },
  cabin: { p: 0.02, items: { tent1: 2, tent2: 1, tent4: 0.3 } },
  mall: { p: 0.025, items: { tent1: 2, tent2: 2, tent4: 0.6 } },          // the sporting goods store
  town: { p: 0.006, items: { tent1: 1, tent2: 1, tent4: 0.2 } },          // a sports shop on the main street
  garage: { p: 0.02, items: { tent1: 1.5, tent2: 2, tent4: 0.5 } },       // on the shelf above the car
  house: { p: 0.008, items: { tent1: 1, tent2: 1.5, tent4: 0.4 } },
  neighbourhood: { p: 0.012, items: { tent1: 1, tent2: 1.5, tent4: 0.4 } },
  military: { p: 0.03, items: { tent1: 2, tent2: 1, tent4: 0.5 } },       // army issue
  convoy: { p: 0.03, items: { tent1: 2, tent2: 1, tent4: 0.5 } },
  airdrop: { p: 0.02, items: { tent1: 1, tent2: 1, tent4: 0.4 } },
  crash_cargo: { p: 0.02, items: { tent1: 1, tent2: 1, tent4: 0.3 } },
};
// A raid's containers (combat.js searchBox; tents.js rollAreaTent, its own dice), by the raid area: p a container.
/** @type {Record<string, { p: number, items: Record<string, number> }>} */
export const AREA_TENTS = {
  campsite: { p: 0.12, items: { tent1: 3, tent2: 2.5, tent4: 0.6 } },
  cargodrop: { p: 0.05, items: { tent1: 1, tent2: 1, tent4: 0.4 } },
  barracks: { p: 0.04, items: { tent1: 2, tent2: 1, tent4: 0.5 } },
  cabin: { p: 0.04, items: { tent1: 2, tent2: 1, tent4: 0.3 } },
  garage: { p: 0.03, items: { tent1: 1.5, tent2: 2, tent4: 0.5 } },
  lockers: { p: 0.02, items: { tent1: 2, tent2: 1, tent4: 0.2 } },
  house: { p: 0.008, items: { tent1: 1, tent2: 1.5, tent4: 0.4 } },
  farmhouse: { p: 0.01, items: { tent1: 1, tent2: 1.5, tent4: 0.4 } },
};
// What the bands set out with (tents.js bandTentKit, its own dice): the share of their heads their bags sleep, and
// the bags they prefer, biggest first. The drifters' shelters are makeshift (tarps and sticks: no bag, nothing to
// carry or find); the raiders from beyond the border are kit "raiders".
/** @type {Record<string, { share: number, bags: string[] }>} */
export const BAND_TENTS = {
  drifters: { share: 0, bags: [] },
  looters: { share: 0.4, bags: ["tent2", "tent1"] },
  survivalists: { share: 1, bags: ["tent2", "tent1"] },
  preppers: { share: 1, bags: ["tent4", "tent2", "tent1"] },
  raiders: { share: 0.5, bags: ["tent2", "tent1"] },
};
