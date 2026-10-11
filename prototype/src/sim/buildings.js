// @ts-check
// Buildings, workshop stations and the construction queue for every base (hub and outposts).
import { campBecameShelter } from "./staging.js"; // a camp built up into a shelter (the founding)
import { log, atBase, skill, newId, day, localId } from "./world.js";
import { SILENT } from "./hiding.js"; // a base running silent: its stations work in quiet spells
import { SKILL_NAMES, SUPPLIES } from "./data.js";
import { workFactor } from "./health.js";
import { storeCapacity, storeSpaces } from "./storage.js";
import { stationIO, orderHold } from "./production.js";
import { refreshPower, powerLine, freezerLine, hasSealer, choreShare, GEN_TIERS, genTier, genName } from "./power.js"; // gen-tiers: a generator upgraded where it stands
import { buildMult, hash01 } from "./skills.js";
import { buildLock, upgradeLock } from "./blueprints.js";
import { cabinProblem } from "./hunting.js";
import { stockHas, useStock, keyWord } from "./water.js"; // recipes: water counts both kinds, un-purified used first
import { prisonBuildRate } from "./prisoners.js"; // prisoners-tab: prisoner labour on the build queue
import { benchRounds } from "./ammo.js"; // the ammo bench makes rounds by calibre
import { reloadStatus, runReload } from "./reloading.js"; // the reloading bench: an ammo bench upgraded in place
import { livestockYield, PEN } from "./farming.js"; // the animal pen (station "livestock")
import { kitchenService, jobShare } from "./kitchen.js"; // the Kitchen's meals (buildingSummary)
import { noteOutput } from "./output.js"; // the base's Work now panel: what each job brought in a day (activity.js)
import { fieldBuildHour, fieldAwayEnd } from "./fieldworks.js"; // field works: the builders go out on the odd hours

export const RECIPES = {
  ammo:  { name: "Ammo",  in: { scrap: 3 },          out: { ammo: 8 },  skill: "mechanics", desc: "3 scrap → 8 rounds per day, the common rounds of the guns at the base (+4% per Mechanics point)" },
  meds:  { name: "Meds",  in: { scrap: 2, food: 1 }, out: { meds: 1 },  skill: "medicine",  desc: "2 scrap + 1 food → 1 meds per day (+1 with Medicine 8+, +1 with a staffed Clinic or better here)" },
  parts: { name: "Parts", in: { scrap: 6 },          out: { parts: 1 }, skill: "mechanics", minSkill: 4, desc: "6 scrap → 1 part per day (Mechanics 4+, otherwise half the time it fails)" },
  // storage.js: jarred food barely spoils and needs no cellar room; the jars come back when it is eaten at a base.
  preserve: { name: "Preserving", in: { food: 9, water: 3, scrap: 1, jars: 4 }, out: { preserved: 8 }, skill: "farming", desc: "9 fresh food + 3 water + 1 scrap (stove fuel, lids) + 4 empty jars → 8 preserved food per day (9 with Farming 8+). Preserved food barely spoils, needs no cellar room, is lighter to carry and sells well; most jars come back when it is eaten here." },
  // power.js: the still makes fuel from surplus or spoiled food (up to 4 of the 8 can be yesterday's spoiled food).
  // The generator is no station any more (machines-2: no operator; power.js burns its fuel from its tank).
  still: { name: "Ethanol", in: { food: 8, water: 2 }, out: { fuel: 3 }, skill: "farming", main: "food", desc: "8 food + 2 water → 3 fuel per day. Up to 4 of the food can be yesterday's spoiled food (mash). Give it a Keep-at-least order so it only takes the surplus." },
  // farming.js PEN: the animal pen's keeper (eggs and milk every day, all year; recipeOutput: livestockYield).
  livestock: { name: "Livestock", in: { water: 1 }, out: { food: 3 }, skill: "farming", desc: "1 water → 3 fresh food a day (eggs and milk; +1 with Farming 6+), in every season (× 0.75 in winter, on stored hay); half without walls standing at the base. The animals graze 2 of the base's outdoor crop plots." },
};

// Crafting benches (family "bench", tiers 1–3 on one utility plot, each upgrading the one below in place): hand
// crafting at a base (crafting.js) needs one for every recipe but the simple ones a team makes on the road (field)
// and those made at their own station (needs). rate: crafters' work-hours ×, quality: + the item's condition (at
// most 100%), workshop: opens the workshop recipes (needs: "workshop") and lets an ammo bench be built here. Field
// crafting by teams gets nothing from a bench.
// Costs (barestart): no base starts with a bench any more (world.js HUB_START), so the crafting bench is the first one
// a base puts up, and it is priced as a real early decision rather than a formality: 12 scrap and a part (about a
// quarter of a new hub's 50 scrap and one of its 3 parts) and 12 work-hours (half a day for the hub's two starting
// builders, a day for one). It costs as much scrap as a farm plot and a half, more than half a bunkhouse, so a hub
// that builds it first sleeps crowded or plants less for a few days; one that waits makes only the Field recipes.
// No skill needed: anyone can bolt a vise to a table. A part keeps it from being the throwaway first click it was at
// 8 scrap. The workbench (16 scrap, a part, 18 hours, Mechanics 2) and the master workbench (28, 3 parts, 30 hours,
// Mechanics 5) are unchanged: each still costs more than the tier below and the whole road to a workbench is now
// 28 scrap and 2 parts (it was 24 and 1).
export const BENCH = {
  craftbench: { rate: 1.25, quality: 0.05, workshop: false },
  workbench:  { rate: 1.4,  quality: 0.08, workshop: true },
  toolbench:  { rate: 1.6,  quality: 0.12, workshop: true },
};
const benchText = (k) => `crafters here work ${Math.round((BENCH[k].rate - 1) * 100)}% faster and what they make comes out +${Math.round(BENCH[k].quality * 100)}% condition (at most 100%; condition sets a weapon's damage and armour's protection)`;
const BENCH_GATE = "Hand crafting at a base needs a bench for everything but the simple recipes a team can make on the road (marked Field) and those made at their own station";

export const BUILDINGS = {
  farm_plot:    { name: "Farm plot",      cost: { scrap: 8 },             hours: 12, max: 10, desc: "+2 crop plots (Farming tab). Every base starts with some plots: the hub 6, an outpost 2." },
  craftbench:   { name: "Crafting bench", plot: "utility", family: "bench", tier: 1, cost: { scrap: 12, parts: 1 }, hours: 12, max: 1, craft: BENCH.craftbench, // BENCH: why it costs this
                  desc: `A heavy table with a vise and hand tools in the yard. ${BENCH_GATE}: with this one ${benchText("craftbench")}. Upgrade it into a workbench for the workshop recipes and an ammo bench.` },
  workbench:    { name: "Workbench",      plot: "utility", family: "bench", tier: 2, upgrades: "craftbench", cost: { scrap: 16, parts: 1 }, hours: 18, max: 1, req: { mechanics: 2 }, craft: BENCH.workbench,
                  desc: `Bench grinder, drill press and clamps under a roof of tin: ${benchText("workbench")}. It counts as a workshop: the workshop recipes can be made here, and an ammo bench can be built at this base. Upgrades the crafting bench on its plot. Needs a Mechanics 2+ survivor here to build.` },
  toolbench:    { name: "Master workbench", plot: "utility", family: "bench", tier: 3, upgrades: "workbench", cost: { scrap: 28, parts: 3 }, hours: 30, max: 1, req: { mechanics: 5 }, craft: BENCH.toolbench,
                  desc: `A lathe, a welder and every jig worth keeping: ${benchText("toolbench")}. A workshop like the workbench. Upgrades the workbench on its plot. Needs a Mechanics 5+ survivor here to build.` },
  ammo_bench:   { name: "Ammo bench",     plot: "utility", cost: { scrap: 15, parts: 1 },  hours: 24, max: 3, station: "ammo", bench: 2, desc: "Workshop station. One operator turns scrap into ammo. Needs a workbench (or better) at this base to build. Can be upgraded into a reloading bench where it stands (Construction)." },
  // The reloading bench (reloading.js): an ammo bench upgraded where it stands (from, like a barracks from a
  // bunkhouse; never built new: upgradeOnly). Still an "ammo" station: with no reloading order to work it makes the
  // common rounds from scrap as the ammo bench did. heat: × a station's Heat (mannedStations).
  reload_bench: { name: "Reloading bench", plot: "utility", cost: { parts: 1, gunparts: 3, scrap: 20 }, hours: 24, max: 3, station: "ammo", bench: 2, from: "ammo_bench", upgradeOnly: true, req: { mechanics: 3 }, heat: 0.25,
                  desc: "Workshop station: presses, dies and a powder scale. One operator (Mechanics) loads rounds from brass, powder and primers by the standing reloading orders (keep at least N of a calibre and type: hollow points, slugs, AP…), faster with Mechanics; with no order to work it makes common rounds from scrap like an ammo bench. Typed rounds come out as handloads: they jam more than factory rounds, less the better the loader. Quiet: a quarter of a station's Heat. Upgraded from an ammo bench where it stands (Construction): 1 machine part, 3 gun parts, 20 scrap, 24 work-hours, a Mechanics 3+ survivor here." },
  med_station:  { name: "Med station",    plot: "utility", cost: { scrap: 12, meds: 1 },   hours: 24, max: 2, station: "meds", desc: "Workshop station. One operator makes basic meds." },
  machine_shop: { name: "Machine shop",   plot: "building", cost: { scrap: 25, parts: 3 },  hours: 48, max: 2, station: "parts", req: { mechanics: 4 }, desc: "Workshop station. One operator machines spare parts. Needs a Mechanics 4+ survivor here to build." },
  bunkhouse:    { name: "Bunkhouse",      plot: "building", cost: { scrap: 20 },            hours: 30, max: 6, desc: "+6 beds. Overcrowding lowers mood every day." },
  // Housing (BEDS, baseBeds): twice a bunkhouse's beds on one building plot, for a base whose plots run short. from: a
  // standing bunkhouse can be expanded into one where it stands (BARRACKS_UP: no new plot; its jobs count against max).
  barracks:     { name: "Barracks",       plot: "building", cost: { scrap: 40, parts: 2 },  hours: 54, max: 4, from: "bunkhouse", desc: "+12 beds on one building plot (a bunkhouse gives 6): bunks three high, a stove and lockers, for a base whose plots run short. A standing bunkhouse can also be expanded into a barracks where it stands (Construction, On the building plots: Expand; 24 scrap and 2 parts, 30 work-hours, no new plot; its 6 beds stay in use meanwhile). Overcrowding lowers mood every day." },
  walls:        { name: "Walls",          cost: { scrap: 25 },            hours: 36, max: 3, desc: "+3 wall strength (each point adds 2 defense against raids, and holds back 18 more of a horde). In a base battle: the wall map (tier 1), with a walkway behind the wall to shoot down from; each wall section has 40 + 12 hit points a point of wall strength." },
  // Defences against hordes (defences.js): they raise the size of horde the base holds out, and show up on the
  // base's battle map when the dead break in anyway.
  barricades:   { name: "Barricades",       cost: { scrap: 8 },             hours: 10, max: 3, defence: true, desc: "Cars, timber and sandbags behind the walls: the base holds back 12% more of a horde each, and they are full cover on the battle maps if the dead break in (behind the wall and across the yard: tier 2). One is wrecked in every break-in fight; a Wallbreaker smashes one each time it attacks." },
  spike_pits:   { name: "Spike pits",       cost: { scrap: 6 },             hours: 8,  max: 2, defence: true, desc: "Sharpened stakes in covered pits on the approach. One use: the next horde to attack loses 7% + 4 of the dead per pit before it reaches the walls, and the pits are on the battle map (each of the dead that steps in is hurt)." },
  trench:       { name: "Trench and stakes", cost: { scrap: 12 },           hours: 30, max: 1, defence: true, desc: "A ditch around the base: the base holds back 25% more of a horde, and on the battle map the dead that reach the trench lose the rest of their turn." },
  gate:         { name: "Reinforced gate",  cost: { scrap: 14, parts: 1 },  hours: 20, max: 1, defence: true, desc: "Steel plate and a bar on the gate: the base holds back 20% more of a horde, the gate has 180 hit points instead of 100 on the battle map, plus two more barricades there. Needs walls to matter; a Wallbreaker smashes it when no barricade is left." },
  floodlights:  { name: "Floodlights",      cost: { scrap: 8, parts: 2 },   hours: 12, max: 1, defence: true, desc: "Work lights on the walls. Burns 2 fuel when a horde attacks: the base holds back 10% more, and defenders aim better on the battle map (+10 at night, +4 by day). No fuel, no lights." },
  // Hiding a base (hiding.js): netting and brush over the roofs and the yard, the paths kept off. Concealment + HIDE.CAMO.
  camo:         { name: "Camouflage netting", cost: { scrap: 10, parts: 1 }, hours: 16, max: 1, desc: "Netting, brush and dull paint over the roofs and the yard, and the paths kept off the open ground: the base is harder to find (concealment +25%: the groups' scouts and passing parties miss it more often, and a base they have not seen for a month may slip out of what they know). See the base's Defence tab." },
  watchtower:   { name: "Watchtower",     plot: "utility", cost: { scrap: 15 },            hours: 18, max: 1, desc: "+2 tiles of live vision around this base. Lookouts warn of raids sooner. On the battle maps it is two towers (height 2): full cover from anything not right next to them, +10 aim at anything lower and +4 sight, the widest view." },
  // Jails (family "jail", tiers 1–3, each upgrading the one below in place; prisoners.js JAIL has what each tier does):
  // a base keeps prisoners only in a jail (no jail, no room: the extras are released, executed, asked to join or walked
  // to a base with room, prisoners.js settle). Costs:
  //   Makeshift cells (tier 1): 6 scrap, 6 work-hours, no skill, a utility plot (a shelter can put one up): chain-link
  //     and a padlock round a corner of the yard, or a shed with the window boarded. About a farm plot's scrap and half a
  //     day for one builder, so the first prisoner never waits on a real build; it holds 2 and leaks (2% a day guarded,
  //     6% unguarded) and its prisoners sour (mood −1 a day, won over at 0.6×).
  //   Holding cells (tier 2, the old "cells" key: older saves keep theirs, two of them included): 12 scrap and a part,
  //     16 hours, a building plot. Was 16 scrap and a part for a first building; as an upgrade the road to it is now 18
  //     scrap, a part and 22 hours (about what it cost before), so a base pays a little more for a lockup on the way but
  //     never more in total. Holds 3 at the old rates (0.4% / 3%).
  //   Jailhouse (tier 3): 30 scrap, 2 parts, 36 hours, Mechanics 2: a block with a guard post. About a bunkhouse and a
  //     half of scrap and the parts of a well and a garage: a mid-game build for a base that keeps people for labour,
  //     ransom or recruits. Holds 8, escapes halved again (0.2% / 1.5%), one guard on the post watches every prisoner at
  //     work, the work detail runs half as often, and a rescue meets the base's defence ×1.25.
  // The AI groups build the same three tiers as abstract works (groupjails.js).
  lockup:       { name: "Makeshift cells", plot: "utility", family: "jail", tier: 1, cost: { scrap: 6 }, hours: 6, max: 1, desc: "A cage of scrap and chain-link, or a locked shed: room for 2 prisoners (Prisoners tab). Each costs 1 food and 1 water a day. Poor: they slip out often (6% a day with no jail guard, 2% with one, about 1% with two: name them on the Prisoners tab), a smuggled pick or a loner's tricks count ×1.5, and they sour (mood −1 a day, slower to win over). Any base can put one up, a shelter too. Upgrade it into Holding cells." },
  cells:        { name: "Holding cells",  plot: "building", family: "jail", tier: 2, upgrades: "lockup", cost: { scrap: 12, parts: 1 }, hours: 16, max: 1, desc: "Barred rooms for 3 prisoners (Prisoners tab). Each costs 1 food and 1 water a day. With a jail guard named (Prisoners tab) they rarely escape (3% a day with none, 0.4% with one, 0.12% with two). Upgrades the makeshift cells (a building plot). Upgrade it into a Jailhouse." },
  jailhouse:    { name: "Jailhouse",      plot: "building", family: "jail", tier: 3, upgrades: "cells", cost: { scrap: 30, parts: 2 }, hours: 36, max: 1, req: { mechanics: 2 }, desc: "A cell block with a guard post: room for 8 prisoners. Escapes halved again (1.5% a day with no jail guard, 0.2% with one, 0.06% with two); one jail guard on the post watches every prisoner out at work, and the work detail runs half as often; a group come to free its people meets the base's defence ×1.25. Upgrades the holding cells on their plot. Needs a Mechanics 2+ survivor here to build." },
  radio:        { name: "Radio station",  plot: "building", cost: { scrap: 30, parts: 6 },  hours: 48, max: 1, req: { mechanics: 4 }, desc: "Live intel from teams in range, instant calls for help, radio diplomacy. Needs a Mechanics 4+ survivor here to build." },
  // radio.js: an unmanned repeater (no operator) that uses 1 part every 10 days; works only when linked to a station.
  // Any base, the hub too, but not where a radio station stands (canBuild: the station's 12 tiles cover its 6).
  relay:        { name: "Radio relay",    plot: "utility", cost: { scrap: 15, parts: 3 },  hours: 24, max: 1, req: { mechanics: 3 }, desc: "An unmanned repeater mast for any base without a radio station: extends radio coverage 6 tiles around this base when a radio station or another linked relay is within range, so relays chain your coverage outward. Groups whose base lies within your coverage + 6 tiles can be called on the radio and invited into the coalition. No operator; uses 1 part every 10 days (from here, else the hub) or goes off the air. Needs a Mechanics 3+ survivor here to build." },
  garage:       { name: "Garage",         plot: "building", cost: { scrap: 20, parts: 2 },  hours: 30, max: 1, desc: "Vehicle repairs restore 25 condition per part (12 without). No mechanic needed. Keeps 2 cars out of the frost (vehicles.js GARAGE_SHELTER)." },
  storehouse:   { name: "Storehouse",     plot: "building", cost: { scrap: 18 },            hours: 24, max: 1, desc: "Locked dry-goods store: +150 food storage room (0.8% a day, less in the cold), and raiders steal half as much from this base." },
  // Water and food keeping (economy.js WATER, spoilRate; farming.js greenhouse plots).
  well:         { name: "Well",           plot: "utility", cost: { scrap: 15, parts: 1 },  hours: 24, max: 2, desc: "+6 water a day (less in a dry spell). Fills the base up to its water capacity." },
  rain_catcher: { name: "Rain catcher",   plot: "utility", cost: { scrap: 5 },             hours: 8,  max: 4, desc: "Tarps and barrels: +2 water per unit of rain (about 4–7 on a wet day, up to 12 in a storm, nothing when dry)." },
  cistern:      { name: "Cistern",        plot: "building", cost: { scrap: 25 },            hours: 30, max: 3, desc: "+150 water capacity (the hub holds 80 without one, an outpost 40)." },
  // The worm (worm.js): heat kills its eggs. The boiler makes a base's ground water safe; the cook fire its game.
  boiler:       { name: "Water boiler",   plot: "utility", cost: { scrap: 10 },            hours: 10, max: 1, desc: "A drum over a fire pit: everything this base draws from its well, springs and streams is boiled before it is drunk, so the worm's eggs in infected ground water die. Burns 6 firewood (0.6 kg) a day for every person fed here, in every season, on days un-purified water would be drunk and no water filter here covers it: firewood first, then cheap wooden, paper and cloth junk from the armory (novels, magazines, rag boots; anything you mark to burn; never weapons, tools or armour) while the base allows it, then fuel (0.04 a head). A day with nothing to burn it stays cold: the filters, then the armory's purification tablets, else the water is drunk unboiled. A water filter does the same job for nothing, as long as it lasts." },
  // Food storage (storage.js): room for fresh food; food above the room is stored outside and spoils fast.
  cellar:       { name: "Root cellar",    plot: "building", cost: { scrap: 15 },            hours: 20, max: 2, desc: "+200 food storage room underground: food in a cellar spoils slowly (0.5% a day, 0.3% in the cold). The hub already has a small cellar (200), an outpost only a pantry (40); food above the room is stored outside and spoils fast (3% a day, more in heat and rain)." },
  // An ice house (machines-2, the user's pick: its powered mode is gone, no power draw, no summer bonus).
  coldstore:    { name: "Cold store",     plot: "building", cost: { scrap: 20 },            hours: 24, max: 1, desc: "An ice house packed with ice and snow: +150 food storage room, the best there is in winter (0.1–0.2% a day), still good in spring and autumn (0.5%), poor in summer once the ice is gone (1.2%)." },
  // The Preserving room (key "kitchen" in saves; it was the "Preserving room"): jars food. The Kitchen that cooks the
  // meals is "canteen" below (kitchen.js).
  kitchen:      { name: "Preserving room", plot: "building", cost: { scrap: 18, parts: 1 }, hours: 24, max: 2, station: "preserve", desc: "Workshop station. One operator jars fresh food: 9 food + 3 water + 1 scrap + 4 empty jars → 8 preserved food a day (9 with Farming 8+). Jars are found in kitchens, shops and farms; most come back when the food is eaten here. Can be fitted with a pressure canner where it stands (Construction): +1 preserved food a day." },
  // The pressure canner (machines-2 2026-10-10, the user's pick: an upgrade of the preserving room where it stands,
  // as the ammo bench is upgraded into a reloading bench; it was a crafted armory item). Never a building of its own
  // (upgradeOnly, from: "kitchen"): the job fits it to one kitchen (job.target) and that kitchen is marked (b.canner);
  // the key stays "kitchen" for everything that counts kitchens. CANNER below: +1 preserved food a day from that
  // kitchen; the kitchen then wears like a machine (breakdowns.js FIXTURES.canner: repairs take a machine part, a spare
  // part every 30 days it runs). Cost: the old recipe's 4 scrap and 2 parts plus 2 scrap of fittings, 12 work-hours
  // (it was 10 crafting hours), Mechanics 3 as before; a canner item from an old save fits one for nothing (CANNER.item).
  canner:       { name: "Pressure canner", plot: "building", cost: { scrap: 6, parts: 2 }, hours: 12, max: 2, from: "kitchen", upgradeOnly: true, req: { mechanics: 3 }, machine: true,
                  desc: "A heavy pot with a locking lid, a gauge and a relief valve, bolted into a preserving room: it jars under pressure in bigger batches, +1 preserved food a day from that kitchen. Fitted to a preserving room where it stands (Construction): 6 scrap, 2 machine parts, 12 work-hours, a Mechanics 3+ survivor here (a pressure canner kept in the armory is fitted for nothing). The kitchen then wears like a machine: its repairs take a machine part, and it uses a spare part about every 30 days it runs." },
  // Hunting (hunting.js): the land around the base, hunted by the people on the Hunt job.
  huntcabin:    { name: "Hunting cabin",  plot: "building", cost: { scrap: 12 },            hours: 16, max: 1, desc: "A skinning shed, a smoke house and game trails around it. Any base can put people on the Hunt job (they hunt its own tile and the tiles next to it, where game is shy of the walls); the cabin widens the hunting grounds to the land within 2 tiles. The land runs out of game if hunted hard (it grows back over weeks). Smokes up to 6 fresh game a day into 5 preserved food, and fresh game here spoils slower. Needs game land within 2 tiles (forest, hills, farmland)." },
  cookhouse:    { name: "Cook fire",      plot: "utility", cost: { scrap: 6 },             hours: 6,  max: 1, desc: "A stone-lined fire pit with spits and a big pot: all the game and fish eaten here is cooked through, and the greens, roots and crops from infected ground are boiled, which kills the worm's eggs in meat from infected land and infested animals and in food grown or gathered on land at 40%+ infection. Without it (or a preserving room, or a Kitchen, which does all of this) that food waits in the stores and is eaten raw, last, when the clean food is gone." },
  // The Kitchen (kitchen.js KITCHEN): meals cooked for the base by the people on the Cook job. A step up from the cook fire
  // (it cooks everything the cook fire does, so a base with one needs no cook fire). Priced as the Preserving room and
  // the storehouse (18 scrap, a part, 24 work-hours): a mid-game building plot for a base of 8 or more.
  canteen:      { name: "Kitchen",        plot: "building", cost: { scrap: 20, parts: 1 }, hours: 24, max: 1, desc: "Stoves, a big pot and long tables: the base's meals cooked by the people on the Cook job, one cook for every 12 people living here (breakfast 06:00, dinner 20:00). Hot meals stretch the food: everyone fed at the kitchen eats 10% less a day (up to 13% with a good cook: +0.5% a Cooking point above 4), +1 mood a day (+1.5 with a Cooking 6+ cook; only the Kitchen serves hot meals), and a quarter of the day's drinking water is boiled for the meals. The stove burns firewood: 4 a day, and 1 a meal (two a day for everyone fed: 28 a day, 2.8 kg, for 12 people), after the water boiler's and the heating's day; without it the meals are cold (nothing saved, no mood). With too few cooks only that share of the people get hot meals. Like a cook fire, all the game, fish and greens from infected land are cooked through (the worm) while the stove is lit, cook or no cook. No cook: the food is eaten as before." },
  smoker:       { name: "Drying rack",    plot: "utility", cost: { scrap: 6 },             hours: 8,  max: 3, desc: "Racks and a smoke pit, no operator: dries 4 surplus fresh food into 3 preserved food a day (half on wet days). Takes food stored outside first, else only food above 15 days of eating." },
  // Power (power.js): generators need fuel, a daily refuelling and repairs, no operator (machines-2); the still turns
  // food into that fuel. This is tier 1 (power.js GEN_TIERS: the portable set); tiers 2 and 3 are upgrades where it
  // stands (canUpgradeGenerator below, gen-tiers).
  generator:    { name: "Generator",      plot: "utility", cost: { scrap: 20, parts: 4 },  hours: 30, max: 2, req: { mechanics: 3 }, machine: true, desc: "Runs by itself, no operator: 6 power for 2 fuel a day while something draws power (+2 radio range, floodlights without fuel, a machine shop making 2 parts a day, a faster preserving room, a walk-in freezer, a vacuum sealer), burned by the hour from its own tank of 3 fuel (a day and a half's running). Someone able at the base refuels it every morning (half an hour, from the fuel above the reserve set on the Power card); with nobody to refuel it, it runs a day and a half and goes dry. Breakdowns need a Mechanics 3+ survivor and machine parts. Loud: +4 Heat while it runs. Needs a Mechanics 3+ survivor here to build. Upgrade it where it stands (no new plot): a standby generator (12 power, 2.25 fuel a day idling to 3.5 at full load; Mechanics 4), then an industrial diesel set (24 power, 3 to 6 fuel a day; Mechanics 5 and the Industrial Power Manual). Each tier burns more fuel." },
  // The walk-in freezer (freezer-parts 2026-10-10, user request "add a building called walk in freezer"; power.js
  // POWER_USERS.freezer, breakdowns.js FIXTURES.freezer, storage.js): an insulated room with a compressor on the
  // generator. +300 food room; while it is on (base.freezerOn: power served, not broken, not switched off) food in it
  // ages at about a twentieth of the cellar's rate (the food-types branch: STORE.freezer); off, it keeps like a pantry.
  // Priced as a mid-game machine between the generator (20 scrap, 4 parts) and the radio station (30, 6): 30 scrap, 5
  // machine parts and 2 electronics (the thermostat and the compressor's controls), 40 work-hours, Mechanics 3. Draws 2
  // of a generator's 6 power every day, wears like a machine (0.9 a day while it runs) and uses a spare part every 12
  // days on (breakdowns.js spares).
  freezer:      { name: "Walk-in freezer", plot: "building", cost: { scrap: 30, parts: 5, electronics: 2 }, hours: 40, max: 2, req: { mechanics: 3 }, machine: true,
                  desc: "An insulated room with a compressor: +300 food storage room, and while it has power the food in it keeps about twenty times longer than in a cellar. Draws 2 power every day from a running generator (Power card, Workshops tab); with no power, no fuel for the generator or a breakdown it is off and warms up, and the food in it keeps only as in a pantry. Wears like a machine: breakdowns need machine parts and a Mechanics 3+ survivor to fix, and it uses a spare part about every 12 days it runs. Needs a Mechanics 3+ survivor here to build." },
  // The vacuum sealer (freezer-parts 2026-10-10, the user's pick): a powered packing machine on a utility plot, no
  // operator (like the freezer it is a power user, not a workshop station). A later cooking wave makes packaged survival
  // meals with it: hasSealer (power.js) is that hook. 12 scrap, 2 machine parts, 2 electronics (the heat bar and its
  // controls), 16 work-hours, Mechanics 3; draws 1 power while switched on; wears 0.5 a day while powered.
  sealer:       { name: "Vacuum sealer",  plot: "utility", cost: { scrap: 12, parts: 2, electronics: 2 }, hours: 16, max: 1, req: { mechanics: 3 }, machine: true,
                  desc: "A chamber vacuum sealer with a heat bar, bolted to a steel table: it will pack cooked food into light, long-keeping survival meals for the road (the cooking recipes come later). Draws 1 power while switched on (Power card, Workshops tab; switch it off to save fuel while it has no work). Wears like a machine: breakdowns need machine parts and a Mechanics 2+ survivor to fix. Needs a Mechanics 3+ survivor here to build." },
  still:        { name: "Ethanol still",  plot: "utility", cost: { scrap: 15, parts: 2 },  hours: 24, max: 1, station: "still", desc: "Workshop station. One operator ferments and distils 8 food + 2 water into 3 fuel a day; up to 4 of the food can be yesterday's spoiled food. Set a Keep-at-least order so it only takes the surplus." },
  greenhouse:   { name: "Greenhouse",     plot: "building", cost: { scrap: 20, parts: 3 },  hours: 36, max: 2, desc: "+2 sheltered crop plots: grow in every season (winter too), stand 10 °C more cold, and the weather rarely harms them." },
  // Mood (relations.js moodFactors): no operator needed.
  common_room:  { name: "Common room",    plot: "building", cost: { scrap: 22 },            hours: 30, max: 2, desc: "Chairs, a stove and a card table: +1.5 mood a day for everyone living here, up to 15 people a room (spread thinner above that). No operator." },
  // farming.js PEN (2026-10-09, the progression picks): food a guarded base grows on its own land, in winter too.
  animal_pen:   { name: "Animal pen",     plot: "building", cost: { scrap: 14 },            hours: 20, max: 2, station: "livestock", desc: "Hens and a few goats behind a fence. Workshop station: a keeper (Farming) gets 3 fresh food a day from them (eggs and milk; 4 with Farming 6+) for 1 water, in every season (three quarters of it in winter, on stored hay). The animals graze 2 of the base's outdoor crop plots (2 fewer plots for each pen). Without walls standing at the base they stray and the dead take some: half the food." },
  chapel:       { name: "Chapel",         plot: "building", cost: { scrap: 16 },            hours: 24, max: 1, desc: "A quiet room with candles: +1 mood a day for everyone here, grief weighs half as much, and a memorial service held here lifts everyone 2 more. No operator." },
  // Hospital tiers (family "hospital"): each one upgrades the one below and replaces it when finished.
  // med: beds = patients that get the bonus, heal = extra health per day in a bed, eff = meds multiplier,
  // treat = health per manual treatment before Medicine, staff = Medic-role people needed to run it,
  // guards = beds stop wounds getting infected, cures = cleans infected wounds reliably,
  // severe = healing speed for wounds below 30 health in a bed (0.4 without a bed), surgery = operates on
  // severe wounds (full speed plus a bigger heal per treatment), craft = extra meds per day from each med station. See medical.js.
  // Training (training.js): train = Medic trainee places (people on the Trainee role learning from the doctor),
  // teach = how fast lessons and ward rounds teach here (×), ward = the most Medicine XP a medic on duty earns a day
  // from the patients (ward rounds, on top of the Medic role's 8 and the treatments), gap = how far below the doctor's Medicine
  // the lessons stop (1; 0 in a trauma hospital: a trainee can reach the doctor's own level).
  infirmary:    { name: "Makeshift infirmary", plot: "building", family: "hospital", tier: 1, cost: { scrap: 15, meds: 2 }, hours: 20, max: 1,
                  med: { beds: 2, heal: 6, eff: 1.25, treat: 14, staff: 1, guards: false, cures: false, severe: 0.6, surgery: false, craft: 0, train: 1, teach: 1, ward: 4, gap: 1 },
                  desc: "Cots behind a curtain. 2 beds: +6 health/day for patients, meds 25% more effective, severe wounds (below 30) heal at 60% instead of 40%. Needs 1 survivor on the Medic role. Takes 1 Medic trainee: the doctor (the best medic, Medicine 6+) teaches them Medicine every day." },
  field_hosp:   { name: "Field hospital",      plot: "building", family: "hospital", tier: 2, upgrades: "infirmary", cost: { scrap: 30, parts: 2, meds: 4 }, hours: 36, max: 1,
                  med: { beds: 4, heal: 10, eff: 1.5, treat: 16, staff: 1, guards: true, cures: false, severe: 0.8, surgery: false, craft: 0, train: 1, teach: 1.2, ward: 6, gap: 1 },
                  desc: "Army tents, clean water, real dressings. 4 beds: +10 health/day, meds 50% more effective, wounds in bed do not get infected, severe wounds heal at 80%. Upgrades the infirmary. Needs 1 Medic. Takes 1 Medic trainee; lessons and ward rounds teach 20% faster than in the infirmary." },
  clinic:       { name: "Clinic",              plot: "building", family: "hospital", tier: 3, upgrades: "field_hosp", cost: { scrap: 45, parts: 4, meds: 8 }, hours: 60, max: 1, req: { medicine: 6 },
                  med: { beds: 6, heal: 16, eff: 1.8, treat: 18, staff: 2, guards: true, cures: true, severe: 1, surgery: true, craft: 1, train: 2, teach: 1.45, ward: 8, gap: 1 },
                  desc: "A proper treatment room with sterilised tools. 6 beds: +16 health/day, meds 80% more effective, cleans infected wounds, surgery for severe wounds (full speed, bigger treatments), med stations make +1 meds a day. Upgrades the field hospital. Needs 2 Medics (a Medic trainee counts as half of one) and a Medicine 6+ survivor here to build. Takes 2 Medic trainees; lessons and ward rounds teach 45% faster than in the infirmary." },
  hospital:     { name: "Trauma hospital",     plot: "building", family: "hospital", tier: 4, upgrades: "clinic", cost: { scrap: 70, parts: 8, meds: 12 }, hours: 96, max: 1, req: { medicine: 10, mechanics: 4 },
                  med: { beds: 10, heal: 24, eff: 2.2, treat: 22, staff: 3, guards: true, cures: true, severe: 1.2, surgery: true, craft: 1, train: 3, teach: 1.75, ward: 10, gap: 0 },
                  desc: "Operating theatre on generator power. 10 beds: +24 health/day, meds 120% more effective, cleans infected wounds, full surgery (severe wounds heal 20% faster), med stations make +1 meds a day. Upgrades the clinic. Needs 3 Medics (a Medic trainee counts as half of one), and Medicine 10+ and Mechanics 4+ survivors here to build. Takes 3 Medic trainees; lessons and ward rounds teach 75% faster than in the infirmary, and a trainee can learn up to the doctor's own Medicine." },
  // Water barrels (WATER_BARREL below): up to 4, each upgraded on its own and set to hold purified or un-purified water.
  water_barrel: { name: "Water barrel",   plot: "utility", cost: { scrap: 4 },  hours: 6,  max: 4, barrel: true, desc: "A drum on a stand: 25 more water room, kept for the kind you choose. Un-purified: room for the well, rain and river water. Purified: room only safe water may use (water filters' surplus, bottled water brought home), so the well's water never crowds it out and teams always find safe water to pack. Upgrade each barrel on its own: a barrel rack (50), then a water tank (100)." },
  // Storage crates (storage.js storeSpaces): a little dry room for food, outdoors.
  crates:       { name: "Storage crates", plot: "utility", cost: { scrap: 4 },  hours: 5,  max: 4, desc: "Stacked, lidded crates under a tarp: +30 food storage room (dry goods: 0.8% a day, as the pantry and storehouse)." },
  // Base tiers (staging.js): a shelter (tier 0) is built up into a base (the hub, tier 1) by its builders. Not a
  // building: when it is done the shelter becomes a full hub (upgradeShelter).
  // gather (2026-10-09, user pick): as the outpost camp's, its materials are taken from the stores as they come in.
  // User numbers 2026-10-09: "Upgrading to base 60 hours 100 scrap 5 building materials".
  hub_up:       { name: "Build up into a base", cost: { scrap: 100, buildmat: 5 }, hours: 60, max: 1, shelterOnly: true, hubOnly: true, tierUp: true, gather: true,
                  desc: "Turn the shelter into a real base: a main house, a dug well (12 water a day), a cellar, a fence with a gate, beds for four, 16 building plots and 14 utility plots. Shelters only. The materials are taken from the stores as they come in; the builders here do the work, never more of it than the materials delivered allow." },
  // An outpost camp (2026-10-09, user request: "When starting a base it should start as a camp with a progress bar with
  // needed items to upgrade to a more permanent base established"): Build outpost sets up a camp (tier 0, a shelter's
  // rules) and queues this at once. gather: the materials are not paid up front; the job takes them from the camp's
  // stores as they come in (teams, supply runs), and the work never runs ahead of the share delivered (gatherHour).
  // Done: an outpost as before (its spring, wall 1, 6 + 6 plots). Not queued by hand: a camp has it from the start.
  // User numbers 2026-10-09: "Upgrading to Outpost 20 hours 20 scrap 2 building materials".
  // A camp (2026-10-09, user request: "Make camps a pseudo temp base that can be upgraded to bases with time and
  // supplies but is the most barebones"; any team, anywhere: Set up camp, staging.js) built up into a shelter: the camp
  // that is your hub (your first home, the exiles' new one). The old staging camp's numbers (user numbers 2026-10-09,
  // "upgrading to shelter 20 hours 20 scrap 2 building materials"); 10 scrap less on ruins (job.cost, tierUpJobFor).
  camp_up:      { name: "Build up into a shelter", cost: { scrap: 20, buildmat: 2 }, hours: 20, max: 1, campOnly: true, hubOnly: true, tierUp: true, gather: true,
                  desc: "Turn the camp into a shelter: a shack with a roof behind a scrap barricade, beds for four, two utility plots and a garden patch; later the shelter is built up into a base. The materials are taken from the camp's stores as they come in; the builders here do the work, never more of it than the materials delivered allow." },
  outpost_up:   { name: "Establish the outpost", cost: { scrap: 20, buildmat: 2 }, hours: 20, max: 1, shelterOnly: true, outpostOnly: true, tierUp: true, gather: true,
                  desc: "Turn the outpost camp into a real outpost: a shack with a roof, a dug spring (3 water a day), a fence (wall 1), 6 building plots and 6 utility plots. The materials are taken from the camp's stores as they come in (bring them with a team or a supply run); the builders here do the work, never more of it than the materials delivered allow." },
};

// ---------- construction plots ----------
// Every building stands on a plot, by the size of the base: building plots for anything with a roof (bunkhouses,
// the storehouse, cellars, workshops, the hospital), utility plots for the small things in the yard (the boiler, water
// barrels, storage crates, the watchtower, the cook fire, rain catchers, benches). Walls, defences and farm plots need
// no plot. A hospital takes one building plot whatever its tier (an upgrade replaces it in place), and a water
// barrel's upgrades stay on its plot. Demolishing frees the plot (demolish below).
export const PLOTS = {
  camp:    { building: 0, utility: 1 },
  shelter: { building: 0, utility: 2 },
  outpost: { building: 6, utility: 6 },
  hub:     { building: 16, utility: 14 },
};
export const PLOT_NAMES = { building: "Building plot", utility: "Utility plot" };
export const plotSize = (base) => (isCamp(base) ? "camp" : isShelter(base) ? "shelter" : base.type === "hub" ? "hub" : "outpost");
export const plotCap = (base, kind) => PLOTS[plotSize(base)][kind] || 0;
// Plots in use: buildings standing (broken ones too) and new buildings in the queue. A hospital upgrade or a barrel
// upgrade in the queue takes no new plot.
export function plotsUsed(base, kind) {
  const fams = new Set();
  let n = 0;
  for (const b of base.buildings) {
    const d = BUILDINGS[b.type];
    if (!d || d.plot !== kind) continue;
    if (d.family) { if (fams.has(d.family)) continue; fams.add(d.family); }
    n++;
  }
  for (const c of base.construction) {
    const d = BUILDINGS[c.type];
    if (!d || d.plot !== kind || c.target) continue;
    if (d.family) { if (fams.has(d.family)) continue; fams.add(d.family); }
    n++;
  }
  return n;
}
export const plotsFree = (base, kind) => Math.max(0, plotCap(base, kind) - plotsUsed(base, kind));

// ---------- water barrels ----------
// Each barrel (a building { type: "water_barrel", tier, holds }) adds room for one kind of water (water.js): holds
// "water" (purified) or RAW (un-purified). economy.js waterCapacity counts every barrel; the well, rain and river
// water fill only the un-purified barrels and the base's own tanks (economy.js rawRoom).
export const WATER_BARREL = {
  tiers: [
    null,
    { name: "Water barrel", cap: 25 },
    { name: "Barrel rack", cap: 50, cost: { scrap: 8 }, hours: 10, desc: "Three drums on a timber rack, piped together" },
    { name: "Water tank", cap: 100, cost: { scrap: 12, parts: 1 }, hours: 16, desc: "A caged plastic tank on a block stand, with a tap" },
  ],
  holds: "rawwater", // what a new barrel holds (water.js RAW)
};
export const barrels = (base) => base.buildings.filter((b) => b.type === "water_barrel");
export const barrelTier = (b) => Math.max(1, Math.min(WATER_BARREL.tiers.length - 1, b.tier || 1));
export const barrelCap = (b) => WATER_BARREL.tiers[barrelTier(b)].cap;
export const barrelHolds = (b) => (b.holds === "water" ? "water" : "rawwater");
export const barrelName = (b) => WATER_BARREL.tiers[barrelTier(b)].name;
// Room in the barrels for one kind (a broken barrel holds nothing).
export const barrelRoom = (base, kind) => barrels(base).reduce((a, b) => a + (!b.broken && barrelHolds(b) === kind ? barrelCap(b) : 0), 0);
export function canUpgradeBarrel(state, base, id) {
  const b = base && base.buildings.find((x) => x.id === id && x.type === "water_barrel");
  if (!b) return { ok: false, reason: "That barrel is gone" };
  const next = WATER_BARREL.tiers[barrelTier(b) + 1];
  if (!next) return { ok: false, reason: "Already a water tank (the top tier)" };
  if (base.construction.some((c) => c.target === id)) return { ok: false, reason: "An upgrade is already queued" };
  for (const [k, v] of Object.entries(next.cost)) if ((base.stock[k] || 0) < v) return { ok: false, reason: `Needs ${v} ${keyWord(k)}` };
  return { ok: true, next };
}
export function queueBarrelUpgrade(state, base, id) {
  const chk = canUpgradeBarrel(state, base, id);
  if (!chk.ok) return chk.reason;
  const b = base.buildings.find((x) => x.id === id);
  const tier = barrelTier(b) + 1;
  for (const [k, v] of Object.entries(chk.next.cost)) base.stock[k] -= v;
  base.construction.push({ id: newId(), type: "water_barrel", target: id, tier, cost: { ...chk.next.cost }, progress: 0, hours: chk.next.hours });
  return `${barrelName(b)} → ${chk.next.name} queued at ${base.name}.`;
}
// Purified or un-purified: switching only changes what the barrel keeps room for (water of the other kind in it now
// goes to the base's tanks, or stands outside when they are full).
export function setBarrelHolds(base, id, kind) {
  const b = base && base.buildings.find((x) => x.id === id && x.type === "water_barrel");
  if (!b) return "That barrel is gone.";
  b.holds = kind === "water" ? "water" : "rawwater";
  return `${barrelName(b)} now holds ${b.holds === "water" ? "purified" : "un-purified"} water.`;
}
// ---------- expanding a bunkhouse into a barracks ----------
// A standing bunkhouse becomes a barracks where it stands (12 beds instead of 6, no new plot): a queue job
// { type: "barracks", target: the bunkhouse's id, cost }. The bunkhouse sleeps its 6 until the job is done, cannot be
// pulled down meanwhile (canDemolish), and the job counts against the barracks' max (canBuild). The whole way costs a
// little more than a new barracks (20 + 24 scrap, 2 parts, 30 + 30 work-hours): the price of the plot it saves.
export const BARRACKS_UP = { cost: { scrap: 24, parts: 2 }, hours: 30 };
export function canExpandBunkhouse(state, base, id) {
  const b = base && base.buildings.find((x) => x.id === id && x.type === "bunkhouse");
  if (!b) return { ok: false, reason: "That bunkhouse is gone" };
  if (b.broken) return { ok: false, reason: "Repair it first (Repairs tab)" };
  if (base.construction.some((c) => c.target === id)) return { ok: false, reason: "It is being expanded already" };
  const queued = base.construction.filter((c) => c.type === "barracks").length;
  if (countAll(base, "barracks") + queued >= BUILDINGS.barracks.max) return { ok: false, reason: `Limit reached (${BUILDINGS.barracks.max} barracks)` };
  for (const [k, v] of Object.entries(BARRACKS_UP.cost)) if ((base.stock[k] || 0) < v) return { ok: false, reason: `Needs ${v} ${keyWord(k)}` };
  const lock = buildLock(state, base, "barracks");
  if (lock) return { ok: false, reason: lock, locked: true };
  return { ok: true };
}
export function queueBunkhouseExpand(state, base, id) {
  const chk = canExpandBunkhouse(state, base, id);
  if (!chk.ok) return chk.reason;
  for (const [k, v] of Object.entries(BARRACKS_UP.cost)) base.stock[k] -= v;
  base.construction.push({ id: newId(), type: "barracks", target: id, cost: { ...BARRACKS_UP.cost }, progress: 0, hours: BARRACKS_UP.hours });
  return `Bunkhouse → barracks queued at ${base.name}.`;
}

// ---------- upgrading a generator (gen-tiers 2026-10-10; power.js GEN_TIERS, the tiers and their numbers) ----------
// A generator is upgraded a tier where it stands: a queue job { type: "generator", target: its id, tier, cost } (no new
// plot; it does not count against the generators' max). It keeps running at its old tier until the work is done (the
// tank is kept; the next refuelling fills the bigger one). Gates: not broken (repair it first), one upgrade at a time,
// the materials, a survivor at the base with the tier's Mechanics, and for tier 3 the Industrial Power Manual studied
// (blueprints.js upgradeLock). It cannot be pulled down meanwhile (canDemolish). The AI groups: groupworks.js MACH.
export function canUpgradeGenerator(state, base, id) {
  const b = base && base.buildings.find((x) => x.id === id && x.type === "generator");
  if (!b) return { ok: false, reason: "That generator is gone" };
  const tier = genTier(b), next = GEN_TIERS[tier + 1];
  if (!next) return { ok: false, top: true, reason: `Already an ${GEN_TIERS[tier].name.toLowerCase()} (the top tier)` };
  if (base.construction.some((c) => c.target === id)) return { ok: false, queued: true, reason: "An upgrade is already queued" };
  if (b.broken) return { ok: false, reason: "Repair it first (Repairs tab)" };
  for (const [k, v] of Object.entries(next.cost)) if ((base.stock[k] || 0) < v) return { ok: false, short: true, reason: `Needs ${v} ${keyWord(k)}`, next, tier: tier + 1 };
  for (const [sk, lvl] of Object.entries(next.req || {})) if (!atBase(state, base.id).some((s) => skill(s, sk) >= lvl)) return { ok: false, reason: `Needs a ${SKILL_NAMES[sk] || sk} ${lvl}+ survivor here`, next, tier: tier + 1 };
  const lock = upgradeLock(state, `generator${tier + 1}`);
  if (lock) return { ok: false, locked: true, reason: lock, next, tier: tier + 1 };
  return { ok: true, next, tier: tier + 1 };
}
export function queueGenUpgrade(state, base, id) {
  const chk = canUpgradeGenerator(state, base, id);
  if (!chk.ok) return chk.reason;
  const b = base.buildings.find((x) => x.id === id);
  for (const [k, v] of Object.entries(chk.next.cost)) base.stock[k] -= v;
  base.construction.push({ id: newId(), type: "generator", target: id, tier: chk.tier, cost: { ...chk.next.cost }, progress: 0, hours: chk.next.hours });
  return `${genName(b)} → ${chk.next.name} queued at ${base.name}.`;
}

// The name of a queue job: a new building, a barrel's upgrade or a bunkhouse expanded into a barracks.
export const jobName = (job) => (job.target && job.type === "generator" ? `Upgrade a generator to ${GEN_TIERS[job.tier] ? `a ${GEN_TIERS[job.tier].name.toLowerCase()}` : "the next tier"}` : job.target && job.type === "barracks" ? "Expand a bunkhouse into a barracks" : job.target && job.type === "reload_bench" ? "Upgrade an ammo bench into a reloading bench" : job.target && job.type === "canner" ? "Fit a pressure canner to a preserving room" : job.target ?`Upgrade to ${WATER_BARREL.tiers[job.tier] ? WATER_BARREL.tiers[job.tier].name.toLowerCase() : "the next tier"}` : BUILDINGS[job.type].name);

// ---------- demolishing ----------
// Pulls a building down to free its plot: half its scrap, parts and electronics back (rounded down), and for a barrel half of its
// upgrades' too. Not while the base is under attack, nor with an upgrade of it in the queue.
export function demolishRefund(b) {
  const out = {};
  const add = (cost) => { for (const [k, v] of Object.entries(cost || {})) if (k === "scrap" || k === "parts" || k === "electronics") out[k] = (out[k] || 0) + v; };
  add(BUILDINGS[b.type].cost);
  if (b.type === "water_barrel") for (let t = 2; t <= barrelTier(b); t++) add(WATER_BARREL.tiers[t].cost);
  if (b.type === "kitchen" && b.canner) add(BUILDINGS.canner.cost); // machines-2: its pressure canner's half too
  if (b.type === "generator") for (let t = 2; t <= genTier(b); t++) add(GEN_TIERS[t].cost); // gen-tiers: half of its upgrades too
  for (const k of Object.keys(out)) out[k] = Math.floor(out[k] / 2);
  return out;
}
export function canDemolish(state, base, id) {
  const b = base && base.buildings.find((x) => x.id === id);
  if (!b) return { ok: false, reason: "That building is gone" };
  if (underAttack(state, base)) return { ok: false, reason: "Not while the base is under attack" };
  if (base.construction.some((c) => c.target === id || (BUILDINGS[b.type].family && BUILDINGS[c.type].family === BUILDINGS[b.type].family))) return { ok: false, reason: "An upgrade of it is in the queue" };
  return { ok: true };
}
export function demolish(state, base, id) {
  const chk = canDemolish(state, base, id);
  if (!chk.ok) return chk.reason;
  const b = base.buildings.find((x) => x.id === id);
  const back = demolishRefund(b);
  base.buildings.splice(base.buildings.indexOf(b), 1);
  for (const [k, v] of Object.entries(back)) base.stock[k] = (base.stock[k] || 0) + v;
  if (b.type === "radio") base.radio = count(base, "radio") > 0;
  if (b.type === "watchtower") base.watchtower = count(base, "watchtower") > 0;
  for (const s of atBase(state, base.id)) if (s.station === b.id) s.station = null;
  assignStations(state, base);
  const name = b.type === "water_barrel" ? barrelName(b) : b.type === "generator" ? genName(b) : BUILDINGS[b.type].name;
  const got = Object.entries(back).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${keyWord(k)}`).join(", ");
  log(state, `${name} at ${base.name} pulled down${got ? ` (${got} salvaged)` : ""}.`, "info");
  return `${name} pulled down${got ? `: ${got} salvaged` : ""}. Its plot is free.`;
}

// ---------- base tiers ----------
// Your bases grow in three stages: a camp (tier 0 with camp: true, below) → a shelter (tier 0) → a base (tier 1,
// the hub as it always was; outposts are tier 1 too). A shelter is a base you can live at (stores, rest and healing,
// the armory, people with jobs), but small: tarps and a shack behind a scrap barricade, no wall strength, beds for
// four under the tarps, an outpost's two crop plots, one tile of vision, no well of its own (water from a river or lake beside it, rain catchers,
// or what is brought in), and only a few survival buildings (SHELTER.build: max of each) on its two utility plots
// (PLOTS.shelter: no building plots). Its Heat comes from what it
// does (fieldheat.js shelterHeat: its fire, people, vehicles parked, shooting nearby) instead of the hub's flat 3.
// Saves from before the tiers have no tier field: tier 1.
export const SHELTER = {
  name: "Shelter",
  walls: 0, beds: 4, plots: 2, vision: 1, waterCap: 40, // plots: a garden patch, as an outpost's
  river: 10,          // water a day hauled from a river or lake beside it (no well yet; the people carry it)
  // What a shelter may build (the most of each): yard things on its 2 utility plots (PLOTS.shelter), a barricade, a
  // garden patch and the step up.
  build: { rain_catcher: 2, smoker: 1, boiler: 1, cookhouse: 1, water_barrel: 2, crates: 2, watchtower: 1, barricades: 1, farm_plot: 1, hub_up: 1, outpost_up: 1, craftbench: 1, lockup: 1 },
};
export const isShelter = (base) => !!base && base.tier === 0;
export const baseTier = (base) => (isShelter(base) ? 0 : 1);
// ---------- the camp: the lowest tier ----------
// A camp (staging.js: Set up camp, any team anywhere; Establish base; Build outpost) is a tier-0 base with camp: true:
// everything a shelter is (isShelter: no well, no wall strength, a shelter's Heat and fire, base healing and needs),
// only barer. isCamp is the one test (keep camp checks to it). What it changes from a shelter:
//   beds       CAMP.beds (bedrolls round the fire)
//   plots      PLOTS.camp: no building plot, one utility plot; no crop plots (CAMP.plots)
//   build      CAMP.build: a barricade, a rain catcher, crates or a barrel on its one plot, and the step up
//   step up    camp_up (the camp that is your hub → a shelter) or outpost_up (a camp beside a hub → an outpost);
//              queued by Establish base / Build outpost, by hand from Construction for a plain camp
//   materials  its builders make the building materials the step up waits for from scrap in its stores (campMaterialsHour)
//   rest       the hurt heal as in the old Camp order (medical.js: twice a base's rate without a hospital)
//   land       it holds only its own tile (factions.js recomputeOwnership) and counts for no victory
//   neglect    nobody there for STAGING.ABANDON days and it may be looted; empty and bare for STAGING.GONE days, gone
//   strike     Strike camp: its people form a team with what they can carry, the rest is left as a cache (staging.js)
export const CAMP = {
  name: "Camp",
  beds: 6, plots: 0, vision: 1,
  setupHours: 1,     // Set up camp: an hour of work, no materials (the materials come with the step up)
  build: { barricades: 1, rain_catcher: 1, crates: 1, water_barrel: 1, camp_up: 1, outpost_up: 1 },
  ruinScrap: 10,     // on the ruins of a burned base: 10 scrap less for the step up (salvage)
  matScrap: 3, matHours: 3, // its builders make building materials for the step up from scrap (= crafting.js buildmat)
};
export const isCamp = (base) => !!base && base.tier === 0 && base.camp === true;
// What the base is called in the panels.
export const tierName = (base) => (isShelter(base) ? (base.type === "outpost" ? "Outpost camp" : isCamp(base) ? "Camp" : "Shelter") : base.type === "hub" ? "Main hub" : "Outpost");
// The job that takes a tier-0 base up a tier: the camp's camp_up (your hub's) or outpost_up, the shelter's hub_up.
export const tierUpType = (base) => (base && base.type === "outpost" ? "outpost_up" : isCamp(base) ? "camp_up" : "hub_up");
export const tierUpJob = (base) => (isShelter(base) ? base.construction.find((c) => BUILDINGS[c.type] && BUILDINGS[c.type].tierUp) || null : null);
// The step-up job for a base: a camp on ruins pays less scrap (job.cost overrides the building's cost).
export function tierUpJobFor(base, type = tierUpType(base)) {
  const job = gatherJob(type);
  if (base.ruinSalvage && BUILDINGS[type].cost.scrap) job.cost = { ...BUILDINGS[type].cost, scrap: Math.max(0, BUILDINGS[type].cost.scrap - CAMP.ruinScrap) };
  return job;
}
// A camp's hub or outpost role changed (staging.js settleHub): its step up follows (camp_up <-> outpost_up, the same
// costs: what was taken and done carries over).
export function retypeCampJob(base) {
  const want = tierUpType(base);
  for (const job of base.construction) if ((job.type === "camp_up" || job.type === "outpost_up") && job.type !== want) job.type = want;
}
// The shelter becomes a full hub (the hub_up job is done); a camp becomes a shelter (camp_up) or an outpost (outpost_up).
export function upgradeShelter(state, base) {
  if (isCamp(base) && base.type === "hub") {
    delete base.camp;
    base.shelterDay = Math.floor(state.hour / 24) + 1;
    log(state, `${base.name} is a shelter now: a shack with a roof behind a scrap barricade where the camp stood.`, "good");
    campBecameShelter(state, base); // staging.js: hardcore's founding, or the new home's card
    return;
  }
  delete base.camp;
  delete base.tier;
  base.fire = undefined;
  base.upgradedDay = Math.floor(state.hour / 24) + 1;
  log(state, base.type === "outpost" ? `${base.name} is an established outpost now: a shack with a roof, a dug spring and a fence where the camp stood.` : `${base.name} is a real base now: a main house, a dug well, a cellar and a fence where the tarps stood.`, "good");
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
// Beds: the hub 4, an outpost 2, a shelter SHELTER.beds, plus BEDS for each working bunkhouse or barracks (a broken one
// sleeps nobody until it is repaired).
export const BEDS = { bunkhouse: 6, barracks: 12 };
// Beds for the adults: less the beds children take (family.js updateKidBeds: two to a bed; babies sleep with a parent).
export const baseBeds = (base) => (isCamp(base) ? CAMP.beds : isShelter(base) ? SHELTER.beds : base.type === "hub" ? 4 : 2) + Object.entries(BEDS).reduce((a, [t, n]) => a + count(base, t) * n, 0) - (base.kidBeds || 0);
// Beds the construction queue adds when it is done: new bunkhouses and barracks, and a bunkhouse expanded into a
// barracks (the difference). The autopilot counts them as beds to come (autopilot.js buildWishes, roomFor).
export const queuedBeds = (base) => base.construction.reduce((a, c) => a + (!BEDS[c.type] ? 0 : c.target ? BEDS[c.type] - BEDS[BUILDINGS[c.type].from] : BEDS[c.type]), 0);
// Crop plots (farming.js plotLimit): hub 6, outpost and shelter 2, +2 per Farm plot building.
export const farmSlots = (base) => Math.max(0, (isCamp(base) ? CAMP.plots : isShelter(base) ? SHELTER.plots : base.type === "hub" ? 6 : 2) + count(base, "farm_plot") * 2 - count(base, "animal_pen") * PEN.pasture); // the pens' pasture (farming.js)
export const stations = (base) => base.buildings.filter((b) => BUILDINGS[b.type].station);
// The crafting bench here (BENCH): the highest tier standing, 0 for none. Broken ones count only with any (a build
// gate: it is repaired); benchOf is what the crafters get from the working one (null: none, so no bonus; old saves).
export const benchTier = (base, any = false) => Math.max(0, ...base.buildings.map((b) => (BUILDINGS[b.type] && BUILDINGS[b.type].family === "bench" && (any || !b.broken) ? BUILDINGS[b.type].tier : 0)));
export const benchType = (base) => Object.keys(BENCH).find((k) => BUILDINGS[k].tier === benchTier(base)) || null;
export const benchOf = (base) => (benchType(base) ? BENCH[benchType(base)] : null);

export function addBuilding(base, type) {
  const b = { id: newId(), type };
  // An upgrade (hospital tiers) replaces the lower tier of the same family.
  const fam = BUILDINGS[type].family;
  if (fam) base.buildings = base.buildings.filter((x) => BUILDINGS[x.type].family !== fam);
  base.buildings.push(b);
  if (type === "radio") base.radio = true;
  if (type === "watchtower") base.watchtower = true;
  if (BUILDINGS[type].barrel) { b.tier = 1; b.holds = WATER_BARREL.holds; }
  if (type === "generator") b.tier = 1; // gen-tiers: a portable set (power.js GEN_TIERS)
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
export const mannedStations = (state, base) => stations(base).filter((st) => stationOperator(state, base, st) && !stationStatus(state, base, st).idle).reduce((a, st) => a + (BUILDINGS[st.type].heat ?? 1), 0); // an order holding it, or a generator on standby: quiet; a reloading bench a quarter (heat)

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

// The pressure canner (machines-2: BUILDINGS.canner, an upgrade fitted to a preserving room, b.canner): that kitchen
// jars CANNER.out more preserved food a day (bigger batches under pressure). item: the old crafted canner (data.js
// GEAR.canner) kept in the armory pays for the fitting (queueCannerUpgrade); old saves fit theirs (migrateCanners).
export const CANNER = { out: 1, item: "canner", oldRecipe: { scrap: 4, parts: 2 } };
export const hasCanner = (base, st = null) => !!(base && (st ? st.type === "kitchen" && st.canner : base.buildings.some((b) => b.type === "kitchen" && b.canner)));
const cannerItem = (base) => (base.armory || []).findIndex((it) => it && it.key === CANNER.item);
// Can this preserving room be fitted with a pressure canner now? { ok, reason, item (a canner in the armory pays) }.
export function canUpgradeKitchen(state, base, id) {
  const b = base && base.buildings.find((x) => x.id === id && x.type === "kitchen");
  if (!b) return { ok: false, reason: "That preserving room is gone" };
  if (b.canner) return { ok: false, reason: "It has a pressure canner already" };
  if (b.broken) return { ok: false, reason: "Repair it first (Repairs tab)" };
  if (base.construction.some((c) => c.target === id)) return { ok: false, reason: "It is being fitted already" };
  const item = cannerItem(base) >= 0;
  if (!item) for (const [k, v] of Object.entries(BUILDINGS.canner.cost)) if ((base.stock[k] || 0) < v) return { ok: false, reason: `Needs ${v} ${keyWord(k)}` };
  for (const [sk, lvl] of Object.entries(BUILDINGS.canner.req)) if (!atBase(state, base.id).some((s) => skill(s, sk) >= lvl)) return { ok: false, reason: `Needs a ${SKILL_NAMES[sk] || sk} ${lvl}+ survivor here` };
  return { ok: true, item };
}
export function queueCannerUpgrade(state, base, id) {
  const chk = canUpgradeKitchen(state, base, id);
  if (!chk.ok) return chk.reason;
  /** @type {Object<string, number>} */ let cost = { ...BUILDINGS.canner.cost };
  let item;
  if (chk.item) { item = base.armory.splice(cannerItem(base), 1)[0]; cost = {}; } // the canner from the armory: no materials
  else for (const [k, v] of Object.entries(cost)) base.stock[k] -= v;
  base.construction.push({ id: newId(), type: "canner", target: id, cost, progress: 0, hours: BUILDINGS.canner.hours, item });
  return `A pressure canner for the preserving room queued at ${base.name}${chk.item ? " (the one in the armory)" : ""}.`;
}
// Saves from before (save.js, once): a canner kept in a base's armory is fitted to a preserving room there without
// one; with none, it stays in the armory to fit later (it pays for the fitting). A canner still in the craft queue
// (the recipe is gone) is cancelled with its materials back (the old recipe's 4 scrap and 2 parts, CANNER.oldRecipe),
// and a craft order for one dropped.
export function migrateCanners(state) {
  for (const base of state.bases || []) {
    for (const j of [...(base.crafting || [])]) {
      if (j.recipe !== CANNER.item) continue;
      for (const [k, v] of Object.entries(CANNER.oldRecipe)) base.stock[k] = (base.stock[k] || 0) + v;
      base.crafting.splice(base.crafting.indexOf(j), 1);
    }
    if (Array.isArray(base.craftOrders)) base.craftOrders = base.craftOrders.filter((o) => o.recipe !== CANNER.item);
    for (let i = cannerItem(base); i >= 0; i = cannerItem(base)) {
      const k = base.buildings.find((b) => b.type === "kitchen" && !b.canner);
      if (!k) break;
      base.armory.splice(i, 1);
      k.canner = true;
    }
  }
}

// state is needed for the hospital bonus on meds (staffing); without it the bonus is left out.
// st: the station (a kitchen's pressure canner).
export function recipeOutput(s, recipe, base = null, state = null, st = null) {
  const r = RECIPES[recipe];
  const out = {};
  for (const [k, v] of Object.entries(r.out)) {
    let q = v;
    if (recipe === "ammo") q = Math.round(v * (1 + skill(s, "mechanics") * 0.04));
    if (recipe === "meds" && skill(s, "medicine") >= 8) q += 1;
    if (recipe === "meds") q += hospitalCraft(state, base);
    if (recipe === "preserve" && skill(s, "farming") >= 8) q += 1;
    if (recipe === "preserve" && k === "preserved" && st && hasCanner(base, st)) q += CANNER.out; // a pressure canner fitted to this kitchen (TODO(food-types): typed jarred food)
    if (recipe === "livestock" && k === "food") q = base && state ? livestockYield(state, base, s) : v; // farming.js: the season, the walls, the keeper
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
  // production.js: today's inputs and outputs (power, the still's mash) and the station's standing order.
  const hold = orderHold(state, base, st);
  const rs = reloadStatus(state, base, st, op); // reloading.js: a reloading order to work today (its station order holds only the common rounds)
  if (rs) return rs;
  const io = stationIO(state, base, st, op);
  if (hold) return { op, running: false, idle: true, reason: hold, recipe, out: io.out, in: io.in, powered: io.powered };
  const missing = Object.entries(io.in).filter(([k, v]) => stockHas(base.stock, k) < v).map(([k]) => k);
  const out = io.out;
  if (missing.length) return { op, running: false, reason: `Waiting for ${missing.join(", ")}`, recipe, out, in: io.in, powered: io.powered };
  return { op, running: true, reason: io.powered ? "Running (powered)" : "Running", recipe, out, in: io.in, powered: io.powered, mash: io.mash };
}

export function runStations(state, base) {
  assignStations(state, base);
  refreshPower(state, base); // power.js: the generators' power before the powered stations run
  for (const st of stations(base)) {
    const status = stationStatus(state, base, st);
    if (!status.running) continue;
    if (base.silent && hash01(state.seed, "silentwork", localId(state, base.id), day(state), localId(state, st.id)) < SILENT.WORK_SKIP) continue; // hiding.js: running silent, the workshops work in quiet spells
    // kitchen.js jobShare: an operator who cooked part of the day (a part-time cook) runs the station that share of
    // the days (its own dice: no world rng), so the cooking hours are not free.
    if (status.op && hash01(state.seed, "cookshare", localId(state, base.id), day(state), localId(state, st.id)) >= jobShare(state, status.op, "operate")) continue;
    if (status.reload) { runReload(state, base, st, status); continue; } // reloading.js: brass, powder and primers into rounds
    const r = RECIPES[status.recipe];
    const inp = status.in || r.in;
    for (const [k, v] of Object.entries(inp)) useStock(base.stock, k, v);
    if (status.mash) base.mash = Math.max(0, (base.mash || 0) - status.mash); // the still's spoiled food (storage.js)
    if (r.minSkill && skill(status.op, r.skill) < r.minSkill && state.rng.chance(0.5)) continue;
    for (const [k, v] of Object.entries(status.out)) { if (k === "ammo") benchRounds(state, base, v); else base.stock[k] = (base.stock[k] || 0) + v; } // ammo.js: the calibres the guns here shoot
    for (const [k, v] of Object.entries(status.out)) noteOutput(state, base, "operate", v, k);
    if (inp.jars) base.jarsInUse = (base.jarsInUse || 0) + inp.jars; // filled jars (storage.js)
  }
}

export function canBuild(state, base, type) {
  const def = BUILDINGS[type];
  const queued = base.construction.filter((c) => c.type === type && (!c.target || def.from)).length; // a barrel's upgrade is not a new one; a bunkhouse expanded into a barracks is one more barracks
  if (countAll(base, type) + queued >= def.max) return { ok: false, reason: `Limit reached (${def.max})` };
  if (def.upgradeOnly && type === "canner") return { ok: false, reason: "Fitted to a preserving room where it stands (Construction: the preserving room's Fit a canner)" }; // machines-2
  if (def.upgradeOnly) return { ok: false, reason: `Upgrade a${/^[aeiou]/i.test(BUILDINGS[def.from].name) ? "n" : ""} ${BUILDINGS[def.from].name.toLowerCase()} into one (Construction)` }; // the reloading bench
  if (def.family) {
    // Tiered buildings: one step at a time, and only one upgrade in the queue.
    const have = Math.max(0, ...base.buildings.map((x) => (BUILDINGS[x.type].family === def.family ? BUILDINGS[x.type].tier : 0)));
    if (base.construction.some((c) => BUILDINGS[c.type].family === def.family)) return { ok: false, reason: "An upgrade is already queued" };
    if (have >= def.tier) return { ok: false, reason: "Already built (or a better tier)" };
    if (def.upgrades && !count(base, def.upgrades)) return { ok: false, reason: `Upgrade a ${BUILDINGS[def.upgrades].name.toLowerCase()} first` };
  }
  if (def.outpostOnly && base.type !== "outpost") return { ok: false, reason: "Outposts only" };
  if (def.hubOnly && base.type !== "hub") return { ok: false, reason: "The main base only (an outpost camp is established instead)" };
  // A relay where a radio station stands (or is queued) would add nothing: the station's range covers the relay's
  // (radio.js radioNodes counts the base as a station only). A broken station still counts: it is repaired.
  if (type === "relay" && (base.radio || countAll(base, "radio") || base.construction.some((c) => c.type === "radio"))) return { ok: false, reason: "A radio station here already covers more than a relay would" };
  // A shelter (tier 0) builds only a few survival buildings, and the step up into a base; a base never the step.
  if (def.shelterOnly && !isShelter(base)) return { ok: false, reason: "Shelters only (this is a base already)" };
  if (def.campOnly && !isCamp(base)) return { ok: false, reason: isShelter(base) ? "Camps only (this is a shelter already)" : "Camps only (this is a base already)" };
  if (isCamp(base)) {
    const cap = CAMP.build[type];
    if (!cap) return { ok: false, camp: true, reason: type === "hub_up" ? "Build the camp up into a shelter first" : base.type === "outpost" ? "Available once the camp is an outpost (Establish the outpost)" : SHELTER.build[type] ? "Available once the shelter stands (build the camp up first)" : "Available once it is a base (camp → shelter → base)" };
    if (countAll(base, type) + queued >= cap) return { ok: false, reason: `A camp has room for ${cap}` };
  } else if (isShelter(base)) {
    const cap = SHELTER.build[type];
    if (!cap) return { ok: false, reason: "Not at a shelter: build it up into a base first" };
    if (countAll(base, type) + queued >= cap) return { ok: false, reason: `A shelter has room for ${cap}` };
  }
  // A station that needs a bench of some tier here (BENCH): the ammo bench a workbench.
  if (def.bench && benchTier(base, true) < def.bench) return { ok: false, reason: `Needs a ${BUILDINGS[Object.keys(BENCH)[def.bench - 1]].name.toLowerCase()} here first (upgrade the crafting bench)` };
  // Plots (PLOTS): a new building needs a free plot of its kind; a hospital upgrade stands on the old one's.
  const kind = def.plot;
  // (jails: makeshift cells stand on a utility plot, the cells above them need a building plot of their own)
  const onOld = def.family && (base.buildings.some((x) => BUILDINGS[x.type].family === def.family && BUILDINGS[x.type].plot === kind));
  if (kind && !onOld && plotsFree(base, kind) <= 0) {
    const cap = plotCap(base, kind);
    return { ok: false, noPlot: true, reason: cap ? `No free ${PLOT_NAMES[kind].toLowerCase()} (${plotsUsed(base, kind)}/${cap}): demolish something or build at a bigger base` : `A ${tierName(base).toLowerCase()} has no ${PLOT_NAMES[kind].toLowerCase()}s` };
  }
  if (type === "huntcabin" && cabinProblem(state, base)) return { ok: false, reason: `Hunting cabin: ${cabinProblem(state, base)}` };
  if (!def.gather) for (const [k, v] of Object.entries(def.cost)) if ((base.stock[k] || 0) < v) return { ok: false, reason: `Needs ${v} ${keyWord(k)}` }; // gather: taken as it comes in
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
  if (BUILDINGS[type].gather) { base.construction.push(BUILDINGS[type].tierUp ? tierUpJobFor(base, type) : gatherJob(type)); return `${BUILDINGS[type].name} queued at ${base.name}: the materials are taken from the stores as they come in.`; }
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
  for (const [k, v] of Object.entries(job.paid || job.cost || BUILDINGS[job.type].cost)) base.stock[k] = (base.stock[k] || 0) + (full ? v : Math.ceil(v / 2)); // job.cost: a barrel upgrade; job.paid: what a gather job has taken so far
  base.construction.splice(base.construction.indexOf(job), 1);
  if (job.item && typeof job.item === "object") base.armory.push(job.item); // a pressure canner from the armory goes back
  return `Cancelled ${jobName(job)}. ${full ? "All" : "Half"} the materials were returned.`;
}

// A builder the governor (or a base leader with roles) keeps on upkeep (s.upkeep, autopilot.js UPKEEP_CREW): they mend
// worn fixtures every day (breakdowns.js) and add nothing to the construction. The mark counts only while the base is
// governed: one left behind when the autopilot or the leader is switched off is ignored.
export const onUpkeep = (state, base, s) => !!s.upkeep && s.role === "build" && (!!state.autopilot || !!(base.steward && base.steward.on));
export function buildRate(state, base) {
  return atBase(state, base.id).filter((s) => s.role === "build" && !s.inBed && !onUpkeep(state, base, s)).reduce((a, s) => a + (1 + skill(s, "mechanics") * 0.03) * workFactor(s) * buildMult(s) * choreShare(state, s), 0) // buildMult: Handy / Master Builder (skills.js); choreShare: half an hour on the generator's refuelling (power.js)
    + prisonBuildRate(state, base); // prisoners-tab: prisoners set to Build (prisoners.js labour, 12 hours a day at 50–70%)
}

// ---------- jobs that gather their materials (BUILDINGS gather: the outpost camp's step up) ----------
// The job: nothing paid yet (paid: { key: n } taken from the stores so far).
export const gatherJob = (type) => ({ id: newId(), type, progress: 0, hours: BUILDINGS[type].hours, paid: {} });
// Each material: { key, need, have (taken), ok }.
export const gatherRows = (job) => Object.entries(job.cost || BUILDINGS[job.type].cost).map(([key, need]) => { const have = Math.min(need, (job.paid && job.paid[key]) || 0); return { key, need, have, ok: have >= need - 1e-9 }; });
// The share of the work the materials taken so far allow (the least delivered of them).
export const gatherCap = (job) => Math.min(1, ...gatherRows(job).map((r) => (r.need > 0 ? r.have / r.need : 1)));
// Waiting for materials: the work has caught up with what was delivered.
export const gatherStalled = (job) => !!(job && job.paid && gatherCap(job) < 1 && job.progress >= job.hours * gatherCap(job) - 1e-6);
// What is still to come in: "8 scrap, 1 part" ("" when everything is in).
export const gatherShort = (job) => gatherRows(job).filter((r) => !r.ok).map((r) => { const n = Math.ceil(r.need - r.have); return `${n} ${matName(r.key, n)}`; }).join(", ");
// A material's name in a line ("scrap", "2 parts", "building materials").
export const matName = (k, n = 2) => (k === "parts" ? (n === 1 ? "part" : "parts") : SUPPLIES[k] ? SUPPLIES[k].name.toLowerCase() : k);
// Takes what the gather jobs here need next from the stores (each hour, before the work): just in time, enough for the
// next GATHER_AHEAD work-hours (a 100-scrap step up does not empty the stores the hour it is queued: the rest stays for
// other builds until the work gets to it).
export const GATHER_AHEAD = 12;
function gatherHour(base) {
  for (const job of base.construction) {
    if (!job.paid) continue;
    const share = Math.min(1, (job.progress + GATHER_AHEAD) / Math.max(1, job.hours));
    for (const r of gatherRows(job)) {
      const want = Math.min(r.need, Math.ceil(r.need * share - 1e-9)) - r.have;
      const take = Math.min(want, Math.floor(Math.max(0, base.stock[r.key] || 0)));
      if (take <= 0) continue;
      base.stock[r.key] -= take;
      job.paid[r.key] = (job.paid[r.key] || 0) + take;
    }
  }
}

// A camp (isCamp) whose step up waits for building materials while its stores hold the scrap: its builders make them
// there (the field recipe, crafting.js buildmat: CAMP.matScrap scrap and CAMP.matHours work-hours each), as a team
// does on the road. The hour goes on that instead of the building. True when they worked on it.
function campMaterialsHour(state, base) {
  if (!isCamp(base)) return false;
  const job = tierUpJob(base);
  if (!job || !job.paid || !gatherStalled(job)) return false;
  const bm = gatherRows(job).find((r) => r.key === "buildmat" && !r.ok);
  if (!bm || (base.stock.buildmat || 0) >= 1) return false;
  const sc = gatherRows(job).find((r) => r.key === "scrap");
  const scrapNeed = sc ? Math.max(0, sc.need - sc.have) : 0;
  if ((base.stock.scrap || 0) - scrapNeed < CAMP.matScrap) return false; // the step up's own scrap first
  const rate = buildRate(state, base);
  if (rate <= 0) return false;
  job.matWork = (job.matWork || 0) + rate;
  if (job.matWork >= CAMP.matHours) {
    job.matWork -= CAMP.matHours;
    base.stock.scrap -= CAMP.matScrap;
    base.stock.buildmat = (base.stock.buildmat || 0) + 1;
    log(state, `${base.name}: the builders made building materials from scrap for the step up.`, "info");
  }
  return true;
}
// Builders work on the first job in the queue, hour by hour (a job waiting for its materials lets the next one go on).
export function constructionHour(state) {
  for (const base of state.bases) {
    if (underAttack(state, base)) { fieldAwayEnd(state, base); continue; } // the builders out at a field work come in for it
    if (fieldBuildHour(state, base)) continue; // fieldworks.js: the builders are out at a field work this hour
    if (!base.construction.length) continue;
    gatherHour(base);
    if (campMaterialsHour(state, base)) continue; // a camp's builders make the building materials its step up waits for
    const job = base.construction.find((c) => !gatherStalled(c));
    if (!job) continue;
    const was = job.progress;
    job.progress += buildRate(state, base);
    if (job.paid) job.progress = Math.min(job.progress, job.hours * gatherCap(job)); // never ahead of the materials
    noteOutput(state, base, "build", Math.max(0, job.progress - was), "workh");
    if (job.progress >= job.hours - 1e-9) {
      base.construction.splice(base.construction.indexOf(job), 1);
      noteOutput(state, base, "build", 1, "done");
      if (BUILDINGS[job.type].tierUp) { upgradeShelter(state, base); continue; } // the shelter becomes a base
      if (job.target && job.type === "barracks") { // a bunkhouse expanded (BARRACKS_UP); nothing if it was lost meanwhile
        const b = base.buildings.find((x) => x.id === job.target && x.type === "bunkhouse");
        if (b) { b.type = "barracks"; log(state, `${base.name}: a bunkhouse is now a barracks (12 beds).`, "good"); }
        continue;
      }
      if (job.target && job.type === "canner") { // a pressure canner fitted to a preserving room; back to the armory if the kitchen was lost meanwhile
        const b = base.buildings.find((x) => x.id === job.target && x.type === "kitchen");
        if (b) { b.canner = true; log(state, `${base.name}: a pressure canner is fitted in the preserving room (+${CANNER.out} preserved food a day).`, "good"); }
        else if (job.item) base.armory.push(job.item);
        continue;
      }
      if (job.target && job.type === "generator") { // a generator upgraded a tier (gen-tiers); nothing if it was lost meanwhile
        const b = base.buildings.find((x) => x.id === job.target && x.type === "generator");
        if (b) { b.tier = Math.max(genTier(b), job.tier); log(state, `${base.name}: the generator is now a ${genName(b).toLowerCase()} (${GEN_TIERS[genTier(b)].out} power).`, "good"); }
        continue;
      }
      if (job.target && job.type === "reload_bench") { // an ammo bench upgraded (reloading.js); nothing if it was lost meanwhile
        const b = base.buildings.find((x) => x.id === job.target && x.type === "ammo_bench");
        if (b) { b.type = "reload_bench"; log(state, `${base.name}: an ammo bench is now a reloading bench.`, "good"); }
        continue;
      }
      if (job.target) { // a water barrel's upgrade (WATER_BARREL); nothing if it was pulled down meanwhile
        const b = base.buildings.find((x) => x.id === job.target);
        if (b) { b.tier = Math.max(barrelTier(b), job.tier); log(state, `${base.name}: a water barrel is now a ${barrelName(b).toLowerCase()} (${barrelCap(b)} water).`, "good"); }
        continue;
      }
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
    ["Crafting", benchOf(base) ? `${BUILDINGS[benchType(base)].name}: crafters ${Math.round((benchOf(base).rate - 1) * 100)}% faster, +${Math.round(benchOf(base).quality * 100)}% condition${benchOf(base).workshop ? ", workshop recipes" : ""}` : "No crafting bench: only the simple (Field) recipes"],
    ...(isCamp(base) ? [["Tier", "Camp: tarps, bedrolls and a fire. Build it up (Construction) into a shelter or an outpost for a roof and room to build"]] : isShelter(base) ? [["Tier", "Shelter (tier 0): tarps, a shack and a barricade. Build it up into a base (Construction) for walls, a well and every building"]] : []),
    ["Vision", `${(isCamp(base) ? CAMP.vision : isShelter(base) ? SHELTER.vision : base.type === "hub" ? 3 : 2) + (base.watchtower ? 2 : 0)} tiles`],
    ["Radio", base.radio ? "Station" : count(base, "relay") ? (base.relayOffline ? "Relay (offline: needs 1 part)" : "Relay") : "No"],
    ["Vehicle repairs", count(base, "garage") ? "Garage (+25 per part)" : "Field repair (+12 per part, Mechanics 4+)"],
    ["Raid losses", count(base, "storehouse") ? "Halved by storehouse" : "Normal"],
    ["Water", `${isShelter(base) ? "no well (a river or lake beside it, rain catchers, or water brought in)" : `${(base.type === "hub" ? 12 : 3) + count(base, "well") * 6}/day from wells`}${count(base, "rain_catcher") ? `, ${count(base, "rain_catcher")} rain catcher${count(base, "rain_catcher") === 1 ? "" : "s"}` : ""}, holds ${(isShelter(base) ? SHELTER.waterCap : base.type === "hub" ? 80 : 40) + count(base, "cistern") * 150 + barrelRoom(base, "water") + barrelRoom(base, "rawwater")}${barrels(base).length ? ` (barrels: ${barrelRoom(base, "rawwater")} un-purified, ${barrelRoom(base, "water")} purified)` : ""}`],
    ["Plots", `building ${plotsUsed(base, "building")}/${plotCap(base, "building")}, utility ${plotsUsed(base, "utility")}/${plotCap(base, "utility")}`],
    ["Food storage", `${storeCapacity(base)} room for fresh food (${storeSpaces(base).map((x) => `${x.name.toLowerCase()} ${x.cap}`).join(", ")}); more is stored outside and spoils fast`],
    ["Preserving", [count(base, "kitchen") ? `${count(base, "kitchen")} preserving room${count(base, "kitchen") > 1 ? "s" : ""}` : "", count(base, "smoker") ? `${count(base, "smoker")} drying rack${count(base, "smoker") > 1 ? "s" : ""}` : ""].filter(Boolean).join(", ") || "None"],
    ["Meals", (() => {
      const ks = kitchenService(state, base);
      if (!ks.built) return count(base, "cookhouse") ? "Cook fire (game and greens cooked through)" : "Each eats their own (no kitchen)";
      if (ks.cold) return "Kitchen: cold meals (no firewood for the stove)";
      if (!ks.cooks.length) return `Kitchen: no cook (${ks.wanted} wanted: put someone on Cook)`;
      return `Kitchen: ${ks.count} cook${ks.count === 1 ? " feeds" : "s feed"} ${ks.served} of ${ks.fed} hot meals (−${Math.round(ks.save * 1000) / 10}% food, +${Math.round(ks.mood * 10) / 10} mood a day)`;
    })()],
    ["Power", powerLine(state, base)],
    ...(countAll(base, "freezer") ? [["Walk-in freezer", freezerLine(state, base)]] : []),
    ...(countAll(base, "sealer") ? [["Vacuum sealer", hasSealer(state, base) ? "Ready (powered)" : base.buildings.some((b) => b.type === "sealer" && b.broken) ? "Broken: needs repair" : "Off (no power)"]] : []),
    ["Medical", (() => {
      const h = base.buildings.find((x) => BUILDINGS[x.type].family === "hospital");
      if (!h) return "No hospital (severe wounds heal slowly)";
      const d = BUILDINGS[h.type];
      return `Tier ${d.tier} ${d.name}: ${d.med.beds} beds, needs ${d.med.staff} medic${d.med.staff === 1 ? "" : "s"}${d.med.surgery ? ", surgery" : ""}`;
    })()],
  ];
}
