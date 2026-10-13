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
| retreat policy | `--style balanced` | the break-off policy of that autopilot style, set on the team (`none`: fight to the end, a player's default) |
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
6. **Open: the harness cannot rate deep city blocks.** Starting on block 4+ makes the autopilot leave at once; it
   needs a search policy (below).

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
