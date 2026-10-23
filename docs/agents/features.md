# Broken State: major features

The feature map agents read first to find where a system lives. Built from the header comment of every module in `prototype/src/sim` and `prototype/src/ui`, plus `prototype/README.md` (2026-10-13); rewritten as a one-line-per-feature index on 2026-10-23, with the detail moved into `docs/features/`.

## Format (read before adding an entry)

- **One line per feature**: ``- **Name**: one-line plain summary [key modules] `tools/xtest.js`. [details](../features/<area>.md#heading)``. A small feature with no detail page ends at its modules.
- **Modules** in brackets: `[name]` is `prototype/src/sim/name.js`, `[ui/name]` is `prototype/src/ui/name.js`. Name the key modules only; tests are `prototype/tools/…`.
- **Sub-bullets** only where a feature genuinely needs them: at most ~4, one line each.
- **Detail goes in `docs/features/<area>.md`** under its own `##` heading: the user's request with its date, rules, numbers, constants, function names, AI parity, UI, every module and test. The index line links to it.
- Put the entry under its area's numbered section below. When you add or remove a major system, update this file and the area's detail page.

Detail pages: [campaign](../features/campaign.md) (1) · [survivors](../features/survivors.md) (2) · [bases](../features/bases.md) and [economy](../features/economy.md) (3) · [health](../features/health.md) (4) · [travel](../features/travel.md) (5) · [combat](../features/combat.md) (6) · [gear](../features/gear.md) (7) · [dead](../features/dead.md) (8) · [defence](../features/defence.md) (9) · [groups](../features/groups.md) (10, 11) · [ui](../features/ui.md) (12).

Older design docs: [docs/base-building/plan.md](../base-building/plan.md), [docs/reload-rules.md](../reload-rules.md), [docs/weapons-overhaul-plan.md](../weapons-overhaul-plan.md), [docs/ai-parity-audit.md](../ai-parity-audit.md), [docs/coalition-war-plan.md](../coalition-war-plan.md), [docs/multi-storey-crawl.md](../multi-storey-crawl.md), [docs/crawl-balance.md](../crawl-balance.md), [docs/prompts/](../prompts/); ADRs in [docs/adr/](../adr/) (0001 AI parity, 0002 base building).

## 1. Campaign, world and pacing
- **Procedural State of Calder**: hex map with terrain, rivers, cities, towns, countryside sites, roads and infection; world sizes Small, Normal, Large and Huge, each with its own AI group count [mapgen, hex, worldsize].
- **Hourly and daily simulation tick**, seeded and deterministic [world, rng].
- **Seasons and weather**: four 28-day seasons, regional weather fronts, frozen rivers in winter that people and the dead can cross [weather, rivers].
- **Rain in waves**: rain never covers the whole state; a rain or storm day sends 3–4 (storm 2–3) rain belts, long bands that sweep across the map from any edge in different directions, under a grey sky between them [weather WAVE, ui/wxmap] `tools/rainwavetest.js`. [details](../features/campaign.md#rain-in-waves)
- **Rain and fog on the State Map**: falling rain and drifting fog banks over the tiles where it rains or is foggy; fog and blizzards cut sight there by a tile for your teams, bases, watch towers and the groups' parties [ui/wxmap, ui/render, weather, world, parties, fieldworks, groupworld] `tools/mapwxtest.js`. [details](../features/campaign.md#rain-and-fog-on-the-state-map)
- **Ponds in the hollows**: rain fills hollows into ponds, dry days turn them to mud then dry, winter freezes them; the climb ×1.5 in rain, ×2.5 in winter [ponds, combat, basemap, ui/isoview] `tools/terrainweathertest.js`. [details](../features/campaign.md#ponds-in-the-hollows)
- **Seasonal weather in play**: in battle, ice slips (snow's slowing is the ground by the season's), rain muffles sounds and drowns noise lures, rain fog cuts sight like a fog bank (night fog far more); spring rains more often [seasonfx, weather, combat, stealth, vision, wxsight] `tools/seasonfxtest.js`. [details](../features/campaign.md#seasonal-weather-in-play)
- **The ground by the season**: spring mud in patches on dirt (+0.5 a step), autumn's red, orange and brown leaves on the ground, winter snow on all the outdoor ground (+0.25 a step, deep snow +0.5), on fight, raid and base maps, every side alike [seasonground, combat, ui/groundlook, ui/isoview] `tools/seasongroundtest.js`. [details](../features/campaign.md#the-ground-by-the-season)
- **Puddles after rain**: after 3 hours of rain on a tile (its own rain belts), puddles stand on the level outdoor ground of its fight, raid and base maps, more the longer it rains (3% to 15% of that ground), drying out over 12 hours once it stops; decor only (no move cost or aim), rings on them while it rains [puddles, combat, ui/groundlook, ui/isoview, ui/battlewx] `tools/puddletest.js`. [details](../features/campaign.md#puddles-after-rain)
- **Ponds on the map**: about one open tile in twenty has a spring-fed pond, drawn on the State Map (frozen when the ponds ice over) and a hollow of water on its base, fight and raid maps that never dries [mapgen, ponds, basescatter, relief, ui/terraindeco, ui/render] `tools/worldpondtest.js`. [details](../features/campaign.md#ponds-on-the-map)
- **Eras**: early game (years 1–4), mid (5–9) and late (10+), threats growing each year [eras].
- **Two victories**: destroy every hive, or win with the Calder Coalition (over half the land); "Keep playing" after either [world, alliance].
- **Hardcore mode**: start the day Calder falls with 1–4 survivors on the road, no hub, half-looted sites and the outbreak year's own cards [hardcore*, hardcore-start, hardcore-loot, hardcore-outbreak, hardcore-groups]. [details](../features/campaign.md#hardcore-mode)
- **Bare start**: bases start with empty plots; the normal hub starts with a Lodge of four beds, a tent and eight crop plots, away from towns [world HUB_START / HUB_LAYOUT, startpick]. [details](../features/campaign.md#bare-start-and-the-hubs-start-layout)
- **New-run shortcuts**: Random run, New start position and Pick start on map [ui/newgame, startpick, main] `tools/startpicktest.js`. [details](../features/campaign.md#new-run-shortcuts)
- **World configuration**: the new-run *World…* window's dials and presets, kept in `state.worldCfg` [worldcfg, ui/worldcfg]. [details](../features/campaign.md#world-configuration)
- **Outbreak beyond the border**: keeps a minimum number of hives alive [outbreak].
- **Event cards and pacing**: pause rules, a card tray, auto-answers, speeds 1× to 5× [cardrules, ui/pacing].
- **Hub events**: home decisions every few days (a fire, a quarrel, a peddler, rats in the stores, the dead at the fence, a sick traveller, a cold snap, music at night, a wreck to strip, flu season, bad water, a coughing stranger and more) [hubevents, disease]; the harvest festival [festival].
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
- **Appearance and customization**: backgrounds, points, starting gear, random kits with their ammo; low-poly figures on the battle map and State Map [appearance, custombg, custompoints, startgear, randomkit, ui/figures, ui/mapfigures]. [details](../features/survivors.md#appearance-figures-and-customization)
- **Status icons** and a "Why did this happen?" cause chain for deaths and lost bases [status, causes].

## 3. Bases and economy
Base detail: [bases.md](../features/bases.md). Economy detail: [economy.md](../features/economy.md).
- **Base tiers**: camp, shelter, outpost and hub; camps set up, struck and upgraded [staging, basemap, basescatter, buildings, ui/campsite] `tools/campspottest.js`. [details](../features/bases.md#base-tiers)
- **What a camp's spot is like**: the picker's facts for a 5 × 5 (ground, the lie round it, sight, room, wood, water, road, places, the dead) and the game's own pick scored on them, with why [siteinfo, basemap defaultSite, ui/campsite] `tools/campspottest.js`. [details](../features/bases.md#what-a-camps-spot-is-like)
- **Scouting before a camp**: a scouted tile gets the picker; an unscouted one sets up blind on a random spot, its map fogged and its dead attacking until cleared (or raided from the POI map) [campscout, staging, parties, survey, poiraid] `tools/campscouttest.js`. [details](../features/bases.md#scouting-before-a-camp)
  - Pick the camp's 5 × 5 spot on the tile's 250 × 250 map; setup time and wood depend on the clearing and an axe.
  - Step ups (Shelter shack, Outpost house, Main house) are buildings placed on the map: picked from the Build list and placed by hand, never queued for you on setting up (ui/basemap openToPlace) `tools/stepupplacetest.js`.
  - The camp fire: stones, a log lay, embers, flickering flames, sparks, smoke and a glow (ui/isoview drawCampfireIso, ui/battlelights).
  - Clearing the spot of the dead first on towns, cities and infected tiles [siteclear] `tools/siteclearest.js`.
  - "Open the build map" prompt for new bases (key U) [ui/buildmap] `tools/buildmapbtntest.js`.
- **Buildings and construction queue**: plots, demolition refunds, the storage ladder, general buildings and fittings [buildings]; field works outside the walls [fieldworks]. [details](../features/bases.md#buildings-and-construction-queue)
- **Base storage limits**: storage is kg of room by tier and buildings; what does not fit lies outside, weathers and is raided first [basestorage, ui/storage] `tools/basestoragetest.js` `tools/basestoragemaptest.js` `tools/groupstoragetest.js` `tools/assaultstoretest.js`. [details](../features/bases.md#base-storage-limits)
- **The base map**: every base's 250 × 250 grid, its land (trees, towns, hills, crag) to clear, placement rules and Move [basemap, basescatter, ui/basemap, ui/isoview] `tools/baseviewtest.js`. [details](../features/bases.md#the-base-map)
- **Every way in stays open**: the massif never walls ground in (passes carved), towns' doors reachable, nothing placed on rock; reachability and determinism tests over every kind of tile [basescatter, relief, basemap] `tools/mapreachtest.js`, `tools/mapdeterminismtest.js`. [details](../features/bases.md#every-way-in-stays-open)
- **Terraforming**: Dig a hollow (−1 at most) and Raise a hill on the base map, shovels one a person, dirt dug and spent, raised hills melded into the land's [terraform, basescatter landOf, basemap, buildings, ui/basemap] `tools/terraformtest.js`. [details](../features/bases.md#terraforming)
- **Base building**: the build map twice the size round the base, nothing within 3 cells of its edge (basemap VIEW_SCALE, VIEW_EDGE), no-build margin, general buildings with fittings, a way in and out, doorways, containers, repair orders [basemap, containers, breakdowns, autopilot] `tools/basebuildtest.js` `tools/containerstest.js` `tools/basebuilduitest.js` `tools/repairorderstest.js` `tools/basebuildautotest.js`. [details](../features/bases.md#base-building)
- **Beds as furniture**: cots, beds, bunk beds and large beds set in buildings; one rough-sleeping rule [beds, data-beds] `tools/bedstest.js`. [details](../features/bases.md#beds-as-furniture)
- **Work priorities** (RimWorld-style): roles, a 1–5 grid and an hourly scheduler [work]; idle-worker assignment [idlework], watch roster [watch], stewards and leaders [steward], bulk roster actions [bulk].
- **No idle workers**: anyone whose job has no work helps elsewhere and keeps their role [noidle, autopilot] `tools/noidletest.js`. [details](../features/economy.md#no-idle-workers)
- **Daily economy and upkeep per head** [economy, upkeep].
- **Water**: purified vs un-purified, wells and filters [water, claims].
- **Food**: types with their own shelf life, spoiling, storage, preserving and jarring [foods, storage]; mealtimes [meals], food chain and ledger views [foodchain, foodlog].
- **Cooking**: Rimworld-style recipes from ingredients, food poisoning and the kitchen [cooking, kitchen].
- **Farming**: crops, seasons, greenhouses; crop plots are 2 × 2 pieces placed on soil [farming, buildings farm_plot, basemap]. [details](../features/economy.md#farming-placed-crop-plots)
- **Hunting, snares, fishing and foraging** [hunting, foraging].
- **Winter's lean months**: frost kills crops; forage, game, fish and wood yield less in winter [winter, weather, farming]. [details](../features/economy.md#winters-lean-months)
- **Woodcutting and heating**: wood is fuel and a building material; wooden builds cost wood; felling on the base map [woodcutting, woodwork, upkeep, needs] `tools/woodworktest.js`. [details](../features/economy.md#woodcutting-and-heating)
- **Job trips**: outdoor workers walk out to the base's land, with events and trip gear [jobtrips, tripland, tripevents, tripgear].
- **Teamwork on job trips**: workers on the same job and tile are a crew sharing load, events, battles and loot [teamwork, jobtrips, tripevents, loneattack]. [details](../features/economy.md#teamwork-on-job-trips)
- **Tools as prerequisites**: builds and recipes need tool kinds (hammer, saw, axe…) at the base [data-tools, toolreqs, buildings, crafting] `tools/toolreqstest.js`. [details](../features/economy.md#tools-as-prerequisites)
- **Crafting**: hand crafting plus standing production orders/bills; recipes can make stacks [crafting, production, itemstack]. [details](../features/economy.md#crafting-stacks)
- **Building materials and metal sheets**: two-handed heavy supplies every build needs by size; made from scrap on site [buildmats, buildings, data-supitems, carry]. [details](../features/economy.md#building-materials-and-metal-sheets)
- **Power grid**: found generators, spotlights, a breaker panel, ammo press, fridges, pumps, fence chargers [power, electric, data-power, ui/production] `tools/powergridtest.js`. [details](../features/economy.md#the-power-grid)
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
- **Team forming, team inventory, teams meeting** and handing goods over; supplies and rounds onto a named member; guns leave loaded [teamform, teaminv, teammeet, supitems, gunrounds]. [details](../features/travel.md#team-inventory-and-handing-over-goods)
- **Carry weight and load bands**, physical supply carrying, carry kit and rigs; full hands in a fight [load, carry, carrykit, ui/carry]. [details](../features/travel.md#the-hands-in-a-fight)
- **Vehicles**: fuel, condition, breakdowns, bicycles, one person per vehicle [vehicles, walkers]; found cars (hotwiring, claiming) [foundcars], military trucks, Humvees and MRAPs [miltrucks], road blockages [roadblocks], road repairs [repairwait], vehicle trade [vehicletrade].
- **Boat crossings** over water [crossing].
- **Night on the road**: make camp or push through [nightmarch].
- **Tents**: tent bags found as loot in three sizes plus a makeshift tent; pitched at camp as beds and dry storage [tents, data-tents] `tools/tentstest.js`. [details](../features/travel.md#tents)
- **Campsites**: a POI of tents round a fire, abandoned, overrun or a raider camp [campsite] `tools/campsitetest.js`. [details](../features/travel.md#campsites)
- **Field Heat**: a team that stays put draws attention [fieldheat].
- **Travel event cards**: rolled tile by tile by ground, season, weather and the dead nearby (the dead ahead, a blocked highway, a swollen creek, wolves or feral dogs, a painted horde warning, a lonely farmhouse, an orchard, a roadside gas station, an overrun camp, a stranger with the worm, the worm's dead animals in a field…) [events].
- **Discovery and hidden sites**, the Sweep area mission (the old radius Survey), rumours, map markers with last-seen times [discovery, survey, markers].
- **Points of interest (POIs)**: 0–4 small places per land tile with their own loot pools [pois, mapgen, ui/poiview]. [details](../features/travel.md#points-of-interest-pois)
- **Gun stores, pawn shops and hardware stores**: shops with richer gun, gear and building-material finds [shops, shopshelves]. [details](../features/travel.md#gun-stores-pawn-shops-and-hardware-stores)
- **Shops and services as franchises**: 14 more site types, each place one of 4–10 chains with its own look and layout [shops, data-shops, buildingmaps]. [details](../features/travel.md#shops-and-services-as-places-as-franchises)
- **POI surveys and the per-POI raid flow**: Survey and Quick look, per-POI threat, raids into one POI at a time [survey, pois, poiraid, ui/poipick]. [details](../features/travel.md#poi-surveys-and-the-per-poi-raid-flow)
- **Walking to a POI**: 5–20 minutes to each place, a tile map dialogue, the walk shown, leaving by an edge [poiwalk, ui/poimap, ui/poipick] `tools/poiwalktest.js`. [details](../features/travel.md#walking-to-a-poi)
- **Tile heat and persistent POI containers**: heat per tile; containers keep their contents between visits [pois, poicont]. [details](../features/travel.md#tile-heat-and-persistent-poi-containers)
- **Other groups survey and raid POIs** with their own knowledge, picker and the shared ledger [grouppois, aiscav, visitors]. [details](../features/travel.md#other-groups-survey-and-raid-pois)
- **Abstract scavenging**: hour-by-hour search with rising Heat [scavenge]; shared finite loot AI groups also scavenge [aiscav].
- **City crawl**: block-by-block roguelike extraction on a round grid of blocks (start at any rim block; north, east, south or west from every block; walk back to the rim to get out, a breakout at high Alert); multi-storey buildings with who lives on each floor [citycrawl, floorfolk].
- **Crash sites and supply drops**, contested [crashes].
- **Wanderers**: neutral survivors and others met on the road [wanderers].
- **Optics**: binoculars, thermal imager and others [optics]; **lights** carried for the dark [lights].

## 6. Tactical combat (XCOM-style)
Detail: [combat.md](../features/combat.md).
- **Terrain in combat**: high ground aims +5 a level (to +15) and sees further, uphill −5 a level, a hill half cover a level up and full two up, a hollow sees only its rim, a hill sees into an upper floor through a window, the AI paths and stands by the land [combat, highground, ui/combat, ui/battlehud] `tools/terraincombattest.js`. [details](../features/combat.md#terrain-in-combat)
- **Weather in battle**: the State Map's weather over the fight's tile drawn over raids and battles (rain and storms, fog banks, snow), and fog or a blizzard cutting every side's sight [wxsight, stealth, ui/battlewx, ui/isoview, ui/display] `tools/battlewxtest.js`. [details](../features/combat.md#weather-in-battle-rain-fog-and-snow)
- **Turn-based tactical battles** with an isometric view [combat, ui/isoview].
- **Walking on the battle map**: moves animated cell by cell at each mover's pace [ui/moveanim, ui/combat, ui/figures] `tools/moveanimtest.js`. [details](../features/combat.md#walking-on-the-battle-map)
- **Lost pictures drawn again**: every cached picture redrawn after a GPU context loss [ui/pictures]. [details](../features/combat.md#lost-pictures-drawn-again)
- **Battle map sizes** by context (24×18 to 48×34; raids 32×24 to 56×42) with anti-slog endings [battlesize, worldcfg] `tools/raidshot.cjs`. [details](../features/combat.md#battle-map-sizes)
- **A raid without the side panel**: full-screen raid map with a top strip, cards and a log window [ui/combat, ui/logwindow] `tools/raidscreentest.js`. [details](../features/combat.md#a-raid-without-the-side-panel)
- **Before you go in**: the raid plan window (scout, wait for night, kit, side to enter, leave) [raidplan, ui/raidplan]. [details](../features/combat.md#before-you-go-in-the-raid-plan)
- **Raids into building interiors**: generated buildings, containers, searches, neighbourhood streets; locks, keys, safes and makeshift picks [buildingmaps, search, raidloot, raidplan, locks, gunsafes] `tools/makeshiftpicktest.js`. [details](../features/combat.md#raids-into-building-interiors)
- **Stealth**: takedowns, facing and view cones, sneaking, lights and darkness, indoor light switches [stealth, vision, indoorlight, ailights].
- **Vaulting half cover**: over waist-high cells at extra cost, landing winded [combat VAULT]. [details](../features/combat.md#vaulting-half-cover)
- **Windows and the kinds of door**: window states (open, locked, broken) and door kinds with their own hit points, sight and locks [windows, buildingmaps DOOR_KINDS, locks]. [details](../features/combat.md#windows-and-the-kinds-of-door)
- **Raiders and the dead fight each other in a raid**; unseen shots are heard and marked in the fog [crossfire] `tools/crossfiretest.js`. [details](../features/combat.md#raiders-and-the-dead-fight-each-other-in-a-raid)
- **Barricades**: shove furniture, board up doors and windows; the dead crawl over half cover [barricade] `tools/barricadetest.js`. [details](../features/combat.md#barricades)
- **Shoving people and the dead**: push back or floor a foe; the dead grapple [shoving] `tools/shovetest.js` `tools/shoveviewtest.js` `tools/shovebalance.js`. [details](../features/combat.md#shoving-people-and-the-dead)
- **Soft cover: bushes and tents**: conceal but never stop bullets; tents tear and are mended [softcover] `tools/softcovertest.js`. [details](../features/combat.md#soft-cover-bushes-and-tents)
- **Taking tents down and slashing them** in a fight, and stealing the bag [tentfight, softcover] `tools/campsitetest.js`. [details](../features/combat.md#taking-tents-down-and-slashing-them)
- **Hearing and deafening**; ear protection works only in the Ear pro slot [hearing, helmets] `tools/heartest.js` `tools/holstertest.js`. [details](../features/combat.md#hearing-deafening-and-ear-pro)
- **Side arm and melee slots**: draw a holstered handgun or belt blade for 1 action [holsters, combat, equip] `tools/holstertest.js`. [details](../features/combat.md#side-arm-and-melee-slots)
- **Non-lethal weapons and taking people alive** (taser, stun baton, pepper spray) [nonlethal].
- **Throwables**: Molotovs, pipe bombs, flares, smoke [throwables]; **decoys and fire**, what the dead follow [decoys].
- **Car alarms**: set one off by hand or with a bottle through the window to pull the dead off you; smashing the glass, prying a door or hotwiring can set one off [caralarms, foundcars, stealth, decoys, locks, ui/carpanel, ui/sfx-vehicles] `tools/caralarmtest.js`. [details](../features/combat.md#car-alarms)
- **Things on the ground** and searching bodies [ground]; the ground in a survivor's inventory window [ui/inventory, carry]. [details](../features/combat.md#the-ground-in-a-survivors-inventory)
- **Retreat**: "Sound the retreat" and break-off policies for auto-resolved fights [combat soundRetreat, breakoff].
- **Third side**: neutrals and soldiers who are neither your team nor its enemies [thirdside].
- **Talking to other groups in a raid**: call out, truce, trade, recruit or ally for the battle; treachery and grudges [parley, thirdside]. [details](../features/combat.md#talking-to-other-groups-in-a-raid)
- **Orders to allies**: give an allied survivor an order for 1 action; they may ignore it [allyorders]. [details](../features/combat.md#orders-to-allies)
- **Siege kit**: ladders, rams and frag grenades; groups and raiders bring only their own [siege, arsenal, visitors]. [details](../features/combat.md#siege-kit)
- **Vehicles in battle**: Humvee gunners, ramming gates [combat raidCarTurn].
- **Auto-resolve by the numbers** [combat autoResolveCombat].

## 7. Weapons, armour and gear
Detail: [gear.md](../features/gear.md).
- **Weapons overhaul**: many real guns, melee weapons, blades and launchers [data-guns, data-blades, launchers].
- **Physical rounds in a fight**: rounds are real stacks in guns and magazines; Reload draws only on the shooter's own kit [roundstack, mags, ammo, gunload, kitcheck] `tools/reloadpicktest.js`. [details](../features/gear.md#physical-rounds-in-a-fight)
- **Ammo by calibre and type**: boxed or loose rounds, physical magazines, a reloading bench; reload cost by where the rounds are [ammo, rounds, mags, gunload, gunrounds, reloading, itemstack]. [details](../features/gear.md#ammo-by-calibre-reload-sources-and-loading-magazines)
- **Gun mechanics**: fire modes, jams, suppression, over-penetration, a damage ladder [gunfire, gunstats, ladder].
- **Attachments and gun builder** (Tarkov-style): sights, muzzles, stocks and more; factory-fitted guns, finishes and paint [gunmods, data-gunmods, partfinds, factoryfit, data-finish, ui/gunbuilder, ui/gunpaint].
- **Armour classes AC 1–6**: per-hit durability, helmets and face shields, plate carriers, rigs with pocket pouches [armour, helmets, data-helmets, data-kit]. [details](../features/gear.md#armour-and-rigs)
- **Inventory**: RPG slots, pockets, packs and stacks; weight lines, supplies as items, kit moves and hand-overs in a fight [inventory, itemstack, stacks, supitems]. [details](../features/gear.md#inventory)
- **Item icons**: a 16 × 16 pixel drawing for every non-gun item [ui/itemart, ui/itemart/*].
- **Item right-click menu** (Tarkov-style): equip, reload, unload, modify, repair, salvage, eat, drink, use [itemacts, ui/itemmenu].
- **Physical rounds out of a fight**: reload, unload and swap magazines free at a base or in the field [itemacts, gunrounds] `tools/physroundstest.js`. [details](../features/gear.md#physical-rounds-out-of-a-fight-magazines-out-and-in)
- **Item condition and repair** that costs max durability [itemcond, repair].
- **Loot distribution** by site theme and gun tables [loot, gundist, gunfinds, blades, survival, boxes]; 18% of the plain dead carry a former survivor's kit [inventory ZSURV] `tools/loottest.js` `tools/itemcondtest.js`. [details](../features/gear.md#loot-the-dead-who-were-survivors)
- **Survival guns, parts and gear** (2026-10-19): SKS, Uzi, Halligan bar and more [data-survival, survival]. [details](../features/gear.md#survival-guns-parts-and-gear-2026-10-19)
- **Lock boxes and cases** (2026-10-19): contents unseen until opened with the right tool [data-boxes, boxes, ui/boxview]. [details](../features/gear.md#lock-boxes-and-cases-2026-10-19)
- **Hidden item values** and worth tiers [valuation].
- **Team kit loadouts**, the governor buying guns [kit, govguns].

## 8. The dead, hives and hordes
Detail: [dead.md](../features/dead.md).
- **Hives** build hordes and must be destroyed to win [hives]; **hive birth** is visible and can be disrupted [hivebirth].
- **Hive tech tree**: growths around a hive unlock new dead [hivetech, hiveconst].
- **Bosses on 2 × 2 cells**: the Broodmother and the Hivemind [combat, defences, hivecrawl]. [details](../features/dead.md#bosses-on-2--2-cells)
- **Hive crawl**: chamber by chamber down to the Hivemind on a round grid of chambers [hivecrawl, citygrid]. [details](../features/dead.md#hive-crawl)
- **Hordes**: roles (guard, build, attack, roam) that merge on the State Map [hordes]; drawn as a crowd of the dead shuffling the way the horde drifts [ui/mapfigures mapHordeCanvas].
- **Special dead**: runners, brutes, spitters, screamers, crawlers, elites [zombietypes, acid], Boneback [middead], carriers [carriers], soldier dead [deadsoldiers], sleepers [sleepers], dead beasts [deadbeasts]. [details](../features/dead.md#special-dead-and-the-dead-beasts)
- **Attacked alone** (2026-10-19): a lone worker or walker set upon by the dead [loneattack, tripevents]. [details](../features/dead.md#attacked-alone-2026-10-19)
- **Shepherd's aura** [decoys].
- **The counter-dead**: Digger, Melter, Husk, Tripper and Dark-walker bred against the defences a hive meets [counterdead, hivetech] `tools/counterdeadtest.js`. [details](../features/dead.md#the-counter-dead)
- **The Digger's tunnels**: under walls; kept on the base map until filled [tunnels]. [details](../features/dead.md#the-diggers-tunnels)
- **The pool of the dead widens with the years**, by place and era [deadpool]. [details](../features/dead.md#the-pool-of-the-dead-widens-with-the-years)

## 9. Base defence and sieges
Detail: [defence.md](../features/defence.md).
- **Horde defences**: walls and what happens when the dead break in [defences].
- **Defenses tab**: defenses open by base size; wall pieces and stands, sandbags, wire, spike pits, land mines [buildings, defences, wire, mines, fort] `tools/defensestest.js` `tools/wallpiecestest.js` `tools/sandbagstest.js`. [details](../features/defence.md#defenses-tab)
- **Deploy step**: wall map, then yard and buildings, and the fort map [deploy, interior, fort].
- **Raids on the base map**: from any side; containers raided; the locked Armory; the defenders' keys [basemap, containers, fort]. [details](../features/defence.md#raids-on-the-base-map)
- **Defence plans** drilled ahead of time [defenceplan].
- **Bred against your defences**: counter-dead cut the hold; tunnels weaken walls until filled [counterdead, tunnels, defences]. [details](../features/dead.md#the-counter-dead)
- **Raids on you**, sized to your defence and escalating [factions].

## 10. Other groups, diplomacy and war
Detail: [groups.md](../features/groups.md).
- **AI groups**: growth, expansion, raids, convoys, attitude drift [factions].
- **AI parity**: groups heal, repair, build, trip, scavenge, flee hordes, take over abandoned bases, keep hidden outposts [groupcare, groupworld, groupworks, grouptrips, groupflight, hiding].
- **Group arsenals**: groups fight only with what they gathered, job kit included [arsenal]. [details](../features/groups.md#group-arsenals-and-job-kit)
- **Packing for the job**: a group's party packs for its job from its own stores [loadouts, parties] `tools/jobkittest.js`. [details](../features/groups.md#packing-for-the-job)
- **Combat and inventory parity**: every non-player human obeys your rules ([ADR 0001](../adr/0001-ai-parity.md)) [members, groupbases, fighters, bands, groupmedical] `tools/conservationtest.js` `tools/paritytest.js`. [details](../features/groups.md#combat-and-inventory-parity)
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
- **Your radio and your allies' on the Radio layer**: your rings in blue, each Calder Coalition member's in its colour with its reach and link; groups outside the coalition never shown [radioallies, ui/render, ui/ui renderLegend] `tools/radioalliestest.js`. [details](../features/groups.md#your-radio-and-your-allies-on-the-radio-layer)
- **Listening in** on group channels [radiolisten].
- **Intel**: what groups overhear, radio discipline, decoys, captured scouts [intel]; notes on enemy bases and strength estimates [intelnotes, intelest].

## 12. Player tools, UI and presentation
Detail: [ui.md](../features/ui.md).
- **Autopilot governor**, also used headless for balance runs; fells for wood and staffs the felling [autopilot, noidle]. [details](../features/ui.md#autopilot-governor-wood)
- **Save/load and save list** [save, savesummary, ui/saves].
- **Diary, Ledger charts, history and chronicle**, and the **timelapse viewer** [diary, history, ui/ledger, chronicle, ui/timelapse].
- **Codex** encyclopedia, first-week guide and help [ui/codex, ui/guide, ui/help] `tools/guidetest.js`. [details](../features/ui.md#first-week-guide)
- **Command palette (Ctrl+K)**, minimap, watch list, map notes, threat bar [ui/cmdpalette, ui/minimap, watchlist, mapnotes, ui/threatbar].
- **Touch input**: gestures, on-screen stand-ins for keys, battle taps that confirm [ui/touch, ui/responsive, ui/combat]. [details](../features/ui.md#touch-input)
- **Game controller**: any standard-mapping pad drives menus, the State Map and battles [ui/gamepad, ui/padnav, ui/inputmode] `tools/padnavtest.cjs`. [details](../features/ui.md#game-controller)
- **The whole game by pad**: the POI map's and crawls' SVG places take the ring, a pointer for charts and the minimap, Pick start on map, the camp-site picker and the base build map by cursor [ui/padnav, main, ui/combat, ui/poimap] `tools/padmaptest.cjs`. [details](../features/ui.md#the-whole-game-by-pad)
- **Key hints by device**: hints and tooltips worded for mouse, finger or pad [ui/hints, ui/inputmode]. [details](../features/ui.md#key-hints-by-device)
- **Seasonal trees**: red, orange and brown leaves in autumn, bare trees and bushes with snow on them in winter, on the battle, raid and base maps and the State Map [ui/seasontrees, ui/isoview, ui/terraindeco, ui/render] `tools/seasontreestest.js`. [details](../features/ui.md#seasonal-trees)
- **Rocks and boulders**: grey stone heaps with flat tops that taper like the hills, uneven outlines; rocks knee high (half cover), boulders head high (full cover) on the battle, raid and base maps [ui/isoview]. [details](../features/ui.md#rocks-and-boulders)
- **Snow on buildings**: while snow lies (winter), roofs white with drifts by its depth (flat roofs most, shingles and metal showing through), snow along wall tops, fences, sandbags, tents, cars and the rest out in the open, on the battle, raid and base maps [ui/roofsnow, ui/isoview] `tools/roofsnowtest.js`. [details](../features/ui.md#snow-on-buildings)
- **Audio**: adaptive music director and synth score, ambience, SFX for guns, melee, zombies, doors, vehicles [ui/music*, ui/amb*, ui/sfx*].
- **Dev tools**: reveal the map; headless balance and test tools in `prototype/tools`.
