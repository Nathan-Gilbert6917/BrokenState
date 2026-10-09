# Progression census, 2026-10-09

The request: "Run 100 games playing different play styles; if you never hit some of the game, rebalance; make sure the
progression hits mid at 5–8 years and end game around 10–15 years; fix any bugs found; provide a list of suggestions."

Branch `prog-census` (worktree `.claude/worktrees/prog-census`). Status: the baseline (100 games) and a second
100-game run on the new dev (with the hive crawl) are done; the retune is in; **the one final 100-game census is
pending** (the user's decision: it runs once, after hive-plus and volunteers land on dev). A 34-game interim of the
retuned build (stopped for that reason) is below as the evidence so far.

## How the games were played

- **Seven autopilot styles** (`src/sim/autopilot.js PERSONALITIES`): the classic Cautious, Balanced, Aggressive, and
  four new ones that change real decisions through the governor's knobs:
  - *Diplomat* (base Cautious): envoys every 8 days to groups 3.5× its range away, even with nothing to give
    (`envoyBare`), trade visits every 6 days, land outposts for the coalition as soon as it has a member (`landEarly`),
    pays tribute readily (`tributeLean` 1.8), never starts a war, storms hives only at good odds from day 120.
  - *Hive hunter* (base Aggressive): hive campaign from day 20, odds 1.0, 4 fires, 3 days' rest; fights groups only
    when provoked.
  - *Turtle* (base Cautious): one 7-tile trip at a time every 5 days, 70% at home, 3 guards, one outpost only at 20
    people, reserves of everything, hives only from day 400 at odds 1.5, never at war.
  - *Expansionist* (base Aggressive): 5 outposts from 6 people, land outposts from the first member, conquest from
    day 90 at 70%, range 16, three teams out.
  - A newer style shows the rest of the game its base style (`state.governor.personality`: cards, diplomacy,
    prisoners, the retreat policy, perks), the governor uses all its own knobs (`state.governor.style`). The steward
    and work-crew style menus still list only the classic three. `tools/stylestest.js` checks all of it.
- **The set:** `node tools/campaign50.js 50 1700 --size normal,large --groups-list 6,10,14,20 --seed 6000 --mode both
  --workers 14` — 100 games to day 1700 (year 16), Normal and Large maps, half normal and half hardcore starts, 6 /
  10 / 14 / 20 groups crossed with the styles, keep playing after a hive win. Run detached on clean `git archive`
  exports.
- **What each game records** (`tools/progtrack.js`, read with `tools/progreport.js`, which prints A/B tables): a
  snapshot each game year (era, people, bases, vehicles, best weapon, squad power, members, land, hives standing /
  destroyed / their top tier, Wallbreakers, deaths, raids, hive hordes), the day of ~25 milestones, a content checklist
  (~50 systems by their log lines plus the world's counters), the building types ever built, and the hive crawl
  (trips by the hive's tier, deepest chamber reached and den depth, cores won / lost, teams lost inside).
- **The markers** (both need the era and the player's own progress):
  - *mid game reached* = the mid era AND a second base AND (a hive destroyed by your team OR a first coalition
    member): the day all three first hold.
  - *end game reached* = the late era AND a victory in progress: the Accord's clock running (the coalition holds
    over half the land), the containment clock running, the hive war nearly won (3+ hives destroyed by you and at
    most 2 standing) or the coalition close (40%+ of the land with a member).

## Baseline (dev a91ea33 + tooling, no hive crawl; `tools/census/2026-10-09-progression-baseline-44f5dcd.json`)

| style | games | hive win | coalition | fell | going |
|---|---|---|---|---|---|
| cautious | 16 | 0 | 4 | 5 | 7 |
| balanced | 16 | 0 | 7 | 1 | 8 |
| aggressive | 16 | 0 | 5 | 3 | 8 |
| diplomat | 16 | 0 | 8 | 1 | 7 |
| hunter | 12 | 0 | 4 | 0 | 8 |
| turtle | 12 | 0 | 2 | 4 | 6 |
| expander | 12 | 0 | 5 | 2 | 5 |
| **all** | **100** | **0** | **35** | **16** | **49** |

By start: normal 20 coalition / 1 fell / 29 going; hardcore 15 / 15 / 20. By map: Normal 24 / 7 / 19, Large 11 / 9 / 30.
0 crashes, no stuck run, no NaN.

**When things happen** (game years, median and quartiles, share of games):

| milestone | baseline |
|---|---|
| coalition founded / first member | 2.5 (1.9–3.6), 91% |
| second base | 3.0 (1.9–6.5), 81% |
| first hive destroyed by you | 3.3 (2.5–4.9), 68% |
| land over 50% (the Accord's condition) | 4.8 (3.6–7.3), 53% |
| first tier-2 growth | 5.7, 94% |
| first tier-3 growth | 12.6, 42% |
| first Wallbreaker | 13.7, 6% |
| first tier-4 growth | 15.7, 1% |
| **mid game marker** | **3.5 (3–6.8), 80% — only 20/100 in years 5–8, 51 before** |
| **end game marker** | **8.0 (8–8.4), 64% — only 9/100 in years 10–15, 54 before** |
| first victory | 8.7 (8–11.1); 20 of 35 coalition wins on the first days of year 8 |

**The finding.** The game's progression was front-loaded and then gated: a coalition held half the land by year 3–5
(Diplomat 4.1, Expansionist 3.8, Aggressive 3.9) and the Accord's clock ran from then, so the game ended on the first
day the victories opened (year 8). The late game (tier-3 hives, Wallbreakers, the vat) was mostly never seen: the games
were over before it. The hive victory was never won: the hives kept founding new ones (4 standing in year 1, 6.5 in
year 8, 11 in year 16), even after the outbreak beyond the border burned out.

**Never or rarely hit (baseline):** the hive victory (0/100; its containment clock started in 9%), Wallbreakers (7%),
tier-4 growths (1%), tier-3 growths (42%); buildings never built by the governor in any game: the Master workbench
(`toolbench`), the radio relay, the chapel, storage crates (`hub_up` is a false negative: it turns into the hub's
tier); the machine shop and jailhouse under 15%. (The worm and jobs read 0 in the baseline only because of a tracker
regex bug, fixed: both are common.)

## The new dev with the hive crawl, before the retune (dev 9e19c18 + tooling; `…-pre-dev9e19c18.json`)

100 games, same set: 0 hive wins, 34 coalition (25 of them in year 8), 19 fell, 46 going, 1 crash (the crawl's,
fixed below). Mid game in years 5–8: 17/100; end game in years 10–15: 12/100. The crawl itself: 725 crawl trips in 78
games; cores won 123, lost 211 (every tier-1 core lost); your hive kills 0.9 a game. Turtle fell in 7 of 12.

## Bugs fixed (each with a regression check)

1. **Governor paid tolls that stranded its team** — `src/sim/visitors.js` `tollStrands` / the toll's `ai`
   (stopCard). Seed 7002 hardcore: a hive squad three days out paid its water and its fire fuel to raiders, went
   home parched and never set the fire; a dozen such trips in a year. Now a toll that leaves the team less water or
   food than the way home takes, or takes a hive squad's fuel, scores 5 instead of 55–75 (it fights, talks or runs).
   Test: `tools/visitortest.js` "The governor and a toll that would strand the team".
2. **Hive crawl crash: the den deepened under a team inside it** — `src/sim/hivecrawl.js` `denOf`. Seed 6002
   (normal, Aggressive, 6 groups) crashed on day 145 in both the pre and post runs (`roomActions`: the hive reached
   tier 1 while the autopilot's team stood in a side pocket the deeper den lacks). The den now keeps its shape while
   a team is inside and deepens once it is out. Test: `tools/hivecrawltest.js` "The hive deepens with a team inside"
   (fails on the old code, passes now).
3. **The hive core "by the numbers" was far easier than the battle map** — `src/sim/hivecrawl.js`
   `HIVEMIND.numbersK` 2.5 (in `coreForce`'s `bossPower`). Over 56 core rooms the autopilot's real teams met, each
   replayed 8 times from a saved state, the played fight won 25% where the numbers said 80% (rifle teams at full health and
   97% won 0–1 of 8 in nine rooms: the Hivemind's 480–720 hit points, pulse and lash and the brood it keeps calling grind a team down
   far more than a flat power says). The fitted factor is 2.75 (Brier 0.42 → 0.09); 2.5 so an ideal squad is not
   shown far less than it wins. This fixes the odds the core room shows, "Fight it by the numbers" (an easy exploit
   before) and the autopilot's choice to take the core. Test: `tools/hivecrawltest.js` (the bosses count numbersK
   times). The planner's storm gate (stormRatio against hiveOdds) is stricter as a result; `tools/wintest.js --force
   hive` sends its rigged squad straight into the crawl.
4. Tooling and docs: the eras.js header said the Accord needs "every group a member" (it does not since conquest
   counts); balancesim said "year 8". Fixed with the retune.

## The retune (what the user asked for)

All numbers in `src/sim/eras.js` / `hiveconst.js` unless noted; Help (Eras and winning, Winning and losing), the Goals
card, README and `tools/eratest.js` follow.

| change | before | after | why |
|---|---|---|---|
| mid era from | year 3 | **year 5** | the mid game's content (tier-2 hives, the mid game's special dead) starts in year 5 |
| late era (and both victories) from | year 8 | **year 10** | the end game in years 10–15 |
| the Accord's year counts | from the first day the land is held | **only in the late game** | a coalition holding the land by year 3 sat out 5 years and won on the gate's first day |
| outbreak burn-out | years 9–12 | **11–14** | the hive victory lands in the late game |
| new hive sites after the burn-out | yes (hiveCap) | **none** | the hives went on founding new ones (11 standing in year 16) |
| hive resources after the burn-out | × 1 | **× 0.4** (`OUTBREAK.STARVE`, hives.js) | the last hives can be crawled out |
| hive tech tier 3 / 4 opens | day 1100 / 1500 | **995 / 1331** (`TECH.TIER_DAY`) | Wallbreakers, spires and crawlers with the late game, not after it |
| autopilot hive squad | 6 | **8 from 24 at home, 10 from 36** (autopilot.js `hiveSquadSize`) | a hub of forty sent six into a core that beats six three times in four |
| threats' growth | from year 3 | unchanged (now inside the early game) | difficulty curve kept |

**Interim A/B (the same 34 games — 25 normal and 9 hardcore starts on the Normal map — in each run):**

| | baseline (old dev) | pre (new dev) | post (retuned, 00fe1ff) |
|---|---|---|---|
| hive wins / coalition / fell | 0 / 16 / 3 | 0 / 15 / 7 | 0 / 11 / 9 |
| first victory, year | 8.2 | 8.0 | **11.0** |
| mid game marker | 3.2 (3–7.6) | 3.1 (3–4.2) | **5.0 (5–5.6)** |
| … in years 5–8 | 5/34 | 3/34 | **25/34** (0 before, 3 after, 6 never) |
| end game marker | 8.0 | 8.0 (8–8.9) | **10.0 (10–10.7)** |
| … in years 10–15 | 2/34 | 3/34 | **24/34** (0 before, 10 never) |
| first tier-3 growth | 12.8 (16 games) | 13.5 (11) | 11.7 (16) |
| first Wallbreaker | 13.5 (4) | never | 14.4 (4) |
| tier-4 growth | 1 game | none | 4 games |
| your hive kills a game | — | 0.9 (max 3) | **2.0 (max 9)** |
| crawl cores won / lost | — | 31 / 78 | **70 / 46** (tier 1: 0 / 51 → 51 / 35; tier 2: 10 / 9) |
| hives standing at the end | — | 6.8 (min 2) | 6.1 (min 1) |

(The pre run's tracker counted a core won in the hour its crawl ended at tier 0; fixed for the post run.)

Read: the markers now land where asked for the games that get there (no game reaches the mid or end markers early any
more); the coalition victory comes in year 11–12 after a held year in the late game, and late-game content is seen far
more. **Still open:** no hive victory in any run — the best interim game left 1 hive standing, most 5–9. The post run
also lost more games (9 vs 7 of 34: three Hive hunters and a Balanced, possibly the bigger hive squads in the core);
the final census will say whether that holds. The Turtle falls early in both new-dev runs (hunger, desertion).

## The final census (pending)

When hive-plus and volunteers are on dev: merge dev into `prog-census`, then on a clean export:

    git archive <merged commit> prototype | tar -x -C <scratch>/FINAL
    cd <scratch>/FINAL/prototype
    node tools/campaign50.js 50 1700 --size normal,large --groups-list 6,10,14,20 --seed 6000 --mode both --workers 14 --jsonl games.jsonl --out final.json
    node tools/progreport.js tools/census/2026-10-09-progression-pre-dev9e19c18.json final.json

(launch detached: PowerShell `Start-Process -WindowStyle Hidden … cmd /c "… > out.txt 2>&1"`, about 2–3 hours on 14
workers; `--jsonl` resumes a killed run). Then: is the hive victory reached in years 10–15, and did the losses move.

## Suggestions (a pick-list; none of these is in the branch)

1. **Make the hive victory a real late-game campaign.** Even with starving hives, the autopilot ends year 16 with
   5–9 hives standing. Options: hives that lose their guard below 40 after the burn-out wither and die on their own
   over a season; or the coalition's members crawl with you (allied volunteers, now on dev) into the last hives. Feel:
   years 12–15 become "hunt down the last nests" rather than an endless war.
2. **The Hivemind fight on the map.** The core grinds a team down (the numbers needed × 2.75 to match it). A weak
   spot (fire, Molotovs or explosives in the core room doing extra, or the pulse pausing after a stun) would reward
   preparation instead of headcount. Feel: a boss with a plan, not a wall of hit points.
3. **Pace the coalition, not just gate it.** On Normal maps with 6–10 groups the coalition held half the land by
   year 3–4 and then waited. A land target that rises with the era (e.g. 40% / 50% / 60%), or members' land counting
   only after a season in the coalition, would make the coalition's growth itself the mid game. Feel: the map fills
   in over the years instead of in the first two.
4. **The Turtle starves.** A style that stays home and guards falls in 7 of 12 games (hunger, people walking away).
   Home-only food (greenhouse, cellar, more from farms with guards on the walls) would make turtling a valid way to
   play. Feel: a fortress that can hold out if it planned its stores.
5. **Teach the governor the buildings it never builds:** the chapel, the Master workbench, storage crates, the radio
   relay (never in 200 games). Feel: autopilot towns look like a player's.
6. **Fire trips that never stack.** In the baseline a campaign set 10 fires at one hive over half a year and its
   guard regrew between trips every time (the post run makes far fewer fire trips: 3 of 34 games). Fires could leave
   the guard down for longer, or the campaign switch target after two futile fire trips.
7. **Offer the four new styles to base stewards and work crews** (now the menus show only the classic three).
8. **Hardcore loses 15 of 50**, mostly Cautious, Turtle and small hubs to desertion and hunger in years 1–5; a gentler
   first year (more food in the first ruins) for small starting teams.
9. **The planner's storm gate** (stormRatio against hiveOdds) is now stricter than the core's own odds, so the
   autopilot reaches cores through crawl trips; refit hiveOdds to the calibrated core so it storms directly when it
   should. Feel: fewer, more decisive hive trips.

## Files

- Code: `src/sim/autopilot.js` (styles, `hiveSquadSize`), `src/sim/eras.js`, `src/sim/hiveconst.js`, `src/sim/hives.js`
  (one line: starving income), `src/sim/hivecrawl.js` (`denOf`, `HIVEMIND.numbersK`), `src/sim/visitors.js`
  (`tollStrands`), UI texts in `src/ui/ui.js`, `help.js`, `diplomacy.js`, `production.js`, `work.js`.
- Tools: `tools/campaign50.js` (`--workers`, `--groups-list`, `prog`), `tools/progtrack.js`, `tools/progreport.js`,
  `tools/stylestest.js`; tests touched: `eratest`, `visitortest`, `hivecrawltest`, `wintest`.
- Census JSON: `tools/census/2026-10-09-progression-*.json` (see `tools/census/README.md`).
