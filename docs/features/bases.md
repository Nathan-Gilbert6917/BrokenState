# Bases: tiers, the base map, building, storage and beds

Detail for section 3 of [docs/agents/features.md](../agents/features.md) (the base itself). The economy that runs on a base (food, wood, power, hauling, work) is in [economy.md](economy.md).

Module names follow the index: `[name]` is `prototype/src/sim/name.js`, `ui/name` is `prototype/src/ui/name.js`. Related docs: [docs/base-building/plan.md](../base-building/plan.md) (the base-building contract), [ADR 0002](../adr/0002-base-building.md), [ADR 0001](../adr/0001-ai-parity.md) (AI parity), screenshots in [docs/base-defence/](../base-defence/).

## Base tiers

Camp, shelter, outpost and hub. Camps can be set up, struck and upgraded [staging].

### Where a base may stand
- The user's requests 2026-10-22 and 2026-10-23: "The ban should be on the tiles for town and city crawls". No base of yours goes up on a town's or city's crawl tile (its centre, a bare city block: citycrawl crawlTile; checked by staging campProblem, parties missionProblem, startpick CRAWL_WHY).
- The suburbs and a city tile with a place of its own take a base once the dead there are cleared (see *Clearing the spot of the dead*).
- The start still keeps START_CLEAR tiles from any town or city (startpick isSettlementTile).

### Your base's tile keeps its places
- The user's word 2026-10-23: "When you set up a base you can raid the other POIs on the same tile and show the base on the POI map".
- A team sent from the base raids them: ui tileActions on a base tile (Raid a place on this tile, Survey this tile); ui/teamctx (Raid a place here).
- The team walks over from the base: poiwalk baseSpot (where its camp stands on the 250 × 250 map, scaled into the hex and kept off the places; walkFrom).
- The POI map draws the base with its State Map sprite and name (ui/poimap baseSvg). The POI map is larger (PM.R 250); the hint box beside it is gone until a place is picked (ui/poipick).

### Picking the camp's spot
The user's requests 2026-10-22:
- "Increase the Base map sizes to be all the same 250x250 base size. Remove base upgrade how it is and turn the next base upgrade into a building to place. When you establish a base choose where in the 250 x 250 ..."
- "reduce to 5x5 with camp site in the middle and the time to set up camp is based on build time for campfire and clearing all in the 5x5 zone. when hovering to set site location say how long and what the yield will be after selecting and confirming show a progress bar over the tile until done"
- "balance wood yield with and without an axe in the teams inventory when setting up camp"
- "keep the isometric view just have a isometric highlight of the 5x5 area"

Rules:
- On arrival the team asks **where on the tile's 250 × 250 map** the camp goes (staging askSite / pendingSite / pickSite / autoSite / campSiteFor).
- **Isometric site view**: the tile's whole map with its land and nothing built (basemap openSiteView: buildBaseMap site, from a stand-in camp on the books only while it is made; b.site). Opened by main.js tidyUi through ui/campsite.js siteViewDue; the clock is held as by any battle screen.
- The **5 × 5** under the mouse is drawn with the fire in its middle cell, green where it can go, red where not, the picked one gold with "Camp fire here" (siteGhostAt, ui/isoview.js). A click picks (siteClickAt).
- Hover line and panel say how long the spot takes this team and what it gives, with the axe's difference (ui/campsite.js siteHoverText / sitePanel). Set up camp here (Enter) or Let the game pick (Esc).
- Not too near the edge (basemap SITE_RANGE) nor on the river (siteProblem). The governor and a deferred pick get the game's own (defaultSite).

### Setup time and yield
- Time = the camp fire's CAMP.fireHours (1 work-hour) + clearing every piece with a cell in the 5 × 5 (basescatter SITE / siteBox, CLEAR hours). Shared by the team, a work-hour an hour each, to the quarter hour (staging siteSetup / campPitchHours; the pitching task's hours set again when the spot is picked; parties pitchHoursFor for the planner).
- **No axe, saw or machete on the team** (teamChopTool): trees, logs and stumps take CLEAR.NO_TOOL as long and give only SITE.NO_TOOL_WOOD (a quarter) of their wood (basescatter siteGet).
- Tent bags no longer shorten setup. A band's tarps on the road stay CAMP.tarpHours (tents pitchHours, bandPitchSaved).
- While it goes up the State Map shows a bar over the tile ("Setting up camp 67%": ui/render.js pitchPct, the parties' pitching task).
- The camp stands at that spot (base.plan.origin, plan.fresh: basemap originOf, gridBox, freshBase). Its 5 × 5 round the fire is cleared and the yield goes to its stores with a log line (basemap clearCampSite, siteYield). The land all round is the tile's own (basescatter landSpec origin / fresh); the rest is cleared as needed.

### What a camp's spot is like
- The user's words 2026-10-23: "add valuable information to setting up camp. Update let the game pick".
- One set of facts for a 5 × 5, read by the picker and the game's own pick (siteinfo siteInfo / landFacts): the team's setup time and yield with and without an axe; the ground (level, a hill dug down, a hollow filled in); the lie round the levelled camp (ring 4–10 cells: looks down on it / overlooked; crag counts as higher); sight (open share within 12 cells); room (open share in the 24 × 24, roomClear hours) and how far a yard grows before the edge; wood within 20 cells; the river, the tile's water (waterSource) and the road; places the team knows of (knownPois) with distance and direction; the dead and their kinds (siteclear siteThreat, per tile).
- The game's pick (siteinfo bestSite / bestSiteOn / siteScore, SITE_SCORE; basemap defaultSite calls it, so Let the game pick, autoSite, the governor and a team with nobody to ask use it): setup work-hours −1 each, high ground +6, sight +4, river +3 (within 20 cells, 0 at 80), road +2 (0 at 40), room +8, wood +4 (2400 = full), room to the edge +6, the dead −0.6 each; summed-area quick scores for every spot (gridsOf), the best 24 in full; never the river or crag, off buildings and high ground while it can; ties nearest the middle; deterministic, cached by landSpec (3 lands kept). Scored as if with a cutting tool, so the pick does not move with inventory.
- Shown (ui/campsite siteFacts / siteFactLine / sitePanel / siteHoverText; ui/isoview): the panel's coloured fact grid and "The game picked this spot because …" (pickReasons / pickWords) on the game's spot; the hover line's short facts; "The game's pick" tagged on the map while another spot is picked (siteGhostAt gameAt); autoSite logs why. `tools/campspottest.js` (section 5).

### Scouting before a camp
- The user's request 2026-10-23: "The team must scout out the tile prior to having the set up camp with all the information. Or you can still set up camp but it will be a random spot on the base build map ... it will generate events for the campsite/base being attacked taking you into a base raid until your base map is cleared of zombies. You can raid your base via the POI map to clear out the zombies yourself".
- Scouted = the tile carries the Survey's stamp (Survey this tile, 8 h; the hub's record or the team's own finds: campscout tileScouted); hardcore's camps before the first home count as scouted. There the spot is picked and its dead cleared first as before.
- Unscouted: Set up camp, Establish base and Build outpost read "(unscouted: blind spot)" with no count of the dead, with **Scout first** beside each (missions scoutcamp / scoutestablish / scoutoutpost: the Survey, then the camp's order queued; scoutOptions, parties arrive); the planner warns. **Blind**: the camp goes on a spot of hash dice (blindSite: valid, off buildings and high ground where it can be; staging campSiteFor reads it for the hours), nobody asked, nothing fought first (staging pitchArrive → scoutOrBlind, blindCamp).
- The grounds' dead: base.grounds { dead (GROUNDS.MAP 3 × siteThreat's count, at most 60; none on quiet land), known, next, waves, killed, raids }; the base map known only within GROUNDS.KNOWN_R (14) of the fire, the rest fogged (basemap viewBattle knownMask, combat playerVision; "Unknown ground" on hover, ui/basemap), the Camp tab's "The grounds: unknown (?)" (ui/ui groundsRow).
- Attacks (groundsHour from staging campsHour): every 18–42 h while any are left and someone is home, "The dead come out of the woods at <base>": Defend the camp (the base defence battle on the base map, defences fightNow, groundsDead) or keep out of their way (food and meds spoiled); waves 3–8 (+4 over 30 left); every kill off the pool (takeDead); at 0 the log says the grounds are clear.
- Clear them yourself: "Clear the dead from the base grounds" on the POI map (poiraid poiPickCard), the team's orders and right-click menu (mission grounds): a siteClear fight on the tile's land against half of what is left (4–20). A Survey lifts the fog and counts them (survey fullSurveyDone → groundsSurveyed). The governor's outposts scout first unless the hub is crowded or the land push is on; it answers attacks with Defend. AI groups neither scout nor go blind. `tools/campscouttest.js`.

### Step ups are buildings
- Shelter shack (camp_up, 5 × 4), Outpost house (outpost_up, 5 × 4), Main house (hub_up, 6 × 5) have footprints (basemap FOOT), sit on the Build list and are queued and placed like any building (the Camp tab's Place / Move it: main.js tier-place → ui/basemap openForJob; the game places one not placed by hand, its site's clearing queued first).
- When one stands it stays as a building (buildings constructionHour → addBuilding then upgradeShelter; never demolished: canDemolish) and the base is the next tier.
- A base founded on its own spot, or with its step up standing, keeps the camp's middle, fire and cache (basemap coreParts / tierBuilt).
- **Wood in the step ups** (the user's pick 2026-10-20): camp_up and outpost_up 20 scrap, 2 building materials, 200 wood; hub_up 100 scrap, 5 building materials, 800 wood.
  - Gathering keeps the fires' days of wood back (buildings gatherHour: woodNeed dailyKeep).
  - An outpost keeps what its gathered jobs still wait for out of the midnight shipping (economy shipFromOutposts).
  - The governor fells for a step up's wood (autopilot nextBuildWood reads gatherRows).

### The camp fire moves
- The user's request 2026-10-22. The fire is an item of its own on the map (basemap FIRE, key k:fire, base.plan.fireSpot, [0, 0] until moved; movableFire, fireSpot; Move only, never Auto).
- A selected base's side panel has a **🗺 Base map** button (ui/ui.js tile panel: buildmap with tab "none"; closing returns to the State Map: main.js mapFrom).
- Modules: [staging, basemap, basescatter, buildings, tents, ui/campsite, ui/ui tierUpRows]; test `tools/campspottest.js`.

### Clearing the spot of the dead
- The user's request 2026-10-22: "if it is in a city tile or town tile or higher infection rate you will need to clear the zombies first before establishing the base ... do not have reinforcements come due to heat ... Farmland and far from town and city tiles should have very few if any zombies".
- A team setting up camp (Set up camp, Establish base, Build outpost) on a city tile, a town, or a tile at least SITE_CLEAR.INF (0.5) infected fights the dead at its spot first, once the spot is fixed (staging pickSite / autoSite, or at once with nobody to ask: siteclear clearSiteFirst). Pitching waits; the team is engaged.
- Their number: by place (SITE_CLEAR.BASE), infection (INF_N), year (eras hordeGrowth) and the Dead at sites dial; only a share (FAR) on farmland or land with no town or city within NEAR tiles. Their kinds are a raid's there (siteThreat).
- The fight (layout "siteClear") is on the tile's own land round the spot (houses, streets, high ground: layLand), the dead spread round, your people from the west, **none drawn in** (b.reinfMax 0). Won: setup goes on (p.siteClear). Pulled back or beaten: the team waits for orders.
- The spot's panel, the orders' text and the start sites say how many (ui/campsite deadCard, staging threatWords). The governor's outpost pick and hardcore's start sites count them (autopilot outpostSite, hardcore-start hubSites).
- Modules: [siteclear, staging, ui/campsite]; test `tools/siteclearest.js`.

### Open the build map
- The user's requests 2026-10-20. A base new to you (camp set up via Set up camp, Establish base, Build outpost; occupied, taken, given back empty, handed over by a group) or just gone up a tier asks to be laid out (`base.layoutAsk`; staging askLayout from makeCamp, campBecameShelter, baseUpgraded via buildings upgradeShelter, occupy takeAbandoned, conquest captureBase / conquestDaily, jobs handOver).
- Nothing blocks the clock or a save. Prompts: an alert "<name>: camp set up. Open the build map" (text read as drawn, so a rename shows; a click opens that base's map with its Build list, back to its Base map tab); an Open the build map button on the Camp tab; the key **U** (B is the Bases tab) for the selected base, in the key table and the help's key line.
- The ask ends when the map is opened (layoutDone: openBuildMap, main.js tidyUi) or after LAYOUT_ASK.HOURS (72).
- Founding cards ("A new home", hardcore's "A place of your own") carry the button as an extra choice (uiAction "basemap" → main.js choice → ui/basemap openBuildMap; OK is the default, never an auto-answer: cardrules usableChoices; stale in the tray once the base is gone: trayStale mapBase; text names the base as drawn).
- Not under the governor. UI only, no AI side.
- Modules: [staging askLayout / layoutAsks / layoutDone / buildMapChoice, ui/buildmap (buildMapAlerts, buildMapRow, BUILDMAP_ACTIONS, buildMapKey, selectedBase), ui/alerts SECTIONS.layout, ui/keymap base.buildmap]; test `tools/buildmapbtntest.js`.

## Buildings and construction queue
- Plots by base size, demolition refunds, water barrels, storage crates and the storage ladder (storage box, shed, warehouse; the Armory) [buildings].
- General buildings (`general`, no plot: the map is the limit) and fittings built inside them (`fit`): bunk beds in BEDS, shelves (150 kg) and lockers (100 kg) as storage (storeKg), the wood stove `as: "cookhouse"`.
- `count()` honours `as`; a camp's and a shelter's counts of them (CAMP.build, SHELTER.build). Demolishing a general building pulls its fittings down with it.
- Field works outside the walls [fieldworks].

## Base storage limits
The user's request 2026-10-19.
- **Room in kg.** Core by tier: camp 0, shelter 150, outpost 500, main hub 1200. Storage buildings (buildings STORE_KG): storage box 60, crates 150, root cellar 400, cold store and freezer 300, storage shed 600, storehouse 2000, warehouse 6000 (outpost or hub). A parked car adds its payload while parked; an opened lock box in the armory adds BOX_STORE_KG (data-boxes).
- **Filling.** Stock and armory fill it by worth a kg; what the player or game put in a container fills that container first (see Containers). The rest lies **outside**: it wears every day (twice in rain or snow) and raiders find it easier.
- **On the raid map** what lies outside is piles of crates in the yard (raiders go there first and grab twice as much a turn). A parked car used as storage is a container; it can be moved to any free cells it fits (Move: the base map with it picked).
- The fire safe and rifle case are carried in both arms only (twoHands: no pocket, pack or pouch; both hands full) (inventory isTwoHands, carry handsCount).
- Modules: [basestorage storageOf / storageSummary / storageLine / outsideShare / storageDaily, buildings STORE_KG, data-boxes BOX_STORE_KG, inventory isTwoHands, carry handsCount, basemap layPiles / makeStores / thiefTurn / carLen, ui/basemap moveCarButton]; tests `tools/basestoragetest.js`, `tools/basestoragemaptest.js`.
- **UI**: the Overview's Storage row, the camp's Stores card, storage kg on the Construction tab, a parked car's storage and Move button on the Vehicles tab, the Armory's Storage card with "Outside: weathering" and "Both hands" badges [ui/ui, ui/armoryview, ui/itemlabels].
- **Autopilot** queues the smallest storage that holds what lies outside, after its other priorities (shelves and lockers first while a general building has floor) [autopilot storageWish].
- **AI groups** build storage by the same rules (ADR 0001): when goods lie outside one of their bases (measured as the supply run leaves the stores tonight; their camp has no core room, as yours) they put up your governor's choice from its ladder (storage box at an outpost camp; crates or a shed at an outpost; crates, shed, storehouse or warehouse at the main base), the smallest that holds it, else the biggest they can pay for. Your costs, your max counts, the warehouse's Mechanics 2 and size rule, your hours as crew-days, after water, fields, quarters and walls under threat. The buildings stand at their bases (raiders find what is inside or on the piles); the Groups card names them [groupworks storageWork / storeLock / storeDef / groupStorage, groupbases WORKS_BUILDING / stockTonight / worksBuildings]; test `tools/groupstoragetest.js`.
- **Storming a group's base** puts its real stock and spare kit on the assault map in their storage (piles for what does not fit, a locked armory to force). Your people take from it through the raid search window; what they carry out leaves the group [assaultstores, fort, conquest, raidloot]; tests `tools/assaultstoretest.js`, `tools/groupstoragetest.js`.
- **The woodpile** (the user's pick 2026-10-20): wood takes no storage room and is never outside (basestorage NOT_STORED, woodpileOf; storageSummary's and the Storage tab's "Woodpile: N wood"). On a base's battle map it is laid with the piles, so a raid still takes from it (basemap outsideOf).
- A pitched tent is an assignable container in the Storage tab (food or gear kept in it by hand).

## The base map
Modules: [basemap, ui/basemap, ui/combat]. Screens: [docs/map-layers/](../map-layers/).

### The grid
- Every base's own map, 250 × 250 for every base (basemap BASE_GRID). The yard round the base grows by tier, a camp's 20 × 20 up to a hub's 180 × 180, never past the edge (gridOf edgeRoom).
- The camp, shelter or base stands where its camp was set up (base.plan.origin). An older base, or one occupied, taken or handed over, sits in the middle; gridBox is the map's extent round it.
- The Base map view shows the yard and what stands or is cleared round it. Buildings, crop plots, defences, wall pieces and parked cars are placed by hand or by the game: anywhere, right against anything, never on top of something else, on the wall's ring (wall pieces may), in a doorway or within the no-build margin.
- Always a way in and out on foot (basemap reachProblem: everything reachable from the map's edge, gates and doors counting).
- Outlines for buildings going up; it is the map a horde or raid fights over.
- Building from the map: the Build list (wall pieces under Defences); a ghost follows the mouse; a click queues and places. The selected thing's card shows its fittings, neighbours and their doorways, Move, Demolish.
- **Orders beside the selected thing** (the user's request 2026-10-23: "show the options next to the selected thing instead of having to click in the side panel"): a chip on the map under its footprint's front corner (over its back one when there is no room below, kept inside the visible map) with its name, Move, Auto, Place, Strike / Pick up / Demolish or Cancel the job, the doorways to the buildings it stands against, and ✕. The same buttons stay on its card in the panel. Hidden while it is picked up or off screen [ui/basemap selChip / selButtons (built with layoutPanel into cui.selChip), ui/combat selChipFrame, #bmselchip in styles.css]; test `tools/basebuilduitest.js`.
- Survivors are never shown on it; the whole base is in plain view (no fog: combat playerVision).

### Move keeps the map
- The playtest 2026-10-20: the map was made again on every Move.
- Move (layoutAct "lift") only picks the thing up; its ghost follows the mouse and everything stays as it is until put down (Esc leaves it). Move leaves a dimmed copy at the old spot (ghostAt `from`, ui/isoview).
- The view uses the base's own dice (the game's dice untouched) and is laid out again only when something is put down, built, pulled down or a doorway opened; the camera stays on the same grid cell (ui/isoview newBattleCamera; the crop may grow).
- What the game placed stays while it still fits (holdAuto: base.plan.autoAt, read by autoLayout before its own order).
- A base with nobody at home no longer opens its view "over" (no clicks taken).
- Modules: [basemap viewBattle / holdAuto / autoLayout]; test `tools/baseviewtest.js`.

### The land
- The user's requests 2026-10-20: scatter fences and trees, "Trees block building until cleared", every piece blocks building, "Make a clearing in the middle of the map", "Make the build map make sense for the tile it was created on".
- One layer from the tile alone in grid coordinates (basescatter scatterLayer chunk by chunk, landSpec / landOf): the same whatever is built or moved, as the grid grows, in the view and on a raid's or horde's battle map.
- Terrain dressing: forest (tree clumps, trees, bushes, fallen logs, stumps); farmland (hedgerows, lone trees, rocks, hay and fenced fields: see Farmland's fenced fields below; a farm's fields more of them); hills and mountains (rocks, boulders); suburbs and city (fences, wrecked cars, crates, barrels, paved lots).
- A road tile's road across the map (its roadLinks' axes) with abandoned cars and debris; a river beside the tile along that side (water, never built on, two fords); the yard's leavings (stumps, logs, crates, barrels, a rock).
- A **clearing** in the middle (CLEARING by tier: a camp's 12 × 12), only for a base from before the camp's spot was picked; a camp set up on its own spot clears its 10 × 10 as its setup and has the tile's own land all round. Never on a map's outermost ring.
- **Every piece blocks building** on its cells and the cells outside a door (placeProblemAt: "Clear the land first: 2 trees and a bush"). The auto layout picks open ground and, where none is left, places over the land with the site's clearing queued first (autoLayout's second pass, siteWaits: never stuck). What stood on the map when a base's land was first read keeps its ground (ensureLand: old saves and new bases alike).
- **Clearing** works like construction: a clearing job in the queue (BUILDINGS.clear, hidden from the lists; queueClear / finishClear), worked by builders (those that give wood by woodcutters first, ahead of their trips), yield into the stores when done.
- **CLEAR table** (basescatter CLEAR, work-hours → yield):

  | Piece | Hours | Yield |
  |---|---|---|
  | tree | 4 (×1.5 with no cutting tool at the base) | 120 wood |
  | stump | 2 | 15 wood |
  | fallen log | 1.5 | 40 wood |
  | bush | 0.5 | 5 wood |
  | fence panel | 0.5 | 10 wood |
  | wire fence panel | 0.5 | 1 scrap |
  | field gate (its two cells) | 0.5 | 15 wood |
  | hay bale | 0.5 | |
  | rock / boulder | 1 / 3 | |
  | crate or drum | 0.5 | 1 scrap |
  | wreck: strip once / drag off / both | 2 / 6 / 8 | 6 scrap + a car part / 2 scrap / 8 scrap + a part |
  | house / store / city block | 20 / 28 / 48 | wood, scrap, building materials, metal sheets |

- Queued from the map (a piece clicked: Fell it / All of the stand / Strip it; a red site clicked: its clearing), shown on the view (an amber wash, "Clearing 40%"), listed in the panel with Cancel. Cleared stays cleared (base.land.cleared by cell, base.land.looted).
- A thing the game lays over the land (a Ring wall's pieces) clears its ground (clearUnder). An AI group's walled base wears the same land in its margin (fort.js).
- Modules: [basescatter, basemap landFor / queueClear / siteWaits / clearAllLand, buildings constructionHour, ui/basemap landCard / clearingList, ui/isoview]; test `tools/baseviewtest.js`.

### Farmland's fenced fields
- The user's request 2026-10-23: "Fix fences for farmland tiles to not be random singular fences make them square, go off screen and have a gate to enter the inside of the fenced area".
- On farmland (plains) and a farm's fields (basemap terrainOf "farm") the old fence runs are gone; the fences are fields (basescatter fieldLayer, FIELD): at most one to a 48-cell REGION of the map (chance P: farm 0.85, plains 0.45), a square of fence 22–42 cells a side (S), 3 or more cells in from its region's edge (GAP: a lane between fields). The regions' grid is shifted by the tile's dice (laid on the map's middle it lined up with a hub's 96-cell view, whose edges then always fell in the lanes) and runs on past the map, so the ring of them round the 250 × 250 map runs off its edge: those fields are cut by it, and by a base view's edge.
- **Wood and wire** (the user's word 2026-10-23: "Add wire fences and wood fences"): a field's fence is post and rail (`fence`, half cover, 10 wood to pull down a panel) or, FIELD.WIRE of the fields (farm 0.4, plains 0.55), post and wire (CELL `wirefence` "Wire fence": no cover, seen through, climbed over by the living and crawled over by the dead like half cover: combat vaultable OVER; smashed open by a brute; 1 scrap a panel); drawn as a weathered post and three strands of plain wire (ui/isoview). The gate is wooden either way.
- **Off the map** (the user's word 2026-10-23: "Show it going off the map and not just terminating"): where a fence line meets the map's edge (its cells one and two in: the outermost ring stays the attackers' open ground), the view runs it on straight out across the edge's skirt (ui/battleedge) into the fog, fading with it (ui/isoview offEdgeFences, drawn by depth with the cells). Scenery only, like the skirt.
- Each field has a **gate**: two cells of CELL `fieldgate` ("Field gate": walked through, no cover; drawn as a pale five-bar gate with a brace and posts where it meets the fence, ui/isoview) in the side facing the map's middle, on the map and two or more cells from a corner. landOf keeps the ground FIELD.APRON (2) cells deep either side of it clear of the scatter, so the way in stays open.
- The fields go down before the scatter (nothing stands on a fence line); the fence is broken where a road, the paving, the yard or the clearing crosses it, and no field is laid where the river runs (its far part would be shut in). A fence panel or the gate is cleared for its wood like any piece (CLEAR; "All" takes a run of up to 40 panels: basemap landPieceAt).
- Modules: [basescatter fieldLayer / landOf, combat CELL fieldgate / wirefence / vaultable, ui/isoview prims / offEdgeFences, throwables (it burns), zombietypes SMASH]; test `tools/farmfieldstest.js` (squares, gates facing the middle, apart, off the edge, no loose fences, clear aprons, every field walked into through its gate, wood and wire, the lines run on past the edge); `tools/mapreachtest.js` covers farmland and a farm's fields.

### Towns and cities
- The user's request 2026-10-22: "Add more variety to the bare base maps with elevations in hill tiles, houses, roads and stores in town tiles and similar but more city like for city tiles".
- A town (the suburbs and a town's own tile: basemap terrainOf) has a street grid (road floors every TOWN.town.BLOCK cells) with lots facing them: houses (walls, windows, a front door on the street, rooms off each other, beds, a table, kitchen counters, floorboards), a path and driveway with a car on some, fenced back yards, now and then a store (windowed shop front, shelf rows, counters) with a gravel or weedy lot.
- A city: tighter blocks with sidewalks, two-storey city buildings (rooms off each other), stores, parking lots of wrecks, the odd park, more wrecks in its streets (basescatter townLayer, building).
- A building is one piece of the land whose cells each carry their own kind (parts: layLand lays them; basemap landBlocks walls only), pulled down whole for its wood, scrap, building materials and metal sheets.

### The lie of the land (hills, hollows, mountains)
- The user's words 2026-10-23: hills "up to 3 layers high and 1 layer high for the short hills", traversed by survivors, vehicles "the whole vehicle must be on the layer", mountains "steep hills that cannot be traversed and blocks line of sight ... like a mountain range", "bushes, trees and roads can go through hills", "negative hills where the ground level goes down 1-2 layers".
- Every cell has a ground height (basescatter reliefLayer: −1 to 3 on the ground, the massif's rock up to 13; combat c.h with c.ter) under whatever stands there (tree, bush, road).
- Hills: at most one to a REGION (short = 1 level, tall up to 3, nested levels with ragged edges).
- Hollows: a level down at most, round and smooth-edged, none narrower than HIGH.DIP_MIN (8) cells either way (the playtest 2026-10-23: "keep the sunken hollows have it go down max 1 layer depth and make it sizeable minimum width of 8 tiles"; dropNarrowHollows, again after the yard and a fight map's level edges cut them).
- Mountains: a mountain tile's massif of crag (CELL crag: no way over, no sight through; the playtest 2026-10-23: "more pointed ... combine into the center"): one core in the middle half of the map with ARMS ridges reaching out from it and narrowing, its rock a level higher a cell in from its edge (c.ch, 3 up to a peak of 13: sight lines count it), foothills falling away a level every HIGH.FOOT cells.
- Ground never steps more than a level between neighbours (relaxHeights, again after the yard and cleared cells are levelled), so people and the dead walk up and down at CLIMB moves a level (combat climbCost groundH, TERRAIN_STEP).
- Sight (losTop): a hill hides what is behind it from lower ground; the ground round a hollow hides it; a tree on a hill is the hill's height taller.
- Vehicles cross a step at a time and stop only with all cells on one level (rectSpan, levelRect: carSteps, driveTo, the turn).
- Uneven ground is dug down or filled before building (land pieces rise, dip: CLEAR a level at a time; crag never; no camp on it: siteProblem). High ground dug a cell at a time (CLEAR rise, slope). The game's own camp spot keeps off buildings and high ground (defaultSite).
- The same land lies under a fight or raid on a hills or mountain tile (relief applyRelief: the tile's window with most relief; edges, raid zones and round the buildings level; crag only in an open fight and only if the map stays crossable).
- Drawn as earth columns with the floor's top, grassy banks to lower ground, a hollow's walls only where seen, crag as one continuous surface through its neighbours' heights (rockPrims: a point where a cell stands above all round it, a crest along the highest), snow above ROCK.SNOW levels (ui/isoview terrainPrims, terrainOf, prims crag). Trees and bushes drawn larger (GROWN).
- Modules: [basescatter, basemap, combat CELL, ui/isoview]; test `tools/siteclearest.js`.

### Every way in stays open
- The user's words 2026-10-23: "Add tests to cover reachability and determinism", "Blocking base due to ridge".
- The massif never walls ground in: a hole in the rock of HIGH.HOLE (8) cells or fewer is filled, a bigger pocket gets a pass HIGH.PASS (2) cells wide carved the shortest way out (basescatter openCrag, cragPasses). A map cropped from the land (a base's map, the camp's spot fight, an AI fort's margin) carves the same passes and smooths its ground to a level a step at its edge and round what stands (relief cragWays after layLand); applyRelief carves a pass before smoothing.
- landOf smooths only against the rock laid (a road's pass is no trench), lays no scatter on paved ground (roads, fords, paths, drives, lots, sidewalks); the never-cleared land (waterOnly) is the river and the rock, so nothing the game places stands on the mountainside (landWhy "On the mountainside"; siteWaits and clearUnder skip it); a town's south-row store car and house path keep the front door clear.
- `tools/mapreachtest.js`: 11 kinds of tile, bases and fights walked to from the edge (rock and river cut nothing off, ≥98% of walkable cells reachable as the land stands, fords, defaultSite reachable, every town door reachable, every enemy reachable). `tools/mapdeterminismtest.js`: the same land, relief, town and fight maps every time, in a fresh process, with the game's RNG untouched, and after a save/load.

### Terraforming
- The user's request 2026-10-23: "Add the ability to terraform the base build to add hills and create hollows it takes time requires a shovel and the more shovels and people the faster it is one shovel per person ... Digging a hollow only works on dirt tiles and provides dirt when finished. This dirt can be used to create hills. When making a hill if it is adjacent to a hill meld them together to look smooth like they were created by the seed."
- The Build list's **Terrain** group: **Dig a hollow** / **Raise a hill**, two clicks for the corners (up to 16 × 16), R sets 1–3 levels; heights stay −1 to 3 (TERRA.LO, the playtest's hollows a level down at most). Only dirt is worked (grass, trodden ground, fields: terraform dirtProblem); road, paving, rock, trees, crag, river, buildings and ground already worked are left out (shown amber), the order refused only if nothing is left.
- Shaped by the relief's rules (terraPlan: a level a step eight ways, at least 2 × 2 at each level), so a hill raised beside the land's joins it as one hill.
- One job in the construction queue (BUILDINGS.terra, hidden; queueTerra, terraHour), a cell-level a step at 1 work-hour. Workers = min(builders, shovels on them + in the armory) (shovelCrew; TOOL_KINDS.dig: shovel, entrenching tool, pickaxe, makeshift shovel); rate terraRate = buildRate × workers ÷ builders. No shovel: "Needs a shovel", the queue moves on (terraWaits); builders without one wait on the job.
- Dirt: 10 a dug cell-level, 10 a raised one (TERRA); a base stock key in a heap in the yard, no storage room, never carried, traded or raided (basestorage). A raise is refused when the heap less queued raises is short.
- Kept in base.land.heightEdits ("x,y" → level), laid over the tile's relief in landOf after relaxHeights and dropNarrowHollows (a narrow hollow dug on purpose stays), then relaxed once more; on the base map, raids and hordes. A cleared cell is level again (finishClear, clearUnder, clearAllLand drop its edit). Uneven ground is levelled before building; nothing placed on ground being worked (occupancy work, placeProblemAt).
- UI: amber wash with "Digging/Raising N%", the Terrain job list with Cancel, hover with size, hours and dirt (ui/basemap terraRow, terraPickCard, terraHover, terraList; basemap terraGhost, terraClick); activity "Digging a hollow (2 of 3 with shovels, 40%)". The governor does not terraform; AI groups have no base map. `tools/terraformtest.js`.

### Tents on the base map
- The user's rules 2026-10-20, reconciled with tent bags, beds and soft cover in the pt-int merge. See also [travel.md, Tents](travel.md#tents).
- One kind of map piece in sizes: a building record `{ type: "tent", tent: kind, item? }`. buildings TENTS is data-tents TENT_TYPES, the one table:

  | Kind | Size | Sleepers | Dry storage | Mood |
  |---|---|---|---|---|
  | makeshift | 1 × 2 | 1 | none | −1 for its sleeper |
  | tent1 | 1 × 2 | 1 | TENT_STORE_KG = S = 15 kg | 0 |
  | tent2 | 2 × 2 | 2 | 30 kg | 0 |
  | tent4 | 3 × 3 | 4 | 60 kg | 0 |

- Every cell is the one kind "tent" on the battle map (how a fight treats it is combat's and softcover's).
- The **Makeshift tent** is the one built (BUILDINGS.tent: 40 wood + 1 scrap, 2 hours, up to 16; the Build list, the Construction tab). (Base building's wood list prices it 80 wood + 1 scrap; see below.)
- Proper tents are pitched from bags: basemap **pitchTent**(state, base, kind, at?) → { tent } | { error }, **strikeTent**(state, base, id) → { kind, name }; tents pitchTentAtBase / strikeTentAtBase / pitchArmoryBags wrap them with the bag kept on the record. By hand from the Build list's **Tents** group (a bag in the stores: type `bag:<kind>`, basemap bagKindOf / pickFoot, layoutAct build → tents pitchStoredBag; no cost, no builders) or by the game. **Strike** on its card (buildings demolish → the same bag back, no question).
- **Beds come from sleeping places**: baseBeds = the tier's own (camp none) + buildings' BEDS + beds furnitureBeds + **tentBeds**(base) once.
- A new camp has no beds until a tent is up (staging makeCamp marks tentsSet; the team's bags go up at once). **A camp is never crowded** (morale crowdInfo: no penalty, no Overcrowded card, no "a bed for everyone" while some have none). Each person without a bed has the one rough-sleeping line (beds bedLine; see Beds).
- The governor pitches spare bags first, then makeshift tents at a camp or shelter short of beds (autopilot buildWishes; a queued tent counts as a bed to come: queuedBeds), then crafts furniture.
- A camp from a save before tents keeps its six (save.js legacyCampTents: three two-person tents).
- An AI group's camp sleeps rough until its quarters go up (groupworks; its bags count as quarters). A fight at it shows its real tents, the bags on its shelf (tents groupCampTents), else AI_CAMP_TENTS makeshift ones (conquest baseAssault).
- Modules: [basemap TENT / pitchTent / strikeTent / tentCount / bagKindOf, buildings TENTS / tentBeds / legacyCampTents, morale crowdInfo, conquest]; tests `tools/baseviewtest.js`, `tools/ptinttest.js`.

## Base building
The user's request 2026-10-19; [docs/base-building/plan.md](../base-building/plan.md), [docs/adr/0002-base-building.md](../adr/0002-base-building.md). Tests: `tools/basebuildtest.js`, `tools/containerstest.js`, `tools/basebuilduitest.js`, `tools/repairorderstest.js`, `tools/basebuildautotest.js`.

### No-build margin and general buildings
- basemap NO_BUILD = 5: the five cells nearest every edge take nothing, by hand or by the game; the view tints them.
- **General buildings**: Hut 4×4 (camp), Cabin 5×4 (shelter), Lodge 6×5 and Hall 8×6 (outpost), Barn 10×7 (main base). Empty shells with a barred front door (a back door from 20 cells), no plot: wherever there is room.
- Indoor cells (`occ.floor`) take **fittings** (bunk beds +2 beds, storage shelves 150 kg, lockers 100 kg, a wood stove that counts as the cook fire; `rec.host`) and **indoor props** (benches, med station, smoker, sealer, mill, grinder, crates, relay: `FOOT.indoor`, inside or in the yard); never on the cell inside a door.
- Moving a general building takes what is inside along. A fitting with no standing host is off the map (it still counts by the numbers). The auto layout puts fittings inside buildings with room, nearest the middle first.

### A way in and out
- The user's third request; plan Part F [basemap reachProblem].
- A walkable path at least one cell wide (PATH.WIDTH) must join the map's edge to everything placed (a house by a door or doorway link, a fitting by its host's floor, anything else by a cell next to it). Checked by hand (placeItem, the ghost's reason) and by the auto layout.
- Wall pieces are the wall (no ring drawn): walls block, gates and stands walk. A piece that would close a ring with no gate is refused: "Needs a gate in the wall first: the wall would shut everything inside off from the outside". The auto layout lays gates first, so a planned Ring wall closes.

### Doorways
- Between two house-kind buildings whose walls touch (`base.plan.links` by item key; neighboursOf / canLink / linkBuildings). Both wall cells become barred doors facing each other on the built map, worn by a fight like any door. A stale link is dropped; a queued building's key is rewritten when it finishes.

### Containers [containers]
- Merged with base storage limits: one system. The room is basestorage.js's (storageOf: core by tier, camp none; every storage building by STORE_KG incl. shelves 150 and lockers 100; a parked car's payload; opened lock boxes).
- Goods stay on the base's books (stock, armory); an assignment says which container something is kept in (`item.store`, `base.bins` keyed `core` / `b:<id>` / `v:<id>`). An opened box is room but not assignable (its armory index moves). Clamped to the books when read (normalizeBins).
- storageOf fills each container with what is assigned first (up to its room), then unassigned goods fill what is left by worth a kg; the rest lies **outside**. Pseudo-containers `loose` (inside but put away nowhere) and `outside` (containersOf).
- `putItem` / `putSupply` by hand; `autoStore` by the game (basestorage.js's order, densest first: food where it keeps, rounds and guns in the armory, dear things to the core and storehouse, gear to the lockers, never into a car or box; deterministic, a fixed point). Runs daily for the autopilot's bases and AI groups' bases (factions peopleUp). `storageKg` in kg.
- **Storage tab** (ui/ui BASE_TABS "storage") [ui/storage]: every container with its room bar and contents, what is put away nowhere and what lies outside, a mover, Tidy up, Put the rest away, a warning for goods outside.
- **Raiders steal from containers and cars**: the stores on the battle map are the containers (makeStores): assigned goods sit in their container's map entry (a parked car among them), unassigned share the room left, outside goes on the piles (raiders go there first and grab twice as much). Stolen goods leave the books and the bin (takeLoot u.loot.from → b.stolen.from → applyStolen); a looted car loses condition [basemap, fort, conflicts].

### Autopilot [autopilot]
- Tidies every governed base at the morning plan (tidyStores: autoStore, assignments only, before the day's builds).
- When beds are short and no bunkhouse or barracks can be queued: wishes for bunk beds or the biggest general building the base can put up (bedWishes / generalWish).
- One storage wish when goods lie outside (storageWish: shelves, then lockers while a general building has floor, else the smallest storage building that holds what is outside, else a general building; one at a time, never saved for).
- A wood stove where the cook fire has no plot (stoveWish). Defence wishes stay.

### Repair orders
- The user's second request; plan Part E [breakdowns, ui/explore repairsTab].
- Every placed thing wears from raid damage (FIXTURES raid-only entries for general buildings, fittings, outer defences and the rest).
- A repair can be ordered on anything above WEAR.repairWear as a partial job priced by the wear to take off (at least 1 hour and 1 scrap; a broken thing the full job). Builders first, then the best mechanic; the player may pick another.
- Repairs tab: every fixture, most damaged first, with wear bar, state, "Repair: who, hours, cost", Jury-rig, who-picker, Cancel and Repair all.
- Wall pieces have **one wall row** (repairList kind "wall", sorted by its worst piece; Repair the wall → orderWallRepair / wallRepairPlan, with who-picker and Cancel; Repair all gives it once) [ui/explore wallRowHtml].
- The autopilot and stewards order a repair on anything over ORDERS.wear (50) while the base keeps ORDERS.keepScrap (20).

### Ring wall and pinned builds
- **Built once** (pt-int round 2): a Ring wall job pegs the ring when queued (buildings queueBuild → basemap ensureRing) and lays its pieces when done (ringPlan). The game's wall pieces are laid over the land from the first layout pass as ringPlan counts the runs. The yard stops at a pegged ring (yardHalf; yardHalf(base, true) is the yard the buildings want: Widen the ring).
- **Builds stay where the game put them**: a finished building stands where it went up; queued builds are held once their site's clearing is queued (basemap pinAuto / pinQueued into base.plan.autoAt, taken over the land in autoLayout's sticky pass).

### Wood in furniture and fittings
- The user's pick 2026-10-20: bunks 2 scrap + 200 wood, shelves 2 + 150, lockers 5 + 40 (a plank plinth), crates 1 + 120, storage box 1 + 80, the Makeshift tent 80 wood + 1 scrap.

## Beds as furniture
The user's request 2026-10-20: "Cots 1x2 mood debuff, Beds 1x2, bunkbeds 1x2 mood debuff and large beds 2x2 mood buff can be created and set in buildings to add beds for a base". Modules: [beds, data-beds; ui/basemap (the Furniture group, Pick up), ui/ui, ui/cmdpalette, ui/codex (furniture and retired cots hidden from the building lists)]; test `tools/bedstest.js`.

### The pieces [data-beds BED_SPEC]

| Piece | Size | Beds | Mood each | Recipe (the user's pick 2026-10-20) |
|---|---|---|---|---|
| cot | 1 × 2 | 1 | −1 | 60 wood + 2 scrap |
| bed | 1 × 2 | 1 | 0 | 150 + 2 |
| bunk bed | 1 × 2 | 2 | −0.5 | 250 + 3 |
| large bed | 2 × 2 | 2 | +1 | 300 + 3 + a part |

- Each is a bulky item carried in both arms or a cart (BED_GEAR), crafted at a crafting bench from wood and scrap (large bed also a part's springs: BED_CRAFTS, merged into crafting CRAFTS), found now and then where people slept (BED_FINDS, beds rollBedFind, scavenge.js; loot ITEM_TAGS).
- A large bed needs a lodge, hall or barn (a cabin's 3 × 2 floor keeps its middle clear between its two doors).

### Setting and picking up
- **Set** from the stores onto a general building's floor (BUILDINGS fit + furniture, basemap FOOT bed cells): the Build list group Furniture sets it where clicked, turned by R (basemap layoutAct build → beds setFurnitureAt). The Construction road and the governor let the auto layout place it (buildings queueBuild / canBuild / placeProblem → beds setFurniture / canSetFurniture / furnitureProblem).
- Demolish picks it up whole (beds pickUpFurniture). A building pulled down has its furniture carried out into the stores.
- On the battle map it is bed cells the barricade rules shove.

### Who sleeps where
- buildings baseBeds = plainBeds (core, bunkhouses, barracks, the bunk beds fitting) + beds furnitureBeds + buildings tentBeds − the children's.
- beds bedSlots best first by mood (pitched tents among them: makeshift −1, proper tent 0); bedAssignments: the leader, then by id; children take the worst.
- One mood line a day by the bed (beds bedLine in relations moodFactors): large bed +1; plain bed, bed and tent 0; bunk −0.5; cot and makeshift tent −1.

### Sleeping rough: the one rule
- At a base and a camp (pt-int merge): nobody without a bed gets BED_MOOD.rough −1 a day × ROUGH_WEATHER (×2 wet, ×3 freezing, the worse of the two; data-beds, beds roughNight).
- On a freezing night a coldIll 3% chance each of a chest cold (beds roughColdDaily from relations relationsDaily, its own hashed dice; the user's pick 2026-10-20).
- A camp has no crowding on top; a base past its beds keeps its old Overcrowded rule as well. On the road, the team's bags (tents roadTentsHour).

### Retired cots build
- BUILDINGS cots retired: canBuild refuses with RETIRED_WHY; the lists hide it. An old save's built cots become two Cots each (beds migrateCots, save.js).

### Governor and AI groups
- **Governor** (beds governBeds, autopilot governBase, before the day's builds): spare tent bags pitched first (free), then at a camp or shelter Makeshift tents (autopilot buildWishes) while it may build more, then furniture: sets what lies in the stores and queues a bunk bed (else a cot) only while beds built, pitched and queued still fall short.
- **AI groups** (coarse): a hall work (your Lodge: beds hallWork / hallDef, groupworks WORKS.hall and nextWork); furniture crafted from their stock at your costs, one piece a day where the hall's floor has room (beds groupBedsDaily, basemap fittingRoom on their base object); its sleepers counted as their beds (groupworks served / nextWork, beds furnSleepers); their people's bed mood off desertion pressure (beds groupBedMorale, groupcare desertPressure); the hall a Lodge and each piece on their base's map (groupbases WORKS_BUILDING, BED_WORKS_BUILDING).
