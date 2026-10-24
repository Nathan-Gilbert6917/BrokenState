# Campaign census reports

The JSON reports `tools/campaign50.js` writes: many full games under the autopilot on big maps (normal and hardcore
starts, the three styles rotated), kept here with the commit each one ran on so the next change can be compared
against them. Seeds are deterministic, but any change in a decision shifts the dice afterwards, so passes compare in
aggregate (fell / going / deaths by cause / land held), not seed by seed. The write-up of the first three passes is
docs/campaign-census-2026-10-06.md.

(Snapshots removed: the JSON reports named in the tables below are no longer in the repo, and new `--census` output
here is gitignored, so it stays on the machine that ran it. The tables keep the headline numbers.)

| file | commit | what it ran on | fell | thirst | hunger | horde | left |
|---|---|---|---|---|---|---|---|
| `2026-10-06-pass1-783bbea.json` | 783bbea | merged dev before the census fixes | 8 | 154 | 86 | 1171 | 250 |
| `2026-10-06-pass2-ef0617d.json` | ef0617d | one-way bridges fixed, no-way-back trips refused, survey range grows | 12 | 225 | 49 | 1073 | 292 |
| `2026-10-06-pass3-ea16fee.json` | ea16fee | + the autopilot hauls water when the base is short | 9 | 105 | 56 | 1044 | 253 |

All three: `node tools/campaign50.js 50 1095 --groups 15-20 --seed 5000` (huge map, 25 normal + 25 hardcore, styles
cautious / balanced / aggressive, keep playing after a hive win), about 10 minutes each on the worker pool, 0 crashes,
no victory of either kind in three years.

## What is in a report

`{ args, commit, date, ms, results }` (`commit` and `date` since 2026-10-06; the three above carry only `args`).
`args` is the run's knobs (`GAMES`, `DAYS`, `SIZE`, `SIZES`, `GMIN`, `GMAX`, `SEED0`, `STYLES`, `KEEP`, `MODE`, `PRESET`).
Each entry of `results` is one game:

- the job: `seed`, `mode` (normal / hardcore), `style`, `groups`, `size`, `days`;
- `outcome` (`hives` / `alliance` / `loss` / `going` / `crash`), `day`, `hiveWinDay`, `hubDay` (hardcore: the first
  hub's day), `crashDay`, `error`, `ms`;
- `samples`: once a month, population, bases, hives left / destroyed / building, coalition members and groups, land
  held, groups alive; housing (since 2026-10-07): `hubRes` / `hubBeds` (the hub's residents and beds) and `outRes` /
  `outBeds` (the same summed over the outposts);
- `events`: the dated major lines (bases taken, hives destroyed or risen, coalition joins and leaves, groups fallen);
- `deaths`: by cause (`horde`, `in the field`, `thirst`, `hunger`, `raid`, `hive assault`, `illness`, `worm`, `cold`;
  `left` is people who walked away or changed sides);
- `bySeason`: `{ thirst: { spring, summer, autumn, winter }, hunger: {...} }` (since 2026-10-06);
- `blockers`: why each living group was outside the coalition, bucketed (`not met`, `out of radio reach`, `hostile`,
  `goodwill`, `no pact`, `at war with a member`, `job or council`, `could join`), at `m12`, `m24` and `end` (since
  2026-10-06);
- `hiveRejects`: the autopilot's count of why no hive storm was offered each morning (`unknown`, `far`, `odds`,
  `ammo`, `squad`, `rest`, ...), when the build keeps it (since 2026-10-06; null before);
- `longestQuiet` / `longestSilent`: the longest stretch of days without a major event / without any log line;
- `end`: the state at the end (`pop`, `bases`, `outposts`, `hives`, `destroyed`, `building`, `members`, `groups`,
  `land` %, `outside` (each group outside and why), `bands` (hardcore groups still on the road), `conquest` stats,
  `mapW` × `mapH`, `world`: groups collapsed, new gangs, bases razed);
- `grepLines` / `log` when `--grep` / `--log N` were given.

## Adding one

Run the set with `--census`: the JSON lands here as `<date>-<commit>.json` (the commit is `git rev-parse --short
HEAD` at the time; rename to add a pass label if you like, as the three above are). Then add a row to the table with
what the commit changed and the headline numbers from the report's "Deaths by cause" line and the per-run table, and
note in the write-up what moved. A `--size normal,large,huge,120x80` sweep writes one JSON with every size's runs
(`results[].size`), and the console prints a block per size and a comparison table.

    node tools/campaign50.js 50 1095 --groups 15-20 --seed 5000 --census
    node tools/campaign50.js --preset hardcore-cautious --census        # 25 hardcore cautious games, grep on the fallen
    node tools/campaign50.js 25 1095 --size normal,large,huge,120x80 --groups 15-20 --seed 5000 --census
    node tools/campaign50.js 30 450 --size normal --groups 5-10 --seed 5050 --mode hardcore --start-people 1   # hardcore starting team of 1-4 (default 3)

`--start-people N` (1–4) sets how many flee together in the hardcore starts (the new-run screen's Starting people,
`createWorld({ startPeople })`); the JSON's `args.START_PEOPLE` records it (null: the default three). Normal starts
ignore it.

A quick self-check that the runner and its columns work: `node tools/campaign50.js 2 10 --size normal --groups 7-7`.

## The progression census (2026-10-09)

`review/progression-census-2026-10-09.md` (the write-up). 100 games to day 1700 (about 15 years): `node tools/campaign50.js
50 1700 --size normal,large --groups-list 6,10,14,20 --seed 6000 --mode both --workers 14 --jsonl games.jsonl --out x.json`
(half normal, half hardcore starts per size; the seven autopilot styles rotated; groups 6 / 10 / 14 / 20). Each game
also carries `prog` (`tools/progtrack.js`: a snapshot a game year, milestone days, the mid / end game markers, the
content checklist, the hive crawl's numbers); read them with `node tools/progreport.js <file> [<file> ...]` (several
files: an A/B table). These three are slimmed (no monthly `samples`; `events` only hive kills, coalition joins and the
endings).

| file | commit | what it ran on | games | hive win | coalition | fell | mid in years 5–8 | end in years 10–15 |
|---|---|---|---|---|---|---|---|---|
| `2026-10-09-progression-baseline-44f5dcd.json` | 44f5dcd | dev a91ea33 + the census tooling (no hive crawl) | 100 | 0 | 35 | 16 | 20 | 9 |
| `2026-10-09-progression-pre-dev9e19c18.json` | 0c9b80f | dev 9e19c18 (bal-int, the hive crawl) + tooling, eras as on dev | 100 | 0 | 34 | 19 | 17 | 12 |
| `2026-10-09-progression-post-partial-00fe1ff.json` | 00fe1ff | + the era retune, the core fitted to the map, starving hives (stopped at 34) | 34 | 0 | 11 | 9 | 25 of 34 | 24 of 34 |

