// @ts-check
// Buildings, workshop stations and the construction queue for every base (hub and outposts).
import { FOODS, addFood, qtyOf } from "./foods.js"; // a station's food out (the kitchen's jars, the pen's eggs and milk)
import { campBecameShelter, baseUpgraded } from "./staging.js"; // a camp built up into a shelter (the founding)
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
import { MINES } from "./mines.js"; // a minefield's mines (call-time only)
import { baseCarts, CART_JOB } from "./carts.js"; // a cart at the base: a builder hauls the materials faster (call-time only)
import { woodNeed } from "./woodcutting.js"; // the Ring wall leaves the wood for heating (call-time only)
import { carryPlacement, fittingRoom, fittingsIn, wallInfo, ringPlan, ensureRing, siteWaits, finishClear, clearUnder } from "./basemap.js"; // the base map (call-time only): a finished job's building keeps the spot it was placed on; a general building with room for a fitting; the fittings inside one; the wall pieces' ring
import { BED_BUILDINGS } from "./data-beds.js"; // beds as furniture: the placed cot, bed, bunk bed and large bed (beds.js)
import { TENT_TYPES, TENT_S } from "./data-tents.js"; // the one tent table (TENTS below)
import { strikeTentAtBase } from "./tents.js"; // a bag's tent pulled down: struck back into its bag (call-time only)
import { furnitureBeds, furnitureProblem, canSetFurniture, setFurniture, pickUpFurniture, RETIRED_WHY, furnitureText } from "./beds.js"; // beds as furniture (call-time only)

export const RECIPES = {
  ammo:  { name: "Ammo",  in: { scrap: 3 },          out: { ammo: 8 },  skill: "mechanics", desc: "3 scrap → 8 rounds per day, the common rounds of the guns at the base (+4% per Mechanics point)" },
  meds:  { name: "Meds",  in: { scrap: 2, food: 1 }, out: { meds: 1 },  skill: "medicine",  desc: "2 scrap + a day's food (any kind: the base's food that spoils soonest) → 1 meds per day (+1 with Medicine 8+, +1 with a staffed Clinic or better here)" },
  parts: { name: "Parts", in: { scrap: 6 },          out: { parts: 1 }, skill: "mechanics", minSkill: 4, desc: "6 scrap → 1 part per day (Mechanics 4+, otherwise half the time it fails)" },
  // storage.js: jarred food keeps a year and a half and needs no cold room; the jars come back when it is eaten at a base.
  // "fresh": days of the base's food that needs a cold room (foods.js), the soonest to spoil first.
  preserve: { name: "Preserving", in: { fresh: 9, water: 3, scrap: 1, jars: 4 }, out: { f_jarred: 8 }, skill: "farming", desc: "9 days of fresh food (what spoils soonest: meat, crops, forage) + 3 water + 1 scrap (stove fuel, lids) + 4 empty jars → 8 portions of jarred food per day (9 with Farming 8+). Jarred food keeps a year and a half, needs no cold room and sells well; most jars come back when it is eaten here." },
  // power.js: the still makes fuel from surplus fresh food. The generator is no station any more (machines-2: no
  // operator; power.js burns its fuel from its tank).
  still: { name: "Ethanol", in: { fresh: 8, water: 2 }, out: { fuel: 3 }, skill: "farming", main: "fresh", desc: "8 days of fresh food + 2 water → 3 fuel per day. Give it a Keep-at-least order so it only takes the surplus." },
  // farming.js PEN: the animal pen's keeper (eggs and milk every day, all year; recipeOutput: livestockYield).
  livestock: { name: "Livestock", in: { water: 1 }, out: { f_eggs: qtyOf("f_eggs", 1.8), f_milk: qtyOf("f_milk", 1.2) }, skill: "farming", desc: "1 water → 3 days of fresh food a day (eggs and goat's milk; +1 with Farming 6+), in every season (× 0.75 in winter, on stored hay); half without walls standing at the base. The animals graze 2 of the base's outdoor crop plots." },
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

// Base storage (basestorage.js, the user's request 2026-10-19: "needing to craft simple storage boxes up to buildings of
// different sizes with the dedication to increasing the base storage"): the kg of the base's goods each building holds
// (BUILDINGS storeKg). A ladder of sizes, cheapest first: the storage box (a camp's), the storage crates, the storage
// shed, the storehouse, the warehouse (an outpost or the main base only: size); the root cellar, the cold store and the
// walk-in freezer hold goods too. Costs (the design): the box 2 scrap, 2 work-hours (a camp builds up to 4, a shelter
// 6; no plot: it stands anywhere in the yard); the shed 12 scrap and a building material, 12 hours, a building plot;
// the warehouse 40 scrap, 4 building materials and a part, 48 hours, Mechanics 2.
// Base building's fittings (2026-10-19): storage shelves and lockers stand inside a general building's floor and count
// as storage buildings do.
export const STORE_KG = { storebox: 60, crates: 150, shed: 600, storehouse: 2000, warehouse: 6000, cellar: 400, coldstore: 300, freezer: 300, armory: 400, shelves: 150, lockers: 100 };

export const BUILDINGS = {
  farm_plot:    { name: "Farm plot",      cost: { scrap: 7, wood: 75 },             hours: 12, max: 10, desc: "+2 crop plots (Farming tab). Every base starts with some plots: a camp 1, a shelter 2, an outpost 4, the main base 8." },
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
  // Makeshift cots (user request 2026-10-12, "makeshift cots that can be built for shelter to increase beds by 2"):
  // camp beds of scrap and canvas squeezed in under the shelter's roof: no plot, +2 beds each (BEDS), up to 2.
  // Superseded (beds as furniture, 2026-10-20): the Cot is crafted and set inside a building (beds.js); a save's built
  // cots are each two Cots set at that base (beds.js migrateCots). retired: never built again (canBuild, the lists).
  cots:         { name: "Makeshift cots", cost: { scrap: 6 },            hours: 6,  max: 2, shelterOnly: true, retired: "cot", desc: "Camp beds of scrap frames and canvas squeezed in under the shelter's roof: +2 beds each, no plot. Shelters only (up to 2); they stay when the shelter becomes a base." },
  bunkhouse:    { name: "Bunkhouse",      plot: "building", cost: { scrap: 17, wood: 150 },            hours: 30, max: 6, desc: "+6 beds. Overcrowding lowers mood every day." },
  // Housing (BEDS, baseBeds): twice a bunkhouse's beds on one building plot, for a base whose plots run short. from: a
  // standing bunkhouse can be expanded into one where it stands (BARRACKS_UP: no new plot; its jobs count against max).
  barracks:     { name: "Barracks",       plot: "building", cost: { scrap: 40, parts: 2 },  hours: 54, max: 4, from: "bunkhouse", desc: "+12 beds on one building plot (a bunkhouse gives 6): bunks three high, a stove and lockers, for a base whose plots run short. A standing bunkhouse can also be expanded into a barracks where it stands (Construction, On the building plots: Expand; 24 scrap and 2 parts, 30 work-hours, no new plot; its 6 beds stay in use meanwhile). Overcrowding lowers mood every day." },
  // Walls (the user's requests 2026-10-19: "convert base defense walls from a single build into placeable 1x1, 1x2,
  // 1x4 walls that you can place and rotate. Each cost x resources. Walls come in different types with better defense
  // ratings the better materials used, lowest level wood highest level metal sheets. Also add gates as a 1 x 4
  // placement. Add 1x1, 1x2, and 1x4 wall stands that survivors can climb up to so they can see over walls"):
  //   pieces (piece, len): walls and a gate of a material (WALL_TIERS, picked when queued: job.mat, b.mat) and wall
  //   stands, each placed and turned on the base map (basemap.js: anywhere, R turns it) or laid round the yard by the
  //   game. cost / hours here: the wooden piece's (pieceCost, pieceHours for any material). The base is walled only
  //   where its pieces close a ring round it (basemap.js wallInfo: the houses count as wall too).
  //   walls: the Ring wall, a bundle (queueBuild "walls"): every piece it takes to close the ring round the yard
  //   (kind "ring"), or every wall and gate raised to a better material (kind "upgrade"); a group's own wall (their
  //   works, groupbases.js) stays one building of a tier.
  walls:        { name: "Ring wall",      cost: { wood: 8 },             hours: 8,  max: 1, tab: "defenses", size: "camp", wall: true, gather: true, desc: "Every wall piece and gate it takes to close a ring round the yard, laid by the game where the ring runs (or, once the ring is closed, every piece raised to a better material). Queued at once: its materials are taken from the stores as they come in (never the wood the base needs for heat). Each wall is only as good as the ring it makes: a gap anywhere lets the dead walk round it." },
  wall1:        { name: "Wall 1×1",       piece: "wall", len: 1, cost: { wood: 2 },  hours: 0.5, max: 400, tab: "defenses", size: "camp", desc: "One cell of wall. Place it and turn it on the base map. The better the material, the more hit points it has and the more wall strength the ring gives." },
  wall2:        { name: "Wall 1×2",       piece: "wall", len: 2, cost: { wood: 4 },  hours: 1,   max: 400, tab: "defenses", size: "camp", desc: "Two cells of wall in a line. Place it and turn it on the base map (R)." },
  wall4:        { name: "Wall 1×4",       piece: "wall", len: 4, cost: { wood: 8 },  hours: 2,   max: 400, tab: "defenses", size: "camp", desc: "A four-cell section of wall. Place it and turn it on the base map (R)." },
  gate4:        { name: "Gate 1×4",       piece: "gate", len: 4, cost: { wood: 12 }, hours: 3,   max: 8,   tab: "defenses", size: "camp", desc: "A four-cell gate of the wall's material: your people walk through it, raiders and the dead have to batter it down (or ram it). The reinforced gate (Defenses) adds hit points to every gate." },
  stand1:       { name: "Wall stand 1×1", piece: "stand", len: 1, cost: { wood: 4 },  hours: 0.5, max: 60, tab: "defenses", size: "camp", desc: "A raised platform a level up with a ladder: whoever climbs it sees and shoots over a wall next to it, with half cover from below. Place it right behind a wall." },
  stand2:       { name: "Wall stand 1×2", piece: "stand", len: 2, cost: { wood: 8, scrap: 1 }, hours: 1, max: 60, tab: "defenses", size: "camp", desc: "A two-cell firing platform a level up: two people see and shoot over the wall in front of it." },
  stand4:       { name: "Wall stand 1×4", piece: "stand", len: 4, cost: { wood: 16, scrap: 1 }, hours: 2, max: 60, tab: "defenses", size: "camp", desc: "A four-cell walkway a level up behind the wall: a firing line that sees and shoots over it." },
  // Defences against hordes and raiders (defences.js): they raise the size of horde the base holds out and its
  // defence against raids (tierMults), and show up on the base's battle map. tab "defenses", size: the smallest base
  // that takes one (DEF_SIZE: a camp, a shelter, an outpost, the main base).
  barricades:   { name: "Barricades",       cost: { scrap: 7, wood: 75 },             hours: 10, max: 3, defence: true, tab: "defenses", size: "camp", desc: "Cars, timber and sandbags behind the walls: the base holds back 12% more of a horde each, and they are full cover on the battle maps if the dead break in (behind the wall and across the yard: tier 2). One is wrecked in every break-in fight; a Wallbreaker smashes one each time it attacks." },
  spike_pits:   { name: "Spike pits",       cost: { scrap: 5, wood: 75 },             hours: 8,  max: 2, defence: true, tab: "defenses", size: "camp", desc: "Sharpened stakes in covered pits on the approach. The next horde to attack loses 7% + 4 of the dead per pit before it reaches the walls and fills the pits with its dead (dig them again). Raiders fall in too: a raid loses a raider half the time a pit, and the pits stay. On the battle map the pits are in the approach: the dead are hurt and blunder on, raiders and anyone else not of yours are hurt and stopped in the pit; your own people know where they are." },
  // Barbed wire (wire.js, the user's request 2026-10-19): a fence of wire on the approach that slows everyone, the
  // living too, until it is cut with a multitool or another tool that cuts wire.
  barbed_wire:  { name: "Barbed wire fence", cost: { scrap: 5 },            hours: 6,  max: 2, defence: true, tab: "defenses", size: "camp", desc: "Barbed wire strung on stakes across the approach: the base holds back 6% more of a horde a line and counts more against raiders. On the battle map it is a line of wire outside the wall (in front of the yard without one): the dead that reach it lose the rest of their turn, and people are snagged (the rest of their turn and a few cuts) unless they carry something to cut it with (a multitool, a field repair kit's pliers, an axe, a hatchet or a machete), which cuts a way through instead. Anyone of yours with a cutter can Cut wire next to them (1 action)." },
  sandbag_wall: { name: "Sandbag positions", cost: { scrap: 6 },            hours: 10, max: 3, defence: true, tab: "defenses", size: "shelter", desc: "Sandbagged fighting positions in the yard: the base holds back 5% more of a horde each and counts more against raiders, and on the battle map they are 4 cells of sandbags (cover) behind the wall or across the yard." },
  // Trenches (the user's request 2026-10-19: "trenches, which can slow down zombies more than humans"): any base, two
  // lines at most (one at a camp or a shelter). On the battle map the dead that drop in lose the rest of their turn;
  // the living climb out for one action (combat.js moveAlong, TRENCH_AP).
  trench:       { name: "Trench and stakes", cost: { scrap: 10, wood: 100 },           hours: 30, max: 2, defence: true, tab: "defenses", size: "camp", desc: "A ditch with stakes in the bottom round the base: the base holds back 25% more of a horde (the second line 12% more). On the battle map a line of trench in front of the wall (in front of the yard without one): the dead that drop in lose the rest of their turn, while the living only lose an action climbing out, so it slows the dead far more than raiders. Two lines at most (one at a camp or a shelter)." },
  gate:         { name: "Reinforced gate",  cost: { scrap: 14, parts: 1 },  hours: 20, max: 1, defence: true, tab: "defenses", size: "outpost", desc: "Steel plate and a bar on the gate: the base holds back 20% more of a horde, the gate has 180 hit points instead of 100 on the battle map, plus two more barricades there. Needs walls to matter; a Wallbreaker smashes it when no barricade is left." },
  floodlights:  { name: "Floodlights",      cost: { scrap: 8, parts: 2 },   hours: 12, max: 1, defence: true, tab: "defenses", size: "outpost", desc: "Work lights on the walls. Burns 2 fuel when a horde attacks: the base holds back 10% more, and defenders aim better on the battle map (+10 at night, +4 by day). No fuel, no lights." },
  razor_wire:   { name: "Concertina wire",  cost: { scrap: 12, parts: 1 },  hours: 12, max: 1, defence: true, tab: "defenses", size: "outpost", desc: "Coils of razor wire further out than the barbed wire: the base holds back 10% more of a horde and counts more against raiders. On the battle map a line of razor wire: it stops the dead for the turn and cuts them, and snags people worse than barbed wire (more cuts) unless they carry a cutter. Cut wire (1 action) clears a cell of it too." },
  // Land mines (mines.js, the user's request 2026-10-19): the main base's own; MINES.PER mines a field (b.mines), spent
  // as they go off and the field gone when it is empty.
  minefield:    { name: "Minefield",        cost: { scrap: 20, parts: 3, fuel: 6 }, hours: 24, max: 2, defence: true, tab: "defenses", size: "hub", req: { mechanics: 4 }, desc: "Twelve improvised mines (fuel and scrap in pipe casings, pressure plates) buried in the open ground the attackers cross. A horde sets some off on the way in (each takes about 2 of the dead), a raid loses a raider or two to them, and while mines are left the base counts more against raiders. On the battle map they are hidden in the approach: anyone who is not one of yours steps on one and it goes off like a pipe bomb; your own people know where they are and step round them. Mines that go off are spent; an empty field is cleared away (build it again). Main base only; needs a Mechanics 4+ survivor here to build." },
  guard_towers: { name: "Guard towers",     cost: { scrap: 30, parts: 2 },  hours: 36, max: 1, defence: true, tab: "defenses", size: "hub", req: { mechanics: 2 }, needsWall: true, desc: "Two raised gun towers on the wall midway along it: the base holds back 8% more of a horde and counts more against raiders. On the battle map two more towers on the walkway (height 2: full cover from anything not right next to them, +10 aim at anything lower). Needs a wall to stand on and a Mechanics 2+ survivor here to build." },
  // Hiding a base (hiding.js): netting and brush over the roofs and the yard, the paths kept off. Concealment + HIDE.CAMO.
  camo:         { name: "Camouflage netting", cost: { scrap: 10, parts: 1 }, hours: 16, max: 1, tab: "defenses", size: "outpost", desc: "Netting, brush and dull paint over the roofs and the yard, and the paths kept off the open ground: the base is harder to find (concealment +25%: the groups' scouts and passing parties miss it more often, and a base they have not seen for a month may slip out of what they know). See the base's Defence tab." },
  watchtower:   { name: "Watchtower",     plot: "utility", cost: { scrap: 12, wood: 150 },            hours: 18, max: 1, tab: "defenses", size: "shelter", desc: "+2 tiles of live vision around this base. Lookouts warn of raids sooner. On the battle maps it is two towers (height 2): full cover from anything not right next to them, +10 aim at anything lower and +4 sight, the widest view." },
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
  storehouse:   { name: "Storehouse",     plot: "building", cost: { scrap: 18 },            hours: 24, max: 1, storeKg: STORE_KG.storehouse, desc: "Locked store: holds 2000 kg of the base's goods, +150 days of food room at room temperature (fresh food keeps its own shelf life here, a little better in the cold), and raiders steal half as much from this base." },
  // Storage buildings (STORE_KG, basestorage.js): room for the base's goods; what does not fit lies outside.
  shed:         { name: "Storage shed",   plot: "building", cost: { scrap: 10, wood: 100, buildmat: 1 }, hours: 12, max: 4, storeKg: STORE_KG.shed, desc: "A plank shed with a tin roof and a padlock: holds 600 kg of the base's goods out of the weather. Goods past a base's storage lie outside, where things wear and raiders help themselves." },
  warehouse:    { name: "Warehouse",      plot: "building", cost: { scrap: 40, buildmat: 4, parts: 1 }, hours: 48, max: 2, req: { mechanics: 2 }, size: "outpost", storeKg: STORE_KG.warehouse, desc: "A steel-framed hall with a roller door and racking: holds 6000 kg of the base's goods. An outpost or the main base only; needs a Mechanics 2+ survivor here to build." },
  // The armory (2026-10-19, the user's requests): a locked gun room. On the base map (basemap.js armoryCells) it is a
  // windowless block with one locked security door raiders batter down (your people go in and out), and inside it two
  // locked containers, the gun cage with every item of the base's armory and the ammo lockers with its rounds and
  // arrows, in place of those things spread over the stores; a raider who reaches one batters the lock open first
  // (ARMORY_LOCK: several turns, loud, quicker with a pry tool) before anything can be taken. A door or lock battered
  // open wears the armory as a fixture (breakdowns.js: smashed locks, repaired after the fight). An outpost or the main
  // base (size: a building plot). By the numbers (arsenal.js raidOnBase) it halves the fighting gear a raid carries off.
  armory:       { name: "Armory",         plot: "building", cost: { scrap: 20, parts: 1 }, hours: 24, max: 1, size: "outpost", storeKg: STORE_KG.armory, desc: "A locked gun room: a windowless block with a steel security door, a gun cage and padlocked ammo lockers: holds 400 kg of the base's goods. On the base map the base's weapons, armour, magazines and the rest of its armory are kept in the gun cage, and its rounds and arrows in the ammo lockers, both inside and both locked. Raiders have to batter the security door down to get in (your own people come and go through it), and then batter a lock open (several turns, loud; a crowbar, a fire axe or a sledgehammer makes shorter work of it) before anything can be taken, so the defenders have time to stop them. Smashed locks are repaired after the fight. A raid settled by the numbers carries off half as much of the armory's fighting gear." },
  // Water and food keeping (economy.js WATER, spoilRate; farming.js greenhouse plots).
  well:         { name: "Well",           plot: "utility", cost: { scrap: 15, parts: 1 },  hours: 24, max: 2, desc: "+6 water a day (less in a dry spell). Fills the base up to its water capacity." },
  rain_catcher: { name: "Rain catcher",   plot: "utility", cost: { scrap: 5 },             hours: 8,  max: 4, desc: "Tarps and barrels: +2 water per unit of rain (about 4–7 on a wet day, up to 12 in a storm, nothing when dry)." },
  cistern:      { name: "Cistern",        plot: "building", cost: { scrap: 25 },            hours: 30, max: 3, desc: "+150 water capacity (the hub holds 80 without one, an outpost 40)." },
  // The worm (worm.js): heat kills its eggs. The boiler makes a base's ground water safe; the cook fire its game.
  boiler:       { name: "Water boiler",   plot: "utility", cost: { scrap: 10 },            hours: 10, max: 1, desc: "A drum over a fire pit: everything this base draws from its well, springs and streams is boiled before it is drunk, so the worm's eggs in infected ground water die. Burns 6 wood (0.6 kg) a day for every person fed here, in every season, on days un-purified water would be drunk and no water filter here covers it: wood first, then cheap wooden, paper and cloth junk from the armory (novels, magazines, rag boots; anything you mark to burn; never weapons, tools or armour) while the base allows it, then fuel (0.04 a head). A day with nothing to burn it stays cold: the filters, then the armory's purification tablets, else the water is drunk unboiled. A water filter does the same job for nothing, as long as it lasts." },
  // Food storage (storage.js): room for fresh food; food above the room is stored outside and spoils fast.
  cellar:       { name: "Root cellar",    plot: "building", cost: { scrap: 15 },            hours: 20, max: 2, storeKg: STORE_KG.cellar, desc: "Holds 400 kg of the base's goods. +200 days of food room underground: fresh food keeps about three times as long in a root cellar (0.35× its shelf a day: potatoes for months). The hub already has a small cellar (200), an outpost only a pantry (40); fresh food above the room is stored outside and spoils faster (1.5×, more in heat and rain). Canned, dry and preserved food needs no room." },
  // An ice house (machines-2, the user's pick: no power, no summer bonus).
  coldstore:    { name: "Cold store",     plot: "building", cost: { scrap: 20 },            hours: 24, max: 1, storeKg: STORE_KG.coldstore, desc: "Holds 300 kg of the base's goods. An ice house packed with ice and snow: +150 days of food room, the best there is in winter (fresh food at 0.15–0.3× its shelf a day), still good in spring and autumn (0.6×), little better than a pantry in summer once the ice is gone (0.9×)." },
  // The Preserving room (key "kitchen" in saves): jars food. The Kitchen that cooks the meals is "canteen" below
  // (kitchen.js).
  kitchen:      { name: "Preserving room", plot: "building", cost: { scrap: 18, parts: 1 }, hours: 24, max: 2, station: "preserve", desc: "Workshop station. One operator jars fresh food: 9 days of fresh food (what spoils soonest) + 3 water + 1 scrap + 4 empty jars → 8 portions of jarred food a day (9 with Farming 8+). Jarred food keeps a year and a half and needs no cold room; jars are found in kitchens, shops and farms, and most come back when the food is eaten here. Can be fitted with a pressure canner where it stands (Construction): +1 portion a day." },
  // The pressure canner (machines-2 2026-10-10, the user's pick: an upgrade of the preserving room where it stands,
  // as the ammo bench is upgraded into a reloading bench; it was a crafted armory item). Never a building of its own
  // (upgradeOnly, from: "kitchen"): the job fits it to one kitchen (job.target) and that kitchen is marked (b.canner);
  // the key stays "kitchen" for everything that counts kitchens. CANNER below: +1 portion of jarred food a day from that
  // kitchen; the kitchen then wears like a machine (breakdowns.js FIXTURES.canner: repairs take a machine part, a spare
  // part every 30 days it runs). Cost: the old recipe's 4 scrap and 2 parts plus 2 scrap of fittings, 12 work-hours
  // (it was 10 crafting hours), Mechanics 3 as before; a canner item from an old save fits one for nothing (CANNER.item).
  canner:       { name: "Pressure canner", plot: "building", cost: { scrap: 6, parts: 2 }, hours: 12, max: 2, from: "kitchen", upgradeOnly: true, req: { mechanics: 3 }, machine: true,
                  desc: "A heavy pot with a locking lid, a gauge and a relief valve, bolted into a preserving room: it jars under pressure in bigger batches, +1 portion of jarred food a day from that kitchen. Fitted to a preserving room where it stands (Construction): 6 scrap, 2 machine parts, 12 work-hours, a Mechanics 3+ survivor here (a pressure canner kept in the armory is fitted for nothing). The kitchen then wears like a machine: its repairs take a machine part, and it uses a spare part about every 30 days it runs." },
  // Hunting (hunting.js): the land around the base, hunted by the people on the Hunt job.
  huntcabin:    { name: "Hunting cabin",  plot: "building", cost: { scrap: 10, wood: 125 },            hours: 16, max: 1, desc: "A skinning shed, a smoke house and game trails around it. Any base can put people on the Hunt job (they hunt its own tile and the tiles next to it, where game is shy of the walls); the cabin widens the hunting grounds to the land within 2 tiles. The land runs out of game if hunted hard (it grows back over weeks). Smokes up to 6 days of raw meat and fish a day into 5 of jerky and smoked fish, and raw meat hung here keeps longer (0.6×). Needs game land within 2 tiles (forest, hills, farmland)." },
  cookhouse:    { name: "Cook fire",      plot: "utility", cost: { scrap: 6 },             hours: 6,  max: 1, desc: "A stone-lined fire pit with spits and a big pot: all the game and fish eaten here is cooked through, and the greens, roots and crops from infected ground are boiled, which kills the worm's eggs in meat from infected land and infested animals and in food grown or gathered on land at 40%+ infection. Without it (or a preserving room, or a Kitchen, which does all of this) that food waits in the stores and is eaten raw, last, when the clean food is gone. It takes cooking bills too (the Farming tab's Cooking: simple meals, stew, pemmican; flour, ground meat and sausage with a mill or grinder): whoever cooks best at home tends it 4 hours a day, burning 1 wood an hour." },
  // The Kitchen (kitchen.js KITCHEN): meals cooked for the base by the people on the Cook job. A step up from the cook fire
  // (it cooks everything the cook fire does, so a base with one needs no cook fire). Priced as the Preserving room and
  // the storehouse (18 scrap, a part, 24 work-hours): a mid-game building plot for a base of 8 or more.
  canteen:      { name: "Kitchen",        plot: "building", cost: { scrap: 20, parts: 1 }, hours: 24, max: 1, desc: "Stoves, a big pot and long tables: the base's meals cooked by the people on the Cook job, one cook for every 12 people living here (breakfast 06:00, dinner 20:00). Hot meals stretch the food: everyone fed at the kitchen eats 10% less a day (up to 13% with a good cook: +0.5% a Cooking point above 4), +1 mood a day (+1.5 with a Cooking 6+ cook; only the Kitchen serves hot meals), and a quarter of the day's drinking water is boiled for the meals. The stove burns firewood: 4 a day, and 1 a meal (two a day for everyone fed: 28 a day, 2.8 kg, for 12 people), after the water boiler's and the heating's day; without it the meals are cold (nothing saved, no mood). With too few cooks only that share of the people get hot meals. Like a cook fire, all the game, fish and greens from infected land are cooked through (the worm) while the stove is lit, cook or no cook. Its cooks work the Kitchen's bills (the Farming tab's Cooking: simple, fine and lavish meals, stew, pemmican, bread, sausage, survival meals with a vacuum sealer): meals more filling than their raw makings, each with its purified water, and a chance of food poisoning from a poor cook or a dirty kitchen. A new Kitchen starts with Simple meal until 2 days of eating. No cook: the food is eaten as before." },
  smoker:       { name: "Drying rack",    plot: "utility", cost: { scrap: 5, wood: 75 },             hours: 8,  max: 3, desc: "Racks and a smoke pit, no operator: dries 4 days of surplus fresh food into 3 days of jerky, smoked fish or dried fruit and veg a day (half on wet days), raw meat first. Takes food stored outside first, else only fresh food above 15 days of eating." },
  // Power (power.js): generators need fuel, a daily refuelling and repairs, no operator (machines-2); the still turns
  // fresh food into that fuel. This is tier 1 (power.js GEN_TIERS: the portable set); tiers 2 and 3 are upgrades where it
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
  freezer:      { name: "Walk-in freezer", plot: "building", cost: { scrap: 30, parts: 5, electronics: 2 }, hours: 40, max: 2, req: { mechanics: 3 }, machine: true, storeKg: STORE_KG.freezer,
                  desc: "Holds 300 kg of the base's goods. An insulated room with a compressor: +300 food storage room, and while it has power the food in it keeps about twenty times longer than in a cellar. Draws 2 power every day from a running generator (Power card, Workshops tab); with no power, no fuel for the generator or a breakdown it is off and warms up, and the food in it keeps only as in a pantry. Wears like a machine: breakdowns need machine parts and a Mechanics 3+ survivor to fix, and it uses a spare part about every 12 days it runs. Needs a Mechanics 3+ survivor here to build." },
  // The vacuum sealer (freezer-parts 2026-10-10, the user's pick): a powered packing machine on a utility plot, no
  // operator (like the freezer it is a power user, not a workshop station). Wave 2 cooking makes packaged survival
  // meals with it (cooking.js COOK_RECIPES.survival, needs: "sealer" → power.js hasSealer). 12 scrap, 2 machine parts, 2 electronics (the heat bar and its
  // controls), 16 work-hours, Mechanics 3; draws 1 power while switched on; wears 0.5 a day while powered.
  sealer:       { name: "Vacuum sealer",  plot: "utility", cost: { scrap: 12, parts: 2, electronics: 2 }, hours: 16, max: 1, req: { mechanics: 3 }, machine: true,
                  desc: "A chamber vacuum sealer with a heat bar, bolted to a steel table: the Kitchen's cooks pack cooked food into light survival meals that keep ten years (a Survival meal bill, Cooking 4). Draws 1 power while switched on (Power card, Workshops tab; switch it off to save fuel while it has no work). Wears like a machine: breakdowns need machine parts and a Mechanics 2+ survivor to fix. Needs a Mechanics 3+ survivor here to build." },
  // Wave 2 cooking (cooking.js, the freezer list's pick): hand-cranked machines for the cooking stations, no power and
  // no operator of their own (the cooks turn them as part of a bill: flour, ground meat, sausage). Cheap in machine
  // parts (one each), Mechanics 1 to bolt down; they wear on the days they turn (breakdowns.js FIXTURES, ranDay: b.ran).
  // The hook crafting.js left (TODO food-types: a grain mill, a meat grinder) is these two.
  grainmill:    { name: "Grain mill",     plot: "utility", cost: { scrap: 8, parts: 1 },  hours: 8,  max: 1, req: { mechanics: 1 }, machine: true,
                  desc: "A hand-cranked burr mill bolted to a bench: the cooks grind grain into flour (a Flour bill at the Kitchen or a cook fire), and flour makes bread in the Kitchen. No power. Wears on the days it turns: repairs take a machine part. Needs a Mechanics 1+ survivor here to build." },
  meatgrinder:  { name: "Meat grinder",   plot: "utility", cost: { scrap: 5, parts: 1 },  hours: 6,  max: 1, req: { mechanics: 1 }, machine: true,
                  desc: "A cast-iron hand grinder and a stuffing horn: the cooks grind tough game into ground meat, and ground meat into smoked sausage that keeps for months (bills at the Kitchen or a cook fire). No power. Wears on the days it turns: repairs take a machine part. Needs a Mechanics 1+ survivor here to build." },
  still:        { name: "Ethanol still",  plot: "utility", cost: { scrap: 15, parts: 2 },  hours: 24, max: 1, station: "still", desc: "Workshop station. One operator ferments and distils 8 days of fresh food + 2 water into 3 fuel a day (the soonest to spoil goes in). Set a Keep-at-least order so it only takes the surplus." },
  greenhouse:   { name: "Greenhouse",     plot: "building", cost: { scrap: 20, parts: 3 },  hours: 36, max: 2, desc: "+2 sheltered crop plots: grow in every season (winter too), stand 10 °C more cold, and the weather rarely harms them." },
  // Mood (relations.js moodFactors): no operator needed.
  common_room:  { name: "Common room",    plot: "building", cost: { scrap: 22 },            hours: 30, max: 2, desc: "Chairs, a stove and a card table: +1.5 mood a day for everyone living here, up to 15 people a room (spread thinner above that). No operator." },
  // farming.js PEN (2026-10-09, the progression picks): food a guarded base grows on its own land, in winter too.
  animal_pen:   { name: "Animal pen",     plot: "building", cost: { scrap: 12, wood: 125 },            hours: 20, max: 2, station: "livestock", desc: "Hens and a few goats behind a fence. Workshop station: a keeper (Farming) gets 3 fresh food a day from them (eggs and milk; 4 with Farming 6+) for 1 water, in every season (three quarters of it in winter, on stored hay). The animals graze 2 of the base's outdoor crop plots (2 fewer plots for each pen). Without walls standing at the base they stray and the dead take some: half the food." },
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
  // Storage crates (storage.js storeSpaces): a little dry room for food, outdoors; and room for goods (basestorage.js).
  crates:       { name: "Storage crates", plot: "utility", cost: { scrap: 3, wood: 50 },  hours: 5,  max: 4, storeKg: STORE_KG.crates, desc: "Stacked, lidded crates under a tarp: holds 150 kg of the base's goods, and +30 days of food room at room temperature." },
  // The storage box (basestorage.js): the first storage a camp makes. No plot (it stands anywhere in the yard, like the cots).
  storebox:     { name: "Storage box",    cost: { scrap: 1, wood: 50 }, hours: 2, max: 6, storeKg: STORE_KG.storebox, desc: "A lidded box knocked together from scrap, under a tarp: holds 60 kg of the base's goods. A camp starts with no storage (a parked vehicle's load space counts while it is here); goods past the room lie outside, where things wear and raiders help themselves. Needs no plot." },
  // General buildings (base building, the user's request 2026-10-19: "different sized general buildings that you can
  // build things inside such as workbenches, beds, storage, kitchen etc."; basemap.js FOOT general / plain): empty
  // shells of some size on the base map, no plot (the map is the limit), whose indoor cells take the fittings below and
  // the yard's indoor props (benches, crates, the relay…). size: the smallest kind of base that puts one up (a camp a
  // hut, a shelter a cabin, an outpost a lodge or a hall, the main base a barn). Priced by the floor: a hut (a 2 × 2
  // floor) at a farm plot's scrap, a cabin (3 × 2) under a bunkhouse, a lodge (4 × 3) a bunkhouse and a part, a hall
  // (6 × 4) two bunkhouses, a barn (8 × 5) three.
  gen_hut:      { name: "Hut",            general: true, size: "camp",    cost: { scrap: 8, wood: 100 },           hours: 14, max: 6, desc: "A 4 × 4 shack of scrap and timber with one door: 2 × 2 of floor inside for bunk beds and a stove, or a bench. No plot: it stands wherever it is placed on the base map (Base map tab, Build). Lockers, shelves, beds and benches are built inside it; a hut right against another building can share a doorway with it." },
  gen_cabin:    { name: "Cabin",          general: true, size: "shelter", cost: { scrap: 13, wood: 150 },           hours: 20, max: 6, desc: "A 5 × 4 cabin with a front and a back door: 3 × 2 of floor inside for bunks, shelves, a stove or a bench. No plot: it stands wherever it is placed on the base map, and right against another building it can share a doorway with it." },
  gen_lodge:    { name: "Lodge",          general: true, size: "outpost", cost: { scrap: 22, wood: 200, parts: 1 }, hours: 30, max: 4, desc: "A 6 × 5 lodge with two doors: 4 × 3 of floor inside for bunks, lockers, shelves, a stove and benches. No plot: it stands wherever it is placed on the base map, and right against another building it can share a doorway with it." },
  gen_hall:     { name: "Hall",           general: true, size: "outpost", cost: { scrap: 34, wood: 300, parts: 2 }, hours: 44, max: 3, desc: "An 8 × 6 hall with two doors: 6 × 4 of floor inside, room for a whole barracks' worth of bunks, or the workshop's benches under one roof. No plot: it stands wherever it is placed on the base map, and right against another building it can share a doorway with it." },
  gen_barn:     { name: "Barn",           general: true, size: "hub",     cost: { scrap: 50, wood: 500, parts: 3 }, hours: 60, max: 2, desc: "A 10 × 7 barn with two doors: 8 × 5 of floor inside, the biggest roof the base puts up: storage shelves and lockers by the dozen, or bunks for twenty. No plot: it stands wherever it is placed on the base map, and right against another building it can share a doorway with it. Main base only." },
  // Fittings (fit: true; basemap.js FOOT fit): built only inside a standing general building, on its floor (placed
  // there on the base map; the game puts one in the first building with room). A fitting keeps its host's id (host).
  // bunks: +2 beds each (BEDS). shelves and lockers: storage for the base's goods (storeKg, basestorage.js: 150 kg and
  // 100 kg; containers.js assigns goods to them, gear leaning to the lockers) and a store on the map in a raid. stove: a cook fire indoors (as: "cookhouse": it
  // counts as one wherever count(base, "cookhouse") is read).
  // A tent (TENTS; the user's rules 2026-10-20): the one buildable is the Makeshift tent, poles cut from the wood and a
  // scrap tarp lashed over them, 1 × 2 on the base map's open ground: one sleeper, no storage, and a poor night's sleep
  // (TENTS.makeshift.mood). Proper tents come from tent bags (pitchTent / strikeTent). Its record: { type: "tent",
  // tent: the kind } (addBuilding: a makeshift one).
  tent:         { name: "Makeshift tent", size: "camp", cost: { wood: 40, scrap: 1 }, hours: 2, max: 16, desc: "Cut poles and a scrap tarp lashed over them, 1 × 2 on the base map's open ground (clear the land first): a place for one to sleep, but not a good one (mood −1 a day for whoever sleeps in it). Proper tents are pitched from tent bags." },
  // Clearing the land (the user's requests 2026-10-20: "Trees in the base map can be chopped down for wood", "Tree
  // chopping takes time and works like a construction progress tile", "every scatter piece blocks building until
  // cleared"): one job in the construction queue a piece of the base map's land (basescatter.js CLEAR: its hours and
  // what it gives), worked by the builders like a building; the yield arrives when it is done (finishClear). Never built
  // from a list: queued from the base map (a piece's card, a red site clicked) or by the game for a site it placed.
  clear:        { name: "Clearing", cost: {}, hours: 1, max: 100000, hidden: true, clear: true, desc: "Clearing the land on the base map: felling a tree, digging out a stump, dragging off a wreck. Queued from the base map." },
  bunks:        { name: "Bunk beds",      fit: true, cost: { scrap: 4, wood: 50 }, hours: 4, max: 24, desc: "A pair of bunks of scrap tubing and planks, 2 × 1 on the floor of a hut, cabin, lodge, hall or barn: +2 beds each. Overcrowding lowers mood every day." },
  shelves:      { name: "Storage shelves", fit: true, cost: { scrap: 3, wood: 50 }, hours: 4, max: 24, storeKg: STORE_KG.shelves, desc: "Shelving of planks and angle iron, 2 × 1 on the floor of a general building: holds 150 kg of the base's goods (Storage tab), kept under a roof. In a raid it is a store on the map that raiders go for once they are past the wall." },
  lockers:      { name: "Lockers",        fit: true, cost: { scrap: 6 }, hours: 5, max: 12, storeKg: STORE_KG.lockers, desc: "A steel locker, 1 × 1 on the floor of a general building: holds 100 kg of the base's goods, where the gear goes first (Storage tab). In a raid it is a store on the map." },
  stove:        { name: "Wood stove",     fit: true, as: "cookhouse", cost: { scrap: 8 }, hours: 8, max: 4, desc: "A drum stove with a flue, 1 × 1 on the floor of a general building: a cook fire indoors. It counts as a cook fire (all the game and fish eaten here cooked through, the infected land's greens and roots boiled), so a base with one needs no fire pit in the yard." },
  // Base tiers (staging.js): a shelter (tier 0) is built up into a base (the hub, tier 1) by its builders. Not a
  // building: when it is done the shelter becomes a full hub (upgradeShelter).
  // gather (2026-10-09, user pick): as the outpost camp's, its materials are taken from the stores as they come in.
  // User numbers 2026-10-09: "Upgrading to base 60 hours 100 scrap 5 building materials".
  hub_up:       { name: "Build up into a base", cost: { scrap: 100, buildmat: 5 }, hours: 60, max: 1, shelterOnly: true, hubOnly: true, tierUp: true, gather: true,
                  desc: "Turn the shelter into a real base: a main house, a dug well (12 water a day), a cellar, beds for four, 16 building plots and 14 utility plots. A wall it keeps as it stands (Construction, Defenses: upgrade it there). Shelters only. The materials are taken from the stores as they come in; the builders here do the work, never more of it than the materials delivered allow." },
  // An outpost camp (2026-10-09, user request: "When starting a base it should start as a camp with a progress bar with
  // needed items to upgrade to a more permanent base established"): Build outpost sets up a camp (tier 0, a shelter's
  // rules) and queues this at once. gather: the materials are not paid up front; the job takes them from the camp's
  // stores as they come in (teams, supply runs), and the work never runs ahead of the share delivered (gatherHour).
  // Done: an outpost as before (its spring, 6 + 6 plots; no wall it did not build: the Defenses tab). Not queued by hand: a camp has it from the start.
  // User numbers 2026-10-09: "Upgrading to Outpost 20 hours 20 scrap 2 building materials".
  // A camp (2026-10-09, user request: "Make camps a pseudo temp base that can be upgraded to bases with time and
  // supplies but is the most barebones"; any team, anywhere: Set up camp, staging.js) built up into a shelter: the camp
  // that is your hub (your first home, the exiles' new one). The old staging camp's numbers (user numbers 2026-10-09,
  // "upgrading to shelter 20 hours 20 scrap 2 building materials"); 10 scrap less on ruins (job.cost, tierUpJobFor).
  camp_up:      { name: "Build up into a shelter", cost: { scrap: 20, buildmat: 2 }, hours: 20, max: 1, campOnly: true, hubOnly: true, tierUp: true, gather: true,
                  desc: "Turn the camp into a shelter: a shack with a roof behind a scrap barricade, beds for four, a building plot, three utility plots and two crop plots; later the shelter is built up into a base. The materials are taken from the camp's stores as they come in; the builders here do the work, never more of it than the materials delivered allow." },
  outpost_up:   { name: "Establish the outpost", cost: { scrap: 20, buildmat: 2 }, hours: 20, max: 1, shelterOnly: true, outpostOnly: true, tierUp: true, gather: true,
                  desc: "Turn the outpost camp into a real outpost: a shack with a roof, a dug spring (3 water a day), 6 building plots and 6 utility plots (walls are built on the Defenses tab). The materials are taken from the camp's stores as they come in (bring them with a team or a supply run); the builders here do the work, never more of it than the materials delivered allow." },
};
Object.assign(BUILDINGS, BED_BUILDINGS); // beds as furniture (data-beds.js, beds.js): set from the stores inside a general building, never queued

// ---------- construction plots ----------
// Every building stands on a plot, by the size of the base: building plots for anything with a roof (bunkhouses,
// the storehouse, cellars, workshops, the hospital), utility plots for the small things in the yard (the boiler, water
// barrels, storage crates, the watchtower, the cook fire, rain catchers, benches). Walls, defences and farm plots need
// no plot. A hospital takes one building plot whatever its tier (an upgrade replaces it in place), and a water
// barrel's upgrades stay on its plot. Demolishing frees the plot (demolish below).
// User numbers 2026-10-12: a camp 2 utility plots; a shelter 1 building plot and 3 utility plots.
export const PLOTS = {
  camp:    { building: 0, utility: 2 },
  shelter: { building: 1, utility: 3 },
  outpost: { building: 6, utility: 6 },
  hub:     { building: 16, utility: 14 },
};
export const PLOT_NAMES = { building: "Building plot", utility: "Utility plot" };
export const plotSize = (base) => (isCamp(base) ? "camp" : isShelter(base) ? "shelter" : base.type === "hub" ? "hub" : "outpost");
export const plotCap = (base, kind) => PLOTS[plotSize(base)][kind] || 0;
// Crop plots each kind of base starts with (user numbers 2026-10-12): a camp 1, a shelter 2, an outpost 4, the main
// base 8; +2 per Farm plot building, less the animal pens' pasture (farmSlots). The one table for farming.js too.
export const CROP_PLOTS = { camp: 1, shelter: 2, outpost: 4, hub: 8 };
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
export const jobName = (job) => (job.type === "clear" ? job.label || "Clearing" : job.type === "walls" ? ringJobName(job) : isPiece(job.type) ? pieceName({ type: job.type, mat: job.mat }) : JOBNAME_REST(job));
// The Ring wall's job: "Ring wall: 52 scrap-metal pieces" or "Upgrade the wall to scrap metal (12 pieces)".
const ringJobName = (job) => { const T = WALL_TIERS[matOf({ mat: job.mat || job.tier || 1 })]; const n = job.kind === "upgrade" ? (job.ids || []).length : (job.pieces || []).length; return job.kind === "upgrade" ? `Upgrade the wall to ${T.mat.toLowerCase()}${n ? ` (${n} pieces)` : ""}` : `Ring wall: ${n ? `${n} ` : ""}${T.mat.toLowerCase()} pieces`; };
const JOBNAME_REST = (job) => (job.target && job.type === "generator" ? `Upgrade a generator to ${GEN_TIERS[job.tier] ? `a ${GEN_TIERS[job.tier].name.toLowerCase()}` : "the next tier"}` : job.target && job.type === "barracks" ? "Expand a bunkhouse into a barracks" : job.target && job.type === "reload_bench" ? "Upgrade an ammo bench into a reloading bench" : job.target && job.type === "canner" ? "Fit a pressure canner to a preserving room" : job.target ?`Upgrade to ${WATER_BARREL.tiers[job.tier] ? WATER_BARREL.tiers[job.tier].name.toLowerCase() : "the next tier"}` : BUILDINGS[job.type].name);

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
  if (b.type === "walls" && b.tier) { delete out.scrap; for (let t = 1; t <= wallTierOf(b); t++) add(WALL_TIERS[t].cost); } // WALL_TIERS: half of every tier it was built up through
  if (isPiece(b.type)) { for (const k of Object.keys(out)) delete out[k]; add(pieceCost(b.type, b.mat)); } // a wall piece: half of its material's cost
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
  if (BUILDINGS[b.type].furniture) return pickUpFurniture(state, base, b); // beds.js: back into the stores whole
  if (b.type === "tent" && TENTS[tentKind(b)].bag) { // a tent from a bag (tents.js): struck back into it, the bag into the stores
    const name = tentOf(b).name, bag = strikeTentAtBase(state, base, id);
    if (bag) base.armory.push(bag);
    log(state, `${name} at ${base.name} struck and packed into its bag (in the stores).`, "info");
    return `${name} struck: its bag is back in the stores.`;
  }
  const back = demolishRefund(b);
  // A general building (base building 2026-10-19) comes down with the fittings standing inside it, placed there by
  // hand (host) or by the game (basemap.js fittingsIn): their half back too, the ones queued for it cancelled and
  // refunded; the benches and crates that stood inside go back to the yard (the game places them until they are
  // placed by hand again).
  const inside = [];
  if (BUILDINGS[b.type].general) {
    const down = new Set();
    for (const f of fittingsIn(state, base, id)) { if (f.key.startsWith("c:")) cancelBuild(state, base, f.rec.id); else down.add(f.rec); }
    for (const x of base.buildings) if (x.host === id && BUILDINGS[x.type] && BUILDINGS[x.type].fit) down.add(x);
    for (const f of down) {
      if (BUILDINGS[f.type].furniture) { pickUpFurniture(state, base, f); inside.push(`${BUILDINGS[f.type].name.toLowerCase()} (carried out into the stores)`); continue; } // beds.js: furniture is carried out, whole
      for (const [k, v] of Object.entries(demolishRefund(f))) back[k] = (back[k] || 0) + v;
      base.buildings.splice(base.buildings.indexOf(f), 1);
      inside.push(BUILDINGS[f.type].name.toLowerCase());
    }
    for (const x of base.buildings) if (x.host === id) { delete x.host; delete x.at; }
    for (const c of base.construction.slice()) if (c.host === id) { if (BUILDINGS[c.type] && BUILDINGS[c.type].fit) cancelBuild(state, base, c.id); else { delete c.host; delete c.at; } }
  }
  base.buildings.splice(base.buildings.indexOf(b), 1);
  for (const [k, v] of Object.entries(back)) base.stock[k] = (base.stock[k] || 0) + v;
  if (b.type === "radio") base.radio = count(base, "radio") > 0;
  if (b.type === "watchtower") base.watchtower = count(base, "watchtower") > 0;
  for (const s of atBase(state, base.id)) if (s.station === b.id) s.station = null;
  assignStations(state, base);
  const name = b.type === "water_barrel" ? barrelName(b) : b.type === "generator" ? genName(b) : b.type === "walls" || isPiece(b.type) ? wallName(b) : BUILDINGS[b.type].name;
  const got = Object.entries(back).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${keyWord(k)}`).join(", ");
  const counted = [...inside.reduce((m, n) => m.set(n, (m.get(n) || 0) + 1), new Map())].map(([n, q]) => (q > 1 ? `${q} × ${n}` : `the ${n}`));
  const withIn = counted.length ? ` with ${counted.length > 1 ? `${counted.slice(0, -1).join(", ")} and ${counted[counted.length - 1]}` : counted[0]} inside it` : "";
  log(state, `${name} at ${base.name} pulled down${withIn}${got ? ` (${got} salvaged)` : ""}.`, "info");
  return `${name} pulled down${withIn}${got ? `: ${got} salvaged` : ""}.${BUILDINGS[b.type].plot ? " Its plot is free." : ""}`;
}

// ---------- base tiers ----------
// Your bases grow in three stages: a camp (tier 0 with camp: true, below) → a shelter (tier 0) → a base (tier 1,
// the hub as it always was; outposts are tier 1 too). A shelter is a base you can live at (stores, rest and healing,
// the armory, people with jobs), but small: tarps and a shack behind a scrap barricade, no wall strength, beds for
// four under the tarps, two crop plots, one tile of vision, no well of its own (water from a river or lake beside it, rain catchers,
// or what is brought in), and only a few survival buildings (SHELTER.build: max of each) on its three utility plots
// and one building plot (PLOTS.shelter). Its Heat comes from what it
// does (fieldheat.js shelterHeat: its fire, people, vehicles parked, shooting nearby) instead of the hub's flat 3.
// Saves from before the tiers have no tier field: tier 1.
// Wall pieces a camp or a shelter may have (as many as a ring round its yard takes, and some).
const PIECE_CAPS = { wall1: 400, wall2: 400, wall4: 400, gate4: 8, stand1: 60, stand2: 60, stand4: 60 };
export const SHELTER = {
  name: "Shelter",
  walls: 0, beds: 4, plots: 2, vision: 1, waterCap: 40, // plots: its crop plots (CROP_PLOTS.shelter)
  river: 10,          // water a day hauled from a river or lake beside it (no well yet; the people carry it)
  // What a shelter may build (the most of each): yard things on its 3 utility plots (PLOTS.shelter), one roofed
  // building on its building plot (a bunkhouse, a root cellar, a makeshift infirmary or a hunting cabin), a barricade,
  // a farm plot, the shelter's defences (the Defenses tab) and the step up.
  build: { rain_catcher: 2, smoker: 1, boiler: 1, cookhouse: 1, water_barrel: 2, crates: 2, storebox: 6, watchtower: 1, barricades: 2, trench: 1, farm_plot: 1, hub_up: 1, outpost_up: 1, craftbench: 1, lockup: 1, bunkhouse: 1, cellar: 1, infirmary: 1, huntcabin: 1, cots: 2,
    walls: 1, ...PIECE_CAPS, spike_pits: 2, barbed_wire: 2, sandbag_wall: 2, // the Defenses tab: walls, gates and stands up to a log palisade (WALL_TIERS), wire, pits, sandbags
    gen_hut: 2, gen_cabin: 1, bunks: 4, shelves: 4, stove: 1, tent: 8 }, // base building (2026-10-19): two huts or a cabin on the map, bunks, shelves and a stove inside them
};
export const isShelter = (base) => !!base && base.tier === 0;
export const baseTier = (base) => (isShelter(base) ? 0 : 1);
// ---------- the camp: the lowest tier ----------
// A camp (staging.js: Set up camp, any team anywhere; Establish base; Build outpost) is a tier-0 base with camp: true:
// everything a shelter is (isShelter: no well, no wall strength, a shelter's Heat and fire, base healing and needs),
// only barer. isCamp is the one test (keep camp checks to it). What it changes from a shelter:
//   beds       none of its own: its tents (TENTS, tentBeds; a Makeshift tent built, tents pitched from bags)
//   plots      PLOTS.camp: no building plot, two utility plots; one crop plot (CAMP.plots)
//   build      CAMP.build: a barricade, a rain catcher, crates or a barrel, a crafting bench, a water boiler, a cook
//              fire or a drying rack on its two plots, and the step up
//   step up    camp_up (the camp that is your hub → a shelter) or outpost_up (a camp beside a hub → an outpost);
//              queued by Establish base / Build outpost, by hand from Construction for a plain camp
//   materials  its builders make the building materials the step up waits for from scrap in its stores (campMaterialsHour)
//   rest       the hurt heal as in the old Camp order (medical.js: twice a base's rate without a hospital)
//   land       it holds only its own tile (factions.js recomputeOwnership) and counts for no victory
//   neglect    nobody there for STAGING.ABANDON days and it may be looted; empty and bare for STAGING.GONE days, gone
//   strike     Strike camp: its people form a team with what they can carry, the rest is left as a cache (staging.js)
export const CAMP = {
  name: "Camp",
  beds: 0, plots: 1, vision: 1, // plots: its crop plot (CROP_PLOTS.camp). beds: none of its own: its tents (TENTS, tentBeds); until one is up its people sleep rough (morale.js crowding)
  setupHours: 1,     // Set up camp: an hour of work, no materials (the materials come with the step up)
  // The yard things a camp may build (the most of each; they share its two utility plots). The crafting bench, the
  // water boiler, the cook fire and the drying rack (BASE-03, user request 2026-10-12): camps build them too. The camp's
  // defences (the Defenses tab, 2026-10-19): a stake fence (the wall's first tier), a spike pit, a line of barbed wire.
  build: { barricades: 1, rain_catcher: 1, crates: 1, storebox: 4, water_barrel: 1, craftbench: 1, boiler: 1, cookhouse: 1, smoker: 1, camp_up: 1, outpost_up: 1, walls: 1, ...PIECE_CAPS, spike_pits: 1, barbed_wire: 1, trench: 1, // the Defenses tab: a stake fence, a pit, a line of wire, a trench
    gen_hut: 1, bunks: 2, shelves: 2, stove: 1, tent: 8 }, // base building (2026-10-19): one hut on the map, bunks, shelves and a stove inside it
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
  baseUpgraded(state, base); // staging.js: its card, with Open the build map
}

// Working buildings of a type: a broken one (breakdowns.js) does nothing until it is repaired, and a building that
// stands in for another (BUILDINGS as: the wood stove as a cook fire) counts as that type. countAll: built, broken or
// not, the type itself only (the limits).
export const count = (base, type) => base.buildings.filter((b) => (b.type === type || (BUILDINGS[b.type] && BUILDINGS[b.type].as === type)) && !b.broken).length;
export const countAll = (base, type) => base.buildings.filter((b) => b.type === type).length;
// ---------- walls by tier (the user's request 2026-10-19) ----------
// The kinds of base by size, smallest first (DEF_SIZE): what a defence (BUILDINGS size) and a wall's tier need. An
// outpost never becomes the main base, so the main base's own tier (the concrete wall, the guard towers) stays its own.
export const DEF_SIZE = { camp: 0, shelter: 1, outpost: 2, hub: 3 };
export const DEF_SIZE_NAMES = { camp: "Camp", shelter: "Shelter", outpost: "Outpost", hub: "Main hub" };
const DEF_AT = { camp: "a camp", shelter: "a shelter", outpost: "an outpost or the main base", hub: "the main base" };
export const sizeRank = (base) => DEF_SIZE[plotSize(base)];
export const sizeFits = (base, size) => !size || sizeRank(base) >= DEF_SIZE[size];
export const opensAt = (size) => `Opens at ${DEF_AT[size]}`;
// Walls by material (the user's requests 2026-10-19): what a wall piece or a gate is made of, b.mat (1 to 4), picked
// when it is queued; the better the material, the more hit points a cell on the battle map and the more wall strength
// the ring gives (each point 2 defense against raids, factions.js baseDefense, and 18 more of a horde held back,
// defences.js wallHold). size: the smallest base that builds it (DEF_SIZE). cost / hours: a 1×4 section's (a 1×2 or a
// 1×1 pays its share, rounded up: pieceCost); gate: the 1×4 gate's; gateHp a gate cell's hit points.
//   1 Wooden wall      2 strength,  60 hp (gate  80)  8 wood a section, 2 work-hours        any base (a camp too)
//   2 Log palisade     4 strength, 100 hp (gate 110)  12 wood, 3 work-hours              a shelter and up
//   3 Scrap-metal wall 8 strength, 160 hp (gate 150)  2 scrap, 4 work-hours                   an outpost or the main base
//   4 Metal-sheet wall 12 strength, 240 hp (gate 200) 3 scrap, 1 building materials, 6 work-hours, Mechanics 3: the main base
// (A main hub's ring is about 52 sections and 4 gates: some 460 wood in wood, 120 scrap in scrap metal.)
// A piece damaged in a raid (wear 60+, breakdowns.js RAID_DAMAGE.damaged) counts WALL_DAMAGED of its strength and hit
// points; a broken one is a gap until it is repaired. A group's own wall (one "walls" building of a tier, their works:
// groupbases.js) reads the same table; a wall from before the tiers (no tier) counts LEGACY_WALL.
export const WALL_TIERS = [
  null,
  { key: "wood",  name: "Wooden wall",      gateName: "Wooden gate",      mat: "Wood",         strength: 2,  hp: 60,  gateHp: 80,  size: "camp",    cost: { wood: 8 },             gate: { wood: 12 },                    hours: 2, desc: "Planks nailed to posts sunk in the ground, sharpened along the top: cheap, and it keeps the dead back a while." },
  { key: "logs",  name: "Log palisade",     gateName: "Log gate",         mat: "Logs",         strength: 4,  hp: 100, gateHp: 110, size: "shelter", cost: { wood: 12 },            gate: { wood: 18, scrap: 1 },          hours: 3, desc: "Logs set upright in a ditch, lashed, pinned and spiked: a real wall." },
  { key: "scrap", name: "Scrap-metal wall", gateName: "Scrap-metal gate", mat: "Scrap metal",  strength: 8,  hp: 160, gateHp: 150, size: "outpost", cost: { scrap: 2 },            gate: { scrap: 4, parts: 1 },          hours: 4, desc: "Car doors, roofing and pallets welded and bolted onto steel posts." },
  { key: "sheet", name: "Metal-sheet wall", gateName: "Metal-sheet gate", mat: "Metal sheets", strength: 12, hp: 240, gateHp: 200, size: "hub",     cost: { scrap: 3, buildmat: 1 }, gate: { scrap: 6, buildmat: 2, parts: 1 }, hours: 6, req: { mechanics: 3 }, desc: "Overlapping steel sheets bolted to a welded frame on a concrete footing: the strongest wall there is." },
];
// A wall stand's cost and hours (a 1×4's; the smaller ones pay their share): no material, the same for every base.
export const STAND = { cost: { wood: 16, scrap: 1 }, hours: 2 };
export const WALL_DAMAGED = 2 / 3, LEGACY_WALL = 3;
// ---------- wall pieces ----------
export const isPiece = (type) => !!(BUILDINGS[type] && BUILDINGS[type].piece);
export const pieceKind = (type) => (BUILDINGS[type] ? BUILDINGS[type].piece || null : null); // "wall" | "gate" | "stand"
export const piecesOf = (base, kinds = null) => (base && base.buildings ? base.buildings.filter((b) => isPiece(b.type) && (!kinds || kinds.includes(BUILDINGS[b.type].piece))) : []);
export const matOf = (b) => Math.max(1, Math.min(WALL_TIERS.length - 1, Math.round((b && b.mat) || 1)));
// What a piece of a type and material costs and takes to build: the 1×4's cost (or the gate's) by its share, rounded up.
export function pieceCost(type, mat = 1) {
  const d = BUILDINGS[type];
  if (!d || !d.piece) return {};
  const T = WALL_TIERS[matOf({ mat })];
  const src = d.piece === "stand" ? STAND.cost : d.piece === "gate" ? T.gate : T.cost;
  const f = d.piece === "gate" ? 1 : d.len / 4;
  return Object.fromEntries(Object.entries(src).map(([k, v]) => [k, Math.max(1, Math.ceil(v * f))]));
}
export const pieceHours = (type, mat = 1) => { const d = BUILDINGS[type]; if (!d || !d.piece) return 0; return Math.round((d.piece === "stand" ? STAND.hours : WALL_TIERS[matOf({ mat })].hours) * (d.piece === "gate" ? 1.5 : d.len / 4) * 10) / 10; };
// "Scrap-metal wall 1×4", "Log gate", "Wall stand 1×2".
export function pieceName(b) {
  const d = b && BUILDINGS[b.type];
  if (!d || !d.piece) return d ? d.name : "Wall";
  if (d.piece === "stand") return d.name;
  const T = WALL_TIERS[matOf(b)];
  return d.piece === "gate" ? T.gateName : `${T.name} 1×${d.len}`;
}
// A piece's hit points a cell on the battle map: its material's (a gate's own), two thirds when damaged, nothing broken.
export const pieceHp = (b) => (!b || b.broken ? 0 : Math.round(WALL_TIERS[matOf(b)][pieceKind(b.type) === "gate" ? "gateHp" : "hp"] * ((b.wear || 0) >= 60 ? WALL_DAMAGED : 1)));
// ---------- a group's wall (one building of a tier) ----------
export const wallOf = (base) => (base && base.buildings ? base.buildings.find((b) => b.type === "walls") || null : null);
export const wallTierOf = (b) => (!b ? 0 : Math.max(1, Math.min(WALL_TIERS.length - 1, b.tier || 2))); // a sectioned wall from before the tiers: a palisade
export const wallName = (b) => (b && isPiece(b.type) ? pieceName(b) : b && WALL_TIERS[wallTierOf(b)] ? WALL_TIERS[wallTierOf(b)].name : "No wall");
// One wall building's strength: a stand-in base's own (b.str: fort.js assaultBase), its tier's, or a legacy section's.
const legacyPiece = (b) => (b.type !== "walls" || b.broken ? 0 : (b.str != null ? b.str : b.tier ? WALL_TIERS[wallTierOf(b)].strength : LEGACY_WALL) * ((b.wear || 0) >= 60 ? WALL_DAMAGED : 1));
const legacyTier = (base) => { const w = wallOf(base); return w && !w.broken && w.tier ? wallTierOf(w) : w && !w.broken ? Math.min(WALL_TIERS.length - 1, base.buildings.filter((b) => b.type === "walls" && !b.broken).length + 1) : 0; };
// ---------- the base's wall: its pieces (basemap.js wallInfo), or a group's one wall ----------
// Wall strength: the ring's (the pieces' materials, when they close round the base), or a group's wall; nothing without.
export const baseWalls = (base) => Math.round((base.buildings.reduce((a, b) => a + legacyPiece(b), 0) + (piecesOf(base).length ? wallInfo(null, base).strength : 0)) * 10) / 10;
// The wall's tier (its material, 1 to 4; 0: none, a ring that does not close, or broken).
export const wallTier = (base) => (piecesOf(base).length ? wallInfo(null, base).tier : legacyTier(base));
// Walled: a ring that closes round the base (or a group's wall standing).
export const hasWall = (base) => !!base && !!base.buildings && wallTier(base) > 0;
// A wall cell's hit points on the battle map (the old strip maps: deploy.js wallHp): the pieces' average, a group's
// wall's tier's; null: the old formula (a stand-in base, walls from before the tiers).
export const wallSectionHp = (base) => {
  if (piecesOf(base).length) { const i = wallInfo(null, base); return i.hp || null; }
  const w = wallOf(base);
  if (!w || !w.tier || w.str != null) return null;
  return Math.round(WALL_TIERS[wallTierOf(w)].hp * ((w.wear || 0) >= 60 ? WALL_DAMAGED : 1));
};
// The gates' hit points a cell (their material's), or null without a gate piece (deploy.js gateHp: the old 100).
export const gateMatHp = (base) => { const g = piecesOf(base, ["gate"]).filter((b) => !b.broken); return g.length ? Math.round(g.reduce((a, b) => a + pieceHp(b), 0) / g.length) : null; };
// The material most of the wall is of (1 with none): what the ring is closed with.
export function ringMat(base) {
  const n = [0, 0, 0, 0, 0];
  for (const b of piecesOf(base, ["wall", "gate"])) n[matOf(b)] += BUILDINGS[b.type].len;
  let best = 1;
  for (let m = 1; m < n.length; m++) if (n[m] > n[best]) best = m;
  return best;
}
// A whole ring of pieces at once (a group's wall taken over: conquest.js, occupy.js; a save's old wall; the tests'
// addBuilding "walls"): what it takes to close the ring round the yard, of a material, worn as given. Pieces already
// standing are raised to the material first (an old wall built up a tier). Returns the pieces laid or raised.
export function addRing(base, mat = 1, wear = 0) {
  mat = matOf({ mat });
  ensureRing(base);
  const out = [];
  for (const b of piecesOf(base, ["wall", "gate"])) if (matOf(b) < mat) { b.mat = mat; out.push(b); }
  for (const type of ringPlan(null, base).pieces) {
    const b = { id: newId(), type, mat };
    if (wear) b.wear = wear;
    base.buildings.push(b);
    out.push(b);
  }
  return out;
}
// A save's walls from before the pieces (one wall of a tier at a base of yours, or the sections before the tiers): a
// ring of pieces of that material, the worst wear of them, one piece broken if the wall was. Queued wall jobs become
// the Ring wall's: an upgrade, or the ring. Idempotent: a base with no "walls" building is left alone. A group's own
// wall (their bases, f.homes) stays one building.
export function migrateWalls(state) {
  for (const base of state.bases || []) {
    const ws = (base.buildings || []).filter((b) => b.type === "walls");
    for (const job of base.construction || []) if (job.type === "walls" && !job.kind) {
      job.kind = job.target ? "upgrade" : "ring"; job.mat = matOf({ mat: job.tier || 1 }); delete job.target; delete job.tier;
      if (job.kind === "ring" && !job.pieces) job.pieces = ringPlan(null, base).pieces;
    }
    if (!ws.length) continue;
    const tier = Math.min(WALL_TIERS.length - 1, ws.length === 1 && ws[0].tier ? ws[0].tier : Math.max(ws[0].tier || 0, ws.length + 1));
    const wear = Math.max(...ws.map((b) => b.wear || 0)), broken = ws.every((b) => b.broken) ? ws[0].broken : null;
    base.buildings = base.buildings.filter((b) => b.type !== "walls");
    const laid = addRing(base, tier, wear);
    const piece = laid.find((b) => b.type !== "gate4");
    if (broken && piece) piece.broken = typeof broken === "object" ? broken : { day: 0, cause: "broken before" };
  }
}
// The wall's next step for the Ring wall (and the governor): close the ring (kind "ring", the material it is mostly
// of) or, once it closes, raise every piece a material (kind "upgrade"); null when it is all metal sheets. A queued
// Ring wall job counts as done (one at a time).
export function nextWallTier(base) {
  const job = base.construction.find((c) => c.type === "walls");
  if (job) return { tier: job.mat || 1, def: WALL_TIERS[job.mat || 1], queued: true, kind: job.kind || "ring" };
  if (ringPlan(null, base).pieces.length) { const tier = ringMat(base); return { tier, def: WALL_TIERS[tier], queued: false, kind: "ring" }; }
  const walls = piecesOf(base, ["wall", "gate"]);
  const low = walls.length ? Math.min(...walls.map(matOf)) : WALL_TIERS.length - 1;
  return WALL_TIERS[low + 1] ? { tier: low + 1, def: WALL_TIERS[low + 1], queued: false, kind: "upgrade" } : null;
}
// A base on alert or under siege (a raid at its walls): builders and mechanics are on the walls, so construction
// and repairs stop until it is over (the price of "Prepare defenses").
export const underAttack = (state, base) => !!base.alert ||
  state.parties.some((q) => q.phase === "siege" && q.target && q.target.kind === "player" && q.target.baseId === base.id) ||
  (state.visitors || []).some((v) => v.phase === "siege" && v.goal && v.goal.kind === "base" && v.goal.baseId === base.id);
// Beds: the hub 4, an outpost 2, a shelter SHELTER.beds, plus BEDS for each working bunkhouse or barracks (a broken one
// sleeps nobody until it is repaired) and each pair of bunk beds built inside a general building (base building 2026-10-19).
export const BEDS = { bunkhouse: 6, barracks: 12, cots: 2, bunks: 2 };
// Tents (the user's rules 2026-10-20): one kind of map piece (BUILDINGS.tent, a record { type: "tent", tent: kind })
// in sizes, pitched from tent bags (tents.js) or the Makeshift tent built: its footprint, the people it sleeps, the kg
// it keeps out of the weather (basestorage.js storageOf: a "tent" container; storage.js storeSpaces: the Tents dry
// room) and the mood a night in it is worth (beds.js bedSlots). ONE TABLE: data-tents.js TENT_TYPES, re-exported here
// as TENTS (the pt-int merge); TENT_STORE_KG is its S.
export const TENT_STORE_KG = TENT_S;
export const TENTS = TENT_TYPES;
export const tentKind = (b) => (b && TENTS[b.tent] ? b.tent : "makeshift");
export const tentOf = (b) => TENTS[tentKind(b)];
// The beds a base's standing tents give (a broken one sleeps nobody until it is mended): their sleepers.
export const tentBeds = (base) => (base.buildings || []).reduce((a, b) => a + (b.type === "tent" && !b.broken ? tentOf(b).sleepers : 0), 0);
// Beds for the adults: less the beds children take (family.js updateKidBeds: two to a bed; babies sleep with a parent).
// A camp has none of its own (the user's rule 2026-10-20: "A new base has no beds until tents are put up"): its tents.
// plainBeds: the tier's own and the built bed buildings (before the children's), which sleep as a plain bed (beds.js bedSlots);
// plus the furniture set inside the base's buildings (beds.js furnitureBeds: a cot 1, a bed 1, a bunk bed 2, a large bed 2)
// and the standing tents, once (tentBeds: pitched from a bag or the built Makeshift tent).
export const plainBeds = (base) => (isCamp(base) ? CAMP.beds : isShelter(base) ? SHELTER.beds : base.type === "hub" ? 4 : 2) + Object.entries(BEDS).reduce((a, [t, n]) => a + count(base, t) * n, 0);
export const baseBeds = (base) => plainBeds(base) + furnitureBeds(base) + tentBeds(base) - (base.kidBeds || 0);
// A camp of a save from before tents (it slept six on bedrolls round the fire): three two-person tents where it stood
// (save.js on load; base.tentsSet marks a camp done, makeCamp sets it on a new camp, which starts with none).
export function legacyCampTents(base) {
  if (!base || base.tentsSet || !isCamp(base) || base.id < 0) return;
  base.tentsSet = true;
  const old = (base.plan && base.plan.tents) || [];
  for (let i = 0; i < 3; i++) { const b = { id: newId(), type: "tent", tent: "tent2" }; if (old[i]) b.at = old[i].slice(0, 2).concat([0]); base.buildings.push(b); }
  if (base.plan) delete base.plan.tents;
}
// Beds the construction queue adds when it is done: new bunkhouses and barracks, and a bunkhouse expanded into a
// barracks (the difference). The autopilot counts them as beds to come (autopilot.js buildWishes, roomFor).
export const queuedBeds = (base) => base.construction.reduce((a, c) => a + (c.type === "tent" ? TENTS.makeshift.sleepers : !BEDS[c.type] ? 0 : c.target ? BEDS[c.type] - BEDS[BUILDINGS[c.type].from] : BEDS[c.type]), 0); // a tent queued: a makeshift one
// Crop plots (farming.js plotLimit is this): CROP_PLOTS by the base's size, +2 per Farm plot building.
export const farmSlots = (base) => Math.max(0, CROP_PLOTS[plotSize(base)] + count(base, "farm_plot") * 2 - count(base, "animal_pen") * PEN.pasture); // the pens' pasture (farming.js)
export const stations = (base) => base.buildings.filter((b) => BUILDINGS[b.type].station);
// The crafting bench here (BENCH): the highest tier standing, 0 for none. Broken ones count only with any (a build
// gate: it is repaired); benchOf is what the crafters get from the working one (null: none, so no bonus; old saves).
export const benchTier = (base, any = false) => Math.max(0, ...base.buildings.map((b) => (BUILDINGS[b.type] && BUILDINGS[b.type].family === "bench" && (any || !b.broken) ? BUILDINGS[b.type].tier : 0)));
export const benchType = (base) => Object.keys(BENCH).find((k) => BUILDINGS[k].tier === benchTier(base)) || null;
export const benchOf = (base) => (benchType(base) ? BENCH[benchType(base)] : null);

export function addBuilding(base, type) {
  // A wall (WALL_TIERS): one a base. Raised again where one stands (a group's sections handed over, conquest.js and
  // occupy.js), it goes up a tier instead.
  if (type === "walls" && wallOf(base)) { const w = wallOf(base); w.tier = Math.min(WALL_TIERS.length - 1, wallTierOf(w) + 1); return w; }
  // At a base of yours (not a group's: base.group, nor a stand-in: id −1) a wall is pieces (addRing): the ring round the
  // yard, or the pieces standing raised a material.
  if (type === "walls" && !base.group && base.id >= 0) { const have = piecesOf(base, ["wall", "gate"]); const laid = addRing(base, have.length ? Math.min(...have.map(matOf)) + 1 : 1); return laid.find((b) => b.type !== "gate4") || laid[0] || have[0] || null; }
  const b = { id: newId(), type };
  if (type === "walls") b.tier = 1;
  if (type === "tent") b.tent = "makeshift"; // the one built (TENTS); a bag's is pitched (basemap.js pitchTent)
  if (isPiece(type)) { if (BUILDINGS[type].piece !== "stand") b.mat = 1; ensureRing(base); } // the ring is pegged out where the yard's edge is (basemap.js ringHalf)
  // An upgrade (hospital tiers) replaces the lower tier of the same family, and keeps its spot on the base map (its
  // host inside a general building and its doorway links too).
  const fam = BUILDINGS[type].family;
  if (fam) { carryPlacement(base.buildings.find((x) => BUILDINGS[x.type].family === fam), b, base); base.buildings = base.buildings.filter((x) => BUILDINGS[x.type].family !== fam); }
  base.buildings.push(b);
  if (type === "radio") base.radio = true;
  if (type === "watchtower") base.watchtower = true;
  if (BUILDINGS[type].barrel) { b.tier = 1; b.holds = WATER_BARREL.holds; }
  if (type === "minefield") b.mines = MINES.PER; // mines.js: a full field
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
// jars CANNER.out more portions of jarred food a day (bigger batches under pressure). item: the old crafted canner (data.js
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
    if (recipe === "preserve" && k === "f_jarred" && st && hasCanner(base, st)) q += CANNER.out; // a pressure canner fitted to this kitchen (a jarred portion is a day of food, as CANNER.out's days)
    if (recipe === "livestock") q = base && state ? (v * livestockYield(state, base, s)) / PEN.food : v; // farming.js: the season, the walls, the keeper (eggs and milk in the same shares)
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
    if (r.minSkill && skill(status.op, r.skill) < r.minSkill && state.rng.chance(0.5)) continue;
    for (const [k, v] of Object.entries(status.out)) { if (k === "ammo") benchRounds(state, base, v); else if (FOODS[k]) addFood(base, k, v, { state }); else base.stock[k] = (base.stock[k] || 0) + v; } // ammo.js: the calibres the guns here shoot; foods.js: food with a fresh lot
    for (const [k, v] of Object.entries(status.out)) noteOutput(state, base, "operate", v, k);
    if (inp.jars) base.jarsInUse = (base.jarsInUse || 0) + inp.jars; // filled jars (storage.js)
  }
}

// Where a building may stand at all (BASE-02/03): "" when this kind of base (a camp, a shelter, an outpost camp, an
// outpost, the main base) takes it, else why not. The one rule for both canBuild (it refuses every one of these, with
// these words) and the Construction tab (it lists them apart as not buildable here; the rest as ready, or not yet:
// materials, skills, a free plot, the tier below, a manual).
export function placeProblem(base, type) {
  const def = BUILDINGS[type];
  if (!def) return "Unknown building";
  if (def.hidden) return "Queued from the base map (a piece of land's card)";
  if (def.furniture) return furnitureProblem(base, type); // beds.js: inside a general building with room, at any base
  if (def.outpostOnly && base.type !== "outpost") return "Outposts only";
  if (def.hubOnly && base.type !== "hub") return "The main base only (an outpost camp is established instead)";
  // A shelter (tier 0) builds only a few survival buildings, and the step up into a base; a base never the step.
  if (def.shelterOnly && !isShelter(base)) return "Shelters only (this is a base already)";
  if (def.campOnly && !isCamp(base)) return isShelter(base) ? "Camps only (this is a shelter already)" : "Camps only (this is a base already)";
  // A defence for bigger bases (BUILDINGS size, DEF_SIZE): as the base grows, more of them open up.
  if (def.size && !sizeFits(base, def.size)) return opensAt(def.size);
  if (isCamp(base)) {
    if (!CAMP.build[type]) return type === "hub_up" ? "Build the camp up into a shelter first" : base.type === "outpost" ? "Available once the camp is an outpost (Establish the outpost)" : SHELTER.build[type] ? "Available once the shelter stands (build the camp up first)" : "Available once it is a base (camp → shelter → base)";
  } else if (isShelter(base) && !SHELTER.build[type]) return "Not at a shelter: build it up into a base first";
  if (def.plot && !plotCap(base, def.plot)) return `A ${tierName(base).toLowerCase()} has no ${PLOT_NAMES[def.plot].toLowerCase()}s`;
  // A fitting (base building 2026-10-19) stands only inside a general building with room on its floor for it.
  if (def.fit && !fittingRoom(null, base, type)) return "Needs a building to stand in (a hut, cabin, lodge, hall or barn)";
  return "";
}

// The Ring wall (queueBuild "walls"): close the ring round the yard (kind "ring": every piece it still takes, of a
// material: opts.mat, else what the wall is mostly of) or raise every wall and gate below a material to it (kind
// "upgrade": opts.mat, else one above the poorest). { ok, wall: true, kind, tier (the material), def, pieces (types to
// lay) or ids (to raise), cost, hours, reason }. One Ring wall job at a time; the material's base size, skill and cost.
/** @returns {{ ok: boolean, reason?: string, wall?: boolean, gather?: boolean, kind?: string, tier?: number, def?: any, pieces?: string[], ids?: number[], cost?: any, hours?: number, where?: boolean, camp?: boolean, top?: boolean, queued?: boolean, short?: boolean, size?: string }} */
export function canBuildWall(state, base, opts = {}) {
  const where = placeProblem(base, "walls");
  if (where) return { ok: false, where: true, camp: isCamp(base) || undefined, reason: where };
  if (base.construction.some((c) => c.type === "walls")) return { ok: false, queued: true, reason: "A Ring wall job is already queued" };
  const plan = ringPlan(state, base);
  const kind = opts.kind || (plan.pieces.length ? "ring" : "upgrade");
  const walls = piecesOf(base, ["wall", "gate"]);
  let tier, pieces = [], ids = [];
  if (kind === "ring") {
    if (!plan.pieces.length) return { ok: false, kind, reason: "The ring round the yard is closed already" };
    tier = matOf({ mat: opts.mat || (walls.length ? ringMat(base) : bestRingMat(state, base, plan.pieces)) });
    pieces = plan.pieces;
  } else {
    const low = walls.length ? Math.min(...walls.map(matOf)) : 0;
    if (!walls.length) return { ok: false, kind, reason: "No wall to upgrade: close the ring first" };
    if (!WALL_TIERS[low + 1] && !opts.mat) return { ok: false, kind, top: true, reason: `Every piece is ${WALL_TIERS[WALL_TIERS.length - 1].mat.toLowerCase()} already (the best there is)` };
    tier = matOf({ mat: opts.mat || low + 1 });
    ids = walls.filter((b) => matOf(b) < tier).map((b) => b.id);
    if (!ids.length) return { ok: false, kind, tier, def: WALL_TIERS[tier], reason: `Every piece is ${WALL_TIERS[tier].mat.toLowerCase()} or better already` };
  }
  const def = WALL_TIERS[tier];
  const list = kind === "ring" ? pieces : ids.map((id) => base.buildings.find((b) => b.id === id).type);
  const cost = {};
  let hours = 0;
  for (const type of list) { for (const [k, v] of Object.entries(pieceCost(type, tier))) cost[k] = (cost[k] || 0) + v; hours += pieceHours(type, tier); }
  const out = { wall: true, kind, tier, def, pieces, ids, cost, hours: Math.round(hours * 10) / 10 };
  if (!sizeFits(base, def.size)) return { ...out, ok: false, size: def.size, reason: `${def.name}: ${opensAt(def.size).toLowerCase()}` };
  for (const [sk, lvl] of Object.entries(def.req || {})) if (!atBase(state, base.id).some((s) => skill(s, sk) >= lvl)) return { ...out, ok: false, reason: `Needs a ${SKILL_NAMES[sk] || sk} ${lvl}+ survivor here` };
  return { ...out, ok: true, gather: true }; // its materials are taken as they come in (gatherHour)
}
// The material a new ring is closed in when none is asked for (the governor): the best this base builds that its
// stores cover now (the wood its heating needs kept back), else the one they cover most of.
function bestRingMat(state, base, pieces) {
  const fits = (m) => sizeFits(base, WALL_TIERS[m].size) && !Object.entries(WALL_TIERS[m].req || {}).some(([sk, lvl]) => !atBase(state, base.id).some((s) => skill(s, sk) >= lvl));
  const keep = { wood: woodNeed(state, base).need };
  let best = 1, bestShare = -1;
  for (let m = WALL_TIERS.length - 1; m >= 1; m--) {
    if (!fits(m)) continue;
    const cost = {};
    for (const type of pieces) for (const [k, v] of Object.entries(pieceCost(type, m))) cost[k] = (cost[k] || 0) + v;
    const share = Math.min(...Object.entries(cost).map(([k, v]) => Math.max(0, (base.stock[k] || 0) - (keep[k] || 0)) / v));
    if (share >= 1) return m;
    if (share > bestShare) { best = m; bestShare = share; }
  }
  return best;
}
// One wall piece, gate or stand of a material (opts.mat; a stand has none): its limit, the base, the material's base
// size and skill, its cost.
export function canBuildPiece(state, base, type, opts = {}) {
  const def = BUILDINGS[type];
  const where = placeProblem(base, type);
  if (where) return { ok: false, where: true, camp: isCamp(base) || undefined, reason: where };
  const queued = base.construction.filter((c) => c.type === type).length;
  if (countAll(base, type) + queued >= def.max) return { ok: false, reason: `Limit reached (${def.max})` };
  const cap = isCamp(base) ? CAMP.build[type] : isShelter(base) ? SHELTER.build[type] : null;
  if (cap != null && countAll(base, type) + queued >= cap) return { ok: false, reason: `A ${isCamp(base) ? "camp" : "shelter"} has room for ${cap}` };
  const mat = def.piece === "stand" ? 0 : matOf({ mat: opts.mat || 1 });
  const T = mat ? WALL_TIERS[mat] : null;
  if (T && !sizeFits(base, T.size)) return { ok: false, mat, size: T.size, reason: `${T.mat}: ${opensAt(T.size).toLowerCase()}` };
  if (T) for (const [sk, lvl] of Object.entries(T.req || {})) if (!atBase(state, base.id).some((s) => skill(s, sk) >= lvl)) return { ok: false, mat, reason: `${T.mat}: needs a ${SKILL_NAMES[sk] || sk} ${lvl}+ survivor here` };
  const cost = pieceCost(type, mat || 1);
  for (const [k, v] of Object.entries(cost)) if ((base.stock[k] || 0) < v) return { ok: false, mat, short: true, cost, reason: `Needs ${v} ${keyWord(k)}` };
  return { ok: true, mat, cost, hours: pieceHours(type, mat || 1) };
}

export function canBuild(state, base, type, opts = {}) {
  const def = BUILDINGS[type];
  if (def && def.furniture) return canSetFurniture(state, base, type); // beds.js: one in the stores and a building with room
  if (def && def.retired) return { ok: false, locked: true, reason: RETIRED_WHY(def) }; // superseded (the makeshift cots: craft a Cot)
  if (def && def.wall) return canBuildWall(state, base, opts);
  if (def && def.piece) return canBuildPiece(state, base, type, opts);
  const queued = base.construction.filter((c) => c.type === type && (!c.target || def.from)).length; // a barrel's upgrade is not a new one; a bunkhouse expanded into a barracks is one more barracks
  if (countAll(base, type) + queued >= def.max) return { ok: false, reason: `Limit reached (${def.max})` };
  // Not at this kind of base (placeProblem): said before anything else it would need.
  const where = placeProblem(base, type);
  if (where) return { ok: false, where: true, camp: isCamp(base) || undefined, reason: where };
  if (def.upgradeOnly && type === "canner") return { ok: false, reason: "Fitted to a preserving room where it stands (Construction: the preserving room's Fit a canner)" }; // machines-2
  if (def.upgradeOnly) return { ok: false, reason: `Upgrade a${/^[aeiou]/i.test(BUILDINGS[def.from].name) ? "n" : ""} ${BUILDINGS[def.from].name.toLowerCase()} into one (Construction)` }; // the reloading bench
  if (def.family) {
    // Tiered buildings: one step at a time, and only one upgrade in the queue.
    const have = Math.max(0, ...base.buildings.map((x) => (BUILDINGS[x.type].family === def.family ? BUILDINGS[x.type].tier : 0)));
    if (base.construction.some((c) => BUILDINGS[c.type].family === def.family)) return { ok: false, reason: "An upgrade is already queued" };
    if (have >= def.tier) return { ok: false, reason: "Already built (or a better tier)" };
    if (def.upgrades && !count(base, def.upgrades)) return { ok: false, reason: `Upgrade a ${BUILDINGS[def.upgrades].name.toLowerCase()} first` };
  }
  // A relay where a radio station stands (or is queued) would add nothing: the station's range covers the relay's
  // (radio.js radioNodes counts the base as a station only). A broken station still counts: it is repaired.
  if (type === "relay" && (base.radio || countAll(base, "radio") || base.construction.some((c) => c.type === "radio"))) return { ok: false, reason: "A radio station here already covers more than a relay would" };
  // A camp or a shelter has room for so many of each (CAMP.build, SHELTER.build).
  const cap = isCamp(base) ? CAMP.build[type] : isShelter(base) ? SHELTER.build[type] : null;
  if (cap != null && countAll(base, type) + queued >= cap) return { ok: false, reason: `A ${isCamp(base) ? "camp" : "shelter"} has room for ${cap}` };
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
  if (def.needsWall && !hasWall(base)) return { ok: false, reason: "Needs a wall closed round the base first (Walls, on this tab)" };
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

export function queueBuild(state, base, type, opts = {}) {
  /** @type {any} */
  const chk = canBuild(state, base, type, opts);
  if (!chk.ok) return chk.reason;
  if (BUILDINGS[type].furniture) return setFurniture(state, base, type).msg; // beds.js: set from the stores (the game places it), no job
  if (BUILDINGS[type].wall) { // the Ring wall: the pieces to close the ring (job.pieces), or the pieces to raise (job.ids); its materials gathered as they come in
    base.construction.push({ id: newId(), type: "walls", kind: chk.kind, mat: chk.tier, ...(chk.kind === "ring" ? { pieces: chk.pieces } : { ids: chk.ids }), cost: { ...chk.cost }, paid: {}, progress: 0, hours: Math.max(1, chk.hours) });
    return `${chk.kind === "ring" ? `Ring wall queued at ${base.name}: ${chk.pieces.length} ${chk.def.mat.toLowerCase()} pieces, laid where the ring runs` : `${base.name}: ${chk.ids.length} wall pieces to be raised to ${chk.def.mat.toLowerCase()}`}. The materials are taken from the stores as they come in.`;
  }
  if (BUILDINGS[type].piece) { // a wall piece, gate or stand of a material: placed on the base map while it goes up
    for (const [k, v] of Object.entries(chk.cost)) base.stock[k] -= v;
    const job = { id: newId(), type, ...(chk.mat ? { mat: chk.mat } : {}), cost: { ...chk.cost }, progress: 0, hours: chk.hours };
    base.construction.push(job);
    return `${pieceName({ type, mat: chk.mat })} queued at ${base.name}.`;
  }
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
  let carts = Math.max(0, baseCarts(state, base) - atBase(state, base.id).filter((s) => s.role === "wood" && !s.inBed).length); // carts.js: the carts the woodcutters leave, one a builder (hauling the materials)
  return atBase(state, base.id).filter((s) => s.role === "build" && !s.inBed && !onUpkeep(state, base, s)).reduce((a, s) => a + (1 + skill(s, "mechanics") * 0.03) * workFactor(s) * buildMult(s) * choreShare(state, s) * (carts-- > 0 ? 1 + CART_JOB : 1), 0) // buildMult: Handy / Master Builder (skills.js); choreShare: half an hour on the generator's refuelling (power.js)
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
export const matName = (k, n = 2) => (k === "parts" ? (n === 1 ? "part" : "parts") : FOODS[k] ? FOODS[k].word : SUPPLIES[k] ? SUPPLIES[k].name.toLowerCase() : k); // a food item: its word ("cans of beans")
// Takes what the gather jobs here need next from the stores (each hour, before the work): just in time, enough for the
// next GATHER_AHEAD work-hours (a 100-scrap step up does not empty the stores the hour it is queued: the rest stays for
// other builds until the work gets to it).
export const GATHER_AHEAD = 12;
function gatherHour(state, base) {
  for (const job of base.construction) {
    if (!job.paid) continue;
    const share = Math.min(1, (job.progress + GATHER_AHEAD) / Math.max(1, job.hours));
    // The Ring wall leaves the wood the base needs for its heating, its stove and its fire (woodcutting.js woodNeed).
    const keep = job.type === "walls" && gatherRows(job).some((r) => r.key === "wood" && !r.ok) ? { wood: woodNeed(state, base).need } : {};
    for (const r of gatherRows(job)) {
      const want = Math.min(r.need, Math.ceil(r.need * share - 1e-9)) - r.have;
      const take = Math.min(want, Math.floor(Math.max(0, (base.stock[r.key] || 0) - (keep[r.key] || 0))));
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
    gatherHour(state, base);
    if (campMaterialsHour(state, base)) continue; // a camp's builders make the building materials its step up waits for
    const job = base.construction.find((c) => !gatherStalled(c) && !siteWaits(state, base, c)); // basemap.js siteWaits: a building whose site has land on it waits for its clearing
    if (!job) continue;
    const was = job.progress;
    job.progress += buildRate(state, base);
    if (job.paid) job.progress = Math.min(job.progress, job.hours * gatherCap(job)); // never ahead of the materials
    noteOutput(state, base, "build", Math.max(0, job.progress - was), "workh");
    if (job.progress >= job.hours - 1e-9) {
      base.construction.splice(base.construction.indexOf(job), 1);
      noteOutput(state, base, "build", 1, "done");
      if (job.type === "clear") { finishClear(state, base, job); continue; } // basescatter.js: the land cleared, its yield into the stores
      if (BUILDINGS[job.type].tierUp) { upgradeShelter(state, base); continue; } // the shelter becomes a base
      if (job.target && job.type === "barracks") { // a bunkhouse expanded (BARRACKS_UP); nothing if it was lost meanwhile
        const b = base.buildings.find((x) => x.id === job.target && x.type === "bunkhouse");
        if (b) { b.type = "barracks"; log(state, `${base.name}: a bunkhouse is now a barracks (12 beds).`, "good"); }
        continue;
      }
      if (job.target && job.type === "canner") { // a pressure canner fitted to a preserving room; back to the armory if the kitchen was lost meanwhile
        const b = base.buildings.find((x) => x.id === job.target && x.type === "kitchen");
        if (b) { b.canner = true; log(state, `${base.name}: a pressure canner is fitted in the preserving room (+${CANNER.out} portion of jarred food a day).`, "good"); }
        else if (job.item) base.armory.push(job.item);
        continue;
      }
      if (job.target && job.type === "generator") { // a generator upgraded a tier (gen-tiers); nothing if it was lost meanwhile
        const b = base.buildings.find((x) => x.id === job.target && x.type === "generator");
        if (b) { b.tier = Math.max(genTier(b), job.tier); log(state, `${base.name}: the generator is now a ${genName(b).toLowerCase()} (${GEN_TIERS[genTier(b)].out} power).`, "good"); }
        continue;
      }
      if (job.type === "walls") { // the Ring wall: its pieces laid where the ring runs, or the pieces raised a material
        const mat = matOf({ mat: job.mat || job.tier || 1 });
        if (job.kind === "upgrade") { for (const id of job.ids || []) { const b = base.buildings.find((x) => x.id === id && isPiece(x.type)); if (b && matOf(b) < mat) b.mat = mat; } }
        else { ensureRing(base); const ids = []; for (const type of job.pieces || []) { const id = newId(); ids.push(id); base.buildings.push({ id, type, mat }); } for (const id of ids) clearUnder(state, base, `b:${id}`); } // the ground under the pieces the game lays cleared with them (basemap.js)
        log(state, `${base.name}: ${job.kind === "upgrade" ? `the wall is ${WALL_TIERS[mat].mat.toLowerCase()} now` : `a ring of ${WALL_TIERS[mat].name.toLowerCase()} stands round the yard`} (wall strength ${baseWalls(base)}${hasWall(base) ? "" : ": it does not close yet"}).`, "good");
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
      const nb = addBuilding(base, job.type);
      carryPlacement(job, nb, base); // basemap.js: where it was placed while it went up, its host, and the doorway links that named the job
      clearUnder(state, base, `b:${nb.id}`); // basemap.js: its ground is cleared (siteWaits saw to it; a piece the game laid over the land)
      if (job.mat && isPiece(job.type)) nb.mat = job.mat; // a wall piece's material
      log(state, `${isPiece(job.type) ? pieceName(nb) : BUILDINGS[job.type].name} finished at ${base.name}.`, "good");
    }
  }
}

// The wall in a line (buildingSummary, the Defence tab): the ring's material and strength, or why there is none.
export function wallSummary(base) {
  const ps = piecesOf(base);
  if (!ps.length) { const w = wallOf(base); return w ? `${wallName(w)} (tier ${wallTierOf(w)} of ${WALL_TIERS.length - 1}): wall strength ${baseWalls(base)}` : "None: raiders and the dead walk straight into the yard (Construction, Defenses)"; }
  const i = wallInfo(null, base);
  const parts = `${i.walls} wall piece${i.walls === 1 ? "" : "s"}, ${i.gates} gate${i.gates === 1 ? "" : "s"}, ${i.stands} stand${i.stands === 1 ? "" : "s"}`;
  return i.enclosed ? `${WALL_TIERS[i.tier].name} (mostly; tier ${i.tier} of ${WALL_TIERS.length - 1}): wall strength ${baseWalls(base)}, +${Math.round(baseWalls(base) * 2)} defense. ${parts}` : `Open: the pieces do not close round the base (${parts}), so they hold nothing back by the numbers. Close the ring (Construction, Defenses)`;
}
export function buildingSummary(state, base) {
  const people = atBase(state, base.id).length;
  return [
    ["Walls", wallSummary(base)],
    ["Beds", `${baseBeds(base)} for ${people} people${people > baseBeds(base) ? " (overcrowded)" : ""}${furnitureText(base) ? `; furniture: ${furnitureText(base)}` : ""}`],
    ["Crop plots", `${farmSlots(base)}${count(base, "greenhouse") ? ` + ${count(base, "greenhouse") * 2} under glass` : ""}`],
    ["Workshop stations", `${stations(base).length}`],
    ["Crafting", benchOf(base) ? `${BUILDINGS[benchType(base)].name}: crafters ${Math.round((benchOf(base).rate - 1) * 100)}% faster, +${Math.round(benchOf(base).quality * 100)}% condition${benchOf(base).workshop ? ", workshop recipes" : ""}` : "No crafting bench: only the simple (Field) recipes"],
    ...(isCamp(base) ? [["Tier", "Camp: tarps, bedrolls and a fire. Build it up (Construction) into a shelter or an outpost for a roof and room to build"]] : isShelter(base) ? [["Tier", "Shelter (tier 0): tarps and a shack. Build it up into a base (Construction) for a well, stronger walls and every building"]] : []),
    ["Vision", `${(isCamp(base) ? CAMP.vision : isShelter(base) ? SHELTER.vision : base.type === "hub" ? 3 : 2) + (base.watchtower ? 2 : 0)} tiles`],
    ["Radio", base.radio ? "Station" : count(base, "relay") ? (base.relayOffline ? "Relay (offline: needs 1 part)" : "Relay") : "No"],
    ["Vehicle repairs", count(base, "garage") ? "Garage (+25 per part)" : "Field repair (+12 per part, Mechanics 4+)"],
    ["Raid losses", [count(base, "storehouse") ? "Halved by storehouse" : "", count(base, "armory") ? "the armory's gear locked up" : ""].filter(Boolean).join(", ") || "Normal"],
    ["Water", `${isShelter(base) ? "no well (a river or lake beside it, rain catchers, or water brought in)" : `${(base.type === "hub" ? 12 : 3) + count(base, "well") * 6}/day from wells`}${count(base, "rain_catcher") ? `, ${count(base, "rain_catcher")} rain catcher${count(base, "rain_catcher") === 1 ? "" : "s"}` : ""}, holds ${(isShelter(base) ? SHELTER.waterCap : base.type === "hub" ? 80 : 40) + count(base, "cistern") * 150 + barrelRoom(base, "water") + barrelRoom(base, "rawwater")}${barrels(base).length ? ` (barrels: ${barrelRoom(base, "rawwater")} un-purified, ${barrelRoom(base, "water")} purified)` : ""}`],
    ["Plots", `building ${plotsUsed(base, "building")}/${plotCap(base, "building")}, utility ${plotsUsed(base, "utility")}/${plotCap(base, "utility")}`],
    ["Food storage", `${storeCapacity(base)} room for fresh food (${storeSpaces(base).map((x) => `${x.name.toLowerCase()} ${x.cap}`).join(", ")}); more is stored outside and spoils fast`],
    ["Preserving", [count(base, "kitchen") ? `${count(base, "kitchen")} preserving room${count(base, "kitchen") > 1 ? "s" : ""}` : "", count(base, "smoker") ? `${count(base, "smoker")} drying rack${count(base, "smoker") > 1 ? "s" : ""}` : ""].filter(Boolean).join(", ") || "None"],
    ["Meals", (() => {
      const ks = kitchenService(state, base);
      if (!ks.built) return count(base, "cookhouse") ? "Cook fire (game and greens cooked through)" : "Each eats their own (no kitchen)";
      if (ks.cold) return "Kitchen: cold meals (no wood for the stove)";
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
