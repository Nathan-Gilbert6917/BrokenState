# Campaign census, 2026-10-06

Requested: 50 full games under the autopilot trying to survive as long as possible and to win every way the game
allows, 25 from a normal start and 25 from hardcore, huge maps, 15 or more AI groups; fix what breaks; suggest how to
test each aspect better. Runner: `node tools/campaign50.js 50 1095 --groups 15-20 --seed 5000` (tools/campaign50.js;
styles cautious / balanced / aggressive rotated; keep playing after a hive win). Three passes of the same 50 seeds:

| pass | commit | fell | thirst deaths | hunger | left | horde | avg end pop | hive storms | hives destroyed | coalition land, best | crashes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 783bbea (merged dev) | 8 (7 hardcore) | 154 | 86 | 250 | 1171 | 28.5 | 0 | 22 | 56.8% | 0 |
| 2 | ef0617d (bridge, no-way-back, survey range) | 12 (10) | 225 | 49 | 292 | 1073 | 23.4 | 0 | 10 | 59.1% | 0 |
| 3 | ea16fee (+ water hauling) | 9 (7) | 105 | 56 | 253 | 1044 | 22.5 | 0 | 7 | 65.3% | 0 |

Every pass: 0 crashes, no stuck runs (never more than 2 days without a log line), hardcore founded its first hub in
every game (day 3–14), and **no victory of either kind in three years on a huge map** (41–42 of 50 still going at
the cap, the rest fell). Seeds are deterministic but any change in a decision shifts the dice afterwards, so passes
compare in aggregate, not seed by seed. Each pass ran in about 10 minutes on the worker pool.

## Defects found and fixed

1. **One-way bridges** (`sim/parties.js` moveCost). A team could step off a bridge sideways onto a bank, but water
   is only crossed along the road, so it could never get back: it waited for a boat order the governor never gives
   and starved. The governor then sent a 2-person team to recover the dead's gear into the same trap, again and
   again (seed 5020: 66 thirst deaths). A bridge is now left only along its road.
2. **Trips with no way home** (`estimateTrip` → `noWayBack`, autopilot `launchTrip`). The estimate assumed the way
   back mirrored the way out when no return path existed; the governor now refuses such a destination.
3. **No hive ever stormed** (autopilot / `survey.js`). The governor storms only hives it has seen, and its scouts
   stayed within ~10 tiles of home while huge maps keep hives 34+ tiles away. The automatic survey range now grows
   with the months (10 tiles, +3 every 60 days, up to 40). Hives are found now (14 of 25 known by year 3 on seed
   5032) but still never stormed: see the open findings.
4. **Thirst at big hubs** (autopilot `waterTripCands`). A 40-head hub in a dry heat wave drinks 60–70 water a day
   against the 17–30 its well, two wells, stream and rain catchers make; once the cisterns ran dry, 20–40 people
   died within a week (economy.js thirst damage climbs to 15 health a day). Nearly all of it in hardcore, whose hubs
   grow past 40 in year two. The governor now hauls water from the nearest shore (plans.js "water" step) when the
   stock is under 3 days and production falls short, two teams while severe. Thirst deaths 225 → 105.

Also fixed on the way (not census-related): extraction zones drawn on upper floors, a roofed-over top floor, and
the stairs log wording in the new multi-storey buildings (16f65c0).

## Open findings (balance and design, not changed)

- **The coalition win is out of reach on huge maps.** Of the reasons groups stay outside the coalition at the cap,
  "out of radio reach" is 197 of 372: groups sit beyond the 8-tile neighbour / 12-tile member-relay rules
  (`alliance.js ALLIANCE`) and GROUP_REACH 4 of the radio, and the envoy trips the governor sends do not scale with
  the map. Best run held 65% of the land with 7 members of 11; every run had hostile or unmet groups left.
- **The hive win is out of reach on huge maps.** Hives grow from ~11 to ~25 per map over three years (about 16
  new ones a run) while the autopilot destroyed 7–22 in total across 50 runs (allies and growths, never a storm).
  Known hives near the hub carry guards of 125–217; a six-fighter squad never reaches the odds the styles ask for
  (`hiveOdds` 1.05–1.35), and the hubs end year three with 0 ammo.
- **Hardcore cautious starves.** 5–6 of 9 hardcore cautious games fell by day 50–430: a three-person first hub,
  short rations within a week, two of three sent on 3-day trips, people walking away. Cautious range 8 and
  18 hours out are too tight for a huge map's spacing.
- **Thirst still kills when hauling cannot keep up.** Seed 5035 (hardcore, balanced): hauls ran all year two, but
  in year three's heat wave no haul went out for ten days (the hub's two teams were elsewhere) and 39 died. Water
  hauling competes with the other trips under the style's team limit.
- **Hordes are the main killer** (about 1,050–1,170 deaths a pass, a third of all), then deaths in the field
  (~650) and desertions (~250). Deaths to the worm stayed small (14–21).

## Suggestions, for the user to pick from

Game and balance (each changes how it feels to play):
1. Scale the coalition's radio rules with the map (neighbour 8 → ~12, member relay 12 → ~18 on huge), or let a
   relay station at an outpost extend GROUP_REACH, so the coalition win is possible where the groups are far apart.
2. Count the coalition win on a share of the groups still standing (say two thirds) rather than every one, so one
   hostile holdout cannot block it forever; or let conquest of the last holdout count.
3. Cap hive growth on big maps (new sites every 30–60 days today) or let the groups' own hive wars destroy more,
   so the hive count does not climb to 25.
4. Give the autopilot (and the player's tooltips) a hive campaign: fires and allied fighters stack toward a storm,
   and ammo is stockpiled for it, so a 150-guard hive is approachable by year two.
5. Hardcore cautious: a first-hub mode that recruits and ranges wider until the hub has six people, or hide the
   cautious style for hardcore starts.
6. Raise the water ceiling for big hubs (a third well, a water tower, or wells scaling with cisterns), and make the
   thirst damage curve gentler at the top (15 health a day kills 20 people on the same morning).
7. Water hauling pre-empts the team limit when the hub is already short, and the hub stops recruiting past what
   its water can carry.

Testing (make each aspect measurable):
1. Add a `--days` schedule to campaign50 that samples per season, so heat waves and winters show up as columns
   (thirst by season, hunger by season) instead of one total.
2. A `--size` sweep (normal, large, huge, 120x80) in one report to show where the win conditions stop scaling.
3. Record per-run why each coalition candidate was blocked at the end *and* at month 12 and 24, to see whether
   radio reach is the first wall or only the last.
4. Count hive storms attempted vs. offered (hiveCandidate's rejections by reason: unknown, too far, odds, ammo,
   squad), so "0 storms" explains itself.
5. A hardcore-only pass with `--mode hardcore --styles cautious` and `--grep "ration|walked away"` on the fallen
   seeds, to tune the first-hub weeks against the same seeds every time.
6. A player-style bot for the city crawl and raids (the current one stays in a building until Heat 55 and loses
   whole squads), so building and crawl balance can be measured without hand play.
7. Keep the three census JSON reports (`campaign50-report*.json`) under tools/census/ with the commit they ran on,
   so the next change can be compared against them.

## Pass 4 (commit 5dec01e, after docs/coalition-war-plan.md landed)

| pass | commit | fell | coalition wins | thirst | hunger | left | horde | avg end pop | hives left (avg) | hives destroyed (sum) | coalition land, best | crashes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 4 | 5dec01e | 4 (4 hardcore) | **6** (4 normal, 2 hardcore; day 771–983; all Aggressive) | 31 | 22 | 216 | 944 | 32 | 17.5 (was 25) | 78 (was 7–22) | 64.2% | 0 |

Report: `tools/census/2026-10-06-5dec01e.json`. Same 50 seeds as passes 1–3.

- **The coalition win is reachable now**: six wins, every one by the Aggressive style, between day 771 and 983, with
  1–5 members and 53–64% of the land (bases, members, claims). Balanced and Cautious hold 20–40% at the cap: they do
  not expand or claim enough. Blockers at the cap, summed over 50 runs: out of radio reach 215 (was 371 at month 12),
  not met 68, goodwill 69, hostile 49; groups outside do not block the win any more, they only hold land.
- **Hives are fought but not yet beaten**: 289 fire trips were launched (the campaign at work), hives left fell from
  ~25 to 17.5 a map and 78 were destroyed in total (groups and the player's fires), but no storm succeeded: of the
  mornings the governor looked at its target, 18,537 were rejected on the odds, 3,056 for too few people at home,
  1,443 because no hive was known. The guard rebuilds between fire trips (see campaigntest's note: 97 → 119
  between trips on seed 1), so a 150-guard hive takes a dozen trips. Levers: the hive's guard regrowth and
  `hiveRest`, or more fires per trip.
- **Thirst is solved for practical purposes**: 31 deaths (225 → 105 → 31), 14 in summer and 15 in winter (frozen
  stores), only 3 in hardcore. Hunger 22.
- **Hardcore's early losses remain**: 4 of 25 fell, three of them before day 125 (hunger, people walking away) and
  one at day 310. The prepper bag did not change that: the three-person first hub still cannot keep two trips and
  a home guard going.
- **Performance**: the pass took 28 minutes against 10 before (claims, group war parties, the campaign). Profiled
  afterwards: the coalition land count ran every hour inside the game-over check (9%) and the nearest-hive distance
  was recomputed per tile per hour (5%); both now cached per day (`landCache`, `hiveDistCache`, not saved). A
  400-day huge game: 128 s → 32 s.
