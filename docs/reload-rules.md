# Reloading: physical rounds (2026-10-18)

The user's rules, as built. Modules: `prototype/src/sim/mags.js` (the rules), `roundstack.js` (the stacks),
`ammo.js takeBattleRounds` (a shot), `gunload.js returnStacks` (the fight's end), `combat.js` (the Reload act,
`invAct` load/unload, `refitKit`), `kitcheck.js` (the kit check), `stealth.js` (an empty magazine thrown);
`ui/combat.js reloadPicker` / `kitWarnHtml`, `ui/itemmenu.js`. Tests: `tools/reloadpicktest.js` (the rules end to
end), `magtest.js`, `reloadsourcetest.js`, `shotgunreloadtest.js`, `invfighttest.js`, `ammotest.js`.

## What a Reload draws on (in a fight; out of a fight see the last section)

- Only what the survivor carries: pockets, rig pouches, pack. Never a teammate's rounds, the team's bags, the vehicle
  or a base's stock. The refusal says where the rounds are instead ("The base's 40 are in its stock and 12 are on
  teammates, not to hand in a fight").
- The rounds leave the item as they go in. A 6-shell tube with 3 in takes 3, and 3 leave the pocket's stack. An
  emptied stack is thrown away.
- Loose rounds (and boxed ones): up to **6 a Reload**, whatever the gun: a tube, a cylinder, a bolt rifle's box, a box
  magazine topped up by hand in the gun, a spare magazine loaded by hand in the Inventory window. An empty 12-shell tube
  is two Reloads. A pocket or the rig: 1 action; the pack: both actions (and only when nothing is at hand; the Inventory
  window moves a box to a pocket for 1 action).
- A spare magazine: the swap costs its place (rig 1, pocket 1, pack 2) and is physical: the fresh magazine becomes the
  gun's fitted magazine, the one that was in the gun goes into the slot the fresh one lay in, with the rounds it had.
  A gun on its own standard magazine gets that magazine as a thing of its own when it comes out.
- Get shells is gone for your people (shells load straight in). Enemies and the third side keep the old rules (an
  endless reserve, 2–4 shells by dice, a handful out of a bag).

## The picker

Reload opens a box over the orders (`ui/combat.js reloadPicker`, `mags.js reloadOptions`): every spare magazine with
what is in it (one click swaps it in) and every stack of rounds on the person the gun takes, each with its place and
cost. Rounds are picked into a plan in the order they should fire (+1, +3, +6; ▲ ▼ reorder, ✕ drops one; up to 6);
Load fires it. I with the picker open loads the plan, or with nothing picked the next loaded magazine (else the
chamber's round from the nearest place). The item menu on the gun has "Reload: pick what to load…" and "Remove
magazine" ("Insert magazine" with it out); on a spare magazine "Load rounds", "Unload" and "Reload with it" ("Insert
magazine" when the gun has none).

## Stacks

- A gun's rounds are a stack on the unit (`u.stack`: `[{ k, n }]`, the chamber first). `u.mag` counts them, `u.load`
  is the chamber's round: the shot is the chamber's (damage, aim, noise, jams). A burst takes its rounds off the top.
- A magazine holds an assortment (`item.stack`), loaded by hand in any order; its top is the chamber when it is swapped
  in. Unloading a spare (the item menu in a fight, 1 action) puts every round in it back as loose rounds on the person,
  each kind its own stack.
- The fight's start fills the gun and the spares physically: the gun's own rounds (its record: what was left in it),
  topped up from the person's own rounds, then the team's bags (the rounds a team leaving a base took for its guns and
  spares: the team-forming window and every other launch alike, parties.js launchExpedition, on top of the rounds
  packed as supplies, which stay a reserve); each spare the same, its own stack first, topped up once a fight (mags.js
  fillUnit `top`): every gun on the team first, then a spare each in turn, so the bags never fill one person's spares
  while a teammate's gun starts empty. A gun or a magazine Unloaded by hand stays empty. A gun picked up in the middle
  of a fight holds exactly what was in it. The fight's end (2026-10-20) leaves what is left in the gun (its record,
  gunload.js returnStacks) and in each magazine (its stack): nothing goes loose, nothing is lost, a mixed stack keeps
  its order. A gun looted or picked up keeps its rounds too (no more unloading into the stores).
- The side's Ammo figure counts the bags, the pockets, the guns and the magazines once.
- A battle saved before this is brought over on load (`mags.js migrateUnitStacks`).

## Also (the same day)

- An empty spare magazine can be thrown as a lure (`stealth.js THROWABLES.emptymag`: a bottle's noise with a shorter
  reach); after a won fight it is picked up again.
- Before the first move (a raid's cards, the field panel) a kit check names anyone whose gun is empty, with a button
  into their Inventory to reload it first (or Proceed), no healing on the team, and anyone under 50 hp
  (`kitcheck.js`).

## Out of a fight (2026-10-20, the user's playtest reports)

"The gun said it had 3 bullets in it but would not reload with the 3 that were in the base storage. Then when I checked
again the 9mm pistol had 0 bullets in it." The badge used to count rounds in the stores to hand as if they were in the
gun (and counted a shared stock once for each person); nothing loaded them, and anything that took them from the stores
emptied the gun. Now every round is somewhere physical:

- **The badge** (gunrounds.js) counts what is in the gun (its record, it.loaded: the stack in firing order) or the
  magazine (item.stack), and nothing else. Moves, equipping, a save and a load never change it.
- **Loading out of a fight is by hand and free** (the item menu, itemacts.js), out of the round items the holder
  carries (pockets, rig pouches, pack), then round items in the storage list, then the place's stores (a base's stock;
  a team's found cargo, then what it packed). A gun or magazine in the armory or the cargo draws on the storage and the
  stores only.
  - A gun: **Reload** (up to its capacity, one kind of round: its own, the chamber's, the common one, then any it
    takes), **Reload with** (a kind: loaded now, and the round it takes the field with), **Unload** (every round out,
    loose onto the holder, the stores for what has no room; it stays empty, also as a fight starts, until reloaded).
  - **Remove magazine** on any gun with a detachable magazine (mags.js `detachable`: not a tube, a cylinder, a fixed
    box or a stripper-clip gun): the magazine (the fitted one, or the gun's own standard magazine made a thing of)
    comes out with every round but the chambered one, which stays in the gun (`gun.magOut`: capacity 1, the badge
    "1/1"). It goes onto the holder (a magazine pouch, a pocket, the pack), else into the storage. **Insert magazine**
    (or **Swap magazine**): a magazine on the holder or in the storage goes in with its rounds; the chambered round
    stays on top while there is room (over a full magazine it is ejected, onto the holder or the stores); a gun with a
    magazine in it has that one taken out into the new one's place. Fitting a magazine in the gun builder puts one in
    too.
  - A magazine: **Load rounds** / **Load rounds with** (up to its capacity, on top of what is in it: an assortment, the
    last in fired first), **Unload rounds** (onto the holder, else the stores; kept empty), **Insert into** a gun of
    the holder's.
- **In a fight** the same for actions: Remove magazine on the gun in the hands (combatAct "inv" op "magout": a pouch or
  a pocket 1 action, the pack 2; mags.js `removeMagUnit`), Insert magazine (a Reload with that spare, `{ mag: j }`,
  its place's cost; into an empty gun nothing comes out, the chamber's round stays on top or is ejected into the slot
  the magazine came from), Load rounds on a spare (op "load" from the nearest stack, 1 action from a pocket or the rig,
  2 from the pack, up to 6), Unload as before. A gun with its magazine out holds the chamber only (magCap 1): loose
  rounds go in one at a time until a magazine does.
- **Loaded up**: a new run's crew at Start (main.js; createWorld alone loads only from what each carries, so the
  world's stock stays whole for headless runs) and an old save (save.js `physOutV`) have every gun and magazine they
  carry topped up with real rounds (what each carries, then the place's stores; every gun first, then a spare each in
  turn; itemacts.js `loadUpAll`). A shared stock runs out where it runs out: the old badge counted it once for each
  person, so some spares that read full now read what there was.
- **Grants**: the officer's pistol (events.js hc_newdead) comes with its rounds in it and any over its magazine as
  loose 9mm in the cargo (they were the team's other calibres); a case carried (boxes.js takeFromBox) puts its rounds
  onto the one carrying it like its gun; a body's pistol and a sentry's gun bring rounds of their calibre.
- AI parity: AI people (fighters.js) load as yours at a fight's start (their own record, then what they carry); the
  AI groups' stores keep their abstract ammo (arsenal.js) and kit their people out through loadouts.js armRounds,
  which writes the same physical records.

Tests: `tools/physroundstest.js` (all of the above), `itemmenutest.js`, `startmagtest.js`, `reloadpicktest.js`.
