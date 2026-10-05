// Static definitions: terrain, locations, supplies, gear, traits, faction types, names.
// Kept as plain data so it can later move to JSON files for modding.

export const TERRAIN = {
  water:    { name: "Water",    color: "#2c4f6b", walk: Infinity, vehicle: Infinity, traffic: 0 },
  plains:   { name: "Farmland", color: "#7d8a4f", walk: 2,   vehicle: 1.4, traffic: 0.05 },
  forest:   { name: "Forest",   color: "#3f5e3a", walk: 3,   vehicle: 2.8, traffic: 0.02 },
  hills:    { name: "Hills",    color: "#7a7152", walk: 3,   vehicle: 2.6, traffic: 0.02 },
  mountain: { name: "Mountains",color: "#6d6a66", walk: 5,   vehicle: Infinity, traffic: 0.01 },
  suburb:   { name: "Suburbs",  color: "#8a8378", walk: 2.5, vehicle: 1.6, traffic: 0.12 },
  city:     { name: "City",     color: "#5f5a57", walk: 3.5, vehicle: 3,   traffic: 0.2 },
};
export const ROAD_COST = { walk: 1.2, vehicle: 0.5 };

// Supplies: value is the hidden base barter value per unit (the player never sees it: every group prices it its own
// way, trade.js / valuation.js); weight is kg per unit (load.js: what people carry, what a vehicle hauls); a unit of food
// or water is one person's ration for a day; ammo is per round. cat = trade category (CATEGORIES below).
export const SUPPLIES = {
  food:  { name: "Food",  value: 2,   weight: 0.5, cat: "food" },
  water: { name: "Water", value: 1,   weight: 1, cat: "water" },
  fuel:  { name: "Fuel",  value: 3,   weight: 1, cat: "fuel" },
  meds:  { name: "Meds",  value: 6,   weight: 0.1, cat: "medical" },
  ammo:  { name: "Ammo",  value: 0.5, weight: 0.02, cat: "ammo" },
  parts: { name: "Parts", value: 8,   weight: 2, cat: "parts" },
  scrap: { name: "Scrap", value: 1,   weight: 2, cat: "scrap" },
  // Food storage (storage.js): preserved food is jarred, dried or smoked food (and dry grain and beans) that barely
  // spoils and needs no cellar space; eaten like food (fresh first), and lighter to carry on a trip. Jars (and lids)
  // are what the preserving kitchen fills: found in kitchens, shops and farms, and most come back when the food
  // in them is eaten at a base.
  preserved: { name: "Preserved food", value: 4, weight: 0.35, cat: "food" },
  jars:  { name: "Jars",  value: 0.5, weight: 0.4, cat: "containers" },
};
export const SUPPLY_KEYS = Object.keys(SUPPLIES);

// Pre-apocalypse gear that can be found anywhere, at any time. req = skill needed to use it fully.
// slot = where it is worn or held (inventory.js): weapon (hands), tool (off hand), armor (body), head, arms, legs,
// backpack (slots = pack slots it holds). small = fits in a pocket. Armor power adds up across worn pieces.
// value = hidden base trade value (never shown: the trade window shows what a given group pays or charges, other
// screens at most a rough worth tier, valuation.js worthTier). cat = trade category (CATEGORIES below): tag every new
// item with one; an untagged item gets a guess from its slot and fields (valuation.js itemCat).
// weight = kg (load.js; last on each line): everything a survivor wears, holds or keeps in pockets and pack counts
// toward their load. The same field name as SUPPLIES weight.
// Packs (slot "backpack"): slots = pack slots, carry = kg added to the wearer's max load, ease = share of the
// wearer's load that does not count toward their load band (a good pack spreads the weight). A new pack only
// needs these fields. bulky = too big for a pocket or a pack (only the team's cargo or a base's armory).
export const GEAR = {
  knife:      { name: "Kitchen knife",            slot: "weapon", skill: "shooting", power: 1, req: 0,  value: 5,  noise: 0, small: true, weight: 0.3, cat: "melee" },
  machete:    { name: "Machete",                  slot: "weapon", skill: "shooting", power: 2, req: 0,  value: 12, noise: 0, weight: 1, cat: "melee" },
  pistol:     { name: "9mm pistol",               slot: "weapon", skill: "shooting", power: 3, req: 2,  value: 30, noise: 2, small: true, weight: 1, cat: "pistol" },
  shotgun:    { name: "Pump shotgun",             slot: "weapon", skill: "shooting", power: 5, req: 6,  value: 50, noise: 3, weight: 3.5, cat: "shotgun" },
  huntrifle:  { name: "Hunting rifle",            slot: "weapon", skill: "shooting", power: 5, req: 5,  value: 55, noise: 3, weight: 4, cat: "rifle" },
  ar:         { name: "Assault rifle",            slot: "weapon", skill: "shooting", power: 8, req: 10, value: 120, noise: 3, weight: 4, cat: "automatic" },
  vest:       { name: "Kevlar vest",              slot: "armor",  skill: null,       power: 2, req: 0,  value: 45, noise: 0, weight: 4, cat: "armor" },
  plate:      { name: "Plate carrier",            slot: "armor",  skill: null,       power: 4, req: 0,  value: 110, noise: 0, weight: 8, cat: "armor" },
  nvg:        { name: "Night vision goggles",     slot: "tool",   skill: "stealth",  power: 3, req: 8,  value: 140, noise: 0, small: true, weight: 0.5, cat: "electronics" },
  milradio:   { name: "Military encrypted radio", slot: "tool",   skill: "scouting", power: 3, req: 6,  value: 160, noise: 0, small: true, weight: 1, cat: "electronics" },
  surgkit:    { name: "Surgical kit",             slot: "tool",   skill: "medicine", power: 4, req: 10, value: 90, noise: 0, small: true, medKit: 4, desc: "Real instruments: +4 Medicine when treating (at a base, in the field or in battle). Needs Medicine 10 for the full bonus; no use below Medicine 3.", weight: 1.5, cat: "medical" },
  // Extra worn pieces (inventory.js): head, arms and legs armor and a real pack.
  bikehelmet: { name: "Motorcycle helmet",        slot: "head",   skill: null,       power: 0.7, req: 0, value: 15, noise: 0, desc: "Scratched but solid. Keeps teeth off your skull.", weight: 1.5, cat: "armor" },
  riothelmet: { name: "Riot helmet",              slot: "head",   skill: null,       power: 1.2, req: 0, value: 35, noise: 0, desc: "Police issue, with a visor.", weight: 1.8, cat: "armor" },
  kneeguards: { name: "Knee and shin guards",     slot: "legs",   skill: null,       power: 0.5, req: 0, value: 10, noise: 0, desc: "Hard plastic from a dirt-bike shop. Bites slide off.", weight: 1, cat: "armor" },
  assaultpack:{ name: "Assault pack",             slot: "backpack", skill: null,     power: 1, req: 0,   value: 40, noise: 0, carry: 10, slots: 8, ease: 0.12, desc: "A military pack: 8 pack slots, +10 kg max load, and its frame spreads the weight: the wearer's load counts 12% lighter for their load band.", weight: 2, cat: "packs" },
  // Makeshift gear (crafting.js): weaker than the real thing and it wears out. dur = uses before it breaks
  // (fights for weapons and armor, treatments for kits, days of work for tools). Extra fields:
  // medKit = Medicine bonus when treating (crafting.medKitBonus; the surgical kit has it too), bonus = skill bonus for base work, water = water per day at a base,
  // carry = kg added to the wearer's max load (load.js), slots = pack slots (inventory.js).
  spikedbat:  { name: "Spiked bat",               slot: "weapon", skill: "shooting", power: 1.5, req: 0, value: 4,  noise: 0, makeshift: true, dur: 10, desc: "A bat studded with nails. Hits hard, splinters eventually.", weight: 1.2, cat: "melee" },
  pipespear:  { name: "Pipe spear",               slot: "weapon", skill: "shooting", power: 1.2, req: 0, value: 3,  noise: 0, makeshift: true, dur: 8,  desc: "A kitchen knife taped to a steel pipe.", weight: 1.5, cat: "melee" },
  sawmachete: { name: "Saw-blade machete",        slot: "weapon", skill: "shooting", power: 1.7, req: 0, value: 7,  noise: 0, makeshift: true, dur: 12, desc: "A circular-saw blade ground into a cleaver.", weight: 1.2, cat: "melee" },
  crossbow:   { name: "Scrap crossbow",           slot: "weapon", skill: "shooting", power: 2.5, req: 3, value: 18, noise: 0, makeshift: true, dur: 12, desc: "Leaf-spring limbs, reusable bolts: silent and needs no ammo.", weight: 3, cat: "bow" },
  pipegun:    { name: "Pipe shotgun",             slot: "weapon", skill: "shooting", power: 3.5, req: 3, value: 20, noise: 3, makeshift: true, dur: 8,  desc: "A zip gun: two pipes and a nail. Short range, fires shotgun shells (ammo).", weight: 2.5, cat: "shotgun" },
  padding:    { name: "Magazine arm guards",      slot: "arms",   skill: null,       power: 0.6, req: 0, value: 3,  noise: 0, makeshift: true, dur: 6,  desc: "Magazines and duct tape around the forearms. Stops a bite, barely.", weight: 0.8, cat: "armor" },
  shinguards: { name: "Duct-tape shin guards",    slot: "legs",   skill: null,       power: 0.4, req: 0, value: 2,  noise: 0, makeshift: true, dur: 6,  desc: "Cut-up plastic bottles and tape around the shins.", weight: 0.6, cat: "armor" },
  tirevest:   { name: "Tire-rubber vest",         slot: "armor",  skill: null,       power: 1,   req: 0, value: 8,  noise: 0, makeshift: true, dur: 10, desc: "Strips of tire rubber laced into a vest.", weight: 5, cat: "armor" },
  sportspads: { name: "Football pads",            slot: "armor",  skill: null,       power: 0.8, req: 0, value: 8,  noise: 0, makeshift: true, dur: 12, desc: "Found, not made: shoulder pads from a school locker (the helmet is a separate piece).", weight: 3, cat: "armor" },
  footballhelmet: { name: "Football helmet",      slot: "head",   skill: null,       power: 0.4, req: 0, value: 4,  noise: 0, makeshift: true, dur: 10, desc: "Found, not made: a school football helmet. Cracks eventually.", weight: 1.5, cat: "armor" },
  scrapvest:  { name: "Scrap plate vest",         slot: "armor",  skill: null,       power: 1.8, req: 0, value: 25, noise: 0, makeshift: true, dur: 14, desc: "Steel plates riveted onto a work jacket. Heavy but solid.", weight: 7, cat: "armor" },
  bandagekit: { name: "Bandage and splint kit",   slot: "tool",   skill: "medicine", power: 1,   req: 0, value: 8,  noise: 0, makeshift: true, dur: 5,  medKit: 2, small: true, desc: "Boiled rags, tape and splints: +2 Medicine when treating (at a base, in the field or in battle). Each treatment uses it up a little.", weight: 0.5, cat: "medical" },
  crowbar:    { name: "Crowbar and lockpicks",    slot: "tool",   skill: "scavenging", power: 1, req: 0, value: 6,  noise: 0, makeshift: true, dur: 30, bonus: { scavenging: 2 }, desc: "Opens locked doors and cabinets: +2 Scavenging for base scavenging.", weight: 2, cat: "tools" },
  waterfilter:{ name: "Charcoal water filter",    slot: "tool",   skill: null,       power: 1,   req: 0, value: 10, noise: 0, makeshift: true, dur: 20, water: 3, desc: "Sand, charcoal and a bucket: +3 water a day at the base it is kept at (equipped or in the armory).", weight: 3, cat: "tools" },
  backpack:   { name: "Improvised backpack",      slot: "backpack", skill: null,     power: 1,   req: 0, value: 5,  noise: 0, makeshift: true, carry: 6, slots: 6, desc: "A school bag reinforced with straps: 6 pack slots and +6 kg max load.", weight: 1, cat: "packs" },
  // The stealth kit (stealth.js). Throwables and the suppressor work from a pocket or the pack; thrown, a throwable is
  // gone (throw = the key in stealth.js THROWABLES). The suppressor wears a shot at a time (dur = shots).
  flashlight: { name: "Flashlight",               slot: "tool",   skill: null,       power: 0,   req: 0, value: 8,  noise: 0, small: true, desc: "In the off hand on a night raid: search at full speed and see 9 tiles instead of 7, but guards notice the light from 3 tiles further.", weight: 0.3, cat: "tools" },
  suppressor: { name: "Oil-filter suppressor",    slot: "pack",   skill: null,       power: 0,   req: 0, value: 12, noise: 0, small: true, makeshift: true, dur: 12, suppressor: true, desc: "An oil filter threaded onto the muzzle. Carried by someone with a pistol, hunting rifle or assault rifle, their shots make half the noise (half the Heat and earshot). Wears fast: 12 shots.", weight: 0.4, cat: "gunmod" },
  bottle:     { name: "Empty bottle",             slot: "pack",   skill: null,       power: 0,   req: 0, value: 1,  noise: 0, small: true, throw: "bottle", desc: "Thrown (up to 7 tiles), it smashes and pulls unaware guards and the dead within 6 tiles to look. One use.", weight: 0.4, cat: "explosive" },
  noisemaker: { name: "Noise maker",              slot: "pack",   skill: null,       power: 0,   req: 0, value: 3,  noise: 0, small: true, makeshift: true, throw: "noisemaker", desc: "A wind-up kitchen timer taped to a bell. Thrown (up to 7 tiles), it rings for 3 turns and pulls everything unaware within 8 tiles. One use.", weight: 0.3, cat: "explosive" },
  firecracker:{ name: "String of firecrackers",   slot: "pack",   skill: null,       power: 0,   req: 0, value: 4,  noise: 0, small: true, throw: "firecracker", desc: "Thrown (up to 8 tiles), the bangs pull everything unaware within 13 tiles, but a raid's Heat jumps 6. One use.", weight: 0.2, cat: "explosive" },
  // Books (skills.js): read on the Read role at a base from a copy in its armory. book.skill = what it teaches (4 XP an
  // hour, only while the skill is below book.max), book.hours = time to finish it; mood books give book.mood an hour.
  // Not worn: carried in a pack slot or the team's cargo, kept in the armory. Found at fitting sites, sold by traders.
  medbook:     { name: "Field Medicine Handbook",    slot: "pack", skill: null, power: 0, req: 0, value: 25, noise: 0, book: { skill: "medicine", max: 8, hours: 30 }, desc: "A paramedic's handbook: dressings, splints, fevers. Teaches Medicine up to 8.", weight: 0.6, cat: "books" },
  surgerybook: { name: "Emergency Surgery",          slot: "pack", skill: null, power: 0, req: 0, value: 60, noise: 0, book: { skill: "medicine", max: 14, hours: 50 }, desc: "A trauma surgery textbook. Teaches Medicine up to 14.", weight: 1.5, cat: "books" },
  enginebook:  { name: "Small Engine Repair",        slot: "pack", skill: null, power: 0, req: 0, value: 30, noise: 0, book: { skill: "mechanics", max: 10, hours: 40 }, desc: "Pumps, generators, outboard motors. Teaches Mechanics up to 10.", weight: 0.8, cat: "books" },
  gardenbook:  { name: "Gardening Through the Seasons", slot: "pack", skill: null, power: 0, req: 0, value: 20, noise: 0, book: { skill: "farming", max: 8, hours: 30 }, desc: "Sowing calendars, soil and saving seed. Teaches Farming up to 8.", weight: 0.6, cat: "books" },
  gunbook:     { name: "Marksmanship Manual",        slot: "pack", skill: null, power: 0, req: 0, value: 30, noise: 0, book: { skill: "shooting", max: 9, hours: 30 }, desc: "Breathing, trigger control, zeroing a sight. Teaches Shooting up to 9.", weight: 0.5, cat: "books" },
  armymanual:  { name: "Army Field Manual",          slot: "pack", skill: null, power: 0, req: 0, value: 55, noise: 0, book: { skill: "shooting", max: 13, hours: 45 }, desc: "Rifle marksmanship and fire and movement. Teaches Shooting up to 13.", weight: 0.6, cat: "books" },
  survivalbook:{ name: "Wilderness Survival",        slot: "pack", skill: null, power: 0, req: 0, value: 20, noise: 0, book: { skill: "scouting", max: 8, hours: 30 }, desc: "Maps, tracks, reading the land. Teaches Scouting up to 8.", weight: 0.5, cat: "books" },
  talkbook:    { name: "Negotiation 101",            slot: "pack", skill: null, power: 0, req: 0, value: 20, noise: 0, book: { skill: "speech", max: 8, hours: 30 }, desc: "Getting to yes, with people who have guns. Teaches Speech up to 8.", weight: 0.4, cat: "books" },
  lockbook:    { name: "Lockpicking for Locksmiths", slot: "pack", skill: null, power: 0, req: 0, value: 25, noise: 0, book: { skill: "stealth", max: 8, hours: 30 }, desc: "Pins, tension and patience: moving quietly through locked places. Teaches Stealth up to 8.", weight: 0.4, cat: "books" },
  leadbook:    { name: "Leading Small Teams",        slot: "pack", skill: null, power: 0, req: 0, value: 25, noise: 0, book: { skill: "leadership", max: 8, hours: 30 }, desc: "An NCO's guide to keeping people together. Teaches Leadership up to 8.", weight: 0.4, cat: "books" },
  scavbook:    { name: "Salvage Yard Secrets",       slot: "pack", skill: null, power: 0, req: 0, value: 20, noise: 0, book: { skill: "scavenging", max: 8, hours: 30 }, desc: "Where the good stuff hides in a wreck. Teaches Scavenging up to 8.", weight: 0.5, cat: "books" },
  comic:       { name: "Stack of comic books",       slot: "pack", skill: null, power: 0, req: 0, value: 4,  noise: 0, book: { mood: 3, hours: 4 }, desc: "Capes and explosions. +3 mood an hour read (a third of that read again). Teaches nothing.", weight: 0.3, cat: "luxury" },
  novel:       { name: "Paperback novel",            slot: "pack", skill: null, power: 0, req: 0, value: 3,  noise: 0, book: { mood: 2, hours: 8 }, desc: "A dog-eared thriller. +2 mood an hour read (a third of that read again). Teaches nothing.", weight: 0.3, cat: "luxury" },
  // A bicycle found on a search is cargo (bulky: no pocket or pack). At one of your bases it joins the bikes parked
  // there (vehicles.js parkBikes): a team can ride out on bikes, one per person.
  bicycle:     { name: "Bicycle",                  slot: "cargo", skill: null, power: 0, req: 0, value: 25, noise: 0, bulky: true, desc: "A mountain bike that still rolls. Carried home as cargo, it joins the bikes at the base: teams can ride out on bikes (one each), faster on roads, no fuel, and the rack takes some of the load.", weight: 12, cat: "vehicle" },

  // Valuables: goods kept for trade (valuation.js), light for their worth.
  goldring:    { name: "Gold ring",                  slot: "pack", skill: null, power: 0, req: 0, value: 30, noise: 0, small: true, weight: 0.05, valuable: true, cat: "jewelry", desc: "A wedding band. Worth nothing to eat, a lot to the right buyer." },
  cigarettes:  { name: "Carton of cigarettes",       slot: "pack", skill: null, power: 0, req: 0, value: 14, noise: 0, small: true, weight: 0.3, valuable: true, cat: "smokes", desc: "Ten sealed packs. The closest thing to money left." },
  whiskey:     { name: "Bottle of whiskey",          slot: "pack", skill: null, power: 0, req: 0, value: 16, noise: 0, weight: 0.8, valuable: true, cat: "liquor", desc: "Unopened bourbon. Raiders love it; zealots will not touch it." },
  coffee:      { name: "Tin of coffee",              slot: "pack", skill: null, power: 0, req: 0, value: 12, noise: 0, small: true, weight: 0.4, valuable: true, cat: "treats", desc: "Real ground coffee, still sealed." },
  batteries:   { name: "Pack of batteries",          slot: "pack", skill: null, power: 0, req: 0, value: 9,  noise: 0, small: true, weight: 0.2, valuable: true, cat: "household", desc: "AA cells in the blister pack. Every radio and flashlight wants them." },
};


// Trade categories (cat on SUPPLIES and GEAR). group = family for summaries; fine = a comfort or valuable that
// starving or poor groups will not pay much for and rich ones will (gear only); stockBy "key" = each title counts
// on its own when a group judges how many it already has (books and manuals), otherwise the whole category.
// Adding an item: give it the cat that fits; a new kind of thing gets a new entry here and, if groups should care,
// a number in TRADE_PREFS (anything missing is 1).
export const CATEGORIES = {
  melee:       { name: "melee weapons", group: "weapons" },
  pistol:      { name: "pistols", group: "weapons" },
  shotgun:     { name: "shotguns", group: "weapons" },
  rifle:       { name: "rifles", group: "weapons" },
  automatic:   { name: "automatic weapons", group: "weapons" },
  bow:         { name: "bows and crossbows", group: "weapons" },
  explosive:   { name: "throwables and explosives", group: "weapons" },
  gunmod:      { name: "suppressors and gun parts", group: "weapons" },
  ammo:        { name: "ammo", group: "ammo" },
  armor:       { name: "armor", group: "armor" },
  defence:     { name: "defences and traps", group: "armor" },
  medical:     { name: "meds and medical kits", group: "medical" },
  food:        { name: "food", group: "food" },
  water:       { name: "water", group: "food" },
  fuel:        { name: "fuel", group: "survival" },
  parts:       { name: "spare parts", group: "survival" },
  scrap:       { name: "scrap", group: "survival" },
  containers:  { name: "jars and containers", group: "survival" },
  tools:       { name: "tools", group: "survival" },
  farming:     { name: "seeds and farm tools", group: "survival" },
  clothing:    { name: "warm clothes", group: "survival" },
  camp:        { name: "camp gear", group: "survival" },
  vehicle:     { name: "vehicle parts", group: "survival" },
  packs:       { name: "packs and bags", group: "survival" },
  electronics: { name: "radios and electronics", group: "survival" },
  books:       { name: "books", group: "knowledge", stockBy: "key" },
  manuals:     { name: "manuals and blueprints", group: "knowledge", stockBy: "key" },
  luxury:      { name: "comforts", group: "comforts", fine: true },
  drugs:       { name: "drugs", group: "comforts", fine: true },
  // Valuables: barter goods with no other use.
  jewelry:     { name: "jewelry and gold", group: "valuables", fine: true },
  smokes:      { name: "cigarettes", group: "valuables", fine: true },
  liquor:      { name: "liquor", group: "valuables", fine: true },
  treats:      { name: "coffee and sweets", group: "valuables", fine: true },
  gadgets:     { name: "phones, consoles and cameras", group: "valuables", fine: true },
  collectibles:{ name: "collectibles", group: "valuables", fine: true },
  household:   { name: "batteries and household goods", group: "valuables" },
};

// What each kind of group thinks of each category (valuation.js typePref): × on both what they pay and what they
// charge. Missing = 1 ("*" = the default for that type); 0 = they refuse to deal in it. margin = extra on what they
// charge (traders sell dear). Outsiders: merchants and explorers from visitors.js (outside raiders use "raider").
export const TRADE_PREFS = {
  raider:       { melee: 1.15, pistol: 1.3, shotgun: 1.3, rifle: 1.2, automatic: 1.4, explosive: 1.3, gunmod: 1.2, ammo: 1.25, armor: 1.1, fuel: 1.4, vehicle: 1.3,
                  liquor: 1.6, drugs: 1.7, smokes: 1.6, jewelry: 1.5, luxury: 1.15, treats: 1.1, gadgets: 1.1, collectibles: 0.8, household: 0.9,
                  books: 0.45, manuals: 0.6, farming: 0.5, containers: 0.6 },
  military:     { pistol: 1.2, shotgun: 1.15, rifle: 1.35, automatic: 1.5, gunmod: 1.3, explosive: 1.25, ammo: 1.3, armor: 1.35, electronics: 1.5, household: 1.3,
                  gadgets: 1.15, packs: 1.2, medical: 1.15, fuel: 1.15, vehicle: 1.2, manuals: 1.15, smokes: 1.1,
                  melee: 0.7, bow: 0.75, luxury: 0.6, liquor: 0.7, drugs: 0.4, jewelry: 0.7, collectibles: 0.6, farming: 0.7, containers: 0.7, scrap: 0.8 },
  fortress:     { scrap: 1.5, parts: 1.4, defence: 1.6, armor: 1.35, tools: 1.3, containers: 1.2, manuals: 1.25, shotgun: 1.1, rifle: 1.1, explosive: 1.1, household: 1.15,
                  camp: 0.9, luxury: 0.75, liquor: 0.8, jewelry: 0.8, collectibles: 0.7, gadgets: 0.8 },
  traders:      { "*": 1.1, margin: 1.1, electronics: 1.2, luxury: 1.2, liquor: 1.2, jewelry: 1.3, smokes: 1.25, treats: 1.25, gadgets: 1.3, collectibles: 1.4, household: 1.2,
                  drugs: 1, scrap: 0.9 },
  commune:      { food: 1.25, water: 1.1, farming: 1.6, medical: 1.3, books: 1.35, manuals: 1.3, tools: 1.25, containers: 1.4, clothing: 1.2, camp: 1.1, treats: 1.35,
                  household: 1.3, luxury: 1.1, jewelry: 0.6, collectibles: 0.6, gadgets: 0.7, smokes: 0.8, liquor: 0.9, drugs: 0.5,
                  melee: 0.85, pistol: 0.75, shotgun: 0.85, rifle: 0.9, automatic: 0.5, explosive: 0.6, gunmod: 0.6, ammo: 0.8, armor: 0.8 },
  zealot:       { liquor: 0, drugs: 0, smokes: 0, jewelry: 0.4, collectibles: 0.5, gadgets: 0.5, luxury: 0.5, books: 0.35, electronics: 0.6, treats: 0.8,
                  medical: 1.4, food: 1.3, water: 1.2, melee: 1.15, bow: 1.1, explosive: 1.2 },
  expansionist: { fuel: 1.5, vehicle: 1.6, parts: 1.35, pistol: 1.15, shotgun: 1.2, rifle: 1.25, automatic: 1.35, ammo: 1.2, armor: 1.15, packs: 1.2, electronics: 1.1,
                  camp: 1.15, household: 1.1, jewelry: 1.1, farming: 0.8, luxury: 0.8, books: 0.8, collectibles: 0.8 },
  merchants:    { "*": 1.05, margin: 1.1, food: 1.35, water: 1.3, scrap: 1.4, containers: 1.5, jewelry: 1.3, collectibles: 1.4, gadgets: 1.25, liquor: 1.2, smokes: 1.2,
                  treats: 1.2, household: 1.15, fuel: 0.85, medical: 0.9, ammo: 0.9 },
  explorers:    { food: 1.3, water: 1.3, medical: 1.2, packs: 1.25, camp: 1.3, clothing: 1.25, household: 1.2, treats: 1.1, books: 0.8, jewelry: 0.8, gadgets: 0.7 },
};
// Small valuables traded as goods (where they exist: gold ring, cigarettes, whiskey, coffee, batteries) are light.
for (const [k, w] of Object.entries({ goldring: 0.05, cigarettes: 0.2, whiskey: 1, coffee: 0.5, batteries: 0.2 })) if (GEAR[k]) GEAR[k].weight = w;

// Location types placed on the map, with what they tend to hold. cat = where the type usually stands (the placed
// site's own zone is tile.loc.zone, see SITE_ZONES); danger = extra dead at the site on top of infection
// (0 quiet countryside … 3 hospitals, prisons and military bases); richness = starting loot (urban sites are richer).
// The buildings a raid map gets per type are in combat.js (AREA_SETS).
export const LOCATIONS = {
  town:     { name: "Town",           glyph: "T",  cat: "town",    danger: 1, loot: { food: 3, scrap: 3, meds: 1, ammo: 1, fuel: 0.3, jars: 0.5 }, gear: ["knife", "pistol", "shotgun", "sportspads", "bikehelmet", "bicycle"], richness: 0.6 },
  city:     { name: "City center",    glyph: "C",  cat: "urban",   danger: 2, loot: { scrap: 4, meds: 2, ammo: 2, parts: 1, food: 1 }, gear: ["pistol", "vest", "shotgun"], richness: 1.0 },
  farm:     { name: "Farmstead",      glyph: "F",  cat: "rural",   danger: 0, loot: { food: 5, fuel: 0.4, scrap: 1, jars: 1 }, gear: ["huntrifle", "machete"], richness: 0.5 },
  gas:      { name: "Gas station",    glyph: "G",  cat: "town",    danger: 1, loot: { fuel: 4, food: 2, scrap: 1 }, gear: ["pistol", "firecracker"], richness: 0.4 },
  mall:     { name: "Mall",           glyph: "M",  cat: "urban",   danger: 2, loot: { food: 3, scrap: 3, meds: 1, parts: 1, jars: 0.25 }, gear: ["knife", "machete", "backpack"], richness: 0.9 },
  hospital: { name: "Hospital",       glyph: "+",  cat: "urban",   danger: 3, loot: { meds: 5, scrap: 1, parts: 1 }, gear: ["surgkit"], richness: 0.8 },
  police:   { name: "Police station", glyph: "P",  cat: "urban",   danger: 2, loot: { ammo: 4, meds: 1, scrap: 1 }, gear: ["pistol", "shotgun", "vest", "riothelmet", "bicycle"], richness: 0.7 },
  military: { name: "National Guard base", glyph: "★", cat: "special", danger: 3, loot: { ammo: 5, parts: 2, fuel: 2, meds: 1 }, gear: ["ar", "plate", "vest", "riothelmet", "nvg", "milradio", "assaultpack"], richness: 1.1 },
  prison:   { name: "State prison",   glyph: "#",  cat: "special", danger: 3, loot: { food: 2, scrap: 2, ammo: 1 }, gear: ["shotgun", "vest", "riothelmet"], richness: 0.7 },
  univ:     { name: "University",     glyph: "U",  cat: "urban",   danger: 2, loot: { parts: 3, meds: 2, scrap: 2 }, gear: ["surgkit", "milradio"], richness: 0.8 },
  dam:      { name: "Dam and power plant", glyph: "D", cat: "special", danger: 1, loot: { parts: 4, scrap: 3, fuel: 0.3 }, gear: [], richness: 0.7 },
  airport:  { name: "Regional airport", glyph: "A", cat: "special", danger: 2, loot: { fuel: 4, parts: 2, scrap: 2 }, gear: ["pistol"], richness: 0.8 },
  factory:  { name: "Factory",        glyph: "I",  cat: "special", danger: 1, loot: { scrap: 5, parts: 2, fuel: 0.4 }, gear: ["crowbar"], richness: 0.8 },
  quarry:   { name: "Quarry",         glyph: "Q",  cat: "rural",   danger: 0, loot: { scrap: 3, fuel: 0.4 }, gear: [], richness: 0.4 },
  // City blocks: lootier, and more of the dead.
  autoshop:    { name: "Auto shop",          glyph: "Au", cat: "urban", danger: 2, loot: { parts: 4, fuel: 1, scrap: 3 }, gear: ["crowbar", "spikedbat", "kneeguards", "bicycle"], richness: 0.7 },
  pharmacy:    { name: "Pharmacy",           glyph: "Rx", cat: "urban", danger: 2, loot: { meds: 6, water: 1, food: 1 }, gear: ["bandagekit"], richness: 0.8 },
  supermarket: { name: "Supermarket",        glyph: "S",  cat: "urban", danger: 2, loot: { food: 6, water: 4, meds: 1, scrap: 1, preserved: 1.5, jars: 0.5 }, gear: ["knife"], richness: 0.95 },
  gunstore:    { name: "Gun store",          glyph: "Gu", cat: "urban", danger: 2, loot: { ammo: 6, scrap: 1 }, gear: ["pistol", "shotgun", "huntrifle", "vest", "kneeguards"], richness: 0.85 },
  hardware:    { name: "Hardware store",     glyph: "H",  cat: "urban", danger: 2, loot: { scrap: 5, parts: 2, fuel: 0.3 }, gear: ["machete", "crowbar", "kneeguards", "flashlight", "bicycle"], richness: 0.8 },
  apartments:  { name: "Apartment block",    glyph: "Ap", cat: "urban", danger: 2, loot: { food: 3, water: 2, meds: 1, scrap: 2, ammo: 1, jars: 0.5 }, gear: ["knife", "pistol", "bikehelmet", "backpack", "bicycle"], richness: 0.8 },
  office:      { name: "Office tower",       glyph: "O",  cat: "urban", danger: 2, loot: { scrap: 3, water: 2, parts: 1, meds: 1 }, gear: ["backpack"], richness: 0.6 },
  school:      { name: "School",             glyph: "Sc", cat: "urban", danger: 2, loot: { food: 3, water: 2, meds: 1, scrap: 2, jars: 0.25 }, gear: ["sportspads", "footballhelmet", "backpack", "bicycle"], richness: 0.6 },
  firestation: { name: "Fire station",       glyph: "Fs", cat: "urban", danger: 2, loot: { meds: 3, fuel: 0.8, parts: 2, scrap: 1 }, gear: ["bikehelmet", "crowbar", "bandagekit", "bicycle"], richness: 0.7 },
  warehouse:   { name: "Warehouse district", glyph: "W",  cat: "urban", danger: 2, loot: { scrap: 4, food: 3, parts: 2, fuel: 0.4, jars: 0.5 }, gear: ["crowbar"], richness: 0.9 },
  // Small-town shops and services (police stations, auto shops, gas stations and pharmacies stand in towns too).
  grocery:     { name: "Grocery store",      glyph: "Gr", cat: "town",  danger: 1, loot: { food: 5, water: 2, meds: 1, scrap: 1, preserved: 1, jars: 0.75 }, gear: ["knife"], richness: 0.6 },
  diner:       { name: "Diner",              glyph: "Di", cat: "town",  danger: 1, loot: { food: 5, water: 3, scrap: 1, jars: 0.75 }, gear: ["knife", "bottle"], richness: 0.5 },
  motel:       { name: "Motel",              glyph: "Mo", cat: "town",  danger: 1, loot: { food: 2, water: 2, meds: 1, scrap: 2, ammo: 1, jars: 0.25 }, gear: ["pistol", "knife", "backpack", "bicycle"], richness: 0.5 },
  church:      { name: "Church",             glyph: "†",  cat: "town",  danger: 1, loot: { food: 3, water: 3, meds: 1, scrap: 1, jars: 0.75 }, gear: ["bandagekit"], richness: 0.45 },
  clinic:      { name: "Clinic",             glyph: "Cl", cat: "town",  danger: 1, loot: { meds: 4, water: 1, scrap: 1 }, gear: ["surgkit", "bandagekit"], richness: 0.55 },
  feedstore:   { name: "Feed store",         glyph: "Fd", cat: "town",  danger: 0, loot: { food: 4, fuel: 0.8, scrap: 2, parts: 1, jars: 1 }, gear: ["machete", "huntrifle"], richness: 0.5 },
  // Countryside: sparse, quiet and poorer, often off the road.
  barn:        { name: "Barn",               glyph: "Br", cat: "rural", danger: 0, loot: { food: 3, fuel: 0.6, scrap: 2, jars: 0.5 }, gear: ["machete", "pipespear"], richness: 0.35 },
  ranch:       { name: "Ranch",              glyph: "R",  cat: "rural", danger: 0, loot: { food: 5, water: 2, ammo: 1, fuel: 0.3, jars: 0.75, preserved: 0.5 }, gear: ["huntrifle", "shotgun", "machete"], richness: 0.55 },
  cabin:       { name: "Cabin",              glyph: "Cb", cat: "rural", danger: 0, loot: { food: 2, ammo: 2, water: 1, meds: 1, preserved: 0.5, jars: 0.25 }, gear: ["huntrifle", "machete", "waterfilter"], richness: 0.35 },
  lodge:       { name: "Hunting lodge",      glyph: "L",  cat: "rural", danger: 0, loot: { ammo: 4, food: 3, meds: 1, preserved: 0.5 }, gear: ["huntrifle", "shotgun", "machete"], richness: 0.55 },
  campground:  { name: "Campground",         glyph: "Cg", cat: "rural", danger: 1, loot: { food: 2, water: 3, fuel: 0.3, scrap: 1 }, gear: ["knife", "pipespear", "waterfilter", "backpack", "bicycle"], richness: 0.4 },
  ranger:      { name: "Ranger station",     glyph: "Rs", cat: "rural", danger: 0, loot: { meds: 2, ammo: 2, food: 2, fuel: 0.3 }, gear: ["huntrifle", "bandagekit", "bicycle"], richness: 0.5 },
  radiotower:  { name: "Radio tower",        glyph: "Rt", cat: "rural", danger: 0, loot: { parts: 3, scrap: 2, fuel: 0.3 }, gear: [], richness: 0.4 },
  truckstop:   { name: "Truck stop",         glyph: "Ts", cat: "rural", danger: 1, loot: { fuel: 5, food: 3, parts: 1, scrap: 2, preserved: 0.5 }, gear: ["pistol", "shotgun"], richness: 0.7 },
  crashsite:   { name: "Crash site",         glyph: "X",  cat: "rural", danger: 1, loot: { scrap: 4, parts: 2, fuel: 0.8, meds: 1 }, gear: ["pistol", "vest"], richness: 0.6 },
  // Temporary sites from crash events (crashes.js): never placed by the map, they appear where something came down
  // and burn out after 7–10 days. temp: not a permanent site.
  crash_mil:   { name: "Army helicopter wreck", glyph: "✈", cat: "special", danger: 2, temp: true, loot: { ammo: 5, meds: 2, parts: 2, scrap: 2, fuel: 0.5 }, gear: ["ar", "vest", "plate", "riothelmet", "milradio", "nvg", "assaultpack"], richness: 1.2 },
  crash_cargo: { name: "Supply plane wreck",  glyph: "✈", cat: "special", danger: 2, temp: true, loot: { food: 5, water: 3, meds: 2, preserved: 2, parts: 1, scrap: 2, fuel: 0.6 }, gear: ["assaultpack", "vest", "bandagekit", "surgkit"], richness: 1.2 },
  crash_med:   { name: "Medevac wreck",       glyph: "✈", cat: "special", danger: 2, temp: true, loot: { meds: 7, water: 2, scrap: 1, parts: 1 }, gear: ["surgkit", "bandagekit", "vest"], richness: 1.1 },
  crash_news:  { name: "News helicopter wreck", glyph: "✈", cat: "special", danger: 2, temp: true, loot: { parts: 3, scrap: 3, water: 1, food: 1, fuel: 0.4 }, gear: ["milradio", "backpack", "bikehelmet"], richness: 0.9 },
  airdrop:     { name: "Supply drop",         glyph: "⇣", cat: "special", danger: 1, temp: true, loot: { food: 6, water: 4, meds: 3, ammo: 3, preserved: 2 }, gear: ["assaultpack", "vest", "bandagekit"], richness: 1.2 },
};
// Where a placed site stands (tile.loc.zone): map icon color and the inspect panel.
export const SITE_ZONES = {
  urban:   { name: "City",        color: "#e2826f" },
  town:    { name: "Small town",  color: "#e2b85c" },
  rural:   { name: "Countryside", color: "#9cc46e" },
  special: { name: "Landmark",    color: "#b79be6" },
};
export const DANGER_NAMES = ["Low", "Moderate", "High", "Very high"];
// Danger of a placed site (0–3): its type's danger, capped at 1 in small towns and the countryside (a town pharmacy
// is quieter than a city one). Open ground is 0.
export const siteDanger = (loc) => {
  if (!loc) return 0;
  const d = LOCATIONS[loc.type].danger ?? 1;
  return loc.zone === "town" || loc.zone === "rural" ? Math.min(1, d) : d;
};

export const SKILLS = ["shooting", "stealth", "scavenging", "scouting", "medicine", "mechanics", "farming", "speech", "leadership"];
export const SKILL_NAMES = {
  shooting: "Shooting", stealth: "Stealth", scavenging: "Scavenging", scouting: "Scouting",
  medicine: "Medicine", mechanics: "Mechanics", farming: "Farming", speech: "Speech", leadership: "Leadership",
};

export const TRAITS = {
  brave:     { name: "Brave",        desc: "Fights harder: +1 fighting strength, +5% to hit in battle" },
  coward:    { name: "Coward",       desc: "Fights worse: -1 fighting strength, -5% to hit in battle; may lose their nerve on a trip" },
  nightowl:  { name: "Night Owl",    desc: "At night their team is 15% more likely to spot others first" },
  medic:     { name: "Former Medic", desc: "+4 Medicine" },
  greedy:    { name: "Greedy",       desc: "Finds 15% more when scavenging around a base" },
  tough:     { name: "Tough",        desc: "Takes 25% less damage from wounds (not from hunger, thirst or infection)" },
  keeneye:   { name: "Keen Eye",     desc: "+1 sight radius for their team, and it notices hidden finds more often" },
  loud:      { name: "Loud",         desc: "-3 Stealth" },
  lucky:     { name: "Lucky",        desc: "+1 to every skill" },
  badback:   { name: "Bad Back",     desc: "Max load 28 kg instead of 40, and loads feel 20% heavier (a worse load band)" },
};

// Faction types. Starting attitude comes from the type (design doc: Faction count and starting attitudes).
export const FACTION_TYPES = {
  raider:       { label: "Raider gang",       attitude: "Aggressive", goodwill: -55, arms: 1.3, food: 0.8, expand: 0.01, raid: 0.07,  names: ["Red Hand", "Highway Kings", "Rust Dogs", "Black Creek Crew"] },
  expansionist: { label: "Expansionist hub",  attitude: "Aggressive", goodwill: -45, arms: 1.1, food: 1.1, expand: 0.05, raid: 0.04,  names: ["New Dominion", "Iron Compact", "Calder Front", "The Ascendancy"] },
  zealot:       { label: "Zealots",           attitude: "Aggressive", goodwill: -70, arms: 1.0, food: 1.0, expand: 0.02, raid: 0.05,  names: ["Children of the Ash", "The Purified", "Last Covenant"] },
  military:     { label: "Military remnant",  attitude: "Neutral",    goodwill: 0,   arms: 1.6, food: 0.9, expand: 0.015, raid: 0.0, names: ["3rd Guard Battalion", "Fort Calder Command", "Task Force Vanguard"] },
  fortress:     { label: "Fortress hub",      attitude: "Neutral",    goodwill: -5,  arms: 1.2, food: 1.1, expand: 0.005, raid: 0.0, names: ["Stonegate", "The Granary Walls", "Ridgeline Hold"] },
  traders:      { label: "Traders",           attitude: "Friendly",   goodwill: 35,  arms: 0.9, food: 1.0, expand: 0.01, raid: 0.0,  names: ["Crossroads Exchange", "Long Haul Co.", "River Market"] },
  commune:      { label: "Farming commune",   attitude: "Friendly",   goodwill: 30,  arms: 0.6, food: 1.6, expand: 0.01, raid: 0.0,  names: ["Greenhollow", "Harvest Fellowship", "Millbrook Co-op"] },
};
// Group colors on the map. None of them is blue: blue is the player's (render.js PLAYER_COLOR), and a group in
// a near-blue read as your own land.
// The first ten are the Normal map's; the other eight are for Large and Huge maps (up to 18 groups).
export const FACTION_COLORS = ["#d9534f", "#e8a33d", "#b065d6", "#93c83e", "#5fc28a", "#d96fa8", "#c9c25a", "#e6dfcc", "#e07b54", "#56c7c0",
  "#a8743f", "#7d9a3a", "#c4e06a", "#f2b8c6", "#3fa66b", "#b8b0a0", "#e05c8a", "#d6a96a"];

export const FIRST_NAMES = ["Maria", "James", "Ana", "Deshawn", "Liam", "Priya", "Owen", "Rosa", "Eli", "Hana", "Marcus", "Ivy", "Theo", "Nadia", "Cole", "June", "Rafael", "Sam", "Dana", "Kenji", "Lena", "Victor", "Mae", "Tobias", "Grace", "Andre", "Lucia", "Wes", "Nora", "Felix", "Imani", "Reid", "Cora", "Malik", "Elena", "Jonah"];
export const LAST_NAMES = ["Alvarez", "Brooks", "Chen", "Duarte", "Ellis", "Foster", "Garcia", "Hale", "Ibarra", "Jensen", "Kowalski", "Lindqvist", "Morales", "Nakamura", "Okafor", "Price", "Quinn", "Reyes", "Sato", "Tran", "Underwood", "Vance", "Walsh", "Young", "Zimmer"];
export const TOWN_NAMES = ["Harlow", "Pine Ridge", "Millbrook", "Cedar Falls", "Ashford", "Granite Falls", "Elm Crossing", "Bramble", "Fort Wade", "Hollis", "Kettle Creek", "Larkspur", "Redwater", "Sutter", "Vale", "Wexford", "Copper Hill", "Dunmore", "Glen Haven", "Marrow", "Ridgeway", "Stillwater", "Cold Spring", "Bellmont", "Oakhurst", "Fallon", "Holloway", "Prairie View"];

// ---------- hunting, snares and fishing (hunting.js) ----------
// Kept in a block of their own: the gear for food from the land, and where it turns up. Fishing gear goes in a pack
// slot or the cargo (not worn); a team fishes with what it carries, a base's fishers with what is in its armory.
Object.assign(GEAR, {
  fishrod:   { name: "Fishing rod",  slot: "pack", skill: null, power: 0, req: 0, value: 12, noise: 0, fish: "rod", weight: 0.8, cat: "tools", desc: "A telescopic rod and a tackle box. Fish on a river or a lake shore (team order, or the Fish job at a base by the water): about 0.6 food an hour, more at dawn and dusk." },
  fishnet:   { name: "Fishing net",  slot: "pack", skill: null, power: 0, req: 0, value: 18, noise: 0, fish: "net", weight: 2.5, cat: "tools", desc: "A gill net with floats: worked by two, it catches about twice what a rod does (1.2 food an hour)." },
  snarewire: { name: "Snare wire",   slot: "pack", skill: null, power: 0, req: 0, value: 6,  noise: 0, small: true, weight: 0.4, cat: "tools", desc: "A coil of brass wire: a line of 8 snares (team order, 2 hours). Quiet; about a rabbit a day in good country. The wire stays with the line and comes back when it is lifted." },
});
for (const [loc, keys] of Object.entries({
  cabin: ["fishrod", "snarewire"], lodge: ["fishrod", "snarewire", "fishnet"], campground: ["fishrod", "fishnet"], ranger: ["snarewire", "fishrod"],
  hardware: ["fishrod", "snarewire"], farm: ["snarewire"], ranch: ["snarewire"], feedstore: ["snarewire", "fishnet"], barn: ["snarewire"],
})) if (LOCATIONS[loc]) for (const k of keys) if (!LOCATIONS[loc].gear.includes(k)) LOCATIONS[loc].gear.push(k);
