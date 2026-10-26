// @ts-check
// Tools as prerequisites (the user's request 2026-10-21: "Add pre-requisite items needed to be in the base inventory to
// build certain buildings and craft certain items such as needing a tool kit item or axe or hammer etc ... multiple
// tools can be pre-requisites. Farms, hardware stores, cars have higher chances of having tool items to loot for
// building and crafting. For wood gathering if the survivor does not have an axe the yield is lower and with an axe it
// provides substantially more yield"). Plain data that imports nothing, merged like data-survival.js: data.js
// Object.assign(GEAR, TOOL_ITEMS), combat.js Object.assign(WEAPONS, TOOL_MELEE), loot.js Object.assign(ITEM_TAGS,
// TOOL_TAGS), crafting.js Object.assign(CRAFTS, TOOL_CRAFTS). The rules that read it: toolreqs.js.
//
// A tool KIND is what a job needs (a hammer, a saw, an axe…); any one of its items covers it (TOOL_KINDS). A build or
// a recipe lists the kinds it needs (BUILD_TOOLS, CRAFT_TOOLS): all of them, each by any item of that kind, kept at
// the base (its armory, or on someone there) when the job is queued; a team's field craft looks in what the team
// carries. Tools are not used up; the makeshift ones (toolWear) lose a use each job they are the only one of their
// kind for (toolreqs.js wearTools). Woodcutting: woodcutting.js WOOD.hands (bare hands) and the `chop` numbers here.

const W = "weapon", ML = "melee";
/** @type {Record<string, any>} */
export const TOOL_ITEMS = {
  // ---------- real tools ----------
  toolkit:     { name: "Tool kit",              slot: "pack", skill: null, power: 0, req: 0, value: 30, noise: 0, weight: 6, cat: "tools",
                 desc: "A steel box of hand tools: a claw hammer, a panel saw, screwdrivers, a set of spanners and sockets, pliers and side cutters, a tape and a level. Counts as a hammer, a saw, wrenches and pliers for building and crafting. Hardware stores, garages, farms and car trunks." },
  handsaw:     { name: "Hand saw",              slot: "pack", skill: null, power: 0, req: 0, value: 6,  noise: 0, weight: 0.7, cat: "tools",
                 desc: "A carpenter's panel saw: planks, beams and joints. Counts as a saw for building and crafting." },
  bowsaw:      { name: "Bow saw",               slot: "pack", skill: null, power: 0, req: 0, value: 10, noise: 0, weight: 1.1, cat: "tools", chop: 1.6,
                 desc: "A tubular steel bow with a coarse pruning blade: a saw for building and crafting, and it cuts wood far faster than bare hands (×1.6, an axe more)." },
  axe:         { name: "Felling axe",           slot: W, skill: ML, power: 2.3, req: 1, value: 18, noise: 0, pry: true, weight: 2.6, dur: 60, cat: "melee", chop: 2.2,
                 desc: "A long hickory handle and a heavy forged head: the best tool there is for cutting wood (×2.2, three times bare hands), an axe for building and crafting, and a brutal slow weapon that can stagger (20%; −4 to hit, Melee 1 to use well). Farms, hardware stores, cabins." },
  shovel:      { name: "Shovel",                slot: W, skill: ML, power: 1.6, req: 0, value: 6,  noise: 0, weight: 2, dur: 80, cat: "melee",
                 desc: "A long-handled round-point shovel: dig for a farm plot, a trench, a pit, a well, a cellar, sandbags. A club that staggers (25%) at a pinch." },
  handdrill:   { name: "Brace and bit",         slot: "pack", skill: null, power: 0, req: 0, value: 5,  noise: 0, weight: 1.3, cat: "tools",
                 desc: "A hand-cranked brace and a roll of auger bits: holes in wood and soft metal with no battery. Counts as a drill for building and crafting (a cordless power drill does too)." },
  welder:      { name: "Welding kit",           slot: "pack", skill: null, power: 0, req: 0, value: 45, noise: 0, weight: 9, cat: "tools",
                 desc: "A small inverter welder with a box of rods, a mask, gauntlets and a chipping hammer, run off a generator or car batteries: steel plate, gates, frames and machines. Garages, farms, factories and auto shops." },
  sewingkit:   { name: "Sewing kit",            slot: "pack", skill: null, power: 0, req: 0, value: 4,  noise: 0, small: true, weight: 0.2, cat: "tools",
                 desc: "Needles, heavy thread, an awl and a thimble in a tin: packs, straps, padding and ghillie suits." },
  // The electronics recipes (crafting.js, the user's request 2026-10-24): a soldering iron for the fine work on boards,
  // run off a car battery or the generator. Found at radio and electronics shops, hardware stores and tech sites
  // (loot.js SITE_FINDS / AREA_FINDS, data-shops.js ROWS), never made.
  solderiron:  { name: "Soldering iron",        slot: "pack", skill: null, power: 0, req: 0, value: 8,  noise: 0, small: true, weight: 0.3, cat: "tools",
                 desc: "A hobbyist's iron with a coil of solder, a sponge, flux, a desoldering pump and a roll of heat-shrink, run off a car battery or the generator. Counts as a soldering iron for crafting: a laser sight, electronic ear defenders, a hand-crank radio and the rest of the electronics recipes. Radio and electronics shops, hardware stores, workshops and labs." },
  // ---------- makeshift tools (crafted from scrap, anywhere: a team too; they wear out) ----------
  scraphammer: { name: "Makeshift hammer",      slot: "pack", skill: null, power: 0, req: 0, value: 1,  noise: 0, makeshift: true, toolWear: true, dur: 12, weight: 0.8, cat: "tools",
                 desc: "A steel bolt-head lashed to a stick: drives a nail. Counts as a hammer for building and crafting, about a dozen jobs before it falls apart." },
  scrapsaw:    { name: "Makeshift saw",         slot: "pack", skill: null, power: 0, req: 0, value: 1,  noise: 0, makeshift: true, toolWear: true, dur: 10, weight: 0.5, cat: "tools",
                 desc: "A hacksaw blade in a frame of bent rod: slow, but it cuts. Counts as a saw for building and crafting, about ten jobs before it falls apart." },
  scrapaxe:    { name: "Makeshift axe",         slot: W, skill: ML, power: 1.6, req: 0, value: 2,  noise: 0, makeshift: true, toolWear: true, dur: 10, weight: 1.4, cat: "melee", chop: 1.4,
                 desc: "A leaf-spring blade ground to an edge and wedged into a split branch: cuts wood (×1.4, twice bare hands), counts as an axe for building and crafting (about ten jobs), and a poor weapon." },
  scrapshovel: { name: "Makeshift shovel",      slot: "pack", skill: null, power: 0, req: 0, value: 1,  noise: 0, makeshift: true, toolWear: true, dur: 12, weight: 1.5, cat: "tools",
                 desc: "A hubcap beaten flat and bolted to a pole: it digs. Counts as a shovel for building and crafting, about a dozen jobs before it falls apart." },
};

// The melee numbers (combat.js WEAPONS): fields as data-guns.js's melee.
/** @type {Record<string, any>} */
export const TOOL_MELEE = {
  axe:      { name: "Felling axe",      melee: true, dmg: [22, 33], meleeAim: -4, mclass: "chop", stagger: 0.2, takedown: 5 },
  shovel:   { name: "Shovel",           melee: true, dmg: [15, 24], mclass: "blunt", stagger: 0.25, takedown: 10 },
  scrapaxe: { name: "Makeshift axe",    melee: true, dmg: [14, 22], mclass: "chop", takedown: 5 },
};

// What covers each kind of tool (any one of its items). Earlier items first: the ones that wear (toolWear) last.
/** @type {Record<string, { name: string, items: string[] }>} */
export const TOOL_KINDS = {
  hammer: { name: "a hammer",            items: ["toolkit", "hammer", "scraphammer"] },
  saw:    { name: "a saw",               items: ["toolkit", "handsaw", "bowsaw", "scrapsaw"] },
  axe:    { name: "an axe",              items: ["axe", "fireaxe", "hatchet", "tomahawk", "sheethatchet", "scrapaxe"] },
  dig:    { name: "a shovel",            items: ["shovel", "etool", "pickaxe", "scrapshovel"] },
  wrench: { name: "wrenches",            items: ["toolkit", "pipewrench"] },
  drill:  { name: "a drill",             items: ["powerdrill", "handdrill"] },
  pliers: { name: "pliers",              items: ["toolkit", "multitool", "repairkit"] },
  welder: { name: "a welding kit",       items: ["welder"] },
  sewing: { name: "a sewing kit",        items: ["sewingkit"] },
  solder: { name: "a soldering iron",    items: ["solderiron"] }, // the electronics recipes (2026-10-24): no makeshift one, a tool kit has none
};
// The makeshift recipe for a kind (the governor keeps the basic ones at its bases: toolreqs.js keepBasicTools).
export const TOOL_MAKESHIFT = { hammer: "scraphammer", saw: "scrapsaw", axe: "scrapaxe", dig: "scrapshovel", sewing: "sewingkit" };

// The makeshift tools and the sewing kit (crafting.js CRAFTS): scrap and a stick, anywhere, a team too; no tools needed.
/** @type {Record<string, any>} */
export const TOOL_CRAFTS = {
  scraphammer: { gear: "scraphammer", in: { scrap: 2, wood: 5 },  hours: 2, skill: "mechanics", min: 0, field: true },
  scrapsaw:    { gear: "scrapsaw",    in: { scrap: 2, wood: 5 },  hours: 3, skill: "mechanics", min: 1, field: true },
  scrapaxe:    { gear: "scrapaxe",    in: { scrap: 4, wood: 10 }, hours: 4, skill: "mechanics", min: 1, field: true },
  scrapshovel: { gear: "scrapshovel", in: { scrap: 3, wood: 10 }, hours: 3, skill: "mechanics", min: 0, field: true },
  sewingkit:   { gear: "sewingkit",   in: { scrap: 1 },           hours: 1, skill: "mechanics", min: 0, field: true },
};

// What each build needs (buildings.js BUILDINGS keys; a key not listed needs no tools). Wood work a hammer and a saw;
// digging a shovel; pipes, machines and engines wrenches; wiring pliers; bolted steel a drill; steel plate a welder.
// Housing, the general buildings and the step up into a base need no more than the hub's own tool shelf (world.js
// HUB_TOOLS) or the makeshift ones: beds and a base never wait on a rare find. A camp's essentials need none at all (a
// storage box, crates, barricades, a drying rack, a rain catcher, a tent, the cook fire; the step up into a shelter and
// establishing an outpost): a camp is set up with what people have to hand.
/** @type {Record<string, string[]>} */
export const BUILD_TOOLS = {
  // farming and food
  farm_plot: ["dig"], greenhouse: ["hammer", "saw"], animal_pen: ["hammer", "dig"], huntcabin: ["hammer", "saw"],
  kitchen: ["hammer", "saw"], canner: ["wrench"], canteen: ["hammer", "saw", "wrench"],
  cellar: ["dig", "hammer"], coldstore: ["dig", "hammer", "saw"], freezer: ["wrench", "drill", "pliers"], sealer: ["wrench", "pliers"],
  grainmill: ["wrench"], meatgrinder: ["wrench"], still: ["wrench"],
  // workshops
  craftbench: ["hammer", "saw"], workbench: ["hammer", "saw", "wrench"], toolbench: ["wrench", "drill", "welder"],
  ammo_bench: ["hammer", "wrench"], reload_bench: ["wrench"], med_station: ["hammer"], machine_shop: ["wrench", "drill", "welder"],
  garage: ["hammer", "saw", "wrench"], generator: ["wrench", "pliers"],
  // housing and the rooms
  bunkhouse: ["hammer", "saw"], barracks: ["hammer", "saw"], common_room: ["hammer", "saw"], chapel: ["hammer", "saw"],
  gen_hut: ["hammer", "saw"], gen_cabin: ["hammer", "saw"], gen_lodge: ["hammer", "saw"], gen_hall: ["hammer", "saw"], gen_barn: ["hammer", "saw"],
  bunks: ["hammer", "saw"], shelves: ["hammer", "saw"], lockers: ["wrench"], stove: ["wrench"],
  infirmary: ["hammer"], field_hosp: ["hammer", "saw"], clinic: ["hammer", "drill", "wrench"], hospital: ["drill", "wrench", "welder"],
  // storage
  shed: ["hammer", "saw"], storehouse: ["hammer", "saw"], warehouse: ["hammer", "wrench"],
  armory: ["drill", "welder"],
  // water
  well: ["dig", "wrench"], cistern: ["dig"], boiler: ["wrench"],
  // jails and the radio
  lockup: ["pliers"], cells: ["drill", "wrench"], jailhouse: ["hammer", "drill", "welder"],
  radio: ["drill", "wrench", "pliers"], relay: ["drill", "wrench", "pliers"],
  // walls and defences
  walls: ["hammer", "saw"], wall1: ["hammer", "saw"], wall2: ["hammer", "saw"], wall4: ["hammer", "saw"], gate4: ["hammer", "saw"],
  stand1: ["hammer", "saw"], stand2: ["hammer", "saw"], stand4: ["hammer", "saw"], watchtower: ["hammer", "saw"],
  spike_pits: ["dig"], barbed_wire: ["hammer", "pliers"], razor_wire: ["pliers"],
  sandbag_wall: ["dig"], sandbag1: ["dig"], trench: ["dig"], gate: ["drill", "welder"], floodlights: ["wrench", "pliers"],
  minefield: ["dig", "pliers"], guard_towers: ["hammer", "saw", "drill"],
  // the power grid (data-power.js): wiring pliers, bolted machines wrenches and a drill
  breaker: ["drill", "pliers"], ammo_press: ["wrench", "drill"], elec_pump: ["wrench", "pliers"], fence_charger: ["pliers"],
  // more of the grid (2026-10-24): the array's frame bolted and drilled and its strings wired, the bank's cables and
  // lugs, the alarm's sensors drilled in and wired, the heaters and the charger plugged and wired
  solar_array: ["wrench", "drill", "pliers"], battery_bank: ["wrench", "pliers"], perimeter_alarm: ["drill", "pliers"], elec_heater: ["pliers"], charging_station: ["pliers"],
  // stepping up a tier
  hub_up: ["hammer", "saw"],
};
// The wall pieces, the gates and the Ring wall by their material (buildings.js WALL_TIERS key; the stands stay
// BUILD_TOOLS): timber nailed and sawn, scrap bolted up, metal sheets welded.
/** @type {Record<string, string[]>} */
export const WALL_TOOLS = { wood: ["hammer", "saw"], logs: ["hammer", "saw"], scrap: ["hammer", "drill"], sheet: ["drill", "welder"] };
// What each recipe needs (crafting.js CRAFTS keys; a key not listed needs no tools).
/** @type {Record<string, string[]>} */
export const CRAFT_TOOLS = {
  spikedbat: ["hammer"], nailbat: ["hammer"], sawmachete: ["hammer"], bowie: ["hammer"], springmachete: ["hammer", "drill"],
  crossbow: ["saw", "drill"], pulleybow: ["saw", "drill"], pipegun: ["drill", "wrench"], pipebomb: ["drill"], suppressor: ["drill"], solventcan: ["drill"],
  fishrod: ["pliers"], beartrap: ["hammer", "wrench"], tripwire: ["pliers"],
  padding: ["sewing"], backpack: ["sewing"], slingbag: ["sewing"], makeshiftrig: ["sewing"], ghillie: ["sewing"], woodghillie: ["sewing"],
  scrapvest: ["drill", "pliers"], steelplate: ["hammer"], rivethelmet: ["hammer", "drill"],
  buildmat: ["hammer"], crowbar: ["hammer"], boards: ["saw"], ladder: ["hammer", "saw"], ram: ["saw", "wrench"],
  flashlight: ["pliers"], headlamp: ["pliers"], windlight: ["pliers"], lantern: ["pliers"], spotlight: ["pliers", "drill"], spotlamp: ["pliers", "drill"], repairkit: ["pliers"],
  bicycle: ["wrench"], wheelbarrow: ["hammer", "wrench"], handcart: ["hammer", "saw", "wrench"], cookpot: ["hammer"], recoilpad: ["saw"],
  cot: ["hammer", "saw"], bed: ["hammer", "saw"], bunkbed: ["hammer", "saw"], bigbed: ["hammer", "saw"],
  // The electronics recipes (crafting.js, 2026-10-24): wiring pliers, a clamp or a mount a drill, the boards a soldering
  // iron. The field decoy wants only pliers (a team carries a tool kit or a multitool).
  pocketradio: ["pliers"], handradio: ["pliers", "solder"], helmetlight: ["pliers"], weaponlight: ["pliers", "drill"],
  laser: ["solder", "drill"], eardef: ["solder", "pliers"], lasergrip: ["solder", "drill"], holopistol: ["solder", "drill"], rangefinder: ["solder", "pliers"],
  milradio: ["solder", "pliers"], // Crashlanding (2026-10-24): the broken military radio repaired (crafting.js)
};

// Where each is normally kept (loot.js ITEM_TAGS; tools/loottest.js).
/** @type {Record<string, string[]>} */
export const TOOL_TAGS = {
  toolkit: ["tools", "garage", "farm", "industry", "travel", "home"],
  handsaw: ["tools", "farm", "home", "garage", "shop"],
  bowsaw: ["tools", "farm", "outdoor", "camp", "shop", "travel"],
  axe: ["tools", "farm", "outdoor", "hunt", "shop", "garage", "travel"],
  shovel: ["tools", "farm", "garage", "home", "outdoor", "travel", "shop"],
  handdrill: ["tools", "farm", "home", "industry"],
  welder: ["tools", "garage", "farm", "industry"],
  sewingkit: ["home", "camp", "shop", "farm", "travel"],
  solderiron: ["tech", "tools", "shop", "industry", "office"], // the electronics recipes (2026-10-24)
  scraphammer: ["crime", "camp"], scrapsaw: ["crime", "camp"], scrapaxe: ["crime", "camp"], scrapshovel: ["crime", "camp"],
};

// Where they turn up (toolreqs.js, their own tables and dice, rolled last): a site's search hour by site type, a raid
// container by area type, a car's trunk (any car on a raid map: CAR_TOOLS), a trader's table by group type. p: the
// chance, items: weights. Farms, hardware stores and cars the most (the user's pick), then barns, sheds, garages, feed
// stores and the industrial sites.
/** @type {Record<string, { p: number, items: Record<string, number> }>} */
export const TOOL_FINDS = {
  // The shops as places (shops.js; a shop POI's search hour rolls this table by its own kind: shopshelves.js).
  pawnshop: { p: 0.06, items: { toolkit: 2, handdrill: 1, axe: 0.5, welder: 0.3, sewingkit: 0.5, solderiron: 0.5 } }, // pawned tools on the back shelf
  garden: { p: 0.12, items: { shovel: 3, axe: 2, handsaw: 1.5, bowsaw: 2 } }, // a garden centre's tool wall
  dealer: { p: 0.06, items: { toolkit: 3, welder: 0.6, shovel: 1 } }, // a car dealer's service bay
  radioshop: { p: 0.05, items: { toolkit: 2, handdrill: 1, sewingkit: 0.5, solderiron: 2 } }, // the repair bench
  hardware: { p: 0.16, items: { toolkit: 3, handsaw: 3, bowsaw: 2, axe: 2, shovel: 3, handdrill: 1.5, sewingkit: 1, hammer: 2, welder: 0.4, hatchet: 1, pipewrench: 1, solderiron: 0.5 } },
  farm: { p: 0.14, items: { toolkit: 2, handsaw: 2, bowsaw: 1.5, axe: 3, shovel: 3, handdrill: 1, welder: 0.6, sewingkit: 1, pickaxe: 1, hammer: 1 } },
  barn: { p: 0.1, items: { axe: 2, shovel: 3, handsaw: 1.5, bowsaw: 1, toolkit: 1, welder: 0.3, pickaxe: 1, hammer: 1 } },
  ranch: { p: 0.08, items: { axe: 2, shovel: 2, toolkit: 1, handsaw: 1, welder: 0.3, sewingkit: 1 } },
  feedstore: { p: 0.08, items: { shovel: 3, axe: 1.5, handsaw: 1, bowsaw: 1, sewingkit: 0.6, toolkit: 0.6 } },
  farmstand: { p: 0.05, items: { shovel: 2, handsaw: 1, sewingkit: 0.5 } },
  shed: { p: 0.1, items: { shovel: 3, handsaw: 2, bowsaw: 1.5, axe: 1.5, toolkit: 1, handdrill: 1, hammer: 1 } },
  garage: { p: 0.08, items: { toolkit: 3, handsaw: 1, shovel: 1, handdrill: 1, welder: 0.5, hammer: 1, pipewrench: 1 } },
  autoshop: { p: 0.08, items: { toolkit: 3, welder: 1, handdrill: 0.6, pipewrench: 1 } },
  gas: { p: 0.05, items: { toolkit: 2, shovel: 1, sewingkit: 0.3 } }, // the cars at the pumps and the shop's shelf
  truckstop: { p: 0.07, items: { toolkit: 2, shovel: 1.5, axe: 0.6, sewingkit: 0.6 } }, // the trucks and the parked cars
  crashsite: { p: 0.06, items: { toolkit: 2, shovel: 1, axe: 0.5 } }, // the wrecked cars' trunks
  factory: { p: 0.05, items: { toolkit: 2, welder: 1, handdrill: 1, pipewrench: 1 } },
  warehouse: { p: 0.04, items: { toolkit: 2, handsaw: 1, shovel: 1, handdrill: 0.6, welder: 0.3 } },
  quarry: { p: 0.05, items: { shovel: 2, toolkit: 1, pickaxe: 1, welder: 0.3 } },
  mineshack: { p: 0.05, items: { shovel: 2, toolkit: 1, pickaxe: 1, handdrill: 0.5 } },
  mine: { p: 0.08, items: { pickaxe: 3, shovel: 2, toolkit: 1, handdrill: 1, sledge: 1 } }, // issue #52: the mine's shops and the workings
  dam: { p: 0.03, items: { toolkit: 2, welder: 0.4, pipewrench: 1 } },
  radiotower: { p: 0.03, items: { toolkit: 2, handdrill: 1 } },
  cabin: { p: 0.05, items: { axe: 3, bowsaw: 2, handsaw: 1, shovel: 1, sewingkit: 1 } },
  lodge: { p: 0.03, items: { axe: 2, bowsaw: 1.5, sewingkit: 1 } },
  ranger: { p: 0.05, items: { axe: 2, bowsaw: 2, shovel: 2 } },
  campground: { p: 0.03, items: { bowsaw: 1.5, axe: 1, shovel: 1, sewingkit: 1.5 } },
  firestation: { p: 0.03, items: { toolkit: 1, shovel: 1, axe: 0.5 } },
  neighbourhood: { p: 0.03, items: { toolkit: 1.5, shovel: 2, handsaw: 1.5, sewingkit: 1.5, handdrill: 0.6, axe: 0.5 } }, // garages, driveways, sheds
  house: { p: 0.015, items: { sewingkit: 2, handsaw: 1, shovel: 1, toolkit: 0.6 } },
  town: { p: 0.015, items: { sewingkit: 2, toolkit: 1, shovel: 1, handsaw: 1 } },
  city: { p: 0.008, items: { sewingkit: 2, toolkit: 1 } },
  mall: { p: 0.02, items: { sewingkit: 2, toolkit: 1, handsaw: 0.6 } },
};
/** @type {Record<string, { p: number, items: Record<string, number> }>} */
export const AREA_TOOLS = {
  hardware: { p: 0.18, items: { toolkit: 3, handsaw: 3, bowsaw: 2, axe: 2, shovel: 3, handdrill: 1.5, welder: 0.4, sewingkit: 0.6 } }, // a hardware store's aisles (combat.js AREAS.hardware)
  pawnshop: { p: 0.05, items: { toolkit: 2, handdrill: 1, axe: 0.5 } },
  garden: { p: 0.1, items: { shovel: 3, axe: 2, bowsaw: 2, handsaw: 1 } },
  dealer: { p: 0.06, items: { toolkit: 3, welder: 0.6 } },
  workshop: { p: 0.1, items: { toolkit: 3, handsaw: 2, handdrill: 1.5, welder: 0.6, shovel: 0.6 } },
  garage: { p: 0.08, items: { toolkit: 3, shovel: 1.5, handsaw: 1, welder: 0.5, handdrill: 0.5 } },
  barn: { p: 0.1, items: { axe: 2, shovel: 3, handsaw: 1.5, bowsaw: 1, toolkit: 1, welder: 0.3 } },
  farmhouse: { p: 0.06, items: { axe: 1.5, shovel: 1.5, handsaw: 1, sewingkit: 1.5, toolkit: 1 } },
  warehouse: { p: 0.04, items: { toolkit: 2, handsaw: 1, shovel: 1 } },
  motorpool: { p: 0.05, items: { toolkit: 3, shovel: 1, welder: 0.4 } },
  enginebay: { p: 0.08, items: { axe: 2, toolkit: 2, shovel: 1.5, handsaw: 1 } }, // a fire station's engine bay (issue #15)
  hangar: { p: 0.04, items: { toolkit: 3, handdrill: 1, welder: 0.4 } },
  cabin: { p: 0.05, items: { axe: 2, bowsaw: 2, sewingkit: 1 } },
  campsite: { p: 0.03, items: { bowsaw: 1, axe: 1, shovel: 1, sewingkit: 1.5 } },
  house: { p: 0.02, items: { sewingkit: 2, handsaw: 1, toolkit: 0.5 } },
  store: { p: 0.02, items: { sewingkit: 1.5, handsaw: 1, shovel: 0.6 } },
};
// A car's trunk on any raid or battle map (a container of kind "car": the cars on the road, a wreck pile, a driveway):
// a jack and a tool roll, a shovel for the snow, an axe in a country pickup.
export const CAR_TOOLS = { p: 0.14, items: { toolkit: 3, shovel: 2, axe: 0.8, handsaw: 0.6, bowsaw: 0.4, sewingkit: 0.8, welder: 0.15 } };
/** @type {Record<string, { p: number, items: Record<string, number> }>} */
export const WARE_TOOLS = {
  traders: { p: 0.25, items: { toolkit: 2, handsaw: 2, axe: 2, shovel: 2, sewingkit: 1.5, handdrill: 1, bowsaw: 1, welder: 0.3, solderiron: 0.5 } },
  commune: { p: 0.2, items: { axe: 2, shovel: 2, handsaw: 2, sewingkit: 2, bowsaw: 1 } },
  merchants: { p: 0.3, items: { toolkit: 2, welder: 1, handdrill: 1, axe: 1, handsaw: 1, solderiron: 0.8 } },
  fortress: { p: 0.12, items: { toolkit: 1, shovel: 1, welder: 0.4 } },
  expansionist: { p: 0.1, items: { toolkit: 1, axe: 1, shovel: 1 } },
  raider: { p: 0.08, items: { axe: 1, scrapaxe: 1, toolkit: 0.5 } },
};

// The Help topic (ui/help.js, after "Survival guns and gear").
export const TOOL_HELP = `<b>Tools for building and crafting.</b> Most builds and many recipes need tools kept at the base (in its
  armory, or on someone there) when they are queued: wood work a hammer and a saw, digging a shovel (a farm plot, a well, a
  cellar, trenches, pits and sandbags), pipes and machines wrenches, wiring pliers, bolted steel a drill, steel plate a
  welding kit; packs, padding and ghillie suits a sewing kit; the finer electronics recipes (a laser, electronic ear
  defenders, a hand-crank radio, laser grips, a pistol red dot, a rangefinder) a soldering iron, found at radio shops,
  electronics stores and radio towers. A tool kit counts as a hammer, a saw, wrenches and pliers (not a soldering iron).
  A team's field craft looks in what the team carries. Tools are not used up; makeshift ones (a hammer, a saw, an axe and a
  shovel crafted from scrap anywhere) wear out after a dozen jobs or so. Hardware stores, farms, barns, sheds, garages and
  the trunks of cars hold the most. <b>Woodcutting</b>: bare hands only gather deadfall (×0.7); a felling axe cuts three
  times as much (×2.2), a fire axe ×2, a hatchet or a bow saw ×1.6, a tomahawk ×1.5, a makeshift axe ×1.4; a machete or a
  sledgehammer and wedges are little better than hands.`;
