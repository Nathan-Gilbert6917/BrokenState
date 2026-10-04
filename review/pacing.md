# Broken State: pacing and decision quality

The question: *does it feel fun to play, with not too much happening at once, and are the decisions impactful?*

How this was measured: `prototype/tools/pacing.js` (README) plays autopilot campaigns and catches every card when it is added to `state.cards`, whatever module adds it. For each card it records the hour, the module, the choices and the autopilot's answer. It also counts search screens, trade windows and battles. Main data set: **42 campaigns** (cautious / balanced / aggressive × seeds 1–14), up to 365 days each, 12,779 campaign-days and 30,669 cards (`node tools/pacing.js 365 all`, about 8 minutes). These numbers come from the run after the bug fixes below. The narrative comes from the full logs of seed 3 for the first 120 days (`node tools/pacing.js log 120 <style> 3`).

Caveats. The autopilot is not a player. It runs more teams than a cautious human and fewer than a greedy one, and it answers some cards a human would think about. In the browser every card stops the clock (`main.js` `blocked()`), so cards per day equals interruptions per day for a human. 25 of the 42 runs fell before day 365, so the late-year numbers come from the survivors.

---

## 1. Headline numbers

| | cautious | balanced | aggressive | all |
|---|---|---|---|---|
| cards per in-game day (mean) | 1.40 | 2.09 | 3.64 | **2.40** |
| p90 / max cards in a day | 3 / 16 | 5 / 15 | 9 / 20 | 6 / 20 |
| decisions per day (2+ choices, not team orders) | 1.24 | 1.84 | 3.16 | 2.11 |
| team "Done / Orders" cards per day | 0.13 | 0.18 | 0.33 | 0.22 |
| one-button "OK" cards per day | 0.03 | 0.07 | 0.15 | 0.08 |
| most cards in any 6 h: max (median run) | 7 (6) | 8 (7) | 12 (9) | 12 (7) |
| most cards in any 24 h: max (median run) | 22 (10) | 18 (13) | 28 (19) | 28 (14) |
| longest stretch with no card: max (median run) | 8 (5) days | 7 (5) | 6 (3) | 8 (4) |
| low-stakes share (see 3a) | 22.7% | 32.7% | 36.5% | 32.9% |

**Real time.** At 1× an hour takes 3 s and a day takes 72 s (`main.js` `HOURS_PER_SECOND = 1/3`). 3× is the fastest normal speed.

* All styles: 2.40 cards a day works out to **one card every 30 s at 1× and every 10 s at 3×**. The clock stops 1.95 times a day (some hours bring more than one card), which is a stop every 37 s at 1× and every 12 s at 3×.
* Aggressive play: one card every **20 s at 1× and 7 s at 3×**. Cautious play: one every 51 s at 1× and 17 s at 3×.
* Other screens that pause the clock: 0.37 a day (search 0.19, trade 0.16, battle 0.01; the autopilot auto-resolves most battles).

**Through the year** (cards per day / decisions per day, all styles, 30-day buckets). Day 1 is day 15 of spring. Winters fall on about days 71–98, 183–210 and 295–322.

```
d1 2.4/1.8   d31 2.9/2.4   d61 2.2/1.9   d91 1.5/1.4 (winter)   d121 2.9/2.6   d151 3.3/3.0
d181 1.8/1.7 (winter)   d211 2.1/2.0   d241 2.7/2.4   d271 2.8/2.5   d301 1.5/1.4 (winter)   d331 2.6/2.3
```

Summers peak at about 3 cards a day (aggressive about 5) and winters fall to about 1.5. The rhythm is right (busy summers, quiet winters), but the summer peak is too high and the winter lull has little to do (see 4).

**Where cards come from.** 57% of all cards are about a team on the road. By module: parties.js (travel events + team orders) 51%, hubevents 10%, visitors 10%, skills (perk points) 7%, recruits 5%, defences 3%, crashes 3%, jobs 2%, conflicts 2%, radio 2%, morale 2%, everything else under 2%. **The number of teams out drives the card rate.** That is why aggressive play sees 2.6× the cards of cautious play.

**Crises stacking.** I counted four kinds of crisis: a raid on your base, a horde at your walls, illness (an outbreak, pneumonia or 2+ falling ill in a day) and a team in trouble (bitten, held, a forced fight, a rescue). Per run there are 15 raid-days, 20 horde-days, 25 illness-days and 18 team-trouble days.

* **Two kinds within the same 3 days: 12.6% of days.** That is 7.9% for cautious, 12.5% for balanced and 17.3% for aggressive.
* **Three kinds at once: 3.8 days per run** (cautious 1.3, aggressive 6.6).

Real pile-ups are rare. Most "stacking" is illness, which night care handles automatically, so it is background noise rather than a crisis. The real overload is not crises. **It is many small road cards in a row.** A median run has a 6-hour window with 7 cards in it, and the worst has 12.

**Repeats.** Most of the frequent road cards come back to the same run within a week, for example:

* Storm 67%
* Supply truck 73%
* The dead ahead 82%
* Tempers flare 67%
* Stranded traders 66%

The same handful of road events make up most of a trip.

---

## 2. Decision quality, card by card

For each frequent card I checked the code (what each option costs and risks) against the autopilot's answers. Each card gets one of these verdicts:

* **REAL**: different costs and risks, and the best answer depends on the situation.
* **ONE ANSWER**: one option is nearly always right.
* **NOTIFY**: a notification dressed as a decision.

| card (per run) | autopilot's answers | verdict and why |
|---|---|---|
| Done: <job> (62) | team orders | Your turn for a team. Needed. |
| *X* reached *skill* *N*: a perk point (51) | a perk by style | REAL, but **not urgent**: it can wait for the skill tree, yet it stops the clock. About one every 6 days; bigger crews see more. |
| Travellers at the gate (39) | news 39%, send on 28%, joiners 23%, maps 7% | Mostly REAL (shelter costs food, joiners, buying maps). "Hear their news" is free and always taken first, so that step is one answer. 2–4 clicks per visit. |
| The dead ahead (38) | sneak 59%, fight 34%, long way 7% | **REAL.** Stealth check against ammo against 3 hours. A good card. |
| Abandoned supply truck (29) | search 92% | ONE ANSWER. 80% loot against 20% of 10–30 damage for 2 hours. Sometimes "Found 0 food (no room for the rest)": the search is offered even when the cargo is full. |
| Horde of N, on the road (27) | hide 94% | Mostly ONE ANSWER. Outrun is only right with a vehicle and 4 fuel; fight almost never. |
| Tempers flare (24) | step in 100% | ONE ANSWER. Stepping in beats "let them sort it out" unless Leadership is very low. |
| Storm (24) | shelter 100% | ONE ANSWER. 6 hours of delay against a 40% fall for 5–20 damage. Low stakes either way. |
| Stranded traders (23) | help 99% | ONE ANSWER. Helping *gives* 2 meds + 5 goodwill for 2 hours, which beats every other option. Robbing is the only moral dilemma, and it is rarely worth it. |
| A survivor alone (23) | take / supplies / turn away | **REAL.** A mouth to feed against a pair of hands. |
| Horde heading for your base (19) | man the defences 100% | NOTIFY. "Man the defences" is free (no lost work), so "Hold as you are" is never right. The decoy fire is the only real alternative, and only when the walls would not hold. |
| A quarrel at the base (18) | mediate 94% | Mostly ONE ANSWER when a good talker is home. Real when nobody can mediate. |
| A stranger at the gate (17) | in / away / supplies | **REAL** (beds, food, winter). |
| Job offer (17) | decline 77% | **REAL.** |
| The dead surge (14) | run 91% | Mostly ONE ANSWER. |
| On the radio: a trade offer (13) | agree 60%, no 27% | **REAL.** |
| Survivors in trouble (12) | gunfire 53%, hit from behind 32%, slip away 10%, fire 5% | **GREAT.** Four live options, each the best in some situation. |
| Traders on the radio (12) | yes 100% | NOTIFY. A free visit you always want. |
| Radio signal (12) | one button | NOTIFY. |
| Camp by the road (10) | steal 41%, talk 40%, slip away 9%, ambush 9% | **GREAT.** Morality, goodwill and risk all pull different ways. |
| Stories by the fire (10) | let them talk 100% | NOTIFY. |
| After the fight (10) | continue 40%, home 23% | **REAL.** |
| Horde spotted, while following a plan (9) | continue 100% | NOTIFY. Useful as a heads-up, but rarely changes anything. |
| Raiders heading for your base (8.5) | prepare 97% | NOTIFY. "Prepare defenses" is a free buff. Tribute and "Defend in person" are real but almost never right. In the seed-3 logs every raid on the hub by an AI group was driven off with no drama (cautious 8 of 8, balanced 7 of 7, aggressive 7 of 7). Raids only landed on aggressive's thinly held outposts and in one outsider raid. |
| Breakdown (8) | repair 75%, spare part 17% | REAL, mildly. |
| Fire in a building (8) | water 92% | Mostly ONE ANSWER unless water is short. |
| Outbreak (6) | quarantine 100% | Mostly ONE ANSWER. The meds option is real when meds are plentiful. |
| Crash sites: helicopter or plane down, supply drop (~20 together) | mark 55%, send a team 45% | **GREAT.** A timer, a race against other groups, risk and a big prize. |
| Prepper cache (7) | one button | NOTIFY. Sometimes "0 food (no room for the rest)". |
| # patrol (8) | share news 100% | ONE ANSWER. Sharing news is free and maps their bases; the food gift is rarely worth it. |
| Cold feet (3) | convince 100% | ONE ANSWER. |
| A hive, on the road (2) | mark 100% | Mostly ONE ANSWER. The fire costs 5 fuel and only sets the hive back. |

**Summary.** The cards where the autopilot gives the same answer at least 90% of the time make up about **10,600 of 30,669 cards (35%)**. One-button cards add another 3%.

The real decisions mostly sit in a few places:

* the people cards (strangers, survivors, travellers, recruits, morale)
* the conflict cards (camps, survivors in trouble, the dead ahead, after the fight)
* crash sites
* radio, jobs and trade

### 3a. Spam: frequent, low-stakes cards that could be answered automatically, batched or made into log lines
Storm, Abandoned supply truck, Tempers flare, Stranded traders, Prepper cache, Radio signal, # patrol, Stories by the fire, Horde spotted, Traders on the radio, Cold feet, road hordes (Horde of N) and perk points: **32.9% of all cards** (22.7% cautious, 32.7% balanced, 36.5% aggressive). Without them there would be **1.61 cards a day instead of 2.40 (one every 45 s at 1× instead of every 30 s)**. Aggressive play would drop from 3.64 to 2.31 a day.

### 3b. Missing decisions: big moments with no say for the player
* **Hordes at your walls with no warning.** The warning card came only once per horde *ever*. A horde beaten off at the walls that came back later hit with no warning. Before the fix, half of all horde hits came unwarned (3 seeds × 3 styles × 365 days: 32.2 hits against 15.8 warning cards per run). **Fixed (bug B2).** Now 19.5 hits against 18.7 warnings per run.
* **Hives growing.** "The dead are gathering" / "started to build a hive" / "A new hive has risen" appear in the log only when the tile is in sight: **0.0 per run** across 42 runs. The player effectively never sees a hive being born, which is the 4X threat of the game.
* **Winter food shortfall.** The weekly winter-stores report is autopilot-only (`say`). A human gets the "food for <5 days" alert and a "short rations" log line (9.5 per run). There is no card in late summer or autumn that asks "the stores won't last the winter, what do we do?".
* **A group turning hostile** (0.2 per run) and **a pact torn up**: log lines only.
* **Raids**: the card exists, but the free "Prepare defenses" option and walls that always hold make it a notification (see the table).

### 3c. Great cards worth more of
Survivors in trouble, Camp by the road, The dead ahead, crash sites (helicopter or plane down), A stranger at the gate / A survivor alone, Job offers, radio trade offers and After the fight. **What they share:** each option spends a *different* resource (ammo, time, goodwill, stealth risk, food, a person), the odds are on the card, and the best choice changes with the situation. Crash sites add a clock and rivals racing you, which is the single best "go now or lose it" moment in the game.

---

## 4. What the player experiences: seed 3, first 120 days

**Balanced.** Days 1–14 are pure logistics: one two-person team goes out almost every morning to the auto shop, pharmacy or police station and is home by evening. The cards are cozy and small: a wandering preacher (feed them for +5 mood), storm damage, a breakdown on the road.

The first real hook is on day 11: *a medevac helicopter spins down 10 tiles northwest*, with a search circle and a timer. The first raid warning comes on day 12. It is answered with "Prepare defenses", and nine hours later "drove off the Highway Kings raid". No tension and no fight.

Summer (days 15–42) settles into a loop. The road brings storm (shelter), supply truck (search), stranded traders (help), tempers (step in) over and over. Travellers and strangers at the gate are the interesting moments (take Elena in, turn the refugees away). Raids come every 10–14 days and are always driven off.

Autumn turns into planning. Winter stores are reported weekly, crops die in storms, and a horde of 104 hits the walls on day 68 and is held.

**Winter (days 71–98) is dead air.** Teams stay home, about one card every two to three days (0.5 a day in that stretch), hordes hit the walls and bounce off as log lines (three of four came with no warning before the fix), and the well and storehouse break and are fixed without asking. Spring returns to the same loop.

*Verdict:* calm and readable. Never overwhelming, but low on stakes. Most clicks confirm the obvious answer.

**Cautious.** Even quieter early (1.3 cards a day): one stealthy team, many trades by radio, and a log full of "Static. No new voices within reach." every morning. The radio caravans keep the base supplied, and the decisions are mostly "turn the stranger away". It is the most "colony-sim" feeling of the three, and also the most like watching a spreadsheet: almost nothing threatens it in the first 120 days (8 raids, all driven off; no hordes at the walls).

**Aggressive.** This is where the game is exciting, and also where it is too busy: 3.6–3.9 cards a day for the first 90 days, up to 16 in one day.

* The good part: a survivor joins on the road on day 2, keys to locked sites, a camp to steal from, a prisoner taken on day 37 and a rescue raid two days later, a helicopter search that races four other groups to the wreck. Later (days 77–110) three outposts fall to Red Hand and Highway Kings, and on day 79 an outsider band the team had paid a toll to overruns the hub after a lost "Defend in person".
* The bad part: the same road cards fire between every one of those moments. Storm–shelter, supply truck–search, prepper cache–"Open it" (sometimes "0 food, 0 meds, 0 ammo, no room").
* The most dramatic thread is an outpost founded on day 20 that runs out of water and empties one deserter at a time over days 25–43, with a "talks about leaving" card almost every day. That is a real crisis with real choices (talk, rest, a gift), and it reads well. But at 3× it comes in between half a dozen road popups.

**Overall verdict.**

* Not overwhelming in the crisis sense. Real pile-ups are rare (3+ kinds at once on 1–2% of days).
* Too many small interruptions when several teams are out. At 3× the clock stops every 7–12 seconds, mostly for cards with an obvious answer.
* Dull in winter and whenever the base is safe.
* The big threats (raids, hordes, hives, winter) are where the game should make you sweat, and that is exactly where the choices are thinnest or absent.

---

## 5. Bugs fixed

* **B1. A Breakdown card about a vehicle that was already gone.** A fast vehicle enters several tiles in one hour: the breakdown came up on the first and the vehicle ran dry and was left behind on a later one. The card then offered Repair / Spare part / Abandon, and each answered "The Old sedan is no longer with the team." Found by the tool's stale-answer check (balanced, seed 11, day 56).
  *Fix:* the breakdown card carries `vehicleId` (`events.js`), and `cardStale` (`parties.js`) drops a card whose vehicle the team no longer has. It is pruned at the end of the same hour, before the player sees it.
* **B2. Horde warnings fired once per horde ever.** `h.warned` was never reset after a horde was beaten off at the walls, so a horde that came back hit with no card (about half of all horde hits).
  *Fix:* `retreat()` in `defences.js` resets `warned`, as the decoy fire already did.
  *Side effect:* more "Horde heading for" cards (about 16 → 19 per run). Because manning the defences kills more of a horde, fewer hits overall (32 → 20 per run on 3 seeds). This touches horde feel, so the hive owner may want to know.
* **B3. Cosmetic text.**
  * "They mark the way they came on your map (0 tiles)" now says the way is already on your map (`visitors.js`).
  * The autopilot's caravan line no longer ends in ".." (`autopilot.js`).

Checked and clean: across 42 × 365 days there are **no duplicate cards**, no card with nothing to choose, no crashes, and (after B1) no cards answered after their subject was gone. Perk cards are withdrawn on the autopilot only, by its own midnight perk picker, which is intended.

Tools run after the fixes, all passing:

* `cardcount`
* `autotest 120 all 1 2 3`
* `teamtest`
* `fieldtest`
* `etatest 12`
* `hivetest 24`
* `visitortest 365 42`
* `dettest 60`
* `pacing 365 all`

---

## 6. Options: design changes not applied (pick any)

Effects are estimated from the 42-run data (2.40 cards a day now). "Feel" describes play at 1×/3×.

1. **Standing road orders (auto-answer the low-stakes travel cards).** Each team gets a few rules, set by stance or in the planner:
   * storms: shelter / push
   * supply trucks and caches: search / leave
   * patrols: share news
   * squabbles: step in
   * road hordes: hide / outrun
   * stories: let them talk
   * stranded traders: help

   These become lines in the team's report and a "Trip report" card when it is home. *Feel:* trips run themselves, you watch the dot move, and a card appears only when something worth a choice happens (a camp, survivors in trouble, the dead ahead, a crash, a recruit). *Effect:* removes about 7,400 of 30,669 cards, so **2.40 → about 1.82 a day** (aggressive 3.64 → about 2.6). The 6-hour bursts shrink most, because they are mostly road cards from several teams.
2. **Perk points stop pausing the clock.** Show a badge on the roster ("2 perk points to spend") and a non-pausing toast, not a card. *Feel:* you spend points when you open the skill tree, like RimWorld's passive letters. *Effect:* **2.40 → 2.23** (about 51 cards per run). Together with 1: **1.61 a day, one every 45 s at 1×.**
3. **One-button cards become log lines or toasts:** Radio signal, Prepper cache, "The horde is beaten", Overrun, Raid defense, The caravan raid, Ransom paid or refused. *Feel:* cleaner and fewer clicks. *Effect:* about 0.1 a day, small but free.
4. **Give "Prepare defenses" and "Man the defences" a cost.** For the alert's 1–2 days, farmers, builders and crafters stand on the walls, so no field work, building or crafting, plus an ammo cost. Show the cost on the card. *Feel:* every raid or horde warning becomes a question, "do we stop the harvest for this one?", and small raids are worth shrugging off. *Effect:* turns about 27 automatic clicks per run into real decisions. It may also make holding as you are against tiny raids correct, which adds variety.
5. **Make raids land, or say why they don't.** Show the expected outcome (defense against strength, "they will take about X food if they break in"). Add options with real trade-offs:
   * bring the nearest team home to fight (stops its trip)
   * hide the stores (−mood, less stolen)
   * pay part of the tribute

   *Feel:* raids become an event you plan around instead of a confirm-click. (Raid rates belong to another agent; this is about the card only.)
6. **A winter card (missing decision).** In late summer, or when the winter outlook first goes short, the card reads "The stores will not last the winter: about X short." Choices:
   * start rationing now (−mood, stretches food)
   * plan food runs (queues trips)
   * trade ammo or parts for food on the radio
   * close the gate to newcomers until it is covered

   *Feel:* a clear seasonal goal, the RimWorld "prepare for winter" tension, and something to do going into the dead winter months. *Effect:* about 1–2 cards per year, high impact.
7. **A hive card (missing decision).** When the dead start gathering at a build site within reach of your bases (or anywhere, as radio rumour), raise a card even out of sight: "Radio chatter: the dead are massing near X." Choices:
   * send a team to break it up now
   * mark it
   * ignore it

   *Feel:* the 4X threat becomes visible and actionable before it is a hive. *Effect:* currently 0 such moments per run reach the player. (Coordinate with the hive owner on how often sites appear.)
8. **A card when a group turns hostile or tears up a pact.** Choices: send an envoy with a gift, ask your allies to lean on them, prepare for raids, or let it be. *Feel:* diplomacy becomes something you react to. *Effect:* about 0.2–0.3 per run, cheap.
9. **Fix the dominant options inside the ONE ANSWER cards**, so the cards that stay are real:
   * Stranded traders: helping should *cost* (food or meds) and pay in goodwill and news later.
   * Storm: pushing through costs fuel or condition with a vehicle and saves the 6 hours.
   * Supply truck: show the free carry space, and make the search noisy (Heat).
   * Patrol: the gift buys a lasting pact discount.
   * Tempers flare: "let them sort it out" can make them friends.

   *Feel:* fewer reflex clicks and more "hm, which?". *Effect:* no change in card count; the one-answer share drops from 36%.
10. **A pacing director.** At most 2 road events per team per in-game day, and no low-stakes card within 6 hours of a crisis card (raid, horde at the walls, bitten, held). *Feel:* crises get the stage to themselves, and the worst 24-hour window drops from 28 cards toward about 12. *Effect:* caps the bursts without touching the averages much. Option 1 does most of this on its own.
11. **Fill the winter lull at home.** Weight the hub events (quarrels, cabin fever, frozen pumps, a hunting trip in the snow, a feast for the longest night) up in winter when no team is out, aiming at about 1 decision a day. *Feel:* winter becomes the season of people stories instead of an empty log. *Effect:* winter goes from about 1.5 to about 2 cards a day for cautious and balanced play.
12. **More cards like the great ones.** Build new road and site events on the Survivors in trouble / Camp by the road / crash site template: 3–4 options, each spending a different resource, the odds on the card, and a clock or a rival where possible. *Feel:* the cards that remain after 1–3 are the memorable ones.
