# Base economy: work, food, wood, tools, materials, power and hauling

Detail for section 3 of [docs/agents/features.md](../agents/features.md) (what runs on a base). The base itself (tiers, map, building, storage, beds) is in [bases.md](bases.md).

`[name]` is `prototype/src/sim/name.js`; `ui/name` is `prototype/src/ui/name.js`.

## No idle workers
- The user's requests 2026-10-20: "There should never be idle workers for any profession. If there are no buildings to build do not leave any survivors as builders" [noidle]. Test `tools/noidletest.js`.
- **A job has work** when its activity line is not idle or stalled. Per role: a build or clearing job not waiting for its materials, a field work, a repair or upkeep; plots to tend; a lit kitchen with food; a patient, anyone hurt or ill, or a trainee for a medic; a craft job they can do; a running station; ruins not picked clean; the land for the outdoor jobs; a learner or a book; guard and trainee always.
- Rest, sleep, sickness, eating, off hours and too weak to work are not idle.
- **Governor**: anyone it left in a role with no work gets the most useful job that has work (planNoIdle: the base's needs, wood under 1,500, else a lookout); its own priorities untouched; builders only with work they can do now (nothing on alert, nothing for a build waiting on materials) [autopilot planRoles 5 / 11, idlework baseNeeds].
- **Manual roles**: someone whose job has no work this hour helps the builders, the felling marked on the base map (or the wood for the cold), Fetch water while it runs short, the fields, else stands guard. They keep their role (s.helpWas; back to it the hour it has work; counted at midnight at what they helped with; a hand-picked role holds).
  - Activity line "No building to do: helping chop wood"; the role drop-down and the Idle list show their own job.
  - A quiet alert (tone info) lists roles with no work at each base and who helps where, until the stalled-job alert takes over at 2 days [noidle helpHour / helpRestore / helpDayRoles / noWorkRoles, world.js, activity dayJob, ui/activity noWorkAlerts].
- **AI parity**: a group's crew-days are never left on work that does not exist; a job finished mid-day hands its spare crew-days to the next job; a day with nothing to build leaves the crew on the land (groupworks groupWorksDaily f.crewCarry / f.crewDay).

## Farming: placed crop plots
- The user's requests 2026-10-22: "Farm plots are placeable remove the hardcoded number of plots per base level. The player sets them up with 2x2 tiles for each plot on soil tiles", "Farm plots can only be set on soil tiles in a base map".
- Each Farm plot is one 2 × 2 crop plot on the base map (buildings farm_plot, basemap FOOT farm_plot, a field), only on soil (grass and dirt; never road, a paved lot or a ford: basemap NOT_SOIL / SOIL_WHY), queued only while the map has free soil for one more (basemap soilRoom, buildings canBuild SOIL_FULL).
- No free plots by tier any more (farmSlots: Farm plots less the pens' pasture; the old camp 1 / shelter 2 / outpost 4 / hub 8 is gone). Crop plots do not grow the yard.
- The governor digs its tier's first few (autopilot GOV_PLOTS) and more while its farmers are short.
- A save from before has its plots dug and its tiers' beds kept (buildings migrateCropPlots, save.js state.cropV).

## Winter's lean months
- The user's request 2026-10-21: "Winters can kill crops easier, food is hard to find in winter wood can be found but yields less in winter".
- **Frost**: hard freezes kill tender crops ×1.5 in winter and ×1.3 in late autumn and early spring. Outdoors a cold snap takes hardy crops too (a third of a hardy crop over a whole winter; deep snow halves it; a greenhouse none). Log line "❄ the frost killed …" [winter `FROST` `frostPhase` `frostMult` `coldSnap`; weather `cropDamage` (farmers' plans read it too); farming `farmingDaily` `out.frost`].
- **Winter yields**: forage 0.08, game 0.6 (hunts, snares, the cabin), fish 0.5, wood 0.7 (trips and felling), scavenged food ×0.85 [winter `WINTER` `winterScavFood`; foraging `seasonForage`, hunting `seasonGame` `seasonFish`, woodcutting `seasonWood`, woodwork `chopRate`, scavenge `searchHour`, economy `scavTrip`].
- **AI parity**: the wild share of their food follows the season (winter ×0.86, autumn ×1.08, a year's mean 1); their wood and finds follow your rules [winter `groupWildSeason`; grouptrips `groupFoodLand` `groupWoodLand`; aiscav `haulFor`].

## Woodcutting and heating
Modules: [woodcutting, woodwork, upkeep, needs]. Test `tools/woodworktest.js`.

### Wood as a supply
- The supply `wood` was named Firewood until 2026-10-20 ("Convert all fire wood into just wood so it can be used for fueling and uses as a building material"). It is fuel and a building material.
- Taken from the stores like scrap; the hub starts with 1,000 (700 for building).

### Wooden builds are mostly wood
- The user's picks 2026-10-20: "Raise the wood costs for builds including walls", "Add wood to the cost of builds that makes sense". Scrap or parts cover nails, hinges, tin and fittings; worth about 50 wood a scrap in all.
- **Defences**: wooden wall 40 wood a 1×4 (was 8), log palisade 64, gate 60 + a scrap (logs 90 + 2), wall stand 50 + a scrap; barricades and spike pits 250; barbed wire's stakes 75; trench 300; watchtower 550.
- **Buildings**: farm plot 300 for its two plots, then 40 for the one placed 2 × 2 plot since 2026-10-22 ([placed crop plots](#farming-placed-crop-plots)); bunkhouse 600 + 7 scrap; barracks 600 (expanding a bunkhouse 400); storage shed and storehouse 400; root cellar 300; cold store 400; preserving room and Kitchen 300; hunting cabin 450; drying rack 250; animal pen 500; common room and chapel 400; infirmary 150; garage 300; a well's windlass 100; crafting bench 100 (10 scrap and a part, the asked 10–12 scrap kept); workbench 200; ammo bench 150; barrel rack 100; huts to barns 350–2,250.
- **Crafts**: siege ladder 100 (it broke down into 90 wood from 4 scrap), ram 150, hand cart 120, spiked bat 15, crossbow 20, makeshift rod 5.
- **Field works**: roadblock 350, watch tower 500, stockpile 250, hunting blind 150, spike traps 300.
- None on anything metal, electrical, masonry or medical-grade (toolbench, machines, generator, freezer, radio, cistern, warehouse, armory, reinforced gate, hospitals above the infirmary). Tents, beds, shelves, lockers, crates and boxes have their own prices ([bases.md](bases.md#wood-in-furniture-and-fittings)).
- Modules: [buildings BUILDINGS / WALL_TIERS / STAND / BARRACKS_UP / WATER_BARREL, crafting CRAFTS, fieldworks FIELD.KINDS].
- **AI groups' works** take a quarter of yours (fields 75, quarters 150, a wall 250, pens 125, a workshop 50, a kitchen 75; storage at your costs) from their woodpile above WOOD.keepHead a head. What it cannot spare their crew cuts as part of the job (WOOD.cutDay a crew-day by their wood land: more crew-days, never salvage for wood) [groupworks groupWorksDaily].
- **Governor's reserve**: leaves the fires their days of wood and a share of the coming cold's need, rising from none 150 days out (all of it in season), for any build over 100 wood but beds (autopilot planBuilds buildWoodKeep / WOOD_BUILD_SMALL).

### What a base makes a day
- A woodcutter on a trip 45–160 (forest, by hand or with a fire axe; farmland a quarter); one felling marked trees about 330; a builder clearing about 600 (a tree: 4 work-hours, 120 wood).
- **By tool** [woodcutting CHOP / chopMult, basescatter CLEAR.NO_TOOL]: bare hands ×0.5 (WOOD.hands), felling axe ×2, fire axe ×1.8, hatchet or bow saw ×1.5, tomahawk ×1.4, makeshift axe ×1.3, machete ×0.9. A tree, log or stump on the base map with no cutting tool there takes 2.5 times as long.

### Felling on the base map
- Woodcutters (Cut wood) work every clearing job that gives wood (trees, logs, stumps, bushes, fences: woodwork isChopJob) ahead of their trips, first in the queue first, in the job's daylight hours at a work-hour an hour for an average one (chopRate: skill, health, season, a storm). One out on a trip finishes it first. Builders still work them from the queue. The job opens Cut wood by itself (work.js).
- Activity line "Fell a tree: 40%"; the base map's clearing tag and the Clearing list name who is on it [woodwork chopHour / chopHands, jobtrips stepPerson, activity tripJobActivity, basemap F.clearing who, ui/isoview, ui/basemap clearingList].

### The governor fells for wood
- govWoodwork, every 2 hours: when woodpile + queued felling < the fires' reserve (woodNeed dailyKeep, or the share of the cold's need its next big wooden build leaves back: buildWoodKeep, all of it in the stocking season) + its next builds' wood (the Ring wall's still to come in, the next wish's), it queues the nearest trees and fallen logs beyond the walls (6 cells past the ring: the yard's layout untouched), one job a tree, at most 3 of its own waiting.
- Queued behind its builds (builders fell when there is nothing else), or at the front while the pile is under the fires' days plus three days of the daily burn (the opening, after the first bunkhouse).
- **Clears ahead**: the sites of builds it has queued (siteWaits at once) and of the one it will queue next (woodwork siteFor: where the auto layout would put it), only where no open ground was left, one such site at a time.
- Modules: [autopilot govWoodwork / nextBuildWood, woodwork queueChop / nearestTrees / clearAhead / siteFor].

### Heating
- Wood first, then fuel. Every fire burns it: a camp's or shelter's fire by the hour (warmth, boiling, the pot); the night's fire at every base on a cool night; the whole day's heating in the frost; the boiler and the Kitchen's stove [woodcutting, upkeep, needs].

## Teamwork on job trips
- The user's request 2026-10-20: "People that do the same job in the same tile help each other and if an event occurs it involves both of them including battles. If loot is gathered it goes to one of them randomly".
- **A crew**: two or more of one base out on the same job trip to the same tile at the same time (teamwork crewKey: base, job, tile and a route's end; generic by job, so haulers pair up too).
- **Load**: each one's load × teamMult (+15% a pair, +5% each one more, at most +25%; hunting −10% a member past the first for the noise, at most −15%; Fetch water none); the land thinned by it too [teamwork TEAM, teamMult, noteMates; jobtrips rollLoad].
- **One trouble roll** for the crew (the first to set out covers mates whose trip lies within its own: t.evLead / t.evBy), involving everyone out with them when it fires (t.ev.crew, the mates' t.follow: they hold while its card or battle is open). Uses their worth together, the crew's best Scouting, Stealth, Speech or Scavenging; hits shared by the dice; an accident on one (a mate's kit dresses a cut); all run or hold. The dead × (1 + 0.4 per extra member) (2 met by a pair: 3); an animal leaves a crew alone more often [tripevents ctxOf, crewOf, settle, followHold; teamwork crewDead].
- **"Attacked together"**: the card names them all; the battle map holds the whole crew with what each carries; an intro line names them [loneattack attackCard o.crew, tripAttackSetup crew; combat setup.intro; tripevents settleBattle].
- **Loot**: a find as an item goes to one of them by the dice (the seed, the event's seed, the people's keys), into their carry, the next one when full, the armory when home [teamwork shareLoot; tripevents bankFinds]. Bulk supplies into the stores as before.
- **On screen**: "Felling trees with Mara at …"; the Work now panel frames a crew (🤝); the map draws a crew as one figure [jobtrips tripState; ui/activity wnCrews; ui/workermap].
- **AI groups**: their people out make crews of groupCrew a job; a crew of two or more fells a build's wood teamMult faster (groupworks startWork) and loses ×0.6 the dead and ×0.75 the wounds on the land (grouptrips groupTripLosses); daily wood and food stay per head.

## Tools as prerequisites
- The user's request 2026-10-21: "Add pre-requisite items needed to be in the base inventory to build certain buildings and craft certain items such as needing a tool kit item or axe or hammer etc". Test `tools/toolreqstest.js`.
- A build or recipe lists the tool kinds it needs (hammer, saw, axe, shovel, wrenches, drill, pliers, welding kit, sewing kit; several at once), each covered by any of its items (a tool kit counts as hammer, saw, wrenches and pliers), kept in the base's armory or on someone there when queued (a team's field craft: what the team carries).
- Never used up; the makeshift ones (hammer, saw, axe, shovel made from scrap anywhere, no tools needed) lose a use a job.
- **New items**: tool kit, hand saw, bow saw, felling axe, shovel, brace and bit, welding kit, sewing kit, the four makeshift tools. Own loot tables and dice: farms, hardware stores and car trunks the most, then barns, sheds, garages, feed stores; shops as places too (a hardware store's aisles and shelves, a garden centre, a car dealer's bay, a pawn shop, a radio shop [shopshelves]); traders sell them; toolboxes and hardcore trades' trunks hold some.
- The hub starts with a tool kit, a shovel and a hatchet (world.js HUB_TOOLS). The governor crafts a makeshift hammer, saw, shovel or axe when its base has none (autopilot.js planCrafts, toolreqs.js basicToolWanted).
- Build and recipe cards show a 🔨 chip per tool. AI groups' coarse works need none.
- Modules: [data-tools TOOL_ITEMS / TOOL_KINDS / BUILD_TOOLS / WALL_TOOLS / CRAFT_TOOLS / TOOL_FINDS / AREA_TOOLS / CAR_TOOLS / WARE_TOOLS, toolreqs, buildings canBuild, crafting canCraft / fieldCraftOptions, ui/ui toolChips].

## Crafting stacks
- A recipe can make a stack (`CRAFTS[k].n`; makeshift picks: three a craft) that joins one of the same thing in the armory or on the team [crafting `craftItem`, `craftingHour`, `fieldCraft`; production `craftOrderHave` counts the stack; itemstack `mergeInto`].

## Building materials and metal sheets
- The user's requests 2026-10-21: "Add metal sheets as a lootable items that can be carried by the carried slot with two hands. stacked up to 4", "make sure building materials are also items only carried by the carried slot with two hands and stack up to 4", "make sure all buildings require building materials to some degree depending on the building".
- **Two heavy supplies**, `buildmat` and `metalsheet` (6 kg a sheet), carried in both arms only (item forms `s_buildmat` / `s_metalsheet`: twoHands stacks of 4 in the Carried slot; a team's armful up to 4 a person, filling both hands; a raid haul likewise) or in a vehicle [data, data-supitems, carry, raidloot].
- **Costs**: every building, defence and upgrade takes building materials by its size; roofed, steel-clad and reinforced ones take metal sheets too (`buildings.js SHEETS`: garage, storehouse, shed, warehouse, armory, reinforced gate, guard towers, watchtower, bunkhouses, the general buildings, hospital tiers…). Wall cells are their own material (the metal-sheet wall and its gates take sheets); gates and stands take building materials.
- **Made on site**: what the stores lack the builders make from scrap (3 scrap a building material, 5 a sheet, their work-hours on the job), for the governor and AI groups too [buildmats, buildings, power, reloading, groupworks, autopilot].
- Repairs of what is clad in sheets, and of a metal-sheet wall, take sheets [breakdowns].
- **Crafting**: a sheet from 4 scrap at a workshop; a sheet-metal cuirass, vambraces, greaves, machete and hatchet; the scrap vest, steel plate, riveted helmet and wheelbarrow take a sheet [crafting, armour, repair].
- **Finds**: hardware stores, factories, warehouses, auto shops, barns, sheds, crash sites (`loot.js SHEET_FINDS`); raid-map garages, workshops and car wrecks (`AREA_SHEETS`). Salvaged from a stripped car (by its type, and half its plating's), a wrecked car on the road, a base-map wreck, an escort's wreck and the hub's wreck card. A building pulled down gives half its sheets back. A car's armour plate and scrap plating take sheets [vehicles, parties, basescatter, caravanraids, hubevents].

## The power grid
- Generators and an ethanol still [power]. The user's request 2026-10-21: "Add spotlights as a placeable item on wall supports or on the ground … generators (Carried in the carried slot using 2 hands and are heavy) … house generators up to military generators … run on fuel per hour using 0.x per hour … Make buildings require x power to have lights inside … fridges … Have ammo crafter that requires no power but is slower and a machine ammo crafter that is quicker and more yield … a panel in the base to turn on and off machines/buildings … when they are off … reduce mood".
- Modules: [data-power, electric, power, basemap, fort, ui/production, ui/itemart/power]; test `tools/powergridtest.js`.
- **Found generators** (GENSETS): inverter 3 power at 0.03–0.06 fuel an hour, house 5 at 0.08, contractor 9, home standby 14, military tactical 20 at 0.08–0.25; +1 to +6 Heat while running. Items, both arms and heavy (22–140 kg), found in garages, sheds, hardware stores, farms, clinics and with the Army (POWER_FINDS, AREA_POWER).
  - **Set** on the base map from the stores (the Build list's Power group, a click, no builders; Construction and the governor with no spot) as records of their own type that power.js counts as generators (isGen, genDef by the hour; morning refuelling, wear and repairs FIXTURES genset_*, never upgraded; at most 4 a base). Picked up whole by Demolish (the tank drained into the fuel).
- **Mounted spotlights** (spotlamp: found or made at a workshop) on a wall stand's cell (FOOT mount: the stand keeps its ladder; reach 8) or the ground (reach 6). Draw 1 power dusk to dawn; light the battle map round them in a night fight at the base (basemap F.spots, fort.js fixedLit: b.lit, +10 to hit); +2% of a horde held each at night by the numbers (at most 10%).
- **Breaker panel** (breaker): wires buildings in CIRCUITS (lights always; fans and air conditioning on a hot day; heaters on a cold one: climateNeed), each a power user switched like any other. At a wired base everyone's mood: all lit +0.5, dark −1 × the share dark; a hot or cold day +1 with the climate served, −1.5 × the share without (powerMood, relations.js moodFactors). No panel, no line.
- **The switchboard** is the Power card: generators, machines and wired buildings by group, each switched, All on / All off (ui/production.js pw-group).
- **Ammo press** (ammo_press: the machine ammo crafter beside the unpowered ammo bench): runs only with power (stationStatus idle otherwise), 2× the scrap into 3× the rounds; reloading orders at 2.5× a reloading bench's rate (reloading.js benchMult).
- **Fridge** (on a general building's floor: 40 days of food at 0.25× its shelf while powered, storage.js); **electric well pump** (+8 water a day for its well); **fence charger** (needs wire: +6% of a horde held; the wire shocks the dead and the snagged on the battle map: c.shock, combat.js).
- **Governor** sets stored generators while power falls short, then spotlights and fridges (governPower). **AI groups**: not yet (their machines stay coarse works).

## Hauling
- The user's request 2026-10-20: "Add a hauling job to haul items from one base to another and add other hauling to gather other things than just water and wood". Modules: [hauling, ui/hauling]; test `tools/haultest.js`.
- **Haul** role (economy.js ROLES haul, 📦).
- **Standing haul orders** between your bases: state.haulOrders `{ from, to, what, mode, qty, gov? }`.
  - what: food (days), a supply, a category, everything, what lies outside, or "surplus" (the outpost shipping's keep rule: economy.js outpostKeep).
  - mode: send (over qty kept at the sender) or stock (keep qty stocked at the receiver).
  - The sender always keeps its reserve (paid jobs' step-up materials, supply runs: senderReserve).
- **A round trip** is a job trip (s.trip job "haul": out of the walls, lunch from the pack) by the map's route at the teams' pace (planPath / travelHours, the load band's pace, a cart's drag). 06:00 out, home by 21:00 (pairs too far for a day are not hauled).
  - Loaded to the Heavy band (poolAtBand); a cart from the armory multiplies it (its felt share, its free kg); or a vehicle set to hauling (v.haul; its payload, fuel for the round trip; v.haulOut while away: vehiclesAtBase skips it).
  - Goods go into the far base's free room (woodpile exempt, water to its tanks); the rest comes back. Road trouble through tripevents.js (a dropped load is lost).
- **Local hauling** (daylight) with nothing to move: a stockpile's goods fetched in; salvage beyond the ring on the base map (base.haulJobs: wreck stripped 2 h → 6 scrap + a car part; crate or drum 0.5 h → 1 scrap; rock 1 h → 1 building material; boulder 3 h → 3; stone as building materials, no new supply); else scavenge-lite in the ruins (half a scavenger's day over 6 hours, scrap and a tenth building materials, depleting scavLeft).
- noidle: "haul" in HELP_ORDER (local only) and planNoIdle's fallback.
- **Outpost shipping** folded in by direction: with an order between an outpost and the hub and a hauler at either end, the midnight shipping that way stops (haulCovers); the starving outpost's food cover stays.
- **Governor** (govHauling every 6 h): food stock orders for a base under 8 days while another has 20+; stock orders for a step up's missing materials; "outside" orders from a full base to one with room; the surplus order with them; its own orders dropped 24 h after nothing calls for them. planRoles 5c haulersWanted: one hauler per pair at the end with more people, at most two.
- **AI**: groupHaulDaily (factions.js peopleUp after spreadStores): what an outpost took beyond what it held (h.held from gatherStores) goes out on a "convoy" party of their people (p.haulTo; raidable as any caravan), unloaded on arrival (parties.js → haulConvoyArrive). Hands × round trip in crew-days off the next day's building (groupworks.js groupHaulCrew, at most half).
- **UI**: the Supply runs tab's Hauling panel (haulers, routes, what waits, vehicles, Add order) [ui/hauling]; activity lines ("Hauling 40 kg scrap to Riverbend (2 h out)"); haulers drawn on the State Map along their route [ui/workermap].
