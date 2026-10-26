// World configuration (2026-10-19, user request): the new-run screen's World… window (ui/worldcfg.js) sets the dials
// of one run: how fast people hunger and thirst, how fast food spoils, how many of the dead and how hard they hit,
// how often events and raids come, what the AI groups start armed with, the loot of each kind, the sizes of bases,
// raid maps, city crawls and hive crawls, wear, failures, fuel, sickness, and whether the worm can be cured. The settings live
// on the world (state.worldCfg, saved with it; a world without one plays as before: every dial 1, the toggle on),
// and the sim reads them through cfgOf(state, key) at the one place each rate is applied:
//   hunger       eating.js baseEatHour, needs.js teamNeedsHour / errandHour
//   thirst       weather.js thirstFactor (the gauges and every water estimate with it)
//   spoil        foods.js ageLots (lots at a base, in packs and on a team), factions.js (the groups' coarse aging)
//   hordes       hordes.js makeHorde (every horde: a hive's, roaming, attacking, from the border)
//   siteDead     scavenge.js raidEnemies (the dead at a site when a team searches or raids it)
//   hiveGrowth   hives.js hivesDaily (a hive's income: what it buys hordes and growths with)
//   zDmg         combat.js damage (a hit from any of the dead; b.zDmg, set by createBattle / createRaid)
//   infectBite   carriers.js swarmBite, deadbeasts.js beastBite / beastHit (the worm from a bite; b.infectBite)
//   worm         worm.js (the worm from water, raw food, camping and searching: wormChance)
//   curable      worm.js courseTreatInfo and the road card (dewormer, purge, surgery and the hope it passes)
//   aiGear       arsenal.js seedArsenal (the kit a group is dealt), factions.js / hardcore-groups.js (starting rounds)
//   events       hubevents.js hubEventChance, events.js rollTravelEvent, tripevents.js (work trips out of the walls)
//   raids        factions.js (raids on you by the aggressive groups)
//   sickness     health.js illnessRisk
//   loot*        scavenge.js searchHour, combat.js searchBox (raids and city crawls), economy.js (the base job): lootMult
//   baseMin/Max  basemap.js gridOf (the yard a base starts with and the most it grows to)
//   raidMin/Max  battlesize.js raidDims / buildingTarget (raid maps: a site's place between the two, up to 300 across; cities and towns the largest), and past 40 × 30
//                the BIG scales: more dead, slower Heat, a smaller find a container (combat.js raidTurn / searchBox / spawnWave)
//   cityMin/Max  citygrid.js gridOf (blocks across a city crawl; a town is scaled the same way)
//   hiveMin/Max  hivecrawl.js denDepth (rings from a den's rim to its heart)
//   wear         crafting.js wearSlot, vehicles.js wear, armour.js (b.wear)
//   failures     gunfire.js jamChance (b.failures), vehicles.js breakdownRoll, breakdowns.js (machines)
//   fuel         parties.js / survey.js (what a tile of driving burns, and every estimate of it)
// Random run leaves it as set (it is the player's own, like Ironman). Old saves have no worldCfg: the defaults.

// ---------- the dials ----------
// kind "mult": a multiplier on the usual rate (1 is the game as it is). "int": a whole number. "bool": on or off.
// pair: the other end of a min–max pair (min ≤ max is kept by cleanCfg).
export const WORLD_CFG = {
  hunger: { group: "needs", name: "Hunger", kind: "mult", min: 0.25, max: 3, step: 0.05, def: 1, tip: "How fast people get hungry (at a base, on a team, on an errand). ×2: twice as fast, so twice the food eaten." },
  thirst: { group: "needs", name: "Thirst", kind: "mult", min: 0.25, max: 3, step: 0.05, def: 1, tip: "How fast people get thirsty, and so how much water a base and a team go through (every water estimate follows it)." },
  spoil: { group: "needs", name: "Food spoilage", kind: "mult", min: 0, max: 4, step: 0.05, def: 1, tip: "How fast food goes off, in the stores, in packs and on the road (cellars and freezers still slow it). 0: nothing ever spoils." },
  sickness: { group: "needs", name: "Sickness", kind: "mult", min: 0, max: 4, step: 0.05, def: 1, tip: "The chance of falling ill: colds, fevers, bad water, spoiled food, the cold and the heat. 0: nobody falls ill (injuries and the worm are not sickness)." },

  hordes: { group: "dead", name: "Horde size", kind: "mult", min: 0.25, max: 4, step: 0.05, def: 1, tip: "How many dead walk in every horde: a hive's hordes, roaming ones, the ones that attack a base and the ones that cross the border." },
  siteDead: { group: "dead", name: "Dead at sites", kind: "mult", min: 0, max: 4, step: 0.05, def: 1, tip: "How many of the dead a team finds at a site it searches or raids (still at most 14 to a group). 0: the sites are empty of them." },
  hiveGrowth: { group: "dead", name: "Hive growth", kind: "mult", min: 0, max: 4, step: 0.05, def: 1, tip: "How fast hives gather what they spend on hordes and growths. 0: the hives sit on what they have." },
  zDmg: { group: "dead", name: "Zombie damage", kind: "mult", min: 0.25, max: 4, step: 0.05, def: 1, tip: "How hard any of the dead hit in a battle: walkers, runners, brutes, the bosses and the dead beasts alike." },
  infectBite: { group: "dead", name: "Infection from bites", kind: "mult", min: 0, max: 4, step: 0.05, def: 1, tip: "The chance a bite that leaves the worm (a worm swarm's, a dead beast's) puts it in someone. 0: never from a bite." },
  worm: { group: "dead", name: "Infection from the land", kind: "mult", min: 0, max: 4, step: 0.05, def: 1, tip: "The chance of swallowing the worm from un-purified water, raw meat, camping on infested ground and searching infested sites. 0: never." },
  curable: { group: "dead", name: "Infection curable", kind: "bool", def: true, tip: "On (the usual game): a dewormer clears the worm surely, a purge by Medicine, surgery once it is in the brain, and now and then it passes on its own. Off: nothing takes it out; whoever catches it turns." },

  aiGear: { group: "people", name: "AI groups' starting gear", kind: "mult", min: 0.25, max: 3, step: 0.05, def: 1, tip: "What the other groups start armed with: their rounds, and above 1 a bigger share of their kit's best guns. The groups still arm themselves with the years." },
  events: { group: "people", name: "Events", kind: "mult", min: 0, max: 3, step: 0.05, def: 1, tip: "How often things happen: the cards at home, the cards on the road and the trouble work trips out of the walls meet. 0: a quiet world (what groups and the dead do on their own still happens)." },
  raids: { group: "people", name: "Raids on you", kind: "mult", min: 0, max: 4, step: 0.05, def: 1, tip: "How often the aggressive groups raid your bases. 0: never (their wars with each other go on)." },

  lootFood: { group: "loot", name: "Food", kind: "mult", min: 0, max: 4, step: 0.05, def: 1, tip: "Food found searching sites, in raid and crawl containers, and by the base's scavengers (cans, preserves, jars too)." },
  lootWater: { group: "loot", name: "Water", kind: "mult", min: 0, max: 4, step: 0.05, def: 1, tip: "Water found, purified and un-purified." },
  lootAmmo: { group: "loot", name: "Ammo", kind: "mult", min: 0, max: 4, step: 0.05, def: 1, tip: "Rounds found, every calibre, and arrows." },
  lootGuns: { group: "loot", name: "Guns and gear", kind: "mult", min: 0, max: 4, step: 0.05, def: 1, tip: "The chance of a gun, a weapon or a piece of kit turning up at a site, in a container or in a crawl." },
  lootParts: { group: "loot", name: "Parts", kind: "mult", min: 0, max: 4, step: 0.05, def: 1, tip: "Parts found, of every kind." },
  lootScrap: { group: "loot", name: "Scrap", kind: "mult", min: 0, max: 4, step: 0.05, def: 1, tip: "Scrap found." },
  lootMeds: { group: "loot", name: "Meds", kind: "mult", min: 0, max: 4, step: 0.05, def: 1, tip: "Meds found." },
  lootFuel: { group: "loot", name: "Fuel", kind: "mult", min: 0, max: 4, step: 0.05, def: 1, tip: "Fuel found." },

  baseMin: { group: "sizes", name: "Base yard to start", kind: "mult", min: 0.5, max: 2, step: 0.05, def: 1, pair: "baseMax", tip: "The yard a base starts with, as a share of the usual (76 across for every base since 2026-10-23). Smaller yards leave less room to build before the walls move out." },
  baseMax: { group: "sizes", name: "Base yard at most", kind: "mult", min: 0.5, max: 2, step: 0.05, def: 1, pair: "baseMin", tip: "The most a base's yard grows to, as a share of the usual (a hub's 180 across, an outpost's 100; camps and shelters do not grow). Never less than the yard it starts with, and the map stays within its biggest grid." },
  raidMin: { group: "sizes", name: "Raid map, smallest", kind: "int", min: 24, max: 80, step: 2, def: 32, pair: "raidMax", tip: "Tiles across the smallest raid map (a gas station's, a shed's, a building picked at a site with several); every map is three quarters as deep. The usual 32 × 24." },
  raidMax: { group: "sizes", name: "Raid map, largest", kind: "int", min: 24, max: 300, step: 2, def: 56, pair: "raidMin", tip: "Tiles across the largest raid map (a hospital's, a prison's); a city's and a town's raid maps, their buildings and their streets, are always at least this size. Every other site sits between the two. The usual 56 × 42; up to 300 across. A building's map is never smaller than the building at its real size (a cell is a metre: a hospital 60–100 m, a warehouse 40–80 m) and the outside round it, up to 300 × 300. Past 40 × 30 a map has more rooms, containers and dead, but Heat rises slower and each container holds a little less, and a street map gets a way out on both long sides; big maps cost more every turn." },
  cityMin: { group: "sizes", name: "City crawl, smallest", kind: "int", min: 4, max: 40, step: 1, def: 15, pair: "cityMax", tip: "The fewest blocks across a city crawl is (the usual 15–30; a town's 9–12 is scaled the same way)." },
  cityMax: { group: "sizes", name: "City crawl, largest", kind: "int", min: 4, max: 40, step: 1, def: 30, pair: "cityMin", tip: "The most blocks across a city crawl is (the usual 15–30). The heart of a bigger crawl climbs to a higher level." },
  hiveMin: { group: "sizes", name: "Hive crawl, shallowest", kind: "int", min: 1, max: 12, step: 1, def: 2, pair: "hiveMax", tip: "The fewest rings from a den's mouths to its heart (the usual 2 for a young hive, 9 for the oldest tier; a screamer spire adds one)." },
  hiveMax: { group: "sizes", name: "Hive crawl, deepest", kind: "int", min: 1, max: 12, step: 1, def: 9, pair: "hiveMin", tip: "The most rings from a den's mouths to its heart. A hive's tier still sets its depth between the two." },

  wear: { group: "wear", name: "Durability loss", kind: "mult", min: 0, max: 4, step: 0.05, def: 1, tip: "How fast weapons, tools, kits and armour wear with use, and vehicles with the miles. 0: nothing wears out." },
  failures: { group: "wear", name: "Failures", kind: "mult", min: 0, max: 4, step: 0.05, def: 1, tip: "The chance of a gun jamming, a vehicle breaking down on the road and a worn machine failing. 0: none of them fail." },
  fuel: { group: "wear", name: "Fuel use", kind: "mult", min: 0.25, max: 3, step: 0.05, def: 1, tip: "What a tile of driving burns (and every fuel estimate for a trip)." },
};
export const CFG_KEYS = Object.keys(WORLD_CFG);
export const CFG_GROUPS = [
  { key: "needs", name: "Needs and health", tip: "Hunger, thirst, spoilage and sickness." },
  { key: "dead", name: "The dead and the worm", tip: "Hordes, the dead at sites, the hives, their bite, and the worm." },
  { key: "people", name: "People and events", tip: "The other groups, the cards and the raids." },
  { key: "loot", name: "Loot by kind", tip: "What searching, raids, crawls and the base's scavengers turn up, kind by kind." },
  { key: "sizes", name: "Sizes", tip: "Bases, raid maps, city crawls and hive crawls, smallest to largest." },
  { key: "wear", name: "Wear, failures and fuel", tip: "What breaks, jams and burns." },
];

// ---------- presets ----------
// Each names the dials it moves; the rest stay at their defaults.
export const CFG_PRESETS = {
  gentle: { name: "Gentle", tip: "A slower, kinder state: people hunger and thirst at three quarters the rate, food keeps longer, fewer and weaker dead, fewer events and raids, more loot, less wear, smaller raid maps (28 to 48 across)", set: { raidMin: 28, raidMax: 48, hunger: 0.75, thirst: 0.75, spoil: 0.75, sickness: 0.75, hordes: 0.7, siteDead: 0.75, hiveGrowth: 0.75, zDmg: 0.8, infectBite: 0.75, worm: 0.75, aiGear: 0.8, events: 0.8, raids: 0.6, lootFood: 1.3, lootWater: 1.3, lootAmmo: 1.3, lootGuns: 1.25, lootParts: 1.3, lootScrap: 1.3, lootMeds: 1.3, lootFuel: 1.3, wear: 0.75, failures: 0.75, fuel: 0.85 } },
  standard: { name: "Standard", tip: "The game as it is: every dial at 1", set: {} },
  harsh: { name: "Harsh", tip: "Hungrier, thirstier, more and harder dead, better-armed groups, more trouble, less loot, faster wear, bigger raid maps (36 to 64 across)", set: { raidMin: 36, raidMax: 64, hunger: 1.25, thirst: 1.25, spoil: 1.25, sickness: 1.25, hordes: 1.4, siteDead: 1.3, hiveGrowth: 1.3, zDmg: 1.25, infectBite: 1.25, worm: 1.25, aiGear: 1.3, events: 1.2, raids: 1.5, lootFood: 0.75, lootWater: 0.8, lootAmmo: 0.7, lootGuns: 0.75, lootParts: 0.75, lootScrap: 0.85, lootMeds: 0.7, lootFuel: 0.75, wear: 1.3, failures: 1.3, fuel: 1.2 } },
  nightmare: { name: "Nightmare", tip: "Twice the hordes and the hive growth, the dead hit half again as hard, the worm cannot be cured, half the loot, double raids and wear, the biggest raid maps (40 to 72 across)", set: { raidMin: 40, raidMax: 72, hunger: 1.5, thirst: 1.5, spoil: 1.5, sickness: 1.5, hordes: 2, siteDead: 1.75, hiveGrowth: 2, zDmg: 1.5, infectBite: 1.5, worm: 1.5, curable: false, aiGear: 1.6, events: 1.4, raids: 2, lootFood: 0.5, lootWater: 0.6, lootAmmo: 0.5, lootGuns: 0.5, lootParts: 0.5, lootScrap: 0.7, lootMeds: 0.5, lootFuel: 0.5, wear: 2, failures: 1.75, fuel: 1.4 } },
};

// ---------- the settings object ----------
export function defaultCfg() {
  return Object.fromEntries(CFG_KEYS.map((k) => [k, WORLD_CFG[k].def]));
}
// One dial's value made safe: clamped to its range and step (a bool to true/false); anything unreadable is its default.
export function cleanValue(key, v) {
  const d = WORLD_CFG[key];
  if (!d) return undefined;
  if (d.kind === "bool") return v == null ? d.def : v === true || v === "true" || v === 1 || v === "1" || v === "on";
  const n = Number(v);
  if (!Number.isFinite(n)) return d.def;
  const c = Math.max(d.min, Math.min(d.max, n));
  const stepped = Math.round(c / d.step) * d.step; // an int dial by its step too (a raid map's 2: an odd 33 is 34, the width the map is)
  return Math.round(Math.max(d.min, Math.min(d.max, stepped)) * 1000) / 1000;
}
// A whole settings object made safe (unknown keys dropped, missing ones their default), min ≤ max in every pair
// (the one named second gives way: a min set above its max lifts the max, a max set below its min drops the min).
export function cleanCfg(raw, moved = null) {
  const out = defaultCfg();
  if (raw && typeof raw === "object") for (const k of CFG_KEYS) if (k in raw) out[k] = cleanValue(k, raw[k]);
  for (const k of CFG_KEYS) {
    const d = WORLD_CFG[k];
    if (!d.pair || !/Min$/.test(k)) continue;
    const mx = d.pair;
    if (out[k] > out[mx]) { if (moved === mx) out[k] = out[mx]; else out[mx] = out[k]; }
  }
  return out;
}
export const isDefaultCfg = (cfg) => !cfg || CFG_KEYS.every((k) => cfg[k] == null || cfg[k] === WORLD_CFG[k].def);
// The dials that are off their default: [key, value].
export const cfgChanges = (cfg) => (cfg ? CFG_KEYS.filter((k) => cfg[k] != null && cfg[k] !== WORLD_CFG[k].def).map((k) => [k, cfg[k]]) : []);
// A preset's settings (the rest at their defaults); null for an unknown one.
export const presetCfg = (key) => (CFG_PRESETS[key] ? cleanCfg({ ...defaultCfg(), ...CFG_PRESETS[key].set }) : null);
// The preset these settings are, if they are one exactly ("standard" for the defaults), else null.
export function presetOf(cfg) {
  const c = cleanCfg(cfg);
  for (const k of Object.keys(CFG_PRESETS)) { const p = presetCfg(k); if (CFG_KEYS.every((x) => p[x] === c[x])) return k; }
  return null;
}

// ---------- raid maps in an older save ----------
// Worlds made since the raid map dials (2026-10-20) carry state.raidMaps = RAID_MAPS (world.js createWorld); a save
// from before has none, and save.js marks it raidLegacy on load: its raid maps keep the sizes it was made with (the old
// table, 28 × 20 to 40 × 30, a town 36 × 26, a neighbourhood's street up to 48 × 34) and none of the big-map scales
// (battlesize.js BIG), so its places, their containers and what was left in them stay where they were.
export const RAID_MAPS = 1;
/** @param {any} state */
export const legacyRaids = (state) => !!(state && state.raidLegacy);
// A save from before homes were furnished room by room (save.js roomsLegacy): buildingmaps.js furnishes as it did.
export const legacyRooms = (state) => !!(state && state.roomsLegacy);
// A save from before the prison complexes (issue #31, save.js prisonLegacy: no state.prisonV): a prison keeps its pick
// of one building (buildingmaps.js SITES.prison) and no town has a county jail (pois.js jailExtra).
export const legacyPrisons = (state) => !!(state && (state.prisonLegacy || state.roomsLegacy));
// A save from before buildings had footprint shapes (save.js shapesLegacy, issue #23): every building the rectangle it was.
export const legacyShapes = (state) => legacyRooms(state) || !!(state && state.shapesLegacy);
// A save from before buildings at real size (issue #24, save.js scaleLegacy; an older one still, roomsLegacy): every
// building keeps the footprint and storeys its archetype gave it (buildingmaps.js realScale is not applied).
export const legacyScale = (state) => !!(state && (state.scaleLegacy || state.roomsLegacy));
// A save from before the office buildings of every kind (save.js officesLegacy, issue #27): its points of interest and
// its crawls' blocks get none of them (shops.js), and its office towers no firm, so its places stay as they were.
export const legacyOffices = (state) => !!(state && state.officesLegacy);
// A save from before the placement table (issue #42, save.js placeLegacy: no state.placeV): its points of interest, its
// crawls' blocks and its buildings stay as they were (placement.js placing is off).
export const legacyPlace = (state) => !!(state && state.placeLegacy);
// A save from before issue #55's six shops (save.js shopsR2Legacy): its points of interest and its crawls' blocks get
// none of them (shops.js, placement.js placeExtraKind), so its places stay as they were.
export const legacyShopsR2 = (state) => !!(state && state.shopsR2Legacy);
// The run's raid map dials as [smallest, largest]: each clamped to its range, the two in order whatever was stored
// (a hand-edited or older settings object can hold them the wrong way round: the range never runs backwards).
/** @param {any} state */
export function raidRange(state) {
  const a = cleanValue("raidMin", cfgOf(state, "raidMin")), b = cleanValue("raidMax", cfgOf(state, "raidMax"));
  return a <= b ? [a, b] : [b, a];
}

// ---------- reading them in the sim ----------
/** The dial on this world (its default when the world has none, or the dial is unset). @param {any} state */
export function cfgOf(state, key) {
  const d = WORLD_CFG[key];
  const c = state && state.worldCfg;
  if (!d) return 1;
  if (!c || c[key] == null) return d.def;
  return d.kind === "bool" ? !!c[key] : c[key];
}
// Put on a new world (world.js createWorld): kept only when something is off its default, so a standard world is the
// same object it always was.
export function setWorldCfg(state, raw) {
  const c = cleanCfg(raw);
  if (isDefaultCfg(c)) delete state.worldCfg;
  else state.worldCfg = c;
  return state.worldCfg || null;
}
// The dials a battle reads (combat.js createBattle / createRaid spread them on b: a battle has no state, and they are
// saved with it): the dead's damage, the worm from their bite, armour wear and gun jams.
/** @param {any} state */
export const battleDials = (state) => ({ zDmg: cfgOf(state, "zDmg"), infectBite: cfgOf(state, "infectBite"), wear: cfgOf(state, "wear"), failures: cfgOf(state, "failures") });
// A chance with a dial on it: never over 1.
export const cfgChance = (state, key, p) => Math.min(1, Math.max(0, p * cfgOf(state, key)));

// Loot by kind: the dial a supply key falls under (jars and preserves are food, raw water is water, arrows are ammo;
// anything else, wood among them, is not scaled).
const LOOT_OF = { food: "lootFood", preserved: "lootFood", jars: "lootFood", water: "lootWater", rawwater: "lootWater", ammo: "lootAmmo", arrows: "lootAmmo", parts: "lootParts", scrap: "lootScrap", metalsheet: "lootScrap", meds: "lootMeds", fuel: "lootFuel" };
export const lootKeyOf = (key) => LOOT_OF[key] || null;
/** The loot dial for a supply key (1 for one with no dial). @param {any} state */
export const lootMult = (state, key) => (LOOT_OF[key] ? cfgOf(state, LOOT_OF[key]) : 1);
/** A quantity under its loot dial: whole, and never 0 from a find unless the dial is 0. @param {any} state */
export function lootQty(state, key, qty) {
  const m = lootMult(state, key);
  if (m === 1 || !(qty > 0)) return qty;
  if (m <= 0) return 0;
  return Math.max(1, Math.round(qty * m));
}

// ---------- words ----------
const fmt = (k, v) => (WORLD_CFG[k].kind === "bool" ? (v ? "on" : "off") : WORLD_CFG[k].kind === "int" ? String(v) : `×${Math.round(v * 100) / 100}`);
export const cfgValueText = fmt;
// One line for the log and the new-run screen: "World: Hunger ×1.5, Horde size ×2, Infection curable off." ("" when standard).
export function cfgSummary(cfg) {
  const ch = cfgChanges(cfg);
  if (!ch.length) return "";
  const p = presetOf(cfg);
  const list = ch.map(([k, v]) => `${WORLD_CFG[k].name} ${fmt(k, v)}`).join(", ");
  return `${p ? `${CFG_PRESETS[p].name}: ` : ""}${list}.`;
}
