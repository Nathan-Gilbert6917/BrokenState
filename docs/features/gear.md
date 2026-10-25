# Weapons, armour and gear

Detail for section 7 of [docs/agents/features.md](../agents/features.md). `[name]` is `prototype/src/sim/name.js`; `ui/name` is `prototype/src/ui/name.js`. Related docs: [docs/reload-rules.md](../reload-rules.md) (the reload rules), [docs/weapons-overhaul-plan.md](../weapons-overhaul-plan.md), [docs/prompts/battle-inventory.md](../prompts/battle-inventory.md).

Contents: [Physical rounds in a fight](#physical-rounds-in-a-fight) · [Ammo by calibre, reload sources and loading magazines](#ammo-by-calibre-reload-sources-and-loading-magazines) · [Attachments and gun builder](#attachments-and-gun-builder) · [Physical rounds out of a fight; magazines out and in](#physical-rounds-out-of-a-fight-magazines-out-and-in) · [Armour and rigs](#armour-and-rigs) · [Inventory](#inventory) · [Loot: the dead who were survivors](#loot-the-dead-who-were-survivors) · [Survival guns, parts and gear (2026-10-19)](#survival-guns-parts-and-gear-2026-10-19) · [Lock boxes and cases (2026-10-19)](#lock-boxes-and-cases-2026-10-19) · [Electronics salvage](#electronics-salvage)

## Physical rounds in a fight
Rounds are real stacks in guns and magazines, in firing order; a Reload draws only on the shooter's own kit.
- The user's rules, 2026-10-18; [docs/reload-rules.md](../reload-rules.md). Test `tools/reloadpicktest.js`. Modules: [roundstack, mags, ammo, gunload, combat, kitcheck, stealth, ui/combat, ui/itemmenu, ui/battlehud].
- The rounds in a gun and in each spare magazine are real stacks in firing order (roundstack `u.stack`, `item.stack`; the chamber's round is the shot's).
- **A Reload** draws only on the shooter's own pockets, rig and pack (mags `roundSources`), never a teammate's rounds, the team's bags, the vehicle or a base's stock. Rounds leave the item as they go in.
  - Loose rounds go in up to 6 a Reload whatever the gun (`MAGS.LOOSE`; from a pocket or the rig 1 action, from the pack both).
  - A spare magazine swaps in physically: the fresh one becomes the gun's fitted magazine; the other goes where it lay with what it had.
  - Magazines hold an assortment (loaded by hand 6 at a time in the Inventory window, any order); unloading one by hand puts every round back loose on the person.
  - Reload opens a picker of every spare magazine and round stack on the person, the rounds picked in firing order (ui/combat `reloadPicker`, mags `reloadOptions`, combatAct reload `{ mag | clip | rounds: [{ i, n }] }`).
- **Start and end**: the fight's start fills the gun and spares (the gun's own rounds, topped up from the person's, then the team's bags: mags `fillUnit` `top`); the end leaves what is left in the gun's record and each magazine's stack (gunload `returnStacks`, 2026-10-20).
- Enemies keep the old rule.
- An empty spare magazine is a throwable lure (stealth `emptymag`, back after a win).
- **Kit check** before the first move names empty guns (a button into the Inventory), no healing and the hurt (kitcheck, ui/combat `kitWarnHtml`).

## Ammo by calibre, reload sources and loading magazines
Rounds by calibre and type, where a reload draws them from, and loading magazines.
- Ammo by calibre and type, physical magazines, rounds tracked in each gun, and a reloading bench [ammo, rounds, mags, gunload, gunrounds, reloading].
- Rounds come boxed or loose. Boxes open into loose rounds; loose rounds can be boxed again (Box, or dropped on each other) [itemstack].
- **Reload sources** decide a Reload's cost (mags `roundSplit` / `roundSource` / `MAGS.SOURCE_AP`, `reloadPlan`'s `from`):
  - loose rounds or a box in a pocket or rig pouch (`u.handBoxes`, `u.pocketBoxes`; ammo `boxesOf` lists pockets, rig, pack): 1 action;
  - the pack: both actions (a shotgun's shells too: plan `{ mode: tube | break | single, from: "pack" }`, no refusal; `getShells` stays the 1-action way to bring a handful to hand);
  - a teammate's boxes or the team's bags: both actions too (a top-up or an internal magazine: only what is at hand is quick);
  - spare magazines unchanged (rig 1, pocket 1, pack 2).
  - Rounds are spent at hand, pack, mates, pools (ammo `takeBattleRounds`).
  - The AI and the raid bot prefer Get shells to a both-actions Reload (combat `aiLoad`, `packShells`). The Reload button and weapon panel name the source (ui/combat, ui/battlehud `weaponInfo.rounds`) [mags, ammo, combat, ui/combat, ui/battlehud].
- **Loading a spare magazine by hand** in the fight's Inventory window: loose rounds dropped onto one of the gun's spare magazines load it, 1 action from a pocket or rig pouch, both from the pack (mags `LOAD_AP`, `loadMagPlan`, `loadMagFrom`; combat `invAct` op "load" or a plain move onto a magazine).
  - An empty magazine takes any type the magazine and gun accept; one with rounds only more of the same. A box must be opened first. Another gun's magazine is not loaded.
  - The rounds stay where they lie (virtual rounds: a shot spends them), so a magazine fills only with rounds the gun and quicker spares have not claimed.
  - The magazine's rounds badge in a fight reads the unit's entry (gunrounds `gunRounds` src "fight"; mags `magEntryAt`: the k-th magazine of a key in a place is the k-th entry, kept so by `refitKit` and a Reload's swap) [mags, combat, gunrounds, ui/inventory].

## Attachments and gun builder
Tarkov-style attachments (sights, mounts, muzzle devices, magazines, stocks, grips, rails, lights and lasers, bipods, slings) fitted to a gun, and the gun builder to fit them; factory-fitted guns, finishes and paint.

- Modules: [gunmods, data-gunmods, partfinds (where the parts are found), factoryfit, data-finish (a gun's finish), ui/gunbuilder, ui/gunpaint].
- Tests `tools/gunmodtest.js`, `tools/gunbuildertest.js`.

## Physical rounds out of a fight; magazines out and in
Out of a fight, reload, unload and swap magazines free, at a base or in the field.
- The user's playtest reports 2026-10-20; [docs/reload-rules.md](../reload-rules.md) "Out of a fight". Test `tools/physroundstest.js`. Modules: [itemacts, gunrounds, gunload, mags, combat, ui/itemmenu, ui/itemlabels].
- The rounds badge counts only what is in a gun (its record `it.loaded`) or a magazine (`item.stack`), never the stores (gunrounds `physOf`).
- **Out of a fight, free**: a gun's **Reload** / **Reload with** / **Unload**, **Remove magazine** (a detachable magazine, mags `detachable`: the magazine with all but the chambered round onto the holder or the storage, `gun.magOut`, capacity 1) and **Insert / Swap magazine**; a magazine's **Load rounds** / **Load rounds with** / **Unload rounds** / **Insert into**. Sources: what the holder carries, then the storage list, then the place's stores (itemacts `roundSourcesAt`, `reloadGunAt`, `unloadGunAt`, `removeMagAt`, `insertMagAt`, `loadMagAt`, `unloadMagAt`).
- **In a fight, for actions**: Remove magazine (combat invAct op "magout", mags `removeMagUnit`), Insert magazine (a swap into the empty gun), Load rounds (op "load").
- A new run's crew at Start and an old save are loaded up out of what each carries and the stores (itemacts `loadUpAll`; main Start, save `physOutV`; createWorld from what each carries only).
- An event's pistol comes with its own rounds (events hc_newdead); a carried case's rounds go onto the carrier like its gun (boxes `takeFromBox`); a body's pistol and a sentry's gun bring their calibre (inventory `deadBodyFinds`, citycrawl).

## Armour and rigs
Armour classes, helmets, plate carriers and rigs.
- Armour classes AC 1–6 with per-hit durability, helmets and face shields, plate carriers and rigs [armour, helmets, data-helmets, data-kit].
- A rig's pouches come by kind (rifle and pistol magazines, a grenade, a radio, admin up to 0.5 kg). Every rig has **pocket pouches** that take anything a pocket takes (a chest rig and a tactical vest two; a makeshift rig and a plate carrier one) [data-kit POUCH_NAMES / SUPPLY_POUCHES, inventory pouchReason / stow / quickMove].

## Inventory
Slots, pockets, packs and stacks, supplies as items, and moving kit in a fight.
- RPG equipment slots, pockets, packs and stacks [inventory, itemstack, stacks].
- **A person's weight line** in every inventory window (the base's, a team's, the plan's before a raid, a fight's) is what is on them (load wornLoad), so it moves with every thing moved. Their share of the team's supplies and cargo on foot (or past the bikes' racks) is a second figure; a car carries all of it, nothing on its riders. The raid search window's cached shares (raidloot raidShares) are made again after a move into or out of the vehicle (the user's request 2026-10-18) [ui/inventory doll, raidloot raidMove].
- **Supplies held as items**: anything in the stores can be taken out into pockets, a pack or the off hand; it goes back into the stock when put in storage or brought home. Loot goes into pockets and packs the same way. Carried is for bulky things and whatever has no room [supitems, data-supitems, raidloot].
- **Kit moves in a fight**: the battle's Inventory window (`ui/inventory peekModal`, battlebar `inventory`, Shift+B) is the acting unit's to sort on its turn.
  - A move between pockets, pack slots, rig pouches, the hands and the off hand, or Split / Open box / Box on a stack, costs `INV_AP` (1) through `combatAct "inv" { unit, from, to, op? }` (combat invAct).
  - The unit's caches are refit at once (combat `refitKit`: refitUnit for the hands, boxes of rounds, each magazine's place keeping its rounds; `ensureFit` for a field battle). Armour, helmet, rig and pack stay worn [combat, ui/inventory, ui/battlebar].
- **Hand over in a fight**: the battlebar `handover` order (Alt+H) trades with the player unit right next to the acting one, on the same floor, in its view cone (combat `handoverTargets`, `handoverUnfaced`, `handoverRefusal`; vision `inArc` with `VISION.HALF`).
  - `combatAct "handover" { unit, to, from, toLoc }` (combat handoverAct) moves a thing either way through `inventory moveItem(…, { across: true })` for `HANDOVER_AP` (1) of the acting unit's (the mate spends nothing) and refits both with `refitKit`.
  - A mate out of the cone gets the free Face toward them first (the button reads "Face <name>"); several in reach get a chooser (`ui/combat handChooser`, `handoverCbAct`, `openHandover`, `cui.handAsk` / `cui.handReq`).
  - The two-doll window is `ui/inventory handModal` (`handCan`, `ui.inv = { sid, peek, mate }`, `inv-mate`). The raid search window's free hand-over (raidloot `matesOf`) is unchanged [combat, inventory, vision, ui/combat, ui/inventory, ui/battlebar, ui/keymap].

## Loot: the dead who were survivors
Loot distribution by site theme and gun tables [loot, gundist, gunfinds, blades, survival, boxes]; and 18% of the plain dead carry a former survivor's kit.
- The user's request 2026-10-21: "increase loot spawn of zombies being previous survivors with gear on them like side arms ammo melee packs and survival items". Tests `tools/holstertest.js`, `tools/loottest.js`, `tools/itemcondtest.js`.
- `ZSURV.chance` (18%) of the plain dead (not a dead soldier, a beast, a boss) carry a former survivor's kit, each part on its own chance: a side arm with a box of its rounds, a belt blade, a pack of survival things (lights, lighters, bandages, a tourniquet, water tablets, a radio, picks, a snare…), earplugs or muffs, a ration, water. No meds: they stay rare.
- On a field battle's body worn in their slots; on a raid's body among the finds. Dice of their own (the world's dice unchanged; `ZSURV.on` a test switch).
- Modules: [inventory `ZSURV`, `survivorDead`, `wearSurvivorKit`, enemyBody, deadBodyFinds (tag: the body's unit id)].

## Survival guns, parts and gear (2026-10-19)
Survival guns, gun parts and gear added 2026-10-19 (the SKS, the Uzi, the Halligan bar and more), each through an existing system.
- Guns: the SKS (fixed box, stripper clips), the Uzi, a folding 9mm carbine on the polymer pistols' magazines, a bullpup pump shotgun, a takedown .22.
- Parts: a night vision scope, a 2× prism, a Zhukov stock, an AFG, a linear comp, a single-point sling, a taped flashlight.
- Gear: the Halligan bar (a pry tool), a pipe wrench, armour against teeth (leather jacket, chainmail sleeves, motorcycle trousers), an angle-head flashlight, a solar lantern, a drop-leg rig, a paramedic's jump bag, a laser rangefinder.
- Each works through an existing system; found on their own dice [data-survival, survival, data-guns SURV_*, data-gunmods, data-kit SURV_*].

## Lock boxes and cases (2026-10-19)
Boxes and cases whose contents are unseen until opened with the right tool.
- Cash boxes, fire safes, toolboxes, equipment cases and gun cases hold valuables, a gun, rounds, camera gear or nothing, unseen until opened. Their weight (the box's own plus what is inside) is the clue.
- A locked one opens to the right tool (cheap lock: picks, a blade, a pry bar, a power tool; steel: a pry bar or a power tool) from the right-click menu, free out of a fight, into a window of what is inside (Take, Take all); in a raid for actions and Heat.
- Modules: [data-boxes, boxes, gunsafes rollGunCase, locks caseOdds, ui/boxview].

## Loot in military bases, air bases, airports and prisons (2026-10-25)
The user's request 2026-10-25 (issue #25 of the interiors epic #7): "yes open a ticket for the military buildings bases, airports, air bases, etc that fits too". The pieces' tables are combat.js `BOX_LOOT`, plus `AREAS.flightgear` (an air base's crew room and life support). No new items: flight helmets, survival vests and uniforms are not in `GEAR`, so the nearest there are stand in (a military helmet, a chest rig, flares), as #15 did.
- **Footlocker**: rest 0.35; ammo 25% 5–15, meds 8%, food 15%; a pistol 4%, a compact 9 mm 3%, a knife 5%, a combat knife 3%, a flashlight 5%, an assault pack 2%, photos, cigarettes, a watch.
- **Ammo crate**: rest 0.4; ammo 90% 20–60; a frag grenade 8%. **Radio console**: parts 60% 1–3, scrap; a military radio 8%, a hand radio 15%. **Fuel bladder**: fuel 85% 6–16.
- **Property locker** (a prison's intake): scrap 20%; a phone 8%, a watch 6%, a knife 5%, cigarettes 10%, photos 6%, a sling bag 3%. **Luggage**: food, water, meds 10–15%; a sling bag, a duffle, cigarettes, a watch, a phone, photos, a flashlight.
- **An armory's storage cage** (`sportcage@armory`, the NVG and optics cage): NVG 12%, binoculars 20%, a thermal monocular 4%, a spotting scope 8%, a holographic sight 8%, a red dot 8%, a military radio 4%. **A quartermaster's cage** (`sportcage@barracks`): ammo, a rucksack, a camo net, an entrenching tool, sandbags.
- **Vehicles and wrecks** (2 × L containers): a Humvee (fuel, ammo, parts; a rifle 5%, a helmet, an e-tool, first aid, a radio, flares), an Army truck (fuel, parts, food; sandbags, wire, an e-tool, a camo net), a helicopter (ammo, fuel, parts, meds; a rifle, a helmet 12%, a military radio, a chest rig, flares 40%), a fighter (parts, scrap, fuel; a helmet, flares), a transport plane (food, water, parts, fuel, ammo; packs, sandbags, flares), an airliner (food, water, fuel; bags, phones, watches, cigarettes, flares), the crash tender (fuel, parts; a fire axe 50%, a pry bar, first aid, a flashlight).
- Totals (200 seeded buildings, old layout against new): see [combat.md](combat.md#raids-into-building-interiors).

## Loot in police stations, fire stations, schools and churches (2026-10-25)
The user's request 2026-10-25 (issue #15 of the interiors epic #7): "Special buildings like hospitals, police stations etc should have furniture, appliances, decor, rooms and layouts that make sense for the type of building." The rooms' pieces are the containers ([combat.md](combat.md#raids-into-building-interiors)); their tables are combat.js `BOX_LOOT` (a piece's own rows, the room's `AREAS` rows at `rest` times their chances) and two new `AREAS` rows. No new items: the issue's bolt cutters, extinguishers and turnout coats are not in `GEAR` (adding items means their art, prices and balance rows), so the fire station's gear is the nearest the game has.
- **Gun rack** (`gunrack`, an armory's): rest 0.6; ammo 30% 6–18; a shotgun 15%, a hunting rifle 6%, a carbine 6%, an AR 4%, a semi-auto shotgun 4%. **Ammo cabinet** (`ammocab`): rest 0.6; ammo 95% 30–75. With the armory's own locker (its table as before, the gun safe's pick) the armory's three containers hold what its three did (−1%).
- **Evidence locker** (`evlocker`): rest 0; meds 22% 1–2 (seized drugs); a knife 6%, a pistol 1%, a compact 9 mm 1%, handcuffs 4%, a phone 4%, a watch 0.5%. The evidence room +5% on before.
- **Turnout locker** (`turnout`): rest 0.3; a leather jacket 15%, a motorcycle helmet 10%, knee and shin guards 8%, a fire axe 3%, a flashlight 4%.
- **Fire engine** (`engine`, the truck's container): rest 0; fuel 50% 2–6, parts 30% 1–2; a fire axe 50%, a pry bar 35%, a crowbar 20%, the siege ladder 30%, a sledgehammer 15%, a leather jacket 20%, a motorcycle helmet 15%, a bandage kit 20%, a flashlight 20%. **Ambulance** (`ambulance`): meds 85% 2–5, water 40% 1–3; a bandage kit 25%, a surgical kit 8%. **Police car** (`policecar`): ammo 50% 5–15, meds 30%; a shotgun 15%, road flares 40%, a bandage kit 15%, a hand-crank radio 20%, a baton 8%.
- **Engine bay** (`AREAS.enginebay`, a fire station's bay in new saves; it was a motor pool): fuel 75% 4–10, parts 55% 1–3, scrap 50% 2–6; a fire axe 8%, a pry bar 6%, a crowbar 4%, a sledgehammer 3%, the siege ladder 4%, a hatchet 3%, a leather jacket 4%, a motorcycle helmet 3%, knee guards 3%, a flashlight 5%. Small finds (loot.js `AREA_FINDS.enginebay`): flares, batteries, lighters; tools (data-tools.js `AREA_TOOLS.enginebay`): a felling axe, a tool kit, a shovel, a hand saw.
- **School corridor lockers** (`AREAS.schoolhall`, the narrow `schoollocker`): many small draws, 10 a floor: food 12% 1–2, water 8%; a bat, a knife, a backpack, a sling bag 1–1.5%, football pads 1%; small finds 4% (a phone, candy, chocolate, cards). **School desk** (`schooldesk`): food 4%, a phone 0.5%. **Teacher's desk**: rest 0.5, meds 4%, a phone 2%. **Storage cage** (`sportcage`, a gym's): rest 0.2; a bat 25%, a hockey stick 15%, a golf club 6%, football pads 10%, a football helmet 8%. **Lab bench**: rest 0.3; meds 15%, parts 20%, a bandage kit 4% (the chemical cabinet: first aid, the game has no chemistry ingredients). A whole school holds 218 against 204 before (+7%).
- **Server rack** (`serverrack`, dispatch and a watch office): rest 0.2; parts 60% 1–3, scrap 50% 1–3, a hand-crank radio 6%. **Candlesticks** (`candles`, a church's altar): rest 0; silverware 35%, candles 50%. A church's pantry is kitchen loot (food).
- Records' filing cabinets keep the office table (no intel item in the game for maps). Test `tools/interiortest.js` (the ±10% checks).

## Electronics salvage
Taking apart gadgets, powered sights, lights, radios, power tools, generators and fridges gives electronics, as do stripped cars and wrecks.
- The user's request 2026-10-24: "I see electronics are a material I can loot. Does it have a mapping for when you salvage certain items it can yield some, or used in craft recipes and build recipes? If not do all of the previous for what makes sense. Add items that can be salvaged for electronics like cars etc."
- **The salvage map** (`inventory.js SALVAGE_ELECTRONICS`, read by `salvageYield`; electronics is worth 12 and weighs 0.3 kg), in electronics: gadgets phone 1, camera 1, console 1, laptop 2; night vision nvg 3, thermal 4, thermalscope 3, nvscope 3; radios and ears milradio 3, commset 2, handradio 1, pocketradio 1, eardef 1; the rangefinder 1; powered sights (reddot, holo, rmr, aimpoint, holosun, holopistol) 1 each; lasers (peq, laser, lasergrip, lightlaser) 1; LED lights (weaponlight, surefire, pistollight, flashlight, tacflash, headlamp, helmetlight, anglelight, spotlight, solarlantern, spotlamp) 1; taser and stun baton 1; power tools powerdrill 1, anglegrinder 1, welder 2; generators genset_inverter 2, genset_house 2, genset_contractor 3, genset_standby 4, genset_military 4; the fridge 2.
- **The attachment rule**: a gun still gives floor(value / 30) + 1 gun parts and a scrap; everything else merges its electronics with the gun part an attachment worth 25 or more gives, so a powered sight or laser worth 25+ gives both (the housing a gun part, the board its electronics): thermalscope { electronics 3, gunparts 1 }, peq { 1, 1 }, holo / rmr / aimpoint / holosun { 1, 1 }; a red dot (22) its electronics only; a foregrip nothing.
- **Deliberately not electronic**: glass optics (scope4x, acog, lpvo, tacscope, huntscope, prism2x, magnifier, binoculars, monocular, spotscope, telescope: tritium or fibre, no boards), tritium sights, wind-up things (alarmclock, noisemaker, windlight, the watch), a lantern and a torch, a pack of batteries (cells, not boards: the battery swap repair uses the pack whole) and the budget clones worth less than 12 (cheaplaser, cheaplight, cheapdot, cheaprmr, cheapholo, cheappeq, tapedlight), so a trader's cheap part cannot be bought and stripped at a profit (trade.js sells at 0.75 and buys at 1.3 × margin).
- **Cars** (`vehicles.js STRIP.elec`, `stripYield`, `stripVehicle`): a stripped car gives electronics by its type between a least and a most, scaled by condition like its car parts (`byCond`): sedan, truck, SUV and van 1–2, Humvee 2–3, Army truck 3–4; a wreck at condition 0 still gives the least. The garage's Strip for parts tooltip and WRECK_TEXT name it. A blown-up wreck stripped where it lies by a team (`parties.js recoverVehicle`) carries its electronics home in the cargo.
- **Wrecks and cards**: stripping a wreck on the base map gives 1 electronics (`basescatter.js CLEAR.strip`: scrap 6, a car part, 2 metal sheets, 1 electronics; a wreck dragged off unstripped gives it too); the hub card "A wreck near the walls" (`hubevents.js SALVAGE.electronics` 1); an escort's wreck taken in a caravan raid (`caravanraids.js ESCORT_TAKE.SALVAGE`) 1–2 electronics, a Humvee or MRAP 2–3 (its comms), rolled with the same deterministic dice as its parts.
- **AI parity**: the groups take their worn-out spare guns apart with `salvageYield` (arsenal.js groupSalvage), so a stun baton past mending gives them an electronics into their pooled parts.
- **The autopilot's reorder level** (`repair.js partPlan`): electronics 1 + the radio station + floor(electronic items at the base / 2), where an electronic item is now anything in the salvage map (`isElec`), lights, sights and power tools included.
- Modules: [inventory SALVAGE_ELECTRONICS / salvageYield / salvageInfo / salvageAt, vehicles STRIP / stripYield / stripVehicle, parties recoverVehicle, basescatter CLEAR / clearOf, hubevents, caravanraids ESCORT_TAKE, repair partPlan, arsenal groupSalvage, ui/ui (the strip tooltip), ui/codex (the electronics entry)]; test `tools/partstest.js` (the salvage assertions).
