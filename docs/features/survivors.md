# Survivors

Detail for section 2 of [docs/agents/features.md](../agents/features.md). `[name]` is `prototype/src/sim/name.js`; `ui/name` is `prototype/src/ui/name.js`.

Contents: [Bonds between survivors](#bonds-between-survivors) · [Appearance, figures and customization](#appearance-figures-and-customization) · [Why did this happen: setbacks](#why-did-this-happen-setbacks)

## Bonds between survivors
Named levels from rival to partner, with reasons, work and mood buffs and debuffs, behaviours and hub cards.
The user's request 2026-10-21: "Improve survivor inter-connected relationships and behaviors Buffs and debuffs and events". Modules: [bonds, bondevents]; test `tools/bondstest.js`.

### Levels and reasons
- Built on relations.js's one opinion a pair. Named levels: rival ≤ −30, disliked ≤ −10, neutral, friendly 15+, friend 40+, close friend 70+, partner.
- The few biggest reasons are kept on the pair (bumpPair's `why` → bonds noteWhy, r.why; bondReason is the one shown).
- **What moves it** besides the drift: crews on the same job trip, lessons, meals and a common room together, trait fit (bondTraitParts in compat), fighting and rescues (relations.js, now with reasons).
- **Friction**: crowding, short rations, a rival's success (envy), someone sitting the work out, quarrels at work.

### Buffs and debuffs
Each is a mood line (bondMood in moodFactors) and on the survivor screen's Bonds card (bondEffects).
- **Same work at a base** beside a friend: work +5% (close +8%, cap +8%; bondWork in morale.js moodWork, cached daily as s.bondFx) and mood +0.5. Beside a rival: mood −0.5 and a 5% a day quarrel.
- **Job trip load**: ×1.05 with a friend in the crew, ×0.95 with a rival (bondCrewMult in jobtrips.js rollLoad).
- **Nerve** +0.05 with a friend in a fight (bondNerve → combat.js setup.relNerve, a Nightmare's scream).
- **Lessons** ×1.15 / ×1.25 / ×0.75 (lessonBond in skills.js teachingDaily).
- **Circles** of three or more mutual friends +0.3; the left-out −0.5 (cliquesAt, base.bondCliques).
- **Grief**: a close friend grieves 3 days longer; a friend who walks out is grieved at half ("Misses …").
- **A promise to a dying friend** (promiseCard): +0.6 mood and work +5% for 30 days; broken −10 and −0.6 a day for 14.

### Behaviours
- The work scheduler pulls toward a friend's job and away from a rival's within one priority (bondPull in work.js planBase, at most half a sticky bonus).
- A deeply unhappy close friend may follow a deserter (bondsOnLeave → morale.js desert).

### Cards at the hub
- bondevents.js BOND_EVENTS, merged into hubevents HUB_EVENTS, each with a default for the tray:
  - a feud's fistfight (mediate, punish, separate to another base via moveout moveTeamOut, let them fight);
  - making up; a friend asking to work alongside (work.js setCell); an apprentice's evening lessons;
  - jealousy over the leader's favour; a theft from a friend; a newcomer welcomed or shunned.
- Runs daily in bondsDaily at the end of relationsDaily (relRng dice).

### UI and AI parity
- The survivor screen's People list (level, opinion, reason, mentor and promise tags) and Bonds card [ui/relations]; the activity line's why (bondWorkNote); the codex's People category "Bonds between survivors" [ui/codex].
- AI parity: none for AI groups' people (ADR 0001 §3: their mood and relationships do not tick; O(n²) pairs on a Huge world). Anyone who joins you is under the rules at once. See [ADR 0001](../adr/0001-ai-parity.md).

## Appearance, figures and customization
How a survivor is made and drawn: backgrounds, points, starting gear and random kits, and the low-poly figures on the battle map, the panels and the State Map.
Modules: [appearance, custombg, custompoints, startgear, randomkit].

- Survivor customization: backgrounds, customization points, starting gear, random builds.
- **The vehicle's back is not on the points** (the user's request 2026-10-24): what is in a starting vehicle's back used to be paid from a colonist's points (its payer, *Paid by*, and the car pool, *Give leftover*); now each starting vehicle has a point limit of its own and its back is priced against it, on nobody's points (the gear window has no vehicle's back; the car pool is gone). A custom background's car's back is part of the background, on that colonist's own bill at a normal start [custompoints pricePerson bgExtraPoints, startfleet]. See [campaign.md, Custom mode and starting vehicles](campaign.md#custom-mode-and-starting-vehicles).
- **Random kit ammo** (the user's request 2026-10-18): a random kit with a gun in the hands (Build, Randomize all, the gear window's dice under Customize) carries its spare magazines and a box or two of its common round in a pocket, a pouch or the pack; a box's points are kept back while the other slots are drawn [randomkit randomKit putRounds / putBox].
- **Battle-map figures**: every body is a low-poly figure that faces its way and turns with the view: survivors, human enemies, the dead of every kind (plain, special, armoured, risen), the bosses, and the fallen lying along the ground.
  - The panels show the same figures. The inventory spins one through 360°; the player can turn it by hand (a drag or the wheel stops it where left, a degree a pixel; ↻ Spin or a double-click sets it turning again; per figure by its spin key, so a rebuilt panel keeps the turn).
  - Modules: [ui/figures figureSpinImg, handOf, holdFigure, dragFigure, wheelFigure, turnFigure, spinFigure, spinFrame, frameOfYaw]; ui/sprites, ui/hivesprites and ui/downsprites keep the flat painters as fallbacks.
- **Weapon models in the figures' hands**: every weapon its own model, matching its 2D art, held in a pose that suits it. See [Weapon models in the figures' hands](#weapon-models-in-the-figures-hands).
- **State Map figures**: every moving piece (your teams on foot and by car, boat or raft; groups' parties and convoys; bands and nomads; outsiders; hordes; herds; workers on job trips) is a low-poly figure built from the same limb at the map's scale, facing the way it travels (every 15°, no mirroring), animated while on its way (walk cycles, a limp, wheels turning, oxen trotting, oars pulling, the dead shuffling) [ui/mapfigures; ui/render cycleFrame and headingOf, ui/workermap]. The places keep ui/mapsprites' flat painters.
- See also [combat.md, Lost pictures drawn again](combat.md#lost-pictures-drawn-again).

## Why did this happen: setbacks
The "Why?" chain of causes (written for every death and lost base since suggestions-4 #4) now covers more of what goes wrong in a run: a vehicle left behind, a team wiped out, a vehicle lost to a group, a mission that failed and a survivor who walked out. Some existing chains also got two cheap factors.

The user's request 2026-10-25: "update 'Why did this happen?' so it explains more of what goes wrong in a run". Modules: [causes noteSetback / setbacksOf / SETBACK_KINDS / noteVehiclesLeft / explainWipe / lootedBefore / noteVehicleLooted / noteMissionFailed / searchFailedWhy / noteDesertion / noMedic, walkers leavePlan / shedSurplusVehicles / takeVehicles, parties wipeParty / returnHome, groupworld vehicleDaily, envoys envoyHome / noteOverdue, convoyrecover convoyGone / convoyAfter / tell, morale desert; ui/causes lineWhy / markerWhy / setbackList / whyModal, ui/ui (the marker card), ui/ledger (the run summary), ui/help]; tests `tools/whytest.js`, `tools/causetest.js`.

- **Where it is kept**: `state.setbacks`, newest first, at most `MAX_SETBACKS` (30, as `MAX_LOSSES`): `{ id, kind, day, tile, name, why: { k, h, f }, m, v?, f? }`. `why` has the same shape and limits as a death's chain (`MAX_FACTORS` 4, short plain factors). `m` is the start (48 characters) of the log line written with it, so that line gets the "Why?" link. `v` holds the vehicle ids, for the marker card. `f` is the group that took a vehicle. Each entry is about 350 to 500 bytes. `id` comes from its own counter (`state.setbackSeq`), never world.js `newId`, which would shift every later id. An older save has neither field and loads unchanged.
- **Recording only**: built from the state and the diary at the moment it happens. It never rolls `state.rng` and never changes play. A 30-day autopilot run of seed 42 gives the same world digest with and without it (`tools/dettest.js --digest 30 42`).
- **The kinds** (`SETBACK_KINDS`):
  - **Vehicle left behind** (`left`, `noteVehiclesLeft`; walkers.js `shedSurplusVehicles` and the raid's pick card `takeVehicles`, through `leavePlan`'s `left.vs`): how many were left against the drivers the vehicles need; who died on the trip (the memorial, with the cause) or is badly hurt (health under 40); what cargo stayed inside; a fight line from the diary.
  - **Team wiped out** (`wiped`; parties.js `wipeParty` reads `explainWipe` before the supplies move and records it after the "A whole team was lost" line; not for an envoy lost out of radio reach, which nobody hears of): how the last of them died; the odds noted by `noteFight` that hour (or the battle on the map); how far from its home base; what the team had none of left (water, food, meds, ammo, the low-stock words); no one with Medicine `MEDIC_SKILL` (3) or more; a storm, blizzard, heat wave or snow of the last two days; the trip and how overdue it was.
  - **Vehicle lost to a group** (`looted`; groupworld.js `vehicleDaily`, only when the log line is written: the group is known or the tile in sight): which group took it or stripped its racks (named if you know them, else "A group you have not met"; how far their base is), how long it had been left, what was in it, and why it had been left (its marker's reason). `lootedBefore` reads all this before the vehicle and its marker go.
  - **Mission that failed** (`failed`, `noteMissionFailed`): a team home from a search with nothing (parties.js `returnHome`; `searchFailedWhy`: the place was picked over or searched clean, or the team came out before it found anything); an envoy home without a yes (envoys.js `envoyHome`: their reason, or that it never reached them) or never back (`noteOverdue`: lost on the way there or back, who died out of radio reach); a convoy recovery that failed (convoyrecover.js: the convoy gone and who took it, too few drivers, nobody back at the vehicles; a group's party that found it gone, was beaten or lost to the dead, or had no road).
  - **Left the group** (`gone`, `noteDesertion`; morale.js `desert`, including a mental break's walkout, whose line comes first): their mood and the warnings; a crowded base (morale.js `crowdInfo`), short rations, no food or no water; their own hunger or thirst; diary lines about grief, quarrels or talk of leaving.
- **Thin chains made fuller** (read against real deaths headless): a raid or horde death at a base with a watchtower and nobody on guard says "The watchtower at … was unmanned" (`defendersFactors`); a team death in a fight, a raid or an accident says "Nobody on the team knew medicine (Medicine 3+)" (`noMedic`, the dead counted). `MAX_FACTORS` is unchanged.
- **UI**: the "Why?" link sits on each setback's log and diary line (ui/causes.js `lineWhy`, any line kind, matched by `m` and the day), on an abandoned vehicle's marker card in the tile panel (`markerWhy`: the latest setback naming that vehicle) and in the run summary's new "Setbacks" section (ui/ledger.js, `setbackList`: the count of each kind and the latest six). The same Why panel opens them, titled by kind ("Why was the Work van left behind?") and labelled with the kind. Names, places and days in the factors are links as in the other chains (diary.js `findRefs`).
- **AI parity**: does not apply to recording. A group-caused loss names the group that did it, and only if you know it.

## Weapon models in the figures' hands
The user's request (issue #77, 2026-10-26): "There's several weapons but all guns seem to use the same model same for short melee and long melee. I want each weapon survivors, raiders and AI group survivors can use be displayed accordingly with models that match the 2d sprite and matches the look of the game following how the survivor sprites look like and the vehicle sprites." Design: [survivor-sprites-3d.md, Weapon models](../design-doc/sprites/survivor-sprites-3d.md#weapon-models).

- **One model a weapon** [ui/weaponmodels weaponModel, placeModel, HOLDS, MELEE, BOWS]: every `GEAR` entry with the weapon slot and every kit's weapons (`combat.js` KITS: 122 keys on 2026-10-27, 70 guns), none shared. Guns are built from their gun-builder spec (`ui/gunspecs.js` GUN_ART through `gunpaint.js` norm: landmarks, stock and magazine kinds, colours by part, own optic / bipod / muzzle device, the small drawing's features), at 0.29 figure px an art px along the gun and 0.36 up it (pistols and revolvers 0.19 / 0.22). Melee weapons, bows, crossbows and the launchers' tubes are a table with the item icons' colours (`ui/itemart/wear.js`, `sim/data-blades.js` BLADE_LOOK). A weapon with no entry draws as a plain blade or haft by its category.
- **Fitted parts** (the weapon look, `gunparts.js` weaponLook): optic, suppressor or brake (the muzzle moves out), magazine (drum, box, stick), stock, bipod, fore grip, light, laser; the finish recolours. `figureCanvas` passes the whole look through; the cache key already had it.
- **Pose classes** [ui/figures holdOf, figureLimbs]: gun, smg, pump, pistol, revolver, side, sabre, sword, shoulder, spear, bow, crossbow, tube. The origin of a model is the right fist; `fore` the other hand's point; `F.muzzle` the barrel's real end (`isoview.js` muzzlePoint).
- **The fallen**: a dead unit's weapon lies beside its right hand until the body is searched [ui/figures unitFigureDown; ui/downsprites bodySearched]; a downed survivor who is alive shows none.
- **Performance** (2026-10-27): painting a figure about 5% dearer (1.03 vs 0.98 ms a figure in Node); a raid's frame time unchanged (median 3.9 vs 4.1 ms, `tools/weaponmapshot.cjs`, figures cached by look and heading).
- Tools: `tools/weaponfiguretest.js` (every key a model of its own, the classes, the hands on the weapon at every heading, the muzzle on the barrel, fitted parts, the cache key, the fallen), `tools/weaponsheet.js` (the gallery page: every weapon at three headings beside its 2D art, a raider and a soldier, fitted parts, the fallen; `--before` another checkout's figures, `--battle` a battle shot), `tools/weaponmapshot.cjs` (a raid with armed figures in place, shot and timed), `tools/pngout.js` (a painter's grid as a PNG without a browser). `tools/gunarttest.js`'s muzzle checks now expect each gun its own point and a drawn suppressor.
