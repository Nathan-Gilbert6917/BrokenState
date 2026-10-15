# POIs, scouting and nomads: session prompts

Seven prompts (six sessions, with Session 4 split into 4a and 4b) build one feature set: **Points of Interest (POIs) on map tiles**, a **scouting/survey system** that reveals them, a **per-POI raid flow with threat and tile heat**, **persistent containers that AI groups can loot**, **nomad AI groups**, and an optional **multi-house Neighbourhood map**.

This file was written on 2026-10-15 after a design interview. Every decision in "Shared brief" was made by the project owner. Do not re-litigate them. If something in the code makes a decision impossible, stop and report it instead of improvising.

## How to use this file

1. Commit and push this file to the branch the session will work from. Cloud sessions clone fresh and will not see an uncommitted file.
2. Start a session and paste only that session's **launch line** (at the top of each session section).
3. Run the sessions in this order: **1, then 2 and 3 (either order), then 4a, then 4b, then 5. Session 6 any time after 3.**
4. Each session ends by appending a short **Handoff** note (actual module and function names, anything that deviated) under its own section in this file. The next session reads those notes first.

Code line numbers below come from a survey on 2026-10-15 and are approximate. Search by name.

---

# Shared brief (every session reads this first)

## Goal in one paragraph

Today a map tile is either a *site* (`tile.loc`, drawn as a sprite) or bare terrain. Loot is one scalar per tile (`tile.loot`). Scavenging picks no sub-location. Under the new design every land tile can hold 0-4 **POIs**. A tile that already has a site sprite keeps it as its **top POI** and gains extra POIs. A bare tile gets POIs of its own and, once its top POI is known, draws that POI's sprite. POIs are partly known and partly hidden. Survey missions reveal hidden ones. When you scavenge or raid a tile, a dialogue lists the known POIs with visit history, picked-over state and perceived threat. Each POI has its own loot pool, and containers persist between visits (unopened ones stay unopened, and anything you leave in an opened one stays until someone takes it). Tiles gain persistent **heat** when POIs are entered or left. AI groups and new baseless **nomad** bands survey and raid POIs too, so the world's loot decays naturally.

## Vocabulary

- **POI**: one place on a tile (house, school, gas station, cabin, shed...). Max 4 per tile, including the top POI.
- **Top POI**: the highest-value POI on a tile. Value = `richness` in `data.js LOCATIONS`; ties break deterministically by tile id then kind. On a site tile it is the existing site (`tile.loc` stays as is). On a bare tile it is derived from the POI list and **`tile.loc` is never written for it** (many modules read `tile.loc`; writing it would turn every bare tile into a site for all of them).
- **Known zone**: tiles where most POIs start known (rules below). **Unknown zone**: everything else.
- **Hidden POI**: a POI the player does not know yet. The UI never shows how many are hidden, and there may be none.
- **Container ledger**: the per-POI record of which containers were opened or looted and what the player left in them (see "Loot pools, containers and AI"). There is no separate stash list.
- **Tile heat**: a new persistent per-tile value. It is NOT Field Heat (`fieldheat.js`, a team's own value) and NOT Scavenge Heat (`scavenge.js` `state.engagement.heat` / `b.raid.heat`).

## Locked design decisions

### Where POIs exist
1. Every land tile may host POIs except: water, city/town **centre** tiles, and **hive** tiles.
2. City and town centres are always known and use only the existing block-by-block crawl (`citycrawl.js`). They get no POIs and the crawl code is not changed.
3. A **hive** tile has no POIs (the hive replaces them). If the hive is destroyed, all POIs on the tile are destroyed and the tile stays empty.
4. A **base** tile (yours or another group's) keeps all its POIs and you can still raid them. The base sprite wins on the map, and the POIs show in the tile panel. Raiding a POI on **another group's** base tile is **hostile**: their owner guards join the roster (the existing `raidEnemies` owner-guard logic), attitude drops, and a conflict can fire. POIs on your own base's tile are free to search.
5. Public sites (hospital, police, military and so on) become the top POI of their tile and gain extra POIs.

### Counts (fixed at world generation; only "stripped"/"burned out" changes in play)

The top POI counts toward the maximum of 4.

| Terrain | Bare tile | Tile with an existing site |
|---|---|---|
| Mountain | 0-1 | site + 0 |
| Hills | 0-2 | site + 0-1 |
| Forest | 0-2 | site + 0-1 |
| Farmland (`plains`) | 0-3 | site + 0-2 |
| Suburb / bare city tile | 1-4 | site + 0-3 |

Kind pools per terrain (use existing `LOCATIONS` types where they exist; every POI kind needs a `LOCATIONS` entry with `richness`, `danger`, `loot` weights and a `buildingmaps` archetype):
- Mountain: cabin, mine shack, hiker camp
- Hills: cabin, shed, farmhouse, hunting blind
- Forest: cabin, hunting blind, campsite, shed
- Farmland: farmhouse, barn, farm stand, shed
- Suburb: house, neighbourhood, school, gas station (`gas`), pizza place, corner shop, garage
- Bare city tile: the existing shop/office/garage types

**New kinds** (each needs a `LOCATIONS` entry, loot theme tags and a map sprite): house, neighbourhood, garage, corner shop, pizza place (a `diner` variant: own name, loot and sprite), farm stand, shed, hunting blind, campsite, hiker camp, mine shack. Assign `richness` on the existing scale, consistent with comparable existing types. A lone house or shed must rank below a school, gas station or farm.

### Known zone and hidden POIs
- **Known zone** = a road tile, a tile adjacent to a road, or any tile inside a city footprint (radius 3-4, existing) or a town footprint (radius 1-2, **new suburb ring** around towns). Everything else is the unknown zone.
- **Known-zone tile:** its POIs start known except **0-2 hidden ones**, chosen by seed from the **non-top** POIs. The top POI is therefore always known there, so the sprite always shows.
- **Unknown-zone bare tile:** nothing is known. The tile panel says "POIs unknown".
- **Site tiles:** the top POI (the existing site) keeps its current discovery class (`LOCATIONS[type].known`: public always known, road known on or next to a road, secret never known). Its extras follow the known/unknown-zone rules above.
- The UI **never shows a count** of hidden POIs. A known tile with a hidden remainder says "possibly more unknown".
- Scavenge/raid is gated **per POI**: the dialogue lists only known POIs. A tile with no known POI says "survey first" and the action is blocked.

### Surveys (replace the current Survey mission's behaviour)
- **Survey (full), 8 hours.** Covers the team's **own tile only**. Items with a `reach` of 1 or more in `optics.js` (binoculars, thermal imager and so on) extend it to the adjacent ring, **one ring maximum**, at x0.6 odds. Vehicles give a small bonus, not a larger ring. It makes **one roll** at the end:
  - Odds reuse the `survey.js siteOdds` multipliers (scouting skill, team size, terrain, light, weather, vehicle, stance, optics).
  - Success reveals **all** hidden POIs on the tile.
  - Failure reveals each hidden POI separately at a lower chance, and the log says "not sure you found everything".
  - It also performs the own-tile hidden-site and `tile.hidden` (`markers.js perceive`) rolls.
  - It records a **per-POI threat estimate** (see Threat) and a "surveyed Nd ago" stamp.
  - Retrying costs another 8 hours.
- **Quick look, 2 hours.** Own tile only, **even with reach items** (optics may improve the odds but never extend the range). Each hidden POI is revealed separately at about half the full-survey odds. It shows the POI **kind only, with no threat**. It stamps "looked Nd ago", never "complete". Neither survey is allowed while the team is in combat or moving.
- The old radius **Sweep** (`survey.js`, radius 2-4, 6-48 hours, finds secret sites at a distance) stays unchanged but is **renamed "Sweep area"**, so secret sites remain findable.
- Both surveys add Field Heat through new `fieldheat.js` `ACTIVITY` entries (standing still draws attention).
- Survey results are shared like site knowledge: via `p.seen` snapshots, `world.js mergeKnowledge`, radio contact and returning home. Extend `snapshot()` and the `TileSnapshot` type for this.
- Rumours and radio news do not reveal POIs in v1.

### Threat
- A **tile-level danger word** (quiet / some risk / dangerous / very dangerous, from `fieldheat.js tileDanger`/`dangerWord`) is always shown for a known tile.
- A **per-POI threat band** (word plus skulls) exists only after a full Survey **or** after you have entered that POI. It is timestamped and shown as an `intelest.js`-style estimate whose error grows with age, with a "stale" note. The dialogue shows "threat unknown" otherwise.
- True threat = base (`LOCATIONS danger` of the POI kind) + tile infection + tile heat (+ hive-land bonus). The raid itself always uses the true value (`scavenge.js raidEnemies`).

### Tile heat (Session 4)
- Persistent per tile. Entering a POI adds a small amount. Exiting adds more, scaled by approach (sneak 7 / normal 13 / loud 22, the `APPROACHES` heat values) and by shots fired (`fieldheat.js noteGunfire`). Decays about 10% a day. AI looting adds a smaller amount.
- Effective POI threat on that tile rises with heat. High heat grows the raid roster and gives a small chance of a horde or wandering group.
- Heat is shown in the tile panel, subject to the same staleness rules.

### Raid flow
- Scavenge/raid on a scouted tile opens a **POI dialogue**: for each known POI show kind, visit history ("been here Nd ago, N visits" / "never visited"), picked-over band (reuse `aiscav.js lootBand`: Rich / Some / Little / Picked clean), whether you opened containers or left items there and whether others have looted since, whether another group is raiding it right now, and perceived threat.
- Picking a POI starts the raid map for that POI's `buildingmaps` archetype. This replaces today's building picker (`b.raid.choose` / `buildingOptions`) on POI tiles. City/town centres still go to the crawl.
- The headless/abstract path (`scavenge.js` hour-by-hour search, `crewSearch`, autopilot, `autoCombat`) also works per POI: it searches **one chosen POI at a time**, and the autopilot chooses.

### Loot pools, containers and AI
- Each POI has its own pool (0-1): the share of its original loot still untouched, set at generation from its kind's `richness`. On a site tile the **top POI keeps using `tile.loot`** so every existing writer (`scavenge.js`, `aiscav.js`, `visitors.js`, `hardcore-*`) keeps working. Extras and bare-tile POIs use their own pools. **Pools never regrow.** The pool drives the picked-over band and the abstract (headless) path. Old saves generate their POI lists on load, and `tile.loot` becomes the top POI's pool.
- **Containers persist per POI. There is no stash list.** A POI's raid map is built deterministically (`buildingmaps.js` places containers with sequential ids; `search.js`/`combat.js searchBox` roll contents when searched). The rules:
  - A container the player **never opened stays unopened with its original loot** the next time they raid that POI, unless another group has looted it since.
  - Any container the player **opens has its current contents saved when the raid ends**: what is left after they take items, plus anything they deliberately leave in it or swap into it (leave 3 cans, put an item in, take another). A revisit shows exactly that. `box.hidden`/`box.quick` state and the lock state (picked, forced or unlocked) persist too.
  - Items dropped on the floor and loot on bodies are **not** persisted in v1 (still lost at raid end). A wiped team's gear still becomes a death site as today.
  - Unopened containers must be reproducible: roll each container's contents from a hash of (world seed, tile, POI, container id), not from a shared rng stream. Check how `searchBox` rolls today and refactor if it consumes a shared stream. Layout and container ids must be stable across visits.
  - Data: a per-POI ledger, for example `poi.cont = { n, looted: { containerId: byGroupId }, mine: { containerId: { contents, hidden, quick, lock } } }`. `looted` means emptied by someone (it spawns empty and the map says it was ransacked). `mine` means opened by the player's side and holds its saved current contents. Anything not in the ledger is fresh.
- **Abstract looting uses the same ledger.** AI groups, visitor raiders, nomads, hardcore bands and the player's own headless crews raid POIs through one function. A raid that takes value V marks containers looted in a deterministic seeded order until V is covered, lowers the pool, and can also take items the player left in `mine` containers (they count like any other loot, so left items are at risk). The pool and the ledger must stay consistent. Player-left items never raise the picked-over band.
- **AI groups survey and raid just like the player.** AI groups with bases, visitor raiders, hardcore bands and nomads each keep their own POI knowledge. They know known-zone POIs in range automatically (bases 10 tiles; nomads 3 tiles around camp; visitor raiders along their path). They must **survey** to learn hidden POIs and unknown-zone tiles: a survey stop at the tile before the raid, using the same odds model with their own scouting skill, and a need-weighted choice of target (the existing loot-table x need scoring in `aiscav.js bestSite`, now per POI). Their activity makes pools fall naturally. Tune so that on-road, near-base POIs are mostly picked over by years 2-4, unknown-zone/off-road POIs stay richer into mid-game, and no world has every pool at zero by year 2.
- **Same-tile meetings:** if the player's team and an AI party are both raiding a tile, both show on the map, **drawn on opposite sides of the hex**. Raiding **different** POIs on one tile: no conflict, they coexist and both add tile heat. Raiding the **same** POI: the existing `contest()` conflict card fires. A group at war with you uses the existing conflict flow. The dialogue marks a POI "being raided now" when another group is on it.
- AI raids add tile heat. News/log lines say when a POI was stripped.
- **Hardcore start:** apply the `hardcore-loot.js` start multiplier (sites half looted) to every POI pool. Hardcore bands use the same POI picker and ledger.

### Sprites and panel
- Every new POI kind gets a map sprite. Only the **top** POI is drawn on the map. Where a matching painter exists (farm, barn, cabin, school, gas, diner...) reuse it.
- Low-value POIs still get a sprite, since the top POI of a tile may be a house or shed. Keep the existing 24-28 px pixel-art style and zone plate.
- The base sprite wins over POI sprites. The tile panel heading shows the top POI's name once it is known. A small pip shows the number of known POIs at zoom >= 0.7. A new bit in `render.js G.siteCode` invalidates the map cache.
- **Several groups on one tile:** when two or more parties share a tile (your team and an AI raiding party, for example), draw them offset to **opposite sides** of the hex instead of overlapping, and keep both clickable.

### Nomads (Session 5)
- Baseless AI bands that camp, raid and move on. Their goal is to survive, not to grow. They live in a **new module modelled on `visitors.js`** (private `Rng`, group-shaped `outsider` fields so `trade.js` can read them) and are **not** in `state.factions`.
- **Lifecycle:** persistent. They move every 2-5 days: camp, raid a nearby POI (or a site with loot), break camp. They can starve or be killed. A slow respawn holds the count at about half the AI group count for the world size. They raid POIs first and sites second.
- **Tiers** (size caps keep them small, agile and strong):
  - **T1 Looters:** 3-6 people. Melee and a few pistols, no armour, they flee fights. Agile, weak in guns.
  - **T2 Survivalists:** 4-8 people. Good survival skills (forage, hunt, medicine), a few real firearms, light armour.
  - **T3 Preppers:** 5-10 people. Adequate skills all round, solid weapons, armour AC 3 or above, the best vehicles.
  - A band's tier is fixed for life. Unlock by era: T1 from the start, T2 from year 2, T3 from year 4.
- **Recruiting:** from neutral wanderers and refugees only, when they have supplies, up to the tier's size cap. They prefer to stay small.
- **Player interaction:** an encounter card when on the same tile. Camps appear as map markers once spotted. Attitudes: T1 hostile, T2 neutral and willing to trade, T3 neutral and defensive. All can trade via the `outsider` fields. They do **not** join diplomacy, pacts, blocs or the Coalition. You can attack a camp you have spotted. No recruiting from them in v1.
- **Nomads never count toward the Calder Coalition victory** (no land claims, no bases, never in the alliance's land share).

## Code facts (from the 2026-10-15 survey)

Root `/home/user/BrokenState`, sim in `prototype/src/sim`, UI in `prototype/src/ui`. There is no `CONTEXT.md` and no `docs/adr/`. `docs/agents/features.md` is the feature map and must be updated when you add a major system.

- **Tile record** (`mapgen.js generateMap` ~103-123, `types.d.ts` `Tile`/`TileLoc`): `{ id, x, y, elev, terrain, road, roadLinks[], river, bridge, loc, loot, infection, owner, hive }` plus `hidden`, `ruin`, `infBase`, `lootNormal`, `foodStock`, `crawlMem`. `state.tiles` is a flat array, tile id = `y*width+x`, odd-r hex layout (`hex.js HexGrid`: `neighbors`, `distance`, `within`).
- **Terrain keys** (`data.js TERRAIN`): `water`, `plains` (shown as "Farmland"), `forest`, `hills`, `mountain`, `suburb`, `city`. Suburbs exist only inside city footprints today (`mapgen.js addCity` ~191). Towns have a `town` centre tile plus police and autoshop at distance 1, 0-2 `TOWN_EXTRAS` (~line 67) and 1-2 `TOWN_SATELLITES` at distance 2-3 (~line 68).
- **Sites:** `tile.loc = { type, name, zone, settlement? }` via `placeLoc` (`mapgen.js` ~155). At most one site per tile (`buildable()` requires `!t.loc`). `LOCATIONS` (`data.js` ~456) has name, glyph, cat, `danger` 0-3, `loot` weights, `gear`, `richness`, `known`. `SITE_ZONES` at ~511.
- **Existing sub-location precedents:** `buildingmaps.js` `SITES` (~638) and `BUILDINGS` (~579, about 45 archetypes: house, farmhouse, cabin, shop, gasstation, diner, school...), `siteBuildings(tile)` (~656), `buildingOptions(tile)` (~684). `citycrawl.js` `tile.crawlMem` has `looted` and `aiLoot` (city and town only).
- **Loot:** `tile.loot` scalar set in `placeLoc` (`richness x ZONE_RICHNESS x rng 0.7-1.2`). Depletion writers: `scavenge.js` (~264 hour search, ~157 `afterRaid`), `citycrawl.js` ~820, `aiscav.js` ~186/272, `visitors.js` ~1118, `hardcore-groups.js` ~583. `depletetest.js` asserts only allowed files assign `.loot`. Picked-over bands: `aiscav.js siteFull`, `lootBand`, `LOOT_BANDS`. `parties.js` `PICKED_OVER = 0.05`, `scavengeable(t)` is true for any `t.loc`.
- **Scavenge entry:** `scavenge.js startScavenge` (~101) has three branches: city/town crawl, interactive raid (`startCombat({mode:"raid", handler:"scavenge", plan:true, raid:{heat0, choose:true}})`), and the abstract hour-by-hour search (`state.engagement`, `searchHour`, `extract`, `APPROACHES`). `raidEnemies` (~59) builds the roster. `raidloot.js` header says leftover loot on the map is currently lost at raid end. `raidplan.js` has entry side, scout, wait for night.
- **Containers and raid loot:** `buildingmaps.js` (~1103-1265) builds `containers` with sequential `cid` ids per map (kind, area, floor, `lockKind`). `search.js` rolls contents when searched (`box.contents`, `box.hidden` for the 50-70% a quick rummage leaves hidden, `box.quick`). `raidloot.js` moves items between `rbox:<containerId>` and survivors by hand, and says whatever is left on the map at raid end is lost. Check whether container contents come from a shared rng stream before relying on determinism.
- **Heat today:** Scavenge Heat is ephemeral per search/raid (`HEAT_STAGES` ~46). Field Heat is `party.heat`/`p.heatTile` (`fieldheat.js`, `ACTIVITY` ~55, `tileDanger` ~322, `dangerWord` ~342). `state.gunfire` is the nearest persistent per-tile noise record. **No per-tile heat exists.**
- **Discovery:** `discovery.js` `isPublicSite`, `hiddenSites`, `siteKnown`, `state.knowledge[tile]` snapshots, `world.js mergeKnowledge` (~889), `snapshot()` (~827, `TileSnapshot` has no open index signature). `survey.js`: `MISSIONS.sweep` labelled "Survey", `SURVEY` constants (~60), `sweepRoute`, `siteOdds` (~198), `startSweep`/`sweepHour`. `optics.js opticsFor`/`OPTICS`. `markers.js perceive`, `MARKER_TYPES`, `LAYERS.pois`.
- **UI:** tile panel `ui/ui.js renderRight` (~587), `tileActions` (~541, "Scavenge / raid" ~566), search modal (~814, ~1314). Tooltip `render.js tileTooltip` (~2272). Site sprites: `render.js` `siteDesc`/`drawSite`, `ui/mapsprites.js poiSpriteCanvas` (~2493) and `POI_PAINT` (~1543), one painter per `LOCATIONS` type. `ui/terraindeco.js` draws decals (houses, cars) on suburb/city tiles.
- **AI groups:** `state.factions` entries need `{id, name, type, color, bases[], pop, stock, ...}` and `type` keys in `data.js FACTION_TYPES`, `groupcare.js GROUP_PRIORITIES`, `arsenal.js KIT_OF`. Most consumers assume a base (`aiscav.js:178` skips `!f.bases.length`). Baseless precedents: `visitors.js` (`state.visitors`, own `Rng`, `outsider:true`, `bases:[]`, `settleBands`), `wanderers.js`, `hardcore-groups.js` bands. `aiscav.js` `bestSite`, `workable`, `spawnAiParty` kind "scav", `contest()`. World group counts: `worldsize.js WORLD_SIZES` (small 3-6, normal 5-10, large 7-14, huge 10-18).
- **Tier precedents:** `escorts.js` tiers light/armed/armoured, `combat.js KITS` (~770), `arsenal.js starterKit`/`KIT_OF`, `eras.js` year tiers, `armour.js` AC 1-6, `data-guns.js GUN_RARITY`.
- **Save:** `save.js` serializes the whole state generically. New fields on tiles/state save automatically. Features do **not** bump `SAVE_VERSION`. Instead `deserializeState` fills missing markers lazily and each module uses an `ensureX(state)` initializer. Tests: `tools/savetest.js`, `savecorpustest.js`, `loadtest.js`, `dettest.js`.
- **Tests:** `prototype/package.json` scripts: `start`, `simtest`, `typecheck`. There is no aggregate runner. About 280 standalone `node tools/<name>.js` scripts. Relevant ones: `simtest.js`, `depletetest.js`, `discoverytest.js`, `surveytest.js`, `wanderertest.js`, `visitortest.js`, `loottest.js`, `maptest.js`, `dettest.js`, `savetest.js`, `savecorpustest.js`, `citycrawltest.js`, `arsenaltest.js`, `forecasttest.js`, `hardcoresmoke.js`. `tools/typechecktest.js` runs the type check. `discoverytest` asserts every `LOCATIONS` type has a discovery rule. `loottest` asserts everything a site can hold shares a theme tag. See `prototype/README.md` for descriptions.

## Conventions for every session

- **Determinism:** sim dice come from `hash01(state.seed, ...)` or a private `Rng`. **Never consume `state.rng` in new code paths that run in existing worlds**, or existing seeds shift. Run `dettest.js`.
- **Headless:** tools run without `window`. Interactive paths must be skipped there, and the abstract path must work without UI.
- **Saves:** no `SAVE_VERSION` bump. Add lazy `ensureX(state)` initializers. Old saves must still load (`savecorpustest.js`).
- **Tests:** add a standalone `prototype/tools/<name>test.js` per session (names suggested below), describe it in `prototype/README.md`, and run the existing tests that the session touches.
- **Docs:** update `docs/agents/features.md` (add or amend the relevant feature bullets and module names), `ui/codex.js`/`help.js` text where the player sees the feature, and the README tools list.
- **Balance:** this file gives ranges, not final numbers. Tune with headless `tools/simtest.js` runs and say what you tuned.
- **Style:** match the surrounding code's comment density, naming and idiom. Each new module gets a header comment in the same style as its neighbours.
- **Scope:** do only your session. Do not open a pull request unless asked. Commit with a clear message on your session's branch and push.
- **Handoff:** at the end, append a "Handoff" subsection under your session heading in this file with the real exported names, any deviations, and open issues.

## Suggested shared interface (Session 1 fixes the real names)

`pois.js` should export roughly: `poiKinds`, `ensurePois(state)`, `poisOf(tile)`, `topPoi(tile)`, `inKnownZone(state, tile)`, `poiKnown(state, tile, i)`, `revealPois(state, team, tile, {chance, all})`, `poiPool(tile, i)`, `poiTake(tile, i, amount)`, `poiLedger(tile, i)`, `poiThreat(state, tile, i)`, `tileHeat(state, tile)` (returns 0 until Session 4), `addTileHeat(state, tile, amount)`. Later sessions import these, so keep them stable and documented in the Handoff.

---

# Session 1: POI foundation

**Launch line:** `Read docs/prompts/poi-and-nomads.md. Do Session 1 only (POI foundation). Follow the Shared brief exactly.`

**Depends on:** nothing.

**Goal:** the data model, generation, known/hidden rules, the town suburb ring, new POI kinds, pool routing and save compatibility. No new UI beyond what tests and the dev "reveal map" tool need.

**Deliverables**
1. **`prototype/src/sim/pois.js`** (new). Deterministic generation per tile from the world seed and tile id (hash dice, not `state.rng`):
   - Eligibility: land tiles only, excluding city/town centres, hive tiles and water.
   - Count by the table in the brief. Kinds drawn from the per-terrain pools. The top POI is the highest `richness`, ties broken by tile id then kind.
   - Site tiles: the existing `tile.loc` is the top POI and extras are added. Bare tiles: the list is stored, `tile.loc` is left alone.
   - Hidden flags per the known-zone rules: 0-2 hidden chosen from the non-top POIs in the known zone, all hidden in the unknown zone, and the top POI of a site follows `discovery.js` class rules.
   - Per-POI persisted fields: `kind`, `hidden`, `pool`, `visits`, `lastDay`, `cont` (container ledger, empty until Session 4a), `threatStamp`, `stripped`. Choose either "regenerate list from seed plus a stored overlay of changes" or "store the full array". Either way generation must be deterministic and compact, and old saves must load.
2. **Pool routing helpers** `poiPool`/`poiTake`: on a site tile the top POI maps to `tile.loot`, so every existing depletion writer keeps working. Other POIs have their own pool, seeded from `richness`. Update the allow-list in `depletetest.js`.
3. **Town suburb ring** in `mapgen.js`: convert land tiles within radius 1-2 of a town centre to `suburb` terrain (not water, rivers or existing sites' terrain constraints; town police/autoshop/satellites still place correctly). Infection for these tiles follows the existing suburb rule. Do not consume `state.rng` differently for existing generation steps, so use a hash-based radius per town. Verify with `maptest.js` and `dettest.js`.
4. **New `LOCATIONS` kinds** (list in the brief) with `richness`, `danger`, `loot` weights, `gear`, `known`, and the keyed tables the tests require (`SITES` in `buildingmaps.js`, `SITE_TAGS` in `loot.js`, `SHOP_FOOD`, `PLACE_POOL`, `URBAN_SHORT` where relevant). Map each kind to an existing or new `buildingmaps.js` archetype. Pizza place reuses the diner archetype with its own name, loot and food. House, shed, hunting blind, campsite, hiker camp, mine shack and farm stand need archetypes or reuse of `house`/`cabin`/`shed`-like ones. Say which in the Handoff. Do not paint sprites (Session 2), but make `poiSpriteCanvas` fall back safely to a generic glyph if a kind has no painter yet, so nothing crashes.
5. **Hive and base rules:** a hive tile holds no POIs. When a hive is destroyed (`hives.js`) clear the tile's POIs. Base tiles keep their POIs.
6. **Knowledge:** extend `world.js snapshot()` and `types.d.ts` `TileSnapshot` with the tile's known POI indices/kinds and a `surveyed`/`looked` day stamp, so the shared-knowledge path carries them. Add `poiKnown(state, tile, i)` that respects knowledge, class rules and the dev reveal.
7. **Dev tool:** make the existing "reveal the map" dev tool reveal all POIs.
8. **Old saves:** `ensurePois(state)` runs from `deserializeState` and `createWorld`. A loaded old save gets lists generated from its seed, with `tile.loot` as the top POI's pool.
9. **`tools/poitest.js`:** asserts determinism (same seed gives identical lists, a different seed differs), counts within the table for every terrain, the top POI is the max-richness POI, hive/centre/water tiles hold none, hidden counts follow the zone rules, no `tile.loc` is written on bare tiles, pool routing equals `tile.loot` for site tops, and the town ring is radius 1-2 and valid. Add a `savecorpustest.js` run.

**Acceptance:** `poitest.js`, `maptest.js`, `dettest.js`, `savetest.js`, `savecorpustest.js`, `discoverytest.js`, `loottest.js`, `depletetest.js` and `typechecktest.js` all pass. A 3-year `simtest.js` run on all four world sizes ends without errors.

**Non-goals:** sprites, panel text, surveys, the dialogue, heat, AI use of POIs, nomads.

**Handoff notes:** (Session 1, 2026-10-15, branch `claude/poi-nomads-prompts`, commits `f0bb58f` POI foundation and the docs/test-fix commit after it)

*Module:* `prototype/src/sim/pois.js` (`// @ts-check`; imports `data.js`, `skills.js hash01`, `discovery.js`, `world.js localId` only). Tests: `prototype/tools/poitest.js` (`node tools/poitest.js [seed] [--nocorpus]`, ~1 min with the corpus run).

*Data model (full array on the tile, `tile.pois`, top POI first):* each POI is `{ kind, hidden, pool, visits, lastDay, cont, threatStamp, stripped, site? }`. `kind` is a `LOCATIONS` key; `hidden` is the pre-war class (never flipped: knowledge is separate, see below); `pool` is 0–1 for extras and bare-tile POIs, `null` for the site POI (it uses `tile.loot`); `visits` 0, `lastDay` null, `cont` null (made by `poiLedger`), `threatStamp` null, `stripped` false at generation; `site: true` only on index 0 of a tile with a permanent `tile.loc`. Temporary sites (`LOCATIONS[type].temp`: wrecks, drops, convoys; `loc.crash` / `loc.convoy`) are **not** POIs: a tile under one keeps its own list, generated as a bare tile. A hive tile's list is `[]` (`newHive` and `destroyHive` in `hives.js` call `clearPois`), a city/town centre's and water's too. **Saves:** `save.js serializeState` strips the lists and writes `state.poiMods` (only POIs that differ from their generated defaults, plus whole lists for tiles whose length changed, e.g. cleared by a hive); `deserializeState` → `ensurePois` regenerates and overlays. So later sessions can mutate POI objects directly (`poi.visits++`, `poi.cont.mine[...] = ...`) and the change is saved; POI fields must stay plain data (objects, arrays, numbers, strings; Maps/Sets are compared too, class instances are not). Pre-POI saves get the seed's lists on load (corpus passes). Save size is unchanged by POIs that have not been touched (Normal ~102 KB gz).

*Exported API (stable names; `tile` may be a `Tile` object or a tile id wherever `state` is also passed):*
- `POI` constants `{ MAX: 4, HIDDEN_MAX: 2, STRIPPED: 0.03, POOL: [0.7, 1.2], CITY_R: [4, 3], TOWN_R: 2, URBAN_RICH: 1.15 }`; `POI_KINDS` (terrain → kinds), `COUNTS` (terrain → `[bareMin, bareMax, extrasMin, extrasMax]`), `poiKinds(terrain) → string[]`, `allPoiKinds() → string[]`.
- `poiEligible(state, tile) → boolean`; `inKnownZone(state, tile) → boolean` (memoised per tiles array: road or next to a road, `city`/`suburb` terrain, within 4 of `cityIds[0]` / 3 of other cities, within 2 of a `town` loc); `permanentSite(tile) → boolean`.
- `generatePois(state, tile) → Poi[]` (pure, hash dice); `ensurePois(state)` (idempotent; also makes `state.poiKnow = {}` and applies/deletes `state.poiMods`); `clearPois(tile)`; `packPois(state) → mods`; `withPoisPacked(state, fn)` (save.js only).
- `poisOf(tile) → Poi[]` (`[]` on a hive), `topPoi(tile) → Poi | null` (index 0), `poiAt(tile, i)`, `isSitePoi(tile, i)` (i === 0 and the site), `poiDef(poi) → LOCATIONS entry`, `poiName(tile, i)` (the site's own name for the site POI, else the kind's name).
- `poiPool(tile, i) → number` (site POI: `tile.loot`), `poiTake(tile, i, amount) → taken` (never below 0; sets `stripped` at ≤ `POI.STRIPPED`; writes `tile.loot` for the site POI, `pois.js` is in `depletetest`'s allow-list), `poiLedger(tile, i) → { n, looted: {}, mine: {} }` (made on first call).
- `poiThreat(state, tile, i) → number` = `LOCATIONS[kind].danger + tile.infection + tileHeat(state, tile)` (no hive-land bonus yet: Session 3); `tileHeat(state, tile) → 0`, `addTileHeat(state, tile, amount) → 0` (stubs for Session 4a; keep the signatures).
- Knowledge: `poiKnown(state, tile, i)` (hub's map; the site POI goes by `discovery.js siteKnown`; non-hidden → true; hidden → `state.poiKnow[tileId].idx` includes i; dev reveal or `state.timelapse` → true), `poiKnownTo(state, tile, i, party)` (also the team's own finds in `party.poiFinds`), `knownPois(state, tile, party?) → number[]`, `morePoisHidden(state, tile, party?) → boolean` ("possibly more unknown"; never a count), `poiKnowledge(state, tileId, make?) → { idx: number[], surveyed?: day, looked?: day } | null`.
- `revealPois(state, team, tile, { chance = 1, all = false, stamp = null }) → number[]` of indices found now: each hidden, not-yet-known non-site POI rolls `hash01(seed, "poifind", tileId, i, hour, localId(team.id) | "hub")` < chance (`all` finds every one); `stamp: "surveyed" | "looked"` records the day (1-based). With a player team the finds go to `team.poiFinds` (Map tileId → `{ idx, surveyed?, looked? }`) and reach the hub in `world.js mergeKnowledge` (→ `mergePoiFinds(state, party)`); with `team = null` straight into `state.poiKnow`. `learnPois(state, tileId, rec)` merges a record or a snapshot (`{ pois: [{i}] }`, stamps only move forward).
- `poiSnapshot(state, tileId) → { pois: [{ i, kind }], surveyed?, looked? } | null`: spread into `world.js snapshot()` (so `TileSnapshot.pois / surveyed / looked` exist on tiles with POIs); `mergeKnowledge` calls `learnPois` for a snapshot carrying `pois`.
- `setPoiReveal(on)` / `poiRevealed()`: the dev tools' Reveal map (wired in `main.js` "dev-reveal", `render.js resetView`, `display.js`).

*Generation rules as implemented:* counts uniform in the table's range (`hash01(seed, "poin", id)`); kinds uniform from the terrain pool (`"poikind"`), a kind repeats on one tile only if in `REPEATABLE` (house, shed, cabin, garage, corner, campsite); on a site tile the pool is filtered to kinds with richness ≤ the site's (all kinds when none qualify), so the site is always the richest; bare tiles sorted richness desc, ties by `hash01("poitie", id, kind)`; pools `richness × U(0.7, 1.2)` (`× 1.15` on `city` terrain), capped at 1. Hidden: known zone → `h ∈ {0, 1, 2}` (uniform, capped by the number of non-top POIs) picked from the non-top; unknown zone → every non-top hidden and a bare tile's top too; the site POI's `hidden = !isPublicSite`. Pools per terrain: mountain cabin / mineshack / hikercamp; hills cabin / shed / farm / blind; forest cabin / blind / campsite / shed; plains farm / barn / farmstand / shed; suburb house / neighbourhood / school / gas / pizza / corner / garage; bare city block office / apartments / corner / garage / pharmacy. Seed 42 Normal: 3039 POIs on 1763 of 2688 tiles.

*New `LOCATIONS` kinds* (`data.js`, each with `SITE_TAGS` in `loot.js`, `AREA_SETS` in `combat.js`, `SIZES.SITE` in `battlesize.js`, `SITE_MIX` in `foods.js`; `SHOP_FOOD` and `itemcond.js SITE_SOURCE` where they are shops or homes): `house` 0.3, `neighbourhood` 0.55, `garage` 0.3, `corner` ("Corner shop") 0.45, `pizza` ("Pizza place") 0.4, `farmstand` 0.3, `shed` 0.2, `blind` ("Hunting blind") 0.15, `campsite` 0.25, `hikercamp` 0.2, `mineshack` 0.3 (richness). Archetypes (`buildingmaps.js SITES`): house → `house`; neighbourhood → `house` (Session 6 replaces it); garage → `garage`; corner → `corner`; pizza → `["diner", "Pizza place"]`; farmstand → `["corner", "Farm stand"]`; shed → `["machineshed", "Shed"]`; mineshack → `["cabin", "Mine shack"]`; blind, campsite and hikercamp have **no building** (the open street map with `AREA_SETS` campsite/cabin areas). Note `farm` (an existing kind in the hills and farmland pools) keeps its two-building choice (`farmhouse`, `barn`): Session 3's dialogue should pick one (farmhouse) or still offer the pair. `PLACE_POOL` and `URBAN_SHORT` were left alone (the crawl is unchanged and the map never places these as sites). `ui/mapsprites.js poiSpriteCanvas` falls back to a new plain-building painter (`paintGenericPoi`) for any kind without a `POI_PAINT` entry.

*Town suburb ring* (`mapgen.js`, end of `generateMap`): radius `1 + (hash01(seed, "townring", townId) < 0.5 ? 0 : 1)`, every tile at distance 1..r that is not water, a river, mountain or a `rural`-zone site becomes `suburb` (+0.06 infection, bare tiles' loot at least 0.3). Laid last so every earlier draw is unchanged (dettest/maptest pass; existing seeds keep their sites, roads, hives). `createWorld` passes `seed` to `generateMap` for this. Side effects to know: tiles round towns now read as suburbs everywhere (`fieldheat` place ×1.4, wood "little", foraging 0.3, hunting 0.12, `terraindeco` house decals, `TERRAIN.traffic` 0.12); `depletetest`'s panel-leak regex tripped on "Wood little" and was narrowed to the loot words.

*Deviations / notes:* no `help.js`/codex text yet (nothing player-visible until Session 2). `tile.pois` property order on a live tile moves to the end after a save (delete/restore in `withPoisPacked`); harmless. `ensurePois` runs in `createWorld` right after the state object exists (before the hardcore branch) and in `deserializeState` after the migrations. `hardcore-loot.js`'s start multiplier is not applied to extra pools yet (Session 4b). Old saves whose hive was destroyed before POIs existed get a list on that tile (nothing records the old hive).

*Tests run:* `poitest.js` (1999 passed, with the corpus run), `maptest.js 10` (all sizes, passed), `savetest.js 40 42` (60 passed), `savecorpustest.js` (131 passed), `discoverytest.js 42 30 1` (167 passed), `loottest.js --quiet` (61 passed), `depletetest.js 42 365 1,2` (75 of 76 passed: the only miss is the day-365 floor on that 2-seed curve, "31% left, at least 25% with two standard errors (23%)", which is seed noise: the base commit on the same two seeds leaves 31.6% / 33.1%, this branch 27.2% / 35.5%, the same mean, and day 120 / 240 match; the default 12-seed run narrows the error, the coordinator may run it), `typechecktest.js` (78 passed), `dettest.js 30 42` (5 passed), `simtest.js 365 42 8` and `simtest.js 200 42 8 size=huge` (both ran clean).

---

# Session 2: POI sprites and read-only panel

**Launch line:** `Read docs/prompts/poi-and-nomads.md and the Session 1 Handoff. Do Session 2 only (POI sprites and panel). Follow the Shared brief exactly.`

**Depends on:** Session 1.

**Goal:** make POIs visible. Every POI kind has a sprite, the top POI draws on bare tiles once known, and the tile panel shows what the player knows.

**Deliverables**
1. **Painters** in `ui/mapsprites.js` for every POI kind that has none: house, neighbourhood, garage, corner shop, pizza place, farm stand, shed, hunting blind, campsite, hiker camp, mine shack, and any other kind Session 1 added without one. Reuse existing painters for existing kinds. Match `POI_PAINT`/`poiSpriteCanvas` conventions, size and the zone plate. Use a recognisable silhouette per kind. A lone house or shed must still read clearly at low zoom.
2. **Bare-tile top POI sprite:** in `render.js` (`siteDesc`/`drawSite`, `G.sites`), draw the top POI of a bare tile when it is known. It is a derived draw, not a `tile.loc`. Use the loot-band fade (`fade()`) from the POI pool. The base sprite wins. Add a bit to `G.siteCode` so the cache redraws when POI knowledge or pool band changes. Keep the zoom < 0.7 dot behaviour. Keep map performance on Huge worlds.
3. **Tile panel** (`ui/ui.js renderRight`): for a bare tile, the heading shows the top POI name once known, otherwise the terrain name. Add a POI block:
   - Unknown-zone and nothing known: "POIs unknown".
   - Known POIs listed by name with picked-over band. No threat yet (Session 3).
   - If anything may remain hidden: "possibly more unknown". Never show a count.
   - Site tiles list the extras under the existing site info.
4. **Tooltip** (`render.js tileTooltip`) and the **Sites layer** (`markers.js LAYERS.pois`, minimap) include POI sprites where sensible. Update `help.js` text and the Codex.
5. **Count pip:** a small pip for the number of known POIs at zoom >= 0.7.
6. **Several groups on one tile:** find where team and party markers are drawn in `render.js`/`ui` and make two or more parties on one tile draw on opposite sides of the hex, both clickable. Session 4b relies on this.
7. **Visual check:** use Chromium/Playwright (installed at `/opt/pw-browsers/chromium`, do not run `playwright install`) to screenshot the map at several zooms and a panel with each kind. Put screenshots in the session scratchpad and describe what you saw in the Handoff.
8. **Test:** extend `maptest.js` or add `tools/poispritetest.js` asserting every POI kind has a painter and that painting does not throw headlessly or in a stub canvas.

**Acceptance:** painter coverage test passes. `typechecktest.js` and `dettest.js` pass. Screenshots reviewed.

**Non-goals:** surveys, the dialogue, threat, heat.

**Handoff notes:** (Session 2, 2026-10-15, worktree branch `worktree-agent-a97d6981afb6cec4e`, commits listed in the session report)

*Sprites (`prototype/src/ui/mapsprites.js`):* eleven new painters in a "points of interest" block before `POI_PAINT`: `paintHouse`, `paintNeighbourhood`, `paintGarage`, `paintCorner`, `paintPizza` (20 × 17, the town shops' size) and `paintFarmstand`, `paintShed`, `paintBlind`, `paintCampsite`, `paintHikercamp`, `paintMineshack` (18 × 15, the farms' and cabins' size), registered in `POI_PAINT` under their `LOCATIONS` keys. Existing kinds in the pools (cabin, farm, barn, school, gas, office, apartments, pharmacy…) keep their painters. `paintGenericPoi` stays as the fallback for a kind without one. `poiSpriteCanvas(type, variant, faded)` is unchanged (faded = the loot band 0–3).

*Map (`prototype/src/ui/render.js`):* `G.sites` now also holds every tile with a POI list (`poisOf(t).length`), so a bare tile can be drawn as a site. In `scanTiles`'s site loop a bare tile (no `tile.loc`, not a base, not a ruin) whose top POI the hub knows (`poiKnown(state, t, 0)`) gets code `3 | 64 | busy 4 | fade 8 | band << 4`: **bit 64 marks "a POI, not a tile.loc"**, bits 4–5 the loot band from `poiLootBand` (the live pool, or the snapshot's `pois[].pool` when out of view, 0 when never seen, as sites do), and **bits 8–11 the number of POIs known on the tile** for every kind-3 code (sites too), so a change of knowledge or band redraws the chunk. `siteLocOf(t, code)` gives the site loop's "loc": `t.loc`, or for bit 64 `{ type: kind, name, zone: LOCATIONS[kind].cat, poi: true }`; `siteDesc` keeps it as `d.loc`, `siteLook(loc, …)` takes a loc instead of a tile, the labels loop names a POI tile by `loc.name` and skulls it by `siteDanger(loc)`. A hive tile's list is `[]` (code 0); a temporary site over a POI tile (crash, convoy) hides the POI sprite while it lasts. Zoom < 0.7 keeps the dot. The base sprite wins (`ownBase` / a group base tile never takes the POI branch). **Pip:** `d.pip` (2 and up, zoom ≥ 0.7 only) drawn by `poiPip` in `drawSite` at the sprite's top right (a dark disc with the count); a tile with one known place shows no pip, since the sprite is that place (deviation: the brief says "the number of known POIs", a "1" on every existing site would be noise). A POI tile's name label has priority 2.5 (after the sites' 2), so where the two would overlap the site's name wins (`discoverytest` caught a farm's name hidden by a neighbouring POI's). `tileTooltip`: a bare tile with a known top POI is headed by its name with a kind · zone · terrain line and a danger line; every tile gets `poiTipLines`. **Several parties on one tile:** `countCrowd(state, live)` counts the parties drawn per tile each frame (`tileCrowd`); `besideBase` (every party drawer already goes through it) puts two or more on a tile without a base at `px ∓ 13·o` (first left, second right, third and fourth 9·o below) at 90% size; a lone party stays centred; base tiles keep the old "beside the base" rule. Picking is by tile (`ui/mapselect.js picksAt`), so both stay clickable (the "On this tile" chips).

*Panel and text (`prototype/src/ui/poiview.js`, new; `ui.js renderRight`):* `poiView(state, id, isLive, snap)` → `{ rows: [{ i, kind, name, site, band (0–3 | null = never seen), then }], more, unknown, empty, surveyed, looked, hasSite }` or null for a tile that can hold none; `poiHeading(state, id)` (a bare tile's known top POI name, else null); `poiTopLoc(state, id)` (that POI as a `{ type, name, zone, poi }` for `siteDanger` / `SITE_ZONES`); `poiPanelRows(state, id, isLive, snap)` (the `.kv` cells of the panel's **Places** section: one row per known non-site POI with its band "rich · (last seen)" / "not seen yet", "POIs unknown. Survey the tile to find what stands here." in the unknown zone with nothing known, "Nothing of note here as far as you know." in the known zone with nothing known, "Nothing besides the site." on a site tile without extras, "Possibly more unknown. A survey here may find them." with a hidden remainder, and a Surveyed row from the `poiKnowledge` stamps); `poiTipLines(state, id, isLive, snap)` (the hover text's "Places: House (rich), Shed" / "Also here: …" line and the unknown / possibly-more line). The wording leaks only the zone (which the map shows), never a count. `renderRight`: the heading is `loc.name`, else the top POI's name, else the terrain; the zone · danger · likely line uses `sloc = loc || poiTopLoc`; the Places section sits after Land. The panel's existing Loot row (the tile's `tile.loot` band) was left alone.

*`pois.js` additions (small, at the end of the pools block and in `poiSnapshot`):* `poiLootBand(t, i, pool = poiPool(t, i)) → 0–3` (the thresholds of `aiscav.js lootBand`; the site POI measured as its site, `richness × ZONE_RICHNESS[zone]`, imported from `mapgen.js`; an extra by `richness × (city ? POI.URBAN_RICH : 1)`); `poiSnapshot` entries now carry `pool` (`{ i, kind, pool }`, `TileSnapshot.pois[].pool?` in `types.d.ts`), so an out-of-view tile's band is the one last seen. `learnPois` ignores the extra field.

*Other UI:* `markers.js LAYERS.pois.desc` mentions the places; `help.js` `LAYER_HELP.pois` and the legend's Sites line describe the POI sprites, the pip and the Places rows; `codex.js` has a new **Places** category (`CODEX_CATS` "places"): `k:pois` (how places work) and `p:<kind>` for every `allPoiKinds()` kind with its map sprite (`poiSpriteCanvas`), danger, likely loot, gear and worth; `seenNow` opens a kind once a known POI of it stands on a live or reported tile (`knownPois` over `state.tiles`, once an hour with the rest of the scan).

*Test:* `prototype/tools/poispritetest.js [seed]` (102 checks, a few seconds; described in the README): painters headless and on a stub canvas (own painter per kind and per `LOCATIONS` type, sizes, fading), `poiLootBand`, the real renderer on a stub context (a known-zone top POI named; an unknown-zone one not until `revealPois`, then named; a label that overlaps a higher-priority one is skipped as before, so the test picks a tile with no site, base or known place within 2 tiles), the panel / hover text wording and the no-count rule, the site tile's extras, the dev reveal, and two teams left / right of the hex (one alone centred).

*Visual check (Chromium 1194 through Playwright, default new-run seed, screenshots in the session scratchpad `session2/`):* `sprites-sheet.png` (every new kind next to cabin / gas / diner / farm / barn / school through a stub canvas: the same pixel scale and plate feel), `map-hub-zoom0.55` (POI tiles are dots along the roads like minor sites), `map-hub-zoom1` and `map-suburb-zoom1` (sprites with pips "2"/"3" on the suburb ring and along the roads), `map-hub-zoom2.2`, `map-suburb-zoom2` (names, skulls, pips; Hunting blind, Campsite, Hiker camp, Cabin on bare tiles next to the hub's town), `map-unknown-zone-zoom2.2` (a forest tile with nothing shown), `panel-<kind>` for 18 kinds (heading = the kind, zone · danger · likely line, Places rows), `panel-unknown-zone` ("POIs unknown…"), `panel-site-with-extras` (a site's extras listed), `tooltip-poi` ("House · small town · Suburbs · off-road / Danger: moderate / Places: House / No current intel"), `map-two-teams-one-tile` (two teams on the Auto shop tile, left and right of the hex centre, both in the "On this tile" chips), `map-dev-reveal-zoom1.2` / `-0.75` (every POI shown), `codex-places` (the Places category, 10 of 20 opened on day 1). No page errors apart from a 404 for a missing static file unrelated to this work. Map performance: the per-frame site loop now covers ~1 760 of 2 688 tiles on Normal (every POI tile) with cheap checks (`poiKnown` / `knownPois` on hash maps); Huge (200 days) ran clean headless; no frame-time measurement was made in the browser.

*Deviations / open issues:* (1) the pip shows from 2 known places, not 1 (above). (2) An out-of-view bare tile whose top POI is known but never seen shows an untouched sprite (as never-seen sites do); the band becomes real once a snapshot carries the pool. (3) `tileActions` still offers Scavenge / raid only on `tile.loc` tiles, so a bare POI tile has no raid button yet (Session 3). (4) The codex's `p:<kind>` entries open for site kinds too (farm, school…) when known: intended. (5) The crowd offset applies to every party drawer that calls `besideBase` (your teams, group parties, bands, outsiders, the glide between tiles); a party sieging a base keeps its own camp placement. (6) The Playwright run could not set the seed through the new-run screen's input (re-rendering under a focused input crashes the page's own handler, unrelated to this work), so the screenshots use the default seed.

*Tests run:* `poispritetest.js` (102 passed), `poitest.js --nocorpus` (1998 passed), `typechecktest.js` (78 passed), `dettest.js 30 42` (5 passed), `savecorpustest.js` (131 passed), `simtest.js 365 42 8` and `simtest.js 200 42 8 size=huge` (both ran clean); `savetest.js 40 42` (60 passed), `discoverytest.js 42 30 1` (167 passed, after the label-priority fix), `maptest.js 3 1 size=normal` (all checks passed); `depletetest.js 42 365 1,2`: see the session report (it timed out at 10 minutes when run beside the sim runs; rerun alone).

---

# Session 3: Scouting and the raid flow

**Launch line:** `Read docs/prompts/poi-and-nomads.md and the Handoff notes for Sessions 1 and 2. Do Session 3 only (scouting and raid flow). Follow the Shared brief exactly.`

**Depends on:** Session 1 (Session 2 helps but is not required).

**Goal:** the two surveys, the POI dialogue, per-POI threat, and routing every scavenge/raid path through a chosen POI.

**Deliverables**
1. **Missions** in `survey.js`/`parties.js MISSIONS`:
   - **Survey** (8 hours, own tile, optional adjacent ring with `optics.js reach >= 1` items at x0.6, one roll at the end, all rules in the brief).
   - **Quick look** (2 hours, own tile, kind only, no threat). It replaces the hidden 2-hour `survey` ("Look around"). Check every caller (`recon` uses `survey(state,p,0.25)`) and keep recon working.
   - Rename the old radius mission to **Sweep area**, behaviour unchanged.
   - Add the new `fieldheat.js ACTIVITY` entries.
   - Wire the new missions through `orders.js`, `plans.js`/`ui/plan.js` presets, `ui/expedition.js`, `ui/teamctx.js`, the tile `tileActions`, and the autopilot logic (`surveyTarget`/`surveyCandidate`). The autopilot should survey known-zone tiles with possible hidden POIs and unknown-zone tiles near its targets.
   - Survey results flow into `p.seen` snapshots and the shared knowledge as extended in Session 1.
2. **Threat:** implement `poiThreat(state, tile, i)` (true) and the perceived estimate (`intelest.js` `rangeOf`/`staleErr` pattern, error grows with age, word plus skulls, timestamped). Record a perceived stamp on a full Survey and on entering a POI. Leave a `tileHeat` hook returning 0 for Session 4.
3. **POI dialogue** (new `ui/poipick.js`, wired from `scavenge.js startScavenge`, `parties.js orderOptions`/arrive for "scavenge", `ui.js tileActions`, `ui/expedition.js`): lists only **known** POIs with kind, visit history, picked-over band (pool), container note (stub until Session 4a) and perceived threat. City/town centres still go to the crawl. If no POI is known, block with "survey first". Replace the building picker (`b.raid.choose`, `buildingOptions`) for POI tiles. The chosen POI's `buildingmaps` archetype generates the raid map.
4. **Pool depletion per POI:** route every scavenge depletion writer in `scavenge.js` (hour search ~264, `afterRaid` ~157) and `combat.js` raid richness (~6022) through `poiPool`/`poiTake` for the chosen POI. Record `visits` and `lastDay`. Entering a POI sets the perceived-threat stamp.
5. **Headless path:** `state.engagement` carries the POI index. `crewSearch`, the autopilot and `autoCombat` choose the best known POI (value x pool / perceived threat) and search it. Add a "next POI" step when one is picked clean.
6. **Hostile base tiles:** raiding a POI on another group's base tile adds that group's owner guards to the roster (existing `raidEnemies` logic) and drops attitude.
7. **Tests:** extend `surveytest.js` (8h/2h durations, own-tile only, ring-1 with optics, success/failure reveal behaviour, no count leakage), add `tools/poiraidtest.js` (dialogue lists only known POIs, blocked when none, per-POI pool depletion, headless path picks and searches one POI at a time), and update `depletetest.js` and `discoverytest.js`.

**Acceptance:** all touched tests pass, plus `dettest.js`, `savetest.js`, `typechecktest.js`. A 3-year `simtest.js` run, including an autopilot run, shows surveys and POI raids occurring without errors.

**Non-goals:** tile heat, container persistence, AI surveying and raiding, nomads. Until Session 4a, leftovers on the map are still lost at raid end.

**Handoff notes:** (to be appended by the session)

---

# Session 4a: Tile heat and persistent containers

**Launch line:** `Read docs/prompts/poi-and-nomads.md and the Handoff notes for Sessions 1-3. Do Session 4a only (tile heat and persistent containers). Follow the Shared brief exactly.`

**Depends on:** Sessions 1 and 3.

**Deliverables**
1. **Tile heat:** persistent per-tile value following the brief. Implement `tileHeat`/`addTileHeat`, hook entry and exit into the raid flow (scaled by approach and shots, using `noteGunfire`), decay about 10% a day in the daily tick. Feed it into true POI threat and the raid roster (`raidEnemies`), with a small chance of a horde or wandering group at high heat. Show heat in the tile panel with the same staleness rule as threat. Keep it separate from Field Heat and Scavenge Heat.
2. **Deterministic containers:** read `buildingmaps.js` (container placement and ids), `search.js`, `combat.js searchBox` and `raidloot.js`. Make each container's contents reproducible from a hash of (seed, tile, POI, container id) instead of a shared rng stream. Assert in a test that the same POI always yields the same container ids and the same unopened contents.
3. **Container ledger** (`poi.cont`, see the brief): at raid start, containers in `looted` spawn empty and marked ransacked, containers in `mine` spawn with their saved contents/hidden/quick/lock state, and the rest are fresh. At raid end (including retreat, the team walking out, and the team being wiped), save the current contents of **every container the player opened**, including items moved into it. Unopened containers are left untouched. Items on the floor and body loot are still lost.
4. **Pool consistency:** the pool is the untouched share of containers' original value. Player-left items never raise the picked-over band. Make the dialogue (Session 3) show: containers opened by you, items you left, "looted by others since your visit".
5. **Abstract path for the player's own crews:** `scavenge.js` hour-by-hour search, `crewSearch` and the autopilot read and write the same ledger, marking containers looted by the player's side in the deterministic order.
6. **Expose the abstract looting function for Session 4b** (for example `lootPoiAbstract(state, who, tile, i, need, hours)`): takes value from untouched containers and from player-left items in `mine` containers, updates pool and ledger, adds tile heat, and returns the haul. Document its signature in the Handoff.
7. **Tests:** `tools/poiheattest.js` (entry/exit adds, decay, effect on threat, determinism) and `tools/poicontainertest.js` (unopened containers identical across visits, opened containers persist what was left or swapped, looted containers spawn empty, pool/ledger consistency, save/load, a revisit round trip through the headless raid bot). Update `depletetest.js` and `savecorpustest.js`.

**Acceptance:** touched tests, `dettest.js`, `savetest.js`, `typechecktest.js` all pass. A raid, a retreat and a second raid on the same POI behave as the brief says.

**Non-goals:** AI surveying and raiding, nomads.

**Handoff notes:** (to be appended by the session)

---

# Session 4b: AI groups survey and raid POIs

**Launch line:** `Read docs/prompts/poi-and-nomads.md and the Handoff notes for Sessions 1-4a. Do Session 4b only (AI groups survey and raid POIs). Follow the Shared brief exactly.`

**Depends on:** Session 4a (and the multi-party drawing from Session 2).

**Deliverables**
1. **POI knowledge for groups:** each AI group, visitor raider band and hardcore band keeps a compact POI knowledge set (known-zone POIs in range known automatically; others learned by survey). Save-safe lazy initializer.
2. **AI surveys:** a group sends a survey stop to a tile that is in need-weighted range but has unknown POIs, using the same odds model as the player's full Survey with the group's own scouting skill, taking 8 hours. The party shows on the map while it does it.
3. **AI raids per POI:** extend `aiscav.js` (`bestSite`, `workable`, `spawnAiParty` kind "scav", `scavSearchHour`, `haulFor`) so a party targets one specific known POI by need, then loots it with the Session 4a function (pool, ledger, player-left items, tile heat). Extend `visitors.js` raiders (`raidTargets`/`searchSite`) and `hardcore-groups.js` bands (same picker). Post news/log lines when a POI is stripped or when someone took what you left.
4. **Same-tile meetings** per the brief: different POIs, no conflict; the same POI fires `contest()`; both parties drawn on opposite sides (Session 2). The dialogue marks a POI "being raided now".
5. **Hardcore:** apply the `hardcore-loot.js` start multiplier to every POI pool.
6. **Expose the API Session 5 needs:** for example `groupSurveyTile(state, group, tile)` and `raidPoiAsGroup(state, group, tile, i)`. Document them in the Handoff.
7. **Pacing report:** a `tools/poipacingtest.js` that runs 6 years on Normal and Large worlds and prints, per year, the share of POIs by picked-over band split by known-zone/unknown-zone and near-base/far. Tune per the brief's targets and report the numbers.
8. **Tests:** `tools/poiaitest.js` (AI knowledge grows only by survey or range, AI raids deplete pools and mark containers, AI takes player-left items, same-POI contest fires, different-POI coexist), plus updates to `visitortest.js`, `hardcoresmoke.js`, `depletetest.js`.

**Acceptance:** all touched tests pass, plus `dettest.js`, `savecorpustest.js`, `typechecktest.js`. The 5-year run shows pools falling naturally with the targeted spread.

**Non-goals:** nomads (Session 5), the Neighbourhood map (Session 6).

**Handoff notes:** (to be appended by the session)

---

# Session 5: Nomads

**Launch line:** `Read docs/prompts/poi-and-nomads.md and the Handoff notes for Sessions 1-4. Do Session 5 only (nomad groups). Follow the Shared brief exactly.`

**Depends on:** Sessions 1, 4a and 4b.

**Deliverables**
1. **`prototype/src/sim/nomads.js`** (new), modelled on `visitors.js`: state in `state.nomads` with a private `Rng`, lazy `nomads(state)` initializer, group-shaped fields (`type`, `pop`, `goodwill`, `stock`, `bases: []`, `outsider: true`) so `trade.js` can read them. They are **not** added to `state.factions`. Verify every loop over groups tolerates them (or never sees them): `groupcare`, `diplomacy`, `blocs`, `alliance`, `conquest`, `claims`, `factions`.
2. **Lifecycle** per the brief: persistent bands that every 2-5 days camp, survey (with the Session 4b `groupSurveyTile`, scouting odds by tier) and raid a nearby POI (within 3 tiles of camp) or a site with loot via the Session 4b `raidPoiAsGroup`, picking targets by need like other groups; unknown tiles are surveyed before raiding, break camp and move 4-8 tiles. Survival needs: a stock of food and water consumed daily, foraging/hunting income by tier skill, and death by starvation or combat. A slow respawn holds the count near half the AI group count for the world size (`worldsize.js`), spawning at the map edge or far from your bases. They flee hordes (`groupflight.js` pattern).
3. **Tiers** per the brief (sizes, skills, gear, armour, behaviour):
   - T1 Looters (3-6), T2 Survivalists (4-8), T3 Preppers (5-10).
   - Era unlock: T1 from the start, T2 from year 2, T3 from year 4 (`eras.js yearOf`).
   - Tier is fixed for life.
   - Add per-tier kits to `arsenal.js` (`KIT_OF`, `starterKit`) and `combat.js KITS`. Pick real weapons and armour from `data-guns.js`, `data-blades.js` and `armour.js` and check they exist. Add tier names and kit explanations.
4. **Recruiting:** from neutral wanderers and refugees (see `wanderers.js`, `groupcare.js wandererJoins`) when stock allows, up to the cap. They never grow past the tier cap.
5. **Player interaction:** an encounter card when your team is on the same tile (attitudes T1 hostile, T2 neutral and willing to trade, T3 neutral and defensive). Camps appear as map markers once spotted (add a `markers.js MARKER_TYPES` entry, with last-seen times). Trade through the existing `outsider` fields in `trade.js`. You can attack a spotted camp (combat with the tier kits, `intelest` fuzzy strength estimate if it fits). No recruiting from them and no diplomacy, pacts, blocs or Coalition membership.
6. **Coalition rule:** nomads never count toward the Calder Coalition victory. They hold no land or claims, and are excluded from the alliance's land share and member lists. Add a test.
7. **Modes:** enabled in all modes. Count scales with the world size. In hardcore the same era unlock rules apply, so early T1 bands only.
8. **Autopilot:** treat nomads as outsiders, handle their encounter cards sensibly, and never crash on baseless entities.
9. **Tests:** `tools/nomadtest.js`: determinism, counts per world size, tier size caps and era unlock, starvation and respawn, recruiting only from allowed sources up to the cap, surveys reveal their POI knowledge, POI raids deplete pools and mark containers looted, no entries in `state.factions`, excluded from the Coalition share, save/load round trip, a 6-year simtest on all four world sizes without exceptions, and a count of nomads alive over time (print it). Also run `visitortest.js`, `wanderertest.js`, `arsenaltest.js`, `savecorpustest.js`.

**Acceptance:** all tests pass. In a 6-year run, nomad counts stay near the target, no tier cap is exceeded, and nobody grows into a base-holding group.

**Non-goals:** nomad diplomacy, nomad radio traffic, recruiting from nomads.

**Handoff notes:** (to be appended by the session)

---

# Session 6 (optional): Neighbourhood multi-house map

**Launch line:** `Read docs/prompts/poi-and-nomads.md and the Handoff notes for Sessions 1-3. Do Session 6 only (Neighbourhood multi-house raid map). Follow the Shared brief exactly.`

**Depends on:** Sessions 1 and 3.

**Goal:** a "Neighbourhood" POI starts one raid map with several houses instead of one building.

**Deliverables**
1. A new multi-building map in `buildingmaps.js` (note the existing `{multi:true, list:[...]}` entries for wild terrain; read how they work first): a street of 3-5 houses, each with its own interior and containers, yards, fences, parked cars (reuse `terraindeco` ideas), seeded and deterministic from the tile and POI. Size within `battlesize.js` limits and the anti-slog endings.
2. One shared picked-over value for the whole POI, depleted as the houses are searched. Per-house container state is stored in the POI's container ledger (Session 4a), so unopened houses stay unopened and anything the player leaves stays.
3. Stealth, lights and hearing (`stealth.js`, `indoorlight.js`, `hearing.js`) work across the multi-building map. Enemies and wanderers spawn per the existing raid roster with a modest increase for the larger footprint.
4. The `Neighbourhood` POI uses its sprite from Session 2. The dialogue (Session 3) shows it as a single POI.
5. The headless path searches a Neighbourhood as one POI with a larger pool.
6. **Tests:** `tools/neighbourhoodtest.js`: generation determinism, every house reachable, container counts, depletion across houses, and a combat smoke run.

**Acceptance:** touched tests, `dettest.js`, `typechecktest.js`. Screenshots of the map in the isometric view.

**Handoff notes:** (to be appended by the session)
