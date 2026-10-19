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
4. **Goods stay on the base's books; containers are assignments.** `base.stock` and `base.armory` remain the truth.
   A container (`sim/containers.js`: the core, a storage building or fitting, a parked car, the yard) only says where
   goods are kept: `item.store` on an item, `base.bins[containerKey][supplyKey]` for a supply's split, both clamped to
   the books whenever they are read. Nothing moves in or out of the books by being assigned.
5. **One `autoStore` for every side.** The game tidies unassigned goods into containers with room by one deterministic
   rule (food where it keeps, dear things behind the best door, gear to the lockers, never into a car): daily for the
   autopilot's bases and for the AI groups' bases (ADR 0001: the same code), at fight time for a player base run by
   hand. The yard holds what fits nowhere, and the yard is what a raider finds first.
6. **Raiders take from containers and cars.** The battle map's stores are the containers as they are (`makeStores`),
   a parked car among them when goods were put in it; what a thief carries off the map leaves the books and the bin it
   came from (`applyStolen`). Survivors never appear on the Base map view.
7. **The autopilot builds by the same needs.** Beds short and no plot for a bunkhouse or barracks: bunk beds in a
   general building, or the biggest general building the base can put up; goods past the containers' room: shelves,
   lockers, the storehouse or a building for them; no plot for a cook fire: a wood stove indoors. The defence wishes
   stay as they were; goods lying exposed in the yard are put under a roof before the horde's outer defences, a filling
   store waits behind them.
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
- `tools/basebuildtest.js`, `tools/containerstest.js`, `tools/basebuilduitest.js`, `tools/repairorderstest.js` and
  `tools/basebuildautotest.js` guard the parts.
