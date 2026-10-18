// Hardcore mode, your start (hardcore.js): the day Calder falls, three survivors on the road with whatever they grabbed
// as they fled, very low supplies and no hub.
// - How many (2026-10-07): the new-run screen's Starting people, 1–4 (hardcore.js START_PEOPLE; 3 by default, the
//   start described here). Each one rolls their own grab, so the team's own food and water scale with the head count
//   (1–3 days each: TEAM_MIN..TEAM_MAX per person; food by background, 2026-10-07: ARCHETYPES food); the car, its
//   trunk and a prepper's bag are one of each whatever the count (one car fled, one bag was packed), so a small team
//   has more of those per head and a big one less. One or two (HC_START.SMALL, 2026-10-07): a skill bump and the
//   car's empty seats loaded, so a solo or a pair is not several times deadlier than three (and on the road fewer
//   armed strangers, and fewer of them: wanderers.js HC_SMALL).
//
// - Spawn: a random open land tile (no site on it), reasonably central, away from the outbreak (its origin, the city
//   where the first hive rises and the hives mapgen placed), the cities, the military sites and the other groups, with a town or a few sites within a
//   day or two's walk (somewhere to scavenge and to settle) and a river or lake within 6 tiles (10 relaxed: a camp has no spring).
// - What they grabbed: each survivor fled with a bag (a school backpack, a sling bag, now and then a hiking pack) and a
//   few things in it, or with only their clothes and pockets (0–4 small things). Maybe a weapon from the house: a kitchen
//   knife, a bat, a crowbar, a pistol with a few rounds. The team's food and water (pooled, like any team's) come from
//   what they carried: 1–3 days' worth for three. Almost no ammo, no fuel, no vehicle.
// - Who they were (HC_START.ARCHETYPES, 2026-10-06): each of the three is drawn, no two alike, from a set of
//   backgrounds (a prepper, a veteran, a college student, an office worker, a blue-collar worker, a nurse, a farmer, a
//   hunter, a mechanic, a cop, a trucker, a teacher; weighted). A background bumps two or three skills, often brings a
//   fitting trait when a slot allows, and shapes what they grabbed: how likely a bag and which, what weapon, what small
//   things (rollGrab reads the archetype's tables over the common ones). s.background holds the key (the People tab
//   shows it). The prepper keeps the packed duffle bag (HC_START.PREPPER, rollPrepper) and the Prepper trait;
//   state.hardcore.start.prepper is their id when one of the three is a prepper (else null).
// - The car (HC_START.CAR): one of the three fled in their car (whose: by their background's CAR_ODDS; the kind by its
//   CARS: preppers and blue-collar workers mostly trucks, a prepper now and then a Hummer, students and office workers
//   sedans or SUVs, veterans trucks or Hummers, truckers and tradesmen vans). Its tank is at least half full
//   (CAR.FUEL), its condition CAR.CONDITION, and in the back is what its owner kept there (TRUNK: groceries, tools and
//   lumber (scrap), prepper gear, a lunch...), as the team's cargo. The team sets off in it (p.vehicle), and it parks
//   at the first hub when the camp is founded (staging.js settleInto). state.hardcore.start.car is its id.
// - The team is on the road (a state.parties entry, like the exiles in conquest.js): no base, no home to return to.
//   You are with them, so they always report and take orders (radio contact without a radio).
// - The first hub: Build outpost becomes Establish base, a camp (the barest base: the team moves in) with its step up
//   into a shelter queued; the team brings the materials in and its builders build it up over a few days (staging.js
//   STAGING.HARDCORE). The shelter is the hub, empty: no buildings, no truck. Losing every base later is the normal
//   game's exile (conquest.js): Establish base again; later outposts are camps too (Build outpost).
// Everything here runs only in a hardcore world (hardcore.js isHardcore).
import { typedFood, typeFind, addFoodsTo } from "./foods.js"; // the first food, by type
import { keyWord } from "./water.js"; // supplies as words: "9mm FMJ", "rounds"
import { GEAR, SUPPLY_KEYS, TRAITS, SKILL_NAMES, clashIn } from "./data.js";
import { bornTraits, tidyTiers } from "./traits.js"; // what the world's dice rolled at birth, before the newer traits came in
import { VEHICLE_TYPES, createVehicle } from "./vehicles.js";
import { newId, makeSurvivor, applyCrew, assignStartingRoles, log, day, hub, addCard } from "./world.js";
import { newItem, packOf, POCKETS, START_DUR, startKit } from "./inventory.js";
import { randomStarterMods } from "./gunmods.js"; // starting guns may carry a cheap attachment
import { starterLoad, pocketBox, settleParty, calOf, gunCals, calibrate, addRecord, roundsText } from "./ammo.js"; // rounds by calibre
import { baseKey, ROUND_KEYS } from "./rounds.js";
import { ROUND_SUPPLIES } from "./data-ammo.js";
// The rounds a grab brought, by key (got.roundKeys): n of the common round of this gun's calibre (2026-10-09, user
// request: "All ammo should be based on caliber": a grab's rounds are for the gun they actually got). got.ammo: how
// many, for the day-1 lines.
const gunRounds = (got, wkey, n) => { const c = calOf(wkey); if (!c || !(n > 0)) return; got.roundKeys[baseKey(c)] = (got.roundKeys[baseKey(c)] || 0) + n; got.ammo += n; };
// Only the rounds of a record ({ key: n }).
const roundsOnly = (rec) => Object.fromEntries(Object.entries(rec || {}).filter(([k, q]) => ROUND_SUPPLIES[k] && q > 0));
// What someone has with them at the start, looked after but worn (inventory.js START_DUR).
const startItem = (rng, key, q) => newItem(key, q, rng, START_DUR);
import { Rng } from "./rng.js";
import { pickStart } from "./startpick.js"; // where you start, rolled again on the same map
import { meleeBump, cookingBump } from "./appearance.js"; // a background's Melee bump: its own die
import { sightRadius, partyMembers, partyTile, weighTeam } from "./parties.js";
import { isHardcore } from "./hardcore.js";
import { isCustomBg } from "./custombg.js";
import { grabStartGear, addPickedSupplies, trunkFromPicks, loadGun, pickOf } from "./startgear.js"; // gear picked on the new-run screen (Customize)
import { hcOutbreakCity } from "./hardcore-outbreak.js";
import { STAGING, ESTABLISH_LABEL, needText, shelterText, waterSource } from "./staging.js";
import { swapGun } from "./gundist.js"; // the gun distribution: which gun they grabbed

export const HC_START = {
  CREW: 3,
  // Spawn: tiles from the outbreak origin, the hives, a city centre, a military site and a group's base (strict, then
  // relaxed if no tile qualifies); the share of the map kept clear of the edges; a town, a city or any other site
  // (a POI) within POI tiles (they have a car: somewhere to drive to on day 1).
  // outbreakCity: from the centre of the city where the first hive rises (hardcore-outbreak.js hcOutbreakCity).
  // water: a river or lake within this many tiles (a camp has no spring: staging.js), strict / relaxed.
  SPAWN: { origin: [14, 9], hive: [8, 5], city: [3, 2], outbreakCity: [14, 10], military: [7, 4], group: [6, 4], edge: [0.2, 0.12], poi: [5, 8], maxInfection: 0.35, water: [6, 10] },
  // What they grabbed. PACK: the chance someone fled with a bag; which bag (weights); how many things in it.
  PACK: 0.5,
  PACKS: { backpack: 5, slingbag: 3, hikingpack: 1 },
  PACK_ITEMS: [2, 5],
  POCKET_ITEMS: [0, 4],
  // A weapon from the house: the chance with a bag / with only pockets, and which (weights). A gun comes with a few rounds.
  WEAPON: { pack: 0.65, pockets: 0.4 },
  WEAPONS: { knife: 6, bat: 3, prybar: 1.5, pistol: 1.2, machete: 0.8, revolver: 0.5, huntrifle: 0.3, pocketknife: 2, lockback: 0.6, flipknife: 0.3 }, // knives (data-blades.js)
  ROUNDS: { pistol: [3, 12], revolver: [2, 6], huntrifle: [2, 5] },
  // Small things in pockets (weights; all GEAR keys with small: true) and more in a bag (any non-bulky item).
  POCKET_STUFF: { phone: 4, lighters: 3, flashlight: 2, photos: 3, chocolate: 2, candy: 2, smokes: 1.5, batteries: 1.5, bandagekit: 1, goldring: 0.8, watch: 0.6, tobacco: 0.5, tea: 0.4, cards: 0.6, harmonica: 0.3, monocular: 0.2, coins: 0.3 },
  PACK_STUFF: { flashlight: 3, bandagekit: 3, chocolate: 2, candy: 1.5, instcoffee: 1, novel: 1.2, toiletpaper: 1.2, soap: 1, candles: 1, batteries: 1.5, lighters: 1.5, photos: 1, whiskey: 0.6, vodka: 0.5, laptop: 0.4, magazines: 0.6, cards: 0.6, binoculars: 0.3, survivalbook: 0.3, medbook: 0.2, gardenbook: 0.2, fishrod: 0.3, snarewire: 0.3, stove: 0.15, waterfilter: 0.15 },
  // Food and water each one brings (a bag holds more), clamped for the team to 1–3 days each (TEAM_MIN..TEAM_MAX per
  // person: 3–9 for three). Food by background (ARCHETYPES food, 2026-10-07): a farmer, a hunter or a trucker grabbed
  // more to eat (and lifts the team's cap to their own max), a veteran, a nurse, a mechanic or a cop less (they ran
  // with ammo, a vest, meds or tools instead); the others use FOOD.
  FOOD: { pack: [1, 3], pockets: [0, 1] },
  WATER: { pack: [1, 3], pockets: [0, 1] },
  TEAM_MIN: 1, TEAM_MAX: 3,
  MEDS: { pack: 0.35 }, // a bottle of pills in the bag
  // The prepper (2026-10-06): one of the three (which one: the dice, by seed) kept a go-bag by the door: a duffle bag
  // (data.js, bigger than a hiking pack) with FOOD and WATER (five days for three, pooled with the team's like
  // everyone's), MEDS, a charcoal water filter in the off hand (it cleans what the team fetches: worm.js), KIT always
  // (the filter, a hand-crank radio that only listens (radio.js) and a tube of purification tablets for the road
  // (worm.js: the filter stays with whoever holds it, the tablets go in anyone's pocket), a flashlight, bandages,
  // lighters, batteries), EXTRA_N more from EXTRA, a knife or (GUN chance) a gun from GUNS with AMMO rounds, and the Prepper trait (data.js, a
  // background trait never rolled at birth) when they have fewer than MAX_TRAITS traits; else only the log line says it.
  PREPPER: {
    BAG: "duffle", FOOD: 15, WATER: 15, MEDS: 2, AMMO: 20, GUN: 0.5,
    GUNS: { pistol: 3, revolver: 1.5, huntrifle: 1 },
    KIT: ["waterfilter", "handradio", "puritabs", "flashlight", "bandagekit", "lighters", "batteries"],
    EXTRA: { survivalbook: 1, stove: 1, snarewire: 1, instcoffee: 1, candles: 0.6, medbook: 0.4, fishrod: 0.6, binoculars: 0.5, soap: 0.6, toiletpaper: 0.5 },
    EXTRA_N: [2, 3],
    MAX_TRAITS: 2,
  },
  // Who they were. w: the draw's weight (no two of the three alike). skills: + a roll of [lo, hi] each. traits: fitting
  // ones (weights), one pushed at TRAIT_ODDS when a slot allows (never beside one it clashes with: data.js TRAIT_CLASH). pack / packs / weapons /
  // stuff: over the common PACK / PACKS / WEAPONS / PACK_STUFF (stuff is merged in on top, so the common things still
  // turn up). armor: worn from the start. meds: carried on top of a bag's bottle. rounds: × the common ROUNDS.
  // food (2026-10-07): what they grabbed to eat, over the common FOOD ({ pack, pockets } rolls; max: their share of
  // the team's cap in place of TEAM_MAX). Per head the draw averages about what FOOD gives (+0.1 food a head), so a
  // team of three carries about what it did; a fourth brings food by who they were.
  // cars: the kind of car when the car is theirs (weights); carOdds: how likely the car is theirs against the others'.
  // trunk: what was in the back: supplies [lo, hi] each, and N [lo, hi] things from gear (weights).
  // Balance (2026-10-07): the skill bumps average 6–8.5 points a background, and the ones that bring the most kit
  // (the veteran's vest and rifle, the cop's vest and pistol, the prepper's bag) get the fewest or turn up less; the
  // ones with little kit (office worker, teacher, trucker, blue-collar worker) more skills and a useful thing or two.
  // Cooking (2026-10-10, kitchen.js): the farmer most, the prepper, the hunter and the trucker a little, on its own die
  // (appearance.js cookingBump).
  // Melee (2026-10-09): the hands-on ones bump it (blue-collar, veteran, cop most; prepper, farmer, mechanic, trucker a
  // little), on a die of its own (appearance.js meleeBump), so the other bumps and everything after draw what they did.
  TRAIT_ODDS: 0.6,
  ARCHETYPES: {
    prepper:    { name: "Prepper",            w: 0.9, skills: { scavenging: [2, 4], scouting: [1, 3], shooting: [1, 3], melee: [1, 2], cooking: [1, 2] }, traits: {}, carOdds: 1.3,
                  cars: { truck: 4, hummer: 2, suv: 2 }, trunk: { food: [6, 12], water: [6, 12], fuel: [4, 10], ammo: [10, 30], n: [2, 4], gear: { stove: 1, snarewire: 1, fishrod: 1, camonet: 0.8, tripwire: 0.6, flare: 1, survivalbook: 0.6, beartrap: 0.5, waterfilter: 0.5 } },
                  blurb: "saw it coming" },
    veteran:    { name: "Veteran",            w: 1, skills: { shooting: [3, 5], leadership: [1, 2], scouting: [1, 2], melee: [2, 3] }, traits: { brave: 3, tough: 2 }, carOdds: 1.2, food: { pack: [1, 2], pockets: [0, 1] },
                  pack: 0.8, packs: { assaultpack: 3, rucksack: 2, backpack: 1 }, weapons: { pistol: 3, huntrifle: 1, machete: 1.5, knife: 1.5, bayonet: 0.6, survivalknife: 0.5 }, weaponOdds: 0.8, rounds: 1.5, armor: { vest: 0.35 },
                  stuff: { binoculars: 2, bandagekit: 2, tourniquet: 2, flare: 1.5, milradio: 0.3, smokegren: 0.5 },
                  cars: { truck: 3, hummer: 2, suv: 1 }, trunk: { food: [2, 5], water: [2, 5], ammo: [8, 18], n: [1, 3], gear: { milradio: 0.5, binoculars: 1, flare: 1, smokegren: 0.5, bandagekit: 1, assaultpack: 0.5, vest: 0.4, nvg: 0.1 } },
                  blurb: "two tours and a bad knee" },
    student:    { name: "College student",    w: 1, skills: { stealth: [1, 3], scavenging: [1, 3], speech: [1, 2], scouting: [1, 2] }, traits: { lucky: 1, nightowl: 2 }, carOdds: 0.7,
                  pack: 0.9, packs: { backpack: 6, slingbag: 2 }, weapons: { bat: 3, knife: 2, pocketknife: 1, balisong: 0.4 }, weaponOdds: 0.5,
                  stuff: { laptop: 2, novel: 1.5, candy: 2, chocolate: 1, phone: 2, instcoffee: 1, cards: 1, magazines: 1 },
                  cars: { sedan: 4, suv: 1.5 }, trunk: { food: [2, 4], water: [1, 3], n: [1, 2], gear: { laptop: 1, novel: 1, magazines: 1, console: 0.5, guitar: 0.4, backpack: 0.6, bicycle: 0.3 } },
                  blurb: "halfway through a degree" },
    office:     { name: "Office worker",      w: 1, skills: { speech: [2, 4], leadership: [2, 3], scavenging: [1, 2] }, traits: { keeneye: 2, badback: 1 }, carOdds: 0.9, meds: [0, 1],
                  pack: 0.5, packs: { slingbag: 4, backpack: 2 }, weapons: { knife: 3, bat: 1, pocketknife: 2, boxcutter: 1 }, weaponOdds: 0.5,
                  stuff: { laptop: 2, instcoffee: 2, phone: 2, bandagekit: 1.5, flashlight: 1, watch: 0.8, cards: 0.6, coins: 0.5 },
                  cars: { sedan: 4, suv: 2 }, trunk: { food: [1, 2], water: [2, 4], n: [1, 2], gear: { laptop: 1, instcoffee: 1, coffee: 0.5, bandagekit: 0.8, cards: 0.6, phone: 0.8, watch: 0.3 } },
                  blurb: "a lunch bag and a laptop" },
    bluecollar: { name: "Blue-collar worker", w: 1.2, skills: { mechanics: [3, 5], scavenging: [2, 3], melee: [2, 4] }, traits: { tough: 2, loud: 1 }, carOdds: 1.4,
                  pack: 0.5, packs: { backpack: 4, slingbag: 1 }, weapons: { prybar: 3, fireaxe: 1, bat: 2, knife: 1, boxcutter: 1, multitool: 0.5 }, weaponOdds: 0.7,
                  stuff: { lighters: 2, smokes: 1.5, flashlight: 2, batteries: 1.5 },
                  cars: { truck: 5, van: 3 }, trunk: { food: [1, 3], water: [2, 4], scrap: [6, 14], parts: [0, 2], n: [1, 3], gear: { sledge: 1, prybar: 1, fireaxe: 0.6, crowbar: 1, sandbags: 0.5, barbedwire: 0.3, tirevest: 0.4 } },
                  blurb: "tools and lumber in the back" },
    nurse:      { name: "Nurse",              w: 1, skills: { medicine: [4, 7], speech: [1, 2] }, traits: { medic: 3 }, carOdds: 0.9, food: { pack: [0, 2], pockets: [0, 1] },
                  pack: 0.7, packs: { backpack: 3, slingbag: 3 }, weapons: { knife: 4 }, weaponOdds: 0.5, meds: [1, 3],
                  stuff: { bandagekit: 3, surgkit: 0.8, soap: 1, razors: 0.5 },
                  cars: { sedan: 3, suv: 2 }, trunk: { meds: [2, 5], food: [1, 2], water: [1, 2], n: [1, 2], gear: { bandagekit: 3, surgkit: 1, medbook: 0.5, dewormer: 0.5 } },
                  blurb: "came off a double shift" },
    farmer:     { name: "Farmer",             w: 1, skills: { farming: [4, 7], mechanics: [1, 2], shooting: [0, 2], melee: [1, 2], cooking: [1, 3] }, traits: { tough: 2 }, carOdds: 1.2, food: { pack: [2, 5], pockets: [1, 2], max: 5 },
                  pack: 0.5, packs: { backpack: 3, hikingpack: 1 }, weapons: { huntrifle: 2, machete: 2, knife: 1, leverrifle: 0.5, huntknife: 0.6, pocketknife: 0.6 }, weaponOdds: 0.6, rounds: 1.5,
                  stuff: { gardenbook: 1.5, snarewire: 1, honey: 0.8, tobacco: 0.6 },
                  cars: { truck: 5, suv: 1 }, trunk: { food: [6, 12], preserved: [2, 6], jars: [2, 6], water: [2, 4], n: [1, 2], gear: { gardenbook: 1, snarewire: 1, fishrod: 0.8, barbedwire: 0.5, huntrifle: 0.3, beartrap: 0.4 } },
                  blurb: "a truck full of the harvest" },
    hunter:     { name: "Hunter",             w: 0.9, skills: { shooting: [3, 5], scouting: [1, 3], stealth: [1, 2], cooking: [1, 2] }, traits: { keeneye: 3 }, carOdds: 1.1, food: { pack: [2, 4], pockets: [1, 2], max: 4 },
                  pack: 0.7, packs: { hikingpack: 3, backpack: 2 }, weapons: { huntrifle: 3, compbow: 1.5, xbow: 1, knife: 1, huntknife: 1.5, bowie: 0.5 }, weaponOdds: 0.8, rounds: 1.5,
                  stuff: { binoculars: 2, camonet: 1, gamecall: 1, snarewire: 1, fishrod: 0.8 },
                  cars: { truck: 4, suv: 2 }, trunk: { food: [2, 5], ammo: [8, 20], n: [1, 3], gear: { camonet: 1, binoculars: 1, gamecall: 1, snarewire: 1, beartrap: 0.8, ghillie: 0.4, stove: 0.8, monocular: 0.5 } },
                  blurb: "knows every deer trail" },
    mechanic:   { name: "Mechanic",           w: 0.9, skills: { mechanics: [4, 7], scavenging: [1, 3], melee: [1, 2] }, traits: { tough: 1, loud: 1 }, carOdds: 1.3, food: { pack: [0, 2], pockets: [0, 1] },
                  pack: 0.5, packs: { backpack: 3, slingbag: 1 }, weapons: { prybar: 3, bat: 1, knife: 1, multitool: 1 },
                  stuff: { crowbar: 1.5, flashlight: 2, batteries: 1.5, lighters: 1 },
                  cars: { truck: 3, van: 2, sedan: 1 }, trunk: { parts: [2, 5], scrap: [4, 10], fuel: [3, 8], n: [1, 2], gear: { crowbar: 1, flashlight: 1, enginebook: 0.5, batteries: 1 } },
                  blurb: "grease under the nails" },
    cop:        { name: "Police officer",     w: 0.8, skills: { shooting: [2, 4], speech: [1, 3], leadership: [1, 2], melee: [2, 3] }, traits: { brave: 2 }, carOdds: 1, food: { pack: [0, 2], pockets: [0, 1] },
                  pack: 0.4, packs: { slingbag: 2, backpack: 2 }, weapons: { pistol: 5, baton: 1 }, weaponOdds: 0.9, rounds: 1.5, armor: { vest: 0.5 },
                  stuff: { cuffs: 1.5, flashlight: 2, flare: 1 },
                  cars: { suv: 3, sedan: 2 }, trunk: { ammo: [10, 24], n: [1, 3], gear: { cuffs: 1, baton: 0.5, riothelmet: 0.5, riotarms: 0.5, flare: 1, flashlight: 1, shotgun: 0.4 } },
                  blurb: "still in half a uniform" },
    trucker:    { name: "Trucker",            w: 0.8, skills: { mechanics: [2, 3], scouting: [3, 5], shooting: [0, 2], melee: [1, 2], cooking: [1, 2] }, traits: { nightowl: 2, badback: 1 }, carOdds: 1.5, food: { pack: [1, 4], pockets: [1, 1], max: 4 },
                  pack: 0.4, packs: { slingbag: 3, backpack: 1 }, weapons: { bat: 2, revolver: 1.5, knife: 1, lockback: 1 },
                  stuff: { pocketradio: 1.5, smokes: 1.5, instcoffee: 1.5, cards: 1, harmonica: 0.5 },
                  cars: { van: 3, truck: 3 }, trunk: { food: [8, 16], water: [4, 8], fuel: [4, 8], n: [1, 2], gear: { pocketradio: 1, cards: 0.8, smokes: 0.8, instcoffee: 1, tirevest: 0.3 } },
                  blurb: "a cab full of coffee cups" },
    teacher:    { name: "Teacher",            w: 0.8, skills: { speech: [3, 5], leadership: [2, 4], medicine: [1, 2] }, traits: { keeneye: 1 }, carOdds: 0.8, meds: [0, 1],
                  pack: 0.7, packs: { slingbag: 3, backpack: 2 }, weapons: { knife: 3, bat: 1, pocketknife: 1 }, weaponOdds: 0.5,
                  stuff: { novel: 2, puzzlebook: 1, cards: 1, instcoffee: 1, bandagekit: 1.5, flashlight: 1 },
                  cars: { sedan: 3, suv: 1.5 }, trunk: { food: [1, 3], water: [1, 2], n: [1, 3], gear: { novel: 2, puzzlebook: 1, cards: 1, survivalbook: 0.3, medbook: 0.3, talkbook: 0.5, leadbook: 0.3 } },
                  blurb: "a car boot full of books" },
  },
  // The car: whose (ARCHETYPES carOdds), the tank's fill [lo, hi] of its tank, the condition [lo, hi].
  CAR: { FUEL: [0.5, 1], CONDITION: [55, 90] },
  // Small teams (2026-10-07): the one or two who got out are the ones who could look after themselves, and the car's
  // empty seats were loaded too. For each seat short of CREW (three; emptySeats): each of them gets + a roll of SKILL
  // [lo, hi] in each of SKILLS (Scouting, Stealth, Medicine: finding food, slipping past trouble, patching yourself
  // up), and the back seat holds SEAT [lo, hi] of each supply on top of the trunk. Alone (two seats): +2–4 in each,
  // 6–12 food, 6–12 water, 2 meds; a pair (one seat): +1–2, 3–6 food, 3–6 water, 1 meds. Three or four: nothing (no
  // dice drawn, so a default start is the same start).
  SMALL: { SKILLS: ["scouting", "stealth", "medicine"], SKILL: [1, 2], SEAT: { food: [3, 6], water: [3, 6], meds: [1, 1] } },
  // The first hub: a camp built up into a shelter (staging.js STAGING.HARDCORE: what it takes and the work).
};
// For the UI (the People tab's background chip) and the tools: { key: { name, blurb } }.
export const BACKGROUNDS = Object.fromEntries(Object.entries(HC_START.ARCHETYPES).map(([k, a]) => [k, { name: a.name, blurb: a.blurb }]));
// A background by key: a preset (ARCHETYPES), or one the player made for this world (custombg.js, state.customBackgrounds).
export function archetypeOf(state, key) {
  if (isCustomBg(key)) return (state && state.customBackgrounds && state.customBackgrounds[key]) || null;
  return HC_START.ARCHETYPES[key] || null;
}
// { name, blurb, custom } for the chips, else null.
export function backgroundInfo(state, key) {
  const a = key ? archetypeOf(state, key) : null;
  return a ? { name: a.name, blurb: a.blurb || "", custom: !!a.custom } : null;
}

const r1 = (v) => Math.round(v * 10) / 10;
// Seats short of the default three (HC_START.SMALL): 2 alone, 1 for a pair, 0 for three or four.
export const emptySeats = (n) => Math.max(0, HC_START.CREW - n);
// "one" to "four" (the starting team's size, hardcore.js START_PEOPLE), else the digits.
export const countWord = (n) => ["no one", "one", "two", "three", "four", "five", "six"][n] || String(n);
const firstName = (s) => s.name.split(" ")[0];

// ---------- the contract with the other parts ----------
// The tile the player is at: the hub, else the team on the road (the first team of yours), else where you started.
export function playerTile(state) {
  const h = hub(state);
  if (h) return h.tile;
  if (state.bases.length) return state.bases[0].tile;
  const p = roadTeam(state) || state.parties.find((q) => q.owner === "player" && q.kind !== "convoy" && partyMembers(state, q).length);
  if (p) return partyTile(p);
  const hc = state.hardcore && state.hardcore.start;
  return hc ? hc.lastTile ?? hc.tile : state.originId;
}

// True while a hardcore run has not founded its first hub yet (later, a hub lost is the normal game's exile).
export const firstHubPending = (state) => isHardcore(state) && !!(state.hardcore && state.hardcore.start) && state.hardcore.start.foundedDay == null;
// The team on the road before the first hub (you are with it): the player team that carries the start's flag, else any.
export function roadTeam(state) {
  if (!firstHubPending(state)) return null;
  const mine = state.parties.filter((p) => p.owner === "player" && p.kind !== "convoy" && partyMembers(state, p).length);
  return mine.find((p) => p.hcStart) || mine[0] || null;
}
// You are with this team (before the first hub): it always reports and takes orders, and you see what it sees.
export const withYou = (state, p) => firstHubPending(state) && !!p && p.owner === "player" && p.kind !== "convoy";

// ---------- founding the first hub ----------
// The first hub is a camp built up into a shelter over days (staging.js: Establish base, the materials, the work).
// When the shelter stands (buildings.js upgradeShelter, staging.js campBecameShelter) this marks the day.
// when: how long the camp took ("4 days after the camp went up").
export function hubFounded(state, base, when = "") {
  const hc = state.hardcore.start;
  hc.foundedDay = day(state);
  hc.foundedHour = state.hour;
  hc.hubTile = base.tile;
  base.name = base.name.replace(/ (Outpost|Camp)( \d+)?$/, " Holdout");
  if (state.bases.some((b) => b !== base && b.name === base.name)) base.name = `${base.name} ${base.id}`;
  base.hcFirst = true;
  assignStartingRoles(state); // jobs by skill, as a normal start does (world.js)
  const text = base.tier === 0
    ? `Day ${day(state)}: the camp is a shelter now. ${base.name} is founded, your first shelter${when ? `, ${when}` : ""}. ${shelterText()} Build it up before the cold.`
    : `Day ${day(state)}: the camp is built up. ${base.name} is founded, your first hub${when ? `, ${when}` : ""}. It is bare: no buildings yet, a barricade of scrap and the camp's stores. Build farm plots, a well and beds before the cold.`;
  log(state, text, "good");
  addCard(state, { title: "A place of your own", text, choices: [{ label: "OK", resolve: () => "" }] });
}

// ---------- the spawn ----------
function spawnTile(state, start = null) {
  const g = state.grid, rng = state.rng, S = HC_START.SPAWN;
  const W = g.width, H = g.height;
  const hives = state.tiles.filter((t) => t.hive).map((t) => t.id);
  const groupBases = state.factions.flatMap((f) => f.bases || []);
  const within = (id, list, d) => list.some((x) => x != null && g.distance(id, x) <= d);
  const outbreakCity = hcOutbreakCity(state); // the first hive rises there (set up after the start)
  // A town, a city or any other site within reach: somewhere to drive to on day 1.
  const pois = state.tiles.filter((t) => t.loc || t.terrain === "city").map((t) => t.id);
  const sitesOk = (id, reach) => pois.some((x) => g.distance(id, x) <= reach);
  const okFor = (strict) => (t) => {
    const i = strict ? 0 : 1;
    if (t.terrain === "water" || t.terrain === "mountain" || t.terrain === "city" || t.hive || t.loc) return false;
    const e = S.edge[i];
    if (t.x < W * e || t.x >= W * (1 - e) || t.y < H * e || t.y >= H * (1 - e)) return false;
    if (g.distance(t.id, state.originId) < S.origin[i] || within(t.id, hives, S.hive[i])) return false;
    if (outbreakCity != null && g.distance(t.id, outbreakCity) < S.outbreakCity[i]) return false;
    if (within(t.id, state.cityIds || [], S.city[i])) return false; // not in a city centre (its blocks can be close by)
    if (within(t.id, state.militaryIds || [], S.military[i]) || within(t.id, groupBases, S.group[i])) return false;
    if ((t.infection || 0) > S.maxInfection * (strict ? 1 : 1.5)) return false;
    if (!waterSource(state, t.id, S.water[i])) return false; // somewhere to drink within a few days' walk
    return sitesOk(t.id, S.poi[i]);
  };
  // start: a start of its own on the same map (startpick.js; the new-run screen's New start position).
  const land = () => state.tiles.filter((t) => t.terrain !== "water" && t.terrain !== "mountain" && !t.hive);
  return pickStart(rng, [() => state.tiles.filter(okFor(true)), () => state.tiles.filter(okFor(false)), land], start);
}

// ---------- what they grabbed ----------
const pickW = (rng, table) => rng.weighted(Object.keys(table), (k) => table[k]);
// ---------- who they were ----------
// Draws n backgrounds, no two alike, by weight (ARCHETYPES w). Deterministic by the state's rng.
export function drawArchetypes(state, n = HC_START.CREW) {
  const rng = state.rng, pool = { ...HC_START.ARCHETYPES };
  const out = [];
  while (out.length < n && Object.keys(pool).length) {
    const k = rng.weighted(Object.keys(pool), (x) => pool[x].w);
    delete pool[k];
    out.push(k);
  }
  return out;
}
// Backgrounds picked on the new-run screen (crew[i].background: a preset or a custom key; null: the dice). The draw
// runs as ever (so the dice are the same dice), then a pick takes its seat, and a drawn one that repeats a pick is
// drawn again from the presets nobody has (no two alike among the drawn; two picks may match). No picks: the draw.
export function pickArchetypes(state, n, picks) {
  const kinds = drawArchetypes(state, n);
  if (!picks || !picks.some(Boolean)) return kinds;
  picks.forEach((k, i) => { if (k && i < n) kinds[i] = k; });
  for (let i = 0; i < n; i++) {
    if (picks[i]) continue;
    if (!kinds.some((k, j) => j !== i && k === kinds[i])) continue;
    const pool = Object.keys(HC_START.ARCHETYPES).filter((k) => !kinds.includes(k));
    if (pool.length) kinds[i] = state.rng.weighted(pool, (x) => HC_START.ARCHETYPES[x].w);
  }
  return kinds;
}
// What a background makes of someone: the skill bumps, a fitting trait when a slot allows, the key on them. A custom
// one (custombg.js) adds exactly its bumps and gives all its traits (they go first, a rolled trait that clashes with
// one of them (data.js TRAIT_CLASH) goes; three in all), and draws no dice.
// A preset's fitting trait: whether it is drawn (and which, by its weight) goes by what the world's dice rolled at birth
// (traits.js bornTraits), so the newer traits, which come in with dice of their own, move none of the world's dice;
// a pick they already have, or one that clashes with theirs, is drawn and not given.
export function applyArchetype(state, s, key) {
  const rng = state.rng, A = archetypeOf(state, key);
  if (!A) return;
  s.background = key;
  if (A.custom) {
    for (const [k, v] of Object.entries(A.skills || {})) s.skills[k] = Math.min(20, (s.skills[k] || 0) + v);
    const mine = [...A.traits];
    s.traits = [...mine, ...s.traits.filter((t) => !mine.includes(t) && !clashIn(mine, t))].slice(0, Math.max(3, mine.length));
    tidyTiers(s, { ...(s.traitTier || {}), ...Object.fromEntries(mine.map((t) => [t, (A.traitTier && A.traitTier[t]) || 1])) }); // its tiers (traits.js)
    return;
  }
  for (const [k, [lo, hi]] of Object.entries(A.skills || {})) s.skills[k] = Math.min(20, (s.skills[k] || 0) + (k === "melee" ? meleeBump(state.seed, s.name, lo, hi, key) : k === "cooking" ? cookingBump(state.seed, s.name, lo, hi, key) : rng.int(lo, hi))); // Melee and Cooking: dice of their own
  const born = bornTraits(s);
  const want = Object.keys(A.traits || {}).filter((t) => TRAITS[t] && !born.includes(t) && !clashIn(born, t));
  if (want.length && s.traits.length < 2 && rng.chance(HC_START.TRAIT_ODDS)) {
    const t = rng.weighted(want, (x) => A.traits[x]);
    if (!s.traits.includes(t) && !clashIn(s.traits, t)) s.traits.push(t);
  }
}

// The most food the team's own grabs come to (a prepper's bag on top): TEAM_MAX a head, a background's food.max in
// its place (a farmer 5, a hunter or a trucker 4).
export const teamFoodCap = (people) => people.reduce((a, s) => a + (((HC_START.ARCHETYPES[s.background] || {}).food || {}).max ?? HC_START.TEAM_MAX), 0);
// A custom background (custombg.js) is not rolled and not clamped: its food and water come on top, like a prepper's bag.
const isCustomPerson = (s) => isCustomBg(s.background);

// A team of one or two (HC_START.SMALL): each of them + SKILL per empty seat in each of SKILLS. Draws no dice for
// three or four. Returns the skills bumped (for the log), or null.
export function smallTeamSkills(state, people) {
  const seats = emptySeats(people.length), S = HC_START.SMALL;
  if (!seats) return null;
  for (const s of people) for (const k of S.SKILLS) {
    let up = 0;
    for (let i = 0; i < seats; i++) up += state.rng.int(S.SKILL[0], S.SKILL[1]);
    s.skills[k] = Math.min(20, (s.skills[k] || 0) + up);
  }
  return S.SKILLS;
}

// One survivor's flight: their bag (or none), weapon, things, and what they add to the team's food, water, ammo, meds.
// A: their background's tables (ARCHETYPES) over the common ones.
// The gun distribution's source of a background's grab (data-guns.js GUN_SOURCES hc:*): a veteran's, a farmer's, a
// hunter's or a cop's own kind of gun, anyone else's a household's.
const GRAB_SOURCE = { veteran: "hc:veteran", farmer: "hc:farmer", hunter: "hc:hunter", cop: "hc:police", prepper: "hc:prepper" };
const grabSource = (A) => { const k = A ? Object.keys(HC_START.ARCHETYPES).find((x) => HC_START.ARCHETYPES[x] === A) : null; return (k && GRAB_SOURCE[k]) || "hc:home"; };
export function rollGrab(state, s, A = null) {
  const rng = state.rng, C = HC_START;
  const bag = rng.chance(A && A.pack != null ? A.pack : C.PACK);
  const got = { bag: null, weapon: null, armor: null, items: [], food: 0, water: 0, ammo: 0, roundKeys: {}, meds: 0 };
  if (bag) {
    const pk = startItem(rng, pickW(rng, (A && A.packs) || C.PACKS), Math.round(rng.range(0.7, 1) * 100) / 100);
    s.gear.backpack = pk;
    got.bag = pk;
  }
  const wOdds = A && A.weaponOdds != null ? A.weaponOdds : bag ? C.WEAPON.pack : C.WEAPON.pockets;
  if (rng.chance(wOdds)) {
    let listed = pickW(rng, (A && A.weapons) || C.WEAPONS);
    if (!bag && !GEAR[listed].small && !(A && A.weapons) && rng.chance(0.5)) listed = "knife"; // running with only pockets: more often a knife than a rifle
    const w = swapGun(grabSource(A), listed, rng); // gundist.js: a gun of the kind they would own, in the band of the list's (a hash of the draw)
    s.gear.weapon = startItem(rng, w, Math.round(rng.range(0.6, 1) * 100) / 100);
    got.weapon = s.gear.weapon;
    randomStarterMods(rng, s.gear.weapon, "hc"); // gunmods.js: a cheap part or two on some guns
    { const bx = starterLoad(rng, s.gear.weapon, "hc"); if (bx) pocketBox(s, bx); } // ammo.js: now and then a typed load and a box of it
    const rr = C.ROUNDS[listed]; // (the list's gun: the same draws; the rounds are the gun's own calibre)
    if (rr) gunRounds(got, w, Math.round(rng.int(rr[0], rr[1]) * ((A && A.rounds) || 1))); // the gun's own calibre
    if (GEAR[w].cat === "bow") got.arrows = (got.arrows || 0) + 12; // a quiver with the bow (hunting.js: bows hunt with arrows)
  }
  // Worn from the start (a cop's vest, a veteran's).
  if (A && A.armor) for (const [k, odds] of Object.entries(A.armor)) if (GEAR[k] && !s.gear.armor && rng.chance(odds)) { s.gear.armor = startItem(rng, k, Math.round(rng.range(0.5, 0.9) * 100) / 100); got.armor = s.gear.armor; }
  if (A && A.meds) got.meds += rng.int(A.meds[0], A.meds[1]);
  const stuff = A && A.stuff ? { ...C.PACK_STUFF, ...A.stuff } : C.PACK_STUFF;
  const pocketStuff = A && A.stuff ? { ...C.POCKET_STUFF, ...Object.fromEntries(Object.entries(A.stuff).filter(([k]) => GEAR[k] && GEAR[k].small)) } : C.POCKET_STUFF;
  // Pockets first (small things), then the bag.
  const nPockets = Math.min(POCKETS, rng.int(C.POCKET_ITEMS[0], C.POCKET_ITEMS[1]));
  for (let i = 0; i < nPockets; i++) {
    const key = pickW(rng, pocketStuff);
    const item = startItem(rng, key, 1);
    const at = s.pockets.indexOf(null);
    if (at < 0) break;
    s.pockets[at] = item;
    got.items.push(item);
  }
  if (bag) {
    const n = rng.int(C.PACK_ITEMS[0], C.PACK_ITEMS[1]);
    for (let i = 0; i < n; i++) {
      const key = pickW(rng, stuff);
      const item = startItem(rng, key, 1);
      // A tool goes in the off hand if it is free (a flashlight, a bandage kit), else in the bag.
      if (GEAR[key].slot === "tool" && !s.gear.tool) s.gear.tool = item;
      else {
        const at = packOf(s).indexOf(null);
        if (at < 0) break;
        packOf(s)[at] = item;
      }
      got.items.push(item);
    }
    if (rng.chance(C.MEDS.pack)) got.meds += 1;
  }
  const F = (A && A.food) || C.FOOD; // what they grabbed to eat by background (ARCHETYPES food), else the common
  const f = bag ? F.pack : F.pockets, w = bag ? C.WATER.pack : C.WATER.pockets;
  got.food += rng.int(f[0], f[1]);
  got.water += rng.int(w[0], w[1]);
  return got;
}

// The prepper's flight: the packed duffle bag, its kit, the water filter in hand, a knife or a gun with rounds, the
// five days of food and water for three, and the trait when a slot allows (got.trait). Deterministic by the state's rng.
export function rollPrepper(state, s) {
  const rng = state.rng, P = HC_START.PREPPER;
  const got = { bag: null, weapon: null, items: [], food: P.FOOD, water: P.WATER, ammo: 0, roundKeys: {}, meds: P.MEDS, prepper: true, trait: false };
  s.gear.backpack = startItem(rng, P.BAG, Math.round(rng.range(0.85, 1) * 100) / 100);
  got.bag = s.gear.backpack;
  const gun = rng.chance(P.GUN);
  const w = gun ? swapGun("hc:prepper", pickW(rng, P.GUNS), rng) : "knife"; // gundist.js: which gun (a hash of the draw)
  s.gear.weapon = startItem(rng, w, Math.round(rng.range(0.8, 1) * 100) / 100);
  got.weapon = s.gear.weapon;
  randomStarterMods(rng, s.gear.weapon, "hc"); // gunmods.js: a cheap part or two on some guns
  { const bx = starterLoad(rng, s.gear.weapon, "hc"); if (bx) pocketBox(s, bx); } // ammo.js: now and then a typed load and a box of it
  if (gun) gunRounds(got, w, P.AMMO);
  const place = (key) => {
    const item = startItem(rng, key, 1);
    if (GEAR[key].slot === "tool" && !s.gear.tool) s.gear.tool = item; // the water filter, in hand
    else {
      const at = packOf(s).indexOf(null);
      if (at < 0) return false;
      packOf(s)[at] = item;
    }
    got.items.push(item);
    return true;
  };
  for (const key of P.KIT) place(key);
  const extra = { ...P.EXTRA };
  for (let n = rng.int(P.EXTRA_N[0], P.EXTRA_N[1]); n > 0 && Object.keys(extra).length; n--) {
    const key = pickW(rng, extra);
    delete extra[key];
    if (!place(key)) break;
  }
  if (s.traits.length < P.MAX_TRAITS && !s.traits.includes("prepper")) { s.traits.push("prepper"); got.trait = true; }
  return got;
}

// A custom background's flight (custombg.js): exactly what the player set, no dice. What they wear and hold, then the
// things: a tool to the off hand if it is free, a small thing to a pocket, the rest to the bag (what does not fit is
// left behind, got.left: the editor warns). Supplies on them as set.
export function rollCustom(state, s, A) {
  const got = { bag: null, weapon: null, armor: null, items: [], food: 0, water: 0, ammo: 0, roundKeys: {}, meds: 0, arrows: 0, custom: true, left: [] };
  for (const [slot, key] of Object.entries(A.gear || {})) {
    if (!GEAR[key]) continue;
    s.gear[slot] = startKit(newItem(key, 1)); // inventory.js: a starting carrier's plates are steel
    if (slot === "backpack") got.bag = s.gear[slot];
    else if (slot === "weapon") got.weapon = s.gear[slot];
    else if (slot === "armor") got.armor = s.gear[slot];
    else got.items.push(s.gear[slot]);
  }
  for (const key of A.items || []) {
    if (!GEAR[key]) continue;
    const item = startKit(newItem(key, 1));
    const pk = packOf(s);
    if (GEAR[key].slot === "tool" && !s.gear.tool) s.gear.tool = item;
    else if (GEAR[key].small && s.pockets.indexOf(null) >= 0) s.pockets[s.pockets.indexOf(null)] = item;
    else if (pk && pk.indexOf(null) >= 0) pk[pk.indexOf(null)] = item;
    else { got.left.push(key); continue; }
    got.items.push(item);
  }
  for (const k of ["food", "water", "meds", "arrows"]) got[k] = (A.supplies && A.supplies[k]) || 0;
  got.roundKeys = roundsOnly(A.supplies); // rounds by calibre and type, as set (custombg.js)
  got.ammo = Object.values(got.roundKeys).reduce((a, q) => a + q, 0);
  return got;
}

// ---------- a normal start (2026-10-07, user request) ----------
// The six at the hub have a background too: who they were before Calder fell, six years ago. Drawn as a hardcore crew
// is (no two alike, a pick from the new-run screen in its seat), with dice of their own (the seed's, NORMAL_BG.SALT) so
// the world's dice, the map and the groups stay where they were. A preset reshapes their skills and keeps the total
// (a normal start stays as strong as it was): its bumps go on, then as many points come off their other skills, more
// often from the higher ones; it pushes a fitting trait as in Hardcore. What they grabbed and the car are a hardcore
// start's: six years on the hub's kit is theirs. A custom background (custombg.js, picked: not in Ironman) gives exactly
// what it says, its kit too (normalStartKit).
// ON: false starts the six without backgrounds (the tools compare against it).
export const NORMAL_BG = { SALT: 0x6b67, ON: true };
// Points back off the other skills until the total is what it was (bumped: the skills the background raised, taken
// from last). Deterministic by the rng given.
// None comes off Melee or Cooking (a background's bump of them stays; the points come off the other skills, on the
// start's own dice).
export function keepSkillTotal(rng, s, total, bumped = []) {
  const sum = () => Object.values(s.skills).reduce((a, v) => a + v, 0);
  const keys = () => Object.keys(s.skills).filter((k) => k !== "melee" && k !== "cooking");
  let guard = 400;
  while (sum() > total && guard-- > 0) {
    let pool = keys().filter((k) => s.skills[k] > 0 && !bumped.includes(k));
    if (!pool.length) pool = keys().filter((k) => s.skills[k] > 0);
    if (!pool.length) break;
    s.skills[rng.weighted(pool, (k) => s.skills[k])]--;
  }
}
// Backgrounds for a normal start's people (world.js createWorld, before the new-run screen's edits go on: an edited
// colonist keeps the skills typed in). crew[i].background: a pick (crew[i].rolled: kept, still the dice's).
export function normalStartBackgrounds(state, crew = null) {
  if (!NORMAL_BG.ON) return;
  const worldRng = state.rng;
  state.rng = new Rng(((state.seed ^ NORMAL_BG.SALT) >>> 0) % 2147483646 + 1);
  try {
    const people = state.survivors;
    const picks = people.map((s, i) => { const k = crew && crew[i] && crew[i].background; return k && archetypeOf(state, k) ? k : null; });
    const kinds = pickArchetypes(state, people.length, picks);
    people.forEach((s, i) => {
      const A = archetypeOf(state, kinds[i]);
      if (!A) return;
      const total = Object.values(s.skills).reduce((a, v) => a + v, 0);
      applyArchetype(state, s, kinds[i]);
      if (!A.custom) keepSkillTotal(state.rng, s, total, Object.keys(A.skills || {}));
      if (picks[i]) { if (crew[i].rolled) s.bgKept = true; else s.bgPicked = true; }
    });
  } finally {
    state.rng = worldRng;
  }
}
// A custom background's kit at a normal start (after the new-run screen's edits): what it says they wear, hold and
// carry (whatever the hub had handed them goes to the armory), the supplies on them and what is in the car's back to
// the hub's stores and armory, and the car itself parked at the hub when it names a kind and is ever theirs (odds > 0).
export function normalStartKit(state, base) {
  for (const s of state.survivors) {
    const A = archetypeOf(state, s.background);
    if (!A || !A.custom) continue;
    for (const slot of Object.keys(A.gear || {})) if (s.gear[slot]) { if (!s.startPoints) base.armory.push(s.gear[slot]); s.gear[slot] = null; } // built on points: the dice's kit is not handed out on top
    const got = rollCustom(state, s, A);
    for (const k of ["water", "meds", "arrows"]) if (got[k]) base.stock[k] = (base.stock[k] || 0) + got[k];
    if (got.food) addFoodsTo(base.stock, typedFood(state, "house", got.food)); // foods.js: days of food as a house's food
    addRecord(base.stock, got.roundKeys); // rounds by calibre
    if (A.car.type && A.car.odds > 0) {
      const T = VEHICLE_TYPES[A.car.type];
      createVehicle(state, A.car.type, { kind: "base", baseId: base.id }, { fuel: Math.round(T.tank * 0.5 * 10) / 10, condition: 70 });
    }
    // The car's back to the hub too (Customize: on the vehicle's back's bill, custompoints.js bgBacks).
    for (const [k, q] of Object.entries(typeFind(state, { ...(A.car.trunk || {}) }, "travel"))) if (SUPPLY_KEYS.includes(k) && q > 0) base.stock[k] = (base.stock[k] || 0) + q; // foods.js: the back's food as items
    for (const key of A.car.items || []) if (GEAR[key]) { const it = startKit(newItem(key, 1)); base.armory.push(s.startPoints ? loadGun(it) : it); } // Customize: a gun in it loaded (priced so)
  }
}

// ---------- the car ----------
// Whose car it was (the three's carOdds), what it is (their CARS), its tank and condition (CAR), and what was in the
// back (TRUNK: supplies and things). Makes the vehicle on the team and loads the cargo. Returns { owner, car, trunk }.
// Customize (custompoints.js, startgear.js): whoever pays for the back on the new-run screen (s.startVehicle) owns the
// car (the dice's pick is still drawn, so the dice after it are where they were), and with anyone built on points the
// back is exactly what was picked (the dice's back is drawn and noted on the owner, s.diceTrunk, for "Start from the
// dice", but not loaded). The seats a small team loaded stay as they are.
export function rollCar(state, p, people, keptOwner = null) {
  const rng = state.rng, C = HC_START;
  // A custom background's odds may be 0 (never theirs); all 0: anyone's.
  const odds = (s) => { const a = archetypeOf(state, s.background) || {}; return a.custom ? a.car.odds : a.carOdds || 1; };
  const drawn = people.some((s) => odds(s) > 0) ? rng.weighted(people, odds) : rng.pick(people);
  const owner = people.find((s) => s.startVehicle) || keptOwner || drawn;
  const picked = people.some((s) => s.startPoints);
  const A = archetypeOf(state, owner.background) || {};
  const type = A.custom && A.car.type ? A.car.type : pickW(rng, A.custom ? { sedan: 2, truck: 1 } : A.cars || { sedan: 2, truck: 1 });
  const T = VEHICLE_TYPES[type];
  const fuel = Math.round(T.tank * rng.range(C.CAR.FUEL[0], C.CAR.FUEL[1]) * 10) / 10;
  const car = createVehicle(state, type, { kind: "party", partyId: p.id }, { fuel, condition: rng.int(C.CAR.CONDITION[0], C.CAR.CONDITION[1]) });
  p.vehicle = true;
  p.vehicleId = car.id;
  const trunk = { supplies: {}, gear: [] };
  if (A.custom) { // exactly what the player put in the back
    for (const [k, q] of Object.entries(A.car.trunk)) if ((SUPPLY_KEYS.includes(k) || k === "food" || k === "preserved") && q > 0) trunk.supplies[k] = q;
    for (const key of A.car.items) if (GEAR[key]) trunk.gear.push(startKit(newItem(key, 1)));
  }
  const TR = A.custom ? {} : A.trunk || {};
  for (const k of ["food", "preserved", ...SUPPLY_KEYS]) if (TR[k]) { const q = rng.int(TR[k][0], TR[k][1]); if (q > 0) trunk.supplies[k] = q; } // ammo: a count, made rounds below; food: days of it (typed below)
  if (TR.gear) {
    const table = { ...TR.gear };
    for (let n = rng.int(TR.n[0], TR.n[1]); n > 0 && Object.keys(table).length; n--) {
      const key = pickW(rng, table);
      delete table[key];
      if (!GEAR[key]) continue;
      const item = startItem(rng, key, Math.round(rng.range(0.6, 1) * 100) / 100);
      trunk.gear.push(item);
    }
  }
  calibrate(trunk.supplies, gunCals(people, trunk.gear)); // ammo.js: the back's rounds are for the guns they have (theirs, and any in the back); none: 9mm and 12 gauge
  owner.diceTrunk = { items: trunk.gear.map((it) => pickOf(it)).filter(Boolean), supplies: { ...trunk.supplies } }; // the dice's back (until Start); a gun with the parts it came with
  if (picked) { const mine = trunkFromPicks(owner.startVehicle); trunk.gear = mine.gear; trunk.supplies = mine.supplies; }
  typeFind(state, trunk.supplies, "travel"); // foods.js: the back's food as what people threw in a car (light, keeps; bread and cheese in the first days)
  for (const [k, q] of Object.entries(trunk.supplies)) p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) + q;
  p.cargo.gear.push(...trunk.gear);
  // A team of one or two loaded the empty seats too (HC_START.SMALL SEAT per seat short of three): trunk.seats.
  const seats = emptySeats(people.length);
  if (seats) {
    trunk.seats = {};
    for (const [k, [lo, hi]] of Object.entries(C.SMALL.SEAT)) {
      let q = 0;
      for (let i = 0; i < seats; i++) q += rng.int(lo, hi);
      if (q > 0 && k === "food") { trunk.seats[k] = q; addFoodsTo(p.cargo.supplies, typedFood(state, "house", q)); } // foods.js: days of food as a house's food
      else if (q > 0) { trunk.seats[k] = q; p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) + q; }
    }
  }
  return { owner, car, trunk };
}
export function carLine(owner, car, trunk, people = HC_START.CREW) {
  const rounds = roundsOnly(trunk.supplies);
  const back = [...Object.entries(trunk.supplies).filter(([k]) => !rounds[k]).map(([k, q]) => `${Math.round(q * 10) / 10} ${keyWord(k)}`), ...(Object.keys(rounds).length ? [roundsText(rounds)] : []), ...wordsOf(trunk.gear)];
  const fill = Math.round((car.fuel / VEHICLE_TYPES[car.type].tank) * 100);
  const seat = trunk.seats ? Object.entries(trunk.seats).map(([k, q]) => `${q} ${keyWord(k)}`) : [];
  return `${firstName(owner)} got ${people === 1 ? "into" : "everyone into"} their ${car.name.toLowerCase()} (tank ${fill}% full, ${Math.round(car.condition)}% condition)${back.length ? `; in the back: ${andList(back)}` : ""}${seat.length ? `; on the empty ${people === 1 ? "seats" : "seat"}, what else they could grab: ${andList(seat)}` : ""}.`;
}

// The things as words, repeats counted ("family photos (2)"); "a, b and c".
function wordsOf(items) {
  const counts = new Map();
  for (const it of items) counts.set(it.name.toLowerCase(), (counts.get(it.name.toLowerCase()) || 0) + 1);
  return [...counts].map(([w, n]) => (n > 1 ? `${w} (${n})` : w));
}
const andList = (words) => (words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`);
function listOf(items) {
  const words = wordsOf(items);
  return words.length ? [andList(words)] : [];
}
function grabLine(state, s, got) {
  const things = listOf(got.items);
  const A = archetypeOf(state, s.background);
  const who = A ? `${firstName(s)} (${A.name.toLowerCase()}${A.blurb ? `, ${A.blurb}` : ""})` : firstName(s);
  const rounds = (got.ammo || 0) + (got.rounds || 0); // got.rounds: a gun picked on the new-run screen (startgear.js)
  const weapon = got.weapon ? `${/^[aeiou]/i.test(got.weapon.name) ? "an" : "a"} ${got.weapon.name.toLowerCase()}${rounds ? ` (${rounds} rounds)` : ""}` : "";
  if (got.prepper && got.bag) return `${who} had a ${got.bag.name.toLowerCase()} packed by the door: ${got.food} days of food, ${got.water} water${got.meds ? `, ${got.meds} meds` : ""}${things.length ? `, ${things.join(", ")}` : ""}${weapon ? `, and ${weapon}` : ""}.`;
  const worn = got.armor ? ` (in ${/^[aeiou]/i.test(got.armor.name) ? "an" : "a"} ${got.armor.name.toLowerCase()})` : "";
  if (got.bag) return `${who}${worn} grabbed a ${got.bag.name.toLowerCase()}${things.length ? ` with ${things.join(", ")}` : ""}${weapon ? `, and ${weapon}` : ""}.`;
  return `${who}${worn} ran with only the clothes on their back${things.length ? ` and ${things.join(", ")} in their pockets` : " and empty pockets"}${weapon ? `, and ${weapon}` : ""}.`;
}

// What one of them grabbed, kept through the new-run screen's rebuilds (another colonist's dice or background, a
// background picked: the crew's dice may be new then), so one colonist's dice leave the others' grab as it was. The
// dice are where the crew's were when theirs was drawn (s.grabRoll: the whole position, gundist.js hashes it), so a fresh
// crew draws as ever. kept: crew[i].grabRoll, theirs from before (or the crew card's Gear and All: a new draw, pick,
// past the dice: not for Ironman); while the crew's dice are still there, it is the same draw. Otherwise the crew's
// draw is made and put back first, so the dice after them are where they were, then theirs is drawn on its own dice.
// Start takes it off (startgear.js clearStartGear). Returns what roll() returns.
function ownGrab(state, s, kept, pick, roll) {
  const crewRng = state.rng, here = crewRng.state;
  s.grabRoll = Number.isFinite(kept) ? kept : here;
  if (pick) { s.grabPick = true; s.startCustom = true; }
  if (s.grabRoll === here) return roll();
  const was = { gear: { ...s.gear }, pockets: [...s.pockets], traits: [...s.traits], traitTier: s.traitTier ? { ...s.traitTier } : null };
  roll();
  s.gear = was.gear;
  s.pockets = was.pockets;
  s.traits = was.traits;
  if (was.traitTier) s.traitTier = was.traitTier; else delete s.traitTier;
  state.rng = rngAt(s.grabRoll);
  try {
    return roll();
  } finally {
    state.rng = crewRng;
  }
}

// Dice that go on from a position of another's (Rng's constructor keeps 32 bits; the position grows past them).
const rngAt = (pos) => Object.assign(new Rng(0), { state: pos });

// ---------- setup (hardcore.js hardcoreCreate) ----------
// crewRoll: the three (who they were, what they grabbed, the car) drawn from a seed of their own instead of the world's
// (the new-run screen's Randomize all). The world's rng is put back after the car, so the rest of the run still
// follows the world's seed. n: how many flee (hardcore.js START_PEOPLE, the new-run screen's Starting people; 3 by default).
export function setupHardcoreStart(state, crew, crewRoll = null, n = HC_START.CREW, start = null) {
  state.hardcore = state.hardcore || {};
  const tile = spawnTile(state, start);
  const worldRng = state.rng;
  if (crewRoll != null) state.rng = new Rng(crewRoll);
  const people = [];
  for (let i = 0; i < n; i++) {
    const s = makeSurvivor(state, i === 0 ? 1.3 : 1);
    state.survivors.push(s);
    people.push(s);
  }
  people[0].leader = true;
  // Who they were (no two alike): the background's skill bumps and trait come before the new-run screen's edits, so an
  // edited colonist keeps the skills typed in.
  // A background picked on the new-run screen (crew[i].background, not in Ironman) takes its seat (pickArchetypes).
  // crew[i].rolled: who they were kept through a rebuild (another colonist's pick) but still the dice's, not a pick.
  const picks = people.map((s, i) => { const k = crew && crew[i] && crew[i].background; return k && archetypeOf(state, k) ? k : null; });
  const kinds = pickArchetypes(state, people.length, picks);
  people.forEach((s, i) => { applyArchetype(state, s, kinds[i]); if (picks[i]) { if (crew[i].rolled) s.bgKept = true; else s.bgPicked = true; } });
  const smallSkills = smallTeamSkills(state, people); // one or two: the ones who could look after themselves (HC_START.SMALL)
  if (crew) applyCrew(state, crew);
  if (!people.some((s) => s.leader)) people[0].leader = true; // the crew's leader was one of the six of a normal start (or past the head count)
  // What each one grabbed. A prepper's bag's five days come on top of the others' 1–3 days (TEAM_MIN..TEAM_MAX clamps
  // what the others carried, as before).
  const sup = { food: 0 }; // food: days of it until the team sets off (typed below, foods.js)
  for (const k of SUPPLY_KEYS) sup[k] = 0;
  const lines = [];
  let prepper = null, prepGot = null;
  const extra = []; // custom backgrounds' own food, water... (on top, unclamped)
  const pickedSup = []; // the rounds and arrows of picked guns and bows (startgear.js)
  for (let i = 0; i < people.length; i++) {
    const s = people[i];
    const A = archetypeOf(state, s.background);
    const roll = () => (s.background === "prepper" ? rollPrepper(state, s) : A && A.custom ? rollCustom(state, s, A) : rollGrab(state, s, A));
    const got = ownGrab(state, s, crew && crew[i] && crew[i].grabRoll, !!(crew && crew[i] && crew[i].grabPick), roll);
    const picked = grabStartGear(state, s, got); // startgear.js: what was picked on the new-run screen, in place of the grab
    if (picked) pickedSup.push(picked);
    if (got.prepper) { prepper = s; prepGot = got; continue; }
    if (got.custom) { extra.push(got); lines.push(grabLine(state, s, got)); continue; }
    sup.food += got.food;
    sup.water += got.water;
    addRecord(sup, got.roundKeys); // rounds by calibre: for the gun each of them got
    sup.arrows += got.arrows || 0;
    sup.meds += got.meds;
    lines.push(grabLine(state, s, got));
  }
  // Clamped per head, the whole team counted (as for three before the head count could change: 3–9); a farmer, a
  // hunter or a trucker lifts the food cap by their own max (ARCHETYPES food.max).
  // A custom background's own (rollCustom) is left out of the clamp and added after it.
  const rolled = people.filter((s) => !isCustomPerson(s));
  const heads = rolled.length;
  sup.food = Math.max(HC_START.TEAM_MIN * heads, Math.min(teamFoodCap(rolled), sup.food));
  sup.water = Math.max(HC_START.TEAM_MIN * heads, Math.min(HC_START.TEAM_MAX * heads, sup.water));
  for (const got of extra) { for (const k of ["food", "water", "meds", "arrows"]) sup[k] += got[k] || 0; addRecord(sup, got.roundKeys); }
  addPickedSupplies(sup, pickedSup);
  if (prepGot) {
    sup.food += prepGot.food;
    sup.water += prepGot.water;
    addRecord(sup, prepGot.roundKeys);
    sup.meds += prepGot.meds;
    lines.unshift(grabLine(state, prepper, prepGot));
  }
  const foodDays = sup.food;
  delete sup.food;
  addFoodsTo(sup, typedFood(state, "house", foodDays)); // foods.js: what they grabbed from their kitchens (bread and cheese in the first days, cans, rice)
  const p = {
    id: newId(), owner: "player", kind: "expedition", mission: "move", teamMission: "flee", dest: tile.id, homeBaseId: null,
    members: people.map((s) => s.id), stance: "normal", vehicle: false, vehicleId: null, supplies: sup, cargo: { supplies: {}, gear: [] },
    path: [tile.id], idx: 0, progress: 0, phase: "waiting", seen: new Map(), spotted: new Map(), sightNow: [], radioLive: true,
    departed: state.hour, plannedHours: 0, eventsSeen: 0, orders: [], orderStart: state.hour,
    planPath: [tile.id], planStart: state.hour, planVehicle: false, planFuel: 0, etaOut: 0, etaBack: null,
    exile: true, hcStart: true,
  };
  for (const s of people) { s.location = { kind: "party", partyId: p.id }; s.role = "scavenge"; s.station = null; }
  state.parties.push(p);
  // The car one of them fled in, and what was in the back.
  // The car kept through the new-run screen's rebuilds as the grabs are (crew[i].carRoll: the dice; crew[i].carOwner: whose).
  const keptCar = crew ? crew.slice(0, people.length).find((c) => c && Number.isFinite(c.carRoll)) : null;
  const keptOwner = crew ? people.find((s, i) => crew[i] && crew[i].carOwner) : null;
  const crewRng = state.rng, carRoll = keptCar ? keptCar.carRoll : crewRng.state;
  if (carRoll !== crewRng.state) state.rng = rngAt(carRoll);
  const { owner, car, trunk } = rollCar(state, p, people, keptOwner);
  state.rng = crewRng;
  for (const s of people) s.carRoll = carRoll;
  settleParty(state, p); // ammo.js: the rounds they grabbed, by the calibres of their guns
  state.rng = worldRng;
  lines.push(carLine(owner, car, trunk, people.length));
  log(state, `${people.length === 1 ? "You set off alone" : `The ${countWord(people.length)} of you set off`} in ${firstName(owner)}'s ${car.name.toLowerCase()}: tank ${Math.round((car.fuel / VEHICLE_TYPES[car.type].tank) * 100)}% full${trunk.gear.length || Object.keys(trunk.supplies).length ? ", and what was in the back is the team's cargo" : ""}.`, "info");
  p.sightNow = state.grid.within(tile.id, sightRadius(state, p));
  state.hardcore.start = { people: people.length, tile: tile.id, lastTile: tile.id, foundedDay: null, grabbed: lines, prepper: prepper ? prepper.id : null, car: car.id, carOwner: owner.id, backgrounds: Object.fromEntries(people.map((s) => [s.id, s.background])) };
  // Day 1's log says a small team's edge (HC_START.SMALL): the skills, and the seats loaded (the car line has what).
  if (smallSkills) log(state, `${people.length === 1 ? `${firstName(people[0])} got out alone` : `${firstName(people[0])} and ${firstName(people[1])} got out on their own`}: the kind who can look after ${people.length === 1 ? "themselves" : "each other"} (${andList(smallSkills.map((k) => SKILL_NAMES[k]))} up), and the car's empty ${people.length === 1 ? "seats were" : "seat was"} loaded too.`, "good");
  // Day 1's log names the prepper (the trait when a slot allowed it, else only this line says it).
  if (prepper) log(state, `${firstName(prepper)} was a prepper${prepGot.trait ? "" : " (no room for the trait: the kit says it)"}: a ${prepGot.bag ? prepGot.bag.name.toLowerCase() : "bag"} packed for five days${prepGot.weapon ? `, ${/^[aeiou]/i.test(prepGot.weapon.name) ? "an" : "a"} ${prepGot.weapon.name.toLowerCase()}${prepGot.ammo + (prepGot.rounds || 0) ? ` (${prepGot.ammo + (prepGot.rounds || 0)} rounds)` : ""}` : ""}${prepGot.items.some((it) => it.key === "waterfilter") ? ", a water filter" : ""}${prepGot.items.some((it) => it.key === "handradio") ? ", a hand-crank radio" : ""}${prepGot.items.some((it) => it.key === "puritabs") ? " and purification tablets" : ""}.`, "good");
  // The run opens on a plain blurb (introCard): what they grabbed, and what the first hub takes. No orders card: the
  // team stands waiting for orders (phase "waiting", the alerts' "Waiting for orders" row) and they are given from its
  // panel as usual; the game starts paused (main.js begin) and an order never unpauses it (ui/expedition.js).
  weighTeam(state, p);
  const intro = `Calder is falling. ${lines.join(" ")} ${people.length === 1 ? "On you" : "Between you"}: ${Math.floor(foodDays)} days of food, ${Math.floor(sup.water)} water${Object.keys(roundsOnly(sup)).length ? `, ${roundsText(roundsOnly(sup))}` : ""}${sup.meds ? `, ${Math.floor(sup.meds)} meds` : ""}, and what is in the car. Find food and water first, then pick a good spot and give the order ${ESTABLISH_LABEL}: you set up camp there (an hour, nothing carried), bring in ${needText(STAGING.HARDCORE.needs)} and its builders build it up into a shelter (${STAGING.HARDCORE.work} work-hours), later into your hub.`;
  addCard(state, introCard(INTRO_TITLE, intro, "The team waits for orders: open its panel (click it on the map, or the Teams tab) and give the first one. The clock is stopped until you press Space."));
  return p;
}

// The run's opening popup: the blurb and one button, nothing to decide (cardrules.js cardKind: intro cards always
// show, whatever the pause rules; the autopilot reads it and goes on: autopilot.js resolveCard).
export const INTRO_TITLE = "The day Calder fell";
export function introCard(title, text, hint = "") {
  return { title, text, intro: true, choices: [{ label: "Begin", default: true, ...(hint ? { hint } : {}), resolve: () => "" }] };
}

// Once a day (hardcore.js hardcoreDaily): where the team is, for playerTile once nobody is left on the road.
export function hardcoreStartDaily(state) {
  const hc = state.hardcore && state.hardcore.start;
  if (!hc || hc.foundedDay != null) return;
  const p = roadTeam(state);
  if (p) hc.lastTile = partyTile(p);
  hc.daysOnRoad = day(state) - 1;
}

// Tiles near the team worth founding on (the autopilot and the tile panel hint): open or a farm, not owned, not a hive,
// low infection, water beside or near, sites around. Best first. HUB_WATER: the score for the nearest river or lake
// (beside it, 2 or 3 tiles away, none within 3).
export const HUB_WATER = { beside: 6, two: 1.5, three: 0.5, none: -2 };
export function hubSites(state, from, radius = 6) {
  const g = state.grid;
  const out = [];
  for (const id of g.within(from, radius)) {
    const t = state.tiles[id];
    if (t.terrain === "water" || t.terrain === "mountain" || t.terrain === "city" || t.hive) continue;
    if (t.owner != null && t.owner !== "player") continue;
    if (state.factions.some((f) => f.alive && f.bases.includes(id)) || state.bases.some((b) => b.tile === id)) continue;
    // Water decides most (staging.js: no spring, so a camp or shelter drinks only what is beside it or carried in).
    const ws = waterSource(state, id);
    const water = ws && ws.dist <= 1 ? 3 : ws ? 1 : 0;
    const wScore = !ws ? HUB_WATER.none : ws.dist <= 1 ? HUB_WATER.beside : ws.dist === 2 ? HUB_WATER.two : HUB_WATER.three;
    const sites = g.within(id, 4).filter((n) => state.tiles[n].loc && state.tiles[n].loc.type !== "city").length;
    const kind = t.loc ? ({ farm: 2.5, ranch: 2, town: 1.5, church: 1.5, school: 1.2, motel: 1, barn: 1, feedstore: 1, prison: 1.5, cabin: 1, lodge: 1, ranger: 1 }[t.loc.type] ?? 0.5) : 0;
    const danger = (t.infection || 0) * 8 + (g.within(id, 3).some((n) => state.tiles[n].hive) ? 6 : 0);
    const sc = wScore + Math.min(4, sites * 0.6) + kind - danger - g.distance(from, id) * 0.35;
    out.push({ id, sc: r1(sc), water, waterDist: ws ? ws.dist : null, waterKind: ws ? ws.kind : null, sites });
  }
  return out.sort((a, b) => b.sc - a.sc || a.id - b.id);
}
