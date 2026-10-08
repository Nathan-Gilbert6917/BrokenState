// @ts-check
// Static definitions: terrain, locations, supplies, gear, traits, faction types, names.
// Kept as plain data so it can later move to JSON files for modding.

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
// way, trade.js / valuation.js); weight is kg per unit (load.js: what people carry, what a vehicle hauls); a unit of food
// or water is one person's ration for a day; ammo is per round. cat = trade category (CATEGORIES below).
export const SUPPLIES = {
  food:  { name: "Food",  value: 2,   weight: 0.5, cat: "food" },
  // Water (water.js): purified water is safe to drink (boiled, filtered, treated with tablets, or bottled water found in
  // shops and houses); un-purified water comes from the land (wells, springs, rivers and lakes, rain catchers) and is
  // safe only once purified: drunk as it is, it carries the worm's eggs of the ground it came from (worm.js). A base's
  // boiler, water filters and a shelter's fire purify it; a team boils it at a camp fire, filters it or drops tablets in.
  water: { name: "Purified water", value: 1,   weight: 1, cat: "water" },
  rawwater: { name: "Un-purified water", value: 0.5, weight: 1, cat: "water" },
  fuel:  { name: "Fuel",  value: 3,   weight: 1, cat: "fuel" },
  meds:  { name: "Meds",  value: 8,   weight: 0.1, cat: "medical" }, // semi-rare outside pharmacies and clinics (medfinds.js): dear
  ammo:  { name: "Ammo",  value: 0.5, weight: 0.02, cat: "ammo" },
  // Arrows and crossbow bolts: what a bow or crossbow shoots (1 a shot; it never uses ammo). Hunting (hunting.js) often
  // loses one (in the brush, broken in the animal); in a fight about half the arrows shot are picked up again after a
  // win and none after a loss or a retreat (world.js ARROWS, combat.js). Made by hand from firewood and a little scrap
  // (crafting.js), found at hunting lodges, gun stores, sports shops and campgrounds.
  arrows: { name: "Arrows", value: 0.4, weight: 0.03, cat: "bow" },
  parts: { name: "Parts", value: 8,   weight: 2, cat: "parts" },
  scrap: { name: "Scrap", value: 1,   weight: 2, cat: "scrap" },
  // Food storage (storage.js): preserved food is jarred, dried or smoked food (and dry grain and beans) that barely
  // spoils and needs no cellar space; eaten like food (fresh first), and lighter to carry on a trip. Jars (and lids)
  // are what the preserving kitchen fills: found in kitchens, shops and farms, and most come back when the food
  // in them is eaten at a base.
  preserved: { name: "Preserved food", value: 4, weight: 0.35, cat: "food" },
  jars:  { name: "Jars",  value: 0.5, weight: 0.4, cat: "containers" },
  // Firewood (woodcutting.js): split logs, branches and kindling, 0.1 kg a unit (a 3 kg bundle is 30), cut from the
  // land around a base (the Cut wood job) or by a team (the Cut wood order), found in woodpiles and log baskets, or
  // broken down from wooden, paper and cloth things (by their weight). The winter's heating: a base burns firewood
  // before fuel, 30 firewood heating as much as 0.2 fuel (upkeep.js HEAT.wood). Bulky and cheap: anyone with an axe
  // can cut it. (It was 3 kg a unit: every firewood figure is WOOD_UNITS times what it was; save.js scales old saves.)
  // bulk: what counts as one where a rule asks for "a few" of a supply (supplyFew: 5 to spare is 150 firewood).
  wood:  { name: "Firewood", value: 0.02, weight: 0.1, cat: "firewood", bulk: 30 },
};
export const SUPPLY_KEYS = Object.keys(SUPPLIES);
// Firewood units to one before firewood was 0.1 kg a unit (a 3 kg bundle): save.js scales an older save's firewood by it.
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
// down it makes floor(weight × burnShare / 0.1 kg) firewood (woodcutting.js burnOf). "Break down for firewood" in the
// inventory, and the water boiler may burn it from the armory (woodcutting.js burnables).
export const GEAR = {
  knife:      { name: "Kitchen knife",            slot: "weapon", skill: "shooting", power: 1, req: 0,  value: 5,  noise: 0, small: true, desc: "A chef's knife from a kitchen block. Quiet, light, and better than bare hands.", weight: 0.3, cat: "melee" },
  machete:    { name: "Machete",                  slot: "weapon", skill: "shooting", power: 2, req: 0,  value: 12, noise: 0, desc: "A brush-clearing blade. Silent, and it cleaves the dead.", weight: 1, cat: "melee" },
  pistol:     { name: "9mm pistol",               slot: "weapon", skill: "shooting", power: 3, req: 2,  value: 30, noise: 2, small: true, desc: "A police-issue 9mm. Light, fits a pocket, takes a suppressor. Needs Shooting 2.", weight: 1, cat: "pistol" },
  shotgun:    { name: "Pump shotgun",             slot: "weapon", skill: "shooting", power: 5, req: 6,  value: 50, noise: 3, desc: "A pump-action 12 gauge: devastating up close, poor at range. Needs Shooting 6.", weight: 3.5, cat: "shotgun" },
  huntrifle:  { name: "Hunting rifle",            slot: "weapon", skill: "shooting", power: 5, req: 5,  value: 55, noise: 3, desc: "A bolt-action deer rifle with a scope: the long-range gun. Needs Shooting 5.", weight: 4, cat: "rifle" },
  ar:         { name: "Assault rifle",            slot: "weapon", skill: "shooting", power: 8, req: 10, value: 120, noise: 3, desc: "A military rifle, two rounds a shot: the best gun there is. Needs Shooting 10.", weight: 4, cat: "automatic" },
  vest:       { name: "Kevlar vest",              slot: "armor",  skill: null,       power: 2, req: 0,  value: 45, noise: 0, desc: "Soft body armor from a squad car or an armory.", weight: 4, cat: "armor" },
  plate:      { name: "Plate carrier",            slot: "armor",  skill: null,       power: 4, req: 0,  value: 110, noise: 0, desc: "Ceramic plates in a military carrier: the best body armor, and heavy.", weight: 8, cat: "armor" },
  nvg:        { name: "Night vision goggles",     slot: "tool",   skill: "stealth",  power: 3, req: 8,  value: 140, noise: 0, small: true, desc: "Military night vision: see in the dark on a night raid, spot others first at night. In the off hand on the map at night the team sees a tile around it instead of only its own tile. Needs Stealth 8.", weight: 0.5, cat: "electronics" },
  milradio:   { name: "Military encrypted radio", slot: "tool",   skill: "scouting", power: 3, req: 6,  value: 160, noise: 0, small: true, desc: "An encrypted military set: hears what others cannot. Needs Scouting 6.", weight: 1, cat: "electronics" },
  surgkit:    { name: "Surgical kit",             slot: "tool",   skill: "medicine", power: 4, req: 10, value: 90, noise: 0, small: true, medKit: 4, desc: "Real instruments: +4 Medicine when treating (at a base, in the field or in battle). Needs Medicine 10 for the full bonus; no use below Medicine 3.", weight: 1.5, cat: "medical" },
  // Extra worn pieces (inventory.js): head, arms and legs armor and a real pack.
  bikehelmet: { name: "Motorcycle helmet",        slot: "head",   skill: null,       power: 0.7, req: 0, value: 15, noise: 0, desc: "Scratched but solid. Keeps teeth off your skull.", weight: 1.5, cat: "armor" },
  riothelmet: { name: "Riot helmet",              slot: "head",   skill: null,       power: 1.2, req: 0, value: 35, noise: 0, desc: "Police issue, with a visor.", weight: 1.8, cat: "armor" },
  milhelmet:  { name: "Combat helmet",            slot: "head",   skill: null,       power: 1.4, req: 0, value: 45, noise: 0, desc: "An army helmet, kevlar under the cloth cover. Stops a bite to the skull and most splinters. Usually taken off one of the dead soldiers.", weight: 1.5, cat: "armor" },
  kneeguards: { name: "Knee and shin guards",     slot: "legs",   skill: null,       power: 0.5, req: 0, value: 10, noise: 0, desc: "Hard plastic from a dirt-bike shop. Bites slide off.", weight: 1, cat: "armor" },
  assaultpack:{ name: "Assault pack",             slot: "backpack", skill: null,     power: 1, req: 0,   value: 40, noise: 0, carry: 10, slots: 8, ease: 0.12, desc: "A military pack: 8 pack slots, +10 kg max load, and its frame spreads the weight: the wearer's load counts 12% lighter for their load band.", weight: 2, cat: "packs" },
  // Makeshift gear (crafting.js): weaker than the real thing and it wears out. dur = uses before it breaks
  // (fights for weapons and armor, treatments for kits, days of work for tools). Extra fields:
  // medKit = Medicine bonus when treating (crafting.medKitBonus; the surgical kit has it too), bonus = skill bonus for base work, water = water per day at a base,
  // carry = kg added to the wearer's max load (load.js), slots = pack slots (inventory.js).
  spikedbat:  { burnShare: 0.8, name: "Spiked bat",               slot: "weapon", skill: "shooting", power: 1.5, req: 0, value: 4,  noise: 0, makeshift: true, dur: 10, desc: "A bat studded with nails. Hits hard, splinters eventually.", weight: 1.2, cat: "melee" },
  pipespear:  { name: "Pipe spear",               slot: "weapon", skill: "shooting", power: 1.2, req: 0, value: 3,  noise: 0, makeshift: true, dur: 8,  desc: "A kitchen knife taped to a steel pipe.", weight: 1.5, cat: "melee" },
  sawmachete: { name: "Saw-blade machete",        slot: "weapon", skill: "shooting", power: 1.7, req: 0, value: 7,  noise: 0, makeshift: true, dur: 12, desc: "A circular-saw blade ground into a cleaver.", weight: 1.2, cat: "melee" },
  crossbow:   { name: "Scrap crossbow",           slot: "weapon", skill: "shooting", power: 2.5, req: 3, value: 18, noise: 0, makeshift: true, dur: 12, desc: "Leaf-spring limbs: silent, shoots bolts (arrows, 1 a shot; never ammo). With none it is a club. After a won fight about half the bolts shot are picked up again; hunting loses some.", weight: 3, cat: "bow" },
  pipegun:    { name: "Pipe shotgun",             slot: "weapon", skill: "shooting", power: 3.5, req: 3, value: 20, noise: 3, makeshift: true, dur: 8,  desc: "A zip gun: two pipes and a nail. Short range, fires shotgun shells (ammo).", weight: 2.5, cat: "shotgun" },
  padding:    { burnShare: 0.9, name: "Magazine arm guards",      slot: "arms",   skill: null,       power: 0.6, req: 0, value: 3,  noise: 0, makeshift: true, dur: 6,  desc: "Magazines and duct tape around the forearms. Stops a bite, barely.", weight: 0.8, cat: "armor" },
  shinguards: { name: "Duct-tape shin guards",    slot: "legs",   skill: null,       power: 0.4, req: 0, value: 2,  noise: 0, makeshift: true, dur: 6,  desc: "Cut-up plastic bottles and tape around the shins.", weight: 0.6, cat: "armor" },
  tirevest:   { name: "Tire-rubber vest",         slot: "armor",  skill: null,       power: 1,   req: 0, value: 8,  noise: 0, makeshift: true, dur: 10, desc: "Strips of tire rubber laced into a vest.", weight: 5, cat: "armor" },
  sportspads: { name: "Football pads",            slot: "armor",  skill: null,       power: 0.8, req: 0, value: 8,  noise: 0, makeshift: true, dur: 12, desc: "Found, not made: shoulder pads from a school locker (the helmet is a separate piece).", weight: 3, cat: "armor" },
  footballhelmet: { name: "Football helmet",      slot: "head",   skill: null,       power: 0.4, req: 0, value: 4,  noise: 0, makeshift: true, dur: 10, desc: "Found, not made: a school football helmet. Cracks eventually.", weight: 1.5, cat: "armor" },
  scrapvest:  { name: "Scrap plate vest",         slot: "armor",  skill: null,       power: 1.8, req: 0, value: 25, noise: 0, makeshift: true, dur: 14, desc: "Steel plates riveted onto a work jacket. Heavy but solid.", weight: 7, cat: "armor" },
  bandagekit: { name: "Bandage and splint kit",   slot: "tool",   skill: "medicine", power: 1,   req: 0, value: 8,  noise: 0, makeshift: true, dur: 5,  medKit: 2, small: true, desc: "Boiled rags, tape and splints: +2 Medicine when treating (at a base, in the field or in battle). Each treatment uses it up a little.", weight: 0.5, cat: "medical" },
  crowbar:    { name: "Crowbar and lockpicks",    slot: "tool",   skill: "scavenging", power: 1, req: 0, value: 6,  noise: 0, makeshift: true, dur: 30, bonus: { scavenging: 2 }, desc: "Opens locked doors and cabinets: +2 Scavenging for base scavenging.", weight: 2, cat: "tools" },
  waterfilter:{ name: "Charcoal water filter",    slot: "tool",   skill: null,       power: 1,   req: 0, value: 10, noise: 0, makeshift: true, dur: 20, water: 3, desc: "Sand, charcoal and a bucket: +3 purified water a day at the base it is kept at (equipped or in the armory), and it purifies 10 un-purified water a day there (the worm's eggs strained out). At a base it clogs only on the days it is in use (one always is; more while the tanks have room or the worm's eggs need straining): spares stand dry and keep. A team carrying one drinks its un-purified water through it, safe.", weight: 3, cat: "tools" },
  // The worm (worm.js): a sure cure in the gut stage, at a base or on the road. Loot: pharmacies, clinics, hospitals,
  // and the livestock wormer on farms and ranches; made at a med station.
  dewormer:   { name: "Dewormer",                 slot: "pack",   skill: null,       power: 0,   req: 0, value: 18, noise: 0, small: true, weight: 0.1, desc: "A blister pack of strong worm tablets (or the livestock paste from a farm). Clears the worm for sure while it is still in the gut, with no medic needed. Useless once it reaches the brain.", cat: "medical" },
  // Purification tablets (worm.js): a stack of dur tablets (tabs: true; dur counts tablets, not wear), one treats
  // WORM.TABS_WATER (10) un-purified water. They are for the road: a team carrying them drops one in per 10
  // un-purified water drunk from infected sources (no filter carried, no camp fire lit) and that water is safe; bases
  // never use them (a team leaving packs a tube from the armory: autopilot.js launchTrip, the planner). Loot: pharmacies, clinics, hospitals, camping places, truck stops,
  // supply drops; pressed at a med station (crafting.js).
  puritabs:   { name: "Purification tablets",     slot: "pack",   skill: null,       power: 0,   req: 0, value: 10, noise: 0, small: true, dur: 10, tabs: true, weight: 0.1, cat: "medical", desc: "A tube of 10 iodine tablets for the road: one makes 10 un-purified water safe to drink without stopping to boil it (the worm's eggs die). A team carrying them drops one in per 10 un-purified water drunk (any of it can carry the worm) when it has no water filter and no lit camp fire with something to burn: on the move, or at a camp out of firewood. A base uses them only in an emergency (its boiler cold with nothing to burn, and no water filter); otherwise a team leaving packs a tube from the armory." },
  backpack:   { burnShare: 0.5, name: "School backpack",          slot: "backpack", skill: null,     power: 1,   req: 0, value: 5,  noise: 0, makeshift: true, carry: 6, slots: 6, desc: "A school bag reinforced with straps: 6 pack slots and +6 kg max load.", weight: 1, cat: "packs" },
  // The stealth kit (stealth.js). Throwables and the suppressor work from a pocket or the pack; thrown, a throwable is
  // gone (throw = the key in stealth.js THROWABLES). The suppressor wears a shot at a time (dur = shots).
  // Lights (lights.js): a ladder, each heavier and brighter. At night they set how far your people see in battle and how
  // much further off they are noticed, light a rummage, and keep a survey's night odds up; teams pack them on the way out.
  headlamp:   { name: "Headlamp",                 slot: "pack",   skill: null,       power: 0,   req: 0, value: 7,  noise: 0, small: true, desc: "Strapped on over anything, hands free: it works wherever it is carried. At night: see 8 tiles instead of 7 and search without fumbling; guards notice it a tile further off. The lightest light.", weight: 0.2, cat: "tools" },
  flashlight: { name: "Flashlight",               slot: "tool",   skill: null,       power: 0,   req: 0, value: 8,  noise: 0, small: true, desc: "In the off hand at night: see 9 tiles instead of 7 and search at full speed, but guards notice the light from 3 tiles further.", weight: 0.3, cat: "tools" },
  torch:      { name: "Torch",                    slot: "tool",   skill: null,       power: 0,   req: 0, value: 2,  noise: 0, desc: "A pitch-soaked branch, burning. In the off hand at night: see 9 tiles all around and search by it, but an open flame is seen from 4 tiles further. No batteries: anyone can make one from firewood.", weight: 0.7, cat: "tools" },
  lantern:    { name: "Lantern",                  slot: "tool",   skill: null,       power: 0,   req: 0, value: 12, noise: 0, desc: "A camping lantern. In the off hand at night: see 10 tiles all around; guards notice it from 4 tiles further.", weight: 1.2, cat: "tools" },
  spotlight:  { name: "Spotlight",                slot: "tool",   skill: null,       power: 0,   req: 0, value: 18, noise: 0, desc: "A handheld spotlight on a heavy battery pack. In the off hand at night: see 12 tiles down a long beam, nearly daylight, but it is seen from 6 tiles further. The heaviest light.", weight: 3.5, cat: "tools" },
  // Hand-crank radio (radio.js listeners): a receiver, never a transmitter (listen: true). A base holding one in
  // its armory or a team carrying one hears what a station would (news on the air, new voices on the scan, radio
  // rumours, callers in reach) but cannot call anyone: no group calls, no two-way contact for a team, no coverage
  // for others. The pocket radio is a thrown decoy; this one is the set you listen to, and it needs no batteries.
  handradio:  { name: "Hand-crank radio",         slot: "tool",   skill: null,       power: 0,   req: 0, value: 12, noise: 0, small: true, listen: true, weight: 0.5, cat: "electronics", desc: "A wind-up emergency receiver: a minute of cranking and it needs no batteries. It only listens. A base holding one in its armory or a team carrying one hears a radio network only while it is inside that network's coverage (tune in with Listen in: the team order, or the base's radio section) but cannot call in: no orders to a team out of coverage, no calls to groups, no coverage for anyone else." },
  suppressor: { name: "Oil-filter suppressor",    slot: "pack",   skill: null,       power: 0,   req: 0, value: 12, noise: 0, small: true, makeshift: true, dur: 12, suppressor: true, desc: "An oil filter threaded onto the muzzle. Carried by someone with a 9mm pistol or a rifle (hunting, lever-action, police carbine, assault; not a revolver or a shotgun), their shots make half the noise (half the Heat and earshot). Wears fast: 12 shots.", weight: 0.4, cat: "gunmod" },
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
  revolver:    { name: ".357 revolver",            slot: "weapon", skill: "shooting", power: 3.5, req: 3, value: 34, noise: 3, small: true, weight: 1.2, cat: "pistol", desc: "Six rounds, a kick and a bang: hits harder than a 9mm but louder, and no suppressor fits it. Needs Shooting 3." },
  leverrifle:  { name: "Lever-action rifle",       slot: "weapon", skill: "shooting", power: 4.5, req: 4, value: 45, noise: 3, weight: 3.4, cat: "rifle", desc: "A ranch rifle: accurate at range, lighter and handier than a bolt-action hunting rifle. Needs Shooting 4." },
  carbine:     { name: "Police carbine",           slot: "weapon", skill: "shooting", power: 6.5, req: 8, value: 95, noise: 3, weight: 3, cat: "rifle", desc: "A semi-automatic patrol rifle from a squad-car rack: quick, accurate follow-up shots, one round a shot. Needs Shooting 8." },
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
  // Camp kit against Heat (fieldheat.js, scavenge.js). heat.stay = × Heat gained on the spot (waiting, camping,
  // gathering...), heat.camp = only while camping, heat.search = × a search's Heat; a team counts each kind once.
  // scentmask is used up: 24 hours of cover from one (heat.hours).
  camonet:     { name: "Camo netting",             slot: "pack", skill: null, power: 0, req: 0, value: 18, noise: 0, heat: { stay: 0.75 }, desc: "Military netting thrown over the camp: a team that carries it gains Heat 25% slower while it stays in one place.", weight: 4, cat: "camp" },
  ghillie:     { burnShare: 1, name: "Ghillie wrap",             slot: "pack", skill: null, power: 0, req: 0, value: 10, noise: 0, makeshift: true, heat: { stay: 0.85, search: 0.9 }, desc: "Burlap strips and dried grass sewn onto a poncho: a team with one gains Heat 15% slower while it stays put and 10% slower while it searches.", weight: 1.5, cat: "camp" },
  scentmask:   { name: "Gore scent mask",          slot: "pack", skill: null, power: 0, req: 0, value: 3,  noise: 0, small: true, makeshift: true, heat: { stay: 0.6, search: 0.75, hours: 24 }, desc: "Rags soaked in what is left of the dead, sealed in a jar (or a hunter's cover-scent spray). Smeared on when the team stops or starts a search, the dead stop smelling the living for 24 hours: Heat 40% slower on the spot and 25% slower while searching. Used up.", weight: 0.4, cat: "camp" },
  ragboots:    { burnShare: 1, name: "Rag-wrapped boots",        slot: "pack", skill: null, power: 0, req: 0, value: 2,  noise: 0, small: true, makeshift: true, heat: { search: 0.85, stay: 0.95 }, desc: "Strips of blanket bound around the boots: soft steps. A team with them gains Heat 15% slower while searching and 5% slower on the spot.", weight: 0.5, cat: "camp" },
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
  firewood:    { name: "firewood", group: "survival" },
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
  town:     { name: "Town",           glyph: "T",  cat: "town",    danger: 1, loot: { food: 3, scrap: 3, meds: 0.4, ammo: 1, fuel: 0.3, jars: 0.5 }, gear: ["knife", "pistol", "shotgun", "sportspads", "bikehelmet", "bicycle", "bat", "revolver", "slingbag", "binoculars"], richness: 0.6, known: "public" },
  city:     { name: "City center",    glyph: "C",  cat: "urban",   danger: 2, loot: { scrap: 4, meds: 0.6, ammo: 2, parts: 1, food: 1 }, gear: ["pistol", "vest", "shotgun", "bat", "prybar", "revolver", "slingbag"], richness: 1.0, known: "public" },
  farm:     { name: "Farmstead",      glyph: "F",  cat: "rural",   danger: 0, loot: { food: 5, fuel: 0.4, scrap: 1, jars: 1, rawwater: 0.5 }, gear: ["huntrifle", "machete", "leverrifle", "shotgun", "sledge", "prybar", "barbedwire", "beartrap", "binoculars", "dewormer"], richness: 0.5, known: "road" },
  gas:      { name: "Gas station",    glyph: "G",  cat: "town",    danger: 1, loot: { fuel: 4, food: 2, scrap: 1 }, gear: ["pistol", "revolver", "prybar", "flashlight"], richness: 0.4, known: "public" },
  mall:     { name: "Mall",           glyph: "M",  cat: "urban",   danger: 2, loot: { food: 3, scrap: 3, meds: 0.4, parts: 1, jars: 0.25 }, gear: ["knife", "machete", "backpack", "bat", "compbow", "slingbag", "hikingpack", "duffle", "stove", "binoculars"], richness: 0.9, known: "public" },
  hospital: { name: "Hospital",       glyph: "+",  cat: "urban",   danger: 3, loot: { meds: 6, scrap: 1, parts: 1 }, gear: ["surgkit", "bandagekit", "fireaxe", "dewormer"], richness: 0.8, known: "public" },
  police:   { name: "Police station", glyph: "P",  cat: "urban",   danger: 2, loot: { ammo: 4, meds: 0.5, scrap: 1 }, gear: ["pistol", "shotgun", "vest", "riothelmet", "bicycle", "baton", "carbine", "riotarms", "riotlegs", "revolver", "binoculars"], richness: 0.7, known: "public" },
  military: { name: "National Guard base", glyph: "★", cat: "special", danger: 3, loot: { ammo: 5, parts: 2, fuel: 2, meds: 0.6 }, gear: ["ar", "plate", "vest", "riothelmet", "nvg", "milradio", "assaultpack", "rucksack", "carbine", "camonet", "sandbags", "barbedwire", "stove", "binoculars", "spotscope", "thermal"], richness: 1.1, known: "public" },
  prison:   { name: "State prison",   glyph: "#",  cat: "special", danger: 3, loot: { food: 2, scrap: 2, ammo: 1 }, gear: ["shotgun", "vest", "riothelmet", "baton", "riotarms", "riotlegs", "carbine"], richness: 0.7, known: "public" },
  univ:     { name: "University",     glyph: "U",  cat: "urban",   danger: 2, loot: { parts: 3, meds: 1, scrap: 2 }, gear: ["surgkit", "bandagekit", "bat", "fireaxe", "slingbag", "telescope"], richness: 0.8, known: "public" },
  dam:      { name: "Dam and power plant", glyph: "D", cat: "special", danger: 1, loot: { parts: 4, scrap: 3, fuel: 0.3 }, gear: ["sandbags", "prybar", "sledge", "flashlight"], richness: 0.7, known: "public" },
  airport:  { name: "Regional airport", glyph: "A", cat: "special", danger: 2, loot: { fuel: 4, parts: 2, scrap: 2 }, gear: ["pistol", "slingbag", "hikingpack", "backpack", "duffle"], richness: 0.8, known: "public" },
  factory:  { name: "Factory",        glyph: "I",  cat: "special", danger: 1, loot: { scrap: 5, parts: 2, fuel: 0.4 }, gear: ["crowbar", "prybar", "sledge", "barbedwire"], richness: 0.8, known: "public" },
  quarry:   { name: "Quarry",         glyph: "Q",  cat: "rural",   danger: 0, loot: { scrap: 3, fuel: 0.4 }, gear: ["sledge", "prybar", "crowbar"], richness: 0.4, known: "road" },
  // City blocks: lootier, and more of the dead.
  autoshop:    { name: "Auto shop",          glyph: "Au", cat: "urban", danger: 2, loot: { parts: 4, fuel: 1, scrap: 3 }, gear: ["crowbar", "spikedbat", "kneeguards", "bicycle", "prybar", "sledge", "flashlight"], richness: 0.7, known: "public" },
  pharmacy:    { name: "Pharmacy",           glyph: "Rx", cat: "urban", danger: 2, loot: { meds: 6, water: 1, food: 1 }, gear: ["bandagekit", "dewormer"], richness: 0.8, known: "public" },
  supermarket: { name: "Supermarket",        glyph: "S",  cat: "urban", danger: 2, loot: { food: 6, water: 4, meds: 0.4, scrap: 1, preserved: 1.5, jars: 0.5 }, gear: ["knife", "slingbag"], richness: 0.95, known: "public" },
  gunstore:    { name: "Gun store",          glyph: "Gu", cat: "urban", danger: 2, loot: { ammo: 6, scrap: 1 }, gear: ["pistol", "shotgun", "huntrifle", "vest", "kneeguards", "revolver", "leverrifle", "compbow", "xbow", "ghillie", "camonet", "binoculars", "spotscope", "monocular"], richness: 0.85, known: "public" },
  hardware:    { name: "Hardware store",     glyph: "H",  cat: "urban", danger: 2, loot: { scrap: 5, parts: 2, fuel: 0.3 }, gear: ["machete", "crowbar", "kneeguards", "flashlight", "bicycle", "prybar", "sledge", "fireaxe", "barbedwire", "beartrap", "sandbags", "binoculars"], richness: 0.8, known: "public" },
  apartments:  { name: "Apartment block",    glyph: "Ap", cat: "urban", danger: 2, loot: { food: 3, water: 2, meds: 0.5, scrap: 2, ammo: 1, jars: 0.5 }, gear: ["knife", "pistol", "bikehelmet", "backpack", "bicycle", "bat", "revolver", "slingbag"], richness: 0.8, known: "public" },
  office:      { name: "Office tower",       glyph: "O",  cat: "urban", danger: 2, loot: { scrap: 3, water: 2, parts: 1, meds: 0.4 }, gear: ["slingbag", "fireaxe"], richness: 0.6, known: "public" },
  school:      { name: "School",             glyph: "Sc", cat: "urban", danger: 2, loot: { food: 3, water: 2, meds: 0.5, scrap: 2, jars: 0.25 }, gear: ["sportspads", "footballhelmet", "backpack", "bicycle", "bat", "slingbag", "fireaxe"], richness: 0.6, known: "public" },
  firestation: { name: "Fire station",       glyph: "Fs", cat: "urban", danger: 2, loot: { meds: 1.5, fuel: 0.7, parts: 2, scrap: 1 }, gear: ["bikehelmet", "crowbar", "bandagekit", "bicycle", "fireaxe", "prybar", "sandbags"], richness: 0.7, known: "public" },
  warehouse:   { name: "Warehouse district", glyph: "W",  cat: "urban", danger: 2, loot: { scrap: 4, food: 3, parts: 2, fuel: 0.4, jars: 0.5 }, gear: ["crowbar", "prybar", "sledge", "sandbags", "slingbag"], richness: 0.9, known: "public" },
  // Small-town shops and services (police stations, auto shops, gas stations and pharmacies stand in towns too).
  grocery:     { name: "Grocery store",      glyph: "Gr", cat: "town",  danger: 1, loot: { food: 5, water: 2, meds: 0.4, scrap: 1, preserved: 1, jars: 0.75 }, gear: ["knife"], richness: 0.6, known: "public" },
  diner:       { name: "Diner",              glyph: "Di", cat: "town",  danger: 1, loot: { food: 5, water: 3, scrap: 1, jars: 0.75 }, gear: ["knife"], richness: 0.5, known: "public" },
  motel:       { name: "Motel",              glyph: "Mo", cat: "town",  danger: 1, loot: { food: 2, water: 2, meds: 0.5, scrap: 2, ammo: 1, jars: 0.25 }, gear: ["pistol", "knife", "backpack", "bicycle", "revolver", "slingbag"], richness: 0.5, known: "public" },
  church:      { name: "Church",             glyph: "†",  cat: "town",  danger: 1, loot: { food: 3, water: 3, meds: 0.4, scrap: 1, jars: 0.75 }, gear: ["bandagekit"], richness: 0.45, known: "public" },
  clinic:      { name: "Clinic",             glyph: "Cl", cat: "town",  danger: 1, loot: { meds: 5, water: 1, scrap: 1 }, gear: ["surgkit", "bandagekit", "dewormer"], richness: 0.55, known: "public" },
  feedstore:   { name: "Feed store",         glyph: "Fd", cat: "town",  danger: 0, loot: { food: 4, fuel: 0.8, scrap: 2, parts: 1, jars: 1 }, gear: ["machete", "huntrifle", "leverrifle", "barbedwire", "beartrap", "sledge"], richness: 0.5, known: "public" },
  // Countryside: sparse, quiet and poorer, often off the road.
  barn:        { name: "Barn",               glyph: "Br", cat: "rural", danger: 0, loot: { food: 3, fuel: 0.6, scrap: 2, jars: 0.5 }, gear: ["machete", "sledge", "prybar", "barbedwire", "beartrap"], richness: 0.35, known: "road" },
  ranch:       { name: "Ranch",              glyph: "R",  cat: "rural", danger: 0, loot: { food: 5, water: 2, ammo: 1, fuel: 0.3, jars: 0.75, preserved: 0.5 }, gear: ["huntrifle", "shotgun", "machete", "leverrifle", "revolver", "barbedwire", "beartrap", "binoculars", "dewormer"], richness: 0.55, known: "road" },
  cabin:       { name: "Cabin",              glyph: "Cb", cat: "rural", danger: 0, loot: { food: 2, ammo: 2, water: 1, meds: 0.4, preserved: 0.5, jars: 0.25 }, gear: ["huntrifle", "machete", "waterfilter", "leverrifle", "fireaxe", "beartrap", "stove", "ghillie", "monocular", "binoculars"], richness: 0.35, known: "road" },
  lodge:       { name: "Hunting lodge",      glyph: "L",  cat: "rural", danger: 0, loot: { ammo: 4, food: 3, meds: 0.4, preserved: 0.5 }, gear: ["huntrifle", "shotgun", "machete", "compbow", "xbow", "leverrifle", "ghillie", "camonet", "beartrap", "stove", "binoculars", "spotscope", "monocular"], richness: 0.55, known: "road" },
  campground:  { name: "Campground",         glyph: "Cg", cat: "rural", danger: 1, loot: { food: 2, water: 3, fuel: 0.3, scrap: 1, rawwater: 0.5 }, gear: ["knife", "pipespear", "waterfilter", "backpack", "bicycle", "hikingpack", "stove"], richness: 0.4, known: "road" },
  ranger:      { name: "Ranger station",     glyph: "Rs", cat: "rural", danger: 0, loot: { meds: 1, ammo: 2, food: 2, fuel: 0.3 }, gear: ["huntrifle", "bandagekit", "bicycle", "fireaxe", "hikingpack", "stove", "binoculars", "spotscope", "monocular"], richness: 0.5, known: "road" },
  radiotower:  { name: "Radio tower",        glyph: "Rt", cat: "rural", danger: 0, loot: { parts: 3, scrap: 2, fuel: 0.3 }, gear: ["flashlight", "prybar", "binoculars"], richness: 0.4, known: "road" },
  truckstop:   { name: "Truck stop",         glyph: "Ts", cat: "rural", danger: 1, loot: { fuel: 5, food: 3, parts: 1, scrap: 2, preserved: 0.5 }, gear: ["pistol", "shotgun", "revolver", "prybar", "slingbag", "hikingpack"], richness: 0.7, known: "public" },
  crashsite:   { name: "Crash site",         glyph: "X",  cat: "rural", danger: 1, loot: { scrap: 4, parts: 2, fuel: 0.8, meds: 0.4 }, gear: ["pistol", "slingbag", "backpack", "prybar"], richness: 0.6, known: "secret" },
  // Temporary sites from crash events (crashes.js): never placed by the map, they appear where something came down
  // and burn out after 7–10 days. temp: not a permanent site.
  crash_mil:   { name: "Army helicopter wreck", glyph: "✈", cat: "special", danger: 2, temp: true, loot: { ammo: 5, meds: 1.5, parts: 2, scrap: 2, fuel: 0.5 }, gear: ["ar", "vest", "plate", "riothelmet", "milradio", "nvg", "assaultpack", "rucksack", "carbine", "camonet", "thermal", "binoculars"], richness: 1.2, known: "secret" },
  crash_cargo: { name: "Supply plane wreck",  glyph: "✈", cat: "special", danger: 2, temp: true, loot: { food: 5, water: 3, meds: 1.5, preserved: 2, parts: 1, scrap: 2, fuel: 0.6 }, gear: ["assaultpack", "vest", "bandagekit", "surgkit", "rucksack", "stove"], richness: 1.2, known: "secret" },
  crash_med:   { name: "Medevac wreck",       glyph: "✈", cat: "special", danger: 2, temp: true, loot: { meds: 7, water: 2, scrap: 1, parts: 1 }, gear: ["surgkit", "bandagekit", "vest"], richness: 1.1, known: "secret" },
  crash_news:  { name: "News helicopter wreck", glyph: "✈", cat: "special", danger: 2, temp: true, loot: { parts: 3, scrap: 3, water: 1, food: 1, fuel: 0.4 }, gear: ["hikingpack", "slingbag"], richness: 0.9, known: "secret" },
  airdrop:     { name: "Supply drop",         glyph: "⇣", cat: "special", danger: 1, temp: true, loot: { food: 6, water: 4, meds: 2, ammo: 3, preserved: 2 }, gear: ["assaultpack", "vest", "bandagekit", "rucksack", "stove"], richness: 1.2, known: "secret" },
  // The abandoned military convoy (miltrucks.js): Army trucks stopped on a road tile, their turned crews about them;
  // stripped by other groups and burned out after 6–9 days. Its trucks hold most of what it is worth (truckLoot).
  convoy:      { name: "Abandoned Army convoy", glyph: "🪖", cat: "special", danger: 2, temp: true, loot: { ammo: 5, fuel: 2, food: 2, meds: 1, parts: 1.5 }, gear: ["ar", "carbine", "vest", "plate", "milhelmet", "milradio", "assaultpack", "rucksack", "smokegren", "flare"], richness: 0.9, known: "secret" },
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
// A background trait, given only by the hardcore start (hardcore-start.js: the one of the three who fled with a packed
// duffle bag) and never rolled at birth: it is not enumerable, so world.js makeSurvivor's Object.keys(TRAITS) draw
// does not see it (and no seed's rolls move), while TRAITS.prepper still resolves for the roster, the tooltips and
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
  fishrod:   { name: "Fishing rod",  slot: "pack", skill: null, power: 0, req: 0, value: 12, noise: 0, fish: "rod", weight: 0.8, cat: "tools", desc: "A telescopic rod and a tackle box. Fish on a river or a lake shore (team order, or the Fish job at a base by the water): about 0.6 food an hour, more at dawn and dusk." },
  fishnet:   { name: "Fishing net",  slot: "pack", skill: null, power: 0, req: 0, value: 18, noise: 0, fish: "net", weight: 2.5, cat: "tools", desc: "A gill net with floats: worked by two, it catches about twice what a rod does (1.2 food an hour)." },
  snarewire: { name: "Snare wire",   slot: "pack", skill: null, power: 0, req: 0, value: 6,  noise: 0, small: true, weight: 0.4, cat: "tools", desc: "A coil of brass wire: a line of 8 snares (team order, 2 hours). Quiet; about a rabbit a day in good country. The wire stays with the line and comes back when it is lifted." },
});
// Where they turn up: loot.js SITE_FINDS (their own dice, so adding them changes no other loot roll).
