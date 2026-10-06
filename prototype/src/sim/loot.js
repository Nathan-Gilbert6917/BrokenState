// Small finds and the loot audit: what fits where.
//
// Equipment (weapons, armor, packs, tools, defences, camp kit) comes from a site's gear list (data.js LOCATIONS gear,
// the hour-by-hour search's gear roll) and from the containers of a raid map (combat.js AREAS gear). Small things,
// the valuables, comforts, smokes and drink, throwables and odd kit, are "finds": a roll of their own each search
// hour (SITE_FINDS, with their own dice like the books in skills.js, so the rest of the search is unchanged) and
// one per raid container (AREA_FINDS).
//
// Theme tags: every site type, raid area and item has a few tags (what kind of place it is, where a thing is
// normally kept). tools/loottest.js checks that everything a site or area can hold shares a tag with it (no
// military radios in a university lab, no sledgehammers in a pharmacy), that every item has a source, and prints
// the table of sources per item.
import { GEAR } from "./data.js";
import { hash01 } from "./skills.js";
import { newItem } from "./inventory.js";

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
};
export const AREA_TAGS = {
  house: ["home", "kitchen"], farmhouse: ["home", "farm", "hunt"], store: ["shop"], kitchen: ["kitchen"], pharmacy: ["medical", "shop"],
  clinic: ["medical"], nurse: ["medical", "school"], garage: ["garage", "tools"], workshop: ["tools", "industry"], warehouse: ["industry", "shop", "tools"],
  office: ["office", "tech"], armory: ["police", "military", "guns"], barracks: ["military", "camp"], motorpool: ["military", "garage"],
  barn: ["farm", "tools"], lab: ["school", "tech", "medical"], cabin: ["hunt", "outdoor", "home"], hangar: ["travel", "industry", "garage"],
  cellblock: ["prison", "crime"], control: ["tech", "industry"], campsite: ["camp", "outdoor"], wreck: ["travel", "garage"],
  pumps: ["travel"], gunshop: ["guns", "hunt"], lockers: ["school", "sport"], chapel: ["church"],
  milwreck: ["military", "crash"], medwreck: ["medical", "crash"], newswreck: ["tech", "crash"], fuselage: ["crash", "travel"],
  cargodrop: ["crash", "camp", "military"],
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
  spikedbat: ["garage", "crime"], pipespear: ["camp", "crime"], sawmachete: ["crime", "tools"], crossbow: ["crime", "camp"], pipegun: ["crime"],
  // armor
  vest: ["police", "military", "guns", "prison", "crash", "crime"], plate: ["military", "crash"], bikehelmet: ["home", "garage", "fire", "sport", "crime"],
  riothelmet: ["police", "prison", "military", "crash"], milhelmet: ["military", "crash"], kneeguards: ["garage", "guns", "tools", "sport", "crime"],
  riotarms: ["police", "prison"], riotlegs: ["police", "prison"],
  padding: ["camp", "crime", "home"], shinguards: ["crime"], tirevest: ["crime", "garage"], sportspads: ["school", "sport", "home"],
  footballhelmet: ["school", "sport"], scrapvest: ["crime"],
  // packs
  slingbag: ["home", "school", "mall", "office", "travel", "crash", "crime", "shop"], backpack: ["school", "home", "mall", "travel", "crime", "camp"],
  hikingpack: ["camp", "outdoor", "mall", "travel", "crash", "shop"], duffle: ["travel", "mall", "outdoor", "shop"], assaultpack: ["military", "crash", "camp"], rucksack: ["military", "camp", "crash", "outdoor"],
  // tools and kits
  nvg: ["military", "crash"], milradio: ["military", "crash"], surgkit: ["medical", "crash"], dewormer: ["medical", "farm"], // dewormer: worm.js (a farm's livestock wormer)
  bandagekit: ["medical", "church", "fire", "outdoor", "camp", "home"], crowbar: ["garage", "tools", "industry", "fire"],
  monocular: ["hunt", "outdoor", "guns", "camp", "home", "military", "travel"], binoculars: ["hunt", "outdoor", "guns", "military", "police", "home", "sport", "farm", "tech", "crash", "camp", "tools"],
  spotscope: ["hunt", "guns", "military", "outdoor"], thermal: ["military", "crash"], telescope: ["school", "tech", "home"],
  waterfilter: ["camp", "outdoor"], flashlight: ["home", "garage", "tools", "shop", "military", "police", "camp", "industry"],
  // The hand-crank radio (radio.js listeners: hears, cannot call) and purification tablets (worm.js): camping and
  // travel places, pharmacies and clinics, supply drops.
  handradio: ["home", "camp", "outdoor", "travel", "shop", "tech", "fire"], puritabs: ["medical", "camp", "outdoor", "travel", "military", "crash"],
  cuffs: ["police", "prison"], bicycle: ["home", "school", "garage", "police", "camp", "outdoor", "fire", "tools", "travel"],
  // the stealth kit and throwables
  suppressor: ["crime", "guns"], bottle: ["kitchen", "home", "crime", "travel"], noisemaker: ["crime"], firecracker: ["shop", "travel"],
  pipebomb: ["crime", "industry"], molotov: ["crime"], flare: ["travel", "garage", "fire", "police", "military", "crash", "outdoor", "camp"],
  smokegren: ["police", "military", "crash", "prison"], gamecall: ["hunt", "outdoor", "sport"],
  // siege kit and decoys (siege.js, decoys.js)
  frag: ["military", "crash", "guns"], ladder: ["tools", "farm", "fire"], ram: ["fire", "police"],
  alarmclock: ["home", "kitchen", "travel", "shop"], pocketradio: ["home", "travel", "camp", "outdoor", "shop"],
  handwarmer: ["outdoor", "camp", "sport", "hunt", "travel"], heatpack: ["medical", "outdoor", "fire", "camp", "military"],
  // base defences
  barbedwire: ["farm", "tools", "military", "industry", "prison"], beartrap: ["hunt", "farm", "outdoor", "tools"],
  tripwire: ["camp", "crime", "military", "outdoor", "tools"], sandbags: ["military", "fire", "industry", "tools"],
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
};

// ---------- small finds per site type (the hour-by-hour search) ----------
// p = chance per search hour at full loot (× the approach's pace, Treasure Hunter ×2); items = weights.
export const SITE_FINDS = {
  town: { p: 0.12, items: { goldring: 2, watch: 1, coins: 1, phone: 2, photos: 2, cards: 1, smokes: 2, vodka: 1, chocolate: 1, batteries: 1, lighters: 1, toiletpaper: 1, candles: 1 } },
  city: { p: 0.12, items: { watch: 2, goldchain: 1, phone: 3, laptop: 1, camera: 1, console: 1, smokes: 2, cigarettes: 1, lighters: 1, chocolate: 1 } },
  farm: { p: 0.08, items: { tobacco: 1, honey: 2, photos: 1, whiskey: 1, candles: 1, cards: 1 } },
  gas: { p: 0.14, items: { cigarettes: 2, smokes: 3, lighters: 3, candy: 2, chocolate: 2, instcoffee: 1, flare: 3, firecracker: 2, batteries: 2, bottle: 1, handradio: 0.5 } },
  mall: { p: 0.18, items: { goldring: 1, goldchain: 2, watch: 2, diamond: 0.4, pearls: 1, phone: 2, console: 2, camera: 2, laptop: 1, vinyl: 1, tcards: 1, candles: 1, chocolate: 1, cards: 1, guitar: 0.5, harmonica: 0.5 } },
  hospital: { p: 0.08, items: { chocolate: 2, candy: 2, soap: 2, razors: 1, toiletpaper: 2, photos: 1, puritabs: 1 } },
  police: { p: 0.12, items: { cuffs: 3, smokegren: 1.5, flare: 2, smokes: 1, cigarettes: 1 } },
  military: { p: 0.12, items: { frag: 1.5, heatpack: 1, cigarettes: 2, chocolate: 2, instcoffee: 2, coffee: 0.5, smokegren: 2, flare: 2, batteries: 2, cards: 1, puritabs: 0.5 } },
  prison: { p: 0.12, items: { tobacco: 3, cigarettes: 2, cards: 2, smokegren: 1, cuffs: 2, razors: 1 } },
  univ: { p: 0.12, items: { phone: 2, laptop: 2, console: 1, camera: 1, candy: 1, guitar: 0.5, toiletpaper: 1 } },
  dam: { p: 0.06, items: { batteries: 2, toiletpaper: 1 } },
  airport: { p: 0.16, items: { cigarettes: 2, cigars: 1, scotch: 1, watch: 2, phone: 2, laptop: 1, camera: 1, smokes: 1, photos: 1, candy: 1, flare: 1 } },
  factory: { p: 0.06, items: { batteries: 1, toiletpaper: 1 } },
  quarry: { p: 0.05, items: { pipebomb: 1, batteries: 1 } },
  autoshop: { p: 0.08, items: { lighters: 2, flare: 2, batteries: 2 } },
  pharmacy: { p: 0.14, items: { razors: 2, soap: 2, toiletpaper: 2, candy: 2, chocolate: 1, batteries: 1, smokes: 1, puritabs: 2 } },
  supermarket: { p: 0.16, items: { chocolate: 3, instcoffee: 2, candy: 2, tea: 2, honey: 1, smokes: 2, cigarettes: 1, vodka: 1, wine: 2, whiskey: 0.5, coffee: 0.5, toiletpaper: 2, soap: 1, candles: 1, batteries: 1, lighters: 1 } },
  gunstore: { p: 0.08, items: { gamecall: 2, scentmask: 1, monocular: 1 } },
  hardware: { p: 0.1, items: { batteries: 3, lighters: 2, tripwire: 1, candles: 1, toiletpaper: 1, handradio: 0.5 } },
  apartments: { p: 0.14, items: { goldring: 2, watch: 1, pearls: 1, silverware: 0.5, coins: 1, stamps: 0.5, vinyl: 1, phone: 2, laptop: 1, console: 1, photos: 3, cards: 1, guitar: 0.5, harmonica: 0.5, vodka: 1, wine: 1, smokes: 1, chocolate: 1, candles: 1 } },
  office: { p: 0.12, items: { phone: 3, laptop: 2, watch: 1, instcoffee: 2, coffee: 0.5, photos: 2, scotch: 0.5, cigars: 0.5, stamps: 0.5, toiletpaper: 1 } },
  school: { p: 0.12, items: { candy: 2, phone: 2, console: 2, tcards: 2, guitar: 0.5, chocolate: 1, toiletpaper: 1 } },
  firestation: { p: 0.1, items: { heatpack: 2, flare: 3, instcoffee: 2, cards: 2, chocolate: 1, batteries: 1 } },
  warehouse: { p: 0.1, items: { toiletpaper: 3, batteries: 2, soap: 1, lighters: 1, candles: 1, cigarettes: 1 } },
  grocery: { p: 0.14, items: { chocolate: 2, instcoffee: 2, coffee: 0.5, candy: 2, tea: 1, honey: 1, smokes: 2, vodka: 1, wine: 1, toiletpaper: 1, soap: 1, lighters: 1, batteries: 1 } },
  diner: { p: 0.12, items: { instcoffee: 3, candy: 2, chocolate: 1, smokes: 1, cards: 1, bottle: 2, lighters: 1 } },
  motel: { p: 0.12, items: { alarmclock: 1.5, pocketradio: 0.5, smokes: 2, vodka: 2, cards: 2, photos: 1, watch: 1, goldring: 1, phone: 1, soap: 2, razors: 1, guitar: 0.3 } },
  church: { p: 0.1, items: { candles: 4, wine: 2, coins: 1, silverware: 1, photos: 1, goldring: 0.5, tea: 1, cards: 0.5 } },
  clinic: { p: 0.08, items: { candy: 1, soap: 1, razors: 1, toiletpaper: 1, chocolate: 1, puritabs: 1.5 } },
  feedstore: { p: 0.08, items: { tobacco: 1, honey: 1, batteries: 1, lighters: 1 } },
  barn: { p: 0.05, items: { tobacco: 1, whiskey: 1 } },
  ranch: { p: 0.08, items: { whiskey: 1, tobacco: 1, cigars: 0.5, photos: 1, coins: 0.5, harmonica: 1, guitar: 0.5 } },
  cabin: { p: 0.08, items: { whiskey: 1, harmonica: 1, cards: 1, photos: 1, scentmask: 0.5, gamecall: 0.5, honey: 0.5, candles: 1, handradio: 0.5 } },
  lodge: { p: 0.1, items: { handwarmer: 2, handradio: 0.5, puritabs: 0.5, gamecall: 3, scentmask: 2, whiskey: 2, cigars: 1, scotch: 0.5, cards: 1, flare: 1, monocular: 1 } },
  campground: { p: 0.1, items: { handwarmer: 1.5, pocketradio: 1, handradio: 1, puritabs: 1.5, heatpack: 0.5, cards: 1, harmonica: 1, guitar: 0.5, chocolate: 1, instcoffee: 1, lighters: 1, ragboots: 1, scentmask: 1, tripwire: 1, flare: 1, monocular: 0.5 } },
  ranger: { p: 0.08, items: { heatpack: 1, handwarmer: 1, flare: 2, instcoffee: 1, chocolate: 1, cards: 1, monocular: 1, handradio: 1, puritabs: 1 } },
  radiotower: { p: 0.05, items: { batteries: 3, toiletpaper: 1 } },
  truckstop: { p: 0.16, items: { pocketradio: 1, handradio: 1, puritabs: 1, handwarmer: 1, alarmclock: 0.5, cigarettes: 2, smokes: 3, lighters: 2, candy: 2, chocolate: 2, instcoffee: 2, flare: 2, vodka: 1, batteries: 1, tobacco: 1, cards: 1, watch: 0.5 } },
  crashsite: { p: 0.1, items: { flare: 2, phone: 2, smokes: 1, photos: 2, lighters: 1, goldring: 0.5, watch: 0.5 } },
  crash_mil: { p: 0.14, items: { frag: 1.5, smokegren: 3, flare: 2, chocolate: 2, cigarettes: 1, instcoffee: 1 } },
  crash_cargo: { p: 0.14, items: { chocolate: 2, instcoffee: 2, coffee: 1, batteries: 2, toiletpaper: 1, puritabs: 1 } },
  crash_med: { p: 0.1, items: { chocolate: 1, candy: 1, soap: 1, razors: 1 } },
  crash_news: { p: 0.14, items: { camera: 3, phone: 2, laptop: 2, batteries: 1 } },
  airdrop: { p: 0.14, items: { chocolate: 3, instcoffee: 2, smokegren: 0.5, flare: 1, batteries: 1, cigarettes: 1, puritabs: 1 } },
};

// Hunting and fishing gear (hunting.js) at the sites where people kept it: a roll of its own each search hour, apart
// from the small finds (so adding it changed no other find).
export const HUNT_FINDS = {
  farm: { p: 0.03, items: { snarewire: 1 } }, barn: { p: 0.03, items: { snarewire: 1 } }, ranch: { p: 0.04, items: { snarewire: 1 } },
  hardware: { p: 0.05, items: { fishrod: 1, snarewire: 1 } }, feedstore: { p: 0.04, items: { snarewire: 2, fishnet: 1 } },
  cabin: { p: 0.06, items: { fishrod: 1, snarewire: 1 } }, lodge: { p: 0.08, items: { fishrod: 1.5, snarewire: 1.5, fishnet: 1 } },
  campground: { p: 0.06, items: { fishrod: 2, fishnet: 1 } }, ranger: { p: 0.05, items: { snarewire: 1, fishrod: 1 } },
};

// ---------- small finds per raid container (combat.js searchBox) ----------
// p = chance per container (× 0.5 + the site's richness, × Scavenging); items = weights.
export const AREA_FINDS = {
  house: { p: 0.12, items: { alarmclock: 1, pocketradio: 0.5, handradio: 0.3, goldring: 2, watch: 1, pearls: 0.5, goldchain: 0.5, diamond: 0.15, silverware: 0.5, coins: 1, stamps: 0.5, vinyl: 1, tcards: 1, phone: 2, laptop: 1, console: 1, camera: 0.5, photos: 3, cards: 1, harmonica: 0.5, guitar: 0.3, vodka: 1, wine: 1, whiskey: 0.5, smokes: 1, chocolate: 1, candles: 1, toiletpaper: 1, batteries: 1, lighters: 1 } },
  farmhouse: { p: 0.1, items: { photos: 2, tobacco: 1, whiskey: 1, honey: 1, candles: 1, cards: 1, harmonica: 0.5, coins: 0.5, goldring: 0.5 } },
  store: { p: 0.12, items: { chocolate: 2, candy: 2, coffee: 0.3, smokes: 2, cigarettes: 1, instcoffee: 1, lighters: 2, batteries: 2, toiletpaper: 1, soap: 1, tea: 0.5, vodka: 0.5, handradio: 0.3 } },
  kitchen: { p: 0.1, items: { instcoffee: 2, coffee: 0.4, tea: 1, honey: 0.5, chocolate: 1, vodka: 1, wine: 1, candles: 0.5, silverware: 0.3, lighters: 1 } },
  pharmacy: { p: 0.1, items: { razors: 2, soap: 2, candy: 1, toiletpaper: 1, chocolate: 1, puritabs: 1.5 } },
  clinic: { p: 0.06, items: { chocolate: 1, candy: 1, soap: 1, puritabs: 1 } },
  nurse: { p: 0.05, items: { candy: 1, soap: 1 } },
  garage: { p: 0.08, items: { lighters: 2, flare: 2, batteries: 1 } },
  workshop: { p: 0.05, items: { batteries: 1, toiletpaper: 1 } },
  warehouse: { p: 0.08, items: { toiletpaper: 2, batteries: 2, soap: 1, cigarettes: 1, candles: 1 } },
  office: { p: 0.1, items: { phone: 2, laptop: 2, photos: 1, watch: 0.5, cigars: 0.3, scotch: 0.3, stamps: 0.3 } },
  armory: { p: 0.05, items: { frag: 1, cuffs: 2, smokegren: 1, flare: 1 } },
  barracks: { p: 0.1, items: { frag: 0.5, heatpack: 1, cigarettes: 2, chocolate: 2, instcoffee: 1, cards: 2, smokegren: 1, batteries: 1, puritabs: 0.5 } },
  motorpool: { p: 0.05, items: { batteries: 2, flare: 1, lighters: 1 } },
  barn: { p: 0.05, items: { tobacco: 1, whiskey: 1 } },
  lab: { p: 0.06, items: { laptop: 2, phone: 1, camera: 1 } },
  cabin: { p: 0.08, items: { whiskey: 1, harmonica: 1, cards: 1, gamecall: 1, scentmask: 0.5, photos: 1, monocular: 0.5 } },
  hangar: { p: 0.05, items: { flare: 2, batteries: 1, toiletpaper: 1 } },
  cellblock: { p: 0.08, items: { tobacco: 3, cigarettes: 1, cards: 2, razors: 1 } },
  control: { p: 0.05, items: { batteries: 2 } },
  campsite: { p: 0.08, items: { handwarmer: 1, pocketradio: 0.5, handradio: 0.5, puritabs: 1, cards: 1, harmonica: 1, chocolate: 1, instcoffee: 1, lighters: 1, ragboots: 1, scentmask: 1, tripwire: 1 } },
  wreck: { p: 0.06, items: { phone: 2, photos: 2, smokes: 1, flare: 2, watch: 0.5, goldring: 0.3, cigarettes: 0.5 } },
  gunshop: { p: 0.04, items: { gamecall: 1, scentmask: 1, monocular: 1 } },
  lockers: { p: 0.08, items: { phone: 2, console: 1, tcards: 1, candy: 1, guitar: 0.3 } },
  chapel: { p: 0.08, items: { candles: 3, wine: 1, coins: 1, silverware: 0.5 } },
  milwreck: { p: 0.06, items: { frag: 1, smokegren: 2, flare: 1, chocolate: 1, cigarettes: 1 } },
  medwreck: { p: 0.04, items: { chocolate: 1, razors: 1, soap: 1 } },
  newswreck: { p: 0.1, items: { camera: 3, laptop: 1, phone: 2 } },
  fuselage: { p: 0.1, items: { phone: 2, watch: 1, photos: 2, scotch: 1, cigarettes: 1, laptop: 1, camera: 1 } },
  cargodrop: { p: 0.06, items: { chocolate: 2, instcoffee: 1, flare: 1, batteries: 1, puritabs: 1 } },
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
  return key ? newItem(key, 1) : null;
}
// Hunting and fishing gear at a site this search hour (HUNT_FINDS; its own dice too), or null.
export function rollHuntFind(state, tileId, mult = 1, salt = "") {
  const t = state.tiles[tileId];
  const site = t && t.loc ? HUNT_FINDS[t.loc.type] : null;
  if (!site) return null;
  const loot = Math.max(0.1, Math.min(1, t.loot ?? 1));
  if (hash01(state.seed, "huntfind", tileId, state.hour, salt) >= site.p * loot * mult) return null;
  const key = pickWeighted(site.items, hash01(state.seed, "huntpick", tileId, state.hour, salt));
  return key ? newItem(key, 1) : null;
}

// A small find in a raid container (the battle's random numbers, after the container's own loot), or null.
export function rollAreaFind(rng, areaType, rich = 1, scav = 0) {
  const a = AREA_FINDS[areaType];
  if (!a || !rng.chance(a.p * (0.5 + rich) * (1 + scav / 30))) return null;
  const key = pickWeighted(a.items, rng.next());
  return key ? newItem(key, 1) : null;
}

// Does an item fit a place (shares a theme tag)? place: tags array.
export const fitsTags = (key, tags) => (ITEM_TAGS[key] || []).some((t) => tags.includes(t));
