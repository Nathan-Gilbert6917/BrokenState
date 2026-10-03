# Combat and living-world review (phase 1: find, don't fix)

Stopped early on the usage limit. Every finding says **reproduced** (script output) or **by reading** (not run). Scratch scripts and raw outputs are in `%TEMP%\claude\C--Users-nate--OneDrive-Desktop-NGP\4037875a-ac92-4d38-9d09-b947b700d3d6\scratchpad\review\combat\` (`t1`–`t8*.mjs`, `*.txt`). Nothing under `prototype/` was changed.

## Findings, most severe first

**[C-1] BUG · major · Fights against communes, expansionists and traders spawn zombies on the enemy side**
- where: `conflicts.js:39` (`KIND_OF` maps expansionist / traders / commune to `"mixed"`), `combat.js:569` (`"mixed"` alternates raiders and zombies).
- Reproduced (`t3_units.mjs`): "Harvest Fellowship militia" count 5 → shotgun, ZOMBIE, machete, ZOMBIE, pistol. Same for "New Dominion fighters", "Long Haul Co. guards" and rescue guards (`guardsFor`). `defendInPerson` uses the same map, so expansionist raids on your base would too (by reading).
- The zombies fight for the humans. These fights are far easier than intended: 3 vs 4 "mixed" p4.0 is a 98% win, 3 vs 5 raiders p4.3 is 28%.
- Fix: map those three types to `"raiders"` (or give them their own kits) and keep `"mixed"` for humans plus the dead.

**[C-2] SUGGESTION · critical (balance) · Nothing can break into the hub; the holdout never loses**
- where: `factions.js:182` (raid strength = pop × arms × 0.25–0.4, so at most 26), `hordes.js:58` (attack = size × 0.14, so at most 19.6), `factions.js:186` (day-1 hub defence 35–44).
- Reproduced: 25 year-long runs (5 seeds × simtest player, idle player, and all three autopilot styles), plus `autotest 120 all 1–5`: 0 game overs.
- Simtest + idle runs: 161 horde attacks on bases, 0 broke in; 97 raids, 0 broke in, 0 overran. An idle hub that never sends anyone out grows from 6 to 10–20 people with zero deaths in a year.
- In play this means raid warnings and "Pay tribute" are decoration. Options: scale raid strength with the player's defence or day count, let hordes above ~100 use a higher multiplier, or make defence depend on guards only.

**[C-3] SUGGESTION · major · Auto-resolve and tactical give different fights; the card odds are the auto-resolve odds**
- where: `combat.js:79` (`autoResolveCombat`), `conflicts.js:94` (`fightOdds`, shown as "About X% to win").
- Reproduced (`t1_auto_vs_tactical.mjs`, 200 fights per cell, AI on both sides, 3 survivors with guns unless noted):

| Matchup | Auto win | Auto deaths | Tactical win | Tactical deaths | Tactical team wipes |
| --- | --- | --- | --- | --- | --- |
| 12 zombies p2 | 38% | 0.12 | 100% | 0.04 | 0% |
| 12 zombies p3.5 | 20% | 0.17 | 97% | 0.33 | 4% |
| 20 zombies p1 | 58% | 0.10 | 99% | 0.22 | 2% |
| 20 zombies p5 | 7% | 0.16 | 1% | 2.67 | 72% |
| 3 raiders p4.3 | 89% | 0.02 | 93% | 0.33 | 6% |
| 5 raiders p4.3 | 46% | 0.12 | 28% | 1.79 | 31% |
| 5 raiders p4.3, you ambush | 75% | 0.07 | 42% | 1.50 | 23% |
| 4 soldiers p4.8 | 57% | 0.08 | 42% | 1.61 | 28% |
| 6 starters vs 8 raiders p4.3 | 49% | 0.14 | 5% | 4.63 | 22% |

- Auto-resolve never wiped a team in any cell; a tactical defeat kills 65% of the downed (90% against zombies). Under autopilot, 284 auto-resolved fights over five aggressive years cost 4 lives.
- Auto-resolve also counts every person at a base and every enemy, while tactical caps at 8 and 20 (by reading).
- Fix direction: calibrate auto-resolve against the tactical table (zombies worth much less per head, humans more when they outnumber you), and give auto-resolve defeats real losses.

**[C-4] BUG · major · Victory loot is paid twice, and the second payment ignores carry space**
- where: `conflicts.js:1027` (`victoryRewards`: "Taken from the bodies: 15–45 ammo, 2–8 food", 30% a gun), `combat.js:1138` (bodies carry weapon, armour, ammo).
- Reproduced (`t6_browser_flows.mjs` 6a): after looting 5 raider bodies (5 weapons, 23 ammo, 4 food) the after-fight card added "Taken from the bodies: 27 ammo, 4 food".
- In another run the bonus Kevlar vest pushed cargo to 26 of 23 capacity (`p.cargo.gear.push` has no room check).
- Auto-resolved fights get only the card reward and no body loot, so the two modes pay differently.
- Fix: drop the supply and gear part of `victoryRewards` when bodies were looted, or feed it into the bodies; route bonus gear through a room check.

**[C-5] SUGGESTION · major · "Defend in person" is strictly worse than doing nothing**
- where: `conflicts.js:1308` (`defendInPerson`), `factions.js:198` (`resolveRaidOnPlayer`).
- Reproduced (6c, 60 raids per cell, same seed both ways). Strongest possible raider gang (pop 50, 5 raiders) against the 6 starting colonists: in person 95% win with 1.45 deaths per raid; by the numbers 100% repelled with 0 deaths. Pop-25 gang: both 100%, 0 deaths.
- A lost tactical defence is followed by the abstract raid as well (by reading).
- `ambush: base.alert ? "player" : null` cannot be reached in normal flow: Prepare and Defend are choices on the same card (by reading).
- "Prepare defenses" says "+30% from non-guards" but the multiplier goes 0.8 → 1.3 (+62%), it costs nothing, and `base.alert` stays set if the raid never arrives (by reading; cleared only at `factions.js:229`).

**[C-6] SUGGESTION · major · Population snowballs, then crashes by desertion; fights barely kill anyone**
- where: `conflicts.js:179` (`newRecruit`, no bed or food check), `events.js:164` (loner), `economy.js:103` (desertion).
- Reproduced (`t5_autopilot.mjs`, 365 days, seeds 1–5):

| Style | Game overs | End population | Peak | Deaths (5 runs) | Deserted (5 runs) |
| --- | --- | --- | --- | --- | --- |
| Cautious | 0 | 27–43 | 27–43 | 4 | 0 |
| Balanced | 0 | 41–71 | 41–71 | 8 | 0 |
| Aggressive | 0 | 26–95 | 77–120 | 41 | 267 |

- Aggressive: 593 people taken in, 256 of them through conflict rewards that skip the bed check. Beds cap at 48–64, so three of five seeds starve and lose 70–95 people to desertion within about 30 days.
- 45 of the 53 deaths across all styles came from the "Bitten" card (`events.js:114`); only 4 came from fights.
- Hub stock after a year: scrap 5,000–21,000, ammo up to 10,000.

**[C-7] BUG · major · Teams can be left "engaged" forever and starve**
- Reproduced (`t7_conflicts.mjs` 7a): a toll that was affordable when the card appeared but not when chosen returns "You do not have enough." with no resume and no card (`conflicts.js:609`). The team stayed engaged and both members died of thirst within 6 days. Same for the rescue ransom (`:1155`); `buyPrisonersCard` (`:896`) by reading.
- Reachable when an earlier card for the same team spends goods in the same hour (a vehicle enters 2+ tiles per hour; non-conflict cards do not halt the team).
- Reproduced (7f): two trade teams arriving in the same hour. `state.trade` is a single slot (`parties.js:534`), so the first team stays engaged with no screen.
- Out of radio range the Teams tab offers no button for an engaged team (`ui.js:178`).
- Fix: on a failed payment call `resume` or re-add the card; queue trade visits like battles.

**[C-8] BUG · major · A sleeper hit by a crossbow bolt does not wake**
- where: `combat.js:728–729` (only noise alerts) versus `:746` (melee wakes the pod).
- Reproduced (`t3_units.mjs` b): 143 hits that did not kill; the target was still unaware after 120 of them (the other 23 were woken by end-of-turn proximity).
- AI teams ambushing 5 raiders: 3 crossbows 42% win, 3 pistols 18%. A scripted stand-off kept the camp asleep the whole fight in 42% of runs.
- Fix: any hit that leaves the target alive alerts its pod.

**[C-9] BUG · minor · Hordes of size 0 stay on the map**
- where: `events.js:310` (card "Fight": `Math.max(0, …)`, never removed), `parties.js:951` (AI party walks through a horde).
- Reproduced: a size-0 horde was present on 21–23 daily checks over six seed-years (`t8_factions.mjs`), up to 18 days in one run.
- Consequences by reading, not run: it counts toward the cap of 18, 0 × 1.006 never regrows, a team entering the tile gets a "Horde of 0" card, and reaching a base still costs ammo with a 30% chance someone is hurt (`hordes.js:59–64`).
- Fix: remove a horde when size < 5 wherever size is reduced.

**[C-10] SUGGESTION · major · Halved zombie move: what it did and what restores tension**
- Reproduced (`t2_zombie_speed.mjs`, 120 fights per cell; scratch copies of `combat.js` with only the two move constants changed). Win rate for the best three of the starting kit:

| Zombies | New 2/3 | Mid 3/4 | Old 4/5 |
| --- | --- | --- | --- |
| 12 at p1 | 100% | 100% | 93% |
| 20 at p1 | 84% | 58% | 23% |
| 20 at p1, they ambush | 63% | 23% | 8% |
| 12 at p2 | 97% | 86% | 68% |
| 16 at p2 | 76% | 41% | 13% |
| 12 at p3.5 | 91% | 54% | 13% |
| 8 at p5 (fast) | 88% | 38% | 15% |
| 12 at p5 (fast) | 13% | 1% | 0% |

- Road surges use power 1 (`conflicts.js:110`), below the documented 2–10 scale; raid sites use 2 + 3 × infection. Typical surges are 7–15 zombies, so they are a free win now, and were at 12 or fewer before.
- Tension (roughly 60–85% with real losses) sits at 16 at p2, 12 at p3.5, 8 at p5, or 20 at p1 when ambushed. The 20-unit cap means count alone cannot do it for p1.
- Suggest surge power 2 + 3 × infection like raid sites, or the 3/4 move.

**[C-11] BUG · minor · "Infection here will slowly fade" is false; the infection map is static**
- where: `events.js:136`; the only writer is `hordes.js:87` (+0.003 a day within 3 tiles of a nest).
- By reading (grep) and reproduced in curves: hot tiles rise 12–25% in the first ~120 days, then stay flat for the rest of the year in all 5 seeds. Nests are never created, and never die except through this card.

**[C-12] BUG · minor · Game over is not declared when the last survivor leaves instead of dying**
- where: `conflicts.js:1288` (recruited by captors), `economy.js:105` (desertion) set `alive = false` without `killSurvivor`.
- Reproduced (7c): all six captured on day 1, 12 seeds. 1 run ended with nobody alive and `gameOver` false. Median 38 days with nobody free and nothing the player can do.

**[C-13] BUG · minor · Captives are offered as the new leader**
- where: `world.js:232` (`alive(state).slice(0, 6)`). Reproduced (7d): 2 of 5 choices were prisoners. The list is also not sorted by Leadership.

**[C-14] BUG · minor · Surrender to traders or communes takes all cargo gear; the text says a fifth of supplies**
- where: `conflicts.js:248` versus `rob(…, takeGear = true)` at `:255`. Reproduced (7b): assault rifle, plate carrier and pistol taken.

**[C-15] BUG · minor · Wear and kit rules in battle**
- `finishCombat` wears everyone at the base, not the 8 who fought (`combat.js:72`). Reproduced: 12 worn, 4 of them never on the map.
- The bandage kit never loses durability from battle heals (`combat.js:749`). Reproduced: 5 → 5. README says it wears per treatment.
- The surgical kit gives +6 Medicine in battle with Medicine 0, though it needs 10 (`combat.js:496`). Reproduced.

**[C-16] BUG · minor · Auto-resolve ignores ammo in the cargo**
- where: `combat.js:84–85`. Reproduced: 3 packed + 40 found → fights at the 0.6 low-ammo penalty. Tactical uses both pools; the card also shows "low".

**[C-17] BUG · minor · A queued battle whose team is gone still resolves**
- where: `combat.js:56, 75`. Reproduced (6b): the stale setup auto-resolved with no fighters, logged a defeat and still cost the faction population. With zero fighters there is a 5% "victory" (by reading, `:92`). Normal queueing works.

**[C-18] BUG · minor · Collapsed groups leave things behind**
- Tile ownership is stale until the next midnight: reproduced, 38 tiles owned by a dead gang (`collapseFaction`, `factions.js:266`, does not recompute). Stale owners feed patrol cards and block outposts (by reading).
- Parties of dead groups keep travelling: reproduced for convoys (1–2 daily checks). A raid already marching would still resolve against you (by reading, `parties.js:931` has no alive check; not reproduced).

**[C-19] SUGGESTION · major · Half the raiding groups can never reach you**
- where: `factions.js:163–178` (origin is always `bases[0]`; 20 tiles to you, 14 to other groups).
- Reproduced (60 seeds × 8 groups): 47% of raider / expansionist / zealot groups start more than 20 tiles from the hub, 9% can raid nobody, and 5 of 60 worlds have no raider in range. Median base-to-hub distance is 21.
- No hub has a nest within the hordes' 9-tile pull range (60 of 60), so hordes arrive only by random wander: 0–69 attacks a year depending on seed.

**[C-20] SUGGESTION · minor · World trend over a year: saturated and static**
- Reproduced (`t4_world.mjs`, 5 seeds): hordes reach 13–18 by day 30–90 and sit at the cap of 18 on 43–229 days. Spawning resumes whenever one dies (250–420 spawned a year). Total zombies plateau at 1,000–1,700. A 140-size horde exists from about day 60 in every seed.
- Groups either sit at the pop cap of 50 or are ground down by horde strikes (75–123 a year; each "held" strike still costs 0–2 pop): 0–4 of 8 collapse per year. On one seed total group population fell from 187 to 44.
- Merged hordes exceed the 140 cap (up to 218 seen) until the next daily growth step.

**[C-21] BUG · minor · UNVERIFIED (by reading only) · Trade exploits**
- Each trade gives a flat +1 goodwill (`trade.js:67`), so repeated 5-unit trades buy goodwill at several times the gift rate.
- Prices are fixed within a deal and move only after it, so selling a good and buying it back in a second deal is profitable.
- Bought goods are not checked against carry space (`:63`).
- Groups have no `water` stock, so they always pay the top price for it.

**[C-22] BUG · minor · UNVERIFIED (by reading) · Pacts and raid thresholds disagree**
- `launchRaid` ignores `f.pact` and raids at goodwill below −30, while "Hostile" starts at −40. A pact is never revoked, so a hostile group can still be asked to "honour" it at 97%.

**[C-23] BUG · minor · UNVERIFIED (by reading) · Card details**
- Horde card "Outrun it" by vehicle succeeds with an empty tank (`events.js:309`).
- `EVENTS` has a dead "breakdown" entry (weight 0).
- The loner's "story does not add up" has no effect.
- "Cold feet → let them go home" on a solo team leaves a party with no members.
- The crashed-Humvee gear ignores carry space.
- Tribute and "Send 40 ammo" use amounts fixed when the card was made and can drive stock negative.
- `resolveRaidOnFaction` and `collapseFaction` log the names of groups you have not met.

**[C-24] BUG · minor (cross-area) · Hub food goes negative**
- Reproduced by the invariant check (food = −5): "Let them in" subtracts 5 food with no floor (`economy.js:122`).

**[C-25] BUG · minor (cross-area) · UNVERIFIED (by reading) · A team emptied without `wipeParty` loses its vehicle and cargo**
- `playerPartyHour` calls `removeParty` (`parties.js:286`) after deaths from the trade-gate shooting or the cull card. No orphan vehicle showed up in the year-long invariant runs.

## What was tested

- Repo tools, all passing: `combattest 300 5`, `combattest_sweep 200 3`, `conflicttest 120`, `conflicttest_cover 30`, `cardcount`, `autotest 120 all 1 2 3 4 5`.
- `t1`: auto versus tactical, 30 matchups × 200.
- `t2`: three zombie speeds × 80 cells × 120.
- `t3` / `t3b`: unit creation from gear, wear, kits, ammo, crossbow.
- `t4`: 365 days × 5 seeds × simtest and idle players.
- `t5`: 365 days × 5 seeds × 3 autopilot styles.
- `t6`: browser paths with a `window` stub (loot, queue, base defence).
- `t7`: stuck teams, surrender, captivity (12 seeds, plus 40 captives per captor type and attitude).
- `t8`: reach over 60 seeds; daily invariants over 12 seed-years (no NaN, no negative group stock, no shared base tiles, no orphan survivors or vehicles).

## Not covered

- Raid mode (`raidtest` not run; scavenge battle setup only read).
- Overwatch, cover and hit maths (read, not measured).
- Rare battle timeouts (3 seen in about 30,000 battles, not investigated); AI stuck units.
- Retreat and evac scripted cases; rescue fights played tactically.
- Help calls and sieges with a relief squad; cull and lure.
- Trade and per-card event scripts (C-21 to C-23 are reading only).
- Enemy weapon value against the economy (only counted: one weapon per dead human).
- The UI.
