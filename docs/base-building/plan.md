# Base building system: the plan and the contract between its parts (2026-10-19)

The user's request: "Update base defenses building to be a full base building system allowing the viewing and building
of buildings within the base map limits with a 5 tile margin around the edge of the map as a no build section. Add
different sized general buildings that you can build things inside such as workbenches, beds, storage, kitchen etc.
If you place buildings next to each other you can create a doorway between them. The survivors do not show in this
building system but you are able to organize the inventories of the survivors, vehicles and the storage of the base to
storage containers within the base. When raided by raiders they can steal these items from the containers or from
vehicles so the player and ai autopilot needs to set up a balanced base with needs and defenses."

What already exists (read these first): `prototype/src/sim/basemap.js` (every base's grid map, footprints `FOOT`,
placement rules, the auto layout, the battle map built from it, the stores on the map, raiders stealing),
`prototype/src/sim/buildings.js` (`BUILDINGS`, plots, `canBuild` / `queueBuild` / `constructionHour` / `addBuilding` /
`demolish`), `prototype/src/ui/basemap.js` (the Base map tab and the layout mode's side panel), `prototype/src/ui/combat.js`
(layout mode's clicks), `prototype/src/sim/inventory.js` (locations, `storageFor`, the base armory as a flat list),
`prototype/src/sim/vehicles.js` (`carsAtBase`), `prototype/src/sim/autopilot.js` (`planBuilds`, `buildWishes`),
`prototype/src/sim/groupbases.js` (AI groups' bases are base objects in the player's shape: docs/adr/0001-ai-parity.md).

Everything below is the contract. Each part names its owner; a part edits only its own modules and sections. Two owners
edit `sim/basemap.js` at the same time, in different sections: edit with targeted replacements only (never rewrite the
file), and re-read a region right before changing it.

## Vocabulary

- **The map**: a base's grid (`gridHalf`), coordinates relative to the middle. **The yard** `[-C, C)`, **the band** (the
  wall ring), **outside**: open ground to the grid's edge.
- **The no-build margin** (`NO_BUILD = 5`): the five cells nearest every edge of the grid. Nothing is placed there
  (buildings, fittings, crop plots, defences, cars; by hand or by the game). Reason text: "Within 5 cells of the map's
  edge (nothing is built there)". `buildBaseMap` marks a cell in it `c.nb = 1` in the view (`opts.view`) only, and the
  fort record carries `F.noBuild = NO_BUILD`.
- **A general building** (`BUILDINGS[type].general === true`, `FOOT[type] = { kind: "house", general: true, plain: true, storeys: 1 }`):
  an empty shell of some size whose indoor cells (`(w − 2) × (h − 2)`, the non-border cells) take **fittings** and
  indoor props. Types and sizes (name, w × h, cost, hours, max, the smallest base: `size`):
  `gen_hut` Hut 4 × 3 (10 scrap, 14 h, max 6, camp), `gen_cabin` Cabin 5 × 4 (16 scrap, 20 h, max 6, shelter),
  `gen_lodge` Lodge 6 × 5 (26 scrap + 1 part, 30 h, max 4, outpost), `gen_hall` Hall 8 × 6 (40 scrap + 2 parts, 44 h, max 3, outpost),
  `gen_barn` Barn 10 × 7 (60 scrap + 3 parts, 60 h, max 2, hub). No plot (`plot` unset): the map is the limit.
  A plain house: no counter, no stairs or loft, a barred front door in the middle of the front, a back door when
  `w × h >= 20` (as `houseCells` does now), windows as now.
- **A fitting** (`BUILDINGS[type].fit === true`): built only inside a standing general building, on its indoor cells.
  `bunks` Bunk beds 2 × 1 (5 scrap, 4 h, max 24; `BEDS.bunks = 2`), `shelves` Storage shelves 2 × 1 (4 scrap, 4 h, max 24;
  a container, 200 kg), `lockers` Lockers 1 × 1 (6 scrap, 5 h, max 12; a container, 120 kg, gear leans to it),
  `stove` Wood stove 1 × 1 (8 scrap, 8 h, max 4; `as: "cookhouse"`: counts as a cook fire wherever `count(base, "cookhouse")` is read).
  A fitting record: `{ id, type, at: [x, y, r], host: <the general building's id> }`; `host` is set by placement and
  must stay true (its cells inside that building's indoor cells). Draw them with cell kinds that exist (`shelf`,
  `locker`, `counter`, and for bunks whatever `FURNITURE` / `CELL` has for a bed; add a `CELL` kind only if there is
  none, and then draw it in `ui/isoview.js` as a plain prop).
- **Indoor props**: the yard things that may stand inside a general building as well as in the yard: every prop whose
  `FOOT.k` is `counter`, `table`, `crate` or `locker` (`FOOT[type].indoor = true`: the benches, the ammo and reloading
  benches, the med station, the smoker, the sealer, the mill, the grinder, the crates, the relay). Not the barrels, the
  well, the pump, the fire pit, the bars.
- **A doorway** between two adjacent buildings (`base.plan.links = [{ a: <itemKey>, b: <itemKey> }]`, item keys as
  `itemsOf` gives them: `b:<id>` standing, `c:<id>` queued): two house-kind items whose footprints touch along a run of
  at least one cell (A's border cell orthogonally next to B's border cell, neither a corner). The doorway is the pair in
  the middle of the run: both wall cells become barred doors (`bdoor`, `hp: INTERIOR.DOOR_HP`, indoor) facing each
  other, with no outside cell to keep clear. A link whose buildings no longer touch is dropped when read. When a queued
  building finishes (`carryPlacement`), links naming `c:<job.id>` are rewritten to `b:<building.id>`.
- **A container** (sim/containers.js): somewhere at the base goods are kept, with a capacity in kg. Keys: `"core"` (the
  base itself: the camp cache, the shack, the main house), `b:<id>` (a building that keeps goods: storehouse, cellar,
  coldstore, freezer, crates, shelves, lockers), `v:<id>` (a car parked at the base, capacity its type's payload), and
  `"yard"` (goods with no container: unlimited, exposed). Capacities (kg): core by tier camp 150 / shelter 400 / outpost
  600 / hub 1200; storehouse 2000, cellar 800, coldstore 600, freezer 500, crates 120, shelves 200, lockers 120.
- **An assignment**: an armory item keeps the key of its container in `item.store` (missing or stale: unassigned); a
  supply's split is `base.bins = { [containerKey]: { [supplyKey]: qty } }` (what is not in a bin is unassigned). Nothing
  leaves the base's books: `base.stock` and `base.armory` stay the truth; containers only say where things are kept.
  Unassigned goods are spread by the game (`autoStore` daily on the autopilot and on AI bases; at fight time for the
  rest) into containers with room, the overflow to the yard.

## Part A: the map and the buildings (owner: the map agent)

Modules: `sim/basemap.js` (every section but "the stores on the map", "raiders stealing" and "after the fight"),
`sim/buildings.js`, `sim/interior.js` only if a constant is needed, `sim/combat.js` only for a new `CELL` kind,
`ui/isoview.js` only for drawing a new cell kind. Tests: `tools/basebuildtest.js` (new) and `tools/basemaptest.js` (keep
it passing; fix its expectations where the margin changes them).

1. `NO_BUILD = 5` exported; `placeProblemAt` refuses the margin for every item; `autoLayout` respects it; the view marks it.
2. General buildings and fittings in `BUILDINGS` and `FOOT` as above; `count()` honours `as`; `baseBeds` counts bunks.
   `placeProblem` / `canBuild` for a fitting: "Needs a building to stand in (a hut, cabin, lodge, hall or barn)" when the
   base has no standing general building with room for it. `canBuild` for a general building: its `size`.
3. Placement: `occupancy` puts a general building's indoor cells in `occ.floor` (cell → host item key) instead of
   `occ.foot`; a fitting or an indoor prop may stand on `occ.floor` cells of one host (a fitting must; an indoor prop may
   also stand outside); anything else on a floor cell is "On top of a building". Never on the cell inside a door
   (`inn`, the counterpart of `out`), never over the host's door or wall cells. `placeItem` sets `rec.host` for a fitting
   (or clears it for an indoor prop outside). Moving a general building moves the fittings and indoor props inside it by
   the same offset and turn-free (if a turn makes one not fit, that one is unplaced). Demolishing a general building
   demolishes its fittings with it (their refunds too); a fitting with no standing host is unplaced and off the map.
   The auto layout places fittings inside general buildings with room (nearest the middle first) and leaves them off
   the map when none has room (they still count by the numbers).
4. Doorways: `neighboursOf(state, base, key)` → the house items touching this one, each with the shared run;
   `canLink(state, base, a, b)` → "" or why; `linkBuildings` / `unlinkBuildings`; `linksOf(state, base)` → the live links
   with their two door cells (stale ones dropped). `buildBaseMap` lays them (both cells `bdoor`, in `F.doors`, in each
   building's `doors` so `settleBaseBattle` wears them). `carryPlacement(from, to, base)` rewrites link keys.
5. The view: `viewBattle` keeps no units at all (survivors do not show). The layout record `b.layout` grows:
   `sel` (a selected placed item's key, for the panel), `pickType` (a building type to build, not yet queued).
   `layoutAct` takes, besides the old commands: `select {key}`, `pickType {bt}` (ghost from `FOOT[bt]`; `ghostAt` handles
   it), `build {x, y}` (queue `L.pickType` with `queueBuild`, place the new job at the ghost; if placing fails,
   `cancelBuild` the job and return why; a fitting is queued only onto a host with room), `link {a, b}`,
   `unlink {a, b}`, `demolish {key}` (a standing building: `demolish`; a queued one: `cancelBuild`).
   `buildMenu(state, base)` → `[{ type, name, group, w, h, cost, hours, ok, why, desc }]` for every type with a footprint
   and every fitting, groups "General buildings", "Fittings", "Buildings", "Yard things", "Defences".
6. `buildBaseMap`: every entry of `F.stores` carries `key` (`"core"` for the base itself, `b:<id>` for a building or a
   fitting with storage); the core gets a "Yard pile" part (a 1 × 1 crate, `key: "yard"`, `store: 0`) so `F.stores` has a
   `"yard"` entry; every entry of `F.vehicles` carries `vid` (it does: `id`) and the fort record is otherwise unchanged.
   Shelves and lockers lay as store containers like the crates do (`STORES` weights: shelves 1, lockers 1).

## Part B: containers and stealing (owner: the storage agent)

Modules: `sim/containers.js` (new), the sections "the stores on the map", "raiders stealing" and "after the fight" of
`sim/basemap.js`, `sim/fort.js` line that calls `makeStores`, `sim/conflicts.js` where `applyStolen` is applied. Tests:
`tools/containerstest.js` (new); `tools/basemaptest.js` and `tools/raidloottest.js` keep passing.

1. `containersOf(state, base)` → `[{ key, label, kind: "core" | "store" | "vehicle" | "yard", cap, bid, vid, foodOk,
   gear: [{ item, ai }], sup: { k: q }, kg, free }]`, after `normalizeBins(base)` (bins clamped to the stock, bins and
   `item.store` of containers that are gone dropped). Building containers come from standing, unbroken buildings of the
   storage types (above) whether or not they are placed on the map; cars from `carsAtBase`.
2. `putItem(state, base, item, key)` and `putSupply(state, base, k, qty, toKey, fromKey = null)` → "" or why ("No room
   in …", "Not here"); `unassign…` by `key: null`. `autoStore(state, base, { all = false })`: unassigned goods (all of
   them with `all`) into containers with room: food to `foodOk` containers (cellar, cold store, freezer, storehouse,
   crates, shelves), gear to lockers, then the storehouse, then the core; dear things (meds, parts, ammo, electronics,
   guns) to the core and the storehouse first; never into a car unless the player put it there; deterministic.
   `storageSummary(state, base)` → `{ cap, used, yard, byKey }` in kg (cap without the yard).
3. `makeStores(state, base, F, rng)` (keep the name and the return shape `{ containers: [...] }`, each container with
   `key`, `id`, `label`, `x`, `y`, `w`, `h`, `sup`, `gear: [{ ai, name, kg }]`, `kg`): the assignments decide where
   goods are; unassigned goods are spread as before but only into containers with room (the yard takes the rest);
   a parked car on the map (`F.vehicles`) is a container at its rect when goods are assigned to it; the yard's goods sit
   in the `"yard"` store (else the core). `thiefTurn` / `takeLoot` work on the containers as they are (cars included).
4. `applyStolen` also takes the stolen supplies out of the bins of the containers they were in (the map container's
   `key`) and drops the stolen items' assignments. `settleBaseBattle` unchanged but for cars that were looted.
5. Hooks: `autoStore` daily for AI groups' bases (where their daily works run: `groupworks.js` or `factions.js`, one
   call per base object) and exported for the autopilot (Part D calls it). A player base without the autopilot is
   tidied only at fight time (the spread), as today.

## Part C: the interface (second wave, after A and B)

`ui/basemap.js`: the layout panel's Build section (from `buildMenu`: groups, cost chips, why not; picking a type puts a
ghost; a click builds), the selected thing's card (`sel`: its fittings, its neighbours with Open a doorway / Close it,
Move, Demolish), the no-build margin tinted on the map (`c.nb`), the Base map tab's text. The Construction tab's
Defenses pane and Buildings pane get "Build on the map" buttons. A **Storage** tab in the base window (`ui/ui.js`
BASE_TABS, `ui/storage…`): every container with its capacity bar and contents, move an item or N of a supply to another
container, Tidy up (`autoStore` all), the yard's exposed goods warned about, the cars parked here as containers, and
a survivor's inventory window's storage box with a container picker (an item dropped into the armory lands in the
picked container: `putItem`). Survivors never appear on the map view.

## Part D: the autopilot, the AI and the docs (second wave)

`sim/autopilot.js`: `autoStore` daily per base; wishes for a general building and bunks when beds are short and the
building plots are used up, for shelves when `storageSummary` shows the yard holding goods or the containers over
80% full, and a stove when there is no cook fire; the defences wished for already stay. The AI groups' bases: the same
`autoStore`. Docs: `docs/agents/features.md` (the base map entry, a new "Base building" entry, the Storage tab),
`docs/adr/0002-base-building.md`, README test lines for the new tests.

## Part E: repair orders (the user's second request, 2026-10-19; owner: the repairs agent)

"To repair buildings, walls and other placed things in the base a builder can be ordered to repair different things.
A list of most damaged to least damaged will show to select to repair, showing time and cost."

Today (`sim/breakdowns.js`, `ui/explore.js repairsTab`) only a broken fixture, or a damaged one at 60+ wear ("Patch"),
can be worked on, by the best free mechanic, and only building types in `FIXTURES` wear at all. The change:
1. Every placed thing wears and can be repaired: `FIXTURES` gets raid-only entries (hours, cost, `what`) for every
   building type with a footprint that has none yet (the hospitals, greenhouse, general buildings `gen_*`, the fittings
   `bunks` / `shelves` / `lockers` / `stove`, spike pits, trench, sandbag positions, barbed and concertina wire, guard
   towers, minefield, crates, cook fire, boiler, water barrels, the jails, the kitchen's canteen is there already…),
   costs in proportion to the building's own cost (about a third of its scrap, a part where it took parts).
2. A repair order (`orderRepair(state, base, fxId, whoId)`): any fixture with wear above `WEAR.repairWear` can be
   ordered repaired, not only a broken one. `repairPlan(…, "repair")` prices a partial repair by the wear to take off:
   hours and cost × (wear − repairWear) / (breakAt − repairWear), at least 1 hour and 1 scrap; a broken fixture costs
   the full job as now. The worker: anyone here with the job's minimum Mechanics, **builders first** (role "build"),
   then the best mechanic; the player picks another from the list. The repair hour and `fixed()` are unchanged in
   effect (wear back to repairWear).
3. `repairList(state, base)` → the fixtures sorted most damaged to least (broken first, then by wear), each with
   `{ fx, name, wear, state, job, plan (who, hours, cost, ok, why), rig }`; the Repairs tab shows that list as the main
   table: name, wear bar, state, "Repair: <who>, <h>h, <cost>" button (disabled with the reason), Jury-rig for the broken,
   a who-picker, Cancel on a running job, and Repair all for everything above 60 as it is now. Keep `rp-start`,
   `rp-who`, `rp-cancel`, `rp-all` working; add `rp-order` if a new action is needed.
4. Autopilot and stewards (`autoHands`): besides what they start now, order a repair on anything over 50 wear when the
   base keeps 20 scrap after it, builders first.

## Part F: a way in and out (the user's third request, 2026-10-19; owner: the paths agent)

"When building the base there needs to be at least a 1 × 4 tiles you can walk through from in the base to out of the
base and from out of the base to into the base. Gates count. You can have a circle of buildings as long as one of the
doors lets you in to the base to access all other buildings; otherwise you cannot place if it breaks these rules."

The rule (`PATH = { WIDTH: 1 }`; read as: a walkable path at least one cell wide must join the outside of the base to
everything in it; the "4" is the band's two cells plus a gate's depth, which a gate already gives): on the base's map
as it would be built (`buildBaseMap`'s cells: open ground, fields, trenches, pits and wire walk; walls, windows,
fences, props, crates, barricades, parked cars and the wall ring do not; doors, doorway links and the gates do), every
placed thing must be reachable on foot from the grid's edge (the no-build margin is always open ground):
- a house-kind building (the core's house too): one of its door cells is reachable (through another building's door
  and a doorway link counts: the walk goes through buildings' floors);
- a fitting: a floor cell next to it is reachable (so its host's door must be);
- anything else (a prop, a crate, a defence, a crop plot, a car, the core's fire): a walkable cell next to its footprint
  is reachable.
`reachProblem(state, base, it, at, occ)` → "" or why ("Nothing could walk to it from outside the base: leave a way in
(a path at least one cell wide, a door or a gate)" / "That would shut off <label>: no way to walk to it from outside
the base"). It is a separate, dearer check (a flood fill from the edge over the whole grid) that callers run after
`placeProblemAt` passes: `placeItem`, `layoutAct` put / build, `ghostAt` (the hover's reason), and `autoLayout` on the
candidate spots it picked (up to its three nearest, else the thing is left off the map). A walled base's band blocks
but for the gate cells (the same cells `buildBaseMap` makes: the two middle cells of each side); the walkway inside the
ring walks. The check uses what is placed by hand, the core, the band and (in autoLayout) what the layout has taken so
far: things the game places re-flow after a hand placement and are re-validated then.

Part F and the wall pieces (claude/kind-hawking-a4gby2, merged at integration): wall pieces block, gate pieces and
stands walk. A wall piece that would close a ring with no gate in it is refused, by hand and by autoLayout, with
"Needs a gate in the wall first: the wall would shut everything inside off from the outside" (the user's rule: a way in
and out on foot always, gates counting).
