# AI parity: combat and inventory (2026-10-19)

The user's rule: every human who is not yours (an AI group's members, nomads, visitors, splinter bands, caravans and
their escorts, the people holding a site you raid, the third side) fights and carries things under the same rules as
your people, in every scenario where the comparison makes sense. Decided in a grilling session on 2026-10-18/19; the
decisions are in `docs/adr/0001-ai-parity.md`. This file lists every asymmetry found in the code on 2026-10-18 and
what happens to it.

**The test for a finding.** Could a player have reached this state under the rules? An automated AI choice a player
could have made (which magazine to load, who to send, when to retreat) is fine. A state a player cannot reach (a
reload from nowhere, a gun made from nothing, a body full of rounds that never existed) is a finding.

**Marks.** *Fix N*: fixed in batch N of the plan below. *Keep*: a decision, not a rule, and stays. *Economy*: real,
but outside combat and inventory; left for a later economy-parity pass.

**Out of scope.** Needs (hunger, thirst, mood, sleep), relationships, family and mental breaks for AI members (they
are treated as fed and rested); food and water production; population growth.

## The plan

1. **Foundation.** AI members become survivor records; AI bases become base objects with their own stock (rounds by
   calibre) and armory; parties become member lists; the arsenal becomes a loadout manager working through the
   player's inventory functions; one unit builder makes every human on the battle map from a survivor.
2. **Ammunition.** Finite physical round stacks, magazines and reloads for every side.
3. **The side-keyed rules.** The ten rules below, break-off policies for every by-the-numbers fight, XP for everyone,
   one tactical brain for every side.
4. **Bodies and gear flows.** A body yields what was carried; every flow moves the real item.
5. **Workshops.** AI repair, crafting and the reloading bench through the player's code.
6. **Off-screen fights.** One resolver for every fight nobody watches; hordes on AI bases through the defence path;
   the odds curve refitted.

Each batch lands with a swapped-sides parity test and grows `tools/conservationtest.js` (a campaign run asserting no
AI holding grows from nowhere).

**Legitimate sources** (the conservation test's allow-list): an entity's starting holdings when it is created (a
group at world start, a visitor on arrival, a nomad band on respawn, a recruit's kit, the people holding a site when
the fight is set up); scavenging a site's own pool; crafting and the bench paying their inputs; trade and purchases
through channels the player can use; loot from fights won; healing through the health code.

## 1. What an AI group is

| # | Finding | Where | Mark |
|---|---|---|---|
| 1.1 | A group's people are a head count (`f.pop`); nobody has skills, traits, health or a name. | factions.js:180 | Fix 1 |
| 1.2 | A group's bases are tile ids with counters (`f.works[tile]`), not base objects; no buildings, plots, stock or armory per base. | factions.js, groupworks.js:2 | Fix 1 |
| 1.3 | One pooled `f.stock` per group, rounds as one generic `ammo` count folded back every hour. | ammo.js:235, rounds.js:201 | Fix 1 |
| 1.4 | One pooled `f.arsenal.items` per group; no per-person slots, pockets, rig, pack or weight out of a fight. | arsenal.js:222, teaminv.js:24 | Fix 1 |
| 1.5 | Parties carry a `strength` number and abstract goods, not members; `f.pop` is not reduced while one is out. | parties.js:1040 | Fix 1 |
| 1.6 | Wounded are a counter (`f.wounded`), healing or dying as a number. | groupcare.js:289 | Fix 1 |
| 1.7 | Nomads and visitors have stock and a trade shelf but no arsenal; their weight is a flat capacity. | nomads.js:199, visitors.js:279 | Fix 1 |
| 1.8 | Hostile bands and military squads are `{count, power}`. | wanderers.js:193 | Fix 1 |
| 1.9 | A stormed AI base is laid out from a template sized by head count and wall counters, even a former player base they hold. | fort.js:327, conquest.js:136 | Fix 1 |

## 2. Units on the battle map

| # | Finding | Where | Mark |
|---|---|---|---|
| 2.1 | Your units are built from the survivor (skills, traits, needs, perks, health); enemies from one `power` number and a kit (aim 39 + 4p, hp 55 + 5p). | combat.js:3209, 3510 | Fix 1 |
| 2.2 | A group's kit counts twice: inside `power` (`kitFactor`) and again as the issued gun's quality. | arsenal.js:414, 450 | Fix 1 |
| 2.3 | Units not tied to a group (nomads, visitors, wanderers, unnamed raiders, the third side) are armed by kit dice. | combat.js:3525, thirdside.js:89 | Fix 1 |
| 2.4 | Enemies are re-armed from the whole group's best gear at fight setup. | arsenal.js:330 | Fix 1 (what they carry is what they have) |
| 2.5 | Every tactical fight spawns fresh full-health enemies. | combat.js:3646 | Fix 1 |

## 3. Ammunition

| # | Finding | Where | Mark |
|---|---|---|---|
| 3.1 | Non-player sides have an endless reserve (`avail` returns Infinity). | mags.js:142, 560 | Fix 2 |
| 3.2 | Their spare magazines are counters, topped up from nothing for 2 actions. | mags.js:50, 717 | Fix 2 |
| 3.3 | Their shotguns start with 8 loose shells and an endless pack. | mags.js:385, 438 | Fix 2 |
| 3.4 | Only your side can be refused a reload; a legacy reload fills enemies to max. | combat.js:3075, 3108 | Fix 2 |
| 3.5 | Their round type is rolled by dice, not drawn from what the group holds. | ammo.js:630 | Fix 2 |
| 3.6 | A group pays a flat 3 rounds a gunner per fight, whatever was fired. | arsenal.js:83, 569 | Fix 2 |
| 3.7 | They reload only when empty, with no ammo-type switching. | combat.js:5148 | Fix 3 (one brain) |

## 4. Rules keyed to a side

| # | Finding | Where | Mark |
|---|---|---|---|
| 4.1 | Only side "enemy" can be caught unaware for the aim bonus and no cover. | combat.js:2680 | Fix 3 |
| 4.2 | The flare's aim bonus applies only to your shooters. | combat.js:2714 | Fix 3 |
| 4.3 | Only your units sneak; non-player footsteps make no noise. | combat.js:3972, 2341; vision.js:132 | Fix 3 |
| 4.4 | Only your guns wear from use above skill. | combat.js:4057 | Fix 3 |
| 4.5 | Only your armour wears after a fight. | combat.js:6078 | Fix 3 |
| 4.6 | Downed: yours bleed and may live; enemies die after the fight unless you won and tied them; the third side dies outright. | medics.js:602, 652 | Fix 3 |
| 4.7 | Permanent hearing loss is yours only. | hearing.js:88 | Fix 3 |
| 4.8 | An enemy's deafness does not shrink the wake radius from gunfire. | combat.js:6705 | Fix 3 |
| 4.9 | Enemies throw only frag, pipe bombs, flashbangs and smoke, though their arsenals hold Molotovs; no AI lures. | siege.js:54, 595 | Fix 3 |
| 4.10 | XP from fights is yours only; AI groups have no veterancy. | skills.js:859 | Fix 3 |
| 4.11 | Only enemies can be subdued or taken down. | stealth.js:291 | Fix 3 |
| 4.12 | Your own AI's meds use is player only. | combat.js:5046 | Fix 3 (one brain) |
| 4.13 | The third side's hp is never written back; its dead are the last listed, not the ones who died. | thirdside.js:58, wanderers.js:665 | Fix 3 |
| 4.14 | Enemies flee at a fixed ratio; your side never breaks and retreats by hand. | combat.js:5409 | Keep (a decision) |
| 4.15 | Break-off policies cover your party's field fights only. | breakoff.js:23 | Fix 3 (every by-the-numbers fight) |
| 4.16 | Siege kit (ladders, rams, grenades) comes only on raids against your bases. | factions.js:669 | Fix 6 |

## 5. Gear flows

| # | Finding | Where | Mark |
|---|---|---|---|
| 5.1 | Every human body rolls free food, meds, scrap, a 12% spare gun, a pocket find and a pack. | inventory.js:972 | Fix 4 |
| 5.2 | Rounds on a body are made fresh (3–10), not taken from anywhere. | inventory.js:971, ammo.js:389 | Fix 4 |
| 5.3 | A group fighter's magazines drop with no rounds written in them. | carrykit.js:201 | Fix 4 |
| 5.4 | A gun an AI fighter picks off the ground is lost if they survive. | ground.js:259 | Fix 4 |
| 5.5 | Robbing a team: non-weapon gear becomes a name in `lootedGear`; worn gear is not taken. | conflicts.js:243 | Fix 4 |
| 5.6 | A captive is stripped and the non-weapon items vanish. | conflicts.js:285 | Fix 4 |
| 5.7 | AI groups scavenging a death site keep only names. | economy.js:807 | Fix 4 |
| 5.8 | Items you left in a container: a group keeps only the weapon-grade ones. | aiscav.js:285 | Fix 4 |
| 5.9 | Nomads winning a fight take supply counts, no items. | nomads.js:764 | Fix 4 |
| 5.10 | Caravan-delivered gear goes to the 12-item shelf, never the arsenal. | caravans.js:144 | Fix 4 |
| 5.11 | Ransom guns bypass the arsenal's bookkeeping. | ransom.js:359 | Fix 4 |
| 5.12 | Volunteers returning: everything but weapon-grade items is deleted, despite the text. | volunteers.js:381 | Fix 4 |
| 5.13 | Your prisoners carry nothing; a released one only adds 1 to `f.pop`. | prisoners.js:507, 775 | Fix 4 |
| 5.14 | AI-held prisoners are counts. | groupjails.js | Fix 4 |
| 5.15 | AI vehicles are records with no cargo; a captured vehicle loses what it held. | vehicles.js:576, arsenal.js:926 | Fix 4 |
| 5.16 | Assaulting a base takes a share of the whole group's pool, not what is at that base. | conquest.js:395 | Fix 1 (per-base stores) |
| 5.17 | The trade shelf is made from nothing (`ensureWares`). | trade.js:456 | Fix 4 |
| 5.18 | `groupBuysGun` makes a gun from nothing; the scrap leaves the world. | arsenal.js:815 | Fix 4 (buy through shared channels) |
| 5.19 | A smoke restock and a newcomer's kit appear from nothing. | arsenal.js:789, 909 | Fix 4 (a newcomer's own kit is a creation seed and stays) |
| 5.20 | AI-to-AI convoys are given 10 food and 10 scrap with no deduction. | factions.js:464 | Fix 4 |
| 5.21 | `migrateStacks` skips AI item lists. | itemstack.js:296 | Fix 1 (no old saves; new lists are walked) |

## 6. Workshops

| # | Finding | Where | Mark |
|---|---|---|---|
| 6.1 | AI repair has its own math; only the skill gates are shared. | groupcare.js:332 | Fix 5 |
| 6.2 | AI kit wear is one use a fight, not per-hit and per-shot. | arsenal.js:291 | Fix 3 (wear through the same code) |
| 6.3 | AI crafting makes a weapon or bomb on a fixed calendar. | arsenal.js:837 | Fix 5 |
| 6.4 | The AI bench turns brass, powder and primers into generic ammo. | reloading.js:491 | Fix 5 |
| 6.5 | AI groups never salvage, break down, fit or strip gun parts. | inventory.js:697, 750 | Fix 5 |
| 6.6 | Daily production from nothing: ammo and meds. | factions.js:362 | Fix 4 |
| 6.7 | Daily production from nothing: scrap, fuel, building material. | factions.js:362 | Economy |
| 6.8 | Food, wood and water production by formula. | factions.js:339, 374 | Economy |

## 7. Fights nobody watches

| # | Finding | Where | Mark |
|---|---|---|---|
| 7.1 | An ordinary raid between groups is a threshold (att > def × 1.1). | factions.js:911 | Fix 6 |
| 7.2 | A war raid is `att / (att + def)`. | diplomacy.js:390 | Fix 6 |
| 7.3 | A group robbing a caravan is a hash under a clamp. | caravanraids.js:574 | Fix 6 |
| 7.4 | A horde at an AI base ignores defence buildings, traps and specials. | hordes.js:47, 205 | Fix 6 |
| 7.5 | An AI party meeting a horde loses a strength factor, no people or kit. | parties.js:2626 | Fix 6 |
| 7.6 | Your by-the-numbers power reads skills, gear, armour, ammo drawn; theirs is `count × power × fortified`. | combat.js:431, 436 | Fix 6 |
| 7.7 | AI base defence reads wall counters and towers, never defences.js. | groupworks.js:260, groupflight.js:54 | Fix 6 |

## 8. Tests that assert the old asymmetry

`tools/magtest.js` ("Enemies keep the old rule") and the legacy-reload checks; parts of `arsenaltest.js`,
`gunloottest.js`, `enemyaitest.js`, `volunteertest.js`, `prisonertest.js`, `nomadtest.js`, `calibrate.js`. These are
rewritten to assert the shared rule as each batch lands.

## Status (2026-10-19, end of the six batches)

Every *Fix* finding above landed on the `ai-parity` branch, with these exceptions and notes.

**Done with a caveat.**
- 4.16, siege kit: a raid on your base still brings its ladders, rams and grenades by kit dice, not from the raiders'
  stores. The grenades are the one remaining "from nothing" source in a fight.
- 7.4, a horde at an AI base: your base's two steps. The walls hold back the dead up to the base's limit; the rest
  break in as your break-in force (defences.js breakInForce) and are fought by the numbers on the very people there,
  behind the base's defence tiers (hordes.js onHordeEnter, groupfight.js). Traps and special buildings at an AI base
  still do nothing against it, and the horde's own losses keep hordes.js's formula.
- 7.7, an AI group's judgement of a base it cannot hold (groupflight.js) still reads the wall counters for the
  decision. The fight itself goes through the defence tiers.
- Soldiers' field load: an AI person carries a weight by kit with no item behind it (carrykit.js CARRY.BASE_KG,
  fighters.js build), so the user's decision of 2026-10-08 ("soldiers in full kit move 4") holds. It is weighed by
  your rule (felt load, a strong back, Fleet-Footed) and leaves nothing on the body.
- The off-screen odds (combat.js ODDS) were refitted on 2,376 map fights after the change. No compensation was added:
  where an AI side is now weaker, the fix is its starting gear or recruitment.

**Closed after the six batches.**
- A nomad band's trade shelf is what it carries: nothing is cut off to fit a size (the 12-item trims in nomads.js,
  trade.js and radiotrade.js are gone, WARES_MAX with them). Goods come onto it only as far as the band's people can
  carry them by your teams' rule (nomads.js bandRoom: parties.js carryCapacity on its people, less its stores and
  its shelf): what it cannot carry from a container it raids stays in the container (poicont.js lootPoiAbstract
  opts.room), what it takes from a team it beat is what fits, and a trade that would load a band (or a visitor met on
  the road, by its capacity) past it is turned down (trade.js tradeVerdict). Outsiders' shelves get nothing new from
  nowhere (trade.js ensureWares). Checks: tools/nomadtest.js (raids, trade), tools/paritytest.js section 4.
- AI people move as themselves, never as a head count (members.js header):
  - Loans between groups (volunteers.js aiLendDaily, the council's councilVolVote): the lender's very people leave
    its list with what they carry (lendPeople, location "lent"), are held on the loan, and come home as themselves
    (loanHome); the ones who fell are buried by the group they fought for, which keeps their kit and rounds; one may
    stay with it as its own.
  - Hardcore: a band's people are records from the start (hardcore-groups.js makeBand), its road losses come off the
    list, founding its hub makes that list the group's, a band taken in by a group moves into its list (joinGroup);
    the military's strike force is its own list of the very soldiers (strike.people: their dead fall off it, the rest
    come home into the list); when the base falls the garrison's dead and survivors are its people, the splinter
    groups and stragglers are those same soldiers, and the ones who reach you are offered as themselves with their
    kit. Your meds patch up their wounded instead of adding soldiers.
  - Rescue jobs (jobs.js): the captives are the very people in the holders' jail (data.ids; raiders grabbing a group's
    people on the road put them there, groupjails.js capturePeople), and freeing them walks those people home
    (groupjails.js freeHeld). A job failed or called off moves nobody.
  - War captives: the war's head count (w.captives) is gone; captives are people in the captor's jail and the peace
    sends each side's home as themselves (diplomacy.js endWar). A jail record is always a person: no phantom
    prisoners from a short head count (groupCapture), none brought home by a number (groupjails.js goHome,
    prisoners.js goHome, conquest.js: your prisoners at a base the group takes back), and the dead head-count prisoner
    calls in diplomacy.js are gone. A group that falls sends its heir only people it has (factions.js takeOver).
  - Nomad bands taking in wanderers you met take those very people (nomads.js recruit).
  Checks: tools/volunteers2test.js, tools/jailtest.js, tools/diplotest.js (rescue jobs, the peace), tools/hcgroupstest.js
  (founding, a band taken in, the strike force and the fall), tools/paritytest.js section 4, and
  tools/conservationtest.js (no person in two places at once; every group's head count is its list).

**Closed in a follow-up pass (2026-10-19).**
- Decoys and the crush: every other side's people get your bots' two moves on their own turn (combat.js aiUnit →
  aiRepertoire), through the same functions: a decoy they carry thrown on the dead pressing their side, once a turn for
  the side (decoys.js botDecoy; fighters.js counts the decoys and a flare among what a person throws, and the thrown
  one leaves them after), and a body in danger next to them crushed for 1 action when none of their foes is next to
  them (carriers.js botCrush, combat.js crushAct). A decoy pulls the dead off whoever they are fighting (decoys.js
  lureTurn reads combat.js foesOf), and by the numbers a side's decoys and Molotovs count against the dead for every
  side (groupfight.js fightSides reads decoys.js lureEdge).
- Your convoy robbed: its very people are the side in your place in the fight (groupfight.js fightSides, a side
  `{ yours: true }`), and its rounds land on them by your team's rules (groupfight.js applyYours → breakoff.js
  landFight, the code your team's fights by the numbers use): wounds, deaths, the left behind taken by the band. A
  convoy pulls out when the fight turns unless you set its policy (breakoff.js convoyPolicy). Beaten off, the convoy
  takes what the band's dead carried; a convoy with nobody left is wiped as a team is (caravanraids.js groupRobs; the
  raiders from outside the same way: visitors.js hitConvoy).
- Your deserters: one who joins a group goes over as the very person with all they carry and the haul they took
  from your stores (groupcare.js takeInFromYours, members.js joinFromYours: the record moves to the group's list under
  a member's id, a stub of who they were stays in yours carrying nothing; the rounds are noted in the ledger). One who
  follows a group's preachers out (playerwars.js convert) goes the same way.
- 5.15, vehicles: a group's vehicle record has a cargo of its own in your vehicles' shape (v.cargo), and every move of
  a vehicle between your vehicles and a group's records takes it along (vehicles.js carryCargo): a car of yours left
  with cargo in it and taken off the map, your team's car taken with it, one stolen, bought, sold, seized with a base,
  lost on a raid, an escort's truck taken with its caravan (it used to vanish; now the gang keeps it). Whoever ends up
  with it unloads it at home (arsenal.js unloadVehicle, vehicles.js cargoToBase); what is in a car you sell or buy
  stays with the seller.

- The last head counts of people changing sides: a captive of yours who turns goes over as the very person
  (conflicts.js captivesDaily → members.js joinFromYours, their kit onto the group's books), and a group's deserter
  is always one of its people at home (groupcare.js desertOne): with everyone out with a party nobody walks out, so
  no deserter is made up for your gates and no group gains a head from nobody.

**Still open (small, noted for a later pass).**
- Refugees from outside joining a nomad band (nomads.js recruit) and someone off the road joining it still come as a
  head count; refugee bands have no people records until one is needed.
- A hardcore band's stragglers and splinter groups still carry stores made by formula (makeSplinter's minimums, the
  stragglers' rations), not taken from the fallen base's stores.
- The groups' loadouts do not hand decoys out (they share the explosives, flashbangs and smoke): an AI person throws a
  decoy only when they carry one of their own. Left open because handing them out means putting decoys on the
  groups' books (arsenal.js arsenalWorthy), which also changes what their scavenging keeps: an economy question.

**Found on the way.** Dice keyed on a person's id came out differently in two worlds on one seed, because your
people's and newcomers' ids come from a counter shared by the process; they now use a world-local key (members.js
personKey), and tools/dettest.js passes in full. A group that fell gave its heir half its stores without taking them
out, and tributes and jail payments paid "ammo" from a generic count; both now move the very rounds.

**Tests.** `tools/paritytest.js` swaps the sides of each shared rule and checks both come out the same.
`tools/conservationtest.js` plays a campaign and checks the AI side never holds more rounds than its noted sources
brought in, and that no item is in two places.
