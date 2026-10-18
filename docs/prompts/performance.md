# Performance: session prompts

A survey of where Broken State spends its time, turned into one prompt per fix. Written on 2026-10-18 from CPU profiles of headless campaigns (Node 22, commit `c427dd2`), a Chromium profile of the browser build, and a read of the hot code. Every number below was measured on that commit in a shared container, so read them as ratios, not absolutes. Where a finding was only read, not measured, it says so.

The sessions are run as agents by a coordinator who merges each one into `claude/code-performance-areas-ccfyx9` (or whichever integration branch the owner names).

## How to use this file

1. Each session runs in its own worktree branched from the integration branch. A session reads **only this file's "Shared brief", its own section**, and the code it names.
2. Order: **Wave 0: PERF-0 alone (the measuring tools and the golden hashes).** Then **Wave 1: every other session in parallel** (they touch different files; where two share a file the section says which goes first).
3. A session ends by appending a short **Handoff** note under its own section: the real functions it changed, the before/after numbers from the same tool, the golden hashes it compared, anything it deliberately left alone.
4. Line numbers come from the 2026-10-18 survey and drift. Search by name.

## Findings at a glance

Ranked by what a player feels first, then by balance-run throughput. "Win" is the measured or prototyped gain, not a promise.

| # | Area | What is slow | Measured | Win | Behaviour risk |
|---|------|--------------|----------|-----|----------------|
| PERF-1 | Daily tick: the weekly market refresh | `marketLists` re-derives the same group "conditions" for every one of 175 supplies, three times each | 14.5% of a no-autopilot run; 100–390 ms hitch every 7th midnight | prototype: 130 → 23 ms per refresh of all groups, identical market hash | none (pure memo) |
| PERF-2 | The first midnight and the cold constants | `arsenal.js kitRef` builds 12 starter kits per group type on first use; `gunmods.js slotRules` rebuilds Sets on every call | day-1 midnight tick 835 ms (Huge: 1.2 s+) | ~500 ms off the first night | none (memo + warm-up) |
| PERF-3 | Hex grid helpers | `distance`, `neighbors`, `within`, `findPath` allocate per call | `distance` 43 ns vs 12 ns allocation-free; 549 call sites | ~3% of the sim, more in the UI | none (same maths) |
| PERF-4 | The groups' daily work | `aiScavDaily`, `groupTargets`, `groupTripLosses`, `groupWorldDaily` recompute per tile and per group | 7.6% + 5.6% + 3% of a no-autopilot run; midnight 55 ms Normal, ~120 ms Huge | roughly halves the midnight tick | none if done as memos; staggering would change behaviour (not in scope) |
| PERF-5 | Autopilot planners (balance runs and the dev autopilot) | Re-plans from scratch every hour: `buildWishes`, `planRoles`, `equipFromArmory`, `planTrip`, `handleTrade` | 54% of an autopilot run; 11 ms/hour average, p99 82 ms, worst 718 ms | 30–40% off census throughput | none if memo-only; must keep the autopilot's choices identical |
| PERF-6 | Hourly knowledge and food ledger | `updateVision`/`snapshot` rebuild every live tile each hour; `foodMarkAll` runs ~7 times an hour | ~2% each | small | none |

**Work in progress:** PERF-0 to PERF-6 (the simulation) are written. The sessions for the browser (State Map and panels), the battle engine and view, and saves, memory and start-up are still being profiled and are added below when their numbers are in.

---

# Shared brief (every session reads this first)

## The one rule: faster, never different

This is a seeded, deterministic simulation. A performance session changes **how long** things take, never **what** they produce. That means:

- The same RNG draws in the same order. Do not skip, reorder, add or cache a call to `state.rng`, `hash01`, a battle's own dice, or anything that feeds them. A cache is allowed only around pure functions of values that cannot change while the cache is live.
- The same iteration order wherever a result depends on it: ties in a sort, `for…in` / `Object.keys` order, first match of a `find`, the order a list is built in. Several codepaths here break ties by encounter order.
- Saves keep loading and keep their meaning. Caches live in module-level `WeakMap`/`Map`s or on objects that are not saved; nothing derived goes into `state` unless `save.js` already skips it. `node tools/savetest.js` must pass.
- No visible change. Pixels, texts, card wording and timings of game events stay as they are unless a section says otherwise.

**Proof, required in every Handoff:** the golden hash. On the session's base commit, before touching code, run
`node tools/dettest.js --digest 60 <seed>` for seeds `42`, `7` and `1234` (one fresh process each, about a minute apiece, they print one hash) and keep the three hashes. After the change, run the same three; they must be **identical**. If one differs, the change is not a pure speedup: find out why, and if it is genuinely intended, stop and say so in the Handoff rather than updating a baseline. PERF-0 builds a small wrapper for this.

Worked example from the survey, to show the method works: on `c427dd2`, `node tools/dettest.js --digest 60 42` prints `22e9c5a2411f98c663df04af967f03e2eb9bb38c` and seed `7` prints `8bc81905adf971c88bf4c62f87dfab9de6baf225`. A scratch copy of `src/` with three of the changes below applied (the market-pricing memo of PERF-1, an allocation-free `HexGrid.distance` from PERF-3, and the `slotRules` memo of PERF-2) printed the same two hashes. (Hashes of a later base will differ; always record your own.)

Also run, from `prototype/`: `node tools/typechecktest.js` (12–30 s; it needs TypeScript from a local install or `npx` once), `node tools/savetest.js`, and every test in the section's "Verify" line.

## Measure first, measure last

Every claim of "faster" is a before/after number from the same tool on the same seed, on a quiet machine (close other jobs; the survey ran in a shared container and the wall-clock A/B was noisy, so prefer profile shares and per-call timings over total seconds).

The survey's recipes, so a session can reproduce them (PERF-0 packages them as tools):

- **A campaign, headless, with per-hour timing:** `createWorld({ seed, factionCount: 8 })`, `state.started = true`, `setAutopilot(state, true, "balanced")` (or leave the autopilot off to see what a player's tick costs), then `tickHour(state)` in a loop, timing each call. `tools/pacing.js` is the model.
- **A CPU profile:** `node --cpu-prof --cpu-prof-dir=<dir> --cpu-prof-interval 500 <script>`, then read the `.cpuprofile` JSON (`nodes[]` with `callFrame` and `children`, `samples[]`, `timeDeltas[]`) as self time and inclusive time per function, and callers/callees of a function.
- **Stage times of one hour:** the hour is `world.js hourOfWorld`, a list of `xxxHour(state)` / `xxxDaily(state)` calls. Wrapping each call in a timer (in a scratch copy of `src/`, never in the repo) names the stage behind a slow hour.

The reference numbers, so a session knows what "before" looked like (Normal map, 8 groups, seed 3, Node 22.22):

- Autopilot campaign, 180 days (4282 hours): 11.2 ms/hour average, p50 6.8, p90 14.7, p99 82.5, worst 718 ms.
- No autopilot (a player's tick; with nobody playing the game ends around day 56, so this is early-game cost): all 29 hours over 60 ms are hour 0, the daily tick. An average midnight after the first costs about 40 ms (Small map, 5 groups), 56 ms (Normal, 8), 70 ms (Large, 12) and 120 ms (Huge, 20); the market-refresh midnights (every 7th day) run 100–390 ms. The first midnight of a game costs 835 ms (Normal).

## House rules

- Match the surrounding code: its comment density, naming and idiom. The codebase comments the *why* in a sentence or two above a function; do the same for a cache (what it is keyed by, why it cannot go stale).
- A cache needs a stated invalidation: keyed by an object identity (`WeakMap`), by `state.hour`, or by a revision counter that already exists (`arsenal.rev` is the model). "Cleared at the start of X" is acceptable only if X is the sole entry point.
- Do not "fix" balance, behaviour or bugs you find on the way; list them in the Handoff.
- Do not add dependencies or a build step; the game is plain ES modules run from a folder.
- `docs/agents/features.md` is the feature map; a pure speedup does not need a line there. If you add a new tool under `prototype/tools`, add a line to `prototype/README.md` where the other tools are described.

---

# PERF-0: the measuring tools and the golden hashes (Wave 0, alone)

**Goal.** Give every later session the same two things: a way to see where a headless campaign spends its time, and a one-command check that a change was a pure speedup.

**Build, under `prototype/tools/`, no change to `src/`:**

1. `perfprofile.js`. Usage: `node tools/perfprofile.js [days=120] [seed=3] [--size normal|small|large|huge] [--groups N] [--autopilot balanced|aggressive|cautious|off] [--stages] [--slow N]`. Plays the campaign headless and prints: total ms, ms/hour average, p50/p90/p99/worst per hour, how many hours were over 60 ms and at which hour of the day (the daily tick is hour 0), and the first-midnight cost separately. With `--stages` it prints a per-stage table (total, calls, average, worst) for the calls in `world.js hourOfWorld`, **without editing `world.js`**: load a copy of `src/` from a temp directory with each `xxxHour(state)` / `xxxDaily(state)` call wrapped, or, if a cleaner way exists without touching the game's files, use that. With `--slow N` it names the stages behind the N slowest hours.
2. `perfcpu.js`: reads a `.cpuprofile` and prints the top self-time and inclusive-time functions, plus `--callers fn` and `--callees fn [depth]`. Document the `node --cpu-prof` invocation in its header.
3. `perfgolden.js`: runs `node tools/dettest.js --digest <days> <seed>` for the three golden seeds (42, 7, 1234; 60 days) in parallel child processes, prints the three hashes, and with `--save file.json` / `--check file.json` records and compares them. Exit code 1 on a mismatch with the seeds that differ named.
4. Add the three tools to the tools list in `prototype/README.md`.

**Verify.** Run each once; paste the output into the Handoff (this becomes the "before" for the other sessions). `perfgolden.js --check` against a file it just saved passes; run it twice in a row to show the hashes are stable between processes.

**Don't.** Don't change the simulation. Don't add the golden hashes to the repo as expected values: they change whenever the game changes, so each session records its own on its own base.

---

# PERF-1: price a market once, not 525 times a group

**Evidence.** In a no-autopilot profile, `refreshMarket` → `marketLists` is 14.5% of all CPU (1.29 s of 8.9 s). `marketLists` (`trade.js`, ~349) loops every key of `SUPPLIES` (175) and for each calls `sellPrice`, `buyPrice` and `demand`; each reaches `supplyInfo` → `valuation.js priceInfo`, which calls `conditions(state, f)` again (and `wealthOf`, which loops all 175 supplies, `hordeNear`, `groupSick` with its hashes, and `foodIn`), then builds the `notes` strings and sorts them. About 525 `conditions` calls and 525 `priceInfo` calls a group per refresh, for a result that does not depend on the key, only on the category. `refreshMarkets` runs from `diplomacyDaily` ← `radioDaily` for every living group whose list is a week old; all groups start on the same day, so they all fall due together: a 100–390 ms hitch on every 7th midnight, on top of the ordinary daily tick. On a Huge map with 20 groups `refreshMarkets` is 15.5% of the CPU of a 45-day run (2.5 s of 16 s, about 350 ms on each refresh day) and `radioDaily` peaks at 809 ms.

**Where.** `prototype/src/sim/valuation.js`: `conditions`, `priceInfo`, `wealthOf`, `hordeNear`. `prototype/src/sim/trade.js`: `marketLists`, `refreshMarket`, `refreshMarkets`, `supplyInfo`, `gearInfo`, `demand`, `sellPrice`, `buyPrice`, `priceWhy` (reads `info.notes`). Other callers of `priceInfo`/`conditions`: search the tree (`autopilot.js`, `visitors.js`, `caravans.js`, `radiotrade.js`, `ui/tradewindow.js`).

**Approach (prototyped and verified identical).** A scoped memo around one `marketLists` call: `memoPrices(f, fn)` in `valuation.js` that, while it runs for group `f`, computes `conditions(state, f)` once and `priceInfo(state, f, cat, gear)` once per `cat|gear`, and clears itself in a `finally`. `marketLists` wraps its body in it. Nothing changes between the first and last price of a refresh (it only reads), so every number is the same. In the prototype, refreshing all eight groups fell from 101–163 ms to 18–27 ms over three seeds, and the SHA-1 of every group's `market` JSON was identical to the unmodified code's on all three. Callers must treat the returned `info` as read-only (check `notes` is never mutated: `priceWhy` maps over a filtered copy).

Then, if the profile still shows it: `wealthOf` computes `Object.keys(SUPPLIES).reduce(...)` per call, so hoist the key list to a module constant; `conditions` is also called outside a refresh (trade window, autopilot, visitors), so a second, separate step may memoize `conditions` per `(f, state.hour)` **only if** every writer of the inputs (`f.stock`, `f.atWar`, `f.pop`, hordes, season) is shown not to run between two reads in the same hour; if you cannot show it, leave it.

**Don't.** Don't stagger the refreshes across days (it would change which week's prices a trade sees: a behaviour change). Don't change `MARKET_DAYS`. If you think staggering is worth it, write it up in the Handoff as a proposal with the reasons.

**Verify.** `node tools/tradetest.js`, `node tools/radiotradetest.js`, `node tools/arsenalbalancetest.js` (if it exercises prices), the golden hashes, and a market-equality script: for three seeds and 40 days, the SHA-1 of every group's `market` after each midnight before and after. Report the timing of `refreshMarkets` for 8 and 20 groups.

---

# PERF-2: the first midnight, and constants computed the hard way

**Evidence.** The first daily tick of a new game takes **835 ms** on a Normal map (factionsDaily 636 + radioDaily 154 + basesDaily 23) and 1.2 s+ on Huge; every later midnight is 50–120 ms. Profiling just the first 26 hours puts 449 ms in `groupworld.js groupWorldDaily` → `knowsOf` → `learnBase` → `groupStrengthOf` (`factions.js strength` → `arsenal.js groupStrength` → `kitFactor` → `kitRef`) and 101 ms more in `grouptrips.js groupTripLosses` → `groupGear` → `kitFactor` → `kitRef`. `kitRef(type)` (`arsenal.js` ~355) is memoized per type but costs 40–190 ms the first time: it builds 12 `starterKit`s (four populations × three salts) per group type, and each `starterKit` fits attachments through `gunmods.js` `fitMod`, `enemyMods` and `slotRules`. Cold, per group type in a seed-3 world: traders 47 ms, raider 42, fortress 176, military 186, expansionist 53. `gunmods.js slotRules(gunKey)` (~170) is 6% of the *whole* no-autopilot profile on its own (self time; 2.3% in the autopilot profile): every call builds fresh `Set`s and arrays from static tables (`PLATFORMS`, `CATEGORIES`, `WEAPON_SLOTS`, `SLOTS`), and `baseSlots`, `opensOn`, `couldHaveSlot`, `partFitsStatic`, `reachableSlots`, `migrateMods` and `fitted` all call it, so a single gun item can call it dozens of times.

**Where.** `prototype/src/sim/gunmods.js`: `slotRules`, `baseSlots`, `opensOn`, `couldHaveSlot`, `reachableSlots`, `partFitsStatic`, `modFits`, `migrateMods`, `fitted`. `prototype/src/sim/arsenal.js`: `kitRef`, `starterKit`, `kitFactor`, `meanValue`, `sortedKit`. `prototype/src/sim/world.js createWorld`, `groupworld.js knowsOf`.

**Approach.**
1. Memoize `slotRules(gunKey)` in a module-level `Map` (the inputs are the static data tables; at the 2026-10-18 survey nothing in `src/` or `tools/` assigns into `PLATFORMS`, `CATEGORIES` or `WEAPON_SLOTS`; re-grep, and if a test does patch them, expose a `clearSlotRulesCache()` and call it there). Every caller of `slotRules`/`baseSlots` is inside `gunmods.js` and only reads `.slots`, `.never` and `.parts` (`.has`, `.includes`, `.length`, iterate, `new Set(...)`, spread); re-read them before relying on that. Return the shared object; freezing it in dev is a cheap guard.
2. Warm `kitRef` for every faction type while the world is being created (`createWorld`, or the lazy first call moved to the end of world creation) so the cost lands on the loading screen, which already takes about 275 ms, not on the first night. `kitRef` uses a fixed seed (`starterKit(0, salt, type, pop)`), so the values do not change; do **not** hard-code the results as constants (the tables will change; the value must keep following them).
3. Look at what is left in the first-midnight profile (`learnBase`'s `preparedDefense`/`strength` for every other base) and, if it is still over about 100 ms, cache `groupStrength` per `(f, state.hour)` only as far as PERF-4 allows.

**Don't.** Don't change the set of salts, populations or types `kitRef` averages. Don't make `createWorld` consume RNG differently.

**Verify.** Golden hashes; `node tools/gunmodtest.js`, `node tools/gunbuildertest.js`, `node tools/arsenaltest.js`, `node tools/arsenalbalancetest.js`, `node tools/dettest.js` (the full one, about six minutes). Report: the first-midnight cost (before 835 ms on seed 3 Normal), `createWorld` time (before about 275 ms), and `slotRules` calls and time across a 60-day run.

---

# PERF-3: the hex grid without allocation

**Evidence.** `hex.js HexGrid.distance(a, b)` builds two three-element arrays through `cube()` → `xy()` on every call, 549 call sites across the sim and UI. Microbenchmark: 43 ns/call now, **12 ns/call** with the same arithmetic written out (3.4×), and the results matched on 20,000 random pairs. In the autopilot profile `distance` is 3.3% inclusive and `within` 2.4%; on a Huge no-autopilot run `findPath` is 1.6% self time and `spawnAiParty` → `planPath` costs 311 ms of the groups' daily tick; `neighbors()` allocates an `xy` pair and the result array per call; `findPath` (A\*) keeps its scores in `Map`s, calls `neighbors` and `distance` per node and has no closed set (a node pushed twice is expanded twice). `within(center, radius)` calls `distance` for every cell of the bounding box (about 1,700 for radius 20) and is called with radius 20 from `defences.js hordeThreat` for every base every hour in the autopilot (`buildWishes`), and from `liveTiles` / `updateVision` every hour for every base.

**Where.** `prototype/src/sim/hex.js`: `distance`, `cube`, `xy`, `neighbors`, `within`, `beyond`, `findPath`, `MinHeap`. Callers worth a look for per-call recomputation: `defences.js hordeThreat`, `grouppois.js groupTargets` (calls `distance` twice per centre per tile inside a `reduce`), `world.js liveTiles`, `miltrucks.js`, `foraging.js`.

**Approach.**
1. `distance` and `cube`-free arithmetic: `ay = Math.floor(a / w)`, `q = (a - ay*w) - (ay - (ay & 1)) / 2`, compare the three cube axes. Keep the public signature. Add a test that compares old and new on every pair of a small grid and on random pairs of the biggest world size.
2. `neighbors(id)`: return a cached array per tile (the grid is immutable; build lazily, per `HexGrid` instance) **only after** confirming no caller mutates the returned array (grep for `.neighbors(` followed by `.push/.sort/.splice/.pop/.shift` on the result; callers that sort or filter in place would need a copy). If any do, keep allocating but cheaper.
3. `within(center, radius)`: compute by rows (for each row, the exact x-range) instead of testing every cell of the bounding box; the output order must stay what it is now (row-major ascending id) because callers iterate it and the first match or the order of Set insertion can matter. Consider caching ring lists per `(center, radius)` for the hot ones (a base's radius-20 list never changes) in a bounded `Map`.
4. `findPath`: typed arrays or a `Map` pre-sized for the grid, skip stale heap entries (`if (ng > g.get(cur)) continue` style) **without changing tie-breaking**: two equal-cost paths must still resolve to the same one as today. Compare the paths produced before and after for several thousand random start/goal pairs with each real cost function (`parties.js planPath`'s modes) and require identical `path` arrays, not just identical costs.

**Don't.** Don't change `toPixel`/`fromPixel`. Don't change which tiles `within` returns or their order.

**Verify.** The exhaustive equality tests above; golden hashes; `node tools/visiontest.js`, `node tools/tripstest.js`, `node tools/jobtripstest.js`, `node tools/nomadtest.js`, `node tools/caravantest2.js` (they all path-find). Report ns/call for each helper before and after, and the profile share of `distance`/`within`/`neighbors` in a 180-day autopilot run.

---

# PERF-4: the groups' daily work

**Evidence.** In the no-autopilot profile `factionsDaily` is 27% of all CPU, and after the first-day cold costs (PERF-2) these dominate it:
- `aiscav.js aiScavDaily` 7.6% (680 ms): for every living group every day, `landSites` and `landPoiTiles` each call `grid.within(b, 2)` for every base and rebuild a `Set`; then `haulFor` per site (builds weight tables with `Object.entries`/`Object.values` per call), `raidPoiAsGroup` per POI, and `bestSite` → `grouppois.js groupTargets`, which for every tile within range runs `ok(t)` = `tileWorkable` (`state.bases.some`, `state.factions.some(o => … o.bases.includes(t.id))`, `state.hordes.some`, `state.parties.some` per tile) and a `centres.reduce` that calls `distance` twice per centre per tile, then builds and sorts a candidate list of every POI of every tile in range.
- `arsenal.js kitFactor` (called from `groupTripLosses` → `groupGear`, `groupStrength`/`strength`, `unitPower`): 10% inclusive in the profile, but 558 of its 910 ms is the one-time cold `kitRef` (PERF-2). The steady part is `meanValue` → `sortedKit` (329 ms, 3.7%), and 226 ms of that is the sort comparator `byV`, which calls `String(a.aid).localeCompare(String(b.aid))` and recomputes `weaponValue`/`armourValue` (→ `gunmods.js fitted` → `migrateMods`) inside the comparison, each time `A.rev` changes. `kitFactor` also recomputes `fitPeople(f)`, `ammoFactor` → `arsenalRounds(f)` and `eraArms` on every call, from several daily callers per group.
- `grouptrips.js groupFoodLand` / `groupWoodLand` → `bestLand`: `workLand(...)` and per-tile `value(id)` (`gameAbundance × gameLevel`, `forageAbundance × forageLevel`, `woodAbundance × woodLevel`) for every tile of every base's land, every day, for results that change only when the land does.
- `arsenal.js arsenalDaily` → `sortedKit` (re-sorts when `A.rev` changed; `String(a.aid).localeCompare` in the comparator is costly in a sort).
- `groupworld.js knowsOf`/`learnBase` repeatedly compute `preparedDefense` for your bases and `strength(o)` for other groups when they refresh what they know.

**Where.** The files above, plus `factions.js factionsDaily` (the list of daily calls) and `groupcare.js fitPeople`.

**Approach (memos only, results identical).**
1. In `aiScavDaily`, build once per call a tile-occupancy view (`Set`s of base tiles, group-base tiles, horde tiles, scav-party sites) and let `tileWorkable` read it; hoist `landSites`/`landPoiTiles` bases' `within(b, 2)` to a per-base cached list (the grid is static; PERF-3 gives you the cached `within`). The sets must be built at the moment the old code first evaluated them, and must not be reused across the loop if an iteration changes them (the loop sends parties and strips POIs: `state.parties` changes inside it, so the "scav party site" set must be updated when `sendParty` runs, or only that one check left as is).
2. In `groupTargets`, compute each centre's distance once per tile and keep the same `from` selection (first centre with the strictly smaller distance; ties keep the earlier centre, as the `reduce` does now).
3. Make `kitFactor` cheaper without changing a value: cache `fitPeople`-independent parts on `A.rev`, and compute `groupStrength`/`kitFactor` once per `(f, state.hour)` within `factionsDaily` **only if** you show that nothing between the first and last call of a given group changes `f.pop`, wounds, the arsenal or the ammo (`groupCareDaily` and `woundGroup` do change them; place the cache so it is cleared by them, or cache only the pure sub-results).
4. `bestLand`: cache the per-tile land value for a day (key: `state.hour`, tile, job) if the abundance/level sources are changed only by the daily jobs that run before it; otherwise memoize the distance factors and `workLand` list only.
5. `sortedKit`: precompute each item's sort key (`weaponValue` / `armourValue`, `String(aid)`) once per rebuild instead of inside the comparator, and compare the ids with a plain `<` only if it gives the same order as `localeCompare` for every `aid` the game makes (check the id format; if there is any doubt, keep `localeCompare` but compute the strings once). The sort must be stable and produce the identical order: assert it over a few hundred real arsenals.

**Don't.** Don't reorder the groups' loop, the candidate list, or any tie-break. Don't move any of this work to other hours of the day (that would change behaviour; if you think it is worth it, write the proposal in the Handoff).

**Verify.** Golden hashes; `node tools/poiaitest.js`, `node tools/depletetest.js`, `node tools/arsenaltest.js`, `node tools/arsenalbalancetest.js`, `node tools/poipacingtest.js`, `node tools/grouphivetest.js` (and any other group-related test: `ls tools | grep -i -E "group|faction|conflict"`). Report the midnight tick (the 60 ms+ hours' count and the stage table for `factionsDaily`) on Normal/8 groups and Huge/20 groups, before and after.

---

# PERF-5: the autopilot's hourly planners (balance runs, the dev autopilot)

**Why this matters, and how much.** The autopilot is a dev tool and the engine of the balance census (`tools/campaign50.js` runs many 1095-day games); a player does not pay for it. It is 54% of an autopilot campaign's time and the reason a census takes hours. Treat this as the lowest-priority session for the player and the highest for the owner's tuning loop. The rule is stricter here than anywhere else: **the autopilot must make exactly the same choices**, because a census compares runs across commits. A memo that changes one decision shifts the whole run.

**Evidence (inclusive share of a 180-day autopilot run, 48.8 s of CPU):**
- `governBase` 23.7%: `planBuilds` → `buildWishes` 10.0% (`autopilot.js` ~2746; per base per hour; includes `defences.js hordeThreat` 1.6% → `grid.within(base.tile, 20)`; `wormWishes` 1.2%; `repair.js benchWanted` 1.0%; `foodStoreWishes` 1.0%; `factions.js baseDefense` 0.9%; `waterOutlook` 0.5%); `equipFromArmory` 7.8% (`tripgear.js gearOutdoorWorkers`/`tripKit`/`outReady`/`ammoFor` 2.4%, `gunmods.js fitFromPool` 0.9%, `itemScore` → `gearEffect`/`combatPower`); `planCrafts` 4.0% (`wormFilterUrgent` 1.5%).
- `governRoles` → `planRoles` 12.9% (`economy.js foodOutlook` 2.6%, `planWood` 2.3%, `hunting.js autoHuntMix` 1.6% with `hasBow` 1.0%, `planForage` 1.5%, `farming.js farmersWanted`, `foodTarget`/`edibleFood`).
- `autopilotDaily` 8.5% (`planTrip` 4.3%, `governorPlans` → `defenceplan.js defaultRolePlan` 2.2%, `hubFoodRun`, `foodTripCands`).
- `resolvePending` 5.2% (`handleTrade` 3.2% → `visitors.js autoVisitorTrade` 3.0% → `tryDeal` → the PERF-1 price code).
- `foods.js foodIn` is the top *self-time* function overall (4.5%): called from `conditions`, `edibleFood` (`storage.js`), `history.js stockKey`, many planners, always looping the whole stock with `for…in` and a `FOODS[k]` lookup.
- GC 3.3%; `slotRules` 2.6% and `distance` 3.3% (PERF-2, PERF-3).
- Slow single hours: the first governed hour of a game 781 ms (hour 7 of day 1: the opening build plan), later 370 ms, 270 ms, 200 ms hours at hour 7 and 19.

**Approach.** In this order, measuring after each:
1. Land PERF-1, PERF-2 and PERF-3 first (this session's base should include them); re-profile; the list above shrinks.
2. Hoist per-hour invariants: values a planner derives from a base's state more than once per call (`foodOutlook(state, base)`, `waterOutlook`, `threatAt`, `hordeThreat`, `atBase(state, base.id)`, `baseDefense`) are computed once at the top of `buildWishes`/`planRoles` and passed down, **provided nothing in between mutates what they read** (the governor queues builds, trades and moves people as it goes; read the code between the two uses).
3. `foodIn(stock)`: keep the signature and result; make it iterate a precomputed array of `[key, kcalPerDay]` for foods (the `FOODS` table is static) and the stock's own keys via `for…in` only for the keys present; or maintain it incrementally nowhere (too invasive). Measure the self-time drop; stop if under 1%.
4. `tripgear.js ammoFor`/`tripKit`/`outReady`: they re-derive the same answer per worker per hour; cache per `(item, state.hour)` only if the armory cannot change in between (it can: `equipFromArmory` moves items), so cache the pure part (what ammo a weapon key takes) by weapon key in a module `Map`.
5. Only if there is still a big hitch: spread the *opening* build plan's one-off cost by computing `buildWishes`' static parts once per base per day. Do **not** throttle the planners to run less often: that changes the autopilot's choices and the census's baselines.

**Don't.** Don't skip a planner in an hour where it "probably has nothing to do". Don't change `PLAN_HOUR`, `EMERGENCY`, or any personality constant.

**Verify.** The golden hashes (the autopilot is what the digest plays, so these are the proof). Also `node tools/autotest.js`, `node tools/autosafetytest.js`, and a 365-day, three-style (`balanced`, `aggressive`, `cautious`) comparison of `autopilotStats(state)` and the final log hash before and after on two seeds. Report the 180-day wall time and profile shares before and after, and how many campaign50 games per hour that is on the owner's machine class (estimate from the ratio).

---

# PERF-6: the hourly knowledge pass and the food ledger

**Evidence.** Two things run every hour for every player, autopilot or not.
- `world.js updateVision` (0.22 ms/hour, 2% of the no-autopilot run, worst hour 33 ms): `liveTiles` collects `grid.within(b.tile, baseVision)` for each base, fieldwork sight and each team's `sightNow`, then `snapshot(state, id)` is rebuilt for **every live tile, every hour**. `snapshot` filters `state.hordes` for the tile, `find`s the hive site and the group base (`factions.find(f => f.alive && f.bases.includes(tileId))`), searches `deathSites` twice (`find` then `find` again for `.items.length`), and builds its object with a spread of `poiSnapshot`. That is O(live tiles × (hordes + hive sites + group bases + death sites)) per hour. Then `noteFinds(state, state.grid.within(b.tile, baseVision), …)` runs `within` again.
- `foodlog.js foodMarkAll(state, phase)` runs about seven times an hour (20,238 calls over 2,874 hours) and each `foodMark` per base builds `foodStock(base)` (a new object), `new Set([...Object.keys(now), ...Object.keys(last), ...Object.keys(x)])` and diffs. 687 ms of 48 s with the autopilot (1.4%), 165 ms of 8.9 s without. When `now` equals `last` (nothing moved: the common case) all that work finds nothing.

**Approach.** (a) In `updateVision`, index hordes by tile, group bases by tile (honouring `state.intel.unseen`), hive sites by tile and death sites by tile **once per call**, then let `snapshot` read the indexes (add an optional `index` argument; other callers of `snapshot` keep working unchanged). Keep every field of the snapshot identical and in the same key order (it is stored in `state.knowledge` and saved). Compute `liveTiles` and `noteFinds`' `within` lists from one cached per-base list per `(tile, radius)` (PERF-3). (b) In `foodMark`, compare `now` and `last` first with a cheap pass and return when equal and `x` is empty, otherwise do exactly what it does now. Do not skip a mark: the *phase* of the next change depends on it.

**Verify.** Golden hashes; `node tools/visiontest.js`, `node tools/foodchaintest.js`, `node tools/foodtypestest.js`, `node tools/discoverytest.js` if present (`ls tools | grep -i -E "discover|vision|foodlog|foodchain"`), `node tools/savetest.js` (the snapshots are saved). Report ms/hour of `updateVision` and `foodMarkAll` before and after.
