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

## The ground by the season
- The user's request 2026-10-23: "In raid and base view: Spring can create random mud on dirt tiles slows movement speed. Fall can have the red orange and brown leaves on the ground. Winter has snow on the ground slowing movement speed."
- Laid on a fight's, a raid's or a base's map when it is made (seasonGround, from createBattle and createRaid right after pondsBattle; the base map is a battle made the same way, so the Base map view and base defences have it too), from the calendar and the tile's own weather. Not on a hive chamber's map (NO_SKY) nor a building's floor (its floor is "floor"). It costs nothing per turn: the cells carry it.
- Spring [seasonground MUD]: patches of mud (c.gnd "mud") on dirt and fields (MUD.FLOORS; open ground, bushes, tents, outlines: MUD.KINDS), never on a pond. The share of that ground in mud is mudShare: MUD.BASE 6% after a dry spell up to BASE + MUD.WET 28% right after rain (the hollows' days since rain, ponds.js pondsOn dry, over DRAIN + MUD days), none while the ground is frozen or snow lies. Where: smooth two-octave noise from the cell, the tile and the year (MUD.SCALE 5 cells), cut at the share's quantile, so the same spring's mud lies in the same low spots and spreads from them after rain. A step into it costs MUD.COST +0.5 (as a hollow's mud).
- Winter [seasonground SNOW]: whenever snow lies (snow cover SNOW.MIN 0.15 or more, as ponds.js b.snowLie; b.snowLie is now set on a map with no hills too), c.gnd "snow" with c.sd its depth (the cover in quarters) on all the outdoor ground (SNOW.FLOORS grass, field, dirt, gravel, road, rubble; under a fence or a car too; not up on a walkway, stand, tower, ladder or roof: SNOW.RAISED), never on a pond: a frozen pond keeps its ice (+0.25, slippery) and its drifts. A step costs SNOW.COST +0.25, in deep snow (SNOW.DEEP 0.75 cover or more) SNOW.DEEP_COST +0.5. Spring's mud is not laid while snow lies.
- AI parity (docs/adr/0001): groundCost is added to the step cost beside ponds.js wetCost in combat.js reachable (your people, the AI's groups) and distField (the dead and every walker's field), so every side pays the same.
- Autumn's leaves are drawing only [ui/groundlook leafField, groundTexel]: the trees' own FALL colours (ui/seasontrees.js: red, orange, brown, rust) as two-texel leaves on the outdoor ground, LEAF.BASE by the look (5% of the ground early in autumn up to 18% from day 10) and LEAF.NEAR +0.6 thicker under a tree fading out LEAF.R 3 cells, LEAF.ROAD 30% as many on the road and gravel; none on water, a building's floor or in winter.
- Drawn [ui/groundlook, ui/isoview floorColor, flatGroundFor, groundFor, terrainPrims, skirtColor]: mud dark and wet with a puddle's grey sheen and a ragged rim; snow in drifts over snowShare(depth) of the ground (35% + 65% × depth: all of it at full cover; LEAF.SNOW_ROAD 85% of that on the road so the asphalt shows in patches), frosted between, blue in the drifts' dips; the hills' tops and banks the same (o.gt, o.lf in the sprite key); the skirt past the map's edge snowy and leafy too. The ground pictures' key carries b.ground's key and the leaves' look (groundKeyOf), so a new season or snow paints the ground once and any other frame costs only the key; the noise is looked up in tables made once (LAT, DRIFT), not hashed per texel.
- Hover (ui/combat.js previewText: groundWord): "Spring mud … +0.5 moves a step in", "Snow / Deep snow on the ground (N% cover): +0.25 / +0.5 moves a step in, people and the dead alike".
- Test `tools/seasongroundtest.js`: the rules, mud only on dirt in patches (the same map the same mud, less as it dries, none in summer), snow on every outdoor cell of a fight and a raid and none on a building's floor or a frozen pond, the step costs for your people and the dead (reachable and distField), the hub's base map in spring and winter, and the view on stub canvases (snow, mud and leaves painted, the ground painted once a season).
