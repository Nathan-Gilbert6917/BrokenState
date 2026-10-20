// @ts-check
// What the AI groups build at their bases (barestart): a group's base starts bare, as yours does, and the group puts
// up what it needs, one job at a time, by its needs and goals. The groups are abstract (factions.js: people and
// stores, no buildings of their own), so their works are counts per base: f.works[tile] = { water, farms, beds,
// walls, bench, store }, and f.job = { tile, type, left, paid } is the one job under way.
//
// - The jobs (WORKS): scrap and a part for the bench, paid from the group's stores when the job starts, and work in
//   crew-days. The crew is the group's people / CREW a day (at least 1), so a group of 20 puts up a field in about a
//   day and a wall point in two. Short of the scrap, they salvage their own: the job takes SALVAGE × the work and
//   costs nothing, so a poor group is slow, never stuck.
// - What they choose (nextWork), first match, at their main base and then their other bases:
//   water (wells, barrels) while it serves fewer than everyone (ever "short": they have no tank to fall back on), at
//   summer's thirst from late spring (SUMMER_LEAD);
//   fields while the food is short (under FOOD_SHORT days of eating) and the fields feed fewer than everyone;
//   quarters while people sleep rough (beds for fewer than everyone);
//   walls while they are threatened (THREAT: the dead within reach, a hive near, raided lately, an aggressive group
//   within reach) and the walls are under their goal;
//   the rest of the fields; a bench once the necessities are up (they make ammo and gear every day);
//   a storehouse once their stores fill (a stock at STORE_FULL of what it can hold);
//   (storage, right after the walls under threat: storageWork below);
//   walls up to their goal (the fortress and the military want theirs, others a home wall and a fence at their outposts).
//   A sick bay (sickbayWork, at the main base, after the jail's first step; the four tiers of your hospital: infirmary,
//   field hospital, clinic, trauma hospital; f.works[tile].sickbay = the tier): the infirmary once quarters are up and
//   the group has wounded or SICKBAY_FIRST people; each next tier after the workshop, once the group is big enough
//   (SICKBAY[].pop ÷ its heal lean, groupcare.js GROUP_PRIORITIES) and its doctor good enough (SICKBAY[].doc, groupcare.js f.med: the clinic
//   needs a Medicine 6 doctor and the trauma hospital a 10, as yours). It speeds their healing (groupcare.js healRate,
//   CARE.BAY) and sets how their doctor trains their medics (medicTraining, the tier's teach, ward, gap).
//   A jail (groupjails.js jailWork, after water, fields and quarters): makeshift cells, holding cells, a jailhouse at
//   the main base, early for raiders, the military, the fortress and groups at war, once they hold someone for the
//   rest, after the fields for communes; a full one is upgraded. Their prisoners work the job too (f.prisonWork).
// - What the works do, small next to what the group is (people, arms, stores):
//   walls: conquest.js nativeWalls (what your assault faces) is the walls built, up to its goal (WALL_GOAL: 7 for
//   fortresses and the military, 4 at a main base, 1 elsewhere: the old fixed walls); and a raid or a horde on the
//   group (factions.js resolveRaidOnFaction) meets defence 8 × (0.5 + 0.5 × walls / goal) on top of their fighters,
//   which was a flat 8 before;
//   water and fields: their food from the land is × (FIELDS_MIN + (1 − FIELDS_MIN) × how provisioned they are);
//   quarters: people sleeping rough slow the group's growth (CROWDED_GROWTH × the chance);
//   bench: their workshops make WORKSHOP_MIN of the ammo, scrap, fuel and meds without one;
//   storage: their stores hold STORE_CAP of the usual caps without any (a storage box, crates, a shed, a storehouse or a
//   warehouse at any base: storeFactor);
//   outpost camps (2026-10-09, parity with your outpost camp, buildings.js outpost_up): a base a group founds from
//   nothing (factions.js expansion; not one it moves into, groupworld.js occupyAbandoned) starts as a camp
//   (f.works[tile].camp): its defence × CAMP.DEF and nothing else built there until CAMP (its materials and work) is done,
//   the first job at that base;
//   a kitchen (2026-10-10, your Kitchen's parity, kitchen.js): at a base of KITCHEN.size+ people (the main base once its
//   workshop is up, the others after their fields and pens), one a base; the people it serves (peopleAt) eat
//   KITCHEN.save less a day (groupEatMult, factions.js: their food a day), as your cooks' hot meals do, and its cooks
//   (one per KITCHEN.perCook of them, as yours) bring in nothing from the fields (groupCookShare: their food from the
//   land × (1 − the share of their people cooking)). Coarse: no cooks by name and no skills, no boiled water (they keep
//   no water stock). kitchen-plus (2026-10-10): the stoves burn wood from the group's woodpile as yours do
//   (KITCHEN.wood: a kitchen's stove and two meals a person fed a day, after the day's heating; short of it the kitchens
//   are cold: no saving, the cooks back in the fields: f.kitchenCold), and hot meals keep the group together: its growth
//   chance × (1 + KITCHEN.growth × the share fed) and its desertion pressure − KITCHEN.morale × the share fed
//   (groupcare.js desertPressure), the morale your people get from the mood.
//   animal pens (2026-10-09, your animal pen's parity): at a base with walls and fields, after the fields for
//   everyone, PENS.max a base; each adds PENS.food food a day (penFood, factions.js), winter or not.
// - Machines (freezer-parts 2026-10-10, parity with your still, generator, walk-in freezer and vacuum sealer; coarse,
//   daily, at the base that has them): a group of MACH.pop+ people with a workshop and food for MACH.foodDays puts up
//   an ethanol still, then a generator, then a walk-in freezer, then a vacuum sealer, each only with its machine parts
//   and MACH.spare more in the stores (their one count of parts: your electronics are folded into it). Each day
//   (groupMachinesDaily): the still turns MACH.still.food of their food surplus into MACH.still.fuel fuel (as yours: 8
//   → 3); the generator burns your generator's fuel a day for its tier (gen-tiers: genBurn; tier 1 POWER.genFuel) while the freezer or the sealer draws, and with no
//   fuel they are off; the freezer on keeps up to MACH.room days of their soonest-to-spoil food at a twentieth of its
//   aging (food-types: factions.js ageCoarse frozen, as yours keeps at ×0.05); the sealer on is the
//   cooking wave's hook (groupSealer). Every machine that ran wears by your machine's use (breakdowns.js FIXTURES)
//   less MACH.mend (their hands keep it), breaks by your risk curve, uses a spare part by your spares days (no part:
//   +3 wear a day), and is repaired the next day it can pay your proper repair (scrap and parts); short of parts they
//   buy them from merchants (trade.js groupPartsTarget counts their machines). Abstract: no operators, no power
//   budget (one generator runs what they have), no storage rooms.
//   machines-2 (2026-10-10): their works wait for the same manuals as yours (groupTech below: found, bought, studied):
//   the generator for the Generator Schematics (and, since they build it for a freezer, the Refrigeration Schematics),
//   the walk-in freezer for the Refrigeration Schematics, the sick bay's clinic and trauma hospital for the Field
//   Surgery Manual and the Hospital Operations Manual, their workshop's parts for the Machinist's Handbook (your machine
//   shop's); and a group mechanic (groupSkill) of your Mechanics rules: 3 to build the generator, the freezer and the
//   sealer (MACH.req), the proper repair's minimum to repair a machine. The
//   generator's fuel is coarse, as your unattended generator's: POWER.genFuel a day is spent while the freezer or the
//   sealer draws and there is any fuel (the last of it runs the day). Machine parts of their own (groupPartsDaily, PARTS):
//   a group with a machine shop (ai-locks: the "shop" work, your machine shop's Machinist's Handbook and Mechanics 4 to
//   build; or one taken over with a base of yours) machines parts from its scrap, coarse: PARTS.rate a day × its people
//   (÷ PARTS.pop, at most PARTS.popMax, at least PARTS.popMin), PARTS.scrap scrap a part (yours: 6), × PARTS.below
//   (half) when its mechanic (groupcare.js GROUP_PRIORITIES mechanic: zealots 2, raiders and communes 3, expansionists and
//   traders 4, the fortress 5, the military 6) is under PARTS.mech, your station's rule (Mechanics 4+, else half the
//   days fail, their scrap spent all the same); no more for a better mechanic (yours makes a part a day whoever runs
//   it). It works while its parts are under what it wants (partsWant: PARTS.keep, a part a machine it has, and the next
//   machine's parts and spares) and its scrap is over PARTS.scrapKeep a head. A group of 16 makes a part every 4 days;
//   8 people (the floor) one every 8; 24+ one every 2.7. (Before ai-locks: any workshop with the manual, × mechanic ÷ 4.)
// - The works your rules ask for (ai-locks 2026-10-11, LOCKS, workLock): a machine shop (above), a radio station (your
//   Mechanics 4: their network is their stations, radio.js groupNetwork; the military's army sets are stations), a
//   garage (vehicle repairs at full step; without one only a Mechanics 4 mechanic mends them, at your 12-of-25 rate:
//   groupcare.js repairVehicles), a reloading bench (your Mechanics 3; their brass loaded into rounds only with one:
//   reloading.js groupReloadDaily) and a reinforced gate (your Army Engineering Manual: the gate on the map of an assault
//   on their main base, fort.js assaultBase), and the sick bay's trauma hospital wants your Mechanics 4 as well.
//   The earmark (the user's intent: "a small parts income so their machines and repairs happen more often", not more
//   guns): the workshop's parts are kept for the machines (f.partsMach, at most their parts on hand). The workshop
//   works only while that earmark is under partsWant. Machine spending (builds, proper repairs, spares) takes the
//   earmark first, then any other part; everything else (making guns, mending kit, buying guns, trade, deals, jail and
//   sick bay works) may use only the parts above it (groupFreeParts; trade.js available leaves the earmark out); a
//   vehicle repair takes car parts first and machine parts only by your two-for-one fallback (vehicles.js groupCost:
//   the free parts go before the earmark; payParts "vehicle" is that rule too). Losses (raids, tribute) take from the whole count; the earmark shrinks
//   with it.
//   gen-tiers (2026-10-10, the user's rule "AI groups need to have the same restrictions and gameplay features"): their
//   generator has your tiers (power.js GEN_TIERS: w.powerTier, 1 when missing) and burns your fuel for them: genBurn at
//   the power its machines draw (the walk-in freezer 2, the vacuum sealer 1: your POWER_USERS; served in that order up
//   to the tier's power), so a tier-1 set burns its flat 2 a day as before. It wears, eats spares and is repaired by
//   your tier's fixture (breakdowns.js genFixture: more parts, Mechanics 4 / 5). It is upgraded (a job, groupPowerUp)
//   by your rules: their machines want more power than the tier gives, ai-locks' workLock (LOCKS power2 / power3: a
//   workshop, a group mechanic at the tier's Mechanics 4 / 5, tier 3 the Industrial Power Manual by groupKnows
//   "indpower": found, bought, studied as the rest), the tier's
//   materials scaled as the rest of WORKS (MACH.tiers: yours 24 scrap + 5 parts, 40 + 8 + 2 electronics, the
//   electronics folded into the parts) with MACH.spare parts over, and never into a fuel deficit (power.js
//   genUpgradeFuelOk, as your governor's: their fuel in and out a day, measured as a 28-day average of the stock's
//   changes, f.fuelFlow, less the extra burn stays at 0 or more, and their fuel above half a fuel a head covers 30 days
//   of it). With a freezer and a sealer (3 power) a tier-1 set covers them, so today they stay at tier 1, as most of
//   your bases do; the rule is there for the day their machines draw more.
// - Storage (base storage limits, 2026-10-19, the user's "have AI groups build storage units etc so the player can raid
//   their supplies"; docs/adr/0001-ai-parity.md: your rules): a group's base is measured by your rule (basestorage.js
//   storageOf: its core by tier, the storage buildings its works stand for, groupbases.js WORKS_BUILDING; a camp of
//   theirs has no core, as yours). When goods lie outside a base tonight (groupStorage: the stores as the supply run
//   will leave them, groupbases.js stockTonight; STORE_WISH.minKg or more, or an item), storageWork puts up the
//   building your governor would (autopilot.js storageWish, its ladder by the base's size: a storage box at a camp,
//   crates or a storage shed at an outpost, crates, a shed, the storehouse or a warehouse at the main base): the
//   smallest that takes what lies outside, else the biggest they can build now. Your buildings' rules (storeLock):
//   their most a base (BUILDINGS max; a camp's CAMP.build), the warehouse at an outpost or the main base only and with
//   a Mechanics 2+ hand (groupSkill); your costs (storeDef, paid when the job starts: a storage box 2 scrap, crates 4,
//   a shed 12 and a building material, the storehouse 18, a warehouse 40, 4 building materials and a part) and they
//   start it only when they can pay (as your canBuild), building materials made from their scrap as for any job; at a
//   camp, only from the scrap the step up does not need (as your camp's yard), and before it. Work: your hours ÷
//   CREW_HOURS crew-days (a box or crates 1, a shed 2, the storehouse 3, a warehouse 6). In nextWork after water, the
//   fields when food is short, quarters, the jail and infirmary and the walls under threat, before the rest. Plots
//   are not counted (their bases keep none). Not at a base of yours they took (groupbases.js real: its buildings are
//   yours). The old storehouse once "the stores are full" (storesFull) stays at the main base. Abstract no more: the
//   room is what raiders find their goods inside or lying out on the piles (basemap.js, raidloot.js).
// - Old saves (no state.groupWorks) and the hardcore military (an army base built before the fall) count as built
//   up: none of this changes them. tools/barestarttest.js.
import { foodIn, takeFood } from "./foods.js"; // days of food (every kind)
import { groupFetchedWater, groupWoodLand } from "./grouptrips.js"; // groupWoodLand: the wood land their bases hold (woodwork: they cut a build's wood) // water carried in from the water a base holds (as your Fetch water)
import { day, skill } from "./world.js";
import { MEAL_WORK_SHARE } from "./meals.js"; // their crews stop for breakfast, lunch and dinner too (21 of 24 hours)
import { season, THIRST } from "./weather.js"; // summer water: the season and its thirst
import { weightOf, medOf, workingPeople } from "./groupcare.js"; // the type profiles; the group's doctor (a clinic needs a good one)
import { jailWork, jailBuilt, GROUP_JAIL } from "./groupjails.js"; // jailhouse: the groups' jails (abstract tiers)
import { FIXTURES, WEAR, genFixture } from "./breakdowns.js"; // freezer-parts: the groups' machines wear and break as yours; gen-tiers: a generator's by its tier
import { POWER_USERS, GEN_TIERS, genBurn, genUpgradeFuelOk, GEN_UP } from "./power.js"; // gen-tiers: your generator's tiers
import { hash01 } from "./skills.js";
import { BLUEPRINTS, BP_KEYS, WARE_BP, ZONE_P, CRASH_BP, siteBlueprints } from "./blueprints.js"; // machines-2: the groups' manuals (groupTech)
import { READ_HOURS } from "./skills.js"; // a reader's day of study
import { relation } from "./diplomacy.js"; // buying a manual from traders they are not hostile to
import { SUPPLIES } from "./data.js";
import { groupFieldDefence, groupFieldWells } from "./fieldworks.js"; // the groups' field works: towers, wells
import { groupWantsMill, groupWantsGrinder } from "./cooking.js"; // wave 2 cooking: a grain mill and a meat grinder by a kitchen
import { BUILDINGS, CAMP as CAMP_BASE } from "./buildings.js"; // storage: your storage buildings, their costs and rules (call-time only)
import { storageOf } from "./basestorage.js"; // storage: a base's room and what lies outside (call-time only)
import { STORE_WISH } from "./autopilot.js"; // storage: your governor's ladder (call-time only)
import { homesOf, stockTonight, worksBuildings } from "./groupbases.js"; // storage: their bases as base objects (call-time only)
import { hallDef, hallWork, groupBedsDaily, furnSleepers } from "./beds.js"; // beds as furniture: their hall, the furniture they craft and its sleepers (call-time only)
import { groupTentSleepers } from "./tents.js"; // the tent bags on their shelf, pitched at their camps (call-time only)

/** @typedef {{ water?: number, farms?: number, beds?: number, walls?: number, bench?: number, store?: number, sickbay?: number, pens?: number, camp?: number, still?: number, power?: number, powerTier?: number, freezer?: number, sealer?: number, kitchen?: number, shop?: number, radio?: number, garage?: number, reload?: number, gate?: number, storebox?: number, crates?: number, shed?: number, warehouse?: number, mill?: number, grinder?: number, mach?: Object<string, { wear: number, spares: number, broken: boolean, on?: boolean, noSpares?: boolean }> }} Works */

export const GROUP_WORKS = {
  WORKS: {
    water: { name: "a well", cost: { scrap: 3 }, work: 3 },
    // Wood (2026-10-20, "Convert all fire wood into just wood so it can be used for fueling and uses as a building
    // material"): their fields' fencing, quarters and walls take a share in wood as yours do (a quarter of yours, as
    // the scrap; woodwork 2026-10-20 raised yours and theirs with it: fields 75, quarters 150, a wall 250, pens 125, a
    // workshop 50, a kitchen 75), from the woodpile they cut and burn (factions.js GROUP_WOOD) above WOOD.keepHead a
    // head; what the pile cannot spare their crew cuts as part of the job (WOOD.cutDay a crew-day on their land:
    // groupWoodLand), so their woodcutting covers their builds and a build never waits on wood.
    farms: { name: "fields", cost: { scrap: 2, wood: 75 }, work: 4 },
    beds:  { name: "quarters", cost: { scrap: 3, wood: 150 }, work: 4 },
    walls: { name: "a wall", cost: { scrap: 2, wood: 250 }, work: 6 },
    bench: { name: "a workshop", cost: { scrap: 5, parts: 1, wood: 50 }, work: 4 },
    // Storage (storageWork): your storage buildings at your costs, your hours ÷ CREW_HOURS (storeDef).
    get store() { return storeDef("store"); },
    get storebox() { return storeDef("storebox"); },
    get crates() { return storeDef("crates"); },
    get shed() { return storeDef("shed"); },
    get warehouse() { return storeDef("warehouse"); },
    pens: { name: "an animal pen", cost: { scrap: 2, wood: 125 }, work: 3 },
    // Machines (freezer-parts; MACH): yours cost 15 scrap + 2 parts, 20 + 4, 30 + 5 + 2 electronics, 12 + 2 + 2.
    still: { name: "an ethanol still", cost: { scrap: 4, parts: 1 }, work: 3 },
    power: { name: "a generator", cost: { scrap: 5, parts: 2 }, work: 4 },
    freezer: { name: "a walk-in freezer", cost: { scrap: 8, parts: 3 }, work: 5 },
    sealer: { name: "a vacuum sealer", cost: { scrap: 3, parts: 2 }, work: 2 },
    kitchen: { name: "a kitchen", cost: { scrap: 4, parts: 1, wood: 75 }, work: 4 }, // yours: 20 scrap, a part, 24 work-hours (scaled as the rest)
    // ai-locks (2026-10-11; LOCKS below): the buildings your rules ask for, scaled as the rest (about a quarter of your
    // scrap, half your parts). Yours: a machine shop 25 scrap + 3 parts, a radio station 30 + 6, a garage 20 + 2, a
    // reloading bench 20 scrap + a part + 3 gun parts (on an ammo bench), a reinforced gate 14 + a part.
    shop: { name: "a machine shop", cost: { scrap: 6, parts: 2 }, work: 6 },
    radio: { name: "a radio station", cost: { scrap: 8, parts: 3 }, work: 6 },
    garage: { name: "a garage", cost: { scrap: 5, parts: 1 }, work: 4 },
    reload: { name: "a reloading bench", cost: { scrap: 5, parts: 2 }, work: 4 },
    gate: { name: "a reinforced gate", cost: { scrap: 4, parts: 1 }, work: 3 },
    // Wave 2 cooking (cooking.js): your grain mill (8 scrap + a part, 8 work-hours) and meat grinder (5 + a part, 6),
    // scaled as the rest; their wear and repairs are cooking.js groupFitWear (your FIXTURES grainmill / meatgrinder).
    mill: { name: "a grain mill", cost: { scrap: 2, parts: 1 }, work: 1 },
    grinder: { name: "a meat grinder", cost: { scrap: 2, parts: 1 }, work: 1 },
    // Beds as furniture (beds.js hallWork): your Lodge, the general building their furniture is set in.
    get hall() { return hallDef(); },
  },
  // ai-locks: your build rules for those works (buildings.js req and blueprints.js LOCKED), read by workLock. mech: the
  // group's mechanic (groupSkill) at your Mechanics minimum; bp: the manual they must have studied; bench: a workshop
  // (their "bench", your workbench) at any base first. RADIO_POP: the people before they want a station; RELOAD_BRASS:
  // the brass before they want a reloading bench (reloading.js RELOAD.GROUP.buyBrass).
  LOCKS: {
    shop: { mech: 4, bp: "machinist", bench: true }, radio: { mech: 4, bench: true }, garage: { bench: true },
    reload: { mech: 3, bench: true }, gate: { bp: "armyeng" },
    // gen-tiers: the generator's upgrades (MACH.tiers), your canUpgradeGenerator's Mechanics and manual.
    power2: { mech: 4, bench: true }, power3: { mech: 5, bp: "indpower", bench: true },
    mill: { mech: 1, bench: true }, grinder: { mech: 1, bench: true }, // wave 2 cooking: your Mechanics 1 to build them
  },
  RADIO_POP: 10, RELOAD_BRASS: 30,
  // Their machine parts (machines-2; groupPartsDaily, see the header).
  PARTS: { rate: 0.25, mech: 4, below: 0.5, pop: 16, popMax: 1.5, popMin: 0.4, scrap: 6, keep: 4, perMachine: 1, scrapKeep: 1 },
  // The groups' machines (see the header). fx: the fixture each is (breakdowns.js FIXTURES).
  MACH: { pop: 14, foodDays: 12, spare: 2, mend: 0.6, room: 300, still: { food: 8, fuel: 3 }, req: { power: 3, freezer: 3, sealer: 3 }, // req: Mechanics to build (yours, buildings.js)
    fx: { still: "still", power: "generator", freezer: "freezer", sealer: "sealer" },
    // gen-tiers: the generator's upgrades (see the header), by the tier it becomes: your GEN_TIERS cost scaled as WORKS
    // (yours 24 scrap + 5 parts, 30 work-hours; 40 + 8 + 2 electronics, 48). Their Mechanics and manual: LOCKS power2 /
    // power3 (workLock, as ai-locks' other works).
    tiers: [null, null,
      { name: "a standby generator", cost: { scrap: 6, parts: 3 }, work: 4 },
      { name: "an industrial diesel set", cost: { scrap: 10, parts: 5 }, work: 6 }],
    floor: 0.5, // fuel a head kept back from a bigger generator's burn (groupcare.js keeps the same before selling)
  },
  CREW: 6, SALVAGE: 2,
  WOOD: { keepHead: 120, cutDay: 360, landMin: 0.25 }, // woodwork: the pile a head they never build from (their winter's), wood a crew-day of felling cuts on land of wood score 1 (grouptrips.js groupWoodLand, at least landMin)
  CREW_HOURS: 8, // your work-hours a crew-day of theirs, as the works above were scaled (a well's 24 hours 3, a machine shop's 48 hours 6)
  SERVES: { water: 10, farms: 8, beds: 8 }, // people one of each serves
  WALL_GOAL: { typed: 7, home: 4, open: 1 }, WALLED_TYPES: ["fortress", "military"], // as conquest.js CONQUEST.WALLS (the old fixed walls)
  FOOD_SHORT: 8, STORE_FULL: 0.9,
  FIELDS_MIN: 0.94, CROWDED_GROWTH: 0.7, WORKSHOP_MIN: 0.85, STORE_CAP: 0.85,
  THREAT: { HORDE: 6, HIVE: 10, RAIDED: 30, GROUP: 14 },
  WALL_DEF: 8, // the flat defence a group base had, now half of it bare and all of it behind the walls' goal
  // Sick bays by tier (sickbayWork): cost, work in crew-days, the people it waits for (÷ the heal lean) and the doctor's
  // Medicine it needs. Your hospitals cost 15 scrap + 2 meds up to 70 scrap, 8 parts, 12 meds; the groups' works are
  // scaled to their stores as the rest of WORKS (a well 3 scrap).
  // SICKBAY[0] is tier 1 (the infirmary); SICKBAY_FIRST: the people that want an infirmary with nobody wounded.
  SICKBAY: [
    { name: "an infirmary", cost: { scrap: 5, meds: 1 }, work: 3, pop: 0, doc: 0 },
    { name: "a field hospital", cost: { scrap: 8, parts: 1, meds: 2 }, work: 5, pop: 10, doc: 0 },
    { name: "a clinic", cost: { scrap: 12, parts: 2, meds: 3 }, work: 7, pop: 16, doc: 6 },
    { name: "a trauma hospital", cost: { scrap: 18, parts: 3, meds: 4 }, work: 10, pop: 25, doc: 10, mech: 4 }, // mech: your Trauma hospital's Mechanics 4 (ai-locks)
  ],
  SICKBAY_FIRST: 6,
  // Animal pens (farming.js PEN, your animal pen: the same option, coarse): a base with walls and fields puts up one
  // (after the fields for everyone); each brings PENS.food food a day on top of their fields, every season.
  PENS: { max: 1, food: 2 },
  // A kitchen (your Kitchen, kitchen.js KITCHEN: −10% food for the people its cooks feed, one cook per 12): at a base of
  // KITCHEN.size+ people (your governor's KITCHEN.govFrom), the people living there eat KITCHEN.save less.
  KITCHEN: { size: 8, save: 0.1, perCook: 12, wood: { stove: 4, head: 2 }, growth: 0.2, morale: 0.25 },
  // An outpost camp's step up (yours: 12 scrap, a part, 36 work-hours; scaled as the rest of WORKS) and the camp's
  // defence share until then.
  CAMP: { name: "the outpost camp established", cost: { scrap: 10, buildmat: 1 }, work: 3, DEF: 0.5 }, // yours: 20 scrap, 2 building materials, 20 work-hours
  BUILDMAT_SCRAP: 3, // building materials made from scrap when short (crafting.js buildmat, as yours)
  // Summer water (summer-water 2026-10-10, parity with your governor's summer store, autopilot.js SUMMER_STORE): from
  // SUMMER_LEAD days before summer and through it a group wants its wells for everyone at summer's thirst
  // (weather.js THIRST.summer: a well serves SERVES.water / 1.3 people then), so the extra well goes up in late spring;
  // in summer its water serves that many fewer (provisioned). Abstract: they keep no water stock, so there is no store
  // to fill, no cisterns or barrels, and no thirst; short water only trims their food from the land (FIELDS_MIN).
  SUMMER_LEAD: 21,
};
const W = GROUP_WORKS;

// This world's groups build (a new world sets state.groupWorks); old saves and the hardcore military are built up.
export const groupsBuild = (state, f) => !!state && !!state.groupWorks && !!f && !f.hcMilitary;
/** @returns {Works} */
export function worksAt(f, tile) {
  if (!f.works) f.works = {};
  return f.works[tile] || (f.works[tile] = {});
}
const n = (w, k) => (w && w[k]) || 0;
const mainOf = (f) => f.bases[0];
// The people living at a base: the main base twice a share (conquest.js peopleAt's weights).
export const groupPeopleAt = (f, tile) => peopleAt(f, tile); // beds.js: the people a base's beds are for
function peopleAt(f, tile) {
  const i = f.bases.indexOf(tile);
  if (i < 0) return 0;
  const w = f.bases.length - 1 + 2;
  return Math.max(1, Math.round((f.pop * (i === 0 ? 2 : 1)) / w));
}
// Summer's thirst while it is summer (now), or summer and its last SUMMER_LEAD days of spring (ahead: the wells they plan).
function summerThirst(state, ahead) {
  if (!state || !season || !THIRST) return 1;
  const s = season(state);
  return s.key === "summer" || (ahead && s.key === "spring" && s.daysLeft < W.SUMMER_LEAD) ? THIRST.summer : 1;
}
const wanted = (f, tile, k, state = null) => Math.ceil((peopleAt(f, tile) * (k === "water" ? summerThirst(state, true) : 1)) / W.SERVES[k]);
export function wallGoal(f, tile) {
  if (weightOf(f, "walled", W.WALLED_TYPES.includes(f.type) ? 1 : 0) >= 1) return W.WALL_GOAL.typed; // groupcare.js GROUP_PRIORITIES walled
  return mainOf(f) === tile ? W.WALL_GOAL.home : W.WALL_GOAL.open;
}
// Walls standing at a group's base (conquest.js nativeWalls): the goal itself where they do not build.
export function groupWalls(state, f, tile) {
  const goal = wallGoal(f, tile);
  if (!groupsBuild(state, f)) return goal;
  return Math.min(goal, n(f.works && f.works[tile], "walls"));
}
// 0–1: how far the walls are toward their goal (resolveRaidOnFaction's defence).
export const wallShare = (state, f, tile) => groupWalls(state, f, tile) / Math.max(1, wallGoal(f, tile));
// The flat defence of a group base against a raid or a horde (factions.js resolveRaidOnFaction).
export const groupBaseDefence = (state, f, tile) => (groupsBuild(state, f) ? W.WALL_DEF * (0.5 + 0.5 * wallShare(state, f, tile)) * (isCamp(f, tile) ? W.CAMP.DEF : 1) : W.WALL_DEF) * groupFieldDefence(state, f, tile); // fieldworks.js: their manned watch towers nearby
// A base of theirs still a camp (founded from nothing and not yet established).
export const isCamp = (f, tile) => !!(f && f.works && f.works[tile] && f.works[tile].camp);
// A group's new base founded from nothing starts as a camp (factions.js expansion; this world's groups build).
export function pitchCamp(state, f, tile) { if (groupsBuild(state, f)) worksAt(f, tile).camp = 1; }

// Summed over the group's bases: how many people its water, fields and quarters serve. Quarters: their furniture's
// sleepers too (beds.js furnSleepers), and the tents on their shelf (tents.js groupTentSleepers), pitched at their
// camps for the people there (as your camp's bags go up).
function served(f, k, state = null) {
  return f.bases.reduce((a, t) => a + n(f.works && f.works[t], k) * W.SERVES[k] + (k === "beds" ? furnSleepers(f.works && f.works[t]) : 0), 0) + (k === "water" && state ? groupFieldWells(state, f) * W.SERVES.water : 0) // fieldworks.js: their field wells
    + (k === "beds" ? Math.min(groupTentSleepers(f), f.bases.reduce((a, t) => a + (isCamp(f, t) ? peopleAt(f, t) : 0), 0)) : 0);
}
// 0–1: water and fields for everyone.
export function provisioned(state, f) {
  if (!groupsBuild(state, f)) return 1;
  const p = Math.max(1, f.pop);
  return (Math.min(1, (served(f, "water", state) + groupFetchedWater(state, f)) / (p * summerThirst(state, false))) + Math.min(1, served(f, "farms") / p)) / 2; // grouptrips.js: water carried from the water their bases hold
}
// Food a day from their animal pens (PENS): 0 where they do not build (old saves, the hardcore military).
export const penFood = (state, f) => (groupsBuild(state, f) ? f.bases.reduce((a, t) => a + Math.min(W.PENS.max, n(f.works && f.works[t], "pens")), 0) * W.PENS.food : 0);
// What the group eats a day × this (factions.js): its kitchens' people eat KITCHEN.save less. 1 where they do not build.
// The share of the group's people its kitchens feed (0–1).
function kitchenFed(state, f) {
  if (!groupsBuild(state, f) || !(f.pop > 0)) return 0;
  const fed = f.bases.reduce((a, t) => a + (n(f.works && f.works[t], "kitchen") > 0 ? peopleAt(f, t) : 0), 0);
  return Math.min(1, fed / f.pop);
}
// The share fed hot meals today: as kitchenFed, 0 while the kitchens are cold (no wood: groupKitchenDaily).
export const groupKitchenShare = (state, f) => (f.kitchenCold ? 0 : kitchenFed(state, f));
export const groupEatMult = (state, f) => 1 - W.KITCHEN.save * groupKitchenShare(state, f);
// The share of the group's people cooking in its kitchens (one per KITCHEN.perCook fed): they work no fields.
export const groupCookShare = (state, f) => groupKitchenShare(state, f) / W.KITCHEN.perCook;
// Hot meals keep a group together (factions.js growth, groupcare.js desertion).
export const groupKitchenGrowth = (state, f) => 1 + W.KITCHEN.growth * groupKitchenShare(state, f);
export const groupKitchenMorale = (state, f) => W.KITCHEN.morale * groupKitchenShare(state, f);
// The kitchens' wood a day: a stove each and two meals a person they feed (yours: kitchen.js KITCHEN.wood).
export function groupKitchenWood(state, f) {
  if (!groupsBuild(state, f)) return 0;
  let k = 0, fed = 0;
  for (const t of f.bases) if (n(f.works && f.works[t], "kitchen") > 0) { k++; fed += peopleAt(f, t); }
  return k ? k * W.KITCHEN.wood.stove + fed * W.KITCHEN.wood.head : 0;
}
// Daily (factions.js, before the day's food): the kitchens burn their wood from the woodpile, after `heat` (the
// day's heating); short of it they are cold today (f.kitchenCold). wood0: the woodpile (an unset one at its start).
export function groupKitchenDaily(state, f, heat = 0, wood0 = f.stock.wood) {
  const need = groupKitchenWood(state, f);
  if (!need) { delete f.kitchenCold; return; }
  const wood = Math.max(0, wood0 || 0);
  if (wood - heat >= need) { f.stock.wood = wood - need; f.kitchenCold = false; }
  else f.kitchenCold = true;
}
export const fieldsFactor = (state, f) => W.FIELDS_MIN + (1 - W.FIELDS_MIN) * provisioned(state, f);
export const sleepingRough = (state, f) => groupsBuild(state, f) && served(f, "beds") < f.pop;
export const growthFactor = (state, f) => (sleepingRough(state, f) ? W.CROWDED_GROWTH : 1);
const hasAny = (f, k) => f.bases.some((t) => n(f.works && f.works[t], k) > 0);
export const workshopFactor = (state, f) => (!groupsBuild(state, f) || hasAny(f, "bench") ? 1 : W.WORKSHOP_MIN);
export const storeFactor = (state, f) => (!groupsBuild(state, f) || STORE_KEYS.some((k) => hasAny(f, k)) ? 1 : W.STORE_CAP); // any storage of theirs: the full caps

// Is this base threatened (walls go up ahead of the rest)?
export function threatened(state, f, tile) {
  const g = state.grid, T = W.THREAT, today = day(state);
  if ((state.hordes || []).some((h) => g.distance(h.tile, tile) <= T.HORDE)) return true;
  if ((state.hives || []).some((h) => g.distance(h.tile, tile) <= T.HIVE)) return true; // a destroyed hive leaves the list (hives.js)
  if (f.hitDay != null && today - f.hitDay <= T.RAIDED) return true;
  return state.factions.some((o) => o !== f && o.alive && weightOf(o, "threat", 0) > 0 && o.bases.some((b) => g.distance(b, tile) <= T.GROUP)); // GROUP_PRIORITIES threat
}
// Their stores are filling up (a storehouse): any capped stock near its cap (factionsDaily's caps), or a big larder.
function storesFull(state, f) {
  const p = Math.max(1, f.pop), c = storeFactor(state, f), s = f.stock || {};
  return (s.scrap || 0) >= p * 10 * c * W.STORE_FULL || (s.ammo || 0) >= p * 30 * c * W.STORE_FULL || foodIn(s) >= p * 20; // days of food (foods.js)
}

// The sick bay's tier at a group's bases (the best of them; 0 = none).
export const sickbayTier = (f) => Math.max(0, ...(f.bases || []).map((t) => n(f.works && f.works[t], "sickbay")));
// The next sick bay step at the main base, or null. upper: the tiers above the infirmary (after the workshop).
function sickbayWork(state, f, upper) {
  const tile = mainOf(f);
  const t = n(worksAt(f, tile), "sickbay");
  const next = W.SICKBAY[t]; // the tier above t
  if (!next) return null;
  if (!upper) {
    if (t > 0 || !((f.wounded || 0) > 0 || f.pop >= W.SICKBAY_FIRST)) return null;
    return { tile, type: "sickbay", why: "a sick bay for the wounded", def: next };
  }
  if (t === 0) return null;
  if (f.pop < next.pop / Math.max(0.3, weightOf(f, "heal")) || medOf(f).doc < next.doc || groupSkill(f, "mechanics") < (next.mech || 0)) return null;
  if (SICKBAY_BP[t + 1] && !groupKnows(state, f, SICKBAY_BP[t + 1])) return null; // machines-2: your clinic's and trauma hospital's manuals
  return { tile, type: "sickbay", why: `${next.name} (the sick bay upgraded)`, def: next };
}

// ---------- storage (see the header) ----------
// Their storage works as your buildings (groupbases.js WORKS_BUILDING has the same).
export const STORE_BUILDING = { storebox: "storebox", crates: "crates", shed: "shed", store: "storehouse", warehouse: "warehouse" };
const STORE_KEYS = Object.keys(STORE_BUILDING);
const STORE_WORK = { storebox: "storebox", crates: "crates", shed: "shed", storehouse: "store", warehouse: "warehouse" };
const STORE_NAME = { storebox: ["a storage box", "storage boxes"], crates: ["storage crates", "stacks of storage crates"], shed: ["a storage shed", "storage sheds"], store: ["a storehouse", "storehouses"], warehouse: ["a warehouse", "warehouses"] };
/** A storage work: your building's cost and its hours as crew-days (CREW_HOURS). @param {string} k */
export function storeDef(k) {
  const B = BUILDINGS[STORE_BUILDING[k]];
  return { name: STORE_NAME[k][0], cost: { ...B.cost }, work: Math.max(1, Math.round(B.hours / W.CREW_HOURS)) };
}
// The size of a group's base on your governor's ladder (autopilot.js STORE_WISH): a camp, the main base (hub), an outpost.
const storeSize = (f, tile) => (isCamp(f, tile) ? "camp" : tile === mainOf(f) ? "hub" : "outpost");
/** Why they may not put up storage work k at a base now ("" when they may): your building's rules. @returns {string} */
export function storeLock(state, f, tile, k) {
  const B = BUILDINGS[STORE_BUILDING[k]];
  if (!B) return "no such building";
  const camp = isCamp(f, tile);
  if (camp && B.size && B.size !== "camp") return "an outpost or the main base"; // the warehouse (buildings.js size)
  const max = camp ? CAMP_BASE.build[STORE_BUILDING[k]] || 0 : B.max || 1;
  if (n(f.works && f.works[tile], k) >= max) return max ? `${max} at most` : "not at a camp";
  for (const [sk, v] of Object.entries(B.req || {})) if (groupSkill(f, sk) < v) return `${sk[0].toUpperCase()}${sk.slice(1)} ${v}`;
  return "";
}
// Can they pay a cost now, with `keep` left over (building materials made from scrap as a job's start does)?
function canAfford(f, cost, keep = {}) {
  const s = f.stock || {};
  const bm = Math.max(0, (cost.buildmat || 0) + (keep.buildmat || 0) - (s.buildmat || 0));
  if ((s.scrap || 0) < (cost.scrap || 0) + (keep.scrap || 0) + bm * W.BUILDMAT_SCRAP) return false;
  return Object.entries(cost).every(([k, v]) => k === "scrap" || k === "buildmat" || (k === "parts" ? canPayParts(f, v, "free") : (s[k] || 0) >= v));
}
// A base of theirs as basestorage.js measures it tonight: its core by tier, the buildings its works stand for, the
// stores the supply run will leave there (groupbases.js stockTonight), the main base's armory.
function storageStandIn(state, f, tile, tonight) {
  const h = homesOf(state, f)[tile];
  const stock = tonight[tile] || {};
  if (h && h.real) return { ...h, stock }; // a base of yours they took: its own buildings and tier
  const buildings = [];
  for (const [type, c] of Object.entries(worksBuildings(state, f, tile))) for (let i = 0; i < c; i++) buildings.push({ id: `${tile}:${type}:${i}`, type });
  return { id: h ? h.id : tile, tile, type: tile === mainOf(f) ? "hub" : "outpost", camp: isCamp(f, tile), group: true, stock, armory: (h && h.armory) || [], buildings, construction: [] };
}
/** A group's base's storage tonight (basestorage.js storageOf on storageStandIn). */
export function groupStorage(state, f, tile, tonight = stockTonight(state, f)) {
  return storageOf(state, storageStandIn(state, f, tile, tonight));
}
// The storage a base wants (see the header), or null. room(tile): its storage tonight (memoised a nextWork call).
function storageWork(state, f, tile, room) {
  const h = homesOf(state, f)[tile];
  if (!h || h.real) return null;
  const st = room(tile);
  if (st.outsideKg < STORE_WISH.minKg && !st.outside.gear.length) return null;
  const keep = isCamp(f, tile) ? W.CAMP.cost : {}; // a camp's step up keeps its materials
  const ok = STORE_WISH.ladder[storeSize(f, tile)].map((t) => STORE_WORK[t]).filter((k) => k && !storeLock(state, f, tile, k) && canAfford(f, storeDef(k).cost, keep));
  if (!ok.length) return null;
  const kg = (k) => BUILDINGS[STORE_BUILDING[k]].storeKg;
  const k = ok.find((x) => kg(x) >= st.outsideKg) || ok[ok.length - 1];
  return { tile, type: k, why: `${Math.round(st.outsideKg)} kg of their goods lie outside (room for ${kg(k)} kg)`, def: storeDef(k) };
}

// The next job a group would start: { tile, type, why } or null (all built).
export function nextWork(state, f) {
  if (!groupsBuild(state, f) || !f.bases.length) return null;
  const foodShort = foodIn(f.stock) < f.pop * W.FOOD_SHORT;
  /** @type {Record<number, ReturnType<typeof storageOf>>} */
  const rooms = {};
  let tonight = null;
  const room = (t) => rooms[t] || (rooms[t] = groupStorage(state, f, t, tonight || (tonight = stockTonight(state, f))));
  for (const tile of f.bases) {
    const w = worksAt(f, tile);
    if (n(w, "camp")) return storageWork(state, f, tile, room) || { tile, type: "camp", why: "an outpost camp to establish", def: W.CAMP }; // nothing else there before it (storage boxes for what lies on the ground: a camp has no room)
    const goal = wallGoal(f, tile);
    if (n(w, "water") < wanted(f, tile, "water", state)) return { tile, type: "water", why: summerThirst(state, true) > 1 && n(w, "water") >= wanted(f, tile, "water") ? "water for the summer" : "water" };
    if (foodShort && n(w, "farms") < wanted(f, tile, "farms")) return { tile, type: "farms", why: "food is short" };
    if (n(w, "beds") * W.SERVES.beds + furnSleepers(w) < peopleAt(f, tile)) return { tile, type: "beds", why: "people sleep rough" }; // (n < wanted, with the furniture's sleepers: beds.js)
    if (tile === mainOf(f)) { const jail = jailWork(state, f); if (jail) return jail; }
    if (tile === mainOf(f)) { const sb = sickbayWork(state, f, false); if (sb) return sb; }
    if (n(w, "walls") < goal && threatened(state, f, tile)) return { tile, type: "walls", why: "threatened" };
    const sw = storageWork(state, f, tile, room);
    if (sw) return sw;
    if (n(w, "farms") < wanted(f, tile, "farms")) return { tile, type: "farms", why: "fields for everyone" };
    if (n(w, "walls") > 0 && n(w, "farms") > 0 && n(w, "pens") < W.PENS.max) return { tile, type: "pens", why: "food behind the walls" };
    if (tile === mainOf(f)) { const jail = jailWork(state, f, true); if (jail) return jail; } // communes: later
    if (tile === mainOf(f)) {
      if (!hasAny(f, "bench")) return { tile, type: "bench", why: "a workshop for their gear and ammo" };
      if (!hasAny(f, "store") && storesFull(state, f) && !storeLock(state, f, tile, "store")) return { tile, type: "store", why: "the stores are full", def: storeDef("store") };
      // The kitchen before the workshop's machines (ap-food, user pick 2026-10-11): hot meals stretch the food and lift the
      // group's growth from the day it stands; the machine shop, the upgraded sick bay and the machines come after it.
      if (peopleAt(f, tile) >= W.KITCHEN.size && !n(w, "kitchen")) return { tile, type: "kitchen", why: "hot meals for the people there" };
      if (!hasAny(f, "shop") && !workLock(state, f, "shop")) return { tile, type: "shop", why: "machine parts from their scrap" }; // ai-locks: your machine shop
      const sb = sickbayWork(state, f, true);
      if (sb) return sb;
      const mw = machineWork(state, f, tile);
      if (mw) return mw;
      const ex = lockedWork(state, f, tile);
      if (ex) return ex;
    }
    if (peopleAt(f, tile) >= W.KITCHEN.size && !n(w, "kitchen") && hasAny(f, "bench")) return { tile, type: "kitchen", why: "hot meals for the people there" };
    // Wave 2 cooking: a grain mill and a meat grinder by a kitchen, by your locks, once there is grain to mill or game to grind.
    if (n(w, "kitchen") && !hasAny(f, "mill") && !workLock(state, f, "mill") && groupWantsMill(f)) return { tile, type: "mill", why: "a grain mill: flour and bread" };
    if (n(w, "kitchen") && !hasAny(f, "grinder") && !workLock(state, f, "grinder") && groupWantsGrinder(f)) return { tile, type: "grinder", why: "a meat grinder: sausage that keeps" };
  }
  for (const tile of f.bases) if (n(worksAt(f, tile), "walls") < wallGoal(f, tile)) return { tile, type: "walls", why: "walls" };
  // ai-locks: a reinforced gate in the main base's walls once they stand at their goal (your gate: the Army Engineering
  // Manual; it "needs walls to matter").
  const main = mainOf(f), mw = worksAt(f, main);
  if (!n(mw, "gate") && n(mw, "walls") >= wallGoal(f, main) && !workLock(state, f, "gate")) return { tile: main, type: "gate", why: "a reinforced gate" };
  return hallWork(state, f, main); // beds.js: last of all, a Lodge at the main base to set their furniture in (or null)
}

// ---------- the works your rules ask for (ai-locks 2026-10-11, the user's rule: "AI groups need to have the same
// restrictions and gameplay features") ----------
// What a group must have before it may put one up (LOCKS: your Mechanics minimum, your manual, a workshop first): "" when
// it may, else what it lacks ("Mechanics 4", "the Machinist's Handbook", "a workshop").
export function workLock(state, f, k) {
  const L = W.LOCKS[k];
  if (!L) return "";
  if (L.bench && !hasAny(f, "bench")) return "a workshop";
  if (L.mech && groupSkill(f, "mechanics") < L.mech) return `Mechanics ${L.mech}`;
  if (L.bp && !groupKnows(state, f, L.bp)) return `the ${BLUEPRINTS[L.bp].name}`;
  return "";
}
// Has the group this work at any base? Old saves and the hardcore military (they do not build) count as built up.
export const groupHas = (state, f, k) => !groupsBuild(state, f) || hasAny(f, k);
// A garage's step of a vehicle repair (groupcare.js repairVehicles: yours restores 25 a part with one, 12 without and a
// Mechanics 4+ hand, nothing without either): × 1, × GARAGE_LESS, 0.
export const GARAGE_LESS = 12 / 25;
export const groupGarageMult = (state, f) => (groupHas(state, f, "garage") ? 1 : groupSkill(f, "mechanics") >= 4 ? GARAGE_LESS : 0);
// The rest of them at the main base, in order: a radio station once they are RADIO_POP strong (not the military: an
// army set is a station, as a Military encrypted radio in your armory), a garage once they have a car, a reloading
// bench once they hold the brass for one.
function lockedWork(state, f, tile) {
  const ok = (k) => !hasAny(f, k) && !workLock(state, f, k);
  if (f.type !== "military" && f.pop >= W.RADIO_POP && ok("radio")) return { tile, type: "radio", why: "a radio station" };
  if ((f.vehicles || []).some((v) => v && v.type !== "bike" && !v.destroyed) && ok("garage")) return { tile, type: "garage", why: "a garage for their vehicles" };
  if ((f.stock.brass || 0) >= W.RELOAD_BRASS && ok("reload")) return { tile, type: "reload", why: "a reloading bench for their brass" };
  return null;
}

// ---------- machines (freezer-parts; see the header) ----------
const MACH_ORDER = ["still", "power", "freezer", "sealer"];
// The next machine at a base: the still, the generator, the freezer, the sealer, each with its parts and spares.
function machineWork(state, f, tile) {
  const M = W.MACH, w = worksAt(f, tile);
  if (f.pop < M.pop || !hasAny(f, "bench") || foodIn(f.stock) < f.pop * M.foodDays) return null;
  const why = { still: "fuel from the food surplus", power: "power for a freezer", freezer: "a walk-in freezer for the food", sealer: "a vacuum sealer for packed meals" };
  for (const k of MACH_ORDER) {
    if (n(w, k)) continue;
    if (k === "power" && !(groupKnows(state, f, "genschem") && groupKnows(state, f, "refrig"))) return groupPowerUp(state, f, tile); // your lock; and they build it for a freezer
    if (k === "freezer" && !groupKnows(state, f, "refrig")) return groupPowerUp(state, f, tile); // your lock (the sealer has none: it waits for the generator)
    if (groupSkill(f, "mechanics") < (W.MACH.req[k] || 0)) return groupPowerUp(state, f, tile); // your build rule: a Mechanics 3 hand for the generator, the freezer, the sealer
    const c = W.WORKS[k].cost;
    if ((f.stock.parts || 0) < (c.parts || 0) + M.spare || (f.stock.scrap || 0) < (c.scrap || 0)) return groupPowerUp(state, f, tile);
    return { tile, type: k, why: why[k] };
  }
  return groupPowerUp(state, f, tile);
}
// ---------- their generator's tiers (gen-tiers; see the header) ----------
export const groupGenTier = (w) => (w && n(w, "power") ? Math.max(1, Math.min(GEN_TIERS.length - 1, Math.floor(w.powerTier || 1))) : 0);
// The power their machines at a base want (your POWER_USERS: the freezer 2, the sealer 1), broken ones too (repaired).
export const groupPowerNeed = (w) => (n(w, "freezer") ? POWER_USERS.freezer.need : 0) + (n(w, "sealer") ? POWER_USERS.sealer.need : 0);
// Their generator's fuel a day at a base with `need` drawn, at its tier or at `tier`.
export const groupGenBurn = (w, need, tier = groupGenTier(w)) => (tier ? genBurn(GEN_TIERS[tier], Math.min(need, GEN_TIERS[tier].out)) : 0);
// Why they would not upgrade it now ("" when they would): your governor's rule (autopilot.js autoGenUpgrade).
export function groupPowerUpWhy(state, f, tile) {
  const w = worksAt(f, tile), t = groupGenTier(w), next = W.MACH.tiers[t + 1];
  if (!t) return "no generator";
  if (!next) return "the top tier";
  const need = groupPowerNeed(w);
  if (need <= GEN_TIERS[t].out) return `the generator gives ${GEN_TIERS[t].out} power for ${need} wanted`;
  if (machOf(w, "power").broken) return "broken";
  const lock = workLock(state, f, `power${t + 1}`); // ai-locks' rules: your Mechanics, your manual (groupKnows), a workshop
  if (lock) return `no ${lock}`;
  if ((f.stock.parts || 0) < next.cost.parts + W.MACH.spare || (f.stock.scrap || 0) < next.cost.scrap) return "short of parts or scrap";
  const ff = f.fuelFlow;
  if (!ff || ff.days < GEN_UP.minDays) return "too little fuel history";
  // genUpgradeFuelOk on a stand-in base: their one generator at this tier, the group's fuel.
  const fake = { stock: { fuel: f.stock.fuel || 0 }, buildings: [{ type: "generator", tier: t }], construction: [] };
  const fc = genUpgradeFuelOk(fake, need, fake.buildings[0], W.MACH.floor * f.pop, { income: ff.in, out: ff.out });
  return fc.ok ? "" : fc.why;
}
function groupPowerUp(state, f, tile) {
  if (groupPowerUpWhy(state, f, tile)) return null;
  const t = groupGenTier(worksAt(f, tile));
  return { tile, type: "powerup", why: `more power for their machines (${W.MACH.tiers[t + 1].name})`, def: W.MACH.tiers[t + 1] };
}
// Their fuel in and out a day (f.fuelFlow: 28-day averages of the stock's daily changes, the still's fuel in, the
// generators' burn out), measured once a day before their machines run (groupMachinesDaily).
function groupFuelFlowDaily(f) {
  const st = f.stock, ff = f.fuelFlow || (f.fuelFlow = { in: 0, out: 0, days: 0, mark: st.fuel || 0 });
  const d = (st.fuel || 0) - ff.mark;
  const a = 1 / Math.min(GEN_UP.window, ff.days + 1);
  ff.in += a * (Math.max(0, d) + (ff.made || 0) - ff.in);
  ff.out += a * (Math.max(0, -d) + (ff.burned || 0) - ff.out);
  ff.days++;
  ff.made = 0; ff.burned = 0;
}
// How many machines a group has (trade.js groupPartsTarget: a spare part each on top of its reorder level).
export const groupMachineCount = (f) => (f && f.works ? Object.values(f.works).reduce((a, w) => a + MACH_ORDER.reduce((b, k) => b + Math.min(1, n(w, k)), 0), 0) : 0);
const machOf = (w, k) => { if (!w.mach) w.mach = {}; return w.mach[k] || (w.mach[k] = { wear: 0, spares: 0, broken: false }); };
// Their freezer is on today (any base), and the vacuum sealer hook for the cooking wave (as power.js hasSealer).
export const groupFreezerOn = (f) => !!(f && f.works && f.bases.some((t) => f.works[t] && f.works[t].mach && f.works[t].mach.freezer && f.works[t].mach.freezer.on));
export const groupSealer = (f) => !!(f && f.works && f.bases.some((t) => f.works[t] && f.works[t].mach && f.works[t].mach.sealer && f.works[t].mach.sealer.on));
export function groupMachinesDaily(state, f) {
  if (!groupsBuild(state, f)) return;
  const M = W.MACH, d = day(state);
  if (f.works && f.bases.some((t) => n(f.works[t], "power"))) groupFuelFlowDaily(f); // gen-tiers: their fuel in and out (the upgrade's fuel rule)
  for (const tile of f.bases) {
    const w = f.works && f.works[tile];
    if (!w || !MACH_ORDER.some((k) => n(w, k))) continue;
    const st = f.stock;
    // Repairs first: a broken machine is fixed the day they can pay your proper repair.
    for (const k of MACH_ORDER) {
      if (!n(w, k)) continue;
      const m = machOf(w, k);
      if (!m.broken) continue;
      const fx = k === "power" ? genFixture(groupGenTier(w)) : FIXTURES[M.fx[k]]; // gen-tiers: a bigger generator's repair
      const cost = fx.repair.cost;
      if (groupSkill(f, "mechanics") < (fx.repair.min || 0)) continue; // your proper repair's Mechanics (machines-2)
      if (Object.entries(cost).every(([key, v]) => (key === "parts" ? canPayParts(f, v, "machine") : (st[key] || 0) >= v))) {
        for (const [key, v] of Object.entries(cost)) { if (key === "parts") payParts(f, v, "machine"); else st[key] -= v; }
        m.broken = false; m.wear = WEAR.repairWear; f.machParts = (f.machParts || 0) + (cost.parts || 0);
      }
    }
    const ok = (k) => n(w, k) > 0 && !machOf(w, k).broken;
    const ran = {};
    // The still: their surplus food into fuel.
    const ff = f.fuelFlow;
    if (ok("still") && foodIn(st) - M.still.food >= f.pop * M.foodDays && (st.fuel || 0) < f.pop * 3) { takeFood(st, M.still.food, { state }); // foods.js: the soonest to spoil goes in the mash
      st.fuel = (st.fuel || 0) + M.still.fuel; ran.still = true; if (ff) ff.made = (ff.made || 0) + M.still.fuel; }
    // The generator, while the freezer or the sealer draws and there is any fuel (coarse: a day's fuel at its tier and
    // the load, or the last of it). gen-tiers: the machines served in your order (the freezer, then the sealer) up to
    // the tier's power; the burn by your genBurn (tier 1: the flat 2).
    const t = groupGenTier(w), out = t ? GEN_TIERS[t].out : 0;
    let load = 0;
    const served = {};
    for (const k of ["freezer", "sealer"]) if (ok(k) && load + POWER_USERS[k].need <= out) { served[k] = true; load += POWER_USERS[k].need; }
    if (ok("power") && load > 0 && (st.fuel || 0) > 1e-6) {
      const burn = groupGenBurn(w, load);
      const was = st.fuel;
      st.fuel = Math.max(0, st.fuel - burn); ran.power = true;
      if (ff) ff.burned = (ff.burned || 0) + (was - st.fuel);
    }
    for (const k of ["freezer", "sealer"]) { if (n(w, k)) { machOf(w, k).on = !!ran.power && ok(k) && !!served[k]; ran[k] = machOf(w, k).on; } }
    // The freezer on: their soonest-to-spoil food (up to M.room days) ages at a twentieth (factions.js ageCoarse frozen).
    // Wear, spares, breaking (your fixtures' numbers, coarse).
    for (const k of MACH_ORDER) {
      if (!n(w, k)) continue;
      const m = machOf(w, k), def = k === "power" ? genFixture(groupGenTier(w)) : FIXTURES[M.fx[k]]; // gen-tiers: a bigger generator wears faster
      if (m.broken) continue;
      if (ran[k]) {
        m.spares += 1 / (def.spares || 1e9);
        if (m.spares >= 1) { if (payParts(f, 1, "machine")) { m.spares -= 1; m.noSpares = false; f.machParts = (f.machParts || 0) + 1; } else m.noSpares = true; }
      }
      m.wear = Math.max(0, m.wear + (ran[k] ? def.use : def.idle || 0) - M.mend + (m.noSpares ? WEAR.noSpares : 0));
      const p = m.wear >= WEAR.breakAt ? 1 : m.wear >= WEAR.riskFrom ? ((m.wear - WEAR.riskFrom) / (WEAR.breakAt - WEAR.riskFrom)) ** 2 * WEAR.riskMax : 0;
      if (p > 0 && hash01(state.seed, "gbrk", f.name, tile, k, d) < p) { m.broken = true; m.on = false; f.machBroke = (f.machBroke || 0) + 1; }
    }
  }
  if (f.fuelFlow) f.fuelFlow.mark = f.stock.fuel || 0; // the day's machines done: the mark for tomorrow's flows (groupFuelFlowDaily)
}

// ---------- their machine parts (machines-2; see the header) ----------
// What they keep in parts: PARTS.keep, a part a machine they have, and the next machine's parts and spares.
export function partsWant(state, f) {
  const P = W.PARTS, M = W.MACH;
  let next = 0;
  const w = f.bases.length ? f.works && f.works[mainOf(f)] : null;
  if (w && f.pop >= M.pop) { const k = MACH_ORDER.find((x) => !n(w, x)); if (k) next = (W.WORKS[k].cost.parts || 0) + M.spare; }
  return P.keep + P.perMachine * groupMachineCount(f) + next;
}
// Parts a day at their machine shop (0 without one): rate × people, half under Mechanics 4, see the header.
export function partsRate(state, f) {
  const P = W.PARTS;
  if (!groupsBuild(state, f) || !hasAny(f, "shop")) return 0; // ai-locks: a machine shop of theirs (built with your manual and Mechanics 4, or taken over)
  return P.rate * (groupSkill(f, "mechanics") >= P.mech ? 1 : P.below) * Math.min(P.popMax, Math.max(P.popMin, (f.pop || 0) / P.pop)); // your station's rule: Mechanics 4+, else half the days fail
}
export function groupPartsDaily(state, f) {
  const P = W.PARTS, st = f.stock;
  const rate = partsRate(state, f);
  if (!rate || groupMachParts(f) >= partsWant(state, f)) return 0; // the earmark full: the workshop rests
  const scrap = (rate * P.scrap) / (groupSkill(f, "mechanics") >= P.mech ? 1 : P.below); // a failed day's scrap is spent too (as yours)
  if ((st.scrap || 0) - scrap < P.scrapKeep * Math.max(1, f.pop)) return 0;
  st.scrap -= scrap;
  f.partsWip = (f.partsWip || 0) + rate;
  const made = Math.floor(f.partsWip + 1e-9);
  if (made > 0) { f.partsMach = groupMachParts(f) + made; f.partsWip -= made; st.parts = (st.parts || 0) + made; f.partsMade = (f.partsMade || 0) + made; } // earmarked for the machines
  return made;
}

// ---------- the earmark (see the header) ----------
// Parts kept for the machines (the workshop's), and the parts anything else may use.
export const groupMachParts = (f) => Math.min(Math.max(0, (f && f.partsMach) || 0), Math.max(0, (f && f.stock && f.stock.parts) || 0));
export const groupFreeParts = (f) => Math.max(0, ((f && f.stock && f.stock.parts) || 0) - groupMachParts(f));
// Can they pay n parts for this use? machine: any part (the earmark first); free: only the parts above the earmark;
// vehicle: the free parts, the rest from the earmark at two for one.
export function canPayParts(f, n, use = "free") {
  if (n <= 0) return true;
  if (use === "machine") return (f.stock.parts || 0) >= n - 1e-9;
  const free = groupFreeParts(f);
  if (use === "vehicle") return free >= n - 1e-9 || groupMachParts(f) >= 2 * (n - free) - 1e-9;
  return free >= n - 1e-9;
}
// Pays them (false, and nothing paid, when they cannot).
export function payParts(f, n, use = "free") {
  if (n <= 0) return true;
  if (!canPayParts(f, n, use)) return false;
  const e = groupMachParts(f), free = groupFreeParts(f);
  if (use === "machine") { f.stock.parts -= n; f.partsMach = Math.max(0, e - n); return true; }
  if (use === "vehicle" && free < n) { const fromE = 2 * (n - free); f.stock.parts -= free + fromE; f.partsMach = Math.max(0, e - fromE); return true; }
  f.stock.parts -= n;
  return true;
}

// ---------- the groups' manuals (machines-2, the user's rule "AI groups need to have the same restrictions and
// gameplay features"; your blueprints, blueprints.js, done coarsely) ----------
// f.tech = { known: [ids], held: [ids], study: { id: hours } }.
//   Start: what a start of yours has (nothing known), but traders and communes know what their wares lists hold
//   (blueprints.js WARE_BP: traders every one, communes the canning, water and refrigeration papers), and the military
//   and the fortress hold the copies of theirs, to study.
//   Found: every hour a scavenging party searches a site (aiscav.js), a manual by your odds (blueprints.js rollBlueprint:
//   the site's list, ZONE_P by its zone or 0.25 at a crash, × the loot left), one they neither know nor hold, carried home.
//   Bought: every TECH.buyEvery days, with TECH.buyP (the traders' wares chance), one they lack from a traders group
//   that knows it and is not hostile to them (relation over TECH.buyRel), for its value × TECH.markup in scrap they
//   can spare (above TECH.keepScrap a head).
//   Studied: one at a time, READ_HOURS (6) a day, as one reader of yours, while they have someone at the manual's
//   skill: their mechanic (groupcare.js GROUP_PRIORITIES mechanic) for Mechanics and Crafting, their doctor (medOf) for
//   Medicine, TECH.farm for Farming. Done after its hours: known for good.
// Old worlds (no state.groupWorks) and the hardcore military know everything (built up, as their works).
export const TECH = { buyEvery: 7, buyP: 0.3, buyRel: -10, markup: 1.25, keepScrap: 3, farm: { commune: 6, dflt: 3 } };
const SICKBAY_BP = { 3: "fieldsurgery", 4: "hospitalops" }; // the sick bay tier → your hospital's manual
export function groupTech(f) {
  if (!f.tech || !Array.isArray(f.tech.known)) {
    const w = WARE_BP[f.type];
    const knows = f.type === "traders" || f.type === "commune";
    f.tech = { known: knows && w ? [...w.list] : [], held: !knows && w ? [...w.list] : [], study: {} };
  }
  return f.tech;
}
export const groupKnows = (state, f, id) => !!f && (!groupsBuild(state, f) || groupTech(f).known.includes(id));
const lacks = (f, id) => { const T = groupTech(f); return !T.known.includes(id) && !T.held.includes(id); };
// The group's best at a skill: its best person at home who is up to work (members.js; docs/adr/0001-ai-parity.md: the
// people's own skills, as your base's best hand), else the old coarse figure by type (a group not yet people).
// A band with no base (nomads.js, visitors.js: band.people, location "band") reads its own people, all with it.
export function groupSkill(f, sk) {
  const people = f && Array.isArray(f.people) ? f.people.filter((s) => s.alive !== false && s.location && (s.location.kind === "member" || s.location.kind === "band") && s.location.partyId == null && (s.health ?? 100) >= 60) : [];
  if (people.length) return Math.max(0, ...people.map((s) => skill(s, sk)));
  if (sk === "medicine") return medOf(f).doc;
  if (sk === "farming") return TECH.farm[f.type] ?? TECH.farm.dflt;
  return weightOf(f, "mechanic", 3);
}
// A manual found in a search hour at a site (aiscav.js), by your odds; its id or null. salt: the party.
export function groupFindBlueprint(state, f, tileId, salt = "") {
  const t = state.tiles[tileId];
  if (!groupsBuild(state, f) || !t || !t.loc) return null;
  const open = siteBlueprints(t.loc.type).filter((id) => lacks(f, id));
  if (!open.length) return null;
  const p = (CRASH_BP[t.loc.type] ? 0.25 : ZONE_P[t.loc.zone] || 0.03) * Math.max(0.15, Math.min(1, t.loot ?? 1));
  if (hash01(state.seed, "gbpf", f.name, tileId, state.hour, salt) >= Math.min(0.9, p)) return null;
  return open[Math.floor(hash01(state.seed, "gbpk", f.name, tileId, state.hour, salt) * open.length) % open.length];
}
export function groupGotBlueprint(f, id) { if (BLUEPRINTS[id] && lacks(f, id)) groupTech(f).held.push(id); }
// A day of it: a purchase now and then, a day's study.
export function groupTechDaily(state, f) {
  if (!groupsBuild(state, f)) return;
  const T = groupTech(f), d = day(state);
  if (f.type !== "traders" && (d + Math.floor(hash01(state.seed, "gbpb", f.name) * TECH.buyEvery)) % TECH.buyEvery === 0 && hash01(state.seed, "gbpbp", f.name, d) < TECH.buyP) {
    const traders = state.factions.filter((o) => o !== f && o.alive && o.type === "traders" && relation(state, f, o) > TECH.buyRel);
    const want = BP_KEYS.filter((id) => lacks(f, id) && traders.some((o) => groupKnows(state, o, id)));
    if (want.length) {
      const id = want[Math.floor(hash01(state.seed, "gbpbk", f.name, d) * want.length) % want.length];
      const cost = Math.ceil((BLUEPRINTS[id].value * TECH.markup) / Math.max(0.1, SUPPLIES.scrap.value || 1));
      if ((f.stock.scrap || 0) - cost >= TECH.keepScrap * f.pop) { f.stock.scrap -= cost; T.held.push(id); f.bpBought = (f.bpBought || 0) + 1; }
    }
  }
  const id = T.held.find((x) => !T.known.includes(x) && groupSkill(f, BLUEPRINTS[x].skill) >= BLUEPRINTS[x].min);
  if (!id) return;
  T.study[id] = (T.study[id] || 0) + READ_HOURS;
  if (T.study[id] >= BLUEPRINTS[id].hours - 1e-9) { T.known.push(id); T.held = T.held.filter((x) => x !== id); delete T.study[id]; }
}

// A day of building for one group (factions.js factionsDaily).
export function groupWorksDaily(state, f) {
  if (!groupsBuild(state, f)) return;
  groupTechDaily(state, f); // machines-2: their manuals, bought and studied
  groupPartsDaily(state, f); // machines-2: parts from their workshop before the day's machines and builds
  groupBedsDaily(state, f); // beds.js: a piece of furniture crafted and set in their hall
  // A job at a base they no longer hold is dropped (the materials are lost with the base).
  if (f.job && !f.bases.includes(f.job.tile)) f.job = null;
  // noidle (AI parity with your governor: nobody stays a builder with nothing to build): the day's crew-days go to
  // work that exists. A job finished part-way through the day hands the rest of them to the next job (f.crewCarry =
  // { n, day }, spent on it the next day with that day's crew: they were lost); with nothing to build they stay on the land, where
  // the fields and the hunting count every working head anyway (factions.js), and nothing is carried.
  // f.crewDay = { day, crew (today's), carried (from yesterday), built, carry (to the next job), land }.
  const today = (Math.max(1, workingPeople(f) / W.CREW) + (f.prisonWork || 0) / W.CREW) * MEAL_WORK_SHARE; // their prisoners work too (groupjails.js); the ill rest (groupcare.js GROUP_ILL); meals.js: the meal hours off
  const carried = f.crewCarry && f.crewCarry.day === day(state) - 1 ? f.crewCarry.n : 0; // yesterday's spare, for today's job
  delete f.crewCarry;
  const cd = f.crewDay = { day: day(state), crew: today, carried, built: 0, carry: 0, land: 0 };
  if (!f.job && !startWork(state, f)) { cd.land = today + carried; groupMachinesDaily(state, f); return; } // nothing to build: on the land
  const crew = today + carried;
  const use = Math.min(crew, Math.max(0, f.job.left));
  f.job.left -= use;
  cd.built = use;
  if (f.job.left <= 1e-9) {
    finishWork(state, f);
    if (crew - use > 1e-9) { cd.carry = crew - use; f.crewCarry = { n: cd.carry, day: day(state) }; } // the next job's, tomorrow
  }
  groupMachinesDaily(state, f); // freezer-parts: the still, the generator, the freezer and the sealer run, wear and break
}
// The next job (nextWork) started: paid from the stores, or salvaged. false: nothing to build.
function startWork(state, f) {
  const next = nextWork(state, f);
  if (!next) return false;
  const def = next.def || W.WORKS[next.type]; // a jail step brings its own (groupjails.js STEPS)
  // Short of building materials: made from their scrap, as you would (crafting.js buildmat).
  const bmShort = Math.max(0, (def.cost.buildmat || 0) - (f.stock.buildmat || 0));
  if (bmShort && (f.stock.scrap || 0) >= bmShort * W.BUILDMAT_SCRAP + (def.cost.scrap || 0)) { f.stock.scrap -= bmShort * W.BUILDMAT_SCRAP; f.stock.buildmat = (f.stock.buildmat || 0) + bmShort; }
  const use = MACH_ORDER.includes(next.type) || next.type === "powerup" ? "machine" : "free"; // the earmark only for a machine (gen-tiers: an upgrade too)
  // Wood (woodwork): from the pile above their winter's keep; the rest their crew cuts as part of the job (extra
  // crew-days by their land), so wood never sends them to salvage.
  const can = Object.entries(def.cost).every(([k, v]) => (k === "wood" ? true : k === "parts" ? canPayParts(f, v, use) : (f.stock[k] || 0) >= v));
  let cut = 0;
  if (can) for (const [k, v] of Object.entries(def.cost)) {
    if (k === "parts") payParts(f, v, use);
    else if (k === "wood") { const pay = Math.max(0, Math.min(v, Math.floor((f.stock.wood || 0) - f.pop * W.WOOD.keepHead))); f.stock.wood = (f.stock.wood || 0) - pay; cut = v - pay; }
    else f.stock[k] -= v;
  }
  const cutDays = cut > 0 ? cut / (W.WOOD.cutDay * Math.max(W.WOOD.landMin, groupWoodLand(state, f))) : 0;
  f.job = { tile: next.tile, type: next.type, left: def.work * (can ? 1 : W.SALVAGE) + cutDays, paid: can, ...(cut > 0 ? { cut } : {}) };
  return true;
}
// The job done: what it builds.
function finishWork(state, f) {
  if (f.job.type === "jail") jailBuilt(state, f, f.job.tile);
  else if (f.job.type === "camp") delete worksAt(f, f.job.tile).camp; // established
  else if (f.job.type === "powerup") { const w = worksAt(f, f.job.tile); if (n(w, "power")) w.powerTier = groupGenTier(w) + 1; } // gen-tiers: the generator a tier up
  else { const w = worksAt(f, f.job.tile); w[f.job.type] = n(w, f.job.type) + 1; }
  f.built = (f.built || 0) + 1;
  f.job = null;
}

// The Groups card's Kitchen line (ui/diplomacy.js): "Kitchen: hot meals for 24 of 31 (−8% food, growth +15%)" or "".
export function groupKitchenText(state, f) {
  const fed = kitchenFed(state, f);
  if (!(fed > 0)) return "";
  const people = Math.round(fed * f.pop);
  if (f.kitchenCold) return `Kitchen: cold, no wood (${people} of ${f.pop} would be fed)`;
  return `Kitchen: hot meals for ${people} of ${f.pop} (−${Math.round(W.KITCHEN.save * fed * 1000) / 10}% food, growth +${Math.round(W.KITCHEN.growth * fed * 100)}%, fewer desert)`;
}
const jailStepName = (f) => { const t = (f.jails && f.jails[f.job.tile]) || 0; return (GROUP_JAIL.STEPS[t + 1] || GROUP_JAIL.STEPS[1]).name; };
// "water, 2 fields, quarters for 16, walls 2/4 · building a wall" (the Groups tab).
export function worksText(state, f) {
  if (!groupsBuild(state, f) || !f.bases.length) return "";
  const t = { water: 0, farms: 0, beds: 0, bench: 0, store: 0, storebox: 0, crates: 0, shed: 0, warehouse: 0, still: 0, power: 0, freezer: 0, sealer: 0, kitchen: 0, mill: 0, grinder: 0, shop: 0, radio: 0, garage: 0, reload: 0, gate: 0 };
  for (const b of f.bases) for (const k of Object.keys(t)) t[k] += n(f.works && f.works[b], k);
  const main = mainOf(f);
  const bits = [];
  if (t.water) bits.push(t.water > 1 ? `${t.water} wells` : "a well");
  if (t.farms) bits.push(t.farms > 1 ? `${t.farms} fields` : "a field");
  if (t.beds) bits.push(`quarters for ${t.beds * W.SERVES.beds}`);
  bits.push(`walls ${groupWalls(state, f, main)}/${wallGoal(f, main)}`);
  if (t.bench) bits.push("a workshop");
  for (const k of ["warehouse", "store", "shed", "crates", "storebox"]) if (t[k]) bits.push(t[k] > 1 ? `${t[k]} ${STORE_NAME[k][1]}` : STORE_NAME[k][0]); // storage, the biggest first
  if (t.still) bits.push("an ethanol still");
  if (t.power) { const tiers = f.bases.map((b) => groupGenTier(f.works && f.works[b])).filter(Boolean); const top = Math.max(1, ...tiers); bits.push(top > 1 ? W.MACH.tiers[top].name : "a generator"); } // gen-tiers
  if (t.freezer) bits.push(`a walk-in freezer${groupFreezerOn(f) ? " (on)" : " (off)"}`);
  if (t.sealer) bits.push("a vacuum sealer");
  if (t.kitchen) bits.push(`${t.kitchen > 1 ? `${t.kitchen} kitchens` : "a kitchen"}${f.kitchenCold ? " (cold: no wood)" : ""}`);
  if (t.mill) bits.push("a grain mill"); // wave 2 cooking
  if (t.grinder) bits.push("a meat grinder");
  for (const k of ["shop", "radio", "garage", "reload", "gate"]) if (t[k]) bits.push(W.WORKS[k].name); // ai-locks
  const bay = sickbayTier(f);
  if (bay) bits.push(W.SICKBAY[Math.min(W.SICKBAY.length, bay) - 1].name);
  const camps = f.bases.filter((b) => isCamp(f, b)).length;
  if (camps) bits.push(`${camps === 1 ? "an outpost camp" : `${camps} outpost camps`} not yet established`);
  const jobName = () => (f.job.type === "jail" ? jailStepName(f) : f.job.type === "camp" ? W.CAMP.name : f.job.type === "powerup" ? `${(W.MACH.tiers[groupGenTier(worksAt(f, f.job.tile)) + 1] || W.MACH.tiers[W.MACH.tiers.length - 1]).name} (the generator upgraded)` : f.job.type === "sickbay" ? (W.SICKBAY[n(worksAt(f, f.job.tile), "sickbay")] || W.SICKBAY[W.SICKBAY.length - 1]).name : W.WORKS[f.job.type].name);
  const job = f.job ? ` · building ${jobName()}` : "";
  return `${bits.join(", ")}${job}`;
}
