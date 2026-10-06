# Coalition, land, hives and water: the 2026-10-06 request

The user's wording is kept; "Reading" lines are the lead's interpretation. Four agents build this in parallel; the
**contracts** below are shared so their work fits together. Owners: A = coalition/land/radio/wells, B = hives and the
AI groups, C = the autopilot, D = hardcore start and the testing items.

## The request

> How can coalitions not be in reach when you can create bases to chain radio reach but do make radios have 12 reach
> and military radios have 24 reach
>
> Conquest counts for coalitions as long as you have members and 50%+ of the land
>
> Add a way to send people out to a tile and claim it (must be adjacent to a tile you already own). This counts
> towards the 50% of land. This can be overtaken from other group bases/hives and hostiles overwriting your claim.
>
> Balance hives so they grow slow to faster but even when faster it only can create 5-8 over 3 years on larger maps
>
> AI Groups should fight nearby hives as they are a huge threat
>
> Implement 4 [from docs/campaign-census-2026-10-06.md: give the autopilot a hive campaign: fires and allied fighters
> stack toward a storm, and ammo is stockpiled for it, so a 150-guard hive is approachable by year two]
>
> The player should try to hunt down nearby hives and ally with other AI groups to wage war on AI hives and other
> hostile AI groups
>
> Allow for creating water wells on adjacent base tiles that are owned to haul water from. Different tiles will
> provide more or less water or none and can go dry over time of use but not very quickly.
>
> The hub needs to gather or trade for water/food if it cannot get any
>
> Buff the initial items for a hardcore mode. At least one of the survivors to be a prepper so they will start with a
> duffle bag with a decent amount of supplies 5 days worth
>
> How was there only 2 teams and 39+ people were left in the base and died from thirst, is there a team limiter?
>
> Add all testing items from the doc

Reading of the team question: yes. Each autopilot style launches at most `maxTeams` trips at once (cautious 1,
balanced 2, aggressive 3) with a cooldown between launches (autopilot.js planTrip); water hauling was an ordinary
trip under that limit, so with both teams out nothing hauled. A human player has no such limit. Fix under C.

## Contracts

### Claims (A; read by B's hive hook, C's governor, D's census)
- `state.claims = { [tileId]: { owner: "player" | <faction id>, since: <hour>, well?: { yield, left, dug } } }`, created
  on demand (`ensureClaims(state)`); saved as plain data (sim/save.js needs nothing special).
- `sim/claims.js` exports: `ensureClaims(state)`, `claimOwner(state, tile)` (owner or null), `ownsTile(state, tile)`
  (a player base tile or a player claim), `canClaim(state, tile)` → `""` or why not (land only, not a base, not a
  hive, adjacent to a tile you own), `claimTile(state, p, tile)` (a team order: 2 hours on the tile, 3 scrap for the
  marker post; log line), `releaseClaim(state, tile, why)`, `overwriteClaims(state, tile, radius, newOwner, why)`
  (a group's base founded / a hive risen / a hostile team or band camped a day on the tile takes the claims there),
  `playerClaims(state)` → tile ids, `claimedLand(state)` → count.
- `alliance.js controlledLand` counts player claims as held land. The Territory map layer shows claims in the
  player's colour (lighter) and the hover text says "Claimed by you (day N)".
- Hooks other owners must keep: one call to `overwriteClaims` in hives.js where a hive rises (A inserts it; B
  preserves it), one in factions.js where a group founds or takes a base (A inserts).

### Wells on claimed tiles (A)
- `claims[tile].well = { yield, left, dug }`: dug by a team order "Dig a well" (24 hours, 15 scrap, 1 part) on a
  player claim adjacent to one of the player's bases. `yield` a day by terrain: beside a river or lake 10, farmland
  6, plains / forest 4, hills 2, suburb / city 2, mountain 0 (cannot dig). `left` starts at 1500–4000 (by the dice
  and the terrain) and falls by what is drawn; under 20% the yield halves; at 0 the well is dry (a log line).
- `economy.js waterProduction` adds the wells of the base's adjacent claims as `hauled` (somebody at the base
  hauls it: at most one well per 4 people at the base), and the base card lists them.

### Radio reach (A)
- `RADIO_RANGE` 8 → 12 for a radio station. A base holding a "Military encrypted radio" item in its armory (the
  existing loot item) reaches 24. Relays chain as now; a chain runs through owned bases only. `GROUP_REACH` 4 → 6.
- The coalition's `NEIGHBOUR` (8) and `MEMBER_RELAY` (12) rules stay, the radio reach does the rest.

### Victory (A)
- `allianceVictory`: the coalition has at least one member and holds more than `LAND_NEEDED` (50%) of the land.
  Groups outside no longer block it (conquest counts: break them or leave them). The Goals panel, the end screen,
  the chronicle caption and wintest's "what blocks the win" text follow.

### Hives (B)
- `HIVE.SITE_DAYS` becomes a curve: slow in year one, faster later, but new hives over three years capped at
  `HIVE.NEW_CAP` = 5–8 on large and huge maps (scale by `worldScale`; normal maps proportionally fewer). Growths
  and hordes unchanged unless needed to meet the cap.
- AI groups fight nearby hives: a group with a hive within `GROUP_HIVE_RANGE` (12) tiles sends a war party every
  `GROUP_HIVE_EVERY` (20–40) days by type (fortress and military often, traders rarely, zealots always); each party
  cuts the hive's guard by a share (by their power) and can destroy it when the guard is small; log lines the player
  sees when in radio reach; groups that fight the same hive as you gain goodwill. Nothing here needs the player.

### Autopilot (C) — autopilot.js only
- Hive campaign: pick a target hive (nearest known, or the one a group asks about), stockpile ammo toward
  `HIVE_SQUAD × HIVE_AMMO + 20` (trade for it, craft it, scavenge gun stores first), set fires over several trips,
  bring allied fighters (`hiveAllies`), and storm when the odds are there; a card line in the Goals panel says what
  the campaign waits for. `autopilotStats(state).hiveRejects = { unknown, far, odds, ammo, squad, rest }` counts why
  `hiveCandidate` returned nothing each morning (D's census prints it).
- War council: ally with groups near the target hive (envoys, pacts, invitations as now, but aimed), and join or
  start wars on hostile groups that raid the coalition's land, within the style's appetite (cautious never).
- The hub gathers or trades for water and food when it cannot make enough: water hauling and Fetch water pre-empt
  the team limit when the base is already short (`days < 1`), food trips likewise; radio trades ask for water/food
  first when short; a Water/Food line in the governor's daily log says what it did.
- Claims: when the coalition's land is under 50%, the governor claims adjacent tiles toward the nearest contested
  ground and digs wells on claims by water when water is short (use A's `canClaim` / `claimTile`; guard with
  `typeof` until A lands).

### Hardcore start and testing (D)
- Hardcore start: one of the three is a prepper: a duffle bag (new pack item, bigger than a hiking pack) with about
  five days of food and water for three, a water filter or purification tablets, a hand-crank radio or a knife,
  and the Prepper trait if traits allow; the others as now. hardcore-start.js / hardcore-loot.js / data.js /
  inventory.js only.
- Testing items 1–7 from docs/campaign-census-2026-10-06.md: per-season columns (thirst and hunger by season), a
  `--size` sweep, coalition blockers at month 12 / 24 / end, hive storm rejections (from `autopilotStats` when
  present), a hardcore-cautious preset (`--preset hardcore-cautious`), a raid bot that leaves a building earlier
  and by the odds (combat.js `autoRaidTurn`: Heat 40, half the squad hurt, or the exit path lengthening), and
  tools/census/ with a README naming the commit each report ran on.

## Order of work
All four start at once. Merge order on dev: A (contracts), B, C, D; each agent runs its own suites and the shared
ones (tools/teamtest.js, savetest.js, uitest.js, autotest.js 120 all 3 size=huge) before reporting. Nothing is
committed by agents; the lead commits each agent's files by name.

## As built (2026-10-06)

Commits on dev: `d2cfda5` (D: hardcore prepper, raid bot, census tooling), `26ca853` (A + C: coalition rule, claims,
wells, radio, the governor's campaign / war council / emergency gathering), `5dec01e` (B: hive growth cap, groups fight
hives). Readings and deviations from the contracts:

- **Victory**: at least one member and over 50% of the land; the Accord clock follows the same rule. "You alone"
  (no member) does not win.
- **Claims**: `sim/claims.js` as contracted; `ownsTile` also counts the ground around your bases (so the first claim
  can start from a base's own reach). A group's claim bordering your land can be claimed over. Claims under your own
  bases vanish silently; under a group's base or ground they pass to that group; a hive risen or a group's base
  founded within 2 tiles, or a hostile party or band camped a day on the tile, takes them. Team panel, right-click
  menu and the orders card offer the order; the Territory layer colours claims lighter blue.
- **Wells**: shore 10 a day, plains 6, forest 4, hills / suburb / city 2, mountain none; 1500–4000 water before dry
  (half rate under 20%); hauled into the base's water at most one well per 4 people there; the base card lists them.
- **Radio**: station 12, a base holding a "Military encrypted radio" item 24, groups' own sets 6 beyond coverage;
  chains run through owned bases; the coalition's 8 / 12 tile neighbour and member-relay rules unchanged.
- **Hives**: new hives per three-year span capped 5–8 on large and huge (3–5 normal, 2–3 small), first site around
  day 300–460 and the gaps shrinking; the span renews every 1095 days (say if the cap should cover the whole run).
  Measured over three years: huge 4–7 new (was ~16). Sites must be reachable over land from a hive. Group war
  parties: zealots every look, military and fortresses most, traders and communes rarely, raiders never; they
  burned 0–2 hives per three-year run by themselves (they need 40–50 people or your fires first).
- **Autopilot**: campaign target = nearest known hive within 60 tiles; ammo to 92 before a storm; fire trips (score 5)
  when three trips of fires would bring the odds in reach; fuel held back for them; envoys aimed at groups near the
  target; the Goals card shows the 🤖 campaign line. War council: balanced joins wars, aggressive also marks the
  foes' bases for assault; cautious never. Emergency trips (water under a day, food under two) ignore the team
  limit and cooldown, at most two such teams out, three people stay home. Claim trips while the land is short,
  wells on claims by water when water is short. In tests a 150-guard hive 20 tiles out fell by day 115–357.
- **Hardcore**: one starter is a prepper with a duffle bag (new pack): 15 food, 15 water, 2 meds, a water filter,
  flashlight, bandages, lighters, batteries, 2–3 extras, a gun with 20 rounds or a knife; the Prepper trait when a
  slot is free (background only, no in-play effect). No hand-crank radio or purification tablets: neither exists.
- **Raid bot**: leaves at Heat 40, half the squad hurt or anyone down, outnumbered in sight, or its way out growing
  two turns running. Interior raids out 16 → 23 of 24.
- **Census tooling**: `--size a,b,c` sweeps with a comparison table, deaths by season, coalition blockers at month
  12 / 24 / end, hive storm rejections, `--preset`, `--fallen-grep`, `--census` (tools/census/<date>-<commit>.json).

Open: a visible war party for the groups (they fight by the numbers the same day); a mechanical effect for the
Prepper trait; a "Force the door" action for a met survivor group (multi-storey phase 3); the eras' standing-hive
cap scaling lives in hives.js pickSite rather than eras.js.
