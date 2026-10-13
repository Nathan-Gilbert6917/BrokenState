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
| city depth, start block, day | `--depth`, `--block`, `--day` | `--depth` is the autopilot's `CRAWL.AUTO.depth`; `--block` starts the crawl on that block |
| survivors and gear | `--squad name,…` or `--n --weapon --armor --shoot --health --lights --fire --stun --ammo --meds` | named loadouts in `LOADOUTS`: naked, scrappy, early, hunters, solid, rifles, elite |
| tuning numbers | `--set HCRAWL.X.y=…,CRAWL.X.y=…` | overrides a constant for this run only (roots: `HCRAWL`, `HIVEMIND`, `CRAWL`, `EVENTS`) |

Seeds are deterministic (`--seed`, `--trials`), so the same scenario before and after a change differs only by the
change (and by the dice shifting after any changed decision: read rows in aggregate, 16–20 trials gives ±10 points).

## What it measures

Hive: **win** (the Hivemind dead within `--trips`), **wiped** (nobody left), **lost/sq** (share of the squad lost),
hours, ammo, den depth, and with `--why` the reason each trip ended (`won`, `core too much`, `too many hurt`, `alert`,
`turned back`, `wiped`). City: **out** (the team comes back alive), wiped, lost share, hours, loot (supplies + 4 per
piece of gear), ammo, fights and fights lost.

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
table; rows below are 2–4 blocks.

| squad (40 trials, depth 2) | out before → after | squad lost before → after | squads wiped before → after |
|---|---|---|---|
| naked (4, bats) | 70% → 85% | 48% → 27% | 30% → 15% |
| scrappy (5, pistols) | 95% → 95% | 24% → 17% | 5% → 5% |
| early (5, shotgun, vest) | 90% → 95% | 22% → 13% | 10% → 5% |
| solid (6, shotgun, vest) | 95% → 95% | 8–21% → 15% | 5–10% → 5% |
| rifles (6, AR, plate) | 95% → 95% | 8–16% → 15% | 5–8% → 5% |

The good squads were not worse off to begin with (their rows move within the noise); the change is for the early game.
All 10 judged city rows are inside their targets after the change (4 of 10 before).

A lost fight by the numbers is lethal (a defeat killed 75% of the team on average, 40–60% of lost fights wiped it),
and 2 blocks in a team meets 0.6–1.3 fights. Tweaks (all in `citycrawl.js`):

- `AUTO.sureOdds` 0.85 → 0.92 and `AUTO.fightOdds` 0.65 → 0.80: the governor fights only what it is nearly sure of
  and otherwise hides, lures or runs. Costs a little loot; saves lives of early teams.
- `ENC.base` 0.08 → 0.06 (trouble on the way to the next block) and `QUICK.fight` 0.30 → 0.22 (a search by the
  numbers brings a fight less often). This is the early-game relief: the first week's scavenge team is no longer
  wiped one trip in four.

## Bugs and gaps found on the way (not fixed unless noted)

1. **Shells at hand are invisible to a fight by the numbers.** `launchExpedition` calls `packShells`, moving up to
   30 shells per shotgunner out of `p.supplies` into pockets and rig pouches. `combat.js autoResolveCombat` draws
   its rounds from the team's *supplies and cargo only*, so a shotgun team whose ammo all went into pockets fights
   by the numbers with 0 rounds ("ammo was short: fights at 60%") while the odds shown (`encounterOptions`, no
   `shots`) assume it has them. In my first runs a `solid` team with 120 shells showed 97% and won 36%. With 400
   in the pack the calibration is fine (≥95% shown → 95% won). Fix: count rounds in the shooters' pockets/rig
   (or have `encounterOptions` pass the same `shots`). Real trips pack plenty of ammo so it bites rarely, but a
   short-supplied shotgun team is the one that needs the odds to be honest.
2. **A lost fight by the numbers kills 75% of the team.** Defeat is fought "to the end" (policy `never` for the
   crawl's `canRetreat` fights is not the team's break-off policy). That is the design ("a lost fight against the
   dead can cost everyone") but it makes a displayed 90% a 10% chance to lose a whole team. Consider letting a lost
   crawl fight break off by the team's retreat policy as a map fight does (`breakoff.js`).
3. **The autopilot's city crawl never goes deep and the harness cannot rate depth.** Starting on block 4+ makes it
   leave at once. Rating deep blocks needs a search policy (below).
4. `tools/wintest.js --force keep` fails on the code before this change too (the forced storm does not finish in 75
   days); it is not touched here.

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
