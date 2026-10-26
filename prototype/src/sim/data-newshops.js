// @ts-check
// Six more shops (issue #55 of the round-2 epic #39, the user's request 2026-10-26: "furniture store, laundromat, thrift
// store, bakery, butcher, deli"). Pure data that imports nothing, merged by data-shops.js into its tables as the office
// buildings are (data-offices.js), so every module that reads NEW_KINDS, AREA_DEFS, PLACE_W, FRANCHISES and ROWS takes
// these too: data.js LOCATIONS, loot.js SITE_TAGS and the find tables, combat.js AREA_SETS and AREAS, battlesize.js
// SIZES.SITE, shops.js the places, the map's sprites by the franchise's look. The plans are shopvariants.js's (NEWSHOP_TYPES
// below, merged into its VARIANT_TYPES: a dozen named plans a kind), the sizes data-buildingsize.js REAL_SIZE's (a sizes
// row a variant), the rooms' styles shoplayout.js's.
//
// NEWSHOP_KINDS: the six site types (as data-shops.js NEW_KINDS: site, tags, areas, size, storeys):
//   furnstore   a furniture store: the showroom full of liftable furniture (sofas, beds, wardrobes, tables, appliances:
//               the carry system's best target, epic #7), its warehouse and delivery dock; a mattress store to a big-box
//               showroom, an antique store, an appliance store;
//   laundromat  rows of washers and dryers (liftable, #19), the folding tables, the change machine, the attendant's
//               office; a dry cleaner's press room, a wash-and-fold counter;
//   thrift      racks, bins, used furniture, books and toys; the donation dock and the sorting room;
//   bakery      the bakehouse's deck ovens and floor mixers (#33's deck oven), the display case, the flour store, the
//               walk-in; flour, sugar and baked goods that spoil;
//   butcher     the cutting room (the band saw, blocks, the slicer), the walk-in cooler and freezer, the smokehouse,
//               the butcher's cases, knives and cleavers;
//   deli        the slicer and the cold case, the sandwich line, cheese and meats. Its prep kitchen is #33's deli
//               kitchen (eaterylayout.js eatkitchen, cuisine "deli": the slicer and the flat-top), its food #33's deli
//               mix; #22's in-store deli (a supermarket's, a grocery's) stays the grocer's: no code twice.
// NEWSHOP_AREAS: their raid rooms (combat.js AREAS, loot.js AREA_TAGS). NEWSHOP_W: where each stands (shops.js, as
// data-shops.js PLACE_W: a new world's only, worldcfg.js legacyShopsR2). NEWSHOP_FRANCHISES: the chains and the local
// names. NEWSHOP_BOX: per-piece loot (combat.js BOX_LOOT: the showroom's furniture is for sale, empty). NEWSHOP_MIXES:
// the food they hold (foods.js MIXES). NEWSHOP_ROWS: their rows in the find tables. NEWSHOP_TYPES: their plans.

/** @typedef {import("./data-shops.js").Look} Look */
const G = (city, suburb, town) => ({ city, suburb, town });
const L = (wall, trim, sign, text, accent, style = 0, roof = undefined) => ({ wall, trim, sign, text, accent, style, ...(roof ? { roof } : {}) });
const C = (city, town, deep = 0, from = 1, rich = 1, dead = 1, rare = false) => ({ city, town, deep, from, rich, dead, ...(rare ? { rare } : {}) });
const P = (p, items) => ({ p, items });

export const NEWSHOP_KEYS = ["furnstore", "laundromat", "thrift", "bakery", "butcher", "deli"];

// ---------- the site types ----------
export const NEWSHOP_KINDS = {
  furnstore: {
    site: { name: "Furniture store", glyph: "Fu", cat: "town", danger: 1, gearRate: 1, loot: { scrap: 3, water: 1, parts: 1 },
      gear: ["crowbar", "flashlight", "boxcutter", "hammer", "lantern", "slingbag"], richness: 0.5, known: "public" },
    tags: ["home", "shop", "tools"],
    areas: ["furnshow", "furnshow", "furnwh", "office"], size: 0.5, storeys: [1, 2],
  },
  laundromat: {
    site: { name: "Laundromat", glyph: "La", cat: "town", danger: 1, loot: { water: 1, scrap: 1, food: 0.3 },
      gear: ["slingbag", "backpack", "flashlight"], richness: 0.35, known: "public" },
    tags: ["home", "shop"],
    areas: ["laundromat", "laundromat", "office"], size: 0.5, storeys: [1, 1],
  },
  thrift: {
    site: { name: "Thrift store", glyph: "Th", cat: "town", danger: 1, gearRate: 1.1, loot: { scrap: 2, water: 0.5, food: 0.3 },
      gear: ["backpack", "slingbag", "duffle", "leatherjacket", "lantern", "bat", "golfclub", "hikingpack", "flashlight"], richness: 0.45, known: "public" },
    tags: ["shop", "home", "books", "travel"],
    areas: ["thrift", "thrift", "thriftsort", "office"], size: 0.5, storeys: [1, 2],
  },
  bakery: {
    site: { name: "Bakery", glyph: "By", cat: "town", danger: 1, loot: { food: 4, water: 1, scrap: 0.5 },
      gear: ["knife", "flashlight"], richness: 0.4, known: "public" },
    tags: ["kitchen", "shop"],
    areas: ["bakery", "bakefront", "kitchen"], size: 0.5, storeys: [1, 2],
  },
  butcher: {
    site: { name: "Butcher", glyph: "Bu", cat: "town", danger: 1, loot: { food: 4, preserved: 1, water: 0.5, scrap: 0.5 },
      gear: ["knife", "cleaver", "flashlight"], richness: 0.45, known: "public" },
    tags: ["kitchen", "shop", "farm"],
    areas: ["butcher", "butcher", "kitchen"], size: 0.5, storeys: [1, 2],
  },
  deli: {
    site: { name: "Deli", glyph: "De", cat: "town", danger: 1, loot: { food: 4, water: 2, scrap: 0.5 },
      gear: ["knife", "flashlight", "slingbag"], richness: 0.4, known: "public" },
    tags: ["kitchen", "shop"],
    areas: ["deli", "deli", "kitchen", "store"], size: 0.5, storeys: [1, 2],
  },
};

// ---------- their raid rooms (combat.js AREAS; tags: loot.js AREA_TAGS) ----------
// Loot by what the room really holds (#43's rule), its value per area near the shops of its kind (a grocery's, a
// clothing store's: tools/lootsensetest.js BASELINE holds it):
//   furnshow  the showroom: the pieces themselves (lifted and carried home: the carry system), little in them (a
//             drawer's tape measure, the till's cash, a price gun); furnwh the warehouse and the dock (boxed stock,
//             packing, straps, a hand truck's tools, the forklift's propane);
//   laundromat the laundry: soap and bleach, lost things in the dryers (a bag, a phone, coins), the change machine's
//             quarters (a cashbox), the vending machine's snacks;
//   thrift    racks and bins of everything people gave away: clothes and bags, books, games and toys, a camp stove,
//             a bat, a golf club; thriftsort the sorting room's donation bags;
//   bakery    the bakehouse and its stores: flour, sugar, oats and the baked goods that spoiled (foods.js: bread is
//             gone in days); bakefront the shop's cases; butcher the cutting room, its cases and walk-ins (frozen meat,
//             sausage, jerky; knives and cleavers); deli the cases and the line (cheese, cured meats, bread: #33's deli
//             mix).
export const NEWSHOP_AREAS = {
  furnshow: { tags: ["home", "shop"], def: { name: "Showroom", boxes: ["dresser", "nightstand", "wardrobe"],
    loot: { scrap: [0.35, 1, 3], water: [0.08, 1, 1] }, gear: [["flashlight", 0.02], ["boxcutter", 0.02], ["candles", 0.02]] } },
  furnwh: { tags: ["shop", "tools", "home"], def: { name: "Furniture warehouse", boxes: ["crate", "palletrack", "shelf"],
    loot: { scrap: [0.55, 1, 4], parts: [0.2, 1, 2], buildmat: [0.12, 1, 1], wood: [0.25, 10, 30], fuel: [0.06, 1, 1] },
    gear: [["boxcutter", 0.04], ["hammer", 0.02], ["crowbar", 0.015], ["flashlight", 0.02]] } },
  laundromat: { tags: ["home", "shop"], def: { name: "Laundry", boxes: ["shelf", "cabinet", "counter"],
    loot: { scrap: [0.35, 1, 2], water: [0.2, 1, 2], food: [0.06, 1, 1] }, gear: [["slingbag", 0.02], ["backpack", 0.01], ["flashlight", 0.01]] } },
  thrift: { tags: ["shop", "home", "books", "travel"], def: { name: "Thrift racks", boxes: ["clothesrack", "shelf", "crate"],
    loot: { scrap: [0.55, 1, 4], water: [0.06, 1, 1] },
    gear: [["leatherjacket", 0.04], ["backpack", 0.03], ["slingbag", 0.035], ["duffle", 0.02], ["hikingpack", 0.012], ["novel", 0.05], ["comic", 0.02], ["magazines", 0.02], ["puzzlebook", 0.02], ["cards", 0.01],
      ["bat", 0.01], ["golfclub", 0.01], ["lantern", 0.01], ["stove", 0.005], ["kneeguards", 0.008], ["bikehelmet", 0.008]] } },
  thriftsort: { tags: ["shop", "home"], def: { name: "Donation bags", boxes: ["crate", "crate", "shelf"],
    loot: { scrap: [0.55, 1, 3], water: [0.05, 1, 1] }, gear: [["slingbag", 0.03], ["backpack", 0.02], ["leatherjacket", 0.02], ["novel", 0.02], ["flashlight", 0.01]] } },
  bakery: { tags: ["kitchen", "shop"], def: { name: "Bakehouse", boxes: ["dryshelf", "shelf", "counter"],
    loot: { food: [0.7, 3, 7], water: [0.25, 1, 2], scrap: [0.1, 1, 1] }, gear: [["knife", 0.03], ["candles", 0.01]] } },
  bakefront: { tags: ["shop", "kitchen"], def: { name: "Bakery counter", boxes: ["pastrycase", "breadrack", "counter"],
    loot: { food: [0.6, 2, 5], water: [0.35, 1, 3] }, gear: [["candy", 0.05], ["coffee", 0.04], ["tea", 0.03]] } },
  butcher: { tags: ["kitchen", "shop", "farm"], def: { name: "Butcher's", boxes: ["meatcase", "counter", "shelf"],
    loot: { food: [0.7, 3, 7], preserved: [0.35, 1, 3], water: [0.15, 1, 2] }, gear: [["cleaver", 0.04], ["knife", 0.04], ["filletknife", 0.02], ["steakknife", 0.02]] } },
  deli: { tags: ["kitchen", "shop"], def: { name: "Deli counter", boxes: ["meatcase", "coldcase", "counter"],
    loot: { food: [0.6, 2, 5], preserved: [0.2, 1, 2], water: [0.4, 1, 4] }, gear: [["knife", 0.03], ["coffee", 0.02], ["candy", 0.02]] } },
};

// ---------- where each stands (shops.js; a new world's only) ----------
// city a city block, suburb a city's suburbs, town a town's ring (data-shops.js PLACE_W); crawl the crawl's extra place.
// The country's bakeries and butchers: placement.js PLACE_EXTRA (data-placement.js rows: rural small).
export const NEWSHOP_W = {
  furnstore:  { ...G(0.4, 0.9, 0.6),  crawl: C(0.4, 0.6, -0.05, 1, 1, 0.9) },
  laundromat: { ...G(0.8, 0.6, 0.6),  crawl: C(0.8, 0.6, 0.05, 1, 0.8, 1) },
  thrift:     { ...G(0.6, 0.7, 0.7),  crawl: C(0.6, 0.7, 0, 1, 0.9, 0.9) },
  bakery:     { ...G(0.7, 0.6, 0.8),  crawl: C(0.7, 0.8, 0.05, 1, 0.9, 0.9) },
  butcher:    { ...G(0.4, 0.45, 0.65), crawl: C(0.4, 0.7, -0.05, 1, 0.95, 0.9) },
  deli:       { ...G(0.9, 0.5, 0.45), crawl: C(0.9, 0.5, 0.1, 1, 0.9, 1) },
};

// ---------- the franchises (fictional chains and local names) ----------
// plan.variants: the layouts (NEWSHOP_TYPES below) that fit the chain; a kind's together cover all twelve.
export const NEWSHOP_FRANCHISES = {
  furnstore: [
    { id: "homestead", name: "Homestead Furniture", w: G(0.6, 0.4, 1), look: L("#8b6a48", "#4a3424", "#e8e4d8", "#4a3424", "#c9a46a", 0), plan: { fl: "wood", variants: ["family", "antique", "unfinished", "barn"] } },
    { id: "sleepwell", name: "SleepWell Mattress", w: G(1, 1, 0.5), look: L("#e8e4d8", "#1f3550", "#3a6fb0", "#ffffff", "#7fc6e6", 3), plan: { fl: "carpet", variants: ["mattress", "clearance"] } },
    { id: "furnitureland", name: "FurnitureLand", w: G(0.6, 1, 0.1), look: L("#e8c04a", "#1f4f9a", "#1f4f9a", "#ffffff", "#e8c04a", 1), plan: { fl: "tile", wide: true, variants: ["bigbox", "outlet", "twofloor", "homestore"] } },
    { id: "calderappliance", name: "Calder Appliance Co.", w: G(0.8, 1, 0.7), look: L("#c9ced3", "#5d6168", "#c8402f", "#ffffff", "#7d848c", 2), plan: { fl: "tile", variants: ["appliance", "homestore", "clearance"] } },
    { id: "oldbarn", name: "Old Barn Antiques", w: G(0.3, 0.6, 1), look: L("#a2713f", "#5a3a20", "#f0e6c8", "#5a3a20", "#7a5230", 0), plan: { fl: "wood", flat: 0.3, variants: ["antique", "barn", "gallery"] } },
    { id: "loftliving", name: "Loft Living Design", w: G(1, 0.6, 0.2), look: L("#3c3a36", "#1a1a1a", "#e8e4d8", "#1a1a1a", "#d9a520", 3), plan: { fl: "conc", variants: ["gallery", "twofloor", "family"] } },
  ],
  laundromat: [
    { id: "suds", name: "Suds City Laundromat", w: G(1, 0.8, 0.6), look: L("#7fc6e6", "#2d4a5e", "#ffffff", "#1f4f9a", "#e8e4d8", 1), plan: { fl: "tile", variants: ["coin", "allnight", "strip", "student"] } },
    { id: "bubbles", name: "Bubbles Wash & Fold", w: G(0.8, 1, 0.8), look: L("#e88aa0", "#8a3a50", "#ffffff", "#8a3a50", "#7fc6e6", 0), plan: { fl: "tile", variants: ["washfold", "attended", "cafe", "coin"] } },
    { id: "spincycle", name: "Spin Cycle Coin Laundry", w: G(0.8, 0.8, 1), look: L("#e8e4d8", "#3f6b3a", "#3f6b3a", "#ffffff", "#e8c04a", 2), plan: { fl: "tile", variants: ["coin", "corner", "roadside", "flat"] } },
    { id: "pressco", name: "Press & Co. Cleaners", w: G(1, 0.8, 0.2), look: L("#1f3550", "#0f1c2b", "#e8e4d8", "#1f3550", "#c9ced3", 3), plan: { fl: "tile", variants: ["drycleaner", "commercial", "attended"] } },
  ],
  thrift: [
    { id: "goodhands", name: "Good Hands Thrift", w: G(1, 1, 0.5), look: L("#3a6fb0", "#1f3550", "#ffffff", "#3a6fb0", "#e8c04a", 1), plan: { fl: "tile", variants: ["superstore", "dockside", "twofloor", "charity"] } },
    { id: "secondchance", name: "Second Chance Resale", w: G(0.8, 0.8, 0.8), look: L("#5fa04a", "#2f5a24", "#ffffff", "#2f5a24", "#e8e4d8", 0), plan: { fl: "tile", variants: ["hospice", "consign", "toys", "books"] } },
    { id: "stvincent", name: "St. Vincent's Shop", w: G(0.6, 0.6, 1), look: L("#b9a98a", "#6b5434", "#6b5434", "#ffffff", "#c8402f", 0), plan: { fl: "wood", variants: ["church", "charity", "books"] } },
    { id: "retrorack", name: "Retro Rack Vintage", w: G(1, 0.6, 0.3), look: L("#c8402f", "#5a1410", "#e8c04a", "#5a1410", "#e8e4d8", 3), plan: { fl: "wood", variants: ["vintage", "consign", "flea"] } },
    { id: "junkbarn", name: "Hank's Junk Barn", w: G(0, 0.8, 0.3), look: L("#a2713f", "#5a3a20", "#e8e4d8", "#5a3a20", "#8b6a48", 2), plan: { fl: "conc", variants: ["barn", "flea", "dockside"] } },
  ],
  bakery: [
    { id: "goldencrust", name: "Golden Crust Bakery", w: G(0.8, 1, 1), look: L("#e8c04a", "#8a4b32", "#8a4b32", "#ffffff", "#f0e6c8", 0), plan: { fl: "tile", variants: ["village", "corner", "artisan", "offices"] } },
    { id: "boulangerie", name: "La Petite Boulangerie", w: G(1, 0.6, 0.1), look: L("#1f3550", "#0f1c2b", "#e8e4d8", "#1f3550", "#c8402f", 3), plan: { fl: "tile", variants: ["patisserie", "cafe", "cake"] } },
    { id: "dozen", name: "Dozen Donuts", w: G(1, 1, 0.8), look: L("#e88aa0", "#8a3a50", "#ffffff", "#e88aa0", "#7fc6e6", 2), plan: { fl: "tile", variants: ["donut", "corner"] } },
    { id: "breadbasket", name: "Bread Basket Wholesale", w: G(0.6, 1, 0.2), look: L("#c9a46a", "#5a3a20", "#3f6b3a", "#ffffff", "#e8e4d8", 1), plan: { fl: "conc", variants: ["wholesale", "bagel"] } },
    { id: "lamesa", name: "La Mesa Panadería", w: G(1, 0.8, 0.6), look: L("#d98a3a", "#7a3a1a", "#ffffff", "#7a3a1a", "#3f6b3a", 0), plan: { fl: "tile", variants: ["panaderia", "cafe", "bagel", "corner"] } },
    { id: "pieplace", name: "Grandma's Pie Place", w: G(0.2, 0.6, 1), look: L("#f0e6c8", "#7a5230", "#c8402f", "#ffffff", "#7a5230", 0), plan: { fl: "wood", variants: ["farm", "village", "cake"] } },
  ],
  butcher: [
    { id: "primecuts", name: "Prime Cuts Meat Market", w: G(1, 1, 0.2), look: L("#c8402f", "#5a1410", "#ffffff", "#c8402f", "#e8e4d8", 1), plan: { fl: "tile", variants: ["meatmarket", "delibutcher", "packer"] } },
    { id: "kowalski", name: "Kowalski & Sons Butchers", w: G(0.8, 0.8, 1), look: L("#e8e4d8", "#7a1a1a", "#7a1a1a", "#ffffff", "#3a6fb0", 0), plan: { fl: "tile", variants: ["family", "sausage", "flat", "smokehouse"] } },
    { id: "alnoor", name: "Al-Noor Halal Meats", w: G(1, 0.8, 0.3), look: L("#3f6b3a", "#1f3a1a", "#ffffff", "#3f6b3a", "#e8c04a", 2), plan: { fl: "tile", variants: ["halal", "wrap", "stall"] } },
    { id: "bucksgame", name: "Buck's Game Processing", w: G(0, 0.3, 0.3), look: L("#7a5230", "#4a3424", "#e8c04a", "#4a3424", "#5f7a3e", 2), plan: { fl: "conc", variants: ["game", "ranch", "smokehouse", "family"] } },
    { id: "marketstall", name: "Market Hall Meats", w: G(1, 0.6, 0.8), look: L("#b9a98a", "#5a3a20", "#e8e4d8", "#5a3a20", "#c8402f", 0), plan: { fl: "tile", variants: ["stall", "family", "delibutcher"] } },
  ],
  deli: [
    { id: "katz", name: "Katzman's Delicatessen", w: G(1, 0.6, 0.1), look: L("#c8402f", "#3a1410", "#ffffff", "#c8402f", "#e8c04a", 1), plan: { fl: "tile", variants: ["nyc", "lunch", "foodhall"] } },
    { id: "salvatore", name: "Salvatore's Salumeria", w: G(1, 0.8, 0.5), look: L("#3f6b3a", "#1f3a1a", "#e8e4d8", "#c8402f", "#e8e4d8", 0), plan: { fl: "tile", variants: ["salumeria", "market", "classic"] } },
    { id: "cornerdeli", name: "Corner Deli", w: G(1, 1, 1), look: L("#e8e4d8", "#1f3550", "#1f3550", "#ffffff", "#e8c04a", 0), plan: { fl: "tile", variants: ["classic", "flat", "sandwich", "wrap"] } },
    { id: "smokestack", name: "Smokestack Deli & Catering", w: G(0.6, 1, 0.8), look: L("#5a4030", "#2a1a10", "#e8a020", "#2a1a10", "#c9a46a", 2), plan: { fl: "conc", variants: ["smokehouse", "caterer", "country", "classic"] } },
    { id: "graze", name: "Graze Market & Deli", w: G(1, 0.3, 0.1), look: L("#f0e6c8", "#5fa04a", "#5fa04a", "#ffffff", "#3a6fb0", 3), plan: { fl: "wood", variants: ["market", "foodhall", "wrap"] } },
  ],
};

// ---------- the pieces' own loot (combat.js BOX_LOOT, by kind@area) ----------
// The showroom's furniture is stock for sale: its drawers and wardrobes hold what a showroom's would (a tape measure, a
// price list, the odd lost thing), never a nightstand's pistol (BOX_LOOT nightstand: a home's).
export const NEWSHOP_BOX = {
  "nightstand@furnshow": { rest: 0.4, loot: {}, gear: [["candles", 0.02]] },
  "dresser@furnshow": { rest: 0.6, loot: {}, gear: [] },
  "wardrobe@furnshow": { rest: 0.6, loot: {}, gear: [["slingbag", 0.01]] },
  "nightstand@thrift": { rest: 0.5, loot: {}, gear: [["candles", 0.02], ["cards", 0.02]] },
  "dresser@thrift": { rest: 0.8, loot: {}, gear: [["slingbag", 0.01]] },
  "wardrobe@thrift": { rest: 0.8, loot: {}, gear: [["leatherjacket", 0.02]] },
  changer: { rest: 0, loot: { scrap: [0.5, 1, 2] }, gear: [] }, // the change machine's quarters (BOX_SITE laundromat: a cashbox)
};

// ---------- the food they hold (foods.js MIXES; "<mix>:keeps" its preserved draws) ----------
export const NEWSHOP_MIXES = {
  bakery: { f_flour: 22, f_sugar: 12, f_bread: 14, f_oats: 5, f_eggs: 4, f_honey: 2, f_crackers: 4, f_cereal: 2 },
  "bakery:keeps": { f_sugar: 12, f_flour: 10, f_honey: 4, f_crackers: 4, f_driedfruit: 3 },
  butcher: { f_frozenmeat: 26, f_groundmeat: 8, f_sausage: 10, f_jerky: 4, f_cannedmeat: 3, f_eggs: 2 },
  "butcher:keeps": { f_sausage: 14, f_jerky: 14, f_cannedmeat: 6 },
  laundry: { f_chips: 10, f_candybar: 12, f_energybar: 4, f_crackers: 4 },
};

// ---------- their rows in the find tables (each module merges its own: data-shops.js ROWS) ----------
export const NEWSHOP_ROWS = {
  SITE_FINDS: {
    furnstore: P(0.06, { candles: 2, batteries: 1, lighters: 0.5, watch: 0.2 }),
    laundromat: P(0.14, { soap: 4, shampoo: 1, wetwipes: 1, coins: 1.5, phone: 0.5, cards: 0.5 }),
    thrift: P(0.18, { vinyl: 2, tcards: 1, cards: 1.5, watch: 0.6, goldchain: 0.3, candles: 1, camera: 0.5, alarmclock: 1, photos: 1, stamps: 0.5 }),
    bakery: P(0.08, { coffee: 1, tea: 1, candy: 1.5, candles: 0.5 }),
    butcher: P(0.06, { lighters: 1, soap: 1, cigarettes: 0.5 }),
    deli: P(0.1, { coffee: 1.5, candy: 1, cigarettes: 1, lighters: 0.5 }),
  },
  AREA_FINDS: {
    furnshow: P(0.04, { candles: 1, batteries: 0.5 }),
    laundromat: P(0.14, { soap: 4, shampoo: 1, wetwipes: 1, coins: 1, phone: 0.4 }),
    thrift: P(0.16, { vinyl: 2, tcards: 1, cards: 1.5, watch: 0.4, goldchain: 0.2, alarmclock: 1, photos: 1 }),
    thriftsort: P(0.1, { photos: 1, cards: 1, watch: 0.3 }),
    bakefront: P(0.06, { candy: 1, coffee: 1 }),
    deli: P(0.08, { coffee: 1, candy: 1, cigarettes: 0.5 }),
  },
  BUILDMAT_FINDS: { furnstore: [0.08, 1, 2] },
  SITE_WOOD: { furnstore: [0.2, 10, 40] },
  AREA_WOOD: { furnwh: [0.2, 10, 30] },
  BLADE_FINDS: { butcher: P(0.12, { cleaver: 3, steakknife: 2, filletknife: 2, boxcutter: 0.5 }), deli: P(0.05, { steakknife: 2, cleaver: 1 }), bakery: P(0.03, { steakknife: 1 }), furnstore: P(0.04, { boxcutter: 3 }), thrift: P(0.03, { pocketknife: 1, lockback: 0.5 }) },
  AREA_BLADES: { butcher: P(0.08, { cleaver: 2, steakknife: 1.5, filletknife: 1.5 }), deli: P(0.04, { steakknife: 1, cleaver: 1 }), furnwh: P(0.04, { boxcutter: 2 }) },
  BOOK_SITES: { thrift: { p: 0.2, books: ["novel", "comic", "magazines", "puzzlebook", "cookbook", "gardenbook", "diybook", "survivalbook", "chefbook", "gamebook"] }, bakery: { p: 0.03, books: ["cookbook", "chefbook"] } },
  BOX_SITE: { laundromat: P(0.06, { cashbox: 3 }), deli: P(0.03, { cashbox: 2 }), bakery: P(0.03, { cashbox: 2 }), butcher: P(0.03, { cashbox: 2 }), thrift: P(0.03, { cashbox: 2 }) },
  BOX_AREA: { laundromat: P(0.04, { cashbox: 2 }) },
  HUNT_FINDS: { butcher: P(0.04, { snarewire: 1 }) },
  SITE_MIX: { furnstore: "house", laundromat: "laundry", thrift: "house", bakery: "bakery", butcher: "butcher", deli: "eat:deli" },
  AREA_MIX: { furnshow: "house", furnwh: "warehouse", laundromat: "laundry", thrift: "house", thriftsort: "house", bakery: "bakery", bakefront: "bakery", butcher: "butcher", deli: "eat:deli" },
  SHOP_FOOD: { bakery: 60, butcher: 60, deli: 60, laundromat: 10 },
  SITE_SOURCE: { furnstore: "shop", laundromat: "home", thrift: "home", bakery: "shop", butcher: "shop", deli: "shop" },
  AREA_SOURCE: { furnshow: "shop", furnwh: "shop", laundromat: "home", thrift: "home", thriftsort: "home", bakery: "shop", bakefront: "shop", butcher: "shop", deli: "shop" },
  LOCK_RULES: { laundromat: [["changer"], "lockbox", 0.6], thrift: [["counter", "checkout", "displaycase"], "lockbox", 0.15], deli: [["counter", "checkout"], "lockbox", 0.15] },
  LOCK_ROOM: { furnstore: 0.1, laundromat: 0.15 },
};

// ======================================================================================
// The plans: a dozen named variants a kind (shopvariants.js reads these as its VARIANT_TYPES rows; the format is its
// header's: base the front room's leaf, rooms the type's own tokens, variants its rows, w by [rural, town, city, highway,
// strip]). size S | M | L | XL: the variant's class (the picker's size by the placement table: S small, M medium, L and
// XL large); its footprint is its own data-buildingsize.js REAL_SIZE sizes row (the variant's id), its storeys too.
// Each kind's signature in every plan (tools/shopvarianttest.js SIGN): the furniture store's showroom, the laundromat's
// washers, the thrift store's racks and sorting, the bakery's bakehouse, the butcher's cutting room and walk-in, the
// deli's slicer and cold case.
// ======================================================================================
const COLD = { cold: true, dk: "steel", windows: false, fl: "steel", maxBoxes: 1 };
export const NEWSHOP_TYPES = {
  // ---------- the furniture store: a showroom of pieces to lift, the warehouse and the dock ----------
  furnstore: {
    boxes: 1,
    base: { name: "Showroom", type: "furnshow", lay: "furnfloor", show: "mixed", maxBoxes: 8 }, depth: 0.66, fw: 2,
    rooms: {
      wh: { role: "warefloor", name: "Warehouse", type: "furnwh", lay: "furnwh", hub: false, maxBoxes: 6 },
      dock: { role: "warefloor", name: "Delivery dock", type: "furnwh", lay: "furndock", hub: false, maxBoxes: 3 },
      bedroom: { role: "sales", name: "Bedroom gallery", type: "furnshow", lay: "furnfloor", show: "bedroom", hub: false, maxBoxes: 4 },
      appl: { role: "sales", name: "Appliance floor", type: "furnshow", lay: "furnfloor", show: "appliance", hub: false, maxBoxes: 3 },
      clear: { role: "sales", name: "Clearance corner", type: "furnshow", lay: "furnfloor", show: "used", hub: false, maxBoxes: 3 },
      restore: { role: "workshop", name: "Restoration room", type: "furnwh", lay: "repair" },
      repair: { role: "workshop", name: "Upholstery and repair shop", type: "furnwh", lay: "repair" },
      design: { role: "office", name: "Design studio", type: "office" },
    },
    variants: [
      { id: "mattress", name: "Mattress store", w: [0.4, 1, 1, 0.6, 1], size: "S", lay: "strip", depth: 0.72, sales: { show: "mattress" }, back: [["*", "wh"], [2, "wc"]], ex: ["back"] },
      { id: "bigbox", name: "Big-box furniture showroom", w: [0, 0.4, 0.6, 1, 0.6], size: "XL", lay: "corridor", front: [[0.3, "bedroom"], ["*", "S"]], back: [["*", "wh"], [[8, 9], "dock"], [4, "mgr"], [4, "brk"], [2, "wc"]], ex: ["dock", "front2", "fire"], st: [1, 2], up: "sales" },
      { id: "antique", name: "Antique store", w: [1, 1, 0.6, 0.4, 0], size: "S", lay: "side", sideW: [4, 5], sales: { show: "antique", name: "Antiques" }, side: [["*", "restore"]], ex: ["back"], st: [1, 2], up: "flat" },
      { id: "appliance", name: "Appliance store", w: [0.4, 1, 0.8, 0.8, 0.8], size: "M", lay: "strip", sales: { show: "appliance", name: "Appliance floor" }, back: [["*", "wh"], [[5, 6], "dock"], [3, "office"]], ex: ["dock", "back"] },
      { id: "family", name: "Family furniture store", w: [0.6, 1, 0.6, 0.4, 0.4], size: "M", lay: "strip", back: [["*", "wh"], [3, "safeoff"], [2, "wc"]], ex: ["back", "side"] },
      { id: "outlet", name: "Furniture warehouse outlet", w: [0.2, 0.6, 0.2, 1, 0.6], size: "L", lay: "wrap", sideW: [7, 8], side: [["*", "wh"]], back: [["*", "dock"], [4, "office"]], ex: ["yard", "dock"], ground: "lot" },
      { id: "gallery", name: "Design gallery with a studio upstairs", w: [0, 0.4, 1, 0, 0.4], size: "M", lay: "deep", depth: 0.5, midD: [4, 5], mid: [["*", "bedroom"], [5, "design"]], back: [["*", "wh"], [2, "wc"]], ex: ["back"], st: 2, up: "offices" },
      { id: "barn", name: "Country furniture barn", w: [1, 0.6, 0, 0.8, 0], size: "M", lay: "side", sideW: [6, 7], sales: { show: "rustic" }, side: [["*", "wh"]], ex: ["side", "yard"], ground: "rural" },
      { id: "unfinished", name: "Unfinished furniture and repair shop", w: [0.6, 0.8, 0.4, 0.4, 0.6], size: "S", lay: "strip", sales: { show: "rustic" }, back: [["*", "repair"], ["*", "wh"]], ex: ["back!"] },
      { id: "homestore", name: "Home store with an appliance floor", w: [0, 0.6, 0.8, 0.6, 1], size: "L", lay: "strip", front: [[0.6, "S"], ["*", "appl"]], back: [["*", "wh"], [4, "mgr"], [2, "wc"]], ex: ["front2", "back"] },
      { id: "clearance", name: "Clearance centre", w: [0.2, 0.8, 0.6, 0.6, 0.8], size: "M", lay: "corridor", front: [["*", "S"], [0.3, "clear"]], back: [["*", "wh"], [3, "office"]], ex: ["dock"] },
      { id: "twofloor", name: "Two-floor furniture store", w: [0, 0.6, 1, 0.2, 0.2], size: "L", lay: "strip", back: [["*", "wh"], [[5, 6], "dock"], [3, "office"]], ex: ["back", "fire"], st: 2, up: "sales" },
    ],
  },
  // ---------- the laundromat: rows of washers and dryers, folding tables, the change machine ----------
  laundromat: {
    boxes: 1,
    base: { name: "Laundromat", type: "laundromat", lay: "laundromat", maxBoxes: 4 }, depth: 0.74, fw: 1,
    rooms: {
      att: { role: "office", name: "Attendant's office", type: "laundromat", boxLock: ["lockbox", 0.4] },
      supply: { role: "storage", name: "Supply closet", type: "laundromat" },
      drop: { role: "sales", name: "Wash-and-fold counter", type: "laundromat", lay: "laundromat", mode: "fold", hub: false, maxBoxes: 2 },
      press: { role: "workshop", name: "Dry-cleaning press room", type: "laundromat", lay: "laundromat", mode: "press" },
      boiler: { role: "storage", name: "Boiler room", type: "laundromat", lay: "plant" },
      lounge: { role: "lobby", name: "Waiting lounge", type: "laundromat", lay: "vendnook", hub: false, maxBoxes: 1 },
      cafe: { role: "dining", name: "Café counter", type: "store", lay: "cafe", hub: false },
      showers: { role: "restroom", name: "Showers" },
    },
    variants: [
      { id: "coin", name: "Coin laundry", w: [0.6, 1, 1, 0.6, 1], size: "S", lay: "strip", back: [["*", "supply"], [2, "wc"]], ex: ["back"] },
      { id: "attended", name: "Attended laundromat with an office", w: [0.4, 1, 0.8, 0.4, 0.6], size: "M", lay: "strip", back: [["*", "supply"], [4, "att"], [2, "wc"]], ex: ["back", "side"] },
      { id: "washfold", name: "Wash-and-fold service", w: [0.2, 0.8, 1, 0.2, 0.6], size: "M", lay: "deep", depth: 0.5, midD: 3, mid: [["*", "drop"]], back: [["*", "supply"], [3, "att"]], ex: ["back"] },
      { id: "drycleaner", name: "Laundromat and dry cleaner", w: [0, 0.8, 1, 0.2, 0.8], size: "L", lay: "corridor", back: [["*", "press"], [4, "drop"], [4, "supply"], [2, "wc"]], ex: ["back", "front2"] },
      { id: "corner", name: "Corner laundromat", w: [0.2, 0.8, 1, 0.2, 0.2], size: "S", lay: "side", sideW: 3, side: [["*", "att"]], ex: ["side"] },
      { id: "allnight", name: "24-hour superwash", w: [0, 0.6, 1, 0.8, 0.8], size: "XL", lay: "strip", front: [["*", "S"], [0.25, "lounge"]], back: [["*", "supply"], [4, "boiler"], [4, "att"], [2, "wc"]], ex: ["front2", "back", "fire"] },
      { id: "flat", name: "Laundromat with a flat above", w: [0.6, 1, 0.6, 0, 0], size: "S", lay: "strip", back: [["*", "supply"]], ex: ["back!"], st: 2, up: "flat" },
      { id: "cafe", name: "Laundromat café", w: [0, 0.6, 1, 0.2, 0.6], size: "L", lay: "strip", front: [[0.6, "S"], ["*", "cafe"]], back: [["*", "supply"], [2, "wc"]], ex: ["back", "fire"] },
      { id: "strip", name: "Strip-mall laundromat", w: [0.2, 0.8, 0.4, 0.6, 1], size: "M", lay: "strip", depth: 0.78, back: [["*", "supply"], [3, "att"]], ex: [] },
      { id: "student", name: "Student laundry with an L of back rooms", w: [0, 0.6, 1, 0, 0.4], size: "M", lay: "wrap", sideW: 4, side: [[3, "att"], ["*", "wc"]], back: [["*", "supply"]], ex: ["back"] },
      { id: "roadside", name: "Roadside wash-house with showers", w: [1, 0.4, 0, 1, 0], size: "M", lay: "side", sideW: [4, 5], side: [["*", "showers"], [3, "att"]], ex: ["side", "back"], ground: "rural" },
      { id: "commercial", name: "Commercial laundry with a boiler room", w: [0.2, 0.4, 0.8, 0.6, 0.2], size: "L", lay: "corridor", back: [["*", "boiler"], ["*", "drop"], [4, "brk"], [3, "office"]], ex: ["dock", "back"] },
    ],
  },
  // ---------- the thrift store: racks, bins, used furniture, books and toys; the donation dock and sorting room ----------
  thrift: {
    boxes: 1,
    base: { name: "Sales floor", type: "thrift", lay: "thriftfloor", maxBoxes: 7 }, depth: 0.64, fw: 2,
    rooms: {
      sort: { role: "stock", name: "Sorting room", type: "thriftsort", lay: "sorting" },
      dono: { role: "warefloor", name: "Donation dock", type: "thriftsort", lay: "donation", hub: false, maxBoxes: 3 },
      furn: { role: "sales", name: "Furniture corner", type: "thrift", lay: "furnfloor", show: "used", hub: false, maxBoxes: 3 },
      books: { role: "sales", name: "Book room", type: "thrift", lay: "thriftfloor", mode: "books", hub: false, maxBoxes: 3 },
      toys: { role: "sales", name: "Toys and games", type: "thrift", lay: "thriftfloor", mode: "toys", hub: false, maxBoxes: 3 },
      fitting: { role: "lockerroom", name: "Fitting rooms", type: "clothes" },
      cases: { role: "storage", name: "Collectibles room", type: "thrift", lay: "thriftfloor", mode: "cases", lock: ["door", 0.3] },
      yard: { role: "warefloor", name: "Furniture yard", type: "thriftsort", lay: "furnwh", hub: false, maxBoxes: 4 },
      bstock: { role: "stock", name: "Back room", type: "thrift" },
    },
    variants: [
      { id: "charity", name: "Charity shop", w: [0.6, 1, 1, 0.2, 0.6], size: "S", lay: "strip", back: [["*", "sort"], [2, "wc"]], ex: ["back"] },
      { id: "church", name: "Church thrift store", w: [1, 1, 0.4, 0.2, 0.2], size: "M", lay: "strip", back: [["*", "sort"], [3, "office"]], ex: ["back", "side"] },
      { id: "superstore", name: "Thrift superstore with a donation dock", w: [0, 0.6, 0.6, 0.8, 1], size: "XL", lay: "corridor", front: [["*", "S"], [0.25, "furn"]], back: [["*", "sort"], [[6, 7], "dono"], [4, "brk"], [3, "mgr"], [2, "wc"]], ex: ["dock", "front2"] },
      { id: "vintage", name: "Vintage clothing boutique", w: [0, 0.6, 1, 0, 0.4], size: "S", lay: "strip", sales: { mode: "vintage" }, back: [[4, "fitting"], ["*", "bstock"]], ex: ["back"], st: [1, 2], up: "flat" },
      { id: "hospice", name: "Hospice resale shop with a furniture corner", w: [0.4, 1, 0.6, 0.4, 0.6], size: "M", lay: "strip", front: [[0.6, "S"], ["*", "furn"]], back: [["*", "sort"], [2, "wc"]], ex: ["back", "front2"] },
      { id: "books", name: "Thrift shop with a book room", w: [0.4, 1, 0.8, 0.2, 0.4], size: "M", lay: "side", sideW: [5, 6], side: [["*", "books"]], back: [["*", "sort"]], ex: ["back"] },
      { id: "barn", name: "Country junk barn", w: [1, 0.4, 0, 1, 0], size: "L", lay: "side", sideW: [6, 7], sales: { mode: "junk" }, side: [["*", "yard"]], ex: ["yard"], ground: "rural" },
      { id: "consign", name: "Consignment shop", w: [0.2, 0.8, 1, 0, 0.6], size: "M", lay: "deep", depth: 0.5, midD: 3, mid: [["*", "cases"], [4, "fitting"]], back: [["*", "bstock"], [3, "office"]], ex: ["back"] },
      { id: "dockside", name: "Donation centre and thrift outlet", w: [0.4, 0.6, 0.4, 1, 0.6], size: "L", lay: "wrap", sideW: [5, 6], side: [["*", "dono"]], back: [["*", "sort"], [3, "office"]], ex: ["dock", "back"] },
      { id: "toys", name: "Kids' resale and toy exchange", w: [0.2, 1, 0.6, 0.2, 0.8], size: "M", lay: "strip", front: [[0.6, "S"], ["*", "toys"]], back: [["*", "sort"], [2, "wc"]], ex: ["back"], st: [1, 2], up: "flat" },
      { id: "twofloor", name: "Two-floor thrift emporium", w: [0, 0.6, 1, 0.2, 0.2], size: "L", lay: "strip", back: [["*", "sort"], [[5, 6], "dono"], [2, "wc"]], ex: ["dock", "back"], st: 2, up: "sales" },
      { id: "flea", name: "Indoor flea market", w: [0.6, 0.6, 0.4, 0.8, 0.4], size: "XL", lay: "strip", depth: 0.8, sales: { mode: "junk", name: "Market hall" }, back: [["*", "bstock"], [3, "office"], [2, "wc"]], ex: ["front2", "side", "fire"] },
    ],
  },
  // ---------- the bakery: the bakehouse (deck ovens, mixers), the shop's cases, the flour store, the walk-in ----------
  bakery: {
    boxes: 1,
    base: { name: "Shop front", type: "bakefront", lay: "bakefront", maxBoxes: 4 }, depth: 0.5, fw: 1,
    rooms: {
      bake: { role: "kitchen", name: "Bakehouse", type: "bakery", lay: "bakehouse", maxBoxes: 3 },
      flour: { role: "storage", name: "Flour store", type: "bakery", lay: "flourstore" },
      walkin: { role: "pantry", name: "Walk-in cooler", type: "bakery", ...COLD },
      cafe: { role: "dining", name: "Café", type: "bakefront", lay: "cafe", hub: false },
      decor: { role: "workshop", name: "Cake decorating room", type: "bakery", lay: "bakehouse", mode: "decor" },
      pack: { role: "warefloor", name: "Packing and dispatch", type: "bakery", lay: "furndock", hub: false, maxBoxes: 3 },
    },
    variants: [
      { id: "village", name: "Village bakery", w: [1, 1, 0.4, 0.4, 0.2], size: "S", lay: "strip", back: [["*", "bake"], [3, "flour"]], ex: ["back"], st: [1, 2], up: "flat" },
      { id: "patisserie", name: "French patisserie", w: [0, 0.6, 1, 0, 0.4], size: "M", lay: "strip", front: [[0.65, "S"], ["*", "cafe"]], back: [["*", "bake"], [3, "walkin"], [2, "wc"]], ex: ["back"] },
      { id: "donut", name: "Donut shop", w: [0.4, 1, 0.8, 1, 1], size: "S", lay: "strip", depth: 0.58, sales: { mode: "donut" }, back: [["*", "bake"], [3, "flour"]], ex: ["back!"] },
      { id: "wholesale", name: "Wholesale bakery with a dispatch dock", w: [0, 0.6, 0.6, 0.8, 0.2], size: "XL", lay: "corridor", depth: 0.3, back: [["*", "bake"], [[6, 7], "pack"], [4, "flour"], [4, "walkin"], [3, "office"], [2, "wc"]], ex: ["dock", "back"] },
      { id: "cake", name: "Cake shop with a decorating room", w: [0.2, 1, 0.8, 0, 0.6], size: "M", lay: "deep", depth: 0.4, midD: 3, mid: [["*", "decor"]], back: [["*", "bake"], [3, "walkin"]], ex: ["back"] },
      { id: "bagel", name: "Bagel bakery", w: [0, 0.6, 1, 0.4, 0.8], size: "M", lay: "side", sideW: [5, 6], side: [["*", "bake"], [3, "flour"]], ex: ["side"] },
      { id: "cafe", name: "Bakery café", w: [0.2, 0.8, 1, 0.6, 0.8], size: "L", lay: "strip", front: [[0.5, "S"], ["*", "cafe"]], back: [["*", "bake"], [4, "flour"], [3, "walkin"], [2, "wc"]], ex: ["back", "front2"] },
      { id: "corner", name: "Corner bakery", w: [0.4, 1, 1, 0.2, 0.4], size: "S", lay: "side", sideW: [4, 5], side: [["*", "bake"]], ex: ["side", "back"] },
      { id: "artisan", name: "Artisan bread bakery with a flour store", w: [0.6, 1, 0.8, 0.2, 0.2], size: "M", lay: "wrap", sideW: [4, 5], side: [["*", "flour"]], back: [["*", "bake"], [2, "wc"]], ex: ["back"] },
      { id: "offices", name: "Bakery with offices upstairs", w: [0.2, 0.8, 1, 0, 0.2], size: "M", lay: "strip", back: [["*", "bake"], [3, "walkin"], [3, "office"]], ex: ["back", "fire"], st: 2, up: "offices" },
      { id: "panaderia", name: "Panadería", w: [0.4, 1, 1, 0.4, 0.6], size: "M", lay: "corridor", back: [["*", "bake"], [4, "flour"], [2, "wc"]], ex: ["back", "side"] },
      { id: "farm", name: "Farm bakery and pie shop", w: [1, 0.6, 0, 1, 0], size: "M", lay: "strip", front: [[0.6, "S"], ["*", "cafe"]], back: [["*", "bake"], [4, "flour"]], ex: ["side"], ground: "rural" },
    ],
  },
  // ---------- the butcher: the cutting room, the walk-in cooler and freezer, the smokehouse, the cases ----------
  butcher: {
    boxes: 1,
    base: { name: "Shop front", type: "butcher", lay: "butcherfront", maxBoxes: 4 }, depth: 0.5, fw: 1,
    rooms: {
      cut: { role: "kitchen", name: "Cutting room", type: "butcher", lay: "cutroom", maxBoxes: 3 },
      cooler: { role: "pantry", name: "Walk-in cooler", type: "butcher", ...COLD },
      freezer: { role: "pantry", name: "Walk-in freezer", type: "butcher", lay: "walkfreezer", ...COLD },
      smoke: { role: "storage", name: "Smokehouse", type: "butcher", lay: "smokehouse" },
      sausage: { role: "kitchen", name: "Sausage kitchen", type: "butcher", lay: "cutroom", mode: "sausage", maxBoxes: 2 },
      game: { role: "warefloor", name: "Game processing bay", type: "butcher", lay: "cutroom", mode: "game", hub: false, maxBoxes: 3 },
      deli: { role: "sales", name: "Deli counter", type: "deli", lay: "delifront", hub: false, maxBoxes: 3 },
    },
    variants: [
      { id: "family", name: "Family butcher", w: [0.6, 1, 0.8, 0.2, 0.4], size: "S", lay: "strip", back: [["*", "cut"], [3, "cooler"]], ex: ["back"] },
      { id: "smokehouse", name: "Butcher and smokehouse", w: [1, 1, 0.4, 0.6, 0.2], size: "M", lay: "strip", back: [["*", "cut"], [4, "smoke"], [3, "cooler"]], ex: ["back", "side"] },
      { id: "meatmarket", name: "Meat market with walk-ins", w: [0, 0.6, 1, 0.2, 0.6], size: "L", lay: "corridor", back: [["*", "cut"], [4, "cooler"], [4, "freezer"], [3, "office"], [2, "wc"]], ex: ["back", "front2"] },
      { id: "game", name: "Country game processor", w: [1, 0.4, 0, 0.8, 0], size: "L", lay: "side", sideW: [6, 7], side: [["*", "game"], [3, "freezer"]], back: [["*", "cut"], [3, "cooler"]], ex: ["yard", "back"], ground: "rural" },
      { id: "halal", name: "Halal butcher", w: [0, 0.6, 1, 0, 0.6], size: "S", lay: "side", sideW: [4, 5], side: [["*", "cut"], [3, "cooler"]], ex: ["side"] },
      { id: "sausage", name: "Sausage maker", w: [0.6, 1, 0.6, 0.2, 0.2], size: "M", lay: "deep", depth: 0.4, midD: 3, mid: [["*", "sausage"]], back: [["*", "smoke"], [3, "cooler"]], ex: ["back"] },
      { id: "packer", name: "Wholesale meat packer", w: [0.4, 0.4, 0.6, 1, 0], size: "XL", lay: "corridor", depth: 0.3, back: [["*", "cut"], [6, "freezer"], [6, "cooler"], [4, "brk"], [3, "office"], [2, "wc"]], ex: ["dock", "back"] },
      { id: "delibutcher", name: "Butcher with a deli counter", w: [0.2, 1, 1, 0.2, 0.8], size: "M", lay: "strip", front: [[0.6, "S"], ["*", "deli"]], back: [["*", "cut"], [3, "cooler"]], ex: ["back", "front2"] },
      { id: "flat", name: "Butcher's shop with the family flat above", w: [0.6, 1, 0.6, 0, 0], size: "S", lay: "strip", back: [["*", "cut"], [3, "cooler"]], ex: ["back!"], st: 2, up: "flat" },
      { id: "wrap", name: "Butcher with an L of cold rooms", w: [0.4, 0.8, 0.8, 0.2, 0.4], size: "M", lay: "wrap", sideW: 4, side: [[4, "cooler"], ["*", "freezer"]], back: [["*", "cut"]], ex: ["back"] },
      { id: "ranch", name: "Ranch meat shop", w: [1, 0.6, 0, 1, 0], size: "L", lay: "strip", back: [["*", "cut"], [4, "freezer"], [4, "smoke"]], ex: ["dock"], ground: "rural" },
      { id: "stall", name: "Market hall butcher's stall", w: [0.2, 0.6, 1, 0, 0.4], size: "S", lay: "strip", depth: 0.55, back: [["*", "cut"]], ex: [] },
    ],
  },
  // ---------- the deli: the cases and the slicer, #33's deli kitchen, cheese and cured meats ----------
  deli: {
    boxes: 1,
    base: { name: "Deli", type: "deli", lay: "delifront", maxBoxes: 4 }, depth: 0.55, fw: 1,
    rooms: {
      prep: { role: "kitchen", name: "Prep kitchen", type: "deli", lay: "eatkitchen", eat: "deli", mix: "eat:deli" },
      cooler: { role: "pantry", name: "Walk-in cooler", type: "deli", ...COLD },
      cheese: { role: "pantry", name: "Cheese room", type: "deli", ...COLD },
      dry: { role: "storage", name: "Dry store", type: "deli", lay: "eatdry", eat: "deli", mix: "eat:deli" },
      seats: { role: "dining", name: "Seating", type: "deli", lay: "cafe", hub: false },
      cater: { role: "warefloor", name: "Catering dispatch", type: "deli", lay: "furndock", hub: false, maxBoxes: 3 },
      smoke: { role: "storage", name: "Smokehouse", type: "butcher", lay: "smokehouse" },
    },
    variants: [
      { id: "classic", name: "Neighbourhood deli", w: [0.4, 1, 1, 0.2, 0.6], size: "S", lay: "strip", back: [["*", "prep"], [3, "cooler"]], ex: ["back"] },
      { id: "nyc", name: "New York–style delicatessen", w: [0, 0.4, 1, 0, 0.4], size: "L", lay: "strip", front: [[0.55, "S"], ["*", "seats"]], back: [["*", "prep"], [3, "cooler"], [3, "dry"], [2, "wc"]], ex: ["back", "side"] },
      { id: "salumeria", name: "Italian salumeria", w: [0.2, 0.8, 1, 0, 0.4], size: "M", lay: "deep", depth: 0.4, midD: 3, mid: [["*", "cheese"], ["*", "dry"]], back: [["*", "prep"], [3, "cooler"]], ex: ["back"] },
      { id: "sandwich", name: "Sandwich shop deli", w: [0.4, 1, 1, 0.8, 1], size: "S", lay: "strip", depth: 0.62, back: [["*", "prep"]], ex: ["back!"] },
      { id: "market", name: "Deli and market with a cheese room", w: [0, 0.8, 1, 0.2, 0.8], size: "L", lay: "corridor", back: [["*", "prep"], [4, "cheese"], [4, "cooler"], [3, "dry"], [2, "wc"]], ex: ["front2", "back"] },
      { id: "caterer", name: "Deli and caterer", w: [0.2, 1, 0.8, 0.4, 0.6], size: "M", lay: "strip", back: [["*", "prep"], [[5, 6], "cater"], [3, "cooler"]], ex: ["dock", "back"] },
      { id: "flat", name: "Corner deli with a flat above", w: [0.4, 1, 1, 0, 0.2], size: "S", lay: "side", sideW: [4, 5], side: [["*", "prep"]], ex: ["side"], st: 2, up: "flat" },
      { id: "smokehouse", name: "Smokehouse deli", w: [0.8, 0.8, 0.4, 0.8, 0.2], size: "M", lay: "strip", back: [["*", "prep"], [4, "smoke"], [3, "cooler"]], ex: ["back", "side"] },
      { id: "foodhall", name: "Gourmet food hall deli", w: [0, 0.2, 1, 0, 0.6], size: "XL", lay: "corridor", front: [["*", "S"], [0.3, "seats"]], back: [["*", "prep"], [5, "cheese"], [5, "cooler"], [4, "dry"], [3, "office"], [2, "wc"]], ex: ["front2", "back", "fire"] },
      { id: "wrap", name: "Deli with an L of stores", w: [0.2, 0.8, 0.8, 0.4, 0.6], size: "M", lay: "wrap", sideW: 4, side: [[3, "dry"], ["*", "cooler"]], back: [["*", "prep"]], ex: ["back"] },
      { id: "country", name: "Country store deli", w: [1, 0.6, 0, 1, 0], size: "M", lay: "strip", back: [["*", "prep"], [4, "dry"]], ex: ["back", "side"], st: [1, 2], up: "flat", ground: "rural" },
      { id: "lunch", name: "Downtown lunch deli with offices above", w: [0, 0.4, 1, 0, 0.4], size: "M", lay: "strip", back: [["*", "prep"], [3, "cooler"], [2, "wc"]], ex: ["back", "fire"], st: 2, up: "offices" },
    ],
  },
};
