# Browser start-to-end run (lead, 2026-10-03) — interrupted by the usage limit

Run in the real browser pane against the code at commit 81ece47, game in an iframe at 1396×785 and 1920×1080, real frame loop.

## Worked (no console errors)
- New-run screen: rename, random name/skills/look, skill +/-, leader pick, look editor, zombie look modal, Start (edited crew kept).
- Clock: 1× = 3 s per hour; 200× = 66.7 h/s at ~62 fps; frame script cost avg 0.4–1.8 ms, max ~30 ms.
- Dev tools: backquote opens panel; reveal, infection, autopilot (checkbox and P), styles, fast forward.
- Autopilot to day 157 and day 183 on two seeds: no errors.
- All left tabs and all nine base tabs render with no "undefined"/"NaN".
- Construction queue + cancel (half refund), craft queue + cancel (full refund).
- Inventory paper doll: click-to-move, pocket size rule, send to armory, Esc order.
- Map: left-click select, right-click menu, planner, launch, ETA exact (3 h), "Done" card on the destination tile.
- Order queue: gather 3h → look around 2h → camp 8h ended with a Done card at exactly 13 h; auto-unpause on the first order.
- Boat crossing: 9 scrap, 4h + 1h, landed across the river; return home worked.
- Tactical battle: click-move, Tab/1–3 select, F + target, O, H, M, Space; defeat result screen.
- Game over screen, timelapse (play/pause, step, jump, keys, scrubber, event ticks, caption click, fit, close).
- New campaign resets state, chronicle, dev reveal, autopilot.

## Bugs to fix
1. Launching a trip from the planner does not unpause (other timed orders do).
2. Running-orders overlay says "no contact (back around day N)" for a one-way Move; log says "back in about 1 days".
3. Dev panel group table overflows horizontally (panel 23rem).
4. After dev fast-forward, the auto-resume speed (ui.lastSpeed) is 200×.
5. New campaign keeps ui.expedition from the old game; ui.speed carries over as 0.
6. Planner skill abbreviations cut to 5 letters: "Steal" (Stealth), "Scave", "Speec", "Mecha".
7. Duplicate first names in a starting crew (two Lucias, two Nadias); tabs show first names only.
8. Game over is only set in killSurvivor: desertion (economy.js:105) and conflicts.js:1288 never end the game.
9. Combat handlers are registered lazily (conflicts.js ensureHandlers); a battle started any other way leaves a party of dead members. Add an hourly sweep for parties with no living members.
10. Fractional stock values (scrap 1322.215) and health (82.967) in state; check every display rounds.
11. Raid bot (unfinished test): 21 turns, 0 containers searched, repeated "move click failed" toward interior cells — check whether my BFS (4-neighbour, "open" cells) disagrees with the game's reachability, or doors/walls block entry.

## Suggestions (for the user's pick-list)
- Difficulty: autopilot never loses; food 1600–2800 by day 150; every site within ~12 tiles picked clean by day 147 (loot floor 0.03).
- Outpost names like "farmland (5,16) Outpost"; let the player name them.
- Legend text is very long; top bar wraps to two rows at ~1400 px wide.
- Warn about unspent skill points on Start.
- Crossbows hit ~20% at range; 3 survivors lost to 4 power-5 raiders.

## Not done
- Loot-bodies screen after a won battle, raid search/extract in the browser, outposts, supply runs, trade, raid defence by hand.
- A page hang once with the first test harness (no backpressure, pane became visible); not reproduced with the second harness.
