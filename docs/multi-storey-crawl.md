# Multi-storey buildings for the city crawl (requested 2026-10-05)

> City crawls should be in 3D isometric with the buildings being multi story tall and when inside you can go up floors
> and explore and loot. Zombies, raiders, survivors etc can be encountered in the buildings.
> The buildings should be different types and the size of the maps should match the type and be dynamic.

## What exists already

- The battle view is isometric by default (ui/isoview.js): 2:1 diamonds, one height level = `LV` (20) art px, walls
  one or two storeys tall (`c.t`), roofs cut away around your people, rotation and zoom.
- A building's interior is its own map (sim/buildingmaps.js `assemble`): a footprint by archetype (house, shop,
  big store, institution, open floor, church, motel, apartments), rooms with roles and loot tables, doors, locked
  rooms, windows, exits with extraction zones. The map's size already follows the footprint plus margins
  (sim/battlesize.js `fitMargins`, `buildingTarget`, size classes S–XL).
- One upper floor exists as *raised rooms*: some rooms get `up = true`, their cells become `loft` at height 1,
  reached by a `stairs` or `ladder` cell. It is one grid, so the upper rooms sit beside the ground rooms, not above
  them. That is what has to change.
- The battle is one grid: `b.cells[y * b.w + x]`, `b.reach`, `b.losCache`, `b.raid.containers[]` with x, y. The
  sim indexes that grid everywhere (movement `reachable`, `los`, the enemy AI, searching, doors). Units have x, y.

## Design

### Floors as swapped grids (the sim)

- `b.floors[f] = { cells, reach, losCache, name }` for f = 0 (ground) … `b.raid.storeys - 1`. Every floor is the
  **same size** as the ground map (same `b.w`, `b.h`) and shares the building's footprint and outer walls. Outside
  the footprint an upper floor has `void` cells: not walkable, no cover, seen through (you look out of the windows).
  The street, the vehicle and the extraction zones exist on the ground floor only.
- `b.floor` is the **active floor**. `b.cells`, `b.reach` and `b.losCache` always alias the active floor's arrays,
  so every existing function keeps working unchanged. `setFloor(b, f)` swaps the aliases.
- Every unit has `u.f` (its floor). A unit on another floor than the active one counts as off the map for that
  floor: `active()` and `onMap()` get `&& u.f === b.floor` (a new flag, not `u.off`, which already means gone).
  Containers get `c.f`; `b.raid.containers` holds all floors, and the search/box helpers filter by the active floor.
- **Stairwells**: one or two per building at fixed (x, y), on every floor the same cells: `stairs` on floor f leads
  to the same cell on f + 1. Since 2026-10-25 each is a stair run against a wall with a landing at each end, and only
  its top step changes floor (see "Stair runs" below). Standing on a stairwell cell a unit can **Go up** / **Go down** (a battle action,
  1 AP, like a climb; the dead pay `CLIMB_DEAD`). It moves the unit's `u.f`; position stays. A unit cannot end on a
  stairwell cell that is occupied on the target floor. The existing raised-room `loft` mechanic is retired for
  buildings that get real storeys (keep it for barns' haylofts).
- **Turns**: the player's units act on whatever floor they are on; the view follows the selected unit. The enemy
  phase runs once per floor that holds any unit: swap the active floor, run the existing AI, swap back. Floors with
  no units do nothing, except that once a turn each floor with **aware** dead and no players sends one of them to
  the stairwell toward the nearest floor with players (it appears on that floor's stairwell next turn). Heat is one
  number for the building; a fight upstairs draws the dead up the stairs from the floor below.
- **Loot by floor**: rooms are rolled per floor from the archetype (an office tower: lobby and shops on 0, offices
  above, a plant room at the top; apartments: flats on every floor, a laundry in the basement if any; a hospital:
  reception and pharmacy on 0 and 1, wards above). Upper floors are less picked over (richness ×1.1 a floor, cap 1.5)
  because the dead and earlier looters stayed low. The block card says "N storeys" per place and hints what is up.
- **Who is inside, by floor** (wanderers.js `interiorOccupants`, called per floor with a share of the budget):
  the dead mostly on the ground floor and the stairwells; raiders holed up in an office or a flat with a watcher
  on the stairs; survivors barricaded on an upper floor (a card: talk, trade, recruit, or they shoot); a nest of
  the special dead on the top floor deeper in the city. Phase 3.
- **Save/load**: `state.combat` is saved as plain data already. Floors are plain arrays; on load re-point the
  aliases (`b.cells = b.floors[b.floor].cells`, same for reach and losCache). Typed arrays must round-trip the way
  `b.losCache` does today (check sim/save.js).

### Storeys and footprint by building type (dynamic size)

| Type | Storeys | Footprint |
|---|---|---|
| Cabin, diner, gas station, corner store, pharmacy, gun store, hardware, feed store, church, ranger station | 1 (corner store 1–2: a flat above) | small–medium, as now |
| House, farmhouse, lodge, motel, fire station, barracks, mess hall | 2 | medium |
| Supermarket, department store | 1–2 | wide (big box) |
| Clinic, infirmary, lab, control building, terminal | 1–3 | medium |
| Police station, school | 2–3 | medium–large |
| Hospital | 3–5 | large |
| Warehouse, factory, hangar, motor pool, auto shop, garage, workshop, machine shed, barn | 1, tall walls (barn keeps its hayloft) | wide |
| Office building | 3–8 | **smaller footprint the taller it is** (a tower) |
| Apartment block | 3–6 | medium, deeper city blocks taller |

The map size follows the footprint and the margins as today (`fitMargins` / `buildingTarget`), so a tower is a
small map with many floors and a supermarket a large map with one. In the city crawl, block depth adds to the
storey roll for offices and apartments (+1 at block 4+, +2 at block 7+), capped at 8 floors.

### Rendering (ui/isoview.js, ui/combat.js)

- The scene is built for the **active floor**. Inside the footprint every cell is drawn raised by `b.floor`
  levels (the floor you are on is the one you see into); the storeys below are the building's wall mass
  (outer walls from 0 to `b.floor * LV`, no interior). Storeys above are cut away; the roof is drawn only when
  viewing the top floor. Outside the footprint, when `b.floor > 0`, the ground stays at level 0 (looking down
  from a window), dimmed.
- Units on other floors are not drawn on the map; a faint marker at their x, y with ▲/▼ and the floor number
  shows where they are. The unit strip lists everyone with their floor.
- **Floor switching**: PageUp / PageDown and a `Floor 2 of 5 ▲ ▼` control in the view bar. Selecting a unit
  switches the view to its floor; clicking a marker of a unit on another floor jumps there. The top-down view
  draws the active floor the same way.
- The stairwell cells read as stairs with an up or down arrow; the one you can take is lit when a unit is
  selected on it.

## Phases

1. **Sim and generation** (sim/buildingmaps.js, sim/combat.js, sim/battlesize.js, sim/citycrawl.js,
   tools/*test.js): floors, storeys by type, dynamic footprint, stairwells and the Go up / Go down action, enemy
   phase per floor, containers by floor, the block card's storey count. Headless tests cover generation (every
   type, storey counts, connectivity floor to floor), movement between floors, LOS confined to a floor, loot and
   extraction, and save/load mid-raid on an upper floor.
2. **Rendering and controls** (ui/isoview.js, ui/combat.js, styles.css, help): the active floor drawn raised,
   the wall mass below, cut-away above, other-floor markers, the floor control and keys, the top-down view.
3. **Who is inside, by floor** (sim/wanderers.js, sim/citycrawl.js, cards): survivors barricaded upstairs,
   raiders holed up, nests on top floors, loot richer upward, the crawl's place text.

## Open choices (defaults in bold)

- Other floors while you are not on them: **frozen, with one dead a turn drawn to the stairs by noise** / fully
  simulated every turn (slower, more surprises).
- Extraction: **ground floor exits only** / also a fire escape from upper floors on some types.
- Stairs: **free to use (1 AP)** / some stairwells blocked (collapsed, barricaded) so another route is needed.

## As built (2026-10-06)

All three phases are in dev: `ffb55dd` (sim and generation), `840ff17` + `16f65c0` (rendering and controls), `6608aec`
(who is inside, by floor; `sim/floorfolk.js`). Differences from the design above:

- A unit on another floor is `u.away` (kept in step by `setFloor` / `moveToFloor`); `activeAny(u)` means standing
  anywhere in the building. `b.floors` is undefined for a single-storey building, which draws exactly as before.
- A building with storeys is never roofed over while you look at one of its floors (the top floor shows its rooms,
  fogged until seen); extraction zones draw on the ground floor only.
- You cannot climb into a stairwell someone stands on ("Someone is on the stairs above"): move off the landing.
- The dead on other floors are frozen except one aware one a turn drifting to the stairs toward you (the default
  from the open choices); extraction is from ground-floor exits only; stairwells are always usable.
- The block card has a **Look around (1 h)** action (Scouting) that reads each tall place's upstairs: "lights were
  seen upstairs" (survivors), "voices and a watcher on the stairs" (raiders), "something nests above" (a nest from
  block 4 in buildings of 4+ storeys), else "nothing stirs upstairs". Chance tables: `FOLK` in `sim/floorfolk.js`.
- Survivors behind a barred door raise a card on contact (Talk, Ask them to join, Leave them be, Force the door);
  a left-be group stays as a wanderers group at the city; recruits wait on the street after you extract.
- Open: a door-panel "Force the door" for a group already met (the barricade is otherwise opened only through
  the card); fires, smoke and acid have no floor yet (a Molotov upstairs also burns the same cell downstairs);
  each visited floor's sight cache is saved (a fully explored 5-storey hospital adds a few MB before gzip).

## Stair runs (2026-10-25, issue #9)

The user asked that interior layouts make sense (epic #7). A stairwell was one `stairs` cell at the centre of the
biggest hub room; it is now a stair run. Detail: [docs/features/travel.md](features/travel.md#stair-runs-2026-10-25).

- **Shape**: a straight run of 2 steps (3 in a hospital, school, office tower or apartment block) with a 1-cell landing
  at the bottom and the top. It lies against a wall of its room, parallel to it, with a lane of the room beside it, and
  no door opens onto a step. `b.raid.runs[i] = { x, y, dx, dy, len, f0, f1 }`; the step cells carry `c.dir`, `c.step`
  and `c.top`. The same cells are the run on every floor it joins (a stacked stairwell); an upper floor's plan is opened
  where it put a wall across a step or a landing.
- **Changing floor**: Go up / Go down only from the top step, 1 action as before; position stays, so you arrive on the
  top step with the upper landing beside it. `b.raid.stairs` is the list of top steps, so the bots, the dead's drift to
  the stairs and everything else that walks to a stairwell work unchanged.
- **By kind**: a house's from the hall or front room by the front door; a shop's from the back room to the flat
  above; apartments and offices in a 2-wide stairwell room of their own beside the lobby, one door a floor; a
  hospital's and a school's at each end of the main corridor; a police station's or fire station's from the lobby or
  day room; a motel's an outside stair along a side wall up to the walkway. A footprint too small for a run keeps the
  one-cell stairwell (none of today's multi-storey types needs it). No basements, cellar doors or attic hatches.
- **Who waits there**: the dead by the stairs and the watchers stand on the landings, not on the steps. Survivors or
  raiders holding an upper floor shove a piece of furniture onto that floor's top landing where the floor stays
  connected round it.
- **View**: steps rising toward the floor above, a railing on the open side, the top floor's run drawn as the opening
  down; the floor marker and PageUp / PageDown unchanged.
- **Saves**: an older save's one-cell stairwells (no runs, no `c.step`) still change floor from any stairs cell; an
  older building snapshot restores its own stairwells from its cells.

## Parts with fewer storeys (issue #23, 2026-10-25)

Buildings are no longer only boxes ("Schools should be larger and make buildings not just squares and asymetrical
like many buildings are irl."): a new save's building can be a union of rectangles (`spec.shape.parts`), each part
with its own plan and its own storeys. Detail: [docs/features/combat.md](features/combat.md#raids-into-building-interiors)
("Buildings that are not boxes").

- **Floors**: every floor is still the ground map's size. A part is on floor g while `g < part.storeys`; above that
  its cells are `void` like the ground outside, so a school's gym, a hospital's ER, a police station's sally port, a
  fire station's engine bay or a house's garage is a lower roof beside the floors above it. A part never rises above
  the part it joins (a wing no taller than the main block), so every floor's parts reach one another.
- **Stairs**: the stair runs (#9) stand only in a part with every storey (`allUp`); every floor up is reached from them.
- **Walls**: two-storey walls (`c.t = 2`) on a part with storeys or a raised room, or marked `tall` (a gym's one tall
  storey); a one-storey annex's walls one storey high.
- **View**: on a floor above a lower part its roof is drawn at its storeys' height with its wall mass (ui/isoview.js
  `sceneFor` `low`, from the ground floor's `c.bs`); each part is its own roof component, cut away with its building.
- **The crawl**: a shaped place is kept and restored whole (`snapshotBuilding` keeps every floor's cells); the
  school's bigger map is its own box and margins. Checked in `tools/storeytest.js`.
- **Older saves** (`shapesLegacy`): every building the rectangle it was.

## Parity with the raid tickets (issue #21, 2026-10-25)

The last ticket of the interiors epic (#7) brought the crawl up to what the raid tickets added. The detail is in
[docs/features/travel.md "Parity with the raid tickets"](features/travel.md#parity-with-the-raid-tickets-issue-21-2026-10-25).

- **Snapshots** (`snapshotBuilding` / `restoreBuilding`): every floor's cells are copied whole with `structuredClone`,
  so blood and spent brass (#11), decor and wall art (#13), pieces shoved, battered, lifted off or set down (#12, by
  floor), boards, and the stair cells (`R.stairs` too: the stair runs of #9) come back exactly as left; containers with
  their contents (ground piles, a lifted piece's emptied record), bodies by floor (`b.corpses` with `f`), the scenes
  and who holds the floors likewise. Nothing is shared between the snapshot and the battle.
- **Scenes by the place**: the place's dead, raiders, how picked over and rich it is and people upstairs bend the scene
  roll (interiorscenes `sceneBias`, through `placeOption` → `option.scenes`). A place picked over is found with
  containers stripped and a scene's barricade broken through (`pickedOver`). Raiders board their room's windows and
  drag half cover up beside its doors; survivors pile furniture beside their barred door (floorfolk `boardWindows`,
  `pileAgainst`).
- **Carrying**: a piece of furniture carried out of a place goes on block to block, the pair kept on the crawl
  (`c.mates`); a block's walk takes longer by the slowest carrier's pace (`carryPace`); going into a place it stays
  in the arms at the entry, set down at the door when the dead are right inside; out at the rim it is loaded at the
  entry block where the vehicles wait, else dropped from exhaustion there and remembered on the block (`mem.left`,
  taken up again from the block card).
- **The card**: each place's hint line names its storeys and its kind's signature rooms ("Hospital: 4 floors, wards,
  a pharmacy": `placeHint`).
- **Quick search**: opens the place's own building's containers (`placeProfile`, `quickLoot`, combat `boxFinds`), so
  a container searched quickly holds what it holds on the map.
