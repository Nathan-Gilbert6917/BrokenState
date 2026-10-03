# Review: base and survivor systems (phase 1, find only)

Scope: `src/sim/world.js, economy.js, buildings.js, crafting.js, medical.js, inventory.js, data.js, appearance.js, rng.js` plus the `main.js` / `ui.js` handlers that call them. Stopped early (usage limit); see "Not covered" at the end. Nothing under `prototype/` was changed. Scratch scripts are in `%TEMP%\claude\...\scratchpad\review\base\` (`lib.mjs, det.mjs, inv.mjs, life.mjs, econ.mjs, build.mjs, med.mjs, craft.mjs, invfuzz.mjs, lootfuzz.mjs, misc.mjs, nan.mjs, nan2.mjs, negfood.mjs, pop.mjs, newrun.mjs, datacheck.mjs`).

"reproduced" = script output; "by reading" = not run.

## Findings (most severe first)

**[B-1] BUG · critical · The game never ends when the last living person deserts or changes sides**
where: `economy.js:104-108` (desertion), `conflicts.js:1287-1292` (captive recruited), `world.js:243` (the only game-over check, inside `killSurvivor`).
Both paths set `s.alive = false; s.left = true` without the game-over check. Reproduced (`life.mjs`): leaderless hub, four people desert by day 24, `alive 0, gameOver false`; ten more days tick with nobody alive. Second repro: a non-leader captive as the last person is recruited by captors on day 34, `gameOver false`. Desertion skips the leader, so it needs a colony with no living leader, which B-2 produces in normal play.
fix: one `checkGameOver(state)` helper called from `killSurvivor`, both `left = true` branches, and once at the end of `tickHour`.

**[B-2] BUG · major · "The leader is dead" card offers dead people, and only the first six alive**
where: `world.js:225-241` (choices built from `alive(state).slice(0, 6)` when the leader dies; never re-checked).
Reproduced: a night of hunger kills the leader and the next person in the same loop; the card still lists the dead one ("Ana Brooks (Leadership 7)"). Picking her gives `living leaders 0, dead leaders 1`; nobody is protected from desertion and there is no leader mood bonus. The autopilot picks by the Leadership number in the label, so it can pick a dead candidate too (`autopilot.js:259-262`, by reading). Also reproduced: with 12 alive the Leadership-20 survivor was not among the 6 choices (list is in creation order; the sorted `next` is only used as a yes/no).
fix: build choices from the top 6 by Leadership; give each `disabled: () => !c.alive`; in `resolve`, if the pick is dead fall back to the best living survivor.

**[B-3] BUG · major · An outpost with no land route to the hub empties the hub's food every night and ships its surplus into nothing**
where: `economy.js:129-132` (`supplyLine` returns strength 0 with no path), `economy.js:151-160` and `166-171` (`need / line.strength` = Infinity; `surplus * 0`).
Reproduced (`econ.mjs`, seed 1: 40 of 2589 land tiles cannot be walked to from the hub; boats exist to reach them): outpost on such a tile, 2 staff, 0 food. One night: hub food 300 → 0, outpost food still 0, staff hurt, outpost scrap 40 → 5 with the hub gaining nothing.
fix: when `line.strength <= 0` skip both the food transfer and the surplus shipping (outpost keeps its stock, log "cut off").

**[B-4] BUG · major (cross-area: events.js / parties.js) · A stale "Use a spare part" choice makes a team's parts NaN, and the team's return wipes that stock at the hub**
where: `events.js:296` (`disabled: parts < 1` fixed at card creation; `else p.supplies.parts -= 1` on an undefined key), `parties.js:824-825` (`Math.max(0, Math.floor(NaN))` is NaN; the next line's `(NaN || 0)` resets the stock to 0). Same hole at `parties.js:554` (outpost founding).
Reproduced (`nan.mjs`, `nan2.mjs`, seed 1, aggressive governor, day 225): two Breakdown cards in one hour, one part carried; second resolve sets `supplies.parts = NaN`; when the team got home hub parts went 204 → 0. In manual play the planner always sends a `parts: 0` key, so the result is −1 parts and a free repair instead (by reading).
fix: in the card, re-check at resolve and use a shared take-from-cargo-then-supplies helper; in `returnHome` / outpost founding add only `Number.isFinite(v) && v > 0` amounts.

**[B-5] BUG · major · Gear of anyone who dies at a base goes to a death site on the base's own tile, cannot be recovered, and is "looted" from inside the walls**
where: `world.js:209-217` (hunger, infected wounds, base scavenging accidents, raids, horde attacks all pass `base.tile`), `ui.js:215` (`tileActions` returns nothing for base tiles, so no Recover mission), `economy.js:211-233`.
Reproduced (`life.mjs`): operator dies at the hub with a knife, pack and pocket knife; armory +0; death site on the hub tile; log "Someone looted Nadia's Kitchen knife from the bodies at Dunmore" on days 6, 8, 10; nearest group "seen carrying" all three. Tactical base defenses are fine (Take all goes to the armory); auto-resolved ones are not.
fix: in `killSurvivor`, if the survivor is at a base and `tileId` is that base's tile, push their items into `base.armory` and create no site.

**[B-6] BUG · major · Recruits skip every bed and food check; population reaches 105–113 in 64 beds**
where: `conflicts.js:179-187` (`newRecruit`, called from 6 outcomes with no choice offered), `economy.js:122` (stranger), `factions.js:285-297` (refugees), `events.js:164-165` (loner).
Reproduced (`pop.mjs`, 240 days): aggressive governor seed 1: 105 alive in 64 beds, 36 joined after road fights with no choice, a base overcrowded on 148/240 nights, 1 desertion; seed 11: 111 alive, 48 forced joins. simtest seed 42: 30 people in 10 beds, 0 desertions. Forced joiners also eat a team's trip rations sized for the original crew (by reading).
fix: turn fight recruits into a card choice ("take them along / point them to the hub / part ways") showing beds and food; show beds on the stranger and refugee cards.

**[B-7] SUGGESTION · major · Overcrowding is all-or-nothing and a leader with Leadership 14+ cancels it completely**
where: `economy.js:92-101` (+1 fed, −3 for everyone if even one person over, + 0.15 × Leadership).
Reproduced: 16 people in 10 beds, fed: mood −2.00/day at Leadership 0, −0.80 at 8, +0.10 at 14, +1.00 at 20. Seed 4 (Leadership 1) lost 23 people to desertion in 240 days; seed 42 (Leadership 16) lost none at 3× capacity. Rest gives +6/day, so resting a third of the base also cancels it. Mood does nothing else.
choice: scale the penalty with how far over capacity the base is (and cap the leader bonus below it). In play, one extra person would be a small drag and a doubled base a real crisis, regardless of who leads.

**[B-8] BUG · major · A lost outpost leaves its parked vehicles as unreachable ghosts**
where: `hordes.js:70-73`, `factions.js:222-226` (base removed; `v.loc` still `{kind:"base", baseId}`).
Reproduced (`econ.mjs` B7): outpost overrun, sedan still in `state.vehicles` with `loc.baseId` of the missing base, listed at no base, no marker. The Vehicles tab would print "parked at " with an empty name (`ui.js:853`, by reading). Refugees also arrive at the hub still holding the lost base's station id until the next nightly `assignStations`.
fix: one `removeBase(state, base)` that turns parked vehicles into abandoned vehicles on that tile, clears `station`, and is used by both callers.

**[B-9] BUG · minor · Wear after a fight hits whatever is in the slots when the battle is closed, and everyone at a base**
where: `combat.js:69-72` (`wearAfterFight(state, combatants(...))` runs after looting), `combat.js:43-51`, `crafting.js:181-187`.
Reproduced (`craft.mjs`, `lootfuzz.mjs`): a spiked bat taken from a body and equipped on the loot screen ended 9/10; the machete that did the fighting, moved to cargo before closing, stayed 12/12. Over 160 looted battles, 18 of 18 looted-and-worn makeshift pieces lost a use. Base defense: 8 took the field, pipe spears wore on all 14 people carrying one.
fix: record the item objects on the fielded units at battle start (`playerUnit` already keeps `item`) and wear exactly those.

**[B-10] SUGGESTION · major · A staffed hospital takes every hurt worker off the job until 100 health, and upgrading can switch the hospital off**
where: `medical.js:81-84` (`patients` admits anyone below 100), `medical.js:61-73` (too few medics = tier 0).
Reproduced: (a) infirmary with two farmers at 60 health: both in bed, farm output 0.0/day, forecast −6, for about 4 days; a builder at 98 stops for 5 hours. (b) Field hospital with 1 medic upgraded to a Clinic (needs 2): `staffed false, tier 0`, patients in bed 2 → 0, a severe patient's healing 21.1 → 4.2/day; the log only says "Clinic finished".
choice: admit below a threshold (e.g. 70) or add a discharge toggle; let an understaffed hospital run as the highest tier its medics can cover, and log a warning when an upgrade completes understaffed.

**[B-11] BUG · minor · Card costs and `disabled` flags are frozen when the card is made; stock goes negative**
where: `economy.js:122` (stranger: no check at all), `factions.js:361-377` (tribute), `factions.js:335-337` (40 ammo).
Reproduced: "Let them in (costs 5 food now)" with 2 food → −3; in 240-day simtest runs hub food was negative for 48–144 hours on 5 of 7 seeds and the top bar would show "Food −5" (`n0` floors). Tribute card made at 100 food / 100 ammo, resolved at 5 / 10 → food −25, ammo −20. Refugees are the opposite: "−10 food" is clamped at 0, so free when broke.
fix: make `disabled` a function of current state on these cards and clamp or recompute the cost in `resolve`.

**[B-12] BUG · minor · The Clinic's "+1 meds" applies with no medics**
where: `buildings.js:83` (`hospitalCraft` reads buildings, not `activeHospital`).
Reproduced: med station 1/day with no hospital, 2/day with an unstaffed clinic (0 medics, running tier 0). README says an unstaffed hospital "works like no hospital".
fix: pass the active hospital's `craft` value into `recipeOutput`.

**[B-13] BUG · minor · Armor reduces hunger, thirst and infection damage**
where: `world.js:192-197` (`hurt` always applies Tough and `armorMult`), callers `economy.js:88,159`, `parties.js:334,339`, `medical.js:110,117`.
Reproduced: the same 6-point hunger hit costs a plain survivor 6.00 and a Tough survivor in plate, helmet and arm guards 3.02.
fix: add a `{ raw: true }` option to `hurt` for non-combat causes.

**[B-14] BUG · minor · Trade-route escorts between trips never heal, cannot be treated and do not eat**
where: `location.kind === "route"` is outside `atBase` (`world.js:155`), `medical.js:245-254`, `ui.js:622-636`.
Reproduced: escort waiting 6 days at 30 health with an infected wound and 20 meds at the hub: health 30, still infected, "cannot be treated from here"; the hub fed 5 mouths, not 6.
fix: treat waiting escorts as hub residents for eating, healing and treatment (only skip their role work).

**[B-15] BUG · minor · Cancelling a build refunds half even when untouched, and 0 of a 1-unit cost; the message is printed even if nothing was cancelled**
where: `buildings.js:152-157`, `main.js:234`. Crafting refunds everything for an untouched job (`crafting.js:105-113`) and its comment says "like construction".
Reproduced: ammo bench paid 15 scrap + 1 part, cancelled at 0 progress: 7 scrap, 0 parts back. Cancel of a missing job id changes nothing but the UI says "Cancelled. Half the materials were returned."
fix: same rule as crafting (full if `progress <= 0`), `Math.ceil` for the half, return a message from `cancelBuild`.

**[B-16] BUG · minor · Condition on armor does nothing**
where: `inventory.js:86-92` (`armorPower` ignores `quality`), shown by `crafting.js:141` and the item tiles.
Reproduced: scrap plate vest at 60% and 100%: armor 1.8, damage ×0.892, same durability. Weapons do use it (bat 4.15 vs 4.75 power).
fix: scale armor power or starting durability by quality, or stop showing condition on armor.

**[B-17] BUG · minor · Trait and recipe texts that do not match the code**
where: `data.js:138-149`, `crafting.js:50-59`.
By reading (grep): Greedy ("Finds more loot, sometimes pockets some") is used nowhere. Night Owl ("+2 stealth at night") is only +15% spot-first chance at night (`conflicts.js:313`). Brave/Coward say ±2 to combat checks; code is ±1 power and ±5 aim. Reproduced: recipe lines read "Improvised backpack: backpack, power 1", "Charcoal water filter: tool, power 1", "Bandage and splint kit: tool, power 1" (tool `power` is read by nothing; the real effects are not listed). Build gate reason prints the raw key ("Needs a mechanics 4+ survivor here"). Enemy leftovers are named "Red Hand raiders's dead" / "the dead's dead" (`inventory.js:449`).
fix: implement or remove Greedy; rewrite the three trait lines; in `craftOutputText` print slots/carry, water per day, Medicine or Scavenging bonus instead of power for tools and packs.

**[B-18] BUG · minor · "Edited colonists are kept" re-rolls their traits, and unspent skill points are lost, when the seed or group count changes**
where: `world.js:125-135` (`applyCrew` carries name, skills, look, leader only), `newgame.js:40-44` (budget keyed by survivor id; ids change on rebuild).
Reproduced: seed 42 traits "badback | lucky | medic | …" become "badback+lucky | greedy | loud | …" on seed 43 with the same crew, and differ again with 9 groups on the same seed. Took 3 points out of Shooting (3 left), changed the seed: screen shows "Points left 0 / 66".
fix: include `traits` and the budget in `crewSnapshot` / `applyCrew`.

**[B-19] SUGGESTION · minor · Water has no use at a base; the hub cap silently deletes anything over 80; the water filter is a trap**
where: `economy.js:70` (`Math.min(80, water + 14)` every night, hub only), no water consumption anywhere in `baseDaily`, `crafting.js:207-229`.
Reproduced: hub water 140 with two filters: 140 → 86 → 86 → 86 while the filters wear 20 → 16. Six people for three days from 10 water: 10 → 24 → 38 → 52. Outposts keep no water reserve (`economy.js:163`), so theirs is shipped to the hub and clamped.
choice: make people drink 1 a day (the well then matters and filters are worth building at outposts), or drop the filter. Either way only cap the well's own contribution.

**[B-20] SUGGESTION · minor · Treatment is instant and unlimited, the nightly auto-dose cannot be turned off, and it goes in list order**
where: `medical.js:176-190`, `medical.js:128-133`.
Reproduced: 5 → 100 health in zero game time with 7 meds (no hospital), 3 (clinic), 2 (trauma hospital). Two people at 60 health ate the 2 meds saved for an infirmary overnight ("Needs 2 meds" next morning). With 3 meds and health 69, 69, 69, 12 the survivor at 12 got nothing. In a clinic bed with 1 med the auto-dose takes it and the infected wound is not cleaned. Hubs end long runs with 40–1300 meds, so wounds are never a problem.
choice: one treatment per person per day (or a few hours of medic time each), worst-off first, and a per-base "keep N meds" setting.

**[B-21] BUG · minor · Farm slots go to whoever is first in the list, not the best farmers**
where: `economy.js:36-41`.
Reproduced: 6 farmers on 4 slots with the Farming-20 survivor listed last: 14.09 food/day; best-first would give 16.28 (the expert produces 1.79 instead of 5.98). New recruits are always last.
fix: sort farmers by Farming before applying the slot cut-off.

**[B-22] BUG · minor (cross-area: events.js) · Mood can go below 0**
where: `events.js:237`, `events.js:251` (`a.mood -= 10`, `c.mood -= 15`, no floor).
Reproduced: seed 12345, day 99, "Tempers flare → Step in": mood 7.8 → −2.2 for two people; out of range for 117 hours.
fix: `Math.max(0, …)`.

**[B-23] BUG · minor · Items are pushed into a full cargo by several paths**
where: `crafting.js:277-278` (field craft), `events.js:215`, `parties.js:578` (recover), `scavenge.js:224`, `conflicts.js` loot pushes.
Reproduced for field crafting: load 30 → 36 of 30. Others by reading. `moveItem` itself never overfills (see tested list). Nothing trims the cargo when a pack carrier dies: 49 of 160 loot screens opened already over capacity.
fix: one `addGearToCargo(state, p, item)` that checks room and reports what was left behind.

**[B-24] BUG · minor · Idle "Operate" people add Heat; assigning a station changes the role of someone away on a trip**
where: `hordes.js:9-13` (counts role, not a running station), `main.js:444`.
Reproduced: six people on Operate with one station: Heat 27 (12 with normal roles). Operator out on a trip, another person assigned in the Workshops tab: the absent one's role becomes "rest". Guards in hospital beds still count ×1.5 for defense.
fix: count `stationOperator` hits for Heat; in `stationop` only touch people at that base.

**[B-25] BUG · minor · People-tab Treat works on teams you have no contact with, instantly**
where: `ui.js:629-634`, `main.js:233`. The team panel's Treat is a 1-hour order (`orders.js:185-190`).
Reproduced: team on the road, `radioLive false`: `fieldTreat` healed 40 → 56 at once. The People tab also shows live health of out-of-contact teams.
fix: gate the button on `contactable(p)` and route it through the timed order.

**[B-26] SUGGESTION · minor · Deserters walk off with everything they carry, unannounced**
where: `economy.js:104-108`.
Reproduced: deserter kept the assault rifle and plate carrier (armory +0); the log does not mention it.
choice: they take a weapon and leave the rest in the armory, or the log names what went missing.

**[B-27] BUG · minor · Surgical kit and bandage kit behave differently in the field, in battle and at a base**
where: `medical.js:207` (surgical kit +3, only from Medicine 3), `combat.js:496` (+6 for anyone; bandage kit +2 with no wear), `medical.js:162-167` (no kit counts at a base).
Reproduced for the field numbers (+9 at Medicine 2, +12 at 3); battle side by reading. README says each treatment uses a point of the bandage kit.
fix: one `medKitBonus(s)` used by all three, with wear in battle.

**[B-28] SUGGESTION · minor · When only captives are left the game runs on with nobody to control; a captive leader cannot be replaced**
where: `world.js:243` counts captives as alive; `pickleader` exists only on the new-run screen.
Reproduced: all free survivors dead, one captive: `gameOver false`; the clock ran 42 hours with an empty hub until a friendly group released them. With hostile captors escape is about 0.5–2% a day.
choice: a "last hope" card (wait / give up), and an in-game way to appoint an acting leader.

**[B-29] BUG · minor · Duplicate names**
where: `world.js:110`, `main.js:478` (rename only rejects an empty string).
Reproduced: over 300 seeds the starting six share a first name in 98 worlds (33%) and a full name in 5; messages use first names only ("Grace, Hana, Grace" appeared in a team log line).
fix: reuse `randomName(rng, taken)` with first names taken into account; reject duplicate renames.

**[B-30] Smaller items, one line each**
- `vehicles.js:65-71`: refuel message prints "Added 12.600000000000001 fuel" (reproduced).
- `world.js:32`: `nextId` is module-level, so ids keep counting across New campaign; `main.js:310` uses `Date.now()` as a route id. No effect on results (see determinism).
- `buildings.js:164-175`: progress past a job's end is dropped (6 plots took 12h instead of 10.4h); `req` is checked only when queued; Lucky +1 passes a skill gate one point short (all reproduced; probably acceptable).
- `economy.js:163`: an outpost with nothing queued keeps 5 scrap, so it can never save up for its first building from its own scavenging (reproduced: 30 with a job queued, 5 without).
- `economy.js:77`: a patient on the Rest role gets +3 mood, a healthy rester +6 (reproduced 46.6 vs 49.6).
- `ui.js:398`: planner "Carry space" ignores packs (by reading).
- `parties.js:860`: a wiped team's cargo gear is listed without the item object, so recovery returns a fresh full-condition copy and loses pack contents (by reading).
- `events.js:252`: a solo coward sent home empties the party; it is then removed without `wipeParty`, leaving its vehicle pointing at a missing party (by reading, unverified).
- Workshops and Construction tabs list bed patients as farmers / builders with no "in bed" hint (`ui.js:717-725, 752`).

## What I tested

- Baseline: `simtest 60 42 8`, `medtest 30 42` (77 pass), `crafttest 30 42` (122 pass), `invtest 20 11` (74 pass).
- Determinism: seeds 42, 12345, 7, 99, 2024, each built and played 60 days twice in one process: identical world and end state once ids are normalised. `tools/simtest.js 60` twice for seeds 42 and 7: identical output. `Math.random` in sim code only in `appearance.freshRng` (UI randomizers); no `Date`.
- Hourly invariants (stocks finite and ≥ 0, health and mood in range, locations valid, one living leader, station/role consistency, building max and hospital count, queue entries, armory items, vehicle locations, item uniqueness): 240 days × seeds 1, 2, 3, 4, 5, 42, 12345 (simtest player); 300 days × the same 7 with newcomers turned away; 240 days × seeds 1–8 with random card choices; 240 days under the governor: balanced × 5 seeds, aggressive × 5, cautious × 3. Only violations: negative hub food (B-11), negative mood (B-22), NaN parts (B-4). No crashes.
- Inventory fuzz: 30 rounds × 4000 steps × 2 seeds plus 12 × 6000 (about 120,000 moves that changed something: `moveItem`, `quickMove`, `toStorage`, the old equip / unequip handlers, near-full cargo), then death, capture and recovery: no item duplicated or lost, slot / pocket / pack rules held, no move pushed a cargo over capacity.
- Loot-screen fuzz: 160 won tactical battles (party and base defense, one fallen teammate each), 60 random loot actions each, closed with and without Take all: bookkeeping between bodies, death sites, cargo and armory was clean.
- Scenario scripts for crew override, names, death, desertion, captives, newcomers, mood, farm slots, water, outposts, stations, construction refunds / limits / hospital chain, healing table for every tier, auto-dose, treatment edge cases (0 meds, 0.9 meds, dead, absent, captive, medic away, unstaffed), field treatment, infected wound to party wipe, crafting queue / quality / wear / field crafting, data-table consistency.

## Not covered

- Browser behaviour of any of this (no dev server by instruction); all UI statements are from reading `ui.js` / `main.js`.
- Supply runs and trade routes beyond the escort check; raids (`createRaid`) and their wear rule; tactical-battle medicine beyond reading one line.
- `ensureInv` migration beyond what `invtest` covers; `appearance.js` look editor; long runs beyond 300 days.
- B-30's coward item and the autopilot leader pick in B-2 are by reading only.
