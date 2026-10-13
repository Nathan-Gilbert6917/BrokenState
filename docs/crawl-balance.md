# Crawl balance automation (2026-10-13)

A harness that plays the **city crawl** and the **hive crawl** end to end, headless, over a grid of scenarios you
control, and prints a table of outcomes against stated targets. It exists so a balance change to either crawl is a
number you can read, not a feeling.

    node tools/crawlbalance.js hive --tier 1,2,3,4 --squad early,solid,rifles,elite --trips 4
    node tools/crawlbalance.js city --depth 2,4 --squad naked,scrappy,early,solid,rifles
    node tools/crawlbalance.js both --trials 20 --json out.json          # a full baseline
    node tools/crawlbalance.js hive --tier 2 --squad solid --trips 4 --set HCRAWL.BROOD.perLayer=0.7   # A/B a tweak
    node tools/crawlbalance.js hive --tier 3 --squad elite --trials 1 --seed 4001 --trace            # follow one run

Source: `prototype/tools/crawlbalance.js`. Runs about 1 s per hive trial and 0.1 s per city trial; a 20-trial full
grid takes 1–4 minutes.

## What it controls

| knob | flag | notes |
|---|---|---|
| hive tier, guard | `--tier 1,2,3,4`, `--guard 80` | the game day defaults to the tier's opening day (400 / 900 / 1600 / 2100); `--day` overrides |
| trips per scenario | `--trips N`, `--rest D` | between trips the squad heals, restocks and rests D days (chambers refill by `REFILL_DAYS`) |
| city depth, start block, day | `--depth`, `--block`, `--day` | `--depth` is the autopilot's `CRAWL.AUTO.depth`; `--block` starts the crawl on that block (the middle column straight down) |
| city way out | `--way safer,back,new` | `safer` (the autopilot's: the way with the lower risk), `back` (the route in) or `new` (another way out, where it can); `CRAWL.AUTO.way` |
| survivors and gear | `--squad name,…` or `--n --weapon --armor --shoot --health --lights --fire --stun --ammo --meds` | named loadouts in `LOADOUTS`: naked, scrappy, early, hunters, solid, rifles, elite |
| retreat policy | `--style balanced` | the break-off policy of that autopilot style, set on the team (`none`: fight to the end, a player's default) |
| tuning numbers | `--set HCRAWL.X.y=…,CRAWL.X.y=…` | overrides a constant for this run only (roots: `HCRAWL`, `HIVEMIND`, `CRAWL`, `EVENTS`) |

Seeds are deterministic (`--seed`, `--trials`), so the same scenario before and after a change differs only by the
change (and by the dice shifting after any changed decision: read rows in aggregate, 16–20 trials gives ±10 points).

## What it measures

Hive: **win** (the Hivemind dead within `--trips`), **wiped** (nobody left), **lost/sq** (share of the squad lost),
hours, ammo, den depth, and with `--why` the reason each trip ended (`won`, `core too much`, `too many hurt`, `alert`,
`turned back`, `wiped`). City: **out** (the team comes back alive), wiped, lost share, hours, loot (supplies + 4 per
piece of gear), ammo, fights and fights lost, and on the grid **side** (blocks walked off the middle column), **new**
(the share that left by another way out) and **out lost** (the share of the squad lost after it set off for the way
out); with `--why` how each crawl ended (`edge`: out from block 1, `back`, `new`, `wiped`, `stuck`).

The crawls are driven by the autopilot's own steps (`hiveCrawlAutoStep`, `crawlAutoStep`), so the table is "what the
governor's teams get", which is also what a careful player gets by the numbers. It is **not** a map-play bot: the
street and building fights on the map are not played (a lost-fight-by-the-numbers is the model, not the map).

## Targets (design intent, `TARGETS` in the tool)

A row is judged ✓/✗ against `[min win, max win, max share of squad lost]`. The intent: a hive tier's opening squad
should struggle, a squad one rung up should usually win in a few trips, two rungs up should win cheaply; a city crawl
two blocks deep should be survivable for anyone with a gun and cost real lives for an unarmed team.

| hive tier | scrappy / early | solid (shotguns, vests) | rifles (AR, plate) | elite (8, AR, plate, Shooting 10) |
|---|---|---|---|---|
| 1 | 5–50% / 40–90% win | 70%+ | 85%+ | – |
| 2 | 0–15% / 10–55% | 40–85% | 70%+ | – |
| 3 | – / 0–20% | 15–60% | 40–85% | 60%+ |
| 4 | – | 0–20% | 15–60% | 40–85% |

Targets are a statement of intent; edit `TARGETS` when the design changes, not to make a row green.

## Findings from the first baseline (commit before these changes)

Hive crawl, 1 trip: nobody wins at tier 3–4 and almost nobody at tier 2 in one trip. That is the autopilot walking in,
getting hurt and turning back; chambers it cleared stay clear (`REFILL_DAYS` 14) so the second and third trip get
further. With **4 trips** the picture is close to intent:

| tier | early | hunters | solid | rifles | elite |
|---|---|---|---|---|---|
| 1 | 0% | 100% | 94% | 100% | 100% |
| 2 | 0% (68% lost) | 25% | 19% | 94% | 94% |
| 3 | 0% (69% lost) | 0% | 0% | 19% (43% lost) | 56% |
| 4 | 0% | 0% | 0% | 0% (61% lost) | 38% |

The hive crawl was calibrated earlier (`HIVEMIND.numbersK`, `powerTier`, `tools/hivecorecalib.js`); the knobs I tried
(`HIVEMIND.powerTier`, `perTier`, `HCRAWL.NUMBERS.k`, `BROOD.perLayer`, `AUTO.coreOdds`) moved rows by less than the
noise or traded wins for deaths one for one, so **the hive crawl is left as it is**. What limits a trip is "too many
hurt" in the chambers (34 of 62 trips at tier 2 for `solid`), not the core. Where it would still pay to look: tier 2
for shotgun squads (19% against a 40% target) and tier 3 for rifles (19% against 40%); the likeliest lever is the
medical side (`AUTO.treat`, `TREAT_HOURS`, meds carried) and not the brood's numbers.

City crawl: the autopilot only crawls 2 blocks (`CRAWL.AUTO.depth`) and leaves if hurt, so `--depth` barely moves the
table; the rows are judged at depth 2 and 4 only.

**A correction.** The first city baseline had teams fighting *to the end*: a team only gets the autopilot's break-off
policy (`breakoff.js STYLE_POLICY`: balanced and cautious break off a fight that is being lost) when the autopilot is
on, and the harness had it off. That made every lost street fight a massacre (a defeat killed 75% of the team, 8–30%
of teams were wiped) and is what a player's team still gets by default (`Never`). The harness now sets the policy of
`--style` on the team (default balanced; `--style none` for a player's fight-to-the-end team). Turning the autopilot on
instead is wrong: the governor then steps the crawl itself every hour, and the team is driven twice.

With the policy, nobody is wiped in a 2–4 block crawl, and the losses (40 trials, depth 2) are:

| squad | lost, the old numbers | lost, the new numbers | fights a crawl |
|---|---|---|---|
| naked (4, bats) | 14% | 11% | 0.7 → 0.5 |
| scrappy (5, pistols) | 12% | 11% | 0.8 → 0.7 |
| early (5, shotgun, vest) | 14% | 10% | 1.1 → 0.8 |
| solid (6, shotgun, vest) | 7% | 6% | 1.0 → 0.9 |
| rifles (6, AR, plate) | 7% | 6% | 1.0 → 0.9 |

The tweaks (all in `citycrawl.js`) were picked against the fight-to-the-end baseline, where they mattered a lot (a
naked team's losses 48% → 27%); against the corrected one they are a modest early-game relief and are kept:

- `AUTO.sureOdds` 0.85 → 0.92 and `AUTO.fightOdds` 0.65 → 0.80: the governor fights only what it is nearly sure of
  and otherwise hides, lures or runs.
- `ENC.base` 0.08 → 0.06 (trouble on the way to the next block) and `QUICK.fight` 0.30 → 0.22 (a search by the
  numbers brings a fight less often). These apply to a player's crawl too.

All 10 judged city rows are inside their targets.

## The autopilot crawls the city, down to block 5 (2026-10-13, later the same day)

Before, the autopilot never crawled a city: on autopilot a city was searched hour by hour (`scavenge.js
startScavenge`), and `crawlAutoStep` only finished a crawl the player had left open; that one went 2 blocks deep and
searched only places that *looked* "Quiet" or "A few of the dead about", which no place below block 3 does. Now:

- `scavenge.js`: an autopilot team that scavenges a city starts a crawl; the governor steps it every hour
  (`autopilot.js idleTeams`, as before for an open crawl).
- `CRAWL.AUTO.depth` 2 → **5**. At the edge the team plans its block (`citycrawl.js autoDepth`): the deepest, up to 5,
  where most of the edge block's places, as deep as that, would still be searched at `planOdds` 0.9 or better
  (`planShare` 0.67: deeper blocks hold worse places than the edge's), and where it would still fight the horde
  that block's street can throw at it (`streetOdds` at `sureOdds` 0.92). It walks the blocks on the way and searches
  at its block; with room left and a block it could work it goes one deeper, never past 5.
- What it searches: `searchOdds` (new) is the odds of winning the fight a quick search could bring (half the dead
  inside, the raiders all); it searches places at `AUTO.searchOdds` 0.85 or better, and, come all that way with none
  left, one at `fightOdds` 0.8.

Depth did not pay at first: a team's take is capped by what it can carry, so a deeper, richer block only filled the
packs sooner, while the walk down costs street fights that kill even when won (rifles at block 5: 23% of the squad
lost for the value block 2 gave at 7%). To make the walk cheaper and the search better:

- `ENC.perBlock` 0.07 → 0.05 (trouble on the way down grows more slowly with the block),
- `QUICK.rollsPerBlock` 0.75 (new: a search by the numbers finds 0.75 more rolls a block deeper; 6 at block 5),
- `RICH.perBlock` 0.15 → 0.25 (what a container holds, a block deeper).

City crawl after (40 trials, day 60, balanced retreat policy; value is trade value):

| squad | depth reached | value home | squad lost | judged |
|---|---|---|---|---|
| naked (4, bats) | 1.3 | 58 | 4% | ✓ |
| scrappy (5, pistols) | 1.7 | 116 | 8% | ✓ |
| early (5, shotgun, vest) | 2.0 | 141 | 5% | ✓ |
| solid (6, shotgun, vest) | 2.5 | 215 | 12% | ✓ |
| rifles (6, AR, plate) | 3.8 | 201 | 13% | ✓ |
| elite (8, AR, plate) | 4.8 | 232 | 24% | ✓ |

Weak teams stay near the edge, strong ones go down to 4–5. A team of three (the size the governor mostly sends)
stays at blocks 1–2 whatever its kit: 1–8% lost.

### Deep loot: depth pays (`src/sim/deeploot.js`)

A team's take is capped by what it can carry, so a deeper block that only held *more* filled the packs sooner and
paid nothing (rifles: 201 at block 5 against 203 at block 2, for twice the losses). Now deeper places hold what is
dear by the kilo:

- **The shift** (`deepShift`, from block `DEEP.from` 3, k = 1 at block 3): supplies worth under 3 a kilo (tins,
  water, scrap) × (1 − 0.2k), at least × 0.35; those worth 10 a kilo or more (rounds, meds, gun parts,
  electronics) × (1 + 0.25k); the middle (parts, fuel) as before. The outer streets were stripped of the everyday
  bulk first; the heart of the city emptied in a day and still holds what is small and dear. Applied to a quick
  search and to a building played on the map (`combat.js searchBox`, `b.raid.deep`).
- **Caches** (`cacheChance`: 12% a block from block 3, at most 50%): a quick search turns up a locker or a stash as
  well, rolled as a pharmacy, gun shop, armoury, lockers or clinic at richness 1.5; only its gear and its dear
  supplies are taken.

### A full team swaps (`citycrawl.js give`, exported as `takeFinds`)

Finds are taken most wanted a kilo first, and when the packs are full a find worth more a kilo takes the place of the
least wanted cargo (at least 25% better: `DEEP.swapMargin`). Worth is value a kilo × what the home base wants
(`wantOf`): food 3× when the base has under a week (1.8× under 20 days, 0.5× over 60), water likewise by days, meds
2× under one a head, rounds 1.6× under 20 a head; what the base has plenty of counts half. What is put down stays in
the city, and the line says so ("put down to make room: 31 scrap"). This applies to your teams' crawls as well as the
autopilot's.

City crawl now (40 trials, value = trade value home):

| squad | block 2: value / lost | block 5 (its plan): depth, value / lost |
|---|---|---|
| naked (4) | 54 / 3% | 1.3, 54 / 3% |
| scrappy (5) | 125 / 5% | 1.6, 125 / 5% |
| early (5) | 157 / 7% | 1.6, 137 / 8% |
| solid (6) | 202 / 7% | 2.6, 270 / 15% |
| rifles (6) | 207 / 7% | 3.9, 288 / 20% |
| elite (8) | 249 / 9% | 4.9, 395 / 27% |

Going deep is now a real trade: a rifle squad brings home 40% more and an elite one 60% more, for two to three times
the losses. All 11 judged rows are inside their targets. `tools/deeploottest.js` checks the shift, the caches, the
base's wants and the swap.

## Leaving a city, heat over time, and each block's zombie activity (2026-10-13)

There is no stepping out of a crawl. You leave one of two ways (`citycrawl.js leaveCity(state, p, way)`; the window has
a button for each):

- **Back the way you came** (`"back"`): the blocks you came in by, block by block to the edge (half an hour each),
  safer nearer the edge; but the noise you made on each is still on its streets (`CRAWL.TRAIL`). Whatever raised the
  Alert on a block (fights and shots, searches, alarms, walking in) also builds that block's own heat: × (1 + 0.15
  for each of the team over three), × 0.6 for a team travelling stealthily, fading 0.5 an hour. Each block's risk on
  the way back is + its heat × 0.006 (× its activity, below).
- **Find another way out** (`"new"`): streets you have not walked, none of your noise on them, but as deep as where
  you turned off all the way, an hour each. How many is the city's to say: 1 up to the deepest block you reached
  (`hash01` of the visit and the turn-off: the same answer for the same choice), found out on the way.

A roused city (Alert 70+ from block 3) still makes the first block of either way a fight. The autopilot takes the way
with the lower expected risk.

**Time.** The Alert no longer fades by itself in the city: it rises `ALERT.creep` 1.5 an hour you stay (the dead
drift toward the living), so a long crawl meets more on the street. Lying low takes it down (12, less the hour's
creep); looking around makes no noise but the hour still passes.

**Zombie activity** (`CRAWL.THREAT`, `threatOf`): each block of a city has its own level, by the city's dice (the
same every visit; you learn it when you stand on it): Quiet ×0.6, Stirring ×0.8, Busy ×1, Infested ×1.35,
Crawling ×1.8 (weights 20 / 25 / 25 / 18 / 12%). It scales the block's own danger and multiplies its heat:
`blockHeat` = (the city's Alert + the block's trail) × its level. That heat drives the chance of trouble on its
street (`moveRisk`, lying low), on the way back through it (`exitRisk`), the size of a horde there, and the chance a
quick search brings a fight; so the same noise on a crawling block costs three times what it does on a quiet one.
The new streets of another way out each roll their own level as you walk them. The window shows the block's
activity and its heat; the next block's activity is unknown until you get there.

The harness rows hardly move (crawls are short: 3–11 hours), and all 11 judged rows stay inside their targets.
`tools/citycrawltest.js` checks the two ways, the trail, the creep and the activity levels.

## Each chamber's brood activity and heat in the hive crawl (2026-10-13)

The hive crawl now works the way the city crawl's blocks do (`hivecrawl.js HCRAWL.THREAT`, `HCRAWL.HEAT`):

- **Brood activity** (`chamberThreat`): every chamber of a den has its own level by the hive's dice (the same every
  visit; you learn it when you stand in it): Torpid ×0.6, Stirring ×0.8, Active ×1, Teeming ×1.35, Seething ×1.8
  (weights 20 / 25 / 25 / 18 / 12%, as the city's).
- **A chamber's own heat**: whatever raises the hive's Alert in a chamber (walking in, fights and shots, fire,
  searching, a failed sneak) also stays in that chamber, × 0.6 for a stealthy team, fading 3 an hour; lying still
  cools it as it does the Alert.
- **`roomHeat`** = (the hive's Alert + the chamber's heat) × its activity. It replaces the bare Alert where the danger
  is the chamber's: whether its brood has seen you on the way in (and on the way out), the DC to creep past, a swarm
  pouring into your chamber (its chance and size, capped as at Alert 100) and a patrol finding you lying still. The
  brood flowing back behind you and the mouth packing up still go by the hive's Alert. The autopilot lies still, burns
  and listens by the chamber's heat, and now falls back from an encounter when too many of the team are hurt (before,
  a second swarm on the heels of a fight was fought at the shown odds with the team at a quarter health, and wiped it).
- The window shows the chamber's activity and its heat under the Alert; Help has a paragraph on it.

Verified with the autopilot's own crawl steps (`node tools/crawlbalance.js hive --trials 40 --trips 3 --seed 5000`):

| tier | squad | win before → after | lost/squad before → after |
|---|---|---|---|
| 1 | early | 0% → 0% | 20% → 17% |
| 1 | solid | 93% → 95% | 13% → 10% |
| 1 | rifles | 100% → 100% | 0% → 1% |
| 2 | early | 0% → 0% | 47% → 48% |
| 2 | solid | 10% → 15% | 40% → 40% |
| 2 | rifles | 88% → 95% | 5% → 7% |
| 3 | early | 0% → 0% | 70% → 71% |
| 3 | solid | 0% → 0% | 40% → 38% |
| 3 | rifles | 18% → 10% | 32% → 37% |

4 of 9 judged rows inside their targets before and after (the 5 off were off already). A first cut with the heat
fading 1 an hour and 0.15 more a person over three made every row harder (tier 3 rifles: 0% won, 48% lost), so it
fades as fast as the Alert and a team's size does not add to it. `tools/hivecrawltest.js` checks the levels, the
heat and its cooling; `tools/wintest.js --force hive` still wins on day 91. (`hivecrawltest` seeds 8, 11, 12 and 13
fail on dev without this change too: the young-hive and deep-hive autopilot checks are seed-sensitive.)

## The city is a grid: left, right or straight (2026-10-13)

A crawl no longer runs down one line of blocks. The city is a grid (`citycrawl.js`, "the grid"): rows are the
depth (block 1 is the edge), columns the cross streets, 5–7 across by the city's dice (`CRAWL.GRID.half` 2–3 to
either side). From a block the team goes **straight on** (a block deeper) or **left** or **right** along a cross
street (the same depth, other places). A cross street is shut at 25% (`GRID.side` 0.75 open, the city's dice, the
same every visit); the way deeper is always open unless a street event blocks it this visit. Every block of the grid
has its own places, events and zombie activity by the city's dice; the middle column keeps exactly the blocks, ids and
building maps it had before, so old saves load onto it. The window draws the grid (walked blocks by their activity,
the route in outlined, where you stand in white, shut cross streets as gaps) and offers three buttons for the three ways.

**The route in** (`c.path`) is the blocks the team walked from the edge to where it stands; walking somewhere and back
cuts the loop. Its length is what both ways out are measured by:

- **Back the way you came**: along the route in, reversed, to the first edge block it reaches, half an hour a block.
  Each block carries the heat the team left on it (its trail: shots, fights, searches, walking in; more for a big
  team, less for a stealthy one), × its activity. Sideways blocks count like any other.
- **Find another way out**: on through blocks not walked this crawl, the team picking left, right or straight at each
  (no time to search; a walked block is refused). A way out turns up after 1 to as many blocks as the route in (the
  visit's dice, found out on the way). No trail on new blocks, their activity unknown till you get there; each is
  as risky as the way out at its depth. Running from trouble on the way gets you through onto the block you were
  heading for. You can turn back the way you came at any point (the route in then includes the new blocks).

The autopilot works its block, goes deeper while it may (as before), and at its depth limit works one block to the
side (`AUTO.autoSide` 1 a depth) before leaving. Looking for another way out it prefers cross streets to going deeper.

**A bug the runs found, fixed before merging:** on another way out, running from trouble first fell back to the block
you were on, and the autopilot walked into the same horde again, hour after hour, until the team was dead (2–5%
of deep crawls wiped). Trouble on the way out is now run *through*, as it always was on the way back.

City crawl after (40 trials, seeds 4000+, day 60; value is trade value):

| squad | block 2: value / lost (before) | block 5 plan: depth, value / lost (before) |
|---|---|---|
| naked (4) | 54 / 3% (54 / 3%) | 1.3, 54 / 3% (1.3, 54 / 3%) |
| scrappy (5) | 121 / 6% (119 / 5%) | 1.4, 119 / 5% (1.4, 119 / 5%) |
| early (5) | 165 / 7% (154 / 7%) | 1.6, 134 / 9% (1.6, 131 / 9%) |
| solid (6) | 224 / 9% (207 / 8%) | 2.8, 260 / 15% (2.6, 259 / 15%) |
| rifles (6) | 233 / 8% (212 / 9%) | 4.0, 301 / 18% (3.8, 290 / 16%) |
| elite (8) | 296 / 13% (245 / 11%) | 5.0, 411 / 30% (4.9, 363 / 28%) |

Nobody is wiped. The block-2 rows bring home more because at that limit the team now works a block across before
leaving (8–20% more value, 0–2 points more lost). The elite row is on its line (30% against a 30% cap): one block worked across at depth 5
brings 13% more home for 2 points more lost. On another 80 seeds (6000+) it is over the line before this change too
(31%, the old code), 32% with `autoSide` 0 and 36% with 1; `--set CRAWL.AUTO.autoSide=0` turns the sideways block
off. 10 of 11 judged rows inside their targets. `tools/citycrawltest.js` checks the grid, the three ways, the route
in and its loops, both ways out along it, the refusal of walked blocks and old saves.

## Testing the grid with the harness (2026-10-13)

The harness was extended to rate the grid (`tools/crawlbalance.js`): `--way safer,back,new` forces how the team leaves
(`CRAWL.AUTO.way`, default `safer`, the autopilot's choice as before), the table gains **side**, **new** and **out
lost**, and `--why` says how each city crawl ended. Two harness bugs were fixed on the way:

- `--day 400,1600` (or `--block 3,4,5`) crashed or did nothing: the city mode read them with `Number`, so a list was
  NaN (`--day`: `weather.js iceIndex` of NaN, a TypeError; `--block`: silently block 1). Both are lists now, as the
  usage says, and so is the hive's `--day`.
- `--block N` left `c.deepest` at 1, so the **deep** column under-read a crawl that started deep.

With defaults the table is exactly the one above (same seeds, same numbers). What the runs say (40 trials, seeds
6000+, day 60, plan block 5, balanced retreat policy unless said):

**The way out barely matters by the numbers.** Forcing every team out one way or the other:

| squad | safer: lost / out lost / new | back: lost / out lost | new: lost / out lost / side |
|---|---|---|---|
| scrappy (5) | 5% / 0% / 25% | 5% / 0% | 5% / 0% / 0.6 |
| solid (6) | 13% / 2% / 55% | 15% / 4% | 13% / 2% / 1.5 |
| rifles (6) | 20% / 6% / 53% | 21% / 7% | 20% / 6% / 2.0 |
| elite (8) | 34% / 9% / 43% | 36% / 11% | 34% / 8% / 2.6 |

Another way out is 1–3 points safer than the route in (no trail on its blocks), and the autopilot's `safer` pick is
as good as always taking it. Most of the loss is on the way *in* and in the searches: the way out is a quarter of a
deep crawl's losses. Value home does not change (another way out has no time to search). If the choice is meant to be
a real one, the trail on the way back (`CRAWL.TRAIL.perTrail`) or the unknown activity of new blocks are the levers.

**A player's team (`--style none`, fight to the end) is wiped on deep crawls**: solid 3%, rifles 10%, elite 15% of
crawls (5 / 13 / 20% when every team goes back the way it came), 20–51% of the squad lost. This is finding 5 below, and the grid's
deeper crawls make it worse: the more blocks walked, the more street fights.

**Later days** (`--day 400,1600`): the rows hold (rifles 18–23% lost, elite 33–34%), the loot by weight falls as the
city is picked over (scrappy 126 → 74). Day 1600 rifles is a point over its 22% line.

**Starting deep works now** (`--block 3,5`; finding 6 below said the autopilot left at once): from block 5 the team
crawls on to 5.5–5.7, walks 2–2.5 blocks to the side and leaves by another way out 90% of the time; elite brings home
630 (twice the edge start) for 22% lost, solid 255 for 11%.

**The elite row is over its line** on these seeds (34% against 30%; 30% on seeds 4000+), as the grid notes above said.
`--set CRAWL.AUTO.autoSide=0` brings it to 30%; `autoSide` 2 is within a point of 1 (the team is full or hurt by then).

## Bugs found on the way, and what was done

1. **Fixed: shells at hand were invisible to a fight by the numbers.** `launchExpedition` calls `packShells`, moving
   up to 30 shells per shotgunner out of the team's supplies into pockets and rig pouches. `combat.js
   autoResolveCombat` drew its rounds from supplies and cargo only, so a shotgun team whose shells were all at hand
   fought with none ("ammo was short: fights at 60%") while the odds shown assumed them: shown 85–95%, won 36%. Now
   `takeHandRounds` takes the shortfall from the rounds the shooters carry (and uses them up). Same test after the
   fix: shown 85–95%, won 88%; shown 95%+, won 96%.
2. **Fixed: a crash leaving a city.** `citycrawl.js stepLeave` went on to `finishCrawl` after the hour on the way
   out had already ended the crawl (the team wiped), and `finishCrawl` read `p.crawl.tile` of nothing. Guarded in
   both.
3. **Fixed: the hive campaign said "waiting for the squad to rest" when it was waiting for the style's first hive
   day** (`hiveFrom`: balanced day 90, cautious 150). It now has its own reason (`early`, also in the census's
   `hiveRejects`), so "rest" in the census means rest.
4. **Fixed: `tools/wintest.js --force hive` and `--force keep` failed** (on the code before these changes too). The
   forced squad reached the core, turned back hurt, and could not go again before day 90 while the test stopped at
   75; and with the eras off (`state.erasOff`, the forced runs only) the border outbreak still started a new hive,
   so the state was never clear. The forced runs now go to day 150, and `erasOff` turns off the border floor
   (`eras.js hiveFloor`) as it does the other eras' rules. All five forced scenarios pass.
5. **Open: a player's team fights to the end by default.** A lost street fight with the default policy (`Never`)
   kills most of the team; the odds shown are honest, but "a 90% fight" reads safer than "a 10% chance to lose most
   of the team". A default of `losing` for player teams, or a line on the encounter card, would be the fix; it is a
   design call, left alone.
6. **Fixed by the autopilot's plan (`autoDepth`): the harness can rate deep city blocks.** `--block 5` crawls and
   searches there (see "Testing the grid" above).

The hive crawl does not use the break-off policy (its chambers have their own fight model), so its tables above
stand. Medical levers tried on top (`--meds 12`, `AUTO.treat` 85, `AUTO.hurt` 35) moved nothing beyond the noise either.

## The coalition win (also 2026-10-13)

`alliance.js`: `LAND_NEEDED` 0.5 → 0.6, and `allianceVictory` additionally requires **no hive standing or being
built** (`hivesSecured`) and **no living group outside the coalition** (members are allies; broken, conquered or
collapsed groups are gone). The Goals blockers list both. The coalition win is now a total victory that also clears
the hive win; reaching it before the hive win means winning both on the same day, which `world.js checkGameOver`
already reports as one screen. Expect the census to move: the coalition win was 35 of 100 games, mostly on the
year-8 gate (771); it will fall sharply, and the autopilot (which stormed no hive in 100 games) needs the hive
campaign (docs/campaign-census-2026-10-06.md, suggestion 4) before it can win at all. The tests that encoded the old
rule were updated (`claimstest`, `conquertest`, `eratest`, `progpickstest`, `wintest`, `uitest`).

## Next steps

- A **search policy** for the city crawl in the harness (go to block N, search everything, leave at hurt/loot
  thresholds) so depth, loot per risk and the way out can be rated; today's autopilot leaves at block 2.
- **Map mode**: play the building and street fights on the map (`enterPlace {map:true}` with `autoPlayerTurn`, as
  `citycrawltest stats`) for a second opinion on the by-the-numbers model.
- A **CI target check**: `node tools/crawlbalance.js both --targets` exits 1 when a row leaves its range; run it
  after any change to `CRAWL`, `HCRAWL`, `HIVEMIND`, gear damage or armour.
- Fix finding 1 (shells at hand) and decide on finding 2, then re-baseline and write the result here.
