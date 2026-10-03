# UI layer review (phase 1: find, don't fix) — stopped early at the usage limit

Scope: `src/main.js`, `src/ui/ui.js`, `expedition.js`, `inventory.js`, `newgame.js`, `combat.js`, `styles.css`, `index.html`.
Method: all eight files read line by line; a fake DOM that imports the real `src/main.js` in node and drives the real document/window listeners from the rendered HTML.
Scratch scripts: `%TEMP%\claude\C--Users-nate--OneDrive-Desktop-NGP\4037875a-ac92-4d38-9d09-b947b700d3d6\scratchpad\review\ui\` (`harness.mjs`, `play.mjs`, `static_wiring.mjs`, `t01`–`t05`, `monkey.mjs`).

Each finding says **reproduced** (script output) or **by reading** (not run, or needs a real browser). The work was cut short, so several "by reading" items are unverified.

## Findings, most severe first

**[U-1] BUG · major · "Watch the timelapse" is hidden behind the battle screen when the last survivor dies in a tactical battle**
where: `main.js:135-146` (`renderCombat`), `ui.js:293`, `styles.css:116` (`#combat` z-index 20, fixed) vs `styles.css:251` (`#timelapse` z-index 7 inside `#mapwrap`).
Reproduced (`t05_battle.mjs`): after a total party kill `state.gameOver` and `state.combat` are both set. Clicking *Watch the timelapse* hides the modal, but `#combat` stays visible and covers the map and the viewer. Esc goes back to game over; the only way through is the battle panel's *Continue*.
Fix: in `tl-open` (or when `gameOver` is set) close the finished battle (`closeCombat`), or hide `#combat` while `ui.timelapse` is open.

**[U-2] BUG · major · Every tick rebuilds every panel, so clicks get lost at speed**
where: `main.js:84` and `88-132` (`refresh()` sets `innerHTML` of top bar, left, right, log, legend, dev panel, orders on every tick).
By reading (needs the real browser). A click needs mousedown and mouseup on the same element; at 10× the panels are replaced about 3 times a second, at 50× / 200× almost every frame. Expect the pause and speed buttons, the dev panel and the team panel to ignore most clicks at dev speeds (keyboard still works). Also `hideTip()` on every refresh kills hover tips each tick, and the UI-scale dropdown closes when a tick lands (only selects inside `#left` are guarded, line 92).
Fix: skip the assignment when the HTML string is unchanged (move the clock into its own element), and hold refreshes while a pointer is down.

**[U-3] BUG · major · Typing in a field and then clicking a button swallows the click**
where: `main.js:503-510` (change → `refresh()`), fields `pl-supply`, `rename`, `seed`, `rt`, `sr-line`, `sr-every`.
By reading (browser behaviour). Mousedown on the button blurs the input, `change` fires, the modal is rebuilt, and the button under the cursor is a new element, so no click. Typical cases: edit supplies then *Send team*; rename or change the seed then *Start*. The second click works.
Fix: same pointer-down guard as U-2, or update state on `change` without rebuilding the modal.

**[U-4] BUG · major · Modal scroll jumps to the top on every click**
where: `main.js:96-104`. Only `.basebody` scroll is kept; `.box` (the scrolling element, `styles.css:77`, max-height 90vh) is recreated.
By reading. Affects the new-run screen (three rows of cards overflow 90vh on laptops or above 100% scale), the planner, survivor, inventory and conflict screens: clicking a skill "+" on a bottom card scrolls back to the top.
Fix: save and restore `modal.querySelector(".box").scrollTop` as well.

**[U-5] BUG · major · A second pending card is drawn on top of a battle the first card started**
where: `ui.js:292-309` (`renderModal` has no `state.combat` guard), `main.js:102` (`over-combat` is toggled for any modal, not only the loot screen).
Reproduced (`t05`): two cards queued, the first one's choice starts a fight; the modal then shows "Second card" with `over-combat` above the open battle. Keys still go to the battle underneath (Space ended the turn behind the card). The same path puts "The leader is dead" over the battle result before the player has seen it.
Fix: while `state.combat` is set, show only the loot screen (and game over); hold cards until the battle closes.

**[U-6] BUG · major · Opening a supply job whose home outpost was lost freezes the game with no window**
where: `main.js:192-198` (`sr-edit` sets `ui.baseView.id = j.originId`), `ui.js:200` (Teams tab *Supply runs…* opens `sjob.originId`), `ui.js:607-608` (`baseModal` returns null for a missing base), `main.js:58-59` (`blocked()` is true while `ui.baseView` is set).
By reading, not reproduced (cut off). Outposts are removed in `factions.js:225` and `hordes.js:72`; jobs keep the dead id ("a lost base → …"). Result: no modal, clock stopped until Esc.
Fix: in `refresh()` drop `ui.baseView` (and `ui.supplyForm`) when the base no longer exists; make `sr-edit` / `openbase` refuse a missing base.

**[U-7] BUG · minor · Survivor names reach `innerHTML` unescaped in the map tooltip**
where: `render.js:686` (`m.label`, e.g. "Death site: <names>") and `render.js:689` (captive first names), inserted by `main.js:567` (`tip.innerHTML = tileTooltip(...)`).
By reading. Breaking input: rename a colonist `<img src=x onerror=alert(1)>` on the new-run screen; when they die on a live tile or are held captive, hover that tile.
Everything else held: with the name `"><u>pwn</u>& O'Neil<u>z</u>` no injected element appeared on the new-run screen, top bar, all four left tabs, right panel, base tabs, survivor, inventory, planner, cards, battle panel, loot screen or log (reproduced, t02–t05).
Fix: escape both inserts in `tileTooltip`.

**[U-8] BUG · minor · New campaign and the new-run screen do not reset UI state**
where: `main.js:482-492` (`newWorld`), `386` (`restart`), `379-385` (`begin`), `709-718` (keys).
Reproduced (`t02`): on the new-run screen Space sets speed 0 (the game then starts paused), 1–4 change speed, backquote opens the dev panel for after Start, I switches the infection overlay on, W/A/S/D pan.
By reading: `restart` keeps `ui.speed` (a run that died at 200× starts the next one at 200×), `ui.dev`, `view.devReveal` (fog stays off), the infection layer, `ui.cardResult`, `ui.moveParty`, `ui.expedition`, `ui.xpQueue`, `ui.tab`, `view.preview`.
Fix: reset these in `newWorld`/`restart`; ignore map shortcuts while `!ui.started`.

**[U-9] BUG · minor · A lethal card's result is skipped and shows up in the next campaign**
where: `main.js:364` (sets `ui.cardResult`), `ui.js:297-298` (game over wins over the result), `main.js:386`.
By reading. If a card choice kills the last survivor, the player gets game over without the result text; after *New campaign* → *Start* the old result box appears and pauses the new game.
Fix: clear `ui.cardResult` on restart; show the result before game over.

**[U-10] BUG · minor · Move mode: a failed pick still ends the mode and un-pauses**
where: `main.js:583-593` and `652-656`.
By reading. Clicking water, an unreachable tile or the team's own tile logs the error, clears `ui.moveParty` and calls `resumeTime()`; the team is left waiting with no card while the clock runs. `ctxmove` during move mode leaves `ui.moveParty` set, so the banner stays and time stays paused.
Fix: keep move mode (and the pause) when `orderMove` returns an error; clear `ui.moveParty` in `ctxmove`.

**[U-11] BUG · minor · Esc closes every layer at once**
where: `main.js:719-730`.
By reading (t03 confirmed Esc closes the base screen; the inventory branch at 701-703 closes only itself). Esc on the survivor screen opened from a base closes both; Esc on the planner or help also closes the team panel; Esc in a half-filled supply-run form throws the form away with the base screen.
Fix: close only the topmost layer per press.

**[U-12] BUG · minor · Loot screen: the body portrait has two `style` attributes, so its tilt is dropped**
where: `inventory.js:173` passes ` style="transform:rotate(-8deg)"` to `spriteImg` (`sprites.js:450`), which already writes `style`.
Reproduced (parser: "duplicate attribute style on img").
Fix: let `spriteImg` merge extra style, or wrap the image.

**[U-13] BUG · minor · Shortcuts act behind modals**
where: `main.js:709-718` (no check for an open modal).
By reading. Space or 1–4 behind a card or the planner silently changes speed (Space on a card leaves the game paused afterwards); P switches the autopilot on behind the planner, base or help screen.
Fix: skip map shortcuts when `#modal` is visible.

**[U-14] BUG · minor · Help and mission text describe the old scavenging**
where: `ui.js:328` ("search hour by hour"), `parties.js:35`, tooltip at `ui.js:104` path.
Reproduced that scavenging opens the raid map in the browser (`t04`). Help also says nothing about the team panel, battles, supply runs, crafting, medical or the autopilot.

**[U-15] BUG · minor · Small text and state slips**
- `ui.js:185`: Teams tab prints the raw phase ("📻 Radio contact · out / engaged / helping"). By reading.
- `main.js:451`: `stationop` keeps an older message, so "— none —" can still say "X now runs this station." By reading.
- `ui/combat.js:171` + `sim/combat.js:835`: R in a raid answers "Move into the evacuation zone first." (raids use extraction zones and X). Reproduced.
- `main.js:228`: *Come home* / *Disband here* on a Teams-tab card write `ui.baseMsg`, which `openbase` clears before anyone sees it. By reading.
- `expedition.js:99`: team-panel *Return home* tooltip says "Clears the queue", but for a moving team it is appended to the queue; the Teams-tab button returns at once. By reading.

**[U-16] BUG · minor · Unspent skill points vanish when the seed or group count changes**
where: `newgame.js:40-44` (`budgetOf` is keyed by survivor id; a rebuilt world has new ids and takes the current total as the budget).
By reading; t02 confirmed new ids get fresh budgets, the loss itself was not run.

**[U-17] SUGGESTION · minor · People tab leaks and treats teams that are out of contact**
where: `ui.js:108-109`, `622-636`, `main.js:233`.
By reading. The team panel hides health without contact and treats with a 1-hour order; the People tab shows live health and mood for everyone away and its *Treat* works instantly without contact. In play: you can nurse a team you supposedly cannot reach. Choose one rule.

**[U-18] SUGGESTION · minor · Space ends the battle turn with no confirmation**
where: `ui/combat.js:169`.
Reproduced: Space ended a turn with 4 units unspent. Space is pause on the map, so this is easy to hit by habit. Ask once when units still have actions, or use Enter only.

**[U-19] SUGGESTION · minor · Layout at the supported scales**
where: `styles.css:37` (side panels 22rem + 21rem), `116` (battle panel 23rem), `239` (dev panel 23rem), `191`.
By reading. At 200% the side panels need 1376 px, so the map has about 540 px on a 1920 window and nothing on 1366; the dev panel alone is 736 px. Consider capping the scale by window width or letting panels collapse.

**[U-20] SUGGESTION · minor · Robustness of the frame loop**
where: `main.js:61-86`. By reading: one exception in a tick, render or refresh stops `requestAnimationFrame` for good (frozen clock and map, buttons still live). No crash was found in testing; a try/catch that logs and re-arms would make a future bug survivable.

**[U-21] SUGGESTION · minor · Smaller items**
- Water tiles offer *Send recon* / *Send a team here*; the planner then says "No route" (reproduced, t03).
- The seed field accepts -5, 2.5 and 1e21 (worlds build fine; reproduced). Clamp to whole positive numbers.
- README controls table omits W/A/S/D and arrow panning on the main map, and S / X in battle; Space also does "Take all and continue".

### Cross-area (not mine, tripped over)
- **Negative hub food**: "A stranger at the gate" → *Let them in* does `stock.food -= 5` with no check (`economy.js:122`); the top bar showed -5. Reproduced (monkey seed 5). The card also prints raw skill and trait keys.
- **Trade routes take any rate**: the setup screen (`ui.js:522-525`, `main.js:308-314`) accepts "send 1, receive 9999" and `parties.js:915-921` hands over `min(recvQty, stock)`. By reading, unverified.
- `inventory.js:449`: death-site name reads "Test raiders's dead". Reproduced.

## What was tested
- **Wiring (static script)**: 150 `data-action` values emitted; 133 click handlers + 17 change handlers; 0 without a handler, 0 handlers never emitted, none in both maps. Selects and inputs are all on the change path.
- **Checkboxes**: `layer` (change path), `dev-reveal`, `dev-infection` (click + preventDefault) and planner crew boxes toggle correctly; `dev-autopilot`, `sr-*`/`rt-crew` only via the monkey or by reading.
- **Render sweep, day 1** (`t03`): top bar, 4 left tabs, legend, dev panel, right panel + tooltip + context menu for all 39 site types (39 defined, not 40), water, bridge, each terrain, hub, AI base, nest, with and without Reveal; 9 base tabs; survivor + look editor + inventory for all 6; help; zombie look; planner for all 13 missions, to water and to the hub tile. 0 bad tokens ("undefined", "NaN", "null", "Infinity", "[object"), 0 unbalanced tags, 0 empty tips.
- **New-run screen** (`t02`), **expedition through the UI** (`t04`: planner, Teams tab, team panel without contact / waiting / camping, queue, move mode, raid, orders card, return), **battle UI** (`t05`: hotkeys, click select, enemy phase by frames and by the hidden-tab interval, result buttons, loot screen click / body tabs / take all, Leave, Enter).
- **Monkey**: 5 seeds, 27,000 random steps (clicks on live elements, keys, map and battle clicks, drags, frames), up to day 257 and 14 bases, 79 distinct actions hit: 0 exceptions, 0 bad HTML, 0 invisible blocks, 1 state problem (negative food above).

## Not covered
- Real-browser confirmation of U-2, U-3, U-4, U-19.
- Reproduction of U-6, U-7, U-9, U-10, U-16 and the restart half of U-8.
- Directed tests of the supply-run form, trade screen, route setup and old engagement screen (the monkey barely reached them); outpost base tabs at day 100 as a directed sweep.
- Scripted CSS class cross-check (classes used vs defined) and a per-handler `data-*` attribute audit.
- Autopilot hand-back cases beyond what the monkey toggled.
