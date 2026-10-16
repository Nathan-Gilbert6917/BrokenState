# Broken State: major features

A map of the game's major features, for agents getting oriented. Built from the header comment of every module in `prototype/src/sim` and `prototype/src/ui`, plus `prototype/README.md` (2026-10-13). The modules for each feature are in brackets: `[name]` means `prototype/src/sim/name.js`, and `[ui/name]` means `prototype/src/ui/name.js`. When you add or remove a major system, update this file too.

## 1. Campaign, world and pacing
- **Procedural State of Calder**: hex map with terrain, rivers, cities, towns, countryside sites, roads and infection [mapgen, hex, worldsize]. World sizes run Small, Normal, Large and Huge, each with its own AI group count.
- **Hourly and daily simulation tick**, seeded and deterministic [world, rng].
- **Seasons and weather**: four 28-day seasons, regional weather fronts, frozen rivers in winter that people and the dead can cross [weather, rivers].
- **Eras**: early game (years 1–4), mid game (5–9) and late game (10+), with threats that grow each year [eras].
- **Two victories**: destroy every hive, or win with the Calder Coalition (an alliance holding over half the land). "Keep playing" is available after either one [world, alliance].
- **Hardcore mode**: start on the day Calder falls with 1–4 survivors on the road, no hub, sites only half looted, and the outbreak year [hardcore*, hardcore-start, hardcore-loot, hardcore-outbreak, hardcore-groups].
- **Bare start**: every base starts with empty plots [world HUB_START].
- **New-run shortcuts**: *Random run* rolls every setting (seed, size, groups, hives, mode, starting people, zombie look, the crew and gear, Customize's points) and starts at once; *New start position* moves where you start on the same map and seed, crew kept [ui/newgame rollRandomRun, startpick].
- **Outbreak beyond the border**: keeps a minimum number of hives alive [outbreak].
- **Event cards and pacing**: pause rules, a card tray, auto-answers, and speeds from 1× to 5× [cardrules, ui/pacing].
- **Hub events**: home decisions every few days [hubevents]. Also the harvest festival [festival].
- **7-day threat forecast** meter [forecast].

## 2. Survivors
- **Skills, XP, teaching, books and perks** [skills]. **Traits** with tiers and points [traits].
- **Needs**: hunger, thirst and mood gauges; eating person by person with a meal mood ladder, food preferences and ration levels [needs, eating].
- **Sleep and tiredness** [sleep].
- **Morale**: crowding, leader lift, desertion warnings and desertion [morale]. **Mental breaks** [mentalbreaks]. **Comforts and treats** [comforts].
- **Relationships**: grief, service record, memorial wall and daily mood factors [relations].
- **Family**: couples, pregnancy, births and children growing up [family].
- **Recruits**: newcomer choice cards for strangers, refugees, loners and returning deserters [recruits].
- **Appearance and sprites**, plus survivor customization (backgrounds, customization points, starting gear, random builds) [appearance, custombg, custompoints, startgear, randomkit].
- **Status icons** and a "Why did this happen?" cause chain for deaths and lost bases [status, causes].

## 3. Bases and economy
- **Base tiers**: camp, shelter, outpost and hub. Camps can be set up, struck and upgraded [staging].
- **Buildings and construction queue**: plots by base size, demolition refunds, water barrels and storage crates [buildings]. Field works outside the walls [fieldworks].
- **Work priorities** (RimWorld-style work tab): roles, a 1–5 priority grid and an hourly scheduler [work]. Also idle-worker assignment [idlework], the watch roster [watch], base stewards and leaders run by the governor [steward], and bulk roster actions [bulk].
- **Daily economy and upkeep per head** [economy, upkeep].
- **Water**: purified vs un-purified, wells and filters [water, claims].
- **Food**: food split by type with its own shelf life, spoiling, storage, preserving and jarring [foods, storage]. Also mealtimes [meals], the food chain and food ledger views [foodchain, foodlog].
- **Cooking**: Rimworld-style recipes from ingredients, food poisoning and the kitchen [cooking, kitchen].
- **Farming** with crops, plots, seasons and greenhouses [farming].
- **Hunting, snares, fishing and foraging** [hunting, foraging].
- **Woodcutting and heating**: firewood first, then fuel [woodcutting].
- **Job trips**: outdoor workers walk out to the base's land, with events for a lone worker and gear handed out for those trips [jobtrips, tripland, tripevents, tripgear].
- **Crafting**: hand crafting plus standing production orders/bills [crafting, production].
- **Power**: generators and an ethanol still [power].
- **Breakdowns**: fixtures wear out and need a named survivor to repair them [breakdowns].
- **Blueprints and manuals** that unlock top tiers [blueprints].
- **Supply runs** between your own bases [supply]. **Moving people** between bases and the overcrowding card [moveout].
- **Hidden bases**: run silent, camouflage [hiding].

## 4. Health and medicine
- **Wounds, infection and passive healing** [medical].
- **Hospital tiers**: infirmary, field hospital, clinic and trauma hospital, with medic staffing and bed caps [medical].
- **Illnesses** with causes, contagion, courses of meds and pneumonia [health]. Sick people rest until well [sickrest].
- **The worm**: the lore and mechanics of infection; people catch it from eggs in the soil and water, not from bites [worm].
- **Training medics**: ward rounds, a doctor and trainees, graduation [training].
- **Med scarcity by site type** [medfinds].
- **Battlefield medics**: dragging and stabilizing the downed [medics].

## 5. Teams, travel and exploration
- **Expeditions across the State Map**: supplies drain hour by hour, events roll tile by tile [parties].
- **Order queue and trip planner**: plans, templates and repeat trips [orders, plans, trips, ui/undo].
- **Team forming, team inventory, teams meeting on one tile** and handing goods over [teamform, teaminv, teammeet].
- **Carry weight and load bands**, physical supply carrying and carry kit/rigs [load, carry, carrykit].
- **Vehicles**: fuel, condition, breakdowns and bicycles; one person per vehicle [vehicles, walkers]. Also found cars (hotwiring, claiming), military trucks, Humvees and MRAPs [foundcars, miltrucks], road blockages [roadblocks], repairs on the road [repairwait], and vehicle trade [vehicletrade].
- **Boat crossings** over water [crossing].
- **Night on the road**: make camp or push through [nightmarch].
- **Field Heat**: a team that stays put draws attention [fieldheat].
- **Travel event cards** [events].
- **Discovery and hidden sites**, the Survey mission, rumours, and map markers with last-seen times [discovery, survey, markers].
- **Abstract scavenging** (hour-by-hour search with rising Heat) [scavenge]. Shared finite loot that AI groups also scavenge [aiscav].
- **City crawl**: block-by-block roguelike extraction into a city on a round grid of blocks (pick any rim block to start; north, east, south or west from every block; walk yourself back to the rim to get out, a breakout at high Alert), multi-storey buildings with who lives on each floor [citycrawl, floorfolk].
- **Crash sites and supply drops**, contested [crashes].
- **Wanderers**: neutral survivors and others met on the road [wanderers].
- **Optics**: binoculars, thermal imager and others [optics]. **Lights** carried for the dark [lights].

## 6. Tactical combat (XCOM-style)
- **Turn-based tactical battles** with an isometric view [combat, ui/isoview].
- **Battle map sizes** by context, from 24×18 up to 48×34, with anti-slog endings [battlesize].
- **Raids into building interiors**: procedurally generated buildings, containers and searches, raid loot carried by hand [buildingmaps, search, raidloot]. Also raid planning (entry side, scout, wait for night) [raidplan], and locks, keys and safes [locks, gunsafes].
- **Stealth**: takedowns, facing and view cones, sneaking, lights and darkness, indoor light switches [stealth, vision, indoorlight, ailights].
- **Hearing and deafening** [hearing].
- **Non-lethal weapons and taking people alive** (taser, stun baton, pepper spray) [nonlethal].
- **Throwables**: Molotovs, pipe bombs, flares and smoke [throwables]. **Decoys and fire**, and what the dead follow [decoys].
- **Things on the ground** and searching bodies [ground].
- **Retreat**: "Sound the retreat" on the map and break-off policies for auto-resolved fights [combat soundRetreat, breakoff].
- **Third side**: neutrals and soldiers who are neither your team nor its enemies [thirdside].
- **Siege kit**: ladders, rams and frag grenades [siege].
- **Vehicles in battle**: Humvee gunners, ramming gates [combat raidCarTurn].
- **Auto-resolve by the numbers** [combat autoResolveCombat].

## 7. Weapons, armour and gear
- **Weapons overhaul**: many real guns, melee weapons, blades and launchers [data-guns, data-blades, launchers].
- **Ammo by calibre and type**, physical magazines, rounds tracked in each gun, and a reloading bench [ammo, rounds, mags, gunload, gunrounds, reloading].
- **Gun mechanics**: fire modes, jams, suppression, over-penetration, and a damage ladder [gunfire, gunstats, ladder].
- **Attachments and gun builder**, Tarkov-style: sights, muzzles, stocks and more; factory-fitted guns; finishes and paint [gunmods, data-gunmods, partfinds, factoryfit, data-finish, ui/gunbuilder, ui/gunpaint].
- **Armour classes AC 1–6** with per-hit durability, helmets and face shields, plate carriers and rigs [armour, helmets, data-helmets, data-kit].
- **Inventory**: RPG equipment slots, pockets, packs and stacks [inventory, itemstack, stacks].
- **Item condition and repair** that costs max durability, Tarkov-style [itemcond, repair].
- **Loot distribution** by site theme and gun distribution tables [loot, gundist, gunfinds, blades].
- **Hidden item values** and worth tiers [valuation].
- **Team kit loadouts**, plus the governor buying guns [kit, govguns].

## 8. The dead, hives and hordes
- **Hives** build hordes and must be destroyed to win [hives]. **Hive birth** is visible and can be disrupted [hivebirth].
- **Hive tech tree**: growths around a hive unlock new dead [hivetech, hiveconst].
- **Hive crawl**: chamber by chamber down to the Hivemind, through a round grid of chambers, each open on 3 sides with 1 wall (a hallway with a room off the side), four mouths, one on each side, to pick from and walk back out by (the core deep in it, open on 1–2 sides; the beat through the walls, the warmth along the passages) [hivecrawl, citygrid].
- **Hordes** with roles (guard, build, attack, roam) that merge on the State Map [hordes].
- **Special dead**: runners, brutes, spitters (acid pools), screamers, crawlers, elites, a Broodmother [zombietypes, acid]. Mid-game dead such as the Boneback [middead]. Carriers and worm swarms [carriers]. Armoured soldier and riot dead [deadsoldiers]. Sleepers among the bodies [sleepers].
- **Shepherd's aura** [decoys].

## 9. Base defence and sieges
- **Horde defences**: walls and what happens when the dead break in [defences].
- **Deploy step**: wall map, then yard and buildings, and the fort map [deploy, interior, fort].
- **Defence plans** drilled ahead of time [defenceplan].
- **Raids on you**, sized to your defence and escalating [factions].

## 10. Other groups, diplomacy and war
- **AI groups**: growth, expansion, raids, convoys and attitude drift [factions].
- **AI parity**: groups heal, repair, build, trip, scavenge, flee hordes, take over abandoned bases and keep hidden outposts [groupcare, groupworld, groupworks, grouptrips, groupflight, hiding].
- **Group arsenals**: groups fight only with what they gathered [arsenal].
- **Splinter bands** [splinters]. **AI blocs**: groups ally and declare war [blocs].
- **Diplomacy**: relations matrix, pacts, wars between groups, brokering ceasefires [diplomacy].
- **Wars with you** with war goals and peace terms [playerwars].
- **Calder Coalition**: alliance, seasonal council and the alliance victory [alliance]. **Volunteers** lent between groups [volunteers].
- **Conquest**: assault bases, lose them and retake them [conquest]. **Occupy** abandoned bases [occupy]. **Land claims** [claims].
- **Road conflicts**, captives, rescue raids and ransom [conflicts, rescueraid, ransom].
- **Prisoners**, your own and the AI's jails [prisoners, groupjails].
- **Trade**: barter, trade window, trade routes, caravans and escorts, raiding caravans [trade, caravans, escorts, caravanraids].
- **Jobs posted by groups** [jobs].
- **Outsiders/visitors** from beyond the state [visitors].

## 11. Radio and intel
- **Radio network**: stations and relays, talking to groups, radio deals and radio trades [radio, radiotrade].
- **Listening in** on group channels [radiolisten].
- **Intel**: what groups overhear, radio discipline, decoys, captured scouts [intel]. Notes on enemy bases and estimates of their strength [intelnotes, intelest].

## 12. Player tools, UI and presentation
- **Autopilot governor** (also used headless for balance runs) [autopilot].
- **Save/load and save list** [save, savesummary, ui/saves].
- **Diary, Ledger charts, history and chronicle**, plus the **timelapse viewer** [diary, history, ui/ledger, chronicle, ui/timelapse].
- **Codex** encyclopedia, first-week guide and help [ui/codex, ui/guide, ui/help].
- **Command palette (Ctrl+K)**, minimap, watch list, map notes and a threat bar [ui/cmdpalette, ui/minimap, watchlist, mapnotes, ui/threatbar].
- **Audio**: adaptive music director and synth score, ambience, and SFX for guns, melee, zombies, doors and vehicles [ui/music*, ui/amb*, ui/sfx*].
- **Dev tools**: reveal the map, and headless balance and test tools in `prototype/tools`.
