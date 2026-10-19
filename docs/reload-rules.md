# Reloading: physical rounds (2026-10-18)

The user's rules, as built. Modules: `prototype/src/sim/mags.js` (the rules), `roundstack.js` (the stacks),
`ammo.js takeBattleRounds` (a shot), `gunload.js returnStacks` (the fight's end), `combat.js` (the Reload act,
`invAct` load/unload, `refitKit`), `kitcheck.js` (the kit check), `stealth.js` (an empty magazine thrown);
`ui/combat.js reloadPicker` / `kitWarnHtml`, `ui/itemmenu.js`. Tests: `tools/reloadpicktest.js` (the rules end to
end), `magtest.js`, `reloadsourcetest.js`, `shotgunreloadtest.js`, `invfighttest.js`, `ammotest.js`.

## What a Reload draws on

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
chamber's round from the nearest place). The item menu on the gun has "Reload: pick what to load…"; on a spare
magazine "Unload" and "Reload with it".

## Stacks

- A gun's rounds are a stack on the unit (`u.stack`: `[{ k, n }]`, the chamber first). `u.mag` counts them, `u.load`
  is the chamber's round: the shot is the chamber's (damage, aim, noise, jams). A burst takes its rounds off the top.
- A magazine holds an assortment (`item.stack`), loaded by hand in any order; its top is the chamber when it is swapped
  in. Unloading a spare (the item menu in a fight, 1 action) puts every round in it back as loose rounds on the person,
  each kind its own stack.
- The fight's start fills the gun and the spares physically: the gun's own rounds (a gun put down or found keeps
  exactly what it had), then the person's own rounds, then the team's bags (the rounds a team forming at a base took
  for its guns): every gun on the team first, then a spare each in turn, so the bags never fill one person's spares
  while a teammate's gun starts empty. The fight's end puts what is left in the gun and the magazines back onto the person as loose rounds
  (the stores for what finds no room), so out of a fight the rounds are counted where they always were and the badge
  works as before. A mixed stack does not survive the fight.
- The side's Ammo figure counts the bags, the pockets, the guns and the magazines once.
- A battle saved before this is brought over on load (`mags.js migrateUnitStacks`).

## Also (the same day)

- An empty spare magazine can be thrown as a lure (`stealth.js THROWABLES.emptymag`: a bottle's noise with a shorter
  reach); after a won fight it is picked up again.
- Before the first move (a raid's cards, the field panel) a kit check names anyone whose gun is empty, with a button
  into their Inventory to reload it first (or Proceed), no healing on the team, and anyone under 50 hp
  (`kitcheck.js`).
