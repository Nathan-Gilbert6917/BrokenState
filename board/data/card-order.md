# Broken State → Godot / Unity rebuild: the card order (board/build.js reads the numbered lines below)

The game: Broken State, a zombie-apocalypse survival strategy sim set in the procedural "State of Calder".
Three layers of play: (1) the hex **State Map** (send teams on expeditions, other AI groups, hordes, hives,
weather, seasons), (2) **bases/hubs** run RimWorld-style (survivors with needs, work priorities, buildings,
food, crafting, power), (3) **XCOM-style turn-based isometric tactical battles** (raids into procedurally
laid-out building interiors, stealth, physical ammo, the dead). The existing browser prototype (JS, ~410 sim
modules, ~208k lines) lives in /home/user/BrokenState/prototype (sim: prototype/src/sim/*.js, UI:
prototype/src/ui/*.js). Feature index: /home/user/BrokenState/docs/agents/features.md. Detail pages:
/home/user/BrokenState/docs/features/<area>.md. ADRs: docs/adr/ (0001 AI parity: AI groups obey the same rules as
the player; 0002 base building). The prototype exists "to test the fun before Unity or Godot".

The user is a NEW game developer learning by doing. Sprites/UI art will be human-made LATE, so all art is
placeholder until milestone M8. The user's preferred order: database (data) first, then backend (sim logic), then UI.

## Shared architecture (every card must assume this, so the board is consistent)
- **Sim = a pure C# .NET class library `BrokenState.Sim`** with NO engine references. It holds the state,
  rules and AI. It is unit-tested headless with `dotnet test` (xUnit). It works under BOTH engines.
- **Godot path**: Godot 4.x (.NET edition, latest stable), C# scripts. The Godot project references the Sim
  project (csproj ProjectReference). A thin "bridge" layer (autoload `SimHost` node) owns the sim, ticks it
  from `_Process`, turns sim events into Godot signals, and turns input into sim commands.
- **Unity path**: Unity 6 LTS. Sim source compiled as its own assembly (asmdef with "No Engine References")
  or a prebuilt DLL in Assets/Plugins. A `SimHost` MonoBehaviour does the same bridge job (C# events / UnityEvents).
- **Static content ("the database")** = JSON files in `content/` (items, terrain, buildings, dead types,
  loot tables, recipes…) loaded into immutable C# record definitions by a `ContentDb`, validated by tests.
  Visuals are looked up by string **art keys** (e.g. "item.pistol_9mm") via an ArtCatalog in the engine
  (Godot Resource / Unity ScriptableObject) so placeholder art swaps for human-made art with zero code change.
- **Runtime state** = plain C# classes (World, Tile, Survivor, Base, Party, Faction, Battle…) referencing each
  other by stable integer/string IDs, never engine objects.
- **Saves** = JSON (System.Text.Json), gzip, `schemaVersion` + migration steps.
- **Determinism**: seeded RNG streams (`Rng` class in sim); never UnityEngine.Random / GD.Randf in sim code.
- **Clock**: the campaign sim advances in game-hours with a daily tick; the UI interpolates minutes.
  A battle is a separate turn-based mode that pauses the campaign clock.
- **Event bus**: sim publishes domain events (e.g. SurvivorDied, PartyArrived, CardRaised) to a queue;
  the bridge drains it each frame. Player actions are **commands** (e.g. SendParty, QueueBuild, MoveUnit).
- Recommended engine for this learner: **Godot 4 .NET** (free, light, great 2D/UI, fast iteration), with Unity 6
  as the fully supported alternative; because the sim is engine-free, the choice stays reversible.

## Vertical slice: "One week in Calder"
A new run on a small generated hex map → one hub base with 4 survivors (needs, health, a few skills) →
assign work and queue 1–2 buildings → daily economy (food, water, wood) → form a team, travel the State Map
(supplies drain, fog of war, a travel event card) → pick a POI → a small turn-based battle in one simple
building against the dead (move/shoot/melee/reload/search containers, LOS & cover, the dead hear and chase) →
extract with loot or retreat/auto-resolve → loot lands in the base stockpile, wounded heal, someone may die →
save, quit, load and keep playing. Event cards and time controls (pause/1×/2×/5×). All art placeholder.

## Lanes (Trello lists) and cards, in build order (the number is the global order)
Each card's tasks are split Data → Backend → UI (placeholder), matching the user's preference.

### L0 Infrastructure (slice)  — agent A
1 infra.engine — Engine choice & project setup (Godot 4 .NET vs Unity 6, solution layout)
2 infra.vcs — Git, Git LFS, branching, .gitignore, issue board
3 infra.architecture — Sim/presentation split, folders, SimHost bridge, services
4 infra.testing — Test harness: xUnit sim tests, golden/determinism tests, engine tests (gdUnit4 / Unity Test Framework)
5 infra.ci — CI: GitHub Actions running dotnet test + engine export builds
6 infra.devtools — Dev console, cheats, debug overlays, headless runner

### L1 Slice · Data (the database layer) — agent A
7 data.ids — Stable IDs, registries & references
8 data.content — Static content definitions (JSON → C# records), ContentDb, validation, art keys
9 data.state — Runtime world-state model
10 data.rng — Seeded RNG streams & determinism
11 data.save — Save/load, versioning & migration

### L2 Slice · Sim core (backend) — agent A
12 core.clock — Game clock, hourly/daily tick scheduler, speeds, pause
13 core.events — Domain event bus & game log
14 core.commands — Player commands (intents) & validation
15 core.hexgrid — Hex grid math (axial/offset coords, neighbours, distance, rings)
16 core.mapgen — Procedural State Map (slice: small map, terrain, a town, POIs)
17 core.weather — Seasons & daily weather (slice: basic)
18 core.cards — Event cards & pacing (decision cards, pause rules, auto-answers)

### L3 Slice · Gameplay (backend)
agent B: 19 surv.model — Survivors: attributes, skills, traits (basic)
agent B: 20 surv.needs — Needs: hunger, thirst, sleep, mood
agent B: 21 surv.health — Wounds, healing, death (basic)
agent B: 22 gear.items — Items, stacks & inventory (slots, weight)
agent B: 23 gear.weapons — Weapons & ammo (basic: a few guns & melee)
agent B: 24 base.core — Base entity & stockpile (supplies, storage)
agent B: 25 base.buildings — Buildings & construction queue (slice: 4–5 buildings)
agent B: 26 base.work — Work assignment & job scheduler (slice: simple roles)
agent B: 27 econ.daily — Daily economy & upkeep (consumption, production)
agent C: 28 travel.parties — Teams & expeditions on the State Map
agent C: 29 travel.pathing — State-map pathfinding (A* on hexes) & travel time
agent C: 30 travel.fog — Discovery & fog of war
agent C: 31 travel.pois — Points of interest & loot pools
agent B: 32 gear.loot — Loot tables & containers
agent C: 33 dead.population — The dead on the land (per-tile counts, spread)
agent C: 34 travel.events — Travel event cards
agent D: 35 combat.map — Battle map grid & generation from a POI (slice: one simple building template)
agent D: 36 combat.turns — Turn order, action points, battle state machine
agent D: 37 combat.pathing — Tactical grid pathfinding & movement costs
agent D: 38 combat.los — Line of sight, cover & hit chance
agent D: 39 combat.actions — Move, shoot, melee, reload, search, extract
agent D: 40 dead.types — The dead: stats & behaviour data (walker, runner)
agent D: 41 combat.ai — Enemy AI (noise, chase, attack) – utility/behaviour approach
agent D: 42 combat.resolve — Battle results → world, and auto-resolve

### L4 Slice · Placeholder UI & presentation — agent F
44 ui.framework — UI framework, theme & window system
45 ui.placeholders — Placeholder art kit & art-swap seams (ArtCatalog)
46 ui.menus — Title, new game, save/load, settings
47 ui.statemap — State Map view (hex rendering, camera, selection, layers)
48 ui.hub — Hub screens (roster, stock, build, work)
49 ui.team — Team forming & map orders (right-click menu)
50 ui.cards — Event cards, log & time controls
51 ui.inventory — Inventory & loot transfer UI
52 ui.battle — Battle view (isometric grid, units, action bar, hit %)
53 ui.input — Input actions (mouse/keyboard, rebindable)
54 slice.playtest — Slice integration, "definition of done" & playtest checklist

### L5 M2 · Living hub — agent H
55 surv.skills — Skills XP, teaching, books, perks, full traits
56 surv.morale — Morale, mental breaks, comforts
57 surv.relations — Relationships, bonds, grief, memorial
58 surv.family — Family, recruits, desertion
59 health.medical — Hospital tiers, medics, training, battlefield medics
60 health.disease — Illness, outbreaks, the worm
61 base.basemap — Base map grid: placement, clearing, terraform, move
62 base.furniture — Furniture, beds, containers
63 base.tiers — Base tiers, camps, tents, the road start
64 econ.food — Food types, spoilage, cooking, meals
65 econ.land — Farming, hunting, foraging, fishing, wood, stone, job trips
66 econ.water — Water: purified, wells, filters
67 econ.crafting — Crafting, production bills, tool requirements, blueprints
68 econ.power — Power grid & appliances
69 econ.hauling — Multiple bases, supply runs, hauling
70 base.repairs — Breakdowns & repairs
71 core.hubevents — Hub events & festival
72 base.workgrid — RimWorld-style work priorities, schedules, idle work, watch roster, stewards

### L6 M3 · Wider world — agent C
73 world.mapgen — Full world gen: rivers, roads, cities, unique names, world sizes
74 world.weather — Full weather: rain waves, fog, ponds, seasonal ground, winter
75 travel.vehicles — Vehicles: fuel, condition, breakdowns, found cars, trade
76 travel.orders — Order queue, trip planner, templates, detached members
77 travel.carry — Carry weight, load bands, carrying furniture
78 travel.scavenge — Abstract scavenging & heat
79 travel.survey — Survey, threat knowledge, markers, rumours
80 travel.road — Night march, crossings, roadblocks, field heat, wanderers
81 travel.citycrawl — City crawl & multi-storey buildings
82 travel.sites — Crash sites, supply drops, campsites

### L7 M4 · Deep tactics & gear — agent E
83 combat.interiors — Procedural building interiors, room layouts & the variant picker
84 combat.stealth — Stealth, vision cones, light & darkness, hearing
85 combat.terrain — Elevation/high ground, weather in battle, soft cover, vaulting
86 combat.doors — Doors, windows, locks, barricades, shoving
87 combat.throwables — Throwables, decoys, fire, car alarms
88 combat.factions — Third side, raiders vs dead, parley, ally orders, retreat
89 combat.medics — Downed state, medics in battle, non-lethal, taking people alive
90 combat.vehicles — Vehicles in battle & siege kit
91 gear.ballistics — Physical rounds, magazines, fire modes, jams, suppression
92 gear.gunbuilder — Attachments & gun builder
93 gear.armour — Armour classes, helmets, rigs
94 gear.condition — Item condition, repair, salvage, valuation, lock boxes

### L8 M5 · The dead & defence — agent I
95 dead.hordes — Hordes on the State Map
96 dead.hives — Hives, hive birth, hive tech tree (the win condition)
97 dead.specials — Special dead, counter-dead, bosses, tunnels
98 dead.hivecrawl — The hive crawl
99 def.walls — Defences: walls, defenses tab, field works
100 def.sieges — Raids & sieges on the base map, deploy, defence plans, alarm

### L9 M6 · Other groups — agent I
101 ai.governor — Autopilot governor (shared decision AI for player autopilot & AI groups)
102 groups.factions — AI groups: growth, expansion, raids, parity
103 groups.diplomacy — Diplomacy, blocs, wars, the Calder Coalition
104 groups.trade — Trade, caravans, meeting to trade
105 groups.radio — Radio network, envoys, intel
106 groups.conflict — Conquest, occupation, prisoners, ransom, rescue
107 groups.nomads — Nomads, visitors, splinter bands, posted jobs

### L10 M7 · Campaign, meta & platforms — agent G (113 by agent F)
108 meta.modes — Game modes (Normal, Hardcore, Crashlanding, Custom) & world config
109 meta.victory — Victories, eras, outbreak pressure, threat forecast
110 meta.history — Achievements, hall of fame, diary, ledger charts, chronicle, timelapse
111 meta.help — Codex, first-week guide, tooltips, "Why?" cause chains
112 meta.qol — Command palette, minimap, watch list, map notes
113 ui.platforms — Gamepad, touch, key hints by device, responsive layout  (agent F)
114 meta.balance — Headless balance runs & telemetry
115 meta.perf — Performance & scaling (big maps, pathing budgets, threads)

### L11 M8 · Human-made art, audio & release — agent G
116 art.direction — Art direction & style guide (for the human artists)
117 art.world — State Map & terrain art
118 art.characters — Survivors, the dead, animation
119 art.props — Buildings, furniture, items, icons
120 art.ui — UI skin, fonts, icons
121 audio.all — Music, ambience & SFX (adaptive)
122 release.ship — Packaging, store page, updates, crash reports
