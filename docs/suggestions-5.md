# Suggestions 5: play, feel and look (2026-10-08)

Taken from playing dev f9cfd12 in the browser (the State Map at 1280×720 and 1920×1080, a town battle in the iso
view) and from reading the UI code. Built items and items already on lists 2–4 are left out. Pick by number.

## A. Look

1. **Give the map the screen.** At 1280×720 the State Map gets about 45% of the width, and the Layers box, the First
   week guide and the minimap cover half of what is left. Proposal: the side panels collapse to slim icon rails
   until clicked, Layers becomes a toolbar button with a pop-over, and the guide docks into the right panel. *Feel:
   the map is the game again, and the panels are there when you ask for them.*
2. **Night on the State Map.** The map looks the same at noon and at midnight; only a team's lights glow. Add a
   dusk → night → dawn wash (blue-black, about 60% darker), with bases showing lit windows and fires, and burning
   sites glowing. *Feel: the night watch and night sight finally look like they matter; you can tell the hour at a
   glance.*
3. **A cleaner top bar.** 16 stock words across two rows (Car parts, Gun parts, Electronics…). Keep Food, Water,
   Meds, Ammo, Fuel and Scrap up front as drawn icons with numbers and trend arrows; put the rest in a "Stores ▾"
   drop-down. *Feel: you read your situation in one look.*
4. **Swap emoji for one drawn icon set.** The UI uses emoji in hundreds of places (ui.js ~180, combat.js ~110).
   They look different on every system and clash with the hand-drawn sprites. Draw a small icon atlas in code the
   way the sprites are drawn, one colour family. *Feel: the game looks like one game, not a chat app.*
5. **A display font for headings.** Everything is Segoe UI. Add a condensed stencil face for panel titles, card
   headers and the battle banner, matching the spray-painted title, with body text staying plain. The desktop app
   can bundle the font file.
6. **Panels with some grit.** The panels are flat slate cards. Give them a worn field-kit skin: paper or clipboard
   texture on cards, taped-on headers, and stamped red for danger. The style comes from the title screen. Keep the
   contrast high for the 4K TV.
7. **Battle map edges.** The iso battle map ends in pure black. Fade the edges into fog over a few tiles of extra
   terrain (road running off, trees thinning) and add a soft vignette. *Feel: the fight happens in a place, not on a
   board floating in space.*
8. **Lights in night battles.** Night battles only use a darker fog. The lights system already knows who carries a
   headlamp, flashlight or spotlight, so draw their beams and pools. The dead show up as silhouettes at the edge of
   a beam. *Feel: night raids become tense and look different from day raids.*
9. **Battles leave marks.** Bodies stay where they fell, with blood pools, spent brass under shooters, scorch from
   grenades and Molotovs, and broken glass from car windows. All of it lasts for the battle. *Feel: by turn 6 the
   map tells the story of the fight.*
10. **Bigger, livelier people in battle.** On a TV the units are small. Scale them up about 25%, show the weapon in
    their hands and which way they face, and add a slight idle sway (people) or lurch (the dead).

## B. Feel (feedback and juice)

11. **Gunfire you can feel.** Today a shot is an instant line that fades, plus a number. Add a muzzle flash, a
    tracer that travels, and an impact puff (dust on a miss, blood on a hit). The camera shakes by calibre: none for
    a .22, a nudge for rifles, real shake for the .50, launchers and blasts. Add a 60–80 ms pause on crits and kills.
    *Feel: the new gun roster sounds and looks as different as its stats are.*
12. **Walking, not sliding.** Units glide tile to tile at 70 ms a step. Add a step bob, small dust puffs, and a
    slower, stumbling gait for the dead (runners visibly fast). Heavy kit (the new kg weight) shows as a slower,
    heavier stride.
13. **A death beat.** When one of yours dies in battle, add a half-second slow-down, their name and one line ("Ana
    Zimmer, 34, mechanic, day 61"), and a low sting. Back at the base, a grave marker appears beside the hub sprite
    on the map. *Feel: losses hurt the way RimWorld losses do.*
14. **Music, made in code like the sound.** There is ambience but no music. Add WebAudio drones and pads that shift
    with the situation: calm by day, uneasy at night, a drum pulse when a battle starts, a swell when a raid or horde
    card arrives, and quiet after a death. No files, the same approach as audio.js.
15. **Combat barks.** Short speech bubbles that fit each person's traits: "Reloading!", "I'm hit!", "Jammed!",
    "Behind you!", plus a reaction when a friend goes down. Rare enough not to nag.
16. **Danger shows at the screen edge.** A red pulse at the screen edge and a heartbeat in the ambience when a base
    is attacked or a team is under fire off-screen. Click the pulse to jump there.
17. **Life on the map.** Teams leave fading boot or tyre tracks, hordes churn like a crowd (not one icon), a puff
    of dust when a car arrives, and smoke over a base that is cooking or burning.
18. **Cards with weight.** Big cards (raid, horde, death, hive) slide in with a sound and a header picture drawn in
    code (a burning wall, a horde silhouette), and small ones stay compact. *Feel: you can tell how bad a card is
    before you read it.*

## C. Play

19. **A 7-day threat forecast.** One meter in the top bar for the coming week, combining weather, nearby hordes
    and their drift, raider intent you have heard on the radio, and food or water running out. Hover lists the
    causes. *Feel: pressure you can see coming and plan for, instead of surprise.*
20. **Next steps after the first week.** When the First week guide ends, a small panel keeps 3 live suggestions:
    the biggest risk now, a site worth raiding with what it likely holds, and a group worth meeting. It is advice
    only and can be dismissed. It fixes the "what now?" stretch in weeks 2–6.
21. **Named rivals.** A raider leader who escapes a fight comes back with a name, a scar and a grudge, and the
    radio carries their threats. Kill them for a morale lift and their gear. This is a light version of the Nemesis
    system on top of the AI groups that already exist. *Feel: raids get a story and a face.*
22. **Battle objectives.** Most fights are kill, loot or get out. Add objectives: free a captive and walk them to
    the edge, grab one item (a safe, a radio part), hold a building for N turns, or guard a car while someone gets
    it running. Each pays out on the map.
23. **Choices before a raid.** Pick the side to come in from, send a scout first (it reveals part of the map but
    can be spotted), or wait for night (stealth up, sight down). All of it uses systems that already exist (lights,
    stealth, optics).
24. **A season recap.** At each season's end, one card with the highlights from the chronicle and diary: who
    joined and who died, the biggest raid, stock trends, and an image of the map. It gives a long run its chapters.
25. **Base sprites that show the base.** Make the hub and outpost sprites on the State Map show the real buildings,
    walls, towers and damage, and show scaffolding while something is being built. *Feel: growth you can see from
    the map.* (Check first how much the current base sprite already does.)

## Found while looking (not design)

- **Battle action bar overflows below ~1400 px wide.** At 1280×720 the bottom buttons (Sound the retreat, AI plays my
  side, End turn, Auto-resolve, Restart battle) are cut off with a sideways scrollbar. I didn't fix it here because
  `ux-panels` is restyling panels right now. It's worth folding into that branch or the ux-int merge.
- The hive background was removed from the title screen on request (f9cfd12; titletest 33/33).
