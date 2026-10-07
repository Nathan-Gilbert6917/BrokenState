# Suggestions 4: needs, QoL and UI (2026-10-07)

Written after a look over dev 25d899e (title screen, battle QoL, Ironman, census fixes merged). It leaves out anything
already built or already on suggestions-2/3, except the open items listed at the end. Nothing here is built yet. Pick
items by number.

What stood out: the game has **no sound at all** (no AudioContext anywhere), **no onboarding** (Help is a 115-line
topic list), **every card pauses the clock** (main.js:159), and the top bar mixes player buttons with dev buttons
(UI scale, Zombies, Dev sit next to Diary and Roster).

## A. Things the game needs (gaps a new player hits)
1. **Sound, first pass.** Generated with WebAudio (no files), so it stays dependency-free: a UI click, a card chime
   by urgency, gunfire/melee/groan in battles, wind and rain that follow the weather, a low drone at night, a horde
   sting when one is seen. Volume sliders (master/effects/ambience) in the menu. *Feel:* the biggest jump in "game-ness"
   per hour of work; you notice a raid before you read it.
2. **A guided first week.** An opt-in "First run" checklist pinned under the alerts (build a water barrel, send a
   scavenge team, set work priorities, survive the first night), each step pointing at the button with a pulse. It
   switches off by itself after day 7 or from the menu. Pairs with a short "Start here" Help topic.
3. **Pause rules instead of "every card pauses."** In the menu: pause on combat / raid at a base / death / new
   group contact, while the minor road and hub cards wait in a tray at the top and the clock keeps going (auto-picking
   the default answer after N hours if ignored). *Feel:* runs flow; you choose what interrupts you. (It overlaps
   suggestions-3 #6/#11; this is the player-side switch rather than the director.)
4. **"Why did this happen?" on deaths and losses.** A death or a lost base opens a short cause chain ("dehydrated: the
   well broke on day 41, no scrap to fix it, the water run was cancelled"). The data is already in the diary; this
   joins it up. *Feel:* losses read as lessons rather than dice.
5. **Run summary at game over / victory.** A screen with the timeline (population, food, water, Heat, hives over
   time), the best people, the worst day, deaths by cause, and "watch the timelapse." Also reachable mid-run.

## B. UI cleanup
6. **Tidy the top bar.** Move UI scale and Zombies into ⚙ Menu → Display, hide Dev unless dev mode is switched on in
   the menu, and keep the clock, weather, stock, people, Diary, Roster, Help and Menu.
7. **Minimap** in a map corner: bases, teams, hordes, hives, the camera frame; click to jump. Toggle with M. Most
   useful on Large/Huge maps.
8. **Stock trend arrows.** Food/water/fuel/firewood in the top bar show ▲▼ against yesterday, and the tooltip has a
   14-day sparkline. You see a slow leak before it is an alert.
9. **Graphs tab (Ledger).** Per base: production versus use for each resource over 30/90 days, deaths and births,
   mood, Heat. One canvas chart per row; no library needed.
10. **Codex / Almanac.** Every zombie type, item, building and condition you have *seen*, with its stats and how to
    deal with it (the data already lives in data.js / zombietypes.js / health.js). Unlocks as you meet things.
11. **A searchable command palette** (Ctrl+K or /): type "hospital", "Mara", "Iron Jackals", "water barrel" to jump to
    the base, person, group or build button. Big help once a run has 40+ people and 10+ groups.
12. **Rebindable keys** (Menu → Controls), now that there are 40+ hotkeys, with a printable key sheet in Help.
13. **Readability options:** a colour-blind palette for overlays and the threat preview (red/green is used a lot),
    a "larger map text" switch separate from UI scale for the 40" TV, and a reduce-motion switch for the map animations.
14. **One confirmation style.** Execute and demolish use click-twice, the battle uses "press Space again" and the menu
    uses a dialog box. Pick one pattern for all irreversible orders and add "don't ask again" for each kind.

## C. Quality of life
15. **Order templates.** Save a team setup (members' roles, kit, supplies, lights, stance) as "Scav team A" and launch
    it again in one click; the planner fills in the rest.
16. **Repeat last trip** on a team that just got home (same destination, same plan).
17. **Bulk actions in the Roster:** equip best available, send selected to the hospital, move selected to an outpost.
18. **Pinned watch list:** pin a person, team, horde or group to a small panel that keeps their status live.
19. **Map notes by hand:** right-click → "Add note" (icon + text) for your own plans ("bridge to clear", "cache here").
20. **Speed ×5 for quiet stretches** (out of dev), dropping to 1× by itself when a card or alert arrives.
21. **Undo in the planners.** One step back in the expedition planner, build queue and work priorities (not in battles,
    where Ironman matters).
22. **Autosave slots that rotate** (keep the last 3) with the day and a one-line summary in each save's name.

## D. Gameplay depth
23. **Hive birth you can see** (suggestions-3 #8 restated because it is still the top "invisible system"): a card when
    the dead start massing, a map marker that grows with the gathering, a chance to break it up early.
24. **Personal goals for colonists:** each person wants something now and then (find their brother at site X, a
    proper bed, revenge on a group). Meeting it gives a mood and skill boost; ignoring it can turn them into a deserter.
    *Feel:* names start to matter.
25. **Children and generations** (README notes there are none): couples can have a child, who grows over a year into
    a survivor with traits drawn from both parents. Fits the hundreds-of-hours sandbox.
26. **Late-game projects** that need many bases together: a radio tower that reaches the whole state, a water plant,
    a fortified rail line, a field lab that cures the worm. Each is a long multi-resource goal and a fresh way to win.
27. **Seasonal festivals and holidays** at the hub (harvest feast, first snow): a day off for a mood boost, with food
    cost.
28. **Regional weather** (README known gap): storms that move across the map, rivers that freeze in deep winter so
    teams can cross on foot.

## E. Build and test health
29. **One error screen** that catches uncaught exceptions, autosaves to a crash slot and shows "copy report," instead
    of a silent stall. Matters more as the sim grows.
30. **Save-file versioning test:** load every older save from a `tools/saves/` corpus on each suite run so migrations
    (like firewood ×30) never break old campaigns.
31. **Start the TypeScript move per module** (planned in the design doc): begin with JSDoc types + `// @ts-check` on
    the sim's core (world.js, parties.js, save.js), so nothing has to be rewritten.

## Still open from earlier lists (not built yet)
- suggestions-3: #6 standing road orders, #7 perk points stop pausing, #8 hive birth card, #9 hostile-group card,
  #10 winter card, #11 pacing director, #12 one-answer cards, #22 bike sprite, #25 animal threats, #26 loot limit.
- Battle pass (2026-10-06): enemy-turn speed setting, undo move, melee buff, tougher common dead, weaker Molotovs.
- Title screen: the background and logo style are still unpicked (12 clips in worktree title/docs/title-previews).
