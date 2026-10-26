# Running only the affected tests

The suite is about 370 `prototype/tools/*test*.js` files and takes hours. In a session, run only the tests your change can affect.

## Before merging to dev: the gate

Run `node tools/gate.js` from `prototype/` before every merge to dev. **A merge that adds a failing check is not done.**

- It runs the typecheck and a fixed core set of shared tests in parallel: `shopstest`, `interiortest`, `storeytest`, `itemarttest`, `furnituretest`, `citycrawltest` and its parts (issue #74: `citycrawlgridtest`, `citycrawlquicktest`, `citycrawlquick2test`), `scenestest` (full seeds since #74), `indoorlighttest` (#74), `landordertest`, `detachtest`, `claimstest`, `guidetest`, `teamctxtest` (issue #75, 10-33 s each alone), `basefurnituretest`, `neighbourhoodtest`, `shopvarianttest`, `loottest`, `gunmodtest` and (issue #63) `seasongroundtest`, `puddletest`, `zombiesfxtest`, `siegetest`, `allyorderstest`, `hivebirthtest`, `sizetest`, `rescuetest`, `hiveplustest` and (issue #72) `officestest`, `plannametest` and (issue #73) `occupytest` and (issue #63, its later twelve) `basestoragetest`, `basestorageuitest`, `basestoragemaptest`, `ailockstest`, `floorfolktest`, `fieldtest`, `basebuildautotest`, `bridgetest` at full seeds, and `scaletest`, `varianttest`, `malltest`, `carryplaytest`, `stealthtest` and (issue #73) `farmtest` with `BS_QUICK=1`. About 17-35 minutes on 4 cores (1015 s on 2026-10-26 with #63's later eight before #74's split, the machine to itself; 2120 s on 2026-10-26 with the #73 tests, the gyms (#56) and the dead pools (#65); 1913 s earlier that day with the #72 tests and the farms, #62; 670 s with the #63 tests). citycrawltest was most of it (17.5 minutes alone, 1748 s in the gate, close to the gate's 1800 s limit a test) until issue #74 split it in four that run side by side (the shared setup in `tools/citycrawlkit.js`): 155–181 s each in the gate on 2026-10-26, 122–193 s alone with the four running at once. The longest in the gate now is `interiortest` (about 400 s). Not in it, too long: `hivetest` (about 47 minutes alone; run it when you touch the hives) and `savetest` (with `BS_QUICK=1` about 8 minutes alone, 12 in the gate, where it pushed `citycrawltest` past the time limit; run it when you touch saving or anything a save holds). Also left out, too long (issue #73, made green on 2026-10-26): `custompointstest` (about 12 minutes alone), `hcstarttest` (16), `uitest` (12) and `farmtest` at full length (17); run them when you touch their areas. And (issue #63): `basetest` (about 7 minutes), `medstest` (about 25 minutes of CPU in 4 processes), `exploretest` (quick about 2 minutes, full about 10) and `depletetest` (quick about 2 minutes; full, its 24 autopilot years, hours: a year's days slow as the autopilot's crew grows, seed 5 338 s for days 210-240 with 38 survivors). The two quick ones were left out while `citycrawltest` ran near its limit; since #74's split they may fit.
- It reads every `FAIL` line and compares the check names (numbers written `#`) with `tools/gate-baseline.json`, the checks known to fail on dev. A failing check not in the baseline is printed under "NEW FAILURES" and the gate exits 1. A crash or a timeout with no `FAIL` line counts as a check too.
- A baseline check that passes now is printed under "Fixed"; `node tools/gate.js --update` drops it. The baseline only shrinks: never add a check to it. Fix the failure instead.
- `node tools/gate.js --against origin/dev` (or any ref, such as `09c8f00`) also runs the set in a temporary worktree of that ref and lists the checks failing here only, there only and on both. That is how you prove a failure is old.
- `node tools/gate.js <test...>` runs just those tests (file-name substrings) against the same baseline, for example `node tools/gate.js --against origin/dev interiortest`.

## Never

- Never run `npm test`, or `node tools/runtests.js` with no pattern: that is the full suite.
- Never skip, disable or weaken a test to make it pass.

## The recipe (from `prototype/`)

1. List the modules you changed (`git diff --name-only origin/dev`).
2. Find the tests that import each one: `grep -l "sim/<module>.js" tools/*test*.js` (`ui/<name>.js` for UI modules).
3. Add the tests named for the area (`ls tools | grep <area>`), plus any test you wrote.
4. Core modules (`world.js`, `combat.js`, `parties.js` and the like) match hundreds of tests. Over about 20, keep the ones that call the functions you changed (`grep -l "<fn>" …`) and the ones named for the area, and say in your report which you left out.
5. Run them: `node tools/runtests.js --quick <name1> <name2> ...` (each name is a file-name substring). Run `npm run typecheck` too.

`node tools/affected.js [paths...]` does steps 1 to 4: with no paths it reads `git diff --name-only origin/dev` (working tree included), prints the test names, and lists what it left out on stderr. So: `node tools/runtests.js --quick $(node tools/affected.js)`.

## `--quick` and the slow tests

- `--quick` (`npm run test:quick` for everything) sets `BS_QUICK=1`. The long tests read it and play fewer seeds, days and runs: the same checks on less. Every test gets the plain time limit (`--timeout`, 600 s by default).
- Without `--quick`, the tests in the `SLOW` table at the top of `tools/runtests.js` get a multiple of the time limit. The table's comment says how long each takes.
- A failing test's output is kept in `tools/.testlogs/<name>.log`.
- Only `*test*.js` files run; `.cjs` tools (`padnavtest.cjs`, `raidshot.cjs`) run by hand with `node`.
- Scripted playthroughs (`carryplaytest.js`, issue #48) play a whole flow through the sim's orders and print a transcript, a line a step, between the `ok` / `FAIL` checks; each FAIL ends with `[seed …, scene …]`. Read the transcript lines just above the first FAIL to see where the flow broke. Their browser versions (`carryplaysmoke.cjs`) are `.cjs`, run by hand.

## A red test

- Find the cause. If your change caused it, fix the code, or fix the test if it encoded the old behaviour on purpose.
- If it is also red on `origin/dev` (check it out in a scratch worktree, `git worktree add <dir> origin/dev`, and run the same test there), it is not yours: say so in your report, with the failure, and leave it.
