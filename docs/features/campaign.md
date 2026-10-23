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

## Seasonal weather in play
- The user's request 2026-10-23: "in winter the ground is covered in snow and slows people. ice can form and has a chance to trip people. In spring it rains more often and show rain fog can occur to that limit visibility range and rain obscures some sounds and renders some distractions null"; and the same day: "when night and foggy the vision is really reduced".
- The battle's tile's weather at the hour it starts is noted once as a fight's, a raid's or a base's map is made (seasonfx seasonBattle, right after ponds pondsBattle in combat createBattle / createRaid): b.sfx { snow, snowStep, ice, rain, fog, fogWhy }. Everyone obeys it, your people, raiders, soldiers, the third side and the dead (AI parity).
- **Snow** (SEASONFX.SNOW): in winter (at least 0.5 deep), under falling snow (0.3) or wherever snow cover lies, open ground (grass, dirt, field) costs snowStep more a step: 0.5 × depth / 0.5, clamped 0.5–1.5 of it (light cover +0.25, a winter's day or half cover +0.5, deep drifts +0.75); a road half that; floors, roofs, ponds and ice nothing (seasonfx groundCost in combat reachable and distField).
- **Ice** (SEASONFX.ICE): when freezing (the hour's temperature ≤ 0 °C, frozen ground or the ponds iced) and wet (snow lying, mud, rain or snow falling, a pond): frozen ponds, 30% of road cells and 3% of open ground (frozen puddles, c.ice, by a hash of tile, day and cell). A step onto ice costs +0.25 and slips 10% (sneaking ×0.5, Light Step ×0.75), rolled on the battle's own dice (armour battleDice "slip"): the move ends there, the rest of the turn is spent getting up (u.ap 0), 1–3 damage, no armour (seasonfx slipStep from combat moveAlong).
- **Spring rain** (weather WEIGHTS.spring rain 24 → 30, from clear 30 → 27 and overcast 22 → 19; EXTRA spring rain fronts 0.3 → 0.36): rain or storm days in spring 30% → about 35% (40 seeds × 3 years); summer, autumn and winter unchanged; spring soil moisture 0.87 → 0.88 on average (farmtest passes).
- **Rain fog** (weather rainFog, RAIN_FOG): on a rain or storm hour, one roll a day per weather system (the front over the tile, or the day's sky; a hash of the seed, no RNG stream touched): 15%, ×2 in spring, +20% from 04:00 to 09:00. A battle in it sees 7 tiles at most (FOG.RAIN), in a fog bank 6 (FOG.BANK). The State Map's travel lines say "Rain fog: a fight here sees 7 tiles at most" (weather travelEffects).
- **Night fog** (FOG.NIGHT 3, FOG.LIGHT 0.5): at night in fog the dark ahead is 3 tiles (below the darkest night's 4 and the fog's 6–7), a light's beam or pool and night vision reach half as far (a flashlight 4.5 instead of 9, night vision 6 instead of 12), never under 3; the dead (no front) see 3. One place: seasonfx fogSight (combat sightRange), fogEyes (vision nightEyes), fogNotice (stealth noticeRange). Indoors (a floor) the fog changes nothing.
- **Rain and sound** (SEASONFX.HEAR): outdoors in the rain a noise carries ×0.6 (a storm ×0.45), anything under 3 tiles not at all (seasonfx muffle in combat alertNear, stealth noiseAt and the lures, a guard hearing feet behind them, your people hearing the unseen: hearing heardGhosts). A noise lure that would carry under 6.5 tiles is drowned out ("Rain drowns it out"): a bottle, a noise maker, an alarm clock, an empty magazine; firecrackers and a pocket radio still carry, muffled; a flare and heat lures work as ever. The AI does not throw a drowned lure (decoys botDecoy, stealth botStealth) and the aware dead do not follow one (decoys stimuli).
- UI: the battle's conditions line ("Snow: moves +50%", "Ice: 10% to slip", "Rain fog: sight 7", "Night fog: sight 3", "Rain: sounds carry less"; ui/combat wxHtml, the raid's top strip), the hover (seasonfx cellWord: "Ice: 10% to slip…", "Snow: +0.5 moves a step in"), the move preview (pathWord: the snow waded, the ice crossed and the chance of a slip on the way), the throw buttons ("Rain drowns it out"). `tools/seasonfxtest.js`, `tools/seasonfxshot.cjs`.
