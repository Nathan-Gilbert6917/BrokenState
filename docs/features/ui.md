# Player tools, UI and presentation

Detail for section 12 of [docs/agents/features.md](../agents/features.md). `[name]` is `prototype/src/sim/name.js`; `ui/name` is `prototype/src/ui/name.js`. Related: [docs/prompts/performance.md](../prompts/performance.md), [docs/design-doc/](../design-doc/).

## Autopilot governor: wood
- Also used headless for balance runs [autopilot].
- Fells the nearest trees beyond the walls when the woodpile is short of the fires' reserve and its next builds, and clears its next building sites ahead (govWoodwork: see [economy.md, The governor fells for wood](economy.md#the-governor-fells-for-wood)).
- **Woodcutters on the felling** (the user's request 2026-10-20: "put a woodcutter on its own felling, not just idle builders"): one, two or three as the woodpile runs low, the best first by skill, tool, traits and health; ahead of the builders when the pile is under the fires' days or the felling is all that is queued; off once it is done (noidle fellCrew / fellScore, planRoles 4a' / 5').
- Nobody left in a role with no work ([economy.md, No idle workers](economy.md#no-idle-workers)).

## First-week guide
- A checklist under the alerts with Show me [ui/guide]. Test `tools/guidetest.js`.
  - Normal: stores, work priorities, a building, wood, a team out and home, the clock, the first night, the diary.
  - Hardcore: the team, the clock, water, the camp, its needs, the shelter, the night, the diary.
- **Notes on new things** while it is on: the first window of each kind (cards by type, the raid plan, the raid map, a fight, a base defence, the build map, unpacking) gets a note over it in #guidetip; the first alert of each kind a New line on the card. Told once (`state.guide.seen`; guide.js POPUP_TIPS, ALERT_TIPS, popupOf, renderGuideTip).

## Touch input
Phones and tablets; a mouse never takes these paths.

### Gestures
- On the State Map and battle map: a drag pans, a pinch zooms, a tap is the left click, a long press (500 ms) the right click (main.js mapClick / mapMenu, the battle's combatPan / combatWheel steps).
- Anywhere else a long press sends the same contextmenu a right-click would (the item menu, the Work tab) or, with nothing taking it, shows the element's data-tip until the next touch. Android's own long-press menu and the click after a long press are swallowed.
- The minimap, panel bars and window titles drag by finger (Pointer Events beside the mouse listeners); long drop-downs keep the phone's own picker.
- Modules: [ui/touch (initTouch, touchGestures, touchRecent, swallowTap), ui/minimap, ui/windows, ui/selectsearch, `prototype/touch.css`].

### On-screen stand-ins for keys
- Only with a phone or tablet layout up (responsive.js touchUI); a desktop with a mouse draws none.
- ✕ Cancel on the pick banners (a team's move, a field work's tile, a meeting tile; main.js "pick-cancel").
- ◀ ❗ Next team (N, Shift+N; "team-next") and 📷 camera spots 1–9 (a tap goes to a saved spot or saves an empty one; Save here… overwrites; "cam-spot", ui/alerts.js camSpot), in the ⋯ drop-down on a phone and the top bar on a tablet.
- Work tab: a long press opens a picker on the cell (–, 1–5, ↺ the role's default; ui/work.js workPicker, "wpick", on the tab's undo).
- A picked inventory item's strip with ✕ Cancel sticks to the window's foot (ui/inventory.js selBar).
- A long press on a panel's bar restores its usual size; a double tap on a window's title its usual size and place (ui/windows.js fingerReset).
- Esc's one-level steps inside a window (the gun builder's part list, the look editor, the skill tree, the supply form, a card from the tray, a queued order) have their own buttons; the window's ✕ steps back as Esc does.
- Modules: [ui/responsive (touchUI, pickCancel, buildKeys), `prototype/responsive.css`].

### Battle taps confirm
- A finger only; Options → "Battles: confirm taps", on by default, shown on a touch screen.
- A tap that would send an order (a move, a shot, a throw, overwatch, a search, a door, an ally's order: whatever combatClick hands to act) is tried with act() catching it, the screen put back, and held. The hover's preview stays on the map and a chip over the tapped point names it with the hover card's words (hit chance, move cost).
- The same cell again or ✓ sends it; another cell moves the preview; ✕, a long press, another unit or mode, or anything happening drops it. A tap that only selects is made at once.
- Modules: [ui/combat (combatTap, tapProbe, combatTapChip, tapFrame), main.js "cb-tap", `prototype/touch.css` #cbtapask].

## Game controller
An Xbox pad, or any pad with the browser's standard mapping (Chrome and Edge, the desktop app, Android Chrome, iOS Safari; the player's phone on a stand, so the pad does everything). Modules: [ui/gamepad, ui/padnav, ui/inputmode, main.js, ui/combat (padCur, combatPadOn / Move / A / B / Cycle / End / Zoom / Frame), ui/render (view.cursor), `prototype/pad.css`]. Test `tools/padnavtest.cjs` drives it all in headless Chromium with a made-up pad, on a desktop and with `--phone`.

### Polling and input mode
- ui/gamepad.js polls navigator.getGamepads() in its own frame loop only while a pad is connected (gamepadconnected, and a lazy look for one). Ignores input while the page is hidden or unfocused (a button already down when it comes back is not a press).
- D-pad and left stick merge into one eight-way direction with key repeat (380 ms, then every 110 ms; a stick pushed further repeats faster); a 0.25 radial dead zone; triggers as analog buttons.
- Any press or stick past the dead zone sets input mode "pad" (ui/inputmode.js, `<html class="input-pad">`); the mouse moved or a key pressed sets it back; the last pad unplugged returns the screen's own mode.

### Layers
- claimPad(id, { on, frame, legend, dock, when, transient }) pushes a layer. The top one whose when() holds gets the events ({ name: A B X Y LB RB LT RT View Menu LS RS Up Down Left Right, type: down / repeat / hold / up, dx, dy, value, long }; on() returning false passes it down). Its frame(dt, axes) runs each frame in pad mode; its legend() is the button strip.
- onPadFrame(fn) runs every frame with the top layer; padAxes, padHeld, onPad, padGlyph.

### Windows, menus and panels (ui/padnav.js)
- One layer above the map's and the battle's, under the question's. Whatever is in front takes the pad: the item menu, the tile menu, the carry box, the Work tab's picker, a stack's "how many", a raid's opened box, the phone's ⋯ and camera spots, any window in #modal with the first-week note over it, the title screen, a battle's question (the retreat, the fall back, End turn's).
- Only so long as it has a button to point at; a note with none (the kit warning over a raid's deploy screen) leaves the pad to the layer under it and is looked at again every quarter second.
- A ring (#padring, drawn over everything) shows the button it points at.
- **Movement**: D-pad / left stick move to the nearest visible, enabled button, link, box, drop-down or clickable row that way (distance along plus three times the sideways gap; ◀ ▶ stay near the row; under another layer does not count; scrolled out of its list does and is scrolled into view).
- **Buttons**: A clicks (a drop-down opens a pad list of its choices; a text or number box takes the focus; ◀ ▶ step a slider or a taken number box). B is Esc (or leaves the panels / the bar). X its right-click (the item menu, the Work tab's picker). Y the window's one .primary that is not Close (or "put here" on the box a picked item would go in). LB / RB the row of tabs (data-tab buttons side by side, one .active). Right stick scrolls.
- Each layer remembers its button (a closed window gives the ring back where it was); a new one starts on its tabs, first choice, main button in sight or first button.
- The inventory's tap-pick / tap-place by A with the cells that take the pick outlined (inventory.js tgtCls, pad.css). The first press after the mouse only shows the ring.

### State Map (main.js map input)
- A cursor (render.js view.cursor, a cyan ring) moved a tile at a time with repeat; the camera follows near the edges; its tile's hover and tooltip as under the mouse (hoverAt, shared with the mouse).
- A = mapClick (select, a move's or a field work's tile); X = mapMenu (the ring in it); Y = next team waiting; B = Esc (closeTopLayer); ☰ pause / run (held: the game menu); LB / RB slower / faster (paused: the speed it will run at).
- ⧉ the panels (padnav): the ring in the left panel first, ⧉ again the right one, the top bar, then the map, each stop on the button the ring had there last. The D-pad reaches the log and the map's boxes too; the map's cursor waits; B back; LB / RB the left panel's tabs; a Move or field work's tile picked there hands the pad back to the map. On a phone or upright tablet the drawers in turn (Lists, Info, Log), starting with one already open. ⧉ held: map only, on a desktop.
- Right stick pans; LT / RT zoom about the cursor; R3 centres.

### Battles and raids (main.js combat input, ui/combat.js combatPad*)
- A cell cursor moved screen-relative with the hover's preview on it (the path and its cost, the hit chance).
- A = combatTap with the confirm always on (the first A previews with the chip, the second sends; selecting is at once). B drops the preview or the mode (Esc). LB / RB previous / next unit (the cursor with them). Y End turn as its button (it asks while anyone has actions; deploy: Start; the result: Close).
- X the orders bar (padnav: the ring on the order in use; A gives one and comes back; a tray stays open; B back). ⧉ the battle panel and the raid's strip (a phone's ☰ panel opened with it; the base map's Close the map). Right stick pans; LT / RT zoom steps; R3 centres; ☰ the game menu.
- The retreat's and the fall back's questions take the ring (A on Sound the retreat, B keeps fighting). A question (ui/confirm.js) takes A yes / B cancel.

### The legend
- Ⓐ Select Ⓑ Back Ⓧ Menu Ⓨ Next team ☰ Pause …, the battle's own. Every cursor and ring show only in pad mode; with no pad, or the mouse used last, nothing changes.

## The whole game by pad
- The user's request 2026-10-23: "Extend the controller navigation for the map view. I want the whole game to be playable via controller so make other UI and maps like the POI one work with controllers".
- Maps drawn as SVG (the POI map's places and exit arrows, the city crawl's rim blocks, the hive's chambers) take the ring: A sends the click SVG has no click() for; the ring resting on one lights what :hover lights (.pad-focus) and shows its hover text (ui/padnav, ui/poimap, `prototype/pad.css`).
- The pointer (padnav POINT, pointIn) for pictures only the mouse reads (canvas[data-chart]: the Ledger's charts; [data-padpoint]: the minimap): A puts a cross (#padptr) in, the D-pad moves it and sends mousemove, A clicks, X right-clicks, B gives the ring back.
- Pick start on map: the State Map's cursor before the run, Y Pick start on/off, A starts there, B back, ⧉ the banner (main.js nrMapOn, padStartOn, startTipAt). The camp-site picker (b.site): the cursor with its 5 × 5 and hover line, A picks, Y Set up camp here, LB/RB turn the view, ⧉ the panel. The base build map (b.layout): A builds / puts down / selects / lifts / opens a land card; Y rotates (R); B puts back, deselects, closes a card (combat layoutEsc, shared with Esc); LB/RB turn; ⧉ the Build list and cards, a pick there hands the pad back to the cursor (api.mapPick, main.js padPickKey). Legends for each; "R turns it" reads Ⓨ by pad (ui/hints).
- Still mouse-only (cosmetic): moving overlay boxes and windows; the battle bar's words on the site and layout screens. `tools/padmaptest.cjs` drives the title, World…, Customize, Pick start, a team sent and moved, a Ledger chart, the POI map, the camp-site picker and the base map by pad.

## Key hints by device
- ui/inputmode.js's mode: a mouse and the keyboard, a finger, a controller [ui/hints, `prototype/touch.css` (its key hints section)].
- The pick banners, PAUSED, the State of Calder hints, the guide's notes and steps and the camera spots' flash have a line for each device (keyHint, sayFor).
- The battle's prompts and hover details, the bar's notes, the inventory's Selected strip and help line and every tooltip go through devText: click → tap / Ⓐ; right-click → long-press / Ⓧ (a battle: Ⓑ); hover → long-press / point at; the wheel → a pinch / LT RT; Esc → ✕ / Ⓑ; Space → ☰ (a battle: Ⓨ); keys a finger or pad cannot press are dropped.
- The controller's buttons are drawn in Xbox colours in a line of HTML (padHtml, kh). Keycaps on buttons hide by touch, and with a pad show its button where one exists (End turn: Y, data-pad) or hide.
- A change of device redraws (ui/responsive.js). In mouse mode every string is exactly as before.
