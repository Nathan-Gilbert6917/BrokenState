// @ts-check
// A museum's raid rooms (issue #58, museumlayout.js; the user's request 2026-10-26 "museum"): combat.js AREAS and
// loot.js AREA_TAGS, as data-shops.js AREA_DEFS (it spreads these in). Pure data, no imports.
//   musgallery  a gallery's cases: curiosities (old coins, stamps, a pocket watch, pearls, silver, a brass telescope);
//               the period rooms and the halls of skeletons, models and figures roll it too
//   musarms     a military museum's galleries and its arms vault: medals and kit (bayonets, a helmet, binoculars, an
//               Army manual); its vault's locked cases (locks.js relic) now and then a working antique
//   musgift     the gift shop: snacks, books, cards and puzzles, bags, a cheap camera
//   muscafe     the café: food, drinks, coffee and tea
//   muslab      a conservation lab or a maker lab: chemicals (solvents as fuel, the first-aid shelf), tools, parts
//   musstore    archives and collection stores: crates and their packing, old photographs and papers
//   musdock     the loading dock and the restoration shops: timber, sheet and crating, tools
//   mussec      security: torches, radios, a baton, cuffs, pepper spray (museum guards carry no guns)
//   musplay     the hands-on halls and the children's rooms: toys, comics, cards, snacks
//   musvehicle  a hall of vehicles: what is left in them and around them (parts, scrap, a little fuel)
// Tuned with tools/museumtest.js: a museum's tables' value per 100 m² near the library's (#34: about 5–7).
export const MUSEUM_AREAS = {
  musgallery: { tags: ["museum", "office", "shop"], def: { name: "Gallery cases", boxes: ["displaycase", "displaycase", "cabinet"],
    loot: { scrap: [0.25, 1, 2] },
    gear: [["coins", 0.04], ["stamps", 0.04], ["silverware", 0.025], ["watch", 0.012], ["pearls", 0.008], ["goldchain", 0.006], ["telescope", 0.008], ["photos", 0.03], ["vinyl", 0.01]] } },
  musarms: { tags: ["museum", "office", "travel"], def: { name: "Arms gallery", boxes: ["displaycase", "displaycase", "locker"],
    loot: { scrap: [0.3, 1, 2] },
    gear: [["bayonet", 0.04], ["milhelmet", 0.02], ["binoculars", 0.02], ["etool", 0.02], ["coins", 0.02], ["armymanual", 0.006], ["sabre", 0.008], ["cutlass", 0.006], ["tomahawk", 0.004]] } },
  musgift: { tags: ["museum", "shop", "books"], def: { name: "Gift shop", boxes: ["shelf", "shelf", "displaycase"],
    loot: { food: [0.35, 1, 3], water: [0.3, 1, 2] },
    gear: [["candy", 0.08], ["chocolate", 0.06], ["magazines", 0.04], ["novel", 0.03], ["puzzlebook", 0.03], ["cards", 0.04], ["tcards", 0.02], ["slingbag", 0.03], ["backpack", 0.02], ["camera", 0.01], ["gardenbook", 0.006], ["cookbook", 0.006]] } },
  muscafe: { tags: ["museum", "kitchen", "shop"], def: { name: "Café counter", boxes: ["counter", "cabinet", "shelf"],
    loot: { food: [0.55, 1, 4], water: [0.6, 2, 5], preserved: [0.25, 1, 2] },
    gear: [["coffee", 0.06], ["tea", 0.05], ["instcoffee", 0.04], ["candy", 0.04], ["knife", 0.02]] } },
  muslab: { tags: ["museum", "tools", "office"], def: { name: "Lab cabinets", boxes: ["cabinet", "labbench", "shelf"],
    loot: { parts: [0.4, 1, 2], scrap: [0.4, 1, 3], fuel: [0.15, 1, 1], meds: [0.12, 1, 1] },
    gear: [["multitool", 0.03], ["sewingkit", 0.04], ["solderiron", 0.03], ["handdrill", 0.02], ["headlamp", 0.02], ["flashlight", 0.03], ["toolkit", 0.01], ["bandagekit", 0.02]] } },
  musstore: { tags: ["museum", "office", "industry"], def: { name: "Collection store", boxes: ["rack", "crate", "mobileshelf"],
    loot: { scrap: [0.45, 1, 3], parts: [0.12, 1, 1], buildmat: [0.12, 1, 2] },
    gear: [["photos", 0.05], ["stamps", 0.015], ["coins", 0.01], ["boards", 0.03], ["lantern", 0.01], ["diybook", 0.004]] } },
  musdock: { tags: ["museum", "industry", "tools"], def: { name: "Loading dock", boxes: ["crate", "rack", "shelf"],
    loot: { scrap: [0.5, 1, 4], buildmat: [0.3, 1, 3], wood: [0.3, 10, 30], parts: [0.2, 1, 2], fuel: [0.1, 1, 2] },
    gear: [["crowbar", 0.04], ["prybar", 0.03], ["hammer", 0.03], ["toolbox", 0.02], ["flashlight", 0.03], ["handsaw", 0.02]] } },
  mussec: { tags: ["museum", "office", "tech"], def: { name: "Security office", boxes: ["locker", "cabinet", "desk"],
    loot: { water: [0.3, 1, 2], food: [0.2, 1, 2], meds: [0.1, 1, 1] },
    gear: [["flashlight", 0.1], ["handradio", 0.08], ["baton", 0.05], ["cuffs", 0.04], ["pepper", 0.04], ["taser", 0.015], ["bandagekit", 0.03]] } },
  musplay: { tags: ["museum", "school", "shop"], def: { name: "Toy shelves", boxes: ["shelf", "cabinet", "shelf"],
    loot: { scrap: [0.3, 1, 2], food: [0.15, 1, 1], water: [0.2, 1, 1] },
    gear: [["comic", 0.04], ["cards", 0.03], ["candy", 0.04], ["puzzlebook", 0.03], ["harmonica", 0.02], ["bikehelmet", 0.01]] } },
  musvehicle: { tags: ["museum", "garage", "tools"], def: { name: "Vehicle hall", boxes: ["displaycase", "toolchest", "shelf"],
    loot: { parts: [0.3, 1, 2], scrap: [0.4, 1, 3], fuel: [0.1, 1, 2] },
    gear: [["repairkit", 0.01], ["toolkit", 0.008], ["flashlight", 0.02], ["spotlight", 0.005], ["photos", 0.02]] } },
};
// The exhibit vehicles' own tables (combat.js BOX_LOOT: a car's, a truck's or an aircraft's cells one container): drained
// for display, the odd thing left aboard.
export const MUSEUM_BOX = {
  exhibitcar:   { rest: 0, loot: { parts: [0.35, 1, 2], scrap: [0.3, 1, 2], fuel: [0.08, 1, 1] }, gear: [["photos", 0.03], ["flashlight", 0.02], ["repairkit", 0.01]] },
  exhibitplane: { rest: 0, loot: { parts: [0.45, 1, 3], scrap: [0.5, 2, 4] }, gear: [["milhelmet", 0.04], ["flare", 0.06], ["binoculars", 0.02]] },
};
