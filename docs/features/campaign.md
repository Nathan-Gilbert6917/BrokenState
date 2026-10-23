# Campaign, world and pacing

Detail for section 1 of [docs/agents/features.md](../agents/features.md). `[name]` is `prototype/src/sim/name.js`; `ui/name` is `prototype/src/ui/name.js`.

## Hardcore mode
- Start on the day Calder falls with 1–4 survivors on the road, no hub, sites only half looted, and the outbreak year [hardcore*, hardcore-start, hardcore-loot, hardcore-outbreak, hardcore-groups].
- **The Guard's base falls**: its splinter groups and stragglers carry out the base's own stores and armory (the strike force's remnant what the strike took out), as far as their people can carry. Nothing is made for them; the rest lies in the ruin's ground. A splinter that founds a hub has its people's kit for books [hardcore-groups militaryFalls carryOut strikeStores, loadouts grabKit, carry leaveOnGround, arsenal arsenalFromPeople].
- **Outbreak-year cards**: road and hub cards of its own: gridlock, Guard checkpoints and relief drops, the emergency broadcast, holdouts, looters, the newly dead; hungry people at the gate, a Guard deserter, the radio going quiet, city refugees [events HC_EVENTS, hubevents hc_*].

## Bare start and the hub's start layout
- Every base starts with empty plots [world HUB_START].
- The user's requests 2026-10-22: "the normal mode base map should start with 6 beds in a building or some tents and beds in a building". The normal hub starts with a Lodge with four beds set in it, a two-person tent pitched from its bag and eight crop plots dug (sown before the fall), placed by the game [world HUB_LAYOUT / hubLayout].
- Where: out in the open (never a town: startpick isSettlementTile), START_CLEAR (5) tiles or more from towns, cities, hives and the Guard's bases, on a road where one fits, named for the nearest town [world createWorld, startpick startNear].

## New-run shortcuts
- *Random run* rolls every setting (seed, size, groups, hives, mode, starting people, zombie look, the crew and gear, Customize's points) and starts at once [ui/newgame rollRandomRun].
- *New start position* moves where you start on the same map and seed, crew kept.
- *Pick start on map* (the user's request 2026-10-22) opens the map; the tile you click is the start.
  - Normal mode (the user's request 2026-10-22): open land for the hub (not water, a mountain, a town or a city), at least START_CLEAR = 5 tiles from towns, cities, hives, the Guard's bases and other groups' bases.
  - Hardcore: any open land that is not a hive or a group's or the Guard's base.
  - The hover tip says why a tile cannot be one ("Too close to the town of …").
- Modules: [ui/newgame rollRandomRun, startpick startWhyNot startNear START_CLEAR chosenStart, main pickStartAt]; test `tools/startpicktest.js`.

## World configuration
- The new-run screen's *World…* window sets a run's dials [worldcfg, ui/worldcfg]:
  - needs: hunger, thirst, spoilage, sickness;
  - the dead: horde size, the dead at sites, hive growth, zombie damage, infection from bites and from the land, whether the worm is curable;
  - AI groups: starting gear, events, raids;
  - loot by kind;
  - sizes: bases, raid maps (smallest and largest; cities and towns always the largest), city crawls and hive crawls;
  - wear, failures, fuel.
- Presets Gentle, Standard, Harsh, Nightmare; they turn to Custom once a dial moves.
- Kept on the world (`state.worldCfg`, saved) and read where each rate is applied.

## Ponds in the hollows
- The user's request 2026-10-23: "Update weather effects for the new terrain with hollows turning into ponds (after x days of no more rain the water goes away and it turns to mud filled hollow and if the water still exists and winter sets in it turns into a frozen pond and hills are harder to climb in rain and very hard in winter".
- One state per tile, stepped a day at a time from the tile's own weather (ponds pondStep, weatherOnDay, iceIndex): a rain day (FILL 0.25) or a thaw (MELT 0.1 of snow cover gone) fills the hollows; DRAIN 4 dry days and they are mud, MUD 4 more and dry; a heat wave or dry spell counts HOT 2 days; at a freezing index of FREEZE 3 degree-days the ponds are ice and hold, the mud frozen hard; a thaw makes ice a pond again.
- Your bases keep theirs (base.ponds, ticked at midnight after weatherDaily: world pondsDaily); any other tile's is worked out from its last LOOK 30 days (pondsOn, memoised).
- On a fight's, a raid's or a base's map (pondsBattle, from createBattle and createRaid; nothing on maps without relief): c.wet wade at a pond's edge, deep from DEEP_IN 3 cells in (CELL.water, no way through, unless that would cut ground off: then waded); water level c.wl 0.6 of a level above the floor. Move costs (combat reachable, distField: wetCost): wading +1, deep wading +2, mud +0.5, ice +0.25; a shot from the water −15 aim (shotOdds, wadeAim).
- The climb (climbCost × b.climbX: climbWx) ×1.5 in rain or storm, ×2.5 in winter, snow, a blizzard or snow cover 0.25+; ladders as before; shown in the battle hover (climbWord, wetWord).
- Nothing built on a pond or mud, nor a wet hollow filled in, until it dries (basemap placeProblemAt via pondWhy on the land's heights, so dug hollows fill too; siteWaits / pondWaits).
- Drawn as the river's water at the pond's level, darker where deep; ice with snow drifts; mud with puddles; snow on the hills in winter (ui/isoview wetPrims, terrainPrims). `tools/terrainweathertest.js`, `tools/pondshot.cjs`.

## Ponds on the map
- The user's words 2026-10-23: "add pond decor to the world map when a tile has a pond in the world map generate a pond in the battle map".
- **Pond tiles** (tile.pond): laid at the end of generateMap (mapgen pondsOnMap, pondDice) by hash dice of the world's seed and the tile, so the map's own dice and every old seed's map are untouched. Open land only (pondLand): plains (farmland, countryside) WORLD_PONDS.P 0.06, forest 0.05, hills 0.04; never water or a river, a mountain, a city, the suburbs or a town's site (a countryside site, a farm or a cabin, may have one). About 1 open tile in 20: some 100 on a Normal map.
- **Old saves**: state.worldPonds marks a world with ponds; a save without it gets them from its seed on load (save.js), except on a tile one of your bases already stands on.
- **The State Map**: a pond decal on the tile (ui/terraindeco pond, pondice: the rivers' water in a muddy bank with reeds, 22 × 12 sprite px), placed first to one side and kept clear of the tile's other decals, drawn under them and under a site's sprite (never in a clear zone). Frozen (ICE_LOOK: pale blue ice with cracks) while the ponds are ice: ponds pondIce, the freezing index past PONDS.FREEZE, the same test a fight's ponds use (ui/render F.pondIce, in the chunk cache key). The tooltip says "A pond (spring-fed): open water that never dries; waded at its edge in a fight", or "frozen over" (ponds pondTileWord).
- **Not a water source**: waterSource (staging.js) still counts only rivers and lakes; a pond does not water a camp or a hardcore start (changing that would move hardcore starts and camp water on old saves).
- **The base map** (basescatter reliefLayer(…, pond), SPRING): a hollow of the seed's wholly in the ring NEAR 16 to FAR 31 cells (Chebyshev) from the map's middle and OFF 4 off its middle row and column (the roads) becomes the spring's; else one is made in a diagonal quarter D 24 cells out each way, R 5–7 half-sizes across (9–13 cells once smoothed, at least HIGH.DIP_MIN), its ground RIM 2 cells round level, then relaxHeights and dropNarrowHollows again. landOf keeps it in the yard (never the clearing: CLEARING.hub 13), lays no scatter or wreck on it, marks its dip pieces spring (in waterOnly: the game's layout keeps off it) and returns land.springs; layLand sets c.spring. Nothing built on it (pondWhy with the springs, landWhy), never filled in (clearOf null) nor dug or raised (terraform dirtProblem), no camp spot on it (siteProblem).
- **Fights and raids** (relief applyRelief, springFight, SPRING_FIGHT): on any pond tile (plains and forest too, whose land otherwise stays level), a hollow R 5–7 half-sizes across with a RIM 2 level ring, in the middle MID 0.4 of the map's width, at the first of TRIES 64 spots by the tile's dice wholly on natural ground; then 5 × 5 half-sizes, then anywhere, then the spot least cut by what stays level (at most CUT 0.3). The trees, bushes and rocks in it are taken out (open water).
- **Water whatever the rain** (ponds springSt, pondsBattle): a c.spring cell is a pond on any day (dry 0), wading at its edge, deep DEEP_IN in (the river's water only where it cuts nothing off), ice when the tile's ponds freeze; it never drains to mud (no drought dries it). Wading +1 a step, deep +2, ice +0.25, −15 aim from the water, as any pond; the hover says spring-fed (wetWord).
- `tools/worldpondtest.js` (the tiles, old saves, the base map and fights in summer and winter, nothing built or dug, no ground cut off, non-pond tiles hashing as before ponds); `tools/worldpondshot.cjs` (the State Map summer, frozen and its tooltip; a fight on a pond tile summer and winter; the hub's base map made a pond tile).
