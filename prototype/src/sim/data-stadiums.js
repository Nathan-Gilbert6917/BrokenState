// @ts-check
// Sports stadiums and arenas (the user's request 2026-10-26, issue #57 of the round-2 epic #39: "different sports
// stadiums 500x500 max"). Pure data that imports nothing, merged by data-shops.js into its tables as data-offices.js is
// (so data.js LOCATIONS, loot.js SITE_TAGS, AREA_TAGS and the find tables, combat.js AREAS and AREA_SETS and
// battlesize.js SIZES.SITE take these too). The venues' plans and their map are stadium.js; the rooms' styles and the
// scenes stadiumlayout.js.
//
// STADIUM_KINDS: the site type (as data-shops.js NEW_KINDS: site, tags, areas, size, storeys): "stadium", every venue
//   from a pro football stadium downtown to a county rodeo arena (stadium.js STADIUM_VARIANTS: its plan by where it
//   stands).
// STADIUM_AREAS: the venues' own raid rooms (combat.js AREAS, loot.js AREA_TAGS), as data-shops.js AREA_DEFS:
//   concessions  a concourse's concession stand: food and drink in bulk (the hot dogs long gone, the tins, chips,
//                candy and the cases of soda and water left);
//   concstore    the concessions' storeroom: pallets of the same, the richest food in the building;
//   suites       a luxury suite (and the club level): the bar's liquor, snacks, a guest's watch;
//   proshop      the team store: merchandise (caps and jerseys, bags, the sports gear sold with the logo on it);
//   stadsec      stadium security: radios, batons, cuffs, flashlights, a vest; no guns but an officer's now and then;
//   pressbox     the press box and the broadcast booths: radios, cameras, electronics;
//   groundskeep  the groundskeepers' shed and the maintenance bay: tools and fuel for the mowers.
//   The locker rooms are combat.js AREAS lockers (the team's pads, helmets, bats and sticks), the first-aid room nurse,
//   the ticket office office, the parking lots wreck (the cars).
// STADIUM_ROWS: the kinds' rows in the find tables (loot.js SITE_FINDS, AREA_FINDS, AREA_SOURCE...).

// ---------- the site type ----------
export const STADIUM_KINDS = {
  stadium: {
    site: { name: "Stadium", glyph: "Sd", cat: "urban", danger: 3, loot: { food: 4, water: 4, meds: 1, scrap: 2, fuel: 1 },
      gear: ["bat", "hockeystick", "footballhelmet", "sportspads", "baton", "handradio", "bandagekit", "flashlight", "duffle"], richness: 0.8, known: "public" },
    tags: ["sport", "kitchen", "shop", "medical", "police", "tools"],
    areas: ["concessions", "concessions", "lockers", "proshop", "stadsec"], size: 1, storeys: [1, 4],
  },
};

// ---------- the venues' raid rooms (combat.js AREAS; tags: loot.js AREA_TAGS) ----------
export const STADIUM_AREAS = {
  concessions: { tags: ["kitchen", "shop"], def: { name: "Concession stand", boxes: ["counter", "shelf", "freezer"],
    loot: { food: [0.85, 4, 12], water: [0.85, 4, 12], preserved: [0.35, 1, 4] }, gear: [["candy", 0.1], ["chocolate", 0.08], ["knife", 0.03]] } },
  concstore: { tags: ["kitchen", "shop"], def: { name: "Concessions storeroom", boxes: ["rack", "crate", "shelf"],
    loot: { food: [0.95, 8, 20], water: [0.9, 8, 20], preserved: [0.6, 3, 8] }, gear: [["candy", 0.06]] } },
  suites: { tags: ["kitchen", "home", "crime"], def: { name: "Luxury suite", boxes: ["cabinet", "counter", "shelf"],
    loot: { food: [0.5, 1, 4], water: [0.6, 2, 6] }, gear: [["whiskey", 0.12], ["vodka", 0.08], ["wine", 0.1], ["scotch", 0.04], ["bottle", 0.06]] } },
  proshop: { tags: ["shop", "sport", "mall"], def: { name: "Team store", boxes: ["shelf", "shelf", "counter"],
    loot: { scrap: [0.3, 1, 3], water: [0.15, 1, 2] },
    gear: [["slingbag", 0.06], ["backpack", 0.05], ["duffle", 0.05], ["bat", 0.04], ["hockeystick", 0.03], ["footballhelmet", 0.03], ["sportspads", 0.03], ["kneeguards", 0.02], ["leatherjacket", 0.02]] } },
  stadsec: { tags: ["police", "tech"], def: { name: "Stadium security", boxes: ["locker", "locker", "cabinet"],
    loot: { meds: [0.15, 1, 1], water: [0.3, 1, 3], ammo: [0.12, 4, 10] }, gear: [["baton", 0.18], ["handradio", 0.18], ["cuffs", 0.12], ["flashlight", 0.14], ["vest", 0.04], ["taser", 0.03], ["pistol", 0.015]] } },
  pressbox: { tags: ["tech", "office"], def: { name: "Press box", boxes: ["cabinet", "counter"],
    loot: { parts: [0.5, 1, 3], scrap: [0.4, 1, 3], water: [0.3, 1, 2] }, gear: [["handradio", 0.08], ["binoculars", 0.06], ["flashlight", 0.04]] } },
  groundskeep: { tags: ["tools", "garage", "farm", "outdoor"], def: { name: "Groundskeeping", boxes: ["crate", "locker", "shelf"],
    loot: { fuel: [0.75, 3, 9], scrap: [0.6, 2, 6], parts: [0.4, 1, 3] }, gear: [["hammer", 0.06], ["prybar", 0.05], ["sledge", 0.04], ["pickaxe", 0.03], ["hatchet", 0.04], ["machete", 0.03], ["barbedwire", 0.03], ["sandbags", 0.03]] } },
};

// ---------- the find tables ----------
const P = (p, items) => ({ p, items });
export const STADIUM_ROWS = {
  SITE_FINDS: { stadium: P(0.1, { candy: 2, chocolate: 2, batteries: 1, lighters: 1, cigarettes: 1 }) },
  AREA_FINDS: {
    concessions: P(0.12, { candy: 3, chocolate: 2, instcoffee: 1, lighters: 0.5 }),
    concstore: P(0.1, { candy: 3, chocolate: 2, instcoffee: 2 }),
    suites: P(0.22, { whiskey: 2, scotch: 1, wine: 2, vodka: 1, cigars: 1, watch: 1, phone: 1, cigarettes: 1 }),
    stadsec: P(0.1, { batteries: 2, phone: 1 }),
    pressbox: P(0.14, { batteries: 3, phone: 2, laptop: 1, camera: 1, instcoffee: 1 }),
  },
  AREA_SOURCE: { concessions: "shop", concstore: "shop", suites: "home", proshop: "shop", stadsec: "home", pressbox: "home", groundskeep: "shop" },
  LOCK_ROOM: { stadium: 0.3 },
};
