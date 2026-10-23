# Weapons, armour and gear

Detail for section 7 of [docs/agents/features.md](../agents/features.md). `[name]` is `prototype/src/sim/name.js`; `ui/name` is `prototype/src/ui/name.js`. Related docs: [docs/reload-rules.md](../reload-rules.md) (the reload rules), [docs/weapons-overhaul-plan.md](../weapons-overhaul-plan.md), [docs/prompts/battle-inventory.md](../prompts/battle-inventory.md).

## Physical rounds in a fight
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

## Physical rounds out of a fight; magazines out and in
- The user's playtest reports 2026-10-20; [docs/reload-rules.md](../reload-rules.md) "Out of a fight". Test `tools/physroundstest.js`. Modules: [itemacts, gunrounds, gunload, mags, combat, ui/itemmenu, ui/itemlabels].
- The rounds badge counts only what is in a gun (its record `it.loaded`) or a magazine (`item.stack`), never the stores (gunrounds `physOf`).
- **Out of a fight, free**: a gun's **Reload** / **Reload with** / **Unload**, **Remove magazine** (a detachable magazine, mags `detachable`: the magazine with all but the chambered round onto the holder or the storage, `gun.magOut`, capacity 1) and **Insert / Swap magazine**; a magazine's **Load rounds** / **Load rounds with** / **Unload rounds** / **Insert into**. Sources: what the holder carries, then the storage list, then the place's stores (itemacts `roundSourcesAt`, `reloadGunAt`, `unloadGunAt`, `removeMagAt`, `insertMagAt`, `loadMagAt`, `unloadMagAt`).
- **In a fight, for actions**: Remove magazine (combat invAct op "magout", mags `removeMagUnit`), Insert magazine (a swap into the empty gun), Load rounds (op "load").
- A new run's crew at Start and an old save are loaded up out of what each carries and the stores (itemacts `loadUpAll`; main Start, save `physOutV`; createWorld from what each carries only).
- An event's pistol comes with its own rounds (events hc_newdead); a carried case's rounds go onto the carrier like its gun (boxes `takeFromBox`); a body's pistol and a sentry's gun bring their calibre (inventory `deadBodyFinds`, citycrawl).

## Armour and rigs
- Armour classes AC 1–6 with per-hit durability, helmets and face shields, plate carriers and rigs [armour, helmets, data-helmets, data-kit].
- A rig's pouches come by kind (rifle and pistol magazines, a grenade, a radio, admin up to 0.5 kg). Every rig has **pocket pouches** that take anything a pocket takes (a chest rig and a tactical vest two; a makeshift rig and a plate carrier one) [data-kit POUCH_NAMES / SUPPLY_POUCHES, inventory pouchReason / stow / quickMove].

## Inventory
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
- The user's request 2026-10-21: "increase loot spawn of zombies being previous survivors with gear on them like side arms ammo melee packs and survival items". Tests `tools/holstertest.js`, `tools/loottest.js`, `tools/itemcondtest.js`.
- `ZSURV.chance` (18%) of the plain dead (not a dead soldier, a beast, a boss) carry a former survivor's kit, each part on its own chance: a side arm with a box of its rounds, a belt blade, a pack of survival things (lights, lighters, bandages, a tourniquet, water tablets, a radio, picks, a snare…), earplugs or muffs, a ration, water. No meds: they stay rare.
- On a field battle's body worn in their slots; on a raid's body among the finds. Dice of their own (the world's dice unchanged; `ZSURV.on` a test switch).
- Modules: [inventory `ZSURV`, `survivorDead`, `wearSurvivorKit`, enemyBody, deadBodyFinds (tag: the body's unit id)].

## Survival guns, parts and gear (2026-10-19)
- Guns: the SKS (fixed box, stripper clips), the Uzi, a folding 9mm carbine on the polymer pistols' magazines, a bullpup pump shotgun, a takedown .22.
- Parts: a night vision scope, a 2× prism, a Zhukov stock, an AFG, a linear comp, a single-point sling, a taped flashlight.
- Gear: the Halligan bar (a pry tool), a pipe wrench, armour against teeth (leather jacket, chainmail sleeves, motorcycle trousers), an angle-head flashlight, a solar lantern, a drop-leg rig, a paramedic's jump bag, a laser rangefinder.
- Each works through an existing system; found on their own dice [data-survival, survival, data-guns SURV_*, data-gunmods, data-kit SURV_*].

## Lock boxes and cases (2026-10-19)
- Cash boxes, fire safes, toolboxes, equipment cases and gun cases hold valuables, a gun, rounds, camera gear or nothing, unseen until opened. Their weight (the box's own plus what is inside) is the clue.
- A locked one opens to the right tool (cheap lock: picks, a blade, a pry bar, a power tool; steel: a pry bar or a power tool) from the right-click menu, free out of a fight, into a window of what is inside (Take, Take all); in a raid for actions and Heat.
- Modules: [data-boxes, boxes, gunsafes rollGunCase, locks caseOdds, ui/boxview].
