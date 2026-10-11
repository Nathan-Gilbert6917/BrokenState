// Food by type (user request 2026-10-10: "Overhaul food to not just be a generic food item split it into several types
// of food each with different expirations"). There is no generic "Food" supply any more: every food is an item of its
// own (FOODS below), held in the same stocks as any supply (base.stock, a team's supplies and cargo, a group's stock,
// a caravan's goods: SUPPLIES has every FOODS key, cat "food"), and each one keeps for its own time.
//
// Satiety. NEEDS.food (40 hunger points) is one person's day, and a day's need is DAY_KCAL (2000 kcal): an item fills
// hunger by its kcal. Everything that plans in "days of food" (the governor, the forecasts, the expedition planner,
// the AI groups) counts foodIn(stock) = the stock's kcal / DAY_KCAL: one old "food" unit is 2000 kcal. The numbers
// per item are realistic-ish (a can of beans 400 kcal, an MRE 1250, a kilo of venison 1500).
//
// Shelf life. FOODS[k].shelf = days the item keeps at room temperature (a dry pantry: storage factor 1). Bases and
// teams keep lots per item ({ q, left, egg }: left = days of shelf left, egg = it carries the worm's eggs) on the
// holder (base.foodLots, party.foodLots for its packed supplies, cargo.foodLots for what it found). Each day `left`
// drops by the storage factor of where the lot sits (storage.js: outside 1.5× and worse in heat and rain, a pantry or
// storehouse 1×, a root cellar 0.35×, a cold store 0.3× in winter, a powered walk-in freezer 0.05×); at 0 the lot is
// gone (user pick 2026-10-10: spoiled food just disappears, with a line in the log). Eating, cooking, selling and
// shipping take the lot nearest to spoiling first. Lots follow the stock (syncLots): code that adds to a stock without
// a lot (loot, trade, a gift) gets a fresh lot (an early-only shop item, bread, cheese, frozen meat, comes with the
// days it has already sat since the outbreak); code that takes from a stock takes the oldest lots.
// The AI groups keep no lots (ageCoarse: each item loses a share of its stock a day by its shelf life: cheap).
//
// Value (user pick 2026-10-10: "item value comes from shelf life, quality and satiation"): foodValue below, from the
// kcal (satiation), the shelf life (longer keeps = dearer per kcal) and the quality tier (raw < plain < preserved <
// simple meal < fine meal / survival rations < lavish meal). Every price reads it (SUPPLIES[k].value: trade.js,
// valuation.js, radiotrade.js, caravans.js).
//
// Diet tags (wave 2: vegetarians, cannibals, picky eaters): diet "meat" (contains meat or fish), "animal" (eggs,
// milk, cheese, honey), "veg" (plants only), "mixed" (a meal of both). "human" is reserved for meat from butchering
// bodies later: there is no source for it (do not add one here).
// Fields: name, word (after a count: "12 cans of beans"), icon, group (FOOD_GROUPS), tier (quality), kcal, kg, shelf
// (days at room temperature), diet, raw (raw meat or fish: wants cooking; eaten raw it turns the stomach, worm.js),
// ingredient (a cooking bill takes it: cooking.js CLASSES), until (an early-only shop item: days after the
// outbreak it can still be found), shopOnly (only shops have it: a new lot is as old as the outbreak), moodLift (a meal: wave 2's mood ladder), desc.
import { Rng } from "./rng.js";

export const DAY_KCAL = 2000;
// Stable food (shelf ≥ STABLE_DAYS) needs no cold room: it sits in any dry corner (storage.js). The rest fills the
// base's food rooms, coldest first for what spoils fastest.
export const STABLE_DAYS = 100;

export const FOOD_GROUPS = {
  canned:    { name: "Canned" },
  dry:       { name: "Dry goods" },
  packaged:  { name: "Snacks" },
  military:  { name: "Rations" },
  preserved: { name: "Preserved" },
  fresh:     { name: "Fresh" },
  produce:   { name: "Produce" },
  crop:      { name: "Crops" },
  forage:    { name: "Foraged" },
  rawmeat:   { name: "Raw meat" },
  rawfish:   { name: "Raw fish" },
  meal:      { name: "Meals" },
};
// Quality tiers, lowest first (wave 2's mood ladder reads tier; value reads TIER_VALUE).
export const TIERS = ["raw", "plain", "preserved", "simple", "survival", "fine", "lavish"];
export const TIER_VALUE = { raw: 0.75, plain: 1, preserved: 1.4, simple: 1.2, survival: 1.6, fine: 1.6, lavish: 2 };

export const FOODS = {
  // ---- canned (shops, houses, warehouses): heavy for their calories, they keep for years ----
  f_beans:      { name: "Canned beans",       word: "cans of beans",        icon: "🥫", group: "canned", tier: "plain", kcal: 400,  kg: 0.45, shelf: 1100, diet: "veg",   desc: "Baked or kidney beans in a tin. Heavy, filling and keeps for years." },
  f_soup:       { name: "Canned soup",        word: "cans of soup",         icon: "🥫", group: "canned", tier: "plain", kcal: 250,  kg: 0.45, shelf: 900,  diet: "mixed", desc: "Chicken noodle, tomato, minestrone. More water than food, but warm and easy." },
  f_cannedveg:  { name: "Canned vegetables",  word: "cans of vegetables",   icon: "🥫", group: "canned", tier: "plain", kcal: 200,  kg: 0.45, shelf: 1100, diet: "veg",   desc: "Corn, peas, carrots and green beans. Little food for the weight." },
  f_cannedfruit:{ name: "Canned fruit",       word: "cans of fruit",        icon: "🥫", group: "canned", tier: "plain", kcal: 300,  kg: 0.45, shelf: 700,  diet: "veg",   desc: "Peaches and pears in syrup: sugar and a little vitamin C." },
  f_cannedmeat: { name: "Canned meat",        word: "cans of meat",         icon: "🥫", group: "canned", tier: "plain", kcal: 600,  kg: 0.4,  shelf: 1400, diet: "meat",  desc: "Spam, corned beef, tuna and chicken. The best food a can holds." },
  // ---- dry goods ----
  f_rice:       { name: "Rice",               word: "kg of rice",           icon: "🍚", group: "dry", tier: "plain", kcal: 3600, kg: 1,    shelf: 1500, diet: "veg",   desc: "A one-kilo bag of white rice. Keeps for years if it stays dry; wants water and a fire." },
  f_pasta:      { name: "Pasta",              word: "packets of pasta",     icon: "🍝", group: "dry", tier: "plain", kcal: 1800, kg: 0.5,  shelf: 700,  diet: "veg",   desc: "Half a kilo of dried pasta." },
  f_oats:       { name: "Oats",               word: "bags of oats",         icon: "🥣", group: "dry", tier: "plain", kcal: 1900, kg: 0.5,  shelf: 600,  diet: "veg",   desc: "Rolled oats: porridge with a little water, or eaten dry on the road." },
  f_flour:      { name: "Flour",              word: "kg of flour",          icon: "🌾", group: "dry", tier: "plain", kcal: 3600, kg: 1,    shelf: 300,  diet: "veg",   desc: "A kilo bag of flour. Goes stale in a year; bread, flatbread and dumplings when there is a kitchen." },
  f_cereal:     { name: "Cereal",             word: "boxes of cereal",      icon: "🥣", group: "dry", tier: "plain", kcal: 1900, kg: 0.55, shelf: 300,  diet: "veg",   desc: "A box of breakfast cereal. Light and eaten dry." },
  f_crackers:   { name: "Crackers",           word: "packs of crackers",    icon: "🍘", group: "dry", tier: "plain", kcal: 1100, kg: 0.3,  shelf: 270,  diet: "veg",   desc: "Saltines and water biscuits." },
  f_sugar:      { name: "Sugar",              word: "kg of sugar",          icon: "🧂", group: "dry", tier: "plain", kcal: 3900, kg: 1,    shelf: 3000, diet: "veg",   desc: "A kilo of sugar: keeps forever, and nobody lives on it." },
  f_honey:      { name: "Honey",              word: "jars of honey",        icon: "🍯", group: "dry", tier: "plain", kcal: 1500, kg: 0.65, shelf: 5000, diet: "animal", desc: "Half a kilo of honey, from a shop shelf or a wild hive. It never spoils." },
  f_peanutbutter:{ name: "Peanut butter",     word: "jars of peanut butter", icon: "🥜", group: "dry", tier: "plain", kcal: 2950, kg: 0.6, shelf: 500,  diet: "veg",   desc: "A 500 g jar: the most food for the weight on a supermarket shelf." },
  f_grain:      { name: "Grain",              word: "kg of grain",          icon: "🌾", group: "dry", tier: "plain", kcal: 3300, kg: 1,    shelf: 730,  diet: "veg",   desc: "Threshed wheat from the fields: keeps a couple of years dry; boiled, ground or sown." },
  f_drybeans:   { name: "Dry beans",          word: "kg of dry beans",      icon: "🫘", group: "dry", tier: "plain", kcal: 3400, kg: 1,    shelf: 900,  diet: "veg",   desc: "Beans dried on the vine. Keep for years; soak and boil them." },
  // ---- snacks (gas stations, pharmacies, shops) ----
  f_chips:      { name: "Chips",              word: "bags of chips",        icon: "🥔", group: "packaged", tier: "plain", kcal: 1070, kg: 0.22, shelf: 90, diet: "veg",   desc: "A big bag of potato chips. Goes stale in a few months." },
  f_candybar:   { name: "Candy bar",          word: "candy bars",           icon: "🍫", group: "packaged", tier: "plain", kcal: 250,  kg: 0.06, shelf: 300, diet: "animal", desc: "Chocolate, nougat and peanuts. Light and keeps." },
  f_energybar:  { name: "Energy bar",         word: "energy bars",          icon: "🍫", group: "packaged", tier: "plain", kcal: 230,  kg: 0.06, shelf: 365, diet: "veg",   desc: "Oats, nuts and syrup in a wrapper. A hiker's snack." },
  // ---- military and survival rations: light, very long keeping, the best food to carry ----
  f_mre:        { name: "MRE",                word: "MREs",                 icon: "🍱", group: "military", tier: "survival", kcal: 1250, kg: 0.7, shelf: 1800, diet: "mixed", desc: "Meal, Ready-to-Eat: an Army ration with its own flameless heater. Keeps five years." },
  f_rationbar:  { name: "Ration bar",         word: "ration bars",          icon: "🧱", group: "military", tier: "survival", kcal: 2400, kg: 0.5, shelf: 1800, diet: "veg",   desc: "A lifeboat ration block: a day's calories in half a kilo, dry and dull." },
  f_survivalmeal:{ name: "Survival meal",     word: "survival meals",       icon: "🍱", group: "military", tier: "survival", kcal: 600,  kg: 0.15, shelf: 3600, diet: "mixed", desc: "A freeze-dried pouch meal: add hot water. Keeps ten years and weighs nothing. Found, or made in a Kitchen with a vacuum sealer (cooking.js)." },
  // ---- fresh shop food: only in the first weeks after the outbreak (until), then gone or rotten ----
  f_bread:      { name: "Bread",              word: "loaves of bread",      icon: "🍞", group: "fresh", tier: "plain", kcal: 1800, kg: 0.7, shelf: 5,  shopOnly: true, until: 6,  diet: "veg",    desc: "A loaf of sliced bread. Stale in days, green in a week." },
  f_cheese:     { name: "Cheese",             word: "blocks of cheese",     icon: "🧀", group: "fresh", tier: "plain", kcal: 2000, kg: 0.5, shelf: 30, shopOnly: true, until: 40, diet: "animal", desc: "A block of hard cheese: keeps weeks out of the fridge, months in a cold room." },
  f_frozenmeat: { name: "Frozen meat",        word: "kg of frozen meat",    icon: "🥩", group: "fresh", tier: "raw",   kcal: 2000, kg: 1,   shelf: 3,  shopOnly: true, until: 4,  diet: "meat", raw: true, ingredient: true, desc: "Meat from a shop's freezers, thawing since the power failed. Cook it in days." },
  f_eggs:       { name: "Eggs",               word: "dozen eggs",           icon: "🥚", group: "fresh", tier: "plain", kcal: 860,  kg: 0.7, shelf: 21, until: 25, diet: "animal", ingredient: true, desc: "A dozen eggs: from a shop in the first weeks, from the hens of an animal pen after." },
  f_milk:       { name: "Goat's milk",        word: "litres of milk",       icon: "🥛", group: "fresh", tier: "plain", kcal: 690,  kg: 1.03, shelf: 2, diet: "animal", ingredient: true, desc: "A litre of milk from the pen's goats. Drink it the same day or the next." },
  // ---- produce (shops early, farms; and the plots grow some) ----
  f_apples:     { name: "Apples",             word: "kg of apples",         icon: "🍎", group: "produce", tier: "plain", kcal: 520, kg: 1, shelf: 30, until: 45, diet: "veg", ingredient: true, desc: "From a shop's crates in the first weeks, or abandoned orchards in autumn. Months in a cool cellar." },
  f_potatoes:   { name: "Potatoes",           word: "kg of potatoes",       icon: "🥔", group: "crop",    tier: "plain", kcal: 770, kg: 1, shelf: 35, until: 60, diet: "veg", ingredient: true, desc: "A staple: dug from the plots or found in a farm's store. Keeps months in a root cellar." },
  f_onions:     { name: "Onions",             word: "kg of onions",         icon: "🧅", group: "produce", tier: "plain", kcal: 400, kg: 1, shelf: 30, until: 50, diet: "veg", ingredient: true, desc: "Onions keep well in a dry, cool place." },
  // ---- crops from the plots (farming.js CROPS: each crop is one of these) ----
  f_greenbeans: { name: "Green beans",        word: "kg of green beans",    icon: "🫛", group: "crop", tier: "plain", kcal: 310, kg: 1, shelf: 5,  diet: "veg", ingredient: true, desc: "Picked young: eat them within the week." },
  f_corn:       { name: "Corn",               word: "kg of corn",           icon: "🌽", group: "crop", tier: "plain", kcal: 860, kg: 1, shelf: 10, diet: "veg", ingredient: true, desc: "Ears of corn: sweet for a few days, then dried or cooked down." },
  f_squash:     { name: "Squash",             word: "kg of squash",         icon: "🎃", group: "crop", tier: "plain", kcal: 400, kg: 1, shelf: 60, diet: "veg", ingredient: true, desc: "Winter squash and pumpkins: hard-skinned, they keep for months." },
  f_greens:     { name: "Garden greens",      word: "kg of greens",         icon: "🥬", group: "crop", tier: "plain", kcal: 230, kg: 1, shelf: 4,  diet: "veg", ingredient: true, desc: "Lettuce, spinach and chard. Wilts in days." },
  f_turnips:    { name: "Winter roots",       word: "kg of turnips",        icon: "🥕", group: "crop", tier: "plain", kcal: 300, kg: 1, shelf: 60, diet: "veg", ingredient: true, desc: "Turnips and swedes: months in a root cellar." },
  f_kale:       { name: "Kale",               word: "kg of kale",           icon: "🥬", group: "crop", tier: "plain", kcal: 490, kg: 1, shelf: 7,  diet: "veg", ingredient: true, desc: "Kale and collards, hardy in the cold." },
  // ---- foraged (foraging.js: by season) ----
  f_berries:    { name: "Wild berries",       word: "kg of berries",        icon: "🫐", group: "forage", tier: "plain", kcal: 500,  kg: 1,   shelf: 3,   diet: "veg", ingredient: true, desc: "Blackberries, raspberries, blueberries, rose hips: eat them or dry them fast." },
  f_nuts:       { name: "Wild nuts",          word: "bags of nuts",         icon: "🌰", group: "forage", tier: "plain", kcal: 3000, kg: 0.5, shelf: 120, diet: "veg", desc: "Walnuts, hazelnuts and acorns, shelled: rich and they keep." },
  f_mushrooms:  { name: "Mushrooms",          word: "kg of mushrooms",      icon: "🍄", group: "forage", tier: "plain", kcal: 300,  kg: 1,   shelf: 4,   diet: "veg", ingredient: true, desc: "Chanterelles, morels and ceps from the woods." },
  f_wildgreens: { name: "Wild greens",        word: "kg of wild greens",    icon: "🌿", group: "forage", tier: "plain", kcal: 300,  kg: 1,   shelf: 3,   diet: "veg", ingredient: true, desc: "Nettles, dandelion, fiddleheads, purslane: better boiled." },
  f_roots:      { name: "Wild roots",         word: "kg of roots",          icon: "🥕", group: "forage", tier: "plain", kcal: 700,  kg: 1,   shelf: 14,  diet: "veg", ingredient: true, desc: "Cattail rhizomes, burdock and wild carrot, dug from the banks and fields." },
  // ---- raw meat and fish (hunting.js): cook it; it spoils in days ----
  f_venison:    { name: "Raw venison",        word: "kg of venison",        icon: "🍖", group: "rawmeat", tier: "raw", kcal: 1500, kg: 1, shelf: 3, diet: "meat", raw: true, ingredient: true, desc: "Deer meat off the bone. Spoils in days: cook it, smoke it or dry it." },
  f_boar:       { name: "Raw boar",           word: "kg of boar",           icon: "🍖", group: "rawmeat", tier: "raw", kcal: 2000, kg: 1, shelf: 3, diet: "meat", raw: true, ingredient: true, desc: "Wild hog: fatty, rich meat. Cook it through." },
  f_smallgame:  { name: "Raw small game",     word: "kg of small game",     icon: "🍖", group: "rawmeat", tier: "raw", kcal: 1400, kg: 1, shelf: 2, diet: "meat", raw: true, ingredient: true, desc: "Rabbit and squirrel, skinned and gutted." },
  f_fowl:       { name: "Raw fowl",           word: "kg of fowl",           icon: "🍗", group: "rawmeat", tier: "raw", kcal: 1500, kg: 1, shelf: 2, diet: "meat", raw: true, ingredient: true, desc: "Wild turkey, duck and pheasant." },
  f_fish:       { name: "Raw fish",           word: "kg of fish",           icon: "🐟", group: "rawfish", tier: "raw", kcal: 1400, kg: 1, shelf: 1.5, diet: "meat", raw: true, ingredient: true, desc: "Trout, bass and catfish from the river. Spoils in a day or two." },
  // ---- preserved (the racks, the hunting cabin's smokehouse, the preserving kitchen's jars) ----
  // The meat grinder's (wave 2 cooking: cooking.js COOK_RECIPES ground, sausage; the grain mill makes the flour above).
  f_groundmeat: { name: "Ground meat",        word: "kg of ground meat",    icon: "🥩", group: "rawmeat", tier: "raw", kcal: 2000, kg: 1, shelf: 2, diet: "meat", raw: true, ingredient: true, desc: "Game run through a meat grinder: the tough cuts made good for meals and sausages. Spoils in a day or two." },
  f_sausage:    { name: "Smoked sausage",     word: "kg of smoked sausage", icon: "🌭", group: "preserved", tier: "preserved", kcal: 3000, kg: 1, shelf: 90, diet: "meat", ingredient: true, desc: "Ground meat salted, stuffed and smoked: keeps for months in a cool room." },
  f_jerky:      { name: "Jerky",              word: "bags of jerky",        icon: "🥓", group: "preserved", tier: "preserved", kcal: 2000, kg: 0.5, shelf: 365, diet: "meat", desc: "Meat dried and smoked on the racks or in the hunting cabin. Light, keeps a year." },
  f_smokedfish: { name: "Smoked fish",        word: "packs of smoked fish", icon: "🐟", group: "preserved", tier: "preserved", kcal: 1500, kg: 0.5, shelf: 180, diet: "meat", desc: "Fish split and smoked. Keeps half a year." },
  f_driedfruit: { name: "Dried fruit and veg", word: "bags of dried fruit and veg",  icon: "🍇", group: "preserved", tier: "preserved", kcal: 1500, kg: 0.5, shelf: 365, diet: "veg",  desc: "Berries, apples and squash dried on the racks." },
  f_jarred:     { name: "Jarred food",        word: "portions of jarred food", icon: "🫙", group: "preserved", tier: "preserved", kcal: 2000, kg: 0.6, shelf: 540, diet: "mixed", desc: "Stew, vegetables and preserves put up in jars by the preserving kitchen: two portions a jar; the jars come back when it is eaten at a base." },
  // ---- meals (wave 2 cooking: the Kitchen's and the cook fire's bills, cooking.js COOK_RECIPES; lots carry pz / by) ----
  f_simplemeal: { name: "Simple meal",        word: "simple meals",         icon: "🍲", group: "meal", tier: "simple", kcal: 800, kg: 0.5, shelf: 4, diet: "mixed", moodLift: 0, desc: "Whatever was to hand, cooked through: meat, fish or greens in a pot. More filling than its raw makings (nothing is wasted) and safe to eat. Spoils in a few days." },
  f_stew:       { name: "Stew",               word: "pots of stew",         icon: "🍲", group: "meal", tier: "simple", kcal: 1600, kg: 1.2, shelf: 3, diet: "mixed", moodLift: 1, desc: "A pot of stew for two: meat, roots and plenty of water simmered for hours." },
  f_finemeal:   { name: "Fine meal",          word: "fine meals",           icon: "🍛", group: "meal", tier: "fine",   kcal: 900, kg: 0.5, shelf: 4, diet: "mixed", moodLift: 2, desc: "A proper cooked meal with meat and vegetables. Lifts the mood." },
  f_lavishmeal: { name: "Lavish meal",        word: "lavish meals",         icon: "🍽", group: "meal", tier: "lavish", kcal: 1000, kg: 0.6, shelf: 4, diet: "mixed", moodLift: 4, desc: "A feast on a plate: worth the ingredients for what it does for the mood." },
  f_pemmican:   { name: "Pemmican",           word: "blocks of pemmican",   icon: "🧱", group: "meal", tier: "survival", kcal: 1500, kg: 0.25, shelf: 365, diet: "meat", moodLift: 0, desc: "Dried meat pounded with fat and berries: the old travelling food. Light and keeps a year." },
};
export const FOOD_KEYS = Object.keys(FOODS);
export const isFood = (k) => !!(k && FOODS[k]);
for (const k of FOOD_KEYS) { const f = FOODS[k]; f.key = k; f.stable = f.shelf >= STABLE_DAYS; }

// ---------- value ----------
// SUPPLIES[k].value = kcal / 1000 × VALUE.perKcal × the tier's TIER_VALUE × keeps (0.7 + 0.25 × log10(1 + shelf)):
// a can of beans 0.47 (1.17 a day's food), an MRE 2.4 (1.9 a day), a kilo of venison 0.74 (0.49 a day), jarred food
// 3.0 (1.5 a day): about the old generic food (1 a day) for the shops' mix, raw meat and wilting greens well under
// it, rations and preserved food over it (the old preserved food was 2 a day).
export const VALUE = { perKcal: 0.8, keepBase: 0.7, keepLog: 0.25 };
export const keepsMult = (shelf) => VALUE.keepBase + VALUE.keepLog * Math.log10(1 + Math.max(0, shelf));
export const foodValue = (f) => Math.round((f.kcal / 1000) * VALUE.perKcal * (TIER_VALUE[f.tier] || 1) * keepsMult(f.shelf) * 1000) / 1000;
for (const k of FOOD_KEYS) FOODS[k].value = foodValue(FOODS[k]);
// The supplies entries (data.js merges them into SUPPLIES): trade category "food", weight per item.
export const FOOD_SUPPLIES = Object.fromEntries(FOOD_KEYS.map((k) => [k, { name: FOODS[k].name, value: FOODS[k].value, weight: FOODS[k].kg, cat: "food", food: true, icon: FOODS[k].icon }]));
// The worth of a day's food (DAY_KCAL) where a deal or a plan is priced in days of food: the old generic Food's value
// (2), about a day of the usual stores (canned beans 2.3 a day, potatoes 1.7, ration bars 3.2).
export const DAY_VALUE = 2;
// The kg of a day of food packed for the road (ration bars, MREs, jerky, cans: parties.js FOOD_PACK_KG).
export const DAY_KG = 0.9;

// ---------- units ----------
const EPS = 1e-6;
const num = (v) => (Number.isFinite(v) ? v : 0);
// Days of food (DAY_KCAL) in q of an item, and the item count for a number of days.
export const unitsOf = (k, q) => (FOODS[k] ? (num(q) * FOODS[k].kcal) / DAY_KCAL : 0);
export const qtyOf = (k, units) => (FOODS[k] ? (num(units) * DAY_KCAL) / FOODS[k].kcal : 0);
// Days of food in a stock (every food item, positive amounts): what every planner reads in place of stock.food.
export function foodIn(stock) {
  if (!stock) return 0;
  let u = 0;
  for (const k in stock) { const f = FOODS[k]; if (f) { const q = stock[k]; if (q > 0) u += (q * f.kcal) / DAY_KCAL; } }
  return u;
}
export const foodKcal = (stock) => foodIn(stock) * DAY_KCAL;
// Food that keeps (stable, shelf ≥ STABLE_DAYS) and food that needs a cold room, in days of food.
export function foodSplit(stock) {
  let stable = 0, fresh = 0;
  for (const k in stock || {}) { const f = FOODS[k]; if (f && stock[k] > 0) { const u = (stock[k] * f.kcal) / DAY_KCAL; if (f.stable) stable += u; else fresh += u; } }
  return { stable, fresh, all: stable + fresh };
}
// Days of food in several stocks (a team: its packed supplies and its cargo).
export const foodInAll = (stocks) => stocks.reduce((a, s) => a + foodIn(s), 0);
// The food in a stock as [{ key, q, units }], most days of food first.
export function foodList(stock) {
  const out = [];
  for (const k in stock || {}) if (FOODS[k] && stock[k] > EPS) out.push({ key: k, q: stock[k], units: unitsOf(k, stock[k]) });
  return out.sort((a, b) => b.units - a.units || (a.key < b.key ? -1 : 1));
}
// Weight of the food in a stock (kg).
export const foodKg = (stock) => Object.keys(stock || {}).reduce((a, k) => a + (FOODS[k] && stock[k] > 0 ? stock[k] * FOODS[k].kg : 0), 0);
// "12 cans of beans" (whole items; under one: "half a kg of venison" stays "0.5 kg of venison").
export function foodWord(k, q) {
  const f = FOODS[k];
  if (!f) return `${q} ${k}`;
  const n = q >= 10 || Math.abs(q - Math.round(q)) < 0.05 ? Math.round(q) : Math.round(q * 10) / 10;
  return `${n} ${n === 1 && !/^kg|^litres|^dozen/.test(f.word) ? singular(f) : f.word}`;
}
const singular = (f) => (f.word.endsWith("s") && !/ of /.test(f.word) ? f.word.slice(0, -1) : f.word.replace(/^(\w+?)s of /, "$1 of ").replace(/^dozen/, "dozen"));
// A list of food: "3 MREs, 12 cans of beans" (biggest first; `max` items, then "and more").
export function foodText(items, max = 4) {
  const list = Object.entries(items || {}).filter(([k, q]) => FOODS[k] && q >= 0.05).sort((a, b) => unitsOf(b[0], b[1]) - unitsOf(a[0], a[1]));
  if (!list.length) return "no food";
  const words = list.slice(0, max).map(([k, q]) => foodWord(k, q));
  return list.length > max ? `${words.join(", ")} and ${list.length - max} more` : words.join(", ");
}
// A days-of-food figure for the screens: "12.4 days" style numbers are the caller's; this is the rounded value.
export const r1 = (v) => Math.round(num(v) * 10) / 10;

// ---------- holders and lots ----------
// A holder is a base (stock: base.stock), a team (p.supplies), a team's cargo (cargo.supplies), an AI group (f.stock:
// no lots, ageCoarse) or a bare stock object (no lots).
export const stockOf = (h) => (!h ? null : h.stock && typeof h.stock === "object" ? h.stock : h.supplies && typeof h.supplies === "object" ? h.supplies : h);
const keepsLots = (h) => !!h && stockOf(h) !== h && !Array.isArray(h.bases);
// Days since the outbreak (a normal game starts NORMAL_START days after it; hardcore on the day itself).
export const NORMAL_START = 60;
export const outbreakDays = (state) => (state ? Math.floor((state.hour || 0) / 24) + (state.mode === "hardcore" ? 0 : NORMAL_START) : NORMAL_START);
// Shelf left on a fresh lot of `k` with no history: the item's shelf, less (shopOnly: bread, cheese, frozen meat) the days since
// the outbreak it has already sat (bread found on day 3 has 2 days left).
export function newLeft(k, state = null) {
  const f = FOODS[k];
  if (!f) return 1;
  if (f.shopOnly && f.until != null && state) return Math.max(0.5, f.shelf - outbreakDays(state)); // only shops have it: as old as the outbreak
  return f.shelf;
}
export function lotsOf(h) {
  if (!keepsLots(h)) return null;
  return h.foodLots || (h.foodLots = {});
}
const lotSum = (arr) => arr.reduce((a, l) => a + l.q, 0);
const LOT_CAP = 6;
// Adds q to a key's lots: into a lot of the same kind (eggs or not, the same cook) within a day of the same shelf left,
// else a new lot; more than LOT_CAP lots merge the two closest. x: { pz, by } of a cooked lot (cooking.js: the chance
// a day of food of it gives food poisoning, and the cook's id), kept on the lot (pz averaged by quantity on a merge).
const sameBy = (l, by) => (l.by ?? null) === (by ?? null);
function mixPz(a, bq, bpz) { const p = ((a.pz || 0) * a.q + (bpz || 0) * bq) / Math.max(EPS, a.q + bq); if (p > 0) a.pz = p; else delete a.pz; }
function pushLot(arr, q, left, egg, x = null) {
  if (!(q > EPS)) return;
  const e = !!egg;
  const pz = x && x.pz > 0 ? x.pz : 0, by = x && x.by != null ? x.by : null;
  const near = arr.find((l) => !!l.egg === e && Math.abs(l.left - left) < 1 && sameBy(l, by));
  if (near) { near.left = (near.left * near.q + left * q) / (near.q + q); mixPz(near, q, pz); near.q += q; }
  else { const l = e ? { q, left, egg: true } : { q, left }; if (pz > 0) l.pz = pz; if (by != null) l.by = by; arr.push(l); }
  if (arr.length > LOT_CAP) {
    arr.sort((a, b) => a.left - b.left);
    let bi = 0, bd = Infinity;
    for (let i = 0; i + 1 < arr.length; i++) { if (!!arr[i].egg !== !!arr[i + 1].egg) continue; const d = arr[i + 1].left - arr[i].left; if (d < bd) { bd = d; bi = i; } }
    if (bd < Infinity) { const a = arr[bi], b = arr[bi + 1]; a.left = (a.left * a.q + b.left * b.q) / (a.q + b.q); mixPz(a, b.q, b.pz); if (!sameBy(a, b.by)) delete a.by; a.q += b.q; arr.splice(bi + 1, 1); }
  }
}
// Takes q from a key's lots, the soonest to spoil first. Returns [{ q, left, egg }] taken.
function trimLots(arr, q, { eggs = true, clean = true } = {}) {
  arr.sort((a, b) => a.left - b.left);
  const out = [];
  let need = q;
  for (const l of arr) {
    if (need <= EPS) break;
    if ((l.egg && !eggs) || (!l.egg && !clean)) continue;
    const t = Math.min(need, l.q);
    l.q -= t; need -= t;
    const o = { q: t, left: l.left, egg: !!l.egg };
    if (l.pz > 0) o.pz = l.pz;
    if (l.by != null) o.by = l.by;
    out.push(o);
  }
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i].q <= EPS) arr.splice(i, 1);
  return out;
}
// The lots follow the stock: what the stock has and the lots do not cover gets a fresh lot (newLeft); lots over the
// stock lose their oldest. Stray generic food (an old "food"/"preserved" key from a module that still writes it)
// is typed into the default store mix first (state.foodStray counts it: tools/foodtypestest.js wants none).
export function syncLots(h, state = null) {
  const st = stockOf(h);
  if (!st) return null;
  if ("food" in st || "preserved" in st) typeStray(st, state);
  const L = lotsOf(h);
  if (!L) return null;
  for (const k of Object.keys(L)) if (!FOODS[k] || !(st[k] > EPS)) delete L[k];
  for (const k in st) {
    if (!FOODS[k]) continue;
    const q = st[k];
    if (!(q > EPS)) { delete L[k]; continue; }
    const arr = L[k] || (L[k] = []);
    const s = lotSum(arr);
    if (s > q + EPS) trimLots(arr, s - q);
    else if (s < q - EPS) pushLot(arr, q - s, newLeft(k, state), false);
  }
  return L;
}
// Generic food keys turned into typed food (a safety net: nothing should write them any more).
export function typeStray(st, state = null) {
  for (const key of ["food", "preserved"]) {
    if (!(key in st)) continue;
    const u = num(st[key]);
    delete st[key];
    if (state) state.foodStray = (state.foodStray || 0) + Math.abs(u);
    if (u > EPS) addItems(st, typedFood(state, key === "preserved" ? "keeps" : "stores", u));
    else if (u < -EPS) takeFood(st, -u);
  }
}
const addItems = (st, items) => { for (const [k, q] of Object.entries(items)) if (q > 0) st[k] = (st[k] || 0) + q; };

// Adds q of an item to a holder (a base, a team, a cargo, a group or a bare stock): left (days of shelf; default the
// item's shelf, or what an early shop item has left), egg (it carries the worm's eggs: worm.js), pz / by (a cooked
// lot: cooking.js, the food-poisoning chance a day of food of it and the cook's id; the eating contract there).
export function addFood(h, k, q, { left = null, egg = false, state = null, pz = 0, by = null } = {}) {
  const st = stockOf(h);
  if (!st || !FOODS[k] || !(q > EPS)) return 0;
  const L = lotsOf(h);
  if (L) syncLots(h, state);
  st[k] = (st[k] || 0) + q;
  if (L) pushLot(L[k] || (L[k] = []), q, left == null ? newLeft(k, state) : Math.max(0.01, left), egg, pz > 0 || by != null ? { pz, by } : null);
  return q;
}
// Adds a set of items { key: q } (same options for all).
export function addFoods(h, items, opts = {}) {
  let n = 0;
  for (const [k, q] of Object.entries(items || {})) n += addFood(h, k, q, opts);
  return n;
}
// Days of food a holder could eat now, by filter.
export function foodUnits(h, only = null) {
  const st = stockOf(h);
  if (!st) return 0;
  if (!only) return foodIn(st);
  let u = 0;
  for (const k in st) if (FOODS[k] && st[k] > 0 && only(k, FOODS[k])) u += unitsOf(k, st[k]);
  return u;
}
// Days of food with the worm's eggs in a holder's lots, by kind: { meat, crop, forage, all }.
export function eggFood(h) {
  const out = { meat: 0, crop: 0, forage: 0, all: 0 };
  const L = h && h.foodLots;
  if (!L) return out;
  for (const k in L) {
    const f = FOODS[k];
    if (!f) continue;
    for (const l of L[k]) if (l.egg && l.q > 0) { const u = unitsOf(k, l.q); const kind = eggKind(f); out[kind] += u; out.all += u; }
  }
  return out;
}
export const eggKind = (f) => (f.group === "rawmeat" || f.group === "rawfish" || f.diet === "meat" ? "meat" : f.group === "forage" ? "forage" : "crop");

// Takes `units` days of food from one or several holders, the soonest to spoil first (across all of them).
// opts: only (k, f) → bool (which items), eggs (take lots with the worm's eggs: false = leave them), clean (take the
// clean lots), order "spoil" (default) | "cheap" (cheapest per kcal first: deals paid in days of food). Returns
// { units, kcal, items: { key: q }, eggs: { meat, crop, forage, all } (days of it eaten with eggs), raw (days of raw
// meat or fish taken) }.
export function takeFood(holders, units, opts = {}) {
  const hs = Array.isArray(holders) ? holders : [holders];
  const { only = null, eggs = true, clean = true, order = "spoil", state = null } = opts;
  const res = { units: 0, kcal: 0, items: {}, eggs: { meat: 0, crop: 0, forage: 0, all: 0 }, raw: 0, lots: [] };
  if (!(units > EPS)) return res;
  const cands = [];
  hs.forEach((h, hi) => {
    const st = stockOf(h);
    if (!st) return;
    const L = lotsOf(h) ? syncLots(h, state) : null;
    for (const k in st) {
      const f = FOODS[k];
      if (!f || !(st[k] > EPS) || (only && !only(k, f))) continue;
      if (L && L[k]) { for (const l of L[k]) if ((l.egg ? eggs : clean) && l.q > EPS) cands.push({ h, hi, st, k, f, lot: l, left: l.left }); }
      else if (clean) cands.push({ h, hi, st, k, f, lot: null, left: f.shelf });
    }
  });
  if (order === "cheap") cands.sort((a, b) => a.f.value / a.f.kcal - b.f.value / b.f.kcal || a.left - b.left || a.hi - b.hi);
  else cands.sort((a, b) => a.left - b.left || a.hi - b.hi || (a.k < b.k ? -1 : 1));
  let need = units * DAY_KCAL;
  for (const c of cands) {
    if (need <= EPS) break;
    const have = c.lot ? Math.min(c.lot.q, c.st[c.k]) : c.st[c.k];
    const q = Math.min(have, need / c.f.kcal);
    if (!(q > EPS)) continue;
    c.st[c.k] -= q;
    if (c.st[c.k] < EPS) c.st[c.k] = 0;
    if (c.lot) c.lot.q -= q;
    need -= q * c.f.kcal;
    res.items[c.k] = (res.items[c.k] || 0) + q;
    const lot = { k: c.k, q, left: c.left, egg: !!(c.lot && c.lot.egg) };
    if (c.lot && c.lot.pz > 0) lot.pz = c.lot.pz; // cooking.js: a cooked lot's food-poisoning chance and its cook (the eating contract)
    if (c.lot && c.lot.by != null) lot.by = c.lot.by;
    res.lots.push(lot);
    const u = (q * c.f.kcal) / DAY_KCAL;
    res.units += u;
    if (c.lot && c.lot.egg) { res.eggs[eggKind(c.f)] += u; res.eggs.all += u; }
    if (c.f.raw) res.raw += u;
  }
  for (const h of hs) { const L = h && h.foodLots; if (L) for (const k of Object.keys(L)) { const a = L[k].filter((l) => l.q > EPS); if (a.length) L[k] = a; else delete L[k]; } }
  res.kcal = res.units * DAY_KCAL;
  return res;
}
// Takes q of one item (its oldest lots first). Returns { q, lots: [{ q, left, egg }] }.
export function takeItem(h, k, q, { state = null, eggs = true } = {}) {
  const st = stockOf(h);
  if (!st || !FOODS[k]) return { q: 0, lots: [] };
  const n = Math.max(0, Math.min(q, st[k] || 0));
  if (!(n > EPS)) return { q: 0, lots: [] };
  const L = lotsOf(h) ? syncLots(h, state) : null;
  let lots;
  if (L && L[k]) {
    lots = trimLots(L[k], n, { eggs });
    if (!L[k].length) delete L[k];
  } else lots = [{ q: n, left: newLeft(k, state), egg: false }];
  const got = lots.reduce((a, l) => a + l.q, 0);
  st[k] -= got;
  if (st[k] < EPS) st[k] = 0;
  return { q: got, lots };
}
// Moves food between holders with its lots (shelf left and eggs): `items` { key: q } or null (all of it). Returns
// the items moved.
export function moveFood(from, to, items = null, { state = null } = {}) {
  const sf = stockOf(from);
  if (!sf || !stockOf(to)) return {};
  const want = items || Object.fromEntries(Object.keys(sf).filter((k) => FOODS[k] && sf[k] > EPS).map((k) => [k, sf[k]]));
  const moved = {};
  for (const [k, q] of Object.entries(want)) {
    const t = takeItem(from, k, q, { state });
    if (!(t.q > EPS)) continue;
    for (const l of t.lots) addFood(to, k, l.q, { left: l.left, egg: l.egg, state, pz: l.pz || 0, by: l.by ?? null });
    moved[k] = (moved[k] || 0) + t.q;
  }
  return moved;
}
// Moves `units` days of food between holders, the soonest to spoil first (a supply line's food for an outpost),
// with its lots; scale: the share that arrives (a supply line loses some on the way). Returns takeFood's result.
export function moveFoodUnits(from, to, units, { scale = 1, state = null, only = null, eggs = false } = {}) {
  const got = takeFood(from, units, { eggs, state, only });
  for (const l of got.lots) addFood(to, l.k, l.q * scale, { left: l.left, egg: l.egg, state, pz: l.pz || 0, by: l.by ?? null });
  return got;
}

// ---------- spoiling ----------
// Ages a holder's lots by `days` × the factor of each (factor(k, f, lot) → storage factor): lots at 0 are gone.
// Returns the items spoiled { key: q }.
export function ageLots(h, days, factor, state = null) {
  const st = stockOf(h);
  const L = lotsOf(h) ? syncLots(h, state) : null;
  const out = {};
  if (!L) return out;
  for (const k of Object.keys(L)) {
    const f = FOODS[k];
    const arr = L[k];
    for (const l of arr) {
      l.left -= Math.max(0, factor(k, f, l)) * days;
      if (l.left <= 0) { out[k] = (out[k] || 0) + l.q; st[k] = Math.max(0, (st[k] || 0) - l.q); l.q = 0; }
    }
    const a = arr.filter((l) => l.q > EPS);
    if (a.length) L[k] = a; else delete L[k];
    if (!(st[k] > EPS) && k in st) st[k] = 0;
  }
  return out;
}
// An AI group's coarse aging (no lots): each item loses factor / shelf of what it holds a day (bread in days, cans in
// years). Returns days of food lost.
export const COARSE = { factor: 0.8, frozen: 0.05 };
// frozen: days of food in a running walk-in freezer (groupworks.js groupFreezerOn: MACH.room): the soonest to spoil
// goes in, aging at COARSE.frozen of the factor.
export function ageCoarse(stock, days = 1, factor = COARSE.factor, { frozen = 0 } = {}) {
  let lost = 0, room = Math.max(0, frozen);
  const keys = Object.keys(stock || {}).filter((k) => FOODS[k] && stock[k] > 0).sort((a, b) => FOODS[a].shelf - FOODS[b].shelf);
  for (const k of keys) {
    const f = FOODS[k];
    const u = unitsOf(k, stock[k]), inside = f.stable ? 0 : Math.min(u, room);
    room -= inside;
    const fac = u > 0 ? factor * ((u - inside) + inside * COARSE.frozen) / u : factor;
    const share = Math.min(1, (fac * days) / Math.max(0.5, f.shelf));
    const q = stock[k] * share;
    stock[k] -= q;
    lost += unitsOf(k, q);
    if (stock[k] < 0.01) stock[k] = 0;
  }
  return lost;
}
// The soonest-to-spoil lot of each item: [{ key, q, left, egg }] for the screens (and the days the stock keeps).
export function lotRows(h, state = null) {
  const L = lotsOf(h) ? syncLots(h, state) : null;
  const st = stockOf(h);
  const rows = [];
  for (const k in st || {}) {
    if (!FOODS[k] || !(st[k] > EPS)) continue;
    const ls = L && L[k] ? L[k] : [{ q: st[k], left: FOODS[k].shelf }];
    rows.push({ key: k, q: st[k], units: unitsOf(k, st[k]), next: Math.min(...ls.map((l) => l.left)), nextQ: ls.reduce((a, l) => (l.left === Math.min(...ls.map((x) => x.left)) ? a + l.q : a), 0), egg: ls.reduce((a, l) => a + (l.egg ? l.q : 0), 0), lots: ls.map((l) => ({ ...l })) });
  }
  return rows.sort((a, b) => b.units - a.units);
}

// ---------- typed food from abstract amounts ----------
// The dice for which items a find, a harvest or a gift is: a stream of its own (the game's own dice are untouched).
export const foodRng = (state) => (state ? state.foodRng || (state.foodRng = new Rng((((state.seed || 1) * 2246822519) ^ 0xf00d) >>> 0)) : FALLBACK);
const FALLBACK = new Rng(0xf00d);
// Mixes: the share of the calories each item gets in a find or a stock of that kind.
export const MIXES = {
  // supermarkets, grocery stores, malls
  shop:     { f_beans: 10, f_soup: 6, f_cannedveg: 6, f_cannedfruit: 5, f_cannedmeat: 10, f_rice: 8, f_pasta: 7, f_oats: 4, f_flour: 4, f_cereal: 4, f_crackers: 3, f_sugar: 2, f_peanutbutter: 4, f_honey: 1, f_chips: 4, f_candybar: 3, f_energybar: 2, f_bread: 5, f_cheese: 4, f_frozenmeat: 3, f_eggs: 2, f_apples: 3, f_potatoes: 3, f_onions: 2 },
  // houses, apartments, towns, motels, schools, churches
  house:    { f_beans: 12, f_soup: 10, f_cannedveg: 8, f_cannedfruit: 6, f_cannedmeat: 9, f_rice: 7, f_pasta: 8, f_oats: 4, f_flour: 3, f_cereal: 6, f_crackers: 4, f_sugar: 2, f_peanutbutter: 5, f_honey: 1, f_chips: 4, f_candybar: 3, f_energybar: 2, f_bread: 3, f_cheese: 2, f_eggs: 1, f_potatoes: 2, f_onions: 1 },
  diner:    { f_beans: 6, f_soup: 8, f_cannedveg: 5, f_cannedmeat: 6, f_rice: 6, f_pasta: 6, f_flour: 8, f_sugar: 4, f_oats: 3, f_crackers: 4, f_bread: 8, f_cheese: 6, f_frozenmeat: 8, f_eggs: 6, f_potatoes: 8, f_onions: 5 },
  // gas stations and truck stops
  roadside: { f_chips: 18, f_candybar: 16, f_energybar: 12, f_crackers: 10, f_peanutbutter: 8, f_beans: 8, f_soup: 6, f_cannedmeat: 8, f_cereal: 4, f_bread: 4, f_cheese: 2, f_jerky: 4 },
  pharmacy: { f_energybar: 30, f_candybar: 30, f_crackers: 20, f_chips: 10, f_cannedfruit: 10 },
  // farms, barns, ranches, feed stores
  farm:     { f_potatoes: 12, f_onions: 6, f_apples: 8, f_squash: 4, f_eggs: 4, f_grain: 16, f_drybeans: 10, f_flour: 8, f_oats: 6, f_honey: 4, f_jarred: 12, f_driedfruit: 4, f_beans: 4, f_cannedveg: 2 },
  // cabins, hunting lodges, ranger stations, campgrounds
  wild:     { f_beans: 10, f_cannedmeat: 10, f_soup: 4, f_survivalmeal: 12, f_jerky: 14, f_energybar: 10, f_oats: 10, f_peanutbutter: 10, f_driedfruit: 6, f_honey: 4, f_crackers: 6, f_rice: 4 },
  // the Army, crashed supply planes, supply drops
  military: { f_mre: 60, f_rationbar: 28, f_survivalmeal: 8, f_energybar: 4 },
  prison:   { f_beans: 18, f_soup: 10, f_cannedveg: 10, f_cannedmeat: 8, f_rice: 20, f_oats: 18, f_pasta: 8, f_crackers: 8 },
  warehouse:{ f_beans: 12, f_cannedveg: 8, f_cannedfruit: 6, f_cannedmeat: 10, f_soup: 6, f_rice: 14, f_pasta: 10, f_flour: 8, f_sugar: 6, f_oats: 6, f_cereal: 6, f_peanutbutter: 4, f_crackers: 4 },
  // "preserved" draws (a loot table's preserved, a group's preserved stores): food that keeps
  keeps:    { f_cannedmeat: 14, f_beans: 10, f_peanutbutter: 8, f_rice: 10, f_honey: 6, f_jarred: 20, f_jerky: 12, f_driedfruit: 8, f_survivalmeal: 6, f_mre: 6 },
  // a generic store of food (stray old food, a gift of "food", an AI group's stores, a new game's cellar)
  stores:   { f_beans: 14, f_soup: 6, f_cannedveg: 8, f_cannedfruit: 5, f_cannedmeat: 10, f_rice: 10, f_pasta: 8, f_oats: 6, f_flour: 6, f_cereal: 3, f_crackers: 3, f_peanutbutter: 5, f_honey: 2, f_jarred: 6, f_potatoes: 4, f_onions: 2, f_apples: 2 },
  // a farming commune's stores (crops, grain and jars)
  commune:  { f_potatoes: 14, f_squash: 6, f_turnips: 6, f_onions: 4, f_apples: 6, f_grain: 18, f_drybeans: 12, f_flour: 6, f_jarred: 16, f_driedfruit: 4, f_eggs: 4, f_honey: 4 },
  // raiders: what they took off others
  raider:   { f_beans: 14, f_cannedmeat: 14, f_soup: 6, f_rice: 6, f_pasta: 6, f_chips: 6, f_candybar: 4, f_jerky: 14, f_venison: 6, f_mre: 6, f_peanutbutter: 6, f_jarred: 6, f_crackers: 6 },
  // an AI group's own fields, hunters and pens (factions.js: what its land brings in a day)
  fields:   { f_potatoes: 22, f_grain: 22, f_drybeans: 10, f_squash: 8, f_turnips: 5, f_greens: 4, f_eggs: 6, f_milk: 3, f_venison: 10, f_smallgame: 4, f_fish: 6 },
  // the Army's remnants
  army:     { f_mre: 40, f_rationbar: 16, f_beans: 10, f_cannedmeat: 10, f_rice: 12, f_oats: 6, f_crackers: 6 },
  // a hunting camp's or a trapper's food
  game:     { f_venison: 40, f_smallgame: 15, f_fowl: 10, f_fish: 10, f_jerky: 25 },
  // travellers on the road: light food that keeps
  travel:   { f_energybar: 14, f_candybar: 8, f_crackers: 10, f_peanutbutter: 12, f_jerky: 14, f_beans: 10, f_cannedmeat: 10, f_mre: 8, f_driedfruit: 6, f_oats: 8 },
};
// The mix a site type's food comes in (and its "preserved" draws).
export const SITE_MIX = {
  supermarket: "shop", grocery: "shop", mall: "shop", diner: "diner", gas: "roadside", truckstop: "roadside", pharmacy: "pharmacy",
  town: "house", apartments: "house", motel: "house", school: "house", church: "house", city: "house", suburb: "house",
  farm: "farm", barn: "farm", ranch: "farm", feedstore: "farm",
  cabin: "wild", lodge: "wild", ranger: "wild", campground: "wild",
  convoy: "military", crash_cargo: "military", airdrop: "military", base: "military", armory: "military", military: "military",
  prison: "prison", warehouse: "warehouse",
};
export const siteMix = (type, preserved = false) => (preserved ? (SITE_MIX[type] === "military" ? "military" : "keeps") : SITE_MIX[type] || "house");
// An item can still be found (early-only shop items: until the days after the outbreak).
export const findable = (k, state) => FOODS[k] && (FOODS[k].until == null || outbreakDays(state) <= FOODS[k].until);
// `units` days of food as items of a mix (or a { key: weight } table): a few kinds (more for more food), the calories
// split by the mix's weights among them, each count rounded by the dice so the average holds (an MRE where the share
// was 0.6 of one: 60% of the time). Early-only shop items are left out once they are gone (their share goes to the
// rest). opts.whole: false keeps fractions (no dice). Returns { key: q }.
/** @returns {{ [key: string]: number }} */
export function typedFood(state, mix, units, { whole: whole0 = true, kinds = null, rng = null } = {}) {
  let whole = whole0;
  const table = typeof mix === "string" ? MIXES[mix] || MIXES.stores : mix || MIXES.stores;
  const out = {};
  if (!(units > EPS)) return out;
  const keys = Object.keys(table).filter((k) => table[k] > 0 && FOODS[k] && (!state || findable(k, state)));
  if (!keys.length) return out;
  // rng false: no dice at all (the kinds with the most weight, fractions kept): a stock filled where no game state is
  // at hand.
  const R = rng === false || (!state && !rng) ? null : rng || foodRng(state); // no game state: no dice either
  if (!R) whole = false;
  const n = Math.min(keys.length, kinds || (units < 2 ? 1 : units < 6 ? 2 : units < 20 ? 3 : units < 60 ? 5 : keys.length));
  let picked;
  if (n >= keys.length) picked = keys;
  else if (!R) picked = [...keys].sort((a, b) => table[b] - table[a] || (a < b ? -1 : 1)).slice(0, n);
  else {
    const pool = [...keys];
    picked = [];
    for (let i = 0; i < n; i++) { const k = R.weighted(pool, (x) => table[x]); picked.push(k); pool.splice(pool.indexOf(k), 1); }
  }
  const w = picked.reduce((a, k) => a + table[k], 0);
  for (const k of picked) {
    const x = qtyOf(k, (units * table[k]) / w);
    const q = !whole ? x : Math.floor(x) + (R.next() < x - Math.floor(x) ? 1 : 0);
    if (q > 0) out[k] = (out[k] || 0) + q;
  }
  return out;
}
// Typed food added to a holder (lots by the item's shelf): `units` days of the mix. Returns the items.
export function addFoodUnits(state, h, mix, units, opts = {}) {
  const items = typedFood(state, mix, units, opts);
  for (const [k, q] of Object.entries(items)) addFood(h, k, q, { state, left: opts.left ?? null, egg: !!opts.egg });
  return items;
}

// ---------- the shops run down (user pick 2026-10-10) ----------
// Food at town and city shops (and houses) runs down: each site tile keeps t.foodStock (1 full; 0.5 at the start of a
// hardcore game: the panic buying), lowered as food is taken there (anyone: your teams, the AI groups' scavengers,
// SHOP_FOOD days of food empties a full one), and every site's food falls with time since the outbreak as well
// (other survivors, rats, burst packets: half every SHOP.halfLife days after a normal game's start, never below
// SHOP.floor). Food found there × shopFood(state, t). Later scavenging must go further out.
export const SHOP_FOOD = { supermarket: 300, grocery: 150, mall: 220, diner: 60, gas: 40, truckstop: 60, pharmacy: 20, warehouse: 200, feedstore: 80, town: 160, apartments: 120, motel: 50, school: 60, church: 40, city: 100 };
export const SHOP = { halfLife: 300, floor: 0.2, hardcoreStart: 0.5 };
export const isShop = (type) => !!SHOP_FOOD[type];
export function shopTime(state) {
  const d = outbreakDays(state) - NORMAL_START;
  return d <= 0 ? 1 : Math.max(SHOP.floor, Math.pow(0.5, d / SHOP.halfLife));
}
export const shopStock = (state, t) => (t && t.foodStock != null ? t.foodStock : state && state.mode === "hardcore" ? SHOP.hardcoreStart : 1);
// The share of a site's usual food still there (1 for a site that is not a shop).
export function shopFood(state, t) {
  const type = t && t.loc && t.loc.type;
  if (!isShop(type)) return 1;
  return Math.max(0, shopStock(state, t)) * shopTime(state);
}
// `units` days of food taken from a site: its shop stock falls.
export function drawShop(state, t, units) {
  const type = t && t.loc && t.loc.type;
  if (!isShop(type) || !(units > 0)) return;
  t.foodStock = Math.max(0, shopStock(state, t) - units / SHOP_FOOD[type]);
}
// A food find at a site: `units` days of food (the loot roll), × what the shop has left, typed by the site's mix,
// added to `stock` (a team's finds, a bare stock). Returns the items (and lowers the shop).
export function addFoodFind(state, stock, siteType, units, { tile = null, preserved = false } = {}) {
  const t = tile != null && state && state.tiles ? state.tiles[tile] : null;
  const u = units * (t ? shopFood(state, t) : 1);
  const items = typedFood(state, siteMix(siteType, preserved), u);
  for (const [k, q] of Object.entries(items)) stock[k] = (stock[k] || 0) + q;
  if (t) drawShop(state, t, Object.entries(items).reduce((a, [k, q]) => a + unitsOf(k, q), 0));
  return items;
}

// ---------- packing a team ----------
// Food a team packs for `days` of eating (`units` days of food) from a base: by default the food that keeps longest
// and weighs least per kcal (ration bars, MREs, jerky, peanut butter before cans), never what would spoil before the
// trip is over unless nothing else is left; `prefer` (an item key) goes first. Returns { key: q } (not moved yet).
export function packPick(state, h, units, { days = 3, prefer = null, only = null } = {}) {
  const st = stockOf(h);
  const L = lotsOf(h) ? syncLots(h, state) : null;
  const rows = [];
  for (const k in st || {}) {
    const f = FOODS[k];
    if (!f || !(st[k] > EPS) || (only && !only(k, f))) continue;
    const lots = L && L[k] ? L[k].filter((l) => !l.egg) : [{ q: st[k], left: f.shelf }];
    for (const l of lots) rows.push({ k, f, q: Math.min(l.q, st[k]), left: l.left, keeps: l.left >= days + 1, kgk: f.kg / f.kcal });
  }
  rows.sort((a, b) => (b.k === prefer) - (a.k === prefer) || b.keeps - a.keeps || (a.keeps ? a.kgk - b.kgk : b.left - a.left) || a.left - b.left);
  const out = {};
  let need = units * DAY_KCAL;
  for (const r of rows) {
    if (need <= EPS) break;
    const q = Math.min(r.q, need / r.f.kcal);
    out[r.k] = (out[r.k] || 0) + q;
    need -= q * r.f.kcal;
  }
  // Whole items where the stock allows (a team packs cans, not 0.37 of one).
  for (const k of Object.keys(out)) {
    const up = Math.min(Math.ceil(out[k] - 1e-9), Math.floor(st[k] + 1e-9));
    out[k] = up >= out[k] ? up : out[k];
    if (!(out[k] > EPS)) delete out[k];
  }
  return out;
}

// ---------- costs and gifts in days of food ----------
// A card's "N days of food" (a feast, a stray dog's scraps, a gift, a payment): what a holder has, paying it (the
// soonest to spoil first, never the food with the worm's eggs) and receiving it (typed by a mix: a group's gift is
// its own kind of food). Returns the days of food moved.
export const hasFood = (h) => foodIn(stockOf(h));
export function payFood(h, units, state = null) {
  return takeFood(h, Math.max(0, units), { eggs: false, state }).units;
}
export function giveFood(state, h, units, mix = "stores", opts = {}) {
  if (!(units > EPS)) return 0;
  const items = addFoodUnits(state, h, mix, units, opts);
  return Object.entries(items).reduce((a, [k, q]) => a + unitsOf(k, q), 0);
}
// Goods { key: q } where "food" means days of food (a deal's terms, a plan's request): paid out of a holder (food by
// the soonest to spoil, the rest by key) or received into one (food typed by `mix`). Returns the goods with the food
// as the items that moved.
export function payGoods(h, goods, state = null) {
  const st = stockOf(h);
  const out = {};
  for (const [k, q] of Object.entries(goods || {})) {
    if (!(q > 0)) continue;
    if (k === "food" || k === "preserved") { const got = takeFood(h, q, { eggs: false, state, only: k === "preserved" ? (x, f) => f.stable : null }); for (const [kk, qq] of Object.entries(got.items)) out[kk] = (out[kk] || 0) + qq; continue; }
    if (FOODS[k]) { const t = takeItem(h, k, q, { state }); out[k] = (out[k] || 0) + t.q; continue; }
    st[k] = (st[k] || 0) - q;
    out[k] = (out[k] || 0) + q;
  }
  return out;
}
export function gainGoods(state, h, goods, mix = "stores") {
  const st = stockOf(h);
  for (const [k, q] of Object.entries(goods || {})) {
    if (!(q > 0)) continue;
    if (k === "food") giveFood(state, h, q, mix);
    else if (k === "preserved") giveFood(state, h, q, "keeps");
    else if (FOODS[k]) addFood(h, k, q, { state });
    else st[k] = (st[k] || 0) + q;
  }
}
// Goods with "food"/"preserved" (days) typed into items (a deal's goods before they move, a find before it is added).
export function typeGoods(state, goods, mix = "stores") {
  const out = {};
  for (const [k, q] of Object.entries(goods || {})) {
    if (k === "food" || k === "preserved") { for (const [kk, qq] of Object.entries(typedFood(state, k === "preserved" ? "keeps" : mix, q))) out[kk] = (out[kk] || 0) + qq; }
    else out[k] = (out[k] || 0) + q;
  }
  return out;
}
// Days of preserved food (jerky, smoked fish, dried fruit and veg, jarred food: what the racks, the smokehouse and the
// preserving kitchen make) in a stock: a station's "until N preserved" order.
export function preservedIn(stock) {
  let u = 0;
  for (const k in stock || {}) { const f = FOODS[k]; if (f && f.group === "preserved" && stock[k] > 0) u += (stock[k] * f.kcal) / DAY_KCAL; }
  return u;
}
// Keeps `keep` (0–1) of every food item in a stock (a horde through the stores, a raid's share, a fire): the rest is
// gone, the soonest to spoil first among the lots. Returns the days of food lost.
export function scaleFood(h, keep) {
  const st = stockOf(h);
  let lost = 0;
  for (const k in st || {}) {
    if (!FOODS[k] || !(st[k] > 0)) continue;
    const q = st[k] * (1 - Math.max(0, Math.min(1, keep)));
    st[k] -= q;
    lost += unitsOf(k, q);
  }
  return lost;
}
// The food items of a stock ({ key: q }), a share of them (a raid's take, a gift).
export function foodShare(stock, share = 1) {
  const out = {};
  for (const k in stock || {}) if (FOODS[k] && stock[k] > 0) out[k] = stock[k] * share;
  return out;
}

// ---------- the AI groups (coarse: no lots) ----------
// The kind of food a group keeps, by its kind (its stores, its gifts, its caravans' food, its raids' takings).
export const GROUP_MIX = { raider: "raider", expansionist: "stores", zealot: "stores", military: "army", fortress: "stores", traders: "travel", commune: "commune", merchants: "travel", explorers: "travel", band: "raider" };
export const groupMix = (f) => GROUP_MIX[f && f.type] || "stores";
// The item a group asks for on its market board when it is short of food: the food that keeps it eats most of.
export function groupFoodWant(f) {
  const m = MIXES[groupMix(f)];
  return Object.keys(m).filter((k) => FOODS[k].stable).sort((a, b) => m[b] - m[a] || (a < b ? -1 : 1))[0] || "f_beans";
}
// Items added to a bare stock (a group's: no lots).
export const addFoodsTo = (st, items) => { for (const [k, q] of Object.entries(items || {})) if (q > 0) st[k] = (st[k] || 0) + q; return st; };
// A new group's food: GROUP_START days a head of its kind's food (the old 6 food and 0.5 preserved a head).
export const GROUP_START = 6.5;
export const groupStartFood = (state, type, pop) => typedFood(state, GROUP_MIX[type] || "stores", pop * GROUP_START);
// A group's day from its own land (days of food): its fields', hunters' and pens' kinds, whole items by the food dice.
export const groupFieldFood = (state, units) => typedFood(state, "fields", units);

// ---------- the governor's trades ----------
// The needs table (autopilot.js needs: 0 plenty … 3 urgent, by supply) rates food as one good, "food". A deal is made
// by item: the food it would buy is the item they hold the most days of (food that keeps counts double: it is what a
// hub wants in store), the food it would sell the item it holds the most days of. Returns the table with "food" (and
// "preserved") replaced by those two items at the food's need.
export function bestFoodKey(stock, keeps = false) {
  let best = null, bu = 0;
  for (const k in stock || {}) {
    const f = FOODS[k];
    if (!f || !(stock[k] >= 1)) continue;
    const u = unitsOf(k, stock[k]) * (keeps && f.stable ? 2 : 1) * (keeps && f.raw ? 0.3 : 1);
    if (u > bu + 1e-9 || (Math.abs(u - bu) <= 1e-9 && best && k < best)) { best = k; bu = u; }
  }
  return best;
}
export function foodNeeds(needs, theirHave = null, have = null) {
  if (!needs || needs.food == null) return needs;
  const out = { ...needs };
  const n = needs.food;
  delete out.food;
  delete out.preserved;
  const buy = theirHave ? bestFoodKey(theirHave, true) : null;
  if (buy) out[buy] = n;
  const sell = have ? bestFoodKey(have, false) : null;
  if (sell && !(sell in out)) out[sell] = n;
  return out;
}
// `units` days of food a holder can sell or give (a caravan's goods, a deal's food): the items it holds the most days
// of first (whole items), never food with the worm's eggs. Returns { key: q } (not moved yet).
export function sellPick(h, units) {
  const st = stockOf(h);
  const rows = Object.keys(st || {}).filter((k) => FOODS[k] && st[k] >= 1).map((k) => ({ k, u: unitsOf(k, st[k]) })).sort((a, b) => b.u - a.u || (a.k < b.k ? -1 : 1));
  const out = {};
  let need = units;
  for (const r of rows) {
    if (need <= 1e-6) break;
    const q = Math.min(Math.floor(st[r.k]), Math.ceil(qtyOf(r.k, need) - 1e-9));
    if (q <= 0) continue;
    out[r.k] = q;
    need -= unitsOf(r.k, q);
  }
  return out;
}
// The food in a room or a container of a raid's or a city crawl's map (combat.js AREAS), by the room.
export const AREA_MIX = { house: "house", farmhouse: "farm", store: "shop", kitchen: "diner", pharmacy: "pharmacy", warehouse: "warehouse", barracks: "army", barn: "farm", cabin: "wild", cellblock: "prison", campsite: "wild", wreck: "travel", roadcars: "travel", chapel: "house", fuselage: "military", cargodrop: "military" };
// A find's "food" / "preserved" (days of food, a loot table's roll) turned into items in place: by `mix`, as much as
// the site's shelves still hold (shopFood, when the tile is given) and lowering them. Returns the find.
export function typeFind(state, sup, mix = "house", tile = null) {
  if (!sup || !((sup.food || 0) > 0 || (sup.preserved || 0) > 0)) { if (sup) { delete sup.food; delete sup.preserved; } return sup; }
  const t = tile != null && state && state.tiles ? state.tiles[tile] : null;
  const k = t ? shopFood(state, t) : 1;
  let drawn = 0;
  for (const key of ["food", "preserved"]) {
    const u = (sup[key] || 0) * k;
    delete sup[key];
    if (!(u > 0)) continue;
    for (const [kk, q] of Object.entries(typedFood(state, key === "preserved" ? (mix === "military" || mix === "army" ? mix : "keeps") : mix, u))) { sup[kk] = (sup[kk] || 0) + q; drawn += unitsOf(kk, q); }
  }
  if (t) drawShop(state, t, drawn);
  return sup;
}

// ---------- old saves (save.js: once, state.foodTypes) ----------
// A save from before food was by type: every generic "food" becomes a mix of what a holdout ate (OLD_FRESH: half
// cans and dry goods, half produce; the share base.meat recorded as raw venison, with the worm's eggs where
// base.wormMeat said so; crops and forage with eggs as potatoes and roots with eggs), every "preserved" becomes jarred
// food (as many portions as the base's jars in use hold) and grain, dried fruit and jerky. Calories are kept exactly
// (no dice: fractions kept). Teams, their cargo, the groups, travellers, an errand's pack and food on the ground too.
export const OLD_FRESH = { f_beans: 14, f_cannedveg: 8, f_cannedmeat: 10, f_rice: 10, f_oats: 5, f_potatoes: 20, f_squash: 10, f_turnips: 8, f_onions: 8, f_apples: 7 };
export const OLD_PRESERVED = { f_grain: 40, f_driedfruit: 30, f_jerky: 30 };
const exact = (mix, units) => typedFood(null, mix, units, { rng: false, kinds: 99 });
function migrateHolder(h, { meat = 0, wormMeat = 0, wormCrop = 0, wormForage = 0, jarsInUse = 0, freshMix = OLD_FRESH, presMix = OLD_PRESERVED } = {}) {
  const st = stockOf(h);
  if (!st) return 0;
  let fresh = Math.max(0, num(st.food)), pres = Math.max(0, num(st.preserved));
  const debt = Math.min(0, num(st.food));
  delete st.food;
  delete st.preserved;
  const left = (k, share = 0.5) => FOODS[k].shelf * share;
  const m = Math.min(fresh, Math.max(0, meat)), wm = Math.min(m, Math.max(0, wormMeat));
  if (m - wm > EPS) addFood(h, "f_venison", qtyOf("f_venison", m - wm), { left: left("f_venison") });
  if (wm > EPS) addFood(h, "f_venison", qtyOf("f_venison", wm), { left: left("f_venison"), egg: true });
  fresh -= m;
  const wc = Math.min(fresh, Math.max(0, wormCrop));
  if (wc > EPS) addFood(h, "f_potatoes", qtyOf("f_potatoes", wc), { left: left("f_potatoes"), egg: true });
  fresh -= wc;
  const wf = Math.min(fresh, Math.max(0, wormForage));
  if (wf > EPS) addFood(h, "f_roots", qtyOf("f_roots", wf), { left: left("f_roots"), egg: true });
  fresh -= wf;
  for (const [k, q] of Object.entries(exact(freshMix, fresh))) addFood(h, k, q, { left: FOODS[k].stable ? null : left(k) });
  const jarred = Math.min(pres, Math.max(0, jarsInUse) * 2);
  if (jarred > EPS) addFood(h, "f_jarred", qtyOf("f_jarred", jarred));
  for (const [k, q] of Object.entries(exact(presMix, pres - jarred))) addFood(h, k, q);
  return debt;
}
export function migrateFood(state) {
  for (const b of state.bases || []) {
    const debt = migrateHolder(b, { meat: b.meat, wormMeat: b.wormMeat, wormCrop: b.wormCrop, wormForage: b.wormForage, jarsInUse: b.jarsInUse });
    if (debt < 0) b.foodShort = -debt;
    for (const k of ["meat", "wormMeat", "wormCrop", "wormForage", "mash"]) delete b[k];
  }
  for (const p of state.parties || []) {
    if (p.supplies) migrateHolder(p, { freshMix: "travel", presMix: "keeps" });
    if (p.cargo && p.cargo.supplies) {
      migrateHolder(p.cargo, { meat: p.cargo.meat, wormMeat: p.cargo.wormMeat, wormForage: p.cargo.wormForage, freshMix: "stores", presMix: "keeps" });
      for (const k of ["meat", "wormMeat", "wormForage"]) delete p.cargo[k];
    }
    if (p.goods && p.goods.supplies) migrateHolder(p.goods.supplies, { freshMix: "stores", presMix: "keeps" });
  }
  for (const f of state.factions || []) if (f.stock) migrateHolder(f.stock, { freshMix: groupMix(f), presMix: "keeps" });
  for (const v of state.visitors || []) if (v.stock) migrateHolder(v.stock, { freshMix: "travel", presMix: "keeps" });
  for (const s of state.survivors || []) if (s.location && s.location.pack) migrateHolder(s.location.pack, { freshMix: "travel", presMix: "keeps" });
  for (const site of state.deathSites || []) {
    for (const it of site.items || []) {
      if (it.kind !== "supply" || (it.key !== "food" && it.key !== "preserved")) continue;
      const k = it.fresh ? "f_venison" : it.key === "preserved" ? "f_jerky" : "f_beans";
      it.qty = qtyOf(k, it.qty);
      it.key = k; it.name = FOODS[k].name; it.value = it.qty * FOODS[k].value; it.left = FOODS[k].shelf * (it.fresh ? 0.3 : 1);
      if (it.worm) it.worm = qtyOf(k, it.worm);
      delete it.fresh;
    }
  }
  for (const j of (state.jobs && state.jobs.list) || []) if (j.reward && j.reward.supplies) migrateHolder(j.reward.supplies, { freshMix: "stores", presMix: "keeps" });
  for (const r of state.abandoned || []) if (r.stock) migrateHolder(r.stock, { freshMix: "stores", presMix: "keeps" }); // groupworld.js: bases standing empty
}
