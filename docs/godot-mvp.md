# Broken State: every feature and system, and a one-person Godot MVP

Written 2026-11-02 from `docs/agents/features.md` (the feature index), `docs/features/<area>.md` and the rebuild
board (`board/data/card-order.md`, `board/data/fixups.json`). The prototype is about 412 sim modules and 185 UI
modules (about 209k lines of sim code), so Part 1 groups them into systems. Where a system has many content
variants (for example the 30-odd building-layout families), they share one line.

- **Part 1**: the complete list of features and systems, in 12 areas.
- **Part 2**: the minimum viable product: a vertical slice that one person can build in Godot 4 .NET (C#).

---

## Part 1: the complete feature and system list

The game has three layers of play:

1. The **State Map**: a hex map of the State of Calder, with teams, other groups, hordes, hives, weather and
   seasons.
2. **Bases**, run like RimWorld: survivors with needs, work priorities, buildings, food, crafting and power.
3. **XCOM-style tactical battles**: turn-based isometric raids into procedurally laid-out buildings.

### 1. Campaign, world and pacing
- **Procedural world generation**: a hex map with terrain, rivers, roads, cities, towns, POIs and infection. Sizes
  run from Small (150 × 75) to Huge (500 × 300). Every name is unique, and the last 4 maps are cached between
  settings.
- **Simulation clock**: a seeded, deterministic hourly and daily tick, with speeds from 1× to 5× and pause rules.
- **Seasons and weather**: four 28-day seasons and regional weather fronts.
  - Rain comes in waves. Fog and blizzards cut sight.
  - Rivers freeze in winter, and ponds fill and dry.
  - The ground changes with the season (mud, leaves, snow), with puddles after rain.
  - Weather affects vehicles, and the State Map shows it.
- **Eras**: early (years 1–4), mid (years 5–9) and late (year 10 on). The threat grows every year.
- **Outbreak pressure** keeps a minimum number of hives alive.
- **Victory**: destroy every hive, or win with the Calder Coalition (over half the land). "Keep playing" is offered
  after either victory.
- **Game modes**:
  - Normal and Hardcore, which start on the road with no hub, tents and a car.
  - Hardcore's extra rules: Ironman, scarce loot, slow healing and no forecast.
  - Crashlanding: the lone survivor of a downed helicopter, 3 years into the outbreak, with a secret bunker.
  - Custom, with world-configuration dials and presets.
  - The new-run screen: a random run, picking the start on the map, crew dice, starting vehicles and gear, and
    each crew member's inventory.
- **Event cards and pacing**: a card tray, auto-answers and pause rules.
- **Hub events** every few days (a fire, a quarrel, a peddler, flu season), and a harvest festival.
- **A 7-day threat forecast.**
- **Meta**:
  - 31 achievements.
  - A hall of fame of past endings.
  - A diary, ledger charts, a chronicle and a timelapse viewer.

### 2. Survivors
- **Skills, XP, teaching, books and perks.** Traits with tiers and point costs.
- **Needs**: hunger, thirst, sleep and mood. Each person eats on their own terms, with a meal mood ladder,
  preferences and rations.
- **Morale**: crowding, the leader's lift, desertion, mental breaks, and comforts and treats.
- **Relationships and bonds**, from rival to partner. They give work and mood buffs, and bring grief and a memorial
  wall.
- **Family**: couples, pregnancy, births and children who grow up.
- **Recruits**: strangers, refugees, loners and returning deserters.
- **Appearance and customisation**: backgrounds, point-buy, starting gear and low-poly figures holding their weapon
  models.
- **Status icons**, and a "Why?" chain of causes for deaths and setbacks.

### 3. Bases and economy
- **Base tiers**: camp, shelter, outpost and hub.
  - Camps are scouted, set up, struck and upgraded.
  - A camp can stand inside a POI, with rooms to clear and a way out.
- **The base map**: a 500 × 500 grid for each base.
  - Land is cleared and buildings are placed and moved.
  - Terraforming digs hollows and raises hills.
  - Every way in stays open.
- **Buildings and construction**: a construction queue, plots, demolition refunds, fittings, doorways, field works,
  and the step-up buildings (shelter shack, outpost house, main house).
- **Furniture**: beds, storage, comfort and work pieces placed inside buildings.
- **Storage limits** in kg. Whatever does not fit lies outside, where it weathers and is raided first.
- **Work**:
  - A RimWorld-style grid of 1–5 priorities and an hourly scheduler.
  - Idle work and "no idle workers".
  - A watch roster, stewards and leaders, and bulk roster actions.
- **Daily economy and upkeep per head.**
- **Water**: purified and unpurified, wells and filters, and a rule for drinking raw water (Ask, Allow, Never).
- **Food**: shelf life, spoiling, preserving, mealtimes, recipe-based cooking, a kitchen and food poisoning.
- **Land work**:
  - Farming on placed 2 × 2 crop plots, with crop water and greenhouses.
  - Hunting, snares, fishing and foraging.
  - Woodcutting and heating, and gathering stone.
  - Winter's lean months.
  - A land-order box that sets the hours and shows the expected yield.
  - Job trips with crews and trip events.
- **Crafting**:
  - Hand crafts and standing production bills.
  - Tools required by builds and recipes.
  - Electronics recipes, blueprints and manuals.
  - Building materials and metal sheets.
- **Power**:
  - Generators, solar, batteries, breaker panels and fridges.
  - Pumps, fence chargers, a perimeter alarm and electric heaters.
  - Appliances.
  - The governor builds the grid.
- **Breakdowns and repair orders.**
- **Multiple bases**: supply runs, moving people, hauling and convoys, and hidden bases.

### 4. Health and medicine
- **Wounds, infection and passive healing.** Hospital tiers run from infirmary to trauma hospital, with medic
  staffing and bed caps.
- **Illnesses**: contagion, courses of medicine and pneumonia. Camp fever and wound fever outbreaks.
- **The worm**: the infection lore, caught from eggs in soil and water, not from bites.
- **Training medics**, med scarcity by site type, and battlefield medics who drag and stabilise the downed.

### 5. Teams, travel and exploration
- **Expeditions** across the State Map:
  - Supplies drain hour by hour.
  - Event cards roll tile by tile (the dead ahead, wolves, a farmhouse, an overrun convoy).
- **Order queue and trip planner**, with templates and repeat trips. A right-click team menu gives orders.
- **Detached members**: some of a team go off on a job of their own.
- **Teams forming and meeting**, team inventory, and handing over goods.
- **Carry weight and load bands**, carry kit and rigs. Furniture is carried alone or by two, and extracted with.
- **Vehicles**:
  - Fuel, condition, breakdowns and bicycles.
  - Found cars, military trucks, roadblocks and vehicle trade.
  - A lost team's vehicles keep their cargo for a team to recover.
- **On the road**: boat crossings, night marches, tents, campsites and field heat.
- **Discovery**: fog of war, hidden sites, the Sweep mission, rumours and markers with last-seen times.
- **Points of interest**: 0–4 per land tile.
  - A placement table sets what stands where.
  - Shops are franchises with their own looks, and gun, pawn and hardware stores have richer finds.
- **Raiding one POI at a time**: Survey and Quick look first, then a walk of 5–20 minutes to the place.
- **The dead on the land**: dead and raider counts per tile and per POI. They spread out from towns and hives, up
  to each tile's cap and reach. Teams can hunt the dead and read threat estimates.
- **Persistent POI containers**, and abstract scavenging that raises heat. AI groups share the same finite loot.
- **City crawl**: a block-by-block roguelike extraction through multi-storey buildings, with who lives on each
  floor.
- **Crash sites, supply drops, wanderers, optics and lights.**

### 6. Tactical combat (XCOM-style)
- **The core**: turn-based isometric battles.
  - Moves are animated cell by cell.
  - Map sizes depend on the context, with anti-slog endings.
  - Auto-resolve decides fights you don't play.
  - A raid plan before you go in (scout, wait for night, kit, side to enter).
- **Terrain**: high ground, hollows and hills as cover, weather on sight, and vaulting half cover.
- **Stealth and senses**: takedowns, view cones, sneaking, light and darkness, light switches, hearing and
  deafening, ear protection, and unseen shots heard and marked in the fog.
- **Doors and windows**: door kinds, window states, locks, keys, safes, makeshift picks, barricades and shoving.
- **Soft cover**: bushes and tents conceal but don't stop bullets. Tents can be slashed or taken down.
- **Weapons in use**: side-arm and melee slots, non-lethal weapons, throwables (Molotovs, pipe bombs, flares,
  smoke), decoys and fire, car alarms, things on the ground and searching bodies.
- **Other sides**:
  - Raiders and the dead fight each other.
  - A third side of neutrals and soldiers.
  - Parley: truces, trade, recruiting and allying, and orders to allies.
  - Retreat and break-off policies.
- **Siege kit and vehicles in battle**: ladders, rams, grenades, Humvee gunners and ramming gates.
- **Procedural interiors**: homes laid out room by room, and real-size buildings up to 10 storeys with stair runs.
  - Each family has a dozen or so named plans and is picked through one shared variant picker.
  - The families: shops (23 types and franchises), restaurants (86 variants), offices, hotels (48 plans and 8
    shapes), motels, banks, groceries, hospitals and clinics, police, fire stations, schools, churches, military
    bases and airports, bunkers, data centres, malls, amusement parks, stadiums, prisons, college campuses, farms
    and ranches, zoos, golf courses, campgrounds and RV parks, libraries, museums, gyms and bowling alleys, radio
    towers, mines and quarries, warehouses, factories, labs and sawmills.
- **Furniture catalogue**: 248 kinds, with hp, kg, carry class, base use and sprites.
- **Loot that makes sense**: each building type has its signature finds. Signs of survival are set in the scenes.

### 7. Weapons, armour and gear
- **Guns**: many real guns, melee weapons, blades and launchers. Fire modes, jams, suppression,
  over-penetration and a damage ladder.
- **Ammunition**:
  - Rounds are physical stacks in guns and magazines.
  - Ammo goes by calibre and type, and there is a reloading bench.
  - Reload cost depends on where the rounds lie.
- **Attachments and gun builder**, like Tarkov's: sights, muzzles, stocks, factory fits and paint.
- **Armour**: classes 1–6, per-hit durability, helmets and face shields, plate carriers and rigs.
- **Inventory**:
  - RPG slots, pockets, packs and stacks.
  - A right-click item menu.
  - 16 × 16 item icons.
- **Item condition and repair**, electronics salvage, lock boxes and hidden values.
- **Loot distribution** by site theme and gun tables. Team kit loadouts, and the governor buys guns.

### 8. The dead, hives and hordes
- **Hives** build hordes and must be destroyed to win.
  - Hive birth is visible and can be disrupted.
  - A hive tech tree unlocks new dead.
- **Hordes**: guard, build, attack and roam roles. They merge on the State Map.
- **Special dead**:
  - Runners, brutes, spitters, screamers, crawlers, elites, sleepers, soldier dead and dead beasts.
  - Bosses: the Broodmother and the Hivemind.
- **The counter-dead**, bred against your defences, including the Digger and its tunnels.
- **The hive crawl**, chamber by chamber.
- **The dead's pool widens** with the years.
- **Lone workers attacked**, and the Shepherd's aura.

### 9. Base defence and sieges
- **Walls and stands**, sandbags, wire, spike pits and land mines, and what happens when the dead break in.
- **A deploy step**: the wall map, the yard and the fort map.
- **Raids on the base map**: from any side, with containers raided and a locked armory.
- **Defence plans** drilled ahead of time, and the perimeter alarm.
- **Raids on you**, sized to your defence and escalating.

### 10. Other groups, diplomacy and war
- **AI groups**: growth, expansion, raids, convoys and attitude drift.
  - **Full AI parity**: groups heal, build, trip, scavenge, power their bases and pack for the job by your rules.
- **Splinter bands, blocs, diplomacy, wars with you and the Calder Coalition.**
  - Standing, member asks, envoys, volunteers on loan and joint operations.
- **Conquest, occupation and land claims.** Road conflicts, captives, rescue raids, ransom and prisoners.
- **Trade**: barter, routes, caravans and escorts, raiding caravans and meeting to trade.
- **Jobs posted by groups**, outsiders, raider bands and nomads.

### 11. Radio and intel
- **Radio network**: stations, relays, radio deals and trades, coverage layers and towers that a base powers.
- **Listening in**, intel, radio discipline, decoys, captured scouts and estimates of enemy strength.

### 12. Player tools, UI and presentation
- **Autopilot governor**: the AI that runs a base. It is also used headless for balance runs.
- **Save and load**, a codex, a first-week guide, How to play and help.
- **Command palette, minimap, watch list, map notes and threat bar.**
- **Input and layout**:
  - Windows and menus share one chrome.
  - Responsive layout.
  - Touch input and the whole game by gamepad.
  - Key hints worded for each device.
- **Looks**: seasonal trees, snow on roofs, interior decor, rocks and boulders, vehicle models and weather drawn in
  battle.
- **Audio**: an adaptive music director, ambience and SFX.
- **Dev tools**: map reveal, headless test and balance tools, and the merge gate.

---

## Part 2: the one-person Godot MVP (vertical slice)

The rebuild board already defines a slice called "One week in Calder", with 46 cards at priority P0. That is the
right **shape**, but for one person learning Godot it is still a lot. The MVP below is the same loop with every
system cut to its smallest version that still plays.

### The loop the MVP must prove

> Start a run on a small hex map → run a tiny hub with 4 survivors → send a team across the map → raid one building
> in a turn-based fight against the dead → bring the loot home or lose people → survive 7 days → save and load.

If that loop is fun with grey boxes, everything in Part 1 is "more of it". If it isn't, nothing in Part 1 will fix
it.

### Architecture, kept simple

- **Godot 4.x .NET, C#.** One solution with two projects:
  - `Sim`: plain C# with no Godot references, unit-tested with xUnit.
  - The Godot project, which references `Sim`.
  This is the board's architecture, and it is worth keeping even solo: it lets you test rules without clicking
  through the game.
- **The `SimHost` autoload** owns the `World`. It ticks the world from `_Process`, sends player commands into it
  and drains sim events out as Godot signals.
- **Content** is JSON in `content/` (items, buildings, POI types, loot tables, dead types and cards), loaded into C#
  records once at start.
- **Saves** are one JSON file (System.Text.Json) with a `schemaVersion`. All randomness comes from one seeded `Rng`.
- **Art**: Godot's default UI theme, coloured hexes and coloured squares or capsules for units. Look art up by
  string key, so real art drops in later.

### MVP feature list (what's in)

| # | System | MVP version | Prototype modules (the spec) | Board card |
|---|---|---|---|---|
| 1 | Project & architecture | Sim/Godot split, `SimHost`, the xUnit project, Git + LFS | n/a | infra.engine, infra.architecture, infra.testing, infra.vcs |
| 2 | Content & IDs | JSON → C# records with string IDs; a validation test | n/a | data.ids, data.content |
| 3 | World state & RNG | `World`, `Tile`, `Survivor`, `Base`, `Party`, `Battle` classes; one seeded RNG | `world`, `rng` | data.state, data.rng |
| 4 | Save/load | One save slot plus an autosave each day; JSON with `schemaVersion` | `save` | data.save |
| 5 | Clock & speeds | Hour tick and day tick; pause, 1×, 2× and 5×; the clock pauses in battle and on cards | `world`, `cardrules` | core.clock |
| 6 | Events & commands | A sim event queue drained into a log panel; player actions as command objects | n/a | core.events, core.commands |
| 7 | Hex map | **One fixed-size map** (about 40 × 30): 4–5 terrains (plains, forest, hills, water, road), one town, about 15 POIs, seeded | `hex`, `mapgen` | core.hexgrid, core.mapgen |
| 8 | Fog of war | Unseen, seen and in-sight tiles; a team reveals a radius of 2 | `discovery` | travel.fog |
| 9 | Survivors | 4 survivors: name, HP, 3 skills (shooting, melee, scavenging) and 1–2 traits; no XP curve yet | `skills`, `traits` | surv.model |
| 10 | Needs | Hunger and thirst eat from the stockpile daily; rest by the hour; low needs hurt and then kill | `needs` | surv.needs |
| 11 | Health | HP plus a list of wounds (light or serious, healing per day); downed, then dead | `medical` | surv.health |
| 12 | Hub & stockpile | One hub with an **abstract stockpile** (food, water, wood, scrap, ammo, meds, items list); **no base-map grid** | `economy`, `basestorage` | base.core |
| 13 | Buildings | A queue of 4–5 builds: Beds, Rain catcher, Workbench, Storage, Barricade. Each costs wood and scrap and gives a flat bonus | `buildings` | base.buildings |
| 14 | Work | One role each: Forage, Chop wood, Build, Rest, Guard; hourly output | `work` | base.work |
| 15 | Daily economy | Per-head use of food, water and wood, minus production; a shortage warning | `economy`, `upkeep` | econ.daily |
| 16 | Teams & travel | Pick 1–4 survivors and a supply pack; A* on hexes; hours per tile by terrain; supplies drain hourly; return home | `parties` | travel.parties, travel.pathing |
| 17 | POIs & loot | **3 POI types** (house, small store, gas station), each with a loot table; containers remember what was taken | `pois`, `loot`, `poicont` | travel.pois, gear.loot |
| 18 | The dead on the land | A static dead count per tile and per POI (no spread); it sets how many dead are in a battle and how many come as reinforcements | `deadpop` | dead.population |
| 19 | Event cards | About 8 travel cards and about 6 hub cards, each with 2–3 choices; cards pause the game | `events`, `hubevents` | core.cards, travel.events |
| 20 | Items & weapons | A list inventory with a weight limit; 3 guns (pistol, shotgun, rifle), 2 melee weapons, ammo **as a count per calibre**, a medkit and food | `inventory`, `data-guns` | gear.items, gear.weapons |
| 21 | Battle map | **2–3 hand-made maps** in Godot's TileMapLayer (a house, a store, a gas station). A square grid, with walls, half and full cover, doors (open or closed) and containers | `buildingmaps` | combat.map |
| 22 | Turns & actions | 2 action points a unit; move, shoot, melee, reload, search a container, open a door, extract at a map edge | `combat` | combat.turns, combat.actions |
| 23 | Pathing, sight & hit chance | AStarGrid2D; grid line-of-sight; hit chance from skill, distance and cover, shown as a % | `combat` | combat.pathing, combat.los |
| 24 | The dead | Walker (slow, tough) and runner (fast, fragile). A bite only damages, with no infection | `zombietypes` | dead.types |
| 25 | Dead AI | Idle → hear noise (a gunshot has a big radius, melee a small one) → chase → attack; reinforcements drawn from the tile's count | `combat` | combat.ai |
| 26 | Battle results | Loot goes to the team, then to the stockpile when it gets home. Wounds carry over and deaths are permanent. Retreat; auto-resolve with one formula (strength vs dead count) | `combat`, `breakoff` | combat.resolve |
| 27 | Win/lose | Survive 7 days = slice won; everyone dead = run over; an end screen with a summary | `world` | slice.playtest |
| 28 | UI screens | Title, new game (seed only), save and load; State Map (camera, hex select, right-click "Travel / Raid / Return"); hub panel (roster, stock, build queue, roles); team panel; card popup; log; time controls; inventory transfer (two lists); battle HUD (unit card, AP, hit %, action buttons, end turn) | `ui/*` | ui.framework, ui.menus, ui.statemap, ui.hub, ui.team, ui.cards, ui.inventory, ui.battle, ui.input |
| 29 | Dev tools | A debug overlay: reveal the map, add items, kill or heal, jump a day; a headless "simulate 7 days" test | `tools/*` | infra.devtools |

### Cut from the MVP (and why)

| Cut | Why it can wait | Comes back as (board card) |
|---|---|---|
| Base map grid, terraforming, furniture, base tiers, camps | The biggest UI job in the game; an abstract stockpile proves the economy | base.basemap, base.furniture, base.tiers |
| Vehicles, carry bands, tents, crossings | Walking teams are enough for one region | travel.vehicles, travel.carry, travel.road |
| Full world gen (rivers, roads, names, sizes), real weather | A fixed small map gives the same decisions | world.mapgen, world.weather |
| Physical rounds, magazines, attachments, armour classes, item condition | Ammo as a count keeps the scarcity tension at a tenth of the work | gear.ballistics, gear.gunbuilder, gear.armour, gear.condition |
| Procedural interiors and the 30 layout families | Hand-made maps let you tune the fight first; procedural comes once the fight is fun | combat.interiors |
| Stealth cones, light, hearing loss, locks, barricades, throwables, parley | Noise → chase already gives the "don't shoot" tension | combat.stealth, combat.doors, combat.throwables, combat.factions |
| Morale, bonds, family, recruits, disease, the worm | Needs and wounds are enough survival pressure for a week | surv.morale, surv.relations, surv.family, health.* |
| Farming, cooking, water purity, crafting, power, hauling, multiple bases | Flat role outputs prove the economy loop | econ.* |
| Hives, hordes, special dead, sieges, walls | A 7-day slice has no win condition beyond survival. (The board marks dead.hives P0 for the **campaign**, not for the slice.) | dead.*, def.* |
| AI groups, diplomacy, trade, radio | The world is just you and the dead | groups.*, ai.governor |
| Modes, achievements, codex, gamepad, touch, audio, isometric art | Polish after the fun is proven | meta.*, ui.platforms, art.*, audio.all |

**One design shortcut to note**: the MVP battle is **top-down on a square grid**. The prototype uses an isometric
view. Godot's TileMapLayer supports isometric tiles, but sorting, cutaways and picking under iso cost a lot of time
early on. Keep the sim's grid identical, so switching the view to iso later is a presentation change only.

### Build order (milestones, each one playable)

1. **M0, Skeleton.**
   - Build: the solution, `SimHost`, RNG, the JSON content loader, a save round-trip test.
   - Done when: `dotnet test` passes, and Godot shows an empty scene ticking a clock with pause and speed buttons.
2. **M1, The map.**
   - Build: hex math, map gen, State Map view, camera, tile selection, fog, POIs drawn.
   - Done when: you can generate a seeded map and click around it.
3. **M2, The hub.**
   - Build: survivors, needs, stockpile, roles, the build queue, the daily economy, hub cards, the log.
   - Done when: you can leave the game at 5× and watch people starve unless you assign roles.
4. **M3, Travel.**
   - Build: team forming, A* travel, supply drain, travel cards, arriving at a POI, auto-resolve, return home.
   - Done when: a whole raid trip works with auto-resolve only.
5. **M4, The battle.**
   - Build: one hand-made map, turns, AP, move, shoot, melee, reload, search, extract, walkers, the noise and chase
     AI, hit % and cover.
   - Done when: a fight starts from the map and its results go back to the team.
6. **M5, The slice.**
   - Build: 2 more maps, runners, wounds and healing, inventory transfer, 7-day win and loss, save and load
     anywhere, the dev overlay, balancing.
   - Done when: someone else plays a week and wants another one (the board's `slice.playtest` definition of done).

**What comes after the MVP**: follow the board in order. M2 · Living hub (base map, furniture, food, crafting) first,
then the wider world, deep tactics, the dead and defence, other groups, and the campaign and art. The prototype in
`prototype/` stays the spec. For any system, read its line in `docs/agents/features.md`, then the module's header
comment.
