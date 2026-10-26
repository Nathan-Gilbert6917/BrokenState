# Base defence and sieges

Detail for section 9 of [docs/agents/features.md](../agents/features.md). `[name]` is `prototype/src/sim/name.js`; `ui/name` is `prototype/src/ui/name.js`. Screenshots: [docs/base-defence/](../base-defence/) (the siege shots and their report are removed).

Contents: [Defenses tab](#defenses-tab) · [Raids on the base map](#raids-on-the-base-map) · [Perimeter alarm](#perimeter-alarm)

## Defenses tab
Construction's Defenses list: defenses open by base size, from barricades and wire at a camp to the minefield at the main hub.

The user's requests 2026-10-19. Modules: [buildings, defences, wire, fort, interior, deploy, combat moveAlong / "cutwire"; ui/ui baseConstruction defensesPane / wallCard (the pieces), ui/defence builtDefenses, ui/combat barricadeButtons "cutwire", ui/battlebar]; test `tools/defensestest.js`.

- Construction has a Buildings and a Defenses list. Every base builds the first defenses and more open as it grows (camp → shelter → outpost → main hub: BUILDINGS `tab: "defenses"`, `size`, DEF_SIZE, placeProblem "Opens at …").
- No base has a wall it did not build (baseWalls: the old free hub 3 / outpost 1 is gone).

### Defenses by size
- Camp: barricades, spike pits, a barbed wire fence, a trench, sandbags.
- Shelter: sandbag positions, the watchtower.
- Outpost: concertina wire, the reinforced gate, floodlights, camouflage.
- Main hub: guard towers, the **minefield**.
- On the wall-line map (`deploy.js`) the guard towers stand on the walkway at `GUARD_ROWS` (3 rows above and 2 below the wall's middle row, either side of the gate); breaches are not cut in those rows when the base has guard towers (2026-10-25: a breach there left a built tower off the map, `tools/defensestest.js`).
- Hold limit DEFENCE.WIRE / RAZOR / BAGS / TOWERS / TRENCH2; raid tiers TIERS.WALL / YARD.
- **Trenches**: up to two lines (the second needs the Army Engineering Manual). The dead that drop in lose their turn; the living only the rest of the move (combat moveAlong).
- **On the battle map** every defense built stands when the base is raided or a horde breaks in: rings of wire and trench round the fort map's wall with gaps at the gates and the attackers starting beyond them (fort buildFort `wireOut`); lines in front of the yard without a wall (interior layInterior); columns in front of the wall line (deploy deployMap); sandbag cells; two more towers.

### Walls are pieces
- The user's request 2026-10-19: "placeable 1x1, 1x2, 1x4 walls that you can place and rotate", "gates as a 1 x 4 placement", "wall stands that survivors can climb up to so they can see over walls". Test `tools/wallpiecestest.js`.
- 1×1, 1×2 and 1×4 walls and a 1×4 gate, each of a material picked on the walls card: Wood at a camp → Logs at a shelter → Scrap metal at an outpost → Metal sheets at the main hub (Mechanics 3). Each material has its own cost a piece, hit points a cell and wall strength.
- **Wall stands** 1×1, 1×2, 1×4: platforms a level up with their own ladder (combat CELL.stand) from which people see and shoot over the wall.
- Queued, a piece opens the base map to be placed and turned (R). One not placed is laid by the game round the ring (basemap ringHalf: pegged at the yard's edge when the first piece goes up; Widen the ring moves it out), gates in the middle of its sides, stands just inside.
- **Walled** only when the pieces (and houses) close round it (basemap wallInfo: a flood from the map's edge; a broken piece is a gap). Then the wall strength is its materials', the fight starts at the wall with attackers outside. Otherwise nothing by the numbers and the fight starts in the yard.
- **The Ring wall** (BUILDINGS walls, canBuildWall, queueBuild "walls" kind ring / upgrade) queues every piece to close the ring (ringPlan), or raises every piece to a better material, and gathers its materials as they come in (leaving the wood the heating needs). The governor uses it in the best material its stores cover. See also [bases.md, Ring wall](bases.md#ring-wall-and-pinned-builds).
- A group's wall stays one building of a tier (their works). One taken over (conquest, occupy) or an old save's (migrateWalls) becomes a ring of pieces (addRing).
- Modules: [buildings piece / pieceCost / addRing / hasWall, basemap ringPlan / wallInfo / widenRing / buildBaseMap, fort faceOf breaches and posts, breakdowns FIXTURES wall1…stand4, ui/ui wallCard, ui/isoview stand and the materials' looks].

### Repairing the wall
- An order, not a repair each nor the builders' daily upkeep. The user's request 2026-10-19: "a builder can be given an order to repair the wall which takes x hours per wall segment".
- One person (base.wallRepair; the Repairs tab's wall row, a broken piece's card, the governor) mends every broken or worn piece, broken first, 08:00–20:00.
- Each segment WALL_REPAIR.HOURS work-hours for a 1×4 of its material: wood 1, logs 1.5, scrap 2, sheets 3; a 1×2 half, a 1×1 a quarter, a gate half again. Faster with Mechanics; pays half its build cost as it starts it.
- A captured base's holders mend theirs at the same hours a segment.
- Modules: [breakdowns wallRepairPlan / orderWallRepair / wallRepairHour, conquest conquestDaily, ui/explore wallRowHtml].

### Sandbags
- The user's request 2026-10-21: "sandbags as a defense build, half cover, when next to each other the sprites meld together to make a wall". Test `tools/sandbagstest.js`.
- A 1×1 piece on the Defenses tab from a camp (buildings sandbag1: 1 scrap and 1 work-hour a cell, the sacks the material and the filling the work; max a camp 40, a shelter 60, a base 120).
- Placed by hand (a click keeps the type picked, so a row goes down click by click) or, queued from Construction, laid by the game on from the end of a row (basemap FOOT sandbag1, defSpots).
- Half cover (combat CELL sandbag): vaulted by people, crawled over by the dead, smashed by brutes.
- Side by side the sprites join into one wall: straight, round corners, T and cross, bags laid like bricks with no outline across the joins (ui/isoview prims "sandbag", sprite).
- By the numbers +0.5% in the yard each, the first 16 (defences TIERS.YARD.sandbags).
- One smashed or shoved off its cell is burst (MAP_WEAR.sandbag: broken, no cell on the next map, refilled as a repair: breakdowns FIXTURES sandbag1).

### Barbed wire
- Snags the living (the rest of their turn and a few cuts) unless they carry a cutter (a multitool, a field repair kit, a fire axe, a hatchet, a machete; raiders by kit), which cuts through.
- Cut wire clears a cell next to one of yours for 1 action. Razor wire cuts the dead too.

### Spike pits hurt raiders too
- Anyone not of yours who walks into one is hurt (combat SPIKES.LIVING) and stops in the pit. The dead are impaled and blunder on. Your own people walk round them.
- A raid meets the pits standing (only a horde uses them up). A raid by the numbers loses a raider half the time a pit (defences pitsOnRaid).

### Land mines
- A Minefield: main hub only, Mechanics 4, 12 mines a field, up to two.
- By the numbers: a horde sets some off on the way in (2 of the dead a mine); a raid 2 (a raider or two killed). While mines are left the wall tier counts more.
- On the battle map the mines left are hidden in the approach (the fort map's margin off the gate lanes, the attackers starting beyond; the yard's approach without a wall; none on a bridge deck), drawn for you only. Anyone not of yours who steps on one sets it off (a pipe bomb's blast); yours step round them.
- The base keeps what did not go off; an empty field is cleared away.
- Modules: [mines minesKill / spendMines / layMines / mineStep / settleMines / raidMines; combat moveAlong, closeCombat; ui/isoview, ui/combat hover].

## Raids on the base map
A raid on your base is fought on its own map, with its stores as containers to steal from.
- The dead and raiders nearby attack every camp and base by the tile's pools, its noise and the base's own Heat (campattack, issue #69): a camp gets the card and the base defence battle, a base whose defences hold cuts a small wave down at the walls. [bases.md](bases.md#attacks-on-a-camp-by-the-dead-nearby).
- At a camp inside a POI the grounds' dead come out of its Not cleared rooms (open routes first, slowed by shut doors) and start in their rooms on the camp's map; a camp with no way out is cut off and can Break out (poirooms, issue #71). [bases.md](bases.md#rooms-and-the-way-out).
- The attack from any side (N, E, S, W); the stores on the map as the base's containers holding the real stock and armory where it is kept (what lies outside on piles; look into any at any time); raiders stealing from them and from parked cars and getting away with it; the dead and raiders battering doors, windows, walls, barricades and parked cars; the wear afterwards [basemap, containers, fort]. Storage rules: [bases.md, Base storage limits](bases.md#base-storage-limits).

### The Armory
- The user's requests 2026-10-19. A building (an outpost or the main base). On the map a windowless block with one locked security door (raiders batter it down; your people go in and out).
- Keeps every item of the base's armory in its gun cage and the rounds and arrows in its ammo lockers (what is not put in another container: containers.js; what is put in the armory goes there too): two locked containers inside.
- A raider at one batters the lock a turn at a time (a pry tool twice as hard) and takes nothing until it gives way. The panel and hover show 🔒 / 🔓 and the lock's hit points.
- A smashed door or lock wears the armory afterwards (broken: an ordinary door and open containers until repaired). By the numbers it halves the fighting gear a raid carries off.
- Modules: [buildings `armory`; basemap `ARMORY_LOCK`, `armoryCells`, `forceLock`, `lockedBox`, `MAP_WEAR.lock`; breakdowns FIXTURES.armory; arsenal `RAID_STEAL.armory`; ui/basemap `storesHtml`, `storeHover`].

### The defenders' keys
- The user's request 2026-10-19. On their own base's map your people lock and unlock its buildings' doors, the gate and the armory's gun cage and ammo lockers (Lock, Unlock: 1 action, quiet, next to it; a door or the gate from inside or out, never diagonally).
- Everything starts locked. An unlocked door is an ordinary closed door anyone opens (the dead still batter it); the gate unbarred stands open to everyone; an unlocked container is taken from without battering.
- Locking needs the doorway or gateway clear and shuts an open door. A smashed lock or broken door is no longer the key's. A key turned wears nothing.
- Modules: [basemap `keyOptions`, `keyTargets`, `keyAct`, `holdsKeys`, `KEY_AP`, cell `keyed`; combat combatAct `keylock` / `keyunlock`; ui/combat `keyButtons`, `keyNote`].

## Perimeter alarm
A powered Defenses build: nobody is surprised over the wall, and at night its sensors spot anything a tile out.
- The user's request 2026-10-24 (building recipes that use electronics). A utility-plot build on the Defenses tab from a shelter up (`data-power.js POWER_BUILDINGS.perimeter_alarm`): scrap 8, 1 machine part, 3 electronics, 10 work-hours, max 1, Mechanics 2, a drill and pliers; no blueprint. Draws 1 power from dusk to dawn (20:00–06:00), so it needs the grid (a generator, a solar array or a battery bank).
- **While powered** (`electric.js alarmOn`, from the hourly power cache): defences.js `armoryDefence` sets alarm = max(tripwire 0.5, ALARM.wake 0.6), so the people unwarned hold the walls at 60% of their combat power and watch.js `surpriseAt` returns null (a raid never gets over the wall before anyone woke, a horde never finds the defences unmanned or half-manned); and `lookoutsSpot` spots anything within ALARM.tiles = 1 tile of the base at night even with nobody on watch, the horde or raid warning card adding "The perimeter alarm's sensors picked them up on the approaches."
- Wears by use (0.3 a powered day, 0.05 idle, +2 an attack); repair 3 hours for 1 scrap and 1 electronics (Mechanics 2), a jury-rig 1 hour for 1 scrap; broken or unpowered it does nothing. Pulled down it gives 1 scrap and 1 electronics back.
- Not for the AI groups yet (their bases have no surprise rule). Modules: [data-power ALARM, electric alarmOn, watch lookoutsSpot / surpriseAt / watchSawText, defences armoryDefence, power POWER_USERS]. The rest of the electronics builds: [economy.md](economy.md#more-of-the-grid-electronics-builds).
