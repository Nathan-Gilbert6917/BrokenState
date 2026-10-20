# 0002. The base map is the base (2026-10-19)

## Status

Accepted. The user's requests of 2026-10-19 ("a full base building system … within the base map limits with a 5 tile
margin … general buildings that you can build things inside … a doorway between them … organize the inventories … to
storage containers … raiders can steal these items from the containers or from vehicles … the player and ai autopilot
needs to set up a balanced base with needs and defenses", and "a builder can be ordered to repair different things. A
list of most damaged to least damaged"). Plan and contract between the parts: `docs/base-building/plan.md`.

## Context

A base was a list of buildings on plots (so many building plots and utility plots by its size) and the Base map tab
drew them: every building had a footprint, the player could move it, and a horde or a raid fought over the map. The
map was a picture of the base, not its limit. The base's goods were two flat lists (`base.stock`, `base.armory`) that
the battle map spread over whatever buildings held goods when a raid came, and nothing stood between a raider and
the stores but the wall. Beds, benches and storage were buildings of their own, each on a plot. Only a broken fixture
(or a damaged one past 60 wear) could be repaired, by the best free mechanic, and only the building types in
`FIXTURES` wore at all.

## Decision

1. **The map is the limit.** General buildings (`gen_hut` … `gen_barn`, `BUILDINGS[type].general`) and the fittings
   that stand inside them (`bunks`, `shelves`, `lockers`, `stove`: `fit`) take no plot: they stand where there is room
   on the map, and nowhere else. A fitting stands only on the indoor cells of a standing general building (`occ.floor`,
   `rec.host`); an indoor prop (a bench, a crate, the med station: `FOOT.indoor`) may stand inside or in the yard. The
   plot system stays for everything else.
2. **The no-build margin.** `NO_BUILD = 5`: the five cells nearest every edge of the grid take nothing, by hand or by
   the game (`placeProblemAt`, `autoLayout`), so the attackers always have ground to come from and the map's edge is
   never a wall.
3. **Doorways are links between items.** `base.plan.links = [{ a, b }]` by item key; the doorway is laid when the map
   is built (both wall cells barred doors facing each other), a stale link is dropped when read, and a queued building's
   key is rewritten when it finishes. No cell data is stored.
4. **Goods stay on the base's books; containers are assignments over basestorage's room.** `base.stock` and
   `base.armory` remain the truth. How much room a base has and what lies outside is `sim/basestorage.js`'s (dev's
   base storage limits, merged 2026-10-19): the core by tier (a camp none), every storage building and fitting by
   STORE_KG (shelves 150, lockers 100), a parked car's payload, opened boxes. A container (`sim/containers.js`, keyed
   as storageOf keys them: `core`, `b:<id>`, `v:<id>`) only says where goods are kept: `item.store` on an item,
   `base.bins[containerKey][supplyKey]` for a supply's split, both clamped to the books whenever they are read.
   storageOf fills each container with what is assigned to it first, up to its room; the unassigned goods fill the
   room left by worth a kg; the rest lies outside (weathering, on the map's piles). Nothing moves in or out of the
   books by being assigned. An opened box is room but not a container to assign to (its armory index moves).
5. **One `autoStore` for every side.** The game assigns unassigned goods to containers with room by one deterministic
   rule (the densest by worth a kg first, as the room is filled; food where it keeps, rounds and guns in the armory,
   dear things behind the best door, gear to the lockers, never into a car or a box): daily for the autopilot's bases
   and for the AI groups' bases (ADR 0001: the same code), Tidy up for the player. What fits nowhere lies outside, and
   the piles outside are what a raider goes for first.
6. **Raiders take from containers and cars.** The battle map's stores are the containers as they are (`makeStores`),
   a parked car among them (its room is storage), what lies outside on piles, the armory's locked gun cage and ammo
   lockers; what a thief carries off the map leaves the books and the bin it
   came from (`applyStolen`). Survivors never appear on the Base map view.
7. **The autopilot builds by the same needs.** Beds short and no plot for a bunkhouse or barracks: bunk beds in a
   general building, or the biggest general building the base can put up; goods lying outside: one storage wish
   (basestorage's storageWish): shelves or lockers on a general building's floor, else the smallest storage building
   that holds them, else a general building for them; no plot for a cook fire: a wood stove indoors. The defence
   wishes stay as they were.
8. **Repairs are orders by wear.** Every placed thing has a `FIXTURES` entry and wears from raid damage; a repair can
   be ordered on anything above `WEAR.repairWear` as a partial job priced by the wear to take off, builders first; the
   Repairs tab is that list, most damaged first, with time and cost on every row.

## Consequences

- `canBuild` for a fitting asks the map (`fittingRoom`): the Construction tab and the autopilot see the same "Needs a
  building to stand in". Fittings off the map (no host with room) still count by the numbers (beds, a cook fire) until
  a building with room stands.
- `F.stores` entries carry `key`; readers of the battle map's stores that assumed one container per building type are
  rewritten; `tools/basemaptest.js` and `tools/raidloottest.js` keep their expectations where the margin moved things.
- Old saves load: `base.bins`, `item.store`, `rec.host` and `base.plan.links` read as empty when missing.
- A camp's and a shelter's counts (`CAMP.build`, `SHELTER.build`) gain the general buildings and fittings they may put
  up, so the small bases are bounded by their lists and the big ones by the map.
- Merged with the wall pieces (claude/kind-hawking-a4gby2): the wall is its placed pieces, no ring is drawn. For the
  way in and out a wall piece blocks and a gate or a stand walks; a wall piece that would close a ring with no gate is
  refused ("Needs a gate in the wall first: …"), by hand and by the auto layout, which lays the gates first. The pieces
  have no Repairs rows of their own: one wall row, mended by the wall's repair order (breakdowns.js orderWallRepair).
- Merged with dev's base storage limits (2026-10-19): containers.js's own capacity tables went; the "yard" became
  dev's outside (the piles), the Yard pile part of the core went, a camp's core holds nothing, and `storageSummary`
  is dev's (words); containers.js's numbers are `storageKg`. docs/base-building/plan.md "Merged with dev's base
  storage limits" has the detail.
- `tools/basebuildtest.js`, `tools/containerstest.js`, `tools/basebuilduitest.js`, `tools/repairorderstest.js` and
  `tools/basebuildautotest.js` guard the parts.
