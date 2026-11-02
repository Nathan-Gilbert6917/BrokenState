# The Godot starting point: the State Map hex grid

A Godot 4.7 (.NET) project that generates and draws the State of Calder's hex grid the way the prototype generates it
(`prototype/src/sim/hex.js`, `mapgen.js`, `worldsize.js`), laid out as the rebuild board plans the whole game
(`board/`, Infrastructure tab): an engine-free C# sim, its xUnit tests, and this project as the presentation.

```
BrokenState.sln                     the whole rebuild: sim, tests, Godot project
src/BrokenState.Sim/                the engine-free sim (netstandard2.1, C# 9: Unity 6 can compile it too)
  Core/Rng.cs                       mulberry32, the prototype's dice bit for bit
  Core/HexGrid.cs                   pointy-top odd-r grid, id = y × width + x: neighbours, distance, within, ring, line, pixels
  Core/HexLayout.cs                 the pixel layout of a w × h tile (Godot's TileMapLayer geometry) and picking
  Core/HexPath.cs                   A* with a binary heap (the prototype's findPath)
  World/Terrain.cs                  the seven terrain types with the prototype's colours; WaterKind, Zone
  World/Tile.cs, WorldMap.cs        the tiles and the map
  World/MapConfig.cs                every generation property, with its default
  World/WorldSizes.cs               Small 150 × 75 … Huge 500 × 300, the 64 × 42 density unit, customDef
  World/ValueNoise.cs               the prototype's value noise
  World/LandGen.cs                  terrain (exact parity), ocean, lakes, rivers
  World/Settlements.cs              how the settlement tiles are set: counts, placement, city / suburb / rural rings
  World/Roads.cs                    the main roads: spanning tree + loops, A* over terrain cost
  World/WorldGen.cs                 runs the passes in order from a seed
tests/BrokenState.Sim.Tests/        xUnit: the grid, the dice, A*, the generator, and the golden parity tests
tests/golden/                       the prototype's terrain for seed 12345 (64 × 42 and 300 × 150)
godot/                              this project
  project.godot, BrokenState.Godot.csproj (→ ../src/BrokenState.Sim)
  Map/MapSettings.cs                the scene's generation properties as a Resource ([GlobalClass])
  Map/Presets/*.tres                Test300x150 (the default), Small, Normal, Large, Huge, DensityUnit64x42
  Map/HexTiles.cs                   the flat-colour hex TileSet, painted at run time (no art committed)
  Screens/StateMap/StateMap.tscn    the scene: Tiles (TileMapLayer), Roads, Overlay, Camera, Ui
  Screens/StateMap/StateMap.cs      generates from Settings, paints the tiles, the control panel
  Screens/StateMap/MapCamera.cs     drag, WASD, wheel zoom to the cursor, clamped to the map
  Screens/StateMap/MapOverlay.cs    settlement markers, hover and selection, the distance overlay
  Screens/StateMap/RoadOverlay.cs   the roads as lines between tile centres
```

## Open it

1. Install the .NET 8 SDK and Godot 4.7 **.NET edition**.
2. `dotnet test` at the repo root runs the sim's tests (34, about two seconds).
3. Open `godot/project.godot` in Godot and press Play: the 300 × 150 test map builds in under half a second and is
   painted on the TileMapLayer. The panel sets the seed, the size (or a preset), the city and town counts, and
   regenerates. Drag with the middle or right mouse button, WASD or arrows pan, the wheel zooms to the cursor, a click
   selects a tile and labels every tile within 6 with its hex distance (the check that the grid maths is the
   prototype's: `core.hexgrid` on the board).
4. The rings, the water and the roads are properties of the `Settings` resource (select the StateMap node, or edit
   `Map/Presets/Test300x150.tres`); each is explained in `MapConfig.cs`.

The Output panel prints a warning if the sim's HexLayout and the TileMapLayer disagree on where a cell's centre is
(StateMap.CheckLayoutAgainstTileMap): the TileSet is Godot's hexagon shape, horizontal offset axis, Stacked layout,
which is the prototype's odd-r grid.

## What matches the prototype, and what does not

- **Exact parity: the dice and the terrain.** `Rng` is mulberry32 as `rng.js` has it; `LandGen.TerrainPass` draws the
  three noise fields (cells 9, 4.5, 8) in `landMap`'s order and applies its thresholds (mountain above 0.78, hills
  above 0.63, forest when moisture is above 0.56). `tests/golden/*.json`, written by
  `node prototype/tools/hexgolden.js`, hold the prototype's elevations and noise terrain for seed 12345; the golden
  tests compare every tile (64 × 42) and a digest (300 × 150). Change the noise or the thresholds and they go red.
- **The prototype's rules, not its dice: the rivers.** The prototype draws its river jitter inside a sort comparator,
  which depends on the JavaScript engine's sort, so the C# rivers follow the same rule (downhill from the northern
  highlands with a southward pull and jitter, sources 12 apart, 3–4 per 64 tiles of width) with their own draws. From
  the rivers on, a seed's map is the prototype's in kind, not tile for tile.
- **New here: the ocean and the lakes.** The ocean lies along the south edge (where the rivers already flow), up to
  `OceanDepth` tiles inland where the land is low, so the coast has bays and headlands; lakes form within `LakeBand`
  of the other edges where the elevation is below `LakeLevel`. Both are read off the elevation field and spend no
  dice, so they do not disturb the terrain parity. Rivers end in the sea or a lake.
- **The settlement rings are the rebuild's rule** (the user's design, 2026-11-02), concentric rather than the
  prototype's chance-based edges: a city's centre and every tile within its radius are city tiles (Calder City 4, the
  rest roll 2–3), then `SuburbRing` tiles of suburbs, then `RuralRing` tiles of rural zone that keep their natural
  terrain. A town is a suburb centre with a suburb ring of 1–2 and the rural ring outside it. Where they go and how
  many are the prototype's rules (`Settlements.cs` header). Names are placeholders ("City 2", "Town 17").
- **The roads are the prototype's highways**: Prim's spanning tree over every city and town, each edge routed by A*
  over terrain cost (road 0.4, flat 1, forest 2, hills 3, river 7 = a bridge, lake 12, mountain 9, ocean never), then
  loop roads to the two nearest neighbours when the detour is long.

## Not here yet (TODO, with the board card and the prototype lines)

- Names from the prototype's pools and uniqueness forms: `world.mapgen`; `mapgen.js` lines 38–80 and ~276–315.
- The sites inside a city or town (police, auto shop, shops, satellites), the countryside sites, the landmarks (Guard
  base, prison, dam, airport), streets and spurs, truck stops: `core.mapgen` / `world.mapgen`; `mapgen.js` ~100–145,
  ~397–520, ~566–600.
- Infection, finds, hives, hot spots, the town rings' hash dice, ponds: `mapgen.js` ~600–720.
- A road TileMapLayer with spoke tiles, and real hex art in place of `HexTiles.Paint` (the Art school's 48 × 56 hex
  template: load a PNG atlas in the same column order): `ui.statemap`.
- A `SimHost` bridge, commands and events: `infra.engine`, `infra.events`.

## Regenerating the golden files

```
cd prototype && node tools/hexgolden.js
```

Only when the prototype's `landMap` terrain pass changes on purpose; the C# port must then change the same way.
