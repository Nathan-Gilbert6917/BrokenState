// @ts-check
// Static definitions: terrain, locations, supplies, gear, traits, faction types, names.
// Kept as plain data so it can later move to JSON files for modding.
// The weapons overhaul's content lives in data-*.js modules (they import nothing) and is merged into GEAR at the end.
import { GUN_GEAR, GEAR_PATCH, LATER_GEAR } from "./data-guns.js";
import { AMMO_GEAR, RELOAD_GEAR, ROUND_SUPPLIES, RELOAD_SUPPLIES } from "./data-ammo.js";
import { FOOD_SUPPLIES, DAY_VALUE, DAY_KG } from "./foods.js"; // food by type (no generic "food" supply)
import { BULK_GEAR } from "./data-stacks.js"; // bulk ammo containers: an ammo can, a carton, a bag (sim/itemstack.js)
import { supItemGear } from "./data-supitems.js"; // every supply's item form, for pockets, packs and the off hand (sim/supitems.js)
import { MOD_GEAR } from "./data-gunmods.js";
import { KIT_GEAR } from "./data-kit.js";
import { CART_GEAR } from "./data-carts.js"; // a wheelbarrow and a hand cart, pushed in the arms (carts.js)
import { TENT_GEAR } from "./data-tents.js"; // tent bags: one-, two- and four-person tents (tents.js)
import { HELMET_GEAR } from "./data-helmets.js"; // helmets, visors, helmet mounts, ear protection (helmets.js, hearing.js)
import { BLADE_GEAR } from "./data-blades.js"; // knives and swords (blades.js: where they turn up)
import { NL_GEAR } from "./data-nonlethal.js"; // tasers, cartridges, pepper spray, the stun baton (nonlethal.js)
import { TOOL_ITEMS } from "./data-tools.js"; // tools for building and crafting: a tool kit, saws, a felling axe, a shovel, a drill, a welder, a sewing kit, the makeshift ones (toolreqs.js)
import { SURV_ITEMS } from "./data-survival.js"; // survival gear: tools, armour against teeth, lights, a rig, a jump bag, a rangefinder (survival.js: where they turn up)
import { BED_GEAR } from "./data-beds.js"; // beds as furniture: cots, beds, bunk beds, large beds (beds.js)
import { POWER_GEAR } from "./data-power.js"; // the power grid: found generators, mounted spotlights, fridges (electric.js)
import { BOX_GEAR, BOX_PATCH } from "./data-boxes.js"; // cash boxes, fire safes, toolboxes, equipment cases; the gun cases as boxes (boxes.js)
import { NEW_KINDS } from "./data-shops.js"; // the shops and services new as places (their LOCATIONS rows)

// Travel time a tile, in hours (parties.js moveCost): on foot an hour a tile whatever the ground; a car half an hour
// off-road and a quarter of an hour on a road or a bridge (ROAD_COST); mountains are closed to cars.
export const TERRAIN = {
  water:    { name: "Water",    color: "#2c4f6b", walk: Infinity, vehicle: Infinity, traffic: 0 },
  plains:   { name: "Farmland", color: "#7d8a4f", walk: 1,   vehicle: 0.5, traffic: 0.05 },
  forest:   { name: "Forest",   color: "#3f5e3a", walk: 1,   vehicle: 0.5, traffic: 0.02 },
  hills:    { name: "Hills",    color: "#7a7152", walk: 1,   vehicle: 0.5, traffic: 0.02 },
  mountain: { name: "Mountains",color: "#6d6a66", walk: 1,   vehicle: Infinity, traffic: 0.01 },
  suburb:   { name: "Suburbs",  color: "#8a8378", walk: 1,   vehicle: 0.5, traffic: 0.12 },
  city:     { name: "City",     color: "#5f5a57", walk: 1,   vehicle: 0.5, traffic: 0.2 },
};
export const ROAD_COST = { walk: 1, vehicle: 0.25 };

// Supplies: value is the hidden base barter value per unit (the player never sees it: every group prices it its own
// way, trade.js / valuation.js); weight is kg per unit (load.js: what people carry, what a vehicle hauls); a unit of
// water is one person's ration for a day; ammo is per round. cat = trade category (CATEGORIES below).
// Food is by type (foods.js FOODS: canned beans, MREs, bread, raw venison…, merged in below as FOOD_SUPPLIES): there is
// no generic "food" supply. A day's food is 2000 kcal (foods.js DAY_KCAL, foodIn).
export const SUPPLIES = {
  // Water (water.js): purified water is safe to drink (boiled, filtered, treated with tablets, or bottled water found in
  // shops and houses); un-purified water comes from the land (wells, springs, rivers and lakes, rain catchers) and is
  // safe only once purified: drunk as it is, it carries the worm's eggs of the ground it came from (worm.js). A base's
  // boiler, water filters and a shelter's fire purify it; a team boils it at a camp fire, filters it or drops tablets in.
  water: { name: "Purified water", value: 1,   weight: 1, cat: "water" },
  rawwater: { name: "Un-purified water", value: 0.5, weight: 1, cat: "water" },
  fuel:  { name: "Fuel",  value: 3,   weight: 1, cat: "fuel" },
  meds:  { name: "Meds",  value: 8,   weight: 0.1, cat: "medical" }, // semi-rare outside pharmacies and clinics (medfinds.js): dear
  ammo:  { name: "Ammo",  value: 0.5, weight: 0.02, cat: "ammo" }, // abstract rounds (other groups' stores, a plan's or a deal's "N ammo"); yours are by calibre (ROUND_SUPPLIES)
  // Arrows and crossbow bolts: what a bow or crossbow shoots (1 a shot; it never uses ammo). Hunting (hunting.js) often
  // loses one (in the brush, broken in the animal); in a fight about half the arrows shot are picked up again after a
  // win and none after a loss or a retreat (world.js ARROWS, combat.js). Made by hand from wood and a little scrap
  // (crafting.js), found at hunting lodges, gun stores, sports shops and campgrounds.
  arrows: { name: "Arrows", value: 0.4, weight: 0.03, cat: "bow" },
  // Spare parts by kind (docs/weapons-overhaul-plan.md section 10): "parts" are machine parts (buildings, generators,
  // wells, stations, breakdowns, the machine shop); car parts mend vehicles (vehicles.js: 2 machine parts stand in for
  // one), gun parts guns and their attachments (repair.js), electronics lights, lasers, night vision and radios. Found
  // by kind where they are kept (loot.js sortParts: an auto shop's are mostly car parts), salvaged from guns, gadgets
  // and stripped vehicles; other groups keep one count of parts and offer the kinds out of it (trade.js KIND_MIX).
  parts: { name: "Machine parts", value: 8,   weight: 2, cat: "parts" },
  scrap: { name: "Scrap", value: 1,   weight: 2, cat: "scrap" },
  // Jars (and lids) are what the preserving room fills (foods.js f_jarred, two portions a jar): found in kitchens,
  // shops and farms, and most come back when the food in them is eaten at a base (storage.js).
  jars:  { name: "Jars",  value: 0.5, weight: 0.4, cat: "containers" },
  // Wood (woodcutting.js): split logs, branches and kindling, 0.1 kg a unit (a 3 kg bundle is 30), cut from the
  // land around a base (the Cut wood job) or by a team (the Cut wood order), found in woodpiles and log baskets, or
  // broken down from wooden, paper and cloth things (by their weight). The winter's heating: a base burns wood
  // before fuel, 30 wood heating as much as 0.2 fuel (upkeep.js HEAT.wood). Bulky and cheap: anyone with an axe
  // can cut it. (It was 3 kg a unit: every wood figure is WOOD_UNITS times what it was; save.js scales old saves.)
  // bulk: what counts as one where a rule asks for "a few" of a supply (supplyFew: 5 to spare is 150 wood).
  wood:  { name: "Wood", value: 0.02, weight: 0.1, cat: "firewood", bulk: 30 },
  // Stone (stone.js, the user's request 2026-10-23): field stone, 1 kg a unit, from rocks and boulders cleared on the
  // base map, the Gather stone job or a team's Gather stone order. A camp's fire ring (staging.js CAMP.fireCost), a
  // cook fire's, a boiler's, a hearth, a well's or a cistern's lining, a root cellar's walls (buildings.js).
  stone: { name: "Stone", value: 0.05, weight: 1, cat: "scrap", bulk: 5 },
  carparts:    { name: "Car parts",   value: 7,  weight: 3,   cat: "vehicle" },
  gunparts:    { name: "Gun parts",   value: 10, weight: 0.5, cat: "gunmod" },
  electronics: { name: "Electronics", value: 12, weight: 0.3, cat: "electronics" },
  // Building materials (2026-10-09, user request: "Add something called building materials that can be scavenged and
  // use this to establish bases"): lumber, cinder blocks, nails and fixings. Scavenged as a find of its own (loot.js
  // BUILDMAT_FINDS: hardware stores and quarries most, warehouses, factories, barns, farms and towns; on top of the
  // site's usual loot, so nothing else got rarer), heavy and bulky; what a camp
  // takes to become a base (buildings.js outpost_up), and some of every building (buildings.js BUILDMAT_SHARE). Traded
  // with scrap. Carried in both arms only, up to 4 a person (data-supitems.js, carry.js HOLD: the user's call 2026-10-21).
  buildmat:    { name: "Building materials", value: 3, weight: 3, cat: "scrap" },
  // Metal sheets (2026-10-21, user request: "Add metal sheets as a lootable items that can be carried by the carried
  // slot with two hands. stacked up to 4"): corrugated roofing, steel siding and plate, 6 kg a sheet. Carried in both
  // arms only, up to 4 a person (24 kg: just under HANDS_KG), or in a vehicle. Found where sheet steel is kept or
  // built into things (loot.js SHEET_FINDS), salvaged from car wrecks, a stripped car and the base map's wrecks,
  // flattened out of scrap at a workshop (crafting.js metalsheet). What roofs, metal walls and reinforced builds take
  // (buildings.js), the metal-sheet armour and weapons (crafting.js), a vehicle's plating (vehicles.js PLATING) and
  // the repairs of what is made of them (breakdowns.js, WALL_REPAIR).
  metalsheet:  { name: "Metal sheets", value: 5, weight: 6, cat: "scrap" },
};
// Rounds by calibre and type (data-ammo.js ROUND_SUPPLIES: a_9mm_fmj, a_12ga_buck…; ammo.js): what your stocks hold.
// "ammo" above stays as the abstract count (other groups' stores, what a plan or a deal asks for).
Object.assign(SUPPLIES, ROUND_SUPPLIES);
Object.assign(SUPPLIES, RELOAD_SUPPLIES); // the reloading bench's brass, powder and primers (data-ammo.js; reloading.js)
Object.assign(SUPPLIES, FOOD_SUPPLIES); // food by type (foods.js)
// A key's value and weight a unit, where a spec may hold days of food ("food", "preserved": a plan's line, a deal, a
// loot table) as well as real supplies: a day of food is DAY_VALUE and DAY_KG (packed as what keeps and weighs least).
export const supValue = (k) => (SUPPLIES[k] ? SUPPLIES[k].value : k === "food" ? DAY_VALUE : k === "preserved" ? DAY_VALUE * 1.5 : 0);
export const supWeight = (k) => (SUPPLIES[k] ? SUPPLIES[k].weight : k === "food" || k === "preserved" ? DAY_KG : 0);
export const SUPPLY_KEYS = Object.keys(SUPPLIES);
// The supplies a screen lists one by one: every key but the rounds (shown together as "Ammo", ammo.js totalRounds) and
// the food (shown in a Food section of its own, foods.js).
export const STOCK_KEYS = SUPPLY_KEYS.filter((k) => !ROUND_SUPPLIES[k] && !RELOAD_SUPPLIES[k] && !FOOD_SUPPLIES[k]); // the bench's inputs: on the reloading card (ui/production.js)
// Wood units to one before wood was 0.1 kg a unit (a 3 kg bundle): save.js scales an older save's wood by it.
export const WOOD_UNITS = 30;
// "A few" of a supply in a rule (n to spare, n to lose): n units, × its bulk (firewood: 30 a unit of the old 3 kg bundle).
/** @param {string} k a supply key @param {number} n @returns {number} */
export const supplyFew = (k, n) => n * ((SUPPLIES[k] && SUPPLIES[k].bulk) || 1);

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
// burnShare = the share of its weight that burns (wood, paper, cloth and wax 1; a bat with nails, a guitar's strings and
// pegs, magazines under duct tape 0.8–0.9; a bag's straps and buckles 0.5; metal and plastic things none): broken
// down it makes floor(weight × burnShare / 0.1 kg) wood (woodcutting.js burnOf). "Break down for wood" in the
// inventory, and the water boiler may burn it from the armory (woodcutting.js burnables).
export const GEAR = {
  knife:      { name: "Kitchen knife",            slot: "weapon", skill: "shooting", power: 1, req: 0,  value: 5,  noise: 0, small: true, desc: "A chef's knife from a kitchen block. Quiet, light, and better than bare hands.", weight: 0.3, cat: "melee" },
  machete:    { name: "Machete",                  slot: "weapon", skill: "shooting", power: 2, req: 0,  value: 12, noise: 0, desc: "A brush-clearing blade. Silent, and it cleaves the dead.", weight: 1, cat: "melee" },
  pistol:     { name: "9mm pistol",               slot: "weapon", skill: "shooting", power: 3, req: 2,  value: 30, noise: 2, small: true, desc: "A police-issue 9mm with a 15-round magazine. Light, fits a pocket, takes a suppressor. Needs Shooting 2.", weight: 1, cat: "pistol" },
  shotgun:    { name: "Pump shotgun",             slot: "weapon", skill: "shooting", power: 5, req: 6,  value: 50, noise: 3, desc: "A pump-action 12 gauge holding six shells: devastating up close, poor at range. Needs Shooting 6.", weight: 3.5, cat: "shotgun" },
  huntrifle:  { name: "Hunting rifle",            slot: "weapon", skill: "shooting", power: 5, req: 5,  value: 30, noise: 3, desc: "A bolt-action deer rifle with five in the magazine, found with its 3–9× scope (a part: it comes off for another): the long-range gun. Needs Shooting 5.", weight: 3.6, cat: "rifle" },
  ar:         { name: "Assault rifle",            slot: "weapon", skill: "shooting", power: 8, req: 10, value: 120, noise: 3, desc: "A military rifle, two rounds a shot from a 30-round magazine: the best gun there is. Needs Shooting 10.", weight: 4, cat: "automatic" },
  vest:       { name: "Kevlar vest",              slot: "armor",  skill: null,       power: 2, req: 0,  value: 45, noise: 0, desc: "Soft body armor from a squad car or an armory.", weight: 4, cat: "armor" },
  plate:      { name: "Plate carrier",            slot: "armor",  skill: null,       power: 4, req: 0,  value: 110, noise: 0, desc: "Ceramic plates in a military carrier: the best body armor, and heavy.", weight: 8, cat: "armor" },
  nvg:        { name: "Night vision goggles",     slot: "tool",   skill: "stealth",  power: 3, req: 8,  value: 140, noise: 0, small: true, desc: "Military night vision: see in the dark on a night raid, spot others first at night. In the off hand on the map at night the team sees a tile around it instead of only its own tile. Needs Stealth 8.", weight: 0.5, cat: "electronics" },
  milradio:   { name: "Military encrypted radio", slot: "tool",   skill: "scouting", power: 3, req: 6,  value: 160, noise: 0, small: true, desc: "An encrypted military set: hears what others cannot. Needs Scouting 6.", weight: 1, cat: "electronics" },
  surgkit:    { name: "Surgical kit",             slot: "tool",   skill: "medicine", power: 4, req: 10, value: 90, noise: 0, small: true, medKit: 4, desc: "Real instruments: +4 Medicine when treating (at a base, in the field or in battle). Needs Medicine 10 for the full bonus; no use below Medicine 3.", weight: 1.5, cat: "medical" },
  // Extra worn pieces (inventory.js): head, arms and legs armor and a real pack.
  bikehelmet: { name: "Motorcycle helmet",        slot: "head",   skill: null,       power: 0.7, req: 0, value: 15, noise: 0, desc: "Scratched but solid. Keeps teeth off your skull.", weight: 1.5, cat: "armor" },
  riothelmet: { name: "Riot helmet",              slot: "head",   skill: null,       power: 1.2, req: 0, value: 35, noise: 0, visor: true, desc: "Police issue, with a visor. The visor takes the edge off a flashbang's glare.", weight: 1.8, cat: "armor" },
  milhelmet:  { name: "Combat helmet",            slot: "head",   skill: null,       power: 1.4, req: 0, value: 45, noise: 0, desc: "An army helmet, kevlar under the cloth cover. Stops a bite to the skull and most splinters. Usually taken off one of the dead soldiers.", weight: 1.5, cat: "armor" },
  kneeguards: { name: "Knee and shin guards",     slot: "legs",   skill: null,       power: 0.5, req: 0, value: 10, noise: 0, desc: "Hard plastic from a dirt-bike shop. Bites slide off.", weight: 1, cat: "armor" },
  assaultpack:{ name: "Assault pack",             slot: "backpack", skill: null,     power: 1, req: 0,   value: 40, noise: 0, carry: 10, slots: 8, ease: 0.12, desc: "A military pack: 8 pack slots, +10 kg max load, and its frame spreads the weight: the wearer's load counts 12% lighter for their load band.", weight: 2, cat: "packs" },
  // Makeshift gear (crafting.js): weaker than the real thing and it wears out. dur = uses before it breaks
  // (fights for weapons and armor, treatments for kits, days of work for tools). Extra fields:
  // medKit = Medicine bonus when treating (crafting.medKitBonus; the surgical kit has it too), bonus = skill bonus for base work, water = water per day at a base,
  // carry = kg added to the wearer's max load (load.js), slots = pack slots (inventory.js).
  spikedbat:  { burnShare: 0.8, name: "Spiked bat",               slot: "weapon", skill: "shooting", power: 1.5, req: 0, value: 4,  noise: 0, makeshift: true, dur: 10, desc: "A bat studded with nails. Hits hard, splinters eventually.", weight: 1.2, cat: "melee" },
  pipespear:  { name: "Pipe spear",               slot: "weapon", skill: "shooting", power: 1.2, req: 0, value: 3,  noise: 0, makeshift: true, dur: 8,  fish: "spear", fishPower: 0.35, desc: "A kitchen knife taped to a steel pipe. A makeshift spear: it also spears fish in the shallows (fishing in daylight, not through ice).", weight: 1.5, cat: "melee" },
  sawmachete: { name: "Saw-blade machete",        slot: "weapon", skill: "shooting", power: 1.7, req: 0, value: 7,  noise: 0, makeshift: true, dur: 12, desc: "A circular-saw blade ground into a cleaver.", weight: 1.2, cat: "melee" },
  crossbow:   { name: "Scrap crossbow",           slot: "weapon", skill: "shooting", power: 2.5, req: 3, value: 18, noise: 0, makeshift: true, dur: 12, desc: "Leaf-spring limbs: silent, shoots bolts (arrows, 1 a shot; never ammo). With none it is a club. After a won fight about half the bolts shot are picked up again; hunting loses some.", weight: 3, cat: "bow" },
  pipegun:    { name: "Pipe shotgun",             slot: "weapon", skill: "shooting", power: 3.5, req: 3, value: 20, noise: 3, makeshift: true, dur: 8,  desc: "A zip gun: two pipes and a nail, one shell at a time (reload after every shot). Short range, fires shotgun shells (ammo).", weight: 2.5, cat: "shotgun" },
  padding:    { burnShare: 0.9, name: "Magazine arm guards",      slot: "arms",   skill: null,       power: 0.6, req: 0, value: 3,  noise: 0, makeshift: true, dur: 12, desc: "Magazines and duct tape around the forearms. Stops a bite, barely.", weight: 0.8, cat: "armor" },
  shinguards: { name: "Duct-tape shin guards",    slot: "legs",   skill: null,       power: 0.4, req: 0, value: 2,  noise: 0, makeshift: true, dur: 12, desc: "Cut-up plastic bottles and tape around the shins.", weight: 0.6, cat: "armor" },
  tirevest:   { name: "Tire-rubber vest",         slot: "armor",  skill: null,       power: 1,   req: 0, value: 8,  noise: 0, makeshift: true, dur: 25, desc: "Strips of tire rubber laced into a vest.", weight: 5, cat: "armor" },
  sportspads: { name: "Football pads",            slot: "armor",  skill: null,       power: 0.8, req: 0, value: 8,  noise: 0, makeshift: true, dur: 20, desc: "Found, not made: shoulder pads from a school locker or a sporting goods store (the helmet is a separate piece).", weight: 3, cat: "armor" },
  footballhelmet: { name: "Football helmet",      slot: "head",   skill: null,       power: 0.4, req: 0, value: 4,  noise: 0, makeshift: true, dur: 15, desc: "Found, not made: a football helmet from a school or a sporting goods store. Cracks eventually.", weight: 1.5, cat: "armor" },
  goaliemask: { name: "Goalie mask",              slot: "head",   skill: null,       power: 0.5, req: 0, value: 6,  noise: 0, makeshift: true, dur: 14, desc: "A hockey goalie's moulded mask with a cage over the eyes: light, stops a bite to the face. From a sporting goods store.", weight: 0.9, cat: "armor" }, // data-shops.js: the sporting goods store
  scrapvest:  { name: "Scrap plate vest",         slot: "armor",  skill: null,       power: 1.8, req: 0, value: 25, noise: 0, makeshift: true, dur: 60, desc: "Steel plates riveted onto a work jacket. Heavy but solid.", weight: 7, cat: "armor" },
  // Sheet-metal gear (the user's request 2026-10-21: makeshift metal armour and weapons out of metal sheets; crafting.js
  // sheetvest…, armour.js ARMOUR steel, combat.js WEAPONS). Mended with a sheet (repair.js "sheet").
  sheetvest:  { name: "Sheet-metal cuirass",      slot: "armor",  skill: null,       power: 1.9, req: 0, value: 30, noise: 0, makeshift: true, sheet: true, dur: 70, desc: "Two metal sheets cut, bent to the chest and back and riveted on leather straps: AC 3 steel, tougher than a scrap plate vest and heavier. Mended with a metal sheet.", weight: 8.5, cat: "armor" },
  sheetarms:  { name: "Sheet-metal vambraces",    slot: "arms",   skill: null,       power: 0.9, req: 0, value: 10, noise: 0, makeshift: true, sheet: true, dur: 24, desc: "Forearm shells bent from a metal sheet and strapped on: bites and blades skate off (AC 2 steel). Mended with a metal sheet.", weight: 1.4, cat: "armor" },
  sheetlegs:  { name: "Sheet-metal greaves",      slot: "legs",   skill: null,       power: 0.8, req: 0, value: 10, noise: 0, makeshift: true, sheet: true, dur: 24, desc: "Shin plates bent from a metal sheet, a knee cap riveted on (AC 2 steel). Mended with a metal sheet.", weight: 1.6, cat: "armor" },
  sheetmachete: { name: "Sheet-metal machete",    slot: "weapon", skill: "shooting", power: 1.6, req: 0, value: 6,  noise: 0, makeshift: true, dur: 14, desc: "A long blade cut from a metal sheet with a grinder, the edge filed, the grip taped: cuts that bleed (20%), and it chops wood and wire at a pinch.", weight: 1, cat: "melee" },
  sheethatchet: { name: "Sheet-metal hatchet",    slot: "weapon", skill: "shooting", power: 1.5, req: 0, value: 5,  noise: 0, makeshift: true, dur: 14, desc: "A head cut from a metal sheet, folded double and riveted to a wooden handle: a chopping blow that can stagger (10%), and it cuts wood.", weight: 1.1, cat: "melee" },
  bandagekit: { name: "Bandage and splint kit",   slot: "tool",   skill: "medicine", power: 1,   req: 0, value: 8,  noise: 0, makeshift: true, dur: 5,  medKit: 2, small: true, desc: "Boiled rags, tape and splints: +2 Medicine when treating (at a base, in the field or in battle). Each treatment uses it up a little.", weight: 0.5, cat: "medical" },
  crowbar:    { name: "Crowbar and lockpicks",    slot: "tool",   skill: "scavenging", power: 1, req: 0, value: 6,  noise: 0, makeshift: true, dur: 30, bonus: { scavenging: 2 }, desc: "Opens locked doors and cabinets: +2 Scavenging for base scavenging.", weight: 2, cat: "tools" },
  // Makeshift picks (locks.js MAKESHIFT_PICK): bent wire for picking locks without the crowbar and lockpicks, a stack
  // of up to 10 in a pocket (data-stacks.js STACK_MAX), three a craft from a scrap (crafting.js). No dur: a pick snaps
  // whole (one off the stack half the time an attempt), it does not wear.
  // Makeshift ear protection (hearing.js; crafting.js CRAFTS.ragplugs): twists of rag dipped in wax, worn like foam
  // earplugs (data-helmets.js earplugs: in the Ear pro slot, inventory.js EQUIP_SLOTS ears, under any helmet). ears: cut 2
  // (foam 3), the same −3 tiles of hearing; dur counts fights, a pair a fight (hearing.js settleEars). A scrap a craft, in the field too.
  ragplugs:   { name: "Rag earplugs",             slot: "ears", plugs: true,   skill: null,       power: 0,   req: 0, value: 1,  noise: 0, small: true, makeshift: true, dur: 4, cat: "medical", weight: 0.02,
                ears: { cut: 2, hear: -3 },
                desc: "Twists of rag dipped in candle wax, a few pairs in a tin: makeshift earplugs. Worn in the Ear pro slot, a pair goes in at the start of a fight (4 fights); in a pocket or the pack they do nothing. Gunfire deafens less often than with bare ears, though less than foam plugs do (2 off a bang's loudness, foam 3), and you hear less (−3 tiles). Work under any helmet. A scrap a craft, anywhere; a team makes them in the field." },
  makeshiftpick: { name: "Makeshift picks",       slot: "pack",   skill: null,       power: 0,   req: 0, value: 1,  noise: 0, small: true, makeshift: true, desc: "Hairpins and bent wire, filed to a hook and a tension bar. Picks a locked door, cabinet or car in a raid without the crowbar and lockpicks (those are used first when carried): 30% + 4% a Stealth point − 15% a difficulty step above 1 (+10% Quiet Hands), as quiet as real picks (Heat +1), but every attempt snaps one pick in two, open or not. A safe, a steel security door or a gun safe is beyond them. Three a craft from a scrap, anywhere; they stack to 10 in a pocket.", weight: 0.02, cat: "tools" },
  waterfilter:{ name: "Charcoal water filter",    slot: "tool",   skill: null,       power: 1,   req: 0, value: 10, noise: 0, makeshift: true, dur: 20, water: 3, desc: "Sand, charcoal and a bucket: +3 purified water a day at the base it is kept at (equipped or in the armory), and it purifies 10 un-purified water a day there (the worm's eggs strained out). At a base it clogs only on the days it is in use (one always is; more while the tanks have room or the worm's eggs need straining): spares stand dry and keep. A team carrying one drinks its un-purified water through it, safe.", weight: 3, cat: "tools" },
  // The worm (worm.js): a sure cure in the gut stage, at a base or on the road. Loot: pharmacies, clinics, hospitals,
  // and the livestock wormer on farms and ranches; made at a med station.
  // A windlass tourniquet (medics.js MEDIC.SELF): one use, light enough for a pocket or an admin pouch. selfStab: a
  // downed carrier can stop their own bleeding with it in battle.
  tourniquet: { name: "Tourniquet",               slot: "pack",   skill: "medicine", power: 0,   req: 0, value: 6,  noise: 0, small: true, dur: 1, selfStab: true, weight: 0.1, cat: "medical", desc: "A strap and a windlass rod: cinched above a wound on an arm or a leg it stops the bleeding. Someone down and bleeding in battle with one in the off hand, a pocket or a rig pouch (not the pack: out of reach lying down) can stabilize themselves (35% + 5 a point of Medicine, at most 85%; a failed try spends nothing and can be tried again next turn). One use: it stays on the limb." },
  dewormer:   { name: "Dewormer",                 slot: "pack",   skill: null,       power: 0,   req: 0, value: 18, noise: 0, small: true, weight: 0.1, desc: "A blister pack of strong worm tablets (or the livestock paste from a farm). Clears the worm for sure while it is still in the gut, with no medic needed. Useless once it reaches the brain.", cat: "medical" },
  // Purification tablets (worm.js): a stack of dur tablets (tabs: true; dur counts tablets, not wear), one treats
  // WORM.TABS_WATER (10) un-purified water. They are for the road: a team carrying them drops one in per 10
  // un-purified water drunk from infected sources (no filter carried, no camp fire lit) and that water is safe; bases
  // never use them (a team leaving packs a tube from the armory: autopilot.js launchTrip, the planner). Loot: pharmacies, clinics, hospitals, camping places, truck stops,
  // supply drops; pressed at a med station (crafting.js).
  puritabs:   { name: "Purification tablets",     slot: "pack",   skill: null,       power: 0,   req: 0, value: 10, noise: 0, small: true, dur: 10, tabs: true, weight: 0.1, cat: "medical", desc: "A tube of 10 iodine tablets for the road: one makes 10 un-purified water safe to drink without stopping to boil it (the worm's eggs die). A team carrying them drops one in per 10 un-purified water drunk (any of it can carry the worm) when it has no water filter and no lit camp fire with something to burn: on the move, or at a camp out of wood. A base uses them only in an emergency (its boiler cold with nothing to burn, and no water filter); otherwise a team leaving packs a tube from the armory." },
  backpack:   { burnShare: 0.5, name: "School backpack",          slot: "backpack", skill: null,     power: 1,   req: 0, value: 5,  noise: 0, makeshift: true, carry: 6, slots: 6, desc: "A school bag reinforced with straps: 6 pack slots and +6 kg max load.", weight: 1, cat: "packs" },
  // The stealth kit (stealth.js). Throwables work from a pocket or the pack, the oil-filter suppressor fitted to a gun
  // (gunmods.js; carried loose it still works in battle); thrown, a throwable is
  // gone (throw = the key in stealth.js THROWABLES). The suppressor wears a shot at a time (dur = shots).
  // Lights (lights.js): a ladder, each heavier and brighter. At night they set how far your people see in battle and how
  // much further off they are noticed, light a rummage, and keep a survey's night odds up; teams pack them on the way out.
  headlamp:   { name: "Headlamp",                 slot: "pack",   skill: null,       power: 0,   req: 0, value: 7,  noise: 0, small: true, desc: "Strapped on over anything, hands free: it works wherever it is carried. At night: a wide beam 8 tiles ahead the way you face and search without fumbling; guards notice it a tile further off. The lightest light.", weight: 0.2, cat: "tools" },
  flashlight: { name: "Flashlight",               slot: "tool",   skill: null,       power: 0,   req: 0, value: 8,  noise: 0, small: true, desc: "In the off hand at night: a beam 9 tiles ahead the way you face (the dark around stays dark) and search at full speed, but guards notice the light from 3 tiles further.", weight: 0.3, cat: "tools" },
  windlight:  { name: "Wind-up flashlight",       slot: "tool",   skill: null,       power: 0,   req: 0, value: 5,  noise: 0, small: true, desc: "A plastic dynamo torch: crank it and it shines, no batteries ever. In the off hand at night: a dim beam 7 tiles ahead the way you face, shorter than a real flashlight's; guards notice it 2 tiles further off.", weight: 0.4, cat: "tools" },
  tacflash:   { name: "Military flashlight",      slot: "tool",   skill: null,       power: 0,   req: 0, value: 16, noise: 0, small: true, desc: "An issue tactical light, machined aluminium. In the off hand at night: the longest beam of any flashlight, 12 tiles ahead the way you face but narrow; guards notice it 3 tiles further off.", weight: 0.35, cat: "tools" },
  torch:      { name: "Torch",                    slot: "tool",   skill: null,       power: 0,   req: 0, value: 2,  noise: 0, desc: "A pitch-soaked branch, burning. In the off hand at night: a pool of light 4 tiles all round and search by it, but an open flame is seen from 4 tiles further. No batteries: anyone can make one from wood.", weight: 0.7, cat: "tools" },
  lantern:    { name: "Lantern",                  slot: "tool",   skill: null,       power: 0,   req: 0, value: 12, noise: 0, desc: "A camping lantern. In the off hand at night: a pool of light 5 tiles all round; guards notice it from 4 tiles further.", weight: 1.2, cat: "tools" },
  spotlight:  { name: "Spotlight",                slot: "tool",   skill: null,       power: 0,   req: 0, value: 18, noise: 0, desc: "A handheld spotlight on a heavy battery pack. In the off hand at night: a broad beam 11 tiles ahead the way you face, but it is seen from 6 tiles further. The heaviest light.", weight: 3.5, cat: "tools" },
  // Hand-crank radio (radio.js listeners): a receiver, never a transmitter (listen: true). A base holding one in
  // its armory or a team carrying one hears what a station would (news on the air, new voices on the scan, radio
  // rumours, callers in reach) but cannot call anyone: no group calls, no two-way contact for a team, no coverage
  // for others. The pocket radio is a thrown decoy; this one is the set you listen to, and it needs no batteries.
  handradio:  { name: "Hand-crank radio",         slot: "tool",   skill: null,       power: 0,   req: 0, value: 12, noise: 0, small: true, listen: true, weight: 0.5, cat: "electronics", desc: "A wind-up emergency receiver: a minute of cranking and it needs no batteries. It only listens. A base holding one in its armory or a team carrying one hears a radio network only while it is inside that network's coverage (tune in with Listen in: the team order, or the base's radio section) but cannot call in: no orders to a team out of coverage, no calls to groups, no coverage for anyone else." },
  suppressor: { name: "Oil-filter suppressor",    slot: "pack",   skill: null,       power: 0,   req: 0, value: 12, noise: 0, small: true, makeshift: true, dur: 12, suppressor: true, desc: "An oil filter threaded onto the muzzle: a makeshift suppressor. Fitted to a 9mm pistol or a rifle (hunting, lever-action, police carbine, assault; not a revolver or a shotgun: select the gun in the inventory, then Fit), its shots make half the noise (half the Heat and earshot, and a hunt draws less). Still works carried loose by someone with such a gun, in battle only. Wears fast: 12 shots.", weight: 0.4, cat: "gunmod" },
  // Gun attachments (gunmods.js ATTACH has what each does and which guns it fits; it explains the numbers): fitted to a
  // gun in the inventory (item.mods), they ride on it, weigh and are worth what they are with it, and are sold and
  // looted with it. Loose, they are carried like any small thing.
  reddot:     { name: "Red dot sight",            slot: "pack",   skill: null,       power: 0,   req: 0, value: 22, noise: 0, small: true, weight: 0.2, cat: "gunmod", desc: "A battery reflex sight: put the dot on them and squeeze. +4 aim. Fits pistols, the .357 (on rings), the shotguns (the double and over-unders on rings), the lever-action, the AR-15 family, a Kalashnikov and the submachine gun." },
  holo:       { name: "Holographic sight",        slot: "pack",   skill: null,       power: 0,   req: 0, value: 35, noise: 0, small: true, weight: 0.35, cat: "gunmod", desc: "A military holo sight with a wide window, quick on a moving target: +5 aim, +3 more up close. Fits the pump shotgun, the police carbine and the assault rifle." },
  scope4x:    { name: "4× rifle scope",           slot: "pack",   skill: null,       power: 0,   req: 0, value: 40, noise: 0, small: true, weight: 0.6, cat: "gunmod", desc: "A fixed 4× scope on rings: +3 tiles of best range and less aim lost beyond it, but −8 up close. Fits the lever-action, the .22 rifle, the single-shots, a revolver (a long-eye-relief scope), the AR-15 family and a Kalashnikov (the hunting rifle has its own)." },
  laser:      { name: "Laser sight",              slot: "pack",   skill: null,       power: 0,   req: 0, value: 20, noise: 0, small: true, weight: 0.1, cat: "gunmod", desc: "A rail laser under the barrel (on a revolver or a 1911, a laser grip): +6 aim within 2.5 tiles, +1 beyond. Fits any gun with a light / laser slot." },
  foregrip:   { name: "Vertical foregrip",        slot: "pack",   skill: null,       power: 0,   req: 0, value: 12, noise: 0, small: true, weight: 0.15, cat: "gunmod", desc: "A grip under the handguard to hold the muzzle down: +2 aim, +2 more up close. Fits the AR-15 family, a rail handguard, the .45 SMG and the police pump's railed fore-end. Not a pistol, a revolver, a hunting gun or a plain pump." },
  bipod:      { name: "Bipod",                    slot: "pack",   skill: null,       power: 0,   req: 0, value: 18, noise: 0, small: true, weight: 0.4, cat: "gunmod", desc: "Folding legs under a rifle: +8 aim when the gun rests on half cover right next to the shooter that the shot's line crosses (sandbags, crates, a car, a fence, a window sill). Fits bolt-action, lever-action, AR-15, AR-10 and .22 rifles, and any rifle with a quad rail." },
  pistolcan:  { name: "9mm suppressor",           slot: "pack",   skill: null,       power: 0,   req: 0, value: 45, noise: 0, small: true, weight: 0.25, cat: "gunmod", desc: "A real can for a threaded 9mm barrel: shots a third as loud (far fewer hear them, a third of the Heat), at a little damage (×0.95) and a tile of range. Lasts. Fits the 9mm pistol only." },
  riflecan:   { name: "Rifle suppressor",         slot: "pack",   skill: null,       power: 0,   req: 0, value: 60, noise: 0, small: true, weight: 0.55, cat: "gunmod", desc: "A rifle-calibre suppressor: shots 40% as loud (far fewer hear them, less Heat, a hunt draws less), at a little damage (×0.95) and a tile of range. Lasts. Fits the hunting rifle, the lever-action, the police carbine and the assault rifle." },
  brake:      { name: "Muzzle brake",             slot: "pack",   skill: null,       power: 0,   req: 0, value: 18, noise: 0, small: true, weight: 0.15, cat: "gunmod", desc: "Vents the gas sideways and the rifle stays on target: +3 aim, but every shot is 30% louder. Fits the hunting rifle, the lever-action, the police carbine and the assault rifle." },
  comp:       { name: "Pistol compensator",       slot: "pack",   skill: null,       power: 0,   req: 0, value: 14, noise: 0, small: true, weight: 0.1, cat: "gunmod", desc: "A ported muzzle weight against the kick: +2 aim, shots 15% louder. Fits the 9mm and the .357." },
  choke:      { name: "Shotgun choke",            slot: "pack",   skill: null,       power: 0,   req: 0, value: 12, noise: 0, small: true, weight: 0.05, cat: "gunmod", desc: "A full choke tube: a tighter pattern that reaches further (+2 tiles best range, less aim lost beyond it) but spreads less up close (−4). Fits the pump shotgun." },
  extmag:     { name: "Extended pistol magazine", slot: "pack",   skill: null,       power: 0,   req: 0, value: 14, noise: 0, small: true, weight: 0.15, cat: "gunmod", desc: "A long 9mm magazine: 24 rounds instead of 15. Fits the 9mm pistol." },
  drum:       { name: "Drum magazine",            slot: "pack",   skill: null,       power: 0,   req: 0, value: 38, noise: 0, small: true, weight: 1.1, cat: "gunmod", desc: "A 60-round drum: twice the rounds before a reload, but heavy and clumsy (−2 aim). Fits the police carbine and the assault rifle." },
  tubeext:    { name: "Shotgun tube extension",   slot: "pack",   skill: null,       power: 0,   req: 0, value: 14, noise: 0, small: true, weight: 0.25, cat: "gunmod", desc: "A longer magazine tube: two more shells in a pump or semi-auto shotgun." },
  bottle:     { name: "Empty bottle",             slot: "pack",   skill: null,       power: 0,   req: 0, value: 1,  noise: 0, small: true, throw: "bottle", desc: "Thrown (up to 7 tiles), it smashes and pulls unaware guards and the dead within 6 tiles to look. One use.", weight: 0.4, cat: "explosive" },
  noisemaker: { name: "Noise maker",              slot: "pack",   skill: null,       power: 0,   req: 0, value: 3,  noise: 0, small: true, makeshift: true, throw: "noisemaker", desc: "A wind-up kitchen timer taped to a bell. Thrown (up to 7 tiles), it rings for 3 turns: everything unaware within 8 tiles goes to look, and the dead that follow noise turn toward it even when they have seen you. One use.", weight: 0.3, cat: "explosive" },
  firecracker:{ name: "String of firecrackers",   slot: "pack",   skill: null,       power: 0,   req: 0, value: 4,  noise: 0, small: true, throw: "firecracker", desc: "Thrown (up to 8 tiles), the bangs go on for 2 turns: everything unaware within 13 tiles goes to look and the dead that follow noise are pulled off whoever they were after, but a raid's Heat jumps 6. One use.", weight: 0.2, cat: "explosive" },
  // Books (skills.js): read on the Read role at a base from a copy in its armory. book.skill = what it teaches (4 XP an
  // hour, only while the skill is below book.max), book.hours = time to finish it; mood books give book.mood an hour.
  // Not worn: carried in a pack slot or the team's cargo, kept in the armory. Found at fitting sites, sold by traders.
  medbook:     { burnShare: 1, name: "Field Medicine Handbook",    slot: "pack", skill: null, power: 0, req: 0, value: 25, noise: 0, book: { skill: "medicine", max: 8, hours: 30 }, desc: "A paramedic's handbook: dressings, splints, fevers. Teaches Medicine up to 8.", weight: 0.6, cat: "books" },
  surgerybook: { burnShare: 1, name: "Emergency Surgery",          slot: "pack", skill: null, power: 0, req: 0, value: 60, noise: 0, book: { skill: "medicine", max: 14, hours: 50 }, desc: "A trauma surgery textbook. Teaches Medicine up to 14.", weight: 1.5, cat: "books" },
  enginebook:  { burnShare: 1, name: "Small Engine Repair",        slot: "pack", skill: null, power: 0, req: 0, value: 30, noise: 0, book: { skill: "mechanics", max: 10, hours: 40 }, desc: "Pumps, generators, outboard motors. Teaches Mechanics up to 10.", weight: 0.8, cat: "books" },
  gardenbook:  { burnShare: 1, name: "Gardening Through the Seasons", slot: "pack", skill: null, power: 0, req: 0, value: 20, noise: 0, book: { skill: "farming", max: 8, hours: 30 }, desc: "Sowing calendars, soil and saving seed. Teaches Farming up to 8.", weight: 0.6, cat: "books" },
  gunbook:     { burnShare: 1, name: "Marksmanship Manual",        slot: "pack", skill: null, power: 0, req: 0, value: 30, noise: 0, book: { skill: "shooting", max: 9, hours: 30 }, desc: "Breathing, trigger control, zeroing a sight. Teaches Shooting up to 9.", weight: 0.5, cat: "books" },
  armymanual:  { burnShare: 1, name: "Army Field Manual",          slot: "pack", skill: null, power: 0, req: 0, value: 55, noise: 0, book: { skill: "shooting", max: 13, hours: 45 }, desc: "Rifle marksmanship and fire and movement. Teaches Shooting up to 13.", weight: 0.6, cat: "books" },
  survivalbook:{ burnShare: 1, name: "Wilderness Survival",        slot: "pack", skill: null, power: 0, req: 0, value: 20, noise: 0, book: { skill: "scouting", max: 8, hours: 30 }, desc: "Maps, tracks, reading the land. Teaches Scouting up to 8.", weight: 0.5, cat: "books" },
  talkbook:    { burnShare: 1, name: "Negotiation 101",            slot: "pack", skill: null, power: 0, req: 0, value: 20, noise: 0, book: { skill: "speech", max: 8, hours: 30 }, desc: "Getting to yes, with people who have guns. Teaches Speech up to 8.", weight: 0.4, cat: "books" },
  lockbook:    { burnShare: 1, name: "Lockpicking for Locksmiths", slot: "pack", skill: null, power: 0, req: 0, value: 25, noise: 0, book: { skill: "stealth", max: 8, hours: 30 }, desc: "Pins, tension and patience: moving quietly through locked places. Teaches Stealth up to 8.", weight: 0.4, cat: "books" },
  leadbook:    { burnShare: 1, name: "Leading Small Teams",        slot: "pack", skill: null, power: 0, req: 0, value: 25, noise: 0, book: { skill: "leadership", max: 8, hours: 30 }, desc: "An NCO's guide to keeping people together. Teaches Leadership up to 8.", weight: 0.4, cat: "books" },
  scavbook:    { burnShare: 1, name: "Salvage Yard Secrets",       slot: "pack", skill: null, power: 0, req: 0, value: 20, noise: 0, book: { skill: "scavenging", max: 8, hours: 30 }, desc: "Where the good stuff hides in a wreck. Teaches Scavenging up to 8.", weight: 0.5, cat: "books" },
  comic:       { burnShare: 1, name: "Stack of comic books",       slot: "pack", skill: null, power: 0, req: 0, value: 4,  noise: 0, book: { mood: 3, hours: 4 }, desc: "Capes and explosions. +3 mood an hour read (a third of that read again). Teaches nothing.", weight: 0.3, cat: "luxury" },
  novel:       { burnShare: 1, name: "Paperback novel",            slot: "pack", skill: null, power: 0, req: 0, value: 3,  noise: 0, book: { mood: 2, hours: 8 }, desc: "A dog-eared thriller. +2 mood an hour read (a third of that read again). Teaches nothing.", weight: 0.3, cat: "luxury" },
  // A bicycle found on a search is cargo (bulky: no pocket or pack). At one of your bases it joins the bikes parked
  // there (vehicles.js parkBikes): a team can ride out on bikes, one per person.
  bicycle:     { name: "Bicycle",                  slot: "cargo", skill: null, power: 0, req: 0, value: 25, noise: 0, bulky: true, desc: "A mountain bike that still rolls. Carried home as cargo, it joins the bikes at the base: teams can ride out on bikes (one each), faster on roads, no fuel, and the rack takes some of the load.", weight: 12, cat: "vehicle" },

  // Valuables: goods kept for trade (valuation.js), light for their worth.
  goldring:    { name: "Gold ring",                  slot: "pack", skill: null, power: 0, req: 0, value: 30, noise: 0, small: true, weight: 0.05, valuable: true, cat: "jewelry", desc: "A wedding band. Worth nothing to eat, a lot to the right buyer." },
  cigarettes:  { name: "Carton of cigarettes",       slot: "pack", skill: null, power: 0, req: 0, value: 14, noise: 0, small: true, weight: 0.3, valuable: true, cat: "smokes", desc: "Ten sealed packs. The closest thing to money left." },
  whiskey:     { name: "Bottle of whiskey",          slot: "pack", skill: null, power: 0, req: 0, value: 16, noise: 0, weight: 0.8, valuable: true, cat: "liquor", use: { mood: 12, buzz: { days: 1, work: 0.85, aim: -10, mood: -2, label: "Hungover" } }, useVerb: "drinks", desc: "Unopened bourbon. Raiders love it; zealots will not touch it. Drunk: +12 mood, then a day hungover (work −15%, aim −10, −2 mood)." },
  coffee:      { name: "Tin of coffee",              slot: "pack", skill: null, power: 0, req: 0, value: 12, noise: 0, small: true, weight: 0.4, valuable: true, cat: "treats", desc: "Real ground coffee, still sealed." },
  batteries:   { name: "Pack of batteries",          slot: "pack", skill: null, power: 0, req: 0, value: 9,  noise: 0, small: true, weight: 0.2, valuable: true, cat: "household", desc: "AA cells in the blister pack. Every radio and flashlight wants them." },
  // The rest of the valuables: one set per CATEGORIES valuable family. Light for their worth and no use but trade
  // (where they turn up: loot.js SITE_FINDS / AREA_FINDS, bodies, merchants).
  goldchain:   { name: "Gold chain",                 slot: "pack", skill: null, power: 0, req: 0, value: 40, noise: 0, small: true, weight: 0.05, valuable: true, cat: "jewelry", desc: "Thick enough to show off. Raiders and traders both want it." },
  watch:       { name: "Luxury wristwatch",          slot: "pack", skill: null, power: 0, req: 0, value: 45, noise: 0, small: true, weight: 0.1, valuable: true, cat: "jewelry", desc: "Swiss, self-winding, still ticking. Time is the one thing nobody is short of." },
  diamond:     { name: "Diamond ring",               slot: "pack", skill: null, power: 0, req: 0, value: 70, noise: 0, small: true, weight: 0.02, valuable: true, cat: "jewelry", desc: "An engagement ring from a jeweller's tray. The rarest thing in the ruins, and the least useful." },
  pearls:      { name: "Pearl necklace",             slot: "pack", skill: null, power: 0, req: 0, value: 30, noise: 0, small: true, weight: 0.06, valuable: true, cat: "jewelry", desc: "Real ones, from a dresser drawer." },
  silverware:  { name: "Silver cutlery",             slot: "pack", skill: null, power: 0, req: 0, value: 22, noise: 0, weight: 1.2, valuable: true, cat: "jewelry", desc: "Grandmother's sterling set in a velvet case. Heavy for a valuable." },
  cigars:      { name: "Box of cigars",              slot: "pack", skill: null, power: 0, req: 0, value: 20, noise: 0, weight: 0.4, valuable: true, cat: "smokes", desc: "Hand-rolled, in a cedar box. A boss's gift." },
  tobacco:     { name: "Pouch of rolling tobacco",   slot: "pack", skill: null, power: 0, req: 0, value: 7,  noise: 0, small: true, weight: 0.1, valuable: true, cat: "smokes", use: { mood: 4, hp: -1 }, useVerb: "smokes", desc: "Loose tobacco and papers. Small change in any camp. Smoked: +4 mood, −1 health." },
  wine:        { name: "Bottle of red wine",         slot: "pack", skill: null, power: 0, req: 0, value: 10, noise: 0, weight: 1, valuable: true, cat: "liquor", use: { mood: 8, buzz: { days: 1, work: 0.95, mood: -1, label: "Groggy" } }, useVerb: "drinks", desc: "A decent vintage, corked. Worth more sealed than drunk. Drunk: +8 mood, then a groggy day (work −5%, −1 mood)." },
  scotch:      { name: "Single malt scotch",         slot: "pack", skill: null, power: 0, req: 0, value: 30, noise: 0, weight: 1, valuable: true, cat: "liquor", desc: "Eighteen years old, in a presentation tube. A collector's bottle." },
  tea:         { name: "Box of tea",                 slot: "pack", skill: null, power: 0, req: 0, value: 6,  noise: 0, small: true, weight: 0.2, valuable: true, cat: "treats", desc: "Black tea in foil sachets." },
  candy:       { name: "Bag of hard candy",          slot: "pack", skill: null, power: 0, req: 0, value: 5,  noise: 0, small: true, weight: 0.3, valuable: true, cat: "treats", use: { mood: 4 }, useVerb: "eats", desc: "Sugar that keeps forever. Communes trade it for real food. Eaten: +4 mood." },
  honey:       { name: "Jar of honey",               slot: "pack", skill: null, power: 0, req: 0, value: 8,  noise: 0, weight: 0.5, valuable: true, cat: "treats", desc: "Never spoils. A farm stall label on the lid." },
  phone:       { name: "Smartphone",                 slot: "pack", skill: null, power: 0, req: 0, value: 10, noise: 0, small: true, weight: 0.2, valuable: true, cat: "gadgets", desc: "No network, no use, but traders still pay for the screen and the parts." },
  console:     { name: "Handheld game console",      slot: "pack", skill: null, power: 0, req: 0, value: 16, noise: 0, small: true, weight: 0.4, valuable: true, cat: "gadgets", desc: "A few games loaded. Somebody's whole childhood." },
  camera:      { name: "Digital camera",             slot: "pack", skill: null, power: 0, req: 0, value: 20, noise: 0, small: true, weight: 0.5, valuable: true, cat: "gadgets", desc: "A good lens and a full memory card." },
  laptop:      { name: "Laptop",                     slot: "pack", skill: null, power: 0, req: 0, value: 30, noise: 0, weight: 2, valuable: true, cat: "gadgets", desc: "Heavy, and useless without power, but the military and traders pay for it." },
  coins:       { name: "Roll of silver coins",       slot: "pack", skill: null, power: 0, req: 0, value: 35, noise: 0, small: true, weight: 0.3, valuable: true, cat: "collectibles", desc: "Bullion rounds in a paper roll. Old-world money that some still trust." },
  tcards:      { name: "Binder of trading cards",    slot: "pack", skill: null, power: 0, req: 0, value: 14, noise: 0, weight: 0.8, valuable: true, cat: "collectibles", desc: "Rare cards in plastic sleeves. Collectors are still out there." },
  vinyl:       { name: "Vinyl records",              slot: "pack", skill: null, power: 0, req: 0, value: 12, noise: 0, weight: 1.5, valuable: true, cat: "collectibles", desc: "A crate's worth of first pressings, wrapped in a towel." },
  stamps:      { name: "Stamp album",                slot: "pack", skill: null, power: 0, req: 0, value: 12, noise: 0, weight: 0.5, valuable: true, cat: "collectibles", desc: "A lifetime of stamps, sorted by country." },
  lighters:    { name: "Pack of lighters",           slot: "pack", skill: null, power: 0, req: 0, value: 5,  noise: 0, small: true, weight: 0.1, valuable: true, cat: "household", desc: "Five disposable lighters on a card. Every camp wants fire." },
  toiletpaper: { burnShare: 1, name: "Toilet paper",               slot: "pack", skill: null, power: 0, req: 0, value: 4,  noise: 0, weight: 0.6, valuable: true, cat: "household", desc: "A sealed four-pack. A luxury now." },
  soap:        { name: "Bars of soap",               slot: "pack", skill: null, power: 0, req: 0, value: 10, noise: 0, small: true, weight: 0.4, groom: 0.4, dur: 40, cat: "toiletries", desc: "Hotel soap and a few big bars. A proper wash, even from a bucket: +0.4 mood a day for whoever uses it, about forty days in the lot." },
  razors:      { name: "Razor blades",               slot: "pack", skill: null, power: 0, req: 0, value: 10, noise: 0, small: true, weight: 0.1, groom: 0.3, dur: 60, cat: "toiletries", desc: "A dispenser of safety-razor blades. A clean shave, or at least a tidy one: +0.3 mood a day for whoever uses them, two months of blades." },
  candles:     { burnShare: 1, name: "Candles",                    slot: "pack", skill: null, power: 0, req: 0, value: 4,  noise: 0, weight: 0.6, valuable: true, cat: "household", desc: "Church candles and tea lights." },

  // More weapons (combat.js WEAPONS has their battle numbers). pry: forces locks in a raid like the crowbar
  // (locks.js); a club is good for takedowns (stealth.js CLUB).
  bat:         { name: "Baseball bat",             slot: "weapon", skill: "shooting", power: 1.6, req: 0, value: 6,  noise: 0, weight: 1, cat: "melee", desc: "Aluminium, from a school locker. A club: good for knocking people out (takedowns +20). Hammer nails into it for a nail bat (crafting)." },
  nailbat:     { burnShare: 0.8, name: "Nail bat",                 slot: "weapon", skill: "shooting", power: 2.1, req: 0, value: 8,  noise: 0, makeshift: true, dur: 16, weight: 1.2, cat: "melee", desc: "A baseball bat driven full of nails. Hits like a truck until the wood splits." },
  prybar:      { name: "Crowbar",                  slot: "weapon", skill: "shooting", power: 1.8, req: 0, value: 8,  noise: 0, pry: true, weight: 2, cat: "melee", desc: "Forged steel. A weapon in the hands, and anyone who carries it can force locks in a raid (no picking: that needs the crowbar and lockpicks)." },
  fireaxe:     { name: "Fire axe",                 slot: "weapon", skill: "shooting", power: 2.4, req: 0, value: 16, noise: 0, pry: true, weight: 2.7, cat: "melee", desc: "Red-handled, from a fire station or a glass case in a hallway. Splits skulls, and doors: it forces locks in a raid." },
  sledge:      { name: "Sledgehammer",             slot: "weapon", skill: "shooting", power: 2.6, req: 2, value: 14, noise: 0, pry: true, weight: 5, cat: "melee", desc: "Ten pounds of steel on a hickory handle. Crushing but slow to swing (−10 to hit in melee) and heavy to carry; it smashes locks open in a raid." },
  baton:       { name: "Police baton",             slot: "weapon", skill: "shooting", power: 1.3, req: 0, value: 6,  noise: 0, small: true, weight: 0.6, cat: "melee", desc: "An expandable steel baton. Light enough for a pocket, and a club: good for takedowns (+20)." },
  compbow:     { name: "Compound bow",             slot: "weapon", skill: "shooting", power: 3.2, req: 4, value: 40, noise: 0, weight: 2, cat: "bow", desc: "Pulleys and a 60 lb draw. Silent; shoots arrows (1 a shot, never ammo; with none it is a club). After a won fight about half the arrows shot are picked up again; hunting loses some. Needs Shooting 4 for full use." },
  xbow:        { name: "Hunting crossbow",         slot: "weapon", skill: "shooting", power: 3.8, req: 3, value: 50, noise: 0, weight: 3.5, cat: "bow", desc: "A scoped hunting crossbow: hits hard and silent; shoots bolts (arrows, 1 a shot, never ammo; with none it is a club). After a won fight about half the bolts shot are picked up again; hunting loses some. Heavy. Needs Shooting 3." },
  revolver:    { name: ".357 revolver",            slot: "weapon", skill: "shooting", power: 3.5, req: 3, value: 34, noise: 3, small: true, weight: 1.2, cat: "pistol", desc: "Six rounds, a kick and a bang: hits harder than a 9mm but louder. Takes a scope on rings, a pistol-calibre can or a compensator, grips and a laser grip (no foregrip, no stock). Needs Shooting 3." },
  leverrifle:  { name: "Lever-action rifle",       slot: "weapon", skill: "shooting", power: 4.5, req: 4, value: 45, noise: 3, weight: 3.4, cat: "rifle", desc: "A ranch rifle with eight in the tube: accurate at range, lighter and handier than a bolt-action hunting rifle. Needs Shooting 4." },
  carbine:     { name: "Police carbine",           slot: "weapon", skill: "shooting", power: 6.5, req: 8, value: 95, noise: 3, weight: 3, cat: "rifle", desc: "A semi-automatic patrol rifle from a squad-car rack: quick, accurate follow-up shots, one round a shot, 30 in the magazine. Needs Shooting 8." },
  // Police gear.
  riotarms:    { name: "Riot arm guards",          slot: "arms",   skill: null, power: 0.9, req: 0, value: 14, noise: 0, desc: "Hard-shell police forearm guards. Bites skid off.", weight: 1.2, cat: "armor" },
  riotlegs:    { name: "Riot leg guards",          slot: "legs",   skill: null, power: 0.8, req: 0, value: 12, noise: 0, desc: "Police shin and thigh guards.", weight: 1.4, cat: "armor" },
  cuffs:       { name: "Handcuffs",                slot: "pack",   skill: null, power: 0, req: 0, value: 5,  noise: 0, small: true, cuffs: true, weight: 0.2, cat: "tools", desc: "Steel cuffs, no key needed to close them. Carried in a battle, tying up someone knocked out takes no action (the cuffs stay on them)." },
  // Packs (inventory.js, load.js): slots, carry (kg of max load), ease (share of the load that does not count for
  // the wearer's load band). searchHeat: × a search's Heat for a team with one (scavenge.js).
  slingbag:    { burnShare: 0.5, name: "Sling bag",                slot: "backpack", skill: null, power: 1, req: 0, value: 6,  noise: 0, carry: 3, slots: 3, desc: "A small cross-body bag: 3 pack slots and +3 kg max load.", weight: 0.5, cat: "packs" },
  hikingpack:  { name: "Hiking pack",              slot: "backpack", skill: null, power: 1, req: 0, value: 30, noise: 0, carry: 14, slots: 10, ease: 0.08, searchHeat: 1.05, desc: "A 60-litre trekking pack: 10 pack slots, +14 kg max load, and a hip belt (the wearer's load counts 8% lighter). Bright nylon and clinking buckles: a searching team with one makes 5% more Heat.", weight: 2.5, cat: "packs" },
  // A prepper's go-bag (hardcore-start.js: one of the three starts with it packed). More room than a hiking pack, but a
  // duffle hangs off one shoulder: no belt or frame (ease 0), and it swings about on a search like the hiking pack does.
  duffle:      { burnShare: 0.5, name: "Duffle bag",               slot: "backpack", skill: null, power: 1, req: 0, value: 24, noise: 0, carry: 16, slots: 12, searchHeat: 1.05, desc: "A big canvas duffle: 12 pack slots and +16 kg max load, carried on one shoulder (no belt, so none of the load is spared the wearer). It swings and clinks: a searching team with one makes 5% more Heat.", weight: 1.5, cat: "packs" },
  rucksack:    { name: "Frame rucksack",           slot: "backpack", skill: null, power: 1, req: 0, value: 55, noise: 0, carry: 18, slots: 14, ease: 0.2, desc: "An external-frame military rucksack: 14 pack slots, +18 kg max load, and the frame carries the weight (the wearer's load counts 20% lighter).", weight: 3.5, cat: "packs" },
  // Throwables in battle (stealth.js THROWABLES: throw = the key). One use each, from a pocket, the pack, the team's
  // cargo or the base armory.
  pipebomb:    { name: "Pipe bomb",                slot: "pack", skill: null, power: 0, req: 0, value: 15, noise: 0, small: true, throw: "pipebomb", desc: "Thrown (up to 6 tiles, over walls too: it lands where you or a teammate can see, give or take a tile by your aim), it blows up: 22–34 damage to everyone within a tile of where it lands, yours too; crates, fences, sandbags and barricades there are blown apart and a door, the gate or a wall section takes 40–60. The bang wakes everything within 14 tiles (a raid's Heat +10). One use.", weight: 0.6, cat: "explosive" },
  molotov:     { name: "Molotov cocktail",         slot: "pack", skill: null, power: 0, req: 0, value: 8,  noise: 0, small: true, throw: "molotov", desc: "A bottle of fuel with a burning rag. Thrown (up to 6 tiles), it sets a 3 × 3 patch on fire for 2–3 turns: 12–18 damage to whoever is there; the dead walk into the flames (they follow light and heat) and burn 16–24 a turn, people 8–14, and the raiders' AI walks around it. Fire spreads to grass, hay, crates and wooden barricades nearby and its smoke blocks sight. Three of them set a hive on fire. One use.", weight: 0.9, cat: "explosive" },
  flare:       { name: "Road flare",               slot: "pack", skill: null, power: 0, req: 0, value: 4,  noise: 0, small: true, throw: "flare", desc: "Thrown (up to 8 tiles), it burns red for 4 turns: light and heat that pull the dead within 10 tiles that follow either (even those that have seen you, unless a Shepherd leads them), and at night your people see anything within 5 tiles of it and aim at it better (+10). One use.", weight: 0.2, cat: "explosive" },
  smokegren:   { name: "Smoke grenade",            slot: "pack", skill: null, power: 0, req: 0, value: 18, noise: 0, small: true, throw: "smokegren", desc: "Thrown (up to 7 tiles): a thick cloud 2 tiles around for 3 turns. Shots into or out of it are −30 to hit, and anyone in it or within 2 tiles of it gets away more easily when the retreat is sounded (+20). One use.", weight: 0.4, cat: "explosive" },
  flashbang:   { name: "Flashbang",                slot: "pack", skill: null, power: 0, req: 0, value: 20, noise: 0, small: true, throw: "flashbang", desc: "Thrown (up to 7 tiles): a deafening bang and a blinding flash. People within 2 tiles of it who see it (1 tile through a doorway) lose an action next turn (2 within a tile), aim −30 until their next turn ends and cannot overwatch; those facing away are only dazed (aim −15). The dead are not blinded but come to the noise. Barely hurts (0–3 right next to it), breaks no cover. Very loud: wakes everyone around and raises Heat. Good for clearing a room through the door. One use.", weight: 0.4, cat: "explosive" },
  gamecall:    { name: "Deer call",                slot: "pack", skill: null, power: 0, req: 0, value: 5,  noise: 0, small: true, throw: "gamecall", desc: "A hunter's grunt call. Blown (1 action, not used up), it pulls unaware guards and the dead within 7 tiles to look where you are: lure a lone guard into a takedown.", weight: 0.1, cat: "camp" },
  // Siege kit (siege.js): a frag grenade thrown over the walls, a ladder up them and a ram for the gate. Bulky: the
  // team's cargo or the base armory; raiders bring their own by how prepared they are (eras.js).
  frag:        { name: "Frag grenade",             slot: "pack", skill: null, power: 0, req: 0, value: 22, noise: 0, small: true, throw: "frag", desc: "A military fragmentation grenade. Thrown (up to 8 tiles, over walls too: it lands where you or a teammate can see, give or take a tile by your aim), it bursts: 20–30 damage to everyone within a tile of where it lands, yours too, and blows apart light cover there (crates, fences, sandbags, barricades); a door or the gate takes 30–45. One use.", weight: 0.45, cat: "explosive" },
  ladder:      { burnShare: 1, name: "Siege ladder",             slot: "pack", skill: null, power: 0, req: 0, value: 10, noise: 0, bulky: true, makeshift: true, siege: "ladder", desc: "Two poles and lashed rungs. Carried into a battle at walls (it slows the one carrying it by a tile an action), it is set against a wall section in one action from the foot of it: then anyone can climb onto the walkway (a climb, and exposed while on it). Defenders on the walkway can push it off. Team cargo only.", weight: 9, cat: "tools" },
  ram:         { name: "Battering ram",            slot: "pack", skill: null, power: 0, req: 0, value: 20, noise: 0, bulky: true, makeshift: true, siege: "ram", desc: "A steel-capped log with rope handles. Two or three carry it at a walk (3 tiles an action) and smash a barred gate or door: 16–24 damage per carrier each turn. The carriers cannot shoot or take cover. Team cargo only.", weight: 30, cat: "tools" },
  // Decoys (decoys.js): what the dead follow. Noise: an alarm clock, a radio; heat: hand warmers, a heat pack. They
  // pull the dead that sense them even after they have seen you (not a Shepherd's pack); people are not fooled.
  alarmclock:  { name: "Wind-up alarm clock",      slot: "pack", skill: null, power: 0, req: 0, value: 3,  noise: 0, small: true, throw: "alarmclock", desc: "A brass double-bell clock. Thrown (up to 7 tiles), it rings for 5 turns: the dead within 10 tiles that follow noise go to it, even those already after you. People who hear it look to where it was thrown from. Kept in a base's armory, decoys can pull a coming horde off (the horde warning). One use.", weight: 0.4, cat: "explosive" },
  pocketradio: { name: "Pocket radio",             slot: "pack", skill: null, power: 0, req: 0, value: 6,  noise: 0, small: true, throw: "pocketradio", desc: "A transistor radio turned up full on static and old songs. Thrown (up to 6 tiles), it plays for 6 turns: the dead within 12 tiles that follow noise go to it. People who hear it look to where it was thrown from. One use.", weight: 0.3, cat: "explosive" },
  handwarmer:  { name: "Hand warmers",             slot: "pack", skill: null, power: 0, req: 0, value: 2,  noise: 0, small: true, throw: "handwarmer", desc: "A pair of air-activated warmers. Thrown (up to 7 tiles), they glow warm for 6 turns: the dead within 5 tiles that hunt by heat (crawlers) crawl to them. Silent. One use.", weight: 0.1, cat: "explosive" },
  heatpack:    { name: "Chemical heat pack",       slot: "pack", skill: null, power: 0, req: 0, value: 4,  noise: 0, small: true, throw: "heatpack", desc: "A big first-aid heat pack, cracked and shaken. Thrown (up to 7 tiles), it burns hot for 8 turns: the dead within 7 tiles that hunt by heat go to it. Silent. One use.", weight: 0.3, cat: "explosive" },
  // Base defences (defences.js): kept in a base's armory they count when a horde comes, and they are laid out on
  // the battle map if the dead break in.
  barbedwire:  { name: "Roll of barbed wire",      slot: "pack", skill: null, power: 0, req: 0, value: 12, noise: 0, bulky: true, defence: { hold: 0.05, max: 3, tear: 1 }, desc: "In a base's armory: strung along the approach, each roll holds back 5% more of a horde (up to 3 rolls), and on the battle map the dead that reach the wire lose the rest of their turn. Every horde attack tears one roll up.", weight: 8, cat: "defence" },
  beartrap:    { name: "Bear trap",                slot: "pack", skill: null, power: 0, req: 0, value: 10, noise: 0, bulky: true, defence: { kill: 3, max: 4, breaks: 0.25 }, desc: "In a base's armory: set on the approach when a horde attacks, each trap catches about 3 of the dead before they reach the walls (up to 4 traps), and the traps are on the battle map (a caught one is hurt and held). A quarter of them break each time.", weight: 6, cat: "defence" },
  tripwire:    { name: "Tripwire alarm",           slot: "pack", skill: null, power: 0, req: 0, value: 3,  noise: 0, small: true, makeshift: true, defence: { alarm: 0.5 }, desc: "Fishing line and a string of tin cans. In a base's armory (one is enough) the cans rattle when the dead come: everyone there counts half on the walls even without a warning. Carried by a team that stays put, trouble is a fifth less likely to catch it (they hear it coming).", weight: 0.5, cat: "defence" },
  sandbags:    { name: "Sandbags",                 slot: "pack", skill: null, power: 0, req: 0, value: 6,  noise: 0, bulky: true, defence: { hold: 0.04, max: 4, cover: 3 }, desc: "A bundle of filled sandbags. In a base's armory each bundle holds back 4% more of a horde (up to 4), and they are stacked as cover on the battle map if the dead break in.", weight: 15, cat: "defence" },
  // Boards and nails (barricade.js; the user's request 2026-10-18): a bundle nailed across a door, a doorway or a
  // window in a fight (Board up, both actions, loud): 40 hit points of boards the dead and raiders must batter
  // through, up to three layers. Crafted from wood and a scrap anywhere (crafting.js), found at hardware stores
  // and farms. One bundle a board-up; torn down again, the boards are spent.
  boards:      { name: "Boards and nails",         slot: "pack", skill: null, power: 0, req: 0, value: 4,  noise: 0, makeshift: true, desc: "Planks split from wood and a handful of nails, tied in a bundle. In a fight, Board up (both actions, from next to it, either side) nails them across a closed door, a doorway or a window: 40 hit points of boards the dead and raiders must batter through (up to three layers), no sight through it, no way through. Loud: the unaware within 6 tiles turn toward the hammering (Heat +3 in a raid). Tear down (both actions) gives the door or window back, and about half the bundles come off whole. One bundle a board-up; a bundle in the team's vehicle counts from next to it. 4 kg, a pack slot.", weight: 4, cat: "defence" },
  // Camp kit against Heat (fieldheat.js, scavenge.js). heat.stay = × Heat gained on the spot (waiting, camping,
  // gathering...), heat.camp = only while camping, heat.search = × a search's Heat; a team counts each kind once.
  // scentmask is used up: 24 hours of cover from one (heat.hours).
  camonet:     { name: "Camo netting",             slot: "pack", skill: null, power: 0, req: 0, value: 18, noise: 0, heat: { stay: 0.75 }, desc: "Military netting thrown over the camp: a team that carries it gains Heat 25% slower while it stays in one place.", weight: 4, cat: "camp" },
  ghillie:     { burnShare: 1, name: "Ghillie wrap",             slot: "pack", skill: null, power: 0, req: 0, value: 10, noise: 0, makeshift: true, heat: { stay: 0.85, search: 0.9 }, desc: "Burlap strips and dried grass sewn onto a poncho: a team with one gains Heat 15% slower while it stays put and 10% slower while it searches.", weight: 1.5, cat: "camp" },
  scentmask:   { name: "Gore scent mask",          slot: "pack", skill: null, power: 0, req: 0, value: 3,  noise: 0, small: true, makeshift: true, heat: { stay: 0.6, search: 0.75, hours: 24 }, desc: "Rags soaked in what is left of the dead, sealed in a jar (or a hunter's cover-scent spray). Smeared on when the team stops or starts a search, the dead stop smelling the living for 24 hours: Heat 40% slower on the spot and 25% slower while searching. Used up.", weight: 0.4, cat: "camp" },
  ragboots:    { burnShare: 1, name: "Rag-wrapped boots",        slot: "pack", skill: null, power: 0, req: 0, value: 2,  noise: 0, small: true, makeshift: true, heat: { search: 0.85, stay: 0.95 }, desc: "Strips of blanket bound around the boots: soft steps. A team with them gains Heat 15% slower while searching and 5% slower on the spot.", weight: 0.5, cat: "camp" },
  // The camp cook pot (cooking.js POT, 2026-10-12, user request "Add a craft to allow cooking small meal types at a camp or
  // any base level"): crafted from scrap by anyone, anywhere.
  cookpot:     { name: "Camp cook pot",            slot: "pack", skill: null, power: 0, req: 0, value: 6,  noise: 0, makeshift: true, desc: "A dented pot, a wire bail and a scrap grill for over a fire. Kept at any base without a Kitchen or a cook fire (in its armory, or carried by someone there), it is a Camp fire station for small meals: simple meals and stew, tended 4 hours a day by whoever cooks best, burning 1 wood an hour. Carried by a team camping at a lit fire, it cooks any fresh food it carries (forage, vegetables, eggs, raw meat and fish) into simple meals, where without one the team can only roast its raw meat.", weight: 1.2, cat: "camp" },
  stove:       { name: "Smokeless stove",          slot: "pack", skill: null, power: 0, req: 0, value: 14, noise: 0, heat: { camp: 0.6 }, desc: "A folding twig stove and a trowel for a Dakota fire hole: hot food with no smoke and little light. A camping team with one gains Heat 40% slower from its fire and cooking.", weight: 1.5, cat: "camp" },
  // Optics (optics.js): carried by anyone on a team (hands, pockets, pack or the cargo), the best one counts, a second
  // one adds a quarter of its bonus. optics.look = × the odds of spotting hidden places and finds (the Survey mission,
  // Look around, a recon's look), reach = tiles further a survey looks well, sight = tiles more the team sees on the
  // map (spots hordes, raiders and sites earlier), spot = + the chance to see the other side first on the road, night /
  // fog = what is left of the dark's and fog's penalty on spotting (1 = no penalty), still = only while the team stays
  // put (surveying, looking around, camping, waiting), base = kept in a base's armory: base.sight more tiles of view
  // around it (base.tower with a watchtower).
  monocular:   { name: "Pocket monocular",         slot: "pack", skill: null, power: 0, req: 0, value: 12, noise: 0, small: true, optics: { look: 1.1, spot: 0.04 }, desc: "An 8×25 hunter's monocular on a lanyard. A little better at picking out a roof in the trees: spotting hidden places and finds ×1.1, and the other side a little sooner on the road.", weight: 0.2, cat: "optics" },
  binoculars:  { name: "Binoculars",               slot: "pack", skill: null, power: 0, req: 0, value: 22, noise: 0, small: true, optics: { look: 1.25, reach: 1, sight: 1, spot: 0.08 }, desc: "Compact 10×42 binoculars, the good all-rounder. Carried by anyone on a team: the team sees a tile further on the map (hordes, raiders and places sooner), spots hidden places and finds ×1.25 and looks a tile further when it surveys, and sees others first more often on the road.", weight: 0.7, cat: "optics" },
  spotscope:   { name: "Spotting scope",           slot: "pack", skill: null, power: 0, req: 0, value: 40, noise: 0, optics: { look: 1.6, reach: 2, sight: 1, spot: 0.05, still: true }, desc: "A 60× hunting scope on a little tripod. Useless on the move, superb from a hilltop: while the team surveys, looks around, camps or waits, it spots hidden places ×1.6 and looks two tiles further. Heavy.", weight: 2.2, cat: "optics" },
  thermal:     { name: "Thermal monocular",        slot: "tool", skill: null, power: 0, req: 0, value: 150, noise: 0, small: true, optics: { look: 1.2, reach: 1, spot: 0.06, night: 0.9, fog: 0.9 }, desc: "A military thermal imager: body heat glows through the dark and the fog. Carried, a team spots hidden places ×1.2 and loses almost nothing to night or fog when it looks; in the off hand in a battle at night it sees like night vision goggles, and on the map at night the team sees a tile around it instead of only its own tile.", weight: 0.5, cat: "optics" },
  telescope:   { name: "Telescope",                slot: "pack", skill: null, power: 0, req: 0, value: 35, noise: 0, bulky: true, optics: { base: { sight: 1, tower: 2 } }, desc: "A stargazer's reflector on a heavy tripod. Kept in a base's armory it watches the country around: +1 tile of view (2 with a watchtower), live, so lookouts see the dead coming and spot places off the map sooner. Too big to take on a trip.", weight: 9, cat: "optics" },
  // Comforts and treats (comforts.js). comfort.team = mood a day for everyone at the base or on the team that has
  // it, comfort.self = for whoever carries it; use = used up for mood now, with an after-effect (buzz).
  cards:       { name: "Deck of playing cards",    slot: "pack", skill: null, power: 0, req: 0, value: 3,  noise: 0, small: true, comfort: { team: 0.4 }, desc: "Dog-eared and a joker short. Card games: +0.4 mood a day for everyone at the base or on the team that has a deck (one is enough).", weight: 0.1, cat: "luxury" },
  harmonica:   { name: "Harmonica",                slot: "pack", skill: null, power: 0, req: 0, value: 6,  noise: 0, small: true, comfort: { team: 0.4 }, desc: "A blues harp in C. A tune at night: +0.4 mood a day for everyone at the base or on the team that has one.", weight: 0.1, cat: "luxury" },
  guitar:      { burnShare: 0.9, name: "Acoustic guitar",          slot: "pack", skill: null, power: 0, req: 0, value: 15, noise: 0, comfort: { team: 1 }, desc: "Six strings, five in tune. Songs by the fire: +1 mood a day for everyone at the base or on the team that has one. Bulky to carry.", weight: 3, cat: "luxury" },
  photos:      { name: "Family photos",            slot: "pack", skill: null, power: 0, req: 0, value: 1,  noise: 0, small: true, comfort: { self: 0.6 }, desc: "Somebody's family at a lake, a birthday, a wedding. Worth nothing in trade, but whoever carries them is reminded life was once normal: +0.6 mood a day.", weight: 0.1, cat: "luxury" },
  chocolate:   { name: "Chocolate bar",            slot: "pack", skill: null, power: 0, req: 0, value: 4,  noise: 0, small: true, use: { mood: 6 }, useVerb: "eats", desc: "A slab of milk chocolate, barely past its date. Eaten: +6 mood.", weight: 0.1, cat: "treats" },
  instcoffee:  { name: "Instant coffee",           slot: "pack", skill: null, power: 0, req: 0, value: 4,  noise: 0, small: true, use: { mood: 4, buzz: { days: 1, work: 1.1, label: "Coffee buzz" } }, useVerb: "drinks", desc: "A jar of freeze-dried granules: a few good cups. Drunk: +4 mood and 10% more work for the day.", weight: 0.2, cat: "treats" },
  smokes:      { name: "Pack of cigarettes",       slot: "pack", skill: null, power: 0, req: 0, value: 4,  noise: 0, small: true, use: { mood: 5, hp: -2 }, useVerb: "smokes", desc: "An opened pack, half full. Smoked: +5 mood, −2 health.", weight: 0.05, cat: "smokes" },
  vodka:       { name: "Bottle of cheap vodka",    slot: "pack", skill: null, power: 0, req: 0, value: 6,  noise: 0, use: { mood: 10, buzz: { days: 1, work: 0.85, aim: -10, mood: -2, label: "Hungover" } }, useVerb: "drinks", desc: "Plastic bottle, already opened: for drinking, not trading. Drunk: +10 mood, then a day hungover (work −15%, aim −10 in battle, −2 mood).", weight: 0.8, cat: "liquor" },
  // Toiletries (comforts.js groomLines): groom = mood a day for whoever uses it, dur = days of use in it. Carried,
  // it is the carrier's own; in a base's armory or a team's cargo it is a shared shelf for everyone there with none
  // of their own, and a shared one is used up a day per person. Each kind counts once; all together at most +1.2.
  // Soap and razor blades (with the household goods above) are toiletries too.
  deodorant:   { name: "Stick of deodorant",       slot: "pack", skill: null, power: 0, req: 0, value: 10, noise: 0, small: true, groom: 0.5, dur: 30, desc: "Half-used, the cap cracked. Nobody smells good any more, but you can smell less bad: +0.5 mood a day for whoever uses it, about a month in the stick.", weight: 0.1, cat: "toiletries" },
  toothpaste:  { name: "Toothbrush and toothpaste", slot: "pack", skill: null, power: 0, req: 0, value: 10, noise: 0, small: true, groom: 0.4, dur: 40, desc: "A travel brush and a squeezed-flat tube. Clean teeth feel like the old world: +0.4 mood a day for whoever uses it.", weight: 0.1, cat: "toiletries" },
  shampoo:     { name: "Bottle of shampoo",        slot: "pack", skill: null, power: 0, req: 0, value: 6,  noise: 0, groom: 0.3, dur: 25, desc: "Two-in-one, smells of fake apples. Washing your hair in a bucket still counts: +0.3 mood a day for whoever uses it.", weight: 0.4, cat: "toiletries" },
  wetwipes:    { name: "Pack of wet wipes",        slot: "pack", skill: null, power: 0, req: 0, value: 3,  noise: 0, small: true, groom: 0.3, dur: 10, desc: "Baby wipes, still damp. A wash on the road: +0.3 mood a day for whoever uses them, ten days to a pack.", weight: 0.2, cat: "toiletries" },
  lipbalm:     { name: "Lip balm",                 slot: "pack", skill: null, power: 0, req: 0, value: 5,  noise: 0, small: true, groom: 0.2, dur: 45, desc: "Cherry flavour. Cracked lips are one less thing: +0.2 mood a day for whoever uses it.", weight: 0.02, cat: "toiletries" },
  makeup:      { name: "Makeup bag",               slot: "pack", skill: null, power: 0, req: 0, value: 12, noise: 0, small: true, groom: 0.4, dur: 50, desc: "Mascara, a compact and a lipstick worn to a stub. Looking like yourself again: +0.4 mood a day for whoever uses it.", weight: 0.3, cat: "toiletries" },
  perfume:     { name: "Bottle of perfume",        slot: "pack", skill: null, power: 0, req: 0, value: 20, noise: 0, small: true, groom: 0.5, dur: 60, desc: "A designer bottle from a department store counter. A spritz and the world is less rotten for a while: +0.5 mood a day for whoever uses it. Traders like it too.", weight: 0.2, cat: "toiletries" },
  magazines:   { burnShare: 1, name: "Stack of magazines",       slot: "pack", skill: null, power: 0, req: 0, value: 2,  noise: 0, book: { mood: 2, hours: 3 }, desc: "Celebrity gossip from another world. +2 mood an hour read (a third of that read again). Teaches nothing.", weight: 0.4, cat: "luxury" },
  puzzlebook:  { burnShare: 1, name: "Crossword book",           slot: "pack", skill: null, power: 0, req: 0, value: 3,  noise: 0, book: { mood: 2, hours: 12 }, desc: "Half the puzzles still blank. +2 mood an hour read, and it lasts. Teaches nothing.", weight: 0.3, cat: "luxury" },
  // ---------- craft books and special crafted gear (blueprints.js CRAFT_BOOKS / BLUEPRINTS, crafting.js CRAFTS) ----------
  // Craft books teach Crafting like any skill book; once anyone has finished one, its recipes are unlocked for good and
  // the recipes it covers come out a little better and faster (blueprints.js craftEdge). Their unlock lines are added
  // to the desc by blueprints.js.
  diybook:      { burnShare: 1, name: "The Complete DIY Manual",  slot: "pack", skill: null, power: 0, req: 0, value: 18, noise: 0, book: { skill: "crafting", max: 7, hours: 24 }, desc: "Fixing, fitting and making do around the house. Teaches Crafting up to 7.", weight: 1, cat: "books" },
  forgebook:    { burnShare: 1, name: "Backyard Blacksmithing",   slot: "pack", skill: null, power: 0, req: 0, value: 40, noise: 0, book: { skill: "crafting", max: 11, hours: 40 }, desc: "Coal forges, quenching and riveting, from a hobbyist press. Teaches Crafting up to 11.", weight: 1.2, cat: "books" },
  bushcraftbook:{ burnShare: 1, name: "Bushcraft Field Guide",    slot: "pack", skill: null, power: 0, req: 0, value: 25, noise: 0, book: { skill: "crafting", max: 9, hours: 30 }, desc: "Cordage, camouflage and camp craft from what the woods give. Teaches Crafting up to 9.", weight: 0.6, cat: "books" },
  // Cookbooks (wave 2 cooking, the user's pick 13; blueprints.js CRAFT_BOOKS cook, cooking.js): they teach Cooking like
  // any skill book, and once read to the end at a base the cooks make their meals below the usual Cooking.
  cookbook:     { burnShare: 1, name: "The Family Cookbook",      slot: "pack", skill: null, power: 0, req: 0, value: 15, noise: 0, book: { skill: "cooking", max: 8, hours: 24 }, desc: "A splattered kitchen standard: soups, stews, roasts and a chapter on bread. Teaches Cooking up to 8.", weight: 0.9, cat: "books" },
  chefbook:     { burnShare: 1, name: "Professional Chef's Handbook", slot: "pack", skill: null, power: 0, req: 0, value: 40, noise: 0, book: { skill: "cooking", max: 14, hours: 40 }, desc: "A culinary-school text: stocks, sauces, butchery and plating for a full dining room. Teaches Cooking up to 14.", weight: 1.6, cat: "books" },
  gamebook:     { burnShare: 1, name: "Wild Game Cookery",        slot: "pack", skill: null, power: 0, req: 0, value: 22, noise: 0, book: { skill: "cooking", max: 10, hours: 30 }, desc: "A hunting lodge's favourite: field dressing, curing, grinding and sausage, and pemmican the old way. Teaches Cooking up to 10.", weight: 0.7, cat: "books" },
  prepbook:     { burnShare: 1, name: "The Prepper's Pantry",     slot: "pack", skill: null, power: 0, req: 0, value: 30, noise: 0, book: { skill: "cooking", max: 8, hours: 24 }, desc: "Long-keeping food: drying, vacuum packing, milling grain, hardtack and trail food. Teaches Cooking up to 8.", weight: 0.6, cat: "books" },
  // Special crafted gear: locked until a craft book is read or a blueprint studied; better than ordinary makeshift
  // gear (still wears out). combat.js WEAPONS has the weapons' battle numbers.
  springmachete:{ name: "Leaf-spring machete",      slot: "weapon", skill: "shooting", power: 2.2, req: 0, value: 18, noise: 0, makeshift: true, dur: 22, desc: "A truck leaf spring forged, quenched and ground into a heavy blade: hits harder than a store-bought machete and keeps its edge a long time.", weight: 1.1, cat: "melee" },
  pulleybow:    { name: "Pulley-limb bow",          slot: "weapon", skill: "shooting", power: 2.9, req: 3, value: 30, noise: 0, makeshift: true, dur: 18, desc: "Laminated limbs with salvaged pulleys: nearly a compound bow. Silent, and in a fight the arrows are picked up again (no ammo); hunting loses some (arrows). Needs Shooting 3.", weight: 1.8, cat: "bow" },
  rivethelmet:  { name: "Riveted scrap helmet",     slot: "head",   skill: null,       power: 1.0, req: 0, value: 16, noise: 0, makeshift: true, dur: 16, desc: "Hammered steel plates riveted over a padded cap, with a nape guard. Better than a motorcycle helmet.", weight: 2, cat: "armor" },
  woodghillie:  { burnShare: 1, name: "Woodland ghillie suit", slot: "pack", skill: null, power: 0, req: 0, value: 22, noise: 0, makeshift: true, heat: { stay: 0.75, search: 0.85 }, desc: "A full suit of netting, jute and local plants, built up layer by layer: a team with one gains Heat 25% slower while it stays put and 15% slower while it searches (with a ghillie wrap too, both count).", weight: 2, cat: "camp" },
  traumakit:    { name: "Field trauma kit",         slot: "tool",   skill: "medicine", power: 2,   req: 4, value: 24, noise: 0, makeshift: true, dur: 8,  medKit: 3, selfStab: true, small: true, desc: "Pressure dressings, a windlass tourniquet, chest seals and splints, packed the army way: +3 Medicine when treating (at a base, in the field or in battle). Needs Medicine 4 for the full bonus. Each treatment uses it up a little. Its tourniquet lets someone down and bleeding stabilize themselves in battle when the kit is in the off hand, a pocket or a rig pouch (60% + 5 a point of Medicine, at most 95%; a use of the kit).", weight: 0.7, cat: "medical" },
  // ---------- end of craft books and special crafted gear ----------
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
  firewood:    { name: "wood", group: "survival" },
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
  optics:      { name: "binoculars and scopes", group: "survival" },
  books:       { name: "books", group: "knowledge", stockBy: "key" },
  manuals:     { name: "manuals and blueprints", group: "knowledge", stockBy: "key" },
  luxury:      { name: "comforts", group: "comforts", fine: true },
  toiletries:  { name: "toiletries", group: "comforts", fine: true },
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
  raider:       { melee: 1.15, pistol: 1.3, shotgun: 1.3, rifle: 1.2, automatic: 1.4, optics: 1.3, explosive: 1.3, gunmod: 1.2, ammo: 1.25, armor: 1.1, fuel: 1.4, vehicle: 1.3,
                  liquor: 1.6, drugs: 1.7, smokes: 1.6, jewelry: 1.5, luxury: 1.15, treats: 1.1, gadgets: 1.1, collectibles: 0.8, household: 0.9, toiletries: 0.7,
                  books: 0.45, manuals: 0.6, farming: 0.5, containers: 0.6, firewood: 0.6 },
  military:     { pistol: 1.2, shotgun: 1.15, rifle: 1.35, automatic: 1.5, optics: 1.5, gunmod: 1.3, explosive: 1.25, ammo: 1.3, armor: 1.35, electronics: 1.5, household: 1.3,
                  gadgets: 1.15, packs: 1.2, medical: 1.15, fuel: 1.15, vehicle: 1.2, manuals: 1.15, smokes: 1.1,
                  melee: 0.7, bow: 0.75, luxury: 0.6, liquor: 0.7, drugs: 0.4, jewelry: 0.7, collectibles: 0.6, farming: 0.7, containers: 0.7, scrap: 0.8, firewood: 0.75 },
  fortress:     { scrap: 1.5, parts: 1.4, defence: 1.6, optics: 1.15, armor: 1.35, tools: 1.3, containers: 1.2, manuals: 1.25, shotgun: 1.1, rifle: 1.1, explosive: 1.1, household: 1.15,
                  camp: 0.9, luxury: 0.75, liquor: 0.8, jewelry: 0.8, collectibles: 0.7, gadgets: 0.8, firewood: 1.2 },
  traders:      { "*": 1.1, margin: 1.1, electronics: 1.2, optics: 1.2, luxury: 1.2, liquor: 1.2, jewelry: 1.3, smokes: 1.25, treats: 1.25, gadgets: 1.3, collectibles: 1.4, household: 1.2,
                  toiletries: 1.2, drugs: 1, scrap: 0.9, firewood: 0.8 },
  commune:      { food: 1.25, water: 1.1, farming: 1.6, medical: 1.3, books: 1.35, manuals: 1.3, tools: 1.25, containers: 1.4, clothing: 1.2, camp: 1.1, treats: 1.35,
                  household: 1.3, toiletries: 1.3, luxury: 1.1, jewelry: 0.6, collectibles: 0.6, gadgets: 0.7, smokes: 0.8, liquor: 0.9, drugs: 0.5,
                  melee: 0.85, pistol: 0.75, shotgun: 0.85, rifle: 0.9, automatic: 0.5, explosive: 0.6, gunmod: 0.6, ammo: 0.8, armor: 0.8, firewood: 1.2 },
  zealot:       { liquor: 0, drugs: 0, smokes: 0, optics: 0.8, jewelry: 0.4, collectibles: 0.5, gadgets: 0.5, luxury: 0.5, books: 0.35, electronics: 0.6, treats: 0.8,
                  medical: 1.4, food: 1.3, water: 1.2, melee: 1.15, bow: 1.1, explosive: 1.2, firewood: 1.1 },
  expansionist: { fuel: 1.5, vehicle: 1.6, optics: 1.25, parts: 1.35, pistol: 1.15, shotgun: 1.2, rifle: 1.25, automatic: 1.35, ammo: 1.2, armor: 1.15, packs: 1.2, electronics: 1.1,
                  camp: 1.15, household: 1.1, jewelry: 1.1, farming: 0.8, luxury: 0.8, books: 0.8, collectibles: 0.8, firewood: 0.9 },
  merchants:    { "*": 1.05, margin: 1.1, food: 1.35, water: 1.3, scrap: 1.4, containers: 1.5, jewelry: 1.3, collectibles: 1.4, gadgets: 1.25, liquor: 1.2, smokes: 1.2,
                  treats: 1.2, household: 1.15, fuel: 0.85, medical: 0.9, ammo: 0.9, firewood: 0.6 },
  explorers:    { food: 1.3, water: 1.3, optics: 1.3, medical: 1.2, packs: 1.25, camp: 1.3, clothing: 1.25, household: 1.2, toiletries: 1.2, treats: 1.1, books: 0.8, jewelry: 0.8, gadgets: 0.7, firewood: 1.2 },
};
// Small valuables traded as goods (where they exist: gold ring, cigarettes, whiskey, coffee, batteries) are light.
for (const [k, w] of Object.entries({ goldring: 0.05, cigarettes: 0.2, whiskey: 1, coffee: 0.5, batteries: 0.2 })) if (GEAR[k]) GEAR[k].weight = w;

// Location types placed on the map, with what they tend to hold. cat = where the type usually stands (the placed
// site's own zone is tile.loc.zone, see SITE_ZONES); danger = extra dead at the site on top of infection
// (0 quiet countryside … 3 hospitals, prisons and military bases); richness = starting loot (urban sites are richer).
// gear = the equipment a search can turn up there (scavenge.js: 7% an hour at full loot); the small finds (valuables,
// comforts, smokes, throwables) are in loot.js SITE_FINDS, and every item's theme tags there (tools/loottest.js).
// The buildings a raid map gets per type are in combat.js (AREA_SETS).
// known = who knew the place before the fall (discovery.js): "public" on every map from day 1 (towns, cities and
// their shops, landmarks, the airport, the National Guard bases, truck stops); "road" public only within 1 tile of a
// road, otherwise hidden until your people see it or hear of it (farms, cabins, lodges, campgrounds, quarries off
// the road network); "secret" always hidden until found (crash sites, wrecks, supply drops).
export const LOCATIONS = {
  town:     { name: "Town",           glyph: "T",  cat: "town",    danger: 1, loot: { food: 3, scrap: 3, meds: 0.4, ammo: 1, fuel: 0.3, jars: 0.5 }, gear: ["knife", "pistol", "shotgun", "sportspads", "bikehelmet", "bicycle", "bat", "revolver", "slingbag", "binoculars", "compact9", "golfclub", "hammer"], richness: 0.6, known: "public" },
  city:     { name: "City center",    glyph: "C",  cat: "urban",   danger: 2, loot: { scrap: 4, meds: 0.6, ammo: 2, parts: 1, food: 1 }, gear: ["pistol", "vest", "shotgun", "bat", "prybar", "revolver", "slingbag", "compact9"], richness: 1.0, known: "public" },
  farm:     { name: "Farmstead",      glyph: "F",  cat: "rural",   danger: 0, loot: { food: 5, fuel: 0.4, scrap: 1, jars: 1, rawwater: 0.5 }, gear: ["huntrifle", "machete", "leverrifle", "shotgun", "sledge", "prybar", "barbedwire", "beartrap", "binoculars", "dewormer", "dbshotgun", "rifle22", "pickaxe", "boards"], richness: 0.5, known: "road" },
  gas:      { name: "Gas station",    glyph: "G",  cat: "town",    danger: 1, loot: { fuel: 4, food: 2, scrap: 1 }, gear: ["pistol", "revolver", "prybar", "flashlight", "compact9"], richness: 0.4, known: "public" },
  mall:     { name: "Mall",           glyph: "M",  cat: "urban",   danger: 2, loot: { food: 3, scrap: 3, meds: 0.4, parts: 1, jars: 0.25 }, gear: ["knife", "machete", "backpack", "bat", "compbow", "slingbag", "hikingpack", "duffle", "stove", "binoculars", "golfclub", "katana", "kukri"], richness: 0.9, known: "public" },
  hospital: { name: "Hospital",       glyph: "+",  cat: "urban",   danger: 3, loot: { meds: 6, scrap: 1, parts: 1 }, gear: ["surgkit", "bandagekit", "fireaxe", "dewormer"], richness: 0.8, known: "public" },
  police:   { name: "Police station", glyph: "P",  cat: "urban",   danger: 2, loot: { ammo: 4, meds: 0.5, scrap: 1 }, gear: ["pistol", "shotgun", "vest", "riothelmet", "bicycle", "baton", "carbine", "riotarms", "riotlegs", "revolver", "binoculars", "pistol45", "semishotgun"], richness: 0.7, known: "public" },
  military: { name: "National Guard base", glyph: "★", cat: "special", danger: 3, loot: { ammo: 5, parts: 2, fuel: 2, meds: 0.6 }, gear: ["ar", "plate", "vest", "riothelmet", "nvg", "milradio", "assaultpack", "rucksack", "carbine", "camonet", "sandbags", "barbedwire", "stove", "binoculars", "spotscope", "thermal", "combatknife", "etool", "tomahawk"], richness: 1.1, known: "public" },
  prison:   { name: "State prison",   glyph: "#",  cat: "special", danger: 3, loot: { food: 2, scrap: 2, ammo: 1 }, gear: ["shotgun", "vest", "riothelmet", "baton", "riotarms", "riotlegs", "carbine", "semishotgun"], richness: 0.7, known: "public" },
  univ:     { name: "University",     glyph: "U",  cat: "urban",   danger: 2, loot: { parts: 3, meds: 1, scrap: 2 }, gear: ["surgkit", "bandagekit", "bat", "fireaxe", "slingbag", "telescope"], richness: 0.8, known: "public" },
  dam:      { name: "Dam and power plant", glyph: "D", cat: "special", danger: 1, loot: { parts: 4, scrap: 3, fuel: 0.3 }, gear: ["sandbags", "prybar", "sledge", "flashlight"], richness: 0.7, known: "public" },
  airport:  { name: "Regional airport", glyph: "A", cat: "special", danger: 2, loot: { fuel: 4, parts: 2, scrap: 2 }, gear: ["pistol", "slingbag", "hikingpack", "backpack", "duffle"], richness: 0.8, known: "public" },
  factory:  { name: "Factory",        glyph: "I",  cat: "special", danger: 1, loot: { scrap: 5, parts: 2, fuel: 0.4 }, gear: ["crowbar", "prybar", "sledge", "barbedwire", "pickaxe", "hammer"], richness: 0.8, known: "public" },
  quarry:   { name: "Quarry",         glyph: "Q",  cat: "rural",   danger: 0, loot: { scrap: 3, fuel: 0.4 }, gear: ["sledge", "prybar", "crowbar", "pickaxe"], richness: 0.4, known: "road" },
  // City blocks: lootier, and more of the dead.
  autoshop:    { name: "Auto shop",          glyph: "Au", cat: "urban", danger: 2, loot: { parts: 4, fuel: 1, scrap: 3 }, gear: ["crowbar", "spikedbat", "kneeguards", "bicycle", "prybar", "sledge", "flashlight", "hammer"], richness: 0.7, known: "public" },
  pharmacy:    { name: "Pharmacy",           glyph: "Rx", cat: "urban", danger: 2, loot: { meds: 6, water: 1, food: 1 }, gear: ["bandagekit", "dewormer"], richness: 0.8, known: "public" },
  supermarket: { name: "Supermarket",        glyph: "S",  cat: "urban", danger: 2, loot: { food: 6, water: 4, meds: 0.4, scrap: 1, preserved: 1.5, jars: 0.5 }, gear: ["knife", "slingbag"], richness: 0.95, known: "public" },
  gunstore:    { name: "Gun store",          glyph: "Gu", cat: "urban", danger: 2, gearRate: 1.8, loot: { ammo: 6, scrap: 1 }, gear: ["pistol", "shotgun", "huntrifle", "vest", "kneeguards", "revolver", "leverrifle", "compbow", "xbow", "ghillie", "camonet", "binoculars", "spotscope", "monocular", "pistol22", "compact9", "pistol45", "rifle22", "dbshotgun", "combatknife", "tomahawk", "kukri"], richness: 0.85, known: "public" },
  hardware:    { name: "Hardware store",     glyph: "H",  cat: "urban", danger: 2, loot: { scrap: 7, parts: 3, fuel: 0.3 }, gear: ["machete", "crowbar", "kneeguards", "flashlight", "bicycle", "prybar", "sledge", "fireaxe", "barbedwire", "beartrap", "sandbags", "binoculars", "hatchet", "hammer", "pickaxe", "boards", "toolbox"], richness: 0.8, known: "public" }, // shops.js: the builder's and the crafter's shop (was scrap 5, parts 2)
  apartments:  { name: "Apartment block",    glyph: "Ap", cat: "urban", danger: 2, loot: { food: 3, water: 2, meds: 0.5, scrap: 2, ammo: 1, jars: 0.5 }, gear: ["knife", "pistol", "bikehelmet", "backpack", "bicycle", "bat", "revolver", "slingbag", "compact9", "hammer", "golfclub"], richness: 0.8, known: "public" },
  office:      { name: "Office tower",       glyph: "O",  cat: "urban", danger: 2, loot: { scrap: 3, water: 2, parts: 1, meds: 0.4 }, gear: ["slingbag", "fireaxe"], richness: 0.6, known: "public" },
  school:      { name: "School",             glyph: "Sc", cat: "urban", danger: 2, loot: { food: 3, water: 2, meds: 0.5, scrap: 2, jars: 0.25 }, gear: ["sportspads", "footballhelmet", "backpack", "bicycle", "bat", "slingbag", "fireaxe"], richness: 0.6, known: "public" },
  firestation: { name: "Fire station",       glyph: "Fs", cat: "urban", danger: 2, loot: { meds: 1.5, fuel: 0.7, parts: 2, scrap: 1 }, gear: ["bikehelmet", "crowbar", "bandagekit", "bicycle", "fireaxe", "prybar", "sandbags"], richness: 0.7, known: "public" },
  warehouse:   { name: "Warehouse district", glyph: "W",  cat: "urban", danger: 2, loot: { scrap: 4, food: 3, parts: 2, fuel: 0.4, jars: 0.5 }, gear: ["crowbar", "prybar", "sledge", "sandbags", "slingbag", "hammer"], richness: 0.9, known: "public" },
  // Small-town shops and services (police stations, auto shops, gas stations and pharmacies stand in towns too).
  grocery:     { name: "Grocery store",      glyph: "Gr", cat: "town",  danger: 1, loot: { food: 5, water: 2, meds: 0.4, scrap: 1, preserved: 1, jars: 0.75 }, gear: ["knife"], richness: 0.6, known: "public" },
  diner:       { name: "Diner",              glyph: "Di", cat: "town",  danger: 1, loot: { food: 5, water: 3, scrap: 1, jars: 0.75 }, gear: ["knife"], richness: 0.5, known: "public" },
  motel:       { name: "Motel",              glyph: "Mo", cat: "town",  danger: 1, loot: { food: 2, water: 2, meds: 0.5, scrap: 2, ammo: 1, jars: 0.25 }, gear: ["pistol", "knife", "backpack", "bicycle", "revolver", "slingbag", "compact9"], richness: 0.5, known: "public" },
  church:      { name: "Church",             glyph: "†",  cat: "town",  danger: 1, loot: { food: 3, water: 3, meds: 0.4, scrap: 1, jars: 0.75 }, gear: ["bandagekit"], richness: 0.45, known: "public" },
  clinic:      { name: "Clinic",             glyph: "Cl", cat: "town",  danger: 1, loot: { meds: 5, water: 1, scrap: 1 }, gear: ["surgkit", "bandagekit", "dewormer"], richness: 0.55, known: "public" },
  feedstore:   { name: "Feed store",         glyph: "Fd", cat: "town",  danger: 0, loot: { food: 4, fuel: 0.8, scrap: 2, parts: 1, jars: 1 }, gear: ["machete", "huntrifle", "leverrifle", "barbedwire", "beartrap", "sledge", "rifle22", "dbshotgun", "hatchet"], richness: 0.5, known: "public" },
  // Countryside: sparse, quiet and poorer, often off the road.
  barn:        { name: "Barn",               glyph: "Br", cat: "rural", danger: 0, loot: { food: 3, fuel: 0.6, scrap: 2, jars: 0.5 }, gear: ["machete", "sledge", "prybar", "barbedwire", "beartrap", "pickaxe", "dbshotgun"], richness: 0.35, known: "road" },
  ranch:       { name: "Ranch",              glyph: "R",  cat: "rural", danger: 0, loot: { food: 5, water: 2, ammo: 1, fuel: 0.3, jars: 0.75, preserved: 0.5 }, gear: ["huntrifle", "shotgun", "machete", "leverrifle", "revolver", "barbedwire", "beartrap", "binoculars", "dewormer", "dbshotgun", "rifle22", "pistol45"], richness: 0.55, known: "road" },
  cabin:       { name: "Cabin",              glyph: "Cb", cat: "rural", danger: 0, loot: { food: 2, ammo: 2, water: 1, meds: 0.4, preserved: 0.5, jars: 0.25 }, gear: ["huntrifle", "machete", "waterfilter", "leverrifle", "fireaxe", "beartrap", "stove", "ghillie", "monocular", "binoculars", "rifle22", "hatchet"], richness: 0.35, known: "road" },
  lodge:       { name: "Hunting lodge",      glyph: "L",  cat: "rural", danger: 0, loot: { ammo: 4, food: 3, meds: 0.4, preserved: 0.5 }, gear: ["huntrifle", "shotgun", "machete", "compbow", "xbow", "leverrifle", "ghillie", "camonet", "beartrap", "stove", "binoculars", "spotscope", "monocular", "spear", "rifle22", "hatchet"], richness: 0.55, known: "road" },
  campground:  { name: "Campground",         glyph: "Cg", cat: "rural", danger: 1, loot: { food: 2, water: 3, fuel: 0.3, scrap: 1, rawwater: 0.5 }, gear: ["knife", "pipespear", "waterfilter", "backpack", "bicycle", "hikingpack", "stove", "hatchet", "etool"], richness: 0.4, known: "road" },
  ranger:      { name: "Ranger station",     glyph: "Rs", cat: "rural", danger: 0, loot: { meds: 1, ammo: 2, food: 2, fuel: 0.3 }, gear: ["huntrifle", "bandagekit", "bicycle", "fireaxe", "hikingpack", "stove", "binoculars", "spotscope", "monocular", "rifle22", "hatchet"], richness: 0.5, known: "road" },
  radiotower:  { name: "Radio tower",        glyph: "Rt", cat: "rural", danger: 0, loot: { parts: 3, scrap: 2, fuel: 0.3 }, gear: ["flashlight", "prybar", "binoculars"], richness: 0.4, known: "road" },
  truckstop:   { name: "Truck stop",         glyph: "Ts", cat: "rural", danger: 1, loot: { fuel: 5, food: 3, parts: 1, scrap: 2, preserved: 0.5 }, gear: ["pistol", "shotgun", "revolver", "prybar", "slingbag", "hikingpack", "compact9"], richness: 0.7, known: "public" },
  crashsite:   { name: "Crash site",         glyph: "X",  cat: "rural", danger: 1, loot: { scrap: 4, parts: 2, fuel: 0.8, meds: 0.4 }, gear: ["pistol", "slingbag", "backpack", "prybar"], richness: 0.6, known: "secret" },
  // Temporary sites from crash events (crashes.js): never placed by the map, they appear where something came down
  // and burn out after 7–10 days. temp: not a permanent site.
  crash_mil:   { name: "Army helicopter wreck", glyph: "✈", cat: "special", danger: 2, temp: true, loot: { ammo: 5, meds: 1.5, parts: 2, scrap: 2, fuel: 0.5 }, gear: ["ar", "vest", "plate", "riothelmet", "milradio", "nvg", "assaultpack", "rucksack", "carbine", "camonet", "thermal", "binoculars", "combatknife"], richness: 1.2, known: "secret" },
  crash_cargo: { name: "Supply plane wreck",  glyph: "✈", cat: "special", danger: 2, temp: true, loot: { food: 5, water: 3, meds: 1.5, preserved: 2, parts: 1, scrap: 2, fuel: 0.6 }, gear: ["assaultpack", "vest", "bandagekit", "surgkit", "rucksack", "stove"], richness: 1.2, known: "secret" },
  crash_med:   { name: "Medevac wreck",       glyph: "✈", cat: "special", danger: 2, temp: true, loot: { meds: 7, water: 2, scrap: 1, parts: 1 }, gear: ["surgkit", "bandagekit", "vest"], richness: 1.1, known: "secret" },
  crash_news:  { name: "News helicopter wreck", glyph: "✈", cat: "special", danger: 2, temp: true, loot: { parts: 3, scrap: 3, water: 1, food: 1, fuel: 0.4 }, gear: ["hikingpack", "slingbag"], richness: 0.9, known: "secret" },
  airdrop:     { name: "Supply drop",         glyph: "⇣", cat: "special", danger: 1, temp: true, loot: { food: 6, water: 4, meds: 2, ammo: 3, preserved: 2 }, gear: ["assaultpack", "vest", "bandagekit", "rucksack", "stove"], richness: 1.2, known: "secret" },
  // The abandoned military convoy (miltrucks.js): Army trucks stopped on a road tile, their turned crews about them;
  // stripped by other groups and burned out after 6–9 days. Its trucks hold most of what it is worth (truckLoot).
  convoy:      { name: "Abandoned Army convoy", glyph: "🪖", cat: "special", danger: 2, temp: true, loot: { ammo: 5, fuel: 2, food: 2, meds: 1, parts: 1.5 }, gear: ["ar", "carbine", "vest", "plate", "milhelmet", "milradio", "assaultpack", "rucksack", "smokegren", "flare", "combatknife", "etool"], richness: 0.9, known: "secret" },
  // Points of interest (pois.js): the small places a tile holds besides its site (0–4 a tile, by terrain). Never
  // placed as tile.loc by the map; they are drawn from these entries like any site (richness = a POI's starting
  // pool, danger its base threat, loot and gear what a search there turns up). A lone house or shed ranks below a
  // school, a gas station or a farm. The pizza place is a diner with its own name, food and sprite.
  house:       { name: "House",              glyph: "Ho", cat: "town",  danger: 1, loot: { food: 3, water: 2, meds: 0.4, scrap: 1, ammo: 0.5, jars: 0.5 }, gear: ["knife", "pistol", "revolver", "bat", "slingbag", "backpack", "bikehelmet", "flashlight", "bicycle", "lantern", "bandagekit", "binoculars"], richness: 0.3, known: "public" },
  neighbourhood: { name: "Neighbourhood",    glyph: "Nb", cat: "town",  danger: 1, loot: { food: 4, water: 2, meds: 0.5, scrap: 2, ammo: 1, jars: 0.5, parts: 0.3 }, gear: ["knife", "pistol", "revolver", "shotgun", "bat", "slingbag", "backpack", "bikehelmet", "flashlight", "bicycle", "lantern", "bandagekit", "prybar", "crowbar", "binoculars"], richness: 0.55, known: "public" },
  garage:      { name: "Garage",             glyph: "Ga", cat: "town",  danger: 1, loot: { parts: 3, scrap: 3, fuel: 0.5 }, gear: ["crowbar", "prybar", "sledge", "kneeguards", "spikedbat", "flashlight", "headlamp", "bicycle", "repairkit", "flare"], richness: 0.3, known: "public" },
  corner:      { name: "Corner shop",        glyph: "Cn", cat: "town",  danger: 1, loot: { food: 4, water: 2, meds: 0.3, scrap: 1, preserved: 0.5, jars: 0.5 }, gear: ["knife", "slingbag", "flashlight", "lantern", "windlight", "hikingpack", "duffle"], richness: 0.45, known: "public" },
  pizza:       { name: "Pizza place",        glyph: "Pz", cat: "town",  danger: 1, loot: { food: 5, water: 3, scrap: 1, jars: 0.5 }, gear: ["knife", "flashlight", "slingbag", "bottle"], richness: 0.4, known: "public" },
  farmstand:   { name: "Farm stand",         glyph: "St", cat: "rural", danger: 0, loot: { food: 4, water: 1, jars: 1, scrap: 0.5, preserved: 0.5 }, gear: ["knife", "machete", "lantern", "barbedwire", "beartrap", "dewormer", "sledge"], richness: 0.3, known: "road" },
  shed:        { name: "Shed",               glyph: "Sh", cat: "rural", danger: 0, loot: { scrap: 3, parts: 1, fuel: 0.4, food: 0.3 }, gear: ["machete", "sledge", "prybar", "crowbar", "barbedwire", "beartrap", "flashlight", "lantern", "headlamp", "repairkit"], richness: 0.2, known: "road" },
  blind:       { name: "Hunting blind",      glyph: "Hb", cat: "rural", danger: 0, loot: { ammo: 3, food: 1, water: 0.5 }, gear: ["huntrifle", "leverrifle", "compbow", "xbow", "spear", "ghillie", "camonet", "monocular", "binoculars", "gamecall", "beartrap", "handwarmer"], richness: 0.15, known: "road" },
  campsite:    { name: "Campsite",           glyph: "Ca", cat: "rural", danger: 0, loot: { food: 2, water: 2, scrap: 0.5, fuel: 0.2 }, gear: ["knife", "backpack", "hikingpack", "waterfilter", "stove", "headlamp", "torch", "lantern", "spear", "handradio", "puritabs", "flare"], richness: 0.25, known: "road" },
  hikercamp:   { name: "Hiker camp",         glyph: "Hk", cat: "rural", danger: 0, loot: { food: 2, water: 2, meds: 0.4 }, gear: ["hikingpack", "backpack", "waterfilter", "stove", "headlamp", "torch", "knife", "spear", "puritabs", "handwarmer", "monocular"], richness: 0.2, known: "road" },
  // The gun and gear shops of the towns and cities (the user's request 2026-10-21: "gun shop, pawn shops POI and to
  // town and city crawls which have increased loot chances for guns, rigs and other survival gear"): on a suburb or a
  // city block by their own dice (pois.js shopExtra) and on the crawl's blocks (citycrawl.js shopPlace). gearRate:
  // the search hour's gear roll × this (scavenge.js; 1 elsewhere). The gun store above is the same shop as a site.
  pawnshop:    { name: "Pawn shop",          glyph: "Pw", cat: "town",  danger: 1, gearRate: 1.6, loot: { ammo: 3, scrap: 2, parts: 1, fuel: 0.2 }, gear: ["pistol", "revolver", "shotgun", "huntrifle", "leverrifle", "rifle22", "pistol22", "compact9", "pistol45", "dbshotgun", "compbow", "xbow", "binoculars", "monocular", "spotscope", "knife", "machete", "kukri", "katana", "golfclub", "hikingpack", "backpack", "duffle", "waterfilter", "stove", "headlamp", "lantern", "handradio", "windlight", "bicycle", "vest", "kneeguards", "ghillie", "camonet", "hatchet", "tomahawk", "combatknife", "repairkit", "handwarmer"], richness: 0.6, known: "public" },
  mineshack:   { name: "Mine shack",         glyph: "Mn", cat: "rural", danger: 0, loot: { scrap: 3, parts: 1.5, fuel: 0.4 }, gear: ["sledge", "prybar", "crowbar", "headlamp", "flashlight", "lantern", "repairkit", "flare", "windlight"], richness: 0.3, known: "road" },
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
/** @param {import("./types").TileLoc | null} loc @returns {number} */
export const siteDanger = (loc) => {
  if (!loc) return 0;
  const d = LOCATIONS[loc.type].danger ?? 1;
  return loc.zone === "town" || loc.zone === "rural" ? Math.min(1, d) : d;
};

export const SKILLS = ["shooting", "stealth", "scavenging", "scouting", "medicine", "mechanics", "farming", "speech", "leadership", "crafting", "melee", "cooking"];
// The skills a new survivor draws with the world's dice (world.js makeSurvivor): every skill but Crafting, Melee and
// Cooking, which came later and are rolled with dice of their own (appearance.js craftingStart, meleeStart,
// cookingStart), so the same seed still makes the same people. Melee and Cooking are last in SKILLS so every loop over
// SKILLS that draws dice draws the older skills' dice as it did.
export const ROLLED_SKILLS = SKILLS.filter((k) => k !== "crafting" && k !== "melee" && k !== "cooking");
export const SKILL_NAMES = {
  shooting: "Shooting", stealth: "Stealth", scavenging: "Scavenging", scouting: "Scouting",
  medicine: "Medicine", mechanics: "Mechanics", farming: "Farming", speech: "Speech", leadership: "Leadership",
  crafting: "Crafting", // crafting.js: the quality, speed and XP of everything made by hand (each recipe's own skill is only its minimum)
  melee: "Melee", // world.js MELEE_SKILL: to hit and damage with melee weapons and bare hands, takedowns, a melee wielder's fighting strength
  cooking: "Cooking", // kitchen.js (2026-10-10): how far the Kitchen's hot meals stretch the food and lift the mood; learned at the stove
};

// Survivor traits. bad: a drawback; neutral: a real trade-off, good and bad at once (worth no points under Customize);
// neither: a good one (traitKind). The trait picker, the chips' colours (green, red, grey) and the points go by it.
// desc is tier I (the trait as it always was); the numbers of every tier, and the points, are traits.js TRAIT_TIERS,
// where their rules are (traitDesc says them for a tier).
export const TRAITS = {
  brave:     { name: "Brave",        desc: "Fights harder: +1 fighting strength, +5% to hit in battle" },
  coward:    { name: "Coward",       bad: true, desc: "Fights worse: -1 fighting strength, -5% to hit in battle; may lose their nerve on a trip" },
  nightowl:  { name: "Night Owl",    neutral: true, desc: "At night their team is 15% more likely to spot others first; by day, drowsy, 5% less likely" },
  medic:     { name: "Former Medic", desc: "+4 Medicine" },
  greedy:    { name: "Greedy",       neutral: true, desc: "Finds 15% more when scavenging around a base and a gift from the stores pleases them more, but others like them less (-10 opinion), they are the likeliest thief, and they take twice as much if they walk out" },
  tough:     { name: "Tough",        desc: "Takes 25% less damage from wounds (not from hunger, thirst or infection)" },
  keeneye:   { name: "Keen Eye",     desc: "+1 sight radius for their team, and it notices hidden finds more often" },
  loud:      { name: "Loud",         bad: true, desc: "-3 Stealth" },
  lucky:     { name: "Lucky",        desc: "+1 to every skill" },
  badback:   { name: "Bad Back",     bad: true, desc: "Max load 28 kg instead of 40, and loads feel 20% heavier (a worse load band)" },
  // 2026-10-08 (user request: "more tags like Lucky, Tough"): rolled at birth with dice of their own (traits.js).
  quicklearner: { name: "Quick Study",   desc: "Learns 25% faster: +25% XP from everything (use, study, fights)" },
  ironstomach:  { name: "Iron Stomach",  desc: "Half the chance of an upset stomach from un-purified water or food poisoning (bad cooking, uncooked food), and shrugs off the worm's eggs 1 time in 3 (water, raw food, camping, searching)" },
  quickheal:    { name: "Quick Healer",  desc: "Wounds heal 30% faster while resting (at a base, in a hospital bed, in camp, as a prisoner)" },
  strongback:   { name: "Strong Back",   desc: "Max load 48 kg instead of 40, and loads feel 10% lighter (a better load band)" },
  bulldozer:    { name: "Bulldozer",    desc: "A shove lands more often (+10%) and knocks the target flat more often (+15%) in battle" }, // pick-only (PICK_ONLY_TRAITS): never rolled at birth
  fleet:        { name: "Fleet-Footed",  desc: "+1 tile a move in battle, and +10% to break off and get away from a fight (a team on foot all Fleet-Footed: +1 to Run for it on the road)" },
  farmraised:   { name: "Farm-Raised",   desc: "+3 Farming, +1 Cooking" },
  persuasive:   { name: "Persuasive",    desc: "+3 Speech (better prices, talks, recruiting)" },
  ironwill:     { name: "Iron Will",     desc: "Half as likely to break down (small breaks and mental breaks) or walk out when mood is low" },
  unlucky:      { name: "Unlucky",       bad: true, desc: "-1 to every skill" },
  frail:        { name: "Frail",         bad: true, desc: "Takes 25% more damage from wounds (not from hunger, thirst or infection)" },
  clumsy:       { name: "Clumsy",        bad: true, desc: "-10% to hit in melee, and 50% more cuts and sprains at work and when searching" },
  glutton:      { name: "Glutton",       bad: true, desc: "Eats 25% more: a quarter ration more a day at a base, and hunger falls 25% faster on the road" },
  sickly:       { name: "Sickly",        bad: true, desc: "Falls ill 50% more often, and illnesses clear 1 point a day slower" },
  hothead:      { name: "Hothead",       bad: true, desc: "Gets along worse with everyone (-10 opinion), and when they break they lash out: fights and attacks are far likelier" },
  // 2026-10-08 (user request: "add more bad traits if there are too few"): the opposites of good ones (TRAIT_CLASH),
  // rolled at birth with the newer traits' own dice like the rest.
  slow:         { name: "Slow",          bad: true, desc: "-1 tile a move in battle, and -10% to break off and get away from a fight (a team on foot with them: -1 to Run for it on the road)" },
  slowlearner:  { name: "Slow Learner",  bad: true, desc: "Learns 20% slower: -20% XP from everything (use, study, fights)" },
  weakstomach:  { name: "Weak Stomach",  bad: true, desc: "50% more likely to get an upset stomach from un-purified water or food poisoning (bad cooking, uncooked food)" },
  nearsighted:  { name: "Nearsighted",   bad: true, desc: "-2 Scouting and -1 Shooting" },
  feeble:       { name: "Feeble",        bad: true, desc: "Max load 4 kg lower, and -5% to hit in melee" },
  squeamish:    { name: "Squeamish",     bad: true, desc: "-2 Medicine, and a death in the group hits their mood 3 points harder (wherever they are)" },
  pessimist:    { name: "Pessimist",     bad: true, desc: "Always expects the worst: mood -0.5 a day" },
  // 2026-10-09 (user request: "Tactical as a trait? / Strategic as a trait? / Diplomatic as a trait"): the battle, the
  // State Map and the other groups. Rolled at birth with dice of their own after the others (LATE_TRAITS, traits.js).
  tactical:     { name: "Tactical",      desc: "+10% to hit a flanked target, -5% to be hit while in cover, +3% to hit for allies within 2 tiles; +0.5 fighting strength by the numbers" },
  strategic:    { name: "Strategic",     desc: "Their team meets 10% less trouble on the road, and while they are at a base your estimates of other groups are 15% sharper" },
  diplomatic:   { name: "Diplomatic",    desc: "Goodwill with groups rises 10% faster and falls 10% slower; their team's bribes and tolls cost 10% less; radio deals from their base: delivery fees go 10% lower" },
  // 2026-10-11 (wave 2 eating, user pick 3: food preferences): eating.js reads them at every meal. Picky Eater and
  // Vegetarian are rolled at birth after the others (DIET_TRAITS, traits.js dietTraits); a Cannibal only by choice (the
  // new-run screen, a custom background): the game has no human meat (eating.js).
  picky:        { name: "Picky Eater",   bad: true, desc: "Fussy about food: a simple meal mood -3 and raw food -4 on top of the usual; a fine meal +2 and a lavish one +3 on top" },
  vegetarian:   { name: "Vegetarian",    bad: true, desc: "Eats plant food first; meat, fish, eggs, milk, honey or a mixed meal: mood -6 (2 days)" },
  cannibal:     { name: "Cannibal",      neutral: true, desc: "Human meat lifts their mood (+10) where it turns anyone else's stomach (-20). There is no human meat in the game: the dead carry the worm" },
};
// The traits drawn with the world's dice at birth (world.js rollTraits), in this order: the ten there were before
// 2026-10-08. The draw over them is exactly the old draw, so a seed keeps every roll it made; the newer traits come in
// afterwards with dice of their own (traits.js swapNewTraits). Never add to this list.
export const BIRTH_TRAITS = ["brave", "coward", "nightowl", "medic", "greedy", "tough", "keeneye", "loud", "lucky", "badback"];
// The traits that come in with their own dice: every enumerable trait not in BIRTH_TRAITS.
export const NEW_TRAITS = Object.keys(TRAITS).filter((t) => !BIRTH_TRAITS.includes(t));
// The traits added 2026-10-09 (Tactical, Strategic, Diplomatic): they come in after the swap below with dice of their
// own (traits.js lateTraits), so the swap's pool stays what it was and a seed's people keep the traits they had,
// but for the few a later trait now takes the place of one. Never add to this list: a later wave gets its own.
export const LATE_TRAITS = ["tactical", "strategic", "diplomatic"];
// The swap's pool (traits.js swapNewTraits): the 21 newer traits of 2026-10-08, in their order. Never add to it.
// The food traits of 2026-10-11 (wave 2 eating): rolled after the late ones with their own hash (traits.js dietTraits:
// Picky Eater and Vegetarian; the Cannibal is never rolled). Never add to this list: a later wave gets its own.
export const DIET_TRAITS = ["picky", "vegetarian", "cannibal"];
export const DIET_ROLLED = ["picky", "vegetarian"];
// Traits only picked, never rolled (2026-10-20: Bulldozer, the shove): out of the swap's pool and of the roll shares, so
// no seed's people change. Never add to this list: a later wave gets its own.
export const PICK_ONLY_TRAITS = ["bulldozer"];
export const SWAP_TRAITS = NEW_TRAITS.filter((t) => !LATE_TRAITS.includes(t) && !DIET_TRAITS.includes(t) && !PICK_ONLY_TRAITS.includes(t));
// Traits nobody has together (opposites). The one table: the birth roll, a child's traits, the new-run screen's
// picker, custom backgrounds, the backgrounds of a start.
export const TRAIT_CLASH = [["brave", "coward"], ["lucky", "unlucky"], ["tough", "frail"], ["strongback", "badback"], ["quickheal", "sickly"], ["ironwill", "hothead"],
  ["fleet", "slow"], ["quicklearner", "slowlearner"], ["ironstomach", "weakstomach"], ["keeneye", "nearsighted"], ["strongback", "feeble"], ["bulldozer", "feeble"], ["medic", "squeamish"], ["ironwill", "pessimist"],
  ["diplomatic", "hothead"], // 2026-10-09: a Hothead talks no one round
  ["vegetarian", "cannibal"]]; // 2026-10-11: one does not eat meat
// Do traits a and b clash?
/** @param {string} a @param {string} b @returns {boolean} */
export const traitsClash = (a, b) => TRAIT_CLASH.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
// "good", "bad" or "neutral" (TRAITS bad / neutral; the prepper's background trait is neutral: it changes nothing).
/** @param {string} t @returns {"good" | "bad" | "neutral"} */
export const traitKind = (t) => { const d = TRAITS[t]; return !d || t === "prepper" || d.neutral ? "neutral" : d.bad ? "bad" : "good"; };
// The trait in `list` that clashes with t (null: none).
/** @param {readonly string[]} list @param {string} t @returns {string | null} */
export const clashIn = (list, t) => (list || []).find((x) => traitsClash(x, t)) || null;
// A background trait, given only by the hardcore start (hardcore-start.js: the one of the three who fled with a packed
// duffle bag) and never rolled at birth: it is not enumerable, so it is in neither BIRTH_TRAITS nor NEW_TRAITS, nor
// in the new-run screen's picker or a custom background's (custombg.js customTraitKeys), while TRAITS.prepper still resolves for the roster, the tooltips and
// the crew filter. It changes nothing in play: the kit it stands for is on the team's first day.
Object.defineProperty(TRAITS, "prepper", { value: { name: "Prepper", desc: "Saw it coming: fled Calder with a duffle bag packed for five days (hardcore start). The kit is the trait." }, enumerable: false, writable: true, configurable: true });

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
// Kept in a block of their own: the gear for food from the land. Fishing gear goes in a pack
// slot or the cargo (not worn); a team fishes with what it carries, a base's fishers with what is in its armory.
Object.assign(GEAR, {
  fishrod:   { name: "Fishing rod",  slot: "pack", skill: null, power: 0, req: 0, value: 12, noise: 0, fish: "rod", fishPower: 0.6, weight: 0.8, cat: "tools", desc: "A telescopic rod and a tackle box. Fish on a river or a lake shore (team order, or the Fish job at a base by the water): about 0.6 food an hour, more at dawn and dusk." },
  fishnet:   { name: "Fishing net",  slot: "pack", skill: null, power: 0, req: 0, value: 18, noise: 0, fish: "net", weight: 2.5, cat: "tools", desc: "A gill net with floats: worked by two, it catches about twice what a rod does (1.2 food an hour)." },
  // A rod made by hand (crafting.js makeshiftrod): a sapling, fishing line from a spool or unpicked cord, a bent hook.
  makeshiftrod: { name: "Makeshift fishing rod", slot: "pack", skill: null, power: 0, req: 0, value: 4, noise: 0, fish: "rod", fishPower: 0.42, makeshift: true, dur: 12, weight: 0.5, cat: "tools", desc: "A cut sapling, a length of line and a hook bent from a paperclip. Fishes like a rod, but catches about a third less (0.42 food an hour) and the line snaps in the end." },
  // A real spear (looted): a weapon, and a gig for fish in the shallows (fish: "spear": daylight, not through ice).
  spear:     { name: "Steel spear",  slot: "weapon", skill: "shooting", power: 1.8, req: 0, value: 14, noise: 0, fish: "spear", fishPower: 0.5, weight: 1.8, cat: "melee", desc: "A boar spear off a hunting lodge wall: a long steel head on an ash shaft. Keeps the dead at arm's length, and spears fish in the shallows (0.5 food an hour, best in daylight; no use through ice)." },
  snarewire: { name: "Snare wire",   slot: "pack", skill: null, power: 0, req: 0, value: 6,  noise: 0, small: true, weight: 0.4, cat: "tools", desc: "A coil of brass wire: a line of 8 snares (team order, 2 hours). Quiet; about a rabbit a day in good country. The wire stays with the line and comes back when it is lifted." },
});
// Where they turn up: loot.js SITE_FINDS (their own dice, so adding them changes no other loot roll).

// ---------- machines for food (freezer-parts 2026-10-10) ----------
// The pressure canner: no longer made or found (machines-2: it is fitted to a preserving room, buildings.js
// BUILDINGS.canner). One kept from an old save is fitted to a kitchen when loaded (buildings.js migrateCanners), or
// waits in the armory and pays for a fitting later.
Object.assign(GEAR, {
  canner: { name: "Pressure canner", slot: "pack", skill: null, power: 0, req: 0, value: 22, noise: 0, bulky: true, canner: true, weight: 7, cat: "tools", desc: "A heavy pot with a locking lid, a gauge and a relief valve, its gasket and clamps machined at the workshop. Fit it to a preserving room (Construction, the preserving room's Fit a canner: no materials needed with this one in the base's armory): that kitchen jars 1 more preserved food a day (bigger batches, safely, under pressure)." },
});

// ---------- gun safes and gun cases (gunsafes.js, locks.js; docs/weapons-overhaul-plan.md section 19) ----------
// The safe-cracking tools (carried, never worn: locks.js reads them on the person) and the gun cases, which hold a gun
// and a little ammo (item.contents, item.sup; item.locked: a cheap lock on it). Where they turn up: gunsafes.js
// GUN_FINDS and SEARCH_TOOLS (their own dice, so adding them changes no other loot roll).
Object.assign(GEAR, {
  powerdrill:   { name: "Cordless power drill", slot: "pack", skill: null, power: 0, req: 0, value: 25, noise: 0, dur: 3, drill: true, weight: 2.2, cat: "tools", desc: "A drill with a box of cobalt bits and two charged batteries. Drills the lock out of a gun safe in a raid: 1 + 0.05 a Mechanics point of progress an action (a gun cabinet takes 2, a gun safe 6, an armoury safe 12), loud (Heat about +2 an action, wakes everything within 8 tiles each turn). The bits are good for 3 safes." },
  anglegrinder: { name: "Angle grinder",        slot: "pack", skill: null, power: 0, req: 0, value: 35, noise: 0, dur: 4, grind: true, weight: 3, cat: "tools", desc: "A cordless grinder and a stack of cutting discs: cuts a gun safe open twice as fast as a drill, louder still (Heat about +3 an action, wakes everything within 11 tiles each turn), and at night the sparks give the user away. The discs are good for 4 safes." },
  riflecase:    { name: "Hard rifle case",      slot: "pack", skill: null, power: 0, req: 0, value: 12, noise: 0, bulky: true, gunCase: { long: 1, hand: 0, small: 2 }, weight: 3.5, cat: "containers", desc: "A foam-lined hard case for one long gun and a couple of small things, some with a cheap lock. A gun inside is not to hand: it does not wear and cannot be fired. Opening a locked one takes a blade or a crowbar (1 action and Heat +1 in a raid; free at a base or a camp). Carried in both arms only (no pocket, pack or pouch takes it): it fills both hands." },
  pistolcase:   { name: "Pistol case",          slot: "pack", skill: null, power: 0, req: 0, value: 6,  noise: 0, small: true, gunCase: { long: 0, hand: 1, small: 2 }, weight: 1, cat: "containers", desc: "A small lockable case for a handgun and a box of rounds. A gun inside is not to hand: it does not wear and cannot be fired. Opening a locked one takes a blade or a crowbar (1 action and Heat +1 in a raid; free at a base or a camp)." },
});

// The weapons overhaul (docs/weapons-overhaul-plan.md): guns and melee, ammo boxes and reloading supplies, attachments,
// carry kit. One line, so the agents filling those modules never edit the end of this file.
Object.assign(GEAR, GUN_GEAR, LATER_GEAR, AMMO_GEAR, RELOAD_GEAR, MOD_GEAR, KIT_GEAR, BULK_GEAR); // LATER_GEAR: the launchers and the M2 (wave 2, launchers.js)
for (const [k, p] of Object.entries(GEAR_PATCH)) if (GEAR[k]) Object.assign(GEAR[k], p); // data-guns.js: changed descriptions
Object.assign(GEAR, NL_GEAR); // non-lethal weapons (data-nonlethal.js)
Object.assign(GEAR, HELMET_GEAR); // helmets, visors, helmet mounts, ear protection (data-helmets.js)
Object.assign(GEAR, BLADE_GEAR); // knives and swords (data-blades.js)
Object.assign(GEAR, SURV_ITEMS); // survival gear (data-survival.js)
Object.assign(GEAR, TOOL_ITEMS); // tools for building and crafting (data-tools.js)
Object.assign(GEAR, BOX_GEAR); // lockable boxes (data-boxes.js)
for (const [k, p] of Object.entries(BOX_PATCH)) if (GEAR[k]) Object.assign(GEAR[k], p); // the gun cases are boxes too
Object.assign(GEAR, CART_GEAR); // carts (data-carts.js, carts.js)
Object.assign(GEAR, BED_GEAR); // beds as furniture (data-beds.js, beds.js)
Object.assign(GEAR, TENT_GEAR); // tent bags (data-tents.js, tents.js)
Object.assign(GEAR, POWER_GEAR); // found generators, mounted spotlights, fridges (data-power.js, electric.js)
Object.assign(GEAR, supItemGear(SUPPLIES, GEAR)); // supplies as items: s_<key> (data-supitems.js; rounds keep their boxes)
// The Melee skill (world.js MELEE_SKILL): every melee weapon goes by Melee, not Shooting (its req, the skill-gap rule).
for (const d of Object.values(GEAR)) if (d.slot === "weapon" && d.cat === "melee" && d.skill === "shooting") d.skill = "melee";

// ---------- durability (crafting.js itemDur / wear) ----------
// Real gear wears too, only slower than makeshift gear: dur = uses before it breaks (weapons and armor: fights;
// the surgical kit: treatments; fishing gear: days of fishing; camp kit: days out in the field). Entries that set
// their own dur (the makeshift gear, tablets, toiletries) keep it. Found and starting gear comes part-worn
// (inventory.js newItem with an rng: FOUND_DUR); crafted gear lasts by its quality (crafting.js craftedDur).
export const GEAR_DUR = {
  knife: 40, machete: 45, bat: 30, prybar: 70, fireaxe: 50, sledge: 60, baton: 50, spear: 45,
  pistol: 60, revolver: 80, shotgun: 60, huntrifle: 70, leverrifle: 70, carbine: 70, ar: 60, compbow: 50, xbow: 50,
  // Armour pieces: their durability points (per-hit wear, armour.js; docs/weapons-overhaul-plan.md section 17 dmax).
  vest: 40, plate: 45, bikehelmet: 20, riothelmet: 25, milhelmet: 30, kneeguards: 15, riotlegs: 20, riotarms: 20,
  surgkit: 40, fishrod: 60, fishnet: 40, camonet: 60, stove: 80, ghillie: 20, ragboots: 14,
};
for (const [k, v] of Object.entries(GEAR_DUR)) if (GEAR[k] && !GEAR[k].dur) GEAR[k].dur = v;

// data-shops.js: the town's and the city's shops and services (their rows; this module's own rows win).
for (const [k, d] of Object.entries(NEW_KINDS)) if (!LOCATIONS[k]) LOCATIONS[k] = d.site;
