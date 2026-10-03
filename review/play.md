# Broken State — playtest findings (Phase 1: find, don't fix)

Status: **stopped early at the usage limit.** Scenarios 1–6 were played, 7 partly, 8–11 and the fuzz player were not. Findings marked **UNVERIFIED** come from reading the code only and were not reproduced in play.

How it was played: the real `src/main.js` was imported under a fake DOM (`harness.mjs`), so every action went through the game's own click / change / canvas / key listeners and the real `requestAnimationFrame` loop; the "player" could only click elements present and enabled in the rendered HTML. Battles and raids were played on the tactical screen through the UI by a simple human-like bot (`human.mjs`). World invariants (`invariants.mjs`) were checked after every hour played. Where a tester's shortcut was used (stock granted, a wound set, a war party spawned, an event roll steered) it is stated in the finding.

Scripts: `C:\Users\nate-\AppData\Local\Temp\claude\C--Users-nate--OneDrive-Desktop-NGP\4037875a-ac92-4d38-9d09-b947b700d3d6\scratchpad\review\play\` (all runs on seed 777, 7 groups, unless noted). Nothing under `prototype/` was changed.

---

## Findings, most severe first

**[P-1] BUG · major · Anyone who goes down in a raid is dead, even after being stabilized**
where: scenario 3, `sim/combat.js` endRaid (~1634–1643), heal (~752–755), damage (~634).
The log tells the player "X is down and bleeding. Use meds on them within 3 turns", and after meds "stabilizes X. They will live if you hold the field." A raid has no "hold the field" ending: it only ends when every standing unit extracts, and `endRaid` kills every unit that did not leave. Reproduced (`p_raid_down.mjs`): Liam downed, Cora used 1 meds, roster showed "Down, stabilized", the other two extracted, result "Liam Brooks was left behind", Liam dead. Raids are the main activity, so this is the first death most players will see.
fix: in `endRaid`, a stabilized downed unit survives when at least one teammate extracts (carried out, health 5–15, as `endBattle` does); an unstabilized one rolls like a lost battle. Or add a Carry action. Until then change both log lines for raids.

**[P-2] BUG · major · A lone "coward" sent home loses the vehicle and everything carried for good**
where: travel event "Cold feet", `sim/events.js:252`; `parties.js` playerPartyHour (~286).
"Let them go home alone" removes the member from the party. With a one-person team the party has zero members and is deleted next hour without `wipeParty`: packed supplies vanish and the vehicle keeps `loc {kind:"party"}` of a party that no longer exists. Reproduced (`p_coward.mjs`, event roll steered, the rest real): Nora alone in the pickup; after the choice the Vehicles tab says "Pickup truck · out with a team" forever, no marker, 10 scrap / 15 ammo gone. The coward also teleports home (or dies) regardless of distance or water.
fix: if the coward is the last member, treat the choice as "turn the whole team around" (startReturn); otherwise never delete a party without `wipeParty`.

**[P-3] BUG · major · A vehicle parked at an outpost that falls becomes a ghost**
where: scenario 5, `sim/factions.js:222–227`, `hordes.js:70–74`.
When an outpost is overrun the base is spliced out; vehicles with `loc.baseId` of that base stay in `state.vehicles`. Reproduced (`s05_outpost.mjs`): hub Vehicles tab shows "Pickup truck · parked at " (blank name), it can never be used or recovered; invariant "vehicle parked at base 42, which does not exist". The founders' truck parks at the outpost automatically (see P-16), so this is the likely way to lose the only vehicle. Stock, armory and queued construction also vanish with no log line.
fix: on losing a base, turn its vehicles into abandoned vehicles on that tile (marker), drop armory/stock into a death-site style cache, log what was lost.

**[P-4] BUG · major · "Defend in person" fields at least 3 raiders whatever the raid's strength**
where: scenario 5, `sim/conflicts.js:1317` (`clamp(round(raid.strength / power), 3, 14)`).
Warning card: "about 6 strength of Red Hand fighters… Current defense: 9" (by the numbers 9/6 = 1.5 → driven off). Choosing "Defend in person" opened a battle of 2 defenders against 3 raiders of power 4.3 each (12.8 total, twice the stated strength). Result: defeat, both defenders at 6 and 9 health, the raid then pressed on at full strength 6 and both died "defending" (`s05.out`). (War party spawned by the tester with `spawnAiParty`, as `launchRaid` does.) The option reads as the skilled choice and is a trap for small raids.
fix: enemy count = round(strength / power) with a minimum of 1 and per-unit power scaled so count × power ≈ raid strength; show the number of attackers on the card.

**[P-5] BUG · major · A vehicle left on a shore (or at a raid site) cannot be driven again without fuel cans, even with fuel in its tank**
where: scenario 6, `parties.js` orderOptions (~415–419), recoverVehicle (~725).
Left the pickup on the shore with 11.6 fuel in the tank ("marked on the map, recover it later"), crossed, came back 6 hours later to the same tile: "Recover vehicle" disabled, "Bring at least 2 fuel" (team carried 0 cans). The team walked 13 h home and a second team had to walk back with cans (`s06b.out`). Same rule applies to a truck left at a raid site.
fix: count the tank: allow when `v.fuel + carried fuel >= 2`.

**[P-6] BUG · major · Starvation cannot kill at a base; a starving hub only loses people to desertion and the leader never leaves**
where: `economy.js:84–90` (6 damage a day) vs `medical.js` passive heal (4 + 0.4 × best Medicine a day).
Pure-sim trace, seed 1, nobody touching anything (`t_seed1.mjs`): "out of food" every day from day 39 to day 70, everyone stayed at 94–95 health the whole time. Mood fell 10 a day, five people "lost hope and walked away" (days 52–70), the leader (cannot desert) lived on alone, food recovered, and the game only ended on day 100 when a horde broke into the one-person hub. With any Medicine 5+ person at the base, hunger is harmless to health.
fix: hunger damage that outpaces passive healing (or no healing while starving), escalating per consecutive day.

**[P-7] BUG · major · Nobody at a base drinks; water is not a resource at home**
where: scenario 2, `economy.js:70` (well +14/day, cap 80) and no water use in `baseDaily`.
Hub water went 40 → 80 in 4 days and stayed there with 6 people (`s02_week1.mjs`). Only teams drink. The charcoal water filter (+3 water/day) and the autopilot's "the well cannot keep up" craft are therefore pointless, and no water figure is shown anywhere but the top bar. UNVERIFIED side effect: `Math.min(80, water + 14)` also cuts stock above 80 (water brought home is discarded at midnight).
fix: 1 water per person per day at bases with thirst effects; cap only the well's contribution; show "Water per day".

**[P-8] BUG · major · A trade route accepts any terms the player types**
where: scenario 7, route form `main.js` rt-create (~308), `parties.js` convoyArrive (~910–927).
Typed "send 1 scrap, receive 400 meds, every 2 days, light escort": the form shows "Fair value: you send 1, receive 2400" and the Start button is enabled; the route was created (`s07a.out`). `convoyArrive` hands over `min(recvQty, their stock)` with no value check. **Payout UNVERIFIED in play**: the one-person escort was killed on the first run before arriving.
fix: validate at creation and at each exchange with the barter prices (`sellPrice` / `buyPrice`), scale the received amount to what the sent goods are worth.

**[P-9] SUGGESTION · major · The holdout does not fall under sensible play and snowballs; raids and hordes cannot hurt a staffed hub**
where: scenario 9 (not hand-played), numbers from the game's own `tools/autotest.js 200 all 1 2 3 4 5` and `t_threats.mjs`.
200 days × 5 seeds: 0 holdouts fell in any style; average alive 21 (cautious), 36 (balanced), 92 (aggressive); deaths 0.2 / 0.6 / 6; stocks in the thousands (food 2400, scrap 3300 balanced). Hands-off at the hub (11 seeds, 200 days): raid warnings showed defense/strength ratios of 1.9–3.9 (driven off at ≥ 1.2), no raid broke in while the hub was staffed; hordes hit up to 11 times and broke in once, against a hub with one person left. Raid strength tops out near 26 (pop cap 50 × 1.3 × 0.4) against a starting defense of about 33; the largest horde (140) attacks at 19.6. "Prepare defenses" on the warning card is free and always enough, so the card is not a decision. In play this means the hub is safe forever once two people farm.
fix to consider: raid strength and horde size that grow with the player's population and stock, a cost for "Prepare defenses" (work lost that day), siege damage to buildings.

**[P-10] SUGGESTION · major · Treat has no cooldown: meds heal anyone to full instantly, which bypasses beds, tiers and waiting**
where: scenario 4, `medical.js` treatAtBase.
From 20 health and an infected wound, clicking Treat in the same hour (`s04_medical.mjs`): no hospital 6 clicks / 8 meds → 100 and clean; infirmary 4 clicks; field hospital 3; clinic 2 (first click "operated on… 20 → 86"); trauma hospital 1 click, 2 meds. Without clicking, the same patient takes 22.8 days with no hospital, 5.8 / 4.8 / 2.5 / 1.8 days per tier. The starting 6 meds already cover a full heal, so the hospital line is optional.
fix to consider: one treatment per patient per day (or per 12 h), or diminishing returns; surgery as a timed job needing a free medic.

**[P-11] SUGGESTION · major · Two rule sets for the same thing: the tools and autopilot test a game the player does not play**
where: `scavenge.js:56` (abstract search when headless / autopilot, tactical raid in the browser), `combat.js` autoResolve.
All balance numbers in the tools come from the hour-by-hour search and by-the-numbers fights. Played on the raid map, the very first raid on the lowest-danger nearby site (Harlow Diner, 3 zombies) with 3 people ended with Heat 91, one survivor at 36 health, 3 of 7 containers searched and "2 scrap, 1 fuel" (`s03_expedition.mjs`); gunfire raised Heat, each stage brought a wave, which needed more gunfire. The autopilot on the same seeds loses almost nobody.
fix to consider: make the headless player run the tactical raid (the bot in `raidtest.js`), and tune from that.

**[P-12] BUG · minor–major · Packed supplies ignore carry space**
where: scenario 3, planner / `parties.js` launchExpedition.
One walker with a bad back (planner shows "Carry space 8") packed 40 food, 35 water, 20 fuel, 5 meds, 80 ammo, 2 parts, 25 scrap (weight 127.5): no warning, Send enabled, launched (`p_misc1.mjs`). Only found cargo counts against the limit, so one person can carry a whole outpost's stock out, but cannot pick up a 9th can of food.
fix: count packed supplies in the load (planner warning and launch check), or state clearly that packed supplies are free.

**[P-13] BUG · minor · Cards outlive the team or person they are about**
where: `parties.js` onEnterTile (one roll per tile, several tiles per hour in a truck); no cleanup when a party ends.
Natural case (`s07a.out`, day 2): a "Blocked highway" card "near Harlow Police station" was shown after the team was already home and removed; "Squeeze through" answered "The truck gets stuck for hours". Forced case (`p_coward.mjs`): a second "Cold feet" card for a survivor who had just died; "Convince them" replied "They come, but they are shaking."
fix: when a card reaches the front, drop it if its party is gone or the named survivor is dead; stop rolling events for the rest of an hour once one card was made.

**[P-14] BUG · minor · Game over does not trigger when the last free survivor deserts, is recruited by captors, or is captured — UNVERIFIED**
where: `world.js:243` (only `killSurvivor` sets `gameOver`); `economy.js:104–108` and `conflicts.js:1288–1292` set `alive = false` directly; captives count as alive.
Not reproduced; the stop came before scenario 9. The invariant checker has checks for both cases. Also UNVERIFIED: after a game over reached through a card choice, `ui.cardResult` (and `ui.baseView`, `ui.survivor`, `ui.expedition`) are not reset by `restart`, so the old game's result box would open in the new game.
fix: one `checkGameOver(state)` called after any change to `alive` or location; reset `ui` on restart.

**[P-15] SUGGESTION · major · A week at the hub has two decisions and no events; the build menu is out of reach without raids**
where: scenario 2 (`s02_week1.mjs`).
Day 1: 25 scrap buys a bunkhouse (20) plus a pipe spear and a bandage kit (5). Hub scavenging brings 2.2 scrap a day per scavenger, and the default ammo-bench operator burns 3 a day (hands-off, scrap fell 25 → 17 in 10 days while ammo rose 80 → 180). The next affordable thing was a farm plot on day 5. The list in the brief (bunkhouse, farm plot, walls, infirmary, field hospital) costs 98 scrap, 2 parts, 6 meds. Cards in the first 7 days: 0. Real time: 8.1 minutes at 1×, 2.7 at 3×. Hands-off for 134 days: 11 cards (7 strangers, 3 raid warnings, 1 refugees).
fix to consider: 3–4× hub scavenging or cheaper first buildings; a few hub events (visitors, sickness, fire, disputes) so that a day at home asks for something.

**[P-16] BUG / SUGGESTION · minor–major · Outposts: founding supplies are shipped back the first night, the vehicle stays there, and nothing can be launched from an outpost**
where: scenario 5, `economy.js` shipFromOutposts (~163), `parties.js:558`.
Brought 25 scrap, 14 food, 6 water to found Harlow Diner Outpost (3 tiles away) to build a farm plot. After the first midnight: scrap 5, food 6 (the reserve), the rest sent to the hub with the supply-line loss; "Build farm plot: Needs 8 scrap". The pickup parked at the outpost; expeditions can only start from the hub, so the hub's supply-run form offered "on foot" only and the truck can only come back through a supply run from the outpost. The planner says nothing about either. The launch log also says "back in about 1 days" for a team that stays. The repeating supply run itself was **not exercised**: my one-person crew (bad back, carry 8) could not carry the 14 load and the job stayed "Blocked" (the form did warn).
fix: keep founding stock for the first 3 days (or until a build is queued); say in the planner that the vehicle stays; allow "send vehicle to hub".

**[P-17] SUGGESTION · major–minor · "Gather materials" is an unlimited scrap source**
where: scenario 6, `crossing.js` gatherMaterials; no shore check and no depletion in `orders.js`.
On any shore tile with a crossing, 3 hours give 2–5 scrap (+Scavenging/3, more in forest or town): 7 scrap in the first 3 h, 5 in another run (`s06d.out`, `s06a.out`), limited only by carry space (my walker filled 8/8 in 6 h). With normal carry or the truck that is roughly 40 a day for one person, against 2.2 a day for a hub scavenger and 2–10 per raid.
fix: deplete per tile (e.g. 10 scrap, regrowing slowly), or let gathered material count only toward a boat.

**[P-18] BUG · minor · New-run screen: unspent skill points and traits are lost when the world is rebuilt**
where: scenario 1 (`s01_newrun.mjs`), `ui/newgame.js` budgetOf (keyed by survivor id), `main.js` newWorld / `world.js` applyCrew.
Took 3 points out of a skill ("Points left 3 / 62"), changed AI groups 7 → 9: "Points left 0 / 59", the points are gone. The same change swapped every colonist's traits (Nate Gilbert: "badback" → "loud/lucky") while names, skills, look and leader were kept, so a build planned around a trait breaks. The screen shows raw skills (Stealth 5) while the game shows effective ones (Stealth 3 with Loud and Lucky). Verified fine: the edited crew is exactly what is in the started world; same seed + same edits gives the same world and rng state across processes (10-day digest identical apart from the colonist randomized with the dice buttons, which use `Math.random`).
fix: carry the budget and traits in `crewSnapshot`; show trait modifiers next to skills.

**[P-19] BUG · minor · "Return home" across water says the team heads home, then shows a card titled "Done: Waiting for orders"**
where: scenario 6, `parties.js` startReturn / awaitOrders (doneLabel from a waiting team).
Log: "The team heads home." (or "Team ordered home." from the Teams tab), followed by a card "Done: Waiting for orders — No way home over land from here: water in the way…". The explanation is right, the log line and title are not. Related: a site only reachable by boat shows "From hub: No route" and a planner with Send disabled, with no hint that a team can cross from the opposite shore.
fix: return a failure text from `startReturn`; title "Cannot go home"; add the boat hint to the tile panel.

**[P-20] BUG · minor · A result box sits on top of the raid when "Scavenge / raid" is picked from an orders card**
where: `main.js` choice handler (~363), `parties.js` giveOrder.
After the click the raid is open and the top layer is a modal "Done: Scavenge / raid — The team starts searching. [Continue]" (`p_misc1.mjs`). From the team panel the same order just logs.
fix: mark the scavenge choice `order: true`, or skip `cardResult` when `state.combat` is set.

**[P-21] SUGGESTION · minor · The Medical tab's per-patient rate leaves out the daily dose**
where: scenario 4.
No hospital, meds in stock: the card says "-0.6 health/day", the patient gained +9.4 to +11.6 a day while below 70 health, then +1.6 a day (as shown) and stayed infected for 22.8 days. Infirmary: shown +3.2, got +18.2. A footnote mentions the automatic dose, the number does not include it. Also seen: at a Clinic with no meds a patient reached 100 health, was still infected after 12 days, and stayed in bed not working.
fix: show "+11.6/day (incl. daily meds)"; release patients at 100 health from the bed or state why they stay.

**[P-22] BUG · minor · Base scavengers get hurt with no message**
where: `economy.js:76` (4% a day, 10–25 damage, no log).
Dana went 100 → 87 during week 1 with nothing in the log (`s02_week1.mjs`). A hurt scavenger can die this way; only the death is logged.
fix: log the injury.

**[P-23] SUGGESTION · minor · Small mismatches between shown and real numbers**
- "Food per day +2.2" at the hub; real change +2.9 a day (scavenged food is not in the figure) (`s02`).
- Craft queue: bandage kit "about 7h", took 8 h (work does not carry over between jobs). Construction "done in about 27h" matched; planner ETAs matched to the hour (2 h diner, 5 h boat, 10 h raft, 1 h home); fuel matched (10 road tiles × 0.6 = 6.0).
- A container emptied only partly counts as not searched: "got out with 8 food (0/5 searched)", so the site's loot value does not drop (`p_misc1`).
- A "picked over" site still pays: second raid at the diner (loot 0.10) gave 35 food and 12 water from 8 containers, because raid richness has a floor of 0.35.
- UNVERIFIED: planner "Carry space" leaves out worn backpacks (`ui.js:398` vs `partyCapacity`).

**[P-24] SUGGESTION · minor · Default roles and the ammo bench work against a new player**
where: `world.js:81` (roles by index).
The two default farmers are whoever is first in the list. On 6 of 11 seeds run hands-off for 200 days the hub lost 2–5 people to desertion from hunger (`t_threats.mjs`); seed 1 started at "Food per day -2.1" with a Farming 9 survivor on guard. Ammo piles up unused (470 by day 51 hands-off; 1000–4000 by day 200 on autopilot) because nothing at home uses it.
fix: assign starting roles by skill; leave the ammo bench without an operator at the start.

**[P-25] SUGGESTION · minor · Desertion comes without warning, and taking in strangers past the bed count causes it**
where: scenario 4 run (`s04.out`): accepting 7 strangers with 10 beds led to two desertions (days 108 and 124) with no earlier log line.
fix: a log line or card when someone drops below 25 mood ("X talks about leaving").

**[P-26] SUGGESTION · minor · A light-escort trade convoy next to a hostile raider base dies on its first run, and the dead route keeps logging**
where: scenario 7 (`s07a.out`): the single escort was hit three times on one trip (war party, the dead, raiders) and killed; "The route… has no escort left" then repeated every interval until the route was ended by hand.
fix: show the route's risk in the setup form (hostile land on the path); pause the route automatically when it has no escort.

**[P-27] SUGGESTION · minor · Text and naming**
- A team is renamed by its last order in the log: "Scavenge / raid team" → "Look around team" → "Move here team (Dana, Cora, Liam) is home".
- The orders card title after any wait is "Done: …" even when nothing was done.
- Talking down an ambush by hostile raiders showed "Speech check, 95% (they are hostile)" for a Speech 16 survivor: the cap makes the best speaker an automatic pass.

---

## Feel: real time (3 s per in-game hour at 1×, 1 s at 3×)

| What | In-game | At 1× | At 3× |
| --- | --- | --- | --- |
| First trip, diner 3 tiles by truck (out) | 2 h | 6 s | 2 s |
| Same trip with look around, 2 raids, camp, move, treat, craft, home | 27 h | 1.4 min | 0.5 min (plus the raids, turn by turn) |
| Far friendly town by truck, each way | 9–11 h | ~30 s | ~10 s |
| Island trip on foot with two boats | 74 h | 3.7 min | 1.2 min |
| Bunkhouse, one builder | 27 h | 81 s | 27 s |
| Field hospital / clinic / trauma hospital, two builders | ~8.3 days each (observed) | ~10 min | ~3.3 min |
| A week at the hub | 168 h | 8.4 min | 2.8 min |
| 20 health + infection, no hospital, daily meds | 22.8 days | 27 min | 9 min |
| Same at infirmary / field hospital / clinic / trauma | 5.8 / 4.8 / 2.5 / 1.8 days | 7 / 5.8 / 3 / 2.2 min | — |

Travel waits are short; the long waits are construction and healing, during which the hub produces no decisions (P-15), and healing can be skipped with meds (P-10).

---

## Scenarios

| # | Scenario | Played | Notes |
| --- | --- | --- | --- |
| 1 | New run | fully | `s01_newrun.mjs`; crew in world matches the screen; seed + edits reproducible |
| 2 | First week at the hub | fully | `s02_week1.mjs`; walls / infirmary / field hospital not affordable in week 1 (built in scenario 4 with granted stock) |
| 3 | First expedition | mostly | `s03_expedition.mjs`; planner, ETA, raid, Done card, queue, field treat, field craft, inventory, unload and fuel all accounted for. "Loot the bodies" was not exercised (the only regular battle was lost) |
| 4 | Medical arc | fully | `s04_medical.mjs`; shortcuts: wound set to 20 + infected, hospital materials granted |
| 5 | Expansion | partly | `s05_outpost.mjs`; founded, built attempt, defended in person, lost. The repeating supply run never left (crew could not carry the load) and no horde attack on the outpost was played |
| 6 | Water | fully | `s06_water.mjs` foot / gather / truck / raft |
| 7 | Other groups | partly | `s07a_trade.mjs`: recon, trade, gift, both pacts, trade route set up. Not played: route payout, raid defense at the hub, captives, ransom, rescue, refugees |
| 8 | Hordes | couldn't | only hands-off counts (`t_threats.mjs`); cull, lure and nest cards not played |
| 9 | Decline and death | couldn't | only a hands-off pure-sim trace (`t_seed1.mjs`); game-over variants and the chronicle's final frame not checked |
| 10 | Second run in the same process | couldn't | stopped before it |
| 11 | Autopilot hand-over | couldn't | stopped before it |
| — | Fuzz player, 150 days × 10 seeds | couldn't | invariant checker written and used in every scenario above; the random player was not run |
