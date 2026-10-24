# 0001. Every human plays by the same rules (2026-10-19)

## Status

Accepted. The user's decision in a grilling session, 2026-10-18/19. Audit and plan: `docs/ai-parity-audit.md`.

## Context

The player's people are survivor records with skills, traits, health and a full inventory: physical round stacks,
magazines, rig pouches, packs, items with condition. AI groups were a head count, one pooled stock of numbers and one
pooled list of items. On the battle map an enemy was built from a power number, had an endless ammo reserve and
followed rules keyed to its side. Fights between groups were decided by formulas that read none of it.

## Decision

1. **Who.** Every human who is not yours: AI groups, nomads, visitors, splinters, caravans, the people holding a
   site, the third side.
2. **How strict.** On the battle map, the same code: one function per mechanic for every side. Off-screen, the same
   rules with the same inputs through one resolver.
3. **People.** AI members are survivor records made by the same constructor, under the group's own dice (the
   world's dice and people counters are swapped and restored, so a seed's starting crew is unchanged). They live in a
   people list per group, found by id. Health and skills tick for them; needs, mood and relationships do not (they
   are treated as fed and rested). People with no lasting entity (the holders of a site, rival scavengers) are made
   as survivors when the fight is set up and dropped after unless captured, recruited or escaped.
4. **Stores.** AI bases are base objects in the player's shape: stock with rounds by calibre, an armory, real
   buildings built through the player's construction code. A group may rebalance goods between its bases daily.
5. **Loadouts.** The arsenal becomes the AI's loadout manager: it issues from the armory into member inventories
   through the player's stow and magazine functions, daily at base and when a party forms, never at fight setup. It
   keeps a reserve and offers the rest for trade.
6. **Decisions may differ, rules may not.** The AI picks its own magazine, its retreat, who goes. A state a player
   cannot reach is a bug. One tactical brain drives every side's units.
7. **Nothing from nowhere.** Starting holdings at creation are allowed; later goods come only from scavenging,
   crafting and the bench paying inputs, trade through shared channels, loot from fights won, healing through the
   health code. The scrap, fuel and building-material trickle and food and water production are left for an economy
   pass.
8. **Honest balance.** No compensating cheats. If groups are too weak, fix their starting gear and recruitment.
   The by-the-numbers odds curve is refitted.
9. **Saves.** Old saves need not load.

## Consequences

- Several hundred readers of `f.pop`, `f.stock` and `f.arsenal` move to people lists and base objects.
- Each batch carries a swapped-sides parity test; `tools/conservationtest.js` guards the allow-list.
- Tests that asserted the old asymmetry are rewritten.
- A Huge world carries thousands of survivor records; the per-hour work on them is kept lazy.
- The power grid is theirs too (2026-10-24): a group's base runs its machines on an hourly budget once a day and builds the grid's pieces by the player's numbers ([docs/features/groups.md](../features/groups.md#the-groups-power-grid)).
