// Buildings, workshop stations and the construction queue for every base (hub and outposts).
import { log, atBase, skill, newId } from "./world.js";
import { SKILL_NAMES } from "./data.js";
import { workFactor } from "./health.js";
import { storeCapacity, storeSpaces } from "./storage.js";
import { stationIO, orderHold } from "./production.js";
import { refreshPower, generatorStatus, powerLine } from "./power.js";
import { buildMult } from "./skills.js";
import { buildLock } from "./blueprints.js";
import { cabinProblem } from "./hunting.js";
import { prisonBuildRate } from "./prisoners.js"; // prisoners-tab: prisoner labour on the build queue

export const RECIPES = {
  ammo:  { name: "Ammo",  in: { scrap: 3 },          out: { ammo: 8 },  skill: "mechanics", desc: "3 scrap → 8 ammo per day (+4% per Mechanics point)" },
  meds:  { name: "Meds",  in: { scrap: 2, food: 1 }, out: { meds: 1 },  skill: "medicine",  desc: "2 scrap + 1 food → 1 meds per day (+1 with Medicine 8+, +1 with a staffed Clinic or better here)" },
  parts: { name: "Parts", in: { scrap: 6 },          out: { parts: 1 }, skill: "mechanics", minSkill: 4, desc: "6 scrap → 1 part per day (Mechanics 4+, otherwise half the time it fails)" },
  // storage.js: jarred food barely spoils and needs no cellar room; the jars come back when it is eaten at a base.
  preserve: { name: "Preserving", in: { food: 9, water: 3, scrap: 1, jars: 4 }, out: { preserved: 8 }, skill: "farming", desc: "9 fresh food + 3 water + 1 scrap (stove fuel, lids) + 4 empty jars → 8 preserved food per day (9 with Farming 8+). Preserved food barely spoils, needs no cellar room, is lighter to carry and sells well; most jars come back when it is eaten here." },
  // power.js: the still makes fuel from surplus or spoiled food (up to 4 of the 8 can be yesterday's spoiled food);
  // the generator burns fuel for power (its fuel is paid in power.js refreshPower, not by runStations).
  still: { name: "Ethanol", in: { food: 8, water: 2 }, out: { fuel: 3 }, skill: "farming", main: "food", desc: "8 food + 2 water → 3 fuel per day. Up to 4 of the food can be yesterday's spoiled food (mash). Give it a Keep-at-least order so it only takes the surplus." },
  power: { name: "Power", in: { fuel: 2 }, out: {}, skill: "mechanics", main: "fuel", desc: "2 fuel a day → 6 power while something draws it (stands by otherwise). Loud: +4 Heat while running." },
};

export const BUILDINGS = {
  farm_plot:    { name: "Farm plot",      cost: { scrap: 8 },             hours: 12, max: 10, desc: "+2 crop plots (Farming tab). Every base starts with some plots: the hub 6, an outpost 2." },
  ammo_bench:   { name: "Ammo bench",     cost: { scrap: 15, parts: 1 },  hours: 24, max: 3, station: "ammo", desc: "Workshop station. One operator turns scrap into ammo." },
  med_station:  { name: "Med station",    cost: { scrap: 12, meds: 1 },   hours: 24, max: 2, station: "meds", desc: "Workshop station. One operator makes basic meds." },
  machine_shop: { name: "Machine shop",   cost: { scrap: 25, parts: 3 },  hours: 48, max: 2, station: "parts", req: { mechanics: 4 }, desc: "Workshop station. One operator machines spare parts. Needs a Mechanics 4+ survivor here to build." },
  bunkhouse:    { name: "Bunkhouse",      cost: { scrap: 20 },            hours: 30, max: 6, desc: "+6 beds. Overcrowding lowers mood every day." },
  walls:        { name: "Walls",          cost: { scrap: 25 },            hours: 36, max: 3, desc: "+3 wall strength (each point adds 2 defense against raids, and holds back 18 more of a horde). In a base battle: the wall map (tier 1), with a walkway behind the wall to shoot down from; each wall section has 40 + 12 hit points a point of wall strength." },
  // Defences against hordes (defences.js): they raise the size of horde the base holds out, and show up on the
  // base's battle map when the dead break in anyway.
  barricades:   { name: "Barricades",       cost: { scrap: 8 },             hours: 10, max: 3, defence: true, desc: "Cars, timber and sandbags behind the walls: the base holds back 12% more of a horde each, and they are full cover on the battle maps if the dead break in (behind the wall and across the yard: tier 2). One is wrecked in every break-in fight; a Wallbreaker smashes one each time it attacks." },
  spike_pits:   { name: "Spike pits",       cost: { scrap: 6 },             hours: 8,  max: 2, defence: true, desc: "Sharpened stakes in covered pits on the approach. One use: the next horde to attack loses 7% + 4 of the dead per pit before it reaches the walls, and the pits are on the battle map (each of the dead that steps in is hurt)." },
  trench:       { name: "Trench and stakes", cost: { scrap: 12 },           hours: 30, max: 1, defence: true, desc: "A ditch around the base: the base holds back 25% more of a horde, and on the battle map the dead that reach the trench lose the rest of their turn." },
  gate:         { name: "Reinforced gate",  cost: { scrap: 14, parts: 1 },  hours: 20, max: 1, defence: true, desc: "Steel plate and a bar on the gate: the base holds back 20% more of a horde, the gate has 180 hit points instead of 100 on the battle map, plus two more barricades there. Needs walls to matter; a Wallbreaker smashes it when no barricade is left." },
  floodlights:  { name: "Floodlights",      cost: { scrap: 8, parts: 2 },   hours: 12, max: 1, defence: true, desc: "Work lights on the walls. Burns 2 fuel when a horde attacks: the base holds back 10% more, and defenders aim better on the battle map (+10 at night, +4 by day). No fuel, no lights." },
  watchtower:   { name: "Watchtower",     cost: { scrap: 15 },            hours: 18, max: 1, desc: "+2 tiles of live vision around this base. Lookouts warn of raids sooner. On the battle maps it is two towers (height 2): full cover from anything not right next to them, +10 aim at anything lower and +4 sight, the widest view." },
  // prisoners.js: where prisoners are held. Someone on the Guard role keeps them from slipping out.
  cells:        { name: "Holding cells",  cost: { scrap: 16, parts: 1 },  hours: 20, max: 2, desc: "Barred rooms for 3 prisoners each (Prisoners tab). Each costs 1 food and 1 water a day. With someone on the Guard role here they rarely escape (0.4% a day; 3% unguarded; 8% for anyone kept in a shed when the cells are full)." },
  radio:        { name: "Radio station",  cost: { scrap: 30, parts: 6 },  hours: 48, max: 1, req: { mechanics: 4 }, desc: "Live intel from teams in range, instant calls for help, radio diplomacy. Needs a Mechanics 4+ survivor here to build." },
  // radio.js: an unmanned repeater (no operator) that uses 1 part every 10 days; works only when linked to a station.
  relay:        { name: "Radio relay",    cost: { scrap: 15, parts: 3 },  hours: 24, max: 1, req: { mechanics: 3 }, outpostOnly: true, desc: "Outposts only. An unmanned repeater mast: extends radio coverage 6 tiles around this outpost when a radio station or another linked relay is within range. No operator; uses 1 part every 10 days (from here, else the hub) or goes off the air. Needs a Mechanics 3+ survivor here to build." },
  garage:       { name: "Garage",         cost: { scrap: 20, parts: 2 },  hours: 30, max: 1, desc: "Vehicle repairs restore 25 condition per part (12 without). No mechanic needed." },
  storehouse:   { name: "Storehouse",     cost: { scrap: 18 },            hours: 24, max: 1, desc: "Locked dry-goods store: +150 food storage room (0.8% a day, less in the cold), and raiders steal half as much from this base." },
  // Water and food keeping (economy.js WATER, spoilRate; farming.js greenhouse plots).
  well:         { name: "Well",           cost: { scrap: 15, parts: 1 },  hours: 24, max: 2, desc: "+6 water a day (less in a dry spell). Fills the base up to its water capacity." },
  rain_catcher: { name: "Rain catcher",   cost: { scrap: 5 },             hours: 8,  max: 4, desc: "Tarps and barrels: +2 water per unit of rain (about 4–7 on a wet day, up to 12 in a storm, nothing when dry)." },
  cistern:      { name: "Cistern",        cost: { scrap: 25 },            hours: 30, max: 3, desc: "+150 water capacity (the hub holds 80 without one, an outpost 40)." },
  // The worm (worm.js): heat kills its eggs. The boiler makes a base's ground water safe; the cook fire its game.
  boiler:       { name: "Water boiler",   cost: { scrap: 10 },            hours: 10, max: 1, desc: "A drum over a fire pit: everything this base draws from its well, springs and streams is boiled before it is drunk, so the worm's eggs in infected ground water die. Burns like heating: 0.2 firewood a day for every person fed here (fuel for what the wood does not cover, 0.1 a head), in every season, but only on days the water carries eggs and no water filter here covers it. A day the base cannot pay, it stays cold and the water is drunk unboiled. A water filter does the same job for nothing, as long as it lasts." },
  // Food storage (storage.js): room for fresh food; food above the room is stored outside and spoils fast.
  cellar:       { name: "Root cellar",    cost: { scrap: 15 },            hours: 20, max: 2, desc: "+200 food storage room underground: food in a cellar spoils slowly (0.5% a day, 0.3% in the cold). The hub already has a small cellar (200), an outpost only a pantry (40); food above the room is stored outside and spoils fast (3% a day, more in heat and rain)." },
  coldstore:    { name: "Cold store",     cost: { scrap: 20 },            hours: 24, max: 1, desc: "An ice house packed with ice and snow: +150 food storage room, the best there is in winter (0.1–0.2% a day), still good in spring and autumn (0.5%), poor in summer once the ice is gone (1.2%)." },
  kitchen:      { name: "Preserving kitchen", cost: { scrap: 18, parts: 1 }, hours: 24, max: 2, station: "preserve", desc: "Workshop station. One operator jars fresh food: 9 food + 3 water + 1 scrap + 4 empty jars → 8 preserved food a day (9 with Farming 8+). Jars are found in kitchens, shops and farms; most come back when the food is eaten here." },
  // Hunting (hunting.js): the land around the base, hunted by the people on the Hunt job.
  huntcabin:    { name: "Hunting cabin",  cost: { scrap: 12 },            hours: 16, max: 1, desc: "A skinning shed, a smoke house and game trails around it. Up to 2 people on the Hunt job hunt the land within 2 tiles 3 hours a day (dawn and dusk) with their own weapons and this base's ammo; without a weapon they tend snares. The land runs out of game if hunted hard (it grows back over weeks). Smokes up to 6 fresh game a day into 5 preserved food, and fresh game here spoils slower. Needs game land within 2 tiles (forest, hills, farmland)." },
  cookhouse:    { name: "Cook fire",      cost: { scrap: 6 },             hours: 6,  max: 1, desc: "A stone-lined fire pit with spits and a big pot: all the game and fish eaten here is cooked through, and the greens, roots and crops from infected ground are boiled, which kills the worm's eggs in meat from infected land and infested animals and in food grown or gathered on land at 40%+ infection. Without it (or a preserving kitchen) that food waits in the stores and is eaten raw, last, when the clean food is gone." },
  smoker:       { name: "Drying rack",    cost: { scrap: 6 },             hours: 8,  max: 3, desc: "Racks and a smoke pit, no operator: dries 4 surplus fresh food into 3 preserved food a day (half on wet days). Takes food stored outside first, else only food above 15 days of eating." },
  // Power (power.js): generators need an operator and fuel; the still turns food into that fuel.
  generator:    { name: "Generator",      cost: { scrap: 20, parts: 4 },  hours: 30, max: 2, station: "power", req: { mechanics: 3 }, desc: "Workshop station. With an operator it burns 2 fuel a day for 6 power, only while something draws power: a cold store that works in summer, +2 radio range, floodlights without fuel, a machine shop making 2 parts a day, a faster preserving kitchen. Loud: +4 Heat while it runs. Needs a Mechanics 3+ survivor here to build." },
  still:        { name: "Ethanol still",  cost: { scrap: 15, parts: 2 },  hours: 24, max: 1, station: "still", desc: "Workshop station. One operator ferments and distils 8 food + 2 water into 3 fuel a day; up to 4 of the food can be yesterday's spoiled food. Set a Keep-at-least order so it only takes the surplus." },
  greenhouse:   { name: "Greenhouse",     cost: { scrap: 20, parts: 3 },  hours: 36, max: 2, desc: "+2 sheltered crop plots: grow in every season (winter too), stand 10 °C more cold, and the weather rarely harms them." },
  // Mood (relations.js moodFactors): no operator needed.
  common_room:  { name: "Common room",    cost: { scrap: 22 },            hours: 30, max: 2, desc: "Chairs, a stove and a card table: +1.5 mood a day for everyone living here, up to 15 people a room (spread thinner above that). No operator." },
  chapel:       { name: "Chapel",         cost: { scrap: 16 },            hours: 24, max: 1, desc: "A quiet room with candles: +1 mood a day for everyone here, grief weighs half as much, and a memorial service held here lifts everyone 2 more. No operator." },
  // Hospital tiers (family "hospital"): each one upgrades the one below and replaces it when finished.
  // med: beds = patients that get the bonus, heal = extra health per day in a bed, eff = meds multiplier,
  // treat = health per manual treatment before Medicine, staff = Medic-role people needed to run it,
  // guards = beds stop wounds getting infected, cures = cleans infected wounds reliably,
  // severe = healing speed for wounds below 30 health in a bed (0.4 without a bed), surgery = operates on
  // severe wounds (full speed plus a bigger heal per treatment), craft = extra meds per day from each med station. See medical.js.
  infirmary:    { name: "Makeshift infirmary", family: "hospital", tier: 1, cost: { scrap: 15, meds: 2 }, hours: 20, max: 1,
                  med: { beds: 2, heal: 6, eff: 1.25, treat: 14, staff: 1, guards: false, cures: false, severe: 0.6, surgery: false, craft: 0 },
                  desc: "Cots behind a curtain. 2 beds: +6 health/day for patients, meds 25% more effective, severe wounds (below 30) heal at 60% instead of 40%. Needs 1 survivor on the Medic role." },
  field_hosp:   { name: "Field hospital",      family: "hospital", tier: 2, upgrades: "infirmary", cost: { scrap: 30, parts: 2, meds: 4 }, hours: 36, max: 1,
                  med: { beds: 4, heal: 10, eff: 1.5, treat: 16, staff: 1, guards: true, cures: false, severe: 0.8, surgery: false, craft: 0 },
                  desc: "Army tents, clean water, real dressings. 4 beds: +10 health/day, meds 50% more effective, wounds in bed do not get infected, severe wounds heal at 80%. Upgrades the infirmary. Needs 1 Medic." },
  clinic:       { name: "Clinic",              family: "hospital", tier: 3, upgrades: "field_hosp", cost: { scrap: 45, parts: 4, meds: 8 }, hours: 60, max: 1, req: { medicine: 6 },
                  med: { beds: 6, heal: 16, eff: 1.8, treat: 18, staff: 2, guards: true, cures: true, severe: 1, surgery: true, craft: 1 },
                  desc: "A proper treatment room with sterilised tools. 6 beds: +16 health/day, meds 80% more effective, cleans infected wounds, surgery for severe wounds (full speed, bigger treatments), med stations make +1 meds a day. Upgrades the field hospital. Needs 2 Medics and a Medicine 6+ survivor here to build." },
  hospital:     { name: "Trauma hospital",     family: "hospital", tier: 4, upgrades: "clinic", cost: { scrap: 70, parts: 8, meds: 12 }, hours: 96, max: 1, req: { medicine: 10, mechanics: 4 },
                  med: { beds: 10, heal: 24, eff: 2.2, treat: 22, staff: 3, guards: true, cures: true, severe: 1.2, surgery: true, craft: 1 },
                  desc: "Operating theatre on generator power. 10 beds: +24 health/day, meds 120% more effective, cleans infected wounds, full surgery (severe wounds heal 20% faster), med stations make +1 meds a day. Upgrades the clinic. Needs 3 Medics, and Medicine 10+ and Mechanics 4+ survivors here to build." },
  // Base tiers (staging.js): a shelter (tier 0) is built up into a base (the hub, tier 1) by its builders. Not a
  // building: when it is done the shelter becomes a full hub (upgradeShelter).
  hub_up:       { name: "Build up into a base", cost: { scrap: 18, parts: 2 }, hours: 96, max: 1, shelterOnly: true, tierUp: true,
                  desc: "Turn the shelter into a real base: a main house, a dug well (12 water a day), a cellar, a fence with a gate, beds for four and room for every building. Shelters only. The builders here do the work." },
};

// ---------- base tiers ----------
// Your bases grow in three stages: a staging camp (staging.js, not a base yet) → a shelter (tier 0) → a base (tier 1,
// the hub as it always was; outposts are tier 1 too). A shelter is a base you can live at (stores, rest and healing,
// the armory, people with jobs), but small: tarps and a shack behind a scrap barricade, no wall strength, beds for
// four under the tarps, an outpost's two crop plots, one tile of vision, no well of its own (water from a river or lake beside it, rain catchers,
// or what is brought in), and only a few survival buildings (SHELTER.build: max of each). Its Heat comes from what it
// does (fieldheat.js shelterHeat: its fire, people, vehicles parked, shooting nearby) instead of the hub's flat 3.
// Saves from before the tiers have no tier field: tier 1.
export const SHELTER = {
  name: "Shelter",
  walls: 0, beds: 4, plots: 2, vision: 1, waterCap: 40, // plots: a garden patch, as an outpost's
  river: 10,          // water a day hauled from a river or lake beside it (no well yet; the people carry it)
  build: { rain_catcher: 2, smoker: 1, barricades: 1, farm_plot: 1, hub_up: 1 },
};
export const isShelter = (base) => !!base && base.tier === 0;
export const baseTier = (base) => (isShelter(base) ? 0 : 1);
// What the base is called in the panels.
export const tierName = (base) => (isShelter(base) ? "Shelter" : base.type === "hub" ? "Main hub" : "Outpost");
// The shelter becomes a full hub (the hub_up job is done).
export function upgradeShelter(state, base) {
  delete base.tier;
  base.fire = undefined;
  base.upgradedDay = Math.floor(state.hour / 24) + 1;
  log(state, `${base.name} is a real base now: a main house, a dug well, a cellar and a fence where the tarps stood.`, "good");
}

// Working buildings of a type: a broken one (breakdowns.js) does nothing until it is repaired. countAll: built, broken or not.
export const count = (base, type) => base.buildings.filter((b) => b.type === type && !b.broken).length;
export const countAll = (base, type) => base.buildings.filter((b) => b.type === type).length;
// Wall strength: the hub 3, an outpost 1, +3 a wall section, +2 for a section damaged in a raid (wear 60+,
// breakdowns.js RAID_DAMAGE.damaged) and nothing for a broken one.
export const baseWalls = (base) => (isShelter(base) ? SHELTER.walls : base.type === "hub" ? 3 : 1) + base.buildings.reduce((a, b) => a + (b.type !== "walls" || b.broken ? 0 : (b.wear || 0) >= 60 ? 2 : 3), 0);
// A base on alert or under siege (a raid at its walls): builders and mechanics are on the walls, so construction
// and repairs stop until it is over (the price of "Prepare defenses").
export const underAttack = (state, base) => !!base.alert ||
  state.parties.some((q) => q.phase === "siege" && q.target && q.target.kind === "player" && q.target.baseId === base.id) ||
  (state.visitors || []).some((v) => v.phase === "siege" && v.goal && v.goal.kind === "base" && v.goal.baseId === base.id);
export const baseBeds = (base) => (isShelter(base) ? SHELTER.beds : base.type === "hub" ? 4 : 2) + count(base, "bunkhouse") * 6;
// Crop plots (farming.js plotLimit): hub 6, outpost and shelter 2, +2 per Farm plot building.
export const farmSlots = (base) => (isShelter(base) ? SHELTER.plots : base.type === "hub" ? 6 : 2) + count(base, "farm_plot") * 2;
export const stations = (base) => base.buildings.filter((b) => BUILDINGS[b.type].station);

export function addBuilding(base, type) {
  const b = { id: newId(), type };
  // An upgrade (hospital tiers) replaces the lower tier of the same family.
  const fam = BUILDINGS[type].family;
  if (fam) base.buildings = base.buildings.filter((x) => BUILDINGS[x.type].family !== fam);
  base.buildings.push(b);
  if (type === "radio") base.radio = true;
  if (type === "watchtower") base.watchtower = true;
  return b;
}

export function stationOperator(state, base, st) {
  // Patients in a hospital bed (s.inBed, set hourly by medical.js) do not work.
  // Someone too sick to work (health.js) leaves the station idle. A broken station (breakdowns.js) has nobody at work.
  if (st && st.broken) return null;
  return atBase(state, base.id).find((s) => s.role === "operate" && s.station === st.id && !s.inBed && workFactor(s) >= 0.35) || null;
}

// Operators without a valid station are moved to the first free one.
export function assignStations(state, base) {
  const list = stations(base);
  const people = atBase(state, base.id).filter((s) => s.role === "operate");
  const taken = new Set();
  for (const s of people) {
    if (s.station && list.some((st) => st.id === s.station) && !taken.has(s.station)) taken.add(s.station);
    else s.station = null;
  }
  for (const s of people) {
    if (s.station) continue;
    const free = list.find((st) => !taken.has(st.id));
    if (free) {
      s.station = free.id;
      taken.add(free.id);
    }
  }
}

// Stations with an operator at work (not in a hospital bed): what makes workshop noise (Heat, hordes.js).
export const mannedStations = (state, base) => stations(base).filter((st) => stationOperator(state, base, st) && !stationStatus(state, base, st).idle).length; // an order holding it, or a generator on standby: quiet

// Extra meds per day from a med station thanks to the base's hospital (Clinic or better). Like everything else
// a hospital does, it needs the medics to run it (the same staffing rule as medical.activeHospital).
function hospitalCraft(state, base) {
  if (!state || !base) return 0;
  const medics = atBase(state, base.id).filter((s) => s.role === "medic").length;
  return Math.max(0, ...base.buildings.map((b) => {
    const m = BUILDINGS[b.type].med;
    return m && medics >= m.staff ? m.craft || 0 : 0;
  }));
}

// state is needed for the hospital bonus on meds (staffing); without it the bonus is left out.
export function recipeOutput(s, recipe, base = null, state = null) {
  const r = RECIPES[recipe];
  const out = {};
  for (const [k, v] of Object.entries(r.out)) {
    let q = v;
    if (recipe === "ammo") q = Math.round(v * (1 + skill(s, "mechanics") * 0.04));
    if (recipe === "meds" && skill(s, "medicine") >= 8) q += 1;
    if (recipe === "meds") q += hospitalCraft(state, base);
    if (recipe === "preserve" && skill(s, "farming") >= 8) q += 1;
    out[k] = q;
  }
  return out;
}

export function stationStatus(state, base, st) {
  const recipe = BUILDINGS[st.type].station;
  const r = RECIPES[recipe];
  const op = stationOperator(state, base, st);
  if (st.broken) return { op: null, running: false, idle: true, broken: true, reason: "Broken: needs repair (Repairs tab)", recipe, out: {}, in: r.in }; // breakdowns.js
  if (!op) {
    const sick = atBase(state, base.id).find((s) => s.role === "operate" && s.station === st.id);
    return { op: null, running: false, reason: sick ? (sick.inBed ? "Operator in a hospital bed" : "Operator too sick to work") : "No operator", recipe, out: {}, in: r.in };
  }
  if (recipe === "power") return generatorStatus(state, base, st, op); // power.js
  // production.js: today's inputs and outputs (power, the still's mash) and the station's standing order.
  const io = stationIO(state, base, st, op);
  const hold = orderHold(state, base, st);
  if (hold) return { op, running: false, idle: true, reason: hold, recipe, out: io.out, in: io.in, powered: io.powered };
  const missing = Object.entries(io.in).filter(([k, v]) => (base.stock[k] || 0) < v).map(([k]) => k);
  const out = io.out;
  if (missing.length) return { op, running: false, reason: `Waiting for ${missing.join(", ")}`, recipe, out, in: io.in, powered: io.powered };
  return { op, running: true, reason: io.powered ? "Running (powered)" : "Running", recipe, out, in: io.in, powered: io.powered, mash: io.mash };
}

export function runStations(state, base) {
  assignStations(state, base);
  refreshPower(state, base); // power.js: generators burn today's fuel before the powered stations run
  for (const st of stations(base)) {
    const status = stationStatus(state, base, st);
    if (!status.running || status.recipe === "power") continue;
    const r = RECIPES[status.recipe];
    const inp = status.in || r.in;
    for (const [k, v] of Object.entries(inp)) base.stock[k] -= v;
    if (status.mash) base.mash = Math.max(0, (base.mash || 0) - status.mash); // the still's spoiled food (storage.js)
    if (r.minSkill && skill(status.op, r.skill) < r.minSkill && state.rng.chance(0.5)) continue;
    for (const [k, v] of Object.entries(status.out)) base.stock[k] = (base.stock[k] || 0) + v;
    if (inp.jars) base.jarsInUse = (base.jarsInUse || 0) + inp.jars; // filled jars (storage.js)
  }
}

export function canBuild(state, base, type) {
  const def = BUILDINGS[type];
  const queued = base.construction.filter((c) => c.type === type).length;
  if (countAll(base, type) + queued >= def.max) return { ok: false, reason: `Limit reached (${def.max})` };
  if (def.family) {
    // Tiered buildings: one step at a time, and only one upgrade in the queue.
    const have = Math.max(0, ...base.buildings.map((x) => (BUILDINGS[x.type].family === def.family ? BUILDINGS[x.type].tier : 0)));
    if (base.construction.some((c) => BUILDINGS[c.type].family === def.family)) return { ok: false, reason: "An upgrade is already queued" };
    if (have >= def.tier) return { ok: false, reason: "Already built (or a better tier)" };
    if (def.upgrades && !count(base, def.upgrades)) return { ok: false, reason: `Upgrade a ${BUILDINGS[def.upgrades].name.toLowerCase()} first` };
  }
  if (def.outpostOnly && base.type !== "outpost") return { ok: false, reason: "Outposts only" };
  // A shelter (tier 0) builds only a few survival buildings, and the step up into a base; a base never the step.
  if (def.shelterOnly && !isShelter(base)) return { ok: false, reason: "Shelters only (this is a base already)" };
  if (isShelter(base)) {
    const cap = SHELTER.build[type];
    if (!cap) return { ok: false, reason: "Not at a shelter: build it up into a base first" };
    if (countAll(base, type) + queued >= cap) return { ok: false, reason: `A shelter has room for ${cap}` };
  }
  if (type === "huntcabin" && cabinProblem(state, base)) return { ok: false, reason: `Hunting cabin: ${cabinProblem(state, base)}` };
  for (const [k, v] of Object.entries(def.cost)) if ((base.stock[k] || 0) < v) return { ok: false, reason: `Needs ${v} ${k}` };
  if (def.req) {
    for (const [sk, lvl] of Object.entries(def.req)) {
      if (!atBase(state, base.id).some((s) => skill(s, sk) >= lvl)) return { ok: false, reason: `Needs a ${SKILL_NAMES[sk] || sk} ${lvl}+ survivor here` };
    }
  }
  const lock = buildLock(state, base, type); // blueprints.js: upper tiers need a studied manual or blueprint
  if (lock) return { ok: false, reason: lock, locked: true };
  return { ok: true };
}

export function queueBuild(state, base, type) {
  const chk = canBuild(state, base, type);
  if (!chk.ok) return chk.reason;
  for (const [k, v] of Object.entries(BUILDINGS[type].cost)) base.stock[k] -= v;
  base.construction.push({ id: newId(), type, progress: 0, hours: BUILDINGS[type].hours });
  return `${BUILDINGS[type].name} queued at ${base.name}.`;
}

// Cancelling an untouched job refunds everything; a started one gives half back, rounded up (the same rule as
// crafting.cancelCraft). Returns the message to show.
export function cancelBuild(state, base, id) {
  const job = base ? base.construction.find((c) => c.id === id) : null;
  if (!job) return "That job is gone.";
  const full = job.progress <= 0;
  for (const [k, v] of Object.entries(BUILDINGS[job.type].cost)) base.stock[k] = (base.stock[k] || 0) + (full ? v : Math.ceil(v / 2));
  base.construction.splice(base.construction.indexOf(job), 1);
  return `Cancelled ${BUILDINGS[job.type].name}. ${full ? "All" : "Half"} the materials were returned.`;
}

export function buildRate(state, base) {
  return atBase(state, base.id).filter((s) => s.role === "build" && !s.inBed).reduce((a, s) => a + (1 + skill(s, "mechanics") * 0.03) * workFactor(s) * buildMult(s), 0) // buildMult: Handy / Master Builder (skills.js)
    + prisonBuildRate(state, base); // prisoners-tab: prisoners set to Build (prisoners.js labour, 12 hours a day at 50–70%)
}

// Builders work on the first job in the queue, hour by hour.
export function constructionHour(state) {
  for (const base of state.bases) {
    const job = base.construction[0];
    if (!job || underAttack(state, base)) continue;
    job.progress += buildRate(state, base);
    if (job.progress >= job.hours) {
      base.construction.shift();
      if (BUILDINGS[job.type].tierUp) { upgradeShelter(state, base); continue; } // the shelter becomes a base
      addBuilding(base, job.type);
      log(state, `${BUILDINGS[job.type].name} finished at ${base.name}.`, "good");
    }
  }
}

export function buildingSummary(state, base) {
  const people = atBase(state, base.id).length;
  return [
    ["Defense from walls", `+${baseWalls(base) * 2}`],
    ["Beds", `${baseBeds(base)} for ${people} people${people > baseBeds(base) ? " (overcrowded)" : ""}`],
    ["Crop plots", `${farmSlots(base)}${count(base, "greenhouse") ? ` + ${count(base, "greenhouse") * 2} under glass` : ""}`],
    ["Workshop stations", `${stations(base).length}`],
    ...(isShelter(base) ? [["Tier", "Shelter (tier 0): tarps, a shack and a barricade. Build it up into a base (Construction) for walls, a well and every building"]] : []),
    ["Vision", `${(isShelter(base) ? SHELTER.vision : base.type === "hub" ? 3 : 2) + (base.watchtower ? 2 : 0)} tiles`],
    ["Radio", base.radio ? "Station" : count(base, "relay") ? (base.relayOffline ? "Relay (offline: needs 1 part)" : "Relay") : "No"],
    ["Vehicle repairs", count(base, "garage") ? "Garage (+25 per part)" : "Field repair (+12 per part, Mechanics 4+)"],
    ["Raid losses", count(base, "storehouse") ? "Halved by storehouse" : "Normal"],
    ["Water", `${isShelter(base) ? "no well (a river or lake beside it, rain catchers, or water brought in)" : `${(base.type === "hub" ? 12 : 3) + count(base, "well") * 6}/day from wells`}${count(base, "rain_catcher") ? `, ${count(base, "rain_catcher")} rain catcher${count(base, "rain_catcher") === 1 ? "" : "s"}` : ""}, holds ${(isShelter(base) ? SHELTER.waterCap : base.type === "hub" ? 80 : 40) + count(base, "cistern") * 150}`],
    ["Food storage", `${storeCapacity(base)} room for fresh food (${storeSpaces(base).map((x) => `${x.name.toLowerCase()} ${x.cap}`).join(", ")}); more is stored outside and spoils fast`],
    ["Preserving", [count(base, "kitchen") ? `${count(base, "kitchen")} kitchen${count(base, "kitchen") > 1 ? "s" : ""}` : "", count(base, "smoker") ? `${count(base, "smoker")} drying rack${count(base, "smoker") > 1 ? "s" : ""}` : ""].filter(Boolean).join(", ") || "None"],
    ["Power", powerLine(state, base)],
    ["Medical", (() => {
      const h = base.buildings.find((x) => BUILDINGS[x.type].family === "hospital");
      if (!h) return "No hospital (severe wounds heal slowly)";
      const d = BUILDINGS[h.type];
      return `Tier ${d.tier} ${d.name}: ${d.med.beds} beds, needs ${d.med.staff} medic${d.med.staff === 1 ? "" : "s"}${d.med.surgery ? ", surgery" : ""}`;
    })()],
  ];
}
