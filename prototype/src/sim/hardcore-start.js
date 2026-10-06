// Hardcore mode, your start (hardcore.js): the day Calder falls, three survivors on the road with whatever they grabbed
// as they fled, very low supplies and no hub.
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
// - The first hub: Build outpost becomes Establish base, a staging camp the team brings materials to and then builds
//   up over a few days (staging.js STAGING.HARDCORE). It becomes the hub, empty: no buildings, no truck. Losing that
//   hub later is the normal game's exile (conquest.js): a new staging camp (a little cheaper), later outposts the
//   usual 15 scrap.
// Everything here runs only in a hardcore world (hardcore.js isHardcore).
import { GEAR, SUPPLY_KEYS, TRAITS } from "./data.js";
import { VEHICLE_TYPES, createVehicle } from "./vehicles.js";
import { newId, makeSurvivor, applyCrew, assignStartingRoles, log, day, hub, addCard } from "./world.js";
import { newItem, packOf, POCKETS } from "./inventory.js";
import { sightRadius, partyMembers, partyTile, awaitOrders, weighTeam } from "./parties.js";
import { isHardcore } from "./hardcore.js";
import { hcOutbreakCity } from "./hardcore-outbreak.js";
import { STAGING, ESTABLISH_LABEL, needText, shelterText, waterSource } from "./staging.js";

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
  WEAPONS: { knife: 6, bat: 3, prybar: 1.5, pistol: 1.2, machete: 0.8, revolver: 0.5, huntrifle: 0.3 },
  ROUNDS: { pistol: [3, 12], revolver: [2, 6], huntrifle: [2, 5] },
  // Small things in pockets (weights; all GEAR keys with small: true) and more in a bag (any non-bulky item).
  POCKET_STUFF: { phone: 4, lighters: 3, flashlight: 2, photos: 3, chocolate: 2, candy: 2, smokes: 1.5, batteries: 1.5, bandagekit: 1, goldring: 0.8, watch: 0.6, tobacco: 0.5, tea: 0.4, cards: 0.6, harmonica: 0.3, monocular: 0.2, coins: 0.3 },
  PACK_STUFF: { flashlight: 3, bandagekit: 3, chocolate: 2, candy: 1.5, instcoffee: 1, novel: 1.2, toiletpaper: 1.2, soap: 1, candles: 1, batteries: 1.5, lighters: 1.5, photos: 1, whiskey: 0.6, vodka: 0.5, laptop: 0.4, magazines: 0.6, cards: 0.6, binoculars: 0.3, survivalbook: 0.3, medbook: 0.2, gardenbook: 0.2, fishrod: 0.3, snarewire: 0.3, stove: 0.15, waterfilter: 0.15 },
  // Food and water each one brings (a bag holds more), clamped for the team to 1–3 days for three (TEAM_MIN..TEAM_MAX).
  FOOD: { pack: [1, 3], pockets: [0, 1] },
  WATER: { pack: [1, 3], pockets: [0, 1] },
  TEAM_MIN: 3, TEAM_MAX: 9,
  MEDS: { pack: 0.35 }, // a bottle of pills in the bag
  // The prepper (2026-10-06): one of the three (which one: the dice, by seed) kept a go-bag by the door: a duffle bag
  // (data.js, bigger than a hiking pack) with FOOD and WATER (five days for three, pooled with the team's like
  // everyone's), MEDS, a charcoal water filter in the off hand (it cleans what the team fetches: worm.js), KIT always,
  // EXTRA_N more from EXTRA, a knife or (GUN chance) a gun from GUNS with AMMO rounds, and the Prepper trait (data.js, a
  // background trait never rolled at birth) when they have fewer than MAX_TRAITS traits; else only the log line says it.
  PREPPER: {
    BAG: "duffle", FOOD: 15, WATER: 15, MEDS: 2, AMMO: 20, GUN: 0.5,
    GUNS: { pistol: 3, revolver: 1.5, huntrifle: 1 },
    KIT: ["waterfilter", "flashlight", "bandagekit", "lighters", "batteries"],
    EXTRA: { survivalbook: 1, stove: 1, snarewire: 1, instcoffee: 1, candles: 0.6, medbook: 0.4, fishrod: 0.6, binoculars: 0.5, soap: 0.6, toiletpaper: 0.5 },
    EXTRA_N: [2, 3],
    MAX_TRAITS: 2,
  },
  // Who they were. w: the draw's weight (no two of the three alike). skills: + a roll of [lo, hi] each. traits: fitting
  // ones (weights), one pushed at TRAIT_ODDS when a slot allows (brave never beside coward). pack / packs / weapons /
  // stuff: over the common PACK / PACKS / WEAPONS / PACK_STUFF (stuff is merged in on top, so the common things still
  // turn up). armor: worn from the start. meds: carried on top of a bag's bottle. rounds: × the common ROUNDS.
  // cars: the kind of car when the car is theirs (weights); carOdds: how likely the car is theirs against the others'.
  // trunk: what was in the back: supplies [lo, hi] each, and N [lo, hi] things from gear (weights).
  TRAIT_ODDS: 0.6,
  ARCHETYPES: {
    prepper:    { name: "Prepper",            w: 1.2, skills: { scavenging: [2, 4], scouting: [1, 3], shooting: [1, 3] }, traits: {}, carOdds: 1.6,
                  cars: { truck: 4, hummer: 2, suv: 2 }, trunk: { food: [6, 12], water: [6, 12], fuel: [4, 10], ammo: [10, 30], n: [2, 4], gear: { stove: 1, snarewire: 1, fishrod: 1, camonet: 0.8, tripwire: 0.6, flare: 1, survivalbook: 0.6, beartrap: 0.5, waterfilter: 0.5 } },
                  blurb: "saw it coming" },
    veteran:    { name: "Veteran",            w: 1, skills: { shooting: [3, 6], leadership: [1, 3], scouting: [1, 3] }, traits: { brave: 3, tough: 2 }, carOdds: 1.2,
                  pack: 0.8, packs: { assaultpack: 3, rucksack: 2, backpack: 1 }, weapons: { pistol: 3, huntrifle: 2, machete: 1, knife: 1 }, weaponOdds: 0.8, rounds: 2, armor: { vest: 0.5 },
                  stuff: { binoculars: 2, bandagekit: 2, flare: 1.5, milradio: 0.3, smokegren: 0.5 },
                  cars: { truck: 3, hummer: 2, suv: 1 }, trunk: { food: [2, 5], water: [2, 5], ammo: [10, 25], n: [1, 3], gear: { milradio: 0.5, binoculars: 1, flare: 1, smokegren: 0.5, bandagekit: 1, assaultpack: 0.5, vest: 0.6, nvg: 0.2 } },
                  blurb: "two tours and a bad knee" },
    student:    { name: "College student",    w: 1, skills: { stealth: [1, 3], scavenging: [1, 3], speech: [1, 2] }, traits: { lucky: 1, nightowl: 2 }, carOdds: 0.7,
                  pack: 0.9, packs: { backpack: 6, slingbag: 2 }, weapons: { bat: 3, knife: 2 }, weaponOdds: 0.5,
                  stuff: { laptop: 2, novel: 1.5, candy: 2, chocolate: 1, phone: 2, instcoffee: 1, cards: 1, magazines: 1 },
                  cars: { sedan: 4, suv: 1.5 }, trunk: { food: [2, 4], water: [1, 3], n: [1, 2], gear: { laptop: 1, novel: 1, magazines: 1, console: 0.5, guitar: 0.4, backpack: 0.6, bicycle: 0.3 } },
                  blurb: "halfway through a degree" },
    office:     { name: "Office worker",      w: 1, skills: { speech: [2, 4], leadership: [1, 3] }, traits: { badback: 1, keeneye: 1 }, carOdds: 0.9,
                  pack: 0.5, packs: { slingbag: 4, backpack: 2 }, weapons: { knife: 3, bat: 1 }, weaponOdds: 0.5,
                  stuff: { laptop: 2, instcoffee: 2, phone: 2, watch: 0.8, cards: 0.6, coins: 0.5 },
                  cars: { sedan: 4, suv: 2 }, trunk: { food: [1, 2], water: [1, 2], n: [1, 2], gear: { laptop: 1, instcoffee: 1, coffee: 0.5, cards: 0.6, phone: 0.8, watch: 0.3 } },
                  blurb: "a lunch bag and a laptop" },
    bluecollar: { name: "Blue-collar worker", w: 1.2, skills: { mechanics: [2, 4], scavenging: [1, 3] }, traits: { tough: 2, loud: 1 }, carOdds: 1.4,
                  pack: 0.5, packs: { backpack: 4, slingbag: 1 }, weapons: { prybar: 3, fireaxe: 1, bat: 2, knife: 1 },
                  stuff: { lighters: 2, smokes: 1.5, flashlight: 2, batteries: 1.5 },
                  cars: { truck: 5, van: 3 }, trunk: { food: [1, 3], water: [2, 4], scrap: [6, 14], parts: [0, 2], n: [1, 3], gear: { sledge: 1, prybar: 1, fireaxe: 0.6, crowbar: 1, sandbags: 0.5, barbedwire: 0.3, tirevest: 0.4 } },
                  blurb: "tools and lumber in the back" },
    nurse:      { name: "Nurse",              w: 1, skills: { medicine: [4, 7], speech: [1, 2] }, traits: { medic: 3 }, carOdds: 0.9,
                  pack: 0.7, packs: { backpack: 3, slingbag: 3 }, weapons: { knife: 4 }, weaponOdds: 0.5, meds: [1, 3],
                  stuff: { bandagekit: 3, surgkit: 0.8, soap: 1, razors: 0.5 },
                  cars: { sedan: 3, suv: 2 }, trunk: { meds: [2, 5], food: [1, 2], water: [1, 2], n: [1, 2], gear: { bandagekit: 3, surgkit: 1, medbook: 0.5, dewormer: 0.5 } },
                  blurb: "came off a double shift" },
    farmer:     { name: "Farmer",             w: 1, skills: { farming: [4, 7], mechanics: [1, 3] }, traits: { tough: 2 }, carOdds: 1.2,
                  pack: 0.5, packs: { backpack: 3, hikingpack: 1 }, weapons: { huntrifle: 2, machete: 2, knife: 1, leverrifle: 0.5 }, weaponOdds: 0.6, rounds: 1.5,
                  stuff: { gardenbook: 1.5, snarewire: 1, honey: 0.8, tobacco: 0.6 },
                  cars: { truck: 5, suv: 1 }, trunk: { food: [6, 12], preserved: [2, 6], jars: [2, 6], water: [2, 4], n: [1, 2], gear: { gardenbook: 1, snarewire: 1, fishrod: 0.8, barbedwire: 0.5, huntrifle: 0.3, beartrap: 0.4 } },
                  blurb: "a truck full of the harvest" },
    hunter:     { name: "Hunter",             w: 0.9, skills: { shooting: [3, 5], scouting: [2, 4], stealth: [1, 3] }, traits: { keeneye: 3 }, carOdds: 1.1,
                  pack: 0.7, packs: { hikingpack: 3, backpack: 2 }, weapons: { huntrifle: 3, compbow: 1.5, xbow: 1, knife: 1 }, weaponOdds: 0.8, rounds: 1.5,
                  stuff: { binoculars: 2, camonet: 1, gamecall: 1, snarewire: 1, fishrod: 0.8 },
                  cars: { truck: 4, suv: 2 }, trunk: { food: [2, 5], ammo: [8, 20], n: [1, 3], gear: { camonet: 1, binoculars: 1, gamecall: 1, snarewire: 1, beartrap: 0.8, ghillie: 0.4, stove: 0.8, monocular: 0.5 } },
                  blurb: "knows every deer trail" },
    mechanic:   { name: "Mechanic",           w: 0.9, skills: { mechanics: [4, 7], scavenging: [1, 3] }, traits: { tough: 1, loud: 1 }, carOdds: 1.3,
                  pack: 0.5, packs: { backpack: 3, slingbag: 1 }, weapons: { prybar: 3, bat: 1, knife: 1 },
                  stuff: { crowbar: 1.5, flashlight: 2, batteries: 1.5, lighters: 1 },
                  cars: { truck: 3, van: 2, sedan: 1 }, trunk: { parts: [2, 5], scrap: [4, 10], fuel: [3, 8], n: [1, 2], gear: { crowbar: 1, flashlight: 1, enginebook: 0.5, batteries: 1 } },
                  blurb: "grease under the nails" },
    cop:        { name: "Police officer",     w: 0.8, skills: { shooting: [2, 5], speech: [1, 3], leadership: [1, 3] }, traits: { brave: 2 }, carOdds: 1,
                  pack: 0.4, packs: { slingbag: 2, backpack: 2 }, weapons: { pistol: 5, baton: 1 }, weaponOdds: 0.9, rounds: 2, armor: { vest: 0.7 },
                  stuff: { cuffs: 1.5, flashlight: 2, flare: 1 },
                  cars: { suv: 3, sedan: 2 }, trunk: { ammo: [10, 24], n: [1, 3], gear: { cuffs: 1, baton: 0.5, riothelmet: 0.5, riotarms: 0.5, flare: 1, flashlight: 1, shotgun: 0.4 } },
                  blurb: "still in half a uniform" },
    trucker:    { name: "Trucker",            w: 0.8, skills: { mechanics: [1, 3], scouting: [2, 4] }, traits: { badback: 1, nightowl: 1 }, carOdds: 1.5,
                  pack: 0.4, packs: { slingbag: 3, backpack: 1 }, weapons: { bat: 2, revolver: 1.5, knife: 1 },
                  stuff: { pocketradio: 1.5, smokes: 1.5, instcoffee: 1.5, cards: 1, harmonica: 0.5 },
                  cars: { van: 3, truck: 3 }, trunk: { food: [8, 16], water: [4, 8], fuel: [4, 8], n: [1, 2], gear: { pocketradio: 1, cards: 0.8, smokes: 0.8, instcoffee: 1, tirevest: 0.3 } },
                  blurb: "a cab full of coffee cups" },
    teacher:    { name: "Teacher",            w: 0.8, skills: { speech: [3, 5], leadership: [2, 4], medicine: [0, 2] }, traits: { keeneye: 1 }, carOdds: 0.8,
                  pack: 0.7, packs: { slingbag: 3, backpack: 2 }, weapons: { knife: 3 }, weaponOdds: 0.4,
                  stuff: { novel: 2, puzzlebook: 1, cards: 1, instcoffee: 1 },
                  cars: { sedan: 3, suv: 1.5 }, trunk: { food: [1, 3], water: [1, 2], n: [1, 3], gear: { novel: 2, puzzlebook: 1, cards: 1, survivalbook: 0.3, medbook: 0.3, talkbook: 0.5, leadbook: 0.3 } },
                  blurb: "a car boot full of books" },
  },
  // The car: whose (ARCHETYPES carOdds), the tank's fill [lo, hi] of its tank, the condition [lo, hi].
  CAR: { FUEL: [0.5, 1], CONDITION: [55, 90] },
  // The first hub: a staging camp (staging.js STAGING.HARDCORE: what it takes and the days of work).
};
// For the UI (the People tab's background chip) and the tools: { key: { name, blurb } }.
export const BACKGROUNDS = Object.fromEntries(Object.entries(HC_START.ARCHETYPES).map(([k, a]) => [k, { name: a.name, blurb: a.blurb }]));

const r1 = (v) => Math.round(v * 10) / 10;
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
// The first hub is a staging camp built up over days (staging.js: Establish base, the materials, the work). When it
// is done, staging.js has made the base (type "hub": there is none) and moved the people in; this marks the day.
// when: how long the camp took ("4 days after the camp went up").
export function hubFounded(state, base, when = "") {
  const hc = state.hardcore.start;
  hc.foundedDay = day(state);
  hc.foundedHour = state.hour;
  hc.hubTile = base.tile;
  base.name = base.name.replace(/ Outpost( \d+)?$/, " Holdout");
  if (state.bases.some((b) => b !== base && b.name === base.name)) base.name = `${base.name} ${base.id}`;
  base.hcFirst = true;
  assignStartingRoles(state); // jobs by skill, as a normal start does (world.js)
  const text = base.tier === 0
    ? `Day ${day(state)}: the staging camp is done. ${base.name} is founded, your first shelter${when ? `, ${when}` : ""}. ${shelterText()} Build it up before the cold.`
    : `Day ${day(state)}: the staging camp is done. ${base.name} is founded, your first hub${when ? `, ${when}` : ""}. It is bare: no buildings yet, a barricade of scrap and the camp's stores. Build farm plots, a well and beds before the cold.`;
  log(state, text, "good");
  addCard(state, { title: "A place of your own", text, choices: [{ label: "OK", resolve: () => "" }] });
}

// ---------- the spawn ----------
function spawnTile(state) {
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
  for (const strict of [true, false]) {
    const cands = state.tiles.filter(okFor(strict));
    if (cands.length) return rng.pick(cands);
  }
  const land = state.tiles.filter((t) => t.terrain !== "water" && t.terrain !== "mountain" && !t.hive);
  return rng.pick(land);
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
// What a background makes of someone: the skill bumps, a fitting trait when a slot allows, the key on them.
export function applyArchetype(state, s, key) {
  const rng = state.rng, A = HC_START.ARCHETYPES[key];
  if (!A) return;
  s.background = key;
  for (const [k, [lo, hi]] of Object.entries(A.skills || {})) s.skills[k] = Math.min(20, (s.skills[k] || 0) + rng.int(lo, hi));
  const want = Object.keys(A.traits || {}).filter((t) => TRAITS[t] && !s.traits.includes(t) && !(t === "brave" && s.traits.includes("coward")) && !(t === "coward" && s.traits.includes("brave")));
  if (want.length && s.traits.length < 2 && rng.chance(HC_START.TRAIT_ODDS)) s.traits.push(rng.weighted(want, (t) => A.traits[t]));
}

// One survivor's flight: their bag (or none), weapon, things, and what they add to the team's food, water, ammo, meds.
// A: their background's tables (ARCHETYPES) over the common ones.
export function rollGrab(state, s, A = null) {
  const rng = state.rng, C = HC_START;
  const bag = rng.chance(A && A.pack != null ? A.pack : C.PACK);
  const got = { bag: null, weapon: null, armor: null, items: [], food: 0, water: 0, ammo: 0, meds: 0 };
  if (bag) {
    const pk = newItem(pickW(rng, (A && A.packs) || C.PACKS), Math.round(rng.range(0.7, 1) * 100) / 100);
    s.gear.backpack = pk;
    got.bag = pk;
  }
  const wOdds = A && A.weaponOdds != null ? A.weaponOdds : bag ? C.WEAPON.pack : C.WEAPON.pockets;
  if (rng.chance(wOdds)) {
    let w = pickW(rng, (A && A.weapons) || C.WEAPONS);
    if (!bag && !GEAR[w].small && !(A && A.weapons) && rng.chance(0.5)) w = "knife"; // running with only pockets: more often a knife than a rifle
    s.gear.weapon = newItem(w, Math.round(rng.range(0.6, 1) * 100) / 100);
    got.weapon = s.gear.weapon;
    const rr = C.ROUNDS[w];
    if (rr) got.ammo += Math.round(rng.int(rr[0], rr[1]) * ((A && A.rounds) || 1));
  }
  // Worn from the start (a cop's vest, a veteran's).
  if (A && A.armor) for (const [k, odds] of Object.entries(A.armor)) if (GEAR[k] && !s.gear.armor && rng.chance(odds)) { s.gear.armor = newItem(k, Math.round(rng.range(0.5, 0.9) * 100) / 100); got.armor = s.gear.armor; }
  if (A && A.meds) got.meds += rng.int(A.meds[0], A.meds[1]);
  const stuff = A && A.stuff ? { ...C.PACK_STUFF, ...A.stuff } : C.PACK_STUFF;
  const pocketStuff = A && A.stuff ? { ...C.POCKET_STUFF, ...Object.fromEntries(Object.entries(A.stuff).filter(([k]) => GEAR[k] && GEAR[k].small)) } : C.POCKET_STUFF;
  // Pockets first (small things), then the bag.
  const nPockets = Math.min(POCKETS, rng.int(C.POCKET_ITEMS[0], C.POCKET_ITEMS[1]));
  for (let i = 0; i < nPockets; i++) {
    const key = pickW(rng, pocketStuff);
    const item = newItem(key, 1);
    const at = s.pockets.indexOf(null);
    if (at < 0) break;
    s.pockets[at] = item;
    got.items.push(item);
  }
  if (bag) {
    const n = rng.int(C.PACK_ITEMS[0], C.PACK_ITEMS[1]);
    for (let i = 0; i < n; i++) {
      const key = pickW(rng, stuff);
      const item = newItem(key, 1);
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
  const f = bag ? C.FOOD.pack : C.FOOD.pockets, w = bag ? C.WATER.pack : C.WATER.pockets;
  got.food += rng.int(f[0], f[1]);
  got.water += rng.int(w[0], w[1]);
  return got;
}

// The prepper's flight: the packed duffle bag, its kit, the water filter in hand, a knife or a gun with rounds, the
// five days of food and water for three, and the trait when a slot allows (got.trait). Deterministic by the state's rng.
export function rollPrepper(state, s) {
  const rng = state.rng, P = HC_START.PREPPER;
  const got = { bag: null, weapon: null, items: [], food: P.FOOD, water: P.WATER, ammo: 0, meds: P.MEDS, prepper: true, trait: false };
  s.gear.backpack = newItem(P.BAG, Math.round(rng.range(0.85, 1) * 100) / 100);
  got.bag = s.gear.backpack;
  const gun = rng.chance(P.GUN);
  const w = gun ? pickW(rng, P.GUNS) : "knife";
  s.gear.weapon = newItem(w, Math.round(rng.range(0.8, 1) * 100) / 100);
  got.weapon = s.gear.weapon;
  if (gun) got.ammo += P.AMMO;
  const place = (key) => {
    const item = newItem(key, 1);
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

// ---------- the car ----------
// Whose car it was (the three's carOdds), what it is (their CARS), its tank and condition (CAR), and what was in the
// back (TRUNK: supplies and things). Makes the vehicle on the team and loads the cargo. Returns { owner, car, trunk }.
export function rollCar(state, p, people) {
  const rng = state.rng, C = HC_START;
  const owner = rng.weighted(people, (s) => (C.ARCHETYPES[s.background] || {}).carOdds || 1);
  const A = C.ARCHETYPES[owner.background] || {};
  const type = pickW(rng, A.cars || { sedan: 2, truck: 1 });
  const T = VEHICLE_TYPES[type];
  const fuel = Math.round(T.tank * rng.range(C.CAR.FUEL[0], C.CAR.FUEL[1]) * 10) / 10;
  const car = createVehicle(state, type, { kind: "party", partyId: p.id }, { fuel, condition: rng.int(C.CAR.CONDITION[0], C.CAR.CONDITION[1]) });
  p.vehicle = true;
  p.vehicleId = car.id;
  const trunk = { supplies: {}, gear: [] };
  const TR = A.trunk || {};
  for (const k of SUPPLY_KEYS) if (TR[k]) { const q = rng.int(TR[k][0], TR[k][1]); if (q > 0) { trunk.supplies[k] = q; p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) + q; } }
  if (TR.gear) {
    const table = { ...TR.gear };
    for (let n = rng.int(TR.n[0], TR.n[1]); n > 0 && Object.keys(table).length; n--) {
      const key = pickW(rng, table);
      delete table[key];
      if (!GEAR[key]) continue;
      const item = newItem(key, Math.round(rng.range(0.6, 1) * 100) / 100);
      p.cargo.gear.push(item);
      trunk.gear.push(item);
    }
  }
  return { owner, car, trunk };
}
export function carLine(owner, car, trunk) {
  const back = [...Object.entries(trunk.supplies).map(([k, q]) => `${q} ${k}`), ...wordsOf(trunk.gear)];
  const fill = Math.round((car.fuel / VEHICLE_TYPES[car.type].tank) * 100);
  return `${firstName(owner)} got everyone into their ${car.name.toLowerCase()} (tank ${fill}% full, ${Math.round(car.condition)}% condition)${back.length ? `; in the back: ${andList(back)}` : ""}.`;
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
function grabLine(s, got) {
  const things = listOf(got.items);
  const A = HC_START.ARCHETYPES[s.background];
  const who = A ? `${firstName(s)} (${A.name.toLowerCase()}${A.blurb ? `, ${A.blurb}` : ""})` : firstName(s);
  const weapon = got.weapon ? `${/^[aeiou]/i.test(got.weapon.name) ? "an" : "a"} ${got.weapon.name.toLowerCase()}${got.ammo ? ` (${got.ammo} rounds)` : ""}` : "";
  if (got.prepper) return `${who} had a ${got.bag.name.toLowerCase()} packed by the door: ${got.food} food, ${got.water} water${got.meds ? `, ${got.meds} meds` : ""}${things.length ? `, ${things.join(", ")}` : ""}${weapon ? `, and ${weapon}` : ""}.`;
  const worn = got.armor ? ` (in ${/^[aeiou]/i.test(got.armor.name) ? "an" : "a"} ${got.armor.name.toLowerCase()})` : "";
  if (got.bag) return `${who}${worn} grabbed a ${got.bag.name.toLowerCase()}${things.length ? ` with ${things.join(", ")}` : ""}${weapon ? `, and ${weapon}` : ""}.`;
  return `${who}${worn} ran with only the clothes on their back${things.length ? ` and ${things.join(", ")} in their pockets` : " and empty pockets"}${weapon ? `, and ${weapon}` : ""}.`;
}

// ---------- setup (hardcore.js hardcoreCreate) ----------
export function setupHardcoreStart(state, crew) {
  state.hardcore = state.hardcore || {};
  const tile = spawnTile(state);
  const people = [];
  for (let i = 0; i < HC_START.CREW; i++) {
    const s = makeSurvivor(state, i === 0 ? 1.3 : 1);
    state.survivors.push(s);
    people.push(s);
  }
  people[0].leader = true;
  // Who they were (no two alike): the background's skill bumps and trait come before the new-run screen's edits, so an
  // edited colonist keeps the skills typed in.
  const kinds = drawArchetypes(state, people.length);
  people.forEach((s, i) => applyArchetype(state, s, kinds[i]));
  if (crew) applyCrew(state, crew);
  if (!people.some((s) => s.leader)) people[0].leader = true; // the crew's leader was one of the six of a normal start
  // What each one grabbed. A prepper's bag's five days come on top of the others' 1–3 days (TEAM_MIN..TEAM_MAX clamps
  // what the others carried, as before).
  const sup = {};
  for (const k of SUPPLY_KEYS) sup[k] = 0;
  const lines = [];
  let prepper = null, prepGot = null;
  for (let i = 0; i < people.length; i++) {
    const s = people[i];
    const got = s.background === "prepper" ? rollPrepper(state, s) : rollGrab(state, s, HC_START.ARCHETYPES[s.background]);
    if (got.prepper) { prepper = s; prepGot = got; continue; }
    sup.food += got.food;
    sup.water += got.water;
    sup.ammo += got.ammo;
    sup.meds += got.meds;
    lines.push(grabLine(s, got));
  }
  sup.food = Math.max(HC_START.TEAM_MIN, Math.min(HC_START.TEAM_MAX, sup.food));
  sup.water = Math.max(HC_START.TEAM_MIN, Math.min(HC_START.TEAM_MAX, sup.water));
  if (prepGot) {
    sup.food += prepGot.food;
    sup.water += prepGot.water;
    sup.ammo += prepGot.ammo;
    sup.meds += prepGot.meds;
    lines.unshift(grabLine(prepper, prepGot));
  }
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
  const { owner, car, trunk } = rollCar(state, p, people);
  lines.push(carLine(owner, car, trunk));
  log(state, `The three of you set off in ${firstName(owner)}'s ${car.name.toLowerCase()}: tank ${Math.round((car.fuel / VEHICLE_TYPES[car.type].tank) * 100)}% full${trunk.gear.length || Object.keys(trunk.supplies).length ? ", and what was in the back is the team's cargo" : ""}.`, "info");
  p.sightNow = state.grid.within(tile.id, sightRadius(state, p));
  state.hardcore.start = { tile: tile.id, lastTile: tile.id, foundedDay: null, grabbed: lines, prepper: prepper ? prepper.id : null, car: car.id, carOwner: owner.id, backgrounds: Object.fromEntries(people.map((s) => [s.id, s.background])) };
  // Day 1's log names the prepper (the trait when a slot allowed it, else only this line says it).
  if (prepper) log(state, `${firstName(prepper)} was a prepper${prepGot.trait ? "" : " (no room for the trait: the kit says it)"}: a ${prepGot.bag.name.toLowerCase()} packed for five days${prepGot.weapon ? `, ${/^[aeiou]/i.test(prepGot.weapon.name) ? "an" : "a"} ${prepGot.weapon.name.toLowerCase()}${prepGot.ammo ? ` (${prepGot.ammo} rounds)` : ""}` : ""}${prepGot.items.some((it) => it.key === "waterfilter") ? " and a water filter" : ""}.`, "good");
  // The run opens on the team's orders card: what they grabbed, and what the first hub takes.
  weighTeam(state, p);
  const intro = `Calder is falling. ${lines.join(" ")} Between you: ${Math.floor(sup.food)} food, ${Math.floor(sup.water)} water${sup.ammo ? `, ${Math.floor(sup.ammo)} rounds` : ""}${sup.meds ? `, ${Math.floor(sup.meds)} meds` : ""}, and what is in the car. Find food and water first, then pick a good spot and give the order ${ESTABLISH_LABEL}: a staging camp you bring ${needText(STAGING.HARDCORE.needs)} to, then build up into your hub over a few days.`;
  awaitOrders(state, p, intro, { title: "The day Calder fell" });
  return p;
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
