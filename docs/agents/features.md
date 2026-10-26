# Broken State: major features

The feature map agents read first to find where a system lives. Built from the header comment of every module in `prototype/src/sim` and `prototype/src/ui`, plus `prototype/README.md` (2026-10-13); rewritten as a one-line-per-feature index on 2026-10-23, with the detail moved into `docs/features/`; trimmed to lines of at most 250 characters on 2026-10-25.

## Format (read before adding an entry)

- **One line per feature, at most 250 characters**: ``- **Name**: plain summary [key modules] `tools/xtest.js`. [details](../features/<area>.md#heading)``. A small feature with no detail page ends at its modules.
- **Modules** in brackets: `[name]` is `prototype/src/sim/name.js`, `[ui/name]` is `prototype/src/ui/name.js`. At most 5, module names only (no function names); the main test or two, from `prototype/tools/`.
- **No dates or user quotes** in the index: they go on the detail page.
- **Sub-bullets** only where a feature really needs them: at most 3, one line each.
- **Detail goes in `docs/features/<area>.md`** under its own `##` heading: the request and its date, rules, numbers, function names, AI parity, UI, every module and test.
- **Never lose a fact**: before cutting anything from a line, make sure its detail page has it.
- Put the entry under its area's numbered section below. When you add or remove a major system, update this file and the area's detail page. Testing: [testing.md](testing.md).

Detail pages: [campaign](../features/campaign.md) (1) · [survivors](../features/survivors.md) (2) · [bases](../features/bases.md) and [economy](../features/economy.md) (3) · [health](../features/health.md) (4) · [travel](../features/travel.md) (5) · [combat](../features/combat.md) (6) · [gear](../features/gear.md) (7) · [dead](../features/dead.md) (8) · [defence](../features/defence.md) (9) · [groups](../features/groups.md) (10, 11) · [ui](../features/ui.md) (12).

Older design docs: [docs/base-building/plan.md](../base-building/plan.md), [docs/reload-rules.md](../reload-rules.md), [docs/weapons-overhaul-plan.md](../weapons-overhaul-plan.md), [docs/ai-parity-audit.md](../ai-parity-audit.md), [docs/coalition-war-plan.md](../coalition-war-plan.md), [docs/multi-storey-crawl.md](../multi-storey-crawl.md), [docs/crawl-balance.md](../crawl-balance.md), [docs/prompts/](../prompts/); ADRs in [docs/adr/](../adr/) (0001 AI parity, 0002 base building).

## 1. Campaign, world and pacing
- **Procedural State of Calder**: hex map of terrain, rivers, cities, towns, roads and infection; sizes Small 150 × 75 to Huge 500 × 300 [mapgen, hex, worldsize] `tools/maptest.js` `tools/sizetest.js`. [details](../features/campaign.md#world-sizes)
- **No map until needed, crew on own dice**: setup on a 32 × 24 preview, the real map built for Start or the map [world, ui/newgame, main] `tools/crewdicetest.js`. [details](../features/campaign.md#no-map-until-it-is-needed-and-the-crews-own-dice)
- **The map kept between settings**: the last 4 lands are kept; any change but seed, size or Custom's map counts builds on a copy, no box [mapgen, world, main] `tools/mapcachetest.js`. [details](../features/campaign.md#the-map-kept-between-settings)
- **Unique names on the map**: every city, town and named site is unique (a numeral last); no two POIs on a tile share a name or franchise [mapgen, pois, shops] `tools/uniquenametest.js`. [details](../features/campaign.md#unique-names-on-the-map)
- **Hourly and daily simulation tick**, seeded and deterministic [world, rng].
- **Seasons and weather**: four 28-day seasons, regional weather fronts, frozen rivers in winter that people and the dead can cross [weather, rivers].
- **Rain in waves**: a rain day sends 3–4 rain belts (storm 2–3) over the map from any edge, never the whole state; players see rain on live tiles only [weather, ui/wxmap] `tools/rainwavetest.js`. [details](../features/campaign.md#rain-in-waves)
- **Rain and fog on the State Map**: rain and fog banks drawn on rainy or foggy tiles; fog and blizzards cut map sight by a tile [ui/wxmap, weather, parties] `tools/mapwxtest.js`. [details](../features/campaign.md#rain-and-fog-on-the-state-map)
- **Ponds in the hollows**: rain fills hollows into ponds, dry days turn them to mud, winter to ice; climbs ×1.5 in rain, ×2.5 in winter [ponds, combat, basemap] `tools/terrainweathertest.js`. [details](../features/campaign.md#ponds-in-the-hollows)
- **Seasonal weather in play**: ice slips, rain muffles sounds and drowns lures, rain fog cuts sight (night fog more); spring rains more [seasonfx, weather, combat] `tools/seasonfxtest.js`. [details](../features/campaign.md#seasonal-weather-in-play)
- **The ground by the season**: spring mud (+0.5 a step), autumn leaves, winter snow (+0.25, deep +0.5) on battle maps [seasonground, combat, ui/groundlook] `tools/seasongroundtest.js`. [details](../features/campaign.md#the-ground-by-the-season)
- **Weather for vehicles**: spring and rain mud bogs cars down off-road, snow and frost burn more fuel, the cold may stall a start [weather, parties] `tools/vehicleweathertest.js`. [details](../features/travel.md#weather-on-the-road)
- **Puddles after rain**: after 3 hours of rain, puddles on 3–15% of battle maps' level outdoor ground, dry in 12 hours; decor only [puddles, combat, ui/groundlook] `tools/puddletest.js`. [details](../features/campaign.md#puddles-after-rain)
- **Ponds on the map**: one open tile in 20 has a spring-fed pond, on the State Map and as a never-dry hollow on its battle maps [mapgen, ponds, basescatter, relief] `tools/worldpondtest.js`. [details](../features/campaign.md#ponds-on-the-map)
- **Eras**: early game (years 1–4), mid (5–9) and late (10+), threats growing each year [eras].
- **Two victories**: destroy every hive, or win with the Calder Coalition (over half the land); "Keep playing" after either [world, alliance] `tools/wintest.js` (the long census of natural endings: `tools/wincensus.js`).
- **Achievements per run**: 31 feats kept in the save, earned daily and at events, recording only; a 🏆 window, a toast, the end screens [achievements, ui/achievements] `tools/achievementstest.js`. [details](../features/campaign.md#achievements)
- **Hall of fame**: each ending (a victory, the bunker, a fall) kept outside the saves, up to 200; list, filters, Export, Delete [halloffame, ui/halloffame, ui/title] `tools/halloffametest.js`. [details](../features/campaign.md#hall-of-fame)
- **Hardcore mode**: start the day Calder falls with 1–4 survivors on the road, no hub, half-looted sites and the outbreak year's cards [hardcore*, hardcore-start, hardcore-loot, hardcore-outbreak]. [details](../features/campaign.md#hardcore-mode)
- **Bare start**: bases start with empty plots; the normal hub starts with a Lodge of four beds, a tent and eight crop plots, away from towns [world, startpick]. [details](../features/campaign.md#bare-start-and-the-hubs-start-layout)
- **Custom mode and starting vehicles**: Custom sets survivor, group, hive, city, town and military site counts; every mode a vehicle toggle [custommode] `tools/custommodetest.js`. [details](../features/campaign.md#custom-mode-and-starting-vehicles)
  - Up to one vehicle a survivor (＋ Add, ✕ Remove, kind), each with a point limit and back set under Customize only, on nobody's points [startfleet, startgear, ui/startgear] `tools/startfleettest.js`.
  - Every mode: each vehicle rolled by whose it is (kind, tank, back; 👁 Back, 🎲 Reroll) and named so; Hardcore's account splits the crew between them [hardcore-start, startfleet, ui/startgear] `tools/fleetbackstest.js`.
  - Each has a driver, at its wheel on the team and in battle; every vehicle on raid maps; too few drivers after a raid, you pick which go on [vehicles, combat, walkers] `tools/fleetdrivertest.js`.
- **Crew inventory**: 👁 Inventory on each crew card lists what they wear and carry; 🎲 rerolls what is inside [ui/newgame, hardcore-start, main] `tools/crewinvtest.js`. [details](../features/campaign.md#a-survivors-inventory-on-the-new-run-screen)
- **Crashlanding**: 3 years on, 300 × 200, lone survivor of a downed Guard heli, no base or car; the unit's base turns hive, then a secret bunker [crashmode, crashstart] `tools/crashlandingtest.js`. [details](../features/campaign.md#crashlanding)
- **New-run shortcuts**: Random run, New start position and Pick start on map [ui/newgame, startpick, main] `tools/startpicktest.js`. [details](../features/campaign.md#new-run-shortcuts)
- **World configuration**: the new-run *World…* window's dials and presets, kept in `state.worldCfg` [worldcfg, ui/worldcfg]. [details](../features/campaign.md#world-configuration)
- **Outbreak beyond the border**: keeps a minimum number of hives alive [outbreak].
- **Event cards and pacing**: pause rules, a card tray, auto-answers, speeds 1× to 5× [cardrules, ui/pacing].
- **Hub events**: home decisions every few days (a fire, a quarrel, a peddler, the dead at the fence, flu season and more) [hubevents, disease]; the harvest festival [festival]. [details](../features/campaign.md#hub-events)
- **7-day threat forecast** meter [forecast].

## 2. Survivors
- **Skills, XP, teaching, books and perks** [skills]; **traits** with tiers and points [traits].
- **Needs**: hunger, thirst and mood; eating person by person with a meal mood ladder, preferences and rations [needs, eating].
- **Sleep and tiredness** [sleep].
- **Morale**: crowding, leader lift, desertion [morale]; **mental breaks** [mentalbreaks]; **comforts and treats** [comforts].
- **Relationships**: grief, service record, memorial wall, daily mood factors [relations].
- **Bonds between survivors**: named levels from rival to partner with reasons, work and mood buffs, behaviours and hub cards [bonds, bondevents, ui/relations] `tools/bondstest.js`. [details](../features/survivors.md#bonds-between-survivors)
- **Family**: couples, pregnancy, births, children growing up [family].
- **Recruits**: newcomer cards for strangers, refugees, loners and returning deserters [recruits].
- **Appearance and customization**: backgrounds, points, starting gear, random kits; low-poly figures on the maps [appearance, custombg, custompoints, startgear, ui/figures]. [details](../features/survivors.md#appearance-figures-and-customization)
- **Status icons** and a "Why?" cause chain for deaths, lost bases and setbacks (vehicles lost, teams wiped, failed missions, walkouts) [status, causes, ui/causes] `tools/whytest.js`. [details](../features/survivors.md#why-did-this-happen-setbacks)

## 3. Bases and economy
Base detail: [bases.md](../features/bases.md). Economy detail: [economy.md](../features/economy.md).
- **Base tiers**: camp, shelter, outpost and hub, every yard 76 × 76 to start; camps set up, struck and upgraded [staging, basemap, basescatter, buildings, ui/campsite] `tools/campspottest.js`. [details](../features/bases.md#base-tiers)
  - No base yet: the team panel's card lists the camp fire's wood and stone carried, then the shelter shack's needs [ui/hardcore, staging] `tools/campcardtest.js`.
- **A camp on a hill**: the camp's 5 × 5 whole on one level, buildings on any level ground [basescatter, basemap, combat] `tools/campspottest.js`. [details](../features/bases.md#a-camp-on-a-hill-stands-on-it-and-buildings-stand-on-the-hills)
- **What a camp's spot is like**: the picker's facts for a 5 × 5 (ground, sight, room, wood, water) and the game's pick scored on them [siteinfo, basemap, ui/campsite] `tools/campspottest.js`. [details](../features/bases.md#what-a-camps-spot-is-like)
- **Scouting before a camp**: scout first, or set up blind on a random spot, fogged, its dead attacking until cleared [campscout, staging, survey, poiraid] `tools/campscouttest.js`. [details](../features/bases.md#scouting-before-a-camp)
  - Step ups (Shelter shack, Outpost house, Main house) are buildings placed by hand from the Build list [ui/basemap] `tools/stepupplacetest.js`. [details](../features/bases.md#step-ups-are-buildings)
  - Clearing the spot of the dead first on towns, cities and infected tiles [siteclear] `tools/siteclearest.js`. [details](../features/bases.md#clearing-the-spot-of-the-dead)
  - "Open the build map" prompt for new bases (key U) [ui/buildmap] `tools/buildmapbtntest.js`. [details](../features/bases.md#open-the-build-map)
- **Buildings and construction queue**: plots, demolition refunds, the storage ladder, general buildings and fittings [buildings]; field works outside the walls [fieldworks]. [details](../features/bases.md#buildings-and-construction-queue)
- **Base storage limits**: kg of room by tier and buildings; what does not fit lies outside, weathers and is raided first [basestorage, ui/storage] `tools/basestoragetest.js`. [details](../features/bases.md#base-storage-limits)
- **The base map**: every base's 500 × 500 grid and 150 × 150 view, its land to clear, placement rules and Move [basemap, basescatter, ui/basemap, ui/isoview] `tools/baseviewtest.js`. [details](../features/bases.md#the-base-map)
  - The selected thing's orders (Move, Auto, Demolish, doorways) in a chip beside it on the map [ui/basemap, ui/combat] `tools/basebuilduitest.js`. [details](../features/bases.md#the-grid)
  - Farmland's fenced fields: squares of wooden or wire fence off the map's edge, gates facing the middle [basescatter, combat, ui/isoview] `tools/farmfieldstest.js`. [details](../features/bases.md#farmlands-fenced-fields)
- **Every way in stays open**: rock never walls ground in, town doors reachable, nothing placed on rock [basescatter, relief, basemap] `tools/mapreachtest.js` `tools/mapdeterminismtest.js`. [details](../features/bases.md#every-way-in-stays-open)
- **Terraforming**: Dig a hollow and Raise a hill on the base map, one shovel a person, dirt dug and spent [terraform, basescatter, basemap, ui/basemap] `tools/terraformtest.js`. [details](../features/bases.md#terraforming)
- **Base building**: no-build margin, general buildings with fittings, a way in and out, doorways, containers, repair orders [basemap, containers, breakdowns, autopilot] `tools/basebuildtest.js`. [details](../features/bases.md#base-building)
- **Furniture**: beds (cots, beds, bunk beds, large beds; one rough-sleeping rule) and the found storage, comfort and work pieces (#8's catalogue kinds with a storage, comfort or work use: shelves, crates, wardrobes, gun racks, sofas, desks, a workbench) set in buildings: storage containers, a comfort mood line, the governor and AI groups [furniture, data-basefurniture, data-furniture, beds, data-beds] `tools/bedstest.js`, `tools/basefurnituretest.js`. [details](../features/bases.md#furniture)
- **Work priorities** (RimWorld-style): roles, a 1–5 grid and an hourly scheduler [work]; idle-worker assignment [idlework], watch roster [watch], stewards and leaders [steward], bulk roster actions [bulk].
- **No idle workers**: anyone whose job has no work helps elsewhere and keeps their role [noidle, autopilot] `tools/noidletest.js`. [details](../features/economy.md#no-idle-workers)
- **Daily economy and upkeep per head** [economy, upkeep].
- **Water**: purified vs un-purified, wells and filters [water, claims].
- **Food**: types with their own shelf life, spoiling, storage, preserving and jarring [foods, storage]; mealtimes [meals], food chain and ledger views [foodchain, foodlog].
- **Cooking**: Rimworld-style recipes from ingredients, food poisoning and the kitchen [cooking, kitchen].
- **Farming**: crops, seasons, greenhouses; crop plots are 2 × 2 pieces placed on soil [farming, buildings, basemap]. [details](../features/economy.md#farming-placed-crop-plots)
- **Hunting, snares, fishing and foraging** [hunting, foraging].
- **Winter's lean months**: frost kills crops; forage, game, fish and wood yield less in winter [winter, weather, farming]. [details](../features/economy.md#winters-lean-months)
- **Stone**: field stone cleared on the build map, the Gather stone job and team order; a camp's fire takes 5 wood and 8 stone [stone, work, orders, buildings, staging] `tools/stonetest.js`. [details](../features/economy.md#stone)
- **Land order box**: the five land jobs ask the time (30m–24h, half-hour steps) with the yield [landest, ui/landorder, ui/teamctx] `tools/landordertest.js`. [details](../features/economy.md#the-land-order-box-hours-and-expected-yield)
- **Teams gathering on the map**: axes and picks swung, rods worked, buckets filled, a ring filling over them [ui/render, ui/mapfigures, ui/workermap] `tools/mapfigurestest.js`. [details](../features/economy.md#a-team-at-a-gathering-order-on-the-map)
  - Out on a Survey, Quick look, snares, shore finds or a claim: people walk out and back, at work out there; a well dug on the spot; the same ring [ui/render, ui/mapfigures]. [details](../features/economy.md#a-team-at-a-gathering-order-on-the-map)
- **Woodcutting and heating**: wood is fuel and a building material; wooden builds cost wood; felling on the base map [woodcutting, woodwork, upkeep, needs] `tools/woodworktest.js`. [details](../features/economy.md#woodcutting-and-heating)
- **Job trips**: outdoor workers walk out to the base's land, with events and trip gear [jobtrips, tripland, tripevents, tripgear].
- **Teamwork on job trips**: workers on the same job and tile are a crew sharing load, events, battles and loot [teamwork, jobtrips, tripevents, loneattack]. [details](../features/economy.md#teamwork-on-job-trips)
- **Tools as prerequisites**: builds and recipes need tool kinds (hammer, saw, axe…) at the base [data-tools, toolreqs, buildings, crafting] `tools/toolreqstest.js`. [details](../features/economy.md#tools-as-prerequisites)
- **Crafting**: hand crafting plus standing production orders/bills; recipes can make stacks [crafting, production, itemstack]. [details](../features/economy.md#crafting-stacks)
- **Electronics recipes**: nine crafts using electronics, gated by a soldering iron and a handbook; item inputs one off a stack [crafting, data-tools, blueprints, arsenal]. [details](../features/economy.md#electronics-recipes)
- **Building materials and metal sheets**: two-handed heavy supplies every build needs by size; made from scrap on site [buildmats, buildings, data-supitems, carry]. [details](../features/economy.md#building-materials-and-metal-sheets)
- **Power grid**: found generators, spotlights, a breaker panel, ammo press, fridges, pumps, fence chargers [power, electric, data-power, ui/production] `tools/powergridtest.js`. [details](../features/economy.md#the-power-grid)
- **More of the grid: electronics builds**: solar arrays, battery banks, perimeter alarm, electric heaters, charging station [data-power, power, electric] `tools/powergridtest.js`. [details](../features/economy.md#more-of-the-grid-electronics-builds)
- **Appliances**: found freezers, cold cases, ranges, ovens, microwaves set on the grid; a range cooks on power or propane [appliances, data-appliances, storage, cooking] `tools/appliancestest.js`. [details](../features/economy.md#appliances)
- **The governor builds the grid**: it queues grid builds behind manual, Mechanics and reserve; powered mill, grinder ×1.5 [autopilot, electric, power] `tools/powergridtest.js`. [details](../features/economy.md#the-governor-builds-the-grid)
- **Breakdowns**: fixtures wear and need a named survivor to repair; repair orders from the Repairs tab [breakdowns, ui/explore]. [details](../features/bases.md#repair-orders)
- **Blueprints and manuals** that unlock top tiers [blueprints].
- **Supply runs** between your bases [supply]; **moving people** and the overcrowding card [moveout].
- **Hauling**: a Haul role, standing haul orders between bases, local hauling, governor and AI convoys [hauling, ui/hauling] `tools/haultest.js`. [details](../features/economy.md#hauling)
- **Hidden bases**: run silent, camouflage [hiding].

## 4. Health and medicine
- **Wounds, infection and passive healing** [medical].
- **Hospital tiers**: infirmary, field hospital, clinic, trauma hospital, medic staffing and bed caps [medical].
- **Illnesses** with causes, contagion, courses of meds and pneumonia [health]; the sick rest until well [sickrest].
- **Disease and outbreaks**: camp fever and wound fever, risk rising with headcount and newcomers, hub cards [disease, health]. [details](../features/health.md#disease-and-outbreaks)
- **The worm**: infection lore and mechanics; caught from eggs in soil and water, not bites [worm].
- **Training medics**: ward rounds, a doctor and trainees, graduation [training].
- **Med scarcity by site type** [medfinds].
- **Battlefield medics**: dragging and stabilizing the downed [medics].

## 5. Teams, travel and exploration
Detail: [travel.md](../features/travel.md).
- **Expeditions across the State Map**: supplies drain hour by hour, events roll tile by tile [parties].
- **Order queue and trip planner**: plans, templates, repeat trips [orders, plans, trips, ui/undo].
- **The map's right-click team menu**: a team's orders for a tile, with times; on its own tile all it can do there, no selection needed [ui/teamctx, ui/teamsel] `tools/teamctxtest.js`. [details](../features/travel.md#the-maps-right-click-team-menu)
- **Some of a team on jobs of their own**: members picked go off on an order; the team stays put till they rejoin [detach, teammeet, ui/whopick, ui/teamctx] `tools/detachtest.js`. [details](../features/travel.md#some-of-a-team-on-jobs-of-their-own)
- **Team forming, team inventory, teams meeting** and handing over goods; supplies and rounds onto a member; guns leave loaded [teamform, teaminv, teammeet, supitems, gunrounds]. [details](../features/travel.md#team-inventory-and-handing-over-goods)
- **Carry weight and load bands**, physical supply carrying, carry kit and rigs; full hands in a fight [load, carry, carrykit, ui/carry]. [details](../features/travel.md#the-hands-in-a-fight)
- **Carrying furniture**: lift 2 actions; alone slow, two tethered at half weight (drawn held) [furnicarry, carry, carrykit, ui/figures] `tools/furnicarrytest.js` `carryviewtest.js`. [details](../features/travel.md#carrying-furniture-and-appliances)
- **Extracting with furniture**: into the vehicle by itself, else dropped at the door from exhaustion (a POI keeps it) [furnihome, furnicarry, poicont] `tools/furnihometest.js`. [details](../features/travel.md#extracting-with-a-piece-in-the-arms)
- **Carry playthrough**: a scripted raid, crawl and base run carrying pieces with one and two survivors, with and without a vehicle [furnicarry, furnihome] `tools/carryplaytest.js`. [details](../features/combat.md#the-carry-playthrough-issue-48)
- **Vehicles**: fuel, condition, breakdowns, bicycles; found cars, military trucks, road blockages and repairs, vehicle trade [vehicles, foundcars, miltrucks, roadblocks, vehicletrade]. [details](../features/travel.md#vehicles)
  - A team's piece and a parked marker on the State Map show the vehicle's type (pickup, sedan, SUV, van, Hummer, Army truck) [ui/mapfigures, ui/mapsprites, ui/render]. [details](../features/travel.md#the-maps-vehicles-by-type)
  - Every vehicle window shows the vehicle's model: the Vehicles tab, the cargo and trunk, the fleet chips and picks, Starting vehicles, the car row, trade [ui/vehiclemodel]. [details](../features/travel.md#the-maps-vehicles-by-type)
- **A lost team's vehicles keep what was in them**: left on the tile with their cargo, to recover [parties, groupworld, vehicles] `tools/lostfleettest.js`. [details](../features/travel.md#a-lost-teams-vehicles-keep-what-was-in-them)
- **Recover the convoy**: a team raids the tile to drive your abandoned vehicles home, or an allied group fetches them for a fee [convoyrecover, parties, envoys] `tools/convoyrecoverytest.js`. [details](../features/travel.md#recover-the-convoy)
- **Weather on the road**: stuck in mud (free in N h), winter fuel ×1.15–1.3 in every estimate, cold starts, the route outlook, for groups too [weather, parties] `tools/vehicleweathertest.js`. [details](../features/travel.md#weather-on-the-road)
- **Boat crossings** over water [crossing].
- **Night on the road**: make camp or push through [nightmarch].
- **Tents**: tent bags found as loot in three sizes plus a makeshift tent; pitched at camp as beds and dry storage [tents, data-tents] `tools/tentstest.js`. [details](../features/travel.md#tents)
- **Campsites**: a POI of tents round a fire, abandoned, overrun or a raider camp [campsite] `tools/campsitetest.js`. [details](../features/travel.md#campsites)
- **Field Heat**: a team that stays put draws attention [fieldheat].
- **Travel event cards**: rolled tile by tile by ground, season, weather and the dead nearby (the dead ahead, wolves, a lonely farmhouse, an overrun convoy…) [events] `tools/roadeventstest.js`. [details](../features/travel.md#travel-event-cards)
- **Discovery and hidden sites**, the Sweep area mission (the old radius Survey), rumours, map markers with last-seen times [discovery, survey, markers].
- **Points of interest (POIs)**: 0–4 small places per land tile with their own loot pools [pois, mapgen, ui/poiview]. [details](../features/travel.md#points-of-interest-pois)
- **Where buildings stand**: tile classes (city centre to rural) and a placement table of weight and size class per kind; new worlds' POIs and crawls follow it [placement, data-placement, pois, shops, citycrawl] `tools/placementtest.js`. [details](../features/travel.md#where-buildings-stand-the-placement-table-by-setting)
- **Gun stores, pawn shops and hardware stores**: shops with richer gun, gear and building-material finds [shops, shopshelves]. [details](../features/travel.md#gun-stores-pawn-shops-and-hardware-stores)
- **Shops and services as franchises**: 14 more site types, each place one of 4–10 chains with its own look and layout [shops, data-shops, buildingmaps]. [details](../features/travel.md#shops-and-services-as-places-as-franchises)
- **POI surveys and the per-POI raid flow**: Survey and Quick look, per-POI threat, raids into one POI at a time [survey, pois, poiraid, ui/poipick]. [details](../features/travel.md#poi-surveys-and-the-per-poi-raid-flow)
- **Walking to a POI**: 5–20 minutes to each place, a tile map dialogue, the walk shown, leaving by an edge [poiwalk, ui/poimap, ui/poipick] `tools/poiwalktest.js`. [details](../features/travel.md#walking-to-a-poi)
- **Tile heat and persistent POI containers**: heat per tile; containers keep their contents between visits [pois, poicont]. [details](../features/travel.md#tile-heat-and-persistent-poi-containers)
- **Other groups survey and raid POIs** with their own knowledge, picker and the shared ledger [grouppois, aiscav, visitors] `tools/poipacingtest.js` (4 years). [details](../features/travel.md#other-groups-survey-and-raid-pois)
- **Abstract scavenging**: hour-by-hour search with rising Heat [scavenge]; shared finite loot AI groups also scavenge [aiscav].
- **City crawl**: block-by-block roguelike extraction on a round grid of blocks, walking back to the rim to get out; multi-storey buildings with who lives on each floor [citycrawl, floorfolk]; parity with the raid tickets (#21): whole-cell snapshots, scenes by the place, furniture carried block to block, signature-room hints, the quick search on the building's own containers [citycrawl, interiorscenes, floorfolk, combat boxFinds] `tools/citycrawltest.js`. [details](../features/travel.md#city-crawl)
- **Stair runs**: stairwells as flights against a wall with landings, the top step changes floor, by building kind [buildingmaps, combat, floorfolk, ui/isoview] `tools/storeytest.js`. [details](../features/travel.md#stair-runs-2026-10-25)
- **Crash sites and supply drops**, contested [crashes].
- **Wanderers**: neutral survivors and others met on the road [wanderers].
- **Optics**: binoculars, thermal imager and others [optics]; **lights** carried for the dark [lights].

## 6. Tactical combat (XCOM-style)
Detail: [combat.md](../features/combat.md).
- **Terrain in combat**: high ground aims and sees better, hills are cover, a hollow sees only its rim, the AI paths by the land [combat, highground, ui/combat] `tools/terraincombattest.js`. [details](../features/combat.md#terrain-in-combat)
- **Weather in battle**: the tile's weather drawn over the fight; fog and blizzards cut every side's sight [wxsight, stealth, ui/battlewx, ui/isoview] `tools/battlewxtest.js`. [details](../features/combat.md#weather-in-battle-rain-fog-and-snow)
- **Turn-based tactical battles** with an isometric view [combat, ui/isoview].
- **Walking on the battle map**: moves animated cell by cell at each mover's pace [ui/moveanim, ui/combat, ui/figures] `tools/moveanimtest.js`. [details](../features/combat.md#walking-on-the-battle-map)
- **Lost pictures drawn again**: every cached picture redrawn after a GPU context loss [ui/pictures]. [details](../features/combat.md#lost-pictures-drawn-again)
- **Battle map sizes** by context (24×18 to 48×34; raids 32×24 to 56×42) with anti-slog endings [battlesize, worldcfg] `tools/raidshot.cjs`. [details](../features/combat.md#battle-map-sizes)
- **Pathing on the biggest maps**: the dead's field patched after a door is hit; a 500 × 500 turn with 100 dead about 1 s [combat] `tools/fieldpatchtest.js` `tools/perfbudgettest.js`. [details](../features/combat.md#pathing-cost-on-the-biggest-maps)
- **A raid without the side panel**: full-screen raid map with a top strip, cards and a log window [ui/combat, ui/logwindow] `tools/raidscreentest.js`. [details](../features/combat.md#a-raid-without-the-side-panel)
- **Before you go in**: the raid plan window (scout, wait for night, kit, side to enter, leave) [raidplan, ui/raidplan]. [details](../features/combat.md#before-you-go-in-the-raid-plan)
- **The building picked before the raid map**: a card picks the building before the map is made, the autopilot by dice [poiraid, parties, combat] `tools/buildingpicktest.js`. [details](../features/combat.md#the-building-picked-before-the-raid-map)
- **Raids into building interiors**: buildings and streets to search; locks, keys, safes, makeshift picks [buildingmaps, search, raidloot, locks, gunsafes] `tools/makeshiftpicktest.js`. [details](../features/combat.md#raids-into-building-interiors)
- **Furniture and appliance catalogue**: 248 kinds with cell rules, hp, kg, carry class, base use and sprites [data-furniture, barricade, ui/isoview] `tools/furnituretest.js`. [details](../features/combat.md#raids-into-building-interiors)
- **Homes laid out room by room**: kitchens, bedrooms, baths, garages; shared placement helpers; the pieces are the containers [roomlayout, buildingmaps, combat] `tools/interiortest.js`. [details](../features/combat.md#raids-into-building-interiors)
- **Hospitals, clinics and vets room by room**: ER, wards, theatre, ICU, pharmacy, morgue, kennels; meds ±10% [roomlayout, buildingmaps, combat, interiorscenes] `tools/interiortest.js`. [details](../features/combat.md#raids-into-building-interiors)
- **Civic buildings laid out for their kind**: police, fire stations, schools, churches; cells, engine, pews [civiclayout, buildingmaps, combat] `tools/interiortest.js`. [details](../features/combat.md#raids-into-building-interiors)
- **A dozen plans per civic and medical kind**: 12 named plans each for hospitals, infirmaries, clinics, vets, churches, police, fire [civicvariants] `tools/variantcivictest.js`. [details](../features/combat.md#raids-into-building-interiors)
- **Civic and medical buildings at real scale**: every plan at its real size, maps up to 350 × 350; a regional medical centre, sites of many buildings (a medical campus, a churchyard, HQs) [civicvariants, civicsite, data-buildingsize, battlesize] `tools/civicscaletest.js`. [details](../features/combat.md#civic-and-medical-buildings-at-real-scale)
- **Buildings at real size**: 1 m a cell, city towers to 10 storeys (past 4 blocked), maps to 300 × 300 [data-buildingsize, buildingmaps, ui/isoview] `tools/scaletest.js`. [details](../features/combat.md#buildings-at-real-size-issue-24-2026-10-25)
- **Bases, air bases, airports laid out**: real-size HQ, barracks, hangars, tower, terminal; 12 plans a type, 12 site layouts [militarylayout, milplans] `tools/milvarianttest.js`. [details](../features/combat.md#raids-into-building-interiors)
- **Bunkers**: military, government, fallout shelter, prepper, 12 named plans each; levels below ground, generator lights [bunkerlayout, buildingmaps, pois] `tools/interiortest.js`. [details](../features/combat.md#bunkers)
- **Data centres**: 13 plans, a colocation hall to a hyperscale campus; racks in hot and cold aisles, UPS, generators; maps to 400 × 400 [datacenter, compound, buildingmaps] `tools/lootsensetest.js`. [details](../features/combat.md#data-centres)
- **Shopping malls**: strip malls, regional malls (levels, anchors, concourse, food court, cinema), outlet centres, each one map of real shops [mall, malllayout, compound, pois] `tools/malltest.js`. [details](../features/combat.md#malls)
- **Amusement parks**: 13 variants (a theme park by a city centre, fairgrounds, a pier, water parks…), one map each, up to 500 × 500 [amusement, amusementlayout, data-parks] `tools/amusementtest.js`. [details](../features/combat.md#amusement-parks)
- **Stadiums and arenas**: 12 venues, pro football to rodeo, each one map up to 500 × 500 with tiered stands, concourses, a tunnel [stadium, stadiumlayout, compound] `tools/stadiumtest.js`. [details](../features/combat.md#stadiums-and-arenas)
- **Prisons**: county jail, state prison, penitentiary, each one map of many buildings: tiers of cells, fences, towers, gates; twelve named plans a building type and twelve layouts a complex [prison, prisonlayout, compound, pois] `tools/prisontest.js`, `tools/prisonvarianttest.js`. [details](../features/combat.md#prisons)
- **College campuses**: universities and town colleges as one map of 4–40 buildings, joined or apart, quads, courtyards, dorms; twelve named plans a building type and twelve site layouts [campus, campuslayout, campusplans, compound, mapgen] `tools/campustest.js`. [details](../features/combat.md#campuses)
- **Zoos**: 12 plans, a city zoo or aquarium to a roadside zoo, one map to 500 × 500: animal houses, moated pens, back of house, dead beasts [zoo, zoolayout, data-zoo, compound] `tools/zootest.js`. [details](../features/combat.md#zoos)
- **Library variants**: 13 kinds, 26 plans, rural reading room to an 8-storey central library; stacks with aisles, franchises, scenes [librarylayout, buildingmaps, data-shops] `tools/librarytest.js`. [details](../features/combat.md#libraries)
- **Museums**: 13 variants, 26 plans, a house museum to a natural history museum; exhibit vehicles, liftable art; big by city centres [museumlayout, data-museums] `tools/museumtest.js`. [details](../features/combat.md#museums)
- **Shops, offices, motels, banks laid out by kind**: aisles, checkouts, kitchens, walk-ins, bars, desks, vaults [shoplayout, buildingmaps, roomlayout] `tools/shopstest.js`. [details](../features/combat.md#raids-into-building-interiors)
- **Buildings that are not boxes**: L, T, U, cross, annexes, notches, stepped backs; a school 2.5× the floor round a yard, a dozen named school plans [buildingmaps, ui/isoview] `tools/interiortest.js`. [details](../features/combat.md#raids-into-building-interiors)
- **Grocery stores by size**: corner store, grocery, a supermarket twice the old each way, its warehouse and dock [shoplayout, buildingmaps, data-furniture] `tools/shopstest.js`. [details](../features/combat.md#raids-into-building-interiors)
- **Layout variants: motels, homes, rural**: 12 named layouts each for the motel, house, farmhouse, cabin, lodge, ranger station, apartments, neighbourhood, barn and machine shed, by dice and setting; POIs named by them [buildvariants, buildingmaps, pois] `tools/varianttest.js`. [details](../features/combat.md#raids-into-building-interiors)
- **Radio tower compounds**: 12 plans, AM mast to rooftop repeater; transmitter room, generator shed, a climbable mast [radiotowerlayout] `tools/radiotowertest.js`. [details](../features/groups.md#the-building-type-a-dozen-plans)
- **Mines and quarries**: 13 plans each; dark levels lit by a generator, cave-ins, magazines, a 400 × 400 pit; in the hills [minelayout, data-mines, compound] `tools/minetest.js`. [details](../features/combat.md#mines-and-quarries)
- **Industrial plans**: 12 named plans each for the warehouse, factory and lab, by dice and setting [industrylayout, buildingmaps] `tools/industryvarianttest.js`. [details](../features/combat.md#raids-into-building-interiors)
- **Sawmills and lumber yards**: 13 plans, a portable bandsaw mill to an industrial mill of 7 buildings, in forest and hills [sawmilllayout, buildingmaps, compound] `tools/sawmilltest.js`. [details](../features/combat.md#sawmills-and-lumber-yards)
- **Hotels**: inns, business hotels, resorts, city towers; named chains, maps up to 200 × 200 [hotellayout, hotels, buildingmaps, data-shops] `tools/hoteltest.js`. [details](../features/travel.md#hotels-and-their-chains)
- **Hotel variants**: 12 plans a kind (48: a B&B to a casino tower), picked by chain, setting and dice, named on the POI [data-hotels, hotellayout, hotels] `tools/hotelvarianttest.js`. [details](../features/combat.md#hotel-variants)
- **Hotel shapes**: eight variants shaped in a new save (an L motor inn, a T conference hotel, a U round a pool courtyard, an E golf resort, a crescent beach resort, a podium tower, twin towers on a podium, a courtyard grand hotel), stairs and lifts at the wing ends and junctions [hotellayout, data-buildingsize, buildingmaps] `tools/hotelshapetest.js`. [details](../features/combat.md#hotel-shapes)
- **Restaurants by food, format and size**: 86 variants (12+ a kind), cuisine kitchens and loot, drive-throughs to dance halls [data-eateries, eaterylayout] `tools/restauranttest.js`. [details](../features/combat.md#raids-into-building-interiors)
- **Office buildings by kind**: storefronts, parks, towers, city hall, courts, call centers, stations, firms [officeplans, officelayout, data-offices] `tools/officestest.js`. [details](../features/travel.md#shops-and-services-as-places-as-franchises)
- **A dozen layouts per shop and service**: 12 named plans for each of 23 types, by dice, franchise and setting [shopvariants, buildingmaps, data-shops] `tools/shopvarianttest.js`. [details](../features/travel.md#a-dozen-layout-variants-per-type)
- **Six more shops**: furniture, laundromat, thrift, bakery, butcher, deli (12 plans) [data-newshops, shopvariants] `tools/newshopstest.js`. [details](../features/travel.md#six-more-shops-furniture-store-laundromat-thrift-store-bakery-butcher-deli)
- **One plan id and name**: named plans as spec.vid / spec.vname, map.vid / map.vname; one setting vocabulary [planname, settings, buildingmaps] `tools/plannametest.js`. [details](../features/combat.md#plan-ids-names-and-settings)
- **The shared variant picker (base tool)**: every type registers its plans; one pick by pin, franchise, setting, tile, size, older save [variantpick] `tools/varianttest.js`. [details](../features/combat.md#the-shared-variant-picker)
- **Stealth**: takedowns, facing and view cones, sneaking, lights and darkness, indoor light switches [stealth, vision, indoorlight, ailights].
- **Loot that makes sense**: every building type's signature finds and what is never there, checked over 100 buildings a kind, loot ±10% [lootsense, combat, loot] `tools/lootsensetest.js`. [details](../features/combat.md#loot-that-makes-sense)
- **Vaulting half cover**: over waist-high cells at extra cost, landing winded [combat]. [details](../features/combat.md#vaulting-half-cover)
- **Windows and the kinds of door**: window states (open, locked, broken) and door kinds with their own hit points, sight and locks [windows, buildingmaps, locks]. [details](../features/combat.md#windows-and-the-kinds-of-door)
- **Raiders and the dead fight each other in a raid**; unseen shots are heard and marked in the fog [crossfire] `tools/crossfiretest.js`. [details](../features/combat.md#raiders-and-the-dead-fight-each-other-in-a-raid)
- **Barricades**: shove furniture, board up doors and windows; the dead crawl over half cover [barricade] `tools/barricadetest.js`. [details](../features/combat.md#barricades)
- **Signs of survival**: rooms barricaded from inside, overrun rooms, hallway piles, last stands, quiet deaths, blood [interiorscenes, barricade, ui/battlemarks] `tools/scenestest.js`. [details](../features/combat.md#signs-of-survival)
- **Shoving people and the dead**: push back or floor a foe; the dead grapple [shoving] `tools/shovetest.js` `tools/shoveviewtest.js`. [details](../features/combat.md#shoving-people-and-the-dead)
- **Soft cover: bushes and tents**: conceal but never stop bullets; tents tear and are mended [softcover] `tools/softcovertest.js`. [details](../features/combat.md#soft-cover-bushes-and-tents)
- **Taking tents down and slashing them** in a fight, and stealing the bag [tentfight, softcover] `tools/campsitetest.js`. [details](../features/combat.md#taking-tents-down-and-slashing-them)
- **Hearing and deafening**; ear protection works only in the Ear pro slot [hearing, helmets] `tools/heartest.js` `tools/holstertest.js`. [details](../features/combat.md#hearing-deafening-and-ear-pro)
- **Side arm and melee slots**: draw a holstered handgun or belt blade for 1 action [holsters, combat, equip] `tools/holstertest.js`. [details](../features/combat.md#side-arm-and-melee-slots)
- **Non-lethal weapons and taking people alive** (taser, stun baton, pepper spray) [nonlethal].
- **Throwables**: Molotovs, pipe bombs, flares, smoke [throwables]; **decoys and fire**, what the dead follow [decoys].
- **Car alarms**: set one off by hand or a thrown bottle to pull the dead away; breaking in may set one off [caralarms, foundcars, stealth, decoys, ui/carpanel] `tools/caralarmtest.js`. [details](../features/combat.md#car-alarms)
- **Things on the ground** and searching bodies [ground]; the ground in a survivor's inventory window [ui/inventory, carry]. [details](../features/combat.md#the-ground-in-a-survivors-inventory)
- **Retreat**: "Sound the retreat" and break-off policies for auto-resolved fights [combat, breakoff]. [details](../features/combat.md#retreat)
- **Third side**: neutrals and soldiers who are neither your team nor its enemies [thirdside].
- **Talking to other groups in a raid**: call out, truce, trade, recruit or ally for the battle; treachery and grudges [parley, thirdside] `tools/parleytest.js`. [details](../features/combat.md#talking-to-other-groups-in-a-raid)
- **Orders to allies**: give an allied survivor an order for 1 action; they may ignore it [allyorders]. [details](../features/combat.md#orders-to-allies)
- **Siege kit**: ladders, rams and frag grenades; groups and raiders bring only their own [siege, arsenal, visitors]. [details](../features/combat.md#siege-kit)
- **Vehicles in battle**: Humvee gunners, ramming gates; every car and truck a low-poly model by its type [combat, ui/vehiclemodel, ui/isoview, ui/figures] `tools/vehiclemodeltest.js`. [details](../features/combat.md#vehicles-in-battle)
- **Auto-resolve by the numbers** [combat]. [details](../features/combat.md#auto-resolve-by-the-numbers)

## 7. Weapons, armour and gear
Detail: [gear.md](../features/gear.md).
- **Weapons overhaul**: many real guns, melee weapons, blades and launchers [data-guns, data-blades, launchers].
- **Physical rounds in a fight**: rounds are real stacks in guns and magazines; a Reload draws only on the shooter's kit [roundstack, mags, ammo, gunload, kitcheck] `tools/reloadpicktest.js`. [details](../features/gear.md#physical-rounds-in-a-fight)
- **Ammo by calibre and type**: boxed or loose rounds, magazines, a reloading bench; reload cost by where the rounds lie [ammo, rounds, mags, gunload, reloading]. [details](../features/gear.md#ammo-by-calibre-reload-sources-and-loading-magazines)
- **Gun mechanics**: fire modes, jams, suppression, over-penetration, a damage ladder [gunfire, gunstats, ladder].
- **Attachments and gun builder** (Tarkov-style): sights, muzzles, stocks and more; factory-fitted guns, finishes and paint [gunmods, data-gunmods, factoryfit, ui/gunbuilder, ui/gunpaint]. [details](../features/gear.md#attachments-and-gun-builder)
- **Armour classes AC 1–6**: per-hit durability, helmets and face shields, plate carriers, rigs with pocket pouches [armour, helmets, data-helmets, data-kit]. [details](../features/gear.md#armour-and-rigs)
- **Inventory**: RPG slots, pockets, packs and stacks; weight lines, supplies as items, kit moves and hand-overs in a fight [inventory, itemstack, stacks, supitems]. [details](../features/gear.md#inventory)
- **Item icons**: a 16 × 16 pixel drawing for every non-gun item [ui/itemart, ui/itemart/*].
- **Item right-click menu** (Tarkov-style): equip, reload, unload, modify, repair, salvage, eat, drink, use [itemacts, ui/itemmenu].
- **Electronics salvage**: phones, laptops, sights, lights, radios, tools, generators, cars and wrecks give electronics [inventory, vehicles, basescatter, repair] `tools/partstest.js`. [details](../features/gear.md#electronics-salvage)
- **Physical rounds out of a fight**: reload, unload and swap magazines free at a base or in the field [itemacts, gunrounds] `tools/physroundstest.js`. [details](../features/gear.md#physical-rounds-out-of-a-fight-magazines-out-and-in)
- **Item condition and repair** that costs max durability [itemcond, repair].
- **Loot distribution** by site theme and gun tables; 18% of the plain dead carry a former survivor's kit [loot, gundist, gunfinds, inventory] `tools/loottest.js`. [details](../features/gear.md#loot-the-dead-who-were-survivors)
- **Survival guns, parts and gear**: SKS, Uzi, Halligan bar and more [data-survival, survival]. [details](../features/gear.md#survival-guns-parts-and-gear-2026-10-19)
- **Lock boxes and cases**: contents unseen until opened with the right tool [data-boxes, boxes, ui/boxview]. [details](../features/gear.md#lock-boxes-and-cases-2026-10-19)
- **Hidden item values** and worth tiers [valuation].
- **Team kit loadouts**, the governor buying guns [kit, govguns].

## 8. The dead, hives and hordes
Detail: [dead.md](../features/dead.md).
- **Hives** build hordes and must be destroyed to win [hives]; **hive birth** is visible and can be disrupted [hivebirth].
- **Hive tech tree**: growths around a hive unlock new dead [hivetech, hiveconst].
- **Bosses on 2 × 2 cells**: the Broodmother and the Hivemind [combat, defences, hivecrawl]. [details](../features/dead.md#bosses-on-2--2-cells)
- **Hive crawl**: chamber by chamber down to the Hivemind on a round grid of chambers [hivecrawl, citygrid]. [details](../features/dead.md#hive-crawl)
- **Hordes**: roles (guard, build, attack, roam) that merge on the State Map, drawn as a shuffling crowd of the dead [hordes, ui/mapfigures]. [details](../features/dead.md#hordes)
- **Special dead**: runners, brutes, spitters, screamers, crawlers, elites, Boneback, carriers, soldier dead, sleepers, dead beasts [zombietypes, acid, middead, carriers, deadbeasts]. [details](../features/dead.md#special-dead-and-the-dead-beasts)
- **Bodies on every floor**: a building's bodies on all its storeys, a scene's dead and survivors' bodies [sleepers, interiorscenes] `tools/scenestest.js`. [details](../features/dead.md#bodies-on-every-floor)
- **Attacked alone**: a lone worker or walker set upon by the dead [loneattack, tripevents]. [details](../features/dead.md#attacked-alone-2026-10-19)
- **Shepherd's aura** [decoys].
- **The counter-dead**: Digger, Melter, Husk, Tripper and Dark-walker bred against the defences a hive meets [counterdead, hivetech] `tools/counterdeadtest.js`. [details](../features/dead.md#the-counter-dead)
- **The Digger's tunnels**: under walls; kept on the base map until filled [tunnels]. [details](../features/dead.md#the-diggers-tunnels)
- **The pool of the dead widens with the years**, by place and era [deadpool]. [details](../features/dead.md#the-pool-of-the-dead-widens-with-the-years)

## 9. Base defence and sieges
Detail: [defence.md](../features/defence.md).
- **Horde defences**: walls and what happens when the dead break in [defences].
- **Defenses tab**: defenses open by base size; wall pieces and stands, sandbags, wire, spike pits, land mines [buildings, defences, wire, mines, fort] `tools/defensestest.js` `tools/wallpiecestest.js`. [details](../features/defence.md#defenses-tab)
- **Deploy step**: wall map, then yard and buildings, and the fort map [deploy, interior, fort].
- **Raids on the base map**: from any side; containers raided; the locked Armory; the defenders' keys [basemap, containers, fort]. [details](../features/defence.md#raids-on-the-base-map)
- **Defence plans** drilled ahead of time [defenceplan].
- **Perimeter alarm**: a powered Defenses build (shelter and up): nobody surprised over the wall, its sensors spot anything a tile out at night [data-power, electric, watch, defences]. [details](../features/defence.md#perimeter-alarm)
- **Bred against your defences**: counter-dead cut the hold; tunnels weaken walls until filled [counterdead, tunnels, defences]. [details](../features/dead.md#the-counter-dead)
- **Raids on you**, sized to your defence and escalating [factions].

## 10. Other groups, diplomacy and war
Detail: [groups.md](../features/groups.md).
- **AI groups**: growth, expansion, raids, convoys, attitude drift [factions].
- **AI parity**: groups heal, repair, build, trip, scavenge, flee hordes, take over abandoned bases, keep hidden outposts [groupcare, groupworld, groupworks, grouptrips, groupflight]. [details](../features/groups.md#ai-parity)
- **The groups' power grid**: an hourly power budget; groups build solar, batteries, alarm, heaters, charger [groupworks, grouppower, factions, groupbases, ui/diplomacy] `tools/gentierstest.js`. [details](../features/groups.md#the-groups-power-grid)
- **Group arsenals**: groups fight only with what they gathered, job kit included [arsenal]. [details](../features/groups.md#group-arsenals-and-job-kit)
- **Packing for the job**: a group's party packs for its job from its own stores [loadouts, parties] `tools/jobkittest.js`. [details](../features/groups.md#packing-for-the-job)
- **Combat and inventory parity**: every non-player human obeys your rules [members, groupbases, fighters, bands, groupmedical] `tools/conservationtest.js` `tools/paritytest.js`. [details](../features/groups.md#combat-and-inventory-parity)
- **Splinter bands** [splinters]; **AI blocs** ally and declare war [blocs].
- **Diplomacy**: relations matrix, pacts, wars between groups, brokering ceasefires [diplomacy].
- **Wars with you**: war goals and peace terms [playerwars].
- **Calder Coalition**: alliance, seasonal council, alliance victory [alliance]; **volunteers** lent between groups [volunteers].
- **Keeping the coalition together**: standing with fading modifiers, member asks, refusal fatigue, leaving and expulsion [coalition, ui/coalition] `tools/coalitiontest.js`. [details](../features/groups.md#keeping-the-coalition-together)
- **Envoys: word carried in person**: without a radio link every message, yours or theirs, goes by envoy [envoys, ui/envoys] `tools/envoystest.js` `tools/envoys2test.js`. [details](../features/groups.md#envoys-word-carried-in-person)
- **Volunteers on loan and joint operations**: borrowed people live at your base; joint ops meet at a rendezvous [loans, volunteers] `tools/loanstest.js`. [details](../features/groups.md#volunteers-on-loan-and-joint-operations)
- **Conquest**: assault bases, lose and retake them [conquest]; **occupy** abandoned bases [occupy]; **land claims** [claims].
- **Road conflicts**, captives, rescue raids and ransom [conflicts, rescueraid, ransom].
- **Prisoners**: your own and the AI's jails [prisoners, groupjails].
- **Trade**: barter, trade window, routes, caravans and escorts, raiding caravans [trade, caravans, escorts, caravanraids].
- **Meeting to trade**: a caravan meets yours at a base, halfway or a picked tile [trademeet] `tools/trademeettest.js`. [details](../features/groups.md#meeting-to-trade)
- **Jobs posted by groups** [jobs].
- **Outsiders/visitors** from beyond the state; raider bands live by the nomads' code [visitors]. [details](../features/groups.md#outsiders-and-raider-bands)
- **Nomads**: baseless bands of 3–10 in four tiers that camp, raid places and move on [nomads]. [details](../features/groups.md#nomads)

## 11. Radio and intel
- **Radio network**: stations and relays, talking to groups, radio deals and trades; radios are mid game; coverage is a map layer [radio, radiotrade]. [details](../features/groups.md#radio-network)
- **Your radio and your allies' on the Radio layer**: your rings in blue, each Coalition member's in its colour [radioallies, ui/render, ui/ui] `tools/radioalliestest.js`. [details](../features/groups.md#your-radio-and-your-allies-on-the-radio-layer)
- **Radio towers a base powers**: a generator and 2 fuel a day give 30 tiles of coverage; dark without fuel, raided, sabotaged [radiotower, data-radiotower, radio] `tools/radiotowertest.js`. [details](../features/groups.md#radio-towers-a-base-powers)
- **Listening in** on group channels [radiolisten].
- **Intel**: what groups overhear, radio discipline, decoys, captured scouts [intel]; notes on enemy bases and strength estimates [intelnotes, intelest].

## 12. Player tools, UI and presentation
Detail: [ui.md](../features/ui.md).
- **Autopilot governor**, also used headless for balance runs; fells for wood and staffs the felling [autopilot, noidle]. [details](../features/ui.md#autopilot-governor-wood)
- **Save/load and save list** [save, savesummary, ui/saves].
- **Diary, Ledger charts, history and chronicle**, and the **timelapse viewer** [diary, history, ui/ledger, chronicle, ui/timelapse].
- **Codex** encyclopedia, first-week guide and help [ui/codex, ui/guide, ui/help] `tools/guidetest.js`. [details](../features/ui.md#first-week-guide)
- **Command palette (Ctrl+K)**, minimap, watch list, map notes, threat bar [ui/cmdpalette, ui/minimap, watchlist, mapnotes, ui/threatbar].
- **New-run screen layout**: full screen, sticky header, settings in three groups, a crew grid that fits [ui/newgame, ui/title, ui/startgear] `tools/custombgtest.js` `tools/titletest.js`. [details](../features/ui.md#new-run-screen-layout)
- **Generating map popup**: a "Generating map…" box with a spinner and the size in hexes while a map is built [ui/newgame, main] `tools/generatingtest.js`. [details](../features/ui.md#generating-map-popup)
- **Static Crashlanding setup**: a crash run shows what its map holds and takes its defaults; traits, skills and look stay yours [ui/newgame, main, hardcore] `tools/crashlandinguitest.js`. [details](../features/ui.md#static-crashlanding-setup)
- **The boxes over the map by layout**: a chip strip on phones, a button row on desktops [ui/hudbar, ui/responsive, ui/overlaydrag] `tools/overlaytest.js`. [details](../features/ui.md#the-boxes-over-the-map-a-strip-on-phones-one-handle-on-desktops)
- **Windows and menus**: one chrome for the big windows (sticky title bar, ✕, scrolling tabs), tidier windows and panels [ui/windows, ui/ui, ui/settings, ui/layout, ui/mapselect] `tools/basenametest.js`. [details](../features/ui.md#windows-and-menus)
- **Touch input**: gestures, on-screen stand-ins for keys, battle taps that confirm [ui/touch, ui/responsive, ui/combat]. [details](../features/ui.md#touch-input)
- **Game controller**: any standard-mapping pad drives menus, the State Map and battles [ui/gamepad, ui/padnav, ui/inputmode] `tools/padnavtest.cjs`. [details](../features/ui.md#game-controller)
- **The whole game by pad**: SVG maps take the ring, a pointer for charts and the minimap, map picks and the base build map by cursor [ui/padnav, main, ui/combat, ui/poimap] `tools/padmaptest.cjs`. [details](../features/ui.md#the-whole-game-by-pad)
- **Key hints by device**: hints and tooltips worded for mouse, finger or pad [ui/hints, ui/inputmode]. [details](../features/ui.md#key-hints-by-device)
- **Seasonal trees**: autumn colours, bare snowy trees and bushes in winter, on every map [ui/seasontrees, ui/isoview, ui/terraindeco, ui/render] `tools/seasontreestest.js`. [details](../features/ui.md#seasonal-trees)
- **Interior decor**: rugs, clutter, wall art, painted rooms, floors by room, lights; lootable plants, lamps, paintings, clocks [decor, data-furniture, buildingmaps, ui/isoview] `tools/decortest.js`. [details](../features/ui.md#interior-decor)
- **Rocks and boulders**: grey tapering stone heaps; rocks knee high (half cover), boulders head high (full cover) on the battle, raid and base maps [ui/isoview]. [details](../features/ui.md#rocks-and-boulders)
- **Snow on buildings**: in winter, snow on roofs by its depth and on walls, fences, tents, cars and props in the open [ui/roofsnow, ui/isoview] `tools/roofsnowtest.js`. [details](../features/ui.md#snow-on-buildings)
- **Audio**: adaptive music director and synth score, ambience, SFX for guns, melee, zombies, doors, vehicles [ui/music*, ui/amb*, ui/sfx*].
- **Dev tools**: reveal the map; headless balance and test tools in `prototype/tools`.
- **Merge gate for dev**: the typecheck and the shared core tests in parallel, failing checks against a shrink-only baseline; `--against <ref>` diffs them `tools/gate.js`. [details](testing.md#before-merging-to-dev-the-gate)
