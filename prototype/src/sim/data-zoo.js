// @ts-check
// Zoos (issue #59 of the round-2 epic #39, the user's request 2026-10-26: "zoos"): their plain data, imported by the
// modules that merge it (no imports here, so nothing cycles):
//   ZOO_AREAS  the zoo's own raid rooms (data-shops.js AREA_DEFS spreads them: combat.js AREAS, loot.js AREA_TAGS):
//              a keepers' room, the food prep (the commissary), an animal house's public hall and its dens and stalls,
//              the gift shop. The café is #16's kitchen and dining rooms, the vet hospital #14's vet rooms ("vet"), the
//              service yard a garage and a workshop, the ticket office and the staff block offices.
//   ZOO_BOX    the pieces' own tables (combat.js BOX_LOOT): the vet's dart cabinet (the sedatives and the
//              tranquilliser darts), the feed sacks in an animal house's and the food prep's crates. The food prep's
//              chest freezers, butcher's cases and walk-in freezer shelving are the shops' (combat.js BOX_LOOT freezer,
//              meatcase, freezershelf: their meat spoiled since the power failed, kept in winter), its produce bins the
//              grocer's (producebin: the onions and potatoes that keep).
//   ZOO_GEAR   the new item: tranquilliser darts (data.js merges it into GEAR).
// The numbers keep a zoo's loot per area inside the economy's band (#43, tools/lootsensetest.js BASELINE zoo): an
// animal house holds what a barn does, the food prep a little less than a restaurant's kitchen (the meat has gone
// bad), the keepers' room an office's, the gift shop a cinema's concession stand's.

/** @type {Record<string, { tags: string[], def: any }>} */
export const ZOO_AREAS = {
  // The keepers' room (a keeper area, the staff block's locker room): their lockers (their own things: home) and the
  // radios, torches, a machete for the brush, a pry bar, the first-aid kit.
  zookeeper: { tags: ["farm", "tools", "outdoor", "home"], def: { name: "Keepers' room", boxes: ["locker", "locker", "cabinet"],
    loot: { food: [0.3, 1, 3], water: [0.4, 1, 3], meds: [0.15, 1, 1], scrap: [0.3, 1, 2] },
    gear: [["handradio", 0.08], ["flashlight", 0.08], ["machete", 0.03], ["knife", 0.04], ["prybar", 0.03], ["bandagekit", 0.04], ["binoculars", 0.02]] } },
  // The food prep (the commissary): the meat and fish for the carnivores, the produce for the rest, the feed; its
  // freezers and cases have their own tables (above).
  zoofood: { tags: ["kitchen", "farm"], def: { name: "Food prep", boxes: ["freezer", "meatcase", "producebin"],
    loot: { food: [0.5, 2, 6], water: [0.3, 1, 3] }, gear: [["knife", 0.08], ["machete", 0.02]] } },
  // An animal house: the public viewing hall and the dens, stalls and terraria behind it, the keepers' passage; feed,
  // straw, a few tools (its feed store's).
  animalhouse: { tags: ["farm", "outdoor", "tools"], def: { name: "Animal house", boxes: ["crate", "shelf", "cabinet"],
    loot: { food: [0.4, 1, 4], scrap: [0.2, 1, 2], water: [0.2, 1, 2] }, gear: [["flashlight", 0.03], ["prybar", 0.02]] } },
  // The gift shop: plush animals and T-shirts, guidebooks, sweets and drinks by the till.
  giftshop: { tags: ["shop", "mall", "home"], def: { name: "Gift shop", boxes: ["shelf", "shelf", "counter"],
    loot: { food: [0.35, 1, 3], water: [0.35, 1, 3], scrap: [0.25, 1, 2] },
    gear: [["candy", 0.08], ["chocolate", 0.06], ["binoculars", 0.03], ["backpack", 0.03], ["slingbag", 0.04], ["flashlight", 0.03], ["magazines", 0.03], ["comic", 0.03]] } },
};

/** @type {Record<string, any>} */
export const ZOO_BOX = {
  // The vet hospital's dart cabinet: the sedatives (meds) and the tranquilliser darts, now and then the surgical kit.
  dartcab: { rest: 0, loot: { meds: [0.85, 2, 5] }, gear: [["tranqdarts", 0.6], ["surgkit", 0.03]] },
  // Sacks of feed and pellets in an animal house's and the food prep's crates: food, at a low worth (as a vet's food store).
  "crate@animalhouse": { rest: 0, loot: { food: [0.7, 1, 4] }, gear: [] },
  "crate@zoofood": { rest: 0, loot: { food: [0.75, 2, 5] }, gear: [] },
};

/** @type {Record<string, any>} */
export const ZOO_GEAR = {
  // A zoo vet's darts (the dart rifle stays in its case: no dart gun in the game yet, docs/features/combat.md "Zoos").
  tranqdarts: { name: "Tranquilliser darts", slot: "pack", skill: null, power: 0, req: 0, value: 22, noise: 0, small: true, weight: 0.3, cat: "medical",
    desc: "A zoo vet's case of tranquilliser darts, loaded with etorphine and ketamine for animals ten times your size. The dead have no blood to carry it. Worth a lot to a doctor or a trader." },
};
