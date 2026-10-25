# Tactical combat (XCOM-style)

Detail for section 6 of [docs/agents/features.md](../agents/features.md). `[name]` is `prototype/src/sim/name.js`; `ui/name` is `prototype/src/ui/name.js`. (Screenshots removed: the battle-iso and battle-sizes shots are no longer in the repo.)

Contents: [Walking on the battle map](#walking-on-the-battle-map) · [Lost pictures drawn again](#lost-pictures-drawn-again) · [Battle map sizes](#battle-map-sizes) · [A raid without the side panel](#a-raid-without-the-side-panel) · [Before you go in (the raid plan)](#before-you-go-in-the-raid-plan) · [The building picked before the raid map](#the-building-picked-before-the-raid-map) · [Raids into building interiors](#raids-into-building-interiors) · [Vaulting half cover](#vaulting-half-cover) · [Windows and the kinds of door](#windows-and-the-kinds-of-door) · [Raiders and the dead fight each other in a raid](#raiders-and-the-dead-fight-each-other-in-a-raid) · [Barricades](#barricades) · [Shoving people and the dead](#shoving-people-and-the-dead) · [Soft cover: bushes and tents](#soft-cover-bushes-and-tents) · [Taking tents down and slashing them](#taking-tents-down-and-slashing-them) · [Hearing, deafening and ear pro](#hearing-deafening-and-ear-pro) · [Side arm and melee slots](#side-arm-and-melee-slots) · [Car alarms](#car-alarms) · [The ground in a survivor's inventory](#the-ground-in-a-survivors-inventory) · [Talking to other groups in a raid](#talking-to-other-groups-in-a-raid) · [Orders to allies](#orders-to-allies) · [Siege kit](#siege-kit) · [Terrain in combat](#terrain-in-combat) · [Weather in battle: rain, fog and snow](#weather-in-battle-rain-fog-and-snow) · [Retreat](#retreat) · [Vehicles in battle](#vehicles-in-battle) · [Auto-resolve by the numbers](#auto-resolve-by-the-numbers)

## Walking on the battle map
Moves on the battle map are walked cell by cell at each mover's pace, not teleported.
- The user's request 2026-10-21: "add movement animations for battle map currently its like teleportations". Test `tools/moveanimtest.js`.
- Every move is walked cell by cell at the mover's pace: walk 170 ms a cell, dash 115, sneak 240; the dead by kind: shuffle 220, runner 115, brute 240, crawl 280. A long move is quicker: 1.5 s unless that is past 80 ms a cell.
- Easing in and out; the figure faces the step it is on; legs stride and free arms swing (five poses, at most four new ones painted a frame, the standing figure meanwhile) with a little bob.
- A unit's moves in a row (two actions spent moving, an enemy's turn) are walked one after the other. The enemy's next one waits until a walk you saw is 60% done (2 s at most). Footsteps follow the same timing.
- Modules: [ui/moveanim PACE, planOf, moveAt, strideOf; ui/combat stampMoves, moveNow, walkWait; ui/figures figureCanvas o.stride / o.cached; ui/isoview walkFigure; ui/sfx-steps].

## Lost pictures drawn again
Every cached picture is redrawn after the browser loses and restores its GPU context.
- Every kept picture (sprites, figures, the carts' models, the battle's ground, fog, edge, light masks and marks, the map's chunks and shade, the minimap, the clouds, the gun art) is dropped and drawn again when the browser's GPU context is lost and restored.
- The game's canvases report `contextlost` / `contextrestored`; a sentinel picture is read back once a second from the frame loop for a loss the page is not told about. A battle no longer goes on with ringed units and no bodies after a driver reset.
- Modules: [ui/pictures; onForgetPictures in each module (ui/cartmodel too); ui/combat initCombatUI, ui/render initRenderer]; desktop/main.js logs a GPU process gone.

## Battle map sizes
Battle maps are sized by context, from 24×18 up to 48×34, with anti-slog endings.
- Raid maps run between the run's *Raid map, smallest / largest* dials (32×24 to 56×42 as it stands; cities and towns always the largest). Past 40×30 the dead, Heat's rise, a container's find and the ways out scale with the ground; the plan window and the building choice show the size.
- Modules: [battlesize, worldcfg]; `tools/raidshot.cjs` shoots a big raid in the browser.

## A raid without the side panel
A raid on a site uses the whole screen as the map, with a top strip, cards over the map and a log window.
- The user's request 2026-10-18. A raid on a site (`b.raid`) uses the whole screen as the map. Every other battle keeps the side panel. Test `tools/raidscreentest.js`.
- **Top strip**: the place, the turn and the clock, Heat with its bar, the floor shown with ▲ ▼ in a building with storeys, what is carried, ammo and meds, what is left to search, the ways out, the keys, the night; at the right ⚙ Menu, the view's buttons and 📜 Log.
- **Cards over the map**: the choices before you go in, a warning, the hover details, the result (the building to search is picked before the map since 2026-10-25: see below).
- **Log window**: shown or hidden by the Log button or `bview.log`, folded to its title bar, dragged by that bar, resized by its corner; kept per machine.
- Modules: [ui/combat `raidLayout`, `renderRaidTop`, `renderRaidCards`, `renderRaidLog`, `renderRaidLogFoot`; ui/logwindow; main.js renderCombat; styles.css `#combat.noside`, `#cbtop`, `#cbcards`, `#cblogwin`].

## Before you go in (the raid plan)
A raid opens with the plan window: scout, wait for night, kit, the side to go in from, or leave.
- A raid (an assault, a rescue) opens with the plan as a window over the battle screen: the site under fog, nobody of yours placed until you go in [raidplan, ui/raidplan].
- Options: send a scout first (the odds); wait for night; Look at the map first (only once a scout came back unseen: the window put aside, a chip in the strip brings it back); the team's kit (Team inventory, Teams together; the battle made again with the kit as it stands); go in from a side (North / East / South / West places the team and starts the fight; one way in: Go in); or Leave (called off, nobody hurt).
- Every rebuild (the kit window closing, another side, a scout, the night) first puts the rounds in each gun back onto the gun (gunload gunOut, read by mags fillUnit), so nothing loaded is lost or loaded twice [raidplan gunsOut; tools/raidscreentest "The rounds across a rebuild"].

## The building picked before the raid map
When a raid has a street and buildings to go into, a card asks which before the raid map is made; the map never offers them.
- The user's request 2026-10-25: "When raiding a tile and there is a street and buildings you can go to show the options before loading the raid map and not provide the options when you load into the map." Test `tools/buildingpicktest.js`.
- **Before**: a raid with several buildings and none picked (a tile without places that has buildings: open plains' farmhouse and barn, a forest's cabin; the site POI picked with no building) loaded the street map first, with a "Where do you go in?" card over it (combat.js `R.choose`, `chooseBuilding`; ui/combat `chooseHtml`) until anyone acted; picking a building made the battle again inside it.
- **Now**: the scavenge order puts up a card first, no raid map made yet (parties.js the scavenge order → poiraid `buildingPickWanted`, `buildingPickCard`): "Scavenge …: where do you go in?", a choice per building (its size, rooms, what it likely holds, its map in tiles) and the street last (buildingmaps `buildingOptions` through poiraid `raidBuildings`), then Not now (the team waits). The pick (p.poiBuilding, with p.poi when the site POI was picked on the POI card) gives the order again, and the raid map is made for it: inside the building, or the street map. The raid plan (side, scout, night, kit) comes after on that map as before, and its rebuilds keep the building.
- The site POI picked on the POI card with a building (ui/poipick, poiraid `poiPickCard`) goes straight in as before: no second card.
- **The map never offers the buildings**: createRaid no longer sets `R.choose` (a setup with no building at a site with several is the street map); the card over the map, its log line and `chooseBuilding` are gone.
- **AI parity**: the card is for a team driven by hand in the browser. The autopilot (and any team that gets no card) has the building picked before the map by `buildingPickFor`: its own dice by the tile and the hour, the battle AI's pick as it was made on the map before (combat.js autoPlayerTurn). Headless (no map) the hour-by-hour search is as it was.
- Modules: [poiraid `raidBuildings`, `buildingPickWanted`, `buildingPickCard`, `buildingPickFor`, `poiRaidSetup`; parties the scavenge order; scavenge `startScavenge`; combat `createRaid`, `autoPlayerTurn`; ui/combat `renderRaidCards`]. Tests: `tools/buildingpicktest.js`, `tools/interiortest.js` ("A site with several buildings: picked before the map"), `tools/poicontainertest.js`.

## Raids into building interiors
Raids go into generated buildings and neighbourhood streets to search, past locks, keys and safes.
- Procedurally generated buildings, containers and searches; raid loot carried by hand [buildingmaps, search, raidloot]. Raid planning (entry side, scout, wait for night) [raidplan]; locks, keys and safes [locks, gunsafes]. A site's building is picked before the map (see above).
- **Neighbourhood POI**: a street of 3–5 two-storey houses on one map (rows facing a road, yards, fences, parked cars to search; ways out at both ends and the back gardens). Each house's containers are kept apart in the POI's ledger with the one pool falling across them. Headless it is one POI searched a house at a time [buildingmaps `streetMap`, `streetHouses`, `STREET`, `streetIntro`; combat `createRaid` (upper floors' reach from every stairwell); poicont `poiHouses`; scavenge `searchHour` / `afterRaid`].
- **Makeshift picks** (bent wire, `GEAR.makeshiftpick`, a stack of up to 10; `CRAFTS.makeshiftpick` three a scrap at a base or in the field). Test `tools/makeshiftpicktest.js`.
  - Pick without the crowbar, like lockpicks from a lower base, as quiet; one snaps off the stack half the time an attempt.
  - A safe, a steel security door and the gun safes are beyond them. The crowbar's picks are used first.
  - Modules: [locks `MAKESHIFT_PICK`, `picksOf`, `crowbarOf`, `makeshiftPicksOf`, `isMakeshiftPicks`, `makeshiftPickable`, `pickChance`, `wearPicks`, `openOdds` (pick.makeshift / left), `openLock`, `lockedSearchHour`; foundcars (cars), rescueraid `pickOdds` (a cell's lock); ui/locks `lockPanel` "Pick (makeshift)", ui/carpanel].
- **Furniture and appliance catalogue** (issue #8 of the interiors epic #7, the user's request 2026-10-25: "Make the layouts make sense and filled with appliances, furniture and decor that makes it feel lived in. […] I want all reasonable appliances, furniture and some decor to be lootable and taken to your base for use […] some will require two survivors to carry"). Test `tools/furnituretest.js`.
  - One table, `FURNITURE_KINDS` in [data-furniture], keyed by cell kind: the twelve old kinds (their cover, sight, names and shove hit points unchanged) and 49 new ones. Each row: `name`, `cell` { walk, cover, los }, `hp`, `kg`, `carry` (`one`, `two`, `fixed`), `size` [w, h], `loot` (also a container), `tags` (room roles), `use` (the base-use key), `wall` (stands against a wall).
  - Driven from it: combat `CELL` (`furnitureCells`, merged at load), barricade `FURNITURE` (`furnitureHp`: every piece that is not fixed shoves and is battered; sandbags kept), ui/isoview's `FURNITURE` and `FLOORED` sets, the outlines, the joins and the wall-facing turn (`WALL_FURN`), `structureName` tooltips, and the codex's Barricades entry ("What shoves", "Two people", "Never shoved").
  - Rules picked (the issue's numbers were starting points): a "one" piece weighs at most 30 kg, a "two" piece at least 35 kg (`CARRY_KG`). Nothing that holds loot is fixed. Fixed pieces are plumbed in, bolted down or built in, and are never shoved: cell bars, the gun safe, the safe, water heater, boiler, sink, toilet, bathtub, shower, altar, booth, bar counter, bleachers. The gun safe and the safe are not area boxes (their own locks), so they are `loot: false`. The counter stays shoveable, so it is a "two" piece (70 kg), not fixed. The fridge is 60 kg like the Refrigerator item.
  - Uses: `fridge`, `freezer`, `stove`, `oven`, `microwave`, `storage:<kg>`, `comfort:<mood>`, `work:<station>`, `bed:<BED_SPEC kind>` (beds, bunks, hospital beds and gurneys sleep as data-beds' kinds), `none`. Helpers: `useOf`, `furnitureFor(tag, loot)`, `isFurniture`.
  - Sprites: `FURN_DRAW` in ui/isoview (boxes and cylinders, colours in `FURNC` beside `DOORC`), each with its height for `blockTop0`; `furnProbe` exposes them to the test.
  - Showing them: the `furniture` layout in `tools/isobattles.js` (`showroom`: one of every kind at its size), and `node tools/raidshot.cjs <dir> 56 56 furniture` lays the same on a real town raid's map and shoots it close up in two turns of the view (no page errors, 2026-10-25).
  - Not yet: `FURNISH` places what it placed before. Placing the kinds in rooms, picking them up, base use, blood and bodies are the sibling tickets under #7.

| Piece | Kind | Carry | kg | Size | hp | Cover | Container | Base use |
|---|---|---|---|---|---|---|---|---|
| Shelves | `shelf` | one | 25 | 1 × 1 | 25 | half | yes | storage:40 |
| Lockers | `locker` | two | 40 | 1 × 1 | 40 | full, blocks sight | yes | storage:60 |
| Cabinet | `cabinet` | one | 30 | 1 × 1 | 25 | half | yes | storage:40 |
| Counter | `counter` | two | 70 | 1 × 1 | 30 | half | yes | storage:50 |
| Crates | `crate` | one | 20 | 1 × 1 | 20 | half | yes | storage:60 |
| Shelving | `rack` | two | 45 | 1 × 1 | 35 | full, blocks sight | yes | storage:120 |
| Table | `table` | one | 25 | 1 × 1 | 15 | half |  | work:table |
| Bed | `bed` | one | 22 | 1 × 2 | 20 | half |  | bed:bed |
| Cell bars | `bars` | fixed | 120 | 1 × 1 | 60 | half |  | none |
| Hay bales | `hay` | one | 25 | 1 × 1 | 15 | half |  | none |
| Rain barrels | `barrel` | one | 25 | 1 × 1 | 15 | half |  | none |
| Gun safe | `gunsafe` | fixed | 180 | 1 × 1 | 80 | full |  | storage:40 |
| Refrigerator | `fridge` | two | 60 | 1 × 1 | 40 | full, blocks sight | yes | fridge |
| Chest freezer | `freezer` | two | 45 | 2 × 1 | 35 | half | yes | freezer |
| Stove | `stove` | two | 50 | 1 × 1 | 35 | half |  | stove |
| Oven | `oven` | two | 40 | 1 × 1 | 35 | half |  | oven |
| Microwave | `microwave` | one | 15 | 1 × 1 | 10 | half |  | microwave |
| Dishwasher | `dishwasher` | two | 35 | 1 × 1 | 25 | half |  | none |
| Washing machine | `washer` | two | 65 | 1 × 1 | 30 | half |  | none |
| Tumble dryer | `dryer` | two | 35 | 1 × 1 | 30 | half |  | none |
| Water heater | `waterheater` | fixed | 55 | 1 × 1 | 35 | full, blocks sight |  | none |
| Boiler | `boiler` | fixed | 150 | 1 × 1 | 50 | full, blocks sight |  | none |
| Sink | `sink` | fixed | 20 | 1 × 1 | 25 | half |  | none |
| Toilet | `toilet` | fixed | 30 | 1 × 1 | 20 | half |  | none |
| Bathtub | `bathtub` | fixed | 100 | 1 × 2 | 40 | half |  | none |
| Shower stall | `shower` | fixed | 40 | 1 × 1 | 20 | full, blocks sight |  | none |
| Sofa | `sofa` | two | 45 | 2 × 1 | 25 | half |  | comfort:1 |
| Armchair | `armchair` | one | 25 | 1 × 1 | 15 | half |  | comfort:0.5 |
| Chair | `chair` | one | 6 | 1 × 1 | 8 | half |  | comfort:0.1 |
| Desk | `desk` | one | 30 | 2 × 1 | 20 | half | yes | work:desk |
| Filing cabinet | `filing` | one | 30 | 1 × 1 | 30 | half | yes | storage:30 |
| Bookshelf | `bookshelf` | one | 30 | 1 × 1 | 25 | full, blocks sight | yes | storage:30 |
| Wardrobe | `wardrobe` | two | 50 | 1 × 1 | 30 | full, blocks sight | yes | storage:60 |
| Chest of drawers | `dresser` | one | 30 | 1 × 1 | 25 | half | yes | storage:40 |
| Nightstand | `nightstand` | one | 8 | 1 × 1 | 10 | half | yes | storage:10 |
| TV stand | `tvstand` | one | 20 | 1 × 1 | 15 | half | yes | storage:15 |
| Piano | `piano` | two | 230 | 2 × 1 | 50 | full |  | comfort:1 |
| Pew | `pew` | two | 60 | 2 × 1 | 30 | half |  | comfort:0 |
| Altar | `altar` | fixed | 120 | 2 × 1 | 40 | half |  | none |
| Pulpit | `pulpit` | two | 35 | 1 × 1 | 20 | half |  | none |
| Hospital bed | `hospbed` | two | 70 | 1 × 2 | 25 | half |  | bed:bed |
| Gurney | `gurney` | two | 35 | 1 × 2 | 15 | half |  | bed:cot |
| IV stand | `ivstand` | one | 5 | 1 × 1 | 5 | none |  | none |
| Medicine cabinet | `medcab` | one | 20 | 1 × 1 | 20 | half | yes | storage:15 |
| Operating table | `optable` | two | 90 | 1 × 2 | 30 | half |  | work:surgery |
| Vending machine | `vending` | two | 200 | 1 × 1 | 60 | full, blocks sight | yes | storage:60 |
| Checkout | `checkout` | two | 40 | 1 × 1 | 30 | half | yes | storage:20 |
| Display case | `displaycase` | two | 45 | 1 × 1 | 20 | half | yes | storage:30 |
| Cold case | `coldcase` | two | 120 | 1 × 1 | 40 | full, blocks sight | yes | fridge |
| Booth | `booth` | fixed | 80 | 2 × 1 | 30 | half |  | none |
| Bar counter | `barcounter` | fixed | 150 | 1 × 1 | 35 | half |  | none |
| Bar stool | `barstool` | one | 6 | 1 × 1 | 8 | half |  | comfort:0.1 |
| Workbench | `workbench` | two | 60 | 2 × 1 | 35 | half | yes | work:workbench |
| Tool chest | `toolchest` | two | 55 | 1 × 1 | 35 | half | yes | storage:40 |
| Bunk | `bunk` | two | 40 | 1 × 2 | 25 | half |  | bed:bunkbed |
| School desk | `schooldesk` | one | 12 | 1 × 1 | 10 | half | yes | storage:5 |
| Teacher's desk | `teacherdesk` | two | 40 | 2 × 1 | 25 | half | yes | work:desk |
| Bleachers | `bleachers` | fixed | 200 | 2 × 2 | 50 | half |  | none |
| Server rack | `serverrack` | two | 120 | 1 × 1 | 50 | full, blocks sight | yes | none |
| Photocopier | `copier` | two | 80 | 1 × 1 | 30 | half |  | none |
| Safe | `safe` | fixed | 200 | 1 × 1 | 80 | full |  | storage:20 |


## Vaulting half cover
People go over waist-high cells at extra cost and land winded; the dead crawl over instead.
- A person (yours, a human enemy, the third side) goes over a waist-high cell nobody can stand on (a fence, crates, a car, sandbags, a table; not a window, cell bars, a railing or a well) at VAULT.COST tiles more than a step, never ending on it or cutting its corner.
- Lands winded: VAULT.COST tiles less movement for the rest of the turn (`u.vaulted` read by `moveMob`). A scuff heard nearby and VAULT.NOISE on the raid's noise.
- With hands full of a load it costs double and never goes through a closed window; Set over cover leaves the load on the far side. Not while pushing a cart. The dead crawl over it instead, dearer (see Barricades).
- The human AI's field goes over the same cells.
- Modules: [combat VAULT, vaultable, canVault, reachable, distField, moveAlong, moveMob; ui/isoview (the VAULT mark on the path), ui/combat (tooltips), ui/battlehud (the WINDED chip)].

## Windows and the kinds of door
Windows have states (open, locked, broken); doors come in kinds with their own hit points, sight and locks.

Modules: [windows, buildingmaps DOOR_KINDS, combat vaultBreaks / vaultCost / clambers / breakCell / structureName, locks; ui/combat (windowButtons, window and door tooltips, the click on a window), ui/isoview (the SMASH tag), ui/sfx-doors (glass and screen doors, sash, glassBreak), ui/battlebar, ui/codex (Windows, Doors)].
- **Window state** `c.win = { open, lock: none | locked | fixed, known }`, rolled from the map's own dice where windows are placed (`buildingmaps.js assemble`, `combat.js genMap` / `genRaidMap`, `interior.js`).
  - Checking is free; opening or closing is 1 action and quiet (unlocked from either side, locked from indoors only: `insideOf`).
  - Breaking is 1 action and loud (`WINDOW.BREAK`: noise, Heat, `alertNear`). A broken ("smashed") window is half cover like a closed one; nobody stands in it.
  - A move vaults through an open or broken window at the vault's cost and crashes through a closed one (`vaultBreaks`: loud, 1–3 cuts). The dead clamber through an open or broken one (`clambers`). The raid's Climb window is quiet through an open one. A throw passes an open one (`throwBlocks`).
- **Door kinds** (`c.dk`, `DOOR_KINDS`): screen, wood, front, glass, steel, security, roller, cell, barred, gate, vault; placed by archetype (`doorStyleOf`). The kind sets hit points, sight through a closed glass or screen door (`doorSees`, `los`), the lock's difficulty and whether it can be kicked or forced (`locks.js openOdds` by `lock.dk`), the crash of a glass door and its sound (`ui/sfx-doors.js doorKind`). The dead and the human AI prefer doors by hit points on the siege field.

## Raiders and the dead fight each other in a raid
In a raid, raiders and the dead fight each other, and unseen shots are heard and marked in the fog.
- The user's request 2026-10-18. Test `tools/crossfiretest.js`.
- **Contact**: one of the dead next to a raider, or within `CROSS.CONTACT` tiles in sight, goes for them (an unaware one too, without waking to you). A raider with the dead coming within `CROSS.SHOOT` tiles in their cone, or next to them, shoots or strikes back without learning you are there.
- **Their noise draws the dead** while you are unseen: a raider's shot, grenade or flashbang, or a bite or blow on one of theirs, sends unaware dead within earshot (and nearby raiders) to look there instead of waking them to hunt you, as long as no raider is aware of you. The noise still feeds the raid's Heat and the tile's heat.
- **Third-partying**: a bottle or firecrackers thrown next to their group pull the unaware dead there.
- **Heard, not seen**: a shot or blast by anyone not of your side, out of sight and within `CROSS.HEARD` tiles (× the listener's ears, nothing while deaf, a storey counts `FLOOR_DAMP` more), is marked in the fog with sound arcs, a tag (SHOT? AUTO? BLAST? BANG?) and a guess by the sound.
  - A shotgun's boom and automatic fire carry unmistakably; a pistol or rifle only within `CROSS.SURE` tiles, beyond that "a gun of some kind"; a muffled shot is a suppressed gun; a grenade or pipe bomb; a flashbang's crack; a launcher's round.
  - A tile off when far; fades after `CROSS.LINGER` turns. The log says it once a shooter a turn with the direction.
- Modules: [crossfire `CROSS`, `crossFoes`, `crossTurn`, `crossDraw`, `crossHit`, `noteShot`, `noteBlast`, `noteNoise`, `noiseGhosts`, `crossRound`, `shotSound`, `blastSound`; combat `foesOf`, `aiUnit`, `alertNear` (src), `fire`, `suppress`, `strike`, `startPlayerTurn`; throwables `landEffect`, `flashBurst`; ui/combat (the ghosts, the tooltip, the Throw button's text), ui/isoview `drawGhost`].

## Barricades
Shove furniture into place and board up doors and windows; the dead crawl over half cover.

The user's request 2026-10-18. Test `tools/barricadetest.js`.
- **Shove furniture**: a person with free arms shoves a piece right next to them (shelves, a cabinet, a counter, a table, a bed, crates, tall shelving, lockers, barrels, hay, sandbags: `FURNITURE`) one tile for both actions, pushed onto a free open cell beside it or pulled onto their own cell while they step back (`SHOVE`, `shoveTargets`, `shoveDests`, `shoveAct`). A raid's container goes with its piece. A shoved piece gets hit points the dead batter; rubble at 0.
  - A piece goes into a broken or open door's frame too (`isFrame`, `breakPiece`: the frame kept under it, back when it moves or is smashed).
  - Two people shove for 1 action each (`shoveHelpers`, `shovePlan`). A tall piece (lockers, tall shelving) takes two or a Strong back / Melee 6+ (`tallPiece`, `strongEnough`).
- **The dead crawl** over the half cover a person vaults (never a closed window) at `CRAWL.COST` tiles over the step, more than a vault, never stopping on it (`crawls`, `crawlable`, `overCost`; combat `reachable`, `distField`). Tall pieces they batter or go round. A crawl seen gets a CRAWL tag and a log line (combat moveAlong).
- **Boards and nails** (`GEAR.boards`, bulky, 4 kg; `CRAFTS.boards` from 30 wood and a scrap, anywhere; found at hardware stores and farms) are nailed across a closed or barred door, a doorway or a window from either side for both actions (`BOARD`, `boardAct`).
  - The cell becomes `boarded` (a wall for sight and movement, full cover) with `BOARD.HP` a layer up to `BOARD.MAX` on top of a closed door's own. Loud (noise, Heat; the unaware within `BOARD.RADIUS` wake).
  - The dead and the human enemy batter it on the siege field (`breakBoarded`: a boarded window ends broken, a boarded door broken in).
  - Tear down (`tearAct`) gives the door or window back, shut; about half the bundles back (`tearBack`).
  - A bundle in the team's vehicle counts from next to it (`boardsOf`).
- **AI**: the human AI holding a building barricades while nothing is in sight (`aiBarricade`, `kitBoards`: u.boards by kit; combat aiUnit). A group's base you assault starts boarded on your side out of its stock (`preBoardBase`; fort fortAssault).
- **Orders**: Shove (Alt+S), Board up (Alt+B), Tear down (Alt+J) in the Doors & lights tray; the Shove chooser picks where it goes and names the helper.
- Modules: [barricade; combat CELL boarded, reachable, distField, moveAlong, breakCell, structureName, combatAct; windows insideOf; data GEAR.boards; crafting CRAFTS.boards; ui/combat barricadeButtons / shoveChooser / shoveCbAct / shoveClick, ui/battlebar, ui/keymap, ui/isoview (boarded cells drawn as planks), ui/codex "Barricades"].

## Shoving people and the dead
Shove a foe back or floor them for 1 action; the dead may grapple whoever they hit.

The user's request 2026-10-20. Tests `tools/shovetest.js`, `tools/shoveviewtest.js`, `tools/shovebalance.js` (the same fights before this feature and now).
- **Shove foe**: a person with free arms shoves a foe right next to them for 1 action (`PUSH`, `pushTargets`, `pushRefusal`, `pushOdds`, `pushAct`; combatAct "shoveFoe", Shove foe in the Fight tray, Alt+V).
- **Odds** about 65%. Better for a good hand-to-hand fighter (u.meleeAim), a Strong back (u.strongBack), the Bulldozer trait (u.bulldozer: +10/15/20% to land, +15/25/35% to floor; picked only, never rolled: data.js PICK_ONLY_TRAITS keeps every seed's rolls), a target unaware or reeling. Worse on the armoured dead and on a target hunkered down (−`PUSH.HUNKER`) or bracing a door (−`PUSH.BRACE`). Brutes, wall-breakers, brood mothers, dead cows and bosses do not budge.
- **Pushed back** a tile at once (`pushDest`, through combat `moveAlong` with no overwatch at the shoved: u.shoved; traps, mines, fire and acid there do what they do; `pushHazard` names them in the button tip and the target odds).
- **Floored** (`u.floored`): always with no room behind, after a fall off a walkway, roof edge or ladder (`PUSH.FALL` a level), or through a window to the cell beyond (a closed one smashed, loud, `PUSH.GLASS` cuts). The one standing behind may go down too (`pushBlocker`, `PUSH.CHAIN`, friends included).
  - Flat on their back: no overwatch; blows at them +`PUSH.FLOOR_AIM` (combat `meleeOdds`; the melee AI strikes the floored first, combat `aiMelee`). Getting up costs the next turn's first action (`getUpRound`; in their own side's phase, at once).
- **Grapples** (`GRIP`, `gripOf`, `gripHit`, `gripRefusal`): one of the dead that lands a blow may get hold of someone living (`GRIP.CHANCE`; never a beast, a boss, a big one or one that hangs back). Held (HELD tag): cannot move (combat `reachable`, `moveAlong`, the move / extract / retreat / board acts), its bites surer (+`GRIP.AIM`), a retreat's odds fall (`escapeOdds` −`GRIP.ESCAPE`). It lets go when it dies, goes down, is floored or shoved off, or they are moved out of reach.
- **AI of every side** (combat aiUnit): anyone held shoves what holds them (`aiFree`); anyone shoves a foe into a hazard, a fall or a window (`aiPush`); a melee fighter shoves a foe with no room behind and strikes them flat (`aiMeleePush`); anyone running with two foes round them or held shoves one aside (`aiBreakOut`). A gunman never shoves just to make room (it cost the shot: `tools/shovebalance.js`).
- **Animation and sound**: shoved back is an eased stumble (fx move `shove`, ui/combat animTile); floored, the figure topples about its feet the way they fall, then lies with its head that way (fx `topple`, ui/isoview toppleOf). Its own voice, a shoulder thump and scuffing feet, the body hitting the ground (ui/sfx-melee `shove`); a window shoved through crashes as a broken one. Codex "🫸 Shoving".
- Modules: [shoving; combat combatAct, meleeOdds, moveAlong, aiUnit, playerUnit strongBack / bulldozer, hAt; traits TRAIT_TIERS.bulldozer; data TRAITS.bulldozer, PICK_ONLY_TRAITS; ui/combat (button, target mode, odds, animTile), ui/battlebar, ui/keymap, ui/isoview (topple, lying figure, FLAT and HELD tags), ui/sfx-melee, ui/codex, ui/ui help].

## Soft cover: bushes and tents
Bushes and tents conceal whoever is in or next to them but never stop bullets; tents tear and are mended.

The user's picks 2026-10-20: "Bushes hide whoever stands next to them or in them, but don't stop bullets", "Tents are soft cover". Test `tools/softcovertest.js`.
- A bush (the base map's scatter) and a tent (a camp's, any size; driven by the cell kind) are walked into at CONCEAL.MOVE tiles more and are no cover at all (CELL cover 0: no shield, no bipod rest, a shot is not stopped or weakened).
- **Concealment**: whoever stands in one (CONCEAL.IN) or right next to one (CONCEAL.NEXT: a bush on any side, a tent only between them and the viewer) is seen only within a share of the viewer's sight (not at all while sneaking, from more than a tile), noticed by the unaware (people and the dead) at a share of the range, and harder to hit from more than a tile off (a line of the hit breakdown, a note on the odds line, "concealed …" on the target card; the HIDDEN chip on your people).
- A loud shot (this turn and the next) or a light on at night gives them away. Both sides alike: canSee, shotOdds and the AI's scoreCell read the same rules.
- **Tent damage** (TENT_FIGHT.HP a cell): torn by the dead walking through, slashed by an attacker on a camp with no defenders in sight (one action, AI_SLASH of the time) or burned by its Molotov (AI_BURN, the side's throw of the turn; FIRE.fuel tent burns to rubble), torn by a blast. A cell at 0 is a torn tent (CELL torn: hides nobody).
- **Kept between fights**: a camp's tents are tagged with their map item at the start of a fight and their share of hit points kept afterwards (rec.tentHp on its building record, map key b:<id>; an old save's plan.tentHp is dropped on load). The next fight and the Base map view start from it, a wrecked one lying torn; campers mend TENT_FIGHT.MEND a day.
- Modules: [softcover concealAt / concealHidden / concealAim / concealScore / noticeMult / tentAI / tentStep / softSetup / settleTents / mendTents; combat CELL bush / tent / torn, canSee, shotOdds, reachable, distField, moveAlong, fire, suppress, scoreCell, aiUnit, breakCell, createBattle, finishCombat; stealth noticeRange / detectRange; throwables FIRE.fuel; breakdowns breakdownsDaily; ui/battlehud (HIDDEN, the target card), ui/combat (the hover), ui/isoview (the torn tent)].

## Taking tents down and slashing them
Tents on a battle map can be taken down and carried off as a bag, or slashed; the owner loses them.

The user's request 2026-10-20: "take tents down in raids and steal them". Test `tools/campsitetest.js`.
- Every tent on a battle map is on the battle's list (b.tents: whose camp, its owner, its bag, its container; tentfight.js addTent: your base's via softcover softSetup; an AI camp's via conquest; a band's or a campsite's via campsite.js; unregistered runs found by their cells).
- **Take down** (Alt+T, the Doors & lights tray): both actions a go, TENT_TAKE.GOES (makeshift 1, one- and two-person 2, four-person 3; two people share it). Then its cells are open ground and it is the bag in the arms of whoever finished it (on the ground when the hands are full).
  - A torn one is a damaged bag (item.tentHp: pitched again it stands worn); one at 20% or less or burned gives only scrap and tent canvas (GEAR canvas); a makeshift one 20 wood and a scrap.
  - What was stored in it stays as a container to search. A little noise and Heat.
- **Slash** (Alt+X): one action, softcover's SLASH numbers.
- **The owner loses it** at the fight's end (settleTentsDown): your base's record struck (beds and storage with it), an AI group's or band's bag off its shelf, a campsite's tent gone.
- **AI parity**: an attacker on your camp with no defenders in sight takes a tent down TENT_TAKE.AI_TAKE (30%) of the time (tentAI, the slash's priority, kept on once begun) and makes off with the bag (theirs if they get away or hold the field, back in your stores if they fall). A camp's own people never slash or burn their own tents.
- Modules: [tentfight, softcover tentAI, data-tents TENT_TAKE, tents pitchTentAtBase / strikeTentAtBase; ui/combat tentButtons, ui/battlebar, ui/keymap].

## Hearing, deafening and ear pro
Loud fights deafen; ear protection works only in the Ear pro slot.
- [hearing]. Ear protection: foam earplugs, muffs, electronic defenders and the team headset [data-helmets, helmets `earGearOf`]; makeshift rag earplugs crafted from a scrap (weaker than foam, under any helmet, a pair a fight) [data `ragplugs`, crafting `CRAFTS.ragplugs`, hearing `isPlugsKey` / `settleEars`].
- **Ear pro slot** (the user's request 2026-10-21: "add ear pro slot to put ear plugs and such to prevent deaf. this is now the way to have ear protection work"): an equip slot (`s.gear.ears`, SLOT_NAMES "Ear pro"), the only place ear protection works.
  - Plugs (GEAR `plugs`) under any helmet; muffs and headsets not under a full-shell helmet (`earSlotReason`). In a pocket, the pack or on the head: nothing.
  - Helmets lost their ear mount. An old save's muffs on the head or helmet, or plugs carried, move into the slot (inventory `INV_VERSION` 3, `earsToSlot`).
  - The governor, Equip best and the groups' deal fill it (equip `EQUIP_ORDER` ears, bulk); bodies drop it there (helmets `earsOnBody`); the start-gear editor has it.
- Modules: [helmets `isPlugs`, `earSlotReason`, `earGearOf`; inventory fitReason / stow; loadouts wearEars; startgear `START_GEAR.SLOTS`; ui/inventory doll, ui/startgear, ui/codex "k:holsters"]; tests `tools/holstertest.js`, `tools/heartest.js`.

## Side arm and melee slots
A holstered handgun or belt blade is drawn for 1 action, by every side alike.
- The user's request 2026-10-21: "add a melee slot and side arm slot so a survivor can swap to a small melee weapon if they run out of ammo and can be used instead of a gun to attack adjacent tiles. it takes an action to swap … side arm can only fit small guns not long guns. Ai groups can do the same". Test `tools/holstertest.js`.
- `s.gear.sidearm` takes a handgun (GEAR cat pistol); `s.gear.melee` a one-handed melee weapon up to `BELT_KG` (1 kg: a knife, a hatchet, a machete, a bat). A handgun or blade picked up with the hands full goes onto the belt (inventory stow).
- **In a fight**: Draw side arm (Alt+P), Draw melee (Alt+M), Main weapon (Alt+R), each `DRAW_AP` (1 action) (combatAct "draw", `drawAct`, `drawRefusal`). The holstered weapon goes into the hands; what was held goes back in its own holster or slung (`s.gear.slung`, shown under the hands while it holds something).
  - The unit is refit (refitKit: the gun put away keeps its rounds; the one drawn comes loaded from the rounds they carry: gunload gunIn / startGun for any person). A drawn blade strikes adjacent foes with its own damage (Melee).
  - Everyone's slung weapon is back in the hands when the fight ends (holsters `holsterAll`, combat wearFielded).
- **AI of every side** (`drawChoice`, `aiDraw` in aiUnit for anyone else's people, `botDraw` for your battle AI and the raid bot): dry with no Reload → the blade with a foe next to them, else the side arm while it has rounds (`gunRoundsOn`), else the blade; bare hands or a blade with nobody next to them → a gun with rounds back.
- The governor, Equip best and AI groups' deal hand out a side arm and a blade from what is left after the hands (equip `EQUIP_ORDER`, `inSlot`; bulk).
- Modules: [holsters, combat, inventory, equip, bulk, gunload; ui/combat holsterButtons / DRAW_V, ui/battlebar, ui/keymap, ui/inventory doll SLOT_HINT, ui/soundcues (fx "draw"), ui/codex "k:holsters"].

## Car alarms
An armed car's alarm lures the dead; set one off by hand or a thrown object, or by accident when breaking in.
- The user's request 2026-10-23: "Be able to set off car alarms to attract zombies to the alarm and away from you. Be able to set them off from afar as well by throwing something through the window. Add chance of alarm set off when smashing the window to try to loot a locked car or to hotwire it." Test `tools/caralarmtest.js`.
- **Which cars**: a civilian sedan, van or pickup, 50 / 45 / 40% of them, only with a live battery (about one car in five overall); never a burnt-out box truck or an Army vehicle. A group's motor-pool car by the same share. An armed one blinks a red light on the dash: the car panel says so from next to it; the AI sees it within 8 tiles with eyes on the car.
- **Ringing**: a lure at the car's middle (radius 16, noise, a decoy) for 8 enemy turns. The unaware (people and the dead that hear noise) go to look; the dead already after someone walk to it unless someone they are after is within 2.5 tiles; a Shepherd's pack hears nothing. Raid Heat +10 at once, +1 each turn it rings. Then it rings out for good.
- **Set it off** (1 action, from next to the car, sure): whoever does it is next to the noise, so walk away. **Silence it** (1 action, inside the car): pull the fuse.
- **From afar**: something without fx thrown onto a car may break a window (a bottle 60%, an empty magazine 40%, an alarm clock 45%, a radio 40%, a noise maker 30%…); the glass is heard 8 tiles off, the doors open by reaching in, and an armed alarm goes off. A pipe bomb, frag or flashbang within 3 tiles sets off an armed one. Army glass and burnt-out shells do not break.
- **By accident**: breaking the glass to get in 40% a try (the car panel or a locked car's raid box in the lock panel), prying the door with a crowbar 25%, each hotwire try 20%; picking the lock never. Searching a car in a wreck pile or on the road sets off an armed one at about the old overall rate (15% of all cars); Quiet Hands never does.
- **AI parity** (ADR 0001): every side's people, with no decoy to throw while the dead press, throw a bottle or an empty magazine at an armed car they see the light of, 5+ tiles from their own people, that 3+ of the pressing dead would hear.
- **On screen**: the car panel's alarm line, Set off / Silence buttons and the alarm odds on the glass, crowbar and hotwire buttons; the throw preview over a car ("Through the window: X%…"); a ringing car blinks orange and white with a pulsing ring and an ALARM · N tag (a glow at night); a synth siren loop at the car (two at most), a chirp when it starts and a click when it stops.
- Modules: [caralarms `ALARM`, `fitAlarm`, `soundAlarm`, `alarmTurn`, `silenceAlarm`, `tripAlarm`, `throwAtCar`, `alarmsNear`, `ringingCars`, `ledSeen`, `alarmThrowSpot`; foundcars carRecord / carOptions / carAct ops `alarm`, `silence`; stealth throwAt / stealthTurn / pull; decoys stimuli / botDecoy; locks openLock; combat searchBox; siege overlay; ui/carpanel `carThrowPreview`, ui/combat, ui/isoview, ui/battlelights, ui/sfx-vehicles `carAlarm`, ui/sfx-gear].

## The ground in a survivor's inventory
The ground's piles show in a survivor's inventory window, in a fight and on the State Map.
- The user's report 2026-10-20. The fight's Inventory window (🎒, Shift+B) lists the piles on and next to them beside a Carried list; things are dragged or clicked between them and the person as in the Ground window (picking up is hauling time, putting down free; look only with no action left).
- On the State Map a team member's inventory (and the team inventory) has an On the ground here box for the tile's ground: a thing onto a slot or pocket is picked up onto them; a cart (or a bag onto In arms) into their arms; supplies into the pool; a thing of theirs dropped on it goes down.
- Modules: [ui/inventory fightGround, groundBox; carry groundToPerson].

## Talking to other groups in a raid
Call out to other human groups in a raid: a truce, trade, recruits or fighting together; some are treacherous.

The user's request 2026-10-20. Modules: [parley, thirdside thirdPlan thirdFoes thirdSideHit, combat callout detect notice damage autoRaidTurn RAID_HEAT, buildingmaps placeInterior, scavenge raidEnemies afterRaid, citycrawl enterPlace afterPlace, wanderers talkChance, ui/combat, ui/isoview].

- **Groups on the map**: every human group on a raid's map (a third side, a hostile group's pod) has a record with a hostility on a range (an AI group's goodwill and type, a wanderer group's mood, raiders and squatters by kit) and a stance by it (friendly, neutral, hostile). Some hostile groups are treacherous and show as friendly.
- An AI group's scavenging party may be on the site (a real one searching there, else by hash dice a group with a base near; never where wanderers are): friendly and neutral as a third side, hostile as an enemy pod, their own people. A city crawl's place can hold several groups at once (an AI group's party, survivors, a raider crew).
- **Calling out**: a group that first sees your people may call out (a battle card with what they said; a hostile pod that calls holds fire in a standoff until answered). Call out (1 action, sight of one of theirs needed, a shout the dead hear) opens the card to any group.
- **Choices**, each with odds by the speaker's Speech and the group's hostility:
  - hold your fire (a truce); let's both walk away (on their ground a few turns to be out of sight; a party leaves the map);
  - trade (the trade window once out, a swap with a group that has none); join us (the recruit card after); what do you know (the dead and others marked, the places to search);
  - hand over what you found; attack them (they do not react until their turn);
  - fight with us (allied for the battle: they fight the dead and hostile groups beside you, never you; the hostile go after them).
- **Allies**: what an allied group does beside you counts: better odds when you ask them to join (this battle and later), their group's goodwill after. An ally that fought beside you can be offered a share of the haul (Split what we found: a third; counts as fighting together, remembered) and asks for it when one of yours gets out; leaving with the haul and sharing nothing costs a little goodwill.
- **Speakers**: the card names who speaks (the caller, or the best talker who sees them); another of yours can take over. A speaker who sees through a treacherous group's lie gets a warning; in a truce such a group edges closer (a tell).
- **Breaking the peace**: a truce your people break ends all talk with that group for the battle, and the group holds a grudge for a month (more hostile, harder to talk round). Your people hitting one of theirs flips the group (a broken truce costs more goodwill than an attack). A treacherous group springs its trap a few turns in or when your people come close.
- **Shout stakes** by how crowded the place is (city or countryside, a crawl's block, the dead in it): further and more Heat in a dense city, enough to tip Heat a stage and bring a wave; the Call out button and card say what it costs (shoutCost). A hostile group's own call carries too.
- A group Hostile toward you by the time you are out trades by a swap, never its trade window.
- Each group keeps the name the raid gave it; two with one name are told apart (where they hold, or a number).
- **UI**: a badge over each of their people (Hostile, Unaware, Standoff, Truce, Peaceful, Leaving, Allied); a chip per group seen on the raid's strip.
- **Raid bot** answers the cards and calls out on its own (the best talker who sees them, once a group: a group not hostile and aware, or an unaware hostile pod that outnumbers the squad, weighed by the odds and the shout's risk).

## Orders to allies
Give an allied survivor an order for 1 action; they may ignore it.

The user's request 2026-10-21. Modules: [allyorders, thirdside thirdFoes, parley parleyEnd parleyResult parleyGoodwill, combat allyorder aiUnit endPlayerTurn evac checkEnd autoRaidTurn, ui/combat, ui/isoview, ui/battlebar].
- One of your people may give an allied survivor (Fight with us) within 5 tiles on the same floor an order for 1 action, to one ally or its whole group within range:
  - attack a target your side sees; move to any cell (the fog too: the nearest cell they can reach); push to a cell and fight what is there;
  - overwatch a cone (kept through the enemy's turn); hold; follow; cover (what threatens the giver first);
  - tell me what you see (a snapshot of their view cone: the dead, people, containers, bodies, doors, windows, vehicles marked "?" in your fog, not updated, dropped once your people see the cell; the fog itself not revealed);
  - retreat (off the map by an extraction zone or the edge, out alive); own call.
- They may ignore it: odds by the giver's Leadership (Speech a little), the group's fought-together credit, its hostility, the order's danger and their health. A treacherous group agrees and does what it wants.
- Evac, the raid bot leaving and your extraction tell every ally to retreat. Their people who die under your orders cost a little goodwill after.

## Siege kit
Ladders, rams and frag grenades for assaults; groups and raiders bring only their own.
- Ladders, rams and frag grenades [siege]. A group's raid brings only its own (its ladders and ram on its books, made by your recipe when it has none; grenades carried by the raiders) [arsenal packRaidKit, siegeGearHome].
- Raiders from beyond the border bring the ladders and ram they set out with, items in their gear carried by the carry rule, made more of by a group's crafting when they have the means (your bench), home with the living after the raid, else in your yard or on the ground [siege bandSetOutKit; visitors bandKit, makeSiegeGear, siegeGearBack, dropBandGoods; arsenal bandMakes].
- (Screenshots removed: the siege shots are no longer in the repo.)

## Terrain in combat
Height changes aim, cover and sight in a fight, and the AI paths and stands by the land.
- The user's request 2026-10-23: "improve high ground accuracy and sight range, low ground inaccuracy and can't see beyond the first tiles around a hollow. High ground acts as half cover if one layer high and can see the survivor and full cover if two layers high. You can use hills to see into upper floors of buildings if any are in range with a window. Update AI pathing".
- Aim and cover by height (combat HEIGHT): shooting down +5 a level to MAX_AIM 15; shooting up −5 a level to MAX_UPHILL −15 (UPHILL); a target a level up has half cover (COVER), two or more full (FULL_UP 2; full cover is −40 aim, the target stays visible); no height cover from an adjacent shooter. Rows "High ground", "Uphill", "Half cover: hill" / "Full cover: hill" in the breakdown (shotOdds, coverAgainst `rise`/`high`; ui/battlehud, ui/combat, ui/isoview). The uphill and full-cover rules apply to every height (walkways, roofs, towers).
- Sight +2 tiles a level (−2 in a hollow). A unit in a hollow sees the hollow and the first ring round its rim, nothing beyond, both ways (highground hollowShut, in los, cached per map revision).
- From a ground-floor hill at least as high as a floor, a unit in sight range sees and shoots into that upper floor through a window on the facing wall; inside, walls, slab and roof block (highground windowSees, crossLos, windowFoes, windowSeen, floorCover, standH, shootable; combat canSee, playerSees, sideSees, aiUnit, fire). Overwatch, noticing and the upper floor's fog do not cross floors; only the isometric view clicks an upstairs enemy.
- AI pathing: distField costs ground steps through climbCost (with the weather's climbX), so the dead go round a tall hill and people over it when cheaper, never through crag; anyone with a gun scores hills +2 a level and hollows −6 a level (highground terrainScore, TERRAIN_AI; combat scoreCell). `tools/terraincombattest.js`, `tools/defencetest.js`, `tools/terrainshot.cjs`.

## Weather in battle: rain, fog and snow
The State Map's weather over the fight's tile is drawn over the battle; fog and blizzards cut every side's sight.
- The user's request 2026-10-23: "Add rain and fog effect during raid … when it is foggy or raining in the world map that is when it is foggy or raining in a raid. Fog reduces visibility on the world map too" (the State Map's own rain, fog and sight are ui/render, ui/wxmap; this is the battle's side).
- The battle's weather is the State Map's over its tile as the battle is made: weather.js weatherAt(state, b.tileId), kept as `b.wx` (wxsight battleWxKey; "clear" with no tile, and under the ground in a hive's caves). No dice: the same seed and hour, the same weather. Every battle counts: raids (createRaid), fights in the open, a base's defence.
- Sight [wxsight WX_SIGHT, WX_SIGHT_MIN, wxSightSetup, fogEyes]: fog cuts everyone's day sight (`u.daySight`) by WX_SIGHT.fog = 4 tiles, a blizzard by WX_SIGHT.blizzard = 3, never below WX_SIGHT_MIN = 4 (a person 13 → 9, the dead 9 → 5); `b.wxSight` the cut, `u.fogCut` what came off a unit (once). The night's caps come on top as before (stealth senses, ailights, vision: sight = min(day sight, the dark's reach)). AI parity (docs/adr/0001): every unit on every side alike, your people, raiders, the third side, volunteers and the dead; hooks in stealth.js stealthSetup (as the battle is made) and stealthTurn (anyone who came onto the map since, before the night's cap). Rain and snow cut nothing.
- Words: the battle log's first lines ("Fog over the fight: everyone on the map, on every side and the dead too, sees 4 tiles less (Fog: sight −4)"), and the hover card over one of your people: "sees N tiles (Fog: sight −4)" (ui/combat; wxSightWord).
- The overlay [ui/battlewx drawBattleWx, wxFxFor, WX_FX]: drawn by ui/isoview drawIso after the scene, the night's darkness and the edge vignette, before the labels, bars and cursor; screen space on the battle canvas (takes no clicks). Rain: slanted streaks in two layers (near longer and brighter), splash rings on the ground, a cold grey wash; a storm heavier (WX_FX.RAIN 240 / STORM 400 drops at full, scaled by weatherAt rain) and blown further over by the wind. Fog: a wash, a radial veil thick at the screen's edges and 14 soft banks (one puff picture painted per colour) drifting with the wind and a little with the camera, thin in the middle and thick at the edges; by night in the night fog's colour (battleedge fogColour) and ×1.15 thicker. Snow: 200 flakes swaying down; a blizzard 380 blown sideways in a white fog. Bounded fixed particle tables (typed arrays, 512 at most), nothing allocated per frame but one projected point; the battle frame is drawn every animation frame (main.js → ui/combat drawCombat), so it moves.
- Display → Battle weather (ui/displayopts battleWx; ui/display setWxLevel): Full; Light (half the drops and flakes, no splashes, half the fog banks); Off (nothing drawn; fog and a blizzard still cut sight). Reduce motion holds it still.
- Rain over a raid is the world tile's own rain (the user's request 2026-10-23: "Make sure Rain in a raid depends on if the world tile is raining"): the rain now comes in belts that move over the map (weather.js WAVE), so a raid on a tile under a belt rains, a raid on a dry tile the same hour does not, and the same tile once the belt has passed is dry again. The world clock stands still in a battle (main.js), so the raid keeps the hour's weather.
- A battle made with no tile of its own (the base map view, a base's wall map: sim/basemap.js openBaseMap) takes its base's tile (wxsight battleTile, also used by ui/battlewx wxFxFor and ui/battleedge battleWeather): its rain, fog and snow are the base's, and fog over a base cuts sight in a fight at its walls too.
- Test `tools/battlewxtest.js`: a raid on a raining tile rains and one on a dry tile the same hour does not, nor the first once the belt has gone; the base map view rains with its base's tile; the cut for both sides (a fight with raiders, with the dead, a raid) in fog and none in clear weather or rain, the log and hover words, the same seed the same sight, a newcomer cut once at the turn, the floor; the overlay's pick by the weather (rain, storm, fog, snow, blizzard, none), its counts at Full, Light and Off, bounded on a 4K screen, the puff painted once, held still under Reduce motion, and a foggy raid drawn through drawCombat on stub canvases.

## Retreat
"Sound the retreat" in a tactical battle, and break-off policies for fights resolved by the numbers.
- **Sound the retreat** (combat `soundRetreat`): every unit still standing tries to get out now (escapeOdds), carrying the downed next to them; the battle ends as a retreat (a defeat if nobody got out). The AI can give the order too.
- **Break-off policies** [breakoff]: a fight by the numbers plays out in rounds, and the team's "Retreat if it goes badly" policy (never, most, losing, blood) decides whether it breaks off after the first two rounds.
- Modules: [combat soundRetreat, breakoff].

## Vehicles in battle
Humvee gunners and ramming gates in a battle.
- Modules: [combat raidCarTurn (a raid's enemy vehicle driven on its turn)].

## Auto-resolve by the numbers
A fight nobody plays on the map is decided by the numbers (the Auto-resolve button, headless tools, the autopilot and crews).
- Modules: [combat autoResolveCombat; breakoff for breaking off].
