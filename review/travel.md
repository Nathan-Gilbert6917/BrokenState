# Review: map, travel and teams (phase 1, find only)

Stopped early on the coordinator's instruction (usage limit). Everything marked "reproduced" was run; items marked "by reading" or "unverified" were not. No game files were changed. Scratch scripts are in the session scratchpad under `review/travel/` (`map1.mjs`, `map2.mjs`, `t1`–`t5*.mjs`, `soak.mjs`).

## Findings, most severe first

**[T-1] BUG · critical · An outpost founded across water empties the hub's whole food stock every midnight** (cross-area: economy)
- where: `src/sim/economy.js:154` (`need / line.strength`), `:170` (surplus), `:132` (strength 0 when no land route).
- what: a team boats across a river and founds an outpost on land with no route to the hub. `supplyLine` returns strength 0. When the outpost's food goes negative, `send = min(hub food, need / 0)` takes all hub food and delivers `send * 0`. Reproduced (`t5d.mjs`, seeds 2 and 10): hub food 400 → 0.0 at the first midnight, "Holdout is out of food". Separately the outpost's surplus is "shipped" at strength 0: 55 scrap and 188 ammo vanished in one night (`t5.mjs` D).
- fix: when there is no route, send nothing and ship nothing (skip both blocks if `line.strength <= 0`), and log that the outpost is cut off.

**[T-2] BUG · major · Event cards outlive their team: recruits join a team that no longer exists**
- where: `src/sim/parties.js:307-316` (the team keeps moving and can arrive or get home in the hour a card was created), `:849` (`removeParty` leaves its cards), `src/sim/events.js:164`.
- what: a card created on the last stretch is answered after the team is home, has founded an outpost, or is dead. "A survivor alone → Take them along" then adds a survivor whose location is a removed party: alive, never at a base, never on a team. Reproduced in the soak (seeds 4 and 16: "survivor located in a party that does not exist" for the rest of the run); 50 cards for vanished teams over 6 seeds × 200 days. By reading (unverified): on such a card `injureRandom` can call `wipeParty` on the removed team, dropping its already-banked supplies at a death site and marking its parked vehicle abandoned.
- fix: purge cards with that `partyId` in `removeParty`, and have the `choice` action skip cards whose team is gone; or stop the team's movement for the hour when a card is created.

**[T-3] BUG · major · A team whose last member dies or leaves outside starvation is deleted with its vehicle and cargo; can also crash**
- where: `src/sim/parties.js:285-289` (`removeParty` instead of `wipeParty`), `:526-530` (trade, shot at the gates), `src/sim/events.js:252` (solo coward), `src/sim/supply.js:504` (held convoy starving), by reading also `crossing.js:143-145` and `parties.js:767`.
- what: reproduced (`t1.mjs` A, B and the soak on seeds 1, 3, 6, 9–18): the vehicle stays `loc: {kind:"party"}` for a party that is gone (never at a base, never recoverable), packed supplies and cargo vanish instead of lying at the death site, and a "Done: Trade visit" orders card appears for the dead team ("  wait for your call"). Picking "Trade visit" on that card crashes: `TypeError: Cannot read properties of undefined (reading 'traits')` at `world.js:193` from `parties.js:528` (`rng.pick([])`), soak seeds 12 and 18.
- fix: one helper "team has no living members → `wipeParty`" called after every `hurt` on a member and at the top of `awaitOrders`/`arrive`; in the coward card, if the team is now empty, park the vehicle as abandoned and drop the cargo.

**[T-4] BUG · major · A queue interrupted on the road resumes with the next order at the wrong tile**
- where: `src/sim/orders.js:133-137, 169-173`, `src/sim/parties.js:450-466`, `src/sim/conflicts.js:938, 950`.
- what: the running move is shifted off the queue when it starts, so after "Stop and wait for orders" (after a fight) the card offers "Resume queued orders (1)" and the next order runs where the team stands. Reproduced (`t2.mjs` E): queue move → Build outpost, stopped 7 tiles short, resume founded "Mile 135 Truck stop Outpost" there. Same with a redirect: queued "Scavenge" ran on the redirect tile (`t2.mjs` F).
- fix: when a move is interrupted, put it back at the front of the queue; and store the target tile on queued missions and fail them elsewhere.

**[T-5] BUG · major · Vehicles parked at an outpost that is lost disappear** (cross-area: factions, hordes)
- where: `src/sim/factions.js:222-226`, `src/sim/hordes.js:70-73`.
- what: the base is spliced out, vehicles keep `loc.baseId` of a base that is gone: not listed anywhere, not abandoned, no marker. Reproduced (`t5.mjs` C) and on all 6 soak seeds.
- fix: on losing a base, set its vehicles to `{kind:"abandoned", tile}` and add a marker.

**[T-6] BUG · major · A vehicle left behind with fuel in its tank cannot be restarted**
- where: `src/sim/parties.js:415-418` and `:725-729` (needs 2 carried fuel, ignores `v.fuel`).
- what: reproduced (`t2.mjs` C, `t4.mjs` J): truck left on the shore with 24.6 fuel; the same team boats back and gets "Bring at least 2 fuel" / "The team has no fuel to put in it". The planner packs no cans when the tank covers the trip, so this is the normal case for "leave the vehicle on the shore".
- fix: require `v.fuel + carried fuel >= 2` (or nothing when the tank is not empty).

**[T-7] BUG · major · Camping makes food unnecessary (exploit)**
- where: `src/sim/orders.js:277-283` against `src/sim/parties.js:332-341`; `src/sim/world.js:192-195` (armor and Tough also cut starvation damage).
- what: camp healing (8 + 0.4 × Medicine per day) is applied while starving (14.4 a day before armor). Reproduced (`t4d.mjs`): Medicine 16 with water only, or Tough + plate carrier with Medicine 1, camped 40 days with no food at health 99–100 and mood 100; a plain Medicine-5 survivor lasted 537h.
- fix: no camp healing while the team is out of food or water; apply starvation and thirst without armor.

**[T-8] BUG · major · "Gather materials" is unlimited scrap, and the sim does not check for a shore (exploit)**
- where: `src/sim/orders.js:202-204`, `src/sim/crossing.js:158-172`.
- what: 2–5 scrap (+ terrain and Scavenging) every 3 hours, forever, with no risk and no depletion. Reproduced (`t4.mjs` B): 8 gathers in 24h on plains away from water gave 23 scrap (stopped only by carry space); a base scavenger makes about 1.4 a day. Only the panel hides the button off-shore; a queued gather runs anywhere.
- fix: check `crossingsFrom(tile).length` in `startOrder`, and deplete it (per-tile counter or tile loot).

**[T-9] BUG · major · Packed supplies are not limited by carry space**
- where: `src/sim/parties.js:190-218` (no check), `src/ui/ui.js:398` (planner "Carry space" also ignores backpacks, unlike `carryCapacity`).
- what: reproduced (`t2.mjs` A): one person on foot (carry 15) left with 1051 weight and founded an outpost stocked with 249 food, 500 ammo, 385 scrap. Supply runs do enforce the limit, so expeditions bypass them.
- fix: count packed supplies in the load (launch, panel, boat) or refuse launches over capacity; use `carryCapacity` in the planner.

**[T-10] BUG · major · People who die at your own base leave a death site there, and "someone" loots it** (cross-area)
- where: `src/sim/world.js:209-217`, `src/sim/economy.js:211-233`, `src/ui/ui.js:215`.
- what: reproduced (`t3.mjs` B): gear went to a death site on the hub tile, the armory stayed empty, and within 30 days "Someone looted Owen's 9mm pistol from the bodies at Dunmore". The tile panel offers no missions on a base tile.
- fix: deaths on a tile with one of your bases put the items in that armory.

**[T-11] BUG · minor · Cargo dropped when a vehicle is left behind vanishes without a word**
- where: `src/sim/parties.js:375-385`, callers `:353-358`, `:805-807`, `crossing.js:116`, `scavenge.js:102`.
- what: reproduced (`t2.mjs` D): 60 scrap, 30 food, 3 parts gone when the truck ran dry; no log line, no cache. Gear is never trimmed.
- fix: log what was dropped and leave it with the vehicle (a cache marker).

**[T-12] BUG · minor · Carry limits skipped for gear and trades**
- where: `src/sim/parties.js:578` (recover), `src/sim/scavenge.js:222-224` (extract), `src/sim/trade.js:61-64` (by reading).
- what: reproduced (`t3.mjs` D): recover put 12 items in the cargo, load 36 of 8. Soak: 8–20 teams per 200-day run were over capacity at some point.

**[T-13] BUG · minor · A wiped team's cargo items lose contents, quality and durability**
- where: `src/sim/parties.js:860` (no `item`), `:578` (rebuilt as quality 1).
- what: reproduced (`t3.mjs` C): an assault pack holding a pistol and surgical kit came back empty; a worn crossbow (quality 0.6, 2 uses) came back quality 1 with no `dur`.
- fix: push `item: g` like `killSurvivor` does.

**[T-14] BUG · minor · Markers stay after a team finds nothing there**
- where: `src/sim/parties.js:574`, `:721-724`; `src/sim/markers.js:94-99` (cleared only in live view).
- what: reproduced (`t3.mjs` A): after "Nothing left" and "The vehicle is gone", both markers were still on the map 20 days later and the tile still offers the missions. Soak runs ended with 2–7 stale vehicle and 10–34 stale death markers.
- fix: `spot(... remove: true)` in both branches.

**[T-15] BUG · minor · An outpost can be founded on a bridge**
- where: `src/sim/parties.js:541-547` (no water check; `:407` has one), `src/ui/ui.js:413` (the planner's mission list offers every mission for any tile).
- what: reproduced (`t2.mjs` B, seed 1): "water (14,22) Outpost".

**[T-16] BUG · minor · Editing a supply run changes the convoy already on the road**
- where: `src/sim/supply.js:250`, `:287-289`, `:365-376`.
- what: reproduced (`t5.mjs` A): the log says "Changes apply to the next run", but the convoy on the road disbanded at the destination because the edit set Disband.
- fix: copy `atDest` and `pickup` onto the party at dispatch.

**[T-17] BUG · minor · A boat order queued before the team has a vehicle rafts it for free**
- where: `src/sim/orders.js:207-215`, `src/sim/crossing.js:102-106`.
- what: reproduced (`t4d.mjs` D): queue Recover vehicle → Cross; the truck was rafted for 14 scrap, 0 parts, 4h (a raft costs +14 scrap, +2 parts, +4h).
- fix: re-plan when the vehicle state differs from the order's `mode`.

**[T-18] BUG · minor · Cull card: wrong horde removed, and NaN ammo**
- where: `src/sim/parties.js:763-768`.
- what: reproduced by constructing the state (`t1.mjs` C): if the horde left the list before the card is answered (merge or base attack in the same tick), `splice(indexOf(...) = -1, 1)` removes the last, unrelated horde. With no `ammo` key in the supplies, `ammo -= 0` gives NaN and the hub's ammo becomes NaN on return (`t1c.mjs`); the planner always sets the key, so only tools hit this. By reading, unverified: `events.js:310` leaves size-0 hordes in the list.

**[T-19] BUG · minor · Names**
- where: `src/sim/data.js:165` vs `src/sim/mapgen.js:21`; `src/sim/factions.js:41-43`.
- what: reproduced (`map1.mjs`, 200 seeds): a small town is called "Granite City" on 66 maps; with 9–10 groups two groups share a name ("The Granary Walls II" twice) on 4 of 400 worlds.

**[T-20] BUG · minor · No time estimate for a queued "Return home"**
- where: `src/sim/orders.js:83-108`. Reproduced (`t4.mjs` C): "time varies", which also hides the queue total; the walk was 14h.

**[T-21] BUG · minor · Held convoys drink no water**
- where: `src/sim/supply.js:493-508`, `src/sim/parties.js:291-294`. Reproduced (`t5.mjs` B): 10 days holding at a base with 0 water, no effect. The hub's automatic food line also ignores them, so they starve at a foodless outpost (crew health 82 and 76 after 10 days).

**[T-22] BUG · minor · Empty death sites never go away**
- where: `src/sim/economy.js:222`, `src/sim/world.js:215`. Reproduced (`t3.mjs` E, 60 days); soak runs ended with 22–53 empty sites and their markers.

**[T-23] BUG · minor · Text that does not match behavior**
- `main.js:260` logs "Team ordered home" when `startReturn` did nothing (afloat) or the team is cut off; `orders.js:192-194` likewise (by reading).
- `crossing.js:143-145`: "hauled out bruised" even if the mishap killed them (by reading).
- `orders.js:293` says a garage does better; roadside repair gives +26% at Mechanics 12 and +38% at 20, garage +25% (computed, `t4.mjs` F).
- "Two hours" of recon and event delays are progress points: a rushed team paid 1h, others 2h (`t4.mjs` E).

**[T-24] SUGGESTION · major · Sites cut off by rivers**
- `map1.mjs`/`map2.mjs`, 200 seeds: 60 maps have sites the hub cannot walk to (0.6 per map, up to 6), including the National Guard base on 6 maps and a group's base on about 1%. All are reachable by boat. In play the tile says "No route" with no hint; consider a "needs a boat" note, or a bridge for the military base.

**[T-25] SUGGESTION · major · Teams that stand still are never in danger**
- No events, hordes or conflicts for waiting, camping, gathering or holding teams (`hordes.js:42-52` only checks bases). A boat landed on a tile holding a 60-horde and a hostile base with no card (`t4.mjs` J). Camping in a city next to a nest is safe. A small hourly risk for stationary teams, and an encounter on landing, would fix the feel.

**[T-26] SUGGESTION · minor · Orders without radio contact**
- `orders.js:50`: waiting or working teams can be ordered from anywhere with no radio (`t4.mjs` I), and report their finds each time (`parties.js:463`). The People tab's Treat is instant and needs no contact (`main.js:233`), while the queued Treat takes an hour. Either accept it or require radio for anything but the arrival card.

**[T-27] SUGGESTION · minor · Camp balance**
- Camp heals 8+/day against 4+ at a base and ignores the severe-wound penalty; a team can camp on the hub tile (`t4.mjs` A). "Camp until broken" has no warning card when food runs out; the team died after 165h with only log lines (`t4.mjs` G).

**[T-28] SUGGESTION · minor · Loot never regrows and AI groups never deplete sites** (grep: only `scavenge.js:86, 142` change `tile.loot`). 58 of 200 maps have no grocery store.

**[T-29] SUGGESTION · minor · Latent hazards, by reading**
- `scavenge.js:72`: `state.engagement` is one slot; a second headless search overwrites the first (only the autopilot guards it).
- `parties.js:190-218`: `launchExpedition` does not check that crew are alive, at the hub and not on another team (the planner does).

## What was tested
- `node tools/etatest.js 12` and `node tools/supplytest.js 70`: pass.
- `map1.mjs 200 1`: seeds 1–200, group counts 5–10 (1200 worlds). No site on water/mountain/bridge, no duplicate site names, no road on water without a bridge, 13 towns and 2 cities and a military base on every map, hub always from the first candidate list (fallbacks never used), every group count fully placed.
- `map2.mjs 200 1`: 123 maps have cut-off land (300 regions, median 1 tile); all but two 1-tile regions are reachable by a boat chain; no road site is unreachable by vehicle.
- `soak.mjs`: random player using the UI's calls (planner, team panel, Teams tab, context menu, cards, trade, supply runs), battles and raids played by the game's AI. Seeds 1–6 × 200 days and 7–18 × 250 days: about 5000 launches, 1500 boat orders, 2400 raids, 1500 battles. Never seen: negative or NaN supplies, a team on open water, a survivor on two teams, the same item in two places, a team stuck moving or stuck "engaged".

## Not covered
- The headless search path (soak mode H) was not run; raid enemy counts by danger and loot per site type were not measured; `tools/raidtest.js` and `tools/maptest.js` were not re-run.
- Radio knowledge snapshots and `plannedTile` beyond what etatest checks; trade routes; anything needing the browser.
