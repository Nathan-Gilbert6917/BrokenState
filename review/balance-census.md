# Broken State — balance census (100 autopilot campaigns)

Tool: `prototype/tools/balancesim.js` (README: "Balance census"). Command used:

```bash
node tools/balancesim.js 730 --json census.json
```

100 runs: seeds 1–34 × Cautious / Balanced / Aggressive (34 / 33 / 33), 8 AI groups, up to 730 days or until the holdout falls or wins. About 3 minutes on 12 worker threads. The tool only watches (new log lines, cards as they are added, the memorial wall, survivor flags between ticks), so runs play out exactly as without it; two full runs gave identical tables. No crashes, NaN, cards left open or stuck teams.

**Read the numbers with this in mind:** the autopilot is a competent but plain governor, not a player. Cautious and Balanced never storm a hive; Aggressive does from about day 130. Tactical battles (break-ins, "Defend in person") are played by the AI on both sides. Cards are answered instantly, and many of them come from the governor's own trips (Aggressive sends more teams, so it sees twice the cards of Cautious). So the census measures **the pressure the world puts on a reasonable holdout over time**. It does not measure how well a skilled human would do.

One bug was found and fixed along the way (see the end): outsider raiders who moved on to a second base arrived there with no warning card.

---

## The short version: what a player would feel

- **Days 1–60, a calm build-up.** 89% of days have no threat at all. A raider group shows up around **day 18** (median first raid warning), but group raids are held 97% of the time without a fight, so they feel like flavour, not danger. Cards come at about 2–3 a day, mostly from your own teams on the road (supply trucks, "The dead ahead", stranded traders). The first death is around day 87 (Balanced: day 133).
- **Days 60–120, the first hordes.** A horde first reaches a base around **day 83**, and the walls hold it. A big threat (a raid warning or a horde at the walls) comes about every **15 days**.
- **Days 120–180, a cliff, not a ramp.** Horde attacks jump from about 2 to **10 per 100 days** within one month. Deaths go from 2 to 9 per 100 days. A big threat now comes **every 7 days**.
- **From about day 200, the Wallbreaker.** The first break-in led by a Wallbreaker comes around **day 202**. 89% of all break-ins have one. A break-in is a massacre: 93 of 100 runs have a day with 4+ deaths, and the worst day kills a median of **8 people**. "In a fight with the horde and its Wallbreaker" causes **37% of all deaths**.
- **From day 270, constant siege.** A raid or a horde every **4–5 days**. A third of all days are "overlap" days (two or more crises within 3 days). Ammo is gone (median about 40 by day 270, 2 at the fall). Outsider raids rise to about 8 per 100 days.
- **The end comes fast.** Median fall on **day 307**. Once a run has lost half its peak population, the rest go in a median of **15 days**.
- **Nobody wins.** 98 of 100 runs fell and 2 reached day 730. There were **no hive victories and no alliance victories**. Hives grow from 6 to 13 by day 360 and 24 by day 720. Only 0.2 hives per run were destroyed.

In RimWorld terms: a cozy first two months, a jump in difficulty around month 4–5, then a raid-and-siege rhythm that never lets up. It ends in a Wallbreaker break-in that wipes half the colony in one day, with the colony thirsty and out of ammo. The pressure has no ceiling, and the player has no way to push it back down.

---

## 1. Outcomes

| Style | Runs | Fell | Hive victory | Alliance victory | Survived to day 730 |
|---|---|---|---|---|---|
| Cautious | 34 | 34 (100%) | 0 | 0 | 0 |
| Balanced | 33 | 32 (97%) | 0 | 0 | 1 |
| Aggressive | 33 | 32 (97%) | 0 | 0 | 1 |
| **All** | 100 | **98 (98%)** | 0 | 0 | 2 |

Day the holdout fell:

| Style | min | Q1 | median | Q3 | max |
|---|---|---|---|---|---|
| Cautious | 78 | 165 | **271** | 349 | 526 |
| Balanced | 134 | 224 | **308** | 374 | 518 |
| Aggressive | 105 | 271 | **381** | 448 | 726 |
| All | 78 | 216 | **307** | 407 | 726 |

Share of runs still going at each day:

| Style | d60 | d120 | d180 | d270 | d365 | d450 | d545 | d730 |
|---|---|---|---|---|---|---|---|---|
| Cautious | 100% | 91% | 74% | 50% | 21% | 3% | 0% | 0% |
| Balanced | 100% | 100% | 85% | 61% | 27% | 15% | 3% | 3% |
| Aggressive | 100% | 94% | 94% | 76% | 55% | 27% | 21% | 3% |
| All | 100% | 95% | 84% | 62% | 34% | 15% | 8% | 2% |

Turtling loses soonest. The threat grows on the world's clock (hives multiply whatever you do), so a holdout that stays small is overwhelmed sooner. Aggressive grows biggest (peak population 29 against Cautious's 17) and lasts longest, even though it loses the most people.

## 2. What kills people

Deaths per run by cause:

| Cause | Cautious | Balanced | Aggressive | All | Share |
|---|---|---|---|---|---|
| Horde at a base (break-in fights, overruns) | 7.5 | 15 | 19.1 | 13.8 | **43%** |
| Thirst | 5.6 | 8.8 | 6.4 | 6.9 | **21%** |
| Fights / scavenging in the field | 0.3 | 0.8 | 11.7 | 4.2 | 13% |
| Raid at a base | 0.5 | 0.8 | 6.2 | 2.5 | 8% |
| Illness | 1.8 | 1.9 | 3 | 2.3 | 7% |
| Starvation | 2.4 | 1.3 | 1.2 | 1.6 | 5% |
| Other (horde in the field, accidents, wounds) | 0.4 | 0.9 | 1.8 | 1 | 3% |

| Style | Deaths/run | Desertions/run | Peak pop (median) | Peak on day (median) |
|---|---|---|---|---|
| Cautious | 18.5 | 1 | 17 | 157 |
| Balanced | 29.4 | 1.1 | 23 | 237 |
| Aggressive | 49.4 | 4.3 | 29 | 218 |

The top raw causes are "in a fight with the horde and its Wallbreaker" (1,202 deaths), "of thirst" (687), "in a fight with the brood of the hive" (291, Aggressive's hive assaults), "of hunger" (159) and "of dysentery" (155).

**How runs end.** Losses in the last 30 days before a fall: horde at a base 59%, thirst 19%, starvation 10%, illness 5%, raids 3%, desertion 2%. Events in the last 3 days: a horde attack in 67 of 98 falls, hunger or thirst in 38, a raid in 32, often together.

**Snowball:** yes, at the end. Median days from losing half the peak population to the fall: **15** (Q1 3, Q3 65). From the first horde break-in to the fall: 98 days. Early size barely predicts survival: median population on day 61 was 11 in runs that later fell and 8 in the two that did not. A big early colony does not protect you; one bad break-in decides it.

**Thirst is seasonal.** Thirsty days by season are 803 in summer, about 425 each in autumn and winter, and 214 in spring, on similar run-days. 84% of runs go thirsty at some point, the first time around day 136, which is the first summer. Stored water stays at about 70 while the population triples.

## 3. How pressure ramps (per 100 run-days, runs still going)

"Big threat" = a raid warning card (AI group or outsider) or a horde reaching one of your bases. "Overlap day" = a day with 2+ different crises (raid, horde attack, serious illness or outbreak, death, hunger or thirst) within a 3-day window.

| Days | Runs going | Raids | Horde attacks | Deaths | Cards/day | Overlap days | Days between big threats |
|---|---|---|---|---|---|---|---|
| 1–60 | 100 | 4.3 | 0.9 | 1.6 | 2.6 | 4% | 19.2 |
| 61–120 | 100 | 4.5 | 2.2 | 2.4 | 1.8 | 10% | 14.9 |
| 121–180 | 95 | 5.1 | **9.7** | **9.1** | 2.8 | 20% | **6.8** |
| 181–270 | 84 | 5.5 | 12.7 | 13.8 | 2.2 | 28% | 5.5 |
| 271–365 | 62 | 7.9 | 14.9 | 16.4 | 2.2 | 32% | 4.4 |
| 366–730 | 34 | 8.2 | 17.3 | 20.7 | 1.8 | 32% | 3.9 |

By style (big threats every N days; deaths per 100 days):

| Style | d1–60 | d61–120 | d121–180 | d181–270 | d271–365 | d366+ |
|---|---|---|---|---|---|---|
| Cautious | 20.8 d · 0.7 † | 17.5 d · 1.7 † | 7.7 d · 6.8 † | 6.2 d · 11 † | 5.4 d · 14.7 † | 4.8 d · 25.3 † |
| Balanced | 20.6 d · 0.6 † | 15.6 d · 0.8 † | 6.8 d · 9.1 † | 5.5 d · 12.4 † | 4.4 d · 18.8 † | 4.3 d · 19.2 † |
| Aggressive | 16.6 d · 3.6 † | 12.5 d · 4.7 † | 6.1 d · 11.1 † | 5.0 d · 17.2 † | 3.9 d · 15.6 † | 3.7 d · 20.8 † |

Horde attacks by phase (all runs):

| Days | Attacks | Median horde size | Break-ins | Led by a Wallbreaker | Base overrun |
|---|---|---|---|---|---|
| 1–90 | 110 | 45 | 8 (7%) | 0 | 5 |
| 91–150 | 314 | 69 | 41 (13%) | 32 | 20 |
| 151–240 | 825 | 61 | 124 (15%) | 114 | 59 |
| 241–365 | 969 | 65 | 179 (18%) | 163 | 99 |
| 366–730 | 714 | 66 | 158 (22%) | 146 | 72 |

Horde *sizes* barely grow after day 90. What grows is how often they come (more hives, more hordes) and whether a Wallbreaker leads them. A Wallbreaker cuts the hold limit to 60%, or 35% with two (`defences.js` DEFENCE.BOSS).

## 4. Feel: first threats, card load, quiet and overlap

First time each thing happens (median day; in how many runs it happened):

| Style | First death | First raid warning | First horde warning | First horde at a base | First break-in | First base overrun by the dead | First desertion |
|---|---|---|---|---|---|---|---|
| Cautious | 118 (34) | 26 (34) | 79 (32) | 97 (31) | 248 (18) | 258 (17) | 149 (18) |
| Balanced | 133 (33) | 17 (33) | 57 (33) | 70 (33) | 178 (23) | 214 (21) | 170 (16) |
| Aggressive | 51 (33) | 16 (33) | 55 (33) | 78 (32) | 182 (28) | 206 (28) | 49 (27) |
| All | 87 (100) | 18 (100) | 63 (98) | 83 (96) | 183 (69) | 232 (66) | 118 (61) |

| Style | Cards/day | p90 day | Busiest day | Overlap days | 3+ crises | Longest stretch with no card, days (median / max) | Longest stretch with no threat (median / max) |
|---|---|---|---|---|---|---|---|
| Cautious | 1.4 | 3 | 19 | 14% | 4% | 5 / 9 | 29 / 86 |
| Balanced | 2.0 | 5 | 24 | 18% | 4% | 4 / 10 | 26 / 72 |
| Aggressive | 3.0 | 8 | 20 | 26% | 8% | 4 / 6 | 23 / 43 |
| All | 2.2 | 6 | 24 | 20% | 5% | 4 / 10 | 26 / 86 |

Cards per day over every run-day: 0 cards 26%, 1 card 26%, 2 cards 16%, 3 cards 9%, 4–5 cards 12%, 6–9 cards 8%, 10+ cards 2%.

- **The card load is fine.** About 2 a day, rarely over 6, and never a week without one. Base and world cards (the ones that come to you, not from your teams) rise slowly from 0.6 a day to 1.2 a day. A player will not drown in cards.
- **The threat load is not.** The overload is about *what* the cards are, not how many. After day 270 one day in three sits inside a pile-up of 2+ crises, and the rhythm is a raid or horde every 4–5 days with deaths almost weekly.
- **The quiet stretches are all early.** The longest threat-free stretch (median 26 days) is almost always in the first two months. After day 150 the longest gap between big threats is short.

Most common cards (per 100 run-days): Done: Scavenge / raid 15.3 · Travellers at <base> 12.3 · The dead ahead 10.3 · Abandoned supply truck 9.0 · Horde of # 8.3 · <person> reached Farming # 8.1 · Stranded traders 7.2 · A survivor alone 7.2 · Storm 7.1 · Tempers flare 6.9 · A stranger at the gate 5.8 · Horde heading for <base> 5.5 · A quarrel at <base> 5.4 · Job offer 4.5 · Traders on the radio 4.1. Travellers at the gate and "reached Farming #" are the repetitive ones: a player sees each about once every 8–12 days.

## 5. Hives, hordes, raids, the other groups

| Style | Hives at start | Built | Destroyed | Hordes made | Horde warnings | Horde attacks/run | Held at the walls | Broke in → repelled | Broke in → overrun |
|---|---|---|---|---|---|---|---|---|---|
| Cautious | 6.5 | 5.1 | 0 | 211 | 10.6 | 15.4 | 82% | 6% | 9% |
| Balanced | 6.5 | 6.3 | 0 | 253 | 18 | 28.5 | 82% | 9% | 8% |
| Aggressive | 6.5 | 7.7 | 0.7 | 294 | 25.6 | 44.4 | 80% | 9% | 9% |

Hives standing (median): 6 (d1) → 7 (d91) → 9 (d181) → 11 (d271) → 13 (d361) → 15 (d451) → 18 (d541) → 24 (d721). Hordes on the map: 0 → 22 → 28 → 32 → 35 → 38 → 54; dead in hordes: 2,100 (d91) → 3,600 (d361) → 5,500 (d721).

Hive assaults (Aggressive only): 2.3 per run, the first around day 133, **0.3 hives destroyed per assault**. Building outpaces destroying about 10 to 1.

Raids on your bases:

| Style | Group raids/run | Outsider raids/run | Held | Held in a fight | Broke in | Overrun | Paid off | At outposts |
|---|---|---|---|---|---|---|---|---|
| Cautious | 8.1 | 6.3 | 72% | 0% | 2% | 3% | 22% | 8% |
| Balanced | 8.3 | 8.5 | 74% | 0% | 3% | 8% | 14% | 10% |
| Aggressive | 10.4 | 14.1 | 37% | 15% | 3% | 32% | 12% | 27% |

AI-group raids are almost always held: 842 of 895 over all runs (94%; 97% in days 1–60), and only 23 overran a base. They are frequent and toothless. Outsider raids are the dangerous ones: 31% of them overran a base. Aggressive picks "Defend in person" against outsiders and wins only about 1 in 3 of those fights (119 held in a fight, 241 overrun). Raid attackers: outsiders 9.6 per run, raider groups 7.2, zealots 1.2, expansionists 0.6.

The other groups: 8.3 wars started per run (almost all end in peace). 2.6 groups collapse per run, the first around day 154. A coalition formed in only 16% of runs (none for Aggressive), with a median of 0 members. Land held by you plus the coalition stays at **5–8%** against the 50% the alliance victory needs.

## 6. Stocks

Median across all your bases (runs still going):

| | d1 | d91 | d181 | d271 | d361 | d451 |
|---|---|---|---|---|---|---|
| Food (fresh + preserved) | 90 | 249 | 771 | 649 | 439 | 428 |
| Water | 50 | 70 | 76 | 79 | 72 | 166 |
| Meds | 6 | 20 | 31 | 20 | 15 | 7 |
| Ammo | 80 | 189 | 144 | **40** | **37** | **1** |

| Style | Days out of food (per run) | Days out of water | Days on short rations | Runs ever hungry | Runs ever thirsty |
|---|---|---|---|---|---|
| Cautious | 5.5 | 10.5 | 5.5 | 59% | 68% |
| Balanced | 3.6 | 16.7 | 6.3 | 61% | 91% |
| Aggressive | 4 | 29 | 16.7 | 85% | 94% |

Food is comfortable through the first year: the autumn stores work. Water and ammo are the problems. Every horde at the walls burns 3 ammo for each person at the base (`defences.js` hordeAttackBase), so at 15+ attacks per 100 days with 20 people, ammo bleeds out by month 9. The median ammo at the last sample before a fall was 2.

---

## Bug fixed

**Outsider raiders hitting a second base came with no warning card.** `visitors.js`: a raider band's `warned` flag was set once per band and never cleared. After a band hit the hub, it often moved on to an outpost (`retargetRaiders`) and arrived there with no "Outsider raiders heading for …" card. That meant no chance to prepare, pay or fight, and the outpost was usually lost. In the first 6-run test, 5 of about 45 raids came in this way, all on outposts. Fix: `setGoal` clears `warned` when the band picks a *different* base, so that base's lookouts warn again. The census above includes the fix: 0 raids arrived unwarned. `autotest.js 120 all 1 2 3` and `visitortest.js 365 42` (103/103) pass.

No other code errors were found: no crashes, NaN, stuck teams or cards left open in 100 × up to 730 days.

---

## Balance options (not applied; pick any)

Numbers are left alone. Hive config, raid rates and the economy belong to other agents. Each option says what it would feel like in play.

1. **Give the hives a ceiling, or let killing one push the clock back.** Hives go from 6 to 24 and the player destroys 0.2 per run. For example, pick new hive sites less often as the count grows, or skip a site pick for every hive destroyed. *Feel:* the late game stays tense, but clearing a hive visibly lowers the pressure. You get a "we're winning" phase instead of a slow drowning.
2. **Turn the day 120–150 cliff into a ramp.** Horde attacks go from about 2 to 10 per 100 days in one month. Small hordes could visit from about day 40 and grow steadily. *Feel:* the player learns walls and "Man the defences" against small hordes first, and month 5 feels like an escalation, not a different game.
3. **Make the Wallbreaker a dreaded event, not a coin flip on the colony.** It leads 89% of break-ins and causes 37% of all deaths, with a median worst day of 8 deaths. Options: a milder hold-limit cut (for example 0.75 instead of 0.6, and 0.5 instead of 0.35 for two), at most one per horde, or an earlier, special warning (spotted 10 tiles out, with the choices that work on it). *Feel:* "the Wallbreaker is coming" makes you scramble and lose someone, not half the colony overnight.
4. **Give the early game teeth.** In days 1–60, 89% of days have no threat and AI-group raids are held 97% of the time without a choice that matters. Make early raids smaller but real (a break-in is possible if nobody is on guard), or add early hub crises. *Feel:* the RimWorld "three raiders with clubs" moment, where your first guard post matters.
5. **A summer water warning, or more water.** Thirst is the #2 killer (21% of deaths) and peaks in summer, starting around day 136. The water outlook could warn a week before summer, or rain catchers and wells could scale with the population. *Feel:* a seasonal crunch you see coming and prepare for, like winter food, instead of a silent killer.
6. **Stop the hidden ammo bleed.** 3 ammo per person per horde attack empties the stores by month 9, and falls come with median ammo 2. Options: only guards and manned posts spend ammo, cost by horde size, or an ammo-free melee defence. *Feel:* late fights are lost to the dead, not to an invisible tax.
7. **One crisis at a time, at the same base.** After day 270, 32% of days are overlap days. A spacing rule could stop a horde from arriving at a base within 48 hours of a raid there, or have raiders hold off while a horde is near. *Feel:* the tension stays, but each crisis gets its own beat, and you answer it instead of watching three land at once.
8. **A comeback brake.** Once half the peak population is lost, the end comes in a median of 15 days. Make recruits, refugees and returning deserters more likely while the holdout is small and hurting, or have hordes prefer bigger targets. *Feel:* a near-wipe becomes a "rebuild from 4 survivors" story, not a 2-week epilogue.
9. **Make the alliance victory reachable.** A coalition formed in 16% of runs and land holds at 5–8% against the 50% needed, with every living group required to join. Options: lower the land share, count coalition outposts' land, or leave out hostile and collapsed groups. *Feel:* diplomacy becomes a real way to win, not flavour.
10. **Check "Defend in person" against outsiders.** In AI hands it loses 2 of 3 base fights against outsider bands (the autopilot only picks it at ≥0.9× strength). This matches playtest finding P-4 (the battle can field more than the card's strength). *Feel:* the tactical choice should be the skilled player's edge, not a trap.
11. **(Autopilot, not game balance)** Let Balanced storm hives too, and let the governor keep a summer water reserve. Then the census would show whether the hive victory is reachable at all with steady play. Right now only Aggressive tries, and it destroys 0.3 hives per assault.
