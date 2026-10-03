# Review: drawing, dev tools, autopilot, timelapse (phase 1, find only)

Stopped early on the coordinator's instruction (usage limit). Items marked UNVERIFIED were found by reading only, or their test script was written but not run. Nothing under `prototype/` was changed.

Scratch scripts and PNGs: `%TEMP%\claude\C--Users-nate--OneDrive-Desktop-NGP\4037875a-ac92-4d38-9d09-b947b700d3d6\scratchpad\review\render\` (PNGs in `png\`).

## Findings, most severe first

**[R-1] BUG · major · Panel buttons are likely unclickable while the clock runs fast (UNVERIFIED in a browser)**
where: `src/main.js:84` (`if (dirty) refresh()`), `:88-132` (`refresh` replaces `innerHTML` of top bar, left, right, log, legend, dev panel, orders), `:494-502` (click handler).
Every tick sets `dirty`, so every panel is rebuilt once per tick: every 3 s at 1×, every 0.3 s at 10×, every frame at 50× and 200×. A click whose mousedown and mouseup land on different (replaced) nodes does not reach `[data-action]`. Expected effect: at 50×/200× the dev panel's own speed buttons, the Autopilot checkbox, "Timelapse so far", the top-bar pause and the layer checkboxes mostly ignore clicks; at 1× a few percent of clicks are lost. `hideTip()` at the end of `refresh` also removes hover descriptions on every tick. By reading; keyboard shortcuts are not affected.
Fix: keep the last HTML string per panel and skip the `innerHTML` write when unchanged; throttle `refresh` to about 4 per second above 3×; do not call `hideTip()` unless the hovered element was replaced.

**[R-2] BUG · major (cross-area: parties.js / hordes.js) · Hordes of size 0 stay forever**
where: `src/sim/parties.js:951` (`horde.size = Math.max(0, …)` when an AI party walks into a horde, no removal); `hordes.js:93` (0 × 1.006 stays 0); `hordes.js:88` (`MAX_HORDES` 18).
Reproduced: my invariant check flagged "horde size 0" in 6 of 8 Balanced, 3 of 8 Cautious and 4 of 8 Aggressive 365-day runs (first seen between day 38 and day 305). A dead horde keeps one of the 18 slots, is counted in the dev panel ("Hordes N") and is recorded in every timelapse frame (2 on seed 3). It is not drawn (`render.js:323`).
Fix: remove the horde when its size drops below 5, as `onHordeEnter` already does.

**[R-3] BUG · minor · One group always has almost the player's blue**
where: `src/sim/data.js:161` `FACTION_COLORS[3] = "#4fa3d9"` vs `render.js:397` `PLAYER_COLOR = "#4f8fd6"` (difference 0/20/3 in RGB).
Looked at `png/d150_z130_fog.png` and `png/d150_z045_reveal.png`: the group at Miller Cabin, 4 tiles south of the hub, has territory, base ring and flag that read as the player's. Happens in every game with 4 or more groups. `#7f8cf0` (index 7) is also close.
Fix: replace index 3 with a color far from blue (for example a teal-green or brown) and keep blue for the player only.

**[R-4] BUG · minor · Base names are covered by siege camps, attackers and hordes**
where: `src/ui/render.js:264` (`drawLabels` runs before markers, hordes and parties), `:327` (horde beside a base at +17,+13), `:357-360` (camp at −25,+17, attackers at +24,+12).
Looked at `png/x_siege0_player_z180.png`, `png/x_siege0_player_z060.png` (outpost name under the camp and the attackers) and `png/x_horde_on_base_z180.png` ("Fallon Gas" under the horde and its badge).
Fix: draw labels after the parties, or move a base's label below the camp row when it is besieged or has a horde beside it.

**[R-5] BUG · minor · Teams, convoys and raids on a base tile are drawn on top of the base**
where: `src/ui/render.js:363-364` (other groups' parties), `:637-638` (your parties).
Looked at `png/d150_z250_fog.png` and `png/d150_z130_fog.png`: a raid passing through the hub tile (on its way elsewhere, phase "out") sits on the hub sprite with its red ring; `png/x_siege0_player_z180.png` shows a supply convoy hiding the outpost. Hordes get an offset on base tiles, parties do not.
Fix: use the same "beside the base" offset for any party whose tile has a base.

**[R-6] BUG · minor · Fog leak: never-seen sites use the real loot for the picked-over look**
where: `src/ui/render.js:197` and `:415`. `state.knowledge` holds `null` for never-seen tiles (`world.js:46`), so `snap === null` is true both for live tiles and for never-seen ones, and `t.loot` is used. The comment says never-seen sites look untouched.
Reproduced with a differential test (`fogcheck.mjs`): a copy of the state with hidden tiles' loot changed draws different pixels on never-seen site tiles. In play this shows when a team out of contact searches a never-seen site: it greys out before the team reports.
Fix: pass an explicit `isLive` flag to `drawSite` and use `t.loot` only then.

**[R-7] BUG · minor (cross-area: ui.js, autopilot.js) · Tile actions and the governor read things the player has not seen**
where: `src/ui/ui.js:218` (`t.loot` for tiles with no intel), `:219-222` ("Trade visit" shown and "Build outpost" hidden on any base of a known group, seen or not); `src/sim/autopilot.js:944` (same base list in `siteScore`), `:1077` (`outpostSite` avoids bases of unknown hostile groups).
Reproduced: with the scrubbed state, the action list differed on 6 to 112 hidden tiles per check (seeds 3, 5, 8; days 30, 150, 300). A player can right-click sites to find where a known group has expanded. Tooltips did not leak (0 differences). Reveal map does not add actions: `tileActions` keeps using `state.live`, which is consistent with "display only".
Fix: decide from `snap.factionBase` / `snap.loot` for non-live tiles; in the governor use knowledge snapshots and `f.known` only.

**[R-8] BUG · minor · Fog leak: a last-seen horde shifts when a base it cannot know about stands there**
where: `src/ui/render.js:316-317, 325` (`groupBases` is built from every living group's real bases and used for stale ghosts too).
Reproduced in the differential test (the only remaining pixel differences once loot was left alone). No other draw path leaked: hordes, nests, other groups' parties, bases, territory and infection matched pixel for pixel at zoom 0.45, 0.7, 1.0 and 2.0.
Fix: for non-live tiles use `k[t.id].factionBase`.

**[R-9] BUG · minor · Battle zombies never look like brutes and almost never like runners (by reading)**
where: `src/ui/sprites.js:350-354`, `src/sim/combat.js:507-508`.
Zombie power is 1 (road conflicts) or `2 + infection × 3` (at most 5). `maxHp = round(15 + 7p)` is at most 50, so `tough = maxHp >= 55` is never true; `fast = mob >= 3` needs power 5, which means infection exactly 1.0. With the default "By strength" setting the result is about 85% walkers and 15% bloated; the README and the option tip promise runners and brutes.
Fix: derive the look from power directly (for example runner from power 3.5, brute/bloated from power 4), or lower the HP threshold to about 40.

**[R-10] BUG · minor · Dev panel history survives a new run on the same seed (by reading)**
where: `src/ui/devtools.js:36-39` (history reset only when `state.seed` changes; a sample is added only when the day is greater than the last sample's).
Typing the same seed again (or changing the group count, which rebuilds on the same seed) keeps the old samples: no new samples until the new run passes the old run's last day, and the "last 7 days" deltas compare against the old world.
Fix: also reset when the day goes backwards, or key the history by the state object.

**[R-11] BUG · minor · Fast-forward backlog is not clamped (by reading)**
where: `src/main.js:66-77`.
Numbers: 200× asks for 200 / 3 = 66.7 hours per second (2.78 days per second, a year in about 131 s). That is 1.1 ticks per frame at 60 fps and 3.3 at 20 fps, so the 12-tick cap is not reached; it binds only below 5.6 fps. When it binds, `acc` keeps the remainder and grows without limit, so the game keeps running 12 ticks per frame after the speed is lowered or after pause and resume.
Fix: `acc = Math.min(acc, 12)` after the loop.

**[R-12] BUG · minor · Dev speed and Reveal map carry over into a new campaign (by reading, UNVERIFIED in a browser)**
where: `src/main.js:386` (`restart`) and `:482-492` (`newWorld`) do not reset `ui.speed` or `view.devReveal`.
After watching a 200× autopilot game end, "New campaign" starts the next game at 200× with no top-bar button lit (`ui.js:45` lists only 0 to 3×).
Fix: set `ui.speed = 1` in `restart`; show the dev speed in the top bar when it is active.

**[R-13] BUG · minor · Turning off "Locations" also hides other groups' bases**
where: `src/ui/render.js:195`.
Looked at `png/d150_z100_reveal_off_pois.png`: territory and parties stay, every group base and its name is gone. The layer is described as "Towns, sites and their names".
Fix: skip only plain sites when the layer is off.

**[R-14] BUG · minor · Governor log lines and unplaced fights appear as timelapse captions**
where: `src/sim/chronicle.js:228-232`, `src/sim/autopilot.js:928` (`say(state, msg, "good")`).
Reproduced (Balanced, seed 3, 365 days, 242 captions): 2 captions read "🤖 … treated on a cot at Sutter Holdout…", and "Fight near Sorensen Farm: defeat." has no map position (tile −1, so no ping and no link).
Fix: skip log lines that start with 🤖; resolve "near X" through the site name.

**[R-15] BUG · minor · Timelapse: wheel-out can zoom in on small windows (UNVERIFIED, computed by hand)**
where: `src/ui/timelapse.js:164` (fit zoom down to 0.08) vs `src/ui/render.js:60-65` (`zoomAt` clamps to `minZoom`, 0.15 to 0.45).
For a 1280 × 720 map area the fit zoom is about 0.32 and `minZoom` about 0.41, so the first wheel notch in either direction jumps to 0.41. `tlviewer.mjs` tests this but was not run.
Fix: let `zoomAt` use `min(minZoom, current zoom)` as the floor while the timelapse is open.

**[R-16] BUG · minor · README says towns keep their names when zoomed out; they do not below 0.55**
where: `src/ui/render.js:220` and `:253`. Looked at `png/d1_z045_whole.png` and `png/d150_z045_fog.png`: only the two cities and the hub are named; towns, landmarks, outposts and group bases have no name at the widest zoom.
Fix: change the README, or lower the tier-1 threshold.

**[R-17] BUG · minor · Role churn under the governor (cause not analyzed)**
where: `src/sim/autopilot.js:643-754`.
Measured role changes per 365 days: Balanced 1,595 to 9,466 (seed 6: 26 a day), which suggests people flip between roles hour by hour despite `STICKY`. UNVERIFIED whether it is a true oscillation or follows real need.

**[R-18] BUG · minor · Smaller governor issues (by reading, UNVERIFIED)**
- `autopilot.js:444-456` `guardArrivals` rewrites `p.mission` / `p.orders` of teams that are moving and out of radio contact; the UI cannot do that, and the README says the governor only uses the UI's calls.
- `autopilot.js:1103-1107` repairs and refuels the vehicle before the trip is validated; a rejected candidate still costs parts and moves fuel into the tank.
- `autopilot.js:1156-1172` supply-run crews ignore the style's `homeFrac`, so a trip and a supply run on one day can take more people than the style allows.
- `autopilot.js:894` hands out weapon, armor, head, arms, legs and backpack but never tools; crafted crowbars and bandage kits stay in the armory.
- `render.js:649` writes `p.planPath` from the renderer (header says it never changes the sim). The state hash did not change in any test, so it does not trigger in practice. The team panel does change survivors (`ensureInv`), reproduced.

**[R-19] SUGGESTION · major · The governor cannot lose; numbers for balance**
Measured, 365 days, 8 seeds per style, 8 groups: 0 of 24 holdouts fell.
- Balanced: 41 to 72 alive at day 365 (population only grows), 2.1 deaths on average; hub stock at the end: food 933 to 7,068, scrap 7,698 to 15,837, ammo 407 to 5,487, meds 407 to 892.
- Cautious: 27 to 43 alive, 0.5 deaths.
- Aggressive: peak 77 to 120; on 4 of 8 seeds 72 to 101 people then walked away (crowding: the hub has at most 40 beds, `crowdSlack` is 8), ending at 26 to 52.
Why (by reading): the hub is never removed (`factions.js:222`, `hordes.js:70` remove outposts only); an overrun hurts 3 people for 30 to 70. The largest possible raid is 50 pop × 1.6 arms × 0.4 = 32 and the largest horde attack is 140 × 0.14 = 19.6, while defense is the sum of everyone's combat power × 0.8 to 1.5 plus walls, well over 100 with 40 people. Newcomers have no cap (strangers at 6% a day are about 22 a year, plus refugees and loners).
What would have to change for Balanced to lose about half its games was NOT tested (experiments not run). Candidates to try, with what the player would see: raids and hordes that scale with the day or with your population (threats stay dangerous after day 60); an overrun hub that kills people or can fall; a population or bed cap for the hub; food that does not pile into the thousands.

**[R-20] SUGGESTION · minor · Drawing**
- A site with any marker on it is drawn at 55% for as long as the marker exists (`render.js:218, 438`); death-site tiles in the city look washed out for the whole game (`png/d150_z180_city_reveal.png`).
- A camping team's tent is the same blue as the walkers in front of it (`png/x_camp_z180.png`).
- Outposts on open ground are named "farmland (15,13) Outpost" (`parties.js:550`); it shows on the map and in captions.
- At zoom below about 0.5 a horde "beside" a base lands in the neighboring tile because the offset grows with `zoomBoost` (by reading).

**[R-21] SUGGESTION · minor · Performance and a desktop build**
Measured: the sim runs 1,000 to 5,500 in-game hours per second headless with my per-tick checks on (65 people slows it to about 1,000). Chronicle: 0.17 ms per frame, 14 ns per hour when no frame is due, about 337 KB for 365 days, random seek 0.013 ms, `frameState` 0.95 ms. Sprite caches cannot thrash: the working set is far below the 500 / 600 limits (UNVERIFIED by measurement).
By reading, the per-frame cost that matters is `refresh` (see R-1): at 50× and 200× it rebuilds every panel each frame, including `renderRight`'s `estimateTrip` (three A* searches for the selected tile, `ui.js:249`), `renderDevPanel`'s scan of all 2,688 tiles, and `hoursLeft` per team in the running-orders list. `drawMapSprite` calls `getTransform()` per sprite. Real frame times, `drawImage` / `fillText` counts at day 300 were NOT measured. Nothing found that would block an Electron build once R-1 is fixed.

## What was tested
- `ap365.mjs`: 365 days × 8 seeds (1 to 8) × 3 styles with per-tick invariants. No crashes, no NaN or negative stock, nobody in two places, no item in two places, no card left open after a tick, longest wait 6 h, no cut-off teams, governor memory 1.2 to 4.7 KB, log at most 52 lines a day (cap 200). Only violation: R-2. Output in `ap365_balanced.txt`, `ap365_ca.txt`.
- `scenes.mjs` (seed 3): day 1 and day 150 (Aggressive) at zoom 0.3, 0.45, 0.7, 1.3, 2.5, fog and Reveal, infection overlay, each layer off, outposts, city, each group base, selection / hover / preview, plus siege, horde on a base, camp, boat build and afloat, trade and supply convoys. I looked at about 20 of the 70 PNGs. Worth the lead's eyes: `d150_z130_fog.png`, `d150_z250_fog.png`, `x_siege0_player_z180.png`, `x_horde_on_base_z180.png`, `d150_z180_city_reveal.png`, `d150_z100_reveal_off_pois.png`.
- `fogcheck.mjs`: state hash before and after render, tooltips, tile panel and dev panel with Reveal off and on (no change to the sim or knowledge); differential leak test (R-6, R-7, R-8).
- `tlcheck.mjs` (Balanced, seed 3, 365 days): frames, decode sequential vs random (0 mismatches in 376), frame states vs the live world (owners, hordes, bases, nests, population all match), captions in order with no exact repeats, 751 frame states drawn by the real renderer with 0 errors, sim untouched. `tools/autotest.js` and `tools/timelapsetest.js` pass.

## Not covered
- `tlviewer.mjs` (open mid-game and return, keys, game-over frame, graves, new run) was written but not run.
- 1,000-day memory, key wrap (529 keys used in 365 days, limit 65,535), battle sprite PNGs, sprite cache counts, render script time at day 300, balance experiments, `state.autoCombat` restore beyond what `autotest` checks, autopilot with 0 to 2 survivors.
- Anything that needs a real browser (R-1, R-12, R-15, fonts and label widths; the software canvas uses a block font and solid lines for dashes).
