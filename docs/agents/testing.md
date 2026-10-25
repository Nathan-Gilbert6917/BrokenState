# Running only the affected tests

The suite is about 370 `prototype/tools/*test*.js` files and takes hours. In a session, run only the tests your change can affect.

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

## A red test

- Find the cause. If your change caused it, fix the code, or fix the test if it encoded the old behaviour on purpose.
- If it is also red on `origin/dev` (check it out in a scratch worktree, `git worktree add <dir> origin/dev`, and run the same test there), it is not yours: say so in your report, with the failure, and leave it.
