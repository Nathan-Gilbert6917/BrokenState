# Survivors

Detail for section 2 of [docs/agents/features.md](../agents/features.md). `[name]` is `prototype/src/sim/name.js`; `ui/name` is `prototype/src/ui/name.js`.

## Bonds between survivors
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
Modules: [appearance, custombg, custompoints, startgear, randomkit].

- Survivor customization: backgrounds, customization points, starting gear, random builds.
- **The vehicle's back is not on the points** (the user's request 2026-10-24): what is in a starting vehicle's back used to be paid from a colonist's points (its payer, *Paid by*, and the car pool, *Give leftover*); now each starting vehicle has a point limit of its own and its back is priced against it, on nobody's points (the gear window has no vehicle's back; the car pool is gone). A custom background's car's back is part of the background, on that colonist's own bill at a normal start [custompoints pricePerson bgExtraPoints, startfleet]. See [campaign.md, Custom mode and starting vehicles](campaign.md#custom-mode-and-starting-vehicles).
- **Random kit ammo** (the user's request 2026-10-18): a random kit with a gun in the hands (Build, Randomize all, the gear window's dice under Customize) carries its spare magazines and a box or two of its common round in a pocket, a pouch or the pack; a box's points are kept back while the other slots are drawn [randomkit randomKit putRounds / putBox].
- **Battle-map figures**: every body is a low-poly figure that faces its way and turns with the view: survivors, human enemies, the dead of every kind (plain, special, armoured, risen), the bosses, and the fallen lying along the ground.
  - The panels show the same figures. The inventory spins one through 360°; the player can turn it by hand (a drag or the wheel stops it where left, a degree a pixel; ↻ Spin or a double-click sets it turning again; per figure by its spin key, so a rebuilt panel keeps the turn).
  - Modules: [ui/figures figureSpinImg, handOf, holdFigure, dragFigure, wheelFigure, turnFigure, spinFigure, spinFrame, frameOfYaw]; ui/sprites, ui/hivesprites and ui/downsprites keep the flat painters as fallbacks.
- **State Map figures**: every moving piece (your teams on foot and by car, boat or raft; groups' parties and convoys; bands and nomads; outsiders; hordes; herds; workers on job trips) is a low-poly figure built from the same limb at the map's scale, facing the way it travels (every 15°, no mirroring), animated while on its way (walk cycles, a limp, wheels turning, oxen trotting, oars pulling, the dead shuffling) [ui/mapfigures; ui/render cycleFrame and headingOf, ui/workermap]. The places keep ui/mapsprites' flat painters.
- See also [combat.md, Lost pictures drawn again](combat.md#lost-pictures-drawn-again).
