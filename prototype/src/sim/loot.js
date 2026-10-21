// Small finds and the loot audit: what fits where.
//
// Equipment (weapons, armor, packs, tools, defences, camp kit) comes from a site's gear list (data.js LOCATIONS gear,
// the hour-by-hour search's gear roll) and from the containers of a raid map (combat.js AREAS gear). Small things,
// the valuables, comforts, toiletries, smokes and drink, throwables and odd kit, are "finds": a roll of their own each search
// hour (SITE_FINDS, with their own dice like the books in skills.js, so the rest of the search is unchanged) and
// one per raid container (AREA_FINDS).
//
// Theme tags: every site type, raid area and item has a few tags (what kind of place it is, where a thing is
// normally kept). tools/loottest.js checks that everything a site or area can hold shares a tag with it (no
// military radios in a university lab, no sledgehammers in a pharmacy), that every item has a source, and prints
// the table of sources per item.
import { GEAR } from "./data.js";
import { hash01 } from "./skills.js";
import { lootItem } from "./inventory.js";
import { siteSource, areaSource, traderSource } from "./itemcond.js"; // the condition finds come in, by source
import { ROSTER_TAGS } from "./data-guns.js";
import { rollHeadFind, rollAreaHead, headWares } from "./helmets.js"; // helmets and ear protection (their own dice)
import { BLADE_TAGS } from "./data-blades.js"; // knives and swords
import { rollBladeFind, rollAreaBlade, bladeWares } from "./blades.js"; // their own tables and dice, last
import { TOOL_TAGS } from "./data-tools.js"; // tools for building and crafting
import { rollToolFind, toolWares } from "./toolreqs.js"; // their own tables and dice, last of all
import { SURV_TAGS } from "./data-survival.js"; // survival gear
import { rollSurvFind, rollAreaSurv, survWares } from "./survival.js"; // its own tables and dice, after everything else
import { BOX_TAGS } from "./data-boxes.js"; // lockable boxes
import { rollBoxFind, rollAreaBox } from "./boxes.js"; // their own dice, last of all
import { KIT_TAGS } from "./data-kit.js"; // carry kit: magazines, rigs, plates (wave 2)
import { CART_TAGS } from "./data-carts.js"; // a wheelbarrow and a hand cart (carts.js)
import { BED_TAGS } from "./data-beds.js"; // beds as furniture (beds.js)
import { TENT_TAGS } from "./data-tents.js"; // tent bags (tents.js: TENT_FINDS, AREA_TENTS, their own dice)
import { rollSiteKit, rollAreaKit, kitWares } from "./carrykit.js"; // their own tables and dice, after the attachments
import { rollPartFind, rollAreaPart, partWares } from "./partfinds.js"; // the parts catalogue (2026-10-10): by tags and rarity, its own dice, last
import { PART_INFO } from "./data-gunmods.js"; // the catalogue's parts: where each is kept
import { NEW_KINDS, AREA_DEFS, ROWS, mergeRows } from "./data-shops.js"; // the shops and services new as places

// ---------- theme tags ----------
export const SITE_TAGS = {
  town: ["home", "shop", "sport", "garage", "crime"], city: ["home", "shop", "office", "crime", "police"],
  farm: ["farm", "home", "hunt", "tools"], gas: ["travel", "shop", "garage"], mall: ["mall", "shop", "sport", "tech", "home"],
  hospital: ["medical", "office"], police: ["police", "guns", "prison"], military: ["military", "guns", "camp"],
  prison: ["prison", "police", "guns", "crime"], univ: ["school", "office", "tech", "medical", "books"], dam: ["industry", "tools"],
  airport: ["travel", "tech", "crash"], factory: ["industry", "tools"], quarry: ["industry", "tools"],
  autoshop: ["garage", "tools"], pharmacy: ["medical", "shop"], supermarket: ["shop", "kitchen"], gunstore: ["guns", "hunt"],
  hardware: ["tools", "shop", "farm"], apartments: ["home", "kitchen"], office: ["office", "tech"], school: ["school", "sport", "books"],
  firestation: ["fire", "medical", "tools", "kitchen"], warehouse: ["industry", "tools", "shop"],
  grocery: ["shop", "kitchen"], diner: ["kitchen", "travel", "shop"], motel: ["travel", "home", "crime"], church: ["church", "home"],
  clinic: ["medical"], feedstore: ["farm", "tools", "shop"],
  barn: ["farm", "tools"], ranch: ["farm", "hunt", "home"], cabin: ["hunt", "outdoor", "home"], lodge: ["hunt", "outdoor", "camp"],
  campground: ["camp", "outdoor"], ranger: ["outdoor", "camp", "fire", "medical"], radiotower: ["tech", "industry", "tools"],
  truckstop: ["travel", "shop", "garage"], crashsite: ["travel", "crash", "garage"],
  crash_mil: ["military", "crash"], crash_cargo: ["crash", "camp", "medical"], crash_med: ["medical", "crash"],
  crash_news: ["tech", "crash"], airdrop: ["military", "camp", "medical"],
  convoy: ["military", "travel", "camp"], // miltrucks.js: an abandoned Army convoy
  // Points of interest (pois.js): the small places a tile holds besides its site.
  house: ["home", "kitchen"], neighbourhood: ["home", "kitchen", "garage"], garage: ["garage", "tools"], corner: ["shop", "kitchen"],
  pizza: ["kitchen", "shop"], farmstand: ["farm", "shop", "kitchen"], shed: ["tools", "farm", "garage"], blind: ["hunt", "outdoor"],
  campsite: ["camp", "outdoor"], hikercamp: ["camp", "outdoor"], mineshack: ["industry", "tools", "outdoor"],
  // A pawn shop (pois.js shopExtra, the city crawl): whatever people pawned, guns and camping gear behind the counter.
  pawnshop: ["shop", "guns", "hunt", "crime", "home", "outdoor", "camp", "tools", "sport", "tech", "travel"],
};
export const AREA_TAGS = {
  house: ["home", "kitchen"], farmhouse: ["home", "farm", "hunt"], store: ["shop"], kitchen: ["kitchen"], pharmacy: ["medical", "shop"],
  clinic: ["medical"], nurse: ["medical", "school"], garage: ["garage", "tools"], workshop: ["tools", "industry"], warehouse: ["industry", "shop", "tools"],
  office: ["office", "tech"], armory: ["police", "military", "guns"], barracks: ["military", "camp"], motorpool: ["military", "garage"],
  barn: ["farm", "tools"], lab: ["school", "tech", "medical"], cabin: ["hunt", "outdoor", "home"], hangar: ["travel", "industry", "garage"],
  cellblock: ["prison", "crime"], control: ["tech", "industry"], campsite: ["camp", "outdoor"], wreck: ["travel", "garage"],
  pumps: ["travel"], gunshop: ["guns", "hunt"], hardware: ["tools", "shop", "farm", "industry", "garage"], pawnshop: ["shop", "guns", "hunt", "crime", "home", "outdoor", "camp", "tools", "sport", "tech", "travel"], lockers: ["school", "sport"], chapel: ["church"],
  milwreck: ["military", "crash"], medwreck: ["medical", "crash"], newswreck: ["tech", "crash"], fuselage: ["crash", "travel"],
  cargodrop: ["crash", "camp", "military"],
  roadcars: ["travel", "home", "garage"], // the cars people fled in (combat.js AREAS.roadcars)
  miltrucks: ["military", "travel"], // Army trucks (miltrucks.js: their cargo is truckLoot)
};
// Where each thing is normally kept. Books are placed by skills.js BOOK_SITES and blueprints by blueprints.js.
export const ITEM_TAGS = {
  // weapons
  knife: ["home", "kitchen", "camp", "prison", "crime", "shop"], machete: ["farm", "outdoor", "tools", "hunt", "crime", "mall"],
  pistol: ["guns", "police", "home", "crime", "travel", "military", "crash"], shotgun: ["guns", "police", "home", "farm", "hunt", "prison", "crime", "military", "travel"],
  huntrifle: ["guns", "hunt", "farm", "outdoor", "crime"], ar: ["military", "guns", "crash"],
  bat: ["school", "sport", "home", "mall", "crime"], nailbat: ["crime"], prybar: ["garage", "tools", "industry", "fire", "farm", "crash", "crime"],
  fireaxe: ["fire", "office", "school", "tools", "outdoor", "medical"], sledge: ["tools", "farm", "industry", "garage"], baton: ["police", "prison"],
  compbow: ["hunt", "sport", "mall", "outdoor"], xbow: ["hunt", "guns"], revolver: ["home", "guns", "farm", "travel", "crime", "police"],
  leverrifle: ["hunt", "farm", "guns", "outdoor"], carbine: ["police", "prison", "military"],
  spear: ["hunt", "outdoor", "camp"],
  spikedbat: ["garage", "crime"], pipespear: ["camp", "crime"], sawmachete: ["crime", "tools"], sheetmachete: ["crime", "garage"], sheethatchet: ["crime", "garage"], crossbow: ["crime", "camp"], pipegun: ["crime"],
  // armor
  vest: ["police", "military", "guns", "prison", "crash", "crime"], plate: ["military", "crash"], bikehelmet: ["home", "garage", "fire", "sport", "crime"],
  riothelmet: ["police", "prison", "military", "crash"], milhelmet: ["military", "crash"], kneeguards: ["garage", "guns", "tools", "sport", "crime"],
  riotarms: ["police", "prison"], riotlegs: ["police", "prison"],
  padding: ["camp", "crime", "home"], shinguards: ["crime"], tirevest: ["crime", "garage"], sportspads: ["school", "sport", "home"],
  footballhelmet: ["school", "sport"], goaliemask: ["sport", "school"], scrapvest: ["crime"], sheetvest: ["crime"], sheetarms: ["crime"], sheetlegs: ["crime"],
  // packs
  slingbag: ["home", "school", "mall", "office", "travel", "crash", "crime", "shop"], backpack: ["school", "home", "mall", "travel", "crime", "camp"],
  hikingpack: ["camp", "outdoor", "mall", "travel", "crash", "shop"], duffle: ["travel", "mall", "outdoor", "shop"], assaultpack: ["military", "crash", "camp"], rucksack: ["military", "camp", "crash", "outdoor"],
  // tools and kits
  nvg: ["military", "crash"], milradio: ["military", "crash"], surgkit: ["medical", "crash"], dewormer: ["medical", "farm"], // dewormer: worm.js (a farm's livestock wormer)
  bandagekit: ["medical", "church", "fire", "outdoor", "camp", "home"], crowbar: ["garage", "tools", "industry", "fire"],
  monocular: ["hunt", "outdoor", "guns", "camp", "home", "military", "travel"], binoculars: ["hunt", "outdoor", "guns", "military", "police", "home", "sport", "farm", "tech", "crash", "camp", "tools"],
  spotscope: ["hunt", "guns", "military", "outdoor"], thermal: ["military", "crash"], telescope: ["school", "tech", "home"],
  waterfilter: ["camp", "outdoor"], flashlight: ["home", "garage", "tools", "shop", "military", "police", "camp", "industry"],
  headlamp: ["camp", "outdoor", "tools", "garage", "industry", "fire", "military"], torch: ["camp", "outdoor"], lantern: ["camp", "outdoor", "farm", "home", "shop"],
  spotlight: ["police", "fire", "industry", "military", "tools", "garage"],
  windlight: ["home", "camp", "outdoor", "shop", "travel", "tools"], tacflash: ["military", "police", "guns"], // vision.js: the wind-up and the military flashlight
  // The hand-crank radio (radio.js listeners: hears, cannot call) and purification tablets (worm.js): camping and
  // travel places, pharmacies and clinics, supply drops.
  handradio: ["home", "camp", "outdoor", "travel", "shop", "tech", "fire"], puritabs: ["medical", "camp", "outdoor", "travel", "military", "crash"],
  cuffs: ["police", "prison"], bicycle: ["home", "school", "garage", "police", "camp", "outdoor", "fire", "tools", "travel"],
  // the stealth kit and throwables
  suppressor: ["crime", "guns"],
  // gun attachments (gunmods.js): gun counters, police and army armouries, hunting places; sports shelves for the cheap ones
  reddot: ["guns", "police", "military", "sport", "hunt", "crime"], holo: ["military", "police", "guns"], scope4x: ["guns", "hunt", "military"],
  laser: ["guns", "police", "crime", "sport"], foregrip: ["guns", "military", "police"], bipod: ["guns", "hunt", "military"],
  pistolcan: ["guns", "military", "crime"], riflecan: ["military", "guns"], brake: ["guns", "hunt", "military"], comp: ["guns", "police", "sport"],
  choke: ["guns", "hunt", "farm", "sport"], extmag: ["guns", "police", "crime"], drum: ["military", "guns"], tubeext: ["guns", "police", "hunt"],
  // the weapons overhaul's attachments (gunmods.js, data-gunmods.js) and the repair kits (repair.js); the M203 in army
  // stock (SITE_LAUNCHERS, AREA_LAUNCHERS: their own dice) and under soldiers' rifles (gunmods.js ENEMY_MODS) since the
  // launcher wave
  tritium: ["guns", "police"], rmr: ["guns", "police"], acog: ["military", "crash"], lpvo: ["military"], tacscope: ["military", "guns"],
  thermalscope: ["military"], scrapscope: ["crime", "camp"], scopemount: ["guns", "hunt"], sidemount: ["guns", "crime"],
  quadrail: ["military", "guns"], mlok: ["military", "guns"], can22: ["guns", "hunt"], can9: ["police", "military"], can556: ["military"],
  can308: ["military", "guns"], can12: ["guns", "military"], bottlecan: ["crime", "camp"], solventcan: ["crime", "guns", "tools"],
  flashhider: ["guns", "military"], recoilpad: ["guns", "hunt", "farm", "sport", "police"], collapsible: ["military", "police"],
  precision: ["military", "guns"], foldstock: ["crime", "guns"], anglegrip: ["guns", "military", "police"], revgrip: ["guns", "police", "home"],
  weaponlight: ["guns", "police", "military"], peq: ["military"], sling: ["guns", "hunt", "military", "police", "sport", "outdoor", "farm"],
  m203: ["military"], repairkit: ["tools", "garage", "military", "guns", "camp"], kevlarkit: ["police", "military"],
  bottle: ["kitchen", "home", "crime", "travel"], noisemaker: ["crime"], firecracker: ["shop", "travel"],
  pipebomb: ["crime", "industry"], molotov: ["crime"], flare: ["travel", "garage", "fire", "police", "military", "crash", "outdoor", "camp"],
  smokegren: ["police", "military", "crash", "prison"], gamecall: ["hunt", "outdoor", "sport"],
  flashbang: ["police", "military", "prison", "crash", "guns"], // throwables.js FLASH: SWAT, riot squads and the Army
  // siege kit and decoys (siege.js, decoys.js)
  frag: ["military", "crash", "guns"], ladder: ["tools", "farm", "fire"], ram: ["fire", "police"],
  alarmclock: ["home", "kitchen", "travel", "shop"], pocketradio: ["home", "travel", "camp", "outdoor", "shop"],
  handwarmer: ["outdoor", "camp", "sport", "hunt", "travel"], heatpack: ["medical", "outdoor", "fire", "camp", "military"],
  // base defences
  barbedwire: ["farm", "tools", "military", "industry", "prison"], boards: ["farm", "tools"], beartrap: ["hunt", "farm", "outdoor", "tools"],
  tripwire: ["camp", "crime", "military", "outdoor", "tools"], sandbags: ["military", "fire", "industry", "tools"],
  // boards and nails (barricade.js): a farmstead's and a hardware store's gear (data.js LOCATIONS), where lumber and
  // nails are kept: workshops, barns and sheds, building sites
  boards: ["tools", "farm", "industry"],
  // camp kit against Heat
  // hunting.js: snares and fishing gear
  snarewire: ["farm", "hunt", "outdoor", "tools", "camp"], fishrod: ["outdoor", "hunt", "camp", "tools", "shop", "sport"], fishnet: ["outdoor", "hunt", "camp", "farm", "tools"],
  camonet: ["military", "hunt", "crash"], ghillie: ["hunt", "guns", "military"], scentmask: ["camp", "crime", "hunt"],
  ragboots: ["camp", "crime", "home"], stove: ["camp", "outdoor", "military", "hunt", "mall"],
  // comforts and things to use up
  cards: ["home", "travel", "prison", "camp", "military", "church", "kitchen"], harmonica: ["home", "camp", "outdoor", "travel"],
  guitar: ["home", "school", "camp", "church"], photos: ["home", "travel", "crash", "church", "office"],
  chocolate: ["shop", "kitchen", "travel", "school", "military", "medical", "crash", "camp"],
  instcoffee: ["kitchen", "office", "shop", "travel", "military", "camp", "fire"],
  smokes: ["travel", "shop", "crime", "prison", "military", "home", "kitchen", "office"], vodka: ["home", "crime", "kitchen", "shop", "travel"],
  // valuables
  goldring: ["home", "mall", "church", "crime", "travel"], goldchain: ["home", "mall", "crime"], watch: ["home", "mall", "office", "travel", "crime"],
  diamond: ["mall", "home"], pearls: ["home", "mall"], silverware: ["home", "church", "kitchen"],
  cigarettes: ["travel", "shop", "crime", "prison", "military"], cigars: ["travel", "office", "hunt", "crime"], tobacco: ["travel", "shop", "farm", "prison", "crime", "home"],
  whiskey: ["home", "crime", "hunt", "travel", "kitchen", "shop", "farm"], wine: ["home", "kitchen", "church", "shop"], scotch: ["office", "travel", "home", "hunt"],
  coffee: ["kitchen", "shop", "office", "travel", "military", "camp", "crash"], tea: ["kitchen", "shop", "home", "church"],
  candy: ["shop", "school", "travel", "kitchen", "medical"], honey: ["farm", "kitchen", "shop", "home"],
  phone: ["home", "office", "school", "mall", "travel", "tech", "crash"], console: ["home", "school", "mall", "tech"],
  camera: ["mall", "tech", "travel", "home", "crash"], laptop: ["office", "tech", "school", "home", "crash"],
  coins: ["home", "church", "mall", "crime"], tcards: ["home", "school", "mall"], vinyl: ["home", "mall"], stamps: ["home", "office"],
  batteries: ["shop", "home", "tools", "tech", "military", "garage", "travel", "crash"], lighters: ["travel", "shop", "home", "crime", "kitchen", "camp", "garage"],
  toiletpaper: ["shop", "home", "medical", "office", "school", "travel", "industry"], soap: ["shop", "home", "medical", "travel", "church"],
  razors: ["shop", "home", "medical", "prison", "travel"], candles: ["church", "home", "shop", "kitchen"],
  // toiletries (comforts.js groomLines)
  deodorant: ["home", "shop", "medical", "travel", "sport", "school", "military", "prison", "camp"],
  toothpaste: ["home", "shop", "medical", "travel", "military", "prison", "camp", "church"],
  shampoo: ["home", "shop", "travel", "sport"], wetwipes: ["home", "shop", "medical", "travel", "camp", "outdoor", "military", "crash"],
  lipbalm: ["home", "shop", "medical", "outdoor", "sport", "school", "travel", "camp"],
  makeup: ["home", "mall", "shop", "travel", "school", "office"], perfume: ["mall", "home", "shop", "travel", "crash"],
};
Object.assign(ITEM_TAGS, ROSTER_TAGS); // the weapons overhaul's guns and melee weapons (data-guns.js)
// Helmets, visors, helmet mounts and ear protection (helmets.js: HEAD_FINDS, AREA_HEAD, WARE_HEAD, their own dice).
Object.assign(ITEM_TAGS, {
  hardhat: ["tools", "industry"], earmuffs: ["guns", "tools", "industry"], eardef: ["guns", "police"], earplugs: ["guns", "tools", "industry", "military"],
  commset: ["military"], highcut: ["military"], ballvisor: ["military"], riotvisor: ["police", "prison"],
  helmetlight: ["tools", "police", "military"], nvgmount: ["tools", "military"],
});
// The launchers' rounds (data-ammo.js boxes; launchers.js): army stock.
Object.assign(ITEM_TAGS, { a_40mm_he: ["military", "crash"], a_40mm_buck: ["military"], a_40mm_smoke: ["military", "crash"], a_40mm_illum: ["military", "crash"], a_rocket_heat: ["military", "crime"] });
Object.assign(ITEM_TAGS, KIT_TAGS); // the carry kit (data-kit.js)
for (const [k, i] of Object.entries(PART_INFO)) ITEM_TAGS[k] = [...i.tags]; // the parts catalogue (data-gunmods.js; budget clones at home, brands at the armoury)
Object.assign(ITEM_TAGS, BLADE_TAGS); // knives and swords (data-blades.js)
Object.assign(ITEM_TAGS, SURV_TAGS); // survival gear (data-survival.js)
Object.assign(ITEM_TAGS, TOOL_TAGS); // tools for building and crafting (data-tools.js)
Object.assign(ITEM_TAGS, BOX_TAGS); // lockable boxes (data-boxes.js)
Object.assign(ITEM_TAGS, CART_TAGS); // carts (data-carts.js)
Object.assign(ITEM_TAGS, BED_TAGS); // beds as furniture (data-beds.js)
Object.assign(ITEM_TAGS, TENT_TAGS); // tent bags (data-tents.js)

// ---------- small finds per site type (the hour-by-hour search) ----------
// p = chance per search hour at full loot (× the approach's pace, Treasure Hunter ×2); items = weights.
export const SITE_FINDS = {
  town: { p: 0.141, items: { goldring: 2, watch: 1, coins: 1, phone: 2, photos: 2, cards: 1, smokes: 2, vodka: 1, chocolate: 1, batteries: 1, lighters: 1, toiletpaper: 1, candles: 1, deodorant: 1, toothpaste: 0.5, shampoo: 0.5, makeup: 0.5, lipbalm: 0.5 } },
  city: { p: 0.137, items: { watch: 2, goldchain: 1, phone: 3, laptop: 1, camera: 1, console: 1, smokes: 2, cigarettes: 1, lighters: 1, chocolate: 1, deodorant: 1, makeup: 0.5, perfume: 0.5 } },
  farm: { p: 0.08, items: { tobacco: 1, honey: 2, photos: 1, whiskey: 1, candles: 1, cards: 1 } },
  gas: { p: 0.163, items: { cigarettes: 2, smokes: 3, lighters: 3, candy: 2, chocolate: 2, instcoffee: 1, flare: 3, firecracker: 2, batteries: 2, bottle: 1, handradio: 0.5, wetwipes: 1, lipbalm: 1, deodorant: 1, toothpaste: 0.5 } },
  mall: { p: 0.24, items: { goldring: 1, goldchain: 2, watch: 2, diamond: 0.4, pearls: 1, phone: 2, console: 2, camera: 2, laptop: 1, vinyl: 1, tcards: 1, candles: 1, chocolate: 1, cards: 1, guitar: 0.5, harmonica: 0.5, perfume: 2, makeup: 1.5, deodorant: 1, shampoo: 1, lipbalm: 1 } },
  hospital: { p: 0.124, items: { chocolate: 2, candy: 2, soap: 2, razors: 1, toiletpaper: 2, photos: 1, puritabs: 1, toothpaste: 2, wetwipes: 2, lipbalm: 1, deodorant: 1 } },
  police: { p: 0.12, items: { cuffs: 3, smokegren: 1.5, flare: 2, smokes: 1, cigarettes: 1 } },
  military: { p: 0.145, items: { frag: 1.5, heatpack: 1, cigarettes: 2, chocolate: 2, instcoffee: 2, coffee: 0.5, smokegren: 2, flare: 2, batteries: 2, cards: 1, puritabs: 0.5, toothpaste: 1, deodorant: 1, wetwipes: 1.5 } },
  prison: { p: 0.147, items: { tobacco: 3, cigarettes: 2, cards: 2, smokegren: 1, cuffs: 2, razors: 1, toothpaste: 1.5, deodorant: 1 } },
  univ: { p: 0.148, items: { phone: 2, laptop: 2, console: 1, camera: 1, candy: 1, guitar: 0.5, toiletpaper: 1, deodorant: 1, makeup: 0.5, lipbalm: 0.5 } },
  dam: { p: 0.06, items: { batteries: 2, toiletpaper: 1 } },
  airport: { p: 0.217, items: { cigarettes: 2, cigars: 1, scotch: 1, watch: 2, phone: 2, laptop: 1, camera: 1, smokes: 1, photos: 1, candy: 1, flare: 1, perfume: 2, makeup: 1, wetwipes: 1, toothpaste: 1 } },
  factory: { p: 0.06, items: { batteries: 1, toiletpaper: 1 } },
  quarry: { p: 0.05, items: { pipebomb: 1, batteries: 1 } },
  autoshop: { p: 0.08, items: { lighters: 2, flare: 2, batteries: 2 } },
  pharmacy: { p: 0.285, items: { razors: 2, soap: 2, toiletpaper: 2, candy: 2, chocolate: 1, batteries: 1, smokes: 1, puritabs: 2, deodorant: 3, toothpaste: 3, shampoo: 2, wetwipes: 2, lipbalm: 2, makeup: 1, perfume: 0.5 } },
  supermarket: { p: 0.216, items: { chocolate: 3, instcoffee: 2, candy: 2, tea: 2, honey: 1, smokes: 2, cigarettes: 1, vodka: 1, wine: 2, whiskey: 0.5, coffee: 0.5, toiletpaper: 2, soap: 1, candles: 1, batteries: 1, lighters: 1, deodorant: 2, toothpaste: 2, shampoo: 2, wetwipes: 1, lipbalm: 1 } },
  gunstore: { p: 0.08, items: { gamecall: 2, scentmask: 1, monocular: 1 } },
  pawnshop: { p: 0.22, items: { goldring: 3, goldchain: 2, watch: 3, diamond: 0.5, pearls: 1, coins: 2, stamps: 1, silverware: 1, vinyl: 1, tcards: 1, guitar: 1, harmonica: 1, camera: 2, laptop: 1.5, console: 1.5, phone: 2, batteries: 1, lighters: 1, gamecall: 0.5, handradio: 0.5 } },
  hardware: { p: 0.1, items: { batteries: 3, lighters: 2, tripwire: 1, candles: 1, toiletpaper: 1, handradio: 0.5 } },
  apartments: { p: 0.18, items: { goldring: 2, watch: 1, pearls: 1, silverware: 0.5, coins: 1, stamps: 0.5, vinyl: 1, phone: 2, laptop: 1, console: 1, photos: 3, cards: 1, guitar: 0.5, harmonica: 0.5, vodka: 1, wine: 1, smokes: 1, chocolate: 1, candles: 1, deodorant: 2, toothpaste: 1, shampoo: 1, makeup: 1, perfume: 0.5, lipbalm: 0.5 } },
  office: { p: 0.125, items: { phone: 3, laptop: 2, watch: 1, instcoffee: 2, coffee: 0.5, photos: 2, scotch: 0.5, cigars: 0.5, stamps: 0.5, toiletpaper: 1, makeup: 0.5 } },
  school: { p: 0.154, items: { candy: 2, phone: 2, console: 2, tcards: 2, guitar: 0.5, chocolate: 1, toiletpaper: 1, deodorant: 1.5, lipbalm: 1, makeup: 0.5 } },
  firestation: { p: 0.118, items: { heatpack: 2, flare: 3, instcoffee: 2, cards: 2, chocolate: 1, batteries: 1, deodorant: 1, toothpaste: 1 } },
  warehouse: { p: 0.122, items: { toiletpaper: 3, batteries: 2, soap: 1, lighters: 1, candles: 1, cigarettes: 1, deodorant: 1, shampoo: 1 } },
  grocery: { p: 0.174, items: { chocolate: 2, instcoffee: 2, coffee: 0.5, candy: 2, tea: 1, honey: 1, smokes: 2, vodka: 1, wine: 1, toiletpaper: 1, soap: 1, lighters: 1, batteries: 1, deodorant: 1, toothpaste: 1, shampoo: 1, wetwipes: 1 } },
  diner: { p: 0.12, items: { instcoffee: 3, candy: 2, chocolate: 1, smokes: 1, cards: 1, bottle: 2, lighters: 1 } },
  motel: { p: 0.154, items: { alarmclock: 1.5, pocketradio: 0.5, smokes: 2, vodka: 2, cards: 2, photos: 1, watch: 1, goldring: 1, phone: 1, soap: 2, razors: 1, guitar: 0.3, shampoo: 2, toothpaste: 1, deodorant: 1, perfume: 0.3 } },
  church: { p: 0.105, items: { candles: 4, wine: 2, coins: 1, silverware: 1, photos: 1, goldring: 0.5, tea: 1, cards: 0.5, toothpaste: 0.5 } },
  clinic: { p: 0.098, items: { candy: 1, soap: 1, razors: 1, toiletpaper: 1, chocolate: 1, puritabs: 1.5, wetwipes: 1, lipbalm: 0.5 } },
  feedstore: { p: 0.08, items: { tobacco: 1, honey: 1, batteries: 1, lighters: 1 } },
  barn: { p: 0.05, items: { tobacco: 1, whiskey: 1 } },
  ranch: { p: 0.08, items: { whiskey: 1, tobacco: 1, cigars: 0.5, photos: 1, coins: 0.5, harmonica: 1, guitar: 0.5 } },
  cabin: { p: 0.08, items: { whiskey: 1, harmonica: 1, cards: 1, photos: 1, scentmask: 0.5, gamecall: 0.5, honey: 0.5, candles: 1, handradio: 0.5 } },
  lodge: { p: 0.1, items: { handwarmer: 2, handradio: 0.5, puritabs: 0.5, gamecall: 3, scentmask: 2, whiskey: 2, cigars: 1, scotch: 0.5, cards: 1, flare: 1, monocular: 1 } },
  campground: { p: 0.116, items: { handwarmer: 1.5, pocketradio: 1, handradio: 1, puritabs: 1.5, heatpack: 0.5, cards: 1, harmonica: 1, guitar: 0.5, chocolate: 1, instcoffee: 1, lighters: 1, ragboots: 1, scentmask: 1, tripwire: 1, flare: 1, monocular: 0.5, wetwipes: 1.5, lipbalm: 0.5, toothpaste: 0.5 } },
  ranger: { p: 0.08, items: { heatpack: 1, handwarmer: 1, flare: 2, instcoffee: 1, chocolate: 1, cards: 1, monocular: 1, handradio: 1, puritabs: 1 } },
  radiotower: { p: 0.05, items: { batteries: 3, toiletpaper: 1 } },
  truckstop: { p: 0.187, items: { pocketradio: 1, handradio: 1, puritabs: 1, handwarmer: 1, alarmclock: 0.5, cigarettes: 2, smokes: 3, lighters: 2, candy: 2, chocolate: 2, instcoffee: 2, flare: 2, vodka: 1, batteries: 1, tobacco: 1, cards: 1, watch: 0.5, deodorant: 1, wetwipes: 1, toothpaste: 1, lipbalm: 1 } },
  crashsite: { p: 0.1, items: { flare: 2, phone: 2, smokes: 1, photos: 2, lighters: 1, goldring: 0.5, watch: 0.5 } },
  crash_mil: { p: 0.14, items: { frag: 1.5, smokegren: 3, flare: 2, chocolate: 2, cigarettes: 1, instcoffee: 1 } },
  convoy: { p: 0.12, items: { frag: 1, smokegren: 2, flare: 2, chocolate: 2, cigarettes: 1, instcoffee: 1 } },
  crash_cargo: { p: 0.171, items: { chocolate: 2, instcoffee: 2, coffee: 1, batteries: 2, toiletpaper: 1, puritabs: 1, wetwipes: 1, toothpaste: 1 } },
  crash_med: { p: 0.125, items: { chocolate: 1, candy: 1, soap: 1, razors: 1, wetwipes: 1 } },
  crash_news: { p: 0.14, items: { camera: 3, phone: 2, laptop: 2, batteries: 1 } },
  airdrop: { p: 0.169, items: { chocolate: 3, instcoffee: 2, smokegren: 0.5, flare: 1, batteries: 1, cigarettes: 1, puritabs: 1, wetwipes: 1, toothpaste: 1 } },
};

// Hunting and fishing gear (hunting.js) at the sites where people kept it: a roll of its own each search hour, apart
// from the small finds (so adding it changed no other find).
export const HUNT_FINDS = {
  farm: { p: 0.03, items: { snarewire: 1 } }, barn: { p: 0.03, items: { snarewire: 1 } }, ranch: { p: 0.04, items: { snarewire: 1 } },
  hardware: { p: 0.05, items: { fishrod: 1, snarewire: 1 } }, feedstore: { p: 0.04, items: { snarewire: 2, fishnet: 1 } },
  cabin: { p: 0.06, items: { fishrod: 1, snarewire: 1, spear: 0.4 } }, lodge: { p: 0.08, items: { fishrod: 1.5, snarewire: 1.5, fishnet: 1, spear: 0.8 } },
  campground: { p: 0.06, items: { fishrod: 2, fishnet: 1, spear: 0.3 } }, ranger: { p: 0.05, items: { snarewire: 1, fishrod: 1, spear: 0.4 } },
};

// Gun attachments (gunmods.js) where guns are kept: a roll of its own each search hour (GUNMOD_FINDS; its own dice, so
// adding them changed no other find), and one per raid container in an armoury, a gun shop, barracks or an army wreck
// (AREA_GUNMODS). Weights: the cheap parts most often, the proper suppressors and drums rarely.
export const GUNMOD_FINDS = {
  gunstore: { p: 0.12, items: { reddot: 3, scope4x: 2, laser: 2, comp: 2, extmag: 2, choke: 2, tubeext: 1.5, bipod: 1.5, brake: 1.5, foregrip: 1, holo: 1, pistolcan: 0.4, riflecan: 0.3 } },
  police: { p: 0.06, items: { reddot: 2, laser: 2, extmag: 2, tubeext: 1, foregrip: 1, holo: 0.5, comp: 1 } },
  military: { p: 0.08, items: { reddot: 2, holo: 2, foregrip: 2, scope4x: 1, bipod: 1, brake: 1, drum: 0.6, riflecan: 0.6, pistolcan: 0.3 } },
  crash_mil: { p: 0.06, items: { holo: 2, reddot: 1, foregrip: 1, drum: 0.5, riflecan: 0.4 } },
  prison: { p: 0.03, items: { laser: 1, extmag: 1, tubeext: 1, reddot: 0.5 } },
  lodge: { p: 0.05, items: { scope4x: 2, bipod: 2, choke: 2, brake: 1, reddot: 1 } },
  cabin: { p: 0.025, items: { scope4x: 1, bipod: 1, choke: 1 } },
  ranch: { p: 0.025, items: { choke: 1, scope4x: 1, bipod: 0.5 } },
  mall: { p: 0.02, items: { reddot: 1, laser: 1, comp: 1, choke: 1 } },
  town: { p: 0.01, items: { reddot: 1, laser: 1, choke: 1 } },
  pawnshop: { p: 0.06, items: { reddot: 2, scope4x: 1.5, laser: 1.5, comp: 1, choke: 1, extmag: 1, bipod: 0.6 } }, // shops.js
};
export function rollGunmodFind(state, tileId, mult = 1, salt = "") {
  const t = state.tiles[tileId];
  const site = t && t.loc ? GUNMOD_FINDS[t.loc.type] : null;
  if (!site) return null;
  const loot = Math.max(0.1, Math.min(1, t.loot ?? 1));
  if (hash01(state.seed, "modfind", tileId, state.hour, salt) >= site.p * loot * mult) return null;
  const key = pickWeighted(site.items, hash01(state.seed, "modpick", tileId, state.hour, salt));
  return key ? lootItem(key, siteSource(t.loc.type), hash01(state.seed, "moddur", tileId, state.hour, salt)) : null;
}
// rollGunmodFind, or when it found nothing the overhaul's table (SITE_MODS; its own dice). scavenge.js searchHour.
export const rollAnyModFind = (state, tileId, mult = 1, salt = "") => rollGunmodFind(state, tileId, mult, salt) || rollSiteMod(state, tileId, mult, salt) || rollHeadFind(state, tileId, mult, salt) || rollSiteKit(state, tileId, mult, salt) || rollBladeFind(state, tileId, mult, salt) || rollPartFind(state, tileId, mult, salt) || rollSurvFind(state, tileId, mult, salt) || rollBoxFind(state, tileId, mult, salt) || rollToolFind(state, tileId, mult, salt); // helmets.js HEAD_FINDS, then carrykit.js SITE_KIT (magazines, rigs, plates), then blades.js BLADE_FINDS, each on its own dice
export const AREA_GUNMODS = {
  armory: { p: 0.12, items: { reddot: 2, laser: 2, extmag: 2, holo: 1, foregrip: 1, tubeext: 1, scope4x: 0.5, riflecan: 0.3 } },
  gunshop: { p: 0.12, items: { reddot: 2, scope4x: 2, laser: 1.5, comp: 1.5, choke: 1.5, extmag: 1.5, bipod: 1, brake: 1, holo: 0.7, pistolcan: 0.3 } },
  pawnshop: { p: 0.06, items: { reddot: 1.5, scope4x: 1, laser: 1, comp: 0.6, choke: 0.6, extmag: 0.8 } },
  barracks: { p: 0.05, items: { reddot: 1, holo: 1, foregrip: 1, drum: 0.3 } },
  milwreck: { p: 0.06, items: { holo: 1, reddot: 1, drum: 0.4, riflecan: 0.3 } },
  cabin: { p: 0.03, items: { scope4x: 1, bipod: 1, choke: 1 } },
};
export function rollAreaGunmod(state, tileId, areaType, salt = "") {
  const a = AREA_GUNMODS[areaType];
  if (!a || hash01(state.seed, "areamod", tileId, salt) >= a.p) return rollAreaMod(state, tileId, areaType, salt); // else the overhaul's table (AREA_MODS; its own dice)
  const key = pickWeighted(a.items, hash01(state.seed, "areamodpick", tileId, salt));
  const t = state.tiles[tileId];
  return key ? lootItem(key, areaSource(areaType, t && t.loc ? t.loc.type : null), hash01(state.seed, "areamoddur", tileId, salt)) : null;
}
// A loose attachment on a trader's or a merchant's table now and then (trade.js ensureWares, visitors.js merchantGoods;
// its own dice). Military groups and merchants carry the good ones.
export const WARE_GUNMODS = {
  traders: { p: 0.35, items: { reddot: 2, laser: 1.5, comp: 1.5, extmag: 1.5, choke: 1.5, scope4x: 1, bipod: 1, brake: 1, tubeext: 1, foregrip: 1 } },
  military: { p: 0.4, items: { reddot: 2, holo: 2, foregrip: 1.5, scope4x: 1, drum: 0.6, riflecan: 0.5, pistolcan: 0.4 } },
  raider: { p: 0.2, items: { reddot: 1, comp: 1, extmag: 1, suppressor: 1, brake: 0.5 } },
  expansionist: { p: 0.2, items: { reddot: 1, scope4x: 1, extmag: 1, laser: 1 } },
  fortress: { p: 0.15, items: { scope4x: 1, bipod: 1, choke: 1 } },
  merchants: { p: 0.5, items: { reddot: 1.5, holo: 1.5, scope4x: 1.5, laser: 1, riflecan: 0.7, pistolcan: 0.7, drum: 0.5, bipod: 1 } },
};
export function gunmodWares(state, type, name, salt = "") {
  const w = WARE_GUNMODS[type];
  const more = [...modWares(state, type, name, salt), ...headWares(state, type, name, salt), ...bladeWares(state, type, name, salt), ...partWares(state, type, name, salt), ...cartWares(state, type, name, salt), ...survWares(state, type, name, salt), ...toolWares(state, type, name, salt)]; // carts (CART_WARES, last) // partfinds.js: the parts catalogue // blades.js WARE_BLADES too // the overhaul's parts (WARE_MODS), helmets and ear protection (helmets.js WARE_HEAD); their own dice
  if (!w || hash01(state.seed, "modware", name, salt) >= w.p) return more;
  const key = pickWeighted(w.items, hash01(state.seed, "modwarepick", name, salt));
  return key ? [lootItem(key, traderSource(type), hash01(state.seed, "modwareq", name, salt)), ...more] : more;
}
function modWares(state, type, name, salt) {
  const w = WARE_MODS[type];
  if (!w || hash01(state.seed, "newmodware", name, salt) >= w.p) return kitWares(state, type, name, salt); // carrykit.js WARE_KIT (its own dice)
  const key = pickWeighted(w.items, hash01(state.seed, "newmodwarepick", name, salt));
  return key ? [lootItem(key, traderSource(type), hash01(state.seed, "newmodwareq", name, salt))] : []; // itemcond.js: by the trader
}

// The weapons overhaul's attachments (section 5's "where" column) and the repair kits: their own tables and dice
// (SITE_MODS each search hour, AREA_MODS per raid container, WARE_MODS on a trader's table), rolled after the
// GUNMOD_FINDS / AREA_GUNMODS / WARE_GUNMODS roll (search hours and containers: only when that one found nothing), so
// every find from before them comes out as it did.
export const SITE_MODS = {
  gunstore: { p: 0.1, items: { tritium: 2, rmr: 1.5, scopemount: 3, sidemount: 1, mlok: 1, can22: 1, can308: 0.4, flashhider: 2, recoilpad: 3, precision: 0.6, foldstock: 1, anglegrip: 1.5, revgrip: 2, weaponlight: 1.5, sling: 3, can12: 0.1, repairkit: 1, tacscope: 0.3 } },
  police: { p: 0.06, items: { tritium: 1.5, rmr: 1, can9: 0.4, collapsible: 1, anglegrip: 1, weaponlight: 2, recoilpad: 1, sling: 1, revgrip: 1, kevlarkit: 2 } },
  military: { p: 0.07, items: { acog: 2, lpvo: 0.4, tacscope: 0.6, thermalscope: 0.02, quadrail: 1.5, mlok: 1, can9: 0.4, can556: 0.6, can308: 0.3, flashhider: 1.5, collapsible: 1.5, precision: 0.6, anglegrip: 1, weaponlight: 1.5, peq: 0.4, sling: 2, kevlarkit: 1.5, repairkit: 1 } },
  crash_mil: { p: 0.05, items: { acog: 2, weaponlight: 1, peq: 0.3, can556: 0.3, kevlarkit: 1 } },
  convoy: { p: 0.04, items: { acog: 1, weaponlight: 1, repairkit: 1, kevlarkit: 1 } },
  prison: { p: 0.02, items: { revgrip: 1, kevlarkit: 1 } },
  lodge: { p: 0.05, items: { scopemount: 3, recoilpad: 2, sling: 2, can22: 0.4 } },
  cabin: { p: 0.025, items: { scopemount: 1, recoilpad: 1, sling: 1 } },
  ranch: { p: 0.02, items: { recoilpad: 1, sling: 1 } },
  farm: { p: 0.01, items: { recoilpad: 1, sling: 1 } },
  hardware: { p: 0.02, items: { repairkit: 1 } },
  autoshop: { p: 0.02, items: { repairkit: 1 } },
  pawnshop: { p: 0.05, items: { scopemount: 1.5, recoilpad: 1.5, sling: 2, revgrip: 1, foldstock: 0.6, repairkit: 1 } }, // shops.js
};
export const AREA_MODS = {
  armory: { p: 0.08, items: { tritium: 1, rmr: 1, weaponlight: 2, collapsible: 1, acog: 0.6, can9: 0.3, kevlarkit: 2, sling: 1 } },
  gunshop: { p: 0.08, items: { scopemount: 2, sidemount: 0.6, recoilpad: 2, revgrip: 1.5, flashhider: 1.5, sling: 2, tritium: 1, can22: 0.5, foldstock: 0.6, repairkit: 0.5 } },
  pawnshop: { p: 0.05, items: { scopemount: 1, recoilpad: 1, sling: 1.5, revgrip: 0.8, foldstock: 0.5, repairkit: 0.8 } },
  barracks: { p: 0.05, items: { acog: 1, quadrail: 0.6, weaponlight: 1, sling: 1, kevlarkit: 1, peq: 0.15 } },
  milwreck: { p: 0.05, items: { acog: 1, weaponlight: 1, can556: 0.2, kevlarkit: 0.6 } },
  motorpool: { p: 0.03, items: { repairkit: 1 } },
  cabin: { p: 0.02, items: { scopemount: 1, recoilpad: 1, sling: 1 } },
  workshop: { p: 0.02, items: { repairkit: 1 } },
  hardware: { p: 0.03, items: { repairkit: 1 } }, // shops.js
  garage: { p: 0.015, items: { repairkit: 1 } },
};
export function rollSiteMod(state, tileId, mult = 1, salt = "") {
  const t = state.tiles[tileId];
  const site = t && t.loc ? SITE_MODS[t.loc.type] : null;
  if (!site) return null;
  const loot = Math.max(0.1, Math.min(1, t.loot ?? 1));
  if (hash01(state.seed, "newmodfind", tileId, state.hour, salt) >= site.p * loot * mult) return null;
  const key = pickWeighted(site.items, hash01(state.seed, "newmodpick", tileId, state.hour, salt));
  return key ? lootItem(key, siteSource(t.loc.type), hash01(state.seed, "newmoddur", tileId, state.hour, salt)) : null; // itemcond.js: by the site
}
export function rollAreaMod(state, tileId, areaType, salt = "") {
  const a = AREA_MODS[areaType];
  if (!a || hash01(state.seed, "newareamod", tileId, salt) >= a.p) return rollAreaHead(state, tileId, areaType, salt) || rollAreaKit(state, tileId, areaType, salt) || rollAreaBlade(state, tileId, areaType, salt) || rollAreaPart(state, tileId, areaType, salt) || rollAreaSurv(state, tileId, areaType, salt) || rollAreaBox(state, tileId, areaType, salt); // helmets.js AREA_HEAD, then carrykit.js AREA_KIT, then blades.js AREA_BLADES (each on its own dice)
  const key = pickWeighted(a.items, hash01(state.seed, "newareamodpick", tileId, salt));
  const t = state.tiles[tileId];
  return key ? lootItem(key, areaSource(areaType, t && t.loc ? t.loc.type : null), hash01(state.seed, "newareamoddur", tileId, salt)) : null; // itemcond.js: by the area
}
export const WARE_MODS = {
  traders: { p: 0.3, items: { scopemount: 2, recoilpad: 2, sling: 2, tritium: 1, flashhider: 1, revgrip: 1, weaponlight: 1, repairkit: 1, anglegrip: 0.6 } },
  military: { p: 0.35, items: { acog: 2, weaponlight: 2, collapsible: 1, quadrail: 1, can556: 0.4, peq: 0.3, kevlarkit: 1.5, repairkit: 1, sling: 1 } },
  raider: { p: 0.2, items: { sidemount: 1, foldstock: 1, scrapscope: 1, bottlecan: 0.5, solventcan: 0.5 } },
  expansionist: { p: 0.2, items: { scopemount: 1, sling: 1, recoilpad: 1, repairkit: 1, weaponlight: 0.6 } },
  fortress: { p: 0.15, items: { recoilpad: 1, sling: 1, repairkit: 1, kevlarkit: 0.5 } },
  merchants: { p: 0.45, items: { acog: 1, lpvo: 0.4, rmr: 1, tacscope: 0.4, thermalscope: 0.05, mlok: 1, can9: 0.5, can308: 0.4, can12: 0.1, weaponlight: 1, precision: 0.5, repairkit: 1.5, kevlarkit: 1 } },
};

// ---------- parts by kind (data.js SUPPLIES: parts are machine parts; section 10) ----------
// A find of parts, already rolled, is split into kinds by where it was found (no new dice for the find itself; its
// own hash dice for each part): an auto shop's are mostly car parts, a gun store's gun parts, a radio tower's
// electronics; the rest machine parts. By site type (scavenge.js, the base's own scavenging) or raid area (combat.js).
export const PARTS_MIX = {};
for (const t of ["autoshop", "gas", "truckstop", "crashsite", "convoy", "wreck", "roadcars", "garage", "motorpool", "pumps"]) PARTS_MIX[t] = { carparts: 0.6 };
for (const t of ["factory", "dam", "workshop", "warehouse", "quarry"]) PARTS_MIX[t] = { carparts: 0.1, electronics: 0.1 }; // machine parts 0.8
for (const t of ["gunstore", "gunshop", "armory", "barracks", "milwreck", "crash_mil"]) PARTS_MIX[t] = { gunparts: 0.6 };
PARTS_MIX.pawnshop = { gunparts: 0.4 }; // shops.js
for (const t of ["radiotower", "univ", "lab", "office", "control", "airport", "hangar", "newswreck", "crash_news", "mall"]) PARTS_MIX[t] = { electronics: 0.6 };
PARTS_MIX.military = { gunparts: 0.4, electronics: 0.2, carparts: 0.2 };
PARTS_MIX.police = { gunparts: 0.3, electronics: 0.1, carparts: 0.1 };
// n parts found at a place of this type: { parts, carparts, gunparts, electronics } (only the kinds found).
export function sortParts(state, placeType, n, salt = "") {
  const mix = PARTS_MIX[placeType];
  const out = {};
  const q = Math.max(0, Math.floor(n));
  if (!mix) { if (q) out.parts = q; return out; }
  for (let i = 0; i < q; i++) {
    let u = hash01(state.seed, "partkind", placeType, salt, state.hour, i);
    let k = "parts";
    for (const [kind, w] of Object.entries(mix)) { if (u < w) { k = kind; break; } u -= w; }
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}
// Splits a supplies object's parts by place (the rest of it as it is). Returns it.
export function splitParts(state, sup, placeType, salt = "") {
  if (!sup || !(sup.parts > 0) || !PARTS_MIX[placeType]) return sup;
  const n = sup.parts;
  delete sup.parts;
  for (const [k, v] of Object.entries(sortParts(state, placeType, n, salt))) sup[k] = (sup[k] || 0) + v;
  return sup;
}

// Flashbangs and smoke grenades (throwables.js FLASH; riot police use smoke too): police stations, prisons, the National
// Guard and the Army's wrecks and convoys. A roll of their own each search hour (SITE_GRENADES) and one per raid
// container (AREA_GRENADES: an armoury's crate holds 2-4 flashbangs or 1-3 smoke grenades); their own dice, so adding
// them changed no other find. p: the chance (x the site's loot left); items: { key: [weight, lo, hi] }, one kind a roll.
export const SITE_GRENADES = {
  police: { p: 0.05, items: { flashbang: [2, 1, 2], smokegren: [1.5, 1, 2] } },
  prison: { p: 0.04, items: { flashbang: [1.5, 1, 2], smokegren: [2, 1, 2] } },
  military: { p: 0.06, items: { flashbang: [2, 1, 3], smokegren: [1, 1, 2] } },
  crash_mil: { p: 0.05, items: { flashbang: [1, 1, 2], smokegren: [1, 1, 2] } },
  convoy: { p: 0.05, items: { flashbang: [1, 1, 2], smokegren: [1, 1, 2] } },
};
export const AREA_GRENADES = {
  armory: { p: 0.3, items: { flashbang: [3, 2, 4], smokegren: [2, 1, 3] } }, // a police, prison or National Guard armoury
  barracks: { p: 0.08, items: { flashbang: [2, 1, 2], smokegren: [1, 1, 1] } }, // a barracks, a police locker room (SWAT)
  cellblock: { p: 0.03, items: { flashbang: [1, 1, 1], smokegren: [1, 1, 1] } }, // a riot squad's spares by the cells
  milwreck: { p: 0.08, items: { flashbang: [1, 1, 2], smokegren: [1, 1, 2] } },
};
// One kind from a table's items by u, and how many by v: [key, n].
function pickGrenades(items, u, v) {
  const list = Object.entries(items).filter(([k]) => GEAR[k]);
  const total = list.reduce((a, [, [w]]) => a + w, 0);
  let x = u * total;
  for (const [k, [w, lo, hi]] of list) { x -= w; if (x < 0) return [k, lo + Math.floor(v * (hi - lo + 1))]; }
  return null;
}
// This search hour's flashbangs or smoke grenades at a site (SITE_GRENADES): a list of items (often none).
export function rollSiteGrenades(state, tileId, mult = 1, salt = "") {
  const t = state.tiles[tileId];
  const site = t && t.loc ? SITE_GRENADES[t.loc.type] : null;
  if (!site) return [];
  const loot = Math.max(0.1, Math.min(1, t.loot ?? 1));
  if (hash01(state.seed, "grenfind", tileId, state.hour, salt) >= site.p * loot * mult) return [];
  const got = pickGrenades(site.items, hash01(state.seed, "grenpick", tileId, state.hour, salt), hash01(state.seed, "grenn", tileId, state.hour, salt));
  if (!got) return [];
  const out = [];
  for (let i = 0; i < got[1]; i++) out.push(lootItem(got[0], siteSource(t.loc.type), hash01(state.seed, "grendur", tileId, state.hour, salt, i)));
  return out;
}
// A raid container's flashbangs or smoke grenades (AREA_GRENADES), by its area type; site: the raid's site type (an
// armoury's are police stock, or military at a base: itemcond.js areaSource).
export function rollAreaGrenades(state, tileId, areaType, site = null, salt = "") {
  const a = AREA_GRENADES[areaType];
  if (!a || hash01(state.seed, "areagren", tileId, salt) >= a.p) return [];
  const got = pickGrenades(a.items, hash01(state.seed, "areagrenpick", tileId, salt), hash01(state.seed, "areagrenn", tileId, salt));
  if (!got) return [];
  const out = [];
  for (let i = 0; i < got[1]; i++) out.push(lootItem(got[0], areaSource(areaType, site), hash01(state.seed, "areagrendur", tileId, salt, i)));
  return out;
}

// Grenade launchers (the M203 too), rocket tubes and their rounds (launchers.js; section 13 "found"): the Army's own stock. A roll of
// their own each search hour (SITE_LAUNCHERS: a military base, a crashed military aircraft, a convoy) and one per raid
// container (AREA_LAUNCHERS: an armoury, barracks, a military wreck, a motor pool). Their own dice: nothing else found
// changed. { key: [weight, lo, hi] } like the grenades.
export const SITE_LAUNCHERS = {
  military: { p: 0.03, items: { m203: [1, 1, 1], a_40mm_he: [5, 1, 2], a_40mm_smoke: [1.5, 1, 1], a_40mm_illum: [1, 1, 1], a_40mm_buck: [1, 1, 1], m79: [1.2, 1, 1], at4: [0.6, 1, 1], m32: [0.2, 1, 1], rpg: [0.15, 1, 1], a_rocket_heat: [0.4, 1, 2] } },
  crash_mil: { p: 0.015, items: { m203: [0.5, 1, 1], a_40mm_he: [3, 1, 1], m79: [0.6, 1, 1], at4: [0.8, 1, 1] } },
  convoy: { p: 0.02, items: { m203: [0.5, 1, 1], a_40mm_he: [3, 1, 2], at4: [1.5, 1, 1], m79: [0.5, 1, 1] } },
};
export const AREA_LAUNCHERS = {
  armory: { p: 0.05, items: { m203: [0.6, 1, 1], a_40mm_he: [4, 1, 3], a_40mm_smoke: [1, 1, 2], m79: [1, 1, 1], at4: [0.8, 1, 1], m32: [0.15, 1, 1], rpg: [0.15, 1, 1], a_rocket_heat: [0.4, 1, 2] } },
  barracks: { p: 0.03, items: { m203: [0.8, 1, 1], a_40mm_he: [3, 1, 1], at4: [1, 1, 1], m79: [0.5, 1, 1] } },
  milwreck: { p: 0.04, items: { m203: [0.6, 1, 1], a_40mm_he: [2, 1, 2], m79: [1, 1, 1], at4: [1, 1, 1] } },
  motorpool: { p: 0.02, items: { at4: [1, 1, 1], a_40mm_he: [1, 1, 1] } },
};
// This search hour's launcher find at a site (SITE_LAUNCHERS): a list of items (often none).
export function rollSiteLaunchers(state, tileId, mult = 1, salt = "") {
  const t = state.tiles[tileId];
  const site = t && t.loc ? SITE_LAUNCHERS[t.loc.type] : null;
  if (!site) return [];
  const loot = Math.max(0.1, Math.min(1, t.loot ?? 1));
  if (hash01(state.seed, "glfind", tileId, state.hour, salt) >= site.p * loot * mult) return [];
  const got = pickGrenades(site.items, hash01(state.seed, "glpick", tileId, state.hour, salt), hash01(state.seed, "gln", tileId, state.hour, salt));
  if (!got) return [];
  const out = [];
  for (let i = 0; i < got[1]; i++) out.push(lootItem(got[0], siteSource(t.loc.type), hash01(state.seed, "gldur", tileId, state.hour, salt, i)));
  return out;
}
// A raid container's launcher find (AREA_LAUNCHERS), by its area type.
export function rollAreaLaunchers(state, tileId, areaType, site = null, salt = "") {
  const a = AREA_LAUNCHERS[areaType];
  if (!a || hash01(state.seed, "areagl", tileId, salt) >= a.p) return [];
  const got = pickGrenades(a.items, hash01(state.seed, "areaglpick", tileId, salt), hash01(state.seed, "areagln", tileId, salt));
  if (!got) return [];
  const out = [];
  for (let i = 0; i < got[1]; i++) out.push(lootItem(got[0], areaSource(areaType, site), hash01(state.seed, "areagldur", tileId, salt, i)));
  return out;
}

// ---------- small finds per raid container (combat.js searchBox) ----------
// p = chance per container (× 0.5 + the site's richness, × Scavenging); items = weights.
export const AREA_FINDS = {
  house: { p: 0.141, items: { alarmclock: 1, pocketradio: 0.5, handradio: 0.3, goldring: 2, watch: 1, pearls: 0.5, goldchain: 0.5, diamond: 0.15, silverware: 0.5, coins: 1, stamps: 0.5, vinyl: 1, tcards: 1, phone: 2, laptop: 1, console: 1, camera: 0.5, photos: 3, cards: 1, harmonica: 0.5, guitar: 0.3, vodka: 1, wine: 1, whiskey: 0.5, smokes: 1, chocolate: 1, candles: 1, toiletpaper: 1, batteries: 1, lighters: 1, deodorant: 1, toothpaste: 1, shampoo: 1, makeup: 0.5, perfume: 0.3, lipbalm: 0.5, wetwipes: 0.5 } },
  farmhouse: { p: 0.112, items: { photos: 2, tobacco: 1, whiskey: 1, honey: 1, candles: 1, cards: 1, harmonica: 0.5, coins: 0.5, goldring: 0.5, deodorant: 0.5, toothpaste: 0.5 } },
  store: { p: 0.143, items: { chocolate: 2, candy: 2, coffee: 0.3, smokes: 2, cigarettes: 1, instcoffee: 1, lighters: 2, batteries: 2, toiletpaper: 1, soap: 1, tea: 0.5, vodka: 0.5, handradio: 0.3, deodorant: 1, toothpaste: 0.5, wetwipes: 0.5, lipbalm: 1 } },
  kitchen: { p: 0.1, items: { instcoffee: 2, coffee: 0.4, tea: 1, honey: 0.5, chocolate: 1, vodka: 1, wine: 1, candles: 0.5, silverware: 0.3, lighters: 1 } },
  pharmacy: { p: 0.188, items: { razors: 2, soap: 2, candy: 1, toiletpaper: 1, chocolate: 1, puritabs: 1.5, deodorant: 2, toothpaste: 2, shampoo: 1, wetwipes: 1, lipbalm: 1, makeup: 0.5 } },
  clinic: { p: 0.082, items: { chocolate: 1, candy: 1, soap: 1, puritabs: 1, wetwipes: 1, toothpaste: 0.5 } },
  nurse: { p: 0.075, items: { candy: 1, soap: 1, lipbalm: 0.5, wetwipes: 0.5 } },
  garage: { p: 0.08, items: { lighters: 2, flare: 2, batteries: 1 } },
  workshop: { p: 0.05, items: { batteries: 1, toiletpaper: 1 } },
  warehouse: { p: 0.08, items: { toiletpaper: 2, batteries: 2, soap: 1, cigarettes: 1, candles: 1 } },
  office: { p: 0.108, items: { phone: 2, laptop: 2, photos: 1, watch: 0.5, cigars: 0.3, scotch: 0.3, stamps: 0.3, makeup: 0.5 } },
  armory: { p: 0.05, items: { frag: 1, cuffs: 2, smokegren: 1, flare: 1 } },
  barracks: { p: 0.127, items: { frag: 0.5, heatpack: 1, cigarettes: 2, chocolate: 2, instcoffee: 1, cards: 2, smokegren: 1, batteries: 1, puritabs: 0.5, deodorant: 1, toothpaste: 1, wetwipes: 1 } },
  motorpool: { p: 0.05, items: { batteries: 2, flare: 1, lighters: 1 } },
  barn: { p: 0.05, items: { tobacco: 1, whiskey: 1 } },
  lab: { p: 0.06, items: { laptop: 2, phone: 1, camera: 1 } },
  cabin: { p: 0.08, items: { whiskey: 1, harmonica: 1, cards: 1, gamecall: 1, scentmask: 0.5, photos: 1, monocular: 0.5 } },
  hangar: { p: 0.05, items: { flare: 2, batteries: 1, toiletpaper: 1 } },
  cellblock: { p: 0.097, items: { tobacco: 3, cigarettes: 1, cards: 2, razors: 1, toothpaste: 1, deodorant: 0.5 } },
  control: { p: 0.05, items: { batteries: 2 } },
  campsite: { p: 0.091, items: { handwarmer: 1, pocketradio: 0.5, handradio: 0.5, puritabs: 1, cards: 1, harmonica: 1, chocolate: 1, instcoffee: 1, lighters: 1, ragboots: 1, scentmask: 1, tripwire: 1, wetwipes: 1, toothpaste: 0.5 } },
  wreck: { p: 0.066, items: { phone: 2, photos: 2, smokes: 1, flare: 2, watch: 0.5, goldring: 0.3, cigarettes: 0.5, wetwipes: 0.5, perfume: 0.3 } },
  roadcars: { p: 0.08, items: { phone: 2, photos: 2, smokes: 1, flare: 1, watch: 0.5, goldring: 0.2, cigarettes: 1, chocolate: 1 } },
  gunshop: { p: 0.04, items: { gamecall: 1, scentmask: 1, monocular: 1 } },
  hardware: { p: 0.12, items: { batteries: 3, lighters: 2, tripwire: 1.5, candles: 1, handradio: 0.5 } }, // shops.js
  pawnshop: { p: 0.16, items: { goldring: 2, goldchain: 1.5, watch: 2, diamond: 0.3, pearls: 0.6, coins: 1.5, silverware: 0.6, vinyl: 1, guitar: 0.6, camera: 1.5, laptop: 1, console: 1, phone: 1.5, batteries: 1, handradio: 0.4 } },
  lockers: { p: 0.133, items: { phone: 2, console: 1, tcards: 1, candy: 1, guitar: 0.3, deodorant: 2, shampoo: 1, lipbalm: 0.5 } },
  chapel: { p: 0.08, items: { candles: 3, wine: 1, coins: 1, silverware: 0.5 } },
  milwreck: { p: 0.06, items: { frag: 1, smokegren: 2, flare: 1, chocolate: 1, cigarettes: 1 } },
  medwreck: { p: 0.053, items: { chocolate: 1, razors: 1, soap: 1, wetwipes: 1 } },
  newswreck: { p: 0.1, items: { camera: 3, laptop: 1, phone: 2 } },
  fuselage: { p: 0.122, items: { phone: 2, watch: 1, photos: 2, scotch: 1, cigarettes: 1, laptop: 1, camera: 1, perfume: 1, makeup: 0.5, wetwipes: 0.5 } },
  cargodrop: { p: 0.075, items: { chocolate: 2, instcoffee: 1, flare: 1, batteries: 1, puritabs: 1, wetwipes: 1, toothpaste: 0.5 } },
};

// A weighted pick from { key: weight } with a number in [0, 1).
export function pickWeighted(items, u) {
  const list = Object.entries(items).filter(([k, w]) => GEAR[k] && w > 0);
  const total = list.reduce((a, [, w]) => a + w, 0);
  let x = u * total;
  for (const [k, w] of list) { x -= w; if (x < 0) return k; }
  return list.length ? list[list.length - 1][0] : null;
}

// A small find at a site this search hour (or null). Its own dice (never the world's random numbers), like the
// books: mult = Treasure Hunter ×2 and the search pace; the site's loot left scales it; salt makes each roll unique.
export function rollFind(state, tileId, mult = 1, salt = "") {
  const t = state.tiles[tileId];
  const site = t && t.loc ? SITE_FINDS[t.loc.type] : null;
  if (!site) return null;
  const loot = Math.max(0.1, Math.min(1, t.loot ?? 1));
  if (hash01(state.seed, "find", tileId, state.hour, salt) >= site.p * loot * mult) return null;
  const key = pickWeighted(site.items, hash01(state.seed, "findpick", tileId, state.hour, salt));
  return key ? lootItem(key, siteSource(t.loc.type), hash01(state.seed, "finddur", tileId, state.hour, salt)) : null;
}
// Lights (lights.js) where people kept them: a roll of its own each search hour, like HUNT_FINDS (so adding them
// changed no other find). Torches are made, not found (crafting.js).
export const LIGHT_FINDS = {
  hardware: { p: 0.05, items: { headlamp: 2, lantern: 1.5, spotlight: 0.5, windlight: 1 } }, campground: { p: 0.06, items: { headlamp: 2, lantern: 2, windlight: 1.5 } },
  lodge: { p: 0.05, items: { headlamp: 2, lantern: 1.5 } }, ranger: { p: 0.05, items: { headlamp: 1.5, lantern: 1, spotlight: 0.5 } },
  cabin: { p: 0.04, items: { lantern: 2, headlamp: 1, windlight: 1 } }, farm: { p: 0.03, items: { lantern: 2 } }, ranch: { p: 0.03, items: { lantern: 2 } },
  firestation: { p: 0.05, items: { spotlight: 1.5, headlamp: 2 } }, police: { p: 0.04, items: { spotlight: 2, tacflash: 1.5 } },
  military: { p: 0.04, items: { headlamp: 2, spotlight: 1, tacflash: 2.5 } }, autoshop: { p: 0.04, items: { headlamp: 2 } },
  dam: { p: 0.04, items: { spotlight: 1, headlamp: 1 } }, factory: { p: 0.03, items: { headlamp: 1.5, spotlight: 0.5 } },
  warehouse: { p: 0.03, items: { headlamp: 1, lantern: 1 } }, truckstop: { p: 0.03, items: { headlamp: 1, lantern: 0.5, windlight: 1 } },
};
export function rollLightFind(state, tileId, mult = 1, salt = "") {
  const t = state.tiles[tileId];
  const site = t && t.loc ? LIGHT_FINDS[t.loc.type] : null;
  if (!site) return null;
  const loot = Math.max(0.1, Math.min(1, t.loot ?? 1));
  if (hash01(state.seed, "lightfind", tileId, state.hour, salt) >= site.p * loot * mult) return null;
  const key = pickWeighted(site.items, hash01(state.seed, "lightpick", tileId, state.hour, salt));
  return key ? lootItem(key, siteSource(t.loc.type), hash01(state.seed, "lightdur", tileId, state.hour, salt)) : null;
}
// Hunting and fishing gear at a site this search hour (HUNT_FINDS; its own dice too), or null.
export function rollHuntFind(state, tileId, mult = 1, salt = "") {
  const t = state.tiles[tileId];
  const site = t && t.loc ? HUNT_FINDS[t.loc.type] : null;
  if (!site) return null;
  const loot = Math.max(0.1, Math.min(1, t.loot ?? 1));
  if (hash01(state.seed, "huntfind", tileId, state.hour, salt) >= site.p * loot * mult) return null;
  const key = pickWeighted(site.items, hash01(state.seed, "huntpick", tileId, state.hour, salt));
  return key ? lootItem(key, siteSource(t.loc.type), hash01(state.seed, "huntdur", tileId, state.hour, salt)) : null;
}

// Carts (data-carts.js, carts.js) where people kept them: a hardware store's yard, a farm's or a barn's, a feed store, a
// warehouse's loading dock, now and then a garden shed in town. A roll of its own each search hour (its own dice, so
// adding them changed no other find).
export const CART_FINDS = {
  hardware: { p: 0.03, items: { wheelbarrow: 2, handcart: 1 } }, farm: { p: 0.025, items: { wheelbarrow: 2, handcart: 1.5 } },
  barn: { p: 0.03, items: { wheelbarrow: 1.5, handcart: 1.5 } }, feedstore: { p: 0.025, items: { wheelbarrow: 1.5, handcart: 1 } },
  ranch: { p: 0.02, items: { wheelbarrow: 1, handcart: 1 } }, warehouse: { p: 0.015, items: { handcart: 1.5, wheelbarrow: 0.5 } },
  town: { p: 0.006, items: { wheelbarrow: 1 } },
};
// A cart at a site this search hour (CART_FINDS; its own dice), or null.
export function rollCartFind(state, tileId, mult = 1, salt = "") {
  const t = state.tiles[tileId];
  const site = t && t.loc ? CART_FINDS[t.loc.type] : null;
  if (!site) return null;
  const loot = Math.max(0.1, Math.min(1, t.loot ?? 1));
  if (hash01(state.seed, "cartfind", tileId, state.hour, salt) >= site.p * loot * mult) return null;
  const key = pickWeighted(site.items, hash01(state.seed, "cartpick", tileId, state.hour, salt));
  return key ? lootItem(key, siteSource(t.loc.type), hash01(state.seed, "cartdur", tileId, state.hour, salt)) : null;
}
// Carts on a trader's table (gunmodWares: its own dice, last): the merchants and the traders now and then.
export const WARE_CARTS = { traders: { p: 0.08, items: { wheelbarrow: 2, handcart: 1 } }, merchants: { p: 0.12, items: { handcart: 1.5, wheelbarrow: 1 } } };
function cartWares(state, type, name, salt) {
  const w = WARE_CARTS[type];
  if (!w || hash01(state.seed, "cartware", name, salt) >= w.p) return [];
  const key = pickWeighted(w.items, hash01(state.seed, "cartwarepick", name, salt));
  return key ? [lootItem(key, traderSource(type), hash01(state.seed, "cartwareq", name, salt))] : [];
}

// A small find in a raid container (the battle's random numbers, after the container's own loot), or null. site: the
// raid's site type (an armoury's condition goes by it: itemcond.js areaSource).
export function rollAreaFind(rng, areaType, rich = 1, scav = 0, site = null) {
  const a = AREA_FINDS[areaType];
  if (!a || !rng.chance(a.p * (0.5 + rich) * (1 + scav / 30))) return null;
  const key = pickWeighted(a.items, rng.next());
  return key ? lootItem(key, areaSource(areaType, site), rng) : null;
}

// ---------- wood (data.js SUPPLIES.wood) ----------
// A woodpile, a log basket by the fireplace, split kindling in a shed, broken furniture: wood turns up where wood is
// burned or stored. Its own dice (hash01), so the rest of a search or a raid is unchanged. [chance, min, max] wood
// (0.1 kg each: a cabin's 60–180 is 6–18 kg).
// Site searches (scavenge.js searchHour), a roll each search hour × the site's loot left:
export const SITE_WOOD = {
  farm: [0.3, 60, 150], barn: [0.35, 60, 180], ranch: [0.3, 60, 150], cabin: [0.4, 60, 180], lodge: [0.35, 60, 150], campground: [0.4, 60, 150],
  ranger: [0.35, 60, 150], hardware: [0.4, 60, 180], feedstore: [0.2, 30, 90], town: [0.15, 30, 90], church: [0.1, 30, 90], motel: [0.08, 30, 60],
};
// Raid map containers (combat.js, a building's rooms too): by the room's type, × FURNITURE for wooden furniture
// (cabinets, shelves, a counter; anything else half): a living room's log basket, a shed's kindling, a barn's woodpile.
export const AREA_WOOD = {
  house: [0.12, 30, 90], farmhouse: [0.2, 30, 120], barn: [0.3, 60, 150], cabin: [0.3, 60, 150], campsite: [0.35, 30, 120],
  garage: [0.1, 30, 90], workshop: [0.15, 30, 90], chapel: [0.08, 30, 60], hardware: [0.25, 30, 90],
};
const FURNITURE = { cabinet: 1, shelf: 1, counter: 1 };
// Wood found this search hour at a site, or 0.
// Building materials (data.js buildmat: lumber, blocks, nails and fixings; what a camp takes to become a base): a find of its
// own each search hour, like SITE_WOOD (its own dice: nothing else a search finds changed). [chance, min, max].
export const BUILDMAT_FINDS = {
  hardware: [0.55, 3, 7], quarry: [0.3, 2, 4], warehouse: [0.22, 1, 4], factory: [0.18, 1, 3], barn: [0.18, 1, 3], // hardware: shops.js, the builder's shop (was [0.35, 2, 5])
  farm: [0.12, 1, 2], feedstore: [0.12, 1, 2], ranch: [0.08, 1, 2], town: [0.1, 1, 2], city: [0.08, 1, 2],
  apartments: [0.06, 1, 2], office: [0.06, 1, 2], school: [0.06, 1, 2], motel: [0.06, 1, 2], church: [0.06, 1, 2],
  mall: [0.06, 1, 2], prison: [0.06, 1, 2], campground: [0.05, 1, 1], cabin: [0.05, 1, 1], dam: [0.08, 1, 2],
};
export function rollBuildmat(state, tileId, mult = 1, salt = "") {
  const t = state.tiles[tileId];
  const w = t && t.loc ? BUILDMAT_FINDS[t.loc.type] : null;
  if (!w) return 0;
  const loot = Math.max(0.1, Math.min(1, t.loot ?? 1));
  if (hash01(state.seed, "bmat", tileId, state.hour, salt) >= w[0] * loot * mult) return 0;
  return w[1] + Math.floor(hash01(state.seed, "bmatqty", tileId, state.hour, salt) * (w[2] - w[1] + 1));
}
// Metal sheets (data.js metalsheet; the user's request 2026-10-21: "lootable", and "items that can be salvaged for
// metal sheets like cars"): stacks of roofing and siding where sheet steel is sold, stored or built into the place
// (hardware stores, factories, warehouses, auto shops and garages, barns and sheds, a crash's torn skin, the dead cars
// of a truck stop). A find of its own each search hour, like BUILDMAT_FINDS (its own dice: nothing else a search finds
// changed), by the site and by the point of interest searched (a shed, a garage). [chance, min, max].
export const SHEET_FINDS = {
  hardware: [0.3, 1, 4], factory: [0.25, 1, 3], warehouse: [0.22, 1, 3], autoshop: [0.25, 1, 3], garage: [0.2, 1, 2],
  barn: [0.22, 1, 3], shed: [0.2, 1, 2], farm: [0.12, 1, 2], ranch: [0.1, 1, 2], feedstore: [0.1, 1, 2], quarry: [0.15, 1, 2],
  mineshack: [0.15, 1, 2], crashsite: [0.25, 1, 3], crash_cargo: [0.25, 1, 3], crash_mil: [0.15, 1, 2], airport: [0.12, 1, 3],
  truckstop: [0.15, 1, 2], gas: [0.08, 1, 1], military: [0.1, 1, 2], dam: [0.1, 1, 2], prison: [0.06, 1, 1],
  town: [0.06, 1, 1], city: [0.05, 1, 1], cabin: [0.05, 1, 1], house: [0.04, 1, 1], neighbourhood: [0.04, 1, 1],
};
/** Metal sheets found this search hour (kind: the point of interest searched, when it has its own row), or 0. */
export function rollSheets(state, tileId, mult = 1, salt = "", kind = null) {
  const t = state.tiles[tileId];
  const w = (kind && SHEET_FINDS[kind]) || (t && t.loc ? SHEET_FINDS[t.loc.type] : null);
  if (!w) return 0;
  const loot = Math.max(0.1, Math.min(1, t ? t.loot ?? 1 : 1));
  if (hash01(state.seed, "sheet", tileId, state.hour, salt) >= w[0] * loot * mult) return 0;
  return w[1] + Math.floor(hash01(state.seed, "sheetqty", tileId, state.hour, salt) * (w[2] - w[1] + 1));
}
// Raid map containers (combat.js searchBox): the panels and roofing off a wrecked car (a door skin, a hood, a roof),
// a stack in a garage, a workshop or a barn, the torn skin of a crashed aircraft. By the room's type × the container's
// kind (a car: CAR_SHEETS). [chance, min, max]; its own dice.
export const AREA_SHEETS = {
  wreck: [0.3, 1, 2], roadcars: [0.15, 1, 1], garage: [0.15, 1, 2], workshop: [0.2, 1, 2], warehouse: [0.15, 1, 3],
  barn: [0.15, 1, 2], hangar: [0.18, 1, 2], motorpool: [0.2, 1, 2], milwreck: [0.25, 1, 2], fuselage: [0.3, 1, 3], cargodrop: [0.1, 1, 1],
};
const CAR_SHEETS = { car: 1.3 };
export function rollAreaSheets(state, tileId, areaType, boxKind, salt = "") {
  const w = AREA_SHEETS[areaType];
  if (!w) return 0;
  if (hash01(state.seed, "areasheet", tileId, salt) >= Math.min(0.9, w[0] * (CAR_SHEETS[boxKind] || 1))) return 0;
  return w[1] + Math.floor(hash01(state.seed, "areasheetqty", tileId, salt) * (w[2] - w[1] + 1));
}
export function rollSiteWood(state, tileId, mult = 1, salt = "") {
  const t = state.tiles[tileId];
  const w = t && t.loc ? SITE_WOOD[t.loc.type] : null;
  if (!w) return 0;
  const loot = Math.max(0.1, Math.min(1, t.loot ?? 1));
  if (hash01(state.seed, "wood", tileId, state.hour, salt) >= w[0] * loot * mult) return 0;
  return w[1] + Math.floor(hash01(state.seed, "woodqty", tileId, state.hour, salt) * (w[2] - w[1] + 1));
}
// Wood in a raid container of this area type (boxKind: the container's kind), or 0.
export function rollAreaWood(state, tileId, areaType, boxKind, salt = "") {
  const w = AREA_WOOD[areaType];
  if (!w) return 0;
  if (hash01(state.seed, "areawood", tileId, salt) >= w[0] * (FURNITURE[boxKind] || 0.5)) return 0;
  return w[1] + Math.floor(hash01(state.seed, "areawoodqty", tileId, salt) * (w[2] - w[1] + 1));
}

// ---------- arrows (data.js SUPPLIES.arrows; hunting.js) ----------
// A quiver in a hunting lodge, a box of bolts behind a gun counter, target arrows in a sports shop or a camp: arrows turn
// up where bows are kept. Their own dice (hash01), so the rest of a search or a raid is unchanged. [chance, min, max].
// Site searches (scavenge.js searchHour), a roll each search hour × the site's loot left:
export const SITE_ARROWS = {
  lodge: [0.3, 6, 18], gunstore: [0.25, 6, 24], pawnshop: [0.08, 4, 12], mall: [0.08, 6, 12], campground: [0.12, 4, 12], cabin: [0.12, 3, 10],
  ranger: [0.1, 4, 12], hardware: [0.05, 4, 10], farm: [0.04, 3, 8], ranch: [0.05, 3, 8],
};
// Raid map containers (combat.js, a building's rooms too): by the room's type (lockers, shelves and crates in full,
// anything else half).
export const AREA_ARROWS = { cabin: [0.12, 4, 12], campsite: [0.06, 3, 8], store: [0.03, 4, 10] };
const ARROW_BOX = { locker: 1, shelf: 1, crate: 1 };
// Arrows found this search hour at a site, or 0.
export function rollSiteArrows(state, tileId, mult = 1, salt = "") {
  const t = state.tiles[tileId];
  const a = t && t.loc ? SITE_ARROWS[t.loc.type] : null;
  if (!a) return 0;
  const loot = Math.max(0.1, Math.min(1, t.loot ?? 1));
  if (hash01(state.seed, "arrows", tileId, state.hour, salt) >= a[0] * loot * mult) return 0;
  return a[1] + Math.floor(hash01(state.seed, "arrowsqty", tileId, state.hour, salt) * (a[2] - a[1] + 1));
}
// Arrows in a raid container of this area type (boxKind: the container's kind), or 0.
export function rollAreaArrows(state, tileId, areaType, boxKind, salt = "") {
  const a = AREA_ARROWS[areaType];
  if (!a) return 0;
  if (hash01(state.seed, "areaarrows", tileId, salt) >= a[0] * (ARROW_BOX[boxKind] || 0.5)) return 0;
  return a[1] + Math.floor(hash01(state.seed, "areaarrowsqty", tileId, salt) * (a[2] - a[1] + 1));
}

// Does an item fit a place (shares a theme tag)? place: tags array.
export const fitsTags = (key, tags) => (ITEM_TAGS[key] || []).some((t) => tags.includes(t));

// Gun safes and gun cases (gunsafes.js GUN_FINDS, SEARCH_TOOLS; docs/weapons-overhaul-plan.md section 19).
Object.assign(ITEM_TAGS, {
  powerdrill: ["tools", "garage", "industry", "farm", "home"], anglegrinder: ["tools", "industry", "garage", "military"],
  riflecase: ["hunt", "guns", "home", "farm", "travel", "police", "military", "outdoor"], pistolcase: ["guns", "home", "police", "travel", "crime", "hunt"],
});

// Non-lethal weapons (data-nonlethal.js, nonlethal.js): tasers, cartridges, pepper spray and stun batons where police,
// guards and gun counters keep them (small finds: their own dice, through lootItem like every find). Guards' bodies
// carry them too (combat.js KITS via data-nonlethal.js NL_KIT_PATCH).
Object.assign(ITEM_TAGS, {
  taser: ["police", "prison", "guns"], tasercart: ["police", "prison", "guns"], pepper: ["police", "prison", "guns", "shop"], stunbaton: ["police", "prison"],
});
for (const [where, items] of [[SITE_FINDS.police, { taser: 1.5, tasercart: 2, pepper: 2, stunbaton: 1 }], [SITE_FINDS.prison, { taser: 1, tasercart: 1.5, pepper: 1.5, stunbaton: 1 }], [SITE_FINDS.gunstore, { taser: 1.5, tasercart: 2, pepper: 2 }],
  [AREA_FINDS.armory, { taser: 1, tasercart: 1.5, pepper: 1, stunbaton: 0.7 }], [AREA_FINDS.cellblock, { pepper: 0.7, stunbaton: 0.5, tasercart: 0.5 }], [AREA_FINDS.gunshop, { taser: 1, tasercart: 1.5, pepper: 1.5 }]]) Object.assign(where.items, items);

// Tourniquets (medics.js MEDIC.SELF: a downed survivor stabilizes themselves with one): small finds where medics,
// police, firefighters and the Army kept them (their own Object.assign, as the non-lethal ones above).
ITEM_TAGS.tourniquet = ["medical", "police", "military", "fire", "crash", "outdoor", "camp"];
for (const [where, n] of [[SITE_FINDS.hospital, 3], [SITE_FINDS.clinic, 2], [SITE_FINDS.pharmacy, 2], [SITE_FINDS.police, 2], [SITE_FINDS.military, 3], [SITE_FINDS.firestation, 2.5],
  [SITE_FINDS.ranger, 1], [SITE_FINDS.crash_mil, 2], [SITE_FINDS.crash_med, 2], [SITE_FINDS.convoy, 2], [SITE_FINDS.airdrop, 1],
  [AREA_FINDS.clinic, 1.5], [AREA_FINDS.nurse, 1], [AREA_FINDS.pharmacy, 1], [AREA_FINDS.armory, 1], [AREA_FINDS.barracks, 2], [AREA_FINDS.medwreck, 2], [AREA_FINDS.milwreck, 1.5], [AREA_FINDS.cargodrop, 0.5]]) where.items.tourniquet = n;

// The reloading bench's inputs (data-ammo.js RELOAD_GEAR; reloading.js): bags of fired brass, cans of powder and
// boxes of primers where shooters kept them. Their own tables and dice, rolled on their own in each search hour
// (scavenge.js searchHour) and raid container (combat.js), so every find from before comes out as it did. A bag, can
// or box is found part-used (RELOAD_LEFT of it). Primers are rare: a gun store about 0.08 a search hour. Traders sell
// powder and primers as supplies (reloading.js: arms dealers, the traders' and soldiers' groups).
export const SITE_RELOAD = {
  gunstore: { p: 0.2, items: { brass: 3, powder: 3, primers: 4 } },
  pawnshop: { p: 0.04, items: { brass: 2, powder: 1 } }, // shops.js
  lodge: { p: 0.08, items: { brass: 2, powder: 2, primers: 0.5 } },
  ranch: { p: 0.05, items: { brass: 1, powder: 2 } },
  military: { p: 0.05, items: { brass: 2, primers: 1 } },
  police: { p: 0.03, items: { brass: 2, primers: 0.5 } },
  cabin: { p: 0.02, items: { brass: 1, powder: 1 } },
  farm: { p: 0.015, items: { powder: 1, brass: 0.5 } },
};
export const AREA_RELOAD = {
  gunshop: { p: 0.1, items: { brass: 2, powder: 2, primers: 1.5 } },
  pawnshop: { p: 0.03, items: { brass: 1.5, powder: 1 } },
  armory: { p: 0.06, items: { brass: 2, primers: 1 } },
  barracks: { p: 0.04, items: { brass: 2, primers: 0.5 } },
  cabin: { p: 0.03, items: { brass: 1, powder: 1 } },
  farmhouse: { p: 0.02, items: { powder: 1, brass: 0.5 } },
};
export const RELOAD_LEFT = [0.3, 1];
Object.assign(ITEM_TAGS, {
  brass: ["guns", "hunt", "police", "military", "farm", "outdoor", "home", "camp"], powder: ["guns", "hunt", "farm", "home", "outdoor", "military"], primers: ["guns", "hunt", "military", "police"],
});
const partUsed = (it, u) => { if (it && it.dur > 1) it.dur = Math.max(1, Math.round(it.dur * (RELOAD_LEFT[0] + (RELOAD_LEFT[1] - RELOAD_LEFT[0]) * u))); return it; };
export function rollSiteReload(state, tileId, mult = 1, salt = "") {
  const t = state.tiles[tileId];
  const site = t && t.loc ? SITE_RELOAD[t.loc.type] : null;
  if (!site) return null;
  const loot = Math.max(0.1, Math.min(1, t.loot ?? 1));
  if (hash01(state.seed, "reloadfind", tileId, state.hour, salt) >= site.p * loot * mult) return null;
  const key = pickWeighted(site.items, hash01(state.seed, "reloadpick", tileId, state.hour, salt));
  return key ? partUsed(lootItem(key, siteSource(t.loc.type), hash01(state.seed, "reloaddur", tileId, state.hour, salt)), hash01(state.seed, "reloadleft", tileId, state.hour, salt)) : null;
}
export function rollAreaReload(state, tileId, areaType, salt = "") {
  const a = AREA_RELOAD[areaType];
  if (!a || hash01(state.seed, "areareload", tileId, salt) >= a.p) return null;
  const key = pickWeighted(a.items, hash01(state.seed, "areareloadpick", tileId, salt));
  const t = state.tiles[tileId];
  return key ? partUsed(lootItem(key, areaSource(areaType, t && t.loc ? t.loc.type : null), hash01(state.seed, "areareloaddur", tileId, salt)), hash01(state.seed, "areareloadleft", tileId, salt)) : null;
}

// data-shops.js: the town's and the city's shops and services (their rows; this module's own rows win).
for (const [k, d] of Object.entries(NEW_KINDS)) if (!SITE_TAGS[k]) SITE_TAGS[k] = d.tags;
for (const [k, d] of Object.entries(AREA_DEFS)) if (!AREA_TAGS[k]) AREA_TAGS[k] = d.tags;
mergeRows(SITE_FINDS, ROWS.SITE_FINDS); mergeRows(AREA_FINDS, ROWS.AREA_FINDS); mergeRows(LIGHT_FINDS, ROWS.LIGHT_FINDS); mergeRows(CART_FINDS, ROWS.CART_FINDS);
mergeRows(HUNT_FINDS, ROWS.HUNT_FINDS); mergeRows(BUILDMAT_FINDS, ROWS.BUILDMAT_FINDS); mergeRows(SITE_WOOD, ROWS.SITE_WOOD); mergeRows(AREA_WOOD, ROWS.AREA_WOOD);
mergeRows(SITE_ARROWS, ROWS.SITE_ARROWS); mergeRows(AREA_ARROWS, ROWS.AREA_ARROWS); mergeRows(PARTS_MIX, ROWS.PARTS_MIX);
