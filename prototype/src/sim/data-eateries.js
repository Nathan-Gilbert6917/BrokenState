// @ts-check
// Restaurants by kind of food, format and size (the user's request 2026-10-25, issue #33 of the interiors epic #7:
// "there should be a few dozen varients, sizes layout and kind of food for resauraunts"). Pure data that imports
// nothing: data-shops.js merges the variants into FRANCHISES (restaurant, pizza, diner, bar), eaterylayout.js lays them
// out, foods.js merges the cuisines' food mixes, and #29's hotels and #30's mall food court pick from the table through
// eaterylayout.js eateryVariant.
//
// EAT_SIZE: the footprint of each size in cells (a cell about a metre: #24's size table was not on dev when this was
//   built, so the sizes are this one const), outer walls included: tiny 6–10 m (a kiosk, a food truck's commissary, a
//   takeaway), small 10–15 m (a café, a takeaway), medium 15–25 m, large 25–40 m (fine dining, a buffet, a brewpub),
//   huge 40 m+ (a banquet hall, a buffet palace).
// FORMATS: each its own plan (eaterylayout.js EATERY_PLANS) and front of house: fastfood (the order counter with its
//   tills, a drive-through window and its lane, a small dining room, the fryer and grill line, a play structure),
//   fastcasual (an order counter and an assembly line, booths), cafe (an espresso bar, pastry cases, couches), diner (a
//   counter with stools, booths, a pie case, the open grill), family (a host stand, booths and tables, a kitchen line),
//   fine (a host stand, a bar, white-cloth tables, a wine cellar, a private dining room, a big kitchen of stations),
//   buffet (long steam tables, a salad bar, a dessert station), pub (a long bar with its taps, booths; a brewpub's
//   brewing tanks behind glass), kiosk (a tiny counter: a mall or roadside kiosk; a food truck parked at its commissary),
//   ghost (a pickup counter and a big kitchen), banquet (a foyer, a ballroom with its stage, a big kitchen).
// CUISINES: each changes the kitchen (line: its cooking pieces in the order they stand; sig: the pieces a place of it
//   always has, tools/restauranttest.js), the front (front: pieces in the dining room), the decor (tint: the booths'
//   colour; menu: what the menu board says), the walk-in's name and the food in its walk-ins, dry store and freezers
//   (mix: the food's items by calorie share, keeps: its "preserved" draws; foods.js MIXES "eat:<cuisine>" and
//   "eat:<cuisine>:keeps"; never the smoked sausage or the ground meat: those are the base's meat grinder's alone). Propane: a BBQ's pit room (appliances.js AREA_PROPANE pitroom) and a food truck (BOX_LOOT).
// VARIANTS: the table, cuisine × format × size, each a franchise or a local place of one of the four food kinds (kind:
//   the FRANCHISES list it joins; an id already there keeps its name, look and plan and gains its cuisine, format and
//   size), with its look (colours, sign, style 0–3 for the map painter, booth tint) and its plan (the floor, the front
//   room's name), where it stands (w: city, suburb, town, as every franchise) and the places it suits (at: main street,
//   strip mall pad, highway exit, city block, mall, hotel, truck stop: eateryVariant's setting).
import { REAL_SIZE } from "./data-buildingsize.js"; // the sizes (issue #24 took over EAT_SIZE)

/** @typedef {"tiny" | "small" | "medium" | "large" | "huge"} EatSize */
/** @typedef {{ id: string, name: string, kind: string, cuisine: string, format: string, size: EatSize, w: { city: number, suburb: number, town: number }, at: string[], look?: any, plan?: any, tint?: string, brew?: boolean, old?: boolean }} EatVariant */

// #24's real-world size table holds these now (data-buildingsize.js REAL_SIZE eattiny…eathuge, planned; "h" its "d").
export const EAT_SIZE = Object.fromEntries(["tiny", "small", "medium", "large", "huge"].map((k) => [k, { w: REAL_SIZE[`eat${k}`].w, h: REAL_SIZE[`eat${k}`].d }]));
export const EAT_SIZES = Object.keys(EAT_SIZE);

// The formats: name, the sizes they come in, the front room's default name.
export const FORMATS = {
  fastfood:   { name: "Fast food",           sizes: ["small", "medium", "large"], room: "Dining room" },
  fastcasual: { name: "Fast-casual",         sizes: ["small", "medium"],          room: "Order counter" },
  cafe:       { name: "Café",                sizes: ["tiny", "small", "medium"],  room: "Café" },
  diner:      { name: "Diner",               sizes: ["small", "medium", "large"], room: "Dining room" },
  family:     { name: "Family sit-down",     sizes: ["medium", "large"],          room: "Dining room" },
  fine:       { name: "Fine dining",         sizes: ["large", "huge"],            room: "Dining room" },
  buffet:     { name: "Buffet",              sizes: ["large", "huge"],            room: "Buffet hall" },
  pub:        { name: "Pub",                 sizes: ["small", "medium", "large"], room: "Pub" },
  kiosk:      { name: "Kiosk or food truck", sizes: ["tiny"],                     room: "Counter" },
  ghost:      { name: "Takeaway kitchen",    sizes: ["small", "medium"],          room: "Pickup counter" },
  banquet:    { name: "Banquet hall",        sizes: ["large", "huge"],            room: "Ballroom" },
};
// The formats that seat people (a host stand, a sit-down's dining room) and the counters (a mall's food court).
export const SITDOWN = ["family", "fine", "diner", "buffet", "pub", "banquet"];
export const COUNTER = ["fastfood", "fastcasual", "cafe", "kiosk", "ghost"];

// The cuisines. mix / keeps: foods.js item keys by weight.
export const CUISINES = {
  burgers:   { name: "Burgers", line: ["flattop", "fryer", "fryer"], sig: ["flattop", "fryer"], tint: "#8e3028", menu: "burgers",
    mix: { f_frozenmeat: 14, f_potatoes: 14, f_bread: 10, f_cheese: 6, f_onions: 4, f_sugar: 2, f_chips: 3 }, keeps: { f_cannedmeat: 8, f_beans: 4, f_sugar: 6, f_crackers: 3, f_jarred: 4 } },
  chicken:   { name: "Fried chicken", line: ["fryer", "fryer", "fryer"], sig: ["fryer"], tint: "#b8402a", menu: "chicken",
    mix: { f_frozenmeat: 16, f_potatoes: 12, f_flour: 10, f_bread: 4, f_cannedveg: 3 }, keeps: { f_flour: 6, f_cannedmeat: 6, f_beans: 6, f_sugar: 3 } },
  pizza:     { name: "Pizza", line: ["deckoven", "deckoven"], sig: ["deckoven"], front: [], tint: "#3f6b3a", menu: "pizza",
    mix: { f_flour: 18, f_cheese: 12, f_cannedveg: 8, f_frozenmeat: 4, f_onions: 3 }, keeps: { f_flour: 10, f_cannedveg: 8, f_pasta: 4, f_jarred: 4, f_cannedmeat: 3 } },
  mexican:   { name: "Mexican", line: ["flattop", "tortillapress", "steamtable"], sig: ["tortillapress"], front: ["saladbar"], tint: "#c86a20", menu: "tacos",
    mix: { f_drybeans: 14, f_rice: 10, f_flour: 8, f_corn: 6, f_frozenmeat: 8, f_cheese: 4, f_onions: 4 }, keeps: { f_drybeans: 10, f_beans: 8, f_rice: 6, f_cannedveg: 4 } },
  chinese:   { name: "Chinese", line: ["wokrange", "wokrange", "stockpot"], sig: ["wokrange"], front: ["tank"], tint: "#9a2a22", menu: "wok",
    mix: { f_rice: 20, f_pasta: 8, f_frozenmeat: 8, f_cannedveg: 6, f_onions: 3, f_eggs: 3 }, keeps: { f_rice: 14, f_pasta: 6, f_cannedveg: 4, f_sugar: 3 } },
  japanese:  { name: "Japanese and sushi", line: ["flattop", "range", "stockpot"], sig: ["sushibar"], front: ["sushibar"], tint: "#2a2a2e", menu: "sushi",
    mix: { f_rice: 22, f_smokedfish: 6, f_frozenmeat: 4, f_eggs: 3, f_cannedveg: 3 }, keeps: { f_rice: 14, f_smokedfish: 6, f_sugar: 2, f_crackers: 3 } },
  thai:      { name: "Thai and Vietnamese", line: ["wokrange", "stockpot", "stockpot"], sig: ["wokrange", "stockpot"], tint: "#6a3a7a", menu: "pho",
    mix: { f_rice: 16, f_pasta: 10, f_frozenmeat: 6, f_cannedveg: 6, f_onions: 4, f_peanutbutter: 3 }, keeps: { f_rice: 12, f_pasta: 6, f_peanutbutter: 4, f_sugar: 3 } },
  indian:    { name: "Indian", line: ["tandoor", "stockpot", "range"], sig: ["tandoor"], tint: "#c8402f", menu: "curry",
    mix: { f_rice: 16, f_drybeans: 12, f_flour: 8, f_onions: 5, f_frozenmeat: 6, f_potatoes: 4 }, keeps: { f_rice: 10, f_drybeans: 10, f_flour: 4, f_sugar: 3 } },
  italian:   { name: "Italian", line: ["range", "stockpot", "oven"], sig: ["stockpot"], tint: "#3f6b3a", menu: "pasta",
    mix: { f_pasta: 20, f_flour: 8, f_cannedveg: 8, f_cheese: 6, f_onions: 3, f_bread: 4 }, keeps: { f_pasta: 14, f_cannedveg: 8, f_jarred: 4, f_flour: 4 } },
  steak:     { name: "Steakhouse", line: ["chargrill", "chargrill", "range"], sig: ["chargrill"], tint: "#5a3424", menu: "steaks", cold: "Meat locker",
    mix: { f_frozenmeat: 24, f_potatoes: 12, f_onions: 4, f_bread: 4, f_cheese: 2 }, keeps: { f_cannedmeat: 10, f_jerky: 6, f_beans: 4, f_jarred: 3 } },
  bbq:       { name: "BBQ and smokehouse", line: ["range", "fryer"], sig: ["smoker"], tint: "#7a5230", menu: "bbq",
    mix: { f_frozenmeat: 26, f_drybeans: 8, f_potatoes: 8, f_bread: 4, f_sugar: 3 }, keeps: { f_jerky: 14, f_cannedmeat: 4, f_beans: 8, f_sugar: 4 } },
  seafood:   { name: "Seafood", line: ["fryer", "chargrill", "stockpot"], sig: ["lobstertank"], front: ["lobstertank"], tint: "#2f5d8a", menu: "fish",
    mix: { f_smokedfish: 12, f_potatoes: 10, f_flour: 6, f_rice: 6, f_frozenmeat: 4, f_onions: 3 }, keeps: { f_smokedfish: 10, f_crackers: 4, f_cannedveg: 4, f_rice: 4 } },
  greek:     { name: "Mediterranean and Greek", line: ["gyrospit", "chargrill", "range"], sig: ["gyrospit"], tint: "#3a6fb0", menu: "gyros",
    mix: { f_frozenmeat: 12, f_flour: 8, f_rice: 8, f_drybeans: 8, f_onions: 4, f_cheese: 3 }, keeps: { f_drybeans: 8, f_rice: 6, f_jarred: 6, f_driedfruit: 3 } },
  coffee:    { name: "Coffee and bakery", line: ["oven", "oven"], sig: ["espresso"], front: ["espresso", "pastrycase"], tint: "#5a4030", menu: "coffee",
    mix: { f_flour: 12, f_sugar: 10, f_bread: 8, f_eggs: 4, f_crackers: 4 }, keeps: { f_sugar: 10, f_flour: 6, f_honey: 3, f_crackers: 4, f_driedfruit: 2 } },
  donuts:    { name: "Donuts", line: ["fryer", "fryer", "oven"], sig: ["fryer", "pastrycase"], front: ["pastrycase", "espresso"], tint: "#e88aa0", menu: "donuts",
    mix: { f_flour: 16, f_sugar: 14, f_eggs: 4, f_candybar: 3 }, keeps: { f_sugar: 12, f_flour: 8, f_candybar: 3 } },
  icecream:  { name: "Ice cream", line: ["counter"], sig: ["softserve", "dipcabinet"], front: ["dipcabinet", "softserve"], tint: "#7fc6e6", menu: "ice cream",
    mix: { f_sugar: 14, f_candybar: 8, f_cannedfruit: 6, f_crackers: 3 }, keeps: { f_sugar: 10, f_cannedfruit: 6, f_candybar: 4 } },
  deli:      { name: "Sandwiches and deli", line: ["slicer", "flattop"], sig: ["slicer"], front: ["meatcase"], tint: "#3f6b3a", menu: "subs",
    mix: { f_bread: 14, f_cheese: 10, f_frozenmeat: 12, f_onions: 3, f_chips: 4 }, keeps: { f_cannedmeat: 14, f_crackers: 4, f_chips: 3, f_jarred: 3 } },
  breakfast: { name: "Breakfast and pancakes", line: ["flattop", "flattop", "range"], sig: ["flattop"], tint: "#c88a2a", menu: "pancakes",
    mix: { f_flour: 12, f_eggs: 10, f_oats: 6, f_sugar: 6, f_bread: 4, f_frozenmeat: 4, f_potatoes: 6 }, keeps: { f_oats: 8, f_flour: 6, f_honey: 4, f_sugar: 6, f_cereal: 4 } },
  southern:  { name: "Southern and soul food", line: ["fryer", "range", "stockpot", "steamtable"], sig: ["steamtable"], tint: "#8e4f3c", menu: "soul food",
    mix: { f_frozenmeat: 10, f_flour: 8, f_corn: 6, f_drybeans: 8, f_potatoes: 8, f_cannedveg: 4 }, keeps: { f_drybeans: 8, f_beans: 6, f_jarred: 6, f_flour: 4 } },
  veg:       { name: "Vegetarian and salad", line: ["range", "counter"], sig: ["saladbar"], front: ["saladbar"], tint: "#5fa04a", menu: "salads",
    mix: { f_cannedveg: 10, f_drybeans: 8, f_rice: 6, f_apples: 4, f_potatoes: 4, f_onions: 4, f_oats: 4 }, keeps: { f_drybeans: 8, f_cannedveg: 8, f_driedfruit: 4, f_peanutbutter: 3 } },
  noodles:   { name: "Noodle bar", line: ["stockpot", "stockpot", "wokrange"], sig: ["stockpot"], tint: "#2a2a2a", menu: "ramen",
    mix: { f_pasta: 20, f_rice: 6, f_eggs: 4, f_frozenmeat: 4, f_cannedveg: 4 }, keeps: { f_pasta: 14, f_rice: 6, f_soup: 4 } },
  korean:    { name: "Korean BBQ", line: ["range", "wokrange"], sig: ["kbbqtable"], front: ["kbbqtable"], tint: "#c8402f", menu: "k-bbq",
    mix: { f_frozenmeat: 18, f_rice: 14, f_cannedveg: 6, f_onions: 3 }, keeps: { f_rice: 12, f_jarred: 6, f_cannedmeat: 4 } },
  hotdogs:   { name: "Hot dogs", line: ["flattop", "steamtable"], sig: ["flattop"], tint: "#e8c04a", menu: "hot dogs",
    mix: { f_frozenmeat: 12, f_bread: 10, f_onions: 4, f_chips: 4 }, keeps: { f_cannedmeat: 14, f_chips: 3 } },
  wings:     { name: "Wings and sports bar", line: ["fryer", "fryer", "fryer", "flattop"], sig: ["fryer"], tint: "#3a5f8e", menu: "wings",
    mix: { f_frozenmeat: 18, f_potatoes: 10, f_flour: 4, f_chips: 4 }, keeps: { f_cannedmeat: 8, f_chips: 4, f_crackers: 4, f_jerky: 3 } },
  cafeteria: { name: "Cafeteria", line: ["range", "steamtable", "steamtable"], sig: ["steamtable"], front: ["saladbar"], tint: "#7d848c", menu: "lunch",
    mix: { f_potatoes: 10, f_rice: 8, f_pasta: 8, f_cannedveg: 8, f_frozenmeat: 6, f_bread: 4 }, keeps: { f_beans: 8, f_cannedveg: 8, f_rice: 6, f_soup: 4 } },
};

const G = (city, suburb, town) => ({ city, suburb, town });
const L = (wall, trim, sign, text, accent, style = 0) => ({ wall, trim, sign, text, accent, style });
const V = (id, name, kind, cuisine, format, size, w, at, look = null, plan = null, more = {}) => ({ id, name, kind, cuisine, format, size, w, at, ...(look ? { look } : {}), ...(plan ? { plan } : {}), ...more });
const O = { old: true }; // a franchise already in data-shops.js FRANCHISES: its name, look and plan kept
// Where a place stands (at): main (a town's or a suburb's main street), strip (a strip-mall pad), highway (an exit),
// city (a city block), mall (a food court), hotel, truckstop.
const ROAD = ["highway", "strip", "truckstop"], TOWN = ["main", "strip"], DOWN = ["city", "main"];

/** @type {EatVariant[]} */
export const VARIANTS = [
  // ---------- restaurants (FRANCHISES.restaurant): the ten that were there, then the new ----------
  V("burgerbarn", "Burger Barn", "restaurant", "burgers", "fastfood", "medium", G(1, 1, 1), [...ROAD, ...TOWN], null, null, O),
  V("cluckshack", "Cluck Shack", "restaurant", "chicken", "fastfood", "medium", G(1, 1, 0.8), [...ROAD, ...TOWN], null, null, O),
  V("tacorio", "Taco Rio", "restaurant", "mexican", "fastfood", "medium", G(1, 0.9, 0.6), [...ROAD, "strip", "mall"], null, null, O),
  V("goldenwok", "Golden Wok", "restaurant", "chinese", "ghost", "small", G(1, 0.8, 0.5), ["strip", "city", "main"], null, null, O),
  V("bigsky", "Big Sky Steakhouse", "restaurant", "steak", "family", "large", G(0.6, 1, 0.8), ["highway", "strip", "hotel"], null, null, O),
  V("smokypete", "Smoky Pete's BBQ", "restaurant", "bbq", "family", "medium", G(0.4, 0.7, 1), ["highway", "main"], null, null, O),
  V("beanthere", "Bean There Coffee", "restaurant", "coffee", "cafe", "small", G(1, 0.9, 0.6), [...DOWN, "strip", "mall", "hotel"], null, null, O),
  V("substation", "Sub Station", "restaurant", "deli", "fastcasual", "small", G(1, 1, 0.5), ["strip", "mall", "city"], null, null, O),
  V("noodlehouse", "Noodle House", "restaurant", "noodles", "fastcasual", "medium", G(1, 0.5, 0.1), ["city", "mall"], null, null, O),
  V("sals", "Sal's Italian Kitchen", "restaurant", "italian", "family", "medium", G(0.8, 0.8, 0.6), ["main", "city", "hotel"], null, null, O),
  V("sakura", "Sakura Sushi", "restaurant", "japanese", "family", "medium", G(1, 0.7, 0.2), ["city", "strip", "hotel"], L("#2a2a2e", "#111114", "#e88aa0", "#ffffff", "#c8402f", 3), { room: "Sushi bar", fl: "wood" }),
  V("kobe", "Kobe Teppan House", "restaurant", "japanese", "fine", "large", G(1, 0.6, 0), ["city", "hotel"], L("#1c2026", "#0a0c10", "#c8402f", "#f0e6c8", "#d9a520", 3), { room: "Dining room", fl: "wood" }),
  V("saigonpho", "Saigon Pho", "restaurant", "thai", "fastcasual", "small", G(1, 0.6, 0.2), ["city", "strip", "mall"], L("#e8c04a", "#8a4b32", "#c8402f", "#ffffff", "#3f6b3a", 0), { room: "Pho counter", fl: "tile" }),
  V("bangkok", "Bangkok Garden", "restaurant", "thai", "family", "medium", G(0.8, 0.8, 0.3), ["main", "city", "strip"], L("#6a3a7a", "#2a1c3a", "#d9a520", "#2a1c3a", "#9cc46e", 1), { room: "Dining room", fl: "wood" }),
  V("tajpalace", "Taj Palace", "restaurant", "indian", "family", "medium", G(1, 0.7, 0.2), ["city", "strip", "hotel"], L("#c8402f", "#5a1410", "#d9a520", "#5a1410", "#e8a020", 2), { room: "Dining room", fl: "carpet" }),
  V("curryexpress", "Curry Express", "restaurant", "indian", "ghost", "small", G(1, 0.5, 0.2), ["city", "strip"], L("#e8a020", "#8a4b32", "#2a2a2a", "#e8c04a", "#c8402f", 0), { room: "Pickup counter", fl: "tile" }),
  V("villatoscana", "Villa Toscana", "restaurant", "italian", "fine", "large", G(1, 0.7, 0.2), ["city", "hotel", "main"], L("#d9c9a8", "#5a3a20", "#3f6b3a", "#f0e6c8", "#c8402f", 1), { room: "Dining room", fl: "wood" }),
  V("chophouse", "The Chophouse", "restaurant", "steak", "fine", "large", G(1, 0.6, 0.1), ["city", "hotel"], L("#3a2a20", "#1a120c", "#d9a520", "#3a2a20", "#a2713f", 3), { room: "Dining room", fl: "wood" }),
  V("captainscatch", "Captain's Catch", "restaurant", "seafood", "family", "medium", G(0.6, 1, 0.8), ["highway", "strip", "main"], L("#e8e4d8", "#2f5d8a", "#2f5d8a", "#ffffff", "#c8402f", 2), { room: "Dining room", fl: "wood" }),
  V("pearloyster", "The Pearl Oyster Bar", "restaurant", "seafood", "fine", "large", G(1, 0.5, 0), ["city", "hotel"], L("#c9ced3", "#1f3550", "#1f3550", "#e8e4d8", "#d9a520", 3), { room: "Oyster bar", fl: "tile" }),
  V("olympia", "Olympia Gyros", "restaurant", "greek", "fastcasual", "small", G(1, 0.7, 0.4), ["city", "strip", "mall"], L("#e8e4d8", "#3a6fb0", "#3a6fb0", "#ffffff", "#e8c04a", 0), { room: "Gyro counter", fl: "tile" }),
  V("goldencrust", "Golden Crust Bakery", "restaurant", "coffee", "cafe", "medium", G(0.8, 0.8, 0.8), ["main", "city"], L("#d8b47a", "#7a5230", "#7a5230", "#f0e6c8", "#c8402f", 0), { room: "Bakery café", fl: "wood" }),
  V("holelotta", "Hole Lotta Donuts", "restaurant", "donuts", "cafe", "small", G(0.8, 1, 0.9), [...ROAD, "strip"], L("#e88aa0", "#8a3a50", "#ffffff", "#8a3a50", "#e8c04a", 2), { room: "Donut counter", fl: "tile" }),
  V("polarswirl", "Polar Swirl", "restaurant", "icecream", "kiosk", "tiny", G(0.8, 1, 0.8), ["mall", "strip", "main"], L("#7fc6e6", "#2f5d8a", "#ffffff", "#2f5d8a", "#e88aa0", 2), { room: "Ice cream counter", fl: "checker" }),
  V("frostys", "Frosty's Creamery", "restaurant", "icecream", "cafe", "small", G(0.4, 0.8, 1), ["main", "highway"], L("#e8e4d8", "#e88aa0", "#e88aa0", "#ffffff", "#7fc6e6", 1), { room: "Parlour", fl: "checker" }),
  V("unclemoes", "Uncle Moe's Deli", "restaurant", "deli", "fastcasual", "medium", G(1, 0.6, 0.4), ["city", "main"], L("#d9c9a8", "#3a2a20", "#c8402f", "#ffffff", "#3f6b3a", 0), { room: "Deli counter", fl: "checker" }),
  V("sunnyside", "Sunny Side Pancake House", "restaurant", "breakfast", "family", "medium", G(0.6, 1, 0.9), ["highway", "strip", "hotel"], L("#e8c04a", "#3a6fb0", "#3a6fb0", "#ffffff", "#c8402f", 1), { room: "Dining room", fl: "tile" }),
  V("mamalous", "Mama Lou's Soul Kitchen", "restaurant", "southern", "family", "medium", G(0.8, 0.6, 0.8), ["main", "city"], L("#8e4f3c", "#4a2a20", "#e8c04a", "#4a2a20", "#3f6b3a", 0), { room: "Dining room", fl: "wood" }),
  V("greenleaf", "Green Leaf Salads", "restaurant", "veg", "fastcasual", "small", G(1, 0.7, 0.2), ["city", "mall", "strip"], L("#9cc46e", "#3f6b3a", "#3f6b3a", "#ffffff", "#e8e4d8", 3), { room: "Salad counter", fl: "wood" }),
  V("seoulgrill", "Seoul Grill", "restaurant", "korean", "family", "large", G(1, 0.6, 0.1), ["city", "strip"], L("#2a2a2e", "#111114", "#c8402f", "#ffffff", "#e8c04a", 3), { room: "Grill room", fl: "wood" }),
  V("topdog", "Top Dog", "restaurant", "hotdogs", "kiosk", "tiny", G(1, 0.8, 0.6), ["mall", "city", "highway"], L("#e8c04a", "#c8402f", "#c8402f", "#ffffff", "#2a2a2a", 1), { room: "Hot dog stand", fl: "tile" }),
  V("emperorsbuffet", "Emperor's Buffet", "restaurant", "chinese", "buffet", "huge", G(0.6, 1, 0.4), ["strip", "highway"], L("#c8402f", "#5a1410", "#d9a520", "#5a1410", "#d9a520", 3), { room: "Buffet hall", fl: "carpet" }),
  V("countrybuffet", "Country Kitchen Buffet", "restaurant", "southern", "buffet", "large", G(0.3, 0.9, 1), ["highway", "strip"], L("#b9a98a", "#6b5434", "#c8402f", "#ffffff", "#e8c04a", 0), { room: "Buffet hall", fl: "carpet" }),
  V("rubys", "Ruby's Cafeteria", "restaurant", "cafeteria", "buffet", "large", G(0.8, 0.8, 0.6), ["city", "main", "mall"], L("#c9c2b0", "#8e3028", "#8e3028", "#ffffff", "#e8e4d8", 2), { room: "Cafeteria", fl: "checker" }),
  V("crystalballroom", "The Crystal Ballroom", "restaurant", "italian", "banquet", "huge", G(1, 0.7, 0.3), ["city", "hotel"], L("#e8e4d8", "#5d6168", "#d9a520", "#2a2a2e", "#c9ced3", 3), { room: "Ballroom", fl: "wood" }),
  V("libertyhall", "Liberty Hall Banquets", "restaurant", "southern", "banquet", "large", G(0.2, 0.7, 1), ["main", "highway"], L("#b9a98a", "#3a5f8e", "#3a5f8e", "#ffffff", "#c8402f", 0), { room: "Banquet hall", fl: "wood" }),
  V("elcamion", "El Camión Taco Truck", "restaurant", "mexican", "kiosk", "tiny", G(1, 0.8, 0.8), ["strip", "highway", "city"], L("#e8a020", "#3f6b3a", "#c8402f", "#ffffff", "#3f6b3a", 2), { room: "Commissary counter", fl: "conc", truck: true }),
  V("smokewagon", "Smoke Wagon BBQ", "restaurant", "bbq", "kiosk", "tiny", G(0.3, 0.8, 1), ["highway", "main"], L("#3a2414", "#1a120c", "#e8a020", "#3a2414", "#c8402f", 2), { room: "Commissary counter", fl: "conc", truck: true }),
  V("woktogo", "Wok To Go", "restaurant", "chinese", "kiosk", "tiny", G(1, 0.6, 0.2), ["mall", "city"], L("#c8402f", "#5a1410", "#ffffff", "#5a1410", "#d9a520", 1), { room: "Wok counter", fl: "tile" }),
  V("wingit", "Wing It", "restaurant", "wings", "ghost", "medium", G(1, 0.8, 0.4), ["city", "strip"], L("#e8a020", "#2a2a2a", "#2a2a2a", "#e8a020", "#c8402f", 3), { room: "Pickup counter", fl: "conc" }),
  V("bigbird", "Big Bird Fried Chicken", "restaurant", "chicken", "fastfood", "large", G(0.6, 1, 0.8), [...ROAD], L("#e8c04a", "#8e3028", "#8e3028", "#ffffff", "#e8e4d8", 1), { room: "Dining room", fl: "tile" }),
  V("javacart", "Java Cart", "restaurant", "coffee", "kiosk", "tiny", G(1, 0.6, 0.3), ["mall", "hotel", "city"], L("#3a2a20", "#1a120c", "#d8b47a", "#ffffff", "#9cc46e", 3), { room: "Coffee kiosk", fl: "wood" }),
  V("fryshack", "Fry Shack", "restaurant", "burgers", "kiosk", "tiny", G(0.8, 0.8, 0.6), ["mall", "highway"], L("#c8402f", "#7a1c18", "#e8c04a", "#7a1c18", "#ffffff", 1), { room: "Fry counter", fl: "tile" }),
  V("tacofiesta", "Taco Fiesta Cantina", "restaurant", "mexican", "family", "large", G(0.6, 1, 0.6), ["strip", "highway"], L("#3f6b3a", "#1c2a18", "#e8a020", "#ffffff", "#c8402f", 2), { room: "Cantina", fl: "tile" }),
  // ---------- pizza (FRANCHISES.pizza) ----------
  V("tonys", "Tony's Pizzeria", "pizza", "pizza", "family", "medium", G(1, 1, 0.8), ["main", "city", "strip"], null, null, O),
  V("pizzapalace", "Pizza Palace", "pizza", "pizza", "buffet", "large", G(1, 1, 0.6), ["strip", "highway"], null, null, O),
  V("sliceheaven", "Slice of Heaven", "pizza", "pizza", "fastcasual", "small", G(1, 0.7, 0.4), ["city", "mall", "strip"], null, null, O),
  V("brickoven", "Brick Oven Co.", "pizza", "pizza", "family", "medium", G(0.8, 0.8, 0.5), ["main", "city"], null, null, O),
  V("piehole", "The Pie Hole", "pizza", "pizza", "ghost", "small", G(0.4, 0.8, 1), ["main", "strip"], null, null, O),
  V("pizzapronto", "Pizza Pronto", "pizza", "pizza", "fastfood", "medium", G(0.8, 1, 0.8), [...ROAD, "strip"], L("#3a6fb0", "#1f3550", "#e8c04a", "#1f3550", "#c8402f", 1), { room: "Dining room", fl: "tile" }),
  V("slicecart", "Slice Cart", "pizza", "pizza", "kiosk", "tiny", G(1, 0.6, 0.3), ["mall", "city"], L("#e8e4d8", "#c8402f", "#c8402f", "#ffffff", "#3f6b3a", 2), { room: "Slice counter", fl: "tile" }),
  // The pizza places that make a dozen (the user's request 2026-10-25: "a dozen varients per building type").
  V("nonnas", "Nonna's Wood-Fired Trattoria", "pizza", "pizza", "fine", "large", G(1, 0.7, 0.3), ["city", "main", "hotel"], L("#d9c9a8", "#8e4f3c", "#3f6b3a", "#f0e6c8", "#c8402f", 1), { room: "Trattoria", fl: "wood" }),
  V("windycity", "Windy City Deep Dish", "pizza", "pizza", "family", "large", G(0.8, 1, 0.5), ["strip", "main", "city"], L("#2a2a2e", "#c8402f", "#c8402f", "#ffffff", "#3a6fb0", 3), { room: "Dining room", fl: "tile" }),
  V("galaxypizza", "Galaxy Pizza & Arcade", "pizza", "pizza", "buffet", "huge", G(0.4, 1, 0.6), ["strip", "highway", "mall"], L("#3a1c5a", "#1a0c2a", "#e8c04a", "#3a1c5a", "#7fe6ff", 2), { room: "Arcade parlour", fl: "carpet" }),
  V("roccos", "Rocco's Carry-Out", "pizza", "pizza", "ghost", "medium", G(0.8, 1, 0.8), ["strip", "main"], L("#e8e4d8", "#3f6b3a", "#3f6b3a", "#ffffff", "#c8402f", 0), { room: "Carry-out counter", fl: "tile" }),
  V("joesslice", "Joe's Slice Window", "pizza", "pizza", "cafe", "small", G(1, 0.6, 0.4), ["city", "main"], L("#c8402f", "#2a2a2a", "#e8e4d8", "#c8402f", "#e8c04a", 0), { room: "Slice window", fl: "checker" }),
  V("hopspies", "Hops & Pies Pizza Pub", "pizza", "pizza", "pub", "medium", G(0.8, 0.8, 0.6), ["main", "city"], L("#7a5230", "#3a2414", "#e8a020", "#3a2414", "#3f6b3a", 2), { room: "Pizza pub", fl: "wood" }),
  // ---------- diners (FRANCHISES.diner) ----------
  V("starlite", "Starlite Diner", "diner", "burgers", "diner", "medium", G(1, 1, 0.8), ["highway", "main", "truckstop"], null, null, O),
  V("route9", "Route 9 Diner", "diner", "breakfast", "diner", "medium", G(0.3, 0.8, 1), ["highway", "truckstop"], null, null, O),
  V("lous", "Lou's Lunch Counter", "diner", "deli", "diner", "small", G(0.6, 0.6, 1), ["main"], null, null, O),
  V("silverspoon", "Silver Spoon Diner", "diner", "southern", "diner", "medium", G(0.8, 1, 0.6), ["highway", "main"], null, null, O),
  V("waffleshack", "Waffle Shack", "diner", "breakfast", "diner", "small", G(0.5, 1, 1), ["highway", "truckstop"], null, null, O),
  V("hwy40", "Highway 40 Truckers' Diner", "diner", "steak", "diner", "large", G(0, 0.5, 1), ["highway", "truckstop"], L("#c9ced3", "#3a5f8e", "#c8402f", "#ffffff", "#e8c04a", 1), { room: "Dining room", fl: "tile" }),
  V("silverbullet", "Silver Bullet Railcar Diner", "diner", "burgers", "diner", "small", G(0.6, 0.8, 1), ["highway", "main"], L("#c9ced3", "#5d6168", "#c8402f", "#ffffff", "#c9ced3", 3), { room: "Railcar", fl: "checker" }),
  V("bigrig", "Big Rig Truck Stop Diner", "diner", "steak", "family", "large", G(0, 0.4, 1), ["truckstop", "highway"], L("#8b6a48", "#3a2a20", "#e8a020", "#3a2a20", "#c8402f", 1), { room: "Truckers' dining room", fl: "tile" }),
  V("allnite", "All-Nite Family Diner", "diner", "breakfast", "family", "medium", G(0.8, 1, 0.8), ["highway", "strip", "main"], L("#e8e4d8", "#c8402f", "#c8402f", "#ffffff", "#e8c04a", 2), { room: "Dining room", fl: "tile" }),
  V("sweetsips", "Sweet Sips Soda Fountain", "diner", "icecream", "diner", "small", G(0.6, 0.8, 1), ["main"], L("#e88aa0", "#7fc6e6", "#7fc6e6", "#ffffff", "#e88aa0", 1), { room: "Soda fountain", fl: "checker" }),
  V("deesdrivein", "Dee's Drive-In", "diner", "burgers", "fastfood", "medium", G(0.3, 0.8, 1), ["highway", "main"], L("#e8c04a", "#c8402f", "#c8402f", "#ffffff", "#3a6fb0", 2), { room: "Drive-in counter", fl: "tile" }),
  V("mainstlunch", "Main Street Lunch Counter", "diner", "cafeteria", "diner", "medium", G(0.4, 0.6, 1), ["main"], L("#b9a98a", "#6b5434", "#3f6b3a", "#ffffff", "#c8402f", 0), { room: "Lunch counter", fl: "wood" }),
  V("pancakejct", "Pancake Junction", "diner", "breakfast", "buffet", "large", G(0.4, 1, 0.8), ["highway", "strip", "truckstop"], L("#e8a020", "#5a3a20", "#5a3a20", "#f0e6c8", "#c8402f", 1), { room: "Breakfast buffet", fl: "tile" }),
  // ---------- bars (FRANCHISES.bar) ----------
  V("rustynail", "The Rusty Nail", "bar", "burgers", "pub", "small", G(0.3, 0.6, 1), ["main", "highway"], null, null, O),
  V("roadhouse61", "Roadhouse 61", "bar", "bbq", "pub", "large", G(0, 0.4, 1), ["highway"], null, null, O),
  V("omalleys", "O'Malley's Pub", "bar", "burgers", "pub", "medium", G(1, 0.7, 0.5), ["city", "main"], null, null, O),
  V("velvetlounge", "The Velvet Lounge", "bar", "greek", "pub", "medium", G(1, 0.4, 0), ["city", "hotel"], null, null, O),
  V("touchdown", "Touchdown Sports Bar", "bar", "wings", "pub", "large", G(1, 1, 0.5), ["strip", "city"], null, null, O),
  V("lastcall", "Last Call Tavern", "bar", "burgers", "pub", "small", G(0.6, 0.8, 0.9), ["main"], null, null, O),
  V("neonmoose", "Neon Moose Saloon", "bar", "steak", "pub", "medium", G(0, 0.3, 1), ["main", "highway"], null, null, O),
  V("copperkettle", "Copper Kettle Brewpub", "bar", "burgers", "pub", "large", G(1, 0.8, 0.4), ["city", "main"], L("#a2713f", "#5a3a20", "#d9a520", "#3a2414", "#c4562a", 2), { room: "Brewpub", fl: "wood" }, { brew: true }),
  V("ironhorse", "Iron Horse Brewing Co.", "bar", "bbq", "pub", "large", G(0.3, 0.8, 1), ["main", "highway"], L("#5d6168", "#2a2a2e", "#e8a020", "#2a2a2e", "#c8402f", 1), { room: "Taproom", fl: "conc" }, { brew: true }),
  V("luckysdive", "Lucky's Dive", "bar", "hotdogs", "pub", "small", G(1, 0.5, 0.8), ["city", "main"], L("#3a3a3e", "#1a1a1e", "#c8402f", "#e8c04a", "#9cc46e", 0), { room: "Dive bar", fl: "conc" }),
  V("bootscootin", "Boot Scootin' Honky-Tonk", "bar", "bbq", "banquet", "large", G(0, 0.4, 1), ["highway", "main"], L("#a2713f", "#5a3a20", "#e8c04a", "#5a3a20", "#c8402f", 2), { room: "Dance hall", fl: "wood" }),
  V("gilded", "The Gilded Cocktail Lounge", "bar", "seafood", "fine", "large", G(1, 0.4, 0), ["city", "hotel"], L("#1c2026", "#0a0c10", "#d9a520", "#1c2026", "#d9a520", 3), { room: "Lounge", fl: "carpet" }),
  V("ironriders", "Iron Riders Biker Bar", "bar", "wings", "pub", "small", G(0.2, 0.5, 1), ["highway"], L("#2a2a2a", "#111114", "#c8402f", "#e8e4d8", "#7d848c", 1), { room: "Biker bar", fl: "conc" }),
  V("grandhotelbar", "The Grand Hotel Bar", "bar", "italian", "pub", "small", G(1, 0.5, 0.2), ["hotel", "city"], L("#5a3424", "#2a1810", "#d9a520", "#f0e6c8", "#3f6b3a", 3), { room: "Hotel bar", fl: "carpet" }),
  V("alpinegarten", "Alpine Biergarten", "bar", "deli", "pub", "large", G(0.6, 0.8, 0.6), ["main", "city"], L("#3f6b3a", "#1c2a18", "#e8e4d8", "#1c2a18", "#c8402f", 0), { room: "Beer hall", fl: "wood" }),
  V("clubpulse", "Club Pulse", "bar", "wings", "banquet", "huge", G(1, 0.4, 0), ["city"], L("#2a2a2e", "#111114", "#b06ae0", "#ffffff", "#7fe6ff", 3), { room: "Dance floor", fl: "tile" }),
];
/** The variant of a franchise of a food kind, or null. @param {string} kind @param {string | null | undefined} id */
export const variantById = (kind, id) => (id ? VARIANTS.find((v) => v.kind === kind && v.id === id) || null : null);
